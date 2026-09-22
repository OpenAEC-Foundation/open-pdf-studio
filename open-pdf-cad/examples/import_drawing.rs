//! Een DWG of DXF naar PDF, vanaf de opdrachtregel (#400).
//!
//! ```text
//! cargo run --release -p open-pdf-cad --example import_drawing -- <tekening> <uit.pdf> [opties]
//!   --scan                alleen verkennen, JSON naar stdout
//!   --space <naam>        model (standaard) of de naam van een layout; meermaals toegestaan
//!   --all-layouts         elke layout met inhoud wordt een pagina
//!   --scale <N>           1:N (zonder: passend op papier)
//!   --paper <naam>        A4 … A0, A3L, A2L, A1L, Letter, Tabloid, auto, custom
//!   --size <b>x<h>        eigen papiermaat in mm (met --paper custom)
//!   --orientation <k>     auto | portrait | landscape
//!   --margin <mm>         rand rondom (standaard 10)
//!   --placement <k>       center | lower_left | origin
//!   --rotate <graden>     tekening draaien
//!   --units <e>           mm | cm | m | in | ft (overschrijft $INSUNITS)
//!   --window x0 y0 x1 y1  eigen venster in tekeningeenheden
//!   --limits              gebied uit $LIMMIN/$LIMMAX
//!   --exclude <laag>      laag uitzetten (meermaals)
//!   --window-defaults     ook lagen die niet geplot worden uitzetten, zoals het
//!                         importvenster standaard doet; meldt op stderr hoeveel
//!                         viewports de verkenning noemt en hoeveel er getekend zijn
//!   --off-layers-hidden   lagen die in het bestand uit staan toch meenemen, verborgen
//!   --no-ocg              geen PDF-lagen
//!   --colors <k>          file | black | gray | mono[:drempel%] | single:#RRGGBB
//!                         mono = zuiver zwart-wit: lijnen en tekst zwart, effen
//!                         vullingen lichter dan de drempel (standaard 50) weg
//!   --hatch <k>           all | solid_only | outline | none
//!   --no-text/--no-dimensions/--no-attributes/--points
//!   --lineweight <mm>     vaste lijndikte
//!   --pens <lijst>        kleurentabel, bijvoorbeeld "#FF0000=0.35,#0000FF=0.13"
//!   --font <van=naar>     lettervervanging, bijvoorbeeld "romans.shx=mono" (meermaals)
//!   --no-measure          geen meetschaal schrijven
//!   --no-xrefs            externe verwijzingen niet laden
//!   --no-images           afbeeldingen niet insluiten
//!   --search-path <map>   extra map om verwijzingen en afbeeldingen te zoeken (meermaals)
//!   --no-blocks-reuse     een blok dat vaker voorkomt elke keer opnieuw uitschrijven
//!                         (zonder: één keer als formulier in de PDF)
//!   --preview             voorbeeldstand: een zware ruimte zonder arceringen, tekst en
//!                         maatvoering
//!   --json                verslag als JSON
//!   --compare [n]         tekst-DXF in stukken én in één keer lezen en de
//!                         uitkomsten vergelijken (bewijs voor de stukjeslezer)
//! ```

