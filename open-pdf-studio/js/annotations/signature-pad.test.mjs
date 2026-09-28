import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignaturePad, SIGNATURE_LINE_WIDTH } from './signature-pad.js';

// Stand-in for a <canvas>: `ink` lists the paths that are visible on it.
// clearRect wipes it, getImageData/putImageData save and restore it, and each
// stroke() adds the current path with the colour and width in force.
function fakeCanvas(width = 430, height = 150) {
  const canvas = { width, height, ink: [] };
  let path = [];
  const ctx = {
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '#000000',
    clearRect() { canvas.ink = []; },
    getImageData() { return { ink: canvas.ink.slice() }; },
    putImageData(image) { canvas.ink = image.ink.slice(); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    stroke() {
      canvas.ink.push({ color: this.strokeStyle, width: this.lineWidth, cap: this.lineCap, points: path.slice() });
    },
  };
  canvas.getContext = (kind) => (kind === '2d' ? ctx : null);
  return canvas;
}

function drawStroke(pad, points, color = '#000000') {
  pad.begin(points[0][0], points[0][1], color);
  for (const [x, y] of points.slice(1)) pad.extend(x, y);
  pad.end();
}

test('a stroke lands on the attached canvas and counts as ink', () => {
  const pad = createSignaturePad();
  const canvas = fakeCanvas();
  pad.attach(canvas);
  assert.equal(pad.canvas, canvas);
  assert.equal(pad.hasInk(), false);

  drawStroke(pad, [[10, 10], [20, 20], [30, 15]], '#1030c0');

  assert.equal(pad.hasInk(), true);
  assert.deepEqual(canvas.ink, [
    { color: '#1030c0', width: SIGNATURE_LINE_WIDTH, cap: 'round', points: [[10, 10], [20, 20], [30, 15]] },
  ]);
});

test('dragging redraws the stroke in progress instead of stacking copies', () => {
  const pad = createSignaturePad();
  const canvas = fakeCanvas();
  pad.attach(canvas);
  drawStroke(pad, [[5, 5], [15, 5]]);

  pad.begin(40, 40, '#000000');
  pad.extend(50, 45);
  pad.extend(60, 50);
  pad.extend(70, 40);

  assert.equal(canvas.ink.length, 2, 'the earlier stroke plus one copy of the stroke in progress');
  assert.deepEqual(canvas.ink[1].points, [[40, 40], [50, 45], [60, 50], [70, 40]]);
  pad.end();
  assert.equal(canvas.ink.length, 2);
});

test('#492: a canvas built anew for the Draw tab gets the drawing and every new stroke', () => {
  const pad = createSignaturePad();
  const first = fakeCanvas();
  pad.attach(first);
  drawStroke(pad, [[10, 10], [60, 30]]);

  // Saved tab and back: the dialog builds a new canvas and attaches it.
  const second = fakeCanvas();
  pad.attach(second);
  assert.equal(pad.canvas, second);
  assert.deepEqual(second.ink.map((p) => p.points), [[[10, 10], [60, 30]]], 'earlier drawing repainted');

  drawStroke(pad, [[100, 80], [140, 90], [180, 70]]);
  assert.deepEqual(second.ink.map((p) => p.points), [
    [[10, 10], [60, 30]],
    [[100, 80], [140, 90], [180, 70]],
  ]);
  assert.equal(first.ink.length, 1, 'nothing more is painted into the canvas that left the screen');
});

test('the line style is set for every stroke, not once per canvas', () => {
  const pad = createSignaturePad();
  const canvas = fakeCanvas();
  pad.attach(canvas);
  // A canvas whose size is set again resets its context to the defaults.
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';

  drawStroke(pad, [[0, 0], [10, 10]]);
  assert.equal(canvas.ink[0].width, SIGNATURE_LINE_WIDTH);
  assert.equal(canvas.ink[0].cap, 'round');
});

test('a click without movement leaves no ink', () => {
  const pad = createSignaturePad();
  const canvas = fakeCanvas();
  pad.attach(canvas);
  pad.begin(25, 25, '#000000');
  pad.end();
  assert.equal(pad.hasInk(), false);
  assert.deepEqual(canvas.ink, []);
});

test('undo and clear repaint the canvas, and drawing goes on afterwards', () => {
  const pad = createSignaturePad();
  const canvas = fakeCanvas();
  pad.attach(canvas);
  drawStroke(pad, [[0, 0], [10, 0]]);
  drawStroke(pad, [[0, 20], [10, 20]]);

  pad.undo();
  assert.deepEqual(canvas.ink.map((p) => p.points), [[[0, 0], [10, 0]]]);

  pad.clear();
  assert.equal(pad.hasInk(), false);
  assert.deepEqual(canvas.ink, []);
  pad.undo();
  assert.deepEqual(canvas.ink, []);

  drawStroke(pad, [[5, 5], [25, 30]]);
  assert.equal(pad.hasInk(), true);
  assert.deepEqual(canvas.ink.map((p) => p.points), [[[5, 5], [25, 30]]]);
});

test('without a canvas the pad ignores pointer input', () => {
  const pad = createSignaturePad();
  assert.doesNotThrow(() => {
    drawStroke(pad, [[0, 0], [10, 10]]);
    pad.undo();
    pad.clear();
  });
  assert.equal(pad.hasInk(), false);
  assert.equal(pad.canvas, null);
});
