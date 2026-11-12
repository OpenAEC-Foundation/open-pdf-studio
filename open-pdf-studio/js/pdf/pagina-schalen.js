// Page scales: a drawing scale per page (1:100 on a plan, 1:20 on a details
// sheet), shown on the thumbnails and set there, detected from each page's
// text. A page scale goes before the document scale for that page; scale
// regions and viewports on the page still go before it (schaal-op-punt.js).
//
// doc.pageScales: { [pageNum]: { scaleRatio: '1:100', unit: 'mm', method } }
//   method 'manual' (set by the user), 'auto-detect' (page text) or 'ocr'.
// Saved per page as a full-sheet /VP viewport with /OPS_Bron /Page
// (schaal-in-pdf.js), the way Bluebeam keeps a page scale.
//
// Pure functions only: no app state, so node can test them.

/** '1:100', '100', '1 : 50' -> '1:100'; anything else -> null. */
export function normaliseerSchaal(invoer) {
  const s = String(invoer ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(?:1\s*[:/]\s*)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 100000 ? `1:${Number.isInteger(n) ? n : n}` : null;
}

/** The page scale of a page, or null. */
export function paginaSchaal(doc, pageNum) {
  const s = doc?.pageScales?.[pageNum];
  return s && typeof s.scaleRatio === 'string' && /^1:\d/.test(s.scaleRatio) ? s : null;
}

/** A new pageScales object with `pages` set to `ratio` (null clears). */
export function metPaginaSchaal(schalen, pages, ratio, method = 'manual', unit = 'mm') {
  const uit = { ...(schalen || {}) };
  for (const p of pages) {
    if (ratio) uit[p] = { scaleRatio: ratio, unit, method };
    else delete uit[p];
  }
  return uit;
}

/** Page scales after pages were inserted, deleted or moved (oud -> nieuw). */
export function herschikSchalen(schalen, pageMapping, aantal) {
  if (!schalen || !pageMapping) return schalen || null;
  const uit = {};
  for (const [oudTekst, nieuw] of Object.entries(pageMapping)) {
    const s = schalen[Number(oudTekst)];
    if (s && nieuw >= 1 && nieuw <= aantal) uit[nieuw] = s;
  }
  return Object.keys(uit).length ? uit : null;
}

const SCHAAL_WOORD = /(SCALE|SCHAAL|MASSSTAB|ÉCHELLE|ECHELLE|ESCALA)/gi;
const VERHOUDING = /(?<![\d.,:/])1\s*:\s*(\d{1,5}(?:\.\d+)?)(?![\d:])/g;
const NABIJ = 40;   // characters between SCALE and its ratio, either side

/** A plausible drawing scale: not a year (NZS 3101:2006), not a time. */
function geldigeNoemer(n, naastWoord) {
  if (!(n > 0 && n <= 10000)) return false;
  if (!naastWoord && n >= 1900 && n <= 2100 && Number.isInteger(n)) return false;
  return true;
}

/**
 * The drawing scale of a page from its text. A sheet often carries several
 * (the plan 1:100, details 1:20); the one next to the word SCALE wins, then
 * the most frequent, then the first. The items are joined first, so a scale
 * split over items ("1", ":", "10") or written "1 : 10" is found.
 * Returns { ratio, scaleText, alle: ['1:100', '1:20'] } or null.
 * `regels`: [{ text }] or pdf.js items [{ str }], one per item or OCR word.
 */
export function kiesPaginaSchaal(regels) {
  const tekst = (Array.isArray(regels) ? regels : [])
    .map((r) => String(r?.text ?? r?.str ?? '')).filter((t) => t.trim()).join(' ');
  if (!tekst) return null;
  const woordPlekken = [...tekst.matchAll(SCHAAL_WOORD)].map((m) => [m.index, m.index + m[0].length]);
  const tellers = new Map();
  let naastWoord = null, naastAfstand = Infinity;
  for (const m of tekst.matchAll(VERHOUDING)) {
    const n = parseFloat(m[1]);
    const begin = m.index, eind = m.index + m[0].length;
    // Distance to the nearest SCALE word; a ratio after the word ("SCALE
    // 1:100") goes before one just before it (a detail's "1:20 SCALE").
    let afstand = Infinity, score = Infinity;
    for (const [a, b] of woordPlekken) {
      const na = b <= begin, d = na ? begin - b : eind <= a ? a - eind : 0;
      afstand = Math.min(afstand, d);
      score = Math.min(score, na ? d : d + NABIJ);
    }
    const bijWoord = afstand <= NABIJ;
    if (!geldigeNoemer(n, bijWoord)) continue;
    tellers.set(n, (tellers.get(n) || 0) + 1);
    if (bijWoord && score < naastAfstand) { naastWoord = n; naastAfstand = score; }
  }
  if (!tellers.size) return null;
  const gesorteerd = [...tellers.entries()].sort((a, b) => b[1] - a[1]);
  const gekozen = naastWoord ?? gesorteerd[0][0];
  return { ratio: gekozen, scaleText: `1:${gekozen}`, alle: gesorteerd.map(([n]) => `1:${n}`) };
}

/**
 * The scale in a small area the user drew round it: a ratio ("1 : 100",
 * "SCALE 1:50 @ A1") or, when the box holds only the number, that number.
 * Returns '1:N' or null.
 */
export function schaalUitGebied(tekst) {
  const t = String(tekst ?? '').trim();
  if (!t) return null;
  const k = kiesPaginaSchaal([{ text: t }]);
  if (k) return `1:${k.ratio}`;
  const alleenGetal = t.replace(/^(SCALE|SCHAAL)\s*[:.]?\s*/i, '').match(/^(\d{1,5})(?:\s*@.*)?$/);
  return alleenGetal ? normaliseerSchaal(alleenGetal[1]) : null;
}
