// Vaste gevallen voor de pariteit tussen de JS-route en de crate
// open-pdf-image (PNG naar XObject).
//
// bouwGevallen() geeft de bytes van open-pdf-image/tests/fixtures/gevallen.bin:
// per geval de invoer zoals het Rust-commando die krijgt en wat de JS-route
// ervan maakt. `cargo test -p open-pdf-image` eist dezelfde uitkomst van Rust;
// de unit-tests eisen dat het bestand gelijk is aan wat deze module nu maakt
// (dus dat het bestand de JS-route van vandaag beschrijft). Opnieuw schrijven:
//   node scripts/bench-rust/beeld-golden.mjs
//
// Alles is hier byte-vast: eigen zlib-schrijver (opgeslagen blokken) in
// plaats van die van node, en een vaste toevalsreeks.

import { PDFDocument } from 'pdf-lib';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function concat(delen) {
  let n = 0;
  for (const d of delen) n += d.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const d of delen) { out.set(d, o); o += d.length; }
  return out;
}

/** zlib-stroom met opgeslagen blokken: voor elke invoer altijd dezelfde bytes. */
export function zlibStored(data) {
  const delen = [Uint8Array.of(0x78, 0x01)];
  let o = 0;
  do {
    const n = Math.min(65535, data.length - o);
    delen.push(Uint8Array.of(o + n >= data.length ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255), data.subarray(o, o + n));
    o += n;
  } while (o < data.length);
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  delen.push(Uint8Array.of(b >> 8, b & 255, a >> 8, a & 255));
  return concat(delen);
}

/** PNG-rijfilters toepassen; `kies(rij)` geeft het filtertype 0..4. */
export function pngFilter(data, rowLen, bpp, kies) {
  const rows = Math.floor(data.length / rowLen);
  const out = new Uint8Array(rows * (rowLen + 1));
  for (let r = 0; r < rows; r++) {
    const type = kies(r);
    out[r * (rowLen + 1)] = type;
    for (let i = 0; i < rowLen; i++) {
      const x = data[r * rowLen + i];
      const a = i >= bpp ? data[r * rowLen + i - bpp] : 0;
      const b = r > 0 ? data[(r - 1) * rowLen + i] : 0;
      const c = r > 0 && i >= bpp ? data[(r - 1) * rowLen + i - bpp] : 0;
      let p = 0;
      if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); }
      out[r * (rowLen + 1) + 1 + i] = (x - p) & 255;
    }
  }
  return out;
}

const KANALEN = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Een PNG van ruwe, per rij opgevulde samples.
 * @param {object} o - colorType 0/2/3/4/6, depth 1/2/4/8/16, data, palette, trns,
 *   interlace, filters (rij -> type), zlib (standaard opgeslagen blokken), extra
 *   (blokken vóór IDAT, als [naam, bytes])
 */
export function maakPng({ width, height, colorType, depth, data, palette = null, trns = null, interlace = 0, filters = () => 0, zlib = zlibStored, extra = [] }) {
  const bitsPerPixel = KANALEN[colorType] * depth;
  const rowLen = Math.ceil((width * bitsPerPixel) / 8);
  const blok = (naam, bytes) => {
    const kop = new Uint8Array(8 + bytes.length);
    new DataView(kop.buffer).setUint32(0, bytes.length);
    for (let i = 0; i < 4; i++) kop[4 + i] = naam.charCodeAt(i);
    kop.set(bytes, 8);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(kop.subarray(4)));
    return concat([kop, crc]);
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height);
  ihdr[8] = depth; ihdr[9] = colorType; ihdr[12] = interlace;
  const delen = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), blok('IHDR', ihdr)];
  if (palette) delen.push(blok('PLTE', palette));
  if (trns) delen.push(blok('tRNS', trns));
  for (const [naam, bytes] of extra) delen.push(blok(naam, bytes));
  delen.push(blok('IDAT', zlib(pngFilter(data, rowLen, Math.max(1, bitsPerPixel >> 3), filters))), blok('IEND', new Uint8Array(0)));
  return concat(delen);
}

