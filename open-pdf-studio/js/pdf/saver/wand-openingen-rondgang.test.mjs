// Gehoste openingen overleven opslaan en heropenen (#1229).
//
// De test schrijft echte PDF-bytes met de sleutels zoals de saver ze zet (de
// wand met OPS_Openings, het kozijn met zijn OPS_Params), leest ze terug met
// de lezer (extractAnnotationColors), zet ze om naar de velden van het model
// en koppelt wand en kozijn weer aan elkaar, met nieuwe annotatie-id's zoals
// na echt laden. Daarna moet de hosting weer werken: het kozijn schuift langs
// de wand en het gat gaat mee. De converter en de saver zelf zijn in node
// niet te laden (ze hangen aan de app-staat); de laatste test bewaakt dat ze
// deze gedeelde regels ook echt gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { schrijfPlattegrondMeta, openingenVoorBestand } from './plattegrond-meta.js';
import { pdfTextString } from './pdf-text.js';
import { leesOpeningen, wandOpeningenUitExtra } from '../loader/plattegrond-meta.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { herkoppelOpeningen, openingIntervallen } from '../../annotations/wand-openingen.js';
import { wandVorm } from '../../annotations/wand-vorm.js';
import { hostingNaCommando, gehosteWand, hartVanSymbool } from '../../plattegrond/gehoste-opening.js';
import { plattegrondOpdracht } from '../../plattegrond/mcp-plattegrond.js';
import { kozijnTekenopdrachten } from '../../plattegrond/kozijn.js';

const K = 0.5;                                    // paginapunten per mm
const WAND_RECT = [50, 480, 2060, 520];
const KOZIJN_RECT = [900, 300, 1400, 600];
const kloon = (x) => JSON.parse(JSON.stringify(x));

/**
 * Een wand met een deur en een raam, gemaakt zoals de app het doet.
 * `imperiaal`: op een blad in voet of inch (#1230).
 */
async function tekening(imperiaal = false) {
  const doc = { currentPage: 1, annotations: [], paginas: 1 };
  let teller = 0;
  const omgeving = {
    doc,
    pxPerMmAt: () => K,
    imperiaalOp: () => imperiaal,
    async maak(type, page, props) { const a = { id: `oud-${++teller}`, type, page, ...props }; doc.annotations.push(a); return { ok: true, id: a.id }; },
    async werkBij(id, props) { Object.assign(doc.annotations.find((a) => a.id === id), props); return { ok: true }; },
    async transactie(fn) { await fn(); },
  };
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 300 }, end: { x: 2000, y: 300 }, thicknessMm: 100,
    openings: imperiaal
      ? [{ kind: 'door', alongMm: 1000, openSide: 'right' }, { kind: 'window', alongMm: 3000 }]
      : [{ kind: 'door', widthMm: 900, alongMm: 1000, openSide: 'right' }, { kind: 'window', widthMm: 1200, alongMm: 3000 }],
  }, omgeving);
  assert.equal(r.ok, true);
  return doc.annotations;
}

/** De annotaties opslaan zoals de saver hun sleutels schrijft, en weer openen. */
async function opslaanEnHeropenen(annotaties) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([2200, 800]);
  const context = doc.context;
  const refs = [];
  let kozijnNr = 0;
  for (const ann of annotaties) {
    let dict;
    if (ann.type === 'wall') {
      dict = context.obj({
        Type: 'Annot', Subtype: 'Line', Rect: WAND_RECT, L: [ann.startX, 500, ann.endX, 500],
        OPS_Subtype: PDFString.of('wall'), OPS_DikteMm: ann.dikteMm,
      });
      schrijfPlattegrondMeta(dict, ann, context, (x) => x, (y) => y);
    } else {
      const dx = kozijnNr++ * 5;
      dict = context.obj({
        Type: 'Annot', Subtype: 'Square', Rect: KOZIJN_RECT.map((v, i) => (i % 2 === 0 ? v + dx : v)),
        OPS_Subtype: PDFString.of('parametricSymbol'),
        OPS_SymbolId: pdfTextString(ann.symbolId),
        OPS_Params: pdfTextString(JSON.stringify(ann.params)),
      });
    }
    refs.push(context.register(dict));
  }
  pagina.node.set(PDFName.of('Annots'), context.obj(refs));
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(await doc.save()));
  // Het model zoals de lader het oplevert: nieuwe id's, de velden uit de sleutels.
  let nr = 0;
  const geladen = [];
  kozijnNr = 0;
  for (const ann of annotaties) {
    if (ann.type === 'wall') {
      const extra = kaart.get(WAND_RECT.join(','));
      assert.equal(extra.opsSubtype, 'wall');
      geladen.push({
        id: `nieuw-${++nr}`, type: 'wall', page: 1, startX: ann.startX, startY: ann.startY, endX: ann.endX, endY: ann.endY,
        dikteMm: extra.opsDikteMm, hatchPattern: ann.hatchPattern, ...wandOpeningenUitExtra(extra),
      });
    } else {
      const dx = kozijnNr++ * 5;
      const extra = kaart.get(KOZIJN_RECT.map((v, i) => (i % 2 === 0 ? v + dx : v)).join(','));
      geladen.push({
        id: `nieuw-${++nr}`, type: 'parametricSymbol', page: 1, symbolId: extra.opsSymbolId,
        x: ann.x, y: ann.y, width: ann.width, height: ann.height, rotation: ann.rotation,
        params: JSON.parse(extra.opsParams),
      });
    }
  }
  herkoppelOpeningen(geladen);
  return geladen;
}

