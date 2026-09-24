// Annotatielagen in de PDF (#468). Per laag een optional content group; de
// annotaties krijgen /OC, de lagen staan in /OCProperties van de catalog, en
// wat een OCG niet kan uitdrukken (kleur, vergrendeld, afdrukbaar voor deze
// app, volgorde, huidige laag) staat in eigen OPS_-sleutels. Een document
// zonder lagen wordt byte-voor-byte hetzelfde weggeschreven.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } from 'pdf-lib';

import {
  LAGEN_CATALOGUS_SLEUTEL,
  schrijfAnnotatieLagen,
  leesAnnotatieLagen,
  ocVoorAnnotatie,
  laagVanOc,
  pasGelezenLagenToe,
} from './annotatie-lagen.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { DEFAULT_LAYER_ID, addLayer, ensureLayers, updateLayer, setCurrentLayer, getLayers } from '../../annotations/annotatie-lagen.js';

const LAAD = { updateMetadata: false };

async function kalePdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([595, 842]);
  return doc.save();
}

/** Een tekening met eigen lagen, zoals een CAD-export ze schrijft. */
async function cadPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([595, 842]);
  const c = doc.context;
  const maat = c.register(c.obj({ Type: 'OCG', Name: 'MAATVOERING' }));
  const raster = c.register(c.obj({ Type: 'OCG', Name: 'RASTER' }));
  doc.catalog.set(PDFName.of('OCProperties'), c.obj({
    OCGs: [maat, raster],
    D: { Name: 'Tekening', Order: [maat, [raster]], OFF: [raster] },
  }));
  return { bytes: await doc.save(), maat, raster };
}

function modelMetDrieLagen() {
  const doc = { annotations: [] };
  ensureLayers(doc);
  const constructie = addLayer(doc, { name: 'Constructie', color: '#ff0000' }).layer;
  const opdrachtgever = addLayer(doc, { name: 'Opdrachtgever', locked: true }).layer;
  const ronde2 = addLayer(doc, { name: 'Ronde 2', visible: false, printable: false }).layer;
  setCurrentLayer(doc, opdrachtgever.id);
  return { doc, constructie, opdrachtgever, ronde2 };
}

const ocProps = (pdf) => pdf.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
const lijst = (dict, sleutel) => {
  const v = dict?.lookup(PDFName.of(sleutel));
  return v instanceof PDFArray ? v.asArray() : [];
};
const naamVan = (pdf, ref) => pdf.context.lookup(ref).lookup(PDFName.of('Name')).decodeText();

// --- geen lagen: niets verandert ---------------------------------------------

test('zonder lagen blijft een kaal bestand byte-voor-byte gelijk', async () => {
  const bytes = await kalePdf();
  const zonder = await (await PDFDocument.load(bytes, LAAD)).save();
  const pdf = await PDFDocument.load(bytes, LAAD);
  assert.equal(schrijfAnnotatieLagen(pdf, null), null);
  const met = await pdf.save();
  assert.deepEqual(Buffer.from(met), Buffer.from(zonder));
});

test('zonder lagen blijft een tekening met eigen /OCProperties byte-voor-byte gelijk', async () => {
  const { bytes } = await cadPdf();
  const zonder = await (await PDFDocument.load(bytes, LAAD)).save();
  const pdf = await PDFDocument.load(bytes, LAAD);
  assert.equal(schrijfAnnotatieLagen(pdf, null), null);
  assert.deepEqual(Buffer.from(await pdf.save()), Buffer.from(zonder));
});

test('ocVoorAnnotatie geeft niets zonder lagen', () => {
  assert.equal(ocVoorAnnotatie(null, { layer: 'x' }), null);
});

// --- schrijven --------------------------------------------------------------

