// Vectorknipsel snoeien (#509): de bronpagina van een knipsel houdt alleen wat
// het knipvak kan raken.
//
// Twee soorten bewijs. De zuivere tests leggen per operatorsoort vast wat weg
// mag en wat moet blijven. De rendertests rasteren het vak vóór en na snoeien
// met MuPDF en eisen identieke beeldpunten — op een gegenereerde zware pagina
// en op een echte tekening uit de testmap.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import * as mupdf from 'mupdf';

import { snoeiInhoud, snoeiPagina, fontMaten, ontdubbel } from './vector-cull.js';
import { knipselAlsMiniPdf, SNOEI_DREMPEL } from './vector-embed.js';
import { bouwKnipselAppearance, ruimKnipselRestenOp } from './saver/vector-snippet.js';
import { sleutelVoor } from '../annotations/vector-snippet-store.js';

const VAK = { left: 100, bottom: 100, right: 200, top: 200 };
const FONT = { breedte: 1, uitsteek: 2 };
const bronnen = {
  font: (n) => (n === 'F1' ? FONT : null),
  xobject: (n) => (n === 'Im1' ? { soort: 'image' } : n === 'Fm1' ? { soort: 'form', bbox: [0, 0, 10, 10], matrix: [1, 0, 0, 1, 0, 0] } : null),
  extGState: (n) => (n === 'G1' ? {} : n === 'Dik' ? { LW: 400 } : null),
};
const snoei = (src, b = bronnen) => snoeiInhoud(src, VAK, b);
const regels = (r) => r.inhoud.split('\n');

// --- paden ------------------------------------------------------------------

test('een pad buiten het vak valt weg, een pad erin blijft', () => {
  const r = snoei('0 0 m 50 50 l S\n120 120 m 150 150 l S\n500 500 10 10 re f');
  assert.deepEqual(regels(r), ['120 120 m 150 150 l S']);
  assert.equal(r.weg, 2);
});

test('een pad dat het vak alleen met zijn lijndikte raakt, blijft', () => {
  // De lijn ligt 30 pt links van het vak; met lijndikte 80 reikt hij erin.
  const r = snoei('80 w 70 120 m 70 180 l S\n1 w 50 120 m 50 180 l S');
  assert.deepEqual(regels(r), ['80 w', '70 120 m 70 180 l S', '1 w']);
});

test('ook een lijndikte uit een ExtGState telt mee', () => {
  const r = snoei('/Dik gs 0 150 m 10 150 l S');
  assert.ok(r === null || r.inhoud.includes('0 150 m 10 150 l S'));
});

test('een Bézierkromme telt met haar controlepunten', () => {
  // Begin- en eindpunt liggen buiten het vak, de boog loopt erdoorheen.
  const r = snoei('50 150 m 150 400 150 -100 250 150 c S');
  assert.ok(r === null || r.inhoud.includes(' c S'));
});

test('de CTM wordt gevolgd, ook door q/Q heen', () => {
  const r = snoei('q 1 0 0 1 100 100 cm 10 10 m 20 20 l S Q\n10 10 m 20 20 l S');
  assert.deepEqual(regels(r), ['q', '1 0 0 1 100 100 cm', '10 10 m 20 20 l S', 'Q']);
});

test('uitsnijpaden blijven altijd staan, ook buiten het vak', () => {
  const r = snoei('0 0 10 10 re W n\n120 120 m 150 150 l S');
  assert.deepEqual(regels(r), ['0 0 10 10 re W n', '120 120 m 150 150 l S']);
});

test('een uitsnijpad dat ook vult, telt als tekenen', () => {
  const r = snoei('q 0 0 10 10 re W f Q');
  assert.deepEqual(regels(r), ['q', '0 0 10 10 re W f', 'Q']);
});

test('een pad zonder verf en zonder uitsnede valt weg', () => {
  assert.equal(snoei('120 120 m 150 150 l n\n120 120 m 150 150 l S').inhoud, '120 120 m 150 150 l S');
});

