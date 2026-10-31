//! Render-only bounding boxes for tiny mesh shadings (#395).
//!
//! Some PDFs fill large paths (often the whole page) with a shading pattern
//! whose mesh (ShadingType 4 to 7) covers only a speck. PDFium sizes the
//! offscreen buffer of a shading-pattern fill to the clipped bounding box of
//! the filled path and only narrows it with the shading's `/BBox`, never with
//! the extent of the mesh itself. A page with hundreds of such fills then
//! costs hundreds of page-sized buffers per render, 30 to 90 times slower
//! than necessary, while the visible result is a few pixels.
//!
//! The mitigation gives such a shading the `/BBox` it lacks: the bounding box
//! of its decoded mesh points, widened by a generous margin. ISO 32000-1
//! (8.7.4.5.1, Table 78) defines `/BBox` as "a temporary clipping boundary
//! when the shading is painted", in the shading's target coordinate space.
//! Without `/Background` a mesh shading paints nothing outside its triangles
//! or patches, and those lie inside the box, so the box changes no pixel; it
//! only lets PDFium allocate, rasterise and composite a small buffer.
//!
//! Patching the shading dictionary rather than the page content keeps the
//! change local and independent of content-stream syntax (inline images,
//! form XObjects, graphics-state tracking): the content streams are never
//! parsed or rewritten.
//!
//! The change lives only in the bytes handed to PDFium for rendering: an
//! incremental update appended to an in-memory copy that redefines just the
//! patched shading objects. Nothing is written to disk and saving never sees
//! it.
//!
//! Safeguards: only shadings without `/BBox` and `/Background`, referenced
//! only from type 2 patterns with an invertible matrix, with a mesh layout
//! that is read unambiguously (byte-aligned vertices or patches, known colour
//! space, unfiltered or plain Flate data), whose box is at least
//! `MIN_AREA_RATIO` times smaller than the smallest page. Anything else is
//! left alone. Unencrypted documents only.
//!
//! Shared by the pdfium-worker sidecar and the in-process renderer of the app
//! (`open-pdf-studio/src-tauri/src/pdfium_renderer.rs` includes this file).

use lopdf::xref::XrefEntry;
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::collections::{HashMap, HashSet};
use std::io::Read;

/// A shading is only bounded when its box (margin included) covers at most
/// 1/MIN_AREA_RATIO of the smallest page. Large meshes gain little and are
/// left exactly as they are.
const MIN_AREA_RATIO: f64 = 64.0;
/// Margin around the mesh in page points, at least this many...
const MARGIN_MIN_PT: f64 = 16.0;
/// ...or this fraction of the largest page dimension, so that even
/// thumbnail scales keep a margin of more than one device pixel around the
/// mesh (PDFium's rasteriser rounds vertex positions to whole pixels).
const MARGIN_PAGE_FRACTION: f64 = 0.02;
/// Decoded mesh data above this size is not inspected.
const MAX_MESH_BYTES: u64 = 64 << 20;

/// Returns the bytes PDFium should render: `bytes` itself, or a copy with
/// an appended incremental update when tiny mesh shadings were bounded.
pub fn prepare_for_render(bytes: Vec<u8>) -> Vec<u8> {
    match bound_tiny_mesh_shadings(&bytes) {
        Some(patched) => patched,
        None => bytes,
    }
}

/// The patched copy of `bytes`, or `None` when nothing qualifies (the
/// common case, decided by a byte scan without parsing the document).
pub fn bound_tiny_mesh_shadings(bytes: &[u8]) -> Option<Vec<u8>> {
    if !may_contain_mesh_shading(bytes) {
        return None;
    }
    let started = std::time::Instant::now();
    let doc = Document::load_mem(bytes).ok()?;
    if doc.trailer.has(b"Encrypt") {
        return None;
    }
    let pages = page_extent(&doc)?;
    let margin_pt = MARGIN_MIN_PT.max(MARGIN_PAGE_FRACTION * pages.max_dimension);
    let uses = shading_uses(&doc);

    let mut boxes: Vec<(ObjectId, [f64; 4])> = Vec::new();
    for (id, matrices) in &uses.patterns {
        if uses.other.contains(id) {
            continue;
        }
        let Some(matrices) = matrices.iter().copied().collect::<Option<Vec<_>>>() else { continue };
        let Ok(stream) = doc.get_object(*id).and_then(Object::as_stream) else { continue };
        let Some(mesh) = mesh_bounds(&doc, &stream.dict, &stream.content) else { continue };
        if let Some(bbox) = render_bbox(mesh, &matrices, margin_pt, pages.min_area) {
            boxes.push((*id, bbox));
        }
    }
    if boxes.is_empty() {
        return None;
    }
    boxes.sort_by_key(|(id, _)| *id);
    let patched = write_update(bytes, &doc, &boxes)?;
    eprintln!(
        "[mesh-bbox] bounded {} tiny mesh shading(s) in {} ms (#395)",
        boxes.len(),
        started.elapsed().as_millis()
    );
    Some(patched)
}

