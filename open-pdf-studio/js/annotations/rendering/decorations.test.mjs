// Een gesloten pijlpunt zonder vulling (PDF: /LE ClosedArrow zonder /IC).
//
// Volgens de PDF-specificatie blijft het binnenste van een gesloten
// lijnuiteinde zonder /IC doorzichtig. Een maatlijn uit een ander programma
// tekent die punt daarom alleen als omtrek. De app vulde hem altijd.

import assert from 'node:assert/strict';
import test from 'node:test';

import { drawArrowheadOnCanvas, drawDimensionLineEnding } from './decorations.js';

/** Een nep-canvas dat bijhoudt welke tekenopdrachten er komen. */
function nepCtx() {
  const oproepen = [];
  const ctx = { lineWidth: 1, fillStyle: '#ff0000', strokeStyle: '#ff0000', lineJoin: 'miter', miterLimit: 10 };
  for (const naam of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo',
    'closePath', 'fill', 'stroke', 'arc', 'rect']) {
    ctx[naam] = (...args) => oproepen.push([naam, ...args]);
  }
  return { ctx, oproepen, telt: (naam) => oproepen.filter((o) => o[0] === naam).length };
}

test('een holle gesloten maatpunt wordt alleen omlijnd', () => {
  const { ctx, telt } = nepCtx();
  drawDimensionLineEnding(ctx, 10, 20, 0, 7.794, 'closed', { hol: true });
  assert.equal(telt('fill'), 0, 'geen vulling');
  assert.equal(telt('stroke'), 1, 'wel de omtrek');
  assert.equal(telt('closePath'), 1, 'een gesloten driehoek');
});

test('een holle gesloten pijlpunt (ook omgekeerd) wordt alleen omlijnd', () => {
  for (const stijl of ['closed', 'closedReversed', 'diamond', 'square', 'circle']) {
    const { ctx, telt } = nepCtx();
    drawArrowheadOnCanvas(ctx, 0, 0, 0, 8, stijl, { hol: true });
    assert.equal(telt('fill'), 0, `${stijl}: geen vulling`);
    assert.equal(telt('stroke'), 1, `${stijl}: wel de omtrek`);
  }
});

test('zonder die vlag blijft een gesloten punt gevuld zoals altijd', () => {
  const { ctx, telt } = nepCtx();
  drawDimensionLineEnding(ctx, 10, 20, 0, 12, 'closed');
  assert.equal(telt('fill'), 1);
  assert.equal(telt('stroke'), 1);
  const pijl = nepCtx();
  drawArrowheadOnCanvas(pijl.ctx, 0, 0, 0, 12, 'closed');
  assert.equal(pijl.telt('fill'), 1);
});

test('een holle punt houdt de volle lijndikte, zodat zijn verstekpunt op de maat valt', () => {
  // De gevulde punt tekent zijn omtrek met hoogstens 1; een holle punt is
  // alleen omtrek en volgt de lijn (zie de appearance van zo'n maat: 1 w).
  const lijndiktes = [];
  const { ctx } = nepCtx();
  ctx.lineWidth = 2;
  ctx.stroke = () => lijndiktes.push(ctx.lineWidth);
  drawArrowheadOnCanvas(ctx, 0, 0, 0, 8, 'closed', { hol: true });
  assert.deepEqual(lijndiktes, [2]);
});
