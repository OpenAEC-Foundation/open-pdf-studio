// Meetkunde van proefleescorrecties (#508): hoeken van een quad ten opzichte
// van de tekst, de doorhaallijn en het invoegteken.
//
// Paginaruimte van de app: punten, oorsprong linksboven, y omlaag. textDir is
// de leesrichting met de klok mee (0 = gewone tekst van links naar rechts).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEXT_ASCENT, TEXT_DESCENT, upVector, quadCorners, quadMidline,
  caretGlyphBox, caretGlyphPoints, textDirFromVector, rotateTextDir,
} from './geometry.js';

const RECT = { x: 72, y: 90.4, width: 18, height: 12 };
const dichtbij = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const zelfdePunt = (p, q, msg) => { dichtbij(p.x, q.x, `${msg} x`); dichtbij(p.y, q.y, `${msg} y`); };

test('tekstbox per regel: 0,8 boven en 0,2 onder de basislijn', () => {
  assert.equal(TEXT_ASCENT, 0.8);
  assert.equal(TEXT_DESCENT, 0.2);
});

test('de bovenkant van de tekst wijst per leesrichting een kwartslag verder', () => {
  zelfdePunt(upVector(0), { x: 0, y: -1 }, '0');
  zelfdePunt(upVector(90), { x: 1, y: 0 }, '90');
  zelfdePunt(upVector(180), { x: 0, y: 1 }, '180');
  zelfdePunt(upVector(270), { x: -1, y: 0 }, '270');
});

test('quadCorners: begin-boven, eind-boven, begin-onder, eind-onder per leesrichting', () => {
  const { x, y, width: w, height: h } = RECT;
  const verwacht = {
    0: [[x, y], [x + w, y], [x, y + h], [x + w, y + h]],
    90: [[x + w, y], [x + w, y + h], [x, y], [x, y + h]],
    180: [[x + w, y + h], [x, y + h], [x + w, y], [x, y]],
    270: [[x, y + h], [x, y], [x + w, y + h], [x + w, y]],
  };
  for (const [dir, hoeken] of Object.entries(verwacht)) {
    const q = quadCorners(RECT, Number(dir));
    assert.equal(q.length, 4);
    hoeken.forEach(([px, py], i) => zelfdePunt(q[i], { x: px, y: py }, `textDir ${dir} hoek ${i + 1}`));
  }
});

test('quadCorners zonder richting is de gewone horizontale volgorde', () => {
  const q = quadCorners(RECT, undefined);
  zelfdePunt(q[0], { x: 72, y: 90.4 }, 'p1');
  zelfdePunt(q[3], { x: 90, y: 102.4 }, 'p4');
});

test('textDirFromVector(eind-boven min begin-boven) geeft de leesrichting terug', () => {
  for (const dir of [0, 90, 180, 270]) {
    const [p1, p2] = quadCorners(RECT, dir);
    assert.equal(textDirFromVector(p2.x - p1.x, p2.y - p1.y), dir, `textDir ${dir}`);
  }
});

test('quadMidline loopt evenwijdig aan de tekst, midden tussen boven en onder', () => {
  for (const dir of [0, 90, 180, 270]) {
    const q = quadCorners(RECT, dir);
    const [a, b] = quadMidline(q);
    assert.equal(textDirFromVector(b.x - a.x, b.y - a.y), dir, `richting ${dir}`);
    zelfdePunt(a, { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 }, `begin ${dir}`);
    zelfdePunt(b, { x: (q[1].x + q[3].x) / 2, y: (q[1].y + q[3].y) / 2 }, `eind ${dir}`);
  }
});

test('caretGlyphBox: zijde 0,5 h tussen 3 en 16, top 0,1 h boven het invoegpunt', () => {
  const box = caretGlyphBox({ x: 90, y: 100 }, 12, 0);
  zelfdePunt(box, { x: 87, y: 98.8 }, 'linksboven');
  dichtbij(box.width, 6, 'breedte');
  dichtbij(box.height, 6, 'hoogte');
  assert.equal(caretGlyphBox({ x: 0, y: 0 }, 2, 0).width, 3, 'ondergrens');
  assert.equal(caretGlyphBox({ x: 0, y: 0 }, 100, 0).width, 16, 'bovengrens');
});

test('caretGlyphPoints: de top ligt aan de bovenkant van de tekst, alle punten in het vak', () => {
  const P = { x: 200, y: 300 };
  for (const dir of [0, 90, 180, 270]) {
    const box = caretGlyphBox(P, 12, dir);
    const [top, eindVoet, inkeping, beginVoet] = caretGlyphPoints(box, dir);
    const up = upVector(dir);
    const midden = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hoogteBoven = (p) => (p.x - midden.x) * up.x + (p.y - midden.y) * up.y;
    dichtbij(hoogteBoven(top), box.width / 2, `top aan de bovenkant (${dir})`);
    dichtbij(hoogteBoven(beginVoet), -box.width / 2, `voet aan de onderkant (${dir})`);
    dichtbij(hoogteBoven(inkeping), -box.width / 4, `inkeping op een kwart (${dir})`);
    // De top ligt 0,1 h boven het invoegpunt, recht erboven.
    zelfdePunt(top, { x: P.x + up.x * 1.2, y: P.y + up.y * 1.2 }, `top (${dir})`);
    // Eind-voet ligt in de leesrichting voorbij de begin-voet.
    const [d1, d2] = [beginVoet, eindVoet];
    assert.equal(textDirFromVector(d2.x - d1.x, d2.y - d1.y), dir, `voeten (${dir})`);
    for (const p of [top, eindVoet, inkeping, beginVoet]) {
      assert.ok(p.x >= box.x - 1e-9 && p.x <= box.x + box.width + 1e-9, `x binnen het vak (${dir})`);
      assert.ok(p.y >= box.y - 1e-9 && p.y <= box.y + box.height + 1e-9, `y binnen het vak (${dir})`);
    }
  }
});

test('rotateTextDir draait rond en blijft binnen 0..270', () => {
  assert.equal(rotateTextDir(270, 90), 0);
  assert.equal(rotateTextDir(0, -90), 270);
  assert.equal(rotateTextDir(90, 180), 270);
  assert.equal(rotateTextDir(undefined, 90), 90);
});

test('een hoek die meer dan 1 graad van een kwartslag afwijkt geeft null', () => {
  const graden = (g) => [Math.cos(g * Math.PI / 180), Math.sin(g * Math.PI / 180)];
  assert.equal(textDirFromVector(...graden(0.9)), 0);
  assert.equal(textDirFromVector(...graden(89.2)), 90);
  assert.equal(textDirFromVector(...graden(1.5)), null);
  assert.equal(textDirFromVector(...graden(45)), null);
  assert.equal(textDirFromVector(...graden(-92)), null);
  assert.equal(textDirFromVector(0, 0), null);
});
