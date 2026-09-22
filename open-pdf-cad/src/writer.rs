//! Het neutrale model wegschrijven als DXF of DWG. Beide formaten lopen via
//! hetzelfde `acadrust`-document; alleen de laatste stap verschilt.

use crate::error::ExportError;
use crate::model::{Drawing, Entity, Geometry, Rgb};
use crate::page_space::DrawingUnit;
use acadrust::entities::hatch::{BoundaryEdge, BoundaryPath, BoundaryPathFlags, Hatch, PolylineEdge};
use acadrust::entities::{EntityType, Line, LwPolyline, Spline, Text};
use acadrust::tables::linetype::LineTypeElement;
use acadrust::tables::{Layer, LineType, TableEntry, TextStyle};
use acadrust::{CadDocument, Color, DwgWriter, DxfVersion, DxfWriter, LineWeight, Vector2, Vector3};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Om de zoveel entiteiten kijkt het opbouwen of de gebruiker heeft afgebroken.
const CANCEL_EVERY: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CadFormat {
    /// DXF als tekst: door vrijwel alle CAD-programma's te lezen.
    #[default]
    Dxf,
    /// Binaire DXF: zelfde inhoud, kleiner en sneller.
    DxfBinary,
    Dwg,
}

impl CadFormat {
    pub fn from_extension(path: &Path) -> Option<CadFormat> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "dxf" => Some(CadFormat::Dxf),
            "dwg" => Some(CadFormat::Dwg),
            _ => None,
        }
    }
}

/// Bestandsversie. Ware kleuren bestaan vanaf 2004; oudere versies bieden we
/// daarom niet aan.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CadVersion {
    R2004,
    R2010,
    #[default]
    R2013,
    R2018,
}

impl CadVersion {
    fn dxf_version(self) -> DxfVersion {
        match self {
            CadVersion::R2004 => DxfVersion::AC1018,
            CadVersion::R2010 => DxfVersion::AC1024,
            CadVersion::R2013 => DxfVersion::AC1027,
            CadVersion::R2018 => DxfVersion::AC1032,
        }
    }
}

/// Tekststijl van alle geëxporteerde tekst. Een TrueType-letter in plaats van
/// de standaard-vectorletter: de meeste PDF-tekst is schreefloos, zodat breedte
/// en beeld dicht bij het origineel blijven.
pub const TEXT_STYLE_NAME: &str = "PDF_TEKST";
const TEXT_STYLE_FONT: &str = "arial.ttf";

/// Zuiver zwart wordt kleurindex 7: die toont een CAD-programma zwart op een
/// lichte en wit op een donkere achtergrond. Ware kleur 0,0,0 zou op de
/// gebruikelijke donkere tekenachtergrond onzichtbaar zijn.
fn cad_color(rgb: Rgb) -> Color {
    if rgb == Rgb::BLACK {
        Color::Index(7)
    } else {
        Color::from_rgb(rgb.r, rgb.g, rgb.b)
    }
}

