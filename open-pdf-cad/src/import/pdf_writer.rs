//! Minimale PDF-schrijver voor de import: objecten, streams en een xref-tabel.
//!
//! Eigen code in plaats van een PDF-bibliotheek omdat getallen in `f64`
//! geschreven moeten worden: de afbeelding pagina → model bij landelijke
//! coördinaten (10⁸ mm) past niet in de `f32` die gangbare bibliotheken voor
//! reële getallen gebruiken.

use std::io::{self, Write};

/// Een PDF-object in het geheugen.
#[derive(Clone, Debug, PartialEq)]
pub enum Obj {
    Null,
    Bool(bool),
    Int(i64),
    Real(f64),
    Name(String),
    /// Letterlijke tekenreeks; de bytes worden bij het schrijven geëscaped.
    Str(Vec<u8>),
    Array(Vec<Obj>),
    Dict(Vec<(String, Obj)>),
    Ref(u32),
}

impl Obj {
    pub fn name(n: &str) -> Obj {
        Obj::Name(n.to_string())
    }

    /// Tekst als PDF-tekstreeks: ASCII blijft ASCII, anders UTF-16BE met BOM.
    pub fn text(s: &str) -> Obj {
        Obj::Str(text_bytes(s))
    }

    pub fn reals(values: &[f64]) -> Obj {
        Obj::Array(values.iter().map(|v| Obj::Real(*v)).collect())
    }

    pub fn dict(entries: Vec<(&str, Obj)>) -> Obj {
        Obj::Dict(entries.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
}

/// Bytes van een PDF-tekstreeks (ISO 32000-1, 7.9.2.2).
pub fn text_bytes(s: &str) -> Vec<u8> {
    if s.bytes().all(|b| (0x20..0x7f).contains(&b)) {
        return s.as_bytes().to_vec();
    }
    let mut out = vec![0xFE, 0xFF];
    for unit in s.encode_utf16() {
        out.extend_from_slice(&unit.to_be_bytes());
    }
    out
}

/// Schrijft een reëel getal kort en exact genoeg: hooguit zes decimalen,
/// zonder overbodige nullen, nooit in wetenschappelijke notatie.
pub fn write_real(out: &mut Vec<u8>, v: f64) {
    let v = if v.is_finite() { v } else { 0.0 };
    // Twaalf significante cijfers: een meetschaal in meters per punt
    // (0,000352777…) of een modelmatrix met landelijke coördinaten houdt zo
    // zijn nauwkeurigheid; vaste zes decimalen gaven daar maar drie cijfers.
    let magnitude = if v == 0.0 { 0 } else { v.abs().log10().floor() as i32 + 1 };
    let decimals = (12 - magnitude).clamp(0, 17) as usize;
    let mut s = format!("{:.*}", decimals, v);
    if s.contains('.') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    if s == "-0" {
        s = "0".into();
    }
    out.extend_from_slice(s.as_bytes());
}

/// Snelle getalopmaak voor inhoudsstromen: drie decimalen (0,001 pt ≈
/// 0,35 µm op papier), zonder overbodige nullen.
pub fn write_coord(out: &mut Vec<u8>, v: f64) {
    let scaled = (v * 1000.0).round();
    if !scaled.is_finite() || scaled.abs() > 9.0e15 {
        out.push(b'0');
        return;
    }
    let mut n = scaled as i64;
    if n < 0 {
        out.push(b'-');
        n = -n;
    }
    let int = n / 1000;
    let frac = n % 1000;
    write_uint(out, int as u64);
    if frac != 0 {
        out.push(b'.');
        let digits = [(frac / 100) as u8, ((frac / 10) % 10) as u8, (frac % 10) as u8];
        let len = if digits[2] != 0 { 3 } else if digits[1] != 0 { 2 } else { 1 };
        for d in &digits[..len] {
            out.push(b'0' + d);
        }
    }
}

fn write_uint(out: &mut Vec<u8>, mut n: u64) {
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    out.extend_from_slice(&buf[i..]);
}

/// Letterlijke PDF-tekenreeks met escapes voor `(`, `)`, `\` en stuurtekens.
pub fn write_literal(out: &mut Vec<u8>, bytes: &[u8]) {
    out.push(b'(');
    for &b in bytes {
        match b {
            b'(' | b')' | b'\\' => {
                out.push(b'\\');
                out.push(b);
            }
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            0x00..=0x1f | 0x7f => {
                out.push(b'\\');
                out.push(b'0' + (b >> 6));
                out.push(b'0' + ((b >> 3) & 7));
                out.push(b'0' + (b & 7));
            }
            _ => out.push(b),
        }
    }
    out.push(b')');
}

fn write_name(out: &mut Vec<u8>, name: &str) {
    out.push(b'/');
    for &b in name.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b'+' | b'*') {
            out.push(b);
        } else {
            out.extend_from_slice(format!("#{b:02X}").as_bytes());
        }
    }
}

