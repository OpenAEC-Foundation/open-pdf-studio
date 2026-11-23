// Panning with the right mouse button is a choice, off by default (#1241).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { rechterknopKeuze, magRechtsPannen, isSleep, maakRechtermuisHandlers, SLEEP_DREMPEL_PX } from './rechtermuis-pan-beleid.js';
import { geenPanKnopMeer } from './pan-vangnet.js';

const doel = { closest: (sel) => (sel === '#pdf-container' ? {} : null) };
const buiten = { closest: () => null };

function opstelling(keuze, { panning = false } = {}) {
  const log = [];
  const h = maakRechtermuisHandlers({
    keuze: () => keuze,
    heeftDocument: () => true,
    isPanning: () => panning,
    startPan: (e) => log.push(['pan', e.clientX, e.clientY]),
    slikMenu: () => log.push(['slik']),
    sluitMenu: () => log.push(['sluit']),
  });
  return { h, log };
}
const druk = (x, y, extra = {}) => ({ button: 2, clientX: x, clientY: y, pointerId: 7, target: doel, ...extra });
const beweeg = (x, y, buttons = 2) => ({ button: -1, buttons, clientX: x, clientY: y, target: doel });

test('the preference is menu unless it says pan', () => {
  assert.equal(rechterknopKeuze(undefined), 'menu');
  assert.equal(rechterknopKeuze('iets'), 'menu');
  assert.equal(rechterknopKeuze('pan'), 'pan');
});

test('by default the right button never pans', () => {
  const { h, log } = opstelling(undefined);
  h.onPointerDown(druk(100, 100));
  h.onPointerMove(beweeg(200, 200));
  assert.deepEqual(log, []);
  assert.equal(magRechtsPannen({ keuze: 'menu', button: 2, binnenWeergave: true }), false);
});

test('with the choice on, dragging pans from the place of the press and swallows the menu', () => {
  const { h, log } = opstelling('pan');
  h.onPointerDown(druk(100, 100));
  h.onPointerMove(beweeg(102, 101));
  assert.deepEqual(log, [], 'below the threshold nothing happens');
  h.onPointerMove(beweeg(120, 100));
  assert.deepEqual(log, [['sluit'], ['slik'], ['pan', 100, 100]]);
  h.onPointerMove(beweeg(160, 100));
  assert.equal(log.length, 3, 'the pan starts once');
});

test('a click without a drag keeps its meaning: nothing is swallowed', () => {
  const { h, log } = opstelling('pan');
  h.onPointerDown(druk(100, 100));
  h.onPointerUp({ button: 2 });
  h.onPointerMove(beweeg(300, 300));
  assert.deepEqual(log, []);
});

test('Shift + right, another button, outside the view or during a pan stay as they are', () => {
  const basis = { keuze: 'pan', button: 2, binnenWeergave: true };
  assert.equal(magRechtsPannen(basis), true);
  assert.equal(magRechtsPannen({ ...basis, shiftKey: true }), false, 'Shift + right places the 2D cursor');
  assert.equal(magRechtsPannen({ ...basis, button: 0 }), false);
  assert.equal(magRechtsPannen({ ...basis, binnenWeergave: false }), false);
  assert.equal(magRechtsPannen({ ...basis, inVergelijking: true }), false);
  assert.equal(magRechtsPannen({ ...basis, alPannen: true }), false);
  const { h, log } = opstelling('pan');
  h.onPointerDown(druk(100, 100, { target: buiten }));
  h.onPointerMove(beweeg(200, 200));
  assert.deepEqual(log, []);
});

test('a missed release does not start a pan later', () => {
  const { h, log } = opstelling('pan');
  h.onPointerDown(druk(100, 100));
  h.onPointerMove(beweeg(200, 200, 0));
  h.onPointerMove(beweeg(260, 260, 2));
  assert.deepEqual(log, []);
});

test('the drag threshold', () => {
  assert.equal(isSleep({ x: 0, y: 0 }, SLEEP_DREMPEL_PX - 1, 0), false);
  assert.equal(isSleep({ x: 0, y: 0 }, SLEEP_DREMPEL_PX, 0), true);
  assert.equal(isSleep(null, 50, 50), false);
});

test('the safety net lets a right-button pan run, and only then', () => {
  assert.equal(geenPanKnopMeer({ buttons: 2 }), true, 'as before: right alone is no pan button');
  assert.equal(geenPanKnopMeer({ buttons: 2 }, { rechts: true }), false);
  assert.equal(geenPanKnopMeer({ buttons: 0 }, { rechts: true }), true);
});

test('the preference exists, defaults to the menu and is in the Behavior tab', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('../core/constants.ts'), /rightButtonDrag: 'menu',/);
  assert.match(lees('../types/preferences.ts'), /rightButtonDrag: 'menu' \| 'pan';/);
  assert.match(lees('../solid/components/preferences/BehaviorTab.jsx'), /pref-right-button-drag/);
  assert.match(lees('../ui/setup.js'), /installeerRechtermuisPan\(\)/);
});
