// Een getekende veelhoek bewerken (#622): een hoekpuntgreep slepen
// verschuift dat hoekpunt, en de RO-draaiing draait de vorm één keer.
//
// applyResize en applyRotateGeneric uit de ECHTE transforms.js, met alleen de
// zware imports gestubd (zelfde opzet als transforms-minimummaat.test.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  veelhoekUitPunten, veelhoekPuntenOpScherm, veelhoekPunten,
} from './veelhoek-punten.js';

const constantsBron = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
const handleTypesLiteral = constantsBron.match(/export const HANDLE_TYPES = (\{[\s\S]*?\n\}) as const;/)[1];

const stubs = `
const HANDLE_TYPES = ${handleTypesLiteral};
const state = { preferences: {}, shiftKeyPressed: false, documents: [], activeDocumentIndex: 0 };
const snapAngle = (a) => a;
const calculateDistance = () => ({ value: 0 }), calculateArea = () => ({ value: 0 }), calculatePerimeter = () => ({ value: 0 });
const formatMeasurement = () => '', formatDimensionText = () => '', snapDistanceTo10 = (v) => v;
const herberekenVlakMaat = () => {}, syncSpotCoord = () => {}, isSpotCoord = () => false;
const handleAnchors = () => ({}), lineEndForDotTarget = () => ({}), resolveParams = () => ({});
const getTemplate = () => null;
const systeemrasterPxPerMm = () => 1, systeemrasterBuildOpts = () => ({});
const SR_PX_PER_MM_1_100 = 1, srSegmentPoint = () => ({ x: 0, y: 0 }), srFlattenContour = () => [];
const copyPointKeepArc = (p) => ({ ...p }), buildSysteemraster = () => null, srUpdateSparing = () => {};
const pxPerMmAt = () => 1;
const syncTwoPointGeometry = () => {}, syncTwoPointLengthParam = () => {}, twoPointEndpoints = () => ({});
`;

const HOUDEN = new Set(['./bezier-contour.js', './minimummaat.js', './polygon-transform.js', './veelhoek-punten.js']);
const bron = readFileSync(new URL('./transforms.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'([^']+)';[ \t]*\r?$/gm, (hele, pad) => (
    HOUDEN.has(pad) ? hele.replace(`'${pad}'`, `'${new URL(pad, import.meta.url).href}'`) : ''));

const { applyResize, applyRotateGeneric } =
  await import('data:text/javascript;base64,' + Buffer.from(stubs + bron, 'utf8').toString('base64'));

const kopie = (o) => JSON.parse(JSON.stringify(o));
const vijfhoek = [
  { x: 100, y: 100 }, { x: 220, y: 90 }, { x: 260, y: 180 }, { x: 170, y: 250 }, { x: 90, y: 190 },
];
const veelhoek = (extra = {}) => ({ id: 'v', type: 'polygon', page: 1, ...veelhoekUitPunten(vijfhoek), ...extra });

function bijna(a, b, tol = 1e-6) { return Math.abs(a - b) <= tol; }

for (const rotation of [0, 35]) {
  test(`een hoekpuntgreep slepen verschuift alleen dat hoekpunt (draaiing ${rotation}°)`, () => {
    const orig = veelhoek({ rotation });
    const ann = kopie(orig);
    const voor = veelhoekPuntenOpScherm(orig);
    applyResize(ann, 'polyline_node_3', 20, -15, orig, false, false, { schaal: 1 });
    const na = veelhoekPuntenOpScherm(ann);
    na.forEach((p, i) => {
      const dx = i === 3 ? 20 : 0, dy = i === 3 ? -15 : 0;
      assert.ok(bijna(p.x, voor[i].x + dx) && bijna(p.y, voor[i].y + dy), `hoekpunt ${i}`);
    });
    assert.equal(ann.rotation, rotation);
    assert.equal(ann.sides, 5);
    // Het vak is de omhullende van de nieuwe punten.
    const xs = ann.points.map((p) => p.x);
    assert.ok(bijna(ann.x, Math.min(...xs)) && bijna(ann.width, Math.max(...xs) - Math.min(...xs)));
  });
}

test('de maatgrepen van een veelhoek zonder punten werken zoals altijd', () => {
  const orig = { id: 'z', type: 'polygon', page: 1, x: 0, y: 0, width: 100, height: 50, sides: 6 };
  const ann = kopie(orig);
  applyResize(ann, 'br', 10, 10, orig, false, false, { schaal: 1 });
  assert.deepEqual([ann.width, ann.height], [110, 60]);
});

test('RO-draaien: de veelhoek draait één keer, om het draaipunt', () => {
  const orig = veelhoek();
  const ann = kopie(orig);
  const draaipunt = { x: 400, y: 300 };
  applyRotateGeneric(ann, orig, draaipunt.x, draaipunt.y, 90);
  assert.equal(ann.rotation, 90);
  // Elk hoekpunt staat op het scherm waar het om het draaipunt gedraaid hoort.
  const voor = veelhoekPuntenOpScherm(orig);
  const na = veelhoekPuntenOpScherm(ann);
  voor.forEach((p, i) => {
    const dx = p.x - draaipunt.x, dy = p.y - draaipunt.y;
    const verwacht = { x: draaipunt.x - dy, y: draaipunt.y + dx };
    assert.ok(bijna(na[i].x, verwacht.x) && bijna(na[i].y, verwacht.y),
      `hoekpunt ${i}: (${na[i].x}, ${na[i].y}) i.p.v. (${verwacht.x}, ${verwacht.y})`);
  });
  // De punten blijven de omhullende van het vak: het scherm rekt niets op.
  const p = veelhoekPunten(ann);
  p.forEach((q, i) => assert.ok(bijna(q.x, ann.points[i].x) && bijna(q.y, ann.points[i].y)));
});
