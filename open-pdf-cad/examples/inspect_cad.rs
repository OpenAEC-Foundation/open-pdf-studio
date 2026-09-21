//! Leesproef: een DXF- of DWG-bestand inlezen en rapporteren wat eruit komt.
//!
//! Twee doelen:
//! 1. bewijzen dat een geschreven DWG teruggelezen dezelfde entiteiten geeft
//!    als de DXF uit hetzelfde model;
//! 2. voor de import: vaststellen welke gegevens een bestand werkelijk levert
//!    (lagen met status, eenheden, grenzen, layouts, blokken, lettertypen),
//!    want dat bepaalt welke instellingen in een importvenster een zinvolle
//!    beginwaarde kunnen krijgen.
//!
//! ```text
//! cargo run --release -p open-pdf-cad --example inspect_cad -- <bestand> [--json]
//! ```

use acadrust::entities::EntityType;
use acadrust::objects::ObjectType;
use acadrust::{CadDocument, Color, DwgReader, DxfReader, LineWeight};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

fn kind(entity: &EntityType) -> &'static str {
    match entity {
        EntityType::Point(_) => "POINT",
        EntityType::Line(_) => "LINE",
        EntityType::Circle(_) => "CIRCLE",
        EntityType::Arc(_) => "ARC",
        EntityType::Ellipse(_) => "ELLIPSE",
        EntityType::Polyline(_) => "POLYLINE",
        EntityType::Polyline2D(_) => "POLYLINE2D",
        EntityType::Polyline3D(_) => "POLYLINE3D",
        EntityType::LwPolyline(_) => "LWPOLYLINE",
        EntityType::Text(_) => "TEXT",
        EntityType::MText(_) => "MTEXT",
        EntityType::Spline(_) => "SPLINE",
        EntityType::Helix(_) => "HELIX",
        EntityType::Dimension(_) => "DIMENSION",
        EntityType::Hatch(_) => "HATCH",
        EntityType::Solid(_) => "SOLID",
        EntityType::Face3D(_) => "3DFACE",
        EntityType::Insert(_) => "INSERT",
        EntityType::Block(_) => "BLOCK",
        EntityType::BlockEnd(_) => "ENDBLK",
        EntityType::Ray(_) => "RAY",
        EntityType::XLine(_) => "XLINE",
        EntityType::Viewport(_) => "VIEWPORT",
        EntityType::AttributeDefinition(_) => "ATTDEF",
        EntityType::AttributeEntity(_) => "ATTRIB",
        EntityType::Leader(_) => "LEADER",
        EntityType::MultiLeader(_) => "MULTILEADER",
        EntityType::MLine(_) => "MLINE",
        EntityType::Mesh(_) => "MESH",
        EntityType::RasterImage(_) => "IMAGE",
        EntityType::Solid3D(_) => "3DSOLID",
        EntityType::Region(_) => "REGION",
        EntityType::Body(_) => "BODY",
        EntityType::Surface(_) => "SURFACE",
        EntityType::Table(_) => "TABLE",
        EntityType::Tolerance(_) => "TOLERANCE",
        EntityType::PolyfaceMesh(_) => "POLYFACEMESH",
        EntityType::Wipeout(_) => "WIPEOUT",
        EntityType::Shape(_) => "SHAPE",
        EntityType::Underlay(_) => "UNDERLAY",
        EntityType::Seqend(_) => "SEQEND",
        EntityType::Ole2Frame(_) => "OLE2FRAME",
        EntityType::PolygonMesh(_) => "POLYGONMESH",
        EntityType::Light(_) => "LIGHT",
        EntityType::SectionSymbol(_) => "SECTIONSYMBOL",
        EntityType::ViewBorder(_) => "VIEWBORDER",
        EntityType::Extended(_) => "EXTENDED",
        EntityType::Unknown(_) => "UNKNOWN",
    }
}

fn color_text(color: &Color) -> String {
    match color {
        Color::ByLayer => "ByLayer".into(),
        Color::ByBlock => "ByBlock".into(),
        Color::None => "None".into(),
        Color::Index(i) => format!("ACI {i}"),
        Color::Rgb { r, g, b } => format!("#{r:02X}{g:02X}{b:02X}"),
    }
}

fn lineweight_text(weight: &LineWeight) -> String {
    match weight {
        LineWeight::ByLayer => "ByLayer".into(),
        LineWeight::ByBlock => "ByBlock".into(),
        LineWeight::Default => "Default".into(),
        LineWeight::Value(v) => format!("{:.2} mm", *v as f64 / 100.0),
    }
}

