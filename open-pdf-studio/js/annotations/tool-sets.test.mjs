// Tool Sets (#311): saving a measurement's settings without its geometry,
// applying them to a new measurement, tool sets, the exchange file and the
// temporary preferences overlay of the active item.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureItem, sanitizeProps, isSavedProperty, applyItemToAnnotation, applyMeasureUnit,
  stylePrefsOverlay, prefKeyToAnnKeys, emptyCatalog, normalizeCatalog, addSet, renameSet, deleteSet,
  addItem, renameItem, deleteItem, moveItem, findItem, findSet, uniqueName, serializeToolSet,
  parseToolSetFile, importToolSet, toolSetFileName, isToolSetType, toolForType,
  TOOL_SET_FORMAT, TOOL_SET_VERSION, TYPE_LABEL_KEYS, TOOL_FOR_TYPE,
} from './tool-sets.js';
import {
  armToolSetItem, endToolSetSession, prefsForStorage, applyToolSetToNewAnnotation,
  activeToolSetItemId, changedDuringSession, onToolSetSessionChange,
} from '../tools/tool-set-session.js';
import { writeStylePrefs } from '../core/style-prefs.js';

const doc = () => ({
  annotations: [],
  annotationLayers: [
    { id: 'default', name: '' },
    { id: 'l-walls', name: 'Walls', color: '#cc0000' },
  ],
});

// A wall measurement as the dimension tool leaves it, with all its settings.
const wallDimension = () => ({
  id: 'abc123', type: 'measureDistance', page: 3, author: 'Joas',
  createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-02T00:00:00Z',
  startX: 10, startY: 20, endX: 210, endY: 20,
  leaderStartX: 10, leaderStartY: 40, leaderEndX: 210, leaderEndY: 40,
  measureText: '2400', measureValue: 2400, measurePixels: 200, measureScale: 12, measureUnit: 'mm',
  measurePrecision: 0, measureDepth: 2600,
  color: '#1565C0', strokeColor: '#1565C0', lineWidth: 0.7, opacity: 0.9,
  startHead: 'openCircle', endHead: 'openCircle', headSize: 9, fontSize: 10, dimType: '3.5',
  dimExtension: true, dimShowUnit: false, subject: 'Wall 100', layer: 'l-walls',
  locked: false, printable: true, replies: [{ text: 'ok' }], status: 'accepted',
  opsKettingId: 'k1', _cache: { x: 1 },
});

// ── Capturing ────────────────────────────────────────────────────────────

test('saving stores every setting but none of the drawn geometry or measured length', () => {
  const item = captureItem(wallDimension(), { doc: doc(), id: 'i1', now: 'T' });
  assert.equal(item.type, 'measureDistance');
  assert.equal(item.name, 'Wall 100', 'the label becomes the item name');
  assert.deepEqual(item.layer, { name: 'Walls', color: '#cc0000' }, 'layer by name, portable');
  const p = item.props;
  // what the issue asks for: layer (above), colour, label, unit, depth, line width
  assert.equal(p.strokeColor, '#1565C0');
  assert.equal(p.color, '#1565C0');
  assert.equal(p.subject, 'Wall 100');
  assert.equal(p.measureUnit, 'mm');
  assert.equal(p.measureDepth, 2600);
  assert.equal(p.lineWidth, 0.7);
  // … and the other style / measurement properties
  for (const k of ['opacity', 'startHead', 'endHead', 'headSize', 'fontSize', 'dimType', 'dimExtension', 'dimShowUnit', 'measurePrecision', 'printable']) {
    assert.ok(k in p, k);
  }
  // never: geometry, measured result, identity, relations
  for (const k of ['startX', 'startY', 'endX', 'endY', 'leaderStartX', 'leaderEndY', 'measureText', 'measureValue',
    'measurePixels', 'measureScale', 'id', 'page', 'author', 'createdAt', 'modifiedAt', 'replies', 'status',
    'locked', 'layer', 'opsKettingId', '_cache', 'type']) {
    assert.ok(!(k in p), `${k} must not be saved`);
  }
});

