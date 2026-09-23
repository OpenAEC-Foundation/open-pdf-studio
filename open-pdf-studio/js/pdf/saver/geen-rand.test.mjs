// Vorm zonder rand ("geen rand" in de lijnkleurkiezer, strokeColor 'none'):
// opslaan zonder omtrek en na heropenen weer zonder rand, met vulling en
// lijndikte-instelling. Elke lezer moet de vorm zonder omtrek tonen, dus geen
// randkleur, /BS /W 0 en een appearance zonder streek-operator voor de omtrek.
// Een vorm mét rand blijft precies zoals hij was.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { buildBorderStyle, generateAppearanceStream, markeerZonderRand, randSleutelZonderRand } from './utils.js';
import { buildCloudAP, buildFilledAreaAP, buildMeasureAreaAP } from './appearance-vectors.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { randloosUitExtra } from '../loader/geen-rand.js';
import { colorWithoutStroke } from '../../annotations/fill-utils.js';

const RECT = [100, 100, 300, 200];
const RECT_SLEUTEL = RECT.join(',');
const X = (x) => x + 10;
const Y = (y) => 800 - y;
const VIERKANT = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];

const inhoud = (stream) => Buffer.from(stream.getContents()).toString('latin1');
// Schilder-operatoren in een content-stream (tekst tussen haakjes telt niet).
const operatoren = (s) => s.replace(/\([^)]*\)/g, '()').split(/\s+/)
  .filter((t) => /^(S|s|B|B\*|b|b\*|f|f\*|F|n)$/.test(t));
const OMTREK = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

/** Eén annotatie op een blad, opgeslagen en weer geopend. */
async function rondgang(dict, bewerk) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const context = doc.context;
  const { BS, ...rest } = dict;
  const annotDict = context.obj({ Type: 'Annot', Rect: RECT, ...rest });
  if (BS) annotDict.set(PDFName.of('BS'), BS(context));
  if (bewerk) bewerk(context, annotDict);
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  const annots = heropend.context.lookup(heropend.getPages()[0].node.get(PDFName.of('Annots')));
  const opgeslagen = heropend.context.lookup(annots.get(0));
  const extra = (await extractAnnotationColors(1, heropend)).get(RECT_SLEUTEL);
  return { opgeslagen, extra, context: heropend.context };
}

const breedte = (context, d) => {
  const bs = context.lookup(d.get(PDFName.of('BS')));
  return context.lookup(bs.get(PDFName.of('W'))).asNumber();
};

// ── Welke vormen ────────────────────────────────────────────────────────────

test('alle acht soorten zonder rand krijgen een randsleutel, FreeText de /IC', () => {
  for (const type of ['box', 'circle', 'polygon', 'cloud', 'filledArea', 'measureArea']) {
    assert.equal(randSleutelZonderRand({ type, strokeColor: 'none' }), 'C', type);
    assert.equal(randSleutelZonderRand({ type, strokeColor: 'transparent' }), 'C', type);
  }
  for (const type of ['textbox', 'callout']) {
    assert.equal(randSleutelZonderRand({ type, strokeColor: 'none' }), 'IC', type);
  }
});

test('met rand, zonder lijnkleur of een andere soort: niets markeren', () => {
  assert.equal(randSleutelZonderRand({ type: 'box', strokeColor: '#ff0000' }), null);
  assert.equal(randSleutelZonderRand({ type: 'box' }), null);
  assert.equal(randSleutelZonderRand({ type: 'textbox', strokeColor: null }), null);
  // Een lijn heeft geen rand die weg kan: de lijn zelf is de streek.
  assert.equal(randSleutelZonderRand({ type: 'line', strokeColor: 'none' }), null);
  assert.equal(randSleutelZonderRand({ type: 'mask', strokeColor: 'none' }), null);
});

test('de kleur voor kruis, aanhaallijn en label bij geen rand is de eigen kleur', () => {
  assert.equal(colorWithoutStroke({ color: '#cc0000', strokeColor: 'none' }), '#cc0000');
  assert.equal(colorWithoutStroke({ strokeColor: 'none' }), '#000000');
  assert.equal(colorWithoutStroke({ color: 'none', strokeColor: 'none' }), '#000000');
});

