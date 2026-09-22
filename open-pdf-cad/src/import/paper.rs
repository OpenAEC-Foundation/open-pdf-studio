//! Papier, schaal en plaatsing van een geïmporteerde tekening (#400).
//!
//! Pure rekenregels: welke paginamaat, welke schaal 1:N en welke matrix
//! tekeningcoördinaten → paginapunten. Geen `acadrust` hier, zodat alles los
//! te testen is.

use crate::geom::{Matrix, Point};
use serde::{Deserialize, Serialize};

/// Punten per millimeter.
pub const PT_PER_MM: f64 = 72.0 / 25.4;
/// Grootste paginamaat die PDF zonder `/UserUnit` toestaat: 14 400 pt = 200 inch.
pub const MAX_PAGE_MM: f64 = 14_400.0 / PT_PER_MM;

/// Een papierformaat, staand (breedte ≤ hoogte).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct PaperSize {
    pub id: &'static str,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Doet mee bij "automatisch": de ISO-reeks en de verlengde formaten.
    pub automatic: bool,
}

/// Formaten in de volgorde waarin "automatisch" ze probeert (oplopend
/// oppervlak). A3L, A2L en A1L zijn de verlengde formaten uit het ontwerp.
pub const PAPER_SIZES: &[PaperSize] = &[
    PaperSize { id: "A4", width_mm: 210.0, height_mm: 297.0, automatic: true },
    PaperSize { id: "A3", width_mm: 297.0, height_mm: 420.0, automatic: true },
    PaperSize { id: "A3L", width_mm: 297.0, height_mm: 630.0, automatic: true },
    PaperSize { id: "A2", width_mm: 420.0, height_mm: 594.0, automatic: true },
    PaperSize { id: "A2L", width_mm: 420.0, height_mm: 804.0, automatic: true },
    PaperSize { id: "A1", width_mm: 594.0, height_mm: 841.0, automatic: true },
    PaperSize { id: "A1L", width_mm: 594.0, height_mm: 1051.0, automatic: true },
    PaperSize { id: "A0", width_mm: 841.0, height_mm: 1189.0, automatic: true },
    PaperSize { id: "Letter", width_mm: 215.9, height_mm: 279.4, automatic: false },
    PaperSize { id: "Tabloid", width_mm: 279.4, height_mm: 431.8, automatic: false },
];

pub fn paper_by_id(id: &str) -> Option<&'static PaperSize> {
    PAPER_SIZES.iter().find(|p| p.id.eq_ignore_ascii_case(id))
}

/// Standaardschalen als noemer N van 1:N; kleiner dan 1 is een vergroting
/// (0,5 = 2:1).
pub const STANDARD_SCALES: &[f64] = &[
    0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0, 200.0, 250.0, 500.0, 1000.0, 2000.0, 2500.0,
    5000.0, 10000.0, 20000.0, 25000.0, 50000.0, 100000.0,
];

/// Kleinste standaardschaal waarbij de tekening past (N ≥ `exact`). Boven de
/// lijst: naar boven afgerond op twee significante cijfers.
pub fn round_scale_up(exact: f64) -> f64 {
    if !(exact > 0.0) || !exact.is_finite() {
        return 1.0;
    }
    for &n in STANDARD_SCALES {
        if n >= exact * (1.0 - 1e-9) {
            return n;
        }
    }
    let magnitude = 10f64.powf(exact.log10().floor() - 1.0);
    (exact / magnitude).ceil() * magnitude
}

