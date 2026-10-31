// Opslaan als op de site (#726): het contract storage.saveAs(bytes, { name,
// folder? }) -> { id, name, version, renamed? }, met een nepsite.
//  - met saveAs: de dialoog kiest naam en map, het schrijven maakt een nieuw
//    bestand via saveAs (geen download), een hernoeming komt mee, en het
//    nieuwe document schrijft daarna terug via save();
//  - fouten (rechten, quotum, netwerk, …) krijgen een eigen melding en de
//    keuze om toch te downloaden; zonder die keuze gaat de fout (gemeld) door;
//  - zonder saveAs (of bij een niet-PDF) blijft alles een download.

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
  hostKanOpslaanAls, hostNieuwPad, leesHostNieuwPad, hostNieuwUitkomst, meldHostNieuwStil,
  zetHostOpslaanAlsUi, hostMappen, hostOpslaanAls, opgeslagenPad, bewaarPdfOpSite,
  saveFileDialog, writeBinaryFile, writeBinaryFileAtomic, readBinaryFile, leesHostPad, hostPad,
} = await import('./platform.js');
const {
  controleerNaam, kopieNaam, basisNaam, normaliseerOpslaanAls, normaliseerMapLijst,
  foutSoort, foutMelding, FOUT_SLEUTELS, filtersZijnPdf, opgeslagenMelding,
} = await import('./host-opslaan-als.js');

const PDF = [{ name: 'PDF', extensions: ['pdf'] }];
const cp = (...codes) => String.fromCodePoint(...codes);

/** Een site met mappen, die nieuwe bestanden aanmaakt zoals de werkplek. */
function nepSite({ metOpslaanAls = true, fout = null } = {}) {
  const docs = new Map([['DOC-1', { name: 'plan.pdf', map: 'M-ROOT', data: Uint8Array.from([1]) }]]);
  const mappen = {
    root: [
      { id: 'M-A', name: 'Tekeningen', kind: 'folder' },
      { id: 'M-B', name: 'Archief', kind: 'folder', writable: false },
      { id: 'DOC-1', name: 'plan.pdf' },
    ],
    'M-A': [{ id: 'M-A1', name: 'Gevels', kind: 'folder' }],
  };
  const opslaanAls = [];
  const opgeslagen = [];
  const lijsten = [];
  let volgend = 1;
  const storage = {
    async open(id) {
      const d = docs.get(id);
      if (!d) throw new Error(`onbekend: ${id}`);
      return { name: d.name, data: d.data.slice() };
    },
    async save(id, bytes) {
      opgeslagen.push({ id, lengte: bytes.length });
      docs.get(id).data = bytes.slice();
    },
    async list(...args) {
      lijsten.push(args);
      return args.length ? (mappen[args[0]] || []) : mappen.root;
    },
  };
  if (metOpslaanAls) {
    storage.saveAs = async (bytes, opties) => {
      opslaanAls.push({ lengte: bytes.length, isBytes: bytes instanceof Uint8Array, opties: { ...opties } });
      if (fout) throw fout;
      const map = opties.folder ?? 'M-ROOT';
      let name = opties.name;
      // Bestaat de naam al in die map: een kopie, nooit overschrijven.
      const bezet = (n) => [...docs.values()].some((d) => d.map === map && d.name === n);
      for (let i = 2; bezet(name); i++) name = opties.name.replace(/\.pdf$/i, ` (${i}).pdf`);
      const id = `NIEUW-${volgend++}`;
      docs.set(id, { name, map, data: bytes.slice() });
      return { id, name, version: 1, ...(name !== opties.name ? { renamed: true } : {}) };
    };
  }
  return { storage, docs, opslaanAls, opgeslagen, lijsten };
}

/** Een nep-UI die vastlegt wat de app vraagt en vooraf gekozen antwoorden geeft. */
function nepUi({ doel = { naam: 'kopie.pdf', map: null }, foutKeuze = null } = {}) {
  const ui = {
    gevraagd: [], fouten: [], opgeslagen: [], gedownload: [],
    async kiesDoel(o) { ui.gevraagd.push(o); return typeof doel === 'function' ? doel(o) : doel; },
    async bijFout(fout, o) { ui.fouten.push({ soort: foutSoort(fout), fout, ...o }); return foutKeuze; },
    bijOpgeslagen(u) { ui.opgeslagen.push(u); },
    download(naam, bytes) { ui.gedownload.push({ naam, lengte: bytes.length }); },
  };
  return ui;
}

