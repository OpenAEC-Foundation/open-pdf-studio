// Page setup of new blank pages in Edit Pages (#846): presets, orientation,
// custom sizes in mm or inches, and "same as the adjacent page".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLANK_PRESETS, DEFAULT_BLANK_SETUP, normalizeBlankSetup, blankSizeFromSetup, presetSize,
  toPoints, fromPoints, convertLength, setupOrientation, withOrientation, withUnit, withMode,
  shownEntrySize, viewSize, thumbBox,
} from './blank-page-setup.js';
import { createPlan, insertBlank, insertSource, rotateEntries, adjacentEntry, A4 } from './page-edit-plan.js';

test('presets are the paper sizes in points, portrait or landscape', () => {
  assert.deepEqual(Object.keys(BLANK_PRESETS), ['a4', 'a3', 'a2', 'a1', 'a0', 'letter', 'legal']);
  assert.deepEqual(presetSize('a4'), { width: 595.28, height: 841.89 });
  assert.deepEqual(presetSize('a4'), { ...A4 }, 'the same A4 the rest of Edit Pages uses');
  assert.deepEqual(presetSize('a3'), { width: 841.89, height: 1190.55 });
  assert.deepEqual(presetSize('a2'), { width: 1190.55, height: 1683.78 });
  assert.deepEqual(presetSize('a1'), { width: 1683.78, height: 2383.94 });
  assert.deepEqual(presetSize('a0'), { width: 2383.94, height: 3370.39 });
  assert.deepEqual(presetSize('letter'), { width: 612, height: 792 });
  assert.deepEqual(presetSize('legal'), { width: 612, height: 1008 });
  assert.deepEqual(blankSizeFromSetup({ mode: 'preset', preset: 'a3', orientation: 'landscape' }), { width: 1190.55, height: 841.89 });
  assert.deepEqual(blankSizeFromSetup({ mode: 'preset', preset: 'letter', orientation: 'portrait' }), { width: 612, height: 792 });
});

test('custom sizes in mm or inches become points', () => {
  assert.equal(toPoints(25.4, 'mm'), 72);
  assert.equal(toPoints(1, 'in'), 72);
  assert.equal(fromPoints(72, 'mm'), 25.4);
  assert.equal(convertLength(210, 'mm', 'in'), 8.27);
  assert.equal(convertLength(8.5, 'in', 'mm'), 215.9);
  assert.deepEqual(blankSizeFromSetup({ mode: 'custom', width: 100, height: 50, unit: 'mm' }), { width: 283.46, height: 141.73 });
  assert.deepEqual(blankSizeFromSetup({ mode: 'custom', width: 8.5, height: 11, unit: 'in' }), { width: 612, height: 792 });
  // Out of the range a PDF page can have (3 to 14400 points): clamped.
  assert.deepEqual(blankSizeFromSetup({ mode: 'custom', width: 0.1, height: 9000, unit: 'mm' }), { width: 3, height: 14400 });
});

test('same as adjacent: exactly the size the adjacent page shows, else A4', () => {
  const setup = { mode: 'adjacent' };
  assert.deepEqual(blankSizeFromSetup(setup, { width: 1190.551, height: 841.8898 }), { width: 1190.551, height: 841.8898 });
  assert.deepEqual(blankSizeFromSetup(setup, null), { ...A4 });
  assert.deepEqual(blankSizeFromSetup(setup, { width: 0, height: 10 }), { ...A4 });
});

test('the setup is read back from preferences safely; the default is same as adjacent', () => {
  assert.equal(DEFAULT_BLANK_SETUP.mode, 'adjacent');
  assert.deepEqual(normalizeBlankSetup(undefined), DEFAULT_BLANK_SETUP);
  assert.deepEqual(normalizeBlankSetup('rubbish'), DEFAULT_BLANK_SETUP);
  assert.deepEqual(normalizeBlankSetup({ mode: 'preset', preset: 'b9', orientation: 'sideways', unit: 'cm', width: -4, height: 'x' }),
    { ...DEFAULT_BLANK_SETUP, mode: 'preset' });
  const kept = { mode: 'custom', preset: 'a1', orientation: 'landscape', width: 500, height: 300, unit: 'in' };
  assert.deepEqual(normalizeBlankSetup(kept), kept);
});

test('orientation, unit and mode changes keep the size consistent', () => {
  const custom = { ...DEFAULT_BLANK_SETUP, mode: 'custom', width: 210, height: 297, unit: 'mm' };
  assert.equal(setupOrientation(custom), 'portrait');
  // In custom mode the orientation turns the entered size.
  const turned = withOrientation(custom, 'landscape');
  assert.deepEqual([turned.width, turned.height, turned.orientation], [297, 210, 'landscape']);
  assert.equal(withOrientation(turned, 'landscape'), turned, 'already that way: unchanged');
  // Switching the unit converts the entered values.
  const inch = withUnit(custom, 'in');
  assert.deepEqual([inch.width, inch.height, inch.unit], [8.27, 11.69, 'in']);
  // Going from a preset to custom starts from that preset, in the chosen unit and way up.
  const fromPreset = withMode({ ...DEFAULT_BLANK_SETUP, mode: 'preset', preset: 'a3', orientation: 'landscape', unit: 'mm' }, 'custom');
  assert.deepEqual([fromPreset.mode, fromPreset.width, fromPreset.height], ['custom', 420, 297]);
  // A preset keeps its own orientation choice.
  assert.equal(setupOrientation({ mode: 'preset', preset: 'a4', orientation: 'landscape' }), 'landscape');
});

