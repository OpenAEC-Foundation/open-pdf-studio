// Het hostcontract `window.openaecHost` van de SuperCloud (#977): openen en
// opslaan via de host in plaats van download en upload, conflicten als kopie,
// Opslaan als met een naam, en de keuze bij de start (gastpagina, SuperCloud,
// brug uit de hash of later met openaec-host-ready).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSiteHost, opslagUitSiteHost, siteHostUitBrug, koppelHost, voorkeurenUitHash, HOST_KLAAR_EVENT,
} from './site-host.js';
import { foutSoort } from './host-opslaan-als.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** Een nep-openaecHost zoals de SuperCloud hem neerzet. */
function nepHost({ initialFileId = 'DOC-1', conflictBij = null, weigerSoort = false } = {}) {
  const log = [];
  let volgnummer = 0;
  const host = {
    taal: 'nl',
    thema: 'dark',
    initialFileId,
    log,
    async open(id, version) {
      log.push(['open', id, version]);
      if (id === 'KAPOT') throw Object.assign(new Error('Geen toegang'), { code: 'geen_rechten' });
      return { id, name: `${id}.pdf`, version: version ?? 3, readOnly: id === 'ALLEEN', bytes: PDF.buffer.slice(0) };
    },
    async save(bytes, opties) {
      log.push(['save', bytes.byteLength, { ...opties }]);
      if (opties.name && weigerSoort) throw Object.assign(new Error('Alleen .pdf'), { code: 'soort_niet_toegestaan' });
      if (opties.name) return { id: `NIEUW-${++volgnummer}`, name: opties.name === 'bestaat.pdf' ? 'bestaat (2).pdf' : opties.name, version: 1 };
      if (conflictBij === opties.id) return { id: `${opties.id}-kopie`, name: 'plan (kopie).pdf', version: 1 };
      return { id: opties.id, name: `${opties.id}.pdf`, version: Number(opties.expectedVersion ?? 0) + 1 };
    },
    async list() {
      log.push(['list']);
      return [{ id: 'DOC-1', name: 'plan.pdf', modified: '2026-11-01' }, { id: 7, name: 'b.pdf', modified: '2026-11-02' }];
    },
    async versions(id) {
      log.push(['versions', id]);
      return [{ version: 3, modified: '2026-11-03', author: 'An' }, { version: 2, modified: '2026-11-01' }];
    },
  };
  return host;
}

test('isSiteHost: alleen met open en save', () => {
  assert.equal(isSiteHost(nepHost()), true);
  assert.equal(isSiteHost({ open() {} }), false);
  assert.equal(isSiteHost(null), false);
  assert.equal(isSiteHost('host'), false);
});

test('openen: bytes, naam, versie en alleen-lezen in de vorm van de app', async () => {
  const host = nepHost();
  const { storage, document } = opslagUitSiteHost(host);
  assert.equal(document, 'DOC-1', 'initialFileId gaat bij de start open');
  const doc = await storage.open('DOC-1');
  assert.deepEqual([...doc.data], [...PDF]);
  assert.equal(doc.data instanceof Uint8Array, true);
  assert.equal(doc.name, 'DOC-1.pdf');
  assert.equal(doc.versie, 3);
  assert.equal(doc.alleenLezen, false);
  assert.equal((await storage.open('ALLEEN')).alleenLezen, true);
  // Een oudere versie is altijd alleen-lezen.
  const oud = await storage.open('DOC-1', 2);
  assert.equal(oud.alleenLezen, true);
  assert.deepEqual(host.log.at(-1), ['open', 'DOC-1', 2]);
  // Een fout van de host draagt zijn code ook als hostCode (voor de meldingen).
  await assert.rejects(storage.open('KAPOT'), (e) => e.hostCode === 'geen_rechten');
});

test('opslaan: save(bytes, { id, expectedVersion }) en de versie schuift door', async () => {
  const host = nepHost();
  const uitkomsten = [];
  const { storage } = opslagUitSiteHost(host, { bijOpslaan: (u) => uitkomsten.push(u) });
  await storage.open('DOC-1');
  const eerste = await storage.save('DOC-1', PDF);
  assert.deepEqual(host.log.at(-1), ['save', 4, { id: 'DOC-1', expectedVersion: 3 }]);
  assert.equal(eerste.conflict, false);
  assert.equal(eerste.versie, 4);
  await storage.save('DOC-1', PDF);
  assert.deepEqual(host.log.at(-1)[2], { id: 'DOC-1', expectedVersion: 4 });
  assert.equal(uitkomsten.length, 2);
});

