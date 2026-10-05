// Een maat met het bijschrift IN de lijn (PDF /CP /Inline): de maatlijn is
// onderbroken waar de tekst staat, en de tekst staat midden op de lijn.
//
// De getallen komen uit de appearance van een maat uit een ander programma
// ("5,9 m ", Arial 9, lijndikte 1): de punten van de pijlen liggen op 186,754
// en 337,504, de onderbreking is tekstbreedte + 1 = 26,01 breed en ligt
// midden tussen de punten (262,13). In het model liggen de eindpunten op de
// hulplijnen, één lijndikte verder (185,754 en 338,504): die inspringing doet
// de functie zelf.

import assert from 'node:assert/strict';
import test from 'node:test';

import { inlineMaatlijn, helveticaBreedte, KORTE_MAAT_TEKSTAFSTAND } from './maatlijn-inline.js';

const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

test('de tekstbreedte volgt de Helvetica/Arial-maten', () => {
  bijna(helveticaBreedte('5,9 m ', 9), 25.011, 1e-9, '"5,9 m "');
  bijna(helveticaBreedte('0,82 m ', 9), 30.015, 1e-9, '"0,82 m "');
  assert.equal(helveticaBreedte('', 9), 0);
});

test('de maatlijn is onderbroken voor het bijschrift, midden tussen de pijlpunten', () => {
  const r = inlineMaatlijn({
    startX: 185.754, startY: 148.5, endX: 338.504, endY: 148.5,
    lineWidth: 1, headSize: 7.794, startHead: 'closed', endHead: 'closed',
    tekstBreedte: helveticaBreedte('5,9 m ', 9), fontSize: 9,
  });
  assert.equal(r.buiten, false);
  assert.equal(r.lijnstukken.length, 2);
  const [a, b] = r.lijnstukken;
  bijna(a.x1, 186.754, 0.05, 'eerste stuk begint op de punt');
  bijna(a.x2, 249.124, 0.05, 'eerste stuk tot de onderbreking');
  bijna(b.x1, 275.134, 0.05, 'tweede stuk vanaf de onderbreking');
  bijna(b.x2, 337.504, 0.05, 'tweede stuk tot de punt');
  bijna(b.x1 - a.x2, 26.011, 0.01, 'onderbreking = tekstbreedte + 1');
  bijna((a.x2 + b.x1) / 2, 262.129, 0.01, 'midden van de onderbreking');
  for (const s of r.lijnstukken) assert.equal(s.y1, 148.5);
  // De tekst staat midden op de lijn, niet erboven.
  bijna(r.tekst.x, 262.129, 0.01, 'tekst in het midden');
  bijna(r.tekst.y, 148.5, 1e-9, 'tekst op de lijn');
  assert.equal(r.tekst.hoek, 0);
  // De punten liggen één lijndikte binnen de modelpunten en wijzen naar buiten.
  assert.deepEqual(r.koppen.map((k) => [Math.round(k.x * 1000) / 1000, k.y, k.hoek, k.stijl]),
    [[186.754, 148.5, Math.PI, 'closed'], [337.504, 148.5, 0, 'closed']]);
});

test('een maat zonder tekst is niet onderbroken', () => {
  const r = inlineMaatlijn({ startX: 0, startY: 0, endX: 100, endY: 0, lineWidth: 1, headSize: 8,
    startHead: 'closed', endHead: 'closed', tekstBreedte: 0, fontSize: 9 });
  assert.deepEqual(r.lijnstukken, [{ x1: 1, y1: 0, x2: 99, y2: 0 }]);
});

test('bij een korte maat staan de punten buiten de hulplijnen en de tekst ernaast', () => {
  // "0,82 m ": /L-lengte 21,17. Twee punten van 7,79 en een tekst van 30 pt
  // passen niet tussen de hulplijnen. Zoals in de appearance van die maat:
  // punten één lijndikte buiten de hulplijnen, naar binnen gericht, met een
  // staart van 19 pt naar buiten, en de tekst naast de lijn, aan de kant
  // van de lijn die van het gemeten punt af ligt.
  const r = inlineMaatlijn({
    startX: 0, startY: 0, endX: 21.17, endY: 0,
    leaderStartX: 0, leaderStartY: 9.73, leaderEndX: 21.17, leaderEndY: 9.73,
    lineWidth: 1, headSize: 9 * Math.cos(Math.PI / 6), startHead: 'closed', endHead: 'closed',
    tekstBreedte: helveticaBreedte('0,82 m ', 9), fontSize: 9,
  });
  assert.equal(r.buiten, true);
  const [a, b] = r.lijnstukken;
  bijna(a.x1, -20, 1e-6, 'staart begin');
  bijna(a.x2, -1, 1e-6, 'punt begin');
  bijna(b.x1, 22.17, 1e-6, 'punt eind');
  bijna(b.x2, 41.17, 1e-6, 'staart eind');
  assert.deepEqual(r.koppen.map((k) => [Math.round(k.x * 1000) / 1000, k.hoek]), [[-1, 0], [22.17, Math.PI]],
    'de punten wijzen naar binnen');
  bijna(r.tekst.x, 10.585, 1e-9, 'tekst midden langs de lijn');
  bijna(r.tekst.y, -KORTE_MAAT_TEKSTAFSTAND * 9, 1e-9, 'tekst naast de lijn, weg van het gemeten punt');
  bijna(KORTE_MAAT_TEKSTAFSTAND * 9, 12.13, 0.05, 'afstand zoals in de appearance');
});

test('een staande maat leest van onder naar boven, ook als de lijn naar beneden loopt', () => {
  // y omlaag: een lijn van boven naar onder heeft hoek +90°.
  const r = inlineMaatlijn({ startX: 0, startY: 0, endX: 0.17, endY: 74.78, lineWidth: 1, headSize: 7.794,
    startHead: 'closed', endHead: 'closed', tekstBreedte: 25, fontSize: 9 });
  // 89,87° wordt -90,13°: omgedraaid, dus van onder naar boven.
  bijna(r.tekst.hoek, Math.atan2(74.78, 0.17) - Math.PI, 1e-9, 'hoek');
});

test('een draaiing van de weergave telt mee voor de leesrichting', () => {
  // Op een pagina met /Rotate 90 is een in de ongedraaide pagina liggende lijn
  // naar links op het scherm staand: hij moet daar van onder naar boven lezen.
  const r = inlineMaatlijn({ startX: 100, startY: 0, endX: 0, endY: 0, lineWidth: 1, headSize: 8,
    startHead: 'closed', endHead: 'closed', tekstBreedte: 20, fontSize: 9, draaiing: Math.PI / 2 });
  bijna(r.tekst.hoek + Math.PI / 2, -Math.PI / 2, 1e-9, 'op het scherm -90°');
});