const willekeurig = (r, n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = Math.floor(r() * 256); return o; };

// --------------------------------------------------------------- PNG-gevallen

/** @returns {{ naam: string, png: Uint8Array, skip: boolean }[]} */
export function pngInvoer() {
  const r = rng(20261118);
  const uit = [];
  const maten = [[1, 1], [13, 7], [31, 17]];
  const soorten = [
    [0, 1], [0, 2], [0, 4], [0, 8], [2, 8], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [6, 8],
  ];
  for (const [width, height] of maten) {
    for (const [colorType, depth] of soorten) {
      const rowLen = Math.ceil((width * KANALEN[colorType] * depth) / 8);
      const data = willekeurig(r, rowLen * height);
      const palette = colorType === 3 ? willekeurig(r, 3 * (1 << depth)) : null;
      uit.push({ naam: `png-${width}x${height}-t${colorType}-d${depth}`, skip: false, png: maakPng({ width, height, colorType, depth, data, palette, filters: (rij) => rij % 5 }) });
    }
  }
  // Alfa overal 255: geen alfastream. En één pixel doorzichtig.
  for (const [naam, alfa] of [['dekkend', () => 255], ['een-pixel', (i) => (i === 40 ? 254 : 255)], ['nul', () => 0]]) {
    const data = willekeurig(r, 13 * 7 * 4);
    for (let i = 0; i < 13 * 7; i++) data[i * 4 + 3] = alfa(i);
    uit.push({ naam: `png-rgba-${naam}`, skip: false, png: maakPng({ width: 13, height: 7, colorType: 6, depth: 8, data, filters: (rij) => 4 - (rij % 5) }) });
    const ga = willekeurig(r, 13 * 7 * 2);
    for (let i = 0; i < 13 * 7; i++) ga[i * 2 + 1] = alfa(i);
    uit.push({ naam: `png-ga-${naam}`, skip: false, png: maakPng({ width: 13, height: 7, colorType: 4, depth: 8, data: ga, filters: () => 4 }) });
  }
  // Te kort palet: een index erbuiten geeft zwart.
  uit.push({ naam: 'png-palet-kort', skip: false, png: maakPng({ width: 13, height: 7, colorType: 3, depth: 8, data: willekeurig(r, 13 * 7).map((b) => b % 40), palette: willekeurig(r, 3 * 20) }) });
  // Extra blokken die niets aan de pixels doen.
  uit.push({ naam: 'png-gamma-tekst', skip: false, png: maakPng({ width: 5, height: 3, colorType: 2, depth: 8, data: willekeurig(r, 45), extra: [['gAMA', Uint8Array.of(0, 0, 0xb1, 0x8f)], ['tEXt', Uint8Array.of(65, 0, 66)]] }) });

  // Wat naar JavaScript gaat.
  const s = (naam, o) => uit.push({ naam, skip: true, png: maakPng(o) });
  s('png-skip-16-grijs', { width: 5, height: 3, colorType: 0, depth: 16, data: willekeurig(r, 30) });
  s('png-skip-16-rgb', { width: 5, height: 3, colorType: 2, depth: 16, data: willekeurig(r, 90) });
  s('png-skip-16-rgba', { width: 5, height: 3, colorType: 6, depth: 16, data: willekeurig(r, 120) });
  s('png-skip-palet-trns', { width: 5, height: 3, colorType: 3, depth: 8, data: willekeurig(r, 15).map((b) => b % 4), palette: willekeurig(r, 12), trns: Uint8Array.of(0, 128) });
  s('png-skip-grijs-trns', { width: 5, height: 3, colorType: 0, depth: 8, data: willekeurig(r, 15), trns: Uint8Array.of(0, 7) });
  s('png-skip-rgb-trns', { width: 5, height: 3, colorType: 2, depth: 8, data: willekeurig(r, 45), trns: Uint8Array.of(0, 1, 0, 2, 0, 3) });
  // Eén pixel: de zeven doorgangen vallen samen met het gewone beeld.
  s('png-skip-interlaced', { width: 1, height: 1, colorType: 2, depth: 8, data: Uint8Array.of(1, 2, 3), interlace: 1 });
  s('png-skip-animatie', { width: 5, height: 3, colorType: 2, depth: 8, data: willekeurig(r, 45), extra: [['acTL', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0)]] });
  return uit;
}

