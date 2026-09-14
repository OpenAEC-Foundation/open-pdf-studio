import { drawDimensionLineEnding } from './decorations.js';
import { applyHatchFillPolygon } from './hatch-patterns.js';
import { arcControlPoint } from '../measurement.js';

/**
 * Trace a polygon path on the canvas context, supporting arc segments.
 * Points with `arc: true` are drawn as quadratic bezier curves; others as straight lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} points - polygon vertices, some may have .arc and .bulge
 * @param {boolean} close - whether to closePath
 * @param {boolean} newPath - start a fresh path (default). Pass false to ADD
 *   this polygon as a sub-path of the current path — required when combining
 *   an outer contour with hole contours for one evenodd fill; beginPath()
 *   here would wipe the outer contour and the fill would paint ONLY the
 *   holes (inverted donut).
 */
function _tracePolygonPath(ctx, points, close, newPath = true) {
  if (newPath) ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (points[i].arc) {
      const cp = arcControlPoint(points[i - 1], points[i]);
      ctx.quadraticCurveTo(cp.x, cp.y, points[i].x, points[i].y);
    } else {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }
  if (close) {
    // The closing segment from last point back to first
    if (points[0].arc) {
      const cp = arcControlPoint(points[points.length - 1], points[0]);
      ctx.quadraticCurveTo(cp.x, cp.y, points[0].x, points[0].y);
    }
    ctx.closePath();
  }
}

// Draw a complete dimension annotation (extension lines, dimension line, endings, label)
export function drawDimension(ctx, opts) {
  const {
    startX, startY, endX, endY,
    leaderStartX, leaderStartY, leaderEndX, leaderEndY,
    startHead = 'openCircle', endHead = 'openCircle', headSize = 12,
    color, measureText, fontSize, extension,
    textOffsetX = 0, textOffsetY = 0
  } = opts;

  const mdAngle = Math.atan2(endY - startY, endX - startX);
  const hasLeaders = leaderStartX !== undefined && leaderStartY !== undefined;

  if (hasLeaders) {
    // Extension lines with overshoot past dimension line
    const perpDx = -Math.sin(mdAngle);
    const perpDy = Math.cos(mdAngle);
    const lsDx = startX - leaderStartX;
    const lsDy = startY - leaderStartY;
    const leaderDir = (lsDx * perpDx + lsDy * perpDy) > 0 ? 1 : -1;
    const overshoot = Math.max(10, Math.sin(Math.PI / 6) * headSize);
    const extDx = perpDx * overshoot * leaderDir;
    const extDy = perpDy * overshoot * leaderDir;

    ctx.beginPath();
    ctx.moveTo(leaderStartX, leaderStartY);
    ctx.lineTo(startX + extDx, startY + extDy);
    ctx.moveTo(leaderEndX, leaderEndY);
    ctx.lineTo(endX + extDx, endY + extDy);
    ctx.stroke();
  }

  // Dimension line. With `extension` on, the line sticks out past both
  // extension lines (NL drafting style).
  const extLen = extension ? Math.max(9, headSize * 0.9) : 0;
  const dirX = Math.cos(mdAngle);
  const dirY = Math.sin(mdAngle);
  ctx.beginPath();
  ctx.moveTo(startX - dirX * extLen, startY - dirY * extLen);
  ctx.lineTo(endX + dirX * extLen, endY + dirY * extLen);
  ctx.stroke();

  // Line endings
  ctx.fillStyle = color;
  if (startHead !== 'none') {
    drawDimensionLineEnding(ctx, startX, startY, mdAngle + Math.PI, headSize, startHead);
  }
  if (endHead !== 'none') {
    drawDimensionLineEnding(ctx, endX, endY, mdAngle, headSize, endHead);
  }

  // Measurement label
  if (measureText) {
    drawDimensionLabel(ctx, startX, startY, endX, endY, measureText, color, fontSize, textOffsetX, textOffsetY);
  }
}

// Draw a measurement label along a dimension line direction.
// `fontSize` is the text height in page units (PDF points); defaults to the
// legacy 11px when the annotation predates dimension types.
// `offsetX`/`offsetY` displace the text anchor from the dimension-line
// midpoint (user-dragged label position); default 0,0 keeps it on the line.
export function drawDimensionLabel(ctx, startX, startY, endX, endY, text, color, fontSize, offsetX = 0, offsetY = 0) {
  const midX = (startX + endX) / 2 + offsetX;
  const midY = (startY + endY) / 2 + offsetY;
  let textAngle = Math.atan2(endY - startY, endX - startX);
  // Keep text readable (not upside-down)
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  else if (textAngle < -Math.PI / 2) textAngle += Math.PI;
  const fs = fontSize || 11;
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(textAngle);
  ctx.font = `${fs}px Arial`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  // Gap between dimension line and text scales with the text height.
  ctx.fillText(text, 0, -Math.max(3, fs * 0.35));
  ctx.restore();
}

