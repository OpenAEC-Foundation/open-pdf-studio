# Continuous-mode zoom + scroll redesign

Status: approved 2026-05-20 (brainstorm). Implementation pending.

## Summary

The continuous-view zoom and horizontal-scroll behaviour in `js/pdf/renderer.js` plus `styles/layout.css` and the continuous branches of `js/ui/setup/navigation-events.js` will be reworked so that:

1. **No automatic horizontal centering** of pages happens after the initial document-open paint. Once the user has zoomed or panned, the view stays exactly where they put it — no flex-centring, no clamp-and-center, no translateX fallback.
2. **A single zoom function** (`applyContinuousZoom`) replaces the four overlapping zoom paths (`zoomIn` / `zoomOut`, `setZoom`, `_applyZoom`, and the recently-added `continuousZoomStep`). Wheel events, ribbon `+`/`−` buttons, status-bar `%` input and fit-page/fit-width all funnel through it.
3. **Page 20 dim-drift** (visible on `Text pdf gecombineerd.pdf` after several zoom gestures) is fixed as a side-effect — every debounced commit re-asserts each wrapper's CSS dims from `page.getViewport({ scale: doc.scale }).width`, the single source of truth.

Single-page mode (vector viewport in `js/pdf/pdf-viewport.js`) is **not touched**; it already does the right thing once `_anchorActive` flips, which happens on the first user interaction.

## Goals

- **Predictable layout**: pages stack vertically left-aligned. Horizontal scroll is free in both directions. `#pdf-container.scrollLeft` is never reset by the app.
- **One zoom path**: wheel, buttons, % input, fit-* all dispatch through `applyContinuousZoom({ newScale, anchorClientX?, anchorClientY? })`.
- **Cursor anchor when the user provides one** (wheel events); **viewport-center anchor** when there is no cursor (buttons / % input / fit-* / programmatic).
- **No code that decides where the view should go on its own** after the initial post-load paint.
- **Page-20 dim drift fixed** for `Text pdf gecombineerd.pdf` and any other uniform-A4 doc.

## Non-goals

- Re-architecting the continuous render pipeline to use the single-page `pdf-viewport.js` singleton + tile orchestrator (the "scope C" option from brainstorming). Done as a follow-up release if the unified model still feels insufficient.
- Touching the per-page render machinery (`renderContinuousPage`, IntersectionObserver, Rust pdfium pipeline). Performance characteristics of the actual rendering stay the same.
- Adding new UI affordances (no new buttons, no new menus). Status-bar percentage indicator stays as-is; only its underlying handler is rewired.
- Text-select → highlight UX (parked from earlier conversation; separate spec when revisited).

## Current state

Verified during brainstorming:

- `.continuous-container` in [styles/layout.css:424-431](styles/layout.css:424) has `align-items: center` — every page-wrapper is horizontally centred by flex. At low zoom (page narrower than viewport) `scrollLeft` is pinned at 0; at high zoom the page overflows symmetrically left/right.
- Zoom dispatch is split across four functions in [js/pdf/renderer.js](js/pdf/renderer.js):
  - `zoomIn` / `zoomOut` (lines ~1161 + ~1178) for the ribbon + / − buttons, calling `reRenderVisibleContinuousPages`.
  - `setZoom` (line ~1204) for the status-bar `%` input, calling `renderContinuous()` — a **full DOM rebuild** (`innerHTML = ''`, re-create 28 wrappers).
  - `_applyZoom` (line ~1270) for fit-page / fit-width.
  - `continuousZoomStep` (added during brainstorming, ~line 615) for ctrl+wheel.
- Each writes `doc.scale` slightly differently, with different downstream paths, and with different "what gets re-rendered" rules.
- A `translateX` fallback survives in `continuousZoomStep` for the no-on-page-anchor path; this is the residue of an earlier scroll-spring workaround. It produces drift when the cursor sits on white margin and is removed by this redesign.
- `pypdf` check on `Text pdf gecombineerd.pdf`: pages 19, 20, 21 all have MediaBox 595.3 × 841.9, `/Rotate=0`. The "page 20 is too big" symptom is therefore a state-drift bug in our continuous renderer, not source data.

## Design

### 1. Layout — no auto-centering

```diff
 .continuous-container {
   display: none;
   flex-direction: column;
   gap: 20px;
-  align-items: center;
   padding-top: 20px;
   width: 100%;
 }
```

Pages stack left-aligned. `#pdf-container` keeps its existing `overflow: auto` so horizontal + vertical scroll-bars appear when content is wider/taller than the viewport. The user can freely scroll to any edge; nothing in JS resets `scrollLeft` or `scrollTop` outside of the zoom-anchor adjustment described in §3.

Single-page mode (`pdf-viewport.js`) is unchanged.

