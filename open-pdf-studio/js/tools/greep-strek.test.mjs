// Greep slepen bij een gedraaide vorm. Een vierkant uit een ander programma
// met /Rotation 270 wordt een 'box' met rotation -90: opgeslagen in zijn eigen
// ongedraaide ruimte en om zijn midden gedraaid getekend, net als zijn grepen.
//
// Gemeld: bij het kleiner maken aan een hoekgreep versprong de vorm zodra de
// objectsnap aansloeg, en de tooltip toonde "NaN px". De snap rekende vanaf
// de ONGEDRAAIDE hoek in plaats van vanaf de greep op het scherm, en de
// tooltip vermenigvuldigde met het schaal-OBJECT van het document.
//
// De echte bronnen draaien hier (grepen, schalen, greep-strek en de
// schaalopzoeking), met alleen hun imports vervangen: die trekken de DOM, de
// state en SolidJS mee.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schaalOpPunt, verzamelSchaalBronnen } from '../annotations/schaal-op-punt.js';

let _nr = 0;

/**
 * Laadt een bronbestand met elke import (en elke her-export uit een ander
 * bestand) vervangen door een stub. Namen zonder eigen stub worden een
 * functie die niets doet.
 */
async function laadMetStubs(relPad, stubs = {}) {
  const namen = new Set();
  const bron = readFileSync(new URL(relPad, import.meta.url), 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, wat) => {
      const binnen = wat.replace(/[{}]/g, ' ');
      for (const deel of binnen.split(',')) {
        const naam = deel.trim().split(/\s+as\s+/).pop().trim();
        if (naam) namen.add(naam);
      }
      return '';
    })
    .replace(/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  const sleutel = `__opdsGreepStrekStubs${_nr++}`;
  globalThis[sleutel] = stubs;
  const kop = [...namen]
    .map((n) => `const ${n} = globalThis.${sleutel}.${n} ?? (() => undefined);`)
    .join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(`${kop}\n${bron}`, 'utf8').toString('base64'));
}

// De echte greepnamen en greepmaat, uit de bron van de constanten gelezen.
const constanten = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
const HANDLE_TYPES = new Function(
  `return ${constanten.match(/export const HANDLE_TYPES = (\{[\s\S]*?\}) as const;/)[1]};`,
)();
const HANDLE_SIZE = Number(constanten.match(/export const HANDLE_SIZE = (\d+);/)[1]);

const state = { preferences: {}, shiftKeyPressed: false };
const minimummaat = await import('../annotations/minimummaat.js');
const greepKeuze = await import('../annotations/greep-keuze.js');
const polygonTransform = await import('../annotations/polygon-transform.js');
const tweePunt = await import('../symbols/two-point.js');
// Eén sjabloon: een balk die met twee punten geplaatst wordt. Symbolen zonder
// symbolId krijgen geen sjabloon en houden hun vakgrepen.
const getTemplate = (id) => (id === 'balk' ? { placement: 'two-point' } : undefined);

const grepen = await laadMetStubs('../annotations/handles.js', {
  ...minimummaat, ...greepKeuze, HANDLE_SIZE, HANDLE_TYPES, state,
  getTemplate, twoPointEndpoints: tweePunt.twoPointEndpoints,
});
const { applyResize } = await laadMetStubs('../annotations/transforms.js', {
  ...minimummaat, ...polygonTransform, ...tweePunt, HANDLE_TYPES, state, getTemplate,
});
const { greepOorsprong, strekBasispunt, strekLengteTekst } = await laadMetStubs('./greep-strek.js', {
  greepOpScherm: grepen.greepOpScherm,
  twoPointEndpoints: tweePunt.twoPointEndpoints,
});

// Zoom waarbij de vormen hieronder ruim groter zijn dan het greepkader, zodat
// de grepen niet uitwijken (greep-keuze.js) en op de vorm zelf staan.
const SCHAAL = 4;
const MAATGREPEN = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
const dichtbij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Midden van een greep zoals getAnnotationHandles hem tekent.
function greepMidden(ann, type) {
  const hs = HANDLE_SIZE / SCHAAL;
  const g = grepen.getAnnotationHandles(ann, SCHAAL).find((h) => h.type === type);
  return g ? { x: g.x + hs / 2, y: g.y + hs / 2 } : null;
}

