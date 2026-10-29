// Tool Sets ("Werkkist", #311): saved, reusable measurement and markup
// presets, grouped in named tool sets.
//
// An ITEM holds the settings of a placed annotation — layer, colours, line
// width, label/name, unit, precision, depth, hatch, line ends, … (SAVED_KEYS)
// — and none of what was drawn: no geometry, no measured result, no identity
// (id, page, author, dates, replies, status). The settings are applied to the
// NEXT annotation drawn with the item's tool (tools/tool-set-session.js).
//
// A TOOL SET is a named list of items. The catalog is the list of tool sets.
// Every function here is pure and returns new objects; the store
// (solid/stores/toolSetsStore.js) keeps the catalog and persists it.
//
// Exchange file: one tool set as JSON, see serializeToolSet/parseToolSetFile.

import { getStyleMapping } from '../core/stijl-mapping.js';
import { writeStylePrefs } from '../core/style-prefs.js';
import { getLayers, addLayer, DEFAULT_LAYER_ID } from './annotatie-lagen.js';
import { lengteEenheid, eenheidFactor } from './vlak-zijden.js';
import { nettoVlakOppervlak } from './vlak-ringen.js';

export const TOOL_SET_FORMAT = 'open-pdf-studio/tool-set';
export const TOOL_SET_VERSION = 1;
export const TOOL_SET_EXTENSION = 'opdstools';
export const CATALOG_VERSION = 1;

const MAX_NAME = 120;
const MAX_ITEMS_PER_SET = 500;
const MAX_SETS = 200;
const MAX_FILE_CHARS = 4 * 1024 * 1024;
const MAX_STRING = 20000;

/**
 * Annotation type → the tool that draws it. Only these types can be saved:
 * each has a drawing tool of its own that creates exactly that type.
 */
export const TOOL_FOR_TYPE = Object.freeze({
  measureDistance: 'measureDistance',
  measureArea: 'measureArea',
  measurePerimeter: 'measurePerimeter',
  measureAngle: 'measureAngle',
  line: 'line',
  arrow: 'arrow',
  polyline: 'polyline',
  polygon: 'polygon',
  box: 'box',
  circle: 'circle',
  cloud: 'cloud',
  filledArea: 'filledArea',
  wall: 'wall',
});

/** Translation key of each type's name (shared with the ribbon). */
export const TYPE_LABEL_KEYS = Object.freeze({
  measureDistance: 'ribbon:compareAnnType.measureDistance',
  measureArea: 'ribbon:compareAnnType.measureArea',
  measurePerimeter: 'ribbon:compareAnnType.measurePerimeter',
  measureAngle: 'ribbon:measure.angle',
  line: 'ribbon:compareAnnType.line',
  arrow: 'ribbon:compareAnnType.arrow',
  polyline: 'ribbon:compareAnnType.polyline',
  polygon: 'ribbon:compareAnnType.polygon',
  box: 'ribbon:compareAnnType.box',
  circle: 'ribbon:compareAnnType.circle',
  cloud: 'ribbon:compareAnnType.cloud',
  filledArea: 'ribbon:comment.filledArea',
  wall: 'properties:toolSets.typeWall',
});

export function isToolSetType(type) {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(TOOL_FOR_TYPE, type);
}

export function toolForType(type) {
  return isToolSetType(type) ? TOOL_FOR_TYPE[type] : null;
}

// ── Capturing ─────────────────────────────────────────────────────────────

