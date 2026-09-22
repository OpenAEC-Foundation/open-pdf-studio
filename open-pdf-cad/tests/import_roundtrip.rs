//! Import van een DXF naar PDF, van begin tot eind zonder externe bestanden
//! (#400): de tekening wordt eerst met de eigen schrijver gemaakt, daarna
//! ingelezen, verkend en omgezet. Controleert maat, meetschaal, lagen, het
//! weglaten en verborgen meenemen van lagen, afbreken en schrijffouten.

use open_pdf_cad::geom::Point;
use open_pdf_cad::import::{convert, read, scan_drawing, ImportArgs, ImportError};
use open_pdf_cad::model::{Drawing as CadModel, Entity, Geometry, Layer, Rgb};
use open_pdf_cad::{CadFormat, CadVersion, DrawingUnit};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

fn work_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("open-pdf-cad-import-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn layer(name: &str) -> Layer {
    Layer { name: name.into(), color: Rgb { r: 0, g: 0, b: 0 }, lineweight: 25, from_ocg: true }
}

fn entity(layer: u32, geometry: Geometry) -> Entity {
    Entity { layer, color: None, lineweight: None, linetype: None, geometry }
}

/// Een rechthoek van 10 × 5 m op "Wanden", een lange maatlijn op "Maten" en
/// een hulplijn binnen de rechthoek op "Hulp"; alles in mm.
fn sample_dxf(dir: &std::path::Path) -> PathBuf {
    let rect = vec![Point::new(0.0, 0.0), Point::new(10000.0, 0.0), Point::new(10000.0, 5000.0), Point::new(0.0, 5000.0)];
    let model = CadModel {
        layers: vec![layer("Wanden"), layer("Maten"), layer("Hulp")],
        linetypes: Vec::new(),
        entities: vec![
            entity(0, Geometry::Polyline { points: rect, closed: true }),
            entity(1, Geometry::Line { start: Point::new(0.0, -2000.0), end: Point::new(30000.0, -2000.0) }),
            entity(2, Geometry::Line { start: Point::new(1000.0, 1000.0), end: Point::new(9000.0, 4000.0) }),
        ],
        page_size: (30000.0, 7000.0),
        extents: Some((Point::new(0.0, -2000.0), Point::new(30000.0, 5000.0))),
        units: DrawingUnit::Mm,
    };
    let path = dir.join("rechthoek.dxf");
    open_pdf_cad::writer::write_drawing(model, CadFormat::Dxf, CadVersion::R2013, &path).unwrap();
    path
}

/// Alle inhoudsstromen van een PDF, uitgepakt.
fn streams(pdf: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = pdf;
    while let Some(start) = find(rest, b"stream") {
        let mut body = &rest[start + 6..];
        if body.starts_with(b"\r\n") {
            body = &body[2..];
        } else if body.starts_with(b"\n") {
            body = &body[1..];
        }
        let Some(end) = find(body, b"endstream") else { break };
        let data = &body[..end];
        let mut text = String::new();
        if flate2::read::ZlibDecoder::new(data).read_to_string(&mut text).is_err() {
            text = String::from_utf8_lossy(data).to_string();
        }
        out.push(text);
        rest = &body[end + 9..];
    }
    out
}

fn no_partial_files(dir: &std::path::Path) -> bool {
    std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).all(|e| e.path().extension().map_or(true, |x| x != "deel"))
}

/// Objectnummer van de OCG met deze naam.
fn ocg_number(raw: &str, name: &str) -> Option<u32> {
    let needle = format!("/Name ({name})");
    let at = raw.find(&needle)?;
    let head = &raw[..at];
    let obj = head.rfind(" 0 obj")?;
    let start = head[..obj].rfind(|c: char| !c.is_ascii_digit()).map_or(0, |i| i + 1);
    let block = &head[obj..];
    block.contains("/OCG").then(|| head[start..obj].parse().ok()).flatten()
}

