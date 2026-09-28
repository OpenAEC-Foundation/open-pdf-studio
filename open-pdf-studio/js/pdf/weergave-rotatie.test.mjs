// Weergave draaien (#200): rekenwerk tussen paginaruimte en weergaveruimte.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normaliseerRotatie,
  isKwartslag,
  weergaveMaat,
  weergaveMatrix,
  paginaMatrix,
  vermenigvuldig,
  naarWeergave,
  naarPagina,
  vectorNaarPagina,
  vectorNaarWeergave,
  rectNaarWeergave,
  rectNaarPagina,
  viewportGeometrie,
  viewportNaarPagina,
  viewportNaarScherm,
  viewportZichtbaar,
  rechtopVak,
  nieuweMaatHoekVast,
} from './weergave-rotatie.js';
import { getPageRotationMatrix } from '../text/text-edit-appearance.js';

const HOEKEN = [0, 90, 180, 270];
// Staand A4 en liggend A3: breedte ≠ hoogte, zodat een verwisseling opvalt.
const PAGINAS = [
  { naam: 'A4 staand', breedte: 595, hoogte: 842 },
  { naam: 'A3 liggend', breedte: 1191, hoogte: 842 },
];

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('normaliseerRotatie: alleen kwartslagen, negatief en boven 360 omgerekend', () => {
  assert.equal(normaliseerRotatie(0), 0);
  assert.equal(normaliseerRotatie(90), 90);
  assert.equal(normaliseerRotatie(-90), 270);
  assert.equal(normaliseerRotatie(450), 90);
  assert.equal(normaliseerRotatie(-180), 180);
  assert.equal(normaliseerRotatie(720), 0);
  assert.equal(normaliseerRotatie(45), 0);
  assert.equal(normaliseerRotatie(undefined), 0);
  assert.equal(normaliseerRotatie('270'), 270);
  assert.equal(isKwartslag(90), true);
  assert.equal(isKwartslag(-90), true);
  assert.equal(isKwartslag(180), false);
});

test('weergaveMaat wisselt breedte en hoogte alleen bij een kwartslag', () => {
  assert.deepEqual(weergaveMaat(595, 842, 0), { breedte: 595, hoogte: 842 });
  assert.deepEqual(weergaveMaat(595, 842, 90), { breedte: 842, hoogte: 595 });
  assert.deepEqual(weergaveMaat(595, 842, 180), { breedte: 595, hoogte: 842 });
  assert.deepEqual(weergaveMaat(595, 842, 270), { breedte: 842, hoogte: 595 });
});

test('hoekpunten: rechtsom draaien zoals /Rotate', () => {
  const B = 595, H = 842;
  // Linksboven van de pagina gaat bij 90° rechtsom naar rechtsboven van het beeld.
  assert.deepEqual(naarWeergave(0, 0, B, H, 90), { x: H, y: 0 });
  assert.deepEqual(naarWeergave(B, 0, B, H, 90), { x: H, y: B });
  assert.deepEqual(naarWeergave(0, H, B, H, 90), { x: 0, y: 0 });
  // 180°: linksboven wordt rechtsonder.
  assert.deepEqual(naarWeergave(0, 0, B, H, 180), { x: B, y: H });
  // 270°: linksboven wordt linksonder.
  assert.deepEqual(naarWeergave(0, 0, B, H, 270), { x: 0, y: B });
  assert.deepEqual(naarWeergave(B, 0, B, H, 270), { x: 0, y: 0 });
});

test('heen en terug geeft hetzelfde punt, bij alle hoeken en paginaformaten', () => {
  for (const { naam, breedte, hoogte } of PAGINAS) {
    for (const r of HOEKEN) {
      for (const [x, y] of [[0, 0], [breedte, hoogte], [123.4, 567.8], [breedte, 0], [0, hoogte], [-10, 900]]) {
        const w = naarWeergave(x, y, breedte, hoogte, r);
        const p = naarPagina(w.x, w.y, breedte, hoogte, r);
        bijna(p.x, x, `${naam} ${r}° x`);
        bijna(p.y, y, `${naam} ${r}° y`);
        // En andersom: vanuit de weergave.
        const v = naarPagina(x, y, breedte, hoogte, r);
        const t = naarWeergave(v.x, v.y, breedte, hoogte, r);
        bijna(t.x, x, `${naam} ${r}° terug x`);
        bijna(t.y, y, `${naam} ${r}° terug y`);
      }
    }
  }
});

