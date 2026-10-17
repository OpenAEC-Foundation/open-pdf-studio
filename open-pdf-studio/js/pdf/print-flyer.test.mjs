// Folders (#607): kopieën van dezelfde pagina op één vel, klaar om te snijden,
// met dezelfde vel- en celregels als meerdere pagina's per vel, en de
// volgorde-aanwijzer in het voorbeeld.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFArray, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  rasterVan, flyerRaster, isFlyer, FLYER, FLYER_AANTALLEN, aantalVellen, paginasOpVel,
  voorbeeldMeerPerBlad, maakMeerPerBlad, snijtekensVoorCellen, volgordeAanwijzer, BLAD_MARGE_PT,
} from './print-meerperblad.js';
import { berekenPlaatsing, printPaginaMaat } from './print-plaatsing.js';

const PT_PER_MM = 72 / 25.4;
const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const A4 = { breedtePt: 210 * PT_PER_MM, hoogtePt: 297 * PT_PER_MM };
const KEUZES = { papier: A4_VEL, orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };

function bijna(werkelijk, verwacht, speling = 1e-6, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

// --- folder: kopieën van dezelfde pagina -----------------------------------------

test('flyerRaster: 2, 4, 6, 8, 9 en 16 kopieën; onbekend = 4', () => {
  assert.equal(FLYER, 'flyer');
  assert.equal(isFlyer('flyer'), true);
  assert.equal(isFlyer('4'), false);
  assert.deepEqual(Object.keys(FLYER_AANTALLEN).map(Number), [2, 4, 6, 8, 9, 16]);
  for (const [n, [k, r]] of Object.entries(FLYER_AANTALLEN)) {
    const raster = flyerRaster(n);
    assert.equal(raster.kolommen * raster.rijen, Number(n));
    assert.deepEqual([raster.kolommen, raster.rijen], [k, r]);
    assert.equal(raster.flyer, true);
    assert.equal(raster.draaibaar, true);
  }
  assert.deepEqual([flyerRaster('x').kolommen, flyerRaster('x').rijen], [2, 2]);
});

test('folder: elk vel draagt alleen kopieën van één pagina', () => {
  const raster = flyerRaster(4);
  assert.equal(aantalVellen(3, raster), 3);
  assert.deepEqual(paginasOpVel([7, 8, 9], 0, raster), [7, 7, 7, 7]);
  assert.deepEqual(paginasOpVel([7, 8, 9], 2, raster), [9, 9, 9, 9]);
  assert.deepEqual(paginasOpVel([7, 8, 9], 3, raster), []);
});

test('folder-voorbeeld: vier gelijke cellen, niet overlappend, met snijtekens', () => {
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...flyerRaster(4), snijtekens: true },
    keuzes: KEUZES,
    eerstePagina: A4,
    paginas: Array(4).fill(A4),
  });
  assert.equal(v.cellen.length, 4);
  const maat = v.cellen[0].opVel;
  for (const c of v.cellen) {
    bijna(c.opVel.breedte, maat.breedte);
    bijna(c.opVel.hoogte, maat.hoogte);
  }
  assert.ok(v.snijtekens.length > 0, 'snijtekens in het voorbeeld');
  const zonder = voorbeeldMeerPerBlad({
    meerPerBlad: flyerRaster(4), keuzes: KEUZES, eerstePagina: A4, paginas: Array(4).fill(A4),
  });
  assert.deepEqual(zonder.snijtekens, []);
});

test('snijtekens: in de witrand, op het verlengde van elke paginarand, nooit over een pagina', () => {
  const bladB = 297 * PT_PER_MM;
  const bladH = 210 * PT_PER_MM;
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...flyerRaster(2), snijtekens: true }, keuzes: KEUZES, eerstePagina: A4, paginas: [A4, A4],
  });
  bijna(v.vel.breedteMm, 297, 1e-6);
  // De cellen in pt, PDF-coördinaten (oorsprong linksonder).
  const cellen = v.cellen.map((c) => ({
    x: c.opVel.x * PT_PER_MM,
    y: (v.vel.hoogteMm - c.opVel.y - c.opVel.hoogte) * PT_PER_MM,
    breedte: c.opVel.breedte * PT_PER_MM,
    hoogte: c.opVel.hoogte * PT_PER_MM,
  }));
  const tekens = snijtekensVoorCellen({ bladB, bladH, cellen });
  const verticaal = tekens.filter((s) => Math.abs(s.x1 - s.x2) < 1e-9);
  const horizontaal = tekens.filter((s) => Math.abs(s.y1 - s.y2) < 1e-9);
  assert.equal(verticaal.length + horizontaal.length, tekens.length);
  const randenX = [...new Set(cellen.flatMap((c) => [c.x, c.x + c.breedte]).map((x) => x.toFixed(3)))].sort();
  const randenY = [...new Set(cellen.flatMap((c) => [c.y, c.y + c.hoogte]).map((y) => y.toFixed(3)))].sort();
  assert.deepEqual([...new Set(verticaal.map((s) => s.x1.toFixed(3)))].sort(), randenX);
  assert.deepEqual([...new Set(horizontaal.map((s) => s.y1.toFixed(3)))].sort(), randenY);
  assert.equal(verticaal.length, randenX.length * 2, 'boven en onder');
  assert.equal(horizontaal.length, randenY.length * 2, 'links en rechts');
  for (const s of tekens) {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
      assert.ok(x >= 0 && x <= bladB && y >= 0 && y <= bladH, 'binnen het vel');
    }
    const binnenMarge = (a, b, max) => Math.max(a, b) <= BLAD_MARGE_PT + 1e-6 || Math.min(a, b) >= max - BLAD_MARGE_PT - 1e-6;
    assert.ok(verticaal.includes(s) ? binnenMarge(s.y1, s.y2, bladH) : binnenMarge(s.x1, s.x2, bladB), 'in de witrand');
    for (const c of cellen) {
      const raakt = Math.max(s.x1, s.x2) > c.x + 1e-6 && Math.min(s.x1, s.x2) < c.x + c.breedte - 1e-6
        && Math.max(s.y1, s.y2) > c.y + 1e-6 && Math.min(s.y1, s.y2) < c.y + c.hoogte - 1e-6;
      assert.ok(!raakt, 'snijteken over een pagina');
    }
  }
});