fn units_text(code: i16) -> &'static str {
    match code {
        0 => "zonder eenheid",
        1 => "inch",
        2 => "voet",
        4 => "mm",
        5 => "cm",
        6 => "m",
        7 => "km",
        _ => "overig",
    }
}

#[derive(Serialize)]
struct LayerInfo {
    name: String,
    color: String,
    off: bool,
    frozen: bool,
    locked: bool,
    plottable: bool,
    lineweight: String,
    linetype: String,
    model_space_entities: u64,
}

#[derive(Serialize)]
struct LayoutInfo {
    name: String,
    tab_order: i16,
    paper_size: String,
    paper_width_mm: f64,
    paper_height_mm: f64,
    plot_rotation: i16,
    limits: [(f64, f64); 2],
    extents: [(f64, f64); 2],
    block_record: String,
    entities: u64,
    viewports: u64,
}

#[derive(Serialize)]
struct ViewportInfo {
    layout_block: String,
    id: i16,
    paper_center: (f64, f64),
    paper_size: (f64, f64),
    view_center: (f64, f64),
    view_height: f64,
    /// Papiereenheden per modeleenheid: hoogte op papier / hoogte in het model.
    scale: f64,
    twist_deg: f64,
    frozen_layers: usize,
}

#[derive(Serialize)]
struct SpaceCounts {
    total: u64,
    by_type: BTreeMap<String, u64>,
}

#[derive(Serialize)]
struct Bounds {
    min: (f64, f64),
    max: (f64, f64),
    width: f64,
    height: f64,
}

#[derive(Serialize)]
struct Report {
    file: String,
    file_bytes: u64,
    read_ms: u64,
    version: String,
    // Leesstatistiek van de bibliotheek.
    source_records: usize,
    decoded_records: usize,
    skipped_records: usize,
    recovered_errors: usize,
    notifications: BTreeMap<String, u64>,
    notification_samples: Vec<String>,
    // Kop van het bestand.
    insunits: i16,
    insunits_text: String,
    measurement: i16,
    ltscale: f64,
    code_page: String,
    header_extents: Option<Bounds>,
    header_limits: Option<Bounds>,
    /// Omhullende, berekend uit de entiteiten in de modelruimte.
    computed_extents: Option<Bounds>,
    layers: Vec<LayerInfo>,
    linetypes: Vec<(String, usize, f64)>,
    text_styles: Vec<(String, String, String, bool)>,
    block_count: usize,
    anonymous_blocks: usize,
    xref_blocks: Vec<(String, String)>,
    layouts: Vec<LayoutInfo>,
    viewports: Vec<ViewportInfo>,
    model_space: SpaceCounts,
    paper_space: SpaceCounts,
    in_blocks: SpaceCounts,
    insert_count: u64,
    distinct_inserted_blocks: usize,
    max_insert_nesting: u32,
    image_files: Vec<String>,
    /// Objecten die de tekenvolgorde vastleggen (SORTENTSTABLE).
    draw_order_tables: usize,
    /// Doorzichtigheid van arceringen: per bron/waarde geteld.
    hatch_transparency: BTreeMap<String, u64>,
    entity_colors: BTreeMap<String, u64>,
    entity_lineweights: BTreeMap<String, u64>,
    entity_linetypes: BTreeMap<String, u64>,
    text_samples: Vec<String>,
}

fn bounds(min: (f64, f64), max: (f64, f64)) -> Option<Bounds> {
    let sane = |v: f64| v.is_finite() && v.abs() < 1e19;
    (sane(min.0) && sane(min.1) && sane(max.0) && sane(max.1) && max.0 >= min.0 && max.1 >= min.1).then(|| Bounds {
        min,
        max,
        width: max.0 - min.0,
        height: max.1 - min.1,
    })
}

fn read(path: &Path) -> Result<(CadDocument, acadrust::ReadStats), String> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let outcome = match extension.as_str() {
        "dwg" => DwgReader::from_file(path).map_err(|e| e.to_string())?.read_with_stats(),
        "dxf" => DxfReader::from_file(path).map_err(|e| e.to_string())?.read_with_stats(),
        other => return Err(format!("onbekende extensie .{other}")),
    }
    .map_err(|e| e.to_string())?;
    Ok((outcome.document, outcome.stats))
}

