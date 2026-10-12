import assert from 'node:assert/strict';
import test from 'node:test';

import { filletGeometry, chamferGeometry } from './corner-geometry.js';

const dichtbij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ok = (v, msg) => assert.ok(v, msg);

const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// Klassieke L-hoek: bodemlijn van (-100,0) naar (0,0) en staande lijn van
// (0,0) naar (0,100); snijpunt I = (0,0), hoek 90°.
const bodem = { x1: -100, y1: 0, x2: 0, y2: 0 };
const staand = { x1: 0, y1: 0, x2: 0, y2: 100 };

test('fillet 90°: raakpunten op R van het hoekpunt, verre uiteinden blijven', () => {
  const r = filletGeometry(bodem, staand, 10);
  ok(!r.error, 'geen fout verwacht');
  // Raakpunt lijn1 = (-10,0): het SNIJNDE uiteinde (0,0) wordt vervangen.
  assert.ok(dichtbij(r.lijn1.x2, -10), `x2 = ${r.lijn1.x2}`);
  assert.equal(r.lijn1.x1, -100); // verre uiteinde onaangeroerd
  assert.ok(dichtbij(r.lijn1.y2, 0));
  // Raakpunt lijn2 = (0,10)
  assert.ok(dichtbij(r.lijn2.y1, 10), `y1 = ${r.lijn2.y1}`);
  assert.equal(r.lijn2.y2, 100);
});

test('fillet 90°: boog heeft midden op de bissectrice en de juiste sweep', () => {
  const r = filletGeometry(bodem, staand, 10);
  ok(r.arc, 'arc verwacht');
  // Middelpunt (-10,10), straal 10
  assert.ok(dichtbij(r.arc.centerX, -10), `cx = ${r.arc.centerX}`);
  assert.ok(dichtbij(r.arc.centerY, 10), `cy = ${r.arc.centerY}`);
  assert.ok(dichtbij(r.arc.radius, 10));
  // Raakhoeken: T1 (-10,0) vanuit (-10,10) = -90°, T2 (0,10) = 0°
  assert.ok(dichtbij(r.arc.startAngle, -Math.PI / 2), `start = ${r.arc.startAngle}`);
  assert.ok(dichtbij(r.arc.endAngle, 0), `end = ${r.arc.endAngle}`);
  // Het boogmiddelpunt (bulkt richting de hoek) moet in de sweep vallen:
  // M = O - R*bis.
  const bis = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const M = { x: r.arc.centerX - 10 * bis.x, y: r.arc.centerY - 10 * bis.y };
  const am = Math.atan2(M.y - r.arc.centerY, M.x - r.arc.centerX);
  ok(norm(am - r.arc.startAngle) <= norm(r.arc.endAngle - r.arc.startAngle),
    'boogmiddelpunt moet tussen start en end liggen');
});

test('fillet radius 0 = scherpe hoek: trimmen naar snijpunt, geen boog', () => {
  const r = filletGeometry(bodem, staand, 0);
  ok(!r.error);
  assert.equal(r.arc, null);
  assert.ok(dichtbij(r.lijn1.x2, 0), `x2 = ${r.lijn1.x2}`);
  assert.ok(dichtbij(r.lijn2.y1, 0), `y1 = ${r.lijn2.y1}`);
});

test('fillet hoek van 45° (schuin): d = R/tan(θ/2)', () => {
  // Schuine lijn van (-70.7,-70.7) naar (0,0): ray2 richting (-0.707,-0.707),
  // ray1 richting (-1,0) → θ = 45°, d = 10/tan(22.5°) ≈ 24.142.
  const schuin = { x1: -70.710678, y1: -70.710678, x2: 0, y2: 0 };
  const r = filletGeometry(bodem, schuin, 10);
  ok(!r.error, 'geen fout verwacht');
  const d = 10 / Math.tan(Math.PI / 8);
  assert.ok(dichtbij(r.lijn1.x2, -d, 1e-4), `x2 = ${r.lijn1.x2}, verwacht ${-d}`);
  // Lijn2: het snijnde uiteinde (0,0) wordt vervangen door T2.
  assert.ok(dichtbij(r.lijn2.x2, -d * Math.SQRT1_2, 1e-3), `x2 = ${r.lijn2.x2}`);
  assert.ok(dichtbij(r.lijn2.y2, -d * Math.SQRT1_2, 1e-3), `y2 = ${r.lijn2.y2}`);
  assert.ok(dichtbij(r.lijn2.x1, -70.710678, 1e-6), 'verre uiteinde blijft');
  ok(r.arc, 'boog verwacht');
  assert.ok(dichtbij(r.arc.radius, 10));
});