// What an item keeps: the style, label and measurement settings of an
// annotation. An ALLOWLIST, so identity, placement, drawn geometry, measured
// results, relations to other annotations and any internal or future key
// never travel from a saved item onto every new annotation. The layer is
// stored separately (by name, see captureLayer).
const SAVED_KEYS = new Set([
  // appearance
  'color', 'strokeColor', 'fillColor', 'fillNone', 'fillOpacity', 'opacity',
  'lineWidth', 'borderWidth', 'borderStyle', 'styleType', 'printable',
  'startHead', 'endHead', 'headSize', 'lineTail',
  'hatchPattern', 'hatchColor', 'hatchScale', 'hatchAngle',
  'cloudIntensity', 'boxShape',
  // text of the label
  'fontSize', 'fontFamily', 'fontBold', 'fontItalic', 'fontUnderline', 'fontStrikethrough',
  'textColor', 'textFontSize', 'textAlign', 'textVAlign', 'textPadding', 'labelColor',
  // measurement
  'measureUnit', 'measurePrecision', 'measureDepth', 'measureName', 'measureShowLabel',
  'measureShowEdgeLengths', 'dimType', 'dimExtension', 'dimShowUnit',
  'dimExtOvershootMm', 'dimExtGapMm', 'dimLineOvershootMm', 'dimOvershootEnds',
  // description and classification
  'subject', 'ifcCategory',
  // wall
  'dikteMm', 'isolatieType',
]);

function isPlainValue(v) {
  return v === null || typeof v === 'string' || typeof v === 'boolean'
    || (typeof v === 'number' && Number.isFinite(v));
}

/** Is this property one an item keeps (a style or measurement setting)? */
export function isSavedProperty(key, value) {
  return typeof key === 'string' && SAVED_KEYS.has(key) && isPlainValue(value)
    && !(typeof value === 'string' && value.length > MAX_STRING);
}

/**
 * The saveable properties of an annotation (or of an imported item): the
 * allowlisted style and measurement settings. Line width and font size
 * are stored WITHOUT the viewport's dynamic scaling, so the item draws at
 * the right size in any viewport.
 */
export function sanitizeProps(type, props) {
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  for (const [k, v] of Object.entries(props)) {
    if (isSavedProperty(k, v)) out[k] = v;
  }
  const factor = Number(props.viewportScaleFactor);
  if (factor > 0 && factor !== 1) {
    if (typeof out.lineWidth === 'number') out.lineWidth = Math.round((out.lineWidth / factor) * 100) / 100;
    if (typeof out.fontSize === 'number') out.fontSize = Math.round(out.fontSize / factor);
    if (typeof out.textFontSize === 'number') out.textFontSize = Math.round(out.textFontSize / factor);
  }
  return out;
}

/** The layer of an annotation as a portable reference: null = default layer. */
export function captureLayer(doc, ann) {
  const id = typeof ann?.layer === 'string' && ann.layer ? ann.layer : DEFAULT_LAYER_ID;
  if (id === DEFAULT_LAYER_ID) return null;
  const layer = getLayers(doc).find((l) => l.id === id);
  if (!layer || !layer.name) return null;
  return { name: layer.name, color: layer.color || null };
}

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

/** A suggested item name: the label of the annotation, if it has one. */
export function suggestedItemName(ann) {
  return cleanName(ann?.measureName) || cleanName(ann?.subject) || cleanName(ann?.label) || '';
}

