// De MCP-opdracht `app_export_cad` (#400): een of meer pagina's naar DXF of DWG
// schrijven zonder het exportvenster. Dit bestand bevat alleen de pure regels:
// de argumenten controleren en afbeelden op de instellingen van het
// exportvenster, de argumenten voor de omzetter (via dezelfde exportArgumenten
// als het venster) en het verslag. De brug (mcp-bridge.js) doet het werk met
// de functies uit cad-export.js — venster en opdracht lopen dezelfde weg.
//
// Uitgangspunten, gelijk aan app_import_cad:
// - Een onbekend of verkeerd getypt argument wordt geweigerd met een nette
//   fout; er wordt niets stilzwijgend genegeerd.
// - De onthouden instellingen van het venster zijn de basis; de opdracht wint
//   per veld. Alles gaat door `herstelCadExportInstellingen`.
// - De opdracht onthoudt zelf niets.

import { herstelCadExportInstellingen } from '../solid/stores/cad-export-instellingen.js';
import {
  MAX_ENTITEITEN, appRechthoekNaarWeergave, exportArgumenten, formaatUitPad, leesExportFout, leesTeGroot,
  padMetFormaat, schaalTekst,
} from './cad-export-logica.js';
import { MAX_LAAGNAMEN, padFout } from './cad-mcp-opdracht.js';

/**
 * Oorsprongen van de tekening. `model` (de oorspronkelijke modelcoördinaten
 * van een geïmporteerde pagina, uit /OPS_ModelMatrix) kent de omzetter wél,
 * het exportvenster nog niet; daarom staat hij hier en niet in de
 * instellingen van het venster.
 */
export const OORSPRONGEN = Object.freeze(['page', 'area', 'model']);

/** Keuzelijsten van de opdracht; gelijk aan die van het exportvenster. */
const KEUZES = Object.freeze({
  format: ['dxf', 'dxf_binary', 'dwg'],
  scaleMode: ['paper', 'measure', 'custom'],
  layers: ['ocg_then_style', 'style', 'single'],
  units: ['mm', 'cm', 'm', 'in'],
});

/** Alle argumenten die de opdracht kent. */
export const ARGUMENTEN = Object.freeze([
  'path', 'pages', 'origin', 'area', 'annotations', 'scale', 'layersOff', 'allowLarge', ...Object.keys(KEUZES),
]);

const fout = (error, extra = {}) => ({ ok: false, error, ...extra });

/**
 * Controleert de argumenten van de opdracht en beeldt ze af op de
 * instellingen van het exportvenster.
 * @param {unknown} params     argumenten van `app_export_cad`
 * @param {unknown} onthouden  `state.preferences.cadExportSettings`
 * @returns {{ok:false, error:string} | {ok:true, pad:string, paginas:string,
 *   oorsprong:'page'|'area'|'model', gebied:{x:number,y:number,width:number,height:number}|null,
 *   lagenUit:string[], grootToegestaan:boolean, inst:object}}
 */
export function leesExportOpdracht(params, onthouden) {
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    return fout('params must be an object');
  }
  const p = params || {};
  for (const naam of Object.keys(p)) {
    if (!ARGUMENTEN.includes(naam)) return fout(`unknown argument: ${naam}`);
  }
  if (typeof p.path !== 'string' || !p.path.trim()) return fout('missing or invalid params.path');

  const eigen = {};
  for (const [naam, toegestaan] of Object.entries(KEUZES)) {
    if (p[naam] === undefined) continue;
    if (!toegestaan.includes(p[naam])) return fout(`params.${naam} must be one of: ${toegestaan.join(', ')}`);
    eigen[naam] = p[naam];
  }
  if (p.annotations !== undefined) {
    if (typeof p.annotations !== 'boolean') return fout('params.annotations must be true or false');
    eigen.annotations = p.annotations;
  }
  if (p.scale !== undefined) {
    if (typeof p.scale !== 'number' || !Number.isFinite(p.scale) || p.scale <= 0) return fout('params.scale must be the N of 1:N, greater than 0');
    eigen.customScale = p.scale;
    if (eigen.scaleMode === undefined) eigen.scaleMode = 'custom';
  }
  if (eigen.scaleMode === 'custom' && p.scale === undefined) return fout('params.scaleMode "custom" needs params.scale');

  let paginas = 'current';
  if (p.pages !== undefined) {
    if (typeof p.pages !== 'string' || !p.pages.trim()) return fout('params.pages must be "current", "all" or a range like "1-3,5"');
    paginas = p.pages.trim();
  }
  let oorsprong = 'page';
  if (p.origin !== undefined) {
    if (!OORSPRONGEN.includes(p.origin)) return fout(`params.origin must be one of: ${OORSPRONGEN.join(', ')}`);
    oorsprong = p.origin;
  }
  let gebied = null;
  if (p.area !== undefined) {
    const v = Array.isArray(p.area) ? p.area : [];
    const geldig = v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) && v[2] > v[0] && v[3] > v[1];
    if (!geldig) return fout('params.area must be [x0, y0, x1, y1] in page points (top-left origin), with x1 > x0 and y1 > y0');
    gebied = { x: v[0], y: v[1], width: v[2] - v[0], height: v[3] - v[1] };
  }
  let lagenUit = [];
  if (p.layersOff !== undefined) {
    if (!Array.isArray(p.layersOff) || p.layersOff.length > MAX_LAAGNAMEN || p.layersOff.some((n) => typeof n !== 'string')) {
      return fout('params.layersOff must be a list of layer names');
    }
    lagenUit = p.layersOff.map((n) => n.trim()).filter(Boolean);
  }
  let grootToegestaan = false;
  if (p.allowLarge !== undefined) {
    if (typeof p.allowLarge !== 'boolean') return fout('params.allowLarge must be true or false');
    grootToegestaan = p.allowLarge;
  }

  const basis = onthouden && typeof onthouden === 'object' ? onthouden : {};
  const inst = herstelCadExportInstellingen({ ...basis, ...eigen });
  // Het doelbestand en het formaat horen bij elkaar: een gegeven formaat wint
  // en bepaalt de extensie; anders volgt het formaat uit de extensie.
  let pad = p.path.trim();
  if (eigen.format !== undefined) pad = padMetFormaat(pad, inst.format);
  else inst.format = formaatUitPad(pad, inst.format);
  const padMis = padFout(pad);
  if (padMis) return fout(padMis.replace('not a CAD drawing (expected .dwg or .dxf)', 'params.path must end in .dxf or .dwg, or params.format must be given'), { file_path: pad.slice(0, 1024) });
  // Het venster kent de oorsprong van het model nog niet; de instellingen
  // laten hem daarom niet door, de omzetter wel.
  inst.origin = oorsprong;

  return { ok: true, pad, paginas, oorsprong, gebied, lagenUit, grootToegestaan, inst };
}

