// Draw arrowhead at specified position. `hol`: a closed shape without a fill
// (PDF /LE without /IC): only its outline, drawn at the full line width so its
// mitred tip lands one line width past the geometric tip.
export function drawArrowheadOnCanvas(ctx, x, y, angle, size, style, { hol = false } = {}) {
  const halfAngle = Math.PI / 6; // 30 degrees
  const dunneRand = () => { if (!hol) ctx.lineWidth = Math.min(ctx.lineWidth, 1); };
  const vulEnOmlijn = () => { if (!hol) ctx.fill(); ctx.stroke(); };

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  ctx.beginPath();
  if (style === 'open' || style === 'stealth') {
    // Open arrow style - two lines; use round join to limit tip overshoot
    ctx.lineJoin = 'round';
    ctx.moveTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closed') {
    // Closed/filled arrow style - thin stroke so visual tip aligns with data endpoint
    dunneRand();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.closePath();
    vulEnOmlijn();
  } else if (style === 'diamond') {
    // Diamond style - thin stroke for filled shape
    dunneRand();
    const halfSize = size / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(-halfSize, -halfSize * 0.6);
    ctx.lineTo(-size, 0);
    ctx.lineTo(-halfSize, halfSize * 0.6);
    ctx.closePath();
    vulEnOmlijn();
  } else if (style === 'circle') {
    // Circle style - thin stroke for filled shape
    dunneRand();
    const radius = size / 3;
    ctx.arc(-radius, 0, radius, 0, 2 * Math.PI);
    vulEnOmlijn();
  } else if (style === 'openCircle') {
    // Open circle style - stroke only, no fill (used for dimension ticks)
    const radius = 4;
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (style === 'square') {
    // Square style - thin stroke for filled shape
    dunneRand();
    const halfSize = size / 3;
    ctx.rect(-size / 2 - halfSize, -halfSize, halfSize * 2, halfSize * 2);
    vulEnOmlijn();
  } else if (style === 'butt') {
    // Butt style - perpendicular line at the endpoint (like slash but thicker)
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  } else if (style === 'openReversed') {
    // Open arrow reversed - two lines pointing backward
    ctx.lineJoin = 'round';
    ctx.moveTo(size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closedReversed') {
    // Closed arrow reversed - filled triangle pointing backward
    dunneRand();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, -size * Math.tan(halfAngle));
    ctx.lineTo(size, size * Math.tan(halfAngle));
    ctx.closePath();
    vulEnOmlijn();
  } else if (style === 'slash') {
    // Slash style - perpendicular line
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Draw a dimension line ending with centering offsets for circle/diamond/square,
// transparent fill for those shapes, and 30° rotation for slash. `hol`: see
// drawArrowheadOnCanvas (a closed arrow without a fill).
export function drawDimensionLineEnding(ctx, x, y, angle, size, style, { hol = false } = {}) {
  if (style === 'none') return;
  let ox = x, oy = y, a = angle;
  const unfilled = style === 'circle' || style === 'diamond' || style === 'square' || style === 'openCircle';
  if (style === 'circle') {
    const r = size / 3;
    ox += Math.cos(angle) * r;
    oy += Math.sin(angle) * r;
  } else if (style === 'openCircle') {
    // openCircle is centered on the endpoint, no offset needed
  } else if (style === 'diamond' || style === 'square') {
    const off = size / 2;
    ox += Math.cos(angle) * off;
    oy += Math.sin(angle) * off;
  } else if (style === 'slash') {
    a = angle + Math.PI / 6;
  }
  const savedFill = ctx.fillStyle;
  if (unfilled) ctx.fillStyle = 'rgba(0,0,0,0)';
  drawArrowheadOnCanvas(ctx, ox, oy, a, size, style, { hol });
  if (unfilled) ctx.fillStyle = savedFill;
}

// Apply border style (dashed/dotted/solid and extended patterns) to canvas context
export function applyBorderStyle(ctx, borderStyle) {
  switch (borderStyle) {
    case 'dashed':
      ctx.setLineDash([3, 4]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 4]);
      break;
    case 'dash-dot':
      ctx.setLineDash([10, 8, 2, 8]);
      break;
    case 'dash-dot-dot':
      ctx.setLineDash([10, 8, 2, 8, 2, 8]);
      break;
    case 'long-dash':
      ctx.setLineDash([20, 10]);
      break;
    case 'long-dash-dot':
      ctx.setLineDash([20, 10, 2, 10]);
      break;
    case 'long-dash-dot-dot':
      ctx.setLineDash([20, 10, 2, 10, 2, 10]);
      break;
    default:
      ctx.setLineDash([]);
      break;
  }
}
