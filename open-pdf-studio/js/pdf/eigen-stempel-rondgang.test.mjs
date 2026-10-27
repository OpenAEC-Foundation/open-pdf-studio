// Een eigen stempel uit een afbeelding (#749) komt na opslaan en heropenen
// terug MET zijn afbeelding, door de echte saver en lader. Ook als de
// afbeelding een GIF, BMP, WebP of SVG was: pdf-lib sluit alleen PNG en JPEG
// in, de saver zet de rest eerst om. Voorheen ging zo'n bestand als 'PNG'
// naar embedPng, dat faalde; het stempel had geen appearance en was weg.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFName } from 'pdf-lib';
import { leegBlad, opslaan, woordenboeken } from './rondgang.testhulp.mjs';
import { laadMetBeelden, pngDataUrl, pngMaat } from './stempel-rondgang.testhulp.mjs';

const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

function eigenStempel(imageData) {
  return {
    id: 'eigen-1', type: 'stamp', page: 1, x: 120, y: 200, width: 150, height: 75,
    rotation: 0, opacity: 1, author: 'User', color: '#000000',
    stampName: 'Custom', stampText: '', imageData, lockAspectRatio: true,
  };
}

// De browser zet een GIF/SVG via een canvas om naar PNG. Hier: een Image die
// direct laadt en een canvas dat een PNG van 60 × 30 teruggeeft.
async function metOmzetting(fn) {
  const vorig = { Image: globalThis.Image, create: document.createElement };
  const omgezet = [];
  globalThis.Image = class {
    constructor() { this.naturalWidth = 60; this.naturalHeight = 30; this.complete = false; }
    set src(v) { this._src = v; omgezet.push(v.slice(0, 30)); setTimeout(() => { this.complete = true; this.onload?.(); }, 0); }
    get src() { return this._src; }
  };
  document.createElement = function (soort) {
    const el = vorig.create ? vorig.create.call(this, soort) : {};
    if (soort !== 'canvas') return el;
    return Object.assign(el, {
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => pngDataUrl(60, 30),
    });
  };
  try {
    return await fn(omgezet);
  } finally {
    globalThis.Image = vorig.Image;
    document.createElement = vorig.create;
  }
}

async function stempelNaRondgang(imageData) {
  const bytes = await opslaan(await leegBlad(), [eigenStempel(imageData)]);
  const [{ dict }] = await woordenboeken(bytes);
  const terug = (await laadMetBeelden(bytes)).filter((m) => m.type === 'stamp');
  return { dict, terug };
}

test('een eigen PNG-stempel heeft na opslaan een appearance en komt terug met zijn afbeelding', async () => {
  const { dict, terug } = await stempelNaRondgang(pngDataUrl(40, 20));
  assert.ok(dict.get(PDFName.of('AP')), 'appearance stream geschreven');
  assert.equal(terug.length, 1);
  assert.equal(terug[0].stampName, 'Custom');
  assert.deepEqual(pngMaat(terug[0].imageData), { b: 40, h: 20 });
});

for (const [naam, bytes, mime] of [['GIF', GIF, 'image/gif'], ['SVG', SVG, 'image/svg+xml']]) {
  test(`een eigen ${naam}-stempel wordt bij opslaan PNG en overleeft heropenen`, () => metOmzetting(async (omgezet) => {
    const { dict, terug } = await stempelNaRondgang(`data:${mime};base64,${bytes.toString('base64')}`);
    assert.ok(omgezet.some((s) => s.startsWith(`data:${mime}`)), 'de bron is omgezet');
    assert.ok(dict.get(PDFName.of('AP')), 'appearance stream geschreven');
    assert.equal(terug.length, 1, 'het stempel is er na heropenen nog');
    assert.deepEqual(pngMaat(terug[0].imageData), { b: 60, h: 30 });
  }));
}
