// Schaal en plek van de pagina op het vel: dezelfde regel voor het voorbeeld
// in de printdialoog en voor de printopdracht.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHALINGEN, ZOOM_MIN, ZOOM_MAX, AFSNIJ_SPELING_MM,
  geldigeZoom, velOrientatie, schaalFactor, berekenPlaatsing, renderDeel, pdfPagina,
  GEEN_MARGES, margesVoor,
  PRINT_DPI, printPxPerPt, voegPrintPaginaToe,
  DRAAIING_HAAKS, haaksOpVel, ongedraaidDeel,
} from './print-plaatsing.js';
import { PAPIERFORMATEN } from './print-pagina-instelling.js';

const MM = 72 / 25.4; // pt per mm
const pt = (mm) => mm * MM;
const pagina = (bMm, hMm) => ({ breedtePt: pt(bMm), hoogtePt: pt(hMm) });
const vel = (sleutel) => ({ breedteMm: PAPIERFORMATEN[sleutel].breedte, hoogteMm: PAPIERFORMATEN[sleutel].hoogte });

const A4 = pagina(210, 297);
const A4_LIGGEND = pagina(297, 210);
const A1_LIGGEND = pagina(841, 594);

function bijna(werkelijk, verwacht, speling = 1e-6, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

function rechthoek(r, [x, y, b, h], speling = 1e-6) {
  bijna(r.x, x, speling, 'x');
  bijna(r.y, y, speling, 'y');
  bijna(r.breedte, b, speling, 'breedte');
  bijna(r.hoogte, h, speling, 'hoogte');
}

function plaats(opties) {
  return berekenPlaatsing({ orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true, ...opties });
}

// --- hulpregels ----------------------------------------------------------------

test('zoom: begrensd op 10..400, hele procenten, onzin wordt 100', () => {
  assert.equal(geldigeZoom(50), 50);
  assert.equal(geldigeZoom(10), ZOOM_MIN);
  assert.equal(geldigeZoom(5), ZOOM_MIN);
  assert.equal(geldigeZoom(0), ZOOM_MIN);
  assert.equal(geldigeZoom(-20), ZOOM_MIN);
  assert.equal(geldigeZoom(400), ZOOM_MAX);
  assert.equal(geldigeZoom(1000), ZOOM_MAX);
  assert.equal(geldigeZoom(33.4), 33);
  assert.equal(geldigeZoom('75'), 75);
  for (const onzin of [NaN, Infinity, undefined, null, 'abc', {}]) {
    assert.equal(geldigeZoom(onzin), 100, String(onzin));
  }
});

test('oriëntatie van het vel: gevraagd wint, auto volgt de pagina', () => {
  assert.equal(velOrientatie('landscape', A4.breedtePt, A4.hoogtePt), 'landscape');
  assert.equal(velOrientatie('portrait', A4_LIGGEND.breedtePt, A4_LIGGEND.hoogtePt), 'portrait');
  assert.equal(velOrientatie('auto', A4_LIGGEND.breedtePt, A4_LIGGEND.hoogtePt), 'landscape');
  assert.equal(velOrientatie('auto', A4.breedtePt, A4.hoogtePt), 'portrait');
  assert.equal(velOrientatie('auto', 500, 500), 'portrait');
  assert.equal(velOrientatie(undefined, A4_LIGGEND.breedtePt, A4_LIGGEND.hoogtePt), 'landscape');
});

test('schaalfactor per type; onbekend type is passend', () => {
  assert.equal(schaalFactor('fit', 50, 2.5), 2.5);
  assert.equal(schaalFactor('fit', 50, 0.4), 0.4);
  assert.equal(schaalFactor('actual', 50, 0.4), 1);
  assert.equal(schaalFactor('shrink', 50, 0.4), 0.4);
  assert.equal(schaalFactor('shrink', 50, 2.5), 1);
  assert.equal(schaalFactor('custom-scale', 50, 2.5), 0.5);
  assert.equal(schaalFactor('custom-scale', 1000, 2.5), 4);
  assert.equal(schaalFactor('iets anders', 50, 0.7), 0.7);
  assert.deepEqual([...SCHALINGEN], ['fit', 'actual', 'shrink', 'custom-scale']);
});

// --- het geval van de melding: A1, pagina 841 x 594 mm, aangepaste schaal 10 % ---

test('A1-papier, liggende A1-pagina, aangepaste schaal 10 %: een tiende, gecentreerd op een liggend vel', () => {
  const p = plaats({ papier: vel('a1'), pagina: A1_LIGGEND, schaling: 'custom-scale', zoom: 10 });
  assert.equal(p.bekend, true);
  assert.deepEqual(p.vel, { breedteMm: 841, hoogteMm: 594, orientatie: 'landscape' });
  bijna(p.schaal, 0.1);
  rechthoek(p.pagina, [(841 - 84.1) / 2, (594 - 59.4) / 2, 84.1, 59.4]);
  rechthoek(p.zichtbaar, [(841 - 84.1) / 2, (594 - 59.4) / 2, 84.1, 59.4]);
  rechthoek(p.bron, [0, 0, pt(841), pt(594)], 1e-6);
  assert.equal(p.afgesneden, false);
});

test('A1-papier, zelfde pagina, passend: vult het vel', () => {
  const p = plaats({ papier: vel('a1'), pagina: A1_LIGGEND, schaling: 'fit' });
  bijna(p.schaal, 1);
  rechthoek(p.pagina, [0, 0, 841, 594]);
  assert.equal(p.afgesneden, false);
});

// --- A4-pagina op A3-papier: de vier typen ------------------------------------

test('A4 op A3, werkelijke grootte: 1:1 en gecentreerd', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'actual' });
  assert.deepEqual(p.vel, { breedteMm: 297, hoogteMm: 420, orientatie: 'portrait' });
  assert.equal(p.schaal, 1);
  rechthoek(p.pagina, [43.5, 61.5, 210, 297]);
  assert.equal(p.afgesneden, false);
});

