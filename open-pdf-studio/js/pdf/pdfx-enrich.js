// PDF/X-verrijking zonder app-afhankelijkheden (#239, #422): alleen pdf-lib.
//
// Voegt aan een pdf-lib-document toe wat een PDF/X-lezer verwacht: een
// OutputIntent met ingebed ICC-profiel, XMP met de PDF/X-versie, een TrimBox
// per pagina en een /Info met /Trapped. Zonder `outputProfile` is dat het
// in code opgebouwde sRGB-profiel (het gedrag van vóór #422, byte voor byte);
// met een CMYK-drukprofiel ({ bytes, name }) komt dat profiel met /N 4 in de
// OutputIntent en draagt de naam de OutputConditionIdentifier en /Info.
// Het omzetten van de inhoud naar CMYK gebeurt vóór deze stap (Rust).

import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

// ── ICC profile generation ─────────────────────────────────────────────────
// Build a minimal but structurally valid sRGB (IEC 61966-2.1) ICC v2 profile.
// Layout: 128-byte header + tag table + tag data. Required tags for an RGB
// display profile: desc, cprt, wtpt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC.
export function buildSrgbIccProfile() {
  const SIZE = 468;
  const buf = new Uint8Array(SIZE);
  const dv = new DataView(buf.buffer);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
  const u32 = (off, v) => dv.setUint32(off, v >>> 0, false);
  const s15f16 = (off, v) => dv.setInt32(off, Math.round(v * 65536), false);

  // ── Header (128 bytes) ──
  u32(0, SIZE);             // profile size
  u32(4, 0);               // preferred CMM (none)
  u32(8, 0x02400000);      // profile version 2.4.0
  writeStr(12, 'mntr');    // device class: display
  writeStr(16, 'RGB ');    // data colour space
  writeStr(20, 'XYZ ');    // PCS
  // creation date/time (12 bytes): 2024-01-01T00:00:00
  dv.setUint16(24, 2024, false); dv.setUint16(26, 1, false); dv.setUint16(28, 1, false);
  writeStr(36, 'acsp');    // profile file signature
  u32(40, 0);              // primary platform (none)
  u32(44, 0);              // profile flags
  u32(48, 0);              // device manufacturer
  u32(52, 0);              // device model
  // attributes (8 bytes) left zero
  u32(64, 0);              // rendering intent: perceptual
  // PCS illuminant (D50) at offset 68
  s15f16(68, 0.9642); s15f16(72, 1.0); s15f16(76, 0.8249);
  u32(80, 0);              // profile creator
  // profile ID (16 bytes) + reserved (28 bytes) left zero

  // ── Tag table ──
  const TAG_COUNT = 9;
  u32(128, TAG_COUNT);
  const OFF = { desc: 240, cprt: 348, wtpt: 372, rXYZ: 392, gXYZ: 412, bXYZ: 432, trc: 452 };
  const entries = [
    ['desc', OFF.desc, 108],
    ['cprt', OFF.cprt, 24],
    ['wtpt', OFF.wtpt, 20],
    ['rXYZ', OFF.rXYZ, 20],
    ['gXYZ', OFF.gXYZ, 20],
    ['bXYZ', OFF.bXYZ, 20],
    ['rTRC', OFF.trc, 16],   // three TRC tags share one curve
    ['gTRC', OFF.trc, 16],
    ['bTRC', OFF.trc, 16],
  ];
  let te = 132;
  for (const [sig, off, size] of entries) { writeStr(te, sig); u32(te + 4, off); u32(te + 8, size); te += 12; }

  // ── desc (textDescriptionType) ──
  {
    const o = OFF.desc;
    writeStr(o, 'desc');
    const text = 'sRGB IEC61966-2.1';
    u32(o + 8, text.length + 1);           // ASCII count incl. null
    writeStr(o + 12, text);                // null already zero
    // unicode + scriptcode sections left zero
  }
  // ── cprt (textType) ──
  {
    const o = OFF.cprt;
    writeStr(o, 'text');
    writeStr(o + 8, 'Public domain');      // null-terminated by zero fill
  }
  // ── XYZ tags ──
  const xyz = (o, X, Y, Z) => { writeStr(o, 'XYZ '); s15f16(o + 8, X); s15f16(o + 12, Y); s15f16(o + 16, Z); };
  xyz(OFF.wtpt, 0.9642, 1.0, 0.8249);       // D50 white point
  xyz(OFF.rXYZ, 0.43607, 0.22249, 0.01392); // sRGB red colorant (D50-adapted)
  xyz(OFF.gXYZ, 0.38515, 0.71687, 0.09708); // sRGB green colorant
  xyz(OFF.bXYZ, 0.14307, 0.06061, 0.71410); // sRGB blue colorant
  // ── TRC (curveType, single gamma value ≈ 2.2) ──
  {
    const o = OFF.trc;
    writeStr(o, 'curv');
    u32(o + 8, 1);                          // one entry → gamma
    dv.setUint16(o + 12, Math.round(2.2 * 256), false); // u8Fixed8 gamma
  }

  return buf;
}

