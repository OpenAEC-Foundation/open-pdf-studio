// Tool Chest (#311): saving a measurement's settings without its geometry,
// applying them to a new measurement, tool sets, the exchange file and the
// temporary preferences overlay of the active item.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureItem, sanitizeProps, isExcludedProperty, applyItemToAnnotation, applyMeasureUnit,
  stylePrefsOverlay, prefKeyToAnnKeys, emptyChest, normalizeChest, addSet, renameSet, deleteSet,
  addItem, renameItem, deleteItem, moveItem, findItem, findSet, uniqueName, serializeToolSet,
  parseToolSetFile, importToolSet, toolSetFileName, isToolChestType, toolForType,
  TOOL_SET_FORMAT, TOOL_SET_VERSION, TYPE_LABEL_KEYS, TOOL_FOR_TYPE,
} from './tool-chest.js';
import {
  armToolChestItem, endToolChestSession, prefsForStorage, applyToolChestToNewAnnotation,
  activeToolChestItemId, changedDuringSession, onToolChestSessionChange,
} from '../tools/tool-chest-session.js';
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
  assert.equal(isExcludedProperty('points', [{ x: 1, y: 2 }]), true);
  assert.equal(isExcludedProperty('someNewPath', [[{ x: 1, y: 2 }]]), true);
  assert.equal(isExcludedProperty('anchor', { x: 1, y: 2 }), true);
  assert.equal(isExcludedProperty('labelX', 4), true);
  assert.equal(isExcludedProperty('hatchPattern', 'concrete'), false);
  const area = captureItem({
    type: 'measureArea', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [[{ x: 1, y: 1 }]],
    measureName: 'Floor', hatchPattern: 'concrete', fillColor: '#eeeeee', measureUnit: 'm²',
  });
  assert.deepEqual(Object.keys(area.props).sort(), ['fillColor', 'hatchPattern', 'measureName', 'measureUnit']);
  assert.equal(area.name, 'Floor');
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
    assert.ok(isToolChestType(type));
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
  let chest = addSet(emptyChest(), 'Set').chest;
  const setId = chest.sets[0].id;
  const r = addItem(chest, setId, captureItem({ ...wallDimension(), dimTags: ['a', 'b'] }, { doc: doc() }));
  chest = r.chest;
  const ann = newDimension();
  applyItemToAnnotation(ann, findItem(chest, r.item.id).item, { doc: doc() });
  chest = renameItem(chest, r.item.id, 'Changed').chest;
  findItem(chest, r.item.id).item.props.dimTags.push('c');
  chest = deleteItem(chest, r.item.id).chest;
  assert.equal(findItem(chest, r.item.id), null);
  assert.deepEqual(ann.dimTags, ['a', 'b']);
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
  const off = onToolChestSessionChange((id) => seen.push(id));
  assert.equal(armToolChestItem(item, prefs), true);
  assert.equal(activeToolChestItemId(), 'i-wall');
  assert.equal(prefs.measureDistStrokeColor, '#1565C0', 'tool and preview draw with the item');
  assert.equal(prefs.measureDistLineWidth, 0.7);
  assert.equal(prefs.measureDistDimType, '3.5');
  const stored = prefsForStorage(prefs);
  assert.equal(stored.measureDistStrokeColor, '#FF0000', 'saved: the user own value');
  assert.equal(stored.measureDistLineWidth, 1);
  assert.ok(!('measureDistDimType' in stored), 'a key the user never had stays absent');
  assert.equal(stored.language, 'nl');
  endToolChestSession();
  assert.deepEqual(prefs, userPrefs(), 'ending the session restores the preferences exactly');
  assert.equal(activeToolChestItemId(), null);
  off();
  assert.deepEqual(seen, ['i-wall', null]);
});

test('a preference the user changes while the item is active is kept and wins over the item', () => {
  const prefs = userPrefs();
  armToolChestItem(captureItem(wallDimension(), { doc: doc() }), prefs);
  prefs.measureDistStrokeColor = '#00AA00'; // tool defaults panel / Format tab
  assert.ok(changedDuringSession().has('strokeColor'));
  assert.equal(prefsForStorage(prefs).measureDistStrokeColor, '#00AA00');
  const ann = { ...newDimension(), strokeColor: '#00AA00', color: '#00AA00' };
  applyToolChestToNewAnnotation(ann, 'measureDistance', doc());
  assert.equal(ann.strokeColor, '#00AA00');
  assert.equal(ann.subject, 'Wall 100', 'the rest of the item still applies');
  endToolChestSession();
  assert.equal(prefs.measureDistStrokeColor, '#00AA00');
  assert.equal(prefs.measureDistLineWidth, 1);
});

test('the item only applies to annotations of its type drawn with its tool', () => {
  const prefs = userPrefs();
  armToolChestItem(captureItem(wallDimension(), { doc: doc() }), prefs);
  const pasted = newDimension();
  assert.equal(applyToolChestToNewAnnotation(pasted, 'select', doc()), false, 'a paste in the select tool');
  assert.ok(!('subject' in pasted));
  const line = { type: 'line' };
  assert.equal(applyToolChestToNewAnnotation(line, 'measureDistance', doc()), false);
  const drawn = newDimension();
  assert.equal(applyToolChestToNewAnnotation(drawn, 'measureDistance', doc()), true);
  assert.equal(drawn.measureDepth, 2600);
  endToolChestSession();
  const after = newDimension();
  assert.equal(applyToolChestToNewAnnotation(after, 'measureDistance', doc()), false, 'no session, no change');
});

