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

// Dezelfde partijgrootte als js/pdf/pdf-lib-snelheid.js in de app: met de
// pdf-lib-standaard (50/100 objecten per tik) duurt elke ronde seconden.
const SNEL = 5000;
const PATROON = /[\\/]pdf-lib[\\/]es[\\/]core[\\/]objects[\\/](PDFName|PDFRef)\.js$/;
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = "export { PDFDocument, PDFName, PDFRef, PDFNumber } from 'pdf-lib';";
async function bundel(outfile, plugins = []) {
  await build({ stdin: { contents: entry, resolveDir: appRoot }, bundle: true, platform: 'browser', format: 'esm', outfile, plugins, logLevel: 'silent' });
}
// Alleen voor de test: dezelfde (on)gepatchte bron, plus een haakje op de
// module-variabele `pool`, zodat de omvang van beide pools meetbaar is.
function poolHaak(patch) {
  return {
    name: 'test-intern-pool-probe',
    setup(b) {
      b.onLoad({ filter: PATROON }, ({ path }) => {
        const name = path.match(PATROON)[1];
        const bron = readFileSync(path, 'utf8');
        const code = patch ? patchInternPool(bron, name) : bron;
        return { contents: `${code}\n(globalThis.__internPools ||= {})[${JSON.stringify(name)}] = pool;\n`, loader: 'js' };
      });
    },
  };
}
const draai = (file) => execFileSync(process.execPath, ['--expose-gc', file], { encoding: 'utf8', timeout: 120000 }).trim();
// Gedeelde helpers in de kindprocessen. Een "document" wordt gemaakt,
// opgeslagen en opnieuw ingelezen: de namen en referenties komen dus echt uit
// de parser, met per document eigen namen en een eigen bereik objectnummers.
const helpers = `
const SNEL=${SNEL};
const gc = async () => { for (let n=0;n<12;n++) { await new Promise(r=>setTimeout(r,0)); global.gc(); } };
const naam = (prefix, i) => prefix + i + 'x'.repeat(100);
async function document(prefix, base, aantal = 6000) {
 const doc=await PDFDocument.create(); doc.addPage([100,100]);
 for(let i=0;i<aantal;i++) { const ref=PDFRef.of(base+i); doc.context.assign(ref,PDFNumber.of(i)); doc.catalog.set(PDFName.of(naam(prefix,i)),ref); }
 const bytes=await doc.save({useObjectStreams:false,objectsPerTick:SNEL});
 return PDFDocument.load(bytes,{parseSpeed:SNEL});
}
`;

