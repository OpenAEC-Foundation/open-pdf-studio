// Eenvoudige annotaties in Rust tekenen: welke annotatie mag erheen, en met
// welke kleur, dekking, lijndikte en streep. Wat hier null geeft, blijft de
// JS-tekening doen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { hexKleur, vormVoorRust, verdeelVoorRust, decodeLaag, tekenRustLaag } from './rust-laag.js';

test('kleuren: alleen #rgb en #rrggbb', () => {
  assert.deepEqual(hexKleur('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexKleur('#F80'), [255, 136, 0]);
  assert.equal(hexKleur('rgba(1,2,3,0.5)'), null);
  assert.equal(hexKleur('red'), null);
  assert.equal(hexKleur(null), null);
});

test('een lijn: kleur valt terug op color, standaarddikte 3, dekking 1', () => {
  assert.deepEqual(vormVoorRust({ type: 'line', startX: 1, startY: 2, endX: 3, endY: 4, color: '#0000ff' }),
    { t: 'line', x1: 1, y1: 2, x2: 3, y2: 4, line: { rgb: [0, 0, 255], alpha: 1, width: 3, dash: [] } });
});

test('lijndikte: 0 zonder vulling wordt 0,5; de ondergrens is 0,25', () => {
  const l = (lineWidth) => vormVoorRust({ type: 'line', startX: 0, startY: 0, endX: 9, endY: 9, color: '#000000', lineWidth }).line.width;
  assert.equal(l(0), 0.5);
  assert.equal(l(0.1), 0.25);
  assert.equal(l(2), 2);
});

test('streeppatronen zoals applyBorderStyle; een onbekende stijl blijft bij JS', () => {
  const met = (borderStyle) => vormVoorRust({ type: 'line', startX: 0, startY: 0, endX: 9, endY: 9, color: '#000000', borderStyle });
  assert.deepEqual(met('dashed').line.dash, [3, 4]);
  assert.deepEqual(met('long-dash-dot').line.dash, [20, 10, 2, 10]);
  assert.deepEqual(met('solid').line.dash, []);
  assert.equal(met('cloudy'), null);
});

test('een rechthoek: vulling met eigen dekking, rand met die van de lijn', () => {
  assert.deepEqual(vormVoorRust({ type: 'box', x: 10, y: 20, width: 30, height: 40, rotation: 15, strokeColor: '#ff0000', fillColor: '#00ff00', opacity: 0.8, fillOpacity: 0.25, lineWidth: 2 }), {
    t: 'box', x: 10, y: 20, w: 30, h: 40, rot: 15,
    fill: { rgb: [0, 255, 0], alpha: 0.25 },
    line: { rgb: [255, 0, 0], alpha: 0.8, width: 2, dash: [] },
  });
  // Zonder eigen vul-dekking: die van de lijn.
  assert.equal(vormVoorRust({ type: 'box', x: 0, y: 0, width: 5, height: 5, color: '#000000', fillColor: '#00ff00', opacity: 0.5 }).fill.alpha, 0.5);
});

test('geen rand (strokeColor none) en geen vulling (none of leeg)', () => {
  const zonderRand = vormVoorRust({ type: 'box', x: 0, y: 0, width: 5, height: 5, color: '#000000', strokeColor: 'none', fillColor: '#00ff00' });
  assert.equal(zonderRand.line, undefined);
  assert.ok(zonderRand.fill);
  const zonderVulling = vormVoorRust({ type: 'circle', x: 0, y: 0, width: 5, height: 5, color: '#000000', fillColor: 'none' });
  assert.equal(zonderVulling.fill, undefined);
  assert.equal(zonderVulling.t, 'circle');
  // Niets te tekenen.
  assert.equal(vormVoorRust({ type: 'box', x: 0, y: 0, width: 5, height: 5, strokeColor: 'none' }), null);
});

test('een ellips met alleen een straal', () => {
  const v = vormVoorRust({ type: 'circle', x: 10, y: 10, radius: 6, color: '#000000' });
  assert.equal(v.w, 12);
  assert.equal(v.h, 12);
});

test('polylijn met rechte hoeken, inkt met ronde; gladde inkt blijft bij JS', () => {
  const pl = vormVoorRust({ type: 'polyline', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], color: '#000000' });
  assert.deepEqual(pl.pts, [1, 2, 3, 4, 5, 6]);
  assert.equal(pl.round, false);
  const inkt = { type: 'draw', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#000000' };
  assert.equal(vormVoorRust(inkt).round, true);
  assert.equal(vormVoorRust(inkt, { isGladdeInkt: () => true }), null);
  assert.equal(vormVoorRust({ type: 'polyline', points: [{ x: 1, y: 2 }], color: '#000000' }), null);
});

test('een markering: vulling op 0,3 zonder eigen dekking', () => {
  assert.deepEqual(vormVoorRust({ type: 'highlight', x: 1, y: 2, width: 30, height: 8, color: '#ffff00' }),
    { t: 'box', x: 1, y: 2, w: 30, h: 8, rot: 0, fill: { rgb: [255, 255, 0], alpha: 0.3 } });
  assert.equal(vormVoorRust({ type: 'highlight', x: 1, y: 2, width: 30, height: 8, color: '#ffff00', opacity: 0.6 }).fill.alpha, 0.6);
});

test('wat Rust niet zeker weet blijft bij JS', () => {
  const basis = { type: 'box', x: 0, y: 0, width: 5, height: 5, color: '#000000' };
  assert.ok(vormVoorRust(basis));
  for (const extra of [
    { hidden: true }, { blendMode: 'multiply' }, { hatchPattern: 'diagonal' }, { cross: true },
    { flipX: true }, { color: 'rgb(0,0,0)' }, { x: NaN }, { rotation: 'schuin' }, { opacity: 'half' },
    { lineWidth: 0, fillColor: '#ff0000' }, { fillColor: 'rgba(255,0,0,0.5)' },
  ]) {
    assert.equal(vormVoorRust({ ...basis, ...extra }), null, JSON.stringify(extra));
  }
  assert.equal(vormVoorRust({ type: 'textbox', x: 0, y: 0, width: 5, height: 5 }), null);
  assert.equal(vormVoorRust({ type: 'arrow', startX: 0, startY: 0, endX: 5, endY: 5, color: '#000000' }), null);
  assert.equal(vormVoorRust(null), null);
});

test('verdelen: alleen de pagina, in de volgorde van de lijst', () => {
  const lijst = [
    { type: 'line', page: 1, startX: 0, startY: 0, endX: 1, endY: 1, color: '#000000' },
    { type: 'textbox', page: 1 },
    { type: 'box', page: 2, x: 0, y: 0, width: 5, height: 5, color: '#000000' },
    { type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, color: '#000000' },
  ];
  const { shapes, rest } = verdeelVoorRust(lijst, 1);
  assert.deepEqual(shapes.map((s) => s.t), ['line', 'box']);
  assert.deepEqual(rest.map((a) => a.type), ['textbox']);
});

test('de aanvraag en het antwoord van het commando', async () => {
  const gezien = [];
  const antwoord = new Uint8Array(4 + 3 * 2 * 4).fill(9);
  new DataView(antwoord.buffer).setUint32(0, 7, true);
  const laag = await tekenRustLaag(async (naam, args) => { gezien.push([naam, args]); return antwoord.buffer; },
    { width: 3, height: 2, scale: 1.5, offsetX: 10 }, [{ t: 'line' }]);
  assert.deepEqual(gezien, [['annot_layer_render', { view: { width: 3, height: 2, scale: 1.5, offset_x: 10, offset_y: 0 }, shapes: [{ t: 'line' }] }]]);
  assert.equal(laag.drawn, 7);
  assert.equal(laag.rgba.length, 24);
  assert.equal(laag.rgba[0], 9);
  assert.throws(() => decodeLaag(new Uint8Array(10), 3, 2), /ANNOT_LAYER_ANSWER/);
});
