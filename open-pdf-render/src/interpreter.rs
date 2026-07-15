use lopdf::{Document, Dictionary, Object};
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::draw_commands::DrawCommandBuffer;
use crate::fonts::FontRegistry;
use crate::color;
use crate::RenderError;

// Per-stage image timing accumulators (microseconds). Enabled by setting
// OPSR_PROFILE_IMAGES=1; otherwise the time-checking code is hot-path-cheap
// (one atomic load + one branch). Speed iter-24 instrumentation.
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
static PROF_FLATE_US: AtomicU64 = AtomicU64::new(0);
static PROF_PREDICTOR_US: AtomicU64 = AtomicU64::new(0);
static PROF_JPEG_US: AtomicU64 = AtomicU64::new(0);
static PROF_RAW_DECODE_US: AtomicU64 = AtomicU64::new(0);
static PROF_PREMUL_US: AtomicU64 = AtomicU64::new(0);
static PROF_DRAW_US: AtomicU64 = AtomicU64::new(0);
static PROF_DEREF_US: AtomicU64 = AtomicU64::new(0);
static PROF_IMG_COUNT: AtomicUsize = AtomicUsize::new(0);
static PROF_SEEN_XOBJ: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<lopdf::ObjectId, u32>>> = std::sync::OnceLock::new();

#[inline(always)]
fn profile_enabled() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| std::env::var_os("OPSR_PROFILE_IMAGES").is_some())
}

fn profile_reset() {
    PROF_FLATE_US.store(0, Ordering::Relaxed);
    PROF_PREDICTOR_US.store(0, Ordering::Relaxed);
    PROF_JPEG_US.store(0, Ordering::Relaxed);
    PROF_RAW_DECODE_US.store(0, Ordering::Relaxed);
    PROF_PREMUL_US.store(0, Ordering::Relaxed);
    PROF_DRAW_US.store(0, Ordering::Relaxed);
    PROF_DEREF_US.store(0, Ordering::Relaxed);
    PROF_IMG_COUNT.store(0, Ordering::Relaxed);
    if let Some(m) = PROF_SEEN_XOBJ.get() {
        if let Ok(mut g) = m.lock() {
            g.clear();
        }
    }
}

fn profile_dump() {
    let n = PROF_IMG_COUNT.load(Ordering::Relaxed);
    if n == 0 { return; }
    eprintln!(
        "  [img-stages n={n}] deref={:>5}us flate={:>5}us predictor={:>5}us jpeg={:>5}us raw={:>5}us premul={:>5}us draw={:>5}us",
        PROF_DEREF_US.load(Ordering::Relaxed),
        PROF_FLATE_US.load(Ordering::Relaxed),
        PROF_PREDICTOR_US.load(Ordering::Relaxed),
        PROF_JPEG_US.load(Ordering::Relaxed),
        PROF_RAW_DECODE_US.load(Ordering::Relaxed),
        PROF_PREMUL_US.load(Ordering::Relaxed),
        PROF_DRAW_US.load(Ordering::Relaxed),
    );
}

// Dump unique-image diagnostic when profiling.
pub(crate) fn profile_dump_uniq(seen: &std::collections::HashMap<lopdf::ObjectId, u32>) {
    if seen.is_empty() { return; }
    let total: u32 = seen.values().sum();
    let unique = seen.len();
    let max_reuse = seen.values().max().copied().unwrap_or(0);
    eprintln!(
        "  [img-uniq] total_refs={total} unique_xobj={unique} max_reuse={max_reuse}"
    );
}

/// A text span with position, size, and Unicode text content.
/// Used to build a synthetic text selection layer in the frontend.
#[derive(Clone, Debug)]
pub struct TextSpan {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    pub text: String,
}

impl TextSpan {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"x":{},"y":{},"width":{},"height":{},"fontSize":{},"text":"{}"}}"#,
            self.x, self.y, self.width, self.height, self.font_size,
            self.text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
        )
    }
}

/// PDF Text State — follows PDF spec §9.3 and §9.4 exactly.
///
/// Two matrices track text position:
/// - `tm`:  Text Matrix — current glyph rendering position
/// - `tlm`: Text Line Matrix — start of current line (set by Td/TD/Tm/T*)
///
/// Character advances update `tm` via matrix pre-multiplication:
///   tm_new = [1 0 0 1 tx ty] × tm_old
///
/// Line moves (Td/TD/T*) update `tlm` then copy to `tm`.
struct TextState {
    font_size: f32,            // Tfs — set by Tf operator
    horizontal_scaling: f32,   // Th — set by Tz operator (1.0 = 100%)
    char_spacing: f32,         // Tc — set by Tc operator
    word_spacing: f32,         // Tw — set by Tw operator
    leading: f32,              // TL — set by TL operator
    rise: f32,                 // Trise — set by Ts operator
    tm: [f32; 6],             // Text matrix [a b c d e f]
    tlm: [f32; 6],            // Text line matrix
    in_text: bool,
    current_font_name: String,
    // Note: text rendering mode (Tr) lives on the graphics state
    // (`GraphicsState::text_render_mode`) — per PDF 1.7 §8.4.1 the text
    // state is part of the graphics state and is saved/restored by q/Q.
    // Many PDFs (Tekst.pdf is one) wrap each BT/ET block in a q...Q pair
    // so a `Tr` set inside one block must NOT leak into the next block.
}

impl TextState {
    fn new() -> Self {
        TextState {
            font_size: 12.0,
            horizontal_scaling: 1.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            leading: 0.0,
            rise: 0.0,
            tm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            tlm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            in_text: false,
            current_font_name: String::new(),
        }
    }

    /// BT operator: reset text matrices to identity
    fn begin_text(&mut self) {
        self.tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.in_text = true;
    }

    /// Td operator: move to start of next line.
    /// PDF spec: Tlm = [1 0 0 1 tx ty] × Tlm; Tm = Tlm
    fn translate_line(&mut self, tx: f32, ty: f32) {
        let new_e = tx * self.tlm[0] + ty * self.tlm[2] + self.tlm[4];
        let new_f = tx * self.tlm[1] + ty * self.tlm[3] + self.tlm[5];
        self.tlm[4] = new_e;
        self.tlm[5] = new_f;
        self.tm = self.tlm;
    }

    /// Tm operator: set text matrix and line matrix directly
    fn set_text_matrix(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        self.tm = [a, b, c, d, e, f];
        self.tlm = self.tm;
    }

    /// Advance for TJ kerning: adjust = -(kern/1000) × Tfs × Th
    fn apply_tj_kern(&mut self, kern: f32) {
        let tx = -(kern / 1000.0) * self.font_size * self.horizontal_scaling;
        self.tm[4] += tx * self.tm[0];
        self.tm[5] += tx * self.tm[1];
    }

    /// Get the effective text position including rise offset.
    /// Trm position = (Trise × Tm[2] + Tm[4], Trise × Tm[3] + Tm[5])
    fn render_x(&self) -> f32 {
        self.rise * self.tm[2] + self.tm[4]
    }

    fn render_y(&self) -> f32 {
        self.rise * self.tm[3] + self.tm[5]
    }
}

/// A decoded RGBA buffer for an Image XObject, sized to the chosen output
/// resolution (after JPEG scale-DCT or box downsample). Wrapped in Arc so
/// the per-page cache can hand back the same pixels for repeated /Do refs
/// without copying.
#[derive(Clone)]
pub(crate) struct CachedDecodedImage {
    w: u32,
    h: u32,
    rgba: std::sync::Arc<Vec<u8>>,
}

impl CachedDecodedImage {
    /// PoC 02 diagnostic — total RGBA byte count (size, not Arc refcount).
    pub(crate) fn rgba_len(&self) -> usize {
        self.rgba.len()
    }
}

/// Per-page cache for decoded image XObjects, keyed by lopdf::ObjectId.
/// Speed iter-24: tiled-photo-grid PDFs (Zware vector PDF p2-p6) reference
/// the same XObject up to 68 times each — caching the post-decode RGBA
/// buffer means we pay the JPEG-decode + SMask-premul cost ONCE per unique
/// image instead of per /Do reference. The cache is dropped at the end of
/// each render_page invocation so per-page memory stays bounded by the
/// distinct-image count (~60 unique on the worst page).
pub(crate) type ImageCache = std::collections::HashMap<lopdf::ObjectId, CachedDecodedImage>;

pub struct Interpreter;

/// Bovengrens voor de draw-command buffer die `extract_commands_with_text`
/// opbouwt (in-lus piek-cap). Normale vector-bladen leveren enkele MB's;
/// pathologische CAD-bladen (miljoenen path-ops, vaak verstopt in Form-XObjects
/// met een piepkleine page-content-stream) liepen ongelimiteerd op tot >1,6 GB
/// en veroorzaakten een heap-corruptie-crash in het hoofdproces bij het openen.
/// Deze cap stopt de groei; de aanroeper (`parser::extract_draw_commands`)
/// weigert de te grote buffer daarna via `EXTRACT_DRAW_COMMANDS_SHIP_LIMIT` en
/// valt terug op het PDFium-rasterpad. 128 MB is ruim boven elk legitiem blad
/// (die zijn enkele MB's) en houdt de piek per extractie laag.
pub const EXTRACT_DRAW_COMMANDS_BUDGET_BYTES: usize = 128 * 1024 * 1024;

/// Weiger-grens: een draw-command buffer groter dan dit gaat NIET naar de
/// webview (JS-replay). Zulke bladen zijn te complex voor JS-replay (de buffer
/// zelf + de replay zouden het webview-geheugen vullen tot vastlopen) en horen
/// op het PDFium-rasterpad. Ligt onder de in-lus-cap zodat elk blad dat de cap
/// raakte hier gegarandeerd wordt afgewezen.
pub const EXTRACT_DRAW_COMMANDS_SHIP_LIMIT: usize = 96 * 1024 * 1024;

