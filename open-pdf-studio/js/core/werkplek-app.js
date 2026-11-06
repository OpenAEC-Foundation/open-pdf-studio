// De app als gereedschap voor de assistent van de OpenAEC SuperCloud (#977).
//
// In de werkplek (de gehoste bouw, core/gehost.js) zet de app
// `window.__OPDS_APP__` neer met `tools()`, `definitions()` en `run(naam,
// argumenten)`. Het zijn DEZELFDE tools als die van de MCP-server van de
// desktop-app: de definities komen uit mcp-stdio/tools.json (de publieke
// lijst van de Rust-server) en `run` voert dezelfde `mcp:*`-handler uit
// (js/mcp-bridge.js, runAppEvent). Alleen het transport verschilt: hier een
// functieaanroep (of een bericht over de brug, core/host-brug.js), op de
// desktop HTTP of stdio.
//
// Afspraken uit het contract (OpenAEC-Blueprint docs/supercloud-koppeling.md):
//  - Namen met het voorvoegsel van de tool: `app_go_to_page` heet hier
//    `pdf_go_to_page`, zodat ze niet botsen met die van andere tools in
//    hetzelfde gesprek. De beschrijvingen noemen elkaar ook met `pdf_`.
//  - Lezen eerst: `pdf_stand` geeft in één klein antwoord wat er open is, de
//    pagina, het gereedschap en de selectie (samengesteld uit dezelfde
//    handlers, geen tweede implementatie).
//  - Wat in de browser niet kan (bestandssysteem, printers, extensies, een
//    native schermopname): de fout `niet_in_browser: <actie>`. Hele tools
//    staan dan niet in de lijst (NIET_IN_BROWSER); bij een paar tools alleen
//    een argument of een waarde (ARGUMENT_GRENZEN), die ook uit het schema
//    gaat. Openen en opslaan doet de gebruiker via het hostcontract, niet de
//    assistent.
//  - Antwoorden klein: meer dan MAX_ANTWOORD_TEKENS tekens JSON gaat
//    afgekapt terug (`truncated: true`), behalve een afbeelding.
//  - Een weigering is een afgewezen belofte (WerkplekAppFout met `code`).
//
// Deze module is vrij van app-imports (unit-tests en de bouw, zie
// scripts/werkplek-mcp-tools.mjs); de koppeling met de app staat in
// core/werkplek-app-omgeving.js.

/** Het voorvoegsel van deze tool in de werkplek. */
export const TOOL_VOORVOEGSEL = 'pdf_';
/** Het voorvoegsel van de MCP-server van de desktop-app. */
export const APP_VOORVOEGSEL = 'app_';
/** Antwoorden groter dan dit (tekens JSON) gaan afgekapt terug. */
export const MAX_ANTWOORD_TEKENS = 30_000;

/** De foutcodes van `run`. */
export const FOUTCODES = Object.freeze({
  nietInBrowser: 'niet_in_browser',
  onbekend: 'onbekend_gereedschap',
  argumenten: 'ongeldige_argumenten',
  geweigerd: 'geweigerd',
});

/**
 * Tools van de desktop die in de browser geen zin hebben, met de reden (voor
 * de melding). Ze staan niet in `tools()` en `definitions()`; `run` weigert
 * ze met `niet_in_browser`.
 */
export const NIET_IN_BROWSER = Object.freeze({
  app_open_pdf: 'files are opened by the user through the site (Docs), not from a path',
  app_save_pdf: 'files are saved by the user through the site (Docs), not to a path',
  app_merge_pdf: 'reads PDF files from the file system',
  app_extract_pages: 'writes a new file to the file system',
  app_import_cad: 'reads a drawing from the file system',
  app_export_cad: 'writes to the file system',
  app_export_ifcx: 'writes to the file system',
  app_print_to_pdf: 'writes to the file system',
  app_print: 'there are no printers in the browser',
  app_list_printers: 'there are no printers in the browser',
  app_list_extensions: 'extensions are not available in the workplace',
  app_install_extension: 'extensions are not available in the workplace',
  app_reload_extension: 'extensions are not available in the workplace',
  app_call_extension_command: 'extensions are not available in the workplace',
  app_agent_task_pending: 'extension tasks are not available in the workplace',
  app_agent_task_result: 'extension tasks are not available in the workplace',
  app_document_workflows: 'runs on folders of the file system',
  app_drawing_sets: 'works on a folder of the file system',
  app_sheet_links: 'works on a package of files on the file system',
  app_workbook_bindings: 'writes to a workbook on the file system',
  app_portfolio: 'reads and writes files on the file system',
  app_approval_routing: 'keeps its records in files on the file system',
});