test('A4 op A3, passend: vergroot tot het vel (vergroten mag)', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'fit' });
  const s = Math.min(297 / 210, 420 / 297);
  bijna(p.schaal, s);
  rechthoek(p.pagina, [(297 - 210 * s) / 2, 0, 210 * s, 420]);
  assert.ok(p.pagina.breedte > 296.9 && p.pagina.breedte <= 297);
  assert.equal(p.afgesneden, false);
});

test('A4 op A3, verkleinen: past al, dus ware grootte', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'shrink' });
  assert.equal(p.schaal, 1);
  rechthoek(p.pagina, [43.5, 61.5, 210, 297]);
});

test('A4 op A3, aangepaste schaal 50 % en 10 %', () => {
  const half = plaats({ papier: vel('a3'), pagina: A4, schaling: 'custom-scale', zoom: 50 });
  bijna(half.schaal, 0.5);
  rechthoek(half.pagina, [96, 135.75, 105, 148.5]);
  const tiende = plaats({ papier: vel('a3'), pagina: A4, schaling: 'custom-scale', zoom: 10 });
  bijna(tiende.schaal, 0.1);
  rechthoek(tiende.pagina, [138, 195.15, 21, 29.7]);
});

test('zoom telt alleen bij aangepaste schaal', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'actual', zoom: 10 });
  assert.equal(p.schaal, 1);
});

test('niet centreren: linksboven op het vel', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'custom-scale', zoom: 50, centreren: false });
  rechthoek(p.pagina, [0, 0, 105, 148.5]);
  const passend = plaats({ papier: vel('a3'), pagina: A4_LIGGEND, orientatie: 'portrait', centreren: false });
  // Liggende pagina op een staand vel: een kwartslag gedraaid, passend, linksboven.
  assert.equal(passend.gedraaid, true);
  bijna(passend.schaal, 420 / 297);
  rechthoek(passend.pagina, [0, 0, 210 * (420 / 297), 420]);
});

// --- oriëntatie ---------------------------------------------------------------

test('auto: een liggende pagina krijgt een liggend vel; staand gevraagd blijft staand', () => {
  const auto = plaats({ papier: vel('a3'), pagina: A4_LIGGEND, schaling: 'actual' });
  assert.deepEqual(auto.vel, { breedteMm: 420, hoogteMm: 297, orientatie: 'landscape' });
  rechthoek(auto.pagina, [61.5, 43.5, 297, 210]);
  const staand = plaats({ papier: vel('a3'), pagina: A4_LIGGEND, schaling: 'actual', orientatie: 'portrait' });
  assert.deepEqual(staand.vel, { breedteMm: 297, hoogteMm: 420, orientatie: 'portrait' });
  // De pagina ligt een kwartslag gedraaid op het staande vel: 210 x 297 mm, gecentreerd.
  assert.equal(staand.gedraaid, true);
  rechthoek(staand.pagina, [43.5, 61.5, 210, 297]);
});

// --- haaks op het vel: een kwartslag linksom ------------------------------------

