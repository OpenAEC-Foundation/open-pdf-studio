//! PDFium rendering integration for Open PDF Studio.
//!
//! Wraps the `pdfium-render` crate with the bindings we need for
//! `render_pdf_page` and `render_thumbnail` Tauri commands. Owns a
//! single static `Pdfium` instance for the lifetime of the app.
//!
//! Thread-safety: the `thread_safe` feature of `pdfium-render` wraps every
//! call in an internal mutex, so multiple Tauri command threads can
//! invoke PDFium concurrently — they just serialise inside PDFium.

use std::path::Path;
use std::sync::OnceLock;
use pdfium_render::prelude::*;

/// Global PDFium instance. Initialised once at app start by
/// `init_pdfium`. Subsequent calls to `pdfium()` are zero-cost lookups.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// Initialise the PDFium runtime by dynamically loading the DLL at the
/// given directory. Call this exactly once during app startup, before
/// any Tauri command runs.
///
/// On failure (DLL missing / corrupt / wrong arch) this returns an
/// error containing the underlying message — the caller should treat
/// this as fatal because no PDF rendering is possible without PDFium.
pub fn init_pdfium(dll_dir: &Path) -> Result<(), String> {
    if PDFIUM.get().is_some() {
        return Ok(()); // Already initialised — idempotent.
    }

    let bindings = Pdfium::bind_to_library(
        Pdfium::pdfium_platform_library_name_at_path(dll_dir),
    )
    .map_err(|e| format!("Failed to load PDFium DLL from {:?}: {}", dll_dir, e))?;

    let pdfium = Pdfium::new(bindings);

    PDFIUM
        .set(pdfium)
        .map_err(|_| "PDFium was concurrently initialised".to_string())?;

    Ok(())
}

/// Access the global PDFium instance. Panics if `init_pdfium` was
/// never called or failed — callers should rely on app-start order to
/// guarantee initialisation.
pub fn pdfium() -> &'static Pdfium {
    PDFIUM
        .get()
        .expect("PDFium not initialised. Call init_pdfium() during app startup.")
}

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Serialises ALL in-proc PDFium FFI work — document loading and page / region /
/// thumbnail rendering — onto a single global lock.
///
/// PDFium's in-proc API is not safe to call concurrently from multiple threads.
/// Even with pdfium-render's `thread_safe` feature (which only wraps each
/// individual FFI call), interleaving a document *load* on one thread with a
/// *render* on another — or two renders at once — corrupts the process heap.
/// This surfaced on Linux as `free(): double free detected` /
/// `malloc(): unaligned fastbin chunk` when a second document was opened while
/// the first was still rendering. Linux hits this because every render runs
/// in-proc: the multi-process worker pool is Windows-only. On Windows the pool
/// isolates each render in its own process, so this lock is virtually
/// uncontended there.
///
/// The guard is only ever held across synchronous FFI work — never across an
/// `.await` — so it cannot stall or deadlock the async runtime. Callers that
/// compose (e.g. `render_thumbnail_to_json` → `render_page_to_rgba`) must lock
/// at exactly one level to avoid re-entrant self-deadlock; see those functions.
static PDFIUM_INPROC_LOCK: Mutex<()> = Mutex::new(());

/// Acquire the in-proc PDFium lock, recovering from a poisoned mutex (a prior
/// panic mid-render) rather than permanently disabling all rendering.
///
/// `pub(crate)`: the CAD export (`cad_export.rs`) reads page objects through
/// the same PDFium library and must hold this lock while it does.
pub(crate) fn inproc_guard() -> std::sync::MutexGuard<'static, ()> {
    PDFIUM_INPROC_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

/// Wrapper around a loaded PDFium document. Holds the parsed byte buffer
/// alive for the document's lifetime via `Arc<Vec<u8>>`, and the raw
/// `PdfDocument<'static>` (lifetime extended unsafely via the static
/// PDFIUM ref). We never let the bytes outlive the wrapper, so this is
/// sound.
pub struct PdfiumDocumentHandle {
    // Order matters: `_bytes` must outlive `document`.
    document: PdfDocument<'static>,
    _bytes: Arc<Vec<u8>>,
}

