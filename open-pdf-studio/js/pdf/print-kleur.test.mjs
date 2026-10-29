import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KLEUR_MODI, KLEUR_STANDAARD, ZWART_WIT_DREMPEL, geldigeKleurModus, zetKleurOm, luminantie,
  zetPixelsOm, zetCanvasOm, beeldFormaatVoor, vectorMogelijk,
} from './print-kleur.js';

const rgba = (...pixels) => Uint8ClampedArray.from(pixels.flat());

test('de kleurmodi en hun standaard', () => {
  assert.deepEqual([...KLEUR_MODI], ['color', 'grayscale', 'bw']);
  assert.equal(KLEUR_STANDAARD, 'color');
  for (const m of KLEUR_MODI) assert.equal(geldigeKleurModus(m), m);
  for (const kapot of [undefined, null, '', 'gray', 'BW', 3]) assert.equal(geldigeKleurModus(kapot), 'color');
  assert.equal(zetKleurOm('color'), false);
  assert.equal(zetKleurOm('onbekend'), false);
  assert.equal(zetKleurOm('grayscale'), true);
  assert.equal(zetKleurOm('bw'), true);
});

test('luminantie volgt BT.601', () => {
  assert.equal(luminantie(0, 0, 0), 0);
  assert.equal(luminantie(255, 255, 255), 255);
  assert.equal(luminantie(255, 0, 0), 76);
  assert.equal(luminantie(0, 255, 0), 150);
  assert.equal(luminantie(0, 0, 255), 29);
  assert.equal(luminantie(100, 100, 100), 100, 'grijs blijft grijs');
});

test('kleur laat de pixels ongemoeid', () => {
  const data = rgba([255, 0, 0, 255], [10, 20, 30, 40]);
  const kopie = Uint8ClampedArray.from(data);
  assert.equal(zetPixelsOm(data, 'color'), data);
  assert.deepEqual(data, kopie);
  zetPixelsOm(data, 'iets anders');
  assert.deepEqual(data, kopie);
});

test('grijswaarden: elke pixel krijgt haar luminantie, alfa blijft', () => {
  const data = rgba([255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0], [255, 255, 255, 255]);
  zetPixelsOm(data, 'grayscale');
  assert.deepEqual([...data], [
    76, 76, 76, 255,
    150, 150, 150, 128,
    29, 29, 29, 0,
    255, 255, 255, 255,
  ]);
});

