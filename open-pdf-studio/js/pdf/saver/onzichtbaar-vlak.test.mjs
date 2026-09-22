// Onzichtbaar vlak (#435): een vlak dat het bestand uitdrukkelijk zonder rand,
// zonder randkleur en zonder vulling opgeeft.
//
// Tekenpakketten schrijven hun doorzoekbare tekst weg als zo'n vlak: een
// /Square met /Border [0 0 0], zonder /C, zonder /IC en zonder appearance.
// Per PDF-spec is een randbreedte van 0 géén rand, dus andere lezers tonen
// niets. De app tekent er op het scherm een dunne hulplijn omheen zodat het
// vlak vindbaar blijft (rendering.js: lijndikte 0 zonder vulling wordt 0,5),
// maar die hulplijn hoort alleen op het scherm. Schreef de appearance hem mee
// als haarlijn (`0 w ... re S`), dan waren de vlakken na opslaan ook in andere
// lezers zichtbaar.
//
// Het laadpad blijft zoals #431 het liet: zo'n vlak komt NIET randloos terug,
// juist zodat de hulplijn blijft staan. Er komt alleen een kenmerk bij.
//
// De lijndikte moet uit het bestand zelf komen: ontbreken /BS en /Border
// allebei, dan meldt de lezer óók lijndikte 0, terwijl zo'n vorm wel degelijk
// een zichtbare rand in zijn appearance heeft.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { generateAppearanceStream, onzichtbaarVlak } from './utils.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { onzichtbaarVlakUitExtra, randloosUitExtra } from '../loader/geen-rand.js';

const RECT = [100, 100, 300, 200];
const RECT_SLEUTEL = RECT.join(',');
const Y = (y) => 800 - y;

const inhoud = (stream) => Buffer.from(stream.getContents()).toString('latin1');
// Schilder-operatoren in een content-stream (tekst tussen haakjes telt niet).
const operatoren = (s) => s.replace(/\([^)]*\)/g, '()').split(/\s+/)
  .filter((t) => /^(S|s|B|B\*|b|b\*|f|f\*|F|n)$/.test(t));
const OMTREK = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

/** Eén annotatie op een blad, opgeslagen als echte PDF-bytes en weer geopend. */
async function extraVan(dict) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const annotDict = doc.context.obj({ Type: 'Annot', Rect: RECT, ...dict });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  return (await extractAnnotationColors(1, heropend)).get(RECT_SLEUTEL);
}

async function apVan(ann) {
  const doc = await PDFDocument.create();
  const stream = generateAppearanceStream(doc.context, ann, Y);
  return stream ? inhoud(stream) : null;
}

// Het model dat de loader van zo'n vlak maakt: lijndikte 0 uit /Border, geen
// vulling (geen /IC), de standaard-randkleur zwart (geen /C) en het kenmerk.
const ONZICHTBAAR = {
  type: 'box', x: 10, y: 20, width: 40, height: 30,
  color: '#000000', strokeColor: '#000000', fillColor: null, lineWidth: 0,
  onzichtbaarVlak: true,
};

// ── Laadpad: de hulplijn blijft, het kenmerk komt erbij ─────────────────────

test('laadpad: /Border [0 0 0] zonder kleur en zonder vulling houdt zijn hulplijn', async () => {
  const extra = await extraVan({ Subtype: 'Square', F: 64, Border: [0, 0, 0], Contents: 'tekst uit het tekenpakket' });
  assert.equal(extra.borderWidth, 0, 'lijndikte 0 uit /Border');
  assert.equal(extra.ic, undefined, 'geen vulling');
  // Niet randloos: dan zou de app de hulplijn ook weglaten en is het vlak
  // nergens meer te vinden.
  assert.equal(randloosUitExtra(extra), null);
  assert.equal(onzichtbaarVlakUitExtra(extra), true);
});

test('laadpad: met randkleur, met vulling of zonder /BS en /Border is het vlak niet onzichtbaar', async () => {
  // Randkleur in het bestand: de rand is bedoeld, al is hij 0 breed.
  assert.equal(onzichtbaarVlakUitExtra(await extraVan({ Subtype: 'Square', C: [1, 0, 0], BS: { W: 0 } })), false, '/C aanwezig');
  // Vulling: er blijft iets te zien.
  assert.equal(onzichtbaarVlakUitExtra(await extraVan({ Subtype: 'Square', IC: [0, 1, 0], BS: { W: 0 } })), false, '/IC aanwezig');
  // Geen /BS en geen /Border: de lezer meldt lijndikte 0, maar het bestand
  // zegt niets — zulke vormen hebben vaak een gewone rand in hun appearance.
  assert.equal(onzichtbaarVlakUitExtra(await extraVan({ Subtype: 'Square', C: [1, 0, 0] })), false, 'geen /BS en geen /Border');
  assert.equal(onzichtbaarVlakUitExtra(await extraVan({ Subtype: 'Circle' })), false, 'niets opgegeven');
  // Een echte rand.
  assert.equal(onzichtbaarVlakUitExtra(await extraVan({ Subtype: 'Square', BS: { W: 2 } })), false, 'lijndikte 2');
});

