//! Beslissingen van de Windows-printkern per opdracht en per pagina, puur en
//! dus zonder printer te testen (issue 699).
//!
//! Een virtuele PDF-printer met een eigen begeleidend programma (dat per
//! opdracht een opslaanvenster toont) liep vast op wat de app stuurde, terwijl
//! andere programma's er gewoon op printen. Gewone programma's sturen zo'n
//! printer één papiercode met één oriëntatie per opdracht en geen `ResetDC`
//! tussen de pagina's. Daarom, voor een printer die een document schrijft
//! (`print_instelling::schrijft_document`):
//!
//! - een standaardvel (A0–A5, Letter, Legal, Tabloid, op een paar mm na)
//!   gaat met zijn papiercode en de liggende stand, niet als eigen maat
//!   (`vel_is_standaard`, `liggende_weg`);
//! - een eigen maat (`DMPAPER_USER`) alleen als geen standaardvel past én
//!   het stuurprogramma eigen maten aanbiedt (`eigen_maat_ondersteund`);
//! - één vel en één stand voor de hele opdracht: geen `ResetDC` halverwege
//!   (`reset_tussen_paginas`, `plan_opdracht`). Een pagina die de andere kant
//!   op staat, gaat een kwartslag gedraaid op dat vel
//!   (`print_plaatsing::draaiing_voor_vel`, dezelfde regel als wanneer een
//!   stuurprogramma de stand niet overneemt);
//! - het driverdeel van een bewaarde DEVMODE alleen als het bij dit
//!   stuurprogramma past (`driverdeel_past`), anders alleen de publieke
//!   velden op de verse standaard van de driver.
//!
//! De ingebouwde pdf- en xps-stuurprogramma's van Windows kunnen een
//! `ResetDC` tussen pagina's wel aan (de proeven in `print_windows` printen
//! zo gemengde opdrachten); die houden het gedrag van altijd. Papieren
//! printers ook: daar wisselt een opdracht per pagina van stand, zoals vóór
//! deze regels.
//!
//! Beide regels zijn in de omgeving om te zetten, om bij een stuurprogramma
//! dat zich anders gedraagt zonder nieuwe versie terug te kunnen:
//! `OPDS_RESETDC` (`reset_tussen_paginas`) en `OPDS_LIGGEND_VEL`
//! (`liggend_vel_modus`).

use crate::print_instelling::{zelfde_maat_mm, Papier};

/// `DMPAPER_USER`: de eerste code die geen standaardvel van Windows is.
const DMPAPER_USER: i16 = 256;

/// De omgevingsvariabele die `ResetDC` tussen pagina's afdwingt (1, aan) of
/// verbiedt (0, uit), ongeacht de printer.
pub const RESETDC_OMGEVING: &str = "OPDS_RESETDC";

/// Een aan/uit-waarde uit de omgeving: `Some(false)` voor 0/uit/off/false/nee,
/// `Some(true)` voor 1/aan/on/true/ja/altijd, `None` voor al het andere
/// (leeg, ontbrekend, onzin): dan de standaardregel.
fn schakelaar(waarde: Option<&str>) -> Option<bool> {
    match waarde?.trim().to_ascii_lowercase().as_str() {
        "0" | "uit" | "off" | "false" | "nee" | "no" => Some(false),
        "1" | "aan" | "on" | "true" | "ja" | "yes" | "altijd" | "always" => Some(true),
        _ => None,
    }
}

/// Is dit het ingebouwde pdf- of xps-stuurprogramma van Windows? Die
/// schrijven een document maar kunnen een `ResetDC` tussen pagina's aan.
pub fn windows_eigen_documentschrijver(stuurprogramma: &str) -> bool {
    let s = stuurprogramma.trim().to_ascii_lowercase();
    s.starts_with("microsoft print to pdf") || s.starts_with("microsoft xps document writer")
}

/// Mag de opdracht tussen pagina's van stand wisselen met `ResetDC`?
///
/// Ja bij een papieren printer (en als stuurprogramma en poort onbekend
/// zijn: `schrijft_document` is dan `false`), en bij de ingebouwde
/// documentschrijvers van Windows. Nee bij elke andere printer die een
/// document schrijft: die krijgt één stand voor de hele opdracht.
/// `omgeving` (`OPDS_RESETDC`) gaat voor.
pub fn reset_tussen_paginas(schrijft_document: bool, stuurprogramma: Option<&str>, omgeving: Option<&str>) -> bool {
    if let Some(keuze) = schakelaar(omgeving) {
        return keuze;
    }
    !schrijft_document || stuurprogramma.is_some_and(windows_eigen_documentschrijver)
}