use open_pdf_cad::import::paper::{Orientation, PaperChoice, Placement};
use open_pdf_cad::import::style::{ColorMode, LineweightMode};
use open_pdf_cad::import::walk::HatchMode;
use open_pdf_cad::import::dxf_chunks;
use open_pdf_cad::import::{convert, read, scan_drawing, AreaChoice, ImportOptions};
use open_pdf_cad::page_space::DrawingUnit;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// Leest een tekst-DXF twee keer (stuk voor stuk en in één keer) en
/// vergelijkt wat eruit komt.
fn compare_readers(input: &Path, chunk: usize) {
    use std::collections::BTreeMap;
    let data = match std::fs::read(input) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("lezen mislukt: {e}");
            std::process::exit(1);
        }
    };
    let started = Instant::now();
    let chunked = match dxf_chunks::read_in_chunks(&data, chunk, |_, _| {}, &|| false) {
        Ok(Some(document)) => document,
        Ok(None) => {
            eprintln!("te klein voor stukken (of geen tekst-DXF)");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("stuk voor stuk lezen mislukt: {e}");
            std::process::exit(1);
        }
    };
    let chunk_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let direct = match acadrust::DxfReader::from_reader(std::io::Cursor::new(data.clone())) {
        Ok(reader) => match reader.read() {
            Ok(document) => document,
            Err(e) => {
                eprintln!("in één keer lezen mislukt: {e}");
                std::process::exit(1);
            }
        },
        Err(e) => {
            eprintln!("in één keer lezen mislukt: {e}");
            std::process::exit(1);
        }
    };
    let direct_ms = started.elapsed().as_millis();
    let a = dxf_chunks::type_counts(&chunked);
    let b = dxf_chunks::type_counts(&direct);
    let space = |doc: &acadrust::CadDocument| -> BTreeMap<String, usize> {
        let mut out = BTreeMap::new();
        out.insert("model".to_string(), doc.model_space_entities().count());
        for record in doc.block_records.iter() {
            if record.is_layout() && !record.is_model_space() {
                out.insert(record.name.clone(), doc.entities_in_block(&record.name).count());
            }
        }
        out
    };
    let (sa, sb) = (space(&chunked), space(&direct));
    println!("{}", input.display());
    println!("  stuk voor stuk ({chunk} per stuk): {chunk_ms} ms; in één keer: {direct_ms} ms");
    println!("  entiteiten: {} / {}", chunked.entities().count(), direct.entities().count());
    println!("  lagen: {} / {}; blokken: {} / {}", chunked.layers.len(), direct.layers.len(), chunked.block_records.len(), direct.block_records.len());
    println!("  per ruimte: {sa:?}");
    if a == b && sa == sb {
        println!("  GELIJK: dezelfde aantallen per type en per ruimte ({} typen)", a.len());
    } else {
        println!("  VERSCHIL:");
        for (name, count) in &a {
            let other = b.get(name).copied().unwrap_or(0);
            if *count != other {
                println!("    {name}: stukken {count}, in één keer {other}");
            }
        }
        for (name, count) in &b {
            if !a.contains_key(name) {
                println!("    {name}: alleen in één keer {count}");
            }
        }
        if sa != sb {
            println!("    ruimtes: {sa:?} tegen {sb:?}");
        }
        std::process::exit(1);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("gebruik: import_drawing <tekening.dwg|dxf> <uit.pdf> [opties]");
        std::process::exit(2);
    }
    let input = Path::new(&args[0]);
    let output = Path::new(&args[1]);
    let mut options = ImportOptions::default();
    let mut only_scan = false;
    let mut compare: Option<usize> = None;
    let mut as_json = false;
    let mut all_layouts = false;
    let mut window_defaults = false;
    let mut spaces: Vec<String> = Vec::new();
    let mut font_rules: Vec<(String, open_pdf_cad::import::text::FontChoice)> = Vec::new();
    let mut i = 2;
    while i < args.len() {
        let key = args[i].as_str();
        let next = |i: &mut usize| -> String {
            *i += 1;
            args.get(*i).cloned().unwrap_or_default()
        };
        match key {
            "--scan" => only_scan = true,
            "--compare" => {
                let value = args.get(i + 1).cloned().unwrap_or_default();
                match value.parse::<usize>() {
                    Ok(n) => {
                        compare = Some(n);
                        i += 1;
                    }
                    Err(_) => compare = Some(dxf_chunks::DEFAULT_CHUNK),
                }
            }
            "--json" => as_json = true,
            "--all-layouts" => all_layouts = true,
            "--space" => spaces.push(next(&mut i)),
            "--scale" => options.scale = next(&mut i).parse().ok(),
            "--paper" => {
                options.paper = match next(&mut i).as_str() {
                    "auto" => PaperChoice::Auto,
                    "custom" => PaperChoice::Custom { width_mm: 297.0, height_mm: 420.0 },
                    name => PaperChoice::Named(name.to_string()),
                }
            }
            "--size" => {
                let value = next(&mut i);
                let mut parts = value.split(['x', 'X']);
                let w: f64 = parts.next().unwrap_or("0").parse().unwrap_or(0.0);
                let h: f64 = parts.next().unwrap_or("0").parse().unwrap_or(0.0);
                if w > 0.0 && h > 0.0 {
                    options.paper = PaperChoice::Custom { width_mm: w, height_mm: h };
                }
            }
            "--orientation" => {
                options.orientation = match next(&mut i).as_str() {
                    "portrait" => Orientation::Portrait,
                    "landscape" => Orientation::Landscape,
                    _ => Orientation::Auto,
                }
            }
            "--margin" => options.margin_mm = next(&mut i).parse().unwrap_or(10.0),
            "--placement" => {
                options.placement = match next(&mut i).as_str() {
                    "lower_left" => Placement::LowerLeft,
                    "origin" => Placement::Origin,
                    _ => Placement::Center,
                }
            }
            "--rotate" => options.rotation_deg = next(&mut i).parse().unwrap_or(0.0),
            "--units" => {
                options.units = match next(&mut i).as_str() {
                    "mm" => Some(DrawingUnit::Mm),
                    "cm" => Some(DrawingUnit::Cm),
                    "m" => Some(DrawingUnit::M),
                    "in" => Some(DrawingUnit::In),
                    "ft" => Some(DrawingUnit::Ft),
                    _ => None,
                }
            }
            "--window" => {
                let mut rect = [0.0f64; 4];
                for value in rect.iter_mut() {
                    *value = next(&mut i).parse().unwrap_or(0.0);
                }
                options.area = AreaChoice::Window(rect);
            }
            "--limits" => options.area = AreaChoice::Limits,
            "--exclude" => options.excluded_layers.push(next(&mut i)),
            "--window-defaults" => window_defaults = true,
            "--off-layers-hidden" => options.hidden_layers.push("*".into()),
            "--no-ocg" => options.layers_as_ocg = false,
            "--colors" => {
                // "mono:70" en "single:#004080": de waarde staat achter de dubbele punt.
                let choice = next(&mut i);
                let (name, value) = match choice.split_once(':') {
                    Some((name, value)) => (name, Some(value)),
                    None => (choice.as_str(), None),
                };
                options.color_mode = ColorMode::from_args(Some(name), value.and_then(|v| v.parse().ok()), value);
            }
            "--hatch" => {
                options.hatch = match next(&mut i).as_str() {
                    "solid_only" => HatchMode::SolidOnly,
                    "outline" => HatchMode::Outline,
                    "none" => HatchMode::None,
                    _ => HatchMode::All,
                }
            }
            "--no-text" => options.text = false,
            "--no-dimensions" => options.dimensions = false,
            "--no-attributes" => options.attributes = false,
            "--points" => options.points = true,
            "--lineweight" => options.lineweight = LineweightMode::Fixed(next(&mut i).parse().unwrap_or(0.25)),
            "--pens" => {
                // --pens "#FF0000=0.35,#0000FF=0.13"
                let raw = next(&mut i);
                let pairs: Vec<((u8, u8, u8), f64)> = raw
                    .split(',')
                    .filter_map(|part| {
                        let (color, width) = part.split_once('=')?;
                        let rgb = open_pdf_cad::import::style::PenTable::parse_color(color.trim())?;
                        Some((rgb, width.trim().parse::<f64>().ok()?))
                    })
                    .collect();
                options.pens = open_pdf_cad::import::style::PenTable::from_pairs(&pairs);
                options.lineweight = LineweightMode::Pens;
            }
            "--font" => {
                // --font "romans.shx=mono" of "arial.ttf=sans,bold"
                let raw = next(&mut i);
                if let Some((from, spec)) = raw.split_once('=') {
                    let parts: Vec<&str> = spec.split(',').map(|s| s.trim()).collect();
                    let family = if parts.iter().any(|p| p.eq_ignore_ascii_case("mono")) {
                        open_pdf_cad::import::text::FontFamily::Mono
                    } else {
                        open_pdf_cad::import::text::FontFamily::Sans
                    };
                    font_rules.push((
                        from.to_string(),
                        open_pdf_cad::import::text::FontChoice {
                            family,
                            italic: parts.iter().any(|p| p.eq_ignore_ascii_case("italic")),
                            bold: parts.iter().any(|p| p.eq_ignore_ascii_case("bold")),
                        },
                    ));
                }
            }
            "--no-measure" => options.measure = false,
            "--no-xrefs" => options.xrefs = false,
            "--no-images" => options.images = false,
            "--no-blocks-reuse" => options.reuse_blocks = false,
            "--preview" => options.preview = true,
            "--search-path" => options.search_paths.push(std::path::PathBuf::from(next(&mut i))),
            other => eprintln!("onbekende optie {other}"),
        }
        i += 1;
    }
    if !font_rules.is_empty() {
        options.fonts = open_pdf_cad::import::text::FontMap::new(font_rules, open_pdf_cad::import::text::FontChoice::DEFAULT);
    }

    if let Some(chunk) = compare {
        compare_readers(input, chunk);
        return;
    }

    let cancel = AtomicBool::new(false);
    let started = Instant::now();
    let drawing = match read(input, &cancel, |_| {}) {
        Ok(drawing) => drawing,
        Err(e) => {
            eprintln!("lezen mislukt: {e}");
            std::process::exit(1);
        }
    };
    let read_ms = started.elapsed().as_millis();
    let scan = match scan_drawing(&drawing, &cancel) {
        Ok(scan) => scan,
        Err(e) => {
            eprintln!("verkennen mislukt: {e}");
            std::process::exit(1);
        }
    };
    if only_scan {
        println!("{}", serde_json::to_string_pretty(&scan).unwrap());
        return;
    }
    if all_layouts {
        spaces = scan.spaces.iter().filter(|s| s.kind == "layout" && s.objects > 0).map(|s| s.id.clone()).collect();
    }
    if spaces.is_empty() {
        spaces.push(scan.default_space.clone());
    }
    options.spaces = spaces;
    // "Lagen die uit staan verborgen meenemen": de sterretjesvorm vervangen
    // door de werkelijke namen.
    if options.hidden_layers.iter().any(|l| l == "*") {
        options.hidden_layers = scan.layers.iter().filter(|l| l.off || l.frozen).map(|l| l.name.clone()).collect();
    } else {
        // Standaard: lagen die uit of bevroren staan komen niet mee; met de
        // standaarden van het venster ook wat niet geplot wordt.
        for layer in scan.layers.iter().filter(|l| l.off || l.frozen || (window_defaults && !l.plottable)) {
            if !options.excluded_layers.iter().any(|name| name.eq_ignore_ascii_case(&layer.name)) {
                options.excluded_layers.push(layer.name.clone());
            }
        }
    }

    // De import vervangt nooit stil een bestaand bestand; dit voorbeeld wel,
    // zodat een batch opnieuw kan draaien.
    let _ = std::fs::remove_file(output);
    let converted = Instant::now();
    match convert(&drawing, &options, output, &cancel, |_| {}) {
        Ok(result) => {
            if window_defaults {
                // Gemeld is getekend, bij elke laagkeuze: de laag van een venster
                // verbergt alleen zijn kader.
                let reported: usize =
                    scan.spaces.iter().filter(|space| options.spaces.iter().any(|id| *id == space.id)).map(|space| space.viewports.len()).sum();
                eprintln!("VIEWPORTS gemeld={reported} getekend={}", result.stats.viewports_drawn);
            }
            if as_json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
                return;
            }
            println!(
                "{} ({} bytes, {}) gelezen in {} ms{}, omgezet in {} ms",
                input.display(),
                drawing.file_bytes,
                drawing.version,
                read_ms,
                if drawing.chunked { " (in stukken)" } else { "" },
                converted.elapsed().as_millis()
            );
            for page in &result.pages {
                println!(
                    "  {} → {} ({:.0} × {:.0} mm), schaal {}, {} onderdelen",
                    page.space, page.paper, page.width_mm, page.height_mm, page.scale_text, page.objects
                );
            }
            println!(
                "  {} entiteiten ({} bezoeken), {} getekend, {} tekst, {} arceringen, {} blokinvoegingen, {} viewports",
                result.stats.entities,
                result.stats.visits,
                result.stats.drawn,
                result.stats.texts,
                result.stats.hatches,
                result.stats.blocks_expanded,
                result.stats.viewports_drawn
            );
            if result.stats.forms_written > 0 {
                println!(
                    "  {} blokken als formulier, {} plaatsingen",
                    result.stats.forms_written, result.stats.forms_reused
                );
            }
            if !result.warnings.is_empty() {
                println!("  let op: {}", result.warnings.join(", "));
            }
            if !result.stats.skipped_types.is_empty() {
                println!("  overgeslagen: {:?}", result.stats.skipped_types);
            }
            // Wat er van buiten de tekening gelezen is (of niet), bij naam.
            for file in &result.externals {
                println!("  van buiten: {} ({:?}, {:?})", file.name, file.kind, file.status);
            }
            if result.externals_truncated {
                println!("  van buiten: … en meer");
            }
            println!("  {} ({} bytes)", result.output_path, result.file_size);
        }
        Err(e) => {
            eprintln!("omzetten mislukt: {e}");
            std::process::exit(1);
        }
    }
}
