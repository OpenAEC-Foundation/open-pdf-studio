// The save path is dominated by pdf-lib, not by our own code: saver.js calls
// PDFDocument.load(bytes) at the top and pdfDocLib.save() at the bottom, and
// everything in between mutates the object graph pdf-lib parsed.
//
// This measures those two calls on the real files in the verification set, plus
// the cost of adding N annotation dictionaries with an appearance stream, so the
// three parts of a save can be compared.
//
// Run: node scripts/bench-rust/03-saver-pdflib.mjs [pdfDir]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { median } from './lib.mjs';
import { PDFDocument, PDFName, PDFString, PDFArray } from 'pdf-lib';

const dir = process.argv[2] ?? join(process.cwd(), '..', 'test pdf-bestanden', 'Originele bestanden');
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));

console.log(`node ${process.version}  pdf-lib from node_modules`);
console.log(`sources: ${files.length} files in the verification set\n`);
console.log(`${'file'.padEnd(10)} | ${'MB'.padStart(6)} | ${'pages'.padStart(5)} | ${'load ms'.padStart(9)} | ${'save ms'.padStart(9)} | ${'load+save'.padStart(9)}`);
console.log(`${'-'.repeat(10)}-+-${'-'.repeat(6)}-+-${'-'.repeat(5)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}`);

const summary = [];
for (const f of files) {
  const p = join(dir, f);
  const bytes = readFileSync(p);
  const mb = statSync(p).size / 1024 / 1024;
  // Files are identified by size and page count only; names stay out of the log.
  const tag = `#${summary.length + 1}`;
  let loads = [], saves = [], pages = 0;
  const reps = mb > 8 ? 2 : 3;
  try {
    for (let i = 0; i < reps; i++) {
      const t0 = process.hrtime.bigint();
      const doc = await PDFDocument.load(bytes);
      const t1 = process.hrtime.bigint();
      pages = doc.getPageCount();
      await doc.save();
      const t2 = process.hrtime.bigint();
      loads.push(Number(t1 - t0) / 1e6);
      saves.push(Number(t2 - t1) / 1e6);
    }
  } catch (e) {
    console.log(`${tag.padEnd(10)} | ${mb.toFixed(2).padStart(6)} |     ? | failed: ${String(e.message).slice(0, 50)}`);
    continue;
  }
  const L = median(loads), S = median(saves);
  summary.push({ tag, mb, pages, L, S });
  console.log(`${tag.padEnd(10)} | ${mb.toFixed(2).padStart(6)} | ${String(pages).padStart(5)} | ${L.toFixed(1).padStart(9)} | ${S.toFixed(1).padStart(9)} | ${(L + S).toFixed(1).padStart(9)}`);
}

// ---- cost of adding annotation dictionaries on top of a parsed document ----
const heaviest = summary.slice().sort((a, b) => b.mb - a.mb)[0];
console.log(`\nannotation-dictionary cost, measured on the largest file (${heaviest.mb.toFixed(2)} MB, ${heaviest.pages} pages)`);

const bigPath = join(dir, files[summary.findIndex((s) => s.tag === heaviest.tag)]);
const bigBytes = readFileSync(bigPath);


console.log(`${'annots'.padStart(7)} | ${'load ms'.padStart(9)} | ${'build ms'.padStart(9)} | ${'save ms'.padStart(9)} | ${'total ms'.padStart(9)}`);
console.log(`${'-'.repeat(7)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}`);
for (const n of [0, 100, 500, 2000]) {
  const L = [], B = [], S = [];
  for (let rep = 0; rep < 4; rep++) {
    const t0 = process.hrtime.bigint();
    const doc = await PDFDocument.load(bigBytes);
    const t1 = process.hrtime.bigint();
    addAnnots(doc, n);
    const t2 = process.hrtime.bigint();
    await doc.save();
    const t3 = process.hrtime.bigint();
    if (rep === 0) continue; // first pass warms the JIT
    L.push(Number(t1 - t0) / 1e6); B.push(Number(t2 - t1) / 1e6); S.push(Number(t3 - t2) / 1e6);
  }
  const l = median(L), b = median(B), s = median(S);
  console.log(`${String(n).padStart(7)} | ${l.toFixed(1).padStart(9)} | ${b.toFixed(1).padStart(9)} | ${s.toFixed(1).padStart(9)} | ${(l + b + s).toFixed(1).padStart(9)}`);
}

function addAnnots(doc, n) {
  if (!n) return;
  {
    const page = doc.getPages()[0];
    for (let i = 0; i < n; i++) {
      const x = 20 + (i % 20) * 25, y = 20 + Math.floor(i / 20) * 25;
      const ap = doc.context.stream(
        `1 0 0 RG 1 w 0.5 0.5 19 19 re S\n`,
        { Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'),
          BBox: doc.context.obj([0, 0, 20, 20]), Resources: doc.context.obj({}) },
      );
      const apRef = doc.context.register(ap);
      const annot = doc.context.obj({
        Type: 'Annot', Subtype: 'Square',
        Rect: doc.context.obj([x, y, x + 20, y + 20]),
        F: 4, C: doc.context.obj([1, 0, 0]),
        T: PDFString.of('bench'), Contents: PDFString.of(`item ${i}`),
        AP: doc.context.obj({ N: apRef }),
      });
      const ref = doc.context.register(annot);
      let annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
      if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
      annots.push(ref);
    }
  }
}
