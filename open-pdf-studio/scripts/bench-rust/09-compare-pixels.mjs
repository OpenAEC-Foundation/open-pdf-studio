// Compare pixel work: JS (pdf.js + js/compare/*) versus the PDFium worker
// (pdfium-worker/src/compare/), end to end, on generated drawing pairs.
//
// For A3 and A0, plain and with a plot shift (automatic alignment on), this
//   1. profiles the JS pipeline stage by stage (compare-js-pipeline.mjs),
//   2. times the worker request `compare` the way the app uses it: one JSON
//      line over stdin, one line back, clusters read from the worker's shared
//      memory and decoded into JS objects (the IPC the app pays as well;
//      the extra Tauri hop carries the same few kB and is not included),
//   3. checks parity: both cluster lists in millimetres on paper, matched by
//      type and overlap, with the edge and pixel-count deviation reported, and
//      every known edit of the generated pair found on both sides.
//
// The worker binary is built with
//   cargo +stable-x86_64-pc-windows-msvc build -p pdfium-worker --release
// and needs pdfium.dll on PATH (src-tauri/binaries/win-x64 is added here).
//
// Run from open-pdf-studio/:
//   node scripts/bench-rust/09-compare-pixels.mjs [--worker <exe>] [--repeat 3] [--check]
// --check exits non-zero when parity fails (used as the end-to-end parity test).

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { makePair } from './compare-fixtures.mjs';
import { openDoc, jsPipeline } from './compare-js-pipeline.mjs';
import { planPair, detectionParams } from '../../js/compare/detect-plan.js';
import { median } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : d;
};
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const appRoot = join(here, '..', '..');
const workerExe = opt('--worker', 'C:\\opds-cargo-target-449\\release\\pdfium-worker.exe');
const repeat = Number(opt('--repeat', 3));
const check = args.includes('--check');
const now = () => Number(process.hrtime.bigint()) / 1e6;

// ── Worker client ──────────────────────────────────────────────────────────
function startWorker() {
  const env = { ...process.env, PATH: `${join(appRoot, 'src-tauri', 'binaries', 'win-x64')};${process.env.PATH}` };
  const child = spawn(workerExe, ['97', `bench${process.pid}`], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  const waiting = [];
  rl.on('line', (line) => { const w = waiting.shift(); if (w) w(JSON.parse(line)); });
  const next = () => new Promise((r) => waiting.push(r));
  let fd = null;
  return {
    async ready() {
      const msg = await next();
      if (msg.op !== 'ready' || !(msg.caps || []).includes('compare')) throw new Error(`worker without compare: ${JSON.stringify(msg)}`);
      fd = openSync(join(tmpdir(), msg.shm_name), 'r');
      return msg;
    },
    async request(obj) {
      const p = next();
      child.stdin.write(JSON.stringify(obj) + '\n');
      return p;
    },
    send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); },
    readShm(bytes) {
      const buf = Buffer.alloc(bytes);
      if (bytes) readSync(fd, buf, 0, bytes, 32);
      return buf;
    },
    async stop() {
      child.stdin.write('{"op":"shutdown"}\n');
      child.stdin.end();
      await new Promise((r) => child.on('exit', r));
      if (fd !== null) closeSync(fd);
    },
  };
}

const TYPES = ['added', 'removed', 'modified'];
function decodeClusters(buf, n) {
  const f = new Float64Array(buf.buffer, buf.byteOffset, n * 10);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    out.push({
      type: TYPES[f[o]], x: f[o + 1], y: f[o + 2], width: f[o + 3], height: f[o + 4], pixelCount: f[o + 5],
      old: { x: f[o + 6], y: f[o + 7], width: f[o + 8], height: f[o + 9] },
    });
  }
  return out;
}

