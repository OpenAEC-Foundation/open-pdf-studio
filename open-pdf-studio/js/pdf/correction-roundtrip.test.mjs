// Opslag-rondgang van proefleescorrecties in node (#508).
//
// Het testbestand (saver/test-fixtures/text-edit-fixture.mjs) gaat door de
// lader (pdf.js + extractAnnotationColors + de pure omzetters), wordt
// opgeslagen met de bouwstenen van de saver, opnieuw geladen en nog een keer
// opgeslagen. Beide saves moeten gelijk zijn in soort, tekst, intent, /NM,
// /Subj, koppelingen en quads (binnen 0,01 pt).
//
// saver.js en de converter zijn in node niet te laden; de stappen hieronder
// volgen hun tak voor /Caret en tekstmarkeringen met dezelfde functies.
// correction-wiring.test.mjs bewaakt dat saver.js en de lader die functies
// ook echt gebruiken. Alles blijft in het geheugen: er wordt geen bestand
// geschreven.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRef, PDFDict, PDFString, PDFHexString, decodePDFRawStream, degrees } from 'pdf-lib';

import {
  buildTextEditFixture, PAGINAS, OPBOUW, nm, OUDE_M, naarGebruiker, MEDIABOX, karetVak,
} from './saver/test-fixtures/text-edit-fixture.mjs';
import { replaceStrikeColor } from '../annotations/rendering/caret.js';
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extraVoorAnnotatie } from './loader/extra-sleutel.js';
import { opmerkingUitAnnot, zonderDubbeleOpmerking } from './loader/annotatie-opmerking.js';
import { caretPropsFromPdf, textEditPropsFromPdf, resolveGroupLinks } from './loader/correction-load.js';
import {
  makePointMapper, buildTextEditStrikeDict, buildCaretDict, addLoadedMarkupKeys,
  applyGroupLinks, correctionRefKeys, dropOrphanPopups,
} from './saver/correction-dicts.js';
import { buildTextMarkupDict, bronMarkeringen } from './saver/text-markup-dict.js';
import { zetDoorzichtigheidInAp } from './saver/utils.js';
import { linkPlanForSave, isTextEditStrike, saveColor, correctionKind } from '../annotations/corrections/model.js';
import { colorArrayToHex, hexToColorArray } from '../utils/colors.js';
import { viewportRectangle } from './pdfjs-record.js';

const HANDLED = new Set([
  '/Highlight', '/Underline', '/StrikeOut', '/Squiggly',
  '/Square', '/Circle', '/Line', '/Ink', '/PolyLine', '/Polygon',
  '/Text', '/FreeText', '/Stamp', '/Caret',
]);
const MARKERING = { Highlight: 'textHighlight', Underline: 'textUnderline', StrikeOut: 'textStrikethrough', Squiggly: 'textSquiggly' };