test('activating an item does not change an annotation that is already selected', () => {
  const prefs = userPrefs();
  const selected = wallDimension();
  selected.strokeColor = '#123456';
  const before = JSON.stringify(selected);
  armToolChestItem(captureItem({ ...wallDimension(), strokeColor: '#ABCDEF' }, { doc: doc() }), prefs);
  assert.equal(JSON.stringify(selected), before);
  endToolChestSession();
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
  let r = addSet(emptyChest(), '  Walls  ');
  assert.equal(r.set.name, 'Walls');
  let chest = r.chest;
  assert.equal(addSet(chest, 'walls').error, 'name-taken', 'names are case-insensitive');
  assert.equal(addSet(chest, '   ').error, 'name-empty');
  chest = addSet(chest, 'Floors').chest;
  const walls = chest.sets[0].id;
  assert.equal(renameSet(chest, walls, 'Floors').error, 'name-taken');
  assert.equal(renameSet(chest, walls, '').error, 'name-empty');
  chest = renameSet(chest, walls, 'Interior walls').chest;
  assert.equal(findSet(chest, walls).name, 'Interior walls');
  assert.equal(renameSet(chest, walls, 'INTERIOR walls').error, undefined, 'own name in other case is fine');
  chest = deleteSet(chest, walls).chest;
  assert.deepEqual(chest.sets.map((s) => s.name), ['Floors']);
  assert.equal(uniqueName('Floors', ['Floors', 'Floors (2)']), 'Floors (3)');
  assert.equal(uniqueName('Floors (2)', ['Floors', 'Floors (2)']), 'Floors (3)');
});

test('items: add, rename, move between tool sets', () => {
  let chest = addSet(addSet(emptyChest(), 'A').chest, 'B').chest;
  const [a, b] = chest.sets.map((s) => s.id);
  const one = addItem(chest, a, captureItem(wallDimension(), { doc: doc() }));
  chest = one.chest;
  const two = addItem(chest, a, captureItem({ type: 'measureArea', measureName: 'Floor' }));
  chest = two.chest;
  assert.equal(addItem(chest, a, { type: 'textbox' }).error, 'invalid-item');
  assert.equal(renameItem(chest, one.item.id, ' ').error, 'name-empty');
  chest = renameItem(chest, one.item.id, 'Wall 100 mm').chest;
  chest = moveItem(chest, one.item.id, b).chest;
  assert.deepEqual(findSet(chest, a).items.map((i) => i.name), ['Floor']);
  assert.deepEqual(findSet(chest, b).items.map((i) => i.name), ['Wall 100 mm']);
  chest = moveItem(chest, two.item.id, b, 0).chest;
  assert.deepEqual(findSet(chest, b).items.map((i) => i.name), ['Floor', 'Wall 100 mm']);
  assert.equal(moveItem(chest, 'nope', b).error, 'not-found');
});

test('the stored chest survives a save/load cycle and drops what is unusable', () => {
  let chest = addSet(emptyChest(), 'Walls').chest;
  chest = addItem(chest, chest.sets[0].id, captureItem(wallDimension(), { doc: doc() })).chest;
  const reloaded = normalizeChest(JSON.parse(JSON.stringify(chest)));
  assert.deepEqual(reloaded, chest);
  const messy = normalizeChest({
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
  assert.deepEqual(normalizeChest(null), emptyChest());
  assert.deepEqual(normalizeChest({ sets: 'x' }), emptyChest());
});

// ── Exchange file ────────────────────────────────────────────────────────

function sampleSet() {
  let chest = addSet(emptyChest(), 'Company walls').chest;
  const id = chest.sets[0].id;
  chest = addItem(chest, id, captureItem(wallDimension(), { doc: doc() })).chest;
  chest = addItem(chest, id, captureItem({
    type: 'measureArea', measureName: 'Screed 50', measureDepth: 50, hatchPattern: 'concrete', measureUnit: 'm²', fillColor: '#dddddd',
  })).chest;
  return chest.sets[0];
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
  // into another user's chest
  const r = importToolSet(emptyChest(), parsed.set);
  assert.deepEqual(strip(r.chest.sets[0].items), strip(set.items));
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
  let chest = addSet(emptyChest(), 'Company walls').chest;
  const existingId = chest.sets[0].id;
  const imported = parseToolSetFile(serializeToolSet(set)).set;

  const conflict = importToolSet(chest, imported);
  assert.equal(conflict.error, 'conflict', 'never silently overwritten');
  assert.equal(conflict.chest, chest);

  const over = importToolSet(chest, imported, { mode: 'overwrite' });
  assert.equal(over.chest.sets.length, 1);
  assert.equal(over.set.id, existingId);
  assert.equal(over.chest.sets[0].items.length, 2);

  const both = importToolSet(chest, imported, { mode: 'keepBoth' });
  assert.deepEqual(both.chest.sets.map((s) => s.name), ['Company walls', 'Company walls (2)']);

  assert.equal(importToolSet(chest, imported, { mode: 'rename', newName: 'company WALLS' }).error, 'name-taken');
  assert.equal(importToolSet(chest, imported, { mode: 'rename', newName: '' }).error, 'name-empty');
  const renamed = importToolSet(chest, imported, { mode: 'rename', newName: 'Partner walls' });
  assert.deepEqual(renamed.chest.sets.map((s) => s.name), ['Company walls', 'Partner walls']);

  // importing twice never shares item ids
  const ids = both.chest.sets.flatMap((s) => s.items.map((i) => i.id));
  const again = importToolSet(both.chest, imported, { mode: 'keepBoth' });
  const allIds = again.chest.sets.flatMap((s) => s.items.map((i) => i.id));
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(ids.length > 0);
});
