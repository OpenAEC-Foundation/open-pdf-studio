// Locatielijn van een wand (#1230): de klikken volgen de hartlijn, het
// linkervlak of het rechtervlak. Een loop die op een vlak is getekend moet
// in de hoeken sluiten, zodat de wanden verstekken en de ruimte zich laat
// vinden. De hartlijn blijft de standaard en verandert niets.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCATIELIJNEN, normaliseerLocatielijn, hartlijnVerschuiving, hartlijnVanKliklijn, vlakHoekPlan,
} from './wand-locatielijn.js';
import { pasTrimToe, zoekJoinPartner } from '../annotations/wand-join.js';
import { ruimtenUitWanden, ruimteOppervlakteTekst } from './ruimte.js';

// Een blad op 1/4" = 1'-0": 18 paginapunten per voet.
const PT_PER_FT = 18;
const PX_PER_MM = PT_PER_FT / 304.8;
const ZES_INCH = 152.4;
const halfW = (w) => ((w.dikteMm || 100) * PX_PER_MM) / 2;       // 6 inch: 4,5 pt
const bijna = (a, b, wat, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/**
 * Teken een loop zoals het wandgereedschap dat doet: per geklikt lijnstuk de
 * hartlijn naast de kliklijn, daarna de hoeken sluiten met de wanden die er
 * al staan.
 */
function tekenLoop(punten, locatielijn, dikteMm = ZES_INCH) {
  const wanden = [];
  for (let i = 0; i + 1 < punten.length; i++) {
    const klik = { startX: punten[i].x, startY: punten[i].y, endX: punten[i + 1].x, endY: punten[i + 1].y };
    const nieuw = {
      id: `w${i + 1}`, type: 'wall', page: 1, dikteMm, hatchPattern: 'none',
      ...hartlijnVanKliklijn(klik, halfW({ dikteMm }), locatielijn),
    };
    const plan = vlakHoekPlan(nieuw, klik, wanden, halfW);
    for (const w of [...wanden, nieuw]) pasTrimToe(w, plan);
    wanden.push(nieuw);
  }
  return wanden;
}

test('de keuzes: hartlijn (standaard), linkervlak, rechtervlak', () => {
  assert.deepEqual(LOCATIELIJNEN, ['center', 'left', 'right']);
  assert.equal(normaliseerLocatielijn('left'), 'left');
  assert.equal(normaliseerLocatielijn('right'), 'right');
  for (const v of [undefined, null, '', 'centre', 'links', 3]) {
    assert.equal(normaliseerLocatielijn(v), 'center', String(v));
  }
});

test('hartlijn blijft: de wand ligt precies op de geklikte lijn', () => {
  const klik = { startX: 100, startY: 200, endX: 400, endY: 200 };
  for (const lijn of ['center', undefined, 'onzin']) {
    assert.deepEqual(hartlijnVerschuiving(klik, 4.5, lijn), { x: 0, y: 0 });
    assert.deepEqual(hartlijnVanKliklijn(klik, 4.5, lijn), klik);
  }
});

test('linkervlak, van links naar rechts getekend: het wandlichaam ligt onder de geklikte lijn', () => {
  const klik = { startX: 100, startY: 200, endX: 400, endY: 200 };
  const hart = hartlijnVanKliklijn(klik, 4.5, 'left');
  // Paginacoördinaten lopen omlaag: onder de lijn is een grotere y.
  assert.deepEqual(hart, { startX: 100, startY: 204.5, endX: 400, endY: 204.5 });
  // Het linkervlak van de wand (hartlijn min een halve dikte) is de kliklijn;
  // het lichaam beslaat y 200 tot 209.
  assert.equal(hart.startY - 4.5, klik.startY);
  assert.equal(hart.startY + 4.5, 209);
});

test('rechtervlak: het wandlichaam ligt aan de andere kant', () => {
  const klik = { startX: 100, startY: 200, endX: 400, endY: 200 };
  assert.deepEqual(hartlijnVanKliklijn(klik, 4.5, 'right'), { startX: 100, startY: 195.5, endX: 400, endY: 195.5 });
});

test('de kant volgt de tekenrichting, in elke richting', () => {
  // Omlaag getekend: rechts van de richting is links op het blad.
  assert.deepEqual(hartlijnVerschuiving({ startX: 0, startY: 0, endX: 0, endY: 50 }, 3, 'left'), { x: -3, y: 0 });
  // Van rechts naar links: rechts van de richting is boven de lijn.
  const terug = hartlijnVerschuiving({ startX: 50, startY: 0, endX: 0, endY: 0 }, 3, 'left');
  bijna(terug.x, 0, 'x'); bijna(terug.y, -3, 'y');
  // Schuin (3-4-5): loodrecht op de lijn, een halve dikte ver.
  const v = hartlijnVerschuiving({ startX: 0, startY: 0, endX: 30, endY: 40 }, 5, 'left');
  bijna(v.x, -4, 'x'); bijna(v.y, 3, 'y');
  bijna(v.x * 30 + v.y * 40, 0, 'loodrecht');
  // Een lijn zonder lengte of een wand zonder dikte verschuift niet.
  assert.deepEqual(hartlijnVerschuiving({ startX: 5, startY: 5, endX: 5, endY: 5 }, 3, 'left'), { x: 0, y: 0 });
  assert.deepEqual(hartlijnVerschuiving({ startX: 0, startY: 0, endX: 9, endY: 0 }, 0, 'left'), { x: 0, y: 0 });
});

test('een hoek naar de wandkant (buitenhoek): beide uiteinden gaan naar het snijpunt van de hartlijnen', () => {
  // Linkervlak, eerst naar rechts en dan omlaag: de geklikte lijn is de
  // buitenkant van de hoek.
  const [a, b] = tekenLoop([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }], 'left');
  assert.deepEqual([a.startX, a.startY], [100, 104.5], 'het vrije begin blijft');
  assert.deepEqual([a.endX, a.endY], [295.5, 104.5], 'ingekort tot de hoek');
  assert.deepEqual([b.startX, b.startY], [295.5, 104.5], 'begint in dezelfde hoek');
  assert.deepEqual([b.endX, b.endY], [295.5, 250]);
  // De buitenhoek van het verstek ligt op het geklikte punt.
  assert.deepEqual([a.endX + 4.5, a.endY - 4.5], [300, 100]);
});

