/**
 * Stretch-geometrie (AutoCAD STRETCH) — puur, zonder state/DOM.
 *
 * Het gereedschap laat de gebruiker een selectieruit (crossing window)
 * tekenen. Alle HOEKPUNTEN die in die ruimte vallen, bewegen mee met de
 * sleper; de rest blijft staan. Dat is precies het gedrag van AutoCAD's
 * STRETCH: de rechterrand van een rechthoek verlengen blijft rechts, de
 * linkerrand blijft staan.
 *
 *   verticesOf(ann)                         → de tikbare punten van een vorm
 *   stretchAnnotation(orig, doel, dx, dy, inRuit)
 *                                           → schrijft de uitgerekte geometrie
 *                                             in `doel` (een clone van `orig`)
 *
 * `inRuit(p)` test de OORSPRONKELijke positie van een hoekpunt — het venster
 * ligt vast zodra de gebruiker loslaat, alleen de verplaatsing beweegt.
 */

const _fin = (v) => Number.isFinite(v);

export function isLineAnnotation(ann) {
  return !!ann && _fin(ann.startX) && _fin(ann.startY) && _fin(ann.endX) && _fin(ann.endY);
}

export function isRectAnnotation(ann) {
  return !!ann && _fin(ann.x) && _fin(ann.y) && _fin(ann.width) && _fin(ann.height);
}

const MIN_MAAT = 0.5;

/**
 * Alle tikbare punten van een annotatie (in tekenvolgorde).
 * @returns {{x:number,y:number}[]}
 */
export function verticesOf(ann) {
  if (!ann) return [];
  if (isLineAnnotation(ann)) {
    return [{ x: ann.startX, y: ann.startY }, { x: ann.endX, y: ann.endY }];
  }
  if (Array.isArray(ann.points) && ann.points.length > 0) {
    return ann.points.map((p) => ({ x: p.x, y: p.y }));
  }
  if (Array.isArray(ann.path) && ann.path.length > 0) {
    return ann.path.map((p) => ({ x: p.x, y: p.y }));
  }
  if (isRectAnnotation(ann)) {
    return [
      { x: ann.x, y: ann.y },
      { x: ann.x + ann.width, y: ann.y },
      { x: ann.x, y: ann.y + ann.height },
      { x: ann.x + ann.width, y: ann.y + ann.height },
    ];
  }
  if (_fin(ann.x) && _fin(ann.y)) return [{ x: ann.x, y: ann.y }];
  return [];
}

/** Of deze annotatie met stretch-geometrie te bewerken is. */
export function canStretch(ann) {
  return verticesOf(ann).length > 0;
}

/**
 * Pas de geometrie van `doel` toe met (dx,dy) voor elk hoekpunt waarvan de
 * ORIGINELE positie aan `inRuit` voldoet.
 *
 * @param {object} orig   onveranderde bron (clone)
 * @param {object} doel   annotatie die wordt bijgewerkt (mag `orig` zijn)
 * @param {number} dx     verplaatsing x in pagina-punten
 * @param {number} dy     verplaatsing y in pagina-punten
 * @param {(p:{x:number,y:number})=>boolean} inRuit
 * @returns {boolean} of er geometrie is bijgewerkt
 */
export function stretchAnnotation(orig, doel, dx, dy, inRuit) {
  if (!orig || !doel) return false;

  if (isLineAnnotation(orig)) {
    if (inRuit({ x: orig.startX, y: orig.startY })) {
      doel.startX = orig.startX + dx;
      doel.startY = orig.startY + dy;
    } else {
      doel.startX = orig.startX;
      doel.startY = orig.startY;
    }
    if (inRuit({ x: orig.endX, y: orig.endY })) {
      doel.endX = orig.endX + dx;
      doel.endY = orig.endY + dy;
    } else {
      doel.endX = orig.endX;
      doel.endY = orig.endY;
    }
    return true;
  }

  if (Array.isArray(orig.points) && orig.points.length > 0) {
    doel.points = orig.points.map((p) => (inRuit(p)
      ? { x: p.x + dx, y: p.y + dy }
      : { x: p.x, y: p.y }));
    if (isRectAnnotation(orig)) _updateBbox(doel);
    return true;
  }

  if (Array.isArray(orig.path) && orig.path.length > 0) {
    doel.path = orig.path.map((p) => (inRuit(p)
      ? { x: p.x + dx, y: p.y + dy }
      : { x: p.x, y: p.y }));
    if (isRectAnnotation(orig)) _updateBbox(doel);
    return true;
  }

  if (isRectAnnotation(orig)) {
    // Vier hoeken: wie in de ruimte zit verhuist, wie niet zit blijft op de
    // oude plek; de bbox volgt uit het resultaat. Zo verandert alleen de rand
    // die je hebt gepakt (of het hele object als alle hoeken meegaan).
    // Let op: een 'circle' die alleen aan één kant wordt uitgerekt wordt een
    // ellipse — dat is exact wat "uitrekken" betekent.
    const hoeken = [
      { x: orig.x, y: orig.y },
      { x: orig.x + orig.width, y: orig.y },
      { x: orig.x, y: orig.y + orig.height },
      { x: orig.x + orig.width, y: orig.y + orig.height },
    ].map((p) => (inRuit(p) ? { x: p.x + dx, y: p.y + dy } : p));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of hoeken) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    doel.x = minX;
    doel.y = minY;
    doel.width = Math.max(MIN_MAAT, maxX - minX);
    doel.height = Math.max(MIN_MAAT, maxY - minY);
    return true;
  }

  if (_fin(orig.x) && _fin(orig.y)) {
    if (inRuit({ x: orig.x, y: orig.y })) {
      doel.x = orig.x + dx;
      doel.y = orig.y + dy;
    } else {
      doel.x = orig.x;
      doel.y = orig.y;
    }
    return true;
  }

  return false;
}

/** Omtrek-velden (x/y/width/height) opnieuw afleiden uit de puntenreeks. */
function _updateBbox(doel) {
  const punten = doel.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of punten) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return;
  doel.x = minX;
  doel.y = minY;
  doel.width = Math.max(MIN_MAAT, maxX - minX);
  doel.height = Math.max(MIN_MAAT, maxY - minY);
}
