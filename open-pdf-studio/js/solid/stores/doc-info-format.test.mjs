import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOC_INFO_EMPTY,
  formatDocPages,
  formatPageSizeMm,
  formatPageSize,
  createLatestOnly,
  readDocInfoDeps,
} from './doc-info-format.js';

test('paginalabel toont huidige pagina en totaal', () => {
  assert.equal(formatDocPages(1, 28), '1 / 28');
  assert.equal(formatDocPages(17, 28), '17 / 28');
  assert.equal(formatDocPages(4, 4), '4 / 4');
});

test('zonder geladen document (geen totaal) blijft het paginalabel leeg', () => {
  assert.equal(formatDocPages(1, undefined), DOC_INFO_EMPTY);
  assert.equal(formatDocPages(1, null), DOC_INFO_EMPTY);
  assert.equal(formatDocPages(1, 0), DOC_INFO_EMPTY);
  assert.equal(formatDocPages(1, 2.5), DOC_INFO_EMPTY);
});

test('huidige pagina wordt binnen het bereik gehouden', () => {
  assert.equal(formatDocPages(0, 28), '1 / 28');
  assert.equal(formatDocPages(99, 28), '28 / 28');
  assert.equal(formatDocPages(undefined, 28), '1 / 28');
});

test('paginaformaat in mm met één decimaal', () => {
  // A4 staand
  assert.equal(formatPageSizeMm(595.276, 841.89), '210.0 x 297.0 mm');
  // A1 liggend (zoals een technische tekening)
  assert.equal(formatPageSizeMm(2384, 1684), '841.0 x 594.1 mm');
});

test('ongeldige afmetingen geven een leeg paginaformaat', () => {
  assert.equal(formatPageSizeMm(0, 842), DOC_INFO_EMPTY);
  assert.equal(formatPageSizeMm(595, -1), DOC_INFO_EMPTY);
  assert.equal(formatPageSizeMm(NaN, 842), DOC_INFO_EMPTY);
  assert.equal(formatPageSizeMm(undefined, undefined), DOC_INFO_EMPTY);
});

test('alleen de laatst gestarte verversing is actueel', () => {
  const guard = createLatestOnly();
  const a = guard.begin();
  assert.equal(guard.isCurrent(a), true);
  const b = guard.begin();
  assert.equal(guard.isCurrent(a), false);
  assert.equal(guard.isCurrent(b), true);
});

test('een trage oudere verversing overschrijft een nieuwere niet', async () => {
  // Nabootsing van populateDocInfo: bij openen (pagina 1, trage getPage) en
  // direct daarna een scroll-gestuurde wissel (pagina 5, snelle getPage).
  const guard = createLatestOnly();
  const panel = { pages: DOC_INFO_EMPTY, pageSize: DOC_INFO_EMPTY };
  const sizes = { 1: [595.276, 841.89], 5: [2384, 1684] };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function refresh(page, getPageMs) {
    const token = guard.begin();
    panel.pages = formatDocPages(page, 28);
    await delay(getPageMs);
    if (!guard.isCurrent(token)) return;
    panel.pageSize = formatPageSizeMm(...sizes[page]);
  }

  await Promise.all([refresh(1, 30), refresh(5, 1)]);
  assert.equal(panel.pages, '5 / 28');
  assert.equal(panel.pageSize, '841.0 x 594.1 mm');
});

test('afhankelijkheden van de documentinfo', () => {
  assert.deepEqual(readDocInfoDeps(null), [null, null, null, null]);

  const pdfDoc = { numPages: 28 };
  const loading = { filePath: 'C:/x/rapport.pdf', pdfDoc: null, currentPage: 1 };
  assert.deepEqual(readDocInfoDeps(loading), ['C:/x/rapport.pdf', null, null, 1]);

  const loaded = { ...loading, pdfDoc };
  assert.deepEqual(readDocInfoDeps(loaded), ['C:/x/rapport.pdf', pdfDoc, 28, 1]);

  const scrolled = { ...loaded, currentPage: 12 };
  assert.notDeepEqual(readDocInfoDeps(scrolled), readDocInfoDeps(loaded));
});


test('physical sheet size follows metric, imperial and both preferences', () => {
  assert.equal(formatPageSize(2592, 1728, 'metric'), '914.4 x 609.6 mm');
  assert.equal(formatPageSize(2592, 1728, 'imperial'), '36.00 x 24.00 in');
  assert.equal(formatPageSize(2592, 1728), '914.4 x 609.6 mm (36.00 x 24.00 in)');
  assert.equal(formatPageSize(2592, 1728, 'unknown'), formatPageSize(2592, 1728));
  assert.equal(formatPageSize(1728, 2592, 'imperial'), '24.00 x 36.00 in');
  assert.equal(formatPageSize(595.276, 841.89, 'imperial'), '8.27 x 11.69 in');
});

test('invalid physical sizes remain unavailable in every unit system', () => {
  for (const system of ['metric', 'imperial', 'both']) {
    for (const value of [0, -1, NaN, Infinity, undefined, null]) {
      assert.equal(formatPageSize(value, 72, system), DOC_INFO_EMPTY);
      assert.equal(formatPageSize(72, value, system), DOC_INFO_EMPTY);
    }
  }
});
