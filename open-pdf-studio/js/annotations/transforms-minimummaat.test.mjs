// applyResize uit de ECHTE transforms.js, met alleen de zware imports
// (state, registry, meet- en rastermodules) gestubd. Bewaakt dat elke
// rechthoek-tak via de gedeelde regel uit minimummaat.js loopt: geen vaste
// ondergrens in paginapunten meer, geen weglopende vorm, geen NaN.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_VORM_MAAT_PT, MIN_GEBIED_PX } from './minimummaat.js';

const constantsBron = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
const handleTypesLiteral = constantsBron.match(/export const HANDLE_TYPES = (\{[\s\S]*?\n\}) as const;/)[1];

const stubs = `
const HANDLE_TYPES = ${handleTypesLiteral};
const state = { preferences: {}, shiftKeyPressed: false };
const snapAngle = (a) => a;
const calculateDistance = () => ({ value: 0 }), calculateArea = () => ({ value: 0 }), calculatePerimeter = () => ({ value: 0 });
const formatMeasurement = () => '', formatDimensionText = () => '', snapDistanceTo10 = (v) => v;
const handleAnchors = () => ({}), lineEndForDotTarget = () => ({}), resolveParams = () => ({});
const getTemplate = () => null;
const systeemrasterPxPerMm = () => 1, systeemrasterBuildOpts = () => ({});
const SR_PX_PER_MM_1_100 = 1, srSegmentPoint = () => ({ x: 0, y: 0 }), srFlattenContour = () => [];
const copyPointKeepArc = (p) => ({ ...p }), buildSysteemraster = () => null, srUpdateSparing = () => {};
const pxPerMmAt = () => 1;
const syncTwoPointGeometry = () => {}, syncTwoPointLengthParam = () => {}, twoPointEndpoints = () => ({});
`;

