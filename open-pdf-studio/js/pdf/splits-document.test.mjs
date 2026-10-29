// Document splitsen (#381) met echte pdf-lib-bestanden: de delen openen weer,
// houden hun annotaties, bladwijzers, paginalabels en draaiingen, en slepen
// geen pagina's van buiten het deel mee (koppelingen naar andere delen).
//
// splits-document.js gebruikt de bladwijzer-schrijver van de saver, die de
// state-store importeert; die draait hier met de laadhaken van de app.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import {
  PDFDocument, StandardFonts, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, degrees,
} from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  laadBron, bouwDeel, deelBytes, berekenDelen, maakDelen,
} = await import('./splits-document.js');

const BLADWIJZERS = [
  { id: 'a', title: 'Inleiding', page: 1, parentId: null, sortOrder: 0, expanded: true },
  { id: 'a1', title: 'Doel', page: 2, parentId: 'a', sortOrder: 0, expanded: true },
  { id: 'b', title: 'Constructie', page: 4, parentId: null, sortOrder: 1, expanded: true },
  { id: 'b1', title: 'Fundering', page: 6, parentId: 'b', sortOrder: 0, expanded: true },
  { id: 'c', title: 'Bijlagen: tekeningen', page: 8, parentId: null, sortOrder: 2, expanded: true },
];

// Tien pagina's met hun nummer als tekst, een notitie op 3 en 7 (met /P),
// een koppeling op 2 naar 3 (in hetzelfde deel bij 3 per deel) en op 5 naar 9
// (een ander deel), en een eigen /Rotate op pagina 4.
async function bronBytes() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = [];
  for (let i = 1; i <= 10; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`PAGINA-${i}`, { x: 40, y: 500, size: 20, font });
    paginas.push(p);
  }
  paginas[3].setRotation(degrees(90));
  const ctx = doc.context;
  const voegToe = (pagina, dict) => {
    const ref = ctx.register(ctx.obj(dict));
    let annots = pagina.node.lookup(PDFName.of('Annots'), PDFArray);
    if (!annots) {
      annots = ctx.obj([]);
      pagina.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
    return ref;
  };
  for (const i of [2, 6]) {
    voegToe(paginas[i], {
      Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], Contents: PDFString.of(`notitie ${i + 1}`), P: paginas[i].ref,
    });
  }
  voegToe(paginas[1], {
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30], Dest: [paginas[2].ref, PDFName.of('Fit')], P: paginas[1].ref,
  });
  voegToe(paginas[4], {
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
    A: ctx.obj({ S: 'GoTo', D: [paginas[8].ref, PDFName.of('Fit')] }), P: paginas[4].ref,
  });
  return new Uint8Array(await doc.save());
}

function annotaties(doc, pagina) {
  const annots = pagina.node.lookup(PDFName.of('Annots'), PDFArray);
  if (!annots) return [];
  return annots.asArray().map((r) => doc.context.lookup(r, PDFDict));
}

function subtype(a) {
  return a.get(PDFName.of('Subtype'))?.decodeText();
}

function paginaObjecten(doc) {
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Page')) n++;
  }
  return n;
}

function tekstVan(waarde) {
  if (waarde instanceof PDFString || waarde instanceof PDFHexString) return waarde.decodeText();
  return String(waarde);
}

// De bladwijzers op het hoogste niveau: titel, paginanummer (vanaf 1) en het aantal kinderen.
function bovensteOutline(doc) {
  const ctx = doc.context;
  const catalogus = ctx.lookup(ctx.trailerInfo.Root, PDFDict);
  const outlines = catalogus.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!outlines) return [];
  const refs = doc.getPages().map((p) => p.ref);
  const uit = [];
  let item = outlines.lookupMaybe(PDFName.of('First'), PDFDict);
  while (item) {
    const dest = item.lookup(PDFName.of('Dest'), PDFArray);
    let kinderen = 0;
    let kind = item.lookupMaybe(PDFName.of('First'), PDFDict);
    while (kind) { kinderen++; kind = kind.lookupMaybe(PDFName.of('Next'), PDFDict); }
    uit.push({ titel: tekstVan(item.get(PDFName.of('Title'))), pagina: refs.indexOf(dest.get(0)) + 1, kinderen });
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return uit;
}

async function heropen(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc;
}

