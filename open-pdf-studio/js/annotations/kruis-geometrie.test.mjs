import assert from 'node:assert/strict';
import test from 'node:test';

import { kruisEindpuntenEllips, ondersteuntKruis, kruisZichtbaarVoorSelectie } from './kruis-geometrie.js';

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const opOmtrek = (p, cx, cy, rx, ry) => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2;

test('cirkel: eindpunten onder 45° op r/√2 van het middelpunt', () => {
  const [a, b] = kruisEindpuntenEllips(50, 40, 10, 10);
  const d = 10 / Math.SQRT2;
  bijna(a.x1, 50 - d, 'a.x1'); bijna(a.y1, 40 - d, 'a.y1');
  bijna(a.x2, 50 + d, 'a.x2'); bijna(a.y2, 40 + d, 'a.y2');
  bijna(b.x1, 50 + d, 'b.x1'); bijna(b.y1, 40 - d, 'b.y1');
  bijna(b.x2, 50 - d, 'b.x2'); bijna(b.y2, 40 + d, 'b.y2');
});

test('ellips: alle vier eindpunten liggen op de omtrek', () => {
  const cx = 100, cy = 60, rx = 80, ry = 20;
  for (const l of kruisEindpuntenEllips(cx, cy, rx, ry)) {
    bijna(opOmtrek({ x: l.x1, y: l.y1 }, cx, cy, rx, ry), 1, 'begin op omtrek');
    bijna(opOmtrek({ x: l.x2, y: l.y2 }, cx, cy, rx, ry), 1, 'eind op omtrek');
  }
});

test('ellips: lijnen staan onder ±45° en gaan door het middelpunt', () => {
  const cx = 0, cy = 0;
  const [a, b] = kruisEindpuntenEllips(cx, cy, 80, 20);
  bijna((a.y2 - a.y1) / (a.x2 - a.x1), 1, 'helling a');
  bijna((b.y2 - b.y1) / (b.x2 - b.x1), -1, 'helling b');
  bijna((a.x1 + a.x2) / 2, cx, 'midden a x'); bijna((a.y1 + a.y2) / 2, cy, 'midden a y');
  bijna((b.x1 + b.x2) / 2, cx, 'midden b x'); bijna((b.y1 + b.y2) / 2, cy, 'midden b y');
  // afstand d = rx·ry/√(rx²+ry²)
  bijna(a.x2, 80 * 20 / Math.hypot(80, 20), 'd');
});

test('negatieve of nul-stralen: absolute waarden, nul geeft een punt in het midden', () => {
  const [a] = kruisEindpuntenEllips(5, 5, -10, -10);
  bijna(a.x2, 5 + 10 / Math.SQRT2, 'abs');
  const [z] = kruisEindpuntenEllips(5, 5, 0, 10);
  assert.deepEqual(z, { x1: 5, y1: 5, x2: 5, y2: 5 });
});

test('Kruis-eigenschap bestaat voor rechthoek en cirkel/ellips, niet voor andere typen', () => {
  assert.equal(ondersteuntKruis('box'), true);
  assert.equal(ondersteuntKruis('circle'), true);
  for (const t of ['polygon', 'cloud', 'mask', 'redaction', 'line', 'textbox', undefined]) {
    assert.equal(ondersteuntKruis(t), false, String(t));
  }
});

test('gemengde selectie: vinkje alleen als elk geselecteerd type een kruis kent', () => {
  assert.equal(kruisZichtbaarVoorSelectie([{ type: 'box' }, { type: 'circle' }]), true);
  assert.equal(kruisZichtbaarVoorSelectie([{ type: 'circle' }, { type: 'circle' }]), true);
  assert.equal(kruisZichtbaarVoorSelectie([{ type: 'box' }, { type: 'polygon' }]), false);
  assert.equal(kruisZichtbaarVoorSelectie([]), false);
});
