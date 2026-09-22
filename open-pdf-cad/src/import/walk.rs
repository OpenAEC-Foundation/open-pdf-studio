//! Doorloopt een tekening en levert wat er op papier komt (#400).
//!
//! De wandelaar kent geen PDF: hij geeft paden, vullingen en tekst in
//! paginapunten aan een [`Sink`]. Dezelfde wandeling levert de omhullende per
//! laag (voorverkenning) en de inhoud van de pagina (omzetting).
//!
//! Wat CAD op het scherm doet, doet de wandelaar hier na: blokken uitvouwen
//! (met de regels voor laag 0, ByBlock en geneste blokken), lagen die uit of
//! bevroren staan overslaan, en in een layout elke viewport met zijn eigen
//! schaal, knipgrens en bevroren lagen tekenen.

use super::curves::{add_elliptic_arc, bulge_arc, catmull_rom, ccw_sweep, sample_bspline, sane_angle, PagePath, Xform3};
use super::hatch;
use super::image::{ImageStore, Lookup, Raster};
use super::style::{paper_color, pdf_dash, ColorMode, Dash, LineweightMode, Rgb, DEFAULT_LINEWEIGHT_MM};
use super::text::{self, FontChoice, FontMap, HAlign, MTextRun, VAlign};
use super::xref::{XrefDoc, XrefDocs, MAX_XREF_DEPTH};
use crate::geom::{Matrix, Point};
use acadrust::entities::mtext_format::{parse_mtext, MTextColor, MTextScalar};
use acadrust::entities::{
    AttributeEntity, EntityCommon, EntityType, HorizontalAlignment, Insert, MText, Text, VerticalAlignment, Viewport,
};
use acadrust::objects::ObjectType;
use acadrust::types::{Color, Handle, LineWeight, Vector3};
use acadrust::CadDocument;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::rc::Rc;

/// Punten per millimeter.
const PT_PER_MM: f64 = 72.0 / 25.4;
/// Diepste blokgeneste die nog getekend wordt.
const MAX_DEPTH: u32 = 24;

/// Lijnstijl in paginaruimte.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub color: Rgb,
    /// Dikte in paginapunten (0 = dunst mogelijke lijn).
    pub width: f64,
    pub dash: Option<Dash>,
    /// 0 = recht afgesneden, 1 = rond.
    pub cap: u8,
    /// 0 = scherp, 1 = rond.
    pub join: u8,
    /// Dekking: 1 is ondoorzichtig, 0 volledig doorzichtig.
    pub alpha: f64,
}

impl Stroke {
    fn new(color: Rgb, width: f64) -> Self {
        Stroke { color, width, dash: None, cap: 1, join: 1, alpha: 1.0 }
    }
}

/// Wat de afnemer met een blokplaatsing doet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormAction {
    /// Gewoon tekenen (geen hergebruik).
    Draw,
    /// Gewoon tekenen, en de afnemer meet intussen hoe groot de plaatsing is.
    /// Zo gaat de eerste plaatsing van een blok: pas als hetzelfde blok nog
    /// eens op dezelfde manier staat, loont een formulier. Sluit af met
    /// [`Sink::end_form`].
    Measure,
    /// De afnemer neemt de inhoud op als formulier; teken hem één keer en
    /// sluit af met [`Sink::end_form`].
    Record,
    /// De afnemer had het formulier al en heeft het geplaatst; niets tekenen.
    Placed,
    /// De plaatsing valt helemaal buiten beeld; niets tekenen.
    Skipped,
}

/// Ontvanger van alles wat getekend wordt.
pub trait Sink {
    fn stroke(&mut self, layer: &str, style: &Stroke, path: &PagePath);
    fn fill(&mut self, layer: &str, color: Rgb, alpha: f64, path: &PagePath, even_odd: bool);
    fn text(&mut self, layer: &str, color: Rgb, alpha: f64, matrix: Matrix, bytes: &[u8], font: FontChoice);
    /// Een ingesloten afbeelding. `matrix` beeldt het eenheidsvierkant
    /// (0,0)-(1,1) af op het vlak waar het beeld komt, met de bovenste regel
    /// van het beeld op y = 1. `key` is uniek per bronbestand, zodat dezelfde
    /// afbeelding maar één keer in de PDF komt.
    fn image(&mut self, _layer: &str, _alpha: f64, _matrix: Matrix, _key: &str, _raster: &Rc<Raster>) {}
    fn push_clip(&mut self, _path: &PagePath, _even_odd: bool) {}
    fn pop_clip(&mut self) {}
    /// Valt dit binnen beeld? Paden erbuiten worden overgeslagen. De wandelaar
    /// vraagt dit voor alles wat hij tekent, ook voor wat buiten beeld blijkt:
    /// een afnemer die een blokplaatsing meet, leest hier de omhullende af.
    fn wants(&mut self, _bounds: [f64; 4]) -> bool {
        true
    }

    /// Doet de afnemer iets met [`Sink::begin_form`]? Zo niet, dan rekent de
    /// wandelaar de sleutel van een plaatsing niet eens uit.
    fn takes_forms(&self) -> bool {
        false
    }

    /// Begin van een blokplaatsing die als formulier hergebruikt kan worden.
    /// `key` is gelijk voor plaatsingen die op een verschuiving na dezelfde
    /// inhoud geven; `origin` is waar de oorsprong van het blok op de pagina
    /// ligt.
    fn begin_form(&mut self, _key: &str, _origin: Point) -> FormAction {
        FormAction::Draw
    }

    /// Sluit een plaatsing die met [`FormAction::Measure`] of
    /// [`FormAction::Record`] begon. `complete` is `false` als de wandeling
    /// onderweg is gestopt: wat er dan ligt is niet het hele blok en mag niet
    /// hergebruikt worden. Geeft `true` als er een formulier van gemaakt is.
    fn end_form(&mut self, _complete: bool) -> bool {
        false
    }

    /// Is de afnemer vol (bovengrens aan de uitvoer bereikt)? Dan stopt de
    /// wandeling en meldt de import dat de tekening te complex is.
    fn exhausted(&self) -> bool {
        false
    }
}

/// Standaard bovengrens aan het aantal bezoeken van één import: elke bezochte
/// entiteit, elke keer dat een blok wordt uitgevouwen en elke cel van een
/// MINSERT, plus het werk binnen zware entiteiten (zie [`WORK_PER_VISIT`]),
/// opgeteld over alle wandelingen (grenzen bepalen en tekenen, voor elke
/// gekozen ruimte). Een gewone zware tekening blijft daar ruim onder; een
/// blok dat zichzelf tweemaal invoegt zou zonder grens 2^24 keer uitvouwen.
pub const DEFAULT_MAX_VISITS: u64 = 40_000_000;

/// Bezoekbudget dat wandelingen met elkaar delen. Eén verkenning of één
/// omzetting maakt er één en geeft hem aan elke wandelaar mee: tien bladen die
/// elk net onder de grens blijven, mogen samen niet tien keer zo lang duren.
#[derive(Clone, Debug)]
pub struct VisitBudget(Rc<std::cell::Cell<u64>>);

impl VisitBudget {
    pub fn new(max_visits: u64) -> Self {
        VisitBudget(Rc::new(std::cell::Cell::new(max_visits)))
    }

    /// Neemt één bezoek af; `false` als het budget op is.
    fn spend(&self) -> bool {
        match self.0.get() {
            0 => false,
            left => {
                self.0.set(left - 1);
                true
            }
        }
    }

    /// Neemt `count` bezoeken in één keer af: een formulier dat geplaatst
    /// wordt, kost wat het uitvouwen van het blok had gekost. `false` als het
    /// budget daar niet groot genoeg voor is; het is dan op.
    fn spend_many(&self, count: u64) -> bool {
        let left = self.0.get();
        self.0.set(left.saturating_sub(count));
        left >= count
    }

    /// Wat er nog over is.
    pub fn left(&self) -> u64 {
        self.0.get()
    }
}

/// Instellingen die het tekenen sturen.
#[derive(Clone, Debug)]
pub struct WalkSettings {
    /// Lagen die uit staan (hoofdletterongevoelig, in hoofdletters).
    pub excluded_layers: HashSet<String>,
    pub color_mode: ColorMode,
    pub lineweight: LineweightMode,
    /// Kleurentabel; alleen gebruikt bij `LineweightMode::Pens`.
    pub pens: super::style::PenTable,
    pub lineweight_factor: f64,
    pub lineweight_min_mm: f64,
    pub linetypes: bool,
    pub text: bool,
    /// Vervangingstabel voor lettertypen.
    pub fonts: FontMap,
    pub hatch: HatchMode,
    /// Maatvoering, met de verwijslijnen (LEADER, MULTILEADER) erbij.
    pub dimensions: bool,
    pub attributes: bool,
    pub points: bool,
    /// Afbeeldingen insluiten als het bestand gevonden wordt (en de wandelaar
    /// een [`ImageStore`] meekreeg).
    pub images: bool,
    /// Grens aan het aantal patroonlijnen per arcering.
    pub max_hatch_lines: usize,
    /// Viewports in een layout tekenen.
    pub viewports: bool,
    /// Oneindige lijnen (RAY, XLINE) meetekenen. Uit bij het bepalen van de
    /// grenzen: ze zouden het gebied oneindig maken.
    pub infinite_lines: bool,
    /// Bovengrens aan het aantal bezoeken; daarboven stopt de wandeling met
    /// `too_complex`. Geldt voor deze wandelaar alleen zolang hij geen gedeeld
    /// budget heeft (zie [`Walker::share_budget`]).
    pub max_visits: u64,
    /// Een blok dat vaker op dezelfde manier staat als formulier aanbieden
    /// ([`Sink::begin_form`]). Werkt alleen bij een afnemer die formulieren
    /// aanneemt.
    pub reuse_blocks: bool,
}

