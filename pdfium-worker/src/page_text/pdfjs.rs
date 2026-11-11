//! Tekstitems zoals pdf.js ze maakt (`getTextContent` in
//! src/core/evaluator.js), opgebouwd uit de glyphs die PDFium uit de pagina
//! leest. De zoekfunctie van de app (js/search/find-controller.js) plakt de
//! `str` van die items aan elkaar en zoekt daarin; dezelfde regels voor
//! spaties, regeleinden en itemgrenzen geven dus dezelfde treffers.
//!
//! Overgenomen uit pdf.js 6.4 (zonder `keepWhiteSpace`, `includeMarkedContent`
//! en `disableNormalization`, zoals de app `getTextContent()` aanroept):
//! - een spatieglyph wordt niet zelf opgenomen; hij schuift alleen op en een
//!   volgende glyph krijgt hooguit één " " (twee-laatste-tekens-regel);
//! - de afstand tot het einde van de vorige glyph beslist: kleiner dan
//!   -0,2 em = nieuw item (of regeleinde bij een verticale sprong van meer dan
//!   een halve letterhoogte), verticale sprong groter dan de letterhoogte =
//!   regeleinde, 0,102–0,6 em = één " " in het item, groter = item afsluiten
//!   met een los spatie-item;
//! - een andere lettergrootte of een ander font sluit het item af, net als
//!   elk XObject (formulier of beeld); een formulier begint met een eigen,
//!   lege toestand;
//! - glyphs buiten de paginabox vallen weg (met de tekstruimte-breedte als
//!   marge, zoals pdf.js);
//! - de itemtekst gaat door `normalizeUnicode` (NFKC op ligaturen e.d.) en
//!   `bidi` (logische volgorde voor rechts-naar-links-tekst).
//!
//! - elke BDC/BMC/EMC sluit het lopende item af (pdfium.rs geeft een `Spoel`
//!   waar de markering tussen twee objecten wisselt).
//!
//! Niet overgenomen (zie docs/rust-stappen.md): verticaal schrift en de
//! Type3-hoogtecorrectie (zulke pagina's leest de app met pdf.js, pdfium.rs
//! markeert ze), en de tekstrijzing (Ts) in de regeleinde-toets.

use super::bidi::bidi;
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

const TRACKING_SPACE_FACTOR: f64 = 0.102;
const NOT_A_SPACE_FACTOR: f64 = 0.03;
const NEGATIVE_SPACE_FACTOR: f64 = -0.2;
const SPACE_IN_FLOW_MIN_FACTOR: f64 = 0.102;
const SPACE_IN_FLOW_MAX_FACTOR: f64 = 0.6;
const VERTICAL_SHIFT_RATIO: f64 = 0.25;

/// Eén glyph zoals PDFium hem tekent.
#[derive(Clone, Debug, PartialEq)]
pub struct Glyph {
    /// UTF-16 van de Unicode-waarde van de glyph (leeg, één of meer tekens).
    pub unicode: Vec<u16>,
    /// Oorsprong in paginaruimte.
    pub x: f64,
    pub y: f64,
    /// Tm × CTM (2×2, zonder lettergrootte): a, b, c, d.
    pub m: [f64; 4],
    /// Lettergrootte (Tf).
    pub fs: f64,
    /// Voortgang van de glyph in tekstruimte (breedte × fs / 1000).
    pub w: f64,
}

/// De inhoud van een pagina in tekenvolgorde.
#[derive(Clone, Debug, PartialEq)]
pub enum Gebeurtenis {
    /// Eén tekstobject (één Tj/TJ) met zijn font (index in de fontnamen).
    Tekst { font: u32, glyphs: Vec<Glyph> },
    /// Begin en einde van een formulier-XObject.
    FormulierIn,
    FormulierUit,
    /// Een ander XObject (beeld): pdf.js sluit daar het lopende item af.
    Spoel,
}