test('per laag een OCG met naam, en de lagen in /OCProperties', async () => {
  const { doc, constructie, opdrachtgever, ronde2 } = modelMetDrieLagen();
  const pdf = await PDFDocument.load(await kalePdf(), LAAD);
  const refs = schrijfAnnotatieLagen(pdf, getLayers(doc), { standaardNaam: 'Standaard', huidigeLaag: opdrachtgever.id });
  assert.equal(refs.size, 4);
  for (const ref of refs.values()) assert.ok(ref instanceof PDFRef);

  const oc = ocProps(pdf);
  assert.deepEqual(lijst(oc, 'OCGs').map((r) => naamVan(pdf, r)), ['Standaard', 'Constructie', 'Opdrachtgever', 'Ronde 2']);
  const d = oc.lookup(PDFName.of('D'), PDFDict);
  assert.deepEqual(lijst(d, 'Order').map((r) => naamVan(pdf, r)), ['Standaard', 'Constructie', 'Opdrachtgever', 'Ronde 2']);
  assert.deepEqual(lijst(d, 'OFF'), [refs.get(ronde2.id)], 'een uitgezette laag staat uit, ook in andere lezers');

  // Wat een OCG niet kan uitdrukken, in eigen sleutels op de OCG zelf.
  const ocg = (id) => pdf.context.lookup(refs.get(id));
  assert.equal(ocg(constructie.id).lookup(PDFName.of('OPS_LayerId')).decodeText(), constructie.id);
  assert.equal(ocg(constructie.id).lookup(PDFName.of('OPS_Color')).decodeText(), '#ff0000');
  assert.equal(String(ocg(opdrachtgever.id).get(PDFName.of('OPS_Locked'))), 'true');
  assert.equal(String(ocg(ronde2.id).get(PDFName.of('OPS_Printable'))), 'false');
  assert.equal(ocg(DEFAULT_LAYER_ID).lookup(PDFName.of('OPS_LayerId')).decodeText(), DEFAULT_LAYER_ID);

  // Niet afdrukbaar ook in de standaardvorm: /Usage /Print en een /AS-regel.
  const usage = ocg(ronde2.id).lookup(PDFName.of('Usage'), PDFDict);
  assert.equal(String(usage.lookup(PDFName.of('Print'), PDFDict).get(PDFName.of('PrintState'))), '/OFF');
  const as = lijst(d, 'AS').map((r) => pdf.context.lookup(r) || r);
  assert.equal(as.length, 1);
  assert.equal(String(as[0].get(PDFName.of('Event'))), '/Print');
  assert.deepEqual(lijst(as[0], 'OCGs'), [refs.get(ronde2.id)]);
  assert.equal(ocg(constructie.id).get(PDFName.of('Usage')), undefined);

  // Volgorde en huidige laag in de catalog.
  const eigen = pdf.catalog.lookup(PDFName.of(LAGEN_CATALOGUS_SLEUTEL), PDFDict);
  assert.deepEqual(lijst(eigen, 'Layers'), [...refs.values()]);
  assert.equal(eigen.lookup(PDFName.of('Current')).decodeText(), opdrachtgever.id);
});

test('een annotatie krijgt de OCG van haar laag; een onbekende die van de standaardlaag', async () => {
  const { doc, constructie } = modelMetDrieLagen();
  const pdf = await PDFDocument.load(await kalePdf(), LAAD);
  const refs = schrijfAnnotatieLagen(pdf, getLayers(doc), { standaardNaam: 'Standaard' });
  assert.equal(ocVoorAnnotatie(refs, { layer: constructie.id }), refs.get(constructie.id));
  assert.equal(ocVoorAnnotatie(refs, {}), refs.get(DEFAULT_LAYER_ID));
  assert.equal(ocVoorAnnotatie(refs, { layer: 'weg' }), refs.get(DEFAULT_LAYER_ID));
});

// --- de rondgang ------------------------------------------------------------

async function rondgang(model, opties = {}, basis = null) {
  const pdf = await PDFDocument.load(basis || await kalePdf(), LAAD);
  const refs = schrijfAnnotatieLagen(pdf, getLayers(model), { standaardNaam: 'Standaard', ...opties });
  // Eén annotatie per laag, met /OC — zoals de saver dat doet.
  const pagina = pdf.getPages()[0];
  const annots = [];
  let x = 10;
  for (const laag of getLayers(model)) {
    const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [x, 10, x + 20, 30] });
    dict.set(PDFName.of('OC'), ocVoorAnnotatie(refs, { layer: laag.id }));
    annots.push(pdf.context.register(dict));
    x += 40;
  }
  pagina.node.set(PDFName.of('Annots'), pdf.context.obj(annots));
  return PDFDocument.load(await pdf.save(), LAAD);
}

