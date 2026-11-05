// De tools voor de assistent van de werkplek (#977): dezelfde als die van de
// MCP-server van de desktop (mcp-stdio/tools.json en de `mcp:*`-handlers van
// js/mcp-bridge.js), met het voorvoegsel pdf_, zonder wat in de browser niet
// kan, en het luie `window.__OPDS_APP__`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  appEvent, appNaam, werkplekNaam, hernoemInTekst, werkplekDefinities, maakWerkplekApp, kapAntwoordAf,
  controleerArgumenten, NIET_IN_BROWSER, ARGUMENT_GRENZEN, AFBEELDING_TOOLS, STAND_TOOL, MAX_ANTWOORD_TEKENS,
  WerkplekAppFout, FOUTCODES,
} from './werkplek-app.js';
import { maakLuiApp, installeerWerkplekApp } from './werkplek-app-start.js';
import { mcpToolsJson, MCP_TOOLS_BESTAND } from '../../scripts/werkplek-mcp-tools.mjs';

const lees = (pad) => fs.readFileSync(new URL(pad, import.meta.url), 'utf8');
const DESKTOP = JSON.parse(lees('../../../mcp-stdio/tools.json'));
const BRUG = lees('../mcp-bridge.js');
const RUST = lees('../../src-tauri/src/mcp_server.rs');

