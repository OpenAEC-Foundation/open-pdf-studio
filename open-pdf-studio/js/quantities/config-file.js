// Portable definitions only: no document paths, annotations or calculated rows.
import { CATEGORY_ORDER, FIELD_REGISTRY } from './categories.js';
import { FILTER_OPS } from './engine.js';

export const CONFIG_EXTENSION = 'opds-quantities';
const TYPE = 'open-pdf-studio/quantities';
const fields = new Set(Object.values(FIELD_REGISTRY).flat().map(f => f.key));
const categories = new Set(CATEGORY_ORDER);
const appearanceKeys = ['gridlines', 'outline', 'stripe', 'showTitle', 'showHeaders'];
const requireValid = (ok) => { if (!ok) throw new Error('Invalid quantities configuration'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length <= 32768;
function keys(value, allowed) {
  requireValid(object(value) && Object.keys(value).every(k => allowed.includes(k)));
}
function names(value, allowed) {
  requireValid(Array.isArray(value) && value.length <= allowed.size
    && value.every(k => allowed.has(k)) && new Set(value).size === value.length);
  return [...value];
}
function bool(value) { requireValid(typeof value === 'boolean'); return value; }
function rows(value, limit, validate) {
  requireValid(Array.isArray(value) && value.length <= limit);
  return value.map(validate);
}

/** Validate the whole definition before changing any live signals. */
export function validateQuantitiesConfig(c) {
  keys(c, ['categories', 'fields', 'filters', 'sort', 'itemize', 'grandTotals', 'format', 'appearance']);
  const out = { categories: names(c.categories, categories), fields: names(c.fields, fields) };
  out.filters = rows(c.filters, 8, f => {
    keys(f, ['field', 'op', 'value']);
    requireValid((f.field === '' || fields.has(f.field)) && (f.op === '' || FILTER_OPS.includes(f.op)));
    requireValid(text(f.value) || (typeof f.value === 'number' && Number.isFinite(f.value)));
    return { ...f };
  });
  out.sort = rows(c.sort, 4, s => {
    keys(s, ['field', 'dir', 'group', 'header', 'footer']);
    requireValid((s.field === '' || fields.has(s.field)) && ['asc', 'desc'].includes(s.dir));
    for (const k of ['group', 'header', 'footer']) if (s[k] !== undefined) bool(s[k]);
    return { ...s };
  });
  out.itemize = bool(c.itemize); out.grandTotals = bool(c.grandTotals);
  requireValid(object(c.format));
  out.format = {};
  for (const [key, f] of Object.entries(c.format)) {
    requireValid(fields.has(key));
    keys(f, ['heading', 'unit', 'decimals', 'align', 'total']);
    for (const k of ['heading', 'unit']) if (f[k] !== undefined) requireValid(text(f[k]));
    if (f.decimals != null) requireValid(Number.isInteger(f.decimals) && f.decimals >= 0 && f.decimals <= 6);
    if (f.align !== undefined) requireValid(['left', 'right'].includes(f.align));
    if (f.total !== undefined) bool(f.total);
    out.format[key] = { ...f };
  }
  keys(c.appearance, appearanceKeys);
  out.appearance = Object.fromEntries(appearanceKeys.map(k => [k, bool(c.appearance[k])]));
  return out;
}

export function encodeQuantitiesConfig(config) {
  // An empty decimals input is NaN in the UI: JSON null keeps the default.
  const copy = JSON.parse(JSON.stringify(config));
  return JSON.stringify({ type: TYPE, version: 1, config: validateQuantitiesConfig(copy) }, null, 2) + '\n';
}

export function decodeQuantitiesConfig(source) {
  requireValid(typeof source === 'string' && source.length <= 2 * 1024 * 1024);
  const file = JSON.parse(source.replace(/^\uFEFF/, ''));
  keys(file, ['type', 'version', 'config']);
  requireValid(file.type === TYPE && file.version === 1);
  return validateQuantitiesConfig(file.config);
}