// ── XMP metadata ───────────────────────────────────────────────────────────
// Build a self-contained XMP packet with the PDF/X identification schema.
// Uses the NPES pdfxid namespace and the Dublin Core namespace only, so it
// carries the PDF/X version + title without depending on other schemas.
function buildPdfxXmp(versionString, title) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
    <pdfxid:GTS_PDFXVersion>${esc(versionString)}</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:format>application/pdf</dc:format>
    <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
</rdf:RDF>
<?xpacket end="w"?>`;
}

// Map the conformance key chosen in the UI to the GTS_PDFXVersion string.
function versionStringFor(conformance) {
  switch (conformance) {
    case 'X-4': return 'PDF/X-4';
    case 'X-3':
    default:    return 'PDF/X-3:2002';
  }
}

// ── Core enrichment ────────────────────────────────────────────────────────
// Take a loaded pdf-lib document and add all PDF/X structures in place.
// `outputProfile` ({ bytes, name }): een CMYK-drukprofiel voor de
// OutputIntent. Zonder: het sRGB-profiel, exact zoals vóór #422.
export function enrichForPdfX(pdfDocLib, { conformance = 'X-3', title = 'Document', outputProfile = null } = {}) {
  const context = pdfDocLib.context;
  const catalog = pdfDocLib.catalog;
  const versionString = versionStringFor(conformance);

  // 1. OutputIntent with embedded ICC profile.
  let outputIntents;
  if (outputProfile) {
    // Drukprofielen zijn soms megabytes groot: gecomprimeerd insluiten.
    const iccRef = context.register(context.flateStream(outputProfile.bytes, { N: 4 }));
    const name = PDFHexString.fromText(outputProfile.name);
    outputIntents = context.obj([
      {
        Type: 'OutputIntent',
        S: 'GTS_PDFX',
        OutputConditionIdentifier: name,
        Info: name,
        RegistryName: PDFString.of('http://www.color.org'),
        DestOutputProfile: iccRef,
      },
    ]);
  } else {
    const iccBytes = buildSrgbIccProfile();
    const iccStream = context.stream(iccBytes, {
      N: 3, // RGB → 3 components
    });
    const iccRef = context.register(iccStream);
    outputIntents = context.obj([
      {
        Type: 'OutputIntent',
        S: 'GTS_PDFX',
        OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
        Info: PDFString.of('sRGB IEC61966-2.1'),
        RegistryName: PDFString.of('http://www.color.org'),
        DestOutputProfile: iccRef,
      },
    ]);
  }
  catalog.set(PDFName.of('OutputIntents'), outputIntents);

  // 2. XMP metadata stream (uncompressed so preflight tools can read it).
  const xmp = buildPdfxXmp(versionString, title);
  // Als UTF-8-bytes: een string kapt pdf-lib per teken af op de lage byte
  // (niet-ASCII-titel, en U+FEFF in xpacket begin werd 0xFF).
  const metaStream = context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  const metaRef = context.register(metaStream);
  catalog.set(PDFName.of('Metadata'), metaRef);

  // 3. TrimBox on every page (PDF/X requires a TrimBox or ArtBox). Fall back to
  //    the CropBox, which itself falls back to the MediaBox in pdf-lib.
  const pages = pdfDocLib.getPages();
  for (const page of pages) {
    const box = page.getCropBox(); // {x, y, width, height}
    page.setTrimBox(box.x, box.y, box.width, box.height);
  }

  // 4. /Info dictionary: title, producer, dates and a DEFINED /Trapped value
  //    (PDF/X forbids /Trapped /Unknown).
  const now = new Date();
  try {
    pdfDocLib.setTitle(title);
    pdfDocLib.setProducer('Open PDF Studio');
    pdfDocLib.setModificationDate(now);
    if (!context.lookup(context.trailerInfo.Info)?.get?.(PDFName.of('CreationDate'))) {
      pdfDocLib.setCreationDate(now);
    }
  } catch (_) { /* setters best-effort */ }
  const infoRef = context.trailerInfo.Info;
  const infoDict = infoRef ? context.lookup(infoRef) : null;
  if (infoDict && typeof infoDict.set === 'function') {
    infoDict.set(PDFName.of('Trapped'), PDFName.of('False'));
  }

  return { versionString };
}

// Van bronbytes naar PDF/X-bytes: laden, verrijken, opslaan.
// useObjectStreams:false keeps the file at the classic (PDF 1.4-style)
// cross-reference table PDF/X-3:2002 expects.
export async function buildPdfxBytes(bytes, { conformance = 'X-3', title = 'Document', outputProfile = null } = {}) {
  const pdfDocLib = await PDFDocument.load(bytes);
  enrichForPdfX(pdfDocLib, { conformance, title, outputProfile });
  return pdfDocLib.save({ useObjectStreams: false });
}
