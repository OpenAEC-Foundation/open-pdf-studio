//! Voorscan op nestdiepte, vóór de PDF-bibliotheek een byte leest (#400).
//!
//! De bibliotheek die de opbouw van een bestand leest, leest arrays en
//! woordenboeken recursief en kent daarbij geen grens. Een bestand met
//! honderdduizend keer `[` kost dan de stapel van de draad, en dat is geen
//! paniek die te vangen is: het proces stopt. Deze scan loopt daarom eerst één
//! keer lineair door de bytes en weigert elke plek waar een lezing dieper dan
//! [`MAX_NESTING`] zou nesten.
//!
//! Tekst (met escapes en geneste haakjes), hex-tekst, namen, commentaar en de
//! inhoud van stromen tellen niet mee. De bibliotheek begint echter niet alleen
//! vooraan: een kruisverwijzing mag naar elke plek wijzen, ook midden in een
//! tekst of een stroom. Op elke objectkop `N G obj` die haar lezer zou
//! aannemen, op elke `xref` en op elk opgegeven beginpunt start daarom een
//! extra lezing. Lezingen in dezelfde toestand vallen samen op de grootste
//! diepte; de uitkomst is dus een bovengrens, en het werk blijft lineair.
//!
//! Dezelfde scan bewaakt het lezen van handtekeningen in de app.

use std::sync::atomic::{AtomicBool, Ordering};

/// Hoogste nestdiepte van arrays en woordenboeken die de bibliotheek te lezen
/// krijgt. Een echte PDF komt niet boven de tien.
pub(crate) const MAX_NESTING: usize = 64;
/// Grens van de bibliotheek voor geneste haakjes in een tekst; dieper faalt
/// haar lezing, dus daar hoeft de scan niet verder.
const MAX_PARENS: usize = 100;
/// Om de zoveel bytes kijkt de scan of de gebruiker heeft afgebroken.
const CANCEL_EVERY: usize = 1 << 20;

/// Uitkomst van de scan.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Nesting {
    Fine,
    TooDeep,
    Cancelled,
}

fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\n' | b'\r' | b'\t' | b'\x0c' | b'\0')
}

