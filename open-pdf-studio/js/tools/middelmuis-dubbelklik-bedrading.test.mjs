// Middel-dubbelklik = zoom alles (#767): voorkeur, vertalingen en bedrading.
// Leest alleen bronbestanden (CRLF genormaliseerd), importeert geen app-code.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = new URL('../i18n/locales/', import.meta.url);

test('voorkeur middleDoubleClickFit staat standaard aan en heeft een type', () => {
  assert.match(bron('core/constants.ts'), /middleDoubleClickFit: true,/);
  assert.match(bron('types/preferences.ts'), /middleDoubleClickFit: boolean;/);
  assert.match(bron('solid/components/preferences/BehaviorTab.jsx'), /p\.middleDoubleClickFit\[1\]\(e\.target\.checked\)/);
  assert.match(bron('solid/components/preferences/BehaviorTab.jsx'), /t\('behavior\.middleDoubleClickFit'\)/);
});

test('elke taal heeft een eigen vertaling van behavior.middleDoubleClickFit', () => {
  const talen = readdirSync(LOCALES);
  const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));
  const en = lees('en').behavior.middleDoubleClickFit;
  assert.ok(en);
  for (const taal of talen) {
    const v = lees(taal).behavior?.middleDoubleClickFit;
    assert.ok(typeof v === 'string' && v.trim().length > 0, `${taal} ontbreekt`);
    if (taal !== 'en') assert.notEqual(v, en, `${taal} is niet vertaald`);
  }
});

test('de centrale middelmuis-pan luistert ook naar move/up/cancel en roept zoomAlles aan', () => {
  const s = bron('tools/middelmuis-pan.js');
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    assert.match(s, new RegExp(`addEventListener\\('${type}'`), type);
  }
  assert.match(s, /maakMiddelmuisDubbelklik\(\)/);
  assert.match(s, /middleDoubleClickFit !== false/);
  assert.match(s, /m\.zoomAlles\(\)/);
  assert.match(bron('pdf/renderer.js'), /export async function zoomAlles\(\)/);
});