/// Een tekstitem van pdf.js, met per code-eenheid van `str` het stuk
/// basislijn dat hij beslaat (paginaruimte, vanaf het begin van het item).
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub str: Vec<u16>,
    pub transform: [f64; 6],
    pub width: f64,
    pub height: f64,
    pub font: u32,
    pub has_eol: bool,
    pub rtl: bool,
    pub vakken: Vec<(f64, f64)>,
}

#[derive(Clone, Copy)]
struct Categorie {
    witruimte: bool,
    diakriet: bool,
    onzichtbaar: bool,
}

/// `getCharUnicodeCategory` van pdf.js: /^(\s)|(\p{Mn})|(\p{Cf})$/u.
fn categorie(u: &[u16]) -> Categorie {
    let tekens: Vec<char> = char::decode_utf16(u.iter().copied()).map(|r| r.unwrap_or('\u{fffd}')).collect();
    let mut c = Categorie { witruimte: false, diakriet: false, onzichtbaar: false };
    let Some(&eerste) = tekens.first() else { return c };
    if js_witruimte(eerste) {
        c.witruimte = true;
        return c;
    }
    // De eerste treffer van de regex beslist: (\p{Mn}) ergens, of (\p{Cf}) als
    // laatste teken. Een Mn vóór de laatste Cf wint.
    for (i, &t) in tekens.iter().enumerate() {
        if t.general_category() == GeneralCategory::NonspacingMark {
            c.diakriet = true;
            return c;
        }
        if i + 1 == tekens.len() && t.general_category() == GeneralCategory::Format {
            c.onzichtbaar = true;
        }
    }
    c
}

/// `\s` van JavaScript.
pub fn js_witruimte(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
        || ('\u{2000}'..='\u{200a}').contains(&c)
}

/// Tekens die `normalizeUnicode` van pdf.js met NFKC omzet (de regex daar).
fn normaliseerbaar(c: u32) -> bool {
    matches!(c,
        0x00a0 | 0x00b5 | 0x037e | 0x0eb3 | 0x2000..=0x200a | 0x202f | 0x2126
        | 0xfb00..=0xfb04 | 0xfb06 | 0xfb20..=0xfb36 | 0xfb38..=0xfb3c | 0xfb3e | 0xfb40 | 0xfb41
        | 0xfb43 | 0xfb44 | 0xfb46..=0xfba1 | 0xfba4..=0xfba9 | 0xfbae..=0xfbb1 | 0xfbd3..=0xfbdc
        | 0xfbde..=0xfbe7 | 0xfbea..=0xfbf8 | 0xfbfc | 0xfbfd | 0xfc00..=0xfc5d | 0xfc64..=0xfcf1
        | 0xfcf5..=0xfd3d | 0xfd88 | 0xfdf4 | 0xfdfa | 0xfdfb | 0xfe71 | 0xfe77 | 0xfe79 | 0xfe7b | 0xfe7d)
}

