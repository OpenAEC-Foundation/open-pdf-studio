//! Heen en terug: een tekening met landelijke coördinaten wordt geïmporteerd
//! naar PDF en daarna weer geëxporteerd met de oorsprong van het model (#400).
//! De coördinaten horen terug te komen waar ze vandaan kwamen, ook als de
//! tekening op de pagina gedraaid staat, een marge heeft, op schaal staat, in
//! meters is getekend of via een viewport van een layout op het blad komt.
//!
//! Hoe dicht ze terugkomen ligt aan de PDF ertussen: de import schrijft
//! paginacoördinaten in duizendsten van een punt, en de export leest ze met de
//! precisie van PDFium. De matrix zelf (twaalf cijfers, gelezen in 64 bits)
//! draagt daar niets meetbaars aan bij. De grens in deze tests is die afronding;
//! de gemeten afwijking wordt afgedrukt (`cargo test -- --nocapture`).
//!
//! De tests slaan zichzelf over als de PDFium-bibliotheek niet in de repository
//! staat voor dit platform.

use acadrust::entities::{EntityType, Insert, Line, Viewport};
use acadrust::tables::{BlockRecord, Layer, TableEntry};
use acadrust::types::{Color, Vector3};
use acadrust::{CadDocument, DxfReader};
use open_pdf_cad::import::paper::Placement;
use open_pdf_cad::import::{convert, Drawing, ImportOptions};
use open_pdf_cad::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

fn pdfium_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("OPDS_PDFIUM_LIB") {
        return Some(PathBuf::from(path));
    }
    let platform = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") { "win-arm64" } else { "win-x64" }
    } else if cfg!(target_os = "macos") {
        "macos-universal"
    } else {
        "linux-x64"
    };
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries")
        .join(platform)
        .join(pdfium_library_name());
    if path.exists() {
        return Some(path);
    }
    // Zonder PDFium test deze test niets. Dat mag niet stil gebeuren: de
    // melding gaat rechtstreeks naar stderr (langs de opvang van het testraam
    // heen), en met OPDS_PDFIUM_VERPLICHT=1 is het een fout.
    let message = "OVERGESLAGEN: geen PDFium-bibliotheek voor dit platform (zet OPDS_PDFIUM_LIB); deze test heeft niets gecontroleerd\n";
    if std::env::var("OPDS_PDFIUM_VERPLICHT").is_ok_and(|v| v == "1") {
        panic!("{message}");
    }
    let _ = std::io::Write::write_all(&mut std::io::stderr(), message.as_bytes());
    None
}

