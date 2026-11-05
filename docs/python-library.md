# Python library (`open-pdf-studio`)

*Issue #518: the PDF editing tools of Open PDF Studio as a Python library,
built with every release, with one source of truth.*

```python
import open_pdf_studio as ops

with ops.launch() as app:                      # own headless instance
    doc = app.open("plan.pdf")
    doc.annotations.add("measureDistance", page=1,
                        startX=100, startY=100, endX=400, endY=100)
    doc.export_image("plan-p1.png", page=1, dpi=300)
    doc.save("plan-measured.pdf")
```

The package lives in `python/` (import name `open_pdf_studio`, PyPI name
`open-pdf-studio`), has no dependencies outside the standard library and
supports Python 3.10+ (3.9 is end-of-life and no longer offered by
setup-python on current Ubuntu runners).

## 1. Decision: a thin client over the app's MCP tools

**The library does no PDF work of its own. It starts (or connects to) the app
and calls the app's MCP tools.** Its typed API is generated from
`mcp-stdio/tools.json`, the public tool catalogue the app itself publishes.

### Evidence

The options from the issue, measured against "output identical to the app":

| Option | What it would take | Verdict |
|---|---|---|
| Reimplement in Python | Everything again | Ruled out by the issue (two sources of truth) |
| PyO3/maturin bindings on the Rust crates | Covers only what lives in Rust: PDFium rendering (`open-pdf-render`, `pdfium-worker`), CAD (`open-pdf-cad`), CMYK, thumbnails, OCR and signature verification (`src-tauri/src/handtekening/verifieer.rs`). The annotation model, the appearance streams and the save pipeline are JavaScript: `js/pdf/saver.js` plus 72 modules in `js/pdf/saver/` (about 11,300 lines on pdf-lib), and the annotation tools, measurements, walls, symbols and snippets around it (about 163,000 lines of JS in total). | Not enough for identical output: either JS runs headless next to the bindings anyway, or the saver moves to Rust first (a project of its own). Native wheels per OS/arch would also have to bundle PDFium and Tesseract. |
| Run the JS saver headless (Node) | The saver depends on the WebView state (`core/state.ts`, PDF.js document, `originalBytesCache`, canvas measurements); it is not a standalone module. | Possible in the long run, not now. |
| **Drive the app through its MCP tools** | Already there: the app has an MCP server in Rust (`src-tauri/src/mcp_server.rs`, HTTP JSON-RPC on `127.0.0.1:<port>/mcp`), 89 public tools whose schemas and order are pinned by the Rust test `publieke_catalogus_is_gelijk_aan_verpakte_tools`, and a headless test-instance mode (`OPDS_HEADLESS=1`, `src-tauri/src/headless.rs`). | **Chosen.** Identical output by construction (it *is* the app), zero duplicated logic, every new tool reaches Python through regeneration. |

Costs of the choice, accepted knowingly:

* a script needs an installed app (the wheel stays tiny and pure Python);
* startup of a headless instance takes seconds (WebView + PDFium workers),
  so the library is for batch jobs and pipelines, not for per-request use in
  a web server;
* operations the app has no tool for are not available yet (section 5).

### Transport: HTTP straight to the app, stdio optional

`mcp-stdio/server.mjs` (the stdio bridge for Claude Desktop) is a pure proxy:
it forwards every line to the app's HTTP endpoint (`mcp-stdio/brug.mjs`) and
only answers `initialize` / `tools/list` from `tools.json` when the app is not
running. Going through it would add a Node.js dependency and buy nothing, so
the client speaks the same JSON-RPC to `http://127.0.0.1:<port>/mcp` with
`urllib` (`HttpTransport`). It ignores `HTTP(S)_PROXY` for that local address.
`connect_stdio([...])` (`StdioTransport`) is there for any MCP stdio server,
including the bridge itself; the tests run the real bridge against the fake
server to show both paths give the same results.

### Headless operation

`ops.launch()` starts a *test instance* the way the release gates already do
(see the header of `src-tauri/src/headless.rs` and
`open-pdf-studio/scripts/test-move-sweep.ps1`):

| Setting | Why |
|---|---|
| `--mcp-server --mcp-port <free port>` | starts the MCP server with all tools (`main.rs`) |
| `OPS_ENABLE_MCP=1` | release builds refuse `--mcp-server` without it (`mcp_server::start`) |
| `OPDS_DETACHED=1` | skips the single-instance hand-off, so a running app of the user is not touched |
| `OPDS_HEADLESS=1` | window off-screen, never focused, no taskbar button; native dialogs, `alert`/`confirm`/`print`, browser and file-manager launches are refused with a log line |
| `OPDS_DATA_DIR=<temp dir>` | own preferences, session, recovery and logs (`datamap.rs`); removed when the client closes |

