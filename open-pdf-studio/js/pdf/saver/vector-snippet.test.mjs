// Het schrijfpad van een vectorknipsel: appearance-ops, de bronpagina op de
// catalogus, en de ontdubbeling daarvan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import {
  knipselApOps, registreerBron, bouwKnipselAppearance, CATALOGUS_SLEUTEL,
  knipselPlaatsing, tekenKnipselInPagina, alInBasis, markeerGebakken, ruimKnipselRestenOp,
} from './vector-snippet.js';

const VAK = { left: 100, bottom: 80, right: 220, top: 140 };  // 120 x 60

async function bron() {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  return d.save();
}

// --- appearance-ops -------------------------------------------------------

test('de ops schalen het knipsel naar de Rect en verschuiven het erheen', () => {
  const ops = knipselApOps([50, 40, 290, 160], 120, 60, 'OPSK0');
  assert.equal(ops, 'q 2 0 0 2 50 40 cm /OPSK0 Do Q');
});

test('een Rect met dezelfde maat als het knipsel geeft schaal 1', () => {
  assert.equal(knipselApOps([0, 0, 120, 60], 120, 60, 'OPSK0'), 'q 1 0 0 1 0 0 cm /OPSK0 Do Q');
});

test('ongelijke schaling in x en y is toegestaan (de gebruiker mag uitrekken)', () => {
  assert.equal(knipselApOps([0, 0, 240, 60], 120, 60, 'OPSK0'), 'q 2 0 0 1 0 0 cm /OPSK0 Do Q');
});

test('een leeg knipsel of een leeg doelvak levert geen ops', () => {
  assert.equal(knipselApOps([0, 0, 100, 100], 0, 60, 'X'), null);
  assert.equal(knipselApOps([0, 0, 100, 100], 120, 0, 'X'), null);
  assert.equal(knipselApOps([10, 10, 10, 100], 120, 60, 'X'), null);
  assert.equal(knipselApOps(null, 120, 60, 'X'), null);
});

// --- bronpagina op de catalogus -------------------------------------------

test('de bronpagina komt in een woordenboek op de catalogus', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  await registreerBron(doel, 'aaaabbbbccccdddd', await bron());
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.ok(wb, 'woordenboek ontbreekt');
  assert.deepEqual(wb.keys().map((k) => k.asString()), ['/aaaabbbbccccdddd']);
});

test('dezelfde sleutel twee keer registreren levert één stream', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  const bytes = await bron();
  const a = await registreerBron(doel, 'aaaabbbbccccdddd', bytes);
  const b = await registreerBron(doel, 'aaaabbbbccccdddd', bytes);
  assert.equal(a.toString(), b.toString(), 'zelfde ref');
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.equal(wb.keys().length, 1);
});

test('twee verschillende bronnen krijgen elk hun eigen stream', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([300, 300]);
  await registreerBron(doel, 'aaaabbbbccccdddd', await bron());
  await registreerBron(doel, '1111222233334444', await bron());
  const heropend = await PDFDocument.load(await doel.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.equal(wb.keys().length, 2);
});

// --- het geheel -----------------------------------------------------------

test('bouwKnipselAppearance levert ops plus het XObject om ze aan te hangen', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  const r = await bouwKnipselAppearance(doel, {
    bronBytes: await bron(), srcBox: VAK, rect: [50, 50, 290, 170], sleutel: 'aaaabbbbccccdddd',
  });
  assert.deepEqual([r.breedte, r.hoogte], [120, 60]);
  assert.equal(r.content, 'q 2 0 0 2 50 50 cm /OPSK0 Do Q');
  assert.deepEqual(Object.keys(r.xobjects), ['OPSK0']);
  assert.ok(r.bronRef, 'bronpagina geregistreerd');
});

test('zonder bronbytes weigert het schrijfpad in plaats van een leeg knipsel te maken', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  await assert.rejects(
    () => bouwKnipselAppearance(doel, { bronBytes: null, srcBox: VAK, rect: [0, 0, 10, 10], sleutel: 'x' }),
    /geen bronbytes/,
  );
});

test('een ontaard doelvak weigert ook', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([600, 600]);
  const bytes = await bron();
  await assert.rejects(
    () => bouwKnipselAppearance(doel, {
      bronBytes: bytes, srcBox: VAK, rect: [50, 50, 50, 170], sleutel: 'aaaabbbbccccdddd',
    }),
    /geen oppervlak/,
  );
});

