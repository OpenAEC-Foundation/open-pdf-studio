// De MCP-opdracht `app_import_cad` (#400): een DWG of DXF importeren zonder het
// importvenster. Dit bestand bevat alleen de pure regels: de argumenten van de
// opdracht controleren en afbeelden op de instellingen van het importvenster,
// de ruimte en de lagen kiezen, en het antwoord samenstellen. De brug
// (mcp-bridge.js) doet het werk met de functies uit cad-import.js.
//
// Uitgangspunten:
// - Een onbekend of verkeerd getypt argument wordt geweigerd met een nette
//   fout; er wordt niets stilzwijgend genegeerd. `preview` is geen argument en
//   gaat ook nooit mee naar de omzetter: de opdracht maakt altijd de echte PDF.
// - De onthouden instellingen van het venster zijn de basis; de opdracht wint
//   per veld. Alles gaat door `herstelCadImportInstellingen`, zodat een waarde
//   buiten het bereik op de grens uitkomt.
// - De opdracht onthoudt zelf niets.

import { herstelCadImportInstellingen } from '../solid/stores/cad-import-instellingen.js';
import {
  importArgumenten, isCadTekening, lagenKeuze, lagenVoorRuimte, papierInstellingen, ruimteVan,
  standaardUitgesloten,
} from './cad-import-logica.js';

/** Langste pad dat de opdracht aanneemt. */
export const MAX_PADLENGTE = 1024;
/** Hoogste aantal laagnamen in `layersOff` of `layersOn`. */
export const MAX_LAAGNAMEN = 4096;
/** Dekking van een onderlegger: grenzen en standaard. */
export const DEKKING_MIN = 0.05;
export const DEKKING_STANDAARD = 0.5;

export const DOELEN = Object.freeze(['new', 'append', 'underlay']);

/**
 * Hoe lang de opdracht zelf op de verkenning en de omzetting wacht. De brug
 * wacht hooguit 300 s op het antwoord van de webview (mcp_server.rs:
 * `"app_import_cad" => tool_app_request(…, Duration::from_secs(300))`;
 * mcp_app_bridge.rs haalt de wachtende aanroep dan weg en de MCP-client krijgt
 * "timed out"). Deze grens ligt daar net onder: verstrijkt hij, dan breekt de
 * brug de lopende verkenning of import af, ruimt het tijdelijke bestand op en
 * plaatst niets meer — anders zou minuten na "timed out" alsnog een tabblad
 * verschijnen of het document van de gebruiker veranderen.
 */
export const TIJDGRENS_MS = 290_000;

/**
 * Het antwoord als de tijdgrens verstreken is. `app_export_cad` gebruikt
 * dezelfde grens (de brug wacht daar ook 300 s) met een eigen slotzin.
 */
export function tijdgrensFout(pad, gevolg = 'the import was cancelled and nothing was placed') {
  return fout(`timed out after ${TIJDGRENS_MS / 1000} s; ${gevolg}`, { file_path: pad });
}

/** Keuzelijsten van de opdracht; gelijk aan die van het importvenster. */
const KEUZES = Object.freeze({
  area: ['extents', 'limits'],
  paper: ['auto', 'A4', 'A3', 'A3L', 'A2', 'A2L', 'A1', 'A1L', 'A0', 'Letter', 'Tabloid', 'custom'],
  orientation: ['auto', 'portrait', 'landscape'],
  placement: ['center', 'lower_left', 'origin'],
  units: ['file', 'mm', 'cm', 'm', 'in', 'ft'],
  colors: ['file', 'black', 'gray', 'mono', 'single'],
  lineweight: ['file', 'fixed', 'pens'],
  hatch: ['all', 'solid_only', 'outline', 'none'],
});

/** Getallen die ongewijzigd naar de instelling met dezelfde naam gaan. */
const GETALLEN = Object.freeze([
  'scale', 'paperWidthMm', 'paperHeightMm', 'marginMm', 'rotation', 'lineweightMm', 'monoThreshold',
  'maxImageMegapixels',
]);

/** Schakelaars die ongewijzigd naar de instelling met dezelfde naam gaan. */
const SCHAKELAARS = Object.freeze(['text', 'xrefs', 'images', 'reuseBlocks', 'layersAsOcg', 'includeOffLayers']);

/** Lijsten met tekst. */
const TEKSTLIJSTEN = Object.freeze(['layersOff', 'layersOn', 'searchPaths']);

/** Lijsten met regels (objecten); het venster maakt ze schoon. */
const REGELLIJSTEN = Object.freeze(['pens', 'fonts']);

