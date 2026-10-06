// Tekstvakken van een ander programma op een liggend CAD-blad dat als staand
// blad met /Rotate 90 is opgeslagen, door de echte lader gehaald: pdf.js,
// extractAnnotationColors en convertPdfAnnotation.
//
// De woordenboeken en appearances zijn letterlijk overgenomen uit zo'n bestand:
//  - een verticaal profiellabel, gedraaid met de AP-/Matrix plus een tekst-cm,
//    met een doos-`re` en een anders ingesprongen tekstclip-`re`. Het kwam
//    terug als 19×55 in plaats van 55×19: de maat werd uit de PDF-/Rect
//    teruggerekend terwijl de hoek een weergavehoek is;
//  - een typemachine-tekst (/IT /FreeTextTypewriter) in het titelblok. Zijn
//    /Rect is precies de breedte van de tekst; de app mat die 0,005 pt
//    breder, brak hem op de spatie af en liet het vak naar twee regels groeien,
//    over het volgende veld heen. Een typemachine-tekst breekt alleen op een
//    harde regelovergang (zo maken alle typemachine-teksten in het testcorpus
//    het; de PDF-specificatie legt het niet vast).
//
// De referentie is de eigen appearance van het bestand zoals een andere lezer
// hem tekent: het label 55,2 breed en 18,8 hoog, tekst van onder naar boven;
// de typemachine-tekst op één regel in een vak van 17,68 hoog.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas, canvasOpties } = await import('../tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { convertPdfAnnotation } = await import('./annotation-converter.js');
const { extractAnnotationColors } = await import('./color-extraction.js');
const { layoutTextboxLines } = await import('../../annotations/rendering/textbox-layout.js');

const PROFIEL = {
  rect: [132.5051, 146.60863, 187.69895, 165.41576],
  dict: {
    C: [0.824, 0.824, 1],
    Contents: PDFString.of('HEA160'),
    DA: PDFString.of('0 0 1 rg /F2 12 Tf'),
    DS: PDFString.of('font-family:Arial;font-size:12pt;font-weight:bold;color:#000000;'),
    F: 4,
    IT: PDFName.of('FreeText'),
    RD: [1, 1, 1, 1],
    Rotate: 270,
    Rotation: -270,
    Subj: PDFString.of('Text Box'),
  },
  ap: {
    BBox: [105.70868, 126.165439, 124.51581, 181.35929],
    Matrix: [0, -1, 1, 0, -105.70868, -126.165439],
    inhoud: '.824 .824 1 rg 0 0 1 RG 1 w\n106.709 127.165 16.807 53.194 re B\n'
      + '0 -1 1 0 0 0 cm -179.859 107.209 52.194 15.807 re W n\n'
      + 'BT\n0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 12 Tf -178.3593 110.6558 Td\n(HEA160)Tj\nET\n',
  },
};

const TYPEMACHINE = {
  rect: [750.0017, 971.70388, 767.67709, 1075.0379],
  dict: {
    BS: { W: 0 },
    Contents: PDFString.of('M.D. Vroegindeweij'),
    DA: PDFString.of('0 0 0 rg /F3 14 Tf'),
    DS: PDFString.of('font-family:Swis721 Cn BT,sans-serif;font-size:14pt;color:#000000;'),
    F: 4,
    IT: PDFName.of('FreeTextTypewriter'),
    Rotate: 90,
    Subj: PDFString.of('Typewriter'),
  },
  ap: {
    BBox: [750.0017, 971.70388, 767.67709, 1075.0379],
    Matrix: [1, 0, 0, 1, -750.0017, -971.70388],
    inhoud: '750.002 971.704 17.675 103.334 re n\n0 1 -1 0 0 0 cm 971.704 -767.677 103.334 17.675 re W n\n'
      + 'BT\n0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 14 Tf 971.7039 -763.4837 Td\n(M.D. Vroegindeweij)Tj\nET\n',
  },
};

/** Een blad van 842×1191 met /Rotate 90 en de opgegeven FreeTexts. */
async function blad(vakken) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 1191]);
  pagina.node.set(PDFName.of('Rotate'), doc.context.obj(90));
  const ctx = doc.context;
  const refs = vakken.map(({ rect, dict, ap }) => {
    const { BS, ...rest } = dict;
    const stroom = ctx.stream(ap.inhoud, { Type: 'XObject', Subtype: 'Form', BBox: ap.BBox, Matrix: ap.Matrix });
    return ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'FreeText', Rect: rect, ...rest,
      ...(BS ? { BS: ctx.obj(BS) } : {}),
      AP: ctx.obj({ N: ctx.register(stroom) }),
    }));
  });
  pagina.node.set(PDFName.of('Annots'), ctx.obj(refs));
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

const bij = (werkelijk, verwacht, tol, wat) =>
  assert.ok(Math.abs(werkelijk - verwacht) <= tol, `${wat}: ${werkelijk} ≠ ${verwacht}`);