/** De handlers van mcp-bridge.js (de sleutels van HANDLERS). */
const HANDLER_NAMEN = new Set(
  [...BRUG.slice(BRUG.indexOf('const HANDLERS = {')).matchAll(/^\s*'(mcp:[a-z0-9-]+)':/gm)].map((m) => m[1]),
);
/** De armen van handle_tools_call in Rust: tool -> event. */
const RUST_EVENTS = new Map(
  [...RUST.matchAll(/"(app_[a-z0-9_]+)"\s*=>\s*tool_app_request\(state,\s*"(mcp:[a-z0-9-]+)"/g)].map((m) => [m[1], m[2]]),
);

function nepApp({ antwoorden = {}, selectie = () => ['a1'] } = {}) {
  const aanroepen = [];
  const voerUit = async (event, params) => {
    aanroepen.push({ event, params });
    const a = antwoorden[event];
    if (typeof a === 'function') return a(params);
    return a ?? { ok: true, event };
  };
  return { app: maakWerkplekApp({ desktopTools: DESKTOP, voerUit, selectie }), aanroepen };
}

const weigert = async (belofte, code, patroon) => {
  await assert.rejects(belofte, (e) => {
    assert.ok(e instanceof WerkplekAppFout, `WerkplekAppFout, niet ${e}`);
    assert.equal(e.code, code);
    if (patroon) assert.match(e.message, patroon);
    return true;
  });
};

test('namen: app_ <-> pdf_ en het mcp:-event zoals de Rust-server het stuurt', () => {
  assert.equal(werkplekNaam('app_go_to_page'), 'pdf_go_to_page');
  assert.equal(appNaam('pdf_go_to_page'), 'app_go_to_page');
  assert.equal(appNaam('app_go_to_page'), null);
  assert.equal(appNaam('pdf_'), null);
  assert.equal(appNaam(42), null);
  assert.equal(appEvent('app_go_to_page'), 'mcp:go-to-page');
  assert.equal(hernoemInTekst('returned by app_get_page_text, see app_list_tabs.'), 'returned by pdf_get_page_text, see pdf_list_tabs.');
});

test('elke tool van de desktop heeft een handler in mcp-bridge.js en hetzelfde event als in Rust', () => {
  assert.ok(DESKTOP.length > 50, 'tools.json gelezen');
  assert.ok(HANDLER_NAMEN.size > 50, 'HANDLERS gelezen');
  for (const { name } of DESKTOP) {
    if (Object.hasOwn(NIET_IN_BROWSER, name)) continue;
    const event = appEvent(name);
    assert.ok(HANDLER_NAMEN.has(event), `${name}: geen handler ${event} in mcp-bridge.js`);
    assert.equal(RUST_EVENTS.get(name), event, `${name}: de Rust-server stuurt een ander event`);
  }
});

test('de uitzonderingen bestaan echt (geen verouderde namen of argumenten)', () => {
  const perNaam = new Map(DESKTOP.map((t) => [t.name, t]));
  for (const naam of Object.keys(NIET_IN_BROWSER)) assert.ok(perNaam.has(naam), `${naam} staat niet in tools.json`);
  for (const [naam, grenzen] of Object.entries(ARGUMENT_GRENZEN)) {
    const props = perNaam.get(naam)?.inputSchema?.properties;
    assert.ok(props, `${naam} staat niet in tools.json`);
    for (const g of grenzen) assert.ok(Object.hasOwn(props, g.arg), `${naam} kent ${g.arg} niet`);
  }
  for (const naam of AFBEELDING_TOOLS) assert.ok(perNaam.has(naam), naam);
});

test('de definities: pdf_stand vooraan, pdf_-namen, zonder wat in de browser niet kan', () => {
  const defs = werkplekDefinities(DESKTOP);
  assert.equal(defs[0].name, STAND_TOOL);
  assert.equal(defs.length, 1 + DESKTOP.length - Object.keys(NIET_IN_BROWSER).length);
  const namen = defs.map((d) => d.name);
  assert.equal(new Set(namen).size, namen.length, 'geen dubbele namen');
  for (const d of defs) {
    assert.match(d.name, /^pdf_[a-z0-9_]+$/);
    assert.equal(typeof d.description, 'string');
    assert.doesNotMatch(d.description, /\bapp_[a-z]/, `${d.name} noemt nog een app_-naam`);
    assert.equal(d.inputSchema?.type, 'object', `${d.name}: schema`);
  }
  for (const naam of Object.keys(NIET_IN_BROWSER)) assert.ok(!namen.includes(werkplekNaam(naam)), naam);
  for (const kern of ['pdf_go_to_page', 'pdf_list_annotations', 'pdf_create_annotation', 'pdf_get_page_text', 'pdf_search_documents']) {
    assert.ok(namen.includes(kern), kern);
  }

  const perNaam = new Map(defs.map((d) => [d.name, d]));
  assert.ok(!('path' in perNaam.get('pdf_capture_region').inputSchema.properties));
  assert.deepEqual(perNaam.get('pdf_screenshot_view').inputSchema.properties.scope.enum, ['document']);
  assert.ok(!('selector' in perNaam.get('pdf_screenshot_view').inputSchema.properties));
  assert.deepEqual(perNaam.get('pdf_search_documents').inputSchema.properties.scope.enum, ['active', 'open']);
  assert.ok(!('folder' in perNaam.get('pdf_search_documents').inputSchema.properties));
  assert.deepEqual(perNaam.get('pdf_hidden_information').inputSchema.properties.action.enum, ['inspect']);
  assert.ok(!('save' in perNaam.get('pdf_close_tab').inputSchema.properties));
  assert.match(perNaam.get('pdf_capture_region').description, /not available: path\./);
  // De lijst van de desktop zelf blijft ongewijzigd.
  assert.ok('path' in DESKTOP.find((t) => t.name === 'app_capture_region').inputSchema.properties);
});

test('mcp-tools.json naast de bundel is precies wat definitions() geeft', async () => {
  assert.equal(MCP_TOOLS_BESTAND, 'mcp-tools.json');
  const { app } = nepApp();
  assert.deepEqual(JSON.parse(mcpToolsJson(DESKTOP)), await app.definitions());
  assert.deepEqual(await app.tools(), (await app.definitions()).map((d) => d.name));
});

test('run: dezelfde handler als de desktop, met de argumenten als kopie', async () => {
  const { app, aanroepen } = nepApp({ antwoorden: { 'mcp:go-to-page': (p) => ({ ok: true, page: p.page }) } });
  const args = { page: 3 };
  assert.deepEqual(await app.run('pdf_go_to_page', args), { ok: true, page: 3 });
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].event, 'mcp:go-to-page');
  assert.deepEqual(aanroepen[0].params, { page: 3 });
  assert.notEqual(aanroepen[0].params, args);
  // Zonder argumenten: een leeg object.
  await app.run('pdf_zoom_in');
  assert.deepEqual(aanroepen[1], { event: 'mcp:zoom-in', params: {} });
});

