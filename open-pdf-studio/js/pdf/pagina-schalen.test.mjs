import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseerSchaal, paginaSchaal, metPaginaSchaal, herschikSchalen, kiesPaginaSchaal, schaalUitGebied, besluitSchaalInvoer,
} from './pagina-schalen.js';

test('normaliseerSchaal reads the usual ways of writing a scale', () => {
  assert.equal(normaliseerSchaal('1:100'), '1:100');
  assert.equal(normaliseerSchaal(' 1 : 50 '), '1:50');
  assert.equal(normaliseerSchaal('200'), '1:200');
  assert.equal(normaliseerSchaal('2.5'), '1:2.5');
  assert.equal(normaliseerSchaal('1:2,5'), '1:2.5');
  assert.equal(normaliseerSchaal(''), null);
  assert.equal(normaliseerSchaal('abc'), null);
  assert.equal(normaliseerSchaal('0'), null);
  assert.equal(normaliseerSchaal('2:1'), null);
});

test('metPaginaSchaal sets and clears without touching the original', () => {
  const oud = { 1: { scaleRatio: '1:50', unit: 'mm', method: 'manual' } };
  const nieuw = metPaginaSchaal(oud, [2, 3], '1:100', 'auto-detect');
  assert.equal(oud[2], undefined);
  assert.deepEqual(nieuw[2], { scaleRatio: '1:100', unit: 'mm', method: 'auto-detect' });
  assert.equal(nieuw[1].scaleRatio, '1:50');
  const leeg = metPaginaSchaal(nieuw, [1, 2], null);
  assert.deepEqual(Object.keys(leeg), ['3']);
  assert.equal(paginaSchaal({ pageScales: leeg }, 3).scaleRatio, '1:100');
  assert.equal(paginaSchaal({ pageScales: leeg }, 1), null);
});

test('herschikSchalen moves scales with their pages and drops deleted ones', () => {
  const s = { 1: { scaleRatio: '1:100' }, 2: { scaleRatio: '1:20' }, 3: { scaleRatio: '1:5' } };
  // page 2 deleted, 3 becomes 2
  assert.deepEqual(herschikSchalen(s, { 1: 1, 2: null, 3: 2 }, 2), { 1: s[1], 2: s[3] });
  // swapped
  assert.deepEqual(herschikSchalen(s, { 1: 2, 2: 1, 3: 3 }, 3), { 1: s[2], 2: s[1], 3: s[3] });
  assert.equal(herschikSchalen(null, { 1: 1 }, 1), null);
});

test('kiesPaginaSchaal prefers the scale next to SCALE', () => {
  const r = kiesPaginaSchaal([
    { text: 'DETAIL A 1:20' }, { text: 'DETAIL B 1:20' }, { text: 'SCALE' }, { text: '1:100 @ A1' },
  ]);
  assert.equal(r.ratio, 100);
  assert.deepEqual(r.alle.sort(), ['1:100', '1:20']);
});

test('kiesPaginaSchaal falls back to the most frequent, reads pdf.js str items, and split text', () => {
  assert.equal(kiesPaginaSchaal([{ str: '1:50' }, { str: 'x 1:50' }, { str: '1:10' }]).ratio, 50);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1 : 200' }]).ratio, 200);
  assert.equal(kiesPaginaSchaal([{ text: 'no scale here' }, { text: 'TIME 12:30' }]), null);
  assert.equal(kiesPaginaSchaal([]), null);
});

test('kiesPaginaSchaal: split items, spaces, standards and years', async () => {
  const { schaalUitGebied } = await import('./pagina-schalen.js');
  // A title block with ":SCALE" (rotated) and "1 : 10" as separate pieces.
  assert.equal(kiesPaginaSchaal([{ str: ':SCALE' }, { str: '1' }, { str: ':' }, { str: '10' }]).ratio, 10);
  assert.equal(kiesPaginaSchaal([{ str: '1 : 10' }, { str: ':SCALE' }]).ratio, 10);
  // Standards are not scales.
  assert.equal(kiesPaginaSchaal([{ str: 'NZS 3101:2006' }, { str: 'AS/NZS 1170.1:2002' }, { str: 'SCNZ 111:2018' }]), null);
  assert.equal(kiesPaginaSchaal([{ str: 'TABLE 8.1 & 8.2 NZS3101:2006' }, { str: '1 : 10' }]).ratio, 10);
  // The scale next to SCALE wins over the detail scales.
  assert.equal(kiesPaginaSchaal([{ str: '1 : 10' }, { str: '1 : 10' }, { str: '1 : 10' }, { str: 'SCALE' }, { str: '1:50' }]).ratio, 50);
  assert.equal(schaalUitGebied('1 : 100'), '1:100');
  assert.equal(schaalUitGebied('SCALE 1:50 @ A1'), '1:50');
  assert.equal(schaalUitGebied('20'), '1:20');
  assert.equal(schaalUitGebied('AS SHOWN'), null);
});

