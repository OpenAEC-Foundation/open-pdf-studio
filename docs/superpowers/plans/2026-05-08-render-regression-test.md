# Render Regression Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app screenshot tool exposed via an in-process MCP HTTP server, plus a Python harness that pixel-diffs every test PDF page against a PyMuPDF reference and emits an HTML/JSON report — so kernel regressions surface before they're discovered manually.

**Architecture:** A new Tauri command `render_page_to_png` wraps `open_pdf_render::render_page` and returns base64 PNG bytes. A new Rust module `mcp_server.rs` (using `rmcp` + `axum`) starts on `localhost:9223` when the app is launched with `--mcp-server`, exposing four MCP tools that proxy to the Tauri command and the test corpus on disk. A Python harness in `scripts/render-regression-test.py` connects to that server, generates PyMuPDF references in parallel, computes a Gaussian-blur pixel diff, and writes per-run HTML + summary.json artifacts under `test pdf-bestanden/render-regression-runs/`.

**Tech Stack:** Rust (Tauri 2.10, `image` crate with png feature, `base64`, `rmcp` MCP SDK, `axum` HTTP/SSE, `tokio`, `clap` for CLI args). Python 3.11+ (`pymupdf`, `pillow`, `numpy`, `mcp`, `httpx`, `jinja2`, `pytest` for harness unit tests).

**Spec reference:** `docs/superpowers/specs/2026-05-08-render-regression-test-design.md`

---

## File Structure

**New files (Rust side):**
- `open-pdf-studio/src-tauri/src/render_to_png.rs` — PNG encoding helper + `render_page_to_png` Tauri command
- `open-pdf-studio/src-tauri/src/mcp_server.rs` — MCP server module with four tools

**Modified files (Rust side):**
- `open-pdf-studio/src-tauri/Cargo.toml` — add `rmcp`, `axum`, `clap`, enable `image/png` feature
- `open-pdf-studio/src-tauri/src/lib.rs` — register Tauri command, parse `--mcp-server` flag, conditionally start server
- `open-pdf-studio/src-tauri/src/main.rs` — pass-through to `lib.rs::run`

**New files (Python harness):**
- `scripts/render-regression-test.py` — entry point + CLI args
- `scripts/requirements-test.txt` — pinned test deps
- `scripts/render_test/__init__.py` — package marker
- `scripts/render_test/compare.py` — pixel diff logic
- `scripts/render_test/reference.py` — PyMuPDF reference renderer
- `scripts/render_test/app_client.py` — MCP client wrapper
- `scripts/render_test/report.py` — HTML + summary.json writers
- `scripts/render_test/templates/report.html.j2` — Jinja2 HTML template
- `scripts/render_test/tests/__init__.py` — pytest package marker
- `scripts/render_test/tests/test_compare.py` — compare unit tests
- `scripts/render_test/tests/test_reference.py` — reference renderer unit tests
- `scripts/render_test/tests/test_report.py` — report writer unit tests
- `scripts/render_test/tests/fixtures/tiny.pdf` — 1-page test fixture for unit tests

**Modified files (glue):**
- `package.json` — add `test:render` and `test:render:auto` scripts
- `.gitignore` — add `test pdf-bestanden/render-regression-runs/` and `scripts/.venv-test/`

**New files (CI):**
- `.github/workflows/render-regression.yml` — runs `test:render:auto` on PR

---

## Task 1: Add `image/png` feature + verify PNG encoding works

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml` (the `image` line)

The existing dep is `image = { version = "0.25", default-features = false, features = ["jpeg"] }`. We need PNG too.

- [ ] **Step 1: Edit Cargo.toml**

Open `open-pdf-studio/src-tauri/Cargo.toml`. Find the line:

```toml
image = { version = "0.25", default-features = false, features = ["jpeg"] }
```

Change to:

```toml
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
```

- [ ] **Step 2: Verify build still passes**

Run from `open-pdf-studio/`:

```
cargo check -p app_lib
```

Expected: succeeds (only re-compiles `image` and dependents).

- [ ] **Step 3: Commit**

```
git add open-pdf-studio/src-tauri/Cargo.toml
git commit -m "chore(tauri): enable png feature in image crate"
```

---

## Task 2: PNG encoding helper with TDD

**Files:**
- Create: `open-pdf-studio/src-tauri/src/render_to_png.rs`

We separate the encoding helper from the Tauri command so we can unit-test it without a Tauri context.

- [ ] **Step 1: Write the failing test**

Create `open-pdf-studio/src-tauri/src/render_to_png.rs`:

```rust
//! PNG encoding helper + Tauri command for rendering a single PDF page.

use image::{ImageBuffer, Rgba};

/// Encode an RGBA buffer as a PNG and return raw base64 (no `data:` prefix).
pub fn encode_rgba_to_png_base64(
    width: u32,
    height: u32,
    pixels: &[u8],
) -> Result<String, String> {
    if pixels.len() as u32 != width * height * 4 {
        return Err(format!(
            "pixel buffer size mismatch: got {}, expected {}",
            pixels.len(),
            width * height * 4
        ));
    }
    let buffer: ImageBuffer<Rgba<u8>, &[u8]> =
        ImageBuffer::from_raw(width, height, pixels)
            .ok_or_else(|| "failed to construct image buffer".to_string())?;
    let mut png_bytes: Vec<u8> = Vec::with_capacity((width * height) as usize);
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    buffer
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("png encode failed: {e}"))?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(&png_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_2x2_red_to_valid_png_base64() {
        // 2x2 image, all red pixels (R=255, G=0, B=0, A=255)
        let pixels: Vec<u8> = vec![
            255, 0, 0, 255,
            255, 0, 0, 255,
            255, 0, 0, 255,
            255, 0, 0, 255,
        ];
        let b64 = encode_rgba_to_png_base64(2, 2, &pixels).unwrap();
        // PNG signature in base64 starts with "iVBORw0KGgo" for any valid PNG
        assert!(b64.starts_with("iVBORw0KGgo"), "got: {}", &b64[..30]);
        assert!(!b64.contains('\n'));
    }

    #[test]
    fn rejects_size_mismatch() {
        let pixels = vec![0u8; 8]; // claims 2x2 but only 8 bytes (need 16)
        let err = encode_rgba_to_png_base64(2, 2, &pixels).unwrap_err();
        assert!(err.contains("size mismatch"), "got: {err}");
    }
}
```

Add `pub mod render_to_png;` to `open-pdf-studio/src-tauri/src/lib.rs` near the other `mod` declarations (look for the existing `mod` lines and insert alphabetically/grouped).

- [ ] **Step 2: Run test to verify it passes (no failing-then-passing dance because the helper is pure data)**

Run from `open-pdf-studio/`:

```
cargo test -p app_lib --lib render_to_png::tests
```

Expected: 2 passed.

- [ ] **Step 3: Commit**

```
git add open-pdf-studio/src-tauri/src/render_to_png.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(render): add encode_rgba_to_png_base64 helper"
```

---

## Task 3: `render_page_to_png` Tauri command

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/render_to_png.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (register command in `invoke_handler`)

- [ ] **Step 1: Inspect existing render entry point**

Read `open-pdf-render/src/lib.rs` (top section + the `render_page` function signature). The expected signature is roughly:

```rust
pub fn render_page(pdf_bytes: &[u8], page_index: usize, target_width: u32) -> Result<RenderedPage, String>;
```

where `RenderedPage` has fields like `width: u32`, `height: u32`, `rgba: Vec<u8>`.

If the actual signature differs, adjust the call in Step 2 accordingly. (Look for an existing call site in `src-tauri/src/lib.rs` — the `render_thumbnail` command uses the same crate and shows the real signature.)

- [ ] **Step 2: Add the Tauri command to `render_to_png.rs`**

Append to `render_to_png.rs`:

```rust
/// Render a PDF page at `target_width` pixels and return a base64-encoded PNG.
/// Used by both the in-app "Export page as image" feature (future) and the MCP
/// regression-test server.
#[tauri::command]
pub async fn render_page_to_png(
    path: String,
    page_index: usize,
    target_width: u32,
) -> Result<String, String> {
    if target_width == 0 {
        return Err("target_width must be > 0".to_string());
    }

    let pdf_bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read PDF '{path}': {e}"))?;

    // open_pdf_render is sync + CPU-bound; offload to a blocking task so we
    // don't stall the Tauri async runtime.
    let rendered = tokio::task::spawn_blocking(move || {
        open_pdf_render::render_page(&pdf_bytes, page_index, target_width)
    })
    .await
    .map_err(|e| format!("render task panicked: {e}"))??;

    encode_rgba_to_png_base64(rendered.width, rendered.height, &rendered.rgba)
}
```

If `open_pdf_render::render_page` returns a different shape (e.g. `(u32, u32, Vec<u8>)`), unpack accordingly.

- [ ] **Step 3: Register the command in `lib.rs`**

Open `open-pdf-studio/src-tauri/src/lib.rs`. Find the existing `tauri::generate_handler![...]` macro call (search for `generate_handler!`). Add `render_to_png::render_page_to_png` to the list — preserve the trailing comma style of the existing list.

- [ ] **Step 4: Build to verify wiring**

```
cargo check -p app_lib
```

Expected: succeeds. If `open_pdf_render::render_page` doesn't exist with that name, compile error pinpoints the issue — adjust import.

- [ ] **Step 5: Smoke test from JS console**

Add a temporary in-script line in `open-pdf-studio/js/main.js` (or any module loaded at startup) to test:

```js
window.__test_render = async (path, page) => {
  const { invoke } = window.__TAURI__.core;
  const t0 = performance.now();
  const b64 = await invoke('render_page_to_png', { path, pageIndex: page, targetWidth: 2000 });
  console.log(`[smoke] ${b64.length} chars base64 in ${(performance.now()-t0).toFixed(0)}ms`);
  return b64.slice(0, 40);
};
```

Run dev (`npm run tauri dev`), open devtools, then in console:

```js
await window.__test_render('C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/Tekst.pdf', 0)
```

Expected: returns a string starting with `iVBORw0KGgo`. If you save the full base64 to a file and decode you should get a valid PNG.

Once verified, REMOVE the `window.__test_render` line — it's not for production.

- [ ] **Step 6: Commit**

```
git add open-pdf-studio/src-tauri/src/render_to_png.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(render): add render_page_to_png Tauri command"
```

---

## Task 4: Add `clap` for CLI parsing + `--mcp-server` flag

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`
- Modify: `open-pdf-studio/src-tauri/src/main.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`

