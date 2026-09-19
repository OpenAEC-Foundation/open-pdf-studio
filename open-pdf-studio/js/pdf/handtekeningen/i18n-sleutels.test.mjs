import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Alle locales hebben dezelfde handtekeningsleutels met dezelfde plaatshouders als Engels.
const MAP = join(dirname(fileURLToPath(import.meta.url)), '../../i18n/locales');

function plat(obj, voorvoegsel = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? plat(v, `${voorvoegsel}${k}.`) : [[`${voorvoegsel}${k}`, v]]);
}

function lees(taal) {
  const data = JSON.parse(readFileSync(join(MAP, taal, 'dialogs.json'), 'utf8'));
  return Object.fromEntries(plat(data.signatureVerification || {}));
}

const plaatshouders = (tekst) => (String(tekst).match(/\{\{\w+\}\}/g) || []).sort();

test('39 locales met identieke handtekeningsleutels en plaatshouders', () => {
  const talen = readdirSync(MAP);
  assert.equal(talen.length, 39);
  const en = lees('en');
  assert.equal(Object.keys(en).length, 90);
  for (const taal of talen) {
    const t = lees(taal);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(en)) {
      assert.ok(t[sleutel].trim().length > 0, `${taal} ${sleutel} leeg`);
      assert.deepEqual(plaatshouders(t[sleutel]), plaatshouders(tekst), `${taal} ${sleutel}`);
    }
  }
});

test('elk signaal uit Rust heeft een vertaling, en weergave.js kent dezelfde lijst', async () => {
  const { SIGNALEN } = await import('./weergave.js');
  const rust = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../src-tauri/src/handtekening/status.rs'), 'utf8');
  const blok = rust.slice(rust.indexOf('pub mod signaal'), rust.indexOf('/// Alle codes, voor tests.'));
  const codes = [...blok.matchAll(/pub const \w+: &str = "([a-z-]+)";/g)].map((m) => m[1]);
  assert.equal(codes.length, 24);
  assert.deepEqual([...SIGNALEN].sort(), [...codes].sort());
  const en = lees('en');
  for (const code of [...codes, 'unknown']) {
    assert.ok(en[`signals.${code}`], `signals.${code} ontbreekt`);
  }
  const bekend = new Set([...codes, 'unknown']);
  const overbodig = Object.keys(en).filter((k) => k.startsWith('signals.') && !bekend.has(k.slice(8)));
  assert.deepEqual(overbodig, []);
});

// Woorden die in sommige talen terecht hetzelfde zijn als in het Engels.
const GELIJK_TOEGESTAAN = {
  '*': ['Status', 'Details', 'OK'],
  id: ['Valid'],
};

// Alleen plaatshouders, spaties en leestekens (opmaakpatronen): geen tekst om te vertalen.
const zonderTekst = (tekst) => !/\p{L}/u.test(String(tekst).replace(/\{\{\w+\}\}/g, ''));

test('niet-Engelse locales nemen geen Engelse tekst over', () => {
  const en = lees('en');
  const gevonden = [];
  for (const taal of readdirSync(MAP)) {
    if (taal === 'en') continue;
    const toegestaan = new Set([...GELIJK_TOEGESTAAN['*'], ...(GELIJK_TOEGESTAAN[taal] || [])]);
    const t = lees(taal);
    for (const [sleutel, tekst] of Object.entries(en)) {
      if (t[sleutel] !== tekst || zonderTekst(tekst) || toegestaan.has(tekst)) continue;
      gevonden.push(`${taal} ${sleutel}: ${tekst}`);
    }
  }
  assert.deepEqual(gevonden, []);
});

test('uitzonderingslijst bevat geen overbodige woorden', () => {
  const en = Object.values(lees('en'));
  for (const woord of [...GELIJK_TOEGESTAAN['*'], ...GELIJK_TOEGESTAAN.id]) {
    if (woord === 'OK') continue; // algemene uitzondering, staat niet in deze namespace
    assert.ok(en.includes(woord), `${woord} komt niet (meer) voor in het Engels`);
  }
});
