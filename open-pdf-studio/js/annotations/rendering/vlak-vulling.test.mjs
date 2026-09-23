// Waar komt de vulling van een vlak-annotatie terecht?
//
// De tekenlaag zette de buitenring en alle extra ringen in één pad en vulde
// dat met de even-oneven-regel. Voor een donut klopt dat, maar twee delen die
// elkaar overlappen verloren daardoor precies hun gedeelde stuk: de overlap
// viel uit de vulling (GitHub #457).
//
// Deze test neemt het getekende pad op en rekent zelf uit welk gebied de
// opgegeven vulregel schildert — dus niet "welke regel staat er in de code",
// maar "welke pixel wordt gevuld".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { createElement: () => null };

// De echte tekenlaag laden. Alleen de app-brede state-store wordt gestubd (die
// is TypeScript en trekt SolidJS mee); de overige imports blijven de echte
// bestanden, met een absolute URL zodat de module als data:-URL laadbaar is.
function laad(pad, vervangingen = []) {
  const url = new URL(pad, import.meta.url);
  let bron = readFileSync(url, 'utf8');
  for (const [zoek, tekst] of vervangingen) bron = bron.replace(zoek, tekst);
  bron = bron.replace(/from '(\.[^']*)'/g, (_m, spec) => `from '${new URL(spec, url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(bron, 'utf8').toString('base64'));
}

const { drawMeasureAreaShape } = await laad('./measurements.js', [
  // De arcering heeft een eigen test hieronder; hier alleen de vulling.
  [/^import \{ applyHatchFillPolygon \}.*$/m, 'const applyHatchFillPolygon = () => {};'],
]);
const { applyHatchFillPolygon } = await laad('./hatch-patterns.js', [
  [/^import \{ state \}.*$/m, 'const state = { preferences: {}, documents: [], activeDocumentIndex: 0 };'],
]);

// ── opnemende 2D-context ────────────────────────────────────────────────────
function maakRecorder() {
  const ops = { vullingen: [], knippen: [] };
  let paden = [];
  let huidig = null;
  const ctx = {
    canvas: { width: 0, height: 0 },
    save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {},
    stroke() {}, fillRect() {}, fillText() {}, arc() {}, measureText: () => ({ width: 0 }),
    beginPath() { paden = []; huidig = null; },
    moveTo(x, y) { huidig = [{ x, y }]; paden.push(huidig); },
    lineTo(x, y) { if (huidig) huidig.push({ x, y }); },
    quadraticCurveTo(cx, cy, x, y) { if (huidig) huidig.push({ x, y }); },
    closePath() {},
    fill(regel) { ops.vullingen.push({ paden: paden.map(p => p.slice()), regel: regel || 'nonzero' }); },
    clip(regel) { ops.knippen.push({ paden: paden.map(p => p.slice()), regel: regel || 'nonzero' }); },
  };
  return { ctx, ops };
}

// Wordt (x,y) door deze vulling geschilderd? Straal naar rechts; per snijpunt
// telt de richting mee (niet-nul) of alleen de pariteit (even-oneven).
function geschilderd({ paden, regel }, x, y) {
  let wikkel = 0;
  let pariteit = false;
  for (const pad of paden) {
    for (let i = 0, j = pad.length - 1; i < pad.length; j = i++) {
      const a = pad[j], b = pad[i];
      if ((a.y > y) !== (b.y > y)) {
        const snij = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (snij > x) {
          pariteit = !pariteit;
          wikkel += b.y > a.y ? 1 : -1;
        }
      }
    }
  }
  return regel === 'evenodd' ? pariteit : wikkel !== 0;
}

const rechthoek = (x, y, b, h) => [
  { x, y }, { x: x + b, y }, { x: x + b, y: y + h }, { x, y: y + h },
];
const GROOT = rechthoek(0, 0, 100, 100);