// --- toestand en lege blokken -----------------------------------------------

test('toestand blijft staan; lege q … Q-blokken vallen weg', () => {
  const r = snoei('1 0 0 RG 2 w\nq 0 0 1 rg 0 0 m 5 5 l S Q\nq q 0 g Q Q\n120 120 m 150 150 l S');
  assert.deepEqual(regels(r), ['1 0 0 RG', '2 w', '120 120 m 150 150 l S']);
});

test('marked content: een leeg paar valt weg, een gevuld paar blijft', () => {
  const r = snoei('/OC /L1 BDC 0 0 m 5 5 l S EMC\n/OC /L2 BDC 120 120 m 150 150 l S EMC');
  assert.deepEqual(regels(r), ['/OC /L2 BDC', '120 120 m 150 150 l S', 'EMC']);
  assert.ok(r.namen.has('L2'));
  assert.ok(!r.namen.has('L1'));
});

test('marked content met alleen toestand erin blijft staan', () => {
  const r = snoei('/Span BMC 1 0 0 rg EMC\n120 120 m 150 150 l f');
  assert.deepEqual(regels(r), ['/Span BMC', '1 0 0 rg', 'EMC', '120 120 m 150 150 l f']);
});

// --- tekst ------------------------------------------------------------------

test('een tekstobject buiten het vak valt weg, zijn tekst-state blijft', () => {
  const r = snoei('BT /F1 12 Tf 0 0 Td 14 TL 2 Tc (Hallo) Tj ET\nBT 0 -14 TD (x) Tj ET\nBT 120 150 Td (binnen) Tj ET');
  assert.deepEqual(regels(r), ['/F1 12 Tf', '14 TL', '2 Tc', '14 TL', 'BT 120 150 Td (binnen) Tj ET']);
});

test('" zet Tw en Tc ook als het object wegvalt', () => {
  const r = snoei('BT /F1 10 Tf 0 0 Td 3 1 (a) " ET\nBT 120 150 Td (b) Tj ET');
  assert.deepEqual(regels(r), ['/F1 10 Tf', '3 Tw 1 Tc', 'BT 120 150 Td (b) Tj ET']);
});

test('een lange tekenreeks die het vak in loopt, blijft', () => {
  // Begint op x=0, maar 20 glyfen van 10 pt lopen tot voorbij x=100.
  const r = snoei('BT /F1 10 Tf 0 150 Td (abcdefghijklmnopqrst) Tj ET');
  assert.ok(r === null || r.inhoud.includes('Tj'));
});

test('tekst blijft staan bij een onbekend font, uitsnijdende tekst of onbekende gs', () => {
  for (const src of [
    'BT /F9 12 Tf 0 0 Td (a) Tj ET',
    'BT /F1 12 Tf 7 Tr 0 0 Td (a) Tj ET',
    '/Onbekend gs BT /F1 12 Tf 0 0 Td (a) Tj ET',
  ]) {
    const r = snoei(src);
    assert.ok(r === null || r.inhoud.includes('(a) Tj'), src);
  }
});

test('een tekstobject met een tekenoperator erin blijft heel', () => {
  const r = snoei('BT /F1 12 Tf 0 0 Td (a) Tj 0 0 m 1 1 l S ET');
  assert.ok(r === null || r.inhoud.includes('(a) Tj'));
});

// --- afbeeldingen en Forms --------------------------------------------------

test('Do valt weg als het kader van de afbeelding of Form buiten het vak ligt', () => {
  const r = snoei('q 10 0 0 10 0 0 cm /Im1 Do Q\nq 10 0 0 10 150 150 cm /Im1 Do Q\nq 1 0 0 1 0 0 cm /Fm1 Do Q\n/Onbekend Do');
  assert.deepEqual(regels(r), ['q', '10 0 0 10 150 150 cm', '/Im1 Do', 'Q', '/Onbekend Do']);
  assert.ok(r.namen.has('Im1'));
  assert.ok(!r.namen.has('Fm1'));
});

