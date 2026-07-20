# OpenPDFStudio — Codebase Review (2026-05-06)

Scope: `open-pdf-studio/js/`, `open-pdf-render/src/`, `open-pdf-studio/src-tauri/src/`.
Method: ripgrep-driven audit of imports/exports, recently-modified hot files (`renderer.js`, `loader.js`, `left-panel.js`, `tools/manager.js`, `compare/*`, `fonts.rs`), and structural smell scan.

This is a pure review — no code changes were made. Findings grouped by severity.

---

## CRITICAL

### C1. `js/pdf/mupdf-renderer.js` is effectively dead, and renderer.js has a duplicate ghost copy of the same code
- File: `js/pdf/mupdf-renderer.js` (~115 lines).
- Only one symbol from the module is referenced anywhere: `closeDocument()`, called from `js/pdf/renderer.js:1312` inside `clearPdfView()`.
- `isMupdfAvailable()`, `renderPageWithMupdf()`, `getMupdfDocument()`, `loadModule()` — none of them have any importer.
- Worse: `js/pdf/renderer.js:29-90` contains a **second, parallel copy** of the same MuPDF logic (`loadMupdf`, `isMupdfAvailable`, `getMupdfDocument`, `renderPageWithMupdf`) that is also never called from anywhere in the file. Dead code in two places — probably a migration that was started, then abandoned when the Rust path landed.
- Suggested action: **delete `mupdf-renderer.js`** and the dead MuPDF block at `renderer.js:21-90`. Drop the `closeDocument()` call from `clearPdfView()`. Removes a `mupdf` runtime dependency too.

### C2. `js/pdf/tile-renderer.js` is fully orphan code (~300 lines)
- File: `js/pdf/tile-renderer.js`.
- Exports `getVisibleTiles`, `renderTile`, `renderVisibleTiles`, `cancelAllTileRenders`, `invalidateTilesForScale`, `invalidateTilesForPage`, `clearTileCache`, `getTileCacheSize`.
- Grep across `js/` shows zero importers — all references are inside the file itself (warning logs).
- Maintains a 80-entry LRU `_tileCache` Map and an `_activeTileRenders` Map that are never populated by external callers, but both grow unbounded if some code path were ever to start using them.
- Suggested action: **delete the file**. The vector-renderer + page-bitmap-cache pair has fully replaced tiling.

### C3. Render-task tracking has a race window
- File: `js/pdf/renderer.js`.
- Two write sites reset `currentRenderTask` (lines 114, 178, 443, 511) but `renderPage()` and the continuous-mode renderer can both be in-flight simultaneously when the user pages quickly. The `cancel()` + `await currentRenderTask.promise` pattern at line 171 only protects against the *previous* call — if a continuous-mode render starts between the cancel and the new `page.render()`, it overwrites `currentRenderTask` and the original is lost.
- Symptom: occasional "stuck" canvases or `Cannot use a destroyed transport` warnings when navigating quickly; these are currently swallowed because the catch at line 175 ignores all errors.
- Suggested action: switch to per-page render-task map (`Map<pageNum, RenderTask>`), or guard with a monotonically-increasing `_renderSeq` token checked after each `await`.

### C4. Silent `catch (_) {}` blocks swallow real errors
- 14 locations across 11 files. The most concerning:
  - `js/tools/keyboard-handlers.js:59,71,108` — chord-buffer dispatcher silently eats errors from chord callbacks (any exception in a CAD shortcut just disappears).
  - `js/pdf/loader/annotation-converter.js:145,995` — annotation conversion failures vanish.
  - `js/annotations/clipboard.js:30`, `js/annotations/rendering.js:881` — paste/render failures invisible.
  - `js/search/find-controller.js:461`, `js/text/text-selection.js` — search/selection errors invisible.
- Suggested action: replace with `catch (e) { console.warn('[<scope>]', e); }` so problems surface in DevTools without breaking flow.