/** Alle argumenten die de opdracht kent. */
export const ARGUMENTEN = Object.freeze([
  'path', 'space', 'target', 'opacity', 'window', 'singleColor',
  ...Object.keys(KEUZES), ...GETALLEN, ...SCHAKELAARS, ...TEKSTLIJSTEN, ...REGELLIJSTEN,
]);

const fout = (error, extra = {}) => ({ ok: false, error, ...extra });

/**
 * Waarom dit pad niet gebruikt wordt, of `''` als het in orde is. Het bestand
 * zelf wordt hier niet aangeraakt: bestaat het niet, dan meldt de verkenning
 * dat.
 */
export function padFout(pad) {
  if (typeof pad !== 'string' || !pad.trim()) return 'missing or invalid params.path';
  if (pad.length > MAX_PADLENGTE) return `params.path is longer than ${MAX_PADLENGTE} characters`;
  if ([...pad].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return 'params.path contains control characters';
  if (/^[\\/]{2}[?.][\\/]/.test(pad)) return 'params.path is a device path';
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(pad)) return 'params.path is a URL, not a file path';
  if (!/^([a-z]:[\\/]|[\\/])/i.test(pad)) return 'params.path must be an absolute path';
  if (/(^|[\\/])\.\.([\\/]|$)/.test(pad)) return 'params.path must not contain ".." parts';
  if (!isCadTekening(pad)) return 'not a CAD drawing (expected .dwg or .dxf)';
  return '';
}

function tekstlijst(waarde, max) {
  if (!Array.isArray(waarde) || waarde.length > max) return null;
  const uit = [];
  for (const item of waarde) {
    if (typeof item !== 'string') return null;
    if (item.trim()) uit.push(item.trim());
  }
  return uit;
}

/**
 * Controleert de argumenten van de opdracht en beeldt ze af op de
 * instellingen van het importvenster.
 * @param {unknown} params     argumenten van `app_import_cad`
 * @param {unknown} onthouden  `state.preferences.cadImportSettings`
 * @returns {{ok:false, error:string} | {ok:true, pad:string, ruimte:string|null,
 *   doel:'new'|'append'|'underlay', dekking:number, lagenUit:string[], lagenAan:string[],
 *   venster:number[]|null, papierKeuze:object, inst:object}}
 */
