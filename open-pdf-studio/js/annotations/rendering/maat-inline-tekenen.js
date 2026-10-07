// Een maat met het bijschrift in de lijn (dimTextPosition 'inline') op het
// scherm. De lijnstukken, punten en tekstplek komen uit
// annotations/maatlijn-inline.js, net als in de opgeslagen appearance
// (saver/appearance-vectors.js, buildInlineMaatAP). Zonder canvas-eigen
// toestand: de aanroeper zet lijnkleur, lijndikte en doorzichtigheid.

import { drawDimensionLineEnding } from './decorations.js';
import { maatlijnGeometrie } from '../maatlijn-geometrie.js';
import { inlineMaatlijn, helveticaBreedte, HOOFDLETTER_HOOGTE } from '../maatlijn-inline.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o  de maat: startX/Y, endX/Y, leaderStartX/Y, leaderEndX/Y,
 *   startHead, endHead, headSize, headFill, lineWidth (model), color,
 *   labelColor, fontSize, measureText (de getoonde tekst), textOffsetX/Y,
 *   extension en de dim*-velden van maatlijn-geometrie.js.
 */
export function tekenInlineMaat(ctx, o) {
  const fs = Number(o.fontSize) > 0 ? Number(o.fontSize) : 11;
  const kop = Number(o.headSize) > 0 ? Number(o.headSize) : 12;
  const tekst = o.measureText || '';
  const geo = maatlijnGeometrie({
    startX: o.startX, startY: o.startY, endX: o.endX, endY: o.endY,
    leaderStartX: o.leaderStartX, leaderStartY: o.leaderStartY,
    leaderEndX: o.leaderEndX, leaderEndY: o.leaderEndY,
    headSize: kop, extension: o.extension, dimLineOvershootMm: o.dimLineOvershootMm,
    dimOvershootEnds: o.dimOvershootEnds, dimExtGapMm: o.dimExtGapMm, dimExtOvershootMm: o.dimExtOvershootMm,
  });
  if (geo.hulplijnen.length) {
    ctx.beginPath();
    for (const h of geo.hulplijnen) {
      ctx.moveTo(h.x1, h.y1);
      ctx.lineTo(h.x2, h.y2);
    }
    ctx.stroke();
  }
  const il = inlineMaatlijn({
    startX: o.startX, startY: o.startY, endX: o.endX, endY: o.endY,
    leaderStartX: o.leaderStartX, leaderStartY: o.leaderStartY,
    leaderEndX: o.leaderEndX, leaderEndY: o.leaderEndY,
    lineWidth: o.lineWidth, headSize: kop, startHead: o.startHead, endHead: o.endHead,
    tekstBreedte: helveticaBreedte(tekst, fs), fontSize: fs,
    tekstOffsetX: o.textOffsetX, tekstOffsetY: o.textOffsetY,
  });
  if (il.lijnstukken.length) {
    ctx.beginPath();
    for (const l of il.lijnstukken) {
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
    }
    ctx.stroke();
  }
  ctx.fillStyle = o.color;
  for (const k of il.koppen) {
    drawDimensionLineEnding(ctx, k.x, k.y, k.hoek, kop, k.stijl, { hol: o.headFill === false });
  }
  if (tekst) {
    // Midden van de hoofdletters op het tekstpunt (Arial = Helvetica-maten).
    ctx.save();
    ctx.translate(il.tekst.x, il.tekst.y);
    ctx.rotate(il.tekst.hoek);
    ctx.font = `${fs}px Arial`;
    ctx.fillStyle = o.labelColor || o.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(tekst, 0, fs * HOOFDLETTER_HOOGTE / 2);
    ctx.restore();
  }
}
