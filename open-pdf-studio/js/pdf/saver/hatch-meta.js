// Arceringsgegevens van een vlak: schrijven naar de annotatie en teruglezen.
//
// De arcering staat als lijnen in de appearance, zodat elke lezer hem toont.
// Om hem in de app te kunnen blijven bewerken moeten de parameters er ook als
// eigen sleutels bij: zonder die sleutels kent het model na heropenen geen
// arcering meer en schrijft de volgende save het vlak zonder arcering weg.

import { PDFName, PDFString } from 'pdf-lib';

/** Zet OPS_HatchPattern/Color/Scale/Angle op de annotatie (niets bij 'none'). */
export function schrijfHatchMeta(annotDict, ann, context) {
  if (!ann?.hatchPattern || ann.hatchPattern === 'none') return false;
  annotDict.set(PDFName.of('OPS_HatchPattern'), PDFString.of(ann.hatchPattern));
  if (ann.hatchColor) annotDict.set(PDFName.of('OPS_HatchColor'), PDFString.of(ann.hatchColor));
  if (ann.hatchScale != null) annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
  if (ann.hatchAngle != null) annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
  return true;
}

/** De arceringsvelden voor het annotatiemodel, uit de gelezen OPS_-sleutels. */
export function hatchUitExtra(extra, standaardKleur = '#000000') {
  const e = extra || {};
  return {
    hatchPattern: e.opsHatchPattern || 'none',
    hatchColor: e.opsHatchColor || standaardKleur,
    hatchScale: e.opsHatchScale ?? 100,
    hatchAngle: e.opsHatchAngle ?? 0,
  };
}
