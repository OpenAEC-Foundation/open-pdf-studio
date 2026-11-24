// Screenshot dialog rules (Home tab): resolution, size limits, page choice,
// remembered choices and the file name.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESOLUTIES, STANDAARD_KEUZE, MAX_ZIJDE, MAX_PIXELS, MIN_DPI, MAX_DPI,
  normaliseerKeuze, keuzeUitVoorkeuren, keuzeNaarVoorkeuren,
  schermDpi, gekozenDpi, uitvoerMaat, dpiVoorBreedte,
  snijRechthoeken, kiesPagina, tegelRaster, bestandsnaam, mimeType, leesOpnameArgumenten,
} from './screenshot-keuze.js';

test('de resolutiekeuzes: scherm, vaste dpi en eigen waarde', () => {
  assert.deepEqual([...RESOLUTIES], ['screen', 96, 150, 300, 600, 'custom']);
});

test('onbekende of kapotte voorkeuren vallen per veld terug op de standaard', () => {
  assert.deepEqual(normaliseerKeuze(null), { ...STANDAARD_KEUZE });
  assert.deepEqual(normaliseerKeuze({ resolutie: 450, eigenDpi: 'x', formaat: 'gif', kwaliteit: 0, actie: 'print' }),
    { ...STANDAARD_KEUZE });
  assert.deepEqual(normaliseerKeuze({ resolutie: '300', eigenDpi: 720.4, formaat: 'jpeg', kwaliteit: 75, actie: 'save' }),
    { resolutie: 300, eigenDpi: 720, formaat: 'jpeg', kwaliteit: 75, actie: 'save' });
  assert.equal(normaliseerKeuze({ eigenDpi: MAX_DPI + 1 }).eigenDpi, STANDAARD_KEUZE.eigenDpi);
  assert.equal(normaliseerKeuze({ eigenDpi: MIN_DPI }).eigenDpi, MIN_DPI);
});

test('de keuze gaat heen en terug door de voorkeuren', () => {
  const keuze = { resolutie: 'custom', eigenDpi: 450, formaat: 'jpeg', kwaliteit: 80, actie: 'save' };
  const prefs = keuzeNaarVoorkeuren(keuze);
  assert.deepEqual(prefs, {
    screenshotResolution: 'custom', screenshotCustomDpi: 450, screenshotFormat: 'jpeg',
    screenshotJpegQuality: 80, screenshotDefaultAction: 'save',
  });
  assert.deepEqual(keuzeUitVoorkeuren(prefs), keuze);
  assert.deepEqual(keuzeUitVoorkeuren(undefined), { ...STANDAARD_KEUZE });
});

test('schermresolutie = 72 · CSS-px per punt · devicePixelRatio', () => {
  assert.equal(schermDpi(1, 1), 72);
  assert.equal(schermDpi(1.5, 1), 108);
  assert.equal(schermDpi(1.5, 2), 216);
  assert.equal(schermDpi(0, 1), 96, 'onbekende zoom: 96');
  assert.equal(schermDpi(1000, 1), MAX_DPI);
});

test('gekozen dpi volgt de keuze', () => {
  assert.equal(gekozenDpi({ resolutie: 'screen' }, 144), 144);
  assert.equal(gekozenDpi({ resolutie: 300 }, 144), 300);
  assert.equal(gekozenDpi({ resolutie: 'custom', eigenDpi: 1200 }, 144), 1200);
});

test('pixelmaat: A4 bij 300 dpi is 2480 × 3508', () => {
  const m = uitvoerMaat(595.28, 841.89, 300);
  assert.equal(m.breedte, 2480);
  assert.equal(m.hoogte, 3508);
  assert.equal(m.dpi, 300);
  assert.equal(m.beperkt, false);
  assert.ok(Math.abs(m.schaal - 300 / 72) < 1e-9);
});

