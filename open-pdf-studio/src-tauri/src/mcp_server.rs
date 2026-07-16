//! In-process MCP server. Started by `--mcp-server` CLI flag and used by the
//! render-regression-test harness to drive the renderer over JSON-RPC. Refuses
//! to start in release builds unless the `OPS_ENABLE_MCP=1` environment
//! variable is set, so production users can never accidentally expose the
//! server.
//!
//! ## Why hand-rolled instead of `rmcp`?
//!
//! The plan originally targeted `rmcp = "0.7"` with a `transport-streamable-
//! http-server` feature. The published `rmcp` crate has shifted to a
//! macro-driven `tool_router` / `tool_handler` design (1.x) that requires
//! `schemars` and a particular ToolRouter wiring pattern, and the public
//! types/feature-flags have moved between minor versions. Since this scaffold
//! only needs three JSON-RPC methods (`initialize`, `tools/list`,
//! `tools/call`), we use plain `axum` + `serde_json` and dispatch on the
//! method string. Tool-handler logic added in tasks 6-9 plugs into the
//! existing `tools/call` match arm.
//!
//! ## Wire protocol
//!
//! POST `/mcp` with a JSON-RPC 2.0 request body. Responses are JSON-RPC 2.0
//! response objects (no SSE streaming — clients that need streaming should
//! poll, but the harness uses request/response only).
//!
//! ## Test corpus directory
//!
//! `test_pdfs_dir` is captured at server-start time and stashed in the
//! `AppState` so future tool handlers (Task 6: `list_test_pdfs`) can resolve
//! relative paths without touching the process CWD again.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::mcp_app_bridge::{self, McpAppBridge};

/// Per-server state. Cloned (cheaply, via Arc) into every request handler.
///
/// `app_handle` is `Some` whenever the MCP server is launched from inside
/// `tauri::Builder::setup()` (the normal `--mcp-server` path). It is `None`
/// for unit tests that drive the handlers directly without a running Tauri
/// instance — in that case the `app_*` tools return an "app not available"
/// error instead of panicking.
#[derive(Clone)]
pub struct AppState {
    pub test_pdfs_dir: Arc<PathBuf>,
    pub app_handle: Option<AppHandle>,
}

/// Resolve the corpus independently of the process working directory.
/// CI can point at a small committed fixture set; local runs default to the
/// repository corpus next to the workspace root.
pub fn resolve_test_pdfs_dir(override_dir: Option<PathBuf>) -> PathBuf {
    override_dir.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden")
    })
}

/// Standard JSON-RPC error codes used by this server. Codes not yet
/// dispatched in handler bodies are kept available for tool handlers added
/// in tasks 7-9.
#[allow(dead_code)]
mod jsonrpc_error {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
}

/// Build a JSON-RPC 2.0 success response.
fn rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

/// Build a JSON-RPC 2.0 error response.
fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        },
    })
}

/// Handle the MCP `initialize` method. Identifies the server and advertises
/// the `tools` capability (the actual list will populate as tasks 6-9 land).
fn handle_initialize() -> Value {
    json!({
        "protocolVersion": "2025-03-26",
        "serverInfo": {
            "name": "open-pdf-studio",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "tools": {
                "listChanged": false
            }
        },
    })
}