### C5. `_setSelectFallthroughEnabled` global mousemove listener — known regression source
- File: `js/tools/manager.js:61-161`.
- Adds a *capture-phase* `mousemove` handler on `document` that on every mouse move runs `findAnnotationAt()` + `findHandleAt()` + `getBoundingClientRect()` + DOM mutation on every `.textLayer` span. This fires hundreds of times per second during normal cursor movement. With a moderately busy PDF (≥500 spans on the visible page) this is a real CPU cost.
- The cleanup branch at line 152-159 walks every text-layer span to reset `pointerEvents` and `cursor` styles — also O(spans) per tool switch.
- The whole mechanism is the root cause of recent text-selection / edit-text bugs (see commit `aa1a6921`, `ed40e3ca`, `ebcb49ea`). The fundamental pattern (toggle pointer-events on every mousemove) is fragile.
- Suggested action: replace with CSS `pointer-events: none` on annotation-canvas + a single delegated click handler that does hit-testing once per click (not per mousemove). Or keep current approach but throttle to `requestAnimationFrame` and bail out earlier.

---

## HIGH

### H1. 37 forgotten `[PERF]`/`[JANK]` console.logs in release code
- `js/pdf/loader.js`: 19 `console.log('[PERF]…')` calls (lines 164, 200, 212, 247, 250, 257, 265, 272, 550, 552, 568, 571, 586, 600, 607, 616, 617, 631, 633).
- `js/pdf/renderer.js`: 12 `[PERF]` logs (lines 157, 220, 224-240, 403-405, 425) plus the always-on `_startJankDetector()` setInterval at line 152 which fires every 500ms forever.
- These were added to diagnose the recent thumbnail-pause / vector-path issues. They should be either gated behind `state.preferences.debugPerf` or stripped before next release.
- Suggested action: extract to a `debugLog(category, msg)` helper that no-ops in production builds, OR delete after confirming no longer needed.

### H2. `isMupdfAvailable` defined twice with the same body
- `js/pdf/renderer.js:40-45` and `js/pdf/mupdf-renderer.js:26-31`. Identical implementation.
- See C1 — both should go.

### H3. `composeOverlay` is documented as deprecated but still exported
- `js/compare/overlay-renderer.js:48`. Body returns `null`. Comment says "kept only so legacy importers don't break". Grep confirms there are no legacy importers — nothing imports it.
- Same file: `OLD_TINT`, `NEW_TINT`, `INK_THRESHOLD`, `tintCanvas` exports also have no importers (grep finds only the export statements themselves).
- Suggested action: delete the four orphan exports.

### H4. `_lowResCache` / `_renderedPages` / `_renderedPagesScale` — verify lifecycle
- `js/pdf/renderer.js:1324-1326` clears these on `clearPdfView()`. Need to confirm they're also cleared when switching documents (active doc index change), otherwise stale entries from doc A leak into doc B's render path. Worth a focused unit test.

### H5. Repeated `state.documents?.[state.activeDocumentIndex]?.scale || 1.5` — magic constant
- 16 occurrences of the literal `|| 1.5` fallback for scale across `geometry.js`, `transforms.js` (3x in alignment tol calcs), `stamps.js`, `mobile/touch-gestures.js` (3x), `StickyNotePopup.jsx` (2x), `MobileApp.jsx`, `compare-viewport.js`, `annotations-list.js`, `context-menus.js`, `ribbon/FormatTab.jsx`.
- Default scale should be a single named constant, e.g. `DEFAULT_VIEW_SCALE` exported from `core/constants.ts`. If anyone ever needs to change it, today they have to grep across 12 files.
- Suggested action: extract to `core/constants.ts` and make the helper `getDocumentScale(doc)` that returns `doc?.scale ?? DEFAULT_VIEW_SCALE`.