impl Default for WalkSettings {
    fn default() -> Self {
        WalkSettings {
            excluded_layers: HashSet::new(),
            color_mode: ColorMode::File,
            lineweight: LineweightMode::File,
            pens: super::style::PenTable::default(),
            lineweight_factor: 1.0,
            lineweight_min_mm: 0.0,
            linetypes: true,
            text: true,
            fonts: FontMap::default(),
            hatch: HatchMode::All,
            dimensions: true,
            attributes: true,
            points: false,
            images: true,
            max_hatch_lines: 20_000,
            viewports: true,
            infinite_lines: true,
            max_visits: DEFAULT_MAX_VISITS,
            reuse_blocks: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HatchMode {
    /// Effen vullingen en patroonlijnen.
    #[default]
    All,
    /// Alleen effen vullingen; patronen als omtrek.
    SolidOnly,
    /// Alleen de omtrek.
    Outline,
    /// Arceringen weglaten.
    None,
}

/// Wat er tijdens de wandeling opviel.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkStats {
    /// Bezoeken: wat het werk kost en waar de werkgrens op telt. Elke
    /// entiteit (ook elk attribuut van een INSERT), elke uitgevouwen
    /// blokverwijzing en elke cel van een MINSERT, plus één per
    /// [`WORK_PER_VISIT`] hoekpunten, monsters, patroonlijnen of tekstregels
    /// binnen een entiteit.
    pub visits: u64,
    /// Entiteiten die langskwamen, voor weergave. Inhoud van een blok telt
    /// per invoeging mee; cellen en het uitvouwen zelf niet.
    pub entities: u64,
    pub drawn: u64,
    pub texts: u64,
    pub hatches: u64,
    /// Arceringen waarvan het patroon te fijn was; alleen de omtrek getekend.
    pub hatch_patterns_skipped: u64,
    /// Effen vlakvullingen die in "zuiver zwart-wit" zijn weggelaten omdat
    /// hun kleur lichter is dan de drempel.
    pub light_fills_dropped: u64,
    pub blocks_expanded: u64,
    pub missing_blocks: u64,
    /// Invoegingen van een externe verwijzing die niet geladen is omdat de
    /// gebruiker dat niet wilde (of omdat de wandeling er geen meekreeg).
    pub xrefs_skipped: u64,
    /// Externe verwijzingen (bestanden) die geladen zijn.
    pub xrefs_loaded: u64,
    /// Externe verwijzingen die niet gevonden werden of niet leesbaar waren.
    pub xrefs_missing: u64,
    /// Externe verwijzingen die geweigerd zijn: een onveilig pad, buiten de
    /// toegestane mappen, een kring, te diep of boven de begroting.
    pub xrefs_refused: u64,
    /// Afbeeldingen (en onderleggers) die niet ingesloten zijn omdat de
    /// gebruiker dat niet wilde, of omdat de soort niet ondersteund wordt.
    pub images_skipped: u64,
    /// Afbeeldingen die zijn ingesloten.
    pub images_embedded: u64,
    /// Afbeeldingen waarvan het bestand niet gevonden is (of die geen
    /// oppervlak hebben om op te tekenen).
    pub images_missing: u64,
    /// Afbeeldingen die geweigerd zijn: een onveilig pad, buiten de
    /// toegestane mappen, of boven het aantal bestanden of het aantal
    /// verschillende opzoekingen van één import.
    pub images_refused: u64,
    /// Afbeeldingen die te groot zijn: beeldpunten, zijde of bestandsgrootte,
    /// of ze passen niet meer in wat de import aan lezen, uitpakken of
    /// vasthouden over heeft.
    pub images_too_large: u64,
    /// Afbeeldingen die gevonden zijn maar niet te lezen: geen ondersteunde
    /// soort, of beschadigd.
    pub images_unsupported: u64,
    /// Externe verwijzingen en afbeeldingen die geweigerd zijn om hun naam:
    /// het systeem leest hem als apparaat (`NUL`, `COM1.dwg`) of knipt er een
    /// punt of spatie af.
    pub odd_names: u64,
    pub viewports_drawn: u64,
    pub viewports_3d_skipped: u64,
    /// Getekende viewports die (nagenoeg) het hele blad beslaan.
    pub viewports_cover_page: u64,
    /// Viewports die alleen door het vangnet als blad zijn aangemerkt (de
    /// eerste, zonder nummer, over het hele blad) en daarom niet getekend zijn.
    pub sheets_by_coverage: u64,
    pub unsupported: u64,
    pub replaced_characters: u64,
    /// Tekststijlen met tekst waarvan de letter door een standaardletter van
    /// de PDF vervangen is; ook een SHX-letter die schreefloos wordt telt.
    /// Afgeleid van [`Walker::replaced_styles`]: elke stijl telt één keer.
    pub fonts_replaced: u64,
    pub deep_nesting: u64,
    /// Blokken die als formulier-XObject in de PDF staan. Of een opgenomen
    /// blok ook een formulier wordt, blijkt pas als de pagina af is: de import
    /// vult dit in, niet de wandelaar.
    pub forms_written: u64,
    /// Plaatsingen van die formulieren in de PDF. De eerste plaatsing van een
    /// blok staat altijd gewoon in de pagina; een formulier dat een ander
    /// formulier plaatst, telt die plaatsing één keer.
    pub forms_reused: u64,
    /// Namen van typen die zijn overgeslagen, met aantal.
    pub skipped_types: std::collections::BTreeMap<String, u64>,
}

impl WalkStats {
    /// Telt de uitkomst van een deelwandeling (een externe verwijzing) erbij.
    /// De tellingen van het laden (`xrefs_loaded` en verwanten) horen bij de
    /// import als geheel en doen hier niet mee.
    pub fn absorb(&mut self, other: &WalkStats) {
        self.visits += other.visits;
        self.entities += other.entities;
        self.drawn += other.drawn;
        self.texts += other.texts;
        self.hatches += other.hatches;
        self.hatch_patterns_skipped += other.hatch_patterns_skipped;
        self.light_fills_dropped += other.light_fills_dropped;
        self.blocks_expanded += other.blocks_expanded;
        self.missing_blocks += other.missing_blocks;
        self.xrefs_skipped += other.xrefs_skipped;
        self.images_skipped += other.images_skipped;
        self.images_embedded += other.images_embedded;
        self.images_missing += other.images_missing;
        self.images_refused += other.images_refused;
        self.images_too_large += other.images_too_large;
        self.images_unsupported += other.images_unsupported;
        self.odd_names += other.odd_names;
        self.viewports_drawn += other.viewports_drawn;
        self.viewports_3d_skipped += other.viewports_3d_skipped;
        self.viewports_cover_page += other.viewports_cover_page;
        self.sheets_by_coverage += other.sheets_by_coverage;
        self.unsupported += other.unsupported;
        self.replaced_characters += other.replaced_characters;
        // `fonts_replaced` telt stijlen, geen keren: de wandelaar leidt het af
        // van zijn verzameling stijlnamen en telt het hier dus niet op.
        self.deep_nesting += other.deep_nesting;
        for (name, count) in &other.skipped_types {
            *self.skipped_types.entry(name.clone()).or_default() += count;
        }
    }

    /// Wat er sinds `before` bij is gekomen: de tellingen van één
    /// blokplaatsing.
    fn since(&self, before: &WalkStats) -> WalkStats {
        let mut skipped_types = std::collections::BTreeMap::new();
        for (name, count) in &self.skipped_types {
            let more = count.saturating_sub(before.skipped_types.get(name).copied().unwrap_or(0));
            if more > 0 {
                skipped_types.insert(name.clone(), more);
            }
        }
        WalkStats {
            visits: self.visits.saturating_sub(before.visits),
            entities: self.entities.saturating_sub(before.entities),
            drawn: self.drawn.saturating_sub(before.drawn),
            texts: self.texts.saturating_sub(before.texts),
            hatches: self.hatches.saturating_sub(before.hatches),
            hatch_patterns_skipped: self.hatch_patterns_skipped.saturating_sub(before.hatch_patterns_skipped),
            light_fills_dropped: self.light_fills_dropped.saturating_sub(before.light_fills_dropped),
            blocks_expanded: self.blocks_expanded.saturating_sub(before.blocks_expanded),
            missing_blocks: self.missing_blocks.saturating_sub(before.missing_blocks),
            xrefs_skipped: self.xrefs_skipped.saturating_sub(before.xrefs_skipped),
            xrefs_loaded: 0,
            xrefs_missing: 0,
            xrefs_refused: 0,
            images_skipped: self.images_skipped.saturating_sub(before.images_skipped),
            images_embedded: self.images_embedded.saturating_sub(before.images_embedded),
            images_missing: self.images_missing.saturating_sub(before.images_missing),
            images_refused: self.images_refused.saturating_sub(before.images_refused),
            images_too_large: self.images_too_large.saturating_sub(before.images_too_large),
            images_unsupported: self.images_unsupported.saturating_sub(before.images_unsupported),
            odd_names: self.odd_names.saturating_sub(before.odd_names),
            viewports_drawn: self.viewports_drawn.saturating_sub(before.viewports_drawn),
            viewports_3d_skipped: self.viewports_3d_skipped.saturating_sub(before.viewports_3d_skipped),
            viewports_cover_page: self.viewports_cover_page.saturating_sub(before.viewports_cover_page),
            sheets_by_coverage: self.sheets_by_coverage.saturating_sub(before.sheets_by_coverage),
            unsupported: self.unsupported.saturating_sub(before.unsupported),
            replaced_characters: self.replaced_characters.saturating_sub(before.replaced_characters),
            fonts_replaced: 0,
            deep_nesting: self.deep_nesting.saturating_sub(before.deep_nesting),
            forms_written: 0,
            forms_reused: 0,
            skipped_types,
        }
    }

    /// Dezelfde plaatsing, maar helemaal buiten beeld: wat de wandelaar pas
    /// telt nadat de afnemer iets wilde hebben, valt weg.
    fn culled(&self) -> WalkStats {
        WalkStats { drawn: 0, texts: 0, images_embedded: 0, hatch_patterns_skipped: 0, light_fills_dropped: 0, ..self.clone() }
    }
}

/// De tellingen van een blokplaatsing, om mee te tellen zonder het blok
/// opnieuw te doorlopen.
struct FormStats {
    /// De plaatsing helemaal buiten beeld.
    culled: WalkStats,
    /// De plaatsing helemaal in beeld; bekend zodra het formulier is opgenomen.
    full: Option<WalkStats>,
}

/// Een viewport zoals hij op de pagina terechtkwam; de import schrijft er de
/// meetschaal (`/VP` + `/Measure`) van.
#[derive(Clone, Debug, PartialEq)]
pub struct MeasureViewport {
    /// Omhullende van het venster op de pagina (punten).
    pub bbox: [f64; 4],
    /// De eigen knipvorm op de pagina, als het venster niet rechthoekig is;
    /// leeg bij een rechthoek. Binnen de omhullende maar buiten deze vorm
    /// hoort een punt niet bij dit venster.
    pub outline: Vec<Point>,
    /// Model → pagina (punten).
    pub matrix: Matrix,
    /// Tekeningeenheden per paginapunt.
    pub units_per_point: f64,
    pub name: String,
}

#[derive(Clone, Copy)]
pub struct LayerInfo<'a> {
    pub name: &'a str,
    pub color: Color,
    pub transparency: acadrust::types::Transparency,
    pub lineweight: LineWeight,
    pub linetype: &'a str,
    pub frozen: bool,
    pub off: bool,
    pub plottable: bool,
}

#[derive(Clone, Copy)]
struct Col {
    rgb: Rgb,
    aci7: bool,
}

struct BlockInfo<'a> {
    base: [f64; 3],
    entities: Vec<&'a EntityType>,
    is_xref: bool,
}

#[derive(Clone)]
struct Ctx<'a> {
    xf: Xform3,
    /// Laag waarnaar laag "0" in een blok wijst.
    inherit: Option<LayerInfo<'a>>,
    byblock_color: Col,
    byblock_weight: f64,
    byblock_alpha: f64,
    byblock_linetype: Option<&'a str>,
    depth: u32,
    /// Deze wandeling loopt rechtstreeks door een papierruimte (layout): de
    /// enige plek waar een VIEWPORT iets betekent. In de modelruimte en in
    /// het model dat een venster toont, staat hij uit.
    in_paper_space: bool,
    /// Extra factor op de lijntypelengte (papierruimte-lijntypen).
    lt_factor: f64,
    /// In deze viewport bevroren lagen (in hoofdletters).
    vp_frozen: Option<Rc<HashSet<String>>>,
    /// Nummer van die verzameling bevroren lagen (0 = geen viewport): twee
    /// viewports met dezelfde bevroren lagen delen een nummer, en daarmee hun
    /// formulieren.
    frozen_id: u32,
}

pub struct Walker<'a> {
    doc: &'a CadDocument,
    pub settings: WalkSettings,
    /// DXF slaat hoeken van ellipsranden in arceringen in graden op, DWG in
    /// radialen.
    source_is_dxf: bool,
    layers: HashMap<String, LayerInfo<'a>>,
    layer_by_handle: HashMap<u64, &'a str>,
    linetypes: HashMap<String, Option<Rc<Vec<f64>>>>,
    /// Gekozen letter per tekststijl (in hoofdletters).
    fonts: HashMap<String, FontChoice>,
    /// Tekststijlen (in hoofdletters) die werkelijk tekst tekenden en waarvan
    /// de letter vervangen is; die van een externe verwijzing als
    /// `VERWIJZING|STIJL`. De import verenigt ze over alle pagina's.
    pub replaced_styles: HashSet<String>,
    blocks: HashMap<String, Option<Rc<BlockInfo<'a>>>>,
    sort_tables: HashMap<u64, &'a acadrust::objects::SortEntitiesTable>,
    ltscale: f64,
    psltscale: bool,
    pub stats: WalkStats,
    pub measure_viewports: Vec<MeasureViewport>,
    /// Tekeningeenheden per paginapunt in de huidige ruimte (voor bogen).
    pub cancelled: bool,
    /// De wandeling stopte omdat een grens bereikt werd (bezoeken of uitvoer).
    pub too_complex: bool,
    /// De layout die nu getekend wordt: welke viewport de eerste is en wat
    /// het hele blad is. Eén keer per papierruimte bepaald, op dezelfde manier
    /// als in de verkenning.
    sheet: super::viewport::LayoutSheet,
    /// Gedeeld met de wandelaars van externe verwijzingen.
    cancel: Option<Rc<dyn Fn() -> bool + 'a>>,
    progress: Option<Box<dyn FnMut(u64) + 'a>>,
    path: PagePath,
    budget: VisitBudget,
    /// De geladen externe verwijzingen van dit document; `None` = niet laden.
    xrefs: Option<&'a XrefDocs>,
    /// Hoe diep deze wandelaar zelf in de verwijzingen zit (0 = hoofdtekening).
    xref_depth: u32,
    /// Eén wandelaar per externe verwijzing (op bloknaam, in hoofdletters):
    /// zijn blokken, lijntypen en letters worden zo één keer opgezocht, hoe
    /// vaak de verwijzing ook is ingevoegd.
    xref_walkers: HashMap<String, Walker<'a>>,
    /// De afbeeldingen van de import; `None` = niet insluiten, alleen tellen.
    images: Option<ImageStore>,
    /// Map van het bestand van dit document, als het een externe verwijzing
    /// is: daar wordt eerst naar haar afbeeldingen gezocht.
    dir: Option<&'a Path>,
    /// Keren dat [`Walker::tick`] liep: daarop gaat het vragen van de
    /// afbreekvlag. De bezoeken zelf springen vooruit als een formulier
    /// geplaatst wordt, en zouden een veelvoud kunnen overslaan.
    ticks: u64,
    /// Bij dit aantal bezoeken wordt weer naar afbreken en voortgang gekeken.
    next_poll: u64,
    /// Voorvoegsel van de formuliersleutels van deze wandelaar. De wandelaar
    /// van een externe verwijzing deelt de afnemer met de hoofdwandeling, maar
    /// een blok met dezelfde naam is daar een ander blok.
    form_scope: String,
    /// Tellingen per formuliersleutel.
    form_stats: HashMap<String, FormStats>,
    /// Nummer per verzameling bevroren lagen (gesorteerd, in hoofdletters).
    frozen_ids: HashMap<String, u32>,
}

/// Om de zoveel bezoeken kijkt de wandelaar of er is afgebroken.
const POLL_EVERY: u64 = 2048;

/// Zoveel hoekpunten, splinemonsters, patroonlijnen of tekstregels binnen één
/// entiteit kosten samen één bezoek. Een gewone entiteit (een lijn, een
/// polylijn van een handvol punten) kost zo niets extra; een polylijn van
/// honderdduizenden hoekpunten in een blok dat duizenden keren staat, laat de
/// werkgrens wél aanslaan in plaats van uren te rekenen.
const WORK_PER_VISIT: u64 = 16;

/// Binnen een lange lus in één entiteit wordt om de zoveel stappen naar
/// afbreken en naar een volle afnemer gekeken.
const POLL_INSIDE: usize = 4096;

impl<'a> Walker<'a> {
    pub fn new(doc: &'a CadDocument, settings: WalkSettings, source_is_dxf: bool) -> Self {
        let mut layers = HashMap::new();
        let mut layer_by_handle = HashMap::new();
        for layer in doc.layers.iter() {
            let info = LayerInfo {
                name: layer.name.as_str(),
                color: layer.color,
                transparency: layer.transparency,
                lineweight: layer.line_weight,
                linetype: layer.line_type.as_str(),
                frozen: layer.flags.frozen,
                off: layer.flags.off,
                plottable: layer.is_plottable,
            };
            layers.insert(layer.name.to_uppercase(), info);
            layer_by_handle.insert(layer.handle.value(), layer.name.as_str());
        }
        let mut sort_tables = HashMap::new();
        for object in doc.objects.values() {
            if let ObjectType::SortEntitiesTable(table) = object {
                sort_tables.insert(table.block_owner_handle.value(), table);
            }
        }
        let ltscale = if doc.header.linetype_scale > 0.0 { doc.header.linetype_scale } else { 1.0 };
        let budget = VisitBudget::new(settings.max_visits);
        Walker {
            doc,
            settings,
            source_is_dxf,
            layers,
            layer_by_handle,
            linetypes: HashMap::new(),
            fonts: HashMap::new(),
            replaced_styles: HashSet::new(),
            blocks: HashMap::new(),
            sort_tables,
            ltscale,
            psltscale: doc.header.paper_space_linetype_scaling,
            stats: WalkStats::default(),
            measure_viewports: Vec::new(),
            cancelled: false,
            too_complex: false,
            sheet: super::viewport::LayoutSheet::default(),
            cancel: None,
            progress: None,
            path: PagePath::new(),
            budget,
            xrefs: None,
            xref_depth: 0,
            xref_walkers: HashMap::new(),
            images: None,
            dir: None,
            ticks: 0,
            next_poll: POLL_EVERY,
            form_scope: String::new(),
            form_stats: HashMap::new(),
            frozen_ids: HashMap::new(),
        }
    }

    /// Geeft de wandelaar de afbeeldingen van de import mee. Zonder deze
    /// aanroep telt hij een afbeelding alleen (`images_skipped`).
    pub fn with_images(&mut self, images: &ImageStore) {
        self.images = Some(images.clone());
    }

