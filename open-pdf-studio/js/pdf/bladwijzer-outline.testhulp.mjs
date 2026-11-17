// Testhulp voor bladwijzers (#1157): een PDF met een outline zoals een ander
// programma hem schrijft, en de outline rauw teruglezen via pdf-lib.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFNull, PDFHexString } from 'pdf-lib';
import { loadBookmarksFromPdf } from './bladwijzers-lezen.js';

export const N = (s) => PDFName.of(s);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * Drie pagina's (A4 staand) met een outline op het hoogste niveau.
 * `items`: { titel, dest: (paginaRefs, ctx) => waarde van /Dest } of
 * { titel, actie: (paginaRefs, ctx) => /A-dictionary }.
 * `benoemd`: { naam: (paginaRefs, ctx) => bestemming } voor /Dests.
 */
export async function pdfMetOutline(items, { benoemd = null } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]);
  const ctx = doc.context;
  const refs = doc.getPages().map((p) => p.ref);
  const outlines = ctx.obj({ Type: 'Outlines' });
  const outlinesRef = ctx.register(outlines);
  const gemaakt = items.map((item) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(item.titel), Parent: outlinesRef });
    if (item.dest) d.set(N('Dest'), item.dest(refs, ctx));
    if (item.actie) d.set(N('A'), item.actie(refs, ctx));
    return { d, ref: ctx.register(d) };
  });
  gemaakt.forEach((g, i) => {
    if (i > 0) g.d.set(N('Prev'), gemaakt[i - 1].ref);
    if (i < gemaakt.length - 1) g.d.set(N('Next'), gemaakt[i + 1].ref);
  });
  outlines.set(N('First'), gemaakt[0].ref);
  outlines.set(N('Last'), gemaakt[gemaakt.length - 1].ref);
  outlines.set(N('Count'), ctx.obj(gemaakt.length));
  doc.catalog.set(N('Outlines'), outlinesRef);
  if (benoemd) {
    const dests = ctx.obj({});
    for (const [naam, maak] of Object.entries(benoemd)) dests.set(N(naam), maak(refs, ctx));
    doc.catalog.set(N('Dests'), ctx.register(dests));
  }
  return doc.save({ useObjectStreams: false });
}

/** De bladwijzers zoals de lader van de app ze maakt. */
export async function leesBladwijzers(bytes) {
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const bms = await loadBookmarksFromPdf(pd);
  await pd.loadingTask.destroy();
  return bms;
}

/** De outline rauw: [{ titel, pagina (1..), vorm, args }] in volgorde. */
export async function rauweDoelen(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const paginas = doc.getPages().map((p) => p.ref.toString());
  const outlines = ctx.lookup(doc.catalog.get(N('Outlines')));
  const uit = [];
  let ref = outlines?.get(N('First'));
  while (ref) {
    const d = ctx.lookup(ref);
    const dest = ctx.lookup(d.get(N('Dest')));
    assert.ok(dest instanceof PDFArray, 'een expliciete bestemming');
    uit.push({
      titel: d.get(N('Title')).decodeText(),
      pagina: paginas.indexOf(dest.get(0).toString()) + 1,
      vorm: dest.get(1).decodeText(),
      args: dest.asArray().slice(2).map((v) => (v instanceof PDFNumber ? v.asNumber() : (v === PDFNull ? null : String(v)))),
    });
    ref = d.get(N('Next'));
  }
  return uit;
}