impl PdfiumDocumentHandle {
    /// Construct a handle from raw PDF bytes. Returns Err on parse failure
    /// (corrupt PDF / unsupported encryption / etc).
    pub fn load_from_bytes(bytes: Arc<Vec<u8>>) -> Result<Self, String> {
        // Guard against an uninitialised PDFium (init_pdfium is now non-fatal,
        // so the library may be absent on a misbuilt bundle) — return an error
        // instead of letting pdfium() panic on the first render.
        if PDFIUM.get().is_none() {
            return Err("PDFium is not available — rendering is disabled on this build.".into());
        }
        // Safety: the document borrows from `bytes` and from `PDFIUM`. Both
        // live for 'static: `_bytes` is kept alive in the same struct, and
        // PDFIUM is a OnceLock<Pdfium> that is never dropped.
        let bytes_ref: &'static [u8] = unsafe {
            std::slice::from_raw_parts(bytes.as_ptr(), bytes.len())
        };

        let document = {
            // Loading is an in-proc PDFium FFI call: serialise it against all
            // rendering so opening a document can't race an in-flight render.
            let _guard = inproc_guard();
            pdfium()
                .load_pdf_from_byte_slice(bytes_ref, None)
                .map_err(|e| format!("Failed to load PDF via PDFium: {}", e))?
        };

        Ok(Self {
            document,
            _bytes: bytes,
        })
    }

    pub fn document(&self) -> &PdfDocument<'static> {
        &self.document
    }
}

/// Document-handle cache. Tauri state. Keyed by full file path.
#[derive(Default)]
pub struct PdfiumDocCache(pub Mutex<HashMap<String, Arc<PdfiumDocumentHandle>>>);

/// Get an Arc-wrapped PdfiumDocumentHandle for `path`. Reads bytes from
/// disk on cache miss. For the production hot path where bytes are already
/// cached, prefer `get_or_load_pdfium_doc_with_bytes`.
pub fn get_or_load_pdfium_doc(
    path: &str,
    cache: &PdfiumDocCache,
) -> Result<Arc<PdfiumDocumentHandle>, String> {
    {
        let map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
        if let Some(h) = map.get(path) {
            return Ok(h.clone());
        }
    }

    let bytes = std::fs::read(path).map_err(|e| format!("Read {}: {}", path, e))?;
    let arc_bytes = Arc::new(bytes);
    let handle = Arc::new(PdfiumDocumentHandle::load_from_bytes(arc_bytes)?);

    let mut map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
    // Double-check after parse to avoid race-double-load.
    if let Some(existing) = map.get(path) {
        return Ok(existing.clone());
    }
    map.insert(path.to_string(), handle.clone());
    Ok(handle)
}

/// Same as above but bytes are supplied directly. Used by Tauri commands
/// that already cache bytes via PdfBytesCache.
pub fn get_or_load_pdfium_doc_with_bytes(
    path: &str,
    bytes: Arc<Vec<u8>>,
    cache: &PdfiumDocCache,
) -> Result<Arc<PdfiumDocumentHandle>, String> {
    {
        let map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
        if let Some(h) = map.get(path) {
            return Ok(h.clone());
        }
    }

    let handle = Arc::new(PdfiumDocumentHandle::load_from_bytes(bytes)?);

    let mut map = cache.0.lock().map_err(|e| format!("Pdfium doc cache lock: {}", e))?;
    if let Some(existing) = map.get(path) {
        return Ok(existing.clone());
    }
    map.insert(path.to_string(), handle.clone());
    Ok(handle)
}

/// Page size in PDF points (width, height) as rendered, i.e. with the page's
/// /Rotate applied: the same shape `render_page_to_rgba` produces, without
/// rendering anything. Printing uses it to pick the paper orientation before
/// the printer DC exists.
pub fn page_size_pt(doc: &PdfDocument<'static>, page_index: u32) -> Result<(f32, f32), String> {
    // Same locking rule as render_page_to_rgba: the guard outlives `page`.
    let _guard = inproc_guard();
    let pages = doc.pages();
    let page = pages
        .get(page_index as i32)
        .map_err(|e| format!("Page {} not found: {}", page_index, e))?;
    Ok((page.width().value, page.height().value))
}

