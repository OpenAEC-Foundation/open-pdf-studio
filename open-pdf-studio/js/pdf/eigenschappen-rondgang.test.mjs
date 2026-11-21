// Eigenschappen die de app aanbiedt overleven opslaan -> heropenen (#619).
//
// Elk geval met de echte saver (saver-test-hooks.mjs) en de echte lader:
// pdf.js-annotaties -> extractAnnotationColors -> zetPaginaAnnotatiesOm (de
// omzetting per pagina van js/pdf/loader.js, met annotation-converter.js).
// De lader geeft nieuwe id's: modellen worden op soort of tekst teruggezocht,
// nooit op id of positie.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFRef } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { veelhoekGrondvorm } = await import('./saver/veelhoek-grondvorm.js');
const { draaiPunt } = await import('./saver/vorm-draaiing.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');

async function leegBlad({ rotatie = 0 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  return doc.save();
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
    id: 'eigenschappen', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

/** De modellen van blad 1 zoals js/pdf/loader.js ze maakt. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, new Map(), kaart);
  await doc.loadingTask.destroy();
  return modellen;
}

/** Opslaan en heropenen; met `keer` meer dan 1 telkens het heropende model. */
async function rondgang(modellen, { keer = 1, rotatie = 0 } = {}) {
  let huidig = modellen;
  let bytes;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(await leegBlad({ rotatie }), huidig);
    huidig = await laad(bytes);
  }
  return { modellen: huidig, bytes };
}

/** De annotatie-woordenboeken van blad 1. */
async function woordenboeken(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const refs = doc.getPage(0).node.Annots()?.asArray() || [];
  return refs.map((ref) => ({ ref, dict: ctx.lookup(ref) }));
}

const naam = (d, sleutel) => d.get(PDFName.of(sleutel))?.toString();
const tekst = (d, sleutel) => decodePdfTextObject(d.get(PDFName.of(sleutel)));
const subtype = (d) => naam(d, 'Subtype');

const basis = {
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', fillColor: null, textColor: '#000000',
  lineWidth: 1, borderStyle: 'solid', opacity: 1, author: 'User',
};
const tekstvak = (extra = {}) => ({
  ...basis, id: 'tb', type: 'textbox', x: 60, y: 60, width: 220, height: 60, text: 'hallo wereld',
  fontSize: 12, fontFamily: 'Arial', ...extra,
});
const rechthoek = (extra = {}) => ({
  ...basis, id: 'bx', type: 'box', x: 80, y: 300, width: 120, height: 70, ...extra,
});

// ── uitlijning (/Q) ─────────────────────────────────────────────────────────

test('de uitlijning van een tekstvak gaat als /Q mee en komt terug', async () => {
  for (const [textAlign, q] of [['center', '1'], ['right', '2']]) {
    const { modellen, bytes } = await rondgang([tekstvak({ textAlign })]);
    const [ft] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/FreeText');
    assert.equal(naam(ft.dict, 'Q'), q, `/Q bij ${textAlign}`);
    assert.equal(modellen.find((m) => m.type === 'textbox').textAlign, textAlign);
  }
  // Links is de standaard: geen /Q, en het model blijft zonder uitlijning.
  const { modellen, bytes } = await rondgang([tekstvak({ textAlign: 'left' })]);
  const [ft] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/FreeText');
  assert.equal(ft.dict.get(PDFName.of('Q')), undefined);
  assert.equal(modellen[0].textAlign ?? 'left', 'left');
});

test('de uitlijning van een callout komt terug', async () => {
  const callout = {
    ...basis, id: 'co', type: 'callout', x: 300, y: 60, width: 150, height: 50, text: 'callout',
    fontSize: 12, fontFamily: 'Arial', textAlign: 'center',
    arrowX: 320, arrowY: 220, kneeX: 340, kneeY: 160, armOriginX: 375, armOriginY: 110,
  };
  const { modellen } = await rondgang([callout]);
  assert.equal(modellen.find((m) => m.type === 'callout').textAlign, 'center');
});

// ── onderstreept en doorgehaald ─────────────────────────────────────────────

test('onderstreept en doorgehaald staan in /DS en /RC en komen terug', async () => {
  const { modellen, bytes } = await rondgang([tekstvak({ fontUnderline: true, fontStrikethrough: true })]);
  const [ft] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/FreeText');
  assert.match(tekst(ft.dict, 'DS'), /text-decoration:underline line-through;/);
  assert.match(tekst(ft.dict, 'RC'), /<span style="text-decoration:underline line-through">hallo wereld<\/span>/);
  const tb = modellen.find((m) => m.type === 'textbox');
  assert.equal(tb.fontUnderline, true);
  assert.equal(tb.fontStrikethrough, true);
});

test('alleen doorgehaald: geen onderstreping erbij', async () => {
  const { modellen, bytes } = await rondgang([tekstvak({ fontStrikethrough: true })]);
  const [ft] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/FreeText');
  assert.match(tekst(ft.dict, 'DS'), /text-decoration:line-through;/);
  const tb = modellen.find((m) => m.type === 'textbox');
  assert.equal(tb.fontUnderline, false);
  assert.equal(tb.fontStrikethrough, true);
});

test('de appearance tekent de onderstreping (scherm en bestand gelijk)', async () => {
  const { bytes } = await rondgang([tekstvak({ fontUnderline: true })]);
  const doc = await PDFDocument.load(bytes);
  const [ref] = doc.getPage(0).node.Annots().asArray();
  const ap = doc.context.lookup(doc.context.lookup(ref).get(PDFName.of('AP'))).get(PDFName.of('N'));
  const { decodePDFRawStream } = await import('pdf-lib');
  const stroom = doc.context.lookup(ap);
  const inhoud = Buffer.from(stroom.contents ? decodePDFRawStream(stroom).decode() : []).toString('latin1');
  const naET = inhoud.slice(inhoud.lastIndexOf('ET'));
  assert.match(naET, /RG 1 w \[\] 0 d [\d.-]+ [\d.-]+ m [\d.-]+ [\d.-]+ l S/, `lijn na de tekst: ${naET}`);
});

test('een /DS-decoratie uit een ander programma (zonder /RC) wordt gelezen, net als /Q', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: [60, 700, 280, 760], Contents: PDFString.of('extern'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'), DS: PDFString.of('font-size:12pt;text-decoration:line-through'),
    Q: 2, F: 4,
  });
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  const [tb] = await laad(await doc.save());
  assert.equal(tb.fontStrikethrough, true);
  assert.equal(tb.fontUnderline, false);
  assert.equal(tb.textAlign, 'right');
});

