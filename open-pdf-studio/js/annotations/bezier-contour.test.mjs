import test from 'node:test';
import assert from 'node:assert/strict';
import { contourSegments, contourPoint, splitContourSegment, moveContourNode,
  straightenContourSegment, transformContour, contourBounds, flattenContour,
  traceContour } from './bezier-contour.js';

const arch = [
  { x: 0, y: 0, outgoing: { x: 0, y: 100 }, label: 'start' },
  { x: 100, y: 0, incoming: { x: 100, y: 100 }, label: 'end' },
  { x: 150, y: 0 },
];
function near(a, b, tolerance = 1e-8) {
  for (const k of ['x', 'y']) assert.ok(Math.abs(a[k] - b[k]) <= tolerance, `${k}: ${a[k]} != ${b[k]}`);
}
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
// Independent Bernstein polynomial reference, not de Casteljau.
function bernstein(s, t) {
  const q = 1 - t, p = {};
  for (const axis of ['x', 'y']) p[axis] = q ** 3 * s.start[axis] + 3 * q ** 2 * t * s.c1[axis]
    + 3 * q * t ** 2 * s.c2[axis] + t ** 3 * s.end[axis];
  return p;
}

test('mixed straight/cubic segments, exact arch height, open endpoints', () => {
  const segs = contourSegments(arch);
  assert.deepEqual(segs.map(s => s.kind), ['cubic', 'line']);
  near(contourPoint(segs[0], 0.5), { x: 50, y: 75 });
  assert.deepEqual(contourBounds(arch), { x: 0, y: 0, width: 150, height: 75 });
  const flat = flattenContour(arch);
  assert.equal(flat.truncated, false);
  near(flat.points[0], arch[0]); near(flat.points.at(-1), arch.at(-1));
});

test('one node handle suffices; incoming/outgoing belong to different segments', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 60, y: 0, incoming: { x: 30, y: 80 } }, { x: 80, y: 20 }];
  const [curve, line] = contourSegments(nodes);
  near(curve.c1, nodes[0]); near(curve.c2, nodes[1].incoming);
  assert.equal(line.kind, 'line');
  near(contourPoint(curve, 0.5), { x: 18.75, y: 30 });
});

test('closed polygon includes an independently controlled closing curve', () => {
  const nodes = [{ x: 0, y: 0, incoming: { x: -50, y: -50 } }, { x: 100, y: 0 },
    { x: 100, y: 100, outgoing: { x: -50, y: 100 } }];
  assert.deepEqual(contourSegments(nodes).map(s => s.kind), ['line', 'line']);
  const closed = contourSegments(nodes, true);
  assert.deepEqual(closed.map(s => s.kind), ['line', 'line', 'cubic']);
  assert.equal(closed[2].endIndex, 0);
  assert.ok(contourBounds(nodes, true).x < 0);
  const { points } = flattenContour(nodes, true);
  near(points[0], points.at(-1));
});

test('subdivision preserves the whole curve, neighbours and metadata without mutation', () => {
  const original = frozen(structuredClone(arch));
  const old = contourSegments(original);
  for (const t of [0.01, 0.2, 0.5, 0.83, 0.99]) {
    const split = splitContourSegment(original, 0, t);
    const next = contourSegments(split);
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      near(contourPoint(next[0], u), bernstein(old[0], t * u));
      near(contourPoint(next[1], u), bernstein(old[0], t + (1 - t) * u));
    }
    assert.deepEqual(next[2], { ...old[1], index: 2, endIndex: 3 });
    assert.equal(split[0].label, 'start'); assert.equal(split[2].label, 'end');
  }
  assert.deepEqual(original, arch);
});

test('splitting closure inserts before the first node logically, without reordering IDs', () => {
  const nodes = [{ x: 0, y: 0, incoming: { x: -20, y: 0 }, id: 'a' },
    { x: 50, y: 50, outgoing: { x: -20, y: 50 }, id: 'b' }];
  const original = contourSegments(nodes, true)[1];
  const split = splitContourSegment(nodes, 1, 0.4, true);
  assert.equal(split[0].id, 'a'); assert.equal(split[1].id, 'b');
  const next = contourSegments(split, true);
  for (let i = 0; i <= 50; i++) {
    near(contourPoint(next[1], i / 50), bernstein(original, 0.4 * i / 50));
    near(contourPoint(next[2], i / 50), bernstein(original, 0.4 + 0.6 * i / 50));
  }
  const line = splitContourSegment([{ x: 0, y: 0 }, { x: 10, y: 20 }], 0, 0.3);
  assert.deepEqual(line, [{ x: 0, y: 0 }, { x: 3, y: 6 }, { x: 10, y: 20 }]);
});

