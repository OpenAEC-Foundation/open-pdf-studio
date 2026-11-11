// Staaf in plattegrond (#312): aantal uit de verdeling, vorm uit de haken,
// notatie en tekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  staafPlattegrondTemplate as tpl, staafPlattegrondAantal, staafPlattegrondVorm,
  staafPlattegrondLengte, staafPlattegrondLabel,
} from './staaf-plattegrond.js';
import { defaultParams, getTemplate } from '../registry.js';
import { staafLengte } from '../../quantities/wapening.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

test('geregistreerd, ware maat = staaflengte × verdeelbreedte', () => {
  assert.equal(getTemplate('staaf-plattegrond'), tpl);
  assert.deepEqual(tpl.realSizeMm(defaultParams(tpl)), { width: 4000, height: 1800 });
  assert.deepEqual(tpl.realSizeMm({ verdeelbreedte: 0 }), { width: 4000, height: 300 });
});

test('aantal uit verdeelbreedte / h.o.h. + 1, of vast', () => {
  assert.equal(staafPlattegrondAantal({ verdeelbreedte: 1800, afstand: 150 }), 13);
  assert.equal(staafPlattegrondAantal({ verdeelbreedte: 1800, afstand: 200 }), 10);
  assert.equal(staafPlattegrondAantal({ verdeelbreedte: 1800, afstand: 150, aantal: 7 }), 7);
});

test('vormcode en lengte volgen de omgezette einden', () => {
  assert.equal(staafPlattegrondVorm({ haken: 'geen' }).vormcode, '00');
  assert.equal(staafPlattegrondVorm({ haken: 'begin' }).vormcode, '11');
  assert.equal(staafPlattegrondVorm({ haken: 'eind' }).vormcode, '11');
  assert.equal(staafPlattegrondVorm({ haken: 'beide' }).vormcode, '21');
  assert.equal(staafPlattegrondLengte({ lengte: 4000 }), 4000);
  assert.equal(
    staafPlattegrondLengte({ lengte: 4000, haken: 'beide', haaklengte: 300, diameter: 10 }),
    staafLengte('21', { a: 300, b: 4000, c: 300 }, 10),
  );
});

test('notatie "13Ø10-150 lg=4000"', () => {
  assert.equal(staafPlattegrondLabel(defaultParams(tpl)), '13Ø10-150 lg=4000');
});

test('render: staaf, verdeellijn met pijlpunten, label binnen de bbox', () => {
  const bbox = { x: 5, y: 5, width: 320, height: 144 };
  for (const haken of ['geen', 'begin', 'eind', 'beide']) {
    for (const labelZijde of ['boven', 'onder']) {
      for (const verdeelPositie of [0, 30, 100]) {
        const cmds = tpl.render({ ...defaultParams(tpl), haken, labelZijde, verdeelPositie }, bbox);
        assertBinnenBbox(cmds, bbox, `${haken}/${labelZijde}/${verdeelPositie}`);
        const staaf = cmds.find((c) => c.role === 'staaf');
        const verwacht = 2 + (haken === 'beide' ? 2 : haken === 'geen' ? 0 : 1);
        assert.equal(staaf.points.length, verwacht);
        assert.equal(cmds.filter((c) => c.role === 'verdeellijn').length, 1);
        assert.equal(cmds.filter((c) => c.role === 'verdeelpijl').length, 2);
      }
    }
  }
  const t = teksten(tpl.render(defaultParams(tpl), bbox));
  assert.ok(t.includes('1') && t.some((s) => s.includes('lg=4000')));
});

test('rebarItems', () => {
  assert.deepEqual(tpl.rebarItems({ ...defaultParams(tpl), haken: 'eind', haaklengte: 250 }), [{
    staafnummer: '1', diameter: 10, aantal: 13, lengteMm: staafLengte('11', { a: 4000, b: 250 }, 10),
    vormcode: '11', staalkwaliteit: 'B500B', afstand: 150,
  }]);
});

test('verdeellijn: gevulde driehoekjes op de zonegrenzen in plaats van streepjes', () => {
  for (const bbox of [{ x: 5, y: 5, width: 320, height: 144 }, { x: 0, y: 0, width: 600, height: 80 }]) {
    for (const params of [defaultParams(tpl), { ...defaultParams(tpl), verdeelbreedte: 0 },
      { ...defaultParams(tpl), verdeelPositie: 0 }, { ...defaultParams(tpl), verdeelPositie: 100, lengte: 900 }]) {
      const cmds = tpl.render(params, bbox);
      const lijnen = cmds.filter((c) => c.role === 'verdeellijn');
      assert.equal(lijnen.length, 1, 'alleen de verdeellijn zelf, geen eindstreepjes');
      const [lijn] = lijnen;
      assert.equal(lijn.kind, 'line');
      assert.equal(lijn.x1, lijn.x2);
      const boven = Math.min(lijn.y1, lijn.y2), onder = Math.max(lijn.y1, lijn.y2);
      const pijlen = cmds.filter((c) => c.role === 'verdeelpijl');
      assert.equal(pijlen.length, 2);
      const punten = [];
      for (const pijl of pijlen) {
        assert.equal(pijl.kind, 'polyline');
        assert.equal(pijl.fill, true);
        assert.equal(pijl.close, true);
        assert.equal(pijl.points.length, 3);
        // Geen eigen kleur: gevuld in de lijnkleur van het symbool (zwart).
        assert.equal(pijl.color, undefined);
        assert.equal(pijl.fillColor, undefined);
        assert.ok(pijl.lineWidth > 0 && pijl.lineWidth <= 0.5, 'dunne omtrek, de punt blijft scherp');
        const [a, punt, b] = pijl.points;
        punten.push(punt);
        assert.ok(Math.abs(punt.x - lijn.x1) < 1e-9, 'punt op de verdeellijn');
        assert.ok(Math.abs(a.y - b.y) < 1e-9, 'basis loodrecht op de verdeellijn');
        assert.ok(Math.abs((a.x + b.x) / 2 - lijn.x1) < 1e-9, 'symmetrisch om de verdeellijn');
        const lengte = Math.abs(a.y - punt.y), breedte = Math.abs(a.x - b.x);
        assert.ok(lengte > 1 && breedte > 0.5 && lengte > breedte, `slanke pijlpunt (${lengte} × ${breedte})`);
        assert.ok(a.y > boven && a.y < onder, 'basis ligt binnen de zone');
      }
      // De punten wijzen naar buiten en raken precies de twee zonegrenzen.
      const ys = punten.map((q) => q.y).sort((p, q) => p - q);
      assert.ok(Math.abs(ys[0] - boven) < 1e-9 && Math.abs(ys[1] - onder) < 1e-9);
      assertBinnenBbox(cmds, bbox, 'pijlpunten');
    }
  }
});
