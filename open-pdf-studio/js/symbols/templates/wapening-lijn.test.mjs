// Wapeningsstaaf en netwapening: dunne pen voor de markering en het
// diameterteken, grotere tekst (1,5×) die binnen de bbox blijft, en
// meerdere markeringen gelijkmatig over de staaf (aantalMarkeringen).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wapeningsstaafTemplate as staaf, netwapeningTemplate as net } from './wapening-lijn.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const bbox = { x: 10, y: 20, width: 320, height: 48 };
const markers = (cmds) => cmds.filter((c) => c.role === 'marker');
const middenX = (m) => (Math.min(...m.points.map((p) => p.x)) + Math.max(...m.points.map((p) => p.x))) / 2;
const bijna = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('markering en diameterteken dragen een eigen dunne pen', () => {
  for (const tpl of [staaf, net]) {
    for (const hoogte of [24, 48, 120]) {
      const cmds = tpl.render({}, { ...bbox, height: hoogte });
      const ms = markers(cmds);
      assert.equal(ms.length, 1);
      for (const m of ms) {
        assert.equal(m.fill, true);
        assert.ok(m.lineWidth > 0 && m.lineWidth <= 0.5, `${tpl.id}: marker lw=${m.lineWidth}`);
      }
      const teken = cmds.filter((c) => c.role === 'diameterteken');
      assert.equal(teken.length, 4);
      for (const t of teken) {
        assert.ok(t.lineWidth >= 0.3 && t.lineWidth <= 1.2, `${tpl.id}: teken lw=${t.lineWidth}`);
      }
      const cirkel = teken.find((c) => c.kind === 'circle');
      assert.ok(cirkel.lineWidth <= Math.max(0.3, 0.16 * cirkel.r) + 1e-9, 'teken-pen schaalt met de straal');
      // De staaf zelf blijft de instelbare annotatie-lijndikte volgen.
      const lijn = cmds.find((c) => c.kind === 'line' && !c.role);
      assert.equal(lijn.lineWidth, undefined);
    }
  }
});

test('tekst is anderhalf keer zo hoog als voorheen', () => {
  // Voorheen: min(0,20 × hoogte, 0,045 × breedte) (staaf) resp. 0,28 × hoogte (net).
  assert.ok(bijna(staaf.layout({}, bbox).textSize, 1.5 * Math.min(48 * 0.20, 320 * 0.045)));
  assert.ok(bijna(net.layout({}, bbox).textSize, 1.5 * Math.min(48 * 0.28, 320 * 0.045)));
  const smal = { ...bbox, width: 100 };
  assert.ok(bijna(staaf.layout({}, smal).textSize, 1.5 * 100 * 0.045));
  for (const tpl of [staaf, net]) {
    const labels = tpl.render({}, bbox).filter((c) => c.kind === 'text');
    assert.ok(labels.length >= 1);
    for (const l of labels) assert.ok(bijna(l.size, tpl.layout({}, bbox).textSize));
  }
});

test('grotere tekst blijft binnen de bbox en vrij van de markering', () => {
  for (const tpl of [staaf, net]) {
    for (const box of [bbox, { x: 0, y: 0, width: 60, height: 48 }, { x: 5, y: 5, width: 900, height: 30 },
      { x: 0, y: 0, width: 25, height: 48 }]) {
      for (const markerRichting of ['boven', 'onder']) {
        for (const markerPositie of [0, 25, 100]) {
          const params = { aantal: 12, diameter: 16, lengte: 12000, afstand: 150, markerRichting, markerPositie };
          const cmds = tpl.render(params, box);
          const naam = `${tpl.id} ${box.width}×${box.height} ${markerRichting} ${markerPositie}`;
          assertBinnenBbox(cmds, box, naam);
          const [label] = tpl.editableLabels(params, box);
          const r = label.rect;
          assert.ok(r.x >= box.x - 0.5 && r.x + r.width <= box.x + box.width + 0.5, `${naam}: labelbreedte`);
          assert.ok(r.y >= box.y - 0.5 && r.y + r.height <= box.y + box.height + 0.5, `${naam}: labelhoogte`);
          // Teksten liggen (met hun halve breedte) binnen de bbox.
          for (const t of cmds.filter((c) => c.kind === 'text')) {
            const half = String(t.text).length * t.size * 0.55 / 2;
            assert.ok(t.x - half >= box.x - 0.5 && t.x + half <= box.x + box.width + 0.5, `${naam}: tekst "${t.text}"`);
            assert.ok(t.y - t.size / 2 >= box.y - 0.5, `${naam}: tekst boven de bbox`);
          }
          if (markerRichting === 'boven') {
            const L = tpl.layout(params, box);
            // Onderkant van de inkt: cijfers tot ~0,4 × de tekengrootte onder
            // het hart, het diameterteken tot zijn laagste lijnpunt.
            const onderkant = Math.max(
              ...cmds.filter((c) => c.kind === 'text').map((t) => t.y + t.size * 0.4),
              ...cmds.filter((c) => c.role === 'diameterteken' && c.kind === 'line').flatMap((c) => [c.y1, c.y2]),
            );
            assert.ok(onderkant <= L.markerTipY + 1e-6, `${naam}: tekst raakt de markering`);
          }
        }
      }
    }
  }
});