/**
 * Tools die wel werken, maar zonder een argument (`waarden` ontbreekt: elke
 * waarde) of zonder een paar waarden ervan. Het schema in `definitions()`
 * laat ze weg; `run` weigert ze met `niet_in_browser`.
 */
export const ARGUMENT_GRENZEN = Object.freeze({
  app_capture_region: [{ arg: 'path' }],
  app_screenshot_view: [{ arg: 'scope', waarden: ['window', 'element'] }, { arg: 'selector' }],
  app_recognize_form: [{ arg: 'action', waarden: ['saveCopy'] }, { arg: 'outputPath' }, { arg: 'ocr', waarden: [true] }],
  app_hidden_information: [{ arg: 'action', waarden: ['export'] }, { arg: 'outputPath' }],
  app_print_preflight: [{ arg: 'action', waarden: ['fixTrimBoxes'] }, { arg: 'outputPath' }],
  app_search_documents: [{ arg: 'scope', waarden: ['folder'] }, { arg: 'folder' }],
  app_watermarks: [{ arg: 'type', waarden: ['image'] }, { arg: 'imagePath' }],
  app_close_tab: [{ arg: 'save', waarden: [true] }],
});

/** Tools die een afbeelding teruggeven: zonder grens op de grootte. */
export const AFBEELDING_TOOLS = Object.freeze(['app_screenshot_view', 'app_capture_region']);

/** De eigen tool van de werkplek: de stand in één klein antwoord. */
export const STAND_TOOL = 'pdf_stand';

export const STAND_DEFINITIE = Object.freeze({
  name: STAND_TOOL,
  description: 'Read this first. The state of the app in one small answer: the open documents (index, file name, '
    + 'page count, current page, modified, active), the index of the active tab, the active tool and the ids of the '
    + 'selected markups. Use pdf_list_annotations, pdf_get_page_text and the other pdf_* tools for details.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'App state', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
});

/** Een fout voor de assistent; `code` is een van FOUTCODES. */
export class WerkplekAppFout extends Error {
  constructor(code, melding) {
    super(melding);
    this.name = 'WerkplekAppFout';
    this.code = code;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `app_go_to_page` -> `pdf_go_to_page`. */
export function werkplekNaam(appNaam) {
  return String(appNaam).startsWith(APP_VOORVOEGSEL)
    ? TOOL_VOORVOEGSEL + String(appNaam).slice(APP_VOORVOEGSEL.length)
    : String(appNaam);
}

/** `pdf_go_to_page` -> `app_go_to_page`, of null als het geen naam van deze tool is. */
export function appNaam(naam) {
  if (typeof naam !== 'string' || !naam.startsWith(TOOL_VOORVOEGSEL) || naam.length <= TOOL_VOORVOEGSEL.length) return null;
  return APP_VOORVOEGSEL + naam.slice(TOOL_VOORVOEGSEL.length);
}

/**
 * Het `mcp:*`-event van een tool van de desktop, zoals de Rust-server het
 * stuurt (mcp_server.rs, handle_tools_call): `app_go_to_page` -> `mcp:go-to-page`.
 */
export function appEvent(appToolNaam) {
  return `mcp:${String(appToolNaam).slice(APP_VOORVOEGSEL.length).replace(/_/g, '-')}`;
}

/** Elke `app_xxx` in een tekst als `pdf_xxx` (de beschrijvingen noemen elkaar). */
export function hernoemInTekst(tekst) {
  return typeof tekst === 'string' ? tekst.replace(/\bapp_([a-z0-9_]+)/g, `${TOOL_VOORVOEGSEL}$1`) : tekst;
}

function grensTekst(grens) {
  return grens.waarden ? `${grens.arg} ${grens.waarden.map((w) => JSON.stringify(w)).join(', ')}` : grens.arg;
}

/** Het schema zonder wat in de browser niet kan. */
function beperkSchema(schema, grenzen) {
  const uit = structuredClone(schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} });
  const props = isObject(uit.properties) ? uit.properties : null;
  for (const grens of grenzen) {
    const prop = props?.[grens.arg];
    if (!prop) continue;
    const opsomming = Array.isArray(prop.enum) ? prop.enum.filter((w) => !grens.waarden?.includes(w)) : null;
    if (grens.waarden && opsomming && opsomming.length) {
      prop.enum = opsomming;
      if (grens.waarden.includes(prop.default)) delete prop.default;
    } else {
      delete props[grens.arg];
      if (Array.isArray(uit.required)) uit.required = uit.required.filter((r) => r !== grens.arg);
    }
  }
  return uit;
}