/// Handle `tools/list`. Tasks 7-9 will append their tool descriptors to
/// this array.
fn handle_tools_list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_test_pdfs",
                "description": "List all PDFs in the test corpus directory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "screenshot_page",
                "description": "Render a single PDF page to PNG (returned as base64).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":       { "type": "string" },
                        "page_index": { "type": "integer", "minimum": 0 },
                        "width":      { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "required": ["path", "page_index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_pdf_metadata",
                "description": "Read PDF version, producer, and per-page metadata.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "path": { "type": "string" } },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "screenshot_all",
                "description": "Render all pages of a PDF as base64 PNGs. For batch rendering; clients with size constraints should call screenshot_page per page instead.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":  { "type": "string" },
                        "width": { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_open_pdf",
                "description": "Tell the LIVE running app to open a PDF in a new tab. Returns once the document is loaded and the tab is active. Requires the Tauri WebView to be alive (--mcp-server mode).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_zoom",
                "description": "Set the page-view zoom in the LIVE app. scale=1.0 means 100%, 2.0 means 200%, etc.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scale": { "type": "number", "minimum": 0.05, "maximum": 32.0 }
                    },
                    "required": ["scale"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_in",
                "description": "Trigger one zoom-in step in the LIVE app (same as the toolbar +).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_out",
                "description": "Trigger one zoom-out step in the LIVE app (same as the toolbar -).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_screenshot_view",
                "description": "Capture the LIVE app's current page view as a base64 PNG. Composites the PDF canvas with the annotation/highlight overlays (NOT the surrounding chrome — for that use OS-level screenshotting).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "width": { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_move",
                "description": "Dispatch a synthetic mousemove at viewport CSS coordinates (x, y) inside the LIVE WebView. Returns the element under the cursor.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer" },
                        "y": { "type": "integer" }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_click",
                "description": "Dispatch a synthetic mouse click at (x, y). Sequence: mousemove -> mousedown -> mouseup -> click (or contextmenu for right). button: 'left' (default) | 'middle' | 'right'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":      { "type": "integer" },
                        "y":      { "type": "integer" },
                        "button": { "type": "string", "enum": ["left", "middle", "right"], "default": "left" }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_drag",
                "description": "Dispatch a synthetic drag from (x1,y1) to (x2,y2) using `steps` interpolated mousemove events. Sequence: mousedown(x1,y1) -> N x mousemove -> mouseup(x2,y2). button: 'left' (default) | 'middle' | 'right'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x1":     { "type": "integer" },
                        "y1":     { "type": "integer" },
                        "x2":     { "type": "integer" },
                        "y2":     { "type": "integer" },
                        "button": { "type": "string", "enum": ["left", "middle", "right"], "default": "left" },
                        "steps":  { "type": "integer", "minimum": 1, "maximum": 200, "default": 10 }
                    },
                    "required": ["x1", "y1", "x2", "y2"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_scroll",
                "description": "Dispatch a synthetic wheel event at (x, y) with delta (dx, dy) in CSS pixels. Set ctrlKey=true to test ctrl+wheel zoom-to-cursor.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":       { "type": "integer" },
                        "y":       { "type": "integer" },
                        "dx":      { "type": "integer", "default": 0 },
                        "dy":      { "type": "integer", "default": 0 },
                        "ctrlKey": { "type": "boolean", "default": false },
                        "shiftKey":{ "type": "boolean", "default": false },
                        "altKey":  { "type": "boolean", "default": false },
                        "metaKey": { "type": "boolean", "default": false }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_key",
                "description": "Press a single key (with optional modifiers) on the focused element. Dispatches keydown then keyup. e.g. {key:'Escape'} or {key:'z', ctrl:true} for undo.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "key":   { "type": "string" },
                        "ctrl":  { "type": "boolean", "default": false },
                        "shift": { "type": "boolean", "default": false },
                        "alt":   { "type": "boolean", "default": false },
                        "meta":  { "type": "boolean", "default": false }
                    },
                    "required": ["key"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_type",
                "description": "Type a string into the focused element. For each character: keydown -> beforeinput -> (value splice) -> input -> keyup. Editable inputs receive value updates; non-editable elements receive only the key events.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" }
                    },
                    "required": ["text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_viewport_state",
                "description": "Probe the LIVE viewport state: render engine + timing chip, active document scale/page/viewMode, pdf-viewport singleton transform, pdf-canvas backing-store + CSS rect, high-zoom tile-overlay state (visible/hidden + position+size), pdf-container CSS rect + scroll offsets, and devicePixelRatio. Use this for any case where screen↔world coordinate mapping or zoom-state needs to be validated externally — e.g. after dispatching a zoom or scroll via `app_scroll`/`app_set_zoom`, call this to see where things landed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_recent_console",
                "description": "Return the most recent matching console messages captured by the in-app observability buffer (mcp-bridge.js). Captures lines matching: [render], [tile], [wheel-zoom], [PERF], [pre-render], STALE, JANK. Buffer holds up to 500 entries; oldest auto-evicted. Filter with `since` (epoch-ms cutoff) or `tail` (last N entries) to limit output volume. Use after dispatching a zoom/scroll action to see exactly which render path fired, in what order, and whether any stale-render bailouts triggered.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "since": { "type": "number", "description": "Only return entries with timestamp >= this epoch-ms. Omit or 0 for all entries." },
                        "tail":  { "type": "integer", "minimum": 1, "description": "Return only the last N matching entries. Omit for all." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_wheel_zoom",
                "description": "Dispatch a synthetic ctrl+WheelEvent at (x, y) in the LIVE WebView — exercises the exact same wheel listener the OS hits, so this is a faithful proxy for a user spinning the wheel. `deltaY` < 0 = zoom in, > 0 = zoom out. Use this from an AI-driven debugging loop to reproduce the user's reported zoom problems WITHOUT a human at the mouse.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "number", "description": "Cursor clientX in CSS pixels (viewport-relative)." },
                        "y": { "type": "number", "description": "Cursor clientY in CSS pixels (viewport-relative)." },
                        "deltaY": { "type": "number", "description": "WheelEvent.deltaY. Default -120 (one notch zoom-in)." },
                        "ctrlKey": { "type": "boolean", "description": "Whether ctrlKey is set (default true → zoom). Set false to test plain wheel pan/scroll." }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_anchor_test",
                "description": "Full cursor-anchor accuracy probe: snapshot pre-zoom canvas+container+tile state at (x, y), dispatch a synthetic ctrl+wheel event, WAIT for renderPage to fully settle (window.__pdfRenderInFlight === 0 + 2 RAFs + 1 setTimeout to drain post-paint tile overlay), then snapshot post-zoom state and compute `anchorErrorPx` — the displacement (in CSS pixels) between where the cursor's world-point WAS before the zoom and where it ENDED UP after. < 3 px = pass (imperceptible), < 8 = acceptable, > 8 = visible spring/drift. This is the AI's primary metric for verifying zoom-anchor fixes.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "number", "description": "Cursor clientX in CSS pixels." },
                        "y": { "type": "number", "description": "Cursor clientY in CSS pixels." },
                        "direction": { "type": "string", "enum": ["in", "out"], "description": "Zoom direction. Default `in`." }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_clear_caches",
                "description": "Force-clear all PDF-related caches: Rust pdfium doc cache, Rust pixmap cache, JS-side ImageBitmap cache. Use to rule out cache-staleness as a cause of any reported zoom/render anomaly. Safe to call any time; the next renderPage will rebuild whatever it needs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_go_to_page",
                "description": "Navigate the active document to a specific 1-based page number. Wraps `goToPage()` so all the side effects (active-thumbnail update, page-input sync, fire-page-changed event) happen exactly as if the user clicked a thumbnail or pressed the page-input. Required for AI-driven test setups that need a deterministic page (e.g. BARN p.2 for zoom-anchor tests).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "page": { "type": "integer", "minimum": 1, "description": "1-based target page number." }
                    },
                    "required": ["page"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_tool",
                "description": "Switch the LIVE app's active tool, exactly like clicking the ribbon button. Accepts any registered tool name, e.g. select, hand, line, arrow, draw, box, circle, polyline, spline, arc, filledArea, textbox, callout, comment, stamp, highlight, editText, measureDistance, measureArea, measurePerimeter, measureAngle, scaleRegion, trim, extend. Returns the tool that is actually active afterwards (PDF/A read-only mode can refuse the switch).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool": { "type": "string", "description": "Registered tool name." }
                    },
                    "required": ["tool"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_current_tool",
                "description": "Return the LIVE app's currently active tool name (state.currentTool).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_merge_pdf",
                "description": "Merge one or more external PDF files into the LIVE active document (wraps mergeFiles()). Inserts the source pages at the given position and re-renders. Requires an active document. Returns { ok, position, mergedFiles, pagesBefore, pagesAfter, filePath } — filePath is the temp working copy the edited document now renders from (Issue #247: structural edits move to a fresh temp so the main view shows the merged result and the user's original stays untouched).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filePaths": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Absolute paths of PDF files to merge into the current document." },
                        "position": { "type": "string", "enum": ["end", "start", "after"], "description": "Where to insert the merged pages: 'end' (default), 'start', or 'after' the current page." }
                    },
                    "required": ["filePaths"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_ai_complete",
                "description": "Ask the LIVE app's OpenAEC AI assistant a question (POST /me/ai/complete via the signed-in OpenAEC account). Returns { ok, signedInAs, text, credits }. Tests the assistant end-to-end without driving the chat UI; requires the app to be signed in to OpenAEC.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string", "description": "The question/prompt for the assistant." },
                        "system": { "type": "string", "description": "Optional system prompt." }
                    },
                    "required": ["prompt"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_accounts_status",
                "description": "Report the LIVE app's OpenAEC sign-in state: { ok, signedIn, user:{sub,name,email}|null, brand|null }. Use to verify login from outside the WebView.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_accounts_fetch",
                "description": "Make an authenticated OpenAEC Accounts API call from the LIVE signed-in app (GET/POST/DELETE to /me/* paths, e.g. /me/apps, /me/files, /me/brand, /me/storage, /me/credits). Returns { ok, response }. Requires sign-in. Makes the whole Accounts API drivable/testable via MCP.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":   { "type": "string", "description": "API path, e.g. /me/apps" },
                        "method": { "type": "string", "enum": ["GET", "POST", "DELETE"], "description": "HTTP method (default GET)" },
                        "body":   { "type": "object", "description": "Optional JSON body for POST." }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_ask",
                "description": "Submit a message into the LIVE app's assistant window as if the user typed it (opens the panel, runs the same send() path). Drives/tests the assistant from outside the WebView. Returns { ok }. The answer comes from whichever provider resolves: OpenAEC AI, a personal Claude key, or — when neither is available — the MCP relay (app_assistant_pending + app_assistant_answer).",
                "inputSchema": {
                    "type": "object",
                    "properties": { "text": { "type": "string", "description": "The user message to submit." } },
                    "required": ["text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_pending",
                "description": "Take the oldest assistant question waiting for an MCP client to answer (the relay provider). Returns { ok, question:{ id, prompt, system, docName }|null }. When non-null, compute an answer and deliver it with app_assistant_answer — this is how an external Claude becomes the assistant's AI brain.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_assistant_answer",
                "description": "Answer a pending assistant question (id from app_assistant_pending). The text appears in the assistant window as the assistant's reply. Returns { ok, id }.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id":   { "type": "string", "description": "Question id from app_assistant_pending." },
                        "text": { "type": "string", "description": "Answer text to show in the assistant window." }
                    },
                    "required": ["id", "text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_history",
                "description": "Return the LIVE assistant conversation: { ok, messages:[{ role, content }] }. Use to verify a delivered answer landed in the window.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_create_annotation",
                "description": "Create an annotation on the LIVE app's active document WITHOUT synthetic mouse input. Builds the same object the interactive tool would, pushes it onto the document, records an undo step and redraws. Geometry goes in `props` (page coordinates at 100% zoom): line/arrow/measureDistance need startX/startY/endX/endY; box/circle/highlight/cloud/polygon/textbox/callout/scaleRegion need x/y/width/height; polyline/filledArea/measureArea/measurePerimeter need points:[{x,y},...]; spline needs controlPoints; draw needs path; comment needs x/y. Optional style props (color, strokeColor, fillColor, lineWidth, opacity, text, fontSize, scaleString, units, leaderStartX/Y, leaderEndX/Y, ...) override the tool defaults. measure* annotations get measureText computed from the document scale automatically. Returns the new annotation id.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["line", "arrow", "wall", "box", "mask", "redaction", "viewport", "circle", "highlight", "cloud", "polygon", "polyline", "cloudPolyline", "spline", "draw", "filledArea", "textbox", "callout", "comment", "stamp", "signature", "image", "parametricSymbol", "measureDistance", "measureArea", "measurePerimeter", "scaleRegion", "count"]
                        },
                        "page":  { "type": "integer", "minimum": 1, "description": "1-based target page. Defaults to the current page." },
                        "props": { "type": "object", "description": "Geometry + style properties for the annotation." }
                    },
                    "required": ["type", "props"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_annotations",
                "description": "List the active document's annotations as compact JSON (id, type, page, core geometry, colors, text/measureText). Optionally filter to one page.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "page": { "type": "integer", "minimum": 1, "description": "Only annotations on this 1-based page." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_annotation",
                "description": "Return the full JSON-safe property set of one annotation by id (functions/DOM refs stripped).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_update_annotation",
                "description": "Merge `props` onto an existing annotation (geometry, color, lineWidth, text, ...). Records a modify-undo step, recomputes measureText when measurement geometry changed, and redraws. `id` and `type` are immutable.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id":    { "type": "string" },
                        "props": { "type": "object", "description": "Property patch to merge onto the annotation." }
                    },
                    "required": ["id", "props"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_delete_annotation",
                "description": "Delete an annotation by id (records a delete-undo step and redraws).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_select_annotation",
                "description": "Select one annotation by id so the properties panel and selection handles show it, exactly like clicking it with the select tool.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_clear_selection",
                "description": "Clear the annotation selection and hide the properties panel.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_undo",
                "description": "Undo the last annotation/page edit on the active document (same as Ctrl+Z).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_redo",
                "description": "Redo the last undone edit on the active document (same as Ctrl+Y).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_tabs",
                "description": "List all open document tabs: index, fileName, filePath, modified flag, active flag, pageCount, isUntitled, currentPage, annotationCount.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_switch_tab",
                "description": "Activate the document tab at `index` (0-based, see app_list_tabs).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "minimum": 0 }
                    },
                    "required": ["index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_close_tab",
                "description": "Close the document tab at `index` (0-based). If the document has unsaved changes the call fails unless force=true — it never opens a save dialog, so the bridge stays headless-safe.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "minimum": 0 },
                        "force": { "type": "boolean", "default": false, "description": "Discard unsaved changes." }
                    },
                    "required": ["index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_new_blank_pdf",
                "description": "Create a new blank PDF document in a new tab (page size in PDF points; A4 portrait = 595 x 842).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "widthPt":  { "type": "number", "exclusiveMinimum": 0 },
                        "heightPt": { "type": "number", "exclusiveMinimum": 0 },
                        "pages":    { "type": "integer", "minimum": 1, "default": 1 }
                    },
                    "required": ["widthPt", "heightPt"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_save_pdf",
                "description": "Save the active document with all annotations baked in. With `path`, saves to that file. Without `path`, saves in place — fails (instead of opening a file picker) when the document is untitled or has no real path.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute target path. Omit to save in place." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_view_mode",
                "description": "Switch the active document view: 'single' page, 'continuous' vertical scroll, or 'book' (two-page spread, page 1 on the right). 'book' is a continuous variant.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "mode": { "type": "string", "enum": ["single", "continuous", "book"] }
                    },
                    "required": ["mode"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_fit_page",
                "description": "Zoom the active document so the whole page fits the viewport (same as the Fit Page button). Returns the resulting zoom.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_fit_width",
                "description": "Zoom the active document so the page width fills the viewport (same as the Fit Width button). Returns the resulting zoom.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_page_count",
                "description": "Return the active document's page count and current page.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_measure_scale",
                "description": "Set the active document's measurement scale calibration (pixels per unit + unit, e.g. ~2.835 px/mm for 1:1 at 72 dpi) and recalculate every measurement annotation.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "pixelsPerUnit": { "type": "number", "exclusiveMinimum": 0 },
                        "unit":          { "type": "string", "description": "Unit name, e.g. mm, cm, m, in, ft." }
                    },
                    "required": ["pixelsPerUnit", "unit"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_takeoff",
                "description": "Return take-off totals for the user's named schedules (Staten): per schedule the element count, the numeric column grand totals (e.g. area m2, length m, count), and per-group subtotals. Optionally target one schedule by id or name; otherwise all schedules are returned. Image/thumbnail columns are reported as counts, never as data-URLs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scheduleId": { "type": "string", "description": "Target one schedule by its id." },
                        "name":       { "type": "string", "description": "Target one schedule by its display name." }
                    },
                    "additionalProperties": false
                }
            }
        ]
    })
}

