//! Pure regels voor het onthouden van de vensterstand (#1126), zonder Tauri
//! of andere crates.
//!
//! Dit bestand hangt alleen van `std` af, zodat de tests ook los te draaien
//! zijn (de testbinary van de app-crate start op sommige machines niet):
//!
//! ```text
//! rustc --edition 2021 --test src/venstertoestand/regels.rs -o regels-test.exe && regels-test.exe
//! ```

/// Bestandsnaam van de bewaarde stand; gelijk aan de standaardnaam van de
/// plugin, zodat een bestaande stand blijft gelden.
pub const BESTANDSNAAM: &str = ".window-state.json";

/// Zo lang moet het venster stil staan (niet verplaatst, niet van maat
/// veranderd) voor de stand naar schijf gaat.
pub const BEWAAR_WACHTTIJD_MS: u64 = 500;

/// Hoogte (fysieke pixels) van de strook bovenaan het venster waar de
/// titelbalk zit: daar pakt de gebruiker het venster vast.
pub const TITELSTROOK: i32 = 40;
/// Zoveel van die strook moet op één monitor vallen om het venster nog te
/// kunnen pakken.
pub const MIN_ZICHTBARE_BREEDTE: i32 = 200;
pub const MIN_ZICHTBARE_HOOGTE: i32 = 20;

/// Rechthoek in fysieke schermpixels (linkerbovenhoek + maat).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rechthoek {
    pub x: i32,
    pub y: i32,
    pub breedte: i32,
    pub hoogte: i32,
}

impl Rechthoek {
    pub fn new(x: i32, y: i32, breedte: i32, hoogte: i32) -> Self {
        Self { x, y, breedte, hoogte }
    }

    fn rechts(&self) -> i64 {
        self.x as i64 + self.breedte.max(0) as i64
    }

    fn onder(&self) -> i64 {
        self.y as i64 + self.hoogte.max(0) as i64
    }

    /// Breedte en hoogte van het gedeelde stuk (0 als ze elkaar niet raken).
    fn overlap(&self, ander: &Rechthoek) -> (i64, i64) {
        let b = self.rechts().min(ander.rechts()) - (self.x as i64).max(ander.x as i64);
        let h = self.onder().min(ander.onder()) - (self.y as i64).max(ander.y as i64);
        (b.max(0), h.max(0))
    }

    fn midden(&self) -> (i64, i64) {
        (
            self.x as i64 + self.breedte.max(0) as i64 / 2,
            self.y as i64 + self.hoogte.max(0) as i64 / 2,
        )
    }
}

/// Kan de gebruiker het venster nog pakken? Ja als genoeg van de titelstrook
/// op één van de monitoren (werkgebieden) valt. Een venster dat helemaal in
/// beeld staat is altijd bereikbaar, ook verdeeld over twee monitoren: de
/// gevraagde breedte is nooit meer dan de helft van het venster.
pub fn bereikbaar(venster: &Rechthoek, monitoren: &[Rechthoek]) -> bool {
    let strook = Rechthoek::new(venster.x, venster.y, venster.breedte, venster.hoogte.min(TITELSTROOK));
    let nodig_b = (venster.breedte / 2).min(MIN_ZICHTBARE_BREEDTE).max(1) as i64;
    let nodig_h = (strook.hoogte / 2).min(MIN_ZICHTBARE_HOOGTE).max(1) as i64;
    monitoren.iter().any(|m| {
        let (b, h) = strook.overlap(m);
        b >= nodig_b && h >= nodig_h
    })
}

/// De monitor waar het venster het meest op staat; staat het nergens op, dan
/// de monitor die het dichtst bij ligt.
fn beste_monitor(venster: &Rechthoek, monitoren: &[Rechthoek]) -> Option<Rechthoek> {
    let bruikbaar = || monitoren.iter().copied().filter(|m| m.breedte > 0 && m.hoogte > 0);
    let mut meeste: Option<(i64, Rechthoek)> = None;
    for m in bruikbaar() {
        let (b, h) = venster.overlap(&m);
        let oppervlak = b * h;
        // Bij gelijke stand wint de eerste monitor.
        if oppervlak > 0 && meeste.map_or(true, |(beste, _)| oppervlak > beste) {
            meeste = Some((oppervlak, m));
        }
    }
    if let Some((_, m)) = meeste {
        return Some(m);
    }
    let (vx, vy) = venster.midden();
    bruikbaar().min_by_key(|m| {
        let (mx, my) = m.midden();
        // i128: het kwadraat van een afstand over het hele i32-bereik past
        // niet in i64.
        let (dx, dy) = ((mx - vx) as i128, (my - vy) as i128);
        dx * dx + dy * dy
    })
}

fn klem(waarde: i64, min: i64, max: i64) -> i32 {
    // Past het venster niet (max < min), dan wint de linker- of bovenrand.
    waarde.min(max).max(min) as i32
}

