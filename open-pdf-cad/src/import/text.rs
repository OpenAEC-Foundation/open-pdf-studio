//! Tekst voor de import (#400): CAD-stuurcodes, WinAnsi-codering en de maten
//! van de standaardletter Helvetica (een van de veertien letters die elke
//! PDF-lezer heeft, dus zonder inbedding).
//!
//! De teksthoogte in CAD is de hoogte van een hoofdletter. De PDF-korpsgrootte
//! is daarom hoogte / 0,72 — dezelfde factor als de export, zodat heen en
//! terug dezelfde hoogte oplevert.

/// Breedte per WinAnsi-code in duizendsten van de korpsgrootte (Helvetica).
const WIDTHS: [u16; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, //
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, //
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, //
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, //
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, //
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, //
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, //
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, //
    0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 500, //
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, //
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, //
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, //
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, //
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, //
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/// Unicode-tekens van WinAnsi-codes 0x80–0x9F (0 = geen teken).
const HIGH: [u16; 32] = [
    8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0, 381, 0, //
    0, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 0, 382, 376,
];

/// Hoofdletterhoogte / korpsgrootte waarmee de CAD-teksthoogte naar een
/// korpsgrootte gaat (gelijk aan de export).
pub const TEXT_HEIGHT_FACTOR: f64 = crate::convert::TEXT_HEIGHT_FACTOR;
/// Onderstok van Helvetica als fractie van de korpsgrootte.
pub const DESCENT: f64 = 0.207;

/// WinAnsi-code van een teken, als die bestaat.
pub fn winansi(c: char) -> Option<u8> {
    let u = c as u32;
    match u {
        0x20..=0x7E => Some(u as u8),
        0xA0..=0xFF => Some(u as u8),
        _ => HIGH.iter().position(|&h| h != 0 && h as u32 == u).map(|i| 0x80 + i as u8),
    }
}

/// Tekst naar WinAnsi-bytes; tekens die niet bestaan worden `?` of een
/// gelijkende vervanging. Geeft het aantal vervangen tekens terug.
pub fn encode(text: &str) -> (Vec<u8>, usize) {
    let mut out = Vec::with_capacity(text.len());
    let mut replaced = 0;
    for c in text.chars() {
        if let Some(b) = winansi(c) {
            out.push(b);
            continue;
        }
        let substitute = match c {
            '\t' => Some(b' '),
            '\u{2300}' | '\u{2205}' => Some(0xD8), // diametertekens → Ø
            '\u{2212}' => Some(b'-'),
            '\u{00A0}' => Some(0xA0),
            '\u{2032}' => Some(b'\''),
            '\u{2033}' => Some(b'"'),
            '\u{03BC}' => Some(0xB5), // µ
            _ => None,
        };
        match substitute {
            Some(b) => out.push(b),
            None if c.is_control() => {}
            None => {
                out.push(b'?');
                replaced += 1;
            }
        }
    }
    (out, replaced)
}

/// Letterfamilie die de import gebruikt. Alleen de standaardletters die elke
/// PDF-lezer heeft; er wordt niets ingebed, zodat de PDF klein blijft.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FontFamily {
    /// Schreefloos (Helvetica).
    #[default]
    Sans,
    /// Vaste breedte (Courier).
    Mono,
}

/// De letter waarmee een tekststijl uit de tekening getekend wordt.
///
/// Schuin gebruikt de schuine variant (die dezelfde breedtes heeft). Vet
/// gebruikt dezelfde letter, nagebootst met tekenstand `2 Tr` en een dunne
/// streek: zo is er geen tweede breedtetabel nodig en blijft de plaatsing van
/// de letters kloppen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FontChoice {
    pub family: FontFamily,
    pub italic: bool,
    pub bold: bool,
}

impl FontChoice {
    pub const DEFAULT: FontChoice = FontChoice { family: FontFamily::Sans, italic: false, bold: false };

    /// Naam van de standaardletter in de PDF.
    pub fn base_font(&self) -> &'static str {
        match (self.family, self.italic) {
            (FontFamily::Sans, false) => "Helvetica",
            (FontFamily::Sans, true) => "Helvetica-Oblique",
            (FontFamily::Mono, false) => "Courier",
            (FontFamily::Mono, true) => "Courier-Oblique",
        }
    }
}

