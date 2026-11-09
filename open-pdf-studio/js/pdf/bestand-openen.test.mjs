// Openen vanaf SharePoint/OneDrive en netwerkpaden (#1005): alleen-lezen als
// vergrendelen niet lukt, en een melding die zegt welk pad, welke stap en wat
// te doen in plaats van alleen "toegang geweigerd".
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  normaliseerOpenFout, openFoutMelding, alleenLezenMelding, leesDocument, vergrendelDocument,
  OpenBestandFout, opslaanNaarOpslaanAls, soortVanOsCode,
} from './bestand-openen.js';

const lees = (taal) => JSON.parse(fs.readFileSync(new URL(`../i18n/locales/${taal}/common.json`, import.meta.url), 'utf8'));
const en = lees('en');

// Een t() zoals i18next: geneste sleutels en {{...}}-invulling.
function maakT(bundel) {
  return (sleutel, opties = {}) => {
    let w = bundel;
    for (const deel of sleutel.split('.')) w = w?.[deel];
    if (typeof w !== 'string') return sleutel;
    return w.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opties[k] ?? ''));
  };
}
const t = maakT(en);

const PAD = String.raw`C:\Users\piet\Bouwbedrijf\Project X - Documenten\a.pdf`;

test('een fout van Rust houdt stap, soort en pad', () => {
  const f = normaliseerOpenFout({ stap: 'lezen', soort: 'alleen-online', pad: PAD, code: 5, melding: 'Access is denied. (os error 5)', plaatshouder: true, padInfo: { soort: 'lokaal', sync: 'sharepoint' } });
  assert.equal(f.stap, 'lezen');
  assert.equal(f.soort, 'alleen-online');
  assert.equal(f.pad, PAD);
  assert.equal(f.code, 5);
});

test('teksten van de fs-plugin worden ingedeeld', () => {
  assert.equal(normaliseerOpenFout('forbidden path: \\\\x@SSL\\DavWWWRoot\\a.pdf', 'p').stap, 'scope');
  assert.equal(normaliseerOpenFout('failed to open file at path: C:\\a.pdf with error: Access is denied. (os error 5)').soort, 'geweigerd');
  assert.equal(normaliseerOpenFout(new Error('The process cannot access the file because it is being used by another process. (os error 32)')).soort, 'in-gebruik');
  assert.equal(normaliseerOpenFout('The cloud file provider is not running. (os error 362)').soort, 'alleen-online');
  assert.equal(normaliseerOpenFout('The system cannot find the file specified. (os error 2)').soort, 'niet-gevonden');
  assert.equal(normaliseerOpenFout('iets anders').soort, 'anders');
});

test('Windows-codes: dezelfde indeling als in Rust', () => {
  assert.equal(soortVanOsCode(5), 'geweigerd');
  assert.equal(soortVanOsCode(5, true), 'alleen-online');
  assert.equal(soortVanOsCode(33), 'in-gebruik');
  assert.equal(soortVanOsCode(395), 'alleen-online');
  assert.equal(soortVanOsCode(376), 'anders');
  assert.equal(soortVanOsCode(53), 'netwerk');
  assert.equal(soortVanOsCode(206), 'pad-te-lang');
});

test('de melding noemt pad, stap, reden en de tekst van Windows', () => {
  const m = openFoutMelding({ stap: 'lezen', soort: 'alleen-online', pad: PAD, melding: 'Access is denied. (os error 5)' }, t);
  assert.ok(m.includes(PAD), m);
  assert.ok(m.includes(en.openFile.step.lezen), m);
  assert.ok(m.includes('Always keep on this device'), m);
  assert.ok(m.includes('Access is denied. (os error 5)'), m);
  assert.ok(!m.includes('openFile.'), `geen ontbrekende sleutel: ${m}`);
  // Geen kale "toegang geweigerd" meer: elke soort heeft een eigen uitleg.
  const soorten = ['niet-gevonden', 'geweigerd', 'in-gebruik', 'alleen-online', 'netwerk', 'pad-te-lang', 'anders'];
  const teksten = new Set(soorten.map((s) => openFoutMelding({ stap: 'lezen', soort: s, pad: PAD }, t)));
  assert.equal(teksten.size, soorten.length);
});

test('scope-fout en WebDAV-pad krijgen hun eigen uitleg', () => {
  const dav = String.raw`\\contoso.sharepoint.com@SSL\DavWWWRoot\sites\Bouw\a.pdf`;
  const m = openFoutMelding({ stap: 'scope', soort: 'geweigerd', pad: dav, padInfo: { soort: 'webdav', lang: false } }, t);
  assert.ok(m.includes(en.openFile.reason.scope), m);
  assert.ok(m.includes(en.openFile.hintWebdav), m);
  const lang = openFoutMelding({ stap: 'lezen', soort: 'geweigerd', pad: PAD, padInfo: { soort: 'lokaal', lang: true } }, t);
  assert.ok(lang.includes(en.openFile.hintLongPath), lang);
});

