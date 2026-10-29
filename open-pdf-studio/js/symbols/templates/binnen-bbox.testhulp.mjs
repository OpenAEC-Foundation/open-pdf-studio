// Testhulp: controleert dat alle draw-commands van een parametrisch symbool
// binnen de bbox vallen (de PDF-appearance is precies de annotatie-rect, wat
// erbuiten valt verdwijnt in andere PDF-lezers) en eindige getallen hebben.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import assert from 'node:assert/strict';

export function puntenVan(c) {
  const p = [];
  if (c.kind === 'line') p.push([c.x1, c.y1], [c.x2, c.y2]);
  if (c.kind === 'circle') p.push([c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]);
  if (c.kind === 'text') p.push([c.x, c.y]);
  for (const q of c.points || []) p.push([q.x, q.y]);
  for (const loop of c.loops || []) for (const q of loop) p.push([q.x, q.y]);
  return p;
}

export function assertBinnenBbox(cmds, bbox, naam = 'symbool') {
  assert.ok(Array.isArray(cmds) && cmds.length > 0, `${naam}: geen tekenopdrachten`);
  const tol = 0.5;
  for (const c of cmds) {
    for (const [x, y] of puntenVan(c)) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${naam}: ${c.kind}/${c.role} heeft geen eindig punt`);
      assert.ok(x >= bbox.x - tol && x <= bbox.x + bbox.width + tol, `${naam}: ${c.kind}/${c.role} x=${x} buiten de bbox`);
      assert.ok(y >= bbox.y - tol && y <= bbox.y + bbox.height + tol, `${naam}: ${c.kind}/${c.role} y=${y} buiten de bbox`);
    }
  }
}

/** Tekst van alle text-commands achter elkaar (diametertekens als 'Ø'). */
export function teksten(cmds) {
  return cmds.filter((c) => c.kind === 'text').map((c) => c.text);
}
