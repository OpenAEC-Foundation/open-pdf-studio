//! Beoordeling van één VIEWPORT van een layout (#400).
//!
//! De verkenning (het importvenster) en de wandeling (de omzetting) gebruiken
//! deze module allebei, zodat het venster precies meldt wat er op de pagina
//! komt. Daarvóór had elk zijn eigen filter en telde het venster op een blad
//! met detailvensters op ware grootte er zeven waar de omzetting er twaalf
//! tekende.
//!
//! De afbeelding model naar papier is:
//!
//! ```text
//! papier = ((model - view_target) x R(twist) - view_center) * schaal + center
//! schaal = height / view_height
//! ```
//!
//! In DWG staat het viewportnummer altijd op 0; in DXF draagt het blad
//! nummer 1. De verschuiving naar het model zit in `view_target`, in
//! `view_center` of in allebei; alle vormen komen met dezelfde formule goed
//! uit. `view_center` staat in het beeldvlak van de viewport (dus ná de
//! draaiing over `twist`), `view_target` in het model.
//!
//! De draaiing staat in DWG in radialen en in DXF in graden (groep 51); het
//! documentmodel neemt het getal uit het bestand ongewijzigd over.
//! [`LayoutSheet`] weet uit welk soort bestand de tekening komt en rekent om.
//! Het teken (positief = het model draait op papier tegen de klok in) en de
//! plaats van `view_center` volgen de beschrijving van het formaat; in de
//! verificatieverzameling (433 viewports) komt geen enkele gedraaide viewport
//! voor, dus tegen een echte tekening is dit niet bevestigd.
//!
//! De laag van een VIEWPORT is de laag van zijn kader, zoals in CAD: staat ze
//! uit, is ze bevroren, wordt ze niet geplot of laat de gebruiker haar weg, dan
//! verdwijnt alleen het kader (dat de import nooit tekent). Wat het venster
//! toont, volgt de lagen van de modelentiteiten en de lagen die in het venster
//! bevroren zijn. De beoordeling hier kijkt daarom niet naar de laag; een
//! venster dat het bestand zelf uitzet ([`ViewportUse::Hidden`]) wordt wel
//! weggelaten.
//!
//! Welke viewport "de eerste" is, hangt niet af van de tekenvolgorde of van
//! wat er gefilterd wordt: het is de eerste VIEWPORT in de rauwe lijst van het
//! blokrecord ([`LayoutSheet::of`]). Verkenning en wandeling vragen het op
//! dezelfde plek op.

use super::curves::{bulge_arc, cross, Xform3};
use acadrust::entities::{EntityType, Viewport};
use acadrust::types::Handle;
use acadrust::CadDocument;

/// Hoogste aantal hoekpunten van een eigen knipgrens; daarboven valt de
/// viewport terug op zijn rechthoek (werkgrens).
pub const MAX_CLIP_POINTS: usize = 4096;

/// Deel van het blad dat een viewport moet beslaan om "het hele blad" te zijn.
///
/// Waarom 95 %: getoetst wordt tegen het papier van de layout en tegen de
/// limieten van de papierruimte (`LayoutPaper::sheet_rects`). Een blad dat
/// een van beide volgt, beslaat het (op afronding na) helemaal. Een echt
/// venster dat "het hele blad" vult, laat ruimte voor marge, kader en
/// onderhoek: met 10 mm rondom is dat op A4 84 %, op A3 89 %, op A1 94 % en op
/// A0 96 %. De grens scheidt die twee dus niet zuiver: op A0 kan een eerste
/// venster zonder nummer dat tot 10 mm van de rand loopt, voor het blad worden
/// aangezien. In de verificatieverzameling (433 viewports) raakt het vangnet
/// geen enkele viewport; het is een gok voor bestanden die we nog niet gezien
/// hebben, en daarom meldt de import het (`sheetByCoverage`) in plaats van
/// stil een venster weg te laten. Zonder vangnet zou in het andere geval het
/// hele model over het blad heen getekend worden, en dat is erger.
pub const SHEET_COVER: f64 = 0.95;

