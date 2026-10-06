// Leesrichting van geselecteerde tekst (#527).
//
// De selectie geeft alleen assen-uitgelijnde vakken. Of de tekst daarin
// liggend, staand of op zijn kop staat, staat in de teksttransform van pdf.js
// die text-layer.js op elke span zet (data-pdf-transform). Een markering die
// deze richting niet kent, zou de opslag op staande tekst (bv. een rechtop
// gezette pagina met /Rotate 90) dwars over de tekst schrijven.
//
// Puur: alleen de knopen die de selectie geeft, geen document of app-state.

import { textDirFromTransform } from '../annotations/corrections/geometry.js';

/**
 * De pdf.js-teksttransform van de tekstlaag-span waarin `node` staat (een
 * tekstknoop of de span zelf), of null. Zoekt niet verder dan de tekstlaag.
 * @param {Node|null} node
 * @returns {number[]|null}
 */
export function spanTransform(node) {
  for (let n = node; n; n = n.parentElement) {
    const ruw = n.dataset?.pdfTransform;
    if (ruw) {
      try {
        const t = JSON.parse(ruw);
        return Array.isArray(t) ? t : null;
      } catch {
        return null;
      }
    }
    if (n.classList?.contains?.('textLayer')) return null;
  }
  return null;
}

/**
 * Leesrichting (0/90/180/270, paginaruimte van de app) van de tekst waar de
 * selectie begint, anders waar ze eindigt; null als die onbekend of schuin is.
 * @param {{anchorNode?: Node|null, focusNode?: Node|null}|null} selection
 * @param {number} pageRot  eigen /Rotate van de pagina plus de paginarotatie in de app
 */
export function selectionTextDir(selection, pageRot) {
  const t = spanTransform(selection?.anchorNode) || spanTransform(selection?.focusNode);
  return t ? textDirFromTransform(t, pageRot) : null;
}