test('the adjacent entry: the one to the left, or the one to the right at the start', () => {
  const plan = createPlan(3);
  assert.equal(adjacentEntry(plan.entries, 2).key, 'p2');
  assert.equal(adjacentEntry(plan.entries, 0).key, 'p1');
  assert.equal(adjacentEntry(plan.entries, 3).key, 'p3');
  assert.equal(adjacentEntry([], 0), null);
  // A blank or inserted page to the left counts too.
  const withBlank = insertBlank(plan, 1, 1, { width: 100, height: 200 }).plan;
  assert.equal(adjacentEntry(withBlank.entries, 2).kind, 'blank');
  const withFile = insertSource(plan, 1, 's1', 1).plan;
  assert.equal(adjacentEntry(withFile.entries, 2).kind, 'file');
});

test('a blank entry carries its exact size; rotating keeps it', () => {
  const { plan, keys } = insertBlank(createPlan(1), 1, 2, { width: 1190.55, height: 841.89 });
  for (const k of keys) {
    const e = plan.entries.find((x) => x.key === k);
    assert.deepEqual([e.width, e.height], [1190.55, 841.89]);
  }
  const turned = rotateEntries(plan, [keys[0]], 90).entries.find((x) => x.key === keys[0]);
  assert.deepEqual([turned.width, turned.height, turned.rotation], [1190.55, 841.89, 90]);
  // Without a size (older callers) the entry has none: Apply decides it.
  const old = insertBlank(createPlan(1), 1).plan.entries[1];
  assert.equal(old.width, undefined);
});

test('the shown size of an entry: effective box, /Rotate, app rotation and pending turn', () => {
  assert.deepEqual(viewSize([10, 20, 310, 520]), { width: 300, height: 500 });
  assert.equal(viewSize([0, 0, 0, 10]), null);
  const page = { kind: 'page', page: 1, rotation: 0 };
  assert.deepEqual(shownEntrySize(page, { view: [0, 0, 300, 500], rotate: 0 }), { width: 300, height: 500 });
  assert.deepEqual(shownEntrySize(page, { view: [0, 0, 300, 500], rotate: 90 }), { width: 500, height: 300 });
  assert.deepEqual(shownEntrySize(page, { view: [0, 0, 300, 500], rotate: 90, appRotation: 90 }), { width: 300, height: 500 });
  assert.deepEqual(shownEntrySize({ ...page, rotation: 270 }, { view: [0, 0, 300, 500], rotate: 0 }), { width: 500, height: 300 });
  assert.deepEqual(shownEntrySize({ kind: 'blank', width: 100, height: 200, rotation: 90 }), { width: 200, height: 100 });
  assert.equal(shownEntrySize({ kind: 'blank', rotation: 0 }), null);
  assert.equal(shownEntrySize(null), null);
});

test('the thumbnail box has exactly the proportions of the page', () => {
  assert.deepEqual(thumbBox({ width: 595.28, height: 841.89 }, 100), { width: 65, height: 92 });
  assert.deepEqual(thumbBox({ width: 841.89, height: 595.28 }, 100), { width: 92, height: 65 });
  assert.deepEqual(thumbBox({ width: 500, height: 500 }, 100), { width: 92, height: 92 });
  assert.equal(thumbBox(null, 100), null);
});

test('every locale has the strings of the blank page setup', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'locales');
  const keys = [
    'pageOrganizer.blankSetup', 'pageOrganizer.sameAsAdjacent', 'pageOrganizer.width', 'pageOrganizer.height',
    'pageOrganizer.unit', 'insertPage.paperSize', 'insertPage.orientation', 'insertPage.portrait',
    'insertPage.landscape', 'newDoc.customSize',
  ];
  const locales = fs.readdirSync(root);
  assert.ok(locales.length >= 40);
  for (const locale of locales) {
    const d = JSON.parse(fs.readFileSync(path.join(root, locale, 'dialogs.json'), 'utf8'));
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => o?.[p], d);
      assert.ok(typeof v === 'string' && v.trim(), `${locale}: ${k}`);
    }
  }
  const en = JSON.parse(fs.readFileSync(path.join(root, 'en', 'dialogs.json'), 'utf8')).pageOrganizer;
  const nl = JSON.parse(fs.readFileSync(path.join(root, 'nl', 'dialogs.json'), 'utf8')).pageOrganizer;
  assert.equal(en.sameAsAdjacent, 'Same as adjacent page');
  assert.equal(nl.sameAsAdjacent, 'Zelfde als aangrenzende pagina');
});