### 2. Unified zoom function

New export in `js/pdf/renderer.js`:

```js
export function applyContinuousZoom({ newScale, anchorClientX, anchorClientY }) {
  // Continuous-mode entry point for ALL zoom operations.
  //  - Updates doc.scale synchronously
  //  - CSS-multiplies every wrapper's width/height + inner canvases by ratio
  //  - Adjusts container.scrollLeft/scrollTop so the anchor stays in place
  //  - Schedules a debounced commit (200 ms) which calls
  //    reRenderVisibleContinuousPages → IO re-observe → Rust render at the
  //    final scale (one render per visible page)
}
```

Callers:

| Caller | Call |
|---|---|
| wheel handler ([navigation-events.js](js/ui/setup/navigation-events.js)) | `applyContinuousZoom({ newScale: doc.scale + sign*0.25, anchorClientX: e.clientX, anchorClientY: e.clientY })` |
| ribbon `+` / `−` ([HomeTab.jsx](js/solid/components/ribbon/HomeTab.jsx)) | `applyContinuousZoom({ newScale: doc.scale ± 0.25 })` |
| status-bar `%` input ([StatusBar.jsx](js/solid/components/StatusBar.jsx)) | `applyContinuousZoom({ newScale: pct / 100 })` |
| fit-page ([renderer.js](js/pdf/renderer.js) `fitPage`) | `applyContinuousZoom({ newScale: computeFitZoom('page', pageW, pageH, contW, contH) })` |
| fit-width (`fitWidth`) | `applyContinuousZoom({ newScale: computeFitZoom('width', ...) })` |
| actualSize (Ctrl+0) | `applyContinuousZoom({ newScale: 1 })` |

`zoomIn`, `zoomOut`, `setZoom`, `_applyZoom` keep their existing exports but their **continuous branch** becomes a thin call to `applyContinuousZoom`. The single-page branch is unchanged.

### 3. Anchor model

When `anchorClientX/Y` are provided, the anchor is the page-point currently under the cursor. Implementation:

1. Before any DOM mutation: `elementFromPoint(anchorClientX, anchorClientY)`. If it lands inside a `.page-wrapper`, capture `anchorPageX = (anchorClientX − innerRect.left) / oldScale`, similar for Y. If the cursor is on white margin / between pages, skip page-anchor — fall back to container-space pivot (`(scroll + c) * ratio − c`).
2. CSS-multiply every wrapper's `canvas-container-cont` and inner canvases by `ratio = newScale / oldScale`.
3. Read the anchor wrapper's new `getBoundingClientRect` (forced reflow — one per zoom call, ~1 ms).
4. `container.scrollLeft += (newInner.left + anchorPageX * newScale) − anchorClientX`. Same idea for `scrollTop`.

When `anchorClientX/Y` are omitted, default to the centre of `#pdf-container.getBoundingClientRect()`. Same math; pivot at viewport centre.

**Crucially**, nothing else in the file re-positions content after this. `reRenderVisibleContinuousPages` writes wrapper CSS dims but does **not** touch `scrollLeft` / `scrollTop`. The post-load `fitToViewport`-style initial paint is the only place the app picks a starting position; from there on, position is user-controlled.

### 4. Initial-paint fit

On document-open (`loader.js` end-of-`loadPDF`), once `#pdf-container` has non-zero dimensions, compute `doc.scale = computeFitZoom('page', pageW_pt, pageH_pt, container.clientWidth, container.clientHeight)` and call `applyContinuousZoom({ newScale: that })` (centre-anchored). Result: the user opens a doc and sees the first page comfortably fitted. From there nothing else auto-positions.

### 5. Page-20 dim drift fix

The drift comes from per-wheel CSS multiplication accumulating rounding errors differently across wrappers (especially for off-screen wrappers whose CSS `style.width` may have been initialised at different render passes). The redesign fixes it by enforcing:

> Every `reRenderVisibleContinuousPages` call (i.e. every commit, every 200 ms after the last wheel) iterates **all** 28 wrappers and re-writes `cc.style.width = page.getViewport({ scale: doc.scale }).width + 'px'`. This is the single source of truth.

Per-wheel multiplication still happens for the freeze-frame visual feedback, but it can only drift for ≤ 200 ms before the next commit overrides it. The visible drift on page 20 vanishes.

Plus a dev-mode invariant in `reRenderVisibleContinuousPages`: if `doc.viewMode === 'continuous'` and `doc.pdfDoc.numPages > 1`, and `import.meta.env.DEV` is true, after the per-page CSS write, sample the first and last wrapper widths; if they differ by more than 0.5 px on a uniform-A4 doc, `console.warn('[continuous] wrapper width drift detected: ...')`. No-op in production.

