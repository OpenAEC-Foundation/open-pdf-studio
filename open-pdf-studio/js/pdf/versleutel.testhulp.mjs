// Testhulp: versleutelt een PDF met de standaardbeveiliging (RC4, 40 bits,
// revisie 2), zodat tests een beveiligd bronbestand hebben zonder dat er een
// PDF in de repo staat. Met een leeg gebruikerswachtwoord opent het bestand
// zonder wachtwoord (alleen rechten); met een gebruikerswachtwoord vraagt een
// lezer erom.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import { createHash } from 'node:crypto';
import { PDFDocument, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream } from 'pdf-lib';

const OPVULLING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(sleutel, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + sleutel[i % sleutel.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const uit = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    uit[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return uit;
}

const md5 = (...delen) => {
  const h = createHash('md5');
  for (const d of delen) h.update(d);
  return new Uint8Array(h.digest());
};

function opgevuld(wachtwoord) {
  const b = new TextEncoder().encode(wachtwoord || '');
  const uit = new Uint8Array(32);
  uit.set(b.subarray(0, 32));
  uit.set(OPVULLING.subarray(0, 32 - Math.min(b.length, 32)), Math.min(b.length, 32));
  return uit;
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * @param {Uint8Array} bytes  een onversleutelde PDF
 * @param {{gebruiker?: string, eigenaar?: string}} [o]
 * @returns {Promise<Uint8Array>} dezelfde PDF, versleuteld
 */
export async function versleutel(bytes, { gebruiker = '', eigenaar = 'eigenaar' } = {}) {
  // Zonder objectstromen: elk object krijgt zijn eigen sleutel.
  const plat = await (await PDFDocument.load(bytes, { updateMetadata: false })).save({ useObjectStreams: false });
  const doc = await PDFDocument.load(plat, { updateMetadata: false });
  const context = doc.context;

  const id = md5(plat).subarray(0, 16);
  const p = -3904; // afdrukken mag, wijzigen niet
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  const o = rc4(md5(opgevuld(eigenaar)).subarray(0, 5), opgevuld(gebruiker));
  const sleutel = md5(opgevuld(gebruiker), o, pBytes, id).subarray(0, 5);
  const u = rc4(sleutel, OPVULLING);

  const objectSleutel = (ref) => md5(sleutel, Uint8Array.from([
    ref.objectNumber & 255, (ref.objectNumber >> 8) & 255, (ref.objectNumber >> 16) & 255,
    ref.generationNumber & 255, (ref.generationNumber >> 8) & 255,
  ])).subarray(0, 10);

  const tekst = (waarde, k) => PDFHexString.of(hex(rc4(k, waarde.asBytes())));
  const loop = (obj, k) => {
    if (obj instanceof PDFDict) {
      for (const [naam, waarde] of obj.entries()) {
        if (waarde instanceof PDFString || waarde instanceof PDFHexString) obj.set(naam, tekst(waarde, k));
        else loop(waarde, k);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const waarde = obj.get(i);
        if (waarde instanceof PDFString || waarde instanceof PDFHexString) obj.set(i, tekst(waarde, k));
        else loop(waarde, k);
      }
    }
  };
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const k = objectSleutel(ref);
    if (obj instanceof PDFRawStream) {
      obj.contents = rc4(k, obj.contents);
      loop(obj.dict, k);
    } else {
      loop(obj, k);
    }
  }

  context.trailerInfo.Encrypt = context.register(context.obj({
    Filter: 'Standard', V: 1, R: 2, P: p,
    O: PDFHexString.of(hex(o)), U: PDFHexString.of(hex(u)),
  }));
  context.trailerInfo.ID = context.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))]);
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}
