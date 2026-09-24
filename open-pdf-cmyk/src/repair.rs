//! Het document laden, en herstellen wat lopdf 0.34 uit xref-stromen
//! verkeerd leest.
//!
//! lopdf decodeert het PNG-filter "Average" fout (`left + up/2` in plaats van
//! `(left + up)/2`). Rijen van een xref-stroom met dat filter krijgen dan
//! een onzin-offset en het object ontbreekt stil in het document; de
//! omzetting zou het dan ook stil overslaan. Daarom lezen we de xref-keten
//! hier zelf nog eens, met de predictor van `images`, en laden we de
//! objecten waarvan de plek afwijkt opnieuw — alleen als de plek aantoonbaar
//! klopt (`<nr> <gen> obj` op die offset).

use crate::images::{decode_filters, filters_of, Decoded};
use crate::lexer::{is_ws, parse_object, Kind, Lexer, Tok};
use lopdf::xref::XrefEntry;
use lopdf::{Document, Object, ObjectStream, Reader};
use std::collections::{BTreeMap, HashSet};

/// Laadt het document en herstelt verkeerd gelezen xref-regels. Geeft ook
/// het aantal herstelde objecten.
pub(crate) fn load(pdf: &[u8]) -> lopdf::Result<(Document, usize)> {
    let mut doc = Document::load_mem(pdf)?;
    let chain = read_chain(pdf, doc.xref_start);
    let mut plain = Vec::new();
    let mut packed: BTreeMap<u32, Vec<(u32, u16)>> = BTreeMap::new();
    for (&id, entry) in &chain {
        let theirs = doc.reference_table.get(id);
        match *entry {
            Entry::Normal { offset, gen } => {
                let same = matches!(theirs, Some(XrefEntry::Normal { offset: o, generation: g }) if *o == offset && *g == gen);
                if !same && object_header_at(pdf, offset as usize) == Some((id, gen)) {
                    plain.push((id, gen, offset));
                }
            }
            Entry::Compressed { container, index } => {
                let same = matches!(theirs, Some(XrefEntry::Compressed { container: c, index: i }) if *c == container && *i == index);
                if !same {
                    packed.entry(container).or_default().push((id, index));
                }
            }
        }
    }
    let mut repaired = 0;
    if !plain.is_empty() {
        for &(id, gen, offset) in &plain {
            doc.reference_table.insert(id, XrefEntry::Normal { offset, generation: gen });
        }
        let reader = Reader { buffer: pdf, document: doc };
        let mut found = Vec::new();
        for &(id, gen, _) in &plain {
            if let Ok(obj) = reader.get_object((id, gen), &mut HashSet::new()) {
                found.push(((id, gen), obj));
            }
        }
        doc = reader.document;
        for (key, obj) in found {
            replace(&mut doc, key, obj);
            repaired += 1;
        }
    }
    for (container, members) in packed {
        let Ok(Object::Stream(stream)) = doc.get_object((container, 0)) else { continue };
        let Ok(objstm) = ObjectStream::new(&mut stream.clone()) else { continue };
        for (id, index) in members {
            if let Some(obj) = objstm.objects.get(&(id, 0)) {
                doc.reference_table.insert(id, XrefEntry::Compressed { container, index });
                replace(&mut doc, (id, 0), obj.clone());
                repaired += 1;
            }
        }
    }
    Ok((doc, repaired))
}