/// Render a single page to RGBA pixel bytes at the requested scale and
/// rotation. Returns (width, height, rgba) where rgba length is
/// width * height * 4.
///
/// `scale = 1.0` produces 1 PDF point = 1 pixel. The caller is
/// responsible for any DPR adjustment.
///
/// `rotation` is in degrees, must be one of 0, 90, 180, 270.
///
/// /AP annotation streams are rendered (FPDF_ANNOT flag on) so sticky
/// notes from Acrobat etc. appear, matching Chrome/Edge behaviour.
pub fn render_page_to_rgba(
    doc: &PdfDocument<'static>,
    page_index: u32,
    scale: f32,
    rotation: i32,
) -> Result<(u32, u32, Vec<u8>), String> {
    // Serialise all in-proc PDFium work (see PDFIUM_INPROC_LOCK). Declared
    // first so the guard outlives `pages`/`page`, whose Drop also calls PDFium.
    let _guard = inproc_guard();
    let pages = doc.pages();
    let page = pages
        .get(page_index as i32)
        .map_err(|e| format!("Page {} not found: {}", page_index, e))?;

    let width_pt = page.width().value;
    let height_pt = page.height().value;

    let target_w = (width_pt * scale).ceil() as i32;
    let target_h = (height_pt * scale).ceil() as i32;

    let rot = match rotation.rem_euclid(360) {
        0 => PdfPageRenderRotation::None,
        90 => PdfPageRenderRotation::Degrees90,
        180 => PdfPageRenderRotation::Degrees180,
        270 => PdfPageRenderRotation::Degrees270,
        other => return Err(format!("Unsupported rotation: {}", other)),
    };

    let config = PdfRenderConfig::new()
        .set_target_width(target_w)
        .set_maximum_height(target_h)
        .rotate(rot, true)
        .render_form_data(true)
        // ANNOTATION OWNERSHIP: PDFium does NOT render /Annot entries; our
        // own annotation-converter.js reads them into state.documents[]
        // and the annotation-canvas overlay draws them on top. This means
        // user deletes/edits via the UI reflect immediately — no need to
        // re-serialize the PDF + re-render to see the change. The fallback
        // before this was render_annotations(true) which double-rendered
        // every annotation (once by PDFium into the bitmap, once by our
        // overlay) and made deletes invisible until save+reload.
        //
        // KNOWN GAP: any /Annot subtype that annotation-converter doesn't
        // import will not be drawn. The converter currently covers
        // Highlight, Underline, StrikeOut, Square, Polygon, PolyLine, Ink,
        // FreeText, Circle, Line, Stamp, and the project's private OPS
        // subtypes. Exotic subtypes from third-party editors may be lost.
        .render_annotations(false)
        // FPDF_LCD_TEXT: subpixel antialiased text. Matches what Chromium /
        // Edge use by default.
        .use_lcd_text_rendering(true)
        .set_format(PdfBitmapFormat::BGRA);
    // KNOWN LIMITATION (v1.52 follow-up): PDFs with OCG (Optional Content
    // Group) layers that are hidden by default in viewer preferences
    // render those layers VISIBLE because pdfium-render 0.9.1 does not
    // expose FPDFOCG_IsContentVisible. Needs custom FFI calls.

    let bitmap = page
        .render_with_config(&config)
        .map_err(|e| format!("PDFium render failed: {}", e))?;

    let actual_w = bitmap.width() as u32;
    let actual_h = bitmap.height() as u32;
    let rgba = bitmap.as_rgba_bytes();

    Ok((actual_w, actual_h, rgba))
}

// ─── Tauri-layer pixmap cache ─────────────────────────────────────────────────

use std::collections::VecDeque;

/// A fully-rendered RGBA pixmap. Stored Arc-wrapped so cache hits clone
/// cheaply (atomic refcount) — the wire copy still happens at IPC time,
/// but the buffer lives once in memory regardless of how many concurrent
/// renders hold a handle.
pub struct CachedPixmap {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<Vec<u8>>,
}

/// Bounded-FIFO cache of fully-rendered pixmaps. Key: (path, page_idx,
/// scale_q = round(scale*10000), rotation). Sized to keep BARN's 7 pages
/// at 2-3 zoom levels comfortably resident (~20 entries), with headroom
/// for multi-doc workflows. 40 entries × ~15 MB ≈ 600 MB upper bound.
const PIXMAP_CACHE_MAX_ENTRIES: usize = 40;

pub struct PixmapCache {
    map: HashMap<(String, u32, u32, i32), Arc<CachedPixmap>>,
    order: VecDeque<(String, u32, u32, i32)>,
    max_entries: usize,
}

