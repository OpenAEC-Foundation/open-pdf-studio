// Een maat met het bijschrift in de lijn op het scherm: hulplijnen, de
// maatlijn in twee stukken rond de tekst, holle punten en de tekst midden op
// de lijn in zijn eigen kleur en grootte (zie annotations/maatlijn-inline.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { tekenInlineMaat } from './maat-inline-tekenen.js';
import { HOOFDLETTER_HOOGTE } from '../maatlijn-inline.js';

/** Een nep-canvas dat de lijnstukken, vullingen en teksten bijhoudt. */
function nepCtx() {
  const log = { strokes: [], fills: 0, teksten: [] };
  let pad = [];
  let huidig = null;
  const ctx = {
    lineWidth: 1, fillStyle: '#0000ff', strokeStyle: '#0000ff', font: '', textAlign: 'start', textBaseline: 'alphabetic',
    save() {}, restore() {}, translate() {}, rotate() {}, closePath() {}, arc() {}, rect() {},
    beginPath() { pad = []; },
    moveTo(x, y) { huidig = [x, y]; },
    lineTo(x, y) { pad.push([...huidig, x, y]); huidig = [x, y]; },
    stroke() { log.strokes.push(pad); },
    fill() { log.fills++; },
    fillText(tekst, x, y) { log.teksten.push({ tekst, x, y, font: ctx.font, kleur: ctx.fillStyle, align: ctx.textAlign, basis: ctx.textBaseline }); },
  };
  return { ctx, log };
}

const MAAT = {
  startX: 185.754, startY: 148.5, endX: 338.504, endY: 148.5,
  leaderStartX: 185.75, leaderStartY: 158.24, leaderEndX: 338.5, leaderEndY: 158.24,
  startHead: 'closed', endHead: 'closed', headSize: 7.794, headFill: false, lineWidth: 1,
  color: '#0000ff', labelColor: '#000000', fontSize: 9, measureText: '5,9 m ',
  dimLineOvershootMm: 0, dimExtGapMm: 0, dimExtOvershootMm: 5 * 25.4 / 72,
};

test('de maatlijn heeft een onderbreking voor de tekst en de punten zijn hol', () => {
  const { ctx, log } = nepCtx();
  tekenInlineMaat(ctx, MAAT);
  assert.equal(log.fills, 0, 'niets gevuld');
  const maatlijn = log.strokes.flat().filter((s) => s[1] === 148.5 && s[3] === 148.5);
  assert.equal(maatlijn.length, 2, 'twee stukken');
  assert.ok(Math.abs(maatlijn[0][2] - 249.124) < 0.05 && Math.abs(maatlijn[1][0] - 275.134) < 0.05);
  const hulplijnen = log.strokes.flat().filter((s) => s[1] === 158.24);
  assert.equal(hulplijnen.length, 2);
  assert.ok(hulplijnen.every((h) => Math.abs(h[3] - (148.5 - 5)) < 1e-6), 'tot 5 pt voorbij de maatlijn');
});

test('de tekst staat midden op de lijn, in zijn eigen kleur en grootte', () => {
  const { ctx, log } = nepCtx();
  tekenInlineMaat(ctx, MAAT);
  assert.equal(log.teksten.length, 1);
  const [t] = log.teksten;
  assert.equal(t.tekst, '5,9 m ');
  assert.equal(t.kleur, '#000000');
  assert.equal(t.font, '9px Arial');
  assert.equal(t.align, 'center');
  assert.equal(t.basis, 'alphabetic');
  assert.equal(t.x, 0);
  assert.ok(Math.abs(t.y - 9 * HOOFDLETTER_HOOGTE / 2) < 1e-9, 'hoofdletters gecentreerd op de lijn');
});

test('zonder eigen tekstkleur krijgt de tekst de lijnkleur', () => {
  const { ctx, log } = nepCtx();
  tekenInlineMaat(ctx, { ...MAAT, labelColor: undefined });
  assert.equal(log.teksten[0].kleur, '#0000ff');
});

test('het scherm tekent maten, pijlen en omtrekmaten met deze regels', () => {
  const metingen = readFileSync(new URL('./measurements.js', import.meta.url), 'utf8');
  assert.ok(metingen.includes("if (textPosition === 'inline')"), 'drawDimension: bijschrift in de lijn');
  assert.ok(metingen.includes('tekenInlineMaat(ctx, {'), 'via tekenInlineMaat');
  assert.ok(metingen.includes('{ hol: headFill === false }'), 'holle punten');
  assert.ok(metingen.includes('labelColor || color'), 'eigen tekstkleur');
  const tekenen = readFileSync(new URL('../rendering.js', import.meta.url), 'utf8');
  for (const regel of [
    'headFill: annotation.headFill,',
    'textPosition: annotation.dimTextPosition,',
    'lineWidth: annotation.lineWidth ?? 1,',
    "const isHeadFilled = (s) => FILLED_HEADS.has(s) && annotation.headFill !== false;",
    '{ hol: annotation.headFill === false }',
  ]) assert.ok(tekenen.includes(regel), regel);
  assert.equal(tekenen.split('{ hol: annotation.headFill === false }').length - 1, 4,
    'pijl (begin en eind) en omtrekmaat (begin en eind)');
});
