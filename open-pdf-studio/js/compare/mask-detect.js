// Change detection on ink masks (#465).
//
// Input: the ink masks of the old and the new page (ink-mask.js) at the same
// millimetre-per-pixel resolution, and the transform that maps old mask pixels
// onto new mask pixels (alignment.js). Output: change clusters in new-mask
// pixels, each with the matching rectangle on the old page.
//
// The page is processed as a stream of rows with a ring buffer of 2·r+1 rows,
// so besides the two masks only a few rows of working memory exist, whatever
// the sheet size:
//
//   1. the old row is resampled into the new pixel grid (nearest neighbour;
//      skipped when the transform is the identity),
//   2. both rows are dilated by the tolerance r (horizontally per row, then
//      vertically over the ring), four pixels per 32-bit word,
//   3. removed = old ink with no new ink within r; added = new ink with no
//      old ink within r,
//   4. changed pixels are collected as horizontal runs and joined into
//      8-connected components with a union-find over runs (not pixels),
//   5. specks below noisePx are dropped, components within mergePx are merged
//      and clusters with less than minAreaPx changed pixels are dropped.
//
// All pixel parameters come from detect-plan.js, which derives them from
// millimetres on paper. Pure module: runs in the detection worker and in node.

import { invert, applyRect } from './alignment.js';

const DEFAULTS = {
  tolerancePx: 1,
  minAreaPx: 5,
  mergePx: 8,
  noisePx: 1,
  maxRuns: 2_000_000,
};

function isIdentity(m) {
  return !m || (Math.abs(m[0] - 1) < 1e-12 && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12
    && Math.abs(m[3] - 1) < 1e-12 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9);
}

function words(mask) {
  const d = mask.data;
  return new Uint32Array(d.buffer, d.byteOffset, (mask.stride * mask.height) >>> 2);
}

// Growable Int32 storage for runs.
function growInt32(arr, need) {
  if (need <= arr.length) return arr;
  let n = arr.length * 2;
  while (n < need) n *= 2;
  const out = new Int32Array(n);
  out.set(arr);
  return out;
}

/**
 * @param {{width:number,height:number,stride:number,data:Uint8Array}} oldMask
 * @param {{width:number,height:number,stride:number,data:Uint8Array}} newMask
 * @param {{transform?:number[]|null, tolerancePx?:number, minAreaPx?:number,
 *   mergePx?:number, noisePx?:number, maxRuns?:number}} [options]
 * @returns {{clusters:Array<{type:string,x:number,y:number,width:number,height:number,pixelCount:number,old:{x:number,y:number,width:number,height:number}}>,
 *   truncated:boolean, runs:number, components:number}}
 */
