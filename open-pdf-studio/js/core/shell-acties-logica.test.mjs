// Rekenregels van de Verkenner-acties (#945): natuurlijke volgorde, verdelen
// van de Rust-wachtrij, PDF-naam naast de bron (nooit overschrijven), de
// paginamaat, het verzamelvenster, de modus van het samenvoegvenster en
// combineren tot een NIEUW document.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AFBEELDING, CAD, PDF, vergelijkNatuurlijk, natuurlijkGesorteerd, verdeelActies, pdfPadNaast,
  schrijfNaastBron, paginaMaatVoorAfbeelding, maakVerzamelaar, mergeVensterModus,
  combineerTotNieuwDocument, naamVan,
} from './shell-acties-logica.js';

test('natuurlijke volgorde: S1.2 voor S1.10, op bestandsnaam, hoofdletters gelijk', () => {
  const paden = [
    'C:\\tek\\S1.10.pdf', 'C:\\tek\\S1.2.pdf', 'C:\\tek\\s1.1.pdf', 'C:\\andere\\A.pdf', 'C:\\tek\\S2.pdf',
  ];
  assert.deepEqual(natuurlijkGesorteerd(paden).map(naamVan), ['A.pdf', 's1.1.pdf', 'S1.2.pdf', 'S1.10.pdf', 'S2.pdf']);
  assert.ok(vergelijkNatuurlijk('/x/blad 9.pdf', '/x/blad 10.pdf') < 0);
  // Dezelfde naam in twee mappen: vaste volgorde op het pad.
  assert.deepEqual(natuurlijkGesorteerd(['D:/b/x.pdf', 'C:/a/x.pdf']), ['C:/a/x.pdf', 'D:/b/x.pdf']);
  // Dubbel geselecteerd telt één keer.
  assert.deepEqual(natuurlijkGesorteerd(['a.pdf', 'a.pdf']), ['a.pdf']);
});

test('bestandstypen van de installer', () => {
  for (const e of ['jpg', 'JPEG', 'png', 'bmp', 'gif', 'webp']) assert.ok(AFBEELDING.test(`x.${e}`), e);
  for (const e of ['dwg', 'DXF']) assert.ok(CAD.test(`x.${e}`), e);
  assert.ok(PDF.test('x.PDF'));
  assert.ok(!AFBEELDING.test('x.svg'));
});

test('verdeelActies: combineren neemt PDF + afbeelding, omzetten afbeelding + tekening', () => {
  const r = verdeelActies([
    { mode: 'combine', files: ['a.pdf', 'b.jpg', 'c.dwg', 'd.txt'] },
    { mode: 'convert', files: ['e.png', 'f.dxf', 'g.pdf'] },
    { mode: 'iets', files: ['h.pdf'] },
    null,
    { mode: 'combine' },
  ]);
  assert.deepEqual(r, { combine: ['a.pdf', 'b.jpg'], convert: ['e.png', 'f.dxf'] });
});

test('pdfPadNaast: zelfde naam, en (n) als die bezet is', () => {
  assert.equal(pdfPadNaast('C:\\map\\foto.jpg'), 'C:\\map\\foto.pdf');
  assert.equal(pdfPadNaast('C:\\map\\foto.jpg', 2), 'C:\\map\\foto (2).pdf');
  assert.equal(pdfPadNaast('/m.ap/scan.v2.png', 3), '/m.ap/scan.v2 (3).pdf');
  // Een punt in de mapnaam is geen extensie.
  assert.equal(pdfPadNaast('/m.ap/zonder'), '/m.ap/zonder.pdf');
});

test('schrijfNaastBron overschrijft nooit en neemt het eerste vrije pad', async () => {
  const bestaand = new Set(['C:\\m\\foto.pdf', 'C:\\m\\foto (2).pdf']);
  const geschreven = [];
  const schrijfNieuw = async (pad, bytes) => {
    if (bestaand.has(pad)) throw new Error('CHOOSE_NEW_FILE');
    bestaand.add(pad);
    geschreven.push([pad, bytes]);
  };
  assert.equal(await schrijfNaastBron('C:\\m\\foto.jpg', 'B', schrijfNieuw), 'C:\\m\\foto (3).pdf');
  assert.deepEqual(geschreven, [['C:\\m\\foto (3).pdf', 'B']]);
  // Een andere fout gaat door, zonder verder te proberen.
  await assert.rejects(schrijfNaastBron('x.jpg', 'B', async () => { throw new Error('EACCES'); }), /EACCES/);
});

