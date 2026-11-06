// Het model van een link van de app (#953): adressen, doelen, regelvakken.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseerUri, normaliseerBestand, normaliseerDoel, vakUitRegels, nieuweLinkVelden,
  raaktLink, linkVakken, linkRand, linkRanddikte, linkMarkering, doelOmschrijving,
} from './link-model.js';

test('a typed web address gets a scheme; unsafe schemes are refused', () => {
  assert.equal(normaliseerUri('  openaec.org/pdf '), 'https://openaec.org/pdf');
  assert.equal(normaliseerUri('http://example.com'), 'http://example.com');
  assert.equal(normaliseerUri('naam@example.com'), 'mailto:naam@example.com');
  assert.equal(normaliseerUri('mailto:naam@example.com?subject=PDF'), 'mailto:naam@example.com?subject=PDF');
  assert.equal(normaliseerUri('tel:+31201234567'), 'tel:+31201234567');
  assert.equal(normaliseerUri('//cdn.example.com/a'), 'https://cdn.example.com/a');
  for (const fout of ['', '   ', 'javascript:alert(1)', 'file:///C:/x.pdf', 'data:text/html,x',
    'C:\\docs\\a.pdf', 'een adres met spaties', 'https://']) {
    assert.equal(normaliseerUri(fout), null, fout);
  }
});

test('a page target stays inside the document; a file target needs a path', () => {
  assert.deepEqual(normaliseerDoel({ kind: 'page', page: '2', fit: 'fit' }, 3), { kind: 'page', page: 2, fit: 'fit' });
  assert.deepEqual(normaliseerDoel({ kind: 'page', page: 3, top: 500, left: 0, zoom: 0 }, 3),
    { kind: 'page', page: 3, fit: 'xyz', left: 0, top: 500, zoom: null });
  assert.equal(normaliseerDoel({ kind: 'page', page: 4 }, 3), null);
  assert.equal(normaliseerDoel({ kind: 'page', page: 0 }, 3), null);
  assert.equal(normaliseerDoel({ kind: 'page', page: 'x' }, 3), null);
  assert.deepEqual(normaliseerDoel({ kind: 'uri', uri: 'openaec.org' }), { kind: 'uri', uri: 'https://openaec.org' });
  assert.deepEqual(normaliseerDoel({ kind: 'file', file: ' ..\\tekening.pdf ' }), { kind: 'file', file: '..\\tekening.pdf' });
  assert.equal(normaliseerDoel({ kind: 'file', file: '  ' }), null);
  assert.equal(normaliseerBestand('a\nb'), null);
  assert.equal(normaliseerDoel({ kind: 'onbekend' }), null);
  assert.equal(normaliseerDoel(null), null);
});

test('a text selection gives one box with a rect per line', () => {
  const vak = vakUitRegels([
    { x: 30, y: 100, width: 200, height: 14, page: 1 },
    { x: 30, y: 120, width: 90, height: 14, page: 1 },
    { x: 0, y: 0, width: 0, height: 10 }, // leeg vak: weg
  ]);
  assert.deepEqual([vak.x, vak.y, vak.width, vak.height], [30, 100, 200, 34]);
  assert.equal(vak.rects.length, 2);
  assert.equal('page' in vak.rects[0], false, 'only the geometry is kept');
  assert.equal(vakUitRegels([]), null);

  const ann = nieuweLinkVelden({ page: 1, vak, doel: { kind: 'uri', uri: 'https://a.nl' }, rand: 'underline' });
  assert.equal(ann.type, 'link');
  assert.equal(ann.linkBorder, 'underline');
  assert.equal(ann.rects.length, 2);
  // Raken: op een regel ja, in het gat naast de korte tweede regel niet.
  assert.equal(raaktLink(ann, 40, 105), true);
  assert.equal(raaktLink(ann, 200, 125), false);
  assert.equal(raaktLink(ann, 100, 125), true);
});

test('a dragged link has no lines and is hit anywhere in its box', () => {
  const ann = nieuweLinkVelden({ page: 2, vak: { x: 10, y: 10, width: 50, height: 20 }, doel: null, rand: 'bestaat-niet' });
  assert.equal(ann.rects, undefined);
  assert.equal(ann.linkBorder, 'none');
  assert.deepEqual(linkVakken(ann), [{ x: 10, y: 10, width: 50, height: 20 }]);
  assert.equal(raaktLink(ann, 59, 29), true);
  assert.equal(raaktLink(ann, 61, 29), false);
  assert.equal(raaktLink(ann, 61, 29, 2), true);
});

test('defaults for border, width and highlight mode', () => {
  assert.equal(linkRand({}), 'none');
  assert.equal(linkRand({ linkBorder: 'solid' }), 'solid');
  assert.equal(linkRanddikte({}), 1);
  assert.equal(linkRanddikte({ lineWidth: 40 }), 12);
  assert.equal(linkMarkering({ linkHighlight: 'O' }), 'O');
  assert.equal(linkMarkering({ linkHighlight: 'X' }), 'I');
  assert.equal(doelOmschrijving({ kind: 'page', page: 4 }, (k, o) => `${k}:${o.page}`), 'link.toPage:4');
  assert.equal(doelOmschrijving({ kind: 'uri', uri: 'https://a.nl' }), 'https://a.nl');
});
