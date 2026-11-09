// De inbeddings-API van de web-unit (#451): app-model, opties van mount(),
// Engelse gebeurtenissen, teksten en wat de unit bij storage="local" bewaart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { naarAppModel, lijstNaarAppModel, kopieVoorGastheer, SOORTEN } from './model.js';
import {
  attributenUitOpties, engelsDetail, EVENTS, EVENT_VOOR, HANDLERS, GEBEURTENISSEN,
  leesInstellingen, geladenDetail, gewijzigdDetail, opgeslagenDetail, foutDetail,
} from './api.js';
import { tekstenVoor, TEKSTEN } from './teksten.js';
import { documentSleutel, leesStand, bewaarStand, wisAlles, SLEUTEL_PREFIX } from './opslag.js';
import { schrijfAnnotaties } from './opslaan.js';
import { leesSchaal } from './meten.js';

// ── model ───────────────────────────────────────────────────────────────────

test('de soorten zijn die van de bureaubladversie', () => {
  assert.deepEqual([...SOORTEN], ['measureDistance', 'comment', 'box']);
});

test('oude namen van de eerste snede worden het app-model', () => {
  assert.deepEqual(naarAppModel({ type: 'note', page: 2, x: 1, y: 2, contents: 'hoi' }),
    { type: 'comment', page: 2, x: 1, y: 2, text: 'hoi', icon: 'comment' });
  assert.deepEqual(naarAppModel({ type: 'square', page: 1, x: 10, y: 20, breedte: 30, hoogte: 40 }),
    { type: 'box', page: 1, x: 10, y: 20, width: 30, height: 40 });
});

test('een negatieve rechthoek wordt genormaliseerd naar linksboven', () => {
  assert.deepEqual(naarAppModel({ type: 'box', x: 50, y: 50, width: -20, height: -10 }),
    { type: 'box', page: 1, x: 30, y: 40, width: 20, height: 10 });
});

test('app-annotaties komen ongewijzigd door, onbekende soorten vallen weg', () => {
  const app = { type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 10, endY: 0, measureText: '1 mm' };
  assert.deepEqual(naarAppModel(app), app);
  assert.notEqual(naarAppModel(app), app, 'geen mutatie van de invoer');
  assert.deepEqual(lijstNaarAppModel([null, { type: 'stamp' }, app, 'rommel']), [app]);
  assert.deepEqual(lijstNaarAppModel('geen lijst'), []);
});

test('de kopie voor de gastheer is los van de laag', () => {
  const laag = [{ type: 'comment', x: 1, y: 1, schaal: { eenheidPerPunt: 1 } }];
  const kopie = kopieVoorGastheer(laag);
  kopie[0].x = 99;
  kopie[0].schaal.eenheidPerPunt = 5;
  assert.equal(laag[0].x, 1);
  assert.equal(laag[0].schaal.eenheidPerPunt, 1);
});

test('app-model en oude namen geven hetzelfde bestand', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const bron = await doc.save({ useObjectStreams: false });
  const lees = async (bytes) => {
    const d = await PDFDocument.load(bytes);
    return d.getPages()[0].node.get(PDFName.of('Annots')).asArray().map((r) => {
      const a = d.context.lookup(r);
      return [String(a.get(PDFName.of('Subtype'))), a.get(PDFName.of('Contents'))?.decodeText(),
        a.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber())];
    });
  };
  const nieuw = await lees(await schrijfAnnotaties(bron, [
    { type: 'comment', page: 1, x: 10, y: 10, text: 'tekst' },
    { type: 'box', page: 1, x: 10, y: 20, width: 100, height: 50, comment: 'vlak' },
  ]));
  const oud = await lees(await schrijfAnnotaties(bron, [
    { type: 'note', page: 1, x: 10, y: 10, contents: 'tekst' },
    { type: 'square', page: 1, x: 10, y: 20, breedte: 100, hoogte: 50, contents: 'vlak' },
  ]));
  assert.deepEqual(nieuw, oud);
  assert.deepEqual(nieuw[0], ['/Text', 'tekst', [10, 808, 34, 832]]);
  assert.deepEqual(nieuw[1], ['/Square', 'vlak', [10, 772, 110, 822]]);
});

// ── opties van mount() ──────────────────────────────────────────────────────

test('mount-opties worden attributen', () => {
  assert.deepEqual(attributenUitOpties({
    src: '/t.pdf', scale: '1:50', unit: 'm', lang: 'nl', engine: 'mupdf', mode: 'edit',
    tools: ['measure', 'comment'], page: 3, zoom: 1.5, storage: 'local',
    hostOrigin: ['https://a.example', 'https://b.example'], toolbar: false, theme: 'dark',
  }), {
    src: '/t.pdf', scale: '1:50', unit: 'm', lang: 'nl', engine: 'mupdf', mode: 'edit',
    tools: 'measure,comment', page: '3', zoom: '1.5', storage: 'local',
    'host-origin': 'https://a.example https://b.example', toolbar: 'none', theme: 'dark',
  });
});

test('readOnly wint van mode, lege waarden en een schaalobject vallen weg', () => {
  assert.deepEqual(attributenUitOpties({ mode: 'edit', readOnly: true, src: '', lang: null }), { mode: 'view' });
  assert.deepEqual(attributenUitOpties({ scale: { unitsPerPoint: 2, unit: 'mm' } }), {});
  assert.deepEqual(attributenUitOpties({ toolbar: true }), { toolbar: 'default' });
  assert.deepEqual(attributenUitOpties(), {});
});

