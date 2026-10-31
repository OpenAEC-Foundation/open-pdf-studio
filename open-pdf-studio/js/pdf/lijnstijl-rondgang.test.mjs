// Dashed and dotted outlines survive saving and reopening, for every shape.
//
// The saver writes dashed as /BS << /S /D /D [3 4] >> and dotted as
// /BS << /S /D /D [2 4] >>. The text box loader (FreeText) read only /S and
// turned every /D into 'dashed', so a dotted text box came back dashed and a
// second save wrote [3 4]. The other shapes read the dash array
// (loader/pdf-helpers.js mapBorderStyle); the text box now does the same.
// The extended styles (dash-dot, long-dash, ...) came back as 'dashed' for
// every shape; the loader now recognises each pattern the saver writes.
//
// Rectangles and ellipses also carry the pattern in their appearance stream
// (/AP /N): other readers draw the appearance, and it stroked `re S` without a
// dash operator, so dashed and dotted shapes looked solid there.
//
// Real saver and loader (rondgang.testhulp.mjs), two rounds.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFName, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';

const basis = {
  page: 1, rotation: 0, color: '#1144cc', strokeColor: '#1144cc', fillColor: null,
  lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'Tester',
  createdAt: '2026-10-29T10:00:00.000Z', modifiedAt: '2026-10-29T10:00:00.000Z',
};

const tekst = { text: 'hallo', fontSize: 12, fontFamily: 'Arial', textColor: '#000000', lineWidth: 1 };
const VORMEN = {
  textbox: { ...basis, ...tekst, id: 'tb', type: 'textbox', x: 60, y: 60, width: 220, height: 60 },
  callout: {
    ...basis, ...tekst, id: 'co', type: 'callout', x: 300, y: 380, width: 170, height: 70, fillColor: '#FFFFD0',
    arrowX: 120, arrowY: 560, kneeX: 270, kneeY: 415, armOriginX: 300, armOriginY: 415,
  },
  box: { ...basis, id: 'bx', type: 'box', x: 80, y: 100, width: 140, height: 80 },
  circle: { ...basis, id: 'ci', type: 'circle', x: 300, y: 100, width: 120, height: 80 },
  line: { ...basis, id: 'ln', type: 'line', startX: 100, startY: 500, endX: 400, endY: 520 },
  polygon: { ...basis, id: 'pg', type: 'polygon', x: 80, y: 300, width: 140, height: 90, sides: 6 },
  cloud: { ...basis, id: 'cl', type: 'cloud', x: 300, y: 250, width: 160, height: 90 },
  draw: { ...basis, id: 'dr', type: 'draw', path: [{ x: 100, y: 700 }, { x: 200, y: 700 }, { x: 300, y: 705 }] },
};
const PATROON = { dashed: [3, 4], dotted: [2, 4] };

async function bsVan(bytes) {
  const lijst = await woordenboeken(bytes);
  assert.equal(lijst.length, 1, 'one annotation');
  const ctx = lijst.doc.context;
  const bs = ctx.lookup(lijst[0].dict.get(PDFName.of('BS')));
  const d = bs?.get(PDFName.of('D'));
  return { stijl: bs ? String(bs.get(PDFName.of('S'))) : null, streep: d ? ctx.lookup(d).asArray().map((g) => g.asNumber()) : null };
}

for (const [soort, vorm] of Object.entries(VORMEN)) {
  for (const stijl of ['dashed', 'dotted']) {
    test(`${soort} ${stijl}: the line style comes back after save, reopen and save again`, async () => {
      const eerste = await opslaan(await leegBlad(), [{ ...vorm, borderStyle: stijl }]);
      assert.deepEqual(await bsVan(eerste), { stijl: '/D', streep: PATROON[stijl] }, 'first save');
      const [m] = await laad(eerste);
      assert.equal(m.type, soort);
      assert.equal(m.borderStyle, stijl, 'after reopening');
      const tweede = await opslaan(eerste, [m]);
      assert.deepEqual(await bsVan(tweede), { stijl: '/D', streep: PATROON[stijl] }, 'second save');
      const [m2] = await laad(tweede);
      assert.equal(m2.borderStyle, stijl, 'after the second round');
    });
  }
}