test('een inline afbeelding buiten het vak valt weg, erin blijft hij met zijn namen', () => {
  const beeld = (x) => `q 10 0 0 10 ${x} ${x} cm BI /W 1 /H 1 /CS /CSx /BPC 8 ID \xff EI Q`;
  const r = snoei(`${beeld(0)}\n${beeld(150)}`);
  assert.equal(r.weg, 1);
  assert.ok(r.inhoud.includes('150 150 cm'));
  assert.ok(r.namen.has('CSx'));
});

test('shadings en BX … EX blijven altijd staan', () => {
  const r = snoei('/Sh0 sh\nBX 1 vreemd EX\n0 0 m 5 5 l S');
  assert.ok(r.inhoud.includes('/Sh0 sh'));
  assert.ok(r.inhoud.includes('vreemd'));
});

// --- niet zeker te lezen: niets doen -----------------------------------------

test('een onbekende operator of een kapot pad laat de stroom staan', () => {
  assert.equal(snoei('0 0 m 5 5 l S\nfoo'), null);
  assert.equal(snoei('0 0 m 5 5 l q S'), null);
  assert.equal(snoei('BT (a) Tj'), null);
  assert.equal(snoei('(a) Tj'), null);
});

// --- fonts ------------------------------------------------------------------

test('fontMaten leest breedtes en FontBBox; Type3 is onbekend', async () => {
  const d = await PDFDocument.create();
  const helv = d.context.lookup((await d.embedFont(StandardFonts.Helvetica)).ref);
  assert.ok(helv === undefined || helv); // embedFont schrijft pas bij flush
  await d.flush();
  const fonts = [...d.context.enumerateIndirectObjects()].filter(([, o]) => o?.get?.(PDFName.of('Type'))?.toString() === '/Font');
  const m = fontMaten(d.context, fonts[0][1]);
  assert.ok(m.breedte > 0 && m.breedte <= 2);
  assert.ok(m.uitsteek >= 2);
  const t3 = d.context.obj({ Type: 'Font', Subtype: 'Type3' });
  assert.equal(fontMaten(d.context, t3), null);
  const verticaal = d.context.obj({ Type: 'Font', Subtype: 'Type0', Encoding: 'Identity-V' });
  assert.equal(fontMaten(d.context, verticaal), null);
});

// --- een zware pagina, gerenderd ---------------------------------------------

const BREED = 1200;
const HOOG = 800;
const KNIP = { left: 400, bottom: 250, right: 700, top: 500 };

