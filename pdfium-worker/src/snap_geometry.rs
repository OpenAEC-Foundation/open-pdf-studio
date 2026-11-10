//! Snap-geometrie van een pagina: eindpunten, middens en randen van de
//! vectorinhoud, in de annotatieruimte van de app (CSS-pixels bij schaal 1).
//!
//! Dit is de Rust-uitvoering van `geometrieUitOperatorlijst` in
//! open-pdf-studio/js/tools/pdf-snap-extractor.js. Die loopt in JavaScript de
//! hele PDF.js-operatorlijst af; op zware tekeningen kost dat seconden en
//! honderden MB's heap. Hier leest de worker de padobjecten uit de pagina die
//! PDFium voor het tekenen toch al geparst heeft (vaak een open handle).
//!
//! Dezelfde regels als in JavaScript, zodat beide paden dezelfde set geven:
//! - elk subpad telt, gevuld of gestreken; een subpad met minder dan twee
//!   punten valt weg;
//! - een kromme wordt in vier gelijke parameterstappen (t = 1/4 .. 4/4) tot
//!   rechte stukken gemaakt;
//! - een gesloten subpad krijgt zijn beginpunt nog eens achteraan;
//! - punten gaan door de objectmatrix (CTM, met de /Matrix van formulieren)
//!   en daarna door de weergavematrix die de app meegeeft (paginarotatie,
//!   /UserUnit, verschuiving van de MediaBox);
//! - elk punt is een eindpunt, elk stuk langer dan 0,5 px is een rand met een
//!   midden; punten worden ontdubbeld op een raster van 0,1 px
//!   (`Math.round(x * 10)`), het eerste punt per rastercel blijft staan.
//!
//! Bewuste verschillen met de JavaScript-route staan in docs/rust-stappen.md:
//! knippaden (`W n`) en weergaven van annotaties komen hier niet mee, omdat
//! PDFium ze niet als eigen pagina-objecten kent en de app beide ook niet
//! tekent met PDFium.
//!
//! Uitvoer (`encode`), little-endian, 4-byte-uitgelijnd:
//!   0  "OSG1"
//!   4  u32 aantal punten (P)
//!   8  u32 aantal randen (E)
//!   12 u32 vlaggen (bit 0: ruimtelijke index volgt)
//!   16 P x (f32 x, f32 y)
//!      E x (f32 x1, f32 y1, f32 x2, f32 y2)
//!      P x u8 soort (0 = eindpunt, 1 = midden), aangevuld tot een veelvoud van 4
//!   en, met vlag 0, de ruimtelijke index van `buildSpatialIndex` in
//!   pdf-snap-extractor.js (cellen van 48 px, berekend uit dezelfde
//!   f32-waarden die JavaScript krijgt, in dezelfde volgorde):
//!      u32 Cp (puntcellen), u32 Ce (randcellen), u32 O (te grote randen),
//!      u32 Re (randverwijzingen)
//!      Cp x (i32 cx, i32 cy, u32 begin, u32 aantal), P x u32 puntindex
//!      Ce x (i32 cx, i32 cy, u32 begin, u32 aantal), Re x u32 randindex
//!      O x u32 randindex
//!   Zonder index (een celcoordinaat past niet in i32) bouwt JavaScript hem zelf.

use std::collections::HashSet;
use std::hash::{BuildHasherDefault, Hasher};

/// Affiene matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f.
pub type Matrix = [f64; 6];
pub const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

pub const MAGIC: &[u8; 4] = b"OSG1";
pub const HEADER_BYTES: usize = 16;
pub const SOORT_EINDPUNT: u8 = 0;
pub const SOORT_MIDDEN: u8 = 1;
pub const VLAG_INDEX: u32 = 1;

/// Celgrootte en spanwijdte-grens van de ruimtelijke index (GRID_CELL en
/// EDGE_CELL_SPAN_CAP in pdf-snap-extractor.js).
const CEL: f64 = 48.0;
const MAX_RAND_CELLEN: f64 = 256.0;

