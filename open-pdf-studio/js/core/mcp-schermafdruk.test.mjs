// app_screenshot_view (#583): de argumenten en de uitsnede uit de vensteropname.

import assert from 'node:assert/strict';
import test from 'node:test';

import { leesSchermafdrukArgumenten, berekenUitsnede, rechthoek, STANDAARD_BREEDTE } from './mcp-schermafdruk.js';

test('zonder argumenten blijft het de documentweergave met breedte 2000', () => {
  assert.deepEqual(leesSchermafdrukArgumenten({}), { scope: 'document', selector: null, width: STANDAARD_BREEDTE });
  assert.deepEqual(leesSchermafdrukArgumenten(undefined), { scope: 'document', selector: null, width: 2000 });
  assert.deepEqual(leesSchermafdrukArgumenten({ width: 1600 }), { scope: 'document', selector: null, width: 1600 });
  assert.equal(leesSchermafdrukArgumenten({ width: 0 }).width, 2000, 'een ongeldige breedte valt terug');
  assert.equal(leesSchermafdrukArgumenten({ width: 'x' }).width, 2000);
});

test('window en element; een selector zonder scope betekent element', () => {
  assert.deepEqual(leesSchermafdrukArgumenten({ scope: 'window', width: 800 }), { scope: 'window', selector: null, width: 800 });
  assert.deepEqual(leesSchermafdrukArgumenten({ scope: 'element', selector: ' .ribbon-container ' }),
    { scope: 'element', selector: '.ribbon-container', width: 2000 });
  assert.equal(leesSchermafdrukArgumenten({ selector: '#left-panel' }).scope, 'element');
});

test('ongeldige combinaties geven een foutmelding', () => {
  assert.match(leesSchermafdrukArgumenten({ scope: 'page' }).error, /scope must be/);
  assert.match(leesSchermafdrukArgumenten({ scope: 'element' }).error, /needs a CSS selector/);
  assert.match(leesSchermafdrukArgumenten({ scope: 'window', selector: '#x' }).error, /only used with scope "element"/);
  assert.match(leesSchermafdrukArgumenten({ scope: 'element', selector: '   ' }).error, /non-empty/);
  assert.match(leesSchermafdrukArgumenten({ selector: 42 }).error, /non-empty/);
});

test('het hele venster op devicePixelRatio 1,5: volledige opname, verkleind tot de breedte', () => {
  const u = berekenUitsnede({
    bounds: { x: 0, y: 0, width: 1600, height: 900 },
    viewport: { width: 1600, height: 900 },
    beeld: { width: 2400, height: 1350 },
    maxBreedte: 1200,
  });
  assert.deepEqual([u.sx, u.sy, u.sw, u.sh], [0, 0, 2400, 1350]);
  assert.deepEqual([u.outW, u.outH], [1200, 675]);
  assert.deepEqual(u.bounds, { x: 0, y: 0, width: 1600, height: 900 });
  assert.deepEqual(u.schaal, { x: 1.5, y: 1.5 });
});

test('een element wordt in fysieke pixels uitgesneden en naar buiten afgerond', () => {
  const u = berekenUitsnede({
    bounds: { x: 10.4, y: 20.2, width: 100.3, height: 50 },
    viewport: { width: 1000, height: 800 },
    beeld: { width: 1500, height: 1200 },
  });
  // 10.4*1.5 = 15.6 -> 15; (10.4+100.3)*1.5 = 166.05 -> 167
  assert.deepEqual([u.sx, u.sy, u.sw, u.sh], [15, 30, 152, 76]);
  assert.deepEqual([u.outW, u.outH], [152, 76], 'kleiner dan de maximale breedte: niet vergroot');
  assert.deepEqual(u.bounds, { x: 10.4, y: 20.2, width: 100.3, height: 50 });
});

test('een element dat buiten het venster uitsteekt, wordt tot het venster beperkt', () => {
  const u = berekenUitsnede({
    bounds: { x: -20, y: 700, width: 200, height: 300 },
    viewport: { width: 1000, height: 800 },
    beeld: { width: 1000, height: 800 },
  });
  assert.deepEqual(u.bounds, { x: 0, y: 700, width: 180, height: 100 });
  assert.deepEqual([u.sx, u.sy, u.sw, u.sh], [0, 700, 180, 100]);
});

