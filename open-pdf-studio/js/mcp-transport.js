/**
 * Transport for the MCP bridge.
 *
 * `js/mcp-bridge.js` holds ~50 tool handlers that are plain DOM and app code
 * — none of them care how a request arrived. Historically the only way in was
 * a Tauri event emitted by `src-tauri/src/mcp_app_bridge.rs`, with the answer
 * going back through `invoke('app_response')`. That coupling, and nothing
 * about the handlers themselves, is what tied the MCP surface to the desktop.
 *
 * Two transports live here behind one interface:
 *
 *   tauri  — listen on `mcp:*` events, answer via `app_response`
 *   relay  — WebSocket to mcp-relay, answer with a `res` frame
 *
 * Adding one did not require touching a single handler.
 */

// ── Shared shape ───────────────────────────────────────────────────────────
//
// A transport is `{ kind, wired, start(), stop(), sessionCode }`. `start()`
// resolves once the transport is carrying requests; each incoming request is
// handed to `dispatch(eventName, params)` which the bridge supplies.

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/** Calls worth reporting as agent activity. Reads and view changes are not
 *  activity — reporting them would bury the drawing in noise. */
const ACTIVITY_EVENTS = new Set([
  'mcp:new-blank-pdf', 'mcp:open-pdf', 'mcp:merge-pdf', 'mcp:save-pdf',
  'mcp:create-annotation', 'mcp:update-annotation', 'mcp:delete-annotation',
  'mcp:set-measure-scale', 'mcp:commit-batch',
]);

/** Read relay config: query param wins so a tab can be pointed at a relay
 *  without a rebuild, then the build-time variable. */
export function relayConfig() {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch { params = new URLSearchParams(); }

  const fromQuery = params.get('relay');
  let fromEnv;
  try { fromEnv = import.meta.env?.VITE_OPS_RELAY_URL; } catch { fromEnv = undefined; }

  const raw = (fromQuery || fromEnv || '').replace(/\/+$/, '');
  if (!raw) return null;

  const resolved = resolveRelayUrls(raw, window.location);
  if (!resolved) return null;

  return { ...resolved, author: params.get('relayAuthor') || 'Agent' };
}

/**
 * Turn the configured value into an HTTP base and a WebSocket URL.
 *
 * A RELATIVE path ("/ws") resolves against the page it is served from, which
 * is the deployment worth aiming for: one build, served from the same origin
 * as the relay behind one reverse proxy. Same origin also means no CORS to
 * configure and no second certificate.
 *
 * An absolute ws(s):// or http(s):// URL still works, for a relay on a
 * different host or for `?relay=` during development.
 *
 * Exported for tests — it is pure, and getting it wrong strands the tab with
 * no way to reach the relay.
 */
export function resolveRelayUrls(raw, location) {
  if (!raw) return null;

  if (raw.startsWith('/')) {
    const secure = location.protocol === 'https:';
    return {
      httpBase: `${location.protocol}//${location.host}`,
      wsUrl: `${secure ? 'wss' : 'ws'}://${location.host}${raw}`,
    };
  }

  let parsed;
  try { parsed = new URL(raw); } catch { return null; }

  const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  const wsScheme = secure ? 'wss' : 'ws';
  const httpScheme = secure ? 'https' : 'http';
  // The configured URL points at the socket path; the HTTP endpoints
  // (/session, /mcp/<code>) hang off the origin.
  return {
    httpBase: `${httpScheme}://${parsed.host}`,
    wsUrl: `${wsScheme}://${parsed.host}${parsed.pathname === '/' ? '/ws' : parsed.pathname}`,
  };
}

// ── Tauri transport ────────────────────────────────────────────────────────

function tauriInvoke() {
  return window.__TAURI__?.core?.invoke ?? null;
}

export function createTauriTransport() {
  let unlisteners = [];

  return {
    kind: 'tauri',
    wired: [],
    sessionCode: null,

    async start(dispatch) {
      // Prefer the global, fall back to the npm module so this still works if
      // `withGlobalTauri` is ever turned off.
      let ev = window.__TAURI__?.event;
      if (!ev) {
        try { ev = await import('@tauri-apps/api/event'); }
        catch (e) { console.warn('[mcp-transport] Tauri event API unavailable:', e); return this; }
      }

      for (const name of dispatch.eventNames) {
        try {
          const off = await ev.listen(name, async (event) => {
            const payload = event?.payload ?? {};
            const requestId = payload.request_id;
            if (typeof requestId !== 'number') {
              console.warn('[mcp-transport] missing request_id in', name, payload);
              return;
            }
            const result = await dispatch.run(name, payload.params ?? {});
            const invoke = tauriInvoke();
            if (!invoke) return;
            try { await invoke('app_response', { requestId, result }); }
            catch (e) { console.warn('[mcp-transport] app_response failed:', e); }
          });
          unlisteners.push(off);
          this.wired.push(name);
        } catch (e) {
          console.warn('[mcp-transport] listen failed for', name, e);
        }
      }

      // Confirm wire-up from outside the WebView — devtools isn't visible
      // when the app is launched headless for a test run.
      try { await tauriInvoke()?.('mcp_bridge_ready', { events: this.wired }); }
      catch { /* harmless against an older binary without the command */ }

      return this;
    },

    stop() {
      for (const off of unlisteners) { try { off?.(); } catch { /* noop */ } }
      unlisteners = [];
    },
  };
}

// ── Relay transport ────────────────────────────────────────────────────────