/// Kortere stukken zijn geen rand (zelfde drempel als de JavaScript-route).
const MIN_RANDLENGTE: f64 = 0.5;
/// Diepte-grens voor formulieren in formulieren (PDFium begrenst de recursie
/// bij het parsen zelf ook; dit is alleen een vangnet).
const MAX_FORMULIERDIEPTE: u32 = 64;

/// A ∘ B: eerst B, dan A. Zelfde formule als `multiplyMatrices` in
/// pdf-snap-extractor.js.
pub fn vermenigvuldig(a: &Matrix, b: &Matrix) -> Matrix {
    [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

#[inline]
fn pas_toe(m: &Matrix, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// `Math.round` van JavaScript: naar het dichtstbijzijnde gehele getal,
/// een half naar +oneindig (ook bij negatieve getallen, anders dan
/// `f64::round`). Niet-eindige waarden vallen samen in één cel, zoals de
/// sleutel "NaN,NaN" in JavaScript.
#[inline]
fn js_round(v: f64) -> i64 {
    if !v.is_finite() {
        return i64::MIN;
    }
    let f = v.floor();
    let r = if v - f >= 0.5 { f + 1.0 } else { f };
    r as i64
}

/// Punt op een kubische Bézier-kromme bij parameter t (zelfde formule en
/// volgorde van bewerkingen als `cubicBezierPoint` in JavaScript).
fn bezier_punt(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64), t: f64) -> (f64, f64) {
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let t2 = t * t;
    (
        mt2 * mt * p0.0 + 3.0 * mt2 * t * p1.0 + 3.0 * mt * t2 * p2.0 + t2 * t * p3.0,
        mt2 * mt * p0.1 + 3.0 * mt2 * t * p1.1 + 3.0 * mt * t2 * p2.1 + t2 * t * p3.1,
    )
}

/// FxHash-achtige hasher voor de rastersleutels: SipHash is hier onnodig
/// traag (de sleutels komen uit de pagina, niet van een aanvaller die op
/// botsingen uit is; een botsing kost alleen tijd).
#[derive(Default)]
struct RasterHasher(u64);

impl Hasher for RasterHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.write_u64(*b as u64);
        }
    }
    fn write_i64(&mut self, v: i64) {
        self.write_u64(v as u64);
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
}

type Raster = HashSet<(i64, i64), BuildHasherDefault<RasterHasher>>;

/// Verzamelt punten en randen in de volgorde van de inhoud.
pub struct SnapVerzameling {
    weergave: Matrix,
    pub punten: Vec<[f32; 2]>,
    pub soorten: Vec<u8>,
    pub randen: Vec<[f32; 4]>,
    gezien: Raster,
    werk: Vec<(f64, f64)>,
}

impl SnapVerzameling {
    /// `weergave` = de weergavematrix van de pagina bij schaal 1 (PDF.js
    /// `viewport.transform`), zoals de app hem voor de pagina berekent.
    pub fn nieuw(weergave: Matrix) -> Self {
        Self {
            weergave,
            punten: Vec::new(),
            soorten: Vec::new(),
            randen: Vec::new(),
            gezien: Raster::default(),
            werk: Vec::new(),
        }
    }

    fn punt(&mut self, x: f64, y: f64, soort: u8) {
        if self.gezien.insert((js_round(x * 10.0), js_round(y * 10.0))) {
            self.punten.push([x as f32, y as f32]);
            self.soorten.push(soort);
        }
    }