function geschaald(ann, greep, dx, dy) {
  const orig = JSON.parse(JSON.stringify(ann));
  const doel = JSON.parse(JSON.stringify(ann));
  applyResize(doel, greep, dx, dy, orig, false, false, { schaal: SCHAAL });
  return doel;
}

// Het gemelde vierkant: 94.9 x 43.6 in zijn eigen ruimte, -90 graden gedraaid.
const VIERKANT = { type: 'box', x: 300, y: 400, width: 94.9, height: 43.6, rotation: -90, page: 1 };

test('gedraaid vierkant (-90°): een gesnapte hoekgreep volgt het snappunt zoals de cursor, zonder sprong', () => {
  for (const greep of MAATGREPEN) {
    const opScherm = greepMidden(VIERKANT, greep);
    // Kleiner maken: het snappunt ligt een stuk naar binnen, richting het midden.
    const midden = { x: VIERKANT.x + VIERKANT.width / 2, y: VIERKANT.y + VIERKANT.height / 2 };
    const snap = {
      x: opScherm.x + (midden.x - opScherm.x) * 0.3,
      y: opScherm.y + (midden.y - opScherm.y) * 0.3,
    };
    // Zo rekent _handleResize met een snap: gesnapt punt min de greepoorsprong.
    const o = greepOorsprong(VIERKANT, greep);
    const metSnap = geschaald(VIERKANT, greep, snap.x - o.x, snap.y - o.y);
    // En zo zonder snap, met de cursor precies op dat punt (gepakt op de greep).
    const metCursor = geschaald(VIERKANT, greep, snap.x - opScherm.x, snap.y - opScherm.y);
    for (const k of ['x', 'y', 'width', 'height']) {
      assert.ok(dichtbij(metSnap[k], metCursor[k]),
        `${greep} ${k}: met snap ${metSnap[k]}, met cursor ${metCursor[k]}`);
    }
    // De greep staat na het slepen op het snappunt.
    const na = greepMidden(metSnap, greep);
    assert.ok(dichtbij(na.x, snap.x) && dichtbij(na.y, snap.y),
      `${greep}: greep op (${na.x}, ${na.y}), snappunt (${snap.x}, ${snap.y})`);
    // En de vorm is echt kleiner geworden, niet weggesprongen of omgeklapt.
    assert.ok(metSnap.width <= VIERKANT.width + 1e-9 && metSnap.height <= VIERKANT.height + 1e-9,
      `${greep}: ${metSnap.width} x ${metSnap.height}`);
  }
});

test('gesnapte maatgreep volgt het snappunt ook bij andere gedraaide vormen', () => {
  const vormen = ['box', 'mask', 'circle', 'cloud', 'polygon', 'image', 'stamp', 'redaction', 'parametricSymbol'];
  for (const type of vormen) {
    for (const rotation of [-90, 30, 180]) {
      const ann = { type, x: 120, y: 80, width: 70, height: 45, rotation, page: 1 };
      for (const greep of MAATGREPEN) {
        const opScherm = greepMidden(ann, greep);
        const snap = { x: opScherm.x - 7.25, y: opScherm.y + 3.5 };
        const o = greepOorsprong(ann, greep);
        const metSnap = geschaald(ann, greep, snap.x - o.x, snap.y - o.y);
        const metCursor = geschaald(ann, greep, snap.x - opScherm.x, snap.y - opScherm.y);
        for (const k of ['x', 'y', 'width', 'height']) {
          assert.ok(dichtbij(metSnap[k], metCursor[k]),
            `${type} ${rotation}° ${greep} ${k}: met snap ${metSnap[k]}, met cursor ${metCursor[k]}`);
        }
      }
    }
  }
});

