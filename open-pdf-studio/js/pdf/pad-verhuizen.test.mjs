import assert from 'node:assert/strict';
import test from 'node:test';
import { verhuisOpenDocument } from './pad-verhuizen.js';

// Een open bestand hernoemen (tabblad, F2) zet het document op een nieuw pad.
// Wat per pad bewaard staat, moet mee: de geschakelde laagstand (anders
// vervalt hij als verouderd en is "Als standaard instellen" niet meer
// beschikbaar) en de weergave (anders vraagt de viewport bitmaps uit een pad
// dat na het hernoemen niet meer bestaat, zoals bij Opslaan als in #673).

function stubs() {
  const aanroepen = [];
  return {
    aanroepen,
    deps: {
      verhuisLaagstand: (doc, oud, nieuw) => aanroepen.push(['laagstand', doc.id, oud, nieuw]),
      wisselBestandspad: (oud, nieuw) => aanroepen.push(['weergave', oud, nieuw]),
    },
  };
}

test('renaming moves the layer view state and the view to the new path', async () => {
  const doc = { id: 'd1', filePath: 'C:/map/oud.pdf', fileName: 'oud.pdf' };
  const { aanroepen, deps } = stubs();
  await verhuisOpenDocument(doc, 'C:/map/oud.pdf', 'C:/map/nieuw.pdf', deps);
  assert.equal(doc.filePath, 'C:/map/nieuw.pdf');
  assert.equal(doc.fileName, 'nieuw.pdf');
  assert.deepEqual(aanroepen, [
    ['laagstand', 'd1', 'C:/map/oud.pdf', 'C:/map/nieuw.pdf'],
    ['weergave', 'C:/map/oud.pdf', 'C:/map/nieuw.pdf'],
  ]);
});

test('the layer state moves before anything reads the new path', async () => {
  const doc = { id: 'd2', filePath: 'C:\\map\\a.pdf', fileName: 'a.pdf' };
  let padBijLaagstand = null;
  await verhuisOpenDocument(doc, 'C:\\map\\a.pdf', 'C:\\map\\b.pdf', {
    verhuisLaagstand: (d) => { padBijLaagstand = d.filePath; },
    wisselBestandspad: () => {},
  });
  assert.equal(padBijLaagstand, 'C:\\map\\b.pdf', 'the document already points at the new path');
  assert.equal(doc.fileName, 'b.pdf');
});

test('a failing view move does not undo the rename', async () => {
  const doc = { id: 'd3', filePath: 'C:/x/a.pdf', fileName: 'a.pdf' };
  await verhuisOpenDocument(doc, 'C:/x/a.pdf', 'C:/x/c.pdf', {
    verhuisLaagstand: () => {},
    wisselBestandspad: () => { throw new Error('geen viewport'); },
  });
  assert.equal(doc.filePath, 'C:/x/c.pdf');
});
