// Gelijkwaardigheidstest voor de arceringsrenderer.
//
// De renderer is herschreven zodat hij alleen nog het zichtbare deel van een
// vlak bestrijkt en stippen in één pad zet. Dat mag het BEELD niet veranderen:
// dezelfde lijnen op dezelfde plek, dezelfde stippen op dezelfde plek. Deze
// test draait de oude en de nieuwe berekening naast elkaar en vergelijkt de
// geometrie binnen het vlak.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };

// De echte bron wordt getest; alleen de twee app-brede imports (de
// state-store is TypeScript en trekt SolidJS mee) worden vervangen door
// stubs, zodat de module buiten de browser laadbaar is.
const bron = readFileSync(new URL('./hatch-patterns.js', import.meta.url), 'utf8')
  .replace(/^import \{ arcControlPoint \}.*$/m,
    'const arcControlPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });')
  .replace(/^import \{ state \}.*$/m,
    'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };');

const { BUILTIN_HATCH_PATTERNS, applyHatchFill } =
  await import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));

// --- opnemende 2D-context ------------------------------------------------
// Geen getTransform: dan valt de zichtbaar-gebied-inperking weg en tekent de
// nieuwe code het volledige vlak — precies de situatie die één-op-één met de
// oude uitkomst vergeleken moet worden.
function maakRecorder() {
  const ops = { lijnen: [], stippen: [], vullingen: [] };
  let cur = null;
  const ctx = {
    canvas: { width: 0, height: 0 },
    save() {}, restore() {}, clip() {}, translate() {}, rotate() {},
    setLineDash() {}, beginPath() { cur = null; }, stroke() {}, fill() {},
    fillRect(x, y, w, h) { ops.vullingen.push([x, y, w, h]); },
    moveTo(x, y) { cur = [x, y]; },
    lineTo(x, y) { if (cur) ops.lijnen.push([cur[0], cur[1], x, y]); cur = [x, y]; },
    arc(x, y, r) { ops.stippen.push([r2(x), r2(y), r2(r)]); },
  };
  return { ctx, ops };
}

const r2 = (n) => Math.round(n * 100) / 100;