// parsePdfDate uit annotation-converter.js
function datum(pdfDate) {
  if (typeof pdfDate === 'string' && pdfDate.startsWith('D:')) {
    const s = pdfDate.substring(2);
    return new Date(`${s.substring(0, 4)}-${s.substring(4, 6) || '01'}-${s.substring(6, 8) || '01'}T${s.substring(8, 10) || '00'}:${s.substring(10, 12) || '00'}:${s.substring(12, 14) || '00'}Z`).toISOString();
  }
  const d = new Date(pdfDate);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

let volgnummer = 0;

/** Laadt alle pagina's zoals loader.js + annotation-converter.js. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pdfLib = await PDFDocument.load(bytes);
  const model = [];
  for (let n = 1; n <= lezer.numPages; n++) {
    const pagina = await lezer.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    const kaart = await extractAnnotationColors(n, pdfLib);
    const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
    const convertRect = (r) => {
      const vr = viewportRectangle(viewport, r);
      return { x: Math.min(vr[0], vr[2]), y: Math.min(vr[1], vr[3]), width: Math.abs(vr[2] - vr[0]), height: Math.abs(vr[3] - vr[1]) };
    };
    const byPdfId = new Map();
    const groepen = [];
    for (const annot of await pagina.getAnnotations()) {
      const extra = extraVoorAnnotatie(kaart, annot) || {};
      const base = {
        id: `m${++volgnummer}`, page: n,
        author: annot.titleObj?.str || 'User',
        subject: opmerkingUitAnnot(annot),
        createdAt: datum(annot.creationDate), modifiedAt: datum(annot.modificationDate),
        opacity: annot.opacity !== undefined ? annot.opacity : (extra.opacity ?? 1),
      };
      let omgezet = null;
      if (annot.subtype === 'Caret') {
        omgezet = { ...base, ...caretPropsFromPdf(annot, extra, convertRect, viewport.rotation || 0) };
      } else if (MARKERING[annot.subtype]) {
        const rects = [];
        const q = annot.quadPoints || [];
        for (let i = 0; i + 8 <= q.length; i += 8) {
          const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
          const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
          rects.push(convertRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
        }
        const minX = Math.min(...rects.map((r) => r.x));
        const minY = Math.min(...rects.map((r) => r.y));
        const maxX = Math.max(...rects.map((r) => r.x + r.width));
        const maxY = Math.max(...rects.map((r) => r.y + r.height));
        omgezet = {
          ...base, type: MARKERING[annot.subtype], x: minX, y: minY, width: maxX - minX, height: maxY - minY,
          rects, color: colorArrayToHex(annot.color, '#FFFF00'), fillColor: colorArrayToHex(annot.color, '#FFFF00'),
          ...textEditPropsFromPdf(annot, extra, convertPoint, viewport.rotation || 0),
        };
      }
      if (!omgezet) continue;
      zonderDubbeleOpmerking(omgezet);
      if (annot.id) byPdfId.set(annot.id, omgezet);
      if (annot.replyType === 'Group' && annot.inReplyTo) {
        groepen.push({ converted: omgezet, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
      }
      model.push(omgezet);
    }
    resolveGroupLinks(groepen, byPdfId);
  }
  return model;
}

/** Slaat het model op over `bytes` zoals saver.js (alleen correcties en markeringen). */
async function slaOp(bytes, model) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  doc.getPages().forEach((pagina, i) => {
    const n = i + 1;
    const pageRot = ((pagina.getRotation().angle % 360) + 360) % 360;
    const pageAnnotations = model.filter((a) => a.page === n);
    let annotsArray = [];
    const verwijderdeRefs = [];
    for (const ref of ctx.lookup(pagina.node.get(PDFName.of('Annots')))?.asArray() || []) {
      const subtype = ctx.lookup(ref)?.get?.(PDFName.of('Subtype'))?.toString();
      if (!subtype || !HANDLED.has(subtype)) annotsArray.push(ref);
      else verwijderdeRefs.push(ref);
    }
    const cropBox = pagina.getCropBox();
    const plan = linkPlanForSave(pageAnnotations);
    const gekoppeldeKinderen = new Set(plan.links.map((l) => l.childId));
    const puntNaarPdf = makePointMapper(pageRot, cropBox);
    const markeringBronnen = bronMarkeringen(ctx, verwijderdeRefs);
    const refById = new Map();
    const dictById = new Map();
    for (const annRaw of pageAnnotations) {
      const opacity = annRaw.opacity !== undefined ? annRaw.opacity : 1;
      let annotDict;
      if (annRaw.type === 'caret') {
        const karet = plan.stripReplaceIntent.has(annRaw.id) ? { ...annRaw, intent: undefined } : annRaw;
        annotDict = buildCaretDict(ctx, karet, puntNaarPdf, {
          rgb: hexToColorArray(saveColor(karet, pageAnnotations, plan)), opacity, pageRot,
        });
      } else if (isTextEditStrike(annRaw)) {
        annotDict = buildTextEditStrikeDict(ctx, annRaw, puntNaarPdf, {
          rgb: hexToColorArray(saveColor(annRaw, pageAnnotations, plan)), opacity, pageRot,
          linked: gekoppeldeKinderen.has(annRaw.id),
        });
      } else {
        // Gewone markering (#527): ook per punt, in leesrichting.
        // Een gekoppeld kind tekent in de kleur die applyGroupLinks in /C zet.
        annotDict = buildTextMarkupDict(ctx, annRaw, puntNaarPdf, {
          opacity, pageRot, bronnen: markeringBronnen,
          rgb: gekoppeldeKinderen.has(annRaw.id) ? hexToColorArray(saveColor(annRaw, pageAnnotations, plan)) : undefined,
        });
        addLoadedMarkupKeys(annotDict, annRaw);
      }
      zetDoorzichtigheidInAp(ctx, annotDict, opacity);
      const ref = ctx.register(annotDict);
      annotsArray.push(ref);
      if (annRaw.type === 'caret' || annRaw.type === 'textStrikethrough') {
        refById.set(annRaw.id, ref);
        dictById.set(annRaw.id, annotDict);
      }
    }
    applyGroupLinks(ctx, plan, refById, dictById, annotsArray);
    annotsArray = dropOrphanPopups(ctx, annotsArray, correctionRefKeys(ctx, verwijderdeRefs));
    pagina.node.set(PDFName.of('Annots'), ctx.obj(annotsArray));
  });
  return doc.save();
}

