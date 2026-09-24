// Rand en opvulling van de bewerk-editor van een tekstvlak.
//
// De editor moet de tekst op precies dezelfde breedte afbreken als het canvas
// (shapes.js drawTextboxContent), anders springt een woord dat op het canvas
// past tijdens het bewerken naar een tweede regel — en groeit het vak bij het
// afsluiten mee met die valse regel.
//
// Het canvas laat de tekst op één lijndikte van de rand beginnen en tekent de
// rand eroverheen. Een CSS-rand neemt met `box-sizing: border-box` óók ruimte
// in; rand plus een even grote opvulling maakte de editor twee lijndiktes
// smaller dan het canvas. Daarom hier: de opvulling is de tekstinzet van het
// canvas, en de rand is een schaduw aan de binnenkant, die geen ruimte kost.

import { hasStroke } from '../annotations/fill-utils.js';
import { textboxTekstInzet } from '../annotations/rendering/textbox-layout.js';

/**
 * De CSS voor rand en opvulling van de editor, in schermpixels.
 * @param {{ lineWidth?: number, strokeColor?: string }} ann
 * @param {number} scale
 */
export function editorVakOpmaak(ann, scale) {
  const randDikte = (ann.lineWidth ?? 1) * scale;
  const zichtbaar = hasStroke(ann.strokeColor) && randDikte > 0;
  return {
    border: 'none',
    'box-shadow': zichtbaar ? `inset 0 0 0 ${randDikte}px ${ann.strokeColor || '#000000'}` : 'none',
    padding: `${textboxTekstInzet(ann) * scale}px`,
  };
}
