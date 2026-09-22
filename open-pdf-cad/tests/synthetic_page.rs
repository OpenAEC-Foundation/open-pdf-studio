//! Integratietest zonder externe bestanden: een in de test opgebouwde PDF gaat
//! door de hele keten (PDFium → model → DXF én DWG) en de teruggelezen
//! coördinaten worden vergeleken met een onafhankelijk uitgerekende verwachting.
//!
//! De pagina heeft alles wat een export stuk kan laten gaan: `/Rotate 90`, een
//! MediaBox met oorsprong buiten (0,0), een formulier-XObject met eigen matrix
//! onder een `cm`, een PDF-laag (OCG), een streeplijn, tekst en een Bézier.
//!
//! De test slaat zichzelf over als de PDFium-bibliotheek niet in de repository
//! staat voor dit platform.

use acadrust::entities::EntityType;
use acadrust::{CadDocument, DwgReader, DxfReader};
use open_pdf_cad::*;
use std::path::{Path, PathBuf};

const MM: f64 = 25.4 / 72.0;
// MediaBox [-100 -50 500 350]: 600 breed, 400 hoog, weergegeven 400 × 600 na 90°.
const BOX_LEFT: f64 = -100.0;
const BOX_BOTTOM: f64 = -50.0;
const BOX_WIDTH: f64 = 600.0;

/// Verwachte uitvoer voor een punt in gebruikersruimte, hier onafhankelijk van
/// de crate uitgeschreven: 90° met de klok mee brengt (u, v) naar (v, W − u).
fn expected(x: f64, y: f64) -> (f64, f64) {
    let (u, v) = (x - BOX_LEFT, y - BOX_BOTTOM);
    (v * MM, (BOX_WIDTH - u) * MM)
}

fn build_pdf() -> Vec<u8> {
    build_pdf_with(false)
}

/// Met `annotations`: een rechthoek (Square) en een tekstvak (FreeText) met
/// een weergave, plus een verborgen annotatie en een pop-up die niet mee mogen.
fn build_pdf_with(annotations: bool) -> Vec<u8> {
    let content = "\
q 2 w 1 0 0 RG 0 0 m 100 0 l S Q\n\
q 0.5 w [6 3] 0 d 0 0 1 RG 0 10 m 100 10 l S Q\n\
/OC /MC0 BDC 0 g 10 20 50 30 re f EMC\n\
q 1 0 0 1 200 100 cm /Fm0 Do Q\n\
BT /F1 12 Tf 1 0 0 1 50 200 Tm (Hallo) Tj ET\n\
q 1 w 0 0 m 30 0 60 30 60 60 c S Q\n";
    let form = "1 w 0 0 m 10 0 l S\n";
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /Order [7 0 R] >> >> >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [-100 -50 500 350] /Rotate 90 /Contents 4 0 R \
             /Resources << /Font << /F1 5 0 R >> /XObject << /Fm0 6 0 R >> /Properties << /MC0 7 0 R >> >> {} >>",
            if annotations { "/Annots [8 0 R 10 0 R 15 0 R 12 0 R 13 0 R]" } else { "" }
        ),
        format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [2 0 0 2 10 10] /Length {} >>\nstream\n{}endstream",
            form.len(),
            form
        ),
        "<< /Type /OCG /Name (Wanden) >>".to_string(),
    ];
    let mut objects = objects;
    if annotations {
        let square_ap = "1 0 0 RG 2 w 5 5 m 95 5 l S\n";
        let text_ap = "BT /Helv 10 Tf 2 5 Td (Opmerking) Tj ET\n";
        let hidden_ap = "0 0 1 RG 1 w 0 0 m 50 50 l S\n";
        objects.extend([
            // 8: rechthoek, weergave 100 × 50 op Rect [300 50 400 100].
            "<< /Type /Annot /Subtype /Square /Rect [300 50 400 100] /F 4 /AP << /N 9 0 R >> >>".to_string(),
            format!("<< /Type /XObject /Subtype /Form /BBox [0 0 100 50] /Length {} >>\nstream\n{}endstream", square_ap.len(), square_ap),
            // 10: tekstvak met eigen app-type.
            "<< /Type /Annot /Subtype /FreeText /Rect [50 250 150 270] /F 4 /OPS_Subtype (textbox) /DA (/Helv 10 Tf 0 g) /Contents (Opmerking) /AP << /N 11 0 R >> >>".to_string(),
            format!(
                "<< /Type /XObject /Subtype /Form /BBox [0 0 100 20] /Resources << /Font << /Helv 5 0 R >> >> /Length {} >>\nstream\n{}endstream",
                text_ap.len(),
                text_ap
            ),
            // 12: verborgen (F 2): mag niet mee.
            "<< /Type /Annot /Subtype /Line /Rect [0 0 50 50] /F 2 /L [0 0 50 50] /AP << /N 14 0 R >> >>".to_string(),
            // 13: pop-up: mag niet mee.
            "<< /Type /Annot /Subtype /Popup /Rect [0 0 10 10] >>".to_string(),
            format!("<< /Type /XObject /Subtype /Form /BBox [0 0 50 50] /Length {} >>\nstream\n{}endstream", hidden_ap.len(), hidden_ap),
            // 15: rechthoek met een eigen soort die niet in de leesbuffer van
            // 128 tekens past; komt in /Annots direct na het tekstvak.
            format!(
                "<< /Type /Annot /Subtype /Square /Rect [300 150 400 200] /F 4 /OPS_Subtype ({}) /AP << /N 16 0 R >> >>",
                "x".repeat(130)
            ),
            format!("<< /Type /XObject /Subtype /Form /BBox [0 0 100 50] /Length {} >>\nstream\n{}endstream", square_ap.len(), square_ap),
        ]);
    }
    assemble(&objects)
}

