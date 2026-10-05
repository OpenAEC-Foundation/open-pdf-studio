// Woordenboeken van proefleescorrecties (#508), geschreven met pdf-lib en
// teruggelezen met pdf-lib (de rauwe sleutels) en pdf.js (wat een lezer ziet).
//
// Elke controle loopt over /Rotate 0, 90, 180 en 270 en over een verschoven
// CropBox: de opslag rekent per PUNT om en bouwt nooit een assen-uitgelijnd
// vak na het omrekenen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRef, PDFHexString, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';

import { _rotVisualMapper, _remapRect } from './rotatie-mapper.js';
import {
  pdfDate, makePointMapper, buildStrikeQuads, buildStrikeAppearance, buildTextEditStrikeDict,
  buildCaretDict, addTextEditKeys, addLoadedMarkupKeys, applyGroupLinks, correctionRefKeys, dropOrphanPopups,
} from './correction-dicts.js';
import { linkPlanForSave, saveColor } from '../../annotations/corrections/model.js';
import { quadCorners, caretGlyphBox, upVector, textDirFromVector } from '../../annotations/corrections/geometry.js';
import { hexToColorArray } from '../../utils/colors.js';

const PAGINAS = [
  { rotate: 0, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 90, cropBox: { x: 36, y: 48, width: 540, height: 720 } },
  { rotate: 180, cropBox: { x: 20, y: 30, width: 560, height: 700 } },
  { rotate: 270, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
];

const PAARS = hexToColorArray('#9900CC');
const ROOD = hexToColorArray('#FF0000');
const BLAUW = hexToColorArray('#0066FF');
const H = 12;
const tekstRect = (x1, x2, basis) => ({ x: x1, y: basis - 0.8 * H, width: x2 - x1, height: H });

function modellen(textDir = 0) {
  const P = textDir === 90 ? { x: 300, y: 190 } : { x: 190, y: 100 };
  const rect = textDir === 90 ? { x: 300 - 0.2 * H, y: 172, width: H, height: 18 } : tekstRect(172, 190, 100);
  const vak = caretGlyphBox(P, H, textDir);
  return [
    {
      id: 'kind', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit',
      inReplyTo: 'ouder', replyType: 'group', groupId: 'ouder', textDir, rects: [rect], ...rect,
      color: '#FF0000', author: 'Kind', markedText: 'teh', pdfSubject: 'Cross-Out',
      createdAt: '2026-01-02T03:04:05.000Z', modifiedAt: '2026-01-02T03:04:06.000Z',
    },
    {
      id: 'ouder', type: 'caret', page: 1, intent: 'Replace', groupId: 'ouder', textDir,
      ...vak, text: 'the', color: '#9900CC', author: 'Ouder', pdfSubject: 'Inserted Text',
      nm: 'eigen-nm', createdAt: '2026-10-01T12:30:05.000Z', modifiedAt: '2026-10-01T12:31:00.000Z',
    },
    {
      id: 'los', type: 'caret', page: 1, textDir, ...caretGlyphBox({ x: 260, y: textDir === 90 ? 260 : 100 }, H, textDir),
      text: 'éénmaal – ☃', color: '#0066FF', author: 'Ouder',
    },
  ];
}

/** Schrijft de modellen op één pagina zoals saver.js dat doet en geeft de bytes. */
async function schrijf(instelling, anns, { extra } = {}) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const pagina = doc.addPage([612, 792]);
  pagina.setRotation(degrees(instelling.rotate));
  const { x, y, width, height } = instelling.cropBox;
  pagina.setCropBox(x, y, width, height);
  const map = makePointMapper(instelling.rotate, pagina.getCropBox());
  const plan = linkPlanForSave(anns);
  const kinderen = new Set(plan.links.map((l) => l.childId));
  const refById = new Map();
  const dictById = new Map();
  const annots = [];
  for (const ann of anns) {
    const rgb = hexToColorArray(saveColor(ann, anns, plan));
    const dict = ann.type === 'caret'
      ? buildCaretDict(ctx, plan.stripReplaceIntent.has(ann.id) ? { ...ann, intent: undefined } : ann, map,
        { rgb, opacity: 1, pageRot: instelling.rotate })
      : buildTextEditStrikeDict(ctx, ann, map, { rgb, opacity: 1, pageRot: instelling.rotate, linked: kinderen.has(ann.id) });
    const ref = ctx.register(dict);
    refById.set(ann.id, ref);
    dictById.set(ann.id, dict);
    annots.push(ref);
  }
  applyGroupLinks(ctx, plan, refById, dictById, annots);
  if (extra) extra(ctx, annots);
  pagina.node.set(PDFName.of('Annots'), ctx.obj(annots));
  return { bytes: await doc.save(), refById };
}

