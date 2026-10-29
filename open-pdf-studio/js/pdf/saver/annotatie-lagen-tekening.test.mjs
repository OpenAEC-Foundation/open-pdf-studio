// Een markering op een laag van de tekening (#377): de annotatie krijgt bij
// het opslaan /OC naar de OCG van de tekening zelf, en komt bij het laden op
// die laag terug. De OCG blijft een laag van de tekening: zijn plek in
// /Order, /Locked en /RBGroups blijft, hij blijft in het paneel Lagen, en
// als de annotatielaag verdwijnt, blijft de OCG in het bestand.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFDict, PDFString } from 'pdf-lib';

import {
  schrijfAnnotatieLagen, leesAnnotatieLagen, ocVoorAnnotatie, laagVanOc, laagstandZonderEigenLagen,
} from './annotatie-lagen.js';
import { getLayers } from '../../annotations/annotatie-lagen.js';
import { leesLagenBoom, pdfjsIdVanRef, annotatieLaagIdVoorOcg, schrijfStandaardLaagstand } from '../lagen-boom.js';

const N = PDFName.of;

async function tekening({ deurenUit = false } = {}) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.addPage([400, 300]);
  const c = pdf.context;
  const laag = (naam) => c.register(c.obj({ Type: 'OCG', Name: PDFString.of(naam) }));
  const gebouw = laag('Gebouw');
  const wanden = laag('Wanden');
  const deuren = laag('Deuren');
  pdf.catalog.set(N('OCProperties'), c.obj({
    OCGs: [gebouw, wanden, deuren],
    D: {
      Order: [gebouw, [wanden, deuren]], Locked: [deuren], RBGroups: [[wanden, deuren]],
      ...(deurenUit ? { OFF: [deuren] } : {}),
    },
  }));
  return { bytes: await pdf.save(), ids: { gebouw: pdfjsIdVanRef(gebouw), wanden: pdfjsIdVanRef(wanden), deuren: pdfjsIdVanRef(deuren) } };
}

/** Opslaan zoals saver.js: lagen schrijven, dan /OC op elke annotatie. */
async function slaOp(bytes, lagen, annotaties) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const refs = schrijfAnnotatieLagen(pdf, lagen, { standaardNaam: 'Standaard' });
  const pagina = pdf.getPage(0);
  const annots = [];
  for (const ann of annotaties) {
    const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], NM: PDFString.of(ann.id) });
    const oc = ocVoorAnnotatie(refs, ann);
    if (oc) dict.set(N('OC'), oc);
    annots.push(pdf.context.register(dict));
  }
  pagina.node.set(N('Annots'), pdf.context.obj(annots));
  return { bytes: await pdf.save(), refs };
}

function annotLagen(pdf) {
  const annots = pdf.getPage(0).node.lookup(N('Annots'));
  return annots.asArray().map((r) => {
    const d = pdf.context.lookup(r, PDFDict);
    return [d.lookup(N('NM')).decodeText(), laagVanOc(pdf.context, d.get(N('OC')))];
  });
}