/// Bouwt van een rij objectlichamen (object 1 is de catalogus) een geldige PDF.
fn assemble(objects: &[String]) -> Vec<u8> {
    let mut pdf = b"%PDF-1.5\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref_at = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref_at).as_bytes(),
    );
    pdf
}

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
    let dir = std::env::temp_dir().join(format!("opds-export-test-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn read_back(path: &Path) -> CadDocument {
    match path.extension().and_then(|e| e.to_str()) {
        Some("dwg") => DwgReader::from_file(path).unwrap().read().unwrap(),
        _ => DxfReader::from_file(path).unwrap().read().unwrap(),
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-4
}

fn assert_point(actual: (f64, f64), wanted: (f64, f64), what: &str) {
    assert!(
        close(actual.0, wanted.0) && close(actual.1, wanted.1),
        "{what}: kreeg ({:.5}, {:.5}), verwacht ({:.5}, {:.5})",
        actual.0,
        actual.1,
        wanted.0,
        wanted.1
    );
}

/// Alle lijnen als (begin, eind, laag, lijntype), ongeacht tekenrichting te vinden.
fn find_line<'a>(doc: &'a CadDocument, a: (f64, f64), b: (f64, f64)) -> Option<&'a acadrust::Line> {
    doc.model_space_entities().find_map(|e| match e {
        EntityType::Line(line)
            if close(line.start.x, a.0) && close(line.start.y, a.1) && close(line.end.x, b.0) && close(line.end.y, b.1) =>
        {
            Some(line)
        }
        _ => None,
    })
}

