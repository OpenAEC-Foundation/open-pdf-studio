// De MCP-opdrachten `app_print_to_pdf`, `app_print` en `app_list_printers`:
// afdrukken zonder het printvenster. Dit bestand bevat alleen de pure regels:
// de argumenten controleren, ze afbeelden op de keuzes van het printvenster en
// het antwoord samenstellen. De brug (mcp-bridge.js) doet het werk met
// dezelfde functies als de dialoog (print-job.js, print-papier.js,
// print-plaatsing.js) — venster en opdracht lopen dezelfde weg.
//
// Uitgangspunten, gelijk aan app_import_cad en app_export_cad:
// - Een onbekend of verkeerd getypt argument wordt geweigerd met een nette
//   fout; er wordt niets stilzwijgend genegeerd.
// - De onthouden instellingen van het printvenster zijn de basis (schaal,
//   zoom, centreren, inhoud, aantal, automatisch draaien); de opdracht wint
//   per veld. De opdracht onthoudt zelf niets.
// - Eén uitzondering op "de basis is wat het venster onthield": het
//   paginabereik. Een onthouden bereik hoort bij het document waarvoor het
//   gekozen is; de opdracht begint daarom altijd bij "all", de standaard van
//   het venster zelf. De deelverzameling (even/oneven) en de omgekeerde
//   volgorde van het venster doen bij een opdracht niet mee: de paginalijst is
//   precies wat `pages` zegt.

import { PAPIERFORMATEN } from './print-pagina-instelling.js';
import { SCHALINGEN, ZOOM_MAX, ZOOM_MIN, geldigeZoom } from './print-plaatsing.js';
import { herstelPrintInstellingen } from '../solid/stores/print-instellingen.js';
import { MAX_PADLENGTE, padFout } from './cad-mcp-opdracht.js';

/**
 * Hoe lang de opdracht zelf op de afdruk wacht. De brug wacht hooguit 300 s op
 * het antwoord van de webview (mcp_server.rs: `"app_print_to_pdf" =>
 * tool_app_request(…, Duration::from_secs(300))`); daarna haalt
 * mcp_app_bridge.rs de wachtende aanroep weg en krijgt de MCP-client "timed
 * out". Deze grens ligt daar net onder: verstrijkt hij, dan schrijft de brug
 * het bestand niet meer weg en stuurt ze niets naar een printer — anders zou
 * minuten na "timed out" alsnog een bestand of een afdruk verschijnen.
 */
export const TIJDGRENS_MS = 290_000;

/** Het antwoord als de tijdgrens verstreken is. */
export function tijdgrensFout(gevolg, extra = {}) {
  return fout(`timed out after ${TIJDGRENS_MS / 1000} s; ${gevolg}`, extra);
}

/** Het vel op paginamaat: elke pagina krijgt een vel van haar eigen formaat. */
export const PAPIER_PAGINA = 'page';
/** Het vel van de printer zelf: het papier dat in de printer ligt. */
export const PAPIER_PRINTER = 'printer';

/**
 * De papierkeuzes van de opdracht, in de schrijfwijze van de gereedschapslijst:
 * de formaten van de Pagina-instelling (PAPIERFORMATEN) plus "page" en
 * "printer".
 */
export const PAPIERKEUZES = Object.freeze([
  PAPIER_PAGINA, PAPIER_PRINTER, ...Object.values(PAPIERFORMATEN).map((f) => f.label),
]);

/** De standen van het vel; "auto" volgt de pagina, zoals Automatisch draaien. */
export const ORIENTATIES = Object.freeze(['auto', 'portrait', 'landscape']);

/** Wat er wordt afgedrukt; afgebeeld op de keuzelijst "Afdrukken" van het venster. */
export const INHOUDEN = Object.freeze({
  document: 'doc-only',
  'document-and-markups': 'doc-and-markups',
});

/** Hoogste aantal exemplaren, gelijk aan de grens van het printvenster. */
export const MAX_KOPIEEN = 999;

/** Argumenten van `app_print_to_pdf`. */
export const ARGUMENTEN_BESTAND = Object.freeze([
  'path', 'pages', 'paper', 'orientation', 'scaling', 'zoom', 'center', 'content', 'autoRotate',
]);

/** Argumenten van `app_print`: dezelfde, met de printer en het aantal erbij. */
export const ARGUMENTEN_PRINTER = Object.freeze([
  'printer', 'copies', ...ARGUMENTEN_BESTAND.filter((n) => n !== 'path'),
]);