test('de pagina valt precies op de gedraaide maat', () => {
  for (const { naam, breedte, hoogte } of PAGINAS) {
    for (const r of HOEKEN) {
      const maat = weergaveMaat(breedte, hoogte, r);
      const hoeken = [[0, 0], [breedte, 0], [0, hoogte], [breedte, hoogte]]
        .map(([x, y]) => naarWeergave(x, y, breedte, hoogte, r));
      const xs = hoeken.map((p) => p.x);
      const ys = hoeken.map((p) => p.y);
      assert.equal(Math.min(...xs), 0, `${naam} ${r}° links`);
      assert.equal(Math.min(...ys), 0, `${naam} ${r}° boven`);
      assert.equal(Math.max(...xs), maat.breedte, `${naam} ${r}° rechts`);
      assert.equal(Math.max(...ys), maat.hoogte, `${naam} ${r}° onder`);
    }
  }
});

test('matrices: paginaMatrix is de inverse van weergaveMatrix', () => {
  for (const { breedte, hoogte } of PAGINAS) {
    for (const r of HOEKEN) {
      const eenheid = vermenigvuldig(paginaMatrix(breedte, hoogte, r), weergaveMatrix(breedte, hoogte, r));
      [1, 0, 0, 1, 0, 0].forEach((v, i) => bijna(eenheid[i], v, `${r}° element ${i}`));
      const terug = vermenigvuldig(weergaveMatrix(breedte, hoogte, r), paginaMatrix(breedte, hoogte, r));
      [1, 0, 0, 1, 0, 0].forEach((v, i) => bijna(terug[i], v, `${r}° andersom element ${i}`));
    }
  }
});

test('zelfde conventie als de paginarotatie-matrix van de tekstlaag', () => {
  for (const { breedte, hoogte } of PAGINAS) {
    for (const r of HOEKEN) {
      assert.deepEqual(weergaveMatrix(breedte, hoogte, r), getPageRotationMatrix(breedte, hoogte, r));
    }
  }
});

test('twee kwartslagen na elkaar zijn een halve slag', () => {
  const B = 595, H = 842;
  const eerst = weergaveMatrix(B, H, 90);
  // De tweede kwartslag draait de al gedraaide pagina (maat H × B).
  const daarna = weergaveMatrix(H, B, 90);
  assert.deepEqual(vermenigvuldig(daarna, eerst), weergaveMatrix(B, H, 180));
});

test('vermenigvuldig volgt de canvas-volgorde: eerst binnen, dan buiten', () => {
  // buiten = zoom 2 plus verschuiving (10, 20); binnen = weergave 90° op A4.
  const buiten = [2, 0, 0, 2, 10, 20];
  const binnen = weergaveMatrix(595, 842, 90);
  const m = vermenigvuldig(buiten, binnen);
  const w = naarWeergave(100, 200, 595, 842, 90);
  const verwacht = { x: 2 * w.x + 10, y: 2 * w.y + 20 };
  assert.deepEqual({ x: m[0] * 100 + m[2] * 200 + m[4], y: m[1] * 100 + m[3] * 200 + m[5] }, verwacht);
});

test('verplaatsingen draaien mee zonder oorsprong', () => {
  // Naar rechts slepen in een 90°-beeld is op de pagina naar boven.
  assert.deepEqual(vectorNaarPagina(10, 0, 90), { x: 0, y: -10 });
  assert.deepEqual(vectorNaarPagina(0, 10, 90), { x: 10, y: 0 });
  assert.deepEqual(vectorNaarPagina(10, 5, 180), { x: -10, y: -5 });
  assert.deepEqual(vectorNaarPagina(10, 0, 270), { x: 0, y: 10 });
  assert.deepEqual(vectorNaarPagina(3, 4, 0), { x: 3, y: 4 });
  for (const r of HOEKEN) {
    const p = vectorNaarPagina(7, -3, r);
    const w = vectorNaarWeergave(p.x, p.y, r);
    bijna(w.x, 7, `${r}° dx`);
    bijna(w.y, -3, `${r}° dy`);
  }
});