/**
 * Argumenten voor `export_page_to_cad` voor één pagina, met dezelfde regels als
 * het venster.
 * @param {object} opdracht  uitkomst van `leesExportOpdracht`
 * @param {{pdfPath:string, pageIndex:number, outputPath:string, schaalnoemer:number|null,
 *   paginaHoogte:number, uitgeslotenLagen:string[]}} o
 */
export function exportOpdrachtArgumenten(opdracht, o) {
  return exportArgumenten({ ...opdracht.inst }, {
    pdfPath: o.pdfPath,
    pageIndex: o.pageIndex,
    outputPath: o.outputPath,
    schaalnoemer: o.schaalnoemer,
    gebied: opdracht.gebied ? appRechthoekNaarWeergave(opdracht.gebied, o.paginaHoogte) : null,
    uitgeslotenLagen: o.uitgeslotenLagen || [],
    maxEntiteiten: opdracht.grootToegestaan ? null : MAX_ENTITEITEN,
  });
}

/**
 * Het antwoord na een gelukte export.
 * @param {object} opdracht  uitkomst van `leesExportOpdracht`
 * @param {Array<{pagina:number, verslag:object}>} verslagen  per geschreven pagina
 * @param {string[]} [waarschuwingen]  waarschuwingen van de brug zelf
 */
export function exportUitkomst(opdracht, verslagen, waarschuwingen = []) {
  const warnings = [...waarschuwingen];
  const files = (verslagen || []).map(({ pagina, verslag }) => {
    const c = verslag?.convert || {};
    const objects = ['lines', 'polylines', 'splines', 'hatches', 'masks', 'texts'].reduce((som, k) => som + (Number(c[k]) || 0), 0);
    if (Number(c.skipped_images) > 0) warnings.push(`page ${pagina}: ${c.skipped_images} image(s) were skipped`);
    if (Number(c.skipped_invisible_text) > 0) warnings.push(`page ${pagina}: ${c.skipped_invisible_text} invisible text item(s) were skipped`);
    return {
      page: pagina,
      path: String(verslag?.output_path ?? ''),
      bytes: Number(verslag?.file_size) || 0,
      objects,
      scale: schaalTekst(Number(verslag?.scale_denominator), '.'),
      width: Number(verslag?.page_width) || 0,
      height: Number(verslag?.page_height) || 0,
      layers: Number(c.layers) || 0,
      skipped: { images: Number(c.skipped_images) || 0, invisible_text: Number(c.skipped_invisible_text) || 0 },
    };
  });
  return {
    ok: true,
    file_path: opdracht.pad,
    format: opdracht.inst.format,
    origin: opdracht.oorsprong,
    files,
    objects: files.reduce((som, f) => som + f.objects, 0),
    bytes: files.reduce((som, f) => som + f.bytes, 0),
    warnings,
  };
}

/**
 * Het antwoord als de export van een pagina mislukt: een vaste code (zoals het
 * venster die vertaalt) plus de tekst van de omzetter.
 * @param {unknown} e       de fout
 * @param {string} pad      het doelbestand
 * @param {number} pagina   de pagina waar het misging
 */
export function exportFout(e, pad, pagina) {
  const groot = leesTeGroot(e);
  if (groot) {
    return fout(
      `page ${pagina} has ${groot.entities} objects, more than the limit of ${groot.limit}; pass allowLarge: true to export it anyway`,
      { code: 'tooLarge', page: pagina, entities: groot.entities, limit: groot.limit, file_path: pad },
    );
  }
  const f = leesExportFout(e);
  const tekst = f.sleutel === 'failed' ? f.error : `${f.sleutel}${f.n != null ? ` (${f.n} candidates)` : ''}${f.unit ? ` (${f.unit})` : ''}`;
  return fout(`export of page ${pagina} failed: ${tekst}`, { code: f.sleutel, page: pagina, file_path: pad, ...(f.n != null ? { n: f.n } : {}), ...(f.unit ? { unit: f.unit } : {}) });
}
