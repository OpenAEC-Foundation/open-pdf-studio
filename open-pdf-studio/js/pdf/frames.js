// OpenAEC drawing frames (tekenkaders) — discovery + resolution.
//
// Frames are plain PDFs following the naming convention
//   <stijl>_<formaat>_<richting>.pdf      e.g. grootformaat_a1_liggend.pdf
// (extra underscore tokens are allowed; the format token is the first one
// matching an ISO size like a0/a3/b4, richting is 'liggend' or 'staand').
//
// They are scanned RECURSIVELY from up to three roots, first hit per
// filename wins, so users can add or override frames without touching the
// app:
//   1. <appData>\kaders            — user-writable; works in the installed app
//   2. the OpenAEC tenant repo dir — developer convenience (when present)
//   3. <resourceDir>\kaders        — the set bundled with the installer
//
// New files (or new subfolders with files in the same convention) appear
// automatically the next time the New-document dialog opens.

import { getAppDataDir } from '../core/platform.js';

const DEV_FRAMES_DIR =
  'C:\\Users\\rickd\\Documents\\GitHub\\openaec-tenants\\tenants\\openaec_foundation\\drawing_frames';

function _tauri() {
  return window.__TAURI__ || {};
}

async function _allowDir(dir) {
  try {
    await _tauri().core?.invoke('allow_fs_scope', { path: dir + '\\_scope.pdf' });
  } catch { /* scope grant is best-effort */ }
}

async function _exists(path) {
  try { return await _tauri().fs?.exists(path); } catch { return false; }
}

/** Candidate roots in priority order (existing only). */
export async function getFrameDirs() {
  const t = _tauri();
  const dirs = [];
  try {
    const appData = await getAppDataDir();
    const sep = appData.endsWith('\\') || appData.endsWith('/') ? '' : '\\';
    const userDir = `${appData}${sep}kaders`;
    await _allowDir(userDir);
    if (await _exists(userDir)) dirs.push(userDir);
  } catch { /* no appData (browser) */ }
  await _allowDir(DEV_FRAMES_DIR);
  if (await _exists(DEV_FRAMES_DIR)) dirs.push(DEV_FRAMES_DIR);
  try {
    const res = await t.path.resourceDir();
    const sep = res.endsWith('\\') || res.endsWith('/') ? '' : '\\';
    const bundled = `${res}${sep}kaders`;
    await _allowDir(bundled);
    if (await _exists(bundled)) dirs.push(bundled);
  } catch { /* no resource dir */ }
  return dirs;
}

/** The folder the user manages frames in: appData\kaders (created on
 *  demand) — except in dev, where the tenant repo folder wins when present. */
export async function getUserFramesDir() {
  if (await _exists(DEV_FRAMES_DIR)) return DEV_FRAMES_DIR;
  const t = _tauri();
  const appData = await getAppDataDir();
  const sep = appData.endsWith('\\') || appData.endsWith('/') ? '' : '\\';
  const userDir = `${appData}${sep}kaders`;
  await _allowDir(userDir);
  if (!(await _exists(userDir))) {
    try { await t.fs.mkdir(userDir, { recursive: true }); } catch { /* leave */ }
  }
  return userDir;
}

/** Open the frames folder in the OS file manager. */
export async function openFramesFolder() {
  const dir = await getUserFramesDir();
  try {
    await _tauri().core.invoke('open_pdf_in_default_viewer', { path: dir });
  } catch (e) {
    console.warn('[frames] open folder failed:', e);
  }
}

const FORMAT_RE = /^[ab]\d$/i;

/** Parse 'grootformaat_a1_liggend.pdf' → { stijl, formaat, richting }. */
export function parseFrameName(fileName) {
  const base = fileName.replace(/\.pdf$/i, '');
  const tokens = base.split('_').filter(Boolean);
  if (tokens.length < 2) return null;
  const stijl = tokens[0].toLowerCase();
  const formaat = (tokens.find(tk => FORMAT_RE.test(tk)) || '').toLowerCase();
  if (!formaat) return null;
  const richting = tokens.map(tk => tk.toLowerCase()).includes('staand') ? 'staand' : 'liggend';
  return { stijl, formaat, richting };
}

async function _scanDir(dir, out, seen) {
  let entries = [];
  try { entries = await _tauri().fs.readDir(dir); } catch { return; }
  for (const en of entries || []) {
    const full = `${dir}\\${en.name}`;
    if (en.isDirectory) {
      await _allowDir(full);
      await _scanDir(full, out, seen);
      continue;
    }
    if (!en.name?.toLowerCase().endsWith('.pdf')) continue;
    const key = en.name.toLowerCase();
    if (seen.has(key)) continue;   // earlier (higher-priority) root wins
    const parsed = parseFrameName(en.name);
    if (!parsed) continue;
    seen.add(key);
    out.push({ ...parsed, path: full, fileName: en.name });
  }
}

/**
 * Scan all roots. Returns
 *   { frames, stijlen: ['detailblad', ...],
 *     byStijl: Map(stijl → { formaten:Set, byKey: Map('a1|liggend' → frame) }) }
 */
export async function scanFrames() {
  const frames = [];
  const seen = new Set();
  for (const dir of await getFrameDirs()) {
    await _scanDir(dir, frames, seen);
  }
  const byStijl = new Map();
  for (const f of frames) {
    let g = byStijl.get(f.stijl);
    if (!g) { g = { formaten: new Set(), byKey: new Map() }; byStijl.set(f.stijl, g); }
    g.formaten.add(f.formaat);
    g.byKey.set(`${f.formaat}|${f.richting}`, f);
  }
  const stijlen = [...byStijl.keys()].sort((a, b) => a.localeCompare(b, 'nl'));
  return { frames, stijlen, byStijl };
}
