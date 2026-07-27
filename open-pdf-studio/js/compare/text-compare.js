// Tekstvergelijking voor de vergelijkweergave.
//
// Extraheert de tekst van BEIDE documenten per pagina via pdf.js
// (getTextContent op het compare-eigen document uit compare-viewport.js),
// groepeert items in leesregels en draait de pure regel-diff uit
// text-diff.js over het hele document heen. Resultaat: een lijst
// {type, oldPage, newPage, oldText, newText}-records voor het tekstpaneel.
//
// Resultaten worden per (oldPath|newPath)-paar gecached; de tekstinhoud van
// een document verandert niet binnen een vergelijk-sessie.

import { getCompareDoc } from './compare-viewport.js';
import { groupItemsIntoLineObjs, diffPageTexts, normalizeLine } from './text-diff.js';

const _resultCache = new Map();
const _CACHE_MAX = 4;

async function _extractDocLines(filePath) {
  const doc = await getCompareDoc(filePath);
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Viewport op schaal 1: de item-rects komen dan in dezelfde
    // pagina-weergaveruimte (oorsprong linksboven, schaal 1) terecht als de
    // annotatie-overlay — de arcering in CompareView vermenigvuldigt met
    // 1.5 × renderedZoom, exact zoals de pagina-bitmap zelf.
    const vp = page.getViewport({ scale: 1 });
    const items = tc.items
      .filter((it) => it.str !== undefined)
      .map((it) => {
        const tx = it.transform?.[4] ?? 0;
        const ty = it.transform?.[5] ?? 0;
        const h = it.height || Math.abs(it.transform?.[3] || 10);
        const w = it.width || 0;
        // Tekst-ruimte-rect (baseline linksonder) → viewport-rect linksboven,
        // via de viewport zodat ook geroteerde pagina's kloppen.
        const [vx1, vy1, vx2, vy2] = vp.convertToViewportRectangle([tx, ty, tx + w, ty + h]);
        return {
          str: it.str,
          x: tx,
          y: ty,
          height: h,
          rx: Math.min(vx1, vx2),
          ry: Math.min(vy1, vy2),
          rw: Math.abs(vx2 - vx1),
          rh: Math.abs(vy2 - vy1),
        };
      });
    // Kale paginanummer-regels ("4") wegfilteren: die verschuiven bij elke
    // herindeling van pagina's en vervuilen de lijst zonder inhoudelijke
    // betekenis.
    const lines = groupItemsIntoLineObjs(items).filter((l) => normalizeLine(l.text) !== String(p));
    pages.push({ page: p, lines });
  }
  return pages;
}

/**
 * Draai de tekstvergelijking tussen twee (in compare geopende) documenten.
 * @returns {Promise<Array>} diff-records (zie diffPageTexts).
 */
export async function runTextCompare(oldPath, newPath) {
  if (!oldPath || !newPath) return [];
  const key = `${oldPath}|${newPath}`;
  if (_resultCache.has(key)) return _resultCache.get(key);
  const [oldPages, newPages] = await Promise.all([
    _extractDocLines(oldPath),
    _extractDocLines(newPath),
  ]);
  // Tag met source zodat de view weet dat ratio/klikgedrag de tekst-variant is.
  const changes = diffPageTexts(oldPages, newPages).map((c) => ({ ...c, source: 'text' }));
  _resultCache.set(key, changes);
  while (_resultCache.size > _CACHE_MAX) {
    _resultCache.delete(_resultCache.keys().next().value);
  }
  return changes;
}

export function clearTextCompareCache() {
  _resultCache.clear();
}
