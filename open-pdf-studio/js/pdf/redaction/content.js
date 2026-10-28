// Content-stream rewriting for secure redaction (#762).
//
// Interprets a page's (or Form XObject's) content with its graphics state and
// writes a new content stream without what lies under the redaction areas:
//
// - Text: every glyph whose box (advance width × font ascent/descent, through
//   the text-rendering matrix) touches an area is removed from its string. The
//   string operator becomes a TJ array in which each removed glyph is replaced
//   by a position adjustment of exactly its advance (width, Tc, Tw), so the
//   remaining glyphs keep their positions. Invisible text (OCR layers) is
//   treated the same. ActualText/Alt/E of marked content that lost a glyph,
//   image or path is dropped, and the MCIDs are reported for the structure tree.
// - Paths: subpaths that touch an area are cut. Fills are replaced by the
//   part of the subpath outside the area (polygon minus convex region, curves
//   flattened); strokes by the pieces of the (flattened) centre line outside
//   the area, with the dash phase carried over. Untouched subpaths are written
//   unchanged. Clipping paths are kept (they paint nothing).
// - Images (XObjects and inline): covered pixels are overwritten (images.js);
//   an image entirely inside an area is removed.
// - Form XObjects that reach an area are rewritten recursively into a copy for
//   this one use, so a form shared with other pages or placements is never
//   changed in place.
// - Shadings (sh) are painted with a clip that excludes the areas.
//
// Everything unknown fails closed: text in a font whose metrics cannot be
// determined, an image that cannot be decoded, or a form nested too deeply
// near an area throws an error with a `code` instead of leaving the content.

import { lexContent, Name, Str, ser, fmtNum, bytesOf } from './lexer.js';
import {
  IDENTITY, mul, apply, invert, scaleOf, rectQuad, convexIntersect, normaliseConvex, segmentInside,
  subtractConvex, flattenCubic, pointInPolygon, bboxOf, bboxesOverlap,
} from './geometry.js';
import { loadFont, unknownFont } from './fonts.js';
import { redactImageStream, coveredPixels } from './images.js';
import {
  N, PDFDict, PDFArray, PDFName, PDFNumber, PDFRef, PDFStream, PDFBool, PDFHexString, get, nameOf, numOf, numbers, resolve, streamBytes,
} from './pdf-values.js';

export const OVERLAY_TAG = 'OPSRedact';
const MAX_FORM_DEPTH = 24;

export class RedactionError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

const fail = (code, detail) => { throw new RedactionError(code, detail); };