test('een hoog element: de langste kant (hoogte) past binnen de breedte', () => {
  const u = berekenUitsnede({
    bounds: { x: 0, y: 0, width: 300, height: 1000 },
    viewport: { width: 1000, height: 1000 },
    beeld: { width: 2000, height: 2000 },
    maxBreedte: 500,
  });
  assert.deepEqual([u.sw, u.sh], [600, 2000]);
  assert.deepEqual([u.outW, u.outH], [150, 500]);
});

test('een opname met een andere maat dan innerWidth × dpr: de schaal komt uit de opname', () => {
  const u = berekenUitsnede({
    bounds: { x: 100, y: 0, width: 100, height: 100 },
    viewport: { width: 1000, height: 500 },
    beeld: { width: 1250, height: 625 },
  });
  assert.deepEqual([u.sx, u.sw], [125, 125]);
});

test('geen zichtbaar gebied of geen opname geeft een fout in plaats van een leeg beeld', () => {
  const viewport = { width: 1000, height: 800 };
  const beeld = { width: 1000, height: 800 };
  assert.match(berekenUitsnede({ bounds: { x: 1200, y: 0, width: 50, height: 50 }, viewport, beeld }).error, /no visible area/);
  assert.match(berekenUitsnede({ bounds: { x: 10, y: 10, width: 0, height: 50 }, viewport, beeld }).error, /no visible area/);
  assert.match(berekenUitsnede({ bounds: { x: 0, y: 0, width: 10, height: 10 }, viewport, beeld: { width: 0, height: 0 } }).error, /empty/);
  assert.match(berekenUitsnede({ bounds: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 0, height: 0 }, beeld }).error, /no size/);
  assert.match(berekenUitsnede({ bounds: { x: NaN, y: 0, width: 10, height: 10 }, viewport, beeld }).error, /invalid bounds/);
  assert.match(berekenUitsnede().error, /no size/);
});

test('rechthoek zet een DOMRect om naar x, y, breedte en hoogte', () => {
  assert.deepEqual(rechthoek({ left: 1.234, top: 2, width: 3.333, height: 4, x: 99 }), { x: 1.23, y: 2, width: 3.33, height: 4 });
  assert.deepEqual(rechthoek({ x: 5, y: 6, width: 7, height: 8 }), { x: 5, y: 6, width: 7, height: 8 });
  assert.deepEqual(rechthoek(null), { x: 0, y: 0, width: 0, height: 0 });
});

// ─── Aansluiting over de lagen heen ─────────────────────────────────────────
// De Rust-tests draaien lokaal niet; deze broncontroles bewaken dat schema,
// tools.json, manifest, brug en het native commando bij elkaar blijven.

import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sorteer = (v) => Array.isArray(v) ? v.map(sorteer)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorteer(v[k])])) : v;

/** Het object met `"name": "<naam>"` uit handle_tools_list in mcp_server.rs. */
function rustDefinitie(naam) {
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  const idx = rs.indexOf(`"name": "${naam}"`);
  assert.ok(idx > 0, `${naam} staat in mcp_server.rs`);
  const start = rs.lastIndexOf('{\n', idx);
  let diepte = 0;
  let inTekst = false;
  for (let i = start; i < rs.length; i++) {
    const c = rs[i];
    if (inTekst) { if (c === '\\') i++; else if (c === '"') inTekst = false; continue; }
    if (c === '"') inTekst = true;
    else if (c === '{') diepte++;
    else if (c === '}' && --diepte === 0) return JSON.parse(rs.slice(start, i + 1));
  }
  throw new Error(`${naam}: geen einde`);
}

test('app_screenshot_view: scope en selector in het Rust-schema, tools.json en de manifest', () => {
  const def = rustDefinitie('app_screenshot_view');
  assert.deepEqual(def.inputSchema.properties.scope.enum, ['document', 'window', 'element']);
  assert.equal(def.inputSchema.properties.scope.default, 'document');
  assert.equal(def.inputSchema.properties.selector.type, 'string');
  assert.equal(def.inputSchema.properties.width.default, 2000);
  assert.equal(def.inputSchema.additionalProperties, false);
  assert.equal(def.inputSchema.required, undefined, 'bestaande aanroepen zonder argumenten blijven geldig');
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  const opSchijf = tools.find((t) => t.name === 'app_screenshot_view');
  const { annotations, ...zonderAnnotaties } = opSchijf;
  assert.deepEqual(zonderAnnotaties, sorteer(def), 'tools.json loopt gelijk met mcp_server.rs');
  assert.equal(annotations.readOnlyHint, true);
  const manifest = JSON.parse(lees('../../../mcpb/manifest.json'));
  const inManifest = manifest.tools.find((t) => t.name === 'app_screenshot_view');
  assert.ok(def.description.startsWith(inManifest.description.replace(/\.$/, '')), 'manifest bijgewerkt');
});

