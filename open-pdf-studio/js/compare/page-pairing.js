// Automatic page pairing for Compare (#465).
//
// Index-based pairs break as soon as the new revision inserts, removes or
// reorders a sheet. Pages are matched instead on, in order of trust:
//
//   1. the sheet number read from the title block,
//   2. the page label (only when a document has its own labels),
//   3. a content fingerprint: the words on the page, and for pages with
//      little text a small thumbnail of the ink.
//
// The result is a pairing list the user can correct: matched pairs plus
// pages that exist only in the old or only in the new document.
//
// Pure module: the page information is collected by compare-viewport.js.
// Unit tested in compare-pairing.test.mjs.

// Words near which a token is a sheet number (lower case, several languages).
const SHEET_KEYWORDS = [
  'sheet', 'sheet no', 'sheet nr', 'sheet number', 'drawing no', 'drawing number', 'dwg', 'dwg no', 'drg no',
  'blad', 'bladnr', 'blad nr', 'tekeningnummer', 'tekening nr', 'tek nr', 'tek.nr', 'tekeningnr',
  'blatt', 'blatt nr', 'plan nr', 'plannummer', 'zeichnungsnummer',
  'feuille', 'planche', 'plan n', 'n° plan', 'hoja', 'plano', 'folha', 'foglio', 'tavola', 'arkusz', 'list',
];

