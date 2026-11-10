// Hoeveelheden — kenmerken (tags) van een staat heen en terug via CSV (#629).
//
// De CSV-export van een staat (schedule-csv.js) krijgt met `ids: true` een
// laatste kolom "ID" met het id van de annotatie achter elke regel. Wie in een
// rekenblad het label, de IFC-categorie, de locatie of de telcategorie van een
// regel aanpast, leest het bestand hier weer in: alleen die kenmerken gaan
// terug naar de annotaties, getallen en afgeleide kolommen nooit.
//
// Puur: geen DOM, geen stores. De UI (SchedulesPanel) leest het bestand,
// past de wijzigingen toe met undo en meldt het resultaat.

/** Vaste (niet vertaalde) kop van de id-kolom. */
export const TAG_ID_HEADER = 'ID';

/** Velden die heen en terug mogen; de rest van de kolommen is alleen-lezen. */
export const EDITABLE_TAG_FIELDS = Object.freeze(['label', 'ifcCategory', 'location', 'countCat']);

const MAX_CELL = 1000;

/** Id van een echte annotatie achter een regel, of '' bij een pseudo-element. */
export function rowAnnotationId(row) {
  const el = row?.el;
  if (!el || el.__category || el.id == null) return '';
  return String(el.id);
}

// ── CSV lezen ───────────────────────────────────────────────────────────────

/** Het scheidingsteken van de kopregel: ',' of ';' (rekenbladen in NL) of tab. */
function scheidingsteken(tekst) {
  const eersteRegel = tekst.split(/\r?\n/, 1)[0] || '';
  let komma = 0, punt = 0, tab = 0, inAanhaling = false;
  for (const ch of eersteRegel) {
    if (ch === '"') inAanhaling = !inAanhaling;
    else if (!inAanhaling) {
      if (ch === ',') komma++;
      else if (ch === ';') punt++;
      else if (ch === '\t') tab++;
    }
  }
  if (tab > komma && tab > punt) return '\t';
  return punt > komma ? ';' : ',';
}

/**
 * Lees CSV-tekst (RFC 4180: aanhalingstekens, "" binnen een cel, regeleinden
 * in een cel). Een BOM vooraan valt weg.
 * @returns {string[][]}
 */
export function parseCsv(tekst) {
  const s = String(tekst ?? '').replace(/^\uFEFF/, '');
  const sep = scheidingsteken(s);
  const rijen = [];
  let rij = [], cel = '', inAanhaling = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inAanhaling) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cel += '"'; i++; } else inAanhaling = false;
      } else cel += ch;
      continue;
    }
    if (ch === '"' && cel === '') inAanhaling = true;
    else if (ch === sep) { rij.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rij.push(cel); rijen.push(rij); rij = []; cel = '';
    } else cel += ch;
  }
  if (cel !== '' || rij.length) { rij.push(cel); rijen.push(rij); }
  return rijen.filter((r) => r.some((c) => c.trim() !== ''));
}

