// Node-unittest voor de pure tekst-diff-kern (compare/text-diff.js).
//
// Draaien:  node scripts/test-text-diff.mjs   (vanuit open-pdf-studio/)
//
// Dekt: normalisatie, regelgroepering uit tekst-items, Myers-regel-diff met
// paginatags (toegevoegd/verwijderd/gewijzigd), witruimte-ongevoeligheid,
// paginaverschuiving en woord-niveau verfijning.
import assert from 'node:assert/strict';
import {
  normalizeLine,
  groupItemsIntoLines,
  groupItemsIntoLineObjs,
  diffPageTexts,
  diffWords,
} from '../js/compare/text-diff.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const P = (page, ...lines) => ({ page, lines });
// Records bevatten sinds de arcering ook oldRects/newRects; voor de pure
// tekst-asserties vergelijken we zonder die velden.
const slim = (list) => list.map(({ oldRects, newRects, ...rest }) => rest);

test('normalizeLine vouwt witruimte samen en trimt', () => {
  assert.equal(normalizeLine('  a  b\t c  '), 'a b c');
  assert.equal(normalizeLine('\n \t'), '');
});

test('identieke documenten → geen verschillen', () => {
  const a = [P(1, 'regel een', 'regel twee'), P(2, 'regel drie')];
  assert.deepEqual(slim(diffPageTexts(a, a)), []);
});

test('alleen-witruimte-verschillen → geen verschillen', () => {
  const a = [P(1, 'de  koper  verklaart', '  slot ')];
  const b = [P(1, 'de koper verklaart', 'slot')];
  assert.deepEqual(slim(diffPageTexts(a, b)), []);
});

test('spatie-artefacten binnen woorden (pdf-extractie) → geen verschil', () => {
  const a = [P(1, 'beperkte a ansprakelijkheid', 'postcode 3025 AR')];
  const b = [P(1, 'beperkte aansprakelijkheid', 'postcode 30 25 AR')];
  assert.deepEqual(slim(diffPageTexts(a, b)), []);
});

test('toegevoegde regel', () => {
  const a = [P(1, 'alpha', 'gamma')];
  const b = [P(1, 'alpha', 'beta', 'gamma')];
  assert.deepEqual(slim(diffPageTexts(a, b)), [
    { type: 'added', oldPage: null, newPage: 1, oldText: '', newText: 'beta' },
  ]);
});

test('verwijderde regel', () => {
  const a = [P(1, 'alpha', 'beta', 'gamma')];
  const b = [P(1, 'alpha', 'gamma')];
  assert.deepEqual(slim(diffPageTexts(a, b)), [
    { type: 'removed', oldPage: 1, newPage: null, oldText: 'beta', newText: '' },
  ]);
});

test('gewijzigde regel → één modified-record oud → nieuw', () => {
  const a = [P(1, 'kop', 'getekend op 24 juli 2026', 'slot')];
  const b = [P(1, 'kop', 'getekend op 27 juli 2026', 'slot')];
  assert.deepEqual(slim(diffPageTexts(a, b)), [
    {
      type: 'modified', oldPage: 1, newPage: 1,
      oldText: 'getekend op 24 juli 2026',
      newText: 'getekend op 27 juli 2026',
    },
  ]);
});

test('meerdere losse wijzigingen blijven losse records', () => {
  const a = [P(1, 'a', 'x', 'b', 'c'), P(2, 'y', 'd')];
  const b = [P(1, 'a', 'b', 'c'), P(2, 'z', 'd', 'e')];
  const out = slim(diffPageTexts(a, b));
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { type: 'removed', oldPage: 1, newPage: null, oldText: 'x', newText: '' });
  assert.deepEqual(out[1], { type: 'modified', oldPage: 2, newPage: 2, oldText: 'y', newText: 'z' });
  assert.deepEqual(out[2], { type: 'added', oldPage: null, newPage: 2, oldText: '', newText: 'e' });
});

test('tekst die naar een andere pagina schuift is GEEN verschil', () => {
  const a = [P(1, 'een', 'twee'), P(2, 'drie')];
  const b = [P(1, 'een'), P(2, 'twee', 'drie')];
  assert.deepEqual(slim(diffPageTexts(a, b)), []);
});

test('alinea vooraan toegevoegd → één verschil, geen valse wijzigingen verderop', () => {
  // Doorschuif-scenario: de nieuwe alinea op pagina 1 duwt alle volgende tekst
  // één "pagina" op. Een per-pagina-diff zou elke pagina als gewijzigd zien;
  // de document-brede diff moet precies één 'added'-record opleveren.
  const body = Array.from({ length: 60 }, (_, i) => `alinea-regel ${i}`);
  const paginate = (lines, perPage) => {
    const pages = [];
    for (let i = 0; i < lines.length; i += perPage) {
      pages.push({ page: pages.length + 1, lines: lines.slice(i, i + perPage) });
    }
    return pages;
  };
  const nieuw = ['NIEUWE ALINEA regel a', 'NIEUWE ALINEA regel b', ...body];
  const out = diffPageTexts(paginate(body, 20), paginate(nieuw, 20));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'added');
  assert.equal(out[0].newPage, 1);
  assert.equal(out[0].newText, 'NIEUWE ALINEA regel a\nNIEUWE ALINEA regel b');
});