/** Een pagina vol lijnen, krommen, tekst, beelden en marked content. */
async function zwareBron({ rotatie = 0 } = {}) {
  const d = await PDFDocument.create();
  const p = d.addPage([BREED, HOOG]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  const fontNaam = p.node.newFontDictionary('F1', font.ref);
  const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const beeld = d.context.register(d.context.stream(pixels, {
    Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
  }));
  const beeldNaam = p.node.newXObject('Im', beeld);
  const gs = p.node.newExtGState('GS', d.context.register(d.context.obj({ Type: 'ExtGState', LW: 3 })));

  let x = 12345;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const n = (v) => v.toFixed(2);
  const ops = ['q 0.5 w 0 0 1 RG'];
  for (let i = 0; i < 3000; i++) {
    const x0 = rnd() * BREED, y0 = rnd() * HOOG;
    const soort = i % 6;
    if (soort === 0) ops.push(`${n(x0)} ${n(y0)} m ${n(x0 + rnd() * 60 - 30)} ${n(y0 + rnd() * 60 - 30)} l S`);
    else if (soort === 1) ops.push(`${n(rnd())} ${n(rnd())} 0 rg ${n(x0)} ${n(y0)} ${n(rnd() * 25)} ${n(rnd() * 25)} re f`);
    else if (soort === 2) ops.push(`${n(x0)} ${n(y0)} m ${n(x0 + 40)} ${n(y0 + 60)} ${n(x0 + 80)} ${n(y0 - 60)} ${n(x0 + 120)} ${n(y0)} c S`);
    else if (soort === 3) ops.push(`q ${n(1 + rnd() * 8)} w ${n(x0)} ${n(y0)} m ${n(x0 + 50)} ${n(y0)} l S Q`);
    else if (soort === 4) {
      const a = rnd() * Math.PI * 2;
      ops.push(`BT /${fontNaam} ${n(6 + rnd() * 18)} Tf ${n(Math.cos(a))} ${n(Math.sin(a))} ${n(-Math.sin(a))} ${n(Math.cos(a))} ${n(x0)} ${n(y0)} Tm (Tekst ${i}) Tj ET`);
    } else ops.push(`/OC /L${i % 3} BDC q ${n(10 + rnd() * 20)} 0 0 ${n(10 + rnd() * 20)} ${n(x0)} ${n(y0)} cm /${beeldNaam} Do Q EMC`);
  }
  // Randgevallen rond het vak: een dikke lijn die er net in reikt, een
  // uitsnede eromheen, een inline afbeelding erin en een erbuiten.
  ops.push(`/${gs} gs 6 w ${KNIP.left - 4} 300 m ${KNIP.left - 4} 400 l S`);
  ops.push(`q ${KNIP.left + 20} ${KNIP.bottom + 20} 100 100 re W n 1 0 0 rg 0 0 ${BREED} ${HOOG} re f Q`);
  ops.push(`q 30 0 0 30 ${KNIP.left + 150} ${KNIP.bottom + 30} cm BI /W 2 /H 1 /CS /RGB /BPC 8 ID \xff\x00\x00\x00\x00\xff EI Q`);
  ops.push('q 30 0 0 30 20 20 cm BI /W 2 /H 1 /CS /RGB /BPC 8 ID \xff\x00\x00\x00\x00\xff EI Q');
  ops.push('Q');
  const tekst = ops.join('\n');
  const bytes = Uint8Array.from(tekst, (c) => c.charCodeAt(0));
  p.node.set(PDFName.of('Contents'), d.context.register(d.context.flateStream(bytes)));
  const props = d.context.obj({});
  for (let i = 0; i < 3; i++) props.set(PDFName.of(`L${i}`), d.context.register(d.context.obj({ Type: 'OCG', Name: PDFString.of(`L${i}`) })));
  p.node.Resources().set(PDFName.of('Properties'), props);
  if (rotatie) p.node.set(PDFName.of('Rotate'), d.context.obj(rotatie));
  return d.save();
}

/** Rastert `vak` (ongedraaide gebruikersruimte) van pagina 0 met MuPDF.
 *  `mb` is de MediaBox: MuPDF legt haar linkerbovenhoek op de oorsprong. */
function rasterVak(bytes, vak, zoom, mb = { x: 0, y: 0, height: HOOG }) {
  const page = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(0);
  // Zonder /Rotate rekent MuPDF in dezelfde ruimte als het vak.
  const m = mupdf.Matrix.concat(
    mupdf.Matrix.translate(-(vak.left - mb.x), -(mb.y + mb.height - vak.top)),
    mupdf.Matrix.scale(zoom, zoom),
  );
  const b = Math.ceil((vak.right - vak.left) * zoom);
  const h = Math.ceil((vak.top - vak.bottom) * zoom);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, b, h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  page.runPageContents(dev, m);
  dev.close();
  return pix.getPixels().slice(); // kopie: het wasm-geheugen kan verschuiven
}

async function zonderRotatie(bytes) {
  const d = await PDFDocument.load(bytes);
  d.getPage(0).node.delete(PDFName.of('Rotate'));
  return d.save();
}

function verschillen(a, b) {
  assert.equal(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

test('zware pagina: gesnoeid knipsel is veel kleiner en rendert identiek', async () => {
  const bron = await zwareBron();
  const vol = await knipselAlsMiniPdf(bron, 0);
  const gesnoeid = await knipselAlsMiniPdf(bron, 0, 0, null, KNIP);
  assert.ok(gesnoeid.length < vol.length * 0.3, `${gesnoeid.length} vs ${vol.length}`);
  for (const zoom of [0.5, 1.5, 4]) {
    assert.equal(verschillen(rasterVak(vol, KNIP, zoom), rasterVak(gesnoeid, KNIP, zoom)), 0, `zoom ${zoom}`);
  }
  // Wat niet in het vak gebruikt wordt, gaat ook uit de resources.
  const pagina = (await PDFDocument.load(gesnoeid)).getPage(0);
  assert.ok(pagina.node.Resources().lookup(PDFName.of('Font')));
});

test('zware pagina met /Rotate: het vak blijft in ongedraaide paginaruimte', async () => {
  const bron = await zwareBron({ rotatie: 90 });
  const vol = await knipselAlsMiniPdf(bron, 0);
  const gesnoeid = await knipselAlsMiniPdf(bron, 0, 90, null, KNIP);
  assert.equal((await PDFDocument.load(gesnoeid)).getPage(0).getRotation().angle, 180);
  const a = rasterVak(await zonderRotatie(vol), KNIP, 1.5);
  const b = rasterVak(await zonderRotatie(gesnoeid), KNIP, 1.5);
  assert.equal(verschillen(a, b), 0);
});

test('een knipsel dat weinig scheelt, deelt de volle mini-PDF', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  p.drawRectangle({ x: 400, y: 300, width: 20, height: 20 });
  const bron = await d.save();
  const vol = await knipselAlsMiniPdf(bron, 0);
  const vak = { left: 90, bottom: 70, right: 230, top: 150 };
  // Er valt een rechthoek weg, maar de mini-PDF wordt niet de helft kleiner.
  assert.ok(SNOEI_DREMPEL < 1);
  assert.equal(await knipselAlsMiniPdf(bron, 0, 0, null, vak), vol);
});

test('de mini-PDF draagt geen annotaties (en dus geen tweede kopie van de pagina) mee', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  const annot = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10], P: p.ref }));
  p.node.addAnnot(annot);
  const mini = await PDFDocument.load(await knipselAlsMiniPdf(await d.save(), 0));
  assert.equal(mini.getPage(0).node.get(PDFName.of('Annots')), undefined);
  const paginas = [...mini.context.enumerateIndirectObjects()].filter(([, o]) => o?.get?.(PDFName.of('Type'))?.toString() === '/Page');
  assert.equal(paginas.length, 1);
});

