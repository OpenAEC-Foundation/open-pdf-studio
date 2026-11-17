// Getalvelden: tekstvelden met het gedrag van een getalveld, maar komma én
// punt als decimaalteken. Getest met een nagebootst invoerveld.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maakGetalVeld, installeerGetalVelden, stapWaarde, verwerkPijl, verwerkVerlaten,
  verwerkVoorInvoer, verwerkInvoer, verwerkToetsVooraf, zichtbareTekst, isGetalVeld,
} from './getal-veld.js';

class NepInvoer {
  constructor(attrs = {}) {
    this._tekst = '';
    this.attrs = attrs;
    this.disabled = false;
    this.readOnly = false;
    this.ownerDocument = { activeElement: null, defaultView: { Event: NepEvent } };
    this.events = [];
  }
  get value() { return this._tekst; }
  set value(v) { this._tekst = String(v); }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  dispatchEvent(e) { this.events.push(e.type); return true; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { this.ownerDocument.activeElement = null; }
}

class NepEvent {
  constructor(type) { this.type = type; }
}

function veld(attrs, taal = 'nl') {
  installeerGetalVelden({ taal: () => taal });
  const el = new NepInvoer(attrs);
  maakGetalVeld(el);
  return el;
}

test('komma en punt geven dezelfde value', () => {
  const el = veld();
  el._tekst = '0,1';
  assert.equal(el.value, '0.1');
  assert.equal(parseFloat(el.value), 0.1);
  assert.equal(el.valueAsNumber, 0.1);
  el._tekst = '0.1';
  assert.equal(el.value, '0.1');
  el._tekst = '1.234,5';
  assert.equal(Number(el.value), 1234.5);
});

test('onzin geeft een lege value, zoals een getalveld', () => {
  const el = veld();
  for (const t of ['abc', '-', ',', '', '1,2,3']) {
    el._tekst = t;
    assert.equal(el.value, '', t);
    assert.ok(Number.isNaN(el.valueAsNumber));
  }
});

test('een toegewezen waarde verschijnt in de notatie van de taal', () => {
  const nl = veld({}, 'nl');
  nl.value = 0.1;
  assert.equal(zichtbareTekst(nl), '0,1');
  nl.value = '0.10';
  assert.equal(zichtbareTekst(nl), '0,1', 'zelfde getal: tekst blijft staan');
  nl.value = '2.50';
  assert.equal(zichtbareTekst(nl), '2,50');
  const en = veld({}, 'en');
  en.value = 0.1;
  assert.equal(zichtbareTekst(en), '0.1');
  nl.value = undefined;
  assert.equal(zichtbareTekst(nl), '', 'undefined wordt leeg, niet "undefined"');
  nl.value = 'Mixed';
  assert.equal(zichtbareTekst(nl), '', 'geen getal: leeg zoals bij een getalveld');
});

test('wat er al stond, wordt bij het opwaarderen omgezet', () => {
  installeerGetalVelden({ taal: () => 'nl' });
  const el = new NepInvoer();
  el._tekst = '0.25';
  maakGetalVeld(el);
  assert.equal(zichtbareTekst(el), '0,25');
  assert.equal(el.value, '0.25');
  assert.ok(isGetalVeld(el));
  maakGetalVeld(el); // tweede keer: geen dubbele laag
  assert.equal(el.value, '0.25');
});

test('tijdens het typen blijft de notatie van de gebruiker staan', () => {
  const el = veld({}, 'nl');
  el.focus();
  el._tekst = '0.1';
  // De invoerhandler zet het gelezen getal terug in het veld.
  el.value = parseFloat(el.value);
  assert.equal(zichtbareTekst(el), '0.1');
  // Bij het verlaten volgt de notatie van de taal.
  el.blur();
  verwerkVerlaten(el);
  assert.equal(zichtbareTekst(el), '0,1');
  assert.equal(el.value, '0.1');
});

test('tijdens het typen wint de tekst van de gebruiker van een terugvalwaarde', () => {
  installeerGetalVelden({ taal: () => 'nl' });
  const el = new NepInvoer();
  maakGetalVeld(el);
  el.value = 12;
  el.focus();
  // "0,1" typen in een veld waarvan de handler 0 vervangt door 1.
  const handler = () => { const n = parseFloat(el.value); el.value = n > 0 ? n : 1; };
  for (const tekst of ['0', '0,', '0,1']) {
    el._tekst = tekst;
    verwerkInvoer({ target: el });
    handler();
    assert.equal(zichtbareTekst(el), tekst, `na "${tekst}"`);
  }
  assert.equal(el.value, '0.1');
  el.blur();
  verwerkVerlaten(el);
  assert.equal(zichtbareTekst(el), '0,1', 'niets meer uitgesteld; notatie van de taal');
});

test('het minteken en een leeg veld blijven staan tot het veld verlaten wordt', () => {
  installeerGetalVelden({ taal: () => 'nl' });
  const el = new NepInvoer();
  maakGetalVeld(el);
  el.value = 12;
  el.focus();
  el._tekst = '-';
  verwerkInvoer({ target: el });
  el.value = parseInt(el.value, 10) || 12; // typische terugval in een handler
  assert.equal(zichtbareTekst(el), '-');
  el._tekst = '-3';
  verwerkInvoer({ target: el });
  el.value = parseInt(el.value, 10) || 12;
  assert.equal(zichtbareTekst(el), '-3');
  el._tekst = '';
  verwerkInvoer({ target: el });
  el.value = 12;
  assert.equal(zichtbareTekst(el), '');
  el.blur();
  verwerkVerlaten(el);
  assert.equal(zichtbareTekst(el), '12', 'de uitgestelde waarde komt bij het verlaten');
});

test('Enter laat de handler de tekst direct zetten, ook met focus', () => {
  installeerGetalVelden({ taal: () => 'nl' });
  const el = new NepInvoer();
  maakGetalVeld(el);
  el.focus();
  el._tekst = '500';
  verwerkInvoer({ target: el });
  el.value = 100; // begrensd tijdens het typen: uitgesteld
  assert.equal(zichtbareTekst(el), '500');
  verwerkToetsVooraf({ target: el, key: 'Enter' });
  el.value = 100; // de Enter-handler bevestigt
  assert.equal(zichtbareTekst(el), '100');
});

test('een programmatische waarde in een veld met focus maar zonder typen komt direct', () => {
  installeerGetalVelden({ taal: () => 'nl' });
  const el = new NepInvoer();
  maakGetalVeld(el);
  el.focus();
  el.value = 2.5;
  assert.equal(zichtbareTekst(el), '2,5');
});

test('stappen met pijltjes volgt step, min en max', () => {
  assert.equal(stapWaarde('5', 1, {}), 6);
  assert.equal(stapWaarde('5', -1, {}), 4);
  assert.equal(stapWaarde('0,1', 1, { step: '0.1' }), 0.2);
  assert.equal(stapWaarde('0.2', 1, { step: '0.1' }), 0.3, 'geen 0.30000000000000004');
  assert.equal(stapWaarde('0,25', 1, { step: '0.5', min: '0' }), 0.5, 'naar het raster');
  assert.equal(stapWaarde('0,25', -1, { step: '0.5', min: '0' }), 0);
  assert.equal(stapWaarde('20', 1, { max: '20' }), 20);
  assert.equal(stapWaarde('1', -1, { min: '1' }), 1);
  assert.equal(stapWaarde('', 1, { min: '4' }), 4);
  assert.equal(stapWaarde('', 1, {}), 0);
  assert.equal(stapWaarde('3', 1, { step: 'any' }), 4);
  assert.equal(stapWaarde('7', 1, { step: '5', min: '5', max: '100' }), 10);
});

test('pijltoets stapt, toont in de taal en stuurt input en change', () => {
  const el = veld({ step: '0.05', min: '0' }, 'nl');
  el.value = '0.1';
  let tegengehouden = false;
  const e = { target: el, key: 'ArrowUp', defaultPrevented: false, preventDefault() { tegengehouden = true; } };
  assert.equal(verwerkPijl(e), true);
  assert.ok(tegengehouden);
  assert.equal(zichtbareTekst(el), '0,15');
  assert.equal(el.value, '0.15');
  assert.deepEqual(el.events, ['input', 'change']);
});

test('pijltoets doet niets als een component hem al afhandelde of het veld vastzit', () => {
  const el = veld({}, 'nl');
  el.value = 3;
  assert.equal(verwerkPijl({ target: el, key: 'ArrowUp', defaultPrevented: true, preventDefault() {} }), false);
  el.readOnly = true;
  assert.equal(verwerkPijl({ target: el, key: 'ArrowUp', defaultPrevented: false, preventDefault() {} }), false);
  el.readOnly = false;
  assert.equal(verwerkPijl({ target: el, key: 'ArrowLeft', defaultPrevented: false, preventDefault() {} }), false);
  assert.equal(el.value, '3');
  const gewoon = new NepInvoer();
  assert.equal(verwerkPijl({ target: gewoon, key: 'ArrowUp', defaultPrevented: false, preventDefault() {} }), false);
});

test('letters worden geweigerd, cijfers en scheidingstekens niet', () => {
  const el = veld();
  const probeer = (data) => {
    let geweigerd = false;
    verwerkVoorInvoer({ target: el, inputType: 'insertText', data, preventDefault() { geweigerd = true; } });
    return geweigerd;
  };
  assert.equal(probeer('0,1'), false);
  assert.equal(probeer('0.1'), false);
  assert.equal(probeer('-'), false);
  assert.equal(probeer('a'), true);
  assert.equal(probeer('1:100'), true);
});

// ── Lengtevelden (data-getal="lengte", #1145) ──────────────────────────────

test('a length field hands a feet-inch length through as typed', () => {
  const el = veld({ 'data-getal': 'lengte' });
  el._tekst = `12'-6 3/8"`;
  assert.equal(el.value, `12'-6 3/8"`);
  assert.ok(Number.isNaN(el.valueAsNumber));
  el._tekst = ` 6" `;
  assert.equal(el.value, `6"`);
  // Een kaal getal blijft een gewoon getal, komma of punt.
  el._tekst = '12,5';
  assert.equal(el.value, '12.5');
  // Half getypt of onzin: leeg, zoals bij een getalveld.
  for (const t of [`12' 6 3/`, `6 3/8`, `12'6'`, 'abc']) {
    el._tekst = t;
    assert.equal(el.value, '', t);
  }
});

test('a plain number field still refuses a feet-inch length', () => {
  const el = veld();
  el._tekst = `12'-6"`;
  assert.equal(el.value, '');
  const e = { target: el, inputType: 'insertText', data: "'", preventDefault() { this.geweigerd = true; } };
  verwerkVoorInvoer(e);
  assert.equal(e.geweigerd, true);
});

test('a length field takes the characters of a feet-inch length, not letters', () => {
  const el = veld({ 'data-getal': 'lengte' });
  for (const data of ["'", '"', '/', ' ', `12'-6 3/8"`, '′', '″']) {
    const e = { target: el, inputType: 'insertText', data, preventDefault() { this.geweigerd = true; } };
    verwerkVoorInvoer(e);
    assert.equal(e.geweigerd, undefined, data);
  }
  const e = { target: el, inputType: 'insertText', data: 'x', preventDefault() { this.geweigerd = true; } };
  verwerkVoorInvoer(e);
  assert.equal(e.geweigerd, true);
});

test('a feet-inch length assigned to a length field stays as it is', () => {
  const el = veld({ 'data-getal': 'lengte' });
  el.value = `12'-6"`;
  assert.equal(zichtbareTekst(el), `12'-6"`);
  // Verlaten en pijltjes laten de maat met rust.
  verwerkVerlaten(el);
  assert.equal(zichtbareTekst(el), `12'-6"`);
  const pijl = { target: el, key: 'ArrowUp', preventDefault() { this.gestopt = true; } };
  assert.equal(verwerkPijl(pijl), false);
  assert.equal(zichtbareTekst(el), `12'-6"`);
  // Een getal daarna volgt weer de notatie van de taal.
  el.value = '0.5';
  assert.equal(zichtbareTekst(el), '0,5');
});