test('point lists and point objects are geometry, whatever their name', () => {
  assert.equal(isSavedProperty('points', [{ x: 1, y: 2 }]), false);
  assert.equal(isSavedProperty('someNewPath', [[{ x: 1, y: 2 }]]), false);
  assert.equal(isSavedProperty('anchor', { x: 1, y: 2 }), false);
  assert.equal(isSavedProperty('labelX', 4), false);
  assert.equal(isSavedProperty('hatchPattern', 'concrete'), true);
  const area = captureItem({
    type: 'measureArea', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [[{ x: 1, y: 1 }]],
    measureName: 'Floor', hatchPattern: 'concrete', fillColor: '#eeeeee', measureUnit: 'm²',
  });
  assert.deepEqual(Object.keys(area.props).sort(), ['fillColor', 'hatchPattern', 'measureName', 'measureUnit']);
  assert.equal(area.name, 'Floor');
});

// Review fix: the saved properties are an allowlist. Internal, linking or
// future keys of the placed annotation never reach the next annotations.
test('only style and measurement settings are saved: unknown and internal keys stay behind', () => {
  const item = captureItem({
    ...wallDimension(),
    // internal / linking / not-yet-known keys (examples)
    systemTypeId: 'st-7', modelLink: { guid: 'x' }, linkedPath: 'C:/a.pdf', dimKind: 'spotCoord',
    onzichtbaarVlak: true, futureFlag: true, wallJoinDisallow: ['start'], dimTags: ['a'],
    // a known key with a value that is not a plain setting
    strokeColor: { evil: true },
  }, { doc: doc() });
  for (const k of ['systemTypeId', 'modelLink', 'linkedPath', 'dimKind', 'onzichtbaarVlak', 'futureFlag',
    'wallJoinDisallow', 'dimTags', 'strokeColor']) {
    assert.ok(!(k in item.props), `${k} must not be saved`);
  }
  assert.equal(item.props.subject, 'Wall 100', 'the settings themselves are kept');
  assert.equal(item.props.measureDepth, 2600);

  // An item that carries such keys anyway (old or hand-made file) does not
  // put them on a new annotation either.
  const ann = newDimension();
  applyItemToAnnotation(ann, { ...item, props: { ...item.props, systemTypeId: 'st-7', futureFlag: true } }, { doc: doc() });
  assert.ok(!('systemTypeId' in ann));
  assert.ok(!('futureFlag' in ann));
  assert.equal(ann.subject, 'Wall 100');
});

test('a wall item keeps its thickness, material and insulation', () => {
  const item = captureItem({
    type: 'wall', startX: 0, startY: 0, endX: 100, endY: 0, dikteMm: 214, hatchPattern: 'nen47-metselwerk-baksteen',
    isolatieType: 'pir', ifcCategory: 'IfcWall', strokeColor: '#000000', lineWidth: 0.7, noJoinStart: true,
  });
  assert.deepEqual(Object.keys(item.props).sort(),
    ['dikteMm', 'hatchPattern', 'ifcCategory', 'isolatieType', 'lineWidth', 'strokeColor']);
});

