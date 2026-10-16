# Open PDF Studio

> Desktop PDF annotation editor built with Tauri 2 + SolidJS + Vite + PDF.js + pdf-lib + i18next.
> Version: 1.33.0 | License: MIT | Author: OpenAEC Foundation

---

## Architecture

```
+-----------------------------------------------------------------------+
|                         Tauri 2 Shell                                  |
|  src-tauri/src/lib.rs (28 Rust commands)                               |
|  +------------------------------------------------------------------+ |
|  |  Rust Backend (tauri::command handlers)                           | |
|  |  - File I/O (read_file, write_file, lock_file, unlock_file)      | |
|  |  - Session/Preferences persistence                               | |
|  |  - Printer management (Windows ShellExecuteW, CIM)               | |
|  |  - Plugin install/uninstall (zip extraction)                      | |
|  |  - Virtual printer (PowerShell + UAC elevation)                   | |
|  +----------------------------+-------------------------------------+ |
|                               | IPC: window.__TAURI__.core.invoke()   |
|  +----------------------------v-------------------------------------+ |
|  |  WebView (Vite + SolidJS + Vanilla JS)                           | |
|  |                                                                   | |
|  |  +--------------+  +-------------+  +------------------------+   | |
|  |  |  SolidJS UI  |  |  bridge.ts  |  |  Vanilla JS            |   | |
|  |  |  (reactive)  |<-|  (facade)   |<-|  (PDF/canvas/tools)    |   | |
|  |  |  App.jsx     |  |  re-exports |  |  annotations, events   |   | |
|  |  |  stores/*    |  |  store APIs |  |  tool-dispatcher       |   | |
|  |  +------+-------+  +-------------+  +----------+-------------+   | |
|  |         |                                       |                 | |
|  |  +------v---------------------------------------v-------------+  | |
|  |  |              core/state.ts (createMutable)                  |  | |
|  |  |  Central app state with getter/setter delegation            |  | |
|  |  |  to per-document DocumentState objects                      |  | |
|  |  +----------------------------+-------------------------------+  | |
|  |                               |                                   | |
|  |  +----------------------------v-------------------------------+  | |
|  |  |               PDF Processing Layer                          |  | |
|  |  |  +--------------------+  +-------------------------------+  |  | |
|  |  |  |  PDF.js v5.4       |  |  pdf-lib v1.17               |  |  | |
|  |  |  |  - Rendering       |  |  - Creating blank PDFs       |  |  | |
|  |  |  |  - Text layer      |  |  - Saving with annotations   |  |  | |
|  |  |  |  - Form fields     |  |  - Color extraction          |  |  | |
|  |  |  |  - Annotation      |  |  - Form field values         |  |  | |
|  |  |  |    parsing          |  |  - Page rotation             |  |  | |
|  |  |  +--------------------+  +-------------------------------+  |  | |
|  |  +------------------------------------------------------------+  | |
|  |                                                                   | |
|  |  +------------------------------------------------------------+  | |
|  |  |  i18next (37 languages, 8 namespaces)                       |  | |
|  |  |  + useTranslation.js (SolidJS signal bridge)                |  | |
|  |  |  + RTL support (Arabic, Farsi, Hebrew, Urdu)                |  | |
|  |  +------------------------------------------------------------+  | |
|  +-------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

### Hybrid Architecture

SolidJS renders the UI shell (Ribbon, dialogs, panels). Vanilla JS handles all PDF canvas operations, annotation interactions, and tool logic. The two layers communicate through `bridge.ts` and shared `core/state.ts`.

---

## Critical Rules

### Buffer Management

- **ALWAYS** clone bytes with `.slice()` before passing to PDF.js. PDF.js transfers the ArrayBuffer to a web worker, which detaches the original Uint8Array (makes it length 0). Without `.slice()`, the save operation fails silently with empty bytes.
- **ALWAYS** use `originalBytesCache` for pdf-lib operations. This cache holds the raw PDF bytes that pdf-lib needs for saving. **NEVER** re-read from disk — the cache IS the source of truth.
- **ALWAYS** update `originalBytesCache` after saving (with the new bytes from `pdfDocLib.save()`).

### State Management

- **ALWAYS** use `createMutable` (from `solid-js/store`) for shared state. **NEVER** use plain objects — SolidJS reactivity will not track changes on plain objects, causing the UI to go stale.
- **ALWAYS** use `bridge.ts` from vanilla JS to call SolidJS store functions. **NEVER** import SolidJS stores directly from vanilla JS files — bridge.ts is the decoupling layer; if store internals change, only bridge.ts needs updating.

### Coordinate Systems

Three coordinate systems interact in this app:
1. **PDF coordinates** — bottom-left origin, points (used in PDF files)
2. **Viewport coordinates** — top-left origin, scaled pixels (PDF.js after `page.getViewport()`)
3. **App annotation coordinates** — top-left origin, scale=1 (stored in `state.annotations`)

- **ALWAYS** use CropBox (not MediaBox) for coordinate transforms when saving. The CropBox defines the visible page area.
- **NEVER** forget the Y-axis flip when converting app coordinates to PDF coordinates: `pdfY = cropBox.y + cropBox.height - appY`

### File Locking

- **ALWAYS** lock the file (`invoke('lock_file')`) before writing, unlock (`invoke('unlock_file')`) before the write, then re-lock after writing.
- **NEVER** leave a file unlocked after a successful save — re-lock immediately.

### Internationalization

- **ALWAYS** update ALL 37 language files when adding a new translation key. There are 8 namespaces per language (~296 JSON files total).
- **NEVER** add a key to only `en/` and assume others will catch up — missing keys cause visible `key.path` strings in the UI.

### Async Safety

- **ALWAYS** check `loadId` and `isClosed()` after every `await` boundary during annotation loading. Stale async operations from a previous document load MUST be aborted.

### PDFium worker pool (v1.59+)

- The Tauri main process spawns 4 `pdfium-worker.exe` sidecars at app
  start. `render_pdf_page` routes through `WorkerPool::render` when the
  pool is ready, with in-proc fallback when not.
- **NEVER** assume `render_pdf_page` runs in the main process — it may
  return from a worker via shared memory.
- Workers are TRANSPARENT to JS: `invoke('render_pdf_page', ...)` is
  unchanged.
- Worker bug? Test in isolation: `cargo test -p pdfium-worker -- --ignored`
  spawns one worker subprocess and renders Tekst.pdf p1.

---

## Key Files Map

| File | Role |
|------|------|
| `js/main.js` | Application entry point, initialization sequence |
| `js/bridge.ts` | Facade: vanilla JS imports this to call SolidJS store functions |
| `js/core/state.ts` | Central mutable state (`createMutable`), bridges both layers |
| `js/core/platform.js` | Unified Tauri API wrapper with web fallbacks (508 lines) |
| `js/pdf/loader.js` | PDF loading orchestrator, manages both PDF.js and pdf-lib documents |
| `js/pdf/loader/annotation-converter.js` | Converts PDF.js annotations to app annotation model |
| `js/pdf/loader/color-extraction.js` | Uses pdf-lib to extract colors PDF.js cannot provide |
| `js/pdf/saver.js` | Converts app annotations back to PDF annotation dicts via pdf-lib |
| `js/pdf/renderer.js` | PDF.js page rendering to canvas + text/link/form layers |
| `js/annotations/rendering.js` | Canvas2D annotation drawing on overlay canvas |
| `js/annotations/factory.js` | Annotation creation with defaults |
| `js/types/annotation.ts` | TypeScript type definitions (20 annotation types) |
| `js/solid/App.jsx` | Root SolidJS component (Desktop + Mobile variants) |
| `js/solid/stores/` | 19 signal-based SolidJS stores |
| `js/i18n/config.js` | i18next initialization (37 languages, 8 namespaces) |
| `js/i18n/useTranslation.js` | SolidJS reactive translation hook |
| `src-tauri/src/lib.rs` | All 28 Rust commands (903 lines, single file) |
| `src-tauri/Cargo.toml` | Rust dependencies including 8 Tauri plugins |

---

## Technology Boundaries

### 1. PDF.js <-> pdf-lib (originalBytesCache bridge)

PDF.js handles **read-only** operations: rendering, text extraction, annotation parsing, form field display. pdf-lib handles **write** operations: creating PDFs, saving with annotations, form field persistence. They NEVER share parsed state — `originalBytesCache` (a `Map<filePath, Uint8Array>`) is the bridge that holds raw bytes for pdf-lib to read during saves.

**Key files**: `js/pdf/loader.js`, `js/pdf/saver.js`, `js/pdf/loader/color-extraction.js`

### 2. SolidJS <-> Vanilla JS (bridge.ts facade)

SolidJS components import vanilla JS directly. Vanilla JS MUST go through `bridge.ts` to reach SolidJS stores. `core/state.ts` (built on `createMutable`) is accessible from both layers as shared state.

**Key files**: `js/bridge.ts`, `js/core/state.ts`

### 3. Tauri FS <-> PDF Bytes (dual IPC)

File operations use Tauri FS plugin (`__TAURI__.fs.readFile/writeFile`) for efficient direct `Uint8Array` transfer. Custom Rust commands handle locking, session persistence, printing, and other OS-level operations.

**Key files**: `js/core/platform.js`, `src-tauri/src/lib.rs`

### 4. i18next <-> SolidJS (custom useTranslation hook)

`useTranslation.js` bridges i18next's imperative API with SolidJS signals. A `createSignal` tracks the current language; `i18next.on('languageChanged')` updates the signal, triggering reactive re-renders. Includes automatic digit localization for Farsi/Arabic.

**Key files**: `js/i18n/useTranslation.js`, `js/i18n/config.js`

---

## Companion Skill Packages

Install these Claude skill packages for deep technology knowledge at each boundary:

| Package | Skills | Repository |
|---------|--------|------------|
| **Open PDF Studio Cross-Tech** | 6 | https://github.com/OpenAEC-Foundation/Open-PDF-Studio-Claude-Skill-Package |
| **Tauri 2** | 27 | https://github.com/OpenAEC-Foundation/Tauri-2-Claude-Skill-Package |
| **SolidJS** | 16 | https://github.com/OpenAEC-Foundation/SolidJS-Claude-Skill-Package |
| **pdf-lib** | 17 | https://github.com/OpenAEC-Foundation/pdf-lib-Claude-Skill-Package |
| **PDF.js** | 15 | https://github.com/OpenAEC-Foundation/PDFjs-Claude-Skill-Package |
| **Vite** | 22 | https://github.com/OpenAEC-Foundation/Vite-Claude-Skill-Package |

The Cross-Tech package covers the specific integration boundaries in this codebase. The individual technology packages cover each library in depth.

---

## Conventions

- **Documentation language**: Nederlands (Dutch)
- **Code and configs**: English
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **TypeScript**: Partial adoption — `.ts` files for types and state, `.js`/`.jsx` for logic and components
- **Annotation rendering**: PDF.js annotation rendering is disabled (`annotationMode: 0`); the app draws all annotations on its own overlay canvas via `annotations/rendering.js`

---

## Dependency Versions

| Technology | Version | Role |
|------------|---------|------|
| Tauri | 2.10.2 | Desktop shell + IPC |
| SolidJS | 1.9.11 | Reactive UI framework |
| PDF.js (pdfjs-dist) | 6.4.299 | PDF rendering engine |
| pdf-lib | 1.17.1 | PDF creation/modification |
| i18next | 25.8.13 | Internationalization |
| Vite | 7.3.1 | Build tool |
| TypeScript | 5.9.3 | Type checking (partial) |