test('rechthoeken: heen en terug, en de maat wisselt bij een kwartslag', () => {
  for (const { naam, breedte, hoogte } of PAGINAS) {
    for (const r of HOEKEN) {
      const rect = { x: 100, y: 150, width: 120, height: 80 };
      const w = rectNaarWeergave(rect, breedte, hoogte, r);
      if (isKwartslag(r)) {
        assert.equal(w.width, 80, `${naam} ${r}° breedte`);
        assert.equal(w.height, 120, `${naam} ${r}° hoogte`);
      } else {
        assert.equal(w.width, 120, `${naam} ${r}° breedte`);
        assert.equal(w.height, 80, `${naam} ${r}° hoogte`);
      }
      const p = rectNaarPagina(w, breedte, hoogte, r);
      for (const k of ['x', 'y', 'width', 'height']) bijna(p[k], rect[k], `${naam} ${r}° ${k}`);
    }
  }
});

test('rechthoek bij 90° op A4: een vak linksboven komt rechtsboven', () => {
  // 120 × 80 op (100, 100) van een staande A4 (595 × 842).
  const w = rectNaarWeergave({ x: 100, y: 100, width: 120, height: 80 }, 595, 842, 90);
  assert.deepEqual(w, { x: 842 - 100 - 80, y: 100, width: 80, height: 120 });
  // Een in het beeld getekend vak (weergaveruimte) terug naar de pagina.
  const p = rectNaarPagina({ x: 662, y: 100, width: 80, height: 120 }, 595, 842, 90);
  assert.deepEqual(p, { x: 100, y: 100, width: 120, height: 80 });
});

test('rechthoek met negatieve maat (tegen de richting in gesleept) wordt genormaliseerd', () => {
  const p = rectNaarPagina({ x: 300, y: 300, width: -100, height: -50 }, 595, 842, 0);
  assert.deepEqual(p, { x: 200, y: 250, width: 100, height: 50 });
});

// ─── Enkelpagina-viewport ───────────────────────────────────────────────────

test('viewportGeometrie: paginarotatie en weergaverotatie stapelen', () => {
  // Staande A4 (na /Rotate), paginarotatie 0, weergave 0.
  let g = viewportGeometrie({ pageW: 595, pageH: 842, rotation: 0, viewRotation: 0, zoom: 1, offsetX: 0, offsetY: 0 });
  assert.equal(g.paginaBreedte, 595); assert.equal(g.paginaHoogte, 842);
  assert.equal(g.schermBreedte, 595); assert.equal(g.schermHoogte, 842);
  assert.deepEqual(g.matrix, [1, 0, 0, 1, 0, 0]);
  // Paginarotatie 90 (documentbewerking): paginaruimte ligt al; weergave 0.
  g = viewportGeometrie({ pageW: 595, pageH: 842, rotation: 90, viewRotation: 0 });
  assert.equal(g.paginaBreedte, 842); assert.equal(g.schermBreedte, 842);
  // Alleen de weergave 90: paginaruimte staat, scherm ligt.
  g = viewportGeometrie({ pageW: 595, pageH: 842, rotation: 0, viewRotation: 90 });
  assert.equal(g.paginaBreedte, 595); assert.equal(g.paginaHoogte, 842);
  assert.equal(g.schermBreedte, 842); assert.equal(g.schermHoogte, 595);
  // Beide 90: scherm staat weer.
  g = viewportGeometrie({ pageW: 595, pageH: 842, rotation: 90, viewRotation: 90 });
  assert.equal(g.paginaBreedte, 842); assert.equal(g.schermBreedte, 595);
});

test('viewport: scherm → pagina → scherm, bij alle hoeken, zoom en verschuiving', () => {
  for (const { breedte, hoogte } of PAGINAS) {
    for (const rotation of HOEKEN) {
      for (const viewRotation of HOEKEN) {
        const vp = { pageW: breedte, pageH: hoogte, rotation, viewRotation, zoom: 1.75, offsetX: 37.5, offsetY: -12 };
        for (const [sx, sy] of [[0, 0], [400, 300], [1234.5, 77.25]]) {
          const p = viewportNaarPagina(vp, sx, sy);
          const s = viewportNaarScherm(vp, p.x, p.y);
          bijna(s.x, sx, `${rotation}/${viewRotation} sx`);
          bijna(s.y, sy, `${rotation}/${viewRotation} sy`);
        }
      }
    }
  }
});

