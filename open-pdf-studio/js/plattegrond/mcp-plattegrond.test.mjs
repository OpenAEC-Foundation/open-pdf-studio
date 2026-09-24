import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLOORPLAN_ACTIES, plattegrondOpdracht, draaizijde, kozijnProps, ruimtenAchterBouwdelen,
} from './mcp-plattegrond.js';
import { sparingPlaatsing } from './sparing.js';

const K = 0.5;                                    // paginapunten per mm
const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** App-kant als stub: onthoudt wat er gemaakt en gewijzigd is. */
function omgevingMet(annotaties = [], pxPerMm = K) {
  const doc = { currentPage: 1, annotations: annotaties, paginas: 1 };
  let teller = 0;
  const log = [];
  return {
    doc,
    log,
    pxPerMmAt: () => pxPerMm,
    async maak(type, page, props) {
      const ann = { id: `a${++teller}`, type, page, ...props };
      doc.annotations.push(ann);
      log.push({ soort: 'maak', type, id: ann.id });
      return { ok: true, id: ann.id };
    },
    async werkBij(id, props) {
      const a = doc.annotations.find((x) => x.id === id);
      if (!a) return { ok: false };
      Object.assign(a, props);
      log.push({ soort: 'werkBij', id, props });
      return { ok: true };
    },
    async verwijder(id) {
      const i = doc.annotations.findIndex((x) => x.id === id);
      if (i < 0) return { ok: false };
      doc.annotations.splice(i, 1);
      log.push({ soort: 'verwijder', id });
      return { ok: true };
    },
    async herorden(ids) {
      const perId = new Map(doc.annotations.map((a) => [a.id, a]));
      doc.annotations.splice(0, doc.annotations.length, ...ids.map((id) => perId.get(id)));
      log.push({ soort: 'herorden', ids });
      return { ok: true };
    },
    async transactie(fn) { log.push({ soort: 'transactie' }); await fn(); },
  };
}

const gevel = {
  action: 'wall',
  start: { x: 0, y: 100 }, end: { x: 5000, y: 100 },       // 10 000 mm op K
  thicknessMm: 300,
  openings: [
    { kind: 'door', widthMm: 900, alongMm: 2000, openSide: 'left' },
    { kind: 'window', widthMm: 1200, alongMm: 6000, sillMm: 850, heightMm: 1500 },
  ],
};

test('de actie moet bekend zijn en er moet een document zijn', async () => {
  assert.deepEqual(FLOORPLAN_ACTIES, ['inspect', 'wall', 'rooms', 'dimensions']);
  const o = omgevingMet();
  assert.match((await plattegrondOpdracht({ action: 'onzin' }, o)).error, /action must be one of/);
  assert.match((await plattegrondOpdracht({ action: 'inspect' }, { doc: null })).error, /no active document/);
  assert.match((await plattegrondOpdracht({ action: 'inspect', page: 9 }, o)).error, /out of range/);
  assert.match((await plattegrondOpdracht({ action: 'inspect', page: 0 }, o)).error, /invalid page/);
});

test('zonder schaal wordt er niets getekend', async () => {
  const o = omgevingMet([], 0);
  const r = await plattegrondOpdracht(gevel, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /measurement scale/);
  assert.equal(o.doc.annotations.length, 0);
});

test('een gevel met een deur en een raam: drie wandstukken, twee kozijnen', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht(gevel, o);
  assert.equal(r.ok, true);
  assert.equal(r.lengthMm, 10000);
  assert.equal(r.wallIds.length, 3, 'de wand is opgeknipt bij elke sparing');
  assert.equal(r.openingIds.length, 2);
  assert.deepEqual(r.segments, [
    { fromMm: 0, lengthMm: 1550 },
    { fromMm: 2450, lengthMm: 2950 },
    { fromMm: 6600, lengthMm: 3400 },
  ]);

  const wanden = o.doc.annotations.filter((a) => a.type === 'wall');
  assert.equal(wanden.length, 3);
  assert.deepEqual(wanden.map((w) => [w.startX, w.endX]), [[0, 775], [1225, 2700], [3300, 5000]]);
  for (const w of wanden) {
    assert.equal(w.dikteMm, 300);
    assert.equal(w.hatchPattern, 'nen47-metselwerk-baksteen');
    assert.equal(w.startY, 100);
  }
  // Alles in één undo-stap.
  assert.equal(o.log.filter((e) => e.soort === 'transactie').length, 1);
});

test('het raamkozijn vult de dag over de volle wanddikte', async () => {
  const o = omgevingMet();
  await plattegrondOpdracht(gevel, o);
  const raam = o.doc.annotations.find((a) => a.symbolId === 'window');
  assert.equal(raam.width, 600, 'dagmaat 1200 mm');
  assert.equal(raam.height, 150, 'wanddikte 300 mm');
  assert.equal(raam.x, 2700);
  assert.equal(raam.y, 25, 'het vak staat midden op de hartlijn');
  assert.equal(raam.rotation, 0);
  assert.equal(raam.params.wallThickness, 300);
  assert.equal(raam.params.hostAfstandMm, 6000);
  assert.equal(raam.params.borstweringMm, 850);
  assert.equal(raam.params.hoogteMm, 1500);
});

