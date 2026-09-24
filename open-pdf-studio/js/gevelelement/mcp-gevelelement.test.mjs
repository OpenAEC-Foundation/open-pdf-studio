import assert from 'node:assert/strict';
import test from 'node:test';

import { FACADE_ACTIES, gevelelementOpdracht, paneelUitInvoer } from './mcp-gevelelement.js';

const K = 0.5;                                    // paginapunten per mm
const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** App-kant als stub: onthoudt wat er gemaakt, gewijzigd en verwijderd is. */
function omgevingMet(annotaties = [], pxPerMm = K) {
  const doc = { currentPage: 1, annotations: annotaties, paginas: 2 };
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
      log.push({ soort: 'werkBij', id });
      return { ok: true };
    },
    async verwijder(id) {
      const i = doc.annotations.findIndex((x) => x.id === id);
      if (i >= 0) doc.annotations.splice(i, 1);
      log.push({ soort: 'verwijder', id });
      return { ok: true };
    },
    async transactie(fn) { log.push({ soort: 'transactie' }); await fn(); },
  };
}

const LOS = {
  action: 'create', preset: 'curtainWall',
  start: { x: 100, y: 100 }, end: { x: 1900, y: 100 },       // 3600 mm op K
  fields: 3, panels: ['glass', { type: 'door', hinge: 'end', swing: 'outside' }, 'solid'],
};

test('de acties van de opdracht', () => {
  assert.deepEqual([...FACADE_ACTIES], ['create', 'get', 'addMullion', 'removeMullion', 'moveMullion', 'setMullionType', 'setPanel', 'divide']);
  assert.deepEqual(paneelUitInvoer('turnSash'), { type: 'draairaam' });
  assert.deepEqual(paneelUitInvoer({ hinge: 'end' }), { scharnier: 'eind' }, 'zonder type alleen de eigenschap');
});

test('los aanmaken langs een lijn: verdeling, panelen, één undo-stap', async () => {
  const om = omgevingMet();
  const r = await gevelelementOpdracht(LOS, om);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.preset, 'curtainWall');
  assert.equal(r.lengthMm, 3600);
  assert.equal(r.depthMm, 150);
  assert.deepEqual(r.mullions.map((m) => [m.role, m.atMm]), [['frameStart', 25], ['mullion', 1200], ['mullion', 2400], ['frameEnd', 3575]]);
  assert.deepEqual(r.fields.map((f) => f.panel), ['glass', 'door', 'solid']);
  assert.equal(r.fields[1].hinge, 'end');
  assert.equal(r.fields[1].swing, 'outside');
  assert.equal(r.fields[1].clearWidthMm, 1150);
  assert.equal(r.host, null);
  assert.deepEqual(om.log.map((l) => l.soort), ['transactie', 'maak']);
  const ann = om.doc.annotations[0];
  assert.equal(ann.type, 'parametricSymbol');
  assert.equal(ann.symbolId, 'vliesgevel');
  assert.equal(ann.ifcCategory, 'IfcCurtainWall');
  assert.deepEqual([ann.startX, ann.startY, ann.endX, ann.endY], [100, 100, 1900, 100]);
  bijna(ann.height, (150 + 2 * 1150) * K, 1e-9, 'vak omvat de draaicirkel');
  assert.equal(ann.params.panelen[1].scharnier, 'eind');
});

test('aanmaken met veldbreedtes, stijltype en kozijn-voorinstelling', async () => {
  const om = omgevingMet();
  const r = await gevelelementOpdracht({
    action: 'create', preset: 'windowFrame',
    start: { x: 0, y: 0 }, end: { x: 0, y: 900 },              // 1800 mm, omlaag
    fieldWidthsMm: [600, 1200], mullionType: 'hout-90x114', panels: ['turnSash', 'glass'],
  }, om);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.preset, 'windowFrame');
  assert.deepEqual(r.fields.map((f) => f.widthMm), [600, 1200]);
  assert.equal(r.mullions[1].type, 'hout-90x114');
  assert.equal(r.mullions[0].type, 'hout-67x114', 'het kader blijft het standaardtype');
  assert.deepEqual(r.fields.map((f) => f.panel), ['turnSash', 'glass']);
  assert.equal(om.doc.annotations[0].ifcCategory, 'IfcWindow');
});