fn check_document(doc: &CadDocument, label: &str) {
    // Rode lijn (0,0)–(100,0), 2 pt = 0,71 mm → dichtstbijzijnde lijndikte 0,70 mm.
    let red = find_line(doc, expected(0.0, 0.0), expected(100.0, 0.0)).unwrap_or_else(|| panic!("{label}: rode lijn ontbreekt"));
    assert_eq!(red.common.layer, "PDF_FF0000_W070", "{label}");

    // Blauwe streeplijn met lijntype in tekeneenheden: 6 pt aan, 3 pt uit.
    let dashed = find_line(doc, expected(0.0, 10.0), expected(100.0, 10.0)).unwrap_or_else(|| panic!("{label}: streeplijn ontbreekt"));
    let linetype = doc.line_types.get(&dashed.common.linetype).unwrap_or_else(|| panic!("{label}: lijntype {:?} ontbreekt", dashed.common.linetype));
    let lengths: Vec<f64> = linetype.elements.iter().map(|e| e.length.abs()).collect();
    assert_eq!(lengths.len(), 2, "{label}");
    assert!(close(lengths[0], 6.0 * MM) && close(lengths[1], 3.0 * MM), "{label}: patroon {lengths:?}");

    // Lijn in het formulier-XObject: (0,0)–(10,0) → /Matrix [2 0 0 2 10 10] → cm 200 100.
    find_line(doc, expected(210.0, 110.0), expected(230.0, 110.0)).unwrap_or_else(|| panic!("{label}: lijn uit formulier ontbreekt"));

    // Gevulde rechthoek op de PDF-laag "Wanden".
    let hatch = doc
        .model_space_entities()
        .find_map(|e| match e {
            EntityType::Hatch(h) => Some(h),
            _ => None,
        })
        .unwrap_or_else(|| panic!("{label}: arcering ontbreekt"));
    assert_eq!(hatch.common.layer, "Wanden", "{label}");
    assert!(hatch.is_solid, "{label}");
    assert!(doc.layers.get("Wanden").is_some(), "{label}: laag Wanden ontbreekt");

    // Tekst: invoegpunt, hoogte (12 pt × 0,72) en hoek (−90° door de paginarotatie).
    let text = doc
        .model_space_entities()
        .find_map(|e| match e {
            EntityType::Text(t) => Some(t),
            _ => None,
        })
        .unwrap_or_else(|| panic!("{label}: tekst ontbreekt"));
    assert_eq!(text.value, "Hallo", "{label}");
    assert_point((text.insertion_point.x, text.insertion_point.y), expected(50.0, 200.0), label);
    assert!(close(text.height, 12.0 * 0.72 * MM), "{label}: hoogte {}", text.height);
    let degrees = text.rotation.to_degrees().rem_euclid(360.0);
    assert!((degrees - 270.0).abs() < 1e-6, "{label}: hoek {degrees}");

    // Bézier afgevlakt: begin- en eindpunt exact, alle punten binnen de tolerantie.
    let curve = doc
        .model_space_entities()
        .find_map(|e| match e {
            EntityType::LwPolyline(p) if p.vertices.len() > 4 => Some(p),
            _ => None,
        })
        .unwrap_or_else(|| panic!("{label}: afgevlakte kromme ontbreekt"));
    let first = curve.vertices.first().unwrap().location;
    let last = curve.vertices.last().unwrap().location;
    assert_point((first.x, first.y), expected(0.0, 0.0), label);
    assert_point((last.x, last.y), expected(60.0, 60.0), label);

    assert_eq!(doc.header.insertion_units, 4, "{label}: eenheden moeten mm zijn");
}