// ── draaiing ────────────────────────────────────────────────────────────────

/** De hoekpunten zoals het scherm ze tekent: grondvorm in het vak, om het midden gedraaid. */
function zichtbareHoeken(ann) {
  const grond = veelhoekGrondvorm(ann);
  const xs = grond.map((p) => p.x); const ys = grond.map((p) => p.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const sx = (Math.max(...xs) - minX) > 1e-6 ? ann.width / (Math.max(...xs) - minX) : 1;
  const sy = (Math.max(...ys) - minY) > 1e-6 ? ann.height / (Math.max(...ys) - minY) : 1;
  // Met eigen punten schaalt het scherm ze in het vak (buildPolygonPointsPath).
  const inVak = Array.isArray(ann.points) && ann.points.length >= 3
    ? grond.map((p) => ({ x: ann.x + (p.x - minX) * sx, y: ann.y + (p.y - minY) * sy })) : grond;
  const c = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
  return inVak.map((p) => draaiPunt(p, c, ann.rotation || 0));
}

function zelfdeHoeken(uit, verwacht, wat) {
  const a = zichtbareHoeken(uit);
  const b = zichtbareHoeken(verwacht);
  assert.equal(a.length, b.length, `${wat}: aantal hoeken`);
  a.forEach((p, i) => {
    assert.ok(Math.hypot(p.x - b[i].x, p.y - b[i].y) < 0.01, `${wat}: hoek ${i} ${JSON.stringify(p)} vs ${JSON.stringify(b[i])}`);
  });
}

const VIJFHOEK = { ...basis, id: 'pg', type: 'polygon', x: 100, y: 200, width: 120, height: 80, sides: 5, rotation: 30 };

for (const [rotatie, hoek] of [[0, 30], [90, 30], [90, 0]]) {
  test(`een gedraaide veelhoek (${hoek}°) houdt hoek en vorm over drie rondgangen (/Rotate ${rotatie})`, async () => {
    const vorm = { ...VIJFHOEK, rotation: hoek };
    const { modellen, bytes } = await rondgang([vorm], { keer: 3, rotatie });
    const pg = modellen.find((m) => m.type === 'polygon');
    assert.equal(pg.rotation ?? 0, hoek);
    zelfdeHoeken(pg, vorm, 'vijfhoek');
    const [poly] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/Polygon');
    assert.equal(poly.dict.get(PDFName.of('OPS_Rotation'))?.asNumber(), hoek || undefined);
  });
}

test('een gedraaide veelhoek met eigen punten houdt zijn vorm', async () => {
  const punten = [{ x: 100, y: 100 }, { x: 260, y: 130 }, { x: 230, y: 240 }, { x: 120, y: 210 }];
  const vorm = { ...basis, id: 'pp', type: 'polygon', points: punten, x: 100, y: 100, width: 160, height: 140, rotation: -50 };
  for (const rotatie of [0, 270]) {
    const { modellen } = await rondgang([vorm], { keer: 2, rotatie });
    const pg = modellen.find((m) => m.type === 'polygon');
    assert.equal(pg.rotation, -50);
    zelfdeHoeken(pg, vorm, `eigen punten /Rotate ${rotatie}`);
  }
});

test('/Vertices van een gedraaide veelhoek zijn de hoeken die het scherm toont', async () => {
  const { bytes } = await rondgang([VIJFHOEK]);
  const [poly] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/Polygon');
  const v = poly.dict.get(PDFName.of('Vertices')).asArray().map((n) => n.asNumber());
  const verwacht = zichtbareHoeken(VIJFHOEK);
  verwacht.forEach((p, i) => {
    assert.ok(Math.abs(v[2 * i] - p.x) < 0.01 && Math.abs(v[2 * i + 1] - (842 - p.y)) < 0.01, `hoekpunt ${i}`);
  });
});

for (const rotatie of [0, 90]) test(`een gedraaide rechthoekige wolk blijft een wolk met hetzelfde vak en draait in de appearance (/Rotate ${rotatie})`, async () => {
  const wolk = { ...basis, id: 'cl', type: 'cloud', x: 250, y: 300, width: 160, height: 90, rotation: 30 };
  const { modellen, bytes } = await rondgang([wolk], { keer: 2, rotatie });
  const cl = modellen.find((m) => m.type === 'cloud');
  assert.equal(cl.rotation, 30);
  assert.equal(cl.points, undefined, 'een rechthoekige wolk houdt geen punten');
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(cl[k] - wolk[k]) < 0.01, `${k}: ${cl[k]}`);
  const doc = await PDFDocument.load(bytes);
  const [ref] = doc.getPage(0).node.Annots().asArray();
  const ap = doc.context.lookup(doc.context.lookup(doc.context.lookup(ref).get(PDFName.of('AP'))).get(PDFName.of('N')));
  const { decodePDFRawStream } = await import('pdf-lib');
  const inhoud = Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
  assert.match(inhoud, /^q\n0\.866025 -0\.5 0\.5 0\.866025 [\d.-]+ [\d.-]+ cm\n/, 'draaiing als cm om het midden');
});

