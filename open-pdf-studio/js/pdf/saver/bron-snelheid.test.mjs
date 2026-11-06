// Snelheid van het bronbehoud bij grote sets (#629, #581): de vingerafdrukken
// van modelvelden zonder de trage JSON-replacer, het kale object achter een
// model uit de state-store, en geen tweede vingerafdruk van een woordenboek
// dat de save niet aanraakte. De uitkomst moet dezelfde blijven als voorheen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { register } from 'node:module';
import { hashTekst, veldVingerafdrukken, verschillendeVelden, dictVingerafdruk } from './bron-vingerafdruk.js';

// bron-behoud.js trekt via annotations/transforms.js TypeScript-modules mee.
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { planBronnen, bronNaOpslaan } = await import('./bron-behoud.js');
// De reactieve browserbouw van de store, zoals in de app (app-test-hooks.mjs).
const { createStore, $RAW } = await import('solid-js/store');

// De vorige vingerafdruk, letterlijk: elk veld door JSON.stringify met een
// replacer die getallen op 1e-6 rondt. Herstelbestanden bewaren modellen met
// zulke vingerafdrukken; de nieuwe moeten gelijk zijn.
const rondGetal = (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
function vorigeVingerafdrukken(ann) {
  const uit = {};
  for (const k of Object.keys(ann || {})) {
    if (k.startsWith('_') || k === 'pdfBron' || k === 'modifiedAt') continue;
    const v = ann[k];
    if (v === undefined || typeof v === 'function') continue;
    let s;
    try { s = JSON.stringify(v, rondGetal); } catch { s = String(Math.random()); }
    if (s !== undefined) uit[k] = hashTekst(s);
  }
  return uit;
}

const MODEL = {
  id: 'a1', type: 'box', page: 3, x: 10.1234567891, y: -0.00000004, width: 1e21, height: 0.1 + 0.2,
  rotation: -0, nan: NaN, oneindig: Infinity, kleur: '#ff0000', tekst: 'Prijs €12 "quote" \\ \n ²°', leeg: '',
  aan: true, uit: false, niets: null, weg: undefined, fn: () => 1, sym: Symbol('s'),
  points: [{ x: 1.0000004, y: 2 }, { x: 3, y: 4.123456789 }], diep: { a: [1, { b: 0.30000000000000004 }] },
  _tijdelijk: 5, pdfBron: { ref: '1R' }, modifiedAt: 'nu',
};

test('de vingerafdrukken zijn dezelfde als die van de vorige versie', () => {
  assert.deepEqual(veldVingerafdrukken(MODEL), vorigeVingerafdrukken(MODEL));
  assert.deepEqual(veldVingerafdrukken({}), {});
  assert.deepEqual(veldVingerafdrukken(null), {});
});

test('verschillendeVelden: gewijzigd, erbij en weg, in de volgorde van eerst oud dan nieuw', () => {
  assert.deepEqual(verschillendeVelden({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x', d: '4' }), ['b', 'c', 'd']);
  assert.deepEqual(verschillendeVelden(null, { a: '1' }), ['a']);
  assert.deepEqual(verschillendeVelden({ a: '1' }, undefined), ['a']);
  assert.deepEqual(verschillendeVelden({ a: '1' }, { a: '1' }), []);
});

async function bestandMetAnnotatie() {
  const doc = await PDFDocument.create();
  const blad = doc.addPage([400, 400]);
  const ctx = doc.context;
  const ap = ctx.register(ctx.stream('0 0 40 40 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 40] }));
  const dict = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], NM: PDFString.of('n1'), AP: ctx.obj({ N: ap }) });
  const ref = ctx.register(dict);
  blad.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return { ctx, ref, dict };
}

test('planBronnen leest het kale object achter een model uit de store, met dezelfde uitkomst', async () => {
  const { ctx, ref, dict } = await bestandMetAnnotatie();
  const model = { id: 'm1', type: 'box', x: 10, y: 20, width: 40, height: 40, author: 'A' };
  model.pdfBron = { ref: `${ref.objectNumber}R`, id: 'm1', dfp: dictVingerafdruk(dict), velden: veldVingerafdrukken(model) };
  const [store] = createStore({ lijst: [model] });
  const proxy = store.lijst[0];
  assert.ok(proxy[$RAW], 'een proxy van de store');

  let gevraagd = 0;
  const ruw = (m) => { gevraagd++; return m[$RAW] || m; };
  const teVervangen = new Set([ref.tag]);
  const viaRuw = planBronnen(ctx, [proxy], teVervangen, { ruw });
  const viaProxy = planBronnen(ctx, [proxy], teVervangen);
  assert.equal(gevraagd, 1);
  assert.equal(viaRuw.get('m1').staat, 'gelijk');
  assert.equal(viaProxy.get('m1').staat, 'gelijk');
  assert.equal(viaRuw.get('m1').dfp, model.pdfBron.dfp, 'het plan draagt de vingerafdruk van het laden');
});

test('bronNaOpslaan neemt een meegegeven vingerafdruk over en berekent de rest', async () => {
  const { ctx, ref, dict } = await bestandMetAnnotatie();
  const ander = ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [0, 0, 5, 5] });
  ctx.register(ander);
  const uit = bronNaOpslaan(ctx, [
    { ann: { id: 'a' }, dict, dfp: 'meegegeven', velden: {} },
    { ann: { id: 'b' }, dict: ander, velden: {} },
  ]);
  assert.equal(uit.length, 2);
  assert.equal(uit[0][1].dfp, 'meegegeven');
  assert.equal(uit[0][1].ref, `${ref.objectNumber}R`);
  assert.equal(uit[1][1].dfp, dictVingerafdruk(ander));
});
