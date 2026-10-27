// Kopplaat bij ligger en voetplaat bij staalprofiel (#312): plaatmaat,
// bout-/ankerposities, afstandscontrole (NEN-EN 1993-1-8 tabel 3.3) en tekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  kopplaatTemplate, voetplaatTemplate, kopplaatGeometrie, kopplaatLabel, voetplaatGeometrie,
  voetplaatLabel, gatDiameter, controleerAfstanden,
} from './staalverbindingen.js';
import { defaultParams, getTemplate } from '../registry.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

function binnen(tpl, p) {
  const mm = tpl.realSizeMm(p);
  assert.ok(mm.width > 0 && mm.height > 0);
  const bbox = { x: 3, y: 4, width: mm.width / 3, height: mm.height / 3 };
  const cmds = tpl.render(p, bbox);
  assertBinnenBbox(cmds, bbox, `${tpl.id} ${p.aanzicht}`);
  return cmds;
}

test('gatdiameter en controle van rand- en tussenafstanden', () => {
  assert.equal(gatDiameter(20), 22);
  assert.equal(gatDiameter(27), 30);
  const c = controleerAfstanden({ d0: 22, e1: 26, e2: 27, p1: 48, p2: 52 });
  assert.deepEqual(c.map((r) => [r.code, r.ok]), [['e1', false], ['e2', true], ['p1', false], ['p2', false]]);
  assert.equal(controleerAfstanden({ d0: 22, e1: 40, e2: 40, p1: NaN, p2: 60 }).length, 3, 'zonder p1 bij één rij');
});

test('kopplaat: plaatmaat en boutpatroon', () => {
  assert.equal(getTemplate('kopplaat'), kopplaatTemplate);
  const g = kopplaatGeometrie({ profiel: 'IPE 300', boutMaat: 'M20', boutRijen: 2 });
  assert.equal(g.bp, 150);
  assert.equal(g.hp, 300);
  assert.equal(g.d0, 22);
  assert.equal(g.e2, 35);           // 1,5·d0 = 33 → 35
  assert.equal(g.e1, 45);           // tf 10,7 + 33 → 45
  assert.deepEqual(g.rijen, [45, 255]);
  assert.deepEqual(g.kolommen, [35, 115]);
  assert.equal(g.aantalBouten, 4);
  assert.ok(g.controle.every((r) => r.ok), JSON.stringify(g.controle));

  const ver = kopplaatGeometrie({ profiel: 'HEA 200', overstek: 60, boutRijen: 4, plaatBreedte: 220 });
  assert.equal(ver.hp, 190 + 120);
  assert.equal(ver.bp, 220);
  assert.equal(ver.e1, 30, 'boutrij in het overstek');
  assert.equal(ver.rijen.length, 4);
  assert.equal(ver.rijen[3], ver.hp - 30);

  assert.deepEqual(kopplaatLabel({ profiel: 'IPE 300' }), ['kopplaat 150×300×15 S235', '4 M20-8.8 · IPE 300']);
  assert.equal(kopplaatGeometrie({ e2: 20 }).controle.find((r) => r.code === 'e2').ok, false);
});

test('kopplaat: zij- en kopaanzicht binnen de bbox', () => {
  const zij = binnen(kopplaatTemplate, defaultParams(kopplaatTemplate));
  assert.equal(zij.filter((c) => c.role === 'moer').length, 2);
  assert.ok(zij.some((c) => c.role === 'las'));
  assert.ok(teksten(zij).includes('kopplaat 150×300×15 S235'));
  const kop = binnen(kopplaatTemplate, { ...defaultParams(kopplaatTemplate), aanzicht: 'kop', boutRijen: 3 });
  assert.equal(kop.filter((c) => c.role === 'gat').length, 6);
  assert.ok(kop.some((c) => c.kind === 'rings' && c.role === 'profiel'));
  binnen(kopplaatTemplate, { ...defaultParams(kopplaatTemplate), aanzicht: 'zij', overstek: 80, profiel: 'HEB 500', toonLabel: false });
});

test('voetplaat: plaatmaat en ankerposities', () => {
  assert.equal(getTemplate('voetplaat'), voetplaatTemplate);
  const g = voetplaatGeometrie({ profiel: 'HEA 200', ankerMaat: 'M20' });
  // rand = max(3·d0, 60) = 66 → L = 190 + 132 = 322 → 330, B = 200 + 132 → 340
  assert.equal(g.L, 330);
  assert.equal(g.B, 340);
  assert.equal(g.e, 35);
  assert.equal(g.ankers.length, 4);
  assert.deepEqual(g.ankers[0], { x: -(165 - 35), y: -(170 - 35) });
  assert.ok(g.vrijeRuimte > 0, 'ankers vallen buiten het profiel');
  assert.ok(g.controle.every((r) => r.ok));
  assert.equal(voetplaatGeometrie({ ankerAantal: '2' }).ankers.length, 2);
  assert.equal(voetplaatGeometrie({ ankerAantal: '6' }).ankers.length, 6);
  assert.equal(voetplaatGeometrie({ plaatLengte: 400, plaatBreedte: 300 }).L, 400);
  assert.deepEqual(voetplaatLabel({}), ['voetplaat 330×340×20 S235', '4 ankers M20-4.6 l=300 · HEA 200']);
});

test('voetplaat: boven- en zijaanzicht binnen de bbox', () => {
  const boven = binnen(voetplaatTemplate, defaultParams(voetplaatTemplate));
  assert.equal(boven.filter((c) => c.role === 'gat').length, 4);
  const zij = binnen(voetplaatTemplate, { ...defaultParams(voetplaatTemplate), aanzicht: 'zij' });
  assert.equal(zij.filter((c) => c.role === 'moer').length, 2, 'twee ankerposities in zijaanzicht');
  assert.ok(zij.some((c) => c.role === 'ondersabeling'));
  assert.ok(zij.some((c) => c.role === 'anker' && Array.isArray(c.dash)), 'ingestorte ankerlengte gestreept');
  const zes = binnen(voetplaatTemplate, { ...defaultParams(voetplaatTemplate), aanzicht: 'zij', ankerAantal: '6', ondersabeling: 0 });
  assert.equal(zes.filter((c) => c.role === 'moer').length, 3);
  assert.ok(!zes.some((c) => c.role === 'ondersabeling'));
});
