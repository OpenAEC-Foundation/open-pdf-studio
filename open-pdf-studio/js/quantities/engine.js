// Hoeveelheden — schedule-engine (puur). filter → sorteer → groepeer → totaliseer.
import { categoryOf, fieldsForCategories, qLabel } from './categories.js';
import { eenheidSoort, kiesKolomEenheid, normaliseerEenheid, rekenOm } from './eenheid-omrekening.js';

const OPS = {
  '=':   (a, b) => String(a ?? '') === String(b ?? ''),
  '!=':  (a, b) => String(a ?? '') !== String(b ?? ''),
  '>':   (a, b) => Number(a) > Number(b),
  '>=':  (a, b) => Number(a) >= Number(b),
  '<':   (a, b) => Number(a) < Number(b),
  '<=':  (a, b) => Number(a) <= Number(b),
  'has': (a) => a != null && a !== '',
  'none': (a) => a == null || a === '',
};

function cmp(a, b) {
  const na = typeof a === 'number', nb = typeof b === 'number';
  if (na && nb) return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

// Eenheid waarin de ruwe waarde van een veld voor één element staat: wat
// unitOf oplevert, anders de vaste veld-eenheid. Leeg = onbekend (de cel geldt
// dan als al in de kolomeenheid, zoals altijd).
function bronEenheid(f, el) {
  if (typeof f.unitOf === 'function') {
    let u = null;
    try { u = f.unitOf(el); } catch { u = null; }
    return u || '';
  }
  return f.unit || '';
}

/**
 * Weergave-eenheid van een getalveld: één per kolom, ook als de rijen in
 * verschillende eenheden staan (zie eenheid-omrekening.js kiesKolomEenheid).
 * Een eenheid die de gebruiker koos maar die geen bekende maat is ("stuks",
 * "°") blijft een opschrift zoals vroeger: dan wordt er niets omgerekend.
 * @param {string[]} rijEenheden  bron-eenheid van elke rij met een getal
 * @returns {{unit: string, omrekenen: boolean}}
 */
function kolomEenheid(f, fmt, rijEenheden, documentEenheid) {
  const gekozen = fmt && fmt.unit != null && fmt.unit !== '' ? fmt.unit : null;
  if (gekozen != null && !eenheidSoort(gekozen)) return { unit: gekozen, omrekenen: false };
  const unit = kiesKolomEenheid({ gekozen, rijEenheden, vast: f.unit || '', documentEenheid });
  return { unit, omrekenen: true };
}

function applyFmt(f, fmt, eenheid) {
  const isImage = f.kind === 'image';
  const base = {
    ...f,
    unit: eenheid ? eenheid.unit : f.unit,
    decimals: f.dec != null ? f.dec : (f.kind === 'number' ? 2 : 0),
    align: f.kind === 'number' ? 'right' : 'left',
    // Beeldkolommen tellen nooit mee in som/subtotalen; een veld met
    // sum: false (diameter, lengte per staaf) ook niet.
    total: !isImage && f.sum !== false,
  };
  if (isImage) return { ...base, total: false };
  if (!fmt) return base;
  return {
    ...base,
    label: fmt.heading || f.label,
    decimals: fmt.decimals != null ? fmt.decimals : base.decimals,
    align: fmt.align || base.align,
    total: fmt.total != null ? fmt.total !== false : base.total,
  };
}

/** Lees één element uit: ruwe waarde per veld + bron-eenheid per getalcel. */
function leesRij(el, allFields) {
  const vals = {}, bron = {};
  for (const f of allFields) {
    const v = safeGet(f, el);
    vals[f.key] = v;
    if (f.kind === 'number' && typeof v === 'number' && !Number.isNaN(v)) bron[f.key] = bronEenheid(f, el);
  }
  return { el, vals, bron };
}

/**
 * Reken elke getalcel van een rij om naar de kolomeenheid van zijn veld. Een
 * cel zonder bekende eenheid geldt als al in de kolomeenheid. Een cel waarvan
 * de eenheid niet om te rekenen is (lengte in een oppervlaktekolom, px naast
 * mm) houdt zijn eigen waarde; zijn eenheid komt in `foreignUnits` en hij
 * telt niet mee in subtotaal en eindtotaal.
 */
function naarKolomEenheden(ruw, eenheden) {
  const vals = { ...ruw.vals };
  let vreemd = null;
  for (const [key, van0] of Object.entries(ruw.bron)) {
    const doel = eenheden.get(key);
    if (!doel || !doel.omrekenen) continue;
    const van = normaliseerEenheid(van0), naar = normaliseerEenheid(doel.unit);
    if (!van || van === naar) continue;
    const om = naar ? rekenOm(vals[key], van, naar) : null;
    if (om == null) (vreemd ||= {})[key] = van;
    else vals[key] = om;
  }
  const row = { el: ruw.el, vals };
  if (vreemd) row.foreignUnits = vreemd;
  return row;
}

function safeGet(f, el) {
  try { return f.get(el); } catch { return null; }
}

function subtotal(rows, colDefs) {
  const out = {};
  for (const f of colDefs) {
    if (f.kind !== 'number' || f.total === false) continue;
    let sum = 0, any = false;
    for (const r of rows) {
      // Een cel in een eenheid die niet naar de kolom om te rekenen is, telt
      // niet mee: een som van meters en vierkante meters bestaat niet.
      if (r.foreignUnits && f.key in r.foreignUnits) continue;
      const v = r.vals[f.key];
      if (typeof v === 'number' && !Number.isNaN(v)) { sum += v; any = true; }
    }
    out[f.key] = any ? sum : null;
  }
  return out;
}

function groupBy(rows, fieldKey, colDefs) {
  const map = new Map();
  for (const r of rows) {
    const k = r.vals[fieldKey];
    const kk = (k == null || k === '') ? qLabel('quantities.none', '(none)') : String(k);
    if (!map.has(kk)) map.set(kk, []);
    map.get(kk).push(r);
  }
  return [...map.entries()].map(([key, grows]) => ({
    key, rows: grows, subtotals: subtotal(grows, colDefs),
  }));
}

/**
 * @param elements  ruwe elementen (annotaties + pseudo-elementen)
 * @param cfg       { categories:[key], fields:[key], filters:[{field,op,value}],
 *                    sort:[{field,dir,group,header,footer}], itemize, format:{[key]:{...}} }
 * @param opts      { documentUnit } — lengte-eenheid van de documentschaal;
 *                  beslist bij gelijkspel welke eenheid een gemengde kolom krijgt
 * @returns { columns, groups:[{key,rows,subtotals}], grandTotals, count, itemize }
 *          Getalcellen, subtotalen en totalen staan in de eenheid van hun
 *          kolom (`column.unit`). Een rij met een niet-omrekenbare cel draagt
 *          `foreignUnits: {[key]: eenheid}`.
 */
export function buildSchedule(elements, cfg = {}, opts = {}) {
  const cats = (cfg.categories && cfg.categories.length) ? cfg.categories : [];
  const allFields = fieldsForCategories(cats);

  const relevant = (elements || []).filter(el => cats.includes(categoryOf(el)));

  // Eén weergave-eenheid per getalveld, gekozen uit de elementen zelf (ook
  // voor velden die alleen in een filter of sortering staan: die vergelijken
  // dan ook in één eenheid).
  const format = cfg.format || {};
  const ruw = relevant.map(el => leesRij(el, allFields));
  const eenheden = new Map();
  for (const f of allFields) {
    if (f.kind !== 'number') continue;
    const rijEenheden = ruw.filter(r => f.key in r.bron).map(r => r.bron[f.key]);
    eenheden.set(f.key, kolomEenheid(f, format[f.key], rijEenheden, opts.documentUnit || null));
  }

  const colDefs = (cfg.fields || [])
    .map(k => allFields.find(f => f.key === k))
    .filter(Boolean)
    .map(f => applyFmt(f, format[f.key], eenheden.get(f.key)));

  let rows = ruw.map(r => naarKolomEenheden(r, eenheden));

  for (const flt of (cfg.filters || [])) {
    if (!flt || !flt.field || !flt.op || !OPS[flt.op]) continue;
    rows = rows.filter(r => OPS[flt.op](r.vals[flt.field], flt.value));
  }

  const levels = (cfg.sort || []).filter(s => s && s.field);
  if (levels.length) {
    rows.sort((a, b) => {
      for (const s of levels) {
        const c = cmp(a.vals[s.field], b.vals[s.field]) * (s.dir === 'desc' ? -1 : 1);
        if (c) return c;
      }
      return 0;
    });
  }

  const groupLevel = levels.find(s => s.group);
  const groups = groupLevel
    ? groupBy(rows, groupLevel.field, colDefs)
    : [{ key: null, rows, subtotals: subtotal(rows, colDefs) }];

  return {
    columns: colDefs,
    groups,
    grandTotals: subtotal(rows, colDefs),
    count: rows.length,
    itemize: cfg.itemize !== false,
  };
}