fn write_obj(out: &mut Vec<u8>, obj: &Obj) {
    match obj {
        Obj::Null => out.extend_from_slice(b"null"),
        Obj::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Obj::Int(i) => out.extend_from_slice(i.to_string().as_bytes()),
        Obj::Real(r) => write_real(out, *r),
        Obj::Name(n) => write_name(out, n),
        Obj::Str(s) => write_literal(out, s),
        Obj::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                write_obj(out, item);
            }
            out.push(b']');
        }
        Obj::Dict(entries) => {
            out.extend_from_slice(b"<<");
            for (k, v) in entries {
                write_name(out, k);
                out.push(b' ');
                write_obj(out, v);
            }
            out.extend_from_slice(b">>");
        }
        Obj::Ref(id) => out.extend_from_slice(format!("{id} 0 R").as_bytes()),
    }
}

enum Body {
    Plain(Obj),
    Stream { dict: Vec<(String, Obj)>, data: Vec<u8> },
}

/// Een PDF-bestand in opbouw. Object 1 is altijd de catalogus.
pub struct PdfFile {
    objects: Vec<Option<Body>>,
}

/// Blokgrootte bij het inpakken: tussen twee blokken wordt de afbreekvlag
/// gevraagd. Eén megabyte inpakken duurt enkele tientallen milliseconden, dus
/// afbreken reageert ook binnen een inhoudsstroom van honderden megabytes.
pub const PACK_BLOCK: usize = 1 << 20;

/// Blokgrootte bij het wegschrijven van een stream.
pub const WRITE_BLOCK: usize = 4 << 20;

fn interrupted() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "afgebroken")
}

/// Maakt ruimte voor `extra` bytes. Een tekort aan geheugen geeft een fout van
/// soort `OutOfMemory`; een gewone `Vec` zou het hele proces stoppen.
pub(crate) fn reserve(buffer: &mut Vec<u8>, extra: usize) -> io::Result<()> {
    buffer.try_reserve(extra).map_err(|_| io::Error::new(io::ErrorKind::OutOfMemory, "onvoldoende geheugen"))
}

/// Waar het inpakken naartoe schrijft: groeit met [`reserve`] en houdt zich aan
/// een bovengrens als die is opgegeven.
struct PackBuffer {
    data: Vec<u8>,
    limit: Option<u64>,
}

impl Write for PackBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if let Some(limit) = self.limit {
            if (self.data.len() as u64).saturating_add(bytes.len() as u64) > limit {
                return Err(io::Error::other("boven de grens"));
            }
        }
        reserve(&mut self.data, bytes.len())?;
        self.data.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Pakt in met Flate, stuk voor stuk aangeleverd. De uitvoer hangt niet af van
/// de grootte van de stukken: een beeld dat regel voor regel binnenkomt geeft
/// dezelfde bytes als het hele beeld in één keer. Met een bovengrens stopt het
/// inpakken met een fout zodra de uitvoer die haalt.
pub(crate) struct Packer(flate2::write::ZlibEncoder<PackBuffer>);

impl Packer {
    pub fn new(limit: Option<u64>) -> Packer {
        let buffer = PackBuffer { data: Vec::new(), limit };
        Packer(flate2::write::ZlibEncoder::new(buffer, flate2::Compression::new(6)))
    }

    pub fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0.write_all(bytes)
    }

    pub fn finish(self) -> io::Result<Vec<u8>> {
        self.0.finish().map(|buffer| buffer.data)
    }
}

/// Pakt `data` in met Flate, blok voor blok. `Err` als er is afgebroken
/// (`Interrupted`) of als het geheugen op is (`OutOfMemory`). De uitvoer hangt
/// niet af van de blokgrootte.
fn pack(data: &[u8], cancelled: &dyn Fn() -> bool) -> io::Result<Vec<u8>> {
    let mut packer = Packer::new(None);
    for block in data.chunks(PACK_BLOCK) {
        if cancelled() {
            return Err(interrupted());
        }
        packer.write(block)?;
    }
    packer.finish()
}

impl Default for PdfFile {
    fn default() -> Self {
        Self::new()
    }
}

impl PdfFile {
    pub fn new() -> Self {
        PdfFile { objects: Vec::new() }
    }

