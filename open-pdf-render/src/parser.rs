use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use lopdf::ObjectId;
use crate::{RenderError, RenderedPage};
use crate::fonts::FontRegistry;
use crate::interpreter::ImageCache;

/// PoC 04 — bounded FIFO cache of fully-rendered page bitmaps.
///
/// Stores `Arc<RenderedPage>` so cache hits are atomic-increment cheap.
/// Bounded by entry count, not bytes — typical page is ~6-30 MB so 40
/// entries is roughly 240-1200 MB worst case. User-stated budget is
/// 700 MB; the default `max_entries=40` lands inside it for the corpus.
/// Eviction is FIFO (insertion-order queue + map lookup) rather than LRU
/// because the user's hot working set is "recently rendered" — visiting
/// pages doesn't shuffle eviction order, which is exactly what we want
/// when prerender or sequential scroll is the dominant pattern.
struct PixmapCache {
    map: HashMap<(usize, u32, i32), Arc<RenderedPage>>,
    insertion_order: VecDeque<(usize, u32, i32)>,
    max_entries: usize,
}

impl PixmapCache {
    fn new(max_entries: usize) -> Self {
        Self {
            map: HashMap::new(),
            insertion_order: VecDeque::with_capacity(max_entries),
            max_entries,
        }
    }

    fn get(&self, key: &(usize, u32, i32)) -> Option<Arc<RenderedPage>> {
        self.map.get(key).cloned()
    }

    fn insert(&mut self, key: (usize, u32, i32), value: Arc<RenderedPage>) {
        if self.map.insert(key, value).is_none() {
            self.insertion_order.push_back(key);
            while self.insertion_order.len() > self.max_entries {
                if let Some(old) = self.insertion_order.pop_front() {
                    self.map.remove(&old);
                }
            }
        }
    }

    fn stats(&self) -> (usize, usize) {
        let bytes = self.map.values().map(|v| v.rgba.len()).sum();
        (self.map.len(), bytes)
    }
}

/// Per-doc pixmap-cache capacity (entries, not bytes). Sized to keep BARN's
/// 7 pages × ~3 typical zoom levels = ~21 entries comfortably resident,
/// with headroom. 40 × ~15 MB ≈ 600 MB upper bound — within the user's
/// stated 700 MB budget.
const PIXMAP_CACHE_MAX_ENTRIES: usize = 40;

pub struct DocumentHandle {
    doc: lopdf::Document,
    /// Document-scoped font cache. Lives for the lifetime of the
    /// DocumentHandle so glyph outlines for fonts shared across pages are
    /// only extracted once. Uses Mutex for Send+Sync (Tauri commands run on
    /// a thread pool); contention is rare in practice.
    font_registry: Mutex<FontRegistry>,
    /// PoC 04 — full-page rendered-pixmap cache. Cuts repeat-render cost
    /// from "image decode skipped + draw all content stream" down to a
    /// single Vec<u8> clone (15 MB ≈ 10 ms on modern x86 vs ~280 ms for
    /// the full draw path even with image decode cached). Keyed by
    /// `(page_idx, scale_q = round(scale * 10_000), rotation)` so each
    /// (zoom × rotation) combination caches separately. Bounded FIFO at
    /// `PIXMAP_CACHE_MAX_ENTRIES`; oldest pages get evicted first.
    pixmap_cache: Mutex<PixmapCache>,
    /// PoC 02 — document-scoped decoded-image cache.
    ///
    /// Without this, each `render_page` allocates a fresh per-page
    /// `ImageCache` (interpreter.rs L240) and `predecode_images_parallel`
    /// re-decodes the same JPEG / FlateDecode + PNG-predictor streams every
    /// time the page is visited (re-scroll, zoom, repaint). For
    /// raster-heavy PDFs like Barn Relocation (73 unique large image
    /// XObjects shared across 7 pages) this is the dominant cost on the
    /// "warm scroll" path: the bench harness measured BARN
    /// `scroll_back_revisit` at 7301 ms vs `cold_open_p1` at 797 ms — the
    /// warm pass is 9× slower because the only thing it caches is the
    /// final RGBA pixmap of the WHOLE page, not the constituent images.
    ///
    /// The cache stores `Arc`-wrapped pixel buffers (`CachedDecodedImage`
    /// already wraps `Vec<u8>` in `Arc`) so handing entries to the
    /// per-render local cache is a cheap atomic-increment, not a copy.
    /// Insert-if-absent semantics on merge-back prevent thundering-herd
    /// re-decode when multiple renders race for the same image — first
    /// writer wins, subsequent writers' buffers are dropped immediately.
    doc_image_cache: Arc<RwLock<ImageCache>>,
}