test('de deur draait naar de kant die je aanwijst', () => {
  const wand = { id: 'w', startX: 0, startY: 100, endX: 5000, endY: 100, dikteMm: 300 };
  // n = (-u.y, u.x) = (0, 1): een punt met een grotere y ligt op de +n-kant.
  assert.equal(draaizijde(wand, { openTo: { x: 1000, y: 900 } }), -1);
  assert.equal(draaizijde(wand, { openTo: { x: 1000, y: -900 } }), 1);
  assert.equal(draaizijde(wand, { openSide: 'right' }), -1);
  assert.equal(draaizijde(wand, {}), 1, 'standaard naar links van de wandrichting');
  assert.equal(draaizijde(wand, { openTo: { x: 1000, y: 100 } }), 1, 'op de hartlijn: standaard');

  const plaatsing = sparingPlaatsing(wand, { id: 's', soort: 'deur', dagmaatMm: 900, hartMm: 2000 }, K);
  const naarLinks = kozijnProps(wand, plaatsing, { draaizijde: 1 }, K);
  assert.equal(naarLinks.width, 450);
  // Het vak is de wand plus de draaicirkel: kozijn 114 diep midden in de
  // wand van 300 (93 .. 207), het blad (dag 766 + 2 x 15 in de sponning =
  // 796) draait vanuit het binnenvlak van het kozijn de ruimte in.
  assert.equal(naarLinks.height, (93 + 114 + 796) * K, 'wand plus draaicirkel, anders valt de boog weg');
  assert.equal(naarLinks.rotation, 0);
  // Het buitenvlak (onderkant van het vak) op het wandvlak op de +n-kant;
  // de deur draait naar de -n-kant.
  assert.equal(naarLinks.y + naarLinks.height, 175);
  assert.equal(naarLinks.x, 775);
  assert.equal(naarLinks.params.wallThickness, 300);
  assert.equal(naarLinks.params.draaiNaar, 'binnen', 'binnen = de kant waar de deur heen draait');
  assert.equal(naarLinks.params.stijlBreedteMm, 67);
  assert.equal(naarLinks.params.stijlDiepteMm, 114);

  const naarRechts = kozijnProps(wand, plaatsing, { draaizijde: -1 }, K);
  assert.equal(naarRechts.rotation, 180);
  assert.equal(naarRechts.y, 25, 'gedraaid ligt de scharnierlijn op het andere vlak');
  assert.equal(naarRechts.params.swing, 'left');
  assert.equal(naarRechts.params.showWall, false);
});

test('een sparing die er niet in past levert een nette weigering, geen halve gevel', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    ...gevel,
    openings: [{ kind: 'door', widthMm: 900, alongMm: 9800 }],
  }, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /opening 0 \(door\).*outside the wall/);
  assert.equal(o.doc.annotations.length, 0, 'er is niets getekend');
});

test('twee sparingen die elkaar overlappen worden geweigerd', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    ...gevel,
    openings: [
      { kind: 'window', widthMm: 1000, alongMm: 2000 },
      { kind: 'window', widthMm: 1000, alongMm: 2400 },
    ],
  }, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /opening 1 \(window\).*overlaps/);
});

/** Vier gevels van 10 x 8 m (hartlijnen) met 300 mm wanden. */
async function woning() {
  const o = omgevingMet();
  const hoeken = [
    [{ x: 0, y: 0 }, { x: 5000, y: 0 }],
    [{ x: 5000, y: 0 }, { x: 5000, y: 4000 }],
    [{ x: 5000, y: 4000 }, { x: 0, y: 4000 }],
    [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
  ];
  const ids = [];
  for (const [start, end] of hoeken) {
    const r = await plattegrondOpdracht({ action: 'wall', start, end, thicknessMm: 300 }, o);
    ids.push(...r.wallIds);
  }
  return { o, ids };
}

test('de ruimte herkent zichzelf uit de wanden eromheen', async () => {
  const { o } = await woning();
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.rooms.length, 1);
  // Hartlijn 10 000 x 8000 mm, wanden 300 → netto 9700 x 7700 = 74,69 m².
  assert.equal(r.rooms[0].areaM2, 74.69);
  assert.equal(r.rooms[0].perimeterM, 34.8);
  assert.deepEqual(r.rooms[0].labelPoint, { x: 2500, y: 2000 });
  assert.deepEqual(r.openEnds, []);
  assert.equal(o.doc.annotations.filter((a) => a.type === 'measureArea').length, 0, 'zonder place tekent hij niets');
});

test('place zet de ruimte op het blad, refresh laat hem de wand volgen', async () => {
  const { o } = await woning();
  const geplaatst = await plattegrondOpdracht({
    action: 'rooms', place: true, seeds: [{ x: 2500, y: 2000, name: 'Woonkamer' }],
  }, o);
  assert.equal(geplaatst.ok, true);
  assert.equal(geplaatst.placed.length, 1);
  assert.equal(geplaatst.placed[0].label, 'Woonkamer\n74.69 m²'.replace('74.69', '74.7'));

  const vlak = o.doc.annotations.find((a) => a.type === 'measureArea');
  assert.ok(vlak, 'er staat een meetvlak');
  assert.deepEqual(vlak.opsRuimteZaad, { x: 2500, y: 2000 });
  assert.equal(vlak.opsRuimteNaam, 'Woonkamer');
  assert.deepEqual(vlak.points.map((p) => [p.x, p.y]),
    [[75, 75], [4925, 75], [4925, 3925], [75, 3925]]);
  // Naam en oppervlakte zitten in EEN ruimtetag, niet in een los tekstvak.
  assert.equal(o.doc.annotations.filter((a) => a.type === 'textbox').length, 0);
  const tag = o.doc.annotations.find((a) => a.symbolId === 'room-tag');
  assert.ok(tag, 'er staat een ruimtetag');
  assert.equal(geplaatst.placed[0].tagId, tag.id);
  assert.equal(tag.params.naam, 'Woonkamer');
  assert.equal(tag.params.oppervlakteM2, 74.69);
  assert.deepEqual([tag.params.zaadX, tag.params.zaadY], [2500, 2000]);
  assert.equal(tag.x + tag.width / 2, 2500, 'de tag staat in het hart van de ruimte');
  assert.equal(tag.y + tag.height / 2, 2000);

  // Oostgevel een meter naar buiten: de ruimte wordt groter en het meetvlak
  // volgt, zonder dat de gebruiker hem opnieuw hoeft aan te wijzen.
  for (const w of o.doc.annotations) {
    if (w.type !== 'wall') continue;
    if (w.startX === 5000) w.startX = 5500;
    if (w.endX === 5000) w.endX = 5500;
  }
  const na = await plattegrondOpdracht({ action: 'rooms', refresh: true }, o);
  assert.equal(na.ok, true);
  assert.equal(na.refreshed.length, 2, 'het vlak en zijn tag');
  assert.equal(na.detached.length, 0);
  // Netto 10 700 x 7700 = 82,39 m².
  assert.equal(na.refreshed[0].areaM2, 82.39);
  assert.equal(vlak.points[1].x, 5425, 'de contour is meegeschoven');
  assert.equal(tag.params.oppervlakteM2, 82.39, 'de tag draagt de nieuwe oppervlakte');
  assert.equal(tag.params.naam, 'Woonkamer');
  assert.equal(tag.x + tag.width / 2, 2750, 'de tag schuift mee naar het nieuwe hart');
});

