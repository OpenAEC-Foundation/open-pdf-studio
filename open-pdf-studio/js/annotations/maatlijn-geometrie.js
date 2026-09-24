// De lijnen van een maat: de maatlijn met zijn uitloop en de hulplijnen.
//
// Puur, zonder canvas: het scherm (rendering/measurements.js) en de
// opgeslagen appearance (saver/appearance-vectors.js) tekenen dezelfde lijnen.
//
// Bouwkundige maatvoering (#477):
//   - de maatlijn loopt een klein stukje (uitloop) voorbij de buitenste
//     hulplijnen, zodat er "een lijntje aan zit";
//   - een hulplijn begint een vrije afstand van het gemeten punt (het
//     wandvlak) en loopt een stukje door voorbij de maatlijn.
// Die maten zijn PAPIERmillimeters: ze schalen niet mee met de tekenschaal
// (2 mm is op 1:50 en op 1:100 dezelfde 5,67 pt op het blad).
//
// Velden op de annotatie (alle optioneel; zonder waarde blijft het oude beeld):
//   dimLineOvershootMm   uitloop van de maatlijn (mm papier)
//   dimOvershootEnds     'both' | 'start' | 'end' | 'none': waar de uitloop
//                        komt - in een ketting alleen aan het begin en het
//                        eind van de hele ketting
//   dimExtGapMm          vrije afstand tussen gemeten punt en hulplijn
//   dimExtOvershootMm    doorloop van de hulplijn voorbij de maatlijn

export const PT_PER_MM = 72 / 25.4;

/** Papiermillimeters naar paginapunten (onafhankelijk van de tekenschaal). */
export function papierMmNaarPt(mm) {
  const n = Number(mm);
  return Number.isFinite(n) && n > 0 ? n * PT_PER_MM : 0;
}

const isGetal = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * @param {object} o  de maat: startX/Y, endX/Y (maatlijn), leaderStartX/Y en
 *   leaderEndX/Y (gemeten punten), headSize, extension (oude aan/uit-uitloop)
 *   en de velden hierboven.
 * @returns {{ maatlijn: {x1,y1,x2,y2}, hulplijnen: Array<{x1,y1,x2,y2}> }}
 */
export function maatlijnGeometrie(o = {}) {
  const sx = o.startX, sy = o.startY, ex = o.endX, ey = o.endY;
  const hoek = Math.atan2(ey - sy, ex - sx);
  const dir = { x: Math.cos(hoek), y: Math.sin(hoek) };
  const perp = { x: -Math.sin(hoek), y: Math.cos(hoek) };
  const kop = Number(o.headSize) > 0 ? Number(o.headSize) : 12;

  // Uitloop van de maatlijn.
  let uitloop;
  if (isGetal(o.dimLineOvershootMm)) uitloop = papierMmNaarPt(o.dimLineOvershootMm);
  else uitloop = o.extension ? Math.max(9, kop * 0.9) : 0;
  const einden = o.dimOvershootEnds || 'both';
  const aanBegin = einden === 'both' || einden === 'start';
  const aanEind = einden === 'both' || einden === 'end';
  const maatlijn = {
    x1: sx - dir.x * (aanBegin ? uitloop : 0), y1: sy - dir.y * (aanBegin ? uitloop : 0),
    x2: ex + dir.x * (aanEind ? uitloop : 0), y2: ey + dir.y * (aanEind ? uitloop : 0),
  };

  // Hulplijnen: van het gemeten punt (met vrije afstand) tot voorbij de maatlijn.
  const hulplijnen = [];
  const heeftHulplijnen = Number.isFinite(o.leaderStartX) && Number.isFinite(o.leaderStartY)
    && Number.isFinite(o.leaderEndX) && Number.isFinite(o.leaderEndY);
  if (heeftHulplijnen) {
    const doorloop = isGetal(o.dimExtOvershootMm)
      ? papierMmNaarPt(o.dimExtOvershootMm)
      : Math.max(10, Math.sin(Math.PI / 6) * kop);
    const vrij = isGetal(o.dimExtGapMm) ? papierMmNaarPt(o.dimExtGapMm) : 0;
    for (const [lx, ly, mx, my] of [
      [o.leaderStartX, o.leaderStartY, sx, sy],
      [o.leaderEndX, o.leaderEndY, ex, ey],
    ]) {
      const kant = ((mx - lx) * perp.x + (my - ly) * perp.y) > 0 ? 1 : -1;
      const lengte = Math.hypot(mx - lx, my - ly);
      const v = lengte > 1e-9 ? { x: (mx - lx) / lengte, y: (my - ly) / lengte } : { x: 0, y: 0 };
      const af = Math.min(vrij, lengte);
      hulplijnen.push({
        x1: lx + v.x * af, y1: ly + v.y * af,
        x2: mx + perp.x * kant * doorloop, y2: my + perp.y * kant * doorloop,
      });
    }
  }
  return { maatlijn, hulplijnen };
}

/**
 * De geometrievelden van een measureDistance-annotatie, zoals scherm en
 * opslag ze aan maatlijnGeometrie geven. De oude schakelaar `dimExtension`
 * (standaard aan) zet ook een ingestelde uitloop uit.
 */
export function maatlijnVelden(ann = {}) {
  const uit = ann.dimExtension === false;
  return {
    startX: ann.startX, startY: ann.startY, endX: ann.endX, endY: ann.endY,
    leaderStartX: ann.leaderStartX, leaderStartY: ann.leaderStartY,
    leaderEndX: ann.leaderEndX, leaderEndY: ann.leaderEndY,
    headSize: ann.headSize || 12,
    extension: !uit,
    dimLineOvershootMm: uit ? 0 : ann.dimLineOvershootMm,
    dimOvershootEnds: ann.dimOvershootEnds,
    dimExtGapMm: ann.dimExtGapMm,
    dimExtOvershootMm: ann.dimExtOvershootMm,
  };
}

/**
 * Waar een tussenmaat van een ketting zijn uitloop krijgt: de eerste aan het
 * begin, de laatste aan het eind, een losse maat aan beide kanten en de
 * tussenliggende nergens (`dimOvershootEnds`).
 */
export function kettingEinden(i, aantal) {
  if (aantal <= 1) return 'both';
  if (i === 0) return 'start';
  if (i === aantal - 1) return 'end';
  return 'none';
}