test('elke 3 pagina\'s: 4 delen die weer openen, met de juiste pagina\'s', async () => {
  const bron = await laadBron(await bronBytes());
  const delen = await berekenDelen(bron, { modus: 'pages', n: 3 });
  assert.deepEqual(delen.map((d) => [d.start, d.eind]), [[1, 3], [4, 6], [7, 9], [10, 10]]);
  const uit = await maakDelen(bron, delen, {});
  assert.equal(uit.length, 4);
  for (const [i, d] of uit.entries()) {
    const doc = await heropen(d.bytes);
    assert.equal(doc.getPageCount(), delen[i].eind - delen[i].start + 1);
    assert.equal(paginaObjecten(doc), doc.getPageCount(), `deel ${i + 1}: geen meegesleepte pagina's`);
  }
});

test('annotaties gaan mee en wijzen naar hun eigen pagina', async () => {
  const bron = await laadBron(await bronBytes());
  const doc = await heropen(await deelBytes(bron, { start: 1, eind: 3 }));
  const derde = doc.getPage(2);
  const notities = annotaties(doc, derde).filter((a) => subtype(a) === 'Text');
  assert.equal(notities.length, 1);
  assert.equal(notities[0].get(PDFName.of('P')), derde.ref);
  assert.equal(tekstVan(notities[0].get(PDFName.of('Contents'))), 'notitie 3');
});

test('een koppeling binnen het deel wijst naar de pagina in het deel; naar buiten valt ze weg', async () => {
  const bron = await laadBron(await bronBytes());
  const eerste = await heropen(await deelBytes(bron, { start: 1, eind: 3 }));
  const links = annotaties(eerste, eerste.getPage(1)).filter((a) => subtype(a) === 'Link');
  assert.equal(links.length, 1);
  const dest = links[0].lookup(PDFName.of('Dest'), PDFArray);
  assert.equal(dest.get(0), eerste.getPage(2).ref);

  const tweede = await heropen(await deelBytes(bron, { start: 4, eind: 6 }));
  assert.equal(annotaties(tweede, tweede.getPage(1)).filter((a) => subtype(a) === 'Link').length, 0);
  assert.equal(paginaObjecten(tweede), 3, 'pagina 9 is niet meegekopieerd');
});

test('eigen /Rotate en de draaiing van de app tellen op', async () => {
  const bron = await laadBron(await bronBytes());
  const doc = await heropen(await deelBytes(bron, { start: 4, eind: 6, rotaties: { 4: 90, 5: 270 } }));
  assert.equal(doc.getPage(0).getRotation().angle, 180, 'pagina 4: 90 in het bestand + 90 in de app');
  assert.equal(doc.getPage(1).getRotation().angle, 270);
  assert.equal(doc.getPage(2).getRotation().angle, 0);
});

