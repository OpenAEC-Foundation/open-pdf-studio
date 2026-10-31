// Batch OCR over a folder (#382): the planner (output names, skip rules,
// collisions), the run with a stubbed OCR and an in-memory file system
// (headless, atomic, cancellable, failures reported per file) and the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFBool, decodePDFRawStream } from 'pdf-lib';
import {
  planBatchOcr, normaliseOptions, targetFor, relativeDir, joinPath, splitPath, numberedName, samePath,
  pagesToRecognise, summarise, reportCsv, csvCell, failures, reportFileName, validSuffix, REASON,
} from './batch-ocr-plan.js';
import { runBatchOcr, applyOcrLayer } from './batch-ocr-runner.js';

const FONT = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
const loadFontBytes = async () => new Uint8Array(FONT);

// ── Paths ──

test('paths keep the separator of the folder they are built on', () => {
  assert.equal(joinPath('/data/in', 'sub', 'a.pdf'), '/data/in/sub/a.pdf');
  assert.equal(joinPath('C:\\scans\\', 'sub/deep', 'a.pdf'), 'C:\\scans\\sub\\deep\\a.pdf');
  assert.deepEqual(splitPath('C:\\x\\y.pdf'), { dir: 'C:\\x', base: 'y.pdf' });
  assert.equal(relativeDir('/data/in', '/data/in/a.pdf'), '');
  assert.equal(relativeDir('/data/in/', '/data/in/Sub/Deep/a.pdf'), 'Sub/Deep');
  assert.equal(relativeDir('C:\\In', 'c:\\in\\Sub\\a.pdf'), 'Sub', 'Windows paths ignore case');
  assert.equal(relativeDir('/data/in', '/data/inner/a.pdf'), null);
  assert.equal(numberedName('/o/a.PDF', 2), '/o/a (2).PDF');
  assert.ok(samePath('C:\\A\\b.pdf', 'c:/a/B.PDF'));
  assert.ok(!samePath('/A/b.pdf', '/a/b.pdf'), 'Unix paths keep case');
});

test('options: an impossible choice is refused before anything runs', () => {
  assert.throws(() => normaliseOptions({}), /BATCH_OCR_NO_SOURCE/);
  assert.throws(() => normaliseOptions({ sourceDir: '/in', outputMode: 'folder' }), /BATCH_OCR_NO_OUTPUT/);
  assert.throws(() => normaliseOptions({ sourceDir: '/in', outputMode: 'beside', suffix: '' }), /BATCH_OCR_SUFFIX_REQUIRED/);
  assert.throws(() => normaliseOptions({ sourceDir: '/in', outputMode: 'beside', suffix: '../x' }), /BATCH_OCR_BAD_SUFFIX/);
  assert.equal(normaliseOptions({ sourceDir: '/in', outputMode: 'beside' }).suffix, '_ocr');
  assert.equal(normaliseOptions({ sourceDir: '/in', outputMode: 'bogus', outputDir: '/out' }).outputMode, 'folder');
  assert.ok(validSuffix('-searchable') && !validSuffix('a:b') && !validSuffix('a\\b'));
});

test('output names: same subfolders in the output folder, or a suffix beside the source', () => {
  const folder = normaliseOptions({ sourceDir: '/in', outputMode: 'folder', outputDir: '/out' });
  assert.equal(targetFor('/in/sub/scan.pdf', folder), '/out/sub/scan.pdf');
  const suffixed = normaliseOptions({ sourceDir: '/in', outputMode: 'folder', outputDir: '/out', suffix: '_ocr' });
  assert.equal(targetFor('/in/Scan.PDF', suffixed), '/out/Scan_ocr.pdf');
  const beside = normaliseOptions({ sourceDir: 'C:\\in', outputMode: 'beside' });
  assert.equal(targetFor('C:\\in\\sub\\a.pdf', beside), 'C:\\in\\sub\\a_ocr.pdf');
  const replace = normaliseOptions({ sourceDir: '/in', outputMode: 'replace' });
  assert.equal(targetFor('/in/a.pdf', replace), '/in/a.pdf');
});

// ── Planner ──

