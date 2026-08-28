import assert from 'node:assert/strict';
import test from 'node:test';

import { segmentDistance, eraserHitsPath } from './eraser-hit.js';

test('kruisende segmenten hebben afstand 0', () => {
  assert.equal(segmentDistance(0, 0, 10, 10, 0, 10, 10, 0), 0);
});

test('evenwijdige segmenten: afstand = loodrechte tussenruimte', () => {
  assert.equal(segmentDistance(0, 0, 10, 0, 0, 5, 10, 5), 5);
});

test('segmenten uit elkaars verlengde: afstand tussen dichtstbijzijnde eindpunten', () => {
  assert.equal(segmentDistance(0, 0, 10, 0, 13, 4, 20, 4), 5);
});

test('rakende segmenten (T-vorm, eindpunt op segment) hebben afstand 0', () => {
  assert.equal(segmentDistance(0, 0, 10, 0, 5, 0, 5, 8), 0);
});

test('gum raakt pad wanneer de veegbeweging het pad kruist', () => {
  const path = [{ x: 0, y: 10 }, { x: 20, y: 10 }];
  assert.equal(eraserHitsPath(10, 0, 10, 20, path, 2), true);
});

test('gum mist pad buiten de tolerantie', () => {
  const path = [{ x: 0, y: 10 }, { x: 20, y: 10 }];
  assert.equal(eraserHitsPath(0, 20, 20, 20, path, 2), false);
});

test('gum raakt pad binnen tolerantie zonder kruising', () => {
  const path = [{ x: 0, y: 10 }, { x: 20, y: 10 }];
  assert.equal(eraserHitsPath(0, 12, 20, 12, path, 3), true);
});

test('stilstaande gum (nul-segment) werkt als puntafstand', () => {
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  assert.equal(eraserHitsPath(5, 2, 5, 2, path, 3), true);
  assert.equal(eraserHitsPath(5, 9, 5, 9, path, 3), false);
});

test('pad met één punt gedraagt zich als stip', () => {
  const path = [{ x: 5, y: 5 }];
  assert.equal(eraserHitsPath(0, 5, 10, 5, path, 1), true);
  assert.equal(eraserHitsPath(0, 0, 10, 0, path, 1), false);
});

test('leeg of ontbrekend pad raakt nooit', () => {
  assert.equal(eraserHitsPath(0, 0, 10, 10, [], 5), false);
  assert.equal(eraserHitsPath(0, 0, 10, 10, null, 5), false);
});

test('meerpunts-pad: alleen het geraakte segment telt', () => {
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  // Verticale veeg door het tweede (verticale) segment
  assert.equal(eraserHitsPath(5, 5, 15, 5, path, 1), true);
  // Veeg ver weg van beide segmenten
  assert.equal(eraserHitsPath(0, 20, 20, 20, path, 1), false);
});