test('opslaan met een conflict: een kopie, de gebruiker hoort de naam, volgende opslagen gaan naar de kopie', async () => {
  const host = nepHost({ conflictBij: 'DOC-1' });
  const uitkomsten = [];
  const { storage } = opslagUitSiteHost(host, { bijOpslaan: (u) => uitkomsten.push(u) });
  await storage.open('DOC-1');
  const uitkomst = await storage.save('DOC-1', PDF);
  assert.equal(uitkomst.conflict, true);
  assert.equal(uitkomst.bestand, 'DOC-1-kopie');
  assert.equal(uitkomst.naam, 'plan (kopie).pdf');
  assert.equal(uitkomsten[0].conflict, true);
  await storage.save('DOC-1', PDF);
  assert.deepEqual(host.log.at(-1)[2], { id: 'DOC-1-kopie', expectedVersion: 1 });
});

test('Opslaan als: save(bytes, { name }) maakt een nieuw bestand; een weigering draagt de code', async () => {
  const host = nepHost();
  const { storage } = opslagUitSiteHost(host);
  assert.deepEqual(await storage.saveAs(PDF, { name: 'nieuw.pdf', folder: 'MAP' }),
    { id: 'NIEUW-1', name: 'nieuw.pdf', version: 1, renamed: false });
  assert.deepEqual(host.log.at(-1)[2], { name: 'nieuw.pdf' }, 'het contract kent geen map: naast het geopende');
  const hernoemd = await storage.saveAs(PDF, { name: 'bestaat.pdf' });
  assert.equal(hernoemd.renamed, true);
  assert.equal(hernoemd.name, 'bestaat (2).pdf');
  // Daarna opslaan schrijft naar het nieuwe bestand, met zijn versie.
  await storage.save('NIEUW-1', PDF);
  assert.deepEqual(host.log.at(-1)[2], { id: 'NIEUW-1', expectedVersion: 1 });
  await assert.rejects(storage.saveAs(PDF, { name: ' ' }), (e) => e.code === 'invalid_name');

  const weigert = opslagUitSiteHost(nepHost({ weigerSoort: true })).storage;
  await assert.rejects(weigert.saveAs(PDF, { name: 'x.docx' }), (e) => {
    assert.equal(e.hostCode, 'soort_niet_toegestaan');
    assert.equal(foutSoort(e), 'ongeldige_naam', 'de melding van Opslaan als voor een verkeerde soort');
    return true;
  });
});

test('lijst en versies: de bestanden van de tool in dezelfde map', async () => {
  const host = nepHost();
  const { storage } = opslagUitSiteHost(host);
  assert.deepEqual(await storage.list(), [
    { id: 'DOC-1', name: 'plan.pdf', modified: '2026-11-01', kind: 'file' },
    { id: '7', name: 'b.pdf', modified: '2026-11-02', kind: 'file' },
  ]);
  assert.deepEqual(await storage.list('ANDERE-MAP'), [], 'geen mappen in het contract');
  assert.equal((await storage.versions('DOC-1')).length, 2);
  const zonder = opslagUitSiteHost({ open: host.open, save: host.save }).storage;
  assert.deepEqual(await zonder.list(), []);
  assert.deepEqual(await zonder.versions('DOC-1'), []);
});

// ── De brug uit de hash als openaecHost ─────────────────────────────────────
function nepBrug({ opslaanAls = true } = {}) {
  const log = [];
  const opslag = {
    async open(id, versie) {
      log.push(['open', id, versie]);
      return { name: 'plan.pdf', data: PDF, versie: versie ?? 5, alleenLezen: versie !== undefined, bestand: String(id) };
    },
    async save(id, bytes) {
      log.push(['save', id, bytes.byteLength]);
      return { bestand: id, naam: 'plan.pdf', versie: 6, conflict: false, melding: null, vergrendeld: null };
    },
    async list() { return [{ id: 'M', name: 'Map', kind: 'folder' }, { id: 'DOC-1', name: 'plan.pdf', modified: 'x', kind: 'file' }]; },
    async versions(id) { log.push(['versions', id]); return [{ version: '5' }]; },
  };
  if (opslaanAls) opslag.saveAs = async (bytes, { name }) => { log.push(['saveAs', name]); return { id: 'N1', name, version: 1, renamed: false }; };
  return { opslag, log };
}

test('siteHostUitBrug: het contract over de brug van de app', async () => {
  const brug = nepBrug();
  const host = siteHostUitBrug(brug, { bestand: 'DOC-1', taal: 'nl', thema: 'light' });
  assert.equal(isSiteHost(host), true);
  assert.equal(host.initialFileId, 'DOC-1');
  assert.equal(host.taal, 'nl');
  assert.equal(host.thema, 'light');
  assert.deepEqual(await host.open('DOC-1'), { id: 'DOC-1', name: 'plan.pdf', version: 5, readOnly: false, bytes: PDF });
  assert.equal((await host.open('DOC-1', 2)).readOnly, true);
  assert.deepEqual(await host.save(PDF, { id: 'DOC-1' }), { id: 'DOC-1', name: 'plan.pdf', version: 6 });
  assert.deepEqual(await host.save(PDF, { name: 'kopie.pdf' }), { id: 'N1', name: 'kopie.pdf', version: 1 });
  assert.deepEqual(await host.list(), [{ id: 'DOC-1', name: 'plan.pdf', modified: 'x' }], 'alleen bestanden');
  assert.deepEqual(await host.versions('DOC-1'), [{ version: '5' }]);
  await assert.rejects(host.save(PDF, {}), (e) => e.code === 'ongeldige_argumenten');
  const zonderOpslaanAls = siteHostUitBrug(nepBrug({ opslaanAls: false }));
  await assert.rejects(zonderOpslaanAls.save(PDF, { name: 'x.pdf' }), (e) => e.code === 'niet_ondersteund');
  assert.equal(zonderOpslaanAls.initialFileId, undefined);
});

