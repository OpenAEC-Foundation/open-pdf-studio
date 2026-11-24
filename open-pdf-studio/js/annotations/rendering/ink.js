import { inkStrokes } from '../ink-strokes.js';
import { isGladdeInkt, inktGeometrie } from '../pressure-ink.js';
import { applyBorderStyle } from './decorations.js';

export function drawInk(ctx, annotation, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyBorderStyle(ctx, annotation.borderStyle);
  for (const stroke of inkStrokes(annotation)) {
    const geo = isGladdeInkt(stroke) ? inktGeometrie(stroke, {
      breedteFactor: stroke.lineWidth > 0 ? lineWidth / stroke.lineWidth : 1,
    }) : null;
    ctx.beginPath();
    if (geo?.variabel) {
      ctx.fillStyle = color;
      for (const ring of geo.ringen) {
        ring.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
      }
      ctx.fill('nonzero');
    } else {
      const points = geo?.punten ?? stroke.path;
      if (points.length === 1) {
        ctx.fillStyle = color;
        ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
}
