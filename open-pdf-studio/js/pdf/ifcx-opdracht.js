// The MCP tool `app_export_ifcx` (#876, beta): pages of the current document
// to an IFCX file without the export dialog. Only the pure rules live here
// (check the arguments, shape the answer); mcp-bridge.js does the work with
// the same function as the dialog (ifcx-export.js).
//
// Like app_export_cad: an unknown or mistyped argument is refused with a
// clear error; nothing is silently ignored.

import { padFout } from './cad-mcp-opdracht.js';

export const ARGUMENTEN = Object.freeze(['path', 'pages', 'raster', 'text', 'annotations', 'maxPathsPerPage']);
export const MAX_PADEN_GRENS = 1_000_000;

const fout = (error, extra = {}) => ({ ok: false, error, ...extra });

/**
 * @param {unknown} params  arguments of app_export_ifcx
 * @returns {{ok:false, error:string} | {ok:true, pad:string, paginas:string,
 *   opties:{raster:boolean, tekst:boolean, annotaties:boolean, limieten?:{maxPaden:number}}}}
 */
export function leesIfcxOpdracht(params) {
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    return fout('params must be an object');
  }
  const p = params || {};
  for (const naam of Object.keys(p)) {
    if (!ARGUMENTEN.includes(naam)) return fout(`unknown argument: ${naam}`);
  }
  if (typeof p.path !== 'string' || !p.path.trim()) return fout('missing or invalid params.path');
  const pad = p.path.trim();
  const padMis = padFout(pad);
  if (padMis && !padMis.startsWith('not a CAD drawing')) return fout(padMis, { file_path: pad.slice(0, 1024) });
  if (!/\.ifcx$/i.test(pad)) return fout('params.path must end in .ifcx', { file_path: pad.slice(0, 1024) });

  let paginas = 'all';
  if (p.pages !== undefined) {
    if (typeof p.pages !== 'string' || !p.pages.trim()) return fout('params.pages must be "current", "all" or a range like "1-3,5"');
    paginas = p.pages.trim();
  }
  const opties = { raster: true, tekst: true, annotaties: true };
  for (const [arg, veld] of [['raster', 'raster'], ['text', 'tekst'], ['annotations', 'annotaties']]) {
    if (p[arg] === undefined) continue;
    if (typeof p[arg] !== 'boolean') return fout(`params.${arg} must be true or false`);
    opties[veld] = p[arg];
  }
  if (p.maxPathsPerPage !== undefined) {
    const n = p.maxPathsPerPage;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PADEN_GRENS) return fout(`params.maxPathsPerPage must be a whole number from 1 to ${MAX_PADEN_GRENS}`);
    opties.limieten = { maxPaden: n };
  }
  return { ok: true, pad, paginas, opties };
}

/** The answer after a written export. */
export function ifcxUitkomst(opdracht, resultaat, waarschuwingen = []) {
  const v = resultaat.verslag || {};
  const warnings = [...waarschuwingen];
  let beelden = 0;
  for (const w of v.warnings || []) {
    if (w.code === 'cap') warnings.push(`page ${w.page}: ${w.kept} of ${w.total} ${w.kind} exported; the rest is over the limit`);
    else if (w.code === 'image') beelden++;
    else if (w.code === 'size') warnings.push(`page ${w.page} and the pages after it (${w.skipped} in all) were not exported: the file reached its size limit`);
  }
  if (beelden) warnings.push(`${beelden} image(s) kept their placement but not their pixels (unsupported encoding or size limit)`);
  return {
    ok: true,
    file_path: opdracht.pad,
    beta: true,
    pages: v.pages || [],
    counts: v.counts || {},
    bytes: resultaat.bytes || 0,
    warnings,
  };
}