/// Hoogste aantal regels in de vervangingstabel (werkgrens); wat daarna komt,
/// valt weg.
pub const MAX_FONT_RULES: usize = 1024;

/// Vervangingstabel: welke letter uit de tekening wordt welke letter in de PDF?
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FontMap {
    rules: std::collections::HashMap<String, FontChoice>,
    fallback: Option<FontChoice>,
}

/// De woorden van een letternaam, in kleine letters: gesplitst op alles wat
/// geen letter of cijfer is en op de overgang van een kleine letter naar een
/// hoofdletter (`DejaVuSansMono` → deja, vu, sans, mono).
/// Woorden die met "mono" beginnen en wél een letter met vaste breedte noemen
/// (de regel "mono telt alleen als los woord of als eind" mist ze).
const FIXED_WIDTH_WORDS: [&str; 4] = ["monotxt", "monofur", "monoid", "mono821"];

fn name_words(name: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut previous_lower = false;
    for c in name.chars() {
        if !c.is_alphanumeric() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
            previous_lower = false;
            continue;
        }
        if c.is_uppercase() && previous_lower && !word.is_empty() {
            words.push(std::mem::take(&mut word));
        }
        previous_lower = c.is_lowercase();
        word.extend(c.to_lowercase());
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

impl FontMap {
    /// `rules` koppelt een letternaam uit de tekening (bestandsnaam of
    /// TrueType-naam, hoofdletterongevoelig) aan een keuze. `fallback` geldt
    /// voor namen zonder regel die ook niet te raden zijn.
    ///
    /// Twee regels voor dezelfde naam: de laatste telt, net als in de
    /// kleurentabel. Een bekende naam wordt ook voorbij de werkgrens nog
    /// bijgewerkt; een nieuwe naam komt er dan niet meer bij.
    pub fn new(rules: Vec<(String, FontChoice)>, fallback: FontChoice) -> FontMap {
        let mut map = std::collections::HashMap::new();
        for (name, choice) in rules {
            let key = name.trim().to_lowercase();
            if key.is_empty() {
                continue;
            }
            if map.len() < MAX_FONT_RULES || map.contains_key(&key) {
                map.insert(key, choice);
            }
        }
        FontMap { rules: map, fallback: Some(fallback) }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty() && self.fallback.is_none()
    }

    /// Raadt een letter uit zijn naam. SHX-letters en onbekende namen worden
    /// schreefloos; "courier", "consol" of het woord "mono" wordt vast;
    /// "italic", "oblique" en "bold" worden herkend.
    ///
    /// "mono" telt alleen als woord: los (`Sans Mono`, `mono.shx`), als eind
    /// van een woord (`sansmono`), als begin van "monospace", of als een van de
    /// bekende namen van een letter met vaste breedte ([`FIXED_WIDTH_WORDS`]).
    /// Midden in of vooraan een ander woord (de naam van een lettergieterij
    /// die met "mono" begint) zegt het niets over de breedte.
    pub fn guess(name: &str) -> FontChoice {
        let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
        let lower = file.to_lowercase();
        let stem = lower.as_str();
        let mono_word = name_words(file)
            .iter()
            .any(|word| word.ends_with("mono") || word.starts_with("monospac") || FIXED_WIDTH_WORDS.contains(&word.as_str()));
        let family = if mono_word || stem.contains("courier") || stem.contains("consol") {
            FontFamily::Mono
        } else {
            FontFamily::Sans
        };
        let italic = stem.contains("italic") || stem.contains("oblique");
        let bold = stem.contains("bold") || stem.contains("black") || stem.contains("heavy");
        FontChoice { family, italic, bold }
    }

    /// De letter voor een tekststijl. `font_file` is de SHX- of TTF-naam uit
    /// de stijl, `true_type` de TrueType-naam als die er is.
    pub fn choose(&self, font_file: &str, true_type: &str) -> FontChoice {
        for name in [true_type, font_file] {
            let key = name.trim().to_lowercase();
            if key.is_empty() {
                continue;
            }
            if let Some(choice) = self.rules.get(&key) {
                return *choice;
            }
        }
        for name in [true_type, font_file] {
            if !name.trim().is_empty() {
                return FontMap::guess(name);
            }
        }
        self.fallback.unwrap_or(FontChoice::DEFAULT)
    }
}

/// Breedte van WinAnsi-bytes in eenheden van de korpsgrootte, voor de
/// standaardletter.
pub fn width(bytes: &[u8]) -> f64 {
    width_with(bytes, FontChoice::DEFAULT)
}

/// Als [`width`], voor een gekozen letter. De vaste letter is 600/1000 per
/// teken; de schuine varianten hebben de breedtes van de rechte.
pub fn width_with(bytes: &[u8], font: FontChoice) -> f64 {
    match font.family {
        FontFamily::Mono => bytes.len() as f64 * 0.6,
        FontFamily::Sans => bytes.iter().map(|&b| WIDTHS[b as usize] as f64).sum::<f64>() / 1000.0,
    }
}

/// CAD-stuurcodes in TEXT/ATTRIB: `%%c` Ø, `%%d` °, `%%p` ±, `%%%` %,
/// `%%nnn` tekencode, `%%u`/`%%o` (onder-/bovenstreep, genegeerd) en
/// `\U+XXXX`.
pub fn decode_cad_text(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '%' && i + 2 < chars.len() && chars[i + 1] == '%' {
            let code = chars[i + 2];
            match code.to_ascii_lowercase() {
                'c' => {
                    out.push('Ø');
                    i += 3;
                    continue;
                }
                'd' => {
                    out.push('°');
                    i += 3;
                    continue;
                }
                'p' => {
                    out.push('±');
                    i += 3;
                    continue;
                }
                '%' => {
                    out.push('%');
                    i += 3;
                    continue;
                }
                'u' | 'o' | 'k' => {
                    i += 3;
                    continue;
                }
                d if d.is_ascii_digit() => {
                    let mut j = i + 2;
                    let mut n = 0u32;
                    while j < chars.len() && j < i + 5 && chars[j].is_ascii_digit() {
                        n = n * 10 + chars[j].to_digit(10).unwrap();
                        j += 1;
                    }
                    if let Some(ch) = char::from_u32(n) {
                        out.push(ch);
                    }
                    i = j;
                    continue;
                }
                _ => {}
            }
        }
        if c == '\\' && i + 7 <= chars.len() && chars[i + 1].eq_ignore_ascii_case(&'U') && chars[i + 2] == '+' {
            let hex: String = chars[i + 3..i + 7].iter().collect();
            if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                out.push(ch);
                i += 7;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Horizontale uitlijning van TEXT/ATTRIB (DXF-code 72).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HAlign {
    Left,
    Center,
    Right,
    Aligned,
    Middle,
    Fit,
}

/// Verticale uitlijning van TEXT/ATTRIB (DXF-code 73).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VAlign {
    Baseline,
    Bottom,
    Middle,
    Top,
}

/// Plaatsing van één regel tekst in het vlak van de entiteit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinePlacement {
    /// Begin van de basislijn.
    pub x: f64,
    pub y: f64,
    /// Richting van de basislijn (radialen).
    pub rotation: f64,
    /// Korpsgrootte in tekeningeenheden.
    pub font_size: f64,
    /// Breedtefactor (horizontale schaal).
    pub width_factor: f64,
}

/// Plaatst een TEXT-regel volgens de CAD-regels. `width_em` is de breedte in
/// eenheden van de korpsgrootte (zie [`width`]).
#[allow(clippy::too_many_arguments)]
pub fn place_text(
    insert: (f64, f64),
    align_point: Option<(f64, f64)>,
    height: f64,
    rotation: f64,
    width_factor: f64,
    h: HAlign,
    v: VAlign,
    width_em: f64,
) -> LinePlacement {
    let height = if height > 0.0 { height } else { 1.0 };
    let wf = if width_factor > 0.0 { width_factor } else { 1.0 };
    let mut size = height / TEXT_HEIGHT_FACTOR;
    let mut wf_out = wf;
    let mut rot = rotation;
    let natural = width_em * size * wf;
    let reference = if h == HAlign::Left && v == VAlign::Baseline { insert } else { align_point.unwrap_or(insert) };

    // Horizontale verschuiving langs de basislijn (in tekstrichting).
    let mut dx = match h {
        HAlign::Left => 0.0,
        HAlign::Center | HAlign::Middle => -natural / 2.0,
        HAlign::Right => -natural,
        HAlign::Aligned | HAlign::Fit => 0.0,
    };
    let mut origin = reference;
    let mut cap = height;
    if matches!(h, HAlign::Aligned | HAlign::Fit) {
        if let Some(b) = align_point {
            let (ddx, ddy) = (b.0 - insert.0, b.1 - insert.1);
            let len = ddx.hypot(ddy);
            if len > 1e-12 && natural > 1e-12 {
                rot = ddy.atan2(ddx);
                if h == HAlign::Aligned {
                    // Hoogte schaalt mee, breedtefactor blijft.
                    size *= len / natural;
                    cap = size * TEXT_HEIGHT_FACTOR;
                } else {
                    wf_out = wf * len / natural;
                }
            }
        }
        origin = insert;
        dx = 0.0;
    }
    let dy = match (h, v) {
        (HAlign::Middle, _) => -cap / 2.0,
        (_, VAlign::Baseline) => 0.0,
        (_, VAlign::Bottom) => DESCENT * size,
        (_, VAlign::Middle) => -cap / 2.0,
        (_, VAlign::Top) => -cap,
    };
    let dy = if matches!(h, HAlign::Aligned | HAlign::Fit) { 0.0 } else { dy };
    let (s, c) = rot.sin_cos();
    LinePlacement {
        x: origin.0 + dx * c - dy * s,
        y: origin.1 + dx * s + dy * c,
        rotation: rot,
        font_size: size,
        width_factor: wf_out,
    }
}

/// Eén stuk tekst binnen een MTEXT-regel.
#[derive(Clone, Debug, PartialEq)]
pub struct MTextRun {
    pub bytes: Vec<u8>,
    /// Hoogte (hoofdletter) in tekeningeenheden.
    pub height: f64,
    pub width_factor: f64,
    /// Kleur uit de opmaakcodes, als die afwijkt.
    pub color: Option<(u8, u8, u8)>,
    /// ACI uit de opmaakcodes (`\C`), als die gezet is.
    pub aci: Option<i16>,
    /// Letter van de tekststijl van deze MTEXT.
    pub font: FontChoice,
}

/// Een opgemaakte MTEXT-regel: stukken met hun verschuiving langs de regel.
#[derive(Clone, Debug, PartialEq)]
pub struct MTextLine {
    pub runs: Vec<(f64, MTextRun)>,
    pub width: f64,
    pub height: f64,
}

/// Breekt MTEXT-alinea's in regels. `max_width` 0 = niet afbreken.
pub fn wrap_mtext(paragraphs: &[Vec<MTextRun>], max_width: f64) -> Vec<MTextLine> {
    // Spaties aan het eind van een regel tellen niet mee voor de uitlijning.
    fn trim(line: &mut MTextLine) {
        if let Some((x, last)) = line.runs.last() {
            let size = last.height / TEXT_HEIGHT_FACTOR;
            let trimmed = last.bytes.len() - last.bytes.iter().rev().take_while(|&&b| b == b' ').count();
            line.width = x + width_with(&last.bytes[..trimmed], last.font) * size * last.width_factor;
        }
    }
    let mut lines = Vec::new();
    for paragraph in paragraphs {
        let mut line = MTextLine { runs: Vec::new(), width: 0.0, height: 0.0 };
        let base_height = paragraph.iter().map(|r| r.height).fold(0.0, f64::max);
        for run in paragraph {
            let size = run.height / TEXT_HEIGHT_FACTOR;
            // Splits op spaties zodat woorden naar de volgende regel kunnen.
            let mut word_start = 0;
            let bytes = &run.bytes;
            let mut pieces: Vec<&[u8]> = Vec::new();
            for (i, &b) in bytes.iter().enumerate() {
                if b == b' ' {
                    pieces.push(&bytes[word_start..=i]);
                    word_start = i + 1;
                }
            }
            if word_start < bytes.len() {
                pieces.push(&bytes[word_start..]);
            }
            for piece in pieces {
                let w = width_with(piece, run.font) * size * run.width_factor;
                let trimmed = piece.strip_suffix(b" ").unwrap_or(piece);
                let w_trim = width_with(trimmed, run.font) * size * run.width_factor;
                if max_width > 0.0 && line.width > 0.0 && line.width + w_trim > max_width * 1.0001 {
                    let mut full = std::mem::replace(&mut line, MTextLine { runs: Vec::new(), width: 0.0, height: 0.0 });
                    trim(&mut full);
                    lines.push(full);
                }
                let x = line.width;
                match line.runs.last_mut() {
                    Some((_, last)) if last.height == run.height && last.width_factor == run.width_factor && last.color == run.color && last.aci == run.aci && last.font == run.font => {
                        last.bytes.extend_from_slice(piece);
                    }
                    _ => line.runs.push((x, MTextRun { bytes: piece.to_vec(), ..run.clone() })),
                }
                line.width += w;
                line.height = line.height.max(run.height);
            }
        }
        if line.height == 0.0 {
            line.height = base_height;
        }
        trim(&mut line);
        lines.push(line);
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winansi_covers_latin_and_the_high_range() {
        assert_eq!(winansi('A'), Some(65));
        assert_eq!(winansi('é'), Some(0xE9));
        assert_eq!(winansi('€'), Some(0x80));
        assert_eq!(winansi('—'), Some(0x97));
        assert_eq!(winansi('Ω'), None);
        let (bytes, replaced) = encode("Ø 25 − Ω");
        assert_eq!(bytes, vec![0xD8, b' ', b'2', b'5', b' ', b'-', b' ', b'?']);
        assert_eq!(replaced, 1);
    }

    #[test]
    fn helvetica_widths() {
        assert!((width(b"A") - 0.667).abs() < 1e-9);
        assert!((width(b"Wand 1") - (0.944 + 0.556 + 0.556 + 0.556 + 0.278 + 0.556)).abs() < 1e-9);
    }

    #[test]
    fn cad_control_codes() {
        assert_eq!(decode_cad_text("%%c100 %%p5%%d"), "Ø100 ±5°");
        assert_eq!(decode_cad_text("50%%%"), "50%");
        assert_eq!(decode_cad_text("%%uonder%%u"), "onder");
        assert_eq!(decode_cad_text("%%065B"), "AB");
        assert_eq!(decode_cad_text("m\\U+00B2"), "m²");
        assert_eq!(decode_cad_text("100%"), "100%");
    }

    #[test]
    fn text_alignment_follows_the_cad_rules() {
        let w = width(b"ABC");
        // Links op de basislijn: het invoegpunt.
        let p = place_text((10.0, 20.0), None, 2.5, 0.0, 1.0, HAlign::Left, VAlign::Baseline, w);
        assert_eq!((p.x, p.y), (10.0, 20.0));
        assert!((p.font_size - 2.5 / TEXT_HEIGHT_FACTOR).abs() < 1e-12);
        // Rechts: het uitlijnpunt min de breedte.
        let p = place_text((0.0, 0.0), Some((100.0, 0.0)), 2.5, 0.0, 1.0, HAlign::Right, VAlign::Baseline, w);
        assert!((p.x + w * 2.5 / TEXT_HEIGHT_FACTOR - 100.0).abs() < 1e-9);
        // Midden (4): horizontaal en verticaal gecentreerd om het uitlijnpunt.
        let p = place_text((0.0, 0.0), Some((50.0, 50.0)), 2.0, 0.0, 1.0, HAlign::Middle, VAlign::Baseline, w);
        assert!((p.y - 49.0).abs() < 1e-9);
        // Boven: basislijn een teksthoogte onder het punt; gedraaid 90°.
        let p = place_text((0.0, 0.0), Some((0.0, 0.0)), 2.0, std::f64::consts::FRAC_PI_2, 1.0, HAlign::Left, VAlign::Top, w);
        assert!((p.x - 2.0).abs() < 1e-9 && p.y.abs() < 1e-9);
        // Passend (Fit): de breedtefactor rekt de tekst tussen beide punten.
        let p = place_text((0.0, 0.0), Some((10.0, 0.0)), 1.0, 0.0, 1.0, HAlign::Fit, VAlign::Baseline, w);
        assert!((w * p.font_size * p.width_factor - 10.0).abs() < 1e-9);
    }

    #[test]
    fn mtext_wraps_on_words() {
        let run = |s: &str| MTextRun { bytes: s.as_bytes().to_vec(), height: 1.0, width_factor: 1.0, color: None, aci: None, font: FontChoice::DEFAULT };
        let para = vec![run("een twee drie vier")];
        let size = 1.0 / TEXT_HEIGHT_FACTOR;
        let max = width(b"een twee") * size + 0.01;
        let lines = wrap_mtext(&[para], max);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].runs[0].1.bytes, b"een twee ".to_vec());
        assert!((lines[0].width - width(b"een twee") * size).abs() < 1e-9);
        assert_eq!(lines[1].runs[0].1.bytes, b"drie vier".to_vec());
        // Zonder breedte: één regel per alinea.
        assert_eq!(wrap_mtext(&[vec![run("a b")], vec![run("c")]], 0.0).len(), 2);
    }

    #[test]
    fn a_font_name_is_guessed_and_a_rule_wins() {
        use super::{FontChoice, FontFamily, FontMap};
        assert_eq!(FontMap::guess("arial.ttf"), FontChoice::DEFAULT);
        assert_eq!(FontMap::guess("romans.shx"), FontChoice::DEFAULT, "een SHX-letter wordt schreefloos");
        assert_eq!(
            FontMap::guess("consola.ttf"),
            FontChoice { family: FontFamily::Mono, italic: false, bold: false }
        );
        assert_eq!(
            FontMap::guess("Arial Bold Italic"),
            FontChoice { family: FontFamily::Sans, italic: true, bold: true }
        );
        let map = FontMap::new(
            vec![("romans.shx".into(), FontChoice { family: FontFamily::Mono, italic: false, bold: false })],
            FontChoice::DEFAULT,
        );
        assert_eq!(map.choose("romans.shx", ""), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
        assert_eq!(map.choose("ROMANS.SHX", ""), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
        assert_eq!(map.choose("txt.shx", ""), FontChoice::DEFAULT, "geen regel: raden");
        assert_eq!(map.choose("", "Consolas"), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
    }

    #[test]
    fn mono_is_matched_on_a_word_not_inside_one() {
        use super::{FontFamily, FontMap};
        for name in ["Monotype Corsiva", "MONOTYPE SORTS", "monotype.ttf", "Harmonora", "Kimonos.ttf"] {
            assert_eq!(FontMap::guess(name).family, FontFamily::Sans, "{name}");
        }
        for name in [
            "DejaVu Sans Mono",
            "DejaVuSansMono.ttf",
            "dejavusansmono-bold.ttf",
            "Liberation-Mono",
            "mono.shx",
            "monotxt.shx",
            "Monospace 821",
            "monospac821 bt.ttf",
            "Courier New",
            "consola.ttf",
            "monofur.ttf",
            "Monofur Italic",
            "Monoid-Regular.ttf",
            "monoid",
            "mono821.ttf",
            "Mono821 BT",
        ] {
            assert_eq!(FontMap::guess(name).family, FontFamily::Mono, "{name}");
        }
        // Een map in het pad telt niet mee.
        assert_eq!(FontMap::guess("C:/letters/mono/arial.ttf").family, FontFamily::Sans);
    }

    #[test]
    fn a_later_rule_for_the_same_font_wins() {
        use super::{FontChoice, FontFamily, FontMap};
        let mono = FontChoice { family: FontFamily::Mono, italic: false, bold: false };
        let map = FontMap::new(vec![("Romans.shx".into(), mono), (" romans.SHX ".into(), FontChoice::DEFAULT)], FontChoice::DEFAULT);
        assert_eq!(map.choose("romans.shx", ""), FontChoice::DEFAULT, "de laatste regel telt, net als in de kleurentabel");
        let map = FontMap::new(vec![("romans.shx".into(), FontChoice::DEFAULT), ("romans.shx".into(), mono)], FontChoice::DEFAULT);
        assert_eq!(map.choose("romans.shx", ""), mono);
    }

    #[test]
    fn the_four_base_fonts_are_named_and_mono_is_fixed_width() {
        use super::{width_with, FontChoice, FontFamily};
        let sans = FontChoice::DEFAULT;
        let mono = FontChoice { family: FontFamily::Mono, italic: false, bold: false };
        assert_eq!(sans.base_font(), "Helvetica");
        assert_eq!(FontChoice { italic: true, ..sans }.base_font(), "Helvetica-Oblique");
        assert_eq!(mono.base_font(), "Courier");
        assert_eq!(FontChoice { italic: true, ..mono }.base_font(), "Courier-Oblique");
        // Vet gebruikt dezelfde letter; het wordt met een streek nagebootst.
        assert_eq!(FontChoice { bold: true, ..sans }.base_font(), "Helvetica");
        assert!((width_with(b"MMMM", mono) - 4.0 * 0.6).abs() < 1e-12);
        assert!(width_with(b"iiii", sans) < width_with(b"MMMM", sans));
    }
}
