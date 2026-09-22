//! Tests van de wandeling, de verkenning en de omzetting op kleine,
//! in de test opgebouwde tekeningen (#400): geen externe bestanden nodig.

use super::curves::{PagePath, Xform3};
use super::scan;
use super::walk::{Sink, Stroke, WalkSettings, Walker};
use super::*;
use acadrust::entities::{EntityType, Insert, Line, Viewport};
use acadrust::tables::{BlockRecord, Layer};
use acadrust::tables::TableEntry;
use acadrust::types::{Color, Handle, Vector3};
use std::sync::atomic::AtomicBool;

// ── Opbouw van een testtekening ─────────────────────────────────────────

pub(crate) struct TestDoc {
    pub doc: CadDocument,
}

impl TestDoc {
    pub fn new() -> Self {
        let mut doc = CadDocument::new();
        doc.header.insertion_units = 4;
        TestDoc { doc }
    }

    pub fn layer(&mut self, name: &str, color: i16, edit: impl FnOnce(&mut Layer)) -> &mut Self {
        let mut layer = Layer::new(name);
        layer.color = Color::Index(color as u8);
        edit(&mut layer);
        layer.set_handle(self.doc.allocate_handle());
        self.doc.layers.add(layer).unwrap();
        self
    }

    /// Een blokdefinitie; geeft de handle van het blokrecord.
    pub fn block(&mut self, name: &str) -> Handle {
        let mut record = BlockRecord::new(name);
        record.set_handle(self.doc.allocate_handle());
        let handle = record.handle;
        self.doc.block_records.add(record).unwrap();
        handle
    }

    /// Voegt een entiteit toe aan een blok (`Some`) of de modelruimte.
    pub fn add(&mut self, owner: Option<Handle>, mut entity: EntityType) -> Handle {
        if let Some(owner) = owner {
            entity.common_mut().owner_handle = owner;
        }
        self.doc.add_entity(entity).unwrap()
    }

    pub fn line(&mut self, owner: Option<Handle>, layer: &str, color: Color, a: (f64, f64), b: (f64, f64)) -> Handle {
        let mut line = Line::from_points(Vector3::new(a.0, a.1, 0.0), Vector3::new(b.0, b.1, 0.0));
        line.common.layer = layer.to_string();
        line.common.color = color;
        self.add(owner, EntityType::Line(line))
    }

    pub fn insert(&mut self, owner: Option<Handle>, block: &str, layer: &str, color: Color, at: (f64, f64)) -> Handle {
        let mut insert = Insert::new(block, Vector3::new(at.0, at.1, 0.0));
        insert.common.layer = layer.to_string();
        insert.common.color = color;
        self.add(owner, EntityType::Insert(insert))
    }

    pub fn drawing(self) -> Drawing {
        Drawing {
            document: self.doc,
            path: PathBuf::from("test.dxf"),
            is_dxf: true,
            version: "AC1032".into(),
            file_bytes: 0,
            read_ms: 0,
            chunked: false,
        }
    }
}

/// Onthoudt wat er getekend wordt: laag, kleur, omhullende en lijndikte.
#[derive(Default)]
struct Recorder {
    strokes: Vec<(String, style::Rgb, [f64; 4])>,
    widths: Vec<f64>,
    /// Elk knippad dat de wandeling werkelijk aanzet, met zijn padopdrachten.
    clips: Vec<Vec<super::curves::PathOp>>,
    limit: Option<usize>,
}

impl Recorder {
    fn on(&self, layer: &str) -> usize {
        self.strokes.iter().filter(|s| s.0 == layer).count()
    }
}

impl Sink for Recorder {
    fn stroke(&mut self, layer: &str, style: &Stroke, path: &PagePath) {
        self.strokes.push((layer.to_string(), style.color, path.bounds().unwrap_or([0.0; 4])));
        self.widths.push(style.width);
    }
    fn fill(&mut self, _layer: &str, _color: style::Rgb, _alpha: f64, _path: &PagePath, _even_odd: bool) {}
    fn text(&mut self, _layer: &str, _color: style::Rgb, _alpha: f64, _matrix: Matrix, _bytes: &[u8], _font: super::text::FontChoice) {}
    fn push_clip(&mut self, path: &PagePath, _even_odd: bool) {
        self.clips.push(path.ops.clone());
    }
    fn exhausted(&self) -> bool {
        self.limit.is_some_and(|limit| self.strokes.len() >= limit)
    }
}

fn walk_model(drawing: &Drawing, settings: WalkSettings) -> (Recorder, Walker<'_>) {
    let mut walker = Walker::new(&drawing.document, settings, true);
    let mut sink = Recorder::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    (sink, walker)
}

fn excluded(names: &[&str]) -> WalkSettings {
    WalkSettings { excluded_layers: names.iter().map(|n| n.to_uppercase()).collect(), ..Default::default() }
}

fn work_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("open-pdf-cad-unit-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ── Lagen en blokken ─────────────────────────────────────────────────────

#[test]
fn layer_0_in_nested_blocks_follows_the_outer_insert() {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    let inner = t.block("Binnen");
    t.line(Some(inner), "0", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    let outer = t.block("Buiten");
    t.insert(Some(outer), "Binnen", "0", Color::ByLayer, (0.0, 0.0));
    t.insert(None, "Buiten", "Wanden", Color::ByLayer, (100.0, 0.0));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings::default());
    assert_eq!(sink.strokes.len(), 1);
    assert_eq!(sink.strokes[0].0, "Wanden", "laag 0 in een genest blok volgt de buitenste INSERT");
    assert_eq!(sink.strokes[0].1, (255, 0, 0), "kleur ByLayer van laag Wanden (rood)");
    assert_eq!(sink.strokes[0].2[0], 100.0, "invoegpunt verwerkt");
    assert_eq!(walker.stats.blocks_expanded, 2);
}

#[test]
fn byblock_colour_is_inherited_through_nested_blocks() {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    let inner = t.block("Binnen");
    t.line(Some(inner), "0", Color::ByBlock, (0.0, 0.0), (10.0, 0.0));
    let outer = t.block("Buiten");
    t.insert(Some(outer), "Binnen", "0", Color::ByBlock, (0.0, 0.0));
    t.insert(None, "Buiten", "Wanden", Color::Index(3), (0.0, 0.0));
    let drawing = t.drawing();
    let (sink, _) = walk_model(&drawing, WalkSettings::default());
    assert_eq!(sink.strokes[0].1, (0, 255, 0), "ByBlock → kleur van de buitenste INSERT (groen)");
}

#[test]
fn an_excluded_insert_keeps_content_on_its_own_visible_layers() {
    let mut t = TestDoc::new();
    t.layer("Uit", 1, |_| {});
    t.layer("Eigen", 2, |_| {});
    t.layer("Eigen2", 4, |_| {});
    let nested = t.block("Genest");
    t.line(Some(nested), "Eigen2", Color::ByLayer, (0.0, 0.0), (1.0, 0.0));
    t.line(Some(nested), "0", Color::ByLayer, (0.0, 1.0), (1.0, 1.0));
    let block = t.block("Blok");
    t.line(Some(block), "0", Color::ByLayer, (0.0, 0.0), (5.0, 0.0));
    t.line(Some(block), "Eigen", Color::ByLayer, (0.0, 2.0), (5.0, 2.0));
    t.insert(Some(block), "Genest", "0", Color::ByLayer, (0.0, 0.0));
    t.insert(None, "Blok", "Uit", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing();
    let (sink, _) = walk_model(&drawing, excluded(&["Uit"]));
    assert_eq!(sink.on("Eigen"), 1, "eigen laag in het blok blijft zichtbaar");
    assert_eq!(sink.on("Eigen2"), 1, "ook in een geneste INSERT op laag 0");
    assert_eq!(sink.on("Uit"), 0, "laag 0 volgt de uitgezette laag");
    assert_eq!(sink.strokes.len(), 2);
}

#[test]
fn layer_zero_is_recognised_however_the_file_spells_it() {
    assert!(super::walk::is_layer_zero("0"));
    assert!(super::walk::is_layer_zero(" 0 "), "witruimte om de naam telt niet");
    assert!(super::walk::is_layer_zero("0\t"));
    for other in ["", "00", "O", "0|0", "Laag 0", "-0"] {
        assert!(!super::walk::is_layer_zero(other), "{other:?}");
    }
    // Alleen gewone witruimte valt weg. Een harde spatie of een andere
    // Unicode-spatie hoort bij de naam: dat is in CAD een andere laag, en de
    // lagentabel van de import zoekt ook op de volledige naam.
    for other in ["0\u{a0}", "\u{a0}0", "0\u{2003}", "\u{feff}0"] {
        assert!(!super::walk::is_layer_zero(other), "{other:?}");
    }

    // In een blok: inhoud op "0 " volgt de laag van de invoeging, net als "0".
    let mut t = TestDoc::new();
    t.layer("Uit", 1, |_| {});
    t.layer("Aan", 3, |_| {});
    let block = t.block("Blok");
    t.line(Some(block), "0 ", Color::ByLayer, (0.0, 0.0), (5.0, 0.0));
    t.line(Some(block), " 0", Color::ByLayer, (0.0, 1.0), (5.0, 1.0));
    t.insert(None, "Blok", "Uit", Color::ByLayer, (0.0, 0.0));
    t.insert(None, "Blok", "Aan", Color::ByLayer, (0.0, 10.0));
    let drawing = t.drawing();
    let (sink, _) = walk_model(&drawing, excluded(&["Uit"]));
    assert_eq!(sink.on("Aan"), 2, "laag 0 tekent op de laag van de invoeging");
    assert_eq!(sink.strokes.len(), 2, "en verdwijnt met een uitgezette invoeging");
}

#[test]
fn a_frozen_excluded_layer_hides_the_whole_block() {
    let mut t = TestDoc::new();
    t.layer("Bevroren", 1, |l| l.flags.frozen = true);
    t.layer("Eigen", 2, |_| {});
    let block = t.block("Blok");
    t.line(Some(block), "Eigen", Color::ByLayer, (0.0, 0.0), (5.0, 0.0));
    t.insert(None, "Blok", "Bevroren", Color::ByLayer, (0.0, 0.0));
    t.line(None, "Bevroren", Color::ByLayer, (0.0, 0.0), (1.0, 1.0));
    let drawing = t.drawing();
    let (sink, _) = walk_model(&drawing, excluded(&["Bevroren"]));
    assert!(sink.strokes.is_empty(), "bevroren: ook de inhoud op eigen lagen verdwijnt");
    // Staat de laag aan (niet uitgesloten), dan tekent alles.
    let (sink, _) = walk_model(&drawing, WalkSettings::default());
    assert_eq!(sink.strokes.len(), 2);
}

#[test]
fn a_block_that_inserts_itself_stops_at_the_nesting_limit() {
    let mut t = TestDoc::new();
    let a = t.block("A");
    t.line(Some(a), "0", Color::ByLayer, (0.0, 0.0), (1.0, 0.0));
    t.insert(Some(a), "A", "0", Color::ByLayer, (1.0, 0.0));
    t.insert(None, "A", "0", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings::default());
    assert!(walker.stats.deep_nesting > 0);
    assert!(!walker.too_complex);
    assert_eq!(sink.strokes.len(), 24, "één lijn per niveau tot de dieptegrens");
}

#[test]
fn a_block_that_doubles_itself_hits_the_visit_budget() {
    // A voegt zichzelf twee keer in: zonder grens 2^24 keer uitvouwen.
    let mut t = TestDoc::new();
    let a = t.block("A");
    t.line(Some(a), "0", Color::ByLayer, (0.0, 0.0), (1.0, 0.0));
    t.insert(Some(a), "A", "0", Color::ByLayer, (1.0, 0.0));
    t.insert(Some(a), "A", "0", Color::ByLayer, (0.0, 1.0));
    t.insert(None, "A", "0", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing();
    let started = std::time::Instant::now();
    let (_, walker) = walk_model(&drawing, WalkSettings { max_visits: 50_000, ..Default::default() });
    assert!(walker.too_complex, "grens niet bereikt");
    assert!(walker.stats.visits <= 50_001);
    assert!(started.elapsed().as_secs() < 5);
}

#[test]
fn every_minsert_cell_counts_and_can_be_cancelled() {
    let mut t = TestDoc::new();
    t.block("Leeg");
    let mut minsert = Insert::new("Leeg", Vector3::new(0.0, 0.0, 0.0));
    minsert.column_count = u16::MAX;
    minsert.row_count = u16::MAX;
    minsert.column_spacing = 1.0;
    minsert.row_spacing = 1.0;
    t.add(None, EntityType::Insert(minsert));
    let drawing = t.drawing();
    // Werkgrens: een leeg blok in 4 miljard cellen stopt toch.
    let (_, walker) = walk_model(&drawing, WalkSettings { max_visits: 100_000, ..Default::default() });
    assert!(walker.too_complex);
    // Afbreken: de vlag wordt tijdens de cellen gezien.
    let cancel = AtomicBool::new(true);
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    walker.on_cancel(|| cancel.load(Ordering::Relaxed));
    let mut sink = Recorder::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    assert!(walker.cancelled && !walker.too_complex);
    assert!(walker.stats.visits < 10_000, "afbreken duurde {} bezoeken", walker.stats.visits);
}

#[test]
fn a_full_sink_stops_the_walk() {
    let mut t = TestDoc::new();
    for i in 0..100 {
        t.line(None, "0", Color::ByLayer, (i as f64, 0.0), (i as f64, 1.0));
    }
    let drawing = t.drawing();
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = Recorder { limit: Some(10), ..Default::default() };
    walker.model_space(Xform3::IDENTITY, &mut sink);
    assert!(walker.too_complex);
    assert_eq!(sink.strokes.len(), 10);
}

#[test]
fn absurd_arc_angles_do_not_hang_the_walk() {
    use acadrust::entities::{Arc, BoundaryEdge, BoundaryPath, CircularArcEdge, Ellipse, Hatch};
    use acadrust::types::Vector2;
    let mut t = TestDoc::new();
    t.layer("Bogen", 1, |_| {});
    t.layer("Gewoon", 2, |_| {});
    let absurd = [(1e19, 0.0), (0.0, 1e19), (1e17, 1e17), (-1e17, 1e17), (f64::INFINITY, 0.0), (f64::NAN, 1.0)];
    for (start, end) in absurd {
        let mut arc = Arc::from_center_radius_angles(Vector3::new(0.0, 0.0, 0.0), 10.0, start, end);
        arc.common.layer = "Bogen".into();
        t.add(None, EntityType::Arc(arc));
        let mut ellipse = Ellipse::from_center_axes(Vector3::new(50.0, 0.0, 0.0), Vector3::new(10.0, 0.0, 0.0), 0.5);
        ellipse.common.layer = "Bogen".into();
        ellipse.start_parameter = start;
        ellipse.end_parameter = end;
        t.add(None, EntityType::Ellipse(ellipse));
        let mut hatch = Hatch::solid();
        hatch.common.layer = "Bogen".into();
        let mut path = BoundaryPath::default();
        path.edges.push(BoundaryEdge::CircularArc(CircularArcEdge {
            center: Vector2::new(100.0, 0.0),
            radius: 10.0,
            start_angle: start,
            end_angle: end,
            counter_clockwise: false,
        }));
        hatch.paths.push(path);
        t.add(None, EntityType::Hatch(hatch));
    }
    let mut plain = Arc::from_center_radius_angles(Vector3::new(200.0, 0.0, 0.0), 10.0, 0.5, 2.0);
    plain.common.layer = "Gewoon".into();
    t.add(None, EntityType::Arc(plain));
    let drawing = t.drawing();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (sink, walker) = walk_model(&drawing, WalkSettings::default());
        let _ = tx.send((sink.on("Gewoon"), walker.cancelled, walker.stats.entities));
    });
    let (plain_strokes, cancelled, entities) =
        rx.recv_timeout(std::time::Duration::from_secs(30)).expect("de wandeling hangt op een absurde booghoek");
    assert!(!cancelled);
    assert_eq!(entities, 3 * absurd.len() as u64 + 1);
    assert_eq!(plain_strokes, 1, "de gewone boog wordt gewoon getekend");
}

// ── Layouts en viewports ────────────────────────────────────────────────

/// Een blad met twee viewports: links 1:100 met alles, rechts 1:20 met laag
/// "Maten" bevroren.
fn layout_doc() -> Drawing {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    t.layer("Maten", 3, |_| {});
    t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    t.line(None, "Maten", Color::ByLayer, (0.0, 100.0), (1000.0, 100.0));
    let maten = t.doc.layers.get("Maten").unwrap().handle;
    t.doc.add_layout("Blad").unwrap();
    let mut left = Viewport::with_size(Vector3::new(60.0, 60.0, 0.0), 100.0, 100.0);
    left.id = 2;
    left.view_center = Vector3::new(500.0, 50.0, 0.0);
    left.view_height = 10_000.0;
    t.doc.add_entity_to_layout(EntityType::Viewport(left), "Blad").unwrap();
    let mut right = Viewport::with_size(Vector3::new(200.0, 60.0, 0.0), 100.0, 100.0);
    right.id = 3;
    right.view_center = Vector3::new(500.0, 50.0, 0.0);
    right.view_height = 2_000.0;
    right.frozen_layers = vec![maten];
    t.doc.add_entity_to_layout(EntityType::Viewport(right), "Blad").unwrap();
    t.drawing()
}

#[test]
fn a_viewport_in_the_model_space_is_ignored() {
    // Een VIEWPORT die (door een omzetter of een DXF zonder groep 67) in de
    // modelruimte terechtkwam, zou het hele model nog een keer tekenen.
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    let mut stray = Viewport::with_size(Vector3::new(60.0, 60.0, 0.0), 100.0, 100.0);
    stray.id = 2;
    stray.view_center = Vector3::new(500.0, 0.0, 0.0);
    stray.view_height = 10_000.0;
    t.add(None, EntityType::Viewport(stray));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings::default());
    assert_eq!(sink.on("Wanden"), 1, "de lijn staat er één keer");
    assert!(sink.clips.is_empty(), "geen knipvorm van een venster");
    assert_eq!(walker.stats.viewports_drawn, 0);
    assert!(walker.measure_viewports.is_empty());
    // De omhullende van de modelruimte groeit er ook niet door.
    let options = ImportOptions::default();
    let budget = walk::VisitBudget::new(options.max_visits);
    let (sink, _) = space_bounds(&drawing, "model", &options, Externals::default(), &AtomicBool::new(false), &budget).unwrap();
    let bounds = sink.bounds.expect("de lijn heeft een omhullende");
    assert!(bounds[0].abs() < 1.0 && (bounds[2] - 1000.0).abs() < 1.0, "{bounds:?}");
    assert!(bounds[1].abs() < 1.0 && bounds[3].abs() < 1.0, "{bounds:?}");
    assert_eq!(sink.items, 1);
}

#[test]
fn viewport_frozen_layers_are_hidden_only_in_that_viewport() {
    let drawing = layout_doc();
    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = Recorder::default();
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);
    assert_eq!(walker.stats.viewports_drawn, 2);
    assert_eq!(sink.on("Wanden"), 2, "in beide viewports");
    assert_eq!(sink.on("Maten"), 1, "alleen in de viewport waar hij niet bevroren is");
    // Zonder paginamatrix is één "punt" één papier-mm: de verhouding staat er dan direct.
    let ratios: Vec<f64> = walker.measure_viewports.iter().map(|v| v.units_per_point.round()).collect();
    assert_eq!(ratios, vec![100.0, 20.0], "meetschaal per viewport");
}

#[test]
fn each_viewport_of_a_layout_gets_its_own_measure_in_the_pdf() {
    let drawing = layout_doc();
    let dir = work_dir("layout");
    let pdf = dir.join("blad.pdf");
    let options = ImportOptions { spaces: vec!["Blad".into()], ..Default::default() };
    convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    for ratio in ["(1:1)", "(1:100)", "(1:20)"] {
        assert!(raw.contains(ratio), "{ratio} ontbreekt");
    }
}

#[test]
fn the_scan_reports_layer_states_counts_and_viewports() {
    let mut t = TestDoc::new();
    t.layer("Uit", 1, |l| l.flags.off = true);
    t.layer("Bevroren", 2, |l| l.flags.frozen = true);
    t.layer("Vast", 3, |l| l.flags.locked = true);
    t.layer("Hulp", 4, |l| l.is_plottable = false);
    for layer in ["Uit", "Bevroren", "Vast", "Hulp", "Vast"] {
        t.line(None, layer, Color::ByLayer, (0.0, 0.0), (10.0, 10.0));
    }
    let scan = scan_drawing(&t.drawing(), &AtomicBool::new(false)).unwrap();
    let get = |n: &str| scan.layers.iter().find(|l| l.name == n).unwrap().clone();
    assert!(get("Uit").off && get("Bevroren").frozen && get("Vast").locked && !get("Hulp").plottable);
    assert_eq!(get("Vast").objects, 2);
    assert_eq!(get("Uit").color, "#FF0000");
    assert_eq!(scan.default_space, "model");
    assert_eq!(scan.units.unit, "mm");

    let scan = scan_drawing(&layout_doc(), &AtomicBool::new(false)).unwrap();
    let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();
    let ratios: Vec<&str> = blad.viewports.iter().map(|v| v.ratio.as_str()).collect();
    assert_eq!(ratios, vec!["1:100", "1:20"]);
}

#[test]
fn an_empty_model_space_defaults_to_the_layout() {
    let mut t = TestDoc::new();
    t.doc.add_layout("Blad").unwrap();
    for i in 0..10 {
        let mut line = Line::from_points(Vector3::new(i as f64, 0.0, 0.0), Vector3::new(i as f64, 10.0, 0.0));
        line.common.layer = "0".into();
        t.doc.add_entity_to_layout(EntityType::Line(line), "Blad").unwrap();
    }
    let scan = scan_drawing(&t.drawing(), &AtomicBool::new(false)).unwrap();
    assert_eq!(scan.default_space, "Blad");
    assert!(scan.warnings.iter().any(|w| w == "emptyModel"));
}

#[test]
fn units_known_unknown_and_missing() {
    let mut t = TestDoc::new();
    t.line(None, "0", Color::ByLayer, (0.0, 0.0), (1.0, 1.0));
    let mut drawing = t.drawing();
    let cancel = AtomicBool::new(false);
    for (code, unit) in [(7, "km"), (14, "dm"), (10, "yd"), (3, "mi"), (1, "in"), (6, "m")] {
        drawing.document.header.insertion_units = code;
        let scan = scan_drawing(&drawing, &cancel).unwrap();
        assert_eq!(scan.units.unit, unit, "code {code}");
        assert!(scan.units.from_file);
    }
    drawing.document.header.insertion_units = 11; // ångström
    let scan = scan_drawing(&drawing, &cancel).unwrap();
    assert_eq!(scan.warnings[0], "unitsUnsupported:11");
    drawing.document.header.insertion_units = 0;
    let scan = scan_drawing(&drawing, &cancel).unwrap();
    assert_eq!(scan.warnings[0], "units:0");
}

#[test]
fn scan_and_bounds_can_be_cancelled_and_limited() {
    let mut t = TestDoc::new();
    for i in 0..5000 {
        t.line(None, "0", Color::ByLayer, (i as f64, 0.0), (i as f64, 1.0));
    }
    let drawing = t.drawing();
    assert_eq!(scan_drawing(&drawing, &AtomicBool::new(true)).unwrap_err(), ImportError::Cancelled);
    let small = ImportOptions { max_visits: 100, ..Default::default() };
    assert!(matches!(
        space_bounds(&drawing, "model", &small, Externals::default(), &AtomicBool::new(false), &walk::VisitBudget::new(small.max_visits)),
        Err(ImportError::TooComplex)
    ));
    let dir = work_dir("grens");
    let pdf = dir.join("uit.pdf");
    assert_eq!(convert(&drawing, &small, &pdf, &AtomicBool::new(false), |_| {}).unwrap_err(), ImportError::TooComplex);
    let tiny = ImportOptions { max_content_bytes: 1_000, ..Default::default() };
    assert_eq!(convert(&drawing, &tiny, &pdf, &AtomicBool::new(false), |_| {}).unwrap_err(), ImportError::TooComplex);
    assert!(!pdf.exists());
    assert_eq!(ImportError::TooComplex.to_string(), "IMPORT_TOO_COMPLEX");
}