test('moving a node preserves attached tangent vectors and independent neighbouring handles', () => {
  const nodes = frozen([{ x: 0, y: 0, outgoing: { x: 20, y: -10 } },
    { x: 50, y: 50, incoming: { x: 20, y: 40 }, outgoing: { x: 60, y: 80 } }, { x: 90, y: 20 }]);
  const moved = moveContourNode(nodes, 1, 10, -20);
  assert.deepEqual(moved[1], { x: 60, y: 30, incoming: { x: 30, y: 20 }, outgoing: { x: 70, y: 60 } });
  assert.deepEqual(moved[0], nodes[0]); assert.deepEqual(moved[2], nodes[2]);
  assert.deepEqual(moveContourNode(moved, 1, -10, 20), nodes);
});

test('editing accepts reactive-style proxies and returns independent JSON geometry', () => {
  const source = structuredClone(arch);
  source[0].extra = { note: 'keep metadata' };
  const nodes = new Proxy(source.map(p => new Proxy(p, {})), {});
  const edited = [moveContourNode(nodes, 0, 2, 3), splitContourSegment(nodes, 0),
    straightenContourSegment(nodes, 0), transformContour(nodes, [1, 0, 0, 1, 2, 3])];
  for (const result of edited) {
    assert.deepEqual(result[0].extra, source[0].extra);
    result[0].extra.note = 'independent';
    assert.equal(source[0].extra.note, 'keep metadata');
  }
  assert.deepEqual(source[0].outgoing, arch[0].outgoing);
});

test('straightening a segment retains adjacent curves, source data and endpoint metadata', () => {
  const nodes = frozen([{ ...arch[0], incoming: { x: -10, y: 10 } },
    { ...arch[1], outgoing: { x: 140, y: 40 }, arc: true, bulge: 0.5 }, arch[2]]);
  const result = straightenContourSegment(nodes, 0, true);
  assert.deepEqual(contourSegments(result, true).map(s => s.kind), ['line', 'cubic', 'cubic']);
  assert.equal(result[0].label, 'start'); assert.equal(result[1].label, 'end');
  assert.ok(nodes[0].outgoing && nodes[1].incoming && nodes[1].arc);
});

test('affine transforms preserve the curve under move, rotation, reflection and anisotropic scaling', () => {
  const matrices = [[1, 0, 0, 1, 30, -5], [0, 1, -1, 0, 100, 80], [-2, 0, 0, 0.3, 12, 22], [1, 0.5, 0.8, 1, 5, 7]];
  for (const matrix of matrices) {
    const before = contourSegments(arch, true), after = contourSegments(transformContour(frozen(structuredClone(arch)), matrix, true), true);
    const [a, b, c, d, e, f] = matrix;
    for (let k = 0; k < before.length; k++) for (let i = 0; i <= 40; i++) {
      const p = contourPoint(before[k], i / 40);
      near(contourPoint(after[k], i / 40), { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
    }
  }
});

test('legacy bulge arcs convert exactly, including closure and a non-uniform reflection', () => {
  const nodes = [{ x: 0, y: 0, arc: true, bulge: -0.2 }, { x: 100, y: 0, arc: true, bulge: 0.4 }];
  const segs = contourSegments(nodes, true);
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    near(contourPoint(segs[0], t), { x: 100 * t, y: 80 * t * (1 - t) });
  }
  const mapped = transformContour(nodes, [-2, 0, 0, 3, 10, 20], true);
  assert.ok(mapped.every(p => !('arc' in p) && !('bulge' in p)));
  for (const [i, s] of contourSegments(mapped, true).entries()) for (let j = 0; j <= 30; j++) {
    const p = contourPoint(segs[i], j / 30);
    near(contourPoint(s, j / 30), { x: -2 * p.x + 10, y: 3 * p.y + 20 });
  }
  const split = splitContourSegment(nodes, 0, 0.3, true);
  for (let i = 0; i <= 20; i++) near(contourPoint(contourSegments(split, true)[0], i / 20), contourPoint(segs[0], 0.3 * i / 20));
});

test('bounds enclose dense independent curve samples for loops, cusps, overshoot and degeneracy', () => {
  let seed = 1169;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 * 400 - 200; };
  const fixtures = [
    [{ x: 0, y: 0, outgoing: { x: 100, y: 0 } }, { x: 0, y: 0, incoming: { x: -100, y: 0 } }],
    [{ x: 0, y: 0, outgoing: { x: 0, y: 0 } }, { x: 0, y: 0 }],
  ];
  for (let i = 0; i < 80; i++) fixtures.push([{ x: random(), y: random(), outgoing: { x: random(), y: random() } },
    { x: random(), y: random(), incoming: { x: random(), y: random() } }]);
  for (const nodes of fixtures) {
    const b = contourBounds(nodes), s = contourSegments(nodes)[0];
    for (let i = 0; i <= 500; i++) {
      const p = bernstein(s, i / 500);
      assert.ok(p.x >= b.x - 1e-8 && p.x <= b.x + b.width + 1e-8);
      assert.ok(p.y >= b.y - 1e-8 && p.y <= b.y + b.height + 1e-8);
    }
  }
});