/// Het vel van één pagina.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaginaPlan {
    /// Met welke DEVMODE (staand of liggend) deze pagina geprint wordt.
    pub liggend_vel: bool,
    /// Wisselt het vel ten opzichte van de vorige pagina (de eerste: ten
    /// opzichte van de DEVMODE waarmee de DC gemaakt is)?
    pub reset: bool,
}

/// Het plan van een opdracht: met welke DEVMODE de DC begint en welk vel
/// elke pagina krijgt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpdrachtPlan {
    pub begin_liggend: bool,
    /// Wisselt het vel tussen pagina's (`ResetDC`)? Zo niet, dan krijgt elke
    /// pagina het beginvel.
    pub reset_mag: bool,
    pub paginas: Vec<PaginaPlan>,
}

/// Het plan voor een opdracht met per pagina of ze liggend moet (`liggend`).
///
/// - Wisselen mag (`reset_mag`) en de liggende DEVMODE is een andere dan de
///   staande: de DC begint met de stand van de eerste pagina en wisselt
///   alleen waar de volgende pagina de andere kant op staat (het gedrag van
///   altijd).
/// - De twee DEVMODE's zijn gelijk (`devmodes_gelijk`, het stuurprogramma
///   kent geen stand): wisselen verandert niets, dus nooit.
/// - Wisselen mag niet: één vel voor de hele opdracht, in de stand van de
///   meeste pagina's (gelijkspel: die van de eerste). De andere pagina's
///   gaan gedraaid op dat vel.
pub fn plan_opdracht(liggend: &[bool], reset_mag: bool, devmodes_gelijk: bool) -> OpdrachtPlan {
    let Some(&eerste) = liggend.first() else {
        return OpdrachtPlan { begin_liggend: false, reset_mag: false, paginas: Vec::new() };
    };
    let wisselen = reset_mag && !devmodes_gelijk;
    let begin = if wisselen || devmodes_gelijk { eerste } else { meerderheid(liggend) };
    let mut vorige = begin;
    let paginas = liggend
        .iter()
        .map(|&l| {
            let doel = if wisselen { l } else { begin };
            let plan = PaginaPlan { liggend_vel: doel, reset: doel != vorige };
            vorige = doel;
            plan
        })
        .collect();
    OpdrachtPlan { begin_liggend: begin, reset_mag: wisselen, paginas }
}

/// Liggen de meeste pagina's? Bij gelijkspel de stand van de eerste.
fn meerderheid(liggend: &[bool]) -> bool {
    let n = liggend.iter().filter(|&&l| l).count();
    let staand = liggend.len() - n;
    if n == staand {
        liggend.first().copied().unwrap_or(false)
    } else {
        n > staand
    }
}

/// Krijgt de DC vóór pagina `pagina` een `ResetDC`?
///
/// Vóór de eerste pagina alleen op de noodweg (de DC is zonder DEVMODE
/// gemaakt): als het papier daar nog gezet moet worden
/// (`nood_papier_zetten`), of als de DC de andere kant op staat. Daarna
/// alleen als wisselen mag en de DC nu een ander vel heeft dan het plan
/// vraagt. Weigert de driver een `ResetDC`, dan blijft `dc_liggend` staan en
/// probeert de volgende pagina het opnieuw.
pub fn reset_nodig(pagina: usize, doel_liggend: bool, dc_liggend: bool, reset_mag: bool, nood_papier_zetten: bool) -> bool {
    if pagina == 0 {
        nood_papier_zetten || doel_liggend != dc_liggend
    } else {
        reset_mag && doel_liggend != dc_liggend
    }
}