test('meetlijn en snap beginnen bij de greep zoals die getekend is, voor elke gedraaide vorm', () => {
  const vormen = [
    'box', 'mask', 'highlight', 'polygon', 'cloud', 'textbox', 'image', 'stamp', 'signature',
    'scaleBar', 'scheduleTable', 'parametricSymbol', 'redaction', 'vectorSnippet', 'circle', 'callout',
  ];
  const grepenMetPunt = [...MAATGREPEN, 'rect_center', 'circle_center'];
  for (const type of vormen) {
    for (const rotation of [-90, 30]) {
      const ann = { type, x: 50.5, y: 60.25, width: 80, height: 40, rotation, page: 1 };
      const getekend = grepen.getAnnotationHandles(ann, SCHAAL).filter((h) => grepenMetPunt.includes(h.type));
      assert.ok(getekend.length >= 4, `${type}: grepen ${getekend.length}`);
      for (const g of getekend) {
        const verwacht = greepMidden(ann, g.type);
        const basis = strekBasispunt(ann, g.type);
        assert.ok(basis && dichtbij(basis.x, verwacht.x) && dichtbij(basis.y, verwacht.y),
          `${type} ${rotation}° ${g.type}: meetlijn vanaf ${JSON.stringify(basis)}, greep op ${JSON.stringify(verwacht)}`);
        const o = greepOorsprong(ann, g.type);
        assert.ok(dichtbij(o.x, verwacht.x) && dichtbij(o.y, verwacht.y),
          `${type} ${rotation}° ${g.type}: snap vanaf ${JSON.stringify(o)}, greep op ${JSON.stringify(verwacht)}`);
      }
    }
  }
});

test('ongedraaide vorm: greepoorsprong en meetlijn precies als voorheen (de hoeken van het vak)', () => {
  const vak = { x: 10.1, y: 20.3, width: 30.7, height: 40.9 };
  const verwacht = {
    tl: [vak.x, vak.y],
    tr: [vak.x + vak.width, vak.y],
    bl: [vak.x, vak.y + vak.height],
    br: [vak.x + vak.width, vak.y + vak.height],
    t: [vak.x + vak.width / 2, vak.y],
    b: [vak.x + vak.width / 2, vak.y + vak.height],
    l: [vak.x, vak.y + vak.height / 2],
    r: [vak.x + vak.width, vak.y + vak.height / 2],
    rect_center: [vak.x + vak.width / 2, vak.y + vak.height / 2],
  };
  for (const type of ['box', 'image', 'circle', 'textbox', 'viewport']) {
    for (const rotation of [undefined, 0]) {
      const ann = { type, ...vak, rotation };
      for (const [greep, [x, y]] of Object.entries(verwacht)) {
        assert.deepEqual(greepOorsprong(ann, greep), { x, y }, `${type} ${rotation} ${greep} snap`);
        assert.deepEqual(strekBasispunt(ann, greep), { x, y }, `${type} ${rotation} ${greep} meetlijn`);
      }
    }
  }
  // Lijngrepen en knooppunten gaan niet door de draaiing.
  const lijn = { type: 'line', startX: 1, startY: 2, endX: 7, endY: 11, rotation: 45 };
  assert.deepEqual(greepOorsprong(lijn, 'line_end'), { x: 7, y: 11 });
  assert.deepEqual(strekBasispunt(lijn, 'line_start'), { x: 1, y: 2 });
  const lijnstuk = { type: 'polyline', points: [{ x: 3, y: 4 }, { x: 5, y: 6 }] };
  assert.deepEqual(greepOorsprong(lijnstuk, 'polyline_node_1'), { x: 5, y: 6 });
  assert.equal(strekBasispunt(lijnstuk, 'leader_start'), null);
});

test('gedraaid twee-punts symbool: eindgrepen staan al in paginaruimte en draaien niet mee', () => {
  const balk = { type: 'parametricSymbol', symbolId: 'balk', page: 1 };
  tweePunt.syncTwoPointGeometry(balk, 100, 100, 200, 160, 10);
  assert.ok(balk.rotation);
  for (const g of ['line_start', 'line_end', 'line_mid']) {
    const verwacht = greepMidden(balk, g);
    const o = greepOorsprong(balk, g), b = strekBasispunt(balk, g);
    assert.ok(dichtbij(o.x, verwacht.x) && dichtbij(o.y, verwacht.y), `${g} snap ${JSON.stringify(o)}`);
    assert.ok(dichtbij(b.x, verwacht.x) && dichtbij(b.y, verwacht.y), `${g} meetlijn ${JSON.stringify(b)}`);
  }
});

