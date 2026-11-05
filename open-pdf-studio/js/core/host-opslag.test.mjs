// Het opslagcontract van de gastsite in de platformlaag (#546): een document
// van de site opent via open(), Opslaan schrijft via save() terug, en wat geen
// document van de site is (een export ernaast, "Opslaan als") blijft een
// download.

import assert from 'node:assert/strict';
import test from 'node:test';

// Kale browser: geen Tauri, wel een document voor de download-terugval.
const downloads = [];
globalThis.window = {};
globalThis.document = {
  createElement: () => ({ click() {} }),
  body: { appendChild(a) { downloads.push(a.download); }, removeChild() {} },
};

const {
  hostOpslag, hostPad, leesHostPad, openHostBestand, hostDocumenten, hostVersies,
  readBinaryFile, writeBinaryFile, writeBinaryFileAtomic, saveFileDialog, fileExists,
  extractFileName, hostAi, meldHostGeopend, meldBijHost, lockFile, unlockFile,
  hostKanOpslaanAls, hostOpslaanAls,
} = await import('./platform.js');
const { koppelHost } = await import('./site-host.js');

/** Een site die documenten in het geheugen bewaart, met versies. */
function nepSite(begin = {}) {
  const docs = new Map(Object.entries(begin));
  const versies = new Map();
  const opgeslagen = [];
  return {
    docs,
    opgeslagen,
    storage: {
      async open(id) {
        if (!docs.has(id)) throw new Error(`onbekend: ${id}`);
        return { name: docs.get(id).name, data: docs.get(id).data.slice().buffer };
      },
      async save(id, bytes, { name }) {
        opgeslagen.push({ id, name, lengte: bytes.length });
        docs.set(id, { name: docs.get(id)?.name ?? name, data: bytes.slice() });
        versies.set(id, [...(versies.get(id) || []), { version: String((versies.get(id) || []).length + 1) }]);
      },
      async list() { return [...docs].map(([id, d]) => ({ id, name: d.name })); },
      async versions(id) { return versies.get(id) || []; },
    },
  };
}

async function alsGast(site, fn) {
  window.__OPDS_HOST__ = { storage: site.storage };
  try {
    await fn();
  } finally {
    delete window.__OPDS_HOST__;
  }
}

test('een pad van de site draagt id en naam, ook met schuine strepen erin', () => {
  const pad = hostPad('Drawing/2026 01', 'map/blad A.pdf');
  assert.equal(pad, 'opds-host://Drawing%2F2026%2001/map_blad A.pdf');
  assert.deepEqual(leesHostPad(pad), { id: 'Drawing/2026 01', naam: 'map_blad A.pdf', versie: null });
  assert.equal(extractFileName(pad), 'map_blad A.pdf', 'tabblad en titel lezen de naam gewoon');
  assert.equal(leesHostPad('C:/docs/a.pdf'), null);
  assert.equal(leesHostPad('opds-host://zonder-naam'), null);
});

test('een oudere versie (#712) heeft een eigen pad met het versienummer', () => {
  const pad = hostPad('Drawing/2026 01', 'blad A.pdf', 3);
  assert.equal(pad, 'opds-host://Drawing%2F2026%2001;versie=3/blad A.pdf');
  assert.deepEqual(leesHostPad(pad), { id: 'Drawing/2026 01', naam: 'blad A.pdf', versie: '3' });
  assert.equal(extractFileName(pad), 'blad A.pdf');
  assert.notEqual(pad, hostPad('Drawing/2026 01', 'blad A.pdf'), 'een eigen tabblad naast het huidige document');
});

