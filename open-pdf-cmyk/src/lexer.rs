//! Tokens van een inhoudsstroom, met hun bytepositie.
//!
//! Genoeg PDF-syntaxis om operatoren en hun operanden betrouwbaar te vinden:
//! strings (genest, met escapes), hex-strings, namen met `#xx`, getallen,
//! arrays, woordenboeken en commentaar. De bytes zelf worden nooit
//! herschreven; wie iets wil vervangen gebruikt `start..end`.

use lopdf::{Dictionary, Object, StringFormat};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Kind {
    /// Getal; NaN als het er wel als getal uitziet maar niet te lezen is.
    Number(f32),
    Name,
    Str,
    HexStr,
    ArrOpen,
    ArrClose,
    DictOpen,
    DictClose,
    /// `{` of `}` (alleen in PostScript-functies; hier nooit een operator).
    Brace,
    /// Operator of sleutelwoord (`true`, `false`, `null`).
    Word,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Tok {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
}

pub(crate) fn is_ws(b: u8) -> bool {
    matches!(b, 0 | 9 | 10 | 12 | 13 | 32)
}

pub(crate) fn is_delim(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

pub(crate) struct Lexer<'a> {
    pub data: &'a [u8],
    pub pos: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Lexer { data, pos: 0 }
    }

    fn skip_space(&mut self) {
        let d = self.data;
        while self.pos < d.len() {
            if is_ws(d[self.pos]) {
                self.pos += 1;
            } else if d[self.pos] == b'%' {
                while self.pos < d.len() && d[self.pos] != b'\n' && d[self.pos] != b'\r' {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    fn regular_run(&mut self) {
        let d = self.data;
        while self.pos < d.len() && !is_ws(d[self.pos]) && !is_delim(d[self.pos]) {
            self.pos += 1;
        }
    }

    pub fn next_tok(&mut self) -> Option<Tok> {
        self.skip_space();
        let d = self.data;
        let start = self.pos;
        let c = *d.get(start)?;
        let kind = match c {
            b'(' => {
                let mut depth = 1usize;
                self.pos += 1;
                while self.pos < d.len() && depth > 0 {
                    match d[self.pos] {
                        b'\\' => self.pos += 2,
                        b'(' => {
                            depth += 1;
                            self.pos += 1
                        }
                        b')' => {
                            depth -= 1;
                            self.pos += 1
                        }
                        _ => self.pos += 1,
                    }
                }
                self.pos = self.pos.min(d.len());
                Kind::Str
            }
            b'<' if d.get(start + 1) == Some(&b'<') => {
                self.pos += 2;
                Kind::DictOpen
            }
            b'<' => {
                self.pos += 1;
                while self.pos < d.len() && d[self.pos] != b'>' {
                    self.pos += 1;
                }
                self.pos = (self.pos + 1).min(d.len());
                Kind::HexStr
            }
            b'>' if d.get(start + 1) == Some(&b'>') => {
                self.pos += 2;
                Kind::DictClose
            }
            b'[' => {
                self.pos += 1;
                Kind::ArrOpen
            }
            b']' => {
                self.pos += 1;
                Kind::ArrClose
            }
            b'{' | b'}' => {
                self.pos += 1;
                Kind::Brace
            }
            b'/' => {
                self.pos += 1;
                self.regular_run();
                Kind::Name
            }
            // Losse `)` of `>`: onzin, maar nooit vastlopen.
            b')' | b'>' => {
                self.pos += 1;
                Kind::Word
            }
            _ => {
                self.regular_run();
                let word = &d[start..self.pos];
                if word.iter().all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.')) {
                    Kind::Number(parse_number(word))
                } else {
                    Kind::Word
                }
            }
        };
        Some(Tok { kind, start, end: self.pos })
    }
}

fn parse_number(word: &[u8]) -> f32 {
    std::str::from_utf8(word).ok().and_then(|s| s.parse::<f32>().ok()).unwrap_or(f32::NAN)
}

/// Naam zonder `/`, met `#xx` gedecodeerd.
pub(crate) fn name_bytes(raw: &[u8]) -> Vec<u8> {
    let raw = raw.strip_prefix(b"/").unwrap_or(raw);
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'#' && i + 2 < raw.len() {
            if let Some(v) = hex_pair(raw[i + 1], raw[i + 2]) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(raw[i]);
        i += 1;
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn hex_pair(a: u8, b: u8) -> Option<u8> {
    Some(hex_val(a)? * 16 + hex_val(b)?)
}

/// Inhoud van een hex-string `<…>`; een oneven laatste cijfer telt als `x0`.
pub(crate) fn hex_string(raw: &[u8]) -> Vec<u8> {
    let digits: Vec<u8> = raw.iter().copied().filter_map(hex_val).collect();
    digits.chunks(2).map(|p| p[0] * 16 + p.get(1).copied().unwrap_or(0)).collect()
}

/// Inhoud van een letterlijke string `(…)` met alle escapes.
pub(crate) fn literal_string(raw: &[u8]) -> Vec<u8> {
    let inner = raw.strip_prefix(b"(").unwrap_or(raw);
    let inner = inner.strip_suffix(b")").unwrap_or(inner);
    let mut out = Vec::with_capacity(inner.len());
    let mut i = 0;
    while i < inner.len() {
        let c = inner[i];
        if c != b'\\' {
            // Een regeleinde in de string zelf is altijd \n.
            if c == b'\r' {
                out.push(b'\n');
                if inner.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
            } else {
                out.push(c);
            }
            i += 1;
            continue;
        }
        i += 1;
        let Some(&e) = inner.get(i) else { break };
        match e {
            b'n' => out.push(b'\n'),
            b'r' => out.push(b'\r'),
            b't' => out.push(b'\t'),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'0'..=b'7' => {
                let mut v: u32 = 0;
                let mut n = 0;
                while n < 3 && i < inner.len() && (b'0'..=b'7').contains(&inner[i]) {
                    v = v * 8 + (inner[i] - b'0') as u32;
                    i += 1;
                    n += 1;
                }
                out.push(v as u8);
                continue;
            }
            // Regelvoortzetting: backslash plus regeleinde telt niet.
            b'\r' => {
                if inner.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
            }
            b'\n' => {}
            other => out.push(other),
        }
        i += 1;
    }
    out
}

/// Eén object uit een reeks tokens (voor het woordenboek van een ingebedde
/// afbeelding). `None` bij een token dat geen object begint.
pub(crate) fn parse_object(data: &[u8], toks: &[Tok], i: &mut usize) -> Option<Object> {
    let t = *toks.get(*i)?;
    *i += 1;
    let raw = &data[t.start..t.end];
    Some(match t.kind {
        Kind::Number(v) => {
            if raw.contains(&b'.') {
                Object::Real(v)
            } else {
                let n = std::str::from_utf8(raw).ok().and_then(|s| s.parse::<i64>().ok())?;
                // `<nr> <gen> R`: een verwijzing (komt voor in woordenboeken
                // van xref-stromen, nooit bij ingebedde afbeeldingen).
                let gen = toks.get(*i).filter(|t| matches!(t.kind, Kind::Number(_)));
                let r = toks.get(*i + 1).filter(|t| t.kind == Kind::Word && &data[t.start..t.end] == b"R");
                match (gen, r) {
                    (Some(g), Some(_)) if n >= 0 => {
                        let gen = std::str::from_utf8(&data[g.start..g.end]).ok().and_then(|s| s.parse::<u16>().ok())?;
                        *i += 2;
                        Object::Reference((n as u32, gen))
                    }
                    _ => Object::Integer(n),
                }
            }
        }
        Kind::Name => Object::Name(name_bytes(raw)),
        Kind::Str => Object::String(literal_string(raw), StringFormat::Literal),
        Kind::HexStr => {
            let inner = raw.strip_prefix(b"<").unwrap_or(raw);
            Object::String(hex_string(inner.strip_suffix(b">").unwrap_or(inner)), StringFormat::Hexadecimal)
        }
        Kind::ArrOpen => {
            let mut items = Vec::new();
            while let Some(next) = toks.get(*i) {
                if next.kind == Kind::ArrClose {
                    *i += 1;
                    break;
                }
                items.push(parse_object(data, toks, i)?);
            }
            Object::Array(items)
        }
        Kind::DictOpen => {
            let mut dict = Dictionary::new();
            while let Some(next) = toks.get(*i) {
                if next.kind == Kind::DictClose {
                    *i += 1;
                    break;
                }
                let Object::Name(key) = parse_object(data, toks, i)? else { return None };
                let value = parse_object(data, toks, i)?;
                dict.set(key, value);
            }
            Object::Dictionary(dict)
        }
        Kind::Word => match raw {
            b"true" => Object::Boolean(true),
            b"false" => Object::Boolean(false),
            b"null" => Object::Null,
            _ => return None,
        },
        Kind::ArrClose | Kind::DictClose | Kind::Brace => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_string_escapes() {
        assert_eq!(literal_string(br"(a\(b\)\\\101\n\
c)"), b"a(b)\\A\nc");
    }

    #[test]
    fn hex_string_with_odd_digit_count() {
        assert_eq!(hex_string(b"4 1F a"), vec![0x41, 0xFA]);
    }

    #[test]
    fn indirect_references_are_parsed() {
        let src = b"<< /Root 1 0 R /Kids [3 0 R 4 0 R] /Size 8 /W [1 3 2] >>";
        let mut lx = Lexer::new(src);
        let mut toks = Vec::new();
        while let Some(t) = lx.next_tok() {
            toks.push(t);
        }
        let Some(Object::Dictionary(d)) = parse_object(src, &toks, &mut 0) else { panic!("geen woordenboek") };
        assert_eq!(d.get(b"Root").unwrap(), &Object::Reference((1, 0)));
        assert_eq!(d.get(b"Kids").unwrap().as_array().unwrap(), &vec![Object::Reference((3, 0)), Object::Reference((4, 0))]);
        assert_eq!(d.get(b"Size").unwrap(), &Object::Integer(8));
        assert_eq!(d.get(b"W").unwrap().as_array().unwrap().len(), 3);
    }

    #[test]
    fn names_decode_hex_escapes_only_when_valid() {
        assert_eq!(name_bytes(b"/A#20B"), b"A B");
        assert_eq!(name_bytes(b"/A#zzB"), b"A#zzB");
        assert_eq!(name_bytes(b"/A#2"), b"A#2");
    }
}