test('haaks: alleen liggend op staand of staand op liggend; vierkant nooit', () => {
  assert.equal(haaksOpVel(297, 210, 210, 297), true);
  assert.equal(haaksOpVel(210, 297, 297, 210), true);
  assert.equal(haaksOpVel(210, 297, 210, 297), false);
  assert.equal(haaksOpVel(297, 210, 420, 297), false);
  assert.equal(haaksOpVel(200, 200, 210, 297), false);
  assert.equal(haaksOpVel(297, 210, 300, 300), false);
  for (const onzin of [NaN, 0, -1, undefined]) assert.equal(haaksOpVel(onzin, 210, 210, 297), false);
  // Een kwartslag linksom, genoteerd zoals /Rotate: graden met de klok mee.
  assert.equal(DRAAIING_HAAKS, 270);
});

test('haaks: staande pagina op een handmatig liggend vel vult het vel', () => {
  const p = plaats({ papier: vel('a4'), pagina: A4, orientatie: 'landscape' });
  assert.deepEqual(p.vel, { breedteMm: 297, hoogteMm: 210, orientatie: 'landscape' });
  assert.equal(p.gedraaid, true);
  assert.equal(p.draaiing, DRAAIING_HAAKS);
  bijna(p.schaal, 1);
  rechthoek(p.pagina, [0, 0, 297, 210]);
  // De pagina zoals ze op het vel ligt: breedte en hoogte gewisseld.
  bijna(p.paginaPt.breedtePt, A4.hoogtePt);
  bijna(p.paginaPt.hoogtePt, A4.breedtePt);
  rechthoek(p.bron, [0, 0, A4.hoogtePt, A4.breedtePt], 1e-6);
  assert.equal(p.afgesneden, false);
});

test('haaks: auto draait nooit (het vel volgt de pagina), vierkant ook niet', () => {
  for (const pag of [A4, A4_LIGGEND, A1_LIGGEND]) {
    const p = plaats({ papier: vel('a3'), pagina: pag });
    assert.equal(p.gedraaid, false);
    assert.equal(p.draaiing, 0);
    assert.deepEqual(p.paginaPt, pag);
  }
  const vierkant = plaats({ papier: vel('a4'), pagina: pagina(200, 200), orientatie: 'landscape' });
  assert.equal(vierkant.gedraaid, false);
  // Onbekend papier: de pagina is het vel, dus nooit haaks.
  const onbekend = plaats({ papier: null, pagina: A4, orientatie: 'landscape' });
  assert.equal(onbekend.gedraaid, false);
  assert.equal(onbekend.draaiing, 0);
});

test('haaks: de marges van het liggende vel gelden, de pagina past gedraaid in het gebied', () => {
  const drie = { links: 3, boven: 3, rechts: 3, onder: 3 };
  const papier = { ...vel('a4'), bedrukbaar: { staand: drie, liggend: { links: 5, boven: 3, rechts: 5, onder: 3 } } };
  const p = plaats({ papier, pagina: A4, orientatie: 'landscape' });
  assert.equal(p.gedraaid, true);
  assert.deepEqual(p.marges, { links: 5, boven: 3, rechts: 5, onder: 3 });
  // Gedraaid is de pagina 297 x 210; het vak is 287 x 204 → de hoogte beslist.
  bijna(p.schaal, Math.min(287 / 297, 204 / 210));
  assert.equal(p.buitenBedrukbaar, false);
});

test('ongedraaidDeel: van het beeld op het vel terug naar de pixels van de pagina', () => {
  // Niet gedraaid: hetzelfde deel.
  const recht = plaats({ papier: vel('a3'), pagina: A4, schaling: 'actual' });
  const d = renderDeel(recht, 2);
  assert.deepEqual(ongedraaidDeel(recht, 2, d.px), d.px);

  // Gedraaid, hele pagina: breedte en hoogte gewisseld, vanaf (0, 0).
  const p = plaats({ papier: vel('a4'), pagina: A4, orientatie: 'landscape' });
  const pxPerPt = 2;
  const heel = renderDeel(p, pxPerPt);
  const volB = Math.ceil(A4.breedtePt * pxPerPt - 1e-6);
  const volH = Math.ceil(A4.hoogtePt * pxPerPt - 1e-6);
  assert.deepEqual(heel.px, { x: 0, y: 0, breedte: volH, hoogte: volB });
  assert.deepEqual(ongedraaidDeel(p, pxPerPt, heel.px), { x: 0, y: 0, breedte: volB, hoogte: volH });

  // Een kwartslag linksom: de bovenrand van de pagina ligt links op het vel.
  // Een strook links op het vel (x' 0..10) is dus de bovenste strook van de
  // pagina (y 0..10); een strook boven op het vel (y' 0..10) de rechterstrook.
  assert.deepEqual(
    ongedraaidDeel(p, pxPerPt, { x: 0, y: 0, breedte: 10, hoogte: volB }),
    { x: 0, y: 0, breedte: volB, hoogte: 10 },
  );
  assert.deepEqual(
    ongedraaidDeel(p, pxPerPt, { x: 0, y: 0, breedte: volH, hoogte: 10 }),
    { x: volB - 10, y: 0, breedte: 10, hoogte: volH },
  );
});

