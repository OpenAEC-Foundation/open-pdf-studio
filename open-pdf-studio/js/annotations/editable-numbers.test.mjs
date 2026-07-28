// Unit-tests voor de inline getalbewerking (annotations/editable-numbers.js
// + de providers). Puur node --test — geen DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerEditableNumbers, getEditableNumbers, hitTestEditableNumber,
  pointInBox, shouldHighlightNumbers, hasEditableNumbers,
  EDITABLE_NUMBER_COLOR,
} from './editable-numbers.js';
// Side-effect: registreert de providers voor stavenreeks / betonbalk /
// parametricSymbol.
import './editable-numbers-providers.js';

// ─── Kernmechanisme ──────────────────────────────────────────────────────

test('registratie → entries met rects; hit-test raak/mis', () => {
  registerEditableNumbers('unittestType', (ann) => [
    { id: 'n', prop: 'n', value: ann.n, box: { cx: 50, cy: 20, w: 20, h: 10, angle: 0 } },
  ]);
  const ann = { type: 'unittestType', n: 7 };
  assert.equal(hasEditableNumbers(ann), true);
  const entries = getEditableNumbers(ann);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].value, 7);
  // Binnen het vak
  assert.equal(hitTestEditableNumber(ann, 55, 22)?.id, 'n');
  // Buiten het vak
  assert.equal(hitTestEditableNumber(ann, 75, 22), null);
  assert.equal(hitTestEditableNumber(ann, 50, 40), null);
});

test('pointInBox is rotatiebewust', () => {
  // Vak 40×10, 90° gedraaid: raak op de VERTICALE as, mis op de horizontale.
  const box = { cx: 0, cy: 0, w: 40, h: 10, angle: Math.PI / 2 };
  assert.equal(pointInBox(box, 0, 15), true);   // langs de gedraaide lengte-as
  assert.equal(pointInBox(box, 15, 0), false);  // zou raak zijn zonder rotatie
});

test('blauwmarkering alleen bij enkelvoudige selectie', () => {
  const ann = { type: 'stavenreeks', startX: 0, startY: 0, endX: 120, endY: 0 };
  const other = { type: 'box' };
  // Geselecteerd als enige → markeren.
  assert.equal(shouldHighlightNumbers(ann, [ann]), true);
  // Niet geselecteerd → niet markeren.
  assert.equal(shouldHighlightNumbers(ann, []), false);
  assert.equal(shouldHighlightNumbers(ann, [other]), false);
  // Meervoudige selectie → niet markeren.
  assert.equal(shouldHighlightNumbers(ann, [ann, other]), false);
  // Vergrendeld → niet markeren.
  assert.equal(shouldHighlightNumbers({ ...ann, locked: true }, [ann]), false);
  // Type zonder provider → niet markeren, ook al is het geselecteerd.
  assert.equal(shouldHighlightNumbers(other, [other]), false);
  // De affordance-kleur is het app-blauw.
  assert.equal(EDITABLE_NUMBER_COLOR, '#0066cc');
});

// ─── Stavenreeks-provider ────────────────────────────────────────────────

test('stavenreeks: aantal en diameter krijgen elk een klikvak op het label', () => {
  const ann = {
    type: 'stavenreeks',
    startX: 0, startY: 0, endX: 120, endY: 0,
    count: 3, diameter: 12, labelSide: 'end',
  };
  const entries = getEditableNumbers(ann);
  assert.equal(entries.length, 2);
  const count = entries.find(e => e.id === 'count');
  const dia = entries.find(e => e.id === 'diameter');
  assert.equal(count.prop, 'srCount');
  assert.equal(count.value, 3);
  assert.equal(dia.prop, 'srDiameter');
  assert.equal(dia.value, 12);
  // Horizontale reeks, label aan het einde: het aantal ("3") staat LINKS van
  // de diameter ("12"), en beide voorbij het lijneinde (x > 120).
  assert.ok(count.box.cx > 120, `aantal-vak voorbij het lijneinde (cx=${count.box.cx})`);
  assert.ok(count.box.cx < dia.box.cx, 'aantal links van diameter');
  // Klik in het midden van elk vak raakt precies dat getal.
  assert.equal(hitTestEditableNumber(ann, count.box.cx, count.box.cy)?.id, 'count');
  assert.equal(hitTestEditableNumber(ann, dia.box.cx, dia.box.cy)?.id, 'diameter');
  // Klik ver buiten het label raakt niets.
  assert.equal(hitTestEditableNumber(ann, 60, 60), null);
});

