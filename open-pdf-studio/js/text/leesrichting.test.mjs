// Leesrichting van een nieuwe tekstmarkering (#527).
//
// De selectie geeft alleen assen-uitgelijnde vakken; of de tekst daarin
// liggend, staand of op zijn kop staat, komt uit de teksttransform van pdf.js
// op de span van de tekstlaag (data-pdf-transform, zie text-layer.js) en de
// rotatie van de pagina. Zonder die richting schreef de opslag een markering
// op staande tekst (een rechtop gezette pagina met /Rotate 90 of 270) dwars
// over de tekst.
//
// Hier: de pure helpers met nagemaakte DOM-knopen, een echte PDF door pdf.js
// tot en met de opgeslagen quads en de onderstreping, en de bedrading in
// text-markup.js en text-selection.js (die in node niet te laden zijn).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';

import { spanTransform, selectionTextDir } from './leesrichting.js';
import { makePointMapper } from '../pdf/saver/correction-dicts.js';
import { buildTextMarkupDict } from '../pdf/saver/text-markup-dict.js';
import { TEXT_ASCENT, TEXT_DESCENT } from '../annotations/corrections/geometry.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Nagemaakte tekstlaag: laag > span (met transform) > tekstknoop. */
function tekstlaag(transform) {
  const laag = { classList: { contains: (c) => c === 'textLayer' }, dataset: { page: '1' }, parentElement: null };
  const span = { dataset: transform ? { pdfTransform: JSON.stringify(transform) } : {}, parentElement: laag };
  const tekst = { parentElement: span };
  return { laag, span, tekst };
}

test('spanTransform: de transform van de span rond een tekstknoop, anders null', () => {
  const { laag, span, tekst } = tekstlaag([12, 0, 0, 12, 72, 700]);
  assert.deepEqual(spanTransform(tekst), [12, 0, 0, 12, 72, 700]);
  assert.deepEqual(spanTransform(span), [12, 0, 0, 12, 72, 700]);
  assert.equal(spanTransform(laag), null, 'de laag zelf heeft geen transform');
  assert.equal(spanTransform(tekstlaag(null).tekst), null);
  assert.equal(spanTransform(null), null);
  const kapot = { dataset: { pdfTransform: '{geen json' }, parentElement: null };
  assert.equal(spanTransform(kapot), null);
});

test('selectionTextDir: van het anker, anders van het eind van de selectie', () => {
  const rechtop = tekstlaag([12, 0, 0, 12, 72, 700]).tekst;
  const leeg = tekstlaag(null).tekst;
  assert.equal(selectionTextDir({ anchorNode: rechtop, focusNode: rechtop }, 90), 90);
  assert.equal(selectionTextDir({ anchorNode: leeg, focusNode: rechtop }, 270), 270);
  assert.equal(selectionTextDir({ anchorNode: leeg, focusNode: leeg }, 0), null);
  assert.equal(selectionTextDir(null, 0), null);
  const scheef = tekstlaag([10, 5, -5, 10, 0, 0]).tekst;
  assert.equal(selectionTextDir({ anchorNode: scheef, focusNode: scheef }, 0), null, 'schuine tekst: geen richting');
});

// ── een echte PDF: tekst rechtop in gebruikersruimte op een gedraaide pagina ──

const WOORD = 'Onderstreep dit woord';
const GROOTTE = 12;

/** Eén pagina per geval; de tekst staat bij (72, 600) of, gedraaid, bij (300, 100). */
async function bouwPdf(gevallen) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const { rotate, tekstDraai } of gevallen) {
    const pagina = doc.addPage([612, 792]);
    pagina.setRotation(degrees(rotate));
    const plek = tekstDraai ? { x: 300, y: 100 } : { x: 72, y: 600 };
    pagina.drawText(WOORD, { ...plek, size: GROOTTE, font, rotate: degrees(tekstDraai || 0) });
  }
  return doc.save();
}

/**
 * Wat de app bij het selecteren van het woord krijgt: het vak in de
 * paginaruimte (uit pdf.js, los van de code onder test) en de transform van
 * de span.
 */
async function selecteer(bytes, n) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await lezer.getPage(n);
  const viewport = pagina.getViewport({ scale: 1 });
  const item = (await pagina.getTextContent()).items.find((i) => i.str === WOORD);
  assert.ok(item, `het woord op pagina ${n}`);
  const [a, b, c, d, e, f] = item.transform;
  const h = Math.hypot(a, b);
  const langs = { x: a / h, y: b / h };
  const op = { x: c / Math.hypot(c, d), y: d / Math.hypot(c, d) };
  // Hoeken van het tekstvak in gebruikersruimte: basislijn, 0,2 h eronder, 0,8 h erboven.
  const punt = (s, t) => ({ x: e + langs.x * s + op.x * t, y: f + langs.y * s + op.y * t });
  const hoeken = [punt(0, -TEXT_DESCENT * h), punt(item.width, -TEXT_DESCENT * h), punt(0, TEXT_ASCENT * h), punt(item.width, TEXT_ASCENT * h)];
  const scherm = hoeken.map((p) => viewport.convertToViewportPoint(p.x, p.y));
  const xs = scherm.map((p) => p[0]);
  const ys = scherm.map((p) => p[1]);
  const rect = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return { rect, transform: item.transform, rotation: viewport.rotation, oorsprong: { x: e, y: f }, langs, op, breedte: item.width, h };
}

function streamTekst(ctx, ref) {
  const n = ctx.lookup(ref);
  return Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1');
}

/** Punten van de eerste lijn in de appearance, in gebruikersruimte. */
function lijnpunten(tekst, [llx, lly]) {
  return [...tekst.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\b/g)].map((m) => ({ x: Number(m[1]) + llx, y: Number(m[2]) + lly }));
}