test('een hoek van de wandkant af (binnenhoek): de wanden worden verlengd tot de hoek', () => {
  // Linkervlak, eerst naar rechts en dan omhoog: de geklikte lijn is de
  // binnenkant van de hoek.
  const [a, b] = tekenLoop([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 0 }], 'left');
  assert.deepEqual([a.endX, a.endY], [304.5, 104.5], 'verlengd tot de hoek');
  assert.deepEqual([b.startX, b.startY], [304.5, 104.5]);
  assert.deepEqual([b.endX, b.endY], [304.5, 0]);
});

test('na het sluiten verstekt de weergave de hoek: de eindpunten vallen samen', () => {
  const wanden = tekenLoop([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }], 'left');
  const [a, b] = wanden;
  const pa = zoekJoinPartner(a, 'end', wanden, halfW);
  assert.equal(pa?.soort, 'samenvallend');
  assert.equal(pa.wall, b);
  assert.equal(pa.eind, 'start');
  const pb = zoekJoinPartner(b, 'start', wanden, halfW);
  assert.equal(pb?.soort, 'samenvallend');
  assert.equal(pb.wall, a);
});

test('een gesloten loop van vier wanden op de binnenvlakken geeft een gesloten ruimte', () => {
  // Binnenmaat 19'-6" x 13'-6" op 1/4" = 1'-0": 351 x 243 punten. Linkervlak
  // met het lichaam naar buiten: tegen de klok in op het blad.
  const binnen = [
    { x: 100, y: 100 }, { x: 100, y: 343 }, { x: 451, y: 343 }, { x: 451, y: 100 }, { x: 100, y: 100 },
  ];
  const wanden = tekenLoop(binnen, 'left');
  assert.equal(wanden.length, 4);

  // De hartlijnen vormen de rechthoek een halve wand (3 inch) buiten de
  // binnenmaat: 20' x 14'. Elke hoek heeft twee samenvallende eindpunten.
  const hoeken = [[95.5, 95.5], [95.5, 347.5], [455.5, 347.5], [455.5, 95.5]];
  wanden.forEach((w, i) => {
    const van = hoeken[i], naar = hoeken[(i + 1) % 4];
    bijna(w.startX, van[0], `${w.id} startX`); bijna(w.startY, van[1], `${w.id} startY`);
    bijna(w.endX, naar[0], `${w.id} endX`); bijna(w.endY, naar[1], `${w.id} endY`);
  });
  for (const w of wanden) {
    for (const eind of ['start', 'end']) {
      assert.equal(zoekJoinPartner(w, eind, wanden, halfW)?.soort, 'samenvallend', `${w.id} ${eind}`);
    }
  }

  // De ruimtezoeker vindt een gesloten ruimte, zonder losse einden, en haar
  // contour is precies de geklikte binnenmaat.
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: PX_PER_MM });
  assert.equal(ruimten.length, 1);
  assert.deepEqual(losseEinden, []);
  const xs = ruimten[0].polygoon.map((p) => p.x), ys = ruimten[0].polygoon.map((p) => p.y);
  bijna(Math.min(...xs), 100, 'links', 1e-6); bijna(Math.max(...xs), 451, 'rechts', 1e-6);
  bijna(Math.min(...ys), 100, 'boven', 1e-6); bijna(Math.max(...ys), 343, 'onder', 1e-6);
  // 19,5 ft x 13,5 ft = 263,25 ft².
  bijna(ruimten[0].oppervlakteM2, 19.5 * 13.5 * 0.3048 * 0.3048, 'netto oppervlakte', 1e-9);
  assert.equal(ruimteOppervlakteTekst(ruimten[0].oppervlakteM2, 1, 'ft²'), '263 SF');
});