    /// Eén subpad: punten in de ruimte van het object, `matrix` = de totale
    /// objectmatrix (naar de standaard-gebruikersruimte van de pagina).
    /// Zelfde stappen als `commitSegments` in JavaScript.
    pub fn subpad(&mut self, matrix: &Matrix, pad: &[(f64, f64)]) {
        let mut werk = std::mem::take(&mut self.werk);
        werk.clear();
        for &(x, y) in pad {
            let (cx, cy) = pas_toe(matrix, x, y);
            werk.push(pas_toe(&self.weergave, cx, cy));
        }
        for j in 0..werk.len() {
            let p = werk[j];
            self.punt(p.0, p.1, SOORT_EINDPUNT);
            if j + 1 < werk.len() {
                let q = werk[j + 1];
                let dx = q.0 - p.0;
                let dy = q.1 - p.1;
                if (dx * dx + dy * dy).sqrt() > MIN_RANDLENGTE {
                    self.randen.push([p.0 as f32, p.1 as f32, q.0 as f32, q.1 as f32]);
                    self.punt((p.0 + q.0) / 2.0, (p.1 + q.1) / 2.0, SOORT_MIDDEN);
                }
            }
        }
        self.werk = werk;
    }

    /// Codeer en geef het werkgeheugen van het ontdubbelen eerst vrij (op een
    /// tekening van miljoenen segmenten scheelt dat honderden MB in de piek).
    pub fn afronden(mut self) -> Vec<u8> {
        self.gezien = Raster::default();
        self.werk = Vec::new();
        self.encode()
    }

    pub fn encode(&self) -> Vec<u8> {
        let p = self.punten.len();
        let e = self.randen.len();
        let soorten_bytes = (p + 3) & !3;
        let index = self.ruimtelijke_index();
        let mut out = Vec::with_capacity(HEADER_BYTES + p * 12 + e * 24 + soorten_bytes + 16);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(p as u32).to_le_bytes());
        out.extend_from_slice(&(e as u32).to_le_bytes());
        out.extend_from_slice(&(if index.is_some() { VLAG_INDEX } else { 0 }).to_le_bytes());
        for pt in &self.punten {
            out.extend_from_slice(&pt[0].to_le_bytes());
            out.extend_from_slice(&pt[1].to_le_bytes());
        }
        for r in &self.randen {
            for v in r {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        out.extend_from_slice(&self.soorten);
        out.resize(HEADER_BYTES + p * 8 + e * 16 + soorten_bytes, 0);
        if let Some(index) = index {
            index.encode_in(&mut out);
        }
        out
    }

    /// De index zoals `buildSpatialIndex` hem in JavaScript bouwt, of None als
    /// een celcoordinaat buiten i32 valt (dan bouwt JavaScript hem zelf).
    fn ruimtelijke_index(&self) -> Option<Index> {
        let cel = |v: f32| (v as f64 / CEL).floor();
        let past = |c: f64| c >= i32::MIN as f64 && c <= i32::MAX as f64;
        let mut punten = Cellen::default();
        for (i, pt) in self.punten.iter().enumerate() {
            let (cx, cy) = (cel(pt[0]), cel(pt[1]));
            if !past(cx) || !past(cy) {
                return None;
            }
            punten.voeg_toe(cx as i32, cy as i32, i as u32);
        }
        let mut randen = Cellen::default();
        let mut te_groot = Vec::new();
        for (i, r) in self.randen.iter().enumerate() {
            let (min_cx, max_cx) = (cel(r[0].min(r[2])), cel(r[0].max(r[2])));
            let (min_cy, max_cy) = (cel(r[1].min(r[3])), cel(r[1].max(r[3])));
            if ![min_cx, max_cx, min_cy, max_cy].iter().all(|c| past(*c)) {
                return None;
            }
            if (max_cx - min_cx + 1.0) * (max_cy - min_cy + 1.0) > MAX_RAND_CELLEN {
                te_groot.push(i as u32);
                continue;
            }
            for cx in min_cx as i32..=max_cx as i32 {
                for cy in min_cy as i32..=max_cy as i32 {
                    randen.voeg_toe(cx, cy, i as u32);
                }
            }
        }
        Some(Index { punten, randen, te_groot })
    }
}

/// Cellen in de volgorde waarin ze voor het eerst gevuld worden (de
/// invoegvolgorde van de Map in JavaScript), elk met zijn indices oplopend.
#[derive(Default)]
struct Cellen {
    ids: std::collections::HashMap<(i32, i32), u32, BuildHasherDefault<RasterHasher>>,
    sleutels: Vec<(i32, i32)>,
    lijsten: Vec<Vec<u32>>,
}

impl Cellen {
    fn voeg_toe(&mut self, cx: i32, cy: i32, i: u32) {
        let id = match self.ids.get(&(cx, cy)) {
            Some(id) => *id,
            None => {
                let id = self.sleutels.len() as u32;
                self.ids.insert((cx, cy), id);
                self.sleutels.push((cx, cy));
                self.lijsten.push(Vec::new());
                id
            }
        };
        self.lijsten[id as usize].push(i);
    }

