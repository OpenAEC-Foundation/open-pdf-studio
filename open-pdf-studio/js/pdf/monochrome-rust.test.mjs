// Rust-route van de monochroommodus (#902): het contract tussen
// monochrome-image.js en het commando `monochroom_beeld`, de keuzeregel met de
// complete streamgrootte en de terugval op JS. De Rust-crate zelf heeft eigen
// tests (cargo test -p open-pdf-monochrome) en scripts/bench-rust/
// 09-monochrome.mjs vergelijkt de echte Rust-uitvoer met deze JS-route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { optimizeMonochromeImage } from './monochrome-image.js';
import { encodeCcittG4, CcittOutputLimit } from './ccitt-g4.js';
import { parseMonochromeResponse, makeMonochromeNative } from './monochrome-rust.js';
import { scanBitmap } from './monochrome.testhulp.mjs';

// Dezelfde stappen en regels als open-pdf-monochrome/src/lib.rs, in JS, zodat
// de parameters en de grootteregel (base - 1 + cijfers(n) + n) te toetsen zijn.
function referenceNative(calls = []) {
  return async (input, p) => {
    calls.push(p);
    let samples = input;
    if (p.flateSource) {
      try { samples = Uint8Array.from(inflateSync(input)); } catch { return { filter: null, reason: 'invalid-image-data' }; }
      if (samples.length > p.decodedSize) return { filter: null, reason: 'decoded-or-output-limit' };
    }
    if (samples.length !== p.decodedSize) return { filter: null, reason: 'invalid-sample-length' };
    let packed = samples;
    if (p.bits === 8) {
      if (!p.decodeOk) return { filter: null, reason: 'unsupported-decode' };
      const stride = Math.ceil(p.width / 8);
      packed = new Uint8Array(stride * p.height);
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        const i = (y * p.width + x) * p.channels, v = samples[i];
        if ((v !== 0 && v !== 255) || (p.channels === 3 && (samples[i + 1] !== v || samples[i + 2] !== v))) return { filter: null, reason: 'not-black-and-white' };
        if (v === 255) packed[y * stride + (x >> 3)] |= 128 >> (x & 7);
      }
    }
    let flate = Uint8Array.from(deflateSync(packed));
    if (flate.length > p.outputCap) flate = null;
    let ccitt = null;
    if (p.ccittFits) {
      try { ccitt = await encodeCcittG4(packed, p.width, p.height, { blackIs1: p.blackIs1, maxBytes: flate ? flate.length : p.outputCap }); } catch (e) { if (!(e instanceof CcittOutputLimit)) throw e; }
    }
    if (!flate && !ccitt) return { filter: null, reason: 'decoded-or-output-limit' };
    const size = (base, n) => base - 1 + String(n).length + n;
    let best = null, after = Infinity;
    for (const [filter, data, base] of [['FlateDecode', flate, p.flateBase], ['CCITTFaxDecode', ccitt, p.ccittBase]]) {
      if (data && size(base, data.length) < after) { best = { filter, data }; after = size(base, data.length); }
    }
    if (after >= p.before) return { filter: null, reason: 'not-smaller' };
    return { ...best, reason: null, flateLength: flate?.length ?? null, ccittLength: ccitt?.length ?? null, after };
  };
}

async function imageStream({ width, height, bits = 1, colorSpace = 'DeviceGray', data, flate = true, values = {} }) {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: bits, ColorSpace: colorSpace, ...values });
  if (flate) dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  // Ongecomprimeerde Flate-blokken: er valt dus altijd iets te winnen.
  return PDFRawStream.of(dict, flate ? Uint8Array.from(deflateSync(data, { level: 0 })) : data);
}

