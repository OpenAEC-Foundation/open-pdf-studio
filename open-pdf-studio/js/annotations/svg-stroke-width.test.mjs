import assert from 'node:assert/strict';
import test from 'node:test';

import {
  svgViewBoxWidth,
  svgBaseStrokeWidth,
  strokeUnitsForLineWidth,
  restrokeSvg,
} from './svg-stroke-width.js';

test('leest de viewBox-breedte van de root', () => {
  assert.equal(svgViewBoxWidth('<svg viewBox="0 0 65.0 14.0" width="65mm">'), 65);
  assert.equal(svgViewBoxWidth('<svg viewBox="0 -25.5 65 65">'), 65);
  assert.equal(svgViewBoxWidth('<svg width="64" height="64">'), null);
});

test('leest de basis-lijndikte uit de bron', () => {
  assert.equal(svgBaseStrokeWidth('<svg viewBox="0 0 65 14"><g stroke-width="0.12"><path/></g></svg>'), 0.12);
  // Meerdere diktes: de meest voorkomende is de basis.
  const multi = '<svg><g stroke-width="0.5"/><g stroke-width="0.25"/><g stroke-width="0.25"/></svg>';
  assert.equal(svgBaseStrokeWidth(multi), 0.25);
});

test('zonder stroke-width geldt de SVG-standaard van 1', () => {
  assert.equal(svgBaseStrokeWidth('<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>'), 1);
});

// --- omrekening paginaeenheden -> gebruikerseenheden ---

test('rekent een lijndikte in paginaeenheden om naar gebruikerseenheden', () => {
  // viewBox 65 breed, geplaatst op 260 paginaeenheden => 4 px per eenheid.
  // Een lijn van 2 paginaeenheden is dan 0.5 gebruikerseenheden.
  assert.equal(strokeUnitsForLineWidth({ lineWidth: 2, viewBoxWidth: 65, placedWidth: 260 }), 0.5);
});

test('geeft null bij onbruikbare invoer', () => {
  assert.equal(strokeUnitsForLineWidth({ lineWidth: 0, viewBoxWidth: 65, placedWidth: 260 }), null);
  assert.equal(strokeUnitsForLineWidth({ lineWidth: 2, viewBoxWidth: null, placedWidth: 260 }), null);
  assert.equal(strokeUnitsForLineWidth({ lineWidth: 2, viewBoxWidth: 65, placedWidth: 0 }), null);
});

// --- herschrijven ---

test('zet de lijndikte op de gevraagde waarde', () => {
  const svg = '<svg viewBox="0 0 65 14"><g stroke-width="0.12"><path d="M0,0L1,1"/></g></svg>';
  const out = restrokeSvg(svg, 0.48);
  assert.match(out, /stroke-width="0\.48"/);
  assert.doesNotMatch(out, /stroke-width="0\.12"/);
});

test('behoudt de onderlinge verhouding bij meerdere diktes', () => {
  // basis = 0.25 (meest voorkomend); doel 0.5 => factor 2; 0.5 wordt 1
  const svg = '<svg><g stroke-width="0.5"/><g stroke-width="0.25"/><g stroke-width="0.25"/></svg>';
  const out = restrokeSvg(svg, 0.5);
  const widths = [...out.matchAll(/stroke-width="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(widths, [1, 0.5, 0.5]);
});

test('voegt een stroke-width toe aan de root als de bron er geen heeft', () => {
  const svg = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>';
  const out = restrokeSvg(svg, 3);
  assert.match(out, /<svg[^>]*stroke-width="3"/);
});

test('laat de bron ongemoeid bij onbruikbare invoer', () => {
  const svg = '<svg viewBox="0 0 65 14"><g stroke-width="0.12"/></svg>';
  assert.equal(restrokeSvg(svg, 0), svg);
  assert.equal(restrokeSvg(svg, null), svg);
  assert.equal(restrokeSvg(null, 1), null);
});

// --- de gemelde situatie ---

test('de gemelde schroef: 12 pt op een symbool van 246 paginaeenheden', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="65.0mm" height="14.0mm" viewBox="0 0 65.0 14.0"><g stroke-width="0.12"><path d="M0,0L1,1"/></g></svg>';
  const units = strokeUnitsForLineWidth({ lineWidth: 12, viewBoxWidth: svgViewBoxWidth(svg), placedWidth: 246 });
  // 12 * 65 / 246 = 3.1707...
  assert.equal(units, 3.1707);
  const out = restrokeSvg(svg, units);
  assert.match(out, /stroke-width="3\.1707"/);
});

// --- terugweg: welke lijndikte levert de bron nu op? ---

test('rekent de huidige dikte van een bron terug naar paginaeenheden', async () => {
  const { lineWidthForStroke } = await import('./svg-stroke-width.js');
  // 0.5 gebruikerseenheden, viewBox 65 breed, geplaatst op 260 => 2 paginaeenheden
  assert.equal(lineWidthForStroke({ strokeUnits: 0.5, viewBoxWidth: 65, placedWidth: 260 }), 2);
  // de gemelde schroef, ongewijzigd: 0.12 op 246 paginaeenheden
  assert.equal(lineWidthForStroke({ strokeUnits: 0.12, viewBoxWidth: 65, placedWidth: 246 }), 0.4542);
});

test('heen en terug leveren dezelfde waarde op', async () => {
  const { lineWidthForStroke } = await import('./svg-stroke-width.js');
  const units = strokeUnitsForLineWidth({ lineWidth: 2, viewBoxWidth: 65, placedWidth: 260 });
  assert.equal(lineWidthForStroke({ strokeUnits: units, viewBoxWidth: 65, placedWidth: 260 }), 2);
});

test('terugweg geeft null bij onbruikbare invoer', async () => {
  const { lineWidthForStroke } = await import('./svg-stroke-width.js');
  assert.equal(lineWidthForStroke({ strokeUnits: 0, viewBoxWidth: 65, placedWidth: 260 }), null);
  assert.equal(lineWidthForStroke({ strokeUnits: 1, viewBoxWidth: null, placedWidth: 260 }), null);
});