// --- de folder-PDF ----------------------------------------------------------------

function stroomTekst(stroom) {
  const bytes = stroom instanceof PDFRawStream ? decodePDFRawStream(stroom).decode() : stroom.getContents();
  return Buffer.from(bytes).toString('latin1');
}

/** De getekende vormen (XObjects) van een vel, in tekenvolgorde: hun /BBox-maat. */
function getekendeVormen(blad) {
  const c = blad.node.Contents();
  const stromen = c instanceof PDFArray ? c.asArray().map((r) => blad.doc.context.lookup(r)) : [c];
  const tekst = stromen.map(stroomTekst).join('\n');
  const xo = blad.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  return [...tekst.matchAll(/\/(\S+) Do/g)].map((m) => {
    const vorm = blad.doc.context.lookup(xo.get(PDFName.of(m[1])));
    const bbox = vorm.dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map((n) => n.asNumber());
    return `${Math.round(bbox[2] - bbox[0])}x${Math.round(bbox[3] - bbox[1])}`;
  });
}

test('maakMeerPerBlad als folder: per bronpagina één vel met N kopieën van die pagina', async () => {
  const bron = await PDFDocument.create();
  bron.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  bron.addPage([600, 800]).drawRectangle({ x: 20, y: 20, width: 60, height: 60 });
  const uit = await maakMeerPerBlad(bron, { ...flyerRaster(4), papier: A4_VEL, orientatie: 'auto', snijtekens: true });
  const herladen = await PDFDocument.load(await uit.save());
  assert.equal(herladen.getPageCount(), 2, 'één vel per bronpagina');
  assert.deepEqual(getekendeVormen(herladen.getPage(0)), Array(4).fill('595x842'));
  assert.deepEqual(getekendeVormen(herladen.getPage(1)), Array(4).fill('600x800'));
  // Snijtekens: lijnen in de inhoud van het vel.
  const c = herladen.getPage(0).node.Contents();
  const tekst = (c instanceof PDFArray ? c.asArray().map((r) => herladen.context.lookup(r)) : [c]).map(stroomTekst).join('\n');
  assert.ok((tekst.match(/\bl\b/g) || []).length >= 8, 'snijtekens getekend');

  const zonder = await maakMeerPerBlad(bron, { ...flyerRaster(8), papier: A4_VEL });
  const z = await PDFDocument.load(await zonder.save());
  assert.equal(z.getPageCount(), 2);
  assert.equal(getekendeVormen(z.getPage(1)).length, 8);
});

test('folder: voorbeeld = afdruk, vel en cellen op dezelfde plek', async () => {
  for (const [aantal, orientatie] of [[2, 'auto'], [4, 'portrait'], [8, 'auto'], [6, 'portrait'], [16, 'landscape']]) {
    const raster = flyerRaster(aantal);
    const keuzes = { ...KEUZES, orientatie };
    const plaatsing = berekenPlaatsing({ ...keuzes, pagina: A4 });
    const maat = printPaginaMaat(plaatsing);
    const doc = await PDFDocument.create();
    doc.addPage(maat).drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
    const uit = await PDFDocument.load(await (await maakMeerPerBlad(doc, { ...raster, papier: A4_VEL, orientatie })).save());
    const v = voorbeeldMeerPerBlad({ meerPerBlad: raster, keuzes, eerstePagina: A4, paginas: Array(aantal).fill(A4) });
    const blad = uit.getPage(0);
    bijna(v.vel.breedteMm * PT_PER_MM, blad.getWidth(), 1e-3, `${aantal}/${orientatie} breedte`);
    bijna(v.vel.hoogteMm * PT_PER_MM, blad.getHeight(), 1e-3, `${aantal}/${orientatie} hoogte`);
    if (orientatie === 'portrait') assert.ok(blad.getWidth() < blad.getHeight());
    if (orientatie === 'landscape') assert.ok(blad.getWidth() > blad.getHeight());
    assert.equal(getekendeVormen(blad).length, aantal);
  }
});