/// `normalizeUnicode` van pdf.js, met de vakken mee: een uitgebreid teken
/// verdeelt zijn vak gelijk over de tekens die eruit komen.
fn normaliseer(str: &[u16], vakken: &[(f64, f64)]) -> (Vec<u16>, Vec<(f64, f64)>) {
    // Snelle weg: niets om te normaliseren.
    if !str.iter().any(|&u| u >= 0xa0) {
        return (str.to_vec(), vakken.to_vec());
    }
    let mut uit = Vec::with_capacity(str.len());
    let mut uit_vakken = Vec::with_capacity(vakken.len());
    let mut i = 0;
    while i < str.len() {
        let (c, n) = decodeer(str, i);
        if c == 0xfb05 {
            // ﬅ → ſt (eigen tabel van pdf.js).
            let (a, b) = vakken[i];
            let m = (a + b) / 2.0;
            uit.extend_from_slice(&[0x017f, 0x74]);
            uit_vakken.extend_from_slice(&[(a, m), (m, b)]);
            i += n;
            continue;
        }
        if !normaliseerbaar(c) {
            uit.extend_from_slice(&str[i..i + n]);
            uit_vakken.extend(std::iter::repeat_n(vakken[i], n));
            i += n;
            continue;
        }
        // Een aaneengesloten reeks normaliseerbare tekens gaat in één keer
        // door NFKC, zoals de regex van pdf.js hem vangt.
        let begin = i;
        let mut tekens = String::new();
        let mut per_teken: Vec<(usize, usize)> = Vec::new();
        while i < str.len() {
            let (c, n) = decodeer(str, i);
            if !normaliseerbaar(c) {
                break;
            }
            tekens.push(char::from_u32(c).unwrap_or('\u{fffd}'));
            per_teken.push((i, n));
            i += n;
        }
        let geheel: Vec<u16> = tekens.nfkc().collect::<String>().encode_utf16().collect();
        let los: Vec<Vec<u16>> = per_teken
            .iter()
            .map(|&(p, n)| String::from_utf16_lossy(&str[p..p + n]).nfkc().collect::<String>().encode_utf16().collect())
            .collect();
        if los.iter().map(Vec::len).sum::<usize>() == geheel.len() {
            for (&(p, _), deel) in per_teken.iter().zip(&los) {
                let (a, b) = vakken[p];
                let k = deel.len().max(1) as f64;
                for (j, &u) in deel.iter().enumerate() {
                    uit.push(u);
                    uit_vakken.push((a + (b - a) * j as f64 / k, a + (b - a) * (j + 1) as f64 / k));
                }
            }
        } else {
            let a = vakken[begin].0;
            let b = vakken[i - 1].1;
            for &u in &geheel {
                uit.push(u);
                uit_vakken.push((a, b));
            }
        }
    }
    (uit, uit_vakken)
}

fn decodeer(s: &[u16], i: usize) -> (u32, usize) {
    let a = s[i];
    if (0xd800..0xdc00).contains(&a) && i + 1 < s.len() && (0xdc00..0xe000).contains(&s[i + 1]) {
        (0x10000 + (((a as u32) - 0xd800) << 10) + ((s[i + 1] as u32) - 0xdc00), 2)
    } else {
        (a as u32, 1)
    }
}

/// `textContentItem` van pdf.js.
struct Lopend {
    initialized: bool,
    str: Vec<u16>,
    vakken: Vec<(f64, f64)>,
    total_width: f64,
    total_height: f64,
    width: f64,
    height: f64,
    prev_transform: Option<[f64; 6]>,
    text_advance_scale: f64,
    space_in_flow_min: f64,
    space_in_flow_max: f64,
    tracking_space_min: f64,
    negative_space_max: f64,
    not_a_space: f64,
    transform: [f64; 6],
    font: u32,
    has_eol: bool,
    /// Einde (in item-ruimte) van de laatst opgenomen glyph, voor het vak van
    /// een spatie die vóór de volgende glyph komt.
    laatste_einde: f64,
}

impl Lopend {
    fn nieuw() -> Self {
        Self {
            initialized: false,
            str: Vec::new(),
            vakken: Vec::new(),
            total_width: 0.0,
            total_height: 0.0,
            width: 0.0,
            height: 0.0,
            prev_transform: None,
            text_advance_scale: 0.0,
            space_in_flow_min: 0.0,
            space_in_flow_max: 0.0,
            tracking_space_min: f64::INFINITY,
            negative_space_max: f64::NEG_INFINITY,
            not_a_space: f64::NEG_INFINITY,
            transform: [0.0; 6],
            font: 0,
            has_eol: false,
            laatste_einde: 0.0,
        }
    }

    /// Plek op de basislijn (paginaruimte, vanaf het itembegin) van het
    /// huidige einde van het item.
    fn cursor(&self) -> f64 {
        self.total_width + self.width * self.text_advance_scale
    }
}

/// Eén aanroep van `getTextContent` (de pagina, of een formulier daarin).
struct Staat {
    item: Lopend,
    twee: [bool; 2], // is het teken een spatie
    pos: usize,
    huidig_font: Option<(u32, f64)>,
}

