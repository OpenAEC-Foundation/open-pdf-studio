// De brug naar de gastpagina (#694): oorsprong uit de hash, strikt filteren
// op venster en oorsprong, de handdruk en de time-outs met een nepklok, en
// verzoek en antwoord bij elkaar houden.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGeldigeOorsprong, leesBrugHash, brugGegevens, maakHostBrug, installeerHostBrug,
  BrugFout, WERKPLEK, HALLO_INTERVAL_MS, HALLO_OPGEVEN_MS, VERZOEK_TIMEOUT_MS,
  normaliseerOpslaan, opslaanMelding, AI_FOUTCODES,
  HOST_FOUTCODES, hostFoutSleutel, hostFoutMelding, versieVoorOpen,
  normaliseerOpslaanAlsAntwoord,
} from './host-brug.js';
import { foutSoort } from './host-opslaan-als.js';

const OUDER = 'https://cloud.example.org';

// ── Nepklok ────────────────────────────────────────────────────────────────
function nepKlok() {
  let nu = 0;
  let volgnummer = 0;
  const timers = new Map(); // id -> { op, elke, f }
  const klok = {
    setTimeout(f, ms) { const id = ++volgnummer; timers.set(id, { op: nu + ms, elke: null, f }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(f, ms) { const id = ++volgnummer; timers.set(id, { op: nu + ms, elke: ms, f }); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  return {
    klok,
    get nu() { return nu; },
    get aantal() { return timers.size; },
    /** Laat `ms` verstrijken en vuur alles wat in die tijd afloopt, op volgorde. */
    vooruit(ms) {
      const eind = nu + ms;
      for (;;) {
        let eerst = null;
        for (const [id, t] of timers) if (t.op <= eind && (!eerst || t.op < eerst[1].op)) eerst = [id, t];
        if (!eerst) break;
        const [id, t] = eerst;
        nu = t.op;
        if (t.elke) t.op += t.elke; else timers.delete(id);
        t.f();
      }
      nu = eind;
    },
  };
}

// ── Nepvensters ────────────────────────────────────────────────────────────
function nepOuder() {
  const verzonden = [];
  return {
    verzonden,
    postMessage(bericht, doel, overdracht) { verzonden.push({ bericht, doel, overdracht }); },
    soorten() { return verzonden.map((v) => v.bericht.soort); },
    laatste(soort) { return [...verzonden].reverse().find((v) => v.bericht.soort === soort); },
  };
}

function nepVenster({ hash = `#ouder=${encodeURIComponent(OUDER)}&app=pdf&bestand=DOC-1`, voorouders, ouder = nepOuder() } = {}) {
  const luisteraars = new Set();
  const venster = {
    parent: ouder,
    location: { hash, ...(voorouders ? { ancestorOrigins: voorouders } : {}) },
    addEventListener(soort, f) { if (soort === 'message') luisteraars.add(f); },
    removeEventListener(soort, f) { if (soort === 'message') luisteraars.delete(f); },
    /** Een bericht dat bij dit venster aankomt. */
    ontvang(data, { origin = OUDER, source = ouder } = {}) {
      for (const f of luisteraars) f({ data, origin, source });
    },
    get luisteraars() { return luisteraars.size; },
  };
  return venster;
}

const ok = (antwoord, waarde) => ({ werkplek: WERKPLEK, antwoord, ok: true, waarde });
const mis = (antwoord, fout, code) => ({ werkplek: WERKPLEK, antwoord, ok: false, fout, ...(code !== undefined ? { code } : {}) });
const rust = () => new Promise((r) => setImmediate(r));

/** Brug in een nepvenster, met de handdruk al beantwoord. */
async function verbondenBrug(opties = {}) {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok, ...opties });
  brug.start();
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id));
  await brug.verbinding;
  return { brug, venster, tijd, ouder: venster.parent };
}

// ── Ouder ──────────────────────────────────────────────────────────────────
test('ouder is alleen een kale oorsprong scheme://host[:poort]', () => {
  for (const goed of ['https://cloud.example.org', 'http://127.0.0.1:3602', 'http://localhost:8080', 'https://[::1]:4443']) {
    assert.equal(isGeldigeOorsprong(goed), true, goed);
  }
  for (const fout of [
    '', null, undefined, 'cloud.example.org', 'https://cloud.example.org/', 'https://cloud.example.org/pad',
    'https://cloud.example.org?x=1', 'https://cloud.example.org#x', 'https://user:pw@cloud.example.org',
    'HTTPS://Cloud.Example.org', 'https://cloud.example.org:443', 'javascript:alert(1)', 'file:///c:/x',
    'data:text/html,x', 'null', '*', 'ftp://cloud.example.org', ' https://cloud.example.org',
  ]) {
    assert.equal(isGeldigeOorsprong(fout), false, String(fout));
  }
});

