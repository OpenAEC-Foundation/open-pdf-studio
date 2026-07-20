# How real PDF viewers handle scroll/zoom/pan on image-heavy PDFs

Date: 2026-05-12
Author: research pass — sources cited per claim
Target document class: BARN-like scanned engineering drawings (70+ image XObjects per page, multi-megapixel raster content, 3672×2376 RGBA output @ scale=1.5)
Our current baseline (from `docs/superpowers/barn-deep-dive.md`): **338 ms average cold render, 670 ms p99**, with `tiny_skia` rasterisation as the dominant cost (69 % of cold render in `serial_walk`).

---

## TL;DR

| Tactic | Used by | Impact for BARN-class | Implementation effort |
|---|---|---|---|
| **Multi-resolution tile cache** (power-of-2 levels, row/col addressed) | SumatraPDF, MuPDF, Bluebeam | High for scroll/zoom feel, **none for first-paint of one page** | Medium |
| **Background prerender thread pool** | SumatraPDF, all serious viewers | High for scroll feel | Medium |
| **Display list once, raster many** | MuPDF, PDFium (progressive) | High — parse once, raster N tiles | Medium-large |
| **Single-document decoded-image cache (cross-page, cross-zoom)** | MuPDF (`fz_store`), PDFium (`CPDF_ImageCacheEntry`) | Low for BARN (each XObject used on one page) | Small |
| **SIMD JPEG decode (libjpeg-turbo / zune-jpeg)** | MuPDF, PyMuPDF, PDFium | Low for BARN (`predecode_parallel` already ~52 ms = 15 % of time) | Small (we already use turbojpeg) |
| **GPU raster backend (Skia / Direct2D)** | PDFium, Bluebeam, Chrome | Very high — moves the dominant rasterisation cost off the CPU | Large |
| **CSS / cheap upscale during interactive zoom, defer hi-res** | PDF.js, MuPDF.js | High for perceived smoothness | Small |
| **Don't tile small pages, do tile huge ones** (`maxTileSize` knob) | SumatraPDF | Avoids overhead for the common case | Small |

The single biggest insight from this research: **none of the high-performance viewers paint at full resolution every frame.** They all (a) maintain a tile-pyramid cache, (b) display the best-available tile while a higher-res tile is rendered in the background, and (c) use whatever GPU/SIMD path is available for the actual pixel-pushing. Our current architecture skips all three of these.

---

## Per-viewer breakdown

### 1. PDF.js (Mozilla, JS/Canvas)

