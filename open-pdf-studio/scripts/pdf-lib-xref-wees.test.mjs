// Een /Type /XRef-stroom die niet in de xref-keten van het bestand zit, mag het
// laden niet laten mislukken (regressie in 2026.47.0 en 2026.47.1).
//
// De ontsleutelde werkkopie van een beveiligde PDF heeft een gewone xref-tabel,
// maar draagt de xref-stroom van de bron mee als los object: nog /Type /XRef
// met de oude /W en /Index, en een inhoud die door de ontsleuteling is gehaald
// en daardoor te kort is. De begrenzing van #1093 wees het hele document dan
// af: geen annotaties, en opslaan of de beveiliging verwijderen lukte niet.
//
// Een afgeknotte stroom die het bestand wél gebruikt (startxref, /Prev,
// /XRefStm) blijft een duidelijke fout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFHexString, PDFString } from 'pdf-lib';
import { pdfLibXRefBounds, pdfLibXRefEsbuild } from './pdf-lib-xref-bounds.mjs';
import { pdfLibInternEsbuild } from './pdf-lib-intern-pools.mjs';
import { beveiligingshulp } from './bouw-beveiligingshulp.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'opds-xref-wees-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** pdf-lib zoals de app hem bundelt, met de saver-module voor incrementeel opslaan erbij. */
async function bundle(name, plugins) {
  const outfile = join(dir, `${name}.mjs`);
  await build({ stdin: { contents: `export * from 'pdf-lib';
    export * as incrementeel from './js/pdf/saver/incrementeel.js';`, resolveDir: app },
    bundle: true, format: 'esm', platform: 'browser', outfile, plugins, logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
const productie = pdfLibXRefBounds();
const productiePlugin = {
  name: 'production-transform', setup(b) {
    b.onLoad({ filter: /pdf-lib[\\/]es[\\/]core[\\/]parser[\\/](PDFParser|PDFXRefStreamParser)\.js$/ }, ({ path }) => ({
      contents: productie.transform(readFileSync(path, 'utf8'), path).code, loader: 'js',
    }));
  },
};
const libs = {
  optimizer: await bundle('optimizer', [pdfLibXRefEsbuild(), pdfLibInternEsbuild()]),
  production: await bundle('production', [productiePlugin, pdfLibInternEsbuild()]),
};

/** Een bestand waarvan de xref-stroom de kruisverwijzing zelf is (zoals in de proeven van #1093). */
function fixture(w, data) {
  let s = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n';
  const offset = s.length;
  s += `3 0 obj\n<< /Type /XRef /Root 1 0 R /Size 4 /Index [0 1] /W ${w} /Length ${data.length} >>\nstream\n`;
  return Uint8Array.from(Buffer.concat([Buffer.from(s), Buffer.from(data),
    Buffer.from(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`)]));
}

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const uitLatin1 = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

/** Waarschuwingen van pdf-lib horen bij de proef, niet in de testuitvoer. */
async function stil(fn) {
  const warn = console.warn;
  const regels = [];
  console.warn = (...a) => { regels.push(a.join(' ')); };
  try { return { uitkomst: await fn(), regels }; } finally { console.warn = warn; }
}

const PAGINAS = 3;
const PER_PAGINA = 2;

/**
 * Een document met annotaties in de vorm van een werkkopie: xref-tabel en
 * trailer, plus een los object dat een xref-stroom is. `tekort` is het aantal
 * bytes dat de stroom mist; `flate` comprimeert de inhoud.
 */
async function werkkopieVorm({ tekort = 22, flate = false, metWees = true } = {}) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (let p = 0; p < PAGINAS; p++) {
    const blad = doc.addPage([842, 595]);
    blad.drawText(`Blad ${p + 1}`, { x: 40, y: 540, size: 18 });
    const refs = [];
    for (let i = 0; i < PER_PAGINA; i++) {
      const x = 100 + i * 120;
      const ap = ctx.register(ctx.stream('1 0 0 RG 1 w 0.5 0.5 39 29 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 30], Resources: ctx.obj({}) }));
      const dict = ctx.obj({ Type: 'Annot', Subtype: ['Square', 'Text'][i], Rect: [x, 200, x + 40, 230], F: 4, C: [1, 0, 0],
        NM: PDFString.of(`proef-${p + 1}-${i + 1}`), Contents: PDFHexString.fromText(`Opmerking ${i + 1}`), AP: ctx.obj({ N: ap }) });
      dict.set(PDFName.of('P'), blad.ref);
      refs.push(ctx.register(dict));
    }
    blad.node.set(PDFName.of('Annots'), ctx.obj(refs));
  }
  let weesRef = null;
  if (metWees) {
    // Zoals de bron: /W [1 4 2] over alle objecten, en een /Encrypt dat naar
    // een woordenboek wijst dat in de werkkopie is blijven staan.
    const encrypt = ctx.register(ctx.obj({ Filter: 'Standard', V: 5, R: 6, Length: 256 }));
    const aantal = ctx.largestObjectNumber + 1;
    const nodig = aantal * 7;
    const ruw = Uint8Array.from({ length: Math.max(0, nodig - tekort) }, (_, i) => (i * 37 + 11) % 251);
    const inhoud = flate ? deflateSync(ruw) : ruw;
    weesRef = ctx.register(ctx.stream(inhoud, {
      Type: 'XRef', Size: aantal + 2, W: [1, 4, 2], Index: [1, aantal], Root: ctx.trailerInfo.Root,
      Encrypt: encrypt, ID: [PDFHexString.of(''), PDFHexString.of('')], ...(flate ? { Filter: 'FlateDecode' } : {}),
    }));
  }
  const bytes = await doc.save({ useObjectStreams: false });
  const tekst = latin1(bytes);
  assert.match(tekst, /\nxref\n0 \d+/, 'het bestand heeft een xref-tabel');
  assert.match(tekst, /\ntrailer\n/);
  return { bytes, weesRef };
}

/** Beginpositie van `n 0 obj` in het bestand. */
function objectOffset(bytes, ref) {
  const i = latin1(bytes).indexOf(`\n${ref.objectNumber} ${ref.generationNumber} obj`);
  assert.ok(i >= 0, `object ${ref} gevonden`);
  return i + 1;
}

/** Maakt van de losse stroom een gebruikte: /XRefStm in de trailer (hybride bestand). */
function maakHybride(bytes, weesRef) {
  const offset = objectOffset(bytes, weesRef);
  const tekst = latin1(bytes);
  const uit = tekst.replace(/\ntrailer\n<<\n/, `\ntrailer\n<<\n/XRefStm ${offset}\n`);
  assert.notEqual(uit, tekst, 'trailer aangepast');
  return uitLatin1(uit);
}

function annotaties(lib, doc) {
  const uit = [];
  for (const blad of doc.getPages()) {
    const lijst = blad.node.Annots();
    for (let i = 0; i < (lijst ? lijst.size() : 0); i++) {
      const a = lijst.lookup(i, lib.PDFDict);
      uit.push({ soort: a.lookup(lib.PDFName.of('Subtype')).decodeText(), naam: a.lookup(lib.PDFName.of('NM')).decodeText(),
        inhoud: a.lookup(lib.PDFName.of('Contents')).decodeText() });
    }
  }
  return uit;
}

function mupdfAnnotaties(bytes, wachtwoord = null) {
  const d = mupdf.Document.openDocument(Buffer.from(bytes), 'application/pdf');
  if (d.needsPassword()) assert.ok(d.authenticatePassword(wachtwoord ?? '') > 0, 'wachtwoord klopt');
  const uit = [];
  for (let i = 0; i < d.countPages(); i++) for (const a of d.loadPage(i).getAnnotations()) uit.push(a.getContents());
  return uit;
}

function heeftXRefObject(lib, doc) {
  return doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof lib.PDFRawStream
    && o.dict.get(lib.PDFName.of('Type')) === lib.PDFName.of('XRef'));
}

for (const [mode, lib] of Object.entries(libs)) {
  test(`${mode}: verweesde, afgeknotte xref-stroom in een bestand met xref-tabel laadt met alle annotaties`, async () => {
    for (const flate of [false, true]) {
      const { bytes, weesRef } = await werkkopieVorm({ flate });
      const voor = bytes.slice();
      const { uitkomst: doc, regels } = await stil(() => lib.PDFDocument.load(bytes, { ignoreEncryption: true }));
      assert.deepEqual(bytes, voor, 'de invoer blijft ongewijzigd');
      assert.equal(doc.getPageCount(), PAGINAS);
      assert.equal(annotaties(lib, doc).length, PAGINAS * PER_PAGINA);
      assert.equal(doc.context.lookup(lib.PDFRef.of(weesRef.objectNumber)), undefined, 'de losse stroom is geen object van het document');
      assert.equal(doc.context.trailerInfo.Encrypt, undefined, 'de losse stroom bepaalt de trailer niet');
      assert.equal(doc.isEncrypted, false);
      assert.ok(regels.some((r) => /outside the cross-reference chain/.test(r)), 'het overslaan wordt gemeld');
      // Zonder ignoreEncryption, zoals de saver laadt.
      const { uitkomst: gewoon } = await stil(() => lib.PDFDocument.load(bytes));
      assert.equal(annotaties(lib, gewoon).length, PAGINAS * PER_PAGINA);
    }
  });

  test(`${mode}: ook een verweesde stroom van de juiste lengte telt niet mee`, async () => {
    // Bij een bron met een stroomcijfer houdt de inhoud zijn lengte; de
    // /Encrypt van de bron mag het document dan evenmin versleuteld maken.
    const { bytes } = await werkkopieVorm({ tekort: 0 });
    const { uitkomst: doc } = await stil(() => lib.PDFDocument.load(bytes));
    assert.equal(doc.isEncrypted, false);
    assert.equal(annotaties(lib, doc).length, PAGINAS * PER_PAGINA);
  });

  test(`${mode}: de werkkopie die de app van een eigen beveiligd bestand maakt, laadt`, async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/xref-wees/werkkopie-met-verweesde-xref-stroom.pdf', import.meta.url)));
    assert.match(latin1(bytes), /\/Type\/XRef/, 'de fixture heeft de losse xref-stroom');
    const { uitkomst: doc } = await stil(() => lib.PDFDocument.load(bytes));
    assert.equal(doc.getPageCount(), 3);
    assert.equal(annotaties(lib, doc).length, 6);
    assert.equal(doc.isEncrypted, false);
  });

  test(`${mode}: een afgeknotte xref-stroom die het bestand gebruikt, blijft een duidelijke fout`, async () => {
    const fout = { name: 'InvalidXRefStreamError', message: /Truncated XRef stream/ };
    // startxref wijst naar de stroom.
    await assert.rejects(lib.PDFDocument.load(fixture('[1 1 1]', [1, 0])), fout);
    // Hybride: de trailer van de tabel noemt de stroom in /XRefStm.
    const { bytes, weesRef } = await werkkopieVorm();
    await assert.rejects(stil(() => lib.PDFDocument.load(maakHybride(bytes, weesRef))), fout);
    // Een eerdere revisie met een afgeknotte stroom, bereikt over /Prev.
    const oud = fixture('[1 1 1]', [1, 0]);
    const oudOffset = Number(/startxref\n(\d+)/.exec(latin1(oud))[1]);
    const kop = latin1(oud);
    const nieuwOffset = kop.length;
    const revisie = `${kop}5 0 obj\n<< /Type /XRef /Root 1 0 R /Size 6 /Index [5 1] /W [1 1 1] /Prev ${oudOffset} /Length 3 >>\nstream\n\x01\x00\x00\nendstream\nendobj\nstartxref\n${nieuwOffset}\n%%EOF\n`;
    await assert.rejects(lib.PDFDocument.load(uitLatin1(revisie)), fout);
  });

  test(`${mode}: is de keten niet te volgen, dan geldt elke xref-stroom als gebruikt`, async () => {
    const { bytes } = await werkkopieVorm();
    const kapot = uitLatin1(latin1(bytes).replace(/startxref\n\d+/, 'startxref\n7'));
    await assert.rejects(stil(() => lib.PDFDocument.load(kapot)), { name: 'InvalidXRefStreamError' });
  });

  test(`${mode}: hybride bestand met een geldige /XRefStm laadt`, async () => {
    const { bytes, weesRef } = await werkkopieVorm({ tekort: 0 });
    const hybride = maakHybride(bytes, weesRef);
    const { uitkomst: doc, regels } = await stil(() => lib.PDFDocument.load(hybride, { ignoreEncryption: true }));
    assert.equal(annotaties(lib, doc).length, PAGINAS * PER_PAGINA);
    assert.ok(!regels.some((r) => /outside the cross-reference chain/.test(r)), 'de stroom is gelezen, niet overgeslagen');
    // Bewijs dat de stroom gelezen is: zijn /Encrypt komt in de trailergegevens.
    assert.ok(doc.context.trailerInfo.Encrypt instanceof lib.PDFRef);
  });

  test(`${mode}: laden, annotatie wijzigen, opslaan en heropenen houdt de annotaties heel`, async () => {
    const fixtureBytes = new Uint8Array(readFileSync(new URL('./fixtures/xref-wees/werkkopie-met-verweesde-xref-stroom.pdf', import.meta.url)));
    for (const [naam, bron] of [['gegenereerd', (await werkkopieVorm({ flate: true })).bytes], ['werkkopie', fixtureBytes]]) {
      const totaal = naam === 'werkkopie' ? 6 : PAGINAS * PER_PAGINA;
      // Zoals de saver: laden zonder opties, opslaan met objectstromen.
      const { uitkomst: doc } = await stil(() => lib.PDFDocument.load(bron));
      const eerste = doc.getPage(0).node.Annots().lookup(0, lib.PDFDict);
      eerste.set(lib.PDFName.of('Contents'), lib.PDFHexString.fromText('Gewijzigd'));
      for (const opties of [{ updateFieldAppearances: false }, { updateFieldAppearances: false, useObjectStreams: false }]) {
        const uit = await doc.save(opties);
        const { uitkomst: terug, regels } = await stil(() => lib.PDFDocument.load(uit));
        const lijst = annotaties(lib, terug);
        assert.equal(lijst.length, totaal, `${naam}: alle annotaties terug`);
        assert.equal(lijst[0].inhoud, 'Gewijzigd');
        assert.equal(heeftXRefObject(lib, terug), false);
        assert.ok(!regels.some((r) => /outside the cross-reference chain/.test(r)), `${naam}: de losse stroom is niet meegeschreven`);
        // Een onafhankelijke lezer ziet hetzelfde.
        const m = mupdfAnnotaties(uit);
        assert.equal(m.length, totaal);
        assert.ok(m.includes('Gewijzigd'));
      }
    }
  });

  test(`${mode}: incrementeel opslaan van de werkkopie-vorm geeft een leesbaar bestand of weigert`, async () => {
    const { bytes } = await werkkopieVorm({ flate: true });
    const { incrementeel } = lib;
    const { uitkomst: doc } = await stil(() => lib.PDFDocument.load(bytes, { updateMetadata: false }));
    const plan = incrementeel.bereidIncrementeelVoor(bytes, doc);
    const eerste = doc.getPage(0).node.Annots().lookup(0, lib.PDFDict);
    eerste.set(lib.PDFName.of('Contents'), lib.PDFHexString.fromText('Gewijzigd'));
    const uitkomst = incrementeel.bouwIncrementeleUpdate(plan, doc);
    if (uitkomst.bytes) {
      const { uitkomst: terug } = await stil(() => lib.PDFDocument.load(uitkomst.bytes));
      const lijst = annotaties(lib, terug);
      assert.equal(lijst.length, PAGINAS * PER_PAGINA);
      assert.equal(lijst[0].inhoud, 'Gewijzigd');
      assert.ok(mupdfAnnotaties(uitkomst.bytes).includes('Gewijzigd'));
    } else {
      // Een weigering laat de saver het hele bestand herschrijven (proef hierboven).
      assert.ok(uitkomst.weigering?.reden, 'weigering met een reden');
    }
  });
}

test('een beveiligd document wordt nooit incrementeel opgeslagen', async () => {
  const { vereistVolledigeHerschrijving } = await import('../js/pdf/saver/incrementeel.js');
  // De versleutelende schrijver herschrijft het hele bestand; een toevoeging
  // achter de werkkopie zou de losse xref-stroom van de bron meenemen.
  assert.equal(vereistVolledigeHerschrijving({ annotations: [], beveiliging: { versleuteld: true, sessie: 's1' } }), 'beveiliging');
  // Beveiliging net verwijderd: de bron is nog de ontsleutelde werkkopie.
  assert.equal(vereistVolledigeHerschrijving({ annotations: [], beveiliging: { versleuteld: false, inAfwachting: true } }), 'beveiliging');
  assert.equal(vereistVolledigeHerschrijving({ annotations: [], beveiliging: null }), null);
  assert.equal(vereistVolledigeHerschrijving({ annotations: [] }), null);
});

// De opslagkant: wat de saver uit de werkkopie maakt, moet de schrijver van de
// app (open-pdf-security) weer kunnen beveiligen, met alle annotaties erin.
// draai-unit-tests.mjs bouwt het hulpprogramma vooraf (OPDS_BEVEILIGING_BIN).
test('werkkopie bewerken en opnieuw beveiligen met de schrijver van de app', async (t) => {
  const hulp = beveiligingshulp();
  if (hulp.geenCargo) return t.skip('cargo niet gevonden');
  assert.ok(hulp.bin, `hulpprogramma niet gebouwd: ${hulp.fout}`);
  const lib = libs.production;
  const bron = new Uint8Array(readFileSync(new URL('./fixtures/xref-wees/werkkopie-met-verweesde-xref-stroom.pdf', import.meta.url)));
  const { uitkomst: doc } = await stil(() => lib.PDFDocument.load(bron));
  doc.getPage(0).node.Annots().lookup(0, lib.PDFDict).set(lib.PDFName.of('Contents'), lib.PDFHexString.fromText('Gewijzigd'));
  const plat = join(dir, 'plat.pdf');
  const beveiligd = join(dir, 'beveiligd.pdf');
  writeFileSync(plat, await doc.save({ updateFieldAppearances: false }));
  const r = spawnSync(hulp.bin, ['protect', plat, beveiligd, 'proef-open', 'proef-rechten', '-4'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `protect faalde: ${r.stderr}`);
  const uit = new Uint8Array(readFileSync(beveiligd));
  const m = mupdfAnnotaties(uit, 'proef-open');
  assert.equal(m.length, 6);
  assert.ok(m.includes('Gewijzigd'));
  // "Beveiliging verwijderen" schrijft de platte bytes: die openen zonder wachtwoord.
  assert.equal(mupdfAnnotaties(readFileSync(plat)).length, 6);
});
