# Open PDF Studio — MCP for Claude Desktop / Claude Code

Open PDF Studio ships a **full MCP server inside the app** (98 public tools: open /
zoom / annotate / save PDFs, drive the assistant, call the OpenAEC AI, inspect
viewport state, …). It is implemented in Rust (`src-tauri/src/mcp_server.rs`)
and speaks **HTTP JSON-RPC** on `127.0.0.1:9223/mcp`.

Claude Desktop and Claude Code speak MCP over **stdio**, so this folder adds a
tiny zero-dependency bridge (`server.mjs`) that proxies stdio ⇄ HTTP. Nothing
is reimplemented here — `tools/list` / `tools/call` are answered by the live
app, so the bridge always reflects exactly what the app exposes.

```
Claude Desktop / Code  ──stdio──►  server.mjs  ──HTTP──►  Open PDF Studio
                       ◄─stdio──                ◄──HTTP──  (in-app Rust server)
```

This mirrors the working `open-calc-studio` setup, but thinner: Calc reimplements
its domain logic in the Node server; here the app already *is* the MCP server.

---

## 1. Start the app with the MCP server enabled

The MCP server is **on by default**; check it in the app under
**Settings > General > AI link (MCP)** (port 9223 by default). That starts the
server with the public tool set — every user-facing tool, each with MCP
annotations, without the developer/test tools.

Developers can start it with a flag instead; that route exposes **all** tools,
including the test tools:

```bash
# Dev (debug build) — from open-pdf-studio/open-pdf-studio/
npm run tauri -- dev -- -- --mcp-server
#                       └── pass-through to the app binary ──┘

# Different port:
npm run tauri -- dev -- -- --mcp-server --mcp-port 9300

# Release build — must also set OPS_ENABLE_MCP=1 (safety guard):
OPS_ENABLE_MCP=1 "Open PDF Studio.exe" --mcp-server
```

When ready the app logs `MCP server listening on http://127.0.0.1:9223/mcp`
and `[mcp-bridge] WebView ready, listening for: [...]`.

## 2. Verify the bridge can reach it

```bash
node mcp-stdio/server.mjs --probe
# → [open-pdf-studio mcp bridge] OK — 98 tools available at http://127.0.0.1:9223/mcp
```

If you used a non-default port, set it first: `OPS_MCP_PORT=9300 node mcp-stdio/server.mjs --probe`.

## 3a. Claude Code

`.mcp.json` already lives in the repo root, so just open this repo in Claude
Code and approve the **open-pdf-studio** server when prompted. Then ask Claude
to call e.g. `app_accounts_status` or `app_list_tabs`.

Change the port via the `env.OPS_MCP_PORT` field in `.mcp.json`.

## 3b. Claude Desktop