/// De standaardvellen die een papiercode met een stand krijgen. De verlengde
/// vellen (A3L, ...) horen er niet bij: die bestaan alleen als eigen maat of
/// als formulier. De US-tekenvellen wel: plotters bieden ze meestal onder
/// een eigen code aan, zoals A1 en A0.
const STANDAARD_VELLEN: [Papier; 18] = [
    Papier::A0,
    Papier::A1,
    Papier::A2,
    Papier::A3,
    Papier::A4,
    Papier::A5,
    Papier::Letter,
    Papier::Legal,
    Papier::Tabloid,
    Papier::ArchA,
    Papier::ArchB,
    Papier::ArchC,
    Papier::ArchD,
    Papier::ArchE,
    Papier::ArchE1,
    Papier::AnsiC,
    Papier::AnsiD,
    Papier::AnsiE,
];

/// Speling bij het herkennen van een standaardvel uit een nagemeten vel:
/// drivers ronden af op hun resolutie.
const STANDAARD_SPELING_MM: f64 = 3.0;

/// Het standaardvel met deze maat (mm, in willekeurige volgorde), of `None`.
pub fn standaardvel(vel_mm: (f64, f64)) -> Option<Papier> {
    STANDAARD_VELLEN.iter().copied().find(|p| {
        p.staande_maat_mm().is_some_and(|maat| zelfde_maat_mm(vel_mm, maat, STANDAARD_SPELING_MM))
    })
}

/// Is het vel van de staande DEVMODE een standaardvel? Dan krijgen liggende
/// pagina's de papiercode met de liggende stand, zoals gewone programma's
/// het sturen, en geen eigen maat.
///
/// Ja als de DEVMODE een papiercode van Windows heeft (1 tot en met 255;
/// `DMPAPER_USER` en driver-eigen codes niet), of als het nagemeten vel
/// (`vel_mm`, breedte x hoogte in mm) in welke stand ook een standaardvel is
/// (A1 en A0 hebben geen code van Windows maar vaak een van de driver).
pub fn vel_is_standaard(papiercode: Option<i16>, vel_mm: Option<(f64, f64)>) -> bool {
    papiercode.is_some_and(|c| (1..DMPAPER_USER).contains(&c)) || vel_mm.and_then(standaardvel).is_some()
}

/// De grootste eigen maat uit `DeviceCapabilitiesW(DC_MAXEXTENT)`: een
/// `POINTS` in de terugkeerwaarde, breedte in het lage en lengte in het hoge
/// woord, in 0,1 mm. `None` bij een fout (-1), bij 0 en bij een maat die niet
/// positief is (ook een maat boven 3276,7 mm, die niet in een `i16` past).
pub fn max_extent_uit(terug: i32) -> Option<(i32, i32)> {
    if terug == -1 || terug == 0 {
        return None;
    }
    let woord = terug as u32;
    let x = (woord & 0xFFFF) as u16 as i16 as i32;
    let y = (woord >> 16) as u16 as i16 as i32;
    (x > 0 && y > 0).then_some((x, y))
}

/// Biedt het stuurprogramma een eigen maat van `maat` (`dmPaperWidth`,
/// `dmPaperLength` in 0,1 mm) aan?
///
/// Meldt het een grootste eigen maat (`max_extent`, `DC_MAXEXTENT`), dan moet
/// de maat daarbinnen passen; dat `DC_MAXEXTENT` iets meldt is zelf het
/// teken dat de DEVMODE eigen maten kan dragen. Meldt het niets, dan alleen
/// als `DMPAPER_USER` in zijn papierlijst staat (`DC_PAPERS`).
pub fn eigen_maat_ondersteund(user_in_lijst: bool, max_extent: Option<(i32, i32)>, maat: (i32, i32)) -> bool {
    match max_extent {
        Some((max_breedte, max_lengte)) => maat.0 > 0 && maat.1 > 0 && maat.0 <= max_breedte && maat.1 <= max_lengte,
        None => user_in_lijst,
    }
}

/// Wat `OPDS_LIGGEND_VEL` zegt over het liggende vel bij een printer die een
/// document schrijft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiggendVelModus {
    /// Niet gezet: een liggend vel (papiersoort of eigen maat) alleen als het
    /// vel geen standaardvel is.
    Standaard,
    /// 0/uit: altijd de liggende stand.
    Uit,
    /// 1/aan/altijd: zoals vóór issue 699, ook voor standaardvellen eerst
    /// een liggend vel, en een eigen maat zonder te kijken of het
    /// stuurprogramma die aanbiedt.
    Altijd,
}

