//! Een incrementele toevoeging aan een bestaand PDF-bestand schrijven
//! (ISO 32000-1 §7.5.6): nieuwe en gewijzigde objecten achter de oorspronkelijke
//! bytes, met een eigen xref-sectie (tabel of stroom, in dezelfde vorm als de
//! laatste van het bronbestand) en een trailer met `/Prev`. De bronbytes blijven
//! onaangeroerd, zodat eerdere handtekeningen geldig blijven.

use std::io::Write;

use lopdf::{Dictionary, Object, ObjectId, StringFormat};

/// Schrijft een `lopdf`-object als PDF-syntaxis. Streams horen hier niet: de
/// toevoeging schrijft alleen woordenboeken en arrays opnieuw; eigen streams
/// worden als ruwe bytes aangeleverd.
pub fn schrijf_object(uit: &mut Vec<u8>, object: &Object) {
    match object {
        Object::Null => uit.extend_from_slice(b"null"),
        Object::Boolean(true) => uit.extend_from_slice(b"true"),
        Object::Boolean(false) => uit.extend_from_slice(b"false"),
        Object::Integer(i) => {
            let _ = write!(uit, "{i}");
        }
        Object::Real(r) => schrijf_getal(uit, f64::from(*r)),
        Object::Name(naam) => schrijf_naam(uit, naam),
        Object::String(tekst, StringFormat::Hexadecimal) => {
            uit.push(b'<');
            for b in tekst {
                let _ = write!(uit, "{b:02X}");
            }
            uit.push(b'>');
        }
        Object::String(tekst, StringFormat::Literal) => schrijf_letterlijk(uit, tekst),
        Object::Array(items) => {
            uit.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    uit.push(b' ');
                }
                schrijf_object(uit, item);
            }
            uit.push(b']');
        }
        Object::Dictionary(d) => schrijf_woordenboek(uit, d),
        Object::Stream(s) => {
            // Niet bedoeld voor gebruik, maar nooit stil ongeldige PDF.
            schrijf_woordenboek(uit, &s.dict);
            uit.extend_from_slice(b"\nstream\n");
            uit.extend_from_slice(&s.content);
            uit.extend_from_slice(b"\nendstream");
        }
        Object::Reference((n, g)) => {
            let _ = write!(uit, "{n} {g} R");
        }
    }
}

pub fn schrijf_woordenboek(uit: &mut Vec<u8>, d: &Dictionary) {
    uit.extend_from_slice(b"<<");
    for (sleutel, waarde) in d.iter() {
        schrijf_naam(uit, sleutel);
        uit.push(b' ');
        schrijf_object(uit, waarde);
    }
    uit.extend_from_slice(b">>");
}

/// Een getal zonder exponent, met hooguit vier decimalen.
pub fn schrijf_getal(uit: &mut Vec<u8>, waarde: f64) {
    let waarde = if waarde.is_finite() { waarde } else { 0.0 };
    let tekst = format!("{waarde:.4}");
    let tekst = tekst.trim_end_matches('0').trim_end_matches('.');
    uit.extend_from_slice(if tekst == "-0" || tekst.is_empty() { b"0" } else { tekst.as_bytes() });
}

pub fn schrijf_naam(uit: &mut Vec<u8>, naam: &[u8]) {
    uit.push(b'/');
    for &b in naam {
        if b"()<>[]{}/%#".contains(&b) || !(33..=126).contains(&b) {
            let _ = write!(uit, "#{b:02X}");
        } else {
            uit.push(b);
        }
    }
}

fn schrijf_letterlijk(uit: &mut Vec<u8>, tekst: &[u8]) {
    uit.push(b'(');
    for &b in tekst {
        match b {
            b'(' | b')' | b'\\' => {
                uit.push(b'\\');
                uit.push(b);
            }
            b'\r' => uit.extend_from_slice(b"\\r"),
            b'\n' => uit.extend_from_slice(b"\\n"),
            _ => uit.push(b),
        }
    }
    uit.push(b')');
}

