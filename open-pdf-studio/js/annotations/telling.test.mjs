// Telmarkeringen: het kader voor het selectiekader (#934) en de telgroepen
// met hun nummering (#935). Pure logica, zonder app-modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tellingKader, TELMARKERING_HALF, hernummerTellingen, volgendTelNummer, telGroepen,
  telGroepVelden, GEEN_TELGROEP,
} from './telling.js';
import { inSelectieVak } from '../plattegrond/ruimte-koppeling.js';

const tel = (id, extra = {}) => ({ id, type: 'count', page: 1, x: 100, y: 100, ...extra });

test('a count marker has a box centred on its point (#934)', () => {
  const k = tellingKader(tel('a', { x: 50, y: 70 }));
  assert.deepEqual(k, { x: 50 - TELMARKERING_HALF, y: 70 - TELMARKERING_HALF, width: 22, height: 22 });
  assert.equal(tellingKader({ type: 'count' }), null, 'no point, no box');
});

test('a selection frame around count markers selects them, window and crossing (#934)', () => {
  const a = tel('a', { x: 100, y: 100 });
  const b = tel('b', { x: 300, y: 100 });
  const vak = { x: 50, y: 50, width: 100, height: 100 };
  // Window: helemaal erin.
  assert.equal(inSelectieVak(a, tellingKader(a), vak, 'window'), true);
  assert.equal(inSelectieVak(b, tellingKader(b), vak, 'window'), false);
  // Crossing: het kader raakt de markering half.
  const half = { x: 95, y: 95, width: 50, height: 50 };
  assert.equal(inSelectieVak(a, tellingKader(a), half, 'crossing'), true);
  assert.equal(inSelectieVak(a, tellingKader(a), half, 'window'), false);
});

test('the selection bounds of the app use the count box', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('../core/stores/selection-helpers.ts', import.meta.url), 'utf8');
  assert.match(bron, /case 'count':\s*\/\/[^\n]*\n\s*return tellingKader\(ann\);/);
});

test('renumbering counts each group 1..n in document order (#935)', () => {
  const anns = [
    tel('a', { categoryId: 'd', number: 1 }),
    { id: 'x', type: 'box' },
    tel('b', { categoryId: 'r', number: 1 }),
    tel('c', { categoryId: 'd', number: 3 }),
    tel('e', { categoryId: 'd', number: 4 }),
    tel('f', { number: 7 }),
  ];
  const alle = hernummerTellingen(anns);
  assert.deepEqual(alle.map(w => [w.ann.id, w.number]), [['c', 2], ['e', 3], ['f', 1]]);
  const alleenR = hernummerTellingen(anns, ['r']);
  assert.deepEqual(alleenR, [], 'group r is already right');
  const zonderGroep = hernummerTellingen(anns, [null]);
  assert.deepEqual(zonderGroep.map(w => w.ann.id), ['f']);
});

test('the next number follows the highest number or the count, whichever is larger', () => {
  const anns = [tel('a', { categoryId: 'd', number: 1 }), tel('b', { categoryId: 'd', number: 5 }), tel('c', { categoryId: 'r', number: 1 })];
  assert.equal(volgendTelNummer(anns, 'd'), 6);
  assert.equal(volgendTelNummer(anns, 'r'), 2);
  assert.equal(volgendTelNummer(anns, 'leeg'), 1);
  assert.equal(volgendTelNummer([tel('a'), tel('b')], null), 3);
});

test('groups: definitions first, then groups found only on markers, then markers without a group', () => {
  const defs = [{ id: 'd', name: 'Doors', color: '#ff0000' }, { id: 'w', name: 'Windows', color: '#0000ff' }];
  const anns = [
    tel('a', { categoryId: 'd' }), tel('b', { categoryId: 'd' }),
    tel('c', { categoryId: 'v-1', categoryName: 'Valves DN100', color: '#00aa00' }),
    tel('e'),
  ];
  const rijen = telGroepen(defs, anns);
  assert.deepEqual(rijen.map(r => [r.id, r.name, r.count]), [
    ['d', 'Doors', 2], ['w', 'Windows', 0], ['v-1', 'Valves DN100', 1], [GEEN_TELGROEP, '(geen categorie)', 1],
  ]);
  assert.equal(rijen[2].color, '#00aa00', 'colour of a group from the file comes from its marker');
  assert.equal(rijen[2].fromDocument, true);
});

test('joining a group takes its name and format; leaving all groups keeps the format', () => {
  assert.deepEqual(telGroepVelden({ id: 'd', name: 'Doors', color: '#ff0000', markerStyle: 'dot' }), {
    categoryId: 'd', categoryName: 'Doors', color: '#ff0000', strokeColor: '#ff0000', markerStyle: 'dot', symbolId: undefined,
  });
  assert.equal(telGroepVelden({ id: 's', name: 'S', color: '#000000', markerStyle: 'symbol' }).markerStyle, 'dot',
    'a symbol style without a symbol falls back to a dot');
  assert.deepEqual(telGroepVelden(null), { categoryId: null, categoryName: undefined });
});
