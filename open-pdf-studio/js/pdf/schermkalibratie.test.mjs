// Schermkalibratie voor Werkelijke grootte (issue #520).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import {
  PT_PER_INCH, CSS_PX_PER_INCH, MIN_PX_PER_INCH, MAX_PX_PER_INCH, REFERENTIES,
  dprSleutel, geldigePxPerInch, kalibratieVoor, zetKalibratie, wisKalibratie,
  werkelijkeGrootteZoom, mmNaarSchermPx, pxPerInchUitLengte, zoomNaDprWissel,
} from './schermkalibratie.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const dicht = (a, b, marge = 1e-9) => Math.abs(a - b) <= marge;

test('zonder kalibratie blijft Werkelijke grootte zoom 1 (het oude gedrag)', () => {
  assert.equal(werkelijkeGrootteZoom(undefined), 1);
  assert.equal(werkelijkeGrootteZoom(null), 1);
  assert.equal(werkelijkeGrootteZoom('onzin'), 1);
  assert.equal(kalibratieVoor(undefined, 1), null);
  assert.equal(kalibratieVoor({}, 1.25), null);
});

test('een gekalibreerd scherm zoomt naar pxPerInch / 72', () => {
  assert.equal(PT_PER_INCH, 72);
  assert.ok(dicht(werkelijkeGrootteZoom(96), 96 / 72));
  assert.ok(dicht(werkelijkeGrootteZoom(120), 120 / 72));
});

test('A4 komt na kalibratie op 210 mm breed uit', () => {
  // Scherm met 110 echte CSS-pixels per inch.
  const ppi = 110;
  const zoom = werkelijkeGrootteZoom(ppi);
  const a4BreedtePt = 595.28;
  const cssPx = a4BreedtePt * zoom;
  const mm = (cssPx / ppi) * 25.4;
  assert.ok(dicht(mm, 210, 0.01), `A4 is ${mm} mm`);
});

test('een op het scherm gemeten lengte geeft px per inch', () => {
  // Een lijn van 96 CSS-px die met de liniaal 25,4 mm blijkt: 96 px/in.
  assert.equal(pxPerInchUitLengte(96, 25.4), 96);
  // Balk van 85,6 mm bij 96 px/in = 323,5 px; gemeten 80 mm => groter scherm-px.
  const balk = mmNaarSchermPx(85.6, 96);
  assert.ok(dicht(balk, 323.5275590551181));
  assert.equal(pxPerInchUitLengte(balk, 80), geldigePxPerInch((balk * 25.4) / 80));
  // Komma als decimaalteken.
  assert.equal(pxPerInchUitLengte(96, '25,4'), 96);
});

test('onzinnige metingen leveren geen kalibratie op', () => {
  assert.equal(pxPerInchUitLengte(0, 10), null);
  assert.equal(pxPerInchUitLengte(100, 0), null);
  assert.equal(pxPerInchUitLengte(100, 'abc'), null);
  // Buiten de grenzen (een typefout als 8 mm in plaats van 80 mm).
  assert.equal(pxPerInchUitLengte(323, 8), null);
  assert.equal(geldigePxPerInch(MIN_PX_PER_INCH - 1), null);
  assert.equal(geldigePxPerInch(MAX_PX_PER_INCH + 1), null);
  assert.equal(geldigePxPerInch(CSS_PX_PER_INCH), 96);
});

test('kalibraties worden per schermschaal bewaard', () => {
  assert.equal(dprSleutel(1), '1');
  assert.equal(dprSleutel(1.25), '1.25');
  assert.equal(dprSleutel(1.5000001), '1.5');
  assert.equal(dprSleutel(undefined), '1');
  let k = zetKalibratie({}, 1.25, 120.456);
  assert.deepEqual(k, { '1.25': 120.46 });
  k = zetKalibratie(k, 1, 92);
  assert.equal(kalibratieVoor(k, 1.25), 120.46);
  assert.equal(kalibratieVoor(k, 1), 92);
  assert.equal(kalibratieVoor(k, 2), null);
  const zonder = wisKalibratie(k, 1.25);
  assert.deepEqual(zonder, { '1': 92 });
  assert.deepEqual(k, { '1.25': 120.46, '1': 92 }, 'het origineel blijft ongemoeid');
  assert.throws(() => zetKalibratie({}, 1, 5));
});

