// Eigen sleutels voor de plattegrond-eigenschappen van maten en meetvlakken.
//
//   OPS_DimNoUnit   true   maatlijn toont alleen het getal (dimShowUnit false)
//   OPS_DimOvershoot, OPS_DimExtGap, OPS_DimExtOvershoot   getal (mm papier)
//                          uitloop maatlijn, vrije afstand en doorloop hulplijn
//   OPS_DimOvershootEnds   /start | /end | /none: waar de uitloop komt
//   OPS_DimChain    tekst  id van de maatketting; OPS_DimRole /chain | /total
//   OPS_NoLabel     true   meetvlak zonder eigen label (measureShowLabel false)
//   OPS_RuimteZaad  [x y]  zaadpunt van een ruimte, in PDF-coördinaten
//   OPS_RuimteNaam  tekst  de naam van die ruimte
//
// Het zaadpunt is hoe `app_floorplan {action:"rooms", refresh:true}` een
// geplaatst ruimtevlak terugvindt; zonder deze sleutel was het na heropenen
// een los meetvlak. De lader leest ze in loader/plattegrond-meta.js.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';

/** Getalvelden van een maat en hun sleutel (papiermillimeters). */
export const MAAT_GETALLEN = Object.freeze([
  ['dimLineOvershootMm', 'OPS_DimOvershoot'],
  ['dimExtGapMm', 'OPS_DimExtGap'],
  ['dimExtOvershootMm', 'OPS_DimExtOvershoot'],
]);

/** Waar de uitloop van een maat komt (zie maatlijn-geometrie.js). */
export const EINDEN = Object.freeze(['both', 'start', 'end', 'none']);

/**
 * Zet de plattegrond-sleutels van `ann` op het annotatiewoordenboek.
 * `X`/`Y` rekenen app-coördinaten om naar PDF-coördinaten (zoals overal in
 * de saver). Geeft het aantal geschreven sleutels terug.
 */
export function schrijfPlattegrondMeta(annotDict, ann, context, X, Y) {
  if (!annotDict || !ann) return 0;
  let n = 0;
  const zet = (sleutel, waarde) => { annotDict.set(PDFName.of(sleutel), waarde); n++; };
  if (ann.type === 'measureDistance') {
    if (ann.dimShowUnit === false) zet('OPS_DimNoUnit', context.obj(true));
    // Uitloop en hulplijnen in papiermillimeters (maatlijn-geometrie.js).
    for (const [veld, sleutel] of MAAT_GETALLEN) {
      const v = ann[veld];
      if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
        zet(sleutel, context.obj(Math.max(0, Number(v))));
      }
    }
    if (EINDEN.includes(ann.dimOvershootEnds) && ann.dimOvershootEnds !== 'both') {
      zet('OPS_DimOvershootEnds', PDFName.of(ann.dimOvershootEnds));
    }
    // Welke ketting en welke rol: zo is een ketting na heropenen nog als
    // geheel te verlengen of in te korten.
    if (typeof ann.opsKettingId === 'string' && ann.opsKettingId) zet('OPS_DimChain', pdfTextString(ann.opsKettingId));
    if (ann.opsMaatRol === 'chain' || ann.opsMaatRol === 'total') zet('OPS_DimRole', PDFName.of(ann.opsMaatRol));
  }
  if (ann.type === 'measureArea') {
    if (ann.measureShowLabel === false) zet('OPS_NoLabel', context.obj(true));
    const z = ann.opsRuimteZaad;
    if (z && Number.isFinite(z.x) && Number.isFinite(z.y)) {
      zet('OPS_RuimteZaad', context.obj([X(z.x), Y(z.y)]));
    }
    if (typeof ann.opsRuimteNaam === 'string' && ann.opsRuimteNaam) {
      zet('OPS_RuimteNaam', pdfTextString(ann.opsRuimteNaam));
    }
  }
  return n;
}
