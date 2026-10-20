// Page engine choice (#625): which Rust engine renders the PAGE itself —
// PDFium, Hayro (pure Rust), or automatic (default): Hayro for heavy pages,
// PDFium for the rest. Annotations are always drawn by the app. The resolved
// engine travels with every render command (`engine`; Rust only ever sees
// 'pdfium' or 'hayro'), and every bitmap cache keys on the preference (via
// thinLinesKey), so switching never shows a bitmap the other engine drew.

import { state } from '../core/state.js';

/**
 * Page weight (raw bytes of the content streams plus every form XObject the
 * page draws; see the page_render_weight command) from which automatic picks
 * Hayro. Measured on the verification set with 4 render threads: all 36 pages
 * from 100 KB on rendered faster with Hayro (0.21-0.63x the time of PDFium);
 * below it the two are close and PDFium is the proven route.
 */
export const HEAVY_PAGE_WEIGHT = 100 * 1024;

/** The engine preference: 'pdfium', 'hayro' or 'auto' (default). */
export function renderEngineOn(prefs = state.preferences) {
  const v = prefs && prefs.renderEngine;
  return v === 'pdfium' || v === 'hayro' ? v : 'auto';
}

/**
 * Raw content size above which the PDFium route renders tiles with the scene
 * engine (progressive-render.js, SCENE_CONTENT_BYTES): it prepares the page
 * once and rasterizes every tile from it, while Hayro interprets the whole
 * page per tile. Measured on MV-03 (8.7 MB): Hayro opened in 31.6 s against
 * 11 s. Kept equal to SCENE_CONTENT_BYTES (a test checks it).
 */
export const SCENE_PAGE_CONTENT = 6_000_000;

/**
 * The engine for a page of `weight` bytes (content plus forms) with
 * `contentBytes` of raw content, under preference `pref`.
 */
export function engineForWeight(pref, weight, contentBytes = 0) {
  if (pref !== 'auto') return pref;
  if (contentBytes > SCENE_PAGE_CONTENT) return 'pdfium';
  return weight >= HEAVY_PAGE_WEIGHT ? 'hayro' : 'pdfium';
}

/**
 * The engine preference for region tiles (zoomed-in views). Automatic keeps
 * tiles on the PDFium route: PDFium keeps a heavy page parsed in its worker
 * and only rasterizes per tile, while Hayro interprets the whole page for
 * every tile (measured on NKD1a p2: sharp at 400 % after 4.2 s against
 * 0.7 s). Forced Hayro renders tiles with Hayro too.
 */
export function tileEngine(pref) {
  return pref === 'auto' ? 'pdfium' : pref;
}

// Automatic choice per page, filled by resolvePageEngine: { engine, weight }.
const _autoChoice = new Map();
const _weights = new Map();
let _threads = null;

/** Page weight in bytes (desktop with the Rust renderer only; else 0), cached. */
export async function pageRenderWeight(path, pageIndex) {
  const key = `${path}|${pageIndex}`;
  if (_weights.has(key)) return _weights.get(key);
  let weight = 0;
  try {
    const { heeftRustRenderer, invoke } = await import('../core/platform.js');
    if (heeftRustRenderer()) {
      weight = Number(await invoke('page_render_weight', { path, pageIndex })) || 0;
      if (_threads === null) _threads = Number(await invoke('hayro_render_threads')) || 0;
    }
  } catch {
    weight = 0;
  }
  _weights.set(key, weight);
  return weight;
}

// Pages Hayro refused (HAYRO_UNSUPPORTED: e.g. hundreds of mesh shadings
// that would need gigabytes). They are rendered with PDFium from then on, and
// the status bar shows PDFium for them, because that is what drew them.
const _pdfiumPages = new Set();

/** Whether a render error is Hayro refusing the page (not a real failure). */
export function isHayroUnsupported(err) {
  return String(err?.message ?? err).includes('HAYRO_UNSUPPORTED');
}

/**
 * The engine that will actually draw this page ('pdfium' or 'hayro'): an
 * automatic choice already made for it (PDFium until measured), and PDFium
 * for a page Hayro refused.
 */