// --- gedraaid doelblad ----------------------------------------------------
//
// Een viewer draait de hele pagina mee met /Rotate, de appearance ook. Het
// knipsel moet dus tegengedraaid in de Rect staan, anders ligt het op zijn
// kant (en bij een kwartslag ook nog uitgerekt). De Rect is hier al in de
// ongedraaide paginaruimte, zoals de saver hem aanlevert.

const BLAD_B = 600;
const BLAD_H = 400;

/** Ongedraaide PDF-coördinaat -> wat je ziet (y omhoog), per /Rotate. */
function opHetScherm(rot, px, py) {
  switch (rot) {
    case 90:  return [py, BLAD_B - px];
    case 180: return [BLAD_B - px, BLAD_H - py];
    case 270: return [BLAD_H - py, px];
    default:  return [px, py];
  }
}

test('knipselPlaatsing zet het knipsel rechtop op elk gedraaid blad', () => {
  const B = 120;
  const H = 60;
  // Een Rect die op het scherm B x H groot is: bij een kwartslag dus H x B.
  const rects = {
    0:   [50, 40, 170, 100],
    90:  [50, 40, 110, 160],
    180: [50, 40, 170, 100],
    270: [50, 40, 110, 160],
  };
  for (const [r, rect] of Object.entries(rects)) {
    const rot = Number(r);
    const [a, b, c, d, e, f] = knipselPlaatsing(rect, B, H, rot);
    const naarPagina = (s, t) => [a * s + c * t + e, b * s + d * t + f];
    const hoeken = rect.length && [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]
      .map(([x, y]) => opHetScherm(rot, x, y));
    const minX = Math.min(...hoeken.map((h) => h[0]));
    const maxX = Math.max(...hoeken.map((h) => h[0]));
    const minY = Math.min(...hoeken.map((h) => h[1]));
    const maxY = Math.max(...hoeken.map((h) => h[1]));
    assert.deepEqual(opHetScherm(rot, ...naarPagina(0, 0)), [minX, minY], `rotatie ${rot}: linksonder`);
    assert.deepEqual(opHetScherm(rot, ...naarPagina(B, 0)), [maxX, minY], `rotatie ${rot}: rechtsonder`);
    assert.deepEqual(opHetScherm(rot, ...naarPagina(0, H)), [minX, maxY], `rotatie ${rot}: linksboven`);
  }
});

test('zonder rotatie blijft de plaatsing een schaal plus verschuiving', () => {
  assert.deepEqual(knipselPlaatsing([50, 40, 290, 160], 120, 60), [2, 0, 0, 2, 50, 40]);
});

test('de ops op een kwartgedraaid blad dragen de draaiing in cm', () => {
  assert.equal(knipselApOps([50, 40, 110, 160], 120, 60, 'OPSK0', 90), 'q 0 1 -1 0 110 40 cm /OPSK0 Do Q');
});

test('bouwKnipselAppearance geeft de plaatsing mee voor het vastzetten', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([BLAD_B, BLAD_H]);
  const r = await bouwKnipselAppearance(doel, {
    bronBytes: await bron(), srcBox: VAK, rect: [50, 40, 110, 160], sleutel: 'aaaabbbbccccdddd', paginaRot: 90,
  });
  assert.deepEqual(r.plaatsing, [0, 1, -1, 0, 110, 40]);
  assert.ok(r.content.includes('0 1 -1 0 110 40 cm'));
});

test('vastzetten tekent het knipsel met dezelfde plaatsing in de pagina-inhoud', async () => {
  const doel = await PDFDocument.create();
  const pagina = doel.addPage([BLAD_B, BLAD_H]);
  pagina.setRotation({ type: 'degrees', angle: 90 });
  const r = await bouwKnipselAppearance(doel, {
    bronBytes: await bron(), srcBox: VAK, rect: [50, 40, 110, 160], sleutel: 'aaaabbbbccccdddd', paginaRot: 90,
  });
  await tekenKnipselInPagina(pagina, r.ingebed.ref, r.plaatsing, 0.5);
  const heropend = await PDFDocument.load(await doel.save());
  const p = heropend.getPage(0);
  const res = p.node.Resources();
  const xobjs = res.lookup(PDFName.of('XObject'));
  assert.equal(xobjs.keys().length, 1, 'het knipsel staat in de pagina-resources');
  const gs = res.lookup(PDFName.of('ExtGState'));
  assert.ok(gs && gs.keys().length === 1, 'doorzichtigheid via een ExtGState');
  const inhoud = p.node.normalizedEntries().Contents;
  const tekst = inhoud.asArray().map((ref) => {
    const st = heropend.context.lookup(ref);
    const rauw = Buffer.from(st.getContents ? st.getContents() : st.contents);
    const flate = String(st.dict.get(PDFName.of('Filter')) || '') === '/FlateDecode';
    return (flate ? inflateSync(rauw) : rauw).toString('latin1');
  }).join(' ');
  assert.match(tekst, /0 1 -1 0 110 40 cm/);
  assert.ok(tekst.includes(`${xobjs.keys()[0].asString()} Do`), 'de inhoud tekent het knipsel');
});