test('paginanummers wijzen naar de juiste pagina per zijde', () => {
  const a = [P(1, 'a'), P(2, 'b'), P(3, 'c')];
  const b = [P(1, 'a'), P(2, 'B-nieuw'), P(3, 'c')];
  const out = diffPageTexts(a, b);
  assert.equal(out.length, 1);
  assert.equal(out[0].oldPage, 2);
  assert.equal(out[0].newPage, 2);
});

test('lege documenten', () => {
  assert.deepEqual(slim(diffPageTexts([], [])), []);
  assert.deepEqual(slim(diffPageTexts([], [P(1, 'x')])), [
    { type: 'added', oldPage: null, newPage: 1, oldText: '', newText: 'x' },
  ]);
});

test('groupItemsIntoLines: zelfde y = één regel, sorteert op x', () => {
  const items = [
    { str: 'wereld', x: 60, y: 700, height: 10 },
    { str: 'hallo', x: 10, y: 700.4, height: 10 },
    { str: 'tweede regel', x: 10, y: 680, height: 10 },
  ];
  assert.deepEqual(groupItemsIntoLines(items), ['hallo wereld', 'tweede regel']);
});

test('groupItemsIntoLines: lege/witruimte-items vallen weg', () => {
  assert.deepEqual(groupItemsIntoLines([{ str: '  ', x: 0, y: 10 }]), []);
  assert.deepEqual(groupItemsIntoLines([]), []);
});

test('groupItemsIntoLineObjs: regel-bbox uit item-rects (rx/ry/rw/rh)', () => {
  const items = [
    { str: 'hallo', x: 10, y: 700, height: 10, rx: 10, ry: 130, rw: 40, rh: 12 },
    { str: 'wereld', x: 60, y: 700, height: 10, rx: 60, ry: 131, rw: 50, rh: 12 },
  ];
  const out = groupItemsIntoLineObjs(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'hallo wereld');
  assert.deepEqual(out[0].rect, { x: 10, y: 130, w: 100, h: 13 });
});

test('rect-mapping: verschil-record draagt pagina + rects van de bron-regels', () => {
  const L = (text, rect) => ({ text, rect });
  const a = [
    { page: 1, lines: [L('kop', { x: 5, y: 10, w: 80, h: 12 }), L('weg deze', { x: 5, y: 30, w: 90, h: 12 })] },
    { page: 2, lines: [L('slot', { x: 5, y: 10, w: 40, h: 12 })] },
  ];
  const b = [
    { page: 1, lines: [L('kop', { x: 5, y: 10, w: 80, h: 12 })] },
    { page: 2, lines: [L('erbij', { x: 7, y: 50, w: 60, h: 12 }), L('slot', { x: 5, y: 70, w: 40, h: 12 })] },
  ];
  const out = diffPageTexts(a, b);
  // Aangrenzende verwijdering+toevoeging vormen één modified-record; de rects
  // wijzen elk naar hun eigen zijde én pagina (oud p1, nieuw p2).
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'modified');
  assert.deepEqual(out[0].oldRects, [{ page: 1, x: 5, y: 30, w: 90, h: 12 }]);
  assert.deepEqual(out[0].newRects, [{ page: 2, x: 7, y: 50, w: 60, h: 12 }]);
  assert.equal(out[0].oldPage, 1);
  assert.equal(out[0].newPage, 2);
});

test('rect-mapping: doorschuivende maar identieke regels krijgen GEEN rects/records', () => {
  const L = (text, page, y) => ({ text, rect: { x: 5, y, w: 50, h: 10 } });
  const a = [{ page: 1, lines: [L('een', 1, 10), L('twee', 1, 30)] }, { page: 2, lines: [L('drie', 2, 10)] }];
  const b = [{ page: 1, lines: [L('een', 1, 10)] }, { page: 2, lines: [L('twee', 2, 10), L('drie', 2, 30)] }];
  assert.deepEqual(diffPageTexts(a, b), []);
});

test('diffWords markeert alleen de gewijzigde woorden', () => {
  const { oldParts, newParts } = diffWords(
    'getekend op 24 juli 2026',
    'getekend op 27 juli 2026',
  );
  assert.deepEqual(oldParts, [
    { text: 'getekend op', changed: false },
    { text: '24', changed: true },
    { text: 'juli 2026', changed: false },
  ]);
  assert.deepEqual(newParts, [
    { text: 'getekend op', changed: false },
    { text: '27', changed: true },
    { text: 'juli 2026', changed: false },
  ]);
});

test('groot document: diff blijft correct en snel', () => {
  const lines = Array.from({ length: 800 }, (_, i) => `regel nummer ${i}`);
  const a = [P(1, ...lines)];
  const bLines = lines.slice();
  bLines[400] = 'regel nummer vierhonderd AANGEPAST';
  bLines.splice(600, 1); // verwijder één regel
  const b = [P(1, ...bLines)];
  const t0 = Date.now();
  const out = diffPageTexts(a, b);
  assert.ok(Date.now() - t0 < 2000, 'diff te traag');
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'modified');
  assert.equal(out[0].oldText, 'regel nummer 400');
  assert.equal(out[1].type, 'removed');
  assert.equal(out[1].oldText, 'regel nummer 600');
});

console.log(`\n${passed} tests geslaagd${process.exitCode ? ' (met fouten)' : ''}`);
