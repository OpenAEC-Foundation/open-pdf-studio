import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_VORM_MAAT_PT, KLIK_DREMPEL_PX,
  klemMaat, isGeldigeMaat, schermPxNaarPt, veiligeVerhouding,
  nietNul, normaliseerRechthoek, schaalRechthoekMetGreep, isKlikSleep,
  raakMarge, wolkUitstulping, saneerMaatVelden, tekstvakMinimum,
} from './minimummaat.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const GREPEN = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
const LINKS = new Set(['tl', 'bl', 'l']);
const RECHTS = new Set(['tr', 'br', 'r']);
const BOVEN = new Set(['tl', 'tr', 't']);
const ONDER = new Set(['bl', 'br', 'b']);

function allesEindig(r) {
  return ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]));
}

// Hoekpunt van een (gedraaide) rechthoek in paginaruimte. fx/fy in 0..1.
function hoek(r, fx, fy, rotatie = 0) {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const lx = r.x + r.width * fx - cx, ly = r.y + r.height * fy - cy;
  const rad = rotatie * Math.PI / 180;
  return {
    x: cx + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: cy + lx * Math.sin(rad) + ly * Math.cos(rad),
  };
}

// Het vaste punt tegenover de greep, als fractie van de rechthoek.
function ankerFractie(greep) {
  const fx = LINKS.has(greep) ? 1 : RECHTS.has(greep) ? 0 : 0.5;
  const fy = BOVEN.has(greep) ? 1 : ONDER.has(greep) ? 0 : 0.5;
  return { fx, fy };
}

test('de ondergrens is technisch: klein genoeg voor maximale zoom, groot genoeg voor PDF-getallen', () => {
  // 6400 % -> 1 schermpixel = 1/64 pt; de epsilon ligt daaronder.
  assert.ok(MIN_VORM_MAAT_PT < 1 / 64);
  // Ruim boven 1e-6 (daaronder schrijft JS exponentnotatie) en boven de
  // afronding van de vector-appearances (0,001 pt).
  assert.ok(MIN_VORM_MAAT_PT >= 0.01);
  assert.ok(!String(MIN_VORM_MAAT_PT / 4).includes('e'));
});

test('klemMaat: nul, negatief, NaN, Infinity en niet-getallen worden de ondergrens', () => {
  for (const v of [0, -5, NaN, Infinity, -Infinity, null, undefined, 'abc', {}]) {
    assert.equal(klemMaat(v), MIN_VORM_MAAT_PT, String(v));
  }
  assert.equal(klemMaat(0.05), 0.05);
  assert.equal(klemMaat('0.5'), 0.5);
  assert.equal(klemMaat(3, 10), 10);
  assert.equal(klemMaat(12, 10), 12);
  // Een ondergrens die zelf onzin is valt terug op de epsilon.
  assert.equal(klemMaat(0, NaN), MIN_VORM_MAAT_PT);
  assert.equal(klemMaat(0, -1), MIN_VORM_MAAT_PT);
});

test('isGeldigeMaat', () => {
  assert.equal(isGeldigeMaat(0.01), true);
  assert.equal(isGeldigeMaat(1e-9), false);
  assert.equal(isGeldigeMaat(0), false);
  assert.equal(isGeldigeMaat(-1), false);
  assert.equal(isGeldigeMaat(NaN), false);
  assert.equal(isGeldigeMaat('5'), false);
});

test('schermPxNaarPt rekent met de zoom en overleeft een kapotte zoom', () => {
  assert.equal(schermPxNaarPt(16, 2), 8);
  assert.equal(schermPxNaarPt(16, 64), 0.25);
  assert.equal(schermPxNaarPt(16, 0), 16);
  assert.equal(schermPxNaarPt(16, NaN), 16);
  assert.equal(schermPxNaarPt(16, undefined), 16);
});

test('veiligeVerhouding: geen deling door nul, geen NaN', () => {
  assert.equal(veiligeVerhouding(200, 100), 2);
  assert.equal(veiligeVerhouding(200, 0), 0);
  assert.equal(veiligeVerhouding(0, 100), 0);
  assert.equal(veiligeVerhouding(NaN, 100), 0);
  assert.equal(veiligeVerhouding(-4, 2), 0);
});

test('nietNul houdt het teken en springt niet naar 1 pt', () => {
  assert.equal(nietNul(5), 5);
  assert.equal(nietNul(-5), -5);
  assert.equal(nietNul(0), MIN_VORM_MAAT_PT);
  assert.equal(nietNul(-0.0001), -MIN_VORM_MAAT_PT);
  assert.equal(nietNul(NaN), MIN_VORM_MAAT_PT);
});