    /// Reserveert een objectnummer voor een object dat later gezet wordt.
    pub fn reserve(&mut self) -> u32 {
        self.objects.push(None);
        self.objects.len() as u32
    }

    pub fn add(&mut self, obj: Obj) -> u32 {
        self.objects.push(Some(Body::Plain(obj)));
        self.objects.len() as u32
    }

    pub fn set(&mut self, id: u32, obj: Obj) {
        self.objects[id as usize - 1] = Some(Body::Plain(obj));
    }

    /// Als [`PdfFile::add_stream`] met inpakken, maar vanuit geleende bytes:
    /// een groot beeld dat meer pagina's delen hoeft zo niet eerst gekopieerd.
    /// Er is geen terugval op een onverpakte kopie: past de ingepakte stream
    /// niet in het geheugen, dan is dat een fout (`OutOfMemory`) en geen
    /// allocatie die het proces stopt.
    pub fn add_packed_stream(&mut self, dict: Vec<(String, Obj)>, data: &[u8]) -> io::Result<u32> {
        self.add_packed_stream_with(dict, data, &|| false)
    }

    /// Als [`PdfFile::add_packed_stream`], af te breken tussen twee blokken
    /// (fout van soort `Interrupted`).
    pub fn add_packed_stream_with(
        &mut self,
        dict: Vec<(String, Obj)>,
        data: &[u8],
        cancelled: &dyn Fn() -> bool,
    ) -> io::Result<u32> {
        let packed = pack(data, cancelled)?;
        Ok(self.push_stream(dict, (packed, true)))
    }

    /// Een stream waarvan de bytes al met Flate zijn ingepakt (een beeld dat
    /// bij het lezen meteen is ingepakt): ze gaan ongewijzigd mee.
    pub fn add_flate_stream(&mut self, dict: Vec<(String, Obj)>, packed: Vec<u8>) -> u32 {
        self.push_stream(dict, (packed, true))
    }

    /// Zet een stream neer; `packed` zegt of de bytes met Flate zijn ingepakt.
    fn push_stream(&mut self, mut dict: Vec<(String, Obj)>, (data, packed): (Vec<u8>, bool)) -> u32 {
        if packed {
            dict.push(("Filter".into(), Obj::name("FlateDecode")));
        }
        dict.push(("Length".into(), Obj::Int(data.len() as i64)));
        self.objects.push(Some(Body::Stream { dict, data }));
        self.objects.len() as u32
    }

    /// Voegt een stream toe; `compress` pakt de gegevens in met Flate. Lukt
    /// het inpakken niet, dan gaan de (al aanwezige) bytes onverpakt mee.
    pub fn add_stream(&mut self, dict: Vec<(String, Obj)>, data: Vec<u8>, compress: bool) -> u32 {
        let packed = if compress && data.len() > 64 { pack(&data, &|| false).ok() } else { None };
        self.push_stream(dict, packed.map_or_else(|| (data, false), |p| (p, true)))
    }

    /// Als [`PdfFile::add_stream`], af te breken tussen twee blokken van het
    /// inpakken (fout van soort `Interrupted`).
    pub fn add_stream_with(
        &mut self,
        dict: Vec<(String, Obj)>,
        data: Vec<u8>,
        compress: bool,
        cancelled: &dyn Fn() -> bool,
    ) -> io::Result<u32> {
        let packed = if compress && data.len() > 64 {
            match pack(&data, cancelled) {
                Ok(packed) => Some(packed),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => return Err(error),
                // Geen geheugen voor de ingepakte kopie: de bytes die er al
                // zijn gaan onverpakt mee.
                Err(_) => None,
            }
        } else {
            None
        };
        Ok(self.push_stream(dict, packed.map_or_else(|| (data, false), |p| (p, true))))
    }

    /// Schrijft het bestand. `root` is de catalogus, `info` het
    /// documentinformatiewoordenboek.
    pub fn write_to<W: Write>(&self, w: &mut W, root: u32, info: Option<u32>) -> io::Result<()> {
        self.write_to_with(w, root, info, &|| false)
    }