**Architecture.** Per-page Canvas; one large RGBA bitmap per visible page; no tile pyramid in the core (despite a long-running open issue requesting one — #6419, open since 2015). Rendering goes through "operator lists" generated in a worker thread; the canvas API replays them on the main thread.

**Cache strategy.** Browser-cached PDF byte stream, plus an in-memory operator-list cache per page. **Rendered pixels are NOT cached** — they live on the canvas DOM element and are tossed when the canvas is recycled. Issue #5720 explicitly confirmed this and no general bitmap cache was ever added (sources: GitHub issues #5720, #6419).

**Zoom strategy.** Each page has a `MAX_CANVAS_PIXELS` cap (16 777 216 on iOS, 268 435 456 on other browsers). When the user zooms beyond that limit, PDF.js falls back to **CSS scaling of the existing low-res canvas** (i.e. blurry) and renders the high-res version asynchronously when the zoom level settles. This is the "blur then sharpen" pattern users see in Firefox at high zoom.

**Scroll strategy.** Viewport-only — only pages inside the scroll viewport plus a buffer are kept rendered; offscreen pages are unmounted (canvas destroyed, operator list kept). The `RenderingCancelledException` machinery lets fast scrolling abort in-flight page renders before they consume cycles.

**Image XObjects.** Decoded once per page on the worker thread; the decoded buffer is transferred (not copied) to the main thread via `postMessage` transferables. Image masks were specifically optimised to send 1-bit-per-pixel rather than expanded RGBA (`nnethercote/2014/02/07` blog post — performance work).

**Sources.**
- https://github.com/mozilla/pdf.js/issues/6419 (tile rendering RFE, still open)
- https://github.com/mozilla/pdf.js/issues/5720 (rendered-content cache — answered as "no, by design, only operator lists are cached")
- https://github.com/mozilla/pdf.js/discussions/17976 (`maxCanvasPixels`, iOS canvas limit)
- https://blog.mozilla.org/nnethercote/2014/02/07/a-slimmer-and-faster-pdf-js/
- https://apryse.com/blog/pdf-js/guide-to-pdf-js-rendering

**Relevance to BARN.** PDF.js's strategy is wrong for our use case — they accept blurry zoom because they're memory-constrained in the browser. But the `RenderingCancelledException` + viewport-only model is directly applicable to our viewer.

---

### 2. PDFium (Google, Chromium's PDF viewer)

**Architecture.** Four-layer rendering pipeline:
1. `CPDF_RenderContext` — owns the per-render state.
2. `CPDF_RenderStatus` — tracks the per-operator stepping state for progressive rendering.
3. `CFX_RenderDevice` — abstract device interface.
4. Device drivers — AGG (software) or Skia (CPU or GPU via Skia Graphite).

**Progressive rendering.** PDFium exposes three entry points: `FPDF_RenderPageBitmap_Start` / `FPDF_RenderPage_Continue` / `FPDF_RenderPage_Close`. The caller chooses how much wall-clock to spend per "continue" call; PDFium saves and restores interpreter state between calls. This lets Chrome render a quarter of a slow page, pump the message loop (UI events, scroll), then resume — instead of blocking 600 ms.

**Image cache.** `CPDF_ImageCacheEntry` (file: `core/fpdfapi/render/cpdf_imagecacheentry.cpp`) caches decoded image XObject bitmaps, keyed by the XObject's object reference + decode parameters. `GetEstimatedImageMemoryBurden()` lets the renderer evict based on byte size. The cache is **document-scoped** — same image referenced from page 1 and page 5 decodes once.

**Rendering flags for tuning.**
- `FPDF_RENDER_LIMITEDIMAGECACHE` — strict memory cap on the image cache.
- `FPDF_RENDER_FORCEHALFTONE` — cheap nearest-neighbour stretch instead of high-quality resample (used during scroll/zoom for speed).

**GPU.** Modern Chrome can render PDFs via Skia (`PdfUseSkiaRendererEnabled` policy). When Skia Graphite (Chrome 2025) is enabled the entire raster path goes to the GPU. The fallback AGG backend is what most non-Chrome embeddings ship (e.g. mobile, server-side).

**Sources.**
- https://deepwiki.com/chromium/pdfium/6.3-rendering-and-output-apis
- https://blog.chromium.org/2025/07/introducing-skia-graphite-chromes.html
- https://chromeenterprise.google/intl/en_au/policies/pdf-use-skia-renderer-enabled/
- https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/4114

**Relevance to BARN.** Two adoptable ideas: (a) the **decoded-image cache is document-scoped, not page-scoped** — we currently flush ours at end-of-page (`interpreter.rs::execute_internal`); (b) progressive rendering with `FORCEHALFTONE`-class quality during interaction is exactly what we're missing.

---

### 3. MuPDF / PyMuPDF (Artifex)

**Architecture (the gold standard for our class of viewer).**

```
PDF stream  ──parse──►  Display list (per page, immutable, thread-safe)
                              │
                              ├──► draw device  ──► fz_pixmap  (any thread, any tile)
                              │
                              ├──► draw device  ──► fz_pixmap  (band 2)
                              │
                              └──► draw device  ──► fz_pixmap  (band N)
```

Concretely:
- **Parse once.** The main thread runs the page through a "list device" producing an `fz_display_list` — a pre-resolved, immutable graphics-command tree. No font lookups, no XObject indirection at raster time.
- **Raster many.** Worker threads each `fz_clone_context(main_ctx)` to get a thread-local context that **shares the resource store** (font cache, image cache) but has its own exception stack. Each thread runs the same display list into its own pixmap, optionally clipped to a "band" or tile rect.
- **Document-scoped resource store.** `source/fitz/store.c` implements an LRU-evicting hash + doubly-linked list, protected by `FZ_LOCK_ALLOC`. Stored objects implement the `fz_storable` interface — pixmaps, decoded images, scaled-image variants, glyph rasters, all go in the same store with a single byte budget. The "scavenger" algorithm walks oldest-first, evicting the minimum set of items to free enough bytes.

**Image cache, in detail.** `source/fitz/image.c` keys decoded images by `(image*, l2factor, subarea_rect)`:
- `image*` — the source `fz_image` object identity (so two Image XObjects from different files don't collide).
- `l2factor` — power-of-2 subsampling level. Asking for an image at scale 0.25 first looks for `l2factor=2`; if not present, decode at `l2factor=2` and cache it.
- `subarea_rect` — for clipped/tiled decode of huge images (a JPEG2000 background where only a strip is visible). The `subarea_stream()` wrapper skips the unneeded margins inside the decoder, never materialising bytes outside the region.

This means: zooming from 100 % to 200 % does **not** re-decode the JPEG XObject. The 100 % decoded copy stays in the store; the renderer asks for `l2factor=0` and gets the full-res cached decode. Zooming from 100 % to 25 % asks for `l2factor=2` — a separately cached, 4×-smaller buffer.

**Image scaling.** Bilinear for upscale, a Graphics-Gem-derived box/area-average for downscale. `fz_scale_pixmap_cached` keeps the scaled result in the store too, so repeated paints at the same scale don't re-resample.

**JPEG decode.** Uses libjpeg-turbo's SSE2/AVX2/NEON intrinsics for IDCT and colour-conversion. libjpeg-turbo is 2–6× faster than vanilla libjpeg on x86 baseline JPEG.

**Tile cache.** "MuPDF supports caching of rendered tiles for speed" — this is the store again; sub-page raster results are storable entries.

**Sources.**
- https://mupdf.readthedocs.io/en/latest/cookbook/c/multi-threaded.html
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/store.c
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/image.c
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/draw-device.c
- https://casper.mupdf.com/docs/mupdf_explored.pdf (Robin Watts, "MuPDF Explored", Sep 2022)
- https://artifex.com/blog/multi-threaded-use-of-mupdf-in-java

**Relevance to BARN.** This is the architecture our renderer should converge on. Specifically:
- The display-list-once-raster-many pattern means parallel tile renders within a single page wouldn't re-parse the content stream. We currently re-parse on every render via `Content::decode` (`barn-deep-dive.md` reports 16 ms/page average just for that).
- A document-scoped image cache keyed by `(xobj_id, l2factor)` would survive zoom in/out cycles. Our current `ImageCache` is dropped at end-of-page render.
- Caching the SCALED pixmap (post-resample) — not just the decoded pixels — would skip the `tiny_skia::fill_path` + bilinear-pattern hot path on revisits.

---

### 4. SumatraPDF (open source Windows reader, MuPDF backend)

This is the **single most relevant reference for our viewer**. Read the source. Specifically `src/RenderCache.h` and `src/RenderCache.cpp`.

**Architecture: tile pyramid, addressed by (res, row, col).**

```c
// src/RenderCache.h
struct TilePosition {
    USHORT res;   // resolution level — see GetTileRes()
    USHORT row;
    USHORT col;
};

// "A given tile starts at (col / 2^res * page_width,
//                          row / 2^res * page_height)"
```

- `res=0` → one tile covers the full page (the cheap-first preview).
- `res=1` → 2×2 grid (4 tiles).
- `res=N` → 2ᴺ × 2ᴺ grid.

The `GetTileRes()` function chooses `res` per page based on rendered pixel dimensions vs `RenderCache::maxTileSize`. **Tiny pages do not get tiled** — the function uses the geometric mean (not max) of width/height ratios, "so that the tile area doesn't get too small". This is critical: tiling has overhead, you don't pay it on a 600×800 thumbnail.

**Cache structure.**

```c
// src/RenderCache.h — constants
#define MAX_PAGE_REQUESTS   8         // pending render queue depth
#define MAX_BITMAPS_CACHED  128       // global tile cache size
#define kMaxRenderThreads   32        // max background render threads

struct BitmapCacheEntry {
    DisplayModel* dm;       // which document/view
    int           pageNo;
    int           rotation;
    float         zoom;
    TilePosition  tile;     // (res, row, col)
    int           cacheIdx;
    RenderedBitmap* bitmap; // owned
    bool          outOfDate;
    int           refs;     // refcount — paint thread may hold while UI thread evicts
};

struct RenderCache {
    BitmapCacheEntry*    cache[128];
    CRITICAL_SECTION     cacheAccess;
    PageRenderRequest    requests[8];
    CRITICAL_SECTION     requestAccess;
    HANDLE               renderThreads[32];
    HANDLE               startRendering;     // semaphore
    Size                 maxTileSize;
    // ...
};
```

**Eviction.** `FreeIfFull()` evicts in tiers:
1. Same document, **invisible** pages first (out of viewport).
2. **Other documents** next (different `DisplayModel*`).
3. Never evict pages from the currently-displayed document while visible — "it leads to flicker".

There's a `CONSERVE_MEMORY` define (on by default) that calls `FreeNotVisible()` after each paint, aggressively trimming the cache to what's on screen.

**Render queue + threading.**
- Threads spawn **lazily**: `nRenderThreads` grows up to `kMaxRenderThreads=32` only when `idleThreads==0`.
- Same-page-same-tile duplicate requests get re-prioritised (moved to head of queue) rather than queued twice.
- A new zoom / rotation request **aborts** the in-flight render for that (page, oldZoom, oldRotation) — `requestAccess` lock + `abort` flag on `PageRenderRequest`.
- `Invalidate()` marks tiles `outOfDate=true` but keeps them displayable until the replacement arrives. This is the "show the stale tile while the new one is rendering" pattern.

**Render-delay UX.** Each request has a `GetRenderDelay()` returning milliseconds since it was queued. The paint code can use this to decide whether to draw a "Rendering..." placeholder or just leave the previous tile up — small delays = no placeholder, long delays = show it.

**Prerender.** When the user views page N, the cache speculatively requests tiles for adjacent pages at `res=0` (cheap full-page preview). For `res=1` (4 tiles), both columns of the top row are queued together so a partial appearance comes in symmetrically.

**Sources.**
- https://github.com/sumatrapdfreader/sumatrapdf/blob/master/src/RenderCache.h
- https://github.com/sumatrapdfreader/sumatrapdf/blob/master/src/RenderCache.cpp
- https://deepwiki.com/sumatrapdfreader/sumatrapdf
- https://blog.kowalczyk.info/article/2f72237a4230410a888acbfce3dc0864/lessons-learned-from-15-years-of-sumatrapdf-an-open-source-windows-app.html
- https://forum.sumatrapdfreader.org/t/why-does-sumatrapdf-not-use-all-cpu-cores/269

**Relevance to BARN.** This is the architecture I'd port. Five concrete features map 1:1 onto our current code:

| SumatraPDF feature | Maps to our renderer |
|---|---|
| `BitmapCacheEntry` keyed by `(pageNo, rotation, zoom, tile)` | Our `PageCacheKey` lacks `tile`; we cache whole-page bitmaps only |
| `FreeIfFull()` tiered eviction prefers off-screen | Our `PageBitmapCache::insert` is plain FIFO/LRU, doesn't know "off-screen" |
| Background render thread pool | Tauri tokio threadpool runs whatever calls it; we have no prerender |
| `outOfDate=true` keep-stale-until-replacement | We have nothing — invalidation = blank |
| Tile-res switching by page size | We render the whole page bitmap at full output resolution |

---

### 5. Adobe Acrobat / Reader (closed source)

Limited concrete information available. What I could establish:

- **Multi-resolution image storage** is a known Adobe technique — patent HK1058849B ("Process for rendering mixed raster content files") describes splitting an image into multiple equally-sized layers stored at different resolutions and compression rates, intended for fast progressive display.
- Acrobat exposes a **"Page cache"** preference user-facing — the OS-level setting page mentions it; the implementation isn't documented. Behavioural observation: pages rendered once during a session display instantly on revisit, suggesting a per-page bitmap cache lives somewhere.
- Recent (2025) Adobe community threads complain about **"poor display quality when scrolling images in Acrobat Reader 2025"** — Adobe explicitly trades quality for speed during fast scroll, exactly like PDF.js's `FORCEHALFTONE` approach.

I could not find specific Adobe technical documentation about their tile architecture, image-XObject cache, or zoom strategy. Closed-source-only.

**Sources.**
- https://patents.google.com/patent/HK1058849B/en (MRC patent)
- https://community.adobe.com/questions-12/poor-display-quality-when-scrolling-images-in-acrobat-reader-2025-1506811
- https://www.adobe.com/devnet-docs/acrobatetk/tools/PrefRef/Windows/Originals.html

---

### 6. Bluebeam Revu (closed source — known fast on engineering drawings)

Public information is marketing-tier only, but the support pages reveal **operational settings** that tell us what knobs the engine has:

- **Multiple rendering engine options** exposed in Preferences. "Hardware rendering generally works best, especially with a dedicated graphics card" — strong hint that the production path is GPU-accelerated (likely Direct2D given the Windows focus).
- **"Wait for Completion" rendering mode** — disables progressive redraw. Default mode IS progressive: tiles appear as they finish. This confirms a tile-rendering architecture without saying anything about its internals.
- **Thumbnail-based navigation** is explicitly recommended for "large drawing sets" — implying the in-memory cache cannot hold all pages and per-page random access is the design assumption.
- File-size reduction is recommended (their "Reduce File Size" feature). For BARN-class drawings the size IS images, so they're suggesting users downsample images permanently — i.e. the rendering engine struggles with very high-resolution images just like ours.

**Sources.**
- https://support.bluebeam.com/articles/revu-tips-for-improving-performance/
- https://novedge.com/blogs/design-news/bluebeam-tip-maximizing-efficiency-with-large-format-drawings-in-bluebeam-revu
- https://vdci.edu/learn/bluebeam/bluebeam-system-requirements

No concrete architectural details obtainable from public sources. Closed-source-only.

---

### 7. Foxit / PDF-XChange (closed source)

Public information is exclusively marketing material. PDF-XChange forum discussion confirms they have a **memory + disk cache** for rendered content and that the disk cache is used to reload pages on app restart, but the structure/policy isn't documented. Skipping detailed coverage — no concrete claims sourceable.

**Sources.**
- https://forum.pdf-xchange.com/viewtopic.php?t=29413

---

## Cross-cutting patterns

Distilled from all viewers above:

### Pattern A: Pyramid + tile cache addressed by `(page, rotation, zoom_quantized, res, row, col)`

Both serious renderers (MuPDF/PyMuPDF via the store, SumatraPDF via `BitmapCacheEntry`) cache **subareas** of pages. Whole-page bitmaps are an anti-pattern for engineering drawings — at 3672×2376 they're 33 MB each and impossible to keep many of in RAM. Tiles of e.g. 1024×1024 are 4 MB each, and you only paint the dozen or so that actually intersect the viewport.

### Pattern B: Display list once, raster many

MuPDF's display list is the canonical example. PDFium achieves the same via its `CPDF_RenderStatus` checkpoint state, just less cleanly. The point is: **content-stream parsing happens once per page per document load, not once per zoom-level / once per tile.**

In our code: `Interpreter::execute_internal` does `Content::decode(content_bytes)` every render. Even with our existing `pixmap_cache` this is wasted work on a zoom miss.

### Pattern C: Document-scoped (not per-page) decoded-image cache

MuPDF's `fz_store` and PDFium's `CPDF_ImageCacheEntry` both live for the lifetime of the document. They survive page boundaries. They survive zoom changes (the key includes `l2factor`, so different scales are cached separately).

In our code: `ImageCache` is a local variable in `Interpreter::execute_internal`. Dropped at end of page. Zooming in re-decodes every image even though we just decoded them at the previous zoom.

### Pattern D: Three quality levels for interactive vs idle

- **Interactive (scroll/zoom in progress):** stale-but-displayable tile, or `FORCEHALFTONE`-quality cheap render, or CSS-upscale of a previous render.
- **Settled-but-fresh:** what most viewers call "good enough" — bilinear, decoded at correct l2factor.
- **Idle / printed:** full bicubic, full-resolution decode.

PDF.js, Adobe Reader, Bluebeam, and PDFium (via flags) all expose two-tier or three-tier quality. We currently always render at level 3.

### Pattern E: Lazy/abortable rendering with priority queue

Every viewer except PDF.js exposes some form of **abort the in-flight render when the parameters change** + **promote duplicate requests to the head of the queue**. SumatraPDF is the cleanest reference. The implementation is small — a `PageRenderRequest` struct + a critical section + an atomic abort flag — but the UX impact on fast scroll is enormous.

### Pattern F: Prerender the obvious-next-page

Every viewer (except mobile-PDF.js where memory is too tight) speculatively renders one or two pages ahead of where the user is reading. Cheapest version: enqueue at `res=0` (one tile covering full page) on a low-priority queue. SumatraPDF does this; MuPDF leaves it to the caller; PDFium leaves it to the caller (Chrome implements it on top).

---

## What does NOT work for BARN-class

These are tactics other people recommend, that the research shows do not move the needle on scanned-engineering-drawing PDFs specifically:

1. **Aggressive cross-page deduplication of image XObjects.** This is a huge win for **brochures and reports** with a recurring logo. BARN-class scans have ~14–73 unique images per page, each used 1–2 times on its own page only. The "max reuse" column in our barn-deep-dive shows reuse=1 on six of seven pages. Document-scoped image cache helps cross-zoom, not cross-page.

2. **Pure JPEG-decoder upgrade.** We're already on `turbojpeg` (Cargo.toml line 12), which uses libjpeg-turbo's SIMD intrinsics. `predecode_parallel` averages 52 ms (15 % of total) and would benefit maybe 20-30 % from a switch to `zune-jpeg` — saving ~12 ms/page on a 338 ms baseline. Not the bottleneck. Sources: https://lib.rs/crates/zune-jpeg, https://documentation.help/pymupdf/app1.html.

3. **Multi-threaded "render multiple pages in parallel".** Sounds good. Doesn't help. The user reads ONE page at a time during scroll; what they need is for **that one page** to come up faster. Rendering pages N+1, N+2 in parallel is prerender, not first-paint speedup.

4. **Generic "use a bigger cache".** Our `pixmap_cache` capacity-12 is already tuned. The bottleneck isn't cache size — it's that cache MISSES (any new zoom level) take 338 ms because we re-rasterise the entire page. A bigger cache trades RAM for cold-render frequency, not for cold-render speed.

5. **Bicubic vs bilinear vs nearest pixel-resample tuning.** Our `tiny_skia` Pattern shader already uses `FilterQuality::Bilinear`. Lower-quality `Nearest` would save maybe 10-15 % on `draw_image` (~10 ms/page on image-heavy pages) but visibly degrade output. Not worth it for the gain.

6. **CPU SIMD optimisation of `tiny_skia` rasterisation.** This is what `tiny-skia` already does — its raster path uses portable SIMD (`std::simd` / `safe_arch`). The benchmark literature says `tiny-skia` is "20–100 % slower than Skia on x86-64 and about 100–300 % slower on ARM" (https://github.com/linebender/tiny-skia/blob/main/README.md). The gap is intrinsic to portable-Rust-SIMD vs C++/intrinsics — not closable by us in the medium term.

---

## What WORKS for BARN-class — ordered by realistic ms-impact

This is the prioritised list. Each item names the source it's stolen from and the realistic ms saved on the BARN baseline (338 ms avg cold render, dominated by 234 ms `serial_walk`).

### Tier 1: 200+ ms savings — architectural shift

**(R1) Move the rasteriser to a GPU backend (Skia native via FFI, or `vello`/`wgpu`).** Source: PDFium's Skia backend, Bluebeam's "hardware rendering". This is what `docs/superpowers/specs/2026-05-11-gpu-rendering-engine-design.md` already plans. Expected impact: 100-200 ms/page on cold render — `draw_image` (60-190 ms on image-heavy pages) and `fill_path` for glyphs (a similar order) both become GPU draws of the order of milliseconds. The 33 MB readback (`into_rgba`, 8 ms/page) becomes the new floor.

Risk: large port, FFI complexity (Skia is C++), parity testing burden vs current pixel-perfect output. Effort: weeks.

**(R2) Implement a SumatraPDF-style tile cache with background prerender threads.** Even keeping `tiny_skia` for now, this fixes the **perception** of slowness during scroll/zoom by:
- Showing a stale-but-recent tile immediately ("outOfDate but displayable").
- Rendering the new high-res tile on a background tokio task.
- Aborting in-flight renders when user keeps scrolling (no wasted work).

Source: `src/RenderCache.h/.cpp` in `sumatrapdfreader/sumatrapdf`. Expected impact: cold first-paint of a single page is **unchanged** (you still rasterise 33 MB once), BUT the user-perceived "I scrolled and it's stuck for 600 ms" goes away because the stale tile fills the gap. Worth the work even before R1 ships.

Effort: 3-5 days. Affects `parser.rs::PageBitmapCache`, `renderer.rs`, and the JS side (`pdf/loader.js`, `pdf/renderer.js`) that orchestrates renders.

### Tier 2: 30-80 ms savings — tactical wins in current architecture

**(R3) Replace `Pattern + fill_path` with `draw_pixmap` for the axis-aligned + integer-pixel image case.** Source: our own `barn-deep-dive.md` recommendation, validated by reading `mupdf/source/fitz/draw-device.c` — MuPDF special-cases axis-aligned image draws to a fast blit path, and we should too. The slow Pattern shader path exists in our code only for sub-pixel-edge correctness; it's not needed for 95+ % of images. Expected impact: ~50 ms/page on image-heavy pages, ~20 ms/page average.

Effort: ~1 hour. `renderer.rs::draw_image` lines 433-461.

**(R4) Promote `ImageCache` from per-page to document-scoped.** Source: MuPDF `fz_store` + PDFium `CPDF_ImageCacheEntry`. Key by `(xobj_id, l2factor)` so different zoom levels cache separately. Expected impact: **none** on first-paint of a page at a new zoom level (the decode still has to happen once); large impact on **zoom in/out cycles** at the same level (currently re-decodes every time). For the BARN measurement methodology of "render every page once at scale 1.5" this is a wash; for real user behaviour (zoom to 200 %, then back to 100 %) it eliminates the 52 ms `predecode_parallel` phase.

Effort: 2-4 hours. Move `ImageCache` into `DocumentHandle` like the `pixmap_cache` already is.

**(R5) Drop the `font_registry` Mutex across the interpret phase.** Source: our `barn-deep-dive.md` recommendation, derived from MuPDF's pattern of cloning the context per thread (the shared resource store is locked finely, not held by interpretation). Expected impact: doesn't reduce single-page time but makes parallel page renders actually parallel — fixes the "4 pages start rendering but only one progresses" pathology that causes the user-visible scroll lag.

Effort: 2-3 hours. `parser.rs::render_page_internal` L210-244; convert Mutex to RwLock and only write on new-font registration.

### Tier 3: 10-30 ms savings — micro-optimisations

**(R6) Cache the operator/display list per page.** Source: MuPDF display list. Currently `Content::decode(content_bytes)` runs every render — averages 16 ms/page (peaks at 57 ms for page 0). A `(page_index → Arc<DisplayList>)` cache scoped to the document handle eliminates it on every cache miss after the first.

Effort: 4-6 hours. Need to be sure the decoded operator list is fully self-contained (no live references to font/image state). Affects `interpreter.rs`.

**(R7) Quality tiers during interaction.** Source: PDFium `FPDF_RENDER_FORCEHALFTONE`, PDF.js CSS upscale. When the scroll/zoom is in motion, render with `FilterQuality::Nearest` instead of `Bilinear` and lower JPEG decode `l2factor`. When the motion settles (debounce ~150 ms), re-render at full quality. Expected impact: makes the slow path of cold-render visible at 1/3 the cost (~110 ms) during scroll, then upgrades when the user stops moving.

Effort: 1-2 days; needs JS-side motion tracking already partially present in `tools/tools/hand-tool.js` and a new param threaded through `render_pdf_page`.

### Tier 4: future / longer-term

**(R8) Banded raster of one page across multiple cores.** Source: MuPDF `multi-threaded.c` cookbook. Once we have a display-list cache (R6), we can rasterise different Y-bands of the same page on different rayon workers. For a 2376-pixel-high page on a 4-core CPU, this could approach a 3× speedup on the `serial_walk` phase IF `tiny_skia` Pixmap writes don't serialise. Risk: pixmap allocator + glyph cache need rework. Not free; budget a week.

---

## What this means for our current bottleneck

From `barn-deep-dive.md`:

```
serial_walk (interpret operator loop, includes draws) = 234 ms / 338 ms total = 69 %
  └─ Pattern+fill_path for images = 60-190 ms on image-heavy pages
  └─ Glyph fill_path = 100-300 ms on text-heavy pages
predecode_parallel (rayon image decode) = 52 ms / 338 ms = 15 %
into_rgba (Pixmap → Vec memcpy) = 8 ms / 338 ms = 2 %
```

If we stack the realistic Tier 2 fixes (R3 + R4 + R5):
- R3 alone: ~50 ms saved on image-heavy pages, ~20 ms average → **318 ms avg**.
- R4: 0 ms cold, but makes zoom revisits ~50 ms cheaper.
- R5: 0 ms single-page, fixes parallelism on scroll (perceived ~2× during scroll).

So pure Tier 2 takes us from 338 ms → 318 ms cold, **with substantially better perceived performance during scroll**. That's an honest assessment — the cold first-paint number doesn't drop dramatically, but the user feels it because the slow path doesn't block their interaction.

**Tier 1 R2 (SumatraPDF tile cache + prerender) is the largest perceptual improvement without an FFI rewrite.** Cold-render number unchanged; user-facing latency drops because (a) prerendered tiles paint instantly, (b) stale-tile-fallback fills the gap during the active render.

**Tier 1 R1 (GPU backend) is the only path to <100 ms cold render** at this output resolution. Nothing else closes the gap. Every viewer that fluently handles BARN-class drawings does it on the GPU.

To get to **sub-200 ms cold render** on BARN-class without a GPU port, we'd need: R3 + R6 (display-list cache) + R8 (banded raster) AND keep `tiny_skia`. Realistic estimate: 338 → 180-220 ms. That's the upper bound of CPU-only optimisation given that `tiny_skia` is structurally 20-100 % slower than C++ Skia on x86-64.

---

## Sources (consolidated)

PDF.js
- https://github.com/mozilla/pdf.js/issues/6419
- https://github.com/mozilla/pdf.js/issues/5720
- https://github.com/mozilla/pdf.js/discussions/17976
- https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions
- https://blog.mozilla.org/nnethercote/2014/02/07/a-slimmer-and-faster-pdf-js/
- https://apryse.com/blog/pdf-js/guide-to-pdf-js-rendering

PDFium
- https://github.com/chromium/pdfium
- https://deepwiki.com/chromium/pdfium/6.3-rendering-and-output-apis
- https://deepwiki.com/chromium/pdfium/6.1-document-and-page-apis
- https://blog.chromium.org/2025/07/introducing-skia-graphite-chromes.html
- https://chromeenterprise.google/intl/en_au/policies/pdf-use-skia-renderer-enabled/

MuPDF / PyMuPDF
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/store.c
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/image.c
- https://github.com/ArtifexSoftware/mupdf/blob/master/source/fitz/draw-device.c
- https://mupdf.readthedocs.io/en/latest/cookbook/c/multi-threaded.html
- https://mupdf.readthedocs.io/en/latest/reference/c/fitz/pixmap.html
- https://casper.mupdf.com/docs/mupdf_explored.pdf (Watts, "MuPDF Explored", Sep 2022)
- https://artifex.com/blog/multi-threaded-use-of-mupdf-in-java
- https://pymupdf.readthedocs.io/en/latest/app4.html
- https://documentation.help/pymupdf/app1.html

SumatraPDF (the most relevant single source)
- https://github.com/sumatrapdfreader/sumatrapdf/blob/master/src/RenderCache.h
- https://github.com/sumatrapdfreader/sumatrapdf/blob/master/src/RenderCache.cpp
- https://deepwiki.com/sumatrapdfreader/sumatrapdf
- https://blog.kowalczyk.info/article/2f72237a4230410a888acbfce3dc0864/lessons-learned-from-15-years-of-sumatrapdf-an-open-source-windows-app.html
- https://blog.kowalczyk.info/article/1im/how-i-improved-sumatra-performance-by-60.html
- https://forum.sumatrapdfreader.org/t/why-does-sumatrapdf-not-use-all-cpu-cores/269

Adobe (limited)
- https://patents.google.com/patent/HK1058849B/en (MRC patent)
- https://community.adobe.com/questions-12/poor-display-quality-when-scrolling-images-in-acrobat-reader-2025-1506811
- https://www.adobe.com/devnet-docs/acrobatetk/tools/PrefRef/Windows/Originals.html

Bluebeam
- https://support.bluebeam.com/articles/revu-tips-for-improving-performance/
- https://novedge.com/blogs/design-news/bluebeam-tip-maximizing-efficiency-with-large-format-drawings-in-bluebeam-revu
- https://vdci.edu/learn/bluebeam/bluebeam-system-requirements

Rust raster / JPEG ecosystem (informs feasibility of recommendations)
- https://github.com/linebender/tiny-skia (perf vs Skia)
- https://lib.rs/crates/zune-jpeg
- https://lib.rs/crates/jpeg-decoder
- https://crates.io/crates/jpegli-rs

PDF-XChange / Foxit
- https://forum.pdf-xchange.com/viewtopic.php?t=29413

---

## What I could not find

- **Concrete Adobe Acrobat architectural details.** The MRC patent and user-facing prefs are all I could source; no engineering blog posts, no internal documentation. Closed-source-only.
- **Bluebeam Revu internals.** Support pages and marketing only. The fact that "hardware rendering" is a knob strongly implies GPU + software fallback, but the data structures and policies are unknown.
- **Foxit / PDF-XChange architecture.** Marketing material only; no concrete sources.
- **MuPDF's exact tile cache policies** beyond the general `fz_store` mechanism. The store is generic and `fz_storable` is documented; how MuPDF callers (the standard `mupdf` viewer app, `mutool`, PyMuPDF) configure tile bands at the viewer level isn't covered in the public Read-the-Docs.
- **PDFium's prerender policy.** The progressive-rendering API is documented; whether Chrome's PDF embedding prerenders adjacent pages and at what priority is in the Chrome (not PDFium) source, which I did not read.
- **Independent benchmark numbers** for MuPDF vs PDFium vs our renderer on identical BARN-class corpora. The 175 ms PyMuPDF number cited by the user is plausible (matches PyMuPDF documentation's "medium quality 150 DPI" reference workload) but I did not reproduce it.