impl PixmapCache {
    fn new(max_entries: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::with_capacity(max_entries),
            max_entries,
        }
    }

    pub fn get(&self, key: &(String, u32, u32, i32)) -> Option<Arc<CachedPixmap>> {
        self.map.get(key).cloned()
    }

    pub fn insert(&mut self, key: (String, u32, u32, i32), value: Arc<CachedPixmap>) {
        if self.map.insert(key.clone(), value).is_none() {
            self.order.push_back(key);
            while self.order.len() > self.max_entries {
                if let Some(old) = self.order.pop_front() {
                    self.map.remove(&old);
                }
            }
        }
    }

    pub fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
    }

    /// Alle pixmaps van één document weg (document gesloten).
    pub fn remove_path(&mut self, path: &str) {
        self.map.retain(|k, _| k.0 != path);
        self.order.retain(|k| k.0 != path);
    }

    pub fn stats(&self) -> (usize, usize) {
        let bytes: usize = self.map.values().map(|v| v.rgba.len()).sum();
        (self.map.len(), bytes)
    }
}

/// Tauri state wrapper.
#[derive(Default)]
pub struct PixmapCacheState(pub Mutex<Option<PixmapCache>>);

impl PixmapCacheState {
    pub fn ensure(&self) {
        let mut guard = self.0.lock().unwrap();
        if guard.is_none() {
            *guard = Some(PixmapCache::new(PIXMAP_CACHE_MAX_ENTRIES));
        }
    }
}

// ─── Thumbnail rendering ───────────────────────────────────────────────────────

