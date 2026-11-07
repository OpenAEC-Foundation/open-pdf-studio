// Ringbuffer van de console voor de MCP-observeerbaarheid. Staat los van
// js/mcp-bridge.js zodat hij vanaf de start meeschrijft (main.js importeert
// hem vroeg), terwijl de brug zelf pas na het opbouwen van het venster laadt
// (#454). De MCP-tool `app_get_recent_console` leest dezelfde array.

// ─── Console ring buffer for MCP/AI observability ────────────────────────
// Captures the most recent N console messages whose text matches the
// observer regex. The MCP tool `app_get_recent_console` reads this and
// returns the slice the AI client wants. Default-on so an AI agent can
// always look back at what happened during the last few seconds without
// any setup step on the user side.
export const CONSOLE_RING = [];
export const CONSOLE_RING_MAX = 500;
// Expose the ring on window so in-app UI (e.g. MiniLog) can read recent
// engine events without going through the MCP/IPC round-trip. The MCP
// tool handler still reads the same array — single source of truth.
try { window.__consoleRing = CONSOLE_RING; } catch { /* noop */ }
// Patterns the render pipeline uses: [render], [tile], [wheel-zoom],
// [PERF], [pre-render], STALE markers. Adjust if more subsystems need
// capture later.
const CONSOLE_CAPTURE_RE = /\[render\]|\[tile\]|\[wheel-zoom\]|\[PERF\]|\[pre-render\]|\[thumb\]|\[bitmap-orch\]|\[tile-orch\]|\[prog\]|\[prog-guard\]|\[pbc\]|\[bo\]|STALE|JANK/;

function _captureConsole(level, args) {
  try {
    const s = args.map(a => typeof a === 'string' ? a : (a && a.message) ? a.message : String(a)).join(' ');
    if (!CONSOLE_CAPTURE_RE.test(s)) return;
    CONSOLE_RING.push({ t: Date.now(), level, text: s });
    if (CONSOLE_RING.length > CONSOLE_RING_MAX) CONSOLE_RING.shift();
  } catch {
    // Swallow — observability MUST NOT crash the app.
  }
}

(function patchConsole() {
  const ORIG_LOG = console.log;
  const ORIG_WARN = console.warn;
  const ORIG_ERROR = console.error;
  console.log = function (...args) { _captureConsole('log', args); ORIG_LOG.apply(console, args); };
  console.warn = function (...args) { _captureConsole('warn', args); ORIG_WARN.apply(console, args); };
  console.error = function (...args) { _captureConsole('error', args); ORIG_ERROR.apply(console, args); };
})();