test('viewport: de pagina-hoeken vallen op de weergave-rechthoek op het scherm', () => {
  const vp = { pageW: 595, pageH: 842, rotation: 0, viewRotation: 90, zoom: 2, offsetX: 10, offsetY: 20 };
  const g = viewportGeometrie(vp);
  const hoeken = [[0, 0], [595, 0], [0, 842], [595, 842]].map(([x, y]) => viewportNaarScherm(vp, x, y));
  assert.equal(Math.min(...hoeken.map((p) => p.x)), 10);
  assert.equal(Math.min(...hoeken.map((p) => p.y)), 20);
  assert.equal(Math.max(...hoeken.map((p) => p.x)), 10 + g.schermBreedte * 2);
  assert.equal(Math.max(...hoeken.map((p) => p.y)), 20 + g.schermHoogte * 2);
  // Linksboven van de pagina staat bij 90° rechtsboven op het scherm.
  assert.deepEqual(viewportNaarScherm(vp, 0, 0), { x: 10 + 842 * 2, y: 20 });
});

test('viewportZichtbaar zonder rotatie is het oude zichtbare gebied', () => {
  const vp = { pageW: 1000, pageH: 700, rotation: 0, viewRotation: 0, zoom: 2, offsetX: -300, offsetY: 50 };
  // Canvas 800 × 600 CSS-px: x van 150 tot 550 pt, y van 0 tot 275 pt.
  assert.deepEqual(viewportZichtbaar(vp, 800, 600), { x: 150, y: 0, width: 400, height: 275 });
});

test('viewportZichtbaar met weergave 90° geeft het zichtbare deel in paginaruimte', () => {
  // Staande A4 in een liggend beeld: scherm 842 × 595 pt. Zoom 1, hele scherm
  // zichtbaar behalve de linker 100 pt (offsetX -100).
  const vp = { pageW: 595, pageH: 842, rotation: 0, viewRotation: 90, zoom: 1, offsetX: -100, offsetY: 0 };
  const zicht = viewportZichtbaar(vp, 2000, 2000);
  // Weergave x 100..842 is paginaruimte y 0..742 (de linkerkant van het beeld
  // is de onderkant van de pagina); de volle breedte van de pagina is zichtbaar.
  assert.deepEqual(zicht, { x: 0, y: 0, width: 595, height: 742 });
});

test('viewportZichtbaar: pagina buiten beeld geeft een lege rechthoek', () => {
  const vp = { pageW: 595, pageH: 842, rotation: 0, viewRotation: 180, zoom: 1, offsetX: 5000, offsetY: 0 };
  const zicht = viewportZichtbaar(vp, 800, 600);
  assert.equal(zicht.width, 0);
});

// ─── Rechtop op het scherm ──────────────────────────────────────────────────