/// Modelruimte en drie bladen met elk `per_space` lijnen.
fn several_spaces(per_space: usize) -> Drawing {
    let mut t = TestDoc::new();
    for i in 0..per_space {
        t.line(None, "0", Color::ByLayer, (i as f64, 0.0), (i as f64, 100.0));
    }
    for name in ["Blad1", "Blad2", "Blad3"] {
        t.doc.add_layout(name).unwrap();
        for i in 0..per_space {
            let mut line = Line::from_points(Vector3::new(i as f64, 0.0, 0.0), Vector3::new(i as f64, 100.0, 0.0));
            line.common.layer = "0".into();
            t.doc.add_entity_to_layout(EntityType::Line(line), name).unwrap();
        }
    }
    t.drawing()
}

#[test]
fn the_visit_budget_covers_the_whole_import_not_each_walk() {
    let drawing = several_spaces(400);
    let dir = work_dir("budget-bezoeken");
    let cancel = AtomicBool::new(false);
    let all: Vec<String> = ["model", "Blad1", "Blad2", "Blad3"].iter().map(|s| s.to_string()).collect();
    // Elke ruimte apart past ruim: grenzen bepalen en tekenen is twee keer
    // ruim 400 bezoeken.
    for (i, space) in all.iter().enumerate() {
        let one = ImportOptions { spaces: vec![space.clone()], max_visits: 1_000, ..Default::default() };
        convert(&drawing, &one, &dir.join(format!("los{i}.pdf")), &cancel, |_| {}).unwrap();
    }
    // Samen gaan ze over het budget van de import, al blijft elke wandeling
    // er zelf onder.
    let together = ImportOptions { spaces: all.clone(), max_visits: 1_000, ..Default::default() };
    let pdf = dir.join("samen.pdf");
    assert_eq!(convert(&drawing, &together, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex);
    assert!(!pdf.exists());
    // Met genoeg budget lukt dezelfde import.
    let enough = ImportOptions { spaces: all, max_visits: 4_000, ..Default::default() };
    assert_eq!(convert(&drawing, &enough, &pdf, &cancel, |_| {}).unwrap().pages.len(), 4);
}

#[test]
fn the_scan_reports_its_progress_per_space() {
    // Modelruimte plus twee bladen: drie ruimtes, dus vier meldingen (0/3 tot
    // en met 3/3), allemaal in de fase "verkennen".
    let drawing = several_spaces(3);
    let seen = std::cell::RefCell::new(Vec::new());
    let scan = super::scan_drawing_with(&drawing, &AtomicBool::new(false), |p| seen.borrow_mut().push(p)).unwrap();
    let seen = seen.into_inner();
    assert!(seen.iter().all(|p| p.phase == ImportPhase::Scan), "{seen:?}");
    let total = scan.spaces.len() as u64;
    assert!(total >= 3);
    let steps: Vec<(u64, u64)> = seen.iter().map(|p| (p.done, p.total)).collect();
    let expected: Vec<(u64, u64)> = (0..=total).map(|done| (done, total)).collect();
    assert_eq!(steps, expected, "per ruimte één stap, met een bekend totaal");
    // Zonder luisteraar geeft de verkenning hetzelfde.
    assert_eq!(scan_drawing(&drawing, &AtomicBool::new(false)).unwrap().spaces.len() as u64, total);
}

#[test]
fn the_scan_shares_one_visit_budget_over_all_spaces() {
    // Vier wandelingen van ruim 400 bezoeken: elk past in 1000, samen niet.
    let drawing = several_spaces(400);
    let cancel = AtomicBool::new(false);
    assert_eq!(scan::scan_within(&drawing, &cancel, 1_000).unwrap_err(), ImportError::TooComplex);
    let found = scan::scan_within(&drawing, &cancel, 2_000).unwrap();
    assert_eq!(found.spaces.iter().filter(|s| s.id.starts_with("Blad")).count(), 3);
    // De verkenning telt entiteiten, geen bezoeken.
    assert_eq!(found.entities, 400);
}

#[test]
fn the_content_limit_covers_all_pages_together() {
    let drawing = several_spaces(400);
    let dir = work_dir("budget-inhoud");
    let cancel = AtomicBool::new(false);
    let all: Vec<String> = ["model", "Blad1", "Blad2", "Blad3"].iter().map(|s| s.to_string()).collect();
    let limit = 20_000;
    for (i, space) in all.iter().enumerate() {
        let one = ImportOptions { spaces: vec![space.clone()], max_content_bytes: limit, ..Default::default() };
        convert(&drawing, &one, &dir.join(format!("los{i}.pdf")), &cancel, |_| {}).unwrap();
    }
    let together = ImportOptions { spaces: all, max_content_bytes: limit, ..Default::default() };
    let pdf = dir.join("samen.pdf");
    assert_eq!(convert(&drawing, &together, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex);
    assert!(!pdf.exists());
}

#[test]
fn the_default_content_limit_is_a_quarter_gigabyte_per_import() {
    assert_eq!(ImportOptions::default().max_content_bytes, 256 * 1024 * 1024);
}

#[test]
fn entities_are_counted_apart_from_visits() {
    // Een MINSERT van 10 × 10 cellen met één lijn in het blok.
    let mut t = TestDoc::new();
    let a = t.block("A");
    t.line(Some(a), "0", Color::ByLayer, (0.0, 0.0), (1.0, 0.0));
    let mut minsert = Insert::new("A", Vector3::new(0.0, 0.0, 0.0));
    minsert.column_count = 10;
    minsert.row_count = 10;
    minsert.column_spacing = 2.0;
    minsert.row_spacing = 2.0;
    t.add(None, EntityType::Insert(minsert));
    t.line(None, "0", Color::ByLayer, (0.0, 0.0), (5.0, 5.0));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings::default());
    assert_eq!(sink.strokes.len(), 101);
    // De invoeging, de losse lijn, en de lijn in elk van de honderd cellen.
    assert_eq!(walker.stats.entities, 102);
    // Bezoeken tellen ook elke cel: daar rekent de werkgrens mee.
    assert_eq!(walker.stats.visits, 202);
}

/// Een LWPOLYLINE met `n` hoekpunten op een rechte lijn.
fn long_polyline(n: usize, layer: &str) -> EntityType {
    use acadrust::entities::{LwPolyline, LwVertex};
    use acadrust::types::Vector2;
    let mut poly = LwPolyline::new();
    poly.common.layer = layer.to_string();
    for i in 0..n {
        poly.vertices.push(LwVertex::new(Vector2::new(i as f64, (i % 2) as f64)));
    }
    EntityType::LwPolyline(poly)
}

/// Bezoeken die één entiteit in de modelruimte kost.
fn visits_of(entity: EntityType) -> u64 {
    let mut t = TestDoc::new();
    t.add(None, entity);
    let drawing = t.drawing();
    let (_, walker) = walk_model(&drawing, WalkSettings::default());
    walker.stats.visits
}

#[test]
fn the_work_inside_an_entity_counts_towards_the_visit_budget() {
    // Een kleine polylijn kost één bezoek, zoals elke entiteit.
    assert_eq!(visits_of(long_polyline(15, "0")), 1);
    // Een lange polylijn kost er één per zestien hoekpunten extra.
    assert_eq!(visits_of(long_polyline(1_600, "0")), 1 + 100);
    // Een fijne patroonarcering kost er één per zestien patroonlijnen.
    use acadrust::entities::{BoundaryPath, Hatch, HatchPatternLine, PolylineEdge};
    use acadrust::types::Vector2;
    let mut lines = Hatch::new();
    lines.is_solid = false;
    let mut path = BoundaryPath::new();
    path.edges.push(acadrust::entities::BoundaryEdge::Polyline(PolylineEdge::new(
        vec![Vector2::new(0.0, 0.0), Vector2::new(100.0, 0.0), Vector2::new(100.0, 100.0), Vector2::new(0.0, 100.0)],
        true,
    )));
    lines.paths.push(path);
    lines.pattern.lines.push(HatchPatternLine {
        angle: 0.0,
        base_point: Vector2::new(0.0, 0.0),
        offset: Vector2::new(0.0, 0.1),
        dash_lengths: Vec::new(),
    });
    // Ruim duizend lijnen over honderd eenheden: tussen 62 en 64 extra.
    let visits = visits_of(EntityType::Hatch(lines));
    assert!((63..=65).contains(&visits), "{visits}");
}

#[test]
fn a_heavy_block_placed_many_times_hits_the_budget_through_its_vertices() {
    // Eén polylijn van 16 000 hoekpunten in een blok dat 100 × 100 keer staat:
    // 20 001 bezoeken als alleen entiteiten tellen, maar 160 miljoen
    // hoekpunten aan werk.
    let mut t = TestDoc::new();
    let block = t.block("ZWAAR");
    t.add(Some(block), long_polyline(16_000, "0"));
    let mut minsert = Insert::new("ZWAAR", Vector3::new(0.0, 0.0, 0.0));
    minsert.column_count = 100;
    minsert.row_count = 100;
    minsert.column_spacing = 20_000.0;
    minsert.row_spacing = 10.0;
    t.add(None, EntityType::Insert(minsert));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings { max_visits: 100_000, reuse_blocks: false, ..Default::default() });
    assert!(walker.too_complex, "{} bezoeken", walker.stats.visits);
    assert!(sink.strokes.len() < 200, "{} cellen getekend", sink.strokes.len());
}

#[test]
fn a_line_to_a_coordinate_the_writer_cannot_hold_is_left_out() {
    // Een uitschieter (0,0)→(1e16,0) begint op de pagina, dus de afnemer wil
    // hem; de schrijver kan 1e16 niet kwijt en zou de lijn naar de oorsprong
    // laten lopen. Zo'n onderdeel valt weg; tot de grens blijft alles.
    let mut t = TestDoc::new();
    t.layer("Uit", 1, |_| {});
    t.layer("Aan", 2, |_| {});
    t.line(None, "Uit", Color::ByLayer, (0.0, 0.0), (1e16, 0.0));
    t.line(None, "Uit", Color::ByLayer, (0.0, 0.0), (0.0, -1e13));
    t.line(None, "Aan", Color::ByLayer, (0.0, 0.0), (super::pdf_writer::MAX_COORD, 0.0));
    let drawing = t.drawing();
    let (sink, walker) = walk_model(&drawing, WalkSettings::default());
    assert_eq!((sink.on("Uit"), sink.on("Aan")), (0, 1));
    assert_eq!(walker.stats.drawn, 1);
}

#[test]
fn cancelling_is_noticed_inside_one_long_polyline() {
    let mut t = TestDoc::new();
    t.add(None, long_polyline(200_000, "0"));
    let drawing = t.drawing();
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    walker.on_cancel(|| true);
    let mut sink = Recorder::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    assert!(walker.cancelled);
    assert!(sink.strokes.is_empty(), "de polylijn is niet meer afgegeven");
}

// ── Omzetting ────────────────────────────────────────────────────────────

fn rectangle_at(x0: f64, y0: f64) -> Drawing {
    let mut t = TestDoc::new();
    t.layer("Wanden", 7, |_| {});
    let pts = [(x0, y0), (x0 + 10_000.0, y0), (x0 + 10_000.0, y0 + 5_000.0), (x0, y0 + 5_000.0)];
    for i in 0..4 {
        t.line(None, "Wanden", Color::ByLayer, pts[i], pts[(i + 1) % 4]);
    }
    t.drawing()
}

fn content_of(pdf: &Path) -> (String, String) {
    let bytes = std::fs::read(pdf).unwrap();
    let raw = String::from_utf8_lossy(&bytes).to_string();
    let mut content = String::new();
    let mut rest = &bytes[..];
    while let Some(start) = rest.windows(6).position(|w| w == b"stream") {
        let body = &rest[start + 7..];
        let end = body.windows(9).position(|w| w == b"endstream").unwrap();
        let mut text = String::new();
        use std::io::Read;
        if flate2::read::ZlibDecoder::new(&body[..end]).read_to_string(&mut text).is_ok() {
            content.push_str(&text);
        }
        rest = &body[end + 9..];
    }
    (raw, content)
}

fn numbers_after(raw: &str, key: &str) -> Vec<f64> {
    let start = raw.find(key).unwrap_or_else(|| panic!("{key} ontbreekt")) + key.len();
    let open = raw[start..].find('[').unwrap() + start + 1;
    let close = raw[open..].find(']').unwrap() + open;
    raw[open..close].split_whitespace().map(|v| v.parse().unwrap()).collect()
}

#[test]
fn national_coordinates_stay_exact_end_to_end() {
    let (x0, y0) = (155_000_000.0, 463_000_000.0);
    let dir = work_dir("landelijk");
    let pdf = dir.join("landelijk.pdf");
    let options = ImportOptions { scale: Some(100.0), placement: Placement::LowerLeft, ..Default::default() };
    let result = convert(&rectangle_at(x0, y0), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let (raw, content) = content_of(&pdf);
    // Op de pagina alleen kleine getallen: de hoek op de marge (10 mm).
    assert!(content.contains("28.346 28.346"), "{}", &content[..content.len().min(300)]);
    assert!(!content.contains("155000"), "landelijke coördinaten in de inhoudsstroom");
    // De verschuiving en de modelmatrix brengen de pagina exact terug.
    let offset = result.pages[0].offset;
    assert!((offset[0] - (x0 - 1000.0)).abs() < 1e-6 && (offset[1] - (y0 - 1000.0)).abs() < 1e-6, "{offset:?}");
    let m = numbers_after(&raw, "/OPS_ModelMatrix");
    let corner = 10.0 * 72.0 / 25.4;
    let (x, y) = (m[0] * corner + m[2] * corner + m[4], m[1] * corner + m[3] * corner + m[5]);
    assert!((x - x0).abs() < 0.01 && (y - y0).abs() < 0.01, "modelmatrix geeft ({x}, {y})");
    // Meetschaal met twaalf cijfers: 35,2777777778 mm per punt.
    assert!(raw.contains("/C 35.2777777778"));
}

#[test]
fn rotation_turns_the_drawing_before_it_is_placed() {
    let dir = work_dir("draaiing");
    let cancel = AtomicBool::new(false);
    let flat = convert(&rectangle_at(0.0, 0.0), &ImportOptions { scale: Some(100.0), ..Default::default() }, &dir.join("a.pdf"), &cancel, |_| {}).unwrap();
    assert!(flat.pages[0].width_mm > flat.pages[0].height_mm, "liggend zonder draaiing");
    let turned = ImportOptions { scale: Some(100.0), rotation_deg: 90.0, ..Default::default() };
    let result = convert(&rectangle_at(0.0, 0.0), &turned, &dir.join("b.pdf"), &cancel, |_| {}).unwrap();
    assert_eq!(result.pages[0].paper, "A4");
    assert!(result.pages[0].height_mm > result.pages[0].width_mm, "staand na 90°");
}

#[test]
fn the_clip_around_the_extents_leaves_room_for_the_line_weight() {
    let corners = [Point::new(0.0, 0.0), Point::new(10.0, 0.0), Point::new(10.0, 5.0), Point::new(0.0, 5.0)];
    let grown = grow_quad(corners, 1.0);
    assert_eq!((grown[0].x, grown[0].y), (-1.0, -1.0));
    assert_eq!((grown[2].x, grown[2].y), (11.0, 6.0));
    // Gedraaid over 90°: de vergroting volgt de eigen assen.
    let turned = [Point::new(0.0, 0.0), Point::new(0.0, 10.0), Point::new(-5.0, 10.0), Point::new(-5.0, 0.0)];
    let grown = grow_quad(turned, 1.0);
    assert!((grown[0].x - 1.0).abs() < 1e-12 && (grown[0].y + 1.0).abs() < 1e-12);
}

/// Kleinste x van het knipvlak: de getallen van het eerste pad vóór `W n`.
fn clip_left_edge(content: &str) -> f64 {
    let end = content.find("W n").expect("geen knipvlak");
    let start = content[..end].rfind("q
").expect("geen q voor het knipvlak");
    content[start..end]
        .split_whitespace()
        .filter_map(|t| t.parse::<f64>().ok())
        .step_by(2)
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn the_clip_grows_with_the_widest_line_that_is_really_drawn() {
    let dir = work_dir("knipvlak");
    let cancel = AtomicBool::new(false);
    let options = ImportOptions { scale: Some(100.0), placement: Placement::LowerLeft, ..Default::default() };
    let margin = 10.0 * PT_PER_MM;
    // Alleen gewone lijnen (0,25 mm): een achtste millimeter erbij, niet de
    // halve dikste lijn die CAD kent.
    let thin = dir.join("dun.pdf");
    convert(&rectangle_at(0.0, 0.0), &options, &thin, &cancel, |_| {}).unwrap();
    let grown = margin - clip_left_edge(&content_of(&thin).1);
    assert!((grown - 0.125 * PT_PER_MM).abs() < 0.01, "dun: {grown} pt");

    // Eén lijn van 2 mm: het knipvlak groeit met 1 mm.
    let mut t = TestDoc::new();
    t.line(None, "0", Color::ByLayer, (0.0, 0.0), (10_000.0, 5_000.0));
    let mut wide = Line::from_points(Vector3::new(0.0, 5_000.0, 0.0), Vector3::new(10_000.0, 0.0, 0.0));
    wide.common.layer = "0".into();
    wide.common.line_weight = acadrust::types::LineWeight::Value(200);
    t.add(None, EntityType::Line(wide));
    let thick = dir.join("dik.pdf");
    convert(&t.drawing(), &options, &thick, &cancel, |_| {}).unwrap();
    let grown = margin - clip_left_edge(&content_of(&thick).1);
    assert!((grown - 1.0 * PT_PER_MM).abs() < 0.01, "dik: {grown} pt");

    // Een laag met een dikke lijn waar niets op staat telt niet mee.
    let mut t = TestDoc::new();
    t.layer("Leeg", 1, |l| l.line_weight = acadrust::types::LineWeight::Value(211));
    t.line(None, "0", Color::ByLayer, (0.0, 0.0), (10_000.0, 5_000.0));
    let unused = dir.join("ongebruikt.pdf");
    convert(&t.drawing(), &options, &unused, &cancel, |_| {}).unwrap();
    let grown = margin - clip_left_edge(&content_of(&unused).1);
    assert!((grown - 0.125 * PT_PER_MM).abs() < 0.01, "ongebruikte laag: {grown} pt");

    // Een vaste lijndikte geldt voor alles.
    let fixed = ImportOptions { lineweight: LineweightMode::Fixed(0.7), ..options.clone() };
    let pdf = dir.join("vast.pdf");
    convert(&rectangle_at(0.0, 0.0), &fixed, &pdf, &cancel, |_| {}).unwrap();
    let grown = margin - clip_left_edge(&content_of(&pdf).1);
    assert!((grown - 0.35 * PT_PER_MM).abs() < 0.01, "vast: {grown} pt");
}

#[test]
fn an_invalid_window_is_an_error_not_a_silent_fallback() {
    let dir = work_dir("venster");
    let cancel = AtomicBool::new(false);
    for rect in [[0.0, 0.0, 0.0, 0.0], [100.0, 100.0, 50.0, 200.0], [0.0, 0.0, f64::NAN, 10.0], [0.0, 0.0, f64::INFINITY, 10.0]] {
        let options = ImportOptions { area: AreaChoice::Window(rect), ..Default::default() };
        let pdf = dir.join("venster.pdf");
        let error = convert(&rectangle_at(0.0, 0.0), &options, &pdf, &cancel, |_| {}).unwrap_err();
        assert_eq!(error.to_string(), "IMPORT_WINDOW_INVALID", "{rect:?}");
        assert!(!pdf.exists());
    }
    // "window" zonder rechthoek is ook geen stil verzoek om de grenzen.
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","outputPath":"a.pdf","area":"window"}"#).unwrap();
    let pdf = dir.join("zonder.pdf");
    let error = convert(&rectangle_at(0.0, 0.0), &args.options(), &pdf, &cancel, |_| {}).unwrap_err();
    assert_eq!(error.to_string(), "IMPORT_WINDOW_INVALID");
    // Een goed venster werkt gewoon.
    let good = ImportOptions { area: AreaChoice::Window([0.0, 0.0, 5_000.0, 2_500.0]), ..Default::default() };
    convert(&rectangle_at(0.0, 0.0), &good, &dir.join("goed.pdf"), &cancel, |_| {}).unwrap();
}

#[test]
fn hidden_layers_without_pdf_layers_are_left_out() {
    let mut t = TestDoc::new();
    t.layer("Hulp", 1, |_| {});
    t.line(None, "0", Color::ByLayer, (0.0, 0.0), (100.0, 100.0));
    t.line(None, "Hulp", Color::ByLayer, (0.0, 100.0), (100.0, 0.0));
    let drawing = t.drawing();
    let dir = work_dir("verborgen");
    let options = ImportOptions { layers_as_ocg: false, hidden_layers: vec!["Hulp".into()], scale: Some(1.0), ..Default::default() };
    let result = convert(&drawing, &options, &dir.join("plat.pdf"), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.pages[0].objects, 1, "de verborgen laag kan zonder OCG niet verborgen meekomen");
}

#[test]
fn an_existing_output_is_never_replaced_silently() {
    let dir = work_dir("bestaat");
    let pdf = dir.join("bestaat.pdf");
    std::fs::write(&pdf, b"van de gebruiker").unwrap();
    let error = convert(&rectangle_at(0.0, 0.0), &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap_err();
    // Een eigen code met het pad, zodat de app het in de taal van de gebruiker
    // kan zeggen.
    assert_eq!(error.to_string(), format!("IMPORT_EXISTS:{}", pdf.display()));
    assert_eq!(std::fs::read(&pdf).unwrap(), b"van de gebruiker");
    let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.path().extension().is_some_and(|x| x == "deel")).collect();
    assert!(leftovers.is_empty());
}

#[test]
fn progress_reports_scan_draw_and_write() {
    let mut t = TestDoc::new();
    for i in 0..5000 {
        t.line(None, "0", Color::ByLayer, (i as f64, 0.0), (i as f64, 1.0));
    }
    let dir = work_dir("voortgang");
    let mut phases = Vec::new();
    convert(&t.drawing(), &ImportOptions::default(), &dir.join("v.pdf"), &AtomicBool::new(false), |p| phases.push(p)).unwrap();
    let draw: Vec<_> = phases.iter().filter(|p| p.phase == ImportPhase::Draw).collect();
    assert!(draw.len() >= 3, "tekenen meldt voortgang: {draw:?}");
    assert!(draw.windows(2).all(|w| w[0].done <= w[1].done));
    assert_eq!(draw.last().map(|p| p.done == p.total), Some(true));
    assert!(phases.iter().any(|p| p.phase == ImportPhase::Write && p.done == p.total && p.total == 1));
}

#[test]
fn cancelling_while_writing_leaves_no_file() {
    // Afbreken zodra het schrijven begint.
    let dir = work_dir("schrijven");
    let pdf = dir.join("s.pdf");
    let cancel = AtomicBool::new(false);
    let error = convert(&rectangle_at(0.0, 0.0), &ImportOptions::default(), &pdf, &cancel, |p| {
        if p.phase == ImportPhase::Write {
            cancel.store(true, Ordering::Relaxed);
        }
    })
    .unwrap_err();
    assert_eq!(error, ImportError::Cancelled);
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "geen pdf en geen deelbestand");
}

// ── Kwaadwillige en kapotte invoer ──────────────────────────────────────

#[test]
fn malformed_headers_never_panic() {
    let dir = work_dir("kapot");
    let cancel = AtomicBool::new(false);
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("ac10-ff", b"AC10\xFF\xFE\x00\x01rest".to_vec()),
        ("ac10-utf8", "AC10é€ geen dwg".as_bytes().to_vec()),
        ("kort", b"AC1".to_vec()),
        ("leeg", Vec::new()),
        ("oud", b"AC1009\x00\x00\x00\x00".to_vec()),
        ("ruis", (0..4096u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect()),
    ];
    for (name, bytes) in cases {
        let path = dir.join(format!("{name}.dwg"));
        std::fs::write(&path, &bytes).unwrap();
        let result = std::panic::catch_unwind(|| read(&path, &cancel, |_| {}).map(|_| ()));
        let outcome = result.unwrap_or_else(|_| panic!("{name}: paniek"));
        assert!(outcome.is_err(), "{name}: kapot bestand gelezen");
    }
    assert!(matches!(
        read(&dir.join("oud.dwg"), &cancel, |_| {}),
        Err(ImportError::TooOld(v)) if v == "AC1009"
    ));
}

#[test]
fn version_detection_works_on_bytes() {
    assert_eq!(detect_version(b"AC1032\x00\x00"), Some("AC1032".into()));
    assert_eq!(detect_version(b"AC10\xFF\xFE"), None);
    assert_eq!(detect_version(b"AC10"), None);
    assert_eq!(detect_version(b"  0\nSECTION"), None);
}

#[test]
fn a_large_text_dxf_is_read_in_chunks_with_the_same_result() {
    let dir = work_dir("stukken");
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    for i in 0..(dxf_chunks::DEFAULT_CHUNK * 3) {
        t.line(None, if i % 2 == 0 { "Wanden" } else { "0" }, Color::ByLayer, (i as f64, 0.0), (i as f64, 10.0));
    }
    let path = dir.join("groot.dxf");
    acadrust::DxfWriter::new(&t.doc).write_to_file(&path).unwrap();
    let cancel = AtomicBool::new(false);
    let chunked = read(&path, &cancel, |_| {}).unwrap();
    assert!(chunked.chunked, "niet in stukken gelezen");
    let whole = acadrust::DxfReader::from_file(&path).unwrap().read().unwrap();
    assert_eq!(dxf_chunks::type_counts(&chunked.document), dxf_chunks::type_counts(&whole));
    let scan = scan_drawing(&chunked, &cancel).unwrap();
    let wanden = scan.layers.iter().find(|l| l.name == "Wanden").unwrap();
    assert_eq!(wanden.objects, (dxf_chunks::DEFAULT_CHUNK * 3 / 2) as u64);
}

// ── Viewports: één beoordeling voor verkenning en wandeling ─────────────

use super::viewport::{classify, clip_corners, ViewportUse};
use acadrust::entities::{LwPolyline, LwVertex};
use acadrust::types::Vector2;

/// Een viewport zoals een blad hem draagt: het venster kijkt naar zichzelf.
fn sheet_viewport() -> Viewport {
    let mut v = Viewport::with_size(Vector3::new(150.0, 100.0, 0.0), 300.0, 200.0);
    v.id = 0;
    v.view_center = Vector3::new(150.0, 100.0, 0.0);
    v.view_target = Vector3::new(0.0, 0.0, 0.0);
    v.view_height = 200.0;
    v
}

/// Een detailvenster op 1:1 zoals DWG het schrijft: de verschuiving zit in
/// `view_target`, `view_center` blijft (0,0).
fn detail_viewport() -> Viewport {
    let mut v = Viewport::with_size(Vector3::new(60.0, 40.0, 0.0), 50.0, 30.0);
    v.id = 0;
    v.view_center = Vector3::new(0.0, 0.0, 0.0);
    v.view_target = Vector3::new(627_508.0, -22_509.0, 0.0);
    v.view_height = 30.0;
    v
}

#[test]
fn a_detail_viewport_at_one_to_one_is_not_mistaken_for_the_sheet() {
    assert!(matches!(classify(&sheet_viewport(), true, &[]), ViewportUse::Sheet));
    assert!(matches!(classify(&sheet_viewport(), false, &[]), ViewportUse::Sheet));
    match classify(&detail_viewport(), false, &[]) {
        ViewportUse::Draw(view) => {
            assert!((view.scale - 1.0).abs() < 1e-9);
            let p = view.model_to_paper.point([627_508.0, -22_509.0, 0.0]);
            assert!((p.x - 60.0).abs() < 1e-6 && (p.y - 40.0).abs() < 1e-6, "het doel komt in het midden");
        }
        other => panic!("detailvenster valt weg: {other:?}"),
    }
    assert!(matches!(classify(&detail_viewport(), true, &[]), ViewportUse::Draw(_)));
}

#[test]
fn a_viewport_that_is_off_or_degenerate_or_not_a_plan_view_is_named() {
    let mut off = detail_viewport();
    off.status.is_on = false;
    assert!(matches!(classify(&off, false, &[]), ViewportUse::Hidden));

    let mut flat = detail_viewport();
    flat.view_height = 0.0;
    assert!(matches!(classify(&flat, false, &[]), ViewportUse::Degenerate));

    let mut iso = detail_viewport();
    iso.view_direction = Vector3::new(-1.0, -1.0, 1.0);
    assert!(matches!(classify(&iso, false, &[]), ViewportUse::NotPlan));

    let mut numbered = detail_viewport();
    numbered.id = 1;
    assert!(matches!(classify(&numbered, false, &[]), ViewportUse::Sheet), "in DXF draagt het blad nummer 1");
}

#[test]
fn the_scan_and_the_drawing_report_the_same_number_of_viewports() {
    let drawing = layout_doc();
    let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
    let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();

    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = Recorder::default();
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);

    assert_eq!(blad.viewports.len() as u64, walker.stats.viewports_drawn);
    assert_eq!(walker.measure_viewports.len(), blad.viewports.len());
}

/// `add_layout` zet zelf een bladviewport met nummer 1 neer, zoals DXF dat
/// doet. In DWG heeft geen enkele viewport een nummer: haal die eerste weg.
fn drop_numbered_sheet(t: &mut TestDoc, layout: &str) {
    let record = scan::space_record(&t.doc, layout).unwrap().record;
    let numbered: Vec<Handle> = t
        .doc
        .block_records
        .get(&record)
        .unwrap()
        .entity_handles
        .iter()
        .copied()
        .filter(|h| matches!(t.doc.get_entity(*h), Some(EntityType::Viewport(v)) if v.id == 1))
        .collect();
    t.doc.block_records.get_mut(&record).unwrap().entity_handles.retain(|h| !numbered.contains(h));
}

/// Een blad op (0,0) dat alleen aan zijn plaats in de lijst te herkennen is,
/// met daarachter één echt venster op schaal. Geeft de handles van het blad
/// en het venster.
fn sheet_then_window(sheet_layer: &str) -> (TestDoc, Handle, Handle) {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    t.layer("Kader", 2, |_| {});
    t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    t.doc.add_layout("Blad").unwrap();
    drop_numbered_sheet(&mut t, "Blad");
    let mut sheet = Viewport::with_size(Vector3::new(0.0, 0.0, 0.0), 420.0, 297.0);
    sheet.id = 0;
    sheet.common.layer = sheet_layer.into();
    sheet.view_center = Vector3::new(128.5, 97.5, 0.0);
    sheet.view_height = 297.0;
    let sheet = t.doc.add_entity_to_layout(EntityType::Viewport(sheet), "Blad").unwrap();
    let mut window = Viewport::with_size(Vector3::new(100.0, 100.0, 0.0), 100.0, 100.0);
    window.id = 0;
    window.view_center = Vector3::new(500.0, 50.0, 0.0);
    window.view_height = 10_000.0;
    let window = t.doc.add_entity_to_layout(EntityType::Viewport(window), "Blad").unwrap();
    (t, sheet, window)
}

fn scanned_and_drawn(drawing: &Drawing, settings: WalkSettings) -> (usize, Vec<[f64; 4]>) {
    let scan = scan_drawing(drawing, &AtomicBool::new(false)).unwrap();
    let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();
    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, settings, true);
    let mut sink = Recorder::default();
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);
    assert_eq!(walker.stats.viewports_drawn as usize, walker.measure_viewports.len());
    (blad.viewports.len(), walker.measure_viewports.iter().map(|v| v.bbox).collect())
}