    fn verwijzingen(&self) -> usize {
        self.lijsten.iter().map(Vec::len).sum()
    }

    fn encode_in(&self, out: &mut Vec<u8>) {
        let mut begin = 0u32;
        for (k, (cx, cy)) in self.sleutels.iter().enumerate() {
            let n = self.lijsten[k].len() as u32;
            for v in [*cx as u32, *cy as u32, begin, n] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            begin += n;
        }
        for lijst in &self.lijsten {
            for i in lijst {
                out.extend_from_slice(&i.to_le_bytes());
            }
        }
    }
}

struct Index {
    punten: Cellen,
    randen: Cellen,
    te_groot: Vec<u32>,
}

impl Index {
    fn encode_in(&self, out: &mut Vec<u8>) {
        for v in [
            self.punten.sleutels.len() as u32,
            self.randen.sleutels.len() as u32,
            self.te_groot.len() as u32,
            self.randen.verwijzingen() as u32,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        self.punten.encode_in(out);
        self.randen.encode_in(out);
        for i in &self.te_groot {
            out.extend_from_slice(&i.to_le_bytes());
        }
    }
}

/// Bouwt subpaden uit padsegmenten zoals `parseInterleavedPathData` in
/// JavaScript, en geeft elk voltooid subpad aan de verzameling.
pub struct SubpadBouwer<'v> {
    verzameling: &'v mut SnapVerzameling,
    matrix: Matrix,
    huidig: Vec<(f64, f64)>,
    cx: f64,
    cy: f64,
    kromme: [(f64, f64); 3],
    kromme_n: usize,
}

impl<'v> SubpadBouwer<'v> {
    pub fn nieuw(verzameling: &'v mut SnapVerzameling, matrix: Matrix) -> Self {
        Self { verzameling, matrix, huidig: Vec::new(), cx: 0.0, cy: 0.0, kromme: [(0.0, 0.0); 3], kromme_n: 0 }
    }

    fn lever_af(&mut self) {
        if self.huidig.len() >= 2 {
            self.verzameling.subpad(&self.matrix, &self.huidig);
        }
        self.huidig.clear();
    }

    pub fn move_to(&mut self, x: f64, y: f64) {
        self.kromme_n = 0;
        self.lever_af();
        self.cx = x;
        self.cy = y;
        self.huidig.push((x, y));
    }

    pub fn line_to(&mut self, x: f64, y: f64) {
        self.kromme_n = 0;
        self.cx = x;
        self.cy = y;
        self.huidig.push((x, y));
    }

    /// Eén punt van een kubische kromme: PDFium levert er drie achter elkaar
    /// (controlepunt 1, controlepunt 2, eindpunt).
    pub fn bezier_punt(&mut self, x: f64, y: f64) {
        self.kromme[self.kromme_n] = (x, y);
        self.kromme_n += 1;
        if self.kromme_n == 3 {
            self.kromme_n = 0;
            let start = (self.cx, self.cy);
            let [c1, c2, eind] = self.kromme;
            for s in 1..=4 {
                self.huidig.push(bezier_punt(start, c1, c2, eind, s as f64 / 4.0));
            }
            self.cx = eind.0;
            self.cy = eind.1;
        }
    }

