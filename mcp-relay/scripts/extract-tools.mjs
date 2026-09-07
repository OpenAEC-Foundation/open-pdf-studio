#!/usr/bin/env node
/**
 * Extract the MCP `tools/list` schema out of the Rust source into JSON.
 *
 * `handle_tools_list()` in `src-tauri/src/mcp_server.rs` is a single
 * `json!({ ... })` literal with no Rust interpolation, so its body is already
 * valid JSON — we just have to find it and strip the macro wrapper. Keeping
 * the Rust file as the source of truth means the desktop app and the relay
 * can never disagree about what tools exist or what arguments they take.
 *
 * Run after any change to the Rust tool list:
 *   node mcp-relay/scripts/extract-tools.mjs
 *
 * `--check` exits non-zero if the committed JSON is stale, for CI.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUST = join(HERE, '..', '..', 'open-pdf-studio', 'src-tauri', 'src', 'mcp_server.rs');
const OUT = join(HERE, '..', 'tools.json');

// Tools the relay must not advertise. `app_undo` / `app_redo` are dropped
// deliberately: the agent and the person share one `doc.undoStack`, so an
// agent-issued undo pops whichever command is on top — frequently the
// person's redline rather than the agent's own last shape. The agent knows
// the ids of everything it created, so `app_delete_annotation` does the same
// job precisely and cannot reach the person's work.
// `app_set_window_size` is withheld for a different reason: it is handled in
// the Rust process (`window_mgmt.rs`), not by `js/mcp-bridge.js`, and a page
// cannot resize the window it is running in. Advertising it would leave the
// agent waiting out the full timeout for a call nothing can service.
export const WITHHELD_TOOLS = new Set(['app_undo', 'app_redo', 'app_set_window_size']);

/**
 * Tools that exist only in the shared-session build, so they have no entry in
 * the Rust source to extract. Handled by `js/mcp-bridge.js` like any other.
 */
export const ADDED_TOOLS = [
  {
    name: 'app_commit_batch',
    description:
      'Mark everything drawn so far as a settled batch, so the person watching cannot ' +
      'undo back into it with Ctrl-Z. Call this after each coherent unit of work — an ' +
      'elevation, a title block, a schedule. Pass release:true to lift the mark and hand ' +
      'undo of the whole document back to the person.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Optional name for the batch, echoed back.' },
        release: { type: 'boolean', description: 'Lift the floor instead of setting it.', default: false },
      },
      additionalProperties: false,
    },
  },
];

/** Pull the `json!({...})` body out of `fn handle_tools_list()`. */
export function extractToolsBlock(source) {
  const fnAt = source.indexOf('fn handle_tools_list()');
  if (fnAt === -1) throw new Error('handle_tools_list() not found in mcp_server.rs');

  const openAt = source.indexOf('json!(', fnAt);
  if (openAt === -1) throw new Error('json!( literal not found in handle_tools_list()');

  // Walk from the paren after `json!` and match brackets, skipping anything
  // inside a string literal so a `)` or `}` in a description can't end it.
  let i = source.indexOf('(', openAt + 'json!'.length);
  const start = i + 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  throw new Error('unbalanced json!() literal in handle_tools_list()');
}

/** Extracted tools, minus the ones the relay withholds. */
export function buildToolList(source) {
  const parsed = JSON.parse(extractToolsBlock(source));
  if (!Array.isArray(parsed?.tools)) throw new Error('extracted block has no `tools` array');

  const kept = parsed.tools.filter((t) => !WITHHELD_TOOLS.has(t?.name));
  const withheld = parsed.tools.length - kept.length;

  const names = new Set(kept.map((t) => t.name));
  for (const extra of ADDED_TOOLS) {
    if (names.has(extra.name)) {
      throw new Error(`${extra.name} now exists in Rust too — drop it from ADDED_TOOLS`);
    }
    kept.push(extra);
  }

  return { tools: kept, total: parsed.tools.length, withheld, added: ADDED_TOOLS.length };
}

function main() {
  const source = readFileSync(RUST, 'utf8');
  const { tools, total, withheld, added } = buildToolList(source);
  const json = JSON.stringify({ tools }, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
    if (current !== json) {
      console.error(
        'mcp-relay/tools.json is stale. Re-run: node mcp-relay/scripts/extract-tools.mjs',
      );
      process.exit(1);
    }
    console.error(`tools.json up to date — ${tools.length} tools`);
    return;
  }

  writeFileSync(OUT, json);
  console.error(
    `wrote ${OUT} — ${tools.length} tools ` +
    `(${total} in Rust, ${withheld} withheld: ${[...WITHHELD_TOOLS].join(', ')}; ` +
    `${added} added: ${ADDED_TOOLS.map((t) => t.name).join(', ')})`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