/// Zet het juiste object neer en ruimt wat lopdf onder hetzelfde nummer
/// (met een onzin-generatie) had gelezen op.
fn replace(doc: &mut Document, key: (u32, u16), obj: Object) {
    let stale: Vec<_> = doc.objects.keys().filter(|k| k.0 == key.0 && k.1 != key.1).copied().collect();
    for k in stale {
        doc.objects.remove(&k);
    }
    doc.objects.insert(key, obj);
    doc.max_id = doc.max_id.max(key.0);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry {
    Normal { offset: u32, gen: u16 },
    Compressed { container: u32, index: u16 },
}

/// Alle xref-secties vanaf `start`, via `/Prev` en `/XRefStm`. De nieuwste
/// sectie wint; vrije regels tellen niet mee.
fn read_chain(pdf: &[u8], start: usize) -> BTreeMap<u32, Entry> {
    let mut out: BTreeMap<u32, Entry> = BTreeMap::new();
    let mut freed: HashSet<u32> = HashSet::new();
    let mut todo = vec![start];
    let mut seen = HashSet::new();
    while let Some(at) = todo.pop() {
        if at >= pdf.len() || !seen.insert(at) || seen.len() > 256 {
            continue;
        }
        let Some((entries, trailer)) = read_section(pdf, at) else { continue };
        for (id, entry) in entries {
            if out.contains_key(&id) || freed.contains(&id) {
                continue;
            }
            match entry {
                Some(e) => {
                    out.insert(id, e);
                }
                None => {
                    freed.insert(id);
                }
            }
        }
        // Eerst Prev op de stapel, dan XRefStm: die hoort bij dezelfde update
        // en gaat dus voor.
        for key in [&b"Prev"[..], b"XRefStm"] {
            if let Some(v) = trailer.get(key).ok().and_then(|o| o.as_i64().ok()) {
                if v >= 0 {
                    todo.push(v as usize);
                }
            }
        }
    }
    out
}

type Section = (Vec<(u32, Option<Entry>)>, lopdf::Dictionary);

fn read_section(pdf: &[u8], at: usize) -> Option<Section> {
    let mut lx = Lexer::new(pdf);
    lx.pos = at;
    let first = lx.next_tok()?;
    if &pdf[first.start..first.end] == b"xref" {
        read_table(pdf, &mut lx)
    } else {
        read_stream_section(pdf, &mut lx, first)
    }
}

fn int(pdf: &[u8], t: Tok) -> Option<u64> {
    std::str::from_utf8(&pdf[t.start..t.end]).ok()?.parse().ok()
}

/// Tokens van één object, tot het blok (woordenboek of array) weer dicht is.
fn object_tokens(lx: &mut Lexer) -> Option<Vec<Tok>> {
    let mut toks = Vec::new();
    let mut depth = 0i32;
    loop {
        let t = lx.next_tok()?;
        match t.kind {
            Kind::DictOpen | Kind::ArrOpen => depth += 1,
            Kind::DictClose | Kind::ArrClose => depth -= 1,
            _ => {}
        }
        toks.push(t);
        if depth <= 0 {
            return Some(toks);
        }
    }
}

fn dict_from(pdf: &[u8], lx: &mut Lexer) -> Option<lopdf::Dictionary> {
    let toks = object_tokens(lx)?;
    match parse_object(pdf, &toks, &mut 0)? {
        Object::Dictionary(d) => Some(d),
        _ => None,
    }
}

/// Klassieke tabel: subsecties "start aantal" met regels "offset gen n|f".
fn read_table(pdf: &[u8], lx: &mut Lexer) -> Option<Section> {
    let mut entries = Vec::new();
    loop {
        let t = lx.next_tok()?;
        if &pdf[t.start..t.end] == b"trailer" {
            break;
        }
        let start = int(pdf, t)? as u32;
        let count = int(pdf, lx.next_tok()?)? as u32;
        for k in 0..count.min(10_000_000) {
            let offset = int(pdf, lx.next_tok()?)?;
            let gen = int(pdf, lx.next_tok()?)?;
            let kind = lx.next_tok()?;
            let entry = match &pdf[kind.start..kind.end] {
                b"n" => Some(Entry::Normal { offset: offset as u32, gen: gen as u16 }),
                _ => None,
            };
            entries.push((start + k, entry));
        }
    }
    Some((entries, dict_from(pdf, lx)?))
}

/// Xref-stroom: `<nr> <gen> obj << … >> stream … endstream`.
fn read_stream_section(pdf: &[u8], lx: &mut Lexer, first: Tok) -> Option<Section> {
    int(pdf, first)?;
    int(pdf, lx.next_tok()?)?;
    let obj = lx.next_tok()?;
    if &pdf[obj.start..obj.end] != b"obj" {
        return None;
    }
    let dict = dict_from(pdf, lx)?;
    if dict.get(b"Type").and_then(|o| o.as_name()).ok() != Some(b"XRef") {
        return None;
    }
    let kw = lx.next_tok()?;
    if &pdf[kw.start..kw.end] != b"stream" {
        return None;
    }
    let mut start = kw.end;
    if pdf.get(start) == Some(&b'\r') {
        start += 1;
    }
    if pdf.get(start) == Some(&b'\n') {
        start += 1;
    }
    let raw = match dict.get(b"Length").and_then(|o| o.as_i64()) {
        Ok(n) if n >= 0 && start + (n as usize) <= pdf.len() => &pdf[start..start + n as usize],
        _ => {
            let end = find(pdf, start, b"endstream")?;
            &pdf[start..end]
        }
    };
    let (filters, parms) = filters_of(&dict, false);
    let Decoded::Raw(data) = decode_filters(raw, &filters, &parms).ok()? else { return None };
    let w: Vec<usize> = dict.get(b"W").ok()?.as_array().ok()?.iter().map(|o| o.as_i64().unwrap_or(0).max(0) as usize).collect();
    if w.len() != 3 || w.iter().any(|&n| n > 8) {
        return None;
    }
    let size = dict.get(b"Size").and_then(|o| o.as_i64()).unwrap_or(0);
    let index: Vec<i64> = match dict.get(b"Index").and_then(|o| o.as_array()) {
        Ok(a) => a.iter().map(|o| o.as_i64().unwrap_or(0)).collect(),
        Err(_) => vec![0, size],
    };
    let row = w.iter().sum::<usize>();
    if row == 0 {
        return None;
    }
    let field = |bytes: &[u8]| bytes.iter().fold(0u64, |acc, &b| (acc << 8) | b as u64);
    let mut entries = Vec::new();
    let mut pos = 0;
    for pair in index.chunks(2) {
        let [first_id, count] = pair else { break };
        for k in 0..(*count).max(0) {
            let Some(r) = data.get(pos..pos + row) else { break };
            pos += row;
            let kind = if w[0] == 0 { 1 } else { field(&r[..w[0]]) };
            let a = field(&r[w[0]..w[0] + w[1]]);
            let b = field(&r[w[0] + w[1]..]);
            let id = (*first_id + k) as u32;
            let entry = match kind {
                1 => Some(Entry::Normal { offset: a as u32, gen: b as u16 }),
                2 => Some(Entry::Compressed { container: a as u32, index: b as u16 }),
                _ => None,
            };
            entries.push((id, entry));
        }
    }
    Some((entries, dict))
}

fn find(hay: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|p| from + p)
}