- [ ] **Step 1: Add clap dep**

In `Cargo.toml` add to `[dependencies]`:

```toml
clap = { version = "4", features = ["derive"] }
```

- [ ] **Step 2: Define args struct in `main.rs`**

Replace the contents of `open-pdf-studio/src-tauri/src/main.rs` (currently just calls `app_lib::run()`) with:

```rust
use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(name = "open-pdf-studio", version)]
struct Cli {
    /// Start an in-process MCP server on `--mcp-port` (default 9223). Off by default.
    /// Production builds refuse to start the server unless OPS_ENABLE_MCP=1.
    #[arg(long, default_value_t = false)]
    mcp_server: bool,

    /// Port for the MCP server (only used when --mcp-server is set).
    #[arg(long, default_value_t = 9223)]
    mcp_port: u16,
}

fn main() {
    // Tauri swallows unrecognized args (e.g. file-association launches), so we
    // try_parse rather than parse.
    let args: Vec<String> = std::env::args().collect();
    let cli = Cli::try_parse_from(&args).unwrap_or(Cli {
        mcp_server: false,
        mcp_port: 9223,
    });

    app_lib::run(app_lib::StartupOpts {
        mcp_server: cli.mcp_server,
        mcp_port: cli.mcp_port,
    });
}
```

- [ ] **Step 3: Define `StartupOpts` and adjust `run` in `lib.rs`**

In `open-pdf-studio/src-tauri/src/lib.rs`:

a. Add near the top, after existing `pub mod` declarations:

```rust
pub struct StartupOpts {
    pub mcp_server: bool,
    pub mcp_port: u16,
}

impl Default for StartupOpts {
    fn default() -> Self {
        Self { mcp_server: false, mcp_port: 9223 }
    }
}
```

b. Find the existing `pub fn run()` definition. Change its signature to:

```rust
pub fn run(opts: StartupOpts) {
```

If the file currently calls `run()` from anywhere with no args (e.g. mobile entry point), update those call sites to pass `StartupOpts::default()`.

c. At the start of `run`, log the MCP flag so we can see it in the debug console:

```rust
log::info!(
    "Startup: mcp_server={}, mcp_port={}",
    opts.mcp_server, opts.mcp_port
);
```

(Use `eprintln!` if `log` isn't yet wired at that point in startup.)

- [ ] **Step 4: Smoke test**

Run from `open-pdf-studio/`:

```
cargo run -p app_lib -- --mcp-server --mcp-port 9223
```

Expected: the app launches, console prints `Startup: mcp_server=true, mcp_port=9223`. Close it.

```
cargo run -p app_lib
```

Expected: the app launches with `mcp_server=false`.

- [ ] **Step 5: Commit**

```
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/main.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(cli): add --mcp-server and --mcp-port flags"
```

---

## Task 5: MCP server scaffolding (no tools yet)

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`
- Create: `open-pdf-studio/src-tauri/src/mcp_server.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`

- [ ] **Step 1: Add deps**

In `Cargo.toml` add:

```toml
rmcp = { version = "0.7", features = ["server", "transport-streamable-http-server"] }
axum = "0.8"
```

(Adjust to actual current versions on crates.io if 0.7/0.8 aren't published; the `rmcp` README lists current pinning.)

- [ ] **Step 2: Create the module skeleton**

Create `open-pdf-studio/src-tauri/src/mcp_server.rs`:

```rust
//! In-process MCP server. Started by `--mcp-server` CLI flag. Refuses to start
//! in release builds unless OPS_ENABLE_MCP=1.

use rmcp::{model::*, ServerHandler, ServerHandlerExt};
use std::net::SocketAddr;

/// Per-server state. Holds the path to the test corpus directory.
#[derive(Clone)]
pub struct AppMcpState {
    pub test_pdfs_dir: std::path::PathBuf,
}

pub struct AppMcpHandler {
    state: AppMcpState,
}

impl AppMcpHandler {
    pub fn new(state: AppMcpState) -> Self {
        Self { state }
    }
}

#[async_trait::async_trait]
impl ServerHandler for AppMcpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            name: "open-pdf-studio".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            instructions: Some(
                "Render-regression-test server for open-pdf-studio. Tools: list_test_pdfs, screenshot_page, screenshot_all, get_pdf_metadata.".into()
            ),
            capabilities: ServerCapabilities {
                tools: Some(ToolsCapability { list_changed: Some(false) }),
                ..Default::default()
            },
        }
    }
    // Tool implementations come in subsequent tasks.
}

