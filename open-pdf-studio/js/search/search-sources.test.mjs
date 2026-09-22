import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRON_ANNOTATIE, BRON_TEKST, ANNOTATIE_TEKSTVELDEN,
  annotatieTekstveld, annotatieTekst, zoekInAnnotaties, filterOpBron,
  groepeerPerPagina, groepVanTreffer,
} from './search-sources.js';

const VIEW = [0, 0, 595.28, 841.89];
const patroon = (q) => new RegExp(q, 'gi');

test('tekstvelden: elk type wijst naar zijn eigen veld', () => {
  assert.equal(annotatieTekstveld('textbox').veld, 'text');
  assert.equal(annotatieTekstveld('stamp').veld, 'stampText');
  assert.equal(annotatieTekstveld('measureArea').veld, 'measureText');
  assert.equal(annotatieTekstveld('box'), null);
  // Elk type in de lijst heeft een veld (de soortnaam komt uit types.<type>).
  for (const r of ANNOTATIE_TEKSTVELDEN) assert.ok(typeof r.veld === 'string' && r.veld, r.type);
});

test('annotatietekst: alleen uit het juiste veld', () => {
  assert.equal(annotatieTekst({ type: 'textbox', text: 'Hallo' }), 'Hallo');
  assert.equal(annotatieTekst({ type: 'stamp', stampText: 'Concept', text: 'x' }), 'Concept');
  assert.equal(annotatieTekst({ type: 'box', text: 'Hallo' }), '');
  assert.equal(annotatieTekst({ type: 'textbox' }), '');
  assert.equal(annotatieTekst(null), '');
});

test('zoeken in annotaties: treffers per annotatie en per pagina', () => {
  const anns = [
    { id: 'a', type: 'textbox', page: 1, x: 100, y: 50, text: 'Beton en beton' },
    { id: 'b', type: 'comment', page: 2, x: 10, y: 20, text: 'beton' },
    { id: 'c', type: 'box', page: 1, x: 0, y: 0, text: 'beton' },
    { id: 'd', type: 'stamp', page: 1, x: 5, y: 5, stampText: 'geen match' },
  ];
  const t = zoekInAnnotaties(anns, 1, patroon('beton'), VIEW);
  assert.equal(t.length, 2);
  assert.equal(t[0].bron, BRON_ANNOTATIE);
  assert.equal(t[0].annotationId, 'a');
  assert.equal(t[0].annotationType, 'textbox');
  assert.deepEqual([t[0].startPos, t[0].endPos], [0, 5]);
  assert.deepEqual([t[1].startPos, t[1].endPos], [9, 14]);
  // Leesvolgorde-anker op dezelfde as als de tekstresultaten (PDF-Y omhoog).
  assert.equal(t[0].anchorY, 841.89 - 50);
  assert.equal(t[0].anchorX, 100);
  assert.equal(zoekInAnnotaties(anns, 2, patroon('beton'), VIEW).length, 1);
  assert.deepEqual(zoekInAnnotaties(null, 1, patroon('beton'), VIEW), []);
});

test('zoeken in annotaties: hoofdlettergevoelig volgt het patroon', () => {
  const anns = [{ id: 'a', type: 'text', page: 1, x: 0, y: 0, text: 'Beton beton' }];
  assert.equal(zoekInAnnotaties(anns, 1, new RegExp('beton', 'g'), VIEW).length, 1);
  assert.equal(zoekInAnnotaties(anns, 1, new RegExp('beton', 'gi'), VIEW).length, 2);
});

test('filteren op bron: beide, één, of geen', () => {
  const r = [{ bron: BRON_TEKST }, { bron: BRON_ANNOTATIE }];
  assert.equal(filterOpBron(r, { tekst: true, annotaties: true }).length, 2);
  assert.equal(filterOpBron(r, { tekst: true, annotaties: false })[0].bron, BRON_TEKST);
  assert.equal(filterOpBron(r, { tekst: false, annotaties: true })[0].bron, BRON_ANNOTATIE);
  assert.deepEqual(filterOpBron(r, { tekst: false, annotaties: false }), []);
});

const RESULTATEN = [
  { pageNum: 1, bron: BRON_TEKST, index: 0 },
  { pageNum: 1, bron: BRON_ANNOTATIE, annotationType: 'textbox', index: 1 },
  { pageNum: 3, bron: BRON_TEKST, index: 2 },
  { pageNum: 3, bron: BRON_TEKST, index: 3 },
  { pageNum: 3, bron: BRON_ANNOTATIE, annotationType: 'comment', index: 4 },
];

test('groeperen per pagina: aantallen, soorten en de eerste treffer', () => {
  const g = groepeerPerPagina(RESULTATEN);
  assert.deepEqual(g.map((x) => x.pagina), [1, 3]);
  assert.deepEqual([g[0].totaal, g[0].tekst, g[0].annotaties], [2, 1, 1]);
  assert.deepEqual(g[0].soorten, ['textbox']);
  assert.equal(g[0].eersteIndex, 0);
  assert.deepEqual([g[1].totaal, g[1].tekst, g[1].annotaties], [3, 2, 1]);
  assert.equal(g[1].eersteIndex, 2);
  assert.deepEqual(groepeerPerPagina([]), []);
});

test('groep van de huidige treffer', () => {
  const g = groepeerPerPagina(RESULTATEN);
  assert.equal(groepVanTreffer(g, RESULTATEN, 4).pagina, 3);
  assert.equal(groepVanTreffer(g, RESULTATEN, 0).pagina, 1);
  assert.equal(groepVanTreffer(g, RESULTATEN, 99), null);
});
