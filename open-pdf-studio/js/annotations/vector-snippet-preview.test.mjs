import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { bewaar, leegmaken as wisBronnen } from './vector-snippet-store.js';
import { readFileSync } from 'node:fs';
import { bereidKnipselsVoorUitvoer, bitmapVoor, tekenSchermPreview, wachtOpKnipselPreviews, leegmaken, KNIPSEL_UITVOER_FOUT } from './vector-snippet-preview.js';

let calls = [], closed = 0, fail = false;
// Zoals Tauri: schrijven mag alleen binnen de fs-scope, die allow_fs_scope zet.
const scope = new Set();
const mapVan = (pad) => pad.slice(0, pad.lastIndexOf('/') + 1);
globalThis.window = { devicePixelRatio: 1, __TAURI__: {
  path: { tempDir: async () => '/tmp/' },
  fs: { writeFile: async (pad) => { if (!scope.has(mapVan(pad))) throw new Error(`forbidden path: ${pad}`); } },
  core: { invoke: async (name, args) => {
    if (name === 'allow_fs_scope') { scope.add(mapVan(args.path)); return true; }
    calls.push(args);
    if (fail) throw new Error('render failed');
    const w = Math.ceil(args.regionWPt * args.scale), h = Math.ceil(args.regionHPt * args.scale);
    const data = new Uint8Array(8 + w * h * 4); const view = new DataView(data.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); return data;
  } },
} };
globalThis.ImageData = class { constructor(rgba, width, height) { Object.assign(this, { rgba, width, height }); } };
globalThis.createImageBitmap = async i => ({ width: i.width, height: i.height, close() { closed++; } });
globalThis.requestAnimationFrame = () => 1; // achtergrondvenster: RAF wordt niet uitgevoerd
async function annotation() {
  leegmaken(); wisBronnen(); scope.clear(); calls = []; closed = 0; fail = false;
  const pdf = await PDFDocument.create(); pdf.addPage([1000, 1000]);
  return { type: 'vectorSnippet', snippetKey: bewaar(await pdf.save()), srcBox: { left: 0, bottom: 0, right: 1000, top: 1000 }, width: 100, height: 100 };
}
test('uitvoer wacht zonder animation frame op juiste schaal en geeft geen placeholder', async () => {
  const ann = await annotation();
  const result = await bereidKnipselsVoorUitvoer([ann], 3);
  assert.ok(Math.abs(result.get(ann).width - 300) <= 1);
  assert.ok(Math.abs(calls[0].scale - 0.3) < 1e-12);
  for (const b of result.values()) b.close();
});
test('mislukte uitvoer werpt fout in plaats van stil een placeholder te drukken', async () => {
  const ann = await annotation(); fail = true;
  await assert.rejects(bereidKnipselsVoorUitvoer([ann], 1), /render failed/);
});
test('schermpreview volgt plaatsingsmaat en gebruikt scherpere cache bij uitzoomen', async () => {
  const ann = await annotation();
  assert.equal(bitmapVoor(ann, 2), null);
  await new Promise(r => setTimeout(r, 40));
  const bitmap = bitmapVoor(ann, 2);
  assert.equal(bitmap.width, 250);
  assert.equal(bitmapVoor(ann, 1), bitmap);
  await new Promise(r => setTimeout(r, 40));
});

// Uitvoer boven MAX_PIXELS (#511): in tegels, op één canvas samengevoegd.
const tegels = [];
globalThis.OffscreenCanvas = class {
  constructor(width, height) { Object.assign(this, { width, height }); }
  getContext() { return { putImageData: (img, x, y, dx, dy, dw, dh) => tegels.push({ x, y, dw, dh, w: img.width, h: img.height }) }; }
};

test('uitvoer groter dan een tegel wordt in tegels gerenderd, op de volle resolutie', async () => {
  const ann = await annotation(); tegels.length = 0;
  ann.width = 1000; ann.height = 1000;
  const result = await bereidKnipselsVoorUitvoer([ann], 6);
  const bmp = result.get(ann);
  assert.deepEqual([bmp.width, bmp.height], [6000, 6000]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.scale === 6 && Math.ceil(c.regionWPt * 6) <= 4097 && Math.ceil(c.regionHPt * 6) <= 4097));
  assert.deepEqual(tegels.map(t => [t.x, t.y, t.dw, t.dh]),
    [[0, 0, 4096, 4096], [4096, 0, 1904, 4096], [0, 4096, 4096, 1904], [4096, 4096, 1904, 1904]]);
  for (const b of result.values()) b.close();
});

