// CCITT Groep 4-encoder (ITU-T T.6) voor één-bit beelden (#902).
//
// Eigen implementatie, geschreven naar de T.4/T.6-specificatie: zuiver
// tweedimensionaal coderen (pass-, horizontaal- en verticaalmodus) met als
// eerste referentieregel een denkbeeldige witte regel, zonder EOL's per regel
// en zonder byte-uitlijning, afgesloten met EOFB (twee EOL's). In PDF-termen
// past de uitvoer bij /CCITTFaxDecode met
//   << /K -1 /Columns <breedte> /Rows <hoogte> /BlackIs1 <...> /EncodedByteAlign false >>
// (EndOfBlock staat op de standaardwaarde true).
//
// Invoer zijn gepakte samples zoals in een PDF-beeldstream: elke rij begint op
// een byte, meest significante bit eerst. Opvulbits achter de laatste kolom
// tellen niet mee. `blackIs1` zegt welke samplewaarde in de codering "zwart"
// heet: true = bit 1 is zwart, false = bit 0 is zwart. Een decoder levert met
// dezelfde /BlackIs1 exact dezelfde samplebits terug; /Decode en de
// kleurruimte van het beeld blijven dus gewoon gelden.

// Codetabellen als [code, lengte]. Index = runlengte (0..63) voor de
// eindcodes, (runlengte / 64) - 1 voor de opbouwcodes.
const WHITE_TERM = [
  [0x35, 8], [0x07, 6], [0x07, 4], [0x08, 4], [0x0b, 4], [0x0c, 4], [0x0e, 4], [0x0f, 4],
  [0x13, 5], [0x14, 5], [0x07, 5], [0x08, 5], [0x08, 6], [0x03, 6], [0x34, 6], [0x35, 6],
  [0x2a, 6], [0x2b, 6], [0x27, 7], [0x0c, 7], [0x08, 7], [0x17, 7], [0x03, 7], [0x04, 7],
  [0x28, 7], [0x2b, 7], [0x13, 7], [0x24, 7], [0x18, 7], [0x02, 8], [0x03, 8], [0x1a, 8],
  [0x1b, 8], [0x12, 8], [0x13, 8], [0x14, 8], [0x15, 8], [0x16, 8], [0x17, 8], [0x28, 8],
  [0x29, 8], [0x2a, 8], [0x2b, 8], [0x2c, 8], [0x2d, 8], [0x04, 8], [0x05, 8], [0x0a, 8],
  [0x0b, 8], [0x52, 8], [0x53, 8], [0x54, 8], [0x55, 8], [0x24, 8], [0x25, 8], [0x58, 8],
  [0x59, 8], [0x5a, 8], [0x5b, 8], [0x4a, 8], [0x4b, 8], [0x32, 8], [0x33, 8], [0x34, 8],
];
const WHITE_MAKEUP = [ // 64 .. 1728
  [0x1b, 5], [0x12, 5], [0x17, 6], [0x37, 7], [0x36, 8], [0x37, 8], [0x64, 8], [0x65, 8],
  [0x68, 8], [0x67, 8], [0xcc, 9], [0xcd, 9], [0xd2, 9], [0xd3, 9], [0xd4, 9], [0xd5, 9],
  [0xd6, 9], [0xd7, 9], [0xd8, 9], [0xd9, 9], [0xda, 9], [0xdb, 9], [0x98, 9], [0x99, 9],
  [0x9a, 9], [0x18, 6], [0x9b, 9],
];
const BLACK_TERM = [
  [0x37, 10], [0x02, 3], [0x03, 2], [0x02, 2], [0x03, 3], [0x03, 4], [0x02, 4], [0x03, 5],
  [0x05, 6], [0x04, 6], [0x04, 7], [0x05, 7], [0x07, 7], [0x04, 8], [0x07, 8], [0x18, 9],
  [0x17, 10], [0x18, 10], [0x08, 10], [0x67, 11], [0x68, 11], [0x6c, 11], [0x37, 11], [0x28, 11],
  [0x17, 11], [0x18, 11], [0xca, 12], [0xcb, 12], [0xcc, 12], [0xcd, 12], [0x68, 12], [0x69, 12],
  [0x6a, 12], [0x6b, 12], [0xd2, 12], [0xd3, 12], [0xd4, 12], [0xd5, 12], [0xd6, 12], [0xd7, 12],
  [0x6c, 12], [0x6d, 12], [0xda, 12], [0xdb, 12], [0x54, 12], [0x55, 12], [0x56, 12], [0x57, 12],
  [0x64, 12], [0x65, 12], [0x52, 12], [0x53, 12], [0x24, 12], [0x37, 12], [0x38, 12], [0x27, 12],
  [0x28, 12], [0x58, 12], [0x59, 12], [0x2b, 12], [0x2c, 12], [0x5a, 12], [0x66, 12], [0x67, 12],
];
const BLACK_MAKEUP = [ // 64 .. 1728
  [0x0f, 10], [0xc8, 12], [0xc9, 12], [0x5b, 12], [0x33, 12], [0x34, 12], [0x35, 12], [0x6c, 13],
  [0x6d, 13], [0x4a, 13], [0x4b, 13], [0x4c, 13], [0x4d, 13], [0x72, 13], [0x73, 13], [0x74, 13],
  [0x75, 13], [0x76, 13], [0x77, 13], [0x52, 13], [0x53, 13], [0x54, 13], [0x55, 13], [0x5a, 13],
  [0x5b, 13], [0x64, 13], [0x65, 13],
];
const EXTENDED_MAKEUP = [ // 1792 .. 2560, gedeeld door wit en zwart
  [0x08, 11], [0x0c, 11], [0x0d, 11], [0x12, 12], [0x13, 12], [0x14, 12], [0x15, 12],
  [0x16, 12], [0x17, 12], [0x1c, 12], [0x1d, 12], [0x1e, 12], [0x1f, 12],
];
const PASS = [0x1, 4];
const HORIZONTAL = [0x1, 3];
// Verticaalmodus, index = (a1 - b1) + 3: VL3 VL2 VL1 V0 VR1 VR2 VR3.
const VERTICAL = [[0x02, 7], [0x02, 6], [0x02, 3], [0x1, 1], [0x03, 3], [0x03, 6], [0x03, 7]];
const EOL = [0x001, 12];

