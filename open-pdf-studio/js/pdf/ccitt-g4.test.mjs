// Rondgang CCITT G4 (#902): eigen encoder, onafhankelijke decoder (MuPDF).
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { encodeCcittG4, ccittG4Params, CcittOutputLimit } from './ccitt-g4.js';
import { scanBitmap, decodeCcittWithMupdf } from './monochrome.testhulp.mjs';

const stride = (w) => Math.ceil(w / 8);
function bitmap(width, height, pixel) {
  const out = new Uint8Array(stride(width) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixel(x, y)) out[y * stride(width) + (x >> 3)] |= 128 >> (x & 7);
  }
  return out;
}
// Deterministische pseudo-random bron.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
// "Tekstachtig": witte achtergrond met korte zwarte runs in regelbanden.
function textLike(width, height, seed = 1) {
  const r = rng(seed), out = new Uint8Array(stride(width) * height);
  for (let y = 0; y < height; y++) {
    if ((y % 24) > 14) continue; // witregel tussen tekstregels
    let x = Math.floor(r() * 12);
    while (x < width) {
      const black = 1 + Math.floor(r() * 6), white = 1 + Math.floor(r() * (r() < 0.1 ? 60 : 9));
      for (let i = x; i < Math.min(width, x + black); i++) out[y * stride(width) + (i >> 3)] |= 128 >> (i & 7);
      x += black + white;
    }
  }
  return out;
}

const decodeWithMupdf = (encoded, width, height, blackIs1) =>
  decodeCcittWithMupdf(encoded, ccittG4Params(width, height, blackIs1));

// Vergelijkt alleen beeldbits; opvulbits achter de laatste kolom tellen niet.
function assertSameBits(actual, expected, width, height, label) {
  assert.ok(actual.length >= stride(width) * height, `${label}: decoded length ${actual.length}`);
  const tail = width & 7 ? (0xff << (8 - (width & 7))) & 0xff : 0xff;
  for (let y = 0; y < height; y++) for (let i = 0; i < stride(width); i++) {
    const mask = i === stride(width) - 1 ? tail : 0xff;
    const o = y * stride(width) + i;
    if ((actual[o] & mask) !== (expected[o] & mask)) assert.fail(`${label}: row ${y} byte ${i}: ${actual[o]} !== ${expected[o]}`);
  }
}

async function roundTrip(label, width, height, samples) {
  for (const blackIs1 of [false, true]) {
    const encoded = await encodeCcittG4(samples, width, height, { blackIs1 });
    assertSameBits(decodeWithMupdf(encoded, width, height, blackIs1), samples, width, height, `${label} BlackIs1=${blackIs1}`);
  }
}

const cases = [
  ['all white', 64, 32, () => 1],
  ['all black', 64, 32, () => 0],
  ['all white odd width', 13, 7, () => 1],
  ['all black odd width', 13, 7, () => 0],
  ['single pixel', 1, 1, () => 0],
  ['single column', 1, 41, (x, y) => y % 3 === 0],
  ['checkerboard', 64, 64, (x, y) => (x + y) & 1],
  ['checkerboard odd', 37, 29, (x, y) => (x + y) & 1],
  ['coarse checkerboard', 203, 97, (x, y) => ((x >> 3) + (y >> 3)) & 1],
  ['vertical stripes', 100, 30, (x) => (x % 7) < 3],
  ['diagonals (vertical modes)', 150, 150, (x, y) => ((x - y + 600) % 40) < 6 || ((x + y) % 50) < 2],
  ['shifting edges VL3..VR3', 120, 140, (x, y) => x >= 20 + ((y * 37) % 7) - 3 && x < 90 + ((y * 11) % 7) - 3],
  ['random noise', 77, 61, (() => { const r = rng(7); const bits = Array.from({ length: 77 * 61 }, () => r() < 0.5); return (x, y) => bits[y * 77 + x]; })()],
];
for (const [label, width, height, pixel] of cases) {
  test(`G4 round trip via MuPDF is bit-identical: ${label} (${width}x${height})`, async () => {
    await roundTrip(label, width, height, bitmap(width, height, pixel));
  });
}

test('G4 round trip: text-like random runs at widths not divisible by 8', async () => {
  for (const [width, height, seed] of [[1001, 133, 1], [2479, 61, 2], [9, 300, 3], [517, 517, 4]]) {
    await roundTrip(`text ${width}x${height}`, width, height, textLike(width, height, seed));
  }
});

test('G4 round trip: every run length in both colours (terminating, makeup and extended codes)', async () => {
  // Om en om een witte rij en een rij "wit r, zwart (5301 - r), wit". Tegen
  // een witte referentieregel ligt b1 aan het eind, dus die rij gaat in
  // horizontaalmodus: alle witte runs 0..5300 en zwarte runs 1..5301.
  const width = 5313, runs = 5301, height = 2 * runs;
  const samples = new Uint8Array(stride(width) * height).fill(0xff);
  for (let r = 0; r < runs; r++) {
    const y = 2 * r + 1;
    for (let x = r; x < runs; x++) samples[y * stride(width) + (x >> 3)] &= ~(128 >> (x & 7));
  }
  await roundTrip('runs', width, height, samples);
});

test('padding bits after the last column do not matter', async () => {
  const width = 11, height = 5;
  const clean = bitmap(width, height, (x, y) => (x * y) % 3 === 0);
  const dirty = clean.map((v, i) => (i % 2 ? v | 0x1f : v));
  const a = await encodeCcittG4(clean, width, height);
  const b = await encodeCcittG4(dirty, width, height);
  assert.deepEqual(b, a);
});

test('output limit, bad arguments and checkpoints', async () => {
  const width = 64, height = 64;
  const noise = bitmap(width, height, (() => { const r = rng(3); return () => r() < 0.5; })());
  await assert.rejects(encodeCcittG4(noise, width, height, { maxBytes: 16 }), CcittOutputLimit);
  await assert.rejects(encodeCcittG4(new Uint8Array(3), width, height), RangeError);
  await assert.rejects(encodeCcittG4(noise, 0, height), RangeError);
  let calls = 0;
  await encodeCcittG4(noise, width, height, { checkpoint: () => { calls++; }, rowsPerCheckpoint: 16 });
  assert.equal(calls, 3);
});

test('G4 beats Flate on a scan-like bitmap', async (t) => {
  // A4 op 300 dpi; zo'n pagina is in de praktijk vaak als Flate opgeslagen.
  const { width, height, samples } = await scanBitmap({ dpi: 300 });
  const g4 = await encodeCcittG4(samples, width, height, { blackIs1: false });
  const flate = deflateSync(samples, { level: 9 });
  t.diagnostic(`${width}x${height}: raw ${samples.length} B, Flate ${flate.length} B, G4 ${g4.length} B`);
  assert.ok(g4.length < flate.length * 0.75, `G4 ${g4.length} vs Flate ${flate.length}`);
  assertSameBits(decodeWithMupdf(g4, width, height, false), samples, width, height, 'scan');
});
