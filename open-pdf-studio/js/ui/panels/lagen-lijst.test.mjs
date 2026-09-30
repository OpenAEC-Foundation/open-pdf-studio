import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import { lagenLijst } from './lagen-lijst.js';

const pdfjsId = (ref) => `${ref.objectNumber}R`;

// Een tekening met lagen zoals een CAD-export ze schrijft: een losse laag,
// een groep met label, een laag die standaard uit staat, een laag die niet in
// /Order staat, en een markeringslaag van de app zelf (#468).
async function tekeningMetLagen() {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 300]);
  const laag = (naam) => pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: naam }));
  const stramien = laag(PDFString.of('Stramien'));
  const wanden = laag(PDFHexString.fromText('Wanden – bestaand'));
  const maten = laag(PDFString.of('Maatvoering'));
  const los = laag(PDFString.of('Los'));
  const markering = laag(PDFString.of('Opmerkingen'));
  const volgorde = pdf.context.obj([
    stramien,
    pdf.context.obj([PDFString.of('Constructie'), wanden, maten]),
    pdf.context.obj([PDFString.of('Markeringen'), markering]),
  ]);
  pdf.catalog.set(PDFName.of('OCProperties'), pdf.context.obj({
    OCGs: [stramien, wanden, maten, los, markering],
    D: { Order: volgorde, OFF: [maten] },
  }));
  return { bytes: await pdf.save(), refs: { stramien, wanden, maten, los, markering } };
}

test('de lagen van een echte PDF via pdf.js: boom, namen en beginstand', async () => {
  const { bytes, refs } = await tekeningMetLagen();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const config = await doc.getOptionalContentConfig();
    const lijst = lagenLijst(config, { overslaan: new Set([pdfjsId(refs.markering)]) });
    assert.deepEqual(lijst, [
      { id: pdfjsId(refs.stramien), name: 'Stramien', visible: true, depth: 0 },
      { kop: true, name: 'Constructie', depth: 0 },
      { id: pdfjsId(refs.wanden), name: 'Wanden – bestaand', visible: true, depth: 1 },
      { id: pdfjsId(refs.maten), name: 'Maatvoering', visible: false, depth: 1 },
      // Niet in /Order: pdf.js zet hem achteraan, in een groep zonder naam.
      { id: pdfjsId(refs.los), name: 'Los', visible: true, depth: 0 },
    ]);
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('zonder overslaan staat de markeringslaag onder zijn eigen kop', async () => {
  const { bytes, refs } = await tekeningMetLagen();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const lijst = lagenLijst(await doc.getOptionalContentConfig());
    const i = lijst.findIndex((r) => r.kop && r.name === 'Markeringen');
    assert.ok(i >= 0);
    assert.deepEqual(lijst[i + 1], { id: pdfjsId(refs.markering), name: 'Opmerkingen', visible: true, depth: 1 });
  } finally {
    await doc.loadingTask.destroy();
  }
});

// Een nagebootste OptionalContentConfig met dezelfde vorm als die van pdf.js 5.
function nepConfig(groepen, order) {
  const kaart = new Map(Object.entries(groepen));
  return {
    [Symbol.iterator]: () => kaart.entries(),
    getOrder: () => (kaart.size ? (order ?? [...kaart.keys()]) : null),
  };
}

test('geen configuratie of geen groepen: een lege lijst', () => {
  assert.deepEqual(lagenLijst(null), []);
  assert.deepEqual(lagenLijst(undefined), []);
  assert.deepEqual(lagenLijst(nepConfig({})), []);
});

test('zonder /Order: alle groepen plat, in de volgorde van het document', () => {
  const lijst = lagenLijst(nepConfig({ '1R': { name: 'A', visible: true }, '2R': { name: 'B', visible: false } }));
  assert.deepEqual(lijst, [
    { id: '1R', name: 'A', visible: true, depth: 0 },
    { id: '2R', name: 'B', visible: false, depth: 0 },
  ]);
});

test('een kop zonder overgebleven lagen verdwijnt, en elke laag komt één keer', () => {
  const config = nepConfig(
    { '1R': { name: 'A', visible: true }, '2R': { name: 'Eigen', visible: true }, '3R': { name: 'C', visible: true } },
    ['1R', { name: 'Leeg', order: ['2R'] }, { name: 'Diep', order: [{ name: 'Dieper', order: ['3R', '1R'] }] }],
  );
  assert.deepEqual(lagenLijst(config, { overslaan: new Set(['2R']) }), [
    { id: '1R', name: 'A', visible: true, depth: 0 },
    { kop: true, name: 'Diep', depth: 0 },
    { kop: true, name: 'Dieper', depth: 1 },
    { id: '3R', name: 'C', visible: true, depth: 2 },
  ]);
});

test('een laag zonder naam krijgt een volgnummer; een groep buiten de volgorde komt achteraan', () => {
  const config = nepConfig({ '1R': { name: '', visible: true }, '2R': { name: 'B', visible: true } }, ['1R']);
  assert.deepEqual(lagenLijst(config), [
    { id: '1R', name: 'Layer 1', visible: true, depth: 0 },
    { id: '2R', name: 'B', visible: true, depth: 0 },
  ]);
});

test('het paneel leest de lagen via lagenLijst en niet meer via getGroups()', () => {
  const paneel = readFileSync(new URL('./layers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(paneel, /getGroups\s*\(/);
  assert.match(paneel, /lagenLijst\(/);
});
