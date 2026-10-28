// Dynamic stamps (#629): every language has all texts, really translated,
// with the {{...}} placeholders and the {field} syntax intact.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('./locales/', import.meta.url);
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8').replace(/\r\n/g, '\n'));

// Flat key → text for the dynamic-stamp texts of one language.
function teksten(taal) {
  const d = lees(taal, 'dialogs');
  const p = lees(taal, 'properties');
  const uit = {};
  const plat = (obj, pre) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object') plat(v, `${pre}${k}.`);
      else uit[`${pre}${k}`] = v;
    }
  };
  plat({ dynamicTitle: d.stampPicker?.dynamicTitle, manage: d.stampPicker?.manage }, 'stampPicker.');
  plat(d.stampFields, 'stampFields.');
  plat(d.stampTemplates, 'stampTemplates.');
  plat(p.dynamicStamp, 'dynamicStamp.');
  return uit;
}

const EN = teksten('en');
const SLEUTELS = Object.keys(EN).sort();

test('all 40 languages have every dynamic-stamp text, not empty', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  assert.ok(SLEUTELS.length >= 70, `${SLEUTELS.length} keys`);
  for (const taal of talen) {
    const t = teksten(taal);
    assert.deepEqual(Object.keys(t).sort(), SLEUTELS, taal);
    for (const k of SLEUTELS) assert.ok(typeof t[k] === 'string' && t[k].trim(), `${taal} ${k} is empty`);
  }
});

test('sentences are translated, not copied from English', () => {
  // Short words (Image, Text, Date ...) can be the same in other languages;
  // the sentences never are.
  const zinnen = SLEUTELS.filter((k) => EN[k].split(' ').length >= 4);
  assert.ok(zinnen.length >= 15);
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const t = teksten(taal);
    for (const k of zinnen) if (t[k] === EN[k]) gekopieerd.push(`${taal} ${k}`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('{{placeholders}} and the built-in {field} names are kept', () => {
  const fout = [];
  for (const taal of readdirSync(LOCALES)) {
    const t = teksten(taal);
    for (const k of SLEUTELS) {
      const verwacht = (EN[k].match(/\{\{\w+\}\}/g) || []).sort();
      const echt = (t[k].match(/\{\{\w+\}\}/g) || []).sort();
      if (JSON.stringify(verwacht) !== JSON.stringify(echt)) fout.push(`${taal} ${k}: ${echt.join(',')}`);
    }
    for (const veld of ['{date}', '{time}', '{datetime}', '{user}', '{page}', '{pages}', '{filename}', '{title}']) {
      if (!t['stampTemplates.syntaxHelp'].includes(veld)) fout.push(`${taal} syntaxHelp mist ${veld}`);
    }
    for (const token of ['yyyy', 'MMMM', 'EEEE']) {
      if (!t['stampTemplates.customFormatHelp'].includes(token)) fout.push(`${taal} customFormatHelp mist ${token}`);
    }
  }
  assert.deepEqual(fout, []);
});