test('samen te grote knipsels gaan evenredig omlaag, binnen het geheugenbudget', async () => {
  const ann = await annotation();
  ann.width = 1000; ann.height = 1000;
  const tweede = { ...ann };
  const result = await bereidKnipselsVoorUitvoer([ann, tweede], 10);
  const zijde = result.get(ann).width;
  assert.equal(result.get(tweede).width, zijde);
  assert.ok(zijde < 10000 && 2 * zijde * zijde <= 64 * 1024 * 1024 + 2 * 2 * zijde, `${zijde}`);
  for (const b of result.values()) b.close();
});

test('een knipsel dat niet in de uitvoer kan, draagt de foutcode voor de melding', async () => {
  const ann = await annotation(); fail = true;
  await assert.rejects(bereidKnipselsVoorUitvoer([ann], 1), (err) => err.code === KNIPSEL_UITVOER_FOUT);
  wisBronnen();
  await assert.rejects(bereidKnipselsVoorUitvoer([{ ...ann, snippetKey: 'weg' }], 1), (err) => err.code === KNIPSEL_UITVOER_FOUT);
});

test('afdruk en export tekenen nooit het lege kader van een knipsel', () => {
  const bron = readFileSync(new URL('./rendering.js', import.meta.url), 'utf8');
  const tak = bron.slice(bron.indexOf("case 'vectorSnippet': {"), bron.indexOf("case 'image':", bron.indexOf("case 'vectorSnippet': {")));
  // In de uitvoer nooit de schermcache, en zonder beeld een fout vóór het kader.
  assert.match(tak, /uitvoer \? null : bitmapVoor\(annotation, zoom\)/);
  assert.ok(tak.indexOf('throw fout') < tak.indexOf('setLineDash([5'));
});

// A viewport into the middle of a large snippet. No DOM is needed to verify
// the native region requests and asynchronous cache lifetime.
function detailContext(scale = 64, offset = -30000) {
  const draws = [];
  return { draws, canvas: { width: 800, height: 600 },
    getTransform: () => ({ a: scale, b: 0, c: 0, d: scale, e: offset, f: offset,
      inverse: () => ({ transformPoint: ({x,y}) => ({x:(x-offset)/scale,y:(y-offset)/scale}) }) }),
    drawImage: (...args) => draws.push(args) };
}

test('high zoom renders visible detail above both old ceilings, with bounded requests', async () => {
  const ann = await annotation(); Object.assign(ann,{x:0,y:0,width:1000,height:1000});
  await wachtOpKnipselPreviews([ann],64);
  const overview = bitmapVoor(ann,64);
  assert.equal(overview.width,4096);
  const ctx = detailContext();
  const first = calls.length;
  tekenSchermPreview(ctx,ann,overview);
  tekenSchermPreview(ctx,ann,overview); // in-flight dedupe
  await wachtOpKnipselPreviews([ann],64);
  const detail = calls.slice(first);
  assert.equal(detail.length,4);
  assert.ok(detail.every(c=>c.scale===64 && c.regionWPt<=514/64 && c.regionHPt<=514/64));
  assert.ok(detail.every(c=>c.regionXPt>450 && c.regionYPt>450));
  ctx.draws.length=0;
  tekenSchermPreview(ctx,ann,overview);
  assert.ok(ctx.draws.some(d=>d[0]!==overview));
  // Each destination cell is drawn once: transparent detail replaces fallback.
  assert.equal(new Set(ctx.draws.map(d=>d.slice(-4).join(','))).size,ctx.draws.length);
  await wachtOpKnipselPreviews([ann],64);
  const beforePan=calls.length;
  tekenSchermPreview(detailContext(64,-35000),ann,overview);
  await wachtOpKnipselPreviews([ann],64);
  assert.ok(calls.length>beforePan,'panning requests a different source region');
  const beforeOffscreen=calls.length;
  tekenSchermPreview(detailContext(64,1000),ann,overview);
  await wachtOpKnipselPreviews([ann],64);
  assert.equal(calls.length,beforeOffscreen,'offscreen snippets request nothing');
});

test('detail failure keeps the overview and can retry; clearing drops pending tiles', async () => {
  const ann = await annotation(); Object.assign(ann,{x:0,y:0,width:1000,height:1000});
  await wachtOpKnipselPreviews([ann],64);
  const overview=bitmapVoor(ann,64), ctx=detailContext();
  fail=true;
  tekenSchermPreview(ctx,ann,overview);
  await wachtOpKnipselPreviews([ann],64);
  assert.ok(ctx.draws.every(d=>d[0]===overview));
  fail=false;
  tekenSchermPreview(ctx,ann,overview);
  leegmaken();
  // Wait for renders that were deliberately removed from the cache generation.
  await new Promise(r=>setTimeout(r,50));
  assert.ok(closed>=5,'overview and all late detail bitmaps are closed');
  assert.equal(bitmapVoor(ann,64),null,'late results did not repopulate cache');
  await wachtOpKnipselPreviews([ann],64);
});