test('een ruimte ligt ingetogen achter de wanden en kozijnen', async () => {
  const o = omgevingMet();
  await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, thicknessMm: 300,
    openings: [{ kind: 'door', widthMm: 900, alongMm: 2000, openTo: { x: 1000, y: 2000 } }],
  }, o);
  for (const [start, end] of [
    [{ x: 5000, y: 0 }, { x: 5000, y: 4000 }],
    [{ x: 5000, y: 4000 }, { x: 0, y: 4000 }],
    [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
  ]) await plattegrondOpdracht({ action: 'wall', start, end, thicknessMm: 300 }, o);
  const r = await plattegrondOpdracht({
    action: 'rooms', place: true, seeds: [{ x: 2500, y: 2000, name: 'Woonkamer', number: '0.01' }],
  }, o);
  assert.equal(r.placed[0].number, '0.01');

  const vlak = o.doc.annotations.find((a) => a.type === 'measureArea');
  assert.equal(vlak.hatchPattern, 'none', 'geen arcering');
  assert.equal(vlak.fillColor, 'none', 'geen vulling');
  assert.equal(vlak.strokeColor, '#808080', 'grijze rand');
  assert.ok(vlak.lineWidth <= 0.5, 'dunne rand');
  assert.equal(vlak.measureShowLabel, false, 'de oppervlakte staat in de tag, niet nog eens in het vlak');
  assert.equal(vlak.measureName, 'Woonkamer', 'de naam telt mee in de hoeveelheden');
  assert.equal(o.doc.annotations.find((a) => a.symbolId === 'room-tag').params.nummer, '0.01');

  // Tekenvolgorde: het vlak ligt achter de eerste wand; de deur, de wanden en
  // de tag erboven.
  const volgorde = o.doc.annotations.map((a) => a.type === 'parametricSymbol' ? a.symbolId : a.type);
  const plekVlak = volgorde.indexOf('measureArea');
  assert.equal(plekVlak, 0, `vlak onderaan: ${volgorde.join(', ')}`);
  assert.ok(volgorde.indexOf('door') > plekVlak);
  assert.ok(volgorde.indexOf('room-tag') > plekVlak);
  assert.equal(o.log.filter((e) => e.soort === 'herorden').length, 1);
  assert.equal(o.log.filter((e) => e.soort === 'transactie').length, 5, 'vier wanden + de ruimten: elk een undo-stap');
});

test('een opzij geschoven tag houdt zijn plek ten opzichte van de ruimte', async () => {
  const { o } = await woning();
  await plattegrondOpdracht({ action: 'rooms', place: true, seeds: [{ x: 2500, y: 2000, name: 'Hal' }] }, o);
  const tag = o.doc.annotations.find((a) => a.symbolId === 'room-tag');
  tag.x += 300; tag.y -= 100;                        // de gebruiker schuift hem opzij
  const cx = tag.x + tag.width / 2, cy = tag.y + tag.height / 2;
  // De hele woning 1000 pt naar rechts.
  for (const w of o.doc.annotations) {
    if (w.type !== 'wall') continue;
    w.startX += 1000; w.endX += 1000;
  }
  await plattegrondOpdracht({ action: 'rooms', refresh: true }, o);
  // Het zaadpunt ligt nog in de ruimte (x 2500 valt binnen 1075..5925).
  assert.equal(tag.x + tag.width / 2, cx + 1000, 'mee met de ruimte, met zijn eigen verschuiving');
  assert.equal(tag.y + tag.height / 2, cy);
});

test('zonder seeds komt een ruimte in een gelaagde gevel maar een keer terug', async () => {
  // Buitenblad en binnenblad als losse gesloten lussen: elke lus is een vlak,
  // maar het zaadpunt van beide valt in dezelfde (kleinste) ruimte.
  const o = omgevingMet();
  const lus = (a, b, dikte) => [
    [{ x: a, y: a }, { x: b, y: a }], [{ x: b, y: a }, { x: b, y: b - 1000 }],
    [{ x: b, y: b - 1000 }, { x: a, y: b - 1000 }], [{ x: a, y: b - 1000 }, { x: a, y: a }],
  ].map(([start, end]) => ({ action: 'wall', start, end, thicknessMm: dikte }));
  for (const w of [...lus(0, 5000, 100), ...lus(150, 4850, 100)]) await plattegrondOpdracht(w, o);
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.rooms.length, 1, `een ruimte, niet ${r.rooms.length} keer dezelfde`);
  const geplaatst = await plattegrondOpdracht({ action: 'rooms', place: true }, o);
  assert.equal(geplaatst.placed.length, 1);
  assert.equal(o.doc.annotations.filter((a) => a.symbolId === 'room-tag').length, 1);
});

