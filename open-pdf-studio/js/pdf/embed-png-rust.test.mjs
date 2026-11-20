// embedPngSnel(): het contract tussen embed-png-rust.js en het commando
// `png_naar_xobject`, gelijke woordenboeken en pixels als embedPng van de
// PDF-bibliotheek, en de terugval op JavaScript.
//
// De Rust-kant zelf: `cargo test -p open-pdf-image` op de vaste gevallen uit
// beeld-gevallen.testhulp.mjs; beeld-gevallen.test.mjs houdt dat bestand
// gelijk aan de JS-route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import {
  maakEmbedPng, parsePngXObjectResponse, embedPngSnel, kiesPngRoute,
  MIN_PIXELS, MIN_PIXELS_KLEINE_PNG, MAX_BYTES_PER_PIXEL_KLEINE_PNG, MAX_BYTES_PER_PIXEL,
} from './embed-png-rust.js';
import { RUST_STANDAARD } from './rust-routes.js';
import { makeBeeldRust } from './beeld-rust.js';
import { maakPng, pngInvoer, pngKanalenJs, rng, concat } from './beeld-gevallen.testhulp.mjs';

// Het antwoord van het commando, in JS nagebouwd (opmaak: png_xobject::response).
function antwoord({ width, height, rgb, alpha }) {
  const kop = new Uint8Array(20);
  const v = new DataView(kop.buffer);
  kop.set([1, 8, 1, alpha ? 1 : 0]);
  v.setUint32(4, width, true); v.setUint32(8, height, true);
  v.setUint32(12, rgb.length, true); v.setUint32(16, alpha ? alpha.length : 0xffffffff, true);
  return concat([kop, rgb, alpha ?? new Uint8Array(0)]);
}
const skip = (reden) => concat([Uint8Array.of(0), new TextEncoder().encode(reden)]);

// Zelfde stappen als open-pdf-image: uitpakken tot RGB en alfa, beide Flate.
function referentie(calls = []) {
  return async (png) => {
    calls.push(png);
    const k = await pngKanalenJs(png);
    return antwoord({ width: k.width, height: k.height, rgb: Uint8Array.from(deflateSync(k.rgb)), alpha: k.alpha ? Uint8Array.from(deflateSync(k.alpha)) : null });
  };
}

function beeld(width, height, colorType, seed = 1, alfa = null) {
  const r = rng(seed);
  const n = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const data = new Uint8Array(width * height * n);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  if (alfa) for (let i = 0; i < width * height; i++) data[i * n + n - 1] = alfa(i);
  return maakPng({ width, height, colorType, depth: 8, data, filters: (rij) => rij % 5 });
}

// Het woordenboek zonder /Length, en de uitgepakte inhoud.
async function ingesloten(doc, image) {
  await image.embed();
  const stream = doc.context.lookup(image.ref);
  const dict = (s) => [...s.dict.entries()].filter(([k]) => k !== PDFName.of('Length')).map(([k, v]) => `${k} ${v}`);
  const inhoud = (s) => Uint8Array.from(inflateSync(s.getContents()));
  const maskerRef = stream.dict.get(PDFName.of('SMask'));
  const masker = maskerRef ? doc.context.lookup(maskerRef) : null;
  return {
    ref: image.ref.toString(), dict: dict(stream), rgb: inhoud(stream),
    maskerDict: masker ? dict(masker) : null, alpha: masker ? inhoud(masker) : null,
    width: image.width, height: image.height,
  };
}