/// Schaal als tekst: `1:100`, `1:2,5` wordt `1:2.5`, vergroting `2:1`.
pub fn scale_text(n: f64) -> String {
    fn short(v: f64) -> String {
        let r = (v * 100.0).round() / 100.0;
        if (r - r.round()).abs() < 1e-9 {
            format!("{}", r.round() as i64)
        } else {
            format!("{r}")
        }
    }
    if !(n > 0.0) || !n.is_finite() {
        return String::new();
    }
    if n >= 1.0 - 1e-9 {
        format!("1:{}", short(n))
    } else {
        format!("{}:1", short(1.0 / n))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    #[default]
    Auto,
    Portrait,
    Landscape,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Placement {
    /// Midden van het gebied op het midden van het papier.
    #[default]
    Center,
    /// Linksonder van het gebied in de hoek binnen de marge.
    LowerLeft,
    /// Het basispunt van de tekening in de hoek binnen de marge.
    Origin,
}

/// Papierkeuze voor de modelruimte.
#[derive(Clone, Debug, PartialEq)]
pub enum PaperChoice {
    /// Kleinste automatische formaat waar de tekening op de schaal op past.
    Auto,
    Named(String),
    Custom { width_mm: f64, height_mm: f64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelLayoutRequest {
    /// Gebied in tekeningeenheden: `[x0, y0, x1, y1]`.
    pub area: [f64; 4],
    /// Millimeters per tekeningeenheid.
    pub mm_per_unit: f64,
    /// `None` = passend op papier.
    pub scale: Option<f64>,
    pub paper: PaperChoice,
    pub orientation: Orientation,
    pub margin_mm: f64,
    pub placement: Placement,
    /// Draaiing van de tekening in graden, tegen de klok in.
    pub rotation_deg: f64,
    /// Basispunt (`$INSBASE`) voor plaatsing "op oorsprong".
    pub base_point: (f64, f64),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePlan {
    pub width_pt: f64,
    pub height_pt: f64,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Gebruikt formaat (`A3`, `custom`, of de naam van de layout).
    pub paper: String,
    pub landscape: bool,
    /// Schaalnoemer N van 1:N (1 bij een layout).
    pub scale: f64,
    /// Tekeningcoördinaten → paginapunten.
    #[serde(skip)]
    pub matrix: Matrix,
    /// Omtrek van het gebied op de pagina (vier hoeken, punten).
    #[serde(skip)]
    pub clip: Option<[Point; 4]>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PlanError {
    /// Het gebied is leeg of ongeldig.
    EmptyArea,
    /// De pagina wordt groter dan PDF toestaat (maten in mm).
    PageTooLarge { width_mm: f64, height_mm: f64 },
}

fn rotated_size(w: f64, h: f64, deg: f64) -> (f64, f64) {
    let (s, c) = deg.to_radians().sin_cos();
    let (s, c) = (s.abs(), c.abs());
    // Kwartslagen exact houden.
    let (s, c) = if s < 1e-12 { (0.0, 1.0) } else if c < 1e-12 { (1.0, 0.0) } else { (s, c) };
    (w * c + h * s, w * s + h * c)
}

/// Kleinste automatische formaat (en liggend of staand) waar `w × h` op past.
pub fn smallest_paper_for(w_mm: f64, h_mm: f64) -> Option<(&'static PaperSize, bool)> {
    for size in PAPER_SIZES.iter().filter(|p| p.automatic) {
        for landscape in [w_mm > h_mm, w_mm <= h_mm] {
            let (pw, ph) = oriented(size, landscape);
            if w_mm <= pw + 1e-9 && h_mm <= ph + 1e-9 {
                return Some((size, landscape));
            }
        }
    }
    None
}

fn oriented(p: &PaperSize, landscape: bool) -> (f64, f64) {
    if landscape {
        (p.height_mm, p.width_mm)
    } else {
        (p.width_mm, p.height_mm)
    }
}

/// Past de modelruimte op papier: kiest papier en schaal en geeft de matrix.
pub fn plan_model_page(req: &ModelLayoutRequest) -> Result<PagePlan, PlanError> {
    let [x0, y0, x1, y1] = req.area;
    let (aw, ah) = ((x1 - x0) * req.mm_per_unit, (y1 - y0) * req.mm_per_unit);
    if !(aw.is_finite() && ah.is_finite()) || aw < 0.0 || ah < 0.0 || req.mm_per_unit <= 0.0 {
        return Err(PlanError::EmptyArea);
    }
    // Een lijn of punt krijgt een minimale maat, anders deelt "passend" door nul.
    let (aw, ah) = (aw.max(1e-6), ah.max(1e-6));
    let (bw, bh) = rotated_size(aw, ah, req.rotation_deg);
    let margin = req.margin_mm.max(0.0);
    let wants_landscape = |w: f64, h: f64| match req.orientation {
        Orientation::Landscape => true,
        Orientation::Portrait => false,
        Orientation::Auto => w > h,
    };

    let (paper_id, pw, ph, scale) = match req.scale {
        Some(n) if n > 0.0 => {
            let (cw, ch) = (bw / n, bh / n);
            match &req.paper {
                PaperChoice::Custom { width_mm, height_mm } => ("custom".to_string(), *width_mm, *height_mm, n),
                PaperChoice::Named(id) => {
                    let p = paper_by_id(id).unwrap_or(&PAPER_SIZES[1]);
                    let (w, h) = oriented(p, wants_landscape(cw, ch));
                    (p.id.to_string(), w, h, n)
                }
                PaperChoice::Auto => {
                    let mut pick = None;
                    'sizes: for p in PAPER_SIZES.iter().filter(|p| p.automatic) {
                        let orientations: &[bool] = match req.orientation {
                            Orientation::Landscape => &[true],
                            Orientation::Portrait => &[false],
                            Orientation::Auto if cw > ch => &[true, false],
                            Orientation::Auto => &[false, true],
                        };
                        for &land in orientations {
                            let (w, h) = oriented(p, land);
                            if cw + 2.0 * margin <= w + 1e-9 && ch + 2.0 * margin <= h + 1e-9 {
                                pick = Some((p.id.to_string(), w, h));
                                break 'sizes;
                            }
                        }
                    }
                    let (id, w, h) = pick.unwrap_or_else(|| {
                        // Groter dan A0: maatwerk, naar boven afgerond op hele mm.
                        ("custom".to_string(), (cw + 2.0 * margin).ceil(), (ch + 2.0 * margin).ceil())
                    });
                    (id, w, h, n)
                }
            }
        }
        _ => {
            // Passend op papier: automatisch papier betekent A3.
            let (id, w, h) = match &req.paper {
                PaperChoice::Custom { width_mm, height_mm } => ("custom".to_string(), *width_mm, *height_mm),
                PaperChoice::Named(id) => {
                    let p = paper_by_id(id).unwrap_or(&PAPER_SIZES[1]);
                    let (w, h) = oriented(p, wants_landscape(bw, bh));
                    (p.id.to_string(), w, h)
                }
                PaperChoice::Auto => {
                    let p = &PAPER_SIZES[1];
                    let (w, h) = oriented(p, wants_landscape(bw, bh));
                    (p.id.to_string(), w, h)
                }
            };
            let (avail_w, avail_h) = ((w - 2.0 * margin).max(1.0), (h - 2.0 * margin).max(1.0));
            let exact = (bw / avail_w).max(bh / avail_h);
            (id, w, h, round_scale_up(exact))
        }
    };
    if !(pw > 0.0 && ph > 0.0) {
        return Err(PlanError::EmptyArea);
    }
    if pw > MAX_PAGE_MM + 1e-6 || ph > MAX_PAGE_MM + 1e-6 {
        return Err(PlanError::PageTooLarge { width_mm: pw, height_mm: ph });
    }

    // Tekening → papier-mm → punten, gedraaid om het referentiepunt.
    let k = req.mm_per_unit / scale * PT_PER_MM;
    let (s, c) = req.rotation_deg.to_radians().sin_cos();
    let (cw_pt, ch_pt) = (bw / scale * PT_PER_MM, bh / scale * PT_PER_MM);
    let margin_pt = margin * PT_PER_MM;
    let (ref_x, ref_y, page_x, page_y) = match req.placement {
        Placement::Center => ((x0 + x1) / 2.0, (y0 + y1) / 2.0, pw * PT_PER_MM / 2.0, ph * PT_PER_MM / 2.0),
        Placement::LowerLeft => ((x0 + x1) / 2.0, (y0 + y1) / 2.0, margin_pt + cw_pt / 2.0, margin_pt + ch_pt / 2.0),
        Placement::Origin => (req.base_point.0, req.base_point.1, margin_pt, margin_pt),
    };
    let matrix = Matrix::translate(-ref_x, -ref_y)
        .then(&Matrix::scale(k, k))
        .then(&Matrix::new(c, s, -s, c, 0.0, 0.0))
        .then(&Matrix::translate(page_x, page_y));
    let corners = [
        matrix.apply(Point::new(x0, y0)),
        matrix.apply(Point::new(x1, y0)),
        matrix.apply(Point::new(x1, y1)),
        matrix.apply(Point::new(x0, y1)),
    ];
    Ok(PagePlan {
        width_pt: pw * PT_PER_MM,
        height_pt: ph * PT_PER_MM,
        width_mm: pw,
        height_mm: ph,
        paper: paper_id,
        landscape: pw > ph,
        scale,
        matrix,
        clip: Some(corners),
    })
}

/// Papier van een layout zoals de plotinstellingen het beschrijven.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct LayoutPaper {
    /// Fysiek papier in mm zoals opgeslagen (vóór de plotdraaiing).
    pub width_mm: f64,
    pub height_mm: f64,
    /// 0 = geen, 1 = 90°, 2 = 180°, 3 = 270°.
    pub rotation: i16,
    pub margin_left: f64,
    pub margin_bottom: f64,
    pub margin_right: f64,
    pub margin_top: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    /// Grenzen van de layout in papierruimte-eenheden (vaak de papierrand).
    pub limits: Option<[f64; 4]>,
    /// Millimeters per papierruimte-eenheid.
    pub mm_per_unit: f64,
    pub name: String,
    /// Zelf gekozen formaat: gebruik deze maat, ook als de inhoud er niet
    /// op past (dan komt ze in het midden).
    pub forced: bool,
}

impl LayoutPaper {
    /// Millimeters per papierruimte-eenheid, nooit nul.
    fn unit_mm(&self) -> f64 {
        if self.mm_per_unit > 0.0 {
            self.mm_per_unit
        } else {
            1.0
        }
    }

    /// Papiermaat in mm na de plotdraaiing.
    fn turned_size(&self) -> (f64, f64) {
        if matches!(self.rotation, 1 | 3) {
            (self.height_mm, self.width_mm)
        } else {
            (self.width_mm, self.height_mm)
        }
    }

    /// Linksonder van het papier in papierruimte-eenheden volgens de
    /// plotoorsprong (marges en verschuiving meegedraaid met de plotdraaiing).
    fn plot_corner(&self) -> (f64, f64) {
        let k = self.unit_mm();
        let (left, bottom) = match self.rotation {
            1 => (self.margin_top, self.margin_left),
            2 => (self.margin_right, self.margin_top),
            3 => (self.margin_bottom, self.margin_right),
            _ => (self.margin_left, self.margin_bottom),
        };
        let (ox, oy) = if self.rotation == 0 { (self.origin_x, self.origin_y) } else { (0.0, 0.0) };
        (-(left + ox) / k, -(bottom + oy) / k)
    }

    /// Grenzen van de layout, als ze met het papier overeenkomen (2 %).
    fn limits_on_paper(&self) -> Option<[f64; 4]> {
        let k = self.unit_mm();
        let (pw, ph) = self.turned_size();
        let [lx0, ly0, lx1, ly1] = self.limits?;
        let (lw, lh) = ((lx1 - lx0) * k, (ly1 - ly0) * k);
        (pw > 0.0 && ph > 0.0 && lw > 0.0 && lh > 0.0 && (lw - pw).abs() <= 0.02 * pw && (lh - ph).abs() <= 0.02 * ph)
            .then_some([lx0, ly0, lx1, ly1])
    }

    /// De rechthoeken in papierruimte-eenheden die "het hele blad" zijn: het
    /// papier op de plotoorsprong en de grenzen van de layout als die met het
    /// papier overeenkomen. Leeg als de layout geen papiermaat draagt; losse
    /// grenzen zeggen dan niets (een nooit geopende layout heeft 12 × 9).
    ///
    /// Hangt alleen af van de plotinstellingen, niet van de inhoud: de
    /// beoordeling van een viewport mag niet afhangen van wat er daarna
    /// getekend wordt.
    pub fn sheet_rects(&self) -> Vec<[f64; 4]> {
        let k = self.unit_mm();
        let (pw, ph) = self.turned_size();
        if !(pw > 0.0 && ph > 0.0 && pw.is_finite() && ph.is_finite()) {
            return Vec::new();
        }
        let (x, y) = self.plot_corner();
        let mut out = Vec::new();
        if x.is_finite() && y.is_finite() {
            out.push([x, y, x + pw / k, y + ph / k]);
        }
        if let Some(limits) = self.limits_on_paper() {
            if limits.iter().all(|v| v.is_finite()) {
                out.push(limits);
            }
        }
        out
    }
}

/// Plant de pagina van een layout (papierruimte 1:1). `extents` zijn de
/// grenzen van de inhoud in papierruimte-eenheden; ze beslissen mee als de
/// plotinstellingen niet bij de inhoud passen.
pub fn plan_layout_page(paper: &LayoutPaper, extents: Option<[f64; 4]>, fallback_margin_mm: f64) -> Result<PagePlan, PlanError> {
    let k = paper.unit_mm();
    let (pw, ph) = paper.turned_size();
    let fits = |min_x: f64, min_y: f64, w_mm: f64, h_mm: f64| -> bool {
        match extents {
            None => true,
            Some([ex0, ey0, ex1, ey1]) => {
                // Minstens de helft van de inhoud moet op het papier vallen.
                let (px0, py0, px1, py1) = (min_x, min_y, min_x + w_mm / k, min_y + h_mm / k);
                let ix = (ex1.min(px1) - ex0.max(px0)).max(0.0);
                let iy = (ey1.min(py1) - ey0.max(py0)).max(0.0);
                let area = ((ex1 - ex0).max(1e-9)) * ((ey1 - ey0).max(1e-9));
                ix * iy >= 0.5 * area || (ex1 - ex0 <= 1e-9 && ey1 - ey0 <= 1e-9)
            }
        }
    };

    // Het eigen papier van de layout mag niet groter zijn dan de grootste
    // PDF-pagina, langs welke van de vier wegen hieronder het ook gekozen
    // wordt. Koos de gebruiker het zelf, dan is dat een fout; noemt de
    // tekening het, dan is het geen bruikbaar papier en kiest de inhoud.
    let too_large = pw > MAX_PAGE_MM + 1e-6 || ph > MAX_PAGE_MM + 1e-6;
    if too_large && paper.forced {
        return Err(PlanError::PageTooLarge { width_mm: pw, height_mm: ph });
    }
    if pw > 0.0 && ph > 0.0 && !too_large {
        // 1. Grenzen van de layout die met het papier overeenkomen.
        if let Some([lx0, ly0, _, _]) = paper.limits_on_paper() {
            if fits(lx0, ly0, pw, ph) {
                return Ok(layout_plan(paper, pw, ph, k, lx0, ly0));
            }
        }
        // 2. Plotoorsprong linksonder van het bedrukbare vlak (marges en
        //    verschuiving meegedraaid met de plotdraaiing).
        let (min_x, min_y) = paper.plot_corner();
        if fits(min_x, min_y, pw, ph) {
            return Ok(layout_plan(paper, pw, ph, k, min_x, min_y));
        }
        // 3. Het papier klopt niet met de inhoud: inhoud midden op het papier.
        if let Some([ex0, ey0, ex1, ey1]) = extents {
            let (cx, cy) = ((ex0 + ex1) / 2.0, (ey0 + ey1) / 2.0);
            if paper.forced || ((ex1 - ex0) * k <= pw + 1e-6 && (ey1 - ey0) * k <= ph + 1e-6) {
                return Ok(layout_plan(paper, pw, ph, k, cx - pw / k / 2.0, cy - ph / k / 2.0));
            }
        }
        if paper.forced {
            return Ok(layout_plan(paper, pw, ph, k, 0.0, 0.0));
        }
    }
    // Geen bruikbaar papier: kies het kleinste standaardformaat waar de
    // inhoud met een rand op past en zet haar in het midden.
    let Some([ex0, ey0, ex1, ey1]) = extents else {
        return Err(PlanError::EmptyArea);
    };
    let m = fallback_margin_mm.max(0.0);
    let (cw, ch) = ((ex1 - ex0) * k + 2.0 * m, (ey1 - ey0) * k + 2.0 * m);
    let (name, w, h) = match smallest_paper_for(cw, ch) {
        Some((size, landscape)) => {
            let (w, h) = oriented(size, landscape);
            (size.id.to_string(), w, h)
        }
        None => ("custom".to_string(), cw.ceil().max(1.0), ch.ceil().max(1.0)),
    };
    if w > MAX_PAGE_MM || h > MAX_PAGE_MM {
        return Err(PlanError::PageTooLarge { width_mm: w, height_mm: h });
    }
    let mut named = paper.clone();
    named.name = name;
    let (cx, cy) = ((ex0 + ex1) / 2.0, (ey0 + ey1) / 2.0);
    Ok(layout_plan(&named, w, h, k, cx - w / k / 2.0, cy - h / k / 2.0))
}

fn layout_plan(paper: &LayoutPaper, w_mm: f64, h_mm: f64, k: f64, min_x: f64, min_y: f64) -> PagePlan {
    let s = k * PT_PER_MM;
    PagePlan {
        width_pt: w_mm * PT_PER_MM,
        height_pt: h_mm * PT_PER_MM,
        width_mm: w_mm,
        height_mm: h_mm,
        paper: if paper.name.is_empty() { "layout".into() } else { paper.name.clone() },
        landscape: w_mm > h_mm,
        scale: 1.0,
        matrix: Matrix::translate(-min_x, -min_y).then(&Matrix::scale(s, s)),
        clip: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn request(area: [f64; 4]) -> ModelLayoutRequest {
        ModelLayoutRequest {
            area,
            mm_per_unit: 1.0,
            scale: None,
            paper: PaperChoice::Auto,
            orientation: Orientation::Auto,
            margin_mm: 10.0,
            placement: Placement::Center,
            rotation_deg: 0.0,
            base_point: (0.0, 0.0),
        }
    }

    #[test]
    fn scales_round_up_to_the_next_standard() {
        assert_eq!(round_scale_up(1.0), 1.0);
        assert_eq!(round_scale_up(1.01), 2.0);
        assert_eq!(round_scale_up(21.0), 25.0);
        assert_eq!(round_scale_up(99.999999999), 100.0);
        assert_eq!(round_scale_up(0.3), 0.5);
        assert_eq!(round_scale_up(123_456.0), 130_000.0);
        assert_eq!(scale_text(100.0), "1:100");
        assert_eq!(scale_text(2.5), "1:2.5");
        assert_eq!(scale_text(0.5), "2:1");
    }

    #[test]
    fn fit_on_a3_picks_the_orientation_and_a_standard_scale() {
        // 40 × 20 m in mm on A3 with 10 mm margins: 400 × 277 mm available
        // landscape, so 1:100.
        let plan = plan_model_page(&request([0.0, 0.0, 40_000.0, 20_000.0])).unwrap();
        assert_eq!(plan.paper, "A3");
        assert!(plan.landscape);
        assert_eq!(plan.scale, 100.0);
        assert!(close(plan.width_mm, 420.0) && close(plan.height_mm, 297.0));
        // The centre of the area lands on the centre of the page.
        let c = plan.matrix.apply(Point::new(20_000.0, 10_000.0));
        assert!(close(c.x, plan.width_pt / 2.0) && close(c.y, plan.height_pt / 2.0));
        // 1 m of drawing is 10 mm on paper.
        let a = plan.matrix.apply(Point::new(0.0, 0.0));
        let b = plan.matrix.apply(Point::new(1000.0, 0.0));
        assert!(close((b.x - a.x) / PT_PER_MM, 10.0));
    }

    #[test]
    fn a_fixed_scale_chooses_the_smallest_paper_that_fits() {
        // 50 × 30 m at 1:100 is 500 × 300 mm: with margins only A2 landscape.
        let mut req = request([0.0, 0.0, 50_000.0, 30_000.0]);
        req.scale = Some(100.0);
        let plan = plan_model_page(&req).unwrap();
        assert_eq!(plan.paper, "A2");
        assert!(plan.landscape);
        // 57 × 20 m at 1:100: A3L (630 × 297) is the smallest that fits.
        req.area = [0.0, 0.0, 57_000.0, 20_000.0];
        assert_eq!(plan_model_page(&req).unwrap().paper, "A3L");
        // Larger than A0: a custom page.
        req.area = [0.0, 0.0, 200_000.0, 100_000.0];
        let plan = plan_model_page(&req).unwrap();
        assert_eq!(plan.paper, "custom");
        assert!(close(plan.width_mm, 2020.0) && close(plan.height_mm, 1020.0));
        // Beyond what PDF allows.
        req.area = [0.0, 0.0, 600_000.0, 100_000.0];
        assert!(matches!(plan_model_page(&req), Err(PlanError::PageTooLarge { .. })));
    }

    #[test]
    fn units_rotation_and_origin_placement() {
        // Metres: 40 × 20 m, rotated a quarter turn: portrait A3 at 1:100.
        let mut req = request([0.0, 0.0, 40.0, 20.0]);
        req.mm_per_unit = 1000.0;
        req.rotation_deg = 90.0;
        let plan = plan_model_page(&req).unwrap();
        assert!(!plan.landscape);
        assert_eq!(plan.scale, 100.0);
        // The x axis of the drawing points up on the page.
        let a = plan.matrix.apply(Point::new(0.0, 0.0));
        let b = plan.matrix.apply(Point::new(1.0, 0.0));
        assert!(close(b.x, a.x) && close((b.y - a.y) / PT_PER_MM, 10.0));
        // "Origin": the base point sits in the margin corner.
        req.rotation_deg = 0.0;
        req.placement = Placement::Origin;
        req.base_point = (5.0, 5.0);
        let plan = plan_model_page(&req).unwrap();
        let o = plan.matrix.apply(Point::new(5.0, 5.0));
        assert!(close(o.x, 10.0 * PT_PER_MM) && close(o.y, 10.0 * PT_PER_MM));
    }

    #[test]
    fn national_coordinates_keep_their_precision() {
        // A 20 × 10 m building at RD coordinates in mm (1.55e8, 4.63e8).
        let (x0, y0) = (155_000_000.0, 463_000_000.0);
        let mut req = request([x0, y0, x0 + 20_000.0, y0 + 10_000.0]);
        req.scale = Some(100.0);
        let plan = plan_model_page(&req).unwrap();
        let a = plan.matrix.apply(Point::new(x0 + 1.0, y0));
        let b = plan.matrix.apply(Point::new(x0 + 2.0, y0));
        // 1 mm of drawing at 1:100 is 0.01 mm on paper, exact to 1e-9 pt.
        assert!(((b.x - a.x) - 0.01 * PT_PER_MM).abs() < 1e-9);
    }

    #[test]
    fn layouts_use_their_limits_or_plot_margins() {
        // Landscape A3 layout, limits equal to the paper border.
        let paper = LayoutPaper {
            width_mm: 297.0,
            height_mm: 420.0,
            rotation: 1,
            limits: Some([-7.5, -20.0, 412.5, 277.0]),
            mm_per_unit: 1.0,
            name: "A3".into(),
            ..Default::default()
        };
        let plan = plan_layout_page(&paper, Some([0.0, 0.0, 400.0, 250.0]), 10.0).unwrap();
        assert!(close(plan.width_mm, 420.0) && close(plan.height_mm, 297.0));
        let p = plan.matrix.apply(Point::new(-7.5, -20.0));
        assert!(close(p.x, 0.0) && close(p.y, 0.0));
        // Without usable limits: the plot margins place paper-space 0,0.
        let paper = LayoutPaper { limits: None, rotation: 0, margin_left: 5.0, margin_bottom: 7.0, ..paper };
        let plan = plan_layout_page(&paper, Some([0.0, 0.0, 200.0, 280.0]), 10.0).unwrap();
        let o = plan.matrix.apply(Point::new(0.0, 0.0));
        assert!(close(o.x, 5.0 * PT_PER_MM) && close(o.y, 7.0 * PT_PER_MM));
        // No paper at all: the smallest standard sheet that fits the extents
        // plus a margin (220 × 120 mm fits on A4 landscape), content centred.
        let plan = plan_layout_page(&LayoutPaper::default(), Some([100.0, 100.0, 300.0, 200.0]), 10.0).unwrap();
        assert_eq!(plan.paper, "A4");
        assert!(close(plan.width_mm, 297.0) && close(plan.height_mm, 210.0));
        let centre = plan.matrix.apply(Point::new(200.0, 150.0));
        assert!(close(centre.x, plan.width_pt / 2.0) && close(centre.y, plan.height_pt / 2.0));
    }

    #[test]
    fn a_layout_never_plans_a_page_beyond_the_largest_pdf_page() {
        let huge = MAX_PAGE_MM * 4.0;
        let content = Some([0.0, 0.0, 200.0, 100.0]);
        // Elk van de vier wegen naar het eigen papier van de layout: de
        // limieten, de plotoorsprong, de inhoud in het midden en het papier
        // dat de gebruiker koos.
        let with_limits = LayoutPaper { width_mm: huge, height_mm: huge, limits: Some([0.0, 0.0, huge, huge]), mm_per_unit: 1.0, ..Default::default() };
        let by_corner = LayoutPaper { limits: None, ..with_limits.clone() };
        let centred = LayoutPaper { origin_x: huge * 10.0, origin_y: huge * 10.0, ..by_corner.clone() };
        // De tekening noemt zelf een onbruikbaar papier: dat is "geen papier",
        // en de inhoud kiest een standaardblad.
        for paper in [&with_limits, &by_corner, &centred] {
            let plan = plan_layout_page(paper, content, 10.0).unwrap();
            assert!(plan.width_mm <= MAX_PAGE_MM && plan.height_mm <= MAX_PAGE_MM, "{} x {}", plan.width_mm, plan.height_mm);
            assert_eq!(plan.paper, "A4");
        }
        // De gebruiker koos het zelf: dan is het een fout, geen stille andere maat.
        for paper in [&with_limits, &by_corner, &centred] {
            let forced = LayoutPaper { forced: true, ..(*paper).clone() };
            for extents in [content, None] {
                assert_eq!(plan_layout_page(&forced, extents, 10.0), Err(PlanError::PageTooLarge { width_mm: huge, height_mm: huge }));
            }
        }
        // Precies de grootste pagina mag nog.
        let largest = LayoutPaper { width_mm: MAX_PAGE_MM, height_mm: MAX_PAGE_MM, mm_per_unit: 1.0, forced: true, ..Default::default() };
        assert!(plan_layout_page(&largest, content, 10.0).is_ok());
    }
}
