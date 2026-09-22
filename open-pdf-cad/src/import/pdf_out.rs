//! Van getekende onderdelen naar een PDF-pagina (#400).
//!
//! De [`PageBuilder`] is de afnemer van de wandelaar: hij schrijft de
//! inhoudsstroom, houdt de grafische toestand bij (kleur, dikte, streepjes),
//! zet elke laag tussen `/OC … BDC` en `EMC`, en knipt wat buiten beeld valt
//! weg. [`write_pdf`] zet er pagina's, lagen (OCG's) en de meetschaal
//! (`/VP` + `/Measure`) omheen.
//!
//! # Blokken als formulier
//!
//! Een blok dat vaker op dezelfde manier staat (zelfde schaal, draaiing en
//! geërfde stijl; alleen de plaats verschilt) komt één keer als
//! formulier-XObject in de PDF, met per plaatsing `q 1 0 0 1 dx dy cm /FmN Do Q`.
//! De uitvoer mag daar niet van veranderen, en de werkgrenzen mogen er niet
//! door omzeild worden. Daarom:
//!
//! - De **eerste** plaatsing wordt gewoon getekend en intussen gemeten (de
//!   omhullende van alles wat de wandelaar aanbood, ook wat buiten beeld viel).
//!   Pas de tweede plaatsing neemt het blok op: een blok dat één keer
//!   voorkomt, kost niets extra.
//! - Of een opname ook echt een formulier wordt, beslist
//!   [`PageBuilder::finish`], als bekend is hoe vaak ze geplaatst is. Een
//!   formulier kost een eigen object en elke plaatsing een regel; loont dat
//!   niet (te klein, te weinig plaatsingen), dan komt de opname op elke plek
//!   alsnog in de stroom zelf te staan, tussen `q` en `Q`. Zo wordt een bestand
//!   van formulieren nooit noemenswaardig groter.
//! - Een formulier wordt alleen opgenomen en alleen geplaatst waar de plaatsing
//!   **helemaal in beeld** valt. Dan is er niets weggeknipt, en staat in het
//!   formulier precies wat er anders had gestaan. Valt een plaatsing helemaal
//!   buiten beeld, dan vervalt ze (zoals elk onderdeel ervan vervallen zou
//!   zijn); valt ze half in beeld, dan wordt ze gewoon getekend en per
//!   onderdeel geknipt. Zo komt er nooit meer in de PDF dan zonder formulieren.
//! - Formulieren mogen formulieren bevatten (een blok in een blok). Elke
//!   plaatsing telt voor de bovengrens mee met de omvang die ze **uitgevouwen**
//!   zou hebben ([`PageBuilder::charged_bytes`]): een blok dat zichzelf
//!   verdubbelt levert geen klein bestand op dat een lezer laat vastlopen.
//! - Een formulier erft de grafische toestand van de plek waar het geplaatst
//!   wordt. De opname begint daarom met een onbekende toestand en schrijft
//!   alles wat ze gebruikt zelf.

use super::pdf_writer::{write_coord, write_literal, write_real, Obj, PdfFile};
use super::style::Rgb;
use super::text::FontChoice;
use super::walk::{FormAction, Sink, Stroke};
use crate::geom::{Matrix, Point};
use super::curves::{PagePath, PathOp};
use super::image::{Pixels, Raster};
use std::collections::HashMap;
use std::io::Write;
use std::rc::Rc;

/// Millimeters per punt.
const MM_PER_PT: f64 = 25.4 / 72.0;

/// Lagen van het hele document: elke laagnaam krijgt één OCG.
#[derive(Debug, Default)]
pub struct LayerRegistry {
    pub names: Vec<String>,
    index: HashMap<String, usize>,
    /// Lagen die in het bestand uit stonden en in de PDF uit moeten staan.
    pub hidden: Vec<bool>,
}

impl LayerRegistry {
    pub fn index_of(&mut self, name: &str) -> usize {
        if let Some(i) = self.index.get(name) {
            return *i;
        }
        let i = self.names.len();
        self.names.push(name.to_string());
        self.hidden.push(false);
        self.index.insert(name.to_string(), i);
        i
    }

    pub fn hide(&mut self, name: &str) {
        let i = self.index_of(name);
        self.hidden[i] = true;
    }
}

#[derive(Clone, PartialEq)]
struct GraphicsState {
    stroke: Option<Rgb>,
    fill: Option<Rgb>,
    width: Option<f64>,
    cap: Option<u8>,
    join: Option<u8>,
    /// Laatst geschreven streepjesreeks (leeg = doorgetrokken).
    dash: Option<crate::import::style::Dash>,
    /// Is de streepjesreeks bekend? Aan het begin van een pagina wel
    /// (doorgetrokken), aan het begin van een formulier niet: dat erft de
    /// reeks van de plek waar het geplaatst wordt.
    dash_known: bool,
    /// Laatst gezette dekking (per duizend, zodat vergelijken klopt).
    alpha: Option<u16>,
}

impl GraphicsState {
    /// De toestand aan het begin van een pagina.
    fn empty() -> GraphicsState {
        GraphicsState { stroke: None, fill: None, width: None, cap: None, join: None, dash: None, dash_known: true, alpha: None }
    }

    /// De toestand aan het begin van een formulier: niets is bekend.
    fn unknown() -> GraphicsState {
        GraphicsState { dash_known: false, ..GraphicsState::empty() }
    }

    /// De toestand na inhoud die met een onbekende toestand begon en toch
    /// rechtstreeks in de stroom kwam: wat die inhoud zette geldt, de rest is
    /// nog zoals het was.
    fn after(self, inner: GraphicsState) -> GraphicsState {
        let (dash, dash_known) = if inner.dash_known { (inner.dash, true) } else { (self.dash, self.dash_known) };
        GraphicsState {
            stroke: inner.stroke.or(self.stroke),
            fill: inner.fill.or(self.fill),
            width: inner.width.or(self.width),
            cap: inner.cap.or(self.cap),
            join: inner.join.or(self.join),
            dash,
            dash_known,
            alpha: inner.alpha.or(self.alpha),
        }
    }
}

/// Een blok dat één keer als formulier-XObject in de pagina staat.
#[derive(Clone, Debug, PartialEq)]
pub struct PageForm {
    /// Het nummer in de naam: `/Fm<number>`. De nummers lopen niet altijd door:
    /// een opname die geen formulier werd, laat een gat.
    pub number: usize,
    pub content: Vec<u8>,
    /// Omhullende in paginaruimte, ruim genoeg voor lijndikte en letters.
    pub bbox: [f64; 4],
    /// Hoe vaak het in de pagina en in andere formulieren geplaatst is.
    pub uses: u64,
}

/// Hoogste aantal formulieren per pagina.
pub const MAX_FORMS: usize = 2048;
/// Hoogste aantal opnamen per pagina; welke daarvan een formulier worden,
/// blijkt bij het afronden.
pub const MAX_FORM_CANDIDATES: usize = 4 * MAX_FORMS;
/// Hoogste omvang van één formulier; daarboven wordt het blok gewoon getekend.
pub const MAX_FORM_BYTES: usize = 4 * 1024 * 1024;
/// Kleinste omvang van een formulier. Een plaatsing kost zelf een regel van
/// zo'n dertig bytes: daaronder valt er nooit iets te winnen.
pub const MIN_FORM_BYTES: usize = 96;
/// Schatting van wat een formulier aan vaste kosten heeft (het object met zijn
/// woordenboek en omhullende, de regel in de kruisverwijzingstabel en de naam
/// in de bronnen), in bytes in het bestand.
const FORM_OVERHEAD: u64 = 250;
/// Schatting van wat één plaatsing in het bestand kost, ingepakt.
const PLACEMENT_COST: u64 = 12;
/// Hoeveel kleiner herhaalde inhoud in de inhoudsstroom wordt door het
/// inpakken. Voorzichtig geschat: herhaling pakt goed in (gemeten tot een
/// factor vijftig), dus een formulier spaart minder uit dan het lijkt.
const PACK_RATIO_REPEATED: u64 = 8;
/// Hoeveel kleiner een formulier zelf wordt: een korte stroom pakt slecht in.
const PACK_RATIO_FORM: u64 = 2;
/// Hoogste aantal verschillende blokplaatsingen dat een pagina bijhoudt;
/// daarboven wordt een nieuw blok gewoon getekend.
pub const MAX_FORM_KEYS: usize = 32_768;

/// Wat de pagina van een blokplaatsing weet.
#[derive(Clone, Copy)]
enum FormState {
    /// Eén keer gezien en gemeten.
    Measured,
    /// Opgenomen: nummer van het formulier.
    Written(usize),
    /// Wordt nooit een formulier (te klein of te groot).
    Flat,
}

struct FormEntry {
    /// Omhullende ten opzichte van de oorsprong van de plaatsing; `None` als de
    /// plaatsing niets tekende.
    bbox: Option<[f64; 4]>,
    state: FormState,
}

/// Eén plaatsing van een formulier in een stroom: waar de regel staat en wat
/// ze plaatst. Bij het afronden kan de regel zo door de inhoud zelf vervangen
/// worden.
#[derive(Clone, Copy)]
struct Placement {
    at: usize,
    len: usize,
    slot: usize,
    dx: f64,
    dy: f64,
}

struct FormData {
    content: Vec<u8>,
    /// De formulieren die deze opname zelf plaatst.
    placements: Vec<Placement>,
    /// Oorsprong van de plaatsing waarbij het formulier is opgenomen.
    origin: Point,
    bbox: [f64; 4],
    /// Omvang als de inhoud helemaal was uitgevouwen (eigen bytes plus die van
    /// de formulieren die het zelf plaatst).
    expanded: usize,
    /// Onderdelen, uitgevouwen.
    items: u64,
    /// Extra ruimte om de omhullende (lijndikte, letters), in punten.
    margin: f64,
}

/// Een lopende opname: wat er opzij is gezet tot ze klaar is.
struct Recording {
    outer: Vec<u8>,
    /// De plaatsingen in `outer`.
    placements: Vec<Placement>,
    state: GraphicsState,
    items: u64,
    clips: usize,
    /// Uitgevouwen omvang van de formulieren die deze opname plaatste.
    nested: usize,
}