/// Mesh shadings are streams, and streams are never stored inside object
/// streams, so their `/ShadingType 4..7` entry is always plain text in the
/// file. Documents without one skip all parsing.
fn may_contain_mesh_shading(bytes: &[u8]) -> bool {
    memchr::memmem::find_iter(bytes, b"/ShadingType").any(|at| {
        let mut i = at + b"/ShadingType".len();
        while i < bytes.len() && is_white(bytes[i]) {
            i += 1;
        }
        matches!(bytes.get(i), Some(b'4'..=b'7'))
            && !matches!(bytes.get(i + 1), Some(b'0'..=b'9' | b'.'))
    })
}

fn is_white(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n' | b'\x0c' | b'\0')
}

struct PageExtent {
    min_area: f64,
    max_dimension: f64,
}

fn page_extent(doc: &Document) -> Option<PageExtent> {
    let mut min_area = f64::INFINITY;
    let mut max_dimension: f64 = 0.0;
    for page_id in doc.page_iter() {
        let [x0, y0, x1, y1] = inherited_media_box(doc, page_id).unwrap_or([0.0, 0.0, 612.0, 792.0]);
        let (w, h) = ((x1 - x0).abs(), (y1 - y0).abs());
        min_area = min_area.min(w * h);
        max_dimension = max_dimension.max(w).max(h);
    }
    (min_area.is_finite() && min_area > 0.0).then_some(PageExtent { min_area, max_dimension })
}

fn inherited_media_box(doc: &Document, page_id: ObjectId) -> Option<[f64; 4]> {
    let mut node = doc.get_dictionary(page_id).ok()?;
    for _ in 0..64 {
        if let Ok(value) = node.get(b"MediaBox") {
            return numbers::<4>(doc, value);
        }
        node = doc.get_dictionary(node.get(b"Parent").ok()?.as_reference().ok()?).ok()?;
    }
    None
}

fn number(doc: &Document, value: &Object) -> Option<f64> {
    let (_, value) = doc.dereference(value).ok()?;
    let n = match value {
        Object::Integer(i) => *i as f64,
        Object::Real(r) => *r as f64,
        _ => return None,
    };
    n.is_finite().then_some(n)
}

fn numbers<const N: usize>(doc: &Document, value: &Object) -> Option<[f64; N]> {
    let (_, value) = doc.dereference(value).ok()?;
    let array = value.as_array().ok()?;
    if array.len() < N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(array) {
        *slot = number(doc, item)?;
    }
    Some(out)
}

/// How each indirect object is referenced: as the `/Shading` of a type 2
/// pattern (with that pattern's matrix, `None` when it is unreadable), or in
/// any other way.
#[derive(Default)]
struct ShadingUses {
    patterns: HashMap<ObjectId, Vec<Option<[f64; 6]>>>,
    other: HashSet<ObjectId>,
}

fn shading_uses(doc: &Document) -> ShadingUses {
    let mut uses = ShadingUses::default();
    for object in doc.objects.values() {
        walk(doc, object, &mut uses);
    }
    walk_dict(doc, &doc.trailer, &mut uses);
    uses
}

fn walk(doc: &Document, object: &Object, uses: &mut ShadingUses) {
    match object {
        Object::Reference(id) => {
            uses.other.insert(*id);
        }
        Object::Array(items) => items.iter().for_each(|item| walk(doc, item, uses)),
        Object::Dictionary(dict) => walk_dict(doc, dict, uses),
        Object::Stream(stream) => walk_dict(doc, &stream.dict, uses),
        _ => {}
    }
}

fn walk_dict(doc: &Document, dict: &Dictionary, uses: &mut ShadingUses) {
    let is_shading_pattern = matches!(dict.get(b"PatternType"), Ok(Object::Integer(2)));
    let shading = if is_shading_pattern {
        dict.get(b"Shading").and_then(Object::as_reference).ok()
    } else {
        None
    };
    if let Some(id) = shading {
        let matrix = match dict.get(b"Matrix") {
            Err(_) => Some([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]),
            Ok(value) => numbers::<6>(doc, value),
        };
        uses.patterns.entry(id).or_default().push(matrix);
    }
    for (key, value) in dict.iter() {
        if shading.is_some() && key.as_slice() == b"Shading" {
            continue;
        }
        walk(doc, value, uses);
    }
}