async function rustPipeline(worker, files, sizes, { autoAlign, preset = 'line' }) {
  const plan = planPair(sizes.old, sizes.new);
  const params = detectionParams(preset, plan.mmPerPx);
  const t0 = now();
  const resp = await worker.request({
    op: 'compare', id: Math.floor(Math.random() * 1e9),
    old: { path: files.old, page_index: 0, width_pt: sizes.old.width, height_pt: sizes.old.height },
    new: { path: files.new, page_index: 0, width_pt: sizes.new.width, height_pt: sizes.new.height },
    px_per_pt: plan.pxPerPt, threshold: params.threshold,
    params: { tolerance_px: params.tolerancePx, min_area_px: params.minAreaPx, merge_px: params.mergePx, noise_px: params.noisePx },
    ...(autoAlign ? { auto_align: { measure_ratio: null } } : {}),
  });
  if (!resp.ok) throw new Error(resp.error);
  const clusters = decodeClusters(worker.readShm(resp.shm_bytes), resp.clusters);
  const ms = now() - t0;
  return { resp, clusters, ms, mmPerPx: plan.mmPerPx };
}

// ── Parity ─────────────────────────────────────────────────────────────────
const mm = (c, k) => ({ x: c.x * k, y: c.y * k, w: c.width * k, h: c.height * k });
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
}

/**
 * Match JS clusters to Rust clusters (the tolerance, see docs/rust-stappen.md):
 *   - a pair has the same type and overlaps (IoU >= 0.5);
 *   - a change may come out as one cluster on one side and as two or more on
 *     the other where a line of the other revision crosses it: whether the gap
 *     at the crossing exceeds the merge distance depends on the anti-aliased
 *     fringe of that line. Those fragments are matched as a group: same type,
 *     each inside the other side's cluster grown by the merge distance, and
 *     the union overlapping it (IoU >= 0.5);
 *   - anything left unmatched may only be a speck below 4x the minimum area.
 * The edge deviation of matched (groups of) clusters is reported in pixels.
 */
function parity(js, rs, k, minAreaPx, mergePx) {
  const union = (list) => {
    const x1 = Math.min(...list.map((c) => c.x)), y1 = Math.min(...list.map((c) => c.y));
    const x2 = Math.max(...list.map((c) => c.x + c.width)), y2 = Math.max(...list.map((c) => c.y + c.height));
    return { type: list[0].type, x: x1, y: y1, width: x2 - x1, height: y2 - y1, pixelCount: list.reduce((s, c) => s + c.pixelCount, 0) };
  };
  const inside = (c, big, g) => c.x >= big.x - g && c.y >= big.y - g && c.x + c.width <= big.x + big.width + g && c.y + c.height <= big.y + big.height + g;
  const usedJ = new Set();
  const usedR = new Set();
  const pairs = [];
  let splits = 0;
  const matchSide = (from, to, usedFrom, usedTo, flip) => {
    from.forEach((a, ai) => {
      if (usedFrom.has(ai)) return;
      const group = [];
      to.forEach((b, bi) => {
        if (!usedTo.has(bi) && b.type === a.type && inside(b, a, mergePx + 2)) group.push(bi);
      });
      if (!group.length) return;
      const u = union(group.map((i) => to[i]));
      const v = iou(mm(a, k), mm(u, k));
      if (v < 0.5) return;
      usedFrom.add(ai);
      group.forEach((i) => usedTo.add(i));
      if (group.length > 1) splits++;
      pairs.push(flip ? [u, a, v] : [a, u, v]);
    });
  };
  matchSide(js, rs, usedJ, usedR, false);
  matchSide(rs, js, usedR, usedJ, true);
  const onlyJs = js.filter((_, i) => !usedJ.has(i));
  const onlyRs = rs.filter((_, i) => !usedR.has(i));
  let edge = 0, countRel = 0, minIou = 1;
  for (const [a, b, v] of pairs) {
    edge = Math.max(edge, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - b.x - b.width), Math.abs(a.y + a.height - b.y - b.height));
    countRel = Math.max(countRel, Math.abs(a.pixelCount - b.pixelCount) / a.pixelCount);
    minIou = Math.min(minIou, v);
  }
  const speck = (c) => c.pixelCount < 4 * minAreaPx;
  const unmatchedLarge = [...onlyJs, ...onlyRs].filter((c) => !speck(c));
  return { matched: pairs.length, splits, onlyJs: onlyJs.length, onlyRs: onlyRs.length, unmatchedLarge, edgePx: edge, edgeMm: edge * k, countRel, minIou };
}