test('oud twee-punts symbool zonder eindpunten: gesnapte eindgreep volgt het snappunt, zonder inklappen', () => {
  // Opgeslagen vóór de tweepunts-eindpunten: alleen het gedraaide vak, de
  // grepen komen uit twoPointEndpoints (handles.js en applyResize).
  const oud = { type: 'parametricSymbol', symbolId: 'balk', x: 150, y: 195, width: 100, height: 10, rotation: 90, page: 1 };
  for (const g of ['line_start', 'line_end', 'line_mid']) {
    const verwacht = greepMidden(oud, g);
    const o = greepOorsprong(oud, g), b = strekBasispunt(oud, g);
    assert.ok(dichtbij(o.x, verwacht.x) && dichtbij(o.y, verwacht.y), `${g} snap vanaf ${JSON.stringify(o)}`);
    assert.ok(b && dichtbij(b.x, verwacht.x) && dichtbij(b.y, verwacht.y), `${g} meetlijn vanaf ${JSON.stringify(b)}`);
  }
  for (const g of ['line_start', 'line_end']) {
    const opScherm = greepMidden(oud, g);
    const snap = { x: opScherm.x - 5, y: opScherm.y - 5 };
    const o = greepOorsprong(oud, g);
    const metSnap = geschaald(oud, g, snap.x - o.x, snap.y - o.y);
    const metCursor = geschaald(oud, g, snap.x - opScherm.x, snap.y - opScherm.y);
    for (const k of ['startX', 'startY', 'endX', 'endY', 'width', 'rotation']) {
      assert.ok(Number.isFinite(metSnap[k]) && dichtbij(metSnap[k], metCursor[k]),
        `${g} ${k}: met snap ${metSnap[k]}, met cursor ${metCursor[k]}`);
    }
    assert.ok(metSnap.width > 50, `${g}: balk ingeklapt tot ${metSnap.width}`);
  }
});

test('sjabloon-eigen greep: het punt van het sjabloon, ongedraaid; zonder punt de algemene terugval', () => {
  const ps = { type: 'parametricSymbol', x: 0, y: 0, width: 10, height: 10, rotation: 30 };
  assert.deepEqual(greepOorsprong(ps, 'gevelelement_stijl', () => ({ x: 3, y: 4 })), { x: 3, y: 4 });
  assert.deepEqual(greepOorsprong(ps, 'gevelelement_stijl', () => null), { x: 5, y: 5 });
});

// ── Tooltip-lengte ────────────────────────────────────────────────────────

// Documentschaal zoals de automatische schaalherkenning hem zet (loader.js).
const PX_PER_MM_1_100 = 72 / (25.4 * 100);
const autoSchaal = (unit = 'mm', ppu = PX_PER_MM_1_100) => ({
  pixelsPerUnit: ppu, unit, method: 'auto-detect', scaleRatio: '1:100',
});

test('tooltip: met een documentschaal een eindige lengte in de eenheid van de tekening', () => {
  // 3.13026 m (de B uit het maatvenster) bij 1:100 in meter.
  const ppuM = PX_PER_MM_1_100 * 1000;
  const doc = { measureScale: autoSchaal('m', ppuM) };
  const lengte = 3.13026 * ppuM;
  assert.equal(strekLengteTekst(lengte, { pixelsPerUnit: ppuM, unit: 'm' }, doc), '3.13 m');
  // In millimeter: zelfde omrekening als de maatvelden (punten / pixelsPerUnit).
  const docMm = { measureScale: autoSchaal() };
  const tekst = strekLengteTekst(100, { pixelsPerUnit: PX_PER_MM_1_100, unit: 'mm' }, docMm);
  assert.equal(tekst, `${(100 / PX_PER_MM_1_100).toFixed(2)} mm`);
  assert.doesNotMatch(tekst, /NaN/);
});