test('een ongedraaide veelhoek wordt geschreven zoals voorheen (geen /OPS_Rotation)', async () => {
  const { modellen, bytes } = await rondgang([{ ...VIJFHOEK, rotation: 0 }]);
  const [poly] = (await woordenboeken(bytes)).filter(({ dict }) => subtype(dict) === '/Polygon');
  assert.equal(poly.dict.get(PDFName.of('OPS_Rotation')), undefined);
  assert.equal(modellen[0].rotation ?? 0, 0);
});

test('de draaiing van een notitie komt terug', async () => {
  const notitie = { ...basis, id: 'cm', type: 'comment', x: 400, y: 400, width: 24, height: 24, text: 'notitie', icon: 'note', rotation: 45, color: '#ffff00' };
  const { modellen } = await rondgang([notitie]);
  const cm = modellen.find((m) => m.type === 'comment');
  assert.equal(cm.rotation, 45);
  assert.equal(cm.text, 'notitie');
});

test('een gedraaide markering voor weglakken houdt maat en hoek', async () => {
  const lak = { ...basis, id: 'rd', type: 'redaction', x: 100, y: 500, width: 140, height: 40, rotation: 20 };
  const { modellen } = await rondgang([lak], { keer: 2 });
  const rd = modellen.find((m) => m.type === 'redaction');
  assert.equal(rd.rotation, 20);
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(rd[k] - lak[k]) < 0.5, `${k}: ${rd[k]}`);
});