test('haaks en afgesneden: alleen het deel op het vel, in het gedraaide beeld', () => {
  // A3 staand op een handmatig liggend A4-vel, ware grootte: gedraaid 420 x 297 mm.
  const p = plaats({ papier: vel('a4'), pagina: pagina(297, 420), orientatie: 'landscape', schaling: 'actual' });
  assert.equal(p.gedraaid, true);
  assert.equal(p.afgesneden, true);
  rechthoek(p.pagina, [(297 - 420) / 2, (210 - 297) / 2, 420, 297]);
  rechthoek(p.bron, [pt(61.5), pt(43.5), pt(297), pt(210)], 1e-6);
});

test('het papier mag in elke volgorde binnenkomen', () => {
  const a = plaats({ papier: { breedteMm: 420, hoogteMm: 297 }, pagina: A4, schaling: 'actual' });
  const b = plaats({ papier: { breedteMm: 297, hoogteMm: 420 }, pagina: A4, schaling: 'actual' });
  assert.deepEqual(a, b);
});

test('passend met een andere verhouding: de korte kant beslist, de lange blijft vrij', () => {
  // A4 staand op A3L (297 x 630): passend op de breedte.
  const p = plaats({ papier: vel('a3l'), pagina: A4, schaling: 'fit' });
  const s = 297 / 210;
  bijna(p.schaal, s);
  rechthoek(p.pagina, [0, (630 - 297 * s) / 2, 297, 297 * s]);
});

// --- het bedrukbare gebied van de printer -------------------------------------

// Marges zoals printer_bedrukbaar ze meldt (gemeten op deze machine:
// de Brother 3 mm rondom, een netwerkprinter 3 mm op A4 en 4,2 mm op A3).
const rand = (mm) => ({ links: mm, boven: mm, rechts: mm, onder: mm });
const MARGES_3MM = { staand: rand(3), liggend: rand(3) };
const velMet = (sleutel, bedrukbaar) => ({ ...vel(sleutel), bedrukbaar });

test('marges: onbekend, onzin of onmogelijk telt als geen rand', () => {
  assert.equal(margesVoor(null, 'portrait', 210, 297), GEEN_MARGES);
  assert.equal(margesVoor({ staand: rand(3) }, 'landscape', 297, 210), GEEN_MARGES);
  assert.equal(margesVoor({ staand: { links: -1, boven: 0, rechts: 0, onder: 0 } }, 'portrait', 210, 297), GEEN_MARGES);
  assert.equal(margesVoor({ staand: { links: 3, boven: 3, rechts: 3 } }, 'portrait', 210, 297), GEEN_MARGES);
  // Zo scheef dat er gecentreerd niets overblijft (2 x 110 > 210).
  assert.equal(margesVoor({ staand: { links: 0, boven: 3, rechts: 110, onder: 3 } }, 'portrait', 210, 297), GEEN_MARGES);
  assert.deepEqual(margesVoor(MARGES_3MM, 'portrait', 210, 297), rand(3));
  assert.deepEqual(margesVoor(MARGES_3MM, 'landscape', 297, 210), rand(3));
});

test('passend blijft binnen het bedrukbare gebied en staat gecentreerd op het vel', () => {
  const p = plaats({ papier: velMet('a4', MARGES_3MM), pagina: A4, schaling: 'fit' });
  const s = Math.min((210 - 6) / 210, (297 - 6) / 297);
  bijna(p.schaal, s);
  rechthoek(p.pagina, [(210 - 210 * s) / 2, (297 - 297 * s) / 2, 210 * s, 297 * s]);
  rechthoek(p.bedrukbaar, [3, 3, 204, 291]);
  assert.equal(p.afgesneden, false);
  assert.equal(p.buitenBedrukbaar, false);
  // De pagina raakt de rand van het gebied, maar blijft erbinnen.
  assert.ok(p.pagina.x >= 3 - 1e-9 && p.pagina.x + p.pagina.breedte <= 207 + 1e-9);
  assert.ok(p.pagina.y >= 3 - 1e-9 && p.pagina.y + p.pagina.hoogte <= 294 + 1e-9);
});

