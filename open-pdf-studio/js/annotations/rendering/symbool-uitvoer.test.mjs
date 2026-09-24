// Een kozijn in de opgeslagen PDF heeft dezelfde lijndiktes als op het
// scherm (op 100 %), in paginapunten — niet de minimum-schermpixel van de
// zoomstand waarin toevallig werd opgeslagen.
//
// Aanleiding: een raam op 1:50, opgeslagen terwijl het blad passend in beeld
// stond (zoom ±25 %), kreeg in de appearance lijnen van 4 pt: het dubbele glas
// werd één zwarte balk, de kozijnstijlen zwarte blokken, de draaicirkel een
// dikke stippellijn.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { weergaveLijndikte, symboolOpdrachtLijndikte, MIN_LIJNDIKTE_PT } from './lijndikte.js';
import { doorTemplate } from '../../symbols/templates/door.js';
import { windowTemplate } from '../../symbols/templates/window.js';
import { defaultParams } from '../../symbols/registry.js';
import { kozijnProps } from '../../plattegrond/mcp-plattegrond.js';
import { sparingPlaatsing } from '../../plattegrond/sparing.js';
import { normaliseerPakket, kozijnInPakket } from '../../plattegrond/spouwmuur.js';

const K50 = 2.8346 / 50;                 // paginapunten per mm op 1:50
const BASIS = 0.7;                        // lijndikte van een gehost kozijn

/** Zoals de saver hem tekent: uitvoer, echte dikte, los van de zoomstand. */
const opgeslagen = (c) => weergaveLijndikte(symboolOpdrachtLijndikte(c, BASIS), { scherm: false });
/** Zoals het scherm hem op 100 % tekent. */
const scherm100 = (c) => weergaveLijndikte(symboolOpdrachtLijndikte(c, BASIS), { scherm: true, zoom: 1 });

/** Een gehost kozijn op 1:50 in een wand van 300, zoals app_floorplan hem maakt. */
function gehost(soort, extra = {}) {
  const wand = { id: 'w', startX: 0, startY: 100, endX: 2000, endY: 100, dikteMm: 300 };
  const p = sparingPlaatsing(wand, { id: 's', soort, dagmaatMm: soort === 'raam' ? 1200 : 930, hartMm: 2000 }, K50);
  const kozijn = kozijnInPakket(normaliseerPakket([{ dikteMm: 300 }]), {});
  const props = kozijnProps(wand, p, { draaizijde: 1, raamtype: extra.type, draairichtingTonen: extra.toon === true, kozijn }, K50);
  const tpl = soort === 'raam' ? windowTemplate : doorTemplate;
  const params = { ...defaultParams(tpl), ...props.params };
  return tpl.render(params, { x: props.x, y: props.y, width: props.width, height: props.height });
}

test('uitvoer: de lijndikte hangt niet af van de zoomstand', () => {
  for (const zoom of [0.1, 0.25, 0.5, 1, 4]) {
    assert.equal(weergaveLijndikte(0.35, { scherm: false, zoom }), 0.35);
    assert.equal(weergaveLijndikte(0.35, { scherm: false, zoom, dunneLijnen: true }), 0.35);
  }
  assert.equal(weergaveLijndikte(0.1, { scherm: false }), MIN_LIJNDIKTE_PT, 'ondergrens');
  assert.equal(weergaveLijndikte(0, { scherm: false }), 0, 'geen rand blijft geen rand');
});

test('scherm: minstens één schermpixel bij uitzoomen — precies wat niet in de PDF mag', () => {
  assert.equal(weergaveLijndikte(0.35, { scherm: true, zoom: 0.25 }), 4);
  assert.equal(weergaveLijndikte(0.35, { scherm: true, zoom: 1 }), 0.35);
  assert.equal(weergaveLijndikte(0.35, { scherm: true, zoom: 2, dunneLijnen: true }), 0.5);
  assert.equal(weergaveLijndikte(20, { scherm: true, zoom: 1, slepen: true }), 6, 'plafond tijdens slepen');
});

test('raam op 1:50: glas en aanzicht dun, kozijnhout vol, gelijk aan het scherm', () => {
  const cmds = gehost('raam');
  const glas = cmds.filter((c) => c.kind === 'line' && c.lineWidthFactor === 0.5);
  assert.equal(glas.length, 2, 'dubbel glas');
  for (const c of glas) assert.ok(opgeslagen(c) <= 0.35 + 1e-12, `glaslijn ${opgeslagen(c)} pt`);
  // De twee glaslijnen liggen verder uit elkaar dan ze dik zijn: geen balk.
  const afstand = Math.abs(glas[0].y1 - glas[1].y1);
  assert.ok(afstand > 2 * opgeslagen(glas[0]), `glaslijnen ${afstand.toFixed(2)} pt uit elkaar`);
  const stijlen = cmds.filter((c) => c.kind === 'polyline' && c.fill === '#ffffff' && c.lineWidthFactor === 1);
  assert.equal(stijlen.length, 2);
  for (const c of stijlen) assert.equal(opgeslagen(c), BASIS);
  for (const c of cmds) assert.equal(opgeslagen(c), scherm100(c), `${c.kind} zoals op het scherm`);
});