/// Bounding box `[x0, y0, x1, y1]` in shading space of everything a mesh
/// shading can paint, or `None` when the shading does not qualify or its
/// data cannot be read with certainty.
fn mesh_bounds(doc: &Document, dict: &Dictionary, raw: &[u8]) -> Option<[f64; 4]> {
    let int = |key: &[u8]| dict.get(key).ok().and_then(|v| number(doc, v));
    let kind = int(b"ShadingType")? as i64;
    if !(4..=7).contains(&kind) || dict.has(b"BBox") || dict.has(b"Background") {
        return None;
    }
    let bits_coord = int(b"BitsPerCoordinate")? as u32;
    let bits_comp = int(b"BitsPerComponent")? as u32;
    if ![1, 2, 4, 8, 12, 16, 24, 32].contains(&bits_coord) || ![1, 2, 4, 8, 12, 16].contains(&bits_comp) {
        return None;
    }
    let bits_flag = if kind == 5 {
        0
    } else {
        let f = int(b"BitsPerFlag")? as u32;
        if ![2, 4, 8].contains(&f) {
            return None;
        }
        f
    };
    let has_function = matches!(dict.get(b"Function"), Ok(value) if !matches!(value, Object::Null));
    let components = if has_function { 1 } else { colour_components(doc, dict.get(b"ColorSpace").ok()?)? };
    let decode = numbers::<4>(doc, dict.get(b"Decode").ok()?)?;

    // Unaligned layouts are read differently by different renderers; only
    // whole-byte vertices and patches are inspected.
    let colour_bits = components * bits_comp;
    let vertex_bits = bits_flag + 2 * bits_coord + colour_bits;
    let (full_patch, short_patch) = match kind {
        6 => (bits_flag + 24 * bits_coord + 4 * colour_bits, bits_flag + 16 * bits_coord + 2 * colour_bits),
        7 => (bits_flag + 32 * bits_coord + 4 * colour_bits, bits_flag + 24 * bits_coord + 2 * colour_bits),
        _ => (8, 8),
    };
    if vertex_bits % 8 != 0 || full_patch % 8 != 0 || short_patch % 8 != 0 {
        return None;
    }
    if kind == 5 && int(b"VerticesPerRow")? < 2.0 {
        return None;
    }

    let data = decoded_data(doc, dict, raw)?;
    let mut bits = BitReader { data: &data, pos: 0 };
    let mut raw_box = RawBox::default();
    let mut points = 0usize;
    match kind {
        4 | 5 => {
            while bits.remaining() >= vertex_bits as usize {
                bits.skip(bits_flag);
                raw_box.add(bits.read(bits_coord)?, bits.read(bits_coord)?);
                bits.skip(colour_bits);
                points += 1;
            }
        }
        _ => {
            let per_full = if kind == 6 { 12 } else { 16 };
            while bits.remaining() >= bits_flag as usize {
                let start = bits.pos;
                let flag = bits.read(bits_flag)?;
                let (count, colours, size) =
                    if flag == 0 { (per_full, 4, full_patch) } else { (per_full - 4, 2, short_patch) };
                if bits.data.len() * 8 - start < size as usize {
                    break;
                }
                for _ in 0..count {
                    raw_box.add(bits.read(bits_coord)?, bits.read(bits_coord)?);
                }
                bits.skip(colours * colour_bits);
                points += count;
            }
        }
    }
    if points < 3 {
        return None;
    }

    let max = ((1u64 << bits_coord) - 1) as f64;
    let map = |raw: u64, d0: f64, d1: f64| d0 + raw as f64 * (d1 - d0) / max;
    let (xa, xb) = (map(raw_box.x0, decode[0], decode[1]), map(raw_box.x1, decode[0], decode[1]));
    let (ya, yb) = (map(raw_box.y0, decode[2], decode[3]), map(raw_box.y1, decode[2], decode[3]));
    let mut bbox = [xa.min(xb), ya.min(yb), xa.max(xb), ya.max(yb)];
    if kind >= 6 {
        // A Coons patch can bulge outside its boundary control points; its
        // implicit interior points (8.7.4.5.7) are affine combinations with
        // positive weights summing to 2 and negative ones to -1, so they lie
        // within the boundary box widened by its own size on every side.
        // Applied to tensor patches too, in case a renderer draws them from
        // the boundary alone.
        let (w, h) = (bbox[2] - bbox[0], bbox[3] - bbox[1]);
        bbox = [bbox[0] - w, bbox[1] - h, bbox[2] + w, bbox[3] + h];
    }
    bbox.iter().all(|v| v.is_finite()).then_some(bbox)
}

fn colour_components(doc: &Document, value: &Object) -> Option<u32> {
    let (_, value) = doc.dereference(value).ok()?;
    let by_name = |name: &[u8]| match name {
        b"DeviceGray" | b"G" | b"CalGray" | b"Indexed" | b"I" | b"Separation" => Some(1),
        b"DeviceRGB" | b"RGB" | b"CalRGB" | b"Lab" => Some(3),
        b"DeviceCMYK" | b"CMYK" => Some(4),
        _ => None,
    };
    match value {
        Object::Name(name) => by_name(name),
        Object::Array(items) => {
            let family = items.first()?.as_name().ok()?;
            match family {
                b"ICCBased" => {
                    let (_, profile) = doc.dereference(items.get(1)?).ok()?;
                    let n = number(doc, profile.as_stream().ok()?.dict.get(b"N").ok()?)?;
                    matches!(n as u32, 1 | 3 | 4).then_some(n as u32)
                }
                b"DeviceN" => {
                    let (_, names) = doc.dereference(items.get(1)?).ok()?;
                    let n = names.as_array().ok()?.len() as u32;
                    (1..=32).contains(&n).then_some(n)
                }
                _ => by_name(family),
            }
        }
        _ => None,
    }
}