test('dezelfde ruimte met de klok mee op het rechtervlak', () => {
  const binnen = [
    { x: 100, y: 100 }, { x: 451, y: 100 }, { x: 451, y: 343 }, { x: 100, y: 343 }, { x: 100, y: 100 },
  ];
  const wanden = tekenLoop(binnen, 'right');
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: PX_PER_MM });
  assert.equal(ruimten.length, 1);
  assert.deepEqual(losseEinden, []);
  bijna(ruimten[0].oppervlakteM2, 19.5 * 13.5 * 0.3048 * 0.3048, 'netto oppervlakte', 1e-9);
  assert.deepEqual([wanden[0].startX, wanden[0].startY], [95.5, 95.5]);
});

test('een loop op de buitenvlakken sluit ook: de ruimte is twee wanddiktes kleiner', () => {
  // Linkervlak met de klok mee: het lichaam ligt binnen de geklikte lijn.
  const buiten = [
    { x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 352 }, { x: 100, y: 352 }, { x: 100, y: 100 },
  ];
  const wanden = tekenLoop(buiten, 'left');
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: PX_PER_MM });
  assert.equal(ruimten.length, 1);
  assert.deepEqual(losseEinden, []);
  // 20' x 14' buitenwerks, min twee keer 6 inch: 19' x 13'.
  bijna(ruimten[0].oppervlakteM2, 19 * 13 * 0.3048 * 0.3048, 'netto oppervlakte', 1e-9);
});

test('een schuine hoek sluit op het snijpunt van de hartlijnen', () => {
  const [a, b] = tekenLoop([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 100 }], 'left');
  bijna(a.endX, b.startX, 'x gelijk'); bijna(a.endY, b.startY, 'y gelijk');
  bijna(a.endY, 4.5, 'op de hartlijn van a');
  // Op de hartlijn van b: 4,5 punt rechts van de lijn (200,0)-(300,100).
  const d = ((a.endX - 200) * -1 + (a.endY - 0) * 1) / Math.SQRT2;
  bijna(d, 4.5, 'op de hartlijn van b', 1e-9);
});