async function alsGast(site, ui, fn) {
  window.__OPDS_HOST__ = { storage: site.storage, document: 'DOC-1' };
  zetHostOpslaanAlsUi(ui);
  try {
    await fn();
  } finally {
    delete window.__OPDS_HOST__;
    zetHostOpslaanAlsUi(null);
  }
}

// ── Pure logica ─────────────────────────────────────────────────────────────

test('namen: .pdf erbij, leeg en verboden tekens geweigerd', () => {
  assert.deepEqual(controleerNaam('  plan  '), { naam: 'plan.pdf', fout: null });
  assert.deepEqual(controleerNaam('Plan.PDF'), { naam: 'Plan.PDF', fout: null });
  assert.equal(controleerNaam('').fout, 'leeg');
  assert.equal(controleerNaam('   ').fout, 'leeg');
  assert.equal(controleerNaam('.pdf').fout, 'leeg');
  assert.equal(controleerNaam('map/plan').fout, 'tekens');
  assert.equal(controleerNaam('map\\plan').fout, 'tekens');
  // Stuur- en richtingstekens weigert de site, de app dus ook.
  for (const c of [0x00, 0x07, 0x1f, 0x7f, 0x85, 0x061c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069]) {
    assert.equal(controleerNaam(`plan${cp(c)}fdp.pdf`).fout, 'tekens', `U+${c.toString(16)}`);
  }
  // Gewone niet-Latijnse namen mogen wel.
  assert.equal(controleerNaam('تصميم').fout, null);
  assert.equal(controleerNaam('設計図').naam, '設計図.pdf');
});

test('de voorgestelde naam is "<naam> (copy).pdf", ook vertaald', () => {
  assert.equal(kopieNaam('plan.pdf'), 'plan (copy).pdf');
  assert.equal(kopieNaam('plan'), 'plan (copy).pdf');
  assert.equal(kopieNaam(''), 'document (copy).pdf');
  assert.equal(kopieNaam('plan.pdf', (b) => `${b} (kopie)`), 'plan (kopie).pdf');
  assert.equal(basisNaam(' Plan.PDF '), 'Plan');
});

test('het antwoord van saveAs: contract- en brugvelden, renamed gemeld of afgeleid', () => {
  assert.deepEqual(normaliseerOpslaanAls({ id: 7, name: 'plan.pdf', version: 1 }, 'plan.pdf'),
    { id: '7', name: 'plan.pdf', version: 1, renamed: false });
  assert.deepEqual(normaliseerOpslaanAls({ bestand: 'X', naam: 'plan (2).pdf', versie: 1, hernoemd: true }, 'plan.pdf'),
    { id: 'X', name: 'plan (2).pdf', version: 1, renamed: true });
  assert.equal(normaliseerOpslaanAls({ id: 'X', name: 'plan (2).pdf' }, 'plan.pdf').renamed, true, 'andere naam zonder melding');
  assert.equal(normaliseerOpslaanAls({ id: 'X' }, 'plan.pdf').name, 'plan.pdf');
  assert.throws(() => normaliseerOpslaanAls({ name: 'plan.pdf' }, 'plan.pdf'), /no id/);
  assert.throws(() => normaliseerOpslaanAls(null, 'plan.pdf'), /no id/);
});

test('mappenlijst: mappen eerst, schrijfbaar of niet, bestanden erna', () => {
  const lijst = normaliseerMapLijst([
    { id: 'f2', name: 'b.pdf' },
    { id: 'm2', naam: 'Zeta', soort: 'map', schrijfbaar: true },
    { id: 'm1', name: 'alfa', kind: 'folder', writable: false },
    { id: 3, name: 'a.pdf', type: 'file' },
    { id: 'm3', name: 'Mid', folder: true, readOnly: true },
    null, { name: 'zonder id' },
  ]);
  assert.deepEqual(lijst, [
    { id: 'm1', name: 'alfa', kind: 'folder', writable: false },
    { id: 'm3', name: 'Mid', kind: 'folder', writable: false },
    { id: 'm2', name: 'Zeta', kind: 'folder', writable: true },
    { id: '3', name: 'a.pdf', kind: 'file', writable: null },
    { id: 'f2', name: 'b.pdf', kind: 'file', writable: null },
  ]);
  assert.deepEqual(normaliseerMapLijst('geen lijst'), []);
});

