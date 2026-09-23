// Zwarte vulling in het uiterlijk van een rechthoek of ellips (#433, nawerk
// van #431).
//
// Het uiterlijk koos tussen vullen-en-omtrekken (`B`) en alleen omtrekken (`S`)
// op de waarheid van `ann.fillColor`. De tekenwaarden 'none' en 'transparent'
// zijn waar, en hexToRgb() maakt van allebei ZWART — een vorm mét rand en
// zonder vulling kreeg zo een zwart blok in het uiterlijk, terwijl het
// annotatie-woordenboek er (terecht) geen /IC bij zette. Elke lezer die het
// uiterlijk schildert, toonde het zwarte blok.
//
// De weg ernaartoe loopt niet via de lijnkleurkiezer (die zet de vulling op
// null) maar via elk pad dat een tekenwaarde doorgeeft:
//   - een weergavestijl (stylePresetsStore) bewaart fillColor letterlijk en is
//     niet aan een soort gebonden: een stijl van een tekstvak — dat 'none'
//     krijgt zodra "geen vulling" aanstaat — toegepast op een rechthoek;
//   - app_create_annotation / app_update_annotation van de AI-koppeling, waar
//     de meegegeven eigenschappen boven de standaardwaarden gaan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import { generateAppearanceStream } from './utils.js';

const Y = (y) => 800 - y;

/** Schilder-operatoren in een content-stream. */
function operatoren(stream) {
  const tekst = Buffer.from(stream.getContents()).toString('latin1');
  return tekst.split(/\s+/).filter((t) => /^(S|s|B|B\*|b|b\*|f|f\*|F|n)$/.test(t));
}

/** De `rg`-regels (niet-slagende vulkleur) in een content-stream. */
function vulkleuren(stream) {
  const tekst = Buffer.from(stream.getContents()).toString('latin1');
  return [...tekst.matchAll(/^(\S+) (\S+) (\S+) rg$/gm)].map((m) => m.slice(1, 4).join(' '));
}

async function uiterlijk(ann) {
  const doc = await PDFDocument.create();
  return generateAppearanceStream(doc.context, ann, Y);
}

for (const [soort, maat] of [['box', { width: 120, height: 60 }], ['circle', { width: 80, height: 80 }]]) {
  for (const geen of ['none', 'transparent']) {
    test(`${soort} met rand en fillColor '${geen}': geen zwarte vulling`, async () => {
      const stream = await uiterlijk({
        type: soort, x: 0, y: 0, ...maat,
        strokeColor: '#cc0000', color: '#cc0000', fillColor: geen, lineWidth: 2,
      });
      assert.ok(stream, 'uiterlijk verwacht');
      assert.deepEqual(vulkleuren(stream), [], 'geen enkele vulkleur');
      // Alleen omtrekken, niet vullen-en-omtrekken.
      assert.deepEqual(operatoren(stream), ['S']);
    });
  }

  test(`${soort} met rand en een echte vulling blijft ongewijzigd`, async () => {
    const stream = await uiterlijk({
      type: soort, x: 0, y: 0, ...maat,
      strokeColor: '#cc0000', color: '#cc0000', fillColor: '#ffffff', lineWidth: 2,
    });
    assert.deepEqual(vulkleuren(stream), ['1 1 1']);
    assert.deepEqual(operatoren(stream), ['B']);
  });

  test(`${soort} met rand en zonder vulling blijft ongewijzigd`, async () => {
    const stream = await uiterlijk({
      type: soort, x: 0, y: 0, ...maat,
      strokeColor: '#cc0000', color: '#cc0000', fillColor: null, lineWidth: 2,
    });
    assert.deepEqual(vulkleuren(stream), []);
    assert.deepEqual(operatoren(stream), ['S']);
  });
}

test('het kruis van een rechthoek komt er nog steeds bij', async () => {
  const stream = await uiterlijk({
    type: 'box', x: 0, y: 0, width: 120, height: 60,
    strokeColor: '#cc0000', color: '#cc0000', fillColor: 'none', lineWidth: 2, cross: true,
  });
  assert.deepEqual(vulkleuren(stream), []);
  assert.deepEqual(operatoren(stream), ['S', 'S']);
});