test('de lijst van de wand gaat zonder annotatie-id naar het bestand', async () => {
  const [wand] = await tekening();
  const bestand = openingenVoorBestand(wand);
  assert.deepEqual(bestand.map((o) => Object.keys(o)), [
    ['key', 'afstandMm', 'breedteMm', 'soort', 'zijde'], ['key', 'afstandMm', 'breedteMm', 'soort', 'zijde'],
  ]);
  assert.deepEqual(bestand.map((o) => [o.afstandMm, o.breedteMm, o.soort, o.zijde]), [[1000, 900, 'deur', -1], [3000, 1200, 'raam', 1]]);
  // Een wand zonder openingen krijgt geen sleutel: oudere bestanden en andere lezers merken niets.
  const doc = await PDFDocument.create();
  const kaal = doc.context.obj({ Type: 'Annot', Subtype: 'Line' });
  assert.equal(schrijfPlattegrondMeta(kaal, { type: 'wall' }, doc.context, (x) => x, (y) => y), 0);
  assert.equal(kaal.get(PDFName.of('OPS_Openings')), undefined);
  assert.equal(schrijfPlattegrondMeta(kaal, { type: 'wall', openingen: [] }, doc.context, (x) => x, (y) => y), 0);
});

test('onleesbare of onvolledige gegevens geven een dichte wand, geen fout', () => {
  assert.deepEqual(leesOpeningen('geen json'), []);
  assert.deepEqual(leesOpeningen('{"a":1}'), []);
  assert.deepEqual(leesOpeningen(''), []);
  assert.deepEqual(leesOpeningen(JSON.stringify([{ afstandMm: 5, breedteMm: 900 }, { key: 'k', afstandMm: 'x', breedteMm: 900 }, { key: 'k', afstandMm: 5, breedteMm: 0 }])), []);
  assert.deepEqual(leesOpeningen(JSON.stringify([{ key: 'k', afstandMm: 5, breedteMm: 900, soort: 'onzin', zijde: 7 }])),
    [{ key: 'k', afstandMm: 5, breedteMm: 900, soort: 'deur', zijde: 1 }]);
  assert.deepEqual(wandOpeningenUitExtra({}), {});
  assert.deepEqual(wandOpeningenUitExtra(null), {});
});

test('na opslaan en heropenen horen wand en kozijnen weer bij elkaar', async () => {
  const origineel = await tekening();
  const geladen = await opslaanEnHeropenen(origineel);
  const [wand, deur, raam] = geladen;
  assert.equal(geladen.length, 3);
  assert.notEqual(wand.id, origineel[0].id, 'de lader geeft nieuwe id s');
  // De wand kent haar openingen, nu met de nieuwe id s van de kozijnen.
  assert.deepEqual(wand.openingen.map((o) => [o.id, o.afstandMm, o.breedteMm, o.soort, o.zijde]), [
    [deur.id, 1000, 900, 'deur', -1], [raam.id, 3000, 1200, 'raam', 1],
  ]);
  assert.equal(deur.params.hostWallId, wand.id);
  assert.equal(raam.params.hostWallId, wand.id);
  const perId = new Map(geladen.map((a) => [a.id, a]));
  assert.equal(gehosteWand(deur, perId), wand);
  assert.equal(gehosteWand(raam, perId), wand);

  // De gaten staan er nog: de band is open op dezelfde plaatsen.
  const open = openingIntervallen(2000, wand.openingen, K);
  assert.deepEqual(open.map((i) => [i.t0, i.t1]), [[275, 725], [1200, 1800]]);
  const vorm = wandVorm(wand, [wand], () => 25, open);
  assert.equal(vorm.stukken.length, 3, 'drie solide stukken tussen en naast de openingen');

  // En slepen schuift de deur nog steeds langs de wand; het gat gaat mee.
  const oud = kloon(deur);
  deur.x += 200; deur.y += 150;                    // 400 mm langs de wand en een stuk ernaast
  const extra = hostingNaCommando({ type: 'modifyAnnotation', id: deur.id, oldState: oud, newState: kloon(deur) }, geladen, () => K);
  assert.equal(wand.openingen[0].afstandMm, 1400);
  assert.equal(Math.round(hartVanSymbool(deur, K, 100).y), 300, 'de deur blijft op de wandlijn');
  assert.deepEqual(extra.map((c) => [c.type, c.id]), [['modifyAnnotation', wand.id]]);
  assert.deepEqual(openingIntervallen(2000, wand.openingen, K).map((i) => [i.t0, i.t1]), [[475, 925], [1200, 1800]]);
});