test('de hash levert ouder en bestand; zonder geldige ouder of voor een ander gereedschap niets', () => {
  assert.deepEqual(
    leesBrugHash(`#ouder=${encodeURIComponent(OUDER)}&app=pdf&bestand=Drawing%2F01`),
    { ouder: OUDER, bestand: 'Drawing/01' },
  );
  assert.deepEqual(leesBrugHash(`#ouder=${OUDER}`), { ouder: OUDER, bestand: null }, 'bestand is optioneel');
  assert.equal(leesBrugHash('#app=pdf&bestand=1'), null);
  assert.equal(leesBrugHash('#ouder=https%3A%2F%2Fcloud.example.org%2F&bestand=1'), null, 'met pad');
  assert.equal(leesBrugHash(`#ouder=${OUDER}&app=cad&bestand=1`), null, 'ander gereedschap');
  assert.equal(leesBrugHash(''), null);
  assert.equal(leesBrugHash(undefined), null);
});

test('alleen in een iframe, en waar de browser het weet moet de pagina erboven ouder zijn', () => {
  assert.deepEqual(brugGegevens(nepVenster()), { ouder: OUDER, bestand: 'DOC-1' });
  assert.deepEqual(brugGegevens(nepVenster({ voorouders: [OUDER, 'https://ander.example'] })), { ouder: OUDER, bestand: 'DOC-1' });
  assert.equal(brugGegevens(nepVenster({ voorouders: ['https://kwaad.example'] })), null, 'andere pagina erboven');
  assert.equal(brugGegevens(nepVenster({ voorouders: [] })), null, 'geen pagina erboven');
  assert.equal(brugGegevens(nepVenster({ voorouders: ['null'] })), null, 'verborgen oorsprong');

  const bovenaan = nepVenster();
  bovenaan.parent = bovenaan;
  assert.equal(brugGegevens(bovenaan), null, 'geen iframe: gewone browsermodus');
  assert.equal(brugGegevens(nepVenster({ hash: '' })), null, 'geen hash');
});

test('installeren: zet het contract neer en begint de handdruk; een bestaand contract wint', () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = installeerHostBrug({ venster, klok: tijd.klok });
  assert.ok(brug);
  assert.equal(venster.__OPDS_HOST__.document, 'DOC-1');
  for (const f of ['open', 'save', 'list', 'versions']) assert.equal(typeof venster.__OPDS_HOST__.storage[f], 'function', f);
  assert.equal(typeof venster.__OPDS_HOST__.ai.vraag, 'function', 'ai.vraag');
  assert.equal(typeof venster.__OPDS_HOST__.geopend, 'function', 'geopend');
  assert.equal(typeof venster.__OPDS_HOST__.melding, 'function', 'melding');
  assert.deepEqual(venster.parent.soorten(), ['hallo']);
  assert.equal(venster.parent.verzonden[0].doel, OUDER, 'alleen naar ouder');
  brug.stop();

  const eigen = { storage: { open() {}, save() {} } };
  const metContract = nepVenster();
  metContract.__OPDS_HOST__ = eigen;
  assert.equal(installeerHostBrug({ venster: metContract, klok: tijd.klok }), null);
  assert.equal(metContract.__OPDS_HOST__, eigen, 'het contract van de gastpagina blijft');
  assert.equal(metContract.parent.verzonden.length, 0, 'en er gaat niets naar buiten');

  const zonderOuder = nepVenster({ hash: '#bestand=1' });
  assert.equal(installeerHostBrug({ venster: zonderOuder, klok: tijd.klok }), null);
  assert.equal(zonderOuder.__OPDS_HOST__, undefined);
});

// ── Handdruk ───────────────────────────────────────────────────────────────
test('handdruk: hallo elke 250 ms tot de gastpagina antwoordt, daarna niet meer', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  assert.equal(HALLO_INTERVAL_MS, 250);
  assert.equal(venster.parent.verzonden.length, 1, 'meteen de eerste');
  tijd.vooruit(1000);
  assert.equal(venster.parent.verzonden.length, 5, 'en dan elke 250 ms');
  const berichten = venster.parent.verzonden.map((v) => v.bericht);
  assert.ok(berichten.every((b) => b.werkplek === 1 && b.soort === 'hallo' && typeof b.id === 'number'));
  assert.equal(new Set(berichten.map((b) => b.id)).size, 5, 'elk met een eigen id');

  // De gastpagina laadt later en beantwoordt een eerdere hallo: ook goed.
  venster.ontvang(ok(berichten[2].id));
  await brug.verbinding;
  assert.equal(brug.toestand, 'verbonden');
  tijd.vooruit(5000);
  assert.equal(venster.parent.verzonden.length, 5, 'na het antwoord geen hallo meer');
  assert.equal(tijd.aantal, 0, 'geen timers meer');
});

test('handdruk: na 60 s zonder antwoord opgeven, met één melding; verzoeken falen dan meteen', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const meldingen = [];
  const brug = maakHostBrug({
    ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok,
    bijGeenContact: (f) => meldingen.push(f.code),
    vertaal: (s) => `vertaald:${s}`,
  });
  brug.start();
  const open = brug.opslag.open('DOC-1'); // wacht op de handdruk
  tijd.vooruit(HALLO_OPGEVEN_MS - 1);
  assert.equal(brug.toestand, 'wacht');
  assert.equal(meldingen.length, 0);
  tijd.vooruit(1);
  assert.equal(brug.toestand, 'opgegeven');
  assert.deepEqual(meldingen, ['geen-contact']);
  await assert.rejects(brug.verbinding, (e) => e instanceof BrugFout && e.code === 'geen-contact');
  await assert.rejects(open, (e) => {
    assert.equal(e.code, 'geen-contact');
    assert.equal(e.gemeld, true, 'de melding is er al: niet nog eens tonen');
    return true;
  });
  const hallos = venster.parent.verzonden.length;
  assert.equal(hallos, HALLO_OPGEVEN_MS / HALLO_INTERVAL_MS + 1);
  tijd.vooruit(10_000);
  assert.equal(venster.parent.verzonden.length, hallos, 'geen hallo meer na opgeven');
  // Een laat antwoord verandert niets meer.
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id));
  assert.equal(brug.toestand, 'opgegeven');
  await assert.rejects(brug.opslag.list(), (e) => e.code === 'geen-contact');
  assert.equal(venster.parent.verzonden.length, hallos, 'een verzoek na opgeven gaat niet naar buiten');
});