/// Een blokplaatsing die gemeten of opgenomen wordt.
struct Frame {
    key: String,
    origin: Point,
    /// Waar de stroom stond toen het meten begon, als de plaatsing helemaal in
    /// beeld valt: dan is bekend hoeveel bytes ze gewoon getekend kost.
    flat_from: Option<usize>,
    /// Omhullende van alles wat de wandelaar binnen deze plaatsing aanbood.
    asked: Option<[f64; 4]>,
    margin: f64,
    recording: Option<Recording>,
}

fn union(a: Option<[f64; 4]>, b: [f64; 4]) -> Option<[f64; 4]> {
    if !b.iter().all(|v| v.is_finite()) {
        return a;
    }
    Some(match a {
        Some(a) => [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])],
        None => b,
    })
}

/// Bouwt de inhoudsstroom van één pagina.
pub struct PageBuilder<'a> {
    pub width_pt: f64,
    pub height_pt: f64,
    content: Vec<u8>,
    registry: &'a mut LayerRegistry,
    /// Lagen met inhoud op deze pagina, op volgorde van eerste gebruik
    /// (globale registerindex).
    used: Vec<usize>,
    /// Per registerindex of hij in `used` staat: elk getekend onderdeel
    /// vraagt dit, en met duizenden lagen zou zoeken in `used` per onderdeel
    /// de wandeling tientallen seconden kosten.
    used_flags: Vec<bool>,
    current_layer: Option<usize>,
    use_ocg: bool,
    /// Dekkingen die op deze pagina voorkomen (per duizend), in volgorde.
    alphas: Vec<u16>,
    /// Letters die op deze pagina voorkomen, in volgorde: de eerste is `/F1`.
    fonts: Vec<FontChoice>,
    /// Beelden die op deze pagina voorkomen, in volgorde: het eerste is
    /// `/Im0`. De sleutel is uniek per bronbestand.
    images: Vec<(String, Rc<Raster>)>,
    state: GraphicsState,
    stack: Vec<(GraphicsState, [f64; 4])>,
    visible: [f64; 4],
    pub items: u64,
    /// Bovengrens voor de inhoudsstroom; daarboven meldt de bouwer zich vol
    /// en stopt de wandeling (`IMPORT_TOO_COMPLEX`).
    max_bytes: usize,
    /// Blokken als formulier hergebruiken.
    reuse: bool,
    /// Formulieren van deze pagina; het nummer is de plek in de lijst.
    forms: Vec<FormData>,
    /// De plaatsingen in de lopende stroom (`content`).
    placements: Vec<Placement>,
    form_keys: HashMap<String, FormEntry>,
    /// Blokplaatsingen die nu gemeten of opgenomen worden, de binnenste
    /// achteraan.
    frames: Vec<Frame>,
    /// Bytes van de inhoud die voor lopende opnamen opzij staat.
    outer_bytes: usize,
    /// Bytes van de formulieren die af zijn.
    form_bytes: usize,
    /// Wat de geplaatste formulieren uitgevouwen aan bytes hadden gekost.
    virtual_bytes: usize,
}

/// Standaard bovengrens voor de inhoudsstromen van één import, alle pagina's
/// samen (de omzetting geeft elke pagina wat er nog over is).
///
/// 256 MB aan tekenopdrachten is ruwweg tien miljoen lijnstukken: ver voorbij
/// wat een PDF-weergave nog vlot toont, terwijl de zwaarste gewone tekeningen
/// op enkele tientallen MB uitkomen. De stromen staan tot het wegschrijven
/// alle tegelijk in het geheugen, naast de ingelezen tekening en tijdelijk de
/// gecomprimeerde kopie; met deze grens blijft dat samen onder een halve GB.
pub const DEFAULT_MAX_CONTENT_BYTES: usize = 256 * 1024 * 1024;

impl<'a> PageBuilder<'a> {
    pub fn new(width_pt: f64, height_pt: f64, registry: &'a mut LayerRegistry, use_ocg: bool) -> Self {
        let margin = 2.0;
        PageBuilder {
            width_pt,
            height_pt,
            content: Vec::with_capacity(64 * 1024),
            registry,
            used: Vec::new(),
            used_flags: Vec::new(),
            current_layer: None,
            use_ocg,
            alphas: Vec::new(),
            fonts: Vec::new(),
            images: Vec::new(),
            state: GraphicsState::empty(),
            stack: Vec::new(),
            visible: [-margin, -margin, width_pt + margin, height_pt + margin],
            items: 0,
            max_bytes: DEFAULT_MAX_CONTENT_BYTES,
            reuse: false,
            forms: Vec::new(),
            placements: Vec::new(),
            form_keys: HashMap::new(),
            frames: Vec::new(),
            outer_bytes: 0,
            form_bytes: 0,
            virtual_bytes: 0,
        }
    }

    /// Zet hergebruik van blokken als formulier aan.
    pub fn with_forms(mut self, on: bool) -> Self {
        self.reuse = on;
        self
    }

    /// Wat deze pagina van de bovengrens afneemt: de inhoud, de formulieren,
    /// en voor elke plaatsing van een formulier wat het blok uitgevouwen aan
    /// bytes had gekost. Zonder formulieren is dat de omvang van de inhoud.
    pub fn charged_bytes(&self) -> usize {
        self.content
            .len()
            .saturating_add(self.outer_bytes)
            .saturating_add(self.form_bytes)
            .saturating_add(self.virtual_bytes)
    }

    /// Zet de bovengrens voor de inhoudsstroom.
    pub fn with_max_bytes(mut self, max_bytes: usize) -> Self {
        self.max_bytes = max_bytes;
        self
    }

    /// Is de bovengrens overschreden?
    pub fn is_full(&self) -> bool {
        self.charged_bytes() > self.max_bytes
    }

    /// Knipt de pagina-inhoud op een gebied (bijvoorbeeld het gekozen venster).
    pub fn clip_to(&mut self, path: &PagePath) {
        self.push_clip(path, false);
    }

    /// Inhoudsstroom, gebruikte lagen, dekkingen, letters (`/F1`, `/F2`, …),
    /// beelden (`/Im0`, `/Im1`, …) en formulieren (`/Fm0`, `/Fm1`, …).
    #[allow(clippy::type_complexity)]
    pub fn finish(mut self) -> (Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>, Vec<(String, Rc<Raster>)>, Vec<PageForm>) {
        // Een opname die nog openstaat (de wandeling is onderweg gestopt) gaat
        // gewoon de pagina in.
        while !self.frames.is_empty() {
            self.end_form(false);
        }
        self.set_layer(None);
        while !self.stack.is_empty() {
            self.pop_clip();
        }
        let (content, forms) = settle_forms(self.content, self.placements, self.forms);
        (content, self.used, self.alphas, self.fonts, self.images, forms)
    }

    /// Ligt deze omhullende helemaal in beeld? Dan knipt de wandelaar er niets
    /// van weg.
    fn inside(&self, bounds: [f64; 4]) -> bool {
        bounds[0] >= self.visible[0] && bounds[1] >= self.visible[1] && bounds[2] <= self.visible[2] && bounds[3] <= self.visible[3]
    }

    fn overlaps(&self, bounds: [f64; 4]) -> bool {
        bounds[2] >= self.visible[0] && bounds[0] <= self.visible[2] && bounds[3] >= self.visible[1] && bounds[1] <= self.visible[3]
    }

    /// Ruimte die een lijn of letter buiten zijn omhullende inneemt.
    fn note_margin(&mut self, margin: f64) {
        if let Some(frame) = self.frames.last_mut() {
            if margin.is_finite() && margin > frame.margin {
                frame.margin = margin;
            }
        }
    }

    /// Schrijft de plaatsing van een formulier in de lopende inhoud.
    fn place(&mut self, slot: usize, dx: f64, dy: f64) {
        self.set_layer(None);
        let at = self.content.len();
        self.place_line(slot, dx, dy);
        self.placements.push(Placement { at, len: self.content.len() - at, slot, dx, dy });
    }

    fn place_line(&mut self, slot: usize, dx: f64, dy: f64) {
        let moved = (dx * 1000.0).round() != 0.0 || (dy * 1000.0).round() != 0.0;
        if moved {
            self.content.extend_from_slice(b"q 1 0 0 1 ");
            self.number(dx);
            self.content.push(b' ');
            self.number(dy);
            self.content.extend_from_slice(format!(" cm /Fm{slot} Do Q\n").as_bytes());
        } else {
            // Een formulier bewaart en herstelt de grafische toestand zelf.
            self.content.extend_from_slice(format!("/Fm{slot} Do\n").as_bytes());
        }
    }

    /// Zet de dekking; 1 is ondoorzichtig.
    fn alpha(&mut self, alpha: f64) {
        let value = (alpha.clamp(0.0, 1.0) * 1000.0).round() as u16;
        if self.state.alpha == Some(value) {
            return;
        }
        self.state.alpha = Some(value);
        if !self.alphas.contains(&value) {
            self.alphas.push(value);
        }
        self.content.extend_from_slice(format!("/GS{value} gs\n").as_bytes());
    }

    /// Nummer van de letterbron op deze pagina: 1 voor `/F1`, enzovoort.
    fn font_number(&mut self, font: FontChoice) -> usize {
        match self.fonts.iter().position(|f| *f == font) {
            Some(i) => i + 1,
            None => {
                self.fonts.push(font);
                self.fonts.len()
            }
        }
    }

    fn set_layer(&mut self, layer: Option<usize>) {
        if self.current_layer == layer {
            return;
        }
        if self.current_layer.is_some() {
            self.content.extend_from_slice(b"EMC\n");
        }
        self.current_layer = layer;
        if let Some(index) = layer {
            self.content.extend_from_slice(format!("/OC /L{index} BDC\n").as_bytes());
        }
    }

    fn layer(&mut self, name: &str) -> Option<usize> {
        if !self.use_ocg {
            return None;
        }
        let index = self.registry.index_of(name);
        if self.used_flags.len() <= index {
            self.used_flags.resize(index + 1, false);
        }
        if !std::mem::replace(&mut self.used_flags[index], true) {
            self.used.push(index);
        }
        Some(index)
    }

    fn number(&mut self, v: f64) {
        write_coord(&mut self.content, v);
    }

    fn point(&mut self, p: Point) {
        self.number(p.x);
        self.content.push(b' ');
        self.number(p.y);
    }