const SHEET_RE = /^(?=.*\d)[A-Z]{0,4}[-_.]?\d{1,4}(?:[-_.]\d{1,3}){0,2}[A-Z]?$/i;
const DATE_RE = /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function hasKeyword(text) {
  const t = norm(text).toLowerCase().replace(/[:#.]+$/, '');
  return SHEET_KEYWORDS.some((k) => t === k || t.endsWith(' ' + k) || t.startsWith(k + ' ') || t === k + '.');
}

/**
 * Read a sheet number from the text of a page.
 * @param {Array<{str:string,x:number,y:number,w?:number,h?:number}>} items
 *   positions in page space, top-left origin (points)
 * @param {number} pageW
 * @param {number} pageH
 * @returns {string|null}
 */
export function extractSheetNumber(items, pageW, pageH) {
  if (!Array.isArray(items) || !items.length) return null;
  const list = items
    .map((it) => ({ ...it, str: norm(it.str), h: it.h || 8, w: it.w || 0 }))
    .filter((it) => it.str);
  const keywords = list.filter((it) => hasKeyword(it.str) || hasKeyword(it.str.replace(/[\d\s-]+$/, '')));
  let best = null;
  for (const it of list) {
    // "Sheet: A-101" in one item: take the part after the keyword.
    let token = it.str;
    let inline = false;
    const m = token.match(/^(.*?)[:#]?\s*([A-Z]{0,4}[-_.]?\d{1,4}(?:[-_.]\d{1,3}){0,2}[A-Z]?)$/i);
    if (m && m[1] && hasKeyword(m[1])) { token = m[2]; inline = true; }
    if (!SHEET_RE.test(token) || DATE_RE.test(token)) continue;
    const digitsOnly = /^\d+$/.test(token);
    let score = 0;
    if (it.x > pageW * 0.5 && it.y > pageH * 0.55) score += 3;
    if (inline) score += 5;
    for (const k of keywords) {
      if (k === it) continue;
      const sameLine = Math.abs(k.y - it.y) < Math.max(k.h, it.h) * 0.8 && k.x < it.x && it.x - (k.x + k.w) < pageW * 0.15;
      const above = k.y < it.y && it.y - k.y < Math.max(k.h, it.h) * 3 && Math.abs(k.x - it.x) < pageW * 0.08;
      if (sameLine || above) { score += 5; break; }
    }
    if (/[A-Z]/i.test(token)) score += 1;
    if (/[-_.]/.test(token)) score += 1;
    if (digitsOnly && score < 5) continue; // a bare number needs a keyword
    score += Math.min(2, it.h / 12);
    if (!best || score > best.score) best = { token: token.toUpperCase(), score };
  }
  return best && best.score >= 4 ? best.token : null;
}

/** Words of a page for the content fingerprint. */
export function pageTokens(items, max = 600) {
  const set = new Set();
  for (const it of items || []) {
    for (const w of String(it.str || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 2) set.add(w);
      if (set.size >= max) return set;
    }
  }
  return set;
}

export function jaccard(a, b) {
  if (!a || !b || (!a.size && !b.size)) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const w of small) if (big.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Pearson correlation of two equally sized thumbnails, clamped to 0..1. */
export function thumbSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  if (saa < 1e-12 || sbb < 1e-12) return saa < 1e-12 && sbb < 1e-12 ? 1 : 0;
  return Math.max(0, sab / Math.sqrt(saa * sbb));
}

/** Content similarity of two pages (0..1). */
export function pageSimilarity(o, n) {
  const ot = o.tokens?.size || 0;
  const nt = n.tokens?.size || 0;
  const textual = ot >= 8 && nt >= 8;
  const thumbs = o.thumb && n.thumb;
  if (textual && thumbs) return 0.75 * jaccard(o.tokens, n.tokens) + 0.25 * thumbSimilarity(o.thumb, n.thumb);
  if (textual) return jaccard(o.tokens, n.tokens);
  if (thumbs) return 0.85 * thumbSimilarity(o.thumb, n.thumb) + (ot + nt > 0 ? 0.15 * jaccard(o.tokens, n.tokens) : 0);
  if (ot + nt > 0) return jaccard(o.tokens, n.tokens);
  return 0;
}

function usableKeys(pages, key) {
  const vals = pages.map((p) => p[key]).filter(Boolean);
  if (vals.length < Math.max(1, Math.ceil(pages.length * 0.5))) return null;
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const dup = [...counts.values()].filter((c) => c > 1).reduce((s, c) => s + c, 0);
  if (dup > vals.length * 0.2) return null;
  return counts;
}

function customLabels(pages) {
  return pages.some((p) => p.label && p.label !== String(p.index));
}

export const MIN_SIMILARITY = 0.35;

/**
 * Pair the pages of two documents.
 * @param {Array<{index:number,label?:string|null,sheet?:string|null,tokens?:Set<string>,thumb?:Float32Array|number[]|null}>} oldPages
 * @param {Array<same>} newPages
 * @returns {Array<{old:number|null,new:number|null,reason:'sheet'|'label'|'content'|'index'|'manual',score:number}>}
 *   in reading order of the new document, with "only in old" pages placed
 *   after the pair of the old page before them.
 */
export function pairPages(oldPages, newPages, { minSimilarity = MIN_SIMILARITY } = {}) {
  const pairs = [];
  const usedOld = new Set();
  const usedNew = new Set();
  const add = (o, n, reason, score) => {
    pairs.push({ old: o.index, new: n.index, reason, score });
    usedOld.add(o.index);
    usedNew.add(n.index);
  };

  // 1. Sheet numbers, when both documents carry them and they are unique.
  const oSheets = usableKeys(oldPages, 'sheet');
  const nSheets = usableKeys(newPages, 'sheet');
  if (oSheets && nSheets) {
    const byNew = new Map(newPages.filter((p) => p.sheet && nSheets.get(p.sheet) === 1).map((p) => [p.sheet, p]));
    for (const o of oldPages) {
      if (!o.sheet || oSheets.get(o.sheet) !== 1) continue;
      const n = byNew.get(o.sheet);
      if (n && !usedNew.has(n.index)) add(o, n, 'sheet', 1);
    }
  }

  // 2. Own page labels.
  if (customLabels(oldPages) && customLabels(newPages)) {
    const oLabels = usableKeys(oldPages, 'label') || new Map();
    const nLabels = usableKeys(newPages, 'label') || new Map();
    const byNew = new Map(newPages.filter((p) => p.label && nLabels.get(p.label) === 1 && !usedNew.has(p.index)).map((p) => [p.label, p]));
    for (const o of oldPages) {
      if (usedOld.has(o.index) || !o.label || oLabels.get(o.label) !== 1) continue;
      const n = byNew.get(o.label);
      if (n && !usedNew.has(n.index)) add(o, n, 'label', 1);
    }
  }

  // 3. Content: greedy on similarity, a small bonus for the same relative
  //    position breaks ties between near-identical sheets.
  const restOld = oldPages.filter((p) => !usedOld.has(p.index));
  const restNew = newPages.filter((p) => !usedNew.has(p.index));
  const anyContent = [...restOld, ...restNew].some((p) => (p.tokens && p.tokens.size) || p.thumb);
  if (anyContent) {
    const cands = [];
    const no = Math.max(1, oldPages.length - 1);
    const nn = Math.max(1, newPages.length - 1);
    for (let i = 0; i < restOld.length; i++) {
      for (let j = 0; j < restNew.length; j++) {
        const sim = pageSimilarity(restOld[i], restNew[j]);
        if (sim < minSimilarity) continue;
        const rel = Math.abs((restOld[i].index - 1) / no - (restNew[j].index - 1) / nn);
        cands.push({ o: restOld[i], n: restNew[j], sim, key: sim + 0.05 * (1 - Math.min(1, rel * 4)) });
      }
    }
    cands.sort((a, b) => b.key - a.key || a.o.index - b.o.index);
    for (const c of cands) {
      if (usedOld.has(c.o.index) || usedNew.has(c.n.index)) continue;
      add(c.o, c.n, 'content', Math.round(c.sim * 1000) / 1000);
    }
  } else {
    // Nothing to go on (e.g. empty pages): fall back to the index.
    for (const o of restOld) {
      const n = restNew.find((p) => p.index === o.index);
      if (n && !usedNew.has(n.index)) add(o, n, 'index', 0);
    }
  }

  return orderPairs(pairs, oldPages.map((p) => p.index), newPages.map((p) => p.index));
}

/**
 * Order matched pairs by new page, and insert unmatched pages: "only in new"
 * at their own position, "only in old" right after the pair of the old page
 * before them.
 */
export function orderPairs(pairs, oldIndices, newIndices) {
  const matched = pairs.filter((p) => p.old != null && p.new != null);
  const usedOld = new Set(matched.map((p) => p.old));
  const usedNew = new Set(matched.map((p) => p.new));
  const rows = matched.map((p) => ({ ...p, _k: p.new }));
  for (const n of newIndices) if (!usedNew.has(n)) rows.push({ old: null, new: n, reason: 'only-new', score: 0, _k: n });
  const sortedOld = [...oldIndices].sort((a, b) => a - b);
  for (const o of sortedOld) {
    if (usedOld.has(o)) continue;
    // Nearest matched old page before this one.
    let anchor = null;
    for (const p of matched) if (p.old < o && (!anchor || p.old > anchor.old)) anchor = p;
    rows.push({ old: o, new: null, reason: 'only-old', score: 0, _k: (anchor ? anchor.new : 0) + 0.5 + o / 1e6 });
  }
  rows.sort((a, b) => a._k - b._k);
  return rows.map(({ _k, ...r }) => r);
}

/**
 * Correct a pairing: pair `oldPage` with `newPage` (either may be null to
 * unpair). Pages that lose their partner become "only in old/new".
 */
export function assignPair(rows, oldPage, newPage) {
  const oldIdx = new Set();
  const newIdx = new Set();
  for (const r of rows) {
    if (r.old != null) oldIdx.add(r.old);
    if (r.new != null) newIdx.add(r.new);
  }
  const kept = rows.filter((r) => r.old != null && r.new != null
    && r.old !== oldPage && r.new !== newPage);
  if (oldPage != null && newPage != null) kept.push({ old: oldPage, new: newPage, reason: 'manual', score: 1 });
  return orderPairs(kept, [...oldIdx], [...newIdx]);
}

/** Index-based pairing (the historic behaviour), as a pairing list. */
export function indexPairs(oldCount, newCount) {
  const pairs = [];
  for (let i = 1; i <= Math.min(oldCount, newCount); i++) pairs.push({ old: i, new: i, reason: 'index', score: 0 });
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return orderPairs(pairs, range(oldCount), range(newCount));
}

/**
 * Downsample a density grid (or RGBA-derived ink density) to a size x size
 * thumbnail for the fingerprint.
 */
export function thumbFromDensity(density, width, height, size = 16) {
  const out = new Float32Array(size * size);
  const counts = new Float32Array(size * size);
  for (let y = 0; y < height; y++) {
    const ty = Math.min(size - 1, Math.floor((y * size) / height));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(size - 1, Math.floor((x * size) / width));
      out[ty * size + tx] += density[y * width + x];
      counts[ty * size + tx] += 1;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? out[i] / counts[i] : 0;
  return out;
}
