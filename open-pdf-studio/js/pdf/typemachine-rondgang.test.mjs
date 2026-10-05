// Opslaan en heropenen van tekstvakken met de echte saver (saver-test-hooks.mjs).
//
// Een typemachine-tekst (/IT /FreeTextTypewriter) breekt niet af. De saver
// schreef /IT niet terug en legde de afbreking van de app in appearance en
// /Rect vast. Met alleen `noWrap` terug zou het opgeslagen vak in andere
// lezers te smal zijn: de font is niet ingebed en heeft geen /Widths, dus een
// andere lezer tekent hem met de maten van een standaardfont (Helvetica voor
// een schreefloze font) en knipt de tekst op het vak af. Het vak moet dus
// minstens zo breed zijn als de breedste regel in die maten én in die van de
// app.
//
// Eigen tekstvakken en callouts (eigen sleutels, binnenmarge uit /DS) moeten
// precies zo opgeslagen en geladen worden als voorheen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, StandardFontEmbedder, StandardFonts } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas, canvasOpties } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { layoutTextboxLines } = await import('../annotations/rendering/textbox-layout.js');

const TEKST = 'M.D. Vroegindeweij';
// Het titelblokveld, letterlijk uit het bestand (blad 842×1191, /Rotate 90).
const RECT = [750.0017, 971.70388, 767.67709, 1075.0379];
const AP = '750.002 971.704 17.675 103.334 re n\n0 1 -1 0 0 0 cm 971.704 -767.677 103.334 17.675 re W n\n'
  + `BT\n0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 14 Tf 971.7039 -763.4837 Td\n(${TEKST})Tj\nET\n`;

const DS = 'font-family:Swis721 Cn BT,sans-serif;font-size:14pt;color:#000000;';

async function typemachineBlad({ it = 'FreeTextTypewriter', ds = DS } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 1191]);
  pagina.node.set(PDFName.of('Rotate'), doc.context.obj(90));
  const ctx = doc.context;
  const stroom = ctx.stream(AP, { Type: 'XObject', Subtype: 'Form', BBox: RECT, Matrix: [1, 0, 0, 1, -RECT[0], -RECT[1]] });
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: RECT, Contents: PDFString.of(TEKST),
    DA: PDFString.of('0 0 0 rg /F3 14 Tf'),
    DS: PDFString.of(ds),
    F: 4, Rotate: 90, BS: ctx.obj({ W: 0 }), AP: ctx.obj({ N: ctx.register(stroom) }),
    ...(it ? { IT: PDFName.of(it) } : {}),
  });
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