test('normaliseerRechthoek: negatieve maat wordt omgeklapt naar linksboven', () => {
  const r = normaliseerRechthoek({ x: 100, y: 50, width: -40, height: -10 });
  assert.deepEqual(r, { x: 60, y: 40, width: 40, height: 10 });
  const n = normaliseerRechthoek({ x: 1, y: 2, width: 0, height: NaN });
  assert.equal(n.width, MIN_VORM_MAAT_PT);
  assert.equal(n.height, MIN_VORM_MAAT_PT);
  assert.equal(n.x, 1);
  assert.equal(n.y, 2);
});

test('elke greep: het vaste punt blijft staan en alleen de aangestuurde as verandert', () => {
  const orig = { x: 100, y: 200, width: 60, height: 40 };
  for (const g of GREPEN) {
    const r = schaalRechthoekMetGreep(orig, g, 7, -3);
    const { fx, fy } = ankerFractie(g);
    const a0 = hoek(orig, fx, fy), a1 = hoek(r, fx, fy);
    assert.ok(near(a0.x, a1.x) && near(a0.y, a1.y), `anker ${g}`);
    const stuurtX = LINKS.has(g) || RECHTS.has(g);
    const stuurtY = BOVEN.has(g) || ONDER.has(g);
    if (!stuurtX) { assert.equal(r.width, 60, g); assert.equal(r.x, 100, g); }
    if (!stuurtY) { assert.equal(r.height, 40, g); assert.equal(r.y, 200, g); }
    if (stuurtX) assert.ok(near(r.width, LINKS.has(g) ? 53 : 67), g);
    if (stuurtY) assert.ok(near(r.height, BOVEN.has(g) ? 43 : 37), g);
  }
});

test('een rechthoek mag willekeurig klein: 0,05 pt blijft 0,05 pt', () => {
  const orig = { x: 10, y: 10, width: 20, height: 20 };
  const r = schaalRechthoekMetGreep(orig, 'br', -19.95, -19.95);
  assert.ok(near(r.width, 0.05));
  assert.ok(near(r.height, 0.05));
  assert.equal(r.x, 10);
  assert.equal(r.y, 10);
});

test('een al kleine maat op de andere as springt niet omhoog bij het aanraken van een greep', () => {
  const orig = { x: 0, y: 0, width: 0.3, height: 50 };
  const r = schaalRechthoekMetGreep(orig, 'b', 0, -10);
  assert.equal(r.width, 0.3);
  assert.ok(near(r.height, 40));
});

test('voorbij het vaste punt slepen: klemt op de ondergrens, klapt niet om en loopt niet weg', () => {
  const orig = { x: 100, y: 200, width: 60, height: 40 };
  for (const g of GREPEN) {
    const dx = LINKS.has(g) ? 500 : -500;
    const dy = BOVEN.has(g) ? 500 : -500;
    const r = schaalRechthoekMetGreep(orig, g, dx, dy);
    assert.ok(allesEindig(r), g);
    assert.ok(r.width >= MIN_VORM_MAAT_PT && r.height >= MIN_VORM_MAAT_PT, g);
    const { fx, fy } = ankerFractie(g);
    const a0 = hoek(orig, fx, fy), a1 = hoek(r, fx, fy);
    assert.ok(near(a0.x, a1.x) && near(a0.y, a1.y), `anker ${g}`);
    if (LINKS.has(g) || RECHTS.has(g)) assert.equal(r.width, MIN_VORM_MAAT_PT, g);
    if (BOVEN.has(g) || ONDER.has(g)) assert.equal(r.height, MIN_VORM_MAAT_PT, g);
  }
});

test('gedraaid (30/45/90/-120): het vaste punt blijft in paginaruimte staan, ook bij de klem', () => {
  const orig = { x: 100, y: 200, width: 60, height: 40 };
  for (const rot of [30, 45, 90, -120]) {
    for (const g of GREPEN) {
      for (const [dx, dy] of [[5, -8], [900, 900], [-900, -900]]) {
        const r = schaalRechthoekMetGreep(orig, g, dx, dy, { rotatie: rot });
        assert.ok(allesEindig(r), `${rot} ${g}`);
        assert.ok(r.width >= MIN_VORM_MAAT_PT && r.height >= MIN_VORM_MAAT_PT);
        const { fx, fy } = ankerFractie(g);
        const a0 = hoek(orig, fx, fy, rot), a1 = hoek(r, fx, fy, rot);
        assert.ok(near(a0.x, a1.x, 1e-6) && near(a0.y, a1.y, 1e-6), `anker ${rot} ${g} ${dx}`);
      }
    }
  }
});