test('ruimtenAchterBouwdelen laat een onderlegger onderin', () => {
  const lijst = [
    { id: 'onder', type: 'image', page: 1 },
    { id: 'w', type: 'wall', page: 1 },
    { id: 'd', type: 'parametricSymbol', symbolId: 'door', page: 1 },
    { id: 'v', type: 'measureArea', page: 1 },
    { id: 't', type: 'parametricSymbol', symbolId: 'room-tag', page: 1 },
  ];
  assert.deepEqual(ruimtenAchterBouwdelen(lijst, ['v'], 1), ['onder', 'v', 'w', 'd', 't']);
  assert.equal(ruimtenAchterBouwdelen(lijst, ['v'], 2), null, 'geen wand op die pagina: niets te doen');
  assert.equal(ruimtenAchterBouwdelen([lijst[3], lijst[1]], ['v'], 1), null, 'al achter de wanden');
  assert.equal(ruimtenAchterBouwdelen(lijst, [], 1), null);
});

test('een gat in de contour wordt gemeld in plaats van half gevuld', async () => {
  const { o } = await woning();
  const eenWandWeg = o.doc.annotations.filter((a) => a.type === 'wall').pop();
  o.doc.annotations = o.doc.annotations.filter((a) => a !== eenWandWeg);
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.rooms.length, 0);
  assert.equal(r.openEnds.length, 2);
});

test('een deuropening breekt de ruimte niet open', async () => {
  const o = omgevingMet();
  const noord = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, thicknessMm: 300,
    openings: [{ kind: 'door', widthMm: 900, alongMm: 2000 }],
  }, o);
  assert.equal(noord.wallIds.length, 2);
  for (const [start, end] of [
    [{ x: 5000, y: 0 }, { x: 5000, y: 4000 }],
    [{ x: 5000, y: 4000 }, { x: 0, y: 4000 }],
    [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
  ]) await plattegrondOpdracht({ action: 'wall', start, end, thicknessMm: 300 }, o);

  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.rooms.length, 1, 'de deur is geen onderbreking van de omsluiting');
  assert.equal(r.rooms[0].areaM2, 74.69);
  assert.deepEqual(r.openEnds, []);
});

test('een vliesgevel in de wand sluit de ruimte af, ook over een breed gat (#475)', async () => {
  const { gevelelementOpdracht } = await import('../gevelelement/mcp-gevelelement.js');
  const { o } = await woning();
  const noord = o.doc.annotations.find((a) => a.type === 'wall' && a.startY === 0 && a.endY === 0);
  o.verwijder = async (id) => {
    o.doc.annotations = o.doc.annotations.filter((a) => a.id !== id);
    return { ok: true };
  };
  // 6 m glas: breder dan de 3 m die als sparing overbrugd wordt.
  const vg = await gevelelementOpdracht({
    action: 'create', preset: 'curtainWall', wallId: noord.id, fromMm: 2000, lengthMm: 6000, fields: 5,
  }, o);
  assert.equal(vg.ok, true, vg.error);
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.rooms.length, 1, 'de vliesgevel telt als omsluiting');
  assert.equal(r.rooms[0].areaM2, 74.69, 'met de dikte van de wand waarin hij staat');
  assert.deepEqual(r.openEnds, []);
  const zonder = await plattegrondOpdracht({ action: 'rooms' }, {
    ...o, doc: { ...o.doc, annotations: o.doc.annotations.filter((a) => a.id !== vg.id) },
  });
  assert.equal(zonder.rooms.length, 0, 'zonder het element is het gat te breed');
  const inspect = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.deepEqual(inspect.facadeElements, [{ id: vg.id, preset: 'curtainWall', lengthMm: 6000, fields: 5, hostWallId: noord.id }]);
  assert.ok(!inspect.walls.some((w) => w.id === vg.id), 'een gevelelement is geen wand in het overzicht');
});