test('annotatie op een laag van de tekening: /OC naar die OCG, en terug bij het laden', async () => {
  const { bytes, ids } = await tekening({ deurenUit: true });
  const laagId = annotatieLaagIdVoorOcg(ids.deuren);
  // In de weergave aangezet om te kijken: geen nieuwe beginstand (#377).
  const lagen = getLayers({ annotationLayers: [{ id: laagId, name: 'Deuren', visible: true }] });
  const { bytes: opgeslagen, refs } = await slaOp(bytes, lagen, [{ id: 'a1', layer: laagId }, { id: 'a2' }]);
  assert.equal(pdfjsIdVanRef(refs.get(laagId)), ids.deuren, 'dezelfde OCG, geen nieuwe');

  const pdf = await PDFDocument.load(opgeslagen, { updateMetadata: false });
  assert.deepEqual(annotLagen(pdf), [['a1', laagId], ['a2', 'default']]);
  const gelezen = leesAnnotatieLagen(pdf);
  assert.ok(gelezen.lagen.some((l) => l.id === laagId && l.name === 'Deuren' && l.visible === false));
  // Een overgenomen OCG blijft in het paneel Lagen; de eigen standaardlaag niet.
  assert.equal(gelezen.ocgIds.has(ids.deuren), false);
  assert.equal(gelezen.ocgIds.size, 1);

  // De boom van de tekening is ongeschonden; de stand komt in /D.
  const boom = leesLagenBoom(pdf);
  assert.deepEqual(boom.order[0], {
    id: ids.gebouw, children: [{ id: ids.wanden, children: [] }, { id: ids.deuren, children: [] }],
  });
  assert.deepEqual([...boom.locked], [ids.deuren]);
  assert.deepEqual(boom.rbGroups, [[ids.wanden, ids.deuren]]);
  assert.equal(boom.begin.get(ids.deuren), false, 'de beginstand van het bestand blijft');
  assert.equal(pdf.catalog.lookup(N('OCProperties'), PDFDict).lookup(N('OCGs')).size(), 4, 'drie lagen + de standaardlaag');

  // pdf.js leest dezelfde stand: de tekeningslaag is uit.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: opgeslagen.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const config = await doc.getOptionalContentConfig();
    assert.equal(config.getGroup(ids.deuren).visible, false);
    assert.equal(config.getGroup(ids.gebouw).visible, true);
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('opnieuw opslaan: dezelfde OCG, nog steeds op zijn plek in de boom', async () => {
  const { bytes, ids } = await tekening();
  const laagId = annotatieLaagIdVoorOcg(ids.wanden);
  const lagen = getLayers({ annotationLayers: [{ id: laagId, name: 'Wanden' }] });
  const een = await slaOp(bytes, lagen, [{ id: 'a1', layer: laagId }]);
  // Bij heropenen is het een eigen laag met hetzelfde id.
  const gelezen = leesAnnotatieLagen(await PDFDocument.load(een.bytes));
  const twee = await slaOp(een.bytes, getLayers({ annotationLayers: gelezen.lagen }), [{ id: 'a1', layer: laagId }]);
  assert.equal(pdfjsIdVanRef(twee.refs.get(laagId)), ids.wanden);
  const pdf = await PDFDocument.load(twee.bytes);
  const boom = leesLagenBoom(pdf);
  assert.equal(boom.order.length, 2, 'Gebouw met kinderen, en de standaardlaag achteraan');
  assert.equal(boom.order[0].children[0].id, ids.wanden);
  assert.deepEqual(annotLagen(pdf), [['a1', laagId]]);
});

test('de annotatielaag weg: de OCG van de tekening blijft, zonder eigen sleutels', async () => {
  const { bytes, ids } = await tekening();
  const laagId = annotatieLaagIdVoorOcg(ids.wanden);
  const een = await slaOp(bytes, getLayers({ annotationLayers: [{ id: laagId, name: 'Wanden' }] }), [{ id: 'a1', layer: laagId }]);
  // Alleen nog de standaardlaag, zonder afwijkingen: de saver krijgt null.
  const twee = await slaOp(een.bytes, null, [{ id: 'a1' }]);
  const pdf = await PDFDocument.load(twee.bytes);
  const boom = leesLagenBoom(pdf);
  assert.deepEqual([...boom.ocgs.keys()], [ids.gebouw, ids.wanden, ids.deuren]);
  assert.equal(boom.order[0].children[0].id, ids.wanden);
  assert.deepEqual([...boom.locked], [ids.deuren]);
  const ocg = pdf.catalog.lookup(N('OCProperties'), PDFDict).lookup(N('OCGs')).asArray()
    .map((r) => pdf.context.lookup(r, PDFDict)).find((d) => d.lookup(N('Name')).decodeText() === 'Wanden');
  assert.equal(ocg.get(N('OPS_LayerId')), undefined);
  assert.equal(leesAnnotatieLagen(pdf), null, 'geen annotatielagen meer');
});

function ocgDict(pdf, naam) {
  return pdf.catalog.lookup(N('OCProperties'), PDFDict).lookup(N('OCGs')).asArray()
    .map((r) => pdf.context.lookup(r, PDFDict)).find((d) => d.lookup(N('Name'))?.decodeText() === naam);
}

test('een overgenomen laag weg terwijl er andere annotatielagen zijn: de laag van de tekening blijft heel', async () => {
  const { bytes, ids } = await tekening({ deurenUit: true });
  const laagId = annotatieLaagIdVoorOcg(ids.wanden);
  const notities = { id: 'l-notities', name: 'Notities' };
  const een = await slaOp(bytes, getLayers({ annotationLayers: [{ id: laagId, name: 'Wanden' }, notities] }),
    [{ id: 'a1', layer: laagId }, { id: 'a2', layer: 'l-notities' }]);
  // Heropenen: de OCG van de tekening heeft nu een eigen id ('ocg-...').
  const gelezen = leesAnnotatieLagen(await PDFDocument.load(een.bytes));
  assert.ok(gelezen.lagen.some((l) => l.id === laagId));
  // De annotatielaag van de tekening gaat weg; Notities blijft.
  const over = gelezen.lagen.filter((l) => l.id !== laagId);
  const twee = await slaOp(een.bytes, getLayers({ annotationLayers: over }), [{ id: 'a2', layer: 'l-notities' }]);

  const pdf = await PDFDocument.load(twee.bytes);
  const boom = leesLagenBoom(pdf);
  assert.ok(boom.ocgs.has(ids.wanden), 'Wanden staat nog in /OCGs');
  assert.equal(boom.ocgs.get(ids.wanden).name, 'Wanden');
  assert.deepEqual(boom.order[0], {
    id: ids.gebouw, children: [{ id: ids.wanden, children: [] }, { id: ids.deuren, children: [] }],
  });
  assert.deepEqual(boom.rbGroups, [[ids.wanden, ids.deuren]]);
  assert.deepEqual([...boom.locked], [ids.deuren]);
  assert.equal(boom.begin.get(ids.wanden), true);
  assert.equal(boom.begin.get(ids.deuren), false);
  assert.equal(ocgDict(pdf, 'Wanden').get(N('OPS_LayerId')), undefined, 'zonder eigen sleutels');
  const terug = leesAnnotatieLagen(pdf);
  assert.deepEqual(terug.lagen.map((l) => l.id).sort(), ['default', 'l-notities']);
});

test('de naam van een overgenomen laag blijft die van de tekening', async () => {
  const { bytes, ids } = await tekening();
  const laagId = annotatieLaagIdVoorOcg(ids.wanden);
  // Zoals moveAnnotationsToDrawingLayer bij een bestaande markeringslaag "Wanden".
  const lagen = getLayers({ annotationLayers: [{ id: 'l-wanden', name: 'Wanden' }, { id: laagId, name: 'Wanden (2)' }] });
  const een = await slaOp(bytes, lagen, [{ id: 'a1', layer: laagId }]);
  let pdf = await PDFDocument.load(een.bytes);
  assert.equal(leesLagenBoom(pdf).ocgs.get(ids.wanden).name, 'Wanden');

  // Ook na hernoemen in het paneel en een tweede save.
  const gelezen = leesAnnotatieLagen(pdf).lagen.map((l) => (l.id === laagId ? { ...l, name: 'Muren' } : l));
  const twee = await slaOp(een.bytes, getLayers({ annotationLayers: gelezen }), [{ id: 'a1', layer: laagId }]);
  pdf = await PDFDocument.load(twee.bytes);
  assert.equal(leesLagenBoom(pdf).ocgs.get(ids.wanden).name, 'Wanden');
  const wanden = pdf.catalog.lookup(N('OCProperties'), PDFDict).lookup(N('OCGs')).asArray()
    .map((r) => pdf.context.lookup(r, PDFDict)).find((d) => pdfjsIdVanRef(pdf.context.getObjectRef(d)) === ids.wanden);
  assert.equal(wanden.lookup(N('OPS_LayerId')).decodeText(), laagId);
});

test('de weergave van een overgenomen laag is geen beginstand; "Als standaard instellen" wel', async () => {
  const { bytes, ids } = await tekening({ deurenUit: true });
  const wandenId = annotatieLaagIdVoorOcg(ids.wanden);
  const deurenId = annotatieLaagIdVoorOcg(ids.deuren);
  // Wanden in de weergave uit, Deuren aan: alleen geschakeld.
  const lagen = getLayers({ annotationLayers: [
    { id: wandenId, name: 'Wanden', visible: false },
    { id: deurenId, name: 'Deuren', visible: true },
    { id: 'l-eigen', name: 'Eigen', visible: false },
  ] });
  const anns = [{ id: 'a1', layer: wandenId }, { id: 'a2', layer: deurenId }, { id: 'a3', layer: 'l-eigen' }];
  const een = await slaOp(bytes, lagen, anns);
  let boom = leesLagenBoom(await PDFDocument.load(een.bytes));
  assert.equal(boom.begin.get(ids.wanden), true);
  assert.equal(boom.begin.get(ids.deuren), false);
  // Een eigen annotatielaag bewaart zijn zichtbaarheid zoals altijd (#468).
  const eigen = leesAnnotatieLagen(await PDFDocument.load(een.bytes)).lagen.find((l) => l.id === 'l-eigen');
  assert.equal(eigen.visible, false);

  // "Als standaard instellen", zoals saver.js: de stand uit het paneel Lagen
  // (pdf.js-ids) zonder de eigen annotatielagen.
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const refs = schrijfAnnotatieLagen(pdf, lagen, { standaardNaam: 'Standaard' });
  const eigenPdfjs = pdfjsIdVanRef(refs.get('l-eigen'));
  const stand = new Map([[ids.gebouw, true], [ids.wanden, false], [ids.deuren, true], [eigenPdfjs, true]]);
  laagstandZonderEigenLagen(stand, refs);
  assert.deepEqual([...stand.keys()].sort(), [ids.gebouw, ids.wanden, ids.deuren].sort(),
    'de overgenomen lagen blijven erin, de eigen laag niet');
  schrijfStandaardLaagstand(pdf, stand);
  const opgeslagen = await pdf.save();
  boom = leesLagenBoom(await PDFDocument.load(opgeslagen));
  assert.equal(boom.begin.get(ids.wanden), false);
  assert.equal(boom.begin.get(ids.deuren), true);
  assert.equal(boom.begin.get(eigenPdfjs), false, 'de eigen laag houdt zijn eigen stand');
});
