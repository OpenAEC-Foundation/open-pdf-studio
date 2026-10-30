import { PDFName } from 'pdf-lib';

// SHX-glyphs staan als vectoren in de pagina. Deze /Square bewaart alleen
// de doorzoekbare tekst; maak er geen bewerkbare vorm of nieuwe appearance van.
const SHX_TITLE = 'AutoCAD SHX Text';
const isShx = (subtype, title) => subtype === 'Square' && title === SHX_TITLE;

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
  return annotations.filter(isShxTextAnnotation).filter(a => a.rect?.length === 4).map(a => ({
    id: a.id, page: pageNum, type: 'comment', text: a.contentsObj?.str ?? a.contents ?? '',
    x: Math.min(a.rect[0], a.rect[2]) - (view?.[0] || 0),
    y: (view?.[3] || 0) - Math.max(a.rect[1], a.rect[3]),
    width: Math.abs(a.rect[2] - a.rect[0]), height: Math.abs(a.rect[3] - a.rect[1]),
  }));
}