test('handdruk: een weigering van de gastpagina stopt meteen', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  venster.ontvang(mis(venster.parent.verzonden[0].bericht.id, 'Not allowed'));
  await assert.rejects(brug.verbinding, (e) => e.code === 'geweigerd' && e.message === 'Not allowed');
  tijd.vooruit(1000);
  assert.equal(venster.parent.verzonden.length, 1);
});

// ── Strikt filteren ────────────────────────────────────────────────────────
test('berichten van een andere oorsprong of een ander venster tellen niet', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  const halloId = venster.parent.verzonden[0].bericht.id;
  const anderVenster = nepOuder();

  venster.ontvang(ok(halloId), { origin: 'https://kwaad.example' });
  venster.ontvang(ok(halloId), { origin: 'https://cloud.example.org.kwaad.example' });
  venster.ontvang(ok(halloId), { origin: 'http://cloud.example.org' });
  venster.ontvang(ok(halloId), { origin: 'null' });
  venster.ontvang(ok(halloId), { source: anderVenster });   // juiste oorsprong, ander venster
  venster.ontvang(ok(halloId), { source: null });
  venster.ontvang(ok(halloId), { source: venster });        // van onszelf
  venster.ontvang({ ...ok(halloId), werkplek: 2 });
  venster.ontvang({ antwoord: halloId, ok: true });          // zonder werkplek
  venster.ontvang({ ...ok(halloId), antwoord: String(halloId) });
  venster.ontvang(`{"werkplek":1,"antwoord":${halloId},"ok":true}`);
  venster.ontvang(null);
  assert.equal(brug.toestand, 'wacht', 'niets daarvan telt als antwoord');

  venster.ontvang(ok(halloId));
  await brug.verbinding;

  // Ook na de handdruk: een vervalst antwoord op een lopend verzoek telt niet.
  const lijst = brug.opslag.list();
  await rust();
  const id = venster.parent.laatste('lijst').bericht.id;
  venster.ontvang(ok(id, [{ id: 'VERVALST', name: 'x.pdf' }]), { origin: 'https://kwaad.example' });
  venster.ontvang(ok(id, [{ id: 'VERVALST', name: 'x.pdf' }]), { source: anderVenster });
  venster.ontvang(ok(id, [{ id: 'ECHT', name: 'a.pdf' }]));
  assert.deepEqual(await lijst, [{ id: 'ECHT', name: 'a.pdf' }]);
  brug.stop();
  assert.equal(venster.luisteraars, 0, 'na stoppen luistert hij niet meer');
});

// ── Verzoek en antwoord ────────────────────────────────────────────────────
test('verzoek en antwoord: volgorde, fouten, onbekende ids en dubbele antwoorden', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const a = brug.verzoek('lijst');
  const b = brug.verzoek('versies', { bestand: 'B' });
  const c = brug.verzoek('versies', { bestand: 'C' });
  await rust();
  const [va, vb, vc] = ouder.verzonden.slice(-3).map((v) => v.bericht);
  assert.deepEqual(vb, { bestand: 'B', werkplek: 1, id: vb.id, soort: 'versies' });
  assert.equal(new Set([va.id, vb.id, vc.id]).size, 3);

  venster.ontvang(ok(9999, 'onbekend'));          // geen verzoek met dit id
  venster.ontvang(mis(vc.id, 'No access'));
  venster.ontvang(ok(vb.id, ['B1']));
  venster.ontvang(ok(vb.id, ['B2']));              // tweede antwoord: genegeerd
  venster.ontvang(ok(va.id, ['A']));
  assert.deepEqual(await a, ['A']);
  assert.deepEqual(await b, ['B1']);
  await assert.rejects(c, (e) => e instanceof BrugFout && e.code === 'host' && e.message === 'No access');
  assert.ok(ouder.verzonden.every((v) => v.doel === OUDER), 'alles alleen naar ouder');

  // Velden overschrijven werkplek, id en soort niet.
  brug.verzoek('lijst', { werkplek: 7, id: 'x', soort: 'kwaad' });
  await rust();
  const laatst = ouder.verzonden.at(-1).bericht;
  assert.equal(laatst.werkplek, 1);
  assert.equal(laatst.soort, 'lijst');
  assert.equal(typeof laatst.id, 'number');
});