async function leegBlad({ rotatie = 0 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt. */
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

/** Opslaan met de echte saver, op de bytes van het geopende bestand. */
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
    // savePDF eist een geopend pdf.js-document (alleen als identiteit gebruikt).
    id: 'rondgang', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

/** De FreeText-woordenboeken van blad 1 met hun appearance-inhoud. */
async function freeTexts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  return doc.getPage(0).node.Annots().asArray().map((ref) => ctx.lookup(ref))
    .filter((d) => d.get(PDFName.of('Subtype'))?.toString() === '/FreeText')
    .map((d) => {
      const n = ctx.lookup(ctx.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
      const getallen = (naam) => ctx.lookup(d.get(PDFName.of(naam)))?.asArray().map((x) => x.asNumber());
      return {
        dict: d,
        it: d.get(PDFName.of('IT'))?.toString(),
        rect: getallen('Rect'),
        ap: new TextDecoder().decode(n.getContents()),
        bbox: ctx.lookup(n.dict.get(PDFName.of('BBox'))).asArray().map((x) => x.asNumber()),
      };
    });
}

/** Breedte in de standaardfont waarmee een andere lezer de font vervangt (geen kerning in een Tj). */
function helveticaBreedte(tekst, grootte, standaardFont = StandardFonts.Helvetica) {
  const font = StandardFontEmbedder.for(standaardFont);
  return font.encodeTextAsGlyphs(tekst).reduce((w, g) => w + font.widthOfGlyph(g.name), 0) * grootte / 1000;
}

/**
 * Het vak van een tekstvak-appearance (de eerste `re`, in de ruimte waarin de
 * regels staan) en de Td-positie van elke regel.
 */
function apRegels(ap) {
  const vak = ap.match(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+) re/);
  const regels = [...ap.matchAll(/\n(-?[\d.]+) (-?[\d.]+) Td\n(?:\/\S+ [\d.]+ Tf\n)?\((.*?)\) ?Tj/g)]
    .map((m) => ({ x: parseFloat(m[1]), tekst: m[3] }));
  return { links: parseFloat(vak[1]), breedte: parseFloat(vak[3]), regels };
}

/** Elke regel past in de vervangende standaardfont tussen de randen van het vak. */
function regelsPassen(ap, grootte, standaardFont, wat) {
  assert.doesNotMatch(ap, /\d[eE][-+]?\d/, `${wat}: geen getal met exponent in de appearance`);
  const { links, breedte, regels } = apRegels(ap);
  assert.ok(regels.length > 0, `${wat}: regels in de appearance`);
  for (const r of regels) {
    const w = helveticaBreedte(r.tekst, grootte, standaardFont);
    assert.ok(r.x - links >= -1e-6, `${wat}: '${r.tekst}' begint vóór het vak (${r.x} < ${links})`);
    assert.ok(r.x - links + w <= breedte + 1e-6,
      `${wat}: '${r.tekst}' (${w}) vanaf ${r.x - links} loopt buiten het vak ${breedte}`);
  }
}

const bij = (werkelijk, verwacht, tol, wat) =>
  assert.ok(Math.abs(werkelijk - verwacht) <= tol, `${wat}: ${werkelijk} ≠ ${verwacht}`);

function regels(model) {
  const ctx = globalThis.document.createElement('canvas').getContext('2d');
  ctx.font = `${model.fontSize}px "${model.fontFamily}", sans-serif`;
  return layoutTextboxLines(model, model.width - 2 * (model.textPadding ?? model.lineWidth ?? 0),
    (t) => ctx.measureText(t).width).map((r) => r.chunks.map((c) => c.text).join(''));
}

for (const swis of [true, false]) {
  const wat = swis ? 'met de font van het bestand' : 'zonder die font';
  test(`typemachine-tekst: opslaan en heropenen houdt hem op één regel (${wat})`, async () => {
    canvasOpties.swis = swis;
    try {
      const bron = await typemachineBlad();
      const [model] = await laad(bron);
      assert.equal(model.noWrap, true);
      const [ft] = await freeTexts(await opslaan(bron, [model]));

      assert.equal(ft.it, '/FreeTextTypewriter', '/IT blijft');
      const tj = [...ft.ap.matchAll(/\((.*?)\)\s*Tj/g)].map((m) => m[1]);
      assert.deepEqual(tj, [TEKST], 'één Tj met de hele regel');
      // Blad /Rotate 90, rotatie 0: de weergavehoogte is de PDF-x, de tekst
      // loopt langs de PDF-y.
      bij(ft.rect[2] - ft.rect[0], 17.6756, 0.001, 'hoogte van het vak');

      // Andere lezers: de regel in de vervangende standaardfont past in het
      // vak van de appearance en in /Rect en /BBox.
      const vak = ft.ap.match(/\n0 0 ([\d.]+) ([\d.]+) re/);
      assert.ok(vak, 'vak in de appearance');
      const visW = parseFloat(vak[1]);
      const td = ft.ap.match(/\n(-?[\d.]+) (-?[\d.]+) Td\n\(/);
      const regelBreedte = helveticaBreedte(TEKST, 14);
      assert.ok(parseFloat(td[1]) + regelBreedte <= visW + 1e-6,
        `regel ${regelBreedte} vanaf ${td[1]} past niet in het vak ${visW}`);
      bij(ft.rect[3] - ft.rect[1], visW, 0.001, '/Rect langs de tekst');
      bij(ft.bbox[3] - ft.bbox[1], visW, 0.001, '/BBox langs de tekst');

      const [terug] = await laad(await opslaan(bron, [model]));
      assert.equal(terug.noWrap, true, 'weer noWrap');
      assert.equal(terug.rotation, 0);
      bij(terug.height, 17.6756, 0.001, 'hoogte na heropenen');
      bij(terug.x, model.x, 0.001, 'linkerrand blijft staan');
      bij(terug.y, model.y, 0.001, 'bovenrand blijft staan');
      assert.ok(terug.width >= regelBreedte - 1e-6, `breedte ${terug.width}`);
      assert.deepEqual(regels(terug), [TEKST]);
    } finally {
      canvasOpties.swis = true;
    }
  });
}

test('typemachine-tekst in de spelling van de specificatie (/IT /FreeTextTypeWriter): blijft na opslaan een typemachine', async () => {
  const bron = await typemachineBlad({ it: 'FreeTextTypeWriter' });
  const [model] = await laad(bron);
  const [ft] = await freeTexts(await opslaan(bron, [model]));
  assert.match(ft.it ?? '', /^\/FreeTextTypewriter$/i, '/IT blijft');
  assert.deepEqual([...ft.ap.matchAll(/\((.*?)\)\s*Tj/g)].map((m) => m[1]), [TEKST], 'één Tj');
  bij(ft.rect[2] - ft.rect[0], 17.6756, 0.001, 'hoogte van het vak');
});

test('typemachine-tekst met een niet-standaard Helvetica-naam uit /DS: opslaan lukt en de regel past', async () => {
  // De naam komt ongewijzigd uit /DS; 'Helvetica-Bold' met vet wordt in de
  // appearance 'Helvetica-Bold-Bold'. Geen van drieën is een standaardfont.
  const gevallen = [
    ['Helvetica-Narrow', false, StandardFonts.Helvetica],
    ['Helvetica-Light', false, StandardFonts.Helvetica],
    ['Helvetica-Bold', true, StandardFonts.HelveticaBold],
  ];
  for (const [familie, vet, standaardFont] of gevallen) {
    const bron = await typemachineBlad({ ds: `font-family:${familie};font-size:14pt;${vet ? 'font-weight:bold;' : ''}color:#000000;` });
    const [model] = await laad(bron);
    assert.equal(model.fontFamily, familie);
    assert.equal(!!model.fontBold, vet, `${familie}: vet`);
    assert.equal(model.noWrap, true);
    const [ft] = await freeTexts(await opslaan(bron, [model]));
    assert.equal(ft.it, '/FreeTextTypewriter', `${familie}: /IT`);
    assert.deepEqual([...ft.ap.matchAll(/\((.*?)\)\s*Tj/g)].map((m) => m[1]), [TEKST], `${familie}: één Tj`);
    regelsPassen(ft.ap, 14, standaardFont, familie);
  }
});

test('typemachine-tekst gecentreerd of rechts: de regel staat in de vervangende font binnen het vak', async () => {
  // Het vak wordt verbreed tot de breedte in de vervangende font (121,37 pt
  // Helvetica tegen 103,34 pt op het canvas). De regel moet met díe breedte
  // geplaatst worden; met de canvasbreedte begint hij te ver rechts en knippen
  // /BBox en clip hem af (rechts 18 pt, gecentreerd 9 pt).
  const helv = helveticaBreedte(TEKST, 14);
  const eigen = (rotatie, textAlign) => ({
    id: `tm-${rotatie}-${textAlign}`, type: 'textbox', page: 1, x: 100, y: 120, width: 103.33402, height: 17.6756,
    rotation: 0, text: TEKST, fontSize: 14, fontFamily: 'Swis721 Cn BT', color: '#000000', strokeColor: '#000000',
    fillColor: null, textColor: '#000000', lineWidth: 0, borderStyle: 'solid', opacity: 1, noWrap: true, textAlign,
  });
  for (const textAlign of ['left', 'center', 'right']) {
    // Een vak op een blad zonder en met /Rotate 90.
    for (const rotatie of [0, 90]) {
      const wat = `${textAlign}, blad ${rotatie}`;
      const [ft] = await freeTexts(await opslaan(await leegBlad({ rotatie }), [eigen(rotatie, textAlign)]));
      bij(apRegels(ft.ap).breedte, helv, 0.001, `${wat}: vak verbreed tot de Helvetica-breedte`);
      regelsPassen(ft.ap, 14, StandardFonts.Helvetica, wat);
    }
    // Het titelblokveld uit het bestand (blad 842×1191, /Rotate 90).
    const bron = await typemachineBlad();
    const [model] = await laad(bron);
    const [ft] = await freeTexts(await opslaan(bron, [{ ...model, textAlign }]));
    regelsPassen(ft.ap, 14, StandardFonts.Helvetica, `${textAlign}, titelblokveld`);
  }
});

test('wachter: eigen tekstvak zonder noWrap, gecentreerd of rechts, staat nog met de canvasbreedte', async () => {
  // Alleen een typemachine-tekst gebruikt de breedte in de vervangende font;
  // een gewoon tekstvak blijft precies zo opgeslagen als voorheen.
  const canvas = 103.3389; // "M.D. Vroegindeweij" in Swis721 Cn BT op 14 px (testhulp)
  for (const rotatie of [0, 90]) {
    const td = {};
    for (const textAlign of ['left', 'center', 'right']) {
      const model = {
        id: 'vak', type: 'textbox', page: 1, x: 100, y: 120, width: 200, height: 30, rotation: 0,
        text: TEKST, fontSize: 14, fontFamily: 'Swis721 Cn BT', color: '#000000', strokeColor: '#000000',
        fillColor: null, textColor: '#000000', lineWidth: 1, textPadding: 5.5, borderStyle: 'solid', opacity: 1, textAlign,
      };
      const [ft] = await freeTexts(await opslaan(await leegBlad({ rotatie }), [model]));
      const { links, breedte, regels: [regel] } = apRegels(ft.ap);
      bij(breedte, 200, 0.001, `blad ${rotatie}: vak ongewijzigd`);
      td[textAlign] = { x: regel.x - links, breedte };
    }
    const pad = td.left.x;
    bij(td.center.x, (td.center.breedte - canvas) / 2, 1e-6, `blad ${rotatie}: gecentreerd`);
    bij(td.right.x, td.right.breedte - pad - canvas, 1e-6, `blad ${rotatie}: rechts`);
  }
});

test('eigen tekstvak zonder noWrap: geen /IT en dezelfde maat na opslaan en heropenen', async () => {
  for (const rotatie of [0, 90]) {
    const bron = await leegBlad({ rotatie });
    const model = {
      id: 'vak', type: 'textbox', page: 1, x: 100, y: 120, width: 140, height: 40, rotation: 0,
      text: 'een gewoon tekstvak dat afbreekt', fontSize: 12, fontFamily: 'Arial',
      color: '#000000', strokeColor: '#000000', fillColor: null, textColor: '#000000',
      lineWidth: 1.5, textPadding: 5.5, borderStyle: 'solid', opacity: 1,
    };
    const [ft] = await freeTexts(await opslaan(bron, [model]));
    assert.equal(ft.it, undefined, `blad ${rotatie}: geen /IT`);
    const [terug] = await laad(await opslaan(bron, [model]));
    assert.equal('noWrap' in terug, false, `blad ${rotatie}: geen noWrap`);
    for (const k of ['x', 'y', 'width', 'height']) bij(terug[k], model[k], 0.001, `blad ${rotatie}: ${k}`);
    assert.equal(terug.textPadding, 5.5, `blad ${rotatie}: binnenmarge uit /DS`);
    assert.ok(regels(terug).length > 1, `blad ${rotatie}: breekt nog af`);
  }
});

test('eigen callout: /IT /FreeTextCallout en dezelfde maat na opslaan en heropenen', async () => {
  const bron = await leegBlad();
  const model = {
    id: 'co', type: 'callout', page: 1, x: 200, y: 200, width: 120, height: 36, rotation: 0,
    text: 'callout', fontSize: 12, fontFamily: 'Arial', color: '#ff0000', strokeColor: '#ff0000',
    fillColor: '#FFFFD0', textColor: '#000000', lineWidth: 1, textPadding: 3, borderStyle: 'solid', opacity: 1,
    arrowX: 120, arrowY: 320, kneeX: 160, kneeY: 260, armOriginX: 200, armOriginY: 218,
  };
  const [ft] = await freeTexts(await opslaan(bron, [model]));
  assert.equal(ft.it, '/FreeTextCallout');
  const [terug] = await laad(await opslaan(bron, [model]));
  assert.equal(terug.type, 'callout');
  assert.equal('noWrap' in terug, false);
  for (const k of ['x', 'y', 'width', 'height']) bij(terug[k], model[k], 0.001, k);
  assert.equal(terug.textPadding, 3);
});