test('run: een weigering van de app is een afgewezen belofte', async () => {
  const { app } = nepApp({ antwoorden: { 'mcp:delete-annotation': { ok: false, error: 'annotation not found' } } });
  await weigert(app.run('pdf_delete_annotation', { id: 'x' }), FOUTCODES.geweigerd, /annotation not found/);
  const { app: gooit } = nepApp({ antwoorden: { 'mcp:undo': () => { throw new Error('kapot'); } } });
  await weigert(gooit.run('pdf_undo'), FOUTCODES.geweigerd, /kapot/);
});

test('run: wat in de browser niet kan, geeft niet_in_browser: <actie>', async () => {
  const { app, aanroepen } = nepApp();
  await weigert(app.run('pdf_open_pdf', { path: 'C:/x.pdf' }), FOUTCODES.nietInBrowser, /^niet_in_browser: pdf_open_pdf/);
  await weigert(app.run('pdf_save_pdf'), FOUTCODES.nietInBrowser, /^niet_in_browser: pdf_save_pdf/);
  await weigert(app.run('pdf_print'), FOUTCODES.nietInBrowser, /^niet_in_browser: pdf_print/);
  await weigert(app.run('pdf_capture_region', { path: 'C:/x.png' }), FOUTCODES.nietInBrowser, /^niet_in_browser: pdf_capture_region path/);
  await weigert(app.run('pdf_search_documents', { query: 'a', scope: 'folder' }), FOUTCODES.nietInBrowser, /scope="folder"/);
  await weigert(app.run('pdf_screenshot_view', { scope: 'window' }), FOUTCODES.nietInBrowser, /scope="window"/);
  await weigert(app.run('pdf_close_tab', { index: 0, save: true }), FOUTCODES.nietInBrowser, /save=true/);
  assert.equal(aanroepen.length, 0, 'niets bereikte de app');
  // Wat wel mag, gaat gewoon door.
  await app.run('pdf_search_documents', { query: 'a', scope: 'open' });
  await app.run('pdf_close_tab', { index: 0, save: false, force: true });
  await app.run('pdf_capture_region', { page: 1 });
  assert.deepEqual(aanroepen.map((a) => a.event), ['mcp:search-documents', 'mcp:close-tab', 'mcp:capture-region']);
  assert.throws(() => controleerArgumenten('app_watermarks', { action: 'add', type: 'image' }), /niet_in_browser: pdf_watermarks type="image"/);
  assert.doesNotThrow(() => controleerArgumenten('app_watermarks', { action: 'add', type: 'text' }));
});

test('run: een handler die een desktopopdracht nodig heeft, geeft ook niet_in_browser', async () => {
  const nietInBrowser = Object.assign(new Error('"ocr_page" is not available in the browser build'), { code: 'NIET_IN_BROWSER' });
  const { app } = nepApp({
    antwoorden: {
      'mcp:review-ocr': () => { throw nietInBrowser; },
      'mcp:get-page-text': { ok: false, error: '"pdfium_text" is not available in the browser build' },
    },
  });
  await weigert(app.run('pdf_review_ocr', { action: 'list', documentId: 'd' }), FOUTCODES.nietInBrowser, /^niet_in_browser: mcp:review-ocr/);
  await weigert(app.run('pdf_get_page_text', { page: 1 }), FOUTCODES.nietInBrowser, /^niet_in_browser/);
});

test('run: onbekende namen en ongeldige argumenten', async () => {
  const { app } = nepApp();
  await weigert(app.run('pdf_bestaat_niet'), FOUTCODES.onbekend);
  await weigert(app.run('app_go_to_page', { page: 1 }), FOUTCODES.onbekend);
  await weigert(app.run('calc_stand'), FOUTCODES.onbekend);
  await weigert(app.run('pdf_go_to_page', [1]), FOUTCODES.argumenten);
  await weigert(app.run('pdf_go_to_page', 'pagina 1'), FOUTCODES.argumenten);
});

