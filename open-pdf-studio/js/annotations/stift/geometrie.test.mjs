import assert from 'node:assert/strict';
import test from 'node:test';

import { geometrieSoort, stiftMidden, raaktStiftPunt, stiftPuntVak, synchroniseerVak, haaksPunt } from './geometrie.js';

test('een stift leent de geometriesoort van zijn tekenwijze', () => {
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'lijn' }), 'polyline');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'pijl' }), 'line');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'kruis' }), 'box');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'punt' }), 'stiftPunt');
  assert.equal(geometrieSoort({ type: 'stift' }), 'polyline');
  assert.equal(geometrieSoort({ type: 'box' }), 'box');
  assert.equal(geometrieSoort({ type: 'stiftLegenda' }), 'stiftLegenda');
  assert.equal(geometrieSoort(null), undefined);
});

test('midden per tekenwijze', () => {
  assert.deepEqual(stiftMidden({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 2, y: 8 }] }), [5, 4]);
  assert.deepEqual(stiftMidden({ vorm: 'pijl', startX: 0, startY: 0, endX: 10, endY: 20 }), [5, 10]);
  assert.deepEqual(stiftMidden({ vorm: 'punt', x: 3, y: 4 }), [3, 4]);
  assert.deepEqual(stiftMidden({ vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 }), [25, 40]);
  assert.deepEqual(stiftMidden({ vorm: 'lijn', points: [] }), [0, 0]);
});

test('een punt raak je binnen de halve maat plus de tolerantie', () => {
  const p = { x: 100, y: 100 };
  assert.equal(raaktStiftPunt(p, 105, 100, 1, 12), true);
  assert.equal(raaktStiftPunt(p, 108, 100, 1, 12), false);
  assert.deepEqual(stiftPuntVak(p, 12), { x: 94, y: 94, width: 12, height: 12 });
});

test('het vak volgt de geometrie; een omgekeerd kruis wordt rechtgezet', () => {
  assert.deepEqual(
    synchroniseerVak({ vorm: 'lijn', points: [{ x: 5, y: 9 }, { x: 1, y: 3 }] }),
    { vorm: 'lijn', points: [{ x: 5, y: 9 }, { x: 1, y: 3 }], x: 1, y: 3, width: 4, height: 6 },
  );
  const pijl = synchroniseerVak({ vorm: 'pijl', startX: 10, startY: 0, endX: 0, endY: 5 });
  assert.deepEqual([pijl.x, pijl.y, pijl.width, pijl.height], [0, 0, 10, 5]);
  const kruis = synchroniseerVak({ vorm: 'kruis', x: 50, y: 50, width: -20, height: -10 });
  assert.deepEqual([kruis.x, kruis.y, kruis.width, kruis.height], [30, 40, 20, 10]);
  assert.deepEqual(synchroniseerVak({ vorm: 'punt', x: 1, y: 2 }), { vorm: 'punt', x: 1, y: 2 });
});

test('haaks: de grootste richting wint', () => {
  assert.deepEqual(haaksPunt({ x: 0, y: 0 }, 10, 3), { x: 10, y: 0 });
  assert.deepEqual(haaksPunt({ x: 0, y: 0 }, 2, -9), { x: 0, y: -9 });
});