/**
 * De definities voor de werkplek uit de publieke lijst van de desktop
 * (mcp-stdio/tools.json): zonder NIET_IN_BROWSER, met `pdf_`-namen, zonder de
 * argumenten van ARGUMENT_GRENZEN, en met `pdf_stand` vooraan.
 * @param {Array<{ name: string, description?: string, inputSchema?: object, annotations?: object }>} desktopTools
 */
export function werkplekDefinities(desktopTools) {
  const lijst = Array.isArray(desktopTools) ? desktopTools : [];
  const uit = [structuredClone(STAND_DEFINITIE)];
  for (const tool of lijst) {
    const naam = tool?.name;
    if (typeof naam !== 'string' || !naam.startsWith(APP_VOORVOEGSEL)) continue;
    if (Object.hasOwn(NIET_IN_BROWSER, naam)) continue;
    const grenzen = ARGUMENT_GRENZEN[naam] || [];
    let beschrijving = hernoemInTekst(tool.description || '');
    if (grenzen.length) {
      beschrijving += ` In the browser (OpenAEC workplace) not available: ${grenzen.map(grensTekst).join('; ')}.`;
    }
    const definitie = {
      name: werkplekNaam(naam),
      description: beschrijving,
      inputSchema: beperkSchema(tool.inputSchema, grenzen),
    };
    if (isObject(tool.annotations)) definitie.annotations = structuredClone(tool.annotations);
    uit.push(definitie);
  }
  return uit;
}

/** Alleen gewone JSON-waarden terug (ze gaan ook met postMessage het frame uit). */
function alsJson(waarde) {
  return waarde === undefined ? null : JSON.parse(JSON.stringify(waarde));
}

function nietInBrowser(actie, reden) {
  return new WerkplekAppFout(FOUTCODES.nietInBrowser, `niet_in_browser: ${actie}${reden ? ` (${reden})` : ''}`);
}

/** Weigert wat in de browser niet kan, met de actie in de melding. */
export function controleerArgumenten(appToolNaam, argumenten) {
  const naam = werkplekNaam(appToolNaam);
  if (Object.hasOwn(NIET_IN_BROWSER, appToolNaam)) throw nietInBrowser(naam, NIET_IN_BROWSER[appToolNaam]);
  for (const grens of ARGUMENT_GRENZEN[appToolNaam] || []) {
    const waarde = argumenten?.[grens.arg];
    if (waarde === undefined || waarde === null) continue;
    if (!grens.waarden || grens.waarden.includes(waarde)) {
      throw nietInBrowser(`${naam} ${grens.waarden ? `${grens.arg}=${JSON.stringify(waarde)}` : grens.arg}`,
        'no file system, native capture or desktop service in the browser');
    }
  }
}

/** Is dit de fout "deze opdracht bestaat niet in de webversie" (core/platform.js)? */
function isNietInBrowserFout(fout) {
  if (fout && typeof fout === 'object' && fout.code === 'NIET_IN_BROWSER') return true;
  const tekst = typeof fout === 'string' ? fout : fout?.message;
  return typeof tekst === 'string' && /is not available in the browser build/.test(tekst);
}

