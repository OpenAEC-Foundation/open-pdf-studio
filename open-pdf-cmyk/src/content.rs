//! RGB-kleuroperatoren in een inhoudsstroom herschrijven naar CMYK.
//!
//! Alleen de kleuroperatoren veranderen; alle andere bytes (tekst, paden,
//! reële getallen, commentaar, ingebedde afbeeldingsgegevens) blijven exact
//! staan. Daarom werkt dit op tokens met hun bytepositie in plaats van de
//! stroom te ontleden en opnieuw op te bouwen.

use crate::lexer::{is_delim, is_ws, name_bytes, parse_object, Kind, Lexer, Tok};
use crate::report::Report;
use crate::space::{RgbSource, Space};
use lopdf::{Dictionary, Object};

/// Actieve kleurruimte voor vullen en lijnen, met de `q`/`Q`-stapel. Volgt de
/// betekenis van de ORIGINELE stroom: na `rg` is de ruimte RGB, ook al staat
/// er in de uitvoer inmiddels `k`.
#[derive(Clone, Debug)]
pub struct ColourState {
    fill: Space,
    stroke: Space,
    stack: Vec<(Space, Space)>,
}

impl Default for ColourState {
    fn default() -> Self {
        ColourState { fill: Space::Gray, stroke: Space::Gray, stack: Vec::new() }
    }
}

/// Een afbeelding in de stroom zelf (`BI … ID … EI`). Het woordenboek staat
/// er zoals het geschreven is, met afgekorte sleutels (`/W`, `/CS`, …).
pub struct InlineImage<'a> {
    pub dict: Dictionary,
    pub data: &'a [u8],
}