/// Dispatch a `tools/call` request to the matching tool handler. Returns
/// the tool's MCP-shaped result (`content[]` + `isError`) on success, or a
/// `(code, message)` pair that the caller wraps in a JSON-RPC error
/// response. Tasks 7-9 add new arms to the inner `match`.
async fn handle_tools_call(state: &AppState, params: &Value) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("<missing>");
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match name {
        "list_test_pdfs" => tool_list_test_pdfs(state).await,
        "screenshot_page" => tool_screenshot_page(state, &arguments).await,
        "get_pdf_metadata" => tool_get_pdf_metadata(state, &arguments).await,
        "screenshot_all" => tool_screenshot_all(state, &arguments).await,
        "app_open_pdf" => tool_app_request(state, "mcp:open-pdf", &arguments, Duration::from_secs(60)).await,
        "app_set_zoom" => tool_app_request(state, "mcp:set-zoom", &arguments, Duration::from_secs(15)).await,
        "app_zoom_in" => tool_app_request(state, "mcp:zoom-in", &arguments, Duration::from_secs(15)).await,
        "app_zoom_out" => tool_app_request(state, "mcp:zoom-out", &arguments, Duration::from_secs(15)).await,
        "app_screenshot_view" => tool_app_request(state, "mcp:screenshot-view", &arguments, Duration::from_secs(30)).await,
        "app_mouse_move"  => tool_app_request(state, "mcp:mouse-move",  &arguments, Duration::from_secs(10)).await,
        "app_mouse_click" => tool_app_request(state, "mcp:mouse-click", &arguments, Duration::from_secs(10)).await,
        "app_mouse_drag"  => tool_app_request(state, "mcp:mouse-drag",  &arguments, Duration::from_secs(30)).await,
        "app_scroll"      => tool_app_request(state, "mcp:scroll",      &arguments, Duration::from_secs(10)).await,
        "app_key"         => tool_app_request(state, "mcp:key",         &arguments, Duration::from_secs(10)).await,
        "app_type"        => tool_app_request(state, "mcp:type",        &arguments, Duration::from_secs(30)).await,
        "app_get_viewport_state" => tool_app_request(state, "mcp:get-viewport-state", &arguments, Duration::from_secs(5)).await,
        "app_get_recent_console" => tool_app_request(state, "mcp:get-recent-console", &arguments, Duration::from_secs(5)).await,
        "app_wheel_zoom"         => tool_app_request(state, "mcp:wheel-zoom",         &arguments, Duration::from_secs(15)).await,
        "app_zoom_anchor_test"   => tool_app_request(state, "mcp:zoom-anchor-test",   &arguments, Duration::from_secs(30)).await,
        "app_clear_caches"       => tool_app_request(state, "mcp:clear-caches",       &arguments, Duration::from_secs(10)).await,
        "app_go_to_page"         => tool_app_request(state, "mcp:go-to-page",         &arguments, Duration::from_secs(15)).await,
        "app_set_tool"           => tool_app_request(state, "mcp:set-tool",           &arguments, Duration::from_secs(10)).await,
        "app_get_current_tool"   => tool_app_request(state, "mcp:get-current-tool",   &arguments, Duration::from_secs(5)).await,
        "app_merge_pdf"          => tool_app_request(state, "mcp:merge-pdf",           &arguments, Duration::from_secs(60)).await,
        "app_ai_complete"        => tool_app_request(state, "mcp:ai-complete",         &arguments, Duration::from_secs(60)).await,
        "app_accounts_status"    => tool_app_request(state, "mcp:accounts-status",     &arguments, Duration::from_secs(5)).await,
        "app_accounts_fetch"     => tool_app_request(state, "mcp:accounts-fetch",      &arguments, Duration::from_secs(30)).await,
        "app_assistant_ask"      => tool_app_request(state, "mcp:assistant-ask",       &arguments, Duration::from_secs(10)).await,
        "app_assistant_pending"  => tool_app_request(state, "mcp:assistant-pending",   &arguments, Duration::from_secs(10)).await,
        "app_assistant_answer"   => tool_app_request(state, "mcp:assistant-answer",    &arguments, Duration::from_secs(10)).await,
        "app_assistant_history"  => tool_app_request(state, "mcp:assistant-history",   &arguments, Duration::from_secs(10)).await,
        "app_create_annotation"  => tool_app_request(state, "mcp:create-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_list_annotations"   => tool_app_request(state, "mcp:list-annotations",   &arguments, Duration::from_secs(10)).await,
        "app_get_annotation"     => tool_app_request(state, "mcp:get-annotation",     &arguments, Duration::from_secs(10)).await,
        "app_update_annotation"  => tool_app_request(state, "mcp:update-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_delete_annotation"  => tool_app_request(state, "mcp:delete-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_select_annotation"  => tool_app_request(state, "mcp:select-annotation",  &arguments, Duration::from_secs(10)).await,
        "app_clear_selection"    => tool_app_request(state, "mcp:clear-selection",    &arguments, Duration::from_secs(10)).await,
        "app_undo"               => tool_app_request(state, "mcp:undo",               &arguments, Duration::from_secs(15)).await,
        "app_redo"               => tool_app_request(state, "mcp:redo",               &arguments, Duration::from_secs(15)).await,
        "app_list_tabs"          => tool_app_request(state, "mcp:list-tabs",          &arguments, Duration::from_secs(5)).await,
        "app_switch_tab"         => tool_app_request(state, "mcp:switch-tab",         &arguments, Duration::from_secs(15)).await,
        "app_close_tab"          => tool_app_request(state, "mcp:close-tab",          &arguments, Duration::from_secs(15)).await,
        "app_new_blank_pdf"      => tool_app_request(state, "mcp:new-blank-pdf",      &arguments, Duration::from_secs(60)).await,
        "app_save_pdf"           => tool_app_request(state, "mcp:save-pdf",           &arguments, Duration::from_secs(120)).await,
        "app_set_view_mode"      => tool_app_request(state, "mcp:set-view-mode",      &arguments, Duration::from_secs(30)).await,
        "app_fit_page"           => tool_app_request(state, "mcp:fit-page",           &arguments, Duration::from_secs(15)).await,
        "app_fit_width"          => tool_app_request(state, "mcp:fit-width",          &arguments, Duration::from_secs(15)).await,
        "app_get_page_count"     => tool_app_request(state, "mcp:get-page-count",     &arguments, Duration::from_secs(5)).await,
        "app_set_measure_scale"  => tool_app_request(state, "mcp:set-measure-scale",  &arguments, Duration::from_secs(15)).await,
        "app_get_takeoff"        => tool_app_request(state, "mcp:get-takeoff",        &arguments, Duration::from_secs(10)).await,
        other => Err((
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

/// Generic dispatch for the `app_*` tools that drive the LIVE WebView via
/// the [`mcp_app_bridge`]. Emits `event_name` with `arguments` as the
/// payload's `params`, awaits the WebView's response, and wraps it in the
/// MCP-shaped result envelope. The JS side responds with arbitrary JSON
/// (typically `{ "ok": true, ... }` or `{ "error": "..." }`); we forward
/// whatever it sends so per-tool conventions stay flexible.
async fn tool_app_request(
    state: &AppState,
    event_name: &str,
    arguments: &Value,
    timeout: Duration,
) -> Result<Value, (i32, String)> {
    let app = state
        .app_handle
        .as_ref()
        .ok_or_else(|| (
            jsonrpc_error::INTERNAL_ERROR,
            "AppHandle unavailable — MCP server not started from inside Tauri::setup()".to_string(),
        ))?;
    let bridge = app.state::<McpAppBridge>();
    let response = mcp_app_bridge::request(app, &bridge, event_name, arguments.clone(), timeout)
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    Ok(json!({
        "content": [{
            "type": "text",
            "text": response.to_string(),
        }],
        "isError": false,
    }))
}

/// `list_test_pdfs` tool — enumerates every `*.pdf` under
/// `state.test_pdfs_dir` and returns its absolute path, file size, and
/// page count. Page count is read with `lopdf::Document::load_mem` inside
/// `spawn_blocking` because lopdf does synchronous I/O.
///
/// The result is shaped per the MCP convention: a single text content
/// block whose `text` field is a JSON-encoded payload. The harness in
/// Task 13 decodes this string to recover the structured `pdfs` array.
async fn tool_list_test_pdfs(state: &AppState) -> Result<Value, (i32, String)> {
    let dir: &PathBuf = &state.test_pdfs_dir;
    let mut entries = match tokio::fs::read_dir(dir.as_path()).await {
        Ok(e) => e,
        Err(e) => {
            return Err((
                jsonrpc_error::INTERNAL_ERROR,
                format!("could not read test corpus dir {:?}: {e}", dir),
            ));
        }
    };

    let mut pdfs: Vec<Value> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("pdf") {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        // page count: lopdf reads from disk synchronously, so do it on a
        // blocking thread to keep the runtime responsive.
        let path_for_count = path.clone();
        let page_count = tokio::task::spawn_blocking(move || {
            std::fs::read(&path_for_count)
                .ok()
                .and_then(|b| lopdf::Document::load_mem(&b).ok())
                .map(|doc| doc.get_pages().len())
                .unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        pdfs.push(json!({
            "path":       path.to_string_lossy(),
            "page_count": page_count,
            "file_size":  metadata.len(),
        }));
    }
    pdfs.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));

    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "pdfs": pdfs }).to_string(),
        }],
        "isError": false,
    }))
}