const fout = (error, extra = {}) => ({ ok: false, error, ...extra });

/** De sleutel in PAPIERFORMATEN bij een label uit PAPIERKEUZES ("A3L" → "a3l"). */
export function papierSleutel(keuze) {
  if (typeof keuze !== 'string') return null;
  const kaal = keuze.trim();
  if (kaal === PAPIER_PAGINA || kaal === PAPIER_PRINTER) return kaal;
  const gevonden = Object.entries(PAPIERFORMATEN)
    .find(([sleutel, f]) => sleutel === kaal.toLowerCase() || f.label.toLowerCase() === kaal.toLowerCase());
  return gevonden ? gevonden[0] : null;
}

/** Waarom dit doelpad niet gebruikt wordt, of `''` als het in orde is. */
export function pdfPadFout(pad) {
  const mis = padFout(pad);
  if (!mis) return 'params.path must end in .pdf';
  if (mis === 'not a CAD drawing (expected .dwg or .dxf)') {
    return /\.pdf$/i.test(String(pad).trim()) ? '' : 'params.path must end in .pdf';
  }
  return mis;
}

/**
 * Controleert de argumenten van de opdracht en beeldt ze af op de keuzes van
 * het printvenster.
 *
 * @param {unknown} params  argumenten van `app_print_to_pdf` of `app_print`
 * @param {{ onthouden?: unknown,
 *           venster?: { orientatie?: string, papier?: string, stand?: string|null },
 *           naarBestand?: boolean }} omgeving
 *   onthouden = `state.preferences.printSettings`;
 *   venster   = `printArgumenten({ autoRotate, paginaInstelling, docId })` van
 *               het huidige document, met `stand` = de stand uit de
 *               Pagina-instelling van dít document (of null);
 *   naarBestand = true voor `app_print_to_pdf`, false voor `app_print`.
 * @returns {{ok:false, error:string} | {ok:true, naarBestand:boolean,
 *   pad:string|null, printer:string|null, paginas:string, papier:string,
 *   orientatie:'auto'|'portrait'|'landscape', autoRotate:boolean,
 *   schaling:string, zoom:number, centreren:boolean, inhoud:string, kopieen:number}}
 */
export function leesPrintOpdracht(params, { onthouden, venster, naarBestand = true } = {}) {
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    return fout('params must be an object');
  }
  const p = params || {};
  const toegestaan = naarBestand ? ARGUMENTEN_BESTAND : ARGUMENTEN_PRINTER;
  for (const naam of Object.keys(p)) {
    if (!toegestaan.includes(naam)) return fout(`unknown argument: ${naam}`);
  }
  const bewaard = herstelPrintInstellingen(onthouden);
  const v = venster && typeof venster === 'object' ? venster : {};

  let pad = null;
  if (naarBestand) {
    const padMis = pdfPadFout(p.path);
    if (padMis) return fout(padMis, typeof p.path === 'string' ? { file_path: p.path.slice(0, MAX_PADLENGTE) } : {});
    pad = p.path.trim();
  }

  let printer = null;
  if (!naarBestand) {
    if (typeof p.printer !== 'string' || !p.printer.trim()) return fout('missing or invalid params.printer');
    printer = p.printer.trim();
  }

  let paginas = 'all';
  if (p.pages !== undefined) {
    if (typeof p.pages !== 'string' || !p.pages.trim()) {
      return fout('params.pages must be "all", "current" or a range like "1-3,5"');
    }
    paginas = p.pages.trim();
  }

  const papierFout = leesPapier(p.paper, naarBestand);
  if (papierFout.error) return papierFout;
  const papier = papierFout.papier ?? standaardPapier(v.papier, naarBestand);

  const stand = leesStand(p, v, bewaard);
  if (stand.error) return stand;

  if (p.scaling !== undefined && !SCHALINGEN.includes(p.scaling)) {
    return fout(`params.scaling must be one of: ${SCHALINGEN.join(', ')}`);
  }
  if (p.zoom !== undefined && (typeof p.zoom !== 'number' || !Number.isFinite(p.zoom))) {
    return fout('params.zoom must be a number');
  }
  if (p.zoom !== undefined && (p.zoom < ZOOM_MIN || p.zoom > ZOOM_MAX)) {
    return fout(`params.zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX} percent`);
  }
  // Een zoom noemen betekent "aangepaste schaal", zoals params.scale bij app_export_cad.
  const schaling = p.scaling ?? (p.zoom !== undefined ? 'custom-scale' : bewaard.scaling);
  if (schaling === 'custom-scale' && p.zoom === undefined && p.scaling !== undefined) {
    return fout('params.scaling "custom-scale" needs params.zoom');
  }
  const zoom = geldigeZoom(p.zoom ?? bewaard.zoom);

  if (p.center !== undefined && typeof p.center !== 'boolean') return fout('params.center must be true or false');
  const centreren = p.center ?? bewaard.autoCenter;

  if (p.content !== undefined && !Object.hasOwn(INHOUDEN, p.content)) {
    return fout(`params.content must be one of: ${Object.keys(INHOUDEN).join(', ')}`);
  }
  const inhoud = p.content === undefined ? bewaard.content : INHOUDEN[p.content];

  let kopieen = 1;
  if (!naarBestand) {
    kopieen = bewaard.copies;
    if (p.copies !== undefined) {
      if (typeof p.copies !== 'number' || !Number.isInteger(p.copies) || p.copies < 1 || p.copies > MAX_KOPIEEN) {
        return fout(`params.copies must be a whole number from 1 to ${MAX_KOPIEEN}`);
      }
      kopieen = p.copies;
    }
  }

  return {
    ok: true,
    naarBestand,
    pad,
    printer,
    paginas,
    papier,
    orientatie: stand.orientatie,
    autoRotate: stand.orientatie === 'auto',
    schaling,
    zoom,
    centreren,
    inhoud,
    kopieen,
  };
}