test('adaptive flattening respects tolerance, preserves collinear overshoot, reports exhaustion', () => {
  const { points, truncated } = flattenContour(arch, false, 0.1);
  assert.equal(truncated, false);
  const segmentDistance = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
    const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const curve = contourSegments(arch)[0];
  for (let i = 0; i <= 500; i++) {
    const p = bernstein(curve, i / 500);
    assert.ok(Math.min(...points.slice(1).map((b, k) => segmentDistance(p, points[k], b))) <= 0.1);
  }
  const loop = [{ x: 0, y: 0, outgoing: { x: 100, y: 0 } }, { x: 0, y: 0, incoming: { x: -100, y: 0 } }];
  const flat = flattenContour(loop, false, 0.01);
  assert.ok(Math.max(...flat.points.map(p => p.x)) > 28);
  assert.ok(Math.min(...flat.points.map(p => p.x)) < -28);
  assert.equal(flat.truncated, false);
  const capped = flattenContour(arch, false, 0.001, 0);
  assert.equal(capped.truncated, true); assert.equal(capped.points.length, 3);
});

test('empty/single-node contours and invalid input have explicit outcomes', () => {
  assert.deepEqual(contourSegments([]), []); assert.equal(contourBounds([]), null);
  assert.deepEqual(flattenContour([]), { points: [], truncated: false });
  assert.deepEqual(contourBounds([{ x: 2, y: 3 }], true), { x: 2, y: 3, width: 0, height: 0 });
  for (const nodes of [null, [{ x: NaN, y: 2 }], [{ x: 1, y: 2, incoming: { x: Infinity, y: 0 } }], [{ x: 0, y: 0, arc: true, bulge: Infinity }]]) {
    assert.throws(() => contourSegments(nodes), TypeError);
  }
  for (const t of [-1, 0, 1, NaN]) assert.throws(() => splitContourSegment(arch, 0, t), RangeError);
  assert.throws(() => splitContourSegment(arch, 2), RangeError);
  assert.throws(() => moveContourNode(arch, -1, 1, 1), RangeError);
  assert.throws(() => transformContour(arch, [1, 0]), TypeError);
  assert.throws(() => flattenContour(arch, false, 0), RangeError);
  assert.throws(() => flattenContour(arch, false, 1, 21), RangeError);
});

test('canvas path mixes cubic and straight operators without resetting caller path', () => {
  const calls = [];
  const ctx = Object.fromEntries(['moveTo', 'lineTo', 'bezierCurveTo', 'closePath'].map(name => [name, (...args) => calls.push([name, ...args])]));
  traceContour(ctx, arch, true);
  assert.deepEqual(calls, [['moveTo', 0, 0], ['bezierCurveTo', 0, 100, 100, 100, 100, 0], ['lineTo', 150, 0], ['lineTo', 0, 0], ['closePath']]);
});