const tekstVan = (ctx, raw) => {
  const v = raw === undefined ? undefined : ctx.lookup(raw);
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined;
};

/** Beschrijving van alle annotaties per pagina, uit de rauwe bytes. */
async function beschrijf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  return doc.getPages().map((pagina) => {
    const refs = ctx.lookup(pagina.node.get(PDFName.of('Annots'))).asArray();
    return refs.map((ref) => {
      const d = ctx.lookup(ref);
      const irt = d.get(PDFName.of('IRT'));
      const quads = d.get(PDFName.of('QuadPoints'));
      return {
        ref: ref.toString(),
        subtype: d.get(PDFName.of('Subtype'))?.toString(),
        contents: tekstVan(ctx, d.get(PDFName.of('Contents'))),
        it: d.get(PDFName.of('IT'))?.toString(),
        nm: tekstVan(ctx, d.get(PDFName.of('NM'))),
        subj: tekstVan(ctx, d.get(PDFName.of('Subj'))),
        rt: d.get(PDFName.of('RT'))?.toString(),
        irtNm: irt instanceof PDFRef ? tekstVan(ctx, ctx.lookup(irt).get(PDFName.of('NM'))) : undefined,
        quads: quads ? ctx.lookup(quads).asArray().map((v) => v.asNumber()) : undefined,
        m: tekstVan(ctx, d.get(PDFName.of('M'))),
        marked: tekstVan(ctx, d.get(PDFName.of('OPS_MarkedText'))),
        heeftAp: !!d.get(PDFName.of('AP')),
        dict: d instanceof PDFDict ? d : null,
      };
    });
  });
}

let resultaat;
async function rondgang() {
  if (resultaat) return resultaat;
  const { bytes } = await buildTextEditFixture();
  const model1 = await laad(bytes);
  const save1 = await slaOp(bytes, model1);
  const model2 = await laad(save1);
  const save2 = await slaOp(save1, model2);
  const model3 = await laad(save2);
  resultaat = {
    bytes, model1, model2, model3, save1, save2,
    origineel: await beschrijf(bytes), eerste: await beschrijf(save1), tweede: await beschrijf(save2),
  };
  return resultaat;
}

const opNm = (lijst, waarde) => lijst.find((a) => a.nm === waarde);

test('beide saves zijn gelijk in soort, tekst, intent, /NM, /Subj, koppelingen en quads', async () => {
  const { eerste, tweede } = await rondgang();
  assert.equal(eerste.length, tweede.length);
  eerste.forEach((pagina, i) => {
    assert.equal(pagina.length, tweede[i].length, `pagina ${i + 1}: aantal annotaties`);
    pagina.forEach((a, j) => {
      const b = tweede[i][j];
      const label = `pagina ${i + 1}, annotatie ${j + 1} (${a.subtype} ${a.nm ?? ''})`;
      for (const k of ['subtype', 'contents', 'it', 'nm', 'subj', 'rt', 'irtNm', 'marked', 'heeftAp']) {
        assert.deepEqual(b[k], a[k], `${label}: ${k}`);
      }
      assert.equal(a.quads?.length, b.quads?.length, `${label}: aantal quad-getallen`);
      (a.quads || []).forEach((v, k) => assert.ok(Math.abs(v - b.quads[k]) <= 0.01, `${label}: quad ${k} ${v} vs ${b.quads[k]}`));
    });
  });
});

test('geen invoegteken verdubbeld of verloren', async () => {
  const { origineel, eerste, tweede, model1, model2, model3 } = await rondgang();
  for (const lijst of [origineel, eerste, tweede]) {
    lijst.forEach((pagina, i) => assert.equal(pagina.filter((a) => a.subtype === '/Caret').length, 3, `pagina ${i + 1}`));
  }
  for (const model of [model1, model2, model3]) {
    for (let n = 1; n <= PAGINAS.length; n++) {
      const pagina = model.filter((a) => a.page === n);
      assert.equal(pagina.filter((a) => a.type === 'caret').length, 3, `model pagina ${n}: invoegtekens`);
      assert.equal(pagina.filter((a) => a.type === 'textStrikethrough').length, 4, `model pagina ${n}: doorhalingen`);
    }
  }
});