/// `screenshot_page` tool — renders a single PDF page via PDFium at a target
/// output width (in pixels) and returns the PNG bytes encoded as base64. The
/// MCP harness uses this to compare current renders against committed reference
/// PNGs.
///
/// Scaling: `scale = width / page_w_pt` — `width` is the literal output
/// pixel width, matching the PyMuPDF reference renderer the regression
/// harness uses (`zoom = width / page.rect.width`). For a portrait A4 page
/// at width=2000 this produces a 2000×2828 image, not 1415×2000 as a
/// `max(w,h)`-based scale would. Aligning the convention is required so
/// app-vs-reference diffs aren't dominated by an asymmetric resolution
/// scale (portrait pages would otherwise render at ~71 % of the reference
/// resolution and lose anti-aliased text sharpness in the side-by-side
/// comparison).
async fn tool_screenshot_page(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();
    let page_index = arguments
        .get("page_index")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing or invalid 'page_index'".to_string()))?
        as usize;
    let width = arguments
        .get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as u32;
    if width == 0 {
        return Err((jsonrpc_error::INVALID_PARAMS, "'width' must be > 0".to_string()));
    }

    let pdf_bytes = tokio::fs::read(&path).await.map_err(|e| {
        (
            jsonrpc_error::INTERNAL_ERROR,
            format!("read {}: {e}", path),
        )
    })?;

    let (render_width, render_height, render_rgba) = tokio::task::spawn_blocking(move || -> Result<(u32, u32, Vec<u8>), String> {
        let arc_bytes = std::sync::Arc::new(pdf_bytes.to_vec());
        let cache = crate::pdfium_renderer::PdfiumDocCache::default();
        let cache_key = format!("mcp:{:p}", arc_bytes.as_ptr());
        let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
            &cache_key, arc_bytes, &cache,
        )?;
        let doc = handle.document();
        let scale = {
            let pages = doc.pages();
            let page = pages
                .get(page_index as i32)
                .map_err(|e| format!("page_dimensions: {e}"))?;
            // Literal-width convention to match PyMuPDF reference renderer.
            width as f32 / page.width().value
        };
        crate::pdfium_renderer::render_page_to_rgba(doc, page_index as u32, scale, 0)
    })
    .await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("render task panic: {e}")))?
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
        render_width,
        render_height,
        &render_rgba,
    )
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png: {e}")))?;

    let payload = json!({
        "png_base64": png_b64,
        "width":  render_width,
        "height": render_height,
    });

    Ok(json!({
        "content": [{
            "type": "text",
            "text": payload.to_string(),
        }],
        "isError": false,
    }))
}