    fn color(&mut self, rgb: Rgb, stroke: bool) {
        let same = if stroke { self.state.stroke == Some(rgb) } else { self.state.fill == Some(rgb) };
        if same {
            return;
        }
        if stroke {
            self.state.stroke = Some(rgb);
        } else {
            self.state.fill = Some(rgb);
        }
        let (r, g, b) = rgb;
        if r == g && g == b {
            self.number(r as f64 / 255.0);
            self.content.extend_from_slice(if stroke { b" G\n" } else { b" g\n" });
        } else {
            for v in [r, g, b] {
                self.number(v as f64 / 255.0);
                self.content.push(b' ');
            }
            self.content.extend_from_slice(if stroke { b"RG\n" } else { b"rg\n" });
        }
    }

    fn path_ops(&mut self, path: &PagePath) {
        for op in &path.ops {
            match op {
                PathOp::Move(p) => {
                    self.point(*p);
                    self.content.extend_from_slice(b" m\n");
                }
                PathOp::Line(p) => {
                    self.point(*p);
                    self.content.extend_from_slice(b" l\n");
                }
                PathOp::Cubic(a, b, p) => {
                    self.point(*a);
                    self.content.push(b' ');
                    self.point(*b);
                    self.content.push(b' ');
                    self.point(*p);
                    self.content.extend_from_slice(b" c\n");
                }
                PathOp::Close => self.content.extend_from_slice(b"h\n"),
            }
        }
    }
}

impl Sink for PageBuilder<'_> {
    fn stroke(&mut self, layer: &str, style: &Stroke, path: &PagePath) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(style.alpha);
        self.color(style.color, true);
        let width = (style.width * 1000.0).round() / 1000.0;
        if self.state.width != Some(width) {
            self.state.width = Some(width);
            self.number(width);
            self.content.extend_from_slice(b" w\n");
        }
        if self.state.cap != Some(style.cap) {
            self.state.cap = Some(style.cap);
            self.content.extend_from_slice(format!("{} J\n", style.cap).as_bytes());
        }
        if self.state.join != Some(style.join) {
            self.state.join = Some(style.join);
            self.content.extend_from_slice(format!("{} j\n", style.join).as_bytes());
        }
        self.note_margin(5.0 * width);
        if !self.state.dash_known || self.state.dash != style.dash {
            self.state.dash_known = true;
            match &style.dash {
                Some(dash) => {
                    self.content.push(b'[');
                    for (i, v) in dash.array.iter().enumerate() {
                        if i > 0 {
                            self.content.push(b' ');
                        }
                        self.number(*v);
                    }
                    self.content.extend_from_slice(b"] ");
                    self.number(dash.phase);
                    self.content.extend_from_slice(b" d\n");
                }
                None => self.content.extend_from_slice(b"[] 0 d\n"),
            }
            self.state.dash = style.dash.clone();
        }
        self.path_ops(path);
        self.content.extend_from_slice(b"S\n");
        self.items += 1;
    }

    fn fill(&mut self, layer: &str, color: Rgb, alpha: f64, path: &PagePath, even_odd: bool) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(alpha);
        self.color(color, false);
        self.path_ops(path);
        self.content.extend_from_slice(if even_odd { b"f*\n" } else { b"f\n" });
        self.items += 1;
    }

    fn text(&mut self, layer: &str, color: Rgb, alpha: f64, matrix: Matrix, bytes: &[u8], font: FontChoice) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(alpha);
        self.color(color, false);
        let resource = self.font_number(font);
        if font.bold {
            // Vet nabootsen: vullen en strijken met een streek van 3% van de
            // korpsgrootte. De breedtes blijven die van de gewone letter, dus
            // de plaatsing van de regel verandert niet. Kleur, dikte en
            // streepjes horen bij de grafische toestand en staan daarom voor
            // het tekstobject, zodat de boekhouding van de toestand klopt.
            let size = (matrix.a * matrix.d - matrix.b * matrix.c).abs().sqrt();
            let width = if size.is_finite() { (0.03 * size * 1000.0).round() / 1000.0 } else { 0.0 };
            self.color(color, true);
            if self.state.width != Some(width) {
                self.state.width = Some(width);
                self.number(width);
                self.content.extend_from_slice(b" w\n");
            }
            if self.state.dash.is_some() || !self.state.dash_known {
                self.state.dash = None;
                self.state.dash_known = true;
                self.content.extend_from_slice(b"[] 0 d\n");
            }
        }
        // Letters steken buiten het vak waar de wandelaar mee rekent (schuine
        // letters, staarten): een korps ruimte rondom.
        let reach = (matrix.a.hypot(matrix.b)).max(matrix.c.hypot(matrix.d));
        self.note_margin(reach);
        self.content.extend_from_slice(format!("BT /F{resource} 1 Tf ").as_bytes());
        if font.bold {
            self.content.extend_from_slice(b"2 Tr ");
        }
        for v in [matrix.a, matrix.b, matrix.c, matrix.d] {
            write_real(&mut self.content, v);
            self.content.push(b' ');
        }
        self.number(matrix.e);
        self.content.push(b' ');
        self.number(matrix.f);
        self.content.extend_from_slice(b" Tm ");
        write_literal(&mut self.content, bytes);
        // De tekenstand blijft na ET staan: terugzetten, anders wordt de
        // volgende gewone tekst ook gestreken.
        if font.bold {
            self.content.extend_from_slice(b" Tj 0 Tr ET\n");
        } else {
            self.content.extend_from_slice(b" Tj ET\n");
        }
        self.items += 1;
    }

    fn image(&mut self, layer: &str, alpha: f64, matrix: Matrix, key: &str, raster: &Rc<Raster>) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(alpha);
        let slot = match self.images.iter().position(|(k, _)| k == key) {
            Some(slot) => slot,
            None => {
                self.images.push((key.to_string(), raster.clone()));
                self.images.len() - 1
            }
        };
        self.content.extend_from_slice(b"q ");
        for v in [matrix.a, matrix.b, matrix.c, matrix.d] {
            write_real(&mut self.content, v);
            self.content.push(b' ');
        }
        self.number(matrix.e);
        self.content.push(b' ');
        self.number(matrix.f);
        self.content.extend_from_slice(format!(" cm /Im{slot} Do Q\n").as_bytes());
        self.items += 1;
    }

    fn push_clip(&mut self, path: &PagePath, even_odd: bool) {
        self.set_layer(None);
        self.stack.push((self.state.clone(), self.visible));
        if let Some(bounds) = path.bounds() {
            self.visible = [
                self.visible[0].max(bounds[0] - 1.0),
                self.visible[1].max(bounds[1] - 1.0),
                self.visible[2].min(bounds[2] + 1.0),
                self.visible[3].min(bounds[3] + 1.0),
            ];
        }
        self.content.extend_from_slice(b"q\n");
        self.path_ops(path);
        self.content.extend_from_slice(if even_odd { b"W* n\n" } else { b"W n\n" });
    }

    fn pop_clip(&mut self) {
        self.set_layer(None);
        self.content.extend_from_slice(b"Q\n");
        if let Some((state, visible)) = self.stack.pop() {
            self.state = state;
            self.visible = visible;
        }
    }

    fn wants(&mut self, bounds: [f64; 4]) -> bool {
        if let Some(frame) = self.frames.last_mut() {
            frame.asked = union(frame.asked, bounds);
        }
        self.overlaps(bounds)
    }

    fn takes_forms(&self) -> bool {
        self.reuse
    }

    fn begin_form(&mut self, key: &str, origin: Point) -> FormAction {
        if !self.reuse || !origin.x.is_finite() || !origin.y.is_finite() {
            return FormAction::Draw;
        }
        let Some(entry) = self.form_keys.get(key) else {
            // Voor het eerst gezien: gewoon tekenen en intussen meten.
            if self.form_keys.len() >= MAX_FORM_KEYS {
                return FormAction::Draw;
            }
            let flat_from = Some(self.content.len());
            self.frames.push(Frame { key: key.to_string(), origin, flat_from, asked: None, margin: 0.0, recording: None });
            return FormAction::Measure;
        };
        let state = entry.state;
        // Een blok dat niets tekent, tekent ook hier niets. Geen omhullende is
        // daar niet hetzelfde als: een blok dat wel iets in de stroom zette
        // maar zijn plaats niet meldde, staat als plat te boek en wordt gewoon
        // opnieuw getekend.
        let Some(relative) = entry.bbox else {
            return if matches!(state, FormState::Flat) { FormAction::Draw } else { FormAction::Skipped };
        };
        let bounds = [relative[0] + origin.x, relative[1] + origin.y, relative[2] + origin.x, relative[3] + origin.y];
        if !bounds.iter().all(|v| v.is_finite()) {
            return FormAction::Draw;
        }
        // De plaatsing hoort bij de omhullende van het blok eromheen, ook als
        // ze hier buiten beeld valt.
        if let Some(frame) = self.frames.last_mut() {
            frame.asked = union(frame.asked, bounds);
        }
        if !self.overlaps(bounds) {
            return FormAction::Skipped;
        }
        // Half in beeld: gewoon tekenen, dan wordt er per onderdeel geknipt.
        if !self.inside(bounds) {
            return FormAction::Draw;
        }
        match state {
            FormState::Flat => FormAction::Draw,
            FormState::Written(slot) => {
                let Some(form) = self.forms.get(slot) else { return FormAction::Draw };
                let (dx, dy, expanded, items, margin) =
                    (origin.x - form.origin.x, origin.y - form.origin.y, form.expanded, form.items, form.margin);
                self.place(slot, dx, dy);
                self.items += items;
                self.virtual_bytes = self.virtual_bytes.saturating_add(expanded);
                self.note_margin(margin);
                if let Some(recording) = self.frames.iter_mut().rev().find_map(|frame| frame.recording.as_mut()) {
                    recording.nested = recording.nested.saturating_add(expanded);
                }
                FormAction::Placed
            }
            FormState::Measured => {
                if self.forms.len() >= MAX_FORM_CANDIDATES {
                    return FormAction::Draw;
                }
                // De opname begint met een onbekende grafische toestand: een
                // formulier erft de toestand van de plek waar het staat.
                self.set_layer(None);
                let outer = std::mem::replace(&mut self.content, Vec::with_capacity(1024));
                let placements = std::mem::take(&mut self.placements);
                self.outer_bytes = self.outer_bytes.saturating_add(outer.len());
                let state = std::mem::replace(&mut self.state, GraphicsState::unknown());
                let recording = Recording { outer, placements, state, items: self.items, clips: self.stack.len(), nested: 0 };
                let frame = Frame { key: key.to_string(), origin, flat_from: None, asked: None, margin: 0.0, recording: Some(recording) };
                self.frames.push(frame);
                FormAction::Record
            }
        }
    }

    fn end_form(&mut self, complete: bool) -> bool {
        let Some(frame) = self.frames.pop() else { return false };
        // Wat binnen dit blok viel, valt ook binnen het blok eromheen.
        if let Some(parent) = self.frames.last_mut() {
            if let Some(asked) = frame.asked {
                parent.asked = union(parent.asked, asked);
            }
            parent.margin = parent.margin.max(frame.margin);
        }
        let relative = frame
            .asked
            .map(|b| [b[0] - frame.origin.x, b[1] - frame.origin.y, b[2] - frame.origin.x, b[3] - frame.origin.y]);
        let Some(recording) = frame.recording else {
            if complete {
                // Stond de plaatsing helemaal in beeld, dan is bekend wat ze
                // gewoon getekend kost; is dat te weinig voor een formulier,
                // dan wordt ze nooit opgenomen en blijft de stroom zoals hij
                // zonder formulieren was.
                let flat = frame.flat_from.filter(|_| frame.asked.is_some_and(|b| self.inside(b)));
                let small = flat.is_some_and(|from| self.content.len().saturating_sub(from) < MIN_FORM_BYTES);
                // Iets getekend zonder dat de omhullende bekend werd: geen
                // formulier en nooit overslaan.
                let unplaced = relative.is_none() && frame.flat_from.is_some_and(|from| self.content.len() > from);
                let state = if small || unplaced { FormState::Flat } else { FormState::Measured };
                self.form_keys.insert(frame.key, FormEntry { bbox: relative, state });
            }
            return false;
        };
        self.set_layer(None);
        let inner = std::mem::replace(&mut self.content, recording.outer);
        let inner_placements = std::mem::replace(&mut self.placements, recording.placements);
        self.outer_bytes = self.outer_bytes.saturating_sub(self.content.len());
        let inner_state = std::mem::replace(&mut self.state, recording.state);
        let balanced = self.stack.len() == recording.clips;
        let fits = inner.len() >= MIN_FORM_BYTES && inner.len() <= MAX_FORM_BYTES;
        match frame.asked.filter(|_| complete && balanced && fits) {
            Some(asked) => {
                let margin = frame.margin + 2.0;
                let slot = self.forms.len();
                self.form_bytes = self.form_bytes.saturating_add(inner.len());
                let expanded = inner.len().saturating_add(recording.nested);
                // Is dit formulier binnen de opname van een ander blok
                // opgenomen, dan staat daar alleen de regel die het plaatst:
                // wat het uitgevouwen kost, hoort bij die opname.
                if let Some(around) = self.frames.iter_mut().rev().find_map(|frame| frame.recording.as_mut()) {
                    around.nested = around.nested.saturating_add(expanded);
                }
                self.forms.push(FormData {
                    expanded,
                    content: inner,
                    placements: inner_placements,
                    origin: frame.origin,
                    bbox: [asked[0] - margin, asked[1] - margin, asked[2] + margin, asked[3] + margin],
                    items: self.items.saturating_sub(recording.items),
                    margin: frame.margin,
                });
                self.form_keys.insert(frame.key, FormEntry { bbox: relative, state: FormState::Written(slot) });
                self.place(slot, 0.0, 0.0);
                true
            }
            None => {
                // Geen formulier: de inhoud gaat alsnog rechtstreeks de stroom
                // in, zodat er niets verdwijnt. Ze schreef haar eigen toestand.
                let base = self.content.len();
                self.placements.extend(inner_placements.into_iter().map(|p| Placement { at: p.at + base, ..p }));
                self.content.extend_from_slice(&inner);
                // De plaatsingen die erin staan, staan nu in de opname
                // eromheen; wat ze uitgevouwen kosten gaat mee.
                if let Some(around) = self.frames.iter_mut().rev().find_map(|frame| frame.recording.as_mut()) {
                    around.nested = around.nested.saturating_add(recording.nested);
                }
                let outer_state = std::mem::replace(&mut self.state, GraphicsState::empty());
                self.state = outer_state.after(inner_state);
                if complete {
                    self.form_keys.insert(frame.key, FormEntry { bbox: relative, state: FormState::Flat });
                }
                false
            }
        }
    }

    fn exhausted(&self) -> bool {
        self.is_full()
    }
}