test('paginalabels: het stuk van het deel als /PageLabels', async () => {
  const bron = await laadBron(await bronBytes());
  const labels = ['i', 'ii', 'iii', 'iv', '1', '2', '3', 'A-1', 'A-2', 'A-3'];
  const doc = await heropen(await deelBytes(bron, { start: 2, eind: 5, labels }));
  const ctx = doc.context;
  const catalogus = ctx.lookup(ctx.trailerInfo.Root, PDFDict);
  const nums = catalogus.lookup(PDFName.of('PageLabels'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
  // Twee reeksen: 'ii'..'iv' (romeins vanaf 2) op index 0, gewone cijfers op index 3.
  const reeks = (i) => ({ vanaf: nums.get(2 * i).asNumber(), dict: ctx.lookup(nums.get(2 * i + 1), PDFDict) });
  assert.equal(nums.size(), 4);
  assert.equal(reeks(0).vanaf, 0);
  assert.equal(reeks(0).dict.get(PDFName.of('S')), PDFName.of('r'));
  assert.equal(reeks(0).dict.get(PDFName.of('St')).asNumber(), 2);
  assert.equal(reeks(1).vanaf, 3);
  assert.equal(reeks(1).dict.get(PDFName.of('S')), PDFName.of('D'));
  // Zonder labels: geen /PageLabels.
  const zonder = await heropen(await deelBytes(bron, { start: 1, eind: 2 }));
  const cat2 = zonder.context.lookup(zonder.context.trailerInfo.Root, PDFDict);
  assert.equal(cat2.get(PDFName.of('PageLabels')), undefined);
});

test('per bladwijzer: delen met de titel, en hun eigen bladwijzerboom', async () => {
  const bron = await laadBron(await bronBytes());
  const delen = await berekenDelen(bron, { modus: 'bookmarks', bladwijzers: BLADWIJZERS });
  assert.deepEqual(delen.map((d) => [d.start, d.eind, d.titel]), [
    [1, 3, 'Inleiding'], [4, 7, 'Constructie'], [8, 10, 'Bijlagen: tekeningen'],
  ]);
  const uit = await maakDelen(bron, delen, { bladwijzers: BLADWIJZERS });
  const tweede = await heropen(uit[1].bytes);
  assert.deepEqual(bovensteOutline(tweede), [{ titel: 'Constructie', pagina: 1, kinderen: 1 }]);
  const derde = await heropen(uit[2].bytes);
  assert.deepEqual(bovensteOutline(derde), [{ titel: 'Bijlagen: tekeningen', pagina: 1, kinderen: 0 }]);
});

test('per maximale grootte: elk deel onder de grens, alle pagina\'s op volgorde', async () => {
  const bytes = await bronBytes();
  const bron = await laadBron(bytes);
  const enkel = (await deelBytes(bron, { start: 1, eind: 1 })).length;
  const max = enkel * 3;
  const delen = await berekenDelen(bron, { modus: 'size', maxBytes: max });
  assert.ok(delen.length >= 2, `${delen.length} delen`);
  assert.equal(delen[0].start, 1);
  assert.equal(delen[delen.length - 1].eind, 10);
  for (let i = 1; i < delen.length; i++) assert.equal(delen[i].start, delen[i - 1].eind + 1);
  const uit = await maakDelen(bron, delen, {});
  for (const d of uit) {
    if (!d.teGroot) assert.ok(d.bytes.length <= max, `${d.bytes.length} > ${max}`);
  }
  // Gedeelde lettertypen tellen één keer: meer dan één pagina per deel.
  assert.ok(delen.some((d) => d.eind > d.start));
});

test('voortgang: één melding per deel', async () => {
  const bron = await laadBron(await bronBytes());
  const meldingen = [];
  await maakDelen(bron, [{ start: 1, eind: 5 }, { start: 6, eind: 10 }], {
    voortgang: (i, totaal) => meldingen.push(`${i}/${totaal}`),
  });
  assert.deepEqual(meldingen, ['1/2', '2/2']);
});

test('bouwDeel laat de bron heel: twee keer hetzelfde deel geeft dezelfde inhoud', async () => {
  const bron = await laadBron(await bronBytes());
  const a = await bouwDeel(bron, { start: 1, eind: 3 });
  const b = await bouwDeel(bron, { start: 1, eind: 3 });
  assert.equal(a.getPageCount(), 3);
  assert.equal(b.getPageCount(), 3);
  assert.equal(annotaties(b, b.getPage(1)).filter((x) => subtype(x) === 'Link').length, 1);
  // De bron zelf heeft nog al haar pagina's en annotaties.
  assert.equal(bron.getPageCount(), 10);
});

test('schrijf: elk deel gaat meteen weg, de uitkomst houdt geen bytes vast', async () => {
  const bron = await laadBron(await bronBytes());
  const geschreven = [];
  const uit = await maakDelen(bron, [{ start: 1, eind: 4 }, { start: 5, eind: 10 }], {
    schrijf: async (deel, bytes, i) => { geschreven.push([i, deel.start, (await PDFDocument.load(bytes)).getPageCount()]); },
  });
  assert.deepEqual(geschreven, [[0, 1, 4], [1, 5, 6]]);
  assert.ok(uit.every((d) => !('bytes' in d)));
});

test('vaste delen (splitsmarkeringen van Pagina\'s bewerken, #764): gecontroleerd en gebouwd', async () => {
  const bron = await laadBron(await bronBytes());
  const delen = await berekenDelen(bron, { modus: 'ranges', delen: [{ start: 1, eind: 3 }, { start: 4, eind: 10 }, { start: 11, eind: 12 }] });
  assert.deepEqual(delen, [{ start: 1, eind: 3 }, { start: 4, eind: 10 }], 'wat buiten het document valt vervalt');
  const klaar = await maakDelen(bron, delen);
  const aantallen = [];
  for (const d of klaar) aantallen.push((await PDFDocument.load(d.bytes)).getPageCount());
  assert.deepEqual(aantallen, [3, 7]);
});