test('leesDocument: bytes, en een fout met de volledige melding', async () => {
  const ok = await leesDocument(PAD, { invoke: async () => new Uint8Array([37, 80]).buffer, t });
  assert.deepEqual([...ok], [37, 80]);

  await assert.rejects(
    leesDocument(PAD, { invoke: async () => { throw { stap: 'lezen', soort: 'in-gebruik', pad: PAD, code: 32, melding: 'x' }; }, t }),
    (e) => e instanceof OpenBestandFout && e.openFout.soort === 'in-gebruik' && e.message.includes(PAD),
  );
});

test('leesDocument: terugval op de fs-plugin bij een oude backend', async () => {
  let terug = 0;
  const data = await leesDocument(PAD, {
    invoke: async () => { throw 'Command read_document_file not found'; },
    leesTerugval: async () => { terug++; return new Uint8Array([1]); },
    t,
  });
  assert.equal(terug, 1);
  assert.deepEqual([...data], [1]);
  // Een gewone leesfout valt niet terug: die melding hoort bij de gebruiker.
  terug = 0;
  await assert.rejects(leesDocument(PAD, {
    invoke: async () => { throw { stap: 'lezen', soort: 'geweigerd', pad: PAD }; },
    leesTerugval: async () => { terug++; return new Uint8Array([1]); },
    t,
  }));
  assert.equal(terug, 0);
});

test('vergrendelDocument: alleen-lezen als vergrendelen niet lukt', async () => {
  const bewerkbaar = await vergrendelDocument(PAD, { invoke: async () => ({ alleenLezen: false, reden: null, fout: null }) });
  assert.deepEqual(bewerkbaar, { alleenLezen: false, reden: null, fout: null });

  const inGebruik = await vergrendelDocument(PAD, {
    invoke: async () => ({ alleenLezen: true, reden: 'in-gebruik', fout: { stap: 'vergrendelen', soort: 'in-gebruik', pad: PAD, code: 32, melding: 'x' } }),
  });
  assert.equal(inGebruik.alleenLezen, true);
  assert.equal(inGebruik.reden, 'in-gebruik');
  assert.equal(inGebruik.fout.stap, 'vergrendelen');

  // Het commando zelf faalt: liever alleen-lezen dan niet openen.
  const kapot = await vergrendelDocument(PAD, { invoke: async () => { throw 'boom'; } });
  assert.equal(kapot.alleenLezen, true);
  assert.equal(kapot.reden, 'mislukt');

  // Oude backend: vergrendelen zoals vroeger, bewerkbaar.
  let oud = 0;
  const terug = await vergrendelDocument(PAD, {
    invoke: async () => { throw 'Command lock_document_file not found'; },
    vergrendelTerugval: async () => { oud++; return true; },
  });
  assert.equal(oud, 1);
  assert.equal(terug.alleenLezen, false);
});

test('alleen-lezen melding noemt het bestand en Opslaan als', () => {
  for (const reden of ['kenmerk', 'in-gebruik', 'geweigerd', 'mislukt', 'onbekend']) {
    const m = alleenLezenMelding(reden, 'a.pdf', t);
    assert.ok(m.includes('a.pdf'), m);
    assert.ok(m.includes('Save As'), m);
    assert.ok(!m.includes('openFile.'), m);
  }
  assert.equal(opslaanNaarOpslaanAls({ bestandAlleenLezen: { reden: 'kenmerk' } }), true);
  assert.equal(opslaanNaarOpslaanAls({ bestandAlleenLezen: null }), false);
  assert.equal(opslaanNaarOpslaanAls(null), false);
});

test('elke taal heeft alle sleutels, met dezelfde invulvelden als het Engels', () => {
  const plat = (o, voor = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? plat(v, `${voor}${k}.`) : [[`${voor}${k}`, v]]));
  const velden = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const enPlat = plat({ openFile: en.openFile, fileWriteDenied: en.fileWriteDenied });
  const talen = fs.readdirSync(new URL('../i18n/locales/', import.meta.url));
  for (const taal of talen) {
    const c = lees(taal);
    const plaats = new Map(plat({ openFile: c.openFile || {}, fileWriteDenied: c.fileWriteDenied ?? '' }));
    for (const [k, v] of enPlat) {
      assert.equal(typeof plaats.get(k), 'string', `${taal}: ${k}`);
      assert.equal(velden(plaats.get(k)), velden(v), `${taal}: ${k}`);
    }
  }
  assert.match(lees('nl').openFile.readOnly.saveAs, /Opslaan als/);
});

test('de loader leest eerst en vergrendelt daarna, en de saver stuurt alleen-lezen naar Opslaan als', () => {
  const loader = fs.readFileSync(new URL('./loader.js', import.meta.url), 'utf8');
  const lezen = loader.indexOf('await leesDocument(filePath');
  const vergrendelen = loader.indexOf('await vergrendelDocument(filePath');
  assert.ok(lezen > 0 && vergrendelen > lezen, 'lezen vóór vergrendelen');
  assert.doesNotMatch(loader, /await lockFile\(filePath\)/);
  assert.match(loader, /error instanceof OpenBestandFout/);

  const saver = fs.readFileSync(new URL('./saver.js', import.meta.url), 'utf8');
  assert.match(saver, /!saveAsPath && opslaanNaarOpslaanAls\(activeDoc\)\) \{\s*return await savePDFAs\(activeDoc\);/);
  assert.match(saver, /doc\.bestandAlleenLezen = null/);
});
