import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fdUitBereiken, herstelCffKop, metCffHerstel, subsetFontdictPerGlyph } from './cff-subset-herstel.js';

// Deze tests hebben geen lettertypebestand nodig; de echte opslagroute met Noto
// Sans TC staat in ocr-text-layer.test.mjs.

function cffMetKop(kop, lengte) {
  const bytes = new Uint8Array(lengte);
  bytes.set(kop);
  for (let i = kop.length; i < lengte; i++) bytes[i] = i & 0xff;
  return bytes;
}

test('herstelCffKop: offSize uit cff.length (24) wordt de kleinste geldige maat, de rest blijft gelijk', () => {
  const kapot = cffMetKop([1, 0, 4, 24], 47965);
  const heel = herstelCffKop(kapot);
  assert.deepEqual([...heel.slice(0, 4)], [1, 0, 4, 2]);
  assert.deepEqual(heel.slice(4), kapot.slice(4));
  assert.equal(kapot[3], 24, 'invoer blijft onaangeroerd');
});

test('herstelCffKop: offSize volgt de lengte (1..4) en hdrSize wordt 4', () => {
  assert.equal(herstelCffKop(cffMetKop([1, 0, 4, 0], 200))[3], 1);
  assert.equal(herstelCffKop(cffMetKop([1, 0, 4, 9], 0x10000))[3], 3);
  assert.equal(herstelCffKop(cffMetKop([1, 0, 4, 9], 0x1000000))[3], 4);
  assert.equal(herstelCffKop(cffMetKop([1, 0, 5, 1], 100))[2], 4);
});

test('herstelCffKop: geen CFF 1.x → ongewijzigd terug', () => {
  const cff2 = cffMetKop([2, 0, 5, 0, 0], 64);
  assert.equal(herstelCffKop(cff2), cff2);
  const kort = Uint8Array.of(1, 0);
  assert.equal(herstelCffKop(kort), kort);
});

test('fdUitBereiken: een glyph op de grens van een bereik hoort bij dát bereik', () => {
  // Opbouw zoals de eerste bereiken van Noto Sans TC: gid 1 (spatie), 103, 111
  // liggen precies op een grens en kregen in fontkit het vorige Font DICT.
  const ranges = [
    { first: 0, fd: 5 }, { first: 1, fd: 14 }, { first: 103, fd: 3 }, { first: 104, fd: 14 },
    { first: 111, fd: 3 }, { first: 112, fd: 14 }, { first: 116, fd: 3 }, { first: 117, fd: 14 },
  ];
  const lineair = (gid) => ranges.filter((r) => r.first <= gid).at(-1).fd;
  for (let gid = 0; gid < 130; gid++) assert.equal(fdUitBereiken(ranges, gid), lineair(gid), `gid ${gid}`);
  assert.equal(fdUitBereiken(ranges, 1), 14);
  assert.equal(fdUitBereiken(ranges, 111), 3);
});

test('subsetFontdictPerGlyph: FDSelect en subroutine-telling volgen het eigen Font DICT van elke glyph', () => {
  const bronFDArray = [
    { FontName: 'A', Private: { Subrs: ['a0', 'a1', 'a2'], nominalWidthX: 1 } },
    { FontName: 'B', Private: { Subrs: ['b0', 'b1'], nominalWidthX: 2 } },
    { FontName: 'C', Private: { nominalWidthX: 3 } },
  ];
  // Volgorde A, B, A, C, B: fontkit gaf hier fds [0, 1, 1, 2, 2].
  const fdVan = { 0: 0, 10: 1, 11: 0, 20: 2, 21: 1 };
  const subrsVan = { 0: {}, 10: { 1: true }, 11: { 2: true }, 20: {}, 21: { 0: true } };
  const subset = {
    glyphs: [0, 10, 11, 20, 21],
    cff: { fdForGlyph: (gid) => fdVan[gid], topDict: { FDArray: bronFDArray } },
    font: { getGlyph: (gid) => ({ path: {}, _usedSubrs: subrsVan[gid] }) },
    subsetSubrs: (subrs, gebruikt) => subrs.map((s, i) => (gebruikt[i] ? s : 'return')),
  };
  const topDict = {};
  subsetFontdictPerGlyph.call(subset, topDict);

  assert.deepEqual(topDict.FDSelect, { version: 0, fds: [0, 1, 0, 2, 1] });
  assert.deepEqual(topDict.FDArray.map((d) => d.Private.nominalWidthX), [1, 2, 3]);
  assert.deepEqual(topDict.FDArray[0].Private.Subrs, ['return', 'return', 'a2']);
  assert.deepEqual(topDict.FDArray[1].Private.Subrs, ['b0', 'b1']);
  assert.equal(topDict.FDArray[2].Private.Subrs, undefined);
  assert.ok(topDict.FDArray.every((d) => !('FontName' in d)), 'FontName vervalt');
  assert.equal(bronFDArray[0].FontName, 'A', 'bron-FDArray blijft onaangeroerd');
  assert.deepEqual(bronFDArray[0].Private.Subrs, ['a0', 'a1', 'a2']);
});

