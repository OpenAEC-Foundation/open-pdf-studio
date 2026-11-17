// De MCP-opdrachten voor staten (#1130): plaatsen, bijwerken en verwijderen.
//
// Een staat is een benoemde definitie (categorieën, kolommen, filters,
// sortering) die de hele app deelt; de cijfers komen uit het document dat op
// dat moment actief is, en een geplaatste tabel is een momentopname in het
// document waar hij staat.
//
// Deze module is puur: de regels staan hier, mcp-bridge.js levert de store,
// het document en de ongedaan-stap aan. De config wordt gecontroleerd vóórdat
// er iets wordt aangemaakt, zodat een mislukte poging geen lege staat
// achterlaat.

import { CATEGORY_ORDER, fieldsForCategories } from './categories.js';
import { FILTER_OPS } from './engine.js';

const CONFIG_SLEUTELS = ['categories', 'fields', 'filters', 'sort', 'itemize', 'format'];
const OPMAAK_SLEUTELS = ['heading', 'decimals', 'align', 'total', 'unit'];
const SORTEER_SLEUTELS = ['field', 'dir', 'group', 'header', 'footer'];
const FILTER_SLEUTELS = ['field', 'op', 'value'];
// Filters die geen waarde nodig hebben.
const OPS_ZONDER_WAARDE = new Set(['has', 'none']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const kloon = (v) => JSON.parse(JSON.stringify(v));
const fout = (error) => ({ ok: false, error });

function onbekendeSleutel(obj, toegestaan) {
  return Object.keys(obj).find((k) => !toegestaan.includes(k));
}

function controleerCategorieen(lijst) {
  if (!Array.isArray(lijst) || lijst.some((c) => typeof c !== 'string')) {
    return 'config.categories must be an array of category keys';
  }
  const onbekend = lijst.find((c) => !CATEGORY_ORDER.includes(c));
  if (onbekend !== undefined) {
    return `unknown category: ${onbekend} (categories: ${CATEGORY_ORDER.join(', ')})`;
  }
  return null;
}

function controleerFilters(lijst, bekend, velden) {
  if (!Array.isArray(lijst)) return 'config.filters must be an array of { field, op, value }';
  for (const f of lijst) {
    if (!isObject(f)) return 'config.filters must be an array of { field, op, value }';
    const vreemd = onbekendeSleutel(f, FILTER_SLEUTELS);
    if (vreemd) return `unknown filter key: ${vreemd} (allowed: ${FILTER_SLEUTELS.join(', ')})`;
    if (typeof f.field !== 'string' || !bekend.has(f.field)) {
      return `unknown filter field: ${f.field} (fields: ${velden})`;
    }
    if (!FILTER_OPS.includes(f.op)) {
      return `unknown filter op: ${f.op} (ops: ${FILTER_OPS.join(', ')})`;
    }
    if (!OPS_ZONDER_WAARDE.has(f.op) && (f.value === undefined || f.value === null)) {
      return `filter on ${f.field} with op ${f.op} needs a value`;
    }
  }
  return null;
}

function controleerSortering(lijst, bekend, velden) {
  if (!Array.isArray(lijst)) return 'config.sort must be an array of { field, dir, group }';
  for (const s of lijst) {
    if (!isObject(s)) return 'config.sort must be an array of { field, dir, group }';
    const vreemd = onbekendeSleutel(s, SORTEER_SLEUTELS);
    if (vreemd) return `unknown sort key: ${vreemd} (allowed: ${SORTEER_SLEUTELS.join(', ')})`;
    if (typeof s.field !== 'string' || !bekend.has(s.field)) {
      return `unknown sort field: ${s.field} (fields: ${velden})`;
    }
    if (s.dir !== undefined && s.dir !== 'asc' && s.dir !== 'desc') {
      return `sort dir must be asc or desc (got ${s.dir})`;
    }
    for (const k of ['group', 'header', 'footer']) {
      if (s[k] !== undefined && typeof s[k] !== 'boolean') return `sort ${k} must be a boolean`;
    }
  }
  return null;
}

function controleerOpmaak(opmaak, bekend, velden) {
  if (!isObject(opmaak)) return 'config.format must be an object keyed by field';
  for (const [veld, fmt] of Object.entries(opmaak)) {
    if (!bekend.has(veld)) return `unknown format field: ${veld} (fields: ${velden})`;
    if (!isObject(fmt)) return `config.format.${veld} must be an object`;
    const vreemd = onbekendeSleutel(fmt, OPMAAK_SLEUTELS);
    if (vreemd) return `unknown format key: ${vreemd} (allowed: ${OPMAAK_SLEUTELS.join(', ')})`;
    if (fmt.heading !== undefined && typeof fmt.heading !== 'string') return `config.format.${veld}.heading must be a string`;
    if (fmt.unit !== undefined && typeof fmt.unit !== 'string') return `config.format.${veld}.unit must be a string`;
    if (fmt.total !== undefined && typeof fmt.total !== 'boolean') return `config.format.${veld}.total must be a boolean`;
    if (fmt.align !== undefined && fmt.align !== 'left' && fmt.align !== 'right') {
      return `config.format.${veld}.align must be left or right`;
    }
    if (fmt.decimals !== undefined && !(Number.isInteger(fmt.decimals) && fmt.decimals >= 0 && fmt.decimals <= 6)) {
      return `config.format.${veld}.decimals must be an integer from 0 to 6`;
    }
  }
  return null;
}

/**
 * De config van een staat zoals hij na de opdracht wordt: `gegeven` over
 * `basis` (het sjabloon of de bestaande staat) heen. Elke sleutel die de
 * aanroeper geeft vervangt die sleutel; wat hij weglaat blijft staan. Uit het
 * overgenomen deel vallen de filters, sorteerniveaus en opmaakregels weg die
 * naar een veld wijzen dat de (nieuwe) categorieën niet kennen.
 *
 * Alles wat de aanroeper zelf geeft wordt gecontroleerd; een staat zonder
 * kolommen is een fout, met de velden erbij die wél kunnen.
 *
 * @param {object|null|undefined} basis
 * @param {object|null|undefined} gegeven
 * @returns {{ok: true, config: object} | {ok: false, error: string}}
 */
export function staatConfig(basis, gegeven) {
  if (gegeven != null && !isObject(gegeven)) return fout('config must be an object');
  const b = isObject(basis) ? basis : {};
  const g = gegeven || {};
  const vreemd = onbekendeSleutel(g, CONFIG_SLEUTELS);
  if (vreemd) return fout(`unknown config key: ${vreemd} (allowed: ${CONFIG_SLEUTELS.join(', ')})`);

  if ('categories' in g) {
    const f = controleerCategorieen(g.categories);
    if (f) return fout(f);
  }
  const categories = [...new Set('categories' in g ? g.categories : (Array.isArray(b.categories) ? b.categories : []))];
  if (!categories.length) {
    return fout(`config.categories is empty: choose at least one of ${CATEGORY_ORDER.join(', ')}`);
  }

  const bekendeVelden = fieldsForCategories(categories).map((f) => f.key);
  const bekend = new Set(bekendeVelden);
  const velden = bekendeVelden.join(', ');
  const voor = `for ${categories.join(' + ')}`;

  let fields;
  if ('fields' in g) {
    if (!Array.isArray(g.fields) || g.fields.some((k) => typeof k !== 'string')) {
      return fout('config.fields must be an array of field keys');
    }
    const onbekend = g.fields.find((k) => !bekend.has(k));
    if (onbekend !== undefined) return fout(`unknown field: ${onbekend} (fields ${voor}: ${velden})`);
    fields = [...new Set(g.fields)];
  } else {
    fields = (Array.isArray(b.fields) ? b.fields : []).filter((k) => bekend.has(k));
  }
  if (!fields.length) {
    return fout(`the schedule would have no columns: give config.fields (fields ${voor}: ${velden})`);
  }

  let filters;
  if ('filters' in g) {
    const f = controleerFilters(g.filters, bekend, velden);
    if (f) return fout(f);
    filters = g.filters;
  } else {
    filters = (Array.isArray(b.filters) ? b.filters : []).filter((x) => x && bekend.has(x.field));
  }

  let sort;
  if ('sort' in g) {
    const f = controleerSortering(g.sort, bekend, velden);
    if (f) return fout(f);
    sort = g.sort;
  } else {
    sort = (Array.isArray(b.sort) ? b.sort : []).filter((x) => x && bekend.has(x.field));
  }

  if ('itemize' in g && typeof g.itemize !== 'boolean') return fout('config.itemize must be a boolean');
  const itemize = 'itemize' in g ? g.itemize : b.itemize !== false;

  let format;
  if ('format' in g) {
    const f = controleerOpmaak(g.format, bekend, velden);
    if (f) return fout(f);
    format = g.format;
  } else {
    format = Object.fromEntries(Object.entries(isObject(b.format) ? b.format : {}).filter(([k]) => bekend.has(k)));
  }

  return { ok: true, config: kloon({ categories, fields, filters, sort, itemize, format }) };
}

const naamSleutel = (naam) => String(naam ?? '').trim().toLowerCase();

function staatLijst(lijst) {
  const namen = lijst.slice(0, 20).map((s) => `${s.name} [${s.id}]`);
  if (lijst.length > 20) namen.push('...');
  return namen.length ? namen.join(', ') : 'none';
}

/**
 * Een staat opzoeken zoals een assistent hem noemt: op id, anders op naam
 * (eerst letterlijk, dan zonder op hoofdletters en spaties te letten). Een naam
 * die bij meer staten hoort is een fout met de id's erbij: mislukte pogingen
 * dragen vaak dezelfde naam, en dan moet duidelijk zijn welke bedoeld is.
 *
 * @param {{id: string, name: string}[]} lijst
 * @param {{scheduleId?: string, name?: string}} args
 * @returns {{ok: true, schedule: object, index: number} | {ok: false, error: string}}
 */
export function zoekStaat(lijst, args) {
  const alle = Array.isArray(lijst) ? lijst : [];
  const id = args?.scheduleId;
  const naam = args?.name;
  if (id != null) {
    if (typeof id !== 'string' || !id) return fout('scheduleId must be a string');
    const index = alle.findIndex((s) => s.id === id);
    if (index === -1) return fout(`schedule not found: ${id} (schedules: ${staatLijst(alle)})`);
    return { ok: true, schedule: alle[index], index };
  }
  if (naam == null) return fout('scheduleId or name is required');
  if (typeof naam !== 'string' || !naam.trim()) return fout('name must be a non-empty string');
  let treffers = alle.filter((s) => s.name === naam);
  if (!treffers.length) treffers = alle.filter((s) => naamSleutel(s.name) === naamSleutel(naam));
  if (!treffers.length) return fout(`schedule not found: ${naam} (schedules: ${staatLijst(alle)})`);
  if (treffers.length > 1) {
    return fout(`${treffers.length} schedules are named ${naam}: pass scheduleId (${treffers.map((s) => s.id).join(', ')})`);
  }
  return { ok: true, schedule: treffers[0], index: alle.indexOf(treffers[0]) };
}

/** De geplaatste tabellen van een staat tussen de annotaties van een document. */
export function tabellenVanStaat(annotations, scheduleId) {
  if (!scheduleId) return [];
  return (annotations || []).filter((a) => a && a.type === 'scheduleTable' && a.scheduleId === scheduleId);
}

function schoneNaam(waarde, veld) {
  if (waarde === undefined) return { ok: true, naam: undefined };
  if (typeof waarde !== 'string' || !waarde.trim()) return fout(`${veld} must be a non-empty string`);
  return { ok: true, naam: waarde.trim() };
}

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Een staat aanmaken (of een bestaande hergebruiken) en als tabel plaatsen.
 * Alle controles gaan vooraf aan de eerste wijziging; mislukt het plaatsen
 * toch, dan wordt de aangemaakte staat weer verwijderd en krijgt een
 * bestaande staat zijn oude naam en config terug.
 *
 * @param {object} params  de argumenten van app_place_schedule
 * @param {{
 *   doc: {currentPage?: number, numPages?: number} | null,
 *   lijst: () => object[],
 *   sjabloon: (id: string) => ({config: object} | null),
 *   sjabloonIds: () => string[],
 *   voegToe: (gegevens: {name: string, templateId: string, config: object}) => {id: string},
 *   werkBij: (id: string, wijziging: {name?: string, config?: object}) => void,
 *   verwijder: (id: string) => void,
 *   plaats: (id: string, x: number, y: number, page: number) => (object | null),
 * }} o
 */
export function plaatsStaat(params, o) {
  const p = isObject(params) ? params : {};
  if (!o.doc) return fout('no active document');

  const naam = schoneNaam(p.name === null ? undefined : p.name, 'name');
  if (!naam.ok) return naam;

  let bestaand = null;
  let basis;
  let templateId = null;
  if (p.scheduleId != null) {
    const gevonden = zoekStaat(o.lijst(), { scheduleId: p.scheduleId });
    if (!gevonden.ok) return gevonden;
    bestaand = gevonden.schedule;
    basis = bestaand.config;
  } else {
    templateId = p.templateId == null ? 'area' : p.templateId;
    const tpl = typeof templateId === 'string' ? o.sjabloon(templateId) : null;
    if (!tpl) return fout(`unknown template: ${templateId} (templates: ${o.sjabloonIds().join(', ')})`);
    basis = tpl.config;
  }

  const cfg = staatConfig(basis, p.config);
  if (!cfg.ok) return cfg;

  let page = o.doc.currentPage || 1;
  if (p.page != null) {
    page = Number(p.page);
    const numPages = o.doc.numPages ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > numPages) {
      return fout(`page ${p.page} out of range (doc has ${numPages} pages)`);
    }
  }
  const x = isGetal(p.x) ? p.x : 40;
  const y = isGetal(p.y) ? p.y : 40;

  // Vanaf hier verandert er iets.
  let id;
  let terug;
  if (bestaand) {
    id = bestaand.id;
    const oud = { name: bestaand.name, config: kloon(bestaand.config || {}) };
    const wijziging = {};
    if (naam.naam !== undefined && naam.naam !== bestaand.name) wijziging.name = naam.naam;
    if (p.config != null) wijziging.config = cfg.config;
    const geraakt = Object.keys(wijziging).length > 0;
    if (geraakt) o.werkBij(id, wijziging);
    terug = () => { if (geraakt) o.werkBij(id, oud); };
  } else {
    const item = o.voegToe({ name: naam.naam || templateId, templateId, config: cfg.config });
    id = item.id;
    terug = () => o.verwijder(id);
  }

  let ann = null;
  try {
    ann = o.plaats(id, x, y, page);
  } catch (e) {
    terug();
    return fout(`placing the schedule failed: ${e?.message || e}`);
  }
  if (!ann) {
    terug();
    return fout('schedule produced no columns — check its categories/fields');
  }
  return {
    ok: true,
    scheduleId: id,
    created: !bestaand,
    annotationId: ann.id,
    page: ann.page,
    x: ann.x, y: ann.y, width: ann.width, height: ann.height,
    title: ann.title,
    columns: ann.columns,
    rowCount: Array.isArray(ann.rows) ? ann.rows.length : 0,
  };
}

