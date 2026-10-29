// Posterafdruk (#597): een grote pagina (A1/A0) in tegels over kleinere vellen
// (A4/A3). Hier de pure rekenregels: het raster per pagina, de tegels in
// paginaruimte met overlap, het bedrukbare gebied van de printer, de stand
// van de vellen, welke pagina's getegeld worden, en waar snijtekens en
// labels komen.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  posterIndeling, posterVellen, aantalPosterVellen, rasterLangs, posterOpties, posterPapier,
  geldigePosterSchaal, geldigeOverlap, posterLabel, winAnsiTekst, isWinAnsi,
  POSTER_STANDAARD, RAND_MM, SNIJTEKEN_BEGIN_MM, SNIJTEKEN_EIND_MM, LABEL_BASIS_MM, STANDAARD_VEL,
} from './print-poster.js';

const PT_PER_MM = 72 / 25.4;
const pagina = (bMm, hMm) => ({ breedtePt: bMm * PT_PER_MM, hoogtePt: hMm * PT_PER_MM });
const A1 = pagina(594, 841);
const A1_LIGGEND = pagina(841, 594);
const A0 = pagina(841, 1189);
const A4_PAGINA = pagina(210, 297);
const A4 = { breedteMm: 210, hoogteMm: 297 };
const A3 = { breedteMm: 297, hoogteMm: 420 };
const KAAL = { schaal: 100, overlap: 0, snijtekens: false, labels: false, alleenGroot: false };