// Draw a measurement polygon (area) with outline and optional fill, supporting holes (cutouts)
// hatchOpts: optional { pattern, color, scale, angle } for hatch fill
// fillAlpha: optional override for just the interior fill's globalAlpha
// (border/hatch keep whatever alpha the caller already had set). Used by
// the Filled Area sketch preview so the shape stays see-through while
// tracing over the page, without touching the final saved opacity.
export function drawMeasureAreaShape(ctx, points, color, lineWidth, fillColor, borderStyle, holes, hatchOpts, fillAlpha) {
  // Use actual border style from annotation; default to dashed for backwards compat
  if (borderStyle === 'dashed') {
    ctx.setLineDash([4, 2]);
  } else if (borderStyle === 'dotted') {
    ctx.setLineDash([2, 2]);
  } else if (borderStyle) {
    // 'solid' or other explicit styles → solid line
    ctx.setLineDash([]);
  } else {
    // No borderStyle specified (created in this app) → dashed default
    ctx.setLineDash([4, 2]);
  }

  // Build combined path: outer polygon + hole sub-paths (arc-aware)
  _tracePolygonPath(ctx, points, true);

  // Add hole sub-paths to the SAME path (newPath=false) so the evenodd fill
  // below cuts them out instead of filling only the last-traced hole.
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        _tracePolygonPath(ctx, hole, true, false);
      }
    }
  }

  // Fill using even-odd rule so holes appear as cutouts
  const _doFill = () => {
    if (fillColor && fillColor !== 'none' && fillColor !== 'transparent') {
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');
    } else if (!fillColor) {
      // No fill specified (created in this app) → semi-transparent default
      ctx.fillStyle = color + '20';
      ctx.fill('evenodd');
    }
    // fillColor === 'none' or 'transparent' → no fill
  };
  if (fillAlpha != null) {
    const _prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = fillAlpha;
    _doFill();
    ctx.globalAlpha = _prevAlpha;
  } else {
    _doFill();
  }

  // Apply hatch fill pattern (default: diagonal-left red at 45°)
  if (hatchOpts && hatchOpts.pattern && hatchOpts.pattern !== 'none') {
    applyHatchFillPolygon(ctx, points, holes, hatchOpts.pattern, hatchOpts.color || color, hatchOpts.scale, hatchOpts.angle);
  }

  // Rebuild outer path for stroke (hatch clip destroys the current path)
  _tracePolygonPath(ctx, points, true);

  // Stroke outer boundary
  ctx.stroke();

  // Stroke hole boundaries separately
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        _tracePolygonPath(ctx, hole, true);
        ctx.stroke();
      }
    }
  }

  ctx.setLineDash([]);
}

// Draw a measurement label at the centroid of a set of points (or at labelX/labelY override)
// annotation (optional): if provided, reads labelX/labelY for position override and measureName for name label
export function drawCentroidLabel(ctx, points, text, color, annotation) {
  // Compute centroid as default position
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  // Use absolute label position if set on the annotation
  const lx = (annotation && annotation.labelX != null) ? annotation.labelX : cx;
  const ly = (annotation && annotation.labelY != null) ? annotation.labelY : cy;

  const hasName = annotation && annotation.measureName;
  const nameFont = 'bold 12px Arial';
  const valueFont = '11px Arial';
  const pad = 3;

  // Measure text widths to compute background size
  ctx.font = valueFont;
  const valueWidth = ctx.measureText(text).width;
  let nameWidth = 0;
  if (hasName) {
    ctx.font = nameFont;
    nameWidth = ctx.measureText(annotation.measureName).width;
  }
  const bgWidth = Math.max(nameWidth, valueWidth) + pad * 2;
  const lineHeight = hasName ? 14 : 0;
  const bgHeight = 13 + lineHeight + pad * 2;
  const bgX = lx - bgWidth / 2;
  const bgY = ly - 11 - lineHeight - pad;

  // Draw white background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

  // Draw text
  ctx.textAlign = 'center';
  ctx.fillStyle = color;

  if (hasName) {
    ctx.font = nameFont;
    ctx.fillText(annotation.measureName, lx, ly - 14);
  }

  ctx.font = valueFont;
  ctx.fillText(text, lx, ly);
  ctx.textAlign = 'left';
}

// Draw a measurement polyline (perimeter) with outline and vertex markers
export function drawMeasurePerimeterShape(ctx, points, color, borderStyle) {
  if (borderStyle === 'dashed') {
    ctx.setLineDash([4, 2]);
  } else if (borderStyle === 'dotted') {
    ctx.setLineDash([2, 2]);
  } else if (borderStyle) {
    ctx.setLineDash([]);
  } else {
    ctx.setLineDash([4, 2]);
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
