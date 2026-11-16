// Rand en /RD van een rechthoek of ellips (pdf/vorm-rand-inzet.js).
//
// PDF 32000-1, 12.5.6.8: /RD is de afstand van /Rect tot de vorm en de rand
// ligt binnen de vorm. Een /Square uit een ander tekenpakket met /RD
// [0.5 0.5 0.5 0.5] en /BS /W 1 heeft zijn hartlijn dus 1 pt binnen /Rect;
// de app nam /Rect zelf, waardoor de rechthoek op elke zijde 1 pt te groot
// werd en niet meer aansloot op maatlijnen die op zijn hoeken stonden.
//
// De app schrijft een rechthoek of ellips nu ook zo (rand binnen /Rect, /RD
// 0), zodat andere lezers de buitenste helft van de rand niet afknippen.
// Bestanden zonder /RD (eigen bestanden van vóór deze regel) openen als
// voorheen: /Rect is de hartlijn.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { samenvoegen } = await import('./saver/bron-behoud.js');
const { geldigeRd, hartlijnUitRect, rectRondHartlijn, randBinnenRect } = await import('./vorm-rand-inzet.js');

const PAGINA = [612, 792];
const TOL = 1e-3;
const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, `${msg}: ${a} ≠ ${b}`);
const zelfdeVak = (m, verwacht, msg) => {
  for (const k of ['x', 'y', 'width', 'height']) bijna(m[k], verwacht[k], `${msg} ${k}`);
};

// ── de regel zelf ───────────────────────────────────────────────────────────

test('hartlijnUitRect: /Rect min /RD min halve lijndikte', () => {
  assert.deepEqual(hartlijnUitRect([0, 0, 100, 50], [1, 2, 3, 4], 2), [2, 3, 96, 45]);
  // Omgekeerde /Rect telt als genormaliseerd.
  assert.deepEqual(hartlijnUitRect([100, 50, 0, 0], [0, 0, 0, 0], 2), [1, 1, 99, 49]);
  // Zonder (geldige) /RD geldt /Rect zelf.
  assert.equal(hartlijnUitRect([0, 0, 100, 50], undefined, 1), null);
  assert.equal(hartlijnUitRect([0, 0, 100, 50], [1, 1, 1], 1), null);
  assert.equal(hartlijnUitRect([0, 0, 100, 50], [1, -1, 1, 1], 1), null);
  // Geen vorm meer over na de inzet: /Rect zelf.
  assert.equal(hartlijnUitRect([0, 0, 10, 10], [5, 5, 5, 5], 1), null);
});

test('rectRondHartlijn is het omgekeerde van hartlijnUitRect', () => {
  const hart = [182.3659, 596.6769, 283.2954, 670.1151];
  for (const w of [0, 1, 3.5]) {
    const { rect, rd } = rectRondHartlijn(hart, w);
    assert.deepEqual(rd, [0, 0, 0, 0]);
    const terug = hartlijnUitRect(rect, rd, w);
    hart.forEach((v, i) => bijna(terug[i], v, `w ${w} coördinaat ${i}`));
  }
  assert.equal(geldigeRd([0, 0, 0, 0]).length, 4);
});

test('randBinnenRect: alleen een ongedraaide rechthoek of ellips', () => {
  assert.equal(randBinnenRect({ type: 'box' }), true);
  assert.equal(randBinnenRect({ type: 'circle', rotation: 0 }), true);
  assert.equal(randBinnenRect({ type: 'box', rotation: 30 }), false);
  for (const type of ['mask', 'redaction', 'cloud', 'polygon']) assert.equal(randBinnenRect({ type }), false, type);
});

// ── helpers: bestand maken, opslaan, heropenen ──────────────────────────────

async function bladMet(dicts) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage(PAGINA);
  const refs = dicts.map((d) => doc.context.register(doc.context.obj(d)));
  pagina.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  return doc.save();
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen;
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'vorm-rand', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function woordenboeken(bytes) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[0].node.Annots();
  return (annots ? annots.asArray() : []).map((r) => doc.context.lookup(r));
}
const getallen = (dict, sleutel) => dict.get(PDFName.of(sleutel))?.asArray().map((n) => n.asNumber());

// ── bestand uit een ander tekenpakket ───────────────────────────────────────

// De waarden van een /Square en /Circle zoals een ander tekenpakket ze
// schrijft: lijndikte 1, /RD 0,5 rondom, appearance op de hartlijn 1 pt
// binnen /Rect.
const VREEMDE_RECT = [181.3659, 595.6769, 284.2954, 671.1151];
const vreemd = (Subtype, extra = {}) => ({
  Type: 'Annot', Subtype, Rect: VREEMDE_RECT, C: [1, 0, 0], F: 4,
  BS: { Type: 'Border', W: 1, S: 'S' }, RD: [0.5, 0.5, 0.5, 0.5], ...extra,
});
// Hartlijn in app-coördinaten (y omlaag): x 182.3659, boven 792 − 670.1151.
const HARTLIJN = { x: 182.3659, y: 121.8849, width: 100.9295, height: 73.43811 };
const HEEL_RECT = { x: 181.3659, y: 120.8849, width: 102.9295, height: 75.4382 };

test('/Square en /Circle met /RD: het model is de hartlijn van de rand', async () => {
  const modellen = await laad(await bladMet([vreemd('Square'), vreemd('Circle')]));
  assert.equal(modellen[0].type, 'box');
  assert.equal(modellen[1].type, 'circle');
  zelfdeVak(modellen[0], HARTLIJN, 'rechthoek');
  zelfdeVak(modellen[1], HARTLIJN, 'ellips');
  assert.equal(modellen[0].lineWidth, 1);
});

