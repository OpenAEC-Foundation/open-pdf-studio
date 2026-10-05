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
import { PDFDocument, PDFName, PDFRef, PDFDict, PDFString, PDFHexString } from 'pdf-lib';

import { buildTextEditFixture, PAGINAS, OPBOUW, nm, OUDE_M } from './saver/test-fixtures/text-edit-fixture.mjs';
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extraVoorAnnotatie } from './loader/extra-sleutel.js';
import { opmerkingUitAnnot, zonderDubbeleOpmerking } from './loader/annotatie-opmerking.js';
import { caretPropsFromPdf, textEditPropsFromPdf, resolveGroupLinks } from './loader/correction-load.js';
import {
  makePointMapper, buildTextEditStrikeDict, buildCaretDict, addLoadedMarkupKeys,
  applyGroupLinks, correctionRefKeys, dropOrphanPopups,
} from './saver/correction-dicts.js';
import { buildTextMarkupDict } from './saver/text-markup-dict.js';
import { _rotVisualMapper, _remapRect } from './saver/rotatie-mapper.js';
import { zetDoorzichtigheidInAp } from './saver/utils.js';
import { linkPlanForSave, isTextEditStrike, saveColor, correctionKind } from '../annotations/corrections/model.js';
import { colorArrayToHex, hexToColorArray } from '../utils/colors.js';

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
      const vr = viewport.convertToViewportRectangle(r);
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

function remap(annRaw, rot, cropBox) {
  const m = _rotVisualMapper(rot, cropBox.width, cropBox.height);
  const ann = { ...annRaw, ..._remapRect(annRaw, m) };
  if (Array.isArray(ann.rects)) ann.rects = ann.rects.map((r) => ({ ...r, ..._remapRect(r, m) }));
  return ann;
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
    const convertX = (x) => x + cropBox.x;
    const convertY = (y) => cropBox.y + cropBox.height - y;
    const plan = linkPlanForSave(pageAnnotations);
    const gekoppeldeKinderen = new Set(plan.links.map((l) => l.childId));
    const puntNaarPdf = makePointMapper(pageRot, cropBox);
    const refById = new Map();
    const dictById = new Map();
    for (const annRaw of pageAnnotations) {
      const ann = pageRot ? remap(annRaw, pageRot, cropBox) : annRaw;
      const opacity = ann.opacity !== undefined ? ann.opacity : 1;
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
        annotDict = buildTextMarkupDict(ctx, ann, { convertX, convertY, opacity });
        addLoadedMarkupKeys(annotDict, ann);
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

test('de oude doorhaling zonder /IT houdt quads, /Contents en de /M-afhandeling', async () => {
  const { origineel, eerste, tweede } = await rondgang();
  origineel.forEach((pagina, i) => {
    const bron = pagina.find((a) => a.subtype === '/StrikeOut' && !a.it);
    for (const save of [eerste, tweede]) {
      const oud = save[i].find((a) => a.subtype === '/StrikeOut' && !a.it);
      assert.deepEqual(oud.quads, bron.quads, `pagina ${i + 1}: quads byte-gelijk`);
      assert.equal(oud.contents, OPBOUW.oud.opmerking);
      assert.match(oud.m, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, '/M blijft een ISO-tijd zoals voorheen');
      assert.equal(oud.nm, undefined);
      assert.equal(oud.subj, undefined);
      assert.equal(oud.heeftAp, false, 'geen appearance, zoals voorheen');
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