/** Het papierargument controleren; `papier` is null als het niet gegeven is. */
function leesPapier(keuze, naarBestand) {
  if (keuze === undefined) return { papier: null };
  const sleutel = papierSleutel(keuze);
  if (!sleutel) return fout(`params.paper must be one of: ${PAPIERKEUZES.join(', ')}`);
  if (sleutel === PAPIER_PAGINA && !naarBestand) {
    return fout('params.paper "page" only applies to app_print_to_pdf; a printer prints on its own paper');
  }
  if (sleutel === PAPIER_PRINTER && naarBestand) {
    return fout('params.paper "printer" needs a printer; use a paper size or "page"');
  }
  return { papier: sleutel };
}

/**
 * Het papier als de opdracht er niets over zegt: het papier dat de volgende
 * afdruk toch al zou krijgen (de Pagina-instelling van dit document, anders het
 * papier van de printer). Zonder printer bestaat dat papier niet en krijgt elke
 * pagina een vel van haar eigen maat, net als het doel "Opslaan als PDF" in het
 * printvenster.
 */
export function standaardPapier(vensterPapier, naarBestand) {
  if (typeof vensterPapier === 'string' && Object.hasOwn(PAPIERFORMATEN, vensterPapier)) return vensterPapier;
  return naarBestand ? PAPIER_PAGINA : PAPIER_PRINTER;
}

/** De stand van het vel uit `orientation` en `autoRotate`, of de fout daarover. */
function leesStand(p, venster, bewaard) {
  if (p.orientation !== undefined && !ORIENTATIES.includes(p.orientation)) {
    return fout(`params.orientation must be one of: ${ORIENTATIES.join(', ')}`);
  }
  if (p.autoRotate !== undefined && typeof p.autoRotate !== 'boolean') {
    return fout('params.autoRotate must be true or false');
  }
  if (p.autoRotate === true && p.orientation !== undefined && p.orientation !== 'auto') {
    return fout('params.autoRotate true means orientation "auto"; leave params.orientation out');
  }
  if (p.autoRotate === false && p.orientation === 'auto') {
    return fout('params.autoRotate false and params.orientation "auto" exclude each other');
  }
  if (p.orientation !== undefined) return { orientatie: p.orientation };
  if (p.autoRotate === true) return { orientatie: 'auto' };
  if (p.autoRotate === false) {
    const stand = venster.stand === 'portrait' || venster.stand === 'landscape' ? venster.stand : null;
    return { orientatie: stand || 'portrait' };
  }
  const uitVenster = ORIENTATIES.includes(venster.orientatie) ? venster.orientatie : null;
  return { orientatie: uitVenster || (bewaard.autoRotate ? 'auto' : 'portrait') };
}

