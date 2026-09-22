//! Kleur, lijndikte en lijntype van een CAD-entiteit naar paginastijl (#400).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type Rgb = (u8, u8, u8);

/// Lijndikte als er niets is opgegeven (CAD-standaard).
pub const DEFAULT_LINEWEIGHT_MM: f64 = 0.25;

/// Drempel van "zuiver zwart-wit" als de aanroeper er geen geeft: de helft van
/// de helderheid. Rood, blauw en magenta blijven dan staan (in zwart); geel,
/// cyaan, groen en lichte grijzen vallen weg.
pub const DEFAULT_MONO_THRESHOLD_PCT: u8 = 50;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorMode {
    /// Kleuren volgens het bestand; wit en ACI 7 worden zwart op papier.
    #[default]
    File,
    /// Alles zwart.
    Black,
    /// Grijstinten naar helderheid.
    Gray,
    /// Zuiver zwart-wit: alles wat getekend wordt is zwart, zonder tussentint.
    /// Lijnen, tekst, patroonarceringen, brede polylijnen en pijlpunten
    /// blijven altijd staan. Een **effen vlakvulling** (SOLID, effen of
    /// verlopende arcering) waarvan de kleur uit het bestand lichter is dan de
    /// drempel, wordt weggelaten: zwart gemaakt zou ze alles bedekken wat
    /// eronder ligt, en wit is op papier hetzelfde als niets. Wat op of onder
    /// de drempel ligt wordt een zwart vlak. De drempel is een helderheid in
    /// procenten (0 = zwart, 100 = wit); bij 100 valt er niets weg.
    /// Afbeeldingen en maskers (WIPEOUT) blijven zoals ze zijn.
    Mono { threshold_pct: u8 },
    /// Alles in één eigen kleur: lijnen, tekst en vullingen. Maskers
    /// (WIPEOUT) blijven wit en afbeeldingen blijven zoals ze zijn.
    Single(Rgb),
}

fn luminance_of(r: f64, g: f64, b: f64) -> f64 {
    (0.299 * r + 0.587 * g + 0.114 * b) * 100.0 / 255.0
}

/// Helderheid van een kleur in hele procenten (0 = zwart, 100 = wit), met
/// dezelfde weging als de grijstinten.
pub fn luminance_pct(rgb: Rgb) -> u8 {
    luminance_of(rgb.0 as f64, rgb.1 as f64, rgb.2 as f64).round().clamp(0.0, 100.0) as u8
}

impl ColorMode {
    /// De kleurstand zoals het venster hem stuurt: de naam van de stand, en
    /// voor "zuiver zwart-wit" de drempel in procenten, voor "één kleur" de
    /// kleur als `#RRGGBB`. Een onbekende naam is "uit het bestand"; een
    /// onbruikbare drempel is de standaard; een onbruikbare kleur is zwart.
    pub fn from_args(name: Option<&str>, mono_threshold_pct: Option<f64>, single_color: Option<&str>) -> ColorMode {
        match name {
            Some("black") => ColorMode::Black,
            Some("gray") => ColorMode::Gray,
            Some("mono") => ColorMode::Mono {
                threshold_pct: mono_threshold_pct
                    .filter(|v| v.is_finite())
                    .map(|v| v.round().clamp(0.0, 100.0) as u8)
                    .unwrap_or(DEFAULT_MONO_THRESHOLD_PCT),
            },
            Some("single") => ColorMode::Single(single_color.and_then(PenTable::parse_color).unwrap_or((0, 0, 0))),
            _ => ColorMode::File,
        }
    }

    /// Valt een effen vlakvulling met deze kleur uit het bestand weg? Alleen
    /// in "zuiver zwart-wit", en alleen boven de drempel. Beoordeeld wordt de
    /// kleur zoals ze op wit papier zou staan: wit en ACI 7 zijn daar zwart
    /// (zoals in elke stand) en blijven dus staan, en een doorzichtige vulling
    /// (`alpha` < 1) is zoveel lichter als ze doorzichtig is. In zwart-wit
    /// bestaat geen doorzichtigheid: wat blijft, wordt dekkend zwart.
    pub fn drops_fill(&self, rgb: Rgb, is_aci_7: bool, alpha: f64) -> bool {
        match self {
            ColorMode::Mono { threshold_pct } => {
                let base = paper_color(rgb, is_aci_7, ColorMode::File);
                let a = if alpha.is_finite() { alpha.clamp(0.0, 1.0) } else { 1.0 };
                let on_paper = |c: u8| c as f64 * a + 255.0 * (1.0 - a);
                luminance_of(on_paper(base.0), on_paper(base.1), on_paper(base.2)).round() > *threshold_pct as f64
            }
            _ => false,
        }
    }