test('collisions: rename adds a number, skip skips, overwrite only replaces what is not of this run', async () => {
  const files = ['/in/a.pdf', '/in/b.pdf', '/in/sub/a.pdf'];
  const existing = new Set(['/out/a.pdf', '/out/a (2).pdf']);
  const exists = (p) => existing.has(p);

  const renamed = await planBatchOcr(files, { sourceDir: '/in', outputMode: 'folder', outputDir: '/out' }, { exists });
  assert.deepEqual(renamed.map((p) => p.target), ['/out/a (3).pdf', '/out/b.pdf', '/out/sub/a.pdf']);
  assert.ok(renamed.every((p) => p.action === 'ocr' && !p.overwrite));

  const skipped = await planBatchOcr(files, { sourceDir: '/in', outputMode: 'folder', outputDir: '/out', existing: 'skip' }, { exists });
  assert.deepEqual(skipped.map((p) => [p.action, p.reason]), [['skip', REASON.EXISTS], ['ocr', null], ['ocr', null]]);

  const over = await planBatchOcr(files, { sourceDir: '/in', outputMode: 'folder', outputDir: '/out', existing: 'overwrite' }, { exists });
  assert.equal(over[0].target, '/out/a.pdf');
  assert.equal(over[0].overwrite, true);
});

test('two sources never write the same output, also in a case-insensitive folder', async () => {
  const plan = await planBatchOcr(['C:\\in\\x\\A.pdf', 'C:\\in\\x\\a.pdf'],
    { sourceDir: 'C:\\in', outputMode: 'folder', outputDir: 'C:\\out', existing: 'overwrite' });
  assert.equal(plan[0].target, 'C:\\out\\x\\A.pdf');
  assert.equal(plan[1].target, 'C:\\out\\x\\a (2).pdf', 'a planned output is never overwritten');
  assert.ok(!plan[1].overwrite);
});

test('the source itself is never overwritten unless replacing was chosen', async () => {
  // Output folder = source folder without a suffix: the copy would be the original.
  const same = await planBatchOcr(['/in/a.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/in', existing: 'overwrite' },
    { exists: () => true });
  assert.deepEqual(same.map((p) => [p.action, p.reason]), [['skip', REASON.SAME_AS_SOURCE]]);
  // Another source file of the run is not a free target either.
  const clash = await planBatchOcr(['/in/a.pdf', '/in/a_ocr.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/in', suffix: '_ocr', existing: 'overwrite' });
  assert.equal(clash[0].target, '/in/a_ocr (2).pdf');
  // Replace: only on explicit choice, and never a file open in a tab.
  const replace = await planBatchOcr(['/in/a.pdf', '/in/b.pdf'], { sourceDir: '/in', outputMode: 'replace' },
    { isOpen: (p) => p === '/in/b.pdf' });
  assert.deepEqual(replace.map((p) => [p.action, p.target, p.overwrite, p.reason]),
    [['ocr', '/in/a.pdf', true, null], ['skip', null, false, REASON.OPEN]]);
});

test('beside the source: results of an earlier run are not processed again', async () => {
  const plan = await planBatchOcr(['/in/a.pdf', '/in/a_ocr.pdf'], { sourceDir: '/in', outputMode: 'beside' },
    { exists: (p) => p === '/in/a_ocr.pdf' });
  assert.deepEqual(plan.map((p) => [p.action, p.target, p.reason]), [
    ['ocr', '/in/a_ocr (2).pdf', null],
    ['skip', null, REASON.OWN_OUTPUT],
  ]);
});

test('an output file open in a tab is not overwritten', async () => {
  const plan = await planBatchOcr(['/in/a.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/out', existing: 'overwrite' },
    { isOpen: (p) => p === '/out/a.pdf' });
  assert.deepEqual(plan.map((p) => [p.action, p.reason]), [['skip', REASON.OPEN]]);
});

test('skip rule for pages that already have text', () => {
  assert.deepEqual(pagesToRecognise([0, 120, 0, 3]), [0, 1, 2, 3]);
  assert.deepEqual(pagesToRecognise([0, 120, 0, 3], { skipText: true }), [0, 2]);
  assert.deepEqual(pagesToRecognise([5, 9], { skipText: true }), []);
});

// ── The run ──

async function pdfWithPages(n) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < n; i++) pdf.addPage([595, 842]);
  return new Uint8Array(await pdf.save());
}

function ownedLayer(pdf, pageIndex) {
  const contents = pdf.getPage(pageIndex).node.Contents();
  if (!contents) return null;
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const owned = refs.map((ref) => pdf.context.lookup(ref))
    .filter((stream) => stream?.dict?.get(PDFName.of('OPS_OCRLayer')) === PDFBool.True);
  return owned.length ? owned.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n') : null;
}

