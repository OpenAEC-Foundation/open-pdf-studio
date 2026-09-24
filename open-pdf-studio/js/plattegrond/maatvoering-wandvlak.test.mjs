// Maatvoering aan het wandvlak (#477): een bouwkundige meet vanaf het vlak aan
// de kant van de maatketting, bij een gevel uit losse lagen vanaf de buitenste
// laag, en de uiterste punten liggen op de buitenhoek van het gebouw.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ankerPunt, maatketting, herberekenMaten, buitensteLaag, kettingLangsWandvlak,
  standaardMaatAfstanden, PLATTEGROND_MAATSTIJL, kettingEinden, ankerVoorPunt,
} from './maatvoering.js';
import { maatTekstStrook } from '../annotations/maat-label.js';

const H = 0.5;                                   // paginapunten per mm
const wand = { id: 'w1', startX: 0, startY: 100, endX: 5000, endY: 100, dikteMm: 300 };

test('een vlak-anker ligt op het wandvlak aan de aangewezen kant', () => {
  // Wand 300 mm: het vlak ligt 75 pt uit de hartlijn. n = (-u.y, u.x) = (0, 1).
  const index = new Map([['w1', wand]]);
  const extra = { wanden: [wand], pxPerMm: H };
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'start', vlak: 1 }, index, extra), { x: 0, y: 175 });
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'end', vlak: -1 }, index, extra), { x: 5000, y: 25 });
  // Zonder vlak blijft het de hartlijn (oude ankers werken zoals voorheen).
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'start' }, index, extra), { x: 0, y: 100 });
  // Zonder wandenlijst: alleen de eigen wand telt.
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'start', vlak: 1 }, index, { pxPerMm: H }), { x: 0, y: 175 });
});

/** Een spouwmuur uit losse lagen: kalkzandsteen 120, isolatie 100, spouw 40, metselwerk 100. */
function spouwmuur() {
  const y0 = 100;                                // hart van het binnenblad
  const kzs = { id: 'kzs', startX: 0, startY: y0, endX: 5000, endY: y0, dikteMm: 120 };
  const iso = { id: 'iso', startX: 0, startY: y0 + 30 + 25, endX: 5000, endY: y0 + 30 + 25, dikteMm: 100 };
  const mw = { id: 'mw', startX: 0, startY: y0 + 30 + 50 + 20 + 25, endX: 5000, endY: y0 + 30 + 50 + 20 + 25, dikteMm: 100 };
  return { kzs, iso, mw, alle: [kzs, iso, mw] };
}

test('bij een gevel uit losse lagen telt het vlak van de buitenste laag', () => {
  const { kzs, mw, alle } = spouwmuur();
  const laag = buitensteLaag(kzs, 1, alle, H);
  assert.equal(laag.wand, mw, 'over de isolatie en de spouw heen naar het metselwerk');
  assert.equal(laag.afstand, 30 + 50 + 20 + 50, 'buitenvlak metselwerk: 150 pt uit het hart van het binnenblad');
  // Aan de binnenkant ligt niets: het eigen vlak.
  assert.deepEqual(buitensteLaag(kzs, -1, alle, H), { wand: kzs, afstand: 30 });

  const index = new Map(alle.map((w) => [w.id, w]));
  assert.deepEqual(
    ankerPunt({ annotationId: 'kzs', punt: 'start', vlak: 1 }, index, { wanden: alle, pxPerMm: H }),
    { x: 0, y: 250 },
  );
});

test('een evenwijdige wand verder weg is geen laag van de gevel', () => {
  const { kzs } = spouwmuur();
  // Een binnenwand 2 m verderop, evenwijdig: geen spouw maar een kamer.
  const verderop = { id: 'bw', startX: 0, startY: 100 + 1000, endX: 5000, endY: 100 + 1000, dikteMm: 100 };
  assert.deepEqual(buitensteLaag(kzs, 1, [kzs, verderop], H), { wand: kzs, afstand: 30 });
});

/**
 * Buitenmaat 10 000 x 8000 mm (5000 x 4000 pt), metselwerk 100 mm, stompe
 * hoeken: de noord- en zuidgevel lopen door tot de buitenhoek, de oost- en
 * westgevel stoppen ertegen - 100 mm voor de buitenhoek. In de oostgevel een
 * raam van 1200 mm.
 */