test('evenwijdige lijnen → parallel', () => {
  const r = filletGeometry(bodem, { x1: -100, y1: 50, x2: 0, y2: 50 }, 10);
  assert.equal(r.error, 'parallel');
});

test('middelpunt exact op het snijpunt → degenerate (geen richting te kiezen)', () => {
  const dwars = { x1: 0, y1: -100, x2: 0, y2: 100 }; // middelpunt (0,0) = I
  const r = filletGeometry({ x1: -100, y1: 0, x2: 100, y2: 0 }, dwars, 10);
  assert.equal(r.error, 'degenerate');
});

test('negatieve of niet-numerieke straal → degenerate', () => {
  assert.equal(filletGeometry(bodem, staand, -5).error, 'degenerate');
  assert.equal(filletGeometry(bodem, staand, NaN).error, 'degenerate');
});

test('fillet kan een te kort segment doortrekken (T voorbij het oude uiteinde)', () => {
  // Korte staande lijn van (0,0) naar (0,4) met straal 10: raakpunt (0,10)
  // ligt VOORBIJ het uiteinde — de lijn wordt verlengd, niet afgekapt.
  const kort = { x1: 0, y1: 0, x2: 0, y2: 4 };
  const r = filletGeometry(bodem, kort, 10);
  ok(!r.error, 'geen fout verwacht');
  assert.ok(dichtbij(r.lijn2.y1, 10), `y1 = ${r.lijn2.y1}`);
  assert.equal(r.lijn2.y2, 4); // verre uiteinde blijft
});

test('chamfer gelijke afstanden op 90°: kant lengte d·√2', () => {
  const r = chamferGeometry(bodem, staand, 10, 10);
  ok(!r.error);
  assert.ok(dichtbij(r.lijn1.x2, -10));
  assert.ok(dichtbij(r.lijn2.y1, 10));
  ok(r.chamfer, 'chamfer-zijde verwacht');
  const len = Math.hypot(r.chamfer.x2 - r.chamfer.x1, r.chamfer.y2 - r.chamfer.y1);
  assert.ok(dichtbij(len, 10 * Math.SQRT2, 1e-6), `lengte = ${len}`);
  assert.ok(dichtbij(r.chamfer.x1, -10));
  assert.ok(dichtbij(r.chamfer.y2, 10));
});

test('chamfer ongelijke afstanden d1 ≠ d2', () => {
  const r = chamferGeometry(bodem, staand, 20, 5);
  ok(!r.error);
  assert.ok(dichtbij(r.lijn1.x2, -20), `x2 = ${r.lijn1.x2}`);
  assert.ok(dichtbij(r.lijn2.y1, 5), `y1 = ${r.lijn2.y1}`);
  const len = Math.hypot(r.chamfer.x2 - r.chamfer.x1, r.chamfer.y2 - r.chamfer.y1);
  assert.ok(dichtbij(len, Math.hypot(20, 5), 1e-6));
});

test('chamfer met beide afstanden nul of negatief → degenerate', () => {
  assert.equal(chamferGeometry(bodem, staand, 0, 0).error, 'degenerate');
  assert.equal(chamferGeometry(bodem, staand, -1, 5).error, 'degenerate');
  assert.equal(chamferGeometry(bodem, staand, 10, NaN).error, 'degenerate');
});

test('chamfer op evenwijdige lijnen → parallel', () => {
  const r = chamferGeometry(bodem, { x1: -100, y1: 50, x2: 0, y2: 50 }, 10, 10);
  assert.equal(r.error, 'parallel');
});

test('chamfer kan nul lengte hebben als raakpunten samenvallen', () => {
  // d1 = d2 = 0 is verboden, maar één millimeter verschil levert een geldige
  // kant op; hier alleen de vorm controleren (chamfer is nooit null bij d>0).
  const r = chamferGeometry(bodem, staand, 0.001, 5);
  ok(!r.error);
  ok(r.chamfer, 'chamfer-zijde verwacht');
});
