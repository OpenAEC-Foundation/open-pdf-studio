// Benchmark (#491): undo, delete and editing one annotation among many, in the
// RUNNING app.
//
// Drives a test instance started with --mcp-server (MCP JSON-RPC) and a
// WebView2 debug port (CDP). Works against a release/debug build with the
// frontend embedded: the app's handlers are reached the way the MCP server
// reaches them (a `mcp:*` event) and the time is taken inside the page, from
// just before the event until the handler answers. Pointer and input events
// are dispatched inside the page like the MCP mouse tools do.
//
//   node scripts/bench/undo-rig.mjs [--mcp=9305] [--cdp=9405] [--counts=100,500,1000,2000]
//        [--reps=3] [--mode=undo,modify] [--profile=<N>] [--profile-modify=<N>]
//        [--pdf=<copy of a real PDF>] [--mix] [--list] [--schedule] [--out=<file.json>]
//
// Per count N the active document (a new blank one, or --pdf) gets N
// synthetic 'box' annotations next to its own (0: only its own) (with --mix: boxes, lines, measured distances
// and areas plus a scale bar). --list keeps the annotation list in the left
// panel open during the run (by default the thumbnails are shown, as when
// the app starts); --schedule keeps the quantities panel open. Times in ms,
// median over --reps:
//
// mode undo
//   undo        create one box (untimed), then undo it: removes one annotation
//   delete      delete the middle annotation
//   undoDel     undo that delete: puts it back
//   *Settled    the same plus the next two animation frames
// mode modify   (one extra, larger box is the one being edited)
//   select      select it (shows its properties)
//   prop        change its line width in the properties panel (input event)
//   dragMove    one pointer move while dragging it, until the next frame is
//               drawn (median of 10; about one frame interval when smooth)
//   dragUp      releasing the drag (records the undo step, full redraw)
//   resizeMove  the same while resizing it by its corner grip
//   resizeUp    releasing the resize
//   *Settled    the same plus the next two animation frames
//   *Long       longest main-thread task (Long Tasks API) in the second after
//               the change: debounced work such as the thumbnail refresh
// --profile=N          CPU profile of one undo at N annotations
// --profile-modify=N   CPU profile of one property change + one drag at N
// Profiles print the functions with the most self time; bundle positions are
// mapped to a snippet of the embedded source.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MCP = `http://127.0.0.1:${arg('mcp', '9305')}/mcp`;
const CDP = `http://127.0.0.1:${arg('cdp', '9405')}`;
const COUNTS = arg('counts', '100,500,1000,2000').split(',').filter((c) => c !== '').map(Number).filter((c) => c >= 0);
const REPS = Number(arg('reps', '3'));
const MODES = arg('mode', 'undo,modify').split(',');
const PROFILE_AT = Number(arg('profile', '-1'));
const PROFILE_MODIFY_AT = Number(arg('profile-modify', '-1'));
const PDF = arg('pdf', '');
const MIX = process.argv.includes('--mix');
const LIST = process.argv.includes('--list');
const SCHEDULE = process.argv.includes('--schedule');
const OUT = arg('out', '');

async function tool(name, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return text ?? json; }
}

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools'));
if (!page) throw new Error('no app page on CDP');
page.setDefaultTimeout(600000);