test('een oudere versie openen: open(id, versie) als getal, alleen-lezen, en nooit terugschrijven', () => {
  const gevraagd = [];
  const opgeslagen = [];
  const site = {
    storage: {
      async open(id, versie) {
        gevraagd.push(versie === undefined ? [id] : [id, versie]);
        return { name: 'Plattegrond.pdf', data: Uint8Array.from([versie ?? 9]), ...(versie !== undefined ? { versie } : {}) };
      },
      async save(id, bytes) { opgeslagen.push({ id, lengte: bytes.length }); },
    },
  };
  return alsGast(site, async () => {
    const oud = await openHostBestand('DOC-1', '2');
    assert.deepEqual(gevraagd.at(-1), ['DOC-1', 2], 'het versienummer gaat als getal');
    assert.equal(oud.pad, 'opds-host://DOC-1;versie=2/Plattegrond.pdf');
    assert.equal(oud.alleenLezen, true);
    assert.equal(oud.versie, 2);
    assert.deepEqual([...oud.data], [2]);
    // De versie herladen opent die versie weer; terugschrijven wordt een download.
    assert.deepEqual([...(await readBinaryFile(oud.pad))], [2]);
    assert.deepEqual(gevraagd.at(-1), ['DOC-1', 2]);
    downloads.length = 0;
    await writeBinaryFile(oud.pad, Uint8Array.from([1, 2, 3]));
    assert.equal(opgeslagen.length, 0, 'een oudere versie schrijft nooit naar de site');
    assert.deepEqual(downloads.filter(Boolean), ['Plattegrond.pdf']);
    // De huidige versie opent zonder versienummer en schrijft wel terug.
    const huidig = await openHostBestand('DOC-1');
    assert.deepEqual(gevraagd.at(-1), ['DOC-1']);
    assert.equal(huidig.alleenLezen, false);
    await writeBinaryFile(huidig.pad, Uint8Array.from([4]));
    assert.deepEqual(opgeslagen, [{ id: 'DOC-1', lengte: 1 }]);
  });
});

test('de brug van de werkplek zelf meldt readOnly en version', () => alsGast({
  storage: {
    open: async (_id, versie) => ({ name: 'a.pdf', data: Uint8Array.from([1]), version: versie, readOnly: true }),
    save: async () => {},
  },
}, async () => {
  const r = await openHostBestand('X', 4);
  assert.equal(r.alleenLezen, true);
  assert.equal(r.versie, 4);
}));

test('zonder gastsite is er geen opslagcontract', async () => {
  assert.equal(hostOpslag(), null);
  window.__OPDS_HOST__ = { storage: { open() {} } }; // geen save: geen contract
  try { assert.equal(hostOpslag(), null); } finally { delete window.__OPDS_HOST__; }
  assert.equal(await readBinaryFile('opds-host://1/a.pdf'), null, 'valt terug op de webcache');
  assert.deepEqual(await hostDocumenten(), []);
});

test('openen, opslaan en opnieuw openen gaat via de site', () => alsGast(
  nepSite({ 'DOC-1': { name: 'Plattegrond.pdf', data: Uint8Array.from([1, 2, 3]) } }),
  async () => {
    const { pad, naam, data } = await openHostBestand('DOC-1');
    assert.equal(naam, 'Plattegrond.pdf');
    assert.equal(pad, 'opds-host://DOC-1/Plattegrond.pdf');
    assert.deepEqual([...data], [1, 2, 3]);
    assert.equal(await fileExists(pad), true);

    // Opslaan schrijft over het geopende document heen (de saver gebruikt de
    // atomaire variant; buiten Tauri komt die op hetzelfde uit).
    assert.equal(await writeBinaryFileAtomic(pad, Uint8Array.from([9, 9, 9, 9])), true);
    const opnieuw = await openHostBestand('DOC-1');
    assert.deepEqual([...opnieuw.data], [9, 9, 9, 9], 'na herladen staat de nieuwe inhoud er');
    assert.deepEqual((await hostVersies('DOC-1')).map((v) => v.version), ['1']);
    assert.deepEqual((await hostDocumenten()).map((d) => d.id), ['DOC-1']);
  },
));