test('param aantalMarkeringen: geheel, standaard 1, 0 t/m 5', () => {
  for (const tpl of [staaf, net]) {
    const p = tpl.params.find((q) => q.key === 'aantalMarkeringen');
    assert.ok(p, `${tpl.id} heeft aantalMarkeringen`);
    assert.equal(p.type, 'number');
    assert.equal(p.default, 1);
    assert.equal(p.min, 0);
    assert.equal(p.max, 5);
    assert.equal(p.step, 1);
  }
});

test('aantalMarkeringen: gelijkmatig verdeeld over de staaf', () => {
  for (const tpl of [staaf, net]) {
    for (const [waarde, verwacht] of [[0, 0], [1, 1], [2, 2], [3, 3], [5, 5], [9, 5], [-2, 0], [2.6, 3], ['4', 4]]) {
      const ms = markers(tpl.render({ aantalMarkeringen: waarde }, bbox));
      assert.equal(ms.length, verwacht, `${tpl.id}: ${waarde} → ${verwacht}`);
      if (verwacht >= 2) {
        ms.forEach((m, i) => {
          const x = bbox.x + bbox.width * (i + 1) / (verwacht + 1);
          assert.ok(bijna(middenX(m), x), `${tpl.id}: markering ${i + 1}/${verwacht} op x=${middenX(m)} i.p.v. ${x}`);
        });
      }
    }
    for (const ongeldig of [undefined, null, '', 'abc', NaN]) {
      assert.equal(markers(tpl.render({ aantalMarkeringen: ongeldig }, bbox)).length, 1, `${tpl.id}: ${ongeldig}`);
    }
  }
});

test('opgeslagen symbolen zonder de nieuwe param renderen als voorheen', () => {
  // Eén markering op markerPositie; bij de staaf een groepje van markerAantal.
  const oud = { aantal: 3, diameter: 8, lengte: 1600, markerAantal: 3, markerPositie: 50, markerRichting: 'onder' };
  const ms = markers(staaf.render(oud, bbox));
  assert.equal(ms.length, 3);
  assert.ok(bijna(middenX(ms[1]), bbox.x + bbox.width / 2));
  const L = staaf.layout(oud, bbox);
  for (const m of ms) assert.ok(m.points.some((p) => bijna(p.y, L.markerTipY)) && L.markerTipY > L.lineY);
  const [m] = markers(net.render({ diameter: 8, afstand: 150, lengte: 1600, markerPositie: 25 }, bbox));
  assert.ok(bijna(middenX(m), bbox.x + bbox.width * 0.25));
});

test('groepjes (markerAantal) herhalen zich op elke markeringsplaats', () => {
  const ms = markers(staaf.render({ markerAantal: 2, aantalMarkeringen: 3 }, bbox));
  assert.equal(ms.length, 6);
  for (let i = 0; i < 3; i++) {
    const midden = (middenX(ms[2 * i]) + middenX(ms[2 * i + 1])) / 2;
    assert.ok(bijna(midden, bbox.x + bbox.width * (i + 1) / 4));
  }
  assertBinnenBbox(staaf.render({ markerAantal: 4, aantalMarkeringen: 5 }, { ...bbox, width: 40 }),
    { ...bbox, width: 40 }, 'smalle staaf');
});

test('buigstaat en ware maat blijven ongewijzigd', () => {
  assert.deepEqual(staaf.rebarItems({ aantal: 5, diameter: 12, lengte: 2400, aantalMarkeringen: 4 }),
    [{ aantal: 5, diameter: 12, lengteMm: 2400, vormcode: '00' }]);
  assert.deepEqual(staaf.realSizeMm({ lengte: 2400 }), { width: 2400, height: 240 });
  assert.deepEqual(net.realSizeMm({}), { width: 1600, height: 240 });
  assert.equal(net.rebarItems, undefined);
});