test('elk verzoek geeft na 120 s op; een laat antwoord doet dan niets meer', async () => {
  const { brug, venster, tijd, ouder } = await verbondenBrug();
  const lijst = brug.opslag.list();
  await rust();
  const id = ouder.laatste('lijst').bericht.id;
  tijd.vooruit(VERZOEK_TIMEOUT_MS - 1);
  let klaar = false;
  lijst.then(() => { klaar = true; }, () => { klaar = true; });
  await rust();
  assert.equal(klaar, false, 'nog niet opgegeven');
  tijd.vooruit(1);
  await assert.rejects(lijst, (e) => e.code === 'time-out');
  venster.ontvang(ok(id, [{ id: 'laat' }]));
  assert.equal(tijd.aantal, 0);
});

// ── De soorten van de werkplek (#704) ─────────────────────────────────────
const pdfBytes = () => Uint8Array.from([37, 80, 68, 70, 45]).buffer;

test('open: de bytes komen in het antwoord (overgedragen ArrayBuffer); de app haalt niets op', async () => {
  const opgehaald = [];
  const echteFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => { opgehaald.push(a); throw new Error('mag niet'); };
  try {
    const { brug, venster, ouder } = await verbondenBrug();
    const open = brug.opslag.open('DOC-1');
    await rust();
    const v = ouder.laatste('open').bericht;
    assert.deepEqual(v, { bestand: 'DOC-1', werkplek: 1, id: v.id, soort: 'open' });
    const bytes = pdfBytes();
    venster.ontvang(ok(v.id, { bestand: 'DOC-1', naam: 'Plattegrond.pdf', versie: 4, alleen_lezen: false, bytes }));
    const uit = await open;
    assert.equal(uit.name, 'Plattegrond.pdf');
    assert.ok(uit.data instanceof Uint8Array);
    assert.deepEqual([...uit.data], [37, 80, 68, 70, 45]);
    assert.equal(uit.data.buffer, bytes, 'de overgedragen buffer zelf, niet gekopieerd');
    assert.equal(uit.versie, 4);
    assert.equal(uit.alleenLezen, false);
    assert.equal(uit.bestand, 'DOC-1');

    const alleenLezen = brug.opslag.open('DOC-2');
    await rust();
    venster.ontvang(ok(ouder.laatste('open').bericht.id, { bestand: 'DOC-2', naam: 'B.pdf', versie: 1, alleen_lezen: true, bytes: pdfBytes() }));
    assert.equal((await alleenLezen).alleenLezen, true, 'alleen_lezen gaat door naar de app');
    assert.equal(opgehaald.length, 0, 'geen enkele fetch');
  } finally {
    globalThis.fetch = echteFetch;
  }
});

