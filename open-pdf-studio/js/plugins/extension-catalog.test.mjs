// Extensiecatalogus (#969): ontleden en controleren, versievergelijking,
// links en GitHub-releases, bronnenadministratie en de installatiestroom met
// nep-downloads. Geen netwerk: alles draait op lokale gegevens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  STANDAARD_CATALOGUS, controleerCatalogus, controleerItem, leesCatalogus,
  vergelijkVersies, isNieuwer, ontleedLink, kiesReleasePakket, githubRepo, isHttpsUrl,
  catalogiUit, metCatalogus, zonderCatalogus, bronnenUit, metBron, zonderBron, bronSoort, updateBron,
  maakCatalogusDienst,
} from './extension-catalog.js';

const hier = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(hier, '..', '..', '..');
const SHA = 'a'.repeat(64);

const goedRepo = {
  id: 'voorbeeld.meten', name: 'Voorbeeld', description: 'Doet iets.', author: 'Iemand',
  repo: 'https://github.com/iemand/voorbeeld', tags: ['measure'],
};
const goedPakket = {
  id: 'vast-pakket', name: 'Vast', description: 'Vaste link.', author: 'Iemand',
  package: 'https://example.org/dl/vast-pakket.oppx', version: '1.2.0', sha256: SHA,
};

// ─── Het catalogusbestand in deze repository (CI-controle) ─────────────

test('extensions.json in de repository is een geldige catalogus', () => {
  const tekst = readFileSync(join(repoRoot, 'extensions.json'), 'utf8');
  const r = controleerCatalogus(JSON.parse(tekst));
  assert.deepEqual(r.fouten, [], r.fouten.join('\n'));
  assert.equal(r.ok, true);
});

test('extensions.schema.json noemt dezelfde velden als de controle', () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, 'extensions.schema.json'), 'utf8'));
  const ext = schema.$defs.extension;
  assert.deepEqual(
    Object.keys(ext.properties).sort(),
    ['author', 'description', 'homepage', 'id', 'name', 'package', 'repo', 'sha256', 'tags', 'version'],
  );
  assert.deepEqual([...ext.required].sort(), ['author', 'description', 'id', 'name']);
  assert.equal(ext.properties.description.maxLength, 400);
  assert.equal(ext.properties.tags.maxItems, 8);
  assert.equal(schema.properties.version.const, 1);
  // Het id-patroon van het schema accepteert en weigert hetzelfde als de app.
  const re = new RegExp(ext.properties.id.pattern);
  for (const id of ['a', 'mijn-extensie', 'org.open.tool', 'x1.y2']) {
    assert.equal(re.test(id), true, id);
    assert.equal(controleerItem({ ...goedRepo, id }).item !== null, true, id);
  }
  for (const id of ['A', '-a', 'a-', 'a..b', 'a_b', '.a']) {
    assert.equal(re.test(id), false, id);
    assert.equal(controleerItem({ ...goedRepo, id }).item, null, id);
  }
});

// ─── Controle van regels ─────────────────────────────────────────────────

test('een goede repo- en pakketregel worden genormaliseerd', () => {
  const r = controleerCatalogus({ version: 1, extensions: [goedRepo, { ...goedPakket, version: 'v1.2.0', sha256: SHA.toUpperCase() }] });
  assert.equal(r.ok, true, r.fouten.join('\n'));
  assert.equal(r.items[0].homepage, goedRepo.repo, 'homepage valt terug op repo');
  assert.equal(r.items[1].version, '1.2.0', 'voorloop-v weg');
  assert.equal(r.items[1].sha256, SHA, 'sha256 in kleine letters');
});

