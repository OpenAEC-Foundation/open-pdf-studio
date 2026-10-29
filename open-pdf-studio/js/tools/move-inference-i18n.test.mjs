// Hulplijnen bij verplaatsen (#519): elke taal heeft de voorkeursteksten en
// de namen van de hulplijnen, echt vertaald.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('../i18n/locales/', import.meta.url);
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8').replace(/\r\n/g, '\n'));

const VOORKEUR = ['moveInference', 'moveInferenceTracking', 'moveInferenceExtension', 'moveInferenceParallel', 'moveInferenceHint'];
const NAMEN = ['onAxisX', 'onAxisY', 'fromPoint', 'extension', 'parallel', 'perpendicular', 'intersection', 'polar', 'locked'];

// Woorden die in die taal echt gelijk zijn aan het Engels.
const GELIJK_AAN_ENGELS = new Set(['Polar', 'Parallel', 'Perpendicular', 'Intersection']);

function teksten(taal) {
  const p = lees(taal, 'preferences').behavior || {};
  const c = lees(taal, 'common').moveInference || {};
  const uit = {};
  for (const k of VOORKEUR) uit[`behavior.${k}`] = p[k];
  for (const k of NAMEN) uit[`moveInference.${k}`] = c[k];
  return uit;
}

test('alle talen hebben de sleutels, niet leeg', () => {
  const talen = readdirSync(LOCALES);
  assert.ok(talen.length >= 40);
  for (const taal of talen) {
    for (const [k, v] of Object.entries(teksten(taal))) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${taal} ${k} ontbreekt`);
    }
  }
});

test('geen taal kopieert de Engelse tekst, en G / mv, Shift en Tab blijven staan', () => {
  const en = teksten('en');
  const fout = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const t = teksten(taal);
    for (const [k, v] of Object.entries(en)) {
      if (t[k] === v && !GELIJK_AAN_ENGELS.has(v)) fout.push(`${taal} ${k}: ${v}`);
    }
    if (!t['behavior.moveInference'].includes('G / mv')) fout.push(`${taal} behavior.moveInference mist "G / mv"`);
    if (!t['behavior.moveInferenceHint'].includes('Shift') && !/Maj|Mayús|Maiusc/.test(t['behavior.moveInferenceHint'])) fout.push(`${taal} hint mist Shift`);
    if (!t['behavior.moveInferenceHint'].includes('Tab')) fout.push(`${taal} hint mist Tab`);
  }
  assert.deepEqual(fout, []);
});