test('de vervanging en het omgekeerde paar staan als invoegteken-ouder met doorhaling-kind', async () => {
  const { eerste, model1, model3 } = await rondgang();
  eerste.forEach((pagina, i) => {
    const p = i + 1;
    for (const [karetNm, doorNm] of [[nm(p, 'replace'), nm(p, 'replace-strike')], [nm(p, 'rev-caret'), nm(p, 'rev-strike')]]) {
      const karet = opNm(pagina, karetNm);
      const door = opNm(pagina, doorNm);
      assert.equal(door.irtNm, karetNm, `${doorNm} wijst naar ${karetNm}`);
      assert.equal(door.rt, '/Group');
      assert.equal(door.contents, undefined, `${doorNm} heeft geen /Contents`);
      assert.equal(karet.irtNm, undefined, `${karetNm} is de ouder`);
      assert.equal(karet.rt, undefined);
      assert.equal(karet.it, '/Replace');
      assert.ok(pagina.indexOf(door) < pagina.indexOf(karet), 'de doorhaling staat vóór haar invoegteken');
      // Het kind draagt /C, /T, /M en /CreationDate van de ouder.
      for (const k of ['C', 'T', 'M', 'CreationDate']) {
        assert.equal(door.dict.get(PDFName.of(k))?.toString(), karet.dict.get(PDFName.of(k))?.toString(), `${doorNm} ${k}`);
      }
    }
    assert.equal(opNm(pagina, nm(p, 'replace')).contents, OPBOUW.vervang.tekst);
    assert.equal(opNm(pagina, nm(p, 'rev-caret')).contents, OPBOUW.omgekeerd.tekst, 'eigen tekst van het invoegteken');
  });
  for (const model of [model1, model3]) {
    for (let p = 1; p <= PAGINAS.length; p++) {
      const pagina = model.filter((a) => a.page === p);
      const byId = new Map(pagina.map((a) => [a.id, a]));
      for (const [karetNm, doorNm] of [[nm(p, 'replace'), nm(p, 'replace-strike')], [nm(p, 'rev-caret'), nm(p, 'rev-strike')]]) {
        const karet = pagina.find((a) => a.nm === karetNm);
        const door = pagina.find((a) => a.nm === doorNm);
        assert.equal(correctionKind(karet, byId), 'replace', karetNm);
        assert.equal(correctionKind(door, byId), 'replaceChild', doorNm);
        assert.equal(door.inReplyTo, karet.id);
        assert.equal(door.groupId, karet.groupId);
      }
    }
  }
});

test('textDir is 0 voor elke correctie op elke /Rotate', async () => {
  const { model1, model3 } = await rondgang();
  for (const model of [model1, model3]) {
    for (const a of model.filter((x) => x.type === 'caret' || x.intent === 'StrikeOutTextEdit')) {
      assert.equal(a.textDir, 0, `${a.nm} op pagina ${a.page}`);
    }
  }
});

