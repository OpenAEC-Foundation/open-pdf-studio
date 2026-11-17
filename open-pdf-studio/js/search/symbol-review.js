import { pageTextSpans } from '../text/mcp-page-text.js';

/** Region filters and review flags for symbol search candidates (#1131).
 *
 * A drawing legend shows every symbol once and a title block holds text that
 * can look like one, so a plain count of all candidates comes out one or two
 * too high. Three tools keep the count honest, all in the page-view
 * coordinates at scale 1 that the search itself uses (origin top left, the
 * page as it is shown, rotation included):
 *
 * - regions the caller rules out (`excludeRegions`) or restricts the search
 *   to (`withinRegion`): candidates whose centre falls outside are dropped
 *   and counted in `summary.excluded`;
 * - a `minScore`: candidates below it stay, flagged `belowMinScore`;
 * - a legend or title block found in the page text: candidates inside stay,
 *   flagged `legend` / `titleBlock`.
 *
 * Detection reads the text layer only. A scan without text, a legend drawn
 * as outlines or a heading in another language is not found, and a flag is
 * a hint, never a verdict: nothing is dropped unless the caller asks for it.
 * Pure geometry, no DOM: testable in Node. */

export const REVIEW_REASONS = ['belowMinScore', 'legend', 'titleBlock'];
export const MAX_REGIONS = 50;

const finite = v => typeof v === 'number' && Number.isFinite(v);

function region(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REGIONS');
  const { page, x, y, width, height } = value;
  if (![x, y, width, height].every(finite)
    || width <= 0
    || height <= 0
    || page !== undefined && (!Number.isInteger(page) || page < 1)) throw new Error('INVALID_REGIONS');
  return page === undefined ? { x, y, width, height } : { page, x, y, width, height };
}

/** Validated search filters. A region without `page` applies to every
 * searched page. Throws INVALID_REGIONS or INVALID_MIN_SCORE. */
export function normaliseFilters({ excludeRegions, withinRegion, minScore, detectRegions } = {}) {
  if (excludeRegions != null && (!Array.isArray(excludeRegions) || excludeRegions.length > MAX_REGIONS)) throw new Error('INVALID_REGIONS');
  if (minScore != null && (!finite(minScore) || minScore < .5 || minScore > 1)) throw new Error('INVALID_MIN_SCORE');
  if (detectRegions != null && typeof detectRegions !== 'boolean') throw new Error('INVALID_REGIONS');
  return {
    exclude: (excludeRegions || []).map(region),
    within: withinRegion == null ? null : region(withinRegion),
    minScore: minScore ?? null,
    detect: detectRegions !== false
  };
}

const centre = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const applies = (r, page) => r.page === undefined || r.page === page;

/** Applies the filters to candidates `{ page, bounds, score, ... }`.
 * `detected` holds `{ page, kind, bounds }` from detectReviewRegions.
 * Returns the candidates that stay, each with `review` (and `reviewReasons`
 * when true), and how many the caller's regions dropped. */
export function reviewMatches(matches, filters, detected = []) {
  const { exclude, within, minScore } = filters,
    kept = [];
  let excluded = 0;
  for (const m of matches) {
    const c = centre(m.bounds);
    if (within && applies(within, m.page) && !contains(within, c)
      || exclude.some(r => applies(r, m.page) && contains(r, c))) {
      excluded++;
      continue;
    }
    const reasons = [];
    if (minScore !== null && m.score < minScore) reasons.push('belowMinScore');
    for (const kind of ['legend', 'titleBlock']) {
      if (detected.some(d => d.kind === kind && d.page === m.page && contains(d.bounds, c))) reasons.push(kind);
    }
    kept.push(reasons.length ? { ...m, review: true, reviewReasons: reasons } : { ...m, review: false });
  }
  return { matches: kept, excluded };
}

