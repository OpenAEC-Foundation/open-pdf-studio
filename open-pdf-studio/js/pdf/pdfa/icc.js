// ICC-profielen voor PDF/A (#379).
//
// bouwSrgbProfiel() maakt in code een sRGB-profiel (IEC 61966-2.1) als ICC
// v2.1-weergaveprofiel: de versie die elke PDF/A-deel (ook 1b, dat ICC
// boven 2.x niet toestaat) accepteert in een OutputIntent. Anders dan het
// kleine profiel van de PDF/X-export (één gamma 2,2) heeft dit de echte
// sRGB-toonkromme als tabel van 1024 punten. Het profiel is eigen werk van
// dit project; er zit geen profiel van derden in.
//
// leesIccKop() leest wat de validatie van een profiel wil weten.

const TAG_UITLIJNING = 4;

function schrijfTekst(buf, off, s) {
  for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i) & 0xFF;
}

function uitlijnen(n) {
  return (n + TAG_UITLIJNING - 1) & ~(TAG_UITLIJNING - 1);
}

/** sRGB-toonkromme: gecodeerde waarde (0..1) → lineaire waarde (0..1). */
export function srgbNaarLineair(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** @returns {Uint8Array} een geldig ICC v2.1 sRGB-profiel */
export function bouwSrgbProfiel() {
  const beschrijving = 'sRGB IEC61966-2.1';
  const copyright = 'No copyright, use freely';
  const PUNTEN = 1024;

  const tags = [];
  // desc: textDescriptionType (ASCII + lege Unicode- en ScriptCode-delen)
  {
    const n = beschrijving.length + 1;
    const d = new Uint8Array(uitlijnen(12 + n + 4 + 4 + 2 + 1 + 67));
    schrijfTekst(d, 0, 'desc');
    new DataView(d.buffer).setUint32(8, n, false);
    schrijfTekst(d, 12, beschrijving);
    tags.push({ sig: 'desc', data: d });
  }
  {
    const d = new Uint8Array(uitlijnen(8 + copyright.length + 1));
    schrijfTekst(d, 0, 'text');
    schrijfTekst(d, 8, copyright);
    tags.push({ sig: 'cprt', data: d });
  }
  const xyz = (sig, X, Y, Z) => {
    const d = new Uint8Array(20);
    const dv = new DataView(d.buffer);
    schrijfTekst(d, 0, 'XYZ ');
    dv.setInt32(8, Math.round(X * 65536), false);
    dv.setInt32(12, Math.round(Y * 65536), false);
    dv.setInt32(16, Math.round(Z * 65536), false);
    tags.push({ sig, data: d });
  };
  xyz('wtpt', 0.9642, 1.0, 0.8249);
  // sRGB-primairen, Bradford-aangepast naar D50 (zoals in de ICC-literatuur)
  xyz('rXYZ', 0.4360747, 0.2225045, 0.0139322);
  xyz('gXYZ', 0.3850649, 0.7168786, 0.0971045);
  xyz('bXYZ', 0.1430804, 0.0606169, 0.7141733);
  {
    const d = new Uint8Array(uitlijnen(12 + PUNTEN * 2));
    const dv = new DataView(d.buffer);
    schrijfTekst(d, 0, 'curv');
    dv.setUint32(8, PUNTEN, false);
    for (let i = 0; i < PUNTEN; i++) {
      dv.setUint16(12 + i * 2, Math.round(srgbNaarLineair(i / (PUNTEN - 1)) * 65535), false);
    }
    // De drie kanalen delen één kromme (toegestaan: tags mogen data delen).
    tags.push({ sig: 'rTRC', data: d, gedeeld: 'trc' });
    tags.push({ sig: 'gTRC', data: d, gedeeld: 'trc' });
    tags.push({ sig: 'bTRC', data: d, gedeeld: 'trc' });
  }

  const tabelGrootte = 4 + tags.length * 12;
  let pos = 128 + tabelGrootte;
  const plaats = new Map();
  for (const t of tags) {
    if (t.gedeeld && plaats.has(t.gedeeld)) { t.off = plaats.get(t.gedeeld); continue; }
    t.off = pos;
    if (t.gedeeld) plaats.set(t.gedeeld, pos);
    pos += t.data.length;
  }
  const grootte = pos;
  const buf = new Uint8Array(grootte);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, grootte, false);
  dv.setUint32(8, 0x02100000, false); // versie 2.1.0
  schrijfTekst(buf, 12, 'mntr');
  schrijfTekst(buf, 16, 'RGB ');
  schrijfTekst(buf, 20, 'XYZ ');
  dv.setUint16(24, 2026, false); dv.setUint16(26, 1, false); dv.setUint16(28, 1, false);
  schrijfTekst(buf, 36, 'acsp');
  dv.setUint32(64, 0, false); // perceptueel
  dv.setInt32(68, Math.round(0.9642 * 65536), false);
  dv.setInt32(72, 65536, false);
  dv.setInt32(76, Math.round(0.8249 * 65536), false);
  dv.setUint32(128, tags.length, false);
  let te = 132;
  for (const t of tags) {
    schrijfTekst(buf, te, t.sig);
    dv.setUint32(te + 4, t.off, false);
    dv.setUint32(te + 8, t.data.length, false);
    te += 12;
  }
  for (const t of tags) buf.set(t.data, t.off);
  return buf;
}

/**
 * De kop van een ICC-profiel.
 * @param {Uint8Array} bytes
 * @returns {null | { grootte: number, versie: number, klasse: string, ruimte: string, pcs: string, n: number, tags: string[] }}
 *   versie als getal, bv. 2.1 of 4.3; n = aantal kleurcomponenten (0 = onbekend)
 */
export function leesIccKop(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 132) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tekst = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tekst(36) !== 'acsp') return null;
  const ruimte = tekst(16);
  const n = { 'RGB ': 3, 'CMYK': 4, 'GRAY': 1, 'Lab ': 3 }[ruimte] || 0;
  const aantal = dv.getUint32(128, false);
  const tags = [];
  for (let i = 0; i < aantal && 132 + i * 12 + 12 <= bytes.length && i < 200; i++) tags.push(tekst(132 + i * 12));
  return {
    grootte: dv.getUint32(0, false),
    versie: bytes[8] + (bytes[9] >> 4) / 10,
    klasse: tekst(12),
    ruimte,
    pcs: tekst(20),
    n,
    tags,
  };
}
