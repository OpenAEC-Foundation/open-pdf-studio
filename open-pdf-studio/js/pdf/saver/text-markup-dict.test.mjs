// Gewone tekstmarkeringen (markeren, onderstrepen, doorhalen, kronkellijn) in
// leesrichting, met een appearance langs de tekst (#527).
//
// Andere lezers nemen p1 -> p2 van elke quad als de richting van de tekst en
// tekenen een markering zonder /AP zelf uit de quads. Op een pagina met
// /Rotate 90 of 270 schreef de app vroeger een vaste volgorde in
// gebruikersruimte, zodat de lijn dwars over de tekst kwam. De controles
// hieronder lopen over /Rotate 0, 90, 180 en 270, een verschoven CropBox en
// liggende en staande tekst in de getoonde pagina. Wat "getoond" is, rekent
// pdf.js uit (viewport.convertToViewportPoint), los van de code onder test.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';

import { makePointMapper, buildStrikeQuads, buildStrikeAppearance, buildMarkupAppearance, addLoadedMarkupKeys } from './correction-dicts.js';
import { buildTextMarkupDict, bronMarkeringen } from './text-markup-dict.js';
import { zetDoorzichtigheidInAp } from './utils.js';
import {
  quadCorners, quadMidline, quadUnderline, quadSquiggle, upVector, textDirFromVector,
} from '../../annotations/corrections/geometry.js';

const PAGINAS = [
  { rotate: 0, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 90, cropBox: { x: 36, y: 48, width: 540, height: 720 } },
  { rotate: 180, cropBox: { x: 20, y: 30, width: 560, height: 700 } },
  { rotate: 270, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
];
const RECT = { x: 72, y: 90.4, width: 18, height: 12 };
const PAGINA = { x: 0, y: 0, width: 612, height: 792 };

const dichtbij = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const zelfdePunt = (p, q, msg) => { dichtbij(p.x, q.x, 1e-3, `${msg} x`); dichtbij(p.y, q.y, 1e-3, `${msg} y`); };

function streamTekst(ctx, ref) {
  const n = ctx.lookup(ref);
  return Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1');
}

/** Paden uit de inhoud: elke `m` begint een nieuw pad, `l` voegt een punt toe. */
function paden(tekst, [llx, lly]) {
  const uit = [];
  const re = /(-?[\d.]+) (-?[\d.]+) (m|l)\b/g;
  let m;
  while ((m = re.exec(tekst)) !== null) {
    const p = { x: Number(m[1]) + llx, y: Number(m[2]) + lly };
    if (m[3] === 'm') uit.push([p]);
    else uit.at(-1).push(p);
  }
  return uit;
}

// ── de appearance zelf ──────────────────────────────────────────────────────

test('buildMarkupAppearance: een doorhaling is precies die van een tekstcorrectie (#508)', async () => {
  for (const { rotate, cropBox } of PAGINAS) {
    for (const textDir of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      const ctx = doc.context;
      const quads = buildStrikeQuads([RECT, { ...RECT, y: 106.4 }], textDir, makePointMapper(rotate, cropBox));
      const a = buildMarkupAppearance(ctx, quads, 'StrikeOut', [1, 0, 0], 1.5);
      const b = buildStrikeAppearance(ctx, quads, [1, 0, 0], 1.5);
      assert.deepEqual(a.rect, b.rect);
      assert.equal(streamTekst(ctx, a.apRef), streamTekst(ctx, b.apRef));
    }
  }
});

test('buildMarkupAppearance: onderstreping, het uitgewerkte voorbeeld op /Rotate 0 en 90', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const q0 = buildStrikeQuads([RECT], 0, makePointMapper(0, PAGINA));
  const o0 = buildMarkupAppearance(ctx, q0, 'Underline', [0, 0, 1], 1);
  assert.deepEqual(o0.rect, [71.5, 689.1, 90.5, 702.1]);
  assert.equal(streamTekst(ctx, o0.apRef), 'q 0 0 1 RG 1 w 0 J [] 0 d 0.5 1.5 m 18.5 1.5 l S Q');
  // /Rotate 90: de tekst loopt in het bestand langs y; de lijn ook, 1 pt
  // boven de onderkant (die ligt daar op x = 102,4).
  const q90 = buildStrikeQuads([RECT], 0, makePointMapper(90, PAGINA));
  const o90 = buildMarkupAppearance(ctx, q90, 'Underline', [0, 0, 1], 1);
  assert.deepEqual(o90.rect, [89.9, 71.5, 102.9, 90.5]);
  assert.equal(streamTekst(ctx, o90.apRef), 'q 0 0 1 RG 1 w 0 J [] 0 d 11.5 0.5 m 11.5 18.5 l S Q');
});