/// Diepste nesting van INSERT in blokken, met een rem tegen kringverwijzingen.
fn nesting(doc: &CadDocument, block: &str, depth: u32, seen: &mut Vec<String>) -> u32 {
    if depth > 16 || seen.iter().any(|b| b.eq_ignore_ascii_case(block)) {
        return depth;
    }
    seen.push(block.to_string());
    let mut deepest = depth;
    for entity in doc.entities_in_block(block) {
        if let EntityType::Insert(insert) = entity {
            deepest = deepest.max(nesting(doc, &insert.block_name, depth + 1, seen));
        }
    }
    seen.pop();
    deepest
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(file) = args.first() else {
        eprintln!("gebruik: inspect_cad <bestand.dxf|dwg> [--json]");
        std::process::exit(2);
    };
    let as_json = args.iter().any(|a| a == "--json");
    let path = Path::new(file);

    let started = Instant::now();
    let (doc, stats) = match read(path) {
        Ok(result) => result,
        Err(e) => {
            eprintln!("lezen mislukt: {e}");
            std::process::exit(1);
        }
    };
    let read_ms = started.elapsed().as_millis() as u64;

    let mut notifications: BTreeMap<String, u64> = BTreeMap::new();
    let mut notification_samples = Vec::new();
    for n in doc.notifications.iter() {
        *notifications.entry(n.notification_type.to_string()).or_default() += 1;
        if notification_samples.len() < 8 {
            notification_samples.push(format!("{}: {}", n.notification_type, n.message.chars().take(160).collect::<String>()));
        }
    }

    // Modelruimte.
    let mut model = SpaceCounts { total: 0, by_type: BTreeMap::new() };
    let mut per_layer: BTreeMap<String, u64> = BTreeMap::new();
    let (mut min, mut max) = ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN));
    let mut entity_colors: BTreeMap<String, u64> = BTreeMap::new();
    let mut entity_lineweights: BTreeMap<String, u64> = BTreeMap::new();
    let mut entity_linetypes: BTreeMap<String, u64> = BTreeMap::new();
    let mut text_samples = Vec::new();
    let mut hatch_transparency: BTreeMap<String, u64> = BTreeMap::new();
    let mut insert_count = 0u64;
    let mut inserted: BTreeMap<String, u64> = BTreeMap::new();
    let mut image_files = Vec::new();
    for entity in doc.model_space_entities() {
        model.total += 1;
        *model.by_type.entry(kind(entity).to_string()).or_default() += 1;
        let common = entity.common();
        *per_layer.entry(common.layer.to_uppercase()).or_default() += 1;
        let color_key = match &common.color {
            Color::Index(_) => "ACI".to_string(),
            Color::Rgb { .. } => "RGB".to_string(),
            other => color_text(other),
        };
        *entity_colors.entry(color_key).or_default() += 1;
        let weight_key = match &common.line_weight {
            LineWeight::Value(_) => "waarde".to_string(),
            other => lineweight_text(other),
        };
        *entity_lineweights.entry(weight_key).or_default() += 1;
        let linetype = if common.linetype.is_empty() { "ByLayer".to_string() } else { common.linetype.clone() };
        *entity_linetypes.entry(linetype).or_default() += 1;

        let bbox = entity.as_entity().bounding_box();
        for v in [bbox.min, bbox.max] {
            if v.x.is_finite() && v.y.is_finite() && v.x.abs() < 1e19 && v.y.abs() < 1e19 {
                min = (min.0.min(v.x), min.1.min(v.y));
                max = (max.0.max(v.x), max.1.max(v.y));
            }
        }
        match entity {
            EntityType::Hatch(_) => {
                let key = match common.transparency {
                    acadrust::types::Transparency::ByLayer => "ByLayer".to_string(),
                    acadrust::types::Transparency::ByBlock => "ByBlock".to_string(),
                    acadrust::types::Transparency::Explicit(0) => "ondoorzichtig".to_string(),
                    acadrust::types::Transparency::Explicit(v) => format!("{}%", (v as f64 / 2.55).round()),
                };
                *hatch_transparency.entry(key).or_default() += 1;
            }
            EntityType::Insert(insert) => {
                insert_count += 1;
                *inserted.entry(insert.block_name.clone()).or_default() += 1;
            }
            EntityType::Text(text) if text_samples.len() < 12 => {
                text_samples.push(format!("TEXT h={:.3} stijl={} {:?}", text.height, text.style, text.value.chars().take(40).collect::<String>()));
            }
            EntityType::MText(text) if text_samples.len() < 12 => {
                text_samples.push(format!(
                    "MTEXT op ({:.1}, {:.1}) h={:.3} breedte={:.1} hechting={:?} hoek={:.1}° stijl={} {:?}",
                    text.insertion_point.x,
                    text.insertion_point.y,
                    text.height,
                    text.rectangle_width,
                    text.attachment_point,
                    text.rotation.to_degrees(),
                    text.style,
                    text.value.chars().take(70).collect::<String>()
                ));
            }
            EntityType::RasterImage(image) => image_files.push(image.file_path.clone()),
            _ => {}
        }
    }

    // Blokken, papierruimte, layouts.
    let mut paper = SpaceCounts { total: 0, by_type: BTreeMap::new() };
    let mut in_blocks = SpaceCounts { total: 0, by_type: BTreeMap::new() };
    let mut anonymous_blocks = 0usize;
    let mut xref_blocks = Vec::new();
    let mut block_names_by_handle: BTreeMap<u64, String> = BTreeMap::new();
    let mut viewports = Vec::new();
    for record in doc.block_records.iter() {
        block_names_by_handle.insert(record.handle.value(), record.name.clone());
        if record.flags.anonymous {
            anonymous_blocks += 1;
        }
        if record.flags.is_xref || record.flags.is_xref_overlay || !record.xref_path.is_empty() {
            xref_blocks.push((record.name.clone(), record.xref_path.clone()));
        }
        if record.is_model_space() {
            continue;
        }
        let target = if record.is_layout() { &mut paper } else { &mut in_blocks };
        for entity in doc.entities_in_block(&record.name) {
            target.total += 1;
            *target.by_type.entry(kind(entity).to_string()).or_default() += 1;
            if let EntityType::Viewport(vp) = entity {
                viewports.push(ViewportInfo {
                    layout_block: record.name.clone(),
                    id: vp.id,
                    paper_center: (vp.center.x, vp.center.y),
                    paper_size: (vp.width, vp.height),
                    view_center: (vp.view_center.x, vp.view_center.y),
                    view_height: vp.view_height,
                    scale: if vp.view_height > 0.0 { vp.height / vp.view_height } else { 0.0 },
                    twist_deg: vp.twist_angle.to_degrees(),
                    frozen_layers: vp.frozen_layers.len(),
                });
            }
        }
    }

    let mut layouts = Vec::new();
    for object in doc.objects.values() {
        if let ObjectType::Layout(layout) = object {
            let block = block_names_by_handle.get(&layout.block_record.value()).cloned().unwrap_or_default();
            let (mut entities, mut vps) = (0u64, 0u64);
            if !block.is_empty() {
                for entity in doc.entities_in_block(&block) {
                    entities += 1;
                    if matches!(entity, EntityType::Viewport(_)) {
                        vps += 1;
                    }
                }
            }
            layouts.push(LayoutInfo {
                name: layout.name.clone(),
                tab_order: layout.tab_order,
                paper_size: layout.paper_size.clone(),
                paper_width_mm: layout.paper_width,
                paper_height_mm: layout.paper_height,
                plot_rotation: layout.plot_rotation,
                limits: [layout.min_limits, layout.max_limits],
                extents: [(layout.min_extents.0, layout.min_extents.1), (layout.max_extents.0, layout.max_extents.1)],
                block_record: block,
                entities,
                viewports: vps,
            });
        }
    }
    layouts.sort_by_key(|l| l.tab_order);

    let mut max_insert_nesting = 0;
    for block in inserted.keys() {
        max_insert_nesting = max_insert_nesting.max(nesting(&doc, block, 1, &mut Vec::new()));
    }

    let layers: Vec<LayerInfo> = doc
        .layers
        .iter()
        .map(|layer| LayerInfo {
            name: layer.name.clone(),
            color: color_text(&layer.color),
            off: layer.flags.off,
            frozen: layer.flags.frozen,
            locked: layer.flags.locked,
            plottable: layer.is_plottable,
            lineweight: lineweight_text(&layer.line_weight),
            linetype: layer.line_type.clone(),
            model_space_entities: per_layer.get(&layer.name.to_uppercase()).copied().unwrap_or(0),
        })
        .collect();

    let header = &doc.header;
    let report = Report {
        file: file.clone(),
        file_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        read_ms,
        version: format!("{:?}", doc.version),
        source_records: stats.source_records,
        decoded_records: stats.decoded_source_records,
        skipped_records: stats.skipped_source_records,
        recovered_errors: stats.recovered_errors,
        notifications,
        notification_samples,
        insunits: header.insertion_units,
        insunits_text: units_text(header.insertion_units).to_string(),
        measurement: header.measurement,
        ltscale: header.linetype_scale,
        code_page: header.code_page.clone(),
        header_extents: bounds(
            (header.model_space_extents_min.x, header.model_space_extents_min.y),
            (header.model_space_extents_max.x, header.model_space_extents_max.y),
        ),
        header_limits: bounds(
            (header.model_space_limits_min.x, header.model_space_limits_min.y),
            (header.model_space_limits_max.x, header.model_space_limits_max.y),
        )
        .filter(|b| b.width > 0.0 && b.height > 0.0),
        computed_extents: bounds(min, max),
        layers,
        linetypes: doc.line_types.iter().map(|l| (l.name.clone(), l.elements.len(), l.pattern_length)).collect(),
        text_styles: doc
            .text_styles
            .iter()
            .map(|s| (s.name.clone(), s.font_file.clone(), s.true_type_font.clone(), s.is_shape_file))
            .collect(),
        block_count: doc.block_records.iter().count(),
        anonymous_blocks,
        xref_blocks,
        layouts,
        viewports,
        model_space: model,
        paper_space: paper,
        in_blocks,
        insert_count,
        distinct_inserted_blocks: inserted.len(),
        max_insert_nesting,
        image_files,
        draw_order_tables: doc
            .objects
            .values()
            .filter(|o| matches!(o, ObjectType::SortEntitiesTable(_)))
            .count(),
        hatch_transparency,
        entity_colors,
        entity_lineweights,
        entity_linetypes,
        text_samples,
    };

    if as_json {
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        return;
    }

    println!("{} ({} bytes), gelezen in {} ms, versie {}", report.file, report.file_bytes, report.read_ms, report.version);
    println!(
        "records: {} bron, {} gedecodeerd, {} overgeslagen, {} herstelde fouten; meldingen {:?}",
        report.source_records, report.decoded_records, report.skipped_records, report.recovered_errors, report.notifications
    );
    println!("eenheden: $INSUNITS={} ({}), $MEASUREMENT={}, $LTSCALE={}", report.insunits, report.insunits_text, report.measurement, report.ltscale);
    for (label, b) in [("extents (kop)", &report.header_extents), ("limits (kop)", &report.header_limits), ("extents (berekend)", &report.computed_extents)] {
        match b {
            Some(b) => println!("{label}: ({:.3}, {:.3}) – ({:.3}, {:.3}) = {:.3} × {:.3}", b.min.0, b.min.1, b.max.0, b.max.1, b.width, b.height),
            None => println!("{label}: niet bruikbaar"),
        }
    }
    println!("modelruimte: {} entiteiten {:?}", report.model_space.total, report.model_space.by_type);
    println!("papierruimte: {} entiteiten {:?}", report.paper_space.total, report.paper_space.by_type);
    println!("in blokken: {} entiteiten; {} blokken ({} anoniem), {} INSERT van {} blokken, nesting {}", report.in_blocks.total, report.block_count, report.anonymous_blocks, report.insert_count, report.distinct_inserted_blocks, report.max_insert_nesting);
    println!("lagen: {} ({} uit, {} bevroren)", report.layers.len(), report.layers.iter().filter(|l| l.off).count(), report.layers.iter().filter(|l| l.frozen).count());
    for layer in report.layers.iter().take(12) {
        println!("  {:32} {:10} uit={} bevroren={} {} {} → {} entiteiten", layer.name, layer.color, layer.off, layer.frozen, layer.lineweight, layer.linetype, layer.model_space_entities);
    }
    println!("layouts: {}", report.layouts.len());
    for layout in &report.layouts {
        println!("  {:20} papier {:.0}×{:.0} mm ({}) rotatie {} → {} entiteiten, {} viewports", layout.name, layout.paper_width_mm, layout.paper_height_mm, layout.paper_size, layout.plot_rotation, layout.entities, layout.viewports);
    }
    for vp in report.viewports.iter().take(6) {
        println!("  viewport {} in {}: papier {:.1}×{:.1}, modelhoogte {:.1}, schaal 1:{:.2}", vp.id, vp.layout_block, vp.paper_size.0, vp.paper_size.1, vp.view_height, if vp.scale > 0.0 { 1.0 / vp.scale } else { 0.0 });
    }
    println!("tekenvolgorde-tabellen: {}; arcering-doorzichtigheid: {:?}", report.draw_order_tables, report.hatch_transparency);
    println!("tekststijlen: {:?}", report.text_styles);
    println!("externe verwijzingen: {:?}; afbeeldingen: {:?}", report.xref_blocks, report.image_files);
    for sample in &report.text_samples {
        println!("  {sample}");
    }
}
