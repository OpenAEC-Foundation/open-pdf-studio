// Page scales: a drawing scale per page (1:100 on a plan, 1:20 on a details
// sheet), shown on the thumbnails and set there, detected from each page's
// text. A page scale goes before the document scale for that page; scale
// regions and viewports on the page still go before it (schaal-op-punt.js).
//
// doc.pageScales: { [pageNum]: { scaleRatio: '1:100', unit: 'mm', method } }
//   method 'manual' (set by the user), 'auto-detect' (page text) or 'ocr'.
// Saved per page as a full-sheet /VP viewport with /OPS_Bron /Page
// (schaal-in-pdf.js), so other readers measure with it too.
//
// Only metric ratios 1:N. Imperial scales (1/4" = 1'-0") are out of scope:
// they are not read, and typed they are refused rather than taken as 1:4.
//
// Pure functions only: no app state, so node can test them.

/**
 * '1:100', '100', '1 : 50', '1:2,5' -> '1:100', '1:100', '1:50', '1:2.5';
 * anything else (also '1/4') -> null.
 */
export function normaliseerSchaal(invoer) {
  const s = String(invoer ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(?:1\s*:\s*)?(\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return n > 0 && n <= 100000 ? `1:${n}` : null;
}

/**
 * What the scale editor on a thumbnail does with its text (ThumbnailItem.jsx).
 * `begin` is the text the editor opened with, `via` how it closed: 'enter',
 * 'blur' or 'escape'.
 *
 * - Escape, or text that is the same scale as `begin`: nothing (clicking a
 *   badge and clicking away never changes a page).
 * - Blur: only the edited page, and only when changed. Never the selection:
 *   leaving the field by accident must not touch other pages.
 * - Enter: when the page is part of a selection of several pages, the whole
 *   selection gets the scale (also when it is the same as `begin`: Enter
 *   copies it onto the selected pages that differ). An empty field clears
 *   them, but only when it was emptied: Enter on an empty, untouched field
 *   clears nothing.
 * - Text that is no scale: 'fout' on Enter (the editor stays open), nothing
 *   on blur.
 *
 * @param {{pageNum:number, selectie:number[], schalen:object|null, begin:string, waarde:string|null, via:string}} invoer
 * @returns {{actie:'niets'} | {actie:'fout'} | {actie:'zet', paginas:number[], ratio:string|null}}
 */
export function besluitSchaalInvoer({ pageNum, selectie = [], schalen = null, begin = '', waarde, via }) {
  const niets = { actie: 'niets' };
  if (via === 'escape' || waarde == null) return niets;
  const tekst = String(waarde).trim();
  const ratio = tekst ? normaliseerSchaal(tekst) : null;
  if (tekst && !ratio) return via === 'enter' ? { actie: 'fout' } : niets;
  const was = String(begin ?? '').trim() ? normaliseerSchaal(begin) : null;
  const gewijzigd = ratio !== was;
  const meer = via === 'enter' && selectie.includes(pageNum) && selectie.length > 1;
  if (!meer) return gewijzigd ? { actie: 'zet', paginas: [pageNum], ratio } : niets;
  const paginas = [...selectie].sort((a, b) => a - b);
  const wijktAf = ratio && paginas.some((p) => (schalen?.[p]?.scaleRatio ?? null) !== ratio);
  return gewijzigd || wijktAf ? { actie: 'zet', paginas, ratio } : niets;
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
// A ratio 1:N. N may have a decimal comma or point ("1:2,5"); a separator
// followed by exactly three digits is a thousands separator ("1:1,000").
// Not a time: no AM/PM after it.
const VERHOUDING = /(?<![\d.,:/])1\s*:\s*(\d{1,5}(?:[.,]\d+)?)(?![\d:])(?!\s*[AP]\.?M\b)/gi;
// Phrases that say a sheet or a drawing has no scale. The word SCALE in them
// is no label, and a ratio right next to them is not the sheet's scale.
const GEEN_SCHAAL = /(?<![A-Z])(?:NOT\s+TO\s+SCALE|DO\s+NOT\s+SCALE|NO\s+SCALE|NIET\s+OP\s+SCHAAL|GEEN\s+SCHAAL|N\.?\s?T\.?\s?S\.?)(?![A-Z])/gi;
// A SCALE label whose value says there is no single scale.
const GEEN_WAARDE = /^\s*[:.-]?\s*(?:N\.?\s?T\.?\s?S\.?|AS\s+SHOWN|AS\s+INDICATED|AS\s+NOTED|VARIES|NONE)(?![A-Z])/i;
const NABIJ = 40;   // characters between SCALE and its ratio, either side

function noemer(tekst) {
  const m = String(tekst).match(/^(\d+)[.,](\d+)$/);
  if (m && m[2].length === 3 && m[1].length <= 3) return parseFloat(m[1] + m[2]);
  return parseFloat(String(tekst).replace(',', '.'));
}

function afstandTot(begin, eind, [a, b]) {
  return b <= begin ? begin - b : eind <= a ? a - eind : 0;
}

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
 *
 * No scale (null) when the sheet says it has none: a SCALE label with the
 * value NTS, AS SHOWN or AS INDICATED gives null for the page, and a ratio
 * right next to NOT TO SCALE or DO NOT SCALE does not count, unless it is
 * next to a real SCALE label ("DO NOT SCALE FROM DRAWING ... SCALE 1:100").
 *
 * Returns { ratio, scaleText, alle: ['1:100', '1:20'] } or null.
 * `regels`: [{ text }] or pdf.js items [{ str }], one per item or OCR word.
 */
export function kiesPaginaSchaal(regels) {
  const tekst = (Array.isArray(regels) ? regels : [])
    .map((r) => String(r?.text ?? r?.str ?? '')).filter((t) => t.trim()).join(' ');
  if (!tekst) return null;
  const geenPlekken = [...tekst.matchAll(GEEN_SCHAAL)].map((m) => [m.index, m.index + m[0].length]);
  const binnenGeen = (i) => geenPlekken.some(([a, b]) => i >= a && i < b);
  const woordPlekken = [...tekst.matchAll(SCHAAL_WOORD)]
    .filter((m) => !binnenGeen(m.index))
    .map((m) => [m.index, m.index + m[0].length]);
  // SCALE: NTS / AS SHOWN: the sheet has no single scale.
  if (woordPlekken.some(([, b]) => GEEN_WAARDE.test(tekst.slice(b, b + 24)))) return null;
  const tellers = new Map();
  let naastWoord = null, naastAfstand = Infinity;
  for (const m of tekst.matchAll(VERHOUDING)) {
    const n = noemer(m[1]);
    const begin = m.index, eind = m.index + m[0].length;
    // Distance to the nearest SCALE word; a ratio after the word ("SCALE
    // 1:100") goes before one just before it (a detail's "1:20 SCALE").
    let afstand = Infinity, score = Infinity;
    for (const plek of woordPlekken) {
      const d = afstandTot(begin, eind, plek);
      afstand = Math.min(afstand, d);
      score = Math.min(score, plek[1] <= begin ? d : d + NABIJ);
    }
    const bijWoord = afstand <= NABIJ;
    if (!bijWoord && geenPlekken.some((plek) => afstandTot(begin, eind, plek) <= NABIJ)) continue;
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
