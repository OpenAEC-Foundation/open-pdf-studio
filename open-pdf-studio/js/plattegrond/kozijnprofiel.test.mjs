import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KOZIJN_STANDAARD, sponningBreedte, stijlContour, kozijnstijl, tussenstijl,
  glasVormen, deurVormen, deurbladBreedte, raamVormen, dichtPaneelVormen,
  kozijnDetail, vormenOmhullende, vormenNaarTekenopdrachten,
} from './kozijnprofiel.js';

const bijna = (a, b, tol = 1e-9, wat = '') => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** Oppervlakte van een gesloten veelhoek (schoenveter), altijd positief. */
function oppervlakte(punten) {
  let s = 0;
  for (let i = 0; i < punten.length; i++) {
    const a = punten[i], b = punten[(i + 1) % punten.length];
    s += a.u * b.v - b.u * a.v;
  }
  return Math.abs(s) / 2;
}

function omhulling(punten) {
  return {
    uMin: Math.min(...punten.map((p) => p.u)), uMax: Math.max(...punten.map((p) => p.u)),
    vMin: Math.min(...punten.map((p) => p.v)), vMax: Math.max(...punten.map((p) => p.v)),
  };
}

test('de standaard is een Nederlands houten kozijn: 67 x 114 met een sponning van 17', () => {
  assert.equal(KOZIJN_STANDAARD.stijlBreedteMm, 67);
  assert.equal(KOZIJN_STANDAARD.stijlDiepteMm, 114);
  assert.equal(KOZIJN_STANDAARD.sponningDiepteMm, 17);
  assert.equal(KOZIJN_STANDAARD.deurbladDikteMm, 40);
  assert.equal(KOZIJN_STANDAARD.glasDikteMm, 24, 'HR++ 4-16-4');
  // De sponning is zo breed als wat erin komt.
  assert.equal(sponningBreedte('glas'), 24 + KOZIJN_STANDAARD.glaslatMm);
  assert.equal(sponningBreedte('deur'), 40 + KOZIJN_STANDAARD.deurSpelingMm);
  assert.equal(sponningBreedte('deur', { deurbladDikteMm: 54 }), 54 + KOZIJN_STANDAARD.deurSpelingMm);
  assert.equal(sponningBreedte('open'), 0);
});

test('een stijl zonder sponning is een rechthoek, gecentreerd op zijn hartlijn', () => {
  const c = stijlContour({ breedteMm: 67, diepteMm: 114 });
  assert.equal(c.length, 4);
  assert.deepEqual(omhulling(c), { uMin: -33.5, uMax: 33.5, vMin: 0, vMax: 114 });
  bijna(oppervlakte(c), 67 * 114, 1e-9, 'oppervlakte');
});

test('de sponning snijdt een hoek uit de stijl aan de dagkant, aan de gevraagde zijde', () => {
  const binnen = stijlContour({
    breedteMm: 67, diepteMm: 114,
    sponningen: [{ kant: 'plus', diepteMm: 17, breedteMm: 44, zijde: 'binnen' }],
  });
  assert.equal(binnen.length, 6, 'rechthoek met één uitsnede');
  bijna(oppervlakte(binnen), 67 * 114 - 17 * 44, 1e-9, 'oppervlakte');
  // De uitsnede zit aan de +u-kant (dagkant) en aan de binnenzijde (grote v).
  assert.ok(binnen.some((p) => p.u === 33.5 - 17 && p.v === 114));
  assert.ok(binnen.some((p) => p.u === 33.5 && p.v === 114 - 44));
  assert.ok(!binnen.some((p) => p.u === 33.5 && p.v === 114), 'de hoek zelf is weg');

  const buiten = stijlContour({
    breedteMm: 67, diepteMm: 114,
    sponningen: [{ kant: 'min', diepteMm: 17, breedteMm: 42, zijde: 'buiten' }],
  });
  assert.ok(buiten.some((p) => p.u === -33.5 + 17 && p.v === 0));
  assert.ok(buiten.some((p) => p.u === -33.5 && p.v === 42));
  assert.ok(!buiten.some((p) => p.u === -33.5 && p.v === 0));
  bijna(oppervlakte(buiten), 67 * 114 - 17 * 42, 1e-9, 'oppervlakte');
});

test('een te grote sponning wordt begrensd: de stijl blijft een stijl', () => {
  const c = stijlContour({
    breedteMm: 67, diepteMm: 114,
    sponningen: [{ kant: 'plus', diepteMm: 90, breedteMm: 200, zijde: 'binnen' }],
  });
  assert.ok(oppervlakte(c) > 0);
  const o = omhulling(c);
  assert.deepEqual(o, { uMin: -33.5, uMax: 33.5, vMin: 0, vMax: 114 });
});