test('snoeiPagina houdt resources met #-codes in hun naam', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  const font = await d.embedFont(StandardFonts.Helvetica);
  p.node.Resources().set(PDFName.of('Font'), d.context.obj({ 'F 1': font.ref }));
  const inhoud = 'BT /F#201 12 Tf 120 150 Td (a) Tj ET\n0 0 m 5 5 l S';
  p.node.set(PDFName.of('Contents'), d.context.register(d.context.stream(inhoud)));
  assert.ok(snoeiPagina(d, p, VAK));
  const fonts = p.node.Resources().lookup(PDFName.of('Font'));
  assert.deepEqual(fonts.keys().map((k) => k.decodeText()), ['F 1']);
});

test('snoeiPagina laat een pagina die het vak helemaal vult ongemoeid', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  const voor = p.node.get(PDFName.of('Contents'));
  assert.equal(snoeiPagina(d, p, { left: 0, bottom: 0, right: 600, top: 400 }), null);
  assert.equal(p.node.get(PDFName.of('Contents')), voor);
});

// --- opslaan: fonts en beelden één keer --------------------------------------

test('gesnoeide knipsels van één pagina delen bij opslaan hun fonts en beelden', async () => {
  const bron = await zwareBron();
  const vakken = [KNIP, { left: 50, bottom: 50, right: 300, top: 250 }];
  const doel = await PDFDocument.create();
  const pagina = doel.addPage([1000, 600]);
  for (const [i, vak] of vakken.entries()) {
    const mini = await knipselAlsMiniPdf(bron, 0, 0, null, vak);
    const sleutel = sleutelVoor(mini);
    const r = await bouwKnipselAppearance(doel, { bronBytes: mini, srcBox: vak, rect: [i * 400, 0, i * 400 + 300, 250], sleutel });
    pagina.drawPage(r.ingebed, { x: i * 400, y: 0, width: r.breedte, height: r.hoogte });
    pagina.node.addAnnot(doel.context.register(doel.context.obj({
      Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 1, 1], OPS_SnippetKey: PDFString.of(sleutel),
    })));
  }
  await doel.flush();
  ruimKnipselRestenOp(doel, [], { nieuwVanaf: 0 });
  const heropend = await PDFDocument.load(await doel.save());
  const tel = (soort, waarde) => [...heropend.context.enumerateIndirectObjects()]
    .filter(([, o]) => (o?.dict ?? o)?.get?.(PDFName.of(soort))?.toString() === waarde).length;
  // De catalogus bewaart de twee mini-PDF's als ondoorzichtige bytes; in de
  // appearances zelf staat het font en het beeld nog maar één keer.
  assert.equal(tel('Type', '/Font'), 1);
  assert.equal(tel('Subtype', '/Image'), 1);
});