// ── Annotatie-woordenboek: opslaan en heropenen ─────────────────────────────

test('rechthoek zonder rand: geen /C, /BS /W 0, terug als none met vulling en lijndikte', async () => {
  const ann = { type: 'box', color: '#cc0000', strokeColor: 'none', fillColor: '#33aa55', lineWidth: 3, borderStyle: 'dashed' };
  const { opgeslagen, extra, context } = await rondgang(
    { Subtype: 'Square', C: [0, 0, 0], IC: [0.2, 0.6666666666666666, 0.3333333333333333], BS: (c) => buildBorderStyle(c, 3, 'dashed') },
    (c, d) => markeerZonderRand(c, d, ann, randSleutelZonderRand(ann)),
  );
  assert.equal(opgeslagen.get(PDFName.of('C')), undefined, 'geen /C verwacht');
  assert.equal(breedte(context, opgeslagen), 0);
  assert.ok(opgeslagen.get(PDFName.of('OPS_NoStroke')), 'eigen sleutel ontbreekt');
  assert.equal(extra.ic, '#33aa55');
  assert.equal(extra.borderStyle, 'dashed', 'lijnstijl blijft bewaard');
  assert.deepEqual(randloosUitExtra(extra), { strokeColor: 'none', lineWidth: 3, color: '#cc0000' });
});

test('tekstvak zonder rand: de randkleur /IC gaat weg, de vulling /C blijft', async () => {
  const ann = { type: 'textbox', color: '#123456', strokeColor: 'none', fillColor: '#ffffff', lineWidth: 1.5 };
  const { opgeslagen, extra, context } = await rondgang(
    { Subtype: 'FreeText', C: [1, 1, 1], IC: [0, 0, 0], BS: (c) => buildBorderStyle(c, 1.5, 'solid') },
    (c, d) => markeerZonderRand(c, d, ann, randSleutelZonderRand(ann)),
  );
  assert.equal(opgeslagen.get(PDFName.of('IC')), undefined, 'geen /IC verwacht');
  assert.ok(opgeslagen.get(PDFName.of('C')), 'vulling /C moet blijven');
  assert.equal(breedte(context, opgeslagen), 0);
  assert.equal(extra.cColor, '#ffffff');
  assert.deepEqual(randloosUitExtra(extra), { strokeColor: 'none', lineWidth: 1.5, color: '#123456' });
});

test('een vorm mét rand houdt /C en /W en komt niet randloos terug', async () => {
  const { opgeslagen, extra, context } = await rondgang(
    { Subtype: 'Square', C: [0, 0, 1], IC: [0, 1, 0], BS: (c) => buildBorderStyle(c, 3, 'solid') },
  );
  assert.ok(opgeslagen.get(PDFName.of('C')));
  assert.equal(breedte(context, opgeslagen), 3);
  assert.equal(randloosUitExtra(extra), null);
});

// ── Appearance-streams ──────────────────────────────────────────────────────

async function apVan(ann) {
  const doc = await PDFDocument.create();
  const stream = generateAppearanceStream(doc.context, ann, Y);
  return stream ? inhoud(stream) : null;
}

const RECHTHOEK = { type: 'box', x: 10, y: 20, width: 40, height: 30, color: '#cc0000', strokeColor: '#0000ff', fillColor: '#33aa55', lineWidth: 3 };

test('appearance rechthoek en ellips zonder rand: alleen vulling, geen omtrek', async () => {
  for (const type of ['box', 'circle']) {
    const ops = operatoren(await apVan({ ...RECHTHOEK, type, strokeColor: 'none' }));
    assert.ok(ops.includes('f'), `${type}: vulling ontbreekt`);
    assert.ok(!ops.some((o) => OMTREK.has(o)), `${type}: omtrek in ${ops.join(' ')}`);
  }
  // Zonder vulling en zonder rand valt er niets te tekenen.
  assert.equal(await apVan({ ...RECHTHOEK, strokeColor: 'none', fillColor: null }), null);
});