impl DocumentHandle {
    pub fn load(bytes: &[u8]) -> Result<Self, RenderError> {
        let doc = lopdf::Document::load_from(std::io::Cursor::new(bytes))
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        Ok(DocumentHandle {
            doc,
            font_registry: Mutex::new(FontRegistry::new()),
            pixmap_cache: Mutex::new(PixmapCache::new(PIXMAP_CACHE_MAX_ENTRIES)),
            doc_image_cache: Arc::new(RwLock::new(ImageCache::new())),
        })
    }

    /// PoC 04 diagnostic: report the current pixmap-cache footprint.
    /// Returns (entry_count, total_rgba_bytes).
    pub fn pixmap_cache_stats(&self) -> (usize, usize) {
        if let Ok(g) = self.pixmap_cache.lock() { g.stats() } else { (0, 0) }
    }

    pub fn page_count(&self) -> usize {
        self.doc.get_pages().len()
    }

    /// PoC 02 diagnostic: report the current doc-image-cache memory footprint.
    /// Returns (entry_count, total_rgba_bytes).
    pub fn doc_image_cache_stats(&self) -> (usize, usize) {
        if let Ok(guard) = self.doc_image_cache.read() {
            let n = guard.len();
            let bytes = guard.values().map(|v| v.rgba_len()).sum();
            (n, bytes)
        } else {
            (0, 0)
        }
    }

    /// Returns the displayed dimensions of a page, accounting for the
    /// page's `/Rotate` field. For 90/270 rotations the width and height
    /// are swapped relative to the un-rotated MediaBox.
    pub fn page_dimensions(&self, page: usize) -> Result<(f32, f32), RenderError> {
        let page_id = self.get_page_id(page)?;
        let (w, h) = self.extract_media_box(page_id)?;
        let pdf_rot = self.read_page_rotation(page_id);
        Ok(Self::rotated_dimensions(pdf_rot, w, h))
    }

    /// Render a page to an RGBA bitmap, applying the combined rotation of
    /// the PDF's `/Rotate` field plus an optional `extra_rotation` from the
    /// app (e.g. user-applied rotation via the rotate-left/right buttons).
    /// Both rotations are clockwise-when-displayed, in degrees.
    pub fn render_page(&self, page: usize, scale: f32, extra_rotation: i32) -> Result<RenderedPage, RenderError> {
        self.render_page_internal(page, scale, extra_rotation, 0)
    }

    /// Render a page with a pixel budget for embedded images. Images larger
    /// than `max_image_pixels` total pixels are downsampled after decode.
    /// Use for thumbnails: e.g. `max_image_pixels = 250_000` (500×500)
    /// keeps images visible but limits decode cost.
    pub fn render_page_with_image_limit(&self, page: usize, scale: f32, extra_rotation: i32, max_image_pixels: u32) -> Result<RenderedPage, RenderError> {
        self.render_page_internal(page, scale, extra_rotation, max_image_pixels)
    }

    fn render_page_internal(&self, page: usize, scale: f32, extra_rotation: i32, max_image_pixels: u32) -> Result<RenderedPage, RenderError> {
        // PoC 04: pixmap-cache fast path. Only caches full-resolution renders
        // (max_image_pixels == 0) — thumbnail renders downsample images and
        // would pollute the cache with low-quality entries that the main
        // viewer never wants. Quantise the scale to 4 decimal places so
        // float-drift across calls doesn't fragment the cache (e.g. 1.0 vs
        // 1.000001 should be the same key).
        let cache_key = if max_image_pixels == 0 {
            Some((page, (scale * 10_000.0).round() as u32, extra_rotation))
        } else {
            None
        };
        if let Some(key) = cache_key {
            if let Ok(cache) = self.pixmap_cache.lock() {
                if let Some(cached) = cache.get(&key) {
                    // Cache hit. Clone the Vec once (~10 ms for a 15 MB
                    // BARN page on modern x86 — still 25-30× faster than
                    // re-rendering even with the doc-image-cache warm).
                    return Ok(RenderedPage {
                        width: cached.width,
                        height: cached.height,
                        rgba: cached.rgba.clone(),
                    });
                }
            }
        }

        let page_id = self.get_page_id(page)?;
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;

        let pdf_rot = self.read_page_rotation(page_id);
        let total_rot = ((pdf_rot + extra_rotation) % 360 + 360) % 360;

        // Post-rotation pixel dimensions
        let (out_w_pt, out_h_pt) = Self::rotated_dimensions(total_rot, w_pt, h_pt);
        let width = (out_w_pt * scale).ceil() as u32;
        let height = (out_h_pt * scale).ceil() as u32;

        let mut renderer = crate::renderer::SkiaRenderer::new(width, height)
            .map_err(|e| RenderError::RenderError(e))?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // Page-to-pixel transform built using the POST-rotation dimensions.
        // The rotation matrix below is then pre-concatenated so it runs
        // FIRST in user-space, before this transform.
        state.current.ctm = tiny_skia::Transform::from_row(
            scale, 0.0, 0.0, -scale,
            0.0, out_h_pt * scale,
        );

        // Apply the rotation, OR fall back to the un-rotated MediaBox-origin
        // shift if no rotation is needed (preserves the existing behaviour
        // for AutoCAD-style PDFs with negative-origin MediaBoxes).
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            state.current.ctm = state.current.ctm.pre_concat(rot_xform);
        } else {
            // No rotation — keep the original MediaBox-origin shift
            let shift = tiny_skia::Transform::from_row(1.0, 0.0, 0.0, 1.0, -x0, -y0);
            state.current.ctm = state.current.ctm.pre_concat(shift);
        }

        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;
        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;