test('gedraaid 90: een sleep langs de pagina-y stuurt de lokale breedte', () => {
  const orig = { x: 0, y: 0, width: 60, height: 40 };
  // Bij 90 graden wijst de lokale x-as langs de pagina-y.
  const r = schaalRechthoekMetGreep(orig, 'r', 0, 10, { rotatie: 90 });
  assert.ok(near(r.width, 70, 1e-6));
  assert.ok(near(r.height, 40, 1e-6));
});

test('vaste verhouding: zeer brede (188x24) en zeer hoge (24x188) afbeelding houden hun verhouding tot aan de ondergrens', () => {
  for (const [w, h] of [[188, 24], [24, 188], [100, 100]]) {
    const orig = { x: 50, y: 60, width: w, height: h };
    const ratio = w / h;
    for (const g of GREPEN) {
      for (const d of [3, 20, 100, 5000]) {
        const dx = LINKS.has(g) ? d : -d;
        const dy = BOVEN.has(g) ? d : -d;
        const r = schaalRechthoekMetGreep(orig, g, dx, dy, { vasteVerhouding: true, verhouding: ratio });
        assert.ok(allesEindig(r), `${w}x${h} ${g} ${d}`);
        assert.ok(r.width >= MIN_VORM_MAAT_PT - 1e-12 && r.height >= MIN_VORM_MAAT_PT - 1e-12, `${g} ${d}`);
        assert.ok(near(r.width / r.height, ratio, 1e-6), `verhouding ${w}x${h} ${g} ${d}`);
        const { fx, fy } = ankerFractie(g);
        const a0 = hoek(orig, fx, fy), a1 = hoek(r, fx, fy);
        assert.ok(near(a0.x, a1.x, 1e-6) && near(a0.y, a1.y, 1e-6), `anker ${g} ${d}`);
      }
    }
  }
});

test('vaste verhouding: de afbeelding kan echt klein worden (niet vast op 20 pt)', () => {
  const orig = { x: 0, y: 0, width: 188, height: 24 };
  const r = schaalRechthoekMetGreep(orig, 'br', -187, 0, { vasteVerhouding: true, verhouding: 188 / 24 });
  assert.ok(near(r.width, 1, 1e-9));
  assert.ok(near(r.height, 24 / 188, 1e-9));
});

test('vaste verhouding met hoogte 0 of onzin-verhouding: valt terug op vrij schalen, nooit NaN', () => {
  const orig = { x: 0, y: 0, width: 100, height: 0 };
  for (const verhouding of [Infinity, NaN, 0, -2, undefined]) {
    const r = schaalRechthoekMetGreep(orig, 'br', -10, 5, { vasteVerhouding: true, verhouding });
    assert.ok(allesEindig(r), String(verhouding));
    assert.ok(near(r.width, 90));
    assert.ok(r.height >= MIN_VORM_MAAT_PT);
  }
});

test('gedraaid met vaste verhouding: verhouding en anker blijven kloppen', () => {
  const orig = { x: 10, y: 20, width: 120, height: 30 };
  for (const g of GREPEN) {
    const r = schaalRechthoekMetGreep(orig, g, 900, 900, { rotatie: 45, vasteVerhouding: true, verhouding: 4 });
    assert.ok(allesEindig(r), g);
    assert.ok(near(r.width / r.height, 4, 1e-6), g);
    const { fx, fy } = ankerFractie(g);
    const a0 = hoek(orig, fx, fy, 45), a1 = hoek(r, fx, fy, 45);
    assert.ok(near(a0.x, a1.x, 1e-6) && near(a0.y, a1.y, 1e-6), `anker ${g}`);
  }
});

test('eigen ondergrens (tekstvak, schaalgebied): houdt de vorm boven de grens, maar duwt een al kleinere vorm niet omhoog', () => {
  const groot = { x: 0, y: 0, width: 100, height: 100 };
  const r = schaalRechthoekMetGreep(groot, 'br', -99, -99, { minBreedte: 16, minHoogte: 12 });
  assert.equal(r.width, 16);
  assert.equal(r.height, 12);
  // Al kleiner dan de grens (ingetypt of geladen): krimpen stopt, groeien kan.
  const klein = { x: 0, y: 0, width: 6, height: 6 };
  const k = schaalRechthoekMetGreep(klein, 'br', -3, 4, { minBreedte: 16, minHoogte: 12 });
  assert.equal(k.width, 6);
  assert.equal(k.height, 10);
});

test('kapotte invoer: NaN-delta, onbekende greep en negatieve bronmaat geven een geldige rechthoek', () => {
  const orig = { x: 10, y: 10, width: 50, height: 50 };
  const a = schaalRechthoekMetGreep(orig, 'br', NaN, undefined);
  assert.deepEqual(a, { x: 10, y: 10, width: 50, height: 50 });
  const b = schaalRechthoekMetGreep(orig, 'rotate', 5, 5);
  assert.deepEqual(b, { x: 10, y: 10, width: 50, height: 50 });
  const c = schaalRechthoekMetGreep({ x: 60, y: 60, width: -50, height: -50 }, 'br', 10, 10);
  assert.deepEqual(c, { x: 10, y: 10, width: 60, height: 60 });
});