test('verplichte velden en grenzen', () => {
  const fouten = (e) => controleerItem(e).fouten.join('\n');
  assert.match(fouten({ ...goedRepo, name: '' }), /"name" is required/);
  assert.match(fouten({ ...goedRepo, author: undefined }), /"author" is required/);
  assert.match(fouten({ ...goedRepo, description: 'x'.repeat(401) }), /longer than 400/);
  assert.equal(controleerItem({ ...goedRepo, description: 'x'.repeat(400) }).item !== null, true);
  const { repo, ...zonderBronLink } = goedRepo;
  assert.match(fouten(zonderBronLink), /either "repo" or "package"/);
  assert.match(fouten({ ...goedRepo, repo: 'https://gitlab.com/a/b' }), /GitHub repository/);
  assert.match(fouten({ ...goedRepo, repo: 'http://github.com/a/b' }), /GitHub repository/);
  assert.match(fouten({ ...goedPakket, package: 'http://example.org/a.oppx' }), /https:\/\/ link to a \.oppx/);
  assert.match(fouten({ ...goedPakket, package: 'https://example.org/a.zip' }), /\.oppx/);
  const { version, ...pakketZonderVersie } = goedPakket;
  assert.match(fouten(pakketZonderVersie), /"version" is required with "package"/);
  assert.match(fouten({ ...goedPakket, version: 'nieuw' }), /version like/);
  assert.match(fouten({ ...goedPakket, sha256: 'abc' }), /64 hexadecimal/);
  assert.match(fouten({ ...goedRepo, sha256: SHA }), /only applies to a fixed "package"/);
  assert.match(fouten({ ...goedRepo, homepage: 'javascript:alert(1)' }), /"homepage" must be an https/);
  assert.match(fouten({ ...goedRepo, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }), /at most 8 tags/);
  assert.match(fouten({ ...goedRepo, tags: [''] }), /each tag/);
  assert.match(fouten({ ...goedRepo, extra: 1 }), /unknown field "extra"/);
});

test('catalogusniveau: formaatversie, lijst, dubbele id', () => {
  assert.equal(controleerCatalogus(null).ok, false);
  assert.match(controleerCatalogus({ version: 2, extensions: [] }).fouten.join(), /"version" must be 1/);
  assert.match(controleerCatalogus({ version: 1 }).fouten.join(), /"extensions" must be a list/);
  assert.match(controleerCatalogus({ version: 1, extensions: [], x: 1 }).fouten.join(), /unknown top-level field "x"/);
  const r = controleerCatalogus({ version: 1, extensions: [goedRepo, { ...goedRepo, name: 'Ander' }] });
  assert.equal(r.items.length, 1);
  assert.match(r.fouten.join(), /duplicate id/);
});

test('leesCatalogus: kapotte regels vallen weg, de rest blijft, met de catalogus erbij', () => {
  const tekst = '\uFEFF' + JSON.stringify({ version: 1, extensions: [goedRepo, { id: 'KAPOT' }, goedPakket] });
  const r = leesCatalogus(tekst, 'https://bedrijf.example/extensions.json');
  assert.deepEqual(r.items.map((i) => i.id), ['voorbeeld.meten', 'vast-pakket']);
  assert.equal(r.items[0].catalogus, 'https://bedrijf.example/extensions.json');
  assert.ok(r.fouten.length > 0);
  assert.match(leesCatalogus('{kapot', 'x').fouten[0], /not valid JSON/);
});

// ─── Versies ─────────────────────────────────────────────────────────────