/// Beslist welke opnamen een formulier worden en zet de andere alsnog op elke
/// plek in de stroom zelf.
///
/// Een formulier loont als wat het aan herhaalde inhoud uitspaart meer is dan
/// wat het kost: `plaatsingen × (omvang − regel) > omvang + object`, gerekend in
/// ingepakte bytes en voorzichtig geschat (nagemeten op de
/// verificatieverzameling: met een ruimere schatting werden bestanden met een
/// enkel klein formulier een honderdtal bytes groter). Een opname die een andere opname plaatst heeft altijd een
/// hoger nummer; van hoog naar laag beslissen telt de plaatsingen dus goed: een
/// opname die zelf in de stroom komt, neemt haar plaatsingen zo vaak mee als ze
/// er staat.
fn settle_forms(content: Vec<u8>, placements: Vec<Placement>, forms: Vec<FormData>) -> (Vec<u8>, Vec<PageForm>) {
    if forms.is_empty() {
        return (content, Vec::new());
    }
    let count = forms.len();
    let tally = |keep: &[bool], decide: bool| -> (Vec<u64>, Vec<bool>, Vec<u64>) {
        let mut uses = vec![0u64; count];
        let mut keep = keep.to_vec();
        let mut gains = vec![0u64; count];
        for p in &placements {
            if let Some(n) = uses.get_mut(p.slot) {
                *n += 1;
            }
        }
        for slot in (0..count).rev() {
            let Some(form) = forms.get(slot) else { continue };
            let n = uses.get(slot).copied().unwrap_or(0);
            if decide {
                let size = form.content.len() as u64;
                let saved = n.saturating_mul(size / PACK_RATIO_REPEATED);
                let cost = n.saturating_mul(PLACEMENT_COST).saturating_add(size / PACK_RATIO_FORM).saturating_add(FORM_OVERHEAD);
                if let (Some(k), Some(g)) = (keep.get_mut(slot), gains.get_mut(slot)) {
                    *k = n > 0 && saved > cost;
                    *g = saved.saturating_sub(cost);
                }
            }
            let times = if keep.get(slot).copied().unwrap_or(false) { 1 } else { n };
            for p in &form.placements {
                if let Some(child) = uses.get_mut(p.slot) {
                    *child = child.saturating_add(times);
                }
            }
        }
        (uses, keep, gains)
    };
    let (_, mut keep, gains) = tally(&vec![false; count], true);
    // Meer dan het hoogste aantal: de formulieren die het minst opleveren
    // vallen af.
    let kept = keep.iter().filter(|k| **k).count();
    if kept > MAX_FORMS {
        let mut order: Vec<usize> = (0..count).filter(|slot| keep.get(*slot).copied().unwrap_or(false)).collect();
        order.sort_by_key(|slot| gains.get(*slot).copied().unwrap_or(0));
        for slot in order.into_iter().take(kept - MAX_FORMS) {
            if let Some(k) = keep.get_mut(slot) {
                *k = false;
            }
        }
    }
    let (uses, keep, _) = tally(&keep, false);

    // Van laag naar hoog: wat een opname plaatst, is dan al af.
    let mut finished: Vec<Vec<u8>> = Vec::with_capacity(count);
    let mut boxes = Vec::with_capacity(count);
    for form in forms {
        let spliced = splice(form.content, &form.placements, &keep, &finished);
        finished.push(spliced);
        boxes.push(form.bbox);
    }
    let content = splice(content, &placements, &keep, &finished);
    let mut out = Vec::new();
    for (number, (content, bbox)) in finished.into_iter().zip(boxes).enumerate() {
        if keep.get(number).copied().unwrap_or(false) {
            out.push(PageForm { number, content, bbox, uses: uses.get(number).copied().unwrap_or(0) });
        }
    }
    (content, out)
}

/// Vervangt in `content` elke plaatsing van een opname die geen formulier
/// wordt door de inhoud van die opname, tussen `q` en `Q`: die inhoud zet haar
/// eigen grafische toestand en mag de stroom eromheen niet raken.
fn splice(content: Vec<u8>, placements: &[Placement], keep: &[bool], finished: &[Vec<u8>]) -> Vec<u8> {
    let inlined = |p: &Placement| !keep.get(p.slot).copied().unwrap_or(true);
    if !placements.iter().any(inlined) {
        return content;
    }
    let extra: usize = placements.iter().filter(|p| inlined(p)).map(|p| finished.get(p.slot).map_or(0, |f| f.len()) + 40).sum();
    let mut out = Vec::with_capacity(content.len() + extra);
    let mut from = 0usize;
    for p in placements {
        let (Some(before), Some(inner)) = (content.get(from..p.at), finished.get(p.slot)) else { continue };
        if !inlined(p) {
            continue;
        }
        out.extend_from_slice(before);
        let moved = (p.dx * 1000.0).round() != 0.0 || (p.dy * 1000.0).round() != 0.0;
        if moved {
            out.extend_from_slice(b"q 1 0 0 1 ");
            write_coord(&mut out, p.dx);
            out.push(b' ');
            write_coord(&mut out, p.dy);
            out.extend_from_slice(b" cm\n");
        } else {
            out.extend_from_slice(b"q\n");
        }
        out.extend_from_slice(inner);
        out.extend_from_slice(b"Q\n");
        from = p.at + p.len;
    }
    if let Some(rest) = content.get(from..) {
        out.extend_from_slice(rest);
    }
    out
}