test('passend met een scheve rand blijft aan beide kanten binnen het gebied', () => {
  // Links 3, rechts 10 mm: gecentreerd op het vel telt de grootste marge.
  const scheef = { staand: { links: 3, boven: 5, rechts: 10, onder: 12 }, liggend: rand(3) };
  const p = plaats({ papier: velMet('a4', scheef), pagina: A4, schaling: 'fit' });
  const s = Math.min((210 - 20) / 210, (297 - 24) / 297);
  bijna(p.schaal, s);
  assert.ok(p.pagina.x >= 3 && p.pagina.x + p.pagina.breedte <= 200, JSON.stringify(p.pagina));
  assert.ok(p.pagina.y >= 5 && p.pagina.y + p.pagina.hoogte <= 285, JSON.stringify(p.pagina));
  assert.equal(p.buitenBedrukbaar, false);
});

test('zonder centreren staan passend en verkleinen op de hoek van het bedrukbare gebied', () => {
  const p = plaats({ papier: velMet('a4', MARGES_3MM), pagina: A4, schaling: 'fit', centreren: false });
  const s = Math.min(204 / 210, 291 / 297);
  bijna(p.schaal, s);
  rechthoek(p.pagina, [3, 3, 210 * s, 297 * s]);
  assert.equal(p.buitenBedrukbaar, false);
  // Verkleinen van een pagina die al past: ware grootte, op dezelfde hoek.
  const klein = plaats({ papier: velMet('a4', MARGES_3MM), pagina: pagina(100, 100), schaling: 'shrink', centreren: false });
  assert.equal(klein.schaal, 1);
  rechthoek(klein.pagina, [3, 3, 100, 100]);
});

test('verkleinen verkleint tot het bedrukbare gebied, niet tot het vel', () => {
  const p = plaats({ papier: velMet('a4', MARGES_3MM), pagina: A4, schaling: 'shrink' });
  bijna(p.schaal, Math.min((210 - 6) / 210, (297 - 6) / 297));
  assert.ok(p.schaal < 1);
  assert.equal(p.buitenBedrukbaar, false);
});

test('ware grootte en aangepaste schaal blijven 1:1 op het vel en melden de rand', () => {
  const echt = plaats({ papier: velMet('a4', MARGES_3MM), pagina: A4, schaling: 'actual' });
  assert.equal(echt.schaal, 1);
  rechthoek(echt.pagina, [0, 0, 210, 297]);
  assert.equal(echt.afgesneden, false);
  assert.equal(echt.buitenBedrukbaar, true);
  // Een pagina die wél binnen het gebied past: geen melding.
  const klein = plaats({ papier: velMet('a4', MARGES_3MM), pagina: pagina(150, 200), schaling: 'actual' });
  assert.equal(klein.buitenBedrukbaar, false);
  const zoom = plaats({ papier: velMet('a4', MARGES_3MM), pagina: A4, schaling: 'custom-scale', zoom: 50 });
  bijna(zoom.schaal, 0.5);
  rechthoek(zoom.pagina, [52.5, 74.25, 105, 148.5]);
  assert.equal(zoom.buitenBedrukbaar, false);
});

test('zonder marges verandert er niets aan de oude uitkomsten', () => {
  const met = plaats({ papier: velMet('a3', { staand: rand(0), liggend: rand(0) }), pagina: A4, schaling: 'fit' });
  const zonder = plaats({ papier: vel('a3'), pagina: A4, schaling: 'fit' });
  assert.deepEqual(met.pagina, zonder.pagina);
  assert.equal(met.buitenBedrukbaar, false);
  rechthoek(zonder.bedrukbaar, [0, 0, 297, 420]);
  assert.deepEqual(zonder.marges, GEEN_MARGES);
});

test('de marges volgen de oriëntatie van het vel', () => {
  // Liggend een bredere rand aan de invoerkant.
  const anders = { staand: rand(3), liggend: { links: 3, boven: 10, rechts: 3, onder: 10 } };
  const staand = plaats({ papier: velMet('a4', anders), pagina: A4, schaling: 'fit' });
  const liggend = plaats({ papier: velMet('a4', anders), pagina: A4_LIGGEND, schaling: 'fit' });
  assert.deepEqual(staand.marges, rand(3));
  assert.deepEqual(liggend.marges, { links: 3, boven: 10, rechts: 3, onder: 10 });
  rechthoek(liggend.bedrukbaar, [3, 10, 297 - 6, 210 - 20]);
});