test('kozijnstijl: de sponning volgt de vulling en de dagkant', () => {
  const glas = kozijnstijl({ dagkant: 'plus', vulling: 'glas' });
  assert.equal(glas.breedteMm, 67);
  assert.equal(glas.diepteMm, 114);
  assert.equal(glas.contour.length, 6);
  bijna(oppervlakte(glas.contour), 67 * 114 - 17 * sponningBreedte('glas'), 1e-9, 'glas');

  const deur = kozijnstijl({ dagkant: 'min', vulling: 'deur', zijde: 'buiten' });
  assert.ok(deur.contour.some((p) => p.u === -33.5 && p.v === sponningBreedte('deur')));

  const open = kozijnstijl({ dagkant: 'plus', vulling: 'open' });
  assert.equal(open.contour.length, 4, 'zonder vulling geen sponning');
});

test('een tussenstijl heeft een sponning aan beide kanten', () => {
  const t = tussenstijl({ vulling: 'glas' });
  assert.equal(t.contour.length, 8);
  bijna(oppervlakte(t.contour), 67 * 114 - 2 * 17 * sponningBreedte('glas'), 1e-9, 'oppervlakte');
  const o = omhulling(t.contour);
  assert.deepEqual(o, { uMin: -33.5, uMax: 33.5, vMin: 0, vMax: 114 });
});

test('glas zit in de sponning: dubbel glas als twee lijnen, met glaslatten', () => {
  const vormen = glasVormen({ vanU: 67, totU: 1133, diepteMm: 114 });
  const glas = vormen.filter((v) => v.rol === 'glas');
  assert.equal(glas.length, 2, 'HR++ als twee dunne lijnen');
  const vs = glas.map((g) => g.van.v).sort((a, b) => a - b);
  // Sponning aan de binnenzijde: glaslat 20 binnen, glas 24 daarachter.
  assert.deepEqual(vs, [114 - 44, 114 - 20]);
  for (const g of glas) {
    // Het glas steekt in de sponning, met een beetje speling.
    assert.ok(g.van.u < 67 && g.van.u > 67 - 17, `glas begint in de sponning (${g.van.u})`);
    assert.ok(g.tot.u > 1133 && g.tot.u < 1133 + 17, `glas eindigt in de sponning (${g.tot.u})`);
  }
  const latten = vormen.filter((v) => v.rol === 'glaslat');
  assert.equal(latten.length, 2);
  for (const l of latten) assert.equal(l.soort, 'vlak');
});

test('eenvoudig (1:100): één glaslijn, geen glaslatten', () => {
  const vormen = glasVormen({ vanU: 67, totU: 1133, diepteMm: 114, detail: 'eenvoudig' });
  assert.equal(vormen.length, 1);
  assert.equal(vormen[0].rol, 'glas');
  assert.equal(vormen[0].van.u, 67, 'tot aan de stijl, de sponning is niet getekend');
  assert.equal(vormen[0].tot.u, 1133);
  bijna(vormen[0].van.v, 114 - 44 + 12, 1e-9, 'hart van het glas');
});

test('buitenbeglazing spiegelt: de glaslat zit buiten', () => {
  const vormen = glasVormen({ vanU: 0, totU: 1000, diepteMm: 114, zijde: 'buiten' });
  const vs = vormen.filter((v) => v.rol === 'glas').map((g) => g.van.v).sort((a, b) => a - b);
  assert.deepEqual(vs, [20, 44]);
});

test('glas volgt de stijl als die minder diep is dan het element', () => {
  const vormen = glasVormen({ vanU: 0, totU: 1000, diepteMm: 200, vVan: 50, vTot: 164 });
  const vs = vormen.filter((v) => v.rol === 'glas').map((g) => g.van.v).sort((a, b) => a - b);
  assert.deepEqual(vs, [164 - 44, 164 - 20]);
});

test('het deurblad valt in de sponning: kozijn 930 geeft een blad van 830', () => {
  // Standaard binnendeur: kozijn 930 buitenwerks, stijlen 67 → dag 796.
  bijna(deurbladBreedte({ vanU: 67, totU: 863 }), 830 - 2 * 2, 1e-9, 'blad');
});