/// Meetschaal van een (deel van een) pagina.
#[derive(Clone, Debug, PartialEq)]
pub struct PageMeasure {
    pub bbox: [f64; 4],
    /// Millimeters (in de eenheid `unit`) per paginapunt.
    pub units_per_point: f64,
    /// Eenheidslabel: mm, cm, m, in of ft.
    pub unit: String,
    /// Schaal als tekst, bijvoorbeeld `1:100`.
    pub ratio: String,
    pub name: String,
    /// Pagina → tekeningcoördinaten, voor de weg terug naar CAD.
    pub model_matrix: Option<Matrix>,
    pub model_units: String,
    /// Eigen vorm van het gebied (paginapunten) als het geen rechthoek is;
    /// leeg = de `bbox`. Gaat als `/OPS_Clip` mee, zodat de lezer een punt
    /// binnen de omhullende maar buiten de vorm aan het buurvenster geeft.
    pub outline: Vec<Point>,
}

/// Eén pagina klaar om weg te schrijven.
pub struct OutputPage {
    pub width_pt: f64,
    pub height_pt: f64,
    pub content: Vec<u8>,
    pub layers: Vec<usize>,
    /// Dekkingen (per duizend) die de inhoudsstroom gebruikt.
    pub alphas: Vec<u16>,
    /// Letters die de inhoudsstroom gebruikt, in de volgorde van `/F1`, `/F2`, …
    pub fonts: Vec<FontChoice>,
    /// Beelden die de inhoudsstroom gebruikt, in de volgorde van `/Im0`,
    /// `/Im1`, …; de sleutel is uniek per bronbestand, zodat pagina's die
    /// hetzelfde beeld tonen één beeldobject delen.
    pub images: Vec<(String, Rc<Raster>)>,
    /// Formulieren die de inhoudsstroom (of een ander formulier) plaatst, in
    /// de volgorde van `/Fm0`, `/Fm1`, …
    pub forms: Vec<PageForm>,
    pub measures: Vec<PageMeasure>,
    pub label: String,
}

fn number_format(unit: &str, factor: f64) -> Obj {
    Obj::dict(vec![
        ("Type", Obj::name("NumberFormat")),
        ("U", Obj::text(unit)),
        ("C", Obj::Real(factor)),
        ("D", Obj::Int(100)),
        ("F", Obj::name("D")),
        ("RD", Obj::text(".")),
        ("RT", Obj::text("")),
    ])
}

/// Sleutel in de catalogus en op elke pagina van een voorbeeld-PDF.
pub const PREVIEW_MARK: &str = "OPS_Preview";

/// Schrijft de pagina's als PDF-bestand.
pub fn write_pdf<W: Write>(target: &mut W, pages: Vec<OutputPage>, registry: &LayerRegistry, title: &str) -> std::io::Result<()> {
    write_pdf_with(target, pages, registry, title, false, &|| false, &mut |_, _| {})
}

/// Als [`write_pdf`], met afbreken (`cancelled` geeft true → fout van soort
/// `Interrupted`) en voortgang per pagina (klaar, totaal). De inhoud van de
/// pagina's wordt verplaatst, niet gekopieerd: bij een grote tekening scheelt
/// dat honderden megabytes.
///
/// `preview` merkt het bestand als voorbeeld: `/OPS_Preview true` in de
/// catalogus en op elke pagina (zodat het merk meegaat als iemand de pagina's
/// naar een ander document kopieert). Een voorbeeld kan inhoud missen; de app
/// weigert het daarom als bron voor invoegen en opslaan.
pub fn write_pdf_with<W: Write>(
    target: &mut W,
    pages: Vec<OutputPage>,
    registry: &LayerRegistry,
    title: &str,
    preview: bool,
    cancelled: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(u64, u64),
) -> std::io::Result<()> {
    let interrupted = || std::io::Error::new(std::io::ErrorKind::Interrupted, "afgebroken");
    let total = pages.len() as u64;
    let mut pdf = PdfFile::new();
    let catalog = pdf.reserve();
    let pages_id = pdf.reserve();
    // Een object per standaardletter, gedeeld door alle pagina's. De gewone
    // schreefloze letter staat er altijd en als eerste: een tekening zonder
    // lettervervanging levert zo byte voor byte dezelfde PDF als voorheen.
    let mut font_objects: Vec<(&'static str, u32)> = Vec::new();
    let mut font_ref = |pdf: &mut PdfFile, name: &'static str| -> u32 {
        if let Some((_, id)) = font_objects.iter().find(|(n, _)| *n == name) {
            return *id;
        }
        let id = pdf.add(Obj::dict(vec![
            ("Type", Obj::name("Font")),
            ("Subtype", Obj::name("Type1")),
            ("BaseFont", Obj::name(name)),
            ("Encoding", Obj::name("WinAnsiEncoding")),
        ]));
        font_objects.push((name, id));
        id
    };
    let default_font = font_ref(&mut pdf, FontChoice::DEFAULT.base_font());
    let ocgs: Vec<u32> = registry
        .names
        .iter()
        .map(|name| pdf.add(Obj::dict(vec![("Type", Obj::name("OCG")), ("Name", Obj::text(name))])))
        .collect();

    // Eén beeldobject per bronbestand, gedeeld door alle pagina's.
    let mut image_objects: HashMap<String, u32> = HashMap::new();
    let mut page_ids = Vec::with_capacity(pages.len());
    for (number, mut page) in pages.into_iter().enumerate() {
        if cancelled() {
            return Err(interrupted());
        }
        progress(number as u64, total);
        // Eén inhoudsstroom kan honderden megabytes zijn: het inpakken vraagt
        // de afbreekvlag per blok.
        let content = pdf.add_stream_with(Vec::new(), std::mem::take(&mut page.content), true, cancelled)?;
        let mut properties = Vec::new();
        for index in &page.layers {
            properties.push((format!("L{index}"), Obj::Ref(ocgs[*index])));
        }
        // Vet deelt zijn letterobject met de gewone letter; alleen de naam van
        // de bron verschilt.
        let mut fonts: Vec<(String, Obj)> = Vec::with_capacity(page.fonts.len().max(1));
        for (index, choice) in page.fonts.iter().enumerate() {
            let id = font_ref(&mut pdf, choice.base_font());
            fonts.push((format!("F{}", index + 1), Obj::Ref(id)));
        }
        if fonts.is_empty() {
            // Een pagina zonder tekst houdt toch een letterbron.
            fonts.push(("F1".to_string(), Obj::Ref(default_font)));
        }
        let mut resources = vec![
            ("Font".to_string(), Obj::Dict(fonts)),
            ("ProcSet".to_string(), Obj::Array(vec![Obj::name("PDF"), Obj::name("Text")])),
        ];
        if !page.alphas.is_empty() {
            let states: Vec<(String, Obj)> = page
                .alphas
                .iter()
                .map(|value| {
                    let alpha = *value as f64 / 1000.0;
                    (
                        format!("GS{value}"),
                        Obj::dict(vec![
                            ("Type", Obj::name("ExtGState")),
                            ("ca", Obj::Real(alpha)),
                            ("CA", Obj::Real(alpha)),
                        ]),
                    )
                })
                .collect();
            resources.push(("ExtGState".to_string(), Obj::Dict(states)));
        }
        if !properties.is_empty() {
            resources.push(("Properties".to_string(), Obj::Dict(properties)));
        }
        if !page.images.is_empty() {
            let mut xobjects: Vec<(String, Obj)> = Vec::with_capacity(page.images.len());
            for (slot, (key, raster)) in std::mem::take(&mut page.images).into_iter().enumerate() {
                let id = match image_objects.get(&key) {
                    Some(id) => *id,
                    None => {
                        // Het inpakken van een groot beeld duurt even.
                        if cancelled() {
                            return Err(interrupted());
                        }
                        let id = add_image(&mut pdf, raster, cancelled)?;
                        image_objects.insert(key, id);
                        id
                    }
                };
                xobjects.push((format!("Im{slot}"), Obj::Ref(id)));
            }
            resources.push(("XObject".to_string(), Obj::Dict(xobjects)));
            image_procset(&mut resources);
        }
        let mut shared_resources = None;
        if !page.forms.is_empty() {
            // Alle formulieren van de pagina delen één bronnenobject, met
            // dezelfde bronnen als de pagina: een formulier gebruikt de lagen,
            // letters en beelden van de pagina en kan een ander formulier
            // plaatsen. Het nummer is gereserveerd voordat de formulieren
            // bestaan, en wordt gezet zodra hun nummers bekend zijn.
            let shared = pdf.reserve();
            let mut form_objects: Vec<(String, Obj)> = Vec::with_capacity(page.forms.len());
            for form in std::mem::take(&mut page.forms) {
                let dict = vec![
                    ("Type".to_string(), Obj::name("XObject")),
                    ("Subtype".to_string(), Obj::name("Form")),
                    ("BBox".to_string(), Obj::reals(&form.bbox)),
                    ("Resources".to_string(), Obj::Ref(shared)),
                ];
                let id = pdf.add_stream_with(dict, form.content, true, cancelled)?;
                form_objects.push((format!("Fm{}", form.number), Obj::Ref(id)));
            }
            match resources.iter_mut().find(|(name, _)| name == "XObject") {
                Some((_, Obj::Dict(entries))) => entries.extend(form_objects),
                _ => resources.push(("XObject".to_string(), Obj::Dict(form_objects))),
            }
            // De pagina gebruikt hetzelfde object: wie later de lagen van de
            // pagina hernoemt of samenvoegt, doet dat meteen voor haar
            // formulieren.
            pdf.set(shared, Obj::Dict(std::mem::take(&mut resources)));
            shared_resources = Some(shared);
        }
        let mut page_dict = vec![
            ("Type".to_string(), Obj::name("Page")),
            ("Parent".to_string(), Obj::Ref(pages_id)),
            ("MediaBox".to_string(), Obj::reals(&[0.0, 0.0, page.width_pt, page.height_pt])),
            ("Resources".to_string(), shared_resources.map_or_else(|| Obj::Dict(resources), Obj::Ref)),
            ("Contents".to_string(), Obj::Ref(content)),
        ];
        if preview {
            page_dict.push((PREVIEW_MARK.to_string(), Obj::Bool(true)));
        }
        if !page.measures.is_empty() {
            let viewports: Vec<Obj> = page
                .measures
                .iter()
                .map(|m| {
                    let mut vp = vec![
                        ("Type".to_string(), Obj::name("Viewport")),
                        ("BBox".to_string(), Obj::reals(&m.bbox)),
                        ("Name".to_string(), Obj::text(&m.name)),
                        (
                            "Measure".to_string(),
                            Obj::dict(vec![
                                ("Type", Obj::name("Measure")),
                                ("Subtype", Obj::name("RL")),
                                ("R", Obj::text(&m.ratio)),
                                ("X", Obj::Array(vec![number_format(&m.unit, m.units_per_point)])),
                                ("D", Obj::Array(vec![number_format(&m.unit, 1.0)])),
                                ("A", Obj::Array(vec![number_format(&format!("{}\u{b2}", m.unit), 1.0)])),
                            ]),
                        ),
                    ];
                    if let Some(matrix) = m.model_matrix {
                        vp.push((
                            "OPS_ModelMatrix".to_string(),
                            Obj::reals(&[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]),
                        ));
                        vp.push(("OPS_ModelUnits".to_string(), Obj::text(&m.model_units)));
                    }
                    if m.outline.len() >= 3 {
                        let flat: Vec<f64> = m.outline.iter().flat_map(|p| [p.x, p.y]).collect();
                        vp.push(("OPS_Clip".to_string(), Obj::reals(&flat)));
                    }
                    Obj::Dict(vp)
                })
                .collect();
            page_dict.push(("VP".to_string(), Obj::Array(viewports)));
        }
        page_ids.push(pdf.add(Obj::Dict(page_dict)));
    }

    pdf.set(
        pages_id,
        Obj::dict(vec![
            ("Type", Obj::name("Pages")),
            ("Count", Obj::Int(page_ids.len() as i64)),
            ("Kids", Obj::Array(page_ids.iter().map(|id| Obj::Ref(*id)).collect())),
        ]),
    );

    let mut catalog_entries = vec![("Type".to_string(), Obj::name("Catalog")), ("Pages".to_string(), Obj::Ref(pages_id))];
    if !ocgs.is_empty() {
        let all: Vec<Obj> = ocgs.iter().map(|id| Obj::Ref(*id)).collect();
        let on: Vec<Obj> = ocgs
            .iter()
            .enumerate()
            .filter(|(i, _)| !registry.hidden[*i])
            .map(|(_, id)| Obj::Ref(*id))
            .collect();
        let off: Vec<Obj> = ocgs
            .iter()
            .enumerate()
            .filter(|(i, _)| registry.hidden[*i])
            .map(|(_, id)| Obj::Ref(*id))
            .collect();
        catalog_entries.push((
            "OCProperties".to_string(),
            Obj::dict(vec![
                ("OCGs", Obj::Array(all.clone())),
                (
                    "D",
                    Obj::dict(vec![
                        ("Name", Obj::text("Lagen")),
                        ("BaseState", Obj::name("ON")),
                        ("Order", Obj::Array(all)),
                        ("ON", Obj::Array(on)),
                        ("OFF", Obj::Array(off)),
                    ]),
                ),
            ]),
        ));
    }
    if preview {
        catalog_entries.push((PREVIEW_MARK.to_string(), Obj::Bool(true)));
    }
    pdf.set(catalog, Obj::Dict(catalog_entries));
    let info = pdf.add(Obj::dict(vec![
        ("Title", Obj::text(title)),
        ("Producer", Obj::text("Open PDF Studio")),
        ("Creator", Obj::text("Open PDF Studio")),
    ]));
    if cancelled() {
        return Err(interrupted());
    }
    progress(total, total);
    pdf.write_to_with(target, catalog, Some(info), cancelled)
}

