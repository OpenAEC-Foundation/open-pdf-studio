// Document-wide search. The text does NOT come from Rust: find-controller.js
// calls pdf.js `page.getTextContent()` (js/search/find-controller.js:23-25), so
// the parse already happens in the pdf.js worker. What stays on the main thread
// is the per-page matching loop, and that loop rescans the page's item array
// for every match (find-controller.js:133).
//
// This measures both halves on the real files in the verification set, and
// compares the current matching loop with a sorted-walk version of the same
// result, so the two can be told apart.
//
// Run: node scripts/bench-rust/07-search-text.mjs [pdfDir]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bench, report, median } from './lib.mjs';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const dir = process.argv[2] ?? join(process.cwd(), '..', 'test pdf-bestanden', 'Originele bestanden');
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));

console.log(`node ${process.version} | pdfjs-dist ${pdfjs.version}`);
console.log('\ntext extraction over a whole document (pdf.js, worker disabled so the cost is visible)');
console.log(`${'file'.padEnd(6)} | ${'MB'.padStart(6)} | ${'pages'.padStart(5)} | ${'items'.padStart(8)} | ${'chars'.padStart(9)} | ${'extract ms'.padStart(11)}`);
console.log(`${'-'.repeat(6)}-+-${'-'.repeat(6)}-+-${'-'.repeat(5)}-+-${'-'.repeat(8)}-+-${'-'.repeat(9)}-+-${'-'.repeat(11)}`);

let richest = null;
let idx = 0;
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(dir, f)));
  const mb = statSync(join(dir, f)).size / 1024 / 1024;
  idx++;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) { console.log(`#${idx}`.padEnd(6) + ` | ${mb.toFixed(2).padStart(6)} | failed: ${String(e.message).slice(0, 40)}`); continue; }

  const t0 = process.hrtime.bigint();
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    const items = [];
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      items.push({ str: it.str, startPos: text.length, endPos: text.length + it.str.length });
      text += it.str;
    }
    pages.push({ text, items });
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const nItems = pages.reduce((a, p) => a + p.items.length, 0);
  const nChars = pages.reduce((a, p) => a + p.text.length, 0);
  console.log(`#${idx}`.padEnd(6) + ` | ${mb.toFixed(2).padStart(6)} | ${String(doc.numPages).padStart(5)} | ${String(nItems).padStart(8)} | ${String(nChars).padStart(9)} | ${ms.toFixed(1).padStart(11)}`);
  if (!richest || nItems > richest.nItems) richest = { pages, nItems, nChars, tag: `#${idx}`, numPages: doc.numPages };
  await doc.destroy();
}

if (!richest) { console.log('no document could be opened'); process.exit(0); }

// ------------------------------------------- the matching loop, as it is today
// Verbatim shape of js/search/find-controller.js:123-160.
function searchPageToday(pageData, pattern, query) {
  const { text, items } = pageData;
  const results = [];
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const startPos = match.index;
    const endPos = startPos + query.length;
    const matchItems = items.filter((item) => item.startPos < endPos && item.endPos > startPos);
    results.push({ startPos, endPos, matchItems });
    if (match.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return results;
}

// Same answer, but walking the (already sorted) item array once.
function searchPageWalk(pageData, pattern, query) {
  const { text, items } = pageData;
  const results = [];
  let match; let cursor = 0;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const startPos = match.index;
    const endPos = startPos + query.length;
    while (cursor > 0 && items[cursor - 1].endPos > startPos) cursor--;
    while (cursor < items.length && items[cursor].endPos <= startPos) cursor++;
    const matchItems = [];
    for (let i = cursor; i < items.length && items[i].startPos < endPos; i++) matchItems.push(items[i]);
    results.push({ startPos, endPos, matchItems });
    if (match.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return results;
}

const rows = [];
console.log(`\nmatching over the text-richest document (${richest.tag}: ${richest.numPages} pages, ${richest.nItems} text items, ${richest.nChars} chars)`);
for (const query of ['e', 'the']) {
  const total = richest.pages.reduce((a, p) => a + searchPageToday(p, new RegExp(query, 'gi'), query).length, 0);
  console.log(`  query "${query}" -> ${total} matches across the document`);
  rows.push(bench(`search whole document for "${query}" (current, items.filter per match)`, () => {
    for (const p of richest.pages) searchPageToday(p, new RegExp(query, 'gi'), query);
  }, { iters: 1, warm: 1, repeat: 3 }));
  rows.push(bench(`search whole document for "${query}" (single sorted walk)`, () => {
    for (const p of richest.pages) searchPageWalk(p, new RegExp(query, 'gi'), query);
  }, { iters: 1, warm: 1, repeat: 3 }));
}

report(rows);
