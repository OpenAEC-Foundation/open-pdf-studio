//! Grote tekst-DXF's in stukken lezen (#400).
//!
//! De DXF-lezer van de bibliotheek telt per gelezen entiteit alle entiteiten
//! in het document, waardoor het lezen kwadratisch wordt in het aantal
//! entiteiten (gemeten: 15 800 entiteiten 0,7 s, 47 000 6,4 s, 165 000 82 s,
//! 431 000 meer dan een kwartier). Voor de export maakte dat niet uit, voor de
//! import wel.
//!
//! In plaats van de bibliotheek te wijzigen leest de import de ENTITIES-sectie
//! in stukken: elk stuk is een op zichzelf staande DXF met dezelfde HEADER,
//! CLASSES en TABLES (dus dezelfde lagen, lijntypen, tekststijlen en
//! blokrecords) en een ENTITIES-sectie met alleen dat stuk. Daarna gaan de
//! entiteiten in volgorde het eerste document in. De kwadratische kosten
//! blijven zo beperkt tot de lengte van één stuk. De weg naar upstream (één
//! regel: tel niet opnieuw, maar houd het aantal bij) staat in het verslag.

use acadrust::entities::EntityType;
use acadrust::types::Handle;
use acadrust::{CadDocument, DxfReader};
use std::collections::HashMap;
use std::io::Cursor;

/// Standaardlengte van een stuk. Klein genoeg om de kwadratische kosten te
/// smoren, groot genoeg om het herlezen van de tabellen te verantwoorden.
pub const DEFAULT_CHUNK: usize = 4_000;

/// Indeling van een tekst-DXF in stukken.
#[derive(Clone, Debug, PartialEq)]
pub struct ChunkPlan {
    /// Byte-bereiken van HEADER, CLASSES en TABLES.
    pub prefix: Vec<(usize, usize)>,
    /// Begin van elk stuk entiteiten (en het eind van het laatste).
    pub chunk_starts: Vec<usize>,
    /// Begin van de inhoud van de ENTITIES-sectie en het eind ervan.
    pub entities: (usize, usize),
    /// Alles na de ENTITIES-sectie (OBJECTS, ACDSDATA, …) tot en met EOF.
    pub tail: (usize, usize),
    pub entity_count: usize,
}

fn lines(data: &[u8]) -> impl Iterator<Item = (usize, &[u8], usize)> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        if pos >= data.len() {
            return None;
        }
        let start = pos;
        let end = data[pos..].iter().position(|b| *b == b'\n').map(|i| pos + i).unwrap_or(data.len());
        let mut line_end = end;
        if line_end > start && data[line_end - 1] == b'\r' {
            line_end -= 1;
        }
        pos = end + 1;
        Some((start, &data[start..line_end], pos.min(data.len())))
    })
}

/// Leest de indeling van een tekst-DXF. Geeft `None` als het bestand geen
/// leesbare ENTITIES-sectie heeft (binair, beschadigd of leeg).
pub fn plan(data: &[u8]) -> Option<ChunkPlan> {
    let mut iterator = lines(data).peekable();
    let mut prefix = Vec::new();
    let mut entities = None;
    let mut tail_start = None;
    let mut starts: Vec<usize> = Vec::new();
    while let Some((code_start, code_line, _)) = iterator.next() {
        let code: i32 = std::str::from_utf8(code_line).ok()?.trim().parse().unwrap_or(-1);
        let Some((_, value, _)) = iterator.next() else { break };
        if code != 0 {
            continue;
        }
        let value = value.trim_ascii();
        if value != b"SECTION" {
            continue;
        }
        // 2 / <naam>
        let Some((_, name_code, _)) = iterator.next() else { break };
        if std::str::from_utf8(name_code).ok()?.trim() != "2" {
            continue;
        }
        let Some((_, name, name_end)) = iterator.next() else { break };
        let name = String::from_utf8_lossy(name.trim_ascii()).to_string();
        // Doorlopen tot ENDSEC; in ENTITIES ook de entiteiten aftellen.
        let content_start = name_end;
        let mut section_end = name_end;
        while let Some((start, code_line, _)) = iterator.next() {
            let code: i32 = std::str::from_utf8(code_line).map(|s| s.trim().parse().unwrap_or(-1)).unwrap_or(-1);
            let Some((_, value, value_end)) = iterator.next() else { break };
            if code != 0 {
                continue;
            }
            let value = value.trim_ascii();
            if value == b"ENDSEC" {
                section_end = start;
                tail_start = Some(value_end);
                break;
            }
            if name == "ENTITIES" && !matches!(value, b"VERTEX" | b"SEQEND" | b"ATTRIB") {
                starts.push(start);
            }
        }
        match name.as_str() {
            "HEADER" | "CLASSES" | "TABLES" => prefix.push((code_start, tail_start.unwrap_or(section_end))),
            "ENTITIES" => {
                entities = Some((content_start, section_end));
                break;
            }
            _ => {}
        }
    }
    let (content_start, section_end) = entities?;
    let tail = (tail_start.unwrap_or(section_end), data.len());
    let count = starts.len();
    starts.push(section_end);
    Some(ChunkPlan { prefix, chunk_starts: starts, entities: (content_start, section_end), tail, entity_count: count })
}