test('de maatketting hangt aan de wandstukken en volgt ze', async () => {
  const o = omgevingMet();
  const gevelR = await plattegrondOpdracht(gevel, o);
  const r = await plattegrondOpdracht({
    action: 'dimensions', wallIds: gevelR.wallIds, offsetMm: 500, side: 'right',
  }, o);
  assert.equal(r.ok, true);
  // 3 penanten + 2 dagmaten + 1 totaal.
  assert.deepEqual(r.dimensions.map((d) => d.lengthMm), [1550, 900, 2950, 1200, 3400, 10000]);
  assert.deepEqual(r.dimensions.map((d) => d.role),
    ['chain', 'chain', 'chain', 'chain', 'chain', 'total']);

  const maten = o.doc.annotations.filter((a) => a.type === 'measureDistance');
  assert.equal(maten.length, 6);
  // Het wandvlak aan de maatzijde ligt op y 100 + 75 = 175 (300 mm wand).
  assert.equal(maten[0].startY, 425, 'de ketting ligt 500 mm naast het wandvlak');
  assert.equal(maten[5].startY, 600, 'de totaalmaat een tekstregel verder (850 mm)');
  assert.equal(maten[0].leaderStartY, 175, 'de hulplijn begint op het wandvlak');
  const w = gevelR.wallIds;
  assert.deepEqual(maten[0].opsAnkerStart, { annotationId: w[0], punt: 'start', vlak: 1, hoek: true });
  assert.deepEqual(maten[1].opsAnkerStart, { annotationId: w[0], punt: 'end', vlak: 1 });
  assert.deepEqual(maten[1].opsAnkerEind, { annotationId: w[1], punt: 'start', vlak: 1 });
  assert.deepEqual(maten[5].opsAnkerEind, { annotationId: w[2], punt: 'end', vlak: 1, hoek: true });
  // Uitloop alleen aan begin en eind van de ketting; de totaalmaat aan beide kanten.
  assert.deepEqual(maten.map((m) => m.dimOvershootEnds), ['start', 'none', 'none', 'none', 'end', 'both']);
  assert.equal(maten[0].dimLineOvershootMm, 2, '2 mm uitloop op papier');
  assert.equal(maten[0].dimExtGapMm, 1.5, 'hulplijn vrij van het wandvlak');
  // Een id voor de hele ketting.
  assert.ok(r.chainId);
  assert.ok(maten.every((m) => m.opsKettingId === r.chainId));

  // De hele gevel 200 pt omlaag: elke maat schuift mee.
  for (const w of o.doc.annotations) {
    if (w.type === 'wall') { w.startY += 200; w.endY += 200; }
  }
  const na = await plattegrondOpdracht({ action: 'dimensions', refresh: true }, o);
  assert.equal(na.updated.length, 6);
  assert.equal(na.detached.length, 0);
  assert.equal(na.unchanged, 0);
  assert.equal(maten[0].startY, 625);
  assert.equal(maten[5].startY, 800);
  assert.equal(maten[0].leaderStartY, 375);
  assert.deepEqual(na.updated.map((d) => d.lengthMm), [1550, 900, 2950, 1200, 3400, 10000]);

  // Nog een keer verversen verandert niets meer.
  const nogmaals = await plattegrondOpdracht({ action: 'dimensions', refresh: true }, o);
  assert.equal(nogmaals.updated.length, 0);
  assert.equal(nogmaals.unchanged, 6);
});

test('plattegrondmaten zijn zwart, dun en zonder eenheid, en meten buitenwerks', async () => {
  const { o, ids } = await woning();
  // Noordgevel: loopt naar het oosten, n = (0, 1) wijst naar binnen; buiten = links.
  const noord = ids[0];
  const r = await plattegrondOpdracht({ action: 'dimensions', wallIds: [noord], side: 'left' }, o);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dimensions.map((d) => d.lengthMm), [10300], 'buitenmaat: hartlijn 10 000 + 2 x 150');
  const m = o.doc.annotations.find((a) => a.type === 'measureDistance');
  assert.equal(m.dimShowUnit, false, 'alleen het getal');
  assert.equal(m.strokeColor, '#000000');
  assert.equal(m.color, '#000000');
  assert.ok(m.lineWidth < 0.5, 'dunne lijn');
  assert.deepEqual([m.leaderStartX, m.leaderStartY, m.leaderEndX, m.leaderEndY], [-75, -75, 5075, -75],
    'hulplijnen vanaf de buitenhoeken');
  assert.equal(m.startY, -75 - 250, '500 mm uit het buitenvlak');

  // Met showUnit:true houdt de maat zijn eenheid.
  const { o: o2, ids: ids2 } = await woning();
  await plattegrondOpdracht({ action: 'dimensions', wallIds: [ids2[0]], side: 'left', showUnit: true }, o2);
  assert.equal(o2.doc.annotations.find((a) => a.type === 'measureDistance').dimShowUnit, true);
});

test('op een kleine schaal liggen ketting en totaal verder uit elkaar', async () => {
  const k100 = 72 / 25.4 / 100;
  const o = omgevingMet([], k100);
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 100 }, end: { x: 10000 * k100, y: 100 }, thicknessMm: 300,
    openings: [{ kind: 'window', widthMm: 1200, alongMm: 5000 }],
  }, o);
  await plattegrondOpdracht({ action: 'dimensions', wallIds: r.wallIds, side: 'right' }, o);
  const maten = o.doc.annotations.filter((a) => a.type === 'measureDistance');
  const ketting = maten.find((a) => a.opsMaatRol === 'chain');
  const totaal = maten.find((a) => a.opsMaatRol === 'total');
  // 1:100: 350 mm is maar 10 pt papier - te krap voor een regel tekst.
  assert.ok(totaal.startY - ketting.startY >= 18, `${totaal.startY - ketting.startY} pt tussen ketting en totaal`);
  assert.ok(totaal.opsMaatOffsetMm - ketting.opsMaatOffsetMm > 350);
});