/// `get_pdf_metadata` tool — reads the PDF version, producer/creator metadata,
/// and per-page MediaBox + rotation directly from the PDF structure via
/// `lopdf`. Used by the regression harness to confirm the rendered output
/// matches the source document's declared geometry.
///
/// In lopdf 0.34 `Document.version` is a plain `String` (e.g. `"1.4"`), so it
/// is returned verbatim as `pdf_version`. Producer/Creator are read from
/// `/Info`, which may be either a direct dict or an indirect reference; both
/// shapes are handled. MediaBox values may be PDF Integer or Real, and both
/// are coerced to `f32`.
async fn tool_get_pdf_metadata(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();

    // lopdf is sync; offload to spawn_blocking so we don't stall the runtime.
    let payload = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path))?;
        let doc = lopdf::Document::load_mem(&bytes).map_err(|e| format!("parse: {e}"))?;

        // lopdf 0.34: `Document.version` is `pub version: String` (e.g. "1.4").
        let pdf_version = doc.version.clone();

        // Producer / Creator from /Info
        let mut producer = String::new();
        let mut creator = String::new();
        if let Ok(info_ref) = doc.trailer.get(b"Info") {
            // /Info can be a direct dict OR an indirect reference. Resolve both.
            let info_dict_opt = if let Ok(reference) = info_ref.as_reference() {
                doc.get_object(reference).ok().and_then(|o| o.as_dict().ok())
            } else {
                info_ref.as_dict().ok()
            };
            if let Some(info) = info_dict_opt {
                let read_str = |key: &[u8]| -> String {
                    info.get(key)
                        .ok()
                        .and_then(|o| match o {
                            lopdf::Object::String(s, _) => {
                                Some(String::from_utf8_lossy(s).into_owned())
                            }
                            _ => None,
                        })
                        .unwrap_or_default()
                };
                producer = read_str(b"Producer");
                creator = read_str(b"Creator");
            }
        }

        // Per-page: index, mediabox, rotation
        let pages_map = doc.get_pages(); // BTreeMap<u32 page_num, ObjectId>
        let mut pages_json = Vec::with_capacity(pages_map.len());
        for (idx, (_page_num, page_id)) in pages_map.iter().enumerate() {
            let mut mediabox: Vec<f32> = Vec::new();
            let mut rotation: i64 = 0;
            if let Ok(p_dict) = doc.get_object(*page_id).and_then(|o| o.as_dict()) {
                if let Ok(arr) = p_dict.get(b"MediaBox").and_then(|o| o.as_array()) {
                    mediabox = arr
                        .iter()
                        .filter_map(|o| match o {
                            lopdf::Object::Integer(i) => Some(*i as f32),
                            lopdf::Object::Real(r) => Some(*r),
                            _ => None,
                        })
                        .collect();
                }
                rotation = p_dict
                    .get(b"Rotate")
                    .ok()
                    .and_then(|o| o.as_i64().ok())
                    .unwrap_or(0);
            }
            pages_json.push(json!({
                "index":    idx,
                "mediabox": mediabox,
                "rotation": rotation
            }));
        }

        Ok(json!({
            "pdf_version": pdf_version,
            "page_count":  pages_map.len(),
            "producer":    producer,
            "creator":     creator,
            "pages":       pages_json
        }))
    })
    .await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("metadata task panic: {e}")))?
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    Ok(json!({
        "content": [{ "type": "text", "text": payload.to_string() }],
        "isError": false
    }))
}