test('paginamaat: de afbeelding op 96 dpi', () => {
  assert.deepEqual(paginaMaatVoorAfbeelding(800, 600), { breedte: 600, hoogte: 450 });
});

test('verzamelaar: één verwerking na de laatste start van een selectie', () => {
  const timers = new Map();
  let id = 0;
  const zetTimer = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const wisTimer = (t) => timers.delete(t);
  let keer = 0;
  const v = maakVerzamelaar(() => { keer++; }, { wachtMs: 900, zetTimer, wisTimer });
  v.seintje(); v.seintje(); v.seintje();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 900);
  assert.ok(v.wachtend());
  [...timers.values()][0].fn();
  assert.equal(keer, 1);
  assert.ok(!v.wachtend());
});

test('mergeVensterModus: gewoon samenvoegen tegenover combineren tot nieuw document', () => {
  const gewoon = mergeVensterModus(undefined);
  assert.deepEqual(gewoon, {
    combineNew: false, titelSleutel: 'mergePdfs.title', knopSleutel: null, toonInvoegpositie: true, beginBestanden: [],
  });
  const nieuw = mergeVensterModus({ combineNew: true, files: ['C:\\S1.10.pdf', 'C:\\S1.2.pdf', '', 3] });
  assert.equal(nieuw.combineNew, true);
  assert.equal(nieuw.titelSleutel, 'mergePdfs.combineTitle');
  assert.equal(nieuw.knopSleutel, 'mergePdfs.combineButton');
  assert.equal(nieuw.toonInvoegpositie, false);
  assert.deepEqual(nieuw.beginBestanden, ['C:\\S1.2.pdf', 'C:\\S1.10.pdf']);
});

function nepApp(begin) {
  let actief = begin;
  const log = [];
  return {
    log,
    deps: {
      actiefDocument: () => actief,
      maakNieuw: async (pad) => { log.push(['nieuw', pad]); actief = { pdfDoc: {}, isUntitled: true, filePath: `/tmp/opds-untitled-${log.length}.pdf` }; },
      voegSamen: async (paden, positie) => { log.push(['samen', paden, positie, actief.filePath]); return { merged: paden }; },
    },
    zetActief: (d) => { actief = d; },
  };
}

test('combineren: eerste bestand wordt het nieuwe document, de rest erachter', async () => {
  const app = nepApp({ pdfDoc: {}, filePath: 'C:\\open.pdf' });
  const r = await combineerTotNieuwDocument(['a.pdf', 'b.pdf', 'c.pdf'], app.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(app.log, [['nieuw', 'a.pdf'], ['samen', ['b.pdf', 'c.pdf'], 'end', '/tmp/opds-untitled-1.pdf']]);
});

test('combineren: één bestand, en zonder open document', async () => {
  const app = nepApp(null);
  assert.deepEqual(await combineerTotNieuwDocument(['a.pdf'], app.deps), { ok: true, verslag: null });
  assert.deepEqual(app.log, [['nieuw', 'a.pdf']]);
  assert.deepEqual(await combineerTotNieuwDocument([], app.deps), { ok: false, reden: 'no-files' });
});

test('combineren raakt het open document nooit aan als het nieuwe niet lukt', async () => {
  const open = { pdfDoc: {}, filePath: 'C:\\open.pdf' };
  const app = nepApp(open);
  app.deps.maakNieuw = async () => { /* mislukt: actief blijft het open document */ };
  const r = await combineerTotNieuwDocument(['a.pdf', 'b.pdf'], app.deps);
  assert.deepEqual(r, { ok: false, reden: 'not-created' });
  assert.deepEqual(app.log, []);
});
