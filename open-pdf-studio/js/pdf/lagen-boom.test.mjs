// De lagenboom uit het bestand (#377): /Order met geneste lagen en labels,
// /Locked, /RBGroups en de beginstand; en het bewaren van een laagstand als
// standaardconfiguratie (/D /ON /OFF), teruggelezen door pdf.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import {
  leesLagenBoom, schrijfStandaardLaagstand, pdfjsIdVanRef,
  annotatieLaagIdVoorOcg, ocgVoorAnnotatieLaagId, refVanPdfjsId,
} from './lagen-boom.js';
import { lagenLijst } from '../ui/panels/lagen-lijst.js';

const N = PDFName.of;

/**
 * Een CAD-achtige tekening:
 *   Order [ Gebouw [ Wanden Deuren ]  (Maatvoering) Maten1 Maten2  [ Los ] ]
 *   Gebouw heeft Wanden en Deuren onder zich (array zonder label na een laag);
 *   Maatvoering is een label; Los staat in een array zonder label en zonder
 *   laag ervoor. Variant A/B is een keuzegroep; Stramien is vergrendeld en
 *   staat niet in /Order.
 */
async function tekening({ baseState = null } = {}) {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const ctx = pdf.context;
  const laag = (naam) => ctx.register(ctx.obj({ Type: 'OCG', Name: naam }));
  const r = {
    gebouw: laag(PDFString.of('Gebouw')),
    wanden: laag(PDFHexString.fromText('Wanden – bestaand')),
    deuren: laag(PDFString.of('Deuren')),
    maten1: laag(PDFString.of('Maten 1:50')),
    maten2: laag(PDFString.of('Maten 1:100')),
    los: laag(PDFString.of('Los')),
    variantA: laag(PDFString.of('Variant A')),
    variantB: laag(PDFString.of('Variant B')),
    stramien: laag(PDFString.of('Stramien')),
  };
  const order = ctx.obj([
    r.gebouw,
    ctx.obj([r.wanden, r.deuren]),
    ctx.obj([PDFString.of('Maatvoering'), r.maten1, r.maten2]),
    ctx.obj([r.los]),
    ctx.obj([PDFString.of('Varianten'), r.variantA, r.variantB]),
  ]);
  const d = ctx.obj({
    Order: order,
    OFF: [r.maten2, r.variantB],
    Locked: [r.stramien],
    RBGroups: [[r.variantA, r.variantB]],
  });
  if (baseState) d.set(N('BaseState'), N(baseState));
  if (baseState === 'OFF') d.set(N('ON'), ctx.obj([r.gebouw, r.wanden, r.variantA]));
  pdf.catalog.set(N('OCProperties'), ctx.obj({ OCGs: Object.values(r), D: d }));
  const ids = Object.fromEntries(Object.entries(r).map(([k, ref]) => [k, pdfjsIdVanRef(ref)]));
  return { pdf, bytes: await pdf.save(), ids };
}

async function pdfjsConfig(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  return { doc, config: await doc.getOptionalContentConfig() };
}

test('id-vormen: pdf.js-id, objectverwijzing en annotatielaag-id', () => {
  assert.deepEqual(refVanPdfjsId('12R'), { nummer: 12, generatie: 0 });
  assert.deepEqual(refVanPdfjsId('12R3'), { nummer: 12, generatie: 3 });
  assert.equal(refVanPdfjsId('x'), null);
  assert.equal(annotatieLaagIdVoorOcg('12R'), 'ocg-12-0');
  assert.equal(annotatieLaagIdVoorOcg('12R3'), 'ocg-12-3');
  assert.equal(ocgVoorAnnotatieLaagId('ocg-12-0'), '12R');
  assert.equal(ocgVoorAnnotatieLaagId('ocg-12-3'), '12R3');
  assert.equal(ocgVoorAnnotatieLaagId('default'), null);
  assert.equal(ocgVoorAnnotatieLaagId('l123'), null);
});

test('de boom volgt /Order: lagen onder een laag, labels en een losse array', async () => {
  const { pdf, ids } = await tekening();
  const boom = leesLagenBoom(await PDFDocument.load(await pdf.save()));
  assert.deepEqual(boom.order, [
    { id: ids.gebouw, children: [{ id: ids.wanden, children: [] }, { id: ids.deuren, children: [] }] },
    { label: 'Maatvoering', children: [{ id: ids.maten1, children: [] }, { id: ids.maten2, children: [] }] },
    { id: ids.los, children: [] },
    { label: 'Varianten', children: [{ id: ids.variantA, children: [] }, { id: ids.variantB, children: [] }] },
  ]);
  assert.equal(boom.ocgs.get(ids.wanden).name, 'Wanden – bestaand');
  assert.deepEqual([...boom.locked], [ids.stramien]);
  assert.deepEqual(boom.rbGroups, [[ids.variantA, ids.variantB]]);
});

test('beginstand: /BaseState ON met /OFF, en /BaseState OFF met /ON', async () => {
  const aan = leesLagenBoom((await tekening()).pdf);
  const { ids } = await tekening();
  assert.equal(aan.begin.get(ids.gebouw), true);
  assert.equal(aan.begin.get(ids.maten2), false);
  assert.equal(aan.begin.get(ids.variantB), false);

  const uitDoc = await tekening({ baseState: 'OFF' });
  const uit = leesLagenBoom(uitDoc.pdf);
  assert.equal(uit.begin.get(uitDoc.ids.gebouw), true);
  assert.equal(uit.begin.get(uitDoc.ids.wanden), true);
  assert.equal(uit.begin.get(uitDoc.ids.deuren), false, 'BaseState OFF en niet in /ON');
  assert.equal(uit.begin.get(uitDoc.ids.variantA), true);
});