pub fn liggend_vel_modus(waarde: Option<&str>) -> LiggendVelModus {
    match schakelaar(waarde) {
        Some(false) => LiggendVelModus::Uit,
        Some(true) => LiggendVelModus::Altijd,
        None => LiggendVelModus::Standaard,
    }
}

/// Hoe de liggende pagina's van een opdracht hun vel krijgen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiggendPlan {
    /// De papiercode van het staande vel met de liggende stand, met de reden.
    Stand(&'static str),
    /// Eerst een liggende papiersoort van het stuurprogramma, dan een eigen
    /// maat (als die mag); lukt geen van beide, alsnog de stand.
    LiggendVel,
}

/// De weg voor de liggende pagina's. `schrijft_document` `None` = stuurprogramma
/// en poort onbekend; `vel_standaard` uit `vel_is_standaard`.
pub fn liggende_weg(schrijft_document: Option<bool>, modus: LiggendVelModus, vel_standaard: bool) -> LiggendPlan {
    match (modus, schrijft_document) {
        (LiggendVelModus::Uit, _) => LiggendPlan::Stand("uitgezet in de omgeving"),
        (_, None) => LiggendPlan::Stand("stuurprogramma en poort onbekend"),
        (_, Some(false)) => LiggendPlan::Stand("papieren printer"),
        (LiggendVelModus::Standaard, Some(true)) if vel_standaard => LiggendPlan::Stand("standaardvel"),
        _ => LiggendPlan::LiggendVel,
    }
}

/// De kop van een DEVMODE: wat bepaalt of het driverdeel bij een
/// stuurprogramma hoort.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevmodeKop {
    /// `dmDeviceName`.
    pub naam: String,
    pub spec_versie: u16,
    pub driver_versie: u16,
    /// `dmSize`.
    pub grootte: u16,
    /// `dmDriverExtra`.
    pub driver_extra: u16,
}

/// Mag het driverdeel van een bewaarde DEVMODE (`opgeslagen`) mee naar het
/// stuurprogramma? Alleen als het van precies dit stuurprogramma in deze
/// versie komt: dezelfde naam (hoofdletters tellen niet), specificatie-
/// en driverversie, publieke grootte en driverdeelgrootte als de verse
/// standaard (`standaard`, `DocumentPropertiesW` met de printerhandle van
/// deze opdracht). Anders gaan alleen de publieke velden mee
/// (`DevMode::met_publiek_van`).
pub fn driverdeel_past(opgeslagen: &DevmodeKop, standaard: &DevmodeKop) -> bool {
    opgeslagen.naam.trim().eq_ignore_ascii_case(standaard.naam.trim())
        && opgeslagen.spec_versie == standaard.spec_versie
        && opgeslagen.driver_versie == standaard.driver_versie
        && opgeslagen.grootte == standaard.grootte
        && opgeslagen.driver_extra == standaard.driver_extra
}

#[cfg(test)]
mod tests {
    use super::*;

    // De beslistabellen staan als tekst, zodat js/pdf/print-plan-bron.test.mjs
    // dezelfde regels leest en nagaat (de Rust-tests van de bibliotheek
    // draaien niet op elke machine). Kolommen gescheiden door `|`.

    /// pagina's (S/L) | reset mag | devmodes gelijk | begin | vel per pagina | reset per pagina (x/.)
    const PLAN_TABEL: &str = "
S    | ja  | nee | S | S    | .
SLS  | ja  | nee | S | SLS  | .xx
LLS  | ja  | nee | L | LLS  | ..x
SLS  | ja  | ja  | S | SSS  | ...
SLS  | nee | nee | S | SSS  | ...
SLL  | nee | nee | L | LLL  | ...
LSS  | nee | nee | S | SSS  | ...
SL   | nee | nee | S | SS   | ..
LS   | nee | nee | L | LL   | ..
LLLL | nee | nee | L | LLLL | ....
";