/// Een viewport die getekend wordt.
#[derive(Debug, Clone)]
pub struct ViewportView {
    /// Model (WCS) naar papierruimte van de layout.
    pub model_to_paper: Xform3,
    /// Knipgrens in papierruimte: de rechthoek van de viewport.
    pub corners: Vec<(f64, f64)>,
    /// Papiereenheden per tekeningeenheid.
    pub scale: f64,
    /// Lagen die alleen in deze viewport bevroren zijn.
    pub frozen_layers: Vec<Handle>,
    /// De rechthoek beslaat (nagenoeg) het hele blad. Geen fout, wel een
    /// melding waard: het kan een blad zijn dat niet als blad herkend is.
    pub covers_page: bool,
}

/// Wat er met een viewport gebeurt.
#[derive(Debug)]
pub enum ViewportUse {
    /// De viewport van het blad zelf: die kijkt naar zichzelf en toont geen model.
    Sheet,
    /// Als blad aangemerkt door het vangnet, alleen omdat hij de eerste is en
    /// (nagenoeg) het hele blad beslaat. Wordt niet getekend, maar wel gemeld
    /// (`sheetByCoverage`): het is een gok, en als hij mis is, ontbreekt er een
    /// venster.
    SheetByCoverage,
    /// Staat uit.
    Hidden,
    /// Maten of kijkhoogte zijn nul of geen getal.
    Degenerate,
    /// Geen bovenaanzicht (perspectief of een andere kijkrichting).
    NotPlan,
    /// Tekenen.
    Draw(Box<ViewportView>),
}

/// Wat de beoordeling van een viewport over zijn layout moet weten. Eén keer
/// per layout bepaald, door de verkenning en de wandeling op dezelfde manier.
#[derive(Debug, Clone, Default)]
pub struct LayoutSheet {
    /// De eerste VIEWPORT in de rauwe volgorde van het blokrecord.
    pub first: Option<Handle>,
    /// Rechthoeken in papierruimte die het hele blad zijn (zie
    /// [`super::paper::LayoutPaper::sheet_rects`]).
    pub pages: Vec<[f64; 4]>,
    /// De tekening komt uit een DXF: de draaiing van een viewport staat dan
    /// in graden in plaats van in radialen.
    pub twist_in_degrees: bool,
}

impl LayoutSheet {
    /// De gegevens van de layout bij dit blokrecord (`*Paper_Space…`).
    /// `source_is_dxf` zegt uit welk soort bestand de tekening komt.
    pub fn of(document: &CadDocument, record_name: &str, source_is_dxf: bool) -> LayoutSheet {
        LayoutSheet {
            first: first_viewport(document, record_name),
            pages: super::scan::record_paper(document, record_name).map(|paper| paper.sheet_rects()).unwrap_or_default(),
            twist_in_degrees: source_is_dxf,
        }
    }

    /// Beoordeelt een viewport van deze layout.
    pub fn classify(&self, viewport: &Viewport) -> ViewportUse {
        let handle = viewport.common.handle;
        let first = handle != Handle::NULL && self.first == Some(handle);
        let twist = or(viewport.twist_angle, 0.0);
        classify_with(viewport, first, &self.pages, if self.twist_in_degrees { twist.to_radians() } else { twist })
    }
}

/// Handle van de eerste VIEWPORT in `entity_handles` van het blokrecord: de
/// volgorde van het bestand, vóór de tekenvolgorde (SORTENTSTABLE) en vóór elk
/// filter (onzichtbaar, laag uitgesloten). De plaats van het blad mag daar niet
/// van afhangen.
pub fn first_viewport(document: &CadDocument, record_name: &str) -> Option<Handle> {
    let record = document.block_records.get(record_name)?;
    record
        .entity_handles
        .iter()
        .copied()
        .find(|handle| matches!(document.get_entity(*handle), Some(EntityType::Viewport(_))))
}

/// Ligt `a` op `b`, met een tolerantie die met de maat meeschaalt?
fn same(a: f64, b: f64, size: f64) -> bool {
    (a - b).abs() <= 1e-6 * size.abs().max(1.0)
}