fn is_delimiter(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

fn is_regular(b: u8) -> bool {
    !is_space(b) && !is_delimiter(b)
}

/// Posities van `obj` in elke objectkop die de lezer van de bibliotheek vanaf
/// een willekeurige plek aanneemt: `N S G S? obj`, met `S` één of meer
/// witruimtetekens of commentaren. Geen eisen aan wat vóór `N` of ná `obj`
/// staat, en `N` mag midden in een getal beginnen. Lineair, als verzameling
/// toestanden.
fn header_positions(bytes: &[u8]) -> Vec<usize> {
    const NUMBER1: u8 = 1;
    /// Scheiding na het eerste getal; daarna mag het tweede getal.
    const GAP: u8 = 2;
    const COMMENT1: u8 = 4;
    const NUMBER2: u8 = 8;
    /// Witruimte na het tweede getal.
    const AFTER_NUMBER2: u8 = 16;
    const COMMENT2: u8 = 32;
    const O: u8 = 64;
    const OB: u8 = 128;
    let mut out = Vec::new();
    let mut state = 0u8;
    for (p, &b) in bytes.iter().enumerate() {
        let mut next = 0u8;
        let line_end = b == b'\r' || b == b'\n';
        if state & COMMENT1 != 0 {
            next |= if line_end { GAP } else { COMMENT1 };
        }
        if state & COMMENT2 != 0 {
            next |= if line_end { AFTER_NUMBER2 } else { COMMENT2 };
        }
        if b.is_ascii_digit() {
            next |= NUMBER1;
            if state & (GAP | NUMBER2) != 0 {
                next |= NUMBER2;
            }
        } else if is_space(b) {
            if state & (NUMBER1 | GAP) != 0 {
                next |= GAP;
            }
            if state & (NUMBER2 | AFTER_NUMBER2) != 0 {
                next |= AFTER_NUMBER2;
            }
        } else if b == b'%' {
            if state & (NUMBER1 | GAP) != 0 {
                next |= COMMENT1;
            }
            if state & (NUMBER2 | AFTER_NUMBER2) != 0 {
                next |= COMMENT2;
            }
        } else if b == b'o' && state & (NUMBER2 | AFTER_NUMBER2) != 0 {
            next |= O;
        } else if b == b'b' && state & O != 0 {
            next |= OB;
        } else if b == b'j' && state & OB != 0 {
            out.push(p.saturating_sub(2));
        }
        state = next;
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Mode {
    Normal,
    Name,
    /// Binnen een tekst, met het aantal open haakjes.
    Text(usize),
    Hex,
    Comment,
    Stream,
}

/// Eén mogelijke lezing: hoe de bibliotheek de bytes ziet vanaf een beginpunt.
#[derive(Clone, Copy, Debug)]
struct Reading {
    mode: Mode,
    depth: usize,
    /// Zoveel volgende bytes horen nog bij het huidige teken of woord.
    skip: usize,
}

/// Kan een lezing ergens in `bytes` dieper dan [`MAX_NESTING`] nesten?
/// `starts` zijn extra plekken waar een lezing kan beginnen (de posities uit de
/// index van een objectstroom).
pub(crate) fn scan(bytes: &[u8], starts: &[usize], cancel: Option<&AtomicBool>) -> Nesting {
    let mut readings = vec![Reading { mode: Mode::Normal, depth: 0, skip: 0 }];
    let mut points = header_positions(bytes);
    points.extend_from_slice(starts);
    points.sort_unstable();
    points.dedup();
    let mut points = points.into_iter().peekable();
    let mut p = 0;
    let mut next_cancel_check = CANCEL_EVERY;
    while let Some(&b) = bytes.get(p) {
        if p >= next_cancel_check {
            next_cancel_check = p.saturating_add(CANCEL_EVERY);
            if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Nesting::Cancelled;
            }
        }
        // Alleen de inhoud van een stroom: door naar het eerstvolgende byte
        // dat ertoe doet (`endstream`, `xref` of een beginpunt).
        if let [Reading { mode: Mode::Stream, skip: 0, .. }] = readings.as_slice() {
            let limit = points.peek().copied().unwrap_or(usize::MAX).min(next_cancel_check);
            let mut q = p;
            while q < limit {
                let matters = match bytes.get(q) {
                    None => true,
                    Some(b'e') => bytes.get(q..).is_some_and(|r| r.starts_with(b"endstream")),
                    Some(b'x') => bytes.get(q..).is_some_and(|r| r.starts_with(b"xref")),
                    Some(_) => false,
                };
                if matters {
                    break;
                }
                q += 1;
            }
            if q > p {
                p = q;
                continue;
            }
        }
        let mut fresh = false;
        while points.next_if(|&s| s <= p).is_some() {
            fresh = true;
        }
        if b == b'x' && bytes.get(p..).is_some_and(|r| r.starts_with(b"xref")) {
            fresh = true;
        }
        if fresh {
            readings.push(Reading { mode: Mode::Normal, depth: 0, skip: 0 });
        }
        readings.retain_mut(|reading| step(reading, bytes, p, b));
        if readings.iter().any(|reading| reading.depth > MAX_NESTING) {
            return Nesting::TooDeep;
        }
        if readings.len() > 1 {
            readings.sort_by(|x, y| (x.mode, x.skip, y.depth).cmp(&(y.mode, y.skip, x.depth)));
            readings.dedup_by(|x, y| x.mode == y.mode && x.skip == y.skip);
        }
        p += 1;
    }
    Nesting::Fine
}

/// Verwerkt byte `b` op positie `p`; `false` als de lezing daar stopt.
fn step(reading: &mut Reading, bytes: &[u8], p: usize, b: u8) -> bool {
    if reading.skip > 0 {
        reading.skip -= 1;
        return true;
    }
    match reading.mode {
        Mode::Normal => normal(reading, bytes, p, b),
        Mode::Name if is_regular(b) => {}
        Mode::Name => {
            reading.mode = Mode::Normal;
            normal(reading, bytes, p, b);
        }
        Mode::Text(open) => match b {
            b'\\' => reading.skip = 1,
            b'(' if open > MAX_PARENS => return false,
            b'(' => reading.mode = Mode::Text(open + 1),
            b')' if open <= 1 => reading.mode = Mode::Normal,
            b')' => reading.mode = Mode::Text(open - 1),
            _ => {}
        },
        Mode::Hex => {
            if b == b'>' {
                reading.mode = Mode::Normal;
            }
        }
        Mode::Comment => {
            if b == b'\r' || b == b'\n' {
                reading.mode = Mode::Normal;
            }
        }
        Mode::Stream => {
            if b == b'e' && word_at(bytes, p) == Some(b"endstream".as_slice()) {
                reading.mode = Mode::Normal;
                reading.skip = b"endstream".len() - 1;
            }
        }
    }
    true
}

/// Het woord (reeks gewone tekens) dat op `p` begint, als het daar begint.
fn word_at(bytes: &[u8], p: usize) -> Option<&[u8]> {
    if p.checked_sub(1).and_then(|q| bytes.get(q)).is_some_and(|&before| is_regular(before)) {
        return None;
    }
    let rest = bytes.get(p..)?;
    let length = rest.iter().take_while(|&&x| is_regular(x)).count();
    rest.get(..length).filter(|word| !word.is_empty())
}

fn normal(reading: &mut Reading, bytes: &[u8], p: usize, b: u8) {
    let following = bytes.get(p + 1).copied();
    match b {
        b'%' => reading.mode = Mode::Comment,
        b'(' => reading.mode = Mode::Text(1),
        b'/' => reading.mode = Mode::Name,
        b'[' => reading.depth += 1,
        b']' => reading.depth = reading.depth.saturating_sub(1),
        b'<' if following == Some(b'<') => {
            reading.depth += 1;
            reading.skip = 1;
        }
        b'<' => reading.mode = Mode::Hex,
        b'>' if following == Some(b'>') => {
            reading.depth = reading.depth.saturating_sub(1);
            reading.skip = 1;
        }
        _ => {
            if let Some(word) = word_at(bytes, p) {
                match word {
                    // Hier stopt elke lezing die al bezig was.
                    b"obj" | b"endobj" | b"xref" | b"trailer" | b"startxref" => reading.depth = 0,
                    b"stream" => reading.mode = Mode::Stream,
                    _ => {}
                }
                reading.skip = word.len() - 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deep(bytes: &[u8]) -> bool {
        scan(bytes, &[], None) == Nesting::TooDeep
    }

    #[test]
    fn nesting_counts_outside_text_comments_names_and_streams() {
        let open = "[".repeat(MAX_NESTING);
        assert!(!deep(open.as_bytes()), "tot en met de grens");
        assert!(deep(format!("{open}[").as_bytes()));
        assert!(deep("<<".repeat(MAX_NESTING + 1).as_bytes()));
        assert!(deep("[<<".repeat(MAX_NESTING / 2 + 1).as_bytes()));
        // Wat weer dichtgaat, telt niet op.
        assert!(!deep("[[]]".repeat(10_000).as_bytes()));
        assert!(!deep("<< /A [ ] >> ".repeat(10_000).as_bytes()));
        let many = "[".repeat(10_000);
        assert!(!deep(format!("({many})").as_bytes()));
        assert!(!deep(format!("(\\) {many})").as_bytes()));
        assert!(!deep(format!("% {many}\n[ ]").as_bytes()));
        assert!(!deep(format!("1 0 obj << /Length 9 >> stream\n{many}\nendstream endobj").as_bytes()));
        // Na het commentaar, de tekst of de stroom telt het weer wel.
        assert!(deep(format!("% x\n{many}").as_bytes()));
        assert!(deep(format!("(x){many}").as_bytes()));
        assert!(deep(format!("1 0 obj << >> stream\nx\nendstream endobj 2 0 obj {many}").as_bytes()));
    }

    #[test]
    fn a_reading_can_start_at_an_object_header_inside_text_or_a_stream() {
        let many = "[".repeat(MAX_NESTING + 1);
        // Een kruisverwijzing mag naar deze kop wijzen, al staat hij in een tekst.
        assert!(deep(format!("(verstopt 7 0 obj {many})").as_bytes()));
        assert!(deep(format!("1 0 obj << >> stream\n7 0 obj {many}\nendstream endobj").as_bytes()));
        assert!(deep(format!("1 0 obj << >> stream\nxref {many}\nendstream endobj").as_bytes()));
        // Zonder kop is het gewoon inhoud.
        assert!(!deep(format!("1 0 obj << >> stream\n7 0 {many}\nendstream endobj").as_bytes()));
        // Een opgegeven beginpunt (index van een objectstroom) telt ook.
        let packed = format!("({many})");
        assert_eq!(scan(packed.as_bytes(), &[], None), Nesting::Fine);
        assert_eq!(scan(packed.as_bytes(), &[1], None), Nesting::TooDeep);
    }

    /// Meetrit, niet in de gewone testronde: loopt alle PDF's in de map van
    /// `OPDS_PDF_SWEEP_DIR` na (alleen lezen) en faalt als een echt bestand
    /// voor te diep genest wordt aangezien.
    /// `OPDS_PDF_SWEEP_DIR=<map> cargo test -p open-pdf-cad --lib -- --ignored real_files`
    #[test]
    #[ignore]
    fn real_files_are_never_too_deep() {
        let Ok(dir) = std::env::var("OPDS_PDF_SWEEP_DIR") else { return };
        let mut stack = vec![std::path::PathBuf::from(dir)];
        let (mut files, mut bytes, mut deep) = (0u32, 0u64, Vec::new());
        let started = std::time::Instant::now();
        while let Some(next) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&next) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
                    let Ok(data) = std::fs::read(&path) else { continue };
                    files += 1;
                    bytes += data.len() as u64;
                    if scan(&data, &[], None) == Nesting::TooDeep {
                        deep.push(files);
                    }
                }
            }
        }
        eprintln!("{files} bestanden, {} MB, {:?}; te diep: {}", bytes >> 20, started.elapsed(), deep.len());
        assert!(deep.is_empty(), "bestanden nummer {deep:?} (in leesvolgorde) zijn te diep bevonden");
    }

    #[test]
    fn a_cancelled_scan_stops() {
        let flag = AtomicBool::new(true);
        let big = vec![b' '; 3 * CANCEL_EVERY];
        assert_eq!(scan(&big, &[], Some(&flag)), Nesting::Cancelled);
        assert_eq!(scan(&big, &[], None), Nesting::Fine);
        // Ook midden in de inhoud van een stroom.
        let mut stream = b"1 0 obj << >> stream\n".to_vec();
        stream.extend(std::iter::repeat(0xAB).take(3 * CANCEL_EVERY));
        assert_eq!(scan(&stream, &[], Some(&flag)), Nesting::Cancelled);
    }
}
