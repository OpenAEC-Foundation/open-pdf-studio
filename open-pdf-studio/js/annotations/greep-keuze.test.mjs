import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GREEPKADER_PX, spreidMaatgrepen, kiesGreep } from './greep-keuze.js';

const GREEP_PX = 6;
const RAAK_PX = 4;

// Zelfde opbouw als getAnnotationHandles voor een rechthoek.
function grepenVoor(vak, schaal) {
  const hs = GREEP_PX / schaal;
  const { x, y, width: w, height: h } = vak;
  const op = (type, cx, cy, extra = {}) => ({ type, x: cx - hs / 2, y: cy - hs / 2, ...extra });
  return [
    op('tl', x, y), op('tr', x + w, y), op('bl', x, y + h), op('br', x + w, y + h),
    op('t', x + w / 2, y), op('b', x + w / 2, y + h), op('l', x, y + h / 2), op('r', x + w, y + h / 2),
    op('rect_center', x + w / 2, y + h / 2, { isGrip: true, isCenterGrip: true }),
    op('rotate', x + w / 2, y - 25 / schaal),
  ];
}
const midden = (g, schaal) => ({ x: g.x + GREEP_PX / schaal / 2, y: g.y + GREEP_PX / schaal / 2 });
const vind = (grepen, type) => grepen.find(g => g.type === type);

test('een vorm die groot genoeg is op het scherm: de grepen blijven precies op de hoeken', () => {
  const vak = { x: 100, y: 100, width: 200, height: 80 };
  const voor = grepenVoor(vak, 1);
  const na = spreidMaatgrepen(grepenVoor(vak, 1), vak, 1, GREEP_PX);
  assert.deepEqual(na, voor);
});

test('piepkleine vorm (0,05 pt bij 6400 %): de grepen wijken uit tot een kader van vaste schermmaat', () => {
  const schaal = 64;
  const vak = { x: 10, y: 10, width: 0.05, height: 0.05 };
  const na = spreidMaatgrepen(grepenVoor(vak, schaal), vak, schaal, GREEP_PX);
  const cx = 10.025, cy = 10.025;
  // Het kader is op het scherm MIN_GREEPKADER_PX breed en hoog, gecentreerd op de vorm.
  const tl = midden(vind(na, 'tl'), schaal), br = midden(vind(na, 'br'), schaal);
  assert.ok(Math.abs((br.x - tl.x) * schaal - MIN_GREEPKADER_PX) < 1e-6);
  assert.ok(Math.abs((br.y - tl.y) * schaal - MIN_GREEPKADER_PX) < 1e-6);
  assert.ok(Math.abs((tl.x + br.x) / 2 - cx) < 1e-9 && Math.abs((tl.y + br.y) / 2 - cy) < 1e-9);
  // De verplaatsgreep blijft OP de vorm.
  const c = midden(vind(na, 'rect_center'), schaal);
  assert.ok(Math.abs(c.x - cx) < 1e-9 && Math.abs(c.y - cy) < 1e-9);
  // Geen twee grepen dichter dan een halve kaderzijde bij elkaar (in schermpixels).
  const maat = na.filter(g => g.type !== 'rotate');
  for (let i = 0; i < maat.length; i++) {
    for (let j = i + 1; j < maat.length; j++) {
      const a = midden(maat[i], schaal), b = midden(maat[j], schaal);
      const d = Math.hypot(a.x - b.x, a.y - b.y) * schaal;
      assert.ok(d >= MIN_GREEPKADER_PX / 2 - 1e-6, `${maat[i].type}-${maat[j].type}: ${d}px`);
    }
  }
  // De rotatiegreep blijft 25 px boven de bovenste greep en dus bereikbaar.
  const t = midden(vind(na, 't'), schaal), rot = midden(vind(na, 'rotate'), schaal);
  assert.ok(Math.abs((t.y - rot.y) * schaal - 25) < 1e-6);
});

test('breed maar plat: alleen de platte as wijkt uit', () => {
  const vak = { x: 0, y: 0, width: 300, height: 2 };
  const na = spreidMaatgrepen(grepenVoor(vak, 1), vak, 1, GREEP_PX);
  const tl = midden(vind(na, 'tl'), 1), br = midden(vind(na, 'br'), 1);
  assert.equal(tl.x, 0);
  assert.equal(br.x, 300);
  assert.ok(Math.abs((br.y - tl.y) - MIN_GREEPKADER_PX) < 1e-9);
});