/// Een getal dat bruikbaar is, of de terugval.
fn or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// Beslaat `rect` minstens [`SHEET_COVER`] van `page`?
fn covers(rect: [f64; 4], page: [f64; 4]) -> bool {
    let area = (page[2] - page[0]) * (page[3] - page[1]);
    let ix = (rect[2].min(page[2]) - rect[0].max(page[0])).max(0.0);
    let iy = (rect[3].min(page[3]) - rect[1].max(page[1])).max(0.0);
    area.is_finite() && area > 0.0 && ix * iy >= SHEET_COVER * area
}

/// Beoordeelt een viewport. `first` is waar voor de eerste VIEWPORT van de
/// papierruimte ([`first_viewport`]); dat is een terugval voor bestanden
/// zonder bruikbaar nummer. `pages` zijn de rechthoeken die het hele blad zijn.
/// De draaiing wordt als radialen gelezen (DWG); zie [`LayoutSheet::classify`].
pub fn classify(viewport: &Viewport, first: bool, pages: &[[f64; 4]]) -> ViewportUse {
    classify_with(viewport, first, pages, or(viewport.twist_angle, 0.0))
}

/// Als [`classify`], met de draaiing in radialen apart opgegeven.
fn classify_with(viewport: &Viewport, first: bool, pages: &[[f64; 4]], twist: f64) -> ViewportUse {
    if !viewport.status.is_on {
        return ViewportUse::Hidden;
    }
    // Het blad draagt in DXF nummer 1. In DWG is het nummer altijd 0, dus daar
    // telt alleen de vorm hieronder (en, als terugval, de plaats in de lijst).
    if viewport.id == 1 {
        return ViewportUse::Sheet;
    }
    let (w, h, vh) = (viewport.width, viewport.height, viewport.view_height);
    if !(w.is_finite() && h.is_finite() && vh.is_finite()) || w <= 0.0 || h <= 0.0 || vh <= 0.0 {
        return ViewportUse::Degenerate;
    }
    // Terugval: een eerste viewport zonder nummer en zonder bruikbare
    // kijkgegevens is het blad.
    if first && viewport.id <= 0 && !viewport.view_target.x.is_finite() {
        return ViewportUse::Sheet;
    }
    // De kijkrichting gaat vóór de vormen van het blad: een isometrisch venster
    // dat toevallig op de plaats en de maat van een blad staat, is geen blad en
    // hoort in de telling van overgeslagen 3D-viewports.
    let direction = viewport.view_direction;
    let is_plan = direction.x.abs() < 1e-9 && direction.y.abs() < 1e-9 && direction.z >= 0.0;
    if !is_plan || viewport.status.perspective {
        return ViewportUse::NotPlan;
    }
    // Een viewport die naar zichzelf kijkt is het blad: zelfde middelpunt,
    // zelfde hoogte en geen verschuiving naar het model. Alleen de hoogte
    // vergelijken is niet genoeg: een detailvenster op 1:1 heeft die ook.
    let looks_at_itself = same(vh, h, h)
        && same(or(viewport.view_center.x, 0.0), viewport.center.x, w)
        && same(or(viewport.view_center.y, 0.0), viewport.center.y, h)
        && same(or(viewport.view_target.x, 0.0), 0.0, 1.0)
        && same(or(viewport.view_target.y, 0.0), 0.0, 1.0);
    if looks_at_itself {
        return ViewportUse::Sheet;
    }
    // Twee vormen van het blad die niet naar zichzelf kijken, allebei gemeten
    // op de verificatieverzameling en allebei alleen zonder nummer (DWG):
    // - een layout die nooit geopend is, draagt de standaardviewport van
    //   12 x 9 op (6; 4,5), waar hij ook in de lijst staat;
    // - sommige bestanden zetten het blad op (0,0) en bewaren het beeld van
    //   de papierruimte in `view_center`: ware grootte, geen doel. Dat telt
    //   alleen voor de eerste viewport, zodat een echt venster op 1:1 verderop
    //   in de lijst blijft staan.
    let no_target = same(or(viewport.view_target.x, 0.0), 0.0, 1.0) && same(or(viewport.view_target.y, 0.0), 0.0, 1.0);
    if viewport.id <= 0 && no_target {
        let unopened = same(w, 12.0, 1.0)
            && same(h, 9.0, 1.0)
            && same(viewport.center.x, 6.0, 1.0)
            && same(viewport.center.y, 4.5, 1.0)
            && same(or(viewport.view_center.x, 0.0), 6.0, 1.0)
            && same(or(viewport.view_center.y, 0.0), 4.5, 1.0);
        let at_origin =
            first && same(vh, h, h) && same(viewport.center.x, 0.0, 1.0) && same(viewport.center.y, 0.0, 1.0);
        if unopened || at_origin {
            return ViewportUse::Sheet;
        }
    }
    let (cx, cy) = (viewport.center.x, viewport.center.y);
    let (hw, hh) = (w / 2.0, h / 2.0);
    let rect = [cx - hw, cy - hh, cx + hw, cy + hh];
    let covers_page = pages.iter().any(|page| covers(rect, *page));
    // Vangnet: de eerste viewport zonder nummer die het hele blad beslaat, is
    // het blad, ook als hij niet op ware grootte staat (`view_height` wijkt af
    // van `height`). Zonder dit vangnet zou het hele model over het blad heen
    // getekend worden.
    if first && viewport.id <= 0 && covers_page {
        return ViewportUse::SheetByCoverage;
    }
    let scale = h / vh;
    if !(scale.is_finite() && scale > 0.0) {
        return ViewportUse::Degenerate;
    }
    let (tx, ty, tz) = (
        or(viewport.view_target.x, 0.0),
        or(viewport.view_target.y, 0.0),
        or(viewport.view_target.z, 0.0),
    );
    let (vcx, vcy) = (or(viewport.view_center.x, 0.0), or(viewport.view_center.y, 0.0));
    let offset = (viewport.center.x - vcx * scale, viewport.center.y - vcy * scale);
    // Eerst draaien, dan pas `view_center` eraf: dat punt staat in het
    // beeldvlak van de viewport, niet in het model.
    let model_to_paper = Xform3::translate(-tx, -ty, -tz)
        .then(&Xform3::scale(scale, scale, scale))
        .then(&Xform3::rotate_z(twist))
        .then(&Xform3::translate(offset.0, offset.1, 0.0));

    let corners = vec![(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])];
    ViewportUse::Draw(Box::new(ViewportView {
        model_to_paper,
        corners,
        scale,
        frozen_layers: viewport.frozen_layers.clone(),
        covers_page,
    }))
}