// De export zet een ' voor een cel die een rekenblad als formule zou lezen.
function zonderFormuleSchild(cel) {
  const s = String(cel ?? '');
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

const sleutel = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Welke kolom van het bestand bij welk veld hoort. Een kop telt als hij gelijk
 * is aan de kop die de export voor die kolom schrijft ("Label", "Lengte (m)"),
 * aan het label zonder eenheid, of aan de veldsleutel zelf ("ifcCategory").
 * @param {string[]} koppen
 * @param {{key: string, label: string, unit?: string}[]} kolommen  van de staat
 * @returns {{id: number, velden: Map<string, number>}}  id = -1 zonder ID-kolom
 */
export function mapHeaders(koppen, kolommen = []) {
  const opKop = new Map();
  for (const c of kolommen) {
    if (!c?.key) continue;
    const label = String(c.label ?? '');
    for (const k of [label + (c.unit ? ` (${c.unit})` : ''), label, c.key]) {
      if (k && !opKop.has(sleutel(k))) opKop.set(sleutel(k), c.key);
    }
  }
  for (const k of EDITABLE_TAG_FIELDS) if (!opKop.has(sleutel(k))) opKop.set(sleutel(k), k);
  let id = -1;
  const velden = new Map();
  koppen.forEach((kop, i) => {
    const k = sleutel(kop);
    if (k === sleutel(TAG_ID_HEADER)) { if (id < 0) id = i; return; }
    const veld = opKop.get(k);
    if (veld && EDITABLE_TAG_FIELDS.includes(veld) && !velden.has(veld)) velden.set(veld, i);
  });
  return { id, velden };
}

/**
 * De kenmerken per annotatie uit een geëxporteerd (en bewerkt) CSV-bestand.
 * Regels zonder id (groepskoppen, subtotalen, totaal) slaat hij over.
 * @returns {{ok: true, updates: {id: string, fields: object}[], fields: string[]}
 *          | {ok: false, error: 'empty' | 'no-id-column' | 'no-tag-columns'}}
 */
export function readTagUpdates(tekst, kolommen = []) {
  const rijen = parseCsv(tekst);
  if (rijen.length < 1) return { ok: false, error: 'empty' };
  const { id, velden } = mapHeaders(rijen[0], kolommen);
  if (id < 0) return { ok: false, error: 'no-id-column' };
  if (velden.size === 0) return { ok: false, error: 'no-tag-columns' };
  const perId = new Map();
  for (const rij of rijen.slice(1)) {
    const annId = String(rij[id] ?? '').trim();
    if (!annId) continue;
    const fields = {};
    for (const [veld, i] of velden) {
      if (i >= rij.length) continue;
      fields[veld] = zonderFormuleSchild(rij[i]).trim().slice(0, MAX_CELL);
    }
    // Staat dezelfde annotatie er twee keer in, dan wint de laatste regel.
    perId.set(annId, { ...(perId.get(annId)?.fields || {}), ...fields });
  }
  return {
    ok: true,
    updates: [...perId].map(([annId, fields]) => ({ id: annId, fields })),
    fields: [...velden.keys()],
  };
}

// ── Toepassen ───────────────────────────────────────────────────────────────

// Het label in de staat is el.label || el.measureName || el.subject (zie
// quantities/categories.js). Terugschrijven gaat naar het veld dat de staat
// toonde, zodat de volgende export precies het nieuwe label laat zien.
function labelVeld(ann) {
  if (ann.label) return 'label';
  if (ann.measureName) return 'measureName';
  if (ann.subject) return 'subject';
  return /^measure/.test(ann.type || '') ? 'measureName' : 'subject';
}

const huidigLabel = (ann) => ann.label || ann.measureName || ann.subject || '';

/**
 * Wat er per annotatie verandert. Raakt niets aan: de aanroeper past `set`
 * toe (met undo). Een lege locatie- of telcategoriecel wijzigt niets; een
 * leeg label of een lege IFC-categorie maakt dat kenmerk leeg.
 * @param {object[]} annotaties  de annotaties van het document
 * @param {{id: string, fields: object}[]} updates  uit readTagUpdates
 * @param {{location?: (ann) => string, countCategoryId?: (naam: string) => string|null,
 *          countCategoryName?: (id: string) => string, isEditable?: (ann) => boolean}} [hulp]
 * @returns {{changes: {ann: object, set: object}[], notFound: string[], locked: string[],
 *            unknownCountCategories: string[]}}
 */
export function planTagChanges(annotaties, updates, hulp = {}) {
  const opId = new Map((annotaties || []).map((a) => [String(a.id), a]));
  const changes = [];
  const notFound = [];
  const locked = [];
  const onbekend = new Set();
  const bewerkbaar = hulp.isEditable || ((a) => !a.locked && !a.readOnly);
  for (const { id, fields } of updates || []) {
    const ann = opId.get(String(id));
    if (!ann) { notFound.push(String(id)); continue; }
    const set = {};
    if ('label' in fields && fields.label !== huidigLabel(ann)) {
      set[labelVeld(ann)] = fields.label;
    }
    if ('ifcCategory' in fields && fields.ifcCategory !== (ann.ifcCategory || '')) {
      set.ifcCategory = fields.ifcCategory;
    }
    if ('location' in fields && fields.location) {
      const nu = typeof hulp.location === 'function' ? hulp.location(ann) : (ann.locationOverride ?? '');
      if (fields.location !== nu) set.locationOverride = fields.location;
    }
    if ('countCat' in fields && fields.countCat && ann.type === 'count') {
      const naamNu = typeof hulp.countCategoryName === 'function' ? hulp.countCategoryName(ann.categoryId) : ann.categoryId;
      if (fields.countCat !== naamNu && fields.countCat !== ann.categoryId) {
        const doel = typeof hulp.countCategoryId === 'function' ? hulp.countCategoryId(fields.countCat) : null;
        if (doel) set.categoryId = doel;
        else onbekend.add(fields.countCat);
      }
    }
    if (Object.keys(set).length === 0) continue;
    if (!bewerkbaar(ann)) { locked.push(String(id)); continue; }
    changes.push({ ann, set });
  }
  return { changes, notFound, locked, unknownCountCategories: [...onbekend] };
}

/**
 * Eén wijziging toepassen. Een leeg label of een lege IFC-categorie wordt een
 * lege tekst: de saver schrijft een leeg kenmerk niet weg.
 */
export function applyTagChange(ann, set) {
  for (const [k, v] of Object.entries(set)) ann[k] = v;
  return ann;
}