/// Start the MCP server on the given port. Returns immediately; the server
/// runs on a tokio task. Refuses to start in release builds unless OPS_ENABLE_MCP=1.
pub async fn start(port: u16, test_pdfs_dir: std::path::PathBuf) -> Result<(), String> {
    if !cfg!(debug_assertions) && std::env::var("OPS_ENABLE_MCP").as_deref() != Ok("1") {
        return Err(
            "MCP server refused to start: release build without OPS_ENABLE_MCP=1".into(),
        );
    }

    let state = AppMcpState { test_pdfs_dir };
    let handler = AppMcpHandler::new(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("bad addr: {e}"))?;

    log::info!("MCP server listening on http://{}/mcp", addr);

    // rmcp 0.7+ ships a streamable-http server transport. Adapt the call to
    // current rmcp API if it has shifted.
    rmcp::transport::streamable_http_server::serve(addr, handler)
        .await
        .map_err(|e| format!("MCP server error: {e}"))?;

    Ok(())
}
```

(If `rmcp` 0.7's exact API differs, the bones stay the same: `ServerHandler` impl, an HTTP transport, and a `serve` call. Read `rmcp` examples if needed.)

- [ ] **Step 3: Wire up start in `lib.rs`**

Add `pub mod mcp_server;` near the other mods.

In `run(opts: StartupOpts)`, BEFORE the `tauri::Builder` setup, spawn the MCP server (if requested):

```rust
if opts.mcp_server {
    let port = opts.mcp_port;
    let test_pdfs_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("test pdf-bestanden")
        .join("Originele bestanden");
    tokio::spawn(async move {
        if let Err(e) = mcp_server::start(port, test_pdfs_dir).await {
            log::error!("MCP server failed: {e}");
        }
    });
}
```

This requires a tokio runtime. Tauri sets one up internally; if `tokio::spawn` complains about no runtime, wrap the body in `tauri::async_runtime::spawn` instead.

- [ ] **Step 4: Build**

```
cargo check -p app_lib
```

Expected: succeeds.

- [ ] **Step 5: Smoke test the empty server**

```
cargo run -p app_lib -- --mcp-server
```

Expected log line: `MCP server listening on http://127.0.0.1:9223/mcp`.

In another terminal, smoke-test:

```
curl -X POST http://127.0.0.1:9223/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}}}'
```

Expected: a JSON-RPC response with `result.serverInfo.name == "open-pdf-studio"`. (If your `rmcp` requires a different protocol-version string, adapt.)

Close the app.

- [ ] **Step 6: Commit**

```
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/mcp_server.rs open-pdf-studio/src-tauri/src/lib.rs
git commit -m "feat(mcp): scaffold MCP HTTP server (no tools yet)"
```

---

## Task 6: MCP tool — `list_test_pdfs`

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Add the tool to `AppMcpHandler`**

Inside the `impl ServerHandler for AppMcpHandler` block, add:

```rust
async fn list_tools(&self, _req: ListToolsRequest) -> Result<ListToolsResult, McpError> {
    Ok(ListToolsResult {
        tools: vec![
            Tool {
                name: "list_test_pdfs".into(),
                description: Some("List all PDFs in the test corpus.".into()),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
                ..Default::default()
            },
            // (other tools added in later tasks)
        ],
        next_cursor: None,
    })
}

async fn call_tool(&self, req: CallToolRequest) -> Result<CallToolResult, McpError> {
    match req.name.as_str() {
        "list_test_pdfs" => self.tool_list_test_pdfs().await,
        other => Err(McpError::method_not_found(format!("unknown tool: {other}"))),
    }
}
```

Then add the implementation method below the trait impl:

```rust
impl AppMcpHandler {
    async fn tool_list_test_pdfs(&self) -> Result<CallToolResult, McpError> {
        let mut pdfs = Vec::new();
        let mut entries = match tokio::fs::read_dir(&self.state.test_pdfs_dir).await {
            Ok(e) => e,
            Err(e) => return Err(McpError::internal_error(format!(
                "could not read test corpus dir {:?}: {e}", self.state.test_pdfs_dir
            ))),
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("pdf") { continue; }
            let metadata = match entry.metadata().await { Ok(m) => m, Err(_) => continue };

            // page_count via lopdf (already a dep through open-pdf-render).
            let page_count = match std::fs::read(&path).ok()
                .and_then(|bytes| lopdf::Document::load_mem(&bytes).ok())
                .map(|doc| doc.get_pages().len())
            {
                Some(n) => n,
                None => 0,
            };

            pdfs.push(serde_json::json!({
                "path": path.to_string_lossy(),
                "page_count": page_count,
                "file_size": metadata.len(),
            }));
        }
        pdfs.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));

        Ok(CallToolResult {
            content: vec![Content::text(serde_json::json!({ "pdfs": pdfs }).to_string())],
            is_error: Some(false),
        })
    }
}
```