test('isKlikSleep rekent in schermpixels: ingezoomd is een kleine sleep een echte sleep', () => {
  // 2 pt bij 100 % = 2 px: klik. Dezelfde 2 pt bij 6400 % = 128 px: sleep.
  assert.equal(isKlikSleep(2, 2, 1), true);
  assert.equal(isKlikSleep(2, 2, 64), false);
  // 0,05 pt bij 6400 % = 3,2 px: nog binnen de drempel.
  assert.equal(isKlikSleep(0.05, 0.05, 64), true);
  // 0,1 pt bij 6400 % = 6,4 px: een bewuste sleep.
  assert.equal(isKlikSleep(0.1, 0.1, 64), false);
  // Smal maar lang is een sleep (beide assen moeten binnen de drempel vallen).
  assert.equal(isKlikSleep(0, 50, 1), false);
  assert.equal(isKlikSleep(-1, -1, 1), true);
  assert.equal(isKlikSleep(NaN, NaN, 1), true);
  assert.ok(KLIK_DREMPEL_PX > 0 && KLIK_DREMPEL_PX <= 5);
});

test('raakMarge: een piepkleine vorm krijgt een raakvlak in schermpixels, een grote vorm niets extra', () => {
  // Vorm van 0,05 pt bij 6400 % = 3,2 px; raakvlak minimaal 10 px -> 3,4 px per kant.
  const m = raakMarge(0.05, 64);
  assert.ok(near(m * 64 * 2 + 0.05 * 64, 10, 1e-9));
  assert.equal(raakMarge(100, 1), 0);
  assert.equal(raakMarge(100, NaN), 0);
  // De marge groeit nooit voorbij de halve schermgrens.
  assert.ok(raakMarge(0, 2) <= 5 / 2 + 1e-12);
});

test('wolkUitstulping schaalt mee met de vorm en is begrensd op de oude vaste marge', () => {
  assert.equal(wolkUitstulping(400, 300, 8), 8);
  const klein = wolkUitstulping(1, 1, 8);
  assert.ok(klein > 0 && klein <= 0.5);
  assert.equal(wolkUitstulping(NaN, 1, 8), 0);
});

test('saneerMaatVelden: width/height/w/h/radius worden eindig en positief, de rest blijft staan', () => {
  const uit = saneerMaatVelden({ width: 0, height: -3, w: NaN, h: '7', radius: 'x', color: '#f00', x: -5 });
  assert.equal(uit.width, MIN_VORM_MAAT_PT);
  assert.equal(uit.height, MIN_VORM_MAAT_PT);
  assert.equal(uit.w, MIN_VORM_MAAT_PT);
  assert.equal(uit.h, 7);
  assert.equal(uit.radius, MIN_VORM_MAAT_PT);
  assert.equal(uit.color, '#f00');
  assert.equal(uit.x, -5);
  // Velden die niet in de patch staan komen er niet bij.
  assert.deepEqual(saneerMaatVelden({ color: '#0f0' }), { color: '#0f0' });
  // De bron wordt niet gemuteerd.
  const bron = { width: 0 };
  saneerMaatVelden(bron);
  assert.equal(bron.width, 0);
  assert.equal(saneerMaatVelden(null), null);
});

test('saneerMaatVelden: niet-eindige positie wordt geweigerd (veld vervalt)', () => {
  const uit = saneerMaatVelden({ x: NaN, y: 'abc', width: 5 });
  assert.equal('x' in uit, false);
  assert.equal('y' in uit, false);
  assert.equal(uit.width, 5);
});

test('tekstvakMinimum volgt de lettergrootte en niet een vast aantal punten', () => {
  const std = tekstvakMinimum({ fontSize: 12 });
  const klein = tekstvakMinimum({ fontSize: 0.5 });
  assert.ok(std.minBreedte > klein.minBreedte);
  assert.ok(std.minHoogte > klein.minHoogte);
  // Eén regel moet passen.
  assert.ok(std.minHoogte >= 12);
  assert.ok(klein.minHoogte >= 0.5 && klein.minHoogte < 2);
  // Geen of kapotte lettergrootte: nooit onder de technische ondergrens.
  const geen = tekstvakMinimum({ fontSize: NaN });
  assert.ok(geen.minBreedte >= MIN_VORM_MAAT_PT && geen.minHoogte >= MIN_VORM_MAAT_PT);
});