/// Bouwt het `acadrust`-document. Neemt de tekening over zodat de entiteiten
/// niet dubbel in het geheugen staan. Afbreken (`cancel`) wordt om de zoveel
/// entiteiten gezien en geeft [`ExportError::Cancelled`].
pub fn build_document(drawing: Drawing, version: CadVersion, cancel: Option<&AtomicBool>) -> Result<CadDocument, ExportError> {
    let mut doc = CadDocument::with_version(version.dxf_version());

    // Eenheid uit de export; lijntypepatronen staan al in tekeneenheden.
    doc.header.insertion_units = drawing.units.insunits();
    doc.header.measurement = if matches!(drawing.units, DrawingUnit::In | DrawingUnit::Ft | DrawingUnit::Yd | DrawingUnit::Mi) { 0 } else { 1 };
    doc.header.linetype_scale = 1.0;
    if let Some((min, max)) = drawing.extents {
        doc.header.model_space_extents_min = Vector3::new(min.x, min.y, 0.0);
        doc.header.model_space_extents_max = Vector3::new(max.x, max.y, 0.0);
    }

    for linetype in &drawing.linetypes {
        let mut entry = LineType::new(&linetype.name);
        entry.description = linetype.description.clone();
        entry.pattern_length = linetype.pattern.iter().sum();
        for (i, &length) in linetype.pattern.iter().enumerate() {
            entry.add_element(if i % 2 == 0 {
                LineTypeElement::dash(length)
            } else {
                LineTypeElement::space(length)
            });
        }
        // Zonder eigen handle overleeft een tabelregel een DWG-opslag niet altijd.
        entry.set_handle(doc.allocate_handle());
        doc.line_types.add(entry).map_err(ExportError::Write)?;
    }

    let has_text = drawing.entities.iter().any(|e| matches!(e.geometry, Geometry::Text { .. }));
    if has_text {
        let mut style = TextStyle::new(TEXT_STYLE_NAME);
        style.font_file = TEXT_STYLE_FONT.to_string();
        style.set_handle(doc.allocate_handle());
        doc.text_styles.add(style).map_err(ExportError::Write)?;
    }

    for layer in &drawing.layers {
        if let Some(existing) = doc.layers.get_mut(&layer.name) {
            // Laag "0" bestaat altijd al.
            existing.color = cad_color(layer.color);
            existing.line_weight = LineWeight::Value(layer.lineweight);
            continue;
        }
        let mut entry = Layer::new(&layer.name);
        entry.color = cad_color(layer.color);
        entry.line_weight = LineWeight::Value(layer.lineweight);
        entry.set_handle(doc.allocate_handle());
        doc.layers.add(entry).map_err(ExportError::Write)?;
    }

    let Drawing { layers, linetypes, entities, .. } = drawing;
    for (i, entity) in entities.into_iter().enumerate() {
        if i % CANCEL_EVERY == 0 && cancelled(cancel) {
            return Err(ExportError::Cancelled);
        }
        let Entity { layer, color, lineweight, linetype, geometry } = entity;
        let mut cad = to_cad_entity(geometry);
        let common = cad.common_mut();
        common.layer = layers[layer as usize].name.clone();
        common.color = color.map(cad_color).unwrap_or(Color::ByLayer);
        common.line_weight = lineweight.map(LineWeight::Value).unwrap_or(LineWeight::ByLayer);
        if let Some(index) = linetype {
            common.linetype = linetypes[index as usize].name.clone();
        }
        doc.add_entity(cad).map_err(|e| ExportError::Write(e.to_string()))?;
    }
    Ok(doc)
}

fn to_cad_entity(geometry: Geometry) -> EntityType {
    match geometry {
        Geometry::Line { start, end } => EntityType::Line(Line::from_points(
            Vector3::new(start.x, start.y, 0.0),
            Vector3::new(end.x, end.y, 0.0),
        )),
        Geometry::Polyline { points, closed } => {
            let mut polyline = LwPolyline::from_points(points.iter().map(|p| Vector2::new(p.x, p.y)).collect());
            polyline.is_closed = closed;
            EntityType::LwPolyline(polyline)
        }
        Geometry::BezierSpline { control_points } => {
            // Een keten van n kubische Béziers is exact een B-spline van graad 3
            // met knopen 0,0,0,0, 1,1,1, …, n,n,n,n.
            let spans = (control_points.len().saturating_sub(1)) / 3;
            let mut knots = Vec::with_capacity(spans * 3 + 5);
            knots.extend([0.0; 4]);
            for i in 1..spans {
                knots.extend([i as f64; 3]);
            }
            knots.extend([spans as f64; 4]);
            let mut spline = Spline::from_control_points(
                3,
                control_points.iter().map(|p| Vector3::new(p.x, p.y, 0.0)).collect(),
            );
            spline.knots = knots;
            spline.flags.planar = true;
            EntityType::Spline(spline)
        }
        Geometry::Hatch { loops } => {
            let mut hatch = Hatch::solid();
            let count = loops.len();
            for (i, points) in loops.into_iter().enumerate() {
                let edge = PolylineEdge::new(points.iter().map(|p| Vector2::new(p.x, p.y)).collect(), true);
                let mut path = BoundaryPath::with_flags(BoundaryPathFlags::from_bits(
                    BoundaryPathFlags::POLYLINE.bits()
                        | if i == 0 || count == 1 { BoundaryPathFlags::EXTERNAL.bits() } else { 0 },
                ));
                path.add_edge(BoundaryEdge::Polyline(edge));
                hatch.add_path(path);
            }
            EntityType::Hatch(hatch)
        }
        Geometry::Text { insert, height, rotation, width_factor, value } => {
            let mut text = Text::with_value(value, Vector3::new(insert.x, insert.y, 0.0))
                .with_height(height)
                .with_rotation(rotation);
            text.width_factor = width_factor;
            text.style = TEXT_STYLE_NAME.to_string();
            EntityType::Text(text)
        }
    }
}