test('draairaam en deur op 1:50: de draaicirkel is dun', () => {
  assert.ok(!gehost('raam', { type: 'turn' }).some((c) => c.kind === 'arc'), 'standaard geen draaicirkel bij een raam');
  const draai = gehost('raam', { type: 'turn', toon: true });
  const boog = draai.find((c) => c.kind === 'arc');
  assert.ok(boog, 'draairaam met draairichting heeft een draaicirkel');
  assert.ok(opgeslagen(boog) <= 0.25 + 1e-12, `draaicirkel ${opgeslagen(boog)} pt`);
  assert.ok(Array.isArray(boog.dash), 'gestreept');

  const deur = gehost('deur');
  const deurboog = deur.find((c) => c.kind === 'arc');
  assert.ok(opgeslagen(deurboog) <= 0.25 + 1e-12);
  const blad = deur.find((c) => c.kind === 'polyline' && c.lineWidthFactor === 0.6);
  assert.ok(opgeslagen(blad) <= 0.45, `deurblad ${opgeslagen(blad)} pt`);
  for (const c of [...draai, ...deur]) assert.equal(opgeslagen(c), scherm100(c));
});

test('de appearance van een symbool wordt als uitvoer getekend, niet als scherm', () => {
  // rendering.js draait alleen in de app; bewaak de route in de bron zelf.
  const bron = readFileSync(new URL('../rendering.js', import.meta.url), 'utf8');
  const start = bron.indexOf('export function renderParametricSymbolToPng');
  assert.ok(start > 0);
  const eind = bron.indexOf('\n}\n', start);
  const functie = bron.slice(start, eind);
  const uitvoer = functie.indexOf('_lagen = weergaveLagen({ uitvoer: true })');
  const tekenen = functie.indexOf('drawAnnotation(ctx');
  assert.ok(uitvoer > 0 && uitvoer < tekenen, 'uitvoerlagen staan aan tijdens het tekenen van de appearance');
  assert.match(functie, /finally\s*\{\s*_lagen = vorigeLagen;/, 'en gaan daarna terug');
  // thinLw laat de regel aan de pure functie over.
  assert.match(bron, /if \(width === 0 \|\| !scherm\) return weergaveLijndikte\(width, \{ scherm: false \}\);/);
});

// ── oude deuren en ramen (zonder de nieuwe parameters) ─────────────────

/** De tekening van de symbolen van vóór de kozijnen, als referentie. */
function oudeDeur(params, bbox) {
  const cmds = [];
  const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  const swing = params.swing || 'left';
  const rad = Math.max(1, Math.min(180, Number(params.angle) || 90)) * Math.PI / 180;
  const hingeX = swing === 'left' ? x : x + w;
  const hingeY = y + h;
  const r = Math.min(w, h);
  const leafEndX = swing === 'left' ? hingeX + r * Math.cos(rad) : hingeX - r * Math.cos(rad);
  const leafEndY = hingeY - r * Math.sin(rad);
  cmds.push({ kind: 'line', x1: hingeX, y1: hingeY, x2: leafEndX, y2: leafEndY });
  if (swing === 'left') cmds.push({ kind: 'arc', cx: hingeX, cy: hingeY, r, a0: -rad, a1: 0, ccw: false });
  else cmds.push({ kind: 'arc', cx: hingeX, cy: hingeY, r, a0: Math.PI + rad, a1: Math.PI, ccw: true });
  if (params.showWall) cmds.push({ kind: 'line', x1: x, y1: hingeY, x2: x + w, y2: hingeY, dash: [6, 3] });
  return cmds;
}

function oudRaam(params, bbox) {
  const cmds = [];
  const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  cmds.push({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y });
  cmds.push({ kind: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h });
  const cy = y + h / 2;
  const inset = h * 0.18;
  cmds.push({ kind: 'line', x1: x, y1: cy - inset, x2: x + w, y2: cy - inset });
  cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy + inset });
  cmds.push({ kind: 'line', x1: x, y1: y, x2: x, y2: y + h });
  cmds.push({ kind: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h });
  if (params.type === 'pivot') {
    cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy - inset, x2: x + w / 2 + 6, y2: cy + inset });
    cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy + inset, x2: x + w / 2 + 6, y2: cy - inset });
  } else if (params.type === 'tilt') {
    cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy - inset, dash: [3, 2] });
  }
  return cmds;
}

test('oude deuren en ramen tekenen precies als voorheen', () => {
  const bbox = { x: 10, y: 20, width: 51, height: 51 };
  for (const params of [
    { width: 900, swing: 'left', angle: 90, showWall: false },
    { width: 900, swing: 'right', angle: 60, showWall: true },
    // Een oude gehoste deur uit app_floorplan.
    { hostWallId: 'run:0:0', hostAfstandMm: 2000, width: 900, dagmaatMm: 900, borstweringMm: 0, hoogteMm: 2315, swing: 'left', angle: 90, showWall: false },
  ]) assert.deepEqual(doorTemplate.render(params, bbox), oudeDeur(params, bbox));

  const vak = { x: 10, y: 20, width: 68, height: 17 };
  for (const params of [
    { width: 1200, wallThickness: 240, type: 'fixed' },
    { width: 1200, wallThickness: 240, type: 'pivot' },
    { width: 1200, wallThickness: 240, type: 'tilt' },
    // Een oud gehost raam uit app_floorplan.
    { hostWallId: 'run:0:0', hostAfstandMm: 6000, width: 1200, dagmaatMm: 1200, borstweringMm: 850, hoogteMm: 1500, wallThickness: 300, type: 'fixed' },
  ]) assert.deepEqual(windowTemplate.render(params, vak), oudRaam(params, vak));
});

test('oude symbolen: geen lijndiktefactor, dus de symbooldikte zoals voorheen', () => {
  const cmds = [
    ...doorTemplate.render({ width: 900, swing: 'left', angle: 90 }, { x: 0, y: 0, width: 51, height: 51 }),
    ...windowTemplate.render({ width: 1200, wallThickness: 240, type: 'fixed' }, { x: 0, y: 0, width: 68, height: 17 }),
  ];
  for (const c of cmds) {
    assert.equal(c.lineWidthFactor, undefined);
    assert.equal(symboolOpdrachtLijndikte(c, 1), 1);
  }
});