function getrimdeHoek() {
  const N = { id: 'N', startX: 0, startY: 25, endX: 5000, endY: 25, dikteMm: 100 };
  const S = { id: 'S', startX: 5000, startY: 3975, endX: 0, endY: 3975, dikteMm: 100 };
  const W = { id: 'W', startX: 25, startY: 3950, endX: 25, endY: 50, dikteMm: 100 };
  const O1 = { id: 'O1', startX: 4975, startY: 50, endX: 4975, endY: 1500, dikteMm: 100 };
  const O2 = { id: 'O2', startX: 4975, startY: 2100, endX: 4975, endY: 3950, dikteMm: 100 };
  return { N, S, W, O1, O2, alle: [N, S, W, O1, O2] };
}

test('de uiterste punten van een gevelketting liggen op de buitenhoek van het gebouw', () => {
  const { O1, O2, alle } = getrimdeHoek();
  // O loopt naar het zuiden: n = (-1, 0) wijst naar binnen; buiten = zijde -1.
  const punten = kettingLangsWandvlak([O1, O2], { zijde: -1, wanden: alle, pxPerMm: H });
  assert.equal(punten.length, 4);
  assert.deepEqual(punten.map((p) => [p.x, p.y]), [[5000, 0], [5000, 1500], [5000, 2100], [5000, 4000]],
    'buitenhoek - dagkant - dagkant - buitenhoek, alles op het buitenvlak');
  assert.deepEqual(punten[0].anker, { annotationId: 'O1', punt: 'start', vlak: -1, hoek: true });
  assert.deepEqual(punten[1].anker, { annotationId: 'O1', punt: 'end', vlak: -1 });
  assert.deepEqual(punten[3].anker, { annotationId: 'O2', punt: 'end', vlak: -1, hoek: true });

  const { maten } = maatketting(punten, { pxPerMm: H, offsetMm: 500, zijde: -1 });
  const totaal = maten.find((m) => m.rol === 'totaalmaat');
  assert.equal(totaal.lengteMm, 8000, 'de buitenmaat, niet 7800');
  assert.deepEqual(maten.filter((m) => m.rol === 'tussenmaat').map((m) => Math.round(m.lengteMm)), [3000, 1200, 3800]);
  // De ketting ligt 500 mm uit het buitenVLAK, niet uit de hartlijn.
  assert.equal(maten[0].startX, 5000 + 250);
  // De hulplijnen beginnen op het wandvlak.
  assert.deepEqual(maten[0].basis, { van: { x: 5000, y: 0 }, tot: { x: 5000, y: 1500 } });
});

test('ook bij verstek en bij een ketting langs het binnenblad telt de buitenhoek', () => {
  // Verstek: de hartlijnen van het metselwerk komen samen in een punt.
  const N = { id: 'N', startX: 25, startY: 25, endX: 4975, endY: 25, dikteMm: 100 };
  const O = { id: 'O', startX: 4975, startY: 25, endX: 4975, endY: 3975, dikteMm: 100 };
  const S = { id: 'S', startX: 4975, startY: 3975, endX: 25, endY: 3975, dikteMm: 100 };
  const verstek = kettingLangsWandvlak([O], { zijde: -1, wanden: [N, O, S], pxPerMm: H });
  assert.deepEqual(verstek.map((p) => [p.x, p.y]), [[5000, 0], [5000, 4000]]);

  // Binnenblad van de oostgevel (kalkzandsteen 120) opgegeven, ketting buiten:
  // de app klimt over isolatie en spouw naar het metselwerk.
  const xK = 4975 - 25 - 20 - 50 - 30;
  const kzs = { id: 'K', startX: xK, startY: 190, endX: xK, endY: 3810, dikteMm: 120 };
  const iso = { id: 'I', startX: 4975 - 25 - 20 - 25, startY: 150, endX: 4975 - 25 - 20 - 25, endY: 3850, dikteMm: 100 };
  const binnen = kettingLangsWandvlak([kzs], { zijde: -1, wanden: [N, O, S, kzs, iso], pxPerMm: H });
  assert.deepEqual(binnen.map((p) => [p.x, p.y]), [[5000, 0], [5000, 4000]]);
});

