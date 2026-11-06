// De meting van het opslaan van een grote set (#629, #581) werkt: op een
// kleine set bouwen, laden en twee keer opslaan, met het verslag dat het
// releaseprotocol vraagt. De echte meting (150 bladen, 100.000 objecten)
// draait per release met de hand, zie docs/release-testprotocol.md.

import assert from 'node:assert/strict';
import test from 'node:test';
import { bouwSet, meet } from './meet-opslaan-grote-set.mjs';

test('de set heeft het gevraagde aantal bladen en minstens het gevraagde aantal objecten', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const set = await bouwSet({ bladen: 3, objecten: 200 });
  const doc = await PDFDocument.load(set.bytes);
  assert.equal(doc.getPageCount(), 3);
  assert.ok(set.objecten >= 200, `${set.objecten} objecten`);
  const annots = doc.getPages().reduce((n, p) => n + (p.node.Annots()?.size() || 0), 0);
  assert.equal(annots, 3 * set.perBlad);
});

test('de meting slaat op zonder en met bewerking en geeft tijden en groottes', async () => {
  const r = await meet({ bladen: 2, objecten: 120, rondes: 1 });
  assert.equal(r.bladen, 2);
  assert.ok(r.markeringen > 0);
  for (const naam of ['zonderBewerking', 'bewerktPerBlad']) {
    const s = r.scenarios[naam];
    assert.ok(Number.isFinite(s.mediaanMs) && s.mediaanMs >= 0, naam);
    assert.equal(s.tijdenMs.length, 1);
    assert.ok(s.megabytes >= 0);
  }
});