/** Convert a lexer value to a pdf-lib value (for inline image dictionaries). */
export function lexToPdf(context, v) {
  if (typeof v === 'number') return PDFNumber.of(v);
  if (typeof v === 'boolean') return v ? PDFBool.True : PDFBool.False;
  if (v instanceof Name) return PDFName.of(v.v);
  if (Array.isArray(v)) return context.obj(v.map((x) => lexToPdf(context, x)));
  if (v instanceof Map) { const d = context.obj({}); for (const [k, x] of v) d.set(PDFName.of(k), lexToPdf(context, x)); return d; }
  if (v instanceof Str) return PDFHexString.of(Array.from(v.bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
  return context.obj(null);
}

const INLINE_ABBR = { Width: 'W', Height: 'H', BitsPerComponent: 'BPC', ColorSpace: 'CS', Decode: 'D', ImageMask: 'IM', Interpolate: 'I' };
const INLINE_NAME_ABBR = { DeviceGray: 'G', DeviceRGB: 'RGB', DeviceCMYK: 'CMYK', Indexed: 'I' };

/** pdf-lib value → content-stream syntax (for re-emitting inline images). */
function pdfToSyntax(context, v, abbrNames = false) {
  v = resolve(context, v);
  if (v instanceof PDFNumber) return fmtNum(v.asNumber());
  if (v instanceof PDFName) { const n = v.decodeText(); return ser(new Name(abbrNames && INLINE_NAME_ABBR[n] ? INLINE_NAME_ABBR[n] : n)); }
  if (v instanceof PDFBool) return v.asBoolean() ? 'true' : 'false';
  if (v instanceof PDFArray) return '[' + v.asArray().map((x) => pdfToSyntax(context, x, abbrNames)).join(' ') + ']';
  if (v && typeof v.asBytes === 'function') return ser(new Str(v.asBytes()));
  if (v instanceof PDFDict) { let s = '<<'; for (const [k, x] of v.entries()) s += ser(new Name(k.decodeText())) + ' ' + pdfToSyntax(context, x, abbrNames) + ' '; return s + '>>'; }
  return 'null';
}

const ALLOWED_IN_OVERLAY = new Set(['q', 'Q', 'cm', 'rg', 'RG', 'g', 'G', 'k', 'K', 're', 'f', 'F', 'h', 'm', 'l', 'n', 'w', 'cs', 'CS', 'sc', 'scn', 'SC', 'SCN', 'EMC', 'BMC']);

function initialState(start = {}) {
  return {
    ctm: start.ctm ? start.ctm.slice() : IDENTITY.slice(),
    font: start.font ?? null, fontInfo: start.fontInfo ?? null, fs: start.fs ?? 0,
    tc: start.tc ?? 0, tw: start.tw ?? 0, th: start.th ?? 1, tl: start.tl ?? 0, ts: start.ts ?? 0, tr: start.tr ?? 0,
    lw: start.lw ?? 1, dash: start.dash ?? null,
  };
}
const cloneState = (g) => ({ ...g, ctm: g.ctm.slice() });

/**
 * @typedef {object} Env
 * @property {import('pdf-lib').PDFContext} context
 * @property {number[][][]} regions convex CCW polygons in page space
 * @property {number[]} fill rgb 0..1 (for image pixels)
 * @property {object} stats counters
 * @property {Set<number>} mcids MCIDs (page level) whose content lost something
 * @property {number[]} pageBox [x0,y0,x1,y1] of the page (default user space)
 * @property {Map} fontCache
 */

/**
 * Rewrite content streams.
 * @param {Env} env
 * @param {Uint8Array[]} streams decoded content streams (in order)
 * @param {PDFDict|null} resources
 * @param {object} start initial graphics state ({ctm, …})
 * @param {number} depth
 * @param {Set<string>} formStack refs of forms being processed (cycle guard)
 * @returns {Promise<{outputs: (Uint8Array|null)[], xobjects: Map<string, PDFRef>}>}
 *   outputs[i] is null when stream i is unchanged.
 */
export async function rewriteContent(env, streams, resources, start = {}, depth = 0, formStack = new Set()) {
  const { context, regions } = env;
  const xobjects = new Map(); // new resource name → ref
  const out = streams.map(() => []); // chunks per stream
  const changed = streams.map(() => false);
  let gs = initialState(start);
  const stack = [];
  let tm = null, tlm = null, unc = 0;
  // Marked content: [{chunkRef, tag, props, mcid, flagged, si}]
  const marked = [];
  // Pending path: {segs: subpaths, chunks: [{si, chunk}], clip: null|'W'|'W*'}
  let path = null;
  let cur = null; // current point (user space)

  const xobjDict = resources ? get(context, resources, 'XObject') : null;
  const fontDict = resources ? get(context, resources, 'Font') : null;
  const extG = resources ? get(context, resources, 'ExtGState') : null;
  const propsDict = resources ? get(context, resources, 'Properties') : null;
  const usedNames = new Set(xobjDict instanceof PDFDict ? xobjDict.keys().map((k) => k.decodeText()) : []);
  const newName = (prefix) => { let i = 1; while (usedNames.has(prefix + i)) i++; usedNames.add(prefix + i); return prefix + i; };

  const regionHit = (quad) => regions.some((r) => convexIntersect(quad, r));
  const flagRemoval = () => {
    for (const m of marked) m.flagged = true;
    for (const m of marked) if (m.mcid !== null && m.mcid !== undefined && depth === 0) env.mcids.add(m.mcid);
    if (depth > 0) env.formMcidsTouched = true;
  };

  const fontFor = (name) => {
    const ref = fontDict instanceof PDFDict ? fontDict.get(N(name)) : undefined;
    if (ref === undefined) return unknownFont();
    const key = ref instanceof PDFRef ? ref.tag : ref;
    if (env.fontCache.has(key)) return env.fontCache.get(key);
    const f = loadFont(context, ref);
    env.fontCache.set(key, f);
    return f;
  };

  const emit = (si, chunk) => { out[si].push(chunk); };
  const raw = (si, op) => streams[si].subarray(op.s, op.e);

  // ── Text ──
  const showElements = (elements) => {
    const info = gs.fontInfo || unknownFont();
    const fs = gs.fs, th = gs.th;
    const vertical = info.vertical;
    const result = [];
    let removedAny = false;
    let run = [];
    const flushRun = () => { if (run.length) { result.push(new Str(Uint8Array.from(run), true)); run = []; } };
    const pushNum = (n) => { flushRun(); if (typeof result[result.length - 1] === 'number') result[result.length - 1] += n; else result.push(n); };
    const advance = (dx, dy) => { tm = mul([1, 0, 0, 1, dx, dy], tm); };
    for (const el of elements) {
      if (typeof el === 'number') {
        if (vertical) advance(0, -el / 1000 * fs); else advance(-el / 1000 * fs * th, 0);
        pushNum(el);
        continue;
      }
      if (!(el instanceof Str)) continue;
      const glyphs = info.glyphs(el.bytes);
      for (const g of glyphs) {
        const tw = g.space ? gs.tw : 0;
        const M = mul(tm, gs.ctm);
        let box, adv;
        if (!vertical) {
          adv = [(g.w * fs + gs.tc + tw) * th, 0];
          box = [0, info.descent * fs + gs.ts, g.w * fs * th, info.ascent * fs + gs.ts];
        } else {
          adv = [0, (g.w1 ?? -1) * fs + gs.tc + tw];
          const half = (g.w || 1) * fs * th / 2;
          box = [-half, (g.w1 ?? -1) * fs + gs.ts, half, gs.ts];
        }
        // Unknown advances earlier in this run: the glyph lies somewhere along
        // the baseline within ±unc of the computed position.
        const pad = unc;
        const px = vertical ? 0 : pad, py = vertical ? pad : 0;
        const bx = [Math.min(box[0], box[2]) - px, Math.min(box[1], box[3]) - py, Math.max(box[0], box[2]) + px, Math.max(box[1], box[3]) + py];
        const quad = rectQuad(M, bx[0], bx[1], bx[2], bx[3]);
        const hit = regionHit(quad);
        if (!g.known || pad > 0) {
          if (hit) fail('REDACTION_UNSUPPORTED_FONT', 'text in a font whose glyph widths are unknown lies near a redaction area');
        }
        if (!g.known) {
          // Unknown advance: assume none, but widen every later glyph box by the bound.
          unc += Math.abs(g.w * fs * th) + Math.abs(gs.tc * th) + Math.abs(tw * th);
          for (let k = 0; k < g.len; k++) run.push(el.bytes[g.start + k]);
          continue;
        }
        if (hit) {
          removedAny = true;
          env.stats.glyphs++;
          if (fs !== 0) pushNum(vertical ? -adv[1] * 1000 / fs : -(g.w * fs + gs.tc + tw) * 1000 / fs);
          else env.stats.zeroSizeGlyphs++;
          advance(adv[0], adv[1]);
          continue;
        }
        for (let k = 0; k < g.len; k++) run.push(el.bytes[g.start + k]);
        advance(adv[0], adv[1]);
      }
    }
    flushRun();
    if (removedAny) flagRemoval();
    return removedAny ? result : null;
  };

  // ── Paths ──
  const startPath = () => { if (!path) path = { subs: [], chunks: [], clip: null }; };
  const curSub = () => path.subs[path.subs.length - 1];
  const ensureSub = () => {
    const s = curSub();
    if (!s || s.closed) {
      const p = cur || [0, 0];
      path.subs.push({ start: p, segs: [], closed: false, implicit: true });
    }
  };

  const flattenSub = (sub, tol) => {
    const pts = [sub.start];
    let p = sub.start;
    for (const s of sub.segs) {
      if (s.t === 'l') { pts.push(s.p); p = s.p; } else { flattenCubic(p, s.c1, s.c2, s.p, tol, pts); p = s.p; }
    }
    return pts;
  };

  const subSyntax = (sub) => {
    let s = `${fmtNum(sub.start[0])} ${fmtNum(sub.start[1])} m\n`;
    for (const g of sub.segs) {
      if (g.t === 'l') s += `${fmtNum(g.p[0])} ${fmtNum(g.p[1])} l\n`;
      else s += `${fmtNum(g.c1[0])} ${fmtNum(g.c1[1])} ${fmtNum(g.c2[0])} ${fmtNum(g.c2[1])} ${fmtNum(g.p[0])} ${fmtNum(g.p[1])} c\n`;
    }
    if (sub.closed) s += 'h\n';
    return s;
  };
  const polySyntax = (poly, close = true) => {
    let s = '';
    poly.forEach((p, i) => { s += `${fmtNum(p[0])} ${fmtNum(p[1])} ${i ? 'l' : 'm'}\n`; });
    return close ? s + 'h\n' : s;
  };

  const paintPath = (si, opTok) => {
    const op = opTok.op;
    const p = path;
    path = null;
    const flushRaw = () => { for (const c of p.chunks) emit(c.si, c.chunk); emit(si, raw(si, opTok)); };
    if (op === 'n' || !p.subs.length) return flushRaw();
    const closeLast = op === 's' || op === 'b' || op === 'b*';
    if (closeLast && p.subs.length) p.subs[p.subs.length - 1].closed = true;
    const fills = ['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(op);
    const strokes = ['S', 's', 'B', 'B*', 'b', 'b*'].includes(op);
    const evenOdd = op === 'f*' || op === 'B*' || op === 'b*';
    const inv = invert(gs.ctm);
    if (!inv) return flushRaw(); // singular CTM: nothing is painted
    const userRegions = regions.map((r) => normaliseConvex(r.map(([x, y]) => apply(inv, x, y)))).filter(Boolean);
    if (!userRegions.length) return flushRaw();
    const tol = 0.05 / scaleOf(gs.ctm);
    const rb = userRegions.map(bboxOf);
    const flat = p.subs.map((sub) => flattenSub(sub, tol));
    const hitFill = flat.map((pts) => {
      const bb = bboxOf(pts);
      return userRegions.some((C, k) => {
        if (!bboxesOverlap(bb, rb[k])) return false;
        for (let i = 0; i < pts.length; i++) if (segmentInside(C, pts[i], pts[(i + 1) % pts.length])) return true;
        return C.some(([x, y]) => pointInPolygon(pts, x, y));
      });
    });
    const hitStroke = flat.map((pts, i) => {
      const bb = bboxOf(pts);
      const closed = p.subs[i].closed;
      return userRegions.some((C, k) => {
        if (!bboxesOverlap(bb, rb[k])) return false;
        const n = closed ? pts.length : pts.length - 1;
        if (pts.length === 1) return segmentInside(C, pts[0], pts[0]) !== null;
        for (let j = 0; j < n; j++) if (segmentInside(C, pts[j], pts[(j + 1) % pts.length])) return true;
        return false;
      });
    });
    const anyHit = (fills && hitFill.some(Boolean)) || (strokes && hitStroke.some(Boolean));
    if (!anyHit) return flushRaw();
    // Rewrite: the construction chunks go, the painting is replaced.
    for (const c of p.chunks) changed[c.si] = true;
    changed[si] = true;
    env.stats.paths++;
    flagRemoval();
    let s = '';
    if (fills) {
      let body = '';
      p.subs.forEach((sub, i) => {
        if (!hitFill[i]) { body += subSyntax(sub); return; }
        let pieces = [flat[i]];
        for (const C of userRegions) {
          const next = [];
          for (const poly of pieces) {
            const bb = bboxOf(poly), cb = bboxOf(C);
            if (!bboxesOverlap(bb, cb)) { next.push(poly); continue; }
            next.push(...subtractConvex(poly, C));
          }
          pieces = next;
        }
        for (const poly of pieces) body += polySyntax(poly);
      });
      if (body) s += body + (evenOdd ? 'f*\n' : 'f\n');
    }
    if (strokes) {
      const dashed = gs.dash && gs.dash.arr.length > 0 && gs.dash.arr.some((v) => v > 0);
      let body = '';
      const runsAll = [];
      p.subs.forEach((sub, i) => {
        if (!hitStroke[i]) { body += subSyntax(sub); return; }
        const pts = flat[i].slice();
        if (sub.closed && pts.length > 1) pts.push(pts[0]);
        // Runs with their arc-length offset from the subpath start.
        let runs = [{ pts, offset: 0 }];
        let total = 0;
        for (let j = 1; j < pts.length; j++) total += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
        for (const C of userRegions) runs = runs.flatMap((r) => cutRun(r, C));
        // A closed subpath cut somewhere keeps its join at the start point.
        if (sub.closed && runs.length > 1) {
          const first = runs[0], last = runs[runs.length - 1];
          const lastEnd = last.offset + runLength(last.pts);
          if (first.offset < 1e-9 && Math.abs(lastEnd - total) < 1e-6) {
            runs = [{ pts: last.pts.concat(first.pts.slice(1)), offset: last.offset }, ...runs.slice(1, -1)];
          }
        }
        runsAll.push(...runs);
      });
      if (!dashed) {
        for (const r of runsAll) if (r.pts.length > 1) body += polySyntax(r.pts, false);
        if (body) s += body + 'S\n';
      } else {
        if (body) s += body + 'S\n';
        const arr = '[' + gs.dash.arr.map(fmtNum).join(' ') + ']';
        let inner = '';
        for (const r of runsAll) {
          if (r.pts.length < 2) continue;
          inner += `${arr} ${fmtNum(gs.dash.phase + r.offset)} d\n` + polySyntax(r.pts, false) + 'S\n';
        }
        if (inner) s += 'q\n' + inner + 'Q\n';
      }
    }
    if (p.clip) {
      // The clip uses the original path; it takes effect after the painting.
      for (const sub of p.subs) s += subSyntax(sub);
      s += p.clip + ' n\n';
    }
    emit(si, s);
  };

  // ── Shading ──
  const shadingClip = () => {
    const inv = invert(gs.ctm);
    if (!inv) return null;
    const box = env.pageBox;
    const bb = bboxOf([...regions.flat(), [box[0], box[1]], [box[2], box[3]]]);
    const m = 10;
    const outer = [[bb[0] - m, bb[1] - m], [bb[2] + m, bb[1] - m], [bb[2] + m, bb[3] + m], [bb[0] - m, bb[3] + m]].map(([x, y]) => apply(inv, x, y));
    let s = '';
    for (const r of regions) {
      const hole = r.map(([x, y]) => apply(inv, x, y));
      s += polySyntax(outer) + polySyntax(hole) + 'W* n\n';
    }
    return s;
  };

  // ── Main loop ──
  for (let si = 0; si < streams.length; si++) {
    const ops = lexContent(streams[si]);
    for (let oi = 0; oi < ops.length; oi++) {
      const o = ops[oi];
      const a = o.operands;
      const nums = a.filter((x) => typeof x === 'number');
      const lastNum = (k = 0) => nums[nums.length - 1 - k];
      // Path construction is buffered until the painting operator.
      if (['m', 'l', 'c', 'v', 'y', 'h', 're'].includes(o.op)) {
        startPath();
        path.chunks.push({ si, chunk: raw(si, o) });
        if (o.op === 'm' && nums.length >= 2) { cur = [lastNum(1), lastNum(0)]; path.subs.push({ start: cur, segs: [], closed: false }); }
        else if (o.op === 'l' && nums.length >= 2) { ensureSub(); const p = [lastNum(1), lastNum(0)]; curSub().segs.push({ t: 'l', p }); cur = p; }
        else if (o.op === 'c' && nums.length >= 6) { ensureSub(); const n6 = nums.slice(-6); const seg = { t: 'c', c1: [n6[0], n6[1]], c2: [n6[2], n6[3]], p: [n6[4], n6[5]] }; curSub().segs.push(seg); cur = seg.p; }
        else if (o.op === 'v' && nums.length >= 4) { ensureSub(); const n4 = nums.slice(-4); const seg = { t: 'c', c1: cur || [n4[0], n4[1]], c2: [n4[0], n4[1]], p: [n4[2], n4[3]] }; curSub().segs.push(seg); cur = seg.p; }
        else if (o.op === 'y' && nums.length >= 4) { ensureSub(); const n4 = nums.slice(-4); const seg = { t: 'c', c1: [n4[0], n4[1]], c2: [n4[2], n4[3]], p: [n4[2], n4[3]] }; curSub().segs.push(seg); cur = seg.p; }
        else if (o.op === 'h') { const s = curSub(); if (s) { s.closed = true; cur = s.start; } }
        else if (o.op === 're' && nums.length >= 4) {
          const [x, y, w, h] = nums.slice(-4);
          path.subs.push({ start: [x, y], segs: [{ t: 'l', p: [x + w, y] }, { t: 'l', p: [x + w, y + h] }, { t: 'l', p: [x, y + h] }], closed: true });
          cur = [x, y];
        }
        continue;
      }
      if (o.op === 'W' || o.op === 'W*') {
        startPath(); path.clip = o.op; path.chunks.push({ si, chunk: raw(si, o) }); continue;
      }
      if (['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'].includes(o.op)) {
        if (!path) { emit(si, raw(si, o)); continue; }
        paintPath(si, o);
        cur = null;
        continue;
      }
      if (path) { // stray operator inside a path: flush the path unchanged
        for (const c of path.chunks) emit(c.si, c.chunk);
        path = null;
      }
      switch (o.op) {
        case 'q': stack.push(cloneState(gs)); emit(si, raw(si, o)); break;
        case 'Q': if (stack.length) gs = stack.pop(); emit(si, raw(si, o)); break;
        case 'cm': if (nums.length >= 6) gs.ctm = mul(nums.slice(-6), gs.ctm); emit(si, raw(si, o)); break;
        case 'w': if (nums.length) gs.lw = lastNum(); emit(si, raw(si, o)); break;
        case 'd': {
          const arr = a.find(Array.isArray);
          gs.dash = { arr: (arr || []).filter((x) => typeof x === 'number'), phase: typeof a[a.length - 1] === 'number' ? a[a.length - 1] : 0 };
          emit(si, raw(si, o)); break;
        }
        case 'gs': {
          const nm = a.find((x) => x instanceof Name);
          const g = nm && extG instanceof PDFDict ? get(context, extG, nm.v) : null;
          if (g instanceof PDFDict) {
            const lw = numOf(get(context, g, 'LW'));
            if (lw !== null) gs.lw = lw;
            const D = get(context, g, 'D');
            if (D instanceof PDFArray) {
              const arr = numbers(context, D.get(0)) || [];
              gs.dash = { arr, phase: numOf(resolve(context, D.get(1)), 0) };
            }
            const F = get(context, g, 'Font');
            if (F instanceof PDFArray) {
              const fref = F.get(0);
              const key = fref instanceof PDFRef ? fref.tag : fref;
              if (!env.fontCache.has(key)) env.fontCache.set(key, loadFont(context, fref));
              gs.fontInfo = env.fontCache.get(key);
              gs.fs = numOf(resolve(context, F.get(1)), gs.fs);
            }
          }
          emit(si, raw(si, o)); break;
        }
        case 'BT': tm = IDENTITY.slice(); tlm = IDENTITY.slice(); unc = 0; emit(si, raw(si, o)); break;
        case 'ET': tm = null; tlm = null; unc = 0; emit(si, raw(si, o)); break;
        case 'Tc': if (nums.length) gs.tc = lastNum(); emit(si, raw(si, o)); break;
        case 'Tw': if (nums.length) gs.tw = lastNum(); emit(si, raw(si, o)); break;
        case 'Tz': if (nums.length) gs.th = lastNum() / 100; emit(si, raw(si, o)); break;
        case 'TL': if (nums.length) gs.tl = lastNum(); emit(si, raw(si, o)); break;
        case 'Ts': if (nums.length) gs.ts = lastNum(); emit(si, raw(si, o)); break;
        case 'Tr': if (nums.length) gs.tr = lastNum(); emit(si, raw(si, o)); break;
        case 'Tf': {
          const nm = a.find((x) => x instanceof Name);
          if (nm) { gs.font = nm.v; gs.fontInfo = fontFor(nm.v); }
          if (nums.length) gs.fs = lastNum();
          emit(si, raw(si, o)); break;
        }
        case 'Td': case 'TD': {
          if (nums.length >= 2) {
            const tx = lastNum(1), ty = lastNum(0);
            if (o.op === 'TD') gs.tl = -ty;
            tlm = mul([1, 0, 0, 1, tx, ty], tlm || IDENTITY); tm = tlm.slice(); unc = 0;
          }
          emit(si, raw(si, o)); break;
        }
        case 'Tm': if (nums.length >= 6) { tlm = nums.slice(-6); tm = tlm.slice(); unc = 0; } emit(si, raw(si, o)); break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm || IDENTITY); tm = tlm.slice(); unc = 0; emit(si, raw(si, o)); break;
        case 'Tj': case 'TJ': case "'": case '"': {
          if (!tm) { tm = IDENTITY.slice(); tlm = IDENTITY.slice(); }
          let prefix = '';
          if (o.op === '"') {
            if (nums.length >= 2) { gs.tw = nums[0]; gs.tc = nums[1]; prefix = `${fmtNum(gs.tw)} Tw ${fmtNum(gs.tc)} Tc `; }
          }
          if (o.op === "'" || o.op === '"') { tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm.slice(); unc = 0; prefix += 'T* '; }
          let elements;
          if (o.op === 'TJ') elements = a.find(Array.isArray) || [];
          else { const st = a.filter((x) => x instanceof Str); elements = st.length ? [st[st.length - 1]] : []; }
          const res = showElements(elements);
          if (!res) { emit(si, raw(si, o)); break; }
          changed[si] = true;
          emit(si, prefix + ser(res) + ' TJ');
          break;
        }
        case 'BMC': case 'BDC': {
          const tag = a.find((x) => x instanceof Name)?.v;
          // The overlay this module draws: copied as is when it only paints.
          if (tag === OVERLAY_TAG && o.op === 'BMC') {
            let depthM = 0, j = oi, ok = true;
            for (; j < ops.length; j++) {
              const x = ops[j].op;
              if (x === 'BMC' || x === 'BDC') depthM++;
              else if (x === 'EMC' && --depthM === 0) break;
              if (!ALLOWED_IN_OVERLAY.has(x)) { ok = false; break; }
            }
            if (ok && j < ops.length) {
              for (let k = oi; k <= j; k++) {
                const x = ops[k];
                emit(si, raw(si, x));
                // Keep the graphics state consistent (q/Q/cm only appear balanced inside).
              }
              oi = j;
              break;
            }
          }
          let props = null, inline = false;
          if (o.op === 'BDC') {
            const last = a[a.length - 1];
            if (last instanceof Map) { props = last; inline = true; }
            else if (last instanceof Name && propsDict instanceof PDFDict) props = get(context, propsDict, last.v) || null;
          }
          let mcid = null;
          if (props instanceof Map && typeof props.get('MCID') === 'number') mcid = props.get('MCID');
          else if (props instanceof PDFDict) mcid = numOf(get(context, props, 'MCID'));
          const entry = { tag, props, inline, mcid, flagged: false, op: o, si, text: null };
          marked.push(entry);
          const chunk = { marked: entry };
          emit(si, chunk);
          break;
        }
        case 'EMC': marked.pop(); emit(si, raw(si, o)); break;
        case 'Do': {
          const nm = a.find((x) => x instanceof Name);
          const ref = nm && xobjDict instanceof PDFDict ? xobjDict.get(N(nm.v)) : undefined;
          const x = resolve(context, ref);
          if (!(x instanceof PDFStream)) { emit(si, raw(si, o)); break; }
          const sub = nameOf(get(context, x, 'Subtype'));
          if (sub === 'Image') {
            const quad = rectQuad(gs.ctm, 0, 0, 1, 1);
            if (!regionHit(quad)) { emit(si, raw(si, o)); break; }
            let res;
            try {
              res = await redactImageStream(context, x, gs.ctm, regions, env.fill, { resources });
            } catch (e) {
              if (e?.code) throw new RedactionError(e.code, e.detail);
              throw new RedactionError('REDACTION_UNSUPPORTED_IMAGE', e?.message || String(e));
            }
            if (!res) { emit(si, raw(si, o)); break; }
            changed[si] = true; env.stats.images++; flagRemoval();
            if (res.drop) { emit(si, ''); break; }
            const name = newName('RdIm');
            xobjects.set(name, context.register(res.stream));
            emit(si, `${ser(new Name(name))} Do`);
            break;
          }
          if (sub === 'Form') {
            const matrix = numbers(context, get(context, x, 'Matrix')) || IDENTITY.slice();
            const fctm = mul(matrix, gs.ctm);
            const bbox = numbers(context, get(context, x, 'BBox'));
            if (bbox && bbox.length === 4) {
              const q = rectQuad(fctm, Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3]));
              if (!regionHit(q)) { emit(si, raw(si, o)); break; }
            }
            const tag = ref instanceof PDFRef ? ref.tag : null;
            if (depth >= MAX_FORM_DEPTH || (tag && formStack.has(tag))) fail('REDACTION_UNSUPPORTED_FORM', 'Form XObjects nested too deeply (or recursively) under a redaction area');
            const fres = get(context, x, 'Resources');
            const childRes = fres instanceof PDFDict ? fres : resources;
            let bytes;
            try { bytes = streamBytes(x); } catch (e) { fail('REDACTION_UNSUPPORTED_FORM', `form content cannot be decoded (${e?.message || e})`); }
            const nextStack = new Set(formStack); if (tag) nextStack.add(tag);
            const r = await rewriteContent(env, [bytes], childRes, { ...gs, ctm: fctm }, depth + 1, nextStack);
            if (!r.outputs[0] && !r.xobjects.size) { emit(si, raw(si, o)); break; }
            // A copy of the form for this one use.
            const entries = {};
            for (const [k, v] of x.dict.entries()) {
              const key = k.decodeText();
              if (key === 'Length' || key === 'Filter' || key === 'DecodeParms' || key === 'DL') continue;
              entries[key] = v;
            }
            if (r.xobjects.size) entries.Resources = withXObjects(context, childRes, r.xobjects);
            const copy = context.flateStream(r.outputs[0] || bytes, entries);
            const name = newName('RdFm');
            xobjects.set(name, context.register(copy));
            changed[si] = true; env.stats.forms++;
            if (env.formMcidsTouched) { flagRemoval(); env.formMcidsTouched = false; }
            emit(si, `${ser(new Name(name))} Do`);
            break;
          }
          emit(si, raw(si, o));
          break;
        }
        case 'BI': {
          const inl = o.inline;
          const w = inl.dict.get('Width'), h = inl.dict.get('Height');
          const quad = rectQuad(gs.ctm, 0, 0, 1, 1);
          if (!regionHit(quad)) { emit(si, raw(si, o)); break; }
          if (!(w > 0 && h > 0)) fail('REDACTION_UNSUPPORTED_IMAGE', 'inline image without size under a redaction area');
          const entries = {};
          for (const [k, v] of inl.dict) entries[k] = lexToPdf(context, v);
          const tmp = context.stream(inl.data, entries);
          let res;
          try {
            res = await redactImageStream(context, tmp, gs.ctm, regions, env.fill, { resources });
          } catch (e) {
            throw new RedactionError(e?.code || 'REDACTION_UNSUPPORTED_IMAGE', e?.detail || e?.message || String(e));
          }
          if (!res) { emit(si, raw(si, o)); break; }
          changed[si] = true; env.stats.images++; flagRemoval();
          if (res.drop) { emit(si, ''); break; }
          emit(si, inlineSyntax(context, res.stream));
          break;
        }
        case 'sh': {
          const s = shadingClip();
          if (!s) { emit(si, raw(si, o)); break; }
          changed[si] = true; env.stats.shadings++;
          emit(si, 'q\n' + s);
          emit(si, raw(si, o));
          emit(si, '\nQ');
          break;
        }
        default: emit(si, raw(si, o));
      }
    }
  }
  if (path) for (const c of path.chunks) emit(c.si, c.chunk);

  // Marked content that lost content: drop its replacement/alternate text.
  const outputs = out.map((chunks, si) => {
    let dirty = changed[si];
    const parts = chunks.map((c) => {
      if (c && c.marked) {
        const m = c.marked;
        if (m.flagged && m.props && m.tag !== 'OC') {
          const stripped = stripAltText(context, m.props);
          if (stripped) { dirty = true; return `${ser(new Name(m.tag))} ${ser(stripped)} BDC`; }
        }
        return streams[m.si].subarray(m.op.s, m.op.e);
      }
      return c;
    });
    if (!dirty) return null;
    return joinChunks(parts);
  });
  return { outputs, xobjects };
}