/** De uitvoer zou groter worden dan `maxBytes`; de aanroeper valt terug. */
export class CcittOutputLimit extends Error {}

class BitWriter {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.bytes = new Uint8Array(Math.min(maxBytes, 4096));
    this.length = 0;
    this.acc = 0; // nog niet geschreven bits, rechts uitgelijnd
    this.bits = 0;
  }
  put(code, length) {
    this.acc = (this.acc << length) | code;
    this.bits += length;
    while (this.bits >= 8) {
      this.bits -= 8;
      this.byte((this.acc >>> this.bits) & 0xff);
    }
    this.acc &= (1 << this.bits) - 1;
  }
  byte(value) {
    if (this.length >= this.bytes.length) {
      if (this.length >= this.maxBytes) throw new CcittOutputLimit('ccitt-output-limit');
      const grown = new Uint8Array(Math.min(this.maxBytes, this.bytes.length * 2));
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = value;
  }
  finish() {
    if (this.bits) this.byte((this.acc << (8 - this.bits)) & 0xff);
    this.bits = 0;
    return this.bytes.slice(0, this.length);
  }
}

function putRun(writer, run, black) {
  const makeup = black ? BLACK_MAKEUP : WHITE_MAKEUP;
  while (run >= 2624) {
    writer.put(...EXTENDED_MAKEUP[12]);
    run -= 2560;
  }
  if (run >= 64) {
    const m = run & ~63;
    writer.put(...(m <= 1728 ? makeup[m / 64 - 1] : EXTENDED_MAKEUP[(m - 1792) / 64]));
    run -= m;
  }
  writer.put(...(black ? BLACK_TERM : WHITE_TERM)[run]);
}

const SENTINELS = 4;

