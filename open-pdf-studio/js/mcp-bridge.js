/**
 * MCP <-> WebView bridge.
 *
 * Listens for `mcp:*` events emitted by the Rust MCP server (see
 * `src-tauri/src/mcp_app_bridge.rs`) and dispatches them to the matching
 * in-app function. After each handler completes (or throws) we call
 * `app_response(requestId, result)` so the awaiting MCP tool returns.
 *
 * Expected event payload:
 *   { request_id: number, params: object }
 *
 * Handler return shapes:
 *   { ok: true, ... }       -> success, additional fields are tool-specific
 *   { ok: false, error: s } -> failure (the tool surface still gets a 200 OK)
 *
 * The MCP server side doesn't impose a specific response schema; whatever
 * JSON we send back ends up in the tool's `content[0].text` block verbatim.
 */

// All app-internal imports are resolved lazily inside handlers so the
// bridge module load never pulls the heavy renderer/loader graph at app
// startup. Keeps `initMcpBridge()` import-safe even if a downstream module
// is briefly broken in dev.

/** Best-effort grab of the Tauri invoke fn — falls back to a no-op so this
 *  module is import-safe in the browser/dev-server case. */
function tauriInvoke() {
  return window.__TAURI__?.core?.invoke ?? null;
}

// ─── Console ring buffer for MCP/AI observability ────────────────────────
// Captures the most recent N console messages whose text matches the
// observer regex. The MCP tool `app_get_recent_console` reads this and
// returns the slice the AI client wants. Default-on so an AI agent can
// always look back at what happened during the last few seconds without
// any setup step on the user side.
const CONSOLE_RING = [];
const CONSOLE_RING_MAX = 500;
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

/** Send the response payload back to the awaiting Rust task. */
async function respond(requestId, result) {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke('app_response', { requestId, result });
  } catch (e) {
    console.warn('[mcp-bridge] app_response failed:', e);
  }
}

/** Resolve once the active document has its PDF.js doc loaded (or `timeoutMs`
 *  elapses). loadPDF is fire-and-forget here because it goes through the
 *  app's own promise queue — we have to poll for the side effect. */
async function waitForActiveLoad(targetDoc, timeoutMs = 30000) {
  const stateMod = await import('./core/state.js');
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!stateMod.state.documents.includes(targetDoc)) return resolve(false);
      if (targetDoc.pdfDoc && !targetDoc._isLoading) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(check, 50);
    };
    check();
  });
}

/** Composite the PDF canvas + annotation/highlight overlays into a single
 *  PNG and return it as a base64 string (no `data:` prefix).
 *
 *  We deliberately do NOT capture the surrounding chrome (toolbars, panels)
 *  — the regression-test harness only cares about the page view. For a
 *  full-window grab the caller can use OS-level screenshotting. */
async function compositeCurrentView(maxWidth = 2000) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  const annCanvas = document.getElementById('annotation-canvas');
  const hlCanvas  = document.getElementById('text-highlight-canvas');
  if (!pdfCanvas || pdfCanvas.width === 0 || pdfCanvas.height === 0) {
    throw new Error('pdf-canvas not visible');
  }

  // Scale the composite so the longer side fits within maxWidth (avoids
  // multi-megabyte payloads on 4K displays at 800% zoom).
  const longest = Math.max(pdfCanvas.width, pdfCanvas.height);
  const scale = longest > maxWidth ? maxWidth / longest : 1;
  const outW = Math.max(1, Math.round(pdfCanvas.width * scale));
  const outH = Math.max(1, Math.round(pdfCanvas.height * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  // White background so transparent regions don't read as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(pdfCanvas, 0, 0, outW, outH);
  if (hlCanvas && hlCanvas.width > 0 && hlCanvas.height > 0) {
    ctx.drawImage(hlCanvas, 0, 0, outW, outH);
  }
  if (annCanvas && annCanvas.width > 0 && annCanvas.height > 0) {
    ctx.drawImage(annCanvas, 0, 0, outW, outH);
  }
  const dataURL = out.toDataURL('image/png');
  // Strip the `data:image/png;base64,` prefix so the returned string is
  // pure base64 (matches the existing `screenshot_page` tool's shape).
  const b64 = dataURL.startsWith('data:') ? dataURL.split(',', 2)[1] : dataURL;
  return { png_base64: b64, width: outW, height: outH };
}

// ─── Per-event handlers ─────────────────────────────────────────────────

async function handleOpenPdf(params) {
  const path = params?.path;
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'missing or invalid params.path' };
  }
  const stateMod = await import('./core/state.js');
  const tabsMod = await import('./ui/chrome/tabs.js');
  const loaderMod = await import('./pdf/loader.js');

  // Reuse existing tab if the file is already open.
  let tabIndex = stateMod.findDocumentByPath(path);
  if (tabIndex === -1) {
    const { index } = tabsMod.createTab(path, false);
    tabIndex = index;
  }
  tabsMod.switchToTab(tabIndex);
  const doc = stateMod.state.documents[tabIndex];
  if (!doc.pdfDoc) {
    try {
      await loaderMod.loadPDF(path, tabIndex);
    } catch (e) {
      return { ok: false, error: `loadPDF: ${e?.message ?? e}` };
    }
  }
  const ready = await waitForActiveLoad(doc, 30000);
  if (!ready) return { ok: false, error: 'load timed out' };
  return {
    ok: true,
    tab_id:     tabIndex,
    page_count: doc.pdfDoc?.numPages ?? 0,
    file_path:  path,
  };
}

async function handleSetZoom(params) {
  const scale = Number(params?.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    return { ok: false, error: 'missing or invalid params.scale' };
  }
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try {
    await rendererMod.setZoom(scale);
  } catch (e) {
    return { ok: false, error: `setZoom: ${e?.message ?? e}` };
  }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, requested: scale, actual };
}

async function handleZoomIn() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomIn(); } catch (e) { return { ok: false, error: `zoomIn: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleZoomOut() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomOut(); } catch (e) { return { ok: false, error: `zoomOut: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleScreenshotView(params) {
  const width = Number(params?.width) > 0 ? Number(params.width) : 2000;
  // Yield one frame so any pending zoom / paint has a chance to land.
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  try {
    const out = await compositeCurrentView(width);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: `compositeCurrentView: ${e?.message ?? e}` };
  }
}

// ─── Mouse + keyboard interaction ───────────────────────────────────────
//
// All synthetic events use `bubbles: true` and `cancelable: true` so they
// flow through the standard listener path. Coordinates are CSS pixels in
// the viewport (top-left origin), matching `MouseEvent.clientX/Y`.
//
// Button mapping per the W3C UI Events spec:
//    left=0, middle=1, right=2 (the `button` field)
//    left=1, right=2, middle=4 (the `buttons` bitmask sent during
//    in-flight drags so listeners that gate on `e.buttons` still fire).

const BUTTON_INDEX = { left: 0, middle: 1, right: 2 };
const BUTTONS_MASK = { left: 1, middle: 4, right: 2 };

function buttonIndexFor(name) {
  if (name == null) return 0;
  const v = BUTTON_INDEX[String(name).toLowerCase()];
  return typeof v === 'number' ? v : 0;
}
function buttonsMaskFor(name) {
  if (name == null) return 1;
  const v = BUTTONS_MASK[String(name).toLowerCase()];
  return typeof v === 'number' ? v : 1;
}

/** Build a MouseEventInit with the standard fields populated. */
function makeMouseInit(x, y, opts = {}) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 0,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    metaKey: !!opts.metaKey,
    relatedTarget: opts.relatedTarget ?? null,
    detail: opts.detail ?? 0,
  };
}

/** PointerEventInit on top of the mouse init — the annotation canvas (and
 *  the drawing-tool dispatcher) listens for POINTER events, so every
 *  synthetic interaction emits the pointer event first, then the legacy
 *  mouse event for code that still listens to those. */
function makePointerInit(x, y, opts = {}) {
  return {
    ...makeMouseInit(x, y, opts),
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    pressure: (opts.buttons ?? 0) ? 0.5 : 0,
  };
}

function dispatchPointerAndMouse(target, kind, x, y, opts) {
  // kind: 'down' | 'move' | 'up'
  try {
    target.dispatchEvent(new PointerEvent(`pointer${kind}`, makePointerInit(x, y, opts)));
  } catch (_) { /* PointerEvent unavailable — mouse event below still fires */ }
  target.dispatchEvent(new MouseEvent(`mouse${kind}`, makeMouseInit(x, y, opts)));
}

/** elementFromPoint can return null if the coords are off-screen — fall
 *  back to document.body so the dispatch still has a target. */
function targetAt(x, y) {
  return document.elementFromPoint(x, y) ?? document.body;
}

function describeTarget(el) {
  if (!el) return null;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    classes: el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(Boolean)
      : [],
  };
}

async function handleMouseMove(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const target = targetAt(x, y);
  dispatchPointerAndMouse(target, 'move', x, y, { buttons: 0 });
  return { ok: true, x, y, target: describeTarget(target) };
}

async function handleMouseClick(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const buttonName = (params?.button ?? 'left');
  const button = buttonIndexFor(buttonName);
  const buttonsMask = buttonsMaskFor(buttonName);
  const double = !!params?.double;
  const mods = {
    shiftKey: !!params?.shift,
    ctrlKey: !!params?.ctrl,
    altKey: !!params?.alt,
    // detail===2 lets the app's double-click handlers fire (e.g. select-tool
    // entering text-edit mode on a textbox/callout).
    detail: double ? 2 : 1,
  };
  const target = targetAt(x, y);

  // Standard sequence: move -> down -> up (pointer + mouse pairs), then
  // click/contextmenu.
  dispatchPointerAndMouse(target, 'move', x, y, { button: 0, buttons: 0, ...mods });
  dispatchPointerAndMouse(target, 'down', x, y, { button, buttons: buttonsMask, ...mods });
  dispatchPointerAndMouse(target, 'up', x, y, { button, buttons: 0, ...mods });

  if (buttonName === 'right') {
    target.dispatchEvent(new MouseEvent('contextmenu',
      makeMouseInit(x, y, { button, buttons: 0 })));
  } else {
    target.dispatchEvent(new MouseEvent('click',
      makeMouseInit(x, y, { button, buttons: 0, detail: double ? 2 : 1 })));
    if (double) {
      target.dispatchEvent(new MouseEvent('dblclick',
        makeMouseInit(x, y, { button, buttons: 0, detail: 2 })));
    }
  }
  return { ok: true, x, y, button: buttonName, double, target: describeTarget(target) };
}

