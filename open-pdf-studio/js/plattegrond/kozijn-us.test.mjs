// Het Amerikaanse plansymbool voor een deur en een raam (#1230).
//
// Op een blad in voet of inch tekent een deur als blad met draaicirkel
// (geen kozijnhout) en een raam als de twee wandvlakken over de opening, een
// dagkant aan elk eind en één glaslijn op het hart van de wand. De stijl staat
// in het symbool (params.symboolStijl). Een metrisch symbool, zonder die
// sleutel, blijft precies het kozijn dat het was: dat staat hier vastgelegd.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  kozijnMaten, kozijnIndeling, kozijnTekenopdrachten, heeftKozijnOpbouw, isUsSymbool, SYMBOOL_STIJL_US,
} from './kozijn.js';
import { standaardOpeningBreedteMm } from './opening-breedte.js';
import { OPENING_STANDAARD_IMPERIAAL, leesBreedteMm, breedteLabel } from './blad-conventie.js';
import { doorTemplate } from '../symbols/templates/door.js';
import { windowTemplate } from '../symbols/templates/window.js';

const INCH = 25.4;
const bijna = (a, b, wat = '', tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const rollen = (vormen) => vormen.map((v) => `${v.soort}:${v.rol}`);
const rp = (p) => [Math.round(p.u * 1000) / 1000, Math.round(p.v * 1000) / 1000];
const lijn = (v) => [...rp(v.van), ...rp(v.tot)];

// Een wand van 6 inch, een deur van 36 en een raam van 48 inch.
const T = 152.4;
const usDeur = (extra = {}) => ({ width: 914.4, wallThickness: T, symboolStijl: 'us', swing: 'left', draaiNaar: 'binnen', angle: 90, ...extra });
const usRaam = (extra = {}) => ({ width: 1219.2, wallThickness: T, symboolStijl: 'us', type: 'fixed', ...extra });

test('de standaardbreedte: 36 en 48 inch op een blad in voet of inch, 900 en 1200 mm metrisch', () => {
  assert.equal(standaardOpeningBreedteMm('door', true), 914.4);
  assert.equal(standaardOpeningBreedteMm('window', true), 1219.2);
  assert.equal(standaardOpeningBreedteMm('door', false), 900);
  assert.equal(standaardOpeningBreedteMm('window', false), 1200);
  assert.equal(standaardOpeningBreedteMm('deur', true), 914.4, 'ook met de Nederlandse soortnaam');
  assert.equal(standaardOpeningBreedteMm('raam', false), 1200);
  assert.equal(standaardOpeningBreedteMm('onzin', false), 900, 'onbekend telt als deur');
  assert.equal(breedteLabel(standaardOpeningBreedteMm('door', true), true), '36"');
  assert.equal(breedteLabel(standaardOpeningBreedteMm('window', true), true), '48"');
});

test('een getypte breedte: op een voetblad is een kaal getal inches, metrisch millimeters', () => {
  // De stappen van het acceptatiecriterium: 3'-0" geeft een deur van 36 inch, 32 een van 32 inch.
  assert.equal(leesBreedteMm('3\'-0"', true), 914.4);
  assert.equal(leesBreedteMm('32', true), 32 * INCH);
  assert.equal(leesBreedteMm('2\'-8"', true), 32 * INCH);
  assert.equal(breedteLabel(leesBreedteMm('32', true), true), '32"');
  // Dezelfde toetsen op een metrisch blad: een kaal getal is millimeters;
  // een voet-inchmaat wordt ook daar exact omgerekend.
  assert.equal(leesBreedteMm('32', false), 32);
  assert.equal(leesBreedteMm('1000', false), 1000);
  assert.equal(leesBreedteMm('3\'-0"', false), 914.4);
  assert.equal(breedteLabel(1000, false), '1000 mm');
  // Onzin is geen breedte.
  for (const tekst of ['', 'abc', '0', '-5']) assert.equal(leesBreedteMm(tekst, true), null, tekst);
});

test('Amerikaanse deur: alleen een blad en een draaicirkel, geen kozijnhout', () => {
  const { maten, vormen, vak } = kozijnIndeling('deur', usDeur());
  assert.equal(maten.stijl, 'us');
  assert.deepEqual(rollen(vormen), ['vlak:deurblad', 'boog:draaicirkel'], 'geen stijlen, geen sponning');
  const [blad, boog] = vormen;
  // Het blad: 1-3/4 inch dik, zo breed als de opening, 90 graden open,
  // scharnierend op de dagkant (u = 0) aan het wandvlak (v = T).
  assert.deepEqual(blad.punten.map(rp), [[0, T], [0, T + 914.4], [44.45, T + 914.4], [44.45, T]].map(([u, v]) => rp({ u, v })));
  assert.equal(maten.deurbladDikteMm, OPENING_STANDAARD_IMPERIAAL.deur.bladDikteMm);
  // De draaicirkel: om het scharnier, straal = de deurbreedte, van de andere
  // dagkant (hoek 0: het dichte blad) tot het open blad (90 graden).
  assert.deepEqual(rp(boog.midden), rp({ u: 0, v: T }));
  bijna(boog.straal, 914.4, 'straal');
  bijna(boog.vanRad, 0, 'begint bij de andere dagkant');
  bijna(boog.totRad, Math.PI / 2, 'eindigt bij het open blad');
  // Het vak: de opening breed, de wand plus de draaicirkel diep.
  assert.deepEqual([vak.uMin, vak.uMax, vak.vMin], [0, 914.4, 0]);
  bijna(vak.vMax, T + 914.4, 'vak');
});

test('Amerikaanse deur: scharnierkant en draairichting', () => {
  // Rechtsdraaiend: het scharnier op de andere dagkant, de boog terug naar u = 0.
  const rechts = kozijnIndeling('deur', usDeur({ swing: 'right' })).vormen;
  assert.deepEqual(rp(rechts[1].midden), rp({ u: 914.4, v: T }));
  bijna(rechts[1].vanRad, Math.PI, 'het dichte blad wijst naar u = 0');
  assert.deepEqual(rechts[0].punten.map(rp)[0], rp({ u: 914.4, v: T }));
  bijna(Math.min(...rechts[0].punten.map((p) => p.u)), 914.4 - 44.45, 'het blad staat binnen de opening');
  // Naar buiten draaiend: scharnier op het buitenvlak (v = 0), het blad naar de andere kant.
  const buiten = kozijnIndeling('deur', usDeur({ draaiNaar: 'buiten' }));
  assert.equal(buiten.vormen[1].midden.v, 0);
  bijna(buiten.vak.vMin, -914.4, 'het vak groeit naar de buitenkant');
  bijna(buiten.vak.vMax, T, 'tot het binnenvlak');
  // Een eigen bladdikte en openingshoek blijven mogelijk.
  const eigen = kozijnIndeling('deur', usDeur({ deurbladDikteMm: 35, angle: 45 }));
  assert.equal(eigen.maten.deurbladDikteMm, 35);
  bijna(eigen.vormen[1].totRad, Math.PI / 4, 'openingshoek');
});

test('Amerikaans raam: twee wandvlakken, twee dagkanten en één glaslijn op het hart', () => {
  const { vormen, vak } = kozijnIndeling('raam', usRaam());
  assert.deepEqual(rollen(vormen), ['lijn:wandvlak', 'lijn:wandvlak', 'lijn:wandvlak', 'lijn:wandvlak', 'lijn:glas']);
  const [buiten, binnen, dagVan, dagTot, glas] = vormen.map(lijn);
  assert.deepEqual(buiten, [0, 0, 1219.2, 0], 'het buitenvlak loopt door over de opening');
  assert.deepEqual(binnen, [0, T, 1219.2, T], 'het binnenvlak ook');
  assert.deepEqual(dagVan, [0, 0, 0, T], 'dagkant aan het begin');
  assert.deepEqual(dagTot, [1219.2, 0, 1219.2, T], 'dagkant aan het eind');
  assert.deepEqual(glas, [0, T / 2, 1219.2, T / 2], 'het glas op het hart van de wand');
  assert.deepEqual(vak, { uMin: 0, uMax: 1219.2, vMin: 0, vMax: T });
  // Het raamtype en de borstwering van het kozijn spelen hier niet mee.
  assert.deepEqual(kozijnIndeling('raam', usRaam({ type: 'turn', borstweringMm: 900, draairichtingTonen: true })).vormen, vormen);
});

test('het symbool tekent wat de indeling zegt, binnen zijn vak', () => {
  // Deur: vak van de opening breed en wand + draaicirkel hoog, op 1/4" = 1'-0" (1:48).
  const k = 72 / (48 * INCH);
  const { vak } = kozijnIndeling('deur', usDeur());
  const bbox = { x: 100, y: 200, width: (vak.uMax - vak.uMin) * k, height: (vak.vMax - vak.vMin) * k };
  const deur = doorTemplate.render(usDeur(), bbox);
  assert.deepEqual(deur.map((c) => c.kind), ['polyline', 'arc'], 'een blad en een boog');
  assert.equal(deur[0].close, true);
  for (const p of deur[0].points) {
    assert.ok(p.x >= bbox.x - 1e-6 && p.x <= bbox.x + bbox.width + 1e-6 && p.y >= bbox.y - 1e-6 && p.y <= bbox.y + bbox.height + 1e-6);
  }
  bijna(deur[1].r, 914.4 * k, 'de boog heeft de deurbreedte als straal');
  // Raam: vijf lijnen, de buitenste op de rand van het vak, het glas halverwege.
  const rbox = { x: 0, y: 0, width: 1219.2 * k, height: T * k };
  const raam = windowTemplate.render(usRaam(), rbox);
  assert.deepEqual(raam.map((c) => c.kind), ['line', 'line', 'line', 'line', 'line']);
  const horizontaal = raam.filter((c) => Math.abs(c.y1 - c.y2) < 1e-9).map((c) => Math.round(c.y1 * 1000) / 1000).sort((a, b) => a - b);
  assert.deepEqual(horizontaal, [0, Math.round((T * k / 2) * 1000) / 1000, Math.round(T * k * 1000) / 1000]);
  assert.equal(raam.filter((c) => Math.abs(c.x1 - c.x2) < 1e-9).length, 2, 'twee dagkanten');
  // De glaslijn is dunner dan de wandlijnen.
  assert.ok(raam[4].lineWidthFactor < raam[0].lineWidthFactor);
});

test('op een kleine schaal is het deurblad een lijn', () => {
  const k = 72 / (96 * INCH);                      // 1/8" = 1'-0"
  const { vak } = kozijnIndeling('deur', usDeur());
  const deur = kozijnTekenopdrachten('deur', usDeur(), { x: 0, y: 0, width: (vak.uMax - vak.uMin) * k, height: (vak.vMax - vak.vMin) * k });
  assert.deepEqual(deur.map((c) => c.kind), ['line', 'arc']);
});

test('de stijl staat in het symbool: zonder de sleutel is het een kozijn', () => {
  assert.equal(SYMBOOL_STIJL_US, 'us');
  assert.equal(isUsSymbool({ symboolStijl: 'us' }), true);
  assert.equal(isUsSymbool({ symboolStijl: 'nen' }), false);
  assert.equal(isUsSymbool({}), false);
  assert.equal(isUsSymbool(null), false);
  // Een Amerikaans raam heeft geen kozijnhout nodig om de nieuwe tekening te krijgen.
  assert.equal(heeftKozijnOpbouw({ width: 1219.2, wallThickness: T, symboolStijl: 'us' }, 'raam'), true);
  assert.equal(heeftKozijnOpbouw({ width: 1200, wallThickness: 240, type: 'fixed' }, 'raam'), false, 'een oud raam blijft oud');
  assert.equal(kozijnMaten('deur', { width: 900, wallThickness: 100 }).stijl, 'nen');
});

test('metrisch blijft het kozijn precies wat het was', () => {
  // Deur 900 in een wand van 100, raam 1200 in een wand van 300: de vormen
  // en maten zoals ze vóór #1230 waren (hier vastgelegd).
  const deur = kozijnIndeling('deur', { width: 900, wallThickness: 100 });
  assert.deepEqual(rollen(deur.vormen), ['vlak:stijl', 'vlak:stijl', 'vlak:deurblad', 'boog:draaicirkel']);
  assert.equal(deur.maten.deurbladDikteMm, 40);
  assert.deepEqual([deur.maten.stijlBreedteMm, deur.maten.stijlDiepteMm], [67, 100]);
  assert.deepEqual(deur.vak, { uMin: 0, uMax: 900, vMin: 0, vMax: 896 });
  bijna(deur.vormen[3].straal, 796, 'het blad valt in de sponningen: 900 - 2 x 67 + 2 x (17 - 2)');
  const raam = kozijnIndeling('raam', { width: 1200, wallThickness: 300, stijlBreedteMm: 67, borstweringMm: 850 });
  assert.deepEqual(rollen(raam.vormen), [
    'vlak:stijl', 'vlak:stijl', 'lijn:glas', 'lijn:glas', 'vlak:glaslat', 'vlak:glaslat', 'lijn:aanzicht', 'lijn:aanzicht',
  ]);
  assert.deepEqual(raam.vak, { uMin: 0, uMax: 1200, vMin: 0, vMax: 300 });
  // 'nen' of een onbekende waarde in de sleutel is hetzelfde als geen sleutel.
  for (const stijl of ['nen', 'iets', '']) {
    assert.deepEqual(kozijnIndeling('deur', { width: 900, wallThickness: 100, symboolStijl: stijl }), deur);
  }
  // Het symbool zelf: twee gevulde stijlen, het blad en de boog.
  const cmds = doorTemplate.render({ width: 900, wallThickness: 100 }, { x: 0, y: 0, width: 45, height: 44.8 });
  assert.deepEqual(cmds.map((c) => c.kind), ['polyline', 'polyline', 'polyline', 'arc']);
});

test('de sjablonen tonen de stijl niet als eigen veld: een metrisch symbool krijgt geen nieuwe parameter', () => {
  for (const sjabloon of [doorTemplate, windowTemplate]) {
    assert.equal(sjabloon.params.some((p) => p.key === 'symboolStijl'), false);
  }
  // En de sjablonen tekenen beide stijlen via dezelfde ingang.
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  assert.match(lees('../symbols/templates/door.js'), /kozijnTekenopdrachten\('deur', params, bbox\)/);
  assert.match(lees('../symbols/templates/window.js'), /kozijnTekenopdrachten\('raam', params, bbox\)/);
});

test('het gereedschap Deur / Raam in wand gebruikt de gedeelde regels voor breedte en invoer', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const tool = lees('../tools/tools/wall-opening-tool.js');
  // De standaardbreedte en de getypte breedte komen van de ene plek waar de regel staat.
  assert.match(tool, /standaardOpeningBreedteMm\(kind, imperial\)/);
  assert.match(tool, /leesBreedteMm\(text, _imperial\(\)\)/, 'een kaal getal: inches op een voetblad, anders millimeters');
  assert.match(tool, /isImperiaalBladOpPunt\(_session\.page, _session\.x, _session\.y\)/, 'de conventie op het punt van de muis');
  assert.match(tool, /breedteLabel\(_widthMm\(kind, imperial\), imperial\)/, 'de aanwijzing toont de huidige breedte');
  // De invoer is de toetsenbuffer van de lijngereedschappen, geen eigen veld.
  assert.match(tool, /enterTypeLengthMode\(0, 0\)/);
  assert.match(tool, /state\._typeLengthCommit = _commitTypedWidth/);
  // Zonder getypte breedte beslist het blad onder de klik (en daarmee het symbool).
  assert.match(tool, /_session\.widthMm != null \? \{ widthMm: _session\.widthMm \} : \{\}/);
  assert.match(lees('../solid/components/TypeLengthHUD.jsx'), /case 'wallDoor':\s+case 'wallWindow':\s+return 'type width \+ Enter';/);
  // app_floorplan gebruikt dezelfde standaardbreedte.
  assert.match(lees('./mcp-plattegrond.js'), /standaardOpeningBreedteMm\(soort, imperiaal\)/);
});
