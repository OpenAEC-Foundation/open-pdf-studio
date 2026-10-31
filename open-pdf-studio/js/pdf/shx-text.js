import { PDFName } from 'pdf-lib';

// SHX-glyphs staan als vectoren in de pagina. CAD-programma's leggen er per
// tekst een /Square overheen met alleen de doorzoekbare tekst in /Contents en
// een titel die eindigt op "SHX Text". Maak er geen bewerkbare vorm of nieuwe
// appearance van. Herkenning op het achtervoegsel: het voorvoegsel is de naam
// van het tekenpakket en hoort niet in deze code.
const SHX_TITEL = /(?:^|\s)SHX Text$/;
const isShx = (subtype, title) => subtype === 'Square' && typeof title === 'string' && SHX_TITEL.test(title);

export function isShxTextAnnotation(annotation) {
  return isShx(annotation?.subtype, annotation?.titleObj?.str ?? annotation?.title);
}

/** Dezelfde herkenning op het oorspronkelijke woordenboek tijdens opslaan. */
export function isShxTextDictionary(dict, context) {
  if (!dict?.get) return false;
  const get = (object, key) => context.lookup(object?.get?.(PDFName.of(key)));
  const subtype = get(dict, 'Subtype')?.toString();
  const title = get(dict, 'T')?.decodeText?.();
  return isShx(subtype?.slice(1), title);
}

/** Zoekrecords buiten doc.annotations: geen paneelregels, selectie of hit-tests. */
export function shxSearchAnnotations(annotations, pageNum, view) {
  if (!Array.isArray(annotations)) return [];
  return annotations.filter(isShxTextAnnotation).filter(a => a.rect?.length === 4).map(a => ({
    id: a.id, page: pageNum, type: 'comment', text: a.contentsObj?.str ?? a.contents ?? '',
    x: Math.min(a.rect[0], a.rect[2]) - (view?.[0] || 0),
    y: (view?.[3] || 0) - Math.max(a.rect[1], a.rect[3]),
    width: Math.abs(a.rect[2] - a.rect[0]), height: Math.abs(a.rect[3] - a.rect[1]),
  }));
}