/** Totals for a reviewed result: `safe` is the count to trust without a look. */
export function reviewSummary(matches, excluded) {
  const review = matches.filter(m => m.review).length;
  return { candidates: matches.length, safe: matches.length - review, review, excluded };
}

/** Text runs of a page as boxes `{ text, x, y, width, height }` in the
 * coordinates of `viewport` (pdf.js items, one per glyph or word, merged
 * into runs first). */
export function textBoxesFromItems(items, viewport) {
  return pageTextSpans(Array.isArray(items) ? items : [], {}, viewport, 'symbol-review', 0)
    .map(s => ({ text: s.text, ...s.bbox }))
    .filter(b => b.text.trim());
}

// A heading that names the legend: the word itself, with at most a few words
// around it ("ELECTRICAL LEGEND", "Renvooi elektra"), never a reference to it.
const LEGEND_WORD = /(?:^|\s)(?:legend|legenda|legende|légende|leyenda|renvooi|zeichenerkl[äa]rung|symbolenlijst|symbol(?:s|en)?\s*(?:key|list|lijst))(?=$|[\s:.\-–])/i;
const LEGEND_EXACT = /^(?:symbols|symbolen|key|verklaring(?:\s+(?:symbolen|tekens))?)$/i;
const LEGEND_REFERENCE = /^(?:see|zie|refer|per|volgens|conform|siehe|voir)(?=$|\s)/i;

const tidy = text => String(text).replace(/\s+/g, ' ').trim();

export function isLegendHeading(text) {
  const t = tidy(text);
  if (!t || t.length > 40 || LEGEND_REFERENCE.test(t)) return false;
  return LEGEND_EXACT.test(t.replace(/[\s:.]+$/, '')) || LEGEND_WORD.test(t) && t.split(' ').length <= 4;
}

// Field labels of a title block, one group per kind of field. A label is the
// start of a short text run ("Schaal: 1:100", "DRAWN BY"), not of a sentence.
const END = '(?=$|[\\s:./\\-–])';
const TITLE_FIELDS = [
  ['scale', 'schaal|scale|ma(?:ß|ss)stab|[ée]chelle|escala'],
  ['date', 'datum|date|fecha'],
  ['drawn', 'getekend|get|tekenaar|drawn|gezeichnet|gez|dessin[ée]|auteur|author'],
  ['checked', 'gecontroleerd|gezien|contr|checked|chk|approved|appr|goedgekeurd|gepr[üu]ft|gepr|v[ée]rifi[ée]'],
  ['project', 'project[a-z]*|projekt[a-z]*|projet|werknummer|werknr|opdrachtgever|client|job|bauherr'],
  ['drawing', 'tekening[a-z]*|tek|drawing|dwg|blad[a-z]*|sheet|zeichnung[a-z]*'],
  ['revision', 'revisie|rev|revision|wijziging(?:en)?|index'],
  ['format', 'formaat|format|papierformaat'],
  ['status', 'status|fase|phase|onderdeel|onderwerp']
].map(([kind, words]) => [kind, new RegExp(`^(?:${words})${END}`, 'i')]);

export function titleField(text) {
  const t = tidy(text);
  if (!t || t.length > 40) return null;
  return TITLE_FIELDS.find(([, re]) => re.test(t))?.[0] ?? null;
}

const round = v => Math.round(v * 100) / 100;

function bounds(left, top, right, bottom, page) {
  const x = Math.max(0, left),
    y = Math.max(0, top),
    r = Math.min(page.width, right),
    b = Math.min(page.height, bottom);
  return r > x && b > y ? { x: round(x), y: round(y), width: round(r - x), height: round(b - y) } : null;
}

const area = b => b.width * b.height;