/// Bouwt de bytes van stuk `index` (0 = het volledige bestand met alleen het
/// eerste stuk entiteiten).
pub fn chunk_bytes(data: &[u8], plan: &ChunkPlan, index: usize, chunk: usize) -> Option<Vec<u8>> {
    let first = index * chunk;
    if first >= plan.entity_count && index > 0 {
        return None;
    }
    let last = ((index + 1) * chunk).min(plan.entity_count);
    let start = plan.chunk_starts.get(first).copied()?;
    let end = plan.chunk_starts.get(last).copied().unwrap_or(plan.entities.1);
    let mut out = Vec::with_capacity(end - start + 4096);
    if index == 0 {
        out.extend_from_slice(&data[..end]);
        out.extend_from_slice(b"  0\nENDSEC\n");
        out.extend_from_slice(&data[plan.tail.0..plan.tail.1]);
        if !out.ends_with(b"EOF\n") && !out.ends_with(b"EOF") {
            out.extend_from_slice(b"  0\nEOF\n");
        }
        return Some(out);
    }
    for (a, b) in &plan.prefix {
        out.extend_from_slice(&data[*a..*b]);
    }
    out.extend_from_slice(b"  0\nSECTION\n  2\nENTITIES\n");
    out.extend_from_slice(&data[start..end]);
    out.extend_from_slice(b"  0\nENDSEC\n  0\nEOF\n");
    Some(out)
}

/// Voegt de entiteiten van een deeldocument bij het eerste document.
pub fn merge(target: &mut CadDocument, source: &CadDocument) -> usize {
    let owner_names: HashMap<u64, String> = source
        .block_records
        .iter()
        .map(|record| (record.handle.value(), record.name.to_uppercase()))
        .collect();
    let target_owners: HashMap<String, Handle> = target
        .block_records
        .iter()
        .map(|record| (record.name.to_uppercase(), record.handle))
        .collect();
    let mut added = 0;
    for entity in source.entities() {
        let mut clone = entity.clone();
        {
            let common = clone.common_mut();
            if let Some(name) = owner_names.get(&common.owner_handle.value()) {
                if let Some(handle) = target_owners.get(name) {
                    common.owner_handle = *handle;
                }
            }
            // Een handle die het eerste document al kent zou de index
            // overschrijven; laat die dan opnieuw uitdelen.
            if !common.handle.is_null() && target.get_entity(common.handle).is_some() {
                common.handle = Handle::NULL;
            }
        }
        if target.add_entity(clone).is_ok() {
            added += 1;
        }
    }
    added
}