impl Interpreter {
    /// Execute content stream, rendering all content including full-resolution images.
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, font_registry, 0, doc_image_cache)
    }

    /// Execute content stream with a pixel budget for images. Images larger
    /// than `max_pixels` are downsampled after decode. Use for thumbnails
    /// to keep rendering fast without skipping images entirely.
    pub fn execute_with_image_limit(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_pixels: u32,
        doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, font_registry, max_pixels, doc_image_cache)
    }

    fn execute_internal(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_image_pixels: u32,
        doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>,
    ) -> Result<(), RenderError> {
        let prof = profile_enabled();
        if prof { profile_reset(); }
        // Per-page decoded-image cache. See `ImageCache` doc.
        //
        // PoC 02: if the caller supplied a document-scoped cache, seed the
        // per-render cache with its entries (read-lock for a single
        // collection-iter + Arc-clone of each `CachedDecodedImage`). The
        // predecode pass below skips any image whose ObjectId is already in
        // the local cache, so this seed turns repeat visits into a no-op
        // for the decode path — only the cheap drawing work remains. The
        // read lock is released before any heavy work runs.
        let mut img_cache: ImageCache = std::collections::HashMap::new();
        if let Some(doc_cache) = doc_image_cache {
            if let Ok(guard) = doc_cache.read() {
                img_cache.reserve(guard.len());
                for (k, v) in guard.iter() {
                    img_cache.insert(*k, v.clone());
                }
            }
        }
        // ─── iter-25: parallel image pre-decode ──────────────────────────
        // Walk the operations to find Image XObject references made by this
        // content stream's `Do` operators, then decode them in parallel via
        // rayon and seed the per-page cache. The serial walk below then
        // hits the cache for every /Do — making decode wall-time roughly
        // (slowest_image_ms) instead of (sum_of_all_decode_ms).
        //
        // Targets pages like Barn Relocation p3/p5 (14 unique large
        // FlateDecode + PNG-predictor images per page) where iter-24's
        // dedup cache was a no-op (each image referenced exactly once).
        Self::predecode_images_parallel(content_bytes, doc, resources, max_image_pixels, &mut img_cache);

        let mut has_active_path = false;
        let mut text_state = TextState::new();
        // Per-render glyph path cache. Speed iter-23: each text-show op
        // (Tj/TJ) used to build a fresh tiny-skia Path from the cached
        // OutlineCommands for every glyph instance — for Zware vector PDF
        // p3/p5 (387 Tj × ~30 chars ≈ 12k glyph fills per page) this was
        // the largest single chunk of CPU. Caching the tiny-skia Path by
        // (font_object_id, glyph_id) cuts the per-page render time on
        // text-heavy pages by 50-65%. The cache is dropped at end of
        // page render so per-render lifetimes stay tight.
        let mut glyph_path_cache: std::collections::HashMap<(lopdf::ObjectId, u32), tiny_skia::Path>
            = std::collections::HashMap::new();
        // PDF clipping is two-step: `W` (or `W*`) marks the current path
        // as a future clip, then the next path-painting/no-op operator
        // (S/s/f/f*/B/B*/b/b*/n) actually consumes the path. We track the
        // pending state with this Option<even_odd_flag>; the snapshot is
        // applied to the GraphicsState clip mask just before the paint
        // operator takes the path builder. The path itself is still
        // consumed by the paint op via path_builder.take().
        let mut pending_clip: Option<bool> = None;

        // Streamende lexer i.p.v. Content::decode: de volledige Vec<Operation>
        // van een 5M-ops CAD-blad kostte gigabytes aan kleine allocaties;
        // deze lus hergebruikt één Operation-buffer per stap.
        let mut op_stream = crate::content_stream::ContentStreamIter::new(content_bytes);
        let mut op_buf = lopdf::content::Operation { operator: String::new(), operands: Vec::new() };
        while op_stream.next_into(&mut op_buf) {
            let op = &op_buf;
            // If a W/W* was just seen, the next paint op (or n) consumes
            // the path AND uses it as the clip — snapshot it now before
            // the paint op takes the builder.
            if pending_clip.is_some() {
                let is_paint_or_noop = matches!(
                    op.operator.as_str(),
                    "S" | "s" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*" | "n"
                );
                if is_paint_or_noop {
                    if let Some(path) = renderer.snapshot_path() {
                        let even_odd = pending_clip.unwrap();
                        renderer.apply_clip(&mut state.current, &path, even_odd);
                    }
                    pending_clip = None;
                }
            }
            match op.operator.as_str() {
                // Graphics state
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "w" => { if let Some(w) = op.operands.first() { state.current.line_width = Self::f(w); } }
                "J" => { if let Some(v) = op.operands.first() { state.current.line_cap = Self::i(v) as u8; } }
                "j" => { if let Some(v) = op.operands.first() { state.current.line_join = Self::i(v) as u8; } }
                "M" => { if let Some(v) = op.operands.first() { state.current.miter_limit = Self::f(v); } }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                    }
                }
                // Color - grayscale
                "g" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.fill_color = (r,g,b,255); } }
                "G" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.stroke_color = (r,g,b,255); } }
                // Color - RGB
                "rg" => { if op.operands.len() >= 3 { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                "RG" => { if op.operands.len() >= 3 { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                // Color - CMYK
                "k" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); } }
                "K" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); } }
                // Color - colorspace operators (simplified)
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.fill_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.stroke_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "l" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "c" => { if op.operands.len() >= 6 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[4]), Self::f(&op.operands[5])); } }
                "v" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "y" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "re" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.rect(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "h" => { renderer.close_path(); }
                // Path painting
                "S" => { renderer.stroke(&state.current); has_active_path = false; }
                "s" => { renderer.close_path(); renderer.stroke(&state.current); has_active_path = false; }
                "f" | "F" => { renderer.fill(&state.current, false); has_active_path = false; }
                "f*" => { renderer.fill(&state.current, true); has_active_path = false; }
                "B" => { renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "B*" => { renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "b" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "b*" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "n" => { has_active_path = false; }
                // Clipping — record the pending clip; the path is captured
                // and applied to gs.clip_path immediately before the next
                // paint/no-op operator consumes the path builder.
                "W" => { pending_clip = Some(false); }
                "W*" => { pending_clip = Some(true); }
                // Text operators
                "BT" => { text_state.begin_text(); }
                "ET" => { text_state.in_text = false; }
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name = String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "Tc" => { if let Some(v) = op.operands.first() { text_state.char_spacing = Self::f(v); } }
                "Tw" => { if let Some(v) = op.operands.first() { text_state.word_spacing = Self::f(v); } }
                "Tz" => { if let Some(v) = op.operands.first() { text_state.horizontal_scaling = Self::f(v) / 100.0; } }
                "TL" => { if let Some(v) = op.operands.first() { text_state.leading = Self::f(v); } }
                "Ts" => { if let Some(v) = op.operands.first() { text_state.rise = Self::f(v); } }
                "Tr" => {
                    // PDF 1.7 §9.3.6 — text rendering mode. Mode 2 ("fill,
                    // then stroke") is the standard authoring trick for
                    // synthetic bold text using a single Regular font: the
                    // glyph outline is filled normally, then the same path
                    // is stroked at the current line width (set by `w`).
                    // Stored on graphics state so q/Q properly restore the
                    // mode at the end of a wrapping `q...BT...ET...Q` block
                    // (see TextState comment).
                    if let Some(v) = op.operands.first() {
                        let m = Self::f(v) as i32;
                        state.current.text_render_mode = m.clamp(0, 7) as u8;
                    }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.translate_line(tx, ty);
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => { text_state.translate_line(0.0, -text_state.leading); }
                "Tj" => {
                    Self::execute_show_string(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources, &mut glyph_path_cache,
                    );
                }
                "TJ" => {
                    Self::execute_show_array(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources, &mut glyph_path_cache,
                    );
                }
                "'" => {
                    text_state.translate_line(0.0, -text_state.leading);
                    Self::execute_show_string(
                        &op.operands, &mut text_state, font_registry,
                        renderer, state, doc, resources, &mut glyph_path_cache,
                    );
                }
                "\"" => {
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        let tail = &op.operands[2..];
                        Self::execute_show_string(
                            tail, &mut text_state, font_registry,
                            renderer, state, doc, resources, &mut glyph_path_cache,
                        );
                    }
                }
                "Do" => {
                    Self::handle_do_execute(&op.operands, renderer, state, doc, resources, font_registry, max_image_pixels, &mut img_cache, doc_image_cache);
                }
                "gs" => {
                    Self::apply_ext_gstate(&op.operands, state, doc, resources);
                }
                "ri" | "i" => {}
                _ => {}
            }
        }
        if prof {
            profile_dump();
            if let Some(m) = PROF_SEEN_XOBJ.get() {
                if let Ok(g) = m.lock() {
                    profile_dump_uniq(&g);
                }
            }
        }
        // PoC 02: merge newly-decoded images back into the document cache.
        // Insert-if-absent — never overwrite an existing entry. If two
        // renders raced for the same image, both produced byte-equivalent
        // buffers; we keep whichever landed first and drop the duplicate.
        // The seed read at function entry put every doc-cache entry into
        // the local cache, so `len() > 0` doesn't mean we have new entries
        // — we still need to walk and skip-on-present.
        if let Some(doc_cache) = doc_image_cache {
            if !img_cache.is_empty() {
                if let Ok(mut guard) = doc_cache.write() {
                    for (k, v) in img_cache.iter() {
                        guard.entry(*k).or_insert_with(|| v.clone());
                    }
                }
            }
        }
        Ok(())
    }

    fn handle_do_execute(
        operands: &[Object],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut FontRegistry,
        max_image_pixels: u32,
        img_cache: &mut ImageCache,
        doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
        if subtype == Some(b"Image" as &[u8]) {
            if profile_enabled() {
                let m = PROF_SEEN_XOBJ.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
                if let Ok(mut g) = m.lock() {
                    *g.entry(resolved_id).or_insert(0) += 1;
                }
            }
            Self::handle_image_execute(stream, renderer, state, doc, max_image_pixels, resolved_id, img_cache);
            return;
        }
        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        // Detect transparency group BEFORE saving graphics state — we need
        // the parent's effective alpha at the moment of the `Do` operator
        // to use as the composite opacity when blending the offscreen
        // group buffer back onto the parent.
        let is_transparency_group = stream.dict.get(b"Group")
            .ok()
            .and_then(|g| Self::resolve_dict(g, doc).ok())
            .and_then(|d| d.get(b"S").ok())
            .and_then(|s| s.as_name().ok())
            == Some(b"Transparency" as &[u8]);

        // Capture the parent's effective non-stroking alpha for use as
        // the group composite opacity. PDF spec §11.6.6: the transparency
        // group is rendered into its own isolated backdrop and then
        // composited onto the parent using the /ca (non-stroking) alpha
        // that was active at the point of the `Do` operator. /CA does
        // NOT scale a Form-XObject `Do` result.
        let parent_fill_alpha = state.current.effective_fill_alpha();

        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    state.concat_matrix(
                        Self::f(&arr[0]), Self::f(&arr[1]),
                        Self::f(&arr[2]), Self::f(&arr[3]),
                        Self::f(&arr[4]), Self::f(&arr[5]),
                    );
                }
            }
        }
        // PDF 8.10.2: a Form XObject's content is implicitly clipped to the
        // rectangle in /BBox (in the form's own coordinate space, after the
        // form's /Matrix has been applied). Without this clip, oversized
        // contents (e.g. an image positioned outside the bbox) bleed onto
        // the parent canvas — visible in the 2885 demo as a missing/over-
        // painted hero image and as red anti-aliasing fringes around form-
        // local backgrounds.
        if let Some((x0, y0, x1, y1)) = Self::extract_form_bbox(&stream.dict) {
            use tiny_skia::PathBuilder;
            let mut pb = PathBuilder::new();
            pb.move_to(x0, y0);
            pb.line_to(x1, y0);
            pb.line_to(x1, y1);
            pb.line_to(x0, y1);
            pb.close();
            if let Some(path) = pb.finish() {
                renderer.apply_clip(&mut state.current, &path, false);
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);

        if is_transparency_group {
            // Off-screen group buffer (PDF spec §11.4.5 + §11.6.6).
            //
            // Allocate a fresh transparent buffer of the same pixel
            // dimensions as the parent. The form's content stream is
            // executed against this buffer; once finished, the buffer is
            // composited onto the parent with `parent_fill_alpha` as the
            // SourceOver opacity. The same-size choice keeps the inherited
            // CTM and clip mask coordinates valid without remapping.
            //
            // Inside the group we MUST reset both `fill_alpha` and
            // `group_fill_alpha` to 1.0 so internal compositions accumulate
            // against the transparent backdrop at full opacity — the parent
            // alpha is applied ONCE during the final composite. Doing it
            // twice (here and during composite) is the bug iter-2's
            // single-pixmap approach embodied, which produced the +1
            // brightness shift visible on 2885 p7/p8/p13.
            let cur = &mut state.current;
            cur.fill_alpha = 1.0;
            cur.stroke_alpha = 1.0;
            cur.group_fill_alpha = 1.0;
            cur.group_stroke_alpha = 1.0;

            // Allocate the offscreen renderer. If allocation fails (e.g.
            // out-of-memory for an extreme page), fall back to the parent
            // canvas — slightly wrong but still produces output.
            match renderer.new_offscreen_like() {
                Ok(mut sub_renderer) => {
                    if let Ok(content_bytes) = stream.decompressed_content() {
                        let _ = Self::execute_internal(
                            &content_bytes,
                            &mut sub_renderer,
                            state,
                            doc,
                            res,
                            font_registry,
                            max_image_pixels,
                            doc_image_cache,
                        );
                    }
                    // Composite the group buffer onto the parent using
                    // the parent's /ca (non-stroking alpha). PDF spec
                    // §11.6.6 governs Form XObject (image-like) `Do`
                    // composition with the non-stroking alpha — /CA is
                    // for stroke ops only and does NOT scale a `Do`
                    // result. The /ca that was active when the `Do` was
                    // reached is exactly what pyMuPDF / muPDF apply.
                    let composite_alpha = parent_fill_alpha;
                    renderer.composite_group(&sub_renderer, composite_alpha);
                }
                Err(_) => {
                    // Fallback: paint into the parent directly, using the
                    // legacy iter-2 alpha-folding approximation. Better
                    // than dropping content entirely.
                    let cur = &mut state.current;
                    cur.group_fill_alpha = parent_fill_alpha;
                    cur.group_stroke_alpha = parent_fill_alpha;
                    if let Ok(content_bytes) = stream.decompressed_content() {
                        let _ = Self::execute_internal(
                            &content_bytes, renderer, state, doc, res,
                            font_registry, max_image_pixels, doc_image_cache,
                        );
                    }
                }
            }
        } else {
            if let Ok(content_bytes) = stream.decompressed_content() {
                let _ = Self::execute_internal(
                    &content_bytes, renderer, state, doc, res,
                    font_registry, max_image_pixels, doc_image_cache,
                );
            }
        }
        state.restore();
    }

    /// Server-side text-show for the Tj operator. Resolves the current font
    /// through the FontRegistry, then dispatches to the simple- or
    /// CID-text path in `text_renderer`. Honours the current text rendering
    /// mode (`text_state.render_mode`), which is set by the `Tr` operator.
    /// Mode 2 ("fill, then stroke") is the standard PDF authoring trick for
    /// synthetic bold text; without it, headings authored as Tr=2 with a
    /// thin line width appear too light in the rendered output.
    fn execute_show_string(
        operands: &[Object],
        text_state: &mut TextState,
        font_registry: &mut FontRegistry,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        glyph_cache: &mut crate::text_renderer::GlyphPathCache,
    ) {
        let bytes = match operands.first() {
            Some(Object::String(b, _)) if !b.is_empty() => b.clone(),
            _ => return,
        };
        let (font_id_opt, font_entry) = match font_registry.get_font_with_id(&text_state.current_font_name, doc, resources) {
            Some(fe) => fe,
            None => return,
        };
        if font_entry.parsed.is_none() { return; }
        let fill = state.current.fill_color;
        let mode = state.current.text_render_mode;
        let cache_arg = font_id_opt.map(|id| (id, &mut *glyph_cache));
        if font_entry.is_cid {
            crate::text_renderer::render_cid_text_glyphs_skia_with_mode(
                &bytes, &*font_entry, text_state.font_size,
                text_state.horizontal_scaling, text_state.char_spacing,
                text_state.word_spacing, text_state.rise,
                &mut text_state.tm, fill, renderer, state, cache_arg, mode,
            );
        } else {
            crate::text_renderer::render_text_glyphs_skia_with_mode(
                &bytes, &*font_entry, text_state.font_size,
                text_state.horizontal_scaling, text_state.char_spacing,
                text_state.word_spacing, text_state.rise,
                &mut text_state.tm, fill, renderer, state, cache_arg, mode,
            );
        }
    }

    /// Server-side text-show for the TJ operator. Walks the array, calling
    /// the simple- or CID-glyph painter for every string and applying kern
    /// adjustments for every numeric entry. Honours `text_state.render_mode`
    /// (see `execute_show_string`).
    fn execute_show_array(
        operands: &[Object],
        text_state: &mut TextState,
        font_registry: &mut FontRegistry,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        glyph_cache: &mut crate::text_renderer::GlyphPathCache,
    ) {
        let arr = match operands.first() {
            Some(Object::Array(a)) => a,
            _ => return,
        };
        let (font_id_opt, font_entry) = match font_registry.get_font_with_id(&text_state.current_font_name, doc, resources) {
            Some(fe) => fe,
            None => return,
        };
        if font_entry.parsed.is_none() { return; }
        let is_cid = font_entry.is_cid;
        let fill = state.current.fill_color;
        let mode = state.current.text_render_mode;

        for item in arr {
            match item {
                Object::String(bytes, _) => {
                    if !bytes.is_empty() {
                        let cache_arg = font_id_opt.map(|id| (id, &mut *glyph_cache));
                        if is_cid {
                            crate::text_renderer::render_cid_text_glyphs_skia_with_mode(
                                bytes, &*font_entry, text_state.font_size,
                                text_state.horizontal_scaling, text_state.char_spacing,
                                text_state.word_spacing, text_state.rise,
                                &mut text_state.tm, fill, renderer, state, cache_arg, mode,
                            );
                        } else {
                            crate::text_renderer::render_text_glyphs_skia_with_mode(
                                bytes, &*font_entry, text_state.font_size,
                                text_state.horizontal_scaling, text_state.char_spacing,
                                text_state.word_spacing, text_state.rise,
                                &mut text_state.tm, fill, renderer, state, cache_arg, mode,
                            );
                        }
                    }
                }
                Object::Integer(_) | Object::Real(_) => {
                    text_state.apply_tj_kern(Self::f(item));
                }
                _ => {}
            }
        }
    }

    /// Decode and draw an image XObject. When `max_decode_pixels > 0`,
    /// JPEGs are decoded at reduced resolution via turbojpeg's native
    /// scaled DCT decoding (1/2, 1/4, or 1/8) — this is done during the
    /// decode itself, avoiding full-resolution decode entirely. Non-JPEG
    /// images are decoded at full resolution then box-filtered down.
    fn handle_image_execute(
        stream: &lopdf::Stream,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        max_decode_pixels: u32,
        xobj_id: lopdf::ObjectId,
        img_cache: &mut ImageCache,
    ) {
        let prof = profile_enabled();

        // ─── Cache lookup ────────────────────────────────────────────────
        // Speed iter-24: tiled photo-grid PDFs reuse the same XObject many
        // times per page (Zware vector PDF p5 has 171 /Do refs against just
        // 61 unique image XObjects). Decoded RGBA buffers are stored in
        // Arc<Vec<u8>> so the second-and-subsequent paint of the same
        // XObject is a free clone of the Arc handle — no JPEG re-decode,
        // no SMask premul, no allocation.
        //
        // Speed iter-25: Image XObjects referenced from this page (incl.
        // unique ones — Barn Relocation has 14 unique images per page) are
        // pre-decoded in parallel via rayon BEFORE this serial walk runs,
        // so the cache is already warm here for most images.
        if let Some(cached) = img_cache.get(&xobj_id) {
            let t_draw = if prof { Some(std::time::Instant::now()) } else { None };
            state.save();
            state.concat_matrix(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
            renderer.draw_image(cached.w, cached.h, cached.rgba.as_slice(), &state.current);
            state.restore();
            if let Some(t) = t_draw {
                PROF_DRAW_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
                PROF_IMG_COUNT.fetch_add(1, Ordering::Relaxed);
            }
            return;
        }

        // Cache miss (image not seen by the parallel pre-pass — e.g. a
        // form XObject's nested image stream that the pre-pass didn't
        // enumerate). Fall back to serial decode.
        let decoded = match Self::decode_image_xobject(stream, doc, max_decode_pixels) {
            Some(d) => d,
            None => return,
        };
        let CachedDecodedImage { w: img_w, h: img_h, rgba: rgba_arc } = decoded;
        img_cache.insert(xobj_id, CachedDecodedImage { w: img_w, h: img_h, rgba: rgba_arc.clone() });

        let t_draw = if prof { Some(std::time::Instant::now()) } else { None };
        state.save();
        state.concat_matrix(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
        renderer.draw_image(img_w, img_h, rgba_arc.as_slice(), &state.current);
        state.restore();
        if let Some(t) = t_draw {
            PROF_DRAW_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
            PROF_IMG_COUNT.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// iter-25: Walk the content stream's `Do` operations, collect every
    /// Image XObject ID referenced from the given resources dictionary, and
    /// decode them in parallel via rayon. Decoded buffers are inserted into
    /// `img_cache` so the subsequent serial walk pays draw-only cost per /Do.
    ///
    /// Form XObject `Do` references are NOT followed here — those execute
    /// recursively in `handle_do_execute` and trigger their own pre-pass
    /// against the form's own resources dict. So images embedded inside a
    /// Form XObject are pre-decoded by the recursive pre-pass when the Form
    /// itself executes.
    fn predecode_images_parallel(
        content_bytes: &[u8],
        doc: &Document,
        resources: &Dictionary,
        max_image_pixels: u32,
        img_cache: &mut ImageCache,
    ) {
        use rayon::prelude::*;

        // Resolve the resources XObject sub-dictionary once (may be missing
        // — e.g. text-only form streams). Tolerate failure silently — the
        // serial walk will still call handle_do_execute and any cache miss
        // simply falls through to the serial decode path.
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };

        // Pass 1 — collect unique Image XObject ObjectIds referenced via Do.
        // Names appearing >1× resolve to the same ID and are deduplicated by
        // the HashSet check.
        let mut seen: std::collections::HashSet<lopdf::ObjectId> = std::collections::HashSet::new();
        let mut to_decode: Vec<lopdf::ObjectId> = Vec::new();
        let mut op_stream = crate::content_stream::ContentStreamIter::new(content_bytes);
        let mut op_buf = lopdf::content::Operation { operator: String::new(), operands: Vec::new() };
        while op_stream.next_into(&mut op_buf) {
            let op = &op_buf;
            if op.operator.as_str() != "Do" { continue; }
            let name = match op.operands.first() {
                Some(Object::Name(n)) => n,
                _ => continue,
            };
            let obj_ref = match xobj_dict.get(name.as_slice()) {
                Ok(o) => o,
                _ => continue,
            };
            let resolved_id = match obj_ref {
                Object::Reference(id) => *id,
                _ => continue,
            };
            // Already cached? Already queued? Skip.
            if img_cache.contains_key(&resolved_id) || !seen.insert(resolved_id) {
                continue;
            }
            // Confirm subtype is Image — Form XObjects are handled by the
            // recursive walk, not pre-decoded here.
            let is_image = doc.get_object(resolved_id).ok()
                .and_then(|o| if let Object::Stream(s) = o { Some(s) } else { None })
                .and_then(|s| s.dict.get(b"Subtype").ok().and_then(|x| x.as_name().ok()).map(|n| n.to_vec()))
                == Some(b"Image".to_vec());
            if is_image {
                to_decode.push(resolved_id);
            }
        }

        // Skip the rayon overhead for trivial work (single image or empty).
        if to_decode.len() < 2 {
            for id in to_decode {
                if let Ok(Object::Stream(s)) = doc.get_object(id) {
                    if let Some(decoded) = Self::decode_image_xobject(s, doc, max_image_pixels) {
                        img_cache.insert(id, decoded);
                    }
                }
            }
            return;
        }

        // Pass 2 — parallel decode. Each task reads its own stream from the
        // shared &Document (lopdf::Document is Sync, get_object is read-only
        // index lookup) and produces a CachedDecodedImage value to be moved
        // into the cache after the join.
        let decoded_pairs: Vec<(lopdf::ObjectId, CachedDecodedImage)> = to_decode
            .par_iter()
            .filter_map(|&id| {
                let stream = match doc.get_object(id).ok()? {
                    Object::Stream(s) => s,
                    _ => return None,
                };
                Self::decode_image_xobject(stream, doc, max_image_pixels)
                    .map(|d| (id, d))
            })
            .collect();

        for (id, decoded) in decoded_pairs {
            img_cache.insert(id, decoded);
        }
    }

    /// Decode an Image XObject stream into a CachedDecodedImage.
    ///
    /// Pure function (Send + thread-safe): performs Flate/JPEG decompress,
    /// per-pixel pipeline, and SMask premul, producing the same RGBA buffer
    /// that handle_image_execute would have computed serially. Used by both
    /// the parallel pre-pass (iter-25) and the serial fallback path.
    pub(crate) fn decode_image_xobject(
        stream: &lopdf::Stream,
        doc: &Document,
        max_decode_pixels: u32,
    ) -> Option<CachedDecodedImage> {
        let prof = profile_enabled();
        let dict = &stream.dict;
        let width = Self::read_int(dict, b"Width", doc).unwrap_or(0);
        let height = Self::read_int(dict, b"Height", doc).unwrap_or(0);
        if width == 0 || height == 0 { return None; }

        let t_deref = if prof { Some(std::time::Instant::now()) } else { None };
        let filter = dict.get(b"Filter").ok().and_then(|o| match o {
            Object::Name(n) => Some(n.clone()),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Name(n) = o { Some(n.clone()) } else { None }
            }),
            Object::Array(arr) => arr.last().and_then(|o| match o {
                Object::Name(n) => Some(n.clone()),
                _ => None,
            }),
            _ => None,
        });
        if let Some(t) = t_deref {
            PROF_DEREF_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
        }
        let filter_name = filter.as_deref().unwrap_or(b"");
        let is_jpeg = filter_name == b"DCTDecode";

        // ─── JPEG: use turbojpeg with native scaled DCT decoding ─────────
        let (img_w, img_h, mut rgba) = if is_jpeg {
            let raw = &stream.content;
            let t = if prof { Some(std::time::Instant::now()) } else { None };
            let res = Self::decode_jpeg_scaled(raw, max_decode_pixels);
            if let Some(t) = t {
                PROF_JPEG_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
            }
            res?
        } else {
            // ─── Non-JPEG: raw pixel decode + optional box downsample ────
            let t = if prof { Some(std::time::Instant::now()) } else { None };
            let res = Self::decode_raw_image(dict, stream, doc, width, height, max_decode_pixels);
            if let Some(t) = t {
                PROF_RAW_DECODE_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
            }
            res?
        };

        // ─── Apply /SMask soft alpha for JPEGs ────────────────────────────
        // The non-JPEG path already bakes SMask alpha into the RGBA buffer
        // inside decode_raw_image. The JPEG decoder produces an opaque
        // (a=255) buffer so we must apply the SMask here.
        if is_jpeg {
            if let Some((sm_w, sm_h, alpha_bytes)) = Self::read_smask_alpha(dict, doc) {
                let t = if prof { Some(std::time::Instant::now()) } else { None };
                Self::premultiply_with_smask(&mut rgba, img_w, img_h, &alpha_bytes, sm_w, sm_h);
                if let Some(t) = t {
                    PROF_PREMUL_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
                }
            }
        }

        let rgba_arc = std::sync::Arc::new(rgba);
        Some(CachedDecodedImage { w: img_w, h: img_h, rgba: rgba_arc })
    }

    /// Resolve and decode an Image XObject's `/SMask` soft-alpha mask.
    /// Returns `(sm_width, sm_height, alpha_bytes)` (single byte per pixel,
    /// length = sm_width * sm_height) or `None` if no SMask is present or
    /// the mask cannot be decoded.
    ///
    /// The mask is itself an Image XObject (DeviceGray, 8 bpc) whose pixel
    /// values become the per-pixel alpha for the parent image. /Matte
    /// (un-matting against a background colour) is intentionally ignored;
    /// the silhouette alone matches PyMuPDF's edge-blending closely enough.
    fn read_smask_alpha(dict: &Dictionary, doc: &Document) -> Option<(u32, u32, Vec<u8>)> {
        let stream = match dict.get(b"SMask").ok()? {
            Object::Stream(s) => Some(s.clone()),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|obj| {
                if let Object::Stream(s) = obj { Some(s.clone()) } else { None }
            }),
            _ => None,
        }?;
        let sm_dict = &stream.dict;
        let sm_w = sm_dict.get(b"Width").ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            _ => None,
        })?;
        let sm_h = sm_dict.get(b"Height").ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            _ => None,
        })?;
        if sm_w == 0 || sm_h == 0 { return None; }

        // Identify the outermost filter — SMasks may be FlateDecode (raw
        // grayscale bytes) or DCTDecode (JPEG-encoded grayscale).
        let filters: Vec<Vec<u8>> = match sm_dict.get(b"Filter").ok() {
            Some(Object::Name(n)) => vec![n.clone()],
            Some(Object::Array(arr)) => arr.iter().filter_map(|o| match o {
                Object::Name(n) => Some(n.clone()),
                _ => None,
            }).collect(),
            _ => Vec::new(),
        };
        let outermost = filters.last().map(|v| v.as_slice()).unwrap_or(&[]);

        let needed = (sm_w as usize) * (sm_h as usize);

        if outermost == b"DCTDecode" {
            // JPEG-encoded grayscale SMask: decode the JPEG and extract
            // the gray channel. turbojpeg returns RGBA for grayscale JPEGs
            // by replicating the gray byte across R/G/B with a=255 — we
            // pull the R channel back out as the alpha source.
            let (jw, jh, rgba) = Self::decode_jpeg_scaled(&stream.content, 0)?;
            if jw != sm_w || jh != sm_h { return None; }
            if rgba.len() < needed * 4 { return None; }
            let mut out = Vec::with_capacity(needed);
            for px in 0..needed { out.push(rgba[px * 4]); }
            return Some((sm_w, sm_h, out));
        }

        // FlateDecode / no filter: decompress to raw grayscale bytes.
        let bytes = Self::decompress_image_stream(&stream)?;
        if bytes.len() < needed { return None; }
        Some((sm_w, sm_h, bytes[..needed].to_vec()))
    }

    /// Apply per-pixel SMask alpha to an opaque RGBA buffer, premultiplying
    /// R/G/B by the alpha (tiny-skia requires premultiplied input).
    /// When the image was downsampled (img_w != sm_w), the mask is
    /// nearest-neighbour resampled onto the image grid.
    ///
    /// PyMuPDF/MuPDF parity note: when the SMask is "dimming-only" (no real
    /// transparency, alpha values stay near 255), we treat it as a colour
    /// attenuation rather than a soft alpha. With a true alpha-comp pipeline,
    /// premultiplied (c=253, a=254) over an opaque-white canvas yields
    /// 253 + 255*(255-254)/255 = 254, but PyMuPDF effectively renders 253
    /// because its straight-output path drops alpha and exposes the
    /// premultiplied colour bytes directly. Forcing alpha=255 for high-alpha
    /// pixels keeps the straight-over-white tiny-skia composite reading the
    /// premul colour without further mixing — matching MuPDF on tiled JPEG
    /// photo grids (Zware vector PDF p0/p2/p3/p4/p5/p6, where every tile
    /// has a uniform-254 SMask used purely as a JPEG-quality dimming pass).
    /// Real cutout SMasks (with alpha values that vary down to 0 / dip below
    /// the threshold) keep the original premultiplied behaviour so soft
    /// edges and silhouettes still composite correctly.
    fn premultiply_with_smask(
        rgba: &mut [u8],
        img_w: u32,
        img_h: u32,
        smask: &[u8],
        sm_w: u32,
        sm_h: u32,
    ) {
        if img_w == 0 || img_h == 0 { return; }
        let same_dims = img_w == sm_w && img_h == sm_h;

        // Decide whether the mask is a dimming pass (all alpha values >=
        // DIMMING_THRESHOLD) or a real soft mask with cutouts. Sample the
        // mask bytes — for any pixel below the threshold, treat the whole
        // mask as a true cutout. Threshold 250 is conservative: it catches
        // the 254-uniform JPEG-quality masks while still treating any mask
        // with even a hint of real transparency (alpha < 250) as a cutout.
        //
        // Speed iter-23: this short-circuiting iter()::any scan replaced a
        // hand-rolled loop; the per-pixel hot loop below was rewritten to
        // use chunks_exact_mut(4) + branch-hoisted dimming/cutout paths so
        // the inner loop carries no per-pixel bounds checks or branches.
        // For Zware vector PDF p3/p5 (171 ~970×993 JPEG tiles each, all
        // with uniform-254 SMasks), this cut per-page render time by ~30%.
        const DIMMING_THRESHOLD: u8 = 250;
        let is_dimming_only = !smask.iter().any(|&a| a < DIMMING_THRESHOLD);

        // Inlined u8 premultiply: (c × a + 127) / 255 ≈ rounded c × (a/255).
        #[inline(always)]
        fn pm(c: u8, a: u8) -> u8 {
            ((c as u16 * a as u16 + 127) / 255) as u8
        }

        if same_dims {
            // Fast path: alpha index == pixel index. Walk the rgba buffer
            // in 4-byte chunks alongside the mask bytes — no per-pixel
            // bounds check, no per-pixel divide.
            let n = (img_w as usize) * (img_h as usize);
            // Defensively cap to whatever is actually addressable (caller is
            // expected to have allocated img_w*img_h*4 RGBA bytes and at
            // least n mask bytes, but we don't trust the contract).
            let n = n.min(rgba.len() / 4).min(smask.len());
            let rgba_slice = &mut rgba[..n * 4];
            let smask_slice = &smask[..n];
            if is_dimming_only {
                for (px, &a) in rgba_slice.chunks_exact_mut(4).zip(smask_slice) {
                    px[0] = pm(px[0], a);
                    px[1] = pm(px[1], a);
                    px[2] = pm(px[2], a);
                    px[3] = 255;
                }
            } else {
                for (px, &a) in rgba_slice.chunks_exact_mut(4).zip(smask_slice) {
                    px[0] = pm(px[0], a);
                    px[1] = pm(px[1], a);
                    px[2] = pm(px[2], a);
                    px[3] = a;
                }
            }
            return;
        }

        // Mismatched-dim path: nearest-neighbour sample the smaller mask
        // onto the image grid. Less common (the same_dims path covers the
        // hot tiled-JPEG case), so we keep the original two-loop structure
        // but still use chunks_exact_mut + per-row mask base.
        let img_w_usize = img_w as usize;
        let sm_w_usize = sm_w as usize;
        let sm_h_u64 = sm_h as u64;
        let img_h_u64 = img_h as u64;
        let sm_w_u64 = sm_w as u64;
        let img_w_u64 = img_w as u64;

        for (dy, row) in rgba.chunks_exact_mut(img_w_usize * 4).enumerate().take(img_h as usize) {
            let sy = ((dy as u64) * sm_h_u64 / img_h_u64) as usize;
            let mask_row_base = sy * sm_w_usize;
            if is_dimming_only {
                for (dx, px) in row.chunks_exact_mut(4).enumerate() {
                    let sx = ((dx as u64) * sm_w_u64 / img_w_u64) as usize;
                    let a = *smask.get(mask_row_base + sx).unwrap_or(&255);
                    px[0] = pm(px[0], a);
                    px[1] = pm(px[1], a);
                    px[2] = pm(px[2], a);
                    px[3] = 255;
                }
            } else {
                for (dx, px) in row.chunks_exact_mut(4).enumerate() {
                    let sx = ((dx as u64) * sm_w_u64 / img_w_u64) as usize;
                    let a = *smask.get(mask_row_base + sx).unwrap_or(&255);
                    px[0] = pm(px[0], a);
                    px[1] = pm(px[1], a);
                    px[2] = pm(px[2], a);
                    px[3] = a;
                }
            }
        }
    }

    /// Read an integer from a PDF dict, resolving indirect references.
    fn read_int(dict: &Dictionary, key: &[u8], doc: &Document) -> Option<u32> {
        dict.get(key).ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Integer(i) = o { Some(*i as u32) } else { None }
            }),
            _ => None,
        })
    }

    /// Decode JPEG with optional pixel-budget downscaling.
    /// Strategy:
    ///  1. Try turbojpeg with native scaled DCT decoding (fastest)
    ///  2. Fall back to `image` crate + box downsample if turbojpeg fails
    fn decode_jpeg_scaled(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        // ─── Try turbojpeg native scaled decode ──────────────────────────
        if let Some(result) = Self::try_turbojpeg(jpeg_data, max_pixels) {
            return Some(result);
        }

        // ─── Fallback: image crate + post-decode downsample ──────────────
        let img = image::load_from_memory_with_format(jpeg_data, image::ImageFormat::Jpeg).ok()?;
        let img = img.to_rgba8();
        let (w, h) = (img.width(), img.height());
        let rgba = img.into_raw();

        // Downsample if over budget
        if max_pixels > 0 && w * h > max_pixels {
            let (new_w, new_h, small) = Self::box_downsample(&rgba, w, h, max_pixels);
            return Some((new_w, new_h, small));
        }
        Some((w, h, rgba))
    }

    /// Try turbojpeg native scaled DCT decode. Returns None on any failure.
    fn try_turbojpeg(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        let mut dc = turbojpeg::Decompressor::new().ok()?;
        let header = dc.read_header(jpeg_data).ok()?;
        let full_w = header.width;
        let full_h = header.height;

        // Pick scaling factor that fits the pixel budget
        let chosen_factor = if max_pixels > 0 && (full_w * full_h) as u32 > max_pixels {
            let factors = turbojpeg::Decompressor::supported_scaling_factors();
            // factors are sorted largest-first (1/1, 7/8, 3/4, ..., 1/8)
            let mut picked = None;
            for &f in &factors {
                let sw = f.scale(full_w);
                let sh = f.scale(full_h);
                if sw > 0 && sh > 0 && (sw * sh) as u32 <= max_pixels {
                    picked = Some(f);
                    break;
                }
            }
            // If nothing fits, use the smallest
            if picked.is_none() {
                picked = factors.last().copied();
            }
            picked
        } else {
            None
        };

        if let Some(factor) = chosen_factor {
            dc.set_scaling_factor(factor).ok()?;
        }

        // Compute scaled output dimensions using the chosen factor
        let out_w = chosen_factor.map_or(full_w, |f| f.scale(full_w)).max(1);
        let out_h = chosen_factor.map_or(full_h, |f| f.scale(full_h)).max(1);

        let mut image = turbojpeg::Image {
            pixels: vec![0u8; out_w * out_h * 4],
            width: out_w,
            pitch: out_w * 4,
            height: out_h,
            format: turbojpeg::PixelFormat::RGBA,
        };

        dc.decompress(jpeg_data, image.as_deref_mut()).ok()?;
        Some((out_w as u32, out_h as u32, image.pixels))
    }

    /// Fast box-filter downsample of RGBA data to fit a pixel budget.
    fn box_downsample(rgba: &[u8], w: u32, h: u32, max_pixels: u32) -> (u32, u32, Vec<u8>) {
        let ratio = (max_pixels as f64 / (w as f64 * h as f64)).sqrt();
        let nw = ((w as f64 * ratio).ceil() as u32).max(1);
        let nh = ((h as f64 * ratio).ceil() as u32).max(1);
        let sx = w as f64 / nw as f64;
        let sy = h as f64 / nh as f64;
        let mut small = Vec::with_capacity((nw * nh * 4) as usize);
        for dy in 0..nh {
            for dx in 0..nw {
                let src_x = (dx as f64 * sx) as usize;
                let src_y = (dy as f64 * sy) as usize;
                let idx = (src_y * w as usize + src_x) * 4;
                if idx + 3 < rgba.len() {
                    small.extend_from_slice(&rgba[idx..idx + 4]);
                } else {
                    small.extend_from_slice(&[0, 0, 0, 255]);
                }
            }
        }
        (nw, nh, small)
    }

    /// Resolve an Image XObject's `/ColorSpace` entry into per-pixel
    /// component count and (for /Indexed) the lookup palette.
    ///
    /// Returns `(components_per_pixel_in_stream, base_components, palette)`:
    ///   - `components_per_pixel_in_stream`: bytes consumed per pixel from the
    ///     decoded stream. For Indexed this is 1; for Device* it equals the
    ///     base channel count.
    ///   - `base_components`: number of channels in the OUTPUT colour after
    ///     palette lookup (3 for /Indexed /DeviceRGB, 1 for /Indexed
    ///     /DeviceGray, 4 for /Indexed /DeviceCMYK, otherwise same as
    ///     `components_per_pixel_in_stream`).
    ///   - `palette`: when `Some`, the indexed lookup table — a vector of
    ///     `(hival + 1) * base_components` bytes. Each input pixel byte is an
    ///     index into this table.
    ///
    /// Per ISO 32000-1 §8.6.6.3, /Indexed colour spaces have the form
    /// `[/Indexed base hival lookup]` where `lookup` is either a hex/literal
    /// string of `(hival+1) * N` bytes (N = base channels) or a stream.
    fn resolve_color_space(
        dict: &Dictionary,
        doc: &Document,
    ) -> (usize, usize, Option<Vec<u8>>) {
        let cs_obj = match dict.get(b"ColorSpace").ok() {
            Some(o) => o,
            None => return (3, 3, None),
        };
        // Resolve indirect reference to its target object once.
        let resolved: Object = match cs_obj {
            Object::Reference(id) => match doc.get_object(*id) {
                Ok(o) => o.clone(),
                _ => return (3, 3, None),
            },
            other => other.clone(),
        };

        match resolved {
            Object::Name(n) => {
                let comps = match n.as_slice() {
                    b"DeviceCMYK" => 4,
                    b"DeviceGray" | b"CalGray" => 1,
                    _ => 3, // DeviceRGB, CalRGB, default
                };
                (comps, comps, None)
            }
            Object::Array(arr) => {
                let head = arr.first().and_then(|o| {
                    if let Object::Name(n) = o {
                        Some(n.clone())
                    } else {
                        None
                    }
                });
                match head.as_deref() {
                    Some(b"Indexed") => {
                        // [/Indexed base hival lookup]
                        // Determine base channel count.
                        let base = arr.get(1).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        });
                        let base_components: usize = match base {
                            Some(Object::Name(n)) => match n.as_slice() {
                                b"DeviceCMYK" => 4,
                                b"DeviceGray" | b"CalGray" => 1,
                                _ => 3,
                            },
                            Some(Object::Array(ref ba)) => {
                                // e.g. [/CalRGB <<...>>] or [/ICCBased N]
                                ba.first().and_then(|o| match o {
                                    Object::Name(bn) => Some(match bn.as_slice() {
                                        b"DeviceCMYK" | b"CalCMYK" => 4,
                                        b"DeviceGray" | b"CalGray" => 1,
                                        _ => 3,
                                    }),
                                    _ => None,
                                }).unwrap_or(3)
                            }
                            _ => 3,
                        };
                        // Lookup is either Object::String(_) or Object::Stream(_)
                        let lookup = arr.get(3).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        });
                        let palette: Option<Vec<u8>> = match lookup {
                            Some(Object::String(bytes, _)) => Some(bytes),
                            Some(Object::Stream(s)) => Self::decompress_image_stream(&s),
                            _ => None,
                        };
                        // Indexed images store 1 byte (palette index) per pixel
                        // when /BitsPerComponent is 8.
                        (1, base_components, palette)
                    }
                    Some(b"CalCMYK") => (4, 4, None),
                    Some(b"DeviceCMYK") => (4, 4, None),
                    Some(b"CalGray") | Some(b"DeviceGray") => (1, 1, None),
                    Some(b"ICCBased") => {
                        // [/ICCBased <stream>] — read /N from the stream dict.
                        let n_chans = arr.get(1).cloned().and_then(|o| match o {
                            Object::Reference(id) => doc.get_object(id).ok().cloned(),
                            other => Some(other),
                        }).and_then(|o| match o {
                            Object::Stream(s) => s.dict.get(b"N").ok().and_then(|n| {
                                if let Object::Integer(i) = n { Some(*i as usize) } else { None }
                            }),
                            _ => None,
                        }).unwrap_or(3);
                        (n_chans, n_chans, None)
                    }
                    _ => (3, 3, None),
                }
            }
            _ => (3, 3, None),
        }
    }

    /// Decode a non-JPEG image (raw/deflated pixel data) with optional
    /// box-filter downsampling when exceeding the pixel budget.
    fn decode_raw_image(
        dict: &Dictionary,
        stream: &lopdf::Stream,
        doc: &Document,
        width: u32,
        height: u32,
        max_pixels: u32,
    ) -> Option<(u32, u32, Vec<u8>)> {
        let bits = dict.get(b"BitsPerComponent").ok()
            .and_then(|o| if let Object::Integer(i) = o { Some(*i as u8) } else { None })
            .unwrap_or(8);
        if bits != 8 { return None; }

        // Resolve colour space — either direct (DeviceRGB/Gray/CMYK) or an
        // [/Indexed base hival lookup] palette wrapper.
        let (stream_components, output_components, palette) =
            Self::resolve_color_space(dict, doc);
        let components: usize = output_components;

        // lopdf 0.34's decompressed_content() returns Err(Type) for /Image
        // streams, so we go through our own decompress_image_stream helper
        // (handles FlateDecode + PNG predictor, raw passthrough otherwise).
        let raw_pixels = Self::decompress_image_stream(stream)?;
        let expected = width as usize * height as usize * stream_components;
        if raw_pixels.len() < expected { return None; }

        // Resolve and decode an /SMask soft-alpha mask if present. We only
        // honour the mask when it's the same resolution as the image —
        // mismatched-dim resampling is left to read_smask_alpha's callers
        // that need it (e.g. JPEG-decoded paths that may downsample).
        // /Matte (un-matting against a background colour) is intentionally
        // ignored for now; the silhouette alone fixes the bulk of the
        // black-rectangle artefact on rapport-constructie / Text pdf
        // gecombineerd PDFs.
        let smask_alpha: Option<Vec<u8>> = Self::read_smask_alpha(dict, doc)
            .and_then(|(sm_w, sm_h, bytes)| {
                if sm_w == width && sm_h == height { Some(bytes) } else { None }
            });

        // Determine output size — downsample if over budget
        let (out_w, out_h, step_x, step_y) = if max_pixels > 0 && width * height > max_pixels {
            let ratio = (max_pixels as f64 / (width as f64 * height as f64)).sqrt();
            let nw = ((width as f64 * ratio).ceil() as u32).max(1);
            let nh = ((height as f64 * ratio).ceil() as u32).max(1);
            (nw, nh, width as f64 / nw as f64, height as f64 / nh as f64)
        } else {
            (width, height, 1.0, 1.0)
        };

        // tiny-skia's `PixmapRef::from_bytes` requires PREMULTIPLIED RGBA —
        // it returns None if r/g/b > a for any pixel. Premultiply when
        // baking the per-pixel alpha so transparent regions of the SMask
        // (alpha == 0) become fully transparent black instead of being
        // rejected by the pixmap loader.
        //
        // Speed iter-26: switched from f32-per-pixel CMYK conversion
        // (4× divides + 4× multiplies + 4× casts per pixel) to integer
        // (255 - c) * (255 - k) / 255 with rounding bias. Branched
        // identity-mapping fast path (no downsample, no SMask) writes
        // directly into a pre-sized `out` buffer using chunks_exact_mut(4)
        // so the inner loop has zero bounds checks. This was the dominant
        // cost on Barn Relocation pages (14 unique CMYK images per page).
        let mut rgba: Vec<u8> = vec![0u8; (out_w as usize) * (out_h as usize) * 4];
        let downsample = step_x != 1.0 || step_y != 1.0;

        // Inlined u8 premultiply: rounded c × (a/255).
        #[inline(always)]
        fn pm(c: u8, a: u8) -> u8 {
            ((c as u16 * a as u16 + 127) / 255) as u8
        }
        // Integer CMYK → RGB with rounding bias, equivalent to:
        //   r = (1-c)(1-k) * 255 = ((255-c)(255-k) + 127) / 255
        // Rounding bias guarantees parity with the f32 path within ±1 LSB.
        #[inline(always)]
        fn cmyk_r(c: u8, k: u8) -> u8 {
            (((255 - c) as u16 * (255 - k) as u16 + 127) / 255) as u8
        }

        if !downsample && palette.is_none() {
            // Identity-mapping fast path: src pixel index == dst pixel index.
            let n_pixels = (out_w as usize) * (out_h as usize);
            let alpha_bytes = smask_alpha.as_deref();
            let chunks = rgba.chunks_exact_mut(4);
            match components {
                1 => {
                    if let Some(amask) = alpha_bytes {
                        for ((px, &g), &a) in chunks
                            .zip(raw_pixels.iter().take(n_pixels))
                            .zip(amask.iter().take(n_pixels))
                        {
                            let g2 = pm(g, a);
                            px[0] = g2; px[1] = g2; px[2] = g2; px[3] = a;
                        }
                    } else {
                        for (px, &g) in chunks.zip(raw_pixels.iter().take(n_pixels)) {
                            px[0] = g; px[1] = g; px[2] = g; px[3] = 255;
                        }
                    }
                }
                3 => {
                    let src = &raw_pixels[..n_pixels * 3];
                    if let Some(amask) = alpha_bytes {
                        for (px_chunk, (src3, &a)) in chunks
                            .zip(src.chunks_exact(3).zip(amask.iter().take(n_pixels)))
                        {
                            px_chunk[0] = pm(src3[0], a);
                            px_chunk[1] = pm(src3[1], a);
                            px_chunk[2] = pm(src3[2], a);
                            px_chunk[3] = a;
                        }
                    } else {
                        for (px_chunk, src3) in chunks.zip(src.chunks_exact(3)) {
                            px_chunk[0] = src3[0];
                            px_chunk[1] = src3[1];
                            px_chunk[2] = src3[2];
                            px_chunk[3] = 255;
                        }
                    }
                }
                4 => {
                    let src = &raw_pixels[..n_pixels * 4];
                    if let Some(amask) = alpha_bytes {
                        for (px_chunk, (src4, &a)) in chunks
                            .zip(src.chunks_exact(4).zip(amask.iter().take(n_pixels)))
                        {
                            let c = src4[0]; let m = src4[1];
                            let y = src4[2]; let k = src4[3];
                            let r = cmyk_r(c, k);
                            let g = cmyk_r(m, k);
                            let b = cmyk_r(y, k);
                            px_chunk[0] = pm(r, a);
                            px_chunk[1] = pm(g, a);
                            px_chunk[2] = pm(b, a);
                            px_chunk[3] = a;
                        }
                    } else {
                        for (px_chunk, src4) in chunks.zip(src.chunks_exact(4)) {
                            let c = src4[0]; let m = src4[1];
                            let y = src4[2]; let k = src4[3];
                            px_chunk[0] = cmyk_r(c, k);
                            px_chunk[1] = cmyk_r(m, k);
                            px_chunk[2] = cmyk_r(y, k);
                            px_chunk[3] = 255;
                        }
                    }
                }
                _ => {
                    if let Some(amask) = alpha_bytes {
                        for (px, &a) in chunks.zip(amask.iter().take(n_pixels)) {
                            px[0] = 0; px[1] = 0; px[2] = 0; px[3] = a;
                        }
                    } else {
                        for px in chunks {
                            px[0] = 0; px[1] = 0; px[2] = 0; px[3] = 255;
                        }
                    }
                }
            }
            return Some((out_w, out_h, rgba));
        }

        // General path: downsampling and/or Indexed palette. Less common, but
        // needs to handle the src_x/src_y stepped sample and palette lookup.
        let stream_comp = stream_components;
        let comp_count = components;
        let mut buf: [u8; 4] = [0; 4];
        for dy in 0..out_h {
            for dx in 0..out_w {
                let src_x = (dx as f64 * step_x) as usize;
                let src_y = (dy as f64 * step_y) as usize;
                let src_idx = src_y * width as usize + src_x;
                let idx = src_idx * stream_comp;
                let alpha = smask_alpha
                    .as_ref()
                    .and_then(|a| a.get(src_idx).copied())
                    .unwrap_or(255);

                let comp_slice: &[u8] = if let Some(pal) = palette.as_ref() {
                    let pi = raw_pixels[idx] as usize;
                    let p_off = pi * comp_count;
                    if p_off + comp_count <= pal.len() {
                        for i in 0..comp_count { buf[i] = pal[p_off + i]; }
                        &buf[..comp_count]
                    } else {
                        for i in 0..comp_count { buf[i] = 0; }
                        &buf[..comp_count]
                    }
                } else {
                    &raw_pixels[idx .. idx + stream_comp]
                };

                let dst_off = ((dy as usize) * (out_w as usize) + dx as usize) * 4;
                match comp_count {
                    1 => {
                        let g2 = pm(comp_slice[0], alpha);
                        rgba[dst_off] = g2;
                        rgba[dst_off + 1] = g2;
                        rgba[dst_off + 2] = g2;
                        rgba[dst_off + 3] = alpha;
                    }
                    3 => {
                        rgba[dst_off] = pm(comp_slice[0], alpha);
                        rgba[dst_off + 1] = pm(comp_slice[1], alpha);
                        rgba[dst_off + 2] = pm(comp_slice[2], alpha);
                        rgba[dst_off + 3] = alpha;
                    }
                    4 => {
                        let c = comp_slice[0]; let m = comp_slice[1];
                        let y = comp_slice[2]; let k = comp_slice[3];
                        let r = cmyk_r(c, k);
                        let g = cmyk_r(m, k);
                        let b = cmyk_r(y, k);
                        rgba[dst_off] = pm(r, alpha);
                        rgba[dst_off + 1] = pm(g, alpha);
                        rgba[dst_off + 2] = pm(b, alpha);
                        rgba[dst_off + 3] = alpha;
                    }
                    _ => {
                        rgba[dst_off + 3] = alpha;
                    }
                }
            }
        }
        Some((out_w, out_h, rgba))
    }

    pub fn extract_commands(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        Self::extract_commands_with_text(content_bytes, buf, state, doc, resources, font_registry, None)
    }

    pub fn extract_commands_with_text(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        mut text_spans: Option<&mut Vec<TextSpan>>,
    ) -> Result<(), RenderError> {
        let mut has_active_path = false;
        let mut text_state = TextState::new();
        // Inline images (BI/ID/EI) buiten het gedekte formaat: tellen en één
        // logregel per stream — liever een gemeld gat dan een fout beeld.
        let mut inline_skipped: u64 = 0;

        // Streamende lexer i.p.v. Content::decode — zie execute_internal.
        let mut op_stream = crate::content_stream::ContentStreamIter::new(content_bytes);
        let mut op_buf = lopdf::content::Operation { operator: String::new(), operands: Vec::new() };
        while op_stream.next_into(&mut op_buf) {
            let op = &op_buf;
            // Output-budget-bewaking. Sommige "vector"-bladen hebben een piepkleine
            // content-stream (honderden bytes) die naar een Form-XObject verwijst
            // dat na afwikkeling MILJOENEN path-ops bevat (repetitief lijnwerk
            // comprimeert naar niets maar expandeert enorm). Zonder deze grens
            // groeide `buf` tot ~1,6 GB en, met de into_bytes()-kopie erbij, een
            // piek van ~3 GB in het hoofdproces → heap-corruptie en crash bij het
            // openen (page_content_size ziet die complexiteit niet, dus isHeavyPage
            // ving ze niet af). Deze check staat bovenaan de lus en vuurt daarom
            // ook in elke recursieve Form-XObject-afwikkeling. Bij overschrijding
            // stoppen we met een Err; de aanroeper valt terug op het PDFium-
            // rasterpad (dat zulke bladen tegel-voor-tegel wél aankan).
            if buf.len() > EXTRACT_DRAW_COMMANDS_BUDGET_BYTES {
                return Err(RenderError::RenderError(format!(
                    "draw-command buffer overschrijdt budget ({} MB) — pagina te complex voor vector-extractie, terugval op raster",
                    buf.len() / (1024 * 1024)
                )));
            }
            match op.operator.as_str() {
                // Graphics state
                "q" => {
                    state.save();
                    buf.save_state();
                }
                "Q" => {
                    state.restore();
                    buf.restore_state();
                }
                "cm" => {
                    if op.operands.len() >= 6 {
                        let a = Self::f(&op.operands[0]);
                        let b = Self::f(&op.operands[1]);
                        let c = Self::f(&op.operands[2]);
                        let d = Self::f(&op.operands[3]);
                        let e = Self::f(&op.operands[4]);
                        let f = Self::f(&op.operands[5]);
                        state.concat_matrix(a, b, c, d, e, f);
                        buf.transform(a, b, c, d, e, f);
                    }
                }
                "w" => {
                    if let Some(w) = op.operands.first() {
                        state.current.line_width = Self::f(w);
                    }
                }
                "J" => {
                    if let Some(v) = op.operands.first() {
                        let cap = Self::i(v) as u8;
                        state.current.line_cap = cap;
                        buf.set_line_cap(cap);
                    }
                }
                "j" => {
                    if let Some(v) = op.operands.first() {
                        let join = Self::i(v) as u8;
                        state.current.line_join = join;
                        buf.set_line_join(join);
                    }
                }
                "M" => {
                    if let Some(v) = op.operands.first() {
                        let ml = Self::f(v);
                        state.current.miter_limit = ml;
                        buf.set_miter_limit(ml);
                    }
                }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                        buf.set_dash(&state.current.dash_array, state.current.dash_phase);
                    }
                }
                // Color - grayscale
                "g" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "G" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // Color - RGB
                "rg" => {
                    if op.operands.len() >= 3 {
                        state.current.fill_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                "RG" => {
                    if op.operands.len() >= 3 {
                        state.current.stroke_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                // Color - CMYK
                "k" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "K" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // Color - colorspace operators
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => {
                            state.current.fill_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.fill_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.fill_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => {
                            state.current.stroke_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "l" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "c" => {
                    if op.operands.len() >= 6 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "v" => {
                    // v x2 y2 x3 y3: cubic bezier where first control point = current point
                    // We don't track the current point here, so we approximate by using
                    // (x2,y2) as both control points (same as the existing behavior).
                    // A perfect implementation would track the current path position.
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "y" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "re" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.rect(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "h" => {
                    buf.close_path();
                }
                // Path painting
                "S" => {
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "s" => {
                    buf.close_path();
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "f" | "F" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill();
                    has_active_path = false;
                }
                "f*" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill_even_odd();
                    has_active_path = false;
                }
                "B" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "B*" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b*" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "n" => {
                    has_active_path = false;
                }
                // Clipping — apply current path as clipping region
                "W" => {
                    buf.clip();
                }
                "W*" => {
                    buf.clip_even_odd();
                }
                // Text operators
                "BT" => {
                    text_state.begin_text();
                }
                "ET" => {
                    text_state.in_text = false;
                }
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name =
                                String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "TL" => {
                    if let Some(v) = op.operands.first() {
                        text_state.leading = Self::f(v);
                    }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.translate_line(tx, ty);
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]),
                            Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => {
                    text_state.translate_line(0.0, -text_state.leading);
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            // get_font now returns Arc<FontEntry> from a
                            // document-scoped cache. Cheap for shared fonts
                            // already seen on previous pages.
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                // Capture position before rendering for text span
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if font_entry.is_cid && font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_cid_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_cid_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                } else if font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                }
                                // No parsed font data → skip (TextAt
                                // fallback would mis-position the text).
                            }
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        let (r, g, b, a) = state.current.fill_color;
                        let rgba = Self::color_to_u32(r, g, b, a);
                        // Fetch the font ONCE for the whole TJ array — Arc
                        // makes it trivial to hold across the loop instead
                        // of re-fetching per string like the old code did.
                        let font_entry_opt = font_registry.get_font(
                            &text_state.current_font_name, doc, resources,
                        );
                        if let Some(font_entry) = font_entry_opt {
                            if font_entry.parsed.is_some() {
                                let is_cid = font_entry.is_cid;
                                // For TJ arrays, collect all string parts into one span per run
                                let collecting = text_spans.is_some();
                                let mut run_text = if collecting { String::new() } else { String::new() };
                                let run_start_x = text_state.render_x();
                                let run_start_y = text_state.render_y();
                                let pre_x = text_state.tm[4];

                                for item in arr {
                                    match item {
                                        Object::String(bytes, _) => {
                                            if !bytes.is_empty() {
                                                if collecting {
                                                    if is_cid {
                                                        run_text.push_str(&Self::decode_cid_text(bytes, &*font_entry));
                                                    } else {
                                                        run_text.push_str(&Self::decode_simple_text(bytes, &*font_entry));
                                                    }
                                                }
                                                if is_cid {
                                                    crate::text_renderer::render_cid_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
                                                        text_state.horizontal_scaling, text_state.char_spacing,
                                                        text_state.word_spacing, text_state.rise,
                                                        &mut text_state.tm, rgba, buf,
                                                    );
                                                } else {
                                                    crate::text_renderer::render_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
                                                        text_state.horizontal_scaling, text_state.char_spacing,
                                                        text_state.word_spacing, text_state.rise,
                                                        &mut text_state.tm, rgba, buf,
                                                    );
                                                }
                                            }
                                        }
                                        Object::Integer(_) | Object::Real(_) => {
                                            let kern = Self::f(item);
                                            text_state.apply_tj_kern(kern);
                                        }
                                        _ => {}
                                    }
                                }

                                if let Some(ref mut spans) = text_spans {
                                    if !run_text.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: run_start_x, y: run_start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: run_text,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                "'" => {
                    // ' is equivalent to: T* then Tj
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if let Some(ref mut spans) = text_spans {
                                    let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                    let pre_x = text_state.tm[4];
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                    if !decoded.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: start_x, y: start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: decoded,
                                        });
                                    }
                                } else {
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                }
                            }
                        }
                    }
                }
                "\"" => {
                    // " is equivalent to: Tw Tc T* Tj
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                let (r, g, b, a) = state.current.fill_color;
                                let rgba = Self::color_to_u32(r, g, b, a);
                                if let Some(font_entry) = font_registry.get_font(
                                    &text_state.current_font_name, doc, resources,
                                ) {
                                    let start_x = text_state.render_x();
                                    let start_y = text_state.render_y();
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        let pre_x = text_state.tm[4];
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                        if !decoded.trim().is_empty() {
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                "Tc" => {
                    if let Some(v) = op.operands.first() {
                        text_state.char_spacing = Self::f(v);
                    }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() {
                        text_state.word_spacing = Self::f(v);
                    }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() {
                        text_state.horizontal_scaling = Self::f(v) / 100.0;
                    }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() {
                        text_state.rise = Self::f(v);
                    }
                }
                "Tr" => {
                    if let Some(v) = op.operands.first() {
                        let m = Self::f(v) as i32;
                        state.current.text_render_mode = m.clamp(0, 7) as u8;
                    }
                }
                "Do" => {
                    Self::handle_do_extract_with_text(&op.operands, buf, state, doc, resources, font_registry, text_spans.as_deref_mut());
                }
                // Inline image: de BI-dict-paren komen als operanden van de
                // ID-op binnen; de rauwe data-span levert de lexer.
                "ID" => {
                    if let Some((s, e)) = op_stream.inline_image_span() {
                        let data = &content_bytes[s.min(content_bytes.len())..e.min(content_bytes.len())];
                        if !Self::handle_inline_image_extract(&op.operands, data, buf) {
                            inline_skipped += 1;
                        }
                    }
                }
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        if inline_skipped > 0 {
            println!(
                "[inline-image] {} inline image(s) overgeslagen (filter/kleurruimte/bpc buiten dekking)",
                inline_skipped
            );
        }
        Ok(())
    }

    /// Emit een inline image (BI/ID/EI) als DrawImage in de command-buffer.
    /// Dekking bewust minimaal, gericht op CAD-export-strips: géén filter of
    /// FlateDecode (incl. PNG-predictor via /DP), 8 bpc, DeviceGray/RGB/CMYK.
    /// Alles daarbuiten (DCT/CCITT/RL/AHx/A85, ImageMask, Indexed, /Decode-
    /// arrays) retourneert false zodat de aanroeper het gat kan tellen.
    /// Formaat-conventie volgt handle_image_xobject: "RGBA"-magic + u16 w/h +
    /// premultiplied pixels, in het 1×1-unit-square onder de CTM (Y-flip).
    fn handle_inline_image_extract(
        operands: &[Object],
        raw: &[u8],
        buf: &mut DrawCommandBuffer,
    ) -> bool {
        let mut w: i64 = 0;
        let mut h: i64 = 0;
        let mut bpc: i64 = 8;
        let mut comps: i64 = 0; // 0 = /CS ontbreekt (alleen toegestaan bij ImageMask)
        let mut filter: Option<Vec<u8>> = None;
        let mut unsupported = false;
        let mut decode_parms: Option<Dictionary> = None;

        let mut it = operands.iter();
        while let Some(key) = it.next() {
            let Object::Name(k) = key else { continue };
            let Some(val) = it.next() else { break };
            match k.as_slice() {
                b"W" | b"Width" => w = Self::i(val) as i64,
                b"H" | b"Height" => h = Self::i(val) as i64,
                b"BPC" | b"BitsPerComponent" => bpc = Self::i(val) as i64,
                b"IM" | b"ImageMask" => {
                    if matches!(val, Object::Boolean(true)) {
                        unsupported = true; // stencil-masks: nog niet gedekt
                    }
                }
                b"CS" | b"ColorSpace" => {
                    comps = match val {
                        Object::Name(n) => match n.as_slice() {
                            b"G" | b"DeviceGray" => 1,
                            b"RGB" | b"DeviceRGB" => 3,
                            b"CMYK" | b"DeviceCMYK" => 4,
                            _ => -1, // Indexed (/I) of benoemde resource
                        },
                        _ => -1,
                    };
                }
                b"F" | b"Filter" => {
                    filter = match val {
                        Object::Name(n) => Some(n.clone()),
                        Object::Array(arr) if arr.is_empty() => None,
                        Object::Array(arr) if arr.len() == 1 => match &arr[0] {
                            Object::Name(n) => Some(n.clone()),
                            _ => { unsupported = true; None }
                        },
                        _ => { unsupported = true; None }
                    };
                }
                b"D" | b"Decode" => unsupported = true, // kleur-inversies: overslaan
                b"DP" | b"DecodeParms" => {
                    if let Object::Dictionary(d) = val {
                        decode_parms = Some(d.clone());
                    }
                }
                _ => {} // L/Length, I/Interpolate e.d.: niet nodig
            }
        }

        let flate = match filter.as_deref() {
            None => false,
            Some(b"Fl") | Some(b"FlateDecode") => true,
            Some(_) => { unsupported = true; false }
        };
        if unsupported
            || bpc != 8
            || !(1..=u16::MAX as i64).contains(&w)
            || !(1..=u16::MAX as i64).contains(&h)
            || !matches!(comps, 1 | 3 | 4)
        {
            return false;
        }
        let (w_us, h_us, n_comp) = (w as usize, h as usize, comps as usize);
        let expected = w_us * h_us * n_comp;

        let pixels: Vec<u8> = if flate {
            // Synthetische stream zodat decompress_image_stream (Flate +
            // PNG-predictor) één-op-één hergebruikt wordt.
            let mut dict = Dictionary::new();
            dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
            if let Some(dp) = decode_parms {
                dict.set("DecodeParms", Object::Dictionary(dp));
            }
            let stream = lopdf::Stream::new(dict, raw.to_vec());
            match Self::decompress_image_stream(&stream) {
                Some(p) => p,
                None => return false,
            }
        } else {
            raw.to_vec()
        };
        if pixels.len() < expected {
            return false;
        }

        // RGBA opbouwen — alpha is altijd 255 (inline images kennen geen
        // /SMask), dus premultiplied == straight en beide replayers lezen
        // dezelfde bytes correct.
        let mut rgba = Vec::with_capacity(w_us * h_us * 4);
        for px in pixels[..expected].chunks_exact(n_comp) {
            match n_comp {
                1 => rgba.extend_from_slice(&[px[0], px[0], px[0], 255]),
                3 => rgba.extend_from_slice(&[px[0], px[1], px[2], 255]),
                _ => {
                    let c = px[0] as f32 / 255.0;
                    let m = px[1] as f32 / 255.0;
                    let y = px[2] as f32 / 255.0;
                    let k = px[3] as f32 / 255.0;
                    let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                    let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                    let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                    rgba.extend_from_slice(&[r, g, b, 255]);
                }
            }
        }

        let mut img_data = Vec::with_capacity(8 + rgba.len());
        img_data.extend_from_slice(b"RGBA");
        img_data.extend_from_slice(&(w as u16).to_le_bytes());
        img_data.extend_from_slice(&(h as u16).to_le_bytes());
        img_data.extend_from_slice(&rgba);

        buf.save_state();
        buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y — images zijn top-down
        buf.draw_image(w as u16, h as u16, &img_data);
        buf.restore_state();
        true
    }

    /// Decode single-byte text bytes to Unicode using font ToUnicode map or encoding
    fn decode_simple_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        for &b in bytes {
            if let Some(&ch) = font_entry.to_unicode.get(&b) {
                result.push(ch);
            } else if font_entry.encoding_name.is_some() || !font_entry.differences.is_empty() {
                let ch = crate::encoding::resolve_char_code(
                    font_entry.encoding_name.as_deref(),
                    &font_entry.differences,
                    b,
                );
                result.push(ch);
            } else {
                // Fallback: interpret as Latin-1
                result.push(b as char);
            }
        }
        result
    }

    /// Decode CID (2-byte) text bytes to Unicode using font ToUnicode map
    fn decode_cid_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        let mut i = 0;
        while i + 1 < bytes.len() {
            let hi = bytes[i];
            let lo = bytes[i + 1];
            i += 2;
            let cid = u16::from_be_bytes([hi, lo]);
            // Try CID-specific ToUnicode map first (2-byte keys)
            if let Some(&ch) = font_entry.cid_to_unicode.get(&cid) {
                result.push(ch);
            } else if let Some(&ch) = font_entry.to_unicode.get(&(cid as u8)) {
                // Fallback to single-byte ToUnicode (for codes <= 255)
                result.push(ch);
            } else {
                // Treat 2-byte value as Unicode codepoint directly (Identity-H)
                let codepoint = cid as u32;
                if let Some(ch) = char::from_u32(codepoint) {
                    if !ch.is_control() || ch == ' ' {
                        result.push(ch);
                    }
                }
            }
        }
        result
    }

    #[allow(dead_code)]
    fn decode_pdf_string(obj: &Object) -> String {
        match obj {
            Object::String(bytes, _) => String::from_utf8_lossy(bytes).into_owned(),
            _ => String::new(),
        }
    }

    fn color_to_u32(r: u8, g: u8, b: u8, a: u8) -> u32 {
        (r as u32) << 24 | (g as u32) << 16 | (b as u32) << 8 | (a as u32)
    }

    fn f(obj: &Object) -> f32 {
        match obj {
            Object::Real(r) => *r as f32,
            Object::Integer(i) => *i as f32,
            _ => 0.0,
        }
    }

    fn i(obj: &Object) -> i32 {
        match obj {
            Object::Integer(i) => *i as i32,
            Object::Real(r) => *r as i32,
            _ => 0,
        }
    }

    fn handle_do_extract_with_text(
        operands: &[Object],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        text_spans: Option<&mut Vec<TextSpan>>,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());

        if subtype == Some(b"Image" as &[u8]) {
            Self::handle_image_xobject(stream, buf, doc);
            return;
        }

        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        buf.save_state();
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    let a = Self::f(&arr[0]);
                    let b_val = Self::f(&arr[1]);
                    let c = Self::f(&arr[2]);
                    let d = Self::f(&arr[3]);
                    let e = Self::f(&arr[4]);
                    let f = Self::f(&arr[5]);
                    buf.transform(a, b_val, c, d, e, f);
                    state.concat_matrix(a, b_val, c, d, e, f);
                }
            }
        }
        // PDF 8.10.2: clip the form's content to /BBox in form-coordinate
        // space (after /Matrix). Mirrors the renderer-side clip in
        // execute_form_xobject; without it the cached vector path used by
        // the JS renderer overlays content that should have been clipped.
        if let Some((x0, y0, x1, y1)) = Self::extract_form_bbox(&stream.dict) {
            buf.begin_path();
            buf.move_to(x0, y0);
            buf.line_to(x1, y0);
            buf.line_to(x1, y1);
            buf.line_to(x0, y1);
            buf.close_path();
            buf.clip();
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::extract_commands_with_text(&content_bytes, buf, state, doc, res, font_registry, text_spans);
        }
        state.restore();
        buf.restore_state();
    }

    /// Decompress an Image XObject stream's content. lopdf 0.34's
    /// `decompressed_content()` deliberately returns `Err(Type)` when the stream's
    /// `/Subtype` is `/Image` (it expects Image streams to be passed through a
    /// dedicated image-decoding pipeline). For our purposes we just need the
    /// raw decoded pixel bytes, so we replicate FlateDecode + PNG-predictor 15
    /// (and the no-filter passthrough) ourselves. JPEG/JPX images are handled
    /// separately by the callers — this helper is only for raw/Flate streams.
    fn decompress_image_stream(stream: &lopdf::Stream) -> Option<Vec<u8>> {
        use std::io::Read;
        let prof = profile_enabled();
        let dict = &stream.dict;
        let filters: Vec<String> = match dict.get(b"Filter").ok() {
            Some(Object::Name(n)) => vec![String::from_utf8_lossy(n).into_owned()],
            Some(Object::Array(arr)) => arr.iter().filter_map(|o| match o {
                Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
                _ => None,
            }).collect(),
            _ => Vec::new(),
        };

        // No filter: data is raw pixels already.
        if filters.is_empty() {
            return Some(stream.content.clone());
        }

        // Only handle FlateDecode here; DCTDecode/JPXDecode are caller's job.
        let outermost = filters.last().map(|s| s.as_str()).unwrap_or("");
        if outermost != "FlateDecode" {
            return None;
        }

        let t_flate = if prof { Some(std::time::Instant::now()) } else { None };
        let mut decoder = flate2::read::ZlibDecoder::new(stream.content.as_slice());
        let mut decoded = Vec::with_capacity(stream.content.len() * 4);
        if decoder.read_to_end(&mut decoded).is_err() {
            return None;
        }
        if let Some(t) = t_flate {
            PROF_FLATE_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
        }

        // Apply PNG predictor (DecodeParms /Predictor >= 10).
        let params = dict.get(b"DecodeParms").ok().and_then(|o| match o {
            Object::Dictionary(d) => Some(d),
            _ => None,
        });
        let predictor = params
            .and_then(|p| p.get(b"Predictor").ok())
            .and_then(|o| if let Object::Integer(i) = o { Some(*i) } else { None })
            .unwrap_or(1);

        if (10..=15).contains(&predictor) {
            let t_pred = if prof { Some(std::time::Instant::now()) } else { None };
            let columns = params
                .and_then(|p| p.get(b"Columns").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(1)
                .max(1);
            let colors = params
                .and_then(|p| p.get(b"Colors").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(1)
                .max(1);
            let bpc = params
                .and_then(|p| p.get(b"BitsPerComponent").ok())
                .and_then(|o| if let Object::Integer(i) = o { Some(*i as usize) } else { None })
                .unwrap_or(8)
                .max(8);
            let bytes_per_pixel = (colors * bpc) / 8;
            let row_bytes = columns * bytes_per_pixel;
            let stride = row_bytes + 1; // +1 filter tag per row
            let n_rows = decoded.len() / stride;
            // Speed iter-26: write the unfiltered output directly into a single
            // Vec, walking row windows via split_at_mut. This eliminates the
            // per-row `vec![0u8; row_bytes]` allocation (n_rows allocs were
            // the dominant cost of "Up"-only filtered streams) and lets the
            // inner loops operate on naked &mut [u8] without intermediate
            // copies. `prev_row` is a fixed-size scratch buffer reused across
            // rows; the active row is written in-place, then copied into
            // prev_row once per row.
            let mut out = vec![0u8; n_rows * row_bytes];
            let mut prev_row = vec![0u8; row_bytes];
            let bpp = bytes_per_pixel;
            for r in 0..n_rows {
                let row_start = r * stride;
                if row_start + stride > decoded.len() { break; }
                let filter_tag = decoded[row_start];
                let row = &decoded[row_start + 1 .. row_start + stride];
                let cur = &mut out[r * row_bytes .. r * row_bytes + row_bytes];
                match filter_tag {
                    0 => {
                        cur.copy_from_slice(row);
                    }
                    1 => {
                        // Sub: cur[i] = row[i] + cur[i - bpp]
                        cur[..bpp].copy_from_slice(&row[..bpp]);
                        for i in bpp..row_bytes {
                            cur[i] = row[i].wrapping_add(cur[i - bpp]);
                        }
                    }
                    2 => {
                        // Up: cur[i] = row[i] + prev_row[i]
                        // This pattern auto-vectorizes well — LLVM emits
                        // 16-byte adds when bounds-check is hoisted by chunks.
                        let prev = &prev_row[..row_bytes];
                        let mut i = 0;
                        // Unrolled 16-byte chunks (LLVM lifts to a single SIMD
                        // wide_add when the slices align).
                        while i + 16 <= row_bytes {
                            for j in 0..16 {
                                cur[i + j] = row[i + j].wrapping_add(prev[i + j]);
                            }
                            i += 16;
                        }
                        while i < row_bytes {
                            cur[i] = row[i].wrapping_add(prev[i]);
                            i += 1;
                        }
                    }
                    3 => {
                        // Average: row[i] + floor((left + up) / 2)
                        for i in 0..bpp {
                            let up = prev_row[i] as u16;
                            cur[i] = row[i].wrapping_add((up / 2) as u8);
                        }
                        for i in bpp..row_bytes {
                            let left = cur[i - bpp] as u16;
                            let up = prev_row[i] as u16;
                            cur[i] = row[i].wrapping_add(((left + up) / 2) as u8);
                        }
                    }
                    4 => {
                        // Paeth
                        for i in 0..bpp {
                            cur[i] = row[i].wrapping_add(prev_row[i]);
                        }
                        for i in bpp..row_bytes {
                            let left = cur[i - bpp] as i32;
                            let up = prev_row[i] as i32;
                            let upleft = prev_row[i - bpp] as i32;
                            let p = left + up - upleft;
                            let pa = (p - left).abs();
                            let pb = (p - up).abs();
                            let pc = (p - upleft).abs();
                            let pred = if pa <= pb && pa <= pc { left }
                                       else if pb <= pc { up }
                                       else { upleft };
                            cur[i] = row[i].wrapping_add(pred as u8);
                        }
                    }
                    _ => { cur.copy_from_slice(row); }
                }
                prev_row.copy_from_slice(cur);
            }
            if let Some(t) = t_pred {
                PROF_PREDICTOR_US.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
            }
            return Some(out);
        }

        Some(decoded)
    }

    /// Handle an Image XObject: decode image data and emit DrawImage command.
    /// PDF images live in a 1×1 unit square — the CTM (already on the canvas stack
    /// via cm operators) scales them to the correct page position and size.
    fn handle_image_xobject(
        stream: &lopdf::Stream,
        buf: &mut DrawCommandBuffer,
        doc: &Document,
    ) {
        let dict = &stream.dict;

        let width = dict.get(b"Width")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);
        let height = dict.get(b"Height")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);

        if width == 0 || height == 0 {
            return;
        }

        // Resolve and decode an /SMask soft-alpha mask, if present. The mask
        // is an Image XObject in DeviceGray (8 bpc) whose pixel values become
        // the per-pixel alpha for this image. PDF spec 8.5.4: a SMask whose
        // dimensions equal the parent image's gives a 1:1 alpha lookup; we
        // ignore /Matte (un-matting against the matte colour) for this
        // iteration — the silhouette accounts for the bulk of the visual diff.
        // Returns Some(alpha_bytes) when we have width*height single-byte
        // values usable as the RGBA `a` channel, otherwise None.
        let smask_alpha: Option<Vec<u8>> = dict.get(b"SMask").ok().and_then(|o| {
            let stream = match o {
                Object::Stream(s) => Some(s.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|obj| {
                    if let Object::Stream(s) = obj { Some(s.clone()) } else { None }
                }),
                _ => None,
            }?;
            let sm_dict = &stream.dict;
            let sm_w = sm_dict.get(b"Width").ok().and_then(|o| match o {
                Object::Integer(i) => Some(*i as u32),
                _ => None,
            })?;
            let sm_h = sm_dict.get(b"Height").ok().and_then(|o| match o {
                Object::Integer(i) => Some(*i as u32),
                _ => None,
            })?;
            // Bail out if the mask is not the same resolution as the image —
            // resampling is a future improvement; misaligned alpha would be
            // worse than no alpha.
            if sm_w != width as u32 || sm_h != height as u32 {
                return None;
            }
            let bytes = Self::decompress_image_stream(&stream)?;
            let needed = (sm_w as usize) * (sm_h as usize);
            if bytes.len() < needed {
                return None;
            }
            Some(bytes[..needed].to_vec())
        });

        // Detect filter to determine image format
        let filter = dict.get(b"Filter").ok().and_then(|o| {
            match o {
                Object::Name(n) => Some(n.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Name(n) = o { Some(n.clone()) } else { None }
                }),
                Object::Array(arr) => {
                    // Multiple filters — use the last one (outermost)
                    arr.last().and_then(|o| match o {
                        Object::Name(n) => Some(n.clone()),
                        _ => None,
                    })
                }
                _ => None,
            }
        });

        let filter_name = filter.as_deref().unwrap_or(b"");

        if filter_name == b"DCTDecode" {
            // JPEG — send raw bytes directly (browser decodes via hardware-accelerated createImageBitmap)
            // stream.content contains the raw JPEG bytes before lopdf's decompression
            let raw_content = &stream.content;
            if !raw_content.is_empty() && raw_content.len() > 2
                && raw_content[0] == 0xFF && raw_content[1] == 0xD8 {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y (images are top-down)
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        if filter_name == b"JPXDecode" {
            // JPEG 2000 — send raw bytes, browser may support it
            let raw_content = &stream.content;
            if !raw_content.is_empty() {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        // For FlateDecode or no filter: decompress and encode as PNG
        let bits = dict.get(b"BitsPerComponent")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u8),
                _ => None,
            })
            .unwrap_or(8);

        // Resolve colour space — direct names or /Indexed palettes per
        // PDF spec §8.6.6.3 (see resolve_color_space helper).
        let (stream_components_us, output_components_us, palette) =
            Self::resolve_color_space(dict, doc);
        let stream_components: u8 = stream_components_us as u8;
        let components: u8 = output_components_us as u8;

        // NOTE: must NOT call stream.decompressed_content() here — lopdf 0.34
        // explicitly returns Err(Type) for streams whose Subtype is /Image,
        // which previously caused every FlateDecode raster image to be
        // silently dropped from the draw-command buffer (visible symptom:
        // missing rasters on Bluebeam/AutoCAD/Revit-exported PDFs).
        if let Some(raw_pixels) = Self::decompress_image_stream(stream) {
            if bits == 8 {
                // Convert raw pixels to RGBA and encode as simple bitmap
                let expected_len = width as usize * height as usize * stream_components as usize;
                if raw_pixels.len() >= expected_len {
                    // Build RGBA buffer. When an /SMask supplied per-pixel
                    // alpha, plug those bytes into the `a` slot so transparent
                    // regions (alpha == 0) drop out instead of painting solid
                    // RGB. Without this, images that rely on a soft mask
                    // (cover pages, drop-shadowed logos) render with the
                    // background-bleed pre-matte showing through as solid
                    // black, which dominated the page-0/27 diff on the
                    // rapport-constructie / Text pdf gecombineerd PDFs.
                    // tiny-skia (used by the server-side rasteriser) requires
                    // PREMULTIPLIED RGBA — `PixmapRef::from_bytes` returns
                    // None if r/g/b > a for any pixel. The browser-side
                    // canvas path treats the same blob as straight RGBA but
                    // either way the conversion produces correct pixels (a==
                    // 255 → premultiplied == straight; a < 255 → both pipes
                    // can recover the source colour). So premultiply here.
                    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
                    let mut i = 0;
                    let n_pixels = width as usize * height as usize;
                    let pm = |c: u8, a: u8| -> u8 {
                        ((c as u16 * a as u16 + 127) / 255) as u8
                    };
                    let pal_chunk = components as usize;
                    let mut pal_buf: [u8; 4] = [0; 4];
                    for px in 0..n_pixels {
                        let alpha = smask_alpha
                            .as_ref()
                            .and_then(|a| a.get(px).copied())
                            .unwrap_or(255);

                        // For Indexed colour spaces, expand the palette index
                        // (1 byte per pixel in stream) into a base-colour-
                        // space tuple before the existing RGBA conversion.
                        let comp_slice: &[u8] = if let Some(pal) = palette.as_ref() {
                            let pi = raw_pixels.get(i).copied().unwrap_or(0) as usize;
                            let p_off = pi * pal_chunk;
                            if p_off + pal_chunk <= pal.len() {
                                for j in 0..pal_chunk { pal_buf[j] = pal[p_off + j]; }
                            } else {
                                for j in 0..pal_chunk { pal_buf[j] = 0; }
                            }
                            i += stream_components as usize;
                            &pal_buf[..pal_chunk]
                        } else {
                            let s = &raw_pixels[i .. i + stream_components as usize];
                            i += stream_components as usize;
                            s
                        };

                        match components {
                            1 => {
                                let g = comp_slice[0];
                                let g2 = pm(g, alpha);
                                rgba.extend_from_slice(&[g2, g2, g2, alpha]);
                            }
                            3 => {
                                let r = comp_slice[0];
                                let g = comp_slice[1];
                                let b = comp_slice[2];
                                rgba.extend_from_slice(&[pm(r, alpha), pm(g, alpha), pm(b, alpha), alpha]);
                            }
                            4 => {
                                // CMYK → RGB (simple conversion)
                                let c = comp_slice[0] as f32 / 255.0;
                                let m = comp_slice[1] as f32 / 255.0;
                                let y = comp_slice[2] as f32 / 255.0;
                                let k = comp_slice[3] as f32 / 255.0;
                                let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                                let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                                let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                                rgba.extend_from_slice(&[pm(r, alpha), pm(g, alpha), pm(b, alpha), alpha]);
                            }
                            _ => {
                                rgba.extend_from_slice(&[0, 0, 0, alpha]);
                            }
                        }
                    }

                    // Send as raw RGBA with a simple header marker
                    // Format: "RGBA" magic (4 bytes) + width u16 LE + height u16 LE + RGBA pixels
                    let mut img_data = Vec::with_capacity(8 + rgba.len());
                    img_data.extend_from_slice(b"RGBA");
                    img_data.extend_from_slice(&width.to_le_bytes());
                    img_data.extend_from_slice(&height.to_le_bytes());
                    img_data.extend_from_slice(&rgba);

                    buf.save_state();
                    buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y
                    buf.draw_image(width, height, &img_data);
                    buf.restore_state();
                }
            }
        }
    }

    /// Implements the `gs` operator: look up the named ExtGState in the
    /// current resources and apply its parameters to the current graphics
    /// state. Today only `/ca` (constant alpha for non-stroking ops) and
    /// `/CA` (constant alpha for stroking ops) are honoured — these are the
    /// transparency knobs that produce washed-out images and faded paths.
    fn apply_ext_gstate(
        operands: &[Object],
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let egs_obj = match resources.get(b"ExtGState") {
            Ok(o) => o,
            _ => return,
        };
        let egs_dict = match Self::resolve_dict(egs_obj, doc) {
            Ok(d) => d,
            _ => return,
        };
        let entry_obj = match egs_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let entry = match Self::resolve_dict(entry_obj, doc) {
            Ok(d) => d,
            _ => return,
        };
        if let Ok(v) = entry.get(b"ca") {
            state.current.fill_alpha = Self::f(v).clamp(0.0, 1.0);
        }
        if let Ok(v) = entry.get(b"CA") {
            state.current.stroke_alpha = Self::f(v).clamp(0.0, 1.0);
        }
    }

    fn resolve_dict<'a>(obj: &'a Object, doc: &'a Document) -> Result<&'a Dictionary, lopdf::Error> {
        match obj {
            Object::Dictionary(d) => Ok(d),
            Object::Reference(id) => {
                let resolved = doc.get_object(*id)?;
                resolved.as_dict()
            }
            _ => Err(lopdf::Error::Type),
        }
    }

    fn extract_form_resources(dict: &Dictionary, doc: &Document) -> Option<Dictionary> {
        let res_obj = dict.get(b"Resources").ok()?;
        match res_obj {
            Object::Reference(rid) => {
                doc.get_object(*rid).ok().and_then(|o| o.as_dict().ok().cloned())
            }
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }
    }

    /// Extract a Form XObject's `/BBox` rectangle as `(x_min, y_min, x_max, y_max)`,
    /// normalising the corners (PDF allows the bbox to be specified in either
    /// diagonal order). Returns `None` if no BBox is present or it isn't a
    /// 4-element numeric array. Per PDF spec 8.10.2 the form's content stream
    /// is implicitly clipped to this rectangle in form-coordinate space.
    fn extract_form_bbox(dict: &Dictionary) -> Option<(f32, f32, f32, f32)> {
        let arr = dict.get(b"BBox").ok()?.as_array().ok()?;
        if arr.len() < 4 { return None; }
        let x0 = Self::f(&arr[0]);
        let y0 = Self::f(&arr[1]);
        let x1 = Self::f(&arr[2]);
        let y1 = Self::f(&arr[3]);
        let xmin = x0.min(x1);
        let xmax = x0.max(x1);
        let ymin = y0.min(y1);
        let ymax = y0.max(y1);
        // Reject degenerate rectangles — they'd clip everything to nothing,
        // which is almost certainly not what the producer intended (and would
        // hide content the reference renderer paints).
        if (xmax - xmin) <= 0.0 || (ymax - ymin) <= 0.0 {
            return None;
        }
        Some((xmin, ymin, xmax, ymax))
    }

    /// Render a single annotation's appearance stream onto the page canvas.
    ///
    /// PDF spec ISO 32000-1 §12.5.5 — an annotation's normal appearance
    /// (`/AP /N`) is a Form XObject. To position it on the page, a matrix
    /// `A` is computed that scales/translates the appearance's transformed
    /// BBox to align with the annotation's `/Rect`:
    ///
    /// 1. Transform the form's `/BBox` by the form's `/Matrix` to get the
    ///    axis-aligned bbox `T` in form-coordinate-system-after-Matrix.
    /// 2. `sx = (Rect.w) / (T.w)`, `sy = (Rect.h) / (T.h)`
    /// 3. `A = [sx, 0, 0, sy, Rect.x_min - T.x_min*sx, Rect.y_min - T.y_min*sy]`
    ///
    /// The rendering is then equivalent to: `A cm <Matrix cm> <appearance>`,
    /// with the form's resources active.
    ///
    /// Without this pass, sticky-note callouts, freeform text annotations,
    /// rectangles-with-fill, and other AP-stream annotations are skipped
    /// entirely — the page content stream alone doesn't include them.
    /// PyMuPDF / Adobe / etc render these by default, so the regression
    /// test sees the missing yellow boxes / freeText labels as a diff.
    pub fn render_annotation_appearance(
        ap_stream: &lopdf::Stream,
        annot_rect: (f32, f32, f32, f32),
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        font_registry: &mut FontRegistry,
        doc_image_cache: Option<&std::sync::Arc<std::sync::RwLock<ImageCache>>>,
    ) {
        // Extract the form's BBox (mandatory per spec).
        let bbox = match Self::extract_form_bbox(&ap_stream.dict) {
            Some(b) => b,
            None => return,
        };

        // Extract the form's Matrix (defaults to identity).
        let (ma, mb, mc, md, mtx, mty) = match ap_stream.dict.get(b"Matrix") {
            Ok(Object::Array(arr)) if arr.len() >= 6 => (
                Self::f(&arr[0]), Self::f(&arr[1]),
                Self::f(&arr[2]), Self::f(&arr[3]),
                Self::f(&arr[4]), Self::f(&arr[5]),
            ),
            _ => (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        };

        // Step 1: transform BBox by Matrix to get axis-aligned T.
        let (bx0, by0, bx1, by1) = bbox;
        let corners = [
            (bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1),
        ];
        let mut tx_min = f32::INFINITY;
        let mut ty_min = f32::INFINITY;
        let mut tx_max = f32::NEG_INFINITY;
        let mut ty_max = f32::NEG_INFINITY;
        for (x, y) in corners {
            let nx = ma * x + mc * y + mtx;
            let ny = mb * x + md * y + mty;
            tx_min = tx_min.min(nx);
            ty_min = ty_min.min(ny);
            tx_max = tx_max.max(nx);
            ty_max = ty_max.max(ny);
        }
        let tw = tx_max - tx_min;
        let th = ty_max - ty_min;
        if tw <= 0.0 || th <= 0.0 {
            return;
        }

        // Step 2/3: build A.
        let (rx0, ry0, rx1, ry1) = annot_rect;
        let sx = (rx1 - rx0) / tw;
        let sy = (ry1 - ry0) / th;
        let ax_e = rx0 - tx_min * sx;
        let ay_f = ry0 - ty_min * sy;

        // Save the parent graphics state and apply A then Matrix.
        state.save();
        state.concat_matrix(sx, 0.0, 0.0, sy, ax_e, ay_f);
        state.concat_matrix(ma, mb, mc, md, mtx, mty);

        // Clip to the form's BBox in form-coordinate space (per spec
        // §8.10.2). This protects the page from content that paints
        // outside the appearance's nominal bbox.
        {
            use tiny_skia::PathBuilder;
            let mut pb = PathBuilder::new();
            pb.move_to(bx0, by0);
            pb.line_to(bx1, by0);
            pb.line_to(bx1, by1);
            pb.line_to(bx0, by1);
            pb.close();
            if let Some(path) = pb.finish() {
                renderer.apply_clip(&mut state.current, &path, false);
            }
        }

        // Resolve the form's own resources (fonts/colorspaces/etc).
        let form_resources = Self::extract_form_resources(&ap_stream.dict, doc);
        let empty_dict;
        let res: &Dictionary = match form_resources.as_ref() {
            Some(d) => d,
            None => {
                empty_dict = Dictionary::new();
                &empty_dict
            }
        };

        // Execute the appearance content stream. lopdf 0.34's
        // `decompressed_content()` rejects Form XObjects with a `DictKey`
        // error in some versions, so we try it first and fall back to
        // raw `stream.content` (uncompressed) or manual flate-decode.
        let content_bytes = match ap_stream.decompressed_content() {
            Ok(b) => Some(b),
            Err(_) => Self::decode_appearance_stream(ap_stream),
        };
        if let Some(bytes) = content_bytes {
            let _ = Self::execute_internal(
                &bytes,
                renderer,
                state,
                doc,
                res,
                font_registry,
                0,
                doc_image_cache,
            );
        }

        state.restore();
    }

    /// Decode an appearance Form-XObject's stream when lopdf's
    /// `decompressed_content()` refuses (typically with `DictKey`). Handles
    /// the no-filter and `FlateDecode` cases — the only filters we've ever
    /// seen on an `/AP /N` stream in practice.
    fn decode_appearance_stream(stream: &lopdf::Stream) -> Option<Vec<u8>> {
        use std::io::Read;
        let filters = match stream.dict.get(b"Filter") {
            Ok(Object::Name(n)) => vec![String::from_utf8_lossy(n).to_string()],
            Ok(Object::Array(arr)) => arr.iter().filter_map(|o| {
                o.as_name().ok().map(|n| String::from_utf8_lossy(n).to_string())
            }).collect(),
            _ => Vec::new(),
        };
        if filters.is_empty() {
            return Some(stream.content.clone());
        }
        if filters.last().map(|s| s.as_str()) != Some("FlateDecode") {
            return None;
        }
        let mut decoder = flate2::read::ZlibDecoder::new(stream.content.as_slice());
        let mut out = Vec::with_capacity(stream.content.len() * 4);
        decoder.read_to_end(&mut out).ok()?;
        Some(out)
    }

    /// Walk a content stream and emit one TextSpan per Tj/TJ run.
    /// Lighter than extract_commands — only the operators that affect text
    /// position or content are processed; path/color/image ops are skipped.
    #[cfg(test)]
    fn extract_text_only(
        content_bytes: &[u8],
        spans: &mut Vec<TextSpan>,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        let mut text_state = TextState::new();

        // Streamende lexer i.p.v. Content::decode — zie execute_internal.
        let mut op_stream = crate::content_stream::ContentStreamIter::new(content_bytes);
        let mut op_buf = lopdf::content::Operation { operator: String::new(), operands: Vec::new() };
        while op_stream.next_into(&mut op_buf) {
            let op = &op_buf;
            match op.operator.as_str() {
                // Graphics state stack — only CTM matters for text positioning.
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                // Text state operators
                "BT" => text_state.begin_text(),
                "ET" => text_state.in_text = false,
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name =
                                String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "TL" => {
                    if let Some(v) = op.operands.first() { text_state.leading = Self::f(v); }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        text_state.translate_line(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => text_state.translate_line(0.0, -text_state.leading),
                "Tc" => {
                    if let Some(v) = op.operands.first() { text_state.char_spacing = Self::f(v); }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() { text_state.word_spacing = Self::f(v); }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() { text_state.horizontal_scaling = Self::f(v) / 100.0; }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() { text_state.rise = Self::f(v); }
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        for item in arr {
                            match item {
                                Object::String(bytes, _) => {
                                    if !bytes.is_empty() {
                                        Self::emit_text_span(
                                            bytes, &mut text_state, font_registry, doc, resources,
                                            state, spans,
                                        );
                                    }
                                }
                                Object::Integer(_) | Object::Real(_) => {
                                    text_state.apply_tj_kern(Self::f(item));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                "'" => {
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "\"" => {
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                Self::emit_text_span(
                                    bytes, &mut text_state, font_registry, doc, resources,
                                    state, spans,
                                );
                            }
                        }
                    }
                }
                // Form XObjects can contain nested text — recurse into them.
                "Do" => {
                    Self::handle_do_text_only(&op.operands, spans, state, doc, resources, font_registry);
                }
                _ => {} // skip path/color/image/everything else
            }
        }
        Ok(())
    }

    /// Helper: process one Tj/TJ string run and emit a TextSpan.
    /// Captures the start text-matrix, advances tm by each glyph's width,
    /// then computes the final user-space bbox by transforming through the
    /// current CTM. Decodes bytes to text via the font's ToUnicode CMap
    /// (falls back to Latin-1 / WinAnsi for fonts without ToUnicode).
    #[cfg(test)]
    fn emit_text_span(
        bytes: &[u8],
        text_state: &mut TextState,
        font_registry: &mut crate::fonts::FontRegistry,
        doc: &Document,
        resources: &Dictionary,
        state: &GraphicsStateStack,
        spans: &mut Vec<TextSpan>,
    ) {
        // Capture the start position in text space (BEFORE we advance tm).
        let start_tx = text_state.tm[4];
        let start_ty = text_state.tm[5];

        // Resolve font + decode text content. get_font returns Arc<FontEntry>;
        // we hold the Arc for the duration of this run so cache lookups are
        // a single refcount bump.
        let font_arc = font_registry.get_font(&text_state.current_font_name, doc, resources);
        let mut decoded = String::new();
        let mut total_advance_text_units: f32 = 0.0;

        if let Some(font_entry) = font_arc.as_deref() {
            if font_entry.is_cid {
                // Type0 / 2-byte CID font — process two bytes at a time.
                let mut i = 0;
                while i + 1 < bytes.len() {
                    let cid = u16::from_be_bytes([bytes[i], bytes[i + 1]]);
                    i += 2;
                    // ToUnicode for CID fonts is currently truncated to u8 in
                    // this codebase — best-effort decode for low CIDs.
                    if let Some(ch) = font_entry.to_unicode.get(&(cid as u8)) {
                        decoded.push(*ch);
                    } else {
                        decoded.push('\u{FFFD}');
                    }
                    let w0 = 0.5; // approximate em width — good enough for hit-testing
                    let tw = if cid == 32 || cid == 3 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            } else {
                // Single-byte font — decode each byte and advance precisely.
                let parsed_opt = font_entry.parsed.as_ref();
                for &byte in bytes {
                    let ch = if let Some(&c) = font_entry.to_unicode.get(&byte) {
                        c
                    } else {
                        crate::encoding::resolve_char_code(
                            font_entry.encoding_name.as_deref(),
                            &font_entry.differences,
                            byte,
                        )
                    };
                    decoded.push(ch);

                    let w0 = if let Some(parsed) = parsed_opt {
                        if let Some(gid) = crate::fonts::FontRegistry::char_to_glyph_id(font_entry, byte) {
                            if let Some(g) = parsed.glyphs.get(&gid) {
                                g.advance_width / parsed.units_per_em as f32
                            } else { 0.5 }
                        } else { 0.5 }
                    } else { 0.5 };
                    let tw = if byte == 32 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            }
        } else {
            // No font resolved — still advance the matrix so subsequent text
            // operators see a sensible position.
            for _ in bytes {
                let tx = 0.5 * text_state.font_size * text_state.horizontal_scaling;
                total_advance_text_units += tx;
                text_state.tm[4] += tx * text_state.tm[0];
                text_state.tm[5] += tx * text_state.tm[1];
            }
        }

        if decoded.is_empty() {
            return;
        }

        // Transform the start position from text space → user space via CTM.
        // Text space already has tm baked in; for the SPAN ORIGIN we apply CTM.
        let ctm = state.current.ctm;
        let user_x = start_tx * ctm.sx + start_ty * ctm.kx + ctm.tx;
        let user_y = start_tx * ctm.ky + start_ty * ctm.sy + ctm.ty;

        // Effective font size in user space ≈ Tfs × |CTM scale|.
        let ctm_scale = (ctm.sx * ctm.sx + ctm.ky * ctm.ky).sqrt().abs();
        let font_size_user = text_state.font_size * ctm_scale;

        // Width in user space: project the total text-space advance through
        // tm (text matrix) and CTM. The span advances along (tm[0], tm[1])
        // in text space, so the user-space delta is that vector × CTM.
        let dtx = total_advance_text_units * text_state.tm[0];
        let dty = total_advance_text_units * text_state.tm[1];
        let du_x = dtx * ctm.sx + dty * ctm.kx;
        let du_y = dtx * ctm.ky + dty * ctm.sy;
        let width_user = (du_x * du_x + du_y * du_y).sqrt();

        spans.push(TextSpan {
            text: decoded,
            x: user_x,
            y: user_y,
            width: width_user,
            height: font_size_user,
            font_size: font_size_user,
        });
    }

    /// Recurse into a Form XObject for text-only extraction.
    #[cfg(test)]
    fn handle_do_text_only(
        operands: &[Object],
        spans: &mut Vec<TextSpan>,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    state.concat_matrix(
                        Self::f(&arr[0]), Self::f(&arr[1]),
                        Self::f(&arr[2]), Self::f(&arr[3]),
                        Self::f(&arr[4]), Self::f(&arr[5]),
                    );
                }
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::extract_text_only(&content_bytes, spans, state, doc, res, font_registry);
        }
        state.restore();
    }
}

#[cfg(test)]
mod inline_image_tests {
    use super::*;

    #[test]
    fn text_only_extractor_accepts_an_empty_stream() {
        let doc = Document::with_version("1.5");
        let resources = Dictionary::new();
        let mut spans = Vec::new();
        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut registry = crate::fonts::FontRegistry::new();

        Interpreter::extract_text_only(
            b"",
            &mut spans,
            &mut state,
            &doc,
            &resources,
            &mut registry,
        )
        .expect("empty text stream");

        assert!(spans.is_empty());
    }

    /// Draai extract_commands over een synthetische content-stream en geef de
    /// rauwe commandbuffer terug (zonder 16-byte pagina-header).
    fn extract(content: &[u8]) -> Vec<u8> {
        let doc = Document::with_version("1.5");
        let resources = Dictionary::new();
        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut buf = DrawCommandBuffer::new();
        let mut reg = crate::fonts::FontRegistry::new();
        Interpreter::extract_commands(content, &mut buf, &mut state, &doc, &resources, &mut reg)
            .expect("extract");
        buf.into_bytes()
    }

    /// Zoek de eerste DrawImage (op 19) en geef (w, h, payload).
    fn first_draw_image(d: &[u8]) -> Option<(u16, u16, Vec<u8>)> {
        let mut pos = 0usize;
        while pos < d.len() {
            let op = d[pos];
            pos += 1;
            match op {
                0 | 1 => pos += 8,
                2 | 12 => pos += 24,
                3 => pos += 16,
                5 => pos += 8,
                6 => pos += 4,
                13 | 14 => pos += 1,
                15 => pos += 4,
                16 => {
                    let n = d[pos] as usize;
                    pos += 1 + n * 4 + 4;
                }
                18 => {
                    let len = d[pos + 16] as usize;
                    pos += 17 + len;
                }
                19 => {
                    let w = u16::from_le_bytes(d[pos..pos + 2].try_into().unwrap());
                    let h = u16::from_le_bytes(d[pos + 2..pos + 4].try_into().unwrap());
                    let dlen = u32::from_le_bytes(d[pos + 4..pos + 8].try_into().unwrap()) as usize;
                    return Some((w, h, d[pos + 8..pos + 8 + dlen].to_vec()));
                }
                _ => {}
            }
        }
        None
    }

    #[test]
    fn inline_image_raw_rgb_wordt_geemit() {
        // 2×2 DeviceRGB zonder filter: 12 rauwe bytes na ID.
        let mut content = b"q 2 0 0 2 10 10 cm BI /W 2 /H 2 /BPC 8 /CS /RGB ID ".to_vec();
        let pixels: [u8; 12] = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0];
        content.extend_from_slice(&pixels);
        content.extend_from_slice(b" EI Q");
        let buf = extract(&content);
        let (w, h, payload) = first_draw_image(&buf).expect("DrawImage aanwezig");
        assert_eq!((w, h), (2, 2));
        assert_eq!(&payload[..4], b"RGBA");
        assert_eq!(u16::from_le_bytes(payload[4..6].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(payload[6..8].try_into().unwrap()), 2);
        let rgba = &payload[8..];
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&rgba[4..8], &[0, 255, 0, 255]);
        assert_eq!(&rgba[8..12], &[0, 0, 255, 255]);
        assert_eq!(&rgba[12..16], &[255, 255, 0, 255]);
    }

    #[test]
    fn inline_image_flate_met_png_predictor() {
        // 3×1 DeviceRGB, FlateDecode + PNG-predictor 15 (rijfilter 0 = None),
        // exact het strip-formaat van CAD-exports.
        use std::io::Write;
        let row: [u8; 10] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]; // filter-tag + 9 bytes
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&row).unwrap();
        let compressed = enc.finish().unwrap();
        let mut content = b"BI /W 3 /H 1 /BPC 8 /CS /RGB /F /Fl /DP <</Predictor 15 /Columns 3 /Colors 3>> ID ".to_vec();
        content.extend_from_slice(&compressed);
        content.extend_from_slice(b" EI");
        let buf = extract(&content);
        let (w, h, payload) = first_draw_image(&buf).expect("DrawImage aanwezig");
        assert_eq!((w, h), (3, 1));
        let rgba = &payload[8..];
        assert_eq!(&rgba[0..4], &[10, 20, 30, 255]);
        assert_eq!(&rgba[4..8], &[40, 50, 60, 255]);
        assert_eq!(&rgba[8..12], &[70, 80, 90, 255]);
    }

    #[test]
    fn inline_image_exotisch_filter_wordt_overgeslagen() {
        // DCTDecode inline: buiten dekking → géén DrawImage, wel doorlopen.
        let content = b"BI /W 2 /H 2 /BPC 8 /CS /RGB /F /DCT ID \xde\xad\xbe\xef EI 1 0 0 1 5 5 cm".to_vec();
        let buf = extract(&content);
        assert!(first_draw_image(&buf).is_none(), "DCT-inline mag niet geemit worden");
        // de cm ná EI is nog verwerkt (stream niet ontspoord)
        assert!(buf.iter().any(|&b| b == 12), "Transform na EI ontbreekt");
    }
}