// ── boog ────────────────────────────────────────────────────────────────────

for (const rotatie of [0, 90]) {
  test(`een boog komt terug als boog, niet als polylijn (/Rotate ${rotatie})`, async () => {
    const boog = { ...basis, id: 'ar', type: 'arc', centerX: 300, centerY: 500, radius: 60, startAngle: 0.3, endAngle: 2.5, lineWidth: 2 };
    const { modellen } = await rondgang([boog], { keer: 2, rotatie });
    assert.equal(modellen.length, 1);
    const ar = modellen[0];
    assert.equal(ar.type, 'arc');
    assert.ok(Math.abs(ar.radius - 60) < 0.01, `straal ${ar.radius}`);
    assert.ok(Math.abs(ar.centerX - 300) < 0.01 && Math.abs(ar.centerY - 500) < 0.01, `midden ${ar.centerX},${ar.centerY}`);
    // Begin- en eindpunt op het scherm: ctx.arc(cx, cy, r, start, eind).
    const punt = (a, hoek) => ({ x: a.centerX + a.radius * Math.cos(hoek), y: a.centerY + a.radius * Math.sin(hoek) });
    for (const [h1, h2] of [[ar.startAngle, boog.startAngle], [ar.endAngle, boog.endAngle]]) {
      const p = punt(ar, h1); const q = punt(boog, h2);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 0.01, `punt ${JSON.stringify(p)} vs ${JSON.stringify(q)}`);
    }
    if (!rotatie) {
      assert.equal(ar.startAngle, 0.3);
      assert.equal(ar.endAngle, 2.5);
    }
  });
}

// ── gemarkeerd ──────────────────────────────────────────────────────────────

test('gemarkeerd komt terug via het statusmodel Marked, niet via een /F-bit', async () => {
  const { modellen, bytes } = await rondgang([rechthoek({ marked: true })], { keer: 2 });
  assert.equal(modellen.length, 1, 'de markering wordt geen losse notitie');
  assert.equal(modellen[0].marked, true);
  const dicts = await woordenboeken(bytes);
  const sq = dicts.find(({ dict }) => subtype(dict) === '/Square');
  // Bit 2 van /F is Hidden: die mag de rechthoek nooit krijgen.
  assert.equal(sq.dict.get(PDFName.of('F')).asNumber() & 2, 0);
  const status = dicts.filter(({ dict }) => subtype(dict) === '/Text');
  assert.equal(status.length, 1, 'precies één markering, ook na twee keer opslaan');
  assert.equal(tekst(status[0].dict, 'StateModel'), 'Marked');
  assert.equal(tekst(status[0].dict, 'State'), 'Marked');
  assert.equal(status[0].dict.get(PDFName.of('IRT')).toString(), sq.ref.toString());
});

test('niet gemarkeerd: geen markering in het bestand', async () => {
  const { modellen, bytes } = await rondgang([rechthoek()]);
  assert.equal(modellen[0].marked, false);
  assert.equal((await woordenboeken(bytes)).length, 1);
});