Edit `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and add:

```json
{
  "mcpServers": {
    "open-pdf-studio": {
      "command": "node",
      "args": ["C:\\Users\\rickd\\Documents\\GitHub\\open-pdf-studio\\mcp-stdio\\server.mjs"],
      "env": { "OPS_MCP_PORT": "9223" }
    }
  }
}
```

Restart Claude Desktop. The **open-pdf-studio** tools appear in the 🔌 menu.
(If `node` isn't on Claude Desktop's PATH, use its absolute path, e.g.
`"command": "C:\\Program Files\\nodejs\\node.exe"`.)

---

## Talking to the assistant

The reason this exists — drive Open PDF Studio's assistant from Claude:

- **`app_assistant_ask`** — submit a message into the in-app assistant window,
  exactly as if the user typed it. The answer comes from whichever provider
  resolves: OpenAEC AI → a personal Claude key → the **MCP relay** (below).
- **`app_assistant_pending`** → **`app_assistant_answer`** — the relay. When no
  AI provider is configured, the app queues each assistant question. Call
  `app_assistant_pending` to take the oldest question, compute an answer, then
  `app_assistant_answer { id, text }` to make it appear in the window. This is
  how *Claude itself becomes the assistant's brain*.
- **`app_assistant_history`** — read back the conversation to confirm a reply.
- **`app_agent_task_pending`** → **`app_agent_task_result`** — structured tasks
  from extensions, without the assistant window or a chat message. An
  extension submits a task (for example recognising the floor plan on one
  page) with the context fields it chooses to share and a `resultSchema`.
  Take the oldest task with `app_agent_task_pending` (optionally `{ kind }`),
  then answer `app_agent_task_result { id, result }` with an object that
  matches the schema, or `{ id, error: { message } }`. The result goes only to
  the extension that asked, as a proposal: nothing is drawn until it applies
  it. A task is cancelled when the user switches or closes the document or
  when its source, page or scale changes.
- **`app_ai_complete`** — call the OpenAEC AI directly (needs the app signed in
  to OpenAEC; returns `{ ok, signedInAs, text, credits }`).
- **`app_accounts_status`** / **`app_accounts_fetch`** — check sign-in and call
  any `/me/*` Accounts API from the signed-in app.

A few of the many PDF tools: `app_open_pdf`, `app_new_blank_pdf`,
`app_go_to_page`, `app_set_zoom` / `app_fit_width`, `app_create_annotation`,
`app_list_annotations`, `app_get_page_text`, `app_replace_text`,
`app_translate_page`, `app_save_pdf`,
`app_screenshot_view`. The full,
authoritative list is in `src-tauri/src/mcp_server.rs` (`handle_tools_list`)
and documented in `docs/superpowers/specs/2026-05-09-mcp-app-tools.md`.

### Pages, bookmarks and watermarks

These tools run the same functions as the Organize ribbon tab and the
Bookmarks panel, so each call is one undo step and markups, page labels,
measurement scales and links stay with their page. Page numbers are 1-based.
All of them are refused in a read-only document (PDF/A without editing
enabled, password-protected); a document always keeps at least one page.

| Tool | Arguments |
|---|---|
| `app_rotate_pages` | `pages: int[]`, `angle: 90 \| 180 \| 270 \| -90` |
| `app_delete_pages` | `pages: int[]` |
| `app_insert_blank_pages` | `after: int` (0 = before page 1), `count?`, `widthPt?` + `heightPt?` (default: size of page `after`) |
| `app_extract_pages` | `pages: int[]` (in file order), `outputPath` (a new `.pdf`, never replaced), `deleteFromOriginal?` |
| `app_reorder_pages` | `order: int[]` (every current page once; `order[i]` becomes page i+1) |
| `app_shift_pages` | `pages: int[]`, `dx`, `dy` in mm (as displayed: right / up positive) |
| `app_bookmarks` | `action: list \| add \| update \| delete \| move`; add `title`, `page?`, `parentId?`; update `id` + `title` / `page` / `bold` / `italic` / `color`; delete `ids`; move `ids`, `position: before \| after \| inside \| end`, `targetId` |
| `app_watermarks` | `action: list \| add \| remove`; add `type: text \| image \| headerFooter` with the dialog fields and `pages?`; remove `id` |

`app_screenshot_view` captures the page view by default. Pass
`{"scope":"window"}` for the whole window (ribbon, extension tabs, side
panels, status bar) or `{"scope":"element","selector":".ribbon-container"}`
for one element; the result adds the captured `bounds` (CSS px) and
`devicePixelRatio`. The window and element captures are Windows-only for now.

`app_capture_region` renders an area of a page (`x`, `y`, `width`, `height`
in app points, or nothing for the whole page) again at a chosen `dpi`, with
the annotations, as PNG or JPEG — the same image as Home > Screenshot in the
app. It returns `image_base64`, or writes the file when `path` is given.

`app_list_commands` lists every ribbon tab as `ribbon-tab:<tab>` (extension
tabs included) and the buttons of extension tabs with the extension tab id in
`tab`; `app_run_command` runs them. To check what a click did, `app_read_ui`
returns a compact accessibility-style tree (role, name, state such as
disabled, checked, selected, expanded and value) of the ribbon, the side
panels and the status bar, or of the elements a `selector` matches.

## Edit or translate existing page text

Open a PDF, call `app_get_page_text` with a 1-based page number, and use its
`spans` as the translation units. Each span includes the original text, a
document-bound `id`, page-space bounding box, font information, rotation and
fill colour when it can be recovered. For each translated span, call
`app_replace_text` with `spanId`, the exact `expectedText`, and `newText`.
Then call `app_save_pdf` with an output path and reopen the result to check it.
For example:

```json
{"spanId":"42:p1:i0-3","expectedText":"Welcome","newText":"Welkom"}
```

The replacement is fitted into the original run width, retaining its anchor,
rotation and colour. If the PDF's embedded font subset cannot encode the new
characters, the app embeds a bundled font that covers them and reports
`fontFallback` and `fontUsed`. It refuses a run it cannot remove unambiguously
from the PDF content stream or fit legibly. It never paints a white rectangle
over page artwork for MCP replacements. A returned `rasterBackgroundOverlap`
warning means that an overlapping background image may already contain the
same words as pixels; those pixels cannot be edited as PDF text. Colour may
also be `null` for some PDFs; then supply an explicit `#RRGGBB` `color` to
`app_replace_text`. That tool edits one line per call. To translate a whole
page, send all spans of that page in one `app_translate_page` call:

```json
{"page":1,"replacements":[
  {"spanId":"42:p1:i0-3","expectedText":"Welcome","newText":"Welkom"},
  {"spanId":"42:p1:i4-9","expectedText":"Opening hours","newText":"Openingstijden"}]}
```

It applies the same rules, checks all replacements together on one copy of
the PDF and adds them as one undo step. It is all or nothing: when one
replacement fails, nothing changes and `results` gives the error per span.
Review the saved pages afterwards. A scanned page with
no selectable text must first go through OCR; pixels in the scan are not
editable text spans.

---

## Direct HTTP (no bridge) — Claude Code only, optional

Claude Code also supports HTTP MCP servers, so you can skip `server.mjs`:

```json
{ "mcpServers": { "open-pdf-studio": { "type": "http", "url": "http://127.0.0.1:9223/mcp" } } }
```

The stdio bridge is the recommended default because it works identically in
both Claude Desktop and Claude Code and gives clearer "app not running" errors.

## Troubleshooting

- **`Open PDF Studio is not reachable`** — the app isn't running, or the AI
  link was turned off, or it's on a different port. Check Settings > General >
  AI link (MCP) (on by default) and that the port matches. While the app is down the bridge
  still answers `tools/list` (from `tools.json`), so the client keeps its tools.
- **Tools call but nothing happens in the UI** — `app_*` tools need the live
  WebView; make sure you launched the GUI app (not a headless build).
- **Release build "refused to start"** — set `OPS_ENABLE_MCP=1`.

### Search a document package

`app_search_documents` searches the active PDF, all open PDFs, or the PDFs
directly inside a desktop folder. For example:
`{"query":"water","scope":"open","annotations":true,"limit":500}`.
Use `scope:"folder"` with `folder` for a directory (not recursive).
Results include document identity, page labels, text snippets and location
anchors; per-file statuses distinguish encrypted, unreadable and textless PDFs.
Textless pages are candidates for explicit local OCR, not evidence of zero hits.
Search does not write files or create a persistent index.

Extensions can call `api.searchDocuments(request, { signal })` with the same
request and an optional AbortSignal. The find bar exposes grouped results,
cancellation, navigation and an explicit OCR language dialog for scanned files.
Changed documents must be searched again before navigation.

### Spatial locations

The app_locations MCP tool and extension API api.locations(request) use the same
requests. Action "list" returns the active document ID, zones and per-annotation
computed/manual locations. Mutations require that documentId and annotationId.
Action "zone" sets name and optional parentId on an existing straight polygon or
unrotated box; "removeZone" removes its zone definition (children must be
reassigned first). Action "override" with a string value assigns a manual
location, including an explicitly empty location. Action "automatic" removes the
override. Edits participate in undo. The Properties panel exposes these operations.

Assignment uses the centre of the annotation's bounding box, with edges included.
Among containing zones on the same page, deepest hierarchy wins, then smallest
area, then zone ID. Location and Location source are available as schedule fields
for filtering, grouping and CSV export; measurement scales are unchanged.
Missing parents, cycles and duplicate identities invalidate a zone. Copy/paste
creates new IDs and preserves hierarchy within the copied selection.

Persistence: each zone annotation stores /OPS_SpatialZone as a PDF text string
containing JSON {version:1,id,name,parentId}. /OPS_LocationOverride is an optional
PDF text string; absent means automatic, empty string means an explicit empty
override. Geometry remains the normal annotation geometry in unrotated page
coordinates. Unknown schema versions are ignored. Third-party editors may drop
private keys. Locations update as background annotation loading completes.

### Inspect hidden information and export a separate copy

app_hidden_information and api.hiddenInformation(request) accept action "inspect"
with the active documentId. The saved loaded PDF is inspected; save pending edits
first. The Document Properties dialog offers the same workflow.

Action "export" additionally requires categories (metadata, comments, attachments,
actions) and a new outputPath ending in .pdf. Both the PDF and adjacent
.pdf.report.json must not already exist. The source document is unchanged.
The output is fully rewritten, unreachable indirect objects are removed, and
the rewritten bytes are reopened to inspect the reachable object graph.

This is selective structural cleanup. Optional-content layers, invisible or
covered text, image pixels and arbitrary private content are not removed.
Comments includes non-widget annotations and visible markups/links. Actions
includes navigation and form actions. Existing digital signatures cannot remain
valid after rewriting; PDF/A and PDF/X conformance require independent validation.
The report distinguishes supported removals and remaining/unsupported findings.

### Print preflight

app_print_preflight and api.printPreflight(request, {signal}) accept action
"inspect", documentId and an optional profile. Profile fields: version=1, name,
minDpi (36–2400), embeddedFonts, allowRgb, allowTransparency and outputIntent.
The Properties dialog stores named profiles on this device and offers navigation
to affected pages and JSON report export. Save pending edits before inspection.

Action "fixTrimBoxes" additionally takes a new outputPath. It sets every TrimBox
to the CropBox clipped to the MediaBox, writes a separate PDF and adjacent JSON
report and rechecks the copy. Existing files are refused. Rewriting invalidates
existing digital signatures.

Findings are structural and profile-specific. Fonts/resources may be unused;
effective image DPI is measured per placement before clipping, including nested
Form transforms. Inline images, annotation appearances, complex color spaces,
patterns and shading internals require external validation. No PDF/X or PDF/A
compliance is certified by this tool or by the presence of output-intent metadata.

### Verify uncertain OCR

Open the OCR language dialog and choose Verify OCR. The queue orders unknown and
low-confidence words first, shows a source crop and supports Alt+Left/Right plus
Enter to accept or correct. Confidence is preserved; missing/invalid confidence
is explicitly unavailable. Save to update searchable/copied text.

app_review_ocr and api.reviewOcr(request) accept action "list", documentId,
threshold (default 80), offset and limit (default 100, maximum 1000).
Accept/correct additionally require page, index, revision and expectedText from
the queue; correct also takes text. Mutations reject stale document revisions and
participate in undo. New OCR runs have their own page-level undo records.

Each page stores /OPS_OCRReview as a PDF text string containing version=1 and
validated words with coordinates, confidence and optional review status/original
text. The app's invisible text stream is marked /OPS_OCRLayer true and replaced
on subsequent saves; artwork and unowned streams are retained. Older OCR without
this metadata needs recognition again to create a verification queue. Unsupported
glyphs in reviewed text fail saving rather than silently losing the correction.

### PDF collection portfolios

`app_portfolio` and extension `api.portfolio(request)` use the saved active document, identified by `documentId`. Save pending edits first. `inspect` returns components, folder IDs, descriptions, item metadata, schema and sorting. `exportComponent` writes the selected `key` to a new absolute `outputPath` without executing it. Only document, image and data types are written (programs, scripts, shortcuts and web pages are refused), never into autostart folders, and on Windows the file is marked as downloaded content (Mark-of-the-Web).

`saveCopy` accepts `add: [{path, name, folderId?, description?}]` (each `path` an explicit absolute local path of a document or data type; the app reads that file and embeds it), `remove: [key]`, `descriptions: [{key, description}]`, and `folders: [{name, parentId}]`. A new folder tree starts at root ID 0; subsequent folder IDs increase from the largest current ID. The output path must be a new PDF file. The tool is marked as modifying (destructive hint), so clients ask before each call. Existing collection schema, sort, item metadata and unchanged component bytes are preserved. New collections include a basic-reader cover page; existing collections retain their pages. Signed input is not kept cryptographically valid by a rewrite.

The Attachments panel provides the same copy workflow with folder browsing, descriptions, PDF preview and safe component export. Other component types are not launched.

### Recognize flat forms

`app_recognize_form` / `api.recognizeForm(request, {signal})` detects candidate empty outlines and writing lines on 1–50 saved PDF pages. Existing widgets are excluded. Optional `ocr: true` reads scan labels through local desktop OCR; otherwise labels come from PDF text. Detection is heuristic and returns unaccepted candidates, existing fields, warnings, `revision` and a SHA-256 `sourceId`.

Review and edit candidates before calling `action: "saveCopy"` with the same document, revision, sourceId and a new PDF outputPath. Accepted candidates need page, type (`text`, `checkbox`, `radio`), name, accessible label, order and bounds `{x,y,width,height}` in unrotated PDF points. Radio buttons need a shared group, consistent groupLabel/required flag and unique option values. Existing fields and artwork remain; new widgets follow reviewed order. No embedded scripts are generated. Signed source validity does not survive rewriting.

The Forms panel provides the review UI, including source-page preview and editable bounds. Native reader interoperability remains a release-validation requirement.

### Visual symbol matching

`app_search_symbols` / `api.searchSymbols(request, {signal, onProgress})` supports `search`, `accept` and `navigate`. Search takes documentId, templatePage, a rect in current page-view coordinates at scale 1, and up to 20 pages. Optional threshold is 0.5–1, rotations are quarter turns, scales range 0.5–2 (at most three). Pages use a common bounded resolution; templates must cover 6–160 search pixels. The score is binary foreground overlap, not a calibrated recognition probability. Dense, faint or very small symbols may be missed; review is mandatory.

Search returns queryId, available count categories and matches with IDs, page, bounds, score and transform. Accept takes queryId, selected IDs and an existing returned count category `{id}`; matching same-category counts within 3 page-view units are skipped. Counts use normal save/quantity/undo paths. Navigate takes queryId and one ID. Results expire after 20 minutes, after document changes, or when displaced from the four-query cache. The Find bar exposes the same workflow with pointer/coordinate template selection and per-result previews.

Reproducible fixtures: `js/search/symbol-matcher.test.mjs` uses four asymmetric symbols, quarter-turn/scale variants, missing/extra scan pixels and a solid distractor (4/4 true positives, no false positives at 0.75). With Vite running, `node scripts/check-symbol-search.mjs` generates a two-page vector/raster PDF with three symbols (3/3 at 0.85), then verifies count creation, deduplication, undo, quantity totals and PDF save/reopen. These small synthetic sets do not establish accuracy on arbitrary construction drawings.

### Persistent spreadsheet quantity bindings

`app_workbook_bindings` / `api.workbookBindings(request)` exposes list, bind/rebind, preview, refresh, inspectWorkbook, export and remove. Bind the active source document and a scheduleId to workbookPath, sheet and mappings `[{field,cell,unit}]`. The schedule's name/configuration and explicit units are retained; changes require review/rebinding. Multiple sources can own disjoint cells in one workbook; refresh each source while it is active. All source annotations must be loaded. Zero totals remain numeric zero; mixed units are refused.

Desktop refresh reads the current XLSX, patches mapped numeric cells, checks for concurrent workbook/source changes, keeps the previous workbook as a new `<file>.<yyyymmdd-hhmmss>.bak` next to it and then writes atomically, with deflated package parts. The result reports `backupPath`. Formulas elsewhere and unmapped worksheet XML are preserved, as are styles and other package parts. Formula/array/merged/protected targets and signed/macro workbooks are refused. Spreadsheet applications support this open XLSX interchange format; no application automation, login or cloud service is required. Recalculation is requested for the next spreadsheet open; this adapter does not calculate formulas itself. Workbooks are limited to 50 MB compressed / 100 MB expanded, non-ZIP64 STORE/DEFLATE. Worksheet CDATA/comments are currently unsupported. Browser UI downloads a new copy, without claiming the bound file was refreshed.

Preview exports fresh numeric CSV and provenance independently of XLSX; export returns portable binding JSON and the last refreshed CSV. Bindings live in application preferences. Status reports closed/moved sources, renamed/deleted/changed schedules, revision changes and (desktop) missing/externally changed files. Reopening a source is conservatively stale until refresh. Unsaved measurement edits are flagged in provenance. Disconnecting removes the binding without changing either source file.

### Document workflows

`app_document_workflows` / `api.documentWorkflows(request)` supports list, save, remove, run, watch, stop. The application menu opens an ordered step editor with saved workflows, import/export and sample download. `list` returns saved definitions and the last 500 per-file results. A definition has version:1, name, suffix and ordered steps: rotate {angle}, cropMargins {left,right,top,bottom} in PDF points in unrotated coordinates, metadata {title,author,subject}. Empty metadata strings explicitly clear those fields. This is not a metadata sanitization/redaction tool. Signed documents should not be rewritten; certified/encrypted inputs are refused. Files are bounded to 100 MB, batches to 1000 paths and workflows to 30 steps.

Run accepts paths, workflow, output. Source bytes are rechecked before publishing. Outputs use the input/settings SHA-256 and identical results are skipped on retry, including after restart; unrelated collisions fail. Publishing stages, syncs and exclusively hard-links beside the destination, then removes the temporary link. Existing destinations are never overwritten, even in a race. Filesystems without hard links fail safely. A power loss can leave a hidden .tmp staging file but never a partially published PDF. Input files are not changed. Logs contain paths, hashes, statuses and step numbers, never PDF text/parser messages.

Watch accepts input/output directories and a workflow. It is nonrecursive, requires separate folders, polls every five seconds and requires two unchanged content hashes plus a final EOF marker. Generated output names are ignored. This mitigates normal copy-in-progress files but cannot promise that another process will never modify a file later. Changing input is rechecked before publication. Watch stops on app exit; restart it explicitly. Stop aborts at step/file boundaries; an already publishing complete file may finish and is detected on retry. The dialog can be closed while watching continues; reopen to stop. Preview and JSON management work in the browser; batch/watch publishing requires Tauri. No service, account or upload is involved.

### Drawing sets

`app_drawing_sets` / `api.drawingSets` manages one current set in preferences with portable JSON import/export. Version-1 manifests contain name and sheets [{id,present,versions}], each version storing number/title/discipline/revision/date, relative source, SHA-256, page and viewport width/height/rotation. Choose the package root to reopen relative files; hashes refuse silently changed sources. Earlier versions must remain available at their own relative paths. Capture uses the active saved PDF's pages; edit metadata before preview. Preview matches discipline/number case-insensitively and flags duplicates/ambiguity. Commit requires the unchanged base and explicit per-row resolutions; incoming packages represent complete issues. Omitted sheets remain in history but become absent. Reports distinguish added, removed, replaced, unmatched and unchanged sheets. No source bytes change.

Transfer preview requires both exact PDF revisions open, target active, and annotations loaded. It maps source viewport coordinates through PDF crop boxes into target viewport coordinates, accounting for size and quarter-turn rotation; dx/dy provide explicit alignment adjustment. Rectangles, circles, straight lines/arrows, simple polygons and comments are supported; rotated custom shapes, measurements, text, stamps, ink and correction links are reported unsupported instead of guessed. Outside-page placements cannot be accepted. All selections require explicit confirmation; changed geometry is flagged. The preview shows target bounds, not a full appearance rendering. Source/revision checks invalidate stale previews. New deterministic annotation IDs prevent repeat transfer; nested replies are cloned with fresh coherent IDs. Application is one undo operation, leaving the PDF unsaved until the user saves. Import/export and transfer work with open documents in the browser; reopening files by relative path requires desktop access. No external service is used.

### Cross-sheet links

`app_sheet_links` / `api.sheetLinks` supports index, scan, cancel and export. Index captures open saved PDFs, filenames and editable page labels. Scan takes selected files [{documentId,path}] and index [{id,path,page,label,region}], with an optional literal prefix and caseSensitive flag. Paths must be safe relative PDF paths, unique ignoring case. Region is null for the whole page or [left,bottom,right,top] in unrotated PDF coordinates; bounds are checked. Repeated labels yield ambiguous hits, never an inferred target. Prefix scanning reports unknown labels as missing. Text and existing OCR layers are searched; there is no automatic OCR. References split across separate text items are not joined. Substring bounds are proportional approximations and marked for visual review.

The File-menu dialog displays source/target previews, including rotated pages, and leaves every hit unselected until reviewed. It preserves existing link annotations by default; replacement is explicit and restricted to overlaps with selected hits. Export creates a ZIP of all package PDFs, with standard GoTo/GoToR actions, relative file specifications and page/FitR destinations, plus a report. This keeps the package portable after moving/extracting it. A stable annotation name avoids duplicates on repeat processing even after reopening. Unrelated annotations remain. All destinations are verified against the included package; changed/closed/unsaved sources invalidate scans. Limits: 50 files, 100 source pages, 500 destinations, 250 MB source bytes, 2000 hits, 20-minute preview lifetime.

The browser downloads the archive. API/MCP export uses a new desktop outputPath ending .zip and refuses a pre-existing path; source PDFs never change. Reader settings may require confirmation before opening a remote PDF. Signed PDF copies can lose signature validity after rewriting; this is not a signature-preserving export. Native MCP execution and desktop reader navigation require separate verification.

### Local approval routing

`app_approval_routing` / `api.approvalRouting` (marked as modifying: receipt, cancel and supersede are irreversible audit events) implements the documented `local-file-v1` adapter. Explicit configure enables it. Draft captures the active saved PDF version (SHA-256, name, page count and revision label), recipients, sequential/parallel order, optional expiry and page regions. It performs no network send/upload. Submit requires the exact document hash and releases a handoff package; it does not claim delivery. Export includes the byte-identical PDF, request.json, audit-summary.json and instructions. Forward it manually; sequential routing requires the updated package after recording each recipient's receipt.

A recipient imports request.json and the PDF through the receipt form. The PDF hash is verified, recipient/decision selected and a self-reported receipt JSON downloaded. `createReceipt` can also produce the receipt from the active saved PDF, an exported record, recipientId, decision and comment. Over MCP and the extension API it also requires `confirmed: true`, the explicit confirmation the receipt form asks for. Audit events created over MCP record `MCP` as the actor (`Extension` for the extension API). The owner imports that receipt; wrong document/request/recipient, duplicate decisions, out-of-order sequential approvals and closed/expired requests are refused. Identical receipt IDs/data are idempotent. Statuses distinguish draft, released, partial, completed, rejected, expired, cancelled and superseded. Completed export includes the original approved PDF and audit without an account/login; it does not synthesize a signed PDF. Superseding points to another locally stored request.

The version-1 record contains immutable configuration and a SHA-256 event chain anchored to its header. Verify recomputes the root, each event and the state transitions. This checks internal consistency, not identity, delivery, trusted timestamps or authenticity against a fully rewritten chain. Identities and decisions are self-reported. This is distinct from drawn signature annotations and certificate signing/validation; no legal-validity claim is made. The adapter is intentionally local and does not implement a hosted signature provider.

Records persist in preferences; PDF bytes are not embedded there. The three most recent source PDFs are cached only in memory. After restart, reopen the exact source version or keep its original file accessible on desktop. Changed sources are refused. Limits: 100 requests, 50 recipients, 500 approval regions, 200 events per request, 50 MB source. Regions are viewport coordinates in points and review instructions, not AcroForm signature fields. API export requires a new desktop .zip path; browser UI downloads packages. Native desktop/MCP file export requires separate validation.