test('een ketting verlengen: een punt ertussen, erbuiten en weer eraf', async () => {
  const o = omgevingMet();
  const gevelR = await plattegrondOpdracht(gevel, o);
  const r = await plattegrondOpdracht({ action: 'dimensions', wallIds: gevelR.wallIds, side: 'right' }, o);
  const eerste = r.dimensions[0].id;
  const kettingLengtes = (v) => v.dimensions.filter((d) => d.role === 'chain').map((d) => d.lengthMm);

  // Een punt op het wandvlak (y 175) midden in het tweede penant: dat segment splitst.
  const erbij = await plattegrondOpdracht({ action: 'dimensions', chainOf: eerste, addPoints: [{ x: 2000, y: 175 }] }, o);
  assert.equal(erbij.ok, true);
  assert.equal(erbij.chainId, r.chainId);
  assert.deepEqual(kettingLengtes(erbij), [1550, 900, 1550, 1400, 1200, 3400]);
  assert.equal(erbij.dimensions.find((d) => d.role === 'total').lengthMm, 10000, 'totaal blijft');
  assert.equal(erbij.points.find((p) => p.x === 2000).anchored, true, 'op het wandvlak: verankerd');
  const nieuw = o.doc.annotations.filter((a) => a.type === 'measureDistance').at(-1);
  assert.equal(nieuw.opsKettingId, r.chainId, 'het nieuwe segment hoort bij de ketting');
  assert.equal(nieuw.strokeColor, '#000000', 'dezelfde opmaak');
  assert.equal(nieuw.dimShowUnit, false);
  assert.equal(nieuw.startY, 425, 'op de maatlijn van de ketting');
  assert.equal(o.log.filter((e) => e.soort === 'transactie').length, 3, 'een ongedaan-stap per aanroep');

  // De wand schuift 100 pt omlaag: het toegevoegde punt schuift mee.
  for (const w of o.doc.annotations) if (w.type === 'wall') { w.startY += 100; w.endY += 100; }
  const na = await plattegrondOpdracht({ action: 'dimensions', refresh: true }, o);
  assert.equal(na.detached.length, 0);
  assert.equal(nieuw.leaderStartY, 275);

  // Erbuiten: de ketting wordt langer en de totaalmaat groeit mee.
  const langer = await plattegrondOpdracht({ action: 'dimensions', chainOf: eerste, addPoints: [{ x: 5600, y: 275 }] }, o);
  assert.deepEqual(kettingLengtes(langer), [1550, 900, 1550, 1400, 1200, 3400, 1200]);
  assert.equal(langer.dimensions.find((d) => d.role === 'total').lengthMm, 11200);
  assert.equal(langer.points.at(-1).anchored, false, 'geen wand daar: een vrij punt');

  // Weer eraf, tussenpunt en buitenpunt.
  const eraf = await plattegrondOpdracht({
    action: 'dimensions', chainOf: eerste, removePoints: [{ x: 2000, y: 275 }, { x: 5600, y: 275 }],
  }, o);
  assert.deepEqual(kettingLengtes(eraf), [1550, 900, 2950, 1200, 3400]);
  assert.equal(eraf.dimensions.find((d) => d.role === 'total').lengthMm, 10000);
  // De uitloop staat weer alleen aan begin en eind.
  const leden = o.doc.annotations.filter((a) => a.opsKettingId === r.chainId && a.opsMaatRol === 'chain')
    .sort((a, b) => a.startX - b.startX);
  assert.deepEqual(leden.map((m) => m.dimOvershootEnds), ['start', 'none', 'none', 'none', 'end']);
});

test('een losse maat verlengen maakt er een ketting van', async () => {
  const o = omgevingMet();
  const r = await o.maak('measureDistance', 1, {
    startX: 0, startY: 50, endX: 100, endY: 50, leaderStartX: 0, leaderStartY: 0, leaderEndX: 100, leaderEndY: 0,
  });
  const uit = await plattegrondOpdracht({ action: 'dimensions', chainOf: r.id, addPoints: [{ x: 160, y: 0 }] }, o);
  assert.equal(uit.ok, true);
  assert.ok(uit.chainId);
  assert.deepEqual(uit.dimensions.map((d) => d.lengthMm), [200, 120]);
  const fout = await plattegrondOpdracht({ action: 'dimensions', chainOf: r.id, addPoints: [{ x: 100, y: 0 }] }, o);
  assert.equal(fout.ok, false);
  assert.match(fout.warnings[0], /already/);
  assert.match((await plattegrondOpdracht({ action: 'dimensions', chainOf: 'onzin', addPoints: [{ x: 1, y: 1 }] }, o)).error, /chainOf/);
  assert.match((await plattegrondOpdracht({ action: 'dimensions', chainOf: r.id }, o)).error, /addPoints/);
});

test('een maat waarvan de wand verdwijnt raakt los, hij gaat niet stuk', async () => {
  const o = omgevingMet();
  const gevelR = await plattegrondOpdracht(gevel, o);
  await plattegrondOpdracht({ action: 'dimensions', wallIds: gevelR.wallIds }, o);
  const voor = o.doc.annotations.find((a) => a.type === 'measureDistance');
  const bewaard = { ...voor };
  o.doc.annotations = o.doc.annotations.filter((a) => a.id !== gevelR.wallIds[0]);
  const r = await plattegrondOpdracht({ action: 'dimensions', refresh: true }, o);
  assert.equal(r.detached.length, 3, 'de maten aan het weggevallen stuk');
  assert.equal(voor.startX, bewaard.startX, 'de maatlijn staat er nog');
  assert.equal(voor.startY, bewaard.startY);
});

test('dimensions weigert wat geen wandstuk is', async () => {
  const o = omgevingMet();
  assert.match((await plattegrondOpdracht({ action: 'dimensions' }, o)).error, /wallIds/);
  const gevelR = await plattegrondOpdracht(gevel, o);
  const raamId = o.doc.annotations.find((a) => a.symbolId === 'window').id;
  assert.match(
    (await plattegrondOpdracht({ action: 'dimensions', wallIds: [gevelR.wallIds[0], raamId] }, o)).error,
    /existing wall annotations/,
  );
});