test('een rechthoek met reviewstatus houdt zijn draaiing, vulling en eigen sleutels', async () => {
  // De status-/Text neemt de /Rect van de rechthoek over; op /Rect gezocht
  // gaven ze elkaar hun gegevens.
  const bx = rechthoek({ status: 'accepted', rotation: 30, fillColor: '#00ff00', cross: true, opacity: 0.5 });
  const { modellen } = await rondgang([bx], { keer: 2 });
  assert.equal(modellen.length, 1);
  const [m] = modellen;
  assert.equal(m.status, 'accepted');
  assert.equal(m.rotation, 30);
  assert.equal(m.fillColor, '#00ff00');
  assert.equal(m.cross, true);
  assert.equal(m.opacity, 0.5);
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(m[k] - bx[k]) < 0.5, `${k}: ${m[k]}`);
});

// ── naam, onderwerp, alternatieve tekst, IFC-categorie ──────────────────────

test('naam (/NM) en PDF-onderwerp (/Subj) van een vorm komen terug, naast de opmerking', async () => {
  const bx = rechthoek({ nm: 'vak-1', pdfSubject: 'Rechthoek', subject: 'kijk hier' });
  const { modellen, bytes } = await rondgang([bx], { keer: 2 });
  const [sq] = await woordenboeken(bytes);
  assert.equal(tekst(sq.dict, 'NM'), 'vak-1');
  assert.equal(tekst(sq.dict, 'Subj'), 'Rechthoek');
  assert.equal(tekst(sq.dict, 'Contents'), 'kijk hier');
  assert.equal(modellen[0].nm, 'vak-1');
  assert.equal(modellen[0].pdfSubject, 'Rechthoek');
  assert.equal(modellen[0].subject, 'kijk hier');
});

test('Onderwerp bij een nieuwe en bestaande tekening schrijft /Subj naast de eigen /Contents', async () => {
  const paneel = await import('../solid/stores/propertiesStore.js');
  const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
  const bron = await PDFDocument.create();
  const blad = bron.addPage([595, 842]);
  blad.node.addAnnot(bron.context.register(bron.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [80, 400, 160, 460],
    Contents: PDFString.of('Controleer de aansluiting'), Subj: PDFString.of('Oud onderwerp'),
  })));
  let bytes = await bron.save();
  const [vorm] = await laad(bytes);
  state.documents = [{ id: 'blad', currentPage: 1, scale: 1, annotations: [vorm], undoStack: [], redoStack: [] }];
  state.activeDocumentIndex = 0;
  paneel.storeShowProperties(vorm);
  assert.equal(paneel.annotProps.subject, 'Oud onderwerp');
  paneel.updateAnnotProp('subject', 'Gewijzigde vorm');
  await paneel.showToolDefaults('line');
  paneel.updateAnnotProp('subject', 'Nieuwe lijn');
  const lijn = createAnnotationFromTool('line', 10, 10, 60, 40, null);
  paneel.updateAnnotProp('subject', '');

  bytes = await opslaan(bytes, [vorm, lijn]);
  const dicts = (await woordenboeken(bytes)).map(a => a.dict);
  const vierkant = dicts.find(d => subtype(d) === '/Square');
  const lijnDict = dicts.find(d => subtype(d) === '/Line');
  assert.equal(tekst(vierkant, 'Subj'), 'Gewijzigde vorm');
  assert.equal(tekst(vierkant, 'Contents'), 'Controleer de aansluiting');
  assert.equal(tekst(lijnDict, 'Subj'), 'Nieuwe lijn');
  assert.equal(tekst(lijnDict, 'Contents') || '', '');
  const heropend = await laad(bytes);
  const terug = heropend.find(a => a.type === 'box');
  paneel.storeShowProperties(terug);
  assert.equal(paneel.annotProps.subject, 'Gewijzigde vorm');
  paneel.updateAnnotProp('subject', '');
  bytes = await opslaan(bytes, heropend);
  const leeg = (await woordenboeken(bytes)).find(a => subtype(a.dict) === '/Square').dict;
  assert.equal(tekst(leeg, 'Contents'), 'Controleer de aansluiting');
  paneel.storeShowProperties((await laad(bytes)).find(a => a.type === 'box'));
  assert.equal(paneel.annotProps.subject, '');
});