test('a solid text box stays solid', async () => {
  const bytes = await opslaan(await leegBlad(), [VORMEN.textbox]);
  const [m] = await laad(bytes);
  assert.equal(m.borderStyle, 'solid');
});

for (const stijl of ['dash-dot', 'dash-dot-dot', 'long-dash', 'long-dash-dot', 'long-dash-dot-dot']) {
  for (const soort of ['textbox', 'box', 'line', 'draw']) {
    test(`${soort} ${stijl}: the extended line style comes back after reopening`, async () => {
      const [m] = await laad(await opslaan(await leegBlad(), [{ ...VORMEN[soort], borderStyle: stijl }]));
      assert.equal(m.borderStyle, stijl);
    });
  }
}

test('the loader knows exactly the dash patterns the saver writes', async () => {
  const { EIGEN_STREEPPATRONEN, lijnstijlUitStreep } = await import('./loader/pdf-helpers.js');
  const { dashArrayForStyle } = await import('./saver/appearance-vectors.js');
  for (const [stijl, patroon] of Object.entries(EIGEN_STREEPPATRONEN)) {
    assert.deepEqual(dashArrayForStyle(stijl), patroon, stijl);
    assert.equal(lijnstijlUitStreep(patroon), stijl);
  }
  // Older and foreign patterns.
  assert.equal(lijnstijlUitStreep([2, 2]), 'dotted');
  assert.equal(lijnstijlUitStreep([1, 3]), 'dotted');
  assert.equal(lijnstijlUitStreep([8, 4]), 'dashed');
  assert.equal(lijnstijlUitStreep([6, 3, 1, 3]), 'dashed');
  assert.equal(lijnstijlUitStreep([3]), null);
});

// The dash operator in the appearance of the single annotation, as the reader
// of another program sees it ([] for none).
async function apStreepVan(bytes) {
  const lijst = await woordenboeken(bytes);
  const ctx = lijst.doc.context;
  const ap = ctx.lookup(lijst[0].dict.get(PDFName.of('AP')));
  assert.ok(ap, 'an appearance');
  const n = ctx.lookup(ap.get(PDFName.of('N')));
  const ruw = n.dict.get(PDFName.of('Filter')) ? decodePDFRawStream(n).decode() : n.getContents();
  const inhoud = Buffer.from(ruw).toString('latin1');
  const d = /\[([^\]]*)\]\s+0\s+d\b/.exec(inhoud);
  return d && d[1].trim() ? d[1].trim().split(/\s+/).map(Number) : [];
}

const ALLE_STIJLEN = ['solid', 'dashed', 'dotted', 'dash-dot', 'dash-dot-dot', 'long-dash',
  'long-dash-dot', 'long-dash-dot-dot'];

for (const soort of ['box', 'circle']) {
  for (const stijl of ALLE_STIJLEN) {
    test(`${soort} ${stijl}: the appearance draws the same dash pattern as /BS /D, also after reopening`, async () => {
      const { dashArrayForStyle } = await import('./saver/appearance-vectors.js');
      const patroon = dashArrayForStyle(stijl);
      const eerste = await opslaan(await leegBlad(), [{ ...VORMEN[soort], borderStyle: stijl }]);
      const bs = await bsVan(eerste);
      assert.deepEqual(bs.streep, patroon, '/BS /D');
      assert.deepEqual(await apStreepVan(eerste), patroon || [], 'appearance, first save');
      const [m] = await laad(eerste);
      assert.equal(m.borderStyle, stijl, 'after reopening');
      const tweede = await opslaan(eerste, [m]);
      assert.deepEqual(await apStreepVan(tweede), patroon || [], 'appearance, second save');
      assert.deepEqual((await bsVan(tweede)).streep, patroon, '/BS /D, second save');
    });
  }
}