export function engineForPage(engine, path, pageIndex) {
  const key = `${path}|${pageIndex}`;
  const eng = engine === 'auto' ? (_autoChoice.get(key)?.engine || 'pdfium') : engine;
  return eng === 'hayro' && _pdfiumPages.has(key) ? 'pdfium' : eng;
}

/** Resolve the preference for one page, measuring its content for 'auto'. */
export async function resolvePageEngine(engine, path, pageIndex) {
  if (engine === 'auto') {
    const key = `${path}|${pageIndex}`;
    if (!_autoChoice.has(key)) {
      const weight = await pageRenderWeight(path, pageIndex);
      const { pageContentBytes } = await import('./progressive-render.js');
      const content = await pageContentBytes(path, pageIndex + 1);
      const choice = { engine: engineForWeight('auto', weight, content), weight, scene: content > SCENE_PAGE_CONTENT };
      _autoChoice.set(key, choice);
      console.info(`[render-engine] ${fileName(path)} p${pageIndex + 1}: ${describeLine(describePageEngine(path, pageIndex))}`);
    }
  }
  return engineForPage(engine, path, pageIndex);
}

/**
 * Which engine draws this page and why, for logs, the MCP viewport state and
 * the test scripts: { mode, engine, reason, weightKB, threads }.
 * reason: 'forced' | 'auto-heavy' | 'auto-light' | 'auto-scene' (PDFium with the
 * scene engine) | 'not-measured' | 'hayro-refused'.
 */
export function describePageEngine(path, pageIndex, mode = renderEngineOn()) {
  const key = `${path}|${pageIndex}`;
  const choice = _autoChoice.get(key);
  const engine = engineForPage(mode, path, pageIndex);
  let reason;
  if (_pdfiumPages.has(key) && (mode === 'hayro' || choice?.engine === 'hayro')) reason = 'hayro-refused';
  else if (mode !== 'auto') reason = 'forced';
  else if (!choice) reason = 'not-measured';
  else if (choice.scene) reason = 'auto-scene';
  else reason = choice.engine === 'hayro' ? 'auto-heavy' : 'auto-light';
  const weight = choice?.weight ?? _weights.get(key);
  return {
    mode,
    engine,
    tiles: engineForPage(tileEngine(mode), path, pageIndex),
    reason,
    weightKB: weight === undefined ? null : Math.round(weight / 1024),
    threads: engine === 'hayro' ? _threads : null,
  };
}

function describeLine(d) {
  const parts = [`${d.engine} (${d.reason}`];
  if (d.weightKB !== null) parts.push(`, weight ${d.weightKB} KB, threshold ${HEAVY_PAGE_WEIGHT / 1024} KB`);
  if (d.threads !== null) parts.push(`, ${d.threads} threads`);
  if (d.tiles && d.tiles !== d.engine) parts.push(`; tiles ${d.tiles}`);
  return parts.join('') + ')';
}

function fileName(path) {
  return String(path).split(/[\/]/).pop();
}

/**
 * Run a render with the page's engine; when Hayro refuses the page, remember
 * that and run it again with PDFium. Other errors are passed on unchanged.
 */
export async function withPageEngine(engine, path, pageIndex, run) {
  const eng = await resolvePageEngine(engine, path, pageIndex);
  try {
    return await run(eng);
  } catch (err) {
    if (eng !== 'hayro' || !isHayroUnsupported(err)) throw err;
    console.warn(`[render-engine] Hayro refused p${pageIndex + 1} of ${path}: ${String(err?.message ?? err).slice(0, 160)} — PDFium renders it`);
    _pdfiumPages.add(`${path}|${pageIndex}`);
    console.info(`[render-engine] ${fileName(path)} p${pageIndex + 1}: ${describeLine(describePageEngine(path, pageIndex))}`);
    return run('pdfium');
  }
}

/** Human-readable engine name for diagnostics (MCP viewport state, logs). */
export function renderEngineLabel(engine = renderEngineOn()) {
  return engine === 'hayro' ? 'Hayro' : 'PDFium';
}

/** Label of the engine that actually draws this page (after a Hayro refusal: PDFium). */
export function pageEngineLabel(path, pageIndex) {
  return renderEngineLabel(engineForPage(renderEngineOn(), path, pageIndex));
}