// In-page helpers: the app state (exported from the entry chunk), calling an
// MCP handler directly and timing it until it answers, pointer events at an
// annotation position, and a long-task log.
await page.evaluate(async () => {
  if (window.__bench491?.version === 2) return;
  const entry = [...document.querySelectorAll('script[type="module"]')]
    .map((s) => s.src).find((src) => /\/assets\/index-[^/]+\.js$/.test(src));
  const mod = await import(entry);
  const appState = Object.values(mod).find((v) => v && typeof v === 'object'
    && 'documents' in v && 'activeDocumentIndex' in v);
  if (!appState) throw new Error('app state not found in entry chunk');

  // The bridge answers through window.__TAURI__.core.invoke('app_response').
  // `core` itself is frozen, but the property holding it is not: swap in a
  // copy whose invoke catches the answers to our own request ids and passes
  // everything else on.
  const core = window.__TAURI__.core;
  const original = core.invoke;
  const pending = new Map();
  window.__TAURI__.core = {
    ...core,
    invoke(cmd, args, options) {
      if (cmd === 'app_response' && args && pending.has(args.requestId)) {
        const done = pending.get(args.requestId);
        pending.delete(args.requestId);
        done({ t: performance.now(), result: args.result });
        return Promise.resolve(null);
      }
      return original(cmd, args, options);
    },
  };
  let nextId = 1_900_000_000;
  const frames = (n) => new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    const step = (k) => requestAnimationFrame(() => (k <= 1 ? (clearTimeout(timer), resolve()) : step(k - 1)));
    step(n);
  });
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask' });
  } catch { /* no Long Tasks API */ }
  const doc = () => appState.documents[appState.activeDocumentIndex];

  function appToClient(ax, ay) {
    const canvas = document.getElementById('annotation-canvas');
    const rect = canvas.getBoundingClientRect();
    const vp = window.__pdfViewport;
    const d = doc();
    if (vp && vp.active && d?.filePath) return [rect.left + vp.offsetX + ax * vp.zoom, rect.top + vp.offsetY + ay * vp.zoom];
    const s = d?.scale || 1.5;
    return [rect.left + ax * s, rect.top + ay * s];
  }
  function pointer(kind, x, y, buttons) {
    const target = document.elementFromPoint(x, y) || document.body;
    const init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };
    target.dispatchEvent(new PointerEvent(`pointer${kind}`, init));
    target.dispatchEvent(new MouseEvent(`mouse${kind}`, init));
  }

  window.__bench491 = {
    version: 2,
    state: appState,
    doc,
    frames,
    async call(event, params = {}) {
      const id = nextId++;
      const answered = new Promise((resolve) => pending.set(id, resolve));
      const t0 = performance.now();
      await window.__TAURI__.event.emit(event, { request_id: id, params });
      const { t, result } = await answered;
      await frames(2);
      return { ms: t - t0, settled: performance.now() - t0, result };
    },
    // Longest task that started at or after t0, within `window` ms.
    async longestAfter(t0, windowMs = 1000) {
      await new Promise((r) => setTimeout(r, windowMs));
      return longTasks.filter((e) => e.start >= t0 - 1).reduce((m, e) => Math.max(m, e.duration), 0);
    },
    // Timed synchronous action followed by two frames.
    async timed(fn) {
      const t0 = performance.now();
      fn();
      const sync = performance.now() - t0;
      await frames(2);
      return { t0, sync, settled: performance.now() - t0 };
    },
    appToClient,
    pointer,
  };
});

const call = (event, params) => page.evaluate(([e, p]) => window.__bench491.call(e, p), [event, params]);

async function openDocument() {
  if (PDF) {
    const r = await tool('app_open_pdf', { path: PDF });
    if (!r?.ok) throw new Error(`open failed: ${JSON.stringify(r)}`);
    // The annotations of a real file can arrive page by page: wait until
    // their number has been stable for a second.
    const loaded = await page.evaluate(async () => {
      const b = window.__bench491;
      let last = -1;
      let stableSince = performance.now();
      const start = performance.now();
      while (performance.now() - start < 60000) {
        const n = b.doc()?.annotations?.length ?? -1;
        if (n !== last) { last = n; stableSince = performance.now(); }
        if (n >= 0 && performance.now() - stableSince > 1500) break;
        await new Promise((res) => setTimeout(res, 250));
      }
      return last;
    });
    console.log(`opened ${PDF}: ${loaded} annotations`);
  } else {
    const r = await tool('app_new_blank_pdf', { widthPt: 595, heightPt: 842 });
    if (!r?.ok) throw new Error(`blank pdf failed: ${JSON.stringify(r)}`);
  }
  await page.evaluate(() => window.__bench491.frames(3));
}