/// `screenshot_all` tool — renders every page of a PDF via PDFium and returns
/// each as a base64 PNG in a `pages` array. Pages are rendered serially to
/// keep memory bounded for large multi-page PDFs.
///
/// Page count is read once via `lopdf` so we know how many render passes to
/// schedule, then PDFium produces the raster for each page using the same
/// scaling convention as `screenshot_page`:
/// `scale = width / page_w_pt` (literal output width).
async fn tool_screenshot_all(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();
    let width = arguments
        .get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as u32;
    if width == 0 {
        return Err((jsonrpc_error::INVALID_PARAMS, "'width' must be > 0".to_string()));
    }

    // First, count pages via lopdf so we know how many render passes to do.
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        (jsonrpc_error::INTERNAL_ERROR, format!("read {}: {e}", path))
    })?;

    let total: usize = {
        let bytes_clone = bytes.clone();
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let doc = lopdf::Document::load_mem(&bytes_clone)
                .map_err(|e| format!("parse: {e}"))?;
            Ok(doc.get_pages().len())
        })
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("count task panic: {e}")))?
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?
    };

    // Render every page sequentially. Parallelizing would help wall-clock time
    // but sticking to serial keeps memory bounded for big multi-page PDFs.
    let bytes_arc = std::sync::Arc::new(bytes);
    let mut pages_json: Vec<Value> = Vec::with_capacity(total);

    for idx in 0..total {
        let bytes_clone = bytes_arc.clone();
        let (rw, rh, rgba) = tokio::task::spawn_blocking(move || -> Result<(u32, u32, Vec<u8>), String> {
            let arc_bytes = bytes_clone;
            let cache = crate::pdfium_renderer::PdfiumDocCache::default();
            let cache_key = format!("mcp:{:p}", arc_bytes.as_ptr());
            let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
                &cache_key, arc_bytes, &cache,
            )?;
            let doc = handle.document();
            let scale = {
                let pages = doc.pages();
                let page = pages
                    .get(idx as i32)
                    .map_err(|e| format!("page_dimensions[{idx}]: {e}"))?;
                // Literal-width convention to match PyMuPDF reference renderer.
                width as f32 / page.width().value
            };
            crate::pdfium_renderer::render_page_to_rgba(doc, idx as u32, scale, 0)
        })
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("render task panic on page {idx}: {e}")))?
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

        let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
            rw,
            rh,
            &rgba,
        )
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png[{idx}]: {e}")))?;

        pages_json.push(json!({
            "index":      idx,
            "png_base64": png_b64,
            "width":      rw,
            "height":     rh
        }));
    }

    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "pages": pages_json }).to_string()
        }],
        "isError": false
    }))
}