test('een ketting aan de binnenkant stopt in de binnenhoek', () => {
  // Enkelsteens woning 300 mm, hartlijnen 10 000 x 8000 mm met verstek.
  const N = { id: 'N', startX: 0, startY: 0, endX: 5000, endY: 0, dikteMm: 300 };
  const O = { id: 'O', startX: 5000, startY: 0, endX: 5000, endY: 4000, dikteMm: 300 };
  const S = { id: 'S', startX: 5000, startY: 4000, endX: 0, endY: 4000, dikteMm: 300 };
  const W = { id: 'W', startX: 0, startY: 4000, endX: 0, endY: 0, dikteMm: 300 };
  const alle = [N, O, S, W];
  // Noordgevel loopt naar het oosten; n = (0, 1) = binnen.
  const buiten = kettingLangsWandvlak([N], { zijde: -1, wanden: alle, pxPerMm: H });
  assert.deepEqual(buiten.map((p) => [p.x, p.y]), [[-75, -75], [5075, -75]], 'buitenmaat 10 300');
  const binnen = kettingLangsWandvlak([N], { zijde: 1, wanden: alle, pxPerMm: H });
  assert.deepEqual(binnen.map((p) => [p.x, p.y]), [[75, 75], [4925, 75]], 'binnenmaat 9700');
});

test('een tegengesteld getekend wandstuk wordt in de looprichting gelezen', () => {
  const { O1, O2, alle } = getrimdeHoek();
  const omgekeerd = { ...O2, startY: O2.endY, endY: O2.startY };
  const nu = alle.map((w) => (w.id === 'O2' ? omgekeerd : w));
  const punten = kettingLangsWandvlak([O1, omgekeerd], { zijde: -1, wanden: nu, pxPerMm: H });
  assert.deepEqual(punten.map((p) => [p.x, p.y]), [[5000, 0], [5000, 1500], [5000, 2100], [5000, 4000]]);
  assert.deepEqual(punten[2].anker, { annotationId: 'O2', punt: 'end', vlak: 1 }, 'eigen vlakteken van het stuk');
  assert.deepEqual(punten[3].anker, { annotationId: 'O2', punt: 'start', vlak: 1, hoek: true });
});

test('refresh blijft het wandvlak en de buitenhoek volgen', () => {
  const { O1, O2, alle } = getrimdeHoek();
  const punten = kettingLangsWandvlak([O1, O2], { zijde: -1, wanden: alle, pxPerMm: H });
  const maten = maatketting(punten, { pxPerMm: H, offsetMm: 500, zijde: -1 }).maten
    .map((m, i) => ({
      id: `m${i}`, ...m, offsetMm: m.rol === 'totaalmaat' ? 850 : 500, zijde: -1,
      leaderStartX: m.basis.van.x, leaderStartY: m.basis.van.y,
      leaderEndX: m.basis.tot.x, leaderEndY: m.basis.tot.y,
    }));

  // Ongewijzigd: niets te doen.
  const index = new Map(alle.map((w) => [w.id, w]));
  assert.equal(herberekenMaten(maten, index, { pxPerMm: H, wanden: alle }).ongewijzigd, maten.length);

  // Het gebouw wordt 1 m langer: zuidgevel en het laatste stuk oostgevel
  // schuiven 500 pt naar het zuiden.
  const S = { ...alle.find((w) => w.id === 'S'), startY: 4475, endY: 4475 };
  const O2b = { ...O2, endY: 4450 };
  const nu = alle.map((w) => (w.id === 'S' ? S : w.id === 'O2' ? O2b : w));
  const uit = herberekenMaten(maten, new Map(nu.map((w) => [w.id, w])), { pxPerMm: H, wanden: nu });
  const totaal = maten.find((m) => m.rol === 'totaalmaat');
  const nieuwTotaal = uit.bijgewerkt.find((b) => b.id === totaal.id);
  assert.equal(nieuwTotaal.lengteMm, 9000, 'nog steeds tot de buitenhoek');
  assert.equal(nieuwTotaal.patch.endY, 4500);
  assert.equal(nieuwTotaal.patch.startX, 5000 + 425, 'op 850 mm uit het buitenvlak');
  // De hulplijnen beginnen op het wandvlak.
  assert.deepEqual([nieuwTotaal.patch.leaderEndX, nieuwTotaal.patch.leaderEndY], [5000, 4500]);
  // Een maat zonder hulplijnen krijgt er bij refresh ook geen.
  const kaal = { ...maten[0], leaderStartX: undefined, leaderStartY: undefined, leaderEndX: undefined, leaderEndY: undefined };
  const verschoven = nu.map((w) => ({ ...w, startX: w.startX + 10, endX: w.endX + 10 }));
  const r = herberekenMaten([kaal], new Map(verschoven.map((w) => [w.id, w])), { pxPerMm: H, wanden: verschoven });
  assert.equal(r.bijgewerkt.length, 1);
  assert.equal('leaderStartX' in r.bijgewerkt[0].patch, false);
});