test('het onderwerp van een tekstvak of notitie gaat naar /Subj (hun tekst staat in /Contents)', async () => {
  const notitie = { ...basis, id: 'cm', type: 'comment', x: 400, y: 400, width: 24, height: 24, text: 'notitietekst', icon: 'comment', subject: 'Vraag', color: '#ffff00' };
  const { modellen, bytes } = await rondgang([tekstvak({ subject: 'Kop' }), notitie], { keer: 2 });
  const dicts = await woordenboeken(bytes);
  assert.equal(tekst(dicts.find(({ dict }) => subtype(dict) === '/FreeText').dict, 'Subj'), 'Kop');
  assert.equal(tekst(dicts.find(({ dict }) => subtype(dict) === '/Text').dict, 'Subj'), 'Vraag');
  const tb = modellen.find((m) => m.type === 'textbox');
  const cm = modellen.find((m) => m.type === 'comment');
  assert.equal(tb.subject, 'Kop');
  assert.equal(tb.text, 'hallo wereld');
  assert.equal(cm.subject, 'Vraag');
  assert.equal(cm.text, 'notitietekst');
});

test('een naam staat maar één keer op de pagina', async () => {
  const { bytes } = await rondgang([rechthoek({ nm: 'dubbel' }), rechthoek({ id: 'bx2', y: 450, nm: 'dubbel' })]);
  const namen = (await woordenboeken(bytes)).map(({ dict }) => tekst(dict, 'NM')).filter(Boolean);
  assert.deepEqual(namen, ['dubbel']);
});

test('alternatieve tekst en IFC-categorie komen terug', async () => {
  const { modellen } = await rondgang([rechthoek({ altText: 'Kolom K1', ifcCategory: 'IfcColumn' })], { keer: 2 });
  assert.equal(modellen[0].altText, 'Kolom K1');
  assert.equal(modellen[0].ifcCategory, 'IfcColumn');
});

// ── koppelingen (/IRT + /RT) ────────────────────────────────────────────────

test('een groepskoppeling tussen twee vormen gaat als /IRT + /RT /Group mee', async () => {
  const ouder = rechthoek({ id: 'ouder', subject: 'ouder' });
  const kind = { ...basis, id: 'kind', type: 'circle', x: 300, y: 300, width: 80, height: 80, subject: 'kind', inReplyTo: 'ouder', replyType: 'group' };
  const { modellen, bytes } = await rondgang([ouder, kind], { keer: 2 });
  const dicts = await woordenboeken(bytes);
  const sq = dicts.find(({ dict }) => subtype(dict) === '/Square');
  const ci = dicts.find(({ dict }) => subtype(dict) === '/Circle');
  assert.equal(ci.dict.get(PDFName.of('IRT')).toString(), sq.ref.toString());
  assert.equal(naam(ci.dict, 'RT'), '/Group');
  const o = modellen.find((m) => m.type === 'box');
  const k = modellen.find((m) => m.type === 'circle');
  assert.equal(k.inReplyTo, o.id);
  assert.equal(k.replyType, 'group');
  assert.equal(o.inReplyTo, undefined);
});

test('een gewone antwoordkoppeling gaat als /IRT zonder /RT mee', async () => {
  const ouder = rechthoek({ id: 'ouder' });
  const kind = { ...basis, id: 'kind', type: 'comment', x: 300, y: 300, width: 24, height: 24, text: 'zie vak', icon: 'comment', color: '#ffff00', inReplyTo: 'ouder', replyType: 'reply' };
  const { modellen, bytes } = await rondgang([ouder, kind], { keer: 2 });
  const tx = (await woordenboeken(bytes)).find(({ dict }) => subtype(dict) === '/Text');
  assert.ok(tx.dict.get(PDFName.of('IRT')) instanceof PDFRef);
  assert.equal(tx.dict.get(PDFName.of('RT')), undefined);
  const k = modellen.find((m) => m.type === 'comment');
  assert.equal(k.inReplyTo, modellen.find((m) => m.type === 'box').id);
  assert.equal(k.replyType, 'reply');
});