test('tooltip: zonder schaal gewoon punten, en een oude kale getal-schaal rekent als voorheen', () => {
  assert.equal(strekLengteTekst(12.34, null, {}), '12.3 px');
  assert.equal(strekLengteTekst(12.34, null, null), '12.3 px');
  assert.equal(strekLengteTekst(10, null, { measureScale: 0.5, measureUnit: 'mm' }), '5.0 mm');
  assert.equal(strekLengteTekst(10, null, { measureScale: 2 }), '20.0 px');
  // Een schaal ter plekke gaat voor op een oude getal-schaal.
  assert.equal(strekLengteTekst(28.35, { pixelsPerUnit: 2.835, unit: 'cm' }, { measureScale: 0.5 }), '10.00 cm');
});

test('tooltip-schaal: findMeasureScale geeft de documentschaal, of null zonder enige schaal', async () => {
  const doc = { annotations: [], measureScale: autoSchaal() };
  const meting = await laadMetStubs('../annotations/measurement.js', {
    state,
    getActiveDocument: () => doc,
    getScaleFromRegion: () => null,
    getScaleForPoint: (p, x, y) => schaalOpPunt(doc, p, x, y),
    schaalBronnen: (d) => verzamelSchaalBronnen(d),
  });
  assert.equal(typeof meting.findMeasureScale, 'function', 'findMeasureScale ontbreekt');
  const s = meting.findMeasureScale(1, 10, 10);
  assert.equal(s.pixelsPerUnit, PX_PER_MM_1_100);
  assert.equal(s.unit, 'mm');
  assert.doesNotMatch(strekLengteTekst(50, s, doc), /NaN|px/);
  // Zelfde schaal als de maatvelden (getMeasureScale).
  assert.equal(meting.getMeasureScale(1, 10, 10).pixelsPerUnit, s.pixelsPerUnit);

  doc.measureScale = null;
  assert.equal(meting.findMeasureScale(1, 10, 10), null);
  assert.equal(strekLengteTekst(50, meting.findMeasureScale(1, 10, 10), doc), '50.0 px');
  // getMeasureScale houdt zijn terugval voor de rest van de app.
  assert.deepEqual(meting.getMeasureScale(1, 10, 10), { pixelsPerUnit: 1, unit: 'mm' });
});

// ── Koppeling in _handleResize ────────────────────────────────────────────
// De sleep zelf hangt aan de DOM en de canvas; controleer dat hij met deze
// helpers rekent in plaats van met een eigen (ongedraaide) kopie.

function handleResizeRomp() {
  const bron = readFileSync(new URL('./tool-dispatcher.js', import.meta.url), 'utf8');
  const begin = bron.indexOf('function _handleResize(');
  assert.ok(begin >= 0, '_handleResize ontbreekt');
  return bron.slice(begin, bron.indexOf('\nfunction ', begin + 1));
}

test('_handleResize rekent met de greep-strek-helpers', () => {
  const romp = handleResizeRomp();
  assert.match(romp, /greepOorsprong\(state\.originalAnnotation, state\.activeHandle,\s*\(orig, h\) => getTemplate\(orig\.symbolId\)\?\.greepOorsprong\?\.\(orig, h\)\)/);
  assert.match(romp, /strekBasispunt\(state\.originalAnnotation, state\.activeHandle\)/);
  assert.match(romp, /const lenSchaal = findMeasureScale\(/);
  assert.match(romp, /strekLengteTekst\(len, lenSchaal, getActiveDocument\(\)\)/);
  // Niet meer het schaal-object van het document als getal ("NaN px").
  assert.doesNotMatch(romp, /measureScale\)\s*\|\|\s*1/);
});

test('gedraaide afbeelding: geen gelijke-maat-snap (die zet het vaste punt in het ongedraaide vak terug)', () => {
  const romp = handleResizeRomp();
  assert.match(romp,
    /enableImageAlignSnap && ann\.type === 'image' && _isBoxHandle\s*&& !state\.originalAnnotation\.rotation\)/);
});