/// Wat er met een ingebedde afbeelding gebeurt.
pub enum InlineOutcome {
    /// Geen RGB: blijft zoals hij is.
    Keep,
    /// Omgezet: vervangt het hele `BI … EI`-blok.
    Replace(Vec<u8>),
    /// RGB, maar niet om te zetten (reden voor het verslag).
    Skip(&'static str),
}

/// Wat de herschrijver van zijn omgeving nodig heeft.
pub trait ContentEnv {
    /// Een benoemde kleurruimte uit `/Resources /ColorSpace`.
    fn named_space(&mut self, name: &[u8]) -> Space;
    /// Eén kleur omzetten.
    fn convert(&mut self, source: RgbSource, rgb: [f32; 3]) -> [f32; 4];
    /// Een ingebedde afbeelding.
    fn inline_image(&mut self, image: &InlineImage) -> InlineOutcome;
}

/// Herschrijft één inhoudsstroom (gedecodeerd). `state` loopt door over
/// opeenvolgende stromen van dezelfde pagina. Geeft `None` als er niets
/// veranderd is. Telt in `report.colour_operators` en `report.inline_images`.
pub fn rewrite(data: &[u8], state: &mut ColourState, env: &mut dyn ContentEnv, report: &mut Report) -> Option<Vec<u8>> {
    let mut lx = Lexer::new(data);
    let mut ops: Vec<Tok> = Vec::new();
    let mut edits: Vec<Edit> = Vec::new();
    while let Some(t) = lx.next_tok() {
        if t.kind != Kind::Word {
            ops.push(t);
            continue;
        }
        let word = &data[t.start..t.end];
        match word {
            b"true" | b"false" | b"null" => {
                ops.push(t);
                continue;
            }
            b"BI" => {
                inline_image(&mut lx, t.start, env, report, &mut edits);
                ops.clear();
                continue;
            }
            b"q" => state.stack.push((state.fill, state.stroke)),
            b"Q" => {
                if let Some((fill, stroke)) = state.stack.pop() {
                    state.fill = fill;
                    state.stroke = stroke;
                }
            }
            b"g" => state.fill = Space::Gray,
            b"G" => state.stroke = Space::Gray,
            b"k" => state.fill = Space::Cmyk,
            b"K" => state.stroke = Space::Cmyk,
            b"rg" | b"RG" => {
                let fill = word == b"rg";
                *state.slot(fill) = Space::Rgb(RgbSource::Srgb);
                match last_numbers(&ops, 3) {
                    Some((start, rgb)) => {
                        let cmyk = env.convert(RgbSource::Srgb, rgb);
                        let op = if fill { "k" } else { "K" };
                        edits.push(Edit { start, end: t.end, with: format!("{} {op}", fmt_cmyk(cmyk)).into_bytes() });
                        report.colour_operators.converted();
                    }
                    None => report.colour_operators.skipped("malformed"),
                }
            }
            b"cs" | b"CS" => {
                let fill = word == b"cs";
                let space = match ops.last() {
                    Some(n) if n.kind == Kind::Name => match name_bytes(&data[n.start..n.end]).as_slice() {
                        b"DeviceRGB" => {
                            let op = String::from_utf8_lossy(word);
                            edits.push(Edit { start: n.start, end: t.end, with: format!("/DeviceCMYK {op}").into_bytes() });
                            report.colour_operators.converted();
                            Space::Rgb(RgbSource::Srgb)
                        }
                        b"DeviceGray" => Space::Gray,
                        b"DeviceCMYK" => Space::Cmyk,
                        b"Pattern" => Space::Pattern(None),
                        other => env.named_space(other),
                    },
                    _ => {
                        report.colour_operators.skipped("malformed");
                        Space::Other
                    }
                };
                *state.slot(fill) = space;
            }
            b"sc" | b"scn" | b"SC" | b"SCN" => {
                let fill = word[0] == b's';
                match *state.slot(fill) {
                    Space::Rgb(source) => match last_numbers(&ops, 3) {
                        Some((start, rgb)) => {
                            let cmyk = env.convert(source, rgb);
                            let op = String::from_utf8_lossy(word);
                            edits.push(Edit { start, end: t.end, with: format!("{} {op}", fmt_cmyk(cmyk)).into_bytes() });
                            report.colour_operators.converted();
                        }
                        None => report.colour_operators.skipped("malformed"),
                    },
                    Space::Pattern(Some(source)) => match ops.split_last() {
                        // Alleen de patroonnaam: niets om te zetten.
                        Some((name, [])) if name.kind == Kind::Name => {}
                        Some((name, before)) if name.kind == Kind::Name => match last_numbers(before, 3) {
                            Some((start, rgb)) => {
                                let cmyk = env.convert(source, rgb);
                                let end = before[before.len() - 1].end;
                                edits.push(Edit { start, end, with: fmt_cmyk(cmyk).into_bytes() });
                                report.colour_operators.converted();
                            }
                            None => report.colour_operators.skipped("malformed"),
                        },
                        _ => report.colour_operators.skipped("malformed"),
                    },
                    _ => {}
                }
            }
            _ => {}
        }
        ops.clear();
    }
    apply_edits(data, edits)
}

impl ColourState {
    fn slot(&mut self, fill: bool) -> &mut Space {
        if fill {
            &mut self.fill
        } else {
            &mut self.stroke
        }
    }
}

struct Edit {
    start: usize,
    end: usize,
    with: Vec<u8>,
}

fn apply_edits(data: &[u8], mut edits: Vec<Edit>) -> Option<Vec<u8>> {
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|e| e.start);
    let mut out = Vec::with_capacity(data.len() + edits.len() * 4);
    let mut at = 0;
    for e in edits {
        if e.start < at {
            continue; // overlapt (kan niet, maar nooit dubbel schrijven)
        }
        out.extend_from_slice(&data[at..e.start]);
        out.extend_from_slice(&e.with);
        at = e.end;
    }
    out.extend_from_slice(&data[at..]);
    Some(out)
}

/// De laatste `n` operanden als getallen, met de beginpositie van de eerste.
fn last_numbers(ops: &[Tok], n: usize) -> Option<(usize, [f32; 3])> {
    if ops.len() < n {
        return None;
    }
    let tail = &ops[ops.len() - n..];
    let mut v = [0f32; 3];
    for (slot, t) in v.iter_mut().zip(tail) {
        match t.kind {
            Kind::Number(x) if x.is_finite() => *slot = x.clamp(0.0, 1.0),
            _ => return None,
        }
    }
    Some((tail[0].start, v))
}