#[test]
fn a_draw_order_table_does_not_change_which_viewport_is_the_sheet() {
    let (mut t, sheet, window) = sheet_then_window("0");
    // De tekenvolgorde zet het venster vóór het blad.
    let record = scan::space_record(&t.doc, "Blad").unwrap().record;
    let owner = t.doc.block_records.get(&record).unwrap().handle;
    let mut table = acadrust::objects::SortEntitiesTable::for_block(owner);
    table.handle = t.doc.allocate_handle();
    table.add_entry(window, Handle::new(1));
    table.add_entry(sheet, Handle::new(0xFFFF_FFFF));
    t.doc.objects.insert(table.handle, acadrust::objects::ObjectType::SortEntitiesTable(table));
    let drawing = t.drawing();

    let (scanned, drawn) = scanned_and_drawn(&drawing, WalkSettings::default());
    assert_eq!(scanned, 1, "de verkenning ziet één venster");
    assert_eq!(drawn, vec![[50.0, 50.0, 150.0, 150.0]], "alleen het venster, niet het blad");
}

#[test]
fn a_sheet_viewport_on_an_excluded_layer_is_still_the_first() {
    // Het venster heeft dezelfde vorm als een blad op (0,0): ware grootte,
    // geen doel. Alleen zijn plaats (niet de eerste) maakt het een venster.
    let (mut t, _, window) = sheet_then_window("Kader");
    if let Some(EntityType::Viewport(v)) = t.doc.get_entity_mut(window) {
        v.center = Vector3::new(0.0, 0.0, 0.0);
        v.view_height = 100.0;
    }
    let drawing = t.drawing();
    let (scanned, drawn) = scanned_and_drawn(&drawing, excluded(&["Kader"]));
    assert_eq!(scanned, 1);
    assert_eq!(drawn.len(), 1, "het venster schuift niet op naar de plaats van het blad");
    assert_eq!(drawn[0], [-50.0, -50.0, 50.0, 50.0]);
}

#[test]
fn the_layer_of_a_viewport_only_hides_its_frame() {
    // Zoals in CAD: de laag van een VIEWPORT is de laag van zijn kader. Staat
    // die laag uit, is ze bevroren, wordt ze niet geplot of vinkt de gebruiker
    // haar uit, dan verdwijnt alleen het kader (dat de import toch nooit
    // tekent); wat het venster toont blijft staan en wordt geplot. De inhoud
    // volgt alleen de lagen van de modelentiteiten en de lagen die in het
    // venster zelf bevroren zijn. Een venster bewust weglaten kan dus niet via
    // zijn laag. Gemeld is getekend, bij elke laagkeuze.
    let cases: [(&str, fn(&mut Layer)); 5] = [
        ("door de gebruiker uitgevinkt", |_| {}),
        ("niet plotbaar", |l| l.is_plottable = false),
        ("bevroren", |l| l.flags.frozen = true),
        ("uit", |l| l.flags.off = true),
        ("uit en niet plotbaar", |l| {
            l.flags.off = true;
            l.is_plottable = false;
        }),
    ];
    for (what, edit) in cases {
        let mut t = TestDoc::new();
        t.layer("Wanden", 1, |_| {});
        t.layer("Vensters", 2, edit);
        t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
        t.doc.add_layout("Blad").unwrap();
        for (x, layer) in [(60.0, "Vensters"), (200.0, "Vensters"), (340.0, "0")] {
            let mut v = Viewport::with_size(Vector3::new(x, 60.0, 0.0), 100.0, 100.0);
            v.id = 2;
            v.common.layer = layer.into();
            v.view_center = Vector3::new(500.0, 50.0, 0.0);
            v.view_height = 10_000.0;
            t.doc.add_entity_to_layout(EntityType::Viewport(v), "Blad").unwrap();
        }
        let drawing = t.drawing();
        let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
        let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();
        assert_eq!(blad.viewports.len(), 3, "{what}: de verkenning noemt ze alle drie");
        assert_eq!(blad.viewports.iter().filter(|v| v.layer == "Vensters").count(), 2, "{what}: met de laag van het kader erbij");

        let draw = |names: &[&str]| {
            let record = scan::space_record(&drawing.document, "Blad").expect("layout");
            let mut walker = Walker::new(&drawing.document, excluded(names), true);
            let mut sink = Recorder::default();
            walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);
            assert_eq!(walker.stats.viewports_drawn as usize, blad.viewports.len(), "{what}: gemeld is getekend, met laagkeuze {names:?}");
            assert_eq!(walker.measure_viewports.len(), blad.viewports.len(), "{what}");
            sink.on("Wanden")
        };
        // De laag doet mee, de laag is weggelaten: alle drie de vensters.
        assert_eq!(draw(&[]), 3, "{what}");
        assert_eq!(draw(&["Vensters"]), 3, "{what}: de inhoud van de vensters staat er");
        // Een laag van het model weglaten werkt in een venster gewoon.
        assert_eq!(draw(&["Vensters", "Wanden"]), 0, "{what}: de inhoud volgt de lagen van het model");
    }
}

// Een blad met één venster van 100 x 100 op (60, 60), schaal 1:100, geknipt
/// op `boundary`. Geeft de tekening en het venster.
fn clipped_layout(boundary: EntityType) -> (Drawing, Viewport) {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    t.doc.add_layout("Blad").unwrap();
    let clip = t.doc.add_entity_to_layout(boundary, "Blad").unwrap();
    let mut v = Viewport::with_size(Vector3::new(60.0, 60.0, 0.0), 100.0, 100.0);
    v.id = 2;
    v.view_center = Vector3::new(500.0, 50.0, 0.0);
    v.view_height = 10_000.0;
    v.clip_boundary_handle = clip;
    t.doc.add_entity_to_layout(EntityType::Viewport(v.clone()), "Blad").unwrap();
    (t.drawing(), v)
}

fn lw_boundary(points: &[(f64, f64, f64)]) -> EntityType {
    let mut boundary = LwPolyline::new();
    boundary.is_closed = true;
    for (x, y, bulge) in points {
        boundary.vertices.push(LwVertex {
            location: Vector2::new(*x, *y),
            bulge: *bulge,
            start_width: 0.0,
            end_width: 0.0,
            vertex_id: 0,
        });
    }
    EntityType::LwPolyline(boundary)
}

/// De knippaden die de wandeling van het blad werkelijk aanzet, als punten.
fn emitted_clips(drawing: &Drawing) -> (Vec<Vec<(f64, f64)>>, Walker<'_>) {
    use super::curves::PathOp;
    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = Recorder::default();
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);
    let clips = sink
        .clips
        .iter()
        .map(|ops| {
            assert!(matches!(ops.last(), Some(PathOp::Close)), "een knippad is gesloten");
            ops.iter()
                .filter_map(|op| match op {
                    PathOp::Move(p) | PathOp::Line(p) => Some((p.x, p.y)),
                    PathOp::Cubic(..) => panic!("een knipgrens is een veelhoek"),
                    PathOp::Close => None,
                })
                .collect()
        })
        .collect();
    (clips, walker)
}

#[test]
fn a_non_rectangular_viewport_is_clipped_on_its_own_boundary() {
    let (drawing, v) = clipped_layout(lw_boundary(&[(10.0, 10.0, 0.0), (110.0, 10.0, 0.0), (10.0, 110.0, 0.0)]));
    assert_eq!(clip_corners(&drawing.document, &v).len(), 3, "de driehoek, niet de rechthoek");
    match classify(&v, false, &[]) {
        ViewportUse::Draw(view) => assert_eq!(view.corners.len(), 4, "zonder document is het de rechthoek"),
        other => panic!("{other:?}"),
    }
    // Wat de wandeling werkelijk aanzet is de driehoek, niet de rechthoek.
    let (clips, walker) = emitted_clips(&drawing);
    assert_eq!(clips, vec![vec![(10.0, 10.0), (110.0, 10.0), (10.0, 110.0)]]);
    // Het meetgebied is de omhullende; de vorm zelf gaat mee.
    assert_eq!(walker.measure_viewports.len(), 1);
    assert_eq!(walker.measure_viewports[0].bbox, [10.0, 10.0, 110.0, 110.0]);
    assert_eq!(walker.measure_viewports[0].outline.len(), 3);
}

#[test]
fn an_own_boundary_never_shows_more_than_the_rectangle_of_the_viewport() {
    // Het venster staat op (60, 60) en meet 100 x 100: de rechthoek 10..110.
    // Een eigen grens die daarbuiten steekt, wordt op de rechthoek afgesneden:
    // anders zou een bestand met een grens over het hele blad het model over
    // het blad heen laten tekenen.
    let (drawing, v) = clipped_layout(lw_boundary(&[(-500.0, -500.0, 0.0), (700.0, -500.0, 0.0), (700.0, 60.0, 0.0), (-500.0, 60.0, 0.0)]));
    let corners = clip_corners(&drawing.document, &v);
    assert!(!corners.is_empty());
    for (x, y) in &corners {
        assert!((10.0 - 1e-3..=110.0 + 1e-3).contains(x) && (10.0 - 1e-3..=60.0 + 1e-3).contains(y), "({x}, {y})");
    }
    let (_, walker) = emitted_clips(&drawing);
    let bbox = walker.measure_viewports[0].bbox;
    assert!((bbox[0] - 10.0).abs() < 1e-3 && (bbox[1] - 10.0).abs() < 1e-3 && (bbox[2] - 110.0).abs() < 1e-3 && (bbox[3] - 60.0).abs() < 1e-3, "{bbox:?}");

    // Een grens die binnen de rechthoek ligt, blijft punt voor punt wat ze was.
    let (drawing, v) = clipped_layout(lw_boundary(&[(10.0, 10.0, 0.0), (110.0, 10.0, 0.0), (10.0, 110.0, 0.0)]));
    assert_eq!(clip_corners(&drawing.document, &v), vec![(10.0, 10.0), (110.0, 10.0), (10.0, 110.0)]);

    // Een grens die de rechthoek nergens raakt, is geen grens: de rechthoek.
    let (drawing, v) = clipped_layout(lw_boundary(&[(500.0, 500.0, 0.0), (600.0, 500.0, 0.0), (500.0, 600.0, 0.0)]));
    assert!(clip_corners(&drawing.document, &v).is_empty());
    let (clips, _) = emitted_clips(&drawing);
    assert_eq!(clips, vec![vec![(10.0, 10.0), (110.0, 10.0), (110.0, 110.0), (10.0, 110.0)]]);
}