// --- niet twee keer inbakken ----------------------------------------------
//
// Na opslaan staat een vastgezet knipsel IN de pagina-inhoud van het bestand,
// en die bytes worden de basis voor de volgende save. Blijft het knipsel ook
// in het model staan, dan tekent een tweede Ctrl+S het er nog een keer bij.

test('markeerGebakken merkt alleen vastgezette knipsels, met het pad van de save', () => {
  const vast = { type: 'vectorSnippet', flattened: true };
  const los = { type: 'vectorSnippet', flattened: false };
  const ander = { type: 'box', flattened: true };
  assert.equal(markeerGebakken([vast, los, ander], 'C:/a.pdf'), 1);
  assert.equal(vast.gebakkenIn, 'C:/a.pdf');
  assert.equal(los.gebakkenIn, undefined);
  assert.equal(ander.gebakkenIn, undefined);
});

test('alInBasis: overslaan zolang de basis uit hetzelfde pad komt', () => {
  const k = { type: 'vectorSnippet', flattened: true, gebakkenIn: 'C:/a.pdf' };
  assert.equal(alInBasis(k, 'C:/a.pdf'), true, 'opgeslagen op dezelfde plek');
  assert.equal(alInBasis(k, 'C:/tmp/werkkopie.pdf'), false, 'basis is een andere kopie: opnieuw tekenen');
  assert.equal(alInBasis({ type: 'vectorSnippet', flattened: true }, 'C:/a.pdf'), false, 'nog nooit opgeslagen');
  assert.equal(alInBasis({ type: 'box', gebakkenIn: 'C:/a.pdf' }, 'C:/a.pdf'), false);
});

test('ook een losgemaakt knipsel dat al gebakken is wordt niet nogmaals geschreven', () => {
  // Ongedaan maken van het vastzetten na een save: de inhoud staat al in het
  // bestand, dus een stempel erbij zou het dubbel maken.
  assert.equal(alInBasis({ type: 'vectorSnippet', flattened: false, gebakkenIn: 'C:/a.pdf' }, 'C:/a.pdf'), true);
});

test('een vastgezet knipsel neemt de bronpagina niet mee naar de catalogus', async () => {
  const doel = await PDFDocument.create();
  doel.addPage([BLAD_B, BLAD_H]);
  const r = await bouwKnipselAppearance(doel, {
    bronBytes: await bron(), srcBox: VAK, rect: [50, 40, 170, 100], sleutel: 'aaaabbbbccccdddd', bewaarBron: false,
  });
  assert.equal(r.bronRef, null);
  assert.equal(doel.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL)), undefined);
});

// --- geen groei bij elke save ---------------------------------------------
//
// De saver vervangt een knipsel-stempel bij elke save door een nieuwe, met een
// verse kopie van de bronpagina. pdf-lib schrijft onbereikbare objecten gewoon
// mee weg, dus zonder opruimen groeit het bestand per save met de hele
// bronpagina (bij een zware tekening ruim 11 MB).

/** Een bronpagina met flink wat eigen inhoud, zodat groei meetbaar is. */
async function zwareBron() {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  for (let i = 0; i < 400; i++) p.drawRectangle({ x: (i * 7) % 580, y: (i * 13) % 380, width: 5, height: 5 });
  return d.save({ useObjectStreams: false });
}

/** Zet een knipsel-stempel op pagina 0, zoals saver.js dat doet. */
async function zetKnipsel(doc, bronBytes, sleutel) {
  const rect = [50, 40, 170, 100];
  const g = await bouwKnipselAppearance(doc, { bronBytes, srcBox: VAK, rect, sleutel });
  const context = doc.context;
  const ap = context.stream(g.content, {
    Type: 'XObject', Subtype: 'Form', BBox: rect, Matrix: [1, 0, 0, 1, -50, -40],
    Resources: context.obj({ XObject: context.obj(g.xobjects) }),
  });
  const annot = context.register(context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: rect,
    OPS_Subtype: PDFString.of('vectorSnippet'), OPS_SnippetKey: PDFString.of(sleutel),
    AP: context.obj({ N: context.register(ap) }),
  }));
  doc.getPage(0).node.set(PDFName.of('Annots'), context.obj([annot]));
  return annot;
}