(Adjust `Content::text` and `CallToolResult` to your `rmcp` version's actual constructors. Latest rmcp has `Content::text(string)` and structured result helpers.)

- [ ] **Step 2: Verify lopdf is reachable**

`lopdf` is already pulled in by `open-pdf-render`. Re-export or add as a direct dep:

```toml
lopdf = "0.34"
```

(in `src-tauri/Cargo.toml` — check `open-pdf-render/Cargo.toml` for the matching version.)

- [ ] **Step 3: Build**

```
cargo check -p app_lib
```

Expected: succeeds.

- [ ] **Step 4: Smoke test**

Run app with `--mcp-server`. Then:

```
curl -X POST http://127.0.0.1:9223/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_test_pdfs","arguments":{}}}'
```

Expected: response contains `pdfs: [...]` listing the 8 PDFs in `Originele bestanden/` with their page counts and sizes.

- [ ] **Step 5: Commit**

```
git add open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): add list_test_pdfs tool"
```

---

## Task 7: MCP tool — `screenshot_page`

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Add to tool list**

In `list_tools`, append:

```rust
Tool {
    name: "screenshot_page".into(),
    description: Some("Render a single page to PNG (base64).".into()),
    input_schema: serde_json::json!({
        "type": "object",
        "properties": {
            "path":       { "type": "string" },
            "page_index": { "type": "integer", "minimum": 0 },
            "width":      { "type": "integer", "minimum": 1, "default": 2000 }
        },
        "required": ["path", "page_index"],
        "additionalProperties": false
    }),
    ..Default::default()
},
```

- [ ] **Step 2: Add dispatch + implementation**

In `call_tool` add the match arm:

```rust
"screenshot_page" => self.tool_screenshot_page(req.arguments).await,
```

Add the method:

```rust
async fn tool_screenshot_page(
    &self,
    args: Option<serde_json::Value>,
) -> Result<CallToolResult, McpError> {
    let args = args.unwrap_or_default();
    let path = args["path"].as_str()
        .ok_or_else(|| McpError::invalid_params("missing 'path'"))?
        .to_string();
    let page_index = args["page_index"].as_u64()
        .ok_or_else(|| McpError::invalid_params("missing 'page_index'"))? as usize;
    let width = args.get("width").and_then(|v| v.as_u64()).unwrap_or(2000) as u32;

    let pdf_bytes = tokio::fs::read(&path).await
        .map_err(|e| McpError::internal_error(format!("read {}: {e}", path)))?;

    let rendered = tokio::task::spawn_blocking(move || {
        open_pdf_render::render_page(&pdf_bytes, page_index, width)
    })
    .await
    .map_err(|e| McpError::internal_error(format!("task panic: {e}")))?
    .map_err(|e| McpError::internal_error(format!("render: {e}")))?;

    let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
        rendered.width, rendered.height, &rendered.rgba
    ).map_err(McpError::internal_error)?;

    Ok(CallToolResult {
        content: vec![Content::text(serde_json::json!({
            "png_base64": png_b64,
            "width": rendered.width,
            "height": rendered.height
        }).to_string())],
        is_error: Some(false),
    })
}
```

- [ ] **Step 3: Build + smoke test**

```
cargo run -p app_lib -- --mcp-server
```

```
curl -X POST http://127.0.0.1:9223/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"screenshot_page","arguments":{"path":"<full-path-to>/Tekst.pdf","page_index":0,"width":1000}}}' \
  | python -c 'import sys,json; d=json.load(sys.stdin); print(len(d["result"]["content"][0]["text"]), "chars")'
```

Expected: prints a length > 50000.

- [ ] **Step 4: Commit**

```
git add open-pdf-studio/src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): add screenshot_page tool"
```

---

## Task 8: MCP tool — `get_pdf_metadata`

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Add to tool list**

```rust
Tool {
    name: "get_pdf_metadata".into(),
    description: Some("Read PDF version, producer, page metadata.".into()),
    input_schema: serde_json::json!({
        "type": "object",
        "properties": { "path": { "type": "string" } },
        "required": ["path"],
        "additionalProperties": false
    }),
    ..Default::default()
},
```

- [ ] **Step 2: Add dispatch + implementation**

In `call_tool` add `"get_pdf_metadata" => self.tool_get_pdf_metadata(req.arguments).await,`.

Then:

```rust
async fn tool_get_pdf_metadata(
    &self,
    args: Option<serde_json::Value>,
) -> Result<CallToolResult, McpError> {
    let args = args.unwrap_or_default();
    let path = args["path"].as_str()
        .ok_or_else(|| McpError::invalid_params("missing 'path'"))?
        .to_string();

    let bytes = tokio::fs::read(&path).await
        .map_err(|e| McpError::internal_error(format!("read {}: {e}", path)))?;

    let doc = lopdf::Document::load_mem(&bytes)
        .map_err(|e| McpError::internal_error(format!("parse: {e}")))?;

    // PDF version
    let pdf_version = format!("{}.{}", doc.version_major(), doc.version_minor());

    // Trailer info dict for Producer / Creator
    let mut producer = String::new();
    let mut creator  = String::new();
    if let Ok(info_obj) = doc.trailer.get(b"Info") {
        if let Ok(info_id) = info_obj.as_reference() {
            if let Ok(info) = doc.get_object(info_id).and_then(|o| o.as_dict()) {
                producer = info.get(b"Producer").ok()
                    .and_then(|o| o.as_str().ok())
                    .map(|s| String::from_utf8_lossy(s).into_owned())
                    .unwrap_or_default();
                creator = info.get(b"Creator").ok()
                    .and_then(|o| o.as_str().ok())
                    .map(|s| String::from_utf8_lossy(s).into_owned())
                    .unwrap_or_default();
            }
        }
    }

    // Per-page metadata
    let pages: Vec<_> = doc.get_pages().keys().enumerate().map(|(idx, _page_num)| {
        // Translate index -> page id from get_pages()
        let page_id = doc.get_pages().values().nth(idx).copied();
        let mut mediabox: Vec<f32> = Vec::new();
        let mut rotation = 0i64;
        if let Some(pid) = page_id {
            if let Ok(p) = doc.get_object(pid).and_then(|o| o.as_dict()) {
                if let Ok(arr) = p.get(b"MediaBox").and_then(|o| o.as_array()) {
                    mediabox = arr.iter().filter_map(|o| o.as_f64().ok().map(|v| v as f32)).collect();
                }
                rotation = p.get(b"Rotate").and_then(|o| o.as_i64()).unwrap_or(0);
            }
        }
        serde_json::json!({
            "index":    idx,
            "mediabox": mediabox,
            "rotation": rotation
        })
    }).collect();

    Ok(CallToolResult {
        content: vec![Content::text(serde_json::json!({
            "pdf_version": pdf_version,
            "page_count": pages.len(),
            "producer":   producer,
            "creator":    creator,
            "pages":      pages
        }).to_string())],
        is_error: Some(false),
    })
}
```

- [ ] **Step 3: Build + smoke test**

```
cargo check -p app_lib
```

Then start app and curl the tool:

```
curl -X POST http://127.0.0.1:9223/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_pdf_metadata","arguments":{"path":"<path>/Technische tekening.pdf"}}}'
```

Expected: result includes `pdf_version`, `page_count: 4`, and per-page `mediabox` + `rotation: 90`.

- [ ] **Step 4: Commit**

```
git add open-pdf-studio/src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): add get_pdf_metadata tool"
```

---

## Task 9: MCP tool — `screenshot_all`

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`

- [ ] **Step 1: Add to tool list**

```rust
Tool {
    name: "screenshot_all".into(),
    description: Some("Render all pages of a PDF (base64 PNGs).".into()),
    input_schema: serde_json::json!({
        "type": "object",
        "properties": {
            "path":  { "type": "string" },
            "width": { "type": "integer", "minimum": 1, "default": 2000 }
        },
        "required": ["path"],
        "additionalProperties": false
    }),
    ..Default::default()
},
```

- [ ] **Step 2: Add dispatch + implementation**

```rust
"screenshot_all" => self.tool_screenshot_all(req.arguments).await,
```

```rust
async fn tool_screenshot_all(
    &self,
    args: Option<serde_json::Value>,
) -> Result<CallToolResult, McpError> {
    let args = args.unwrap_or_default();
    let path = args["path"].as_str()
        .ok_or_else(|| McpError::invalid_params("missing 'path'"))?
        .to_string();
    let width = args.get("width").and_then(|v| v.as_u64()).unwrap_or(2000) as u32;

    let bytes = tokio::fs::read(&path).await
        .map_err(|e| McpError::internal_error(format!("read {}: {e}", path)))?;
    let doc = lopdf::Document::load_mem(&bytes)
        .map_err(|e| McpError::internal_error(format!("parse: {e}")))?;
    let total = doc.get_pages().len();

    let bytes_arc = std::sync::Arc::new(bytes);
    let mut pages = Vec::with_capacity(total);

    for idx in 0..total {
        let bytes_clone = bytes_arc.clone();
        let rendered = tokio::task::spawn_blocking(move || {
            open_pdf_render::render_page(&bytes_clone, idx, width)
        })
        .await
        .map_err(|e| McpError::internal_error(format!("task panic on page {idx}: {e}")))?
        .map_err(|e| McpError::internal_error(format!("render page {idx}: {e}")))?;

        let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
            rendered.width, rendered.height, &rendered.rgba
        ).map_err(McpError::internal_error)?;

        pages.push(serde_json::json!({
            "index":      idx,
            "png_base64": png_b64,
            "width":      rendered.width,
            "height":     rendered.height
        }));
    }

    Ok(CallToolResult {
        content: vec![Content::text(serde_json::json!({ "pages": pages }).to_string())],
        is_error: Some(false),
    })
}
```

(Progress notifications are a Spec B nice-to-have; for Spec A the harness can stay on `screenshot_page` and skip `screenshot_all` if response sizes get unwieldy.)

- [ ] **Step 3: Build + smoke test**

Same pattern as previous tasks.

- [ ] **Step 4: Commit**

```
git add open-pdf-studio/src-tauri/src/mcp_server.rs
git commit -m "feat(mcp): add screenshot_all tool"
```

---

## Task 10: Python harness — venv + scaffold

**Files:**
- Create: `scripts/requirements-test.txt`
- Create: `scripts/render_test/__init__.py`
- Create: `scripts/render_test/tests/__init__.py`
- Create: `scripts/render-regression-test.py`
- Modify: `.gitignore`

- [ ] **Step 1: Pin requirements**

Create `scripts/requirements-test.txt`:

```
pymupdf==1.24.14
pillow==10.4.0
mcp==1.2.0
httpx==0.27.2
jinja2==3.1.4
numpy==1.26.4
pytest==8.3.3
```

- [ ] **Step 2: Make package**

Create `scripts/render_test/__init__.py`:

```python
"""Render-regression test harness for open-pdf-studio."""
```

Create `scripts/render_test/tests/__init__.py` (empty file).

- [ ] **Step 3: Bootstrap entry point**

Create `scripts/render-regression-test.py`:

```python
#!/usr/bin/env python
"""Render-regression entry point. Run via `npm run test:render`."""
from render_test.main import main

if __name__ == "__main__":
    raise SystemExit(main())
```

(`render_test.main` is created in Task 14 — for now `python scripts/render-regression-test.py` will ImportError, that's fine.)

- [ ] **Step 4: Set up venv**

```
cd scripts
python -m venv .venv-test
.venv-test/Scripts/python -m pip install -U pip
.venv-test/Scripts/python -m pip install -r requirements-test.txt
.venv-test/Scripts/python -c "import fitz, PIL, mcp, httpx, jinja2, numpy, pytest; print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Update .gitignore**

