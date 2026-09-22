// Vorm zonder rand bij laden: uit de eigen sleutel /OPS_NoStroke, en uit een
// andere lezer die de rand weglaat met /BS /W 0 zonder randkleur.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { randloosUitExtra } from './geen-rand.js';

const RECT = [100, 100, 300, 200];

/** Extra gegevens van één annotatie na opslaan en heropenen. */
async function extraVan(dict) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const context = doc.context;
  const annotDict = context.obj({ Type: 'Annot', Rect: RECT, ...dict });
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  return (await extractAnnotationColors(1, heropend)).get(RECT.join(','));
}

test('eigen sleutel: lijndikte-instelling en eigen kleur komen terug', async () => {
  const extra = await extraVan({
    Subtype: 'Square', IC: [0, 1, 0], BS: { W: 0, S: 'D', D: [8, 4] },
    OPS_NoStroke: { W: 3, C: [0.8, 0, 0] },
  });
  assert.equal(extra.ic, '#00ff00', 'vulling blijft');
  assert.equal(extra.borderStyle, 'dashed', 'lijnstijl blijft');
  assert.deepEqual(randloosUitExtra(extra), { strokeColor: 'none', lineWidth: 3, color: '#cc0000' });
});

test('eigen sleutel zonder waarden: randloos met de breedte uit /BS', async () => {
  const extra = await extraVan({ Subtype: 'Circle', C: [0, 0, 1], BS: { W: 0 }, OPS_NoStroke: {} });
  assert.deepEqual(randloosUitExtra(extra), { strokeColor: 'none', lineWidth: 0 });
});

test('andere lezer: /BS /W 0 zonder /C laadt als vorm zonder rand', async () => {
  for (const Subtype of ['Square', 'Circle', 'Polygon']) {
    const extra = await extraVan({ Subtype, IC: [1, 0, 0], BS: { W: 0 } });
    assert.deepEqual(randloosUitExtra(extra), { strokeColor: 'none', lineWidth: 0 }, Subtype);
  }
  const leeg = await extraVan({ Subtype: 'Square', C: [], IC: [1, 0, 0], BS: { W: 0 } });
  assert.deepEqual(randloosUitExtra(leeg), { strokeColor: 'none', lineWidth: 0 }, 'lege /C []');
  const border = await extraVan({ Subtype: 'Circle', IC: [1, 0, 0], Border: [0, 0, 0] });
  assert.deepEqual(randloosUitExtra(border), { strokeColor: 'none', lineWidth: 0 }, '/Border [0 0 0]');
  // FreeText: /C is de vulling, /IC de rand.
  const tekst = await extraVan({ Subtype: 'FreeText', C: [1, 1, 1], BS: { W: 0 } });
  assert.deepEqual(randloosUitExtra(tekst), { strokeColor: 'none', lineWidth: 0 }, 'FreeText zonder /IC');
});

test('andere lezer: met randkleur of met lijndikte blijft de rand staan', async () => {
  assert.equal(randloosUitExtra(await extraVan({ Subtype: 'Square', C: [0, 0, 0], BS: { W: 0 } })), null, '/C aanwezig');
  assert.equal(randloosUitExtra(await extraVan({ Subtype: 'Square', BS: { W: 2 } })), null, '/W 2 zonder /C');
  assert.equal(randloosUitExtra(await extraVan({ Subtype: 'Polygon' })), null, 'geen /BS of /Border');
  assert.equal(randloosUitExtra(await extraVan({ Subtype: 'FreeText', IC: [1, 0, 0], BS: { W: 0 } })), null, 'FreeText met /IC');
  assert.equal(randloosUitExtra(await extraVan({ Subtype: 'Square', C: [0, 0, 1], BS: { W: 3 } })), null, 'gewone rand');
});