// Plek op de pagina van een hoek van een vak dat om zijn midden gedraaid is
// (ux, uy = -1 of +1: links/rechts en boven/onder in het vak zelf).
function hoekOpPagina(v, ux, uy) {
  const a = ((v.rotation || 0) * Math.PI) / 180;
  const dx = (ux * v.width) / 2;
  const dy = (uy * v.height) / 2;
  return {
    x: v.x + v.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: v.y + v.height / 2 + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

test('rechtopVak: bij een kwartslag wisselen breedte en hoogte om hetzelfde midden', () => {
  const r = rechtopVak({ x: 100, y: 200, width: 60, height: 200 }, 270);
  assert.deepEqual(r, { x: 30, y: 270, width: 200, height: 60, rotation: 270 });
  assert.deepEqual(rechtopVak({ x: 1, y: 2, width: 3, height: 4 }, 180), { x: 1, y: 2, width: 3, height: 4, rotation: 180 });
  assert.deepEqual(rechtopVak({ x: 1, y: 2, width: 3, height: 4 }, 0), { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
});

test('rechtopVak: op het scherm rechtop, met de eigen linkerbovenhoek linksboven', () => {
  for (const weergave of [90, 180, 270]) {
    for (const [W, H] of [[595.28, 841.89], [1684, 1191]]) {
      // Het vak zoals de gebruiker het op het scherm sleept (weergaveruimte).
      const scherm = { x: 150, y: 90, width: 220, height: 70 };
      const omhullende = rectNaarPagina(scherm, W, H, weergave);
      const v = rechtopVak(omhullende, 360 - weergave);
      const hoeken = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
        .map(([ux, uy]) => hoekOpPagina(v, ux, uy))
        .map((p) => naarWeergave(p.x, p.y, W, H, weergave));
      const eq = (a, b) => Math.abs(a - b) < 1e-9;
      // Linksboven, rechtsboven, rechtsonder, linksonder van het vak vallen
      // op die van de gesleepte rechthoek op het scherm.
      assert.ok(eq(hoeken[0].x, scherm.x) && eq(hoeken[0].y, scherm.y), `${weergave}° linksboven ${JSON.stringify(hoeken[0])}`);
      assert.ok(eq(hoeken[1].x, scherm.x + scherm.width) && eq(hoeken[1].y, scherm.y), `${weergave}° rechtsboven`);
      assert.ok(eq(hoeken[2].x, scherm.x + scherm.width) && eq(hoeken[2].y, scherm.y + scherm.height), `${weergave}° rechtsonder`);
      assert.ok(eq(hoeken[3].x, scherm.x) && eq(hoeken[3].y, scherm.y + scherm.height), `${weergave}° linksonder`);
    }
  }
});

test('nieuweMaatHoekVast: zonder rotatie blijven x en y staan', () => {
  assert.deepEqual(nieuweMaatHoekVast({ x: 10, y: 20, width: 2, height: 3 }, 100, 20), { x: 10, y: 20, width: 100, height: 20 });
});

test('nieuweMaatHoekVast: de eigen linkerbovenhoek blijft op zijn plek, bij elke rotatie', () => {
  for (const rotation of [90, 180, 270, 45, -30]) {
    const oud = { x: 300, y: 400, width: 2, height: 3, rotation };
    const nieuw = { ...nieuweMaatHoekVast(oud, 100, 20), rotation };
    const a = hoekOpPagina(oud, -1, -1);
    const b = hoekOpPagina(nieuw, -1, -1);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${rotation}°: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    assert.equal(nieuw.width, 100);
    assert.equal(nieuw.height, 20);
  }
});

test('klik in een gedraaide weergave: het tekstvak begint op het scherm bij het klikpunt', () => {
  const [W, H] = [595.28, 841.89];
  for (const weergave of [90, 180, 270]) {
    const klik = { x: 200, y: 300 }; // op het scherm (weergaveruimte)
    const p = naarPagina(klik.x, klik.y, W, H, weergave);
    const piepklein = rechtopVak({ x: p.x, y: p.y, width: 0, height: 0 }, 360 - weergave);
    const vak = { ...nieuweMaatHoekVast(piepklein, 100, 20), rotation: piepklein.rotation };
    const lb = hoekOpPagina(vak, -1, -1);
    const ro = hoekOpPagina(vak, 1, 1);
    const s1 = naarWeergave(lb.x, lb.y, W, H, weergave);
    const s2 = naarWeergave(ro.x, ro.y, W, H, weergave);
    assert.ok(Math.abs(s1.x - klik.x) < 1e-9 && Math.abs(s1.y - klik.y) < 1e-9, `${weergave}° linksboven op het klikpunt`);
    assert.ok(Math.abs(s2.x - (klik.x + 100)) < 1e-9 && Math.abs(s2.y - (klik.y + 20)) < 1e-9, `${weergave}° 100 × 20 naar rechts en omlaag`);
  }
});

test('klik met het tekstvak-gereedschap: standaardvak 100 × 20 rechtop, linksboven op het klikpunt', () => {
  // Zo doet de vormen-tool het: het standaardvak loopt op het scherm naar
  // rechts en omlaag (vectorNaarPagina), daarna rechtopVak.
  for (const [W, H] of [[595.28, 841.89], [1190.55, 841.89]]) {
    for (const weergave of [0, 90, 180, 270]) {
      const klik = { x: 210, y: 320 }; // op het scherm (weergaveruimte)
      const p = naarPagina(klik.x, klik.y, W, H, weergave);
      const d = vectorNaarPagina(100, 20, weergave);
      const omhullende = {
        x: Math.min(p.x, p.x + d.x), y: Math.min(p.y, p.y + d.y),
        width: Math.abs(d.x), height: Math.abs(d.y),
      };
      const vak = rechtopVak(omhullende, (360 - weergave) % 360);
      const lb = naarWeergave(...Object.values(hoekOpPagina(vak, -1, -1)), W, H, weergave);
      const ro = naarWeergave(...Object.values(hoekOpPagina(vak, 1, 1)), W, H, weergave);
      bijna(lb.x, klik.x, `${weergave}° linksboven x`);
      bijna(lb.y, klik.y, `${weergave}° linksboven y`);
      bijna(ro.x, klik.x + 100, `${weergave}° rechtsonder x`);
      bijna(ro.y, klik.y + 20, `${weergave}° rechtsonder y`);
    }
  }
});