test('voorkeuren uit de hash: alleen een taalcode en light/dark', () => {
  assert.deepEqual(voorkeurenUitHash('#ouder=x&taal=de&thema=dark'), { taal: 'de', thema: 'dark' });
  assert.deepEqual(voorkeurenUitHash('#taal=<script>&thema=paars'), {});
  assert.deepEqual(voorkeurenUitHash(undefined), {});
});

// ── De keuze bij de start ───────────────────────────────────────────────────
function nepVenster(extra = {}) {
  const luisteraars = new Map();
  return {
    location: { hash: '' },
    addEventListener(soort, f) { if (!luisteraars.has(soort)) luisteraars.set(soort, new Set()); luisteraars.get(soort).add(f); },
    removeEventListener(soort, f) { luisteraars.get(soort)?.delete(f); },
    stuur(soort) { for (const f of [...(luisteraars.get(soort) || [])]) f({ type: soort }); },
    aantal(soort) { return luisteraars.get(soort)?.size ?? 0; },
    ...extra,
  };
}

test('koppelHost: een __OPDS_HOST__ van de gastpagina wint, de brug start dan niet', () => {
  const eigen = { storage: { open() {}, save() {} } };
  const venster = nepVenster({ __OPDS_HOST__: eigen, openaecHost: nepHost() });
  let brugGestart = false;
  assert.deepEqual(koppelHost({ venster, installeerBrug: () => { brugGestart = true; return {}; } }), { soort: 'gast' });
  assert.equal(venster.__OPDS_HOST__, eigen);
  assert.equal(brugGestart, false);
});

test('koppelHost: een openaecHost van de SuperCloud wordt het opslagcontract, zonder brug', async () => {
  const host = nepHost();
  const venster = nepVenster({ openaecHost: host });
  let brugGestart = false;
  assert.deepEqual(koppelHost({ venster, installeerBrug: () => { brugGestart = true; return {}; } }), { soort: 'site' });
  assert.equal(brugGestart, false);
  assert.equal(venster.__OPDS_HOST__.document, 'DOC-1');
  await venster.__OPDS_HOST__.storage.save('DOC-1', PDF);
  assert.equal(host.log.at(-1)[0], 'save');
  assert.equal(venster.openaecHost, host, 'het object van de SuperCloud blijft');
});

test('koppelHost: de brug uit de hash zet ook window.openaecHost neer', () => {
  const brug = nepBrug();
  const venster = nepVenster({ location: { hash: '#ouder=https://x.example&taal=fr' } });
  const uit = koppelHost({
    venster,
    installeerBrug: () => { venster.__OPDS_HOST__ = { storage: brug.opslag, document: 'DOC-9' }; return brug; },
  });
  assert.equal(uit.soort, 'brug');
  assert.equal(uit.brug, brug);
  assert.equal(isSiteHost(venster.openaecHost), true);
  assert.equal(venster.openaecHost.initialFileId, 'DOC-9');
  assert.equal(venster.openaecHost.taal, 'fr');
});

test('koppelHost: zonder host wachten op openaec-host-ready; dan openen, één keer', async () => {
  const venster = nepVenster();
  let laat = 0;
  assert.deepEqual(koppelHost({ venster, installeerBrug: () => null, bijLaat: () => { laat++; } }), { soort: 'wacht' });
  assert.equal(venster.__OPDS_HOST__, undefined);
  // Een event zonder (geldig) object verandert niets.
  venster.stuur(HOST_KLAAR_EVENT);
  assert.equal(laat, 0);
  venster.openaecHost = nepHost({ initialFileId: 'LAAT-1' });
  venster.stuur(HOST_KLAAR_EVENT);
  assert.equal(laat, 1);
  assert.equal(venster.__OPDS_HOST__.document, 'LAAT-1');
  assert.equal(venster.aantal(HOST_KLAAR_EVENT), 0, 'niet meer luisteren');
  venster.stuur(HOST_KLAAR_EVENT);
  assert.equal(laat, 1);
  const doc = await venster.__OPDS_HOST__.storage.open('LAAT-1');
  assert.equal(doc.name, 'LAAT-1.pdf');
  assert.deepEqual(koppelHost({ venster: null }), { soort: null });
});