test('de deur draait om het scharnier aan de kant waar hij heen draait', () => {
  const vormen = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'min', draaiNaar: 'binnen' });
  const blad = vormen.find((v) => v.rol === 'deurblad');
  const boog = vormen.find((v) => v.rol === 'draaicirkel');
  assert.equal(blad.soort, 'vlak');
  assert.equal(boog.soort, 'boog');
  const L = deurbladBreedte({ vanU: 67, totU: 863 });
  // Scharnier in de sponning, op het binnenvlak van het kozijn.
  bijna(boog.midden.u, 67 - 17 + 2, 1e-9, 'scharnier u');
  bijna(boog.midden.v, 114, 1e-9, 'scharnier v');
  bijna(boog.straal, L, 1e-9, 'straal');
  // Open (90°) staat het blad haaks op de wand, de ruimte in (grote v).
  const o = omhulling(blad.punten);
  bijna(o.uMin, 52, 1e-9, 'blad tegen de dagkant');
  bijna(o.uMax, 52 + 40, 1e-9, 'bladdikte 40');
  bijna(o.vMin, 114, 1e-9, 'vanaf het binnenvlak');
  bijna(o.vMax, 114 + L, 1e-9, 'blad lang');
  // De boog loopt van dicht (langs +u) naar open (langs +v).
  bijna(boog.vanRad, 0, 1e-9, 'dicht');
  bijna(boog.totRad, Math.PI / 2, 1e-9, 'open');
  assert.equal(boog.tegenKlok, false);
});

test('scharnier rechts en naar buiten draaien spiegelen het blad', () => {
  const L = deurbladBreedte({ vanU: 67, totU: 863 });
  const rechtsBinnen = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'plus', draaiNaar: 'binnen' });
  const b1 = rechtsBinnen.find((v) => v.rol === 'draaicirkel');
  bijna(b1.midden.u, 863 + 17 - 2, 1e-9, 'scharnier rechts');
  bijna(b1.vanRad, Math.PI, 1e-9, 'dicht langs -u');
  bijna(b1.totRad, Math.PI / 2, 1e-9, 'open langs +v');
  assert.equal(b1.tegenKlok, true);

  const linksBuiten = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'min', draaiNaar: 'buiten' });
  const b2 = linksBuiten.find((v) => v.rol === 'draaicirkel');
  bijna(b2.midden.v, 0, 1e-9, 'scharnier op het buitenvlak');
  const o = omhulling(linksBuiten.find((v) => v.rol === 'deurblad').punten);
  bijna(o.vMin, -L, 1e-9, 'blad naar buiten');
  bijna(o.vMax, 0, 1e-9);
  bijna(b2.totRad, -Math.PI / 2, 1e-9);
  assert.equal(b2.tegenKlok, true);
});

test('een halfopen deur (45°) en eenvoudig: het blad als lijn', () => {
  const vormen = deurVormen({ vanU: 0, totU: 800, diepteMm: 100, hoekGraden: 45, detail: 'eenvoudig' });
  const blad = vormen.find((v) => v.rol === 'deurblad');
  assert.equal(blad.soort, 'lijn');
  const boog = vormen.find((v) => v.rol === 'draaicirkel');
  bijna(boog.totRad - boog.vanRad, Math.PI / 4, 1e-9, '45°');
});

test('vast raam is glas in het kozijn; een draairaam krijgt raamhout en een draaiaanduiding', () => {
  const vast = raamVormen({ vanU: 67, totU: 1133, diepteMm: 114, type: 'fixed' });
  assert.ok(!vast.some((v) => v.rol === 'raamhout'));
  assert.ok(!vast.some((v) => v.rol === 'draaicirkel'), 'een vast raam zonder aanduiding');
  assert.equal(vast.filter((v) => v.rol === 'glas').length, 2);

  const draai = raamVormen({ vanU: 67, totU: 1133, diepteMm: 114, type: 'turn', scharnier: 'min' });
  const raamhout = draai.filter((v) => v.rol === 'raamhout');
  assert.equal(raamhout.length, 2, 'twee stijlen raamhout');
  for (const r of raamhout) {
    const o = omhulling(r.punten);
    bijna(o.vMax, 114, 1e-9, 'raamhout in de binnensponning');
    bijna(o.vMax - o.vMin, KOZIJN_STANDAARD.raamhoutDiepteMm, 1e-9, 'diepte raamhout');
  }
  // Standaard GEEN draaicirkel: op een plattegrond leest een kwartcirkel
  // als een deur; de draairichting van een raam hoort in het aanzicht.
  assert.ok(!draai.some((v) => v.rol === 'draaicirkel'), 'draairaam zonder aanduiding tenzij gevraagd');
  const getoond = raamVormen({ vanU: 67, totU: 1133, diepteMm: 114, type: 'turn', scharnier: 'min', toonDraairichting: true });
  const boog = getoond.find((v) => v.rol === 'draaicirkel');
  assert.ok(boog, 'met toonDraairichting: draaicirkel');
  assert.ok(Array.isArray(boog.streep), 'gestreept, anders leest het als een deur');
  assert.equal(draai.filter((v) => v.rol === 'glas').length, 2);

  const kiep = raamVormen({ vanU: 67, totU: 1133, diepteMm: 114, type: 'tilt' });
  assert.equal(kiep.filter((v) => v.rol === 'raamhout').length, 2);
  assert.ok(!kiep.some((v) => v.rol === 'draaicirkel'), 'klep/tuimel draaien niet de ruimte in');
});