async function handleMouseDrag(params) {
  const x1 = Number(params?.x1);
  const y1 = Number(params?.y1);
  const x2 = Number(params?.x2);
  const y2 = Number(params?.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return { ok: false, error: 'missing or invalid params.x1/y1/x2/y2' };
  }
  const buttonName = (params?.button ?? 'left');
  const button = buttonIndexFor(buttonName);
  const buttonsMask = buttonsMaskFor(buttonName);
  const steps = Math.max(1, Math.min(200, Number(params?.steps) || 10));

  const startTarget = targetAt(x1, y1);
  // pointer/mouse down at start
  dispatchPointerAndMouse(startTarget, 'down', x1, y1, { button, buttons: buttonsMask });

  // Interpolated moves. We dispatch each move on the element under
  // that point so hit-testing works as the cursor crosses widgets.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const t2 = targetAt(x, y);
    dispatchPointerAndMouse(t2, 'move', x, y, { button, buttons: buttonsMask });
    // Yield occasionally so pointer-driven raf loops can keep up.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const endTarget = targetAt(x2, y2);
  dispatchPointerAndMouse(endTarget, 'up', x2, y2, { button, buttons: 0 });
  // Some apps rely on a click after the up. We send it only for left
  // button to avoid spurious context menus.
  if (buttonName === 'left' && (x1 === x2 && y1 === y2)) {
    endTarget.dispatchEvent(new MouseEvent('click',
      makeMouseInit(x2, y2, { button, buttons: 0 })));
  }
  return {
    ok: true,
    from: { x: x1, y: y1 },
    to:   { x: x2, y: y2 },
    button: buttonName,
    steps,
    end_target: describeTarget(endTarget),
  };
}

async function handleScroll(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const dx = Number(params?.dx) || 0;
  const dy = Number(params?.dy) || 0;
  const target = targetAt(x, y);
  const ev = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    deltaX: dx,
    deltaY: dy,
    deltaZ: 0,
    deltaMode: 0, // DOM_DELTA_PIXEL
    ctrlKey: !!params?.ctrlKey,
    shiftKey: !!params?.shiftKey,
    altKey: !!params?.altKey,
    metaKey: !!params?.metaKey,
  });
  target.dispatchEvent(ev);
  return {
    ok: true,
    x, y, dx, dy,
    ctrlKey: !!params?.ctrlKey,
    target: describeTarget(target),
  };
}

/** Map a single character to the W3C `KeyboardEvent.code` value (best
 *  effort — only used as a hint, not gating logic). */
function codeForChar(ch) {
  if (!ch) return '';
  const upper = ch.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^[0-9]$/.test(upper)) return `Digit${upper}`;
  if (ch === ' ') return 'Space';
  return '';
}

/** Build a KeyboardEventInit used for both keydown and keyup. */
function makeKeyInit(key, opts = {}) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    key,
    code: opts.code ?? codeForChar(key.length === 1 ? key : ''),
    location: 0,
    repeat: false,
    isComposing: false,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    metaKey: !!opts.metaKey,
  };
}

async function handleKey(params) {
  const key = params?.key;
  if (typeof key !== 'string' || !key) {
    return { ok: false, error: 'missing or invalid params.key' };
  }
  const init = {
    ctrlKey: !!params?.ctrl,
    shiftKey: !!params?.shift,
    altKey: !!params?.alt,
    metaKey: !!params?.meta,
  };
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', makeKeyInit(key, init)));
  target.dispatchEvent(new KeyboardEvent('keyup',   makeKeyInit(key, init)));
  return { ok: true, key, modifiers: init, target: describeTarget(target) };
}

async function handleType(params) {
  const text = params?.text;
  if (typeof text !== 'string') {
    return { ok: false, error: 'missing or invalid params.text' };
  }

  let typed = 0;
  let lastTarget = document.body;
  let lastEditable = false;
  for (const ch of text) {
    const target = document.activeElement ?? document.body;
    lastTarget = target;
    const init = makeKeyInit(ch, {});
    target.dispatchEvent(new KeyboardEvent('keydown', init));

    // beforeinput + input fire on text inputs so framework controls update.
    // We only inject text into editable controls — refusing to mangle
    // arbitrary DOM text content.
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const isEditable = (tag === 'input' || tag === 'textarea' ||
                       target.isContentEditable === true);
    lastEditable = isEditable;
    if (isEditable) {
      try {
        target.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true,
          inputType: 'insertText', data: ch,
        }));
        if (tag === 'input' || tag === 'textarea') {
          // Manually splice into value so frameworks observing `value`
          // (like SolidJS) see the change. For native fields the spec says
          // the browser maintains value, but synthetic events bypass that.
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          target.value = target.value.slice(0, start) + ch + target.value.slice(end);
          const pos = start + ch.length;
          try { target.setSelectionRange(pos, pos); } catch { /* readonly */ }
        } else {
          // contentEditable: insert via execCommand fallback.
          if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, ch);
          }
        }
        target.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: false,
          inputType: 'insertText', data: ch,
        }));
      } catch (e) {
        // best-effort: continue typing
      }
    }
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    typed++;
  }
  return { ok: true, typed, target: describeTarget(lastTarget), editable: lastEditable };
}

async function handleGetViewportState() {
  // Probe the current viewport state for testing math (zoom-to-cursor,
  // smooth scrolling, etc). Returns the singleton viewport's transform
  // plus canvas + container dimensions so callers can map screen↔world.
  // Also includes render-engine status, tile-overlay state, and the active
  // document scale/page — everything an AI/MCP client needs to observe a
  // zoom/scroll/pan sequence.
  const vp = window.__pdfViewport;
  const pdfCanvas = document.getElementById('pdf-canvas');
  const container = document.getElementById('pdf-container') || pdfCanvas?.parentElement;
  const cRect = container?.getBoundingClientRect();
  const pRect = pdfCanvas?.getBoundingClientRect();
  // Tile is no longer a DOM canvas — it is a transient ImageBitmap living on
  // the viewport singleton, drawn each frame as a second drawImage() pass on
  // top of the main pdf-canvas (see pdf-viewport.js _render()).
  const tileBitmap = vp?.currentTile || null;
  const tileMeta = vp?.currentTileMeta || null;

  // Pull state.renderEngine + state.renderTiming from the central app state
  // (set by renderer.js after each render). Critical for verifying that
  // PDFium (NOT PDF.js) is the engine actually drawing the page.
  let renderEngine = null;
  let renderTiming = null;
  let docScale = null;
  let activeDocPath = null;
  let activePageNum = null;
  let viewMode = null;
  let bookSpread = null;
  let currentTool = null;
  let annotationCount = null;
  let selectedCount = null;
  let pageCount = null;
  let statusMessage = null;
  try {
    const stateMod = await import('/js/core/state.ts');
    renderEngine = stateMod.state?.renderEngine ?? null;
    renderTiming = stateMod.state?.renderTiming ?? null;
    currentTool = stateMod.state?.currentTool ?? null;
    statusMessage = stateMod.state?.statusMessage ?? null;
    const doc = stateMod.state?.documents?.[stateMod.state.activeDocumentIndex];
    docScale = doc?.scale ?? null;
    activeDocPath = doc?.filePath ?? null;
    activePageNum = doc?.currentPage ?? null;
    viewMode = doc?.viewMode ?? null;
    bookSpread = !!doc?.bookSpread;
    annotationCount = (doc?.annotations || []).length;
    selectedCount = (doc?.selectedAnnotations || []).length;
    pageCount = doc?.pdfDoc?.numPages ?? null;
  } catch {
    // Module may not be loaded yet; leave fields null.
  }

  return {
    ok: true,
    // App-level tool + annotation snapshot (used by the button-sweep
    // protocol scenarios to assert tool switches and annotation effects).
    currentTool,
    annotationCount,
    selectedCount,
    pageCount,
    statusMessage,
    // Engine + timing — what the user sees in the status-bar chip.
    engine: renderEngine,
    renderTiming,
    // Active document at the moment of the snapshot.
    doc: {
      filePath: activeDocPath,
      scale: docScale,
      currentPage: activePageNum,
      viewMode,
      bookSpread,
    },
    // viewport singleton (pdf-viewport.js): the transform that maps world→screen
    viewport: vp ? {
      active: !!vp.active,
      zoom: vp.zoom ?? null,
      offsetX: vp.offsetX ?? null,
      offsetY: vp.offsetY ?? null,
      pageW: vp.pageW ?? null,
      pageH: vp.pageH ?? null,
      filePath: vp.filePath ?? null,
      pageNum: vp.pageNum ?? null,
    } : null,
    // The main canvas backing store
    canvas: pdfCanvas ? {
      width: pdfCanvas.width,
      height: pdfCanvas.height,
      cssWidth: pRect?.width ?? null,
      cssHeight: pRect?.height ?? null,
      cssLeft: pRect?.left ?? null,
      cssTop: pRect?.top ?? null,
    } : null,
    // High-zoom tile augment. When present, the viewport singleton draws
    // this crisp visible-region bitmap as a second pass on top of the
    // cap-stretched main canvas. meta carries the PDF-point region rect
    // and source zoom so callers can map it back to page coordinates.
    tile: tileBitmap ? {
      width: tileBitmap.width,
      height: tileBitmap.height,
      meta: tileMeta,
    } : null,
    // The container (visible scrollable area)
    container: cRect ? {
      width: cRect.width,
      height: cRect.height,
      left: cRect.left,
      top: cRect.top,
      scrollLeft: container?.scrollLeft ?? null,
      scrollTop: container?.scrollTop ?? null,
    } : null,
    devicePixelRatio: window.devicePixelRatio ?? 1,
  };
}

