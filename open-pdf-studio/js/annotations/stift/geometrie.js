// Geometrie van stiften, zonder app-state.
//
// Een stift gebruikt per tekenwijze dezelfde velden als een bestaande vorm:
// een lijn `points` (zoals een polyline), een pijl `startX/startY/endX/endY`
// (zoals een lijn), een kruis `x/y/width/height` (zoals een rechthoek) en een
// punt `x/y` (het midden). Raken, grepen, vervormen, omhullende, snappen en
// paginarotatie hergebruiken daardoor de bestaande code: op die plekken zet
// `geometrieSoort(ann)` een stift om naar de soort waarvan hij de velden
// deelt. Alleen het punt heeft een eigen, kleine behandeling ('stiftPunt').

const NAAR_SOORT = Object.freeze({ lijn: 'polyline', pijl: 'line', kruis: 'box', punt: 'stiftPunt' });

/** De geometriesoort waarmee raken, grepen en vervormen een annotatie behandelen. */
export function geometrieSoort(ann) {
  if (ann?.type !== 'stift') return ann?.type;
  return NAAR_SOORT[ann.vorm] || 'polyline';
}

/** Midden van de omhullende van de geometrie (zonder lijndikte). */
export function stiftMidden(stift) {
  switch (stift.vorm) {
    case 'pijl': return [(stift.startX + stift.endX) / 2, (stift.startY + stift.endY) / 2];
    case 'punt': return [stift.x, stift.y];
    case 'kruis': return [stift.x + stift.width / 2, stift.y + stift.height / 2];
    default: {
      const pts = stift.points || [];
      if (!pts.length) return [0, 0];
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of pts) {
        x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
      }
      return [(x1 + x2) / 2, (y1 + y2) / 2];
    }
  }
}

/** Raakt (x, y) een punt-stift met symboolmaat `maatPt`? */
export function raaktStiftPunt(stift, x, y, tol, maatPt) {
  return Math.hypot(x - stift.x, y - stift.y) <= maatPt / 2 + tol;
}

/** Het vak van een punt-stift met symboolmaat `maatPt`. */
export function stiftPuntVak(stift, maatPt) {
  return { x: stift.x - maatPt / 2, y: stift.y - maatPt / 2, width: maatPt, height: maatPt };
}

/**
 * Houd `x/y/width/height` gelijk aan de geometrie, zoals bij een polyline en
 * een lijn: selectiekader, ruimtelijke index en klembord rekenen daarmee.
 * Een kruis met een negatieve maat (van rechtsonder naar linksboven
 * gesleept) wordt rechtgezet. Een punt heeft geen vak.
 */
export function synchroniseerVak(stift) {
  if (stift.vorm === 'lijn' && stift.points?.length) {
    const xs = stift.points.map((p) => p.x);
    const ys = stift.points.map((p) => p.y);
    stift.x = Math.min(...xs); stift.y = Math.min(...ys);
    stift.width = Math.max(...xs) - stift.x; stift.height = Math.max(...ys) - stift.y;
  } else if (stift.vorm === 'pijl') {
    stift.x = Math.min(stift.startX, stift.endX); stift.y = Math.min(stift.startY, stift.endY);
    stift.width = Math.abs(stift.endX - stift.startX); stift.height = Math.abs(stift.endY - stift.startY);
  } else if (stift.vorm === 'kruis') {
    if (stift.width < 0) { stift.x += stift.width; stift.width = -stift.width; }
    if (stift.height < 0) { stift.y += stift.height; stift.height = -stift.height; }
  }
  return stift;
}

/** Het punt `(x, y)` haaks gezet ten opzichte van `vorige` (Shift). */
export function haaksPunt(vorige, x, y) {
  return Math.abs(x - vorige.x) >= Math.abs(y - vorige.y) ? { x, y: vorige.y } : { x: vorige.x, y };
}
