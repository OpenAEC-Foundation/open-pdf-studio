// Laden van proefleescorrecties (#508).
//
// pdf.js levert subtype, rect, color, contentsObj, it, inReplyTo ('16R') en
// replyType ('Group'). Het geeft geen /NM, /Subj, /Sy, /RD of eigen sleutels,
// en maakt van elke quad een assen-uitgelijnd vak; die gegevens komen uit
// extractAnnotationColors (`extra`, zie color-extraction.js). Bij een kind in
// een groep vervangt pdf.js /T, /C, /Contents en de datums door die van de
// ouder.
//
// Puur: geen DOM, geen app-state.

import { colorArrayToHex } from '../../utils/colors.js';
import { normTextDir, textDirFromVector } from '../../annotations/corrections/geometry.js';
import { CORRECTION_COLORS } from '../../annotations/corrections/model.js';

const alsPunt = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);

/**
 * Eigenschappen van een invoegteken (/Caret).
 * - Het vak is /Rect min /RD ([links, boven, rechts, onder]).
 * - text: de eigen /Contents (extra.ownContents, ook als kind in een groep),
 *   anders wat pdf.js geeft.
 * - textDir: (/OPS_TextDir + paginarotatie) mod 360. Zonder die sleutel
 *   ontbreekt hij (tekenen en opslaan lezen dan 0); resolveGroupLinks vult
 *   hem bij een vervanging aan uit de doorhaling.
 * - intent alleen uit pdf.js (annot.it): een /IT in `extra` kan van een buur
 *   met dezelfde /Rect zijn.
 * @param {object} annot  pdf.js-annotatie
 * @param {object} extra  uit extractAnnotationColors
 * @param {(r:number[])=>{x:number,y:number,width:number,height:number}} convertRect
 * @param {number} pageRot  viewport.rotation
 */
export function caretPropsFromPdf(annot, extra, convertRect, pageRot) {
  const e = extra || {};
  const r = annot.rect;
  let binnen = [r[0], r[1], r[2], r[3]];
  const rd = e.rd;
  if (Array.isArray(rd) && rd.length === 4 && rd.every(Number.isFinite)) {
    const vak = [r[0] + rd[0], r[1] + rd[3], r[2] - rd[2], r[3] - rd[1]];
    if (vak[2] > vak[0] && vak[3] > vak[1]) binnen = vak;
  }
  const box = convertRect(binnen);
  const intent = annot.it;
  const props = {
    type: 'caret',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    text: e.ownContents ?? annot.contentsObj?.str ?? annot.contents ?? '',
    symbol: e.sy === 'P' ? 'P' : 'None',
    color: colorArrayToHex(annot.color, intent === 'Replace' ? CORRECTION_COLORS.replace : CORRECTION_COLORS.insert),
  };
  if (Number.isFinite(e.opsTextDir)) props.textDir = normTextDir(e.opsTextDir + (pageRot || 0));
  if (intent) props.intent = intent;
  if (e.nm) props.nm = e.nm;
  if (e.subj) props.pdfSubject = e.subj;
  return props;
}

/**
 * Extra eigenschappen van een tekstmarkering (Highlight, Underline,
 * StrikeOut, Squiggly). Alleen wat het bestand heeft: een markering zonder
 * /IT, /NM, /Subj of eigen sleutels krijgt hooguit textDir.
 * - textDir uit /OPS_TextDir + paginarotatie; zonder die sleutel uit de rauwe
 *   quad (p1 -> p2 in de getoonde pagina), maar alleen bij een correctie (een
 *   /IT of een /RT /Group-antwoord). Eerdere app-versies schreven op
 *   gedraaide pagina's een vaste volgorde zonder /IT; bij een kort woord is
 *   die niet van de leesrichting te onderscheiden.
 * - intent alleen uit pdf.js (annot.it), zoals bij het invoegteken.
 * - lineWidth alleen uit de eigen sleutel /OPS_LineWidth (#527); een /BS van
 *   een ander programma telt niet, zodat zo'n bestand laadt als voorheen.
 * @param {(x:number,y:number)=>number[]|{x:number,y:number}} convertPoint
 */
export function textEditPropsFromPdf(annot, extra, convertPoint, pageRot) {
  const e = extra || {};
  const props = {};
  const intent = annot.it;
  if (intent) props.intent = intent;
  if (e.nm) props.nm = e.nm;
  if (e.subj) props.pdfSubject = e.subj;
  if (typeof e.opsMarkedText === 'string' && e.opsMarkedText) props.markedText = e.opsMarkedText;
  if (Number.isFinite(e.opsLineWidth) && e.opsLineWidth > 0) props.lineWidth = e.opsLineWidth;
  if (Number.isFinite(e.opsTextDir)) {
    props.textDir = normTextDir(e.opsTextDir + (pageRot || 0));
    return props;
  }
  // Eerdere app-versies schreven geen /IT of /IRT op markeringen; hun vaste
  // quadvolgorde is bij korte woorden niet van tekstrichting te onderscheiden.
  if (!intent && !(annot.inReplyTo && annot.replyType === 'Group')) return props;
  const q = e.rawQuadPoints;
  if (Array.isArray(q) && q.length >= 8 && q.slice(0, 8).every(Number.isFinite)) {
    // Bij een correctie is p1 -> p2 de leesrichting, ook als het woord korter
    // is dan de regel hoog.
    if (Math.hypot(q[2] - q[0], q[3] - q[1]) > 0) {
      const a = alsPunt(convertPoint(q[0], q[1]));
      const b = alsPunt(convertPoint(q[2], q[3]));
      const richting = textDirFromVector(b.x - a.x, b.y - a.y);
      if (richting !== null) props.textDir = richting;
    }
  }
  return props;
}

/**
 * Koppelt vervangingen na het omzetten van een pagina. Alleen een paar van
 * invoegteken en doorhaling op dezelfde pagina, in beide richtingen in het
 * bestand. In het model is het invoegteken altijd de ouder: de doorhaling
 * krijgt inReplyTo = id van het invoegteken en replyType 'group', beide
 * hetzelfde groupId, en het invoegteken intent 'Replace'. Andere groepen
 * blijven ongekoppeld, zoals voorheen.
 * @param {Array<{converted: object, inReplyTo: string, replyType: string}>} queue
 * @param {Map<string, object>} byPdfId  pdf.js-id ('16R') -> omgezette annotatie
 * @returns {number} aantal gekoppelde paren
 */
export function resolveGroupLinks(queue, byPdfId) {
  let aantal = 0;
  for (const item of queue || []) {
    const { converted, inReplyTo, replyType } = item || {};
    if (!converted || replyType !== 'Group' || !inReplyTo) continue;
    const ander = byPdfId?.get(inReplyTo);
    if (!ander || ander === converted || ander.page !== converted.page) continue;
    let karet;
    let door;
    if (ander.type === 'caret' && converted.type === 'textStrikethrough') {
      karet = ander; door = converted;
    } else if (ander.type === 'textStrikethrough' && converted.type === 'caret') {
      karet = converted; door = ander;
    } else {
      continue;
    }
    const groep = karet.groupId || karet.id;
    karet.groupId = groep;
    door.groupId = groep;
    door.inReplyTo = karet.id;
    door.replyType = 'group';
    delete karet.inReplyTo;
    delete karet.replyType;
    karet.intent = 'Replace';
    // Zonder eigen /OPS_TextDir volgt het invoegteken de tekst van zijn doorhaling.
    if (karet.textDir === undefined && door.textDir !== undefined) karet.textDir = door.textDir;
    aantal++;
  }
  return aantal;
}