impl Staat {
    fn nieuw() -> Self {
        Self { item: Lopend::nieuw(), twee: [true, true], pos: 0, huidig_font: None }
    }
    fn save_last_char(&mut self, spatie: bool) -> bool {
        let next = (self.pos + 1) % 2;
        let ret = !self.twee[self.pos] && self.twee[next];
        self.twee[self.pos] = spatie;
        self.pos = next;
        ret
    }
    fn should_add_whitespace(&self) -> bool {
        !self.twee[self.pos] && self.twee[(self.pos + 1) % 2]
    }
    fn reset_last_chars(&mut self) {
        self.twee = [true, true];
        self.pos = 0;
    }
}

struct Bouwer {
    view: [f64; 4],
    items: Vec<Item>,
}

fn huidige_transform(g: &Glyph) -> [f64; 6] {
    [g.fs * g.m[0], g.fs * g.m[1], g.fs * g.m[2], g.fs * g.m[3], g.x, g.y]
}

fn advance_scale(g: &Glyph) -> f64 {
    g.m[0].hypot(g.m[1])
}

fn apply_inverse_rotation(x: f64, y: f64, m: &[f64; 6]) -> (f64, f64) {
    let scale = m[0].hypot(m[1]);
    ((m[0] * x + m[1] * y) / scale, (m[2] * x + m[3] * y) / scale)
}

fn js_sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v // 0, -0 of NaN, zoals Math.sign
    }
}

impl Bouwer {
    fn flush(&mut self, s: &mut Staat) {
        let it = &mut s.item;
        if !it.initialized {
            return;
        }
        it.total_width += it.width * it.text_advance_scale;
        let (str, vakken) = normaliseer(&it.str, &it.vakken);
        let b = bidi(&str);
        let vakken: Vec<(f64, f64)> = b.volgorde.iter().map(|&k| vakken[k]).collect();
        self.items.push(Item {
            str: b.tekst,
            transform: it.transform,
            width: it.total_width.abs(),
            height: it.total_height.abs(),
            font: it.font,
            has_eol: it.has_eol,
            rtl: b.rtl,
            vakken,
        });
        it.initialized = false;
        it.str.clear();
        it.vakken.clear();
    }

    fn push_whitespace(&mut self, width: f64, height: f64, transform: Option<[f64; 6]>, font: u32) {
        self.items.push(Item {
            str: vec![0x20],
            transform: transform.unwrap_or([0.0; 6]),
            width,
            height,
            font,
            has_eol: false,
            rtl: false,
            vakken: vec![(0.0, width)],
        });
    }

    fn append_eol(&mut self, s: &mut Staat, g: &Glyph, font: u32) {
        s.reset_last_chars();
        if s.item.initialized {
            s.item.has_eol = true;
            self.flush(s);
        } else {
            self.items.push(Item {
                str: Vec::new(),
                transform: huidige_transform(g),
                width: 0.0,
                height: 0.0,
                font,
                has_eol: true,
                rtl: false,
                vakken: Vec::new(),
            });
        }
    }

    fn ensure_item(&mut self, s: &mut Staat, g: &Glyph, font: u32) {
        let it = &mut s.item;
        if it.initialized {
            return;
        }
        it.font = font;
        let trm = huidige_transform(g);
        it.transform = trm;
        it.width = 0.0;
        it.total_width = 0.0;
        it.height = trm[2].hypot(trm[3]);
        it.total_height = it.height;
        it.text_advance_scale = advance_scale(g);
        let fs = g.fs;
        it.tracking_space_min = fs * TRACKING_SPACE_FACTOR;
        it.not_a_space = fs * NOT_A_SPACE_FACTOR;
        it.negative_space_max = fs * NEGATIVE_SPACE_FACTOR;
        it.space_in_flow_min = fs * SPACE_IN_FLOW_MIN_FACTOR;
        it.space_in_flow_max = fs * SPACE_IN_FLOW_MAX_FACTOR;
        it.has_eol = false;
        it.initialized = true;
        it.laatste_einde = 0.0;
    }