// Kleurwisselingen van één rij: oplopende kolommen waar de kleur omslaat,
// beginnend vanaf denkbeeldig wit. Even index = wissel naar zwart, oneven =
// wissel naar wit. Daarna SENTINELS keer `width` als eindmarkering.
function changesOf(samples, offset, width, invert, out) {
  let n = 0, color = 0;
  const fullBytes = width >> 3;
  for (let i = 0; i < fullBytes; i++) {
    const v = samples[offset + i] ^ invert;
    if (v === (color ? 0xff : 0)) continue;
    for (let b = 0; b < 8; b++) {
      const bit = (v >> (7 - b)) & 1;
      if (bit !== color) { out[n++] = (i << 3) + b; color = bit; }
    }
  }
  for (let x = fullBytes << 3; x < width; x++) {
    const bit = ((samples[offset + (x >> 3)] ^ invert) >> (7 - (x & 7))) & 1;
    if (bit !== color) { out[n++] = x; color = bit; }
  }
  for (let s = 0; s < SENTINELS; s++) out[n + s] = width;
  return n;
}

// Eén coderingsregel tegen de referentieregel (T.6, 2D-codering).
function encodeLine(writer, cur, ref, width) {
  let a0 = -1, color = 0, ia = 0, ib = 0;
  for (;;) {
    while (cur[ia] <= a0) ia++;
    const a1 = cur[ia];
    // b1: eerste wissel op de referentieregel rechts van a0 met de kleur
    // tegengesteld aan die van a0. Na een verticaalmodus kan die vóór de
    // vorige b1 liggen; daarom eerst terug, dan vooruit zoeken.
    while (ib > 0 && ref[ib - 1] > a0) ib--;
    while (ref[ib] <= a0 || (ib & 1) !== color) ib++;
    const b1 = ref[ib], b2 = ref[ib + 1];
    if (b2 < a1) {
      writer.put(...PASS);
      a0 = b2;
    } else if (a1 - b1 >= -3 && a1 - b1 <= 3) {
      writer.put(...VERTICAL[a1 - b1 + 3]);
      a0 = a1;
      color ^= 1;
    } else {
      const a2 = cur[ia + 1];
      writer.put(...HORIZONTAL);
      putRun(writer, a1 - Math.max(a0, 0), color === 1);
      putRun(writer, a2 - a1, color === 0);
      a0 = a2;
    }
    if (a0 >= width) return;
  }
}

function checkArguments(samples, width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError('Invalid CCITT dimensions');
  }
  if (!(samples instanceof Uint8Array) || samples.length < Math.ceil(width / 8) * height) {
    throw new RangeError('Not enough sample bytes');
  }
}

/**
 * Codeert gepakte één-bit samples als CCITT G4. Met `checkpoint` (async) wordt
 * om de `rowsPerCheckpoint` rijen gewacht, zodat de UI blijft reageren.
 *
 * @param {Uint8Array} samples  Rijen van ceil(width / 8) bytes, MSB eerst.
 * @param {number} width
 * @param {number} height
 * @param {{blackIs1?: boolean, maxBytes?: number, checkpoint?: () => (Promise<void>|void),
 *          rowsPerCheckpoint?: number}} [options]
 * @returns {Promise<Uint8Array>}  Gooit CcittOutputLimit als `maxBytes` overschreden wordt.
 */
export async function encodeCcittG4(samples, width, height, {
  blackIs1 = false, maxBytes = Infinity, checkpoint = null, rowsPerCheckpoint = 64,
} = {}) {
  checkArguments(samples, width, height);
  const stride = Math.ceil(width / 8);
  const invert = blackIs1 ? 0 : 0xff; // intern is 1 altijd zwart
  const writer = new BitWriter(Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : 2 ** 31 - 1);
  let ref = new Int32Array(width + SENTINELS + 1);
  let cur = new Int32Array(width + SENTINELS + 1);
  ref.fill(width, 0, SENTINELS); // denkbeeldige witte eerste referentieregel
  for (let y = 0; y < height; y++) {
    if (checkpoint && y && y % rowsPerCheckpoint === 0) await checkpoint();
    changesOf(samples, y * stride, width, invert, cur);
    encodeLine(writer, cur, ref, width);
    [ref, cur] = [cur, ref];
  }
  writer.put(...EOL);
  writer.put(...EOL);
  return writer.finish();
}

/** De /DecodeParms-waarden die bij encodeCcittG4() horen. */
export function ccittG4Params(width, height, blackIs1) {
  return { K: -1, Columns: width, Rows: height, BlackIs1: !!blackIs1, EncodedByteAlign: false };
}