test('te groot wordt verkleind binnen de grenzen, met de verhouding intact', () => {
  // A0 bij 600 dpi = 19866 × 28087 px: boven beide grenzen.
  const m = uitvoerMaat(2384, 3370, 600);
  assert.equal(m.beperkt, true);
  assert.ok(m.breedte <= MAX_ZIJDE && m.hoogte <= MAX_ZIJDE);
  assert.ok(m.breedte * m.hoogte <= MAX_PIXELS);
  assert.ok(Math.abs(m.breedte / m.hoogte - 2384 / 3370) < 0.001);
  assert.ok(m.dpi < 600);
  // Alleen de zijde: een lange smalle strook.
  const s = uitvoerMaat(10000, 10, 300);
  assert.equal(s.beperkt, true);
  assert.equal(s.breedte, MAX_ZIJDE);
  // Eigen grenzen.
  const k = uitvoerMaat(100, 100, 720, { maxZijde: 500, maxPixels: 1e9 });
  assert.equal(k.breedte, 500);
  assert.equal(k.dpi, 360);
});

test('geen maat voor een leeg gebied of een dpi van nul', () => {
  assert.equal(uitvoerMaat(0, 10, 300), null);
  assert.equal(uitvoerMaat(10, 10, 0), null);
  assert.equal(uitvoerMaat(0.1, 0.1, 10).breedte, 1, 'minstens één pixel');
});

test('dpi uit een gewenste pixelbreedte', () => {
  assert.equal(dpiVoorBreedte(72, 300), 300);
  assert.equal(dpiVoorBreedte(595.28, 1240), 150);
  assert.equal(dpiVoorBreedte(0, 100), null);
  assert.equal(dpiVoorBreedte(1, 1e9), MAX_DPI);
});

test('overlap van twee rechthoeken', () => {
  assert.deepEqual(snijRechthoeken({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 6, width: 10, height: 10 }),
    { left: 5, top: 6, width: 5, height: 4 });
  assert.equal(snijRechthoeken({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 5, height: 5 }), null);
  assert.equal(snijRechthoeken(null, { left: 0, top: 0, width: 1, height: 1 }), null);
});

test('een selectie over twee pagina’s pakt de pagina met de meeste overlap, bijgesneden', () => {
  const paginas = [
    { pageNum: 1, rect: { left: 0, top: 0, width: 600, height: 800 } },
    { pageNum: 2, rect: { left: 0, top: 810, width: 600, height: 800 } },
  ];
  const op1 = kiesPagina({ left: 100, top: 700, width: 200, height: 150 }, paginas);
  assert.equal(op1.pageNum, 1);
  assert.deepEqual(op1.rect, { left: 100, top: 700, width: 200, height: 100 });
  assert.equal(op1.afgesneden, true);
  const op2 = kiesPagina({ left: 100, top: 760, width: 200, height: 150 }, paginas);
  assert.equal(op2.pageNum, 2);
  assert.deepEqual(op2.rect, { left: 100, top: 810, width: 200, height: 100 });
  const binnen = kiesPagina({ left: 10, top: 10, width: 20, height: 20 }, paginas);
  assert.equal(binnen.afgesneden, false);
  assert.equal(kiesPagina({ left: 700, top: 0, width: 50, height: 50 }, paginas), null, 'naast de pagina');
  assert.equal(kiesPagina({ left: 0, top: 0, width: 5, height: 5 }, []), null);
});

test('tegels dekken het hele vlak zonder gaten of overlap', () => {
  const t = tegelRaster(5000, 3000, 2048);
  assert.equal(t.length, 6);
  let opp = 0;
  for (const d of t) {
    assert.ok(d.breedte <= 2048 && d.hoogte <= 2048);
    opp += d.breedte * d.hoogte;
  }
  assert.equal(opp, 5000 * 3000);
  assert.deepEqual(t[t.length - 1], { x: 4096, y: 2048, breedte: 904, hoogte: 952 });
  assert.deepEqual(tegelRaster(10, 10, 2048), [{ x: 0, y: 0, breedte: 10, hoogte: 10 }]);
});