test('een afgeleid pad of "Opslaan als" schrijft nooit naar de site', () => {
  const site = nepSite({ 'DOC-2': { name: 'Gevel.pdf', data: Uint8Array.from([5]) } });
  return alsGast(site, async () => {
    const { pad } = await openHostBestand('DOC-2');
    downloads.length = 0;
    // Een export naast het document: zelfde id, andere naam.
    await writeBinaryFile('opds-host://DOC-2/Gevel.png', Uint8Array.from([1]));
    assert.equal(site.opgeslagen.length, 0, 'niets naar de site');
    assert.deepEqual(downloads.filter(Boolean), ['Gevel.png'], 'een download');
    // Opslaan als: alleen een bestandsnaam, dus een download.
    assert.equal(await saveFileDialog(pad), 'Gevel.pdf');
  });
});

test('een recent bestand na een herlaadbeurt: lezen opent het, opslaan schrijft terug', () => {
  const site = nepSite({ 'DOC-3': { name: 'Nieuwe naam.pdf', data: Uint8Array.from([7]) } });
  return alsGast(site, async () => {
    // Het pad uit de lijst met recente bestanden heeft nog de oude naam.
    const pad = 'opds-host://DOC-3/Oude naam.pdf';
    assert.deepEqual([...(await readBinaryFile(pad))], [7]);
    await writeBinaryFile(pad, Uint8Array.from([8, 8]));
    assert.deepEqual(site.opgeslagen, [{ id: 'DOC-3', name: 'Oude naam.pdf', lengte: 2 }]);
  });
});

test('de site mag de bytes als Blob of Uint8Array teruggeven', () => {
  const site = {
    storage: {
      open: async (id) => (id === 'blob'
        ? { name: 'b.pdf', data: new Blob([Uint8Array.from([4, 2])]) }
        : { name: 'u.pdf', data: Uint8Array.from([4, 3]) }),
      save: async () => {},
    },
  };
  return alsGast(site, async () => {
    assert.deepEqual([...(await openHostBestand('blob')).data], [4, 2]);
    assert.deepEqual([...(await openHostBestand('u8')).data], [4, 3]);
  });
});

test('de werkplek (#704): alleen-lezen gaat door; ai, geopend en melding als de site ze kent', async () => {
  const meldingen = [];
  const geopend = [];
  const vraag = async () => ({ bericht: { role: 'assistant', content: 'ja' } });
  window.__OPDS_HOST__ = {
    storage: {
      open: async (id) => ({ name: 'a.pdf', data: Uint8Array.from([1]), alleenLezen: id === 'RO' }),
      save: async () => {},
    },
    ai: { vraag },
    geopend: async (id) => { geopend.push(id); return true; },
    melding: async (tekst, toon) => { meldingen.push([tekst, toon]); return true; },
  };
  try {
    assert.equal((await openHostBestand('RO')).alleenLezen, true);
    assert.equal((await openHostBestand('RW')).alleenLezen, false);
    assert.equal(hostAi(), vraag);
    assert.equal(await meldHostGeopend(7), true);
    assert.deepEqual(geopend, ['7']);
    assert.equal(await meldBijHost('Kon niet openen', 'fout'), true);
    assert.deepEqual(meldingen, [['Kon niet openen', 'fout']]);

    // Een weigering van de site verandert niets aan de app.
    window.__OPDS_HOST__.geopend = async () => { throw new Error('niet toegestaan'); };
    window.__OPDS_HOST__.melding = async () => { throw new Error('weg'); };
    assert.equal(await meldHostGeopend('X'), false);
    assert.equal(await meldBijHost('x'), false);
  } finally {
    delete window.__OPDS_HOST__;
  }
  // Een site met alleen het opslagcontract (#546): geen assistent, geen berichten.
  window.__OPDS_HOST__ = { storage: { open: async () => ({}), save: async () => {} } };
  try {
    assert.equal(hostAi(), null);
    assert.equal(await meldHostGeopend('A'), false);
    assert.equal(await meldBijHost('x'), false);
  } finally {
    delete window.__OPDS_HOST__;
  }
});