export function leesImportOpdracht(params, onthouden) {
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    return fout('params must be an object');
  }
  const p = params || {};
  for (const naam of Object.keys(p)) {
    if (naam === 'preview') return fout('preview is not supported: app_import_cad always makes the real PDF');
    if (!ARGUMENTEN.includes(naam)) return fout(`unknown argument: ${naam}`);
  }
  const padMis = padFout(p.path);
  if (padMis) return fout(padMis, typeof p.path === 'string' ? { file_path: p.path.slice(0, MAX_PADLENGTE) } : {});

  if (p.space !== undefined && (typeof p.space !== 'string' || !p.space.trim())) {
    return fout('params.space must be "model" or the name of a layout');
  }
  const doel = p.target === undefined ? 'new' : p.target;
  if (!DOELEN.includes(doel)) return fout(`params.target must be one of: ${DOELEN.join(', ')}`);

  const eigen = {};
  for (const [naam, toegestaan] of Object.entries(KEUZES)) {
    if (p[naam] === undefined) continue;
    if (!toegestaan.includes(p[naam])) return fout(`params.${naam} must be one of: ${toegestaan.join(', ')}`);
    eigen[naam] = p[naam];
  }
  for (const naam of GETALLEN) {
    if (p[naam] === undefined) continue;
    if (typeof p[naam] !== 'number' || !Number.isFinite(p[naam])) return fout(`params.${naam} must be a number`);
    eigen[naam] = p[naam];
  }
  if (eigen.scale !== undefined && eigen.scale < 0) return fout('params.scale must be 0 (fit) or the N of 1:N');
  for (const naam of SCHAKELAARS) {
    if (p[naam] === undefined) continue;
    if (typeof p[naam] !== 'boolean') return fout(`params.${naam} must be true or false`);
    eigen[naam] = p[naam];
  }
  const lijsten = {};
  for (const naam of TEKSTLIJSTEN) {
    if (p[naam] === undefined) continue;
    const lijst = tekstlijst(p[naam], MAX_LAAGNAMEN);
    if (!lijst) return fout(`params.${naam} must be a list of texts`);
    lijsten[naam] = lijst;
  }
  if (lijsten.searchPaths) eigen.searchPaths = lijsten.searchPaths;
  for (const naam of REGELLIJSTEN) {
    if (p[naam] === undefined) continue;
    if (!Array.isArray(p[naam]) || p[naam].some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return fout(`params.${naam} must be a list of objects`);
    }
    eigen[naam] = p[naam];
  }
  if (p.singleColor !== undefined) {
    if (typeof p.singleColor !== 'string' || !/^#?[0-9a-f]{6}$/i.test(p.singleColor.trim())) {
      return fout('params.singleColor must be a colour like #RRGGBB');
    }
    eigen.singleColor = p.singleColor.trim();
  }

  let venster = null;
  if (p.window !== undefined) {
    const v = Array.isArray(p.window) ? p.window : [];
    const geldig = v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) && v[2] > v[0] && v[3] > v[1];
    if (!geldig) return fout('params.window must be [x0, y0, x1, y1] in drawing units, with x1 > x0 and y1 > y0');
    if (p.area !== undefined) return fout('params.window and params.area exclude each other');
    venster = [...v];
  }

  let dekking = DEKKING_STANDAARD;
  if (p.opacity !== undefined) {
    if (typeof p.opacity !== 'number' || !Number.isFinite(p.opacity)) return fout('params.opacity must be a number');
    if (doel !== 'underlay') return fout('params.opacity only applies to target "underlay"');
    dekking = Math.min(1, Math.max(DEKKING_MIN, p.opacity));
  }

  const inst = herstelCadImportInstellingen({ ...(onthouden && typeof onthouden === 'object' ? onthouden : {}), ...eigen });
  // Een onthouden eigen venster hoort bij een andere tekening.
  if (venster) inst.area = 'window';
  else if (inst.area === 'window') inst.area = 'extents';

  // Een layout gebruikt haar eigen papier, tenzij de opdracht papier noemt.
  const papierKeuze = {};
  for (const naam of ['paper', 'orientation', 'paperWidthMm', 'paperHeightMm']) {
    if (eigen[naam] !== undefined) papierKeuze[naam] = inst[naam];
  }

  return {
    ok: true,
    pad: p.path,
    ruimte: p.space === undefined ? null : p.space.trim(),
    doel,
    dekking,
    lagenUit: lijsten.layersOff || [],
    lagenAan: lijsten.layersOn || [],
    venster,
    papierKeuze,
    inst,
  };
}

/**
 * De ruimte uit de verkenning die bij de opdracht hoort. Zonder `space` de
 * ruimte die het bestand voorstelt; een naam telt hoofdletterongevoelig.
 * @returns {{ok:true, ruimte:object} | {ok:false, error:string, spaces:string[]}}
 */
export function kiesRuimte(scan, gevraagd) {
  const ruimtes = Array.isArray(scan?.spaces) ? scan.spaces : [];
  const namen = ruimtes.map((r) => String(r?.id ?? ''));
  if (!ruimtes.length) return fout('the drawing has no model space and no layouts', { spaces: [] });
  if (gevraagd === null || gevraagd === undefined) return { ok: true, ruimte: ruimteVan(scan, scan?.defaultSpace || 'model') };
  const zoek = String(gevraagd).toLowerCase();
  const gevonden = ruimtes.find((r) => String(r?.id ?? '').toLowerCase() === zoek)
    || ruimtes.find((r) => String(r?.label ?? '').toLowerCase() === zoek);
  if (!gevonden) return fout(`space not found: ${gevraagd}`, { spaces: namen });
  return { ok: true, ruimte: gevonden };
}

/**
 * De lagen die niet meedoen: wat in het bestand uit staat, plus `layersOff`,
 * min `layersOn`. Een naam die de tekening niet kent komt in `onbekend`.
 * @returns {{excludedLayers:string[], hiddenLayers:string[], onbekend:string[]}}
 */
export function kiesLagen(scan, ruimteId, opdracht) {
  const lagen = lagenVoorRuimte(scan, ruimteId);
  const bekend = new Set(lagen.map((l) => l.name.toUpperCase()));
  const uit = standaardUitgesloten(lagen, opdracht.inst.skipNonPlottable);
  const onbekend = [];
  for (const naam of opdracht.lagenUit) {
    if (bekend.has(naam.toUpperCase())) uit.add(naam.toUpperCase());
    else onbekend.push(naam);
  }
  for (const naam of opdracht.lagenAan) {
    if (bekend.has(naam.toUpperCase())) uit.delete(naam.toUpperCase());
    else onbekend.push(naam);
  }
  // Bij een onderlegger tellen verborgen lagen als weggelaten, net als in het venster.
  return { ...lagenKeuze(lagen, uit, opdracht.inst, opdracht.doel), onbekend };
}