Add to repo-root `.gitignore`:

```
test pdf-bestanden/render-regression-runs/
scripts/.venv-test/
```

- [ ] **Step 6: Commit**

```
git add scripts/requirements-test.txt scripts/render_test scripts/render-regression-test.py .gitignore
git commit -m "chore(test): scaffold python regression-test harness"
```

---

## Task 11: Python — `compare` module with TDD

**Files:**
- Create: `scripts/render_test/compare.py`
- Create: `scripts/render_test/tests/test_compare.py`

- [ ] **Step 1: Write failing tests**

Create `scripts/render_test/tests/test_compare.py`:

```python
import io
import numpy as np
from PIL import Image, ImageDraw

from render_test.compare import compare


def _solid(color, size=(100, 100)):
    img = Image.new("RGB", size, color)
    return img


def test_identical_images_zero_diff():
    a = _solid((128, 128, 128))
    b = _solid((128, 128, 128))
    pct, _ = compare(a, b)
    assert pct == 0.0


def test_inverted_images_high_diff():
    a = _solid((0, 0, 0))
    b = _solid((255, 255, 255))
    pct, _ = compare(a, b)
    assert pct > 95.0


def test_subpixel_aa_difference_low_diff():
    """Two images with a single 1-px-shifted line should differ by < 5% after blur."""
    a = Image.new("RGB", (200, 200), (255, 255, 255))
    b = Image.new("RGB", (200, 200), (255, 255, 255))
    d_a = ImageDraw.Draw(a); d_a.line([(50, 100), (150, 100)], fill=(0, 0, 0), width=1)
    d_b = ImageDraw.Draw(b); d_b.line([(50, 101), (150, 101)], fill=(0, 0, 0), width=1)
    pct, _ = compare(a, b)
    assert 0.0 < pct < 5.0


def test_resizes_app_to_match_ref():
    a = _solid((100, 100, 100), size=(200, 200))
    b = _solid((100, 100, 100), size=(180, 180))
    pct, _ = compare(a, b)
    # Blur removes the resize artifacts; uniform color so diff stays low.
    assert pct < 1.0


def test_overlay_is_an_image():
    a = _solid((255, 255, 255))
    b = _solid((255, 0, 0))
    _, overlay = compare(a, b)
    assert isinstance(overlay, Image.Image)
    assert overlay.size[0] >= a.size[0]  # side-by-side composition
```

- [ ] **Step 2: Run tests, verify they fail**

```
cd scripts
.venv-test/Scripts/python -m pytest render_test/tests/test_compare.py -v
```

Expected: 5 failures with `ModuleNotFoundError: No module named 'render_test.compare'`.

- [ ] **Step 3: Implement compare**

Create `scripts/render_test/compare.py`:

```python
"""Pixel-diff with Gaussian blur, plus a side-by-side overlay for human review."""
from typing import Tuple
import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageDraw


def compare(
    ref: Image.Image,
    app: Image.Image,
    blur_sigma: float = 1.0,
    pixel_tol: int = 30,
) -> Tuple[float, Image.Image]:
    """
    Returns (diff_pct, overlay_image).

    Blur both images with Gaussian σ, then count pixels where the sum of
    per-channel RGB differences exceeds `pixel_tol`. `diff_pct` is the
    percentage of such pixels (0..100).
    """
    if ref.mode != "RGB": ref = ref.convert("RGB")
    if app.mode != "RGB": app = app.convert("RGB")

    if app.size != ref.size:
        app = app.resize(ref.size, Image.LANCZOS)

    ref_b = ref.filter(ImageFilter.GaussianBlur(blur_sigma))
    app_b = app.filter(ImageFilter.GaussianBlur(blur_sigma))

    diff = ImageChops.difference(ref_b, app_b)
    arr  = np.asarray(diff, dtype=np.int32)
    mask = (arr.sum(axis=2) > pixel_tol)
    pct  = float(mask.mean()) * 100.0

    overlay = _make_overlay(ref, app, mask)
    return pct, overlay


def _make_overlay(ref: Image.Image, app: Image.Image, mask: np.ndarray) -> Image.Image:
    """Render ref / app / diff side-by-side. Diff = ref tinted red where mask is True."""
    h = ref.height
    composite = Image.new("RGB", (ref.width * 3 + 20, h + 20), (32, 32, 32))
    composite.paste(ref, (5, 5))
    composite.paste(app, (ref.width + 10, 5))

    diff_img = ref.copy().convert("RGB")
    pixels = np.array(diff_img)
    pixels[mask] = [255, 0, 0]
    diff_img = Image.fromarray(pixels)
    composite.paste(diff_img, (ref.width * 2 + 15, 5))

    d = ImageDraw.Draw(composite)
    d.text((5, h + 7), f"REF      |      APP      |      DIFF (red = >{30} per-channel sum after blur)", fill=(220, 220, 220))
    return composite
```

- [ ] **Step 4: Run tests, verify they pass**

```
.venv-test/Scripts/python -m pytest render_test/tests/test_compare.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```
git add scripts/render_test/compare.py scripts/render_test/tests/test_compare.py
git commit -m "feat(test): add render_test.compare with TDD"
```

---

## Task 12: Python — `reference` module with TDD

**Files:**
- Create: `scripts/render_test/tests/fixtures/tiny.pdf`
- Create: `scripts/render_test/reference.py`
- Create: `scripts/render_test/tests/test_reference.py`

- [ ] **Step 1: Generate a tiny test fixture PDF**

Run from `scripts/`:

```
.venv-test/Scripts/python -c "
import fitz
doc = fitz.open()
page = doc.new_page(width=200, height=300)
page.insert_text((20, 50), 'TINY PDF FIXTURE', fontsize=18)
doc.save('render_test/tests/fixtures/tiny.pdf')
doc.close()
"
```

Expected: `render_test/tests/fixtures/tiny.pdf` exists, ~3 KB.

- [ ] **Step 2: Write failing tests**

Create `scripts/render_test/tests/test_reference.py`:

```python
from pathlib import Path
import pytest
from PIL import Image
from render_test.reference import render_with_pymupdf

FIXTURE = Path(__file__).parent / "fixtures" / "tiny.pdf"


def test_renders_at_target_width():
    img = render_with_pymupdf(FIXTURE, page_index=0, width=400)
    assert isinstance(img, Image.Image)
    assert img.width == 400
    # height auto-scaled from 300/200 ratio
    assert 595 <= img.height <= 605


def test_rejects_negative_page():
    with pytest.raises(ValueError):
        render_with_pymupdf(FIXTURE, page_index=-1, width=400)


def test_rejects_out_of_range_page():
    with pytest.raises(IndexError):
        render_with_pymupdf(FIXTURE, page_index=99, width=400)


def test_returns_rgb_mode():
    img = render_with_pymupdf(FIXTURE, page_index=0, width=200)
    assert img.mode == "RGB"
```

- [ ] **Step 3: Run tests, verify they fail**

```
.venv-test/Scripts/python -m pytest render_test/tests/test_reference.py -v
```

Expected: ImportError on `render_with_pymupdf`.

- [ ] **Step 4: Implement reference module**

Create `scripts/render_test/reference.py`:

```python
"""PyMuPDF reference renderer."""
from pathlib import Path
import fitz
from PIL import Image


def render_with_pymupdf(pdf_path: Path, page_index: int, width: int) -> Image.Image:
    if page_index < 0:
        raise ValueError(f"page_index must be >= 0, got {page_index}")
    if width <= 0:
        raise ValueError(f"width must be > 0, got {width}")

    doc = fitz.open(str(pdf_path))
    try:
        if page_index >= doc.page_count:
            raise IndexError(f"page_index {page_index} out of range (max {doc.page_count - 1})")
        page = doc[page_index]
        zoom = width / page.rect.width
        pix = page.get_pixmap(
            matrix=fitz.Matrix(zoom, zoom),
            alpha=False,
            colorspace=fitz.csRGB,
        )
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    finally:
        doc.close()
