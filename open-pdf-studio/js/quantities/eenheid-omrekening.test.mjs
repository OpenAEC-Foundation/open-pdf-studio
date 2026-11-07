// Eenheden omrekenen voor de staten: exacte factoren, één eenheid per kolom.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseerEenheid, eenheidSoort, isMetrisch, omrekenFactor, omrekenbaar,
  rekenOm, documentEenheidVoor, kiesKolomEenheid,
} from './eenheid-omrekening.js';

test('notaties worden één vorm', () => {
  assert.equal(normaliseerEenheid('m2'), 'm²');
  assert.equal(normaliseerEenheid('m^2'), 'm²');
  assert.equal(normaliseerEenheid('sq ft'), 'ft²');
  assert.equal(normaliseerEenheid('cu m'), 'm³');
  assert.equal(normaliseerEenheid(' mm '), 'mm');
  assert.equal(normaliseerEenheid('"'), 'in');
  assert.equal(normaliseerEenheid("'"), 'ft');
  assert.equal(normaliseerEenheid(null), '');
  assert.equal(normaliseerEenheid(''), '');
});

test('soort per eenheid; tellingen en onbekende eenheden hebben er geen', () => {
  for (const u of ['mm', 'cm', 'm', 'in', 'ft']) assert.equal(eenheidSoort(u), 'length', u);
  for (const u of ['mm²', 'cm²', 'm²', 'in²', 'ft²']) assert.equal(eenheidSoort(u), 'area', u);
  for (const u of ['mm³', 'm³', 'ft³']) assert.equal(eenheidSoort(u), 'volume', u);
  for (const u of ['', 'px', 'pt', 'kg', '°', 'stuks', null]) assert.equal(eenheidSoort(u), null, String(u));
  assert.equal(isMetrisch('cm²'), true);
  assert.equal(isMetrisch('ft'), false);
  assert.equal(isMetrisch('px'), false);
});

test('exacte factoren per definitie', () => {
  assert.equal(omrekenFactor('m', 'mm'), 1000);
  assert.equal(omrekenFactor('cm', 'mm'), 10);
  assert.equal(omrekenFactor('in', 'mm'), 25.4);
  assert.equal(omrekenFactor('ft', 'mm'), 304.8);
  assert.equal(omrekenFactor('ft', 'in'), 12);
  assert.equal(omrekenFactor('m²', 'mm²'), 1e6);
  assert.equal(omrekenFactor('m²', 'cm²'), 1e4);
  assert.equal(omrekenFactor('ft²', 'in²'), 144);
  assert.equal(omrekenFactor('m³', 'mm³'), 1e9);
  // Andere soort of onbekende eenheid: niet omrekenbaar.
  assert.equal(omrekenFactor('m', 'm²'), null);
  assert.equal(omrekenFactor('mm', 'px'), null);
  assert.equal(omrekenbaar('px', 'px'), true);
  assert.equal(omrekenbaar('m²', 'mm'), false);
});

test('omrekenen zonder tussentijds afronden', () => {
  assert.equal(rekenOm(4360, 'mm', 'm'), 4.36);
  assert.equal(rekenOm(2.5, 'm', 'mm'), 2500);
  assert.equal(rekenOm(1, 'ft', 'mm'), 304.8);
  assert.equal(rekenOm(10, 'ft', 'mm'), 3048);
  assert.equal(rekenOm(3048, 'mm', 'ft'), 10);
  assert.equal(rekenOm(12, 'in', 'ft'), 1);
  assert.equal(rekenOm(20_000_000, 'mm²', 'm²'), 20);
  assert.equal(rekenOm(1, 'ft²', 'in²'), 144);
  assert.ok(Math.abs(rekenOm(1, 'ft²', 'm²') - 0.09290304) < 1e-15);
  assert.ok(Math.abs(rekenOm(1, 'm³', 'ft³') - 35.31466672148859) < 1e-12);
  // Kleine waarden blijven volledig: geen afronding op weergave-decimalen.
  assert.equal(rekenOm(1, 'mm', 'm'), 0.001);
  assert.equal(rekenOm(7, 'px', 'px'), 7, 'gelijke eenheid: ongewijzigd');
  assert.equal(rekenOm(7, 'mm', 'mm²'), null);
  assert.equal(rekenOm(7, 'mm', 'px'), null);
  assert.equal(rekenOm(Number.NaN, 'mm', 'm'), null);
});

test('voorkeurseenheid bij de documentschaal', () => {
  assert.equal(documentEenheidVoor('mm', 'length'), 'mm');
  assert.equal(documentEenheidVoor('mm', 'area'), 'm²', 'zoals het blad: mm² wordt m²');
  assert.equal(documentEenheidVoor('m', 'area'), 'm²');
  assert.equal(documentEenheidVoor('ft', 'area'), 'ft²');
  assert.equal(documentEenheidVoor('cm', 'volume'), 'cm³');
  assert.equal(documentEenheidVoor(null, 'length'), null);
  assert.equal(documentEenheidVoor('px', 'length'), null);
});

test('kolomeenheid: gebruikerskeuze, dan meest voorkomend, dan documentschaal', () => {
  assert.equal(kiesKolomEenheid({ gekozen: 'm', rijEenheden: ['mm', 'mm'] }), 'm');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['mm', 'm', 'mm'] }), 'mm');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['m', 'm', 'mm'] }), 'm');
  // Gelijkspel: de eenheid van de documentschaal wint.
  assert.equal(kiesKolomEenheid({ rijEenheden: ['m', 'mm'], documentEenheid: 'mm' }), 'mm');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['mm', 'ft'], documentEenheid: 'ft' }), 'ft');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['ft²', 'm²'], documentEenheid: 'mm' }), 'm²');
  // Zonder documentschaal: metrisch, dan de eerst geziene.
  assert.equal(kiesKolomEenheid({ rijEenheden: ['ft', 'mm'] }), 'mm');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['ft', 'in'] }), 'ft');
  // Lege rij-eenheden tellen niet; zonder enige eenheid de vaste.
  assert.equal(kiesKolomEenheid({ rijEenheden: ['', null, 'm'] }), 'm');
  assert.equal(kiesKolomEenheid({ rijEenheden: [], vast: 'm²' }), 'm²');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['m2', 'm²', 'mm²'] }), 'm²', 'notaties tellen samen');
});