async function handleGetRecentConsole(params) {
  // Return the recent capture-buffer of console messages. Defaults to all
  // 500 entries. Filter via `params.since` (epoch-ms cutoff) or
  // `params.tail` (last N entries) to limit volume.
  const since = (params && typeof params.since === 'number') ? params.since : 0;
  const tail = (params && typeof params.tail === 'number') ? params.tail : 0;

  let entries = CONSOLE_RING;
  if (since > 0) entries = entries.filter(e => e.t >= since);
  if (tail > 0 && entries.length > tail) entries = entries.slice(-tail);

  return {
    ok: true,
    serverTimeMs: Date.now(),
    bufferSize: CONSOLE_RING.length,
    bufferMax: CONSOLE_RING_MAX,
    entries: entries.map(e => ({
      t: e.t,
      deltaMs: Date.now() - e.t,
      level: e.level,
      text: e.text,
    })),
  };
}

// ─── Zoom-anchor test harness (autonomous AI driving the app) ─────────────
//
// Synthetic WheelEvent dispatch + numeric pre/post canvas state capture so
// an MCP-driven loop can probe the cursor-anchor accuracy of zoom WITHOUT
// requiring a human to wiggle the mouse. The test reports the displacement
// (in CSS pixels) between where the world-point under the cursor was BEFORE
// the zoom and where it ended up AFTER — anything > a few pixels is the
// "zoom springt" bug the user has been seeing.

async function _waitForRenderIdle(timeoutMs = 5000) {
  // Renderer.js increments window.__pdfRenderInFlight at the top of
  // renderPage and decrements in a finally block, so === 0 means no
  // bitmap/cache work is pending. We also wait one extra RAF so any
  // post-paint setTimeout(0) (tile overlay) lands.
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if ((window.__pdfRenderInFlight || 0) === 0) {
      await new Promise(r => requestAnimationFrame(() => r()));
      await new Promise(r => setTimeout(r, 0)); // let tile setTimeout(0) macrotask run
      await new Promise(r => requestAnimationFrame(() => r()));
      // Second check in case a follow-up renderPage was queued by setTimeout(0)
      if ((window.__pdfRenderInFlight || 0) === 0) {
        return true;
      }
    }
    await new Promise(r => setTimeout(r, 30));
  }
  return false; // timed out — caller should still proceed but flag it
}

/** Snapshot enough state to compute "where is the world-point at (x, y)?" */
async function _captureCanvasState(x, y) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  const container = document.getElementById('pdf-container');
  const canvasContainer = document.getElementById('canvas-container');
  if (!pdfCanvas) return null;
  // Tile is no longer a DOM canvas — read the transient ImageBitmap +
  // region metadata from the viewport singleton (set by bitmap-orchestrator).
  const _vpSingleton = window.__pdfViewport || null;
  const tileBitmap = _vpSingleton?.currentTile || null;
  const tileMeta = _vpSingleton?.currentTileMeta || null;
  const r = pdfCanvas.getBoundingClientRect();
  const cr = container?.getBoundingClientRect();
  const ccr = canvasContainer?.getBoundingClientRect();
  // fractionX/Y: where the cursor sits relative to the canvas (0..1 means
  // inside, < 0 left of canvas, > 1 right of canvas). This is the
  // scale-independent world anchor used by the wheel-zoom handler.
  const fractionX = r.width > 0 ? (x - r.left) / r.width : null;
  const fractionY = r.height > 0 ? (y - r.top) / r.height : null;
  // World screen-X = where (fractionX, fractionY) currently appears on screen
  const worldScreenX = r.left + (fractionX ?? 0) * r.width;
  const worldScreenY = r.top + (fractionY ?? 0) * r.height;
  // Scale source: vector viewport if active, else doc.scale from app state.
  let scale = null, viewportActive = false, mode = 'unknown';
  try {
    const vp = window.__pdfViewport;
    if (vp?.active) {
      scale = vp.zoom;
      viewportActive = true;
      mode = 'vector';
    } else {
      const stateMod = await import('./core/state.js');
      const doc = stateMod.getActiveDocument();
      scale = doc?.scale ?? null;
      mode = 'bitmap';
    }
  } catch {}
  return {
    cursor: { x, y },
    canvas: {
      left: r.left, top: r.top, width: r.width, height: r.height,
      cssWidth: pdfCanvas.style.width, cssHeight: pdfCanvas.style.height,
      bufferW: pdfCanvas.width, bufferH: pdfCanvas.height,
    },
    container: cr ? { left: cr.left, top: cr.top, width: cr.width, height: cr.height,
      scrollLeft: container.scrollLeft, scrollTop: container.scrollTop,
      clientW: container.clientWidth, clientH: container.clientHeight } : null,
    canvasContainer: ccr ? { left: ccr.left, top: ccr.top, width: ccr.width, height: ccr.height } : null,
    tile: tileBitmap ? {
      width: tileBitmap.width,
      height: tileBitmap.height,
      meta: tileMeta,
    } : null,
    scale,
    viewportActive,
    mode,
    fractionX, fractionY,
    worldScreenX, worldScreenY,
  };
}

/** Navigate the active document to a specific page (1-based). Exposed for
 *  AI-driven test setups that need a deterministic page (e.g. BARN p.2). */
async function handleGoToPage(params) {
  const pageNum = Number(params?.page);
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    return { ok: false, error: 'missing or invalid params.page (1-based integer)' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document' };
  if (pageNum > doc.pdfDoc.numPages) {
    return { ok: false, error: `page ${pageNum} out of range (doc has ${doc.pdfDoc.numPages} pages)` };
  }
  const rendererMod = await import('./pdf/renderer.js');
  await rendererMod.goToPage(pageNum);
  return { ok: true, page: pageNum };
}

async function handleMergePdf(params) {
  const filePaths = params?.filePaths;
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { ok: false, error: 'missing params.filePaths (non-empty array of PDF paths)' };
  }
  const position = ['end', 'start', 'after'].includes(params?.position) ? params.position : 'end';
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document to merge into' };
  const pagesBefore = doc.pdfDoc.numPages;
  const pm = await import('./pdf/page-manager.js');
  try {
    await pm.mergeFiles(filePaths, position);
  } catch (e) {
    return { ok: false, error: `merge failed: ${e?.message ?? e}` };
  }
  const after = stateMod.getActiveDocument();
  return {
    ok: true,
    position,
    mergedFiles: filePaths.length,
    pagesBefore,
    pagesAfter: after?.pdfDoc?.numPages ?? pagesBefore,
    filePath: after?.filePath,
  };
}

async function handleClearCaches() {
  const invoke = tauriInvoke();
  if (!invoke) return { ok: false, error: 'tauri invoke unavailable' };
  try {
    await invoke('clear_pdf_cache');
  } catch (e) {
    return { ok: false, error: `clear_pdf_cache invoke failed: ${e?.message ?? e}` };
  }
  // Also clear the JS-side ImageBitmap cache by re-importing renderer and
  // calling its export if available.
  try {
    const m = await import('./pdf/renderer.js');
    if (typeof m._clearJSBitmapCache === 'function') m._clearJSBitmapCache();
  } catch {}
  return { ok: true };
}

/** Dispatch a synthetic WheelEvent matching what the OS sends for ctrl+wheel.
 *  deltaY < 0 → zoom in (wheel up). deltaY > 0 → zoom out (wheel down).
 *  Routes through the same .main-view listener the user's wheel hits, so we
 *  exercise the actual zoom path and not some test-only shortcut. */
async function handleWheelZoom(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const deltaY = Number(params?.deltaY ?? -120); // default zoom-in (one notch)
  const ctrlKey = params?.ctrlKey !== false;     // default true
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  // Aim at .main-view (the actual wheel listener) but use elementFromPoint
  // for `target` so the event behaves like a real OS wheel event arriving
  // at whatever happens to be under the cursor.
  const mainView = document.querySelector('.main-view');
  const target = targetAt(x, y);
  if (!mainView) return { ok: false, error: '.main-view not found' };

  const wheelInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x, clientY: y,
    screenX: x, screenY: y,
    button: 0, buttons: 0,
    ctrlKey, shiftKey: false, altKey: false, metaKey: false,
    deltaX: 0, deltaY, deltaZ: 0,
    deltaMode: 0, // 0 = pixel
  };
  const ev = new WheelEvent('wheel', wheelInit);
  // Dispatch from `target` so e.target / closest('canvas') match real OS
  // behavior; the event bubbles up to .main-view which has the listener.
  target.dispatchEvent(ev);
  return {
    ok: true, x, y, deltaY, ctrlKey,
    target: describeTarget(target),
  };
}

/** One full anchor-accuracy probe.
 *  1. Snapshot pre-zoom state at (x, y).
 *  2. Dispatch a ctrl+wheel event at (x, y).
 *  3. Wait for renderPage to settle.
 *  4. Snapshot post-zoom state.
 *  5. Report the displacement of the world-point that started under the cursor.
 *
 *  Anchor-error formula:
 *    Pre-zoom worldFraction = (x - pre.canvas.left) / pre.canvas.width
 *    Post-zoom worldScreenX = post.canvas.left + worldFraction * post.canvas.width
 *    error = worldScreenX - x   (in CSS px; |error| > ~3 = visible spring)
 */