### H6. `js/pdf/renderer.js` is 1458 lines and still growing
- Mixes single-page and continuous-mode rendering, MuPDF dead code, vector path, Rust path, PDF.js path, jank detector, low-res cache, page-bitmap-cache wiring, plus `clearPdfView`. Six responsibilities in one file.
- Suggested action: split into `renderer/single-page.js`, `renderer/continuous.js`, `renderer/instrumentation.js` (jank + perf logs once moved behind a flag).

### H7. Two parallel shared-state idioms
- `js/core/state.ts` (createMutable) — the official path per CLAUDE.md.
- But: `js/stores/sessions.js`, `js/services/input-history.js`, `js/services/connectivity.js`, `js/solid/stores/whatsNewStore.js`, `js/solid/stores/aiStore.js` use plain `createSignal` outside the central store and are imported by both vanilla JS and Solid components, bypassing `bridge.ts`.
- This violates the architectural rule: "Vanilla JS MUST go through bridge.ts to reach SolidJS stores". CLAUDE.md is explicit about this.
- Suggested action: re-route these stores through `bridge.ts` or move their state into `core/state.ts`. At minimum, document the exception.

---

## MEDIUM

### M1. `JSON.parse(JSON.stringify(annotation))` deep-clone in hot paths
- `js/annotations/factory.js:51` (every new annotation) and `js/tools/tools/array-tool.js:37` (every cloned cell of an array tool).
- For large annotations with embedded image data this is O(n²) and discards `Date`/`undefined`/non-JSON fields. Use `structuredClone()` (available in all modern browsers and Tauri's WebView2/WKWebView).

### M2. Thumbnail pause/resume race
- `js/pdf/renderer.js:219` calls `pauseThumbnails()` BEFORE the awaited `analyze_page_type` IPC. If the user pages again during that await, a second `pauseThumbnails()` call clears + re-arms the 500ms timer (`left-panel.js:281`). When the first await chain resolves it calls `resumeThumbnails()`, which clears the timer set by the *second* navigation — leaving thumbnails fully unpaused while the second page render is still grabbing the Rust backend.
- Net effect: thumbnails can compete with active-page render exactly during fast navigation, the case the pause was supposed to solve.
- Suggested action: use a counter (`_pauseCount++` / `_pauseCount--`), only resume when count reaches zero.

### M3. `_jankTimer` never cleared
- `js/pdf/renderer.js:140-152`. `_startJankDetector()` is invoked at module load and the `setInterval` is never cleared. This is module-scope so it lives the entire app lifetime — minor, but it's a "tick every 500ms forever" loop that will print warnings during legitimate long IPC calls (which are not actually main-thread blocks). False positives in logs.
- Suggested action: gate behind a debug flag.

### M4. Compare-viewport image cache may grow with detection scale changes
- `js/compare/compare-viewport.js:33-51`. `_imageDataCache` is keyed by `${filePath}|${pageNum}|${scale}`. Each entry is a full ImageData (W×H×4 bytes). Cap is 6 entries — fine for two PDFs at fixed scale, but if `DETECTION_MAX_DIM=1600` is hit at multiple zoom levels, 6 different scale buckets per page could pile up to ~60MB.
- Suggested action: consider keying by `(filePath, pageNum)` only and replacing on scale change rather than co-existing.

### M5. `[Thumbnails]` warns will spam DevTools on bad PDFs
- `js/ui/panels/left-panel.js`: 9 warns. None are throttled. A PDF with broken annotations will dump one warn per page per redraw attempt.
- Suggested action: warn once per (docId, pageNum) using a `Set` guard.

### M6. `try { coords.canvas.setPointerCapture(...) } catch (_) {}` (tool-dispatcher.js:121)
- This pattern is deliberate — `setPointerCapture` throws in some browser states. But the empty catch hides legitimate test-environment failures (selftest runs see this). Comment it (`// pointer capture not supported in test env`) so reviewers don't flag it again.

---

## LOW

### L1. Locale parity not auto-tested
- `js/i18n/locales/en/ribbon.json` has 431 keys. Other 36 languages are diffed manually. CLAUDE.md says "ALWAYS update ALL 37 language files". A scripted check (`scripts/check-i18n.js`) that compares key sets per namespace would prevent silent drift.

### L2. `renderer.js:1338` swallows bitmap-cache clear error
- `import('./page-bitmap-cache.js').then(m => m.clearAllBitmaps()).catch(() => {});` — empty `.catch()`. Same problem class as C4.

### L3. Type1 / CIDFontType2 paths in `fonts.rs` coexist cleanly
- Reviewed: `is_cid` and `cid_to_gid_identity` flags are set together at `fonts.rs:107-114`, used together at `fonts.rs:594` (`cid_to_glyph_id`). Type1 path (FontFile, line 316-329) is a fallback after FontFile2/FontFile3, doesn't touch CID fields. No conflict.
- The `is_cid: false` reset at `fonts.rs:765` is a sentinel `FontEntry` for the missing-font path. Looks right.
- No action needed — but worth keeping a regression test (`tests/test_type1_text.rs` was added in 2f69a62a; ensure CI runs it).

### L4. Compare module — overlay-renderer dead exports
- See H3. Cleanup is trivial.

### L5. `_renderedPages` / `_renderedPagesScale` lack a JSDoc explaining their purpose
- Future maintainers won't know whether to clear them on doc switch.

### L6. `[mupdf]` console messages will linger after C1 cleanup
- Once the mupdf module is deleted, any `console.log('[mupdf] WASM module loaded successfully')` in old build artifacts can be removed.

---

## Architecture observations

1. **Three render paths coexist**: Rust open-pdf-render (preferred), PDF.js (fallback), MuPDF (dead). Once C1+C2 land, the diagram simplifies to two paths plus `vector-renderer.js` for the cached vector mode. That's the documented intent — current code does not match.

2. **Compare/Overlay refactor leftovers**: `composeOverlay` returning `null` and the dead tint constants are dead-stub remnants from the pixel-diff era. Cleanup is safe.

3. **Tool-dispatcher + manager.js coupling**: `_setSelectFallthroughEnabled` mixes DOM-style management (pointer-events, z-index) with tool-state management. Splitting layer-stacking into `js/ui/layer-manager.js` would let the tool layer stay state-only.

4. **`renderer.js` as god-file**: 1458 lines is the biggest hot spot. Three subsequent commits in the last 2 days have all touched it. Every change increases the merge-conflict risk for ongoing parallel work. Splitting (H6) is overdue.

5. **i18n discipline relies on humans**: 8 namespaces × 37 languages = 296 files. Without a CI check, drift is inevitable. Recent commits modified `en/ribbon.json` + `nl/ribbon.json` + `whatsNewStore.js` together (commit 076557d2) — the other 35 ribbon.json files were not in the same commit; at minimum they need a stub fallback.

---

## Top remediation priorities

1. **Delete `mupdf-renderer.js` + the duplicate MuPDF block in `renderer.js`** (C1, H2) — biggest dead-code win, removes a runtime dependency.
2. **Delete `tile-renderer.js`** (C2) — 300 lines of orphan code.
3. **Strip or gate `[PERF]` / `[JANK]` console logs** (H1, M3) — release hygiene.
4. **Replace empty `catch (_) {}` blocks with logging** (C4) — bug-discovery surface.
5. **Audit `_setSelectFallthroughEnabled`** (C5) — recurring regression source.
6. **Fix thumbnail pause counter race** (M2) — recent regression area.
7. **Extract `DEFAULT_VIEW_SCALE` constant** (H5) — 16-site refactor, easy.
8. **Split `renderer.js`** (H6) — long-term maintainability.
9. **Re-route stray Solid stores through bridge.ts** (H7) — architecture compliance.
10. **Switch deep-clones to `structuredClone`** (M1) — minor perf + correctness.

End of report.