test('open: elke mislukking draagt de vertaalde melding voor de gebruiker', async () => {
  const gevallen = [
    ['de gastpagina weigert', (v, venster) => venster.ontvang(mis(v.id, 'Forbidden'))],
    ['geen bytes', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf' }))],
    ['alleen een adres (oud protocol)', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf', adres: 'https://opslag.example/t/abc' }))],
    ['bytes als tekst', (v, venster) => venster.ontvang(ok(v.id, { naam: 'a.pdf', bytes: '%PDF-' }))],
    ['geen object', (v, venster) => venster.ontvang(ok(v.id, null))],
  ];
  for (const [naam, antwoord] of gevallen) {
    const { brug, venster, ouder } = await verbondenBrug({ vertaal: (s) => `vertaald:${s}` });
    const open = brug.opslag.open('DOC-1');
    await rust();
    antwoord(ouder.laatste('open').bericht, venster);
    await assert.rejects(open, (e) => {
      assert.equal(e.gebruikersMelding, 'vertaald:hostOpenFailed', naam);
      return true;
    }, naam);
  }
  // Zonder vertaling: de Engelse tekst uit het issue.
  const { brug, tijd } = await verbondenBrug();
  const open = brug.opslag.open('DOC-1');
  await rust();
  tijd.vooruit(VERZOEK_TIMEOUT_MS);
  await assert.rejects(open, (e) => e.code === 'time-out'
    && e.gebruikersMelding === 'The file could not be read from storage. Try again.');
});

test('open met versie (#712): het nummer als getal, altijd alleen-lezen; versie_ongeldig krijgt zijn eigen melding', async () => {
  const { brug, venster, ouder } = await verbondenBrug({ vertaal: (s, o) => (s === 'hostOpenFailed' ? 'kon niet' : `vertaald:${s}|${o?.defaultValue ?? ''}`) });
  const open = brug.opslag.open('DOC-1', '3');
  await rust();
  const v = ouder.laatste('open').bericht;
  assert.deepEqual(v, { bestand: 'DOC-1', versie: 3, werkplek: 1, id: v.id, soort: 'open' });
  // Ook als de gastpagina alleen_lezen vergeet: een oudere versie is alleen-lezen.
  venster.ontvang(ok(v.id, { bestand: 'DOC-1', naam: 'P.pdf', versie: 3, bytes: pdfBytes() }));
  const uit = await open;
  assert.equal(uit.alleenLezen, true);
  assert.equal(uit.versie, 3);

  // Een ongeldig nummer: de gastpagina weigert met versie_ongeldig.
  const ongeldig = brug.opslag.open('DOC-1', 0);
  await rust();
  const v2 = ouder.laatste('open').bericht;
  assert.equal(v2.versie, 0);
  venster.ontvang(mis(v2.id, 'Ongeldig versienummer.', 'versie_ongeldig'));
  await assert.rejects(ongeldig, (e) => e.hostCode === 'versie_ongeldig'
    && e.gebruikersMelding === 'vertaald:hostVersionInvalid|Ongeldig versienummer.');

  // Een versie die niet bestaat: een gewone fout, de gewone melding.
  const weg = brug.opslag.open('DOC-1', 99);
  await rust();
  venster.ontvang(mis(ouder.laatste('open').bericht.id, 'Geen toegang.'));
  await assert.rejects(weg, (e) => e.gebruikersMelding === 'kon niet');

  // Zonder versie: geen veld versie in het bericht.
  const gewoon = brug.opslag.open('DOC-1');
  await rust();
  assert.equal('versie' in ouder.laatste('open').bericht, false);
  venster.ontvang(ok(ouder.laatste('open').bericht.id, { naam: 'P.pdf', versie: 5, alleen_lezen: false, bytes: pdfBytes() }));
  assert.equal((await gewoon).alleenLezen, false);
});

test('opslaan na een oudere versie: versie_alleen_lezen komt als hostCode mee', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const opslaan = brug.opslag.save('DOC-1', new Uint8Array([1, 2]));
  await rust();
  venster.ontvang(mis(ouder.laatste('opslaan').bericht.id, 'Versie 2 is alleen-lezen geopend.', 'versie_alleen_lezen'));
  await assert.rejects(opslaan, (e) => e instanceof BrugFout && e.hostCode === 'versie_alleen_lezen');
});

test('foutcodes van de gastpagina: vertaald, met de tekst van de gastpagina als terugval', () => {
  assert.deepEqual(Object.keys(HOST_FOUTCODES).sort(), ['versie_alleen_lezen', 'versie_ongeldig']);
  const fout = new BrugFout('host', 'Tekst van de site', 'versie_alleen_lezen');
  assert.equal(hostFoutSleutel(fout), 'hostVersionReadOnlyRefused');
  assert.equal(hostFoutSleutel(new BrugFout('host', 'x', 'geen_tegoed')), null);
  assert.equal(hostFoutSleutel(new Error('x')), null);
  assert.equal(hostFoutMelding(fout, (s) => `[${s}]`), '[hostVersionReadOnlyRefused]');
  // Zonder vertaling (i18next geeft de sleutel of defaultValue terug): de tekst van de site.
  assert.equal(hostFoutMelding(fout, (s, o) => o.defaultValue), 'Tekst van de site');
  assert.equal(hostFoutMelding(fout, (s) => s), 'Tekst van de site');
  assert.equal(hostFoutMelding(new BrugFout('host', 'x', 'onbekend'), (s) => s), null);
  assert.equal(versieVoorOpen('3'), 3);
  assert.equal(versieVoorOpen(2), 2);
  assert.equal(versieVoorOpen('2.5'), '2.5', 'de gastpagina weigert het zelf');
});

test('opslaan: een eigen kopie van de bytes gaat als transferable mee; het antwoord in vaste vorm', async () => {
  const uitkomsten = [];
  const { brug, venster, ouder } = await verbondenBrug({ bijOpslaan: (u) => uitkomsten.push(u) });
  const groot = Uint8Array.from([0, 0, 1, 2, 3, 0]);
  const bytes = groot.subarray(2, 5); // een venster op een grotere buffer
  const opslaan = brug.opslag.save('DOC-1', bytes, { name: 'a.pdf' });
  await rust();
  const { bericht, overdracht, doel } = ouder.laatste('opslaan');
  assert.equal(doel, OUDER);
  assert.equal(bericht.bestand, 'DOC-1');
  assert.ok(bericht.bytes instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(bericht.bytes)], [1, 2, 3], 'precies de bytes, niet de hele buffer');
  assert.deepEqual(overdracht, [bericht.bytes]);
  assert.notEqual(bericht.bytes, groot.buffer, 'de buffer van de app zelf blijft van de app');
  assert.deepEqual(Object.keys(bericht).sort(), ['bestand', 'bytes', 'id', 'soort', 'werkplek']);
  venster.ontvang(ok(bericht.id, { bestand: 'DOC-1', naam: 'a.pdf', versie: 3, conflict: false, melding: null, vergrendeld: true }));
  const verwacht = { bestand: 'DOC-1', naam: 'a.pdf', versie: 3, conflict: false, melding: null, vergrendeld: true };
  assert.deepEqual(await opslaan, verwacht);
  assert.deepEqual(uitkomsten, [verwacht], 'de koppeling hoort de uitkomst');
});

test('opslaan: een conflict komt bij de koppeling, met de naam van de kopie', async () => {
  const uitkomsten = [];
  const { brug, venster, ouder } = await verbondenBrug({ bijOpslaan: (u) => uitkomsten.push(u) });
  const opslaan = brug.opslag.save('DOC-1', Uint8Array.from([1]));
  await rust();
  venster.ontvang(ok(ouder.laatste('opslaan').bericht.id, {
    bestand: 'DOC-9', naam: 'Plattegrond (conflict).pdf', versie: 1, conflict: true,
    melding: 'Iemand anders sloeg dit bestand intussen op.', vergrendeld: false,
  }));
  const uit = await opslaan;
  assert.equal(uit.conflict, true);
  assert.equal(uit.naam, 'Plattegrond (conflict).pdf');
  assert.equal(uit.vergrendeld, false);
  assert.equal(uitkomsten.length, 1);
});