test('na een schermwissel volgt Werkelijke grootte het nieuwe scherm', () => {
  const k = { '1': 92, '1.5': 109 };
  // Stond op werkelijke grootte voor scherm 1, nu op scherm 1.5.
  assert.ok(dicht(zoomNaDprWissel(92 / 72, 1, 1.5, k), 109 / 72));
  // Een andere zoom (de gebruiker zat op 200%) blijft staan.
  assert.equal(zoomNaDprWissel(2, 1, 1.5, k), null);
  // Nieuw scherm niet gekalibreerd: zoom blijft staan.
  assert.equal(zoomNaDprWissel(92 / 72, 1, 2, k), null);
  // Zelfde schermschaal: niets te doen.
  assert.equal(zoomNaDprWissel(92 / 72, 1, 1, k), null);
});

test('de referenties in het venster kloppen', () => {
  assert.deepEqual(REFERENTIES.map((r) => r.mm), [85.6, 50, 100]);
});

test('Werkelijke grootte (Ctrl+0 en de knop 100%) gebruikt de kalibratie', () => {
  const renderer = bron('./renderer.js');
  const blok = renderer.slice(renderer.indexOf('export async function actualSize()'));
  const lijf = blok.slice(0, blok.indexOf('\n}\n'));
  assert.match(lijf, /kalibratieVoor\(state\.preferences\?\.screenCalibration/);
  assert.match(lijf, /kalibratie != null\s*\?\s*werkelijkeGrootteZoom\(kalibratie\)/);
  // Zonder kalibratie bepaalt de voorkeur zoomDpi wat 100% is (#523).
  assert.match(lijf, /:\s*cssPxPerPtAt100\(state\.preferences\?\.zoomDpi\)/);
  assert.match(lijf, /setZoomAtPoint\([^)]*, zoom\)/);
  assert.match(lijf, /doc\.scale = zoom;/);
  assert.doesNotMatch(lijf, /doc\.scale = 1;/);
  assert.doesNotMatch(lijf, /, 1\.0\)/);
});

test('de kalibratie raakt print, export en meetschaal niet', () => {
  // Binnen js/pdf (rechtstreeks) en de dialogen lezen alleen de weergavezoom
  // en de kalibratieschermen de kalibratie; print-, export- en meetcode niet.
  const toegestaan = new Set([
    'pdf/schermkalibratie.js', 'pdf/renderer.js', 'pdf/pdf-viewport.js',
    'solid/components/dialogs/ScreenCalibrationDialog.jsx',
    // Een koppeling volgen zet de weergavezoom: /XYZ-zoom is relatief aan de
    // 100% van de app (#1146).
    'pdf/link-layer.js',
  ]);
  const js = new URL('../', import.meta.url);
  const gevonden = [];
  for (const map of ['pdf/', 'solid/components/dialogs/', 'annotations/', 'pdf/saver/']) {
    for (const ent of readdirSync(new URL(map, js), { withFileTypes: true })) {
      if (!ent.isFile() || !/\.(js|jsx|ts)$/.test(ent.name) || /\.test\./.test(ent.name)) continue;
      const tekst = readFileSync(new URL(`${map}${ent.name}`, js), 'utf8');
      if (/screenCalibration|schermkalibratie\.js/.test(tekst)) gevonden.push(`${map}${ent.name}`);
    }
  }
  assert.deepEqual(gevonden.filter((p) => !toegestaan.has(p)), []);
  // De print-dialoog en de tekenschaal-kalibratie zitten er gegarandeerd tussen.
  assert.ok(readdirSync(new URL('solid/components/dialogs/', js)).includes('PrintDialog.jsx'));
  assert.ok(readdirSync(new URL('solid/components/dialogs/', js)).includes('CalibrationDialog.jsx'));
});

test('het voorkeurenvenster en de dialoog zijn gekoppeld', () => {
  const host = bron('../solid/components/DialogHost.jsx');
  assert.match(host, /'screen-calibration': ScreenCalibrationDialog/);
  const tab = bron('../solid/components/preferences/PageDisplayTab.jsx');
  assert.match(tab, /openDialog\('screen-calibration'/);
  assert.match(tab, /p\.screenCalibration\[1\]\(zetKalibratie\(/);
  const standaard = bron('../core/constants.ts');
  assert.match(standaard, /screenCalibration: \{\},/);
});
