// Het PDF-rapport van het opmerkingenoverzicht (#383): elke opmerking één
// ingang met haar paginanummer en een ingebedde uitsnede van haar plek.

import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';

import { bouwOpmerkingenRapport, veiligeTekst, wrapTekst, pasIn } from './opmerkingen-rapport.js';

// Een echte (kleine) PNG, zodat pdf-lib hem moet kunnen inbedden.
function maakPng(breedte, hoogte) {
  const crcTabel = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabel[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const brok = (soort, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(soort, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breedte, 0); ihdr.writeUInt32BE(hoogte, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, RGB
  const rijen = [];
  for (let y = 0; y < hoogte; y++) {
    rijen.push(Buffer.from([0]));
    for (let x = 0; x < breedte; x++) rijen.push(Buffer.from([200, 30 + x, 30 + y]));
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    brok('IHDR', ihdr), brok('IDAT', zlib.deflateSync(Buffer.concat(rijen))), brok('IEND', Buffer.alloc(0)),
  ]));
}

async function tekstPerPagina(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const taak = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await taak.promise;
  const uit = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const inhoud = await (await doc.getPage(i)).getTextContent();
    uit.push(inhoud.items.map((it) => it.str).join('\n'));
  }
  await taak.destroy();
  return uit;
}

async function plaatjesPerPagina(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((p) => {
    const xo = p.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    if (!xo) return 0;
    return xo.keys().filter((k) => {
      const s = xo.lookup(k);
      return s instanceof PDFRawStream && s.dict.get(PDFName.of('Subtype'))?.toString() === '/Image';
    }).length;
  });
}

const png = maakPng(40, 30);

test('elke opmerking één ingang, met paginanummer en ingebedde uitsnede', async () => {
  const ingangen = [
    { pagina: 3, type: 'Comment', auteur: 'Anna', datum: '2026-03-02 12:00', status: 'Accepted', inhoud: 'Kozijn vervangen', uitsnede: { bytes: png, soort: 'png' } },
    { pagina: 7, type: 'Rectangle', auteur: 'Bram', inhoud: '', uitsnede: { bytes: png, soort: 'png' } },
    { pagina: 12, type: 'Arrow', auteur: 'Cor', inhoud: 'Zie detail', reacties: [{ auteur: 'Anna', datum: '2026-03-03 09:00', tekst: 'Akkoord' }], uitsnede: { bytes: png, soort: 'png' } },
  ];
  const { bytes, paginas, ingangen: uit } = await bouwOpmerkingenRapport({
    documentNaam: 'tekening.pdf', gemaakt: '2026-10-27 10:00', ingangen,
  });
  assert.equal(paginas, 1);
  assert.deepEqual(uit.map((u) => [u.nummer, u.pagina, u.uitsnede]), [[1, 3, true], [2, 7, true], [3, 12, true]]);

  const [tekst] = await tekstPerPagina(bytes);
  assert.match(tekst, /Comment Summary/);
  assert.match(tekst, /tekening\.pdf/);
  assert.match(tekst, /Comments: 3/);
  assert.match(tekst, /#1 Page 3 - Comment/);
  assert.match(tekst, /#2 Page 7/);
  assert.match(tekst, /#3 Page 12/);
  assert.match(tekst, /Status: Accepted/);
  assert.match(tekst, /Kozijn vervangen/);
  assert.match(tekst, /\(no comment text\)/);
  assert.match(tekst, /Replies \(1\)/);
  assert.match(tekst, /Anna \(2026-03-03 09:00\): Akkoord/);

  assert.deepEqual(await plaatjesPerPagina(bytes), [3]);
});

test('veel opmerkingen lopen over meer pagina\'s; elke ingang staat er één keer', async () => {
  const ingangen = Array.from({ length: 25 }, (_, i) => ({
    pagina: i + 1, type: 'Note', auteur: 'A', inhoud: `Opmerking nummer ${i + 1}`,
    uitsnede: i % 2 === 0 ? { bytes: png, soort: 'png' } : null,
  }));
  const { bytes, paginas, ingangen: uit } = await bouwOpmerkingenRapport({ ingangen, labels: { pagina: 'Pagina' } });
  assert.ok(paginas > 1);
  assert.equal(uit.length, 25);
  const teksten = await tekstPerPagina(bytes);
  const alles = teksten.join('\n');
  for (let i = 1; i <= 25; i++) {
    const treffers = alles.match(new RegExp(`#${i} Pagina ${i}(?!\\d)`, 'g')) || [];
    assert.equal(treffers.length, 1, `ingang ${i}`);
    // De ingang staat op de rapportpagina die de bouwer opgeeft.
    assert.match(teksten[uit[i - 1].rapportPagina - 1], new RegExp(`Opmerking nummer ${i}(?!\\d)`));
  }
  // Voettekst met paginanummering op elke pagina.
  teksten.forEach((t, i) => assert.match(t, new RegExp(`${i + 1} / ${paginas}`)));
  const plaatjes = await plaatjesPerPagina(bytes);
  assert.equal(plaatjes.reduce((s, n) => s + n, 0), 13);
});

test('een onleesbare uitsnede breekt het rapport niet: de ingang blijft, zonder plaatje', async () => {
  const { bytes, ingangen } = await bouwOpmerkingenRapport({
    ingangen: [{ pagina: 2, inhoud: 'x', uitsnede: { bytes: new Uint8Array([1, 2, 3]), soort: 'jpeg' } }],
  });
  assert.equal(ingangen[0].uitsnede, false);
  assert.deepEqual(await plaatjesPerPagina(bytes), [0]);
  assert.match((await tekstPerPagina(bytes))[0], /#1 Page 2/);
});

test('tekst die Helvetica niet kent wordt een vraagteken in plaats van een fout', async () => {
  const { bytes } = await bouwOpmerkingenRapport({
    ingangen: [{ pagina: 1, auteur: 'Ζωή', inhoud: 'café 中文\tok' }],
  });
  const [tekst] = await tekstPerPagina(bytes);
  assert.match(tekst, /café \?\? ok/);
  assert.match(tekst, /Author: \?\?\?/);
});

test('een heel lange opmerking wordt ingekort zodat ze op een pagina past', async () => {
  const lang = Array.from({ length: 400 }, (_, i) => `regel ${i}`).join('\n');
  const { bytes, paginas } = await bouwOpmerkingenRapport({ ingangen: [{ pagina: 1, inhoud: lang }] });
  assert.equal(paginas, 1);
  assert.match((await tekstPerPagina(bytes))[0], /\.\.\./);
});

test('hulpjes: veiligeTekst, wrapTekst en pasIn', () => {
  assert.equal(veiligeTekst('a\r\nb\tc€', new Set([...'abc '].map((c) => c.codePointAt(0)))), 'a\nb c?');
  assert.equal(veiligeTekst('alles', null), 'alles');
  const breedte = (s) => s.length;
  assert.deepEqual(wrapTekst('een twee drie', breedte, 8), ['een twee', 'drie']);
  assert.deepEqual(wrapTekst('a\n\nb', breedte, 8), ['a', '', 'b']);
  assert.deepEqual(wrapTekst('abcdefghij', breedte, 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(pasIn(400, 200, 170, 130), { breedte: 170, hoogte: 85 });
  assert.deepEqual(pasIn(50, 20, 170, 130), { breedte: 50, hoogte: 20 });
  assert.deepEqual(pasIn(0, 20, 170, 130), { breedte: 0, hoogte: 0 });
});