test('ontdubbel voegt alleen echt gelijke objecten samen', async () => {
  const d = await PDFDocument.create();
  const s = (b) => d.context.register(d.context.stream(new Uint8Array(b), { Subtype: 'Image' }));
  const a = s([1, 2, 3]);
  const b = s([1, 2, 3]);
  const c = s([1, 2, 4]);
  const w1 = d.context.obj({ XObject: d.context.obj({ I: a, J: c }) });
  const w2 = d.context.obj({ XObject: d.context.obj({ I: b }) });
  assert.equal(ontdubbel(d.context, [w1, w2]), 1);
  const i1 = w1.lookup(PDFName.of('XObject')).get(PDFName.of('I'));
  const i2 = w2.lookup(PDFName.of('XObject')).get(PDFName.of('I'));
  assert.equal(i1, i2);
  assert.ok(d.context.lookup(i1));
  assert.equal(w1.lookup(PDFName.of('XObject')).get(PDFName.of('J')), c);
  assert.equal([a, b].filter((r) => d.context.lookup(r)).length, 1);
});

// --- een echte tekening -----------------------------------------------------

const ECHT = new URL('../../../test pdf-bestanden/Originele bestanden/NKE2D2_opm_aw.pdf', import.meta.url);

test('echte zware tekening: veel kleiner en beeldpunt voor beeldpunt gelijk', { skip: !existsSync(ECHT) }, async () => {
  const bytes = new Uint8Array(readFileSync(ECHT));
  const bron = await PDFDocument.load(bytes);
  const mb = bron.getPage(1).getMediaBox();
  const vak = { left: mb.x + mb.width * 0.5, bottom: mb.y + mb.height * 0.5, right: mb.x + mb.width * 0.75, top: mb.y + mb.height * 0.8 };
  const vol = await knipselAlsMiniPdf(bytes, 1, 0, bron);
  const gesnoeid = await knipselAlsMiniPdf(bytes, 1, 0, bron, vak);
  // Wat blijft is vooral het beeld dat de transparantiekeuze van de renderer
  // vasthoudt; de tekening zelf krimpt veel harder.
  assert.ok(gesnoeid.length < vol.length * 0.4, `${gesnoeid.length} vs ${vol.length}`);
  const inhoud = async (b) => {
    const d = await PDFDocument.load(b);
    const c = d.getPage(0).node.Contents();
    const delen = c.asArray ? c.asArray().map((r) => d.context.lookup(r)) : [c];
    return delen.reduce((n, st) => n + st.contents.length, 0);
  };
  assert.ok(await inhoud(gesnoeid) < await inhoud(vol) * 0.2);
  const a = rasterVak(await zonderRotatie(vol), vak, 1, mb);
  const b = rasterVak(await zonderRotatie(gesnoeid), vak, 1, mb);
  assert.equal(verschillen(a, b), 0);
});
