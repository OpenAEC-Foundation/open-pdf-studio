// Opslaan van een meetvlak (measureArea) met zijn eigen schaal en zijdematen
// (GitHub #536).
//
// - Schaal (measureScale, eenheden per punt, in de lengte-eenheid van
//   measureUnit, of die van de pagina): een standaard /Measure-woordenboek
//   met /X (lengte), /D en /A (oppervlakte), geschreven door
//   writeDimensionMeasure in dimension-measure.js (#959). De lader leest dat
//   terug (loader/color-extraction.js en annotation-converter.js); een
//   schaal van de pagina is gemarkeerd met OPS_ScaleInherited en blijft de
//   pagina volgen.
// - Zijdematen: de sleutel OPS_EdgeLengths staat in saver/plattegrond-meta.js
//   bij de andere meetvlak-sleutels; de maten zelf komen in de appearance
//   (appearance-vectors.js, buildMeasureAreaAP). De /Rect moet ze omvatten,
//   anders knipt een andere lezer ze weg: meetvlakRect hieronder.

import { vlakRect } from './utils.js';
import { vlakZijden, zijdeLabel, zijdeLabelKader } from '../../annotations/vlak-zijden.js';

/**
 * De /Rect van een meetvlak: de omhullende van alle ringen (vlakRect) en,
 * met zijdematen, ook het vak van elke maat. `zijdeTeksten` is een lijst
 * { index, tekst } (measurement.js, vlakZijdeTeksten); `draaiing` de
 * paginarotatie in radialen, zoals de appearance hem gebruikt.
 */
export function meetvlakRect(ann, X, Y, zijdeTeksten, draaiing = 0) {
  const rect = vlakRect(ann, X, Y, 2);
  if (!Array.isArray(zijdeTeksten) || zijdeTeksten.length === 0) return rect;
  const tekstVan = new Map(zijdeTeksten.map((z) => [z.index, z.tekst]));
  const marge = 1;
  for (const zijde of vlakZijden(ann.points)) {
    const tekst = tekstVan.get(zijde.index);
    if (!tekst) continue;
    for (const p of zijdeLabelKader(zijdeLabel(zijde, { draaiing }), tekst)) {
      const px = X(p.x);
      const py = Y(p.y);
      rect[0] = Math.min(rect[0], px - marge);
      rect[1] = Math.min(rect[1], py - marge);
      rect[2] = Math.max(rect[2], px + marge);
      rect[3] = Math.max(rect[3], py + marge);
    }
  }
  return rect;
}