test('buildMarkupAppearance: markeren, het uitgewerkte voorbeeld op /Rotate 90', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const q90 = buildStrikeQuads([RECT], 0, makePointMapper(90, PAGINA));
  const { rect, apRef } = buildMarkupAppearance(ctx, q90, 'Highlight', [1, 1, 0], 1);
  assert.deepEqual(rect, [90.4, 72, 102.4, 90], '/Rect is de omhullende, zonder marge');
  assert.equal(streamTekst(ctx, apRef), 'q /GSm gs 1 1 0 rg 0 0 m 0 18 l 12 18 l 12 0 l h f Q');
  const n = ctx.lookup(apRef);
  assert.deepEqual(n.dict.lookup(PDFName.of('BBox')).asArray().map((v) => v.asNumber()), [0, 0, 12, 18]);
  const gs = n.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('ExtGState')).lookup(PDFName.of('GSm'));
  assert.equal(gs.get(PDFName.of('BM')).toString(), '/Multiply', 'zoals de markeerlaag op het scherm');
  assert.equal(gs.get(PDFName.of('ca')), undefined, 'de doorzichtigheid zet de saver er later in');
});

test('buildMarkupAppearance: onderstreping en kronkellijn volgen quadUnderline en quadSquiggle', async () => {
  for (const { rotate, cropBox } of PAGINAS) {
    for (const textDir of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      const ctx = doc.context;
      const quads = buildStrikeQuads([RECT, { ...RECT, y: 106.4, width: 30 }], textDir, makePointMapper(rotate, cropBox));
      const label = `/Rotate ${rotate}, textDir ${textDir}`;
      for (const [soort, lijn, stijl] of [['Underline', quadUnderline, '0 J'], ['Squiggly', quadSquiggle, '0 J 1 j']]) {
        const { rect, apRef } = buildMarkupAppearance(ctx, quads, soort, [0, 0, 1], 1);
        const tekst = streamTekst(ctx, apRef);
        assert.ok(tekst.startsWith(`q 0 0 1 RG 1 w ${stijl} [] 0 d `), `${soort}: ${tekst.slice(0, 40)} (${label})`);
        assert.ok(tekst.endsWith(' S Q'), `${soort}: één streek (${label})`);
        const gevonden = paden(tekst, rect);
        assert.equal(gevonden.length, quads.length, `${soort}: één pad per quad (${label})`);
        gevonden.forEach((pad, i) => {
          const verwacht = lijn(quads[i]);
          assert.equal(pad.length, verwacht.length, `${soort} quad ${i}: aantal punten (${label})`);
          pad.forEach((p, k) => zelfdePunt(p, verwacht[k], `${soort} quad ${i} punt ${k} (${label})`));
        });
        for (const p of quads.flat()) {
          assert.ok(p.x > rect[0] && p.x < rect[2] && p.y > rect[1] && p.y < rect[3], `${soort}: quad binnen /Rect (${label})`);
        }
      }
    }
  }
});

// ── de hele markering, zoals saver.js haar schrijft ─────────────────────────

