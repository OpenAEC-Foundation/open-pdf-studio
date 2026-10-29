// De teksten voor het annuleren van een save (#766) staan echt vertaald in
// elke taal, en Alles vlakken geeft de annulering door aan de saver.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const locales = new URL('../i18n/locales/', import.meta.url);
const talen = readdirSync(locales).filter((t) => !t.startsWith('.'));
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, locales), 'utf8'));
const SLEUTELS = [
  ['common', ['savingPdf']], ['common', ['saveCancelling']], ['common', ['saveCancelled']],
  ['common', ['saveCancelTooLate']], ['ribbon', ['flattenAll', 'cancelled']],
];
const waarde = (obj, pad) => pad.reduce((o, k) => o?.[k], obj);

test('every locale has a real translation of the save-cancel texts', () => {
  assert.ok(talen.length >= 37, `locales: ${talen.length}`);
  for (const [ns, pad] of SLEUTELS) {
    const en = waarde(lees('en', ns), pad);
    assert.equal(typeof en, 'string');
    for (const taal of talen) {
      const tekst = waarde(lees(taal, ns), pad);
      assert.equal(typeof tekst, 'string', `${taal}/${ns}: ${pad.join('.')}`);
      assert.ok(tekst.trim().length > 0, `${taal}/${ns}: ${pad.join('.')} is empty`);
      if (taal !== 'en') assert.notEqual(tekst, en, `${taal}/${ns}: ${pad.join('.')} is not translated`);
    }
  }
});

test('Flatten All passes its cancel token to the annotation build and commits before reloading', () => {
  const bron = readFileSync(new URL('./flatten-all.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(bron, /bouwAnnotatieDocument\(doc, \{ annulering \}\)/);
  const vastleggen = bron.indexOf('annulering.vastleggen()');
  const herladen = bron.indexOf('await reloadFromBytes(nieuweBytes');
  assert.ok(vastleggen > 0 && vastleggen < herladen, 'the point of no return is right before the model changes');
  assert.match(bron, /t\('flattenAll\.cancelled'\)/);
});
