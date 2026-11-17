// De plek waar een bladwijzer naartoe wijst (#1157), uit wat er nu in beeld
// is: de bovenkant van de geselecteerde tekst, of de linkerbovenhoek van het
// zichtbare deel van de huidige pagina. Het rekenwerk staat in
// pdf/link-destination.js (xyzVoorWeergavepunt), het omgekeerde van hoe een
// bestemming getoond wordt; hier alleen het aflezen van het scherm.

import { getPageRotation } from '../../core/state.js';
import { weergaveRotatie, paginaOorsprong, paginaRectNaarWeergave } from '../../pdf/weergave-ruimte.js';
import { xyzVoorWeergavepunt } from '../../pdf/link-destination.js';
import { doelVelden, titelUitSelectie } from '../../pdf/bladwijzer-doel.js';
import { getSelectionRectsForAnnotation, getSelectedText } from '../../text/text-selection.js';

/** De pagina zoals hij op het scherm ligt: zelfde opbouw als bij het volgen van een link. */
async function paginaGegevens(doc, pageNum) {
  const pdfPage = await doc.pdfDoc.getPage(pageNum);
  const rotatie = (pdfPage.rotate || 0) + (getPageRotation(pageNum) || 0) + weergaveRotatie(doc);
  return { view: Array.from(pdfPage.view), rotatie };
}

/** Linkerbovenhoek van het venster waarin de pagina te zien is (schermpositie). */
function vensterHoek(doc) {
  const vp = window.__pdfViewport;
  // De vector-viewport tekent in zijn eigen canvas; anders schuift de container.
  const el = vp && vp.active && doc.filePath
    ? document.getElementById('annotation-canvas')
    : document.getElementById('pdf-container');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { links: r.left + (el.clientLeft || 0), boven: r.top + (el.clientTop || 0) };
}

/** Is er tekst geselecteerd waar een bladwijzer naartoe kan wijzen? */
export function heeftTekstselectie() {
  try {
    return getSelectionRectsForAnnotation().length > 0 && titelUitSelectie(getSelectedText()) !== '';
  } catch {
    return false;
  }
}

/**
 * Het doel 'de geselecteerde tekst': de pagina, de bovenkant van de selectie
 * en de tekst als titel. Null zonder selectie. De selectie wordt meteen
 * gelezen (synchroon), vóór een venster haar kan wegnemen.
 * @returns {Promise<{titel: string, velden: object}|null>}
 */
export function doelVanSelectie(doc) {
  let vakken = [];
  let tekst = '';
  try {
    vakken = getSelectionRectsForAnnotation() || [];
    tekst = getSelectedText();
  } catch {
    return Promise.resolve(null);
  }
  if (!doc?.pdfDoc || vakken.length === 0) return Promise.resolve(null);
  const page = vakken[0].page;
  // Linksboven op het scherm, ook in een gedraaide weergave.
  let x = Infinity;
  let y = Infinity;
  for (const vak of vakken) {
    if (vak.page !== page || !(vak.width > 0 || vak.height > 0)) continue;
    const w = paginaRectNaarWeergave(page, vak, doc);
    x = Math.min(x, w.x);
    y = Math.min(y, w.y);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Promise.resolve(null);
  const titel = titelUitSelectie(tekst);
  return paginaGegevens(doc, page).then((pagina) => {
    const plek = xyzVoorWeergavepunt(pagina, x, y);
    return { titel, velden: doelVelden({ page, ...(plek || {}) }) };
  }).catch(() => ({ titel, velden: doelVelden({ page }) }));
}

/**
 * Het doel 'wat nu in beeld is': de huidige pagina en de linkerbovenhoek van
 * het zichtbare deel ervan. Staat de bovenkant van de pagina in beeld, dan is
 * dat de bovenkant van de pagina.
 * @returns {Promise<object>} de doelvelden (page, left, top, zoom ...)
 */
export async function doelVanBeeld(doc) {
  const page = doc?.currentPage || 1;
  try {
    const oorsprong = paginaOorsprong(page, doc);
    const hoek = vensterHoek(doc);
    if (!oorsprong || !hoek || !(oorsprong.schaal > 0)) return doelVelden({ page });
    const pagina = await paginaGegevens(doc, page);
    const plek = xyzVoorWeergavepunt(
      pagina,
      (hoek.links - oorsprong.links) / oorsprong.schaal,
      (hoek.boven - oorsprong.boven) / oorsprong.schaal,
    );
    return doelVelden({ page, ...(plek || {}) });
  } catch {
    return doelVelden({ page });
  }
}