Readiness: the client first waits until `initialize` answers, then until the
WebView listens, either from the log line `[mcp-bridge] WebView ready` or from
a successful `app_list_tabs` call (the server accepts tool calls before the
frontend listens; those time out). `client.close()` ends the whole process
tree (process group on POSIX, `taskkill /T` on Windows, which also ends the
PDFium workers and WebView processes).

**Display.** The app is a Tauri/WebView application and always needs a
display server; headless mode hides the window, it does not remove it.

* **Windows:** works without anything extra (WebView2, window parked
  off-screen).
* **Linux:** WebKitGTK needs X11 or Wayland. With neither `DISPLAY` nor
  `WAYLAND_DISPLAY` set (CI, servers, containers) the launcher runs the app
  under `xvfb-run -a` automatically and explains how to install it when it is
  missing (`apt install xvfb`, `dnf install xorg-x11-server-Xvfb`). Pass
  `xvfb=True` to use Xvfb even on a desktop (guarantees nothing appears; on
  Wayland a window cannot be parked off-screen) or `xvfb=False` to never use
  it. `scripts/linux-appimage-smoke.sh` uses the same `xvfb-run` route in CI.
* **macOS:** needs a logged-in GUI session (as every WebKit app). The window
  is parked off-screen but macOS may keep part of it visible.

### Finding the app

`find_app()` tries, in order: `$OPDS_APP` (any executable or AppImage),
`open-pdf-studio` on `PATH`, then the install locations:

* Windows: `%ProgramFiles%\Open PDF Studio\open-pdf-studio.exe` (per-machine
  installer), `%LOCALAPPDATA%\Open PDF Studio\open-pdf-studio.exe` and
  `%LOCALAPPDATA%\Programs\Open PDF Studio\open-pdf-studio.exe` (per-user);
* macOS: `/Applications/Open PDF Studio.app/Contents/MacOS/open-pdf-studio`
  and the same under `~/Applications`;
* Linux: `/usr/bin` (`.deb`, AUR), `/usr/local/bin`, `/snap/bin`,
  `/opt/open-pdf-studio`. For an AppImage or Flatpak set `OPDS_APP` (for
  Flatpak pass a command: `ops.launch(["flatpak", "run",
  "org.openaec.OpenPdfStudio"])`).

`ops.launch(app=[...])` also takes the command explicitly. To drive the app
that is already open on screen instead, use `ops.connect()` (port
`OPS_MCP_PORT` or 9223, *Settings > General > AI link (MCP)*).

## 2. API

### Generated layer: every tool as a method

`python/scripts/generate-tools.mjs` turns each entry of `mcp-stdio/tools.json`
into one method of `ToolMethods` in `python/src/open_pdf_studio/_tools.py`:

* name: the tool name without `app_` (`app_get_page_text` ->
  `tools.get_page_text`);
* parameters: snake_case (`widthPt` -> `width_pt`); required parameters are
  positional, optional ones keyword-only with default `None` (= left out);
  `ops.NULL` sends an explicit JSON `null`;
* type hints from the JSON schema (`Literal[...]` for enums, `List[...]`,
  `Dict[str, Any]`, `Optional`, `Union`);
* docstring: title, full tool description, every parameter with its schema
  description, default and limits, and whether the tool only reads or
  changes state (MCP annotations);
* `ops.TOOLS` holds the same metadata for introspection.

```python
app.tools.capture_region(page=1, dpi=300, path="/tmp/p1.png")
app.tools.import_cad("/data/plan.dxf", scale=100, paper="A1")
app.call_tool("ext:my-extension:command", {"x": 1})   # any tool by name
```

Regenerate after the catalogue changes (the Rust test
`tools_json_van_de_brug_is_actueel` rewrites `tools.json` with
`OPDS_MCPB_TOOLS_SCHRIJVEN=1`):

```bash
node python/scripts/generate-tools.mjs          # write _tools.py
node python/scripts/generate-tools.mjs --check  # CI: fail when stale
```

The check runs in the unit-test list (`python/scripts/generate-tools.test.mjs`
in `open-pdf-studio/scripts/unit-testlijst.txt`), in the `python-library` CI
job and in the release job, so a new or changed tool cannot ship without its
Python method.

