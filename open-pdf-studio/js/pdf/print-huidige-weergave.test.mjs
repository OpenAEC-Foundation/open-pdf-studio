// Afdrukken: Huidige weergave (#947): van het zichtbare venster naar een
// uitsnede per pagina, en die uitsnede passend en onvervormd op het vel.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  zichtbareDelen, maakUitsnede, uitsnedePxPerPt, uitsnedeBeeldMaat, uitsnedeRenderVak,
  uitsnedenPerPagina, MIN_ZICHTBAAR_PX, MAX_ZIJDE_PX, MAX_BEELD_PX,
} from './print-huidige-weergave.js';
import { berekenPlaatsing, renderDeel } from './print-plaatsing.js';

const A4 = { breedteMm: 210, hoogteMm: 297 };
const bijna = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// Scherm → paginaruimte zonder weergaverotatie: (client - oorsprong) / schaal.
function naarPagina(rect, oorsprong, schaal) {
  return {
    x: (rect.left - oorsprong.left) / schaal,
    y: (rect.top - oorsprong.top) / schaal,
    width: rect.width / schaal,
    height: rect.height / schaal,
  };
}

test('alleen het deel van de pagina in het venster telt, niet het grijze vlak ernaast', () => {
  // Venster 800 x 600 op (100, 50); de pagina (A4 op 2x zoom) steekt er links
  // en boven buiten en laat rechts grijs vlak zien.
  const venster = { left: 100, top: 50, width: 800, height: 600 };
  const pagina = { pageNum: 3, rect: { left: -200, top: -400, width: 595 * 2, height: 842 * 2 } };
  // De pagina loopt tot x = 990: rechts van het venster (900) valt niets weg,
  // maar ook geen grijs: de doorsnede stopt bij de rand van het venster.
  const [deel] = zichtbareDelen([pagina], venster);
  assert.deepEqual(deel, { pageNum: 3, rect: { left: 100, top: 50, width: 800, height: 600 } });

  // Nu schuift de pagina naar links: rechts komt grijs vlak in beeld.
  const opzij = { pageNum: 3, rect: { left: -500, top: -400, width: 1190, height: 1684 } };
  const [smal] = zichtbareDelen([opzij], venster);
  assert.equal(smal.rect.left, 100);
  assert.equal(smal.rect.width, 590, 'eindigt op de rand van de pagina (x = 690)');

  const rect = naarPagina(smal.rect, opzij.rect, 2);
  const u = maakUitsnede(rect, { breedte: 595, hoogte: 842 });
  assert.deepEqual(u.pagina, { x: 300, y: 225, breedte: 295, hoogte: 300 });
  assert.equal(u.breedtePt, 295);
  assert.equal(u.hoogtePt, 300);
});

test('doorlopende weergave: elke pagina in beeld, van boven naar beneden; strookjes vallen weg', () => {
  const venster = { left: 0, top: 0, width: 1000, height: 800 };
  const paginas = [
    { pageNum: 2, rect: { left: 100, top: 500, width: 800, height: 1000 } },
    { pageNum: 1, rect: { left: 100, top: -600, width: 800, height: 1000 } },
    { pageNum: 3, rect: { left: 100, top: 800 - MIN_ZICHTBAAR_PX + 1, width: 800, height: 1000 } },
    { pageNum: 4, rect: { left: 100, top: 2000, width: 800, height: 1000 } },
  ];
  const delen = zichtbareDelen(paginas, venster);
  assert.deepEqual(delen.map((d) => d.pageNum), [1, 2]);
  assert.deepEqual(delen[0].rect, { left: 100, top: 0, width: 800, height: 400 });
  assert.deepEqual(delen[1].rect, { left: 100, top: 500, width: 800, height: 300 });
  assert.deepEqual(zichtbareDelen(paginas, null), []);
});

test('de uitsnede blijft binnen de pagina en volgt de weergaverotatie', () => {
  const m = { breedte: 600, hoogte: 400 };
  const u = maakUitsnede({ x: -5, y: 390, width: 100, height: 50 }, m);
  assert.deepEqual(u.pagina, { x: 0, y: 390, breedte: 95, hoogte: 10 });
  assert.equal(maakUitsnede({ x: 700, y: 0, width: 10, height: 10 }, m), null);
  assert.equal(maakUitsnede(null, m), null);

  // Weergave een kwartslag gedraaid: op het scherm (en op papier) is de
  // uitsnede hoog in plaats van breed.
  const gedraaid = maakUitsnede({ x: 100, y: 50, width: 300, height: 100 }, m, 90);
  assert.equal(gedraaid.rotatie, 90);
  assert.equal(gedraaid.breedtePt, 100);
  assert.equal(gedraaid.hoogtePt, 300);
  assert.equal(maakUitsnede({ x: 0, y: 0, width: 10, height: 10 }, m, 45).rotatie, 0);
});

test('passend op het papier, zonder vervorming, ook als de stand niet past', () => {
  // Een breed detail (300 x 100 pt) op staand A4.
  const u = maakUitsnede({ x: 50, y: 60, width: 300, height: 100 }, { breedte: 595, hoogte: 842 });
  const p = berekenPlaatsing({ papier: A4, orientatie: 'portrait', pagina: { breedtePt: u.breedtePt, hoogtePt: u.hoogtePt } });
  assert.equal(p.gedraaid, true, 'een brede uitsnede komt haaks op een staand vel');
  bijna(p.pagina.breedte / p.pagina.hoogte, u.hoogtePt / u.breedtePt);
  assert.equal(p.afgesneden, false);
  assert.ok(p.pagina.hoogte <= 297 + 1e-6 && p.pagina.breedte <= 210 + 1e-6, 'past op het vel');

  // Automatisch: het vel volgt de uitsnede, liggend, en vergroot tot passend.
  const auto = berekenPlaatsing({ papier: A4, pagina: { breedtePt: u.breedtePt, hoogtePt: u.hoogtePt } });
  assert.equal(auto.vel.orientatie, 'landscape');
  assert.equal(auto.gedraaid, false);
  bijna(auto.pagina.breedte / auto.pagina.hoogte, 3);
  assert.ok(auto.schaal > 2.5, 'een ingezoomd detail wordt vergroot');
});