test('a measurement with missing/default properties still saves, with the defaults', () => {
  const item = captureItem({ type: 'measurePerimeter', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    { doc: doc(), fallbackName: 'Perimeter' });
  assert.ok(item);
  assert.equal(item.name, 'Perimeter', 'no label: the type name');
  assert.equal(item.layer, null, 'no layer: the default layer');
  assert.deepEqual(item.props, {});
});

test('line width and font size are saved without the viewport auto-scaling', () => {
  const p = sanitizeProps('measureDistance', { lineWidth: 2, fontSize: 20, viewportScaleFactor: 2 });
  assert.equal(p.lineWidth, 1);
  assert.equal(p.fontSize, 10);
  assert.ok(!('viewportScaleFactor' in p));
});

test('only types with their own drawing tool can be saved', () => {
  assert.equal(captureItem({ type: 'textbox', text: 'x' }), null);
  assert.equal(captureItem({ type: 'count', number: 3 }), null);
  for (const type of Object.keys(TOOL_FOR_TYPE)) {
    assert.ok(isToolSetType(type));
    assert.ok(TYPE_LABEL_KEYS[type], `${type} has a label`);
  }
  assert.equal(toolForType('measureArea'), 'measureArea');
  assert.equal(toolForType('stamp'), null);
});

// ── Applying to a new measurement ────────────────────────────────────────

const newDimension = () => ({
  id: 'new1', type: 'measureDistance', page: 1, author: 'Me',
  startX: 0, startY: 0, endX: 100, endY: 0, leaderStartX: 0, leaderStartY: 10, leaderEndX: 100, leaderEndY: 10,
  measureText: '1000', measureValue: 1000, measurePixels: 100, measureUnit: 'mm', measurePrecision: 0,
  color: '#000000', strokeColor: '#000000', lineWidth: 0.5,
});

test('applying an item gives the new measurement all saved properties, keeps its own geometry', () => {
  const item = captureItem(wallDimension(), { doc: doc() });
  const d = doc();
  const ann = newDimension();
  const r = applyItemToAnnotation(ann, item, { doc: d });
  assert.equal(r.applied, true);
  assert.equal(ann.subject, 'Wall 100');
  assert.equal(ann.measureDepth, 2600);
  assert.equal(ann.strokeColor, '#1565C0');
  assert.equal(ann.dimType, '3.5');
  assert.equal(ann.layer, 'l-walls', 'existing layer found by name');
  // geometry, identity and measured value stay
  assert.equal(ann.id, 'new1');
  assert.equal(ann.author, 'Me');
  assert.equal(ann.endX, 100);
  assert.equal(ann.measureValue, 1000);
  assert.equal(ann.measureText, '1000');
  // line width comes through the preferences overlay for this type (and gets
  // the viewport scaling there), not from here
  assert.equal(ann.lineWidth, 0.5);
});

test('the item layer is created in a document that does not have it', () => {
  const item = captureItem(wallDimension(), { doc: doc() });
  const other = { annotations: [], annotationLayers: [{ id: 'default', name: '' }] };
  const ann = newDimension();
  const r = applyItemToAnnotation(ann, item, { doc: other });
  assert.equal(r.layerAdded, true);
  const layer = other.annotationLayers.find((l) => l.id === ann.layer);
  assert.equal(layer.name, 'Walls');
  assert.equal(layer.color, '#cc0000');
  // a second measurement reuses it
  const ann2 = newDimension();
  assert.equal(applyItemToAnnotation(ann2, item, { doc: other }).layerAdded, false);
  assert.equal(ann2.layer, ann.layer);
});

test('an item saved on the default layer puts the new measurement on the default layer', () => {
  const item = captureItem({ ...wallDimension(), layer: undefined }, { doc: doc() });
  const ann = { ...newDimension(), layer: 'l-walls' };
  applyItemToAnnotation(ann, item, { doc: doc() });
  assert.ok(!('layer' in ann));
});

test('the item unit is applied with the same real length', () => {
  const ann = newDimension(); // 1000 mm over 100 pt
  applyMeasureUnit(ann, 'm', 2);
  assert.equal(ann.measureUnit, 'm');
  assert.equal(ann.measureValue, 1);
  assert.equal(ann.measureText, '1.00 m');
  assert.equal(ann.measureScale, 0.01, 'own scale in m per pt keeps the unit on recalculation');

  const area = {
    type: 'measureArea', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    measureValue: 1e8, measureUnit: 'mm²', measureText: '100 m²',
  };
  applyMeasureUnit(area, 'm²', undefined, { formatMeasurement: (m) => `${m.value} ${m.unit}` });
  assert.equal(area.measureUnit, 'm²');
  assert.equal(area.measureValue, 100);
  assert.equal(area.measureText, '100 m²');

  const px = { ...newDimension(), measureUnit: 'px' };
  assert.equal(applyMeasureUnit(px, 'mm'), false, 'pixels have no fixed ratio: left as is');
  assert.equal(px.measureUnit, 'px');
});

test('applying never touches an annotation of another type', () => {
  const item = captureItem(wallDimension(), { doc: doc() });
  const line = { type: 'line', strokeColor: '#000000' };
  assert.equal(applyItemToAnnotation(line, item, { doc: doc() }).applied, false);
  assert.equal(line.strokeColor, '#000000');
});

test('the annotation gets copies: deleting or changing the item later does not affect it', () => {
  let catalog = addSet(emptyCatalog(), 'Set').catalog;
  const setId = catalog.sets[0].id;
  const r = addItem(catalog, setId, captureItem(wallDimension(), { doc: doc() }));
  catalog = r.catalog;
  const ann = newDimension();
  applyItemToAnnotation(ann, findItem(catalog, r.item.id).item, { doc: doc() });
  catalog = renameItem(catalog, r.item.id, 'Changed').catalog;
  findItem(catalog, r.item.id).item.props.subject = 'Changed too';
  catalog = deleteItem(catalog, r.item.id).catalog;
  assert.equal(findItem(catalog, r.item.id), null);
  assert.equal(ann.subject, 'Wall 100');
});

// ── The active item: preferences overlay and the add hook ────────────────

const userPrefs = () => ({
  measureDistStrokeColor: '#FF0000', measureDistLineWidth: 1, measureDistOpacity: 100,
  measureDistDimUnit: 'mm', measureDistDimPrecision: 0, measureDistFontSize: 8, language: 'nl',
});

test('the active item overlays its style on the preferences, and never gets saved as a preference', () => {
  const prefs = userPrefs();
  const item = captureItem(wallDimension(), { doc: doc(), id: 'i-wall' });
  const seen = [];
  const off = onToolSetSessionChange((id) => seen.push(id));
  assert.equal(armToolSetItem(item, prefs), true);
  assert.equal(activeToolSetItemId(), 'i-wall');
  assert.equal(prefs.measureDistStrokeColor, '#1565C0', 'tool and preview draw with the item');
  assert.equal(prefs.measureDistLineWidth, 0.7);
  assert.equal(prefs.measureDistDimType, '3.5');
  const stored = prefsForStorage(prefs);
  assert.equal(stored.measureDistStrokeColor, '#FF0000', 'saved: the user own value');
  assert.equal(stored.measureDistLineWidth, 1);
  assert.ok(!('measureDistDimType' in stored), 'a key the user never had stays absent');
  assert.equal(stored.language, 'nl');
  endToolSetSession();
  assert.deepEqual(prefs, userPrefs(), 'ending the session restores the preferences exactly');
  assert.equal(activeToolSetItemId(), null);
  off();
  assert.deepEqual(seen, ['i-wall', null]);
});

test('a preference the user changes while the item is active is kept and wins over the item', () => {
  const prefs = userPrefs();
  armToolSetItem(captureItem(wallDimension(), { doc: doc() }), prefs);
  prefs.measureDistStrokeColor = '#00AA00'; // tool defaults panel / Format tab
  assert.ok(changedDuringSession().has('strokeColor'));
  assert.equal(prefsForStorage(prefs).measureDistStrokeColor, '#00AA00');
  const ann = { ...newDimension(), strokeColor: '#00AA00', color: '#00AA00' };
  applyToolSetToNewAnnotation(ann, 'measureDistance', doc());
  assert.equal(ann.strokeColor, '#00AA00');
  assert.equal(ann.subject, 'Wall 100', 'the rest of the item still applies');
  endToolSetSession();
  assert.equal(prefs.measureDistStrokeColor, '#00AA00');
  assert.equal(prefs.measureDistLineWidth, 1);
});

test('the item only applies to annotations of its type drawn with its tool', () => {
  const prefs = userPrefs();
  armToolSetItem(captureItem(wallDimension(), { doc: doc() }), prefs);
  const pasted = newDimension();
  assert.equal(applyToolSetToNewAnnotation(pasted, 'select', doc()), false, 'a paste in the select tool');
  assert.ok(!('subject' in pasted));
  const line = { type: 'line' };
  assert.equal(applyToolSetToNewAnnotation(line, 'measureDistance', doc()), false);
  const drawn = newDimension();
  assert.equal(applyToolSetToNewAnnotation(drawn, 'measureDistance', doc()), true);
  assert.equal(drawn.measureDepth, 2600);
  endToolSetSession();
  const after = newDimension();
  assert.equal(applyToolSetToNewAnnotation(after, 'measureDistance', doc()), false, 'no session, no change');
});

test('activating an item does not change an annotation that is already selected', () => {
  const prefs = userPrefs();
  const selected = wallDimension();
  selected.strokeColor = '#123456';
  const before = JSON.stringify(selected);
  armToolSetItem(captureItem({ ...wallDimension(), strokeColor: '#ABCDEF' }, { doc: doc() }), prefs);
  assert.equal(JSON.stringify(selected), before);
  endToolSetSession();
});

test('the overlay uses the same keys as "Set as Default Style"', () => {
  const props = captureItem(wallDimension(), { doc: doc() }).props;
  const viaDefault = userPrefs();
  writeStylePrefs({ type: 'measureDistance', ...props }, viaDefault);
  const overlay = stylePrefsOverlay({ type: 'measureDistance', props }, userPrefs());
  assert.deepEqual({ ...userPrefs(), ...overlay }, viaDefault);
  assert.deepEqual(prefKeyToAnnKeys('measureDistance').get('measureDistStrokeColor'), ['strokeColor', 'color']);
  assert.equal(prefKeyToAnnKeys('measureAngle').size, 0, 'no preferences: everything applies on add');
});

// ── Tool sets ────────────────────────────────────────────────────────────

test('tool sets: create, rename, delete, unique names', () => {
  let r = addSet(emptyCatalog(), '  Walls  ');
  assert.equal(r.set.name, 'Walls');
  let catalog = r.catalog;
  assert.equal(addSet(catalog, 'walls').error, 'name-taken', 'names are case-insensitive');
  assert.equal(addSet(catalog, '   ').error, 'name-empty');
  catalog = addSet(catalog, 'Floors').catalog;
  const walls = catalog.sets[0].id;
  assert.equal(renameSet(catalog, walls, 'Floors').error, 'name-taken');
  assert.equal(renameSet(catalog, walls, '').error, 'name-empty');
  catalog = renameSet(catalog, walls, 'Interior walls').catalog;
  assert.equal(findSet(catalog, walls).name, 'Interior walls');
  assert.equal(renameSet(catalog, walls, 'INTERIOR walls').error, undefined, 'own name in other case is fine');
  catalog = deleteSet(catalog, walls).catalog;
  assert.deepEqual(catalog.sets.map((s) => s.name), ['Floors']);
  assert.equal(uniqueName('Floors', ['Floors', 'Floors (2)']), 'Floors (3)');
  assert.equal(uniqueName('Floors (2)', ['Floors', 'Floors (2)']), 'Floors (3)');
});

test('items: add, rename, move between tool sets', () => {
  let catalog = addSet(addSet(emptyCatalog(), 'A').catalog, 'B').catalog;
  const [a, b] = catalog.sets.map((s) => s.id);
  const one = addItem(catalog, a, captureItem(wallDimension(), { doc: doc() }));
  catalog = one.catalog;
  const two = addItem(catalog, a, captureItem({ type: 'measureArea', measureName: 'Floor' }));
  catalog = two.catalog;
  assert.equal(addItem(catalog, a, { type: 'textbox' }).error, 'invalid-item');
  assert.equal(renameItem(catalog, one.item.id, ' ').error, 'name-empty');
  catalog = renameItem(catalog, one.item.id, 'Wall 100 mm').catalog;
  catalog = moveItem(catalog, one.item.id, b).catalog;
  assert.deepEqual(findSet(catalog, a).items.map((i) => i.name), ['Floor']);
  assert.deepEqual(findSet(catalog, b).items.map((i) => i.name), ['Wall 100 mm']);
  catalog = moveItem(catalog, two.item.id, b, 0).catalog;
  assert.deepEqual(findSet(catalog, b).items.map((i) => i.name), ['Floor', 'Wall 100 mm']);
  assert.equal(moveItem(catalog, 'nope', b).error, 'not-found');
});

test('the stored catalog survives a save/load cycle and drops what is unusable', () => {
  let catalog = addSet(emptyCatalog(), 'Walls').catalog;
  catalog = addItem(catalog, catalog.sets[0].id, captureItem(wallDimension(), { doc: doc() })).catalog;
  const reloaded = normalizeCatalog(JSON.parse(JSON.stringify(catalog)));
  assert.deepEqual(reloaded, catalog);
  const messy = normalizeCatalog({
    sets: [
      { id: 's1', name: 'A', items: [{ id: 'x', type: 'measureArea', props: { measureName: 'F', points: [{ x: 1, y: 1 }] } }, { type: 'hack' }, null] },
      { id: 's1', name: 'a', items: 'nope' },
      { name: '' },
      'junk',
    ],
  });
  assert.equal(messy.sets.length, 2);
  assert.equal(messy.sets[0].items.length, 1);
  assert.deepEqual(messy.sets[0].items[0].props, { measureName: 'F' });
  assert.notEqual(messy.sets[0].id, messy.sets[1].id);
  assert.equal(messy.sets[1].name, 'a (2)');
  assert.deepEqual(normalizeCatalog(null), emptyCatalog());
  assert.deepEqual(normalizeCatalog({ sets: 'x' }), emptyCatalog());
});

// ── Exchange file ────────────────────────────────────────────────────────

function sampleSet() {
  let catalog = addSet(emptyCatalog(), 'Company walls').catalog;
  const id = catalog.sets[0].id;
  catalog = addItem(catalog, id, captureItem(wallDimension(), { doc: doc() })).catalog;
  catalog = addItem(catalog, id, captureItem({
    type: 'measureArea', measureName: 'Screed 50', measureDepth: 50, hatchPattern: 'concrete', measureUnit: 'm²', fillColor: '#dddddd',
  })).catalog;
  return catalog.sets[0];
}

test('a tool set exported to a file imports again with all items intact', () => {
  const set = sampleSet();
  const text = serializeToolSet(set, { now: '2026-10-27T00:00:00Z' });
  const data = JSON.parse(text);
  assert.equal(data.format, TOOL_SET_FORMAT);
  assert.equal(data.version, TOOL_SET_VERSION);
  const parsed = parseToolSetFile(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.set.name, 'Company walls');
  const strip = (items) => items.map(({ id, ...rest }) => rest);
  assert.deepEqual(strip(parsed.set.items), strip(set.items));
  // into another user's catalog
  const r = importToolSet(emptyCatalog(), parsed.set);
  assert.deepEqual(strip(r.catalog.sets[0].items), strip(set.items));
  // CRLF / BOM from another OS still reads
  assert.equal(parseToolSetFile('﻿' + text.replace(/\n/g, '\r\n')).ok, true);
  assert.equal(toolSetFileName('Walls: A/B'), 'Walls_ A_B.opdstools');
});

test('malformed files are rejected with a reason', () => {
  const good = JSON.parse(serializeToolSet(sampleSet()));
  const bad = (mut) => { const d = JSON.parse(JSON.stringify(good)); mut(d); return JSON.stringify(d); };
  const cases = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['{not json', 'not-json'],
    ['[]', 'wrong-format'],
    [JSON.stringify({ format: 'something-else', version: 1, toolSet: {} }), 'wrong-format'],
    [bad((d) => { d.version = 99; }), 'newer-version'],
    [bad((d) => { d.version = '1'; }), 'wrong-format'],
    [bad((d) => { d.toolSet = null; }), 'wrong-format'],
    [bad((d) => { d.toolSet.name = '  '; }), 'no-name'],
    [bad((d) => { d.toolSet.items = {}; }), 'no-items'],
    [bad((d) => { d.toolSet.items.push('x'); }), 'invalid-item'],
    [bad((d) => { d.toolSet.items[0].props = [1, 2]; }), 'invalid-item'],
    [bad((d) => { d.toolSet.items[0].name = 5; }), 'invalid-item'],
    [bad((d) => { delete d.toolSet.items[0].type; }), 'invalid-item'],
    ['x'.repeat(5 * 1024 * 1024), 'too-large'],
  ];
  for (const [text, error] of cases) {
    const r = parseToolSetFile(text);
    assert.equal(r.ok, false, `${error}: ${text.slice(0, 40)}`);
    assert.equal(r.error, error, text.slice(0, 60));
  }
  assert.equal(parseToolSetFile(null).error, 'empty');
});

