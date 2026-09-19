// Schaal en plek van de pagina op het vel: dezelfde regel voor het voorbeeld
// in de printdialoog en voor de printopdracht.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHALINGEN, ZOOM_MIN, ZOOM_MAX, AFSNIJ_SPELING_MM,
  geldigeZoom, velOrientatie, schaalFactor, berekenPlaatsing, renderDeel, pdfPagina,
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
  // Liggende pagina op een staand vel: passend op de breedte, bovenaan.
  bijna(passend.schaal, 297 / 297);
  rechthoek(passend.pagina, [0, 0, 297, 210]);
});

// --- oriëntatie ---------------------------------------------------------------

test('auto: een liggende pagina krijgt een liggend vel; staand gevraagd blijft staand', () => {
  const auto = plaats({ papier: vel('a3'), pagina: A4_LIGGEND, schaling: 'actual' });
  assert.deepEqual(auto.vel, { breedteMm: 420, hoogteMm: 297, orientatie: 'landscape' });
  rechthoek(auto.pagina, [61.5, 43.5, 297, 210]);
  const staand = plaats({ papier: vel('a3'), pagina: A4_LIGGEND, schaling: 'actual', orientatie: 'portrait' });
  assert.deepEqual(staand.vel, { breedteMm: 297, hoogteMm: 420, orientatie: 'portrait' });
  rechthoek(staand.pagina, [0, 105, 297, 210]);
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