test('real parsed documents: dead names/refs collect, live lookup/copy/save/reopen survive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opds-intern-'));
  try {
    await bundel(join(dir, 'pdf-lib.mjs'), [pdfLibInternEsbuild()]);
    const child = join(dir, 'check.mjs');
    writeFileSync(child, `
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRef, PDFNumber } from './pdf-lib.mjs';
${helpers}
const a=await document('aliveA',10000), b=await document('aliveB',20000);
// Bewust GEEN sterke verwijzing naar een naam of referentie van a in de test
// zelf: alleen het open document houdt ze vast. Identiteit moet daaruit volgen.
const WEAK_LIVE=[new WeakRef(PDFName.of(naam('aliveA',0))), new WeakRef(PDFRef.of(10000))];
let samples=[];
for(let round=0;round<3;round++) {
 let gone=await document('gone'+round,30000+round*10000);
 const weakName=new WeakRef(PDFName.of(naam('gone'+round,0)));
 const weakRef=new WeakRef(PDFRef.of(30000+round*10000)); gone=null;
 await gc();
 assert.equal(weakName.deref(),undefined,'dead parsed PDFName collected');
 assert.equal(weakRef.deref(),undefined,'dead parsed PDFRef collected');
 assert.ok(WEAK_LIVE.every(r=>r.deref()!==undefined),'names/refs of an open document stay alive');
 samples.push(process.memoryUsage().heapUsed);
 // De instanties die het open document zelf in zijn woordenboek heeft.
 const eigenSleutel=a.catalog.keys().find(k=>k.asString()==='/'+naam('aliveA',0));
 assert.ok(eigenSleutel,'live document still has its key');
 assert.equal(PDFName.of(naam('aliveA',0)),eigenSleutel,'PDFName.of returns the live instance');
 assert.equal(PDFName.of('aliveA0#78'+'x'.repeat(99)),eigenSleutel,'decoded name alias');
 const eigenRef=a.catalog.get(eigenSleutel);
 assert.ok(eigenRef instanceof PDFRef);
 assert.equal(PDFRef.of(10000),eigenRef,'PDFRef.of returns the live instance');
 // Map-lookups op identiteit, met verse .of()-instanties.
 assert.equal(a.catalog.lookup(PDFName.of(naam('aliveA',5999)),PDFNumber).asNumber(),5999);
 assert.equal(a.context.lookup(PDFRef.of(15999),PDFNumber).asNumber(),5999);
 assert.equal(b.catalog.lookup(PDFName.of(naam('aliveB',1)),PDFNumber).asNumber(),1);
 const [copy]=await b.copyPages(a,[0]); b.addPage(copy);
 const reopened=await PDFDocument.load(await b.save({objectsPerTick:SNEL}),{parseSpeed:SNEL});
 assert.equal(reopened.getPageCount(),round+2);
 assert.equal(reopened.catalog.lookup(PDFName.of(naam('aliveB',5999)),PDFNumber).asNumber(),5999);
}
console.log(JSON.stringify({heapAfterGC:samples,liveDocuments:2,closedDocuments:3,namesPerDocument:6000}));
`);
    console.log('patched:', draai(child));
    // Same fixture and lifecycle against the unmodified dependency reproduces both pools.
    await bundel(join(dir, 'unpatched.mjs'));
    const baseline = readFileSync(child, 'utf8').replace("'./pdf-lib.mjs'", "'./unpatched.mjs'")
      .replace('assert.equal(weakName.deref(),undefined', 'assert.notEqual(weakName.deref(),undefined')
      .replace('assert.equal(weakRef.deref(),undefined', 'assert.notEqual(weakRef.deref(),undefined');
    writeFileSync(child, baseline);
    console.log('unpatched:', draai(child));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opening and closing many documents with distinct names keeps both pools bounded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opds-intern-bound-'));
  try {
    const RONDES = 12, PER = 2000;
    const script = (lib) => `
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRef, PDFNumber } from './${lib}';
${helpers}
const pools = globalThis.__internPools;
assert.ok(pools.PDFName && pools.PDFRef, 'probe sees both pools');
const open=await document('open',100000,${PER});
await gc();
const start={names:pools.PDFName.size, refs:pools.PDFRef.size};
const sizes=[];
for(let round=0;round<${RONDES};round++) {
 let gone=await document('closed'+round+'_',200000+round*${PER},${PER});
 assert.equal(gone.catalog.lookup(PDFName.of(naam('closed'+round+'_',7)),PDFNumber).asNumber(),7);
 gone=null;
 await gc();
 sizes.push({names:pools.PDFName.size, refs:pools.PDFRef.size});
}
// Het open document blijft intact na alle rondes.
assert.equal(open.catalog.lookup(PDFName.of(naam('open',${PER - 1})),PDFNumber).asNumber(),${PER - 1});
assert.equal(open.context.lookup(PDFRef.of(${100000 + PER - 1}),PDFNumber).asNumber(),${PER - 1});
console.log(JSON.stringify({start,end:sizes.at(-1),max:{names:Math.max(...sizes.map(s=>s.names)),refs:Math.max(...sizes.map(s=>s.refs))}}));
`;
    await bundel(join(dir, 'weak.mjs'), [poolHaak(true)]);
    writeFileSync(join(dir, 'weak-check.mjs'), script('weak.mjs'));
    const weak = JSON.parse(draai(join(dir, 'weak-check.mjs')));
    await bundel(join(dir, 'strong.mjs'), [poolHaak(false)]);
    writeFileSync(join(dir, 'strong-check.mjs'), script('strong.mjs'));
    const strong = JSON.parse(draai(join(dir, 'strong-check.mjs')));
    console.log('pool sizes:', JSON.stringify({ weak, strong }));
    // Zonder patch groeit elke pool met elk gesloten document mee...
    assert.ok(strong.end.names - strong.start.names >= RONDES * PER, 'unpatched name pool grows per closed document');
    assert.ok(strong.end.refs - strong.start.refs >= RONDES * PER, 'unpatched reference pool grows per closed document');
    // ...met patch blijft hij binnen de levende set plus hooguit één document
    // waarvan de finalizers nog niet allemaal gelopen hebben.
    for (const soort of ['names', 'refs']) {
      assert.ok(weak.max[soort] <= weak.start[soort] + PER, `${soort} pool stays bounded: ${JSON.stringify(weak)}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
