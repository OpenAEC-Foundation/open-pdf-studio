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

function lees(taal, deel = 'signatureVerification') {
  const data = JSON.parse(readFileSync(join(MAP, taal, 'dialogs.json'), 'utf8'));
  return Object.fromEntries(plat(data[deel] || {}));
}

const plaatshouders = (tekst) => (String(tekst).match(/\{\{\w+\}\}/g) || []).sort();

test('40 locales met identieke handtekeningsleutels en plaatshouders', () => {
  const talen = readdirSync(MAP);
  assert.equal(talen.length, 40);
  const en = lees('en');
  assert.equal(Object.keys(en).length, 94);
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
  // Crate open-pdf-signatures (repo-root); CRLF van een Windows-checkout gelijktrekken.
  const rust = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../open-pdf-signatures/src/status.rs'), 'utf8')
    .replace(/\r\n/g, '\n');
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

// "Digitaal ondertekenen" (dialogs:digitalSign, ondertekenen.js en de dialoog).
const ONDERTEKENEN_GELIJK = { it: ['File', 'Password'] };

test('ondertekenen: alle locales met dezelfde sleutels en plaatshouders, en vertaald', () => {
  const en = lees('en', 'digitalSign');
  assert.equal(Object.keys(en).length, 55);
  const gevonden = [];
  for (const taal of readdirSync(MAP)) {
    const t = lees(taal, 'digitalSign');
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(en)) {
      assert.ok(t[sleutel].trim().length > 0, `${taal} ${sleutel} leeg`);
      assert.deepEqual(plaatshouders(t[sleutel]), plaatshouders(tekst), `${taal} ${sleutel}`);
      if (taal !== 'en' && t[sleutel] === tekst && !zonderTekst(tekst) && !(ONDERTEKENEN_GELIJK[taal] || []).includes(tekst)) {
        gevonden.push(`${taal} ${sleutel}: ${tekst}`);
      }
    }
  }
  assert.deepEqual(gevonden, []);
});

test('ondertekenen: elke foutcode uit Rust heeft een melding', async () => {
  const { foutMelding } = await import('./ondertekenen-regels.js');
  const en = lees('en', 'digitalSign');
  const bron = (pad) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), pad), 'utf8').replace(/\r\n/g, '\n');
  const codes = (rust, naam) => {
    const blok = rust.slice(rust.indexOf(`pub enum ${naam}`));
    const lijf = blok.slice(0, blok.indexOf('\n}'));
    return [...lijf.matchAll(/^    ([A-Z]\w+)/gm)].map((m) => m[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
  };
  const onderteken = codes(bron('../../../../open-pdf-signatures/src/onderteken.rs'), 'OndertekenFout');
  const info = codes(bron('../../../../open-pdf-signatures/src/certificaat.rs'), 'InfoFout');
  assert.ok(onderteken.length >= 14, onderteken.join());
  for (const code of [...onderteken, ...info]) {
    const { sleutel } = foutMelding({ code, detail: 'x' });
    assert.notEqual(sleutel, code === 'intern' ? null : 'digitalSign.errors.internal', `${code} zonder eigen melding`);
    assert.ok(en[sleutel.slice('digitalSign.'.length)], `${sleutel} ontbreekt`);
  }
});

test('ribbon: knop Digitaal ondertekenen in alle locales vertaald', () => {
  const en = JSON.parse(readFileSync(join(MAP, 'en', 'ribbon.json'), 'utf8')).comment;
  for (const taal of readdirSync(MAP)) {
    const c = JSON.parse(readFileSync(join(MAP, taal, 'ribbon.json'), 'utf8')).comment;
    for (const k of ['digitalSign', 'digitalSignTooltip']) {
      assert.ok(c[k] && c[k].trim(), `${taal} ${k}`);
      if (taal !== 'en') assert.notEqual(c[k], en[k], `${taal} ${k} niet vertaald`);
    }
  }
});
