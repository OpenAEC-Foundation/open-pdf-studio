// Afbeeldingsbron voor stempels en afbeeldingen (#749): het formaat komt uit
// de bytes, een gekozen bestand wordt een data:-URL met het juiste mimetype,
// en wat pdf-lib niet kan insluiten (GIF, BMP, WebP, SVG) wordt PNG.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beeldSoort, mimeVoorPad, mimeVoorBytes, kanPdfInsluiten, insluitBytes,
  bytesUitDataUrl, bytesUitBase64, dataUrlVan, rasterMaat, laadAfbeeldingBytes,
} from './afbeelding-bron.js';

const PNG_KOP = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function png() {
  // Een geldige 1×1-PNG is hier niet nodig: alleen de handtekening telt.
  return new Uint8Array([...PNG_KOP, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const BMP = new Uint8Array([0x42, 0x4d, 0x3a, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('\uFEFF<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

test('het formaat komt uit de bytes', () => {
  assert.equal(beeldSoort(png()), 'png');
  assert.equal(beeldSoort(JPEG), 'jpeg');
  assert.equal(beeldSoort(GIF), 'gif');
  assert.equal(beeldSoort(BMP), 'bmp');
  assert.equal(beeldSoort(WEBP), 'webp');
  assert.equal(beeldSoort(SVG), 'svg');
  assert.equal(beeldSoort(new TextEncoder().encode('<html><body/></html>')), null);
  assert.equal(beeldSoort(new Uint8Array([1, 2])), null);
});

test('alleen PNG en JPEG gaan rechtstreeks de PDF in', () => {
  assert.equal(kanPdfInsluiten('png'), true);
  assert.equal(kanPdfInsluiten('jpeg'), true);
  for (const s of ['gif', 'bmp', 'webp', 'svg', null]) assert.equal(kanPdfInsluiten(s), false);
});

test('mimetype: uit de bytes, met de extensie als terugval', () => {
  assert.equal(mimeVoorPad('C:\\stempels\\logo.SVG'), 'image/svg+xml');
  assert.equal(mimeVoorPad('/home/a/foto.jpeg'), 'image/jpeg');
  assert.equal(mimeVoorPad('/home/a/zonder-extensie'), null);
  // Een SVG met de verkeerde extensie blijft een SVG.
  assert.equal(mimeVoorBytes(SVG, 'logo.png'), 'image/svg+xml');
  assert.equal(mimeVoorBytes(new Uint8Array([0, 0, 0, 0]), 'x.gif'), 'image/gif');
});

test('data:-URL heen en terug', () => {
  const url = dataUrlVan(GIF, 'image/gif');
  assert.match(url, /^data:image\/gif;base64,/);
  assert.deepEqual([...bytesUitDataUrl(url)], [...GIF]);
  assert.deepEqual([...bytesUitDataUrl('data:image/svg+xml,%3Csvg%3E')], [...new TextEncoder().encode('<svg>')]);
});

// De vorige vorm, als referentie: één functieaanroep per byte.
const oud = (tekst) => Uint8Array.from(atob(tekst), (c) => c.charCodeAt(0));

// Draait `fn` met en zonder Uint8Array.fromBase64. Waar node die niet heeft,
// staat er een vervanger die hetzelfde leest of strenger is (Buffer slaat
// ongeldige tekens over, dus die weigert de vervanger zelf).
function metEnZonderFromBase64(fn) {
  const eigen = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  const zet = (waarde) => Object.defineProperty(Uint8Array, 'fromBase64', { value: waarde, configurable: true, writable: true });
  try {
    zet(undefined);
    fn('atob');
    zet(eigen?.value ?? ((tekst) => {
      const kaal = tekst.replace(/[\t\n\f\r ]/g, '');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(kaal)) throw new SyntaxError('invalid base64');
      return new Uint8Array(Buffer.from(kaal, 'base64'));
    }));
    fn('fromBase64');
  } finally {
    if (eigen) Object.defineProperty(Uint8Array, 'fromBase64', eigen);
    else delete Uint8Array.fromBase64;
  }
}

test('base64 naar bytes: dezelfde bytes als de vorige vorm, voor elke lengte', () => {
  metEnZonderFromBase64((route) => {
    // Leeg, lengtes rond een veelvoud van drie, rond de stapgrootte van
    // dataUrlVan, en een paar MB.
    for (const n of [0, 1, 2, 3, 4, 5, 255, 256, 257, 0x8000 - 1, 0x8000, 0x8000 + 1, 100003, 3 * 1024 * 1024 + 1]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 131 + (i >> 8) * 17 + 7) & 255;
      const b64 = Buffer.from(bytes).toString('base64');
      const uit = bytesUitBase64(b64);
      assert.ok(uit instanceof Uint8Array, `${route} ${n}`);
      assert.equal(uit.length, n, `${route} ${n}: lengte`);
      assert.equal(Buffer.compare(Buffer.from(uit), Buffer.from(bytes)), 0, `${route} ${n}: bytes`);
      if (n <= 100003) assert.deepEqual(uit, oud(b64), `${route} ${n}: gelijk aan de vorige vorm`);
      assert.equal(Buffer.compare(Buffer.from(bytesUitDataUrl(`data:image/png;base64,${b64}`)), Buffer.from(bytes)), 0, `${route} ${n}: data-URL`);
    }
    // Alle 256 bytewaarden op elke plek in een groep van drie.
    const alle = Uint8Array.from({ length: 768 }, (_, i) => (i * 85 + (i % 3) * 3) & 255);
    assert.deepEqual(bytesUitBase64(Buffer.from(alle).toString('base64')), alle, route);
    // Wat atob ook leest: zonder opvulling, en met witruimte ertussen.
    for (const tekst of ['QQ', 'QUI', 'QUJD', 'QUJDRA', ' QUJD\nRA==\r\n', 'QU JD']) {
      assert.deepEqual(bytesUitBase64(tekst), oud(tekst), `${route} ${JSON.stringify(tekst)}`);
    }
    // Ongeldige invoer: de fout van atob, zoals voorheen.
    for (const tekst of ['Q', 'QUJDR', 'QUJ*', 'QQ=', 'QQ==QQ==', 'QUJD-_']) {
      assert.throws(() => oud(tekst), undefined, `referentie ${JSON.stringify(tekst)}`);
      let fout = null;
      try { atob(tekst); } catch (e) { fout = e; }
      assert.throws(() => bytesUitBase64(tekst), { name: fout.name }, `${route} ${JSON.stringify(tekst)}`);
    }
  });
});

test('insluiten: PNG en JPEG ongewijzigd, aan de bytes herkend', async () => {
  const geenOmzetting = async () => { throw new Error('mag niet omzetten'); };
  const p = await insluitBytes(dataUrlVan(png(), 'image/png'), { naarPng: geenOmzetting });
  assert.equal(p.isJpeg, false);
  assert.deepEqual([...p.bytes], [...png()]);
  // Het label van de URL telt niet, de bytes wel.
  const j = await insluitBytes(dataUrlVan(JPEG, 'image/png'), { naarPng: geenOmzetting });
  assert.equal(j.isJpeg, true);
});

test('insluiten: GIF, BMP, WebP en SVG worden eerst PNG (anders faalde embedPng)', async () => {
  for (const [bytes, mime] of [[GIF, 'image/gif'], [BMP, 'image/bmp'], [WEBP, 'image/webp'], [SVG, 'image/svg+xml']]) {
    const gezien = [];
    const r = await insluitBytes(dataUrlVan(bytes, mime), {
      naarPng: async (b, m) => { gezien.push(m); return png(); },
    });
    assert.deepEqual(gezien, [mime]);
    assert.equal(r.isJpeg, false);
    assert.equal(beeldSoort(r.bytes), 'png');
  }
});

test('insluiten: een blob:-URL (oude sessiestaat) wordt gelezen en omgezet', async () => {
  const url = URL.createObjectURL(new Blob([GIF]));
  try {
    const r = await insluitBytes(url, { naarPng: async () => png() });
    assert.equal(beeldSoort(r.bytes), 'png');
  } finally {
    URL.revokeObjectURL(url);
  }
});

test('insluiten: zonder omzetting geen stille rommel in de PDF', async () => {
  await assert.rejects(insluitBytes(dataUrlVan(GIF, 'image/gif'), { naarPng: async () => GIF }));
  // Onder node is er geen canvas: de standaardomzetting meldt dat.
  await assert.rejects(insluitBytes(dataUrlVan(GIF, 'image/gif')));
});

test('rastermaat: een vector wordt scherp genoeg, een SVG zonder maat krijgt 300 × 150', () => {
  assert.deepEqual(rasterMaat(0, 0, { vector: true }), { b: 1024, h: 512 });
  assert.deepEqual(rasterMaat(64, 32, { vector: true }), { b: 1024, h: 512 });
  assert.deepEqual(rasterMaat(2000, 1000, { vector: true }), { b: 2000, h: 1000 });
  assert.deepEqual(rasterMaat(64, 32), { b: 64, h: 32 });
});

// Een kale Image en canvas: wat laadAfbeeldingBytes ermee doet.
function metBrowser(fn) {
  const bronnen = [];
  const vorig = { Image: globalThis.Image, document: globalThis.document };
  globalThis.Image = class {
    constructor() { this.naturalWidth = 40; this.naturalHeight = 20; this.complete = false; }
    set src(v) { this._src = v; bronnen.push(v); setTimeout(() => { this.complete = true; this.onload?.(); }, 0); }
    get src() { return this._src; }
  };
  const pngUrl = dataUrlVan(png(), 'image/png');
  const getekend = [];
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: (...a) => getekend.push(a) }),
      toDataURL: (mime) => { assert.equal(mime, 'image/png'); return pngUrl; },
    }),
  };
  return fn({ bronnen, getekend, pngUrl }).finally(() => {
    globalThis.Image = vorig.Image;
    globalThis.document = vorig.document;
  });
}

test('een PNG uit een bestand: data:-URL, geen blob:-URL', () => metBrowser(async ({ bronnen }) => {
  const { img, dataUrl } = await laadAfbeeldingBytes(png(), 'C:/a/stempel.png');
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.equal(img.src, dataUrl);
  assert.ok(bronnen.every((b) => !b.startsWith('blob:')));
}));

test('een SVG uit een bestand laadt als SVG en wordt een PNG voor imageData', () => metBrowser(async ({ bronnen, getekend, pngUrl }) => {
  const { img, dataUrl } = await laadAfbeeldingBytes(SVG, 'C:/a/logo.svg');
  // Eerst geladen MET mimetype: een SVG zonder type laadt niet.
  assert.match(bronnen[0], /^data:image\/svg\+xml;base64,/);
  assert.equal(getekend.length, 1);
  assert.equal(dataUrl, pngUrl);
  assert.equal(img.src, pngUrl);
}));

test('een GIF uit een bestand wordt een PNG voor imageData', () => metBrowser(async ({ pngUrl }) => {
  const { dataUrl } = await laadAfbeeldingBytes(GIF, 'C:/a/anim.gif');
  assert.equal(dataUrl, pngUrl);
}));