    /// document | stuurprogramma | omgeving | reset tussen pagina's
    const RESET_TABEL: &str = "
nee | Kantoorprinter PCL6              | -     | ja
nee | -                                | -     | ja
ja  | Een PDF-printer                  | -     | nee
ja  | -                                | -     | nee
ja  | Microsoft Print To PDF           | -     | ja
ja  | Microsoft XPS Document Writer v4 | -     | ja
ja  | Een PDF-printer                  | 1     | ja
ja  | Een PDF-printer                  | aan   | ja
nee | Kantoorprinter PCL6              | 0     | nee
ja  | Microsoft Print To PDF           | uit   | nee
ja  | Een PDF-printer                  | onzin | nee
";

    /// papiercode | vel in mm | standaard
    const STANDAARD_TABEL: &str = "
9   | -           | ja
8   | 297x420     | ja
255 | -           | ja
256 | 297x630     | nee
256 | 210x297     | ja
300 | 594x841     | ja
300 | 841x594     | ja
300 | 297x630     | nee
-   | 841x1189    | ja
-   | 1189x841    | ja
-   | 279.4x431.8 | ja
-   | 216x356     | ja
-   | 300x300     | nee
-   | -           | nee
0   | -           | nee
";

    /// DMPAPER_USER in de lijst | grootste eigen maat | maat | eigen maat mag
    const EIGEN_MAAT_TABEL: &str = "
nee | -          | 2970x6300 | nee
ja  | -          | 2970x6300 | ja
nee | 9140x15000 | 2970x6300 | ja
ja  | 3000x5000  | 2970x6300 | nee
nee | 3000x5000  | 6300x2970 | nee
ja  | 9140x15000 | 6300x2970 | ja
";

    /// document | omgeving | standaardvel | weg
    const LIGGEND_TABEL: &str = "
nee      | -      | ja  | stand
nee      | -      | nee | stand
onbekend | -      | nee | stand
ja       | -      | ja  | stand
ja       | -      | nee | vel
ja       | 0      | nee | stand
ja       | uit    | ja  | stand
ja       | 1      | ja  | vel
ja       | altijd | nee | vel
nee      | altijd | nee | stand
";

    fn rijen(tabel: &str) -> Vec<Vec<&str>> {
        tabel
            .lines()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(|r| r.split('|').map(str::trim).collect())
            .collect()
    }

    fn ja(veld: &str) -> bool {
        match veld {
            "ja" => true,
            "nee" => false,
            anders => panic!("ja of nee verwacht, niet '{anders}'"),
        }
    }

    fn optie(veld: &str) -> Option<&str> {
        (veld != "-").then_some(veld)
    }

    fn standen(veld: &str) -> Vec<bool> {
        veld.chars().map(|c| c == 'L').collect()
    }

    fn maat<T: std::str::FromStr>(veld: &str) -> Option<(T, T)>
    where
        T::Err: std::fmt::Debug,
    {
        optie(veld).map(|v| {
            let (a, b) = v.split_once('x').unwrap();
            (a.parse().unwrap(), b.parse().unwrap())
        })
    }

    #[test]
    fn plan_volgens_de_tabel() {
        for r in rijen(PLAN_TABEL) {
            let plan = plan_opdracht(&standen(r[0]), ja(r[1]), ja(r[2]));
            assert_eq!(plan.begin_liggend, r[3] == "L", "{r:?}");
            let vel: Vec<bool> = plan.paginas.iter().map(|p| p.liggend_vel).collect();
            assert_eq!(vel, standen(r[4]), "{r:?}");
            let reset: Vec<bool> = plan.paginas.iter().map(|p| p.reset).collect();
            assert_eq!(reset, r[5].chars().map(|c| c == 'x').collect::<Vec<_>>(), "{r:?}");
            assert_eq!(plan.reset_mag, ja(r[1]) && !ja(r[2]), "{r:?}");
        }
    }

    #[test]
    fn plan_zonder_paginas() {
        assert_eq!(plan_opdracht(&[], true, false), OpdrachtPlan { begin_liggend: false, reset_mag: false, paginas: vec![] });
    }

    #[test]
    fn reset_tussen_paginas_volgens_de_tabel() {
        for r in rijen(RESET_TABEL) {
            assert_eq!(reset_tussen_paginas(ja(r[0]), optie(r[1]), optie(r[2])), ja(r[3]), "{r:?}");
        }
    }