/** An in-memory file system and a stubbed OCR, with a log of every call. */
async function world(files) {
  const disk = new Map();
  for (const [path, spec] of Object.entries(files)) disk.set(path, { bytes: await pdfWithPages(spec.pages), text: spec.text });
  const log = [];
  const deps = {
    inspect: async (path) => {
      log.push(['inspect', path]);
      const f = disk.get(path);
      if (!f) throw new Error(`Read: ${path} not found`);
      if (f.text === 'broken') throw new Error('Failed to load PDF via PDFium: corrupt');
      return f.text || new Array((await PDFDocument.load(f.bytes)).getPageCount()).fill(0);
    },
    ocrPage: async (path, pageIndex, lang) => {
      log.push(['ocr', path, pageIndex, lang]);
      return [{ text: `p${pageIndex + 1}`, left: 72, top: 72, width: 40, height: 12, confidence: 90 }];
    },
    readFile: async (path) => disk.get(path).bytes.slice(),
    writeNew: async (path, bytes) => {
      log.push(['writeNew', path]);
      if (disk.has(path)) throw new Error('CHOOSE_NEW_FILE');
      disk.set(path, { bytes });
    },
    writeReplace: async (path, bytes) => { log.push(['writeReplace', path]); disk.set(path, { bytes }); },
    ensureDir: async (dir) => { log.push(['mkdir', dir]); },
    release: async () => { log.push(['release']); },
    loadFontBytes,
  };
  return { disk, log, deps };
}

test('a folder runs without interaction: every file once, output written in one go, report per file', async () => {
  const { disk, log, deps } = await world({
    '/in/a.pdf': { pages: 2 },
    '/in/sub/b.pdf': { pages: 3, text: [0, 50, 0] },
    '/in/c.pdf': { pages: 1, text: [80] },
    '/in/bad.pdf': { pages: 1, text: 'broken' },
  });
  const options = { sourceDir: '/in', outputMode: 'folder', outputDir: '/out' };
  const plan = await planBatchOcr(['/in/a.pdf', '/in/bad.pdf', '/in/c.pdf', '/in/sub/b.pdf'], options, { exists: (p) => disk.has(p) });
  const progress = [];
  const results = await runBatchOcr(plan, { lang: 'eng', skipText: true }, deps, { onProgress: (p) => progress.push(p.result.status) });

  assert.deepEqual(results.map((r) => [r.source, r.status]), [
    ['/in/a.pdf', 'done'], ['/in/bad.pdf', 'failed'], ['/in/c.pdf', 'skipped'], ['/in/sub/b.pdf', 'done'],
  ]);
  assert.equal(results[2].reason, REASON.HAS_TEXT);
  assert.match(results[1].message, /corrupt/);
  assert.equal(results[3].ocrPages, 2, 'only the pages without text');
  assert.deepEqual(log.filter((l) => l[0] === 'ocr' && l[1] === '/in/sub/b.pdf').map((l) => l[2]), [0, 2]);
  assert.ok(log.filter((l) => l[0] === 'ocr').every((l) => l[3] === 'eng'));
  assert.deepEqual(log.filter((l) => l[0].startsWith('write')).map((l) => l.join(' ')), ['writeNew /out/a.pdf', 'writeNew /out/sub/b.pdf']);
  assert.ok(log.some((l) => l[0] === 'mkdir' && l[1] === '/out/sub'));
  assert.equal(log.filter((l) => l[0] === 'release').length, 4, 'the document is let go after every inspected file');
  assert.ok(progress.includes('running'));

  // The written copy carries the invisible text layer; the source is untouched.
  const out = await PDFDocument.load(disk.get('/out/sub/b.pdf').bytes);
  assert.match(ownedLayer(out, 0) || '', /(^|\s)3 Tr\b/, 'invisible text on page 1');
  assert.equal(ownedLayer(out, 1), null, 'page with text left alone');
  assert.ok(ownedLayer(out, 2));
  const source = await PDFDocument.load(disk.get('/in/sub/b.pdf').bytes);
  assert.equal(ownedLayer(source, 0), null, 'source never changed');

  const sum = summarise(results);
  assert.deepEqual([sum.total, sum.done, sum.skipped, sum.failed, sum.cancelled, sum.pages], [4, 2, 1, 1, 0, 4]);
  assert.deepEqual(failures(results).map((r) => r.source), ['/in/bad.pdf']);
});