test('run: een groot antwoord gaat afgekapt terug, een afbeelding niet', async () => {
  const groot = 'x'.repeat(MAX_ANTWOORD_TEKENS + 10);
  const { app } = nepApp({
    antwoorden: {
      'mcp:list-annotations': { ok: true, annotations: [groot] },
      'mcp:screenshot-view': { ok: true, png_base64: groot },
    },
  });
  const lijst = await app.run('pdf_list_annotations');
  assert.equal(lijst.truncated, true);
  assert.equal(lijst.ok, true);
  assert.equal(lijst.limit, MAX_ANTWOORD_TEKENS);
  assert.equal(lijst.partial.length, MAX_ANTWOORD_TEKENS);
  assert.ok(lijst.length > MAX_ANTWOORD_TEKENS);
  assert.ok(JSON.stringify(lijst).length < MAX_ANTWOORD_TEKENS + 1000);
  const beeld = await app.run('pdf_screenshot_view');
  assert.equal(beeld.png_base64, groot);
  // Klein blijft zoals het is.
  assert.deepEqual(kapAntwoordAf({ ok: true, a: 1 }), { ok: true, a: 1 });
});

test('pdf_stand: klein, uit dezelfde handlers', async () => {
  const { app, aanroepen } = nepApp({
    antwoorden: {
      'mcp:list-tabs': {
        ok: true,
        activeIndex: 0,
        tabs: [{ index: 0, fileName: 'plan.pdf', filePath: 'opds-host://DOC-1/plan.pdf', modified: true, active: true, pageCount: 4, currentPage: 2, annotationCount: 7 }],
      },
      'mcp:get-current-tool': { ok: true, tool: 'select' },
    },
    selectie: () => ['ann-1', 2],
  });
  assert.deepEqual(await app.run('pdf_stand'), {
    ok: true,
    activeIndex: 0,
    tabs: [{ index: 0, fileName: 'plan.pdf', pageCount: 4, currentPage: 2, modified: true, active: true, annotationCount: 7 }],
    tool: 'select',
    selectedAnnotations: ['ann-1', '2'],
  });
  assert.deepEqual(aanroepen.map((a) => a.event), ['mcp:list-tabs', 'mcp:get-current-tool']);
});

test('__OPDS_APP__ is lui: de MCP-laag laadt pas bij de eerste aanroep, en opnieuw na een mislukking', async () => {
  let geladen = 0;
  let mislukt = true;
  const app = maakLuiApp(async () => {
    geladen++;
    if (mislukt) { mislukt = false; throw new Error('chunk niet geladen'); }
    return { tools: async () => ['pdf_stand'], definitions: async () => [], run: async (n, a) => ({ n, a }) };
  });
  assert.equal(geladen, 0);
  await assert.rejects(app.tools(), /chunk niet geladen/);
  assert.deepEqual(await app.tools(), ['pdf_stand']);
  assert.deepEqual(await app.run('pdf_x', { a: 1 }), { n: 'pdf_x', a: { a: 1 } });
  assert.equal(geladen, 2);
});

test('installeerWerkplekApp: één keer, niet te overschrijven, met een event', () => {
  const events = [];
  const venster = { dispatchEvent: (e) => events.push(e.type) };
  const laad = async () => ({ tools: async () => [], definitions: async () => [], run: async () => null });
  const app = installeerWerkplekApp(venster, laad);
  assert.equal(venster.__OPDS_APP__, app);
  assert.deepEqual(events, ['opds-app-klaar']);
  assert.equal(installeerWerkplekApp(venster, laad), app);
  assert.throws(() => { 'use strict'; venster.__OPDS_APP__ = {}; });
  assert.equal(typeof app.tools, 'function');
  assert.equal(typeof app.definitions, 'function');
  assert.equal(typeof app.run, 'function');
  assert.equal(installeerWerkplekApp(null, laad), null);
});