test('opslaan en heropenen: namen, volgorde, schakelaars, kleur en huidige laag', async () => {
  const { doc, opdrachtgever } = modelMetDrieLagen();
  const heropend = await rondgang(doc, { huidigeLaag: opdrachtgever.id });
  const gelezen = leesAnnotatieLagen(heropend);
  assert.deepEqual(gelezen.lagen, getLayers(doc));
  assert.equal(gelezen.huidigeLaag, opdrachtgever.id);
});

test('de verdeling over de lagen komt terug via /OC', async () => {
  const { doc } = modelMetDrieLagen();
  const heropend = await rondgang(doc);
  const kaart = await extractAnnotationColors(1, heropend);
  const perRect = [...kaart.entries()].sort((a, b) => Number(a[0].split(',')[0]) - Number(b[0].split(',')[0]));
  assert.deepEqual(perRect.map(([, extra]) => extra.layer), getLayers(doc).map((l) => l.id));
});

test('een naam buiten ASCII overleeft de rondgang', async () => {
  const doc = { annotations: [] };
  addLayer(doc, { name: 'Wijziging → ronde ②' });
  const gelezen = leesAnnotatieLagen(await rondgang(doc));
  assert.equal(gelezen.lagen[1].name, 'Wijziging → ronde ②');
});

// --- bestaande /OCProperties uit een tekening --------------------------------

test('lagen van de tekening blijven staan; de annotatielagen komen erbij', async () => {
  const { bytes, maat, raster } = await cadPdf();
  const { doc, ronde2 } = modelMetDrieLagen();
  const pdf = await PDFDocument.load(bytes, LAAD);
  const refs = schrijfAnnotatieLagen(pdf, getLayers(doc), { standaardNaam: 'Standaard' });
  const oc = ocProps(pdf);
  const ocgs = lijst(oc, 'OCGs');
  assert.deepEqual(ocgs.slice(0, 2), [maat, raster], 'de tekeninglagen eerst, ongewijzigd');
  assert.equal(ocgs.length, 6);
  const d = oc.lookup(PDFName.of('D'), PDFDict);
  assert.equal(d.lookup(PDFName.of('Name')).decodeText(), 'Tekening');
  const order = lijst(d, 'Order');
  assert.equal(order[0], maat);
  assert.ok(order[1] instanceof PDFArray, 'de geneste groep van de tekening blijft genest');
  assert.deepEqual(order.slice(2), [...refs.values()]);
  assert.deepEqual(lijst(d, 'OFF'), [raster, refs.get(ronde2.id)]);
  // Het terugschrijven kent de tekeninglagen niet als annotatielagen.
  const gelezen = leesAnnotatieLagen(await PDFDocument.load(await pdf.save(), LAAD));
  assert.deepEqual(gelezen.lagen.map((l) => l.name), ['', 'Constructie', 'Opdrachtgever', 'Ronde 2']);
});

test('een tekening met /BaseState /OFF: zichtbare annotatielagen staan in /ON', async () => {
  const pdf0 = await PDFDocument.create({ updateMetadata: false });
  pdf0.addPage([100, 100]);
  const c = pdf0.context;
  const vreemd = c.register(c.obj({ Type: 'OCG', Name: 'X' }));
  pdf0.catalog.set(PDFName.of('OCProperties'), c.obj({ OCGs: [vreemd], D: { BaseState: 'OFF', ON: [vreemd] } }));
  const { doc, ronde2, constructie } = modelMetDrieLagen();
  const pdf = await PDFDocument.load(await pdf0.save(), LAAD);
  const refs = schrijfAnnotatieLagen(pdf, getLayers(doc), { standaardNaam: 'Standaard' });
  const d = ocProps(pdf).lookup(PDFName.of('D'), PDFDict);
  const aan = lijst(d, 'ON');
  assert.ok(aan.includes(refs.get(constructie.id)));
  assert.ok(!aan.includes(refs.get(ronde2.id)));
  assert.ok(aan.includes(vreemd), 'de vreemde laag blijft aan');
  const gelezen = leesAnnotatieLagen(await PDFDocument.load(await pdf.save(), LAAD));
  assert.equal(gelezen.lagen.find((l) => l.id === ronde2.id).visible, false);
  assert.equal(gelezen.lagen.find((l) => l.id === constructie.id).visible, true);
});