let _seq = 0;
export function newId(prefix = 'ts') {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A tool set item from a placed annotation. Missing properties are simply
 * absent: applying the item then keeps the tool's own defaults for them.
 * Returns null for a type Tool Sets does not support.
 */
export function captureItem(ann, { doc = null, name = '', fallbackName = '', id = null, now = null } = {}) {
  if (!ann || !isToolSetType(ann.type)) return null;
  return {
    id: id || newId('tsi'),
    name: cleanName(name) || suggestedItemName(ann) || cleanName(fallbackName) || ann.type,
    type: ann.type,
    props: sanitizeProps(ann.type, ann),
    layer: captureLayer(doc, ann),
    createdAt: now || new Date().toISOString(),
  };
}

// ── Applying to a new annotation ───────────────────────────────────────────

/**
 * Which annotation properties each style preference of a type feeds (the
 * reverse of stijl-mapping.js). The session uses it to see which properties
 * the user changed in the tool defaults while an item was active.
 */
export function prefKeyToAnnKeys(type) {
  const m = getStyleMapping(type);
  const map = new Map();
  if (!m) return map;
  const p = m.prefix;
  const add = (field, keys) => { if (field) map.set(p + field, keys); };
  add(m.stroke, ['strokeColor', 'color']);
  add(m.color, ['color']);
  add(m.fill, ['fillColor']);
  add(m.fillNone, ['fillColor']);
  add(m.width, ['lineWidth']);
  add(m.borderStyle, ['borderStyle']);
  add(m.opacity, ['opacity']);
  add(m.fillOpacity, ['fillOpacity']);
  add(m.startHead, ['startHead']);
  add(m.endHead, ['endHead']);
  add(m.headSize, ['headSize']);
  add(m.fontSize, ['fontSize']);
  add(m.icon, ['icon']);
  add(m.overlayColor, ['overlayColor']);
  if (m.hatch) {
    add('HatchPattern', ['hatchPattern']);
    add('HatchColor', ['hatchColor']);
    add('HatchScale', ['hatchScale']);
  }
  add('StyleType', ['styleType']);
  if (m.dimension) {
    if (!m.noDimScale) add('DimUnit', ['measureUnit']);
    add('DimPrecision', ['measurePrecision']);
    add('DimType', ['dimType']);
    add('DimExtension', ['dimExtension']);
  }
  add(m.edgeLengths, ['measureShowEdgeLengths']);
  return map;
}

/**
 * The style preferences an item implies, as a set of changed keys over
 * `prefs`: { key: value }. Used as a TEMPORARY overlay while the item is the
 * active tool, so the preview, the tool defaults panel and the tool itself
 * all draw with the item's style. `prefs` itself is not changed.
 */
export function stylePrefsOverlay(item, prefs) {
  if (!item || !isToolSetType(item.type)) return {};
  const base = prefs || {};
  const next = { ...base };
  if (!writeStylePrefs({ type: item.type, ...(item.props || {}) }, next)) return {};
  const overlay = {};
  for (const [k, v] of Object.entries(next)) {
    if (base[k] !== v) overlay[k] = v;
  }
  // A key writeStylePrefs removed (fillOpacity without own value).
  for (const k of Object.keys(base)) {
    if (!(k in next)) overlay[k] = undefined;
  }
  return overlay;
}

function polylineLength(points) {
  let total = 0;
  for (let i = 0; i < (points?.length || 0) - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

function fixed(value, precision) {
  const p = Math.max(0, Math.min(9, Number.isInteger(precision) ? precision : 2));
  return value.toFixed(p);
}

// Units per page point of a just-measured annotation, in its own unit.
function unitsPerPoint(ann) {
  if (Number(ann.measureScale) > 0) return Number(ann.measureScale);
  const value = Number(ann.measureValue);
  if (!Number.isFinite(value)) return null;
  if (ann.type === 'measureDistance') {
    const px = Number(ann.measurePixels) || Math.hypot((ann.endX ?? 0) - (ann.startX ?? 0), (ann.endY ?? 0) - (ann.startY ?? 0));
    return px > 0 ? value / px : null;
  }
  if (ann.type === 'measurePerimeter') {
    const px = polylineLength(ann.points);
    return px > 0 ? value / px : null;
  }
  if (ann.type === 'measureArea') {
    const px = nettoVlakOppervlak(ann.points, ann.holes);
    return px > 0 && value >= 0 ? Math.sqrt(value / px) : null;
  }
  return null;
}

/**
 * Put a just-measured annotation in the item's unit and precision. The real
 * size stays the same: the annotation gets its own scale in the new unit
 * (as choosing a unit in the properties panel does for an area), so a later
 * recalculation keeps the unit. A unit without a fixed ratio (px) is left.
 */
export function applyMeasureUnit(ann, unit, precision, { formatMeasurement } = {}) {
  if (!ann || !['measureDistance', 'measurePerimeter', 'measureArea'].includes(ann.type)) return false;
  const target = lengteEenheid(unit);
  const current = lengteEenheid(ann.measureUnit);
  const prec = Number.isInteger(precision) ? precision : ann.measurePrecision;
  let changed = false;
  let value = Number(ann.measureValue);
  let unitOut = current;

  if (target && current && target !== current) {
    const f = eenheidFactor(current, target);
    const perPt = f == null ? null : unitsPerPoint(ann);
    if (f != null && perPt != null) {
      ann.measureScale = perPt * f;
      value = ann.type === 'measureArea' ? value * f * f : value * f;
      unitOut = target;
      changed = true;
    }
  }
  if (Number.isInteger(prec) && prec !== ann.measurePrecision) {
    ann.measurePrecision = prec;
    changed = true;
  }
  if (!changed || !Number.isFinite(value)) return changed;

  ann.measureValue = value;
  if (ann.type === 'measureArea') {
    ann.measureUnit = unitOut + '²';
    ann.measureText = typeof formatMeasurement === 'function'
      ? formatMeasurement({ value, unit: ann.measureUnit })
      : `${fixed(value, ann.measurePrecision)} ${ann.measureUnit}`;
  } else if (ann.type === 'measureDistance') {
    ann.measureUnit = unitOut;
    // mm is the implied drawing unit on dimensions: whole numbers, no suffix.
    ann.measureText = unitOut === 'mm' ? fixed(value, 0) : `${fixed(value, ann.measurePrecision)} ${unitOut}`;
  } else {
    ann.measureUnit = unitOut;
    ann.measureText = `${fixed(value, ann.measurePrecision)} ${unitOut}`;
  }
  return true;
}

/** Find the layer of an item in a document by name, or create it. */
export function resolveItemLayer(doc, layerRef) {
  if (!doc || !layerRef || typeof layerRef.name !== 'string' || !layerRef.name.trim()) return { id: null, added: false };
  const key = layerRef.name.trim().toLowerCase();
  const found = getLayers(doc).find((l) => l.id !== DEFAULT_LAYER_ID && (l.name || '').trim().toLowerCase() === key);
  if (found) return { id: found.id, added: false };
  const r = addLayer(doc, { name: layerRef.name, color: layerRef.color || null });
  return r.ok ? { id: r.layer.id, added: true } : { id: null, added: false };
}

// Properties the session overlay already put on the annotation via the
// preferences, with the viewport's dynamic scaling applied by the tool.
const SCALED_KEYS = { lineWidth: 'width', fontSize: 'fontSize' };
const MEASURE_UNIT_KEYS = new Set(['measureUnit', 'measurePrecision']);

/**
 * Apply an item to a newly drawn annotation of its type. Geometry and
 * measured values of `ann` stay; everything the item stores is set.
 *
 * - `skipKeys`: annotation properties the user changed in the tool defaults
 *   while the item was active; their new value (already on `ann`) wins.
 * - `doc`: the document, for the layer (found by name, created if missing).
 * - `formatMeasurement`: the app's area formatter (optional).
 *
 * Returns { layerAdded } so the caller can refresh the layers panel.
 */
export function applyItemToAnnotation(ann, item, { skipKeys = new Set(), doc = null, formatMeasurement } = {}) {
  const result = { applied: false, layerAdded: false };
  if (!ann || !item || ann.type !== item.type) return result;
  const props = item.props || {};
  const m = getStyleMapping(item.type);
  const factor = Number(ann.viewportScaleFactor) > 0 ? Number(ann.viewportScaleFactor) : 1;

  for (const [k, v] of Object.entries(props)) {
    if (!isSavedProperty(k, v) || skipKeys.has(k) || MEASURE_UNIT_KEYS.has(k)) continue;
    if (SCALED_KEYS[k]) {
      // Covered by the preferences overlay (and scaled by the tool) when the
      // type has that preference; otherwise scale it here.
      if (m && m[SCALED_KEYS[k]]) continue;
      if (typeof v === 'number') {
        ann[k] = factor !== 1 ? Math.round(v * factor * 10) / 10 : v;
        continue;
      }
    }
    ann[k] = v;
  }

  if ('measureUnit' in props || 'measurePrecision' in props) {
    const unit = skipKeys.has('measureUnit') ? null : props.measureUnit;
    const prec = skipKeys.has('measurePrecision') ? undefined : props.measurePrecision;
    applyMeasureUnit(ann, unit, Number.isInteger(prec) ? prec : undefined, { formatMeasurement });
  }

  if (item.layer === null) {
    delete ann.layer;
  } else if (item.layer && doc) {
    const { id, added } = resolveItemLayer(doc, item.layer);
    if (id) ann.layer = id;
    result.layerAdded = added;
  }
  result.applied = true;
  return result;
}

// ── The catalog: tool sets and items ────────────────────────────────────────

export function emptyCatalog() {
  return { version: CATALOG_VERSION, sets: [] };
}

function sameName(a, b) {
  return cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
}

/** `base`, or `base (2)`, `base (3)`, … — the first name not in `taken`. */
export function uniqueName(base, taken) {
  const name = cleanName(base) || 'Tool set';
  const has = (n) => (taken || []).some((t) => sameName(t, n));
  if (!has(name)) return name;
  const stem = name.replace(/\s*\(\d+\)$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})`;
    if (!has(candidate)) return candidate;
  }
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isToolSetType(raw.type)) return null;
  if (raw.props != null && (typeof raw.props !== 'object' || Array.isArray(raw.props))) return null;
  let layer;
  if (raw.layer === null) layer = null;
  else if (raw.layer && typeof raw.layer === 'object' && typeof raw.layer.name === 'string' && cleanName(raw.layer.name)) {
    layer = { name: cleanName(raw.layer.name), color: typeof raw.layer.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.layer.color) ? raw.layer.color : null };
  }
  const item = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId('tsi'),
    name: cleanName(raw.name) || raw.type,
    type: raw.type,
    props: sanitizeProps(raw.type, raw.props || {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : new Date().toISOString(),
  };
  if (layer !== undefined) item.layer = layer;
  return item;
}

function normalizeSet(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const items = [];
  const seen = new Set();
  for (const r of Array.isArray(raw.items) ? raw.items.slice(0, MAX_ITEMS_PER_SET) : []) {
    const item = normalizeItem(r);
    if (!item) continue;
    if (seen.has(item.id)) item.id = newId('tsi');
    seen.add(item.id);
    items.push(item);
  }
  return { id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId('tss'), name, items };
}

/** A stored catalog in fixed form; anything unusable is dropped. */
export function normalizeCatalog(raw) {
  const catalog = emptyCatalog();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sets)) return catalog;
  const ids = new Set();
  const names = [];
  for (const r of raw.sets.slice(0, MAX_SETS)) {
    const set = normalizeSet(r);
    if (!set) continue;
    if (ids.has(set.id)) set.id = newId('tss');
    set.name = uniqueName(set.name, names);
    ids.add(set.id);
    names.push(set.name);
    catalog.sets.push(set);
  }
  return catalog;
}

/**
 * The stored catalog text as data. { ok: true, raw } where raw is null for no
 * text at all; { ok: false } for a damaged store (text that is no catalog):
 * that one must be kept aside, never overwritten by an empty catalog.
 */
export function readStoredCatalog(text) {
  if (text == null || !String(text).trim()) return { ok: true, raw: null };
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.sets)) return { ok: false };
  return { ok: true, raw: data };
}

/** Name of the copy of a damaged store: `<name>.damaged-20261029T101500`. */
export function damagedCatalogName(name, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  return `${name}.damaged-${stamp}`;
}

export function findSet(catalog, setId) {
  return catalog?.sets?.find((s) => s.id === setId) || null;
}

export function findSetByName(catalog, name) {
  return catalog?.sets?.find((s) => sameName(s.name, name)) || null;
}

export function findItem(catalog, itemId) {
  for (const set of catalog?.sets || []) {
    const item = set.items.find((i) => i.id === itemId);
    if (item) return { set, item };
  }
  return null;
}

function withSets(catalog, sets) {
  return { ...catalog, version: CATALOG_VERSION, sets };
}

/** Add a tool set. Returns { catalog, set } or { catalog, error }. */
export function addSet(catalog, name, { id = null } = {}) {
  const clean = cleanName(name);
  if (!clean) return { catalog, error: 'name-empty' };
  if (findSetByName(catalog, clean)) return { catalog, error: 'name-taken' };
  if (catalog.sets.length >= MAX_SETS) return { catalog, error: 'too-many' };
  const set = { id: id || newId('tss'), name: clean, items: [] };
  return { catalog: withSets(catalog, [...catalog.sets, set]), set };
}

export function renameSet(catalog, setId, name) {
  const clean = cleanName(name);
  if (!clean) return { catalog, error: 'name-empty' };
  if (!findSet(catalog, setId)) return { catalog, error: 'not-found' };
  const other = findSetByName(catalog, clean);
  if (other && other.id !== setId) return { catalog, error: 'name-taken' };
  return { catalog: withSets(catalog, catalog.sets.map((s) => (s.id === setId ? { ...s, name: clean } : s))) };
}

export function deleteSet(catalog, setId) {
  if (!findSet(catalog, setId)) return { catalog, error: 'not-found' };
  return { catalog: withSets(catalog, catalog.sets.filter((s) => s.id !== setId)) };
}

export function addItem(catalog, setId, item) {
  const set = findSet(catalog, setId);
  if (!set) return { catalog, error: 'not-found' };
  const clean = normalizeItem(item);
  if (!clean) return { catalog, error: 'invalid-item' };
  if (set.items.length >= MAX_ITEMS_PER_SET) return { catalog, error: 'too-many' };
  if (findItem(catalog, clean.id)) clean.id = newId('tsi');
  return {
    catalog: withSets(catalog, catalog.sets.map((s) => (s.id === setId ? { ...s, items: [...s.items, clean] } : s))),
    item: clean,
  };
}

function mapItems(catalog, fn) {
  return withSets(catalog, catalog.sets.map((s) => ({ ...s, items: fn(s.items, s) })));
}

export function renameItem(catalog, itemId, name) {
  const clean = cleanName(name);
  if (!clean) return { catalog, error: 'name-empty' };
  if (!findItem(catalog, itemId)) return { catalog, error: 'not-found' };
  return { catalog: mapItems(catalog, (items) => items.map((i) => (i.id === itemId ? { ...i, name: clean } : i))) };
}

/**
 * Remove an item. Annotations already drawn with it keep every property:
 * applying copied the values onto them, nothing refers back to the item.
 */
export function deleteItem(catalog, itemId) {
  if (!findItem(catalog, itemId)) return { catalog, error: 'not-found' };
  return { catalog: mapItems(catalog, (items) => items.filter((i) => i.id !== itemId)) };
}

/** Move an item to another tool set (at `index`, default the end). */
export function moveItem(catalog, itemId, toSetId, index = null) {
  const found = findItem(catalog, itemId);
  const target = findSet(catalog, toSetId);
  if (!found || !target) return { catalog, error: 'not-found' };
  if (found.set.id !== toSetId && target.items.length >= MAX_ITEMS_PER_SET) return { catalog, error: 'too-many' };
  const without = mapItems(catalog, (items) => items.filter((i) => i.id !== itemId));
  return {
    catalog: withSets(without, without.sets.map((s) => {
      if (s.id !== toSetId) return s;
      const items = [...s.items];
      const at = Number.isInteger(index) ? Math.max(0, Math.min(index, items.length)) : items.length;
      items.splice(at, 0, found.item);
      return { ...s, items };
    })),
  };
}

// ── Exchange file ─────────────────────────────────────────────────────────

/** One tool set as the text of an exchange file. */
export function serializeToolSet(set, { now = null, app = 'Open PDF Studio' } = {}) {
  const clean = normalizeSet(set);
  if (!clean) throw new Error('invalid tool set');
  return JSON.stringify({
    format: TOOL_SET_FORMAT,
    version: TOOL_SET_VERSION,
    exportedAt: now || new Date().toISOString(),
    app,
    toolSet: {
      name: clean.name,
      items: clean.items.map(({ id, ...rest }) => ({ id, ...rest })),
    },
  }, null, 2);
}

/**
 * Read an exchange file. Returns { ok: true, set, skipped } with a fresh
 * set id, or { ok: false, error } where error is one of:
 * 'empty' | 'too-large' | 'not-json' | 'wrong-format' | 'newer-version' |
 * 'no-name' | 'no-items' | 'invalid-item'.
 * Items of an annotation type this version does not know are skipped
 * (counted in `skipped`); a malformed item rejects the whole file.
 */
export function parseToolSetFile(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty' };
  if (text.length > MAX_FILE_CHARS) return { ok: false, error: 'too-large' };
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== TOOL_SET_FORMAT) {
    return { ok: false, error: 'wrong-format' };
  }
  if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, error: 'wrong-format' };
  if (data.version > TOOL_SET_VERSION) return { ok: false, error: 'newer-version' };
  const raw = data.toolSet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'wrong-format' };
  if (!cleanName(raw.name)) return { ok: false, error: 'no-name' };
  if (!Array.isArray(raw.items)) return { ok: false, error: 'no-items' };
  if (raw.items.length > MAX_ITEMS_PER_SET) return { ok: false, error: 'too-large' };

  const items = [];
  let skipped = 0;
  for (const r of raw.items) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.type !== 'string'
        || (r.props != null && (typeof r.props !== 'object' || Array.isArray(r.props)))
        || (r.name != null && typeof r.name !== 'string')) {
      return { ok: false, error: 'invalid-item' };
    }
    if (!isToolSetType(r.type)) { skipped++; continue; }
    const item = normalizeItem({ ...r, id: null });
    if (!item) return { ok: false, error: 'invalid-item' };
    items.push(item);
  }
  return { ok: true, set: { id: newId('tss'), name: cleanName(raw.name), items }, skipped };
}

/**
 * Put an imported tool set in the catalog.
 * - no set with that name: added as is (`mode` is ignored);
 * - 'overwrite': the existing set of that name gets the imported items;
 * - 'keepBoth': added next to it under a free name ("Name (2)");
 * - 'rename': added under `newName`, which must be free.
 * Returns { catalog, set } or { catalog, error: 'conflict' | 'name-empty' | 'name-taken' }.
 */
export function importToolSet(catalog, imported, { mode = null, newName = '' } = {}) {
  if (!imported || !cleanName(imported.name)) return { catalog, error: 'name-empty' };
  const items = (imported.items || []).map((i) => ({ ...i, id: newId('tsi') }));
  const existing = findSetByName(catalog, imported.name);
  if (!existing) {
    const r = addSet(catalog, imported.name);
    if (r.error) return r;
    const set = { ...r.set, items };
    return { catalog: withSets(r.catalog, r.catalog.sets.map((s) => (s.id === set.id ? set : s))), set };
  }
  if (mode === 'overwrite') {
    const set = { ...existing, items };
    return { catalog: withSets(catalog, catalog.sets.map((s) => (s.id === existing.id ? set : s))), set };
  }
  if (mode === 'keepBoth' || mode === 'rename') {
    const name = mode === 'keepBoth' ? uniqueName(imported.name, catalog.sets.map((s) => s.name)) : cleanName(newName);
    if (!name) return { catalog, error: 'name-empty' };
    const r = addSet(catalog, name);
    if (r.error) return r;
    const set = { ...r.set, items };
    return { catalog: withSets(r.catalog, r.catalog.sets.map((s) => (s.id === set.id ? set : s))), set };
  }
  return { catalog, error: 'conflict', existing };
}

/** A file name for an exported tool set (no path, safe on every OS). */
export function toolSetFileName(name) {
  const safe = cleanName(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'tool-set';
  return `${safe}.${TOOL_SET_EXTENSION}`;
}