test('de standaardafstanden groeien mee met de schaal, zodat de tekst past', () => {
  const stijl = PLATTEGROND_MAATSTIJL;
  const pt50 = 72 / 25.4 / 50, pt100 = 72 / 25.4 / 100;
  const a50 = standaardMaatAfstanden(pt50, stijl);
  assert.deepEqual(a50, { offsetMm: 500, totaalOffsetMm: 850 }, '1:50 houdt de gangbare maten');
  const a100 = standaardMaatAfstanden(pt100, stijl);
  // Op 1:100 is 350 mm maar 10 pt papier: te weinig voor een regel tekst.
  const strookPt = maatTekstStrook(stijl);
  assert.ok((a100.totaalOffsetMm - a100.offsetMm) * pt100 >= strookPt, 'ketting en totaal liggen een tekstregel uit elkaar');
  assert.ok(a100.offsetMm * pt100 >= strookPt, 'en de ketting ligt een tekstregel uit het wandvlak');
  assert.equal(a100.offsetMm % 50, 0, 'ronde maten');
  // Een opgegeven kettingafstand houdt zijn eigen tussenruimte tot het totaal.
  assert.deepEqual(standaardMaatAfstanden(pt50, stijl, 800), { offsetMm: 800, totaalOffsetMm: 1150 });
});

test('plattegrondmaten: zwart, dunne lijn, alleen het getal', () => {
  assert.equal(PLATTEGROND_MAATSTIJL.dimShowUnit, false);
  assert.equal(PLATTEGROND_MAATSTIJL.strokeColor, '#000000');
  assert.equal(PLATTEGROND_MAATSTIJL.color, '#000000');
  assert.ok(PLATTEGROND_MAATSTIJL.lineWidth < 0.5, 'dunner dan de wanden (0,7)');
  assert.ok(Object.isFrozen(PLATTEGROND_MAATSTIJL));
});

test('uitloop alleen aan begin en eind van de hele ketting', () => {
  assert.equal(kettingEinden(0, 1), 'both', 'een losse maat');
  assert.deepEqual([0, 1, 2, 3].map((i) => kettingEinden(i, 4)), ['start', 'none', 'none', 'end']);
  const { O1, O2, alle } = getrimdeHoek();
  const punten = kettingLangsWandvlak([O1, O2], { zijde: -1, wanden: alle, pxPerMm: H });
  const { maten } = maatketting(punten, { pxPerMm: H, offsetMm: 500, zijde: -1 });
  assert.deepEqual(maten.map((m) => m.einden), ['start', 'none', 'end', 'both'], 'drie tussenmaten en de totaalmaat');
  // Plattegrondmaten: 2 mm uitloop, hulplijn 1,5 mm vrij van het wandvlak en 2 mm door.
  assert.equal(PLATTEGROND_MAATSTIJL.dimLineOvershootMm, 2);
  assert.equal(PLATTEGROND_MAATSTIJL.dimExtGapMm, 1.5);
  assert.equal(PLATTEGROND_MAATSTIJL.dimExtOvershootMm, 2);
});

test('een los aangewezen punt op een wandvlak wordt aan die wand verankerd', () => {
  const index = new Map([['w1', wand]]);
  // Halverwege, op het vlak aan de +n-kant (y 175): 2000 mm vanaf het begin.
  const langs = ankerVoorPunt({ x: 1000, y: 175 }, [wand], H);
  assert.deepEqual(langs, { annotationId: 'w1', punt: 'langs', vlak: 1, afstandMm: 2000 });
  assert.deepEqual(ankerPunt(langs, index, { wanden: [wand], pxPerMm: H }), { x: 1000, y: 175 });
  // Schuift de wand, dan schuift het punt mee.
  const verschoven = { ...wand, startY: 300, endY: 300 };
  assert.deepEqual(ankerPunt(langs, new Map([['w1', verschoven]]), { wanden: [verschoven], pxPerMm: H }), { x: 1000, y: 375 });
  // Op het eind van het vlak aan de andere kant: een eind-anker.
  assert.deepEqual(ankerVoorPunt({ x: 5000, y: 25 }, [wand], H), { annotationId: 'w1', punt: 'end', vlak: -1 });
  // Midden in de wand of ernaast: geen anker.
  assert.equal(ankerVoorPunt({ x: 1000, y: 100 }, [wand], H), null);
  assert.equal(ankerVoorPunt({ x: 1000, y: 400 }, [wand], H), null);
});
