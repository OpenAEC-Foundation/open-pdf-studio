import assert from 'node:assert/strict';
import test from 'node:test';
import { vormVan, hoekStraal, vormInzet, vakPadPdf, bouwVakPad, TEKSTVAK_VORMEN } from './textbox-vorm.js';
import { textboxTekstInzet, textboxTekstBreedte } from './textbox-layout.js';

test('vormVan: onbekend of leeg is een rechthoek', () => {
  assert.equal(vormVan({}), 'rect');
  assert.equal(vormVan(null), 'rect');
  assert.equal(vormVan({ boxShape: 'vijfhoek' }), 'rect');
  for (const v of TEKSTVAK_VORMEN) assert.equal(vormVan({ boxShape: v }), v);
});

test('hoekStraal: een vijfde van de korte zijde', () => {
  assert.equal(hoekStraal(150, 50), 10);
  assert.equal(hoekStraal(40, 100), 8);
  assert.equal(hoekStraal(0, 50), 0);
});

test('vormInzet: een rechthoek vraagt niets, afgerond en ovaal wel', () => {
  assert.equal(vormInzet({ width: 150, height: 50 }), 0);
  const afgerond = vormInzet({ boxShape: 'rounded', width: 150, height: 50 });
  assert.ok(afgerond > 0 && afgerond < 10, String(afgerond));
  const ovaal = vormInzet({ boxShape: 'ellipse', width: 150, height: 50 });
  // ingeschreven rechthoek langs de korte zijde: 25 * (1 - cos 45)
  assert.ok(Math.abs(ovaal - 25 * (1 - Math.SQRT1_2)) < 1e-9);
  assert.ok(ovaal > afgerond);
});

test('de tekstinzet en de tekstbreedte volgen de vorm', () => {
  const rect = { width: 150, height: 50, lineWidth: 1 };
  const ovaal = { ...rect, boxShape: 'ellipse' };
  assert.equal(textboxTekstInzet(rect), 1);
  assert.ok(textboxTekstInzet(ovaal) > 1);
  assert.ok(textboxTekstBreedte(ovaal) < textboxTekstBreedte(rect));
  // een tekstinzet uit een bestand blijft de basis
  assert.equal(textboxTekstInzet({ ...rect, textPadding: 4 }), 4);
});

test('vakPadPdf: rechthoek is een re, afgerond en ovaal zijn gesloten krommen', () => {
  assert.equal(vakPadPdf(10, 20, 100, 50, 'rect'), '10 20 100 50 re');
  const afgerond = vakPadPdf(0, 0, 100, 50, 'rounded');
  assert.ok(afgerond.startsWith('10 0 m'));
  assert.equal((afgerond.match(/ c$/gm) || []).length, 4);
  assert.ok(afgerond.endsWith('h'));
  const ovaal = vakPadPdf(0, 0, 100, 50, 'ellipse');
  assert.ok(ovaal.startsWith('100 25 m'));
  assert.equal((ovaal.match(/ c$/gm) || []).length, 4);
  assert.ok(ovaal.endsWith('h'));
  // geen exponentnotatie in een PDF-getal
  assert.doesNotMatch(afgerond + ovaal, /e[+-]?\d/);
});

test('bouwVakPad roept het juiste canvaspad aan', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, naam) => (...a) => { calls.push([naam, ...a]); } });
  bouwVakPad(ctx, 0, 0, 100, 50, 'rect');
  bouwVakPad(ctx, 0, 0, 100, 50, 'rounded');
  bouwVakPad(ctx, 0, 0, 100, 50, 'ellipse');
  assert.deepEqual(calls.map((c) => c[0]), ['beginPath', 'rect', 'beginPath', 'roundRect', 'beginPath', 'ellipse']);
  assert.deepEqual(calls[3].slice(1), [0, 0, 100, 50, 10]);
  assert.deepEqual(calls[5].slice(1), [50, 25, 50, 25, 0, 0, Math.PI * 2]);
});