test('de oude doorhaling zonder /IT houdt /Contents en de /M-afhandeling; quads in leesrichting met /AP (#527)', async () => {
  const { origineel, eerste, tweede } = await rondgang();
  origineel.forEach((pagina, i) => {
    const bron = pagina.find((a) => a.subtype === '/StrikeOut' && !a.it);
    // Begin-boven, eind-boven, begin-onder, eind-onder van de getoonde regel,
    // los van de saver omgerekend. De oude vaste volgorde viel alleen op
    // /Rotate 0 hiermee samen.
    const map = naarGebruiker(i);
    const leesrichting = OPBOUW.oud.rects.flatMap((r) => [
      map(r.x, r.y), map(r.x + r.width, r.y), map(r.x, r.y + r.height), map(r.x + r.width, r.y + r.height),
    ].flatMap((p) => [p.x, p.y]));
    if (PAGINAS[i].rotate === 0) assert.deepEqual(bron.quads, leesrichting, 'op /Rotate 0 was de oude volgorde al de leesrichting');
    else assert.notDeepEqual(bron.quads, leesrichting, `pagina ${i + 1}: de oude volgorde liep niet langs de tekst`);
    // Op /Rotate 90 en 270 is p1 -> p2 van de oude volgorde de regelhoogte: die
    // wordt hersteld. Op /Rotate 180 is het de lange kant, net als bij tekst die
    // in gebruikersruimte rechtop staat en op zijn kop getoond wordt (dan is
    // het wel de leesrichting); daar blijven de quads uit het bestand, zoals de
    // oude saver ze ook schreef. Een doorhaling ligt in beide gevallen op
    // dezelfde lijn.
    const verwacht = PAGINAS[i].rotate === 180 ? bron.quads : leesrichting;
    for (const save of [eerste, tweede]) {
      const oud = save[i].find((a) => a.subtype === '/StrikeOut' && !a.it);
      assert.equal(oud.quads.length, verwacht.length);
      oud.quads.forEach((v, k) => assert.ok(Math.abs(v - verwacht[k]) <= 1e-3, `pagina ${i + 1}: quad ${k} ${v} vs ${verwacht[k]}`));
      assert.equal(oud.dict.get(PDFName.of('OPS_TextDir')), undefined, `pagina ${i + 1}: geen /OPS_TextDir, de lader blijft zoals hij was`);
      assert.equal(oud.contents, OPBOUW.oud.opmerking);
      assert.match(oud.m, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, '/M blijft een ISO-tijd zoals voorheen');
      assert.equal(oud.nm, undefined);
      assert.equal(oud.subj, undefined);
      assert.equal(oud.it, undefined, 'blijft een gewone doorhaling');
      assert.equal(oud.heeftAp, true, 'een appearance langs de tekst');
    }
    assert.equal(bron.m, OUDE_M);
  });
});

test('vreemde /Subj en /NM blijven; doorgehaalde tekst staat alleen in /OPS_MarkedText', async () => {
  const { eerste, tweede } = await rondgang();
  for (const save of [eerste, tweede]) {
    save.forEach((pagina, i) => {
      const p = i + 1;
      assert.equal(opNm(pagina, nm(p, 'replace')).subj, 'Inserted Text');
      assert.equal(opNm(pagina, nm(p, 'replace-strike')).subj, 'Cross-Out');
      assert.equal(opNm(pagina, nm(p, 'insert')).contents, OPBOUW.invoeg.tekst);
      assert.equal(opNm(pagina, nm(p, 'insert')).it, undefined);
      const schrap = opNm(pagina, nm(p, 'delete'));
      assert.equal(schrap.marked, OPBOUW.schrap.gemarkeerd);
      assert.equal(schrap.it, '/StrikeOutTextEdit');
      assert.equal(schrap.quads.length, 16);
      for (const a of pagina) assert.notEqual(a.contents, OPBOUW.schrap.gemarkeerd, 'niet in /Contents');
      // Elke correctie heeft een appearance.
      for (const a of pagina.filter((x) => x.subtype === '/Caret' || x.it === '/StrikeOutTextEdit')) {
        assert.ok(a.heeftAp, `${a.nm} heeft een /AP`);
      }
    });
  }
});

test('de popup van het herschreven invoegteken valt weg, verder blijft niets achter', async () => {
  const { origineel, eerste } = await rondgang();
  origineel.forEach((pagina, i) => {
    assert.equal(pagina.filter((a) => a.subtype === '/Popup').length, 1);
    assert.equal(eerste[i].filter((a) => a.subtype === '/Popup').length, 0);
    assert.equal(eerste[i].length, pagina.length - 1);
  });
});

test('een tweede save van een eigen save laat het bestand gelijk', async () => {
  const { eerste, tweede } = await rondgang();
  const zonderRef = (lijst) => lijst.map((p) => p.map(({ ref, dict, quads, m, ...rest }) => ({ ...rest, quads: quads?.map((v) => Math.round(v * 100) / 100) })));
  assert.deepEqual(zonderRef(tweede), zonderRef(eerste));
});

// ── een vervanging waarvan de doorhaling geen /IT heeft ─────────────────────
//
// De lader neemt zo'n paar ook als vervanging (/IRT plus /RT /Group is genoeg).
// De doorhaling gaat dan niet als tekstcorrectie maar als gewone markering de
// saver door; applyGroupLinks zet daarna /C van het invoegteken. De /AP moet
// diezelfde kleur hebben, zoals het scherm de doorhaling ook tekent
// (replaceStrikeColor) en zoals de tak voor tekstcorrecties het al deed.