/// Objectnummers in de array na `key` (`[ 3 0 R 4 0 R ]`).
fn array_after(raw: &str, key: &str) -> Vec<u32> {
    let Some(at) = raw.find(&format!("{key} [")).or_else(|| raw.find(&format!("{key}["))) else { return Vec::new() };
    let open = raw[at..].find('[').unwrap() + at + 1;
    let close = raw[open..].find(']').unwrap() + open;
    let parts: Vec<&str> = raw[open..close].split_whitespace().collect();
    parts.chunks(3).filter(|c| c.len() == 3 && c[2] == "R").filter_map(|c| c[0].parse().ok()).collect()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn args(dxf: &std::path::Path, pdf: &std::path::Path, extra: &str) -> ImportArgs {
    let json = format!(
        r#"{{"path":{},"outputPath":{}{}}}"#,
        serde_json::to_string(&dxf.to_string_lossy()).unwrap(),
        serde_json::to_string(&pdf.to_string_lossy()).unwrap(),
        extra
    );
    serde_json::from_str(&json).unwrap()
}

#[test]
fn dxf_imports_on_scale_with_measure_and_layers() {
    let dir = work_dir("schaal");
    let dxf = sample_dxf(&dir);
    let cancel = AtomicBool::new(false);
    let drawing = read(&dxf, &cancel, |_| {}).expect("DXF lezen");

    let scan = scan_drawing(&drawing, &cancel).expect("verkennen");
    assert_eq!(scan.units.unit, "mm");
    let names: Vec<&str> = scan.layers.iter().map(|l| l.name.as_str()).collect();
    for name in ["Wanden", "Maten", "Hulp"] {
        assert!(names.contains(&name), "laag {name} ontbreekt in de verkenning: {names:?}");
    }

    // 1:100, "Maten" weggelaten, "Hulp" verborgen mee, linksonder op de marge.
    let pdf = dir.join("rechthoek.pdf");
    let options = args(
        &dxf,
        &pdf,
        r#","scale":100,"excludedLayers":["maten"],"hiddenLayers":["Hulp"],"placement":"lower_left","marginMm":10"#,
    )
    .options();
    let result = convert(&drawing, &options, &pdf, &cancel, |_| {}).expect("omzetten");
    assert!(no_partial_files(&dir), "deelbestand blijft staan");
    let page = &result.pages[0];
    assert_eq!(page.scale, 100.0);
    assert_eq!(page.scale_text, "1:100");
    // 10 × 5 m op 1:100 = 100 × 50 mm, plus 2 × 10 mm marge: past op A4 liggend.
    // Zonder "Maten" weg te laten zou het gebied 300 mm breed zijn.
    assert_eq!(page.paper, "A4");
    assert!((page.width_mm - 297.0).abs() < 1e-9 && (page.height_mm - 210.0).abs() < 1e-9);

    let bytes = std::fs::read(&pdf).unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    let raw = String::from_utf8_lossy(&bytes);
    // Meetschaal: 25,4 / 72 × 100 = 35,2778 mm per punt.
    assert!(raw.contains("/VP"), "geen /VP");
    assert!(raw.contains("(1:100)"), "geen schaaltekst");
    assert!(raw.contains("/C 35.27777"), "verkeerde meetschaal: {}", &raw[raw.find("/Measure").unwrap_or(0)..][..200]);
    // Lagen: Wanden en Hulp als OCG, Maten niet; Hulp staat standaard uit.
    assert!(raw.contains("(Wanden)") && raw.contains("(Hulp)"));
    assert!(!raw.contains("(Maten)"), "weggelaten laag staat toch in de PDF");
    let hulp = ocg_number(&raw, "Hulp").expect("OCG Hulp");
    let wanden = ocg_number(&raw, "Wanden").expect("OCG Wanden");
    let off = array_after(&raw, "/OFF");
    let on = array_after(&raw, "/ON");
    assert!(off.contains(&hulp), "Hulp staat niet in /OFF: {off:?}");
    assert!(!off.contains(&wanden) && on.contains(&wanden), "Wanden hoort aan te staan");
    assert!(!on.contains(&hulp));

    // De hoek (0,0) ligt op de marge: 10 mm = 28,346 pt; (10000,0) op 110 mm.
    let content = streams(&bytes).join("\n");
    assert!(content.contains("28.346 28.346"), "hoek niet op de marge:\n{}", &content[..content.len().min(400)]);
    assert!(content.contains("311.811 28.346"), "rechthoek niet 100 mm breed");
    assert!(content.contains("311.811 170.079"), "rechthoek niet 50 mm hoog");
    assert!(content.contains("BDC") && content.contains("EMC"), "inhoud niet per laag gemarkeerd");
}

#[test]
fn cancelled_import_leaves_no_file() {
    let dir = work_dir("afbreken");
    let dxf = sample_dxf(&dir);
    let drawing = read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    let pdf = dir.join("uit.pdf");
    let cancel = AtomicBool::new(true);
    let error = convert(&drawing, &args(&dxf, &pdf, "").options(), &pdf, &cancel, |_| {}).unwrap_err();
    assert_eq!(error, ImportError::Cancelled);
    assert!(!pdf.exists() && no_partial_files(&dir));
}

#[test]
fn write_error_leaves_no_partial_file() {
    let dir = work_dir("schrijffout");
    let dxf = sample_dxf(&dir);
    let drawing = read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    // Het doel is een map: die bestaat al en wordt dus niet vervangen.
    let pdf = dir.join("bezet.pdf");
    std::fs::create_dir_all(&pdf).unwrap();
    let error = convert(&drawing, &args(&dxf, &pdf, "").options(), &pdf, &AtomicBool::new(false), |_| {}).unwrap_err();
    assert!(matches!(error, ImportError::Exists(_)), "{error:?}");
    assert!(no_partial_files(&dir), "deelbestand blijft staan als het doel al bestaat");
    // De map van het doel ontbreekt: het schrijven zelf mislukt.
    let pdf = dir.join("geen-map").join("uit.pdf");
    let error = convert(&drawing, &args(&dxf, &pdf, "").options(), &pdf, &AtomicBool::new(false), |_| {}).unwrap_err();
    assert!(matches!(error, ImportError::Io(_)), "{error:?}");
    assert!(!pdf.exists() && no_partial_files(&dir), "deelbestand blijft staan na een schrijffout");
}

#[test]
fn layers_can_be_flattened_into_one_stream() {
    let dir = work_dir("plat");
    let dxf = sample_dxf(&dir);
    let drawing = read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    let pdf = dir.join("plat.pdf");
    convert(&drawing, &args(&dxf, &pdf, r#","layersAsOcg":false,"measure":false"#).options(), &pdf, &AtomicBool::new(false), |_| {})
        .unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(!raw.contains("/OCProperties"), "platte import heeft toch lagen");
    assert!(!raw.contains("/VP"), "meetschaal geschreven terwijl die uit stond");
}

/// De app test haar meetschaal-lezer op een PDF die deze crate schreef
/// (`open-pdf-studio/js/pdf/fixtures/cad-import-rechthoek-m.pdf`): een
/// rechthoek van 10 × 5 m in meters, op 1:100, linksonder op 10 mm marge.
/// Deze test houdt dat bestand gelijk aan wat de crate nu schrijft; met
/// `OPDS_UPDATE_FIXTURES=1` wordt het opnieuw geschreven.
#[test]
fn the_fixture_for_the_app_matches_what_the_crate_writes() {
    let dir = work_dir("fixture");
    let rect = vec![Point::new(0.0, 0.0), Point::new(10.0, 0.0), Point::new(10.0, 5.0), Point::new(0.0, 5.0)];
    let model = CadModel {
        layers: vec![layer("Wanden")],
        linetypes: Vec::new(),
        entities: vec![entity(0, Geometry::Polyline { points: rect, closed: true })],
        page_size: (10.0, 5.0),
        extents: Some((Point::new(0.0, 0.0), Point::new(10.0, 5.0))),
        units: DrawingUnit::M,
    };
    let dxf = dir.join("rechthoek-m.dxf");
    open_pdf_cad::writer::write_drawing(model, CadFormat::Dxf, CadVersion::R2013, &dxf).unwrap();
    let drawing = read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    let pdf = dir.join("rechthoek-m.pdf");
    let options = args(&dxf, &pdf, r#","scale":100,"placement":"lower_left","marginMm":10,"modelMatrix":false"#).options();
    convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    check_fixture("cad-import-rechthoek-m.pdf", &std::fs::read(&pdf).unwrap());
}

/// Houdt een PDF in `open-pdf-studio/js/pdf/fixtures/` byte voor byte gelijk aan
/// wat de crate nu schrijft; met `OPDS_UPDATE_FIXTURES=1` wordt hij opnieuw
/// geschreven.
fn check_fixture(name: &str, written: &[u8]) {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../open-pdf-studio/js/pdf/fixtures").join(name);
    if std::env::var("OPDS_UPDATE_FIXTURES").is_ok_and(|v| v == "1") {
        std::fs::create_dir_all(fixture.parent().unwrap()).unwrap();
        std::fs::write(&fixture, written).unwrap();
    }
    let committed = std::fs::read(&fixture).unwrap_or_else(|_| panic!("fixture {name} ontbreekt: draai met OPDS_UPDATE_FIXTURES=1"));
    assert!(committed == written, "fixture {name} verouderd: draai met OPDS_UPDATE_FIXTURES=1");
}

/// Tweede fixture voor de app (`cad-import-tekst.pdf`): dezelfde rechthoek in
/// millimeters met een TEXT op de standaardstijl erin. Bewaakt wat de import
/// van tekst schrijft: de letterbron, de tekenstand en de plaats. De JS-test
/// `the text the crate writes sits where the drawing puts it` leest hem.
#[test]
fn the_text_fixture_for_the_app_matches_what_the_crate_writes() {
    let dir = work_dir("fixture-tekst");
    let rect = vec![Point::new(0.0, 0.0), Point::new(10000.0, 0.0), Point::new(10000.0, 5000.0), Point::new(0.0, 5000.0)];
    let model = CadModel {
        layers: vec![layer("Wanden"), layer("Tekst")],
        linetypes: Vec::new(),
        entities: vec![
            entity(0, Geometry::Polyline { points: rect, closed: true }),
            entity(
                1,
                Geometry::Text {
                    insert: Point::new(1000.0, 2000.0),
                    height: 500.0,
                    rotation: 0.0,
                    width_factor: 1.0,
                    value: "Woonkamer 24 m2".into(),
                },
            ),
        ],
        page_size: (10000.0, 5000.0),
        extents: Some((Point::new(0.0, 0.0), Point::new(10000.0, 5000.0))),
        units: DrawingUnit::Mm,
    };
    let dxf = dir.join("tekst.dxf");
    open_pdf_cad::writer::write_drawing(model, CadFormat::Dxf, CadVersion::R2013, &dxf).unwrap();
    let drawing = read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    let pdf = dir.join("tekst.pdf");
    let options = args(&dxf, &pdf, r#","scale":100,"placement":"lower_left","marginMm":10,"modelMatrix":false"#).options();
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.texts, 1);
    let written = std::fs::read(&pdf).unwrap();
    let raw = String::from_utf8_lossy(&written);
    assert!(raw.contains("/BaseFont /Helvetica"), "de standaardstijl wordt de schreefloze standaardletter");
    let content = streams(&written).join("\n");
    assert!(content.contains("(Woonkamer 24 m2) Tj"), "tekst ontbreekt:\n{}", &content[..content.len().min(600)]);
    check_fixture("cad-import-tekst.pdf", &written);
}

/// De rondgang sluit: een maskering uit de export komt bij het importeren
/// terug als een dekkend vlak in papierkleur op dezelfde plek, en telt niet
/// als niet-ondersteunde entiteit.
#[test]
fn a_mask_comes_back_as_a_fill_in_paper_colour() {
    for (format, name) in [(CadFormat::Dxf, "masker.dxf"), (CadFormat::Dwg, "masker.dwg")] {
        let dir = work_dir(&format!("masker-{}", name.split('.').next_back().unwrap()));
        let outline = vec![
            Point::new(4000.0, -600.0),
            Point::new(6000.0, -600.0),
            Point::new(6000.0, 600.0),
            Point::new(4000.0, 600.0),
        ];
        let model = CadModel {
            layers: vec![layer("Maten")],
            linetypes: Vec::new(),
            entities: vec![
                entity(0, Geometry::Line { start: Point::new(0.0, 0.0), end: Point::new(10000.0, 0.0) }),
                entity(0, Geometry::Mask { outline }),
            ],
            page_size: (10000.0, 1200.0),
            extents: Some((Point::new(0.0, -600.0), Point::new(10000.0, 600.0))),
            units: DrawingUnit::Mm,
        };
        let drawing_path = dir.join(name);
        open_pdf_cad::writer::write_drawing(model, format, CadVersion::R2013, &drawing_path).unwrap();

        let cancel = AtomicBool::new(false);
        let drawing = read(&drawing_path, &cancel, |_| {}).expect("tekening lezen");
        let pdf = dir.join("uit.pdf");
        let options = args(&drawing_path, &pdf, r#","scale":100,"placement":"lower_left","marginMm":10"#).options();
        let result = convert(&drawing, &options, &pdf, &cancel, |_| {}).expect("omzetten");
        assert_eq!(result.stats.unsupported, 0, "{name}: {:?}", result.stats.skipped_types);
        assert!(result.warnings.iter().all(|w| !w.starts_with("unsupported")), "{name}: {:?}", result.warnings);

        // Op 1:100 met 10 mm marge: het masker loopt van 50 tot 70 mm en van
        // 10 tot 22 mm op papier (141,732–198,425 × 28,346–62,362 pt).
        let content = streams(&std::fs::read(&pdf).unwrap()).join("\n");
        assert!(content.contains("1 g"), "{name}: geen vulling in papierkleur:\n{content}");
        for corner in ["141.732 28.346", "198.425 28.346", "198.425 62.362", "141.732 62.362"] {
            assert!(content.contains(corner), "{name}: hoek {corner} ontbreekt:\n{content}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
