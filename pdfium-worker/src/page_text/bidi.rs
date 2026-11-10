//! De bidi-stap van pdf.js (src/core/bidi.js), regel voor regel: pdf.js
//! draait hem over de tekst van elk tekstitem en de zoekfunctie van de app
//! zoekt in die uitkomst. Werkt zoals JavaScript op UTF-16-code-eenheden.
//!
//! Naast de tekst geeft de port de herschikking terug (`volgorde[i]` = de
//! oorspronkelijke positie van teken i), zodat de tekenvakken mee kunnen.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum T {
    L,
    R,
    AL,
    EN,
    ES,
    ET,
    AN,
    CS,
    NSM,
    BN,
    B,
    S,
    WS,
    ON,
    /// Lege soort in de Arabische tabel van pdf.js (U+061D).
    Leeg,
}

use T::*;

const BASIS: [T; 256] = [
    BN, BN, BN, BN, BN, BN, BN, BN, BN, S, B, S, WS, B, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, B, B, B, S, WS, ON, ON, ET, ET, ET, ON, ON, ON, ON, ON, ES, CS, ES, CS, CS, EN, EN, EN, EN, EN, EN, EN, EN, EN, EN, CS, ON, ON, ON, ON, ON, ON, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, ON, ON, ON, ON, ON, ON, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, ON, ON, ON, ON, BN, BN, BN, BN, BN, BN, B, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, BN, CS, ON, ET, ET, ET, ET, ON, ON, ON, ON, L, ON, ON, BN, ON, ON, ET, ET, EN, EN, ON, L, ON, ON, ON, EN, L, ON, ON, ON, ON, ON, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, ON, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, ON, L, L, L, L, L, L, L, L,
];

const ARABISCH: [T; 256] = [
    AN, AN, AN, AN, AN, AN, ON, ON, AL, ET, ET, AL, CS, AL, ON, ON, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, AL, AL, Leeg, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, NSM, AN, AN, AN, AN, AN, AN, AN, AN, AN, AN, ET, AN, AN, AL, AL, AL, NSM, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, AL, NSM, NSM, NSM, NSM, NSM, NSM, NSM, AN, ON, NSM, NSM, NSM, NSM, NSM, NSM, AL, AL, NSM, NSM, ON, NSM, NSM, NSM, NSM, AL, AL, EN, EN, EN, EN, EN, EN, EN, EN, EN, EN, AL, AL, AL, AL, AL, AL,
];

/// Uitkomst van `bidi`: tekst, richting (true = rechts naar links) en de
/// herkomst van elke code-eenheid; `None` waar een '<' of '>' wegviel.
pub struct Bidi {
    pub tekst: Vec<u16>,
    pub rtl: bool,
    pub volgorde: Vec<usize>,
}

fn soort(c: u16) -> T {
    if c <= 0x00ff {
        BASIS[c as usize]
    } else if (0x0590..=0x05f4).contains(&c) {
        R
    } else if (0x0600..=0x06ff).contains(&c) {
        ARABISCH[(c & 0xff) as usize]
    } else if (0x0700..=0x08ac).contains(&c) || (0xfb50..=0xfdff).contains(&c) || (0xfe70..=0xfeff).contains(&c) {
        AL
    } else {
        L
    }
}

