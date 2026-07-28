// Systeemraster — gedeelde canvas-tekenroutine.
//
// Gebruikt door annotations/rendering.js (definitieve weergave) én door de
// systeemraster-tool (live voorbeeld), zodat voorbeeld en eindresultaat per
// definitie identiek ogen. De geometrie komt ALTIJD uit buildSysteemraster()
// (annotations/systeemraster.js) — hier wordt alleen gestreept.

/**
 * Teken een systeemraster-geometrie op een 2D-context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom  Resultaat van buildSysteemraster().
 * @param {{strokeColor:string, lineWidth:number, tagColor?:string|null,
 *          showOrigin?:boolean}} style
 */
export function drawSysteemrasterGeom(ctx, geom, style) {
  if (!geom || !geom.contour) return;
  const stroke = style?.strokeColor || '#000000';
  const lw = Number(style?.lineWidth) > 0 ? Number(style.lineWidth) : 1;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);

  // Contour (gesloten) — de veldbegrenzing.
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(geom.contour[0].x, geom.contour[0].y);
  for (let i = 1; i < geom.contour.length; i++) {
    ctx.lineTo(geom.contour[i].x, geom.contour[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Rasterlijnen, strak geclipt op de contour (de clip zit al in de segs).
  ctx.beginPath();
  for (const l of geom.linesV) {
    for (const s of l.segs) {
      ctx.moveTo(l.x, s.a);
      ctx.lineTo(l.x, s.b);
    }
  }
  for (const l of geom.linesH) {
    for (const s of l.segs) {
      ctx.moveTo(s.a, l.y);
      ctx.lineTo(s.b, l.y);
    }
  }
  ctx.stroke();

  // Tag (plaatmaat "B×H"): blauwe klik-affordance bij selectie
  // (inline getalbewerking); anders de gewone lijnkleur.
  if (geom.tag) {
    const t = geom.tag;
    ctx.fillStyle = style?.tagColor || stroke;
    ctx.font = `${t.fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t.text, t.x, t.y);
  }

  ctx.restore();
}