export function detectMaskChanges(oldMask, newMask, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const W = newMask.width;
  const H = newMask.height;
  const S = newMask.stride;
  const S4 = S >>> 2;
  const r = Math.max(0, Math.floor(opts.tolerancePx));
  const R = 2 * r + 1;
  const T = opts.transform || null;

  const sameGrid = oldMask.width === W && oldMask.height === H && oldMask.stride === S;
  const direct = sameGrid && isIdentity(T);
  const newW = words(newMask);
  const oldW = direct ? words(oldMask) : null;

  // Resampling of old rows into the new grid.
  const inv = invert(T || [1, 0, 0, 1, 0, 0]);
  const oData = oldMask.data;
  const oStride = oldMask.stride;
  const oWidth = oldMask.width;
  const oHeight = oldMask.height;
  const rawRing = direct ? null : new Uint32Array(R * S4);
  const rawBytes = direct ? null : new Uint8Array(rawRing.buffer);
  const rawAny = new Uint8Array(R);
  const newAny = new Uint8Array(R);

  const hOld = new Uint32Array(R * S4);
  const hNew = new Uint32Array(R * S4);
  const tmpA = new Uint32Array(S4);
  const tmpB = new Uint32Array(S4);

  function hdilate(src, srcOff, dst, dstOff) {
    if (r === 0) {
      for (let i = 0; i < S4; i++) dst[dstOff + i] = src[srcOff + i];
      return;
    }
    let from = src;
    let fromOff = srcOff;
    for (let k = 0; k < r; k++) {
      const last = k === r - 1;
      const to = last ? dst : (k % 2 === 0 ? tmpA : tmpB);
      const toOff = last ? dstOff : 0;
      let prev = 0;
      let cur = from[fromOff];
      for (let i = 0; i < S4; i++) {
        const next = i + 1 < S4 ? from[fromOff + i + 1] : 0;
        to[toOff + i] = cur | (cur << 8) | (cur >>> 8) | (prev >>> 24) | (next << 24);
        prev = cur;
        cur = next;
      }
      from = to;
      fromOff = toOff;
    }
  }

  function warpRow(y, slot) {
    const base = slot * S;
    rawBytes.fill(0, base, base + S);
    const yc = y + 0.5;
    let ox = inv[0] * 0.5 + inv[2] * yc + inv[4];
    let oy = inv[1] * 0.5 + inv[3] * yc + inv[5];
    const sx = inv[0];
    const sy = inv[1];
    let any = 0;
    for (let x = 0; x < W; x++, ox += sx, oy += sy) {
      if (ox < 0 || oy < 0) continue;
      const xi = ox | 0;
      const yi = oy | 0;
      if (xi >= oWidth || yi >= oHeight) continue;
      const v = oData[yi * oStride + xi];
      if (v) { rawBytes[base + x] = 1; any = 1; }
    }
    return any;
  }

  function rowAny(arr, off) {
    for (let i = 0; i < S4; i++) if (arr[off + i]) return 1;
    return 0;
  }

  function loadRow(y) {
    const slot = y % R;
    if (direct) {
      rawAny[slot] = rowAny(oldW, y * S4);
      if (rawAny[slot]) hdilate(oldW, y * S4, hOld, slot * S4);
      else hOld.fill(0, slot * S4, slot * S4 + S4);
    } else {
      rawAny[slot] = warpRow(y, slot);
      if (rawAny[slot]) hdilate(rawRing, slot * S4, hOld, slot * S4);
      else hOld.fill(0, slot * S4, slot * S4 + S4);
    }
    newAny[slot] = rowAny(newW, y * S4);
    if (newAny[slot]) hdilate(newW, y * S4, hNew, slot * S4);
    else hNew.fill(0, slot * S4, slot * S4 + S4);
  }

  // Run storage.
  let cap = 4096;
  let rX0 = new Int32Array(cap);
  let rX1 = new Int32Array(cap);
  let rY = new Int32Array(cap);
  let rF = new Int32Array(cap);
  let parent = new Int32Array(cap);
  let nRuns = 0;
  let truncated = false;

  function find(a) {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  }
  function pushRun(x0, x1, y, f) {
    if (nRuns >= cap) {
      cap *= 2;
      rX0 = growInt32(rX0, cap);
      rX1 = growInt32(rX1, cap);
      rY = growInt32(rY, cap);
      rF = growInt32(rF, cap);
      parent = growInt32(parent, cap);
    }
    rX0[nRuns] = x0;
    rX1[nRuns] = x1;
    rY[nRuns] = y;
    rF[nRuns] = f;
    parent[nRuns] = nRuns;
    nRuns++;
  }

  for (let y = 0; y < Math.min(r, H); y++) loadRow(y);

  let prevStart = 0;
  let prevEnd = 0;
  for (let y = 0; y < H; y++) {
    if (y + r < H) loadRow(y + r);
    const slot = y % R;
    const curStart = nRuns;
    if (rawAny[slot] || newAny[slot]) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(H - 1, y + r);
      const rawArr = direct ? oldW : rawRing;
      const rawOff = direct ? y * S4 : slot * S4;
      const newOff = y * S4;
      let open = false;
      let x0 = 0;
      let xl = -2;
      let fl = 0;
      for (let i = 0; i < S4; i++) {
        const o = rawArr[rawOff + i];
        const n = newW[newOff + i];
        if ((o | n) === 0) continue;
        let dO = 0;
        let dN = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const s = (yy % R) * S4 + i;
          dO |= hOld[s];
          dN |= hNew[s];
        }
        const rem = o & ~dN;
        const add = n & ~dO;
        if ((rem | add) === 0) continue;
        for (let j = 0; j < 4; j++) {
          const sh = j << 3;
          const lab = ((rem >>> sh) & 1) | (((add >>> sh) & 1) << 1);
          if (!lab) continue;
          const x = (i << 2) + j;
          if (x >= W) break;
          if (open && x === xl + 1) {
            xl = x;
            fl |= lab;
          } else {
            if (open) pushRun(x0, xl, y, fl);
            open = true;
            x0 = x;
            xl = x;
            fl = lab;
          }
        }
      }
      if (open) pushRun(x0, xl, y, fl);
    }
    const curEnd = nRuns;
    // Join with the runs of the previous row (8-connectivity).
    if (prevEnd > prevStart && curEnd > curStart) {
      let p = prevStart;
      for (let c = curStart; c < curEnd; c++) {
        const a0 = rX0[c] - 1;
        const a1 = rX1[c] + 1;
        while (p < prevEnd && rX1[p] < a0) p++;
        for (let q = p; q < prevEnd && rX0[q] <= a1; q++) union(c, q);
      }
    }
    prevStart = curStart;
    prevEnd = curEnd;
    if (nRuns >= opts.maxRuns) {
      truncated = true;
      break;
    }
  }

  // Components.
  const compOf = new Int32Array(nRuns).fill(-1);
  const comps = [];
  for (let i = 0; i < nRuns; i++) {
    const root = find(i);
    let ci = compOf[root];
    if (ci < 0) {
      ci = comps.length;
      compOf[root] = ci;
      comps.push({ x1: rX0[i], y1: rY[i], x2: rX1[i], y2: rY[i], count: 0, flags: 0 });
    }
    const c = comps[ci];
    if (rX0[i] < c.x1) c.x1 = rX0[i];
    if (rX1[i] > c.x2) c.x2 = rX1[i];
    if (rY[i] < c.y1) c.y1 = rY[i];
    if (rY[i] > c.y2) c.y2 = rY[i];
    c.count += rX1[i] - rX0[i] + 1;
    c.flags |= rF[i];
  }

  const kept = comps.filter((c) => c.count >= opts.noisePx);
  const merged = mergeBoxes(kept, Math.max(0, opts.mergePx));
  const toOld = invert(T || [1, 0, 0, 1, 0, 0]);
  const clusters = [];
  for (const c of merged) {
    if (c.count < opts.minAreaPx) continue;
    const type = (c.flags & 3) === 3 ? 'modified' : (c.flags & 1) ? 'removed' : 'added';
    const rect = { x: c.x1, y: c.y1, width: c.x2 - c.x1 + 1, height: c.y2 - c.y1 + 1 };
    clusters.push({ type, ...rect, pixelCount: c.count, old: applyRect(toOld, rect) });
  }
  clusters.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { clusters, truncated, runs: nRuns, components: comps.length };
}