function bijna(werkelijk, verwacht, speling = 1e-6, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

function indeling(p = {}) {
  return posterIndeling({
    papier: A4, orientatie: 'auto', pagina: A1, ...p, opties: { ...KAAL, ...(p.opties || {}) },
  });
}

test('opties: grenzen en standaard', () => {
  assert.equal(geldigePosterSchaal(100), 100);
  assert.equal(geldigePosterSchaal(5), 10);
  assert.equal(geldigePosterSchaal(1000), 400);
  assert.equal(geldigePosterSchaal('x'), 100);
  assert.equal(geldigeOverlap(10), 10);
  assert.equal(geldigeOverlap(-3), 0);
  assert.equal(geldigeOverlap(80), 50);
  assert.equal(geldigeOverlap('7.5'), 7.5);
  assert.equal(geldigeOverlap(null), POSTER_STANDAARD.overlap);
  assert.deepEqual(posterOpties(), { ...POSTER_STANDAARD });
  assert.deepEqual(posterOpties({ schaal: 3, overlap: 99, snijtekens: 'ja', labels: false }),
    { ...POSTER_STANDAARD, schaal: 10, overlap: 50, labels: false });
});

test('papier: bekend vel blijft, onbekend wordt A4 (aangenomen)', () => {
  assert.deepEqual(posterPapier({ breedteMm: 420, hoogteMm: 297 }), { breedteMm: 297, hoogteMm: 420, bedrukbaar: null, aangenomen: false });
  for (const onbekend of [null, 'pagina', {}, { breedteMm: 0, hoogteMm: 10 }]) {
    const p = posterPapier(onbekend);
    assert.equal(p.aangenomen, true);
    assert.equal(p.breedteMm, STANDAARD_VEL.breedteMm);
    assert.equal(p.hoogteMm, STANDAARD_VEL.hoogteMm);
  }
});

test('rasterLangs: aantal tegels, stap en een gecentreerd raster', () => {
  assert.deepEqual(rasterLangs(100, 210, 0), { aantal: 1, begin: -55, stap: 210 });
  const r = rasterLangs(594, 210, 10);
  assert.equal(r.aantal, 3);
  assert.equal(r.stap, 200);
  bijna(r.begin, (594 - (3 * 200 + 10)) / 2);
  // Precies passend: geen extra tegel.
  assert.equal(rasterLangs(594, 297, 0).aantal, 2);
  // Een hair te lang (binnen de speling van een halve mm): één tegel.
  assert.equal(rasterLangs(210.3, 210, 0).aantal, 1);
});

test('A1 op staande A4 op 100 %: 3 x 3 vellen', () => {
  const p = indeling({ orientatie: 'portrait' });
  assert.equal(p.getegeld, true);
  assert.equal(p.kolommen, 3);
  assert.equal(p.rijen, 3);
  assert.equal(p.vellen.length, 9);
  assert.equal(p.vel.orientatie, 'portrait');
  bijna(p.schaal, 1);
  for (const v of p.vellen) {
    bijna(v.vel.breedteMm, 210);
    bijna(v.vel.hoogteMm, 297);
    bijna(v.plaatsing.schaal, 1);
  }
  // Volgorde: rij voor rij, van links naar rechts.
  assert.deepEqual(p.vellen.map((v) => `${v.rij},${v.kol}`),
    ['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3']);
  assert.deepEqual(p.vellen.map((v) => v.nummer), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Automatisch: liggende vellen, 594/297 = 2 kolommen, 841/210 = 4,005 → 4
  // rijen binnen de speling (#855): 8 vellen, zoveel A4's als een A1 groot is.
  const auto = indeling();
  assert.equal(auto.vel.orientatie, 'landscape');
  assert.equal(`${auto.kolommen} x ${auto.rijen}`, '2 x 4');
});

test('A1 op A3 op 100 %: 2 x 2 vellen, de stand volgt bij gelijkspel de pagina', () => {
  const p = indeling({ papier: A3 });
  assert.equal(p.kolommen, 2);
  assert.equal(p.rijen, 2);
  assert.equal(p.vel.orientatie, 'portrait');
  const liggend = indeling({ papier: A3, pagina: A1_LIGGEND });
  assert.equal(liggend.vel.orientatie, 'landscape');
  assert.equal(liggend.kolommen, 2);
  assert.equal(liggend.rijen, 2);
});

test('A0 op A4 en A3, en andere schalen', () => {
  const a0a4 = indeling({ pagina: A0 });
  // Staand: 841/210 = 4,005 en 1189/297 = 4,003, binnen de speling (#855):
  // 4 x 4 (16); liggend: 841/297 = 2,83 → 3, 1189/210 = 5,66 → 6 (18).
  assert.equal(a0a4.vellen.length, 16);
  assert.equal(a0a4.vel.orientatie, 'portrait');
  assert.equal(a0a4.kolommen, 4);
  assert.equal(a0a4.rijen, 4);
  // Op A3: staand 3 x 3 (9), liggend 841/420 → 2 en 1189/297 → 4 (8).
  const a0a3 = indeling({ pagina: A0, papier: A3 });
  assert.equal(a0a3.kolommen * a0a3.rijen, 8);
  assert.equal(a0a3.vel.orientatie, 'landscape');
  // 50 %: een A1 wordt 297 x 420,5 mm; staand 2 x 2 = 4 vellen, liggend
  // 1 kolom (297 mm) x 2 rijen (420,5 / 210, binnen de speling) = 2 vellen.
  const half = indeling({ opties: { schaal: 50 } });
  bijna(half.schaal, 0.5);
  assert.equal(half.vel.orientatie, 'landscape');
  assert.equal(half.kolommen, 1);
  assert.equal(half.rijen, 2);
  bijna(half.paginaMm.breedte, 297, 1e-6);
  const halfStaand = indeling({ opties: { schaal: 50 }, orientatie: 'portrait' });
  assert.equal(halfStaand.kolommen, 2);
  assert.equal(halfStaand.rijen, 2);
  // 200 %: een A4 wordt A2, op A4 2 x 2 (staand vel, precies passend).
  const dubbel = indeling({ pagina: A4_PAGINA, opties: { schaal: 200 } });
  assert.equal(dubbel.kolommen * dubbel.rijen, 4);
  for (const v of dubbel.vellen) bijna(v.plaatsing.schaal, 2);
});

test('tegels: samen de hele pagina, aangrenzend precies de overlap gedeeld', () => {
  const overlap = 10;
  const p = indeling({ opties: { overlap } });
  assert.equal(p.overlap, overlap);
  // (594 - 10) / 200 = 2,92 → 3; (841 - 10) / 287 = 2,9 → 3.
  assert.equal(p.kolommen, 3);
  assert.equal(p.rijen, 3);
  const tegel = (r, k) => p.vellen.find((v) => v.rij === r && v.kol === k).tegel;
  // Horizontaal: rechterrand van 1,1 min linkerrand van 1,2 = overlap.
  bijna(tegel(1, 1).x + tegel(1, 1).breedte - tegel(1, 2).x, overlap, 1e-9, 'overlap horizontaal');
  bijna(tegel(1, 2).x + tegel(1, 2).breedte - tegel(1, 3).x, overlap, 1e-9, 'overlap horizontaal 2');
  bijna(tegel(1, 1).y + tegel(1, 1).hoogte - tegel(2, 1).y, overlap, 1e-9, 'overlap verticaal');
  // De tegel is het venster op het vel, in mm van de pagina op papier.
  for (const v of p.vellen) {
    bijna(v.tegel.breedte, v.venster.breedte);
    bijna(v.tegel.hoogte, v.venster.hoogte);
  }
  // Het raster ligt gecentreerd over de pagina en dekt haar helemaal.
  bijna(tegel(1, 1).x, -(tegel(1, 3).x + tegel(1, 3).breedte - 594));
  assert.ok(tegel(1, 1).x <= 0 && tegel(3, 3).x + tegel(3, 3).breedte >= 594);
  assert.ok(tegel(1, 1).y <= 0 && tegel(3, 3).y + tegel(3, 3).hoogte >= 841);
  // Het overlappende stuk van de pagina staat op beide vellen: dezelfde
  // paginapunten (bron) komen op allebei.
  const a = tegel(1, 1);
  const b = tegel(1, 2);
  const gedeeld = { x: b.x, breedte: a.x + a.breedte - b.x };
  const opA = p.vellen[0].plaatsing.bron;
  const opB = p.vellen[1].plaatsing.bron;
  assert.ok(opA.x + opA.breedte >= (gedeeld.x + gedeeld.breedte) * PT_PER_MM - 1e-6);
  bijna(opB.x, gedeeld.x * PT_PER_MM, 1e-6, 'tegel 1,2 begint waar de overlap begint');
});

test('het bedrukbare gebied: de tegels blijven binnen de marges van de printer', () => {
  const bedrukbaar = {
    staand: { links: 4, boven: 5, rechts: 6, onder: 7 },
    liggend: { links: 5, boven: 6, rechts: 7, onder: 4 },
  };
  const p = indeling({ papier: { ...A4, bedrukbaar }, orientatie: 'portrait' });
  for (const v of p.vellen) {
    assert.deepEqual(v.marges, bedrukbaar.staand);
    bijna(v.venster.x, 4);
    bijna(v.venster.y, 5);
    bijna(v.venster.breedte, 210 - 10);
    bijna(v.venster.hoogte, 297 - 12);
    // De pagina komt alleen binnen het venster op het vel.
    const z = v.plaatsing.zichtbaar;
    assert.ok(z.x >= v.venster.x - 1e-9 && z.y >= v.venster.y - 1e-9);
    assert.ok(z.x + z.breedte <= v.venster.x + v.venster.breedte + 1e-9);
    assert.ok(z.y + z.hoogte <= v.venster.y + v.venster.hoogte + 1e-9);
  }
  // Kleinere vensters: meer tegels (594 / 200 = 2,97 → 3; 841 / 285 = 2,95 → 3).
  assert.equal(p.kolommen, 3);
  assert.equal(p.rijen, 3);
  // Snijtekens of labels: een strook van RAND_MM binnen het bedrukbare gebied.
  const metRand = indeling({ papier: { ...A4, bedrukbaar }, orientatie: 'portrait', opties: { snijtekens: true } });
  const v = metRand.vellen[0];
  bijna(v.venster.x, 4 + RAND_MM);
  bijna(v.venster.y, 5 + RAND_MM);
  bijna(v.venster.breedte, 210 - 10 - 2 * RAND_MM);
  bijna(v.venster.hoogte, 297 - 12 - 2 * RAND_MM);
});

test('automatische stand: de stand met de minste vellen; een vaste stand blijft staan', () => {
  const bedrukbaar = {
    staand: { links: 4, boven: 4, rechts: 4, onder: 4 },
    liggend: { links: 4, boven: 4, rechts: 4, onder: 4 },
  };
  const opties = { overlap: 10, snijtekens: true, labels: true };
  // Venster staand 188 x 275 (stap 178 x 265): 4 x 4 = 16; liggend 275 x 188
  // (stap 265 x 178): 3 x 5 = 15.
  const auto = indeling({ papier: { ...A4, bedrukbaar }, opties });
  assert.equal(auto.vel.orientatie, 'landscape');
  assert.equal(auto.vellen.length, 15);
  const staand = indeling({ papier: { ...A4, bedrukbaar }, orientatie: 'portrait', opties });
  assert.equal(staand.vel.orientatie, 'portrait');
  assert.equal(staand.vellen.length, 16);
  // Een liggende A1 op vaste staande vellen: 841/210 → 4 kolommen (binnen de
  // speling), 594/297 → 2 rijen.
  const vast = indeling({ pagina: A1_LIGGEND, orientatie: 'portrait' });
  assert.equal(vast.kolommen, 4);
  assert.equal(vast.rijen, 2);
  assert.equal(vast.vel.orientatie, 'portrait');
  for (const v of vast.vellen) assert.equal(v.plaatsing.gedraaid, false);
  // Een gedraaid getoonde pagina komt binnen met de getoonde maat (841 x 594):
  // liggende vellen 3 x 3 (9), staande 4 x 2 (8); de minste wint.
  const autoLiggend = indeling({ pagina: A1_LIGGEND });
  assert.equal(autoLiggend.vel.orientatie, 'portrait');
  assert.equal(autoLiggend.kolommen, 4);
  assert.equal(autoLiggend.rijen, 2);
  assert.equal(indeling({ pagina: A1_LIGGEND, orientatie: 'landscape' }).vellen.length, 9);
});

test('alleen grote pagina\'s: een pagina die op het vel past gaat gewoon, op het bedrukbare gebied', () => {
  const bedrukbaar = {
    staand: { links: 4, boven: 4, rechts: 4, onder: 4 },
    liggend: { links: 4, boven: 4, rechts: 4, onder: 4 },
  };
  const opties = { alleenGroot: true, snijtekens: true, labels: true, overlap: 10 };
  const klein = indeling({ pagina: A4_PAGINA, papier: { ...A4, bedrukbaar }, opties });
  assert.equal(klein.getegeld, false);
  assert.equal(klein.vellen.length, 1);
  const v = klein.vellen[0];
  assert.equal(v.snijtekens.length, 0);
  assert.equal(v.label, null);
  assert.equal(v.venster, null);
  // Verkleind tot het bedrukbare gebied, gecentreerd: niets valt weg.
  assert.ok(v.plaatsing.schaal < 1 && v.plaatsing.schaal > 0.95);
  assert.equal(v.plaatsing.buitenBedrukbaar, false);
  // Liggende A4 op een vast staand vel: gedraaid, zoals de gewone afdruk.
  const gedraaid = indeling({ pagina: pagina(297, 210), orientatie: 'portrait', opties });
  assert.equal(gedraaid.getegeld, false);
  assert.equal(gedraaid.vellen[0].plaatsing.gedraaid, true);
  bijna(gedraaid.vellen[0].plaatsing.paginaPt.breedtePt, 210 * PT_PER_MM, 1e-9);
  // Een A1 in hetzelfde document wordt wel getegeld.
  assert.equal(indeling({ papier: { ...A4, bedrukbaar }, opties }).getegeld, true);
  // Op 50 % past een A3 op A4: niet getegeld, en niet groter dan 50 %.
  const halfA3 = indeling({ pagina: pagina(297, 420), opties: { ...opties, schaal: 50 } });
  assert.equal(halfA3.getegeld, false);
  assert.ok(halfA3.vellen[0].plaatsing.schaal <= 0.5 + 1e-9);
  // Zonder "alleen grote pagina's" wordt ook een A4 getegeld.
  const alles = indeling({ pagina: A4_PAGINA, papier: { ...A4, bedrukbaar }, opties: { ...opties, alleenGroot: false } });
  assert.equal(alles.getegeld, true);
  assert.ok(alles.vellen.length > 1);
});

test('snijtekens: op de snijlijnen, in de strook buiten het venster, binnen het bedrukbare gebied', () => {
  const bedrukbaar = {
    staand: { links: 4, boven: 4, rechts: 4, onder: 4 },
    liggend: { links: 4, boven: 4, rechts: 4, onder: 4 },
  };
  const overlap = 10;
  const p = indeling({ papier: { ...A4, bedrukbaar }, orientatie: 'portrait', opties: { overlap, snijtekens: true } });
  for (const v of p.vellen) {
    assert.equal(v.snijtekens.length, 8);
    const w = v.venster;
    for (const s of v.snijtekens) {
      const xs = [s.x1, s.x2];
      const ys = [s.y1, s.y2];
      // Binnen het bedrukbare gebied van het vel.
      for (const x of xs) assert.ok(x >= 4 - 1e-9 && x <= 210 - 4 + 1e-9);
      for (const y of ys) assert.ok(y >= 4 - 1e-9 && y <= 297 - 4 + 1e-9);
      // Buiten het venster (niet over de tekening).
      const binnen = (x, y) => x > w.x + 1e-9 && x < w.x + w.breedte - 1e-9 && y > w.y + 1e-9 && y < w.y + w.hoogte - 1e-9;
      assert.ok(!binnen(s.x1, s.y1) && !binnen(s.x2, s.y2), 'snijteken niet in het venster');
      bijna(Math.hypot(s.x2 - s.x1, s.y2 - s.y1), SNIJTEKEN_EIND_MM - SNIJTEKEN_BEGIN_MM, 1e-9);
    }
    // De snijlijnen: buitenranden op de rand van de pagina, binnenranden
    // midden in de overlap.
    const tegel = v.tegel;
    const s = v.snijlijnen;
    const naarVel = (x) => w.x + (x - tegel.x);
    if (v.kol === 1) bijna(s.links, naarVel(0), 1e-9, 'links = paginarand');
    else bijna(s.links, w.x + overlap / 2, 1e-9, 'links = midden van de overlap');
    if (v.kol === p.kolommen) bijna(s.rechts, naarVel(594), 1e-9, 'rechts = paginarand');
    else bijna(s.rechts, w.x + w.breedte - overlap / 2, 1e-9);
    // Elk snijteken ligt in het verlengde van een snijlijn.
    const verticaal = v.snijtekens.filter((t) => t.x1 === t.x2).map((t) => t.x1);
    const horizontaal = v.snijtekens.filter((t) => t.y1 === t.y2).map((t) => t.y1);
    assert.deepEqual([...new Set(verticaal)].sort((a, b) => a - b), [s.links, s.rechts].sort((a, b) => a - b));
    assert.deepEqual([...new Set(horizontaal)].sort((a, b) => a - b), [s.boven, s.onder].sort((a, b) => a - b));
  }
  // Uit: geen snijtekens.
  assert.equal(indeling({ opties: { snijtekens: false, labels: true } }).vellen[0].snijtekens.length, 0);
  // Aangrenzende vellen: dezelfde snijlijn in paginaruimte.
  const a = p.vellen[0];
  const b = p.vellen[1];
  bijna(a.tegel.x + (a.snijlijnen.rechts - a.venster.x), b.tegel.x + (b.snijlijnen.links - b.venster.x), 1e-9);
});

test('labels: onder het venster in de strook, binnen het bedrukbare gebied, met rij en kolom', () => {
  const bedrukbaar = {
    staand: { links: 4, boven: 4, rechts: 4, onder: 4 },
    liggend: { links: 4, boven: 4, rechts: 4, onder: 4 },
  };
  const p = indeling({ papier: { ...A4, bedrukbaar }, orientatie: 'portrait', opties: { labels: true } });
  for (const v of p.vellen) {
    assert.ok(v.label);
    bijna(v.label.x, v.venster.x);
    bijna(v.label.y, v.venster.y + v.venster.hoogte + LABEL_BASIS_MM);
    assert.ok(v.label.y <= 297 - 4 + 1e-9, 'basislijn binnen het bedrukbare gebied');
    assert.ok(v.label.y - v.label.grootteMm > v.venster.y + v.venster.hoogte + SNIJTEKEN_EIND_MM - 1e-9,
      'tekst onder de snijtekens');
  }
  assert.equal(indeling({ opties: { labels: false } }).vellen[0].label, null);
});

test('labeltekst: bestand, pagina en tegel; alleen tekens die het standaardfont kan', () => {
  const vertaal = ({ file, page, row, col, rows, cols }) => `${file} - pagina ${page} - tegel ${row},${col} (${rows} × ${cols})`;
  assert.equal(posterLabel({ vertaal, bestand: 'plan.pdf', pagina: 3, rij: 1, kol: 2, rijen: 3, kolommen: 3 }),
    'plan.pdf - pagina 3 - tegel 1,2 (3 × 3)');
  // Zonder vertaling: de Engelse standaard.
  assert.equal(posterLabel({ bestand: 'a.pdf', pagina: 1, rij: 1, kol: 1, rijen: 2, kolommen: 2 }),
    'a.pdf - page 1 - tile 1,1 (2 x 2)');
  // Tekens buiten WinAnsi in de bestandsnaam: vraagteken.
  assert.equal(posterLabel({ vertaal, bestand: '平面图.pdf', pagina: 1, rij: 1, kol: 1, rijen: 1, kolommen: 1 }),
    '???.pdf - pagina 1 - tegel 1,1 (1 × 1)');
  // Een vertaling die het font niet kan (Chinees): de Engelse standaard.
  const zh = ({ page, row, col }) => `第 ${page} 页 - 图块 ${row},${col}`;
  assert.equal(posterLabel({ vertaal: zh, bestand: 'b.pdf', pagina: 2, rij: 2, kol: 1, rijen: 2, kolommen: 3 }),
    'b.pdf - page 2 - tile 2,1 (2 x 3)');
  // Een lange bestandsnaam wordt ingekort.
  const lang = posterLabel({ bestand: `${'x'.repeat(200)}.pdf`, pagina: 1, rij: 1, kol: 1, rijen: 1, kolommen: 1 });
  assert.ok(lang.length < 100);
  assert.ok(isWinAnsi(lang));
  assert.equal(winAnsiTekst('Ünïcødé – “ok” €'), 'Ünïcødé – “ok” €');
  assert.equal(isWinAnsi('Ω'), false);
});

test('vellen van de hele afdruk: per pagina in printvolgorde, met het totaal', () => {
  const opties = { ...KAAL, alleenGroot: true };
  const indelingen = [A4_PAGINA, A1, A4_PAGINA].map((p) => posterIndeling({ papier: A3, orientatie: 'auto', pagina: p, opties }));
  assert.equal(aantalPosterVellen(indelingen), 1 + 4 + 1);
  const vellen = posterVellen(indelingen);
  assert.equal(vellen.length, 6);
  assert.deepEqual(vellen.map((v) => v.paginaIndex), [0, 1, 1, 1, 1, 2]);
  assert.equal(vellen[0].vel.label, null);
  assert.equal(vellen[1].vel.nummer, 1);
  assert.equal(vellen[4].vel.nummer, 4);
  assert.equal(aantalPosterVellen([]), 0);
  assert.equal(aantalPosterVellen([null]), 0);
});

test('onbruikbare pagina of te grote overlap', () => {
  assert.equal(posterIndeling({ papier: A4, pagina: { breedtePt: 0, hoogtePt: 10 }, opties: KAAL }), null);
  // Overlap groter dan het halve venster wordt begrensd: het raster blijft eindig.
  const p = indeling({ opties: { overlap: 50 }, papier: { breedteMm: 60, hoogteMm: 80 } });
  assert.ok(p.overlap <= 30);
  assert.ok(Number.isFinite(p.vellen.length) && p.vellen.length > 0);
});

test('alle locales hebben de posterteksten, vertaald en met dezelfde plaatshouders', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const map = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8')).print;
  const en = lees('en');
  const sleutels = ['poster', 'posterScale', 'posterOverlap', 'posterCutMarks', 'posterLabels', 'posterOnlyLarge',
    'posterTileInfo', 'posterNotTiled', 'posterAssumedPaper', 'perSheetPosterNote', 'posterLabelText'];
  // Woorden die in een taal hetzelfde zijn als in het Engels.
  const gelijk = { da: ['posterOverlap'], nl: ['posterOverlap'] };
  const plaatshouders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const p = lees(taal);
    for (const sleutel of sleutels) {
      const tekst = p[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} print.${sleutel}: plaatshouders`);
      if (taal !== 'en' && !(gelijk[taal] || []).includes(sleutel)) {
        assert.notEqual(tekst, en[sleutel], `${taal} print.${sleutel} is niet vertaald`);
      }
    }
  }
  // De Engelse labeltekst is precies de terugval van posterLabel.
  const waarden = { file: 'a.pdf', page: 2, row: 1, col: 3, rows: 2, cols: 4 };
  const engels = en.posterLabelText.replace(/\{\{(\w+)\}\}/g, (_, k) => String(waarden[k]));
  assert.equal(posterLabel({ bestand: 'a.pdf', pagina: 2, rij: 1, kol: 3, rijen: 2, kolommen: 4 }), engels);
});

// #855: an A1 page on borderless A3 at 100 % with 0 overlap gave 3 x 3. ISO
// sizes are rounded down to whole mm at every halving (2 x 420 = 840 mm, an
// A1 is 841 mm) and a PDF page is a whole number of points (2384 pt =
// 841.02 mm), so an exact multiple came out a hair too long for the grid.
const ZONDER_RAND = {
  staand: { links: 0, boven: 0, rechts: 0, onder: 0 },
  liggend: { links: 0, boven: 0, rechts: 0, onder: 0 },
};
const A1_PT = { breedtePt: 1684, hoogtePt: 2384 };
const A1_PT_LIGGEND = { breedtePt: 2384, hoogtePt: 1684 };
const A0_PT = { breedtePt: 2384, hoogtePt: 3370 };

test('#855: A1 (in pt) on borderless A3 at 100 % without overlap is 2 x 2', () => {
  const papier = { ...A3, bedrukbaar: ZONDER_RAND };
  for (const orientatie of ['landscape', 'auto']) {
    const p = indeling({ papier, orientatie, pagina: A1_PT_LIGGEND });
    assert.equal(`${p.kolommen} x ${p.rijen}`, '2 x 2', `liggende A1, stand ${orientatie}`);
    assert.equal(p.vel.orientatie, 'landscape');
  }
  for (const orientatie of ['portrait', 'auto']) {
    const p = indeling({ papier, orientatie, pagina: A1_PT });
    assert.equal(`${p.kolommen} x ${p.rijen}`, '2 x 2', `staande A1, stand ${orientatie}`);
    assert.equal(p.vel.orientatie, 'portrait');
  }
  // Also with the mm-exact sizes and without a printable area from the printer.
  assert.equal(indeling({ papier: A3, pagina: A1_LIGGEND, orientatie: 'landscape' }).vellen.length, 4);
});

test('#855: A0 (in pt) on borderless A4 at 100 % without overlap is 4 x 4', () => {
  const p = indeling({ papier: { ...A4, bedrukbaar: ZONDER_RAND }, pagina: A0_PT });
  assert.equal(`${p.kolommen} x ${p.rijen}`, '4 x 4');
  assert.equal(p.vel.orientatie, 'portrait');
  // The page overruns the 4 x 4 grid by about a mm, split over both outer edges.
  const eerste = p.vellen[0].tegel;
  assert.ok(eerste.x > 0 && eerste.x < 0.75, `begin x ${eerste.x}`);
  assert.ok(eerste.y > 0 && eerste.y < 0.75, `begin y ${eerste.y}`);
  // The cut lines on the outer edges stay inside the window.
  const v = p.vellen[0];
  bijna(v.snijlijnen.links, v.venster.x);
  bijna(v.snijlijnen.boven, v.venster.y);
});

test('#855: exact multiples use the next count only beyond the rounding allowance', () => {
  // Floating-point noise on an exact multiple.
  assert.equal(rasterLangs(594 + 1e-9, 297, 0).aantal, 2);
  assert.equal(rasterLangs(0.1 * 3 * 2800, 420, 0).aantal, 2);
  assert.equal(rasterLangs(3 * 99.1, 99.1, 0).aantal, 3);
  // ISO and point rounding: about a mm over two or four sheets still fits.
  assert.equal(rasterLangs(841.02, 420, 0).aantal, 2);
  assert.equal(rasterLangs(1188.86, 297, 0).aantal, 4);
  // A real excess still gets the next sheet.
  assert.equal(rasterLangs(845, 420, 0).aantal, 3);
  assert.equal(rasterLangs(842, 420, 0).aantal, 3);
  // The allowance never eats into the overlap: 2 x 420 - 10 = 830 < 841.
  assert.equal(rasterLangs(841.02, 420, 10).aantal, 3);
  // The grid stays centred: the overrun is split evenly over both edges.
  const r = rasterLangs(841.02, 420, 0);
  bijna(r.begin, (841.02 - 840) / 2);
});

test('#855: printer margins and the cut-mark strip still count against the window', () => {
  // With the 7 mm strip for cut marks and labels on every edge an A3 window
  // is 406 x 283 mm, so a 1:1 A1 needs 3 x 3 sheets; that is not rounding.
  const p = indeling({ papier: { ...A3, bedrukbaar: ZONDER_RAND }, orientatie: 'landscape', pagina: A1_PT_LIGGEND,
    opties: { snijtekens: true, labels: true } });
  assert.equal(`${p.kolommen} x ${p.rijen}`, '3 x 3');
  // 4 mm margins from the printer: 412 x 289 mm, also 3 x 3.
  const marge = { links: 4, boven: 4, rechts: 4, onder: 4 };
  const m = indeling({ papier: { ...A3, bedrukbaar: { staand: marge, liggend: marge } }, orientatie: 'landscape',
    pagina: A1_PT_LIGGEND });
  assert.equal(`${m.kolommen} x ${m.rijen}`, '3 x 3');
});
