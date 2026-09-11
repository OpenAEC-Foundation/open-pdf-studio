#!/usr/bin/env node
/**
 * Open PDF Studio — MCP stdio bridge
 * ==================================
 *
 * Claude Desktop and Claude Code speak MCP over **stdio**. Open PDF Studio
 * ships a full MCP server *inside* the running app that speaks **HTTP
 * JSON-RPC** on `127.0.0.1:<port>/mcp` (default port 9223).
 *
 * This file is the missing link: a thin, zero-dependency proxy that reads
 * newline-delimited JSON-RPC from stdin, forwards each message verbatim to
 * the app's HTTP endpoint, and writes the response back to stdout. No tool
 * logic is reimplemented here — `tools/list` and `tools/call` are answered by
 * the live app.
 *
 *   Claude Desktop/Code  ──stdio──►  this proxy  ──HTTP──►  Open PDF Studio
 *                        ◄─stdio──               ◄──HTTP──  (Rust mcp_server)
 *
 * When the app is not running, the bridge answers `initialize` and
 * `tools/list` itself (from tools.json next to this file) and returns an
 * actionable message for tool calls — see brug.mjs.
 *
 * Enable the server in the app: Settings > General > AI link (MCP).
 * Developers can also start it with `OPS_ENABLE_MCP=1 <app> --mcp-server`
 * (all tools, including test tools) or `npm run tauri -- dev -- -- --mcp-server`.
 *
 * Config (env):
 *   OPS_MCP_PORT / MCP_PORT   target port (default 9223)
 *   OPS_MCP_HOST              target host (default 127.0.0.1)
 *
 * Run `node server.mjs --probe` to check the app is reachable.
 */

import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { maakBrug } from './brug.mjs';

const PORT = process.env.OPS_MCP_PORT || process.env.MCP_PORT || '9223';
const HOST = process.env.OPS_MCP_HOST || '127.0.0.1';
const ENDPOINT = `http://${HOST}:${PORT}/mcp`;

function leesJson(naam, standaard) {
  try {
    return JSON.parse(readFileSync(new URL(`./${naam}`, import.meta.url), 'utf8'));
  } catch {
    return standaard;
  }
}

const TOOLS = leesJson('tools.json', []);
const VERSIE = leesJson('package.json', {}).version || '0.0.0';

// ── --probe: one-shot reachability check (writes to stderr, never stdout) ──
if (process.argv.includes('--probe')) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const n = JSON.parse(await res.text())?.result?.tools?.length ?? 0;
    console.error(`[open-pdf-studio mcp bridge] OK — ${n} tools available at ${ENDPOINT}`);
    process.exit(0);
  } catch (err) {
    console.error(`[open-pdf-studio mcp bridge] FAIL — ${ENDPOINT} not reachable: ${err?.message || err}`);
    process.exit(1);
  }
}

const verwerk = maakBrug({ endpoint: ENDPOINT, tools: TOOLS, versie: VERSIE });

console.error(`[open-pdf-studio mcp bridge] ready — proxying stdio ⇄ ${ENDPOINT}`);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  verwerk(line)
    .then((uit) => { if (uit) process.stdout.write(uit + '\n'); })
    .catch((err) => {
      console.error(`[open-pdf-studio mcp bridge] handler error: ${err?.stack || err}`);
    });
});
rl.on('close', () => process.exit(0));
