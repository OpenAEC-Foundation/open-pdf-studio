// Miniaturen voor de pagina-organizer (#764).
//
// De organizer toont elke pagina als kaart. Hier komt het beeld: PDF.js tekent
// de pagina op de maat die de kaart nodig heeft, met de draaiing die het plan
// op dat moment laat zien (de draaiing van de app plus wat de gebruiker in de
// organizer deed). Ingevoegde PDF's worden één keer als PDF.js-document
// geladen en daarna hergebruikt.
//
// Elke maat wordt bewaard, zodat heen en weer zoomen geen nieuwe renders kost;
// sluitMiniaturen() gooit alles weg als de organizer dichtgaat.

import * as pdfjsLib from 'pdfjs-dist';
import { getActiveDocument, getPageRotation } from '../core/state.js';
import { pdfjsBronnen } from '../core/basis-url.js';

const cache = new Map();
const bestandDocs = new Map();
const bezig = new Map();

/** De sleutel waaronder een miniatuur bewaard wordt. */
function sleutel(bron, pagina, rotatie, breedte) {
  return `${bron}|${pagina}|${rotatie}|${breedte}`;
}

async function renderPagina(pdfDoc, pagina, rotatie, doelBreedte) {
  const page = await pdfDoc.getPage(pagina);
  const basis = { scale: 1 };
  const totaal = (((page.rotate || 0) + (rotatie || 0)) % 360 + 360) % 360;
  if (totaal) basis.rotation = totaal;

  const schaal = doelBreedte / (page.getViewport(basis).width || 595);
  const viewport = page.getViewport({ ...basis, scale: schaal });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;
  return canvas.toDataURL('image/jpeg', 0.72);
}

async function bestandDocument(bestandId, bytes) {
  if (bestandDocs.has(bestandId)) return bestandDocs.get(bestandId);
  if (bezig.has(bestandId)) return bezig.get(bestandId);
  const taak = pdfjsLib
    .getDocument({ data: bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0 })
    .promise.then((doc) => {
      bestandDocs.set(bestandId, doc);
      bezig.delete(bestandId);
      return doc;
    })
    .catch((e) => {
      bezig.delete(bestandId);
      console.warn('[organizer] ingevoegd bestand niet te openen voor een miniatuur:', e);
      return null;
    });
  bezig.set(bestandId, taak);
  return taak;
}

/**
 * Een data-URL met de pagina zoals het plan hem toont.
 * @param {object} item  een item uit het plan
 * @param {{doelBreedte?: number, doc?: object, bestand?: {bytes: Uint8Array}}} [opties]
 * @returns {Promise<string|null>} null als er niets te tekenen valt (blanco)
 */
export async function miniatuurVoor(item, { doelBreedte = 150, doc = null, bestand = null } = {}) {
  if (!item || !item.pagina) return null;

  if (item.bron === 'doc') {
    const actief = doc || getActiveDocument();
    if (!actief?.pdfDoc) return null;
    const bron = String(actief.id ?? actief.filePath ?? 'doc');
    const rotatie = ((getPageRotation(item.pagina) || 0) + (item.rotatie || 0)) % 360;
    const key = sleutel(bron, item.pagina, rotatie, doelBreedte);
    if (cache.has(key)) return cache.get(key);
    const url = await renderPagina(actief.pdfDoc, item.pagina, rotatie, doelBreedte);
    cache.set(key, url);
    return url;
  }

  if (item.bron === 'bestand' && bestand?.bytes) {
    const key = sleutel(`b:${item.bestandId}`, item.pagina, item.rotatie || 0, doelBreedte);
    if (cache.has(key)) return cache.get(key);
    const pdfDoc = await bestandDocument(item.bestandId, bestand.bytes);
    if (!pdfDoc) return null;
    const url = await renderPagina(pdfDoc, item.pagina, item.rotatie || 0, doelBreedte);
    cache.set(key, url);
    return url;
  }

  return null;
}

/** Gooi de beelden weg (na toepassen, of als de organizer dichtgaat). */
export function leegMiniatuurCache() {
  cache.clear();
}

/** Sluit de organizer af: beelden en ingevoegde PDF.js-documenten weg. */
export async function sluitMiniaturen() {
  cache.clear();
  const docs = [...bestandDocs.values()];
  bestandDocs.clear();
  bezig.clear();
  for (const doc of docs) {
    try { await doc.destroy(); } catch { /* al weg */ }
  }
}