/// Leest een tekst-DXF in stukken. `progress` krijgt (gelezen, totaal).
pub fn read_in_chunks(
    data: &[u8],
    chunk: usize,
    mut progress: impl FnMut(usize, usize),
    cancel: &dyn Fn() -> bool,
) -> Result<Option<CadDocument>, String> {
    let chunk = chunk.max(1);
    let Some(plan) = plan(data) else { return Ok(None) };
    if plan.entity_count <= chunk {
        return Ok(None);
    }
    let chunks = plan.entity_count.div_ceil(chunk);
    let mut document: Option<CadDocument> = None;
    for index in 0..chunks {
        if cancel() {
            return Err("afgebroken".into());
        }
        let Some(bytes) = chunk_bytes(data, &plan, index, chunk) else { break };
        let reader = DxfReader::from_reader(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let part = reader.read().map_err(|e| e.to_string())?;
        match &mut document {
            None => document = Some(part),
            Some(target) => {
                merge(target, &part);
            }
        }
        progress(((index + 1) * chunk).min(plan.entity_count), plan.entity_count);
    }
    Ok(document)
}

/// Alle entiteiten van een document per type geteld — voor de vergelijking
/// tussen stuk-voor-stuk en in één keer lezen.
pub fn type_counts(document: &CadDocument) -> std::collections::BTreeMap<String, usize> {
    let mut counts = std::collections::BTreeMap::new();
    for entity in document.entities() {
        *counts.entry(entity_name(entity).to_string()).or_default() += 1;
    }
    counts
}

fn entity_name(entity: &EntityType) -> &'static str {
    entity.as_entity().entity_type()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(entities: usize) -> Vec<u8> {
        let mut out = String::new();
        out.push_str("  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1015\n  9\n$INSUNITS\n 70\n     4\n  0\nENDSEC\n");
        out.push_str("  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n 70\n     1\n  0\nLAYER\n  5\n10\n  2\nWANDEN\n 70\n     0\n 62\n     1\n  6\nContinuous\n  0\nENDTAB\n  0\nENDSEC\n");
        out.push_str("  0\nSECTION\n  2\nENTITIES\n");
        for i in 0..entities {
            out.push_str(&format!(
                "  0\nLINE\n  5\n{:X}\n  8\nWANDEN\n 10\n{}\n 20\n0.0\n 11\n{}\n 21\n10.0\n",
                0x100 + i,
                i as f64,
                i as f64 + 1.0
            ));
        }
        out.push_str("  0\nENDSEC\n  0\nSECTION\n  2\nOBJECTS\n  0\nDICTIONARY\n  5\n C\n  0\nENDSEC\n  0\nEOF\n");
        out.into_bytes()
    }

    #[test]
    fn the_plan_finds_the_sections_and_every_entity() {
        let data = sample(5);
        let plan = plan(&data).unwrap();
        assert_eq!(plan.entity_count, 5);
        assert_eq!(plan.prefix.len(), 2);
        assert_eq!(plan.chunk_starts.len(), 6);
        // Het staartstuk begint bij de OBJECTS-sectie.
        let tail = String::from_utf8_lossy(&data[plan.tail.0..plan.tail.1]).to_string();
        assert!(tail.contains("OBJECTS"), "{tail}");
        assert!(tail.trim_end().ends_with("EOF"));
    }

    #[test]
    fn reading_in_chunks_gives_the_same_document_as_reading_at_once() {
        let data = sample(25);
        let direct = DxfReader::from_reader(Cursor::new(data.clone())).unwrap().read().unwrap();
        let chunked = read_in_chunks(&data, 4, |_, _| {}, &|| false).unwrap().unwrap();
        assert_eq!(type_counts(&direct), type_counts(&chunked));
        assert_eq!(chunked.entities().count(), 25);
        assert_eq!(chunked.model_space_entities().count(), direct.model_space_entities().count());
        // Lagen en kop komen uit hetzelfde voorstuk.
        assert!(chunked.layers.get("WANDEN").is_some());
        assert_eq!(chunked.header.insertion_units, 4);
        // Handles blijven uniek en in volgorde.
        let handles: Vec<u64> = chunked.model_space_entities().map(|e| e.common().handle.value()).collect();
        let mut sorted = handles.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), handles.len());
        let xs: Vec<f64> = chunked
            .model_space_entities()
            .filter_map(|e| match e {
                EntityType::Line(l) => Some(l.start.x),
                _ => None,
            })
            .collect();
        assert_eq!(xs, (0..25).map(|i| i as f64).collect::<Vec<_>>());
    }

    #[test]
    fn small_files_are_left_to_the_normal_reader() {
        let data = sample(3);
        assert!(read_in_chunks(&data, 4_000, |_, _| {}, &|| false).unwrap().is_none());
        assert!(plan(b"not a dxf").is_none());
    }
}