/// Aantal rechte stukken voor een boog met deze straal en hoek, zodat de
/// koorde nergens verder dan `tolerance` van de boog ligt.
fn arc_steps(radius: f64, sweep: f64, tolerance: f64) -> usize {
    if !(radius.is_finite() && sweep.is_finite()) || radius <= 0.0 {
        return 1;
    }
    let step = if tolerance > 0.0 && tolerance < radius {
        2.0 * (1.0 - tolerance / radius).acos()
    } else {
        std::f64::consts::FRAC_PI_2
    };
    let n = (sweep.abs() / step.max(1e-3)).ceil();
    if n.is_finite() {
        (n as usize).clamp(1, MAX_CLIP_POINTS)
    } else {
        1
    }
}

/// Rolt een gesloten polylijn met bulges uit tot een veelhoek. Stopt zodra de
/// werkgrens overschreden is; de aanroeper ziet dat aan de lengte.
fn unroll(vertices: &[((f64, f64), f64)], tolerance: f64) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::new();
    let n = vertices.len();
    for (i, (a, bulge)) in vertices.iter().enumerate() {
        out.push(*a);
        if out.len() > MAX_CLIP_POINTS {
            return out;
        }
        let Some((b, _)) = vertices.get((i + 1) % n.max(1)) else { continue };
        // De boogfunctie van de polylijn: middelpunt, straal en de hoeken met
        // teken (negatieve bulge = met de klok mee).
        let Some((center, radius, start, end)) = bulge_arc(*a, *b, *bulge) else { continue };
        let steps = arc_steps(radius, end - start, tolerance);
        for k in 1..steps {
            let t = start + (end - start) * k as f64 / steps as f64;
            out.push((center.0 + radius * t.cos(), center.1 + radius * t.sin()));
            if out.len() > MAX_CLIP_POINTS {
                return out;
            }
        }
    }
    out
}