function runLength(pts) {
  let t = 0;
  for (let j = 1; j < pts.length; j++) t += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
  return t;
}

/** Pieces of polyline run `r` outside convex region C. */
function cutRun(r, C) {
  const out = [];
  let curRun = null;
  let dist = r.offset;
  const pts = r.pts;
  if (pts.length === 1) {
    return segmentInside(C, pts[0], pts[0]) ? [] : [r];
  }
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ins = segmentInside(C, a, b);
    const lerp = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (!ins) {
      if (!curRun) curRun = { pts: [a], offset: dist };
      curRun.pts.push(b);
    } else {
      const [t0, t1] = ins;
      if (t0 > 1e-9) {
        if (!curRun) curRun = { pts: [a], offset: dist };
        curRun.pts.push(lerp(t0));
      }
      if (curRun) { out.push(curRun); curRun = null; }
      if (t1 < 1 - 1e-9) curRun = { pts: [lerp(t1), b], offset: dist + len * t1 };
    }
    dist += len;
  }
  if (curRun) out.push(curRun);
  return out.filter((x) => x.pts.length > 1);
}

/** Inline dict without /ActualText, /Alt, /E; null when there is nothing to strip. */
function stripAltText(context, props) {
  const keys = ['ActualText', 'Alt', 'E'];
  if (props instanceof Map) {
    if (!keys.some((k) => props.has(k))) return null;
    const m = new Map(props);
    for (const k of keys) m.delete(k);
    return m;
  }
  if (props instanceof PDFDict) {
    if (!keys.some((k) => props.has(N(k)))) return null;
    const m = new Map();
    const mcid = numOf(get(context, props, 'MCID'));
    if (mcid !== null) m.set('MCID', mcid);
    return m;
  }
  return null;
}

