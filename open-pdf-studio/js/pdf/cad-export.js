// Export naar DXF/DWG (#400): verbindt het exportvenster met de Tauri-
// commando's van de crate open-pdf-cad. De rekenregels staan in
// cad-export-logica.js (unit-getest), het venster in CadExportDialog.jsx.

import { invoke, saveFileDialog } from '../core/platform.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { pixelsPerUnitFor } from '../annotations/scale-region.js';
import {
  schaalnoemerUitMeetschaal, schaalTekst, weergaveMaat, extensieVoor, basisnaam,
} from './cad-export-logica.js';

let volgnummer = 0;

/** Uniek kenmerk voor een telronde of export (om af te breken). */
export function nieuwJobId(soort) {
  volgnummer += 1;
  return `${soort}-${Date.now()}-${volgnummer}`;
}

/**
 * Weergegeven maat van een pagina in punten (/Rotate toegepast).
 * @returns {Promise<{breedte:number, hoogte:number, rotatie:number}>}
 */
export async function paginaMaat(doc, paginaNr) {
  const pagina = await doc.pdfDoc.getPage(paginaNr);
  const [x0, y0, x1, y1] = pagina.view;
  const rotatie = pagina.rotate || 0;
  return { ...weergaveMaat(x1 - x0, y1 - y0, rotatie), rotatie };
}

/**
 * Gebieden op een pagina die de gebruiker kan exporteren: schaalgebieden,
 * viewport-annotaties van de app en viewports uit de PDF zelf (/VP). Rechthoek
 * in app-ruimte; `schaal` is de schaalnoemer van het gebied (of null).
 */
export function gebiedenOpPagina(doc, paginaNr) {
  const uit = [];
  for (const a of doc?.annotations || []) {
    if (a.page !== paginaNr) continue;
    if (a.type === 'scaleRegion') {
      const ppu = pixelsPerUnitFor(a.scaleString || '1:100', a.units || 'mm');
      uit.push({
        id: `region:${a.id}`,
        soort: 'region',
        naam: a.label || '',
        rect: { x: a.x, y: a.y, width: a.width, height: a.height },
        schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: ppu, unit: a.units || 'mm' }),
      });
    } else if (a.type === 'viewport' && a.width && a.height) {
      uit.push({
        id: `viewport:${a.id}`,
        soort: 'viewport',
        naam: a.name || '',
        rect: { x: a.x, y: a.y, width: a.width, height: a.height },
        schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: a.pixelsPerUnit, unit: a.unit || 'mm' }),
      });
    }
  }
  (doc?.pdfViewports?.[paginaNr] || []).forEach((v, i) => {
    uit.push({
      id: `pdf:${i}`,
      soort: 'pdf',
      naam: v.name || v.ratio || '',
      rect: { x: v.x, y: v.y, width: v.width, height: v.height },
      schaal: schaalnoemerUitMeetschaal({ pixelsPerUnit: v.pixelsPerUnit, unit: v.unit }),
    });
  });
  return uit;
}

/**
 * Meetschaal van de app op een plek van de pagina, als schaalnoemer; het
 * midden van `rect` (app-ruimte), of van de pagina als er geen rechthoek is.
 * null als er geen meetschaal is ingesteld.
 */
export function meetschaalOp(paginaNr, rect, maat) {
  const cx = rect ? rect.x + rect.width / 2 : (maat?.breedte || 0) / 2;
  const cy = rect ? rect.y + rect.height / 2 : (maat?.hoogte || 0) / 2;
  return schaalnoemerUitMeetschaal(getMeasureScale(paginaNr, cx, cy));
}

export { schaalTekst };

/** Telt per laag wat de export van één pagina zou maken. */
export function scanPagina(jobId, args) {
  return invoke('scan_page_for_cad', { jobId, args });
}

/** Exporteert één pagina; geeft het exportverslag terug. */
export function exporteerPagina(jobId, args) {
  return invoke('export_page_to_cad', { jobId, args });
}

/** Breekt een lopende telronde of export af. */
export function annuleer(jobId) {
  if (!jobId) return Promise.resolve(false);
  return invoke('cancel_cad_export', { jobId }).catch(() => false);
}

/**
 * Luistert naar de voortgang van exports. Geeft een functie terug die het
 * luisteren weer stopt.
 * @param {(p: {jobId:string, phase:string, done:number, total:number}) => void} cb
 */
export async function luisterVoortgang(cb) {
  const ev = window.__TAURI__?.event;
  if (!ev?.listen) return () => {};
  const stop = await ev.listen('cad-export-progress', (e) => cb(e.payload));
  return () => { try { stop(); } catch { /* al gestopt */ } };
}

/** Bestandskeuze voor het doelbestand, met een voorstel naast de PDF. */
export async function kiesDoelbestand(doc, formaat, huidig) {
  const ext = extensieVoor(formaat);
  let voorstel = huidig;
  if (!voorstel) {
    const map = doc?.filePath && !doc?.isUntitled ? doc.filePath.replace(/[^\\/]*$/, '') : '';
    voorstel = `${map}${basisnaam(doc?.fileName || doc?.filePath)}.${ext}`;
  } else {
    voorstel = voorstel.replace(/\.(dxf|dwg)$/i, `.${ext}`);
  }
  return saveFileDialog(voorstel, [{ name: ext.toUpperCase(), extensions: [ext] }]);
}