async function vervangingZonderIt() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (const i of [0, 1]) {
    const pagina = doc.addPage([MEDIABOX[2], MEDIABOX[3]]);
    pagina.setRotation(degrees(PAGINAS[i].rotate));
    const { x, y, width, height } = PAGINAS[i].cropBox;
    pagina.setCropBox(x, y, width, height);
    const map = naarGebruiker(i);
    const vak = karetVak(OPBOUW.vervang.P.x, OPBOUW.vervang.P.y);
    const hoeken = [map(vak.x, vak.y), map(vak.x + vak.width, vak.y + vak.height)];
    const karetRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Caret', IT: 'Replace', Sy: 'None', Contents: PDFString.of('the'),
      Rect: [Math.min(hoeken[0].x, hoeken[1].x), Math.min(hoeken[0].y, hoeken[1].y), Math.max(hoeken[0].x, hoeken[1].x), Math.max(hoeken[0].y, hoeken[1].y)],
      NM: PDFString.of(`zonder-it-${i + 1}-caret`), C: [0.6, 0, 0.8], CA: 1, F: 4, T: PDFString.of('Reviewer'),
    }));
    const r = OPBOUW.vervang.rects[0];
    const quad = [map(r.x, r.y), map(r.x + r.width, r.y), map(r.x, r.y + r.height), map(r.x + r.width, r.y + r.height)].flatMap((p) => [p.x, p.y]);
    const xs = quad.filter((_, k) => k % 2 === 0);
    const ys = quad.filter((_, k) => k % 2 === 1);
    const kindRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'StrikeOut', QuadPoints: quad,
      Rect: [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1],
      IRT: karetRef, RT: 'Group', NM: PDFString.of(`zonder-it-${i + 1}-strike`), C: [1, 0, 0], CA: 1, F: 4, T: PDFString.of('Reviewer'),
    }));
    pagina.node.set(PDFName.of('Annots'), ctx.obj([kindRef, karetRef]));
  }
  return doc.save();
}

test('een vervanging met een doorhaling zonder /IT: na een nieuwe kleur tekent de /AP in de kleur van /C (#527)', async () => {
  const bytes = await vervangingZonderIt();
  const model = await laad(bytes);
  for (const n of [1, 2]) {
    const karet = model.find((a) => a.page === n && a.type === 'caret');
    const kind = model.find((a) => a.page === n && a.type === 'textStrikethrough');
    assert.equal(kind.intent, undefined, 'geen /IT');
    assert.equal(isTextEditStrike(kind), false, 'dus de tak voor gewone markeringen');
    assert.equal(correctionKind(kind, model), 'replaceChild');
    // De gebruiker geeft de vervanging een andere kleur (het paneel past het invoegteken aan).
    karet.color = '#00AA00';
    assert.equal(replaceStrikeColor(kind, model), '#00AA00', 'het scherm tekent de doorhaling in de kleur van het invoegteken');
  }
  const doc = await PDFDocument.load(await slaOp(bytes, model));
  const ctx = doc.context;
  doc.getPages().forEach((pagina, i) => {
    const kind = ctx.lookup(pagina.node.get(PDFName.of('Annots'))).asArray().map((ref) => ctx.lookup(ref))
      .find((d) => d.get(PDFName.of('Subtype'))?.toString() === '/StrikeOut');
    const label = `pagina ${i + 1}`;
    assert.equal(kind.get(PDFName.of('RT'))?.toString(), '/Group', `${label}: gekoppeld`);
    const c = kind.lookup(PDFName.of('C')).asArray().map((v) => v.asNumber());
    hexToColorArray('#00AA00').forEach((v, k) => assert.ok(Math.abs(c[k] - v) < 1e-6, `${label}: /C is de kleur van het invoegteken`));
    const ap = ctx.lookup(kind.lookup(PDFName.of('AP')).get(PDFName.of('N')));
    const tekst = Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
    const rg = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) RG/.exec(tekst);
    assert.ok(rg, `${label}: de /AP zet een lijnkleur`);
    rg.slice(1, 4).map(Number).forEach((v, k) => assert.ok(Math.abs(v - c[k]) < 1e-3, `${label}: lijnkleur ${rg[0]} is /C ${c.join(' ')}`));
  });
});