## Code to remove

| What | Where | Reason |
|---|---|---|
| `align-items: center` | [styles/layout.css:428](styles/layout.css:428) | forced centring |
| Body of `continuousZoomStep` | [js/pdf/renderer.js](js/pdf/renderer.js) (~line 615) | moves into `applyContinuousZoom` |
| Continuous branch of `_applyZoom` | [js/pdf/renderer.js:1278](js/pdf/renderer.js:1278) | replaced by `applyContinuousZoom` |
| Continuous branch of `setZoom` | [js/pdf/renderer.js:1217](js/pdf/renderer.js:1217) | replaced by `applyContinuousZoom` (no more `renderContinuous()` full rebuild on % change) |
| Continuous branch of `zoomIn` / `zoomOut` | [js/pdf/renderer.js:1170, ~1192](js/pdf/renderer.js:1170) | replaced by `applyContinuousZoom` |
| `translateX` residual fallback in continuous handlers | wherever it appears | source of the historical "spring naar links" drift |
| Stale `_zoomGestureActive` / `_zoomGestureEndTimer` state if still referenced anywhere outside the new function | renderer.js | consolidated into `applyContinuousZoom` |

## Code that stays

| What | Where | Reason |
|---|---|---|
| Page-wrapper DOM + IntersectionObserver | renderer.js | render pipeline untouched |
| `renderContinuousPage` + Rust pdfium pipeline | renderer.js | render pipeline untouched |
| `reRenderVisibleContinuousPages` | renderer.js | becomes the commit step, called only by `applyContinuousZoom`'s debounce |
| `renderContinuous` (rename to `rebuildContinuousLayout`) | renderer.js | layout rebuild on doc-open / mode-switch / engine-switch only |
| Single-page `pdf-viewport.js` singleton | unchanged | already behaves correctly per the user's mental model |
| `_anchorActive`, `_captureZoomFreeze`, `clampAndCenter` in `pdf-viewport.js` | unchanged | single-page is out of scope |

## Testing

POC branch `feat/continuous-zoom-redesign-poc`. Tests driven from the existing `app_*` MCP tools on the live binary (port 9223). Test PDF: `test pdf-bestanden/Originele bestanden/Text pdf gecombineerd.pdf` (uniform A4, 28 pages).

| Id | Scenario | Pass criterion |
|---|---|---|
| T1 | Open doc, scroll to p2 at scale 1.0, ctrl+wheel 4× zoom-in at `clientX = container.left + 0.3 * width` | Anchor-point stays under cursor (≤ 3 px screen drift). Scale = 2.0. |
| T2 | Symmetry: T1 then ctrl+wheel 4× zoom-out at the same cursor | `scrollTop`, `scrollLeft`, `scale` all return to pre-T1 values (exact for scrollTop/Left, scale exactly 1.0) |
| T3 | Same as T2 but cursor at `clientX = container.left + 0.8 * width` | Same pass criterion as T2 |
| T4 | Cursor on white margin to the left of the page (`clientX < pageLeft` at scale 1.0): wheel-in | `scrollLeft` delta = 0 — no sideways snap |
| T5 | `applyContinuousZoom({ newScale: 2 })` (no anchor coords) | Content at viewport centre before is at viewport centre after (≤ 3 px) |
| T6 | After T1, manually set `scrollLeft = scrollWidth − clientWidth` (scroll to right edge), wait 1 s, probe | `scrollLeft` unchanged (no auto-recenter) |
| T7 | Open doc, scroll to p20, probe wrapper widths of p19/p20/p21 | All three within 0.5 px |
| T8 | Engine-switch: zoom to 2.0, switch dropdown Auto → PDFium, wheel-in | Wheel-in works, scale advances, canvas not blank |
| T9 | Single-page mode on a non-A4 doc (`Tekst.pdf` if available, else BARN): ctrl+wheel + ribbon + / − + status `%` | Unchanged behaviour from current main; single-page anchored as before |
| T10 | 10 rapid wheel events via MCP (no sleep between calls) | Dispatch < 150 ms total. Console buffer shows **1** `cont-rerender` log (commit) — not 10. Per-page render fires only once per visible page at the final scale. |

Each test takes screenshots before and after; saved to `tests/protocol/continuous-zoom/`. A green run = all ten pass.

## Implementation flow

1. Create worktree `feat/continuous-zoom-redesign-poc` (separate from `feat/fast-open-barn`).
2. Implement per the spec, no ad-hoc changes outside it.
3. Run T1–T10 via MCP, save screenshots.
4. If all green: merge worktree branch back. If anything fails: fix in the worktree, re-run; main repo stays untouched.

## Open questions

None at design time. Anything that comes up during implementation gets logged in the plan, not silently decided.
