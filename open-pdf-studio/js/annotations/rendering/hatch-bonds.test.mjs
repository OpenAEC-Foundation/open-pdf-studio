// #1217: test actual ink, not just the infinite carrier lines of a hatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hatchFillOps } from '../../pdf/saver/appearance-vectors.js';

globalThis.window = {};
const url = new URL('./hatch-patterns.js', import.meta.url);
const source = readFileSync(url, 'utf8')
  .replace(/^import \{ state \}.*$/m, 'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };')
  .replace(/from '(\.[^']*)'/g, (_, spec) => `from '${new URL(spec, url).href}'`);
const { applyHatchFill } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function canvasLines(pattern, scale, width, height) {
  let start, dash = []; const lines = [];
  const ctx = {
    save() {}, restore() {}, clip() {}, beginPath() {}, stroke() {},
    lineDashOffset: 0,
    setLineDash(d) { dash = d; },
    moveTo(x, y) { start = [x, y]; },
    lineTo(x, y) { lines.push({ start, end: [x, y], dash, phase: this.lineDashOffset }); },
  };
  applyHatchFill(ctx, { x: -width / 2, y: -height / 2, width, height,
    hatchPattern: pattern, hatchScale: scale * 100, hatchAngle: 0 });
  return lines;
}

function pdfLines(pattern, scale, width, height) {
  const ops = hatchFillOps({
    points: [{ x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
      { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 }],
    hatchPattern: pattern, hatchScale: scale * 100, hatchAngle: 0,
    hatchColorRgb: [0, 0, 0], X: x => x, Y: y => y,
  });
  let dash = [], phase = 0; const lines = [];
  for (const line of ops.split('\n')) {
    const d = line.match(/^\[([^\]]*)\] ([\d.e+-]+) d$/);
    if (d) { dash = d[1].trim() ? d[1].trim().split(/\s+/).map(Number) : []; phase = Number(d[2]); }
    const l = line.match(/^([\d.e+-]+) ([\d.e+-]+) m ([\d.e+-]+) ([\d.e+-]+) l S$/);
    if (l) lines.push({ start: [Number(l[1]), Number(l[2])], end: [Number(l[3]), Number(l[4])], dash, phase });
  }
  assert.ok(lines.length); return lines;
}

function inkAt(lines, x, y) {
  return lines.some(({ start: [ax, ay], end: [bx, by], dash, phase }) => {
    const length = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / length, dy = (by - ay) / length;
    const t = (x - ax) * dx + (y - ay) * dy;
    if (t < 0 || t > length || Math.abs((x - ax) * dy - (y - ay) * dx) > .02) return false;
    if (!dash.length) return true;
    const period = dash.reduce((a, b) => a + b, 0);
    let offset = ((t + phase) % period + period) % period;
    for (let i = 0; i < dash.length; i++) { if (offset < dash[i]) return i % 2 === 0; offset -= dash[i]; }
    return false;
  });
}

for (const [engine, draw] of [['canvas', canvasLines], ['PDF', pdfLines]]) {
  for (const [width, height, scale] of [[121, 173, .6], [240, 150, 1], [317, 241, 1.8]]) {
    for (const pattern of ['brick-running', 'brick-stack']) {
      test(`${engine} ${pattern}: every course has correct joints (${width}x${height}, ${scale})`, () => {
        const lines = draw(pattern, scale, width, height);
        for (let row = -2; row < 3; row++) for (let col = -2; col < 3; col++) {
          const x = col * 10 * scale, y = (row * 10 + 5) * scale;
          const expected = pattern === 'brick-stack' ? col % 2 === 0 : (row + col) % 2 === 0;
          assert.equal(inkAt(lines, x, y), expected, `joint row ${row}, column ${col}`);
          if (expected) for (const end of [.1, 9.9]) {
            assert.ok(inkAt(lines, x, (row * 10 + end) * scale), 'joint meets both bed joints');
          }
        }
      });
    }
    test(`${engine} earth blocks: alternating orientation in every row (${width}x${height}, ${scale})`, () => {
      const lines = draw('grond-blokjes', scale, width, height);
      for (let row = -2; row < 3; row++) for (let col = -2; col < 3; col++) {
        const vertical = (row + col) % 2 === 0;
        assert.equal(inkAt(lines, (col * 6 + 2) * scale, (row * 6 + 1) * scale), vertical, `vertical ${col},${row}`);
        assert.equal(inkAt(lines, (col * 6 + 1) * scale, (row * 6 + 2) * scale), !vertical, `horizontal ${col},${row}`);
      }
    });
  }
}