/// Render a low-resolution thumbnail of a single page, encoded as a
/// JSON string `{"dataURL":"data:image/jpeg;base64,...","width":N,"height":N}`.
///
/// `max_width` is in pixels — the page is scaled so the longest side
/// fits within this. Aspect ratio preserved.
///
/// The JSON shape matches the legacy wire format that left-panel.js
/// expects: it does `JSON.parse(result)` and accesses `.dataURL`,
/// `.width`, `.height`.
pub fn render_thumbnail_to_json(
    doc: &PdfDocument<'static>,
    page_index: u32,
    max_width: u32,
    rotation: i32,
) -> Result<String, String> {
    // Read the page width under the in-proc PDFium lock, then release it before
    // render_page_to_rgba (which re-acquires the same, non-re-entrant lock).
    let w_pt = {
        let _guard = inproc_guard();
        let pages = doc.pages();
        let page = pages
            .get(page_index as i32)
            .map_err(|e| format!("Page {}: {}", page_index, e))?;
        page.width().value
    };
    // The parameter is named `max_width` and callers (left-panel.js thumbnail
    // path) treat it as "thumbnail width is exactly this many pixels".
    // Earlier this used `w_pt.max(h_pt)` (max-axis semantics) which made
    // portrait pages render at narrower-than-requested widths (e.g. A4
    // portrait at maxWidth=140 became 99×140 instead of 140×198), giving
    // visibly different sizes than the JS-replay vector path (which is
    // strictly width-targeted). Mismatched thumbnail widths in the panel
    // produced the user-reported "different sizes" issue. Width-target the
    // scale so both paths produce identical (140×<aspect-h>) thumbnails.
    let scale = max_width as f32 / w_pt;

    let (w, h, rgba) = render_page_to_rgba(doc, page_index, scale, rotation)?;

    // Convert RGBA -> RGB for JPEG (JPEG doesn't support alpha).
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for chunk in rgba.chunks(4) {
        rgb.push(chunk[0]);
        rgb.push(chunk[1]);
        rgb.push(chunk[2]);
    }

    let mut jpeg_bytes = Vec::with_capacity(rgb.len() / 4);
    {
        use image::codecs::jpeg::JpegEncoder;
        use image::ImageEncoder;
        let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 75);
        encoder
            .write_image(&rgb, w, h, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode: {}", e))?;
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    let data_url = format!("data:image/jpeg;base64,{}", b64);

    Ok(format!(
        r#"{{"dataURL":"{}","width":{},"height":{}}}"#,
        data_url, w, h
    ))
}

// ─── Region / tile rendering ───────────────────────────────────────────────────

/// Render only a sub-rectangle of a PDF page to RGBA pixel bytes. The
/// output bitmap is sized `(region_w_pt * scale, region_h_pt * scale)` —
/// vastly smaller than rendering the full page at high zoom.
///
/// `region_*_pt` are in PDF user-space POINTS (1pt = 1/72 inch). They
/// describe which sub-rectangle of the page (origin top-left, before
/// rotation) to render. `scale` is the zoom factor (1.0 = 100%).
///
/// Used by the tile-mode render path for high-zoom viewing — only the
/// visible viewport region is rasterised, avoiding the giant full-page
/// bitmap and browser canvas-size limit.
///
/// Returns `(bitmap_width_px, bitmap_height_px, rgba_bytes)`.
///
/// # Limitations
/// - `rotation` must be 0 for this release. Non-zero values return `Err`.
///   Rotation support will be added in a subsequent step.
pub fn render_page_region_to_rgba(
    doc: &PdfDocument<'static>,
    page_index: u32,
    scale: f32,
    rotation: i32,
    region_x_pt: f32,
    region_y_pt: f32,
    region_w_pt: f32,
    region_h_pt: f32,
) -> Result<(u32, u32, Vec<u8>), String> {
    if rotation != 0 {
        return Err(format!(
            "render_page_region_to_rgba: rotation {} not yet supported (only 0 is implemented)",
            rotation
        ));
    }

    if region_w_pt <= 0.0 || region_h_pt <= 0.0 {
        return Err(format!(
            "render_page_region_to_rgba: region dimensions must be positive (got {}x{})",
            region_w_pt, region_h_pt
        ));
    }

    // Serialise all in-proc PDFium work (see PDFIUM_INPROC_LOCK). Declared
    // first so the guard outlives `pages`/`page`, whose Drop also calls PDFium.
    let _guard = inproc_guard();
    let pages = doc.pages();
    let page = pages
        .get(page_index as i32)
        .map_err(|e| format!("Page {} not found: {}", page_index, e))?;

    // Output bitmap pixel dimensions.
    let bitmap_w = (region_w_pt * scale).ceil() as i32;
    let bitmap_h = (region_h_pt * scale).ceil() as i32;

    if bitmap_w <= 0 || bitmap_h <= 0 {
        return Err(format!(
            "render_page_region_to_rgba: computed bitmap size {}x{} is invalid",
            bitmap_w, bitmap_h
        ));
    }

    // Build the affine matrix that maps the full page coordinate space to
    // bitmap pixels, then shifts so that `region_x_pt, region_y_pt` lands
    // at pixel (0,0).
    //
    // PDF user-space convention for FPDF_RenderPageBitmapWithMatrix (via
    // pdfium-render's `transform()` path):
    //   x' = a*x + c*y + e
    //   y' = b*x + d*y + f
    //
    //   a = scale_x  (x scale factor)
    //   d = scale_y  (y scale factor — positive; PDFium handles Y-flip internally)
    //   e = -region_x_pt * scale_x  (translate so region left edge → pixel 0)
    //   f = -region_y_pt * scale_y  (translate so region top edge → pixel 0)
    //   b = c = 0    (no shear / rotation)
    let scale_x = scale;
    let scale_y = scale;

    let tx = -region_x_pt * scale_x;
    let ty = -region_y_pt * scale_y;

    // PdfRenderConfig field order: transform(a, b, c, d, e, f)
    // We call set_fixed_size so the bitmap is exactly (bitmap_w × bitmap_h)
    // and use_auto_scaling = false, so no additional scale is baked in.
    // transform() sets do_render_form_data = false, which causes
    // FPDF_RenderPageBitmapWithMatrix to be used.
    let config = PdfRenderConfig::new()
        .set_fixed_size(bitmap_w, bitmap_h)
        .transform(scale_x, 0.0, 0.0, scale_y, tx, ty)
        .map_err(|e| format!("render_page_region_to_rgba: invalid transform matrix: {}", e))?
        // ANNOTATION OWNERSHIP: see render_page_to_rgba above. Tiles must
        // omit /Annot entries too so the overlay-canvas is the single
        // source of truth at every zoom level. Without this, high-zoom
        // tiles would still bake annotations into the bitmap and deleted
        // annotations would persist visually in tile regions.
        .render_annotations(false)
        .use_lcd_text_rendering(true)
        .set_format(PdfBitmapFormat::BGRA);

    let bitmap = page
        .render_with_config(&config)
        .map_err(|e| format!("PDFium region render failed: {}", e))?;

    let actual_w = bitmap.width() as u32;
    let actual_h = bitmap.height() as u32;

    // as_rgba_bytes() handles the BGRA→RGBA conversion automatically (matches
    // the existing render_page_to_rgba output shape).
    let rgba = bitmap.as_rgba_bytes();

    Ok((actual_w, actual_h, rgba))
}