test('weigert wat niet klopt, zonder iets te tekenen', async () => {
  const om = omgevingMet();
  const fouten = [
    { ...LOS, preset: 'dak' },
    { ...LOS, start: undefined },
    { ...LOS, fields: undefined, fieldWidthsMm: [1000, 1000] },
    { ...LOS, panels: ['glass', 'glass', 'glass', 'glass'] },
    { ...LOS, panels: ['turnSash'] },
    { ...LOS, mullionType: 'hout-67x114' },
    { ...LOS, fields: 99 },
    { action: 'create', wallId: 'bestaat-niet', lengthMm: 1000 },
    { action: 'onzin' },
    { ...LOS, page: 5 },
  ];
  for (const f of fouten) {
    const r = await gevelelementOpdracht(f, om);
    assert.equal(r.ok, false, JSON.stringify(f));
    assert.ok(r.error, 'met een reden');
  }
  assert.equal(om.doc.annotations.length, 0);
  const zonderSchaal = await gevelelementOpdracht(LOS, omgevingMet([], 0));
  assert.match(zonderSchaal.error, /measurement scale/);
});

test('in een wand: de wand wordt onderbroken, het element zit in het gat', async () => {
  const wand = {
    id: 'w1', type: 'wall', page: 1, startX: 0, startY: 100, endX: 5000, endY: 100,
    dikteMm: 300, hatchPattern: 'nen47-metselwerk-baksteen',
  };
  const om = omgevingMet([wand]);
  const r = await gevelelementOpdracht({
    action: 'create', preset: 'curtainWall', wallId: 'w1', fromMm: 2000, lengthMm: 4800, fields: 4,
  }, om);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.start, { x: 1000, y: 100 });
  assert.deepEqual(r.end, { x: 3400, y: 100 });
  assert.deepEqual(r.host, { wallId: 'w1', fromMm: 2000, lengthMm: 4800, offsetMm: 0, thicknessMm: 300 });
  assert.equal(r.wallIds.length, 2);
  assert.equal(wand.endX, 1000, 'de bestaande wand stopt bij het element');
  const tweede = om.doc.annotations.find((a) => a.id === r.wallIds[1]);
  assert.equal(tweede.startX, 3400);
  assert.equal(tweede.endX, 5000);
  assert.equal(tweede.hatchPattern, 'nen47-metselwerk-baksteen', 'het tweede stuk erft de stijl');
  assert.deepEqual(om.log.map((l) => l.soort), ['transactie', 'werkBij', 'maak', 'maak'], 'één transactie');
  const past = await gevelelementOpdracht({ action: 'create', wallId: 'w1', fromMm: 0, lengthMm: 3000 }, omgevingMet([{ ...wand, endX: 1000 }]));
  assert.equal(past.ok, false, 'past niet meer in het korte stuk');
});

test('de hele wand vervangen: de wand-annotatie verdwijnt', async () => {
  const wand = { id: 'w2', type: 'wall', page: 1, startX: 0, startY: 0, endX: 1000, endY: 0, dikteMm: 200 };
  const om = omgevingMet([wand]);
  const r = await gevelelementOpdracht({ action: 'create', wallId: 'w2', fromMm: 0, lengthMm: 2000 }, om);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.wallIds, []);
  assert.ok(!om.doc.annotations.some((a) => a.id === 'w2'));
});

