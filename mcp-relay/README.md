# Open PDF Studio — MCP relay

Lets a remote agent drive Open PDF Studio **in a browser**, while a person
watches the sheet build and redlines it live.

```
Agent  ──HTTP JSON-RPC──►  relay  ──WebSocket──►  browser tab
       ◄──────────────────        ◄──────────────  (js/mcp-bridge.js)
```

## Why this exists

On the desktop the app *is* the MCP server: Rust listens on
`127.0.0.1:9223/mcp`, and `mcp_app_bridge.rs` hands each call to the WebView as
a Tauri event. None of the ~50 `app_*` tools are implemented in Rust — they
live in `js/mcp-bridge.js` and run in the WebView. **Rust is pure transport.**

This service is that transport for a browser. The tool handlers are untouched;
only how a request reaches them changed. `js/mcp-transport.js` picks between
the two at startup.

## Run it

```bash
cd mcp-relay
npm install

# The agent endpoint hands document control to whoever holds a session code,
# so it sits behind a shared secret. Generate one:
export OPS_RELAY_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")

npm start
npm run probe    # in another shell
```

| Variable | Default | Meaning |
|---|---|---|
| `OPS_RELAY_SECRET` | — | **Required.** Bearer token the agent presents on `/mcp`. |
| `OPS_RELAY_PORT` | `9224` | Listen port. |
| `OPS_RELAY_HOST` | `127.0.0.1` | Bind address. Put TLS in front rather than binding `0.0.0.0` directly. |
| `OPS_RELAY_JOURNAL` | `./.journal` | Where call journals are written. |
| `OPS_RELAY_ORIGIN` | `*` | Allowed browser origin for CORS. Set this in production. |

## Pair a tab with an agent

1. Open the web build with a relay configured — `?relay=wss://host/ws`, or set
   `VITE_OPS_RELAY_URL` at build time.
2. The tab mints a session and prints its code to the console; it is also on
   `window.__opsSession` and announced as an `ops:mcp-session` DOM event.
3. Point the agent at `POST <relay>/mcp/<code>` with
   `Authorization: Bearer $OPS_RELAY_SECRET`.

```json
{ "mcpServers": { "open-pdf-studio": {
    "type": "http",
    "url": "https://relay.example/mcp/ABCDEFGHJKMNPQRSTVWXYZ",
    "headers": { "Authorization": "Bearer <OPS_RELAY_SECRET>" }
} } }
```

The code survives a page reload (kept in `sessionStorage`, and the relay holds
a detached session for five minutes), so a refresh does not invalidate the
agent's configuration.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness, session count, tool count. |
| `POST /session` | none, rate-limited | The tab mints its own session. |
| `WS /ws?code=…` | session code | The tab attaches. |
| `POST /mcp/:code` | code + bearer | The agent's JSON-RPC endpoint. |
| `GET /journal/:code` | code + bearer | Read the call journal; `?replayable=1` filters to mutating calls. |

## Two tools behave differently here

**`app_undo` and `app_redo` are withheld.** The agent and the person share one
`doc.undoStack`, so an agent-issued undo pops whichever command is on top —
routinely the person's redline. The agent holds the ids of everything it drew,
so `app_delete_annotation` does the same job precisely. Calling them returns an
error that says this rather than a bare "unknown tool".

**`app_commit_batch` is new.** It marks everything drawn so far as settled so
the person's Ctrl-Z stops there instead of walking back into a finished batch.
Call it after each coherent unit — an elevation, a title block, a schedule.
`{ release: true }` lifts the mark.

`app_set_window_size` is also withheld: it runs in the Rust process and a page
cannot resize the window it is running in.

## The journal

Every forwarded call is appended to `<journal>/<code>.jsonl` with a sequence
number, a timestamp and whether it succeeded. This is **not** document state —
it is the ordered list of calls, so replaying it rebuilds what the agent drew
after a lost tab. A command log is not a competing source of truth, which is
why it was chosen over having the relay hold the document.

It deliberately cannot see the person's redlines: those are drawn in the tab
and never travel through the relay.

## Keeping the tool list in sync

`tools.json` is generated from the Rust source, which stays the source of
truth so the desktop and the browser can never disagree about what tools exist
or what arguments they take.

```bash
npm run tools          # regenerate after changing mcp_server.rs
npm run tools:check    # CI: fail if it is stale
```

## Tests

```bash
npm test
```

Covers the pending table, session lifecycle and expiry, the tool-name mapping,
and a full end-to-end round trip against a fake tab — including tab takeover,
a dropped socket mid-call, journal replay filtering, and auth rejection.