#[test]
fn the_shape_of_a_clipped_viewport_goes_into_the_pdf_for_measuring() {
    let (drawing, _) = clipped_layout(lw_boundary(&[(10.0, 10.0, 0.0), (110.0, 10.0, 0.0), (10.0, 110.0, 0.0)]));
    let dir = work_dir("knipvorm");
    let pdf = dir.join("driehoek.pdf");
    let options = ImportOptions { spaces: vec!["Blad".into()], ..Default::default() };
    convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert_eq!(raw.matches("/OPS_Clip").count(), 1, "alleen het geknipte venster draagt zijn vorm");
    let numbers = numbers_after(&raw, "/OPS_Clip");
    assert_eq!(numbers.len(), 6, "drie hoekpunten: {numbers:?}");
    // De vorm ligt binnen de omhullende van hetzelfde venster.
    let at = raw.find("/OPS_Clip").unwrap();
    let bbox = numbers_after(&raw[raw[..at].rfind("/BBox").unwrap()..], "/BBox");
    for point in numbers.chunks(2) {
        assert!(point[0] >= bbox[0] - 1e-6 && point[0] <= bbox[2] + 1e-6 && point[1] >= bbox[1] - 1e-6 && point[1] <= bbox[3] + 1e-6);
    }

    // Een eigen grens die zelf een rechthoek langs de assen is, ook.
    let (drawing, _) = clipped_layout(lw_boundary(&[(20.0, 20.0, 0.0), (100.0, 20.0, 0.0), (100.0, 90.0, 0.0), (20.0, 90.0, 0.0)]));
    let (clips, walker) = emitted_clips(&drawing);
    assert_eq!(clips[0], vec![(20.0, 20.0), (100.0, 20.0), (100.0, 90.0), (20.0, 90.0)], "geknipt op de eigen grens");
    assert!(walker.measure_viewports[0].outline.is_empty(), "maar de omhullende zegt al alles");

    // Een rechthoekig venster heeft genoeg aan zijn omhullende.
    let pdf = dir.join("rechthoek.pdf");
    convert(&layout_doc(), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(!raw.contains("/OPS_Clip"));
}

#[test]
fn a_rectangular_viewport_is_clipped_on_its_rectangle() {
    let drawing = layout_doc();
    let (clips, walker) = emitted_clips(&drawing);
    assert_eq!(clips.len(), 2);
    assert_eq!(clips[0], vec![(10.0, 10.0), (110.0, 10.0), (110.0, 110.0), (10.0, 110.0)]);
    assert!(walker.measure_viewports.iter().all(|v| v.outline.is_empty()), "een rechthoek heeft geen eigen vorm nodig");
}

#[test]
fn bulges_in_a_clip_boundary_are_unrolled_into_the_emitted_path() {
    // Een rechthoek waarvan de bovenkant een halve cirkel is (straal 50).
    let (drawing, _) = clipped_layout(lw_boundary(&[(10.0, 10.0, 0.0), (110.0, 10.0, 0.0), (110.0, 60.0, 1.0), (10.0, 60.0, 0.0)]));
    let (clips, _) = emitted_clips(&drawing);
    assert_eq!(clips.len(), 1);
    let clip = &clips[0];
    assert!(clip.len() > 20, "de boog is uitgerold, niet recht afgesneden: {} punten", clip.len());
    let top = clip.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    assert!((top - 110.0).abs() < 0.02, "de top van de boog ligt op 60 + 50: {top}");
    for (x, y) in clip.iter().filter(|p| p.1 > 60.0 + 1e-9) {
        let r = (x - 60.0).hypot(y - 60.0);
        assert!((r - 50.0).abs() < 1e-9, "({x}; {y}) ligt niet op de boog");
    }
}

#[test]
fn a_circle_and_an_ellipse_clip_a_viewport() {
    use acadrust::entities::{Circle, Ellipse};
    let circle = Circle::from_center_radius(Vector3::new(60.0, 60.0, 0.0), 40.0);
    let (drawing, _) = clipped_layout(EntityType::Circle(circle));
    let (clips, walker) = emitted_clips(&drawing);
    assert_eq!(clips.len(), 1);
    assert!(clips[0].len() >= 32, "{} punten", clips[0].len());
    for (x, y) in &clips[0] {
        assert!(((x - 60.0).hypot(y - 60.0) - 40.0).abs() < 1e-9);
    }
    // Koorde binnen de tolerantie: een tienduizendste van de viewportmaat.
    let (a, b) = (clips[0][0], clips[0][1]);
    let sagitta = 40.0 - ((a.0 + b.0) / 2.0 - 60.0).hypot((a.1 + b.1) / 2.0 - 60.0);
    assert!(sagitta <= 0.01 + 1e-9, "pijlhoogte {sagitta}");
    let b = walker.measure_viewports[0].bbox;
    assert!((b[0] - 20.0).abs() < 0.02 && (b[2] - 100.0).abs() < 0.02, "{b:?}");

    let ellipse = Ellipse::from_center_axes(Vector3::new(60.0, 60.0, 0.0), Vector3::new(40.0, 0.0, 0.0), 0.5);
    let (drawing, _) = clipped_layout(EntityType::Ellipse(ellipse));
    let (clips, _) = emitted_clips(&drawing);
    assert_eq!(clips.len(), 1);
    for (x, y) in &clips[0] {
        let value = ((x - 60.0) / 40.0).powi(2) + ((y - 60.0) / 20.0).powi(2);
        assert!((value - 1.0).abs() < 1e-9, "({x}; {y}) ligt niet op de ellips");
    }

    // Een halve ellips is geen gesloten grens: dan de rechthoek.
    let mut half = Ellipse::from_center_axes(Vector3::new(60.0, 60.0, 0.0), Vector3::new(40.0, 0.0, 0.0), 0.5);
    half.start_parameter = 0.0;
    half.end_parameter = std::f64::consts::PI;
    let (drawing, _) = clipped_layout(EntityType::Ellipse(half));
    let (clips, _) = emitted_clips(&drawing);
    assert_eq!(clips[0].len(), 4);
}

#[test]
fn a_twisted_viewport_draws_the_model_turned_on_the_sheet() {
    // Een liggende lijn van 1000 in het model, in een venster op 1:10 dat een
    // kwartslag gedraaid is: op het blad staat de lijn rechtop, 100 hoog.
    for (is_dxf, twist) in [(true, 90.0), (false, std::f64::consts::FRAC_PI_2)] {
        let mut t = TestDoc::new();
        t.layer("Wanden", 1, |_| {});
        t.line(None, "Wanden", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
        t.doc.add_layout("Blad").unwrap();
        let mut v = Viewport::with_size(Vector3::new(200.0, 150.0, 0.0), 300.0, 300.0);
        v.id = 2;
        v.view_target = Vector3::new(500.0, 0.0, 0.0);
        v.view_center = Vector3::new(0.0, 0.0, 0.0);
        v.view_height = 3_000.0;
        v.twist_angle = twist;
        t.doc.add_entity_to_layout(EntityType::Viewport(v), "Blad").unwrap();
        let drawing = t.drawing();
        let record = scan::space_record(&drawing.document, "Blad").expect("layout");
        let mut walker = Walker::new(&drawing.document, WalkSettings::default(), is_dxf);
        let mut sink = Recorder::default();
        walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);
        assert_eq!(sink.strokes.len(), 1);
        let b = sink.strokes[0].2;
        assert!((b[0] - 200.0).abs() < 1e-9 && (b[2] - 200.0).abs() < 1e-9, "rechtop door het midden: {b:?}");
        assert!((b[1] - 100.0).abs() < 1e-9 && (b[3] - 200.0).abs() < 1e-9, "100 hoog om het doel: {b:?}");
    }
}

/// Zet de papiermaat van een layout (mm, liggend A3 met de oorsprong linksonder).
fn paper_a3(t: &mut TestDoc, layout: &str) {
    for object in t.doc.objects.values_mut() {
        if let acadrust::objects::ObjectType::Layout(l) = object {
            if l.name == layout {
                l.paper_width = 420.0;
                l.paper_height = 297.0;
                l.plot_paper_units = 1;
                l.plot_rotation = 0;
            }
        }
    }
}

#[test]
fn a_first_viewport_over_the_whole_page_is_the_sheet_and_a_later_one_is_reported() {
    let (mut t, sheet, _) = sheet_then_window("0");
    paper_a3(&mut t, "Blad");
    // Het blad beslaat het papier maar staat niet op ware grootte en niet op
    // de oorsprong: geen van de bekende vormen, alleen het vangnet.
    if let Some(EntityType::Viewport(v)) = t.doc.get_entity_mut(sheet) {
        v.center = Vector3::new(210.0, 148.5, 0.0);
        v.width = 430.0;
        v.height = 300.0;
        v.view_center = Vector3::new(95.0, 60.0, 0.0);
        v.view_height = 120.0;
    }
    let drawing = t.drawing();
    let (scanned, drawn) = scanned_and_drawn(&drawing, WalkSettings::default());
    assert_eq!(scanned, 1);
    assert_eq!(drawn, vec![[50.0, 50.0, 150.0, 150.0]], "het blad wordt niet als venster getekend");
    let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
    assert!(!scan.warnings.iter().any(|w| w.starts_with("viewportCoversPage")), "{:?}", scan.warnings);
    // Het vangnet is een gok op grond van de bedekking: dat wordt gemeld, in
    // de verkenning en in de omzetting, zodat een venster dat zo wegvalt niet
    // stil wegvalt.
    assert!(scan.warnings.iter().any(|w| w == "sheetByCoverage:1"), "{:?}", scan.warnings);
    let dir = work_dir("vangnet");
    let options = ImportOptions { spaces: vec!["Blad".into()], ..Default::default() };
    let result = convert(&drawing, &options, &dir.join("blad.pdf"), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.warnings.iter().any(|w| w == "sheetByCoverage:1"), "{:?}", result.warnings);
    // Een blad dat aan zijn vorm herkend wordt, is geen gok en geeft geen melding.
    let (plain, _, _) = sheet_then_window("0");
    let plain = scan_drawing(&plain.drawing(), &AtomicBool::new(false)).unwrap();
    assert!(!plain.warnings.iter().any(|w| w.starts_with("sheetByCoverage")), "{:?}", plain.warnings);

    // Een later venster over het hele blad wordt getekend, met een melding,
    // in de verkenning en in de omzetting.
    let (mut t, _, _) = sheet_then_window("0");
    paper_a3(&mut t, "Blad");
    let mut wide = Viewport::with_size(Vector3::new(210.0, 148.5, 0.0), 410.0, 290.0);
    wide.id = 0;
    wide.view_center = Vector3::new(500.0, 50.0, 0.0);
    wide.view_height = 29_000.0;
    t.doc.add_entity_to_layout(EntityType::Viewport(wide), "Blad").unwrap();
    let drawing = t.drawing();
    let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
    assert!(scan.warnings.iter().any(|w| w == "viewportCoversPage:1"), "{:?}", scan.warnings);
    let dir = work_dir("heel-blad");
    let pdf = dir.join("blad.pdf");
    let options = ImportOptions { spaces: vec!["Blad".into()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.viewports_drawn, 2);
    assert!(result.warnings.iter().any(|w| w == "viewportCoversPage:1"), "{:?}", result.warnings);
}

#[test]
fn the_scan_reports_three_dimensional_viewports_before_the_import() {
    let (mut t, _, window) = sheet_then_window("0");
    if let Some(EntityType::Viewport(v)) = t.doc.get_entity_mut(window) {
        v.view_direction = Vector3::new(-1.0, -1.0, 1.0);
    }
    let drawing = t.drawing();
    let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
    let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();
    assert_eq!(blad.viewports.len(), 0);
    assert_eq!(blad.viewports_3d, 1);
    assert!(scan.warnings.iter().any(|w| w == "viewports3d:1"), "{:?}", scan.warnings);
    let json = serde_json::to_value(&scan).unwrap();
    let space = json["spaces"].as_array().unwrap().iter().find(|s| s["id"] == "Blad").unwrap();
    assert_eq!(space["viewports3d"], 1, "de naam zoals het venster hem leest");

    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut Recorder::default());
    assert_eq!(walker.stats.viewports_3d_skipped, blad.viewports_3d, "verkenning en omzetting tellen hetzelfde");
}

// ── Kleurentabel ─────────────────────────────────────────────────────────

#[test]
fn the_pen_table_decides_the_line_width_and_the_colour_mode_does_not() {
    use super::style::{LineweightMode, PenTable};
    let mut t = TestDoc::new();
    t.layer("Rood", 1, |_| {});
    t.line(None, "Rood", Color::Index(1), (0.0, 0.0), (100.0, 0.0));
    let drawing = t.drawing();

    let pens = PenTable::from_pairs(&[((255, 0, 0), 0.7)]);
    let settings = WalkSettings {
        lineweight: LineweightMode::Pens,
        pens: pens.clone(),
        // Alles zwart op papier: de tabel kijkt naar de kleur uit het bestand.
        color_mode: super::style::ColorMode::Black,
        ..Default::default()
    };
    let (sink, _) = walk_model(&drawing, settings);
    assert_eq!(sink.strokes.len(), 1);
    assert_eq!(sink.strokes[0].1, (0, 0, 0), "zwart op papier");
    assert!((sink.widths[0] - 0.7 * 72.0 / 25.4).abs() < 1e-9, "dikte uit de kleurentabel");

    // Een kleur zonder regel houdt de dikte van het bestand (0,25 mm).
    let settings = WalkSettings {
        lineweight: LineweightMode::Pens,
        pens: PenTable::from_pairs(&[((0, 0, 255), 0.7)]),
        ..Default::default()
    };
    let (sink, _) = walk_model(&drawing, settings);
    assert!((sink.widths[0] - 0.25 * 72.0 / 25.4).abs() < 1e-9);
}

#[test]
fn the_pen_table_comes_through_the_arguments() {
    let args: ImportArgs = serde_json::from_str(
        r##"{"path":"a.dxf","outputPath":"a.pdf","lineweight":"pens",
            "pens":[{"color":"#FF0000","lineweightMm":0.35},{"color":"nonsens","lineweightMm":1.0}]}"##,
    )
    .unwrap();
    let options = args.options();
    assert_eq!(options.lineweight, super::style::LineweightMode::Pens);
    assert_eq!(options.pens.width_mm((255, 0, 0)), Some(0.35));
    assert_eq!(options.pens.width_mm((0, 0, 0)), None);
}

// ── Kleurstanden ─────────────────────────────────────────────────────────

/// Onthoudt lijnen, vullingen en tekst met hun kleur.
#[derive(Default)]
struct Painted {
    strokes: Vec<style::Rgb>,
    fills: Vec<style::Rgb>,
    fill_alphas: Vec<f64>,
    texts: Vec<style::Rgb>,
    /// Aangezette knippaden (een patroonarcering knipt op haar grens).
    clips: usize,
}

impl Sink for Painted {
    fn stroke(&mut self, _: &str, style: &Stroke, _: &PagePath) {
        self.strokes.push(style.color);
    }
    fn fill(&mut self, _: &str, color: style::Rgb, alpha: f64, _: &PagePath, _: bool) {
        self.fills.push(color);
        self.fill_alphas.push(alpha);
    }
    fn text(&mut self, _: &str, color: style::Rgb, _: f64, _: Matrix, _: &[u8], _: super::text::FontChoice) {
        self.texts.push(color);
    }
    fn push_clip(&mut self, _: &PagePath, _: bool) {
        self.clips += 1;
    }
}

/// Een gele en een rode effen vlakvulling, een gele lijn, een geel pijlvlak
/// uit een brede polylijn en een gele tekst.
fn yellow_and_red_drawing() -> Drawing {
    use acadrust::entities::{LwPolyline, LwVertex, Solid, Text};
    use acadrust::types::Vector2;
    let mut t = TestDoc::new();
    t.layer("Vlak", 2, |_| {});
    let square = |x: f64| {
        Solid::new(
            Vector3::new(x, 0.0, 0.0),
            Vector3::new(x + 10.0, 0.0, 0.0),
            Vector3::new(x, 10.0, 0.0),
            Vector3::new(x + 10.0, 10.0, 0.0),
        )
    };
    let mut yellow = square(0.0);
    yellow.common.layer = "Vlak".into();
    t.add(None, EntityType::Solid(yellow));
    let mut red = square(20.0);
    red.common.layer = "Vlak".into();
    red.common.color = Color::Index(1);
    t.add(None, EntityType::Solid(red));
    t.line(None, "Vlak", Color::ByLayer, (0.0, 20.0), (30.0, 20.0));
    let mut wide = LwPolyline::new();
    wide.common.layer = "Vlak".into();
    let mut from = LwVertex::new(Vector2::new(0.0, 30.0));
    from.start_width = 2.0;
    from.end_width = 0.0;
    wide.vertices.push(from);
    wide.vertices.push(LwVertex::new(Vector2::new(10.0, 30.0)));
    t.add(None, EntityType::LwPolyline(wide));
    let mut text = Text::new();
    text.value = "Geel".into();
    text.height = 5.0;
    text.insertion_point = Vector3::new(0.0, 40.0, 0.0);
    text.common.layer = "Vlak".into();
    t.add(None, EntityType::Text(text));
    t.drawing()
}

fn paint(drawing: &Drawing, color_mode: super::style::ColorMode) -> (Painted, WalkStats) {
    let mut walker = Walker::new(&drawing.document, WalkSettings { color_mode, ..Default::default() }, true);
    let mut sink = Painted::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    (sink, walker.stats.clone())
}

#[test]
fn pure_black_and_white_keeps_lines_and_drops_light_solid_fills() {
    use super::style::ColorMode;
    let drawing = yellow_and_red_drawing();
    let (file, stats) = paint(&drawing, ColorMode::File);
    assert_eq!(file.fills, vec![(255, 255, 0), (255, 0, 0), (255, 255, 0)], "twee vlakken en de brede polylijn");
    assert_eq!(stats.light_fills_dropped, 0);

    let (mono, stats) = paint(&drawing, ColorMode::Mono { threshold_pct: 50 });
    // Het gele vlak valt weg, het rode wordt zwart; de brede polylijn is een
    // lijn en blijft dus staan, zwart.
    assert_eq!(mono.fills, vec![(0, 0, 0), (0, 0, 0)]);
    assert_eq!(mono.strokes, vec![(0, 0, 0); file.strokes.len()]);
    assert_eq!(mono.texts, vec![(0, 0, 0); file.texts.len()]);
    assert!(!mono.texts.is_empty() && !mono.strokes.is_empty());
    assert_eq!(stats.light_fills_dropped, 1);
    assert_eq!(warnings_from(&stats).iter().filter(|w| w.as_str() == "lightFillsDropped:1").count(), 1);

    // Met de drempel op 100% valt er niets weg.
    let (all, stats) = paint(&drawing, ColorMode::Mono { threshold_pct: 100 });
    assert_eq!(all.fills, vec![(0, 0, 0); 3]);
    assert_eq!(stats.light_fills_dropped, 0);
}

#[test]
fn a_light_solid_hatch_is_dropped_but_a_pattern_hatch_stays_black() {
    use super::style::ColorMode;
    use acadrust::entities::{BoundaryPath, Hatch, HatchPatternLine, PolylineEdge};
    use acadrust::types::Vector2;
    let boundary = || {
        let mut path = BoundaryPath::new();
        path.edges.push(acadrust::entities::BoundaryEdge::Polyline(PolylineEdge::new(
            vec![Vector2::new(0.0, 0.0), Vector2::new(100.0, 0.0), Vector2::new(100.0, 100.0), Vector2::new(0.0, 100.0)],
            true,
        )));
        path
    };
    let mut t = TestDoc::new();
    t.layer("Vlak", 2, |_| {});
    let mut solid = Hatch::solid();
    solid.common.layer = "Vlak".into();
    solid.paths.push(boundary());
    t.add(None, EntityType::Hatch(solid));
    let mut lines = Hatch::new();
    lines.is_solid = false;
    lines.common.layer = "Vlak".into();
    lines.pattern.lines.push(HatchPatternLine {
        angle: 0.0,
        base_point: Vector2::new(0.0, 0.0),
        offset: Vector2::new(0.0, 10.0),
        dash_lengths: Vec::new(),
    });
    lines.paths.push(boundary());
    t.add(None, EntityType::Hatch(lines));
    let drawing = t.drawing();

    let (file, _) = paint(&drawing, ColorMode::File);
    assert_eq!(file.fills, vec![(255, 255, 0)]);
    assert!(!file.strokes.is_empty(), "de patroonarcering geeft lijnen");

    let (mono, stats) = paint(&drawing, ColorMode::Mono { threshold_pct: 50 });
    assert!(mono.fills.is_empty(), "de lichte effen arcering valt weg");
    assert_eq!(mono.strokes, vec![(0, 0, 0); file.strokes.len()], "patroonlijnen blijven, in zwart");
    assert_eq!(stats.light_fills_dropped, 1);
}

#[test]
fn the_four_hatch_modes_give_four_different_results() {
    use super::walk::HatchMode;
    use acadrust::entities::{BoundaryPath, GradientColorEntry, Hatch, HatchPatternLine, PolylineEdge};
    use acadrust::types::Vector2;
    let boundary = |x: f64| {
        let mut path = BoundaryPath::new();
        path.edges.push(acadrust::entities::BoundaryEdge::Polyline(PolylineEdge::new(
            vec![Vector2::new(x, 0.0), Vector2::new(x + 100.0, 0.0), Vector2::new(x + 100.0, 100.0), Vector2::new(x, 100.0)],
            true,
        )));
        path
    };
    let mut t = TestDoc::new();
    t.layer("Vlak", 2, |_| {});
    let mut solid = Hatch::solid();
    solid.common.layer = "Vlak".into();
    solid.paths.push(boundary(0.0));
    t.add(None, EntityType::Hatch(solid));
    let mut gradient = Hatch::solid();
    gradient.common.layer = "Vlak".into();
    gradient.is_solid = false;
    gradient.gradient_color.enabled = true;
    gradient.gradient_color.colors.push(GradientColorEntry { value: 0.0, color: Color::Index(1) });
    gradient.paths.push(boundary(200.0));
    t.add(None, EntityType::Hatch(gradient));
    let mut lines = Hatch::new();
    lines.is_solid = false;
    lines.common.layer = "Vlak".into();
    lines.pattern.lines.push(HatchPatternLine {
        angle: 0.0,
        base_point: Vector2::new(0.0, 0.0),
        offset: Vector2::new(0.0, 10.0),
        dash_lengths: Vec::new(),
    });
    lines.paths.push(boundary(400.0));
    t.add(None, EntityType::Hatch(lines));
    let drawing = t.drawing();

    let walk = |hatch: HatchMode| {
        let mut walker = Walker::new(&drawing.document, WalkSettings { hatch, ..Default::default() }, true);
        let mut sink = Painted::default();
        walker.model_space(Xform3::IDENTITY, &mut sink);
        // (vullingen, lijnen, knippaden, getelde arceringen)
        (sink.fills.len(), sink.strokes.len(), sink.clips, walker.stats.hatches)
    };
    assert_eq!(walk(HatchMode::All), (2, 1, 1, 3), "alles: twee vullingen, de patroonlijnen binnen hun grens");
    assert_eq!(walk(HatchMode::SolidOnly), (2, 1, 0, 3), "alleen effen: twee vullingen, het patroon als omtrek");
    assert_eq!(walk(HatchMode::Outline), (0, 3, 0, 3), "alleen omtrek: geen enkele vulling, drie omtrekken");
    assert_eq!(walk(HatchMode::None), (0, 0, 0, 0), "weglaten: niets");
}

#[test]
fn pure_black_and_white_has_no_transparency() {
    use super::style::ColorMode;
    use acadrust::entities::Solid;
    use acadrust::types::Transparency;
    let mut t = TestDoc::new();
    t.layer("Vlak", 1, |_| {});
    for (x, transparency) in [(0.0, 40u8), (20.0, 200u8)] {
        let mut solid = Solid::new(
            Vector3::new(x, 0.0, 0.0),
            Vector3::new(x + 10.0, 0.0, 0.0),
            Vector3::new(x, 10.0, 0.0),
            Vector3::new(x + 10.0, 10.0, 0.0),
        );
        solid.common.layer = "Vlak".into();
        solid.common.transparency = Transparency::Explicit(transparency);
        t.add(None, EntityType::Solid(solid));
    }
    let drawing = t.drawing();
    let (file, _) = paint(&drawing, ColorMode::File);
    assert_eq!(file.fills.len(), 2);
    assert!(file.fill_alphas.iter().all(|a| *a < 1.0));
    // Het bijna doorzichtige rode vlak is op papier licht en valt weg; het
    // andere wordt dekkend zwart.
    let (mono, stats) = paint(&drawing, ColorMode::Mono { threshold_pct: 50 });
    assert_eq!(mono.fills, vec![(0, 0, 0)]);
    assert_eq!(mono.fill_alphas, vec![1.0]);
    assert_eq!(stats.light_fills_dropped, 1);
}

#[test]
fn dropped_light_fills_are_counted_the_same_with_and_without_forms() {
    use super::style::ColorMode;
    use acadrust::entities::Solid;
    let mut t = TestDoc::new();
    t.layer("Symbolen", 2, |_| {});
    let blok = t.block("VLAK");
    let mut solid =
        Solid::new(Vector3::new(0.0, 0.0, 0.0), Vector3::new(10.0, 0.0, 0.0), Vector3::new(0.0, 10.0, 0.0), Vector3::new(10.0, 10.0, 0.0));
    solid.common.layer = "Symbolen".into();
    t.add(Some(blok), EntityType::Solid(solid));
    for n in 0..15 {
        t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, n as f64), (10.0, n as f64));
        t.line(Some(blok), "Symbolen", Color::ByLayer, (n as f64, 0.0), (n as f64, 10.0));
    }
    for n in 0..12 {
        t.insert(None, "VLAK", "Symbolen", Color::ByLayer, (n as f64 * 100.0, 0.0));
    }
    let drawing = t.drawing();
    let dir = work_dir("zwart-wit-formulieren");
    let run = |reuse: bool, name: &str| {
        let options = ImportOptions {
            scale: Some(20.0),
            color_mode: ColorMode::Mono { threshold_pct: 50 },
            reuse_blocks: reuse,
            ..Default::default()
        };
        convert(&drawing, &options, &dir.join(name), &AtomicBool::new(false), |_| {}).unwrap()
    };
    let met = run(true, "met.pdf");
    let zonder = run(false, "zonder.pdf");
    assert!(met.stats.forms_written > 0, "het blok wordt een formulier");
    assert_eq!(met.stats.light_fills_dropped, 12);
    assert_eq!(zonder.stats.light_fills_dropped, 12);
    assert_eq!(met.pages[0].objects, zonder.pages[0].objects);
    assert!(met.warnings.contains(&"lightFillsDropped:12".to_string()), "{:?}", met.warnings);
    // Geen geel en geen vulling in de pagina: alleen zwarte lijnen.
    let (_, content) = content_of(&dir.join("zonder.pdf"));
    assert!(!content.contains("1 1 0 rg"), "geen gele vulling");
}

#[test]
fn one_own_colour_paints_lines_fills_and_text_but_not_a_mask() {
    use super::style::ColorMode;
    let drawing = yellow_and_red_drawing();
    let own = (0, 64, 128);
    let (single, stats) = paint(&drawing, ColorMode::Single(own));
    assert_eq!(single.fills, vec![own; 3]);
    assert!(single.strokes.iter().all(|c| *c == own) && !single.strokes.is_empty());
    assert!(single.texts.iter().all(|c| *c == own) && !single.texts.is_empty());
    assert_eq!(stats.light_fills_dropped, 0);
}