    pub fn sluit(&mut self) {
        if self.huidig.len() > 1 {
            let eerste = self.huidig[0];
            self.huidig.push(eerste);
        }
    }

    pub fn klaar(mut self) {
        self.lever_af();
    }
}

use pdfium_render::prelude::*;

fn matrix_van(object: &PdfPageObject<'_>) -> Matrix {
    match object.matrix() {
        Ok(m) => [m.a() as f64, m.b() as f64, m.c() as f64, m.d() as f64, m.e() as f64, m.f() as f64],
        Err(_) => IDENTITY,
    }
}

fn bezoek(object: &PdfPageObject<'_>, ouder: &Matrix, verzameling: &mut SnapVerzameling, diepte: u32) {
    match object.object_type() {
        PdfPageObjectType::Path => {
            let Some(pad) = object.as_path_object() else { return };
            let matrix = vermenigvuldig(ouder, &matrix_van(object));
            let segmenten = pad.segments();
            let mut bouwer = SubpadBouwer::nieuw(verzameling, matrix);
            for i in 0..segmenten.len() {
                let Ok(segment) = segmenten.get(i) else { continue };
                let (x, y) = segment.point();
                let (x, y) = (x.value as f64, y.value as f64);
                match segment.segment_type() {
                    PdfPathSegmentType::MoveTo => bouwer.move_to(x, y),
                    PdfPathSegmentType::LineTo => bouwer.line_to(x, y),
                    PdfPathSegmentType::BezierTo => bouwer.bezier_punt(x, y),
                    PdfPathSegmentType::Unknown => continue,
                }
                if segment.is_close() {
                    bouwer.sluit();
                }
            }
            bouwer.klaar();
        }
        // Blokken, symbolen en titelblokken uit CAD-exports staan in
        // formulieren: daar inlopen, met de matrix van het formulier.
        PdfPageObjectType::XObjectForm => {
            if diepte >= MAX_FORMULIERDIEPTE {
                return;
            }
            let Some(formulier) = object.as_x_object_form_object() else { return };
            let matrix = vermenigvuldig(ouder, &matrix_van(object));
            for i in 0..formulier.len() {
                if let Ok(kind) = formulier.get(i) {
                    bezoek(&kind, &matrix, verzameling, diepte + 1);
                }
            }
        }
        _ => {}
    }
}

/// Snap-geometrie van een geparste pagina, in de volgorde van de inhoud.
pub fn uit_pagina(pagina: &PdfPage<'_>, weergave: Matrix) -> SnapVerzameling {
    let mut verzameling = SnapVerzameling::nieuw(weergave);
    let objecten = pagina.objects();
    for i in 0..objecten.len() {
        if let Ok(object) = objecten.get(i) {
            bezoek(&object, &IDENTITY, &mut verzameling, 0);
        }
    }
    verzameling
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(bytes: &[u8]) -> (Vec<[f32; 2]>, Vec<u8>, Vec<[f32; 4]>) {
        assert_eq!(&bytes[0..4], MAGIC);
        let u = |o: usize| u32::from_le_bytes(bytes[o..o + 4].try_into().unwrap()) as usize;
        let f = |o: usize| f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap());
        let (p, e) = (u(4), u(8));
        assert_eq!(bytes.len() % 4, 0);
        let mut punten = Vec::new();
        for i in 0..p {
            punten.push([f(16 + i * 8), f(20 + i * 8)]);
        }
        let mut randen = Vec::new();
        let r0 = 16 + p * 8;
        for i in 0..e {
            let o = r0 + i * 16;
            randen.push([f(o), f(o + 4), f(o + 8), f(o + 12)]);
        }
        let s0 = r0 + e * 16;
        (punten, bytes[s0..s0 + p].to_vec(), randen)
    }