const SOORTEN = { textHighlight: 'Highlight', textUnderline: 'Underline', textStrikethrough: 'StrikeOut', textSquiggly: 'Squiggly' };
// Tekstregels in de getoonde pagina: liggend bij textDir 0/180, staand bij 90/270.
const REGELS = {
  liggend: [{ x: 72, y: 90, width: 60, height: 12 }, { x: 72, y: 106, width: 40, height: 12 }],
  staand: [{ x: 300, y: 100, width: 12, height: 60 }, { x: 284, y: 100, width: 12, height: 40 }],
};

function omhullendeVan(rects) {
  const xs = rects.flatMap((r) => [r.x, r.x + r.width]);
  const ys = rects.flatMap((r) => [r.y, r.y + r.height]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function modellen() {
  const uit = [];
  for (const [type, subtype] of Object.entries(SOORTEN)) {
    for (const textDir of [undefined, 90, 180, 270]) {
      const rects = REGELS[(textDir ?? 0) % 180 === 0 ? 'liggend' : 'staand'];
      uit.push({
        id: `${subtype}-${textDir ?? 'geen'}`, nm: `${subtype}-${textDir ?? 'geen'}`, type, page: 1, textDir,
        ...omhullendeVan(rects), rects: rects.map((r) => ({ ...r })),
        color: '#0033CC', fillColor: type === 'textHighlight' ? '#FFEE00' : undefined,
        opacity: type === 'textHighlight' ? 0.4 : (textDir === 180 ? 0.5 : 1),
        author: 'Ann', subject: `opmerking ${subtype}`, printable: textDir !== 270, locked: textDir === 90,
      });
    }
  }
  // Een vlakmarkering (gereedschap 'highlight') heeft geen rects: haar vak telt.
  uit.push({ id: 'vlak', nm: 'vlak', type: 'highlight', page: 1, x: 400, y: 500, width: 80, height: 30, color: '#00FF00', opacity: 0.3 });
  return uit;
}

// Zoals saver.js een gewone markering schrijft (tak in de switch plus de
// doorzichtigheid daarna): de NIET omgerekende annotatie met de puntomrekening
// van de pagina. correction-wiring.test.mjs bewaakt dat saver.js dit doet.
function schrijfMarkering(ctx, annRaw, pageRot, cropBox) {
  const dict = buildTextMarkupDict(ctx, annRaw, makePointMapper(pageRot, cropBox), { opacity: annRaw.opacity, pageRot });
  addLoadedMarkupKeys(dict, annRaw);
  zetDoorzichtigheidInAp(ctx, dict, annRaw.opacity);
  return dict;
}

const opgeslagen = new Map();
/** Eén pagina met alle markeringen, opgeslagen en teruggelezen met pdf-lib en pdf.js. */
async function bestand(instelling) {
  if (opgeslagen.has(instelling)) return opgeslagen.get(instelling);
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  pagina.setRotation(degrees(instelling.rotate));
  const { x, y, width, height } = instelling.cropBox;
  pagina.setCropBox(x, y, width, height);
  const anns = modellen();
  const refs = anns.map((ann) => doc.context.register(schrijfMarkering(doc.context, ann, instelling.rotate, pagina.getCropBox())));
  pagina.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  const bytes = await doc.save();

  const pdfLib = await PDFDocument.load(bytes);
  const ctx = pdfLib.context;
  const dicts = new Map(ctx.lookup(pdfLib.getPages()[0].node.get(PDFName.of('Annots'))).asArray().map((ref) => {
    const d = ctx.lookup(ref);
    return [ctx.lookup(d.get(PDFName.of('NM'))).decodeText(), d];
  }));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pdfPagina = await lezer.getPage(1);
  const viewport = pdfPagina.getViewport({ scale: 1 });
  const vanLezer = await pdfPagina.getAnnotations();
  const naarScherm = (px, py) => { const [vx, vy] = viewport.convertToViewportPoint(px, py); return { x: vx, y: vy }; };
  const uit = { anns, ctx, dicts, naarScherm, vanLezer };
  opgeslagen.set(instelling, uit);
  return uit;
}

const getallen = (ctx, d, k) => ctx.lookup(d.get(PDFName.of(k))).asArray().map((v) => v.asNumber());
const regelsVan = (ann) => (ann.rects?.length ? ann.rects : [{ x: ann.x, y: ann.y, width: ann.width, height: ann.height }]);

test('elke quad staat in leesrichting zoals de pagina getoond wordt, op elke /Rotate (#527)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, ctx, dicts, naarScherm } = await bestand(instelling);
    for (const ann of anns) {
      const label = `${ann.nm} op /Rotate ${instelling.rotate}`;
      const dir = ann.textDir ?? 0;
      const q = getallen(ctx, dicts.get(ann.nm), 'QuadPoints');
      const regels = regelsVan(ann);
      assert.equal(q.length, 8 * regels.length, `${label}: één quad per regel`);
      regels.forEach((r, i) => {
        const [p1, p2, p3, p4] = [0, 2, 4, 6].map((k) => naarScherm(q[8 * i + k], q[8 * i + k + 1]));
        assert.equal(textDirFromVector(p2.x - p1.x, p2.y - p1.y), dir, `${label}, regel ${i + 1}: p1 -> p2 langs de tekst`);
        assert.equal(textDirFromVector(p4.x - p3.x, p4.y - p3.y), dir, `${label}, regel ${i + 1}: p3 -> p4 langs de tekst`);
        const up = upVector(dir);
        assert.ok((p1.x - p3.x) * up.x + (p1.y - p3.y) * up.y > 0, `${label}, regel ${i + 1}: p1 boven p3`);
        // Het assen-uitgelijnde vak (zoals pdf.js en de lader het maken) is de regel zelf.
        dichtbij(Math.min(p1.x, p2.x, p3.x, p4.x), r.x, 1e-3, `${label}: links`);
        dichtbij(Math.min(p1.y, p2.y, p3.y, p4.y), r.y, 1e-3, `${label}: boven`);
        dichtbij(Math.max(p1.x, p2.x, p3.x, p4.x), r.x + r.width, 1e-3, `${label}: rechts`);
        dichtbij(Math.max(p1.y, p2.y, p3.y, p4.y), r.y + r.height, 1e-3, `${label}: onder`);
      });
    }
  }
});