#[test]
fn the_colour_modes_come_through_the_arguments() {
    use super::style::ColorMode;
    let options = |json: &str| serde_json::from_str::<ImportArgs>(json).unwrap().options();
    assert_eq!(
        options(r#"{"path":"a.dxf","colors":"mono","monoThreshold":65}"#).color_mode,
        ColorMode::Mono { threshold_pct: 65 }
    );
    assert_eq!(
        options(r##"{"path":"a.dxf","colors":"single","singleColor":"#004080"}"##).color_mode,
        ColorMode::Single((0, 64, 128))
    );
    assert_eq!(options(r#"{"path":"a.dxf","colors":"gray","monoThreshold":65}"#).color_mode, ColorMode::Gray);
    assert_eq!(options(r#"{"path":"a.dxf","colors":"onbekend"}"#).color_mode, ColorMode::File);
}

// ── Lettertypen ──────────────────────────────────────────────────────────

#[test]
fn a_replaced_font_reaches_the_pdf_and_is_reported() {
    use super::text::{FontChoice, FontFamily, FontMap};
    let mut t = TestDoc::new();
    t.layer("Tekst", 7, |_| {});
    let mut style = acadrust::tables::TextStyle::new("VAST");
    style.font_file = "romans.shx".into();
    style.set_handle(t.doc.allocate_handle());
    t.doc.text_styles.add(style).unwrap();
    let mut text = acadrust::entities::Text::with_value("ABC", Vector3::new(0.0, 0.0, 0.0)).with_height(10.0);
    text.style = "VAST".into();
    text.common.layer = "Tekst".into();
    t.add(None, EntityType::Text(text));
    let drawing = t.drawing();

    let dir = work_dir("fonts");
    let pdf = dir.join("tekst.pdf");
    let options = ImportOptions {
        scale: Some(10.0),
        fonts: FontMap::new(
            vec![("romans.shx".into(), FontChoice { family: FontFamily::Mono, italic: false, bold: false })],
            FontChoice::DEFAULT,
        ),
        ..Default::default()
    };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(raw.contains("/BaseFont /Courier"), "de vervangende letter staat in de PDF");
    assert!(result.warnings.iter().any(|w| w.starts_with("fontsReplaced:")), "{:?}", result.warnings);
}

#[test]
fn replaced_fonts_are_counted_per_text_style_over_the_whole_import() {
    // Twee bladen met elk een eigen stijl en één gedeelde; alle drie krijgen
    // de standaardletter (een SHX-letter wordt schreefloos) en tellen dus mee.
    // Een stijl zonder tekst telt niet.
    let mut t = TestDoc::new();
    for (name, font) in [("EEN", "romans.shx"), ("TWEE", "txt.shx"), ("SAMEN", "isocp.shx"), ("LEEG", "simplex.shx")] {
        let mut style = acadrust::tables::TextStyle::new(name);
        style.font_file = font.into();
        style.set_handle(t.doc.allocate_handle());
        t.doc.text_styles.add(style).unwrap();
    }
    for (layout, styles) in [("Blad1", ["EEN", "SAMEN"]), ("Blad2", ["TWEE", "SAMEN"])] {
        t.doc.add_layout(layout).unwrap();
        for (row, style) in styles.iter().enumerate() {
            let mut text =
                acadrust::entities::Text::with_value("ABC", Vector3::new(10.0, 10.0 + 20.0 * row as f64, 0.0)).with_height(5.0);
            text.style = (*style).into();
            t.doc.add_entity_to_layout(EntityType::Text(text), layout).unwrap();
        }
    }
    let drawing = t.drawing();
    let dir = work_dir("fonts-tellen");
    let pdf = dir.join("bladen.pdf");
    let options = ImportOptions { spaces: vec!["Blad1".into(), "Blad2".into()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.pages.len(), 2);
    assert_eq!(result.stats.fonts_replaced, 3, "drie stijlen met tekst, niet het hoogste aantal per blad");
    assert!(result.warnings.iter().any(|w| w == "fontsReplaced:3"), "{:?}", result.warnings);
}

/// Onthoudt de tekstmatrices die de wandeling afgeeft.
#[derive(Default)]
struct TextMatrices(Vec<Matrix>);

impl Sink for TextMatrices {
    fn stroke(&mut self, _: &str, _: &Stroke, _: &PagePath) {}
    fn fill(&mut self, _: &str, _: style::Rgb, _: f64, _: &PagePath, _: bool) {}
    fn text(&mut self, _: &str, _: style::Rgb, _: f64, matrix: Matrix, _: &[u8], _: super::text::FontChoice) {
        self.0.push(matrix);
    }
}

/// Een TEXT in een schuine stijl en een blok met een ATTRIB dat gedraaid en
/// zelf schuin staat. De hoeken komen uit de aanroeper, in de eenheid waarin
/// de lezer ze voor die bestandssoort laat staan.
fn oblique_text_and_turned_attribute(style_oblique: f64, attribute_rotation: f64, attribute_oblique: f64) -> Drawing {
    use acadrust::entities::{AttributeEntity, Text};
    let mut t = TestDoc::new();
    t.layer("Tekst", 7, |_| {});
    let mut style = acadrust::tables::TextStyle::new("SCHUIN");
    style.oblique_angle = style_oblique;
    style.set_handle(t.doc.allocate_handle());
    t.doc.text_styles.add(style).unwrap();
    let mut text = Text::with_value("ABC", Vector3::new(0.0, 0.0, 0.0)).with_height(10.0);
    text.style = "SCHUIN".into();
    text.common.layer = "Tekst".into();
    t.add(None, EntityType::Text(text));
    let label = t.block("LABEL");
    t.line(Some(label), "Tekst", Color::ByLayer, (0.0, 0.0), (1.0, 0.0));
    let mut insert = Insert::new("LABEL", Vector3::new(50.0, 0.0, 0.0));
    insert.common.layer = "Tekst".into();
    let mut attribute = AttributeEntity::new("NR".into(), "12".into());
    attribute.common.layer = "Tekst".into();
    attribute.insertion_point = Vector3::new(50.0, 0.0, 0.0);
    attribute.height = 10.0;
    attribute.rotation = attribute_rotation;
    attribute.oblique_angle = attribute_oblique;
    insert.attributes.push(attribute);
    t.add(None, EntityType::Insert(insert));
    t.drawing()
}

fn text_matrices(drawing: &Drawing, source_is_dxf: bool) -> Vec<Matrix> {
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), source_is_dxf);
    let mut sink = TextMatrices::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    sink.0
}

/// Onthoudt wat de wandeling aan de afnemer vraagt (`wants`) en wat ze aan
/// tekst afgeeft.
#[derive(Default)]
struct AskedAndText {
    asked: Vec<[f64; 4]>,
    texts: Vec<(Matrix, Vec<u8>, super::text::FontChoice)>,
}

impl Sink for AskedAndText {
    fn stroke(&mut self, _: &str, _: &Stroke, _: &PagePath) {}
    fn fill(&mut self, _: &str, _: style::Rgb, _: f64, _: &PagePath, _: bool) {}
    fn text(&mut self, _: &str, _: style::Rgb, _: f64, matrix: Matrix, bytes: &[u8], font: super::text::FontChoice) {
        self.texts.push((matrix, bytes.to_vec(), font));
    }
    fn wants(&mut self, bounds: [f64; 4]) -> bool {
        self.asked.push(bounds);
        true
    }
}

#[test]
fn the_box_of_a_turned_mtext_line_covers_all_four_corners() {
    let mut t = TestDoc::new();
    t.layer("Tekst", 7, |_| {});
    let mut mtext = acadrust::entities::MText::with_value("ABC", Vector3::new(100.0, 100.0, 0.0));
    mtext.height = 40.0;
    mtext.rotation = 80.0_f64.to_radians();
    mtext.common.layer = "Tekst".into();
    t.add(None, EntityType::MText(mtext));
    let drawing = t.drawing();
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = AskedAndText::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    assert_eq!(sink.texts.len(), 1);
    assert_eq!(sink.asked.len(), 1);
    let (tm, bytes, font) = &sink.texts[0];
    let w = super::text::width_with(bytes, *font);
    let corners = [(0.0, -0.25), (w, -0.25), (w, 1.0), (0.0, 1.0)].map(|(x, y)| tm.apply(Point::new(x, y)));
    let expected = [
        corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
        corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
        corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
    ];
    let asked = sink.asked[0];
    for (a, e) in asked.iter().zip(expected) {
        assert!((a - e).abs() < 1e-9, "gevraagd {asked:?}, omhullende van de vier hoekpunten {expected:?}");
    }
    // Onder 80° steekt het vak links en rechts duidelijk verder uit dan de
    // twee diagonale hoekpunten alleen.
    let two = [corners[0].x.min(corners[2].x), corners[0].y.min(corners[2].y), corners[0].x.max(corners[2].x), corners[0].y.max(corners[2].y)];
    assert!(asked[0] < two[0] - 1.0 && asked[2] > two[2] + 1.0, "{asked:?} tegenover {two:?}");
}

#[test]
fn style_and_attribute_angles_follow_the_convention_of_the_file_type() {
    let (oblique, turn, own) = (15.0_f64, 90.0_f64, 10.0_f64);
    // DXF: de lezer laat deze drie hoeken in graden staan.
    let dxf = text_matrices(&oblique_text_and_turned_attribute(oblique, turn, own), true);
    // DWG: dezelfde tekening, in radialen.
    let dwg = text_matrices(&oblique_text_and_turned_attribute(oblique.to_radians(), turn.to_radians(), own.to_radians()), false);
    assert_eq!(dxf.len(), 2);
    assert_eq!(dwg.len(), 2);
    for (a, b) in dxf.iter().zip(&dwg) {
        for (x, y) in [(a.a, b.a), (a.b, b.b), (a.c, b.c), (a.d, b.d), (a.e, b.e), (a.f, b.f)] {
            assert!((x - y).abs() < 1e-9, "DXF {a:?} tegenover DWG {b:?}");
        }
    }
    // De tekst helt 15° voorover: de schuinstand is tan(15°) van de hoogte.
    let text = &dxf[0];
    assert!((text.c / text.d - oblique.to_radians().tan()).abs() < 1e-9, "{text:?}");
    // Het attribuut staat rechtop (90°) met zijn eigen schuinstand van 10°.
    let attribute = &dxf[1];
    assert!(attribute.a.abs() < 1e-9 && attribute.b > 0.0, "{attribute:?}");
    let shear = (attribute.a * attribute.c + attribute.b * attribute.d) / (attribute.a * attribute.a + attribute.b * attribute.b);
    assert!((shear - own.to_radians().tan()).abs() < 1e-9, "{attribute:?}");
}

// ── Externe verwijzingen ─────────────────────────────────────────────────

use super::xref::{SearchPaths, XrefDocs, MAX_XREF_DEPTH, MAX_XREF_FILES};

/// Tijdelijke map die zichzelf opruimt.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> TempDir {
        TempDir(work_dir(name))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Schrijft een testtekening als DXF, zodat de import hem echt kan lezen.
fn write_dxf(document: &CadDocument, path: &Path) {
    acadrust::DxfWriter::new(document).write_to_file(path).unwrap();
}

impl TestDoc {
    /// Een blokrecord dat naar een ander tekeningbestand wijst.
    fn xref(&mut self, name: &str, path: &str) -> &mut Self {
        let mut record = BlockRecord::new(name);
        record.xref_path = path.into();
        record.flags.is_xref = true;
        record.set_handle(self.doc.allocate_handle());
        self.doc.block_records.add(record).unwrap();
        self
    }

    /// De tekening, met `path` als plek waar zij (zogenaamd) staat.
    fn drawing_at(self, path: PathBuf) -> Drawing {
        let mut drawing = self.drawing();
        drawing.path = path;
        drawing
    }
}

/// Een tekening met één lijn op laag "Gevel", weggeschreven als DXF.
fn write_facade(path: &Path, length: f64) {
    let mut child = TestDoc::new();
    child.layer("Gevel", 2, |_| {});
    child.line(None, "Gevel", Color::ByLayer, (0.0, 0.0), (length, 0.0));
    write_dxf(&child.doc, path);
}

/// Een hoofdtekening met een kaderlijn en één verwijzing `GEVEL` naar `target`.
fn host_with_xref(dir: &Path, target: &str) -> Drawing {
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    t.xref("GEVEL", target);
    t.insert(None, "GEVEL", "Kader", Color::ByLayer, (0.0, 0.0));
    t.drawing_at(dir.join("hoofd.dxf"))
}

fn load_xrefs(drawing: &Drawing, extra: &[PathBuf]) -> XrefDocs {
    let paths = SearchPaths::for_drawing(&drawing.path, extra);
    let mut budget = super::xref::MAX_XREF_BYTES;
    XrefDocs::load(&drawing.document, Some(&drawing.path), &paths, &mut budget, &AtomicBool::new(false))
}

fn walk_with_xrefs<'a>(drawing: &'a Drawing, xrefs: &'a XrefDocs, settings: WalkSettings) -> (Recorder, Walker<'a>) {
    let mut walker = Walker::new(&drawing.document, settings, true);
    walker.with_xrefs(xrefs);
    let mut sink = Recorder::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    (sink, walker)
}

#[test]
fn an_external_reference_is_drawn_when_it_is_next_to_the_drawing() {
    let dir = TempDir::new("xref");
    write_facade(&dir.path().join("gevel.dxf"), 1000.0);
    let drawing = host_with_xref(dir.path(), "gevel.dxf");

    // Naast de tekening: geen zoekpad nodig.
    let pdf = dir.path().join("hoofd.pdf");
    let options = ImportOptions { scale: Some(50.0), ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_loaded, 1);
    assert_eq!(result.stats.xrefs_missing, 0);
    assert_eq!(result.stats.xrefs_skipped, 0);
    assert!(result.warnings.iter().any(|w| w == "xrefsLoaded:1"), "{:?}", result.warnings);
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(raw.contains("(Gevel)"), "de laag van de verwijzing staat in de PDF");
    let xrefs = load_xrefs(&drawing, &[]);
    let budget = walk::VisitBudget::new(options.max_visits);
    let (bounds, _) = space_bounds(&drawing, "model", &options, Externals { xrefs: Some(&xrefs), images: None }, &AtomicBool::new(false), &budget).unwrap();
    assert_eq!(bounds.bounds, Some([0.0, 0.0, 1000.0, 0.0]), "de verwijzing telt mee in de grenzen");

    // Uit: alleen geteld, niet geladen.
    let pdf2 = dir.path().join("zonder.pdf");
    let off = ImportOptions { xrefs: false, ..options.clone() };
    let result = convert(&drawing, &off, &pdf2, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_skipped, 1);
    assert_eq!(result.stats.xrefs_loaded, 0);
    assert!(!String::from_utf8_lossy(&std::fs::read(&pdf2).unwrap()).contains("(Gevel)"));
}

#[test]
fn an_external_reference_is_found_in_a_chosen_search_path_only() {
    let dir = TempDir::new("xref-zoekpad");
    let (own, other) = (dir.path().join("tekening"), dir.path().join("verwijzingen"));
    std::fs::create_dir_all(&own).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    write_facade(&other.join("gevel.dxf"), 1000.0);
    // Het pad in de tekening wijst er met `..` naartoe; dat wordt niet gevolgd.
    let drawing = host_with_xref(&own, "..\\verwijzingen\\gevel.dxf");
    let cancel = AtomicBool::new(false);

    let without = ImportOptions { scale: Some(50.0), ..Default::default() };
    let result = convert(&drawing, &without, &own.join("zonder.pdf"), &cancel, |_| {}).unwrap();
    assert_eq!((result.stats.xrefs_loaded, result.stats.xrefs_missing), (0, 1));

    let with = ImportOptions { search_paths: vec![other.clone()], ..without };
    let result = convert(&drawing, &with, &own.join("met.pdf"), &cancel, |_| {}).unwrap();
    assert_eq!((result.stats.xrefs_loaded, result.stats.xrefs_missing), (1, 0));
}

#[test]
fn a_missing_external_reference_is_reported_and_the_import_goes_on() {
    let dir = TempDir::new("xref-weg");
    let drawing = host_with_xref(dir.path(), "bestaat-niet.dwg");
    let pdf = dir.path().join("hoofd.pdf");
    let options = ImportOptions { scale: Some(50.0), search_paths: vec![dir.path().to_path_buf()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_missing, 1);
    assert_eq!(result.stats.xrefs_skipped, 0, "niet ook nog eens als overgeslagen gemeld");
    assert!(result.warnings.iter().any(|w| w == "xrefsMissing:1"));
    assert!(pdf.exists(), "de import gaat gewoon door");
}

#[test]
fn an_unsafe_or_unreadable_external_reference_never_stops_the_import() {
    let dir = TempDir::new("xref-geweigerd");
    write_facade(&dir.path().join("gevel.dxf"), 1000.0);
    std::fs::write(dir.path().join("kapot.dxf"), b"\x00\xff geen tekening \x00").unwrap();
    std::fs::write(dir.path().join("oud.dwg"), b"AC1009 en verder niets").unwrap();
    std::fs::write(dir.path().join("half.dwg"), b"AC1032\x00\x00\x00").unwrap();
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    for (i, target) in [
        "\\\\server\\deel\\gevel.dxf",
        "//server/deel/gevel.dxf",
        "\\\\?\\C:\\gevel.dxf",
        "https://elders/gevel.dxf",
        "gevel.dxf:stroom",
        "NUL.dxf",
        "COM1.dxf/",
        "kapot.dxf",
        "oud.dwg",
        "half.dwg",
    ]
    .iter()
    .enumerate()
    {
        let name = format!("X{i}");
        t.xref(&name, target);
        t.insert(None, &name, "Kader", Color::ByLayer, (0.0, 0.0));
    }
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let pdf = dir.path().join("hoofd.pdf");
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_refused, 5, "onveilige paden");
    assert_eq!(result.stats.odd_names, 2, "namen die het systeem anders leest, met een eigen melding");
    assert_eq!(result.stats.xrefs_missing, 3, "onleesbare bestanden");
    assert_eq!(result.stats.xrefs_loaded, 0);
    assert!(result.warnings.iter().any(|w| w == "xrefsRefused:5"), "{:?}", result.warnings);
    assert!(result.warnings.iter().any(|w| w == "oddNames:2"), "{:?}", result.warnings);
    assert!(pdf.exists());
}

#[test]
fn references_that_point_at_each_other_are_loaded_once() {
    let dir = TempDir::new("xref-kring");
    // a verwijst naar b, b verwijst terug naar a én naar de hoofdtekening.
    let mut a = TestDoc::new();
    a.layer("A", 1, |_| {});
    a.line(None, "A", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    a.xref("B", "b.dxf");
    a.insert(None, "B", "A", Color::ByLayer, (0.0, 10.0));
    write_dxf(&a.doc, &dir.path().join("a.dxf"));
    let mut b = TestDoc::new();
    b.layer("B", 2, |_| {});
    b.line(None, "B", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    b.xref("A", "a.dxf");
    b.insert(None, "A", "B", Color::ByLayer, (0.0, 10.0));
    b.xref("HOOFD", "hoofd.dxf");
    b.insert(None, "HOOFD", "B", Color::ByLayer, (0.0, 20.0));
    write_dxf(&b.doc, &dir.path().join("b.dxf"));
    let mut host = TestDoc::new();
    host.layer("Kader", 1, |_| {});
    host.xref("A", "a.dxf");
    host.insert(None, "A", "Kader", Color::ByLayer, (0.0, 0.0));
    // De hoofdtekening verwijst ook naar zichzelf.
    host.xref("ZELF", "hoofd.dxf");
    host.insert(None, "ZELF", "Kader", Color::ByLayer, (0.0, 0.0));
    write_dxf(&host.doc, &dir.path().join("hoofd.dxf"));
    let drawing = host.drawing_at(dir.path().join("hoofd.dxf"));

    let xrefs = load_xrefs(&drawing, &[]);
    assert_eq!(xrefs.loaded(), 2, "a en b, elk één keer");
    assert_eq!(xrefs.refused(), 3, "b naar a, b naar de hoofdtekening en de hoofdtekening naar zichzelf");
    let (sink, walker) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!((sink.on("A"), sink.on("B")), (1, 1));
    assert!(!walker.cancelled);
}

#[test]
fn references_in_references_stop_at_the_depth_limit() {
    let dir = TempDir::new("xref-diep");
    let levels = MAX_XREF_DEPTH + 2;
    for level in 1..=levels {
        let mut t = TestDoc::new();
        let layer = format!("N{level}");
        t.layer(&layer, 1, |_| {});
        t.line(None, &layer, Color::ByLayer, (0.0, level as f64), (100.0, level as f64));
        if level < levels {
            t.xref("VOLGENDE", &format!("n{}.dxf", level + 1));
            t.insert(None, "VOLGENDE", &layer, Color::ByLayer, (0.0, 0.0));
        }
        write_dxf(&t.doc, &dir.path().join(format!("n{level}.dxf")));
    }
    let mut host = TestDoc::new();
    host.layer("Kader", 1, |_| {});
    host.xref("VOLGENDE", "n1.dxf");
    host.insert(None, "VOLGENDE", "Kader", Color::ByLayer, (0.0, 0.0));
    let drawing = host.drawing_at(dir.path().join("hoofd.dxf"));

    let xrefs = load_xrefs(&drawing, &[]);
    assert_eq!(xrefs.loaded(), MAX_XREF_DEPTH as u64);
    assert_eq!(xrefs.refused(), 1, "het niveau daaronder wordt geweigerd, het niveau dáár weer onder nooit gezien");
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!(sink.strokes.len(), MAX_XREF_DEPTH as usize);
    assert_eq!(sink.on(&format!("N{}", MAX_XREF_DEPTH + 1)), 0);
}

#[test]
fn a_reference_first_seen_deep_gets_its_own_references_when_it_stands_higher_up() {
    let dir = TempDir::new("xref-ondiep");
    let levels = MAX_XREF_DEPTH + 1;
    for level in 1..=levels {
        let mut t = TestDoc::new();
        let layer = format!("N{level}");
        t.layer(&layer, 1, |_| {});
        t.line(None, &layer, Color::ByLayer, (0.0, level as f64), (100.0, level as f64));
        if level < levels {
            t.xref("VOLGENDE", &format!("n{}.dxf", level + 1));
            t.insert(None, "VOLGENDE", &layer, Color::ByLayer, (0.0, 0.0));
        }
        write_dxf(&t.doc, &dir.path().join(format!("n{level}.dxf")));
    }
    let mut host = TestDoc::new();
    host.layer("Kader", 1, |_| {});
    // Eerst de keten: het op één na laatste bestand komt op de dieptegrens
    // langs, waar zijn eigen verwijzing geweigerd wordt.
    host.xref("KETEN", "n1.dxf");
    host.insert(None, "KETEN", "Kader", Color::ByLayer, (0.0, 0.0));
    // Dan datzelfde bestand rechtstreeks: daar valt zijn verwijzing ruim
    // binnen de grens en hoort ze erbij.
    host.xref("DIRECT", &format!("n{}.dxf", levels - 1));
    host.insert(None, "DIRECT", "Kader", Color::ByLayer, (0.0, 100.0));
    let drawing = host.drawing_at(dir.path().join("hoofd.dxf"));

    let xrefs = load_xrefs(&drawing, &[]);
    let direct = xrefs.get("DIRECT").expect("rechtstreeks geladen");
    assert!(direct.children.get("VOLGENDE").is_some(), "de eigen verwijzing van de rechtstreekse plaatsing ontbreekt");
    assert_eq!(xrefs.loaded(), levels as u64, "elk bestand telt één keer als geladen");
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!(sink.on(&format!("N{levels}")), 1, "het laatste bestand staat onder de rechtstreekse plaatsing");
}

#[test]
fn a_drawing_in_the_root_of_a_volume_does_not_make_the_volume_a_search_path() {
    // De wortel van de schijf waar de tijdelijke map op staat.
    let root = std::env::temp_dir().canonicalize().unwrap().ancestors().last().unwrap().to_path_buf();
    assert!(root.is_dir());
    let drawing = root.join("blad.dwg");
    assert!(SearchPaths::for_drawing(&drawing, &[]).is_empty(), "de wortel is geen impliciete map van de tekening");
    // Uitdrukkelijk als zoekpad gekozen mag de wortel wél.
    assert!(!SearchPaths::for_drawing(&drawing, std::slice::from_ref(&root)).is_empty());
    // Een tekening in een gewone map: haar map telt, ook als het bestand er
    // (nog) niet staat.
    let dir = TempDir::new("wortel");
    assert!(!SearchPaths::for_drawing(&dir.path().join("blad.dwg"), &[]).is_empty());
}

#[test]
fn the_byte_budget_and_the_file_limit_hold_for_external_references() {
    let dir = TempDir::new("xref-begroting");
    write_facade(&dir.path().join("gevel.dxf"), 1000.0);
    let size = std::fs::metadata(dir.path().join("gevel.dxf")).unwrap().len();
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    let count = MAX_XREF_FILES + 3;
    for i in 0..count {
        std::fs::copy(dir.path().join("gevel.dxf"), dir.path().join(format!("g{i}.dxf"))).unwrap();
        t.xref(&format!("G{i}"), &format!("g{i}.dxf"));
    }
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let paths = SearchPaths::for_drawing(&drawing.path, &[]);
    let cancel = AtomicBool::new(false);

    // Begroting voor precies twee bestanden.
    let mut budget = size * 2 + 1;
    let xrefs = XrefDocs::load(&drawing.document, Some(&drawing.path), &paths, &mut budget, &cancel);
    assert_eq!((xrefs.loaded(), xrefs.refused()), (2, count as u64 - 2));
    assert_eq!(budget, 1);

    // Ruime begroting: dan telt de grens op het aantal bestanden.
    let mut budget = super::xref::MAX_XREF_BYTES;
    let xrefs = XrefDocs::load(&drawing.document, Some(&drawing.path), &paths, &mut budget, &cancel);
    assert_eq!((xrefs.loaded(), xrefs.refused()), (MAX_XREF_FILES as u64, 3));

    // Afgebroken: er wordt niets meer gelezen.
    let mut budget = super::xref::MAX_XREF_BYTES;
    let xrefs = XrefDocs::load(&drawing.document, Some(&drawing.path), &paths, &mut budget, &AtomicBool::new(true));
    assert_eq!(xrefs.loaded(), 0);
    assert_eq!(budget, super::xref::MAX_XREF_BYTES);
}

#[test]
fn an_external_reference_shares_the_work_limits_and_the_cancel_flag() {
    let dir = TempDir::new("xref-grenzen");
    let mut child = TestDoc::new();
    for i in 0..3000 {
        child.line(None, "0", Color::ByLayer, (i as f64, 0.0), (i as f64, 1.0));
    }
    write_dxf(&child.doc, &dir.path().join("veel.dxf"));
    let drawing = host_with_xref(dir.path(), "veel.dxf");
    let cancel = AtomicBool::new(false);

    // De bezoeken van de verwijzing gaan van hetzelfde budget af.
    let pdf = dir.path().join("uit.pdf");
    let small = ImportOptions { max_visits: 1_000, ..Default::default() };
    assert_eq!(convert(&drawing, &small, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex);
    // De uitvoer van de verwijzing gaat van dezelfde inhoudsgrens af.
    let tiny = ImportOptions { max_content_bytes: 1_000, ..Default::default() };
    assert_eq!(convert(&drawing, &tiny, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex);
    assert!(!pdf.exists());
    // Ruim genoeg: dan lukt het, en de entiteiten van de verwijzing tellen mee.
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &cancel, |_| {}).unwrap();
    assert!(result.stats.entities >= 3000, "{}", result.stats.entities);

    // Afbreken halverwege de verwijzing stopt ook de hoofdwandeling.
    let xrefs = load_xrefs(&drawing, &[]);
    let seen = std::cell::Cell::new(0u32);
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    walker.with_xrefs(&xrefs);
    walker.on_cancel(|| {
        seen.set(seen.get() + 1);
        true
    });
    let mut sink = Recorder::default();
    walker.model_space(Xform3::IDENTITY, &mut sink);
    assert!(walker.cancelled && !walker.too_complex);
    assert!(seen.get() >= 1);
    assert!(sink.strokes.len() < 3000, "{}", sink.strokes.len());
}

#[test]
fn an_external_reference_is_placed_by_its_own_base_point_and_unit() {
    let dir = TempDir::new("xref-plaats");
    // Verwijzing in meters, basispunt (100, 0): een lijn van 100 naar 101.
    let mut child = TestDoc::new();
    child.doc.header.insertion_units = 6;
    child.doc.header.model_space_insertion_base = Vector3::new(100.0, 0.0, 0.0);
    child.line(None, "0", Color::ByLayer, (100.0, 0.0), (101.0, 0.0));
    write_dxf(&child.doc, &dir.path().join("meters.dxf"));
    // Hoofdtekening in millimeters; ingevoegd op (5000, 0), op laag Kader.
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.xref("M", "meters.dxf");
    t.insert(None, "M", "Kader", Color::ByLayer, (5000.0, 0.0));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let xrefs = load_xrefs(&drawing, &[]);
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!(sink.strokes.len(), 1);
    let (layer, color, bounds) = &sink.strokes[0];
    assert_eq!(layer, "Kader", "laag 0 van de verwijzing volgt de laag van de invoeging");
    assert_eq!(*color, (255, 0, 0));
    assert!((bounds[0] - 5000.0).abs() < 1e-6 && (bounds[2] - 6000.0).abs() < 1e-6, "{bounds:?}");
}

#[test]
fn layers_of_an_external_reference_go_by_the_name_the_host_gives_them() {
    let dir = TempDir::new("xref-lagen");
    write_facade(&dir.path().join("gevel.dxf"), 1000.0);
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.layer("GEVEL|Gevel", 3, |_| {});
    t.xref("GEVEL", "gevel.dxf");
    t.insert(None, "GEVEL", "Kader", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let xrefs = load_xrefs(&drawing, &[]);
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!(sink.on("GEVEL|Gevel"), 1, "{:?}", sink.strokes);
    // Uitgezet onder de naam die het importvenster toont.
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, excluded(&["GEVEL|Gevel"]));
    assert!(sink.strokes.is_empty());
    // De laag van de invoeging uit: inhoud op eigen lagen blijft.
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, excluded(&["Kader"]));
    assert_eq!(sink.on("GEVEL|Gevel"), 1);
}

#[test]
fn layer_zero_of_an_external_reference_follows_the_insert_however_it_is_spelled() {
    let dir = TempDir::new("xref-laag-nul");
    let mut child = TestDoc::new();
    child.layer("Gevel", 2, |_| {});
    child.line(None, "Gevel", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    child.line(None, "0", Color::ByLayer, (0.0, 1.0), (10.0, 1.0));
    child.line(None, "0 ", Color::ByLayer, (0.0, 2.0), (10.0, 2.0));
    write_dxf(&child.doc, &dir.path().join("gevel.dxf"));
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.layer("GEVEL|Gevel", 3, |_| {});
    t.xref("GEVEL", "gevel.dxf");
    t.insert(None, "GEVEL", "Kader", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let xrefs = load_xrefs(&drawing, &[]);
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, WalkSettings::default());
    assert_eq!(sink.strokes.len(), 3, "{:?}", sink.strokes);
    // De laag van de invoeging uit: alleen de eigen laag van de verwijzing blijft.
    let (sink, _) = walk_with_xrefs(&drawing, &xrefs, excluded(&["Kader"]));
    assert_eq!(sink.strokes.len(), 1, "{:?}", sink.strokes);
    assert_eq!(sink.on("GEVEL|Gevel"), 1);
}

// ── Afbeeldingen ─────────────────────────────────────────────────────────

use acadrust::entities::RasterImage;

/// Een IMAGE van 2 x 2 beeldpunten op laag "Beeld": 1000 x 1000 eenheden groot,
/// met de linkeronderhoek op `at`.
fn image_entity(file: &str, at: (f64, f64)) -> RasterImage {
    let mut raster = RasterImage::new(file, Vector3::new(at.0, at.1, 0.0), 2.0, 2.0);
    raster.common.layer = "Beeld".into();
    raster.u_vector = Vector3::new(500.0, 0.0, 0.0);
    raster.v_vector = Vector3::new(0.0, 500.0, 0.0);
    raster
}

fn drawing_with_image(dir: &Path, file: &str) -> Drawing {
    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    t.add(None, EntityType::RasterImage(image_entity(file, (0.0, 0.0))));
    t.drawing_at(dir.join("hoofd.dxf"))
}

#[test]
fn an_image_next_to_the_drawing_is_embedded() {
    let dir = TempDir::new("beeld");
    std::fs::write(dir.path().join("kaart.png"), super::image::tests_sample_png()).unwrap();
    let drawing = drawing_with_image(dir.path(), "kaart.png");

    let pdf = dir.path().join("hoofd.pdf");
    let options = ImportOptions { scale: Some(10.0), ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.images_embedded, 1);
    assert_eq!((result.stats.images_missing, result.stats.images_refused, result.stats.images_skipped), (0, 0, 0));
    assert!(result.warnings.iter().any(|w| w == "imagesEmbedded:1"), "{:?}", result.warnings);
    let bytes = std::fs::read(&pdf).unwrap();
    let raw = String::from_utf8_lossy(&bytes).to_string();
    assert!(raw.contains("/Subtype /Image"));
    assert!(raw.contains("/Width 2") && raw.contains("/Height 2"));
    assert!(raw.contains("/ColorSpace /DeviceRGB"));
    assert!(raw.contains("/XObject") && raw.contains("/ImageC"));
    assert!(!raw.contains("kaart.png"), "het pad van het bestand komt niet in de PDF");
    // De beeldpunten zijn bij het lezen ingepakt en gaan zo de PDF in.
    let mut packed = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
    std::io::Write::write_all(&mut packed, &[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]).unwrap();
    let packed = packed.finish().unwrap();
    assert!(bytes.windows(packed.len()).any(|w| w == packed.as_slice()), "rood, groen / blauw, wit");
    // Op schaal 1:10 is 1000 mm op papier 100 mm = 283,46 punten, vierkant en
    // rechtop; het beeld telt mee in de grenzen van de pagina.
    let (_, content) = content_of(&pdf);
    let line = content.lines().find(|l| l.ends_with("/Im0 Do Q")).expect("het beeld wordt getekend");
    let numbers: Vec<f64> = line.split_whitespace().filter_map(|v| v.parse().ok()).collect();
    assert!((numbers[0] - 283.4646).abs() < 1e-3 && (numbers[3] - 283.4646).abs() < 1e-3, "{line}");
    assert!(numbers[1].abs() < 1e-9 && numbers[2].abs() < 1e-9, "{line}");
    assert!(content.contains("/OC /L0 BDC"), "het beeld staat op zijn laag");

    // Uit: alleen geteld, zoals voorheen.
    let pdf2 = dir.path().join("zonder.pdf");
    let off = ImportOptions { images: false, area: AreaChoice::Window([0.0, 0.0, 1000.0, 1000.0]), ..options.clone() };
    let result = convert(&drawing, &off, &pdf2, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!((result.stats.images_skipped, result.stats.images_embedded), (1, 0));
    assert!(result.warnings.iter().any(|w| w == "images:1"));
    assert!(!String::from_utf8_lossy(&std::fs::read(&pdf2).unwrap()).contains("/Subtype /Image"));
}

#[test]
fn a_jpeg_goes_in_unchanged_and_one_file_is_written_once() {
    let dir = TempDir::new("beeld-jpeg");
    let jpeg = super::image::tests_sample_jpeg(4, 8, 1, 0xC0, 8);
    // Achter het beeld is iets anders geplakt: dat lift niet mee.
    let mut on_disk = jpeg.clone();
    on_disk.extend_from_slice(b"MEELIFTER achter het einde van het beeld");
    std::fs::write(dir.path().join("foto.jpg"), &on_disk).unwrap();
    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    // Twee keer hetzelfde bestand, de tweede keer onder het pad van een andere machine.
    t.add(None, EntityType::RasterImage(image_entity("foto.jpg", (0.0, 0.0))));
    t.add(None, EntityType::RasterImage(image_entity("D:\\project\\beelden\\foto.jpg", (2000.0, 0.0))));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));

    let pdf = dir.path().join("hoofd.pdf");
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.images_embedded, 2);
    let bytes = std::fs::read(&pdf).unwrap();
    let raw = String::from_utf8_lossy(&bytes).to_string();
    assert_eq!(raw.matches("/Subtype /Image").count(), 1, "één beeldobject voor twee plaatsingen");
    assert!(raw.contains("/Filter /DCTDecode") && raw.contains("/ColorSpace /DeviceGray"));
    assert!(bytes.windows(jpeg.len()).any(|w| w == jpeg.as_slice()), "de JPEG-bytes staan er ongewijzigd in");
    assert!(!raw.contains("MEELIFTER"), "wat achter het einde van het beeld stond, staat niet in de PDF");
    assert!(raw.contains(&format!("/Length {}", jpeg.len())));
    let (_, content) = content_of(&pdf);
    assert_eq!(content.matches("/Im0 Do").count(), 2);
}

#[test]
fn missing_unsafe_and_broken_images_are_counted_and_the_import_goes_on() {
    let dir = TempDir::new("beeld-weg");
    std::fs::write(dir.path().join("kaart.png"), super::image::tests_sample_png()).unwrap();
    std::fs::write(dir.path().join("kapot.png"), b"\x89PNG\r\n\x1a\n en verder onzin").unwrap();
    std::fs::write(dir.path().join("bom.png"), super::image::tests_png(60_000, 60_000, 8, 6, &[0; 64], &[])).unwrap();
    std::fs::write(dir.path().join("scan.tif"), b"II*\x00").unwrap();
    std::fs::write(dir.path().join("vierkanaals.jpg"), super::image::tests_sample_jpeg(4, 8, 4, 0xC0, 8)).unwrap();
    let buiten = TempDir::new("beeld-buiten");
    std::fs::write(buiten.path().join("elders.png"), super::image::tests_sample_png()).unwrap();
    let outside = buiten.path().join("elders.png").to_string_lossy().to_string();

    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    t.line(None, "Beeld", Color::ByLayer, (0.0, 0.0), (1000.0, 1000.0));
    let targets = [
        ("bestaat-niet.png", "missing"),
        ("kapot.png", "unsupported"),
        ("vierkanaals.jpg", "unsupported"),
        ("bom.png", "too large"),
        ("scan.tif", "missing"),
        (outside.as_str(), "missing"),
        ("..\\beeld-buiten\\elders.png", "missing"),
        ("", "missing"),
        ("\\\\server\\deel\\kaart.png", "refused"),
        ("//server/deel/kaart.png", "refused"),
        ("\\\\?\\C:\\kaart.png", "refused"),
        ("https://elders/kaart.png", "refused"),
        ("file:///C:/kaart.png", "refused"),
        ("kaart.png:stroom", "refused"),
        ("NUL.png", "odd"),
        ("COM1", "odd"),
        ("kaart.png.", "odd"),
        ("NUL/", "odd"),
    ];
    for (file, _) in &targets {
        t.add(None, EntityType::RasterImage(image_entity(file, (0.0, 0.0))));
    }
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let pdf = dir.path().join("hoofd.pdf");
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let missing = targets.iter().filter(|t| t.1 == "missing").count() as u64;
    let refused = targets.iter().filter(|t| t.1 == "refused").count() as u64;
    let odd = targets.iter().filter(|t| t.1 == "odd").count() as u64;
    assert_eq!((result.stats.images_missing, result.stats.images_refused), (missing, refused));
    assert_eq!(result.stats.odd_names, odd);
    assert!(result.warnings.iter().any(|w| *w == format!("oddNames:{odd}")), "{:?}", result.warnings);
    // Te groot en niet ondersteund zijn eigen tellingen met een eigen melding.
    assert_eq!((result.stats.images_too_large, result.stats.images_unsupported), (1, 2));
    assert!(result.warnings.iter().any(|w| w == "imagesTooLarge:1"), "{:?}", result.warnings);
    assert!(result.warnings.iter().any(|w| w == "imagesUnsupported:2"), "{:?}", result.warnings);
    assert_eq!(result.stats.images_embedded, 0);
    assert!(result.warnings.iter().any(|w| *w == format!("imagesMissing:{missing}")), "{:?}", result.warnings);
    assert!(result.warnings.iter().any(|w| *w == format!("imagesRefused:{refused}")), "{:?}", result.warnings);
    assert!(!String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).contains("/Subtype /Image"));

    // Dezelfde map uitdrukkelijk gekozen: dan mag het bestand van buiten wél.
    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    t.add(None, EntityType::RasterImage(image_entity(&outside, (0.0, 0.0))));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let chosen = ImportOptions { search_paths: vec![buiten.path().to_path_buf()], ..Default::default() };
    let result = convert(&drawing, &chosen, &dir.path().join("gekozen.pdf"), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.images_embedded, 1);
}

#[test]
fn an_image_is_clipped_on_its_frame_and_faded() {
    use acadrust::entities::{ClipBoundary, ClipMode};
    use acadrust::types::Vector2;
    let dir = TempDir::new("beeld-kader");
    std::fs::write(dir.path().join("kaart.png"), super::image::tests_sample_png()).unwrap();
    let store = super::image::ImageStore::new(SearchPaths::new(Some(dir.path()), &[]), super::image::MAX_IMAGE_PIXELS);

    /// Onthoudt beelden en knippaden.
    #[derive(Default)]
    struct Seen {
        images: Vec<(f64, Matrix)>,
        clips: Vec<(Option<[f64; 4]>, bool)>,
    }
    impl Sink for Seen {
        fn stroke(&mut self, _: &str, _: &Stroke, _: &PagePath) {}
        fn fill(&mut self, _: &str, _: style::Rgb, _: f64, _: &PagePath, _: bool) {}
        fn text(&mut self, _: &str, _: style::Rgb, _: f64, _: Matrix, _: &[u8], _: super::text::FontChoice) {}
        fn image(&mut self, _: &str, alpha: f64, matrix: Matrix, _: &str, _: &std::rc::Rc<super::image::Raster>) {
            self.images.push((alpha, matrix));
        }
        fn push_clip(&mut self, path: &PagePath, even_odd: bool) {
            self.clips.push((path.bounds(), even_odd));
        }
    }
    let walk = |entity: RasterImage| {
        let mut t = TestDoc::new();
        t.add(None, EntityType::RasterImage(entity));
        let drawing = t.drawing();
        let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
        walker.with_images(&store);
        let mut sink = Seen::default();
        walker.model_space(Xform3::IDENTITY, &mut sink);
        (sink, walker.stats.clone())
    };

    // Het standaardkader (het hele beeld): niets te knippen. Half vervaagd.
    let mut whole = image_entity("kaart.png", (100.0, 200.0));
    whole.clipping_enabled = true;
    whole.fade = 50;
    let (sink, stats) = walk(whole);
    assert!(sink.clips.is_empty());
    assert_eq!(stats.images_embedded, 1);
    let (alpha, matrix) = sink.images[0];
    assert!((alpha - 0.5).abs() < 1e-12);
    assert_eq!((matrix.a, matrix.d, matrix.e, matrix.f), (1000.0, 1000.0, 100.0, 200.0));

    // Een rechthoekig kader op het beeldpunt linksboven: de linkerbovenhoek
    // van het vlak (y loopt in het bestand naar beneden).
    let mut corner = image_entity("kaart.png", (0.0, 0.0));
    corner.clipping_enabled = true;
    corner.clip_boundary = ClipBoundary::rectangular(Vector2::new(-0.5, -0.5), Vector2::new(0.5, 0.5));
    let (sink, _) = walk(corner);
    assert_eq!(sink.clips, vec![(Some([0.0, 500.0, 500.0, 1000.0]), false)]);

    // Een veelhoek die juist het binnenste wegknipt: het hele beeld min de
    // veelhoek, even-oneven.
    let mut hole = image_entity("kaart.png", (0.0, 0.0));
    hole.clipping_enabled = true;
    hole.clip_boundary = ClipBoundary::polygonal(vec![Vector2::new(0.0, 0.0), Vector2::new(1.0, 0.0), Vector2::new(0.5, 1.0)]);
    hole.clip_boundary.clip_mode = ClipMode::Inside;
    let (sink, _) = walk(hole);
    assert_eq!(sink.clips, vec![(Some([0.0, 0.0, 1000.0, 1000.0]), true)]);

    // Uitgezet in de tekening, en een beeld zonder oppervlak.
    let mut hidden = image_entity("kaart.png", (0.0, 0.0));
    hidden.flags = acadrust::entities::ImageDisplayFlags::USE_CLIPPING_BOUNDARY;
    let (sink, stats) = walk(hidden);
    assert!(sink.images.is_empty());
    assert_eq!((stats.images_embedded, stats.images_missing, stats.images_skipped), (0, 0, 0));
    let mut flat = image_entity("kaart.png", (0.0, 0.0));
    flat.v_vector = Vector3::new(0.0, 0.0, 0.0);
    let (sink, stats) = walk(flat);
    assert!(sink.images.is_empty());
    assert_eq!(stats.images_missing, 1);
    let mut wild = image_entity("kaart.png", (0.0, 0.0));
    wild.u_vector = Vector3::new(f64::NAN, f64::INFINITY, 0.0);
    let (sink, _) = walk(wild);
    assert!(sink.images.is_empty());
}

#[test]
fn an_image_in_an_external_reference_is_found_next_to_that_reference() {
    let dir = TempDir::new("beeld-xref");
    let sub = dir.path().join("onderdelen");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("kaart.png"), super::image::tests_sample_png()).unwrap();
    let mut child = TestDoc::new();
    child.layer("Beeld", 1, |_| {});
    // In een bestand staat het pad in de beelddefinitie, niet in de IMAGE zelf.
    let mut definition = acadrust::objects::ImageDefinition::with_dimensions("kaart.png", 2, 2);
    definition.handle = child.doc.allocate_handle();
    let mut entity = image_entity("", (0.0, 0.0));
    entity.definition_handle = Some(definition.handle);
    child.doc.objects.insert(definition.handle, acadrust::objects::ObjectType::ImageDefinition(definition));
    child.add(None, EntityType::RasterImage(entity));
    write_dxf(&child.doc, &sub.join("detail.dxf"));
    let drawing = host_with_xref(dir.path(), "onderdelen\\detail.dxf");

    let pdf = dir.path().join("hoofd.pdf");
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!((result.stats.xrefs_loaded, result.stats.images_embedded), (1, 1), "{:?}", result.warnings);
    assert!(String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).contains("/Subtype /Image"));
}

#[test]
fn the_same_image_on_two_pages_is_one_object_and_the_arguments_come_through() {
    let dir = TempDir::new("beeld-bladen");
    std::fs::write(dir.path().join("kaart.png"), super::image::tests_sample_png()).unwrap();
    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    t.add(None, EntityType::RasterImage(image_entity("kaart.png", (0.0, 0.0))));
    t.doc.add_layout("Blad").unwrap();
    t.doc.add_entity_to_layout(EntityType::RasterImage(image_entity("kaart.png", (0.0, 0.0))), "Blad").unwrap();
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let options = ImportOptions { spaces: vec!["model".into(), "Blad".into()], ..Default::default() };
    let pdf = dir.path().join("bladen.pdf");
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.pages.len(), 2);
    assert_eq!(result.stats.images_embedded, 2);
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert_eq!(raw.matches("/Subtype /Image").count(), 1, "twee pagina's delen één beeldobject");
    assert_eq!(raw.matches("/XObject <<").count(), 2, "elke pagina noemt het in haar bronnen");

    let args: ImportArgs = serde_json::from_str(
        r#"{"path":"a.dwg","outputPath":"a.pdf","images":false,"maxImagePixels":1000,"xrefs":false,"searchPaths":["C:/wel","  "]}"#,
    )
    .unwrap();
    let options = args.options();
    assert!(!options.images && !options.xrefs);
    assert_eq!(options.max_image_pixels, 1000);
    assert_eq!(options.search_paths, vec![PathBuf::from("C:/wel")]);
    let options = serde_json::from_str::<ImportArgs>(r#"{"path":"a.dwg","outputPath":"a.pdf"}"#).unwrap().options();
    assert!(options.images && options.xrefs && options.search_paths.is_empty());
    assert_eq!(options.max_image_pixels, super::image::MAX_IMAGE_PIXELS);
}

// ── Wat er van buiten de tekening gelezen wordt ──────────────────────────

use super::xref::{ExternalKind, ExternalStatus, MAX_LISTED_EXTERNALS};

/// Een tekening die naar van alles buiten zichzelf wijst.
fn drawing_with_outside_files(dir: &Path) -> Drawing {
    write_facade(&dir.join("gevel.dxf"), 1000.0);
    std::fs::write(dir.join("kaart.png"), super::image::tests_sample_png()).unwrap();
    std::fs::write(dir.join("kapot.png"), b"\x89PNG\r\n\x1a\n en verder onzin").unwrap();
    std::fs::write(dir.join("bom.png"), super::image::tests_png(60_000, 60_000, 8, 6, &[0; 64], &[])).unwrap();
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.layer("Beeld", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (1000.0, 1000.0));
    for (name, target) in [("GEVEL", "D:\\project\\2026\\gevel.dxf"), ("WEG", "..\\elders\\weg.dwg"), ("NET", "\\\\server\\deel\\net.dwg"), ("APPARAAT", "NUL.dwg")] {
        t.xref(name, target);
        t.insert(None, name, "Kader", Color::ByLayer, (0.0, 0.0));
    }
    for file in ["C:\\beelden\\kaart.png", "kaart.png", "zoek.jpg", "kapot.png", "bom.png", "https://elders/foto.jpg", "COM1.png"] {
        t.add(None, EntityType::RasterImage(image_entity(file, (0.0, 0.0))));
    }
    t.drawing_at(dir.join("hoofd.dxf"))
}

fn listed(files: &[super::xref::ExternalFile]) -> Vec<(String, ExternalKind, ExternalStatus)> {
    let mut out: Vec<_> = files.iter().map(|f| (f.name.clone(), f.kind, f.status)).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[test]
fn the_result_names_the_files_that_were_read_from_outside_the_drawing() {
    let dir = TempDir::new("buiten-verslag");
    let drawing = drawing_with_outside_files(dir.path());
    let pdf = dir.path().join("hoofd.pdf");
    let result = convert(&drawing, &ImportOptions::default(), &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    use ExternalKind::{Image, Xref};
    use ExternalStatus::{Loaded, Missing, OddName, Refused, TooLarge, Unsupported};
    assert_eq!(
        listed(&result.externals),
        vec![
            ("COM1.png".to_string(), Image, OddName),
            ("NUL.dwg".to_string(), Xref, OddName),
            ("bom.png".to_string(), Image, TooLarge),
            ("foto.jpg".to_string(), Image, Refused),
            ("gevel.dxf".to_string(), Xref, Loaded),
            ("kaart.png".to_string(), Image, Loaded),
            ("kapot.png".to_string(), Image, Unsupported),
            ("net.dwg".to_string(), Xref, Refused),
            ("weg.dwg".to_string(), Xref, Missing),
            ("zoek.jpg".to_string(), Image, Missing),
        ]
    );
    assert!(!result.externals_truncated);
    // Alleen namen: geen map, geen station, geen server.
    let folder = dir.path().to_string_lossy().to_string();
    let json = serde_json::to_string(&result.externals).unwrap();
    for file in &result.externals {
        assert!(!file.name.contains('/') && !file.name.contains('\\') && !file.name.contains(':'), "{}", file.name);
    }
    assert!(!json.contains(&folder) && !json.contains("project") && !json.contains("server"), "{json}");
    assert!(json.contains(r#"{"name":"gevel.dxf","kind":"xref","status":"loaded"}"#), "{json}");
    assert!(json.contains(r#"{"name":"COM1.png","kind":"image","status":"oddName"}"#), "{json}");
    let whole = serde_json::to_value(&result).unwrap();
    assert!(whole.get("externals").is_some() && whole.get("externalsTruncated").is_some());

    // Niets van buiten gevraagd: dan is er ook niets te melden.
    let off = ImportOptions { xrefs: false, images: false, ..Default::default() };
    let result = convert(&drawing, &off, &dir.path().join("zonder.pdf"), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.externals.is_empty() && !result.externals_truncated);
}

#[test]
fn the_scan_tells_which_outside_files_would_be_read_without_reading_them() {
    let dir = TempDir::new("buiten-verkenning");
    let drawing = drawing_with_outside_files(dir.path());
    let scanned = scan::scan(&drawing, &AtomicBool::new(false)).unwrap();
    use ExternalKind::{Image, Xref};
    use ExternalStatus::{Found, Missing, OddName, Refused};
    assert_eq!(
        listed(&scanned.externals),
        vec![
            ("COM1.png".to_string(), Image, OddName),
            ("NUL.dwg".to_string(), Xref, OddName),
            // Te groot of kapot blijkt pas bij het lezen: de verkenning leest niet.
            ("bom.png".to_string(), Image, Found),
            ("foto.jpg".to_string(), Image, Refused),
            ("gevel.dxf".to_string(), Xref, Found),
            ("kaart.png".to_string(), Image, Found),
            ("kapot.png".to_string(), Image, Found),
            ("net.dwg".to_string(), Xref, Refused),
            ("weg.dwg".to_string(), Xref, Missing),
            ("zoek.jpg".to_string(), Image, Missing),
        ]
    );
    assert!(!scanned.externals_truncated);
    let json = serde_json::to_value(&scanned).unwrap();
    assert_eq!(json["externals"].as_array().map(|a| a.len()), Some(10));
    assert_eq!(json["externalsTruncated"], serde_json::json!(false));

    // Een tekening zonder verwijzingen meldt niets.
    let plain = rectangle_at(0.0, 0.0);
    let scanned = scan::scan(&plain, &AtomicBool::new(false)).unwrap();
    assert!(scanned.externals.is_empty() && !scanned.externals_truncated);
}

#[test]
fn a_search_path_the_user_chose_is_searched_by_the_scan_too() {
    let dir = TempDir::new("verkenning-zoekpad");
    let elders = dir.path().join("verwijzingen");
    std::fs::create_dir_all(&elders).unwrap();
    write_facade(&elders.join("gevel.dxf"), 1000.0);
    let drawing = host_with_xref(&dir.path().join("werk"), "gevel.dxf");
    std::fs::create_dir_all(dir.path().join("werk")).unwrap();
    let go = AtomicBool::new(false);
    use ExternalKind::Xref;
    use ExternalStatus::{Found, Missing};

    // Zonder zoekpad: alleen de map van de tekening telt.
    let scanned = scan::scan(&drawing, &go).unwrap();
    assert_eq!(listed(&scanned.externals), vec![("gevel.dxf".to_string(), Xref, Missing)]);

    // Met het zoekpad van de gebruiker klopt de lijst met wat de import zal doen.
    let paths = vec![elders.clone()];
    let scanned = scan_drawing_with_paths(&drawing, &paths, &go, |_| {}).unwrap();
    assert_eq!(listed(&scanned.externals), vec![("gevel.dxf".to_string(), Xref, Found)]);

    // Alleen opnieuw zoeken, zonder de hele verkenning: dezelfde uitkomst.
    let (files, truncated) = locate_externals(&drawing, &paths, &go);
    assert_eq!(listed(&files), vec![("gevel.dxf".to_string(), Xref, Found)]);
    assert!(!truncated);
    let (files, _) = locate_externals(&drawing, &[], &go);
    assert_eq!(listed(&files), vec![("gevel.dxf".to_string(), Xref, Missing)]);

    // Een zoekpad dat niet bestaat doet niets, ook geen kwaad.
    let (files, _) = locate_externals(&drawing, &[dir.path().join("bestaat-niet")], &go);
    assert_eq!(listed(&files), vec![("gevel.dxf".to_string(), Xref, Missing)]);
}

#[test]
fn an_over_long_list_of_search_paths_is_refused_while_reading() {
    let paths = |n: usize| {
        let rows: Vec<String> = (0..n).map(|i| format!(r#""C:/map-{i}""#)).collect();
        format!(r#"{{"path":"a.dxf","outputPath":"a.pdf","searchPaths":[{}]}}"#, rows.join(","))
    };
    let args: ImportArgs = serde_json::from_str(&paths(super::xref::MAX_SEARCH_PATHS)).unwrap();
    assert_eq!(args.options().search_paths.len(), super::xref::MAX_SEARCH_PATHS);
    let error = serde_json::from_str::<ImportArgs>(&paths(super::xref::MAX_SEARCH_PATHS + 1)).unwrap_err().to_string();
    assert!(error.contains("IMPORT_ARGS_TOO_LONG:searchPaths:16"), "{error}");
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","searchPaths":null}"#).unwrap();
    assert!(args.search_paths.is_empty());
}

#[test]
fn the_list_of_outside_files_is_bounded_in_the_result_and_in_the_scan() {
    let dir = TempDir::new("buiten-veel");
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.layer("Beeld", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (1000.0, 1000.0));
    for i in 0..MAX_LISTED_EXTERNALS {
        t.xref(&format!("X{i}"), &format!("weg-{i}.dwg"));
        t.add(None, EntityType::RasterImage(image_entity(&format!("weg-{i}.png"), (0.0, 0.0))));
    }
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let scanned = scan::scan(&drawing, &AtomicBool::new(false)).unwrap();
    assert_eq!(scanned.externals.len(), MAX_LISTED_EXTERNALS);
    assert!(scanned.externals_truncated);
    let result = convert(&drawing, &ImportOptions::default(), &dir.path().join("veel.pdf"), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.externals.len(), MAX_LISTED_EXTERNALS);
    assert!(result.externals_truncated);
}

// ── Blokken als formulier ────────────────────────────────────────────────

#[test]
fn a_block_placed_many_times_becomes_one_form_object() {
    let mut t = TestDoc::new();
    t.layer("Symbolen", 1, |_| {});
    let blok = t.block("STIP");
    for n in 0..6 {
        t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, n as f64), (10.0, n as f64));
        t.line(Some(blok), "Symbolen", Color::ByLayer, (n as f64, 0.0), (n as f64, 10.0));
    }
    for n in 0..40 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 100.0, 0.0));
    }
    let drawing = t.drawing();

    let dir = work_dir("formulieren");
    let met = dir.join("met.pdf");
    let options = ImportOptions { scale: Some(20.0), ..Default::default() };
    let result = convert(&drawing, &options, &met, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.forms_written, 1, "één formulier voor het blok");
    // De eerste plaatsing staat gewoon in de pagina; de tweede maakt het
    // formulier en de andere 38 verwijzen ernaar.
    assert_eq!(result.stats.forms_reused, 39, "de andere 39 plaatsingen gaan via het formulier");
    let raw = String::from_utf8_lossy(&std::fs::read(&met).unwrap()).to_string();
    assert_eq!(raw.matches("/Subtype /Form").count(), 1);
    let (_, content) = content_of(&met);
    assert_eq!(content.matches("/Fm0 Do").count(), 39);

    // Zonder hergebruik is het bestand groter en staan er geen formulieren in.
    let zonder = dir.join("zonder.pdf");
    let options = ImportOptions { reuse_blocks: false, ..options.clone() };
    let plat = convert(&drawing, &options, &zonder, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(plat.stats.forms_written, 0);
    assert!(!String::from_utf8_lossy(&std::fs::read(&zonder).unwrap()).contains("/Subtype /Form"));
    assert!(
        std::fs::metadata(&zonder).unwrap().len() > std::fs::metadata(&met).unwrap().len(),
        "hergebruik hoort kleiner te zijn"
    );
    // Het verslag is hetzelfde: de plaatsingen tellen mee alsof ze zijn
    // uitgevouwen.
    assert_eq!(plat.pages[0].objects, result.pages[0].objects);
    let mut same = result.stats.clone();
    same.forms_written = 0;
    same.forms_reused = 0;
    assert_eq!(same, plat.stats);

    // De optie komt door de argumenten van de webview.
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","outputPath":"a.pdf","reuseBlocks":false}"#).unwrap();
    assert!(!args.options().reuse_blocks);
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","outputPath":"a.pdf"}"#).unwrap();
    assert!(args.options().reuse_blocks, "standaard aan");
}

#[test]
fn a_block_at_another_scale_or_angle_gets_its_own_form() {
    let mut t = TestDoc::new();
    t.layer("Symbolen", 1, |_| {});
    let blok = t.block("PIJL");
    for n in 0..30 {
        t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, n as f64), (10.0, n as f64 + 1.0));
    }
    for n in 0..12 {
        t.insert(None, "PIJL", "Symbolen", Color::ByLayer, (n as f64 * 50.0, 0.0));
    }
    // Twaalf keer gedraaid: een eigen formulier.
    for n in 0..12 {
        let mut insert = Insert::new("PIJL", Vector3::new(n as f64 * 50.0, 100.0, 0.0));
        insert.common.layer = "Symbolen".into();
        insert.rotation = std::f64::consts::FRAC_PI_2;
        t.add(None, EntityType::Insert(insert));
    }
    let drawing = t.drawing();
    let dir = work_dir("formulieren-hoek");
    let pdf = dir.join("hoek.pdf");
    let options = ImportOptions { scale: Some(20.0), ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.forms_written, 2);
    // Van elk gaat de eerste plaatsing gewoon de pagina in.
    assert_eq!(result.stats.forms_reused, 22);
}

/// Eén onderdeel zoals het op de pagina komt: de laag, de stijl die op dat
/// moment gold en de punten (in honderdsten van een punt). Formulieren zijn
/// uitgevouwen, zodat een pagina met en een pagina zonder formulieren
/// onderdeel voor onderdeel te vergelijken zijn.
#[derive(Debug, Clone, PartialEq)]
struct Drawn {
    layer: String,
    style: String,
    points: Vec<(i64, i64)>,
}

#[derive(Clone)]
struct Gs {
    dx: f64,
    dy: f64,
    stroke: String,
    fill: String,
    width: String,
    cap: String,
    join: String,
    dash: String,
    alpha: String,
}

fn unfold_into(content: &[u8], forms: &[pdf_out::PageForm], layers: &[String], start: Gs, depth: usize, out: &mut Vec<Drawn>) {
    assert!(depth < 40, "formulieren die elkaar eindeloos plaatsen");
    let text = String::from_utf8_lossy(content).to_string();
    let mut g = start;
    let mut saved: Vec<Gs> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut operands: Vec<String> = Vec::new();
    let mut path: Vec<(i64, i64)> = Vec::new();
    let mut clip = false;
    let mut tm = String::new();
    let mut at = (0, 0);
    let number = |s: &String| s.parse::<f64>().unwrap_or_else(|_| panic!("geen getal: {s}"));
    let cent = |v: f64| (v * 100.0).round() as i64;
    for token in text.split_whitespace() {
        match token {
            "m" | "l" => {
                let (x, y) = (number(&operands[0]), number(&operands[1]));
                if token == "m" {
                    path.push((i64::MIN, 0));
                }
                path.push((cent(x + g.dx), cent(y + g.dy)));
            }
            "c" => {
                for pair in operands.chunks(2) {
                    path.push((cent(number(&pair[0]) + g.dx), cent(number(&pair[1]) + g.dy)));
                }
            }
            "h" => path.push((i64::MAX, 0)),
            "W" | "W*" => clip = true,
            "S" => {
                let style = format!("S {} w{} J{} j{} d{} a{}", g.stroke, g.width, g.cap, g.join, g.dash, g.alpha);
                out.push(Drawn { layer: stack.last().cloned().unwrap_or_default(), style, points: std::mem::take(&mut path) });
            }
            "f" | "f*" => {
                let style = format!("{token} {} a{}", g.fill, g.alpha);
                out.push(Drawn { layer: stack.last().cloned().unwrap_or_default(), style, points: std::mem::take(&mut path) });
            }
            "n" => {
                if clip {
                    out.push(Drawn { layer: String::new(), style: "knip".into(), points: std::mem::take(&mut path) });
                }
                clip = false;
                path.clear();
            }
            "q" => saved.push(g.clone()),
            // Een plaatsing zet er een `q … Q` omheen; waar een knip eindigt
            // blijkt uit wat er daarna nog binnen valt.
            "Q" => g = saved.pop().expect("Q zonder q"),
            "cm" => {
                let v: Vec<f64> = operands.iter().map(number).collect();
                assert_eq!(&v[..4], &[1.0, 0.0, 0.0, 1.0], "een plaatsing verschuift alleen");
                g.dx += v[4];
                g.dy += v[5];
            }
            "RG" | "G" => g.stroke = operands.join(" "),
            "rg" | "g" => g.fill = operands.join(" "),
            "w" => g.width = operands.join(" "),
            "J" => g.cap = operands.join(" "),
            "j" => g.join = operands.join(" "),
            "d" => g.dash = operands.join(" "),
            "gs" => g.alpha = operands.join(" "),
            "BDC" => {
                let index: usize = operands[1].trim_start_matches("/L").parse().unwrap();
                stack.push(layers[index].clone());
            }
            "EMC" => {
                stack.pop().expect("EMC zonder BDC");
            }
            "Do" => {
                let slot: usize = operands[0].trim_start_matches("/Fm").parse().unwrap();
                assert!(stack.is_empty(), "een formulier staat nooit binnen de laag van iets anders");
                // Een formulier erft de toestand en geeft hem ongewijzigd terug.
                let form = forms.iter().find(|f| f.number == slot).expect("het formulier bestaat");
                unfold_into(&form.content, forms, layers, g.clone(), depth + 1, out);
            }
            "Tm" => {
                let v: Vec<f64> = operands.iter().map(number).collect();
                tm = format!("{} {} {} {}", v[0], v[1], v[2], v[3]);
                at = (cent(v[4] + g.dx), cent(v[5] + g.dy));
            }
            "Tj" => {
                let style = format!("tekst {} a{} [{tm}] {}", g.fill, g.alpha, operands.join(" "));
                out.push(Drawn { layer: stack.last().cloned().unwrap_or_default(), style, points: vec![at] });
            }
            "BT" | "ET" | "Tf" | "Tr" => {}
            other => {
                operands.push(other.to_string());
                continue;
            }
        }
        operands.clear();
    }
    assert!(stack.is_empty(), "elke laag is weer gesloten");
    assert!(saved.is_empty(), "elke q heeft zijn Q");
}

struct DrawnPage {
    drawn: Vec<Drawn>,
    forms: Vec<pdf_out::PageForm>,
    content: Vec<u8>,
    stats: walk::WalkStats,
    charged: usize,
    items: u64,
}

/// Tekent een ruimte op een pagina van 1000 × 1000 punten, tien eenheden per
/// punt, met of zonder formulieren; `window` knipt de pagina (paginapunten).
fn drawn_page(drawing: &Drawing, space: Option<&str>, reuse: bool, window: Option<[f64; 4]>) -> DrawnPage {
    drawn_page_with(drawing, None, space, reuse, window)
}

fn drawn_page_with(drawing: &Drawing, xrefs: Option<&XrefDocs>, space: Option<&str>, reuse: bool, window: Option<[f64; 4]>) -> DrawnPage {
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(reuse);
    if let Some(w) = window {
        let mut path = PagePath::new();
        path.move_to(Point::new(w[0], w[1]));
        path.line_to(Point::new(w[2], w[1]));
        path.line_to(Point::new(w[2], w[3]));
        path.line_to(Point::new(w[0], w[3]));
        path.close();
        builder.clip_to(&path);
    }
    let mut walker = Walker::new(&drawing.document, WalkSettings { reuse_blocks: reuse, ..Default::default() }, true);
    if let Some(xrefs) = xrefs {
        walker.with_xrefs(xrefs);
    }
    match space {
        None => walker.model_space(Xform3::from_matrix(&Matrix::scale(0.1, 0.1)), &mut builder),
        Some(name) => {
            let record = scan::space_record(&drawing.document, name).expect("layout");
            walker.paper_space(&record.record, Xform3::IDENTITY, &mut builder);
        }
    }
    assert!(!walker.cancelled && !walker.too_complex);
    let stats = walker.stats.clone();
    let (charged, items) = (builder.charged_bytes(), builder.items);
    let (content, _, _, _, _, forms) = builder.finish();
    let start = Gs {
        dx: 0.0,
        dy: 0.0,
        stroke: String::new(),
        fill: String::new(),
        width: String::new(),
        cap: String::new(),
        join: String::new(),
        dash: "[] 0".into(),
        alpha: String::new(),
    };
    let mut drawn = Vec::new();
    unfold_into(&content, &forms, &registry.names, start, 0, &mut drawn);
    DrawnPage { drawn, forms, content, stats, charged, items }
}

fn without_form_counts(stats: &walk::WalkStats) -> walk::WalkStats {
    walk::WalkStats { forms_written: 0, forms_reused: 0, ..stats.clone() }
}

/// Een symbool dat alles gebruikt wat per plaatsing kan verschillen: laag 0,
/// ByBlock-kleur, een eigen laag met een lijntype, en tekst.
fn symbols() -> TestDoc {
    let mut t = TestDoc::new();
    t.layer("Symbolen", 1, |_| {});
    t.layer("Groen", 3, |l| l.line_weight = acadrust::types::LineWeight::Value(50));
    let mut dashed = acadrust::tables::LineType::new("STREEP");
    dashed.add_element(acadrust::tables::linetype::LineTypeElement::dash(50.0));
    dashed.add_element(acadrust::tables::linetype::LineTypeElement::space(-30.0));
    dashed.set_handle(t.doc.allocate_handle());
    t.doc.line_types.add(dashed).unwrap();
    t.layer("Eigen", 5, |l| l.line_type = "STREEP".into());
    let stip = t.block("STIP");
    t.line(Some(stip), "0", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    t.line(Some(stip), "0", Color::ByBlock, (0.0, 0.0), (0.0, 100.0));
    t.line(Some(stip), "Eigen", Color::ByLayer, (0.0, 0.0), (100.0, 100.0));
    for n in 0..30 {
        t.line(Some(stip), "0", Color::ByLayer, (3.0 * n as f64, 100.0), (3.0 * n as f64 + 5.0, 90.0));
    }
    let mut text = acadrust::entities::Text::with_value("S1", Vector3::new(10.0, 40.0, 0.0)).with_height(20.0);
    text.common.layer = "0".into();
    t.add(Some(stip), EntityType::Text(text));
    // Een blok in een blok: zes symbolen en zes eigen lijnen.
    let groep = t.block("GROEP");
    for n in 0..6 {
        t.insert(Some(groep), "STIP", "0", Color::ByBlock, (n as f64 * 150.0, 0.0));
        t.line(Some(groep), "0", Color::ByLayer, (0.0, 150.0 + n as f64 * 10.0), (850.0, 150.0 + n as f64 * 10.0));
    }
    t
}

#[test]
fn a_page_with_forms_draws_exactly_what_the_flat_page_draws() {
    let mut t = symbols();
    // Gewoon, op laag Symbolen.
    for n in 0..6 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 300.0, 0.0));
        // Iets ertussen: de volgorde van tekenen moet blijven.
        t.line(None, "Symbolen", Color::ByLayer, (n as f64 * 300.0, 120.0), (n as f64 * 300.0 + 100.0, 120.0));
    }
    // Op een andere laag (andere kleur en dikte voor laag 0) en met een
    // eigen ByBlock-kleur.
    for n in 0..12 {
        t.insert(None, "STIP", "Groen", Color::Index(2), (n as f64 * 300.0, 500.0));
    }
    // Drie keer met weer een andere kleur: te weinig om een formulier te
    // lonen, dus die opname komt bij het afronden alsnog in de pagina zelf.
    for n in 0..3 {
        t.insert(None, "STIP", "Groen", Color::Index(6), (n as f64 * 300.0, 700.0));
    }
    // Gedraaid, en vergroot.
    for n in 0..12 {
        let mut insert = Insert::new("STIP", Vector3::new(n as f64 * 300.0 + 200.0, 1000.0, 0.0));
        insert.common.layer = "Symbolen".into();
        insert.rotation = std::f64::consts::FRAC_PI_2;
        t.add(None, EntityType::Insert(insert));
        let mut insert = Insert::new("STIP", Vector3::new(n as f64 * 300.0, 1500.0, 0.0));
        insert.common.layer = "Symbolen".into();
        insert.set_x_scale(2.0);
        insert.set_y_scale(2.0);
        t.add(None, EntityType::Insert(insert));
    }
    // Het blok in een blok, zestien keer; en een rooster.
    for n in 0..16 {
        t.insert(None, "GROEP", "Groen", Color::Index(4), ((n % 4) as f64 * 1000.0, 2500.0 + (n / 4) as f64 * 400.0));
    }
    let mut rooster = Insert::new("STIP", Vector3::new(0.0, 4500.0, 0.0));
    rooster.common.layer = "Symbolen".into();
    rooster.column_count = 3;
    rooster.row_count = 3;
    rooster.column_spacing = 250.0;
    rooster.row_spacing = 250.0;
    t.add(None, EntityType::Insert(rooster));
    let drawing = t.drawing();

    let flat = drawn_page(&drawing, None, false, None);
    let with = drawn_page(&drawing, None, true, None);
    assert!(flat.forms.is_empty() && !flat.content.windows(3).any(|w| w == b" Do"));
    // Gewoon, andere laag, gedraaid, vergroot, de groep en het symbool in de
    // groep: elk zijn eigen formulier. De drie met de afwijkende kleur zijn
    // wel opgenomen, maar lonen niet: geen formulier.
    assert_eq!(with.forms.len(), 6, "{}", String::from_utf8_lossy(&with.content));
    assert_eq!(with.forms.iter().map(|f| f.number).collect::<Vec<_>>(), vec![0, 1, 3, 4, 5, 6], "de opname zonder formulier laat een gat");
    assert_eq!(with.drawn.len(), flat.drawn.len());
    for (i, (a, b)) in with.drawn.iter().zip(&flat.drawn).enumerate() {
        assert_eq!(a, b, "onderdeel {i}");
    }
    // Het verslag en de begroting zijn die van de uitgevouwen pagina.
    assert_eq!(without_form_counts(&with.stats), flat.stats);
    assert_eq!(with.items, flat.items);
    assert!(with.content.len() < flat.content.len() / 2, "{} tegen {}", with.content.len(), flat.content.len());
    assert!(with.charged >= flat.charged, "{} tegen {}", with.charged, flat.charged);
    // Zonder formulieren is de begroting gewoon de inhoudsstroom (het afsluiten
    // van de laatste laag komt er bij het afronden nog bij).
    assert!(flat.charged <= flat.content.len() && flat.content.len() - flat.charged <= 8);
    // Het formulier van de groep plaatst het formulier van het symbool.
    assert!(with.forms.iter().any(|f| f.content.windows(3).any(|w| w == b" Do")), "een formulier in een formulier");
}

#[test]
fn a_placement_outside_the_view_is_skipped_and_one_on_the_edge_is_drawn_flat() {
    let mut t = symbols();
    for n in 0..24 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 250.0, 0.0));
    }
    let drawing = t.drawing();
    // Tien eenheden per punt: het symbool is 10 × 10 punten en staat op
    // x = 0, 25, 50, … Het venster loopt van 30 tot 400: het eerste valt
    // erbuiten, het tweede half erin, veertien vallen er helemaal in, het
    // zeventiende half en de rest valt erbuiten.
    let window = Some([30.0, -5.0, 400.0, 50.0]);
    let flat = drawn_page(&drawing, None, false, window);
    let with = drawn_page(&drawing, None, true, window);
    assert_eq!(with.drawn, flat.drawn);
    assert_eq!(without_form_counts(&with.stats), flat.stats);
    assert_eq!(with.forms.len(), 1);
    assert_eq!(with.forms[0].uses, 14, "alleen de veertien die helemaal in beeld staan");
    // Buiten beeld kost geen wandeling, maar telt wel als bezocht.
    assert_eq!(with.stats.visits, flat.stats.visits);
}