// --- nogmaals opslaan ---------------------------------------------------------

test('opnieuw opslaan hergebruikt de OCG per laag en ruimt verwijderde lagen op', async () => {
  const { doc, constructie, ronde2 } = modelMetDrieLagen();
  const eerste = await rondgang(doc);
  const oudeRef = [...leesAnnotatieLagen(eerste).refs.entries()].find(([id]) => id === constructie.id)[1];

  // Ronde 2 weg, Constructie hernoemd en uitgezet.
  doc.annotationLayers = getLayers(doc).filter((l) => l.id !== ronde2.id);
  doc.annotationLayers.find((l) => l.id === constructie.id).name = 'Draagconstructie';
  updateLayer(doc, constructie.id, { visible: false });
  const refs = schrijfAnnotatieLagen(eerste, getLayers(doc), { standaardNaam: 'Standaard' });
  assert.equal(refs.get(constructie.id), oudeRef, 'dezelfde OCG, geen nieuwe');

  const oc = ocProps(eerste);
  const ocgs = lijst(oc, 'OCGs');
  assert.equal(ocgs.length, 3, 'geen dubbele en geen verwijderde lagen');
  assert.equal(new Set(ocgs.map(String)).size, 3);
  const d = oc.lookup(PDFName.of('D'), PDFDict);
  assert.deepEqual(lijst(d, 'OFF'), [oudeRef]);
  assert.equal(lijst(d, 'Order').length, 3);
  assert.equal(lijst(d, 'AS').length, 0, 'geen niet-afdrukbare laag meer: geen /AS-regel');
  assert.equal(naamVan(eerste, oudeRef), 'Draagconstructie');
});

test('alle lagen weg: eigen OCGs en de catalogsleutel verdwijnen, de tekening blijft', async () => {
  const kaal = await rondgang(modelMetDrieLagen().doc);
  assert.equal(schrijfAnnotatieLagen(kaal, null), null);
  assert.equal(kaal.catalog.get(PDFName.of('OCProperties')), undefined, 'alleen eigen lagen: /OCProperties weg');
  assert.equal(kaal.catalog.get(PDFName.of(LAGEN_CATALOGUS_SLEUTEL)), undefined);

  const { bytes, maat, raster } = await cadPdf();
  const cad = await rondgang(modelMetDrieLagen().doc, {}, bytes);
  schrijfAnnotatieLagen(cad, null);
  const oc = ocProps(cad);
  assert.deepEqual(lijst(oc, 'OCGs'), [maat, raster]);
  const d = oc.lookup(PDFName.of('D'), PDFDict);
  assert.deepEqual(lijst(d, 'OFF'), [raster]);
  assert.equal(lijst(d, 'Order').length, 2);
  assert.equal(leesAnnotatieLagen(cad), null);
});

// --- lezen ------------------------------------------------------------------

test('een bestand zonder annotatielagen levert niets', async () => {
  assert.equal(leesAnnotatieLagen(await PDFDocument.load(await kalePdf(), LAAD)), null);
  assert.equal(leesAnnotatieLagen(await PDFDocument.load((await cadPdf()).bytes, LAAD)), null);
});

test('/OC naar een vreemde OCG is geen annotatielaag', async () => {
  const { bytes, maat } = await cadPdf();
  const pdf = await PDFDocument.load(bytes, LAAD);
  assert.equal(laagVanOc(pdf.context, maat), undefined);
  assert.equal(laagVanOc(pdf.context, undefined), undefined);
});