test('stavenreeks: klikvakken draaien mee met een schuine reeks', () => {
  const ann = {
    type: 'stavenreeks',
    startX: 0, startY: 0, endX: 0, endY: 120, // verticale reeks
    count: 5, diameter: 16,
  };
  const entries = getEditableNumbers(ann);
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.notEqual(e.box.angle, 0);
    assert.equal(hitTestEditableNumber(ann, e.box.cx, e.box.cy)?.id, e.id);
  }
});

// ─── Betonbalk-provider ──────────────────────────────────────────────────

test('betonbalk: tag alleen aangeboden als hij getoond wordt', () => {
  const base = {
    type: 'betonbalk',
    startX: 0, startY: 0, endX: 200, endY: 0,
    breedteMm: 300, hoogteMm: 400,
  };
  // tagTonen uit (default) → geen bewerkbaar getal.
  assert.equal(getEditableNumbers({ ...base, tagTonen: false }).length, 0);
  // tagTonen aan → de profielnaam als tag-entry, boven de balk.
  const entries = getEditableNumbers({ ...base, tagTonen: true });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'tag');
  assert.equal(entries[0].prop, 'tagTekst');
  assert.equal(entries[0].value, '300x400');
  assert.ok(entries[0].box.cy < 0, 'tag-vak ligt boven de hartlijn');
  const hit = hitTestEditableNumber(
    { ...base, tagTonen: true }, entries[0].box.cx, entries[0].box.cy);
  assert.equal(hit?.id, 'tag');
});

// ─── Parametrische-symbool-provider ──────────────────────────────────────

test('wapeningskorf: getal-labels wel, naam-label (tekst) niet', () => {
  const ann = {
    type: 'parametricSymbol', symbolId: 'wapeningskorf',
    params: {}, x: 0, y: 0, width: 400, height: 300, rotation: 0,
  };
  const entries = getEditableNumbers(ann);
  const ids = entries.map(e => e.id).sort();
  assert.deepEqual(ids, ['beugel', 'boven', 'onder', 'zij']);
  // 'naam' is een puur tekstveld → geen blauw getal.
  assert.ok(!ids.includes('naam'));
  for (const e of entries) {
    assert.equal(hitTestEditableNumber(ann, e.box.cx, e.box.cy)?.id, e.id);
  }
});

test('parametrisch symbool: klikvakken volgen de annotatierotatie', () => {
  const base = {
    type: 'parametricSymbol', symbolId: 'wapeningskorf',
    params: {}, x: 0, y: 0, width: 400, height: 300,
  };
  const flat = getEditableNumbers({ ...base, rotation: 0 });
  const rot = getEditableNumbers({ ...base, rotation: 90 });
  assert.equal(flat.length, rot.length);
  const cx = base.x + base.width / 2;
  const cy = base.y + base.height / 2;
  for (let i = 0; i < flat.length; i++) {
    // 90° om het bbox-middelpunt: (dx, dy) → (−dy, dx).
    const dx = flat[i].box.cx - cx;
    const dy = flat[i].box.cy - cy;
    assert.ok(Math.abs(rot[i].box.cx - (cx - dy)) < 1e-6);
    assert.ok(Math.abs(rot[i].box.cy - (cy + dx)) < 1e-6);
  }
});