test('bestandsnaam: documentnaam, pagina, dpi en extensie', () => {
  assert.equal(bestandsnaam('C:\\map\\Plattegrond BG.pdf', 3, 300, 'png'), 'Plattegrond BG-p3-300dpi.png');
  assert.equal(bestandsnaam('/a/b/tekening.PDF', 1, 150.4, 'jpeg'), 'tekening-p1-150dpi.jpg');
  assert.equal(bestandsnaam('', 2, 96, 'png'), 'screenshot-p2-96dpi.png');
  assert.equal(bestandsnaam('a:b?.pdf', 1, 72, 'png'), 'a_b_-p1-72dpi.png');
});

test('mime-type per formaat', () => {
  assert.equal(mimeType('png'), 'image/png');
  assert.equal(mimeType('jpeg'), 'image/jpeg');
});

// --- app_capture_region (MCP) ------------------------------------------------

test('MCP-opname: standaard de hele huidige pagina op 150 dpi als PNG', () => {
  assert.deepEqual(leesOpnameArgumenten({}, { aantalPaginas: 4, huidigePagina: 2 }),
    { page: 2, rect: null, dpi: 150, formaat: 'png', kwaliteit: 90, pad: null });
});

test('MCP-opname: gebied, dpi, JPEG met kwaliteit en een pad', () => {
  assert.deepEqual(leesOpnameArgumenten(
    { page: 3, x: 10, y: 20, width: 100, height: 50, dpi: 300, format: 'jpeg', quality: 70, path: 'C:/uit/a.jpg' },
    { aantalPaginas: 4, huidigePagina: 1 }),
  { page: 3, rect: { x: 10, y: 20, width: 100, height: 50 }, dpi: 300, formaat: 'jpeg', kwaliteit: 70, pad: 'C:/uit/a.jpg' });
});

test('MCP-opname: foute invoer geeft een melding', () => {
  const ctx = { aantalPaginas: 2, huidigePagina: 1 };
  assert.match(leesOpnameArgumenten({ page: 3 }, ctx).error, /page 3 out of range/);
  assert.match(leesOpnameArgumenten({ x: 1, y: 2 }, ctx).error, /x, y, width and height together/);
  assert.match(leesOpnameArgumenten({ x: 0, y: 0, width: 0, height: 5 }, ctx).error, /positive/);
  assert.match(leesOpnameArgumenten({ dpi: 5 }, ctx).error, /dpi/);
  assert.match(leesOpnameArgumenten({ format: 'gif' }, ctx).error, /format/);
  assert.match(leesOpnameArgumenten({ quality: 0, format: 'jpeg' }, ctx).error, /quality/);
  assert.match(leesOpnameArgumenten({ path: 'relatief.png' }, ctx).error, /absolute/);
  assert.match(leesOpnameArgumenten({}, { aantalPaginas: 0, huidigePagina: 1 }).error, /no active document/);
});

test('MCP-opname: Windows-, UNC- en Unix-paden zijn absoluut', () => {
  const ctx = { aantalPaginas: 1, huidigePagina: 1 };
  for (const pad of [String.raw`C:\uit\a.png`, 'C:/uit/a.png', String.raw`\\server\deel\a.png`, '/tmp/a.png']) {
    assert.equal(leesOpnameArgumenten({ path: pad }, ctx).pad, pad, pad);
  }
  assert.match(leesOpnameArgumenten({ path: String.raw`uit\a.png` }, ctx).error, /absolute/);
});

test('de actie Plakken wordt onthouden en onbekende acties vallen terug op kopiëren', () => {
  assert.equal(normaliseerKeuze({ actie: 'paste' }).actie, 'paste');
  assert.equal(normaliseerKeuze({ actie: 'plakken' }).actie, 'copy');
});