test('onbekend papier: geen gebied, geen melding', () => {
  const p = plaats({ papier: null, pagina: A4, schaling: 'fit' });
  assert.deepEqual(p.marges, GEEN_MARGES);
  rechthoek(p.bedrukbaar, [0, 0, 210, 297]);
  assert.equal(p.buitenBedrukbaar, false);
});

// --- groter dan het vel: afgesneden en gemeld -----------------------------------

test('A3-pagina op A4-papier op ware grootte: gecentreerd afgesneden en gemeld', () => {
  const p = plaats({ papier: vel('a4'), pagina: pagina(297, 420), schaling: 'actual' });
  assert.equal(p.afgesneden, true);
  rechthoek(p.pagina, [-43.5, -61.5, 297, 420]);
  rechthoek(p.zichtbaar, [0, 0, 210, 297]);
  // Het midden van de pagina is zichtbaar.
  rechthoek(p.bron, [pt(43.5), pt(61.5), pt(210), pt(297)], 1e-6);
});

test('niet gecentreerd en te groot: de linkerbovenhoek blijft, rechts en onder vallen weg', () => {
  const p = plaats({ papier: vel('a4'), pagina: pagina(297, 420), schaling: 'actual', centreren: false });
  assert.equal(p.afgesneden, true);
  rechthoek(p.zichtbaar, [0, 0, 210, 297]);
  rechthoek(p.bron, [0, 0, pt(210), pt(297)], 1e-6);
});

test('aangepaste schaal boven passend: afgesneden', () => {
  const p = plaats({ papier: vel('a4'), pagina: A4, schaling: 'custom-scale', zoom: 200 });
  assert.equal(p.afgesneden, true);
  rechthoek(p.pagina, [-105, -148.5, 420, 594]);
  rechthoek(p.bron, [pt(52.5), pt(74.25), pt(105), pt(148.5)], 1e-6);
});

test('passend en verkleinen snijden nooit af', () => {
  const groot = pagina(1189, 841);
  for (const schaling of ['fit', 'shrink']) {
    for (const orientatie of ['auto', 'portrait', 'landscape']) {
      const p = plaats({ papier: vel('a4'), pagina: groot, schaling, orientatie });
      assert.equal(p.afgesneden, false, `${schaling} ${orientatie}`);
    }
  }
});

test('afronding van papiermaten is geen afsnijden (Letter 216 x 279 in de lijst)', () => {
  const letterPagina = { breedtePt: 612, hoogtePt: 792 }; // 215,9 x 279,4 mm
  const p = plaats({ papier: vel('letter'), pagina: letterPagina, schaling: 'actual' });
  assert.equal(p.afgesneden, false);
  const netTeGroot = plaats({
    papier: vel('a4'), pagina: pagina(210 + 2 * AFSNIJ_SPELING_MM + 0.2, 297), schaling: 'actual',
  });
  assert.equal(netTeGroot.afgesneden, true);
});

// --- onbekend papier: gedrag van vóór de schaalkeuze ---------------------------

test('onbekend papier: de pagina is het vel, ongeacht type en zoom', () => {
  for (const papier of [null, undefined, { breedteMm: null, hoogteMm: 297 }, { breedteMm: 0, hoogteMm: 0 }]) {
    const p = plaats({ papier, pagina: A4_LIGGEND, schaling: 'custom-scale', zoom: 10 });
    assert.equal(p.bekend, false, JSON.stringify(papier));
    bijna(p.vel.breedteMm, 297);
    bijna(p.vel.hoogteMm, 210);
    assert.equal(p.vel.orientatie, 'landscape');
    assert.equal(p.schaal, 1);
    rechthoek(p.pagina, [0, 0, 297, 210]);
    assert.equal(p.afgesneden, false);
  }
});

// --- het vel is de pagina zelf, in de gekozen stand ("Opslaan als PDF" zonder formaat) ----

test('papier "pagina": het vel heeft de maat van de pagina en is bekend', () => {
  const p = plaats({ papier: 'pagina', pagina: A4_LIGGEND });
  assert.equal(p.bekend, true);
  assert.deepEqual(p.vel, { breedteMm: 297, hoogteMm: 210, orientatie: 'landscape' });
  assert.equal(p.gedraaid, false);
  bijna(p.schaal, 1);
  rechthoek(p.pagina, [0, 0, 297, 210]);
  assert.equal(p.afgesneden, false);
  // Elke pagina haar eigen vel: een andere maat geeft een ander vel.
  const groot = plaats({ papier: 'pagina', pagina: A1_LIGGEND });
  bijna(groot.vel.breedteMm, 841);
  bijna(groot.vel.hoogteMm, 594);
  assert.equal(groot.vel.orientatie, 'landscape');
});