        // Capture the page-to-pixel transform set up above, BEFORE the
        // content stream runs (it may leave residual `cm` translations
        // unpaired with q/Q). Annotations are positioned in PDF user
        // space and need this clean transform for correct rendering.
        let page_ctm = state.current.ctm;

        if max_image_pixels > 0 {
            crate::interpreter::Interpreter::execute_with_image_limit(&content_bytes, &mut renderer, &mut state, &self.doc, &resources, &mut *font_registry, max_image_pixels, Some(&self.doc_image_cache))?;
        } else {
            crate::interpreter::Interpreter::execute(&content_bytes, &mut renderer, &mut state, &self.doc, &resources, &mut *font_registry, Some(&self.doc_image_cache))?;
        }

        // Iter 29: render page annotations with appearance streams
        // (PDF spec §12.5.5). Skipping these makes sticky-note callouts,
        // /FreeText labels, /Square outlines, /Stamp etc invisible — visible
        // as missing yellow boxes vs. PyMuPDF reference on Technische
        // tekening p1, Barn Relocation, and similar markup-heavy PDFs.
        // Reset to the page-level CTM so annotation rects (in PDF user
        // space) project to the correct page pixels regardless of what
        // residual transform the content stream left behind.
        state.current.ctm = page_ctm;
        // Reset graphics state knobs that may have been left in unusual
        // values by the content stream — annotation appearances expect a
        // fresh state per spec.
        state.current.fill_alpha = 1.0;
        state.current.stroke_alpha = 1.0;
        state.current.group_fill_alpha = 1.0;
        state.current.group_stroke_alpha = 1.0;
        state.current.text_render_mode = 0;
        state.current.clip_path = None;
        self.render_page_annotations(page_id, &mut renderer, &mut state, &mut *font_registry, Some(&self.doc_image_cache));

        drop(font_registry);

        let rendered_rgba = renderer.into_rgba();

        // PoC 04: insert the freshly-rendered page into the cache so the
        // next visit returns it via the fast path above. Clone-into-Arc
        // pays one 15 MB allocation+copy on the miss path; subsequent
        // hits return cheap Arc clones. We deliberately skip caching when
        // a thumbnail (max_image_pixels > 0) path runs.
        if let Some(key) = cache_key {
            if let Ok(mut cache) = self.pixmap_cache.lock() {
                let cached = Arc::new(RenderedPage {
                    width,
                    height,
                    rgba: rendered_rgba.clone(),
                });
                cache.insert(key, cached);
            }
        }