async function lees(bytes) {
  const pdfLib = await PDFDocument.load(bytes);
  const ctx = pdfLib.context;
  const annots = ctx.lookup(pdfLib.getPages()[0].node.get(PDFName.of('Annots'))).asArray()
    .map((ref) => ({ ref, dict: ctx.lookup(ref) }));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await lezer.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const vanLezer = await pagina.getAnnotations();
  return { ctx, annots, viewport, vanLezer };
}

const getal = (ctx, d, k) => ctx.lookup(d.get(PDFName.of(k)))?.asNumber?.();
const getallen = (ctx, d, k) => ctx.lookup(d.get(PDFName.of(k)))?.asArray().map((v) => v.asNumber());
const naam = (d, k) => d.get(PDFName.of(k))?.toString();
const apTekst = (ctx, d) => {
  const n = ctx.lookup(ctx.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
  return { n, tekst: Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1') };
};
const naarScherm = (viewport, x, y) => { const [vx, vy] = viewport.convertToViewportPoint(x, y); return { x: vx, y: vy }; };
const dichtbij = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

function zoek(annots, subtype, metIrt) {
  return annots.find(({ dict }) => naam(dict, 'Subtype') === subtype
    && (metIrt === undefined || !!dict.get(PDFName.of('IRT')) === metIrt));
}

test('rotatie-mapper: dezelfde omrekening als de saver altijd had', () => {
  assert.deepEqual(_rotVisualMapper(0, 600, 800)(10, 20), { x: 10, y: 20 });
  assert.deepEqual(_rotVisualMapper(90, 600, 800)(10, 20), { x: 20, y: 790 });
  assert.deepEqual(_rotVisualMapper(180, 600, 800)(10, 20), { x: 590, y: 780 });
  assert.deepEqual(_rotVisualMapper(-90, 600, 800)(10, 20), { x: 580, y: 10 });
  assert.deepEqual(_remapRect({ x: 10, y: 20, width: 30, height: 40 }, _rotVisualMapper(90, 600, 800)),
    { x: 20, y: 760, width: 40, height: 30 });
});

test('pdfDate schrijft het D:-formaat en valt bij onzin terug op nu', () => {
  assert.equal(pdfDate('2026-10-01T12:30:05.123Z').asString(), 'D:20261001123005Z');
  assert.match(pdfDate('geen datum').asString(), /^D:\d{14}Z$/);
  assert.match(pdfDate(undefined).asString(), /^D:\d{14}Z$/);
});

for (const instelling of PAGINAS) {
  const label = `/Rotate ${instelling.rotate}, CropBox ${Object.values(instelling.cropBox).join(' ')}`;

  test(`makePointMapper is de omkering van de pdf.js-viewport (${label})`, async () => {
    const { bytes } = await schrijf(instelling, []);
    const { viewport } = await lees(bytes);
    const map = makePointMapper(instelling.rotate, instelling.cropBox);
    for (const [x, y] of [[0, 0], [72, 100], [300.5, 412.25]]) {
      const u = map(x, y);
      const terug = naarScherm(viewport, u.x, u.y);
      dichtbij(terug.x, x, 1e-6, 'x');
      dichtbij(terug.y, y, 1e-6, 'y');
    }
  });

  for (const textDir of [0, 90]) {
    test(`doorhaling: quad volgt de tekst, AP-lijn evenwijdig, Rect omvat alles (${label}, textDir ${textDir})`, async () => {
      const anns = modellen(textDir);
      const { bytes } = await schrijf(instelling, anns);
      const { ctx, annots, viewport } = await lees(bytes);
      const { dict } = zoek(annots, '/StrikeOut');
      const q = getallen(ctx, dict, 'QuadPoints');
      assert.equal(q.length, 8);
      const p = [0, 2, 4, 6].map((i) => naarScherm(viewport, q[i], q[i + 1]));
      // p1 -> p2 wijst in de getoonde pagina langs de leesrichting.
      assert.equal(textDirFromVector(p[1].x - p[0].x, p[1].y - p[0].y), textDir, 'p1 -> p2');
      // De hoeken zijn exact die van de tekstrechthoek, in tekstvolgorde.
      quadCorners(anns[0].rects[0], textDir).forEach((hoek, i) => {
        dichtbij(p[i].x, hoek.x, 0.01, `p${i + 1}.x`);
        dichtbij(p[i].y, hoek.y, 0.01, `p${i + 1}.y`);
      });
      // Rect omvat elke quad-hoek.
      const [llx, lly, urx, ury] = getallen(ctx, dict, 'Rect');
      for (let i = 0; i < 8; i += 2) {
        assert.ok(q[i] >= llx && q[i] <= urx && q[i + 1] >= lly && q[i + 1] <= ury, 'quad binnen Rect');
      }
      // AP: BBox [0 0 w h], geen Matrix; de lijn loopt van mid(p1,p3) naar mid(p2,p4).
      const { n, tekst } = apTekst(ctx, dict);
      assert.deepEqual(n.dict.lookup(PDFName.of('BBox')).asArray().map((v) => v.asNumber()),
        [0, 0, +(urx - llx).toFixed(4), +(ury - lly).toFixed(4)]);
      assert.equal(n.dict.get(PDFName.of('Matrix')), undefined);
      const m = /(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l/.exec(tekst);
      assert.ok(m, `lijn in de appearance: ${tekst}`);
      const [ax, ay, bx, by] = m.slice(1).map(Number);
      dichtbij(ax + llx, (q[0] + q[4]) / 2, 0.01, 'begin x');
      dichtbij(ay + lly, (q[1] + q[5]) / 2, 0.01, 'begin y');
      dichtbij(bx + llx, (q[2] + q[6]) / 2, 0.01, 'eind x');
      dichtbij(by + lly, (q[3] + q[7]) / 2, 0.01, 'eind y');
      const kruis = (bx - ax) * (q[3] - q[1]) - (by - ay) * (q[2] - q[0]);
      dichtbij(kruis, 0, 1e-6, 'evenwijdig aan p1 -> p2');
      assert.match(tekst, /^q 0\.6 0 0\.8 RG 1 w 0 J \[\] 0 d /, 'kleur van de ouder, 1 pt');
    });

    test(`invoegteken: AP met BBox [0 0 w h], alle punten erin, top boven het invoegpunt (${label}, textDir ${textDir})`, async () => {
      const anns = modellen(textDir);
      const { bytes } = await schrijf(instelling, anns);
      const { ctx, annots, viewport } = await lees(bytes);
      const { dict } = zoek(annots, '/Caret', false);
      const [llx, lly, urx, ury] = getallen(ctx, dict, 'Rect');
      const { n, tekst } = apTekst(ctx, dict);
      const bbox = n.dict.lookup(PDFName.of('BBox')).asArray().map((v) => v.asNumber());
      assert.deepEqual(bbox, [0, 0, +(urx - llx).toFixed(4), +(ury - lly).toFixed(4)]);
      const punten = [...tekst.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]/g)].map((m) => [Number(m[1]), Number(m[2])]);
      assert.equal(punten.length, 4, tekst);
      for (const [px, py] of punten) {
        assert.ok(px >= -1e-9 && px <= bbox[2] + 1e-9 && py >= -1e-9 && py <= bbox[3] + 1e-9, `punt ${px},${py} in BBox`);
      }
      // De top (eerste punt) ligt in de getoonde pagina 0,1 h boven het invoegpunt.
      const P = textDir === 90 ? { x: 300, y: 190 } : { x: 190, y: 100 };
      const up = upVector(textDir);
      const top = naarScherm(viewport, punten[0][0] + llx, punten[0][1] + lly);
      dichtbij(top.x, P.x + up.x * 0.1 * H, 0.01, 'top x');
      dichtbij(top.y, P.y + up.y * 0.1 * H, 0.01, 'top y');
      assert.match(tekst, /^q 0\.6 0 0\.8 rg .* h f Q$/);
      assert.equal(naam(dict, 'Sy'), '/None');
      assert.equal(getal(ctx, dict, 'OPS_TextDir'), ((textDir - instelling.rotate) % 360 + 360) % 360);
    });
  }

  test(`vervanging: /IRT naar het invoegteken met /RT /Group; het kind neemt /C /T /M /CreationDate over (${label})`, async () => {
    const { bytes } = await schrijf(instelling, modellen(0));
    const { ctx, annots, vanLezer } = await lees(bytes);
    const kind = zoek(annots, '/StrikeOut');
    const ouder = zoek(annots, '/Caret', false);
    const ouderVolgorde = annots.indexOf(ouder);
    assert.ok(annots.indexOf(kind) < ouderVolgorde, 'de doorhaling staat vóór haar invoegteken');
    assert.ok(kind.dict.get(PDFName.of('IRT')) instanceof PDFRef);
    assert.equal(kind.dict.get(PDFName.of('IRT')).toString(), ouder.ref.toString());
    assert.equal(naam(kind.dict, 'RT'), '/Group');
    assert.equal(kind.dict.get(PDFName.of('Contents')), undefined, 'het kind heeft geen /Contents');
    for (const k of ['T', 'M', 'CreationDate']) {
      assert.equal(ctx.lookup(kind.dict.get(PDFName.of(k))).asString(), ctx.lookup(ouder.dict.get(PDFName.of(k))).asString(), k);
    }
    assert.deepEqual(getallen(ctx, kind.dict, 'C'), getallen(ctx, ouder.dict, 'C'));
    assert.deepEqual(getallen(ctx, ouder.dict, 'C'), PAARS);
    assert.equal(naam(ouder.dict, 'IT'), '/Replace');
    assert.equal(naam(kind.dict, 'IT'), '/StrikeOutTextEdit');
    assert.equal(ctx.lookup(kind.dict.get(PDFName.of('OPS_MarkedText'))).asString(), 'teh');
    assert.equal(ctx.lookup(ouder.dict.get(PDFName.of('NM'))).asString(), 'eigen-nm');
    assert.equal(ctx.lookup(kind.dict.get(PDFName.of('NM'))).asString(), 'kind', 'zonder nm het id');
    assert.equal(ctx.lookup(ouder.dict.get(PDFName.of('Subj'))).asString(), 'Inserted Text');
    assert.equal(ctx.lookup(kind.dict.get(PDFName.of('Subj'))).asString(), 'Cross-Out');
    assert.match(ctx.lookup(ouder.dict.get(PDFName.of('M'))).asString(), /^D:\d{14}(Z|[+-]\d{2}'\d{2}'?)$/);
    assert.match(ctx.lookup(ouder.dict.get(PDFName.of('CreationDate'))).asString(), /^D:\d{14}(Z|[+-]\d{2}'\d{2}'?)$/);

    // Zoals pdf.js het ziet.
    const karet = vanLezer.find((a) => a.subtype === 'Caret' && a.contentsObj?.str === 'the');
    const door = vanLezer.find((a) => a.subtype === 'StrikeOut');
    assert.ok(karet, 'pdf.js kent het invoegteken met zijn tekst');
    assert.equal(karet.it, 'Replace');
    assert.equal(door.it, 'StrikeOutTextEdit');
    assert.equal(door.inReplyTo, karet.id);
    assert.equal(door.replyType, 'Group');
  });
}

test('een kind zonder invoegteken op de pagina wordt een gewone schrapping zonder /IRT of /RT', async () => {
  const [kind] = modellen(0);
  const { bytes } = await schrijf(PAGINAS[0], [kind]);
  const { ctx, annots } = await lees(bytes);
  const { dict } = zoek(annots, '/StrikeOut');
  assert.equal(dict.get(PDFName.of('IRT')), undefined);
  assert.equal(dict.get(PDFName.of('RT')), undefined);
  assert.equal(ctx.lookup(dict.get(PDFName.of('Contents'))).asString(), '', 'een gewone schrapping houdt haar /Contents');
  assert.deepEqual(getallen(ctx, dict, 'C'), ROOD);
});

test('een invoegteken met /IT /Replace zonder kind verliest de intent', async () => {
  const [, ouder] = modellen(0);
  const { bytes } = await schrijf(PAGINAS[0], [ouder]);
  const { annots } = await lees(bytes);
  const { dict } = zoek(annots, '/Caret');
  assert.equal(dict.get(PDFName.of('IT')), undefined);
});

test('/Contents met tekst buiten Latin-1 wordt UTF-16', async () => {
  const { bytes } = await schrijf(PAGINAS[0], modellen(0));
  const { ctx, annots } = await lees(bytes);
  const los = annots.find(({ dict }) => naam(dict, 'Subtype') === '/Caret'
    && ctx.lookup(dict.get(PDFName.of('Contents'))) instanceof PDFHexString);
  assert.ok(los, 'het losse invoegteken schrijft hex');
  const contents = ctx.lookup(los.dict.get(PDFName.of('Contents')));
  assert.match(contents.asString(), /^FEFF/i);
  assert.equal(contents.decodeText(), 'éénmaal – ☃');
  assert.deepEqual(getallen(ctx, los.dict, 'C'), BLAUW);
  assert.equal(los.dict.get(PDFName.of('IT')), undefined, 'een invoeging heeft geen /IT');
  for (const k of ['RD', 'Popup', 'RC']) assert.equal(los.dict.get(PDFName.of(k)), undefined, k);
});

test('buildStrikeQuads en buildStrikeAppearance: het uitgewerkte voorbeeld', async () => {
  const doc = await PDFDocument.create();
  const map = makePointMapper(0, { x: 0, y: 0, width: 612, height: 792 });
  const quads = buildStrikeQuads([tekstRect(72, 90, 100)], 0, map);
  assert.deepEqual(quads[0].flatMap((p) => [p.x, p.y]), [72, 701.6, 90, 701.6, 72, 689.6, 90, 689.6]);
  const { rect, apRef } = buildStrikeAppearance(doc.context, quads, ROOD, 1);
  assert.deepEqual(rect, [71.5, 689.1, 90.5, 702.1]);
  const n = doc.context.lookup(apRef);
  assert.equal(Buffer.from(n.getContents()).toString('latin1'), 'q 1 0 0 RG 1 w 0 J [] 0 d 0.5 6.5 m 18.5 6.5 l S Q');

  // Dezelfde tekst op een /Rotate 90-pagina: verticaal in het bestand.
  const map90 = makePointMapper(90, { x: 0, y: 0, width: 612, height: 792 });
  const q90 = buildStrikeQuads([tekstRect(72, 90, 100)], 0, map90);
  assert.deepEqual(q90[0].flatMap((p) => [p.x, p.y]), [90.4, 72, 90.4, 90, 102.4, 72, 102.4, 90]);
});

test('buildCaretDict: het uitgewerkte voorbeeld', async () => {
  const doc = await PDFDocument.create();
  const map = makePointMapper(0, { x: 0, y: 0, width: 612, height: 792 });
  const vak = caretGlyphBox({ x: 90, y: 100 }, 12, 0);
  const dict = buildCaretDict(doc.context, { id: 'a', type: 'caret', ...vak, textDir: 0, text: 'the' }, map,
    { rgb: BLAUW, opacity: 1, pageRot: 0 });
  assert.deepEqual(dict.lookup(PDFName.of('Rect')).asArray().map((v) => v.asNumber()), [87, 687.2, 93, 693.2]);
  const n = doc.context.lookup(dict.lookup(PDFName.of('AP')).get(PDFName.of('N')));
  assert.deepEqual(n.dict.lookup(PDFName.of('BBox')).asArray().map((v) => v.asNumber()), [0, 0, 6, 6]);
  assert.equal(Buffer.from(n.getContents()).toString('latin1'), 'q 0 0.4 1 rg 3 6 m 6 0 l 3 1.5 l 0 0 l h f Q');
  assert.equal(dict.get(PDFName.of('Sy')).toString(), '/None');
  assert.equal(dict.lookup(PDFName.of('Subj')).asString(), 'Inserted Text');
  assert.equal(dict.lookup(PDFName.of('Contents')).asString(), 'the');
});

test('addTextEditKeys: /OPS_TextDir in de ongedraaide pagina, gemarkeerde tekst alleen bij een doorhaling', async () => {
  const doc = await PDFDocument.create();
  const d = doc.context.obj({});
  addTextEditKeys(d, { id: 'x', type: 'textStrikethrough', intent: 'StrikeOutTextEdit', textDir: 0, markedText: 'teh' }, 90);
  assert.equal(d.lookup(PDFName.of('OPS_TextDir')).asNumber(), 270);
  assert.equal(d.lookup(PDFName.of('OPS_MarkedText')).asString(), 'teh');
  assert.equal(d.get(PDFName.of('IT')).toString(), '/StrikeOutTextEdit');
  const leeg = doc.context.obj({});
  addTextEditKeys(leeg, { id: 'y', type: 'caret', textDir: 90 }, 0);
  assert.equal(leeg.lookup(PDFName.of('OPS_TextDir')).asNumber(), 90);
  assert.equal(leeg.get(PDFName.of('OPS_MarkedText')), undefined);
  assert.equal(leeg.get(PDFName.of('IT')), undefined);
});

test('addLoadedMarkupKeys schrijft /IT, /NM en /Subj alleen als het model ze heeft', async () => {
  const doc = await PDFDocument.create();
  const kaal = doc.context.obj({ Subtype: 'Highlight' });
  addLoadedMarkupKeys(kaal, { type: 'textHighlight' });
  assert.deepEqual([...kaal.keys()].map(String), ['/Subtype']);
  const vol = doc.context.obj({ Subtype: 'Highlight' });
  addLoadedMarkupKeys(vol, { type: 'textHighlight', intent: 'HighlightNote', nm: 'vreemd-1', pdfSubject: 'Markering' });
  assert.equal(vol.get(PDFName.of('IT')).toString(), '/HighlightNote');
  assert.equal(vol.lookup(PDFName.of('NM')).asString(), 'vreemd-1');
  assert.equal(vol.lookup(PDFName.of('Subj')).asString(), 'Markering');
});

test('/NM blijft per pagina uniek, ook bij een kopie die de naam van het origineel meedraagt', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const map = makePointMapper(0, { x: 0, y: 0, width: 612, height: 792 });
  const gebruikteNm = new Set();
  const [door, karet] = modellen(0);
  const nmVan = (d) => d.lookup(PDFName.of('NM'))?.decodeText();
  const opties = { rgb: PAARS, opacity: 1, pageRot: 0, gebruikteNm };

  // Origineel eerst, dan de kopie (zoals de saver de pagina doorloopt).
  const k1 = buildCaretDict(ctx, { ...karet, id: 'k1', nm: 'abc' }, map, opties);
  const k2 = buildCaretDict(ctx, { ...karet, id: 'k2', nm: 'abc' }, map, opties);
  const s1 = buildTextEditStrikeDict(ctx, { ...door, id: 's1', nm: 'def' }, map, opties);
  const s2 = buildTextEditStrikeDict(ctx, { ...door, id: 's2', nm: 'def' }, map, opties);
  const h1 = ctx.obj({ Subtype: 'Highlight' });
  const h2 = ctx.obj({ Subtype: 'Highlight' });
  addLoadedMarkupKeys(h1, { type: 'textHighlight', nm: 'ghi' }, gebruikteNm);
  addLoadedMarkupKeys(h2, { type: 'textHighlight', nm: 'ghi' }, gebruikteNm);
  // Een invoegteken met de naam van een markering krijgt zijn id.
  const k3 = buildCaretDict(ctx, { ...karet, id: 'k3', nm: 'ghi' }, map, opties);

  assert.equal(nmVan(k1), 'abc', 'het origineel houdt zijn naam');
  assert.equal(nmVan(k2), 'k2', 'de kopie valt terug op haar id');
  assert.equal(nmVan(s1), 'def');
  assert.equal(nmVan(s2), 's2');
  assert.equal(nmVan(h1), 'ghi');
  assert.equal(h2.get(PDFName.of('NM')), undefined, 'een gekopieerde markering krijgt geen /NM');
  assert.equal(nmVan(k3), 'k3');
  const namen = [k1, k2, s1, s2, h1, k3].map(nmVan);
  assert.equal(new Set(namen).size, namen.length, `uniek: ${namen.join(', ')}`);

  // Zonder verzameling (andere aanroepers) blijft het zoals het was.
  assert.equal(nmVan(buildCaretDict(ctx, { ...karet, id: 'k4', nm: 'abc' }, map, { rgb: PAARS })), 'abc');
});