    /// Als [`PdfFile::write_to`], af te breken per object en binnen een grote
    /// stream per blok (fout van soort `Interrupted`).
    pub fn write_to_with<W: Write>(&self, w: &mut W, root: u32, info: Option<u32>, cancelled: &dyn Fn() -> bool) -> io::Result<()> {
        let mut offsets = Vec::with_capacity(self.objects.len());
        let mut pos: u64 = 0;
        let header = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
        w.write_all(header)?;
        pos += header.len() as u64;
        let mut buf = Vec::with_capacity(4096);
        for (i, body) in self.objects.iter().enumerate() {
            offsets.push(pos);
            buf.clear();
            buf.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            match body {
                Some(Body::Plain(obj)) => write_obj(&mut buf, obj),
                Some(Body::Stream { dict, data }) => {
                    write_obj(&mut buf, &Obj::Dict(dict.clone()));
                    buf.extend_from_slice(b"\nstream\n");
                    w.write_all(&buf)?;
                    pos += buf.len() as u64;
                    for block in data.chunks(WRITE_BLOCK) {
                        if cancelled() {
                            return Err(interrupted());
                        }
                        w.write_all(block)?;
                    }
                    pos += data.len() as u64;
                    buf.clear();
                    buf.extend_from_slice(b"\nendstream");
                }
                None => buf.extend_from_slice(b"null"),
            }
            buf.extend_from_slice(b"\nendobj\n");
            w.write_all(&buf)?;
            pos += buf.len() as u64;
        }
        let xref_pos = pos;
        let mut tail = Vec::with_capacity(20 * (offsets.len() + 1) + 128);
        tail.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
        for off in &offsets {
            tail.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
        }
        let mut trailer = vec![("Size".to_string(), Obj::Int(offsets.len() as i64 + 1)), ("Root".to_string(), Obj::Ref(root))];
        if let Some(info) = info {
            trailer.push(("Info".to_string(), Obj::Ref(info)));
        }
        tail.extend_from_slice(b"trailer\n");
        write_obj(&mut tail, &Obj::Dict(trailer));
        tail.extend_from_slice(format!("\nstartxref\n{xref_pos}\n%%EOF\n").as_bytes());
        w.write_all(&tail)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coord(v: f64) -> String {
        let mut out = Vec::new();
        write_coord(&mut out, v);
        String::from_utf8(out).unwrap()
    }

    fn real(v: f64) -> String {
        let mut out = Vec::new();
        write_real(&mut out, v);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn coordinates_are_short_and_exact_to_a_thousandth() {
        assert_eq!(coord(0.0), "0");
        assert_eq!(coord(12.5), "12.5");
        assert_eq!(coord(-3.14159), "-3.142");
        assert_eq!(coord(0.0004), "0");
        assert_eq!(coord(-0.0004), "0");
        assert_eq!(coord(1190.55), "1190.55");
        assert_eq!(coord(0.001), "0.001");
        assert_eq!(coord(99.9996), "100");
    }

    #[test]
    fn reals_keep_large_national_coordinates() {
        assert_eq!(real(155000000.125), "155000000.125");
        assert_eq!(real(-0.0), "0");
        assert_eq!(real(35.277777777777), "35.2777777778");
        assert_eq!(real(2.0), "2");
        // Kleine meetschalen (meters per punt) houden twaalf cijfers.
        assert_eq!(real(0.000352777777777778), "0.000352777777778");
        assert_eq!(real(-12345678.123456789), "-12345678.1235");
    }

    #[test]
    fn strings_and_names_are_escaped() {
        let mut out = Vec::new();
        write_literal(&mut out, b"a(b)c\\d\x01");
        assert_eq!(out, b"(a\\(b\\)c\\\\d\\001)");
        let mut out = Vec::new();
        write_name(&mut out, "Laag 1#");
        assert_eq!(out, b"/Laag#201#23");
        assert_eq!(text_bytes("Wand"), b"Wand");
        assert_eq!(text_bytes("Wände")[..4], [0xFE, 0xFF, 0x00, b'W']);
    }

    /// Inhoud die zich niet tot niets laat inpakken, zoals een echte tekening.
    fn noisy(len: usize) -> Vec<u8> {
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        (0..len)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                b"0123456789. lmchS\n"[(state % 18) as usize]
            })
            .collect()
    }

    #[test]
    fn packing_a_large_stream_can_be_cancelled_between_blocks() {
        let data = noisy(5 * PACK_BLOCK + 123);
        let polls = std::cell::Cell::new(0usize);
        let cancelled = || {
            polls.set(polls.get() + 1);
            polls.get() > 2
        };
        let mut pdf = PdfFile::new();
        let error = pdf.add_stream_with(Vec::new(), data.clone(), true, &cancelled).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(polls.get(), 3, "gestopt bij het derde blok, niet pas na de hele stroom");
        assert!(pdf.add_packed_stream_with(Vec::new(), &data, &|| true).is_err());

        // In blokken inpakken geeft byte voor byte hetzelfde als in één keer.
        let mut whole = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        whole.write_all(&data).unwrap();
        let whole = whole.finish().unwrap();
        let mut pdf = PdfFile::new();
        let id = pdf.add_stream_with(Vec::new(), data, true, &|| false).unwrap();
        match &pdf.objects[id as usize - 1] {
            Some(Body::Stream { data, .. }) => assert!(*data == whole, "de blokken veranderen de uitvoer niet"),
            _ => panic!("geen stream"),
        }
    }