test('zelfde woordenboeken en pixels als embedPng, met en zonder alfa', async () => {
  const gevallen = [
    ['rgb', beeld(40, 30, 2, 1)],
    ['rgba-dekkend', beeld(40, 30, 6, 2, () => 255)],
    ['rgba', beeld(40, 30, 6, 3)],
    ['grijs-alfa', beeld(17, 9, 4, 4)],
    ['grijs', beeld(17, 9, 0, 5)],
  ];
  for (const [naam, png] of gevallen) {
    const calls = [];
    const snel = maakEmbedPng({ native: async () => referentie(calls), minPixels: 1 });
    const docJs = await PDFDocument.create();
    const docRust = await PDFDocument.create();
    // Twee beelden na elkaar: ook de objectnummers moeten gelijk lopen.
    const js = [await docJs.embedPng(png), await docJs.embedPng(png)];
    const rust = [await snel(docRust, png), await snel(docRust, png)];
    assert.equal(calls.length, 2, naam);
    assert.equal(rust[0].constructor, js[0].constructor, naam);
    for (let i = 0; i < 2; i++) {
      const a = await ingesloten(docJs, js[i]);
      const b = await ingesloten(docRust, rust[i]);
      assert.deepEqual(b.dict, a.dict, `${naam}: woordenboek`);
      assert.deepEqual(b.maskerDict, a.maskerDict, `${naam}: woordenboek van het masker`);
      assert.deepEqual(b.rgb, a.rgb, `${naam}: RGB`);
      assert.deepEqual(b.alpha, a.alpha, `${naam}: alfa`);
      assert.deepEqual([b.ref, b.width, b.height], [a.ref, a.width, a.height], naam);
    }
    assert.ok(docRust.context.lookup(rust[0].ref) instanceof PDFRawStream, naam);
  }
});