/// The mesh data, for unfiltered streams and plain Flate only. A Flate error
/// rejects the shading rather than risk a box built from partial data.
fn decoded_data(doc: &Document, dict: &Dictionary, raw: &[u8]) -> Option<Vec<u8>> {
    let filter = match dict.get(b"Filter") {
        Err(_) => return Some(raw.to_vec()),
        Ok(value) => doc.dereference(value).ok()?.1,
    };
    let is_flate = |name: &[u8]| name == b"FlateDecode" || name == b"Fl";
    let flate = match filter {
        Object::Name(name) => is_flate(name),
        Object::Array(items) => items.len() == 1 && items[0].as_name().map(is_flate).unwrap_or(false),
        _ => false,
    };
    if !flate {
        return None;
    }
    if let Ok(params) = dict.get(b"DecodeParms") {
        let (_, params) = doc.dereference(params).ok()?;
        let params = match params {
            Object::Dictionary(d) => Some(d),
            Object::Array(items) if items.len() == 1 => doc.dereference(&items[0]).ok()?.1.as_dict().ok(),
            Object::Null => None,
            _ => return None,
        };
        if let Some(params) = params {
            if params.get(b"Predictor").ok().and_then(|p| number(doc, p)).unwrap_or(1.0) != 1.0 {
                return None;
            }
        }
    }
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(raw).take(MAX_MESH_BYTES + 1).read_to_end(&mut out).ok()?;
    (out.len() as u64 <= MAX_MESH_BYTES).then_some(out)
}

#[derive(Default)]
struct RawBox {
    x0: u64,
    y0: u64,
    x1: u64,
    y1: u64,
    any: bool,
}

impl RawBox {
    fn add(&mut self, x: u64, y: u64) {
        if !self.any {
            *self = RawBox { x0: x, y0: y, x1: x, y1: y, any: true };
        } else {
            self.x0 = self.x0.min(x);
            self.y0 = self.y0.min(y);
            self.x1 = self.x1.max(x);
            self.y1 = self.y1.max(y);
        }
    }
}

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl BitReader<'_> {
    fn remaining(&self) -> usize {
        self.data.len() * 8 - self.pos
    }

    fn skip(&mut self, n: u32) {
        self.pos += n as usize;
    }

    /// Reads `n` bits (at most 32), most significant first.
    fn read(&mut self, n: u32) -> Option<u64> {
        if self.remaining() < n as usize {
            return None;
        }
        let mut value = 0u64;
        for _ in 0..n {
            let byte = self.data[self.pos / 8];
            value = (value << 1) | u64::from((byte >> (7 - self.pos % 8)) & 1);
            self.pos += 1;
        }
        Some(value)
    }
}