/**
 * Een staat hernoemen en/of zijn config aanpassen, zonder iets te plaatsen.
 *
 * @param {object} params  de argumenten van app_update_schedule
 * @param {{
 *   lijst: () => object[],
 *   werkBij: (id: string, wijziging: {name?: string, config?: object}) => void,
 * }} o
 */
export function werkStaatBij(params, o) {
  const p = isObject(params) ? params : {};
  const vreemd = onbekendeSleutel(p, ['scheduleId', 'name', 'newName', 'config']);
  if (vreemd) return fout(`unknown argument: ${vreemd}`);
  const gevonden = zoekStaat(o.lijst(), p);
  if (!gevonden.ok) return gevonden;
  const staat = gevonden.schedule;

  const nieuw = schoneNaam(p.newName === null ? undefined : p.newName, 'newName');
  if (!nieuw.ok) return nieuw;
  if (nieuw.naam === undefined && p.config == null) return fout('nothing to change: give newName and/or config');

  const wijziging = {};
  const changed = [];
  if (p.config != null) {
    const cfg = staatConfig(staat.config, p.config);
    if (!cfg.ok) return cfg;
    wijziging.config = cfg.config;
    changed.push('config');
  }
  if (nieuw.naam !== undefined && nieuw.naam !== staat.name) {
    wijziging.name = nieuw.naam;
    changed.push('name');
  }
  if (changed.length) o.werkBij(staat.id, wijziging);
  return {
    ok: true,
    scheduleId: staat.id,
    name: wijziging.name ?? staat.name,
    config: wijziging.config ?? kloon(staat.config || {}),
    changed,
  };
}