// ── metCffHerstel met een nagebootste fontkit ──

// Bootst fontkits Subset na: encodeStream() codeert in een latere tick en
// sluit daarna af; gooit encode(), dan komt er (net als bij fontkit) geen einde.
function nepSubset({ glyphs = [0, 7], stukken = [], gooi = null } = {}) {
  return {
    cff: {},
    glyphs: [...glyphs],
    font: { numGlyphs: 20 },
    gecodeerdeGlyphs: null,
    encode(stroom) {
      this.gecodeerdeGlyphs = [...this.glyphs];
      if (gooi) throw gooi;
      for (const stuk of stukken) stroom.emit('data', stuk);
    },
    encodeStream() {
      const stroom = new EventEmitter();
      setImmediate(() => {
        this.encode(stroom);
        stroom.emit('end');
      });
      return stroom;
    },
  };
}

function nepFontkit(font) {
  return { create: () => font };
}

// Leest de stroom zoals pdf-lib's CustomFontSubsetEmbedder#serializeFont.
function lees(stroom) {
  return new Promise((resolve, reject) => {
    const stukken = [];
    stroom.on('data', (b) => stukken.push(b)).on('end', () => resolve(stukken)).on('error', reject);
  });
}

test('metCffHerstel: TrueType-lettertypen komen ongewijzigd terug', () => {
  const createSubset = () => ({});
  const font = { createSubset };
  assert.equal(metCffHerstel(nepFontkit(font)).create(new Uint8Array(0)), font);
  assert.equal(font.createSubset, createSubset);
});

test('metCffHerstel: FDSelect-opzoeking hersteld voor formaat 3, formaat 0 ongemoeid', () => {
  const cff = {
    topDict: { FDSelect: { version: 3, ranges: [{ first: 0, fd: 5 }, { first: 1, fd: 14 }, { first: 3, fd: 2 }] } },
    fdForGlyph: () => 'origineel',
  };
  metCffHerstel(nepFontkit({ 'CFF ': cff, createSubset() {} })).create(new Uint8Array(0));
  assert.deepEqual([0, 1, 2, 3, 4].map((gid) => cff.fdForGlyph(gid)), [5, 14, 14, 2, 2]);
  cff.topDict.FDSelect = { version: 0, fds: [] };
  assert.equal(cff.fdForGlyph(1), 'origineel');
});

test('metCffHerstel: subsetstroom levert één CFF met geldige kop', async () => {
  const subset = nepSubset({ stukken: [Uint8Array.of(1, 0, 4, 24, 9), new Uint8Array(295).fill(7)] });
  const font = metCffHerstel(nepFontkit({ 'CFF ': { topDict: {} }, createSubset: () => subset })).create(new Uint8Array(0));
  assert.equal(font.createSubset(), subset);
  assert.equal(subset.subsetFontdict, subsetFontdictPerGlyph);
  const stukken = await lees(subset.encodeStream());
  assert.equal(stukken.length, 1);
  assert.equal(stukken[0].length, 300);
  assert.deepEqual([...stukken[0].slice(0, 5)], [1, 0, 4, 2, 9]);
});

test('metCffHerstel: subset met alleen .notdef codeert met een echte glyph erbij, maar houdt zijn eigen lijst', async () => {
  const subset = nepSubset({ glyphs: [0], stukken: [Uint8Array.of(1, 0, 4, 24)] });
  const font = metCffHerstel(nepFontkit({ 'CFF ': { topDict: {} }, createSubset: () => subset })).create(new Uint8Array(0));
  await lees(font.createSubset().encodeStream());
  assert.deepEqual(subset.gecodeerdeGlyphs, [0, 1]);
  assert.deepEqual(subset.glyphs, [0]);
});

test('metCffHerstel: een subset met echte glyphs codeert precies die glyphs', async () => {
  const subset = nepSubset({ glyphs: [0, 7, 3], stukken: [Uint8Array.of(1, 0, 4, 24)] });
  const font = metCffHerstel(nepFontkit({ 'CFF ': { topDict: {} }, createSubset: () => subset })).create(new Uint8Array(0));
  await lees(font.createSubset().encodeStream());
  assert.deepEqual(subset.gecodeerdeGlyphs, [0, 7, 3]);
});

test('metCffHerstel: een coderingsfout wordt een afgewezen opslag in plaats van een hangende', async () => {
  const fout = new RangeError('"value" argument is out of bounds');
  const subset = nepSubset({ gooi: fout });
  const font = metCffHerstel(nepFontkit({ 'CFF ': { topDict: {} }, createSubset: () => subset })).create(new Uint8Array(0));
  await assert.rejects(lees(font.createSubset().encodeStream()), fout);
});
