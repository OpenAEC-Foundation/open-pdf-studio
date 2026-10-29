// Lagen schakelen (#684): de weergavekopie is het originele bestand met één
// incrementele update die alleen de standaardconfiguratie (/OCProperties /D)
// vervangt. pdf.js leest die terug zoals PDFium hem tekent: de lagen in /OFF
// staan uit, alle andere aan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { readFileSync } from 'node:fs';

import {
  laagstandBasis, laagstandUpdate, laagRef, weergaveBytes, startxrefVan, uitgezet, isBeginstand,
} from './laagstand.js';

const N = PDFName.of;
const id = (ref) => (ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`);

/**
 * Een tekening met drie lagen; Maten staat standaard uit.
 * @param {{objectStromen?: boolean, losseD?: boolean, losseOc?: boolean, as?: boolean}} opties
 */
async function tekening({ objectStromen = false, losseD = false, losseOc = false, as = false } = {}) {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([200, 200]);
  const laag = (naam) => pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFString.of(naam) }));
  const wanden = laag('Wanden');
  const maten = laag('Maten');
  const tekst = laag('Tekst');
  pagina.node.set(N('Resources'), pdf.context.obj({ Properties: { W: wanden, M: maten, T: tekst } }));
  const inhoud = pdf.context.flateStream('/OC /W BDC 0 0 m 100 100 l S EMC /OC /M BDC 0 100 m 100 0 l S EMC');
  pagina.node.set(N('Contents'), pdf.context.register(inhoud));
  let d = pdf.context.obj({
    Name: PDFString.of('Standaard'),
    Order: [wanden, maten, tekst],
    OFF: [maten],
  });
  if (as) {
    d.set(N('AS'), pdf.context.obj([{ Event: 'View', Category: ['View'], OCGs: [wanden, maten, tekst] }]));
  }
  if (losseD) d = pdf.context.register(d);
  let oc = pdf.context.obj({ OCGs: [wanden, maten, tekst], D: d });
  if (losseOc) oc = pdf.context.register(oc);
  pdf.catalog.set(N('OCProperties'), oc);
  const bytes = await pdf.save({ useObjectStreams: objectStromen });
  return { bytes, ids: { wanden: id(wanden), maten: id(maten), tekst: id(tekst) } };
}

async function zichtbaarheid(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const config = await doc.getOptionalContentConfig();
    return Object.fromEntries([...config].map(([k, g]) => [k, g.visible]));
  } finally {
    await doc.loadingTask?.destroy?.();
  }
}

for (const objectStromen of [false, true]) {
  const soort = objectStromen ? 'xref-stroom' : 'xref-tabel';

  test(`${soort}: een laag uit en een andere aan, de rest blijft gelijk`, async () => {
    const { bytes, ids } = await tekening({ objectStromen });
    assert.deepEqual(await zichtbaarheid(bytes), { [ids.wanden]: true, [ids.maten]: false, [ids.tekst]: true });

    const basis = await laagstandBasis(bytes);
    const kopie = weergaveBytes(bytes, laagstandUpdate(basis, [ids.wanden]));
    assert.deepEqual(await zichtbaarheid(kopie), { [ids.wanden]: false, [ids.maten]: true, [ids.tekst]: true });
  });

  test(`${soort}: het origineel staat byte voor byte vooraan in de kopie`, async () => {
    const { bytes, ids } = await tekening({ objectStromen });
    const kopie = weergaveBytes(bytes, laagstandUpdate(await laagstandBasis(bytes), [ids.tekst]));
    assert.ok(kopie.length > bytes.length);
    assert.deepEqual(kopie.subarray(0, bytes.length), bytes);
    // De nieuwe startxref wijst voorbij het origineel, en de kopie blijft
    // ook voor pdf-lib (de saver) leesbaar.
    assert.ok(startxrefVan(kopie) > bytes.length);
    const terug = await PDFDocument.load(kopie);
    assert.equal(terug.getPageCount(), 1);
  });

  test(`${soort}: alle lagen uit en alles weer aan`, async () => {
    const { bytes, ids } = await tekening({ objectStromen });
    const basis = await laagstandBasis(bytes);
    const alles = [ids.wanden, ids.maten, ids.tekst];
    assert.deepEqual(await zichtbaarheid(weergaveBytes(bytes, laagstandUpdate(basis, alles))),
      { [ids.wanden]: false, [ids.maten]: false, [ids.tekst]: false });
    assert.deepEqual(await zichtbaarheid(weergaveBytes(bytes, laagstandUpdate(basis, []))),
      { [ids.wanden]: true, [ids.maten]: true, [ids.tekst]: true });
  });
}

test('/D en /OCProperties als los object: alleen het binnenste object wordt herschreven', async () => {
  for (const opties of [{ losseD: true }, { losseOc: true }, { losseD: true, losseOc: true }]) {
    const { bytes, ids } = await tekening(opties);
    const basis = await laagstandBasis(bytes);
    const update = laagstandUpdate(basis, [ids.tekst]);
    assert.deepEqual(await zichtbaarheid(weergaveBytes(bytes, update)),
      { [ids.wanden]: true, [ids.maten]: true, [ids.tekst]: false }, JSON.stringify(opties));
    const tekst = Buffer.from(update).toString('latin1');
    // Een losse /D: de catalogus blijft staan zoals hij was.
    if (opties.losseD) assert.doesNotMatch(tekst, /\/Type \/Catalog/, JSON.stringify(opties));
  }
});

test('de rest van /D blijft: naam en volgorde; /AS gaat eruit zodat de keuze geldt', async () => {
  const { bytes, ids } = await tekening({ as: true });
  const basis = await laagstandBasis(bytes);
  const kopie = weergaveBytes(bytes, laagstandUpdate(basis, [ids.wanden]));
  const pdf = await PDFDocument.load(kopie);
  const d = pdf.catalog.lookup(N('OCProperties')).lookup(N('D'));
  assert.equal(d.lookup(N('Name')).decodeText(), 'Standaard');
  assert.equal(d.lookup(N('Order')).size(), 3);
  assert.equal(d.get(N('AS')), undefined);
  assert.equal(d.get(N('BaseState')).asString(), '/ON');
  assert.deepEqual(d.lookup(N('OFF')).asArray().map((r) => id(r)), [ids.wanden]);
});

test('een PDF zonder lagen geeft geen basis', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  assert.equal(await laagstandBasis(await pdf.save()), null);
});

test('laag-id van pdf.js naar objectverwijzing', () => {
  assert.deepEqual(laagRef('12R'), { nummer: 12, generatie: 0 });
  assert.deepEqual(laagRef('7R3'), { nummer: 7, generatie: 3 });
  assert.equal(laagRef('geen'), null);
});

test('de wissel van het paneel: pdf.js-stand na setVisibility wordt de stand van de kopie', async () => {
  const { bytes, ids } = await tekening();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const begin = await doc.getOptionalContentConfig();
    const stand = await doc.getOptionalContentConfig();
    assert.equal(isBeginstand(stand, begin), true);
    assert.deepEqual(uitgezet(stand), [ids.maten]);
    stand.setVisibility(ids.maten, true);
    stand.setVisibility(ids.tekst, false);
    assert.equal(isBeginstand(stand, begin), false);
    const kopie = weergaveBytes(bytes, laagstandUpdate(await laagstandBasis(bytes), uitgezet(stand)));
    assert.deepEqual(await zichtbaarheid(kopie), { [ids.wanden]: true, [ids.maten]: true, [ids.tekst]: false });
    // Terug naar de beginstand: geen kopie nodig.
    stand.setVisibility(ids.maten, false);
    stand.setVisibility(ids.tekst, true);
    assert.equal(isBeginstand(stand, begin), true);
  } finally {
    await doc.loadingTask?.destroy?.();
  }
});

test('het paneel laat de vinkjes schakelen (#684), met de standaardcursor', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const paneel = lees('../solid/components/left-panel/panels/LayersPanel.jsx');
  const lagen = lees('../ui/panels/layers.js');
  const css = lees('../../styles/panels.css');
  const vinkje = paneel.slice(paneel.indexOf('<input'), paneel.indexOf('/>', paneel.indexOf('<input')));
  // Alleen een vergrendelde laag (/Locked, #377) heeft een grijs vinkje.
  assert.match(vinkje, /disabled=\{!!layer\.locked\}/, 'het vinkje is alleen bij /Locked alleen-lezen');
  assert.match(vinkje, /onChange=\{\(e\) => wissel\(layer, e\.currentTarget\.checked\)\}/);
  assert.match(paneel, /m\.toggleLayer\(layer\.id, zichtbaar\)/);
  assert.match(lagen, /export async function toggleLayer\(id, zichtbaar\)/);
  assert.match(lagen, /zetLaagZichtbaar\(activeDoc, id, zichtbaar\)/);
  const regel = css.slice(css.indexOf('.layer-list-item input[type="checkbox"] {'));
  assert.match(regel.slice(0, regel.indexOf('}')), /cursor: default/);
});