/**
 * De paginalijst van de opdracht, met dezelfde keuzes als het printvenster:
 * "all" = elke pagina, "current" = de getoonde pagina, anders het bereik.
 * `bereik` is `parsePageRange` uit exporter.js; die module heeft de DOM nodig,
 * dus de aanroeper geeft hem mee.
 * @returns {{ok:true, pages:number[]} | {ok:false, error:string}}
 */
export function kiesPaginas(opdracht, { totaal, huidig = 1, bereik }) {
  if (!Number.isInteger(totaal) || totaal < 1) return fout('the document has no pages');
  if (opdracht.paginas === 'all') {
    return { ok: true, pages: Array.from({ length: totaal }, (_, i) => i + 1) };
  }
  if (opdracht.paginas === 'current') {
    const nr = Math.min(totaal, Math.max(1, Number(huidig) || 1));
    return { ok: true, pages: [nr] };
  }
  const pages = bereik(opdracht.paginas, totaal);
  if (!pages.length) return fout(`params.pages "${opdracht.paginas}" selects no page of ${totaal}`);
  return { ok: true, pages };
}

/**
 * De keuzes waarmee het vel en de plek van elke pagina worden uitgerekend
 * (print-plaatsing.js). Precies wat `plaatsingKeuzes` in de printdialoog
 * samenstelt: het vel als het bekend is (met het bedrukbare gebied van de
 * printer), anders elke pagina op haar eigen vel bij een afdruk naar een
 * bestand, en anders niets — dan past de printer de pagina zelf in.
 *
 * @param {object} opdracht  uitkomst van `leesPrintOpdracht`
 * @param {{ vel: {breedteMm:number, hoogteMm:number}|null, marges?: object|null }} o
 *   vel = `bekendVel(effectiefPapier(...))` (print-papier.js)
 */
export function plaatsingKeuzes(opdracht, { vel, marges = null }) {
  return {
    papier: vel ? { ...vel, bedrukbaar: marges } : (opdracht.naarBestand ? 'pagina' : null),
    orientatie: opdracht.orientatie,
    schaling: opdracht.schaling,
    zoom: opdracht.zoom,
    centreren: opdracht.centreren,
  };
}

/**
 * De Pagina-instelling die deze opdracht voorstelt. Daarmee komen
 * `printArgumenten` en `effectiefPapier` (de functies van de printdialoog) op
 * precies het papier en de stand uit die de opdracht vraagt, zonder de
 * Pagina-instelling van de gebruiker aan te raken.
 * `paper: "page"` heeft geen formaat voor de driver: dat wordt 'printer', en
 * zonder bekend vel legt `plaatsingKeuzes` elke pagina op haar eigen vel.
 */
export function opdrachtPaginaInstelling(opdracht, docId) {
  return {
    docId,
    size: opdracht.papier === PAPIER_PAGINA ? PAPIER_PRINTER : opdracht.papier,
    orientation: opdracht.orientatie === 'auto' ? 'portrait' : opdracht.orientatie,
    handmatig: true,
  };
}

/**
 * Argumenten voor `slaPrintOpAlsPdf` (naar een bestand) of `runPrintJob` (naar
 * een printer), precies zoals de printdialoog ze samenstelt.
 * @param {object} opdracht   uitkomst van `leesPrintOpdracht`
 * @param {{pages:number[], keuzes:object}} o  keuzes = `plaatsingKeuzes`
 */
export function printOpdrachtArgumenten(opdracht, { pages, keuzes }) {
  const gemeen = {
    pages,
    orientatie: keuzes.orientatie,
    vel: keuzes.papier,
    schaling: keuzes.schaling,
    zoom: keuzes.zoom,
    centreren: keuzes.centreren,
    inhoud: opdracht.inhoud,
  };
  if (opdracht.naarBestand) return { ...gemeen, pad: opdracht.pad, openen: null };
  return { ...gemeen, printer: opdracht.printer, copies: opdracht.kopieen, papier: opdracht.papier };
}

const ZELFDE_VEL_MM = 0.5;

/** De naam van een vel met deze maten ("A3"), of '' als het geen bekend formaat is. */
export function velFormaatNaam(breedteMm, hoogteMm) {
  const kort = Math.min(breedteMm, hoogteMm);
  const lang = Math.max(breedteMm, hoogteMm);
  const f = Object.values(PAPIERFORMATEN)
    .find((v) => Math.abs(v.breedte - kort) <= ZELFDE_VEL_MM && Math.abs(v.hoogte - lang) <= ZELFDE_VEL_MM);
  return f ? f.label : '';
}