/// The `/BBox` to give a shading with mesh bounds `mesh`, used by patterns
/// with `matrices`: the mesh box widened by `margin_pt` page points in every
/// direction under every matrix. `None` when a matrix is (nearly) singular
/// or the box is not small enough relative to the page to be worth it.
fn render_bbox(mesh: [f64; 4], matrices: &[[f64; 6]], margin_pt: f64, min_page_area: f64) -> Option<[f64; 4]> {
    if matrices.is_empty() {
        return None;
    }
    let mut margin = 0.0f64;
    for m in matrices {
        let shrink = smallest_singular_value(m);
        if !(shrink > 1e-9) {
            return None;
        }
        margin = margin.max(margin_pt / shrink);
    }
    let bbox = [mesh[0] - margin, mesh[1] - margin, mesh[2] + margin, mesh[3] + margin];
    for m in matrices {
        let corners = [(bbox[0], bbox[1]), (bbox[2], bbox[1]), (bbox[0], bbox[3]), (bbox[2], bbox[3])]
            .map(|(x, y)| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
        let xs = corners.map(|c| c.0);
        let ys = corners.map(|c| c.1);
        let span = |v: [f64; 4]| v.iter().cloned().fold(f64::MIN, f64::max) - v.iter().cloned().fold(f64::MAX, f64::min);
        let area = span(xs) * span(ys);
        if !area.is_finite() || area * MIN_AREA_RATIO > min_page_area {
            return None;
        }
    }
    bbox.iter().all(|v| v.is_finite()).then_some(bbox)
}

/// Smallest factor by which the linear part of `m` scales any direction.
fn smallest_singular_value(m: &[f64; 6]) -> f64 {
    let (a, b, c, d) = (m[0], m[1], m[2], m[3]);
    let s = a * a + b * b + c * c + d * d;
    let det = a * d - b * c;
    let disc = (s * s - 4.0 * det * det).max(0.0).sqrt();
    ((s - disc) / 2.0).max(0.0).sqrt()
}

/// Appends an incremental update that redefines each shading in `boxes`
/// with a `/BBox` entry; its stream data stays byte-for-byte the same.
/// Shadings whose original object cannot be located exactly are skipped.
fn write_update(bytes: &[u8], doc: &Document, boxes: &[(ObjectId, [f64; 4])]) -> Option<Vec<u8>> {
    let root = doc.trailer.get(b"Root").ok()?.as_reference().ok()?;
    let mut out = Vec::with_capacity(bytes.len() + boxes.len() * 256);
    out.extend_from_slice(bytes);
    out.push(b'\n');
    let mut written: Vec<(ObjectId, usize)> = Vec::new();
    for (id, bbox) in boxes {
        let Some((head, tail)) = locate_stream_object(bytes, doc, *id) else { continue };
        written.push((*id, out.len()));
        out.extend_from_slice(&bytes[head.clone()]);
        out.extend_from_slice(format!(" /BBox [{} {} {} {}] ", bbox[0], bbox[1], bbox[2], bbox[3]).as_bytes());
        out.extend_from_slice(&bytes[tail]);
        out.extend_from_slice(b"\nendstream\nendobj\n");
    }
    if written.is_empty() {
        return None;
    }
    let xref_at = out.len();
    out.extend_from_slice(b"xref\n");
    for ((num, generation), offset) in &written {
        out.extend_from_slice(format!("{} 1\n{:010} {:05} n\r\n", num, offset, generation).as_bytes());
    }
    let size = doc
        .trailer
        .get(b"Size")
        .ok()
        .and_then(|s| s.as_i64().ok())
        .unwrap_or(0)
        .max(i64::from(written.iter().map(|((n, _), _)| *n).max().unwrap_or(0)) + 1);
    let mut trailer = format!("trailer\n<< /Size {} /Root {} {} R", size, root.0, root.1);
    if let Ok(Object::Reference(info)) = doc.trailer.get(b"Info") {
        trailer.push_str(&format!(" /Info {} {} R", info.0, info.1));
    }
    if let Ok(Object::Array(ids)) = doc.trailer.get(b"ID") {
        let hex: Option<Vec<String>> = ids
            .iter()
            .map(|id| match id {
                Object::String(s, _) => Some(s.iter().map(|b| format!("{:02X}", b)).collect()),
                _ => None,
            })
            .collect();
        if let Some(hex) = hex.filter(|h| h.len() == 2) {
            trailer.push_str(&format!(" /ID [<{}> <{}>]", hex[0], hex[1]));
        }
    }
    trailer.push_str(&format!(" /Prev {} >>\nstartxref\n{}\n%%EOF\n", doc.xref_start, xref_at));
    out.extend_from_slice(trailer.as_bytes());
    Some(out)
}

/// Byte ranges of a stream object in the original file: `head` runs from
/// `N G obj` up to and including the `<<` that opens its dictionary, `tail`
/// from after that `<<` to the end of the stream data. The layout must match
/// the cross-reference table and the parsed stream exactly.
fn locate_stream_object(
    bytes: &[u8],
    doc: &Document,
    id: ObjectId,
) -> Option<(std::ops::Range<usize>, std::ops::Range<usize>)> {
    let XrefEntry::Normal { offset, generation } = doc.reference_table.get(id.0)? else { return None };
    if *generation != id.1 {
        return None;
    }
    let stream = doc.get_object(id).ok()?.as_stream().ok()?;
    let skip_white = |mut at: usize| {
        while at < bytes.len() && is_white(bytes[at]) {
            at += 1;
        }
        at
    };
    let expect = |at: usize, token: &[u8]| -> Option<usize> {
        bytes.get(at..)?.starts_with(token).then_some(at + token.len())
    };

    // `N G obj <<`
    let obj_start = skip_white(*offset as usize);
    let mut at = expect(obj_start, id.0.to_string().as_bytes())?;
    at = expect(skip_white(at), id.1.to_string().as_bytes())?;
    at = expect(skip_white(at), b"obj")?;
    let dict_open = skip_white(at);
    expect(dict_open, b"<<")?;

    // `>> stream EOL data [EOL] endstream`, as the parser read it.
    let dict_close = dictionary_end(bytes, dict_open)?;
    at = expect(skip_white(dict_close), b"stream")?;
    let data_start = expect(at, b"\r\n").or_else(|| expect(at, b"\n")).or_else(|| expect(at, b"\r"))?;
    let data_end = data_start.checked_add(stream.content.len())?;
    if bytes.get(data_start..data_end)? != stream.content.as_slice() {
        return None;
    }
    let after = expect(data_end, b"\r\n").or_else(|| expect(data_end, b"\n")).or_else(|| expect(data_end, b"\r"));
    expect(after.unwrap_or(data_end), b"endstream")?;
    Some((obj_start..dict_open + 2, dict_open + 2..data_end))
}

/// Offset just past the `>>` that closes the dictionary opened at `open`,
/// skipping nested dictionaries, strings and comments.
fn dictionary_end(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'<' if bytes.get(i + 1) == Some(&b'<') => {
                depth += 1;
                i += 2;
            }
            b'>' if bytes.get(i + 1) == Some(&b'>') => {
                depth = depth.checked_sub(1)?;
                i += 2;
                if depth == 0 {
                    return Some(i);
                }
            }
            b'<' => {
                // Hex string.
                i += 1 + bytes[i + 1..].iter().position(|&b| b == b'>')? + 1;
            }
            b'(' => {
                let mut nesting = 0usize;
                loop {
                    match *bytes.get(i)? {
                        b'\\' => i += 1,
                        b'(' => nesting += 1,
                        b')' => {
                            nesting -= 1;
                            if nesting == 0 {
                                break;
                            }
                        }
                        _ => {}
                    }
                    i += 1;
                }
                i += 1;
            }
            b'%' => {
                while i < bytes.len() && bytes[i] != b'\r' && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Builds a classic-xref PDF whose object `n` is `bodies[n - 1]`;
    /// object 1 is the catalog.
    fn build_pdf(bodies: &[Vec<u8>]) -> Vec<u8> {
        let mut out = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = Vec::new();
        for (i, body) in bodies.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", bodies.len() + 1).as_bytes());
        for offset in offsets {
            out.extend_from_slice(format!("{:010} 00000 n\r\n", offset).as_bytes());
        }
        out.extend_from_slice(
            format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", bodies.len() + 1, xref).as_bytes(),
        );
        out
    }

    fn stream(dict: &str, data: &[u8]) -> Vec<u8> {
        let mut body = format!("<< {} /Length {} >>\nstream\n", dict, data.len()).into_bytes();
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream");
        body
    }

    fn flate(data: &[u8]) -> Vec<u8> {
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    /// Free-form (type 4) mesh data: 8-bit flags, 24-bit coordinates over
    /// Decode [-32768 32768], RGB 8-bit colours, as in the file of #395.
    fn type4_data(points: &[(f64, f64)]) -> Vec<u8> {
        let raw = |p: f64| (((p + 32768.0) / 65536.0) * 16_777_215.0).round() as u32;
        let mut data = Vec::new();
        for (k, (x, y)) in points.iter().enumerate() {
            data.push(if k < 3 { 0 } else { 1 });
            for v in [raw(*x), raw(*y)] {
                data.extend_from_slice(&v.to_be_bytes()[1..]);
            }
            data.extend_from_slice(&[200, 40, 40]);
        }
        data
    }

    const TYPE4_DICT: &str = "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 24 \
        /BitsPerComponent 8 /BitsPerFlag 8 /Decode [-32768 32768 -32768 32768 0 1 0 1 0 1]";

    /// The speck of #395: pattern space (45..46.58, 33.33..33.91), shown
    /// at page point (4, 5.4) through Matrix [0 .12 .12 0 0 0].
    fn speck() -> Vec<(f64, f64)> {
        vec![(45.0, 33.33), (46.58, 33.33), (45.0, 33.91), (46.58, 33.91)]
    }

    /// One A0 page with /Rotate 90 that fills the whole page once per entry
    /// of `shadings` (shading stream bodies) through a type 2 pattern, plus
    /// optional extra resources and content.
    fn page_with_fills(shadings: &[Vec<u8>], extra_resources: &str, extra_content: &str, extra_objects: &[Vec<u8>]) -> Vec<u8> {
        // 1 catalog, 2 pages, 3 page, 4 content, then per fill: pattern, shading.
        let first = 5;
        let mut patterns = String::new();
        let mut content = String::from("q 0.12 0 0 0.12 0 0 cm\n");
        let mut objects: Vec<Vec<u8>> = Vec::new();
        for (i, shading) in shadings.iter().enumerate() {
            let pattern_id = first + 2 * i;
            patterns.push_str(&format!(" /R{} {} 0 R", 100 + i, pattern_id));
            content.push_str(&format!("/R11 cs /R{} scn 0 0 19867 28083 re f\n", 100 + i));
            objects.push(format!("<< /PatternType 2 /Shading {} 0 R /Matrix [0 .12 .12 0 0 0] >>", pattern_id + 1).into_bytes());
            objects.push(shading.clone());
        }
        content.push_str("Q\n");
        content.push_str(extra_content);
        let mut bodies = vec![
            b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2384 3370] /Rotate 90 /Contents 4 0 R \
                 /Resources << /ColorSpace << /R11 [/Pattern] >> /Pattern <<{} >> {} >> >>",
                patterns, extra_resources
            )
            .into_bytes(),
            stream("", content.as_bytes()),
        ];
        bodies.extend(objects);
        bodies.extend_from_slice(extra_objects);
        build_pdf(&bodies)
    }

    fn type4_shading(points: &[(f64, f64)], extra: &str) -> Vec<u8> {
        let data = flate(&type4_data(points));
        stream(&format!("{} {} /Filter /FlateDecode", TYPE4_DICT, extra), &data)
    }

    fn bbox_of(doc: &Document, id: ObjectId) -> Option<[f64; 4]> {
        let dict = &doc.get_object(id).ok()?.as_stream().ok()?.dict;
        numbers::<4>(doc, dict.get(b"BBox").ok()?)
    }

    #[test]
    fn gate_only_matches_mesh_shading_types() {
        assert!(may_contain_mesh_shading(b"<< /ShadingType 4 >>"));
        assert!(may_contain_mesh_shading(b"<</ShadingType\n7/X 1>>"));
        assert!(!may_contain_mesh_shading(b"<< /ShadingType 2 /Coords [0 0 1 1] >>"));
        assert!(!may_contain_mesh_shading(b"<< /ShadingType 45 >>"));
        assert!(!may_contain_mesh_shading(b"no shadings here"));
    }

    #[test]
    fn documents_without_mesh_shadings_are_not_touched() {
        let axial = b"<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] \
            /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>"
            .to_vec();
        let pdf = page_with_fills(&[axial], "", "", &[]);
        assert!(bound_tiny_mesh_shadings(&pdf).is_none());
    }

    #[test]
    fn a_degenerate_free_form_mesh_gets_a_bbox_around_its_points() {
        let original = page_with_fills(&[type4_shading(&speck(), "")], "", "", &[]);
        let patched = bound_tiny_mesh_shadings(&original).expect("the speck qualifies");
        // The original file is untouched; the update only appends.
        assert!(patched.starts_with(&original));

        let doc = Document::load_mem(&patched).expect("patched file parses");
        let bbox = bbox_of(&doc, (6, 0)).expect("BBox added");
        // Contains every mesh point...
        assert!(bbox[0] < 45.0 && bbox[1] < 33.33 && bbox[2] > 46.58 && bbox[3] > 33.91);
        // ...with a margin of at least 2% of the 3370 pt page (67.4 pt), which
        // is 67.4 / 0.12 = 561.7 in pattern space...
        assert!(45.0 - bbox[0] >= 561.0 && bbox[2] - 46.58 >= 561.0, "{:?}", bbox);
        // ...yet still a speck compared to the whole-page fill.
        assert!(bbox[2] - bbox[0] < 1200.0 && bbox[3] - bbox[1] < 1200.0, "{:?}", bbox);

        // The stream data and the rest of the dictionary are unchanged.
        let before = Document::load_mem(&original).unwrap();
        let old = before.get_object((6, 0)).unwrap().as_stream().unwrap();
        let new = doc.get_object((6, 0)).unwrap().as_stream().unwrap();
        assert_eq!(old.content, new.content);
        for (key, value) in old.dict.iter() {
            assert_eq!(format!("{:?}", new.dict.get(key).unwrap()), format!("{:?}", value));
        }
        // Everything else resolves to the original objects.
        for id in [(1, 0), (2, 0), (3, 0), (4, 0), (5, 0)] {
            assert_eq!(format!("{:?}", before.get_object(id).unwrap()), format!("{:?}", doc.get_object(id).unwrap()));
        }
        assert_eq!(doc.get_pages().len(), 1);
    }

    #[test]
    fn many_degenerate_fills_are_all_bounded() {
        let shadings: Vec<_> = (0..50)
            .map(|i| {
                let d = i as f64 * 0.9;
                let points: Vec<_> = speck().into_iter().map(|(x, y)| (x + d, y)).collect();
                type4_shading(&points, "")
            })
            .collect();
        let patched = bound_tiny_mesh_shadings(&page_with_fills(&shadings, "", "", &[])).unwrap();
        let doc = Document::load_mem(&patched).unwrap();
        for i in 0..50u32 {
            assert!(bbox_of(&doc, (6 + 2 * i, 0)).is_some(), "shading {}", i);
        }
    }

    #[test]
    fn normal_shadings_are_left_alone() {
        // A mesh spanning the page, a speck with /Background, a speck that
        // already has a /BBox, and a speck that is also painted with `sh`.
        let large = vec![(0.0, 0.0), (28083.0, 0.0), (0.0, 19867.0), (28083.0, 19867.0)];
        let shadings = vec![
            type4_shading(&large, ""),
            type4_shading(&speck(), "/Background [1 1 0]"),
            type4_shading(&speck(), "/BBox [0 0 100 100]"),
            type4_shading(&speck(), ""),
        ];
        // The fourth shading is object 5 + 2 * 3 + 1 = 12; reference it from
        // a /Shading resource too.
        let pdf = page_with_fills(&shadings, "/Shading << /Sh0 12 0 R >>", "/Sh0 sh\n", &[]);
        assert!(bound_tiny_mesh_shadings(&pdf).is_none());

        // Next to a degenerate one, only the degenerate one changes.
        let mut with_speck = shadings.clone();
        with_speck.push(type4_shading(&speck(), ""));
        let pdf = page_with_fills(&with_speck, "/Shading << /Sh0 12 0 R >>", "/Sh0 sh\n", &[]);
        let doc = Document::load_mem(&bound_tiny_mesh_shadings(&pdf).unwrap()).unwrap();
        for id in [6, 8, 12] {
            assert!(bbox_of(&doc, (id, 0)).is_none(), "object {}", id);
        }
        assert_eq!(bbox_of(&doc, (10, 0)), Some([0.0, 0.0, 100.0, 100.0]));
        assert!(bbox_of(&doc, (14, 0)).is_some());
    }

    #[test]
    fn unreadable_mesh_data_is_left_alone() {
        // Truncated Flate data, an unknown filter, a 3-bit-unaligned vertex
        // layout and a singular pattern matrix.
        let mut truncated = flate(&type4_data(&speck()));
        truncated.truncate(truncated.len() / 2);
        let unaligned = stream(
            "/ShadingType 4 /ColorSpace /DeviceGray /BitsPerCoordinate 8 /BitsPerComponent 4 \
             /BitsPerFlag 2 /Decode [0 100 0 100 0 1]",
            &[0u8; 64],
        );
        let shadings = vec![
            stream(&format!("{} /Filter /FlateDecode", TYPE4_DICT), &truncated),
            stream(&format!("{} /Filter /RunLengthDecode", TYPE4_DICT), &type4_data(&speck())),
            unaligned,
        ];
        assert!(bound_tiny_mesh_shadings(&page_with_fills(&shadings, "", "", &[])).is_none());

        // Same-length substitution keeps every xref offset valid.
        let mut bad = page_with_fills(&[type4_shading(&speck(), "")], "", "", &[]);
        let from = b"/Matrix [0 .12 .12 0 0 0]";
        let at = bad.windows(from.len()).position(|w| w == from.as_slice()).expect("fixture has the matrix");
        bad[at..at + from.len()].copy_from_slice(b"/Matrix [0 .00 .12 0 0 0]");
        assert!(bound_tiny_mesh_shadings(&bad).is_none());
    }

    #[test]
    fn unfiltered_lattice_meshes_are_read() {
        let mut data = Vec::new();
        for (x, y) in [(10u8, 20u8), (12, 20), (10, 22), (12, 22)] {
            data.extend_from_slice(&[x, y, 128]);
        }
        let lattice = stream(
            "/ShadingType 5 /ColorSpace /DeviceGray /BitsPerCoordinate 8 /BitsPerComponent 8 \
             /VerticesPerRow 2 /Decode [0 255 0 255 0 1]",
            &data,
        );
        let doc = Document::load_mem(&page_with_fills(&[lattice], "", "", &[])).unwrap();
        let shading = doc.get_object((6, 0)).unwrap().as_stream().unwrap();
        assert_eq!(mesh_bounds(&doc, &shading.dict, &shading.content), Some([10.0, 20.0, 12.0, 22.0]));
    }

    #[test]
    fn coons_patch_bounds_cover_the_implicit_interior_points() {
        // One type 6 patch, flag 0, twelve 8-bit points on a 0..30 square.
        let pts: [(u8, u8); 12] =
            [(0, 0), (0, 10), (0, 20), (0, 30), (10, 30), (20, 30), (30, 30), (30, 20), (30, 10), (30, 0), (20, 0), (10, 0)];
        let mut data = vec![0u8];
        for (x, y) in pts {
            data.extend_from_slice(&[x, y]);
        }
        data.extend_from_slice(&[0, 64, 128, 255]);
        let patch = stream(
            "/ShadingType 6 /ColorSpace /DeviceGray /BitsPerCoordinate 8 /BitsPerComponent 8 \
             /BitsPerFlag 8 /Decode [0 255 0 255 0 1]",
            &data,
        );
        let doc = Document::load_mem(&page_with_fills(&[patch], "", "", &[])).unwrap();
        let shading = doc.get_object((6, 0)).unwrap().as_stream().unwrap();
        assert_eq!(mesh_bounds(&doc, &shading.dict, &shading.content), Some([-30.0, -30.0, 60.0, 60.0]));
    }

    #[test]
    fn colour_components_follow_the_colour_space() {
        let doc = Document::load_mem(&page_with_fills(
            &[],
            "",
            "",
            &[stream("/N 4", b"icc"), b"[/Cyan /Magenta]".to_vec()],
        ))
        .unwrap();
        let name = |n: &str| Object::Name(n.as_bytes().to_vec());
        assert_eq!(colour_components(&doc, &name("DeviceCMYK")), Some(4));
        assert_eq!(colour_components(&doc, &Object::Array(vec![name("ICCBased"), Object::Reference((5, 0))])), Some(4));
        assert_eq!(
            colour_components(&doc, &Object::Array(vec![name("DeviceN"), Object::Reference((6, 0)), name("DeviceCMYK")])),
            Some(2)
        );
        assert_eq!(colour_components(&doc, &name("Pattern")), None);
    }

    #[test]
    fn smallest_singular_value_of_pattern_matrices() {
        assert!((smallest_singular_value(&[0.0, 0.12, 0.12, 0.0, 0.0, 0.0]) - 0.12).abs() < 1e-12);
        assert!((smallest_singular_value(&[2.0, 0.0, 0.0, 0.5, 9.0, 9.0]) - 0.5).abs() < 1e-12);
        assert!(smallest_singular_value(&[1.0, 1.0, 1.0, 1.0, 0.0, 0.0]) < 1e-9);
    }
}
