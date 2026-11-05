// Afdrukken: Huidige weergave (#947) — het lezen van het scherm.
//
// Welke pagina's staan in het documentvenster, en welk deel ervan? De
// schermrechthoeken van de pagina's komen uit dezelfde bron als de
// schermafbeelding (paginasOpScherm), de omrekening naar de paginaruimte uit
// weergave-ruimte.js. Het rekenwerk staat in print-huidige-weergave.js.

import { paginaMaat, weergaveRotatie, clientRectNaarPagina } from './weergave-ruimte.js';
import { zichtbareDelen, maakUitsnede } from './print-huidige-weergave.js';

/** Het zichtbare deel van het documentvenster in schermcoördinaten, zonder schuifbalken. */
function vensterRect() {
  const el = document.getElementById('pdf-container');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left + (el.clientLeft || 0),
    top: r.top + (el.clientTop || 0),
    width: el.clientWidth || r.width,
    height: el.clientHeight || r.height,
  };
}

/**
 * De uitsneden van de huidige weergave: per pagina in beeld het zichtbare
 * deel, van boven naar beneden. Leeg als er niets in beeld is.
 * @returns {Promise<{pageNum:number, uitsnede:object}[]>}
 */
export async function leesHuidigeWeergave(doc) {
  if (typeof document === 'undefined' || !doc?.pdfDoc) return [];
  const venster = vensterRect();
  if (!venster) return [];
  const { paginasOpScherm } = await import('../tools/screenshot.js');
  const rotatie = weergaveRotatie(doc);
  const uit = [];
  for (const { pageNum, rect } of zichtbareDelen(paginasOpScherm(doc), venster)) {
    const uitsnede = maakUitsnede(clientRectNaarPagina(pageNum, rect, doc), paginaMaat(pageNum, doc), rotatie);
    if (uitsnede) uit.push({ pageNum, uitsnede });
  }
  return uit;
}
