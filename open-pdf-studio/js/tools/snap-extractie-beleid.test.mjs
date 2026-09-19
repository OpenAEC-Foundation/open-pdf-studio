import assert from 'node:assert/strict';
import test from 'node:test';

import { slaSnapExtractieOver, SNAP_MIN_CONTENT_BYTES } from './snap-extractie-beleid.js';

test('rasterblad met vrijwel lege content-stream wordt overgeslagen', () => {
  // Gescande A0-tekening: één JPEG-plaatsing, 48 bytes gecomprimeerd.
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: 48 }), true);
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: SNAP_MIN_CONTENT_BYTES - 1 }), true);
});

test('gemengd rasterblad (onderlegger + lijnwerk) wordt wél uitgelezen', () => {
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: SNAP_MIN_CONTENT_BYTES }), false);
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: 12_000 }), false);
});

test('vectorbladen worden altijd uitgelezen, ook met kleine content-stream', () => {
  assert.equal(slaSnapExtractieOver({ pageType: 'vector', contentBytes: 48 }), false);
  assert.equal(slaSnapExtractieOver({ pageType: 'vector', contentBytes: 0 }), false);
});

test('onbekend paginatype of onbekende grootte → oude gedrag (uitlezen)', () => {
  assert.equal(slaSnapExtractieOver({ pageType: null, contentBytes: 48 }), false);
  assert.equal(slaSnapExtractieOver({ pageType: undefined, contentBytes: 48 }), false);
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: 0 }), false);
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: null }), false);
  assert.equal(slaSnapExtractieOver({ pageType: 'tile', contentBytes: NaN }), false);
});