async function handleZoomAnchorTest(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  const direction = params?.direction === 'out' ? +1 : -1; // -1 → zoom in by default
  const deltaY = direction * 120;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const pre = await _captureCanvasState(x, y);
  if (!pre || pre.canvas.width <= 0) {
    return { ok: false, error: 'pre-snapshot failed (canvas missing/zero-size)' };
  }
  // Dispatch the wheel event the same way the OS would.
  await handleWheelZoom({ x, y, deltaY, ctrlKey: true });
  // Wait for the in-flight renderPage to fully complete (counter back to 0).
  const idle = await _waitForRenderIdle(6000);
  // Capture post-zoom state.
  const post = await _captureCanvasState(x, y);
  if (!post) return { ok: false, error: 'post-snapshot failed', pre, idle };

  // Compute anchor error using pre-zoom worldFraction.
  const fractionX = pre.fractionX;
  const fractionY = pre.fractionY;
  const expectedScreenX = post.canvas.left + (fractionX ?? 0) * post.canvas.width;
  const expectedScreenY = post.canvas.top + (fractionY ?? 0) * post.canvas.height;
  const anchorErrorX = expectedScreenX - x;
  const anchorErrorY = expectedScreenY - y;
  const anchorErrorPx = Math.sqrt(anchorErrorX * anchorErrorX + anchorErrorY * anchorErrorY);

  return {
    ok: true,
    idle,
    pre,
    post,
    fractionX,
    fractionY,
    expectedScreenX,
    expectedScreenY,
    anchorErrorX,
    anchorErrorY,
    anchorErrorPx,
    // Pass-fail threshold: < 3 CSS px = imperceptible, < 8 = acceptable
    pass: anchorErrorPx < 3,
    acceptable: anchorErrorPx < 8,
  };
}

// ─── App control: tools, annotations, tabs, view, measurement scale ──────
//
// These handlers expose the remaining app surface to MCP clients so an
// external harness can script the editor end-to-end (draw annotations,
// manage tabs, save, change view mode) without synthetic mouse input.
// Same conventions as the handlers above: all app modules are imported
// lazily inside the handler, and every handler resolves to
// { ok: true, ... } or { ok: false, error } — never throws upward.

/** Redraw the annotation layer for the active document (single/continuous). */
async function _redrawActive() {
  const stateMod = await import('./core/state.js');
  const rendering = await import('./annotations/rendering.js');
  if (stateMod.getActiveDocument()?.viewMode === 'continuous') rendering.redrawContinuous();
  else rendering.redrawAnnotations();
}

function _isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True when `arr` is an array of at least `min` {x, y} points. */
function _validPoints(arr, min) {
  return Array.isArray(arr) && arr.length >= min &&
    arr.every(p => p && _isNum(p.x) && _isNum(p.y));
}

/** Plain-JSON deep copy of an annotation: drops functions, DOM/canvas/host
 *  objects and circular references so the result always serializes over IPC. */
function _sanitizeAnnotation(ann) {
  const seen = new WeakSet();
  return JSON.parse(JSON.stringify(ann, (key, value) => {
    if (typeof value === 'function') return undefined;
    if (typeof value === 'object' && value !== null) {
      const tag = Object.prototype.toString.call(value);
      // Keep plain objects/arrays; drop canvases, bitmaps, DOM nodes, etc.
      if (tag !== '[object Object]' && tag !== '[object Array]') return undefined;
      if (seen.has(value)) return undefined; // circular guard
      seen.add(value);
    }
    return value;
  }));
}

/** Compact one-line summary used by app_list_annotations. */
function _summarizeAnnotation(a) {
  const s = { id: a.id, type: a.type, page: a.page ?? 1 };
  if (_isNum(a.x)) { s.x = a.x; s.y = a.y; }
  if (_isNum(a.width)) { s.width = a.width; s.height = a.height; }
  if (_isNum(a.startX)) {
    s.startX = a.startX; s.startY = a.startY;
    s.endX = a.endX; s.endY = a.endY;
  }
  const pts = a.points || a.path || a.controlPoints;
  if (Array.isArray(pts)) s.pointCount = pts.length;
  if (a.color != null) s.color = a.color;
  if (a.fillColor != null) s.fillColor = a.fillColor;
  if (typeof a.text === 'string' && a.text) {
    s.text = a.text.length > 200 ? a.text.slice(0, 200) + '…' : a.text;
  }
  if (a.measureText) s.measureText = a.measureText;
  if (a.scaleString) s.scaleString = a.scaleString;
  if (a.locked) s.locked = true;
  return s;
}

/** Refresh measureText/measureValue/measureUnit (plus measurePixels for
 *  distances) from the annotation's own geometry and the position-aware
 *  document scale. An explicit caller-provided measureText is preserved. */
function _recomputeMeasureFields(ann, meas, userProps = {}) {
  const keepText = typeof userProps.measureText === 'string';
  if (ann.type === 'measureDistance') {
    const d = meas.calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, ann.page);
    ann.measureValue = d.value;
    ann.measureUnit = d.unit;
    ann.measurePixels = d.pixels;
    if (!keepText) ann.measureText = meas.formatMeasurement(d);
  } else if (ann.type === 'measureArea') {
    const a = meas.calculateArea(ann.points, ann.holes, ann.page);
    ann.measureValue = a.value;
    ann.measureUnit = a.unit;
    if (!keepText) ann.measureText = meas.formatMeasurement(a);
  } else if (ann.type === 'measurePerimeter') {
    const p = meas.calculatePerimeter(ann.points, ann.page);
    ann.measureValue = p.value;
    ann.measureUnit = p.unit;
    if (!keepText) ann.measureText = meas.formatMeasurement(p);
  }
}

async function handleSetTool(params) {
  const tool = params?.tool;
  if (typeof tool !== 'string' || !tool) {
    return { ok: false, error: 'missing or invalid params.tool' };
  }
  const stateMod = await import('./core/state.js');
  const registryMod = await import('./tools/tool-registry.js');
  const typeRegistryMod = await import('./plugins/annotation-type-registry.js');
  const known = registryMod.getTool(tool) != null ||
                typeRegistryMod.getAnnotationType(tool) != null;
  if (!known) {
    return { ok: false, error: `unknown tool: ${tool}` };
  }
  const managerMod = await import('./tools/manager.js');
  managerMod.setTool(tool);
  // setTool can refuse the switch (PDF/A read-only) — report what actually
  // became active so the client never has to guess.
  return { ok: true, requested: tool, current: stateMod.state.currentTool };
}

async function handleGetCurrentTool() {
  const stateMod = await import('./core/state.js');
  return { ok: true, tool: stateMod.state.currentTool };
}

/** Build the default props object for one annotation type. Mirrors the field
 *  names the interactive tools produce (see tools/annotation-creators.js and
 *  the per-tool modules) so MCP-created annotations are indistinguishable
 *  from hand-drawn ones. Returns { base, measure?, scaleRegion? } on success
 *  or { error } when required geometry is missing. */