/**
 * Een staat verwijderen, samen met zijn geplaatste tabellen in het actieve
 * document.
 *
 * @param {object} params  de argumenten van app_delete_schedule
 * @param {{
 *   lijst: () => object[],
 *   annotaties: () => object[],
 *   elders?: (scheduleId: string) => number,
 *   verwijder: (schedule: object, index: number, tabellen: object[]) => void,
 * }} o  `annotaties` geeft de annotaties van het actieve document (leeg zonder
 *       document); `elders` telt de tabellen van de staat in andere open
 *       documenten; `verwijder` haalt de tabellen en de staat weg, als één
 *       ongedaan-stap.
 */
export function verwijderStaat(params, o) {
  const p = isObject(params) ? params : {};
  const vreemd = onbekendeSleutel(p, ['scheduleId', 'name']);
  if (vreemd) return fout(`unknown argument: ${vreemd}`);
  const gevonden = zoekStaat(o.lijst(), p);
  if (!gevonden.ok) return gevonden;
  const staat = gevonden.schedule;

  const tabellen = tabellenVanStaat(o.annotaties(), staat.id);
  const elders = typeof o.elders === 'function' ? (o.elders(staat.id) || 0) : 0;
  const uit = {
    ok: true,
    scheduleId: staat.id,
    name: staat.name,
    removedTables: tabellen.map((a) => ({ id: a.id, page: a.page })),
    // Zonder tabellen verandert het document niet: dan is er geen stap om
    // ongedaan te maken. De definitie gaat mee terug, zodat de staat opnieuw
    // te maken is.
    undoable: tabellen.length > 0,
    schedule: kloon({ id: staat.id, name: staat.name, templateId: staat.templateId ?? null, config: staat.config || {} }),
  };
  if (elders > 0) uit.tablesInOtherDocuments = elders;
  o.verwijder(staat, gevonden.index, tabellen);
  return uit;
}
