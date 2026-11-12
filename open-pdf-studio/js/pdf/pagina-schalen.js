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

const SCHAAL_WOORD = /\b(SCALE|SCHAAL|MASSSTAB|ÉCHELLE|ECHELLE|ESCALA)\b/i;
const VERHOUDING = /\b1\s*:\s*(\d{1,5})\b/g;

/**
 * The drawing scale of a page from its text lines. A sheet often carries
 * several (the plan 1:100, details 1:20); the one next to the word SCALE
 * wins, then the most frequent, then the first. Returns
 * { ratio, scaleText, alle: ['1:100', '1:20'] } or null.
 * `regels`: [{ text, y? }], one per text item or OCR word.
 */
export function kiesPaginaSchaal(regels) {
  const lijst = (Array.isArray(regels) ? regels : []).map((r) => String(r?.text ?? r?.str ?? '')).filter(Boolean);
  const tellers = new Map();
  let naastWoord = null;
  const alleTekst = lijst.join(' \n ');
  for (let i = 0; i < lijst.length; i++) {
    const t = lijst[i];
    for (const m of t.matchAll(VERHOUDING)) {
      const n = parseInt(m[1], 10);
      if (!(n > 0 && n <= 10000)) continue;
      tellers.set(n, (tellers.get(n) || 0) + 1);
      // SCALE in the same item, or in the item just before ("SCALE" "1:100").
      if (!naastWoord && (SCHAAL_WOORD.test(t) || SCHAAL_WOORD.test(lijst[i - 1] || ''))) naastWoord = n;
    }
  }
  if (!tellers.size) {
    // "SCALE 1 : 100" split over items: try the joined text once.
    const m = alleTekst.match(/(SCALE|SCHAAL)\s*[:.]?\s*1\s*:\s*(\d{1,5})/i);
    if (!m) return null;
    const n = parseInt(m[2], 10);
    return { ratio: n, scaleText: m[0].trim(), alle: [`1:${n}`] };
  }
  const gesorteerd = [...tellers.entries()].sort((a, b) => b[1] - a[1]);
  const gekozen = naastWoord ?? gesorteerd[0][0];
  return { ratio: gekozen, scaleText: `1:${gekozen}`, alle: gesorteerd.map(([n]) => `1:${n}`) };
}
