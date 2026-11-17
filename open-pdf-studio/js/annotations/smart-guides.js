import {
  alignLeft,
  alignCenter,
  alignRight,
  alignTop,
  alignMiddle,
  alignBottom,
  distributeSpaceH,
  distributeSpaceV,
} from './alignment.js';

// Draw alignment guide lines on the canvas
export function drawAlignmentGuides(ctx, guides, canvasWidth, canvasHeight) {
  if (!guides) return;

  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);

  // Vertical guides (vertical lines)
  for (const x of guides.vertical) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }

  // Horizontal guides (horizontal lines)
  for (const y of guides.horizontal) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

// Multi-selection alignment operations
export function alignAnnotations(alignment) {
  const actions = {
    left: alignLeft,
    center: alignCenter,
    right: alignRight,
    top: alignTop,
    middle: alignMiddle,
    bottom: alignBottom,
    'distribute-h': distributeSpaceH,
    'distribute-v': distributeSpaceV,
  };
  actions[alignment]?.();
}