    #[test]
    fn reset_alleen_waar_het_vel_echt_wisselt() {
        // Eerste pagina van een gewone opdracht: de DC heeft het beginvel al.
        assert!(!reset_nodig(0, true, true, true, false));
        // Noodweg: papier zetten of de DC staat anders.
        assert!(reset_nodig(0, false, false, true, true));
        assert!(reset_nodig(0, true, false, false, false));
        // Daarna alleen als wisselen mag én het vel anders is.
        assert!(reset_nodig(3, true, false, true, false));
        assert!(!reset_nodig(3, true, true, true, false));
        assert!(!reset_nodig(3, true, false, false, false));
        // Het papier wordt na de eerste pagina nooit meer gezet.
        assert!(!reset_nodig(1, false, false, true, true));
    }

    #[test]
    fn standaardvel_volgens_de_tabel() {
        for r in rijen(STANDAARD_TABEL) {
            let code = optie(r[0]).map(|c| c.parse::<i16>().unwrap());
            assert_eq!(vel_is_standaard(code, maat::<f64>(r[1])), ja(r[2]), "{r:?}");
        }
    }

    #[test]
    fn eigen_maat_volgens_de_tabel() {
        for r in rijen(EIGEN_MAAT_TABEL) {
            let m = maat::<i32>(r[2]).unwrap();
            assert_eq!(eigen_maat_ondersteund(ja(r[0]), maat::<i32>(r[1]), m), ja(r[3]), "{r:?}");
        }
    }

    #[test]
    fn liggende_weg_volgens_de_tabel() {
        for r in rijen(LIGGEND_TABEL) {
            let document = match r[0] {
                "onbekend" => None,
                v => Some(ja(v)),
            };
            let weg = liggende_weg(document, liggend_vel_modus(optie(r[1])), ja(r[2]));
            let verwacht = r[3] == "vel";
            assert_eq!(weg == LiggendPlan::LiggendVel, verwacht, "{r:?}: {weg:?}");
        }
    }

    #[test]
    fn liggend_vel_modus_uit_de_omgeving() {
        for uit in ["0", " 0 ", "uit", "OFF", "False"] {
            assert_eq!(liggend_vel_modus(Some(uit)), LiggendVelModus::Uit, "{uit}");
        }
        for altijd in ["1", "aan", "ja", "Altijd", "on"] {
            assert_eq!(liggend_vel_modus(Some(altijd)), LiggendVelModus::Altijd, "{altijd}");
        }
        for standaard in ["", "onzin", "2"] {
            assert_eq!(liggend_vel_modus(Some(standaard)), LiggendVelModus::Standaard, "{standaard}");
        }
        assert_eq!(liggend_vel_modus(None), LiggendVelModus::Standaard);
    }

    #[test]
    fn grootste_eigen_maat_uit_de_terugkeerwaarde() {
        assert_eq!(max_extent_uit(-1), None);
        assert_eq!(max_extent_uit(0), None);
        // 9140 x 15000 (0,1 mm): lengte in het hoge woord.
        assert_eq!(max_extent_uit((15000 << 16) | 9140), Some((9140, 15000)));
        // Lengte boven i16::MAX: negatief als POINTS, dus onbekend.
        assert_eq!(max_extent_uit(((40000u32 << 16) | 9140) as i32), None);
        assert_eq!(max_extent_uit(9140), None);
    }

    #[test]
    fn driverdeel_alleen_van_hetzelfde_stuurprogramma() {
        let kop = DevmodeKop { naam: "PDF-printer".into(), spec_versie: 0x401, driver_versie: 3, grootte: 220, driver_extra: 900 };
        assert!(driverdeel_past(&kop, &kop.clone()));
        assert!(driverdeel_past(&DevmodeKop { naam: "pdf-printer ".into(), ..kop.clone() }, &kop));
        assert!(!driverdeel_past(&DevmodeKop { driver_versie: 4, ..kop.clone() }, &kop));
        assert!(!driverdeel_past(&DevmodeKop { driver_extra: 0, ..kop.clone() }, &kop));
        assert!(!driverdeel_past(&DevmodeKop { grootte: 156, ..kop.clone() }, &kop));
        assert!(!driverdeel_past(&DevmodeKop { spec_versie: 0x400, ..kop.clone() }, &kop));
        assert!(!driverdeel_past(&DevmodeKop { naam: "Andere printer".into(), ..kop.clone() }, &kop));
    }
}