const afgerond = (n) => Math.round(n * 10) / 10;

/**
 * Het antwoord na een gelukte afdruk: waar hij heen ging, hoeveel pagina's, en
 * per pagina het vel met zijn stand en de gebruikte schaal.
 *
 * @param {object} opdracht  uitkomst van `leesPrintOpdracht`
 * @param {Array<{page:number, plaatsing:object}>} plaatsingen  per afgedrukte pagina
 * @param {{gerasterd?:boolean, waarschuwingen?:string[]}} [o]
 *   gerasterd = de vectorweg lukte niet en de pagina's staan als beeld in het
 *   bestand (print-job.js valt daar op terug).
 */
export function printUitkomst(opdracht, plaatsingen, { gerasterd = false, waarschuwingen = [] } = {}) {
  const warnings = [...waarschuwingen];
  const page_list = (plaatsingen || []).map(({ page, plaatsing }) => {
    const vel = plaatsing?.vel || {};
    const breedteMm = afgerond(Number(vel.breedteMm) || 0);
    const hoogteMm = afgerond(Number(vel.hoogteMm) || 0);
    if (plaatsing?.afgesneden) warnings.push(`page ${page}: the page does not fit on the sheet and is cut off`);
    else if (plaatsing?.buitenBedrukbaar) warnings.push(`page ${page}: the page reaches outside the printable area of the printer`);
    return {
      page,
      sheet: velFormaatNaam(breedteMm, hoogteMm),
      widthMm: breedteMm,
      heightMm: hoogteMm,
      orientation: vel.orientatie === 'landscape' ? 'landscape' : 'portrait',
      scale_percent: afgerond((Number(plaatsing?.schaal) || 0) * 100),
      rotated: Boolean(plaatsing?.gedraaid),
      known_sheet: plaatsing?.bekend !== false,
    };
  });
  if (gerasterd) warnings.push('the source could not be read as vectors; the pages were printed as images');

  const eerste = page_list[0];
  const gelijk = eerste && page_list.every((b) => b.widthMm === eerste.widthMm && b.heightMm === eerste.heightMm
    && b.orientation === eerste.orientation && b.scale_percent === eerste.scale_percent);

  return {
    ok: true,
    ...(opdracht.naarBestand ? { file_path: opdracht.pad } : { printer: opdracht.printer, copies: opdracht.kopieen }),
    pages: page_list.length,
    paper: opdracht.papier,
    content: opdracht.inhoud === 'doc-only' ? 'document' : 'document-and-markups',
    sheet: gelijk ? eerste.sheet : '',
    widthMm: gelijk ? eerste.widthMm : 0,
    heightMm: gelijk ? eerste.heightMm : 0,
    orientation: gelijk ? eerste.orientation : 'mixed',
    scale_percent: gelijk ? eerste.scale_percent : 0,
    uniform: Boolean(gelijk),
    page_list,
    warnings,
  };
}

/**
 * Het antwoord van `app_list_printers`: de printerlijst van de app
 * (`get_printers`, wat de printdialoog ook gebruikt), met de standaardprinter
 * en per printer het stuurprogramma, de poort en of hij naar een bestand
 * schrijft (`isBestandsPrinter` uit print-doel.js).
 *
 * @param {Array<object>} lijst        het antwoord van `loadPrinters()`
 * @param {string} standaard           `defaultPrinterName()`
 * @param {(p:object)=>boolean} naarBestand  `isBestandsPrinter`
 * @param {string} [foutmelding]       `printerErrorMessage()`
 */
export function printerUitkomst(lijst, standaard, naarBestand, foutmelding = '') {
  const printers = (Array.isArray(lijst) ? lijst : [])
    .filter((p) => p && typeof p === 'object' && typeof p.Name === 'string' && p.Name)
    .map((p) => ({
      name: p.Name,
      driver: typeof p.DriverName === 'string' ? p.DriverName : '',
      port: typeof p.PortName === 'string' ? p.PortName : '',
      default: p.Default === true || p.Default === 'True' || p.Name === standaard,
      status: p.PrinterStatus ?? p.Status ?? null,
      writes_to_file: Boolean(naarBestand(p)),
    }));
  return {
    ok: true,
    printers,
    count: printers.length,
    default_printer: printers.find((p) => p.default)?.name || '',
    ...(foutmelding ? { error_detail: String(foutmelding) } : {}),
  };
}