test('an imported file cannot smuggle in geometry, ids or prototype keys', () => {
  const d = JSON.parse(serializeToolSet(sampleSet()));
  d.toolSet.items[0].props = JSON.parse('{"__proto__": {"polluted": true}, "startX": 5, "points": [{"x":1,"y":2}], "id": "evil", "measureText": "999", "subject": "ok"}');
  d.toolSet.items.push({ type: 'futureMeasureType', name: 'Later', props: {} });
  const r = parseToolSetFile(JSON.stringify(d));
  assert.equal(r.ok, true);
  assert.equal(r.skipped, 1, 'an unknown type is skipped, not fatal');
  assert.deepEqual(r.set.items[0].props, { subject: 'ok' });
  assert.equal(({}).polluted, undefined);
  const ann = newDimension();
  applyItemToAnnotation(ann, r.set.items[0], {});
  assert.equal(Object.getPrototypeOf(ann), Object.prototype);
  assert.equal(ann.startX, 0);
});

test('importing a tool set with an existing name asks: rename, overwrite or keep both', () => {
  const set = sampleSet();
  let catalog = addSet(emptyCatalog(), 'Company walls').catalog;
  const existingId = catalog.sets[0].id;
  const imported = parseToolSetFile(serializeToolSet(set)).set;

  const conflict = importToolSet(catalog, imported);
  assert.equal(conflict.error, 'conflict', 'never silently overwritten');
  assert.equal(conflict.catalog, catalog);

  const over = importToolSet(catalog, imported, { mode: 'overwrite' });
  assert.equal(over.catalog.sets.length, 1);
  assert.equal(over.set.id, existingId);
  assert.equal(over.catalog.sets[0].items.length, 2);

  const both = importToolSet(catalog, imported, { mode: 'keepBoth' });
  assert.deepEqual(both.catalog.sets.map((s) => s.name), ['Company walls', 'Company walls (2)']);

  assert.equal(importToolSet(catalog, imported, { mode: 'rename', newName: 'company WALLS' }).error, 'name-taken');
  assert.equal(importToolSet(catalog, imported, { mode: 'rename', newName: '' }).error, 'name-empty');
  const renamed = importToolSet(catalog, imported, { mode: 'rename', newName: 'Partner walls' });
  assert.deepEqual(renamed.catalog.sets.map((s) => s.name), ['Company walls', 'Partner walls']);

  // importing twice never shares item ids
  const ids = both.catalog.sets.flatMap((s) => s.items.map((i) => i.id));
  const again = importToolSet(both.catalog, imported, { mode: 'keepBoth' });
  const allIds = again.catalog.sets.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(ids.length > 0);
});
