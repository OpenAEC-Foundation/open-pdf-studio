import assert from 'node:assert/strict';
import test from 'node:test';
import { textItemColors } from './mcp-text-color.js';

test('read tool follows PDF fill colours across saved graphics state', () => {
  const OPS = { save: 1, restore: 2, setFillRGBColor: 3, showText: 4 };
  const operatorList = {
    fnArray: [3, 4, 1, 3, 4, 2, 4],
    argsArray: [['#112233'], [[{ unicode: 'Red' }]], null, ['#abcdef'], [[{ unicode: 'Blue' }]], null, [[{ unicode: 'Again' }]]],
  };
  assert.deepEqual(textItemColors([{ str: 'Red' }, { str: 'Blue' }, { str: 'Again' }], operatorList, OPS),
    ['#112233', '#abcdef', '#112233']);
});

test('PDF default fill is black before the first colour operator', () => {
  const OPS = { showText: 4 };
  assert.deepEqual(textItemColors([{ str: 'Plain' }],
    { fnArray: [4], argsArray: [[[{ unicode: 'Plain' }]]] }, OPS), ['#000000']);
});