test('opslaan: een weigering van de gastpagina is een fout (het document blijft gewijzigd)', async () => {
  const uitkomsten = [];
  const { brug, venster, ouder } = await verbondenBrug({ bijOpslaan: (u) => uitkomsten.push(u) });
  const opslaan = brug.opslag.save('DOC-1', Uint8Array.from([1]));
  await rust();
  venster.ontvang(mis(ouder.laatste('opslaan').bericht.id, 'Dit bestand is alleen-lezen geopend.'));
  await assert.rejects(opslaan, (e) => e.code === 'host' && e.message === 'Dit bestand is alleen-lezen geopend.');
  assert.equal(uitkomsten.length, 0);
});

test('normaliseerOpslaan: vaste velden, ook bij een onvolledig antwoord', () => {
  assert.deepEqual(normaliseerOpslaan(null), {
    bestand: null, naam: null, versie: null, conflict: false, melding: null, vergrendeld: null,
  });
  assert.deepEqual(normaliseerOpslaan({ bestand: 7, naam: 'a.pdf', versie: 2, conflict: 'ja', melding: '  ', vergrendeld: 0 }), {
    bestand: '7', naam: 'a.pdf', versie: 2, conflict: false, melding: null, vergrendeld: null,
  });
});

test('opslaanMelding: conflict, niet vastgezet (één keer per bestand) en de melding van de gastpagina', () => {
  const t = (s, o) => (o ? `${s}(${o.name})` : s);
  const gemeld = new Set();
  const gewoon = normaliseerOpslaan({ bestand: 'A', naam: 'a.pdf', versie: 2, conflict: false, vergrendeld: true });
  assert.equal(opslaanMelding(gewoon, t, gemeld), null, 'een gewone opslag: niets te melden');
  const conflict = normaliseerOpslaan({ bestand: 'B', naam: 'a (kopie).pdf', versie: 1, conflict: true, melding: 'Server zegt kopie.', vergrendeld: false });
  assert.equal(opslaanMelding(conflict, t, gemeld), 'hostSaveConflict(a (kopie).pdf)\n\nhostSaveNotLocked\n\nServer zegt kopie.');
  assert.equal(opslaanMelding(conflict, t, gemeld), 'hostSaveConflict(a (kopie).pdf)\n\nServer zegt kopie.', 'niet vastgezet maar één keer');
  assert.equal(opslaanMelding(normaliseerOpslaan({ bestand: 'A', melding: 'Let op.' }), t, gemeld), 'Let op.');
  assert.equal(opslaanMelding(null, t), null);
});

test('geopend en melding: velden zoals de gastpagina ze leest', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const geopend = brug.geopend('DOC-1');
  await rust();
  const g = ouder.laatste('geopend').bericht;
  assert.deepEqual(g, { bestand: 'DOC-1', werkplek: 1, id: g.id, soort: 'geopend' });
  venster.ontvang(ok(g.id, true));
  assert.equal(await geopend, true);

  const melding = brug.melding('Kon niet openen', 'waarschuwing');
  await rust();
  const m = ouder.laatste('melding').bericht;
  assert.deepEqual(m, { tekst: 'Kon niet openen', toon: 'waarschuwing', werkplek: 1, id: m.id, soort: 'melding' });
  venster.ontvang(ok(m.id, true));
  assert.equal(await melding, true);

  const onbekendeToon = brug.melding('x', 'paars');
  await rust();
  assert.equal(ouder.laatste('melding').bericht.toon, 'fout', 'een onbekende toon wordt fout (de standaard)');
  venster.ontvang(ok(ouder.laatste('melding').bericht.id, true));
  await onbekendeToon;
  const aantal = ouder.verzonden.length;
  assert.equal(await brug.melding('   '), false, 'een lege melding gaat niet naar buiten');
  assert.equal(ouder.verzonden.length, aantal);
});

test('ai.vraag: de vraag in OpenAI-chatvorm; het bericht komt ongewijzigd terug', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const vraag = { messages: [{ role: 'system', content: 'Je bent behulpzaam.' }, { role: 'user', content: 'Hoi' }], max_tokens: 50 };
  const antwoord = brug.ai.vraag(vraag);
  await rust();
  const v = ouder.laatste('ai.vraag').bericht;
  assert.deepEqual(v, { vraag, werkplek: 1, id: v.id, soort: 'ai.vraag' });
  const bericht = { role: 'assistant', content: 'Hallo!', openaec_denkblokken: [{ type: 'thinking', signature: 'x' }] };
  venster.ontvang(ok(v.id, { bericht, stop: 'stop', vraag_id: 'V-1' }));
  const uit = await antwoord;
  assert.deepEqual(uit, { bericht, stop: 'stop', vraag_id: 'V-1' });
  assert.equal(uit.bericht, bericht, 'hetzelfde object: ongewijzigd terug in de volgende beurt');
});

