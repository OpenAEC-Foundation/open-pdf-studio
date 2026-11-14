import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTO, TESSERACT_NAAR_BCP47, isGeldigeCode, isGeldigeTaalSpec, bcp47Voor, taalNaam, sorteerOpNaam,
  bouwTaalSpec, ontleedTaalSpec, beginKeuze, teDownloaden, ontleedTaalFout,
} from './ocr-talen.js';

// OCR languages (#1083): names, language specs and the choice on opening.
const HIER = dirname(fileURLToPath(import.meta.url));
const VARIANTEN = { vertical: 'vertical', historic: 'historic', fraktur: 'Fraktur', equations: 'Math / equations' };

/** The allowlist from the Rust module, so both sides stay in step. */
function rustLijst() {
  const bron = readFileSync(join(HIER, '../../src-tauri/src/ocr_talen.rs'), 'utf8');
  const blok = /DOWNLOADBARE_TALEN: &\[&str\] = &\[([\s\S]*?)\];/.exec(bron)[1];
  return [...blok.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

test('codes: same rule as the Rust side', () => {
  for (const c of ['nld', 'eng', 'chi_sim', 'srp_latn', 'chi_tra_vert']) assert.ok(isGeldigeCode(c), c);
  for (const c of ['', 'nl', 'NLD', '../eng', 'eng.traineddata', 'nld+eng', 'nld_', 'a_b_c_d', null, 5]) {
    assert.ok(!isGeldigeCode(c), String(c));
  }
});

test('language specs', () => {
  for (const s of ['auto', 'eng', 'nld+eng', 'chi_tra+eng']) assert.ok(isGeldigeTaalSpec(s), s);
  for (const s of ['', '+', 'nld+', 'osd', 'eng+osd', 'Auto', 'nld eng', undefined, Array(9).fill('eng').join('+')]) {
    assert.ok(!isGeldigeTaalSpec(s), String(s));
  }
});

test('every language in the Rust allowlist has a BCP 47 code or a special name', () => {
  const lijst = rustLijst();
  assert.ok(lijst.length > 100);
  for (const c of lijst) {
    const naam = taalNaam(c, 'en', { varianten: VARIANTEN });
    assert.ok(bcp47Voor(c) || c === 'equ', `${c} has no BCP 47 code`);
    assert.notEqual(naam, c, `${c} has no readable name`);
  }
  // No stale entries in the mapping.
  for (const c of Object.keys(TESSERACT_NAAR_BCP47)) assert.ok(lijst.includes(c), `${c} is not downloadable`);
});

test('readable names in the UI language', () => {
  assert.equal(taalNaam('nld', 'en'), 'Dutch');
  assert.equal(taalNaam('nld', 'nl'), 'Nederlands');
  assert.equal(taalNaam('deu', 'fr'), 'Allemand');
  assert.equal(taalNaam('chi_tra', 'en'), 'Traditional Chinese');
  assert.equal(taalNaam('chi_sim', 'en'), 'Simplified Chinese');
  assert.equal(taalNaam('srp_latn', 'en'), 'Serbian (Latin)');
  assert.equal(taalNaam('chi_tra_vert', 'en', { varianten: VARIANTEN }), 'Traditional Chinese (vertical)');
  assert.equal(taalNaam('ita_old', 'en', { varianten: VARIANTEN }), 'Italian (historic)');
  assert.equal(taalNaam('frk', 'en', { varianten: VARIANTEN }), 'German (Fraktur)');
  assert.equal(taalNaam('equ', 'en', { varianten: VARIANTEN }), 'Math / equations');
});

test('names fall back to the code', () => {
  // A code the mapping does not know (a file the user dropped in).
  assert.equal(taalNaam('xyz', 'en'), 'xyz');
  // Without Intl.DisplayNames.
  assert.equal(taalNaam('nld', 'en', { DisplayNames: null }), 'nld');
  // An Intl that throws for the locale falls back to English.
  class Kapot extends Intl.DisplayNames {
    constructor(locales, opts) {
      if (locales[0] === 'xx') throw new RangeError('bad locale');
      super(locales, opts);
    }
  }
  assert.equal(taalNaam('nld', 'xx', { DisplayNames: Kapot }), 'Dutch');
  assert.equal(taalNaam('equ', 'en'), 'equ');
  assert.equal(taalNaam('../x', 'en'), '../x');
});

test('sorting by name', () => {
  const naam = (c) => taalNaam(c, 'en');
  assert.deepEqual(sorteerOpNaam(['nld', 'deu', 'eng'], naam, 'en'), ['nld', 'eng', 'deu']);
});

test('building the spec: automatic, a language, with English', () => {
  assert.equal(bouwTaalSpec(AUTO, true), 'auto');
  assert.equal(bouwTaalSpec('', false), 'auto');
  assert.equal(bouwTaalSpec('nld', false), 'nld');
  assert.equal(bouwTaalSpec('nld', true), 'nld+eng');
  assert.equal(bouwTaalSpec('eng', true), 'eng');
  assert.equal(bouwTaalSpec('chi_tra', true), 'chi_tra+eng');
});

test('parsing the spec back', () => {
  assert.deepEqual(ontleedTaalSpec('auto'), { taal: 'auto', ookEngels: false });
  assert.deepEqual(ontleedTaalSpec('nld+eng'), { taal: 'nld', ookEngels: true });
  assert.deepEqual(ontleedTaalSpec('eng+nld'), { taal: 'nld', ookEngels: true });
  assert.deepEqual(ontleedTaalSpec('nld'), { taal: 'nld', ookEngels: false });
  assert.deepEqual(ontleedTaalSpec('eng'), { taal: 'eng', ookEngels: false });
  assert.deepEqual(ontleedTaalSpec('../x'), { taal: 'auto', ookEngels: false });
  for (const [taal, en] of [['nld', true], ['nld', false], ['eng', false], ['auto', false]]) {
    assert.deepEqual(ontleedTaalSpec(bouwTaalSpec(taal, en)), { taal, ookEngels: en });
  }
});

test('the choice on opening: the saved spec if its languages are there', () => {
  assert.equal(beginKeuze('nld+eng', ['eng', 'nld']), 'nld+eng');
  assert.equal(beginKeuze('nld+eng', ['eng']), 'auto');
  assert.equal(beginKeuze('nld', null), 'nld');
  assert.equal(beginKeuze(undefined, ['eng']), 'auto');
  assert.equal(beginKeuze('../x', ['eng']), 'auto');
  assert.equal(beginKeuze('auto', []), 'auto');
});

test('downloadable: in the list and not present', () => {
  assert.deepEqual(teDownloaden(['eng', 'nld', 'deu', '../x'], ['eng']), ['nld', 'deu']);
  assert.deepEqual(teDownloaden(undefined, ['eng']), []);
});

test('download errors keep their code', () => {
  assert.deepEqual(ontleedTaalFout('OCR_LANGUAGE_DOWNLOAD:HTTP 404 Not Found'), { code: 'OCR_LANGUAGE_DOWNLOAD', detail: 'HTTP 404 Not Found' });
  assert.deepEqual(ontleedTaalFout(new Error('OCR_LANGUAGE_FOLDER:x')), { code: 'OCR_LANGUAGE_FOLDER', detail: 'x' });
  assert.deepEqual(ontleedTaalFout('boom'), { code: null, detail: 'boom' });
});