/**
 * Merge boxes {x1,y1,x2,y2,count,flags} (inclusive pixel bounds) whose gap is
 * at most `prox` pixels on both axes, until nothing is within reach. Uses a
 * uniform grid so thousands of boxes stay fast.
 */
export function mergeBoxes(boxes, prox) {
  let list = boxes.map((b) => ({ ...b }));
  for (let iter = 0; iter < 32 && list.length > 1; iter++) {
    const n = list.length;
    const cell = Math.max(64, prox * 2 + 1);
    const grid = new Map();
    const big = [];
    const KEY = 1 << 20;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const cx1 = Math.floor((b.x1 - prox) / cell);
      const cx2 = Math.floor((b.x2 + prox) / cell);
      const cy1 = Math.floor((b.y1 - prox) / cell);
      const cy2 = Math.floor((b.y2 + prox) / cell);
      if ((cx2 - cx1 + 1) * (cy2 - cy1 + 1) > 256) { big.push(i); continue; }
      for (let cy = cy1; cy <= cy2; cy++) {
        for (let cx = cx1; cx <= cx2; cx++) {
          const k = (cy + 1024) * KEY + (cx + 1024);
          const l = grid.get(k);
          if (l) l.push(i); else grid.set(k, [i]);
        }
      }
    }
    const par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const near = (a, b) => {
      const dx = Math.max(0, Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2) - 1);
      const dy = Math.max(0, Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2) - 1);
      return dx <= prox && dy <= prox;
    };
    let joined = 0;
    const join = (i, j) => {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) { par[Math.max(ri, rj)] = Math.min(ri, rj); joined++; }
    };
    for (const l of grid.values()) {
      for (let a = 0; a < l.length; a++) {
        for (let b = a + 1; b < l.length; b++) {
          if (near(list[l[a]], list[l[b]])) join(l[a], l[b]);
        }
      }
    }
    for (const i of big) {
      for (let j = 0; j < n; j++) if (j !== i && near(list[i], list[j])) join(i, j);
    }
    if (!joined) break;
    const byRoot = new Map();
    for (let i = 0; i < n; i++) {
      const rt = find(i);
      const b = list[i];
      const m = byRoot.get(rt);
      if (!m) byRoot.set(rt, { ...b });
      else {
        if (b.x1 < m.x1) m.x1 = b.x1;
        if (b.y1 < m.y1) m.y1 = b.y1;
        if (b.x2 > m.x2) m.x2 = b.x2;
        if (b.y2 > m.y2) m.y2 = b.y2;
        m.count += b.count;
        m.flags |= b.flags;
      }
    }
    list = [...byRoot.values()];
  }
  return list;
}