export function createRelayTransport({ httpBase, wsUrl, author }) {
  let socket = null;
  let stopped = false;
  let attempt = 0;
  let code = null;

  /** Mint a session, or reuse the one this tab already holds. Reusing lets a
   *  reload reclaim its code inside the relay's grace window, so the agent's
   *  configured URL keeps working across a refresh. */
  async function ensureCode() {
    if (code) return code;
    try { code = sessionStorage.getItem('ops.relay.code') || null; } catch { /* private mode */ }
    if (code) return code;

    const res = await fetch(`${httpBase}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author }),
    });
    if (!res.ok) throw new Error(`session mint failed: HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.code) throw new Error('relay returned no session code');
    code = body.code;
    try { sessionStorage.setItem('ops.relay.code', code); } catch { /* private mode */ }
    return code;
  }

  const transport = {
    kind: 'relay',
    wired: [],
    get sessionCode() { return code; },

    async start(dispatch) {
      transport.wired = [...dispatch.eventNames];
      // A refresh inside the snapshot debounce window would otherwise lose
      // the last edits. `pagehide` fires on reload, navigation and tab close,
      // and unlike `beforeunload` it also fires on mobile background/kill.
      window.addEventListener('pagehide', () => {
        import('./core/undo-manager.js')
          .then((m) => m.flushSessionSnapshot?.())
          .catch(() => { /* going away anyway */ });
      });
      await connect(dispatch);
      return transport;
    },

    stop() {
      stopped = true;
      try { socket?.close(1000, 'client stopped'); } catch { /* already gone */ }
      socket = null;
    },
  };

  async function connect(dispatch) {
    if (stopped) return;

    let sessionCode;
    try {
      sessionCode = await ensureCode();
    } catch (e) {
      console.warn('[mcp-transport] cannot reach the relay:', e.message);
      return retry(dispatch);
    }

    const ws = new WebSocket(`${wsUrl}?code=${encodeURIComponent(sessionCode)}`);
    socket = ws;

    ws.addEventListener('open', () => {
      attempt = 0;
      ws.send(JSON.stringify({ t: 'hello', events: transport.wired, author }));
    });

    ws.addEventListener('message', async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.t === 'ready') {
        console.log(`[mcp-transport] relay session ${msg.code} ready (${msg.events} events)`);
        publishSession(msg.code, author, `${httpBase}/mcp/${msg.code}`);
        return;
      }

      if (msg.t === 'ping') { try { ws.send(JSON.stringify({ t: 'pong' })); } catch { /* closing */ } return; }

      if (msg.t === 'bye') {
        // Another tab took the session. Don't fight it — reconnecting would
        // ping-pong the two tabs and split the document.
        console.warn(`[mcp-transport] relay closed this session: ${msg.reason}`);
        stopped = true;
        try { sessionStorage.removeItem('ops.relay.code'); } catch { /* noop */ }
        publishState('displaced');
        return;
      }

      if (msg.t === 'error') { console.warn('[mcp-transport] relay error:', msg.error); return; }

      if (msg.t === 'req' && typeof msg.id === 'number') {
        const result = await dispatch.run(msg.event, msg.params ?? {});
        // Surface what the agent is doing. Only the calls that change the
        // document are worth reporting — a viewport read is not activity.
        if (ACTIVITY_EVENTS.has(msg.event)) {
          import('./solid/stores/sessionStore.js')
            .then((store) => store.noteAgentActivity(msg.event.replace('mcp:', '')))
            .catch(() => { /* no UI layer present */ });
        }
        try { ws.send(JSON.stringify({ t: 'res', id: msg.id, result })); }
        catch (e) { console.warn('[mcp-transport] response send failed:', e); }
      }
    });

    ws.addEventListener('close', () => {
      if (socket === ws) {
        socket = null;
        if (!stopped) publishState('lost');
        retry(dispatch);
      }
    });
    ws.addEventListener('error', () => { /* close follows; retry there */ });
  }

  function retry(dispatch) {
    if (stopped) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt++, RECONNECT_MAX_MS);
    setTimeout(() => connect(dispatch), delay);
  }

  return transport;
}

/** Make the pairing code reachable by the UI and by anyone at the console.
 *  The person has to hand this to the agent, so it must not be buried. */
function publishSession(code, author, endpoint) {
  window.__opsSession = { code, author, endpoint, at: new Date().toISOString() };
  try {
    window.dispatchEvent(new CustomEvent('ops:mcp-session', { detail: { code, author, endpoint } }));
  } catch { /* CustomEvent unavailable in some embedded webviews */ }

  // Feed the UI surfaces. Imported lazily so this module stays usable in a
  // build without the SolidJS layer (tests, headless harnesses).
  import('./solid/stores/sessionStore.js')
    .then((store) => {
      store.publishSession({ code, author, endpoint });
      store.setSessionState('paired');
    })
    .catch(() => { /* no UI layer present — console output below still applies */ });

  console.log(
    `%c[mcp] session code: ${code}`,
    'font-weight:bold',
    `\nPair an agent with:  POST ${endpoint}  (Bearer $OPS_RELAY_SECRET)`,
  );
}

/** Push a connection-state change to the UI, if the UI layer is present. */
function publishState(state) {
  import('./solid/stores/sessionStore.js')
    .then((store) => store.setSessionState(state))
    .catch(() => { /* no UI layer present */ });
}

/** Pick a transport for this environment. Returns null when neither applies,
 *  which is the normal case for an ordinary browser tab with no relay set. */
export function selectTransport() {
  if (window.__TAURI__?.core?.invoke) return createTauriTransport();
  const relay = relayConfig();
  if (relay) return createRelayTransport(relay);
  return null;
}