test('de attributen uit mount() lezen terug als dezelfde instellingen', () => {
  const i = leesInstellingen(attributenUitOpties({ tools: ['comment'], readOnly: true, toolbar: false, theme: 'dark', zoom: '150%' }));
  assert.deepEqual([...i.gereedschappen], ['comment']);
  assert.equal(i.modus, 'view');
  assert.equal(i.werkbalk, 'none');
  assert.equal(i.thema, 'dark');
  assert.equal(i.zoom, 1.5);
  assert.equal(leesInstellingen({ toolbar: 'kaas', theme: 'paars' }).werkbalk, 'default');
  assert.equal(leesInstellingen({ theme: 'paars' }).thema, 'light');
});

// ── Engelse gebeurtenissen ──────────────────────────────────────────────────

test('elke Nederlandse gebeurtenis heeft een Engelse tegenhanger', () => {
  assert.deepEqual(EVENTS, { load: 'opds:load', change: 'opds:change', save: 'opds:save', error: 'opds:error' });
  assert.deepEqual(Object.keys(EVENT_VOOR).sort(), Object.values(GEBEURTENISSEN).sort());
  assert.deepEqual(Object.values(HANDLERS).sort(), Object.values(EVENTS).sort());
});

test('de Engelse details hebben Engelse velden', () => {
  const schaal = leesSchaal('1:100', 'mm');
  assert.deepEqual(engelsDetail(GEBEURTENISSEN.geladen, geladenDetail({ paginas: 2, breedtePt: 10, hoogtePt: 20, schaal })), {
    pages: 2, widthPt: 10, heightPt: 20,
    scale: { unitsPerPoint: schaal.eenheidPerPunt, ratio: schaal.noemer, unit: 'mm' },
  });
  assert.equal(engelsDetail(GEBEURTENISSEN.geladen, geladenDetail({ paginas: 1, breedtePt: 1, hoogtePt: 1 })).scale, null);
  assert.deepEqual(engelsDetail(GEBEURTENISSEN.gewijzigd, gewijzigdDetail([{ id: 'a' }, { id: 'b' }])), { count: 2, last: { id: 'b' } });
  const bytes = new Uint8Array([1, 2]);
  assert.deepEqual(engelsDetail(GEBEURTENISSEN.opgeslagen, opgeslagenDetail(bytes, [{}])), { bytes, annotationCount: 1 });
  assert.deepEqual(engelsDetail(GEBEURTENISSEN.fout, foutDetail('laden', 'HTTP 404')), { code: 'laden', message: 'HTTP 404' });
});

// ── teksten ─────────────────────────────────────────────────────────────────

test('elke taal heeft alle sleutels van het Engels', () => {
  const sleutels = Object.keys(TEKSTEN.en).sort();
  for (const [taal, t] of Object.entries(TEKSTEN)) assert.deepEqual(Object.keys(t).sort(), sleutels, taal);
});

test('taalkeuze valt terug op de hoofdtaal en dan op Engels; de gastheer wint', () => {
  assert.equal(tekstenVoor('nl').measure, 'Meten');
  assert.equal(tekstenVoor('NL-be').measure, 'Meten');
  assert.equal(tekstenVoor('pt-BR').measure, 'Measure');
  assert.equal(tekstenVoor(undefined).fit, 'Fit');
  const eigen = tekstenVoor('nl', { measure: 'Maatvoering', onbekend: 'x', fit: '' });
  assert.equal(eigen.measure, 'Maatvoering');
  assert.equal(eigen.fit, 'Passend');
  assert.equal('onbekend' in eigen, false);
});

// ── storage="local" ─────────────────────────────────────────────────────────

function nepOpslag(begin = {}) {
  const m = new Map(Object.entries(begin));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    kaart: m,
  };
}

test('de documentsleutel is stabiel per inhoud en heeft de vaste prefix', () => {
  const a = new Uint8Array(200000).map((_, i) => i % 251);
  const b = a.slice();
  b[199999] ^= 1;
  assert.equal(documentSleutel(a), documentSleutel(a.slice()));
  assert.notEqual(documentSleutel(a), documentSleutel(b));
  assert.ok(documentSleutel(a).startsWith(SLEUTEL_PREFIX));
  assert.ok(documentSleutel(new Uint8Array(0)).startsWith(SLEUTEL_PREFIX));
});

test('pagina en schaal worden bewaard, samengevoegd en weer gelezen', () => {
  const o = nepOpslag();
  const k = documentSleutel(new Uint8Array([1, 2, 3]));
  assert.equal(leesStand(o, k), null);
  assert.equal(bewaarStand(o, k, { pagina: 4 }), true);
  const schaal = leesSchaal('1:50', 'mm');
  bewaarStand(o, k, { schaal });
  assert.deepEqual(leesStand(o, k), { pagina: 4, schaal });
  bewaarStand(o, k, { schaal: null });
  assert.deepEqual(leesStand(o, k), { pagina: 4 });
});

test('rommel in de opslag of een weigerende opslag laat de unit niet vallen', () => {
  const k = SLEUTEL_PREFIX + 'doc:x';
  assert.equal(leesStand(nepOpslag({ [k]: '{kapot' }), k), null);
  assert.equal(leesStand(nepOpslag({ [k]: '{"pagina":-3,"schaal":{"eenheidPerPunt":0}}' }), k), null);
  const weigert = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(leesStand(weigert, k), null);
  assert.equal(bewaarStand(weigert, k, { pagina: 1 }), false);
  assert.equal(leesStand(null, k), null);
});

test('wissen raakt alleen de sleutels van de unit', () => {
  const o = nepOpslag({ [SLEUTEL_PREFIX + 'a']: '1', [SLEUTEL_PREFIX + 'b']: '2', 'gastheer:eigen': '3' });
  assert.equal(wisAlles(o), 2);
  assert.deepEqual([...o.kaart.keys()], ['gastheer:eigen']);
  assert.equal(wisAlles(null), 0);
});