test('an output that appears after planning gets the next free number (rename) or is skipped', async () => {
  const { disk, deps } = await world({ '/in/a.pdf': { pages: 1 } });
  const plan = await planBatchOcr(['/in/a.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/out' });
  disk.set('/out/a.pdf', { bytes: new Uint8Array([1]) }); // another program was faster
  const [renamed] = await runBatchOcr(plan, {}, deps);
  assert.equal(renamed.status, 'done');
  assert.equal(renamed.target, '/out/a (2).pdf');
  assert.deepEqual([...disk.get('/out/a.pdf').bytes], [1], 'the other file is kept');

  const second = await world({ '/in/a.pdf': { pages: 1 } });
  second.disk.set('/out/a.pdf', { bytes: new Uint8Array([2]) });
  const [skipped] = await runBatchOcr(plan, { existing: 'skip' }, second.deps);
  assert.deepEqual([skipped.status, skipped.reason], ['skipped', REASON.EXISTS]);
});

test('replacing the source goes through the atomic writer', async () => {
  const { log, deps } = await world({ '/in/a.pdf': { pages: 1 } });
  const plan = await planBatchOcr(['/in/a.pdf'], { sourceDir: '/in', outputMode: 'replace' });
  const [r] = await runBatchOcr(plan, {}, deps);
  assert.equal(r.status, 'done');
  assert.deepEqual(log.filter((l) => l[0].startsWith('write')), [['writeReplace', '/in/a.pdf']]);
});

test('cancel: the current file is dropped without a partial result, the rest is reported as cancelled', async () => {
  const { disk, log, deps } = await world({ '/in/a.pdf': { pages: 1 }, '/in/b.pdf': { pages: 3 }, '/in/c.pdf': { pages: 1 } });
  let cancelled = false;
  const ocrPage = deps.ocrPage;
  deps.ocrPage = async (path, index, lang) => {
    if (path === '/in/b.pdf' && index === 1) cancelled = true; // the user clicks Stop during page 2
    return ocrPage(path, index, lang);
  };
  const plan = await planBatchOcr(['/in/a.pdf', '/in/b.pdf', '/in/c.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/out' });
  const results = await runBatchOcr(plan, {}, deps, { isCancelled: () => cancelled });
  assert.deepEqual(results.map((r) => r.status), ['done', 'cancelled', 'cancelled']);
  assert.ok(disk.has('/out/a.pdf'));
  assert.ok(!disk.has('/out/b.pdf'), 'no partial output');
  assert.ok(!log.some((l) => l[1] === '/in/c.pdf'), 'the next file is not touched');
  assert.equal(log.filter((l) => l[0] === 'ocr' && l[1] === '/in/b.pdf').length, 2, 'stops between pages');
});

test('a missing OCR font fails the file instead of writing a copy without text', async () => {
  const { disk, deps } = await world({ '/in/a.pdf': { pages: 1 } });
  deps.loadFontBytes = async () => { throw new Error('failed to open file'); };
  const plan = await planBatchOcr(['/in/a.pdf'], { sourceDir: '/in', outputMode: 'folder', outputDir: '/out' });
  const [r] = await runBatchOcr(plan, {}, deps);
  assert.deepEqual([r.status, r.message], ['failed', 'BATCH_OCR_FONT_MISSING']);
  assert.ok(!disk.has('/out/a.pdf'));
});

test('applyOcrLayer: blank pages still give a valid copy', async () => {
  const bytes = await applyOcrLayer(await pdfWithPages(2), { 1: [], 2: [] }, loadFontBytes);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

// ── Report ──

test('the report is CSV a spreadsheet opens safely', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell(null), '');
  const csv = reportCsv([
    { source: '/in/a.pdf', status: 'done', pages: 2, ocrPages: 2, words: 10, target: '/out/a.pdf', reason: null, message: '' },
    { source: '/in/b, c.pdf', status: 'failed', pages: null, ocrPages: 0, words: 0, target: null, reason: null, message: 'Read: line1\nline2' },
  ]);
  assert.ok(csv.startsWith('\uFEFFfile,status,pages,ocr_pages,words,output,reason,message\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], '/in/a.pdf,done,2,2,10,/out/a.pdf,,');
  assert.equal(lines[2], '"/in/b, c.pdf",failed,,0,0,,,"Read: line1\nline2"');
  assert.equal(reportFileName(new Date(2026, 9, 28, 9, 5)), 'batch-ocr-20261028-0905.csv');
});

// ── Wiring ──

test('every command the batch and scanner code calls is registered in lib.rs', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const lib = read('../../src-tauri/src/lib.rs');
  const handler = lib.slice(lib.indexOf('generate_handler!['));
  const js = read('./batch-ocr.js') + read('./scanner.js');
  const used = [...js.matchAll(/invoke\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 8);
  for (const name of new Set(used)) {
    assert.match(handler, new RegExp(`[\\s:]${name},`), `${name} is not registered`);
  }
});