// ── Savepad: geen streek in de appearance ───────────────────────────────────

test('vlak zonder rand en zonder vulling: appearance zonder streek', async () => {
  const ap = await apVan(ONZICHTBAAR);
  assert.ok(ap, 'appearance verwacht');
  assert.ok(!operatoren(ap).some((o) => OMTREK.has(o)), `omtrek in ${ap}`);
  assert.equal(ap, '0 0 40 30 re n\n');
});

test('ellips zonder rand en zonder vulling: appearance zonder streek', async () => {
  const ap = await apVan({ ...ONZICHTBAAR, type: 'circle' });
  assert.ok(ap, 'appearance verwacht');
  assert.ok(!operatoren(ap).some((o) => OMTREK.has(o)), `omtrek in ${ap}`);
});

test('kruis in zo n vlak blijft staan', async () => {
  const ap = await apVan({ ...ONZICHTBAAR, cross: true });
  assert.match(ap, /0 0 m 40 30 l 40 0 m 0 30 l S\n/, 'diagonalen ontbreken');
  assert.ok(!/re [SsBb]/.test(ap), `kader gestreekt in ${ap}`);
});

// ── Alles wat wél iets te zien geeft: byte-gelijk aan de huidige uitvoer ────

test('zonder het kenmerk, met vulling of met lijndikte: ongewijzigd', async () => {
  // Zelfde model, maar het bestand gaf geen uitdrukkelijke lijndikte 0 op.
  assert.equal(await apVan({ ...ONZICHTBAAR, onzichtbaarVlak: false }), '0 w\n0 0 0 RG\n0 0 40 30 re S\n');
  assert.equal(await apVan({ ...ONZICHTBAAR, onzichtbaarVlak: undefined }), '0 w\n0 0 0 RG\n0 0 40 30 re S\n');
  assert.equal(await apVan({ ...ONZICHTBAAR, fillColor: '#33aa55' }),
    '0 w\n0 0 0 RG\n0.2 0.6666666666666666 0.3333333333333333 rg\n0 0 40 30 re B\n');
  assert.equal(await apVan({ ...ONZICHTBAAR, lineWidth: 1 }), '1 w\n0 0 0 RG\n0 0 40 30 re S\n');
  assert.equal(await apVan({ ...ONZICHTBAAR, lineWidth: undefined }), '2 w\n0 0 0 RG\n0 0 40 30 re S\n');
  // Maskeren (wipeout) is altijd wit gevuld en verandert dus niet.
  assert.equal(await apVan({ ...ONZICHTBAAR, type: 'mask', fillColor: '#ffffff' }),
    '0 w\n0 0 0 RG\n1 1 1 rg\n0 0 40 30 re B\n');
  assert.equal(await apVan({ ...ONZICHTBAAR, type: 'circle', lineWidth: 1 }),
    '1 w\n0 0 0 RG\n20 30 m\n31.045694996 30 40 23.284271247 40 15 c\n'
    + '40 6.7157287530000005 31.045694996 0 20 0 c\n8.954305004 0 0 6.7157287530000005 0 15 c\n'
    + '0 23.284271247 8.954305004 30 20 30 c\nS\n');
});

test('onzichtbaarVlak: pas als het kenmerk, de lijndikte en de vulling kloppen', () => {
  assert.equal(onzichtbaarVlak(ONZICHTBAAR), true);
  assert.equal(onzichtbaarVlak({ ...ONZICHTBAAR, lineWidth: 0.5 }), false, 'eigen lijndikte gekozen');
  assert.equal(onzichtbaarVlak({ ...ONZICHTBAAR, fillColor: '#ffffff' }), false, 'vulling gekozen');
  assert.equal(onzichtbaarVlak({ ...ONZICHTBAAR, fillColor: 'none' }), true, 'geen vulling is geen vulling');
  assert.equal(onzichtbaarVlak({ ...ONZICHTBAAR, onzichtbaarVlak: undefined }), false);
  assert.equal(onzichtbaarVlak(null), false);
});

// ── Rondgang: opslaan → heropenen → opslaan verandert niets meer ────────────

test('rondgang: het opgeslagen vlak levert hetzelfde model en dezelfde appearance op', async () => {
  // Zo schrijft de app het vlak weg: geen randkleur, /BS /W 0, geen /IC.
  const extra = await extraVan({ Subtype: 'Square', F: 64, BS: { W: 0, S: 'S' }, Contents: 'tekst uit het tekenpakket' });
  assert.equal(extra.borderWidth, 0);
  assert.equal(extra.ic, undefined, 'nog steeds geen vulling');
  assert.equal(randloosUitExtra(extra), null, 'hulplijn blijft ook na de rondgang');
  assert.equal(onzichtbaarVlakUitExtra(extra), true, 'kenmerk komt terug');
  // Daaruit komt hetzelfde model, dus dezelfde appearance: idempotent.
  assert.equal(await apVan(ONZICHTBAAR), '0 0 40 30 re n\n');
});