/// Een gesloten ellips (of cirkel) als veelhoek: `c + u cos t + v sin t`.
fn ellipse_polygon(c: (f64, f64), u: (f64, f64), v: (f64, f64), tolerance: f64) -> Vec<(f64, f64)> {
    let radius = u.0.hypot(u.1).max(v.0.hypot(v.1));
    let steps = arc_steps(radius, std::f64::consts::TAU, tolerance).max(8);
    (0..steps)
        .map(|k| {
            let t = std::f64::consts::TAU * k as f64 / steps as f64;
            (c.0 + u.0 * t.cos() + v.0 * t.sin(), c.1 + u.1 * t.cos() + v.1 * t.sin())
        })
        .collect()
}

/// Een eigen knipgrens (`clip_boundary_handle`), als de viewport er een heeft
/// en die bruikbaar is. Leeg betekent: de rechthoek van de viewport.
///
/// De grens is een gesloten polylijn (bulges worden uitgerold), een cirkel of
/// een gesloten ellips; een boog wordt een veelhoek die nergens verder dan een
/// tienduizendste van de viewportmaat van de kromme ligt. Een spline of een
/// regio als grens valt terug op de rechthoek.
///
/// In het bestand staat ook een statusvlag "niet-rechthoekig knippen aan"
/// (bit 0x10000 van de status). Het documentmodel bewaart alleen de bits 0 tot
/// en met 15, dus die vlag is hier niet te lezen. De handle is het enige
/// kenmerk: de lezer vult hem alleen bij een viewport die een knipgrens
/// draagt. Bekende beperking: een bestand dat de grens bewaart maar het
/// knippen uitzet, wordt hier toch geknipt.
pub fn clip_corners(document: &CadDocument, viewport: &Viewport) -> Vec<(f64, f64)> {
    let handle = viewport.clip_boundary_handle;
    if handle == Handle::NULL {
        return Vec::new();
    }
    let size = viewport.width.abs().max(viewport.height.abs());
    let tolerance = if size.is_finite() && size > 0.0 { size * 1e-4 } else { 0.01 };
    // Eén punt meer dan de grens lezen: zo is te zien dat de grens te groot
    // is, zonder een afgekapte (en dus verkeerde) vorm te gebruiken.
    let points: Vec<(f64, f64)> = match document.get_entity(handle) {
        Some(EntityType::LwPolyline(poly)) => {
            let vertices: Vec<((f64, f64), f64)> =
                poly.vertices.iter().take(MAX_CLIP_POINTS + 1).map(|v| ((v.location.x, v.location.y), v.bulge)).collect();
            unroll(&vertices, tolerance)
        }
        Some(EntityType::Polyline2D(poly)) => {
            let spline_fit = poly.flags.is_spline_fit();
            let vertices: Vec<((f64, f64), f64)> = poly
                .vertices
                .iter()
                .filter(|v| !(spline_fit && v.flags.bits() & 16 != 0))
                .take(MAX_CLIP_POINTS + 1)
                .map(|v| ((v.location.x, v.location.y), v.bulge))
                .collect();
            unroll(&vertices, tolerance)
        }
        Some(EntityType::Circle(circle)) if circle.radius.is_finite() && circle.radius > 0.0 => {
            // Het middelpunt staat in het vlak van de cirkel; de assen draaien mee.
            let ocs = Xform3::ocs([circle.normal.x, circle.normal.y, circle.normal.z]);
            let c = ocs.point([circle.center.x, circle.center.y, circle.center.z]);
            let u = ocs.vector([circle.radius, 0.0, 0.0]);
            let v = ocs.vector([0.0, circle.radius, 0.0]);
            ellipse_polygon((c.x, c.y), (u.x, u.y), (v.x, v.y), tolerance)
        }
        Some(EntityType::Ellipse(ellipse))
            if (ellipse.end_parameter - ellipse.start_parameter).abs() >= std::f64::consts::TAU - 1e-9 =>
        {
            let major = [ellipse.major_axis.x, ellipse.major_axis.y, ellipse.major_axis.z];
            let minor = cross([ellipse.normal.x, ellipse.normal.y, ellipse.normal.z], major);
            let ratio = ellipse.minor_axis_ratio.abs();
            ellipse_polygon(
                (ellipse.center.x, ellipse.center.y),
                (major[0], major[1]),
                (minor[0] * ratio, minor[1] * ratio),
                tolerance,
            )
        }
        _ => Vec::new(),
    };
    if points.len() < 3 || points.len() > MAX_CLIP_POINTS || !points.iter().all(|(x, y)| x.is_finite() && y.is_finite()) {
        return Vec::new();
    }
    // De grens toont nooit meer dan de rechthoek van de viewport. In een
    // gewoon bestand ligt ze er al binnen (de rechthoek is haar omhullende) en
    // verandert er niets; steekt ze erbuiten, dan wordt ze afgesneden, en raakt
    // ze de rechthoek nergens, dan geldt de rechthoek.
    let (cx, cy, hw, hh) = (viewport.center.x, viewport.center.y, viewport.width.abs() / 2.0, viewport.height.abs() / 2.0);
    if ![cx, cy, hw, hh].iter().all(|v| v.is_finite()) {
        return Vec::new();
    }
    let slack = tolerance;
    let rect = [cx - hw - slack, cy - hh - slack, cx + hw + slack, cy + hh + slack];
    if points.iter().all(|(x, y)| *x >= rect[0] && *x <= rect[2] && *y >= rect[1] && *y <= rect[3]) {
        return points;
    }
    let cut = cut_to_rect(&points, [cx - hw, cy - hh, cx + hw, cy + hh]);
    if cut.len() < 3 || cut.len() > MAX_CLIP_POINTS || polygon_area(&cut).abs() <= 1e-12 * (hw * hh).max(1e-300) {
        return Vec::new();
    }
    cut
}