    /// Geeft de wandelaar de geladen externe verwijzingen mee. Zonder deze
    /// aanroep telt hij een verwijzing alleen (`xrefs_skipped`).
    pub fn with_xrefs(&mut self, xrefs: &'a XrefDocs) {
        self.xrefs = Some(xrefs);
    }

    /// Laat deze wandelaar uit een gedeeld budget putten in plaats van uit
    /// zijn eigen `max_visits`.
    pub fn share_budget(&mut self, budget: &VisitBudget) {
        self.budget = budget.clone();
    }

    pub fn on_cancel(&mut self, f: impl Fn() -> bool + 'a) {
        self.cancel = Some(Rc::new(f));
    }

    pub fn on_progress(&mut self, f: impl FnMut(u64) + 'a) {
        self.progress = Some(Box::new(f));
    }

    fn tick(&mut self) -> bool {
        self.stats.visits += 1;
        self.ticks += 1;
        if !self.budget.spend() {
            self.too_complex = true;
            self.cancelled = true;
        }
        self.poll_if_due();
        !self.cancelled
    }

    /// Rekent het werk binnen één entiteit af op het budget: één bezoek per
    /// [`WORK_PER_VISIT`] hoekpunten, monsters, patroonlijnen of regels. Het
    /// telt in `visits`, dus een geplaatst formulier rekent het via
    /// [`Walker::replay`] net zo af als het uitvouwen. `false` als het budget
    /// op is of er is afgebroken.
    fn charge(&mut self, work: usize) -> bool {
        let extra = work as u64 / WORK_PER_VISIT;
        if extra == 0 {
            return !self.cancelled;
        }
        self.stats.visits += extra;
        self.ticks = self.ticks.saturating_add(extra);
        if !self.budget.spend_many(extra) {
            self.too_complex = true;
            self.cancelled = true;
        }
        self.poll_if_due();
        !self.cancelled
    }

    /// Binnen een lange lus in één entiteit: om de [`POLL_INSIDE`] stappen
    /// kijken of de gebruiker heeft afgebroken of de afnemer vol is. `false`
    /// als de lus moet stoppen.
    fn keep_going(&mut self, step: usize, sink: &dyn Sink) -> bool {
        if step % POLL_INSIDE == 0 && step > 0 {
            if sink.exhausted() {
                self.too_complex = true;
                self.cancelled = true;
            } else if self.cancel.as_ref().is_some_and(|cancel| cancel()) {
                self.cancelled = true;
            }
        }
        !self.cancelled
    }

    /// Vraagt om de [`POLL_EVERY`] bezoeken of de gebruiker heeft afgebroken en
    /// meldt de voortgang. Ook de bezoeken die een geplaatst formulier in één
    /// keer bijschrijft tellen mee: een lange reeks plaatsingen blijft zo
    /// reageren en de balk blijft lopen.
    fn poll_if_due(&mut self) {
        if self.ticks < self.next_poll {
            return;
        }
        self.next_poll = self.ticks.saturating_add(POLL_EVERY);
        if let Some(cancel) = &self.cancel {
            if cancel() {
                self.cancelled = true;
            }
        }
        let done = self.stats.visits;
        if let Some(progress) = &mut self.progress {
            progress(done);
        }
    }