test('het document met zo\'n beeld is op te slaan en te heropenen', async () => {
  const png = beeld(40, 30, 6, 7);
  const snel = maakEmbedPng({ native: async () => referentie(), minPixels: 1 });
  const doc = await PDFDocument.create();
  const image = await snel(doc, png);
  doc.addPage([200, 200]).drawImage(image, { x: 10, y: 10, width: 80, height: 60 });
  const terug = await PDFDocument.load(await doc.save());
  const xobjecten = terug.context.enumerateIndirectObjects().map(([, o]) => o).filter((o) => o.dict?.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  assert.equal(xobjecten.length, 2);
  const kanalen = await pngKanalenJs(png);
  const kleur = xobjecten.find((o) => o.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB'));
  const masker = xobjecten.find((o) => o.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceGray'));
  assert.deepEqual(Uint8Array.from(inflateSync(kleur.contents)), kanalen.rgb);
  assert.deepEqual(Uint8Array.from(inflateSync(masker.contents)), kanalen.alpha);
  assert.equal(kleur.dict.get(PDFName.of('Length')).asNumber(), kleur.contents.length);
});

test('terugval op embedPng: geen route, overslaan, klein, zestien bit, geïnterlinieerd, tekenreeks', async () => {
  const png = beeld(40, 30, 6, 8);
  const doc = await PDFDocument.create();
  const isJs = (image) => image.embedder.image.rgbChannel instanceof Uint8Array;

  assert.ok(isJs(await maakEmbedPng({ native: async () => null, minPixels: 1 })(doc, png)), 'geen route');

  const calls = [];
  const overslaan = maakEmbedPng({ native: async () => async (b) => { calls.push(b); return skip('transparency-or-animation'); }, minPixels: 1 });
  assert.ok(isJs(await overslaan(doc, png)), 'Rust stuurt het terug');
  assert.ok(isJs(await overslaan(doc, png)));
  assert.equal(calls.length, 2, 'overslaan zet de route niet uit');

  const teller = [];
  const metGrens = maakEmbedPng({ native: async () => referentie(teller) });
  assert.ok(isJs(await metGrens(doc, png)), 'onder de grens');
  // Ruis van 0,3 MP: genoeg pixels voor een kleine PNG, maar te veel bytes per pixel.
  const ruis = beeld(600, 500, 0, 9);
  assert.ok(ruis.length > 600 * 500 * MAX_BYTES_PER_PIXEL_KLEINE_PNG);
  assert.ok(isJs(await metGrens(doc, ruis)), 'foto-achtig onder 1 MP');
  assert.equal(teller.length, 0);
  // Een vlak grijs beeld van 0,3 MP: weinig bytes per pixel, dus naar Rust.
  const vlak = maakPng({ width: 600, height: 500, colorType: 0, depth: 8, data: new Uint8Array(600 * 500).fill(200), zlib: (b) => Uint8Array.from(deflateSync(b)) });
  assert.ok(vlak.length <= 600 * 500 * MAX_BYTES_PER_PIXEL_KLEINE_PNG && 600 * 500 === MIN_PIXELS_KLEINE_PNG);
  assert.ok(!isJs(await metGrens(doc, vlak)), 'op de grens voor een kleine PNG gaat het naar Rust');
  assert.equal(teller.length, 1);
  // De schakelaar: uit is JavaScript, 'altijd' laat de grenzen vallen.
  try {
    globalThis.__opdsRustPng = false;
    assert.ok(isJs(await metGrens(doc, vlak)), 'window.__opdsRustPng = false');
    assert.equal(teller.length, 1);
    globalThis.__opdsRustPng = 'altijd';
    assert.ok(!isJs(await metGrens(doc, png)), "window.__opdsRustPng = 'altijd'");
    assert.equal(teller.length, 2);
  } finally {
    delete globalThis.__opdsRustPng;
  }
  teller.length = 1;

  const alles = maakEmbedPng({ native: async () => referentie(teller), minPixels: 1 });
  const zestien = pngInvoer().find((p) => p.naam === 'png-skip-16-rgb').png;
  const interlaced = pngInvoer().find((p) => p.naam === 'png-skip-interlaced').png;
  assert.ok(isJs(await alles(doc, zestien)), 'zestien bit');
  assert.ok(isJs(await alles(doc, interlaced)), 'geïnterlinieerd');
  assert.ok(isJs(await alles(doc, `data:image/png;base64,${Buffer.from(png).toString('base64')}`)), 'tekenreeks');
  assert.equal(teller.length, 1, 'die gaan niet over de grens');
  assert.ok(!isJs(await alles(doc, png.buffer.slice(png.byteOffset, png.byteOffset + png.length))), 'ArrayBuffer mag wel');
  await assert.rejects(alles(doc, Uint8Array.of(1, 2, 3)), 'geen PNG: de fout van embedPng zelf');
});

test('een fout van de aanroep: één waarschuwing, daarna JavaScript', async () => {
  const png = beeld(40, 30, 2, 10);
  const doc = await PDFDocument.create();
  const meldingen = [];
  let aanroepen = 0;
  for (const kapot of [async () => { aanroepen++; throw new Error('weg'); }, async () => { aanroepen++; return Uint8Array.of(1, 8, 1); }, async () => { aanroepen++; return Uint8Array.of(7); }]) {
    meldingen.length = 0; aanroepen = 0;
    const snel = maakEmbedPng({ native: async () => kapot, warn: (...a) => meldingen.push(a), minPixels: 1 });
    for (let i = 0; i < 3; i++) {
      const image = await snel(doc, png);
      assert.ok(image.embedder.image.rgbChannel instanceof Uint8Array);
    }
    assert.equal(aanroepen, 1);
    assert.equal(meldingen.length, 1);
  }
});

test('parsePngXObjectResponse: opmaak en afkeuren', () => {
  const rgb = Uint8Array.of(1, 2, 3), alpha = Uint8Array.of(9, 8);
  const p = parsePngXObjectResponse(antwoord({ width: 3, height: 2, rgb, alpha }).buffer);
  assert.deepEqual([p.width, p.height, p.bits], [3, 2, 8]);
  assert.deepEqual([...p.rgb], [1, 2, 3]);
  assert.deepEqual([...p.alpha], [9, 8]);
  assert.equal(parsePngXObjectResponse(antwoord({ width: 3, height: 2, rgb, alpha: null })).alpha, null);
  assert.equal(parsePngXObjectResponse(skip('interlaced')), null);
  const kort = antwoord({ width: 3, height: 2, rgb, alpha });
  assert.throws(() => parsePngXObjectResponse(kort.subarray(0, kort.length - 1)));
  const vlag = antwoord({ width: 3, height: 2, rgb, alpha }); vlag[3] = 0;
  assert.throws(() => parsePngXObjectResponse(vlag));
  assert.throws(() => parsePngXObjectResponse('nee'));
});

test('makeBeeldRust: of de backend de route aanbiedt', async () => {
  const core = (antwoord) => ({ invoke: async (cmd) => { if (cmd === 'beeld_rust_beschikbaar') { if (antwoord instanceof Error) throw antwoord; return antwoord; } return 'x'; } });
  assert.deepEqual(await makeBeeldRust(null), { png: false, invoke: null });
  assert.deepEqual(await makeBeeldRust(core(new Error('unknown command'))), { png: false, invoke: null });
  assert.deepEqual(await makeBeeldRust(core(true)), { png: false, invoke: null });
  // Bit 0 is de PNG-route; OPDS_RUST_PNG_EMBED=0 geeft 0.
  for (const [bits, png] of [[0, false], [1, true], [2, false], [3, true]]) {
    const r = await makeBeeldRust(core(bits));
    assert.equal(r.png, png);
    assert.equal(await r.invoke('iets'), 'x');
  }
});

test('zonder desktop-backend is embedPngSnel gewoon embedPng', async () => {
  const doc = await PDFDocument.create();
  const image = await embedPngSnel(doc, beeld(256, 256, 6, 11));
  assert.ok(image.embedder.image.rgbChannel instanceof Uint8Array);
});

// Gemeten in de echte app (18-11-2026, met de echte oversteek tussen WebView
// en Rust): pixels, PNG-bytes per pixel, en de winst van Rust tegenover
// embedPng (laagste en hoogste van de klasse). Onder 1 is Rust trager. De
// eerdere meting met een oversteek van 1 ms als model gaf 2,2 tot 12,3 keer
// vanaf 32.768 pixels; dat hield in de app geen stand.
const GEMETEN = [
  // klein, elke soort
  [32768, 2, 0.69, 0.69], [60000, 2, 1.0, 1.0], [131072, 2, 1.0, 1.0],
  // foto-achtig: 1,6 tot 2,5 PNG-bytes per pixel
  [260000, 1.6, 1.05, 1.14], [310000, 2.5, 1.05, 1.14], [520000, 2, 1.23, 1.23],
  [1050000, 2, 2.0, 2.0], [4000000, 1.6, 2.4, 2.8], [20000000, 2.5, 2.4, 2.8],
  // weinig bytes per pixel: grijs, palet, vlakke tekening
  [310000, 0.5, 1.8, 2.4], [310000, 0.05, 1.8, 2.4], [4000000, 0.5, 4.8, 6.8], [20000000, 0.05, 4.8, 6.8],
];

test('kiesPngRoute: Rust alleen in de klassen die in de echte app 1,3 keer winnen', () => {
  assert.equal(RUST_STANDAARD.png, true);
  assert.deepEqual([MIN_PIXELS, MIN_PIXELS_KLEINE_PNG, MAX_BYTES_PER_PIXEL_KLEINE_PNG, MAX_BYTES_PER_PIXEL], [1000000, 300000, 0.5, 64]);
  for (const [pixels, perPixel, laagste, hoogste] of GEMETEN) {
    const route = kiesPngRoute({ pixels, pngBytes: Math.floor(pixels * perPixel) });
    assert.equal(route, laagste >= 1.3 ? 'rust' : 'js', `${pixels} px, ${perPixel} bytes per pixel (${laagste}-${hoogste}x)`);
  }
  // De twee ondergrenzen.
  assert.equal(kiesPngRoute({ pixels: MIN_PIXELS, pngBytes: MIN_PIXELS * 4 }), 'rust');
  assert.equal(kiesPngRoute({ pixels: MIN_PIXELS - 1, pngBytes: MIN_PIXELS * 4 }), 'js');
  assert.equal(kiesPngRoute({ pixels: MIN_PIXELS_KLEINE_PNG, pngBytes: MIN_PIXELS_KLEINE_PNG / 2 }), 'rust');
  assert.equal(kiesPngRoute({ pixels: MIN_PIXELS_KLEINE_PNG, pngBytes: MIN_PIXELS_KLEINE_PNG / 2 + 1 }), 'js');
  assert.equal(kiesPngRoute({ pixels: MIN_PIXELS_KLEINE_PNG - 1, pngBytes: 1000 }), 'js', 'onder 0,3 MP niet gemeten');
  // Een PNG die vooral uit iets anders dan beeld bestaat, gaat niet over.
  assert.equal(kiesPngRoute({ pixels: 2e6, pngBytes: 2e6 * MAX_BYTES_PER_PIXEL }), 'rust');
  assert.equal(kiesPngRoute({ pixels: 2e6, pngBytes: 2e6 * MAX_BYTES_PER_PIXEL + 1 }), 'js');
  assert.equal(kiesPngRoute({ pixels: 250e6, pngBytes: 1e9 }), 'rust', 'geen bovengrens');
  // De schakelaar.
  assert.equal(kiesPngRoute({ pixels: 20e6, pngBytes: 1e6 }, false), 'js');
  assert.equal(kiesPngRoute({ pixels: 1000, pngBytes: 5000 }, 'altijd'), 'rust');
  assert.equal(kiesPngRoute({ pixels: 1000, pngBytes: 5000 }, true), 'js');
});