#[test]
fn viewports_share_a_form_only_when_they_freeze_the_same_layers() {
    let mut t = symbols();
    for n in 0..14 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 200.0, 0.0));
    }
    let eigen = t.doc.layers.get("Eigen").unwrap().handle;
    t.doc.add_layout("Blad").unwrap();
    for (n, frozen) in [false, true, false].into_iter().enumerate() {
        let mut v = Viewport::with_size(Vector3::new(60.0 + n as f64 * 140.0, 60.0, 0.0), 100.0, 100.0);
        v.id = n as i16 + 2;
        v.view_center = Vector3::new(1_350.0, 50.0, 0.0);
        v.view_height = 4_000.0;
        if frozen {
            v.frozen_layers = vec![eigen];
        }
        t.doc.add_entity_to_layout(EntityType::Viewport(v), "Blad").unwrap();
    }
    let drawing = t.drawing();
    let flat = drawn_page(&drawing, Some("Blad"), false, None);
    let with = drawn_page(&drawing, Some("Blad"), true, None);
    assert_eq!(flat.stats.viewports_drawn, 3);
    assert_eq!(with.drawn, flat.drawn);
    assert_eq!(without_form_counts(&with.stats), flat.stats);
    // Het eerste en het derde venster delen een formulier; het tweede, waar
    // laag "Eigen" bevroren is, heeft zijn eigen formulier zonder die lijn.
    assert_eq!(with.forms.len(), 2);
    assert_eq!(with.forms.iter().map(|f| f.uses).collect::<Vec<_>>(), vec![13 + 14, 13]);
    let on_eigen = |page: &DrawnPage| page.drawn.iter().filter(|d| d.layer == "Eigen").count();
    assert_eq!(on_eigen(&with), 28);
}

