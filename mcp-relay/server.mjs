#!/usr/bin/env node
/**
 * Open PDF Studio — MCP relay for the web build
 * =============================================
 *
 * On the desktop, an agent reaches the app over HTTP JSON-RPC and Rust hands
 * each call to the WebView as a Tauri event (`src-tauri/src/mcp_server.rs` +
 * `mcp_app_bridge.rs`). None of the ~50 `app_*` tools are implemented in
 * Rust — they live in `js/mcp-bridge.js` and run in the WebView. Rust is
 * pure transport.
 *
 * This service is that transport, for a browser:
 *
 *   Agent ──HTTP JSON-RPC──► relay ──WebSocket──► browser tab
 *         ◄──────────────── relay ◄────────────── (js/mcp-bridge.js)
 *
 * The tool handlers are untouched. What changes is only how a request
 * reaches them and how the answer gets back.
 *
 * Run:
 *   OPS_RELAY_SECRET=... node mcp-relay/server.mjs
 *   node mcp-relay/server.mjs --probe       # check a running instance
 *
 * Env:
 *   OPS_RELAY_PORT     listen port (default 9224)
 *   OPS_RELAY_HOST     bind address (default 127.0.0.1 — put TLS in front)
 *   OPS_RELAY_SECRET   REQUIRED. Bearer token the agent presents on /mcp.
 *   OPS_RELAY_JOURNAL  journal directory (default ./.journal)
 *   OPS_RELAY_ORIGIN   allowed browser origin for CORS (default *)
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { PendingTable } from './lib/pending.mjs';
import { Journal } from './lib/journal.mjs';
import { SessionStore, secretMatches } from './lib/sessions.mjs';
import {
  RPC_ERROR, PROTOCOL_VERSION, rpcResult, rpcError, isNotification,
  eventNameForTool, toolContent, toolError, timeoutForTool,
} from './lib/rpc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.OPS_RELAY_PORT || 9224);
const HOST = process.env.OPS_RELAY_HOST || '127.0.0.1';
const SECRET = process.env.OPS_RELAY_SECRET || '';
const JOURNAL_DIR = process.env.OPS_RELAY_JOURNAL || join(HERE, '.journal');
const ORIGIN = process.env.OPS_RELAY_ORIGIN || '*';

const TOOLS = JSON.parse(readFileSync(join(HERE, 'tools.json'), 'utf8')).tools;
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Build a relay instance. Kept a factory rather than module-level side
 * effects so tests can stand one up on an ephemeral port with its own
 * journal directory, and drive a fake browser socket against it.
 */