/** Regels zoals het canvas ze tekent (zelfde meting als de lader). */
function regels(model) {
  const ctx = globalThis.document.createElement('canvas').getContext('2d');
  ctx.font = `${model.fontSize}px "${model.fontFamily}", sans-serif`;
  return layoutTextboxLines(model, model.width - 2 * (model.textPadding ?? model.lineWidth ?? 0),
    (t) => ctx.measureText(t).width).map((r) => r.chunks.map((c) => c.text).join(''));
}

test('profiellabel met rotatie in /Matrix op een 90°-blad: −90°, 55,19 × 18,81, midden op zijn plek', async () => {
  const [model] = await laad(await blad([PROFIEL]));
  assert.equal(model.type, 'textbox');
  assert.equal(model.rotation, -90);
  bij(model.width, 55.19385, 0.01, 'breedte');
  bij(model.height, 18.80713, 0.01, 'hoogte');
  // Op een 90°-blad is de weergave-x de PDF-y en omgekeerd.
  bij(model.x + model.width / 2, (PROFIEL.rect[1] + PROFIEL.rect[3]) / 2, 0.01, 'midden x');
  bij(model.y + model.height / 2, (PROFIEL.rect[0] + PROFIEL.rect[2]) / 2, 0.01, 'midden y');
});

test('typemachine-tekst op een 90°-blad: één regel, vak blijft 103,334 × 17,6756', async () => {
  for (const swis of [true, false]) {
    canvasOpties.swis = swis;
    try {
      const [model] = await laad(await blad([TYPEMACHINE]));
      const wat = swis ? 'met de font' : 'zonder de font';
      assert.equal(model.type, 'textbox', wat);
      assert.equal(model.rotation, 0, wat);
      assert.equal(model.noWrap, true, wat);
      bij(model.width, 103.33402, 0.001, `${wat}: breedte`);
      bij(model.height, 17.6756, 0.001, `${wat}: hoogte`);
      assert.deepEqual(regels(model), ['M.D. Vroegindeweij'], wat);
    } finally {
      canvasOpties.swis = true;
    }
  }
});

test('typemachine-tekst in de spelling van de specificatie (/IT /FreeTextTypeWriter): ook één regel', async () => {
  // ISO 32000 spelt de waarde met een hoofdletter W; het testcorpus met een
  // kleine w. Beide zijn dezelfde typemachine-tekst.
  const dict = { ...TYPEMACHINE.dict, IT: PDFName.of('FreeTextTypeWriter') };
  const [model] = await laad(await blad([{ ...TYPEMACHINE, dict }]));
  assert.equal(model.noWrap, true, 'noWrap');
  bij(model.height, 17.6756, 0.001, 'hoogte');
  assert.deepEqual(regels(model), ['M.D. Vroegindeweij']);
});

test('beide op één blad, zoals in het bestand', async () => {
  const [profiel, typemachine] = await laad(await blad([PROFIEL, TYPEMACHINE]));
  bij(profiel.width, 55.19385, 0.01, 'profiel breedte');
  bij(typemachine.height, 17.6756, 0.001, 'typemachine hoogte');
});

test('wachter: gewone FreeText (/IT /FreeText of zonder /IT) breekt nog steeds af', async () => {
  for (const it of ['FreeText', null]) {
    const dict = { ...TYPEMACHINE.dict };
    if (it) dict.IT = PDFName.of(it); else delete dict.IT;
    const [model] = await laad(await blad([{ ...TYPEMACHINE, dict }]));
    assert.equal('noWrap' in model, false, `${it}: geen noWrap`);
    bij(model.height, 33.6, 0.001, `${it}: hoogte`);
    assert.deepEqual(regels(model), ['M.D.', 'Vroegindeweij'], `${it}`);
  }
});

test('wachter: bij een callout zonder /RD beslist de /Rect niet over de oriëntatie van het vak', async () => {
  // De /Rect van een callout bevat ook de aanhaallijn en is dus geen
  // omhullende van het vak; de doos-`re` (60×20, binnen de rotatie-cm) blijft
  // de maat, ook als de terugrekening uit de /Rect de omgewisselde maat geeft.
  const callout = {
    rect: [300, 400, 322, 463],
    dict: {
      Contents: PDFString.of('vak'),
      DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
      IT: PDFName.of('FreeTextCallout'),
      CL: [310, 405, 315, 410, 318, 412],
    },
    ap: {
      BBox: [300, 400, 322, 463],
      Matrix: [1, 0, 0, 1, -300, -400],
      inhoud: 'q 1 0 0 1 311 431.5 cm 0 1 -1 0 0 0 cm 1 0 0 1 -30 -10 cm\n0 0 60 20 re S\n'
        + 'BT 0 g /Helv 12 Tf 2 6 Td (vak) Tj ET Q\n',
    },
  };
  const [model] = await laad(await blad([callout]));
  assert.equal(model.type, 'callout');
  assert.equal(model.rotation, 90);
  bij(model.width, 60, 0.001, 'breedte');
  bij(model.height, 20, 0.001, 'hoogte');
});