test('dicht paneel: een vlak in de sponning', () => {
  const vormen = dichtPaneelVormen({ vanU: 0, totU: 600, diepteMm: 114 });
  assert.equal(vormen.length, 1);
  assert.equal(vormen[0].rol, 'paneel');
  const o = omhulling(vormen[0].punten);
  assert.ok(o.uMin < 0 && o.uMax > 600, 'in de sponning');
});

test('detailniveau volgt de papiermaat: 1:50 vol, 1:100 eenvoudig', () => {
  assert.equal(kozijnDetail(2.8346 / 50), 'vol');
  assert.equal(kozijnDetail(2.8346 / 20), 'vol');
  assert.equal(kozijnDetail(2.8346 / 100), 'eenvoudig');
  assert.equal(kozijnDetail(0), 'eenvoudig');
});

test('omhullende van vormen telt de boog mee', () => {
  const vormen = deurVormen({ vanU: 0, totU: 800, diepteMm: 100, scharnier: 'min', draaiNaar: 'binnen' });
  const o = vormenOmhullende(vormen);
  const L = deurbladBreedte({ vanU: 0, totU: 800 });
  bijna(o.vMax, 100 + L, 1e-6, 'tot het eind van de boog');
  bijna(o.uMax, -17 + 2 + L, 1e-6, 'dicht reikt de boog tot de overkant');
});

test('vormen naar tekenopdrachten: schaal, verschuiving en spiegeling', () => {
  const vormen = [
    { soort: 'vlak', rol: 'stijl', punten: [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 20 }] },
    { soort: 'lijn', rol: 'glas', van: { u: 0, v: 5 }, tot: { u: 10, v: 5 } },
    { soort: 'boog', rol: 'draaicirkel', midden: { u: 0, v: 20 }, straal: 10, vanRad: 0, totRad: Math.PI / 2, tegenKlok: false },
  ];
  const recht = vormenNaarTekenopdrachten(vormen, { x0: 100, y0: 200, ptPerMm: 0.5 });
  assert.deepEqual(recht[0].points, [{ x: 100, y: 200 }, { x: 105, y: 200 }, { x: 105, y: 210 }]);
  assert.equal(recht[0].kind, 'polyline');
  assert.equal(recht[0].close, true);
  assert.equal(recht[0].fill, '#ffffff', 'doorsnede wit gevuld');
  assert.equal(recht[1].kind, 'line');
  assert.ok(recht[1].lineWidthFactor < 1, 'glas dunner dan de doorsnede');
  assert.deepEqual([recht[2].cx, recht[2].cy, recht[2].r], [100, 210, 5]);
  assert.equal(recht[2].ccw, false);

  // Gespiegeld: de binnenzijde (grote v) komt bovenaan.
  const spiegel = vormenNaarTekenopdrachten(vormen, { x0: 100, y0: 200, ptPerMm: 0.5, spiegelV: true, vMax: 20 });
  assert.deepEqual(spiegel[0].points, [{ x: 100, y: 210 }, { x: 105, y: 210 }, { x: 105, y: 200 }]);
  assert.equal(spiegel[2].cy, 200);
  bijna(spiegel[2].a1, -Math.PI / 2, 1e-12, 'hoek gespiegeld');
  assert.equal(spiegel[2].ccw, true, 'draairichting gespiegeld');
});

test('scharnier begin/eind (kader-object) is hetzelfde als min/plus', () => {
  const eind = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'eind' });
  const plus = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'plus' });
  assert.deepEqual(eind, plus);
  const begin = deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'begin' });
  assert.deepEqual(begin, deurVormen({ vanU: 67, totU: 863, diepteMm: 114, scharnier: 'min' }));
});
