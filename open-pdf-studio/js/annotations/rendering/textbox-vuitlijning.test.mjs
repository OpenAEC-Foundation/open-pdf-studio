import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verticaleVerschuiving, TEKST_V_UITLIJNINGEN } from './textbox-layout.js';

test('verticaleVerschuiving: boven blijft staan, midden de helft, onder alles', () => {
  assert.equal(verticaleVerschuiving('top', 100, 40), 0);
  assert.equal(verticaleVerschuiving(undefined, 100, 40), 0);
  assert.equal(verticaleVerschuiving('middle', 100, 40), 30);
  assert.equal(verticaleVerschuiving('bottom', 100, 40), 60);
});

test('verticaleVerschuiving: past de tekst niet, dan begint hij boven', () => {
  assert.equal(verticaleVerschuiving('middle', 40, 100), 0);
  assert.equal(verticaleVerschuiving('bottom', 40, 40), 0);
  assert.equal(verticaleVerschuiving('middle', 0, 0), 0);
});

test('de uitlijningen', () => {
  assert.deepEqual([...TEKST_V_UITLIJNINGEN], ['top', 'middle', 'bottom']);
});

// Tekstvak en callout tekenen (drawTextboxContent) en bewaren (/OPS_TextVAlign)
// de uitlijning allebei; de lader moet hem dan ook voor allebei teruglezen.
test('de lader leest de verticale uitlijning terug voor tekstvak en callout', () => {
  const bron = readFileSync(new URL('../../pdf/loader/annotation-converter.js', import.meta.url), 'utf8');
  const lezen = /\.\.\.\(extraColors\.textVAlign \? \{ textVAlign: extraColors\.textVAlign \} : \{\}\)/g;
  const callout = bron.indexOf("type: 'callout'");
  const tekstvak = bron.indexOf("type: 'textbox'", callout);
  assert.ok(callout > 0 && tekstvak > callout);
  const plekken = [...bron.matchAll(lezen)].map((m) => m.index);
  assert.equal(plekken.length, 2);
  assert.ok(plekken.some((i) => i > callout && i < tekstvak), 'callout');
  assert.ok(plekken.some((i) => i > tekstvak), 'tekstvak');
});
