// Tekstmarkering (markeren, onderstrepen, doorhalen, kronkellijn) zoals de
// saver haar altijd schreef. De code komt ongewijzigd uit saver.js, zodat een
// test kan bewaken dat bestaande markeringen byte-gelijk blijven (#508); een
// doorhaling als tekstcorrectie gaat via saver/correction-dicts.js.
//
// `ann` is hier de annotatie NA remapAnnotationForRotatedPage: convertX en
// convertY kennen alleen de ongedraaide CropBox.

import { PDFString } from 'pdf-lib';
import { hexToColorArray } from '../../utils/colors.js';
import { pdfTextString } from './pdf-text.js';
import { computeAnnotFlags } from './utils.js';

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann
 * @param {{ convertX: (x:number)=>number, convertY: (y:number)=>number, opacity: number }} opties
 */
export function buildTextMarkupDict(context, ann, { convertX, convertY, opacity }) {
  // Text markup annotations
  const x1 = convertX(ann.x);
  const y1 = convertY(ann.y + ann.height);
  const x2 = convertX(ann.x + ann.width);
  const y2 = convertY(ann.y);

  // Build QuadPoints from rects if available, otherwise from bounding box
  let quadPoints;
  if (ann.rects && ann.rects.length > 0) {
    quadPoints = [];
    for (const r of ann.rects) {
      const qx1 = convertX(r.x);
      const qx2 = convertX(r.x + r.width);
      const qy1 = convertY(r.y + r.height);
      const qy2 = convertY(r.y);
      quadPoints.push(qx1, qy2, qx2, qy2, qx1, qy1, qx2, qy1);
    }
  } else {
    quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
  }

  // Map type to PDF subtype
  let markupSubtype = 'Highlight';
  if (ann.type === 'textStrikethrough') markupSubtype = 'StrikeOut';
  else if (ann.type === 'textUnderline') markupSubtype = 'Underline';
  else if (ann.type === 'textSquiggly') markupSubtype = 'Squiggly';

  return context.obj({
    Type: 'Annot',
    Subtype: markupSubtype,
    Rect: [x1, y1, x2, y2],
    QuadPoints: quadPoints,
    C: hexToColorArray(ann.fillColor || ann.color),
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    Contents: pdfTextString(ann.subject || ''),
    M: PDFString.of(new Date().toISOString()),
    F: computeAnnotFlags(ann)
  });
}
