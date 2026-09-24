import assert from 'node:assert/strict';
import test from 'node:test';

import { syncTwoPointGeometry } from '../symbols/two-point.js';
import {
  STIJL_GREEP, ptPerMm, positieOpElement, onderdeelOnderPunt, onderdeelPaginaVlak,
  stijlGreep, sleepStijl, rekElement, geometrieNaParams,
} from './element.js';

const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const K = 0.1;                                   // pt per mm

/** Een vliesgevel van 3600 mm, schuin getekend (hoek van 90°: omlaag). */
function element(params, lijn = { sx: 100, sy: 100, ex: 100, ey: 460 }) {
  const ann = { type: 'parametricSymbol', symbolId: 'vliesgevel', page: 1, params };
  syncTwoPointGeometry(ann, lijn.sx, lijn.sy, lijn.ex, lijn.ey, 15);
  return ann;
}
const PARAMS = { lengte: 3600, stijlen: [{ pos: 1200 }, { pos: 2400 }], panelen: ['glas', 'deur', 'glas'] };

test('de schaal van het element volgt uit zijn getekende lengte', () => {
  bijna(ptPerMm(element(PARAMS), 'vliesgevel'), K, 1e-12, 'pt/mm');
  const p = positieOpElement(element(PARAMS), 'vliesgevel', { x: 90, y: 220 });
  bijna(p.uMm, 1200, 1e-9, 'langs');
  bijna(p.dMm, 100, 1e-9, 'dwars: omlaag getekend is rechts = -x');
});

test('onderdeel onder de aanwijzer, ook bij een gedraaid element', () => {
  const ann = element(PARAMS);
  assert.deepEqual(onderdeelOnderPunt(ann, 'vliesgevel', { x: 100, y: 220 }), { soort: 'stijl', index: 1 });
  assert.deepEqual(onderdeelOnderPunt(ann, 'vliesgevel', { x: 101, y: 160 }), { soort: 'paneel', index: 0 });
  // 1 pt naast de stijl (10 mm): zonder speling het paneel, met 2 pt speling de stijl.
  assert.deepEqual(onderdeelOnderPunt(ann, 'vliesgevel', { x: 100, y: 216.5 }), { soort: 'paneel', index: 0 });
  assert.deepEqual(onderdeelOnderPunt(ann, 'vliesgevel', { x: 100, y: 216.5 }, 2), { soort: 'stijl', index: 1 });
});

test('het vlak van een onderdeel ligt op de pagina waar het getekend is', () => {
  const ann = element(PARAMS);
  const vlak = onderdeelPaginaVlak(ann, 'vliesgevel', { soort: 'stijl', index: 1 });
  const ys = vlak.map((p) => p.y), xs = vlak.map((p) => p.x);
  bijna(Math.min(...ys), 217.5, 1e-9, 'stijl 1 begint op 1175 mm');
  bijna(Math.max(...ys), 222.5, 1e-9, 'en eindigt op 1225 mm');
  bijna(Math.min(...xs), 92.5, 1e-9, '150 mm diep om de lijn');
  bijna(Math.max(...xs), 107.5, 1e-9, '150 mm diep om de lijn');
});

test('greep alleen op een geselecteerde tussenstijl', () => {
  const ann = element(PARAMS);
  assert.equal(stijlGreep(ann, 'vliesgevel'), null, 'niets geselecteerd');
  ann.selectedSub = { soort: 'stijl', index: 0 };
  assert.equal(stijlGreep(ann, 'vliesgevel'), null, 'het kader verschuift niet');
  ann.selectedSub = { soort: 'paneel', index: 1 };
  assert.equal(stijlGreep(ann, 'vliesgevel'), null);
  ann.selectedSub = { soort: 'stijl', index: 2 };
  const g = stijlGreep(ann, 'vliesgevel');
  assert.equal(g.type, STIJL_GREEP);
  assert.equal(g.index, 2);
  bijna(g.x, 100, 1e-9, 'op de lijn');
  bijna(g.y, 340, 1e-9, 'op 2400 mm');
});

test('slepen aan de stijlgreep verschuift de stijl langs het element, geklemd', () => {
  const orig = element(PARAMS);
  orig.selectedSub = { soort: 'stijl', index: 1 };
  const werk = JSON.parse(JSON.stringify(orig));
  assert.equal(sleepStijl(werk, orig, 'vliesgevel', 7, -20), true, 'dwars slepen telt niet, langs 200 mm terug');
  assert.deepEqual(werk.params.stijlen.map((s) => s.pos), [1000, 2400]);
  const ver = JSON.parse(JSON.stringify(orig));
  sleepStijl(ver, orig, 'vliesgevel', 0, 500);
  assert.deepEqual(ver.params.stijlen.map((s) => s.pos), [2250, 2400], 'tegen de grens van het buurveld');
  const geen = element(PARAMS);
  assert.equal(sleepStijl(JSON.parse(JSON.stringify(geen)), geen, 'vliesgevel', 0, 10), false);
});

test('eindgreep verslepen: stijlen blijven staan ten opzichte van de vaste kant', () => {
  const orig = element(PARAMS);
  const werk = JSON.parse(JSON.stringify(orig));
  werk.params.lengte = 4000;
  rekElement(werk, orig, 'vliesgevel', 'eind');
  assert.deepEqual(werk.params.stijlen.map((s) => s.pos), [1600, 2800]);
});

test('geometrie na een parameterwijziging: beginpunt en richting blijven, vak volgt', () => {
  const ann = element({ ...PARAMS, panelen: ['glas', 'glas', 'glas'] });
  ann.params = { ...ann.params, lengte: 4000, panelen: ['deur', 'glas', 'glas'] };
  geometrieNaParams(ann, 'vliesgevel', K);
  assert.equal(ann.startX, 100);
  assert.equal(ann.startY, 100);
  bijna(ann.endY, 500, 1e-9, 'lengte volgt params');
  bijna(ann.endX, 100, 1e-9, 'richting blijft');
  bijna(ann.height, (150 + 2 * 1125) * K, 1e-9, 'vak omvat de deur (dag 1125)');
  bijna(ann.rotation, 90, 1e-9, 'draaiing volgt de lijn');
});