test('ai.vraag: elke foutcode van de gastpagina komt mee als hostCode', async () => {
  for (const code of AI_FOUTCODES) {
    const { brug, venster, ouder } = await verbondenBrug();
    const antwoord = brug.ai.vraag({ messages: [{ role: 'user', content: 'x' }] });
    await rust();
    venster.ontvang(mis(ouder.laatste('ai.vraag').bericht.id, `melding voor ${code}`, code));
    await assert.rejects(antwoord, (e) => e instanceof BrugFout && e.code === 'host' && e.hostCode === code && e.message === `melding voor ${code}`, code);
  }
  const { brug, venster, ouder } = await verbondenBrug();
  const zonderCode = brug.ai.vraag({ messages: [{ role: 'user', content: 'x' }] });
  await rust();
  venster.ontvang(mis(ouder.laatste('ai.vraag').bericht.id, 'kapot', null));
  await assert.rejects(zonderCode, (e) => e.hostCode === null);
  await assert.rejects(brug.ai.vraag({ prompt: 'geen messages' }), (e) => e.hostCode === 'ongeldige_vraag');
  const leeg = brug.ai.vraag({ messages: [] });
  await rust();
  venster.ontvang(ok(ouder.laatste('ai.vraag').bericht.id, { stop: 'stop' }));
  await assert.rejects(leeg, (e) => e.code === 'antwoord', 'een antwoord zonder bericht');
});

test('lijst en versies in de vorm van het contract', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const lijst = brug.opslag.list();
  await rust();
  const vl = ouder.laatste('lijst').bericht;
  assert.deepEqual(Object.keys(vl).sort(), ['id', 'soort', 'werkplek']);
  venster.ontvang(ok(vl.id, [{ id: 7, naam: 'Gevel.pdf' }, { id: 'B', name: 'B.pdf', modified: '2026-10-01 12:00:00' }, null, { naam: 'zonder id' }]));
  assert.deepEqual(await lijst, [
    { id: '7', naam: 'Gevel.pdf', name: 'Gevel.pdf' },
    { id: 'B', name: 'B.pdf', modified: '2026-10-01 12:00:00' },
  ]);

  const versies = brug.opslag.versions('DOC-1');
  await rust();
  const vv = ouder.laatste('versies').bericht;
  assert.equal(vv.bestand, 'DOC-1');
  venster.ontvang(ok(vv.id, [{ version: 2, modified: '2026-10-02', author: 'an@example.org' }, { versie: 1 }]));
  assert.deepEqual(await versies, [
    { version: '2', modified: '2026-10-02', author: 'an@example.org' },
    { versie: 1, version: '1' },
  ]);

  const leeg = brug.opslag.versions('DOC-2');
  await rust();
  venster.ontvang(ok(ouder.laatste('versies').bericht.id, null));
  assert.deepEqual(await leeg, []);
});

test('stoppen: lopende verzoeken falen, zonder melding voor de gebruiker', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const meldingen = [];
  const brug = maakHostBrug({
    ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok, bijGeenContact: () => meldingen.push(1),
  });
  brug.start();
  const lijst = brug.opslag.list();
  brug.stop();
  await assert.rejects(lijst, (e) => e.code === 'geen-contact');
  assert.equal(meldingen.length, 0);
  assert.equal(tijd.aantal, 0, 'geen timers meer');
  assert.equal(venster.luisteraars, 0);
});

// ── Opslaan als (#726) ─────────────────────────────────────────────────────

/** Brug waarvan de gastpagina bij hallo `waarde` meegeeft. */
async function brugMetHallo(waarde) {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id, waarde));
  await brug.verbinding;
  return { brug, venster, ouder: venster.parent };
}

test('opslaan als (#726): alleen als de gastpagina "opslaan_als" bij hallo noemt', async () => {
  const zonder = await brugMetHallo(undefined);
  assert.equal(typeof zonder.brug.opslag.saveAs, 'undefined', 'geen soorten: geen saveAs, Opslaan als blijft een download');
  assert.equal(zonder.brug.kent('opslaan_als'), false);
  const anders = await brugMetHallo({ soorten: ['ai.vraag'] });
  assert.equal(typeof anders.brug.opslag.saveAs, 'undefined');
  const met = await brugMetHallo({ soorten: ['opslaan_als'] });
  assert.equal(typeof met.brug.opslag.saveAs, 'function');
  assert.equal(met.brug.kent('opslaan_als'), true);

  // Via installeerHostBrug staat hij dan ook in het contract (zelfde object).
  const venster = nepVenster();
  const brug = installeerHostBrug({ venster, klok: nepKlok().klok });
  assert.equal(typeof venster.__OPDS_HOST__.storage.saveAs, 'undefined', 'vóór de handdruk nog niet');
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id, { soorten: ['opslaan_als'] }));
  await brug.verbinding;
  assert.equal(typeof venster.__OPDS_HOST__.storage.saveAs, 'function');
  brug.stop();
});