/// `bidi(str, -1, false)` van pdf.js (horizontale tekst).
pub fn bidi(s: &[u16]) -> Bidi {
    let n = s.len();
    let ongewijzigd = || Bidi { tekst: s.to_vec(), rtl: false, volgorde: (0..n).collect() };
    if n == 0 {
        return ongewijzigd();
    }
    let mut types: Vec<T> = s.iter().map(|&c| soort(c)).collect();
    let num_bidi = types.iter().filter(|t| matches!(t, R | AL | AN)).count();
    if num_bidi == 0 {
        return ongewijzigd();
    }
    let (is_ltr, start_level) = if (num_bidi as f64) / (n as f64) < 0.3 && n > 4 { (true, 0u32) } else { (false, 1u32) };
    let mut levels = vec![start_level; n];
    let e = if start_level & 1 == 1 { R } else { L };
    let sor = e;
    let eor = sor;

    let mut last = sor;
    for t in types.iter_mut() {
        if *t == NSM {
            *t = last;
        } else {
            last = *t;
        }
    }
    let mut last = sor;
    for t in types.iter_mut() {
        if *t == EN {
            *t = if last == AL { AN } else { EN };
        } else if matches!(*t, R | L | AL) {
            last = *t;
        }
    }
    for t in types.iter_mut() {
        if *t == AL {
            *t = R;
        }
    }
    for i in 1..n.saturating_sub(1) {
        if types[i] == ES && types[i - 1] == EN && types[i + 1] == EN {
            types[i] = EN;
        }
        if types[i] == CS && (types[i - 1] == EN || types[i - 1] == AN) && types[i + 1] == types[i - 1] {
            types[i] = types[i - 1];
        }
    }
    for i in 0..n {
        if types[i] == EN {
            let mut j = i;
            while j > 0 {
                j -= 1;
                if types[j] != ET {
                    break;
                }
                types[j] = EN;
            }
            for j in i + 1..n {
                if types[j] != ET {
                    break;
                }
                types[j] = EN;
            }
        }
    }
    for t in types.iter_mut() {
        if matches!(*t, WS | ES | ET | CS) {
            *t = ON;
        }
    }
    let mut last = sor;
    for t in types.iter_mut() {
        if *t == EN {
            *t = if last == L { L } else { EN };
        } else if matches!(*t, R | L) {
            last = *t;
        }
    }
    let mut i = 0;
    while i < n {
        if types[i] == ON {
            let mut end = i + 1;
            while end < n && types[end] == ON {
                end += 1;
            }
            let mut before = sor;
            for j in (0..i).rev() {
                let tt = types[j];
                if tt == L {
                    before = L;
                    break;
                }
                if matches!(tt, R | EN | AN) {
                    before = R;
                    break;
                }
            }
            let mut after = eor;
            for &tt in &types[end..n] {
                if tt == L {
                    after = L;
                    break;
                }
                if matches!(tt, R | EN | AN) {
                    after = R;
                    break;
                }
            }
            if before == after {
                for t in &mut types[i..end] {
                    *t = before;
                }
            }
            i = end - 1;
        }
        i += 1;
    }
    for t in types.iter_mut() {
        if *t == ON {
            *t = e;
        }
    }
    for i in 0..n {
        let t = types[i];
        if levels[i] & 1 == 0 {
            if t == R {
                levels[i] += 1;
            } else if t == AN || t == EN {
                levels[i] += 2;
            }
        } else if matches!(t, L | AN | EN) {
            levels[i] += 1;
        }
    }
    let highest = *levels.iter().max().unwrap_or(&0) as i64;
    let lowest_odd = levels.iter().filter(|l| *l & 1 == 1).min().map(|&l| l as i64).unwrap_or(99);
    let mut chars: Vec<usize> = (0..n).collect();
    let mut level = highest;
    while level >= lowest_odd {
        let mut start: Option<usize> = None;
        for i in 0..n {
            if (levels[i] as i64) < level {
                if let Some(s0) = start.take() {
                    chars[s0..i].reverse();
                }
            } else if start.is_none() {
                start = Some(i);
            }
        }
        if let Some(s0) = start {
            chars[s0..n].reverse();
        }
        level -= 1;
    }
    let mut tekst = Vec::with_capacity(n);
    let mut volgorde = Vec::with_capacity(n);
    for &k in &chars {
        let c = s[k];
        if c == b'<' as u16 || c == b'>' as u16 {
            continue;
        }
        tekst.push(c);
        volgorde.push(k);
    }
    Bidi { tekst, rtl: !is_ltr, volgorde }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(s: &str) -> (String, bool) {
        let u: Vec<u16> = s.encode_utf16().collect();
        let r = bidi(&u);
        (String::from_utf16(&r.tekst).unwrap(), r.rtl)
    }

    #[test]
    fn latin_stays_as_it_is() {
        assert_eq!(b("Hello <world>"), ("Hello <world>".into(), false));
    }

    #[test]
    fn arabic_in_visual_order_is_reversed() {
        // Beeldvolgorde (zoals getekend) → logische volgorde, zoals pdf.js.
        assert_eq!(b("مالس"), ("سلام".into(), true));
    }

    fn rev(s: &str) -> String {
        s.chars().rev().collect()
    }

    #[test]
    fn digits_keep_their_order_inside_rtl() {
        // Uitkomsten van pdf.js 6.4 op de pagina 'rtl' van zoektekst-pdfs.mjs.
        let invoer = format!("{} ١٢٣ {}", rev("سلام"), rev("عربي"));
        assert_eq!(b(&invoer), ("عربي ١٢٣ سلام".into(), true));
    }

    #[test]
    fn mostly_latin_with_some_arabic_stays_ltr() {
        let invoer = format!("Arabic {} 1234 text", rev("عربي"));
        assert_eq!(b(&invoer), ("Arabic 1234 عربي text".into(), false));
    }

    #[test]
    fn angle_brackets_disappear_only_in_bidi_text() {
        assert_eq!(b("<مالس>").0, "سلام");
    }
}