    /// Kent deze stand doorzichtigheid? "Zuiver zwart-wit" niet.
    pub fn keeps_transparency(&self) -> bool {
        !matches!(self, ColorMode::Mono { .. })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", tag = "mode", content = "value")]
pub enum LineweightMode {
    /// Diktes uit het bestand (entiteit, anders laag, anders standaard).
    File,
    /// Eén vaste dikte in mm.
    Fixed(f64),
    /// Uit de kleurentabel; een kleur zonder regel houdt de dikte van het
    /// bestand. Vervangt de pentabel die niet in het bestand staat.
    Pens,
}

impl Default for LineweightMode {
    fn default() -> Self {
        LineweightMode::File
    }
}

/// Kleur van een entiteit naar de kleur op papier.
pub fn paper_color(rgb: Rgb, is_aci_7: bool, mode: ColorMode) -> Rgb {
    let white = is_aci_7 || rgb == (255, 255, 255);
    match mode {
        ColorMode::Black | ColorMode::Mono { .. } => (0, 0, 0),
        ColorMode::Single(own) => own,
        ColorMode::File => {
            if white {
                (0, 0, 0)
            } else {
                rgb
            }
        }
        ColorMode::Gray => {
            if white {
                (0, 0, 0)
            } else {
                let l = (0.299 * rgb.0 as f64 + 0.587 * rgb.1 as f64 + 0.114 * rgb.2 as f64).round().clamp(0.0, 255.0) as u8;
                (l, l, l)
            }
        }
    }
}

/// Kleurentabel: welke lijndikte hoort bij welke kleur uit het bestand?
///
/// In CAD komt die koppeling uit een pentabel naast de tekening; die staat
/// niet in het bestand zelf. De gebruiker stelt hem hier in en bewaart hem als
/// voorinstelling. De tabel kijkt naar de kleur zoals het bestand hem geeft,
/// dus vóór "alles zwart" of "grijstinten".
///
/// Opzoeken gebeurt per getekende lijn, dus via een hashtabel en niet door de
/// regels af te lopen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PenTable {
    entries: HashMap<Rgb, f64>,
}

/// Hoogste aantal regels in een kleurentabel (werkgrens): ruim boven de 255
/// indexkleuren; wat daarna aan nieuwe kleuren komt, valt weg.
pub const MAX_PENS: usize = 1024;

impl PenTable {
    /// Bouwt de tabel; een regel met een onbruikbare dikte valt weg en een
    /// latere regel voor dezelfde kleur vervangt een eerdere.
    pub fn from_pairs(pairs: &[(Rgb, f64)]) -> PenTable {
        let mut entries: HashMap<Rgb, f64> = HashMap::new();
        for (rgb, mm) in pairs {
            if !mm.is_finite() || *mm < 0.0 || *mm > 10.0 {
                continue;
            }
            // Een bekende kleur wordt altijd bijgewerkt; een nieuwe kleur komt
            // er alleen bij zolang de tabel onder zijn grens zit.
            if entries.len() < MAX_PENS || entries.contains_key(rgb) {
                entries.insert(*rgb, *mm);
            }
        }
        PenTable { entries }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Aantal kleuren met een regel.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// De dikte in mm voor deze kleur, of `None` als er geen regel is.
    pub fn width_mm(&self, rgb: Rgb) -> Option<f64> {
        self.entries.get(&rgb).copied()
    }

    /// De dikste pen; nodig om te weten hoeveel ruimte de knip moet laten.
    pub fn widest_mm(&self) -> Option<f64> {
        self.entries.values().copied().fold(None, |acc: Option<f64>, v| Some(acc.map_or(v, |a| a.max(v))))
    }

    /// `#RRGGBB` of `RRGGBB` naar een kleur; alles anders is geen kleur.
    pub fn parse_color(text: &str) -> Option<Rgb> {
        let hex = text.strip_prefix('#').unwrap_or(text);
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |from: usize| u8::from_str_radix(hex.get(from..from + 2)?, 16).ok();
        Some((byte(0)?, byte(2)?, byte(4)?))
    }
}

/// Streepjespatroon voor PDF: lengtes in paginapunten plus de fase.
#[derive(Clone, Debug, PartialEq)]
pub struct Dash {
    pub array: Vec<f64>,
    pub phase: f64,
}

/// Zet een CAD-lijntypepatroon (positief = streep, negatief = spatie, 0 = punt)
/// om naar een PDF-streepjesreeks. `scale` is paginapunten per patroon-eenheid.
/// Geeft `None` voor een doorgetrokken lijn of een patroon dat op papier te
/// fijn is om nog als streepjes te tekenen.
pub fn pdf_dash(elements: &[f64], scale: f64) -> Option<Dash> {
    if elements.is_empty() || !(scale > 0.0) || !scale.is_finite() {
        return None;
    }
    let items: Vec<(bool, f64)> = elements
        .iter()
        .filter(|e| e.is_finite())
        .map(|&e| if e < 0.0 { (false, -e * scale) } else { (true, e * scale) })
        .collect();
    if items.is_empty() || items.iter().all(|i| i.0) || items.iter().all(|i| !i.0) {
        return None;
    }
    let total: f64 = items.iter().map(|i| i.1).sum();
    if !(total > 0.3) || !total.is_finite() {
        // Korter dan een derde punt: op papier niet van doorgetrokken te
        // onderscheiden, en het kost de lezer onnodig veel werk.
        return None;
    }
    let n = items.len();
    // Draai het patroon zodat het niet midden in een reeks gelijke stukken
    // begint; de fase houdt de oorspronkelijke start vast.
    let k = (0..n).find(|&i| items[i].0 != items[(i + n - 1) % n].0).unwrap_or(0);
    let mut head: f64 = items[..k].iter().map(|i| i.1).sum();
    let mut rotated: Vec<(bool, f64)> = items[k..].iter().chain(items[..k].iter()).copied().collect();
    if !rotated[0].0 {
        // Begin met een streep; de spatie verhuist naar het eind.
        let gap = rotated.remove(0);
        head += gap.1;
        rotated.push(gap);
    }
    // Gelijke buren samenvoegen.
    let mut merged: Vec<(bool, f64)> = Vec::with_capacity(rotated.len());
    for item in rotated {
        match merged.last_mut() {
            Some(last) if last.0 == item.0 => last.1 += item.1,
            _ => merged.push(item),
        }
    }
    if merged.len() % 2 == 1 {
        // Kan alleen als begin en eind dezelfde soort zijn; voeg ze samen.
        let last = merged.pop()?;
        merged[0].1 += last.1;
        head += last.1;
    }
    let array: Vec<f64> = merged.iter().map(|i| (i.1 * 1000.0).round() / 1000.0).collect();
    if array.iter().all(|v| *v <= 0.0) {
        return None;
    }
    let phase = ((total - head) % total + total) % total;
    Some(Dash { array, phase: (phase * 1000.0).round() / 1000.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn white_becomes_black_on_paper() {
        assert_eq!(paper_color((255, 255, 255), true, ColorMode::File), (0, 0, 0));
        assert_eq!(paper_color((255, 0, 0), false, ColorMode::File), (255, 0, 0));
        assert_eq!(paper_color((255, 0, 0), false, ColorMode::Black), (0, 0, 0));
        assert_eq!(paper_color((255, 0, 0), false, ColorMode::Gray), (76, 76, 76));
    }

    #[test]
    fn dashed_patterns_become_pdf_dash_arrays() {
        // DASHED: 12,7 tekenen, 6,35 spatie (bij schaal 1).
        let d = pdf_dash(&[12.7, -6.35], 1.0).unwrap();
        assert_eq!(d.array, vec![12.7, 6.35]);
        assert_eq!(d.phase, 0.0);
        // Begint met een spatie: die verhuist naar achteren en de fase houdt
        // het begin vast.
        let d = pdf_dash(&[-3.0, 5.0], 1.0).unwrap();
        assert_eq!(d.array, vec![5.0, 3.0]);
        assert_eq!(d.phase, 5.0);
        // Punt-streep (DASHDOT): punt wordt een streep van niets.
        let d = pdf_dash(&[12.7, -6.35, 0.0, -6.35], 1.0).unwrap();
        assert_eq!(d.array, vec![12.7, 6.35, 0.0, 6.35]);
        // Doorgetrokken en te fijn geven niets.
        assert_eq!(pdf_dash(&[1.0, 2.0], 1.0), None);
        assert_eq!(pdf_dash(&[], 1.0), None);
        assert_eq!(pdf_dash(&[0.5, -0.5], 0.01), None);
        // Schaal werkt door op lengtes én fase.
        let d = pdf_dash(&[-2.0, 4.0], 10.0).unwrap();
        assert_eq!(d.array, vec![40.0, 20.0]);
        assert_eq!(d.phase, 40.0);
    }
}

#[cfg(test)]
mod colour_mode_tests {
    use super::*;

    #[test]
    fn pure_black_and_white_draws_every_line_black() {
        let mono = ColorMode::Mono { threshold_pct: 50 };
        for rgb in [(255, 255, 0), (255, 0, 0), (200, 200, 200), (0, 0, 0)] {
            assert_eq!(paper_color(rgb, false, mono), (0, 0, 0), "{rgb:?}");
        }
        assert_eq!(paper_color((255, 255, 255), true, mono), (0, 0, 0));
    }

    #[test]
    fn pure_black_and_white_drops_fills_lighter_than_the_threshold() {
        let mono = ColorMode::Mono { threshold_pct: 50 };
        assert!(mono.drops_fill((255, 255, 0), false, 1.0), "geel is licht");
        assert!(mono.drops_fill((200, 200, 200), false, 1.0), "lichtgrijs");
        assert!(!mono.drops_fill((255, 0, 0), false, 1.0), "rood is donker genoeg");
        assert!(!mono.drops_fill((0, 0, 255), false, 1.0));
        // Wit en kleur 7 zijn op papier zwart, in elke stand: die blijven.
        assert!(!mono.drops_fill((255, 255, 255), false, 1.0));
        assert!(!mono.drops_fill((255, 255, 255), true, 1.0));
        // Precies op de drempel blijft staan; de drempel verschuift de grens.
        assert_eq!(luminance_pct((128, 128, 128)), 50);
        assert!(!mono.drops_fill((128, 128, 128), false, 1.0));
        assert!(ColorMode::Mono { threshold_pct: 49 }.drops_fill((128, 128, 128), false, 1.0));
        assert!(!ColorMode::Mono { threshold_pct: 100 }.drops_fill((255, 255, 0), false, 1.0), "bij 100% valt niets weg");
        assert!(ColorMode::Mono { threshold_pct: 0 }.drops_fill((0, 0, 255), false, 1.0));
        assert!(!ColorMode::Mono { threshold_pct: 0 }.drops_fill((0, 0, 0), false, 1.0), "zwart blijft altijd");
        // Een doorzichtige vulling is op papier lichter dan haar kleur.
        assert!(mono.drops_fill((255, 0, 0), false, 0.3), "rood op 30% dekking is licht");
        assert!(!mono.drops_fill((255, 0, 0), false, 0.9));
        assert!(mono.drops_fill((255, 255, 255), true, 0.2), "ook kleur 7, als ze bijna doorzichtig is");
        assert!(!mono.drops_fill((255, 0, 0), false, f64::NAN), "geen bruikbare dekking telt als dekkend");
        assert!(!mono.keeps_transparency() && ColorMode::Black.keeps_transparency());
        // De andere standen laten nooit een vulling weg.
        for mode in [ColorMode::File, ColorMode::Black, ColorMode::Gray, ColorMode::Single((10, 20, 30))] {
            assert!(!mode.drops_fill((255, 255, 0), false, 1.0), "{mode:?}");
        }
    }

    #[test]
    fn one_own_colour_is_used_for_everything() {
        let single = ColorMode::Single((0, 64, 128));
        for rgb in [(255, 255, 0), (255, 0, 0), (0, 0, 0), (255, 255, 255)] {
            assert_eq!(paper_color(rgb, false, single), (0, 64, 128));
        }
        assert_eq!(paper_color((255, 255, 255), true, single), (0, 64, 128));
    }

    #[test]
    fn the_colour_mode_is_read_from_the_window_arguments() {
        assert_eq!(ColorMode::from_args(Some("black"), None, None), ColorMode::Black);
        assert_eq!(ColorMode::from_args(Some("gray"), None, None), ColorMode::Gray);
        assert_eq!(ColorMode::from_args(Some("file"), None, None), ColorMode::File);
        assert_eq!(ColorMode::from_args(None, Some(10.0), Some("#FF0000")), ColorMode::File);
        assert_eq!(ColorMode::from_args(Some("mono"), None, None), ColorMode::Mono { threshold_pct: DEFAULT_MONO_THRESHOLD_PCT });
        assert_eq!(ColorMode::from_args(Some("mono"), Some(72.4), None), ColorMode::Mono { threshold_pct: 72 });
        assert_eq!(ColorMode::from_args(Some("mono"), Some(900.0), None), ColorMode::Mono { threshold_pct: 100 });
        assert_eq!(ColorMode::from_args(Some("mono"), Some(-3.0), None), ColorMode::Mono { threshold_pct: 0 });
        assert_eq!(
            ColorMode::from_args(Some("mono"), Some(f64::NAN), None),
            ColorMode::Mono { threshold_pct: DEFAULT_MONO_THRESHOLD_PCT }
        );
        assert_eq!(ColorMode::from_args(Some("single"), None, Some("#0A141E")), ColorMode::Single((10, 20, 30)));
        // Zonder bruikbare kleur blijft "één kleur" zwart, niet "uit het bestand".
        assert_eq!(ColorMode::from_args(Some("single"), None, Some("paars")), ColorMode::Single((0, 0, 0)));
        assert_eq!(ColorMode::from_args(Some("single"), None, None), ColorMode::Single((0, 0, 0)));
        assert_eq!(ColorMode::from_args(Some("iets anders"), None, None), ColorMode::File);
    }
}

#[cfg(test)]
mod pen_tests {
    use super::*;

    #[test]
    fn a_pen_table_maps_a_colour_to_a_width() {
        let table = PenTable::from_pairs(&[((255, 0, 0), 0.35), ((0, 0, 255), 0.13)]);
        assert_eq!(table.width_mm((255, 0, 0)), Some(0.35));
        assert_eq!(table.width_mm((0, 0, 255)), Some(0.13));
        assert_eq!(table.width_mm((0, 255, 0)), None, "een kleur zonder regel valt terug op het bestand");
        assert_eq!(table.widest_mm(), Some(0.35));
        assert!(PenTable::default().is_empty());
    }

    #[test]
    fn colours_are_read_from_text_and_a_later_rule_wins() {
        assert_eq!(PenTable::parse_color("#FF8000"), Some((255, 128, 0)));
        assert_eq!(PenTable::parse_color("ff8000"), Some((255, 128, 0)));
        assert_eq!(PenTable::parse_color("#FFF"), None, "alleen zes tekens");
        assert_eq!(PenTable::parse_color("rood"), None);
        // Twee regels voor dezelfde kleur: de laatste telt.
        let table = PenTable::from_pairs(&[((1, 2, 3), 0.2), ((1, 2, 3), 0.5)]);
        assert_eq!(table.width_mm((1, 2, 3)), Some(0.5));
        // Ongeldige diktes komen er niet in.
        let table = PenTable::from_pairs(&[((1, 2, 3), f64::NAN), ((4, 5, 6), -1.0)]);
        assert!(table.is_empty());
    }

    #[test]
    fn the_table_stops_at_its_limit_but_still_updates_a_known_colour() {
        let mut pairs: Vec<(Rgb, f64)> =
            (0..MAX_PENS + 10).map(|i| (((i % 256) as u8, (i / 256) as u8, 0), 0.25)).collect();
        pairs.push(((0, 0, 0), 0.7));
        let table = PenTable::from_pairs(&pairs);
        assert_eq!(table.len(), MAX_PENS);
        assert_eq!(table.width_mm((0, 0, 0)), Some(0.7), "een bekende kleur wordt ook voorbij de grens bijgewerkt");
        let beyond = MAX_PENS + 5;
        assert_eq!(table.width_mm(((beyond % 256) as u8, (beyond / 256) as u8, 0)), None);
        assert_eq!(table.widest_mm(), Some(0.7));
    }
}