// Replace the document's annotations by `n` synthetic ones built from real
// templates (one of each kind created through the app's own create handler).
async function fill(n) {
  const templates = await page.evaluate(async (mix) => {
    const b = window.__bench491;
    const doc = b.doc();
    doc.annotations = doc.annotations.filter((a) => b.originalIds.has(a.id));
    const make = async (type, props) => (await b.call('mcp:create-annotation', { type, props })).result;
    const out = [];
    const box = await make('box', { x: 20, y: 20, width: 8, height: 6 });
    out.push(box.id);
    if (mix) {
      out.push((await make('line', { startX: 20, startY: 40, endX: 28, endY: 44 })).id);
      out.push((await make('measureDistance', { startX: 20, startY: 60, endX: 30, endY: 60 })).id);
      out.push((await make('measureArea', { points: [{ x: 20, y: 80 }, { x: 28, y: 80 }, { x: 28, y: 86 }] })).id);
    }
    return out;
  }, MIX);
  return page.evaluate(async ([n, ids, mix]) => {
    const b = window.__bench491;
    const doc = b.doc();
    const originals = doc.annotations.filter((a) => !ids.includes(a.id)).map((a) => JSON.parse(JSON.stringify(a)));
    const tpl = ids.map((id) => JSON.parse(JSON.stringify(doc.annotations.find((a) => a.id === id))));
    const list = [];
    for (let i = 0; i < n; i++) {
      const t = JSON.parse(JSON.stringify(tpl[i % tpl.length]));
      const dx = 20 + (i % 50) * 11 - (t.x ?? t.startX ?? t.points?.[0]?.x ?? 0);
      const dy = 20 + ((Math.floor(i / 50) * 11) % 700) - (t.y ?? t.startY ?? t.points?.[0]?.y ?? 0);
      t.id = `b491-${n}-${i}`;
      if (typeof t.x === 'number') { t.x += dx; t.y += dy; }
      if (typeof t.startX === 'number') { t.startX += dx; t.startY += dy; t.endX += dx; t.endY += dy; }
      if (Array.isArray(t.points)) t.points = t.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
      list.push(t);
    }
    if (mix) {
      list.push({ ...JSON.parse(JSON.stringify(tpl[0])), id: `b491-${n}-scalebar`, type: 'scaleBar',
        x: 400, y: 740, width: 100, height: 14, pixelsPerUnit: 0.02, unit: 'mm', divisions: 5, totalUnits: 5000 });
    }
    const t0 = performance.now();
    doc.annotations = [...originals, ...list];
    const assignMs = performance.now() - t0;
    doc.undoStack = [];
    doc.redoStack = [];
    doc.selectedAnnotations = [];
    doc.selectedAnnotation = null;
    await b.frames(2);
    return { total: doc.annotations.length, assignMs };
  }, [n, templates, MIX]);
}

async function startProfile() {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  return cdp;
}

async function stopProfile(cdp, label, title) {
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.detach();
  writeFileSync(`${label}.cpuprofile`, JSON.stringify(profile));
  const byNode = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const f = byNode.get(profile.samples[i]).callFrame;
    const key = `${f.functionName || '(anon)'}@${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`;
    const ms = (profile.timeDeltas[i] || 0) / 1000;
    total += ms;
    self.set(key, (self.get(key) || 0) + ms);
  }
  const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const snippets = await page.evaluate(async (keys) => {
    const out = {};
    const cache = {};
    for (const key of keys) {
      const m = key.match(/@([^:]+):(\d+):(\d+)$/);
      if (!m || !m[1].endsWith('.js')) continue;
      const url = [...performance.getEntriesByType('resource')].map((e) => e.name).find((u) => u.endsWith(m[1]))
        || `${location.origin}/assets/${m[1]}`;
      cache[url] ??= (await (await fetch(url)).text()).split('\n');
      const line = cache[url][Number(m[2])] || '';
      out[key] = line.slice(Number(m[3]), Number(m[3]) + 110);
    }
    return out;
  }, top.map(([k]) => k));
  console.log(`\nCPU profile: ${title} (${total.toFixed(0)} ms sampled), top self time:`);
  for (const [key, ms] of top) console.log(`${ms.toFixed(1).padStart(8)} ms  ${key}\n            ${snippets[key] ?? ''}`);
}

