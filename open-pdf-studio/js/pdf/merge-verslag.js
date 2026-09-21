// Verslag van het samenvoegen van PDF's, en het antwoord dat de MCP-brug
// ervan maakt (#400).
//
// Het samenvoegen slaat een bestand over zonder te falen: een voorbeeld-PDF
// van het importvenster wordt geweigerd, een bestand zonder pagina's of een
// onleesbaar bestand doet niet mee. Wie alleen "het liep zonder fout" meldt,
// zegt dan `ok` terwijl er niets is ingevoegd.
//
// Geen imports uit de app: de unit-tests draaien hier onder node op.

/** Geweigerd: een voorbeeld-PDF van het importvenster kan inhoud missen. */
export const REDEN_VOORBEELD = 'preview-pdf';
/** Geweigerd: het bestand heeft geen pagina's. */
export const REDEN_GEEN_PAGINAS = 'no-pages';

const UITLEG = {
  [REDEN_VOORBEELD]: 'refused: a preview PDF of the CAD import can lack content; run the import itself',
  [REDEN_GEEN_PAGINAS]: 'refused: the file has no pages',
};

/**
 * Een leeg verslag. `error` is de reden waarom het samenvoegen niet kon
 * beginnen (geen document, geen bytes, niet op de desktop).
 * @returns {{merged: string[], refused: {path:string, reason:string}[], failed: {path:string, error:string}[], pagesInserted: number, error?: string}}
 */
export function nieuwMergeVerslag(error = null) {
  const verslag = { merged: [], refused: [], failed: [], pagesInserted: 0 };
  if (error) verslag.error = String(error);
  return verslag;
}

const naam = (pad) => String(pad || '').split(/[\\/]/).pop();

/**
 * Het antwoord van `app_merge_pdf`: alleen `ok` als elk gevraagd bestand er
 * werkelijk in zit. Anders `ok: false` met per bestand waarom het eruit bleef;
 * wat wel lukte staat er ook bij (`mergedFiles`, `pagesAfter`).
 * @param {object|undefined} verslag  wat `mergeFiles` teruggaf
 * @param {{filePaths:string[], position:string, pagesBefore:number, pagesAfter:number, filePath?:string}} o
 */
export function mergeAntwoord(verslag, o) {
  const gevraagd = Array.isArray(o?.filePaths) ? o.filePaths.length : 0;
  const pagesBefore = Number(o?.pagesBefore) || 0;
  const pagesAfter = Number.isFinite(Number(o?.pagesAfter)) ? Number(o.pagesAfter) : pagesBefore;
  const gegroeid = pagesAfter > pagesBefore;
  const staart = { pagesBefore, pagesAfter, filePath: o?.filePath };

  // Zonder verslag valt alleen aan het pagina-aantal te zien of er iets gebeurde.
  if (!verslag || !Array.isArray(verslag.merged)) {
    if (gegroeid) return { ok: true, position: o?.position, mergedFiles: gevraagd, ...staart };
    return { ok: false, error: 'nothing was merged: the page count did not change', position: o?.position, mergedFiles: 0, refused: [], failed: [], ...staart };
  }

  const refused = (verslag.refused || []).map((r) => ({ file: r.path, reason: r.reason }));
  const failed = (verslag.failed || []).map((f) => ({ file: f.path, error: String(f.error ?? '') }));
  // "Samengevoegd" zonder dat er een pagina bijkwam, telt niet.
  const mergedFiles = gegroeid ? verslag.merged.length : 0;
  const kop = { position: o?.position, mergedFiles, pagesInserted: Number(verslag.pagesInserted) || 0 };

  if (!verslag.error && mergedFiles === gevraagd && gevraagd > 0 && !refused.length && !failed.length) {
    return { ok: true, ...kop, ...staart };
  }

  const delen = [
    ...refused.map((r) => `${naam(r.file)} ${UITLEG[r.reason] || `refused: ${r.reason}`}`),
    ...failed.map((f) => `${naam(f.file)} failed: ${f.error}`),
  ];
  let error;
  if (verslag.error) error = `merge did not start: ${verslag.error}`;
  else if (delen.length) error = `${gevraagd - mergedFiles} of ${gevraagd} files not merged: ${delen.join('; ')}`;
  else error = 'nothing was merged: the page count did not change';
  return { ok: false, error, ...kop, refused, failed, ...staart };
}