test('zonder /BS en /Border is de rand 1 pt (en telt hij mee voor de inzet)', async () => {
  // Zo schreef het andere tekenpakket de rechthoek in het voorbeeldbestand:
  // pdf.js geeft dan lijndikte 0, wat een haarlijn en geen inzet werd.
  const zonderBs = vreemd('Square');
  delete zonderBs.BS;
  const [model] = await laad(await bladMet([zonderBs]));
  assert.equal(model.lineWidth, 1);
  assert.notEqual(model.strokeColor, 'none');
  zelfdeVak(model, HARTLIJN, 'zonder /BS');
});

test('zonder /RD, of met een wolkrand, blijft /Rect het vak (zoals voorheen)', async () => {
  const zonderRd = vreemd('Square');
  delete zonderRd.RD;
  const wolk = vreemd('Square', { BE: { S: 'C', I: 1 } });
  const modellen = await laad(await bladMet([zonderRd, wolk]));
  zelfdeVak(modellen[0], HEEL_RECT, 'zonder /RD');
  assert.equal(modellen[1].type, 'cloud');
  zelfdeVak(modellen[1], HEEL_RECT, 'wolk');
});

// ── eigen rechthoek en ellips: opslaan en heropenen ─────────────────────────

const basis = {
  page: 1, rotation: 0, color: '#ff0000', strokeColor: '#ff0000', fillColor: null,
  lineWidth: 3, borderStyle: 'solid', opacity: 1, author: 'Test',
};
const EIGEN = [
  { ...basis, id: 'vak', type: 'box', x: 100, y: 100, width: 120, height: 60 },
  { ...basis, id: 'ellips', type: 'circle', x: 300, y: 100, width: 80, height: 50 },
  { ...basis, id: 'randloos', type: 'box', x: 100, y: 300, width: 90, height: 40, strokeColor: 'none', fillColor: '#00ff00' },
];

test('eigen rechthoek en ellips: rand binnen /Rect, /RD 0, en heropenen geeft dezelfde maat', async () => {
  const bytes = await opslaan(await bladMet([]), EIGEN.map((a) => ({ ...a })));
  const dicts = await woordenboeken(bytes);
  assert.equal(dicts.length, 3);

  const [vak, ellips, randloos] = dicts;
  // Hartlijn x 100..220, y (PDF) 792−160..792−100; halve lijndikte 1,5 erbij.
  assert.deepEqual(getallen(vak, 'Rect'), [98.5, 630.5, 221.5, 693.5]);
  assert.deepEqual(getallen(vak, 'RD'), [0, 0, 0, 0]);
  assert.deepEqual(getallen(ellips, 'RD'), [0, 0, 0, 0]);
  // Zonder rand (/W 0) geen inzet.
  assert.deepEqual(getallen(randloos, 'Rect'), [100, 452, 190, 492]);

  // De appearance groeit mee, anders knipt een andere lezer de rand af.
  const doc = await PDFDocument.load(bytes);
  const n = doc.context.lookup(doc.context.lookup(doc.context.lookup(
    doc.getPages()[0].node.Annots().get(0)).get(PDFName.of('AP'))).get(PDFName.of('N')));
  assert.deepEqual(n.dict.get(PDFName.of('BBox')).asArray().map((v) => v.asNumber()), [-1.5, -1.5, 121.5, 61.5]);

  // Twee keer heropenen en opslaan: de maat blijft gelijk.
  let huidige = bytes;
  for (let ronde = 1; ronde <= 2; ronde++) {
    const modellen = await laad(huidige);
    assert.equal(modellen.length, 3);
    for (const [i, verwacht] of EIGEN.entries()) {
      zelfdeVak(modellen[i], verwacht, `ronde ${ronde} ${verwacht.id}`);
    }
    huidige = await opslaan(huidige, modellen);
  }
});

test('een eigen bestand van vóór deze regel (geen /RD, /Rect = hartlijn) opent als voorheen', async () => {
  const oud = {
    Type: 'Annot', Subtype: 'Square', Rect: [100, 632, 220, 692], C: [1, 0, 0], F: 4,
    BS: { Type: 'Border', W: 3, S: 'S' },
  };
  const [model] = await laad(await bladMet([oud]));
  zelfdeVak(model, { x: 100, y: 100, width: 120, height: 60 }, 'oud bestand');
});

// ── een vorm uit het bestand die in de app veranderde ───────────────────────

test('samenvoegen: de nieuwe /RD gaat mee, ook als het bestand er geen had', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const origineel = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10], NM: '(x)' });
  const nieuw = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [-0.5, -0.5, 20.5, 20.5], RD: [0, 0, 0, 0] });
  const uit = samenvoegen(ctx, origineel, nieuw, { vorm: true });
  assert.deepEqual(getallen(uit, 'Rect'), [-0.5, -0.5, 20.5, 20.5]);
  assert.deepEqual(getallen(uit, 'RD'), [0, 0, 0, 0]);

  // En een bestaande /RD van het andere programma wordt vervangen.
  const metRd = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10], RD: [0.5, 0.5, 0.5, 0.5] });
  assert.deepEqual(getallen(samenvoegen(ctx, metRd, nieuw, { vorm: true }), 'RD'), [0, 0, 0, 0]);
});