/// Vier componenten, kort geschreven: `0`, `1`, `0.5`, `0.1235`.
pub(crate) fn fmt_cmyk(c: [f32; 4]) -> String {
    c.iter().map(|v| fmt_component(*v)).collect::<Vec<_>>().join(" ")
}

pub(crate) fn fmt_component(v: f32) -> String {
    let s = format!("{:.4}", v.clamp(0.0, 1.0));
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".to_string()
    } else {
        s.to_string()
    }
}

/// `BI … ID <gegevens> EI`: woordenboek lezen, einde van de gegevens vinden,
/// de omgeving laten beslissen. De lexer gaat verder ná `EI`.
fn inline_image(lx: &mut Lexer, bi_start: usize, env: &mut dyn ContentEnv, report: &mut Report, edits: &mut Vec<Edit>) {
    let data = lx.data;
    let mut toks = Vec::new();
    let id_end = loop {
        match lx.next_tok() {
            None => return,
            Some(t) if t.kind == Kind::Word && &data[t.start..t.end] == b"ID" => break t.end,
            Some(t) => toks.push(t),
        }
    };
    let mut dict = Dictionary::new();
    let mut i = 0;
    while i < toks.len() {
        let Some(Object::Name(key)) = parse_object(data, &toks, &mut i) else { continue };
        if let Some(value) = parse_object(data, &toks, &mut i) {
            dict.set(key, value);
        }
    }
    let mut start = id_end;
    if start < data.len() && is_ws(data[start]) {
        start += 1;
    }
    let Some((data_end, ei_end)) = inline_end(data, start, &dict, env) else {
        // Geen `EI`: de rest is afbeelding; niets meer herschrijven.
        lx.pos = data.len();
        return;
    };
    lx.pos = ei_end;
    let image = InlineImage { dict, data: &data[start..data_end] };
    match env.inline_image(&image) {
        InlineOutcome::Keep => {}
        InlineOutcome::Replace(with) => {
            edits.push(Edit { start: bi_start, end: ei_end, with });
            report.inline_images.converted();
        }
        InlineOutcome::Skip(reason) => report.inline_images.skipped(reason),
    }
}

fn ei_at(data: &[u8], p: usize) -> bool {
    data.get(p..p + 2) == Some(b"EI") && !matches!(data.get(p + 2), Some(&b) if !is_ws(b) && !is_delim(b))
}

/// (einde van de gegevens, einde van `EI`). Ongecomprimeerd volgt de lengte
/// uit het woordenboek; anders de eerste `EI` met witruimte ervoor en een
/// scheiding erna.
fn inline_end(data: &[u8], start: usize, dict: &Dictionary, env: &mut dyn ContentEnv) -> Option<(usize, usize)> {
    if let Some(len) = unfiltered_length(dict, env) {
        let end = start.saturating_add(len);
        if end <= data.len() {
            let mut p = end;
            while p < data.len() && is_ws(data[p]) {
                p += 1;
            }
            if ei_at(data, p) {
                return Some((end, p + 2));
            }
        }
    }
    let mut p = start;
    while p + 1 < data.len() {
        if (p == start || is_ws(data[p - 1])) && ei_at(data, p) {
            let end = if p > start && is_ws(data[p - 1]) { p - 1 } else { p };
            return Some((end, p + 2));
        }
        p += 1;
    }
    None
}

/// Woordenboekwaarde onder de volledige of de afgekorte sleutel.
pub(crate) fn inline_get<'a>(dict: &'a Dictionary, long: &[u8], short: &[u8]) -> Option<&'a Object> {
    dict.get(long).or_else(|_| dict.get(short)).ok()
}