test('pdf.js houdt elke markering met haar quads (#527)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, vanLezer } = await bestand(instelling);
    assert.equal(vanLezer.length, anns.length);
    for (const a of vanLezer) assert.ok(a.quadPoints && a.quadPoints.length > 0, `${a.subtype} op /Rotate ${instelling.rotate}`);
  }
});

test('onderstreping, doorhaling en kronkellijn hebben een appearance langs de tekst (#527)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, ctx, dicts, naarScherm } = await bestand(instelling);
    for (const ann of anns.filter((a) => a.type !== 'textHighlight' && a.type !== 'highlight')) {
      const label = `${ann.nm} op /Rotate ${instelling.rotate}`;
      const dir = ann.textDir ?? 0;
      const dict = dicts.get(ann.nm);
      const ap = dict.lookup(PDFName.of('AP'));
      assert.ok(ap, `${label}: heeft een /AP`);
      const rect = getallen(ctx, dict, 'Rect');
      const gevonden = paden(streamTekst(ctx, ap.get(PDFName.of('N'))), rect)
        .map((pad) => pad.map((p) => naarScherm(p.x, p.y)));
      assert.equal(gevonden.length, ann.rects.length, `${label}: één lijn per regel`);
      gevonden.forEach((pad, i) => {
        // Verwacht in de getoonde pagina, uit de regel zelf.
        const hoeken = quadCorners(ann.rects[i], dir);
        const verwacht = ann.type === 'textStrikethrough' ? quadMidline(hoeken)
          : ann.type === 'textUnderline' ? quadUnderline(hoeken) : quadSquiggle(hoeken);
        const [a, b] = [pad[0], pad.at(-1)];
        assert.equal(textDirFromVector(b.x - a.x, b.y - a.y), dir, `${label}, regel ${i + 1}: lijn langs de tekst`);
        assert.equal(pad.length, verwacht.length, `${label}, regel ${i + 1}: aantal punten`);
        pad.forEach((p, k) => zelfdePunt(p, verwacht[k], `${label}, regel ${i + 1}, punt ${k}`));
      });
    }
  }
});

