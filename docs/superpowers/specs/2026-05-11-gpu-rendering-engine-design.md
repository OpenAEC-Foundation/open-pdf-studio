# Open PDF Studio v2 GPU Rendering Engine — Design

**Status:** Approved for implementation planning
**Date:** 2026-05-11
**Replaces:** The tiny-skia CPU rasterizer backend in `open-pdf-render/src/renderer.rs`

---

## Goal

Replace the CPU-only `tiny-skia` rasterizer inside the existing `open-pdf-render` Rust crate with the full GPU-accelerated **Skia 2D graphics library**, accessed through the [`skia-safe`](https://github.com/rust-skia/rust-skia) Rust bindings. The Rust crate compiles to both native (used by the regression test harness) and WebAssembly (used by the Tauri WebView). The WASM target binds to a WebGPU canvas in the WebView; the native target binds to whatever wgpu/GL/Metal surface the host platform exposes. No CPU readback path, no Tauri-IPC pixel transport, no fallback rasterizers.

All annotation tools, text selection, form fields, hyperlinks, file I/O, save flows, and MCP test infrastructure remain unchanged. The refactor is a backend swap inside one Rust crate plus a build-target addition (WASM) plus a thin JS wrapper that drives the WASM module.

## Why Skia

Three real Rust GPU 2D libraries were considered: Vello (Linebender, compute-shader-based, v0.5), Skia (via skia-safe bindings, 15-year-old industry standard), and wgpu+lyon (build-from-primitives). Skia was chosen for production maturity:

- **Feature coverage out of the box.** Every PDF blend mode, transparency group, soft mask, gradient, pattern, mesh shading mode, and color space is implemented and battle-tested. Vello still has feature gaps in these areas; wgpu+lyon would require building all of them from scratch.
- **15 years in Chrome.** Chrome, Firefox, Android, Flutter, and the entire production PDF-viewer industry rely on Skia. Any oddly-shaped PDF we encounter has likely already been rendered correctly by Skia somewhere.
- **Stable API.** `skia-safe` is the long-lived Rust binding crate; the Skia C++ API itself has been stable for over a decade. No API churn risk.
- **Built-in text rendering.** HarfBuzz + FreeType under the hood; full Unicode shaping, color emoji, font fallback. We do not write or maintain text-shaping code.

The trade-off versus Vello is build complexity: Skia is a large C++ codebase and the WASM target requires careful build configuration. We accept that.

## Non-goals

- Editing PDF content with the new engine (saves remain via `pdf-lib`).
- Real-time live-rendering of pan/zoom — pan/zoom remains CSS-transform-driven with re-render on settle. The GPU pipeline raises the per-render budget so the settle moment is no longer perceptible.
- Tile-based rendering. Skia renders the whole page each call; per-page cost is low enough that tiling is unnecessary.
- Replacing PDF.js text/link/form layers — those overlays continue to use PDF.js and stay aligned to the pdf-canvas by sharing its CSS box.
- Rebuilding annotation rendering. The annotation-canvas overlay is independent and remains Canvas2D.
- Using CanvasKit (Google's official Skia WASM build) directly from JS. That option would split the rendering pipeline between Rust (parsing) and JS (rasterization). We commit to keeping all rendering in Rust source — Skia's C++ remains an implementation detail of the Rust crate.

## Success criteria

| Metric | Current (tiny-skia CPU) | Target (Skia GPU) |
|---|---|---|
| Barn Relocation first render @ scale 1.5 | 440-2842 ms | < 100 ms |
| Barn zoom 1.5 → 2.5 (5 steps) | 9-14 s end-to-end | < 1 s end-to-end |
| Visual parity vs PyMuPDF reference | 60/106 pages < 2% diff | 100/106 pages < 2% diff (PyMuPDF itself is Skia-backed in some versions, so closer parity expected) |
| Per-document memory ceiling | unbounded (depends on caches) | < 200 MB |
| Zoom-out regression on Barn | freezes app | renders correctly |
| Non-Skia rasterization fallback | yes (PDF.js, removed mid-session) | none |
| Tempfile-based IPC pixel transport | yes | none (rendering happens in WebView address space) |
| WASM bundle (release, after wasm-opt -Oz) | n/a | < 10 MB compressed |

## Architecture

### Process and address-space model

```
┌────────────────────────────────────────────────────────────────────┐
│ Tauri 2 main process (Rust, native)                                 │
│  • File I/O, session, printer, MCP server, OS integration           │
│  • Native Skia render path used ONLY by render-regression harness   │
│  • No production rendering happens in this process                  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ Tauri IPC (file bytes,
                              │  preferences, MCP)
┌─────────────────────────────▼───────────────────────────────────────┐
│ WebView2 renderer process (Chromium, GPU-accelerated)                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ open-pdf-render-wasm  (Rust → WASM via Emscripten + cargo)    │   │
│  │                                                                 │   │
│  │  Reused from current crate:                                    │   │
│  │   • parser.rs           PDF structure parsing (lopdf)          │   │
│  │   • interpreter.rs      Content stream interpretation          │   │
│  │   • graphics_state.rs   CTM / clip / color state               │   │
│  │   • image_decode.rs     JPEG / FlateDecode / image upload      │   │
│  │   • color.rs            Color space conversion                 │   │
│  │                                                                 │   │
│  │  Replaced:                                                      │   │
│  │   • renderer.rs (tiny-skia) → renderer_skia.rs (skia-safe GPU) │   │
│  │   • fonts.rs            → minimal shim; Skia handles fonts     │   │
│  │   • text_renderer.rs    → removed; Skia paints text directly   │   │
│  │   • font_parser.rs      → removed; Skia uses HarfBuzz+FreeType │   │
│  │   • draw_commands.rs    → removed (no JS replay)               │   │
│  │                                                                 │   │
│  │  New:                                                           │   │
│  │   • wasm.rs             wasm-bindgen exports                   │   │
│  │   • lib.rs (updated)    public API, both native and WASM       │   │
│  │   • Skia surface/canvas management                             │   │
│  │   • WebGPU context binding (via WebGL2 fallback inside Skia)   │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                              │ Skia GrDirectContext                   │
│                              │  bound to WebGL2 or WebGPU              │
│                              ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ <canvas id="pdf-canvas">                                        │  │
│  │  Skia writes pixels here via the bound GPU context.             │  │
│  │  No CPU intermediate buffer.                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Unchanged DOM overlays stacked on top of pdf-canvas:                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ annotation-canvas   (Canvas2D, drawing tools)                   │  │
│  │ text-highlight-canvas (Canvas2D, search highlights)             │  │
│  │ .textLayer          (DOM spans, text selection)                 │  │
│  │ .linkLayer          (DOM anchors, hyperlinks)                   │  │
│  │ .formLayer          (DOM inputs, form fields)                   │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Crate layout

```
open-pdf-render/                  # existing root (Rust crate)
├── Cargo.toml                    # adds: skia-safe (with appropriate features), wasm-bindgen, web-sys
├── build.rs                      # NEW — orchestrates Skia C++ build for both native + WASM targets
├── src/
│   ├── lib.rs                    # public API (preserved + WASM exports)
│   ├── parser.rs                 # UNCHANGED
│   ├── interpreter.rs            # UNCHANGED — emits the same Renderer trait calls
│   ├── graphics_state.rs         # UNCHANGED
│   ├── image_decode.rs           # UNCHANGED
│   ├── color.rs                  # UNCHANGED
│   ├── renderer_skia.rs          # NEW — implements the Renderer trait via skia-safe
│   ├── renderer.rs               # REMOVED after migration (tiny-skia)
│   ├── draw_commands.rs          # REMOVED (no more JS replay)
│   ├── fonts.rs                  # SHRUNK to a shim that registers fonts with Skia
│   ├── text_renderer.rs          # REMOVED (Skia paints text from font/glyph data directly)
│   ├── font_parser.rs            # REMOVED (Skia uses HarfBuzz+FreeType internally)
│   └── wasm.rs                   # NEW — wasm-bindgen exports
├── pkg/                          # NEW — wasm-pack output, copied into open-pdf-studio/dist/wasm/
└── examples/
    ├── render_native.rs          # native Skia smoke test, used by regression harness
    └── render_wasm.html          # in-WebView smoke test
```

A trait `Renderer` abstracts the backend so the interpreter does not know whether it's calling tiny-skia, skia-safe-GPU, or any future renderer during the transition phase. After migration the trait may stay as a clean boundary or be inlined — that decision is left to the implementation phase.

```rust
// Renderer trait. Implemented by renderer_skia.rs (new) and renderer.rs (old, until removal).
pub trait Renderer {
    fn fill_path(&mut self, path: &Path, paint: &Paint, rule: FillRule, ctm: Transform, clip: Option<&Path>);
    fn stroke_path(&mut self, path: &Path, paint: &Paint, stroke: &Stroke, ctm: Transform, clip: Option<&Path>);
    fn draw_image(&mut self, width: u32, height: u32, rgba: &[u8], gs: &GraphicsState);
    fn push_layer(&mut self, alpha: f32, blend: BlendMode, mask: Option<&Path>);
    fn pop_layer(&mut self);
    fn fill_text(&mut self, text: &str, font: &Font, size: f32, paint: &Paint, ctm: Transform);
    // (full surface the interpreter uses)
}
```

`renderer_skia.rs` implements this trait by building a `skia_safe::Canvas` operation stream and flushing the surface. The native build binds a Skia `GrDirectContext` to wgpu or OpenGL; the WASM build binds it to WebGL2 (Skia's most-portable GPU backend in WASM) or WebGPU once WebGPU support is solid across WebView2 versions.

### JS-side wrapper

A single new module:

```
open-pdf-studio/js/pdf/gpu-renderer.js     NEW
  • Loads the WASM module (open-pdf-render-wasm).
  • Creates a WebGL2 (or WebGPU) rendering context on pdf-canvas.
  • Hands the context to the WASM module's init function.
  • Exposes openDocument(bytes) / renderPage(handle, pageIdx, scale, rotation)
    that mirrors the current renderer.js API surface seen by callers.
```

`renderer.js` is replaced by `gpu-renderer.js`. Existing call sites (`loader.js`, `pdf-viewport.js`, `tabs.js`, `mcp-bridge.js`) update to the new module path and adapted signatures, but their internal logic does not change. `vector-renderer.js` is removed.

## Data flow

### Open document
1. JS receives PDF bytes from file dialog / drag-drop / Tauri `read_file`.
2. JS calls `gpuRenderer.openDocument(bytes)`.
3. WASM allocates a `DocumentHandle` in WASM heap, runs `lopdf::Document::load_mem`.
4. WASM returns a numeric handle to JS along with page count and metadata.

### Render a page
1. JS computes target canvas size in device pixels (CSS width × `devicePixelRatio`).
2. JS calls `gpuRenderer.renderPage(handle, pageIdx, scale, rotation, canvasElement)`.
3. WASM walks the page content stream via the existing interpreter, calling the `Renderer` trait methods on a `SkiaRenderer` instance that records operations into a `skia_safe::Canvas` bound to the GPU surface.
4. WASM flushes the GrDirectContext. The GPU draws to the canvas. Promise resolves when the queue is flushed.
5. JS triggers DOM overlay re-render (annotations, text spans, form fields update their CSS transforms to match the new canvas size).

### Zoom in
1. JS captures cursor world coords.
2. JS applies predictive `transform: scale(ratio)` with `transform-origin` at cursor — instant visual zoom (browser GPU compositor handles this).
3. JS shifts container `scrollLeft` / `scrollTop` so the cursor's world point stays anchored.
4. JS debounces 150 ms after the last wheel notch.
5. JS calls `gpuRenderer.renderPage(handle, pageIdx, newScale, rotation, canvas)`. New pixels arrive ≲ 100 ms later.
6. JS resets the CSS transform to `scale(1.0)` once new pixels are in place.

### Save annotations to PDF
1. `saver.js` writes the new PDF bytes via `pdf-lib` (unchanged).
2. JS calls `gpuRenderer.invalidateDocument(handle)`.
3. JS calls `gpuRenderer.openDocument(newBytes)` to get a fresh handle.
4. JS swaps the active handle and re-renders the current page.

### Tab switch / page navigation
- Identical to current flow: JS keeps a handle per open document, switches the active handle in `gpuRenderer`, calls `renderPage` for the visible page.

## Caching strategy

A Skia full-page render of Barn-class content runs in roughly 10-30 ms on a GTX-class GPU. At that cost, the existing two-tier cache (Rust pixmap + JS ImageBitmap) is over-engineering — cache lookup and bookkeeping cost approaches the render itself.

**WASM-side:**
- Per-`DocumentHandle` cached `SkPicture` per (page, rotation). Re-used on subsequent renderPage calls at any scale — Skia applies the scale transform at playback. `SkPicture` is Skia's recorded-but-not-rasterized canvas operations, exactly the right abstraction here.
- No per-(page, scale, rotation) bitmap cache.

**JS-side:**
- No `ImageBitmap` cache. Removed.
- CSS-transform state for live zoom prediction stays.

If profiling reveals a need to add bitmap caching later, the architecture supports it without disturbing the rest.

## Error handling

**No fallbacks.** If a render fails (GrContext lost, WASM panic, invalid PDF, Skia internal error), the user sees a `state.renderEngine = 'ERROR'` indicator and a structured error message. No second-chance attempt with another rasterizer.

GrContext-lost events trigger a single re-initialization attempt with a fresh context, then surface the error if that also fails.

## Testing

Reuse the existing render regression harness in `scripts/render_test/`. It already compares against PyMuPDF references with a < 2% pixel diff threshold and per-page timing. The new engine slots in without harness changes — `screenshot_page` and `screenshot_all` MCP tools will be backed by the WASM module instead of `render_pdf_page`.

For native correctness validation during phases 1-2, `examples/render_native.rs` writes Skia-rendered PNGs to disk and feeds them to the same harness.

Add a new harness mode that exercises:
- GrContext-lost recovery (force a device drop in dev tools, verify re-init).
- Per-page memory ceiling (assert < 200 MB working set across the full corpus).
- 60 fps zoom-step measurement (timing of the post-debounce render).

## Migration plan

Single-branch effort, no feature flag in production. Phases:

1. **Native Skia integration.** Add `skia-safe` dependency. Create `renderer_skia.rs` alongside `renderer.rs`. The interpreter still uses `renderer.rs` in production code. A new feature flag (compile-time, not runtime) selects `renderer_skia.rs` for the regression test build.
2. **Native parity.** `renderer_skia.rs` passes the regression test corpus with < 2% diff vs PyMuPDF reference. tiny-skia remains source of truth meanwhile.
3. **WASM build pipeline.** Set up Emscripten + cargo-emscripten or trunk for the WASM target. Build Skia for WASM (this is a real engineering task — Skia's WASM build uses Google's GN/Bazel system, but skia-safe wraps it via build.rs). Produce a working `.wasm` artifact loadable in a test HTML page.
4. **WebView integration.** Wire `gpu-renderer.js` to the WASM module. WebGL2 GrContext bound to pdf-canvas. Render a real PDF end-to-end inside the WebView.
5. **Switchover.** `renderer.js` call sites move to `gpu-renderer.js`. `renderer.rs`, `draw_commands.rs`, `vector-renderer.js`, `text_renderer.rs`, `font_parser.rs` are deleted. `tiny-skia` is removed from `Cargo.toml`. `fonts.rs` is shrunk to the Skia-font-registration shim.

Each phase ends with a passing regression run. No phase ships partially-working features to users. No permanent dual-engine state.

## Out of scope (explicit)

| Area | Action |
|---|---|
| Annotation creation/editing tools | unchanged |
| Annotation rendering on overlay canvas | unchanged |
| PDF.js text layer / link layer / form layer | unchanged |
| pdf-lib save flow | unchanged |
| Tauri shell, file I/O, printer, MCP server | unchanged |
| PDF/A compliance detection | unchanged |
| Render-regression test framework | unchanged |
| Thumbnail rendering | initially via the same WASM Skia path; optimized later if needed |
| Editing PDF source content | unchanged (still pdf-lib based) |
| CanvasKit (Skia's JS-side WASM build) | explicitly NOT used — we use skia-safe Rust bindings instead |

## Risks

| Risk | Mitigation |
|---|---|
| Building Skia for WASM is non-trivial (large C++ codebase, Emscripten quirks) | skia-safe upstream has experimental WASM support and there are reference build setups (rust-skia repo has examples). Allocate dedicated time for build-system work in phase 3. Worst case: contribute upstream fixes to skia-safe. |
| WASM bundle size with Skia | Target: < 10 MB compressed after `wasm-opt -Oz`. Skia's WASM is ~5-7 MB compressed in known builds (CanvasKit ships at this size). If our Rust+Skia build exceeds 15 MB, evaluate stripping Skia features we don't need (e.g., specific image codecs, font hinting features) via skia-safe feature flags. |
| WebGL2 GrContext in WebView2 lacks features (compute shaders, advanced blending) | Skia's GL backend supports WebGL2 and is the most-tested production path (used by Chrome's PDF viewer historically). If WebGPU GrContext is solid in target WebView2 version, prefer it. Decision made in phase 4 based on what works. |
| skia-safe API churn | skia-safe is community-maintained but tracks Skia milestone releases. Pin a specific version. Re-evaluate on each upgrade. The Skia C++ API itself is decade-stable, so binding-level churn is the only worry. |
| GrContext loss on driver crash or GPU process restart | Skia surfaces `GrContext.abandonContext()`. Handle with a single re-init attempt, then error out. No software fallback by design. |
| Build complexity slows the team / increases CI time | Build the Skia C++ artifact once, cache it in CI. Local dev uses a pre-built Skia binary unless contributors are debugging Skia itself. |
| Cross-platform variation (macOS / Linux Tauri targets) | Skia builds for all our target platforms. WASM target is platform-agnostic by definition. |

## Dependencies (versions to pin)

| Crate | Version | Why |
|---|---|---|
| `skia-safe` | latest stable at start of implementation, pinned | Rust bindings to Skia C++ |
| `lopdf` | current (already used) | PDF parsing |
| `image`, `flate2` | current | image decode |
| `turbojpeg` | current (when native target) | fast JPEG decode |
| `wasm-bindgen` | latest stable | Rust ↔ JS bindings |
| `web-sys` | latest stable | DOM / WebGL2 / WebGPU bindings |

Build tooling: Emscripten SDK, `wasm-pack`, `wasm-opt` (binaryen).

Native dependencies (Skia internals, handled transparently by skia-safe's build.rs): C++ toolchain (clang on macOS/Linux, MSVC on Windows), Python (Skia's build system), ninja, GN.

## Open questions for the planning phase

1. WebGL2 versus WebGPU GrContext in WebView2 — what does our target Windows version actually support reliably across user GPUs?
2. Where does the WASM bundle live in `dist/` — separate `wasm/` directory with cache-friendly headers, or embedded in the main JS chunk?
3. Font availability in WASM — can Skia load fonts from `document.fonts` or `navigator.fonts.query()`, or do we ship a system-font passthrough via Tauri IPC?
4. Build CI strategy — pre-build Skia native + WASM artifacts in CI, cache them, or rebuild on every PR? (impacts CI time)
5. Should `gpu-renderer.js` expose the WASM `DocumentHandle` opaquely or wrap it in a higher-level `Document` class?

These are implementation details left for the writing-plans phase.
