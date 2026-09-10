// Symboolschaal (issue #357): de maat waarop een symbool geplaatst wordt.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normaliseerSchaal, schaalMaat, schaalVakOmMidden, schaalLabel,
  STANDAARD_SCHAAL, MIN_SCHAAL, MAX_SCHAAL, SCHAAL_STAPPEN,
} from './symbol-scale.js';

test('zonder keuze is de schaal ware grootte', () => {
  assert.equal(STANDAARD_SCHAAL, 1);
  assert.equal(normaliseerSchaal(undefined), 1);
  assert.equal(normaliseerSchaal(null), 1);
  assert.equal(normaliseerSchaal(''), 1);
});

test('onzin valt terug op ware grootte in plaats van het symbool te laten verdwijnen', () => {
  assert.equal(normaliseerSchaal(0), 1);
  assert.equal(normaliseerSchaal(-2), 1);
  assert.equal(normaliseerSchaal('abc'), 1);
  assert.equal(normaliseerSchaal(NaN), 1);
  assert.equal(normaliseerSchaal(Infinity), 1);
});

test('een komma als decimaalteken wordt begrepen', () => {
  assert.equal(normaliseerSchaal('0,5'), 0.5);
  assert.equal(normaliseerSchaal('1,5'), 1.5);
});

test('te groot of te klein wordt afgekapt, niet geweigerd', () => {
  assert.equal(normaliseerSchaal(0.001), MIN_SCHAAL);
  assert.equal(normaliseerSchaal(9999), MAX_SCHAAL);
});

test('alle stappen uit de keuzelijst liggen binnen de grenzen', () => {
  for (const s of SCHAAL_STAPPEN) {
    assert.equal(normaliseerSchaal(s), s, `stap ${s} wordt afgekapt`);
  }
  assert.ok(SCHAAL_STAPPEN.includes(1), 'ware grootte hoort in de lijst');
});

test('schaalMaat vermenigvuldigt breedte en hoogte', () => {
  assert.deepEqual(schaalMaat({ width: 80, height: 40 }, 2), { width: 160, height: 80 });
  assert.deepEqual(schaalMaat({ width: 80, height: 40 }, 0.5), { width: 40, height: 20 });
});

test('schaalMaat laat de overige velden staan', () => {
  const uit = schaalMaat({ width: 10, height: 10, bron: 'svg' }, 3);
  assert.equal(uit.bron, 'svg');
});

test('schaalMaat rondt af op honderdsten', () => {
  assert.deepEqual(schaalMaat({ width: 33.333, height: 10 }, 0.3), { width: 10, height: 3 });
});

test('schaalVakOmMidden houdt het symbool op het klikpunt', () => {
  const vak = { x: 100, y: 100, width: 40, height: 20 };
  const uit = schaalVakOmMidden(vak, 2);
  assert.deepEqual(uit, { x: 80, y: 90, width: 80, height: 40 });
  // Het midden is niet verschoven.
  assert.equal(uit.x + uit.width / 2, vak.x + vak.width / 2);
  assert.equal(uit.y + uit.height / 2, vak.y + vak.height / 2);
});

test('schaal 1 laat een vak volledig ongemoeid', () => {
  const vak = { x: 3, y: 4, width: 40, height: 20 };
  assert.equal(schaalVakOmMidden(vak, 1), vak);
});

test('het label leest als op de knop', () => {
  assert.equal(schaalLabel(1), '1x');
  assert.equal(schaalLabel(0.5), '0,5x');
  assert.equal(schaalLabel(2), '2x');
  assert.equal(schaalLabel('rommel'), '1x');
});

test('ware grootte raakt de maat niet aan, ook niet door afronding', () => {
  // Een symbool met een echte maat houdt zijn exacte beeldverhouding; afronden
  // zou die verstoren (brak de bestaande svg-real-size-test).
  const maat = { width: 65 * 3.1234567, height: 14 * 3.1234567 };
  const uit = schaalMaat(maat, 1);
  assert.equal(uit, maat, 'zelfde object terug');
  assert.ok(Math.abs(uit.width / uit.height - 65 / 14) < 1e-12);
});
