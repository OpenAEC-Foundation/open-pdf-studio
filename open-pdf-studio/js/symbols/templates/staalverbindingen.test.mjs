// Kopplaat bij ligger en voetplaat bij staalprofiel (#312): plaatmaat,
// bout-/ankerposities, afstandscontrole (NEN-EN 1993-1-8 tabel 3.3) en tekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  kopplaatTemplate, voetplaatTemplate, kopplaatGeometrie, kopplaatLabel, voetplaatGeometrie,
  voetplaatLabel, gatDiameter, ankerGatDiameter, ANKERGAT_SPELING, controleerAfstanden,
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
  // Ankergat d0 = 20 + 6 = 26; rand = max(3·d0, 60) = 78
  // → L = 190 + 156 = 346 → 350, B = 200 + 156 = 356 → 360; e = 1,5·26 = 39 → 40.
  assert.equal(g.d0, 26);
  assert.equal(g.L, 350);
  assert.equal(g.B, 360);
  assert.equal(g.e, 40);
  assert.equal(g.ankers.length, 4);
  assert.deepEqual(g.ankers[0], { x: -(175 - 40), y: -(180 - 40) });
  assert.ok(g.vrijeRuimte > 0, 'ankers vallen buiten het profiel');
  assert.ok(g.controle.every((r) => r.ok));
  assert.equal(voetplaatGeometrie({ ankerAantal: '2' }).ankers.length, 2);
  assert.equal(voetplaatGeometrie({ ankerAantal: '6' }).ankers.length, 6);
  assert.equal(voetplaatGeometrie({ plaatLengte: 400, plaatBreedte: 300 }).L, 400);
  assert.deepEqual(voetplaatLabel({}), ['voetplaat 350×360×20 S235', '4 ankers M20-4.6 l=300 · HEA 200']);
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

test('gatdiameter normale ronde gaten volgens NEN-EN 1090-2 tabel 11', () => {
  // M12 en M14: d + 1; M16 t/m M24: d + 2; M27 en groter: d + 3.
  assert.deepEqual([12, 14, 16, 20, 22, 24, 27, 30, 36].map(gatDiameter), [13, 15, 18, 22, 24, 26, 30, 33, 39]);
  const g = kopplaatGeometrie({ profiel: 'IPE 300', boutMaat: 'M12', boutRijen: 2 });
  assert.equal(g.d0, 13, 'M12 in de kopplaat: d0 = 13');
  // e2 = 1,5·13 = 19,5 → 20 ≥ 1,2·13 = 15,6: de controle is niet strenger dan de norm.
  assert.equal(g.e2, 20);
  assert.ok(g.controle.find((r) => r.code === 'e2').ok);
  const gat = binnen(kopplaatTemplate, { ...defaultParams(kopplaatTemplate), aanzicht: 'kop', boutMaat: 'M12' })
    .find((c) => c.role === 'gat');
  // binnen() tekent op 1/3 van de ware maat: straal = d0/2 · 1/3.
  assert.ok(Math.abs(gat.r - 13 / 6) < 1e-6, `gatstraal ${gat.r}`);
});

test('voetplaat: ankergaten ruimer dan boutgaten, apart instelbaar', () => {
  assert.equal(ANKERGAT_SPELING, 6);
  assert.equal(ankerGatDiameter(20), 26);
  assert.equal(ankerGatDiameter(20, 30), 30, 'opgegeven gatmaat');
  assert.equal(ankerGatDiameter(20, 18), 26, 'een gat kleiner dan het anker telt niet');
  const std = voetplaatGeometrie({ ankerMaat: 'M20' });
  assert.ok(std.d0 > gatDiameter(20), 'ankergat ruimer dan een normaal boutgat');
  const eigen = voetplaatGeometrie({ ankerMaat: 'M20', ankerGat: 32 });
  assert.equal(eigen.d0, 32);
  assert.equal(eigen.e, 50, 'automatische randafstand volgt de ankergatmaat (1,5·32 = 48 → 50)');
  assert.equal(voetplaatTemplate.params.find((q) => q.key === 'ankerGat').default, 0);
  const boven = binnen(voetplaatTemplate, { ...defaultParams(voetplaatTemplate), ankerGat: 32 });
  // binnen() tekent op 1/3 van de ware maat: straal = d0/2 · 1/3.
  const gat = boven.find((c) => c.role === 'gat');
  assert.ok(Math.abs(gat.r - 16 / 3) < 1e-6, `gatstraal ${gat.r}`);
});