export function createRelay({ secret, journalDir = JOURNAL_DIR, origin = ORIGIN } = {}) {
const SECRET = secret;
const ORIGIN = origin;
const sessions = new SessionStore();
const journal = new Journal(journalDir);

// ── Session-creation rate limit ────────────────────────────────────────────
// Minting a session without a socket attached is harmless on its own, but it
// costs memory and a journal key, so cap it per client address.
const MINT_WINDOW_MS = 60_000;
const MINT_MAX = 30;
const mintLog = new Map(); // ip -> number[]

function mintAllowed(ip) {
  const now = Date.now();
  const hits = (mintLog.get(ip) || []).filter((t) => now - t < MINT_WINDOW_MS);
  if (hits.length >= MINT_MAX) { mintLog.set(ip, hits); return false; }
  hits.push(now);
  mintLog.set(ip, hits);
  return true;
}

// ── HTTP plumbing ──────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function send(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  cors(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

async function readBody(req, limitBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function bearerOf(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

// ── Forwarding one tool call to the browser ────────────────────────────────

/**
 * Send `event` to the session's tab and await its answer. Mirrors
 * `mcp_app_bridge::request`: allocate an id, park a promise, send, await with
 * a timeout, and drop the pending slot if the send itself failed.
 */
async function callApp(session, toolName, params) {
  if (!session.socket) {
    throw new Error(
      'no browser tab is attached to this session — open the app and pair it before calling app_* tools',
    );
  }
  const event = eventNameForTool(toolName);
  if (!event) {
    throw new Error(
      `${toolName} has no in-app handler. Tools that do not start with app_ ran in the ` +
      'Rust process on the desktop build and have no browser equivalent.',
    );
  }
  if (session.wiredEvents.size && !session.wiredEvents.has(event)) {
    throw new Error(
      `the attached tab did not register a handler for ${event} — it may be running an ` +
      'older build than this relay',
    );
  }

  const { id, promise } = session.pending.register(timeoutForTool(toolName));
  try {
    session.socket.send(JSON.stringify({ t: 'req', id, event, params }));
  } catch (e) {
    session.pending.fail(id, e);
  }
  return promise;
}

// ── JSON-RPC dispatch ──────────────────────────────────────────────────────

async function dispatch(session, msg) {
  const { id, method, params } = msg ?? {};

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'open-pdf-studio-relay', version: '1.0.0' },
    });
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    if (!TOOL_BY_NAME.has(toolName)) {
      // app_undo / app_redo are withheld on purpose — say so, rather than
      // letting an agent conclude the tool merely failed.
      const withheld = toolName === 'app_undo' || toolName === 'app_redo';
      return rpcResult(id, toolError(
        withheld
          ? `${toolName} is not available in a shared session: the agent and the person ` +
            'share one undo stack, so an agent-issued undo can pop the person\'s redline. ' +
            'Use app_delete_annotation with the id you created instead.'
          : `unknown tool: ${toolName}`,
      ));
    }

    session.calls++;
    sessions.touch(session);

    let result;
    let ok = true;
    try {
      result = await callApp(session, toolName, args);
    } catch (e) {
      ok = false;
      result = { ok: false, error: e.message };
    }

    // D-3: journal every forwarded call, after the fact, so a replay knows
    // which ones actually landed. Failures are recorded too — a replay must
    // not re-issue something that already errored for a real reason.
    await journal.record(session.id, {
      tool: toolName,
      params: args,
      ok: ok && result?.ok !== false,
      error: ok ? (result?.ok === false ? result.error : undefined) : result.error,
    });

    return rpcResult(id, ok ? toolContent(result) : toolError(result.error));
  }

  return rpcError(id, RPC_ERROR.METHOD_NOT_FOUND, `method not found: ${method}`);
}

// ── Routes ─────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (path === '/health') {
    return send(res, 200, {
      ok: true,
      sessions: sessions.size,
      tools: TOOLS.length,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  // The browser tab mints its own session and displays the code.
  if (path === '/session' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!mintAllowed(ip)) return send(res, 429, { ok: false, error: 'too many sessions; try again shortly' });

    let author = 'Agent';
    try {
      const body = await readBody(req, 4096);
      if (body) author = String(JSON.parse(body)?.author || 'Agent').slice(0, 64);
    } catch { /* an unparseable body just means defaults */ }

    const session = sessions.create({ author });
    console.error(`[relay] session ${session.code} minted (author=${session.author})`);
    return send(res, 200, { ok: true, code: session.code, author: session.author });
  }

  // Agent endpoint. Requires both the session code (in the path) and the
  // shared secret — see D-4: the code alone is a capability, and a public
  // endpoint should not hand out document control on one guessable factor.
  const mcpMatch = path.match(/^\/mcp\/([A-Za-z0-9_-]{1,64})$/);
  if (mcpMatch && req.method === 'POST') {
    if (!secretMatches(SECRET, bearerOf(req))) {
      return send(res, 401, rpcError(null, RPC_ERROR.INVALID_REQUEST, 'bad or missing bearer token'));
    }
    const session = sessions.get(mcpMatch[1]);
    if (!session) {
      return send(res, 404, rpcError(null, RPC_ERROR.INVALID_REQUEST, 'unknown or expired session code'));
    }

    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, 400, rpcError(null, RPC_ERROR.PARSE_ERROR, e.message));
    }

    if (isNotification(msg)) { cors(res); res.writeHead(202); res.end(); return; }

    try {
      return send(res, 200, await dispatch(session, msg));
    } catch (e) {
      return send(res, 200, rpcError(msg?.id, RPC_ERROR.INTERNAL_ERROR, e.message));
    }
  }

  // Journal read-back, for replay after a lost tab.
  const journalMatch = path.match(/^\/journal\/([A-Za-z0-9_-]{1,64})$/);
  if (journalMatch && req.method === 'GET') {
    if (!secretMatches(SECRET, bearerOf(req))) {
      return send(res, 401, { ok: false, error: 'bad or missing bearer token' });
    }
    const code = journalMatch[1];
    const entries = url.searchParams.get('replayable') === '1'
      ? await journal.replayable(code)
      : await journal.read(code);
    return send(res, 200, { ok: true, code, count: entries.length, entries });
  }

  send(res, 404, { ok: false, error: `no route for ${req.method} ${path}` });
});

