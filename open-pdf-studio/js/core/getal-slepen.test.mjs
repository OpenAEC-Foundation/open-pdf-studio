// De rekenkunde van het slepen op een getalveld (#1168).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLEEP_DREMPEL, PIXELS_PER_STAP, kiesAs, sleepPixels, factorVoor, standaardStap,
  stapVoorVeld, beginSleep, sleepNaar, aantalDecimalen,
} from './getal-slepen.js';

const P = PIXELS_PER_STAP;

test('de as ligt pas vast voorbij de drempel en volgt de grootste afstand', () => {
  assert.equal(SLEEP_DREMPEL, 4);
  assert.equal(kiesAs(0, 0), null);
  assert.equal(kiesAs(3, -3), null);
  assert.equal(kiesAs(4, 0), 'x');
  assert.equal(kiesAs(-5, 2), 'x');
  assert.equal(kiesAs(1, -6), 'y');
  assert.equal(kiesAs(2, 7), 'y');
  assert.equal(kiesAs(4, 4), 'x', 'gelijk: horizontaal');
  assert.equal(kiesAs(NaN, 1), null);
});

test('naar rechts en omhoog is meer', () => {
  assert.equal(sleepPixels('x', 12, -30), 12);
  assert.equal(sleepPixels('x', -12, 30), -12);
  assert.equal(sleepPixels('y', 12, -30), 30);
  assert.equal(sleepPixels('y', 12, 30), -30);
});

test('Shift is tien keer sneller, Alt of Ctrl tien keer fijner', () => {
  assert.equal(factorVoor({}), 1);
  assert.equal(factorVoor({ shift: true }), 10);
  assert.equal(factorVoor({ fijn: true }), 0.1);
  assert.equal(factorVoor({ shift: true, fijn: true }), 1);
});

test('standaardstap volgt de precisie en de grootte', () => {
  assert.equal(standaardStap(14), 1);
  assert.equal(standaardStap(0), 1);
  assert.equal(standaardStap(999), 1);
  assert.equal(standaardStap(2500), 10);
  assert.equal(standaardStap(-40000), 100);
  assert.equal(standaardStap(1.5), 0.1);
  assert.equal(standaardStap(0.25), 0.01);
  assert.equal(standaardStap(0.12345), 0.001, 'niet fijner dan duizendsten');
  assert.equal(standaardStap(2, 1), 0.1, 'de getoonde tekst "2,0" telt');
});

test('de stap van een veld: data-step, dan step, dan de standaard', () => {
  assert.equal(stapVoorVeld({ sleepStap: '0.1', stap: '1', waarde: 2 }), 0.1);
  assert.equal(stapVoorVeld({ sleepStap: null, stap: '5', waarde: 2 }), 5);
  assert.equal(stapVoorVeld({ stap: 'any', waarde: 0.25 }), 0.01);
  assert.equal(stapVoorVeld({ stap: '0', waarde: 14 }), 1);
  assert.equal(stapVoorVeld({ stap: '0.5', waarde: 3, geheel: true }), 1, 'hele getallen stappen heel');
  assert.equal(stapVoorVeld({ stap: '10', waarde: 3, geheel: true }), 10);
});

test('pixels worden stappen', () => {
  const st = beginSleep({ waarde: 14, stap: 1 });
  assert.equal(sleepNaar(st, 0).waarde, 14);
  assert.equal(sleepNaar(st, P - 1).waarde, 14);
  assert.equal(sleepNaar(st, P).waarde, 15);
  assert.equal(sleepNaar(st, 10 * P).waarde, 24);
  assert.equal(sleepNaar(st, -3 * P).waarde, 11);
  assert.equal(sleepNaar(st, -(P - 1)).waarde, 14, 'naar nul toe afgekapt, in beide richtingen gelijk');
});

test('de beginwaarde blijft het anker (geen sprong naar het raster)', () => {
  const st = beginSleep({ waarde: 14.5, stap: 1 });
  assert.equal(sleepNaar(st, 2 * P).waarde, 16.5);
});

test('decimale stappen zonder drijvende-kommastaart', () => {
  const st = beginSleep({ waarde: 0.1, stap: 0.1 });
  assert.equal(sleepNaar(st, 2 * P).waarde, 0.3);
  assert.equal(sleepNaar(st, 7 * P).waarde, 0.8);
  const fijn = sleepNaar(beginSleep({ waarde: 1, stap: 0.1 }), 3 * P, { fijn: true });
  assert.equal(fijn.waarde, 1.03);
});

test('min en max begrenzen', () => {
  const st = beginSleep({ waarde: 95, stap: 1, min: '0', max: '100' });
  assert.equal(sleepNaar(st, 20 * P).waarde, 100);
  assert.equal(sleepNaar(st, -200 * P).waarde, 0);
  const open = beginSleep({ waarde: 5, stap: 1, min: '', max: null });
  assert.equal(sleepNaar(open, -20 * P).waarde, -15);
});

test('Shift en Alt veranderen de stap', () => {
  const st = beginSleep({ waarde: 10, stap: 1 });
  assert.equal(sleepNaar(st, 3 * P, { shift: true }).waarde, 40);
  assert.equal(sleepNaar(st, 3 * P, { fijn: true }).waarde, 10.3);
});

test('een toets halverwege laat de waarde niet verspringen', () => {
  let st = beginSleep({ waarde: 10, stap: 1 });
  st = sleepNaar(st, 5 * P);
  assert.equal(st.waarde, 15);
  st = sleepNaar(st, 5 * P, { shift: true });
  assert.equal(st.waarde, 15, 'Shift indrukken zonder te bewegen');
  st = sleepNaar(st, 7 * P, { shift: true });
  assert.equal(st.waarde, 35);
  st = sleepNaar(st, 7 * P);
  assert.equal(st.waarde, 35, 'Shift loslaten');
  st = sleepNaar(st, 6 * P);
  assert.equal(st.waarde, 34);
  st = sleepNaar(st, 8 * P, { fijn: true });
  assert.equal(st.waarde, 34.2);
});

test('hele getallen blijven heel, ook met Alt', () => {
  const st = beginSleep({ waarde: 3, stap: 1, min: '1', geheel: true });
  assert.equal(sleepNaar(st, 4 * P, { fijn: true }).waarde, 7);
  assert.equal(sleepNaar(st, 2 * P, { shift: true }).waarde, 23);
  assert.equal(sleepNaar(st, -50 * P).waarde, 1);
  const krom = beginSleep({ waarde: 2.6, stap: 1, geheel: true });
  assert.equal(sleepNaar(krom, P).waarde, 4, 'afgerond op een heel getal');
});

test('een veld met eigen fijne en grove stap (voet-inch)', () => {
  const st = beginSleep({ waarde: 150, stap: 1, min: 0.0625, fijneStap: 0.0625, groveStap: 12 });
  assert.equal(sleepNaar(st, 2 * P).waarde, 152);
  assert.equal(sleepNaar(st, 3 * P, { fijn: true }).waarde, 150.1875);
  assert.equal(sleepNaar(st, 2 * P, { shift: true }).waarde, 174);
  assert.equal(sleepNaar(st, -500 * P).waarde, 0.0625);
});

test('aantalDecimalen', () => {
  assert.equal(aantalDecimalen(1), 0);
  assert.equal(aantalDecimalen(0.25), 2);
  assert.equal(aantalDecimalen(1e-7), 7);
});
