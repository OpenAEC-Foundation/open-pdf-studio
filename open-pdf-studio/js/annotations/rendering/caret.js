// Tekenen van proefleescorrecties (#508) op het canvas.
//
// Het invoegteken heeft dezelfde vorm als zijn appearance in de PDF
// (pdf/saver/correction-dicts.js), zodat scherm, afdruk en miniaturen gelijk
// zijn. Kleur en doorzichtigheid zet drawAnnotation al op de context.
//
// Puur: alleen de meetkunde, geen DOM of app-state, zodat het in node te
// testen is.

import { caretGlyphPoints, normTextDir, quadCorners, quadMidline } from '../corrections/geometry.js';
import { CORRECTION_COLORS } from '../corrections/model.js';

/**
 * Vult het invoegteken in zijn vak, de top naar de bovenkant van de tekst.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,width:number,height:number,textDir?:number,intent?:string,color?:string}} annotation
 * @param {string} [color]  kleur na weergavefilters; anders die van de annotatie
 */
export function drawCaret(ctx, annotation, color) {
  const vak = { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height };
  if (!(vak.width > 0) || !(vak.height > 0)) return;
  const punten = caretGlyphPoints(vak, annotation.textDir ?? 0);
  ctx.beginPath();
  ctx.moveTo(punten[0].x, punten[0].y);
  for (let i = 1; i < punten.length; i++) ctx.lineTo(punten[i].x, punten[i].y);
  ctx.closePath();
  ctx.fillStyle = color || annotation.color
    || (annotation.intent === 'Replace' ? CORRECTION_COLORS.replace : CORRECTION_COLORS.insert);
  ctx.fill();
}

/**
 * De doorhaallijn door één tekstvak. Bij verticale tekst (textDir 90/270) de
 * middellijn van de quad, zoals in de appearance; anders horizontaal door het
 * midden, zoals altijd.
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} [textDir]
 * @returns {[{x:number,y:number},{x:number,y:number}]}
 */
export function strikeLine(rect, textDir) {
  const dir = normTextDir(textDir);
  if (dir === 90 || dir === 270) return quadMidline(quadCorners(rect, dir));
  const midY = rect.y + rect.height / 2;
  return [{ x: rect.x, y: midY }, { x: rect.x + rect.width, y: midY }];
}

/**
 * Kleur van de doorhaling van een vervanging: die van haar invoegteken. Zo
 * slaat de saver haar ook op (saveColor in corrections/model.js), en lezers
 * nemen /C van de groepsleider over. Geen vervanging: null (eigen kleur).
 * @param {object} annotation
 * @param {object[]} annotations  alle annotaties van het document
 */
export function replaceStrikeColor(annotation, annotations) {
  if (!annotation || annotation.type !== 'textStrikethrough' || annotation.inReplyTo == null
      || String(annotation.replyType || '').toLowerCase() !== 'group') return null;
  const ouder = (annotations || []).find((a) => a && a.id === annotation.inReplyTo);
  if (!ouder || ouder.type !== 'caret') return null;
  return ouder.color || CORRECTION_COLORS.replace;
}