const PAGINA = { x: 0, y: 0, width: 612, height: 792 };

test('een markering op rechtop staande tekst van een gedraaide pagina loopt langs de tekst (#527)', async () => {
  const gevallen = [
    { rotate: 90 }, { rotate: 180 }, { rotate: 270 }, { rotate: 0 },
    // Ter vergelijking: inhoud die de /Rotate goedmaakt, dus liggend getoond.
    { rotate: 90, tekstDraai: 90 },
  ];
  const bytes = await bouwPdf(gevallen);
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (let i = 0; i < gevallen.length; i++) {
    const { rotate, tekstDraai } = gevallen[i];
    const label = `/Rotate ${rotate}${tekstDraai ? `, tekst ${tekstDraai} graden gedraaid` : ''}`;
    const sel = await selecteer(bytes, i + 1);
    const tekstknoop = tekstlaag(sel.transform).tekst;
    // Zoals createTextMarkupAnnotation: de rechthoeken plus de leesrichting.
    const textDir = selectionTextDir({ anchorNode: tekstknoop, focusNode: tekstknoop }, sel.rotation);
    assert.notEqual(textDir, null, label);
    for (const type of ['textUnderline', 'textStrikethrough']) {
      const ann = { type, ...sel.rect, rects: [{ ...sel.rect }], color: '#0000FF', textDir };
      const dict = buildTextMarkupDict(ctx, ann, makePointMapper(rotate, PAGINA), { opacity: 1, pageRot: rotate });
      const q = dict.lookup(PDFName.of('QuadPoints')).asArray().map((v) => v.asNumber());
      // p1 -> p2 en p3 -> p4 lopen in gebruikersruimte langs de basislijn, van begin naar eind.
      const langs = (dx, dy) => dx * sel.langs.x + dy * sel.langs.y;
      const dwars = (dx, dy) => dx * sel.op.x + dy * sel.op.y;
      assert.ok(Math.abs(langs(q[2] - q[0], q[3] - q[1]) - sel.breedte) < 1e-3, `${type}, ${label}: p1 -> p2 is de woordlengte langs de tekst`);
      assert.ok(Math.abs(dwars(q[2] - q[0], q[3] - q[1])) < 1e-3, `${type}, ${label}: p1 -> p2 niet dwars`);
      assert.ok(Math.abs(langs(q[6] - q[4], q[7] - q[5]) - sel.breedte) < 1e-3, `${type}, ${label}: p3 -> p4 langs de tekst`);
      assert.ok(dwars(q[0] - q[4], q[1] - q[5]) > 0, `${type}, ${label}: p1 aan de bovenkant van de letters`);
      // De lijn van de appearance in gebruikersruimte, ten opzichte van de basislijn.
      const rect = dict.lookup(PDFName.of('Rect')).asArray().map((v) => v.asNumber());
      const punten = lijnpunten(streamTekst(ctx, dict.lookup(PDFName.of('AP')).get(PDFName.of('N'))), rect);
      assert.equal(punten.length, 2, `${type}, ${label}: één rechte lijn`);
      const [van, tot] = punten.map((p) => ({
        s: langs(p.x - sel.oorsprong.x, p.y - sel.oorsprong.y),
        t: dwars(p.x - sel.oorsprong.x, p.y - sel.oorsprong.y),
      }));
      assert.ok(Math.abs(van.s) < 1e-3 && Math.abs(tot.s - sel.breedte) < 1e-3, `${type}, ${label}: de lijn loopt van begin tot eind van het woord`);
      // Onderstreping: 1 pt boven de onderkant van de letters; doorhaling: midden.
      const hoogte = type === 'textUnderline' ? -TEXT_DESCENT * sel.h + 1 : (TEXT_ASCENT - TEXT_DESCENT) * sel.h / 2;
      assert.ok(Math.abs(van.t - hoogte) < 1e-3 && Math.abs(tot.t - hoogte) < 1e-3,
        `${type}, ${label}: de lijn ligt op ${hoogte} van de basislijn (${van.t}, ${tot.t})`);
    }
  }
});

// ── bedrading ───────────────────────────────────────────────────────────────

test('createTextMarkupAnnotation geeft de leesrichting van de selectie mee, alleen als die bekend is', () => {
  const markering = bron('./text-markup.js');
  assert.match(markering, /import \{[^}]*getSelectionTextDir[^}]*\} from '\.\/text-selection\.js'/);
  const maken = /export function createTextMarkupAnnotation[\s\S]*?\n\}\n/.exec(markering)[0];
  assert.match(maken, /const textDir = getSelectionTextDir\(\);/);
  assert.match(maken, /createAnnotation\(\{[\s\S]*\.\.\.\(textDir !== null \? \{ textDir \} : \{\}\)[\s\S]*\}\);/);
});

test('getSelectionTextDir rekent met de eigen /Rotate plus de paginarotatie in de app, niet de weergaverotatie', () => {
  const selectie = bron('./text-selection.js');
  assert.match(selectie, /import \{[^}]*selectionTextDir[^}]*\} from '\.\/leesrichting\.js'/);
  const functie = /export function getSelectionTextDir\(\)[\s\S]*?\n\}\n/.exec(selectie)?.[0];
  assert.ok(functie, 'getSelectionTextDir bestaat');
  assert.match(functie, /pageDims\?\.\[pageNum\]\?\.rotation/);
  assert.match(functie, /pageRotations\?\.\[pageNum\]/);
  assert.match(functie, /selectionTextDir\(selection, /);
  assert.doesNotMatch(functie, /viewRotation|weergaveRotatie/);
});
