// Het menu "Meer" van de mobiele werkbalk (#953): elk item doet iets, heeft
// een label in alle talen, en staat alleen uit als het niets kan doen.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import { MOBIELE_ACTIES, actieUit, geselecteerdeMarkeringen, heeftKlembord } from './mobiele-acties.js';

const bron = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const LOCALES = new URL('../i18n/locales/', import.meta.url);
const talen = readdirSync(LOCALES);
const json = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));
const waarde = (obj, sleutel) => sleutel.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const plaatshouders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('elke actie heeft een handler in MobileApp en het menu staat erin', () => {
  const mobiel = bron('../solid/MobileApp.jsx');
  const blok = mobiel.slice(mobiel.indexOf('const ACTIE_HANDLERS = {'), mobiel.indexOf('};', mobiel.indexOf('const ACTIE_HANDLERS = {')));
  assert.ok(blok.length > 0, 'ACTIE_HANDLERS ontbreekt');
  for (const { id } of MOBIELE_ACTIES) {
    assert.match(blok, new RegExp(`\\b${id}: `), `${id} heeft geen handler`);
  }
  assert.match(mobiel, /<For each=\{MOBIELE_ACTIES\}>/);
  assert.match(mobiel, /id="mobile-more"/);
  // De camera via de bestandskiezer.
  assert.match(mobiel, /accept="image\/\*" capture="environment"[^>]*ref=\{photoInputRef\}/);
  assert.match(mobiel, /accept="image\/\*" capture="environment"[^>]*ref=\{scanInputRef\}/);
  // Delen staat ook in de lade.
  assert.match(mobiel, /id="mobile-share" onClick=\{handleShare\}/);
});

test('geen dubbele acties', () => {
  const ids = MOBIELE_ACTIES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('elk label en elke melding bestaat in alle talen, met de Engelse plaatshouders', () => {
  assert.equal(talen.length, 40);
  const en = json('en', 'common');
  const sleutels = [
    ...MOBIELE_ACTIES.map((a) => a.label),
    ...Object.keys(en.share).map((k) => `share.${k}`),
    ...Object.keys(en.mobileMore).map((k) => `mobileMore.${k}`),
  ];
  for (const taal of talen) {
    const common = json(taal, 'common');
    for (const s of sleutels) {
      const tekst = waarde(common, s);
      assert.equal(typeof tekst, 'string', `${taal}: common.${s} ontbreekt`);
      assert.ok(tekst.trim(), `${taal}: common.${s} is leeg`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(waarde(en, s)), `${taal}: common.${s}`);
    }
  }
  // De melders van #953 schrijven Italiaans; nl en it zijn echt vertaald.
  for (const taal of ['nl', 'it']) {
    assert.notEqual(json(taal, 'common').share.share, en.share.share, taal);
    assert.notEqual(json(taal, 'common').mobileMore.scanDocument, en.mobileMore.scanDocument, taal);
  }
});

test('wanneer een actie uit staat', () => {
  const state = {};
  const doc = { pdfDoc: {}, selectedAnnotations: [], selectedAnnotation: null };
  assert.equal(actieUit('share', { doc, state }), false);
  assert.equal(actieUit('insertImage', { doc, state }), false);
  assert.equal(actieUit('copyMarkup', { doc, state }), true);
  assert.equal(actieUit('deleteMarkup', { doc, state }), true);
  assert.equal(actieUit('pasteMarkup', { doc, state }), true);

  const a = { id: 'a' };
  const metSelectie = { ...doc, selectedAnnotation: a };
  assert.equal(actieUit('copyMarkup', { doc: metSelectie, state }), false);
  assert.equal(actieUit('deleteMarkup', { doc: metSelectie, state }), false);
  // Een vergrendelde markering is niet te verwijderen.
  assert.equal(actieUit('deleteMarkup', { doc: { ...doc, selectedAnnotations: [{ locked: true }] }, state }), true);

  assert.equal(actieUit('pasteMarkup', { doc, state: { clipboardAnnotation: a } }), false);
  assert.equal(actieUit('pasteMarkup', { doc, state: { clipboardAnnotations: [a, a] } }), false);

  // Zonder document kan alleen scannen (dat maakt een nieuw document).
  for (const { id } of MOBIELE_ACTIES) {
    assert.equal(actieUit(id, { doc: null, state }), id !== 'scanDocument', id);
  }
});

test('de selectie: meervoudig gaat voor enkel', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  assert.deepEqual(geselecteerdeMarkeringen({ selectedAnnotations: [a, b], selectedAnnotation: a }), [a, b]);
  assert.deepEqual(geselecteerdeMarkeringen({ selectedAnnotations: [], selectedAnnotation: b }), [b]);
  assert.deepEqual(geselecteerdeMarkeringen({ selectedAnnotations: [null] }), []);
  assert.deepEqual(geselecteerdeMarkeringen(null), []);
  assert.equal(heeftKlembord({ clipboardAnnotations: [] }), false);
});