### Ergonomic layer

A thin composition of the generated tools (`client.py`, `document.py`):

| Python | Tools |
|---|---|
| `ops.launch()`, `ops.connect()`, `ops.connect_stdio(cmd)` | `initialize` |
| `app.open(path)`, `Document.open(path, app=None)` | `app_open_pdf` |
| `app.new_document(width_pt, height_pt, pages)`, `Document.new(...)` | `app_new_blank_pdf` |
| `doc.page_count`, `len(doc.pages)` | `app_get_page_count` |
| `doc.pages.merge(paths, position=)` | `app_merge_pdf` |
| `doc.annotations.add(type, page=, layer=, **props)` -> id | `app_create_annotation` |
| `doc.annotations.list / get / update / delete` | `app_list/get/update/delete_annotation` |
| `doc.layers.list / create / set` | `app_list_layers`, `app_create_layer`, `app_set_layer` |
| `doc.text(page)`, `doc.replace_text(span_id, expected, new)` | `app_get_page_text`, `app_replace_text` |
| `doc.export_image(path, page=, dpi=, format=)` | `app_capture_region` |
| `doc.export_cad(path, **options)` | `app_export_cad` |
| `doc.print_to_pdf(path, **options)` | `app_print_to_pdf` |
| `doc.save(path=None)` | `app_save_pdf` |
| `doc.undo()`, `doc.redo()` | `app_undo`, `app_redo` |
| `doc.close(save=, force=)`, `with doc: ...` | `app_close_tab` |
| `doc.tools.<any tool>` | that tool, on this document |
| `doc.pages.rotate / delete / insert_blank / extract / reorder` | proposed tools, section 5 |

The app works on tabs and every tool acts on the active tab. A `Document`
remembers its tab and calls `app_switch_tab` first, so several documents can
be edited from one script; closing a document shifts the indexes of the tabs
after it.

`Document.open(path)` without `app` uses `ops.default_app()`, which launches
one headless instance on first use and stops it at interpreter exit;
`ops.set_default_app(client)` replaces it.

### Errors

All exceptions derive from `ops.OpenPdfStudioError`.

| Exception | When |
|---|---|
| `ToolError` (`.tool`, `.result`) | the tool ran and failed: `{"ok": false, "error"}` from the WebView handler (the convention of `js/mcp-bridge.js`) or `isError: true` |
| `InvalidParamsError` (-32602) | unknown or unavailable tool, missing or invalid arguments |
| `InternalError` (-32603) | the app failed, e.g. the WebView did not answer in time |
| `MethodNotFoundError` (-32601), `InvalidRequestError` (-32600), `RpcError` | other JSON-RPC errors |
| `AppNotReachableError` | nothing listens on the endpoint, or the stdio server exited |
| `AppNotFoundError` | no executable found (message lists what was tried) |
| `AppLaunchError` (`.output`) | the instance exited or did not get ready in time; carries the app's last output |
| `UnsupportedOperationError` | the app has no tool for this yet, or opening needs a dialog (CAD import, password) |
| `ProtocolError` | malformed response |

## 3. Tests

`python/tests` (stdlib `unittest`; also runs under pytest) needs no app. A
fake MCP server (`tests/fake_mcp_server.py`) speaks the app's wire protocol
over HTTP and stdio, keeps a small model of tabs, pages and annotations, and
can stand in for the app binary (`--mcp-server --mcp-port N`, checking
`OPS_ENABLE_MCP`, printing the WebView-ready line). Covered:

* the generated layer equals `tools.json` (names, order, parameters,
  required, hints, docstrings) and the generator check passes;
* argument mapping (snake_case, `None`, `NULL`, missing required argument);
* HTTP and stdio transports, error mapping, proxy variables ignored,
  `OPS_MCP_PORT`;
* the real `mcp-stdio/server.mjs` bridge in front of the fake app, and its
  fallback answers when no app runs;
* document workflows: open, annotate, update, save, two tabs, close with
  index shift, merge, text, image export, unsupported page operations, page
  tools picked up once advertised;
* launcher: install paths per OS, `OPDS_APP`, xvfb decisions, the instance
  environment, readiness via log line and via probe, early exit, startup
  timeout, cleanup of the process and the data directory.

```bash
cd python && python -m unittest discover -s tests -t tests -v
```