/// Een tekststring (ISO 32000-1 §7.9.2.2) als hex-string in UTF-16BE met BOM:
/// elke Unicode-tekst blijft zo intact, ook in lezers zonder PDFDocEncoding-tabel.
pub fn tekststring(tekst: &str) -> Object {
    let mut bytes = vec![0xFE, 0xFF];
    for eenheid in tekst.encode_utf16() {
        bytes.extend_from_slice(&eenheid.to_be_bytes());
    }
    Object::String(bytes, StringFormat::Hexadecimal)
}

/// Vorm van de xref-sectie van de toevoeging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XrefVorm {
    Tabel,
    Stroom,
}

/// De gegevens uit de laatste trailer die de nieuwe trailer overneemt.
#[derive(Debug, Clone)]
pub struct Trailergegevens {
    pub vorm: XrefVorm,
    /// Offset van de laatste xref-sectie van het bronbestand (`startxref`).
    pub vorige_xref: usize,
    /// Eerste vrije objectnummer (`/Size` van de bron).
    pub grootte: u32,
    pub root: ObjectId,
    pub info: Option<ObjectId>,
    pub id: Option<Object>,
}

/// Een object van de toevoeging: nummer en de inhoud tussen `obj` en `endobj`.
pub struct NieuwObject {
    pub id: ObjectId,
    pub inhoud: Vec<u8>,
}

impl NieuwObject {
    pub fn van(id: ObjectId, object: &Object) -> NieuwObject {
        let mut inhoud = Vec::new();
        schrijf_object(&mut inhoud, object);
        NieuwObject { id, inhoud }
    }
}

/// De volledige bytes: bron + toevoeging. `objecten` krijgen elk een
/// xref-regel; bij een xref-stroom krijgt de stroom zelf het nummer
/// `trailer.grootte + extra` direct na de hoogste nieuwe. Geeft ook per object
/// de offset van zijn kop terug (in dezelfde volgorde als `objecten`).
pub fn schrijf_toevoeging(bron: &[u8], trailer: &Trailergegevens, objecten: &[NieuwObject]) -> (Vec<u8>, Vec<usize>) {
    let mut uit = Vec::with_capacity(bron.len() + objecten.iter().map(|o| o.inhoud.len() + 32).sum::<usize>() + 512);
    uit.extend_from_slice(bron);
    if !matches!(uit.last(), Some(b'\n' | b'\r')) {
        uit.push(b'\n');
    }
    let mut offsets = Vec::with_capacity(objecten.len());
    for o in objecten {
        offsets.push(uit.len());
        let _ = write!(uit, "{} {} obj\n", o.id.0, o.id.1);
        uit.extend_from_slice(&o.inhoud);
        uit.extend_from_slice(b"\nendobj\n");
    }
    let hoogste = objecten.iter().map(|o| o.id.0).max().unwrap_or(0);
    let mut regels: Vec<(u32, u16, usize)> =
        objecten.iter().zip(&offsets).map(|(o, &off)| (o.id.0, o.id.1, off)).collect();
    let xref_start = uit.len();
    match trailer.vorm {
        XrefVorm::Tabel => {
            let grootte = trailer.grootte.max(hoogste + 1);
            regels.sort_by_key(|r| r.0);
            uit.extend_from_slice(b"xref\n");
            for groep in aaneengesloten(&regels) {
                let _ = write!(uit, "{} {}\n", groep[0].0, groep.len());
                for &(_, g, off) in groep {
                    // Elke regel precies 20 bytes (§7.5.4).
                    let _ = write!(uit, "{off:010} {g:05} n\r\n");
                }
            }
            let mut d = trailer_woordenboek(trailer, grootte);
            d.set("Prev", Object::Integer(trailer.vorige_xref as i64));
            uit.extend_from_slice(b"trailer\n");
            schrijf_woordenboek(&mut uit, &d);
            uit.push(b'\n');
        }
        XrefVorm::Stroom => {
            let stroom_nummer = trailer.grootte.max(hoogste + 1);
            regels.push((stroom_nummer, 0, xref_start));
            regels.sort_by_key(|r| r.0);
            let grootte = stroom_nummer + 1;
            let mut data = Vec::with_capacity(regels.len() * 7);
            let mut index = Vec::new();
            for groep in aaneengesloten(&regels) {
                index.push(Object::Integer(i64::from(groep[0].0)));
                index.push(Object::Integer(groep.len() as i64));
                for &(_, g, off) in groep {
                    data.push(1);
                    data.extend_from_slice(&(off as u32).to_be_bytes());
                    data.extend_from_slice(&g.to_be_bytes());
                }
            }
            let mut d = trailer_woordenboek(trailer, grootte);
            d.set("Type", Object::Name(b"XRef".to_vec()));
            d.set("Prev", Object::Integer(trailer.vorige_xref as i64));
            d.set("W", Object::Array(vec![Object::Integer(1), Object::Integer(4), Object::Integer(2)]));
            d.set("Index", Object::Array(index));
            d.set("Length", Object::Integer(data.len() as i64));
            let _ = write!(uit, "{stroom_nummer} 0 obj\n");
            schrijf_woordenboek(&mut uit, &d);
            uit.extend_from_slice(b"\nstream\n");
            uit.extend_from_slice(&data);
            uit.extend_from_slice(b"\nendstream\nendobj\n");
        }
    }
    let _ = write!(uit, "startxref\n{xref_start}\n%%EOF\n");
    (uit, offsets)
}