function joinChunks(parts) {
  const bufs = parts.map((p) => (typeof p === 'string' ? bytesOf(p) : p));
  let len = 0;
  for (const b of bufs) len += b.length + 1;
  const outb = new Uint8Array(len);
  let at = 0;
  for (const b of bufs) { outb.set(b, at); at += b.length; outb[at++] = 10; }
  return outb;
}

/** Copy of a resources dict with extra /XObject entries. */
export function withXObjects(context, resources, xobjects) {
  const res = resources instanceof PDFDict ? resources.clone(context) : context.obj({});
  const old = get(context, res, 'XObject');
  const xd = old instanceof PDFDict ? old.clone(context) : context.obj({});
  for (const [name, ref] of xobjects) xd.set(N(name), ref);
  res.set(N('XObject'), xd);
  return res;
}

/** An image stream as inline image syntax (data as ASCIIHex so no stray EI can occur). */
function inlineSyntax(context, stream) {
  let s = 'BI\n';
  let filter = null;
  for (const [k, v] of stream.dict.entries()) {
    const key = k.decodeText();
    if (key === 'Length' || key === 'Filter' || key === 'DecodeParms' || key === 'Type' || key === 'Subtype') continue;
    s += `/${INLINE_ABBR[key] || key} ${pdfToSyntax(context, v, true)}\n`;
  }
  const f = resolve(context, stream.dict.get(N('Filter')));
  filter = f instanceof PDFName ? f.decodeText() : null;
  const abbr = filter === 'DCTDecode' ? '/DCT' : filter === 'FlateDecode' ? '/Fl' : null;
  s += abbr ? `/F [/AHx ${abbr}]\n` : '/F /AHx\n';
  let hex = '';
  const data = stream.contents;
  for (let i = 0; i < data.length; i++) { hex += (data[i] < 16 ? '0' : '') + data[i].toString(16); if (i % 40 === 39) hex += '\n'; }
  return s + 'ID\n' + hex + '>\nEI';
}

export { coveredPixels };