async function _buildCreateProps(type, page, props) {
  const stateMod = await import('./core/state.js');
  const prefs = stateMod.state.preferences || {};
  const p = props || {};

  const needRect = () =>
    (_isNum(p.x) && _isNum(p.y) && _isNum(p.width) && _isNum(p.height) && p.width > 0 && p.height > 0)
      ? null : { error: `type '${type}' requires numeric props x, y, width > 0, height > 0` };
  const needLine = () =>
    (_isNum(p.startX) && _isNum(p.startY) && _isNum(p.endX) && _isNum(p.endY))
      ? null : { error: `type '${type}' requires numeric props startX, startY, endX, endY` };
  const validHoles = () =>
    p.holes == null || (Array.isArray(p.holes) && p.holes.every(r => _validPoints(r, 3)));

  switch (type) {
    // Rect- and line-based shapes reuse the interactive creator so style
    // defaults stay in lock-step with what hand-drawing produces.
    case 'line':
    case 'arrow':
    case 'wall':
    case 'box':
    case 'mask':
    case 'redaction':
    case 'viewport':
    case 'circle':
    case 'highlight':
    case 'cloud':
    case 'polygon':
    case 'textbox': {
      const lineLike = type === 'line' || type === 'arrow' || type === 'wall';
      const bad = lineLike ? needLine() : needRect();
      if (bad) return bad;
      const creators = await import('./tools/annotation-creators.js');
      const base = lineLike
        ? creators.buildAnnotationProps(type, p.startX, p.startY, p.endX, p.endY, null)
        : creators.buildAnnotationProps(type, p.x, p.y, p.x + p.width, p.y + p.height, null);
      if (!base) return { error: `could not build '${type}' props` };
      return { base };
    }

    case 'polyline': {
      if (!_validPoints(p.points, 2)) {
        return { error: "type 'polyline' requires props.points: [{x,y}, ...] (>= 2)" };
      }
      return { base: {
        type, page,
        points: p.points.map(pt => ({ ...pt })),
        color: prefs.polylineStrokeColor || '#000000',
        strokeColor: prefs.polylineStrokeColor || '#000000',
        lineWidth: prefs.polylineLineWidth || 1,
        opacity: (prefs.polylineOpacity || 100) / 100,
      } };
    }

    case 'cloudPolyline': {
      if (!_validPoints(p.points, 2)) {
        return { error: "type 'cloudPolyline' requires props.points: [{x,y}, ...] (>= 2)" };
      }
      return { base: {
        type, page,
        points: p.points.map(pt => ({ ...pt })),
        color: prefs.cloudStrokeColor || prefs.polylineStrokeColor || '#000000',
        strokeColor: prefs.cloudStrokeColor || prefs.polylineStrokeColor || '#000000',
        lineWidth: prefs.cloudLineWidth || prefs.polylineLineWidth || 1,
        opacity: (prefs.cloudOpacity || 100) / 100,
      } };
    }

    case 'spline': {
      const pts = p.controlPoints || p.points;
      if (!_validPoints(pts, 3)) {
        return { error: "type 'spline' requires props.controlPoints (or points): [{x,y}, ...] (>= 3)" };
      }
      return { base: {
        type, page,
        controlPoints: pts.map(pt => ({ ...pt })),
        color: prefs.lineStrokeColor || '#000000',
        strokeColor: prefs.lineStrokeColor || '#000000',
        lineWidth: prefs.lineLineWidth || 1,
        opacity: (prefs.lineOpacity ?? 100) / 100,
      } };
    }

    case 'draw': {
      const pts = p.path || p.points;
      if (!_validPoints(pts, 2)) {
        return { error: "type 'draw' requires props.path (or points): [{x,y}, ...] (>= 2)" };
      }
      return { base: {
        type, page,
        path: pts.map(pt => ({ ...pt })),
        color: prefs.drawStrokeColor || '#000000',
        strokeColor: prefs.drawStrokeColor || '#000000',
        lineWidth: prefs.drawLineWidth || 2,
        opacity: (prefs.drawOpacity || 100) / 100,
      } };
    }

    case 'filledArea': {
      if (!_validPoints(p.points, 3)) {
        return { error: "type 'filledArea' requires props.points: [{x,y}, ...] (>= 3)" };
      }
      if (!validHoles()) {
        return { error: 'props.holes must be an array of point rings ([{x,y}, ...] each >= 3)' };
      }
      const pts = p.points.map(pt => ({ ...pt }));
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
      const base = {
        type, page,
        points: pts,
        color: prefs.filledAreaStrokeColor || '#000000',
        strokeColor: prefs.filledAreaStrokeColor || '#000000',
        fillColor: prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc'),
        lineWidth: prefs.filledAreaLineWidth ?? 1,
        borderStyle: prefs.filledAreaBorderStyle || 'solid',
        opacity: (prefs.filledAreaOpacity ?? 100) / 100,
        hatchPattern: prefs.filledAreaHatchPattern || 'none',
        hatchColor: prefs.filledAreaHatchColor || '#000000',
        hatchScale: prefs.filledAreaHatchScale ?? 100,
        hatchAngle: prefs.filledAreaHatchAngle ?? 0,
        // Bounding box for selection helpers.
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      if (Array.isArray(p.holes) && p.holes.length > 0) base.holes = p.holes;
      return { base };
    }

    case 'count': {
      if (!_isNum(p.x) || !_isNum(p.y)) {
        return { error: "type 'count' requires numeric props x, y" };
      }
      return { base: {
        type, page,
        x: p.x, y: p.y,
        categoryId: typeof p.categoryId === 'string' ? p.categoryId : null,
        number: _isNum(p.number) ? p.number : 1,
        markerStyle: p.markerStyle === 'symbol' ? 'symbol' : 'dot',
        symbolId: typeof p.symbolId === 'string' ? p.symbolId : undefined,
        color: p.color || '#e11d48',
        strokeColor: p.color || '#e11d48',
        opacity: 1,
      } };
    }

    case 'comment': {
      if (!_isNum(p.x) || !_isNum(p.y)) {
        return { error: "type 'comment' requires numeric props x, y" };
      }
      return { base: {
        type, page,
        x: p.x, y: p.y, width: 24, height: 24,
        text: typeof p.text === 'string' ? p.text : '',
        color: prefs.commentColor || '#FFFF00',
        fillColor: prefs.commentColor || '#FFFF00',
        icon: prefs.commentIcon || 'comment',
      } };
    }

    case 'callout': {
      const bad = needRect();
      if (bad) return bad;
      // Arrow tip defaults to the left of the box; knee/arm follow the same
      // geometry the interactive callout creator computes.
      const arrowX = _isNum(p.arrowX) ? p.arrowX : p.x - 40;
      const arrowY = _isNum(p.arrowY) ? p.arrowY : p.y + p.height / 2;
      const isLeft = arrowX < p.x + p.width / 2;
      const armOriginX = isLeft ? p.x : p.x + p.width;
      const armOriginY = Math.max(p.y, Math.min(p.y + p.height, arrowY));
      const armLength = Math.min(30, Math.abs(arrowX - armOriginX) * 0.4);
      const kneeX = isLeft ? armOriginX - armLength : armOriginX + armLength;
      return { base: {
        type, page,
        x: p.x, y: p.y, width: p.width, height: p.height,
        arrowX, arrowY, kneeX, kneeY: armOriginY, armOriginX, armOriginY,
        text: typeof p.text === 'string' ? p.text : '',
        color: prefs.calloutStrokeColor || '#000000',
        strokeColor: prefs.calloutStrokeColor || '#000000',
        fillColor: prefs.calloutFillNone ? 'none' : (prefs.calloutFillColor || '#ffffff'),
        textColor: '#000000',
        fontSize: prefs.calloutFontSize || 12,
        fontFamily: 'Arial',
        lineWidth: prefs.calloutBorderWidth || 1,
        borderStyle: prefs.calloutBorderStyle || 'solid',
        opacity: (prefs.calloutOpacity || 100) / 100,
      } };
    }

    case 'measureDistance': {
      const bad = needLine();
      if (bad) return bad;
      return { base: {
        type, page,
        startX: p.startX, startY: p.startY, endX: p.endX, endY: p.endY,
        color: prefs.measureDistStrokeColor || '#ff0000',
        strokeColor: prefs.measureDistStrokeColor || '#ff0000',
        lineWidth: prefs.measureDistLineWidth || 1,
        borderStyle: prefs.measureDistBorderStyle || 'solid',
        opacity: (prefs.measureDistOpacity || 100) / 100,
      }, measure: true };
    }

    case 'measureArea': {
      if (!_validPoints(p.points, 3)) {
        return { error: "type 'measureArea' requires props.points: [{x,y}, ...] (>= 3)" };
      }
      if (!validHoles()) {
        return { error: 'props.holes must be an array of point rings ([{x,y}, ...] each >= 3)' };
      }
      const base = {
        type, page,
        points: p.points.map(pt => ({ ...pt })),
        color: prefs.measureAreaStrokeColor || '#ff0000',
        strokeColor: prefs.measureAreaStrokeColor || '#ff0000',
        lineWidth: prefs.measureAreaLineWidth || 1,
        opacity: (prefs.measureAreaOpacity || 100) / 100,
        fillColor: prefs.measureAreaFillNone ? null : (prefs.measureAreaFillColor || null),
        borderStyle: prefs.measureAreaBorderStyle || 'dashed',
        hatchPattern: prefs.measureAreaHatchPattern || 'diagonal-left',
        hatchColor: prefs.measureAreaHatchColor || '#ff0000',
        hatchScale: prefs.measureAreaHatchScale ?? 100,
      };
      if (Array.isArray(p.holes) && p.holes.length > 0) base.holes = p.holes;
      return { base, measure: true };
    }

    case 'measurePerimeter': {
      if (!_validPoints(p.points, 2)) {
        return { error: "type 'measurePerimeter' requires props.points: [{x,y}, ...] (>= 2)" };
      }
      return { base: {
        type, page,
        points: p.points.map(pt => ({ ...pt })),
        color: prefs.measurePerimStrokeColor || '#ff0000',
        strokeColor: prefs.measurePerimStrokeColor || '#ff0000',
        lineWidth: prefs.measurePerimLineWidth || 1,
        opacity: (prefs.measurePerimOpacity || 100) / 100,
        borderStyle: prefs.measurePerimBorderStyle || 'dashed',
        startHead: prefs.measurePerimStartHead || 'none',
        endHead: prefs.measurePerimEndHead || 'none',
        headSize: prefs.measurePerimHeadSize || 12,
      }, measure: true };
    }

    case 'scaleRegion': {
      const bad = needRect();
      if (bad) return bad;
      return { base: {
        type, page,
        x: p.x, y: p.y, width: p.width, height: p.height,
        scaleString: p.scaleString || '1:100',
        units: p.units || 'mm',
        label: p.label || '',
        color: p.color || '#ff9800',
        lineWidth: 1.5,
        borderStyle: 'dashed',
        opacity: 1,
      }, scaleRegion: true };
    }

    case 'stamp':
    case 'signature':
    case 'image': {
      // Test/automation path: rect + optional SVG payload, passthrough.
      const bad = needRect();
      if (bad) return bad;
      return { base: {
        type, page,
        x: p.x, y: p.y, width: p.width, height: p.height,
        stampSvg: p.stampSvg || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="black"/></svg>',
        stampName: p.stampName || 'Stamp',
        color: p.color || '#000000',
        rotation: p.rotation || 0,
        opacity: 1,
      } };
    }

    case 'comment':
    case 'text': {
      if (!(_isNum(p.x) && _isNum(p.y))) {
        return { error: `type '${type}' requires numeric props.x/y` };
      }
      return { base: {
        type, page,
        x: p.x, y: p.y,
        text: p.text || 'Tekst',
        color: p.color || '#000000',
        fontSize: p.fontSize || 12,
        opacity: 1,
      } };
    }

    case 'parametricSymbol': {
      if (typeof p.symbolId !== 'string' || !p.symbolId) {
        return { error: "type 'parametricSymbol' requires props.symbolId (template id)" };
      }
      const reg = await import('./symbols/registry.js');
      const tpl = reg.getTemplate(p.symbolId);
      if (!tpl) return { error: `unknown template: ${p.symbolId}` };
      const params = { ...reg.defaultParams(tpl), ...(p.params || {}) };
      // Bbox: explicit rect wins; otherwise real-world size at (x,y) centre
      // (steel profiles), falling back to the template's defaultSize.
      let rect;
      if (_isNum(p.x) && _isNum(p.y) && _isNum(p.width) && _isNum(p.height) && p.width > 0 && p.height > 0) {
        rect = { x: p.x, y: p.y, width: p.width, height: p.height };
      } else if (_isNum(p.x) && _isNum(p.y)) {
        const rs = await import('./symbols/real-size.js');
        const mm = typeof tpl.realSizeMm === 'function' ? tpl.realSizeMm(params) : null;
        if (mm && mm.height > 0) {
          const k = rs.pxPerMmAt(page, p.x, p.y);
          const hPx = mm.height * k;
          const wPx = mm.width > 0 ? mm.width * k : hPx * 4; // free-length beam
          rect = { x: p.x - wPx / 2, y: p.y - hPx / 2, width: wPx, height: hPx };
        } else {
          const ds = tpl.defaultSize || { width: 80, height: 80 };
          rect = { x: p.x, y: p.y, width: ds.width, height: ds.height };
        }
      } else {
        return { error: "type 'parametricSymbol' requires props.x, y (insert point) or a full x/y/width/height rect" };
      }
      return { base: {
        type, page,
        ...rect,
        symbolId: p.symbolId,
        params,
        color: p.color || '#000000',
        strokeColor: p.strokeColor || p.color || '#000000',
        lineWidth: _isNum(p.lineWidth) ? p.lineWidth : 1,
        rotation: _isNum(p.rotation) ? p.rotation : 0,
        opacity: _isNum(p.opacity) ? p.opacity : 1,
      } };
    }

    default:
      return { error: `unsupported annotation type: ${type}` };
  }
}

async function handleCreateAnnotation(params) {
  const type = params?.type;
  if (typeof type !== 'string' || !type) {
    return { ok: false, error: 'missing or invalid params.type' };
  }
  const props = (params?.props && typeof params.props === 'object' && !Array.isArray(params.props))
    ? params.props : {};
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document' };

  // Page: top-level param wins, then props.page, then the current page.
  let page = doc.currentPage || 1;
  const pageArg = params?.page ?? props.page;
  if (pageArg != null) {
    page = Number(pageArg);
    const numPages = doc.pdfDoc?.numPages ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > numPages) {
      return { ok: false, error: `page ${pageArg} out of range (doc has ${numPages} pages)` };
    }
  }

  const built = await _buildCreateProps(type, page, props);
  if (built.error) return { ok: false, error: built.error };

  // Caller props win over tool defaults; type and the page param are pinned.
  const merged = { ...built.base, ...props, type, page };
  // parametricSymbol without an explicit rect: (x,y) was an INSERT POINT —
  // the builder centred a real-size bbox on it. Keep that computed bbox
  // instead of letting the raw x/y overwrite it as a top-left corner.
  if (type === 'parametricSymbol' && !(_isNum(props.width) && _isNum(props.height))) {
    merged.x = built.base.x;
    merged.y = built.base.y;
    merged.width = built.base.width;
    merged.height = built.base.height;
  }
  const factory = await import('./annotations/factory.js');
  const meas = await import('./annotations/measurement.js');
  const ann = factory.createAnnotation(merged);
  if (built.measure) {
    // Compute measureText/value from geometry + the scale at the target page
    // BEFORE the undo snapshot so redo restores a complete annotation.
    _recomputeMeasureFields(ann, meas, props);
  }

  doc.annotations.push(ann);
  const undoMod = await import('./core/undo-manager.js');
  undoMod.recordAdd(ann);

  if (built.scaleRegion) {
    // A new scale region changes the effective scale for everything inside
    // it — refresh all measurements (this also redraws).
    const srMod = await import('./annotations/scale-region.js');
    srMod.invalidateScaleRegionCache();
    meas.recalculateAllMeasurements();
  } else {
    await _redrawActive();
  }

  return { ok: true, id: ann.id, annotation: _summarizeAnnotation(ann) };
}