/** Wat embedPng van de PDF-bibliotheek van een PNG maakt. */
export async function pngKanalenJs(png) {
  const doc = await PDFDocument.create();
  const beeld = await doc.embedPng(png);
  const { rgbChannel, alphaChannel, width, height } = beeld.embedder.image;
  return { width, height, rgb: rgbChannel, alpha: alphaChannel ?? null };
}

/** De bytes van open-pdf-image/tests/fixtures/gevallen.bin. */
export async function bouwGevallen() {
  const tekst = new TextEncoder();
  const delen = [];
  const deel = (bytes) => {
    const n = new Uint8Array(4);
    new DataView(n.buffer).setUint32(0, bytes.length, true);
    delen.push(n, bytes);
  };
  const geval = (naam, kop, body, verwacht) => { deel(tekst.encode(naam)); deel(tekst.encode(kop)); deel(body); deel(verwacht); };
  for (const p of pngInvoer()) {
    if (p.skip) { geval(p.naam, 'png', p.png, tekst.encode('skip')); continue; }
    const k = await pngKanalenJs(p.png);
    geval(p.naam, 'png', p.png, concat([Uint8Array.of(k.alpha ? 1 : 0), k.rgb, k.alpha ?? new Uint8Array(0)]));
  }
  geval('einde', '', new Uint8Array(0), new Uint8Array(0));
  return concat(delen);
}

// ------------------------------------------------- grote beelden (benchmark)
// Voor scripts/bench-rust/12-beeld.mjs.

/** Gemengde inhoud: vlakken, verlopen, ruis en lijnen; n kanalen. */
export function benchSamples(width, height, n, seed = 1) {
  const out = new Uint8Array(width * height * n);
  let s = seed >>> 0;
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tegel = ((x >> 8) * 7 + (y >> 8) * 13 + seed) % 5;
      const lijn = (x + y) % 97 < 2 || (x * 3 - y + 100000) % 211 < 2;
      for (let c = 0; c < n; c++, o++) {
        let v;
        if (lijn) v = 20 + c * 9;
        else if (tegel === 0) v = 255;
        else if (tegel === 1) v = (40 + c * 60 + (x >> 8) * 31) & 255;
        else if (tegel === 2) v = (x + y * 2 + c * 80) & 255;
        else if (tegel === 3) { s = (s * 1664525 + 1013904223) >>> 0; v = 100 + (s >>> 26) + ((x >> 3) & 31); }
        else v = 250 - ((x ^ y) & 7);
        out[o] = v;
      }
    }
  }
  return out;
}

/** Alfa: grotendeels dekkend, een doorzichtige rand en zachte overgangen. */
export function benchAlfa(width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++, o++) {
      const rand = Math.min(x, y, width - 1 - x, height - 1 - y);
      out[o] = rand < 16 ? rand * 16 : ((x >> 7) + (y >> 7)) % 6 === 0 ? 128 + ((x + y) & 63) : 255;
    }
  }
  return out;
}

/** Een RGBA-PNG zoals een canvas die geeft; `alfa` false = overal dekkend. */
export function benchPng({ width, height, alfa, zlib }) {
  const rgb = benchSamples(width, height, 3, width);
  const a = alfa ? benchAlfa(width, height) : null;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0, p = 0; i < width * height; i++) {
    data[o++] = rgb[p++]; data[o++] = rgb[p++]; data[o++] = rgb[p++]; data[o++] = a ? a[i] : 255;
  }
  return maakPng({ width, height, colorType: 6, depth: 8, data, filters: () => 1, zlib });
}