test('foutcodes van de site (Engels en Nederlands) en van de brug krijgen een soort', () => {
  const met = (velden) => Object.assign(new Error('x'), velden);
  assert.equal(foutSoort(met({ code: 'read_only' })), 'alleen_lezen');
  assert.equal(foutSoort(met({ hostCode: 'geen_rechten' })), 'alleen_lezen');
  assert.equal(foutSoort(met({ status: 403 })), 'alleen_lezen');
  assert.equal(foutSoort(met({ code: 'invalid_name' })), 'ongeldige_naam');
  assert.equal(foutSoort(met({ code: 'too_large' })), 'te_groot');
  assert.equal(foutSoort(met({ status: 413 })), 'te_groot');
  assert.equal(foutSoort(met({ code: 'quota_exceeded' })), 'quotum');
  assert.equal(foutSoort(met({ hostCode: 'quotum' })), 'quotum');
  assert.equal(foutSoort(met({ code: 'time-out' })), 'netwerk', 'de brug gaf op');
  assert.equal(foutSoort(met({ code: 'geen-contact' })), 'netwerk');
  assert.equal(foutSoort(Object.assign(new TypeError('Failed to fetch'))), 'netwerk');
  assert.equal(foutSoort(met({ code: 'host', hostCode: 'onbekende_soort' })), 'niet_ondersteund');
  // De hostCode van de brug wint van zijn eigen code 'host'.
  assert.equal(foutSoort(met({ code: 'host', hostCode: 'read_only' })), 'alleen_lezen');
  assert.equal(foutSoort(met({ code: 'iets_anders' })), 'onbekend');
  assert.equal(foutSoort(null), 'onbekend');
  const t = (k, o) => `${k}|${o?.error ?? ''}`;
  assert.equal(foutMelding(met({ code: 'quota_exceeded' }), t), `${FOUT_SLEUTELS.quotum}|x`);
  assert.equal(foutMelding(new Error('kapot'), t), 'hostSaveAs.errorFailed|kapot', 'de tekst van de site als terugval');
});

test('alleen een PDF-dialoog gaat naar de site', () => {
  assert.equal(filtersZijnPdf(undefined), true);
  // Zonder filters beslist de voorgestelde naam: geen PNG als "x.png.pdf" op de site.
  assert.equal(filtersZijnPdf(undefined, 'kopie.pdf'), true);
  assert.equal(filtersZijnPdf(undefined, 'C:\\map\\Plan.PDF'), true);
  assert.equal(filtersZijnPdf(undefined, 'map.v2/zonder-extensie'), true);
  assert.equal(filtersZijnPdf(undefined, 'zonder-extensie'), true);
  assert.equal(filtersZijnPdf(null, 'export.png'), false);
  assert.equal(filtersZijnPdf(undefined, 'map.v2/notities.xfdf'), false);
  assert.equal(filtersZijnPdf(PDF), true);
  assert.equal(filtersZijnPdf([{ name: 'PDF/X', extensions: ['PDF'] }]), true);
  assert.equal(filtersZijnPdf([{ name: 'PNG', extensions: ['png'] }]), false);
  assert.equal(filtersZijnPdf([{ name: 'PDF', extensions: ['pdf'] }, { name: 'PNG', extensions: ['png'] }]), false);
  assert.equal(filtersZijnPdf([]), false);
});

test('de melding na het opslaan noemt de naam, en de hernoeming', () => {
  const t = (k, o) => `${k}:${o.name}`;
  assert.equal(opgeslagenMelding({ name: 'a.pdf', renamed: false }, t), 'hostSaveAs.saved:a.pdf');
  assert.equal(opgeslagenMelding({ name: 'a (2).pdf', renamed: true }, t), 'hostSaveAs.renamed:a (2).pdf');
});

test('een pad voor een nieuw bestand draagt naam en map, en is geen pad van een document', () => {
  const pad = hostNieuwPad('a/b.pdf', 'Map 1/2');
  assert.deepEqual(leesHostNieuwPad(pad), { naam: 'a_b.pdf', map: 'Map 1/2' });
  assert.deepEqual(leesHostNieuwPad(hostNieuwPad('c.pdf')), { naam: 'c.pdf', map: null });
  assert.equal(leesHostPad(pad), null, 'nooit verward met opds-host://');
  assert.notEqual(hostNieuwPad('c.pdf'), hostNieuwPad('c.pdf'), 'elk Opslaan als een eigen pad');
  assert.equal(leesHostNieuwPad('opds-host://X/a.pdf'), null);
  assert.equal(leesHostNieuwPad('C:/a.pdf'), null);
});