/**
 * Argumenten voor `import_cad_to_pdf`, met dezelfde regels als het venster.
 * `preview` gaat nooit mee.
 * @param {object} opdracht  uitkomst van `leesImportOpdracht`
 * @param {object} ruimte    de gekozen ruimte uit de verkenning
 * @param {{outputPath:string, excludedLayers:string[], hiddenLayers:string[], limits?:object|null}} o
 */
export function opdrachtArgumenten(opdracht, ruimte, o) {
  const isModel = isModelRuimte(ruimte);
  const inst = { ...opdracht.inst, ...papierInstellingen(opdracht.inst, isModel, opdracht.papierKeuze) };
  const args = importArgumenten(inst, {
    path: opdracht.pad,
    outputPath: o.outputPath,
    spaces: [ruimte?.id || 'model'],
    excludedLayers: o.excludedLayers || [],
    hiddenLayers: o.hiddenLayers || [],
    window: opdracht.venster,
    limits: o.limits || undefined,
    doel: opdracht.doel,
  });
  delete args.preview;
  return args;
}

/**
 * Is de gekozen ruimte de modelruimte? Alleen de soort telt — niet de naam die
 * gevraagd is en niet hoe de ruimte heet: een layout die "model" heet blijft
 * een layout, en zonder `space` kan het bestand zelf een layout voorstellen.
 * Dezelfde regel als het importvenster.
 */
export function isModelRuimte(ruimte) {
  return ruimte?.kind !== 'layout';
}

/**
 * Opties voor `legTekeningOpPagina` bij het doel `underlay`, uit de opdracht,
 * de gekozen ruimte en het importverslag. Een layoutblad staat al op 1:1 en
 * wordt als blad geplaatst; alleen een modelruimte krijgt de schaalfactor
 * naar de meetschaal van de pagina.
 * @param {object} opdracht  uitkomst van `leesImportOpdracht`
 * @param {object} ruimte    de gekozen ruimte uit de verkenning
 * @param {object} verslag   importverslag van de omzetter
 */
export function onderleggerOpties(opdracht, ruimte, verslag) {
  return {
    tekening: opdracht.pad,
    blad: Array.isArray(verslag?.pages) ? verslag.pages[0] : undefined,
    isModel: isModelRuimte(ruimte),
    dekking: Math.round((opdracht.dekking ?? DEKKING_STANDAARD) * 100),
    onder: true,
    opSchaal: true,
  };
}

/** Alleen de naam van een bestand van buiten, nooit een pad. */
function buitenNaam(naam) {
  return String(naam ?? '').split(/[\\/]/).pop().trim();
}

/**
 * Het antwoord van de opdracht na een gelukte import.
 * @param {object} opdracht  uitkomst van `leesImportOpdracht`
 * @param {string} doel      het doel dat werkelijk gebruikt is
 * @param {object} verslag   importverslag van de omzetter
 * @param {string[]} [onbekendeLagen]
 * @param {object} [ruimte]  de gekozen ruimte uit de verkenning
 */
export function opdrachtUitkomst(opdracht, doel, verslag, onbekendeLagen = [], ruimte = undefined) {
  const paginas = Array.isArray(verslag?.pages) ? verslag.pages : [];
  const blad = paginas[0] || {};
  const externals = (Array.isArray(verslag?.externals) ? verslag.externals : [])
    .map((e) => ({ name: buitenNaam(e?.name), kind: String(e?.kind ?? ''), status: String(e?.status ?? '') }))
    .filter((e) => e.name);
  return {
    ok: true,
    file_path: opdracht.pad,
    target: doel,
    space: blad.space || String(ruimte?.id ?? ''),
    space_kind: isModelRuimte(ruimte) ? 'model' : 'layout',
    paper: blad.paper || '',
    scale: blad.scaleText || '',
    pages: paginas.length,
    objects: paginas.reduce((som, b) => som + (Number(b?.objects) || 0), 0),
    page_list: paginas.map((b) => ({
      space: b?.space || '',
      paper: b?.paper || '',
      widthMm: Number(b?.widthMm) || 0,
      heightMm: Number(b?.heightMm) || 0,
      scale: b?.scaleText || '',
      objects: Number(b?.objects) || 0,
    })),
    warnings: Array.isArray(verslag?.warnings) ? verslag.warnings.map(String) : [],
    externals,
    externals_truncated: verslag?.externalsTruncated === true,
    unknown_layers: onbekendeLagen,
  };
}
