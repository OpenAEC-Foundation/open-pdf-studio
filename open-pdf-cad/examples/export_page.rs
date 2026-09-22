//! Opdrachtregel-export van één pagina, voor metingen en verificatiescripts.
//!
//! ```text
//! cargo run --release -p open-pdf-cad --example export_page -- \
//!     <pdf> <pagina (1-gebaseerd)> <uitvoer.dxf|uitvoer.dwg> [opties]
//!
//!   --pdfium <pad>        PDFium-bibliotheek (standaard: OPDS_PDFIUM_LIB of de
//!                         meegeleverde bibliotheek in de repository)
//!   --scale <N>           ware grootte bij schaal 1:N (standaard papiermaat)
//!   --curves spline       krommen behouden als SPLINE (standaard afvlakken)
//!   --tolerance <mm>      afvlaktolerantie in mm op papier (standaard 0.01)
//!   --no-merge            collineaire punten niet samenvoegen
//!   --no-join             aansluitende lijnstukken niet aaneenrijgen
//!   --layers style|single laagstrategie (standaard OCG, anders stijl)
//!   --fills skip|outline  vullingen overslaan of alleen de omtrek
//!   --keep-page-fills     paginavullende vlakken niet overslaan
//!   --no-text             tekst overslaan
//!   --text-factor <f>     hoofdletterhoogte / lettergrootte (standaard 0.72)
//!   --version r2004|r2010|r2013|r2018
//!   --binary              binaire DXF
//!   --units mm|cm|m|in    tekeneenheid (standaard mm)
//!   --annotations         annotaties meenemen op lagen OPS_<soort>
//!   --exclude <laag>      laag overslaan (meermaals te gebruiken)
//!   --area x,y,b,h        alleen dit gebied (punten, oorsprong linksonder)
//!   --origin-area         linksonder van het gebied wordt de oorsprong
//!   --origin model        de oorspronkelijke modelcoördinaten van een geïmporteerde
//!                         pagina (ook: --origin page|area); schaal, eenheid en
//!                         verschuiving komen dan van de pagina
//!   --max-entities <n>    stoppen boven dit aantal entiteiten
//!   --scan                alleen tellen per laag (telverslag als JSON), niets schrijven
//! ```
//!
//! Schrijft het exportverslag als JSON naar stdout.

use open_pdf_cad::*;
use std::path::PathBuf;

fn default_pdfium() -> PathBuf {
    if let Ok(path) = std::env::var("OPDS_PDFIUM_LIB") {
        return PathBuf::from(path);
    }
    let platform = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") { "win-arm64" } else { "win-x64" }
    } else if cfg!(target_os = "macos") {
        "macos-universal"
    } else {
        "linux-x64"
    };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries")
        .join(platform)
        .join(pdfium_library_name())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        eprintln!("gebruik: export_page <pdf> <pagina> <uitvoer.dxf|dwg> [opties]");
        std::process::exit(2);
    }
    let pdf_path = PathBuf::from(&args[0]);
    let page: u32 = args[1].parse().expect("paginanummer");
    let output_path = PathBuf::from(&args[2]);

    let mut options = ConvertOptions::default();
    let mut version = CadVersion::default();
    let mut format = CadFormat::from_extension(&output_path).expect("uitvoer moet .dxf of .dwg zijn");
    let mut pdfium = default_pdfium();
    let mut quiet = false;
    let mut max_entities = None;
    let mut scan_only = false;

    let mut rest = args[3..].iter();
    while let Some(arg) = rest.next() {
        let mut value = || rest.next().unwrap_or_else(|| panic!("waarde ontbreekt na {arg}")).as_str();
        match arg.as_str() {
            "--pdfium" => pdfium = PathBuf::from(value()),
            "--scale" => options.scale = OutputScale::from_denominator(value().parse().expect("schaalnoemer")),
            "--curves" => options.curves = if value() == "spline" { CurveMode::Spline } else { CurveMode::Flatten },
            "--tolerance" => options.curve_tolerance_paper_mm = value().parse().expect("tolerantie"),
            "--no-merge" => options.merge_collinear = false,
            "--no-join" => options.join_connected = false,
            "--layers" => {
                options.layers = match value() {
                    "style" => LayerStrategy::Style,
                    "single" => LayerStrategy::Single,
                    _ => LayerStrategy::OcgThenStyle,
                }
            }
            "--fills" => {
                options.fills = match value() {
                    "skip" => FillMode::Skip,
                    "outline" => FillMode::Outline,
                    _ => FillMode::Hatch,
                }
            }
            "--keep-page-fills" => options.skip_page_fills = false,
            "--no-text" => options.text = TextMode::Skip,
            "--text-factor" => options.text_height_factor = value().parse().expect("factor"),
            "--version" => {
                version = match value() {
                    "r2004" => CadVersion::R2004,
                    "r2010" => CadVersion::R2010,
                    "r2018" => CadVersion::R2018,
                    _ => CadVersion::R2013,
                }
            }
            "--binary" => format = CadFormat::DxfBinary,
            "--units" => {
                options.units = match value() {
                    "cm" => DrawingUnit::Cm,
                    "m" => DrawingUnit::M,
                    "in" => DrawingUnit::In,
                    _ => DrawingUnit::Mm,
                }
            }
            "--annotations" => options.annotations = true,
            "--exclude" => options.excluded_layers.push(value().to_string()),
            "--area" => {
                let v: Vec<f64> = value().split(',').map(|x| x.trim().parse().expect("gebied x,y,b,h")).collect();
                options.area = Some(AreaRect { x0: v[0], y0: v[1], x1: v[0] + v[2], y1: v[1] + v[3] });
            }
            "--origin-area" => options.origin = OriginMode::Area,
            "--origin" => {
                options.origin = match value() {
                    "model" => OriginMode::Model,
                    "area" => OriginMode::Area,
                    _ => OriginMode::Page,
                }
            }
            "--max-entities" => max_entities = Some(value().parse().expect("aantal")),
            "--scan" => scan_only = true,
            "--quiet" => quiet = true,
            other => panic!("onbekende optie {other}"),
        }
    }

    if let Err(e) = resolve_model_space(&pdf_path, page.saturating_sub(1), &mut options, None) {
        eprintln!("geen terugweg naar CAD op deze pagina: {e}");
        std::process::exit(2);
    }
    let library = PdfiumLibrary::load(&pdfium).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });
    if scan_only {
        match scan_page(&library, &pdf_path, page.saturating_sub(1), &options, None) {
            Ok(scan) => println!("{}", serde_json::to_string_pretty(&scan).unwrap()),
            Err(e) => {
                eprintln!("tellen mislukt: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    let request = ExportRequest { pdf_path, page_index: page.saturating_sub(1), output_path, format, version, options, max_entities };

    let mut last_phase = None;
    let mut on_progress = |p: ExportProgress| {
        if !quiet && last_phase != Some(p.phase) {
            eprintln!("fase: {:?} ({} objecten)", p.phase, p.total);
            last_phase = Some(p.phase);
        }
    };
    match export_page(&library, &request, None, Some(&mut on_progress)) {
        Ok(report) => println!("{}", serde_json::to_string_pretty(&report).unwrap()),
        Err(e) => {
            eprintln!("export mislukt: {e}");
            std::process::exit(1);
        }
    }
}
