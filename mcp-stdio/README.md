# Open PDF Studio — MCP for Claude Desktop / Claude Code

Open PDF Studio ships a **full MCP server inside the app** (~50 tools: open /
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

The MCP server is **off by default** and only starts with `--mcp-server`.

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
# → [open-pdf-studio mcp bridge] OK — 50 tools available at http://127.0.0.1:9223/mcp
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
- **`app_ai_complete`** — call the OpenAEC AI directly (needs the app signed in
  to OpenAEC; returns `{ ok, signedInAs, text, credits }`).
- **`app_accounts_status`** / **`app_accounts_fetch`** — check sign-in and call
  any `/me/*` Accounts API from the signed-in app.

A few of the many PDF tools: `app_open_pdf`, `app_new_blank_pdf`,
`app_go_to_page`, `app_set_zoom` / `app_fit_width`, `app_create_annotation`,
`app_list_annotations`, `app_save_pdf`, `app_screenshot_view`. The full,
authoritative list is in `src-tauri/src/mcp_server.rs` (`handle_tools_list`)
and documented in `docs/superpowers/specs/2026-05-09-mcp-app-tools.md`.

---

## Direct HTTP (no bridge) — Claude Code only, optional

Claude Code also supports HTTP MCP servers, so you can skip `server.mjs`:

```json
{ "mcpServers": { "open-pdf-studio": { "type": "http", "url": "http://127.0.0.1:9223/mcp" } } }
```

The stdio bridge is the recommended default because it works identically in
both Claude Desktop and Claude Code and gives clearer "app not running" errors.

## Troubleshooting

- **`cannot reach the app`** — the app isn't running with `--mcp-server`, or
  it's on a different port. Re-run step 1, check the port matches.
- **Tools call but nothing happens in the UI** — `app_*` tools need the live
  WebView; make sure you launched the GUI app (not a headless build).
- **Release build "refused to start"** — set `OPS_ENABLE_MCP=1`.
