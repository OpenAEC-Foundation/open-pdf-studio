// Zoom in on the hatched filled area, which 01-geometry.mjs showed to be the
// slowest single appearance builder. Reports both time and the size of the
// operator string that ends up in the PDF, for a few area sizes and patterns.
//
// Run: node scripts/bench-rust/02-hatch.mjs

import { bench, report } from './lib.mjs';
import { buildFilledAreaAP } from '../../js/pdf/saver/appearance-vectors.js';

function poly(n, radius, cx = 1000, cy = 800) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return pts;
}

const id = (v) => v;
function run(points, hatchPattern, hatchScale) {
  return buildFilledAreaAP({
    points, holes: null, X: id, Y: id,
    fillColorHex: '#cce5ff', strokeColorHex: '#003366',
    lineWidth: 1, borderStyle: 'solid',
    hatchPattern, hatchColorHex: '#003366',
    hatchScale, hatchAngle: 0, heeftRand: true,
  });
}

const rows = [];
console.log('pattern / radius (pt) / hatchScale -> operator-string size');
for (const [radius, label] of [[100, 'small 200pt'], [300, 'medium 600pt'], [900, 'A0-sized 1800pt']]) {
  for (const pattern of ['diagonal', 'cross']) {
    for (const scale of [100, 25]) {
      const pts = poly(60, radius);
      let out;
      try { out = run(pts, pattern, scale); } catch (e) { console.log('  skip', pattern, e.message); continue; }
      if (!out) { console.log('  null for', pattern); continue; }
      const bytes = (out.ops ?? out.stream ?? out.content ?? (typeof out === 'string' ? out : JSON.stringify(out))).length;
      const name = `${label} ${pattern} scale ${scale}`;
      console.log(`  ${name.padEnd(36)} ${String(bytes).padStart(9)} chars`);
      rows.push(bench(name, () => run(pts, pattern, scale), { iters: radius >= 900 ? 5 : 50, warm: 1, repeat: 3 }));
    }
  }
}

// Same areas with no hatch at all, to separate the hatch cost from the rest.
for (const [radius, label] of [[300, 'medium 600pt'], [900, 'A0-sized 1800pt']]) {
  const pts = poly(60, radius);
  rows.push(bench(`${label} solid fill, no hatch`, () => run(pts, 'none', 100), { iters: 200, warm: 1, repeat: 3 }));
}

report(rows);