/// Oppervlak met teken van een veelhoek.
fn polygon_area(points: &[(f64, f64)]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum::<f64>()
        / 2.0
}

/// Snijdt een veelhoek af op een rechthoek langs de assen (kant voor kant). Bij
/// een holle veelhoek kunnen er stukken langs de rand van de rechthoek
/// samenvallen; die hebben geen oppervlak en knippen dus niets extra's weg.
fn cut_to_rect(points: &[(f64, f64)], rect: [f64; 4]) -> Vec<(f64, f64)> {
    // (as, grens, binnen is groter dan de grens)
    let sides = [(0usize, rect[0], true), (0, rect[2], false), (1, rect[1], true), (1, rect[3], false)];
    let mut current: Vec<(f64, f64)> = points.to_vec();
    for (axis, limit, keep_above) in sides {
        let value = |p: (f64, f64)| if axis == 0 { p.0 } else { p.1 };
        let inside = |p: (f64, f64)| if keep_above { value(p) >= limit } else { value(p) <= limit };
        let mut next = Vec::with_capacity(current.len() + 4);
        for (i, &b) in current.iter().enumerate() {
            let a = current[(i + current.len() - 1) % current.len()];
            if inside(a) != inside(b) {
                let t = (limit - value(a)) / (value(b) - value(a));
                let crossing = if axis == 0 { (limit, a.1 + (b.1 - a.1) * t) } else { (a.0 + (b.0 - a.0) * t, limit) };
                next.push(crossing);
            }
            if inside(b) {
                next.push(b);
            }
        }
        current = next;
        if current.is_empty() {
            break;
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    use acadrust::types::Vector3;

    /// Een layout die nooit geopend is: de standaardviewport van 12 x 9.
    fn unopened_sheet() -> Viewport {
        let mut v = Viewport::with_size(Vector3::new(6.0, 4.5, 0.0), 12.0, 9.0);
        v.id = 0;
        v.view_center = Vector3::new(6.0, 4.5, 0.0);
        v.view_target = Vector3::new(0.0, 0.0, 0.0);
        v.view_height = 12.0;
        v
    }

    /// Het blad op (0,0), met het beeld van de papierruimte in `view_center`.
    fn sheet_at_origin() -> Viewport {
        let mut v = Viewport::with_size(Vector3::new(0.0, 0.0, 0.0), 460.8, 238.2);
        v.id = 0;
        v.view_center = Vector3::new(128.5, 97.5, 0.0);
        v.view_target = Vector3::new(0.0, 0.0, 0.0);
        v.view_height = 238.2;
        v
    }

    #[test]
    fn a_sheet_that_does_not_look_at_itself_is_still_the_sheet() {
        assert!(matches!(classify(&unopened_sheet(), true, &[]), ViewportUse::Sheet));
        assert!(matches!(classify(&unopened_sheet(), false, &[]), ViewportUse::Sheet), "staat niet altijd vooraan");
        assert!(matches!(classify(&sheet_at_origin(), true, &[]), ViewportUse::Sheet));
    }

    #[test]
    fn a_real_window_at_one_to_one_further_down_the_list_is_drawn() {
        // Zelfde vorm als het blad op (0,0), maar niet de eerste: een venster.
        assert!(matches!(classify(&sheet_at_origin(), false, &[]), ViewportUse::Draw(_)));
        // Een eerste viewport met een nummer (DXF) is een venster.
        let mut numbered = sheet_at_origin();
        numbered.id = 2;
        assert!(matches!(classify(&numbered, true, &[]), ViewportUse::Draw(_)));
        // Een eerste viewport op schaal is een venster, ook zonder nummer.
        let mut scaled = sheet_at_origin();
        scaled.view_height = 23_820.0;
        assert!(matches!(classify(&scaled, true, &[]), ViewportUse::Draw(_)));
    }

    /// Een A3 liggend met de oorsprong linksonder.
    const A3: [f64; 4] = [0.0, 0.0, 420.0, 297.0];

    /// Een blad dat het hele papier beslaat maar niet op ware grootte staat:
    /// de papierruimte was ingezoomd toen het bestand bewaard werd.
    fn zoomed_sheet() -> Viewport {
        let mut v = Viewport::with_size(Vector3::new(210.0, 148.5, 0.0), 430.0, 300.0);
        v.id = 0;
        v.view_center = Vector3::new(95.0, 60.0, 0.0);
        v.view_target = Vector3::new(0.0, 0.0, 0.0);
        v.view_height = 120.0;
        v
    }

    #[test]
    fn a_first_viewport_without_a_number_that_covers_the_page_is_the_sheet() {
        assert!(matches!(classify(&zoomed_sheet(), true, &[A3]), ViewportUse::SheetByCoverage));
        // Zonder papiermaat is er niets om tegen te meten: dan blijft het een venster.
        assert!(matches!(classify(&zoomed_sheet(), true, &[]), ViewportUse::Draw(_)));
        // Niet de eerste: een venster over het hele blad, met een melding.
        match classify(&zoomed_sheet(), false, &[A3]) {
            ViewportUse::Draw(view) => assert!(view.covers_page),
            other => panic!("{other:?}"),
        }
        // Met een nummer (DXF) is het nooit het vangnet.
        let mut numbered = zoomed_sheet();
        numbered.id = 3;
        assert!(matches!(classify(&numbered, true, &[A3]), ViewportUse::Draw(_)));
        // Een eerste venster dat maar een deel van het blad beslaat, blijft staan.
        let mut part = zoomed_sheet();
        part.width = 300.0;
        match classify(&part, true, &[A3]) {
            ViewportUse::Draw(view) => assert!(!view.covers_page, "300 van de 420 mm is geen heel blad"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_isometric_viewport_in_the_shape_of_a_sheet_counts_as_three_dimensional() {
        for mut v in [sheet_at_origin(), unopened_sheet(), zoomed_sheet()] {
            v.view_direction = Vector3::new(-1.0, -1.0, 1.0);
            assert!(matches!(classify(&v, true, &[A3]), ViewportUse::NotPlan), "{v:?}");
        }
        let mut perspective = sheet_at_origin();
        perspective.status.perspective = true;
        assert!(matches!(classify(&perspective, true, &[]), ViewportUse::NotPlan));
        // Het nummer van het blad (DXF) gaat wel voor.
        let mut numbered = sheet_at_origin();
        numbered.id = 1;
        numbered.view_direction = Vector3::new(-1.0, -1.0, 1.0);
        assert!(matches!(classify(&numbered, true, &[]), ViewportUse::Sheet));
    }

    #[test]
    fn a_twisted_viewport_turns_the_model_about_its_target() {
        // Een venster van 100 x 100 op (200, 100), schaal 1:10, een kwartslag
        // tegen de klok in gedraaid. `view_center` staat in het beeldvlak.
        let mut v = Viewport::with_size(Vector3::new(200.0, 100.0, 0.0), 100.0, 100.0);
        v.id = 2;
        v.view_target = Vector3::new(5_000.0, 2_000.0, 0.0);
        v.view_center = Vector3::new(30.0, -40.0, 0.0);
        v.view_height = 1_000.0;
        v.twist_angle = std::f64::consts::FRAC_PI_2;
        let ViewportUse::Draw(view) = classify(&v, false, &[]) else { panic!("geen venster") };
        let at = |x: f64, y: f64| view.model_to_paper.point([x, y, 0.0]);
        // Het doel zelf ligt op `center - view_center x schaal`.
        let target = at(5_000.0, 2_000.0);
        assert!((target.x - 197.0).abs() < 1e-9 && (target.y - 104.0).abs() < 1e-9, "{target:?}");
        // De x-as van het model wijst op papier omhoog: +100 in x wordt +10 in y.
        let east = at(5_100.0, 2_000.0);
        assert!((east.x - target.x).abs() < 1e-9 && (east.y - target.y - 10.0).abs() < 1e-9, "{east:?}");
        // De y-as van het model wijst op papier naar links.
        let north = at(5_000.0, 2_100.0);
        assert!((north.x - target.x + 10.0).abs() < 1e-9 && (north.y - target.y).abs() < 1e-9, "{north:?}");

        // In een DXF staat dezelfde draaiing in graden.
        v.twist_angle = 90.0;
        let sheet = LayoutSheet { first: None, pages: Vec::new(), twist_in_degrees: true };
        let ViewportUse::Draw(from_dxf) = sheet.classify(&v) else { panic!("geen venster") };
        let east = from_dxf.model_to_paper.point([5_100.0, 2_000.0, 0.0]);
        assert!((east.x - 197.0).abs() < 1e-9 && (east.y - 114.0).abs() < 1e-9, "{east:?}");
    }

    #[test]
    fn arcs_are_unrolled_within_the_tolerance() {
        // Een halve cirkel met straal 50 boven de koorde (0,0)-(100,0), met de
        // klok mee van rechts naar links gezien: bulge 1 van (100,0) naar (0,0).
        let points = unroll(&[((0.0, 0.0), 0.0), ((100.0, 0.0), 1.0)], 0.01);
        assert!(points.len() > 20, "{} punten", points.len());
        for (x, y) in &points[1..] {
            let r = (x - 50.0).hypot(*y);
            assert!((r - 50.0).abs() < 1e-9, "punt ({x}; {y}) ligt niet op de boog");
            assert!(*y >= -1e-9, "de boog ligt boven de koorde");
        }
        // De koorde tussen twee buren wijkt nergens meer dan de tolerantie af.
        for pair in points[1..].windows(2) {
            let mid = ((pair[0].0 + pair[1].0) / 2.0, (pair[0].1 + pair[1].1) / 2.0);
            assert!(50.0 - (mid.0 - 50.0).hypot(mid.1) <= 0.01 + 1e-9);
        }
    }
}