test('het Amerikaanse plansymbool (#1230) komt na opslaan en heropenen terug, wat het blad dan ook is', async () => {
  const origineel = await tekening(true);
  const geladen = await opslaanEnHeropenen(origineel);
  const [wand, deur, raam] = geladen;
  // De stijl en de maten staan in het symbool zelf, niet in een voorkeur.
  assert.deepEqual([deur.params.symboolStijl, raam.params.symboolStijl], ['us', 'us']);
  assert.deepEqual([deur.params.width, raam.params.width, deur.params.deurbladDikteMm], [914.4, 1219.2, 44.45]);
  assert.deepEqual(wand.openingen.map((o) => [o.id, o.breedteMm]), [[deur.id, 914.4], [raam.id, 1219.2]]);
  // Het symbool tekent hetzelfde als voor het opslaan.
  for (const [nu, toen] of [[deur, origineel[1]], [raam, origineel[2]]]) {
    const vak = (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height });
    const soort = nu.symbolId === 'window' ? 'raam' : 'deur';
    assert.deepEqual(kozijnTekenopdrachten(soort, nu.params, vak(nu)), kozijnTekenopdrachten(soort, toen.params, vak(toen)));
  }
  assert.deepEqual(kozijnTekenopdrachten('deur', deur.params, { x: 0, y: 0, width: deur.width, height: deur.height }).map((c) => c.kind),
    ['polyline', 'arc'], 'blad en draaicirkel, geen kozijnhout');
  // En de hosting werkt: de deur schuift langs de wand, het gat gaat mee.
  const oud = kloon(deur);
  deur.x += 100; deur.y -= 60;
  hostingNaCommando({ type: 'modifyAnnotation', id: deur.id, oldState: oud, newState: kloon(deur) }, geladen, () => K);
  assert.equal(wand.openingen[0].afstandMm, 1200);
  assert.equal(deur.params.symboolStijl, 'us');
});

test('een tweede keer opslaan en heropenen verandert niets meer', async () => {
  const eerste = await opslaanEnHeropenen(await tekening());
  const tweede = await opslaanEnHeropenen(eerste);
  const zonderId = (lijst) => lijst.map((a) => ({
    ...a, id: null,
    ...(a.openingen ? { openingen: a.openingen.map((o) => ({ ...o, id: null })) } : {}),
    ...(a.params ? { params: { ...a.params, hostWallId: null } } : {}),
  }));
  assert.deepEqual(zonderId(tweede), zonderId(eerste));
});

test('een bestand met een opgeknipte wand (zonder de sleutel) opent zoals voorheen', async () => {
  const doc = { currentPage: 1, annotations: [], paginas: 1 };
  let teller = 0;
  await plattegrondOpdracht({
    action: 'wall', hosted: false, start: { x: 0, y: 300 }, end: { x: 2000, y: 300 }, thicknessMm: 100,
    openings: [{ kind: 'door', widthMm: 900, alongMm: 1000 }],
  }, {
    doc, pxPerMmAt: () => K,
    async maak(type, page, props) { const a = { id: `oud-${++teller}`, type, page, ...props }; doc.annotations.push(a); return { ok: true, id: a.id }; },
    async werkBij() { return { ok: true }; },
    async transactie(fn) { await fn(); },
  });
  assert.equal(doc.annotations.filter((a) => a.type === 'wall').length, 2);
  const voor = kloon(doc.annotations);
  assert.equal(herkoppelOpeningen(doc.annotations), 0);
  assert.deepEqual(doc.annotations, voor, 'geen migratie: stukken en los kozijn blijven precies zo');
  for (const wand of doc.annotations.filter((a) => a.type === 'wall')) {
    assert.deepEqual(openingenVoorBestand(wand), []);
    assert.deepEqual(wandOpeningenUitExtra({ opsSubtype: 'wall', opsDikteMm: 100 }), {});
  }
});

test('de saver, de converter en de lader gebruiken deze regels', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const saver = lees('../saver.js');
  const wandTak = saver.slice(saver.indexOf("case 'wall': {"), saver.indexOf("case 'parametricSymbol': {", saver.indexOf("case 'wall': {")));
  assert.match(wandTak, /schrijfPlattegrondMeta\(annotDict, ann, context, convertX, convertY\)/, 'saver schrijft OPS_Openings in de wandtak');
  assert.match(wandTak, /bandPieces: wallShape\.stukken/, 'de appearance van de wand stopt bij de dagkanten');

  const converter = lees('../loader/annotation-converter.js');
  const wandLaad = converter.slice(converter.indexOf("extraColors.opsSubtype === 'wall'"), converter.indexOf('isMeasureDist'));
  assert.match(wandLaad, /\.\.\.wandOpeningenUitExtra\(extraColors\)/, 'converter zet de openingen op de wand');

  const omzetten = lees('../loader/annotaties-omzetten.js');
  assert.ok(omzetten.indexOf('herkoppelOpeningen(nieuw)') > 0, 'de pagina koppelt wand en kozijn na het omzetten');
  assert.ok(omzetten.indexOf('herkoppelOpeningen(nieuw)') < omzetten.indexOf('maakBron(model'),
    'vóór de vingerafdruk van het model, zodat een ongewijzigde wand ongewijzigd blijft');
});