test('kruis zonder rand: alleen de diagonalen, in de eigen kleur', async () => {
  const rechthoek = await apVan({ ...RECHTHOEK, strokeColor: 'none', cross: true });
  assert.deepEqual(operatoren(rechthoek), ['f', 'S']);
  assert.match(rechthoek, /0\.8 0 0 RG/);
  assert.match(rechthoek, /0 0 m 40 30 l 40 0 m 0 30 l S/);
  const ellips = await apVan({ ...RECHTHOEK, type: 'circle', strokeColor: 'none', cross: true });
  assert.deepEqual(operatoren(ellips), ['f', 'S']);
  assert.match(ellips, /8 3 m 32 27 l\n32 3 m 8 27 l\nS/);
});

test('appearance rechthoek en ellips mét rand: ongewijzigd', async () => {
  assert.equal(await apVan(RECHTHOEK),
    '3 w\n0 0 1 RG\n0.2 0.6666666666666666 0.3333333333333333 rg\n0 0 40 30 re B\n');
  assert.equal(await apVan({ ...RECHTHOEK, cross: true }),
    '3 w\n0 0 1 RG\n0.2 0.6666666666666666 0.3333333333333333 rg\n0 0 40 30 re B\n0 0 m 40 30 l 40 0 m 0 30 l S\n');
  assert.equal(await apVan({ ...RECHTHOEK, type: 'circle', cross: true, fillColor: null }),
    '3 w\n0 0 1 RG\n20 30 m\n31.045694996 30 40 23.284271247 40 15 c\n40 6.7157287530000005 31.045694996 0 20 0 c\n'
    + '8.954305004 0 0 6.7157287530000005 0 15 c\n0 23.284271247 8.954305004 30 20 30 c\nS\n8 3 m 32 27 l\n32 3 m 8 27 l\nS\n');
});

const WOLK = { kind: 'rect', x: 0, y: 0, w: 40, h: 30, puff: 15, X, Y, fillColorHex: '#33aa55', strokeColorHex: '#0000ff', lineWidth: 3, borderStyle: 'solid' };
const VLAK = { points: VIERKANT, X, Y, fillColorHex: '#33aa55', strokeColorHex: '#0000ff', lineWidth: 3, borderStyle: 'solid' };

test('wolk, vlak en meetvlak zonder rand: vulling blijft, omtrek weg', () => {
  // De vulling gaat sinds #457 met de niet-nul-regel (f in plaats van f*), zodat
  // losse delen in een vlak optellen; voor een enkele ring is dat hetzelfde beeld.
  assert.deepEqual(operatoren(buildCloudAP({ ...WOLK, heeftRand: false }).content), ['f']);
  assert.deepEqual(operatoren(buildFilledAreaAP({ ...VLAK, heeftRand: false }).content), ['f']);
  const meet = buildMeasureAreaAP({ ...VLAK, heeftRand: false, strokeColorHex: '#cc0000', text: '12 m2' }).content;
  // eerste f = het vlak, tweede f = het witte labelplaatje; het label krijgt de eigen kleur.
  assert.deepEqual(operatoren(meet), ['f', 'f']);
  assert.match(meet, /0\.8 0 0 rg\nBT/);
});

test('wolk, vlak en meetvlak mét rand: ongewijzigd', async () => {
  const { createHash } = await import('node:crypto');
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(hash(buildCloudAP(WOLK).content), 'f6b5cb83ebf181cdd1def5e6b5b217943d8ad2055785dddd671be3bb35aa7723');
  assert.equal(buildFilledAreaAP(VLAK).content,
    '0.2 0.667 0.333 rg\n10 800 m\n50 800 l\n50 770 l\n10 770 l\nh\nf\n0 0 1 RG\n3 w\n[] 0 d\n10 800 m\n50 800 l\n50 770 l\n10 770 l\nh\nS\n');
  assert.equal(buildMeasureAreaAP({ ...VLAK, borderStyle: 'dashed', text: '12 m2' }).content,
    '0.2 0.667 0.333 rg\n10 800 m\n50 800 l\n50 770 l\n10 770 l\nh\nf\n0 0 1 RG\n3 w\n[3 4] 0 d\n10 800 m\n50 800 l\n50 770 l\n10 770 l\nh\nS\n'
    + 'q\n1 1 1 rg\n14.25 777.5 31.5 15 re f\n0 0 1 rg\nBT\n/Helv 11 Tf\n16.25 782.25 Td\n(12 m2) Tj\nET\nQ\n');
});