```

- [ ] **Step 5: Run tests, verify they pass**

```
.venv-test/Scripts/python -m pytest render_test/tests/test_reference.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```
git add scripts/render_test/reference.py scripts/render_test/tests/test_reference.py scripts/render_test/tests/fixtures
git commit -m "feat(test): add render_test.reference with TDD"
```

---

## Task 13: Python — MCP `app_client` wrapper

**Files:**
- Create: `scripts/render_test/app_client.py`

This is glue code that's hard to TDD without a running server. We'll smoke-test it inline against the running app.

- [ ] **Step 1: Implement the client wrapper**

Create `scripts/render_test/app_client.py`:

```python
"""Thin MCP HTTP client for the open-pdf-studio test server."""
import base64
import json
from pathlib import Path
from typing import Any
from io import BytesIO
from PIL import Image
import httpx


class AppClient:
    """Synchronous MCP-over-HTTP client. One JSON-RPC request per call (no SSE)."""

    def __init__(self, url: str = "http://127.0.0.1:9223/mcp", timeout: float = 60.0):
        self.url = url
        self._client = httpx.Client(timeout=timeout)
        self._next_id = 0

    def _next(self) -> int:
        self._next_id += 1
        return self._next_id

    def _call(self, method: str, params: dict[str, Any] | None = None) -> dict:
        payload = {
            "jsonrpc": "2.0",
            "id": self._next(),
            "method": method,
            "params": params or {},
        }
        r = self._client.post(self.url, json=payload, headers={"Accept": "application/json"})
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RuntimeError(f"MCP error {body['error'].get('code')}: {body['error'].get('message')}")
        return body["result"]

    def initialize(self) -> dict:
        return self._call("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "render-regression-test", "version": "0.1"},
        })

    def list_test_pdfs(self) -> list[dict]:
        result = self._call("tools/call", {"name": "list_test_pdfs", "arguments": {}})
        # rmcp 0.7 returns content as [{type: 'text', text: '...json...'}]; parse.
        return json.loads(result["content"][0]["text"])["pdfs"]

    def screenshot_page(self, path: Path, page_index: int, width: int = 2000) -> Image.Image:
        result = self._call("tools/call", {
            "name": "screenshot_page",
            "arguments": {"path": str(path), "page_index": page_index, "width": width},
        })
        body = json.loads(result["content"][0]["text"])
        png_bytes = base64.b64decode(body["png_base64"])
        return Image.open(BytesIO(png_bytes)).convert("RGB")

    def get_pdf_metadata(self, path: Path) -> dict:
        result = self._call("tools/call", {
            "name": "get_pdf_metadata",
            "arguments": {"path": str(path)},
        })
        return json.loads(result["content"][0]["text"])

    def close(self):
        self._client.close()
```

- [ ] **Step 2: Smoke test against the running server**

Start the app with `--mcp-server`. Then:

```
cd scripts
.venv-test/Scripts/python -c "
from render_test.app_client import AppClient
c = AppClient()
c.initialize()
pdfs = c.list_test_pdfs()
print(f'{len(pdfs)} PDFs found')
for p in pdfs[:3]: print(' ', p['path'], p['page_count'])
img = c.screenshot_page(pdfs[0]['path'], 0, width=500)
print(f'page 0 of first PDF: {img.size}')
c.close()
"
```

Expected: lists 8 PDFs, prints page-0 size of first PDF.

- [ ] **Step 3: Commit**

```
git add scripts/render_test/app_client.py
git commit -m "feat(test): add MCP HTTP client wrapper"
```

---

## Task 14: Python — `report` module with TDD + Jinja template

**Files:**
- Create: `scripts/render_test/report.py`
- Create: `scripts/render_test/templates/report.html.j2`
- Create: `scripts/render_test/tests/test_report.py`

- [ ] **Step 1: Write failing tests**

Create `scripts/render_test/tests/test_report.py`:

```python
import json
from pathlib import Path
from render_test.report import write_summary, write_html, PageResult


def _sample_results():
    return [
        PageResult(pdf_path="a.pdf", pdf_version="1.7", page_index=0,
                   diff_pct=0.42, ref_filename="a_p0_ref.png",
                   app_filename="a_p0_app.png", diff_filename="a_p0_diff.png"),
        PageResult(pdf_path="b.pdf", pdf_version="1.4", page_index=0,
                   diff_pct=8.7,  ref_filename="b_p0_ref.png",
                   app_filename="b_p0_app.png", diff_filename="b_p0_diff.png"),
    ]


def test_summary_json_schema(tmp_path: Path):
    results = _sample_results()
    write_summary(tmp_path / "summary.json", results,
                  git_sha="abc1234", config={"width": 2000, "fail_pct": 2.0})
    data = json.loads((tmp_path / "summary.json").read_text())
    assert data["git_sha"] == "abc1234"
    assert data["totals"]["pages"] == 2
    assert data["totals"]["passed"] == 1
    assert data["totals"]["failed"] == 1
    assert len(data["pdfs"]) == 2


def test_html_renders_without_external_cdn(tmp_path: Path):
    results = _sample_results()
    write_html(tmp_path / "report.html", results,
               git_sha="abc1234", config={"fail_pct": 2.0})
    html = (tmp_path / "report.html").read_text()
    assert "<html" in html.lower()
    # No external script/style URLs (must be self-contained)
    assert "https://" not in html
    assert "abc1234" in html
    assert "8.7" in html
```

- [ ] **Step 2: Run tests, verify they fail**

```
.venv-test/Scripts/python -m pytest render_test/tests/test_report.py -v
```

- [ ] **Step 3: Implement report module**

Create `scripts/render_test/templates/report.html.j2`:

```jinja
<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Render Regression Report — {{ git_sha }}</title>
<style>
body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; background: #1e1e1e; color: #ddd; }
h1 { margin: 0 0 8px; font-size: 20px; }
h2 { margin: 24px 0 8px; font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 4px; }
.config { color: #888; font-size: 12px; margin-bottom: 16px; }
.totals { padding: 8px 12px; background: #2a2a2a; border-radius: 4px; display: inline-block; }
.totals .pass { color: #2ecc71; }
.totals .fail { color: #e74c3c; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; vertical-align: top; border-bottom: 1px solid #2a2a2a; text-align: left; }
.row.fail { background: rgba(231, 76, 60, 0.07); }
.diff-pct.fail { color: #e74c3c; font-weight: bold; }
.diff-pct.pass { color: #888; }
img.thumb { width: 220px; height: auto; border: 1px solid #333; cursor: zoom-in; }
img.thumb:hover { outline: 2px solid #f3a847; }
</style></head><body>
<h1>Render Regression — {{ git_sha }}</h1>
<div class="config">Config: width={{ config.width }}, fail_pct={{ config.fail_pct }}, blur_sigma={{ config.blur_sigma }}, pixel_tol={{ config.pixel_tol }}</div>
<div class="totals">
  <span class="pass">{{ totals.passed }} passed</span> /
  <span class="fail">{{ totals.failed }} failed</span> /
  total {{ totals.pages }}
</div>

{% for pdf in pdfs %}
<h2>{{ pdf.path }} <small style="color:#888">v{{ pdf.version }}</small></h2>
<table>
  <thead><tr>
    <th>Page</th><th>Diff %</th>
    <th>Reference</th><th>App</th><th>Diff overlay</th>
  </tr></thead>
  <tbody>
  {% for p in pdf.pages %}
    <tr class="row {% if not p.passed %}fail{% endif %}">
      <td>{{ p.index }}</td>
      <td class="diff-pct {% if p.passed %}pass{% else %}fail{% endif %}">{{ "%.2f"|format(p.diff_pct) }} %</td>
      <td><a href="{{ p.ref_filename }}" target="_blank"><img class="thumb" src="{{ p.ref_filename }}"></a></td>
      <td><a href="{{ p.app_filename }}" target="_blank"><img class="thumb" src="{{ p.app_filename }}"></a></td>
      <td><a href="{{ p.diff_filename }}" target="_blank"><img class="thumb" src="{{ p.diff_filename }}"></a></td>
    </tr>
  {% endfor %}
  </tbody>
</table>
{% endfor %}
</body></html>
```