// The legend: its heading and the rows below that start in the same column.
// Symbols sit left of their description, so the region reaches further left
// than the text does.
function legendRegion(heading, boxes, page) {
  const h = Math.max(1, Math.min(heading.height, page.height * .05)),
    left = heading.x - 6 * h,
    right = heading.x + heading.width + 6 * h,
    rows = boxes
      .filter(b => b !== heading && b.y >= heading.y + heading.height * .5 && b.x >= left && b.x <= right)
      .sort((a, b) => a.y - b.y);
  let bottom = heading.y + heading.height,
    minLeft = heading.x,
    maxRight = heading.x + heading.width,
    count = 0;
  for (const b of rows) {
    if (b.y - bottom > 5 * h) break;
    bottom = Math.max(bottom, b.y + b.height);
    minLeft = Math.min(minLeft, b.x);
    maxRight = Math.max(maxRight, b.x + b.width);
    count++;
  }
  if (!count) return null;
  const found = bounds(minLeft - 4 * h, heading.y - h * .5, maxRight + h, bottom + 1.5 * h, page);
  return found && area(found) <= .35 * page.width * page.height ? found : null;
}

const gap = (a, b) => Math.max(
  0,
  a.x - (b.x + b.width),
  b.x - (a.x + a.width),
  a.y - (b.y + b.height),
  b.y - (a.y + a.height)
);

// Title blocks: three or more different field labels close together. The
// values stand next to or under their label, so the region takes in the text
// around the labels (one step, no chaining across the sheet) and runs on to a
// page edge that is near: a title block sits against the frame, as a rule in
// the bottom right corner.
function titleBlockRegions(boxes, page) {
  const size = Math.max(page.width, page.height),
    reach = .08 * size,
    pad = .02 * size,
    hits = boxes.map(b => ({ box: b, kind: titleField(b.text) })).filter(h => h.kind),
    group = hits.map((_, i) => i);
  const root = i => {
    while (group[i] !== i) i = group[i] = group[group[i]];
    return i;
  };
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    if (gap(hits[i].box, hits[j].box) <= reach) group[root(i)] = root(j);
  }
  const clusters = new Map();
  hits.forEach((hit, i) => {
    const key = root(i);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(hit.box);
  });
  const hull = list => {
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const b of list) {
      x = Math.min(x, b.x);
      y = Math.min(y, b.y);
      right = Math.max(right, b.x + b.width);
      bottom = Math.max(bottom, b.y + b.height);
    }
    return { x, y, width: right - x, height: bottom - y };
  };
  const out = [];
  for (const labels of clusters.values()) {
    if (new Set(labels.map(b => titleField(b.text))).size < 3) continue;
    const core = hull(labels),
      all = hull(boxes.filter(b => gap(b, core) <= reach / 2));
    let left = all.x - pad,
      top = all.y - pad,
      right = all.x + all.width + pad,
      bottom = all.y + all.height + pad;
    if (left < .05 * page.width) left = 0;
    if (top < .05 * page.height) top = 0;
    if (right > .85 * page.width) right = page.width;
    if (bottom > .85 * page.height) bottom = page.height;
    const found = bounds(left, top, right, bottom, page);
    if (found && area(found) <= .4 * page.width * page.height) out.push(found);
  }
  return out;
}

/** Legend and title-block regions of one page, from its text boxes.
 * `page` is `{ width, height }` in the same coordinates.
 * @returns {Array<{ kind: 'legend'|'titleBlock', bounds: {x,y,width,height} }>} */
export function detectReviewRegions(boxes, page) {
  if (!Array.isArray(boxes) || !(page?.width > 0) || !(page?.height > 0)) return [];
  const list = boxes.filter(b => b && typeof b.text === 'string' && [b.x, b.y, b.width, b.height].every(finite)),
    out = [];
  for (const heading of list) {
    if (!isLegendHeading(heading.text)) continue;
    const found = legendRegion(heading, list, page);
    if (found) out.push({ kind: 'legend', bounds: found });
  }
  for (const found of titleBlockRegions(list, page)) out.push({ kind: 'titleBlock', bounds: found });
  return out;
}
