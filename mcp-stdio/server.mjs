#!/usr/bin/env node
/**
 * Open PDF Studio — MCP stdio bridge
 * ==================================
 *
 * Claude Desktop and Claude Code speak MCP over **stdio**. Open PDF Studio
 * already ships a full MCP server (~50 tools, including the assistant relay)
 * — but it lives *inside* the running Tauri app and speaks **HTTP JSON-RPC**
 * on `127.0.0.1:<port>/mcp` (default port 9223, started with `--mcp-server`).
 *
 * This file is the missing link: a thin, zero-dependency proxy that reads
 * newline-delimited JSON-RPC from stdin, forwards each message verbatim to
 * the app's HTTP endpoint, and writes the response back to stdout. No tool
 * logic is reimplemented here — `tools/list` and `tools/call` are answered by
 * the live app, so this bridge automatically tracks whatever tools the app
 * exposes (open/zoom/annotate/save PDF, drive the assistant, etc.).
 *
 *   Claude Desktop/Code  ──stdio──►  this proxy  ──HTTP──►  Open PDF Studio
 *                        ◄─stdio──               ◄──HTTP──  (Rust mcp_server)
 *
 * The app must be running with the MCP server enabled, e.g.:
 *   npm run tauri -- dev -- -- --mcp-server                  (dev / debug)
 *   OPS_ENABLE_MCP=1 <app> --mcp-server                      (release build)
 *
 * Config (env):
 *   OPS_MCP_PORT / MCP_PORT   target port (default 9223)
 *   OPS_MCP_HOST              target host (default 127.0.0.1)
 *
 * Run `node server.mjs --probe` to check the app is reachable.
 */

import readline from "node:readline";

const PORT = process.env.OPS_MCP_PORT || process.env.MCP_PORT || "9223";
const HOST = process.env.OPS_MCP_HOST || "127.0.0.1";
const ENDPOINT = `http://${HOST}:${PORT}/mcp`;

function bridgeDownMessage(err) {
  return (
    `Open PDF Studio MCP bridge: cannot reach the app at ${ENDPOINT}. ` +
    `Start the app with the MCP server enabled — ` +
    `"npm run tauri -- dev -- -- --mcp-server" (dev) or ` +
    `"OPS_ENABLE_MCP=1 <app> --mcp-server" (release). ` +
    `Underlying error: ${err && err.message ? err.message : String(err)}`
  );
}

/** Forward a raw JSON-RPC body to the app and return the response text. */
async function forward(body) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return res.text();
}

// ── --probe: one-shot reachability check (writes to stderr, never stdout) ──
if (process.argv.includes("--probe")) {
  try {
    const text = await forward(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const parsed = JSON.parse(text);
    const n = parsed?.result?.tools?.length ?? 0;
    console.error(
      `[open-pdf-studio mcp bridge] OK — ${n} tools available at ${ENDPOINT}`,
    );
    process.exit(0);
  } catch (err) {
    console.error(`[open-pdf-studio mcp bridge] FAIL — ${bridgeDownMessage(err)}`);
    process.exit(1);
  }
}

const isNotification = (m) =>
  m && typeof m === "object" && !Array.isArray(m) && !("id" in m);

function writeMessage(obj) {
  // JSON.stringify never emits raw newlines, so each message stays on one line
  // (required by the MCP stdio framing).
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    // Not valid JSON — nothing we can usefully reply to.
    return;
  }

  // Answer ping locally so the connection stays alive even if the app's
  // minimal JSON-RPC server doesn't implement it.
  if (!Array.isArray(msg) && msg.method === "ping" && "id" in msg) {
    writeMessage({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }

  let text;
  try {
    text = await forward(trimmed);
  } catch (err) {
    if (!isNotification(msg)) {
      const id = Array.isArray(msg) ? null : (msg.id ?? null);
      writeMessage({
        jsonrpc: "2.0",
        id,
        error: { code: -32001, message: bridgeDownMessage(err) },
      });
    }
    return;
  }

  // Notifications expect no reply — swallow whatever the app echoed back.
  if (isNotification(msg)) return;

  const out = (text || "").trim();
  if (out) {
    process.stdout.write(out + "\n");
  } else if (!Array.isArray(msg)) {
    // Empty body for an id-bearing request: synthesise an error so the client
    // isn't left hanging.
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id ?? null,
      error: { code: -32002, message: `Empty response from ${ENDPOINT}` },
    });
  }
}

console.error(
  `[open-pdf-studio mcp bridge] ready — proxying stdio ⇄ ${ENDPOINT}`,
);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  handleLine(line).catch((err) => {
    console.error(`[open-pdf-studio mcp bridge] handler error: ${err?.stack || err}`);
  });
});
rl.on("close", () => process.exit(0));