test('inspect vertelt wat er staat en wat er niet klopt', async () => {
  const o = omgevingMet();
  const leeg = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.deepEqual(leeg.walls, []);
  assert.deepEqual(leeg.rooms, []);

  const gevelR = await plattegrondOpdracht(gevel, o);
  await plattegrondOpdracht({ action: 'dimensions', wallIds: gevelR.wallIds }, o);
  const r = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.scalePxPerMm, K);
  assert.equal(r.walls.length, 3);
  assert.deepEqual(r.walls.map((w) => w.lengthMm), [1550, 2950, 3400]);
  assert.equal(r.openings.length, 2);
  assert.deepEqual(r.openings.map((x) => x.kind), ['door', 'window']);
  assert.equal(r.openings[1].widthMm, 1200);
  assert.equal(r.openings[1].sillMm, 850);
  assert.equal(r.anchoredDimensions, 6);
  assert.equal(r.openEnds.length, 2, 'een losse gevel is nog geen ruimte');
  assert.deepEqual(r.rooms, []);

  const zonderSchaal = await plattegrondOpdracht({ action: 'inspect' }, omgevingMet([], 0));
  assert.match(zonderSchaal.warning, /no measurement scale/);
});

test('bij een woning met twee ruimten komt de grootste eerst', async () => {
  const o = omgevingMet();
  const lopen = [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    [{ x: 4000, y: 0 }, { x: 4000, y: 4000 }],
    [{ x: 4000, y: 4000 }, { x: 0, y: 4000 }],
    [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
  ];
  for (const [start, end] of lopen) {
    await plattegrondOpdracht({ action: 'wall', start, end, thicknessMm: 300 }, o);
  }
  await plattegrondOpdracht({
    action: 'wall', start: { x: 2500, y: 0 }, end: { x: 2500, y: 4000 }, thicknessMm: 100,
    material: 'nen47-metselwerk-kunststeen',
  }, o);
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.rooms.length, 2);
  bijna(r.rooms[0].areaM2, 36.96, 0.02, 'grootste ruimte');
  bijna(r.rooms[1].areaM2, 21.56, 0.02, 'kleinste ruimte');
  assert.ok(r.rooms[0].areaM2 > r.rooms[1].areaM2);
});

// ── spouwmuur: lagen, kozijn in de spouw, hoeken per laag ──────────────

const SPOUW = [
  { thicknessMm: 100, material: 'nen47-metselwerk-baksteen' },
  { thicknessMm: 40, material: 'none' },
  { thicknessMm: 100, material: 'isolatie', insulation: 'pir' },
  { thicknessMm: 120, material: 'nen47-metselwerk-kunststeen' },
];

test('spouwmuur: per laag een eigen sparing rond het kozijn', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, layers: SPOUW,
    openings: [{ kind: 'window', widthMm: 1200, alongMm: 3000, sillMm: 850, heightMm: 1500 }],
  }, o);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.thicknessMm, 360);
  assert.equal(r.insideSide, 'right');
  assert.deepEqual(r.layers.map((l) => [l.index, l.material, l.thicknessMm]), [
    [0, 'nen47-metselwerk-baksteen', 100],
    [2, 'isolatie', 100],
    [3, 'nen47-metselwerk-kunststeen', 120],
  ]);
  assert.deepEqual(r.cavities, [{ index: 1, thicknessMm: 40 }], 'de luchtspouw is ruimte, geen wand');
  // Aanslag 20 in het buitenblad, isolatie tegen het kozijn, speling 10 in het binnenblad.
  assert.deepEqual(r.layers.map((l) => l.segments.map((s) => s.fromMm)), [[0, 3580], [0, 3600], [0, 3610]]);
  assert.deepEqual(r.layers.map((l) => l.segments.map((s) => s.lengthMm)), [[2420, 6420], [2400, 6400], [2390, 6390]]);
  assert.deepEqual(r.openings[0].layerOpeningsMm, [1160, null, 1200, 1220]);
  assert.deepEqual(r.openings[0].frame, { positionMm: 100, depthMm: 114, overlapMm: 20, clearanceMm: 10 });

  const wanden = o.doc.annotations.filter((a) => a.type === 'wall');
  assert.equal(wanden.length, 6);
  assert.deepEqual([...new Set(wanden.map((w) => w.startY))], [25, 95, 150], 'buitenvlak op y=0, lagen rechts ervan');
  assert.equal(wanden.find((w) => w.hatchPattern === 'isolatie').isolatieType, 'pir');

  const raam = o.doc.annotations.find((a) => a.symbolId === 'window');
  assert.equal(raam.params.wallThickness, 360, 'het symbool beslaat het hele pakket');
  assert.equal(raam.params.kozijnPositieMm, 100, 'kozijn direct achter het buitenblad');
  assert.equal(raam.params.aanslagMm, 20);
  assert.equal(raam.params.binnenSpelingMm, 10);
  assert.equal(raam.params.width, 1200, 'de kozijnmaat');
  assert.equal(raam.rotation, 180, 'binnen (rechts, +n) bovenaan in het symbool');
  // Vak: kozijnmaat plus de speling aan beide kanten, pakket diep.
  assert.deepEqual([raam.x, raam.y, raam.width, raam.height], [1195, 0, 610, 180]);
});