function truthFound(clusters, truth, k, shift) {
  // Truth is in mm on the old sheet; a plot shift moves it by at most ~4 mm.
  const slack = shift ? 5 : 1.5;
  return truth.every((t) => clusters.some((c) => {
    const b = mm(c, k);
    return b.x < t.x + t.width + slack && b.x + b.w > t.x - slack && b.y < t.y + t.height + slack && b.y + b.h > t.y - slack;
  }));
}

// ── Run ────────────────────────────────────────────────────────────────────
const dir = join(tmpdir(), 'opds-bench-compare');
mkdirSync(dir, { recursive: true });
console.log(`node ${process.version} | ${cpus()[0]?.model} | worker ${workerExe}`);

const worker = startWorker();
await worker.ready();
const rows = [];
let failed = false;
for (const name of ['A3', 'A0']) {
  for (const shift of [false, true]) {
    const pair = await makePair(name, { shift });
    const tag = `${name}${shift ? '-shift' : ''}`;
    const files = { old: join(dir, `${tag}-old.pdf`), new: join(dir, `${tag}-new.pdf`) };
    writeFileSync(files.old, pair.oldBytes);
    writeFileSync(files.new, pair.newBytes);
    const [od, nd] = await Promise.all([openDoc(pair.oldBytes), openDoc(pair.newBytes)]);

    // JS: warm-up (pdf.js builds and caches the operator lists, as the visible
    // render does in the app), then fresh masks each run.
    let js = await jsPipeline(od, nd, { autoAlign: shift });
    const jsRuns = [];
    for (let i = 0; i < repeat; i++) { js = await jsPipeline(od, nd, { autoAlign: shift }); jsRuns.push(js.times); }
    const jsMed = Object.fromEntries(Object.keys(jsRuns[0]).map((k) => [k, median(jsRuns.map((t) => t[k]))]));

    // Rust: warm-up (document parse), then each run after a trim (the worker
    // drops page handles and its mask cache, so masks are rendered afresh).
    const sizes = { old: js.oldSize, new: js.newSize };
    let rs = await rustPipeline(worker, files, sizes, { autoAlign: shift });
    const rsRuns = [];
    const rsStats = [];
    for (let i = 0; i < repeat; i++) {
      worker.send({ op: 'trim' });
      rs = await rustPipeline(worker, files, sizes, { autoAlign: shift });
      rsRuns.push(rs.ms);
      rsStats.push(rs.resp.stats);
    }
    const cachedRuns = [];
    for (let i = 0; i < repeat; i++) cachedRuns.push((await rustPipeline(worker, files, sizes, { autoAlign: shift })).ms);
    const st = Object.fromEntries(Object.keys(rsStats[0]).map((k) => [k, median(rsStats.map((s) => s[k]))]));

    const p = parity(js.clusters, rs.clusters, js.mmPerPx, js.params.minAreaPx, js.params.mergePx);
    const jsTruth = truthFound(js.clusters, pair.truth, js.mmPerPx, shift);
    const rsTruth = truthFound(rs.clusters, pair.truth, js.mmPerPx, shift);
    const alignDiff = shift ? {
      dx: Math.abs(js.alignment.dx - rs.resp.alignment.dx), dy: Math.abs(js.alignment.dy - rs.resp.alignment.dy),
      rot: Math.abs(js.alignment.rotation - rs.resp.alignment.rotation), scale: Math.abs(js.alignment.scale - rs.resp.alignment.scale),
    } : null;
    const ok = jsTruth && rsTruth && p.unmatchedLarge.length === 0 && p.edgeMm <= 1.0
      && (!alignDiff || (alignDiff.dx < 0.1 && alignDiff.dy < 0.1 && alignDiff.rot < 0.02 && alignDiff.scale < 0.001));
    if (!ok) failed = true;
    rows.push({ tag, mask: `${js.mask.width}x${js.mask.height}`, jsMed, rsMed: median(rsRuns), cached: median(cachedRuns), st, p, jsTruth, rsTruth, alignDiff, ok, nJs: js.clusters.length, nRs: rs.clusters.length, ipcBytes: rs.resp.shm_bytes });
  }
}
await worker.stop();