test('papier "pagina": een handmatige stand haaks op de pagina draait haar op het vel', () => {
  const p = plaats({ papier: 'pagina', pagina: A4_LIGGEND, orientatie: 'portrait' });
  assert.deepEqual(p.vel, { breedteMm: 210, hoogteMm: 297, orientatie: 'portrait' });
  assert.equal(p.gedraaid, true);
  assert.equal(p.draaiing, DRAAIING_HAAKS);
  bijna(p.schaal, 1);
  rechthoek(p.pagina, [0, 0, 210, 297]);
  assert.equal(p.afgesneden, false);
  // Dezelfde stand als de pagina: niets te draaien.
  const zelfde = plaats({ papier: 'pagina', pagina: A4_LIGGEND, orientatie: 'landscape' });
  assert.equal(zelfde.gedraaid, false);
  // Aangepaste schaal geldt op dat vel.
  const half = plaats({ papier: 'pagina', pagina: A4, schaling: 'custom-scale', zoom: 50 });
  rechthoek(half.pagina, [52.5, 74.25, 105, 148.5]);
});

test('onbruikbare paginamaat: geen plaatsing', () => {
  for (const p of [null, {}, { breedtePt: 0, hoogtePt: 10 }, { breedtePt: NaN, hoogtePt: 10 }]) {
    assert.equal(berekenPlaatsing({ papier: vel('a4'), pagina: p }), null);
  }
});

// --- renderen: alleen het zichtbare deel, op hele pixels -------------------------

test('renderDeel: hele pagina op 300 dpi, randen exact op de pagina', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'actual' });
  const pxPerPt = 300 / 72;
  const d = renderDeel(p, pxPerPt);
  assert.deepEqual(d.px, { x: 0, y: 0, breedte: Math.ceil(A4.breedtePt * pxPerPt), hoogte: Math.ceil(A4.hoogtePt * pxPerPt) });
  rechthoek(d.opVel, [43.5, 61.5, 210, 297]);
});

test('renderDeel: bij afsnijden alleen de zichtbare pixels, op hun plek op het vel', () => {
  const p = plaats({ papier: vel('a4'), pagina: pagina(297, 420), schaling: 'actual' });
  const pxPerPt = 2; // 2 px per pt
  const d = renderDeel(p, pxPerPt);
  assert.equal(d.px.x, Math.floor(pt(43.5) * 2));
  assert.equal(d.px.y, Math.floor(pt(61.5) * 2));
  assert.equal(d.px.x + d.px.breedte, Math.ceil(pt(43.5 + 210) * 2));
  // Naar buiten afgerond: hooguit één pixel (0,5 pt = 0,18 mm) over de rand van het vel.
  const mmPerPx = 25.4 / 72 / 2;
  assert.ok(d.opVel.x <= 0 && d.opVel.x > -mmPerPx);
  assert.ok(d.opVel.y <= 0 && d.opVel.y > -mmPerPx);
  assert.ok(d.opVel.x + d.opVel.breedte >= 210 && d.opVel.x + d.opVel.breedte < 210 + mmPerPx);
  assert.ok(d.opVel.y + d.opVel.hoogte >= 297 && d.opVel.y + d.opVel.hoogte < 297 + mmPerPx);
});

test('renderDeel: minstens één pixel, nooit buiten de pagina', () => {
  const p = plaats({ papier: vel('a4'), pagina: pagina(10, 10), schaling: 'custom-scale', zoom: 10 });
  const d = renderDeel(p, 0.01);
  assert.deepEqual(d.px, { x: 0, y: 0, breedte: 1, hoogte: 1 });
  rechthoek(d.opVel, [p.pagina.x, p.pagina.y, 1, 1]);
  assert.equal(renderDeel(null, 1), null);
  assert.equal(renderDeel(p, 0), null);
});

// --- de tijdelijke print-PDF ---------------------------------------------------

