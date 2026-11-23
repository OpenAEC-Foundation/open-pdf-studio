// The border colour of an imported text box, read from its appearance stream
// in every form a program may write it.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { lijnkleurUitAp } from './ap-lijnkleur.js';

test('RGB stroke colour, as before', () => {
  assert.equal(lijnkleurUitAp('1 0 0 RG 1 w 10 10 100 40 re S'), '#ff0000');
  assert.equal(lijnkleurUitAp('.824 .824 1 rg 0 0 1 RG 1 w\n106.709 127.165 16.807 53.194 re B\n'), '#0000ff');
});

test('a colour set with SC or SCN after a colour space', () => {
  assert.equal(lijnkleurUitAp('/DeviceRGB CS 1 0 0 SC 0.5 w 0 0 200 30 re S'), '#ff0000');
  assert.equal(lijnkleurUitAp('/Cs1 CS 1 0 0 SCN 0 0 200 30 re\nS'), '#ff0000');
});

test('CMYK and grey strokes', () => {
  assert.equal(lijnkleurUitAp('0 1 1 0 K 0 0 200 30 re S'), '#ff0000');
  assert.equal(lijnkleurUitAp('0.5 G 0 0 200 30 re S'), '#808080');
});

test('fill colours and text are not mistaken for the border', () => {
  // Lowercase operators fill; the text colour comes after the border is drawn.
  assert.equal(lijnkleurUitAp('1 1 1 rg 0 0 200 30 re f'), null);
  assert.equal(lijnkleurUitAp('1 0 0 RG 0 0 200 30 re S BT 0 0 0 RG (x) Tj ET'), '#ff0000');
  assert.equal(lijnkleurUitAp('0 0 0 RG 1 0 0 RG 0 0 200 30 re S'), '#ff0000', 'the colour in effect at the stroke');
});

test('no stroke colour gives null; a stream without a stroke gives its first colour', () => {
  assert.equal(lijnkleurUitAp(''), null);
  assert.equal(lijnkleurUitAp(undefined), null);
  assert.equal(lijnkleurUitAp('BT /F0 12 Tf (x) Tj ET'), null);
  assert.equal(lijnkleurUitAp('0 1 0 RG 0 0 10 10 re W n'), '#00ff00');
});

test('the loader reads the border colour through this function', () => {
  const bron = fs.readFileSync(new URL('./color-extraction.js', import.meta.url), 'utf8');
  assert.match(bron, /lijnkleurUitAp\(/);
});