function vulling(points, holes) {
  const { ctx, ops } = maakRecorder();
  drawMeasureAreaShape(ctx, points, '#ff0000', 1, '#00ff00', 'solid', holes);
  assert.equal(ops.vullingen.length, 1, 'precies één vulling verwacht');
  return ops.vullingen[0];
}

// ── de vulling op het scherm ────────────────────────────────────────────────

test('een gat blijft een gat', () => {
  const v = vulling(GROOT, [rechthoek(20, 20, 40, 40)]);
  assert.equal(geschilderd(v, 10, 10), true, 'de ring om het gat is gevuld');
  assert.equal(geschilderd(v, 40, 40), false, 'het gat is leeg');
});

test('twee delen naast elkaar zijn allebei gevuld', () => {
  const v = vulling(GROOT, [rechthoek(150, 0, 100, 100)]);
  assert.equal(geschilderd(v, 50, 50), true);
  assert.equal(geschilderd(v, 200, 50), true);
  assert.equal(geschilderd(v, 125, 50), false, 'de ruimte ertussen blijft leeg');
});

test('twee delen die elkaar overlappen blijven overal gevuld', () => {
  const v = vulling(GROOT, [rechthoek(80, 80, 100, 100)]);
  assert.equal(geschilderd(v, 50, 50), true);
  assert.equal(geschilderd(v, 90, 90), true, 'de overlap hoort gevuld te blijven');
  assert.equal(geschilderd(v, 150, 150), true);
});

test('een gat in een tweede deel blijft leeg', () => {
  const v = vulling(GROOT, [rechthoek(150, 0, 100, 100), rechthoek(170, 20, 40, 40)]);
  assert.equal(geschilderd(v, 200, 90), true, 'het tweede deel is gevuld');
  assert.equal(geschilderd(v, 190, 40), false, 'het gat in dat deel is leeg');
});

// ── de arcering volgt dezelfde vorm ─────────────────────────────────────────

function arceringKnip(points, holes) {
  const { ctx, ops } = maakRecorder();
  applyHatchFillPolygon(ctx, points, holes, 'diagonal-left', '#ff0000', 100, 0);
  assert.ok(ops.knippen.length >= 1, 'de arcering knipt op de vorm');
  return ops.knippen[0];
}

test('de arcering knipt op dezelfde vorm als de vulling', () => {
  const gat = arceringKnip(GROOT, [rechthoek(20, 20, 40, 40)]);
  assert.equal(geschilderd(gat, 10, 10), true);
  assert.equal(geschilderd(gat, 40, 40), false);

  const overlap = arceringKnip(GROOT, [rechthoek(80, 80, 100, 100)]);
  assert.equal(geschilderd(overlap, 90, 90), true, 'ook hier blijft de overlap meedoen');
  assert.equal(geschilderd(overlap, 150, 150), true);
});

test('de arcering reikt tot voorbij het tweede deel', () => {
  // Het arceringsvlak werd op de buitenring begrensd; een deel dat daarbuiten
  // ligt kreeg dan geen lijnen.
  const { ctx, ops } = maakRecorder();
  applyHatchFillPolygon(ctx, GROOT, [rechthoek(400, 400, 100, 100)], 'diagonal-left', '#ff0000', 100, 0);
  const knip = ops.knippen[0];
  let maxX = -Infinity, maxY = -Infinity;
  for (const pad of knip.paden) for (const p of pad) { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  assert.ok(maxX >= 500 && maxY >= 500, 'het tweede deel zit in het knippad');
});

test('te weinig punten: niets tekenen, en niet het vorige pad nog eens vullen', () => {
  const { ctx, ops } = maakRecorder();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(50, 0); ctx.lineTo(50, 50);
  drawMeasureAreaShape(ctx, [{ x: 0, y: 0 }, { x: 10, y: 0 }], '#ff0000', 1, '#00ff00', 'solid');
  assert.equal(ops.vullingen.length, 0);
});