test('spouwmuur: een deur draait standaard naar binnen, openTo kan hem naar buiten laten draaien', async () => {
  const o = omgevingMet();
  await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, layers: SPOUW,
    openings: [
      { kind: 'door', widthMm: 1000, alongMm: 2000 },
      { kind: 'door', widthMm: 1000, alongMm: 6000, openTo: { x: 3000, y: -500 } },
    ],
  }, o);
  const [binnen, buiten] = o.doc.annotations.filter((a) => a.symbolId === 'door');
  assert.equal(binnen.params.draaiNaar, 'binnen');
  assert.equal(buiten.params.draaiNaar, 'buiten');
  assert.equal(binnen.rotation, 180, 'binnen bovenaan');
  assert.equal(buiten.rotation, 180, 'de rotatie volgt de binnenzijde, niet de draairichting');
  // Naar binnen: het vak loopt vanaf het buitenvlak (y=0) de ruimte in.
  bijna(binnen.y, 0, 1e-9, 'buitenvlak');
  assert.ok(binnen.y + binnen.height > 180, 'de draaicirkel ligt binnen');
  // Naar buiten: het vak steekt aan de buitenkant uit.
  assert.ok(buiten.y < 0, 'de draaicirkel ligt buiten');
  bijna(buiten.y + buiten.height, 180, 1e-9, 'tot het binnenvlak');
});

test('spouwmuur: kozijnpositie, aanslag en speling zijn instelbaar', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, layers: SPOUW,
    openings: [{
      kind: 'window', widthMm: 1200, alongMm: 3000,
      framePositionMm: 126, overlapMm: 30, clearanceMm: 0, stileWidthMm: 80, frameDepthMm: 114,
    }],
  }, o);
  assert.deepEqual(r.openings[0].frame, { positionMm: 126, depthMm: 114, overlapMm: 30, clearanceMm: 0 });
  assert.deepEqual(r.openings[0].layerOpeningsMm, [1140, null, 1200, 1200]);
  const raam = o.doc.annotations.find((a) => a.symbolId === 'window');
  assert.equal(raam.params.stijlBreedteMm, 80);
  assert.equal(raam.params.kozijnPositieMm, 126);
});

const RECHTHOEK = [
  [{ x: 0, y: 0 }, { x: 5000, y: 0 }],
  [{ x: 5000, y: 0 }, { x: 5000, y: 4000 }],
  [{ x: 5000, y: 4000 }, { x: 0, y: 4000 }],
  [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
];

test('spouwmuur: aansluitende gevels verstekken per laag in de hoek', async () => {
  const o = omgevingMet();
  const uit = [];
  for (const [start, end] of RECHTHOEK) {
    uit.push(await plattegrondOpdracht({ action: 'wall', start, end, layers: SPOUW }, o));
  }
  assert.deepEqual(uit.map((r) => r.corners), [
    { start: 0, end: 0 }, { start: 3, end: 0 }, { start: 3, end: 0 }, { start: 3, end: 3 },
  ]);
  // Elke laag sluit: elk wandeinde valt samen met precies één ander einde.
  const wanden = o.doc.annotations.filter((a) => a.type === 'wall');
  assert.equal(wanden.length, 12);
  const einden = wanden.flatMap((w) => [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]);
  for (const p of einden) {
    const samen = einden.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6).length;
    assert.equal(samen, 2, `hoekpunt ${p.x},${p.y}`);
  }
  // Het binnenblad (hart 300 mm = 150 pt van het buitenvlak) sluit op (4850, 150).
  const binnenblad = wanden.filter((w) => w.hatchPattern === 'nen47-metselwerk-kunststeen');
  assert.ok(binnenblad.some((w) => w.endX === 4850 && w.endY === 150));
  assert.ok(binnenblad.some((w) => w.startX === 4850 && w.startY === 150));
  // Alles in één undo-stap per gevel.
  assert.equal(o.log.filter((e) => e.soort === 'transactie').length, 4);
});

test('spouwmuur: de ruimte binnen het binnenblad wordt gevonden', async () => {
  const o = omgevingMet();
  for (const [start, end] of RECHTHOEK) {
    await plattegrondOpdracht({ action: 'wall', start, end, layers: SPOUW }, o);
  }
  const r = await plattegrondOpdracht({ action: 'rooms' }, o);
  assert.equal(r.ok, true);
  // Buitenwerks 10 x 8 m, pakket 360: binnen 9280 x 7280 = 67,56 m².
  assert.deepEqual(r.rooms.map((x) => x.areaM2), [67.56], 'alleen binnen het binnenblad, niet de laagringen');
  const insp = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.deepEqual(insp.rooms.map((x) => x.areaM2), [67.56]);
  assert.deepEqual(insp.openEnds, []);
});

test('spouwmuur zonder getekende laag wordt geweigerd', async () => {
  const o = omgevingMet();
  const r = await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 0 }, end: { x: 5000, y: 0 },
    layers: [{ thicknessMm: 40, material: 'none' }],
  }, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /layers/);
  assert.equal(o.doc.annotations.length, 0);
});

test('enkele wand: kozijnargumenten gaan naar het symbool', async () => {
  const o = omgevingMet();
  await plattegrondOpdracht({
    action: 'wall', start: { x: 0, y: 100 }, end: { x: 5000, y: 100 }, thicknessMm: 100,
    material: 'nen47-metselwerk-kunststeen',
    openings: [{ kind: 'door', widthMm: 930, alongMm: 2000, leafThicknessMm: 54 }],
  }, o);
  const deur = o.doc.annotations.find((a) => a.symbolId === 'door');
  assert.equal(deur.params.stijlDiepteMm, 100, 'binnendeur: kozijn gelijk aan de wand');
  assert.equal(deur.params.kozijnPositieMm, 0);
  assert.equal(deur.params.aanslagMm, 0);
  assert.equal(deur.params.deurbladDikteMm, 54);
  const r = await plattegrondOpdracht({ action: 'inspect' }, o);
  assert.deepEqual(r.openings[0].frame, {
    stileWidthMm: 67, depthMm: 100, positionMm: 0, overlapMm: 0, clearanceMm: 0,
  });
  assert.equal(r.openings[0].wallThicknessMm, 100);
});