Shared app/library tests ("output identical for the same operation") follow
from the design: the library calls the same tool the app runs, there is no
second implementation to compare. An end-to-end test against a real build
(launch, open a fixture from `test pdf-bestanden/`, annotate, save, compare
with the app's own result) belongs in the release test protocol once the
release builds are available in CI; it is listed as a follow-up.

## 4. Release

* **Version:** `python/pyproject.toml` is a version field of
  `open-pdf-studio/scripts/bump-version.js`, so the package always carries the
  app version (`YYYY.W.N` is a valid PEP 440 version);
  `scripts/versievelden.test.mjs` enforces it.
* **Build:** the `python-library` job of `.github/workflows/release.yml`
  checks the generated layer, runs the tests, builds the sdist and one
  `py3-none-any` wheel (pure Python, so one wheel serves Windows, Linux and
  macOS on x86_64 and arm64; PDFium stays inside the app and does not need to
  be in the wheel) and attaches both to the draft release.
* **CI:** the `python-library` job in `.github/workflows/ci.yml` runs the
  tests on Linux (Python 3.10 and 3.13), Windows and macOS and builds the
  package.

### Maintainer step: publish to PyPI (not automated yet)

Publishing is deliberately not part of this change. To enable it:

1. Create the project `open-pdf-studio` on PyPI (or reserve it with a first
   manual upload of the wheel from a release).
2. On PyPI, *Manage > Publishing*, add a **trusted publisher**: owner
   `OpenAEC-Foundation`, repository `open-pdf-studio`, workflow
   `release.yml`, environment `pypi`.
3. In GitHub, create the environment `pypi` (Settings > Environments),
   optionally with required reviewers, so publishing stays a deliberate step
   like publishing the draft release.
4. Add a job to `release.yml`:

   ```yaml
   pypi-publish:
     needs: [create-release, python-library]
     runs-on: ubuntu-latest
     environment: pypi
     permissions:
       id-token: write
     steps:
       - env:
           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
           VERSION: ${{ needs.create-release.outputs.version }}
         run: |
           mkdir dist
           gh release download "$VERSION" --repo "${{ github.repository }}" \
             --pattern 'open_pdf_studio-*' --dir dist
       - uses: pypa/gh-action-pypi-publish@release/v1
   ```

   No API token is needed: PyPI trusts the OIDC token of that workflow and
   environment.

## 5. Coverage of the issue's scope

Legend: **yes** = an existing MCP tool does it (so Python has it today);
**partial** = possible with limits; **no** = no tool yet (follow-up).

| Scope item | Status | Tools / note |
|---|---|---|
| Open PDF | yes | `app_open_pdf` (`app.open`); DWG/DXF and password-protected PDFs need a dialog -> `UnsupportedOperationError` |
| Create PDF | yes | `app_new_blank_pdf` (`app.new_document`) |
| Save | yes | `app_save_pdf` (`doc.save`), same save pipeline and appearance streams as the app |
| Incremental / atomic save as a choice | no | `app_save_pdf` has no mode argument |
| Pages: merge, insert from file | yes | `app_merge_pdf` (`doc.pages.merge`, position start/end/after current page) |
| Pages: insert blank, delete, rotate, reorder, extract, shift | no | app functions exist (`js/pdf/page-manager.js`: `insertBlankPages`, `deletePages`, `extractPages`, `reorderPages`; `js/pdf/renderer.js`: `rotatePage`; `js/pdf/shift-page.js`: `shiftPages`) but no MCP tool |
| Annotations, all types | yes | `app_create_annotation` (28 types: line, arrow, wall, box, mask, redaction, viewport, circle, highlight, cloud, polygon, polyline, cloudPolyline, spline, draw, filledArea, textbox, callout, comment, stamp, signature, image, parametricSymbol, measureDistance, measureArea, measurePerimeter, scaleRegion, count), `app_list/get/update/delete_annotation`, `app_undo/redo` |
| Measurements, dimensions | yes | measure* types, `app_set_measure_scale`, `app_get_takeoff`, `app_place_schedule` |
| Symbols | yes | `parametricSymbol` type, `app_symbol_scale`, `app_search_symbols` |
| Walls, floor plans, facades, structural grids | yes | `app_floorplan`, `app_facade_element`, `app_structural_layout`, wall type |
| Hatches | partial | `filledArea` and wall/floor-plan hatches through their tools; no tool to edit hatch patterns directly |
| Vector snippets | yes | `app_snippet_cut`, `app_snippet_paste`, `app_snippet_flatten` |
| Annotation layers | yes | `app_list_layers`, `app_create_layer`, `app_set_layer`, `layer` argument on create/update/list |
| System types, title blocks | yes | `app_list/register/update_system_type`, `app_get_system_geometry`, `app_titleblock` |
| Read text with position and font | yes | `app_get_page_text` (`doc.text`) |
| Replace text | yes | `app_replace_text`, `app_translate_page` |
| Export images PNG/JPEG with DPI | yes | `app_capture_region` (`doc.export_image`), page or region, 10-2400 dpi |
| Export TIFF | no | the export dialog writes TIFF (`js/pdf/tiff.js`, `exportAsImages`), no tool |
| Export ODT / XLSX | no | `js/pdf/office-export.js` (`exportOffice`), no tool; `app_workbook_bindings` only refreshes quantities into a workbook |
| Export CAD (DXF/DWG) | yes | `app_export_cad` (`doc.export_cad`); import: `app_import_cad` |
| Print to PDF | yes | `app_print_to_pdf` (`doc.print_to_pdf`); printers: `app_print`, `app_list_printers` |
| OCR text layer | partial | review/correct existing OCR words (`app_review_ocr`), OCR labels in form recognition; running OCR (`js/pdf/ocr.js`: `ocrCurrentPage`, `ocrAllPages`) has no tool |
| Watermarks, headers/footers | no | `js/watermark/`, no tool |
| Bookmarks | no | `js/ui/panels/bookmarks.js` (`addBookmark`, `deleteBookmark`, `moveBookmarks`), no tool |
| Form fields | partial | `app_recognize_form` detects fields and saves a copy with new fields; no tool to list or fill field values |
| Signature verification | no | implemented in Rust (`src-tauri/src/handtekening/verifieer.rs`, command `pdf_signature_list`), no tool; `app_save_pdf` only reports `signaturesInvalidated` |
| Also available | yes | search (`app_search_documents`), cleaned copy without metadata/comments/attachments (`app_hidden_information`), print preflight, PDF collections (`app_portfolio`), drawing sets, cross-sheet links, approval routing, document workflows, extensions (`app_list_extensions`, `app_call_extension_command`, extension tools by name) |

As an escape hatch, `app_list_commands` / `app_run_command` /
`app_click_element` / `app_read_ui` reach every ribbon button and in-app
dialog. That is UI automation (labels and ids can change between versions),
so the library does not build its API on it.

### Missing tools (follow-ups)

Each of these is an app change (a handler in `js/mcp-bridge.js`, an entry in
`src-tauri/src/mcp_tool_meta.rs` and the tool list, regenerated `tools.json`),
after which Python only needs `node python/scripts/generate-tools.mjs`. The
page wrappers in `document.py` already call the proposed names as soon as the
app advertises them (`client.has_tool`), and raise
`UnsupportedOperationError` until then.

| Proposed tool | Arguments (proposal) | Python wrapper |
|---|---|---|
| `app_rotate_pages` | `pages: int[]`, `angle: 90 \| 180 \| 270` | `doc.pages.rotate(pages, angle)` |
| `app_delete_pages` | `pages: int[]` | `doc.pages.delete(pages)` |
| `app_insert_blank_pages` | `after: int`, `count: int`, `widthPt?`, `heightPt?` | `doc.pages.insert_blank(...)` |
| `app_extract_pages` | `pages: int[]`, `outputPath: string` (new file) | `doc.pages.extract(pages, path)` |
| `app_reorder_pages` | `order: int[]` (new order, 1-based) | `doc.pages.reorder(order)` |
| `app_shift_pages` | `pages`, `dx`, `dy` | generated method |
| `app_save_pdf` + `mode` | `"incremental" \| "full"` | `doc.save(path, mode=)` |
| `app_export_images` | `pages`, `format: png \| jpeg \| tiff`, `dpi`, `outputDir` | generated method |
| `app_export_office` | `format: odt \| xlsx`, `pages`, `outputPath` | generated method |
| `app_run_ocr` | `pages`, `lang` | generated method |
| `app_watermarks` | `action: list \| add \| remove`, watermark / header-footer definition | generated method |
| `app_bookmarks` | `action: list \| add \| update \| delete \| move` | generated method |
| `app_form_fields` | `action: list \| fill`, `values: {name: value}` | generated method |
| `app_verify_signatures` | none (active document) | generated method |

Also open: an end-to-end test of the library against a real release build
(section 3), and the PyPI publishing job (section 4).