test('zwart-wit: puur zwart of puur wit tegen de drempel, alfa blijft', () => {
  assert.equal(ZWART_WIT_DREMPEL, 128);
  const data = rgba(
    [255, 0, 0, 255], // 76 → zwart
    [0, 255, 0, 255], // 150 → wit
    [128, 128, 128, 200], // precies de drempel → wit
    [127, 127, 127, 255], // net eronder → zwart
    [255, 255, 0, 255], // geel, 226 → wit
  );
  zetPixelsOm(data, 'bw');
  assert.deepEqual([...data], [
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 200,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  for (let i = 0; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255);
  // Een eigen drempel.
  const licht = rgba([200, 200, 200, 255]);
  zetPixelsOm(licht, 'bw', { drempel: 220 });
  assert.deepEqual([...licht], [0, 0, 0, 255]);
});

test('werkt ook op een gewone array en een onvolledige laatste pixel', () => {
  const data = [255, 0, 0, 255, 9, 9];
  zetPixelsOm(data, 'grayscale');
  assert.deepEqual(data, [76, 76, 76, 255, 9, 9]);
});

// Een canvas zonder DOM: alleen wat zetCanvasOm gebruikt.
function nepCanvas(breedte, hoogte, vul) {
  const pixels = new Uint8ClampedArray(breedte * hoogte * 4);
  for (let i = 0; i < breedte * hoogte; i++) pixels.set(vul(i), i * 4);
  const banden = [];
  const ctx = {
    getImageData(x, y, w, h) {
      banden.push([y, h]);
      return { data: pixels.slice((y * breedte + x) * 4, ((y + h) * breedte) * 4) };
    },
    putImageData(beeld, x, y) {
      pixels.set(beeld.data, (y * breedte + x) * 4);
    },
  };
  let contexten = 0;
  return {
    width: breedte,
    height: hoogte,
    pixels,
    banden,
    get contexten() { return contexten; },
    getContext() { contexten += 1; return ctx; },
  };
}

test('zetCanvasOm zet het hele canvas om en raakt het bij kleur niet aan', () => {
  const kleur = nepCanvas(3, 2, () => [255, 0, 0, 255]);
  assert.equal(zetCanvasOm(kleur, 'color'), kleur);
  assert.equal(kleur.contexten, 0);
  assert.deepEqual([...kleur.pixels.slice(0, 4)], [255, 0, 0, 255]);

  const grijs = nepCanvas(3, 2, (i) => (i % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
  assert.equal(zetCanvasOm(grijs, 'grayscale'), grijs);
  for (let i = 0; i < 6; i++) {
    const v = i % 2 ? 29 : 76;
    assert.deepEqual([...grijs.pixels.slice(i * 4, i * 4 + 4)], [v, v, v, 255]);
  }
  const zw = nepCanvas(2, 2, (i) => (i < 2 ? [250, 250, 250, 255] : [20, 40, 60, 255]));
  zetCanvasOm(zw, 'bw');
  assert.deepEqual([...zw.pixels], [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  // Een leeg canvas of geen canvas: niets te doen.
  assert.equal(zetCanvasOm(null, 'bw'), null);
  const leeg = nepCanvas(0, 0, () => []);
  zetCanvasOm(leeg, 'bw');
  assert.equal(leeg.contexten, 0);
});

test('een groot canvas gaat in banden die samen elke rij precies één keer dekken', () => {
  const breedte = 3000;
  const hoogte = 3000; // 9 Mpx: meer dan één band
  const c = nepCanvas(breedte, hoogte, () => [0, 0, 0, 255]);
  zetCanvasOm(c, 'grayscale');
  assert.ok(c.banden.length > 1);
  let volgende = 0;
  for (const [y, h] of c.banden) {
    assert.equal(y, volgende);
    volgende = y + h;
  }
  assert.equal(volgende, hoogte);
});

test('beeldformaat en vectorweg per modus', () => {
  assert.equal(beeldFormaatVoor('color'), 'jpeg');
  assert.equal(beeldFormaatVoor('grayscale'), 'jpeg');
  assert.equal(beeldFormaatVoor('bw'), 'png', 'JPEG zou de randen weer grijs maken');
  assert.equal(vectorMogelijk('color'), true);
  assert.equal(vectorMogelijk(undefined), true);
  assert.equal(vectorMogelijk('grayscale'), false);
  assert.equal(vectorMogelijk('bw'), false);
});

// ── Vertalingen ──────────────────────────────────────────────────────────────
const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');
const SLEUTELS = ['colorMode', 'colorModeColor', 'colorModeGrayscale', 'colorModeBlackWhite'];
const printBlok = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'dialogs.json'), 'utf8')).print || {};

test('elke taal heeft de teksten van de kleurmodus, niet leeg en niet het Engels', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = printBlok('en');
  const gekopieerd = [];
  for (const locale of locales) {
    const blok = printBlok(locale);
    for (const sleutel of SLEUTELS) {
      assert.ok(typeof blok[sleutel] === 'string' && blok[sleutel].trim(), `${locale} print.${sleutel}`);
      if (locale !== 'en' && blok[sleutel] === en[sleutel]) gekopieerd.push(`${locale} print.${sleutel}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});

test('de printdialoog toont elke kleurmodus en geeft de keuze aan voorbeeld en afdruk', () => {
  const bron = readFileSync(join(HIER, '../solid/components/dialogs/PrintDialog.jsx'), 'utf8');
  for (const sleutel of SLEUTELS) assert.ok(bron.includes(`'print.${sleutel}'`), sleutel);
  assert.match(bron, /colorMode: geldigeKleurModus\(colorMode\(\)\)/, 'onthouden');
  assert.equal((bron.match(/kleur: geldigeKleurModus\(colorMode\(\)\)/g) || []).length, 2, 'printer en Opslaan als PDF');
  assert.equal((bron.match(/\{ markeringen, kleur \}/g) || []).length, 3, 'alle voorbeelden');
});