test('symbool met alleen links/rechts-grepen: uitwijken werkt ook zonder hoekgrepen', () => {
  const schaal = 10;
  const vak = { x: 5, y: 5, width: 0.4, height: 0.4 };
  const hs = GREEP_PX / schaal;
  const grepen = [
    { type: 'l', x: 5 - hs / 2, y: 5.2 - hs / 2 },
    { type: 'r', x: 5.4 - hs / 2, y: 5.2 - hs / 2 },
  ];
  const na = spreidMaatgrepen(grepen, vak, schaal, GREEP_PX);
  const l = midden(vind(na, 'l'), schaal), r = midden(vind(na, 'r'), schaal);
  assert.ok(Math.abs((r.x - l.x) * schaal - MIN_GREEPKADER_PX) < 1e-6);
  assert.ok(Math.abs(l.y - 5.2) < 1e-9);
});

test('kapotte invoer: geen vak, geen zoom of NaN laat de grepen ongemoeid', () => {
  const vak = { x: 0, y: 0, width: 1, height: 1 };
  const g = grepenVoor(vak, 1);
  assert.deepEqual(spreidMaatgrepen(grepenVoor(vak, 1), null, 1, GREEP_PX), g);
  assert.deepEqual(spreidMaatgrepen(grepenVoor(vak, 1), vak, 0, GREEP_PX), g);
  assert.deepEqual(spreidMaatgrepen(grepenVoor(vak, 1), { x: 0, y: 0, width: NaN, height: 1 }, 1, GREEP_PX), g);
});

test('kiesGreep: de greep waarvan het midden het dichtst bij de cursor ligt wint', () => {
  const schaal = 64;
  const vak = { x: 10, y: 10, width: 0.05, height: 0.05 };
  const grepen = spreidMaatgrepen(grepenVoor(vak, schaal), vak, schaal, GREEP_PX);
  const hs = GREEP_PX / schaal, pad = RAAK_PX / schaal;
  // Op de vorm zelf: verplaatsen, niet schalen.
  assert.equal(kiesGreep(grepen, 10.025, 10.025, hs, pad).type, 'rect_center');
  // Op een uitgeweken hoekgreep: die hoek.
  for (const type of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
    const m = midden(vind(grepen, type), schaal);
    assert.equal(kiesGreep(grepen, m.x, m.y, hs, pad).type, type);
  }
  // Ver weg: geen greep.
  assert.equal(kiesGreep(grepen, 20, 20, hs, pad), null);
});

test('kiesGreep: bij gelijke afstand wint de verplaatsgreep van een maatgreep (verplaatsen vervormt niets)', () => {
  const hs = 6, pad = 4;
  // Alle grepen op exact dezelfde plek, maatgreep staat EERST in de lijst.
  const grepen = [
    { type: 'tl', x: 0, y: 0 },
    { type: 'br', x: 0, y: 0 },
    { type: 'rect_center', x: 0, y: 0, isCenterGrip: true },
  ];
  assert.equal(kiesGreep(grepen, 3, 3, hs, pad).type, 'rect_center');
  // Zonder verplaatsgreep: de eerste in de lijst (vaste, voorspelbare keuze).
  assert.equal(kiesGreep(grepen.slice(0, 2), 3, 3, hs, pad).type, 'tl');
  // De verplaatsgreep van een aanhaal-tekstvak telt ook.
  const co = [{ type: 'tl', x: 0, y: 0 }, { type: 'callout_move', x: 0, y: 0 }];
  assert.equal(kiesGreep(co, 3, 3, hs, pad).type, 'callout_move');
});

test('kiesGreep: een greep met eigen maat (knop) gebruikt zijn eigen raakvlak', () => {
  const grepen = [{ type: 'leader_add', x: 100, y: 100, w: 16, h: 16 }];
  assert.equal(kiesGreep(grepen, 114, 114, 6, 4).type, 'leader_add');
  assert.equal(kiesGreep(grepen, 125, 125, 6, 4), null);
});

test('vorm zonder maatgrepen (vaste-maat-symbool): de rotatiegreep blijft staan', () => {
  const schaal = 10;
  const vak = { x: 0, y: 0, width: 0.2, height: 0.2 };
  const grepen = [{ type: 'rotate', x: 0.1, y: -2.5 }, { type: 'line_mid', x: 0, y: 0, isCenterGrip: true }];
  const na = spreidMaatgrepen(grepen.map(g => ({ ...g })), vak, schaal, GREEP_PX);
  assert.deepEqual(na, grepen);
});