// Bestanden vastzetten bestaat alleen op het bureaublad (#707): in de browser
// (de webbouw en de werkplek) geen invoke, en dus ook geen waarschuwing in de
// console bij elk openen en opslaan.
test('lock_file en unlock_file alleen in Tauri', async () => {
  const waarschuwingen = [];
  const warn = console.warn;
  console.warn = (...a) => waarschuwingen.push(a.join(' '));
  try {
    assert.equal(await lockFile('opds-host://DOC-1/a.pdf'), false);
    assert.equal(await unlockFile('opds-host://DOC-1/a.pdf'), false);
    assert.equal(await lockFile('a.pdf'), false);
    assert.equal(await unlockFile('a.pdf'), false);
    assert.deepEqual(waarschuwingen, []);

    // Op het bureaublad gaat het verzoek wel naar Rust.
    const verzoeken = [];
    window.__TAURI__ = { core: { invoke: async (cmd, args) => { verzoeken.push([cmd, args.path]); return true; } } };
    assert.equal(await lockFile('C:/a.pdf'), true);
    assert.equal(await unlockFile('C:/a.pdf'), true);
    assert.deepEqual(verzoeken, [['lock_file', 'C:/a.pdf'], ['unlock_file', 'C:/a.pdf']]);
  } finally {
    console.warn = warn;
    delete window.__TAURI__;
  }
});

test('window.openaecHost van de SuperCloud (#977): openen, opslaan en Opslaan als via de host, geen download', async () => {
  const docs = new Map([['DOC-7', { name: 'Doorsnede.pdf', data: Uint8Array.from([1, 2]), version: 4 }]]);
  const opslagen = [];
  window.openaecHost = {
    initialFileId: 'DOC-7',
    async open(id) {
      const d = docs.get(id);
      return { id, name: d.name, version: d.version, readOnly: false, bytes: d.data.slice().buffer };
    },
    async save(bytes, opties) {
      opslagen.push({ ...opties, lengte: bytes.length });
      if (opties.name) {
        docs.set('NIEUW', { name: opties.name, data: bytes.slice(), version: 1 });
        return { id: 'NIEUW', name: opties.name, version: 1 };
      }
      const d = docs.get(opties.id);
      d.data = bytes.slice();
      d.version += 1;
      return { id: opties.id, name: d.name, version: d.version };
    },
    async list() { return [...docs].map(([id, d]) => ({ id, name: d.name, modified: '' })); },
    async versions() { return []; },
  };
  try {
    assert.equal(koppelHost({ venster: window, installeerBrug: () => null }).soort, 'site');
    assert.ok(hostOpslag(), 'het opslagcontract staat er');
    downloads.length = 0;

    const { pad, data } = await openHostBestand(window.__OPDS_HOST__.document);
    assert.equal(pad, 'opds-host://DOC-7/Doorsnede.pdf');
    assert.deepEqual([...data], [1, 2]);

    // Opslaan (Ctrl+S): een nieuwe versie van hetzelfde bestand, met de versie die we kenden.
    assert.equal(await writeBinaryFileAtomic(pad, Uint8Array.from([7, 7, 7])), true);
    assert.deepEqual(opslagen.at(-1), { id: 'DOC-7', expectedVersion: 4, lengte: 3 });
    assert.deepEqual([...docs.get('DOC-7').data], [7, 7, 7]);

    // Opslaan als: een nieuw bestand naast het geopende, daarna schrijft dat pad terug.
    assert.equal(hostKanOpslaanAls(), true);
    const nieuw = await hostOpslaanAls(Uint8Array.from([5]), { name: 'Doorsnede kopie.pdf' });
    assert.equal(nieuw.id, 'NIEUW');
    assert.deepEqual(opslagen.at(-1), { name: 'Doorsnede kopie.pdf', lengte: 1 });
    await writeBinaryFile(nieuw.pad, Uint8Array.from([6, 6]));
    assert.deepEqual(opslagen.at(-1), { id: 'NIEUW', expectedVersion: 1, lengte: 2 });

    assert.deepEqual(downloads.filter(Boolean), [], 'geen enkele download');
  } finally {
    delete window.openaecHost;
    delete window.__OPDS_HOST__;
  }
});