    // ── Lagen ────────────────────────────────────────────────────────────
    fn layer_info(&self, name: &'a str, ctx: &Ctx<'a>) -> LayerInfo<'a> {
        if is_layer_zero(name) {
            if let Some(inherited) = ctx.inherit {
                return inherited;
            }
        }
        if let Some(info) = self.layers.get(&name.to_uppercase()) {
            return *info;
        }
        LayerInfo {
            name,
            color: Color::Index(7),
            transparency: acadrust::types::Transparency::OPAQUE,
            lineweight: LineWeight::Default,
            linetype: "Continuous",
            frozen: false,
            off: false,
            plottable: true,
        }
    }

    fn excluded(&self, layer: &LayerInfo<'a>) -> bool {
        !self.settings.excluded_layers.is_empty() && self.settings.excluded_layers.contains(&layer.name.to_uppercase())
    }

    /// Zichtbaar (uit-gedrag) en bevroren (blok-gedrag).
    fn layer_state(&self, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> (bool, bool) {
        let excluded = self.excluded(layer);
        let vp_frozen = ctx
            .vp_frozen
            .as_ref()
            .map(|set| set.contains(&layer.name.to_uppercase()))
            .unwrap_or(false);
        let frozen = vp_frozen || (excluded && layer.frozen);
        (!excluded && !frozen, frozen)
    }

    // ── Stijl ────────────────────────────────────────────────────────────
    fn base_color(c: Color) -> Col {
        match c {
            Color::Index(7) | Color::Index(0) | Color::ByLayer | Color::ByBlock | Color::None => {
                Col { rgb: (255, 255, 255), aci7: true }
            }
            Color::Index(i) => Col { rgb: Color::Index(i).rgb().unwrap_or((255, 255, 255)), aci7: false },
            Color::Rgb { r, g, b } => Col { rgb: (r, g, b), aci7: false },
        }
    }

    fn color_of(&self, color: Color, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> Col {
        match color {
            Color::ByLayer => Self::base_color(layer.color),
            Color::ByBlock => ctx.byblock_color,
            other => Self::base_color(other),
        }
    }

    fn rgb(&self, color: Color, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> Rgb {
        let c = self.color_of(color, layer, ctx);
        paper_color(c.rgb, c.aci7, self.settings.color_mode)
    }

    /// Dekking van een entiteit op papier: 1 = ondoorzichtig. "Zuiver
    /// zwart-wit" kent geen doorzichtigheid; daar is alles dekkend.
    fn alpha_of(&self, transparency: acadrust::types::Transparency, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> f64 {
        if !self.settings.color_mode.keeps_transparency() {
            return 1.0;
        }
        self.file_alpha(transparency, layer, ctx)
    }

    /// Dekking zoals het bestand haar geeft, los van de kleurstand. Blokken
    /// erven deze waarde, en de afweging of een lichte vulling wegvalt kijkt
    /// ernaar.
    fn file_alpha(&self, transparency: acadrust::types::Transparency, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> f64 {
        use acadrust::types::Transparency;
        let value = match transparency {
            Transparency::Explicit(alpha) => alpha,
            Transparency::ByBlock => return ctx.byblock_alpha,
            Transparency::ByLayer => match layer.transparency {
                Transparency::Explicit(alpha) => alpha,
                _ => 0,
            },
        };
        1.0 - value as f64 / 255.0
    }

    fn weight_mm(&self, weight: LineWeight, color: Color, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> f64 {
        if let LineweightMode::Fixed(mm) = self.settings.lineweight {
            return mm.max(0.0);
        }
        // De kleurentabel kijkt naar de kleur uit het bestand, niet naar de
        // kleur op papier: "alles zwart" mag de pendikte niet veranderen.
        if matches!(self.settings.lineweight, LineweightMode::Pens) {
            let from_file = self.color_of(color, layer, ctx).rgb;
            if let Some(mm) = self.settings.pens.width_mm(from_file) {
                return (mm * self.settings.lineweight_factor).max(self.settings.lineweight_min_mm);
            }
        }
        let raw = match weight {
            LineWeight::Value(v) if v >= 0 => v as f64 / 100.0,
            LineWeight::ByBlock => ctx.byblock_weight,
            LineWeight::ByLayer | LineWeight::Value(_) => match layer.lineweight {
                LineWeight::Value(v) if v >= 0 => v as f64 / 100.0,
                _ => DEFAULT_LINEWEIGHT_MM,
            },
            LineWeight::Default => DEFAULT_LINEWEIGHT_MM,
        };
        (raw * self.settings.lineweight_factor).max(self.settings.lineweight_min_mm)
    }

    fn linetype_pattern(&mut self, name: &str) -> Option<Rc<Vec<f64>>> {
        let key = name.to_uppercase();
        if let Some(found) = self.linetypes.get(&key) {
            return found.clone();
        }
        let pattern = self.doc.line_types.get(name).and_then(|lt| {
            let elements: Vec<f64> = lt.elements.iter().map(|e| e.length).collect();
            (elements.len() >= 2 && elements.iter().any(|e| *e < 0.0)).then(|| Rc::new(elements))
        });
        self.linetypes.insert(key, pattern.clone());
        pattern
    }

    fn stroke_of(&mut self, common: &EntityCommon, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, scale: f64) -> Stroke {
        let color = self.rgb(common.color, layer, ctx);
        let width = self.weight_mm(common.line_weight, common.color, layer, ctx) * PT_PER_MM;
        let mut style = Stroke::new(color, width);
        style.alpha = self.alpha_of(common.transparency, layer, ctx);
        if self.settings.linetypes {
            let name = if common.linetype.is_empty() || common.linetype.eq_ignore_ascii_case("bylayer") {
                layer.linetype
            } else if common.linetype.eq_ignore_ascii_case("byblock") {
                ctx.byblock_linetype.unwrap_or(layer.linetype)
            } else {
                common.linetype.as_str()
            };
            if !name.eq_ignore_ascii_case("continuous") && !name.is_empty() {
                if let Some(pattern) = self.linetype_pattern(name) {
                    let entity_scale = if common.linetype_scale > 0.0 { common.linetype_scale } else { 1.0 };
                    style.dash = pdf_dash(&pattern, scale * self.ltscale * entity_scale * ctx.lt_factor);
                }
            }
        }
        style
    }

    // ── Blokken ──────────────────────────────────────────────────────────
    fn block(&mut self, name: &str) -> Option<Rc<BlockInfo<'a>>> {
        let key = name.to_uppercase();
        if let Some(found) = self.blocks.get(&key) {
            return found.clone();
        }
        let info = self.doc.block_records.get(name).map(|record| {
            let mut entities: Vec<&'a EntityType> = record
                .entity_handles
                .iter()
                .filter_map(|h| self.doc.get_entity(*h))
                .filter(|e| !matches!(e, EntityType::Block(_) | EntityType::BlockEnd(_)))
                .collect();
            self.apply_draw_order(record.handle, &mut entities);
            let mut base = [record.base_point.x, record.base_point.y, record.base_point.z];
            if base == [0.0, 0.0, 0.0] {
                if let Some(EntityType::Block(block)) = self.doc.get_entity(record.block_entity_handle) {
                    base = [block.base_point.x, block.base_point.y, block.base_point.z];
                }
            }
            Rc::new(BlockInfo {
                base,
                entities,
                is_xref: record.flags.is_xref || record.flags.is_xref_overlay || !record.xref_path.is_empty(),
            })
        });
        self.blocks.insert(key, info.clone());
        info
    }

    /// Tekenvolgorde volgens een SORTENTSTABLE, als die er is.
    fn apply_draw_order(&self, owner: Handle, entities: &mut [&'a EntityType]) {
        let Some(table) = self.sort_tables.get(&owner.value()) else { return };
        entities.sort_by_key(|e| {
            let handle = e.common().handle;
            table.get_sort_handle(handle).unwrap_or(handle).value()
        });
    }

    // ── Ruimtes ──────────────────────────────────────────────────────────
    fn root_ctx(&self, xf: Xform3) -> Ctx<'a> {
        Ctx {
            xf,
            inherit: None,
            byblock_color: Col { rgb: (255, 255, 255), aci7: true },
            byblock_weight: DEFAULT_LINEWEIGHT_MM,
            byblock_alpha: 1.0,
            byblock_linetype: None,
            depth: 0,
            in_paper_space: false,
            lt_factor: 1.0,
            vp_frozen: None,
            frozen_id: 0,
        }
    }

    /// Tekent de modelruimte met de gegeven afbeelding tekening → pagina.
    pub fn model_space(&mut self, xf: Xform3, sink: &mut dyn Sink) {
        let ctx = self.root_ctx(xf);
        self.space("*Model_Space", &ctx, sink);
    }

    /// Tekent de inhoud van een blokrecord (modelruimte of een layout).
    fn space(&mut self, record_name: &str, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        self.space_filtered(record_name, ctx, false, sink);
    }

    /// Als [`Walker::space`]; met `skip_layer_0` blijft inhoud op laag 0 weg
    /// (de laag van de invoeging staat uit), behalve geneste invoegingen.
    fn space_filtered(&mut self, record_name: &str, ctx: &Ctx<'a>, skip_layer_0: bool, sink: &mut dyn Sink) {
        let Some(block) = self.block(record_name) else { return };
        for entity in &block.entities {
            if self.cancelled {
                return;
            }
            if skip_layer_0 && is_layer_zero(&entity.common().layer) && !matches!(entity, EntityType::Insert(_)) {
                continue;
            }
            self.entity(entity, ctx, sink);
        }
    }

    /// Tekent een layout: papierruimte met zijn viewports.
    pub fn paper_space(&mut self, record_name: &str, xf: Xform3, sink: &mut dyn Sink) {
        let mut ctx = self.root_ctx(xf);
        ctx.in_paper_space = true;
        self.sheet = super::viewport::LayoutSheet::of(self.doc, record_name, self.source_is_dxf);
        self.space(record_name, &ctx, sink);
    }

    // ── Entiteiten ───────────────────────────────────────────────────────
    fn entity(&mut self, entity: &'a EntityType, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if !self.tick() {
            return;
        }
        if sink.exhausted() {
            self.too_complex = true;
            self.cancelled = true;
            return;
        }
        let common = entity.common();
        if common.invisible {
            return;
        }
        let layer = self.layer_info(common.layer.as_str(), ctx);
        let (visible, frozen) = self.layer_state(&layer, ctx);
        // `entities` telt wat er ná de laagkeuze overblijft (de bezoeken tellen
        // alles): een tekening waarvan bijna alles is weggelaten, is geen zware
        // tekening, en het voorbeeld hoeft haar dan niet te vereenvoudigen.
        if let EntityType::Insert(insert) = entity {
            if !frozen {
                self.stats.entities += 1;
                self.insert(insert, &layer, visible, ctx, sink);
            }
            return;
        }
        // De laag van een VIEWPORT is de laag van zijn kader, zoals in CAD. Of
        // die laag nu uit staat, bevroren is, niet geplot wordt of door de
        // gebruiker is uitgevinkt: dat verbergt alleen de rand (die hier nooit
        // getekend wordt), niet wat het venster toont. De inhoud volgt de lagen
        // van de modelentiteiten en de lagen die in het venster zelf bevroren
        // zijn. Een venster bewust weglaten kan dus niet via zijn laag; wel via
        // de zichtbaarheid van het venster zelf, als het bestand die draagt
        // (een venster dat uit staat, zie `viewport::classify`). Zo is wat de
        // verkenning meldt bij elke laagkeuze ook wat er getekend wordt.
        if let EntityType::Viewport(viewport) = entity {
            if self.settings.viewports {
                self.stats.entities += 1;
                self.viewport(viewport, ctx, sink);
            }
            return;
        }
        if !visible {
            return;
        }
        self.stats.entities += 1;
        match entity {
            EntityType::Line(line) => {
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                path.move_to(ctx.xf.point([line.start.x, line.start.y, line.start.z]));
                path.line_to(ctx.xf.point([line.end.x, line.end.y, line.end.z]));
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Circle(circle) => {
                let m = self.plane_of(ctx, circle.normal, circle.center.z);
                let stroke = self.stroke_of(common, &layer, ctx, m.mean_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                let (c, u, v) = arc_frame(&m, (circle.center.x, circle.center.y), circle.radius, circle.radius);
                add_elliptic_arc(&mut path, c, u, v, 0.0, std::f64::consts::TAU, true);
                path.close();
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Arc(arc) => {
                let m = self.plane_of(ctx, arc.normal, arc.center.z);
                let stroke = self.stroke_of(common, &layer, ctx, m.mean_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                let (c, u, v) = arc_frame(&m, (arc.center.x, arc.center.y), arc.radius, arc.radius);
                let (t0, t1) = ccw_sweep(sane_angle(arc.start_angle), sane_angle(arc.end_angle));
                add_elliptic_arc(&mut path, c, u, v, t0, t1, true);
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Ellipse(ellipse) => {
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                let normal = [ellipse.normal.x, ellipse.normal.y, ellipse.normal.z];
                let major = [ellipse.major_axis.x, ellipse.major_axis.y, ellipse.major_axis.z];
                let minor = super::curves::cross(normal, major);
                let ratio = ellipse.minor_axis_ratio.abs().max(1e-12);
                let c = ctx.xf.point([ellipse.center.x, ellipse.center.y, ellipse.center.z]);
                let u = ctx.xf.vector(major);
                let v = ctx.xf.vector([minor[0] * ratio, minor[1] * ratio, minor[2] * ratio]);
                let (t0, t1) = if (ellipse.end_parameter - ellipse.start_parameter).abs() >= std::f64::consts::TAU - 1e-9 {
                    (0.0, std::f64::consts::TAU)
                } else {
                    ccw_sweep(sane_angle(ellipse.start_parameter), sane_angle(ellipse.end_parameter))
                };
                add_elliptic_arc(&mut path, c, u, v, t0, t1, true);
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::LwPolyline(poly) => {
                let m = self.plane_of(ctx, poly.normal, poly.elevation);
                let stroke = self.stroke_of(common, &layer, ctx, m.mean_scale());
                let vertices: Vec<([f64; 2], f64, f64, f64)> = poly
                    .vertices
                    .iter()
                    .map(|v| {
                        let (sw, ew) = if poly.constant_width > 0.0 {
                            (poly.constant_width, poly.constant_width)
                        } else {
                            (v.start_width, v.end_width)
                        };
                        ([v.location.x, v.location.y], v.bulge, sw, ew)
                    })
                    .collect();
                self.polyline(&vertices, poly.is_closed, &m, &stroke, layer.name, sink);
            }
            EntityType::Polyline2D(poly) => {
                let m = self.plane_of(ctx, poly.normal, poly.elevation);
                let stroke = self.stroke_of(common, &layer, ctx, m.mean_scale());
                let spline_fit = poly.flags.is_spline_fit();
                let vertices: Vec<([f64; 2], f64, f64, f64)> = poly
                    .vertices
                    .iter()
                    .filter(|v| !(spline_fit && v.flags.bits() & 16 != 0))
                    .map(|v| {
                        let (sw, ew) = if poly.start_width > 0.0 && v.start_width <= 0.0 {
                            (poly.start_width, poly.end_width.max(poly.start_width))
                        } else {
                            (v.start_width, v.end_width)
                        };
                        ([v.location.x, v.location.y], v.bulge, sw, ew)
                    })
                    .collect();
                self.polyline(&vertices, poly.flags.is_closed(), &m, &stroke, layer.name, sink);
            }
            EntityType::Polyline3D(poly) => {
                if !self.charge(poly.vertices.len()) {
                    return;
                }
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                for (i, v) in poly.vertices.iter().enumerate() {
                    if !self.keep_going(i, sink) {
                        self.path = path;
                        return;
                    }
                    let p = ctx.xf.point([v.position.x, v.position.y, v.position.z]);
                    if i == 0 {
                        path.move_to(p);
                    } else {
                        path.line_to(p);
                    }
                }
                if poly.flags.closed && poly.vertices.len() > 2 {
                    path.close();
                }
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Polyline(poly) => {
                if !self.charge(poly.vertices.len()) {
                    return;
                }
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                for (i, v) in poly.vertices.iter().enumerate() {
                    if !self.keep_going(i, sink) {
                        self.path = path;
                        return;
                    }
                    let p = ctx.xf.point([v.location.x, v.location.y, v.location.z]);
                    if i == 0 {
                        path.move_to(p);
                    } else {
                        path.line_to(p);
                    }
                }
                if poly.flags.is_closed() && poly.vertices.len() > 2 {
                    path.close();
                }
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Spline(spline) => {
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let control: Vec<[f64; 3]> = spline.control_points.iter().map(|p| [p.x, p.y, p.z]).collect();
                let scale = ctx.xf.xy_scale();
                let sampled = if control.len() >= 2 {
                    sample_bspline(spline.degree.max(1) as usize, &spline.knots, &control, &spline.weights, |local| {
                        // Meer stukken naarmate het stuk op papier langer is.
                        let len: f64 = local
                            .windows(2)
                            .map(|w| ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt())
                            .sum::<f64>()
                            * scale;
                        ((len / 3.0).ceil() as usize).clamp(4, 96)
                    })
                } else {
                    None
                };
                // Het bemonsteren zelf is begrensd (graad en stukken per
                // spanne); wat het opleverde, telt als werk.
                let work = sampled.as_ref().map(|points| points.len()).unwrap_or(spline.fit_points.len());
                if !self.charge(work) {
                    return;
                }
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                match sampled {
                    Some(points) => {
                        for (i, p) in points.iter().enumerate() {
                            if !self.keep_going(i, sink) {
                                self.path = path;
                                return;
                            }
                            let q = ctx.xf.point(*p);
                            if i == 0 {
                                path.move_to(q);
                            } else {
                                path.line_to(q);
                            }
                        }
                    }
                    None if spline.fit_points.len() >= 2 => {
                        let fit: Vec<[f64; 3]> = spline.fit_points.iter().map(|p| [p.x, p.y, p.z]).collect();
                        path.move_to(ctx.xf.point(fit[0]));
                        for (c1, c2, p) in catmull_rom(&fit, spline.flags.closed) {
                            path.cubic_to(ctx.xf.point(c1), ctx.xf.point(c2), ctx.xf.point(p));
                        }
                    }
                    None => {}
                }
                if spline.flags.closed && !path.is_empty() {
                    path.close();
                }
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Point(point) => {
                if self.settings.points {
                    let color = self.rgb(common.color, &layer, ctx);
                    let width = self.weight_mm(common.line_weight, common.color, &layer, ctx) * PT_PER_MM;
                    let p = ctx.xf.point([point.location.x, point.location.y, point.location.z]);
                    let mut path = std::mem::take(&mut self.path);
                    path.clear();
                    path.move_to(p);
                    path.line_to(p);
                    let stroke = Stroke { color, width: width.max(0.5), dash: None, cap: 1, join: 1, alpha: 1.0 };
                    self.emit_stroke(layer.name, &stroke, &path, sink);
                    self.path = path;
                }
            }
            EntityType::Solid(solid) => {
                let m = self.plane_of(ctx, solid.normal, solid.first_corner.z);
                let color = self.rgb(common.color, &layer, ctx);
                let alpha = self.alpha_of(common.transparency, &layer, ctx);
                let source = self.color_of(common.color, &layer, ctx);
                let source_alpha = self.file_alpha(common.transparency, &layer, ctx);
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                let corners = [solid.first_corner, solid.second_corner, solid.fourth_corner, solid.third_corner];
                for (i, c) in corners.iter().enumerate() {
                    let p = m.apply(Point::new(c.x, c.y));
                    if i == 0 {
                        path.move_to(p);
                    } else {
                        path.line_to(p);
                    }
                }
                path.close();
                self.emit_area_fill(layer.name, (source, source_alpha), color, alpha, &path, false, sink);
                self.path = path;
            }
            EntityType::Face3D(face) => {
                let stroke = self.stroke_of(common, &layer, ctx, ctx.xf.xy_scale());
                let corners = [face.first_corner, face.second_corner, face.third_corner, face.fourth_corner];
                let hidden = [
                    face.invisible_edges.is_first_invisible(),
                    face.invisible_edges.is_second_invisible(),
                    face.invisible_edges.is_third_invisible(),
                    face.invisible_edges.is_fourth_invisible(),
                ];
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                for i in 0..4 {
                    let a = corners[i];
                    let b = corners[(i + 1) % 4];
                    if hidden[i] || (a.x == b.x && a.y == b.y && a.z == b.z) {
                        continue;
                    }
                    path.move_to(ctx.xf.point([a.x, a.y, a.z]));
                    path.line_to(ctx.xf.point([b.x, b.y, b.z]));
                }
                self.emit_stroke(layer.name, &stroke, &path, sink);
                self.path = path;
            }
            EntityType::Hatch(hatch_entity) => self.hatch(hatch_entity, &layer, ctx, sink),
            EntityType::Text(t) => self.text_entity(t, &layer, ctx, sink),
            EntityType::MText(t) => self.mtext(t, &layer, ctx, sink),
            EntityType::AttributeEntity(attribute) => self.attribute(attribute, &layer, ctx, sink),
            EntityType::AttributeDefinition(def) => {
                // In een blok tekent CAD alleen een vaste attribuutdefinitie
                // (de andere zijn sjablonen voor de ATTRIB van elke INSERT);
                // los in een ruimte toont CAD de tag.
                if self.settings.text && !def.flags.invisible && (ctx.depth == 0 || def.flags.constant) {
                    let value = if def.flags.constant { def.default_value.clone() } else { def.tag.clone() };
                    let insert = (def.insertion_point.x, def.insertion_point.y);
                    let align = Some((def.alignment_point.x, def.alignment_point.y));
                    let font = self.style_font(&def.text_style);
                    self.draw_line_of_text(
                        &value,
                        insert,
                        align,
                        def.height,
                        def.rotation,
                        def.width_factor,
                        def.oblique_angle,
                        h_align(def.horizontal_alignment),
                        v_align(def.vertical_alignment),
                        def.text_generation_flags,
                        font,
                        def.normal,
                        def.insertion_point.z,
                        common.color,
                        common.transparency,
                        &layer,
                        ctx,
                        sink,
                    );
                }
            }
            EntityType::Dimension(dimension) => {
                if self.settings.dimensions {
                    let base = dimension.base();
                    let block = base.block_name.clone();
                    let normal = base.normal;
                    let insert = base.insertion_point;
                    if block.is_empty() {
                        self.stats.missing_blocks += 1;
                    } else {
                        let ocs = Xform3::ocs([normal.x, normal.y, normal.z]);
                        let world = ocs.apply([insert.x, insert.y, insert.z]);
                        let xf = ocs.then(&Xform3::translate(world[0], world[1], world[2])).then(&ctx.xf);
                        let mut child = ctx.clone();
                        child.xf = xf;
                        child.depth += 1;
                        child.inherit = Some(layer);
                        child.byblock_color = self.color_of(common.color, &layer, ctx);
                        child.byblock_weight = self.weight_mm(common.line_weight, common.color, &layer, ctx);
                        self.draw_block(&block, &child, sink);
                    }
                }
            }
            // Verwijslijnen horen bij de maatvoering: zonder maten ook geen
            // pijlen en bijschriften die ernaar wijzen.
            EntityType::Leader(leader) if self.settings.dimensions => self.leader(leader, &layer, ctx, sink),
            EntityType::MultiLeader(leader) if self.settings.dimensions => self.multileader(leader, &layer, ctx, sink),
            EntityType::Leader(_) | EntityType::MultiLeader(_) => {}
            EntityType::Table(table) => {
                let block = if !table.block_name.is_empty() {
                    Some(table.block_name.clone())
                } else {
                    table
                        .block_record_handle
                        .and_then(|h| self.doc.block_records.iter().find(|r| r.handle == h).map(|r| r.name.clone()))
                };
                match block {
                    Some(name) => {
                        let angle = table.horizontal_direction.y.atan2(table.horizontal_direction.x);
                        let xf = Xform3::rotate_z(if angle.is_finite() { angle } else { 0.0 })
                            .then(&Xform3::translate(table.insertion_point.x, table.insertion_point.y, table.insertion_point.z))
                            .then(&ctx.xf);
                        let mut child = ctx.clone();
                        child.xf = xf;
                        child.depth += 1;
                        child.inherit = Some(layer);
                        self.draw_block(&name, &child, sink);
                    }
                    None => self.skip(entity),
                }
            }
            EntityType::Wipeout(wipeout) => {
                // Wipeout dekt af met de papierkleur.
                let u = [wipeout.u_vector.x, wipeout.u_vector.y, wipeout.u_vector.z];
                let v = [wipeout.v_vector.x, wipeout.v_vector.y, wipeout.v_vector.z];
                let insert = [wipeout.insertion_point.x, wipeout.insertion_point.y, wipeout.insertion_point.z];
                let origin = [
                    insert[0] + 0.5 * u[0] - 0.5 * v[0],
                    insert[1] + 0.5 * u[1] - 0.5 * v[1],
                    insert[2] + 0.5 * u[2] - 0.5 * v[2],
                ];
                let height = wipeout.size.y;
                let mut vertices: Vec<[f64; 2]> = wipeout.clip_boundary_vertices.iter().map(|p| [p.x, p.y]).collect();
                if vertices.len() == 2 {
                    let (a, b) = (vertices[0], vertices[1]);
                    vertices = vec![a, [b[0], a[1]], b, [a[0], b[1]]];
                }
                if vertices.len() >= 3 {
                    let mut path = std::mem::take(&mut self.path);
                    path.clear();
                    for (i, p) in vertices.iter().enumerate() {
                        let world = [
                            origin[0] + u[0] * p[0] + v[0] * (height - p[1]),
                            origin[1] + u[1] * p[0] + v[1] * (height - p[1]),
                            origin[2] + u[2] * p[0] + v[2] * (height - p[1]),
                        ];
                        let q = ctx.xf.point(world);
                        if i == 0 {
                            path.move_to(q);
                        } else {
                            path.line_to(q);
                        }
                    }
                    path.close();
                    self.emit_fill(layer.name, (255, 255, 255), 1.0, &path, false, sink);
                    self.path = path;
                }
            }
            // Al afgehandeld vóór het lagenfilter.
            EntityType::Viewport(_) => {}
            EntityType::RasterImage(raster) => {
                if !self.raster_image(raster, &layer, ctx, sink) {
                    self.stats.images_skipped += 1;
                    self.skip(entity);
                }
            }
            EntityType::Underlay(_) => {
                self.stats.images_skipped += 1;
                self.skip(entity);
            }
            EntityType::Ray(ray) if self.settings.infinite_lines => self.infinite_line(
                [ray.base_point.x, ray.base_point.y, ray.base_point.z],
                [ray.direction.x, ray.direction.y, ray.direction.z],
                false,
                common,
                &layer,
                ctx,
                sink,
            ),
            EntityType::XLine(xline) if self.settings.infinite_lines => self.infinite_line(
                [xline.base_point.x, xline.base_point.y, xline.base_point.z],
                [xline.direction.x, xline.direction.y, xline.direction.z],
                true,
                common,
                &layer,
                ctx,
                sink,
            ),
            EntityType::Ray(_) | EntityType::XLine(_) => {}
            EntityType::Seqend(_) | EntityType::Block(_) | EntityType::BlockEnd(_) => {}
            other => self.skip(other),
        }
    }

    fn skip(&mut self, entity: &EntityType) {
        self.stats.unsupported += 1;
        *self.stats.skipped_types.entry(entity.as_entity().entity_type().to_string()).or_default() += 1;
    }

    fn emit_stroke(&mut self, layer: &str, stroke: &Stroke, path: &PagePath, sink: &mut dyn Sink) {
        if path.is_empty() || !path.is_writable() {
            return;
        }
        if let Some(bounds) = path.bounds() {
            if !sink.wants(bounds) {
                return;
            }
        }
        self.stats.drawn += 1;
        sink.stroke(layer, stroke, path);
    }

    /// Een effen vlakvulling (SOLID, effen of verlopende arcering). In
    /// "zuiver zwart-wit" valt ze weg als haar kleur uit het bestand lichter
    /// is dan de drempel (zie [`ColorMode::Mono`]); `source` is die kleur met
    /// de dekking uit het bestand. Geteld wordt alleen wat in beeld stond,
    /// net als een getekende vulling.
    #[allow(clippy::too_many_arguments)]
    fn emit_area_fill(
        &mut self,
        layer: &str,
        source: (Col, f64),
        color: Rgb,
        alpha: f64,
        path: &PagePath,
        even_odd: bool,
        sink: &mut dyn Sink,
    ) {
        if self.settings.color_mode.drops_fill(source.0.rgb, source.0.aci7, source.1) {
            if path.is_empty() || !path.is_writable() {
                return;
            }
            if path.bounds().map_or(true, |bounds| sink.wants(bounds)) {
                self.stats.light_fills_dropped += 1;
            }
            return;
        }
        self.emit_fill(layer, color, alpha, path, even_odd, sink);
    }

    fn emit_fill(&mut self, layer: &str, color: Rgb, alpha: f64, path: &PagePath, even_odd: bool, sink: &mut dyn Sink) {
        if path.is_empty() || !path.is_writable() {
            return;
        }
        if let Some(bounds) = path.bounds() {
            if !sink.wants(bounds) {
                return;
            }
        }
        self.stats.drawn += 1;
        sink.fill(layer, color, alpha, path, even_odd);
    }

    /// Afbeelding van het vlak van een 2D-entiteit naar de pagina.
    fn plane_of(&self, ctx: &Ctx<'a>, normal: Vector3, elevation: f64) -> Matrix {
        let ocs = Xform3::ocs([normal.x, normal.y, normal.z]);
        ocs.then(&ctx.xf).plane(elevation)
    }

    fn polyline(
        &mut self,
        vertices: &[([f64; 2], f64, f64, f64)],
        closed: bool,
        m: &Matrix,
        stroke: &Stroke,
        layer: &str,
        sink: &mut dyn Sink,
    ) {
        if vertices.len() < 2 {
            if let Some((p, _, _, _)) = vertices.first() {
                let mut path = std::mem::take(&mut self.path);
                path.clear();
                let q = m.apply(Point::new(p[0], p[1]));
                path.move_to(q);
                path.line_to(q);
                self.emit_stroke(layer, stroke, &path, sink);
                self.path = path;
            }
            return;
        }
        if !self.charge(vertices.len()) {
            return;
        }
        let widths: Vec<f64> = vertices.iter().flat_map(|v| [v.2, v.3]).collect();
        let max_width = widths.iter().cloned().fold(0.0, f64::max);
        let uniform = widths.iter().all(|w| (w - max_width).abs() < 1e-9);
        let scale = m.mean_scale();
        let mut path = std::mem::take(&mut self.path);
        path.clear();
        let n = vertices.len();
        let count = if closed { n } else { n - 1 };
        path.move_to(m.apply(Point::new(vertices[0].0[0], vertices[0].0[1])));
        for i in 0..count {
            if !self.keep_going(i, sink) {
                self.path = path;
                return;
            }
            let (a, bulge, _, _) = vertices[i];
            let b = vertices[(i + 1) % n].0;
            if bulge.abs() > 1e-12 {
                if let Some((c, r, s, e)) = bulge_arc((a[0], a[1]), (b[0], b[1]), bulge) {
                    let (center, u, v) = arc_frame(m, c, r, r);
                    add_elliptic_arc(&mut path, center, u, v, s, e, false);
                    continue;
                }
            }
            path.line_to(m.apply(Point::new(b[0], b[1])));
        }
        if closed {
            path.close();
        }
        if max_width > 0.0 && uniform {
            let wide = Stroke { width: max_width * scale, cap: 0, join: 0, ..stroke.clone() };
            self.emit_stroke(layer, &wide, &path, sink);
        } else if max_width > 0.0 {
            // Wisselende breedte: per recht stuk een gevulde trapezium.
            self.emit_stroke(layer, stroke, &path, sink);
            let mut band = PagePath::new();
            for i in 0..count {
                if !self.keep_going(i, sink) {
                    break;
                }
                let (a, bulge, sw, ew) = vertices[i];
                let b = vertices[(i + 1) % n].0;
                if bulge.abs() > 1e-12 || (sw <= 0.0 && ew <= 0.0) {
                    continue;
                }
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let len = dx.hypot(dy);
                if len < 1e-12 {
                    continue;
                }
                let (nx, ny) = (-dy / len, dx / len);
                let (h0, h1) = (sw / 2.0, ew / 2.0);
                band.clear();
                band.move_to(m.apply(Point::new(a[0] + nx * h0, a[1] + ny * h0)));
                band.line_to(m.apply(Point::new(b[0] + nx * h1, b[1] + ny * h1)));
                band.line_to(m.apply(Point::new(b[0] - nx * h1, b[1] - ny * h1)));
                band.line_to(m.apply(Point::new(a[0] - nx * h0, a[1] - ny * h0)));
                band.close();
                self.emit_fill(layer, stroke.color, stroke.alpha, &band, false, sink);
            }
        } else {
            self.emit_stroke(layer, stroke, &path, sink);
        }
        self.path = path;
    }

    fn infinite_line(
        &mut self,
        base: [f64; 3],
        direction: [f64; 3],
        both_ways: bool,
        common: &EntityCommon,
        layer: &LayerInfo<'a>,
        ctx: &Ctx<'a>,
        sink: &mut dyn Sink,
    ) {
        let p = ctx.xf.point(base);
        let d = ctx.xf.vector(direction);
        let len = d.x.hypot(d.y);
        if !(len > 1e-12) {
            return;
        }
        // Een oneindige lijn krijgt de lengte van het blad: de afnemer knipt.
        let far = 1e5;
        let a = if both_ways { Point::new(p.x - d.x / len * far, p.y - d.y / len * far) } else { p };
        let b = Point::new(p.x + d.x / len * far, p.y + d.y / len * far);
        let stroke = self.stroke_of(common, layer, ctx, ctx.xf.xy_scale());
        let mut path = std::mem::take(&mut self.path);
        path.clear();
        path.move_to(a);
        path.line_to(b);
        self.emit_stroke(layer.name, &stroke, &path, sink);
        self.path = path;
    }

    // ── Blokverwijzingen ─────────────────────────────────────────────────
    fn insert(&mut self, insert: &'a Insert, layer: &LayerInfo<'a>, visible: bool, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if ctx.depth >= MAX_DEPTH {
            self.stats.deep_nesting += 1;
            return;
        }
        let Some(block) = self.block(&insert.block_name) else {
            self.stats.missing_blocks += 1;
            return;
        };
        let xref: Option<&'a XrefDoc> = if block.is_xref {
            match self.xrefs {
                // Niet laden (de gebruiker wilde het niet, of deze wandeling
                // kreeg geen verwijzingen mee): alleen tellen.
                None => {
                    self.stats.xrefs_skipped += 1;
                    return;
                }
                Some(docs) => match docs.get(&insert.block_name) {
                    Some(target) => Some(target),
                    // Niet geladen: het laden heeft hem al geteld als niet
                    // gevonden of geweigerd.
                    None => return,
                },
            }
        } else {
            None
        };
        let common = &insert.common;
        let ocs = Xform3::ocs([insert.normal.x, insert.normal.y, insert.normal.z]);
        let scale = Xform3::scale(
            non_zero(insert.x_scale()),
            non_zero(insert.y_scale()),
            non_zero(insert.z_scale()),
        );
        let mut child = ctx.clone();
        child.depth = ctx.depth + 1;
        child.inherit = Some(*layer);
        child.byblock_color = self.color_of(common.color, layer, ctx);
        child.byblock_weight = self.weight_mm(common.line_weight, common.color, layer, ctx);
        child.byblock_alpha = self.file_alpha(common.transparency, layer, ctx);
        child.byblock_linetype = if common.linetype.eq_ignore_ascii_case("byblock") || common.linetype.is_empty() {
            ctx.byblock_linetype
        } else {
            Some(common.linetype.as_str())
        };
        let columns = insert.column_count.max(1);
        let rows = insert.row_count.max(1);
        // Een externe verwijzing komt met haar eigen basispunt ($INSBASE) op het
        // invoegpunt, en in de eenheid van de hoofdtekening: een verwijzing in
        // meters in een tekening in millimeters wordt duizend keer zo groot.
        let base = match xref {
            Some(target) => {
                let origin = target.document.header.model_space_insertion_base;
                let factor = unit_factor(self.doc, &target.document);
                Xform3::translate(-origin.x, -origin.y, -origin.z).then(&Xform3::scale(factor, factor, factor))
            }
            None => Xform3::translate(-block.base[0], -block.base[1], -block.base[2]),
        };
        if visible
            || xref.is_some()
            || block.entities.iter().any(|e| !is_layer_zero(&e.common().layer) || matches!(e, EntityType::Insert(_)))
        {
            for row in 0..rows {
                for column in 0..columns {
                    // Elke cel telt als bezoek: een MINSERT van 65535 × 65535
                    // cellen met een leeg blok moet ook te stoppen zijn.
                    if !self.tick() {
                        return;
                    }
                    let offset = Xform3::translate(column as f64 * insert.column_spacing, row as f64 * insert.row_spacing, 0.0);
                    let xf = base
                        .then(&scale)
                        .then(&offset)
                        .then(&Xform3::rotate_z(insert.rotation))
                        .then(&Xform3::translate(insert.insert_point.x, insert.insert_point.y, insert.insert_point.z))
                        .then(&ocs)
                        .then(&ctx.xf);
                    child.xf = xf;
                    self.stats.blocks_expanded += 1;
                    if let Some(target) = xref {
                        self.draw_xref(&insert.block_name, target, &child, !visible, sink);
                        if self.cancelled {
                            return;
                        }
                        continue;
                    }
                    // Staat dit blok vaker op dezelfde manier, dan komt het één
                    // keer als formulier in de PDF en kost een plaatsing geen
                    // wandeling meer, wel wat de wandeling gekost zou hebben.
                    let (action, key) = if self.settings.reuse_blocks && sink.takes_forms() {
                        let key = self.form_key(&insert.block_name, visible, &child);
                        (sink.begin_form(&key, child.xf.point([0.0, 0.0, 0.0])), key)
                    } else {
                        (FormAction::Draw, String::new())
                    };
                    if matches!(action, FormAction::Placed | FormAction::Skipped) {
                        self.replay(&key, action == FormAction::Placed);
                        if sink.exhausted() {
                            self.too_complex = true;
                            self.cancelled = true;
                        }
                        if self.cancelled {
                            return;
                        }
                        continue;
                    }
                    let before = (action != FormAction::Draw).then(|| self.stats.clone());
                    for entity in &block.entities {
                        if self.cancelled {
                            break;
                        }
                        // Als de laag van de INSERT uit staat, blijft alleen
                        // inhoud op een eigen (zichtbare) laag over. Een
                        // geneste INSERT op laag 0 gaat wel door: zijn blok kan
                        // inhoud op eigen zichtbare lagen hebben.
                        if !visible && is_layer_zero(&entity.common().layer) && !matches!(entity, EntityType::Insert(_)) {
                            continue;
                        }
                        self.entity(entity, &child, sink);
                    }
                    if let Some(before) = before {
                        let written = sink.end_form(!self.cancelled);
                        if !self.cancelled {
                            self.keep_form_stats(key, action, written, &before);
                        }
                    }
                    if self.cancelled {
                        return;
                    }
                }
            }
        }
        // Attributen staan in de ruimte van de INSERT zelf, niet in het blok.
        // Elk attribuut is een bezochte entiteit: zo blijft een INSERT met
        // duizenden attributen af te breken.
        if self.settings.attributes {
            for attribute in &insert.attributes {
                if !self.tick() {
                    return;
                }
                let attribute_layer = self.layer_info(attribute.common.layer.as_str(), &child);
                if !self.layer_state(&attribute_layer, ctx).0 {
                    continue;
                }
                let mut attribute_ctx = ctx.clone();
                attribute_ctx.inherit = Some(*layer);
                attribute_ctx.byblock_color = child.byblock_color;
                attribute_ctx.byblock_weight = child.byblock_weight;
                self.attribute(attribute, &attribute_layer, &attribute_ctx, sink);
            }
        }
    }

    /// Sleutel van een blokplaatsing. Plaatsingen met dezelfde sleutel geven
    /// op een verschuiving na precies dezelfde inhoud en mogen dus hetzelfde
    /// formulier delen. Alles wat de inhoud kan veranderen zit erin: het
    /// lineaire deel van de afbeelding naar de pagina (schaal, draaiing,
    /// spiegeling en kanteling; bit voor bit, want afronden zou bij een blok
    /// met grote eigen coördinaten zichtbaar worden), de laag die laag 0 erft
    /// en of die aan staat, de ByBlock-stijl (kleur, dikte, dekking, lijntype),
    /// de lijntypefactor, de bevroren lagen van de viewport en de diepte (de
    /// dieptegrens kapt een diep genest blok eerder af).
    fn form_key(&self, name: &str, visible: bool, ctx: &Ctx<'a>) -> String {
        use std::fmt::Write;
        let mut key = String::with_capacity(self.form_scope.len() + name.len() + 160);
        key.push_str(&self.form_scope);
        key.push_str(&name.to_uppercase());
        for row in ctx.xf.m.iter().take(2) {
            for value in row.iter().take(3) {
                // -0 en 0 zijn dezelfde afbeelding.
                let value = if *value == 0.0 { 0.0 } else { *value };
                let _ = write!(key, "|{:x}", value.to_bits());
            }
        }
        let _ = write!(
            key,
            "|{}|{}|{:?}|{}|{:x}|{:x}|{:x}|{:?}|{}|{}",
            ctx.inherit.map(|l| l.name).unwrap_or(""),
            visible,
            ctx.byblock_color.rgb,
            ctx.byblock_color.aci7,
            ctx.byblock_weight.to_bits(),
            ctx.byblock_alpha.to_bits(),
            ctx.lt_factor.to_bits(),
            ctx.byblock_linetype,
            ctx.frozen_id,
            ctx.depth
        );
        key
    }

    /// Een formulier is geplaatst (of viel buiten beeld): tel wat het
    /// doorlopen van het blok geteld zou hebben, en reken de bezoeken af. Zo
    /// blijven de werkgrens en het verslag gelijk aan die van een import
    /// zonder formulieren.
    fn replay(&mut self, key: &str, placed: bool) {
        let Some(found) = self.form_stats.get(key) else { return };
        let delta = match (&found.full, placed) {
            (Some(full), true) => full,
            _ => &found.culled,
        };
        if !self.budget.spend_many(delta.visits) {
            self.too_complex = true;
            self.cancelled = true;
        }
        let visits = delta.visits;
        self.stats.absorb(delta);
        self.ticks = self.ticks.saturating_add(visits);
        self.poll_if_due();
    }

    /// Bewaart de tellingen van een plaatsing die net gemeten of opgenomen is.
    fn keep_form_stats(&mut self, key: String, action: FormAction, written: bool, before: &WalkStats) {
        let delta = self.stats.since(before);
        match action {
            FormAction::Measure => {
                self.form_stats.insert(key, FormStats { culled: delta.culled(), full: None });
            }
            FormAction::Record if written => {
                // Een opname gebeurt alleen helemaal in beeld: dit zijn de
                // tellingen van een volledige plaatsing.
                match self.form_stats.get_mut(&key) {
                    Some(found) => found.full = Some(delta),
                    None => {
                        self.form_stats.insert(key, FormStats { culled: delta.culled(), full: Some(delta) });
                    }
                }
            }
            _ => {}
        }
    }

    /// Tekent een geladen externe verwijzing met een eigen wandelaar op dat
    /// document. Bezoekbudget en afbreekvlag zijn gedeeld, en de afnemer is
    /// dezelfde: wat de verwijzing opmaakt aan bezoeken en aan uitvoer, gaat
    /// van de begroting van de hele import af.
    fn draw_xref(&mut self, name: &str, target: &'a XrefDoc, ctx: &Ctx<'a>, skip_layer_0: bool, sink: &mut dyn Sink) {
        if self.xref_depth >= MAX_XREF_DEPTH {
            self.stats.deep_nesting += 1;
            return;
        }
        let key = name.to_uppercase();
        let mut inner = match self.xref_walkers.remove(&key) {
            Some(walker) => walker,
            None => {
                // Viewports bestaan alleen in de papierruimte van de
                // hoofdtekening.
                let settings = WalkSettings { viewports: false, ..self.settings.clone() };
                let mut walker = Walker::new(&target.document, settings, target.is_dxf);
                walker.share_budget(&self.budget);
                walker.cancel = self.cancel.clone();
                walker.xrefs = Some(&target.children);
                walker.xref_depth = self.xref_depth + 1;
                walker.images = self.images.clone();
                walker.dir = Some(target.dir.as_path());
                walker.form_scope = format!("{}{key}\u{1f}", self.form_scope);
                walker.adopt_host_layers(&key, &self.layers);
                walker
            }
        };
        inner.stats = WalkStats::default();
        inner.space_filtered("*Model_Space", ctx, skip_layer_0, sink);
        self.stats.absorb(&inner.stats);
        for style in &inner.replaced_styles {
            self.replaced_styles.insert(format!("{key}|{style}"));
        }
        self.stats.fonts_replaced = self.replaced_styles.len() as u64;
        self.too_complex |= inner.too_complex;
        self.cancelled |= inner.cancelled;
        self.xref_walkers.insert(key, inner);
    }

    /// De hoofdtekening kent de lagen van een externe verwijzing als
    /// `VERWIJZING|laag`. Onder die naam staan ze in het importvenster, in de
    /// lijst van lagen die uit staan en in de bevroren lagen van een viewport;
    /// de wandelaar van de verwijzing gebruikt daarom die naam waar hij
    /// bestaat. Een laag die de hoofdtekening niet kent, houdt zijn eigen naam.
    fn adopt_host_layers(&mut self, prefix: &str, host: &HashMap<String, LayerInfo<'a>>) {
        let prefix = format!("{prefix}|");
        for (key, info) in host {
            if let Some(own) = key.strip_prefix(&prefix).and_then(|rest| self.layers.get_mut(rest)) {
                own.name = info.name;
            }
        }
    }

    fn draw_block(&mut self, name: &str, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if ctx.depth >= MAX_DEPTH {
            self.stats.deep_nesting += 1;
            return;
        }
        if !self.tick() {
            return;
        }
        let Some(block) = self.block(name) else {
            self.stats.missing_blocks += 1;
            return;
        };
        let mut child = ctx.clone();
        child.xf = Xform3::translate(-block.base[0], -block.base[1], -block.base[2]).then(&ctx.xf);
        for entity in &block.entities {
            if self.cancelled {
                return;
            }
            self.entity(entity, &child, sink);
        }
    }

    // ── Arceringen ───────────────────────────────────────────────────────
    fn hatch(&mut self, entity: &acadrust::entities::Hatch, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if matches!(self.settings.hatch, HatchMode::None) {
            return;
        }
        self.stats.hatches += 1;
        let m = self.plane_of(ctx, entity.normal, entity.elevation);
        let color = self.rgb(entity.common.color, layer, ctx);
        let alpha = self.alpha_of(entity.common.transparency, layer, ctx);
        let boundary = hatch::boundary(&entity.paths, &m, entity.elevation, entity.style, self.source_is_dxf);
        if boundary.is_empty() || !boundary.is_writable() || !self.charge(boundary.ops.len()) {
            return;
        }
        let Some(bounds) = boundary.bounds() else { return };
        if !sink.wants(bounds) {
            return;
        }
        let solid = entity.is_solid || entity.gradient_color.enabled;
        // "Alleen omtrek" geldt ook voor een effen of verlopende arcering:
        // die wordt dan, net als een patroon, alleen als grens getekend.
        if solid && !matches!(self.settings.hatch, HatchMode::Outline) {
            // De kleur uit het bestand: van het verloop (de eerste kleur) of
            // van de arcering zelf.
            let source = if entity.gradient_color.enabled {
                entity.gradient_color.colors.first().map(|c| Self::base_color(c.color))
            } else {
                None
            }
            .unwrap_or_else(|| self.color_of(entity.common.color, layer, ctx));
            let fill = paper_color(source.rgb, source.aci7, self.settings.color_mode);
            let source_alpha = self.file_alpha(entity.common.transparency, layer, ctx);
            self.emit_area_fill(layer.name, (source, source_alpha), fill, alpha, &boundary, true, sink);
            return;
        }
        let outline_only = matches!(self.settings.hatch, HatchMode::SolidOnly | HatchMode::Outline);
        let families = if outline_only {
            None
        } else {
            hatch::pattern(&entity.pattern, &m, bounds, self.settings.max_hatch_lines)
        };
        match families {
            Some(families) => {
                // Elke patroonlijn is werk; het knippen op de grens doet de
                // lezer, maar het schrijven ervan de afnemer.
                let lines: usize = families.iter().map(|family| family.path.ops.len() / 2).sum();
                if !self.charge(lines) {
                    return;
                }
                let width = self.weight_mm(entity.common.line_weight, entity.common.color, layer, ctx) * PT_PER_MM;
                sink.push_clip(&boundary, true);
                for family in families {
                    let stroke = Stroke { color, width, dash: family.dash, cap: 1, join: 1, alpha };
                    self.stats.drawn += 1;
                    sink.stroke(layer.name, &stroke, &family.path);
                    if sink.exhausted() {
                        self.too_complex = true;
                        self.cancelled = true;
                        break;
                    }
                }
                sink.pop_clip();
            }
            None => {
                if !outline_only {
                    self.stats.hatch_patterns_skipped += 1;
                }
                let width = self.weight_mm(entity.common.line_weight, entity.common.color, layer, ctx) * PT_PER_MM;
                let stroke = Stroke::new(color, width);
                self.emit_stroke(layer.name, &stroke, &boundary, sink);
            }
        }
    }

    // ── Tekst ────────────────────────────────────────────────────────────
    #[allow(clippy::too_many_arguments)]
    fn draw_line_of_text(
        &mut self,
        value: &str,
        insert: (f64, f64),
        align: Option<(f64, f64)>,
        height: f64,
        rotation: f64,
        width_factor: f64,
        oblique: f64,
        h: HAlign,
        v: VAlign,
        generation: i16,
        font: FontChoice,
        normal: Vector3,
        elevation: f64,
        color: Color,
        transparency: acadrust::types::Transparency,
        layer: &LayerInfo<'a>,
        ctx: &Ctx<'a>,
        sink: &mut dyn Sink,
    ) {
        let decoded = text::decode_cad_text(value);
        if decoded.trim().is_empty() {
            return;
        }
        let (bytes, replaced) = text::encode(&decoded);
        self.stats.replaced_characters += replaced as u64;
        if bytes.is_empty() {
            return;
        }
        let width_em = text::width_with(&bytes, font);
        let placement = text::place_text(insert, align, height, rotation, width_factor, h, v, width_em);
        let m = self.plane_of(ctx, normal, elevation);
        let glyph = Matrix::new(
            placement.font_size * placement.width_factor,
            0.0,
            placement.font_size * oblique.tan(),
            placement.font_size,
            0.0,
            0.0,
        );
        let mirror = Matrix::scale(
            if generation & 2 != 0 { -1.0 } else { 1.0 },
            if generation & 4 != 0 { -1.0 } else { 1.0 },
        );
        let (sin, cos) = placement.rotation.sin_cos();
        let tm = glyph
            .then(&mirror)
            .then(&Matrix::new(cos, sin, -sin, cos, 0.0, 0.0))
            .then(&Matrix::translate(placement.x, placement.y))
            .then(&m);
        let bbox = text_box(&tm, width_em);
        if !bbox.iter().all(|v| v.is_finite()) || !sink.wants(bbox) {
            return;
        }
        let rgb = self.rgb(color, layer, ctx);
        let alpha = self.alpha_of(transparency, layer, ctx);
        self.stats.texts += 1;
        self.stats.drawn += 1;
        sink.text(layer.name, rgb, alpha, tm, &bytes, font);
    }

    fn text_entity(&mut self, entity: &Text, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if !self.settings.text {
            return;
        }
        let align = entity.alignment_point.map(|p| (p.x, p.y));
        let oblique = self.style_oblique(&entity.style, entity.oblique_angle);
        let width_factor = self.style_width(&entity.style, entity.width_factor);
        let font = self.style_font(&entity.style);
        self.draw_line_of_text(
            &entity.value,
            (entity.insertion_point.x, entity.insertion_point.y),
            align,
            entity.height,
            entity.rotation,
            width_factor,
            oblique,
            match entity.horizontal_alignment {
                acadrust::entities::TextHorizontalAlignment::Left => HAlign::Left,
                acadrust::entities::TextHorizontalAlignment::Center => HAlign::Center,
                acadrust::entities::TextHorizontalAlignment::Right => HAlign::Right,
                acadrust::entities::TextHorizontalAlignment::Aligned => HAlign::Aligned,
                acadrust::entities::TextHorizontalAlignment::Middle => HAlign::Middle,
                acadrust::entities::TextHorizontalAlignment::Fit => HAlign::Fit,
            },
            match entity.vertical_alignment {
                acadrust::entities::TextVerticalAlignment::Baseline => VAlign::Baseline,
                acadrust::entities::TextVerticalAlignment::Bottom => VAlign::Bottom,
                acadrust::entities::TextVerticalAlignment::Middle => VAlign::Middle,
                acadrust::entities::TextVerticalAlignment::Top => VAlign::Top,
            },
            entity.generation_flags,
            font,
            entity.normal,
            entity.insertion_point.z,
            entity.common.color,
            entity.common.transparency,
            layer,
            ctx,
            sink,
        );
    }

    fn attribute(&mut self, entity: &AttributeEntity, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if !self.settings.text || !self.settings.attributes || entity.flags.invisible {
            return;
        }
        if let Some(mtext) = &entity.embedded_mtext {
            self.mtext(mtext, layer, ctx, sink);
            return;
        }
        let oblique = self.style_oblique(&entity.text_style, text_angle(entity.oblique_angle, self.source_is_dxf));
        let width_factor = self.style_width(&entity.text_style, entity.width_factor);
        let font = self.style_font(&entity.text_style);
        self.draw_line_of_text(
            &entity.value,
            (entity.insertion_point.x, entity.insertion_point.y),
            Some((entity.alignment_point.x, entity.alignment_point.y)),
            entity.height,
            text_angle(entity.rotation, self.source_is_dxf),
            width_factor,
            oblique,
            h_align(entity.horizontal_alignment),
            v_align(entity.vertical_alignment),
            entity.text_generation_flags,
            font,
            entity.normal,
            entity.insertion_point.z,
            entity.common.color,
            entity.common.transparency,
            layer,
            ctx,
            sink,
        );
    }

    /// De letter voor een tekststijl; één keer per stijl bepaald.
    fn style_font(&mut self, style: &str) -> FontChoice {
        let key = style.to_uppercase();
        if let Some(found) = self.fonts.get(&key) {
            return *found;
        }
        let (file, ttf) = match self.doc.text_styles.get(style) {
            Some(s) => (s.font_file.clone(), s.true_type_font.clone()),
            None => (String::new(), String::new()),
        };
        let choice = self.settings.fonts.choose(&file, &ttf);
        // Geen enkele letter uit de tekening gaat mee: elke stijl die een
        // letter noemt, krijgt een vervangende standaardletter. Een stijl
        // zonder letternaam heeft niets om te vervangen.
        if !(file.trim().is_empty() && ttf.trim().is_empty()) {
            self.replaced_styles.insert(key.clone());
            self.stats.fonts_replaced = self.replaced_styles.len() as u64;
        }
        self.fonts.insert(key, choice);
        choice
    }

    /// Schuinstand van een tekst: die van de entiteit (al in radialen), anders
    /// die van haar stijl.
    fn style_oblique(&self, style: &str, entity_value: f64) -> f64 {
        if entity_value.abs() > 1e-9 {
            return entity_value;
        }
        self.doc.text_styles.get(style).map(|s| text_angle(s.oblique_angle, self.source_is_dxf)).unwrap_or(0.0)
    }

    fn style_width(&self, style: &str, entity_value: f64) -> f64 {
        if entity_value > 0.0 {
            return entity_value;
        }
        self.doc.text_styles.get(style).map(|s| if s.width_factor > 0.0 { s.width_factor } else { 1.0 }).unwrap_or(1.0)
    }

    fn mtext(&mut self, entity: &MText, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if !self.settings.text {
            return;
        }
        let base_height = if entity.height > 0.0 { entity.height } else { 2.5 };
        // De letter geldt per MTEXT: opmaakcodes voor vet en schuin binnen de
        // tekst worden niet ontleed.
        let font = self.style_font(&entity.style);
        let parsed = parse_mtext(&entity.value, true);
        let mut paragraphs: Vec<Vec<MTextRun>> = Vec::new();
        let mut replaced = 0usize;
        for paragraph in &parsed.paragraphs {
            let mut runs = Vec::new();
            for span in &paragraph.spans {
                let raw = match &span.stacking {
                    Some(stack) => stack.to_plain_text(),
                    None => span.text.clone(),
                };
                let decoded = text::decode_cad_text(&raw);
                if decoded.is_empty() {
                    continue;
                }
                let (bytes, n) = text::encode(&decoded);
                replaced += n;
                let height = match span.properties.height {
                    Some(MTextScalar::Factor(f)) if f > 0.0 => base_height * f,
                    Some(MTextScalar::Absolute(h)) if h > 0.0 => h,
                    _ => base_height,
                };
                let (color, aci) = match span.properties.color {
                    Some(MTextColor::Index(i)) if i > 0 && i < 256 => (None, Some(i as i16)),
                    Some(MTextColor::TrueColor(v)) => {
                        (Some((((v >> 16) & 0xff) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8)), None)
                    }
                    _ => (None, None),
                };
                runs.push(MTextRun {
                    bytes,
                    height,
                    width_factor: span.properties.width_factor.filter(|v| *v > 0.0).unwrap_or(1.0),
                    color,
                    aci,
                    font,
                });
            }
            paragraphs.push(runs);
        }
        self.stats.replaced_characters += replaced as u64;
        if paragraphs.iter().all(|p| p.is_empty()) {
            return;
        }
        // De tekening is met een eigen letter opgemaakt; Helvetica is vaak
        // breder (zeker tegenover een smalle letter). Past een alinea niet
        // meer binnen de breedte die het bestand ervoor noteerde, dan wordt
        // de tekst iets smaller getrokken in plaats van over de regel eronder
        // heen te lopen.
        let limit = if entity.extents_width > 0.0 { entity.extents_width } else { entity.rectangle_width };
        if limit > 0.0 {
            let natural = paragraphs
                .iter()
                .map(|runs| {
                    runs.iter()
                        .map(|run| text::width_with(&run.bytes, run.font) * run.height / text::TEXT_HEIGHT_FACTOR * run.width_factor)
                        .sum::<f64>()
                })
                .fold(0.0, f64::max);
            if natural > limit * 1.001 {
                let fit = (limit / natural).max(0.5);
                for runs in paragraphs.iter_mut() {
                    for run in runs.iter_mut() {
                        run.width_factor *= fit;
                    }
                }
            }
        }
        let lines = text::wrap_mtext(&paragraphs, entity.rectangle_width.max(0.0));
        if lines.is_empty() || !self.charge(lines.iter().map(|line| line.runs.len()).sum()) {
            return;
        }
        let factor = if entity.line_spacing_factor > 0.0 { entity.line_spacing_factor } else { 1.0 };
        let attachment = entity.attachment_point as i32;
        let (h_index, v_index) = (((attachment - 1) % 3).max(0), ((attachment - 1) / 3).max(0));
        let steps: Vec<f64> = lines
            .windows(2)
            .map(|w| 5.0 / 3.0 * w[0].height.max(w[1].height) * factor)
            .collect();
        let total: f64 = lines[0].height + steps.iter().sum::<f64>();
        let mut baseline = match v_index {
            0 => -lines[0].height,
            1 => total / 2.0 - lines[0].height,
            _ => total - lines[0].height,
        };
        let rotation = if entity.rotation.abs() > 1e-12 {
            entity.rotation
        } else {
            entity
                .dwg_x_direction
                .filter(|d| d.x.hypot(d.y) > 1e-12)
                .map(|d| d.y.atan2(d.x))
                .unwrap_or(0.0)
        };
        let m = self.plane_of(ctx, entity.normal, entity.insertion_point.z);
        let (sin, cos) = rotation.sin_cos();
        let origin = Point::new(entity.insertion_point.x, entity.insertion_point.y);
        let base_rgb = self.rgb(entity.common.color, layer, ctx);
        let alpha = self.alpha_of(entity.common.transparency, layer, ctx);
        for (index, line) in lines.iter().enumerate() {
            if !self.keep_going(index, sink) {
                return;
            }
            if index > 0 {
                baseline -= steps[index - 1];
            }
            let start_x = match h_index {
                0 => 0.0,
                1 => -line.width / 2.0,
                _ => -line.width,
            };
            for (dx, run) in &line.runs {
                if run.bytes.iter().all(|b| *b == b' ') {
                    continue;
                }
                let size = run.height / text::TEXT_HEIGHT_FACTOR;
                let local = Matrix::new(size * run.width_factor, 0.0, 0.0, size, start_x + dx, baseline);
                let tm = local.then(&Matrix::new(cos, sin, -sin, cos, 0.0, 0.0)).then(&Matrix::translate(origin.x, origin.y)).then(&m);
                let rgb = match (run.color, run.aci) {
                    (Some(rgb), _) => paper_color(rgb, false, self.settings.color_mode),
                    (None, Some(aci)) => {
                        let col = Self::base_color(Color::from_index(aci));
                        paper_color(col.rgb, col.aci7, self.settings.color_mode)
                    }
                    _ => base_rgb,
                };
                // Alle vier de hoekpunten van het regelvak, net als bij een
                // TEXT: onder een draaiing zijn twee diagonale hoekpunten geen
                // omhullende.
                let bbox = text_box(&tm, text::width_with(&run.bytes, run.font));
                if !bbox.iter().all(|v| v.is_finite()) || !sink.wants(bbox) {
                    continue;
                }
                self.stats.texts += 1;
                self.stats.drawn += 1;
                sink.text(layer.name, rgb, alpha, tm, &run.bytes, run.font);
            }
        }
    }

    // ── Verwijslijnen ────────────────────────────────────────────────────
    fn leader(&mut self, leader: &acadrust::entities::Leader, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        if leader.vertices.len() < 2 {
            return;
        }
        let stroke = self.stroke_of(&leader.common, layer, ctx, ctx.xf.xy_scale());
        let mut path = std::mem::take(&mut self.path);
        path.clear();
        for (i, v) in leader.vertices.iter().enumerate() {
            let p = ctx.xf.point([v.x, v.y, v.z]);
            if i == 0 {
                path.move_to(p);
            } else {
                path.line_to(p);
            }
        }
        self.emit_stroke(layer.name, &stroke, &path, sink);
        self.path = path;
        if leader.arrow_enabled {
            let size = if leader.arrow_size > 0.0 {
                leader.arrow_size
            } else {
                self.doc
                    .dim_styles
                    .get(&leader.dimension_style)
                    .map(|s| s.dimasz * if s.dimscale > 0.0 { s.dimscale } else { 1.0 })
                    .unwrap_or(0.0)
            };
            let tip = leader.vertices[0];
            let next = leader.vertices[1];
            self.arrow_head(
                [tip.x, tip.y, tip.z],
                [next.x - tip.x, next.y - tip.y, next.z - tip.z],
                size,
                stroke.color,
                layer.name,
                ctx,
                sink,
            );
        }
    }

    fn multileader(&mut self, leader: &acadrust::entities::MultiLeader, layer: &LayerInfo<'a>, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        let context = &leader.context;
        let scale = if context.scale_factor > 0.0 { context.scale_factor } else { 1.0 };
        let stroke = self.stroke_of(&leader.common, layer, ctx, ctx.xf.xy_scale());
        let mut path = std::mem::take(&mut self.path);
        for root in &context.leader_roots {
            for line in &root.lines {
                if line.points.len() < 2 && root.connection_point == Vector3::ZERO {
                    continue;
                }
                path.clear();
                for (i, p) in line.points.iter().enumerate() {
                    let q = ctx.xf.point([p.x, p.y, p.z]);
                    if i == 0 {
                        path.move_to(q);
                    } else {
                        path.line_to(q);
                    }
                }
                if !line.points.is_empty() {
                    let c = root.connection_point;
                    path.line_to(ctx.xf.point([c.x, c.y, c.z]));
                    if leader.enable_landing && root.landing_distance.abs() > 0.0 {
                        let d = root.direction;
                        path.line_to(ctx.xf.point([
                            c.x + d.x * root.landing_distance,
                            c.y + d.y * root.landing_distance,
                            c.z + d.z * root.landing_distance,
                        ]));
                    }
                }
                self.emit_stroke(layer.name, &stroke, &path, sink);
                if let Some(tip) = line.points.first() {
                    let next = line.points.get(1).copied().unwrap_or(root.connection_point);
                    let size = if line.arrowhead_size > 0.0 { line.arrowhead_size } else { leader.arrowhead_size };
                    self.arrow_head(
                        [tip.x, tip.y, tip.z],
                        [next.x - tip.x, next.y - tip.y, next.z - tip.z],
                        size * scale,
                        stroke.color,
                        layer.name,
                        ctx,
                        sink,
                    );
                }
            }
        }
        self.path = path;
        if context.has_text_contents && !context.text_string.is_empty() && self.settings.text {
            let height = if context.text_height > 0.0 { context.text_height } else { leader.text_height };
            let mut mtext = MText::new();
            mtext.common = leader.common.clone();
            mtext.value = context.text_string.clone();
            mtext.insertion_point = context.text_location;
            mtext.height = if height > 0.0 { height } else { 2.5 };
            mtext.rectangle_width = context.text_width.max(0.0);
            mtext.rotation = if context.text_rotation.abs() > 1e-12 {
                context.text_rotation
            } else if context.text_direction.x.hypot(context.text_direction.y) > 1e-12 {
                context.text_direction.y.atan2(context.text_direction.x)
            } else {
                0.0
            };
            mtext.attachment_point = attachment_from(context.text_attachment_point);
            mtext.normal = if context.text_normal.z.abs() > 1e-9 { context.text_normal } else { Vector3::new(0.0, 0.0, 1.0) };
            if context.text_color != Color::ByBlock {
                mtext.common.color = context.text_color;
            }
            self.mtext(&mtext, layer, ctx, sink);
        }
        if context.has_block_contents {
            if let Some(handle) = context.block_content_handle {
                if let Some(name) = self.doc.block_records.iter().find(|r| r.handle == handle).map(|r| r.name.clone()) {
                    let location = context.block_content_location;
                    let s = context.block_content_scale;
                    let xf = Xform3::scale(non_zero(s.x * scale), non_zero(s.y * scale), non_zero(s.z * scale))
                        .then(&Xform3::rotate_z(context.block_rotation))
                        .then(&Xform3::translate(location.x, location.y, location.z))
                        .then(&ctx.xf);
                    let mut child = ctx.clone();
                    child.xf = xf;
                    child.depth += 1;
                    child.inherit = Some(*layer);
                    child.byblock_color = self.color_of(leader.common.color, layer, ctx);
                    self.draw_block(&name, &child, sink);
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn arrow_head(
        &mut self,
        tip: [f64; 3],
        direction: [f64; 3],
        size: f64,
        color: Rgb,
        layer: &str,
        ctx: &Ctx<'a>,
        sink: &mut dyn Sink,
    ) {
        if !(size > 0.0) {
            return;
        }
        let len = (direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]).sqrt();
        if !(len > 1e-12) {
            return;
        }
        let d = [direction[0] / len, direction[1] / len, direction[2] / len];
        let n = [-d[1], d[0], 0.0];
        let base = [tip[0] + d[0] * size, tip[1] + d[1] * size, tip[2] + d[2] * size];
        let half = size / 6.0;
        let mut path = PagePath::new();
        path.move_to(ctx.xf.point(tip));
        path.line_to(ctx.xf.point([base[0] + n[0] * half, base[1] + n[1] * half, base[2]]));
        path.line_to(ctx.xf.point([base[0] - n[0] * half, base[1] - n[1] * half, base[2]]));
        path.close();
        self.emit_fill(layer, color, 1.0, &path, false, sink);
    }

    // ── Afbeeldingen ─────────────────────────────────────────────────────
    /// Tekent een IMAGE. `false` als afbeeldingen niet ingesloten worden (dan
    /// telt de aanroeper hem als overgeslagen, zoals voorheen).
    fn raster_image(
        &mut self,
        entity: &acadrust::entities::RasterImage,
        layer: &LayerInfo<'a>,
        ctx: &Ctx<'a>,
        sink: &mut dyn Sink,
    ) -> bool {
        let Some(store) = self.images.clone().filter(|_| self.settings.images) else { return false };
        // Een afbeelding die in de tekening uit staat, toont alleen haar kader.
        let shown = acadrust::entities::ImageDisplayFlags::SHOW_IMAGE;
        if !entity.flags.is_empty() && !entity.flags.contains(shown) {
            return true;
        }
        let raw = if entity.file_path.trim().is_empty() {
            match entity.definition_handle.and_then(|h| self.doc.objects.get(&h)) {
                Some(ObjectType::ImageDefinition(definition)) => definition.file_name.as_str(),
                _ => "",
            }
        } else {
            entity.file_path.as_str()
        };
        let cancel = self.cancel.clone();
        let cancelled = move || cancel.as_ref().is_some_and(|f| f());
        let found = store.get(raw, self.dir, &cancelled);
        if cancelled() {
            self.cancelled = true;
            return true;
        }
        let (key, raster) = match found {
            Lookup::Found { key, raster } => (key, raster),
            Lookup::Missing => {
                self.stats.images_missing += 1;
                return true;
            }
            Lookup::Refused => {
                self.stats.images_refused += 1;
                return true;
            }
            Lookup::OddName => {
                self.stats.odd_names += 1;
                return true;
            }
            Lookup::TooLarge => {
                self.stats.images_too_large += 1;
                return true;
            }
            Lookup::Unsupported => {
                self.stats.images_unsupported += 1;
                return true;
            }
        };
        // Het eenheidsvierkant op het vlak van de afbeelding: het invoegpunt
        // is de linkeronderhoek, u en v zijn de maat van één beeldpunt. De maat
        // in beeldpunten komt uit de tekening; ontbreekt die, dan uit het beeld.
        let usable = |v: f64| v.is_finite() && v >= 1.0;
        let w = if usable(entity.size.x) { entity.size.x } else { f64::from(raster.width) };
        let h = if usable(entity.size.y) { entity.size.y } else { f64::from(raster.height) };
        let origin = ctx.xf.point([entity.insertion_point.x, entity.insertion_point.y, entity.insertion_point.z]);
        let ex = ctx.xf.vector([entity.u_vector.x * w, entity.u_vector.y * w, entity.u_vector.z * w]);
        let ey = ctx.xf.vector([entity.v_vector.x * h, entity.v_vector.y * h, entity.v_vector.z * h]);
        let matrix = Matrix::new(ex.x, ex.y, ey.x, ey.y, origin.x, origin.y);
        let area = (matrix.a * matrix.d - matrix.b * matrix.c).abs();
        let mut outline = PagePath::new();
        for (i, (x, y)) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)].into_iter().enumerate() {
            let p = matrix.apply(Point::new(x, y));
            if i == 0 {
                outline.move_to(p);
            } else {
                outline.line_to(p);
            }
        }
        outline.close();
        let Some(bounds) = outline.bounds().filter(|_| outline.is_writable() && area.is_finite() && area > 1e-12) else {
            // Een beeld zonder oppervlak (of met onmogelijke getallen).
            self.stats.images_missing += 1;
            return true;
        };
        if !sink.wants(bounds) {
            return true;
        }
        let alpha = (1.0 - f64::from(entity.fade.min(100)) / 100.0) * self.file_alpha(entity.common.transparency, layer, ctx);

        let clip = image_clip(entity, &matrix, &outline, w, h);
        if let Some((path, even_odd)) = &clip {
            sink.push_clip(path, *even_odd);
        }
        sink.image(layer.name, alpha.clamp(0.0, 1.0), matrix, &key, &raster);
        if clip.is_some() {
            sink.pop_clip();
        }
        self.stats.images_embedded += 1;
        self.stats.drawn += 1;
        true
    }

    // ── Viewports ────────────────────────────────────────────────────────
    fn viewport(&mut self, viewport: &Viewport, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        // Alleen viewports die rechtstreeks in een papierruimte staan. Een
        // viewport in een blok, binnen een viewport of in de modelruimte zou
        // het model (eindeloos) opnieuw tekenen. De modelruimte loopt ook op
        // diepte 0, dus de diepte alleen is niet genoeg.
        if ctx.depth > 0 || !ctx.in_paper_space {
            return;
        }
        let view = match self.sheet.classify(viewport) {
            super::viewport::ViewportUse::Draw(view) => view,
            super::viewport::ViewportUse::NotPlan => {
                self.stats.viewports_3d_skipped += 1;
                return;
            }
            super::viewport::ViewportUse::SheetByCoverage => {
                self.stats.sheets_by_coverage += 1;
                return;
            }
            _ => return,
        };

        // Een eigen (niet-rechthoekige) knipgrens gaat voor de rechthoek.
        let own = super::viewport::clip_corners(self.doc, viewport);
        let outline: &[(f64, f64)] = if own.is_empty() { &view.corners } else { &own };
        let on_page: Vec<Point> = outline.iter().map(|(x, y)| ctx.xf.point([*x, *y, 0.0])).collect();
        let mut clip = PagePath::new();
        for (i, p) in on_page.iter().enumerate() {
            if i == 0 {
                clip.move_to(*p);
            } else {
                clip.line_to(*p);
            }
        }
        clip.close();
        let Some(bounds) = clip.bounds() else { return };
        if !sink.wants(bounds) {
            return;
        }

        let model_to_page = view.model_to_paper.then(&ctx.xf);
        let frozen: HashSet<String> = view
            .frozen_layers
            .iter()
            .filter_map(|h| self.layer_by_handle.get(&h.value()))
            .map(|name| name.to_uppercase())
            .collect();
        let mut child = self.root_ctx(model_to_page);
        child.frozen_id = self.frozen_id(&frozen);
        child.vp_frozen = Some(Rc::new(frozen));
        child.lt_factor = if self.psltscale { 1.0 / view.scale } else { 1.0 };
        child.depth = ctx.depth + 1;

        self.stats.viewports_drawn += 1;
        if view.covers_page {
            self.stats.viewports_cover_page += 1;
        }
        self.measure_viewports.push(MeasureViewport {
            bbox: bounds,
            // Een eigen grens die gewoon een rechthoek langs de assen is (veel
            // tekenpakketten knippen elk venster zo), voegt niets toe aan de
            // omhullende.
            outline: if own.is_empty() || fills_its_bounds(&on_page, bounds) { Vec::new() } else { on_page },
            matrix: model_to_page.plane(0.0),
            units_per_point: 1.0 / model_to_page.xy_scale().max(1e-12),
            name: String::new(),
        });
        sink.push_clip(&clip, false);
        self.space("*Model_Space", &child, sink);
        sink.pop_clip();
    }
}

impl Walker<'_> {
    /// Nummer van een verzameling bevroren lagen; dezelfde lagen geven
    /// hetzelfde nummer. Eén keer per viewport, niet per blokplaatsing.
    fn frozen_id(&mut self, frozen: &HashSet<String>) -> u32 {
        let mut names: Vec<&str> = frozen.iter().map(|name| name.as_str()).collect();
        names.sort_unstable();
        let next = self.frozen_ids.len() as u32 + 1;
        *self.frozen_ids.entry(names.join("\n")).or_insert(next)
    }
}

/// Is dit laag "0", de laag waarvan de inhoud van een blok de laag van de
/// invoeging volgt? Vergeleken wordt de naam zonder witruimte eromheen: een
/// bestand dat `0` met een spatie schrijft, bedoelt dezelfde laag, en elke plek
/// die laag 0 bijzonder behandelt, moet dat op dezelfde manier vaststellen.
pub fn is_layer_zero(name: &str) -> bool {
    // Alleen gewone (ASCII-)witruimte: een harde spatie of een andere
    // Unicode-spatie hoort bij de naam, en dat is dan een andere laag.
    name.trim_matches(|c: char| c.is_ascii_whitespace()) == "0"
}

/// Is deze veelhoek zijn eigen omhullende: alle hoekpunten op een hoek van de
/// rechthoek en (vrijwel) hetzelfde oppervlak?
fn fills_its_bounds(points: &[Point], bounds: [f64; 4]) -> bool {
    let (w, h) = (bounds[2] - bounds[0], bounds[3] - bounds[1]);
    if !(w > 0.0 && h > 0.0) {
        return false;
    }
    let eps = 1e-9 * w.max(h);
    let on_corner = |p: &Point| {
        ((p.x - bounds[0]).abs() <= eps || (p.x - bounds[2]).abs() <= eps)
            && ((p.y - bounds[1]).abs() <= eps || (p.y - bounds[3]).abs() <= eps)
    };
    if !points.iter().all(on_corner) {
        return false;
    }
    let twice_area: f64 = points.iter().zip(points.iter().cycle().skip(1)).map(|(a, b)| a.x * b.y - b.x * a.y).sum();
    (twice_area.abs() / 2.0 - w * h).abs() <= 1e-6 * w * h
}

/// De kaderlijn van een afbeelding als knippad in paginaruimte (met of het
/// even-oneven moet), of `None` als er niets te knippen valt.
///
/// In het bestand staan de hoekpunten in beeldpunten, met de oorsprong in het
/// midden van het beeldpunt linksboven en y naar beneden — dezelfde afspraak
/// als bij een WIPEOUT. Een kader dat het binnenste wegknipt (`Inside`) wordt
/// het hele beeld min de veelhoek.
fn image_clip(
    entity: &acadrust::entities::RasterImage,
    matrix: &Matrix,
    outline: &PagePath,
    w: f64,
    h: f64,
) -> Option<(PagePath, bool)> {
    use acadrust::entities::ClipMode;
    if !entity.clipping_enabled {
        return None;
    }
    let vertices = &entity.clip_boundary.vertices;
    let to_unit = |p: &acadrust::types::Vector2| Point::new((p.x + 0.5) / w, (h - p.y - 0.5) / h);
    let points: Vec<Point> = match vertices.as_slice() {
        [first, second] => {
            let (a, b) = (to_unit(first), to_unit(second));
            vec![Point::new(a.x, a.y), Point::new(b.x, a.y), Point::new(b.x, b.y), Point::new(a.x, b.y)]
        }
        many if many.len() >= 3 && many.len() <= super::viewport::MAX_CLIP_POINTS => many.iter().map(to_unit).collect(),
        _ => return None,
    };
    if !points.iter().all(|p| p.x.is_finite() && p.y.is_finite()) {
        return None;
    }
    let inverted = entity.clip_boundary.clip_mode == ClipMode::Inside;
    // Het standaardkader is het hele beeld: dan valt er niets te knippen.
    let whole = vertices.len() == 2
        && points.iter().all(|p| (p.x.abs() < 1e-6 || (p.x - 1.0).abs() < 1e-6) && (p.y.abs() < 1e-6 || (p.y - 1.0).abs() < 1e-6))
        && points.first().zip(points.get(2)).is_some_and(|(a, b)| (a.x - b.x).abs() > 0.5 && (a.y - b.y).abs() > 0.5);
    if whole && !inverted {
        return None;
    }
    let mut path = if inverted { outline.clone() } else { PagePath::new() };
    for (i, p) in points.iter().enumerate() {
        let mapped = matrix.apply(*p);
        if i == 0 {
            path.move_to(mapped);
        } else {
            path.line_to(mapped);
        }
    }
    path.close();
    Some((path, inverted))
}

/// Hoeveel een externe verwijzing groeit of krimpt om in de eenheid van de
/// hoofdtekening te passen. Noemt een van beide geen (bekende) eenheid, dan
/// blijft de maat zoals hij is.
fn unit_factor(host: &CadDocument, child: &CadDocument) -> f64 {
    use crate::page_space::DrawingUnit;
    let mm = |document: &CadDocument| DrawingUnit::from_insunits(document.header.insertion_units).map(DrawingUnit::mm_per_unit);
    match (mm(host), mm(child)) {
        (Some(host), Some(child)) if host > 0.0 && child > 0.0 => child / host,
        _ => 1.0,
    }
}

fn non_zero(v: f64) -> f64 {
    if v.abs() < 1e-12 || !v.is_finite() {
        1.0
    } else {
        v
    }
}

/// Een hoek die de DXF-lezer in graden laat staan waar de DWG-lezer radialen
/// geeft: de schuinstand van een tekststijl en de rotatie en schuinstand van
/// een ATTRIB. Dit is de ene plek die dat verschil kent; TEXT, MTEXT en ATTDEF
/// komen uit beide lezers al in radialen. (De hoeken van ellipsranden in een
/// arcering en de draaiing van een viewport hebben hun eigen omzetting, in
/// `hatch` en `viewport`.)
pub(super) fn text_angle(raw: f64, source_is_dxf: bool) -> f64 {
    if source_is_dxf {
        raw.to_radians()
    } else {
        raw
    }
}

/// Omhullende op de pagina van één regel tekst met tekstmatrix `tm` en
/// breedte `width_em` (in em): het vak van een kwart em onder de basislijn
/// tot één em erboven, via alle vier de hoekpunten, zodat het ook onder een
/// draaiing klopt.
fn text_box(tm: &Matrix, width_em: f64) -> [f64; 4] {
    let corners = [(0.0, -0.25), (width_em, -0.25), (width_em, 1.0), (0.0, 1.0)].map(|(x, y)| tm.apply(Point::new(x, y)));
    [
        corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
        corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
    ]
}

fn arc_frame(m: &Matrix, center: (f64, f64), rx: f64, ry: f64) -> (Point, Point, Point) {
    let c = m.apply(Point::new(center.0, center.1));
    let o = m.apply(Point::new(0.0, 0.0));
    let ux = m.apply(Point::new(rx, 0.0));
    let uy = m.apply(Point::new(0.0, ry));
    (c, Point::new(ux.x - o.x, ux.y - o.y), Point::new(uy.x - o.x, uy.y - o.y))
}

fn h_align(value: HorizontalAlignment) -> HAlign {
    match value {
        HorizontalAlignment::Left => HAlign::Left,
        HorizontalAlignment::Center => HAlign::Center,
        HorizontalAlignment::Right => HAlign::Right,
        HorizontalAlignment::Aligned => HAlign::Aligned,
        HorizontalAlignment::Middle => HAlign::Middle,
        HorizontalAlignment::Fit => HAlign::Fit,
    }
}

fn v_align(value: VerticalAlignment) -> VAlign {
    match value {
        VerticalAlignment::Baseline => VAlign::Baseline,
        VerticalAlignment::Bottom => VAlign::Bottom,
        VerticalAlignment::Middle => VAlign::Middle,
        VerticalAlignment::Top => VAlign::Top,
    }
}

/// Een multileader hangt de tekst links, midden of rechts aan de verwijslijn;
/// verticaal zit hij altijd op halve hoogte.
fn attachment_from(value: acadrust::entities::TextAttachmentPointType) -> acadrust::entities::AttachmentPoint {
    use acadrust::entities::AttachmentPoint::*;
    use acadrust::entities::TextAttachmentPointType as P;
    match value {
        P::Left => MiddleLeft,
        P::Center => MiddleCenter,
        P::Right => MiddleRight,
    }
}