// ── Met een nepsite ─────────────────────────────────────────────────────────

test('zonder saveAs: Opslaan als en exports blijven een download (ongewijzigd)', () => {
  const site = nepSite({ metOpslaanAls: false });
  const ui = nepUi();
  return alsGast(site, ui, async () => {
    assert.equal(hostKanOpslaanAls(), false);
    assert.equal(await saveFileDialog(hostPad('DOC-1', 'plan.pdf')), 'plan.pdf', 'alleen de naam: een download');
    assert.equal(await saveFileDialog('plan_extracted.pdf', PDF), 'plan_extracted.pdf');
    downloads.length = 0;
    await writeBinaryFile('plan_extracted.pdf', Uint8Array.from([1, 2]));
    assert.deepEqual(downloads, ['plan_extracted.pdf']);
    assert.equal(ui.gevraagd.length, 0, 'geen dialoog van de site');
    assert.equal(await bewaarPdfOpSite('clean-copy.pdf', Uint8Array.from([1])), null, 'de aanroeper downloadt zelf');
  });
});

test('zonder gastsite: niets verandert', async () => {
  delete window.__OPDS_HOST__;
  assert.equal(hostKanOpslaanAls(), false);
  assert.equal(await saveFileDialog('a.pdf', PDF), 'a.pdf');
  assert.deepEqual(await hostMappen(), []);
});

test('met saveAs: de dialoog krijgt de naam, het schrijven maakt een nieuw bestand op de site', () => {
  const site = nepSite();
  const ui = nepUi({ doel: { naam: 'plan (copy).pdf', map: 'M-A' } });
  return alsGast(site, ui, async () => {
    assert.equal(hostKanOpslaanAls(), true);
    const pad = await saveFileDialog('plan (copy).pdf');
    assert.deepEqual(ui.gevraagd, [{ naam: 'plan (copy).pdf' }]);
    assert.deepEqual(leesHostNieuwPad(pad), { naam: 'plan (copy).pdf', map: 'M-A' });

    downloads.length = 0;
    // Zoals savePDF() het doet (webversie: atomic = gewoon schrijven).
    await writeBinaryFileAtomic(pad, Uint8Array.from([1, 2, 3]));
    assert.deepEqual(downloads, [], 'geen download');
    assert.deepEqual(site.opslaanAls, [{ lengte: 3, isBytes: true, opties: { name: 'plan (copy).pdf', folder: 'M-A' } }]);
    const uitkomst = hostNieuwUitkomst(pad);
    assert.equal(uitkomst.id, 'NIEUW-1');
    assert.equal(uitkomst.name, 'plan (copy).pdf');
    assert.equal(uitkomst.renamed, false);
    assert.equal(uitkomst.pad, hostPad('NIEUW-1', 'plan (copy).pdf'));
    assert.equal(opgeslagenPad(pad), uitkomst.pad);
    assert.deepEqual(ui.opgeslagen.map((u) => u.id), ['NIEUW-1'], 'een export meldt waar het bestand staat');

    // Het nieuwe document opent en schrijft terug via save(), niet via saveAs.
    assert.deepEqual([...(await readBinaryFile(uitkomst.pad))], [1, 2, 3]);
    await writeBinaryFile(uitkomst.pad, Uint8Array.from([9]));
    assert.deepEqual(site.opgeslagen, [{ id: 'NIEUW-1', lengte: 1 }]);
    assert.equal(site.opslaanAls.length, 1);
  });
});

test('zonder gekozen map: geen folder (de map van het geopende document)', () => {
  const site = nepSite();
  const ui = nepUi({ doel: { naam: 'a.pdf', map: null } });
  return alsGast(site, ui, async () => {
    const pad = await saveFileDialog('a.pdf', PDF);
    await writeBinaryFile(pad, Uint8Array.from([1]));
    assert.deepEqual(site.opslaanAls[0].opties, { name: 'a.pdf' });
    assert.equal('folder' in site.opslaanAls[0].opties, false);
  });
});