test('versievergelijking', () => {
  assert.equal(vergelijkVersies('1.2.10', '1.2.9'), 1);
  assert.equal(vergelijkVersies('1.2.9', '1.2.10'), -1);
  assert.equal(vergelijkVersies('v1.2.0', '1.2.0'), 0);
  assert.equal(vergelijkVersies('1.2', '1.2.0'), 0);
  assert.equal(vergelijkVersies('2', '1.9.9'), 1);
  assert.equal(vergelijkVersies('1.0.0', '1.0.0-beta.2'), 1, 'release na voorversie');
  assert.equal(vergelijkVersies('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(vergelijkVersies('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(vergelijkVersies('1.0.0-1', '1.0.0-alpha'), -1, 'numeriek vóór tekst');
  assert.equal(vergelijkVersies('1.0.0+build.5', '1.0.0'), 0, 'build-metadata telt niet');
  assert.equal(vergelijkVersies('nieuw', '1.0.0'), null);
  assert.equal(vergelijkVersies('', '1.0.0'), null);
  assert.equal(isNieuwer('0.2.0', '0.1.9'), true);
  assert.equal(isNieuwer('0.1.9', '0.1.9'), false);
  assert.equal(isNieuwer('latest', '0.1.9'), false, 'onleesbaar = geen update');
});

// ─── Links en releases ───────────────────────────────────────────────────

test('links: GitHub-repository, .oppx, en weigeren van de rest', () => {
  assert.deepEqual(githubRepo('https://github.com/Seed-43/PDF43.git'), { eigenaar: 'Seed-43', repo: 'PDF43' });
  assert.deepEqual(githubRepo('https://github.com/a/b/'), { eigenaar: 'a', repo: 'b' });
  assert.equal(githubRepo('https://github.com/a/b/releases'), null);
  assert.equal(githubRepo('https://github.com/a/..'), null);
  const g = ontleedLink(' https://github.com/a/b ');
  assert.equal(g.soort, 'github');
  assert.equal(g.api, 'https://api.github.com/repos/a/b/releases/latest');
  assert.deepEqual(ontleedLink('https://x.example/p.oppx?dl=1'), { soort: 'pakket', url: 'https://x.example/p.oppx?dl=1' });
  assert.throws(() => ontleedLink('http://x.example/p.oppx'), /Only https/);
  assert.throws(() => ontleedLink('file:///C:/p.oppx'), /GitHub repository link/);
  assert.throws(() => ontleedLink('https://x.example/p.zip'), /GitHub repository link/);
  assert.equal(isHttpsUrl('https://user:pw@x.example/a'), false);
});

test('release-pakket kiezen: .oppx, voorkeur voor <id>.oppx, GitHub-digest', () => {
  const release = {
    tag_name: 'v1.3.0',
    assets: [
      { name: 'bron.zip', browser_download_url: 'https://github.com/a/b/releases/download/v1.3.0/bron.zip' },
      { name: 'ander.oppx', browser_download_url: 'https://github.com/a/b/releases/download/v1.3.0/ander.oppx' },
      { name: 'mijn-ext.oppx', browser_download_url: 'https://github.com/a/b/releases/download/v1.3.0/mijn-ext.oppx', digest: `sha256:${SHA.toUpperCase()}` },
    ],
  };
  const p = kiesReleasePakket(release, 'mijn-ext');
  assert.equal(p.url, release.assets[2].browser_download_url);
  assert.equal(p.version, '1.3.0');
  assert.equal(p.sha256, SHA);
  assert.equal(kiesReleasePakket(release).url, release.assets[1].browser_download_url, 'zonder id: de eerste .oppx');
  assert.throws(() => kiesReleasePakket({ tag_name: 'v1', assets: [release.assets[0]] }, '', 'a/b'), /latest release of a\/b has no \.oppx/);
  const httpAsset = { tag_name: 'v1.0.0', assets: [{ name: 'x.oppx', browser_download_url: 'http://x/x.oppx' }] };
  assert.throws(() => kiesReleasePakket(httpAsset), /no \.oppx/);
  assert.equal(kiesReleasePakket({ tag_name: 'nightly', assets: [release.assets[1]] }).version, '');
});

// ─── Catalogi en bronnen ─────────────────────────────────────────────────

test('catalogi: standaard altijd vooraan en niet te verwijderen', () => {
  assert.deepEqual(catalogiUit({}), [STANDAARD_CATALOGUS]);
  const v = { extensionCatalogs: ['https://bedrijf.example/e.json', 'http://onveilig/e.json', STANDAARD_CATALOGUS, 'https://bedrijf.example/e.json', 5] };
  assert.deepEqual(catalogiUit(v), [STANDAARD_CATALOGUS, 'https://bedrijf.example/e.json']);
  assert.deepEqual(metCatalogus(v, ' https://tweede.example/e.json '), ['https://bedrijf.example/e.json', 'https://tweede.example/e.json']);
  assert.deepEqual(metCatalogus(v, 'https://bedrijf.example/e.json'), ['https://bedrijf.example/e.json'], 'geen dubbele');
  assert.throws(() => metCatalogus(v, 'http://x/e.json'), /https/);
  assert.deepEqual(zonderCatalogus(v, STANDAARD_CATALOGUS), ['https://bedrijf.example/e.json']);
  assert.deepEqual(zonderCatalogus(v, 'https://bedrijf.example/e.json'), []);
});

test('bronnen: vastleggen, lezen, vergeten, labels', () => {
  const v = { extensionSources: { 'kapot id': { link: 'x' }, oud: { link: 5 } } };
  assert.deepEqual(bronnenUit(v), {});
  const b = metBron(v, 'mijn-ext', { soort: 'catalog', link: 'https://github.com/a/b', catalogus: STANDAARD_CATALOGUS, version: '1.0.0' });
  assert.deepEqual(b, { 'mijn-ext': { soort: 'catalog', link: 'https://github.com/a/b', catalogus: STANDAARD_CATALOGUS, version: '1.0.0' } });
  const b2 = metBron({ extensionSources: b }, 'eigen', { soort: 'iets', link: 'https://x.example/e.oppx' });
  assert.equal(b2.eigen.soort, 'custom', 'onbekende soort = eigen link');
  assert.equal(bronSoort(b2, 'mijn-ext'), 'catalog');
  assert.equal(bronSoort(b2, 'eigen'), 'custom');
  assert.equal(bronSoort(b2, 'uit-bestand'), null);
  assert.deepEqual(Object.keys(zonderBron({ extensionSources: b2 }, 'eigen')), ['mijn-ext']);
});

test('updatebron: catalogus wint, ook voor uit een bestand geïnstalleerd; eigen link blijft eigen', () => {
  const item = { id: 'a', repo: 'https://github.com/x/a', catalogus: 'c1' };
  const itemC2 = { id: 'a', repo: 'https://github.com/y/a', catalogus: 'c2' };
  assert.deepEqual(updateBron('a', {}, [item]), { soort: 'catalog', item }, 'uit een bestand, wel in de catalogus');
  assert.deepEqual(updateBron('a', { a: { soort: 'catalog', link: '', catalogus: 'c2' } }, [item, itemC2]).item, itemC2, 'dezelfde catalogus');
  assert.deepEqual(updateBron('a', { a: { soort: 'custom', link: 'https://github.com/z/a' } }, [item]), { soort: 'custom', link: 'https://github.com/z/a' });
  assert.equal(updateBron('b', {}, [item]), null);
  assert.deepEqual(updateBron('a', { a: { soort: 'catalog', link: 'https://github.com/x/a', catalogus: 'weg' } }, []),
    { soort: 'catalog', link: 'https://github.com/x/a', catalogus: 'weg' }, 'catalogus weg: de link volgen');
});

// ─── De dienst met nep-downloads ─────────────────────────────────────────

function nepDienst({ teksten = {}, pakketId = null, installeerFout = null } = {}) {
  const voorkeuren = { extensionCatalogs: [], extensionSources: {} };
  const log = { tekst: [], pakket: [], geinstalleerd: [], opgeruimd: [], bewaard: 0 };
  const dienst = maakCatalogusDienst({
    haalTekst: async (url) => {
      log.tekst.push(url);
      if (!(url in teksten)) throw new Error(`HTTP 404 Not Found (${url})`);
      return typeof teksten[url] === 'string' ? teksten[url] : JSON.stringify(teksten[url]);
    },
    haalPakket: async ({ url, sha256, verwachtId }) => {
      log.pakket.push({ url, sha256, verwachtId });
      const id = pakketId ?? verwachtId ?? 'eigen-ext';
      if (verwachtId && id !== verwachtId) throw new Error(`The package has id "${id}", but "${verwachtId}" was expected`);
      return { pad: `C:/tmp/${id}.oppx`, id };
    },
    installeer: async (pad) => {
      if (installeerFout) throw new Error(installeerFout);
      log.geinstalleerd.push(pad);
      const id = pad.replace(/^.*\/|\.oppx$/g, '');
      return { id, name: id, version: '2.0.0' };
    },
    ruimOp: async (pad) => { log.opgeruimd.push(pad); },
    voorkeuren: () => voorkeuren,
    bewaar: (w) => { Object.assign(voorkeuren, w); log.bewaard++; },
  });
  return { dienst, voorkeuren, log };
}

const release = (id, versie) => ({
  tag_name: `v${versie}`,
  assets: [{ name: `${id}.oppx`, browser_download_url: `https://github.com/x/${id}/releases/download/v${versie}/${id}.oppx`, digest: `sha256:${SHA}` }],
});

test('catalogi laden: samenvoegen, eerste catalogus wint bij dubbel id, problemen apart', async () => {
  const eigen = 'https://bedrijf.example/extensions.json';
  const { dienst, voorkeuren } = nepDienst({
    teksten: {
      [STANDAARD_CATALOGUS]: { version: 1, extensions: [goedRepo] },
      [eigen]: { version: 1, extensions: [{ ...goedRepo, name: 'Kopie' }, goedPakket] },
    },
  });
  await dienst.voegCatalogusToe(eigen);
  await dienst.voegCatalogusToe('https://weg.example/e.json');
  assert.deepEqual(voorkeuren.extensionCatalogs, [eigen, 'https://weg.example/e.json']);
  const r = await dienst.laadCatalogi();
  assert.deepEqual(r.items.map((i) => `${i.id}:${i.name}`), ['voorbeeld.meten:Voorbeeld', 'vast-pakket:Vast']);
  assert.equal(r.items[1].catalogus, eigen);
  assert.equal(r.problemen.length, 1);
  assert.equal(r.problemen[0].url, 'https://weg.example/e.json');
  await dienst.verwijderCatalogus('https://weg.example/e.json');
  assert.deepEqual(voorkeuren.extensionCatalogs, [eigen]);
});

test('installeren uit de catalogus (repo): nieuwste release, GitHub-digest, verwacht id, bron vastgelegd, opgeruimd', async () => {
  const item = { ...controleerItem({ ...goedRepo, id: 'mijn-ext', repo: 'https://github.com/x/mijn-ext' }).item, catalogus: STANDAARD_CATALOGUS };
  const { dienst, voorkeuren, log } = nepDienst({ teksten: { 'https://api.github.com/repos/x/mijn-ext/releases/latest': release('mijn-ext', '2.0.0') } });
  const m = await dienst.installeerItem(item);
  assert.equal(m.id, 'mijn-ext');
  assert.deepEqual(log.pakket, [{ url: 'https://github.com/x/mijn-ext/releases/download/v2.0.0/mijn-ext.oppx', sha256: SHA, verwachtId: 'mijn-ext' }]);
  assert.deepEqual(log.opgeruimd, ['C:/tmp/mijn-ext.oppx']);
  assert.deepEqual(voorkeuren.extensionSources['mijn-ext'], { soort: 'catalog', link: 'https://github.com/x/mijn-ext', catalogus: STANDAARD_CATALOGUS, version: '2.0.0' });
});

test('installeren uit de catalogus (pakket): de sha256 van de catalogus gaat mee', async () => {
  const item = { ...controleerItem(goedPakket).item, catalogus: STANDAARD_CATALOGUS };
  const { dienst, log } = nepDienst();
  await dienst.installeerItem(item);
  assert.deepEqual(log.pakket, [{ url: goedPakket.package, sha256: SHA, verwachtId: 'vast-pakket' }]);
});

test('een pakket met een ander id dan de catalogus wordt geweigerd, zonder bron', async () => {
  const item = { ...controleerItem(goedPakket).item, catalogus: STANDAARD_CATALOGUS };
  const { dienst, voorkeuren, log } = nepDienst({ pakketId: 'iets-anders' });
  await assert.rejects(dienst.installeerItem(item), /has id "iets-anders"/);
  assert.equal(log.geinstalleerd.length, 0);
  assert.deepEqual(voorkeuren.extensionSources, {});
});

test('mislukte installatie: tijdelijk bestand toch weg, geen bron', async () => {
  const { dienst, voorkeuren, log } = nepDienst({ installeerFout: 'MANIFEST_INVALID: kapot' });
  await assert.rejects(dienst.installeerLink('https://x.example/eigen-ext.oppx'), /MANIFEST_INVALID/);
  assert.deepEqual(log.opgeruimd, ['C:/tmp/eigen-ext.oppx']);
  assert.deepEqual(voorkeuren.extensionSources, {});
});

test('eigen link: http geweigerd vóór er iets wordt opgehaald; .oppx en GitHub als "custom"', async () => {
  const { dienst, voorkeuren, log } = nepDienst({ teksten: { 'https://api.github.com/repos/x/eigen-ext/releases/latest': release('eigen-ext', '1.0.0') } });
  await assert.rejects(dienst.installeerLink('http://x.example/a.oppx'), /Only https/);
  assert.equal(log.tekst.length + log.pakket.length, 0);
  await dienst.installeerLink('https://github.com/x/eigen-ext');
  assert.equal(voorkeuren.extensionSources['eigen-ext'].soort, 'custom');
  assert.equal(log.pakket[0].sha256, SHA, 'GitHub-digest ook bij een eigen link');
  assert.equal(log.pakket[0].verwachtId, null, 'eigen link: id onbekend vooraf');
});

test('updates zoeken en bijwerken', async () => {
  const items = [
    { ...controleerItem({ ...goedRepo, id: 'uit-repo', repo: 'https://github.com/x/uit-repo' }).item, catalogus: STANDAARD_CATALOGUS },
    { ...controleerItem({ ...goedPakket, id: 'uit-pakket', package: 'https://x.example/uit-pakket.oppx', version: '3.0.0' }).item, catalogus: STANDAARD_CATALOGUS },
  ];
  const { dienst, voorkeuren, log } = nepDienst({
    teksten: {
      'https://api.github.com/repos/x/uit-repo/releases/latest': release('uit-repo', '1.5.0'),
      'https://api.github.com/repos/x/eigen/releases/latest': release('eigen', '0.9.0'),
    },
  });
  voorkeuren.extensionSources = {
    eigen: { soort: 'custom', link: 'https://github.com/x/eigen', catalogus: '' },
    'vaste-link': { soort: 'custom', link: 'https://x.example/vaste-link.oppx', catalogus: '' },
  };
  const geinstalleerd = [
    { id: 'uit-repo', version: '1.4.2' },     // uit een bestand, in de catalogus: update
    { id: 'uit-pakket', version: '3.0.0' },   // al de nieuwste
    { id: 'eigen', version: '0.8.0' },        // eigen GitHub-link: update
    { id: 'vaste-link', version: '1.0.0' },   // vaste .oppx zonder versie-info: niets
    { id: 'los', version: '1.0.0' },          // geen bron: niets
  ];
  assert.deepEqual(await dienst.zoekUpdates(geinstalleerd, items), { 'uit-repo': '1.5.0', eigen: '0.9.0' });

  await dienst.werkBij('uit-repo', items);
  assert.equal(voorkeuren.extensionSources['uit-repo'].soort, 'catalog', 'na bijwerken staat de catalogus als bron');
  await dienst.werkBij('eigen', items);
  assert.equal(log.pakket.at(-1).verwachtId, 'eigen', 'bijwerken via eigen link houdt hetzelfde id');
  await assert.rejects(dienst.werkBij('los', items), /No source/);

  await dienst.vergeetBron('eigen');
  assert.equal(voorkeuren.extensionSources.eigen, undefined);
});

test('een onbereikbare release breekt het zoeken naar updates niet', async () => {
  const items = [{ ...controleerItem({ ...goedRepo, id: 'stil' }).item, catalogus: STANDAARD_CATALOGUS }];
  const { dienst } = nepDienst();
  assert.deepEqual(await dienst.zoekUpdates([{ id: 'stil', version: '1.0.0' }], items), {});
});