test('een markering heeft een appearance die de tekst bedekt, met Multiply en /CA als alfa (#527)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, ctx, dicts, naarScherm } = await bestand(instelling);
    for (const ann of anns.filter((a) => a.type === 'textHighlight' || a.type === 'highlight')) {
      const label = `${ann.nm} op /Rotate ${instelling.rotate}`;
      const dict = dicts.get(ann.nm);
      const nRef = dict.lookup(PDFName.of('AP'))?.get(PDFName.of('N'));
      assert.ok(nRef, `${label}: heeft een /AP`);
      const n = ctx.lookup(nRef);
      const rect = getallen(ctx, dict, 'Rect');
      const tekst = streamTekst(ctx, nRef);
      assert.match(tekst, /^\/GSo gs\s+q \/GSm gs /, `${label}: eerst de doorzichtigheid, dan de mengmodus`);
      const egs = n.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('ExtGState'));
      assert.equal(egs.lookup(PDFName.of('GSm')).get(PDFName.of('BM')).toString(), '/Multiply', label);
      assert.equal(egs.lookup(PDFName.of('GSo')).get(PDFName.of('ca')).asNumber(), ann.opacity, `${label}: /ca = /CA`);
      const regels = regelsVan(ann);
      const gevonden = paden(tekst, rect);
      assert.equal(gevonden.length, regels.length, `${label}: één vlak per regel`);
      gevonden.forEach((pad, i) => {
        const r = regels[i];
        const scherm = pad.map((p) => naarScherm(p.x, p.y));
        assert.equal(scherm.length, 4, `${label}: vier hoeken`);
        dichtbij(Math.min(...scherm.map((p) => p.x)), r.x, 1e-3, `${label}: links`);
        dichtbij(Math.max(...scherm.map((p) => p.x)), r.x + r.width, 1e-3, `${label}: rechts`);
        dichtbij(Math.min(...scherm.map((p) => p.y)), r.y, 1e-3, `${label}: boven`);
        dichtbij(Math.max(...scherm.map((p) => p.y)), r.y + r.height, 1e-3, `${label}: onder`);
      });
    }
  }
});

test('/OPS_TextDir is de leesrichting in de ongedraaide pagina, zoals bij correcties (#527)', async () => {
  for (const instelling of PAGINAS) {
    const { anns, dicts } = await bestand(instelling);
    for (const ann of anns) {
      const td = dicts.get(ann.nm).get(PDFName.of('OPS_TextDir'))?.asNumber();
      assert.equal(td, ((((ann.textDir ?? 0) - instelling.rotate) % 360) + 360) % 360, `${ann.nm} op /Rotate ${instelling.rotate}`);
    }
  }
});

