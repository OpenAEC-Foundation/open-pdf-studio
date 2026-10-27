// Wapeningsdetail (buigvorm, #312): schets per vormcode, notatie, staaflengte
// en de staaf die naar de buigstaat gaat.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wapeningsdetailTemplate as tpl, buigvormSchets, wapeningsdetailLabel, wapeningsdetailLengte,
  wapeningsdetailLayout,
} from './wapeningsdetail.js';
import { defaultParams, getTemplate } from '../registry.js';
import { staafLengte } from '../../quantities/wapening.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

const BBOX = { x: 30, y: 40, width: 280, height: 140 };

test('het template is geregistreerd met een buigvorm-keuze', () => {
  assert.equal(getTemplate('wapeningsdetail'), tpl);
  const vorm = tpl.params.find((p) => p.key === 'vormcode');
  assert.deepEqual(vorm.options.map((o) => o.value), ['00', '11', '21', '51']);
  assert.equal(defaultParams(tpl).staalkwaliteit, 'B500B');
});

test('schets per vormcode: aantal benen en maatgetallen', () => {
  const recht = buigvormSchets('00', { a: 4000 });
  assert.equal(recht.lijnen[0].length, 2);
  assert.deepEqual(recht.maten.map((m) => [m.seg, m.waarde]), [['a', 4000]]);

  const l = buigvormSchets('11', { a: 2500, b: 400 });
  assert.equal(l.lijnen[0].length, 3);
  assert.deepEqual(l.maten.map((m) => m.seg), ['a', 'b']);

  const u = buigvormSchets('21', { a: 300, b: 2000, c: 500 });
  assert.equal(u.lijnen[0].length, 4);
  assert.deepEqual(u.maten.map((m) => [m.seg, m.waarde]), [['a', 300], ['b', 2000], ['c', 500]]);
  // Het langere been is ook langer getekend.
  const hoogte = (pts) => Math.abs(pts[1].y - pts[0].y);
  assert.ok(hoogte(u.lijnen[0].slice(2)) > hoogte(u.lijnen[0].slice(0, 2)));

  const beugel = buigvormSchets('51', { a: 300, b: 500 });
  assert.equal(beugel.lijnen.length, 3, 'omtrek + twee haken');
  assert.ok(beugel.h > beugel.w, 'hoge beugel staat rechtop');
});

test('korte benen blijven zichtbaar', () => {
  const u = buigvormSchets('21', { a: 10, b: 5000, c: 10 });
  assert.ok(u.h >= 13);
});

test('notatie en staaflengte', () => {
  const p = { staafnummer: '3', aantal: 12, diameter: 10, afstand: 150, vormcode: '21', a: 300, b: 2000, c: 300 };
  assert.equal(wapeningsdetailLengte(p), 2560);
  assert.equal(wapeningsdetailLabel(p), '12Ø10-150 lg=2560 B500B');
  assert.equal(wapeningsdetailLabel({ ...p, afstand: 0, toonLengte: false, staalkwaliteit: 'B500A' }), '12Ø10 B500A');
  assert.equal(
    wapeningsdetailLengte({ ...p, vormcode: '51', a: 300, b: 500, haaklengte: 120 }),
    staafLengte('51', { a: 300, b: 500 }, 10, { haaklengte: 120 }),
  );
});

test('render: label met staafnummer, maatgetallen, alles binnen de bbox', () => {
  for (const vormcode of ['00', '11', '21', '51']) {
    const p = { ...defaultParams(tpl), vormcode };
    const cmds = tpl.render(p, BBOX);
    assertBinnenBbox(cmds, BBOX, `vorm ${vormcode}`);
    const t = teksten(cmds);
    assert.ok(t.includes('1'), 'staafnummer');
    assert.ok(t.some((s) => s.includes('lg=')), 'staaflengte in het label');
    assert.ok(cmds.some((c) => c.role === 'diameterteken'), 'diameterteken als vector');
    assert.ok(cmds.some((c) => c.role === 'staaf'));
  }
  const zonder = tpl.render({ ...defaultParams(tpl), toonMaten: false }, BBOX);
  assert.ok(!zonder.some((c) => c.role === 'maatgetal'));
  assert.ok(tpl.render(defaultParams(tpl), BBOX).filter((c) => c.role === 'maatgetal').length === 3);
});

test('de footprint groeit mee met een lang label', () => {
  const kort = wapeningsdetailLayout({ vormcode: '00', a: 1000 });
  const lang = wapeningsdetailLayout({ vormcode: '00', a: 1000, staafnummer: '123', aantal: 1000, staalkwaliteit: 'B500C' });
  assert.ok(lang.footprint.width >= kort.footprint.width);
});

test('rebarItems: één positie voor de buigstaat', () => {
  const items = tpl.rebarItems({ ...defaultParams(tpl), staafnummer: '7' });
  assert.deepEqual(items, [{
    staafnummer: '7', diameter: 10, aantal: 12, lengteMm: 2560, vormcode: '21', staalkwaliteit: 'B500B', afstand: 150,
  }]);
});