fn work_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("opds-terugweg-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Een tekening in het geheugen, in de opgegeven eenheid (`$INSUNITS`).
fn document(insunits: i16) -> CadDocument {
    let mut doc = CadDocument::new();
    doc.header.insertion_units = insunits;
    let mut layer = Layer::new("Tracé");
    layer.color = Color::Index(1);
    layer.set_handle(doc.allocate_handle());
    doc.layers.add(layer).unwrap();
    doc
}

fn add_line(doc: &mut CadDocument, a: (f64, f64), b: (f64, f64)) {
    let mut line = Line::from_points(Vector3::new(a.0, a.1, 0.0), Vector3::new(b.0, b.1, 0.0));
    line.common.layer = "Tracé".into();
    doc.add_entity(EntityType::Line(line)).unwrap();
}

fn drawing(document: CadDocument) -> Drawing {
    Drawing {
        document,
        path: PathBuf::from("trace.dxf"),
        is_dxf: true,
        version: "AC1032".into(),
        file_bytes: 0,
        read_ms: 0,
        chunked: false,
    }
}

/// Alle hoekpunten van lijnen en polylijnen in een geëxporteerde tekening.
fn vertices(path: &Path) -> (Vec<(f64, f64)>, i16) {
    let doc = DxfReader::from_file(path).unwrap().read().unwrap();
    let mut out = Vec::new();
    for entity in doc.model_space_entities() {
        match entity {
            EntityType::Line(line) => {
                out.push((line.start.x, line.start.y));
                out.push((line.end.x, line.end.y));
            }
            EntityType::LwPolyline(poly) => out.extend(poly.vertices.iter().map(|v| (v.location.x, v.location.y))),
            _ => {}
        }
    }
    (out, doc.header.insertion_units)
}

/// Grootste afstand van een verwacht punt tot het dichtstbijzijnde hoekpunt.
fn worst_distance(found: &[(f64, f64)], wanted: &[(f64, f64)]) -> f64 {
    wanted
        .iter()
        .map(|w| found.iter().map(|f| (f.0 - w.0).hypot(f.1 - w.1)).fold(f64::INFINITY, f64::min))
        .fold(0.0, f64::max)
}

fn export_model(library: &PdfiumLibrary, pdf: &Path, out: &Path, area: Option<AreaRect>) -> Result<ExportReport, ExportError> {
    let mut options = ConvertOptions { origin: OriginMode::Model, area, ..ConvertOptions::default() };
    resolve_model_space(pdf, 0, &mut options, None)?;
    let request = ExportRequest {
        pdf_path: pdf.to_path_buf(),
        page_index: 0,
        output_path: out.to_path_buf(),
        format: CadFormat::Dxf,
        version: CadVersion::default(),
        options,
        max_entities: None,
    };
    export_page(library, &request, None, None)
}

/// De afronding van de PDF in tekeningeenheden: de import schrijft duizendsten
/// van een punt (een half duizendste afronding per as), PDFium leest in 32 bits
/// (op een blad tot 4000 pt nog eens een kwart duizendste).
fn pdf_rounding(units_per_point: f64) -> f64 {
    (0.0005 + 0.00025) * units_per_point * std::f64::consts::SQRT_2
}

struct Case {
    name: &'static str,
    insunits: i16,
    mm_per_unit: f64,
    /// Een hoek van het tracé, in tekeningeenheden.
    corner: (f64, f64),
    /// Lengte van de twee benen, in tekeningeenheden.
    legs: (f64, f64),
    options: ImportOptions,
}

#[test]
fn an_imported_page_exports_back_in_the_original_model_coordinates() {
    let Some(pdfium) = pdfium_path() else { return };
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let dir = work_dir("model");
    let cases = [
        Case {
            name: "mm, 1:100, marge 10, gecentreerd",
            insunits: 4,
            mm_per_unit: 1.0,
            corner: (155_000_000.0, 463_000_000.0),
            legs: (7_500.0, 3_000.0),
            options: ImportOptions { scale: Some(100.0), ..Default::default() },
        },
        Case {
            name: "mm, 1:50, marge 25, linksonder, 30 graden gedraaid",
            insunits: 4,
            mm_per_unit: 1.0,
            corner: (155_000_123.4, 463_000_567.8),
            legs: (7_512.3, 2_987.6),
            options: ImportOptions {
                scale: Some(50.0),
                margin_mm: 25.0,
                placement: Placement::LowerLeft,
                rotation_deg: 30.0,
                ..Default::default()
            },
        },
        Case {
            name: "m, 1:200, een kwartslag gedraaid",
            insunits: 6,
            mm_per_unit: 1_000.0,
            corner: (155_000.25, 463_000.75),
            legs: (42.5, 17.25),
            options: ImportOptions { scale: Some(200.0), rotation_deg: 90.0, ..Default::default() },
        },
        Case {
            name: "mm, passend op papier, 12,5 graden gedraaid",
            insunits: 4,
            mm_per_unit: 1.0,
            corner: (155_000_000.0, 463_000_000.0),
            legs: (61_234.5, 20_000.0),
            options: ImportOptions { rotation_deg: 12.5, margin_mm: 5.0, ..Default::default() },
        },
        Case {
            name: "mm, 1:1",
            insunits: 4,
            mm_per_unit: 1.0,
            corner: (155_000_000.125, 463_000_000.375),
            legs: (150.25, 80.5),
            options: ImportOptions { scale: Some(1.0), ..Default::default() },
        },
    ];
    for (number, case) in cases.iter().enumerate() {
        let mut doc = document(case.insunits);
        let (x, y) = case.corner;
        let wanted = [(x, y), (x + case.legs.0, y), (x + case.legs.0, y + case.legs.1)];
        add_line(&mut doc, wanted[0], wanted[1]);
        add_line(&mut doc, wanted[1], wanted[2]);
        let pdf = dir.join(format!("heen-{number}.pdf"));
        let result = convert(&drawing(doc), &case.options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();

        // De pagina draagt de terugweg, in de eenheid van de tekening.
        let model = read_model_space(&pdf, 0).expect("modelmatrix op de pagina");
        assert_eq!(model.unit.mm_per_unit(), case.mm_per_unit, "{}", case.name);

        let dxf = dir.join(format!("terug-{number}.dxf"));
        let report = export_model(&library, &pdf, &dxf, None).unwrap();
        let (found, insunits) = vertices(&dxf);
        assert_eq!(insunits, case.insunits, "{}: de eenheid van de tekening komt terug", case.name);
        let scale = result.pages[0].scale;
        assert!((report.scale_denominator - scale).abs() < 1e-6 * scale, "{}: schaal {} tegen {scale}", case.name, report.scale_denominator);

        let units_per_point = scale * 25.4 / 72.0 / case.mm_per_unit;
        let worst = worst_distance(&found, &wanted);
        let worst_mm = worst * case.mm_per_unit;
        eprintln!(
            "{}: afwijking {worst_mm:.5} mm in het model ({:.6} mm op papier, 1:{scale:.0}); afronding van de PDF laat {:.5} mm toe",
            case.name,
            worst_mm / scale,
            pdf_rounding(units_per_point) * case.mm_per_unit
        );
        assert!(worst <= pdf_rounding(units_per_point), "{}: {worst} eenheden", case.name);
        // Op papier is dat nooit meer dan een halve duizendste millimeter.
        assert!(worst_mm / scale < 0.0005, "{}", case.name);
    }
}

#[test]
fn the_matrix_itself_adds_nothing_measurable() {
    // Zonder PDFium: wat de pagina draagt, brengt een punt van de pagina terug
    // naar het model tot op een duizendste millimeter, ook bij landelijke
    // coördinaten, in meters en gedraaid.
    let dir = work_dir("matrix");
    for (insunits, mm_per_unit, corner, scale, turn) in [
        (4, 1.0, (155_000_000.0, 463_000_000.0), 100.0, 0.0),
        (4, 1.0, (155_000_123.4, 463_000_567.8), 500.0, 33.0),
        (6, 1_000.0, (155_000.25, 463_000.75), 1_000.0, 90.0),
    ] {
        let mut doc = document(insunits);
        add_line(&mut doc, corner, (corner.0 + 50_000.0 / mm_per_unit, corner.1));
        add_line(&mut doc, corner, (corner.0, corner.1 + 20_000.0 / mm_per_unit));
        let pdf = dir.join(format!("m-{insunits}-{scale}.pdf"));
        let options = ImportOptions { scale: Some(scale), rotation_deg: turn, placement: Placement::LowerLeft, ..Default::default() };
        let result = convert(&drawing(doc), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
        let model = read_model_space(&pdf, 0).expect("modelmatrix");
        // Het punt van de tekening dat op de oorsprong van de pagina ligt,
        // staat in het verslag; de matrix hoort datzelfde punt te geven.
        let origin = model.page_to_model.apply(geom::Point::new(0.0, 0.0));
        let offset = result.pages[0].offset;
        let miss_mm = (origin.x - offset[0]).hypot(origin.y - offset[1]) * mm_per_unit;
        eprintln!("matrix, 1:{scale}, eenheid {mm_per_unit} mm: {miss_mm:.6} mm naast het verslag");
        assert!(miss_mm < 0.001, "{miss_mm}");
        let k = model.page_to_model.determinant().abs().sqrt();
        assert!((k - scale * 25.4 / 72.0 / mm_per_unit).abs() < 1e-9 * k, "schaal van de matrix");
    }
}

#[test]
fn a_layout_exports_each_viewport_in_its_own_model_coordinates() {
    let Some(pdfium) = pdfium_path() else { return };
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let dir = work_dir("layout");
    let (x, y) = (155_000_000.0, 463_000_000.0);
    let mut doc = document(4);
    let wanted = [(x, y), (x + 1_000.0, y), (x, y + 100.0), (x + 1_000.0, y + 100.0)];
    add_line(&mut doc, wanted[0], wanted[1]);
    add_line(&mut doc, wanted[2], wanted[3]);
    doc.add_layout("Blad").unwrap();
    // Links 1:100, rechts 1:20, allebei gericht op het midden van het tracé.
    for (id, center_x, view_height) in [(2, 60.0, 10_000.0), (3, 200.0, 2_000.0)] {
        let mut viewport = Viewport::with_size(Vector3::new(center_x, 60.0, 0.0), 100.0, 100.0);
        viewport.id = id;
        viewport.view_center = Vector3::new(x + 500.0, y + 50.0, 0.0);
        viewport.view_height = view_height;
        doc.add_entity_to_layout(EntityType::Viewport(viewport), "Blad").unwrap();
    }
    let pdf = dir.join("blad.pdf");
    let options = ImportOptions { spaces: vec!["Blad".into()], ..Default::default() };
    convert(&drawing(doc), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();

    let page = model_space::read_page(&pdf, 0).expect("leesbaar");
    assert_eq!(page.spaces.len(), 2, "elke viewport zijn eigen terugweg; het blad zelf heeft er geen");
    // Zonder gebied is niet te zeggen welke viewport bedoeld is.
    let none = export_model(&library, &pdf, &dir.join("geen.dxf"), None).unwrap_err();
    assert_eq!(none, ExportError::AmbiguousModelSpace { viewports: 2 });
    assert_eq!(none.to_string(), "MODEL_SPACE_AMBIGUOUS:2");
    assert!(read_model_space(&pdf, 0).is_none());
    assert!(!dir.join("geen.dxf").exists());

    for (number, (space, scale)) in page.spaces.iter().zip([100.0, 20.0]).enumerate() {
        let b = space.bbox.expect("omhullende van de viewport");
        let area = AreaRect { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
        let dxf = dir.join(format!("venster-{number}.dxf"));
        let report = export_model(&library, &pdf, &dxf, Some(area)).unwrap();
        assert!((report.scale_denominator - scale).abs() < 1e-6, "venster {number}: 1:{}", report.scale_denominator);
        let (found, _) = vertices(&dxf);
        let worst = worst_distance(&found, &wanted);
        eprintln!("layout, venster {number} (1:{scale}): afwijking {worst:.5} mm; afronding van de PDF laat {:.5} mm toe", pdf_rounding(scale * 25.4 / 72.0));
        assert!(worst <= pdf_rounding(scale * 25.4 / 72.0), "venster {number}: {worst} mm");
        // Alleen wat in het venster staat komt mee: twee lijnen, vier punten.
        assert_eq!(found.len(), 4, "venster {number}: {found:?}");
    }
    // Een gebied over beide vensters heen hoort bij geen van beide.
    let (a, b) = (page.spaces[0].bbox.unwrap(), page.spaces[1].bbox.unwrap());
    let across = AreaRect { x0: a[0].min(b[0]), y0: a[1].min(b[1]), x1: a[2].max(b[2]), y1: a[3].max(b[3]) };
    assert_eq!(export_model(&library, &pdf, &dir.join("over.dxf"), Some(across)).unwrap_err(), ExportError::AmbiguousModelSpace { viewports: 2 });
}

#[test]
fn a_page_without_a_way_back_is_a_plain_error() {
    let dir = work_dir("geen");
    let mut doc = document(4);
    add_line(&mut doc, (0.0, 0.0), (1_000.0, 500.0));
    let pdf = dir.join("kaal.pdf");
    let options = ImportOptions { model_matrix: false, scale: Some(100.0), ..Default::default() };
    convert(&drawing(doc), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(read_model_space(&pdf, 0).is_none());
    let mut wanted = ConvertOptions { origin: OriginMode::Model, ..ConvertOptions::default() };
    assert_eq!(resolve_model_space(&pdf, 0, &mut wanted, None), Err(ExportError::NoModelSpace));
    assert_eq!(ExportError::NoModelSpace.to_string(), "NO_MODEL_SPACE");
    // Een pagina die niet bestaat, een bestand dat geen PDF is, een leeg
    // bestand: dezelfde nette fout.
    assert_eq!(resolve_model_space(&pdf, 7, &mut wanted, None), Err(ExportError::NoModelSpace));
    let junk = dir.join("rommel.pdf");
    std::fs::write(&junk, b"%PDF-1.7\n1 0 obj\n<< /VP [ << /OPS_ModelMatrix [1 0 0").unwrap();
    assert_eq!(resolve_model_space(&junk, 0, &mut wanted, None), Err(ExportError::NoModelSpace));
    let empty = dir.join("leeg.pdf");
    std::fs::write(&empty, b"").unwrap();
    assert_eq!(resolve_model_space(&empty, 0, &mut wanted, None), Err(ExportError::NoModelSpace));
    // Een bestand dat niet te openen is, is iets anders dan een pagina zonder
    // terugweg: dat is een bestandsfout, met het pad erbij.
    for missing in [dir.join("weg.pdf"), dir.clone()] {
        match resolve_model_space(&missing, 0, &mut wanted, None) {
            Err(ExportError::Io(message)) => assert!(message.contains(&missing.display().to_string()), "{message}"),
            other => panic!("verwacht een bestandsfout, kreeg {other:?}"),
        }
    }
    // Afbreken is afbreken.
    assert_eq!(resolve_model_space(&pdf, 0, &mut wanted, Some(&AtomicBool::new(true))), Err(ExportError::Cancelled));
    // Een andere oorsprong leest niets en verandert niets.
    let mut page_origin = ConvertOptions::default();
    assert_eq!(resolve_model_space(&junk, 0, &mut page_origin, None), Ok(()));
    assert!(page_origin.model.is_none());

    // De export zelf weigert de oorsprong van het model zonder terugweg, vóór
    // er iets geschreven wordt.
    let Some(pdfium) = pdfium_path() else { return };
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let out = dir.join("uit.dxf");
    let request = ExportRequest {
        pdf_path: pdf.clone(),
        page_index: 0,
        output_path: out.clone(),
        format: CadFormat::Dxf,
        version: CadVersion::default(),
        options: ConvertOptions { origin: OriginMode::Model, ..ConvertOptions::default() },
        max_entities: None,
    };
    assert_eq!(export_page(&library, &request, None, None).unwrap_err(), ExportError::NoModelSpace);
    assert!(!out.exists());

    // Een matrix die niet deugt (te kort, ontaard, geen getallen) telt niet
    // als terugweg. De matrix in het bestand wordt vervangen door een even
    // lange die niet deugt: zo blijven de kruisverwijzingen kloppen.
    let good = dir.join("goed.pdf");
    let mut doc = document(4);
    add_line(&mut doc, (0.0, 0.0), (1_000.0, 500.0));
    convert(&drawing(doc), &ImportOptions { scale: Some(100.0), ..Default::default() }, &good, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(read_model_space(&good, 0).is_some());
    let bytes = std::fs::read(&good).unwrap();
    let at = bytes.windows(16).position(|w| w == b"/OPS_ModelMatrix").expect("matrix in het bestand") + 16;
    let end = at + bytes[at..].iter().position(|b| *b == b']').unwrap() + 1;
    for broken in ["[ 1 0 0 1 ]", "[ 0 0 0 0 5 6 ]", "[ 1 0 0 (x) 5 6 ]", "(tekst)"] {
        let mut replacement = broken.as_bytes().to_vec();
        assert!(replacement.len() <= end - at);
        replacement.resize(end - at, b' ');
        let mut patched = bytes.clone();
        patched[at..end].copy_from_slice(&replacement);
        let with = dir.join("kapot.pdf");
        std::fs::write(&with, patched).unwrap();
        assert_eq!(resolve_model_space(&with, 0, &mut wanted, None), Err(ExportError::NoModelSpace), "{broken}");
    }
}

#[test]
fn a_page_with_form_blocks_exports_the_same_lines_as_a_flat_page() {
    let Some(pdfium) = pdfium_path() else { return };
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let dir = work_dir("formulieren");
    let (x, y) = (155_000_000.0, 463_000_000.0);
    let build = || {
        let mut doc = document(4);
        let mut record = BlockRecord::new("SYMBOOL");
        record.set_handle(doc.allocate_handle());
        let owner = record.handle;
        doc.block_records.add(record).unwrap();
        for n in 0..30 {
            let mut line = Line::from_points(Vector3::new(0.0, n as f64 * 10.0, 0.0), Vector3::new(250.0, n as f64 * 10.0 + 5.0, 0.0));
            line.common.layer = "Tracé".into();
            line.common.owner_handle = owner;
            doc.add_entity(EntityType::Line(line)).unwrap();
        }
        for n in 0..12 {
            let mut insert = Insert::new("SYMBOOL", Vector3::new(x + n as f64 * 500.0, y + (n % 3) as f64 * 400.0, 0.0));
            insert.common.layer = "Tracé".into();
            doc.add_entity(EntityType::Insert(insert)).unwrap();
        }
        drawing(doc)
    };
    let mut sets = Vec::new();
    for reuse in [true, false] {
        let pdf = dir.join(format!("blokken-{reuse}.pdf"));
        let options = ImportOptions { scale: Some(50.0), reuse_blocks: reuse, ..Default::default() };
        let result = convert(&build(), &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(result.stats.forms_written, u64::from(reuse));
        let dxf = dir.join(format!("blokken-{reuse}.dxf"));
        export_model(&library, &pdf, &dxf, None).unwrap();
        let (found, _) = vertices(&dxf);
        assert_eq!(found.len(), 12 * 30 * 2, "hergebruik {reuse}");
        sets.push(found);
    }
    // Dezelfde lijnen op dezelfde plek, binnen de afronding van de PDF (de
    // plaatsing van een formulier rondt één keer extra af).
    let limit = 2.0 * pdf_rounding(50.0 * 25.4 / 72.0);
    let worst = worst_distance(&sets[0], &sets[1]).max(worst_distance(&sets[1], &sets[0]));
    eprintln!("formulieren tegen plat, 1:50: grootste verschil {worst:.5} mm (grens {limit:.5})");
    assert!(worst <= limit, "{worst}");
    // En op de plek van de oorspronkelijke tekening.
    let first = (x, y);
    assert!(worst_distance(&sets[0], &[first, (x + 250.0, y + 5.0)]) <= limit);
}

#[test]
fn the_count_before_the_export_uses_the_scale_of_the_export() {
    let Some(pdfium) = pdfium_path() else { return };
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let dir = work_dir("telling");
    let mut doc = document(4);
    add_line(&mut doc, (155_000_000.0, 463_000_000.0), (155_007_500.0, 463_003_000.0));
    let pdf = dir.join("plan.pdf");
    convert(&drawing(doc), &ImportOptions { scale: Some(100.0), ..Default::default() }, &pdf, &AtomicBool::new(false), |_| {}).unwrap();

    // De export op de oorsprong van het model schrijft op de schaal van de
    // tekening (1:100); het tellen vooraf hoort dat ook te doen, zonder dat de
    // aanroeper de terugweg zelf hoeft op te zoeken.
    let model = ConvertOptions { origin: OriginMode::Model, ..ConvertOptions::default() };
    let counted = scan_page(&library, &pdf, 0, &model, None).unwrap();
    assert!((counted.scale_denominator - 100.0).abs() < 1e-6, "{}", counted.scale_denominator);
    let exported = export_model(&library, &pdf, &dir.join("uit.dxf"), None).unwrap();
    assert!((exported.scale_denominator - counted.scale_denominator).abs() < 1e-9);
    let written = exported.convert.lines + exported.convert.polylines + exported.convert.splines + exported.convert.hatches + exported.convert.texts;
    assert_eq!(counted.entities, written);
    // Een andere oorsprong telt op de schaal van de opties.
    let page = scan_page(&library, &pdf, 0, &ConvertOptions::default(), None).unwrap();
    assert!((page.scale_denominator - 1.0).abs() < 1e-9, "{}", page.scale_denominator);
    // Een pagina zonder terugweg blokkeert het tellen niet: de export zelf
    // meldt straks wat er ontbreekt.
    let bare = dir.join("kaal.pdf");
    let mut doc = document(4);
    add_line(&mut doc, (0.0, 0.0), (1_000.0, 500.0));
    convert(&drawing(doc), &ImportOptions { model_matrix: false, scale: Some(100.0), ..Default::default() }, &bare, &AtomicBool::new(false), |_| {}).unwrap();
    assert!((scan_page(&library, &bare, 0, &model, None).unwrap().scale_denominator - 1.0).abs() < 1e-9);
    // Afbreken is afbreken.
    assert_eq!(scan_page(&library, &pdf, 0, &model, Some(&AtomicBool::new(true))).unwrap_err(), ExportError::Cancelled);
}