    #[test]
    fn js_round_rounds_halves_up_like_javascript() {
        assert_eq!(js_round(2.5), 3);
        assert_eq!(js_round(-2.5), -2);
        assert_eq!(js_round(-2.51), -3);
        assert_eq!(js_round(0.49999999999999994), 0);
        assert_eq!(js_round(f64::NAN), js_round(f64::INFINITY));
    }

    #[test]
    fn multiply_applies_the_right_matrix_first() {
        let schaal = [2.0, 0.0, 0.0, 2.0, 0.0, 0.0];
        let schuif = [1.0, 0.0, 0.0, 1.0, 10.0, 0.0];
        // eerst schuiven, dan schalen: (1,0) -> (11,0) -> (22,0)
        let m = vermenigvuldig(&schaal, &schuif);
        assert_eq!(pas_toe(&m, 1.0, 0.0), (22.0, 0.0));
    }

    #[test]
    fn a_line_gives_two_endpoints_an_edge_and_a_midpoint() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(0.0, 0.0);
        b.line_to(100.0, 0.0);
        b.klaar();
        let (punten, soorten, randen) = decode(&v.encode());
        assert_eq!(punten, vec![[0.0, 0.0], [50.0, 0.0], [100.0, 0.0]]);
        assert_eq!(soorten, vec![SOORT_EINDPUNT, SOORT_MIDDEN, SOORT_EINDPUNT]);
        assert_eq!(randen, vec![[0.0, 0.0, 100.0, 0.0]]);
    }

    #[test]
    fn a_closed_square_repeats_its_start_and_dedupes_points() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        // zoals PDFium een `re` aanlevert: vijf punten, het laatste met sluiten
        b.move_to(0.0, 0.0);
        b.line_to(10.0, 0.0);
        b.line_to(10.0, 10.0);
        b.line_to(0.0, 10.0);
        b.line_to(0.0, 0.0);
        b.sluit();
        b.klaar();
        assert_eq!(v.randen.len(), 4, "de sluitlijn van lengte 0 is geen rand");
        assert_eq!(v.punten.len(), 8, "4 hoeken + 4 middens");
    }

    #[test]
    fn short_pieces_are_points_but_not_edges() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(0.0, 0.0);
        b.line_to(0.4, 0.0);
        b.klaar();
        assert!(v.randen.is_empty());
        assert_eq!(v.punten.len(), 2);
    }

    #[test]
    fn a_lone_move_is_no_subpath() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(5.0, 5.0);
        b.move_to(0.0, 0.0);
        b.line_to(10.0, 0.0);
        b.move_to(7.0, 7.0);
        b.klaar();
        assert_eq!(v.punten.len(), 3);
    }

    #[test]
    fn curves_become_four_straight_pieces() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(0.0, 0.0);
        b.bezier_punt(0.0, 40.0);
        b.bezier_punt(40.0, 40.0);
        b.bezier_punt(40.0, 0.0);
        b.klaar();
        assert_eq!(v.randen.len(), 4);
        let einde = v.randen[3];
        assert_eq!([einde[2], einde[3]], [40.0, 0.0]);
        // t = 1/2: x = 3*(1/8)*0 + 3*(1/8)*40 + (1/8)*40 = 20, y = 3/4*40 = 30
        assert_eq!([v.randen[1][2], v.randen[1][3]], [20.0, 30.0]);
    }

    #[test]
    fn object_matrix_then_viewport() {
        // weergave van een 400 pt hoog blad: y omlaag
        let weergave = [1.0, 0.0, 0.0, -1.0, 0.0, 400.0];
        let mut v = SnapVerzameling::nieuw(weergave);
        let ctm = [2.0, 0.0, 0.0, 2.0, 10.0, 20.0];
        let mut b = SubpadBouwer::nieuw(&mut v, ctm);
        b.move_to(0.0, 0.0);
        b.line_to(10.0, 0.0);
        b.klaar();
        assert_eq!(v.randen, vec![[10.0, 380.0, 30.0, 380.0]]);
    }

    #[test]
    fn encoding_is_aligned_and_complete() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(0.0, 0.0);
        b.line_to(10.0, 0.0);
        b.line_to(10.0, 10.0);
        b.klaar();
        let bytes = v.encode();
        let (punten, soorten, randen) = decode(&bytes);
        assert_eq!(punten.len(), 5);
        assert_eq!(soorten.len(), 5);
        assert_eq!(randen.len(), 2);
        // index: kop 16, 1 puntcel (16 + 5 refs), 1 randcel (16 + 2 refs)
        assert_eq!(bytes.len(), 16 + 5 * 8 + 2 * 16 + 8 + 16 + 16 + 5 * 4 + 16 + 2 * 4);
        assert_eq!(u32::from_le_bytes(bytes[12..16].try_into().unwrap()), VLAG_INDEX);
    }

    #[test]
    fn index_follows_the_javascript_grid() {
        let mut v = SnapVerzameling::nieuw(IDENTITY);
        let mut b = SubpadBouwer::nieuw(&mut v, IDENTITY);
        b.move_to(-1.0, 10.0);
        b.line_to(100.0, 10.0); // over de cellen x -1..2, y 0
        b.move_to(0.0, 0.0);
        b.line_to(4000.0, 4000.0); // 84 x 84 cellen: te groot
        b.klaar();
        let index = v.ruimtelijke_index().unwrap();
        assert_eq!(index.te_groot, vec![1]);
        assert_eq!(index.randen.sleutels, vec![(-1, 0), (0, 0), (1, 0), (2, 0)]);
        // punten: (-1,10) (49.5,10) (100,10) (0,0) (2000,2000) (4000,4000)
        assert_eq!(index.punten.sleutels, vec![(-1, 0), (1, 0), (2, 0), (0, 0), (41, 41), (83, 83)]);
        let mut ver = SnapVerzameling::nieuw(IDENTITY);
        ver.punten.push([1e12, 0.0]);
        ver.soorten.push(SOORT_EINDPUNT);
        assert!(ver.ruimtelijke_index().is_none(), "buiten i32: JavaScript bouwt de index");
    }

    // ── Met PDFium, op gemaakte PDF's ─────────────────────────────────────

    fn build_pdf(bodies: &[String]) -> Vec<u8> {
        let mut out = b"%PDF-1.7\n".to_vec();
        let mut offsets = Vec::new();
        for (i, body) in bodies.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
        }
        let xref = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", bodies.len() + 1).as_bytes());
        for offset in offsets {
            out.extend_from_slice(format!("{:010} 00000 n\r\n", offset).as_bytes());
        }
        out.extend_from_slice(
            format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", bodies.len() + 1, xref).as_bytes(),
        );
        out
    }

    fn stream(dict: &str, data: &str) -> String {
        format!("<< {} /Length {} >>\nstream\n{}\nendstream", dict, data.len(), data)
    }

    /// Eén pagina van 400 x 400 pt met `inhoud`; formulieren als
    /// (naam, dict-extra, inhoud), genummerd vanaf object 5.
    fn pagina(inhoud: &str, page_extra: &str, formulieren: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut xobjects = String::new();
        let mut extra = Vec::new();
        for (i, (naam, dict, data)) in formulieren.iter().enumerate() {
            xobjects.push_str(&format!(" /{} {} 0 R", naam, 5 + i));
            let sub = (0..formulieren.len())
                .map(|k| format!(" /{} {} 0 R", formulieren[k].0, 5 + k))
                .collect::<String>();
            extra.push(stream(
                &format!("/Type /XObject /Subtype /Form /BBox [-1000 -1000 1000 1000] /Resources << /XObject <<{} >> >> {}", sub, dict),
                data,
            ));
        }
        let mut bodies = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R /Resources << /XObject <<{} >> >> {} >>",
                xobjects, page_extra
            ),
            stream("", inhoud),
        ];
        bodies.extend(extra);
        build_pdf(&bodies)
    }

    fn extraheer(pdf: &[u8]) -> SnapVerzameling {
        let pdfium = crate::render::pdfium_for_tests();
        let doc = pdfium.load_pdf_from_byte_slice(pdf, None).expect("PDF laadt");
        let page = doc.pages().get(0).expect("pagina 0");
        uit_pagina(&page, IDENTITY)
    }

    fn bevat_rand(v: &SnapVerzameling, r: [f32; 4]) -> bool {
        v.randen.iter().any(|e| {
            let gelijk = |a: [f32; 4], b: [f32; 4]| a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() < 0.01);
            gelijk(*e, r) || gelijk(*e, [r[2], r[3], r[0], r[1]])
        })
    }

    #[test]
    fn pdfium_reads_lines_rects_and_curves() {
        let v = extraheer(&pagina("0 0 m 100 0 l 100 50 l S 10 10 30 20 re f 200 200 m 200 240 240 240 240 200 c S", "", &[]));
        assert!(bevat_rand(&v, [0.0, 0.0, 100.0, 0.0]));
        assert!(bevat_rand(&v, [100.0, 0.0, 100.0, 50.0]));
        assert!(bevat_rand(&v, [10.0, 10.0, 40.0, 10.0]));
        assert!(bevat_rand(&v, [10.0, 30.0, 10.0, 10.0]), "sluitende zijde van de rechthoek");
        // t = 3/4: (233.75, 222.5)
        assert!(bevat_rand(&v, [233.75, 222.5, 240.0, 200.0]), "laatste kwart van de kromme");
        assert_eq!(v.randen.len(), 2 + 4 + 4);
    }

    #[test]
    fn pdfium_applies_ctm_and_nested_form_matrices() {
        let pdf = pagina(
            "q 2 0 0 2 10 10 cm 0 0 m 10 0 l S Q q 1 0 0 1 100 0 cm /F1 Do Q",
            "",
            &[
                ("F1", "/Matrix [1 0 0 1 0 100]", "0 0 m 20 0 l S /F2 Do"),
                ("F2", "/Matrix [0 1 -1 0 0 0]", "0 0 m 30 0 l S"),
            ],
        );
        let v = extraheer(&pdf);
        assert!(bevat_rand(&v, [10.0, 10.0, 30.0, 10.0]), "CTM-schaling");
        assert!(bevat_rand(&v, [100.0, 100.0, 120.0, 100.0]), "formulier met /Matrix");
        assert!(bevat_rand(&v, [100.0, 100.0, 100.0, 130.0]), "geneste formulier, 90 graden gedraaid");
        assert_eq!(v.randen.len(), 3);
    }

    #[test]
    fn pdfium_keeps_clipped_lines_whole_and_skips_the_clip_path() {
        let v = extraheer(&pagina("q 50 50 100 100 re W n 0 0 m 300 300 l S Q", "", &[]));
        assert!(bevat_rand(&v, [0.0, 0.0, 300.0, 300.0]));
        assert_eq!(v.randen.len(), 1, "het knippad zelf is geen getekende lijn");
    }

    #[test]
    fn pdfium_uses_the_viewport_of_the_app() {
        // gedraaide weergave (90 graden) van een 400 x 400 blad bij schaal 1
        let pdf = pagina("0 0 m 100 0 l S", "/Rotate 90", &[]);
        let pdfium = crate::render::pdfium_for_tests();
        let doc = pdfium.load_pdf_from_byte_slice(&pdf, None).unwrap();
        let page = doc.pages().get(0).unwrap();
        let v = uit_pagina(&page, [0.0, 1.0, 1.0, 0.0, 0.0, 0.0]);
        assert!(bevat_rand(&v, [0.0, 0.0, 0.0, 100.0]));
    }
}