/// Schrijft de tekening naar `path` en geeft de bestandsgrootte terug.
pub fn write_drawing(drawing: Drawing, format: CadFormat, version: CadVersion, path: &Path) -> Result<u64, ExportError> {
    let doc = build_document(drawing, version, None)?;
    write_document(&doc, format, path, None)
}

/// Schrijft het document naar `path` en geeft de bestandsgrootte terug. Eerst
/// naar een deelbestand ernaast, dat pas op zijn plek komt als `cancel` dan
/// nog niet gezet is: een mislukte of afgebroken export laat geen half bestand
/// achter op de plek van een eerder resultaat, en vervangt dat resultaat ook
/// niet.
pub fn write_document(doc: &CadDocument, format: CadFormat, path: &Path, cancel: Option<&AtomicBool>) -> Result<u64, ExportError> {
    if cancelled(cancel) {
        return Err(ExportError::Cancelled);
    }
    let tmp = path.with_extension(format!(
        "{}.deel",
        path.extension().and_then(|e| e.to_str()).unwrap_or("uit")
    ));
    let result = match format {
        CadFormat::Dxf => DxfWriter::new(doc).write_to_file(&tmp),
        CadFormat::DxfBinary => DxfWriter::new_binary(doc).write_to_file(&tmp),
        CadFormat::Dwg => DwgWriter::write_to_file(&tmp, doc),
    };
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(ExportError::Write(e.to_string()));
    }
    commit_part(&tmp, path, cancel)
}

/// Zet het deelbestand op zijn plek, tenzij de gebruiker intussen heeft
/// afgebroken: dan gaat het deelbestand weg en blijft het doel zoals het was.
fn commit_part(tmp: &Path, path: &Path, cancel: Option<&AtomicBool>) -> Result<u64, ExportError> {
    if cancelled(cancel) {
        let _ = std::fs::remove_file(tmp);
        return Err(ExportError::Cancelled);
    }
    std::fs::rename(tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        ExportError::Io(format!("{}: {e}", path.display()))
    })?;
    std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| ExportError::Io(format!("{}: {e}", path.display())))
}

fn cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|c| c.load(Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Point;
    use crate::model::{Entity, Layer};

    fn drawing(lines: usize) -> Drawing {
        let layer = Layer { name: "0".to_string(), color: Rgb::BLACK, lineweight: 25, from_ocg: false };
        let line = |i: usize| Entity {
            layer: 0,
            color: None,
            lineweight: None,
            linetype: None,
            geometry: Geometry::Line { start: Point::new(0.0, i as f64), end: Point::new(10.0, i as f64) },
        };
        Drawing { layers: vec![layer], entities: (0..lines).map(line).collect(), page_size: (100.0, 100.0), ..Drawing::default() }
    }

    #[test]
    fn cancelling_leaves_the_target_untouched_and_no_part_file() {
        let dir = std::env::temp_dir().join(format!("opds-writer-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("tekening.dxf");
        let part = dir.join("tekening.dxf.deel");
        std::fs::write(&target, b"eerder resultaat").unwrap();
        let set = AtomicBool::new(true);
        // Bij het opbouwen.
        assert_eq!(build_document(drawing(3), CadVersion::R2013, Some(&set)).err(), Some(ExportError::Cancelled));
        // Bij het schrijven.
        let document = build_document(drawing(3), CadVersion::R2013, None).unwrap();
        assert_eq!(write_document(&document, CadFormat::Dxf, &target, Some(&set)), Err(ExportError::Cancelled));
        assert_eq!(std::fs::read(&target).unwrap(), b"eerder resultaat");
        assert!(!part.exists());
        // Gezet tussen het schrijven van het deelbestand en het hernoemen: het
        // deelbestand gaat weg, het doel blijft.
        std::fs::write(&part, b"half").unwrap();
        assert_eq!(commit_part(&part, &target, Some(&set)), Err(ExportError::Cancelled));
        assert!(!part.exists());
        assert_eq!(std::fs::read(&target).unwrap(), b"eerder resultaat");
        // Zonder afbreken komt het bestand er gewoon.
        let size = write_document(&document, CadFormat::Dxf, &target, Some(&AtomicBool::new(false))).unwrap();
        assert_eq!(std::fs::metadata(&target).unwrap().len(), size);
        assert!(size > 16, "{size}");
        assert!(!part.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