test('pdfPagina: bekend papier = pagina op papiergrootte, beeld op de plek (oorsprong linksonder)', () => {
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'custom-scale', zoom: 50, centreren: false });
  const d = renderDeel(p, 300 / 72 * 0.5);
  const { maat, afbeelding } = pdfPagina(p, d);
  bijna(maat[0], pt(297));
  bijna(maat[1], pt(420));
  bijna(afbeelding.x, 0);
  bijna(afbeelding.width, pt(105), 1e-6);
  bijna(afbeelding.height, pt(148.5), 1e-6);
  // Linksboven op het vel = bovenaan in PDF-coördinaten.
  bijna(afbeelding.y, pt(420 - 148.5), 1e-6);
});

test('pdfPagina: onbekend papier = de pagina op haar eigen maat, beeld vult haar (oude gedrag)', () => {
  const p = plaats({ papier: null, pagina: A4_LIGGEND, schaling: 'custom-scale', zoom: 10 });
  const d = renderDeel(p, 300 / 72);
  const { maat, afbeelding } = pdfPagina(p, d);
  assert.deepEqual(maat, [A4_LIGGEND.breedtePt, A4_LIGGEND.hoogtePt]);
  bijna(afbeelding.x, 0);
  bijna(afbeelding.y, 0, 1e-9);
  bijna(afbeelding.width, A4_LIGGEND.breedtePt, 1e-9);
  bijna(afbeelding.height, A4_LIGGEND.hoogtePt, 1e-9);
});

test('printPxPerPt: 300 dpi op papier, bij vergroten 300 dpi van de pagina', () => {
  assert.equal(PRINT_DPI, 300);
  const actual = plaats({ papier: vel('a3'), pagina: A4, schaling: 'actual' });
  assert.equal(printPxPerPt(actual), 300 / 72);
  const tiende = plaats({ papier: vel('a1'), pagina: A1_LIGGEND, schaling: 'custom-scale', zoom: 10 });
  bijna(printPxPerPt(tiende), 30 / 72);
  const vergroot = plaats({ papier: vel('a1'), pagina: A4, schaling: 'fit' });
  assert.ok(vergroot.schaal > 2.8);
  assert.equal(printPxPerPt(vergroot), 300 / 72);
  // Onbekend papier: zoals altijd, de pagina op 300 dpi.
  assert.equal(printPxPerPt(plaats({ papier: null, pagina: A4 })), 300 / 72);
  assert.equal(printPxPerPt(null), 300 / 72);
});

test('voegPrintPaginaToe: pagina op papiergrootte, beeld op de plek (pdf-lib)', async () => {
  const { PDFDocument } = await import('pdf-lib');
  // Nep-document: legt vast wat er gevraagd wordt.
  const aanroepen = [];
  const nep = {
    addPage(maat) {
      aanroepen.push(['addPage', maat]);
      return { drawImage: (beeld, opties) => aanroepen.push(['drawImage', beeld, opties]) };
    },
  };
  const p = plaats({ papier: vel('a3'), pagina: A4, schaling: 'custom-scale', zoom: 50 });
  const d = renderDeel(p, printPxPerPt(p));
  voegPrintPaginaToe(nep, p, d, 'beeld');
  const { maat, afbeelding } = pdfPagina(p, d);
  assert.deepEqual(aanroepen, [['addPage', maat], ['drawImage', 'beeld', afbeelding]]);
  // Gecentreerd: 96 mm van links en 135,75 mm van onder (A3 staand, 105 x 148,5 mm).
  bijna(afbeelding.x, pt(96), 1e-6);
  bijna(afbeelding.y, pt(420 - 135.75 - 148.5), 1e-6);

  // Echt pdf-lib: de pagina heeft de maat van het vel.
  const pdf = await PDFDocument.create();
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
  ));
  voegPrintPaginaToe(pdf, p, d, await pdf.embedPng(png));
  const terug = await PDFDocument.load(await pdf.save());
  const { width, height } = terug.getPage(0).getSize();
  bijna(width, pt(297), 1e-3);
  bijna(height, pt(420), 1e-3);
});

// --- de melding bij afsnijden ------------------------------------------------------

test('alle locales melden afsnijden en de onbedrukbare rand, vertaald en zonder plaatshouders', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const map = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8'));
  const en = lees('en').print;
  const talen = readdirSync(map);
  assert.equal(talen.length, 39);
  for (const taal of talen) {
    for (const sleutel of ['pageClipped', 'pageOutsidePrintable']) {
      const tekst = lees(taal).print?.[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.doesNotMatch(tekst, /\{\{/, `${taal} print.${sleutel}`);
      if (taal !== 'en') assert.notEqual(tekst, en[sleutel], `${taal} print.${sleutel} is niet vertaald`);
    }
  }
});