test('de brug leest de argumenten via deze module en vraagt de vensteropname aan het native commando', () => {
  const brug = lees('../mcp-bridge.js');
  const handler = brug.slice(brug.indexOf('async function handleScreenshotView'), brug.indexOf('// ─── Mouse + keyboard'));
  assert.match(handler, /leesSchermafdrukArgumenten\(params\)/);
  assert.match(handler, /args\.scope === 'document'[\s\S]*compositeCurrentView\(args\.width\)/);
  assert.match(handler, /captureWindowView\(args\)/);
  const opname = brug.slice(brug.indexOf('async function captureWindowView'), brug.indexOf('// ─── Per-event handlers'));
  assert.match(opname, /invoke\('capture_webview_png'\)/);
  assert.match(opname, /berekenUitsnede\(\{ bounds, viewport, beeld: \{ width: beeld\.width, height: beeld\.height \}, maxBreedte: width \}\)/);
  assert.match(brug, /'mcp:screenshot-view':\s+handleScreenshotView,/);
});

test('het native commando staat in de invoke_handler; Windows-afhankelijkheden op de versie uit Cargo.lock', () => {
  const lib = lees('../../src-tauri/src/lib.rs');
  assert.match(lib, /^pub mod webview_opname;$/m);
  assert.match(lib, /webview_opname::capture_webview_png,/);
  const opname = lees('../../src-tauri/src/webview_opname.rs');
  assert.match(opname, /#\[cfg\(not\(target_os = "windows"\)\)\]\nasync fn neem_op[\s\S]*?Err\(NIET_ONDERSTEUND\.to_string\(\)\)/);
  assert.match(opname, /CapturePreview\(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG/);
  const cargo = lees('../../src-tauri/Cargo.toml');
  const windowsBlok = cargo.slice(cargo.indexOf(`[target.'cfg(target_os = "windows")'.dependencies]`));
  assert.match(windowsBlok, /^webview2-com = "0\.38\.2"$/m);
  assert.match(windowsBlok, /^windows = \{ version = "0\.61\.3"/m);
  const lock = lees('../../../Cargo.lock');
  assert.match(lock, /name = "webview2-com"\nversion = "0\.38\.2"/);
  assert.match(lock, /name = "windows"\nversion = "0\.61\.3"/);
});

test('lagen van een pagina: markeerlaag (vermenigvuldigen), annotaties, scherpe annotatietegels', async () => {
  const { laagVolgorde } = await import('./mcp-schermafdruk.js');
  const lagen = [
    { klasse: 'annotation-canvas' }, { klasse: 'iets-anders' },
    { id: 'text-highlight-canvas' }, { klasse: 'annotation-canvas-sharp' },
  ];
  assert.deepEqual(laagVolgorde(lagen), [
    { index: 2, mengen: 'multiply' }, { index: 0, mengen: 'source-over' },
    { index: 3, mengen: 'source-over' }, { index: 1, mengen: 'source-over' },
  ]);
  assert.deepEqual(laagVolgorde([]), []);
  assert.deepEqual(laagVolgorde(null), []);
});

test('een laag komt op haar eigen plek ten opzichte van het paginabeeld', async () => {
  const { laagPlek } = await import('./mcp-schermafdruk.js');
  const basis = { left: 10, top: 20, width: 200, height: 400 };
  const uit = { width: 100, height: 200 };
  assert.deepEqual(laagPlek(basis, basis, uit), { x: 0, y: 0, w: 100, h: 200 });
  assert.deepEqual(laagPlek({ left: 110, top: 220, width: 50, height: 40 }, basis, uit), { x: 50, y: 100, w: 25, h: 20 });
  assert.deepEqual(laagPlek(basis, { left: 0, top: 0, width: 0, height: 0 }, uit), { x: 0, y: 0, w: 100, h: 200 });
});

test('de opname kiest in de doorlopende weergave de canvassen van de huidige pagina', () => {
  const brug = lees('../mcp-bridge.js');
  const fn = brug.slice(brug.indexOf('async function compositeCurrentView'), brug.indexOf('async function captureWindowView'));
  assert.ok(fn.includes("doc?.viewMode === 'continuous'"));
  assert.ok(fn.includes('#continuous-container .page-wrapper[data-page="${pagina}"]'));
  assert.ok(fn.includes("document.getElementById('pdf-canvas')"));
  assert.ok(fn.includes('laagVolgorde(') && fn.includes('laagPlek('));
});