/**
 * Een te groot antwoord, afgekapt: het begin van de JSON als tekst, met de
 * lengte erbij, zodat de assistent kan filteren of pagineren.
 */
export function kapAntwoordAf(waarde, max = MAX_ANTWOORD_TEKENS) {
  const json = JSON.stringify(waarde ?? null);
  if (json.length <= max) return waarde;
  return {
    ok: isObject(waarde) && 'ok' in waarde ? waarde.ok : true,
    truncated: true,
    length: json.length,
    limit: max,
    hint: 'The answer was too large and is cut off: ask for less (a page, a filter or a limit).',
    partial: json.slice(0, max),
  };
}

/**
 * `window.__OPDS_APP__` voor de werkplek.
 * @param {object} o
 * @param {Array} o.desktopTools   de publieke lijst van de desktop (tools.json)
 * @param {(event: string, params: object) => Promise<any>} o.voerUit  een
 *   `mcp:*`-handler van de app (runAppEvent); geeft { ok, error?, ... }
 * @param {() => string[]} [o.selectie] de ids van de geselecteerde markups
 * @param {number} [o.maxTekens]
 */
export function maakWerkplekApp({ desktopTools, voerUit, selectie = () => [], maxTekens = MAX_ANTWOORD_TEKENS }) {
  if (typeof voerUit !== 'function') throw new TypeError('voerUit is required');
  const definities = werkplekDefinities(desktopTools);
  const namen = definities.map((d) => d.name);
  const bekend = new Set(namen);
  const desktopNamen = new Set((Array.isArray(desktopTools) ? desktopTools : []).map((t) => t?.name));

  async function handler(event, params) {
    let uit;
    try {
      uit = await voerUit(event, params);
    } catch (e) {
      if (isNietInBrowserFout(e)) throw nietInBrowser(event, e?.message);
      throw new WerkplekAppFout(FOUTCODES.geweigerd, String(e?.message || e));
    }
    if (!uit || typeof uit !== 'object') throw new WerkplekAppFout(FOUTCODES.geweigerd, 'the app returned no answer');
    if (uit.ok === false) {
      const melding = typeof uit.error === 'string' && uit.error ? uit.error : 'the app could not do this';
      if (isNietInBrowserFout(melding)) throw nietInBrowser(event, melding);
      throw new WerkplekAppFout(FOUTCODES.geweigerd, melding);
    }
    return uit;
  }

  async function stand() {
    const tabs = await handler('mcp:list-tabs', {});
    const gereedschap = await handler('mcp:get-current-tool', {});
    let geselecteerd = [];
    try { geselecteerd = (selectie() || []).map(String); } catch { geselecteerd = []; }
    return {
      ok: true,
      activeIndex: tabs.activeIndex ?? null,
      tabs: (tabs.tabs || []).map((t) => ({
        index: t.index,
        fileName: t.fileName ?? null,
        pageCount: t.pageCount ?? 0,
        currentPage: t.currentPage ?? null,
        modified: !!t.modified,
        active: !!t.active,
        annotationCount: t.annotationCount ?? 0,
      })),
      tool: gereedschap.tool ?? null,
      selectedAnnotations: geselecteerd,
    };
  }

  async function run(naam, argumenten) {
    if (argumenten !== undefined && argumenten !== null && !isObject(argumenten)) {
      throw new WerkplekAppFout(FOUTCODES.argumenten, 'arguments must be an object');
    }
    const args = argumenten ?? {};
    if (naam === STAND_TOOL) return alsJson(kapAntwoordAf(await stand(), maxTekens));
    const app = appNaam(naam);
    if (!app || !desktopNamen.has(app)) throw new WerkplekAppFout(FOUTCODES.onbekend, `unknown tool: ${naam}`);
    controleerArgumenten(app, args);
    if (!bekend.has(naam)) throw nietInBrowser(naam);
    const uit = alsJson(await handler(appEvent(app), structuredClone(args)));
    return AFBEELDING_TOOLS.includes(app) ? uit : kapAntwoordAf(uit, maxTekens);
  }

  return {
    tools: async () => [...namen],
    definitions: async () => structuredClone(definities),
    run,
  };
}