test('een bestaande naam: de site maakt een kopie en meldt renamed; niets overschreven', () => {
  const site = nepSite();
  const ui = nepUi({ doel: { naam: 'plan.pdf', map: null } });
  return alsGast(site, ui, async () => {
    const pad = await saveFileDialog('plan.pdf');
    meldHostNieuwStil(pad); // Opslaan als meldt het zelf, met de keuze erbij
    await writeBinaryFile(pad, Uint8Array.from([7, 7]));
    const uitkomst = hostNieuwUitkomst(pad);
    assert.equal(uitkomst.renamed, true);
    assert.equal(uitkomst.name, 'plan (2).pdf');
    assert.deepEqual([...site.docs.get('DOC-1').data], [1], 'het origineel is onaangeroerd');
    assert.equal(ui.opgeslagen.length, 0, 'stil: de aanroeper meldt het');
  });
});

test('annuleren in de dialoog: geen pad, niets geschreven', () => {
  const site = nepSite();
  const ui = nepUi({ doel: null });
  return alsGast(site, ui, async () => {
    assert.equal(await saveFileDialog('a.pdf'), null);
    assert.equal(await bewaarPdfOpSite('clean-copy.pdf', Uint8Array.from([1])), false);
    assert.equal(site.opslaanAls.length, 0);
  });
});

test('"Toch downloaden" in de dialoog: de oude route, met de gekozen naam', () => {
  const site = nepSite();
  const ui = nepUi({ doel: { download: true, naam: 'eigen.pdf' } });
  return alsGast(site, ui, async () => {
    const pad = await saveFileDialog('a.pdf', PDF);
    assert.equal(pad, 'eigen.pdf');
    downloads.length = 0;
    await writeBinaryFile(pad, Uint8Array.from([1]));
    assert.deepEqual(downloads, ['eigen.pdf']);
    assert.equal(site.opslaanAls.length, 0);
  });
});

test('een niet-PDF-export blijft een download, ook met saveAs', () => {
  const site = nepSite();
  const ui = nepUi();
  return alsGast(site, ui, async () => {
    assert.equal(await saveFileDialog('plan.png', [{ name: 'PNG', extensions: ['png'] }]), 'plan.png');
    assert.equal(await saveFileDialog('plan.xfdf', [{ name: 'XFDF', extensions: ['xfdf'] }]), 'plan.xfdf');
    // Zonder filters beslist de naam: een PNG wordt nooit "plan.png.pdf" op de site.
    assert.equal(await saveFileDialog('plan.png'), 'plan.png');
    assert.equal(ui.gevraagd.length, 0);
  });
});

test('export die de site weigert zonder download: geen tweede foutmelding voor de aanroeper', () => {
  const site = nepSite({ fout: Object.assign(new Error('Forbidden'), { code: 'read_only' }) });
  const ui = nepUi({ doel: { naam: 'clean-copy.pdf', map: 'M-B' }, foutKeuze: null });
  return alsGast(site, ui, async () => {
    downloads.length = 0;
    // false = afgebroken: de melding met de keuze om te downloaden kwam al.
    assert.equal(await bewaarPdfOpSite('clean-copy.pdf', Uint8Array.from([1])), false);
    assert.equal(ui.fouten.length, 1);
    assert.deepEqual(downloads, []);
    assert.deepEqual(ui.gedownload, []);
  });
});

for (const [naam, fout, soort] of [
  ['rechten', Object.assign(new Error('Forbidden'), { code: 'read_only' }), 'alleen_lezen'],
  ['quotum', Object.assign(new Error('Full'), { code: 'quota_exceeded' }), 'quotum'],
  ['netwerk', new TypeError('Failed to fetch'), 'netwerk'],
  ['te groot', Object.assign(new Error('Big'), { code: 'too_large' }), 'te_groot'],
  ['ongeldige naam', Object.assign(new Error('Name'), { hostCode: 'invalid_name' }), 'ongeldige_naam'],
]) {
  test(`fout (${naam}): de gebruiker ziet de eigen melding; zonder download gaat de fout gemeld door`, () => {
    const site = nepSite({ fout });
    const ui = nepUi({ doel: { naam: 'a.pdf', map: 'M-B' }, foutKeuze: null });
    return alsGast(site, ui, async () => {
      const pad = await saveFileDialog('a.pdf');
      downloads.length = 0;
      await assert.rejects(writeBinaryFileAtomic(pad, Uint8Array.from([1])), (e) => e.gemeld === true);
      assert.equal(ui.fouten.length, 1);
      assert.equal(ui.fouten[0].soort, soort);
      assert.equal(ui.fouten[0].naam, 'a.pdf');
      assert.equal(hostNieuwUitkomst(pad), null);
      assert.deepEqual(ui.gedownload, []);
    });
  });
}

