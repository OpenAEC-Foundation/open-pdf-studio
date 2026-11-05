import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bereikTekst, leesBereik, naarIndexen, mappingNaInvoegen, mappingNaVervangen, kiesBronPaginas } from './bron-paginas-kiezen.js';

test('bereikTekst vat opeenvolgende pagina\'s samen', () => {
  assert.equal(bereikTekst([1, 2, 3, 5, 7, 8]), '1-3, 5, 7-8');
  assert.equal(bereikTekst([4]), '4');
  assert.equal(bereikTekst([]), '');
  assert.equal(bereikTekst([3, 1, 2, 2]), '1-3');
});

test('leesBereik: geldige invoer', () => {
  assert.deepEqual(leesBereik('1-3, 5', 8), [1, 2, 3, 5]);
  assert.deepEqual(leesBereik(' 2 ,5-6,', 8), [2, 5, 6]);
  assert.deepEqual(leesBereik('6-4', 8), [4, 5, 6]);
  assert.deepEqual(leesBereik('7-20', 8), [7, 8]);
  assert.deepEqual(leesBereik('', 8), []);
});

test('leesBereik: ongeldige invoer is null', () => {
  assert.equal(leesBereik('0', 8), null);
  assert.equal(leesBereik('9', 8), null);
  assert.equal(leesBereik('a-b', 8), null);
  assert.equal(leesBereik('12-20', 8), null);
  assert.equal(leesBereik('1;2', 8), null);
});

test('rondgang: tekst van een keuze leest dezelfde keuze terug', () => {
  const keuze = [1, 2, 4, 6, 7, 8];
  assert.deepEqual(leesBereik(bereikTekst(keuze), 8), keuze);
});

test('naarIndexen: 0-based, gesorteerd, uniek, binnen de bron', () => {
  assert.deepEqual(naarIndexen([5, 2, 2, 9, 0], 8), [1, 4]);
});

test('mapping na invoegen van de gekozen pagina\'s', () => {
  // 3 pagina's na pagina 2 van een document van 4.
  assert.deepEqual(mappingNaInvoegen(4, 2, 3), { 1: 1, 2: 2, 3: 6, 4: 7 });
  // Vóór pagina 1.
  assert.deepEqual(mappingNaInvoegen(2, 0, 1), { 1: 2, 2: 3 });
});

test('mapping na vervangen van één pagina door de gekozen pagina\'s', () => {
  assert.deepEqual(mappingNaVervangen(4, 2, 3), { 1: 1, 2: null, 3: 5, 4: 6 });
  assert.deepEqual(mappingNaVervangen(3, 3, 1), { 1: 1, 2: 2, 3: null });
});

test('een bron van één pagina vraagt niets', async () => {
  assert.deepEqual(await kiesBronPaginas(new Uint8Array(), 'x.pdf', 1), [0]);
  assert.deepEqual(await kiesBronPaginas(new Uint8Array(), 'x.pdf', 0), []);
});

test('venster geregistreerd, gebruikt bij invoegen en vervangen, teksten in elke taal', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const host = bron('../solid/components/DialogHost.jsx');
  assert.match(host, /'choose-pages': ChoosePagesDialog/);
  const pm = bron('./page-manager.js');
  assert.match(pm, /kiesBronPaginas\(srcBytes, [^)]*\)[^\n]*'insert'\)/);
  assert.match(pm, /kiesBronPaginas\(srcBytes, [^)]*\)[^\n]*'replace'\)/);
  // De stille CAD-import neemt alle pagina's.
  assert.match(pm, /if \(!stil && srcPageCount > 1\)/);
  const map = new URL('../i18n/locales/', import.meta.url);
  for (const taal of readdirSync(map)) {
    const d = JSON.parse(readFileSync(new URL(`${taal}/dialogs.json`, map), 'utf8'));
    for (const k of ['title', 'from', 'selected', 'all', 'none', 'insert', 'replace']) {
      assert.ok(d.choosePages?.[k], `${taal}: choosePages.${k}`);
    }
  }
});