test('een antwoordnotitie van een ander programma blijft een notitie en houdt haar koppeling', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const sqRef = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 500, 220, 570], C: [1, 0, 0], F: 4 }));
  const txRef = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [100, 546, 124, 570], Contents: PDFString.of('akkoord'),
    T: PDFString.of('Ander'), IRT: sqRef, F: 4,
  }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([sqRef, txRef]));
  const bron = await doc.save();
  const modellen = await laad(bron);
  assert.equal(modellen.length, 2, 'de notitie blijft los zichtbaar, zoals voorheen');
  const cm = modellen.find((m) => m.type === 'comment');
  assert.equal(cm.text, 'akkoord');
  assert.equal(cm.inReplyTo, modellen.find((m) => m.type === 'box').id);
  // En na opslaan staat de koppeling er nog.
  const bytes = await opslaan(bron, modellen);
  const tx = (await woordenboeken(bytes)).find(({ dict }) => subtype(dict) === '/Text');
  assert.ok(tx.dict.get(PDFName.of('IRT')) instanceof PDFRef);
});

// ── antwoorden (eigenschappenpaneel) ────────────────────────────────────────

test('antwoorden komen terug onder hun annotatie, zonder losse notities of dubbelingen', async () => {
  const replies = [
    { id: 'r1', author: 'Piet', text: 'eerste', createdAt: '2026-01-02T03:04:05.000Z' },
    { id: 'r2', author: 'Kees', text: 'tweede', createdAt: '2026-01-03T03:04:05.000Z' },
  ];
  const { modellen, bytes } = await rondgang([rechthoek({ replies })], { keer: 3 });
  assert.equal(modellen.length, 1, 'geen losse notities');
  assert.deepEqual(modellen[0].replies, replies);
  const dicts = await woordenboeken(bytes);
  const antwoorden = dicts.filter(({ dict }) => subtype(dict) === '/Text');
  assert.equal(antwoorden.length, 2, 'twee antwoorden, ook na drie keer opslaan');
  const sq = dicts.find(({ dict }) => subtype(dict) === '/Square');
  for (const { dict } of antwoorden) {
    assert.equal(dict.get(PDFName.of('IRT')).toString(), sq.ref.toString());
    assert.equal(dict.get(PDFName.of('RT')), undefined, 'een antwoord is /RT /R, de standaard');
  }
});

test('een geplakte kopie met dezelfde antwoorden geeft geen dubbele /NM', async () => {
  const replies = [{ id: 'r1', author: 'Piet', text: 'eerste', createdAt: '2026-01-02T03:04:05.000Z' }];
  const { modellen, bytes } = await rondgang([rechthoek({ replies }), rechthoek({ id: 'kopie', y: 450, replies })]);
  const namen = (await woordenboeken(bytes)).map(({ dict }) => tekst(dict, 'NM')).filter(Boolean);
  assert.deepEqual(namen, ['r1']);
  assert.equal(modellen.length, 2);
  for (const m of modellen) assert.deepEqual(m.replies.map((r) => r.text), ['eerste']);
});

// ── geen dubbelingen ────────────────────────────────────────────────────────

test('opnieuw opslaan van het heropende bestand geeft dezelfde annotaties', async () => {
  const alles = [
    tekstvak({ textAlign: 'center', fontUnderline: true, nm: 'tb', subject: 'Kop', marked: true }),
    rechthoek({ status: 'completed', marked: true, replies: [{ id: 'r', author: 'A', text: 'x', createdAt: '2026-01-01T00:00:00.000Z' }] }),
    VIJFHOEK,
    { ...basis, id: 'ar', type: 'arc', centerX: 300, centerY: 650, radius: 50, startAngle: 0.3, endAngle: 2.5 },
  ];
  const eerste = await opslaan(await leegBlad(), alles);
  const tweede = await opslaan(eerste, await laad(eerste));
  const sleutels = async (b) => (await woordenboeken(b))
    .map(({ dict }) => `${subtype(dict)}:${tekst(dict, 'StateModel') || ''}:${tekst(dict, 'OPS_Subtype') || ''}`).sort();
  assert.deepEqual(await sleutels(tweede), await sleutels(eerste));
  assert.equal((await laad(tweede)).length, 4);
});

test('alle annotatie-woordenboeken zijn geldig', async () => {
  const { bytes } = await rondgang([rechthoek({ marked: true, nm: 'n', pdfSubject: 's' })]);
  for (const { dict } of await woordenboeken(bytes)) assert.ok(dict instanceof PDFDict);
});