// --- referentie: de oude drawLineFamily ---------------------------------
function oudeFamilie(ctx, family, left, top, right, bottom, scale) {
  const angleRad = (family.angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const spacing = (family.deltaY || 10) * scale;
  if (spacing <= 0.01) return;
  const deltaX = (family.deltaX || 0) * scale;
  const originX = (family.originX || 0) * scale;
  const originY = (family.originY || 0) * scale;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const diagonal = Math.sqrt((right - left) ** 2 + (bottom - top) ** 2);
  const halfDiag = diagonal / 2 + spacing * 2;
  const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

  if (family.dashPattern && family.dashPattern.includes(0)) {
    const dotRadius = Math.max(0.5, 1 * scale);
    const dotSpacing = deltaX || spacing;
    const dotsPerLine = Math.ceil((halfDiag * 2) / dotSpacing) + 2;
    for (let i = -numLines; i <= numLines; i++) {
      const perp = i * spacing;
      const baseX = cx + perp * (-sinA);
      const baseY = cy + perp * cosA;
      for (let j = -dotsPerLine; j <= dotsPerLine; j++) {
        const along = j * dotSpacing;
        ctx.arc(baseX + originX + along * cosA, baseY + originY + along * sinA, dotRadius);
      }
    }
    return;
  }

  for (let i = -numLines; i <= numLines; i++) {
    const perp = i * spacing;
    const stagger = deltaX !== 0 ? i * deltaX : 0;
    const baseX = cx + perp * (-sinA);
    const baseY = cy + perp * cosA;
    const ox = baseX + originX + stagger * cosA;
    const oy = baseY + originY + stagger * sinA;
    ctx.moveTo(ox - halfDiag * cosA, oy - halfDiag * sinA);
    ctx.lineTo(ox + halfDiag * cosA, oy + halfDiag * sinA);
  }
}

// --- vergelijkingshulpen -------------------------------------------------
// Een segment identificeren we via de oneindige lijn waar het op ligt:
// genormaliseerde richting + loodrechte afstand tot de oorsprong. Zo tellen
// een lange en een ingekorte versie van dezelfde lijn als gelijk.
function lijnSleutel([x1, y1, x2, y2]) {
  let dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  dx /= len; dy /= len;
  if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
  const afstand = -dy * x1 + dx * y1;
  return `${r2(dx)}|${r2(dy)}|${r2(afstand)}`;
}

// Snijdt de oneindige lijn door dit segment het gegeven vak?
function raaktVak([x1, y1, x2, y2], vak) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const nx = -dy / len, ny = dx / len;
  const d0 = nx * x1 + ny * y1;
  let min = Infinity, max = -Infinity;
  for (const X of [vak.left, vak.right]) {
    for (const Y of [vak.top, vak.bottom]) {
      const d = nx * X + ny * Y;
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  return d0 >= min - 1e-6 && d0 <= max + 1e-6;
}

const inVak = ([x, y], vak) =>
  x >= vak.left - 1e-6 && x <= vak.right + 1e-6 && y >= vak.top - 1e-6 && y <= vak.bottom + 1e-6;

// --- de test zelf --------------------------------------------------------
const VLAK = { x: 120, y: 80, width: 260, height: 170 };
const VAK = { left: VLAK.x, top: VLAK.y, right: VLAK.x + VLAK.width, bottom: VLAK.y + VLAK.height };

for (const patroon of BUILTIN_HATCH_PATTERNS) {
  if (!patroon.lineFamilies || patroon.lineFamilies.length === 0) continue;

  for (const hatchScale of [60, 100, 180]) {
    test(`arcering ${patroon.id} @${hatchScale}%: zelfde lijnen en stippen als voorheen`, () => {
      const schaal = hatchScale / 100;

      const nieuw = maakRecorder();
      applyHatchFill(nieuw.ctx, {
        ...VLAK, hatchPattern: patroon.id, hatchColor: '#000000', hatchScale, hatchAngle: 0,
      });

      // Zelfde vlak-uitbreiding als applyHatchFill hanteert (1,5x).
      const cx = VLAK.x + VLAK.width / 2;
      const cy = VLAK.y + VLAK.height / 2;
      const eW = VLAK.width * 1.5, eH = VLAK.height * 1.5;
      const oud = maakRecorder();
      for (const fam of patroon.lineFamilies) {
        oudeFamilie(oud.ctx, fam, cx - eW / 2, cy - eH / 2, cx + eW / 2, cy + eH / 2, schaal);
      }

      const lijnenOud = new Set(oud.ops.lijnen.filter(l => raaktVak(l, VAK)).map(lijnSleutel));
      const lijnenNieuw = new Set(nieuw.ops.lijnen.filter(l => raaktVak(l, VAK)).map(lijnSleutel));
      assert.deepEqual([...lijnenNieuw].sort(), [...lijnenOud].sort(),
        `lijnen binnen het vlak wijken af voor ${patroon.id}`);

      const stippenOud = new Set(oud.ops.stippen.filter(s => inVak(s, VAK)).map(s => s.join('|')));
      const stippenNieuw = new Set(nieuw.ops.stippen.filter(s => inVak(s, VAK)).map(s => s.join('|')));
      assert.deepEqual([...stippenNieuw].sort(), [...stippenOud].sort(),
        `stippen binnen het vlak wijken af voor ${patroon.id}`);
    });
  }
}

test('arcering: buiten beeld gelegen deel wordt niet meer getekend', () => {
  // Met een getTransform die maar een klein venster teruggeeft moet de
  // renderer flink minder werk doen dan zonder.
  const zonder = maakRecorder();
  applyHatchFill(zonder.ctx, {
    x: 0, y: 0, width: 4000, height: 4000,
    hatchPattern: 'crosshatch', hatchColor: '#000', hatchScale: 100, hatchAngle: 0,
  });

  const met = maakRecorder();
  met.ctx.canvas = { width: 200, height: 200 };
  met.ctx.getTransform = () => ({
    a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    invertSelf() { return this; },
  });
  applyHatchFill(met.ctx, {
    x: 0, y: 0, width: 4000, height: 4000,
    hatchPattern: 'crosshatch', hatchColor: '#000', hatchScale: 100, hatchAngle: 0,
  });

  assert.ok(met.ops.lijnen.length * 10 < zonder.ops.lijnen.length,
    `verwachtte een orde-van-grootte minder lijnen, kreeg ${met.ops.lijnen.length} vs ${zonder.ops.lijnen.length}`);
  assert.ok(met.ops.lijnen.length > 0, 'er moet nog wel getekend worden');
});

test('arcering: verzadigd patroon valt terug op één vlakvulling', () => {
  const rec = maakRecorder();
  rec.ctx.canvas = { width: 500, height: 500 };
  // Sterk uitgezoomd: 0,02 apparaatpixel per eenheid.
  rec.ctx.getTransform = () => ({
    a: 0.02, b: 0, c: 0, d: 0.02, e: 0, f: 0,
    invertSelf() { return { a: 50, b: 0, c: 0, d: 50, e: 0, f: 0 }; },
  });
  applyHatchFill(rec.ctx, {
    x: 0, y: 0, width: 3000, height: 3000,
    hatchPattern: 'crosshatch', hatchColor: '#000', hatchScale: 100, hatchAngle: 0,
  });
  assert.equal(rec.ops.lijnen.length, 0, 'geen losse lijnen bij een dichtgelopen patroon');
  assert.ok(rec.ops.vullingen.length > 0, 'wel een vlakvulling');
});