/// Axum POST handler for `/mcp`. Parses the JSON-RPC envelope and dispatches
/// on the `method` field.
async fn mcp_handler(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    // Pull out the request id; default to null so error responses are still
    // well-formed if the client omitted it.
    let id = body.get("id").cloned().unwrap_or(Value::Null);

    let method = match body.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            return (
                StatusCode::OK,
                Json(rpc_error(
                    id,
                    jsonrpc_error::INVALID_REQUEST,
                    "missing 'method' field",
                )),
            );
        }
    };

    let response = match method {
        "initialize" => rpc_result(id, handle_initialize()),
        "tools/list" => rpc_result(id, handle_tools_list()),
        "tools/call" => {
            let empty = Value::Null;
            let params = body.get("params").unwrap_or(&empty);
            match handle_tools_call(&state, params).await {
                Ok(value) => rpc_result(id, value),
                Err((code, msg)) => rpc_error(id, code, msg),
            }
        }
        // `notifications/initialized` and other notification methods carry no
        // id and expect no response. We still send back an empty result for
        // robustness; the harness ignores unknown ids.
        "notifications/initialized" | "initialized" => rpc_result(id, json!({})),
        other => rpc_error(
            id,
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        ),
    };

    (StatusCode::OK, Json(response))
}

/// Start the MCP server. This is an async function that runs forever (until
/// the binding errors or the process exits). Callers should `tauri::async_
/// runtime::spawn` it from `lib::run` so the Tauri event loop continues.
///
/// In release builds, the server refuses to start unless `OPS_ENABLE_MCP=1`
/// is set in the environment.
pub async fn start(
    port: u16,
    test_pdfs_dir: PathBuf,
    app_handle: Option<AppHandle>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) && std::env::var("OPS_ENABLE_MCP").as_deref() != Ok("1") {
        return Err(
            "MCP server refused to start: release build without OPS_ENABLE_MCP=1".into(),
        );
    }

    let state = AppState {
        test_pdfs_dir: Arc::new(test_pdfs_dir),
        app_handle,
    };

    let app = Router::new()
        .route("/mcp", post(mcp_handler))
        .with_state(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("bad addr: {e}"))?;

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;

    eprintln!("MCP server listening on http://127.0.0.1:{port}/mcp");

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("MCP server error: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_response_shape() {
        let v = handle_initialize();
        assert_eq!(v["serverInfo"]["name"], "open-pdf-studio");
        assert_eq!(v["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(v["capabilities"]["tools"]["listChanged"], false);
        assert_eq!(v["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn tools_list_advertises_list_test_pdfs() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        assert!(
            arr.iter().any(|t| t["name"] == "list_test_pdfs"),
            "tools list must advertise list_test_pdfs, got: {arr:?}"
        );
        let tool = arr
            .iter()
            .find(|t| t["name"] == "list_test_pdfs")
            .expect("descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }

    #[test]
    fn resolve_test_pdfs_dir_prefers_explicit_override() {
        let fixture = PathBuf::from("render-fixtures");
        assert_eq!(resolve_test_pdfs_dir(Some(fixture.clone())), fixture);
    }

    #[test]
    fn resolve_test_pdfs_dir_defaults_to_repository_corpus() {
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden");

        assert_eq!(resolve_test_pdfs_dir(None), expected);
    }

    /// Exercises the real `tool_list_test_pdfs` over a fixture directory.
    /// We point `AppState.test_pdfs_dir` at the repo's actual test corpus
    /// (`../../test pdf-bestanden/Originele bestanden`) so this also serves
    /// as a smoke test when the GUI binary cannot be launched.
    #[test]
    fn tool_list_test_pdfs_returns_corpus_entries() {
        // Resolve corpus relative to this crate's manifest dir so the test is
        // CWD-independent.
        let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.is_dir() {
            // Skip gracefully if the corpus isn't checked in on this clone.
            eprintln!("skipping: corpus dir not found at {:?}", corpus);
            return;
        }

        let state = AppState {
            test_pdfs_dir: Arc::new(corpus),
            app_handle: None,
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let value = rt
            .block_on(tool_list_test_pdfs(&state))
            .expect("tool_list_test_pdfs ok");

        assert_eq!(value["isError"], false);
        let text = value["content"][0]["text"]
            .as_str()
            .expect("text content present");
        let payload: Value =
            serde_json::from_str(text).expect("text payload is valid JSON");
        let pdfs = payload["pdfs"].as_array().expect("pdfs is an array");
        assert!(
            !pdfs.is_empty(),
            "expected at least one PDF in the corpus, got payload {payload}"
        );
        for entry in pdfs {
            assert!(entry["path"].is_string(), "path is string");
            assert!(entry["file_size"].is_u64(), "file_size is unsigned int");
            assert!(
                entry["page_count"].as_u64().unwrap_or(0) > 0,
                "page_count > 0 for {}",
                entry["path"]
            );
        }
    }

    #[test]
    fn tools_list_advertises_screenshot_page() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        let tool = arr
            .iter()
            .find(|t| t["name"] == "screenshot_page")
            .expect("screenshot_page descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
        let required = tool["inputSchema"]["required"]
            .as_array()
            .expect("required is array");
        let names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(names.contains(&"path"));
        assert!(names.contains(&"page_index"));
    }

    #[tokio::test]
    async fn tool_screenshot_page_returns_png_base64() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // CARGO_MANIFEST_DIR is `<repo>/open-pdf-studio/src-tauri`. The corpus
        // sits at `<repo>/test pdf-bestanden/Originele bestanden/`.
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing at {:?}", corpus);
            return;
        }
        // Pick the smallest PDF deterministically.
        let mut pdfs: Vec<_> = std::fs::read_dir(&corpus).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pdf"))
            .collect();
        pdfs.sort_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX));
        let smallest = pdfs.first().expect("no pdfs in corpus").clone();

        let state = AppState { test_pdfs_dir: std::sync::Arc::new(corpus), app_handle: None };
        let args = serde_json::json!({
            "path": smallest.to_string_lossy(),
            "page_index": 0,
            "width": 200
        });
        let result = tool_screenshot_page(&state, &args).await.expect("render ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        let b64 = body["png_base64"].as_str().unwrap();
        assert!(b64.starts_with("iVBORw0KGgo"), "expected png magic; got {}", &b64[..20]);
        assert!(body["width"].as_u64().unwrap() > 0);
    }

    #[test]
    fn tools_list_advertises_get_pdf_metadata() {
        let v = handle_tools_list();
        let names: Vec<&str> = v["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"get_pdf_metadata"));
    }

    #[tokio::test]
    async fn tool_get_pdf_metadata_returns_version_and_pages() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing at {:?}", corpus);
            return;
        }
        // Pick "Technische tekening.pdf" — a known /Rotate=90 file with multi-page content.
        let pdf = corpus.join("Technische tekening.pdf");
        if !pdf.exists() {
            eprintln!("[skip] expected test pdf missing: {:?}", pdf);
            return;
        }

        let state = AppState {
            test_pdfs_dir: std::sync::Arc::new(corpus),
            app_handle: None,
        };
        let args = serde_json::json!({ "path": pdf.to_string_lossy() });
        let result = tool_get_pdf_metadata(&state, &args).await.expect("metadata ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));

        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        assert!(body["pdf_version"].as_str().unwrap().starts_with("1."));
        let page_count = body["page_count"].as_u64().unwrap();
        assert!(page_count >= 1, "expected at least 1 page");
        let pages = body["pages"].as_array().unwrap();
        assert_eq!(pages.len() as u64, page_count);
        // Page 0 of Technische tekening.pdf has /Rotate 90 in the source PDF.
        let rot0 = pages[0]["rotation"].as_i64().unwrap();
        assert_eq!(rot0, 90, "Technische tekening.pdf page 0 should have /Rotate 90");
        let mediabox = pages[0]["mediabox"].as_array().unwrap();
        assert_eq!(mediabox.len(), 4, "MediaBox should be 4 numbers");
    }

    #[test]
    fn tools_list_advertises_screenshot_all() {
        let v = handle_tools_list();
        let names: Vec<&str> = v["tools"].as_array().unwrap().iter()
            .map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"screenshot_all"));
    }

    #[tokio::test]
    async fn tool_screenshot_all_renders_every_page() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing");
            return;
        }
        // Pick the smallest multi-page-or-one PDF so the test runs fast.
        let pdfs: Vec<_> = std::fs::read_dir(&corpus).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pdf"))
            .collect();
        let smallest = pdfs.iter()
            .min_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX))
            .expect("no pdfs in corpus")
            .clone();

        let state = AppState { test_pdfs_dir: std::sync::Arc::new(corpus), app_handle: None };
        let args = serde_json::json!({
            "path": smallest.to_string_lossy(),
            "width": 200
        });
        let result = tool_screenshot_all(&state, &args).await.expect("render ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        let pages = body["pages"].as_array().unwrap();
        assert!(!pages.is_empty(), "should have at least one page");
        for (i, p) in pages.iter().enumerate() {
            assert_eq!(p["index"].as_u64().unwrap(), i as u64);
            let b64 = p["png_base64"].as_str().unwrap();
            assert!(b64.starts_with("iVBORw0KGgo"), "page {i} not a valid png");
            assert!(p["width"].as_u64().unwrap() > 0);
            assert!(p["height"].as_u64().unwrap() > 0);
        }
    }

    /// Confirms every new mouse + keyboard tool is registered with a
    /// well-formed input schema. Catches drift between the descriptor
    /// list and the dispatch arms.
    #[test]
    fn tools_list_advertises_input_tools() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools is an array");
        let names: Vec<&str> = arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for tool in [
            "app_mouse_move",
            "app_mouse_click",
            "app_mouse_drag",
            "app_scroll",
            "app_key",
            "app_type",
        ] {
            assert!(names.contains(&tool), "missing tool: {tool} (got {names:?})");
            let descr = arr.iter().find(|t| t["name"] == tool).unwrap();
            assert_eq!(
                descr["inputSchema"]["type"], "object",
                "{tool} schema must be an object"
            );
            assert_eq!(
                descr["inputSchema"]["additionalProperties"], false,
                "{tool} should reject unknown fields"
            );
        }
    }

    /// Confirms every app-control tool (tools/annotations/tabs/view/scale)
    /// is registered with a well-formed input schema. Catches drift between
    /// the descriptor list and the dispatch arms.
    #[test]
    fn tools_list_advertises_app_control_tools() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools is an array");
        let names: Vec<&str> = arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for tool in [
            "app_set_tool",
            "app_get_current_tool",
            "app_assistant_ask",
            "app_assistant_pending",
            "app_assistant_answer",
            "app_assistant_history",
            "app_create_annotation",
            "app_list_annotations",
            "app_get_annotation",
            "app_update_annotation",
            "app_delete_annotation",
            "app_select_annotation",
            "app_clear_selection",
            "app_undo",
            "app_redo",
            "app_list_tabs",
            "app_switch_tab",
            "app_close_tab",
            "app_new_blank_pdf",
            "app_save_pdf",
            "app_set_view_mode",
            "app_fit_page",
            "app_fit_width",
            "app_get_page_count",
            "app_set_measure_scale",
            "app_get_takeoff",
        ] {
            assert!(names.contains(&tool), "missing tool: {tool} (got {names:?})");
            let descr = arr.iter().find(|t| t["name"] == tool).unwrap();
            assert_eq!(
                descr["inputSchema"]["type"], "object",
                "{tool} schema must be an object"
            );
            assert_eq!(
                descr["inputSchema"]["additionalProperties"], false,
                "{tool} should reject unknown fields"
            );
        }
    }

    /// Sanity-check that calling an `app_*` tool without an AppHandle
    /// returns an error rather than panicking. Same harness pattern as
    /// the original 5 app_* tools.
    #[tokio::test]
    async fn input_tools_without_app_handle_return_error() {
        let state = AppState {
            test_pdfs_dir: std::sync::Arc::new(std::path::PathBuf::from(".")),
            app_handle: None,
        };
        for (name, args) in [
            ("app_mouse_move",  serde_json::json!({"x": 100, "y": 100})),
            ("app_mouse_click", serde_json::json!({"x": 100, "y": 100})),
            ("app_mouse_drag",  serde_json::json!({"x1": 0, "y1": 0, "x2": 1, "y2": 1})),
            ("app_scroll",      serde_json::json!({"x": 100, "y": 100, "dy": -1})),
            ("app_key",         serde_json::json!({"key": "Escape"})),
            ("app_type",        serde_json::json!({"text": "x"})),
        ] {
            let params = serde_json::json!({"name": name, "arguments": args});
            let result = handle_tools_call(&state, &params).await;
            assert!(result.is_err(), "{name} must return Err without an AppHandle");
            let (_code, msg) = result.unwrap_err();
            assert!(
                msg.contains("AppHandle unavailable"),
                "{name} message should explain missing AppHandle, got: {msg}"
            );
        }
    }
}