test('opslaan als: bericht opslaan_als { naam, map, bytes } met overgedragen bytes; antwoord in contractvorm', async () => {
  const { brug, venster, ouder } = await brugMetHallo({ soorten: ['opslaan_als'] });
  const bytes = Uint8Array.from([1, 2, 3]);
  const belofte = brug.opslag.saveAs(bytes, { name: 'plan (copy).pdf', folder: 'M-7' });
  await rust();
  const v = ouder.laatste('opslaan_als');
  assert.equal(v.doel, OUDER);
  assert.deepEqual(Object.keys(v.bericht).sort(), ['bytes', 'id', 'map', 'naam', 'soort', 'werkplek']);
  assert.equal(v.bericht.naam, 'plan (copy).pdf');
  assert.equal(v.bericht.map, 'M-7');
  assert.ok(v.bericht.bytes instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(v.bericht.bytes)], [1, 2, 3]);
  assert.deepEqual(v.overdracht, [v.bericht.bytes], 'de kopie wordt overgedragen');
  assert.equal(bytes.length, 3, 'de bytes van de app blijven heel');
  venster.ontvang(ok(v.bericht.id, { bestand: 'NIEUW', naam: 'plan (copy) (2).pdf', versie: 1, hernoemd: true }));
  assert.deepEqual(await belofte, { id: 'NIEUW', name: 'plan (copy) (2).pdf', version: 1, renamed: true });

  // Zonder map: geen veld `map` (de map van het geopende document).
  const tweede = brug.opslag.saveAs(Uint8Array.from([9]), { name: 'b.pdf' });
  await rust();
  const v2 = ouder.laatste('opslaan_als').bericht;
  assert.equal('map' in v2, false);
  venster.ontvang(ok(v2.id, { bestand: 'N2', naam: 'b.pdf', versie: 1 }));
  assert.deepEqual(await tweede, { id: 'N2', name: 'b.pdf', version: 1, renamed: false });
});

test('opslaan als: een weigering draagt de code van de gastpagina', async () => {
  const { brug, venster, ouder } = await brugMetHallo({ soorten: ['opslaan_als'] });
  for (const [code, soort] of [['alleen_lezen', 'alleen_lezen'], ['quotum', 'quotum'], ['te_groot', 'te_groot'], ['read_only', 'alleen_lezen']]) {
    const b = brug.opslag.saveAs(Uint8Array.from([1]), { name: 'a.pdf', folder: 'M' });
    await rust();
    venster.ontvang(mis(ouder.laatste('opslaan_als').bericht.id, 'Nope', code));
    await assert.rejects(b, (e) => e.code === 'host' && e.hostCode === code && foutSoort(e) === soort);
  }
  // Geen naam: niet eens versturen.
  const aantal = ouder.verzonden.length;
  await assert.rejects(brug.opslag.saveAs(Uint8Array.from([1]), { name: '  ' }), (e) => e.hostCode === 'ongeldige_naam');
  assert.equal(ouder.verzonden.length, aantal);
  // Een antwoord zonder bestand is geen nieuw bestand.
  const leeg = brug.opslag.saveAs(Uint8Array.from([1]), { name: 'a.pdf' });
  await rust();
  venster.ontvang(ok(ouder.laatste('opslaan_als').bericht.id, { naam: 'a.pdf' }));
  await assert.rejects(leeg, (e) => e.code === 'antwoord');
});

test('opslaan als: geen antwoord binnen de tijd is een netwerkfout', async () => {
  const tijd = nepKlok();
  const venster = nepVenster();
  const brug = maakHostBrug({ ouder: OUDER, ouderVenster: venster.parent, venster, klok: tijd.klok });
  brug.start();
  venster.ontvang(ok(venster.parent.verzonden[0].bericht.id, { soorten: ['opslaan_als'] }));
  await brug.verbinding;
  const b = brug.opslag.saveAs(Uint8Array.from([1]), { name: 'a.pdf' });
  await rust();
  tijd.vooruit(VERZOEK_TIMEOUT_MS);
  await assert.rejects(b, (e) => e.code === 'time-out' && foutSoort(e) === 'netwerk');
});

test('lijst { map } (#726): een submap, met mappen en schrijfrechten in contractvorm', async () => {
  const { brug, venster, ouder } = await verbondenBrug();
  const lijst = brug.opslag.list('M-1');
  await rust();
  const vl = ouder.laatste('lijst').bericht;
  assert.equal(vl.map, 'M-1');
  venster.ontvang(ok(vl.id, [
    { id: 'S', naam: 'Sub', soort: 'map', schrijfbaar: false },
    { id: 'F', naam: 'f.pdf', soort: 'bestand' },
  ]));
  assert.deepEqual(await lijst, [
    { id: 'S', naam: 'Sub', soort: 'map', schrijfbaar: false, name: 'Sub', kind: 'folder', writable: false },
    { id: 'F', naam: 'f.pdf', soort: 'bestand', name: 'f.pdf', kind: 'file' },
  ]);
  // Zonder argument geen veld `map`, zoals voorheen.
  const top = brug.opslag.list();
  await rust();
  assert.equal('map' in ouder.laatste('lijst').bericht, false);
  venster.ontvang(ok(ouder.laatste('lijst').bericht.id, []));
  assert.deepEqual(await top, []);
});

test('het antwoord op opslaan_als: brug- en contractvelden', () => {
  assert.deepEqual(normaliseerOpslaanAlsAntwoord({ id: 5, name: 'a.pdf', version: 2 }, 'a.pdf'),
    { id: '5', name: 'a.pdf', version: 2, renamed: false });
  assert.equal(normaliseerOpslaanAlsAntwoord({ bestand: 'X', naam: 'a (2).pdf' }, 'a.pdf').renamed, true);
  assert.throws(() => normaliseerOpslaanAlsAntwoord(null, 'a.pdf'), (e) => e.code === 'antwoord');
});
