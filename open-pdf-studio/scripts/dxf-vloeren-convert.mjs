// Dev-time converter: DXF floor cross-sections → js/symbols/data/vbi-vloeren.js
//
// Reads the local floor DXF library (LWPOLYLINE-only vendor sections, mm
// units), polygonizes bulge arcs, flips Y (DXF is y-up, canvas y-down),
// normalizes the origin to (0,0) and emits one compact JS data module the
// parametric 'vloer-*' templates render at real size.
//
// Usage:  node scripts/dxf-vloeren-convert.mjs "<library root>"
// Default root: C:\Users\rickd\Documents\GitHub\Project-Ocondat\DXF Library\001 Vloeren

import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join, basename } from 'path';

const ROOT = process.argv[2] ||
  'C:\\Users\\rickd\\Documents\\GitHub\\Project-Ocondat\\DXF Library\\001 Vloeren';
const OUT = new URL('../js/symbols/data/vbi-vloeren.js', import.meta.url);
const OUT_INDEX = new URL('../js/symbols/data/vbi-vloeren-index.js', import.meta.url);

// ── DXF parsing (ENTITIES → LWPOLYLINE / LINE / ARC / CIRCLE) ──────────────
function parsePairs(text) {
  const lines = text.split(/\r\n|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  }
  return pairs;
}

function parseEntities(pairs) {
  const out = [];
  let inEnt = false;
  let cur = null;
  for (const [code, val] of pairs) {
    if (code === '2' && val === 'ENTITIES') { inEnt = true; continue; }
    if (!inEnt) continue;
    if (code === '0' && val === 'ENDSEC') break;
    if (code === '0') {
      if (cur) out.push(cur);
      cur = { type: val, pts: [], closed: false, props: {}, layer: '' };
      continue;
    }
    if (!cur) continue;
    const n = parseFloat(val);
    switch (code) {
      case '8': cur.layer = val; break;
      case '70': if (cur.type === 'LWPOLYLINE' && (parseInt(val) & 1)) cur.closed = true; break;
      case '10': cur.pts.push({ x: n, y: 0, bulge: 0 }); cur.props.x = n; break;
      case '20': if (cur.pts.length) cur.pts[cur.pts.length - 1].y = n; cur.props.y = n; break;
      case '42': if (cur.pts.length) cur.pts[cur.pts.length - 1].bulge = n; break;
      case '11': cur.props.x2 = n; break;
      case '21': cur.props.y2 = n; break;
      case '40': cur.props.r = n; break;
      case '50': cur.props.a0 = n; break;
      case '51': cur.props.a1 = n; break;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Bulge segment (p1→p2, b = tan(sweep/4)) → polygonized arc points (excl. p1, incl. p2)
function bulgeToPoints(p1, p2, b) {
  if (!b) return [p2];
  const theta = 4 * Math.atan(b);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (Math.hypot(dx, dy) < 1e-9) return [p2];
  // Compact closed form: tan(theta/2) carries both sign and large-arc cases.
  const t2 = Math.tan(theta / 2);
  const cx = (p1.x + p2.x) / 2 - dy / (2 * t2);
  const cy = (p1.y + p2.y) / 2 + dx / (2 * t2);
  const r = Math.hypot(p1.x - cx, p1.y - cy);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  const segs = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 12))); // ≤15°/seg
  const out = [];
  for (let i = 1; i <= segs; i++) {
    const a = a1 + theta * (i / segs);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  out[out.length - 1] = { x: p2.x, y: p2.y }; // exact endpoint
  return out;
}

// Material classification from the DXF layer name. 'c' = (reinforced)
// concrete → gets the prefab-concrete hatch in the app; 'i' = insulation.
function materialOf(layer) {
  const l = (layer || '').toLowerCase();
  if (l.includes('concrete') || l.includes('beton')) return 'c';
  if (l.includes('insulation') || l.includes('isolat')) return 'i';
  return 'x';
}

function entityToPaths(e) {
  const m = materialOf(e.layer);
  switch (e.type) {
    case 'LWPOLYLINE': {
      if (e.pts.length < 2) return [];
      const pts = [{ x: e.pts[0].x, y: e.pts[0].y }];
      for (let i = 1; i < e.pts.length; i++) {
        pts.push(...bulgeToPoints(e.pts[i - 1], e.pts[i], e.pts[i - 1].bulge));
      }
      if (e.closed && e.pts[e.pts.length - 1].bulge) {
        pts.push(...bulgeToPoints(e.pts[e.pts.length - 1], e.pts[0], e.pts[e.pts.length - 1].bulge));
        pts.pop(); // closePath provides the final point
      }
      return [{ closed: e.closed, pts, m }];
    }
    case 'LINE':
      return [{ closed: false, pts: [{ x: e.props.x, y: e.props.y }, { x: e.props.x2, y: e.props.y2 }], m }];
    case 'CIRCLE': {
      const { x, y, r } = e.props;
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        pts.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
      }
      return [{ closed: true, pts }];
    }
    case 'ARC': {
      const { x, y, r } = e.props;
      let a0 = (e.props.a0 || 0) * Math.PI / 180;
      let a1 = (e.props.a1 || 0) * Math.PI / 180;
      if (a1 <= a0) a1 += 2 * Math.PI;
      const segs = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 12)));
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (a1 - a0) * (i / segs);
        pts.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
      }
      return [{ closed: false, pts }];
    }
    default:
      return [];
  }
}