async function profileUndo(label) {
  await call('mcp:create-annotation', { type: 'box', props: { x: 300, y: 300, width: 10, height: 10 } });
  const cdp = await startProfile();
  const timing = await call('mcp:undo', {});
  await stopProfile(cdp, label, `one undo, ${timing.ms.toFixed(0)} ms`);
}

// The box being edited: larger than the grid boxes and filled, so a click on
// its middle and on its corner grip hit it.
const TARGET = { x: 40, y: 40, width: 60, height: 40 };

async function modifyOnce(targetId, rep) {
  return page.evaluate(async ([id, T, rep]) => {
    const b = window.__bench491;
    const doc = b.doc();
    const ann = () => doc.annotations.find((a) => a.id === id);
    const out = {};

    const sel = await b.call('mcp:select-annotation', { id });
    if (!sel.result?.ok) throw new Error(`select failed ${JSON.stringify(sel.result)}`);
    out.select = sel.ms;
    await b.frames(2);

    // Line width through the properties panel (the same updateAnnotProp path
    // as colour and every other field).
    const group = [...document.querySelectorAll('.property-group')]
      .find((g) => g.querySelector('.pref-combo-suffix')?.textContent?.trim() === 'pt' && g.querySelector('.pref-combo-input'));
    const input = group?.querySelector('.pref-combo-input');
    if (!input) throw new Error('line width field not found in the properties panel');
    const width = rep % 2 ? 3 : 4;
    const prop = await b.timed(() => {
      input.value = String(width);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (ann().lineWidth !== width) throw new Error(`line width not applied (${ann().lineWidth})`);
    out.prop = prop.sync;
    out.propSettled = prop.settled;
    out.propLong = await b.longestAfter(prop.t0);

    // Drag the box by its middle.
    const start = ann();
    const [cx, cy] = b.appToClient(start.x + start.width / 2, start.y + start.height / 2);
    const x0 = start.x;
    b.pointer('move', cx, cy, 0);
    await b.frames(1);
    b.pointer('down', cx, cy, 1);
    const moves = [];
    // A move during a drag is handled in the next animation frame (the
    // dispatcher coalesces pointer moves), so time each move until the frame
    // after it: about one frame interval when the work is light.
    for (let i = 1; i <= 10; i++) {
      const t = performance.now();
      b.pointer('move', cx + i * 4, cy + i * 2, 1);
      await b.frames(1);
      moves.push(performance.now() - t);
    }
    const up = await b.timed(() => b.pointer('up', cx + 40, cy + 20, 0));
    if (ann().x === x0) throw new Error('drag did not move the box');
    moves.sort((a, c) => a - c);
    out.dragMove = moves[5];
    out.dragMoveMax = moves[9];
    out.dragUp = up.sync;
    out.dragUpSettled = up.settled;
    out.dragLong = await b.longestAfter(up.t0);

    // Resize by the bottom-right grip.
    const r = ann();
    const w0 = r.width;
    const [gx, gy] = b.appToClient(r.x + r.width, r.y + r.height);
    b.pointer('move', gx, gy, 0);
    await b.frames(1);
    b.pointer('down', gx, gy, 1);
    const rmoves = [];
    for (let i = 1; i <= 10; i++) {
      const t = performance.now();
      b.pointer('move', gx + i * 3, gy + i * 2, 1);
      await b.frames(1);
      rmoves.push(performance.now() - t);
    }
    const rup = await b.timed(() => b.pointer('up', gx + 30, gy + 20, 0));
    if (ann().width === w0) throw new Error('resize did not change the width');
    rmoves.sort((a, c) => a - c);
    out.resizeMove = rmoves[5];
    out.resizeMoveMax = rmoves[9];
    out.resizeUp = rup.sync;
    out.resizeUpSettled = rup.settled;
    out.resizeLong = await b.longestAfter(rup.t0);

    // Put the box back for the next rep.
    Object.assign(ann(), { x: T.x, y: T.y, width: T.width, height: T.height });
    await b.frames(2);
    return out;
  }, [targetId, TARGET, rep]);
}

async function profileModify(label, targetId) {
  const cdp = await startProfile();
  const r = await modifyOnce(targetId, 1);
  await stopProfile(cdp, label, `select + line width + drag + resize (prop ${r.prop.toFixed(0)} ms, drag up ${r.dragUp.toFixed(0)} ms)`);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const round = (v) => +v.toFixed(1);

await openDocument();
await tool('app_set_tool', { tool: 'select' });
// Left panel: the annotation list (--list) or the thumbnails.
await page.evaluate(async (list) => {
  document.querySelector(`.left-panel-tab[data-panel="${list ? 'annotations' : 'thumbnails'}"]`)?.click();
  await window.__bench491.frames(2);
}, LIST);
// Quantities panel: open with --schedule (the ribbon button toggles it).
const scheduleOpen = () => page.evaluate(() => !!document.querySelector('.schedule-modeless'));
if (SCHEDULE !== await scheduleOpen()) await tool('app_click_element', { selector: '#btn-open-schedule' });
if (SCHEDULE !== await scheduleOpen()) throw new Error('could not set the quantities panel');
await page.evaluate(() => {
  const b = window.__bench491;
  b.originalIds = new Set(b.doc().annotations.map((a) => a.id));
});
const base = await call('mcp:get-current-tool', {});
console.log(`handler round trip without work: ${base.ms.toFixed(1)} ms`);

const rows = [];
for (const n of COUNTS) {
  const filled = await fill(n);
  const row = { n: filled.total, fillMs: Math.round(filled.assignMs) };
  if (MODES.includes('undo')) {
    const runs = { undo: [], undoSettled: [], delete: [], deleteSettled: [], undoDel: [] };
    for (let r = 0; r < REPS; r++) {
      await call('mcp:create-annotation', { type: 'box', props: { x: 300 + r, y: 300, width: 10, height: 10 } });
      const u = await call('mcp:undo', {});
      if (!u.result?.ok) throw new Error(`undo failed ${JSON.stringify(u.result)}`);
      runs.undo.push(u.ms); runs.undoSettled.push(u.settled);
      const victim = await page.evaluate(() => {
        const doc = window.__bench491.doc();
        return doc.annotations[Math.floor(doc.annotations.length / 2)].id;
      });
      const d = await call('mcp:delete-annotation', { id: victim });
      if (!d.result?.ok) throw new Error(`delete failed ${JSON.stringify(d.result)}`);
      runs.delete.push(d.ms); runs.deleteSettled.push(d.settled);
      const ud = await call('mcp:undo', {});
      if (!ud.result?.ok) throw new Error(`undo of delete failed ${JSON.stringify(ud.result)}`);
      runs.undoDel.push(ud.ms);
    }
    for (const [k, v] of Object.entries(runs)) row[k] = round(median(v));
    if (PROFILE_AT === n) await profileUndo(OUT ? `${OUT.replace(/\.json$/, '')}-undo-${n}` : `undo-profile-${n}`);
  }
  if (MODES.includes('modify')) {
    const target = await call('mcp:create-annotation', { type: 'box', props: { ...TARGET, fillColor: '#ffcc00' } });
    const targetId = target.result.id;
    const runs = [];
    for (let r = 0; r < REPS; r++) runs.push(await modifyOnce(targetId, r));
    for (const k of Object.keys(runs[0])) row[k] = round(median(runs.map((x) => x[k])));
    if (PROFILE_MODIFY_AT === n) {
      await profileModify(OUT ? `${OUT.replace(/\.json$/, '')}-modify-${n}` : `modify-profile-${n}`, targetId);
    }
    await tool('app_clear_selection', {});
  }
  if (LIST) {
    row.listItems = await page.evaluate(() => document.querySelectorAll('#annotations-panel .annotation-list-item').length);
  }
  if (SCHEDULE) {
    row.scheduleRows = await page.evaluate(() => document.querySelectorAll('.schedule-modeless tbody tr').length);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.table(rows);
if (OUT) writeFileSync(OUT, JSON.stringify({ base: base.ms, rows }, null, 1));
await browser.close();
