// Betonbalk — gedeelde canvas-tekenroutine.
//
// Gebruikt door annotations/rendering.js (definitieve weergave) én door de
// betonbalk-tool (live voorbeeld tijdens het klikken), zodat het voorbeeld en
// het eindresultaat per definitie identiek ogen. De geometrie komt ALTIJD uit
// buildBetonbalk() (annotations/betonbalk.js) — hier wordt alleen gestreept.
import { CENTERLINE_WIDTH_FACTOR } from '../betonbalk.js';

/**
 * Teken een betonbalk-geometrie op een 2D-context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom  Resultaat van buildBetonbalk().
 * @param {{strokeColor:string, lineWidth:number}} style
 */
export function drawBetonbalkGeom(ctx, geom, style) {
  if (!geom || !geom.edges) return;
  const stroke = style?.strokeColor || '#000000';
  const lw = Number(style?.lineWidth) > 0 ? Number(style.lineWidth) : 1;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // Randen + eindkappen (zelfde dash: de kap hoort bij de contour).
  ctx.lineWidth = lw;
  ctx.setLineDash(geom.styles?.edgeDash || []);
  ctx.beginPath();
  const trace = (pts) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  trace(geom.edges.left);
  trace(geom.edges.right);
  for (const c of geom.caps || []) {
    ctx.moveTo(c.x1, c.y1);
    ctx.lineTo(c.x2, c.y2);
  }
  ctx.stroke();

  // Hartlijn: dun; streep-punt bij 'doorgetrokken', doorgetrokken dun bij
  // 'gestippeld' (NL-conventie, zie betonbalkLineStyles).
  ctx.lineWidth = Math.max(0.3, lw * CENTERLINE_WIDTH_FACTOR);
  ctx.setLineDash(geom.styles?.centerDash || []);
  ctx.beginPath();
  trace(geom.center);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}