// ── WebSocket: the browser tab attaches here ───────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const code = url.searchParams.get('code') || '';
  const session = sessions.get(code);

  if (!session) {
    socket.send(JSON.stringify({ t: 'error', error: 'unknown or expired session code' }));
    socket.close(4004, 'unknown session');
    return;
  }

  session.pending ??= new PendingTable();

  // One writer per session. A reload is the common case and should take the
  // session back; a genuine second tab would otherwise split the document in
  // two, so the older socket is closed with a reason it can show the user.
  const previous = sessions.attach(session, socket);
  if (previous && previous !== socket) {
    try {
      previous.send(JSON.stringify({ t: 'bye', reason: 'another tab attached to this session' }));
      previous.close(4000, 'replaced by a newer tab');
    } catch { /* already gone */ }
  }

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    sessions.touch(session);

    if (msg.t === 'hello') {
      session.wiredEvents = new Set(Array.isArray(msg.events) ? msg.events : []);
      if (typeof msg.author === 'string' && msg.author) session.author = msg.author.slice(0, 64);
      socket.send(JSON.stringify({
        t: 'ready',
        code: session.code,
        author: session.author,
        events: session.wiredEvents.size,
      }));
      console.error(`[relay] session ${session.code} attached — ${session.wiredEvents.size} events wired`);
      return;
    }

    if (msg.t === 'res' && typeof msg.id === 'number') {
      session.pending.resolve(msg.id, msg.result);
      return;
    }

    if (msg.t === 'pong') return;
  });

  socket.on('close', () => {
    if (sessions.detach(session, socket)) {
      const orphaned = session.pending.failAll('the browser tab disconnected');
      console.error(
        `[relay] session ${session.code} detached` +
        (orphaned ? ` (${orphaned} in-flight call(s) failed)` : ''),
      );
    }
  });

  socket.on('error', (e) => console.error(`[relay] socket error on ${session.code}: ${e.message}`));
});

// Keep sockets warm and reap the dead.
const sweepTimer = setInterval(() => {
  for (const code of sessions.sweep()) console.error(`[relay] session ${code} expired`);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try { client.send(JSON.stringify({ t: 'ping' })); } catch { /* closing */ }
    }
  }
}, 30_000);
  sweepTimer.unref();

  return {
    server, wss, sessions, journal, dispatch, callApp,
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      clearInterval(sweepTimer);
      for (const client of wss.clients) { try { client.terminate(); } catch { /* gone */ } }
      wss.close(() => server.close(resolve));
    }),
    get port() { return server.address()?.port; },
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (process.argv.includes('--probe')) {
  const endpoint = `http://${HOST}:${PORT}/health`;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    console.error(`[relay probe] OK — ${body.tools} tools, ${body.sessions} session(s) at ${endpoint}`);
    process.exit(0);
  } catch (e) {
    console.error(`[relay probe] FAIL — cannot reach ${endpoint}: ${e.message}`);
    process.exit(1);
  }
}

// Only start when run directly — importing this module (tests, embedding it in
// another service) must not bind a port or exit the process.
const RUN_DIRECTLY = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (RUN_DIRECTLY) {
  if (!SECRET) {
    console.error(
      'refusing to start without OPS_RELAY_SECRET.\n' +
      'The relay hands document control to whoever presents a valid session code, so the\n' +
      'agent-facing endpoint sits behind a shared secret. Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
    process.exit(1);
  }

  const relay = createRelay({ secret: SECRET });
  await relay.listen(PORT, HOST);
  console.error(`[relay] listening on http://${HOST}:${PORT}`);
  console.error(`[relay] agent endpoint  POST http://${HOST}:${PORT}/mcp/<code>  (Bearer token required)`);
  console.error(`[relay] browser socket  ws://${HOST}:${PORT}/ws?code=<code>`);
  console.error(`[relay] journal         ${JOURNAL_DIR}`);
  console.error(`[relay] ${TOOLS.length} tools advertised`);
}