/// Beeldoperatoren horen in `/ProcSet`: de sleutel krijgt de beeldsoorten
/// erbij, en wordt toegevoegd als de bronnen hem nog niet hebben.
fn image_procset(resources: &mut Vec<(String, Obj)>) {
    let procset = Obj::Array(["PDF", "Text", "ImageB", "ImageC"].iter().map(|n| Obj::name(n)).collect());
    match resources.iter_mut().find(|(name, _)| name == "ProcSet") {
        Some((_, existing)) => *existing = procset,
        None => resources.push(("ProcSet".to_string(), procset)),
    }
}

/// De bytes van een beeld voor de stream. De laatste houder geeft ze af;
/// delen meer pagina's het beeld nog, dan een kopie, met een nette fout
/// (`OutOfMemory`) als die niet past.
fn stream_bytes(raster: Rc<Raster>) -> std::io::Result<Vec<u8>> {
    match Rc::try_unwrap(raster) {
        Ok(owned) => match owned.pixels {
            Pixels::Jpeg { data, .. } | Pixels::Flate { data, .. } | Pixels::Gray8(data) | Pixels::Rgb8(data) => Ok(data),
        },
        Err(shared) => {
            let source = match &shared.pixels {
                Pixels::Jpeg { data, .. } | Pixels::Flate { data, .. } | Pixels::Gray8(data) | Pixels::Rgb8(data) => data,
            };
            let mut copy = Vec::new();
            super::pdf_writer::reserve(&mut copy, source.len())?;
            copy.extend_from_slice(source);
            Ok(copy)
        }
    }
}

/// Schrijft één beeld-XObject. JPEG gaat ongewijzigd mee (`DCTDecode`); een
/// beeld dat bij het lezen al is ingepakt ook (`FlateDecode`); losse
/// beeldpunten worden hier ingepakt.
fn add_image(pdf: &mut PdfFile, raster: Rc<Raster>, cancelled: &dyn Fn() -> bool) -> std::io::Result<u32> {
    let mut dict = vec![
        ("Type".to_string(), Obj::name("XObject")),
        ("Subtype".to_string(), Obj::name("Image")),
        ("Width".to_string(), Obj::Int(i64::from(raster.width))),
        ("Height".to_string(), Obj::Int(i64::from(raster.height))),
        ("ColorSpace".to_string(), Obj::name(raster.color_space())),
        ("BitsPerComponent".to_string(), Obj::Int(8)),
    ];
    match &raster.pixels {
        // Vanuit geleende bytes: geen kopie van het onverpakte beeld.
        Pixels::Gray8(bytes) | Pixels::Rgb8(bytes) => pdf.add_packed_stream_with(dict, bytes, cancelled),
        Pixels::Flate { .. } => Ok(pdf.add_flate_stream(dict, stream_bytes(raster)?)),
        Pixels::Jpeg { .. } => {
            dict.push(("Filter".to_string(), Obj::name("DCTDecode")));
            Ok(pdf.add_stream(dict, stream_bytes(raster)?, false))
        }
    }
}