    /// `addFakeSpaces`: true als het item is afgesloten met een los spatie-item.
    fn add_fake_spaces(&mut self, s: &mut Staat, width: f64, transf: Option<[f64; 6]>, orientation: f64, g: &Glyph) -> bool {
        let it = &s.item;
        if orientation * it.space_in_flow_min <= width && width <= orientation * it.space_in_flow_max {
            if s.item.initialized {
                s.reset_last_chars();
                let a = s.item.cursor();
                s.item.str.push(0x20);
                s.item.vakken.push((a, a + width * s.item.text_advance_scale));
            }
            return false;
        }
        let font = s.item.font;
        self.flush(s);
        s.reset_last_chars();
        self.push_whitespace(width.abs(), 0.0, Some(transf.unwrap_or_else(|| huidige_transform(g))), font);
        true
    }

    /// `compareWithLastPosition` (horizontaal schrift).
    fn compare(&mut self, s: &mut Staat, g: &Glyph, glyph_width: f64, font: u32) -> bool {
        let ct = huidige_transform(g);
        let (mut pos_x, mut pos_y) = (ct[4], ct[5]);
        let v = self.view;
        if pos_x + glyph_width < v[0] || pos_x > v[2] || pos_y < v[1] || pos_y > v[3] {
            return false;
        }
        let Some(prev) = s.item.prev_transform else { return true };
        let (mut last_x, mut last_y) = (prev[4], prev[5]);
        if last_x == pos_x && last_y == pos_y {
            return true;
        }
        let rotate = if ct[0] != 0.0 && ct[1] == 0.0 && ct[2] == 0.0 {
            if ct[0] > 0.0 { 0 } else { 180 }
        } else if ct[1] != 0.0 && ct[0] == 0.0 && ct[3] == 0.0 {
            if ct[1] > 0.0 { 90 } else { 270 }
        } else {
            -1
        };
        match rotate {
            0 => {}
            90 => {
                std::mem::swap(&mut pos_x, &mut pos_y);
                std::mem::swap(&mut last_x, &mut last_y);
            }
            180 => {
                pos_x = -pos_x;
                pos_y = -pos_y;
                last_x = -last_x;
                last_y = -last_y;
            }
            270 => {
                (pos_x, pos_y) = (-pos_y, -pos_x);
                (last_x, last_y) = (-last_y, -last_x);
            }
            _ => {
                (pos_x, pos_y) = apply_inverse_rotation(pos_x, pos_y, &ct);
                (last_x, last_y) = apply_inverse_rotation(last_x, last_y, &prev);
            }
        }
        let it = &s.item;
        let advance_x = (pos_x - last_x) / it.text_advance_scale;
        let advance_y = pos_y - last_y;
        let orientation = js_sign(if it.width != 0.0 && !it.width.is_nan() { it.width } else { it.total_width });
        if advance_x < orientation * it.negative_space_max {
            if advance_y.abs() > 0.5 * it.height {
                self.append_eol(s, g, font);
                return true;
            }
            s.reset_last_chars();
            self.flush(s);
            return true;
        }
        if advance_y.abs() > it.height {
            self.append_eol(s, g, font);
            return true;
        }
        if advance_x <= orientation * it.not_a_space {
            s.reset_last_chars();
        }
        if advance_x <= orientation * s.item.tracking_space_min {
            if s.should_add_whitespace() {
                s.reset_last_chars();
                self.flush(s);
                self.push_whitespace(advance_x.abs(), 0.0, Some(prev), s.item.font);
            } else {
                s.item.width += advance_x;
            }
        } else if !self.add_fake_spaces(s, advance_x, Some(prev), orientation, g) {
            if s.item.str.is_empty() {
                s.reset_last_chars();
                self.push_whitespace(advance_x.abs(), 0.0, Some(prev), s.item.font);
            } else {
                s.item.width += advance_x;
            }
        }
        if advance_y.abs() > s.item.height * VERTICAL_SHIFT_RATIO {
            self.flush(s);
        }
        true
    }