#[test]
fn reusing_blocks_does_not_get_round_the_work_limits() {
    let mut t = TestDoc::new();
    t.layer("Veel", 1, |_| {});
    let blok = t.block("VEEL");
    for n in 0..20 {
        t.line(Some(blok), "Veel", Color::ByLayer, (0.0, n as f64), (50.0, n as f64));
    }
    for n in 0..3_000 {
        t.insert(None, "VEEL", "Veel", Color::ByLayer, ((n % 60) as f64 * 100.0, (n / 60) as f64 * 100.0));
    }
    let drawing = t.drawing();
    let dir = work_dir("formulieren-grenzen");
    let cancel = AtomicBool::new(false);
    // Elke plaatsing kost 22 bezoeken (de invoeging, de cel en twintig
    // lijnen), voor de grenzen en voor het tekenen: samen 132 000. Met
    // formulieren wordt het blok maar twee keer doorlopen, maar de plaatsingen
    // tellen mee alsof ze zijn uitgevouwen.
    for reuse in [true, false] {
        let tight = ImportOptions { scale: Some(50.0), max_visits: 100_000, reuse_blocks: reuse, ..Default::default() };
        let pdf = dir.join(format!("bezoeken-{reuse}.pdf"));
        assert_eq!(convert(&drawing, &tight, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex, "hergebruik {reuse}");
        let enough = ImportOptions { max_visits: 140_000, ..tight.clone() };
        let result = convert(&drawing, &enough, &pdf, &cancel, |_| {}).unwrap();
        assert_eq!(result.stats.visits, 66_000, "hergebruik {reuse}");
        assert_eq!(result.stats.entities, 63_000);
        assert_eq!(result.pages[0].objects, 60_000);
    }
    // De inhoud: uitgevouwen ruim een megabyte. Het bestand met formulieren
    // is veel kleiner, maar de bovengrens rekent met de uitgevouwen omvang.
    for reuse in [true, false] {
        let tight = ImportOptions { scale: Some(50.0), max_content_bytes: 400_000, reuse_blocks: reuse, ..Default::default() };
        let pdf = dir.join(format!("inhoud-{reuse}.pdf"));
        assert_eq!(convert(&drawing, &tight, &pdf, &cancel, |_| {}).unwrap_err(), ImportError::TooComplex, "hergebruik {reuse}");
        assert!(!pdf.exists());
    }
    // Twee pagina's delen de begroting: de eerste neemt haar uitgevouwen
    // omvang mee naar de tweede.
    let mut layouts = several_spaces(4_000);
    let blok = {
        let mut record = BlockRecord::new("VEEL");
        record.set_handle(layouts.document.allocate_handle());
        let handle = record.handle;
        layouts.document.block_records.add(record).unwrap();
        handle
    };
    for n in 0..20 {
        let mut line = Line::from_points(Vector3::new(0.0, n as f64, 0.0), Vector3::new(50.0, n as f64, 0.0));
        line.common.owner_handle = blok;
        layouts.document.add_entity(EntityType::Line(line)).unwrap();
    }
    for n in 0..1_000 {
        let insert = Insert::new("VEEL", Vector3::new((n % 40) as f64 * 100.0, (n / 40) as f64 * 100.0 + 50.0, 0.0));
        layouts.document.add_entity(EntityType::Insert(insert)).unwrap();
    }
    for reuse in [true, false] {
        let options = |spaces: &[&str], limit: usize| ImportOptions {
            spaces: spaces.iter().map(|s| s.to_string()).collect(),
            max_content_bytes: limit,
            reuse_blocks: reuse,
            ..Default::default()
        };
        let pdf = dir.join(format!("samen-{reuse}.pdf"));
        let fits = |spaces: &[&str], limit: usize| {
            let _ = std::fs::remove_file(&pdf);
            convert(&layouts, &options(spaces, limit), &pdf, &cancel, |_| {}).is_ok()
        };
        // Wat de modelruimte alleen nodig heeft, op een kilobyte na.
        let (mut low, mut high) = (0usize, 4_000_000usize);
        assert!(fits(&["model"], high));
        while high - low > 1_000 {
            let middle = (low + high) / 2;
            if fits(&["model"], middle) {
                high = middle;
            } else {
                low = middle;
            }
        }
        // Uitgevouwen is dat ruim een halve megabyte, met of zonder formulieren.
        assert!(high > 500_000, "hergebruik {reuse}: {high}");
        // Het blad past er alleen ruim in, maar niet meer achter het model.
        let limit = high + 50_000;
        assert!(fits(&["model"], limit) && fits(&["Blad1"], limit));
        assert!(!fits(&["model", "Blad1"], limit), "hergebruik {reuse}");
    }
}

#[test]
fn a_block_that_doubles_itself_stays_within_the_limits_with_forms() {
    // A voegt zichzelf twee keer in. Met formulieren zou dat een klein bestand
    // kunnen worden dat uitgevouwen miljoenen lijnen tekent; de grenzen
    // rekenen daarom met de uitgevouwen omvang.
    let mut t = TestDoc::new();
    let a = t.block("A");
    for n in 0..10 {
        t.line(Some(a), "0", Color::ByLayer, (0.0, n as f64), (1.0, n as f64));
    }
    t.insert(Some(a), "A", "0", Color::ByLayer, (1.0, 0.0));
    t.insert(Some(a), "A", "0", Color::ByLayer, (0.0, 1.0));
    t.insert(None, "A", "0", Color::ByLayer, (0.0, 0.0));
    let drawing = t.drawing();
    let started = std::time::Instant::now();
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(true).with_max_bytes(2_000_000);
    let mut walker = Walker::new(&drawing.document, WalkSettings { max_visits: 5_000_000, ..Default::default() }, true);
    walker.model_space(Xform3::IDENTITY, &mut builder);
    assert!(walker.too_complex, "een van de twee grenzen hoort te stoppen");
    assert!(started.elapsed().as_secs() < 20);
    drop(builder);

    // De twee grenzen elk apart. Met ruimte voor bezoeken stopt de omvang:
    // een geplaatst formulier kost geen bezoeken, dus alleen de uitgevouwen
    // bytes houden dit tegen.
    let started = std::time::Instant::now();
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(true).with_max_bytes(2_000_000);
    let mut walker = Walker::new(&drawing.document, WalkSettings { max_visits: u64::MAX, ..Default::default() }, true);
    walker.model_space(Xform3::IDENTITY, &mut builder);
    assert!(walker.too_complex, "de omvang hoort te stoppen");
    assert!(builder.charged_bytes() > 2_000_000, "{}", builder.charged_bytes());
    assert!(started.elapsed().as_secs() < 20);
    drop(builder);
    // Met ruimte voor bytes stoppen de bezoeken.
    let started = std::time::Instant::now();
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(true).with_max_bytes(usize::MAX);
    let mut walker = Walker::new(&drawing.document, WalkSettings { max_visits: 200_000, ..Default::default() }, true);
    walker.model_space(Xform3::IDENTITY, &mut builder);
    assert!(walker.too_complex, "de bezoeken horen te stoppen");
    assert!(walker.stats.visits >= 200_000, "{}", walker.stats.visits);
    assert!(started.elapsed().as_secs() < 20);
}

#[test]
fn a_form_recorded_inside_a_form_counts_in_full_for_the_form_around_it() {
    // C: veertig lijnen. B: één keer C en een lijn. A: één keer B en een lijn.
    // Het model: veertig keer A. De eerste A wordt gemeten (en B en C erin
    // ook); de tweede A wordt opgenomen, en binnen die opname worden B en C
    // voor het eerst opgenomen. Wat een plaatsing van A uitgevouwen kost, is
    // dan A zelf plus alles wat erin is opgenomen, en niet alleen de paar
    // bytes waarmee A naar B verwijst.
    let mut t = TestDoc::new();
    let c = t.block("C");
    for n in 0..40 {
        t.line(Some(c), "0", Color::ByLayer, (0.0, n as f64), (100.0, n as f64 + 0.5));
    }
    let b = t.block("B");
    t.insert(Some(b), "C", "0", Color::ByLayer, (0.0, 10.0));
    t.line(Some(b), "0", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    let a = t.block("A");
    t.insert(Some(a), "B", "0", Color::ByLayer, (10.0, 0.0));
    t.line(Some(a), "0", Color::ByLayer, (0.0, 0.0), (0.0, 60.0));
    for n in 0..40 {
        t.insert(None, "A", "0", Color::ByLayer, (100.0 + (n % 8) as f64 * 200.0, 100.0 + (n / 8) as f64 * 100.0));
    }
    let drawing = t.drawing();
    let flat = drawn_page(&drawing, None, false, None);
    let forms = drawn_page(&drawing, None, true, None);
    assert_eq!(forms.drawn, flat.drawn, "hetzelfde beeld");
    assert!(!forms.forms.is_empty());
    assert!(forms.content.len() * 4 < flat.content.len(), "de stroom zelf is veel kleiner");
    // De begroting rekent uitgevouwen: binnen een tiende van de platte stroom.
    let (low, high) = (flat.charged as f64 * 0.9, flat.charged as f64 * 1.2);
    assert!((low..=high).contains(&(forms.charged as f64)), "plat {} tegen formulieren {}", flat.charged, forms.charged);
}

#[test]
fn cancelling_in_the_middle_of_a_form_leaves_no_half_form_behind() {
    let mut t = symbols();
    for n in 0..4 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 300.0, 0.0));
    }
    let drawing = t.drawing();
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(true);
    // Het budget raakt op midden in de tweede plaatsing: de opname.
    let mut walker = Walker::new(&drawing.document, WalkSettings { max_visits: 9, ..Default::default() }, true);
    walker.model_space(Xform3::from_matrix(&Matrix::scale(0.1, 0.1)), &mut builder);
    assert!(walker.too_complex);
    let (content, _, _, _, _, forms) = builder.finish();
    assert!(forms.is_empty(), "een halve opname wordt geen formulier");
    let text = String::from_utf8_lossy(&content).to_string();
    assert_eq!(text.matches("BDC").count(), text.matches("EMC").count(), "{text}");
    assert!(!text.contains(" Do"));
}