// --- volgorde-aanwijzer in het voorbeeld -----------------------------------------

test('volgordeAanwijzer: een nummer midden in elke cel en pijlen van cel naar cel', () => {
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...rasterVan({ perBlad: '4' }), volgorde: 'horizontal' },
    keuzes: KEUZES, eerstePagina: A4, paginas: Array(4).fill(A4),
  });
  const a = volgordeAanwijzer(v.cellen);
  assert.equal(a.merken.length, 4);
  assert.ok(a.straal > 0);
  a.merken.forEach((m, i) => {
    const c = v.cellen[i].opVel;
    assert.equal(m.k, v.cellen[i].k);
    bijna(m.x, c.x + c.breedte / 2);
    bijna(m.y, c.y + c.hoogte / 2);
    assert.ok(a.straal * 2 < Math.min(c.breedte, c.hoogte), 'het merk past in de cel');
  });
  assert.equal(a.pijlen.length, 3);
  a.pijlen.forEach((p, i) => {
    const van = a.merken[i];
    const naar = a.merken[i + 1];
    // Begint buiten het merk van de ene cel, eindigt buiten dat van de volgende.
    assert.ok(Math.hypot(p.x1 - van.x, p.y1 - van.y) >= a.straal - 1e-9);
    assert.ok(Math.hypot(p.x2 - naar.x, p.y2 - naar.y) >= a.straal - 1e-9);
    // Op de lijn van middelpunt naar middelpunt, in die richting.
    const dx = naar.x - van.x;
    const dy = naar.y - van.y;
    bijna((p.x2 - p.x1) * dy - (p.y2 - p.y1) * dx, 0, 1e-6, 'op één lijn');
    assert.ok((p.x2 - p.x1) * dx + (p.y2 - p.y1) * dy > 0, 'in de leesrichting');
  });
  // Horizontaal: 1 → 2 naar rechts, dan schuin terug naar 3 (een Z).
  assert.ok(a.pijlen[0].x2 > a.pijlen[0].x1 && Math.abs(a.pijlen[0].y2 - a.pijlen[0].y1) < 1e-9);
  assert.ok(a.pijlen[1].x2 < a.pijlen[1].x1 && a.pijlen[1].y2 > a.pijlen[1].y1);
});

test('volgordeAanwijzer: verticaal loopt de eerste pijl naar beneden; één cel = geen pijl', () => {
  const v = voorbeeldMeerPerBlad({
    meerPerBlad: { ...rasterVan({ perBlad: '4' }), volgorde: 'vertical' },
    keuzes: KEUZES, eerstePagina: A4, paginas: Array(4).fill(A4),
  });
  const a = volgordeAanwijzer(v.cellen);
  assert.ok(a.pijlen[0].y2 > a.pijlen[0].y1 && Math.abs(a.pijlen[0].x2 - a.pijlen[0].x1) < 1e-9);
  const een = volgordeAanwijzer(v.cellen.slice(0, 1));
  assert.equal(een.merken.length, 1);
  assert.deepEqual(een.pijlen, []);
  assert.deepEqual(volgordeAanwijzer([]).merken, []);
});

test('de volgorde-aanwijzer komt nooit in de afdruk: maakMeerPerBlad kent hem niet', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const bron = readFileSync(join(hier, 'print-meerperblad.js'), 'utf8');
  const maak = bron.slice(bron.indexOf('export async function maakMeerPerBlad'));
  assert.doesNotMatch(maak, /volgordeAanwijzer/);
  const job = readFileSync(join(hier, 'print-job.js'), 'utf8');
  assert.doesNotMatch(job, /volgordeAanwijzer/);
});

test('alle locales hebben de folder-, katern- en volgordeteksten, vertaald en met dezelfde plaatshouders', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const map = join(hier, '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8')).print;
  const sleutels = [
    'perSheetFlyer', 'flyerCopies', 'flyerCutMarks', 'flyerNote',
    'bookletSignature', 'bookletSignatureAll', 'bookletSignatureInfo',
  ];
  const plaatshouders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const en = lees('en');
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const p = lees(taal);
    for (const sleutel of sleutels) {
      const tekst = p[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} print.${sleutel}: plaatshouders`);
      if (taal !== 'en') assert.notEqual(tekst, en[sleutel], `${taal} print.${sleutel} is niet vertaald`);
    }
  }
  const dialoog = readFileSync(join(hier, '../solid/components/dialogs/PrintDialog.jsx'), 'utf8');
  for (const sleutel of sleutels) assert.match(dialoog, new RegExp(`['"\`]print\\.${sleutel}['"\`]`), `${sleutel} niet gebruikt`);
});