function convertFile(file) {
  const ents = parseEntities(parsePairs(readFileSync(file, 'latin1')));
  let paths = ents.flatMap(entityToPaths).filter(p => p.pts.length >= 2);
  // Drop degenerate stray paths (zero-size leftovers far outside the section
  // would otherwise inflate the real-size extents — seen in TL200 Rand. I).
  paths = paths.filter(p => {
    let nx = Infinity, ny = Infinity, xx = -Infinity, xy = -Infinity;
    for (const pt of p.pts) {
      if (pt.x < nx) nx = pt.x; if (pt.x > xx) xx = pt.x;
      if (pt.y < ny) ny = pt.y; if (pt.y > xy) xy = pt.y;
    }
    return (xx - nx) >= 0.5 || (xy - ny) >= 0.5;
  });
  if (!paths.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const pt of p.pts) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  const w = maxX - minX, h = maxY - minY;
  const r1 = v => Math.round(v * 10) / 10;
  // Normalize: origin top-left, Y-FLIP (DXF y-up → canvas y-down)
  const out = paths.map(p => ({
    c: p.closed ? 1 : 0,
    m: p.m || 'x',
    p: p.pts.flatMap(pt => [r1(pt.x - minX), r1(maxY - pt.y)]),
  }));
  return { w: r1(w), h: r1(h), paths: out };
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function labelFor(fileName, familyPrefix) {
  return basename(fileName, '.dxf')
    .replace(new RegExp(`^VBI\\s+${familyPrefix}\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function* dxfFilesUnder(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* dxfFilesUnder(full);
    else if (name.toLowerCase().endsWith('.dxf')) yield full;
  }
}

const FAMILIES = [
  { dir: 'Kanaalplaatvloer', id: 'kanaalplaatvloer', name: 'Kanaalplaatvloer', prefix: 'Kanaalplaatvloer' },
  { dir: 'Isolatieplaatvloer', id: 'isolatieplaatvloer', name: 'Isolatieplaatvloer', prefix: 'Isolatieplaatvloer' },
  { dir: 'PS-isolatievloer', id: 'ps-isolatievloer', name: 'PS-isolatievloer', prefix: 'PS-isolatievloer' },
];

const result = [];
let total = 0;
for (const fam of FAMILIES) {
  const variants = [];
  for (const file of dxfFilesUnder(join(ROOT, fam.dir))) {
    const conv = convertFile(file);
    if (!conv) { console.warn('skip (no geometry):', file); continue; }
    const label = labelFor(file, fam.prefix);
    variants.push({ id: slug(label), label, ...conv });
    total++;
  }
  variants.sort((a, b) => a.label.localeCompare(b.label, 'nl', { numeric: true }));
  result.push({ id: fam.id, name: fam.name, variants });
}

const header = `// AUTO-GENERATED by scripts/dxf-vloeren-convert.mjs — do not edit by hand.
// Floor cross-section geometry (mm, origin top-left, y-down) converted from
// the local DXF floor library. Regenerate with:
//   node scripts/dxf-vloeren-convert.mjs "<library root>"

`;
writeFileSync(OUT, header + 'export const VLOER_FAMILIES = ' + JSON.stringify(result) + ';\n');
// De index (families, maten, labels) laadt bij de start; de geometrie in
// vbi-vloeren.js pas bij het eerste tekenen van een vloer (#454).
const index = result.map((f) => ({ id: f.id, name: f.name, variants: f.variants.map(({ id, label, w, h }) => ({ id, label, w, h })) }));
const indexHeader = `// AUTO-GENERATED by scripts/dxf-vloeren-convert.mjs — do not edit by hand.
// Index of the floor cross-sections in vbi-vloeren.js (ids, labels, sizes in
// mm) without the geometry, which loads on the first draw of a floor.

`;
writeFileSync(OUT_INDEX, indexHeader + 'export const VLOER_INDEX = ' + JSON.stringify(index) + ';\n');
console.log(`Wrote ${total} variants across ${result.length} families to`, OUT.pathname);
for (const f of result) console.log(`  ${f.name}: ${f.variants.length} varianten`);