/// `<nr> <gen> obj` op deze plek (na eventuele witruimte)?
fn object_header_at(pdf: &[u8], mut at: usize) -> Option<(u32, u16)> {
    while at < pdf.len() && is_ws(pdf[at]) {
        at += 1;
    }
    let mut lx = Lexer::new(pdf);
    lx.pos = at;
    let id = int(pdf, lx.next_tok()?)?;
    let gen = int(pdf, lx.next_tok()?)?;
    let obj = lx.next_tok()?;
    (&pdf[obj.start..obj.end] == b"obj").then_some((id as u32, gen as u16))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::images::deflate;
    use crate::transform::NaiveCmyk;

    /// PNG-codering van xref-rijen (bpp 1) met per rij een eigen filter.
    fn png_rows(rows: &[Vec<u8>], filters: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut prev = vec![0u8; rows[0].len()];
        for (row, &f) in rows.iter().zip(filters) {
            out.push(f);
            for i in 0..row.len() {
                let left = if i >= 1 { row[i - 1] } else { 0 };
                let up = prev[i];
                let pred = match f {
                    0 => 0,
                    2 => up,
                    3 => ((left as u16 + up as u16) / 2) as u8,
                    _ => unreachable!(),
                };
                out.push(row[i].wrapping_sub(pred));
            }
            prev = row.clone();
        }
        out
    }

    /// Een PDF met een xref-stroom (W [1 3 2], Predictor 12). Object 6 (de
    /// resources, met een benoemde RGB-ruimte) zit in objectstroom 7. De rijen
    /// van object 4 (de inhoud) en object 6 gebruiken het Average-filter.
    fn broken_xref_pdf() -> Vec<u8> {
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut offsets = vec![0usize; 9];
        let content = b"1 0 0 rg 0 0 5 5 re f /CS0 cs 0 0 1 sc 5 5 5 5 re f";
        let objstm_body = b"6 0 << /ColorSpace << /CS0 [/CalRGB << >>] >> >>";
        let objects: Vec<(usize, Vec<u8>)> = vec![
            (1, b"<< /Type /Catalog /Pages 2 0 R >>".to_vec()),
            (2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec()),
            (3, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources 6 0 R >>".to_vec()),
            (4, [format!("<< /Length {} >>\nstream\n", content.len()).as_bytes(), content, b"\nendstream"].concat()),
            (7, [format!("<< /Type /ObjStm /N 1 /First 4 /Length {} >>\nstream\n", objstm_body.len()).as_bytes(), objstm_body, b"\nendstream"].concat()),
        ];
        for (id, body) in &objects {
            offsets[*id] = pdf.len();
            pdf.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
            pdf.extend_from_slice(body);
            pdf.extend_from_slice(b"\nendobj\n");
        }
        let xref_at = pdf.len();
        let row = |t: u8, a: usize, b: u16| {
            let mut r = vec![t];
            r.extend_from_slice(&(a as u32).to_be_bytes()[1..]);
            r.extend_from_slice(&b.to_be_bytes());
            r
        };
        let rows = vec![
            row(0, 0, 65535),
            row(1, offsets[1], 0),
            row(1, offsets[2], 0),
            row(1, offsets[3], 0),
            row(1, offsets[4], 0),
            row(1, xref_at, 0),
            row(2, 7, 0),
            row(1, offsets[7], 0),
        ];
        let filters = [0, 2, 2, 2, 3, 2, 3, 2];
        let data = deflate(&png_rows(&rows, &filters));
        pdf.extend_from_slice(
            format!(
                "5 0 obj\n<< /Type /XRef /Size 8 /Root 1 0 R /W [1 3 2] /Index [0 8] /Filter /FlateDecode \
                 /DecodeParms << /Predictor 12 /Columns 6 >> /Length {} >>\nstream\n",
                data.len()
            )
            .as_bytes(),
        );
        pdf.extend_from_slice(&data);
        pdf.extend_from_slice(format!("\nendstream\nendobj\nstartxref\n{xref_at}\n%%EOF\n").as_bytes());
        pdf
    }

    #[test]
    fn the_fixture_really_trips_lopdf() {
        // Voorwaarde van de andere tests: lopdf alleen mist beide objecten.
        // Faalt dit ooit, dan is lopdf gerepareerd en kan dit herstel weg.
        let doc = Document::load_mem(&broken_xref_pdf()).unwrap();
        assert!(doc.get_object((4, 0)).is_err());
        assert!(doc.get_object((6, 0)).is_err());
    }

    #[test]
    fn load_repairs_plain_and_compressed_objects() {
        let (doc, repaired) = load(&broken_xref_pdf()).unwrap();
        // Rijen met Up ná een verkeerd gelezen Average-rij erven de fout: ook
        // de xref-stroom zelf (5) en de objectstroom (7) waren zoek.
        assert_eq!(repaired, 4);
        assert!(doc.get_object((7, 0)).unwrap().as_stream().is_ok());
        assert!(doc.get_object((4, 0)).unwrap().as_stream().is_ok());
        let res = doc.get_dictionary((6, 0)).unwrap();
        assert!(res.get(b"ColorSpace").is_ok());
    }

    #[test]
    fn a_healthy_file_needs_no_repair() {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let page = doc.add_object(lopdf::dictionary! { "Type" => "Page", "Parent" => pages });
        doc.objects.insert(pages, lopdf::dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }.into());
        let catalog = doc.add_object(lopdf::dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        let (_, repaired) = load(&bytes).unwrap();
        assert_eq!(repaired, 0);
    }

    #[test]
    fn conversion_sees_the_repaired_objects() {
        let out = crate::convert_document(&broken_xref_pdf(), &NaiveCmyk).unwrap();
        // rg en de sc in de benoemde CalRGB-ruimte.
        assert_eq!(out.report.colour_operators.converted, 2);
        assert_eq!(out.report.colour_spaces.converted, 1);
    }
}