async function handleListAnnotations(params) {
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  let anns = doc.annotations || [];
  if (params?.page != null) {
    const page = Number(params.page);
    if (!Number.isInteger(page) || page < 1) {
      return { ok: false, error: 'invalid params.page (1-based integer)' };
    }
    anns = anns.filter(a => (a.page ?? 1) === page);
  }
  return { ok: true, count: anns.length, annotations: anns.map(_summarizeAnnotation) };
}

async function handleGetAnnotation(params) {
  const id = params?.id;
  if (typeof id !== 'string' || !id) {
    return { ok: false, error: 'missing or invalid params.id' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  const ann = (doc.annotations || []).find(a => a.id === id);
  if (!ann) return { ok: false, error: `annotation not found: ${id}` };
  return { ok: true, annotation: _sanitizeAnnotation(ann) };
}

// Keys that change an annotation's shape — used to decide whether a patch
// must trigger a measurement recompute / scale-region cache flush.
const _GEOMETRY_KEYS = [
  'x', 'y', 'width', 'height',
  'startX', 'startY', 'endX', 'endY',
  'points', 'holes', 'path', 'controlPoints',
];

async function handleUpdateAnnotation(params) {
  const id = params?.id;
  if (typeof id !== 'string' || !id) {
    return { ok: false, error: 'missing or invalid params.id' };
  }
  const props = params?.props;
  if (!props || typeof props !== 'object' || Array.isArray(props) || Object.keys(props).length === 0) {
    return { ok: false, error: 'missing or empty params.props' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  const ann = (doc.annotations || []).find(a => a.id === id);
  if (!ann) return { ok: false, error: `annotation not found: ${id}` };

  const factory = await import('./annotations/factory.js');
  const oldState = factory.cloneAnnotation(ann);

  // id and type are immutable — silently drop them from the patch.
  const { id: _id, type: _type, ...patch } = props;
  Object.assign(ann, patch);
  ann.modifiedAt = new Date().toISOString();

  const geometryTouched = _GEOMETRY_KEYS.some(k => k in patch);
  const meas = await import('./annotations/measurement.js');
  const isMeasure = ann.type === 'measureDistance' ||
                    ann.type === 'measureArea' ||
                    ann.type === 'measurePerimeter';
  if (isMeasure && geometryTouched) {
    _recomputeMeasureFields(ann, meas, patch);
  }

  const undoMod = await import('./core/undo-manager.js');
  undoMod.recordModify(ann.id, oldState, ann);

  if (ann.type === 'scaleRegion' &&
      (geometryTouched || 'scaleString' in patch || 'units' in patch)) {
    // Region bounds/scale changed → measurements inside must follow.
    const srMod = await import('./annotations/scale-region.js');
    srMod.invalidateScaleRegionCache();
    meas.recalculateAllMeasurements(); // also redraws
  } else {
    await _redrawActive();
  }

  // Keep the properties panel in sync when the patched annotation is selected.
  if (doc.selectedAnnotation && doc.selectedAnnotation.id === ann.id) {
    try {
      const panel = await import('./ui/panels/properties-panel.js');
      panel.showProperties(ann);
    } catch { /* panel refresh is best-effort */ }
  }

  return { ok: true, id: ann.id, annotation: _sanitizeAnnotation(ann) };
}

async function handleDeleteAnnotation(params) {
  const id = params?.id;
  if (typeof id !== 'string' || !id) {
    return { ok: false, error: 'missing or invalid params.id' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  const index = (doc.annotations || []).findIndex(a => a.id === id);
  if (index === -1) return { ok: false, error: `annotation not found: ${id}` };

  const ann = doc.annotations[index];
  doc.annotations.splice(index, 1);
  const undoMod = await import('./core/undo-manager.js');
  undoMod.recordDelete(ann, index);

  // Drop it from the selection so the panel doesn't show a dead annotation.
  doc.selectedAnnotations = (doc.selectedAnnotations || []).filter(a => a.id !== id);
  if (doc.selectedAnnotation?.id === id) {
    doc.selectedAnnotation = doc.selectedAnnotations[0] ?? null;
    if (!doc.selectedAnnotation) {
      try {
        const panel = await import('./ui/panels/properties-panel.js');
        panel.hideProperties();
      } catch { /* best-effort */ }
    }
  }

  if (ann.type === 'scaleRegion') {
    const srMod = await import('./annotations/scale-region.js');
    const meas = await import('./annotations/measurement.js');
    srMod.invalidateScaleRegionCache();
    meas.recalculateAllMeasurements(); // also redraws
  } else {
    await _redrawActive();
  }
  return { ok: true, id, deletedType: ann.type };
}

async function handleSelectAnnotation(params) {
  const id = params?.id;
  if (typeof id !== 'string' || !id) {
    return { ok: false, error: 'missing or invalid params.id' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  const ann = (doc.annotations || []).find(a => a.id === id);
  if (!ann) return { ok: false, error: `annotation not found: ${id}` };

  doc.selectedAnnotations = [ann];
  doc.selectedAnnotation = ann;
  try {
    const panel = await import('./ui/panels/properties-panel.js');
    panel.showProperties(ann);
  } catch { /* panel is best-effort */ }
  await _redrawActive();
  return { ok: true, id, type: ann.type, page: ann.page };
}

async function handleClearSelection() {
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  stateMod.clearSelection();
  try {
    const panel = await import('./ui/panels/properties-panel.js');
    panel.hideProperties();
  } catch { /* best-effort */ }
  await _redrawActive();
  return { ok: true };
}

async function handleUndo() {
  const undoMod = await import('./core/undo-manager.js');
  if (!undoMod.canUndo()) return { ok: false, error: 'nothing to undo' };
  await undoMod.undo();
  return { ok: true, canUndo: undoMod.canUndo(), canRedo: undoMod.canRedo() };
}

async function handleRedo() {
  const undoMod = await import('./core/undo-manager.js');
  if (!undoMod.canRedo()) return { ok: false, error: 'nothing to redo' };
  await undoMod.redo();
  return { ok: true, canUndo: undoMod.canUndo(), canRedo: undoMod.canRedo() };
}

async function handleListTabs() {
  const stateMod = await import('./core/state.js');
  const docs = stateMod.state.documents || [];
  return {
    ok: true,
    activeIndex: stateMod.state.activeDocumentIndex,
    tabs: docs.map((d, i) => ({
      index: i,
      fileName: d.fileName ?? null,
      filePath: d.filePath ?? null,
      modified: !!d.modified,
      active: i === stateMod.state.activeDocumentIndex,
      pageCount: d.pdfDoc?.numPages ?? 0,
      isUntitled: !!d.isUntitled,
      currentPage: d.currentPage ?? null,
      annotationCount: (d.annotations || []).length,
    })),
  };
}

async function handleSwitchTab(params) {
  const index = Number(params?.index);
  const stateMod = await import('./core/state.js');
  const total = stateMod.state.documents.length;
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    return { ok: false, error: `index out of range (have ${total} tabs)` };
  }
  const tabsMod = await import('./ui/chrome/tabs.js');
  tabsMod.switchToTab(index);
  return { ok: true, activeIndex: stateMod.state.activeDocumentIndex };
}

async function handleCloseTab(params) {
  const index = Number(params?.index);
  const force = params?.force === true;
  const stateMod = await import('./core/state.js');
  const docs = stateMod.state.documents;
  if (!Number.isInteger(index) || index < 0 || index >= docs.length) {
    return { ok: false, error: `index out of range (have ${docs.length} tabs)` };
  }
  // Headless guard: closing a modified document without force would pop the
  // save/discard dialog and stall the bridge. Make the caller decide instead.
  if (docs[index].modified && !force) {
    return { ok: false, error: 'document has unsaved changes — pass force:true to discard, or save first' };
  }
  const tabsMod = await import('./ui/chrome/tabs.js');
  // Always force here: the unsaved-changes policy was already enforced above.
  const closed = await tabsMod.closeTab(index, true);
  if (!closed) return { ok: false, error: 'closeTab refused' };
  return { ok: true, remainingTabs: stateMod.state.documents.length };
}

async function handleNewBlankPdf(params) {
  const widthPt = Number(params?.widthPt);
  const heightPt = Number(params?.heightPt);
  const pages = params?.pages != null ? Number(params.pages) : 1;
  if (!Number.isFinite(widthPt) || widthPt <= 0 || !Number.isFinite(heightPt) || heightPt <= 0) {
    return { ok: false, error: 'missing or invalid params.widthPt/heightPt (PDF points, > 0)' };
  }
  if (!Number.isInteger(pages) || pages < 1) {
    return { ok: false, error: 'invalid params.pages (integer >= 1)' };
  }
  const loaderMod = await import('./pdf/loader.js');
  try {
    await loaderMod.createBlankPDF(widthPt, heightPt, pages);
  } catch (e) {
    return { ok: false, error: `createBlankPDF: ${e?.message ?? e}` };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  return {
    ok: true,
    tabIndex: stateMod.state.activeDocumentIndex,
    fileName: doc?.fileName ?? null,
    pageCount: doc?.pdfDoc?.numPages ?? pages,
  };
}

async function handleSavePdf(params) {
  const path = (typeof params?.path === 'string' && params.path) ? params.path : null;
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document' };
  if (!path && (!doc.filePath || doc.isUntitled)) {
    // savePDF() without a real path falls through to the Save As file picker
    // — never acceptable on a headless bridge. The caller must supply a path.
    return { ok: false, error: 'document has no saved file path — pass params.path' };
  }
  const invoke = tauriInvoke();
  if (path && invoke) {
    // Grant FS scope for arbitrary target paths (same mechanism as open).
    try { await invoke('allow_fs_scope', { path }); } catch { /* best-effort */ }
  }
  const saverMod = await import('./pdf/saver.js');
  let success;
  try {
    success = await saverMod.savePDF(path);
  } catch (e) {
    return { ok: false, error: `savePDF: ${e?.message ?? e}` };
  }
  if (!success) return { ok: false, error: 'savePDF reported failure' };
  return { ok: true, path: path || doc.filePath };
}

async function handleSetViewMode(params) {
  const mode = params?.mode;
  // 'book' = boekweergave (doorlopende 2-op-1 spreads) — intern een continuous-
  // variant met bookSpread=true. 'facing' = twee pagina's naast elkaar als één
  // spread tegelijk, niet-doorlopend (facingSpread=true). Zie renderer.setViewMode.
  if (mode !== 'single' && mode !== 'continuous' && mode !== 'book' && mode !== 'facing') {
    return { ok: false, error: "params.mode must be 'single', 'continuous', 'book' or 'facing'" };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document' };
  const rendererMod = await import('./pdf/renderer.js');
  try {
    await rendererMod.setViewMode(mode);
  } catch (e) {
    return { ok: false, error: `setViewMode: ${e?.message ?? e}` };
  }
  // bookSpread/facingSpread meegeven zodat een client 'book'/'facing' van
  // 'continuous' kan onderscheiden.
  return { ok: true, viewMode: doc.viewMode, bookSpread: !!doc.bookSpread, facingSpread: !!doc.facingSpread };
}

async function handleFitPage() {
  const stateMod = await import('./core/state.js');
  if (!stateMod.getActiveDocument()?.pdfDoc) return { ok: false, error: 'no active document' };
  const rendererMod = await import('./pdf/renderer.js');
  try {
    await rendererMod.fitPage();
  } catch (e) {
    return { ok: false, error: `fitPage: ${e?.message ?? e}` };
  }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleFitWidth() {
  const stateMod = await import('./core/state.js');
  if (!stateMod.getActiveDocument()?.pdfDoc) return { ok: false, error: 'no active document' };
  const rendererMod = await import('./pdf/renderer.js');
  try {
    await rendererMod.fitWidth();
  } catch (e) {
    return { ok: false, error: `fitWidth: ${e?.message ?? e}` };
  }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleGetPageCount() {
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, error: 'no active document' };
  return { ok: true, pageCount: doc.pdfDoc.numPages, currentPage: doc.currentPage ?? 1 };
}

async function handleSetMeasureScale(params) {
  const pixelsPerUnit = Number(params?.pixelsPerUnit);
  const unit = params?.unit;
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    return { ok: false, error: 'missing or invalid params.pixelsPerUnit (> 0)' };
  }
  if (typeof unit !== 'string' || !unit) {
    return { ok: false, error: 'missing or invalid params.unit' };
  }
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc) return { ok: false, error: 'no active document' };
  doc.measureScale = { pixelsPerUnit, unit, method: 'manual', scaleRatio: 0 };
  const meas = await import('./annotations/measurement.js');
  meas.saveDocumentScale();
  meas.recalculateAllMeasurements(); // refreshes measureText everywhere + redraws
  return { ok: true, measureScale: { pixelsPerUnit, unit } };
}

/** Ask the OpenAEC AI-server — lets an MCP client test the assistant
 *  end-to-end without driving the chat UI.
 *
 *  Used to call api.anthropic.com with a personal key from localStorage, set
 *  via a 🔑 field in the panel. That field is gone (the server handles this
 *  now, metered against the user's credits), so nothing could set the key any
 *  more and this tool would always have failed. It now takes the same path as
 *  the panel: POST /v1/chat over ai_fetch, requiring an OpenAEC sign-in. */
async function handleAiComplete(params) {
  const prompt = params?.prompt;
  if (typeof prompt !== 'string' || !prompt) return { ok: false, error: 'missing params.prompt' };
  const { askAiServer, isSignedIn } = await import('./services/ai-client.js');
  if (!(await isSignedIn())) return { ok: false, error: 'not signed in to OpenAEC' };
  try {
    const text = await askAiServer({ action: 'chat', text: prompt });
    return { ok: true, via: 'openaec-ai-server', text };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), code: e?.code ?? null };
  }
}

/** Accounts sign-in state — deactivated (cloud accounts feature removed from
 *  this build). Reports signed-out so external MCP clients degrade gracefully. */
async function handleAccountsStatus() {
  return { ok: true, signedIn: false, user: null, brand: null, unavailable: true };
}

/** Authenticated accounts API call — deactivated (cloud accounts feature removed
 *  from this build). */
async function handleAccountsFetch() {
  return { ok: false, error: 'accounts feature not available in this build' };
}

/** Assistant relay — submit a user message programmatically (app_assistant_ask). */
async function handleAssistantAsk(params) {
  const text = params?.text;
  if (typeof text !== 'string' || !text) return { ok: false, error: 'missing params.text' };
  const relay = await import('./assistant-mcp-relay.js');
  return relay.submitAssistantMessage(text);
}

/** Assistant relay — take the oldest question awaiting an MCP answer. */
async function handleAssistantPending() {
  const relay = await import('./assistant-mcp-relay.js');
  return relay.takePendingQuestion();
}

/** Assistant relay — answer a pending question; it appears in the chat window. */
async function handleAssistantAnswer(params) {
  const id = params?.id;
  const text = params?.text;
  if (!id || typeof text !== 'string') return { ok: false, error: 'need params.id and params.text' };
  const relay = await import('./assistant-mcp-relay.js');
  return relay.answerAssistantQuestion(id, text);
}

/** Assistant relay — read the current conversation (verify delivery). */
async function handleAssistantHistory() {
  const relay = await import('./assistant-mcp-relay.js');
  return relay.getAssistantMessages();
}

/** Return take-off totals for a named schedule (or all schedules). Numeric
 *  columns are summed into grand totals and per-group subtotals; image
 *  columns are reported as counts, never as data-URLs. */
async function handleGetTakeoff(params) {
  const store = await import('./solid/stores/schedulesStore.js');
  const all = store.schedules();
  if (!all.length) return { ok: true, schedules: [], note: 'no schedules defined' };

  const wanted = (s) => {
    const r = store.buildResultForSchedule(s);
    const numCols = r.columns.filter(c => c.kind === 'number');
    return {
      id: s.id,
      name: s.name,
      count: r.count,
      columns: r.columns.map(c => ({ key: c.key, label: c.label, unit: c.unit || '', kind: c.kind })),
      grandTotals: Object.fromEntries(numCols.map(c => [c.key, r.grandTotals[c.key] ?? null])),
      groups: r.groups.map(g => ({
        key: g.key,
        count: g.rows.length,
        subtotals: Object.fromEntries(numCols.map(c => [c.key, g.subtotals[c.key] ?? null])),
      })),
    };
  };

  const sel = params?.scheduleId
    ? all.filter(s => s.id === params.scheduleId)
    : (params?.name ? all.filter(s => s.name === params.name) : all);
  if ((params?.scheduleId || params?.name) && !sel.length) {
    return { ok: false, error: `schedule not found: ${params.scheduleId || params.name}` };
  }
  return { ok: true, schedules: sel.map(wanted) };
}

// ─── Generic UI drivers: click / inspect any element by CSS selector ─────
//
// The ribbon renders only the ACTIVE tab's content (SolidJS <Match>), so a
// button that lives on an inactive tab simply does not exist in the DOM.
// `_findElementAcrossTabs` therefore walks the ribbon tab strip (clicking
// each tab button and giving Solid ~150 ms to mount the content) until the
// selector matches. Contextual tabs (Opmaak/Schikken/Afbeelding) only have
// a tab button while a matching selection exists — otherwise their content
// is unreachable and the element is reported as not found.

const RIBBON_TAB_ORDER = ['home', 'view', 'drawing', 'comment', 'organize', 'arrange', 'format', 'image', 'help'];

function _isElementDisabled(el) {
  return el.disabled === true ||
         el.getAttribute?.('aria-disabled') === 'true' ||
         el.classList?.contains('disabled') === true;
}

async function _findElementAcrossTabs(selector, searchTabs = true) {
  let el = document.querySelector(selector);
  if (el) return { el, activatedTab: null };
  if (!searchTabs) return { el: null, activatedTab: null };

  let originalTab = null;
  try {
    const store = await import('./solid/stores/ribbonStore.js');
    originalTab = store.activeTab();
  } catch { /* store unavailable — still try the tab buttons below */ }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (const tab of RIBBON_TAB_ORDER) {
    if (tab === originalTab) continue;
    const btn = document.querySelector(`.ribbon-tab[data-tab="${tab}"]`);
    if (!btn) continue; // contextual tab without matching selection
    btn.click();
    await wait(150);
    el = document.querySelector(selector);
    if (el) return { el, activatedTab: tab };
  }
  // Not found anywhere — restore the original tab so the sweep is side-effect-free.
  if (originalTab) {
    const back = document.querySelector(`.ribbon-tab[data-tab="${originalTab}"]`);
    if (back) { back.click(); await wait(150); }
  }
  return { el: null, activatedTab: null };
}

async function handleClickElement(params) {
  const selector = params?.selector;
  if (typeof selector !== 'string' || !selector) {
    return { ok: false, found: false, disabled: false, error: 'missing or invalid params.selector' };
  }
  let found;
  try {
    found = await _findElementAcrossTabs(selector, params?.searchTabs !== false);
  } catch (e) {
    return { ok: false, found: false, disabled: false, error: `${e?.message ?? e}` };
  }
  const el = found.el;
  if (!el) {
    return { ok: false, found: false, disabled: false, error: `no element matches: ${selector}` };
  }
  const disabled = _isElementDisabled(el);
  if (!disabled) el.click();
  return {
    ok: true,
    found: true,
    disabled,
    clicked: !disabled,
    activatedTab: found.activatedTab,
  };
}

async function handleUiState(params) {
  const selector = params?.selector;
  if (typeof selector !== 'string' || !selector) {
    return { ok: false, found: false, error: 'missing or invalid params.selector' };
  }
  let found;
  try {
    found = await _findElementAcrossTabs(selector, params?.searchTabs !== false);
  } catch (e) {
    return { ok: false, found: false, error: `${e?.message ?? e}` };
  }
  const el = found.el;
  if (!el) return { ok: true, found: false };
  const r = el.getBoundingClientRect();
  let visible = r.width > 0 && r.height > 0;
  if (visible) {
    try {
      const cs = getComputedStyle(el);
      visible = cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch { /* keep rect-based answer */ }
  }
  return {
    ok: true,
    found: true,
    visible,
    disabled: _isElementDisabled(el),
    active: el.classList?.contains('active') === true ||
            el.getAttribute?.('aria-pressed') === 'true',
    text: (el.textContent || '').trim().slice(0, 300),
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    activatedTab: found.activatedTab,
  };
}

const HANDLERS = {
  'mcp:open-pdf':           handleOpenPdf,
  'mcp:set-zoom':           handleSetZoom,
  'mcp:zoom-in':            handleZoomIn,
  'mcp:zoom-out':           handleZoomOut,
  'mcp:screenshot-view':    handleScreenshotView,
  'mcp:mouse-move':         handleMouseMove,
  'mcp:mouse-click':        handleMouseClick,
  'mcp:mouse-drag':         handleMouseDrag,
  'mcp:scroll':             handleScroll,
  'mcp:key':                handleKey,
  'mcp:type':               handleType,
  'mcp:get-viewport-state': handleGetViewportState,
  'mcp:get-recent-console': handleGetRecentConsole,
  'mcp:wheel-zoom':         handleWheelZoom,
  'mcp:zoom-anchor-test':   handleZoomAnchorTest,
  'mcp:clear-caches':       handleClearCaches,
  'mcp:go-to-page':         handleGoToPage,
  'mcp:click-element':      handleClickElement,
  'mcp:ui-state':           handleUiState,
  'mcp:merge-pdf':          handleMergePdf,
  // App control: tools & annotations
  'mcp:set-tool':           handleSetTool,
  'mcp:get-current-tool':   handleGetCurrentTool,
  'mcp:create-annotation':  handleCreateAnnotation,
  'mcp:list-annotations':   handleListAnnotations,
  'mcp:get-annotation':     handleGetAnnotation,
  'mcp:update-annotation':  handleUpdateAnnotation,
  'mcp:delete-annotation':  handleDeleteAnnotation,
  'mcp:select-annotation':  handleSelectAnnotation,
  'mcp:clear-selection':    handleClearSelection,
  // App control: editing
  'mcp:undo':               handleUndo,
  'mcp:redo':               handleRedo,
  // App control: documents / tabs
  'mcp:list-tabs':          handleListTabs,
  'mcp:switch-tab':         handleSwitchTab,
  'mcp:close-tab':          handleCloseTab,
  'mcp:new-blank-pdf':      handleNewBlankPdf,
  'mcp:save-pdf':           handleSavePdf,
  // App control: view
  'mcp:set-view-mode':      handleSetViewMode,
  'mcp:fit-page':           handleFitPage,
  'mcp:fit-width':          handleFitWidth,
  'mcp:get-page-count':     handleGetPageCount,
  // App control: measurement scale
  'mcp:set-measure-scale':  handleSetMeasureScale,
  // Take-off / schedules
  'mcp:get-takeoff':        handleGetTakeoff,
  // Assistant — test the AI end-to-end
  'mcp:ai-complete':        handleAiComplete,
  // Accounts introspection — deactivated (cloud accounts feature removed)
  'mcp:accounts-status':    handleAccountsStatus,
  'mcp:accounts-fetch':     handleAccountsFetch,
  // Assistant relay — external MCP client as the AI brain
  'mcp:assistant-ask':      handleAssistantAsk,
  'mcp:assistant-pending':  handleAssistantPending,
  'mcp:assistant-answer':   handleAssistantAnswer,
  'mcp:assistant-history':  handleAssistantHistory,
};

/** Wire up all `mcp:*` listeners. Safe to call once at startup. Becomes
 *  a no-op when Tauri isn't present (browser dev mode). */
export async function initMcpBridge() {
  if (!window.__TAURI__?.core?.invoke) {
    // Definitely not in Tauri.
    return;
  }

  // Resolve the event API. Prefer the global, fall back to the npm
  // module so we still work if `withGlobalTauri` is ever turned off.
  let ev = window.__TAURI__?.event;
  if (!ev) {
    try {
      ev = await import('@tauri-apps/api/event');
    } catch (e) {
      console.warn('[mcp-bridge] event API unavailable:', e);
      return;
    }
  }

  const wired = [];
  for (const [name, handler] of Object.entries(HANDLERS)) {
    try {
      await ev.listen(name, async (event) => {
        const payload = event?.payload ?? {};
        const requestId = payload.request_id;
        const params = payload.params ?? {};
        if (typeof requestId !== 'number') {
          console.warn('[mcp-bridge] missing request_id in', name, payload);
          return;
        }
        let result;
        try {
          result = await handler(params);
        } catch (e) {
          console.warn('[mcp-bridge] handler threw for', name, e);
          result = { ok: false, error: `${e?.message ?? e}` };
        }
        await respond(requestId, result);
      });
      wired.push(name);
    } catch (e) {
      console.warn('[mcp-bridge] listen failed for', name, e);
    }
  }
  window.__mcpBridgeReady = true;
  window.__mcpBridgeEvents = wired;
  console.log('[mcp-bridge] ready, events:', wired);
  // Notify the Rust side so we can confirm wire-up from outside the WebView
  // (devtools console isn't visible when launched headless).
  try {
    await window.__TAURI__.core.invoke('mcp_bridge_ready', { events: wired });
  } catch {
    /* harmless when running against an older binary without the cmd */
  }
}