Create `scripts/render_test/report.py`:

```python
"""Per-run HTML + JSON report writers."""
from dataclasses import dataclass, asdict
from pathlib import Path
import json
from jinja2 import Environment, FileSystemLoader, select_autoescape


@dataclass
class PageResult:
    pdf_path: str
    pdf_version: str
    page_index: int
    diff_pct: float
    ref_filename: str
    app_filename: str
    diff_filename: str


def _passed(p: PageResult, fail_pct: float) -> bool:
    return p.diff_pct <= fail_pct


def _aggregate_by_pdf(results: list[PageResult], fail_pct: float):
    by_pdf: dict[str, dict] = {}
    for p in results:
        bucket = by_pdf.setdefault(p.pdf_path, {
            "path": p.pdf_path,
            "version": p.pdf_version,
            "pages": [],
        })
        bucket["pages"].append({
            "index":         p.page_index,
            "diff_pct":      p.diff_pct,
            "passed":        _passed(p, fail_pct),
            "ref_filename":  p.ref_filename,
            "app_filename":  p.app_filename,
            "diff_filename": p.diff_filename,
        })
    # Sort pages within each PDF by index, sort PDFs with most failures first
    for b in by_pdf.values():
        b["pages"].sort(key=lambda p: p["index"])
    return sorted(by_pdf.values(), key=lambda b: -sum(0 if pg["passed"] else 1 for pg in b["pages"]))


def write_summary(out_path: Path, results: list[PageResult],
                  git_sha: str, config: dict) -> None:
    fail_pct = config.get("fail_pct", 2.0)
    pdfs = _aggregate_by_pdf(results, fail_pct)
    passed = sum(1 for p in results if _passed(p, fail_pct))
    failed = len(results) - passed
    payload = {
        "git_sha":   git_sha,
        "timestamp": _now_iso(),
        "config":    config,
        "pdfs": [{
            "path":    p["path"],
            "version": p["version"],
            "pages":   [{"index": pg["index"], "diff_pct": pg["diff_pct"], "passed": pg["passed"]}
                        for pg in p["pages"]],
        } for p in pdfs],
        "totals": {"pages": len(results), "passed": passed, "failed": failed},
    }
    out_path.write_text(json.dumps(payload, indent=2))


def write_html(out_path: Path, results: list[PageResult],
               git_sha: str, config: dict) -> None:
    fail_pct = config.get("fail_pct", 2.0)
    pdfs = _aggregate_by_pdf(results, fail_pct)
    passed = sum(1 for p in results if _passed(p, fail_pct))
    failed = len(results) - passed

    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).parent / "templates")),
        autoescape=select_autoescape(['html']),
    )
    tmpl = env.get_template("report.html.j2")
    html = tmpl.render(
        git_sha=git_sha,
        config={"width": config.get("width", 2000), "fail_pct": fail_pct,
                "blur_sigma": config.get("blur_sigma", 1.0),
                "pixel_tol": config.get("pixel_tol", 30)},
        pdfs=pdfs,
        totals={"pages": len(results), "passed": passed, "failed": failed},
    )
    out_path.write_text(html)


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")
```

- [ ] **Step 4: Run tests, verify they pass**

```
.venv-test/Scripts/python -m pytest render_test/tests/test_report.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```
git add scripts/render_test/report.py scripts/render_test/templates scripts/render_test/tests/test_report.py
git commit -m "feat(test): add HTML+JSON report writers with TDD"
```

---

## Task 15: Python — main loop + CLI args

**Files:**
- Create: `scripts/render_test/main.py`

- [ ] **Step 1: Implement main**

Create `scripts/render_test/main.py`:

```python
"""Render-regression test main loop."""
import argparse
import io
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable

from PIL import Image

from .app_client import AppClient
from .compare import compare
from .reference import render_with_pymupdf
from .report import PageResult, write_summary, write_html


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(Path(__file__).resolve().parents[2])
        ).decode().strip()
    except Exception:
        return "unknown"


def _filter_pdfs(pdfs: list[dict], pat: str | None) -> list[dict]:
    if not pat: return pdfs
    return [p for p in pdfs if pat.lower() in Path(p["path"]).name.lower()]


def _parse_page_range(arg: str | None, total: int) -> Iterable[int]:
    if not arg: return range(total)
    if "-" in arg:
        a, b = arg.split("-", 1)
        return range(int(a), min(int(b) + 1, total))
    return [int(arg)]


def main() -> int:
    ap = argparse.ArgumentParser(prog="render-regression-test")
    ap.add_argument("--url", default="http://127.0.0.1:9223/mcp")
    ap.add_argument("--width", type=int, default=2000)
    ap.add_argument("--blur-sigma", type=float, default=1.0)
    ap.add_argument("--pixel-tol", type=int, default=30)
    ap.add_argument("--fail-pct", type=float, default=2.0)
    ap.add_argument("--pdf", help="filter PDFs by substring of filename")
    ap.add_argument("--page-range", help="e.g. 0 or 0-2 (applied to each PDF)")
    ap.add_argument("--out-root", default="test pdf-bestanden/render-regression-runs")
    args = ap.parse_args()

    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    sha = _git_sha()
    run_dir = out_root / f"{datetime.now().strftime('%Y-%m-%d_%H%M')}-{sha}"
    run_dir.mkdir()

    print(f"[render-regression] writing to {run_dir}")

    client = AppClient(args.url)
    client.initialize()

    pdfs = _filter_pdfs(client.list_test_pdfs(), args.pdf)
    print(f"[render-regression] {len(pdfs)} PDFs to test")

    results: list[PageResult] = []
    for pdf in pdfs:
        meta = client.get_pdf_metadata(pdf["path"])
        version = meta["pdf_version"]
        stem = Path(pdf["path"]).stem.replace(" ", "_")[:40]
        pages_to_test = list(_parse_page_range(args.page_range, pdf["page_count"]))
        for idx in pages_to_test:
            print(f"  {Path(pdf['path']).name} p{idx}", end="", flush=True)
            try:
                ref = render_with_pymupdf(Path(pdf["path"]), idx, args.width)
                app = client.screenshot_page(pdf["path"], idx, args.width)
                pct, overlay = compare(ref, app, args.blur_sigma, args.pixel_tol)

                ref_name  = f"{stem}_p{idx}_ref.png"
                app_name  = f"{stem}_p{idx}_app.png"
                diff_name = f"{stem}_p{idx}_diff.png"
                ref.save(run_dir / ref_name)
                app.save(run_dir / app_name)
                overlay.save(run_dir / diff_name)

                results.append(PageResult(
                    pdf_path=str(pdf["path"]), pdf_version=version,
                    page_index=idx, diff_pct=pct,
                    ref_filename=ref_name, app_filename=app_name, diff_filename=diff_name,
                ))
                status = "PASS" if pct <= args.fail_pct else "FAIL"
                print(f"  {pct:6.2f}%  {status}")
            except Exception as e:
                print(f"  ERROR: {e}")
                # Synthesize a failed result so the report shows the error
                results.append(PageResult(
                    pdf_path=str(pdf["path"]), pdf_version=version,
                    page_index=idx, diff_pct=100.0,
                    ref_filename="-", app_filename="-", diff_filename="-",
                ))

    config = {
        "width": args.width, "blur_sigma": args.blur_sigma,
        "pixel_tol": args.pixel_tol, "fail_pct": args.fail_pct,
    }
    write_summary(run_dir / "summary.json", results, sha, config)
    write_html(run_dir / "report.html",   results, sha, config)

    # Update 'latest' symlink (best-effort; Windows requires admin for symlinks,
    # so fall back to a copy of summary.json).
    latest = out_root / "latest"
    try:
        if latest.is_symlink() or latest.exists(): latest.unlink()
        latest.symlink_to(run_dir.name)
    except OSError:
        # Windows fallback: copy summary as 'latest_summary.json'
        shutil.copy2(run_dir / "summary.json", out_root / "latest_summary.json")

    failed = sum(1 for r in results if r.diff_pct > args.fail_pct)
    print(f"[render-regression] {len(results)} pages, {failed} failed.")
    print(f"[render-regression] open {run_dir / 'report.html'}")
    client.close()
    return failed