fn unfiltered_length(dict: &Dictionary, env: &mut dyn ContentEnv) -> Option<usize> {
    match inline_get(dict, b"Filter", b"F") {
        None => {}
        Some(Object::Array(a)) if a.is_empty() => {}
        Some(_) => return None,
    }
    let w = inline_get(dict, b"Width", b"W")?.as_i64().ok()?;
    let h = inline_get(dict, b"Height", b"H")?.as_i64().ok()?;
    let mask = matches!(inline_get(dict, b"ImageMask", b"IM"), Some(Object::Boolean(true)));
    let (comps, bpc) = if mask {
        (1, 1)
    } else {
        let bpc = inline_get(dict, b"BitsPerComponent", b"BPC").and_then(|o| o.as_i64().ok()).unwrap_or(8);
        let comps = match inline_get(dict, b"ColorSpace", b"CS")? {
            Object::Name(n) => match n.as_slice() {
                b"G" | b"DeviceGray" => 1,
                b"RGB" | b"DeviceRGB" => 3,
                b"CMYK" | b"DeviceCMYK" => 4,
                b"I" | b"Indexed" => 1,
                other => match env.named_space(other) {
                    Space::Gray | Space::IndexedRgb => 1,
                    Space::Rgb(_) => 3,
                    Space::Cmyk => 4,
                    _ => return None,
                },
            },
            Object::Array(a) => match a.first().and_then(|o| o.as_name().ok())? {
                b"I" | b"Indexed" | b"CalGray" => 1,
                b"CalRGB" | b"Lab" => 3,
                _ => return None,
            },
            _ => return None,
        };
        (comps, bpc)
    };
    if w <= 0 || h <= 0 || !(1..=16).contains(&bpc) {
        return None;
    }
    let row = (w as usize).checked_mul(comps)?.checked_mul(bpc as usize)?.div_ceil(8);
    row.checked_mul(h as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::{CmykTransform, NaiveCmyk};
    use lopdf::Object;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Env {
        named: HashMap<Vec<u8>, Space>,
        sources: Vec<RgbSource>,
        inline: Vec<(Dictionary, Vec<u8>)>,
        inline_answer: Option<fn(&InlineImage) -> InlineOutcome>,
    }

    impl ContentEnv for Env {
        fn named_space(&mut self, name: &[u8]) -> Space {
            self.named.get(name).copied().unwrap_or(Space::Other)
        }
        fn convert(&mut self, source: RgbSource, rgb: [f32; 3]) -> [f32; 4] {
            self.sources.push(source);
            NaiveCmyk.rgb_to_cmyk(rgb)
        }
        fn inline_image(&mut self, image: &InlineImage) -> InlineOutcome {
            self.inline.push((image.dict.clone(), image.data.to_vec()));
            match self.inline_answer {
                Some(f) => f(image),
                None => InlineOutcome::Keep,
            }
        }
    }

    fn run(input: &str, env: &mut Env) -> (Option<String>, Report) {
        let mut report = Report::default();
        let mut state = ColourState::default();
        let out = rewrite(input.as_bytes(), &mut state, env, &mut report);
        (out.map(|b| String::from_utf8(b).unwrap()), report)
    }

    #[test]
    fn rg_and_rg_stroke_become_k_and_k_stroke() {
        let (out, report) = run("1 0 0 rg 0 0 1 RG 10 10 m 20 20 l S", &mut Env::default());
        assert_eq!(out.as_deref(), Some("0 1 1 0 k 1 1 0 0 K 10 10 m 20 20 l S"));
        assert_eq!(report.colour_operators.converted, 2);
    }

    #[test]
    fn fractions_are_written_short_and_clamped() {
        let (out, _) = run("0.5 0.5 0.5 rg 1.7 -2 0 RG", &mut Env::default());
        assert_eq!(out.as_deref(), Some("0 0 0 0.5 k 0 1 1 0 K"));
    }

    #[test]
    fn device_rgb_colour_space_operand_and_sc_follow() {
        let (out, _) = run("/DeviceRGB cs 0 1 0 sc /DeviceRGB CS 0 0 0 SCN", &mut Env::default());
        assert_eq!(out.as_deref(), Some("/DeviceCMYK cs 1 0 1 0 sc /DeviceCMYK CS 0 0 0 1 SCN"));
    }

    #[test]
    fn gray_and_cmyk_stay_untouched() {
        let (out, report) = run("0.5 g 0.2 G 0 0 0 1 k /DeviceGray cs 0.3 sc", &mut Env::default());
        assert_eq!(out, None);
        assert_eq!(report.colour_operators, Default::default());
    }

    #[test]
    fn q_and_big_q_restore_the_colour_space() {
        let (out, _) = run("/DeviceRGB cs q /DeviceGray cs 0.5 sc Q 1 1 1 sc", &mut Env::default());
        assert_eq!(out.as_deref(), Some("/DeviceCMYK cs q /DeviceGray cs 0.5 sc Q 0 0 0 0 sc"));
    }

    #[test]
    fn unbalanced_big_q_does_not_panic() {
        let (out, _) = run("Q Q 1 0 0 rg", &mut Env::default());
        assert_eq!(out.as_deref(), Some("Q Q 0 1 1 0 k"));
    }

    #[test]
    fn named_rgb_space_keeps_its_name_but_values_convert_with_its_source() {
        let mut env = Env::default();
        let icc = RgbSource::Icc((7, 0));
        env.named.insert(b"CS0".to_vec(), Space::Rgb(icc));
        let (out, _) = run("/CS0 cs 1 0 0 scn", &mut env);
        // De naam blijft; de resource zelf wordt elders vervangen.
        assert_eq!(out.as_deref(), Some("/CS0 cs 0 1 1 0 scn"));
        assert_eq!(env.sources, [icc]);
    }

    #[test]
    fn indexed_values_are_indices_and_stay() {
        let mut env = Env::default();
        env.named.insert(b"CS1".to_vec(), Space::IndexedRgb);
        let (out, _) = run("/CS1 cs 5 scn", &mut env);
        assert_eq!(out, None);
    }

    #[test]
    fn uncoloured_pattern_on_rgb_converts_the_components_before_the_name() {
        let mut env = Env::default();
        env.named.insert(b"P".to_vec(), Space::Pattern(Some(RgbSource::Srgb)));
        env.named.insert(b"PC".to_vec(), Space::Pattern(None));
        let (out, report) = run("/P cs 1 0 0 /Pat0 scn /PC CS /Pat1 SCN", &mut env);
        assert_eq!(out.as_deref(), Some("/P cs 0 1 1 0 /Pat0 scn /PC CS /Pat1 SCN"));
        assert_eq!(report.colour_operators.converted, 1);
    }

    #[test]
    fn strings_and_comments_are_not_operators() {
        let src = "BT (1 0 0 rg) Tj <3120302030207267> Tj ET % 1 0 0 rg\n0 1 0 rg";
        let (out, _) = run(src, &mut Env::default());
        assert_eq!(
            out.as_deref(),
            Some("BT (1 0 0 rg) Tj <3120302030207267> Tj ET % 1 0 0 rg\n1 0 1 0 k")
        );
    }

    #[test]
    fn nested_and_escaped_parentheses_in_strings() {
        let (out, _) = run(r"(a (b) \) 1 0 0 rg) Tj 1 1 0 rg", &mut Env::default());
        assert_eq!(out.as_deref(), Some(r"(a (b) \) 1 0 0 rg) Tj 0 0 1 0 k"));
    }

    #[test]
    fn malformed_colour_operators_are_left_and_reported() {
        let (out, report) = run("1 0 rg /X 0 0 RG", &mut Env::default());
        assert_eq!(out, None);
        assert_eq!(report.colour_operators.skipped.get("malformed"), Some(&2));
    }

    #[test]
    fn inline_image_data_is_skipped_even_when_it_contains_operator_bytes() {
        let mut env = Env::default();
        // Ongecomprimeerd: de lengte volgt uit /W, /H, /BPC en /CS, dus ook een
        // " EI" en "rg" midden in de gegevens tellen niet.
        let src = b"BI /W 6 /H 1 /BPC 8 /CS /G ID rg EI \nEI 1 0 0 rg".to_vec();
        let mut report = Report::default();
        let out = rewrite(&src, &mut ColourState::default(), &mut env, &mut report).unwrap();
        assert_eq!(out, b"BI /W 6 /H 1 /BPC 8 /CS /G ID rg EI \nEI 0 1 1 0 k".to_vec());
        assert_eq!(env.inline.len(), 1);
        assert_eq!(env.inline[0].1, b"rg EI ");
        assert_eq!(env.inline[0].0.get(b"CS").unwrap(), &Object::Name(b"G".to_vec()));
    }

    #[test]
    fn filtered_inline_image_ends_at_a_delimited_ei() {
        let mut env = Env::default();
        // "EI" midden in de gegevens telt niet: er staat geen witruimte omheen.
        let src = b"BI /W 1 /H 1 /CS /RGB /F /AHx ID 0AEIFF> EI Q".to_vec();
        let mut report = Report::default();
        let _ = rewrite(&src, &mut ColourState::default(), &mut env, &mut report);
        assert_eq!(env.inline[0].1, b"0AEIFF>");
    }

    #[test]
    fn inline_image_replacement_and_skip_are_counted() {
        let mut env = Env {
            inline_answer: Some(|img| {
                if img.dict.get(b"W").and_then(|w| w.as_i64()).ok() == Some(1) {
                    InlineOutcome::Replace(b"BI /W 1 /H 1 /CS /CMYK /BPC 8 ID \x00\x00\x00\x00 EI".to_vec())
                } else {
                    InlineOutcome::Skip("unsupportedFilter")
                }
            }),
            ..Default::default()
        };
        let src = b"q BI /W 1 /H 1 /BPC 8 /CS /RGB ID \xff\x00\x00 EI Q BI /W 2 /H 1 /CS /RGB /F /LZW ID xx EI".to_vec();
        let mut report = Report::default();
        let out = rewrite(&src, &mut ColourState::default(), &mut env, &mut report).unwrap();
        assert_eq!(
            out,
            b"q BI /W 1 /H 1 /CS /CMYK /BPC 8 ID \x00\x00\x00\x00 EI Q BI /W 2 /H 1 /CS /RGB /F /LZW ID xx EI".to_vec()
        );
        assert_eq!(report.inline_images.converted, 1);
        assert_eq!(report.inline_images.skipped.get("unsupportedFilter"), Some(&1));
    }

    #[test]
    fn inline_dictionary_values_are_parsed() {
        let mut env = Env::default();
        let src = b"BI /W 1 /H 1 /BPC 8 /CS [/I /RGB 1 <FF000000FF00>] /D [1 0] /DP << /Predictor 15 >> ID \x00 EI";
        let mut report = Report::default();
        let _ = rewrite(src, &mut ColourState::default(), &mut env, &mut report);
        let dict = &env.inline[0].0;
        let cs = dict.get(b"CS").unwrap().as_array().unwrap();
        assert_eq!(cs[0], Object::Name(b"I".to_vec()));
        assert_eq!(cs[3].as_str().unwrap(), &[0xFF, 0, 0, 0, 0xFF, 0]);
        assert_eq!(dict.get(b"DP").unwrap().as_dict().unwrap().get(b"Predictor").unwrap().as_i64().unwrap(), 15);
        assert_eq!(dict.get(b"D").unwrap().as_array().unwrap().len(), 2);
    }

    #[test]
    fn state_carries_over_to_the_next_stream_of_the_same_page() {
        let mut env = Env::default();
        let mut state = ColourState::default();
        let mut report = Report::default();
        let first = rewrite(b"/DeviceRGB cs", &mut state, &mut env, &mut report);
        let second = rewrite(b"1 0 0 sc", &mut state, &mut env, &mut report);
        assert_eq!(first.as_deref(), Some(&b"/DeviceCMYK cs"[..]));
        assert_eq!(second.as_deref(), Some(&b"0 1 1 0 sc"[..]));
    }

    #[test]
    fn hex_escaped_names_are_decoded() {
        let (out, _) = run("/Device#52GB cs 1 1 1 sc", &mut Env::default());
        assert_eq!(out.as_deref(), Some("/DeviceCMYK cs 0 0 0 0 sc"));
    }
}