test('het beeld is 300 dpi op het papier, ook bij vergroten, begrensd op canvasmaat', () => {
  const u = maakUitsnede({ x: 0, y: 0, width: 150, height: 100 }, { breedte: 595, hoogte: 842 });
  const p = berekenPlaatsing({ papier: A4, pagina: { breedtePt: u.breedtePt, hoogtePt: u.hoogtePt } });
  const s = uitsnedePxPerPt(p, u);
  bijna(s, (300 / 72) * p.schaal);
  // Op het papier: pixels / (breedte in inch) = 300.
  const beeld = uitsnedeBeeldMaat(u, s);
  bijna(beeld.breedte / (p.pagina.breedte / 25.4), 300, 1);

  // Een A0-uitsnede op 300 dpi past niet in één canvas: begrensd.
  const groot = { breedtePt: 2384, hoogtePt: 3370, rotatie: 0, pagina: { x: 0, y: 0, breedte: 2384, hoogte: 3370 } };
  const g = uitsnedePxPerPt({ schaal: 1 }, groot);
  assert.ok(groot.hoogtePt * g <= MAX_ZIJDE_PX + 1e-6);
  assert.ok(groot.breedtePt * groot.hoogtePt * g * g <= MAX_BEELD_PX * (1 + 1e-9));
});

test('het rendervak op de hele pagina past precies op de pixelvakken van renderDeel', () => {
  for (const rotatie of [0, 90, 180, 270]) {
    const u = maakUitsnede({ x: 123.4, y: 56.7, width: 210.3, height: 98.6 }, { breedte: 595, hoogte: 842 }, rotatie);
    for (const orientatie of ['auto', 'portrait', 'landscape']) {
      const p = berekenPlaatsing({ papier: A4, orientatie, pagina: { breedtePt: u.breedtePt, hoogtePt: u.hoogtePt } });
      const s = uitsnedePxPerPt(p, u);
      const deel = renderDeel(p, s);
      const beeld = uitsnedeBeeldMaat(u, s);
      // renderDeel werkt op de uitsnede zoals ze op het vel ligt; terug naar
      // de getoonde uitsnede valt het vak binnen het beeld.
      const vol = p.gedraaid ? { breedte: beeld.hoogte, hoogte: beeld.breedte } : beeld;
      assert.ok(deel.px.x >= 0 && deel.px.y >= 0, `${rotatie}/${orientatie}`);
      assert.ok(deel.px.x + deel.px.breedte <= vol.breedte, `${rotatie}/${orientatie} breedte`);
      assert.ok(deel.px.y + deel.px.hoogte <= vol.hoogte, `${rotatie}/${orientatie} hoogte`);

      const vak = uitsnedeRenderVak(u, s);
      const kwart = rotatie === 90 || rotatie === 270;
      assert.equal(kwart ? vak.hoogte : vak.breedte, beeld.breedte);
      assert.equal(kwart ? vak.breedte : vak.hoogte, beeld.hoogte);
      assert.equal(vak.x, Math.floor(123.4 * s));
      assert.equal(vak.y, Math.floor(56.7 * s));
    }
  }
});

test('opzoektabel: elke pagina één keer, in de volgorde van het scherm', () => {
  const u = { breedtePt: 1, hoogtePt: 1 };
  const { paginas, uitsneden } = uitsnedenPerPagina([
    { pageNum: 4, uitsnede: u }, { pageNum: 5, uitsnede: u }, { pageNum: 4, uitsnede: { breedtePt: 9, hoogtePt: 9 } },
    { pageNum: 0, uitsnede: u }, { pageNum: 6, uitsnede: null },
  ]);
  assert.deepEqual(paginas, [4, 5]);
  assert.equal(uitsneden.get(4), u);
  assert.deepEqual(uitsnedenPerPagina(undefined).paginas, []);
});

test('de dialoog biedt Huidige weergave aan en geeft de uitsneden aan beide doelen mee', () => {
  const dlg = readFileSync(new URL('../solid/components/dialogs/PrintDialog.jsx', import.meta.url), 'utf8');
  assert.match(dlg, /onClick=\{\(\) => onRangeChange\('view'\)\}/);
  assert.match(dlg, /t\('print\.currentView'\)/);
  assert.match(dlg, /range: activeRange\(\) === 'view' \? bewaard\.range : activeRange\(\)/);
  assert.equal((dlg.match(/^\s+uitsneden,\r?$/gm) || []).length, 2, 'printer en Opslaan als PDF');
  const job = readFileSync(new URL('./print-job.js', import.meta.url), 'utf8');
  assert.match(job, /if \(uitsneden\?\.size\) throw new Error\('current view prints page images'\)/);
  assert.match(job, /uitsnede \? uitsnedePxPerPt\(plaatsing, uitsnede\) : printPxPerPt\(plaatsing\)/);
  for (const taal of ['en', 'nl']) {
    const t = JSON.parse(readFileSync(new URL(`../i18n/locales/${taal}/dialogs.json`, import.meta.url), 'utf8'));
    assert.ok(t.print.currentView && t.print.currentViewTitle, taal);
  }
});
