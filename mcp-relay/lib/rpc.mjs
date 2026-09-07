/**
 * JSON-RPC 2.0 helpers and the tool-name → app-event mapping.
 *
 * Mirrors the dispatch in `src-tauri/src/mcp_server.rs`: three methods
 * (`initialize`, `tools/list`, `tools/call`) matched on the method string,
 * with tool results returned as a single text content block.
 */

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

export const PROTOCOL_VERSION = '2024-11-05';

export function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** A request with no `id` is a notification — it gets no response at all. */
export function isNotification(msg) {
  return !!msg && typeof msg === 'object' && !Array.isArray(msg) && !('id' in msg);
}

/**
 * `app_create_annotation` → `mcp:create-annotation`.
 *
 * The same derivation the Rust side uses when it emits to the WebView, so the
 * listener names registered by `js/mcp-bridge.js` match without a lookup
 * table that could drift out of sync with either end.
 */
export function eventNameForTool(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('app_')) return null;
  return `mcp:${toolName.slice('app_'.length).replaceAll('_', '-')}`;
}

/** Tool results travel as one text block, matching the desktop server so an
 *  agent sees byte-identical output from either. */
export function toolContent(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text', text }] };
}

export function toolError(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], isError: true };
}

/** Per-tool response budget. Most app calls are a redraw and return in
 *  milliseconds; the assistant relay is a long-poll by design and the save
 *  path can rewrite a large document, so both get real headroom. */
export function timeoutForTool(toolName) {
  switch (toolName) {
    case 'app_assistant_pending': return 620_000; // matches DEFAULT_TIMEOUT_MS in assistant-mcp-relay.js
    case 'app_assistant_ask':     return 620_000;
    case 'app_ai_complete':       return 180_000;
    case 'app_save_pdf':          return 120_000;
    case 'app_open_pdf':          return 120_000;
    case 'app_merge_pdf':         return 120_000;
    case 'app_screenshot_view':   return  60_000;
    default:                      return  30_000;
  }
}