#[test]
fn synthetic_page_exports_to_dxf_and_dwg_with_exact_coordinates() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("synthetic");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();

    let mut counts = Vec::new();
    for (format, name) in [(CadFormat::Dxf, "uit.dxf"), (CadFormat::DxfBinary, "uit-binair.dxf"), (CadFormat::Dwg, "uit.dwg")] {
        let request = ExportRequest {
            pdf_path: pdf_path.clone(),
            page_index: 0,
            output_path: dir.join(name),
            format,
            version: CadVersion::default(),
            options: ConvertOptions::default(),
            max_entities: None,
        };
        let report = export_page(&library, &request, None, None).unwrap();
        assert_eq!(report.page_rotate, 90);
        assert!(close(report.page_width, 400.0 * MM) && close(report.page_height, 600.0 * MM));
        assert_eq!(report.extract.form_objects, 1);
        assert_eq!(report.extract.objects_with_ocg, 1);
        assert_eq!(report.convert.ocg_layers, 1);
        assert_eq!(report.convert.linetypes, 1);
        assert_eq!((report.convert.lines, report.convert.polylines, report.convert.hatches, report.convert.texts), (3, 1, 1, 1));

        let doc = read_back(&request.output_path);
        check_document(&doc, name);
        counts.push(doc.model_space_entities().count());
    }
    assert!(counts.iter().all(|&c| c == 6), "aantallen per formaat: {counts:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn spline_mode_and_real_world_scale() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("spline");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();

    let options = ConvertOptions {
        curves: CurveMode::Spline,
        scale: OutputScale::from_denominator(50.0),
        ..ConvertOptions::default()
    };
    let request = ExportRequest {
        pdf_path,
        page_index: 0,
        output_path: dir.join("uit.dwg"),
        format: CadFormat::Dwg,
        version: CadVersion::R2018,
        options,
        max_entities: None,
    };
    let report = export_page(&library, &request, None, None).unwrap();
    assert_eq!(report.convert.splines, 1);
    assert!(close(report.scale_denominator, 50.0));

    let doc = read_back(&request.output_path);
    let spline = doc
        .model_space_entities()
        .find_map(|e| match e {
            EntityType::Spline(s) => Some(s),
            _ => None,
        })
        .expect("spline ontbreekt");
    assert_eq!(spline.degree, 3);
    assert_eq!(spline.control_points.len(), 4);
    assert_eq!(spline.knots, vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
    // Op ware grootte 1:50 zijn alle maten 50× zo groot.
    let (x, y) = expected(60.0, 60.0);
    let end = spline.control_points[3];
    assert!((end.x - 50.0 * x).abs() < 1e-3 && (end.y - 50.0 * y).abs() < 1e-3);
    // De rode lijn van 100 pt is op papier 35,28 mm en in werkelijkheid 1763,9 mm.
    let (a, b) = (expected(0.0, 0.0), expected(100.0, 0.0));
    assert!(find_line(&doc, (50.0 * a.0, 50.0 * a.1), (50.0 * b.0, 50.0 * b.1)).is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

fn request_for(pdf_path: PathBuf, output_path: PathBuf, options: ConvertOptions) -> ExportRequest {
    ExportRequest {
        pdf_path,
        page_index: 0,
        output_path,
        format: CadFormat::from_extension(Path::new("x.dxf")).unwrap(),
        version: CadVersion::default(),
        options,
        max_entities: None,
    }
}

#[test]
fn annotations_are_flattened_onto_their_own_layers() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("annots");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf_with(true)).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();

    // Zonder annotaties: niets van OPS_.
    let plain = request_for(pdf_path.clone(), dir.join("zonder.dxf"), ConvertOptions::default());
    let report = export_page(&library, &plain, None, None).unwrap();
    assert_eq!(report.extract.annotations, 0);
    let doc = read_back(&plain.output_path);
    assert!(doc.layers.iter().all(|l| !l.name.starts_with("OPS_")));

    // Met annotaties: de rechthoek en het tekstvak, elk op hun eigen laag.
    let options = ConvertOptions { annotations: true, ..ConvertOptions::default() };
    let with = request_for(pdf_path.clone(), dir.join("met.dxf"), options);
    let report = export_page(&library, &with, None, None).unwrap();
    assert_eq!(report.extract.annotations, 3, "twee rechthoeken + tekstvak; verborgen en pop-up niet");
    let doc = read_back(&with.output_path);
    let square = find_line(&doc, expected(305.0, 55.0), expected(395.0, 55.0)).expect("lijn uit de weergave van de rechthoek");
    assert_eq!(square.common.layer, "OPS_Square");
    // Een eigen soort die niet in de leesbuffer past, telt niet: de annotatie
    // krijgt haar PDF-soort, niet de soort van de annotatie ervoor.
    let long_named = find_line(&doc, expected(305.0, 155.0), expected(395.0, 155.0)).expect("lijn uit de tweede rechthoek");
    assert_eq!(long_named.common.layer, "OPS_Square");
    let text = doc
        .model_space_entities()
        .find_map(|e| match e {
            EntityType::Text(t) if t.value == "Opmerking" => Some(t),
            _ => None,
        })
        .expect("tekst uit het tekstvak");
    assert_eq!(text.common.layer, "OPS_textbox");
    assert_point((text.insertion_point.x, text.insertion_point.y), expected(52.0, 255.0), "tekstvak");
    // De verborgen lijn (0,0)–(50,50) komt nergens voor.
    assert!(find_line(&doc, expected(0.0, 0.0), expected(50.0, 50.0)).is_none());
    // De pagina-inhoud zelf is er nog helemaal.
    assert!(find_line(&doc, expected(0.0, 0.0), expected(100.0, 0.0)).is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn scan_counts_what_the_export_writes() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("scan");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf_with(true)).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let options = ConvertOptions { annotations: true, ..ConvertOptions::default() };
    let scan = scan_page(&library, &pdf_path, 0, &options, None).unwrap();
    assert_eq!(scan.rotate, 90);
    assert!(close(scan.width_pt, 400.0) && close(scan.height_pt, 600.0));
    let wanden = scan.layers.iter().find(|l| l.name == "Wanden").expect("laag uit de OCG");
    assert!(wanden.from_ocg && wanden.entities == 1);
    // Beide rechthoeken: ook die met een eigen soort die niet te lezen is.
    let square = scan.layers.iter().find(|l| l.name == "OPS_Square").expect("laag van de annotatie");
    assert!(square.from_annotation && square.entities == 2);

    let report = export_page(&library, &request_for(pdf_path.clone(), dir.join("uit.dxf"), options), None, None).unwrap();
    let c = &report.convert;
    assert_eq!(scan.entities, c.lines + c.polylines + c.splines + c.hatches + c.masks + c.texts);

    // Uitgesloten lagen komen niet in het bestand.
    let options = ConvertOptions {
        annotations: true,
        excluded_layers: vec!["wanden".into(), "OPS_Square".into()],
        ..ConvertOptions::default()
    };
    let request = request_for(pdf_path, dir.join("zonder-lagen.dxf"), options);
    export_page(&library, &request, None, None).unwrap();
    let doc = read_back(&request.output_path);
    assert!(doc.layers.get("Wanden").is_none() && doc.layers.get("OPS_Square").is_none());
    assert!(doc.model_space_entities().all(|e| !matches!(e, EntityType::Hatch(_))));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn too_many_entities_is_reported_before_writing() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("limit");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let mut request = request_for(pdf_path, dir.join("uit.dxf"), ConvertOptions::default());
    request.max_entities = Some(2);
    let error = export_page(&library, &request, None, None).unwrap_err();
    assert_eq!(error, ExportError::TooLarge { entities: 6, limit: 2 });
    assert_eq!(error.to_string(), "TOO_LARGE:6:2");
    assert!(!request.output_path.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn area_and_units_on_a_rotated_page() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("area");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    // Gebied op de weergegeven pagina rond de rode lijn: die loopt na de
    // rotatie verticaal langs x = 50 pt, van y = 500 tot 400 pt.
    let options = ConvertOptions {
        area: Some(AreaRect { x0: 40.0, y0: 440.0, x1: 60.0, y1: 600.0 }),
        origin: OriginMode::Area,
        units: DrawingUnit::Cm,
        ..ConvertOptions::default()
    };
    let request = request_for(pdf_path, dir.join("uit.dxf"), options);
    export_page(&library, &request, None, None).unwrap();
    let doc = read_back(&request.output_path);
    assert_eq!(doc.header.insertion_units, 5);
    let lines: Vec<_> = doc
        .model_space_entities()
        .filter_map(|e| match e {
            EntityType::Line(l) => Some(l),
            _ => None,
        })
        .collect();
    let red = lines.iter().find(|l| l.common.layer == "PDF_FF0000_W070").expect("rode lijn, geknipt");
    // Van (50, 500) tot (50, 440) op de pagina; linksonder van het gebied
    // (40, 440) is de oorsprong: (10, 60) tot (10, 0) pt, in cm.
    let cm = MM / 10.0;
    let (ys, ye) = (red.start.y.max(red.end.y), red.start.y.min(red.end.y));
    assert!(close(red.start.x, 10.0 * cm) && close(red.end.x, 10.0 * cm));
    assert!(close(ys, 60.0 * cm) && close(ye, 0.0), "y van {ye} tot {ys}");
    // Alles valt binnen het gebied.
    for l in &lines {
        for p in [l.start, l.end] {
            assert!(p.x >= -1e-9 && p.x <= 20.0 * cm + 1e-9 && p.y >= -1e-9 && p.y <= 160.0 * cm + 1e-9);
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cancel_flag_aborts_without_output() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("cancel");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let request = ExportRequest {
        pdf_path,
        page_index: 0,
        output_path: dir.join("uit.dxf"),
        format: CadFormat::Dxf,
        version: CadVersion::default(),
        options: ConvertOptions::default(),
        max_entities: None,
    };
    let cancel = std::sync::atomic::AtomicBool::new(true);
    let result = export_page(&library, &request, Some(&cancel), None);
    assert_eq!(result.unwrap_err(), ExportError::Cancelled);
    assert!(!request.output_path.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn page_out_of_range_is_reported() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("range");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let request = ExportRequest {
        pdf_path,
        page_index: 5,
        output_path: dir.join("uit.dxf"),
        format: CadFormat::Dxf,
        version: CadVersion::default(),
        options: ConvertOptions::default(),
        max_entities: None,
    };
    let error = export_page(&library, &request, None, None).unwrap_err();
    assert_eq!(error, ExportError::PageOutOfRange { page_index: 5, page_count: 1 });
    let _ = std::fs::remove_dir_all(&dir);
}

/// Blad zoals een tekenpakket het plot: een maatlijn met daarop een dekkend
/// vlak in papierkleur en daarop de maattekst; verder een grijze vulling, een
/// wit vlak met een zwarte omtrek, en een wit vlak met een gat.
fn build_masked_pdf() -> Vec<u8> {
    let content = "\
q 0.5 w 0 G 10 50 m 190 50 l S Q\n\
q 1 1 1 rg 90 44 20 12 re f Q\n\
BT /F1 6 Tf 1 0 0 1 92 47 Tm (478) Tj ET\n\
q 0.8 0.8 0.8 rg 10 10 30 20 re f Q\n\
q 1 1 1 rg 0 G 0.5 w 60 10 30 20 re B Q\n\
q 1 1 1 rg 120 10 40 30 re 130 15 20 20 re f* Q\n";
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R \
          /Resources << /Font << /F1 5 0 R >> >> >>"
            .to_string(),
        format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    assemble(&objects)
}

#[test]
fn a_paper_coloured_fill_becomes_a_wipeout_under_the_text_that_it_masks() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("masker");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_masked_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();

    for (format, name) in [(CadFormat::Dxf, "uit.dxf"), (CadFormat::Dwg, "uit.dwg")] {
        let mut request = request_for(pdf_path.clone(), dir.join(name), ConvertOptions::default());
        request.format = format;
        let report = export_page(&library, &request, None, None).unwrap();
        // Twee dekkende vlakken in papierkleur worden maskers; de grijze
        // vulling en het witte vlak met een gat blijven arceringen.
        assert_eq!((report.convert.masks, report.convert.hatches), (2, 2), "{name}");

        let doc = read_back(&request.output_path);
        let kinds: Vec<&str> = doc.model_space_entities().map(|e| e.as_entity().entity_type()).collect();
        assert_eq!(kinds, ["LINE", "WIPEOUT", "TEXT", "HATCH", "WIPEOUT", "LWPOLYLINE", "HATCH"], "{name}");

        // Het masker dekt precies het witte vlak en ligt vóór de tekst, zodat
        // de tekst er in een CAD-programma bovenop komt.
        let wipeout = doc
            .model_space_entities()
            .find_map(|e| match e {
                EntityType::Wipeout(w) => Some(w),
                _ => None,
            })
            .unwrap_or_else(|| panic!("{name}: masker ontbreekt"));
        let corners = wipeout.world_boundary_vertices();
        let xs: Vec<f64> = corners.iter().map(|c| c.x).collect();
        let ys: Vec<f64> = corners.iter().map(|c| c.y).collect();
        let min = |v: &[f64]| v.iter().cloned().fold(f64::MAX, f64::min);
        let max = |v: &[f64]| v.iter().cloned().fold(f64::MIN, f64::max);
        assert_point((min(&xs), min(&ys)), (90.0 * MM, 44.0 * MM), &format!("{name}: linksonder"));
        assert_point((max(&xs), max(&ys)), (110.0 * MM, 56.0 * MM), &format!("{name}: rechtsboven"));
        assert_eq!(wipeout.common.layer, "PDF_FILL_FFFFFF", "{name}");
        // Het kader van een masker wordt niet getoond of geplot.
        let frame = doc.objects.values().find_map(|o| match o {
            acadrust::objects::ObjectType::WipeoutVariables(v) => Some(v.display_frame),
            _ => None,
        });
        assert_eq!(frame, Some(0), "{name}: WIPEOUTFRAME");

        // Geen enkel effen vlak in papierkleur blijft als arcering achter,
        // behalve het vlak met een gat (dat een masker niet kan uitdrukken).
        let white_hatches: Vec<usize> = doc
            .model_space_entities()
            .filter_map(|e| match e {
                EntityType::Hatch(h) if h.common.layer == "PDF_FILL_FFFFFF" => Some(h.paths.len()),
                _ => None,
            })
            .collect();
        assert_eq!(white_hatches, [2], "{name}: alleen het vlak met een gat blijft arcering");

        // Tekenvolgorde: de handles lopen op met de volgorde in het bestand,
        // dus een CAD-programma tekent het masker vóór de tekst.
        let handles: Vec<u64> = doc.model_space_entities().map(|e| e.common().handle.value()).collect();
        assert!(handles.windows(2).all(|w| w[0] < w[1]), "{name}: {handles:?}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// Maatgetallen zoals een tekenpakket ze plot: één tekstobject (`TJ`) met
/// grote verschuivingen tussen de getallen, plus een zin met gewone spaties en
/// een getallenpaar dat met een kleine verschuiving bij elkaar hoort.
fn build_dimension_chain_pdf() -> Vec<u8> {
    let content = "\
BT /F1 6 Tf 1 0 0 1 20 60 Tm [(3960) -5000 (40) -5000 (3960) -5000 (40)] TJ ET\n\
BT /F1 6 Tf 1 0 0 1 20 20 Tm (Hart op hart afstand) Tj ET\n\
BT /F1 6 Tf 0 1 -1 0 180 20 Tm [(2700) -5000 (900)] TJ ET\n\
BT /F1 6 Tf 1 0 0 1 20 40 Tm [(12) -1000 (34)] TJ ET\n";
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R \
          /Resources << /Font << /F1 5 0 R >> >> >>"
            .to_string(),
        format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    assemble(&objects)
}

#[test]
fn far_apart_pieces_of_one_text_object_each_get_their_own_place() {
    let Some(pdfium) = pdfium_path() else { return };
    let dir = work_dir("maatgetallen");
    let pdf_path = dir.join("pagina.pdf");
    std::fs::write(&pdf_path, build_dimension_chain_pdf()).unwrap();
    let library = PdfiumLibrary::load(&pdfium).unwrap();
    let request = request_for(pdf_path, dir.join("uit.dxf"), ConvertOptions::default());
    let report = export_page(&library, &request, None, None).unwrap();
    // Vier maatgetallen + de zin + twee staande getallen + het paar dat bij
    // elkaar hoort = 8 teksten uit 4 tekstobjecten.
    assert_eq!(report.extract.text_objects, 4);
    assert_eq!(report.convert.texts, 8);

    let doc = read_back(&request.output_path);
    let texts: Vec<(String, f64, f64, f64)> = doc
        .model_space_entities()
        .filter_map(|e| match e {
            EntityType::Text(t) => Some((t.value.clone(), t.insertion_point.x, t.insertion_point.y, t.rotation.to_degrees())),
            _ => None,
        })
        .collect();

    // De keten: elk getal staat op zijn eigen plek. Breedte van een cijfer in
    // deze letter is 0,556 em; een verschuiving van 5000 in de TJ-rij is
    // 5 × lettergrootte.
    let digit = 0.556 * 6.0;
    let mut x = 20.0;
    for value in ["3960", "40", "3960", "40"] {
        let found = texts
            .iter()
            .find(|(v, tx, ty, _)| v == value && (tx - x * MM).abs() < 0.4 && (ty - 60.0 * MM).abs() < 1e-3)
            .unwrap_or_else(|| panic!("{value} op x = {x:.2} pt ontbreekt; gevonden: {texts:?}"));
        assert!(found.0 == value, "{found:?}");
        x += value.len() as f64 * digit + 5.0 * 6.0;
    }
    // Een zin met gewone spaties blijft één tekst.
    assert!(texts.iter().any(|(v, ..)| v == "Hart op hart afstand"), "{texts:?}");
    // Ook staande tekst valt uiteen, met behoud van de hoek.
    let staand: Vec<&(String, f64, f64, f64)> = texts.iter().filter(|(v, ..)| v == "2700" || v == "900").collect();
    assert_eq!(staand.len(), 2, "{texts:?}");
    assert!(staand.iter().all(|(_, _, _, angle)| (angle - 90.0).abs() < 1e-6), "{staand:?}");
    assert!((staand[0].2 - staand[1].2).abs() > 20.0 * MM, "de staande getallen staan boven elkaar: {staand:?}");
    // Een kleine verschuiving (één lettergrootte) hoort nog bij dezelfde regel.
    assert!(texts.iter().any(|(v, ..)| v == "12 34" || v == "1234"), "{texts:?}");
    let _ = std::fs::remove_dir_all(&dir);
}