test('de ids die pdf.js aan de eigen OCGs geeft, om ze uit de tekeninglagen te houden', async () => {
  const heropend = await rondgang(modelMetDrieLagen().doc);
  const gelezen = leesAnnotatieLagen(heropend);
  const verwacht = [...gelezen.refs.values()].map((r) => (r.generationNumber ? `${r.objectNumber}R${r.generationNumber}` : `${r.objectNumber}R`));
  assert.deepEqual([...gelezen.ocgIds].sort(), verwacht.sort());
});

test('gelezen lagen komen op het document, één keer, en niet over eigen werk heen', () => {
  const gelezen = { lagen: [{ id: DEFAULT_LAYER_ID, name: '' }, { id: 'a', name: 'A', visible: false }], huidigeLaag: 'a', ocgIds: new Set(['5R']) };
  const doc = { annotations: [] };
  assert.equal(pasGelezenLagenToe(doc, gelezen), true);
  assert.deepEqual(getLayers(doc).map((l) => l.id), [DEFAULT_LAYER_ID, 'a']);
  assert.equal(doc.currentLayerId, 'a');
  assert.deepEqual([...doc._annotatieLaagOcgIds], ['5R']);
  // Een tweede lezing (na een herlaad van de bytes) laat het model met rust.
  doc.annotationLayers[1].name = 'Hernoemd';
  assert.equal(pasGelezenLagenToe(doc, { ...gelezen, lagen: [{ id: 'b', name: 'B' }] }), false);
  assert.equal(getLayers(doc)[1].name, 'Hernoemd');
  // Wie al lagen maakte voordat het bestand gelezen was, houdt ze.
  const vlug = { annotations: [] };
  addLayer(vlug, { name: 'Eigen' });
  assert.equal(pasGelezenLagenToe(vlug, gelezen), false);
  assert.deepEqual(getLayers(vlug).map((l) => l.name), ['', 'Eigen']);
  // Niets gelezen: alleen gemarkeerd.
  const leeg = { annotations: [] };
  assert.equal(pasGelezenLagenToe(leeg, null), false);
  assert.equal(leeg._annotatieLagenGelezen, true);
});

// --- de aansluiting in saver, lader en het paneel met tekeninglagen ------------
// saver.js en loader.js draaien niet onder kale node (DOM, Tauri, state); dit
// zijn vangrails op de bron voor de plekken waar de module hierboven aanhaakt.

import { readFileSync } from 'node:fs';
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('de saver schrijft de lagen één keer en zet /OC vlak voor de annotatie de pagina in gaat', () => {
  const saver = bron('../saver.js');
  assert.equal((saver.match(/schrijfAnnotatieLagen\(pdfDocLib, layersForSave\(/g) || []).length, 1);
  const kern = saver.slice(saver.indexOf('// Add annotation to page'), saver.indexOf('annotsArray.push(parentAnnotRef);'));
  assert.match(kern, /const ocRef = ocVoorAnnotatie\(laagOcgs, ann\);/);
  assert.match(kern, /if \(ocRef && typeof annotDict\.set === 'function'\) annotDict\.set\(PDFName\.of\('OC'\), ocRef\);/);
  // De aanhaallijnen van een tekstvak horen bij dezelfde laag.
  assert.match(saver, /ldrDict\.set\(PDFName\.of\('OC'\), ocRef\)/);
});

test('de lader leest de lagen zodra het pdf-lib-document er is, en begint bij elk bestand opnieuw', () => {
  const loader = bron('../loader.js');
  const gedeeld = loader.slice(loader.indexOf('async function getSharedPdfLibDoc('));
  assert.match(gedeeld.slice(0, 1500), /pasGelezenLagenToe\(doc, leesAnnotatieLagen\(pdfLibDoc\)\)/);
  assert.match(loader, /doc\.annotationLayers = \[\];\s*\n\s*doc\.currentLayerId = null;\s*\n\s*doc\._annotatieLagenGelezen = false;/);
});

test('het paneel met de lagen van de tekening toont de annotatielagen niet nog eens', () => {
  const paneel = bron('../../ui/panels/layers.js');
  assert.match(paneel, /_annotatieLaagOcgIds/);
});