    fn glyph(&mut self, s: &mut Staat, g: &Glyph, font: u32) {
        let cat = categorie(&g.unicode);
        if cat.onzichtbaar {
            return;
        }
        let mut scaled_dim = g.w;
        if cat.witruimte {
            s.save_last_char(true);
            return;
        }
        // updateAdvanceScale: pdf.js doet dit bij een nieuwe Tm, vóór de
        // volgende glyph; hier zodra de schaal van de glyph anders is.
        let schaal = advance_scale(g);
        if s.item.initialized && (schaal - s.item.text_advance_scale).abs() > 1e-6 * schaal.max(1e-9) {
            s.item.total_width += s.item.width * s.item.text_advance_scale;
            s.item.width = 0.0;
            s.item.text_advance_scale = schaal;
        }
        if !cat.diakriet && !self.compare(s, g, scaled_dim, font) {
            return;
        }
        self.ensure_item(s, g, font);
        if cat.diakriet {
            scaled_dim = 0.0;
        }
        let begin = s.item.cursor();
        s.item.width += scaled_dim;
        let einde = s.item.cursor();
        if scaled_dim != 0.0 {
            let mut t = huidige_transform(g);
            t[4] += scaled_dim * g.m[0];
            t[5] += scaled_dim * g.m[1];
            s.item.prev_transform = Some(t);
        }
        if s.save_last_char(false) {
            let a = s.item.laatste_einde.min(begin);
            s.item.str.push(0x20);
            s.item.vakken.push((a, begin));
        }
        for &u in &g.unicode {
            s.item.str.push(u);
            s.item.vakken.push((begin, einde));
        }
        s.item.laatste_einde = einde;
    }
}