/// Meetschaal voor een hele pagina op schaal 1:N.
pub fn page_measure(width_pt: f64, height_pt: f64, scale: f64, unit: &str, mm_per_unit: f64, model_matrix: Option<Matrix>) -> PageMeasure {
    // Eén punt is 25,4/72 mm op papier; op schaal 1:N dus N keer zoveel in het
    // model, omgerekend naar de eenheid van de tekening.
    let units_per_point = MM_PER_PT * scale / mm_per_unit.max(1e-12);
    PageMeasure {
        bbox: [0.0, 0.0, width_pt, height_pt],
        units_per_point,
        unit: unit.to_string(),
        ratio: super::paper::scale_text(scale),
        name: String::new(),
        model_matrix,
        model_units: unit.to_string(),
        outline: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::style::Dash;

    fn path(points: &[(f64, f64)]) -> PagePath {
        let mut p = PagePath::new();
        for (i, (x, y)) in points.iter().enumerate() {
            if i == 0 {
                p.move_to(Point::new(*x, *y));
            } else {
                p.line_to(Point::new(*x, *y));
            }
        }
        p
    }

    #[test]
    fn cancelling_is_noticed_inside_one_large_content_stream() {
        // Eén pagina met een inhoudsstroom van een paar blokken: de vlag wordt
        // ook binnen het inpakken van die ene stroom gevraagd, niet alleen per
        // pagina.
        let line = b"123.456 789.012 m 234.567 890.123 l S\n";
        let content: Vec<u8> = line.iter().copied().cycle().take(4 * super::super::pdf_writer::PACK_BLOCK).collect();
        let page = OutputPage {
            width_pt: 100.0,
            height_pt: 100.0,
            content,
            layers: Vec::new(),
            alphas: Vec::new(),
            fonts: Vec::new(),
            images: Vec::new(),
            forms: Vec::new(),
            measures: Vec::new(),
            label: "Model".into(),
        };
        let polls = std::cell::Cell::new(0usize);
        let cancelled = || {
            polls.set(polls.get() + 1);
            polls.get() > 3
        };
        let mut out = Vec::new();
        let error = write_pdf_with(&mut out, vec![page], &LayerRegistry::default(), "t", false, &cancelled, &mut |_, _| {}).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::Interrupted);
        assert_eq!(polls.get(), 4, "één keer per pagina en daarna per blok");
        assert!(out.is_empty(), "er is nog niets geschreven");
    }

    #[test]
    fn content_sets_state_once_and_wraps_layers() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(100.0, 100.0, &mut registry, true);
        let stroke = Stroke { color: (255, 0, 0), width: 0.5, dash: None, cap: 1, join: 1, alpha: 1.0 };
        page.stroke("Wanden", &stroke, &path(&[(0.0, 0.0), (10.0, 10.0)]));
        page.stroke("Wanden", &stroke, &path(&[(0.0, 10.0), (10.0, 0.0)]));
        page.fill("Vlakken", (0, 0, 0), 1.0, &path(&[(0.0, 0.0), (5.0, 0.0), (5.0, 5.0)]), true);
        let (content, used, _, _, _, _) = page.finish();
        let text = String::from_utf8_lossy(&content).to_string();
        assert_eq!(text.matches("1 0 0 RG").count(), 1, "{text}");
        assert_eq!(text.matches("0.5 w").count(), 1);
        assert_eq!(text.matches("/OC /L0 BDC").count(), 1);
        assert_eq!(text.matches("/OC /L1 BDC").count(), 1);
        assert_eq!(text.matches("EMC").count(), 2);
        assert!(text.contains("f*"));
        assert_eq!(used, vec![0, 1]);
        assert_eq!(registry.names, vec!["Wanden".to_string(), "Vlakken".to_string()]);
    }

    #[test]
    fn thousands_of_layers_are_registered_in_order_without_a_search_per_item() {
        // Vijfduizend lagen, elk drie keer getekend, door elkaar: de lijst
        // gebruikte lagen houdt de volgorde van eerste gebruik en geen dubbele.
        // Een lineaire zoektocht per onderdeel zou hier 5000 × 15 000 / 2
        // vergelijkingen kosten; met de vlaggenlijst is het één per onderdeel.
        let mut registry = LayerRegistry::default();
        // Een tweede pagina begint met een leeg gebruik, ook al kent het
        // register de lagen al: de indexen zijn dan niet dicht bij nul.
        for i in 0..100 {
            registry.index_of(&format!("Eerder{i}"));
        }
        let mut page = PageBuilder::new(100.0, 100.0, &mut registry, true);
        let stroke = Stroke { color: (0, 0, 0), width: 0.5, dash: None, cap: 1, join: 1, alpha: 1.0 };
        let names: Vec<String> = (0..5000).map(|i| format!("Laag{i}")).collect();
        for round in 0..3 {
            for name in names.iter().skip(round).chain(names.iter().take(round)) {
                page.stroke(name, &stroke, &path(&[(0.0, 0.0), (1.0, 1.0)]));
            }
        }
        let (_, used, _, _, _, _) = page.finish();
        assert_eq!(used, (100..5100).collect::<Vec<usize>>());
    }

    #[test]
    fn clipping_restores_the_state_and_narrows_the_visible_area() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(100.0, 100.0, &mut registry, false);
        let stroke =
            Stroke { color: (0, 0, 0), width: 1.0, dash: Some(Dash { array: vec![2.0, 1.0], phase: 0.5 }), cap: 0, join: 0, alpha: 1.0 };
        page.stroke("a", &stroke, &path(&[(0.0, 0.0), (1.0, 1.0)]));
        assert!(page.wants([50.0, 50.0, 60.0, 60.0]));
        page.push_clip(&path(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]), false);
        assert!(!page.wants([50.0, 50.0, 60.0, 60.0]));
        assert!(page.wants([5.0, 5.0, 6.0, 6.0]));
        page.pop_clip();
        assert!(page.wants([50.0, 50.0, 60.0, 60.0]));
        // Na Q staat de oude toestand er weer; dezelfde stijl hoeft niet
        // opnieuw geschreven te worden.
        page.stroke("a", &stroke, &path(&[(0.0, 0.0), (1.0, 1.0)]));
        let (content, _, _, _, _, _) = page.finish();
        let text = String::from_utf8_lossy(&content).to_string();
        assert_eq!(text.matches("[2 1] 0.5 d").count(), 1, "{text}");
        assert_eq!(text.matches("W n").count(), 1);
        assert!(!text.contains("BDC"));
    }

    /// Tekent een blokje van vier lijnen op `x`, zoals de wandelaar dat doet:
    /// eerst vragen of het binnen beeld valt, dan tekenen.
    fn block_at(page: &mut PageBuilder<'_>, x: f64, lines: usize) {
        let solid = Stroke { color: (0, 0, 255), width: 0.25, dash: None, cap: 1, join: 1, alpha: 1.0 };
        for n in 0..lines {
            let line = path(&[(x, 10.0 + n as f64), (x + 20.0, 10.0 + n as f64)]);
            if page.wants(line.bounds().unwrap()) {
                page.stroke("Symbolen", &solid, &line);
            }
        }
    }

    #[test]
    fn a_form_writes_its_own_state_and_leaves_the_page_state_alone() {
        let dashed =
            Stroke { color: (255, 0, 0), width: 1.0, dash: Some(Dash { array: vec![2.0, 1.0], phase: 0.0 }), cap: 0, join: 0, alpha: 1.0 };
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, true).with_forms(true);
        assert!(page.takes_forms());
        page.stroke("Kader", &dashed, &path(&[(0.0, 0.0), (400.0, 0.0)]));
        // Eerste plaatsing: gewoon tekenen en meten.
        assert_eq!(page.begin_form("blok", Point::new(100.0, 10.0)), FormAction::Measure);
        block_at(&mut page, 100.0, 30);
        assert!(!page.end_form(true));
        // Tweede plaatsing: opnemen. Derde: plaatsen.
        assert_eq!(page.begin_form("blok", Point::new(200.0, 10.0)), FormAction::Record);
        block_at(&mut page, 200.0, 30);
        assert!(page.end_form(true));
        assert_eq!(page.begin_form("blok", Point::new(300.5, 10.0)), FormAction::Placed);
        for n in 0..10 {
            assert_eq!(page.begin_form("blok", Point::new(40.0 * n as f64, 200.0)), FormAction::Placed);
        }
        // Buiten de pagina: niets. Half erop: gewoon tekenen.
        assert_eq!(page.begin_form("blok", Point::new(900.0, 10.0)), FormAction::Skipped);
        assert_eq!(page.begin_form("blok", Point::new(490.0, 10.0)), FormAction::Draw);
        // De pagina gaat verder in haar eigen toestand, die van de eerste
        // (gewoon getekende) plaatsing: dezelfde stijl hoeft niet opnieuw
        // ingesteld, ook al zette het formulier hem intussen zelf.
        let solid = Stroke { color: (0, 0, 255), width: 0.25, dash: None, cap: 1, join: 1, alpha: 1.0 };
        page.stroke("Symbolen", &solid, &path(&[(0.0, 5.0), (400.0, 5.0)]));
        assert_eq!(page.items, 2 + 13 * 30, "een plaatsing telt haar onderdelen mee");
        let charged = page.charged_bytes();
        let (content, _, _, _, _, forms) = page.finish();
        let text = String::from_utf8_lossy(&content).to_string();
        assert_eq!(forms.len(), 1);
        let form = String::from_utf8_lossy(&forms[0].content).to_string();
        // Het formulier erft de toestand van de plek waar het staat, en zet
        // daarom alles zelf: ook dat de lijn doorgetrokken is.
        assert!(form.starts_with("/OC /L1 BDC\n"), "{form}");
        for needed in ["0 0 1 RG", "0.25 w", "1 J", "1 j", "[] 0 d", "/GS1000 gs"] {
            assert!(form.contains(needed), "{needed} ontbreekt in {form}");
        }
        assert!(form.trim_end().ends_with("EMC"), "{form}");
        assert_eq!(text.matches("/Fm0 Do").count(), 12, "{text}");
        assert_eq!((forms[0].number, forms[0].uses), (0, 12));
        assert!(text.contains("q 1 0 0 1 100.5 0 cm /Fm0 Do Q"), "{text}");
        assert_eq!(text.matches("[2 1] 0 d").count(), 1, "{text}");
        for once in ["0 0 1 RG", "0.25 w", "[] 0 d"] {
            assert_eq!(text.matches(once).count(), 1, "{once} in {text}");
        }
        // De omhullende is die van de opname, met ruimte voor de lijndikte.
        let b = forms[0].bbox;
        assert!(b[0] < 200.0 && b[0] > 190.0 && b[2] > 220.0 && b[2] < 230.0, "{b:?}");
        // De begroting telt de geplaatste formulieren uitgevouwen mee.
        // (Het afsluiten van de laatste laag komt er bij het afronden nog bij.)
        assert!(charged + 8 >= content.len() + 12 * forms[0].content.len(), "{charged}");
    }

    #[test]
    fn a_block_without_a_known_extent_is_not_taken_for_a_block_that_draws_nothing() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, false).with_forms(true);
        // Een blok dat echt niets tekent, tekent de volgende keer ook niets.
        assert_eq!(page.begin_form("leeg", Point::new(100.0, 10.0)), FormAction::Measure);
        page.end_form(true);
        assert_eq!(page.begin_form("leeg", Point::new(200.0, 10.0)), FormAction::Skipped);
        // Een blok dat wel iets in de stroom zette zonder zijn omhullende te
        // melden: daarvan is niet bekend waar het staat, maar wel dat het iets
        // tekent. Dat wordt elke keer gewoon getekend, nooit overgeslagen.
        assert_eq!(page.begin_form("zonder", Point::new(100.0, 10.0)), FormAction::Measure);
        page.content.extend_from_slice(b"0 0 m 10 10 l S\n");
        page.end_form(true);
        assert_eq!(page.begin_form("zonder", Point::new(200.0, 10.0)), FormAction::Draw);
    }

    #[test]
    fn a_tiny_block_is_drawn_every_time_and_a_half_recording_goes_into_the_page() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, false).with_forms(true);
        // Eén lijn, in beeld gemeten: te klein, dus nooit opgenomen.
        assert_eq!(page.begin_form("klein", Point::new(100.0, 10.0)), FormAction::Measure);
        block_at(&mut page, 100.0, 1);
        page.end_form(true);
        assert_eq!(page.begin_form("klein", Point::new(200.0, 10.0)), FormAction::Draw);
        // Buiten beeld gemeten is de omvang niet bekend: dan blijkt het bij
        // de opname, en die gaat gewoon de pagina in.
        assert_eq!(page.begin_form("ver", Point::new(900.0, 10.0)), FormAction::Measure);
        block_at(&mut page, 900.0, 1);
        page.end_form(true);
        assert_eq!(page.begin_form("ver", Point::new(200.0, 10.0)), FormAction::Record);
        block_at(&mut page, 200.0, 1);
        assert!(!page.end_form(true), "te klein voor een formulier");
        assert_eq!(page.begin_form("ver", Point::new(300.0, 10.0)), FormAction::Draw);
        // Een opname die niet af is, wordt geen formulier en de sleutel blijft
        // wat hij was.
        assert_eq!(page.begin_form("groot", Point::new(100.0, 100.0)), FormAction::Measure);
        block_at(&mut page, 100.0, 8);
        page.end_form(true);
        assert_eq!(page.begin_form("groot", Point::new(200.0, 100.0)), FormAction::Record);
        block_at(&mut page, 200.0, 3);
        assert!(!page.end_form(false));
        assert_eq!(page.begin_form("groot", Point::new(300.0, 100.0)), FormAction::Record);
        block_at(&mut page, 300.0, 8);
        // Zonder afsluiten: afronden zet de inhoud alsnog in de pagina.
        let (content, _, _, _, _, forms) = page.finish();
        assert!(forms.is_empty());
        let text = String::from_utf8_lossy(&content).to_string();
        assert_eq!(text.matches(" l\nS\n").count(), 1 + 1 + 8 + 3 + 8, "{text}");
        assert!(!text.contains("Do"));
        // Zonder hergebruik doet de bouwer niets met een blok.
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, false);
        assert!(!page.takes_forms());
        assert_eq!(page.begin_form("blok", Point::new(0.0, 0.0)), FormAction::Draw);
    }

    #[test]
    fn forms_in_the_file_share_one_resources_object() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, true).with_forms(true);
        for n in 0..24 {
            let (x, y) = (20.0 + 30.0 * (n % 12) as f64, 10.0 + 100.0 * (n / 12) as f64);
            match page.begin_form(if n < 12 { "a" } else { "b" }, Point::new(x, y)) {
                FormAction::Measure | FormAction::Record => {
                    block_at(&mut page, x, 30);
                    page.end_form(true);
                }
                other => assert_eq!(other, FormAction::Placed),
            }
        }
        let (content, layers, alphas, fonts, images, forms) = page.finish();
        assert_eq!(forms.len(), 2);
        let pages = vec![OutputPage {
            width_pt: 500.0,
            height_pt: 500.0,
            content,
            layers,
            alphas,
            fonts,
            images,
            forms,
            measures: Vec::new(),
            label: "Model".into(),
        }];
        let mut out = Vec::new();
        write_pdf(&mut out, pages, &registry, "t").unwrap();
        let text = String::from_utf8_lossy(&out).to_string();
        assert_eq!(text.matches("/Subtype /Form").count(), 2);
        assert!(text.contains("/Fm0 ") && text.contains("/Fm1 "), "{text}");
        // De twee formulieren verwijzen naar hetzelfde bronnenobject, en dat
        // object kent de lagen en de formulieren.
        let shared: Vec<&str> = text.match_indices("/Subtype /Form").map(|(at, _)| {
            let rest = &text[at..];
            let start = rest.find("/Resources ").unwrap() + "/Resources ".len();
            rest[start..].split(" R").next().unwrap()
        }).collect();
        assert_eq!(shared[0], shared[1]);
        assert!(shared[0].ends_with(" 0"), "{shared:?}");
        // De pagina gebruikt hetzelfde object: de lagen staan er één keer.
        let page_at = text.find("/Type /Page/").expect("de pagina");
        assert!(text[page_at..].contains(&format!("/Resources {} R/Contents", shared[0])), "{}", &text[page_at..]);
        assert_eq!(text.matches("/Properties").count(), 1);
    }

    #[test]
    fn a_recording_that_does_not_pay_goes_back_into_the_page_when_it_is_finished() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(500.0, 500.0, &mut registry, true).with_forms(true);
        // Drie plaatsingen: gewoon, opgenomen, geplaatst. Eén plaatsing van
        // tweehonderd bytes weegt niet op tegen een eigen object.
        for n in 0..3 {
            let x = 20.0 + 100.0 * n as f64;
            match page.begin_form("blok", Point::new(x, 10.0)) {
                FormAction::Measure | FormAction::Record => {
                    block_at(&mut page, x, 8);
                    page.end_form(true);
                }
                other => assert_eq!(other, FormAction::Placed),
            }
        }
        let after = Stroke { color: (0, 0, 255), width: 0.25, dash: None, cap: 1, join: 1, alpha: 1.0 };
        page.stroke("Symbolen", &after, &path(&[(0.0, 5.0), (400.0, 5.0)]));
        let (content, _, _, _, _, forms) = page.finish();
        assert!(forms.is_empty());
        let text = String::from_utf8_lossy(&content).to_string();
        assert!(!text.contains("Do"), "{text}");
        // De opname staat er twee keer, elk tussen q en Q, de tweede verschoven.
        assert_eq!(text.matches("120 10 m").count(), 2, "{text}");
        assert!(text.contains("EMC\nq\n/OC /L0 BDC\n"), "{text}");
        assert!(text.contains("Q\nq 1 0 0 1 100 0 cm\n/OC /L0 BDC\n"), "{text}");
        assert_eq!(text.matches("BDC").count(), text.matches("EMC").count());
        assert_eq!(text.matches("q").count(), text.matches("Q").count());
    }

    #[test]
    fn each_font_gets_its_own_resource_and_bold_is_stroked() {
        use crate::import::text::FontFamily;
        let mono = FontChoice { family: FontFamily::Mono, italic: false, bold: false };
        let bold = FontChoice { bold: true, ..FontChoice::DEFAULT };
        let at = |y: f64| Matrix::new(10.0, 0.0, 0.0, 10.0, 5.0, y);
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(200.0, 200.0, &mut registry, false);
        page.text("t", (255, 0, 0), 1.0, at(10.0), b"gewoon", FontChoice::DEFAULT);
        page.text("t", (255, 0, 0), 1.0, at(30.0), b"vast", mono);
        page.text("t", (255, 0, 0), 1.0, at(50.0), b"vet", bold);
        page.text("t", (255, 0, 0), 1.0, at(70.0), b"weer gewoon", FontChoice::DEFAULT);
        let (content, layers, alphas, fonts, images, forms) = page.finish();
        assert_eq!(fonts, vec![FontChoice::DEFAULT, mono, bold]);
        let text = String::from_utf8_lossy(&content).to_string();
        assert!(text.contains("BT /F1 1 Tf 10 0 0 10 5 10 Tm (gewoon) Tj ET"), "{text}");
        assert!(text.contains("BT /F2 1 Tf 10 0 0 10 5 30 Tm (vast) Tj ET"), "{text}");
        // Vet: streekkleur en een streek van 3% van de korpsgrootte staan voor
        // het tekstobject; de tekenstand gaat daarna terug naar vullen.
        assert!(text.contains("1 0 0 RG
0.3 w
BT /F3 1 Tf 2 Tr 10 0 0 10 5 50 Tm (vet) Tj 0 Tr ET"), "{text}");
        assert!(text.contains("BT /F1 1 Tf 10 0 0 10 5 70 Tm (weer gewoon) Tj ET"), "{text}");

        let pages = vec![OutputPage {
            width_pt: 200.0,
            height_pt: 200.0,
            content,
            layers,
            alphas,
            fonts,
            images,
            forms,
            measures: Vec::new(),
            label: "Model".into(),
        }];
        let mut out = Vec::new();
        write_pdf(&mut out, pages, &registry, "tekening.dwg").unwrap();
        let text = String::from_utf8_lossy(&out).to_string();
        assert_eq!(text.matches("/BaseFont /Helvetica").count(), 1, "vet deelt het object van de gewone letter");
        assert_eq!(text.matches("/BaseFont /Courier").count(), 1);
        assert!(text.contains("/F1 ") && text.contains("/F2 ") && text.contains("/F3 "), "{text}");
    }

    #[test]
    fn image_operators_are_named_in_the_procset_even_when_the_key_is_missing() {
        let wanted = Obj::Array(["PDF", "Text", "ImageB", "ImageC"].iter().map(|n| Obj::name(n)).collect());
        let mut with_key = vec![("ProcSet".to_string(), Obj::Array(vec![Obj::name("PDF"), Obj::name("Text")]))];
        image_procset(&mut with_key);
        assert_eq!(with_key, vec![("ProcSet".to_string(), wanted.clone())]);
        let mut without_key = vec![("Font".to_string(), Obj::Dict(Vec::new()))];
        image_procset(&mut without_key);
        assert_eq!(without_key.len(), 2);
        assert!(without_key.contains(&("ProcSet".to_string(), wanted)));
    }

    #[test]
    fn a_packed_image_goes_in_as_it_is_also_when_two_pages_share_it() {
        // Zes grijze beeldpunten, ingepakt zoals de import een beeld vasthoudt.
        let plain = [0u8, 50, 100, 150, 200, 250];
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        std::io::Write::write_all(&mut encoder, &plain).unwrap();
        let packed = encoder.finish().unwrap();
        let raster = Rc::new(Raster { width: 3, height: 2, pixels: Pixels::Flate { data: packed.clone(), gray: true } });
        let page = |key: &str| OutputPage {
            width_pt: 100.0,
            height_pt: 100.0,
            content: b"q 10 0 0 10 0 0 cm /Im0 Do Q\n".to_vec(),
            layers: Vec::new(),
            alphas: Vec::new(),
            fonts: Vec::new(),
            images: vec![(key.to_string(), raster.clone())],
            forms: Vec::new(),
            measures: Vec::new(),
            label: "Model".into(),
        };
        // Twee pagina's delen het beeld (één object), een derde sleutel geeft
        // een tweede object uit dezelfde, nog gedeelde bytes.
        let pages = vec![page("a"), page("a"), page("b")];
        let mut out = Vec::new();
        write_pdf(&mut out, pages, &LayerRegistry::default(), "t").unwrap();
        let text = String::from_utf8_lossy(&out).to_string();
        assert_eq!(text.matches("/Subtype /Image").count(), 2);
        assert_eq!(text.matches("/ColorSpace /DeviceGray").count(), 2);
        assert_eq!(text.matches("/ImageB").count(), 3, "elke pagina met een beeld noemt de beeldoperatoren");
        assert_eq!(out.windows(packed.len()).filter(|w| *w == packed.as_slice()).count(), 2, "de ingepakte bytes gaan ongewijzigd mee");
        assert_eq!(text.matches(&format!("/Length {}", packed.len())).count(), 2);
    }

    #[test]
    fn a_page_with_a_measure_scale_is_written() {
        let mut registry = LayerRegistry::default();
        let mut page = PageBuilder::new(842.0, 595.0, &mut registry, true);
        page.text("Tekst", (0, 0, 0), 1.0, Matrix::new(3.5, 0.0, 0.0, 3.5, 10.0, 20.0), b"Wand", FontChoice::DEFAULT);
        let (content, layers, alphas, fonts, images, forms) = page.finish();
        let measure = page_measure(842.0, 595.0, 100.0, "mm", 1.0, Some(Matrix::IDENTITY));
        assert!((measure.units_per_point - 35.2777778).abs() < 1e-6);
        assert_eq!(measure.ratio, "1:100");
        let pages = vec![OutputPage {
            width_pt: 842.0,
            height_pt: 595.0,
            content,
            layers,
            alphas,
            fonts,
            images,
            forms,
            measures: vec![measure],
            label: "Model".into(),
        }];
        let mut out = Vec::new();
        write_pdf(&mut out, pages, &registry, "tekening.dwg").unwrap();
        let text = String::from_utf8_lossy(&out).to_string();
        assert!(text.contains("/Type /Viewport"));
        assert!(text.contains("/Subtype /RL"));
        assert!(text.contains("/OCProperties"));
        assert!(text.starts_with("%PDF-1.7"));
        assert!(text.trim_end().ends_with("%%EOF"));
    }
}