test('wanden in elkaars verlengde blijven zoals ze zijn', () => {
  const [a, b] = tekenLoop([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }], 'left');
  assert.deepEqual([a.endX, a.endY], [200, 4.5]);
  assert.deepEqual([b.startX, b.startY], [200, 4.5]);
  assert.deepEqual([b.endX, b.endY], [400, 4.5]);
});

test('een wand die nergens op een vlakhoek begint, raakt geen andere wand', () => {
  const bestaand = { id: 'a', type: 'wall', page: 1, dikteMm: ZES_INCH, startX: 0, startY: 0, endX: 200, endY: 0 };
  const klik = { startX: 100, startY: 50, endX: 100, endY: 200 };
  const nieuw = { id: 'b', type: 'wall', page: 1, dikteMm: ZES_INCH, ...hartlijnVanKliklijn(klik, 4.5, 'left') };
  assert.deepEqual(vlakHoekPlan(nieuw, klik, [bestaand], halfW), []);
  // Ook niet als hij op het EINDPUNT van de hartlijn begint: dat is geen vlakhoek.
  const klik2 = { startX: 200, startY: 0, endX: 200, endY: 150 };
  const nieuw2 = { id: 'c', type: 'wall', page: 1, dikteMm: ZES_INCH, ...hartlijnVanKliklijn(klik2, 4.5, 'left') };
  assert.deepEqual(vlakHoekPlan(nieuw2, klik2, [bestaand], halfW), []);
});

test('wanden van verschillende dikte sluiten op hun eigen hartlijnen', () => {
  const dun = { id: 'a', type: 'wall', page: 1, dikteMm: 123.825 };   // 4-7/8 inch
  const klikA = { startX: 0, startY: 0, endX: 200, endY: 0 };
  Object.assign(dun, hartlijnVanKliklijn(klikA, halfW(dun), 'left'));
  const klikB = { startX: 200, startY: 0, endX: 200, endY: 150 };
  const dik = { id: 'b', type: 'wall', page: 1, dikteMm: 304.8 };     // 12 inch
  Object.assign(dik, hartlijnVanKliklijn(klikB, halfW(dik), 'left'));
  const plan = vlakHoekPlan(dik, klikB, [dun], halfW);
  assert.equal(plan.length, 2);
  for (const w of [dun, dik]) pasTrimToe(w, plan);
  bijna(dun.endX, 200 - halfW(dik), 'x op de hartlijn van de dikke wand');
  bijna(dun.endY, halfW(dun), 'y op de hartlijn van de dunne wand');
  bijna(dik.startX, dun.endX, 'samen x'); bijna(dik.startY, dun.endY, 'samen y');
});

test('het plan heeft de vorm van hoek trimmen en raakt elk uiteinde hooguit een keer', () => {
  const wanden = tekenLoop([{ x: 100, y: 100 }, { x: 300, y: 100 }], 'left');
  const klik = { startX: 300, startY: 100, endX: 300, endY: 250 };
  const nieuw = { id: 'n', type: 'wall', page: 1, dikteMm: ZES_INCH, ...hartlijnVanKliklijn(klik, 4.5, 'left') };
  const plan = vlakHoekPlan(nieuw, klik, wanden, halfW);
  assert.deepEqual(plan, [
    { id: 'w1', eind: 'end', x: 295.5, y: 104.5 },
    { id: 'n', eind: 'start', x: 295.5, y: 104.5 },
  ]);
  // Een uiteinde met de join uit krijgt hem bij het sluiten weer aan.
  wanden[0].noJoinEnd = true;
  pasTrimToe(wanden[0], plan);
  assert.equal(wanden[0].noJoinEnd, undefined);
});
