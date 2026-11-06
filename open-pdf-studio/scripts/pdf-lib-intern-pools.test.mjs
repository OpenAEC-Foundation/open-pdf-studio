import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { createWeakInternPool, patchInternPool, pdfLibInternPools, pdfLibInternEsbuild } from './pdf-lib-intern-pools.mjs';

test('live identity, replacement and stale finalizer; held data is weak', () => {
  let finalize; const registrations = [];
  class Ref { constructor(value) { this.value = value; } deref() { return this.value; } }
  class Registry {
    constructor(callback) { finalize = callback; }
    register(value, held, token) { registrations.push({ held, token }); assert.notEqual(held, value); }
    unregister(token) { assert.equal(token, registrations[0].token); }
  }
  const pool = createWeakInternPool(Ref, Registry);
  let first = {}; pool.set('name', first);
  assert.equal(pool.get('name'), first);
  registrations[0].held.ref.value = undefined; first = null;
  assert.equal(pool.get('name'), undefined);
  const replacement = {}; pool.set('name', replacement);
  finalize(registrations[0].held);
  assert.equal(pool.get('name'), replacement, 'old finalizer cannot remove replacement');
  registrations[1].held.ref.value = undefined;
  finalize(registrations[1].held);
  assert.equal(pool.get('name'), undefined);
});

test('missing either weak API keeps identity-safe original strong map', () => {
  for (const args of [[null, null], [WeakRef, null], [null, FinalizationRegistry]]) {
    const pool = createWeakInternPool(...args); const value = {};
    assert.ok(pool instanceof Map); pool.set('x', value); assert.equal(pool.get('x'), value);
  }
});

test('exact qualified sources patched in production and optimizer, dependency drift rejected', () => {
  const plugin = pdfLibInternPools();
  assert.equal(plugin.config().optimizeDeps.esbuildOptions.plugins[0].name, plugin.name);
  for (const name of ['PDFName', 'PDFRef']) {
    const path = new URL(`../node_modules/pdf-lib/es/core/objects/${name}.js`, import.meta.url);
    const source = readFileSync(path, 'utf8');
    const fixed = patchInternPool(source, name);
    assert.ok(fixed.includes('createWeakInternPool'));
    assert.equal(plugin.transform(source, fileURLToPath(path)).code, fixed);
    assert.throws(() => patchInternPool(source + '\n', name), /Unqualified/);
  }
  assert.equal(plugin.transform('unchanged', '/app/other.js'), null);
});

test('real parsed documents: dead names/refs collect, live lookup/copy/save/reopen survive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opds-intern-'));
  try {
    const outfile = join(dir, 'pdf-lib.mjs');
    await build({ stdin: { contents: "export { PDFDocument, PDFName, PDFRef, PDFNumber } from 'pdf-lib';", resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, platform: 'browser', format: 'esm', outfile, plugins: [pdfLibInternEsbuild()] });
    const child = join(dir, 'check.mjs');
    writeFileSync(child, `
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRef, PDFNumber } from './pdf-lib.mjs';
const gc = async () => { for (let n=0;n<12;n++) { await new Promise(r=>setTimeout(r,0)); global.gc(); } };
async function document(prefix, base) {
 const doc=await PDFDocument.create(); doc.addPage([100,100]);
 for(let i=0;i<6000;i++) { const ref=PDFRef.of(base+i); doc.context.assign(ref,PDFNumber.of(i)); doc.catalog.set(PDFName.of(prefix+i+'x'.repeat(100)),ref); }
 const bytes=await doc.save({useObjectStreams:false});
 return PDFDocument.load(bytes);
}
const a=await document('aliveA',10000), b=await document('aliveB',20000);
const key=PDFName.of('aliveA0'+'x'.repeat(100)), ref=PDFRef.of(10000);
let samples=[];
for(let round=0;round<3;round++) {
 let gone=await document('gone'+round,30000+round*10000);
 const weakName=new WeakRef(PDFName.of('gone'+round+'0'+'x'.repeat(100)));
 const weakRef=new WeakRef(PDFRef.of(30000+round*10000)); gone=null;
 await gc();
 assert.equal(weakName.deref(),undefined,'dead parsed PDFName collected');
 assert.equal(weakRef.deref(),undefined,'dead parsed PDFRef collected');
 samples.push(process.memoryUsage().heapUsed);
 assert.equal(PDFName.of('aliveA0'+'x'.repeat(100)),key);
 assert.equal(PDFName.of('aliveA0#78'+'x'.repeat(99)),key,'decoded name alias');
 assert.equal(PDFRef.of(10000),ref);
 assert.equal(a.catalog.lookup(key,PDFNumber).asNumber(),0);
 const [copy]=await b.copyPages(a,[0]); b.addPage(copy);
 const reopened=await PDFDocument.load(await b.save()); assert.equal(reopened.getPageCount(),round+2);
}
console.log(JSON.stringify({heapAfterGC:samples,liveDocuments:2,closedDocuments:3,namesPerDocument:6000}));
`);
    const out = execFileSync(process.execPath, ['--expose-gc', child], { encoding: 'utf8', timeout: 90000 });
    console.log('patched:', out.trim());
    // Same fixture and lifecycle against the unmodified dependency reproduces both pools.
    await build({ stdin: { contents: "export { PDFDocument, PDFName, PDFRef, PDFNumber } from 'pdf-lib';", resolveDir: fileURLToPath(new URL('..', import.meta.url)) }, bundle: true, platform: 'browser', format: 'esm', outfile: join(dir, 'unpatched.mjs') });
    const baseline = readFileSync(child, 'utf8').replace("'./pdf-lib.mjs'", "'./unpatched.mjs'")
      .replace('assert.equal(weakName.deref(),undefined', 'assert.notEqual(weakName.deref(),undefined')
      .replace('assert.equal(weakRef.deref(),undefined', 'assert.notEqual(weakRef.deref(),undefined');
    writeFileSync(child, baseline);
    console.log('unpatched:', execFileSync(process.execPath, ['--expose-gc', child], { encoding: 'utf8', timeout: 90000 }).trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