test('normaliseerSchaal only takes 1:N or N: an imperial 1/4 is not 1:4', () => {
  assert.equal(normaliseerSchaal('1/4'), null);
  assert.equal(normaliseerSchaal('1/20'), null);
  assert.equal(normaliseerSchaal(`1/4" = 1'-0"`), null);
  assert.equal(normaliseerSchaal('1:100:2'), null);
  assert.equal(normaliseerSchaal('1:'), null);
});

test('kiesPaginaSchaal finds the usual title block scales', () => {
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1:100' }]).ratio, 100);
  assert.equal(kiesPaginaSchaal([{ text: 'SCHAAL 1:50' }]).ratio, 50);
  assert.equal(kiesPaginaSchaal([{ str: 'SCHAAL' }, { str: '1' }, { str: ':' }, { str: '10' }]).ratio, 10);
  assert.equal(kiesPaginaSchaal([{ str: 'SCALE:' }, { str: '1 : 10' }]).ratio, 10);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1:1,000' }]).ratio, 1000);
});

test('kiesPaginaSchaal: no scale when the sheet says it has none', () => {
  // The scale field states that there is no scale: no nearby ratio instead.
  assert.equal(kiesPaginaSchaal([{ text: 'DETAIL A 1:20' }, { text: 'SCALE: NTS' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE' }, { text: 'N.T.S.' }, { text: '1:20' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE AS SHOWN' }, { text: '1:50' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'SCHAAL: AS INDICATED' }, { text: '1:5' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'NOT TO SCALE' }, { text: '1:20' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'DO NOT SCALE' }, { text: '1:20' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'NIET OP SCHAAL' }, { text: '1:20' }]), null);
  // A real scale field still wins over a standard "do not scale" note.
  assert.equal(kiesPaginaSchaal([{ text: 'DO NOT SCALE FROM THIS DRAWING' }, { text: 'SCALE 1:100 @ A1' }]).ratio, 100);
  assert.equal(schaalUitGebied('NTS'), null);
  assert.equal(schaalUitGebied('SCALE: N.T.S.'), null);
});

test('kiesPaginaSchaal rejects times and does not cut decimals', () => {
  assert.equal(kiesPaginaSchaal([{ text: 'PLOTTED 1:30 PM' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'printed 1:45AM' }]), null);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1:30 PM' }]), null);
  const r = kiesPaginaSchaal([{ text: 'SCALE 1:2,5' }]);
  assert.notEqual(r?.ratio, 2);
  assert.equal(r.ratio, 2.5);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1:7.5' }]).ratio, 7.5);
  assert.equal(schaalUitGebied('1:2,5'), '1:2.5');
});

// The scale editor on a thumbnail (ThumbnailItem.jsx).
test('besluitSchaalInvoer: blur only touches the edited page, and only when changed', () => {
  const schalen = { 1: { scaleRatio: '1:100' }, 2: { scaleRatio: '1:20' } };
  const basis = { pageNum: 1, selectie: [1, 2, 3], schalen };
  // Clicking the badge and clicking away: nothing, also with a selection.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1:100', via: 'blur' }), { actie: 'niets' });
  assert.deepEqual(besluitSchaalInvoer({ ...basis, pageNum: 3, begin: '', waarde: '', via: 'blur' }), { actie: 'niets' });
  // Changed and blurred: this page only, never the selection.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '50', via: 'blur' }),
    { actie: 'zet', paginas: [1], ratio: '1:50' });
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '', via: 'blur' }),
    { actie: 'zet', paginas: [1], ratio: null });
  // Invalid text on blur is dropped.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1/4', via: 'blur' }), { actie: 'niets' });
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1:50', via: 'escape' }), { actie: 'niets' });
});

test('besluitSchaalInvoer: Enter sets the whole selection, never clears it unasked', () => {
  const schalen = { 1: { scaleRatio: '1:100' }, 2: { scaleRatio: '1:20' } };
  const basis = { pageNum: 1, selectie: [3, 1, 2], schalen };
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1:50', via: 'enter' }),
    { actie: 'zet', paginas: [1, 2, 3], ratio: '1:50' });
  // The same value with Enter copies it onto the selected pages that differ.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1:100', via: 'enter' }),
    { actie: 'zet', paginas: [1, 2, 3], ratio: '1:100' });
  // An empty, unchanged field and Enter: nothing is cleared.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, pageNum: 3, begin: '', waarde: '', via: 'enter' }), { actie: 'niets' });
  // Nothing to do when every selected page has it already.
  assert.deepEqual(besluitSchaalInvoer({ pageNum: 1, selectie: [1, 2], schalen: { 1: { scaleRatio: '1:5' }, 2: { scaleRatio: '1:5' } },
    begin: '1:5', waarde: '1:5', via: 'enter' }), { actie: 'niets' });
  // A page outside the selection: only that page.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, pageNum: 4, begin: '', waarde: '1:10', via: 'enter' }),
    { actie: 'zet', paginas: [4], ratio: '1:10' });
  // Invalid text on Enter: an error, the editor stays open.
  assert.deepEqual(besluitSchaalInvoer({ ...basis, begin: '1:100', waarde: '1/4', via: 'enter' }), { actie: 'fout' });
});