const bron = readFileSync(new URL('./transforms.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'([^']+)';[ \t]*\r?$/gm, (hele, pad) => {
    if (pad === './minimummaat.js' || pad === './polygon-transform.js') {
      return hele.replace(`'${pad}'`, `'${new URL(pad, import.meta.url).href}'`);
    }
    return '';
  });

const { applyResize } =
  await import('data:text/javascript;base64,' + Buffer.from(stubs + bron, 'utf8').toString('base64'));

const GREPEN = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function sleep(ann, greep, dx, dy, shift = false, opties = {}) {
  const orig = JSON.parse(JSON.stringify(ann));
  const doel = JSON.parse(JSON.stringify(ann));
  applyResize(doel, greep, dx, dy, orig, shift, false, opties);
  return doel;
}

const RECHTHOEK_TYPES = ['box', 'mask', 'circle', 'highlight', 'polygon', 'cloud'];
const BEELD_TYPES = ['image', 'stamp', 'signature', 'scheduleTable', 'parametricSymbol'];

test('rechthoek, ellips, wolk, maskeer- en markeringsvlak: kleiner dan 10 pt kan', () => {
  for (const type of RECHTHOEK_TYPES) {
    const r = sleep({ type, x: 100, y: 100, width: 50, height: 50 }, 'br', -49.8, -49.9);
    assert.ok(near(r.width, 0.2), `${type} breedte ${r.width}`);
    assert.ok(near(r.height, 0.1), `${type} hoogte ${r.height}`);
    assert.equal(r.x, 100);
    assert.equal(r.y, 100);
  }
});

test('afbeelding, stempel, handtekening, staat en symbool: kleiner dan 20 pt kan (de gemelde 709 mm)', () => {
  for (const type of BEELD_TYPES) {
    const r = sleep({ type, x: 0, y: 0, width: 100, height: 60 }, 'br', -99, -59.5);
    assert.ok(near(r.width, 1), `${type} breedte ${r.width}`);
    assert.ok(near(r.height, 0.5), `${type} hoogte ${r.height}`);
  }
});

test('alle vormtypen en alle grepen: voorbij het vaste punt slepen geeft nooit nul, negatief of NaN en de overkant blijft staan', () => {
  for (const type of [...RECHTHOEK_TYPES, ...BEELD_TYPES, 'textbox', 'callout', 'viewport', 'scaleRegion', 'scaleBar']) {
    for (const rotation of [0, 30]) {
      for (const g of GREPEN) {
        const ann = { type, x: 100, y: 200, width: 60, height: 40, rotation, fontSize: 8 };
        const links = g.includes('l'), boven = g.includes('t');
        const r = sleep(ann, g, links ? 900 : -900, boven ? 900 : -900, false, { schaal: 2 });
        for (const k of ['x', 'y', 'width', 'height']) {
          assert.ok(Number.isFinite(r[k]), `${type} ${g} ${rotation} ${k}=${r[k]}`);
        }
        assert.ok(r.width >= MIN_VORM_MAAT_PT && r.height >= MIN_VORM_MAAT_PT, `${type} ${g}`);
        if (rotation === 0) {
          // Ongedraaid: de rand tegenover de greep blijft exact staan.
          if (links) assert.ok(near(r.x + r.width, 160), `${type} ${g} rechterrand`);
          else if (g.includes('r')) assert.equal(r.x, 100, `${type} ${g} linkerrand`);
          if (boven) assert.ok(near(r.y + r.height, 240), `${type} ${g} onderrand`);
          else if (g.includes('b')) assert.equal(r.y, 200, `${type} ${g} bovenrand`);
        }
      }
    }
  }
});

test('een ingetypte kleine maat springt niet omhoog zodra een andere greep wordt aangeraakt', () => {
  const r = sleep({ type: 'box', x: 0, y: 0, width: 2.83, height: 80 }, 'b', 0, -5);
  assert.equal(r.width, 2.83);
  assert.ok(near(r.height, 75));
});

test('vaste verhouding (Shift of lockAspectRatio): verhouding blijft, ook bij hoogte 0 geen NaN', () => {
  const breed = sleep({ type: 'image', x: 0, y: 0, width: 188, height: 24, lockAspectRatio: true }, 'br', -187, 0);
  assert.ok(near(breed.width / breed.height, 188 / 24));
  assert.ok(near(breed.width, 1));
  const plat = sleep({ type: 'image', x: 0, y: 0, width: 100, height: 0 }, 'br', -10, 5, true);
  assert.ok(Number.isFinite(plat.width) && Number.isFinite(plat.height));
  assert.ok(plat.height >= MIN_VORM_MAAT_PT);
});

test('plugin-vorm met w/h: kleiner dan 10 pt kan, en er komt geen width/height bij', () => {
  const r = sleep({ type: 'plugin.rect', x: 10, y: 10, w: 40, h: 40 }, 'tl', 39.5, 39.5);
  assert.ok(near(r.w, 0.5) && near(r.h, 0.5));
  assert.ok(near(r.x, 49.5) && near(r.y, 49.5));
  assert.equal('width' in r, false);
  assert.equal('height' in r, false);
});

test('tekstvak en aanhaal-tekstvak: de ondergrens volgt de lettergrootte', () => {
  const groot = sleep({ type: 'textbox', x: 0, y: 0, width: 100, height: 40, fontSize: 12 }, 'br', -500, -500);
  assert.ok(near(groot.width, 12) && near(groot.height, 14.4));
  const klein = sleep({ type: 'textbox', x: 0, y: 0, width: 100, height: 40, fontSize: 1 }, 'br', -500, -500);
  assert.ok(near(klein.width, 1) && near(klein.height, 1.2));
  const co = sleep({ type: 'callout', x: 0, y: 0, width: 150, height: 50, fontSize: 2, arrowX: -60, arrowY: 50 }, 'br', -500, -500);
  assert.ok(near(co.width, 2) && near(co.height, 2.4));
  assert.ok(Number.isFinite(co.kneeX) && Number.isFinite(co.armOriginX));
});

test('schaalgebied, viewport en schaalbalk: ondergrens in schermpixels, dus inzoomen laat kleiner toe', () => {
  for (const type of ['viewport', 'scaleRegion']) {
    const ver = sleep({ type, x: 0, y: 0, width: 200, height: 200 }, 'br', -500, -500, false, { schaal: 1 });
    assert.equal(ver.width, MIN_GEBIED_PX);
    assert.equal(ver.height, MIN_GEBIED_PX);
    const dichtbij = sleep({ type, x: 0, y: 0, width: 200, height: 200 }, 'br', -500, -500, false, { schaal: 64 });
    assert.equal(dichtbij.width, MIN_GEBIED_PX / 64);
    // Al kleiner (ingetypt): blijft staan, springt niet naar de grens.
    const getypt = sleep({ type, x: 0, y: 0, width: 5, height: 5 }, 'r', 1, 0, false, { schaal: 1 });
    assert.ok(near(getypt.width, 6));
    assert.equal(getypt.height, 5);
  }
  const balk = sleep({ type: 'scaleBar', x: 0, y: 0, width: 200, height: 20 }, 'r', -500, 0, false, { schaal: 4 });
  assert.equal(balk.width, MIN_GEBIED_PX / 4);
  assert.equal(balk.height, 20);
});

test('vrije hand: een omhullende van exact 0 springt niet naar 1 pt en geeft geen NaN', () => {
  const ann = { type: 'draw', path: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
  const r = sleep(ann, 'br', -10, -10);
  for (const p of r.path) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const b = Math.max(...r.path.map(p => p.x)) - Math.min(...r.path.map(p => p.x));
  assert.ok(b <= MIN_VORM_MAAT_PT + 1e-9, `breedte ${b}`);
});

test('vergrendelde vorm verandert niet', () => {
  const r = sleep({ type: 'box', x: 0, y: 0, width: 50, height: 50, locked: true }, 'br', -40, -40);
  assert.equal(r.width, 50);
});