#[test]
fn a_block_in_an_external_reference_is_not_mixed_up_with_a_block_of_the_same_name() {
    let dir = TempDir::new("formulieren-verwijzing");
    // De verwijzing heeft een eigen blok STIP, met andere inhoud dan het blok
    // STIP van de hoofdtekening.
    let mut child = TestDoc::new();
    child.layer("Gevel", 2, |_| {});
    let stip = child.block("STIP");
    for n in 0..30 {
        child.line(Some(stip), "Gevel", Color::ByLayer, (0.0, n as f64 * 3.0), (80.0, n as f64 * 3.0));
    }
    for n in 0..8 {
        child.insert(None, "STIP", "Gevel", Color::ByLayer, (n as f64 * 200.0, 0.0));
    }
    write_dxf(&child.doc, &dir.path().join("gevel.dxf"));

    let mut t = symbols();
    for n in 0..12 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 300.0, 0.0));
    }
    t.xref("GEVEL", "gevel.dxf");
    t.insert(None, "GEVEL", "Symbolen", Color::ByLayer, (0.0, 1000.0));
    t.insert(None, "GEVEL", "Symbolen", Color::ByLayer, (0.0, 2000.0));
    let drawing = t.drawing_at(dir.path().join("hoofd.dxf"));
    let xrefs = load_xrefs(&drawing, &[]);
    assert_eq!(xrefs.loaded(), 1);

    let flat = drawn_page_with(&drawing, Some(&xrefs), None, false, None);
    let with = drawn_page_with(&drawing, Some(&xrefs), None, true, None);
    assert_eq!(flat.drawn.iter().filter(|d| d.layer.ends_with("Gevel")).count(), 2 * 8 * 30);
    assert_eq!(with.drawn, flat.drawn);
    assert_eq!(without_form_counts(&with.stats), flat.stats);
    // Eén formulier voor het blok van de hoofdtekening, één voor dat van de
    // verwijzing; de tweede invoeging van de verwijzing plaatst het alleen nog.
    assert_eq!(with.forms.len(), 2);
    assert_eq!(with.forms.iter().map(|f| f.uses).collect::<Vec<_>>(), vec![11, 7 + 8]);
}

// ── Voorbeeldstand ───────────────────────────────────────────────────────

/// Een rooster van `columns × rows` lijnen (één invoeging in rijen en
/// kolommen: een kleine tekening met veel entiteiten), met een tekst en een
/// effen arcering erbij.
fn grid_with_text_and_hatch(columns: u16, rows: u16) -> Drawing {
    use acadrust::entities::hatch::{BoundaryEdge, BoundaryPath, LineEdge};
    use acadrust::types::Vector2;
    let mut t = TestDoc::new();
    t.layer("Raster", 1, |_| {});
    t.layer("Tekst", 7, |_| {});
    t.layer("Vlak", 3, |_| {});
    let cel = t.block("CEL");
    t.line(Some(cel), "Raster", Color::ByLayer, (0.0, 0.0), (8.0, 0.0));
    let mut rooster = Insert::new("CEL", Vector3::new(0.0, 0.0, 0.0));
    rooster.common.layer = "Raster".into();
    rooster.column_count = columns;
    rooster.row_count = rows;
    rooster.column_spacing = 10.0;
    rooster.row_spacing = 10.0;
    t.add(None, EntityType::Insert(rooster));
    let mut text = acadrust::entities::Text::with_value("Titel", Vector3::new(0.0, -200.0, 0.0)).with_height(100.0);
    text.common.layer = "Tekst".into();
    t.add(None, EntityType::Text(text));
    let mut hatch = acadrust::entities::Hatch::solid();
    hatch.common.layer = "Vlak".into();
    let mut path = BoundaryPath::default();
    let corners = [(0.0, -600.0), (400.0, -600.0), (400.0, -300.0), (0.0, -300.0)];
    for i in 0..4 {
        let (a, b) = (corners[i], corners[(i + 1) % 4]);
        path.edges.push(BoundaryEdge::Line(LineEdge { start: Vector2::new(a.0, a.1), end: Vector2::new(b.0, b.1) }));
    }
    hatch.paths.push(path);
    t.add(None, EntityType::Hatch(hatch));
    t.drawing()
}

#[test]
fn a_heavy_preview_leaves_out_hatch_patterns_text_and_dimensions() {
    // Ruim boven de voorbeeldgrens: 500 × 402 cellen.
    let drawing = grid_with_text_and_hatch(500, 402);
    let dir = work_dir("voorbeeld");
    let cancel = AtomicBool::new(false);
    let pdf = dir.join("voorbeeld.pdf");
    let options = ImportOptions { preview: true, ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &cancel, |_| {}).unwrap();
    assert!(result.simplified, "boven de grens wordt het voorbeeld vereenvoudigd");
    assert!(result.stats.entities > super::PREVIEW_SIMPLE_ABOVE);
    assert_eq!(result.warnings.iter().filter(|w| *w == &format!("previewSimplified:{}", super::PREVIEW_SIMPLE_ABOVE)).count(), 1);
    // Geen tekst; het effen vlak blijft (één pad, en zonder vlakken ziet een
    // tekening er heel anders uit).
    assert_eq!((result.stats.texts, result.stats.hatches), (0, 1));
    let (_, content) = content_of(&pdf);
    assert!(!content.contains("BT "));
    assert!(result.pages[0].simplified);
    // Per ruimte beslist: een licht blad naast het zware model blijft volledig.
    let mut both = grid_with_text_and_hatch(500, 402);
    both.document.add_layout("Blad").unwrap();
    let mut note = acadrust::entities::Text::with_value("Blad 1", Vector3::new(20.0, 20.0, 0.0)).with_height(5.0);
    note.common.layer = "Tekst".into();
    both.document.add_entity_to_layout(EntityType::Text(note), "Blad").unwrap();
    both.document.add_entity_to_layout(EntityType::Line(Line::from_points(Vector3::new(0.0, 0.0, 0.0), Vector3::new(200.0, 100.0, 0.0))), "Blad").unwrap();
    let two = ImportOptions { spaces: vec!["model".into(), "Blad".into()], ..options.clone() };
    let mixed = convert(&both, &two, &dir.join("beide.pdf"), &cancel, |_| {}).unwrap();
    assert_eq!(mixed.pages.iter().map(|p| p.simplified).collect::<Vec<_>>(), vec![true, false]);
    assert!(mixed.simplified);
    assert_eq!(mixed.stats.texts, 1, "de tekst op het blad staat er");
    assert_eq!(mixed.warnings.iter().filter(|w| w.starts_with("previewSimplified")).count(), 1);
    // Wie arceringen al had uitgezet, houdt dat in het voorbeeld.
    let none = dir.join("zonder-vlakken.pdf");
    let without = convert(&drawing, &ImportOptions { hatch: HatchMode::None, ..options.clone() }, &none, &cancel, |_| {}).unwrap();
    assert_eq!((without.stats.texts, without.stats.hatches), (0, 0));
    // De grens telt wat er na de laagkeuze overblijft: zonder het raster is dit
    // een kleine tekening en blijft het voorbeeld volledig.
    let light = dir.join("zonder-raster.pdf");
    let few = convert(&drawing, &ImportOptions { excluded_layers: vec!["Raster".into()], ..options.clone() }, &light, &cancel, |_| {}).unwrap();
    assert!(!few.simplified, "{} entiteiten", few.stats.entities);
    assert_eq!((few.stats.texts, few.stats.hatches), (1, 1));
    // Een voorbeeld draagt zijn merk in de catalogus en op de pagina, zodat de
    // app het nooit voor een echte import aanziet.
    let marks = |path: &std::path::Path| {
        let bytes = std::fs::read(path).unwrap();
        bytes.windows(17).filter(|w| *w == b"/OPS_Preview true").count()
    };
    assert_eq!(marks(&pdf), 2, "catalogus en pagina");

    // Dezelfde tekening als echte import: volledig, zonder de melding, en op
    // hetzelfde papier: het voorbeeld laat zien waar alles komt.
    let full = dir.join("volledig.pdf");
    let whole = convert(&drawing, &ImportOptions::default(), &full, &cancel, |_| {}).unwrap();
    assert!(!whole.simplified);
    assert_eq!(marks(&full), 0, "een echte import draagt het merk niet");
    assert!(!whole.warnings.iter().any(|w| w.starts_with("previewSimplified")));
    assert_eq!((whole.stats.texts, whole.stats.hatches), (1, 1));
    assert_eq!(
        (whole.pages[0].paper.clone(), whole.pages[0].scale, whole.pages[0].offset),
        (result.pages[0].paper.clone(), result.pages[0].scale, result.pages[0].offset)
    );

    // Een kleine tekening blijft ook als voorbeeld volledig.
    let small = dir.join("klein.pdf");
    let result = convert(&grid_with_text_and_hatch(5, 4), &options, &small, &cancel, |_| {}).unwrap();
    assert!(!result.simplified && result.warnings.iter().all(|w| !w.starts_with("previewSimplified")));
    assert_eq!((result.stats.texts, result.stats.hatches), (1, 1));
    assert_eq!(marks(&small), 2, "ook een volledig voorbeeld blijft een voorbeeld");

    // Het argument van de webview en het veld in het verslag.
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","outputPath":"a.pdf","preview":true}"#).unwrap();
    assert!(args.options().preview);
    let args: ImportArgs = serde_json::from_str(r#"{"path":"a.dxf","outputPath":"a.pdf"}"#).unwrap();
    assert!(!args.options().preview, "standaard uit");
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["simplified"], serde_json::Value::Bool(false));
}

#[test]
fn a_preview_keeps_to_the_work_limits_and_the_cancel_flag() {
    let drawing = grid_with_text_and_hatch(500, 402);
    let dir = work_dir("voorbeeld-grenzen");
    let pdf = dir.join("voorbeeld.pdf");
    let go = AtomicBool::new(false);
    // Bezoeken: de voorbeeldstand heeft geen eigen, ruimere grens.
    let few_visits = ImportOptions { preview: true, max_visits: 100_000, ..Default::default() };
    assert_eq!(convert(&drawing, &few_visits, &pdf, &go, |_| {}).unwrap_err(), ImportError::TooComplex);
    // Inhoud: ook het vereenvoudigde voorbeeld telt de uitgevouwen omvang.
    let little_room = ImportOptions { preview: true, max_content_bytes: 100_000, ..Default::default() };
    assert_eq!(convert(&drawing, &little_room, &pdf, &go, |_| {}).unwrap_err(), ImportError::TooComplex);
    // Afbreken, vooraf en onderweg (bij de eerste voortgangsmelding van het tekenen).
    let stop = AtomicBool::new(true);
    let preview = ImportOptions { preview: true, ..Default::default() };
    assert_eq!(convert(&drawing, &preview, &pdf, &stop, |_| {}).unwrap_err(), ImportError::Cancelled);
    let midway = AtomicBool::new(false);
    let error = convert(&drawing, &preview, &pdf, &midway, |p| {
        if p.phase == ImportPhase::Draw {
            midway.store(true, Ordering::Relaxed);
        }
    })
    .unwrap_err();
    assert_eq!(error, ImportError::Cancelled);
    assert!(!pdf.exists());
    assert!(std::fs::read_dir(&dir).unwrap().next().is_none(), "geen deelbestand achtergebleven");
}

#[test]
fn leaders_belong_to_the_dimensions_and_go_when_those_go() {
    // Een verwijslijn hoort bij de maatvoering: wie die uitzet (of een
    // vereenvoudigd voorbeeld krijgt), ziet ook geen pijlen zonder tekst meer.
    let mut t = TestDoc::new();
    t.layer("Maten", 3, |_| {});
    t.line(None, "Maten", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    let mut leader = acadrust::entities::Leader::from_vertices(vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(50.0, 50.0, 0.0), Vector3::new(80.0, 50.0, 0.0)]);
    leader.common.layer = "Maten".into();
    t.add(None, EntityType::Leader(leader));
    let mut multi = acadrust::entities::MultiLeader::with_text("A", Vector3::new(200.0, 80.0, 0.0), vec![Vector3::new(120.0, 0.0, 0.0), Vector3::new(180.0, 80.0, 0.0)]);
    multi.common.layer = "Maten".into();
    t.add(None, EntityType::MultiLeader(multi));
    let drawing = t.drawing();
    let (with, _) = walk_model(&drawing, WalkSettings::default());
    assert!(with.on("Maten") >= 3, "de lijn en beide verwijslijnen: {}", with.on("Maten"));
    let (without, walker) = walk_model(&drawing, WalkSettings { dimensions: false, ..Default::default() });
    assert_eq!(without.on("Maten"), 1, "alleen de gewone lijn");
    assert_eq!(walker.stats.texts, 0, "ook de tekst van de verwijslijn niet");
}

#[test]
fn a_long_run_of_placed_forms_keeps_asking_whether_to_stop() {
    // Een geplaatst formulier kost geen wandeling, wel de bezoeken die de
    // wandeling gekost zou hebben. Die tellen ook voor het afbreken en de
    // voortgang: anders zwijgt een blad vol herhaalde blokken tot het klaar is.
    let mut t = TestDoc::new();
    let block = t.block("RASTER");
    for n in 0..100 {
        t.line(Some(block), "0", Color::ByLayer, (0.0, n as f64), (50.0, n as f64));
    }
    for n in 0..300 {
        t.insert(None, "RASTER", "0", Color::ByLayer, (100.0 + (n % 20) as f64 * 100.0, 100.0 + (n / 20) as f64 * 150.0));
    }
    let drawing = t.drawing();
    let asked = std::cell::Cell::new(0u32);
    let mut registry = pdf_out::LayerRegistry::default();
    let mut builder = pdf_out::PageBuilder::new(1000.0, 1000.0, &mut registry, true).with_forms(true);
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    walker.on_cancel(|| {
        asked.set(asked.get() + 1);
        false
    });
    walker.model_space(Xform3::from_matrix(&Matrix::scale(0.1, 0.1)), &mut builder);
    assert!(walker.stats.visits > 30_000, "{}", walker.stats.visits);
    assert!(asked.get() >= 10, "{} keer gevraagd bij {} bezoeken", asked.get(), walker.stats.visits);
}