test('bewerken: stijl toevoegen, verschuiven, verwijderen, type en paneel wisselen', async () => {
  const om = omgevingMet();
  const { id } = await gevelelementOpdracht(LOS, om);
  let r = await gevelelementOpdracht({ action: 'addMullion', id, atMm: 600 }, om);
  assert.deepEqual(r.mullions.map((m) => m.atMm), [25, 600, 1200, 2400, 3575]);
  r = await gevelelementOpdracht({ action: 'moveMullion', id, atMm: 1190, toMm: 1300 }, om);
  assert.deepEqual(r.mullions.map((m) => m.atMm), [25, 600, 1300, 2400, 3575], 'de dichtstbijzijnde stijl');
  r = await gevelelementOpdracht({ action: 'moveMullion', id, mullion: 1, byMm: -100 }, om);
  assert.equal(r.mullions[1].atMm, 500);
  r = await gevelelementOpdracht({ action: 'removeMullion', id, mullion: 1 }, om);
  assert.deepEqual(r.mullions.map((m) => m.atMm), [25, 1300, 2400, 3575]);
  r = await gevelelementOpdracht({ action: 'setMullionType', id, mullion: 0, mullionType: 'alu-50x200' }, om);
  assert.equal(r.mullions[0].type, 'alu-50x200');
  assert.equal(r.depthMm, 200);
  r = await gevelelementOpdracht({ action: 'setPanel', id, fieldIndexes: [0, 2], panel: 'open' }, om);
  assert.deepEqual(r.fields.map((f) => f.panel), ['open', 'door', 'open']);
  r = await gevelelementOpdracht({ action: 'setPanel', id, field: 1, panel: { hinge: 'start' } }, om);
  assert.equal(r.fields[1].panel, 'door');
  assert.equal(r.fields[1].hinge, 'start');
  r = await gevelelementOpdracht({ action: 'divide', id, fields: 2 }, om);
  assert.deepEqual(r.fields.map((f) => f.widthMm), [1800, 1800]);
  const ann = om.doc.annotations[0];
  assert.deepEqual([ann.startX, ann.endX], [100, 1900], 'de lijn blijft liggen');
  assert.equal(om.log.filter((l) => l.soort === 'transactie').length, 9, 'elke aanroep één undo-stap');
});

test('bewerken weigert netjes', async () => {
  const om = omgevingMet();
  const { id } = await gevelelementOpdracht(LOS, om);
  const voor = JSON.stringify(om.doc.annotations[0]);
  for (const f of [
    { action: 'addMullion', id, atMm: 1210 },
    { action: 'addMullion', id },
    { action: 'removeMullion', id, mullion: 0 },
    { action: 'moveMullion', id, mullion: 1, toMm: 50 },
    { action: 'moveMullion', id, mullion: 1 },
    { action: 'setPanel', id, field: 7, panel: 'glass' },
    { action: 'setPanel', id, field: 0, panel: 'turnSash' },
    { action: 'divide', id },
    { action: 'setMullionType', id, mullionType: 'onbekend' },
    { action: 'addMullion', id: 'onbekend', atMm: 600 },
  ]) {
    const r = await gevelelementOpdracht(f, om);
    assert.equal(r.ok, false, JSON.stringify(f));
  }
  assert.equal(JSON.stringify(om.doc.annotations[0]), voor, 'niets veranderd');
});

test('terugvragen: één element of alle elementen op de pagina', async () => {
  const om = omgevingMet();
  const { id } = await gevelelementOpdracht(LOS, om);
  await gevelelementOpdracht({ ...LOS, preset: 'windowFrame', fields: undefined, panels: undefined, start: { x: 0, y: 500 }, end: { x: 900, y: 500 } }, om);
  const een = await gevelelementOpdracht({ action: 'get', id }, om);
  assert.equal(een.ok, true);
  assert.equal(een.fields.length, 3);
  const alle = await gevelelementOpdracht({ action: 'get' }, om);
  assert.equal(alle.elements.length, 2);
  assert.deepEqual(alle.elements.map((e) => e.preset), ['curtainWall', 'windowFrame']);
  assert.deepEqual(alle.elements[0].panels, ['glass', 'door', 'solid']);
  assert.equal((await gevelelementOpdracht({ action: 'get', id: 'x' }, om)).ok, false);
});