/** Eén save-ronde: oude stempel eruit, nieuwe erin, resten opruimen. */
async function saveRonde(bytes, bronBytes, sleutel) {
  const doc = await PDFDocument.load(bytes);
  const nieuwVanaf = doc.context.largestObjectNumber;
  const oud = doc.getPage(0).node.Annots().asArray();
  await zetKnipsel(doc, bronBytes, sleutel);
  await doc.flush();
  ruimKnipselRestenOp(doc, oud, { nieuwVanaf });
  return doc.save({ useObjectStreams: false });
}

test('opnieuw opslaan van een los knipsel laat het bestand niet groeien', async () => {
  const bronBytes = await zwareBron();
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  await zetKnipsel(doc, bronBytes, 'aaaabbbbccccdddd');
  let bytes = await doc.save({ useObjectStreams: false });
  const start = bytes.length;
  for (let i = 0; i < 3; i++) bytes = await saveRonde(bytes, bronBytes, 'aaaabbbbccccdddd');
  assert.ok(bytes.length < start * 1.1, `gegroeid van ${start} naar ${bytes.length} bytes`);
  const heropend = await PDFDocument.load(bytes);
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.deepEqual(wb.keys().map((k) => k.asString()), ['/aaaabbbbccccdddd'], 'de bron blijft voor het losse knipsel');
});

test('een bron zonder knipsel dat ernaar verwijst verdwijnt uit het bestand', async () => {
  const bronBytes = await zwareBron();
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  await zetKnipsel(doc, bronBytes, 'aaaabbbbccccdddd');
  const bytes = await doc.save({ useObjectStreams: false });

  // Vastgezet: de stempel verdwijnt, het knipsel wordt pagina-inhoud.
  const tweede = await PDFDocument.load(bytes);
  const oud = tweede.getPage(0).node.Annots().asArray();
  tweede.getPage(0).node.delete(PDFName.of('Annots'));
  const r = ruimKnipselRestenOp(tweede, oud);
  const na = await tweede.save({ useObjectStreams: false });
  assert.deepEqual(r.bronnenWeg, ['aaaabbbbccccdddd']);
  assert.equal((await PDFDocument.load(na)).catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL)), undefined);
  const bronStreams = (await PDFDocument.load(na)).context.enumerateIndirectObjects()
    .filter(([, o]) => o.dict && String(o.dict.get(PDFName.of('Type'))) === '/OPSVectorSnippet');
  assert.equal(bronStreams.length, 0, 'de bronstream zelf staat nog in het bestand');
});

test('opruimen raakt niets wat de rest van het document nog gebruikt', async () => {
  const bronBytes = await zwareBron();
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  const annot = await zetKnipsel(doc, bronBytes, 'aaaabbbbccccdddd');
  // Dezelfde stempel staat nog op de pagina: niets mag weg.
  const r = ruimKnipselRestenOp(doc, [annot]);
  assert.equal(r.verwijderd, 0);
  assert.deepEqual(r.bronnenWeg, []);
  const heropend = await PDFDocument.load(await doc.save());
  assert.equal(heropend.getPage(0).node.Annots().size(), 1);
});

test('de kopie van de bronpagina die embedPage achterlaat, gaat niet mee het bestand in', async () => {
  const bronBytes = await zwareBron();
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  const nieuwVanaf = doc.context.largestObjectNumber;
  await zetKnipsel(doc, bronBytes, 'aaaabbbbccccdddd');
  await doc.flush();
  const r = ruimKnipselRestenOp(doc, [], { nieuwVanaf });
  assert.ok(r.verwijderd > 0, 'er bleven wezen achter na het inbedden');
  const t = doc.context.trailerInfo;
  const bekend = new Set();
  const stapel = [t.Root, t.Info].filter(Boolean);
  while (stapel.length) {
    let o = stapel.pop();
    if (o && o.tag) { if (bekend.has(o.tag)) continue; bekend.add(o.tag); o = doc.context.lookup(o); }
    if (!o) continue;
    const kinderen = o.dict ? o.dict.entries() : (typeof o.entries === 'function' ? o.entries() : (typeof o.asArray === 'function' ? o.asArray().map((v) => [null, v]) : []));
    for (const [, v] of kinderen) stapel.push(v);
  }
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    assert.ok(bekend.has(ref.tag), `wees ${ref.tag} bleef staan`);
  }
  // En het knipsel is er nog, heel.
  const heropend = await PDFDocument.load(await doc.save());
  assert.equal(heropend.getPage(0).node.Annots().size(), 1);
});