test('fout met "Toch downloaden": de bytes gaan als download mee, niets verloren', () => {
  const site = nepSite({ fout: Object.assign(new Error('Forbidden'), { code: 'read_only' }) });
  const ui = nepUi({ doel: { naam: 'a.pdf', map: 'M-B' }, foutKeuze: 'download' });
  return alsGast(site, ui, async () => {
    const pad = await saveFileDialog('a.pdf');
    assert.equal(await writeBinaryFile(pad, Uint8Array.from([4, 5])), true);
    assert.deepEqual(ui.gedownload, [{ naam: 'a.pdf', lengte: 2 }]);
    assert.deepEqual(hostNieuwUitkomst(pad), { gedownload: true });
    assert.equal(opgeslagenPad(pad), pad, 'geen document op de site');
  });
});

test('een antwoord zonder id is een fout, geen half document', () => {
  const site = nepSite();
  site.storage.saveAs = async () => ({ name: 'a.pdf' });
  const ui = nepUi({ doel: { naam: 'a.pdf', map: null } });
  return alsGast(site, ui, async () => {
    const pad = await saveFileDialog('a.pdf');
    await assert.rejects(writeBinaryFile(pad, Uint8Array.from([1])), (e) => e.gemeld === true);
    assert.equal(hostNieuwUitkomst(pad), null);
  });
});

test('de mappen komen uit storage.list: zonder argument de huidige map, met id een submap', () => {
  const site = nepSite();
  return alsGast(site, nepUi(), async () => {
    const top = await hostMappen();
    assert.deepEqual(top.map((i) => [i.id, i.kind, i.writable]), [
      ['M-B', 'folder', false], ['M-A', 'folder', null], ['DOC-1', 'file', null],
    ]);
    const sub = await hostMappen('M-A');
    assert.deepEqual(sub.map((i) => i.name), ['Gevels']);
    assert.deepEqual(site.lijsten, [[], ['M-A']], 'list() zonder argument blijft zoals het contract was');
  });
});

test('hostOpslaanAls zonder saveAs weigert met code unsupported', () => {
  const site = nepSite({ metOpslaanAls: false });
  return alsGast(site, nepUi(), async () => {
    await assert.rejects(hostOpslaanAls(Uint8Array.from([1]), { name: 'a.pdf' }), (e) => foutSoort(e) === 'niet_ondersteund');
  });
});

test('hostOpslaanAls stuurt nooit een pad of een niet-PDF-naam naar de site', () => {
  const site = nepSite();
  return alsGast(site, nepUi(), async () => {
    for (const naam of ['../geheim.pdf', 'map/a.pdf', `map${cp(0x5c)}a.pdf`, '', '  ', `a${cp(0x202e)}fdp.exe`, `a${cp(0)}.pdf`]) {
      await assert.rejects(hostOpslaanAls(Uint8Array.from([1]), { name: naam }), (e) => foutSoort(e) === 'ongeldige_naam', JSON.stringify(naam));
    }
    assert.equal(site.opslaanAls.length, 0);
    // Zonder .pdf komt die erbij: de site krijgt alleen PDF's.
    await hostOpslaanAls(Uint8Array.from([1]), { name: 'rapport' });
    assert.deepEqual(site.opslaanAls.map((o) => o.opties.name), ['rapport.pdf']);
  });
});

test('exports uit de webversie (opgeschoonde kopie, formulier, verzameling) gaan naar de site', () => {
  const site = nepSite();
  const ui = nepUi({ doel: (o) => ({ naam: o.naam, map: 'M-A' }) });
  return alsGast(site, ui, async () => {
    downloads.length = 0;
    assert.equal(await bewaarPdfOpSite('clean-copy.pdf', Uint8Array.from([1, 2])), true);
    assert.deepEqual(site.opslaanAls.map((o) => o.opties), [{ name: 'clean-copy.pdf', folder: 'M-A' }]);
    assert.deepEqual(downloads, []);
  });
});
