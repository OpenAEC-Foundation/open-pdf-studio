// Bladwijzers uit de outline van een pdf.js-document, als het model van het
// bladwijzerpaneel (doc.bookmarks). Geen imports uit de app: de lader, het
// samenvoegen en de unit-tests gebruiken dezelfde omzetting.

import { doelVeldenUitDest } from './bladwijzer-doel.js';

// Load bookmarks from PDF outline
export async function loadBookmarksFromPdf(pdfDoc) {
  if (!pdfDoc) return [];
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) return [];
    const bookmarks = [];
    let nextId = 1;
    async function processItems(items, parentId) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = 'bm_' + (nextId++);
        let page = 1;
        // De plek op de pagina (#1157): elke vorm van bestemming, niet alleen
        // /XYZ. Het derde getal is bij /FitH een hoogte en bij /FitV een
        // afstand van links; blind als left/top lezen verhaspelt ze.
        let doel = { left: null, top: null, zoom: null };

        // Resolve destination
        if (item.dest) {
          try {
            let dest = item.dest;
            if (typeof dest === 'string') {
              dest = await pdfDoc.getDestination(dest);
            }
            if (dest && Array.isArray(dest)) {
              const pageRef = dest[0];
              const pageIndex = await pdfDoc.getPageIndex(pageRef);
              page = pageIndex + 1;
              doel = doelVeldenUitDest(dest);
            }
          } catch (e) {
            // Failed to resolve dest - use page 1
          }
        }

        const bm = {
          id,
          title: item.title || 'Untitled',
          page,
          top: doel.top,
          left: doel.left,
          zoom: doel.zoom,
          // Een andere vorm dan /XYZ blijft zoals hij in het bestand staat.
          ...(doel.destType ? { destType: doel.destType, destArgs: doel.destArgs } : {}),
          parentId,
          expanded: true,
          bold: !!(item.bold),
          italic: !!(item.italic),
          color: pdfjsKleurNaarHex(item.color),
          sortOrder: i,
          fromPdf: true,
        };
        bookmarks.push(bm);

        if (item.items && item.items.length > 0) {
          await processItems(item.items, id);
        }
      }
    }
    await processItems(outline, null);
    return bookmarks;
  } catch (e) {
    console.warn('Failed to load bookmarks:', e);
    return [];
  }
}

// Kleur van een outline-item (/C, #689). pdf.js geeft hem als RGB in 0-255
// (Uint8ClampedArray), en zwart [0,0,0] ook als het item geen /C heeft. Zwart
// is daarom "geen eigen kleur": de titel volgt dan het thema.
export function pdfjsKleurNaarHex(arr) {
  if (!arr || arr.length < 3) return null;
  const rgb = [arr[0], arr[1], arr[2]].map(c => Math.max(0, Math.min(255, Math.round(Number(c) || 0))));
  if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) return null;
  return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
}