/// Waar hoort een venster dat niet meer te pakken is? `None` als het
/// bereikbaar is (dan blijft het precies staan waar het stond) of als er
/// geen monitor bekend is. Anders: helemaal binnen de beste monitor, zo dicht
/// mogelijk bij de oude plek, en niet groter dan die monitor.
pub fn terug_in_beeld(venster: &Rechthoek, monitoren: &[Rechthoek]) -> Option<Rechthoek> {
    if bereikbaar(venster, monitoren) {
        return None;
    }
    let doel = beste_monitor(venster, monitoren)?;
    let breedte = venster.breedte.min(doel.breedte).max(1);
    let hoogte = venster.hoogte.min(doel.hoogte).max(1);
    let x = klem(venster.x as i64, doel.x as i64, doel.rechts() - breedte as i64);
    let y = klem(venster.y as i64, doel.y as i64, doel.onder() - hoogte as i64);
    Some(Rechthoek::new(x, y, breedte, hoogte))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOOFD: Rechthoek = Rechthoek { x: 0, y: 0, breedte: 1920, hoogte: 1040 };
    /// Tweede monitor links van de hoofdmonitor: negatieve coördinaten.
    const LINKS: Rechthoek = Rechthoek { x: -2560, y: 0, breedte: 2560, hoogte: 1400 };

    #[test]
    fn venster_in_beeld_blijft_staan() {
        let v = Rechthoek::new(200, 100, 1200, 800);
        assert!(bereikbaar(&v, &[HOOFD]));
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), None);
    }

    #[test]
    fn venster_op_monitor_met_negatieve_coordinaten_blijft_staan() {
        let v = Rechthoek::new(-2000, 150, 1200, 800);
        assert!(bereikbaar(&v, &[HOOFD, LINKS]));
        assert_eq!(terug_in_beeld(&v, &[HOOFD, LINKS]), None);
    }

    #[test]
    fn venster_over_twee_monitoren_blijft_staan() {
        // Half op de linker, half op de hoofdmonitor.
        let v = Rechthoek::new(-600, 100, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[HOOFD, LINKS]), None);
        // Ook een smal venster dat precies gedeeld is.
        let smal = Rechthoek::new(-150, 100, 300, 400);
        assert_eq!(terug_in_beeld(&smal, &[HOOFD, LINKS]), None);
    }

    #[test]
    fn deels_buiten_beeld_met_titelbalk_in_beeld_blijft_staan() {
        // Onderkant en rechterkant steken uit, de titelbalk is goed te pakken.
        let v = Rechthoek::new(1000, 600, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), None);
        // Een paar pixels over de linkerrand (onzichtbare vensterrand).
        let v = Rechthoek::new(-8, 0, 960, 1040);
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), None);
    }

    #[test]
    fn venster_op_verdwenen_monitor_komt_terug_op_de_dichtstbijzijnde() {
        // Stond op de linker monitor; die is losgekoppeld.
        let v = Rechthoek::new(-2000, 150, 1200, 800);
        assert!(!bereikbaar(&v, &[HOOFD]));
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), Some(Rechthoek::new(0, 150, 1200, 800)));
    }

    #[test]
    fn alleen_een_hoekje_in_beeld_schuift_terug() {
        // Rechts: nog 50 pixels zichtbaar.
        let v = Rechthoek::new(1870, 100, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), Some(Rechthoek::new(720, 100, 1200, 800)));
        // Onder: de titelbalk valt onder het werkgebied (achter de taakbalk).
        let v = Rechthoek::new(300, 1035, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), Some(Rechthoek::new(300, 240, 1200, 800)));
        // Boven: de titelbalk steekt boven het scherm uit.
        let v = Rechthoek::new(300, -700, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[HOOFD]), Some(Rechthoek::new(300, 0, 1200, 800)));
    }

    #[test]
    fn kiest_de_monitor_waar_het_venster_het_meest_op_staat() {
        let rechts = Rechthoek::new(1920, 0, 1920, 1040);
        // Titelbalk boven beide monitoren; het grootste deel boven de rechter.
        let v = Rechthoek::new(1500, -780, 1200, 800);
        assert_eq!(
            terug_in_beeld(&v, &[HOOFD, rechts]),
            Some(Rechthoek::new(1920, 0, 1200, 800))
        );
    }

    #[test]
    fn te_groot_venster_krimpt_tot_de_monitor() {
        // Bewaard op een groot scherm, nu alleen nog een klein scherm.
        let klein = Rechthoek::new(0, 0, 1366, 728);
        let v = Rechthoek::new(3000, 200, 2400, 1300);
        assert_eq!(terug_in_beeld(&v, &[klein]), Some(Rechthoek::new(0, 0, 1366, 728)));
    }

    #[test]
    fn zonder_monitoren_gebeurt_er_niets() {
        let v = Rechthoek::new(5000, 5000, 1200, 800);
        assert_eq!(terug_in_beeld(&v, &[]), None);
        // Een monitor zonder maat telt niet mee.
        assert_eq!(terug_in_beeld(&v, &[Rechthoek::new(0, 0, 0, 0)]), None);
    }

    #[test]
    fn extreme_coordinaten_lopen_niet_over() {
        let v = Rechthoek::new(i32::MAX - 10, i32::MIN + 10, i32::MAX, i32::MAX);
        let doel = terug_in_beeld(&v, &[HOOFD]).expect("moet terug in beeld");
        assert_eq!(doel, Rechthoek::new(0, 0, 1920, 1040));
    }

    #[test]
    fn bestandsnaam_is_die_van_de_plugin() {
        assert_eq!(BESTANDSNAAM, ".window-state.json");
    }
}