    #[test]
    fn packing_piece_by_piece_gives_the_same_bytes_and_keeps_to_its_limit() {
        let data = noisy(300_000);
        let whole = pack(&data, &|| false).unwrap();
        // In regels van 37 bytes, zoals een beeld regel voor regel.
        let mut packer = Packer::new(None);
        for row in data.chunks(37) {
            packer.write(row).unwrap();
        }
        assert!(packer.finish().unwrap() == whole, "de stukgrootte verandert de uitvoer niet");

        // Met een bovengrens stopt het inpakken zodra de uitvoer die haalt.
        let mut packer = Packer::new(Some(1000));
        let stopped = data.chunks(37).any(|row| packer.write(row).is_err());
        assert!(stopped);
        // Ruim genoeg: de grens speelt niet mee.
        let mut packer = Packer::new(Some(whole.len() as u64));
        for row in data.chunks(37) {
            packer.write(row).unwrap();
        }
        assert!(packer.finish().unwrap() == whole);
    }

    #[test]
    fn a_buffer_that_cannot_grow_is_an_error_not_an_abort() {
        let mut buffer: Vec<u8> = Vec::new();
        let error = reserve(&mut buffer, usize::MAX).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::OutOfMemory);
        assert!(reserve(&mut buffer, 16).is_ok());
        // Een stream vanuit geleende bytes meldt zijn fout in plaats van de
        // bytes stil onverpakt te kopiëren.
        let mut pdf = PdfFile::new();
        assert!(pdf.add_packed_stream(Vec::new(), &noisy(1000)).is_ok());
        // Al ingepakte bytes gaan ongewijzigd mee, met het juiste filter.
        let packed = pack(b"abc", &|| false).unwrap();
        let id = pdf.add_flate_stream(Vec::new(), packed.clone());
        match &pdf.objects[id as usize - 1] {
            Some(Body::Stream { dict, data }) => {
                assert!(*data == packed);
                assert!(dict.iter().any(|(k, v)| k == "Filter" && *v == Obj::name("FlateDecode")));
            }
            _ => panic!("geen stream"),
        }
    }

    #[test]
    fn writing_a_large_stream_can_be_cancelled_between_blocks() {
        let mut pdf = PdfFile::new();
        let catalog = pdf.add(Obj::dict(vec![("Type", Obj::name("Catalog"))]));
        pdf.add_stream(Vec::new(), noisy(3 * WRITE_BLOCK + 5), false);
        let polls = std::cell::Cell::new(0usize);
        let cancelled = || {
            polls.set(polls.get() + 1);
            polls.get() > 2
        };
        let mut out = Vec::new();
        let error = pdf.write_to_with(&mut out, catalog, None, &cancelled).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(out.len() < 3 * WRITE_BLOCK, "het schrijven stopte halverwege de stroom: {} bytes", out.len());
        // Zonder afbreken is het bestand hetzelfde als met `write_to`.
        let (mut a, mut b) = (Vec::new(), Vec::new());
        pdf.write_to(&mut a, catalog, None).unwrap();
        pdf.write_to_with(&mut b, catalog, None, &|| false).unwrap();
        assert!(a == b);
    }

    #[test]
    fn a_written_file_has_a_valid_xref() {
        let mut pdf = PdfFile::new();
        let catalog = pdf.reserve();
        let pages = pdf.add(Obj::dict(vec![("Type", Obj::name("Pages")), ("Count", Obj::Int(0)), ("Kids", Obj::Array(vec![]))]));
        pdf.set(catalog, Obj::dict(vec![("Type", Obj::name("Catalog")), ("Pages", Obj::Ref(pages))]));
        let mut out = Vec::new();
        pdf.write_to(&mut out, catalog, None).unwrap();
        let text = String::from_utf8_lossy(&out).to_string();
        let startxref: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        // Byte-posities, niet tekenposities: de kop bevat binaire bytes.
        assert!(out[startxref..].starts_with(b"xref\n0 3\n"));
        let second = out.windows(7).position(|w| w == b"2 0 obj").unwrap();
        assert!(text.contains(&format!("{second:010} 00000 n")));
    }
}