/// De tekstitems van een pagina. `view` = de paginabox van pdf.js
/// (CropBox ∩ MediaBox): [x0, y0, x1, y1].
pub fn items(view: [f64; 4], gebeurtenissen: &[Gebeurtenis]) -> Vec<Item> {
    let mut b = Bouwer { view, items: Vec::new() };
    let mut stapel = vec![Staat::nieuw()];
    for gb in gebeurtenissen {
        match gb {
            Gebeurtenis::Tekst { font, glyphs } => {
                let s = stapel.last_mut().expect("paginastaat");
                for g in glyphs {
                    // buildTextContentItem: een andere grootte of een ander
                    // font sluit het item af.
                    let sleutel = (*font, g.fs);
                    if let Some(h) = s.huidig_font {
                        if h != sleutel {
                            b.flush(s);
                        }
                    }
                    s.huidig_font = Some(sleutel);
                    b.glyph(s, g, *font);
                }
            }
            Gebeurtenis::FormulierIn => {
                let s = stapel.last_mut().expect("paginastaat");
                b.flush(s);
                stapel.push(Staat::nieuw());
            }
            Gebeurtenis::FormulierUit => {
                if stapel.len() > 1 {
                    let mut s = stapel.pop().expect("formulierstaat");
                    b.flush(&mut s);
                }
            }
            Gebeurtenis::Spoel => {
                let s = stapel.last_mut().expect("paginastaat");
                b.flush(s);
            }
        }
    }
    while let Some(mut s) = stapel.pop() {
        b.flush(&mut s);
    }
    b.items
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helvetica-achtige glyphs op een horizontale regel: (tekst, x, breedte).
    fn regel(stukken: &[(&str, f64)], y: f64, fs: f64, breedte: impl Fn(char) -> f64) -> Vec<Glyph> {
        let mut uit = Vec::new();
        for (tekst, x0) in stukken {
            let mut x = *x0;
            for c in tekst.chars() {
                let w = breedte(c) * fs / 1000.0;
                uit.push(Glyph { unicode: c.to_string().encode_utf16().collect(), x, y, m: [1.0, 0.0, 0.0, 1.0], fs, w });
                x += w;
            }
        }
        uit
    }

    fn strs(items: &[Item]) -> Vec<String> {
        items.iter().map(|i| String::from_utf16(&i.str).unwrap()).collect()
    }

    const VIEW: [f64; 4] = [0.0, 0.0, 612.0, 792.0];

    #[test]
    fn a_space_glyph_becomes_one_space_in_the_item() {
        let g = regel(&[("ab   cd", 72.0)], 700.0, 12.0, |c| if c == ' ' { 278.0 } else { 556.0 });
        let items = super::items(VIEW, &[Gebeurtenis::Tekst { font: 0, glyphs: g }]);
        // Drie spaties = 0,834 em: groter dan 0,6 em, dus een los spatie-item.
        assert_eq!(strs(&items), vec!["ab", " ", "cd"]);
        let g = regel(&[("ab cd", 72.0)], 700.0, 12.0, |c| if c == ' ' { 278.0 } else { 556.0 });
        let items = super::items(VIEW, &[Gebeurtenis::Tekst { font: 0, glyphs: g }]);
        assert_eq!(strs(&items), vec!["ab cd"]);
        assert!((items[0].width - 4.0 * 6.672 - 3.336).abs() < 1e-9);
    }

    #[test]
    fn a_new_line_ends_the_item_without_a_space() {
        let w = |_| 500.0;
        let mut g = regel(&[("one", 72.0)], 700.0, 12.0, w);
        g.extend(regel(&[("two", 72.0)], 684.0, 12.0, w));
        let items = super::items(VIEW, &[Gebeurtenis::Tekst { font: 0, glyphs: g }]);
        assert_eq!(strs(&items), vec!["one", "two"]);
        assert!(items[0].has_eol && !items[1].has_eol);
    }

    #[test]
    fn a_form_starts_with_its_own_state_and_flushes_the_page_item() {
        let w = |_| 500.0;
        let ev = vec![
            Gebeurtenis::Tekst { font: 0, glyphs: regel(&[("Before", 72.0)], 700.0, 12.0, w) },
            Gebeurtenis::FormulierIn,
            Gebeurtenis::Tekst { font: 0, glyphs: regel(&[("in", 150.0)], 700.0, 12.0, w) },
            Gebeurtenis::FormulierUit,
            Gebeurtenis::Tekst { font: 0, glyphs: regel(&[("after", 250.0)], 700.0, 12.0, w) },
        ];
        // Zoals pdf.js: het paginaitem vergelijkt "after" met het einde van
        // "Before" en zet er een los spatie-item voor.
        assert_eq!(strs(&items(VIEW, &ev)), vec!["Before", "in", " ", "after"]);
    }

    #[test]
    fn glyphs_outside_the_page_box_are_dropped() {
        let g = regel(&[("Starts outside", 10.0)], 650.0, 12.0, |_| 556.0);
        let items = super::items([50.0, 50.0, 562.0, 742.0], &[Gebeurtenis::Tekst { font: 0, glyphs: g }]);
        assert_eq!(strs(&items), vec!["s outside"]);
    }

    #[test]
    fn ligatures_are_normalised_and_split_their_box() {
        let g = vec![Glyph { unicode: vec![0xfb01], x: 72.0, y: 700.0, m: [1.0, 0.0, 0.0, 1.0], fs: 10.0, w: 5.56 }];
        let items = super::items(VIEW, &[Gebeurtenis::Tekst { font: 0, glyphs: g }]);
        assert_eq!(strs(&items), vec!["fi"]);
        assert_eq!(items[0].vakken.len(), 2);
        assert!((items[0].vakken[0].1 - 2.78).abs() < 1e-9 && (items[0].vakken[1].1 - 5.56).abs() < 1e-9);
    }

    #[test]
    fn a_font_size_change_starts_a_new_item() {
        let mut g = regel(&[("E=mc", 72.0)], 700.0, 12.0, |_| 500.0);
        let mut twee = regel(&[("2", 96.0)], 705.0, 8.0, |_| 500.0);
        g.append(&mut twee);
        let ev = vec![Gebeurtenis::Tekst { font: 0, glyphs: g }];
        assert_eq!(strs(&items(VIEW, &ev)), vec!["E=mc", "2"]);
    }
}