const unpack = (packed, width, height, channels) => {
  const stride = Math.ceil(width / 8), out = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (packed[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    out.fill(v, (y * width + x) * channels, (y * width + x + 1) * channels);
  }
  return out;
};

test('the native route gives the same decision, size and dictionary as the JS route', async () => {
  // Op 300 dpi wint G4 van Flate (zie ccitt-g4.test.mjs).
  const scan = await scanBitmap({ dpi: 300, lines: 20 });
  const small = await scanBitmap({ dpi: 150, lines: 20 });
  const cases = [
    ['one-bit scan (G4 wins)', { width: scan.width, height: scan.height, data: scan.samples }],
    ['one-bit scan, Decode [1 0]', { width: scan.width, height: scan.height, data: scan.samples, values: { Decode: [1, 0] } }],
    ['one-bit flat white (Flate wins)', { width: 300, height: 300, data: new Uint8Array(38 * 300).fill(255), flate: false }],
    ['eight-bit gray scan', { width: scan.width, height: scan.height, bits: 8, data: unpack(scan.samples, scan.width, scan.height, 1), values: { DL: 1 } }],
    // Kleiner: een 300 dpi-RGB-pagina past niet in het werkgeheugenbudget.
    ['eight-bit RGB scan', { width: small.width, height: small.height, bits: 8, colorSpace: 'DeviceRGB', data: unpack(small.samples, small.width, small.height, 3) }],
    ['eight-bit gray, invalid Decode', { width: 16, height: 4, bits: 8, data: new Uint8Array(64).fill(255), values: { Decode: [0, 0.5] } }],
    ['eight-bit gray, not black and white', { width: 16, height: 4, bits: 8, data: new Uint8Array(64).fill(128) }],
    ['one-bit, short samples', { width: 64, height: 4, data: new Uint8Array(31) }],
  ];
  const filters = [];
  for (const [label, spec] of cases) {
    const stream = await imageStream(spec);
    const calls = [];
    const viaJs = await optimizeMonochromeImage(stream, { allowRgb: true });
    const viaNative = await optimizeMonochromeImage(stream, { allowRgb: true, native: referenceNative(calls) });
    assert.equal(calls.length, 1, `${label}: native called once`);
    assert.equal(viaNative.reason, viaJs.reason, `${label}: reason`);
    assert.equal(viaNative.filter, viaJs.filter, `${label}: filter`);
    assert.equal(viaNative.before, viaJs.before, `${label}: before`);
    assert.equal(viaNative.after, viaJs.after, `${label}: after`);
    if (viaJs.replacement) {
      assert.equal(viaNative.replacement.dict.toString(), viaJs.replacement.dict.toString(), `${label}: dictionary`);
      assert.deepEqual(viaNative.replacement.getContents(), viaJs.replacement.getContents(), `${label}: data`);
    }
    filters.push(viaJs.filter ?? viaJs.reason);
  }
  assert.deepEqual(filters, ['CCITTFaxDecode', 'CCITTFaxDecode', 'FlateDecode', 'CCITTFaxDecode', 'CCITTFaxDecode',
    'unsupported-decode', 'not-black-and-white', 'invalid-sample-length']);
});

test('the native size rule matches the serialized candidate size', async () => {
  const scan = await scanBitmap({ dpi: 100, lines: 20 });
  const stream = await imageStream({ width: scan.width, height: scan.height, data: scan.samples });
  let answer = null;
  const native = referenceNative();
  const result = await optimizeMonochromeImage(stream, { native: async (input, p) => (answer = await native(input, p)) });
  assert.ok(result.replacement);
  assert.equal(result.after, answer.after);
  assert.equal(result.replacement.sizeInBytes(), answer.after);
});

test('a failing native encoder falls back to JS with one warning', async () => {
  const scan = await scanBitmap({ dpi: 100, lines: 10 });
  const stream = await imageStream({ width: scan.width, height: scan.height, data: scan.samples });
  const viaJs = await optimizeMonochromeImage(stream);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const failing = async () => { throw new Error('command not found'); };
    const a = await optimizeMonochromeImage(stream, { native: failing });
    const b = await optimizeMonochromeImage(stream, { native: failing });
    for (const r of [a, b]) {
      assert.equal(r.filter, viaJs.filter);
      assert.deepEqual(r.replacement.getContents(), viaJs.replacement.getContents());
    }
  } finally { console.warn = warn; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /command not found/);
});

test('an aborted run stays aborted after the native call', async () => {
  const scan = await scanBitmap({ dpi: 60, lines: 5 });
  const stream = await imageStream({ width: scan.width, height: scan.height, data: scan.samples });
  const controller = new AbortController();
  const native = async (input, p) => { controller.abort(); return referenceNative()(input, p); };
  await assert.rejects(optimizeMonochromeImage(stream, { signal: controller.signal, native }), { name: 'AbortError' });
});

test('response parsing: skip, Flate and CCITT with lengths', () => {
  const skip = Uint8Array.from([0, ...new TextEncoder().encode('not-smaller')]);
  assert.deepEqual(parseMonochromeResponse(skip.buffer), { filter: null, reason: 'not-smaller', data: null });
  const flate = new Uint8Array(9 + 3);
  flate[0] = 1; new DataView(flate.buffer).setUint32(1, 3, true); new DataView(flate.buffer).setUint32(5, 0xffffffff, true);
  flate.set([7, 8, 9], 9);
  const parsed = parseMonochromeResponse(flate.buffer);
  assert.equal(parsed.filter, 'FlateDecode');
  assert.equal(parsed.flateLength, 3);
  assert.equal(parsed.ccittLength, null);
  assert.deepEqual([...parsed.data], [7, 8, 9]);
  flate[0] = 2;
  assert.equal(parseMonochromeResponse(Array.from(flate)).filter, 'CCITTFaxDecode');
  assert.throws(() => parseMonochromeResponse(Uint8Array.from([9])), TypeError);
  assert.throws(() => parseMonochromeResponse(Uint8Array.from([1, 0])), TypeError);
});

test('the Tauri wrapper probes once, sends a raw body with a header, and is null when unavailable', async () => {
  const sent = [];
  const core = {
    invoke: async (cmd, args, options) => {
      sent.push({ cmd, args, options });
      if (cmd === 'monochroom_rust_beschikbaar') return true;
      return Uint8Array.from([0, ...new TextEncoder().encode('not-smaller')]).buffer;
    },
  };
  const native = await makeMonochromeNative(core);
  const input = Uint8Array.from([1, 2, 3]);
  assert.deepEqual(await native(input, { width: 1 }), { filter: null, reason: 'not-smaller', data: null });
  assert.equal(sent[1].cmd, 'monochroom_beeld');
  assert.equal(sent[1].args, input, 'the stream bytes go as the raw body');
  assert.deepEqual(JSON.parse(sent[1].options.headers['x-opds-monochroom']), { width: 1 });
  assert.equal(await makeMonochromeNative({ invoke: async () => false }), null, 'OPDS_RUST_MONOCHROME=0');
  assert.equal(await makeMonochromeNative({ invoke: async () => { throw new Error('unknown command'); } }), null, 'older backend');
  assert.equal(await makeMonochromeNative(undefined), null, 'no Tauri');
});