test('dropOrphanPopups haalt alleen popups weg waarvan de ouder herschreven is', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const karet = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Caret', Rect: [0, 0, 5, 5] }));
  const notitie = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 5, 5] }));
  const vierkant = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 5, 5] }));
  const popup = (ouder) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 9, 9], Parent: ouder }));
  const pKaret = popup(karet);
  const pNotitie = popup(notitie);
  const pVierkant = popup(vierkant);
  // Het invoegteken en de notitie zijn weggehaald en herschreven; het vierkant bleef staan.
  const weg = correctionRefKeys(ctx, [karet, notitie]);
  assert.deepEqual([...weg], [karet.toString()], 'alleen correcties tellen mee');
  const over = dropOrphanPopups(ctx, [vierkant, pKaret, pNotitie, pVierkant], weg);
  assert.deepEqual(over.map(String), [vierkant, pNotitie, pVierkant].map(String));
  assert.deepEqual(dropOrphanPopups(ctx, [pKaret], new Set()).map(String), [pKaret.toString()]);
});

test('correctionRefKeys: invoegteken, tekstcorrectie-doorhaling en de leden van een vervangpaar', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const reg = (d) => ctx.register(ctx.obj({ Type: 'Annot', Rect: [0, 0, 1, 1], ...d }));
  const oudeDoorhaling = reg({ Subtype: 'StrikeOut' });
  const tekstcorrectie = reg({ Subtype: 'StrikeOut', IT: 'StrikeOutTextEdit' });
  const omgOuder = reg({ Subtype: 'StrikeOut' });
  const omgKind = reg({ Subtype: 'Caret', IRT: omgOuder, RT: 'Group' });
  const vierkant = reg({ Subtype: 'Square' });
  const groepsnotitie = reg({ Subtype: 'Text', IRT: vierkant, RT: 'Group' });
  const sleutels = correctionRefKeys(ctx, [oudeDoorhaling, tekstcorrectie, omgOuder, omgKind, vierkant, groepsnotitie]);
  assert.deepEqual([...sleutels].sort(), [tekstcorrectie, omgOuder, omgKind].map(String).sort());
});
