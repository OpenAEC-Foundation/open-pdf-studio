// Getal- en eenheidnotatie van maten per taal (#629): komma in het
// Nederlands, punt in het Engels, groepering naar de taal, een voorkeur die
// het decimaalteken vastzet, en zonder bron de oude punt-notatie.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOTATIE_PUNT, notatieVoor, stelNotatieBronIn, huidigeNotatie,
  formatGetal, formatGetalKort, formatProcent, eenheidNotatie, formatMaat, lijstScheiding,
} from './maat-notatie.js';

const NNBSP = ' ';
const NBSP = ' ';

test('zonder bron: punt, geen groepering (zoals de maten altijd toonden)', () => {
  stelNotatieBronIn(null);
  assert.equal(huidigeNotatie(), NOTATIE_PUNT);
  assert.equal(formatGetal(2.5, 2), '2.50');
  assert.equal(formatGetal(12345.6, 1), '12345.6');
  assert.equal(formatMaat(15.6, 'm²', 2), '15.60 m²');
});

test('Nederlands: decimaalkomma, groepering met punt alleen als die aan staat', () => {
  const nl = notatieVoor('nl');
  assert.equal(nl.decimaal, ',');
  assert.equal(nl.groep, '');
  assert.equal(formatGetal(2.5, 2, nl), '2,50');
  assert.equal(formatGetal(12345.678, 2, nl), '12345,68');
  const nlGroep = notatieVoor('nl', { groeperen: true });
  assert.equal(formatGetal(12345.678, 2, nlGroep), '12.345,68');
  assert.equal(formatGetal(1234567, 0, nlGroep), '1.234.567');
  assert.equal(formatMaat(15.6, 'm2', 2, nl), '15,60 m²');
});

test('Engels: decimaalpunt, groepering met komma', () => {
  const en = notatieVoor('en', { groeperen: true });
  assert.equal(formatGetal(12345.678, 2, en), '12,345.68');
  assert.equal(formatGetal(999, 0, en), '999');
  assert.equal(formatGetal(2.5, 2, notatieVoor('en')), '2.50');
});

test('Duits en Frans: komma; het Frans groepeert met de smalle vaste spatie', () => {
  const de = notatieVoor('de', { groeperen: true });
  assert.equal(formatGetal(12345.6, 1, de), '12.345,6');
  const fr = notatieVoor('fr', { groeperen: true });
  assert.equal(fr.groep, NNBSP);
  assert.equal(formatGetal(12345.6, 1, fr), `12${NNBSP}345,6`);
  // Het procentteken staat in het Frans en Duits na een vaste spatie.
  assert.equal(formatProcent(1.5, 1, fr), `1,5${NBSP}%`);
  assert.equal(formatProcent(1.5, 1, de), `1,5${NBSP}%`);
  assert.equal(formatProcent(1.5, 1, notatieVoor('nl')), '1,5%');
});

test('talen die pas vanaf vijf cijfers groeperen (Spaans)', () => {
  const es = notatieVoor('es', { groeperen: true });
  assert.equal(formatGetal(1234, 0, es), '1234');
  assert.equal(formatGetal(12345, 0, es), '12.345');
});

test('de voorkeur zet het decimaalteken vast; een botsend groepsteken wijkt', () => {
  const enKomma = notatieVoor('en', { decimaalteken: 'comma', groeperen: true });
  assert.equal(formatGetal(12345.5, 1, enKomma), '12.345,5');
  const nlPunt = notatieVoor('nl', { decimaalteken: 'point', groeperen: true });
  assert.equal(formatGetal(12345.5, 1, nlPunt), '12,345.5');
  const frPunt = notatieVoor('fr', { decimaalteken: 'point', groeperen: true });
  assert.equal(formatGetal(12345.5, 1, frPunt), `12${NNBSP}345.5`);
});

test('Arabisch-Perzisch decimaalteken wordt de komma (westerse cijfers)', () => {
  assert.equal(notatieVoor('fa').decimaal, ',');
});

test('de bron van de app: taal en voorkeur, met cache per combinatie', () => {
  let taal = 'nl';
  let keuze = 'auto';
  stelNotatieBronIn(() => ({ taal, decimaalteken: keuze, groeperen: false }));
  try {
    assert.equal(formatGetal(2.5, 2), '2,50');
    const eerst = huidigeNotatie();
    assert.equal(huidigeNotatie(), eerst, 'zelfde invoer, zelfde notatie');
    taal = 'en';
    assert.equal(formatGetal(2.5, 2), '2.50');
    keuze = 'comma';
    assert.equal(formatGetal(2.5, 2), '2,50');
    keuze = 'onzin';
    assert.equal(formatGetal(2.5, 2), '2.50', 'onbekende keuze is auto');
  } finally {
    stelNotatieBronIn(null);
  }
  assert.equal(formatGetal(2.5, 2), '2.50');
});

test('negatieve getallen, -0 en geen getal', () => {
  const nl = notatieVoor('nl', { groeperen: true });
  assert.equal(formatGetal(-12345.5, 1, nl), '-12.345,5');
  assert.equal(formatGetal(-0.001, 2, nl), '0,00');
  assert.equal(formatGetal(NaN, 2, nl), '');
  assert.equal(formatGetal(Infinity, 2, nl), '');
  assert.equal(formatProcent(-0.0004, 2, nl, { teken: true }), '0,00%');
  assert.equal(formatProcent(0.25, 2, nl, { teken: true }), '+0,25%');
  assert.equal(formatProcent(-2.5, 1, notatieVoor('tr')), '-%2,5');
});

test('kort: alleen de nodige decimalen', () => {
  const nl = notatieVoor('nl');
  assert.equal(formatGetalKort(2.5, 6, nl), '2,5');
  assert.equal(formatGetalKort(3, 6, nl), '3');
  assert.equal(formatGetalKort(0.1 + 0.2, 6, nl), '0,3');
});

test('eenheden met echte superscripts', () => {
  assert.equal(eenheidNotatie('m2'), 'm²');
  assert.equal(eenheidNotatie('m^2'), 'm²');
  assert.equal(eenheidNotatie('M2'), 'm²');
  assert.equal(eenheidNotatie('mm2'), 'mm²');
  assert.equal(eenheidNotatie('m3'), 'm³');
  assert.equal(eenheidNotatie('sq ft'), 'ft²');
  assert.equal(eenheidNotatie('m²'), 'm²');
  assert.equal(eenheidNotatie('mm'), 'mm');
  assert.equal(formatMaat(3, 'px', 0), '3');
});

test('lijstteken: puntkomma naast een decimaalkomma', () => {
  assert.equal(lijstScheiding(notatieVoor('nl')), '; ');
  assert.equal(lijstScheiding(notatieVoor('en')), ', ');
});