test('soort, kleur, doorzichtigheid, /T, /Contents, /M, /F en /NM blijven zoals de saver ze schreef (#527)', async () => {
  const kleur = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  for (const instelling of PAGINAS) {
    const { anns, ctx, dicts } = await bestand(instelling);
    for (const ann of anns) {
      const label = `${ann.nm} op /Rotate ${instelling.rotate}`;
      const d = dicts.get(ann.nm);
      assert.equal(d.get(PDFName.of('Subtype')).toString(), `/${SOORTEN[ann.type] || 'Highlight'}`, label);
      getallen(ctx, d, 'C').forEach((v, i) => dichtbij(v, kleur(ann.fillColor || ann.color)[i], 1e-6, `${label}: /C`));
      assert.equal(d.get(PDFName.of('CA')).asNumber(), ann.opacity, `${label}: /CA`);
      assert.equal(ctx.lookup(d.get(PDFName.of('T'))).decodeText(), ann.author || 'User', `${label}: /T`);
      assert.equal(ctx.lookup(d.get(PDFName.of('Contents'))).decodeText(), ann.subject || '', `${label}: /Contents`);
      assert.match(ctx.lookup(d.get(PDFName.of('M'))).decodeText(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${label}: /M`);
      assert.equal(d.get(PDFName.of('F')).asNumber(), (ann.printable === false ? 0 : 4) | (ann.locked ? 128 : 0), `${label}: /F`);
      assert.equal(ctx.lookup(d.get(PDFName.of('NM'))).decodeText(), ann.nm, `${label}: /NM`);
      for (const k of ['IT', 'Subj', 'IRT', 'RT', 'OPS_MarkedText', 'CreationDate']) {
        assert.equal(d.get(PDFName.of(k)), undefined, `${label}: geen /${k}`);
      }
    }
  }
});

// ── markeringen die al in het bestand stonden, zonder /OPS_TextDir ─────────
//
// Een geladen markering zonder /OPS_TextDir heeft in het model geen
// leesrichting (de lader blijft zoals hij was). Haar quads uit het bestand
// vertellen meer: is p1 -> p2 de lange kant, dan is dat de leesrichting (zo
// schrijven andere programma's ze, en zo stond de oude vaste volgorde op tekst
// die in gebruikersruimte rechtop staat). Alleen als p1 -> p2 de korte kant is
// en dwars op de getoonde tekst staat (de oude volgorde op een gedraaide
// pagina), schrijft de saver haar opnieuw in de getoonde leesrichting.

const getallenVan = (d, k) => d.lookup(PDFName.of(k)).asArray().map((v) => v.asNumber());
const PAGINA90 = { rotate: 90, cropBox: PAGINA };

/** Een markering-dict zoals een ander programma (of een eerdere app-versie) hem schreef. */
function bronDict(ctx, subtype, quads, extra = {}) {
  const alle = quads.flat();
  const xs = alle.filter((_, i) => i % 2 === 0);
  const ys = alle.filter((_, i) => i % 2 === 1);
  return ctx.obj({
    Type: 'Annot', Subtype: subtype, QuadPoints: alle, C: [1, 0, 0], CA: 1, F: 4,
    Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ...extra,
  });
}

test('bronMarkeringen: alleen tekstmarkeringen zonder /OPS_TextDir met bruikbare quads', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const q = [72, 602.4, 192, 602.4, 72, 590.4, 192, 590.4];
  const twee = [72, 700, 140, 700, 72, 688, 140, 688];
  const refs = [
    ctx.register(bronDict(ctx, 'Underline', [q, twee])),
    ctx.register(bronDict(ctx, 'StrikeOut', [q], { OPS_TextDir: 0 })),
    ctx.register(bronDict(ctx, 'Square', [q])),
    ctx.register(bronDict(ctx, 'Squiggly', [q.slice(0, 6)])),
    ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [0, 0, 1, 1] })),
    ctx.register(bronDict(ctx, 'Highlight', [q])),
  ];
  const lijst = bronMarkeringen(ctx, refs);
  assert.deepEqual(lijst.map((b) => b.subtype), ['Underline', 'Highlight']);
  assert.deepEqual(lijst[0].quads, [q, twee]);
  assert.deepEqual(bronMarkeringen(ctx, []), []);
  assert.deepEqual(bronMarkeringen(ctx, undefined), []);
});

test('een ongewijzigde markering zonder /OPS_TextDir houdt haar quads als p1 -> p2 de lange kant is (#527)', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(90, PAGINA);
  // /Rotate 90, tekst rechtop in gebruikersruimte: getoond loopt hij omlaag.
  // Het model (zoals de lader het geeft) kent alleen het getoonde vak.
  const bron = [72, 602.4, 192, 602.4, 72, 590.4, 192, 590.4];
  const ann = { type: 'textUnderline', x: 590.4, y: 72, width: 12, height: 120, rects: [{ x: 590.4, y: 72, width: 12, height: 120 }], color: '#0000FF' };
  for (const subtype of ['Underline', 'StrikeOut', 'Squiggly', 'Highlight']) {
    const type = { Underline: 'textUnderline', StrikeOut: 'textStrikethrough', Squiggly: 'textSquiggly', Highlight: 'textHighlight' }[subtype];
    const bronnen = bronMarkeringen(ctx, [ctx.register(bronDict(ctx, subtype, [bron]))]);
    const dict = buildTextMarkupDict(ctx, { ...ann, type }, map, { opacity: 1, pageRot: 90, bronnen });
    assert.deepEqual(getallenVan(dict, 'QuadPoints'), bron, `${subtype}: de quads uit het bestand`);
    assert.equal(dict.get(PDFName.of('OPS_TextDir')), undefined, `${subtype}: geen /OPS_TextDir, de lader blijft zoals hij was`);
    assert.equal(bronnen.length, 0, `${subtype}: de bron is gebruikt`);
    if (subtype === 'Highlight') continue;
    const rect = getallenVan(dict, 'Rect');
    const punten = paden(streamTekst(ctx, dict.lookup(PDFName.of('AP')).get(PDFName.of('N'))), rect).flat();
    // De lijn loopt langs gebruikers-x, van het begin tot het eind van het woord.
    assert.ok(Math.abs(punten[0].x - 72) < 1e-3 && Math.abs(punten.at(-1).x - 192) < 1e-3, `${subtype}: van begin tot eind`);
    const hoogte = { Underline: 591.4, StrikeOut: 596.4 }[subtype];
    if (hoogte) for (const p of punten) assert.ok(Math.abs(p.y - hoogte) < 1e-3, `${subtype}: lijn op y ${hoogte} (${p.y})`);
  }
  // Zonder bronnen: de getoonde leesrichting 0, dwars over deze tekst, met /OPS_TextDir.
  const zonder = buildTextMarkupDict(ctx, ann, map, { opacity: 1, pageRot: 90 });
  assert.deepEqual(getallenVan(zonder, 'QuadPoints'), [72, 590.4, 72, 602.4, 192, 590.4, 192, 602.4]);
  assert.equal(zonder.get(PDFName.of('OPS_TextDir')).asNumber(), 270);
});

test('de oude vaste volgorde op liggend getoonde tekst van een gedraaide pagina wordt hersteld (#527)', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(90, PAGINA);
  // Getoond liggend (72..192 bij 90..102); in het bestand loopt de tekst langs y.
  const rect = { x: 72, y: 90, width: 120, height: 12 };
  const oud = [90, 192, 102, 192, 90, 72, 102, 72]; // p1 -> p2 is de regelhoogte
  const bronnen = bronMarkeringen(ctx, [ctx.register(bronDict(ctx, 'Underline', [oud]))]);
  const dict = buildTextMarkupDict(ctx, { type: 'textUnderline', ...rect, rects: [rect], color: '#0000FF' }, map, { opacity: 1, pageRot: 90, bronnen });
  assert.deepEqual(getallenVan(dict, 'QuadPoints'), [90, 72, 90, 192, 102, 72, 102, 192], 'in de getoonde leesrichting');
  assert.equal(dict.get(PDFName.of('OPS_TextDir')), undefined);
  assert.equal(bronnen.length, 0);
  // Een quad die al in de getoonde leesrichting staat, ook als het woord korter is dan de regel hoog.
  const kortRect = { x: 72, y: 90, width: 5, height: 12 };
  const kort = [90, 72, 90, 77, 102, 72, 102, 77];
  const kortBron = bronMarkeringen(ctx, [ctx.register(bronDict(ctx, 'StrikeOut', [kort]))]);
  const kortDict = buildTextMarkupDict(ctx, { type: 'textStrikethrough', ...kortRect, rects: [kortRect], color: '#FF0000' }, map, { opacity: 1, pageRot: 90, bronnen: kortBron });
  assert.deepEqual(getallenVan(kortDict, 'QuadPoints'), kort);
});

test('een bron telt alleen bij dezelfde soort, hetzelfde aantal regels en dezelfde vakken (#527)', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(90, PAGINA);
  const bron = [72, 602.4, 192, 602.4, 72, 590.4, 192, 590.4];
  const ann = { type: 'textUnderline', x: 590.4, y: 72, width: 12, height: 120, rects: [{ x: 590.4, y: 72, width: 12, height: 120 }], color: '#0000FF' };
  const zonderBron = [72, 590.4, 72, 602.4, 192, 590.4, 192, 602.4];
  const gevallen = [
    ['andere soort', bronDict(ctx, 'StrikeOut', [bron])],
    ['ander vak', bronDict(ctx, 'Underline', [[72, 602.4, 190, 602.4, 72, 590.4, 190, 590.4]])],
    ['twee regels', bronDict(ctx, 'Underline', [bron, [72, 580, 100, 580, 72, 568, 100, 568]])],
  ];
  for (const [naam, d] of gevallen) {
    const bronnen = bronMarkeringen(ctx, [ctx.register(d)]);
    const dict = buildTextMarkupDict(ctx, ann, map, { opacity: 1, pageRot: 90, bronnen });
    assert.deepEqual(getallenVan(dict, 'QuadPoints'), zonderBron, naam);
    assert.equal(dict.get(PDFName.of('OPS_TextDir')).asNumber(), 270, `${naam}: een eigen markering`);
    assert.equal(bronnen.length, 1, `${naam}: de bron blijft over`);
  }
  // Vakken binnen 0,01 pt (Float32 uit pdf.js) tellen als gelijk; twee gelijke
  // markeringen krijgen elk hun eigen bron.
  const andersom = [192, 590.4, 72, 590.4, 192, 602.4, 72, 602.4];
  const bronnen = bronMarkeringen(ctx, [bron, andersom].map((q) => ctx.register(bronDict(ctx, 'Underline', [q]))));
  const bijna = { ...ann, rects: [{ x: 590.40001, y: 72.00002, width: 11.99997, height: 119.99999 }] };
  assert.deepEqual(getallenVan(buildTextMarkupDict(ctx, bijna, map, { opacity: 1, pageRot: 90, bronnen }), 'QuadPoints'), bron);
  assert.deepEqual(getallenVan(buildTextMarkupDict(ctx, ann, map, { opacity: 1, pageRot: 90, bronnen }), 'QuadPoints'), andersom);
  assert.equal(bronnen.length, 0);
});

test('een schuine quad uit een ander programma blijft precies staan (#527)', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(0, PAGINA);
  // Tekst onder 30 graden: de quad is geen assen-uitgelijnd vak.
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const p = (langs, op) => [100 + langs * c - op * s, 300 + langs * s + op * c];
  const schuin = [...p(0, 10), ...p(80, 10), ...p(0, -2), ...p(80, -2)];
  const xs = schuin.filter((_, i) => i % 2 === 0);
  const ys = schuin.filter((_, i) => i % 2 === 1);
  // Het model: het assen-uitgelijnde vak in de getoonde pagina (y omlaag).
  const r = { x: Math.min(...xs), y: 792 - Math.max(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const bronnen = bronMarkeringen(ctx, [ctx.register(bronDict(ctx, 'Squiggly', [schuin]))]);
  const dict = buildTextMarkupDict(ctx, { type: 'textSquiggly', ...r, rects: [r], color: '#00AA00' }, map, { opacity: 1, pageRot: 0, bronnen });
  assert.deepEqual(getallenVan(dict, 'QuadPoints'), schuin);
});