        Ok(RenderedPage { width, height, rgba: rendered_rgba })
    }

    /// Render every annotation on the page that has a `/AP /N` appearance
    /// stream. Skipped types (no AP): /Link (interactive only — no visual),
    /// /Widget without appearance, /Popup (associated with another annot).
    fn render_page_annotations(
        &self,
        page_id: ObjectId,
        renderer: &mut crate::renderer::SkiaRenderer,
        state: &mut crate::graphics_state::GraphicsStateStack,
        font_registry: &mut FontRegistry,
        doc_image_cache: Option<&Arc<RwLock<ImageCache>>>,
    ) {
        let page_dict = match self.doc.get_object(page_id).and_then(|o| o.as_dict().map(|d| d.clone())) {
            Ok(d) => d,
            Err(_) => return,
        };
        // Resolve /Annots — may be a direct array or a reference.
        let annots_arr = match page_dict.get(b"Annots") {
            Ok(lopdf::Object::Array(arr)) => arr.clone(),
            Ok(lopdf::Object::Reference(rid)) => {
                match self.doc.get_object(*rid).and_then(|o| o.as_array().map(|a| a.clone())) {
                    Ok(a) => a,
                    Err(_) => return,
                }
            }
            _ => return,
        };

        for annot_obj in &annots_arr {
            // Each annot is usually a Reference; could be a direct dict.
            let annot_dict = match annot_obj {
                lopdf::Object::Reference(rid) => {
                    match self.doc.get_object(*rid).and_then(|o| o.as_dict().map(|d| d.clone())) {
                        Ok(d) => d,
                        Err(_) => continue,
                    }
                }
                lopdf::Object::Dictionary(d) => d.clone(),
                _ => continue,
            };

            // Skip if /F flag bit 2 (Hidden) or bit 1 (Invisible) is set —
            // PDF spec §12.5.3, Table 165. Bit 3 (Print) is irrelevant for
            // screen rendering. We honour /F here so the renderer matches
            // PyMuPDF's default behaviour.
            if let Ok(flags) = annot_dict.get(b"F").and_then(|o| o.as_i64()) {
                if (flags & 0x01) != 0 || (flags & 0x02) != 0 {
                    continue;
                }
            }

            // Get /Rect.
            let rect = match annot_dict.get(b"Rect").and_then(|o| o.as_array()) {
                Ok(arr) if arr.len() >= 4 => {
                    let x0 = Self::obj_to_f32(&arr[0]).unwrap_or(0.0);
                    let y0 = Self::obj_to_f32(&arr[1]).unwrap_or(0.0);
                    let x1 = Self::obj_to_f32(&arr[2]).unwrap_or(0.0);
                    let y1 = Self::obj_to_f32(&arr[3]).unwrap_or(0.0);
                    (x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1))
                }
                _ => continue,
            };
            if (rect.2 - rect.0) <= 0.0 || (rect.3 - rect.1) <= 0.0 {
                continue;
            }

            // Get /AP /N — the normal-appearance form XObject.
            let ap_dict = match annot_dict.get(b"AP") {
                Ok(lopdf::Object::Dictionary(d)) => d.clone(),
                Ok(lopdf::Object::Reference(rid)) => {
                    match self.doc.get_object(*rid).and_then(|o| o.as_dict().map(|d| d.clone())) {
                        Ok(d) => d,
                        Err(_) => continue,
                    }
                }
                _ => continue,
            };
            let n_obj = match ap_dict.get(b"N") {
                Ok(o) => o,
                _ => continue,
            };
            // /N may be a stream (direct) or a reference. For state-aware
            // appearances (Widget with /AS), /N is a sub-dict keyed by
            // appearance state name — we deliberately ignore that case here
            // (rare for the corpus).
            let stream = match n_obj {
                lopdf::Object::Stream(s) => s.clone(),
                lopdf::Object::Reference(rid) => {
                    match self.doc.get_object(*rid) {
                        Ok(lopdf::Object::Stream(s)) => s.clone(),
                        _ => continue,
                    }
                }
                _ => continue,
            };

            crate::interpreter::Interpreter::render_annotation_appearance(
                &stream, rect, renderer, state, &self.doc, font_registry, doc_image_cache,
            );
        }
    }

    fn get_page_id(&self, page: usize) -> Result<ObjectId, RenderError> {
        let pages = self.doc.get_pages();
        let mut sorted: Vec<_> = pages.iter().collect();
        sorted.sort_by_key(|(num, _)| *num);
        let (_, &page_id) = sorted.get(page)
            .ok_or_else(|| RenderError::ParseError(format!("Page {} not found", page)))?;
        Ok(page_id)
    }

    // Returns (x0, y0, width, height) — origin can be non-zero!
    fn extract_media_box_full(&self, page_id: ObjectId) -> Result<(f32, f32, f32, f32), RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        // Use CropBox if available, otherwise MediaBox
        let box_arr = dict.get(b"CropBox")
            .or_else(|_| dict.get(b"MediaBox"))
            .map_err(|_| RenderError::ParseError("No MediaBox/CropBox".into()))?
            .as_array()
            .map_err(|_| RenderError::ParseError("Box not array".into()))?;

        let x0 = Self::obj_to_f32(&box_arr[0])?;
        let y0 = Self::obj_to_f32(&box_arr[1])?;
        let x1 = Self::obj_to_f32(&box_arr[2])?;
        let y1 = Self::obj_to_f32(&box_arr[3])?;
        Ok((x0, y0, (x1 - x0).abs(), (y1 - y0).abs()))
    }

    fn extract_media_box(&self, page_id: ObjectId) -> Result<(f32, f32), RenderError> {
        let (_, _, w, h) = self.extract_media_box_full(page_id)?;
        Ok((w, h))
    }

    fn get_page_resources(&self, page_id: ObjectId) -> Result<lopdf::Dictionary, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        match dict.get(b"Resources") {
            Ok(res) => {
                match res {
                    lopdf::Object::Dictionary(d) => Ok(d.clone()),
                    lopdf::Object::Reference(id) => {
                        let resolved = self.doc.get_object(*id)
                            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
                        resolved.as_dict()
                            .map(|d| d.clone())
                            .map_err(|_| RenderError::ParseError("Resources is not a dict".into()))
                    }
                    _ => Ok(lopdf::Dictionary::new()),
                }
            }
            Err(_) => Ok(lopdf::Dictionary::new()),
        }
    }

    fn get_content_stream(&self, page_id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        let contents = match dict.get(b"Contents") {
            Ok(c) => c,
            Err(_) => return Ok(Vec::new()),
        };

        match contents {
            lopdf::Object::Reference(id) => {
                self.decode_stream(*id)
            }
            lopdf::Object::Array(arr) => {
                let mut all_bytes = Vec::new();
                for item in arr {
                    match item {
                        lopdf::Object::Reference(id) => {
                            let bytes = self.decode_stream(*id)?;
                            all_bytes.extend_from_slice(&bytes);
                            all_bytes.push(b'\n');
                        }
                        _ => {}
                    }
                }
                Ok(all_bytes)
            }
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Ok(Vec::new()),
        }
    }

    fn decode_stream(&self, id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let obj = self.doc.get_object(id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        match obj {
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Err(RenderError::ParseError("Contents ref is not a stream".into())),
        }
    }

    fn obj_to_f32(obj: &lopdf::Object) -> Result<f32, RenderError> {
        match obj {
            lopdf::Object::Real(r) => Ok(*r as f32),
            lopdf::Object::Integer(i) => Ok(*i as f32),
            _ => Err(RenderError::ParseError("Expected number".into())),
        }
    }

    /// Read the page's `/Rotate` value, walking the `/Parent` chain if the
    /// entry isn't on the page object itself (PDF spec: /Rotate is
    /// inheritable through the page tree). Returns degrees normalized to
    /// {0, 90, 180, 270}.
    pub fn read_page_rotation(&self, page_id: ObjectId) -> i32 {
        let page_obj = match self.doc.get_object(page_id) {
            Ok(o) => o,
            Err(_) => return 0,
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            Err(_) => return 0,
        };

        // Check this dict, then walk /Parent if missing.
        let mut current = dict.clone();
        for _ in 0..10 {
            if let Ok(rot) = current.get(b"Rotate") {
                let raw = match rot {
                    lopdf::Object::Integer(i) => *i as i32,
                    lopdf::Object::Real(r) => *r as i32,
                    lopdf::Object::Reference(id) => {
                        if let Ok(o) = self.doc.get_object(*id) {
                            match o {
                                lopdf::Object::Integer(i) => *i as i32,
                                lopdf::Object::Real(r) => *r as i32,
                                _ => 0,
                            }
                        } else { 0 }
                    }
                    _ => 0,
                };
                return ((raw % 360) + 360) % 360;
            }
            // Walk to parent
            let parent = match current.get(b"Parent") {
                Ok(lopdf::Object::Reference(id)) => self.doc.get_object(*id),
                _ => break,
            };
            let parent_obj = match parent { Ok(p) => p, Err(_) => break };
            let parent_dict = match parent_obj.as_dict() { Ok(d) => d, Err(_) => break };
            current = parent_dict.clone();
        }
        0
    }

    /// Build the transformation matrix that rotates a page's content by the
    /// given number of degrees (clockwise when displayed) AND maps it into
    /// positive coordinates starting at (0, 0). The result is a Y-up
    /// (PDF user-space) transform that pre-concats onto the page CTM.
    ///
    /// For 0° → identity. For 90/180/270 → rotation + translation so the
    /// rotated page bounding box has its bottom-left at (0, 0).
    ///
    /// `mb` is the original (un-rotated) MediaBox: (x0, y0, x1, y1).
    fn rotation_transform(rotation_deg: i32, mb: (f32, f32, f32, f32)) -> Option<tiny_skia::Transform> {
        let (x0, y0, x1, y1) = mb;
        match ((rotation_deg % 360) + 360) % 360 {
            0 => None,
            90 => {
                // (x, y) → (y - y0, x1 - x)
                Some(tiny_skia::Transform::from_row(0.0, -1.0, 1.0, 0.0, -y0, x1))
            }
            180 => {
                // (x, y) → (x1 - x, y1 - y)
                Some(tiny_skia::Transform::from_row(-1.0, 0.0, 0.0, -1.0, x1, y1))
            }
            270 => {
                // (x, y) → (y1 - y, x - x0)
                Some(tiny_skia::Transform::from_row(0.0, 1.0, -1.0, 0.0, y1, -x0))
            }
            _ => None, // non-multiple of 90 — ignore
        }
    }

    /// Returns the post-rotation page dimensions: for 0/180 the original
    /// (W, H); for 90/270 the swapped (H, W).
    fn rotated_dimensions(rotation_deg: i32, w: f32, h: f32) -> (f32, f32) {
        match ((rotation_deg % 360) + 360) % 360 {
            90 | 270 => (h, w),
            _ => (w, h),
        }
    }

    /// Analyze whether a page is pure vector or contains raster content (images/shading).
    ///
    /// Pages classified as `Tile` are skipped by the JS-side background vector
    /// prefetch in `loader.js`, which would otherwise call `extract_draw_commands`
    /// (decoding all images on the page) for every page on PDF load. For PDFs
    /// with many or large embedded images that would freeze the app — see the
    /// Barn Relocation test case (7 pages × 124M total pixels of FlateDecode).
    ///
    /// Heuristic for Tile classification:
    /// 1. Content stream uses `sh` (shading) operator, OR
    /// 2. Page resources contain > 5 Image XObjects, OR
    /// 3. Any single Image XObject's pixel count exceeds 2 million (≥ ~1500×1300)
    ///
    /// These thresholds are conservative — pure-vector pages with small icons
    /// (logos, signatures) keep their Vector classification and benefit from
    /// the BG prefetch + JS replay path. Image-heavy diagram/photo pages fall
    /// back to the Rust `render_thumbnail` path which honors `skip_images`
    /// for fast (low-fidelity) thumbnails and only does full image decode
    /// when the user actually navigates to the page in the main view.
    pub fn analyze_page_type(&self, page: usize) -> Result<crate::PageType, RenderError> {
        let page_id = self.get_page_id(page)?;

        // ─── XObject check FIRST (cheap: just dict iteration, no content
        //     stream decompression or operator decode) ─────────────────────
        // Pages with large or numerous raster XObjects classify as Tile
        // unconditionally. Walking the /XObject dict is microseconds —
        // contrast with decoding a multi-megabyte content stream below.
        let resources = self.get_page_resources(page_id)?;
        if let Ok(xobj_obj) = resources.get(b"XObject") {
            let xobj_dict_opt = match xobj_obj {
                lopdf::Object::Dictionary(d) => Some(d.clone()),
                lopdf::Object::Reference(id) => {
                    self.doc.get_object(*id).ok()
                        .and_then(|o| o.as_dict().ok().cloned())
                }
                _ => None,
            };
            if let Some(xobj_dict) = xobj_dict_opt {
                const MAX_IMAGE_COUNT: usize = 5;
                const MAX_SINGLE_IMAGE_PIXELS: u64 = 2_000_000;

                let mut image_count: usize = 0;
                for (_name, val) in xobj_dict.iter() {
                    // Resolve indirect refs to the actual stream.
                    let stream_obj = match val {
                        lopdf::Object::Stream(s) => Some(s.clone()),
                        lopdf::Object::Reference(id) => {
                            self.doc.get_object(*id).ok().and_then(|o| match o {
                                lopdf::Object::Stream(s) => Some(s.clone()),
                                _ => None,
                            })
                        }
                        _ => None,
                    };
                    let Some(stream) = stream_obj else { continue };

                    // Must be /Subtype /Image
                    let is_image = stream.dict.get(b"Subtype").ok()
                        .and_then(|o| o.as_name().ok())
                        .map(|n| n == b"Image")
                        .unwrap_or(false);
                    if !is_image { continue; }

                    // The vector replay only implements /SMask soft alpha.
                    // Explicit stencil masking (/Mask stream), colour-key
                    // masking (/Mask array) and stencil images (/ImageMask)
                    // would be painted as opaque rectangles, so a page built
                    // from them renders wrong (mixed-raster scans, where a
                    // foreground colour layer is hidden behind a 1-bit mask,
                    // came out as a solid grey/dark sheet). PDFium handles all
                    // of these, so send such pages down the Tile/PDFium path.
                    let has_mask = stream.dict.get(b"Mask").is_ok();
                    let is_stencil = stream.dict.get(b"ImageMask").ok()
                        .and_then(|o| o.as_bool().ok())
                        .unwrap_or(false);
                    if has_mask || is_stencil {
                        return Ok(crate::PageType::Tile);
                    }

                    image_count += 1;
                    if image_count > MAX_IMAGE_COUNT {
                        return Ok(crate::PageType::Tile);
                    }

                    let w = stream.dict.get(b"Width").ok()
                        .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u64;
                    let h = stream.dict.get(b"Height").ok()
                        .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u64;
                    if w * h > MAX_SINGLE_IMAGE_PIXELS {
                        return Ok(crate::PageType::Tile);
                    }
                }
            }
        }

        // ─── Content-stream size shortcut ────────────────────────────────
        // For pages with very large content streams, the full lopdf operator
        // decode (Content::decode) takes hundreds to thousands of ms on
        // construction PDFs and the result is virtually always Tile anyway
        // — content streams that big have too many vector commands for the
        // JS-replay path to be faster than a single PDFium raster. Skip
        // the decode and classify Tile when the decompressed content stream
        // exceeds this threshold.
        //
        // Tunable: 500 KB picked empirically.
        //   - NKD1a p2-7: multi-MB streams, classify instantly as Tile
        //   - rapport-constructie p26: 902 KB stream — caught by this
        //     threshold; previously (1 MB threshold) it fell into the slow
        //     decode path for 1.3 s and the user perceived it as "page
        //     doesn't open" while waiting
        //   - Tekst / small report pages: 1-50 KB streams, decode fast,
        //     stay on JS-replay vector path
        const TILE_CONTENT_THRESHOLD_BYTES: usize = 500_000;
        let content_bytes = self.get_content_stream(page_id)?;
        if content_bytes.len() > TILE_CONTENT_THRESHOLD_BYTES {
            return Ok(crate::PageType::Tile);
        }

        // ─── Small content stream: full decode + sh-operator scan ────────
        // Shading operator (`sh`) draws a Pattern shading dictionary across
        // a region. Patterns can be radial/axial gradients or function-based
        // — none of which our JS-replay vector path handles correctly, so
        // any page using `sh` falls back to PDFium raster.
        let content = lopdf::content::Content::decode(&content_bytes)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        for op in &content.operations {
            if op.operator.as_str() == "sh" {
                return Ok(crate::PageType::Tile);
            }
        }

        Ok(crate::PageType::Vector)
    }

    /// Extract draw commands without rendering to bitmap.
    /// Returns binary buffer with 16-byte header (f32 LE: x0, y0, pageW, pageH) + commands.
    /// x0/y0 is the MediaBox origin — can be non-zero (e.g. -846, -595).
    ///
    /// Borrows the document-scoped FontRegistry so glyph outline extraction
    /// for fonts seen on previous pages is reused. The first page that uses
    /// a given font pays the parse cost; subsequent pages are ~free for that
    /// font's text.
    pub fn extract_draw_commands(&self, page: usize, extra_rotation: i32) -> Result<crate::DrawCommandBuffer, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;

        let pdf_rot = self.read_page_rotation(page_id);
        let total_rot = ((pdf_rot + extra_rotation) % 360 + 360) % 360;

        // Compute the post-rotation dimensions and origin to write into the
        // header. For a rotated page the rotation matrix already maps the
        // original content to start at (0, 0), so we report origin (0, 0).
        // For an un-rotated page we keep the original MediaBox-origin
        // semantics so PDFs with negative origins still work the same way.
        let (out_x0, out_y0, out_w, out_h) = if total_rot == 0 {
            (x0, y0, w_pt, h_pt)
        } else {
            let (rw, rh) = Self::rotated_dimensions(total_rot, w_pt, h_pt);
            (0.0_f32, 0.0_f32, rw, rh)
        };

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // For rotated pages, seed the GraphicsStateStack's CTM with the
        // rotation matrix so every operator that follows is implicitly
        // applied AFTER the rotation. This produces draw commands in the
        // post-rotation coordinate system.
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            state.current.ctm = rot_xform;
        }

        let mut cmds = crate::draw_commands::DrawCommandBuffer::new();

        // For rotated pages, also emit the rotation as the very first
        // Transform command in the buffer so the JS replay sees it. The
        // GraphicsStateStack rotation above is for the interpreter's bbox
        // tracking; the buffer's transform command is what JS actually
        // executes when it replays the commands onto canvas.
        if let Some(rot_xform) = Self::rotation_transform(total_rot, (x0, y0, x0 + w_pt, y0 + h_pt)) {
            cmds.transform(rot_xform.sx, rot_xform.ky, rot_xform.kx, rot_xform.sy, rot_xform.tx, rot_xform.ty);
        }

        let resources = self.get_page_resources(page_id)?;

        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;
        crate::interpreter::Interpreter::extract_commands(
            &content_bytes, &mut cmds, &mut state, &self.doc, &resources, &mut *font_registry,
        )?;
        drop(font_registry);

        // Ship-guard: een te grote command-buffer mag NIET naar de webview
        // (JS-replay). De in-lus budget-cap in de interpreter stopt de groei bij
        // pathologische bladen (miljoenen path-ops in een Form-XObject), maar de
        // afgekapte buffer zou als geldig resultaat alsnog worden verscheept en
        // het webview-geheugen vullen tot vastlopen. Weiger 'm hier met een Err;
        // de aanroeper valt terug op het PDFium-rasterpad, dat zulke bladen
        // tegel-voor-tegel wél aankan. (Zonder into_bytes()-kopie hierboven, dus
        // geen extra geheugenpiek voor het afgewezen blad.)
        if cmds.len() > crate::interpreter::EXTRACT_DRAW_COMMANDS_SHIP_LIMIT {
            return Err(RenderError::RenderError(format!(
                "pagina te complex voor vector-extractie ({} MB) — terugval op raster",
                cmds.len() / (1024 * 1024)
            )));
        }

        // Prepend 16-byte header: x0, y0, width, height (all f32 LE)
        let cmd_bytes = cmds.into_bytes();
        let mut result = Vec::with_capacity(16 + cmd_bytes.len());
        result.extend_from_slice(&out_x0.to_le_bytes());
        result.extend_from_slice(&out_y0.to_le_bytes());
        result.extend_from_slice(&out_w.to_le_bytes());
        result.extend_from_slice(&out_h.to_le_bytes());
        result.extend(cmd_bytes);

        Ok(crate::DrawCommandBuffer::from_vec(result))
    }

    /// Extract text span positions from a page.
    /// Returns a JSON array string of text spans with x, y, width, height, fontSize, and text.
    /// Coordinates are in PDF user space (origin bottom-left, Y up).
    pub fn extract_text_positions(&self, page: usize) -> Result<String, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (_x0, _y0, _w_pt, _h_pt) = self.extract_media_box_full(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut cmds = crate::draw_commands::DrawCommandBuffer::new();
        let mut font_registry = self.font_registry.lock()
            .map_err(|e| RenderError::RenderError(format!("Font registry poisoned: {}", e)))?;
        let mut text_spans = Vec::new();

        crate::interpreter::Interpreter::extract_commands_with_text(
            &content_bytes, &mut cmds, &mut state, &self.doc, &resources,
            &mut *font_registry, Some(&mut text_spans),
        )?;

        let json_spans: Vec<String> = text_spans.iter().map(|s| s.to_json()).collect();
        Ok(format!("[{}]", json_spans.join(",")))
    }

    /// Extract draw commands for many pages in parallel using rayon.
    /// Used for adjacent-page prefetch and bulk warm-up. Returns one result
    /// per requested page in the same order. Each (page, extra_rotation)
    /// pair is independent so different pages can have different user rotation.
    pub fn extract_draw_commands_batch(&self, pages: &[(usize, i32)]) -> Vec<Result<crate::DrawCommandBuffer, RenderError>> {
        use rayon::prelude::*;
        pages.par_iter().map(|&(p, rot)| self.extract_draw_commands(p, rot)).collect()
    }

    /// Classify many pages in parallel using rayon. Used for a one-shot
    /// background warm-up immediately after cold-open so subsequent page
    /// navigation never pays the analyze_page_type cost again (when paired
    /// with the lib.rs-side `PageTypeCache`). With the size-shortcut in
    /// analyze_page_type, huge content-stream pages return in microseconds,
    /// so a 7-page batch is typically <50 ms total even on construction PDFs.
    pub fn analyze_page_types_batch(&self, pages: &[usize]) -> Vec<Result<crate::PageType, RenderError>> {
        use rayon::prelude::*;
        pages.par_iter().map(|&p| self.analyze_page_type(p)).collect()
    }

    /// Extract dimensions for ALL pages in parallel. Faster than the
    /// sequential `(0..page_count()).map(page_dimensions)` loop on
    /// multi-page documents because page-dimension extraction reads the
    /// page object tree which is cheap and embarrassingly parallel.
    pub fn page_dimensions_all(&self) -> Vec<Result<(f32, f32), RenderError>> {
        use rayon::prelude::*;
        (0..self.page_count())
            .into_par_iter()
            .map(|i| self.page_dimensions(i))
            .collect()
    }
}