test('de beginstand van de boom is die van pdf.js (en dus van een lezer die /D volgt)', async () => {
  for (const baseState of [null, 'OFF']) {
    const { pdf, bytes } = await tekening({ baseState });
    const boom = leesLagenBoom(pdf);
    const { doc, config } = await pdfjsConfig(bytes);
    try {
      for (const [id, groep] of config) assert.equal(boom.begin.get(id), groep.visible, `${baseState}: ${id}`);
    } finally {
      await doc.loadingTask.destroy();
    }
  }
});

test('het paneel met de boom: inspringing, koppen, slot en keuzegroep', async () => {
  const { bytes, pdf, ids } = await tekening();
  const boom = leesLagenBoom(pdf);
  const { doc, config } = await pdfjsConfig(bytes);
  try {
    assert.deepEqual(lagenLijst(config, { boom }), [
      { id: ids.gebouw, name: 'Gebouw', visible: true, depth: 0 },
      { id: ids.wanden, name: 'Wanden – bestaand', visible: true, depth: 1 },
      { id: ids.deuren, name: 'Deuren', visible: true, depth: 1 },
      { kop: true, name: 'Maatvoering', depth: 0 },
      { id: ids.maten1, name: 'Maten 1:50', visible: true, depth: 1 },
      { id: ids.maten2, name: 'Maten 1:100', visible: false, depth: 1 },
      { id: ids.los, name: 'Los', visible: true, depth: 0 },
      { kop: true, name: 'Varianten', depth: 0 },
      { id: ids.variantA, name: 'Variant A', visible: true, depth: 1, radio: true },
      { id: ids.variantB, name: 'Variant B', visible: false, depth: 1, radio: true },
      // Niet in /Order: achteraan, vergrendeld.
      { id: ids.stramien, name: 'Stramien', visible: true, depth: 0, locked: true },
    ]);
    // Zonder boom (pdf.js alleen) vallen Wanden en Deuren uit de boom.
    const zonder = lagenLijst(config);
    assert.equal(zonder.find((r) => r.id === ids.wanden).depth, 0);
    // Een overgeslagen laag (markeringslaag van de app) laat zijn kinderen staan.
    const overgeslagen = lagenLijst(config, { boom, overslaan: new Set([ids.gebouw]) });
    assert.equal(overgeslagen[0].id, ids.wanden);
    assert.equal(overgeslagen[0].depth, 0);
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('keuzegroep: een laag aanzetten zet de andere uit (de stand die het paneel toont)', async () => {
  const { bytes, pdf, ids } = await tekening();
  const boom = leesLagenBoom(pdf);
  const { doc, config } = await pdfjsConfig(bytes);
  try {
    config.setVisibility(ids.variantB, true);
    const regels = lagenLijst(config, { boom });
    assert.equal(regels.find((r) => r.id === ids.variantB).visible, true);
    assert.equal(regels.find((r) => r.id === ids.variantA).visible, false);
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('een laagstand bewaren als standaard: pdf.js leest hem terug, /Order en /Locked blijven', async () => {
  for (const baseState of [null, 'OFF']) {
    const { bytes, ids } = await tekening({ baseState });
    const pdf = await PDFDocument.load(bytes);
    const stand = new Map([
      [ids.gebouw, false], [ids.wanden, true], [ids.deuren, true], [ids.maten1, true],
      [ids.maten2, true], [ids.los, false], [ids.variantA, false], [ids.variantB, true], [ids.stramien, true],
    ]);
    assert.equal(schrijfStandaardLaagstand(pdf, stand), true);
    const opgeslagen = await pdf.save();
    const { doc, config } = await pdfjsConfig(opgeslagen);
    try {
      for (const [id, zichtbaar] of stand) assert.equal(config.getGroup(id).visible, zichtbaar, `${baseState}: ${id}`);
    } finally {
      await doc.loadingTask.destroy();
    }
    const terug = leesLagenBoom(await PDFDocument.load(opgeslagen));
    assert.deepEqual([...terug.locked], [ids.stramien]);
    assert.equal(terug.order[0].children.length, 2);
    // Tweede keer dezelfde stand: niets te doen.
    const nogmaals = await PDFDocument.load(opgeslagen);
    assert.equal(schrijfStandaardLaagstand(nogmaals, stand), false);
  }
});

test('alleen de genoemde lagen veranderen; andere vermeldingen in /OFF blijven', async () => {
  const { bytes, ids } = await tekening();
  const pdf = await PDFDocument.load(bytes);
  schrijfStandaardLaagstand(pdf, new Map([[ids.gebouw, false]]));
  const terug = leesLagenBoom(await PDFDocument.load(await pdf.save()));
  assert.equal(terug.begin.get(ids.gebouw), false);
  assert.equal(terug.begin.get(ids.maten2), false, 'niet genoemd: blijft uit');
  assert.equal(terug.begin.get(ids.variantB), false);
});

test('geen lagen: geen boom en niets te schrijven', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  assert.equal(leesLagenBoom(pdf), null);
  assert.equal(schrijfStandaardLaagstand(pdf, new Map([['1R', false]])), false);
});