fn trailer_woordenboek(trailer: &Trailergegevens, grootte: u32) -> Dictionary {
    let mut d = Dictionary::new();
    d.set("Size", Object::Integer(i64::from(grootte)));
    d.set("Root", Object::Reference(trailer.root));
    if let Some(info) = trailer.info {
        d.set("Info", Object::Reference(info));
    }
    if let Some(id) = &trailer.id {
        d.set("ID", id.clone());
    }
    d
}

/// Opeenvolgende objectnummers als groepen (subsecties van de xref).
fn aaneengesloten(regels: &[(u32, u16, usize)]) -> Vec<&[(u32, u16, usize)]> {
    let mut groepen = Vec::new();
    let mut begin = 0;
    for i in 1..=regels.len() {
        if i == regels.len() || regels[i].0 != regels[i - 1].0 + 1 {
            if begin < i {
                groepen.push(&regels[begin..i]);
            }
            begin = i;
        }
    }
    groepen
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn objecten_en_namen_volgens_de_syntaxis() {
        let mut d = Dictionary::new();
        d.set("Type", Object::Name(b"Annot".to_vec()));
        d.set("Naam met spatie", Object::String(b"a(b)\\c".to_vec(), StringFormat::Literal));
        d.set("Rect", Object::Array(vec![Object::Real(1.5), Object::Integer(-2), Object::Reference((7, 0))]));
        let mut uit = Vec::new();
        schrijf_object(&mut uit, &Object::Dictionary(d));
        assert_eq!(
            String::from_utf8(uit).unwrap(),
            "<</Type /Annot/Naam#20met#20spatie (a\\(b\\)\\\\c)/Rect [1.5 -2 7 0 R]>>"
        );
    }

    #[test]
    fn getallen_zonder_exponent() {
        let mut uit = Vec::new();
        for g in [0.0, -0.0, 1e-7, 12.0, 0.5, 123456.789, f64::NAN] {
            schrijf_getal(&mut uit, g);
            uit.push(b' ');
        }
        assert_eq!(String::from_utf8(uit).unwrap(), "0 0 0 12 0.5 123456.789 0 ");
    }

    #[test]
    fn tekststring_is_utf16_met_bom() {
        let Object::String(b, StringFormat::Hexadecimal) = tekststring("é€") else { panic!() };
        assert_eq!(b, vec![0xFE, 0xFF, 0x00, 0xE9, 0x20, 0xAC]);
    }

    #[test]
    fn groepen_van_opeenvolgende_nummers() {
        let r = [(3, 0, 0), (4, 0, 0), (9, 0, 0), (10, 0, 0), (12, 0, 0)];
        let g = aaneengesloten(&r);
        assert_eq!(g.iter().map(|g| (g[0].0, g.len())).collect::<Vec<_>>(), vec![(3, 2), (9, 2), (12, 1)]);
    }

    #[test]
    fn tabelregels_zijn_twintig_bytes_en_lopdf_leest_de_toevoeging() {
        let bron = minimale_pdf();
        let doc = lopdf::Document::load_mem(&bron).unwrap();
        let trailer = Trailergegevens {
            vorm: XrefVorm::Tabel,
            vorige_xref: doc.xref_start,
            grootte: 4,
            root: (1, 0),
            info: None,
            id: None,
        };
        let mut pagina = doc.get_object((3, 0)).unwrap().as_dict().unwrap().clone();
        pagina.set("Proef", Object::Integer(42));
        let (uit, offsets) = schrijf_toevoeging(&bron, &trailer, &[NieuwObject::van((3, 0), &Object::Dictionary(pagina))]);
        assert!(uit.starts_with(&bron));
        assert_eq!(&uit[offsets[0]..offsets[0] + 8], b"3 0 obj\n");
        let xref = uit.windows(6).rposition(|w| w == b"\nxref\n").unwrap() + 1;
        let regel = &uit[xref + 9..xref + 29];
        assert_eq!(regel, format!("{:010} 00000 n\r\n", offsets[0]).as_bytes());
        let nieuw = lopdf::Document::load_mem(&uit).unwrap();
        assert_eq!(nieuw.get_object((3, 0)).unwrap().as_dict().unwrap().get(b"Proef").unwrap().as_i64().unwrap(), 42);
        assert_eq!(nieuw.get_pages().len(), 1);
    }

    #[test]
    fn xref_stroom_wordt_door_lopdf_gelezen() {
        let bron = minimale_pdf();
        let doc = lopdf::Document::load_mem(&bron).unwrap();
        let trailer = Trailergegevens {
            vorm: XrefVorm::Stroom,
            vorige_xref: doc.xref_start,
            grootte: 4,
            root: (1, 0),
            info: None,
            id: None,
        };
        let mut pagina = doc.get_object((3, 0)).unwrap().as_dict().unwrap().clone();
        pagina.set("Proef", Object::Integer(7));
        let nieuw_object = Object::Dictionary(Dictionary::from_iter(vec![("Nieuw", Object::Boolean(true))]));
        let (uit, _) = schrijf_toevoeging(
            &bron,
            &trailer,
            &[NieuwObject::van((3, 0), &Object::Dictionary(pagina)), NieuwObject::van((4, 0), &nieuw_object)],
        );
        let nieuw = lopdf::Document::load_mem(&uit).unwrap();
        assert_eq!(nieuw.get_object((3, 0)).unwrap().as_dict().unwrap().get(b"Proef").unwrap().as_i64().unwrap(), 7);
        assert!(nieuw.get_object((4, 0)).is_ok());
        assert_eq!(nieuw.trailer.get(b"Size").unwrap().as_i64().unwrap(), 6);
    }

    /// Een kleine, geldige PDF met een klassieke xref-tabel.
    pub(crate) fn minimale_pdf() -> Vec<u8> {
        let objecten = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
        ];
        let mut uit = b"%PDF-1.7\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objecten.iter().enumerate() {
            offsets.push(uit.len());
            uit.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
        }
        let xref = uit.len();
        uit.extend_from_slice(b"xref\n0 4\n0000000000 65535 f\r\n");
        for o in offsets {
            uit.extend_from_slice(format!("{o:010} 00000 n\r\n").as_bytes());
        }
        uit.extend_from_slice(format!("trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes());
        uit
    }
}