```

- [ ] **Step 2: Smoke run**

Start the app with `--mcp-server`. Then:

```
cd scripts
.venv-test/Scripts/python render-regression-test.py --pdf=Tekst --width=800
```

Expected: prints `Tekst.pdf p0  X.XX%  PASS/FAIL`, writes `test pdf-bestanden/render-regression-runs/<timestamp>-<sha>/{report.html,summary.json,*.png}`.

- [ ] **Step 3: Commit**

```
git add scripts/render_test/main.py
git commit -m "feat(test): wire main loop + CLI args"
```

---

## Task 16: npm scripts + dev orchestration

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add scripts**

Open the repo-root or `open-pdf-studio/package.json` (whichever defines `tauri dev` — check by `grep tauri package.json`). Add to `scripts`:

```json
"test:render":      "scripts\\.venv-test\\Scripts\\python.exe scripts/render-regression-test.py",
"test:render:auto": "node scripts/run-render-regression.mjs"
```

- [ ] **Step 2: Add the orchestrator**

Create `scripts/run-render-regression.mjs`:

```js
// Spawns `tauri dev -- --mcp-server`, waits until port 9223 responds,
// runs the python harness, then kills the dev process.
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = 9223;
const MAX_WAIT_MS = 120_000;

function waitForPort(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = net.createConnection(port, '127.0.0.1');
      s.once('connect', () => { s.end(); resolve(); });
      s.once('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('port timeout'));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

const dev = spawn('npm', ['run', 'tauri', 'dev', '--', '--', '--mcp-server'], {
  stdio: 'inherit', shell: true,
});

try {
  console.log(`[run-render-regression] waiting for port ${PORT}…`);
  await waitForPort(PORT, MAX_WAIT_MS);
  console.log('[run-render-regression] port up; running harness');

  const harness = spawn(
    'scripts\\.venv-test\\Scripts\\python.exe',
    ['scripts/render-regression-test.py', ...process.argv.slice(2)],
    { stdio: 'inherit', shell: true },
  );
  const code = await new Promise(r => harness.on('exit', r));
  console.log(`[run-render-regression] harness exit ${code}`);
  process.exit(code);
} finally {
  dev.kill('SIGTERM');
}
```

- [ ] **Step 3: Smoke test**

```
npm run test:render:auto -- --pdf=Tekst --width=800
```

Expected: app launches headlessly (window visible — that's OK), harness runs, app closes, exit code 0 (or 1 if Tekst.pdf has any diff).

- [ ] **Step 4: Commit**

```
git add package.json scripts/run-render-regression.mjs
git commit -m "feat(test): add npm scripts test:render and test:render:auto"
```

---

## Task 17: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/render-regression.yml`

- [ ] **Step 1: Add workflow**

Create `.github/workflows/render-regression.yml`:

```yaml
name: Render regression
on:
  pull_request:
    paths:
      - 'open-pdf-render/**'
      - 'open-pdf-studio/src-tauri/**'
      - 'open-pdf-studio/js/pdf/**'
      - 'scripts/render_test/**'
      - 'scripts/run-render-regression.mjs'
  workflow_dispatch:

jobs:
  render-regression:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - uses: dtolnay/rust-toolchain@stable

      - name: Install npm deps
        working-directory: open-pdf-studio
        run: npm ci

      - name: Set up python venv
        run: |
          python -m venv scripts/.venv-test
          scripts\.venv-test\Scripts\python.exe -m pip install -U pip
          scripts\.venv-test\Scripts\python.exe -m pip install -r scripts/requirements-test.txt

      - name: Build Tauri app (debug)
        working-directory: open-pdf-studio
        env:
          OPS_ENABLE_MCP: '1'
        run: |
          cargo build -p app_lib

      - name: Run render regression
        working-directory: open-pdf-studio
        env:
          OPS_ENABLE_MCP: '1'
        run: |
          npm run test:render:auto

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: render-regression-${{ github.run_id }}
          path: 'test pdf-bestanden/render-regression-runs/'
```

- [ ] **Step 2: Commit**

```
git add .github/workflows/render-regression.yml
git commit -m "ci: render regression workflow on PR"
```

---

## Task 18: Acceptance test — verify the harness catches a known-bad change

This task isn't a code change to the production codebase — it's a manual verification step to prove the harness actually catches regressions.

- [ ] **Step 1: Establish a clean baseline**

On a clean HEAD (no uncommitted changes):

```
npm run test:render:auto
```

Note the exit code and the page-count of `failed`. Expect a small non-zero count for cosmetic AA diffs but most pages should be PASS. Open `test pdf-bestanden/render-regression-runs/latest/report.html` and verify visually that the renderings look correct. Record this as the accepted baseline (note in the run dir what's expected).

- [ ] **Step 2: Introduce a regression**

In `open-pdf-render/src/fonts.rs`, comment out the new Priority-0 byte_cmap lookup that was added for 3090-CP-21. Specifically the block:

```rust
// Priority 0: byte_cmap from non-Unicode cmap subtables ...
if let Some(&gid) = parsed.byte_cmap.get(&char_code) { ... }
```

(Surround with `/* ... */`.)

Rebuild + rerun:

```
npm run test:render:auto -- --pdf=3090
```

- [ ] **Step 3: Verify failure surfaces**

Expected: harness exit code ≥ 1. The HTML report shows pages of `3090-CP-21` flagged red with high `diff_pct`.

- [ ] **Step 4: Restore the fix**

Uncomment the block, rerun:

```
npm run test:render:auto -- --pdf=3090
```

Expected: exit code returns to baseline (3090 pages back to PASS).

- [ ] **Step 5: Document in the run dir**

Add `docs/superpowers/specs/2026-05-08-render-regression-test-design.md` an "Appendix: accepted-baseline diff %" section listing the per-PDF baseline values from Step 1, so future engineers know what counts as "no regression".

- [ ] **Step 6: Commit (acceptance documentation only)**

```
git add docs/superpowers/specs/2026-05-08-render-regression-test-design.md
git commit -m "docs(test): record accepted-baseline diff %"
```

---

## Self-review notes (already addressed)

1. **Spec coverage** — every section of the spec maps to a task:
   - Spec §3 architecture → Tasks 3, 5, 13
   - Spec §4 in-app render → Tasks 1, 2, 3
   - Spec §5 MCP server → Tasks 4–9
   - Spec §6 Python harness → Tasks 10–15
   - Spec §7 output structure → Task 15
   - Spec §8 invocation → Tasks 16, 17
   - Spec §9 acceptance criteria → Task 18
2. **Placeholders** — none. Where rmcp / lopdf APIs may have shifted, the engineer is told explicitly to "adapt" with concrete instructions.
3. **Type consistency** — `PageResult` fields used identically in `report.py`, `main.py`, and `test_report.py`. `StartupOpts` defined once in `lib.rs`, used in `main.rs` and the MCP-server start path.
4. **CLI flags** consistent: `--mcp-server`, `--mcp-port` in Rust; `--pdf`, `--page-range`, `--width`, `--blur-sigma`, `--pixel-tol`, `--fail-pct`, `--out-root` in Python. The npm orchestrator forwards all extra args (`process.argv.slice(2)`).