const f = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
console.log('\nJS pipeline per stage (ms, median of fresh-mask runs; render = pdf.js tiles + getImageData)');
console.log('pair      | mask       | preview | render |   ink | align | detect | total');
for (const r of rows) {
  const t = r.jsMed;
  console.log(`${r.tag.padEnd(9)} | ${r.mask.padEnd(10)} | ${f(t.preview).padStart(7)} | ${f(t.render).padStart(6)} | ${f(t.ink).padStart(5)} | ${f(t.align).padStart(5)} | ${f(t.detect).padStart(6)} | ${f(t.total).padStart(5)}`);
}
console.log('\nworker per stage (ms, median, from the worker\'s own stats; render = PDFium tiles)');
console.log('pair      | preview | render |   ink | align | detect | total');
for (const r of rows) {
  const s = r.st;
  console.log(`${r.tag.padEnd(9)} | ${f(s.preview_ms).padStart(7)} | ${f(s.render_ms).padStart(6)} | ${f(s.ink_ms).padStart(5)} | ${f(s.align_ms).padStart(5)} | ${f(s.detect_ms).padStart(6)} | ${f(s.total_ms).padStart(5)}`);
}
console.log('\nend to end (ms): JS fresh masks vs worker incl. stdin/stdout + SHM read + decode');
console.log('pair      | JS total | Rust e2e | speed-up | Rust masks cached | result bytes');
for (const r of rows) {
  console.log(`${r.tag.padEnd(9)} | ${f(r.jsMed.total).padStart(8)} | ${f(r.rsMed).padStart(8)} | ${(r.jsMed.total / r.rsMed).toFixed(1).padStart(7)}x | ${f(r.cached).padStart(17)} | ${String(r.ipcBytes).padStart(12)}`);
}
console.log('\nparity (pdf.js vs PDFium rendering, same thresholds)');
console.log('pair      | JS | Rust | matched (split) | only JS | only Rust | max edge px (mm) | max pixelCount diff | min IoU | edits found JS/Rust | alignment diff');
for (const r of rows) {
  const p = r.p;
  const ad = r.alignDiff ? `dx ${r.alignDiff.dx.toFixed(3)} dy ${r.alignDiff.dy.toFixed(3)} mm, rot ${r.alignDiff.rot.toFixed(4)} deg, scale ${r.alignDiff.scale.toExponential(1)}` : '-';
  console.log(`${r.tag.padEnd(9)} | ${String(r.nJs).padStart(2)} | ${String(r.nRs).padStart(4)} | ${String(p.matched).padStart(7)} (${p.splits}) | ${String(p.onlyJs).padStart(7)} | ${String(p.onlyRs).padStart(9)} | ${String(p.edgePx).padStart(6)} (${p.edgeMm.toFixed(2)}) | ${(p.countRel * 100).toFixed(1).padStart(18)}% | ${p.minIou.toFixed(2)} | ${r.jsTruth}/${r.rsTruth} | ${ad}${r.ok ? '' : '  <-- FAIL'}`);
  for (const c of p.unmatchedLarge) console.log(`            unmatched ${c.type} ${c.x},${c.y} ${c.width}x${c.height} (${c.pixelCount} px)`);
}
if (check && failed) {
  console.error('\nparity check failed');
  process.exit(1);
}
