import { state } from '../core/state.js';
import { getAnnotationBounds } from '../core/state.js';

const SNAP_THRESHOLD = 6; // pixels

// Find alignment guides relative to other annotations
export function findAlignmentGuides(movingAnnotation, offsetX, offsetY) {
  const guides = { vertical: [], horizontal: [], snapX: null, snapY: null };
  const moving = getAnnotationBounds(movingAnnotation);
  if (!moving) return guides;

  // Apply offset to get the current moving position
  const mx = moving.x + offsetX;
  const my = moving.y + offsetY;
  const mCenterX = mx + moving.width / 2;
  const mCenterY = my + moving.height / 2;
  const mRight = mx + moving.width;
  const mBottom = my + moving.height;

  const pageAnnotations = state.annotations.filter(a =>
    a.page === state.currentPage && a !== movingAnnotation && !state.selectedAnnotations.includes(a)
  );

  for (const ann of pageAnnotations) {
    const b = getAnnotationBounds(ann);
    if (!b) continue;

    const bCenterX = b.x + b.width / 2;
    const bCenterY = b.y + b.height / 2;
    const bRight = b.x + b.width;
    const bBottom = b.y + b.height;

    // Vertical alignment checks (x-axis)
    checkSnap(mx, b.x, SNAP_THRESHOLD, guides, 'vertical', b.x, 'snapX', mx - moving.x - offsetX);
    checkSnap(mx, bRight, SNAP_THRESHOLD, guides, 'vertical', bRight, 'snapX', mx - moving.x - offsetX);
    checkSnap(mRight, b.x, SNAP_THRESHOLD, guides, 'vertical', b.x, 'snapX', mx - moving.x - offsetX - moving.width);
    checkSnap(mRight, bRight, SNAP_THRESHOLD, guides, 'vertical', bRight, 'snapX', mx - moving.x - offsetX - moving.width);
    checkSnap(mCenterX, bCenterX, SNAP_THRESHOLD, guides, 'vertical', bCenterX, 'snapX', mx - moving.x - offsetX - moving.width / 2);

    // Horizontal alignment checks (y-axis)
    checkSnap(my, b.y, SNAP_THRESHOLD, guides, 'horizontal', b.y, 'snapY', my - moving.y - offsetY);
    checkSnap(my, bBottom, SNAP_THRESHOLD, guides, 'horizontal', bBottom, 'snapY', my - moving.y - offsetY);
    checkSnap(mBottom, b.y, SNAP_THRESHOLD, guides, 'horizontal', b.y, 'snapY', my - moving.y - offsetY - moving.height);
    checkSnap(mBottom, bBottom, SNAP_THRESHOLD, guides, 'horizontal', bBottom, 'snapY', my - moving.y - offsetY - moving.height);
    checkSnap(mCenterY, bCenterY, SNAP_THRESHOLD, guides, 'horizontal', bCenterY, 'snapY', my - moving.y - offsetY - moving.height / 2);
  }

  return guides;
}

function checkSnap(movingVal, targetVal, threshold, guides, direction, guidePos, snapKey, snapOffset) {
  if (Math.abs(movingVal - targetVal) < threshold) {
    guides[direction].push(guidePos);
    if (guides[snapKey] === null) {
      guides[snapKey] = snapOffset;
    }
  }
}

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
  if (state.selectedAnnotations.length < 2) return;

  const annotations = state.selectedAnnotations;
  const bounds = annotations.map(a => getAnnotationBounds(a)).filter(Boolean);
  if (bounds.length < 2) return;

  const minX = Math.min(...bounds.map(b => b.x));
  const maxX = Math.max(...bounds.map(b => b.x + b.width));
  const minY = Math.min(...bounds.map(b => b.y));
  const maxY = Math.max(...bounds.map(b => b.y + b.height));

  annotations.forEach((ann, i) => {
    const b = bounds[i];
    if (!b) return;

    switch (alignment) {
      case 'left':
        ann.x = minX;
        break;
      case 'right':
        ann.x = maxX - b.width;
        break;
      case 'center':
        ann.x = (minX + maxX) / 2 - b.width / 2;
        break;
      case 'top':
        ann.y = minY;
        break;
      case 'bottom':
        ann.y = maxY - b.height;
        break;
      case 'middle':
        ann.y = (minY + maxY) / 2 - b.height / 2;
        break;
      case 'distribute-h': {
        // Distribute evenly horizontally
        if (annotations.length < 3) break;
        const sorted = [...annotations].sort((a, b2) => (a.x || 0) - (b2.x || 0));
        const totalWidth = sorted.reduce((s, a2) => s + (getAnnotationBounds(a2)?.width || 0), 0);
        const spacing = (maxX - minX - totalWidth) / (sorted.length - 1);
        let currentX = minX;
        sorted.forEach(a2 => {
          const ab = getAnnotationBounds(a2);
          a2.x = currentX;
          currentX += (ab?.width || 0) + spacing;
        });
        break;
      }
      case 'distribute-v': {
        if (annotations.length < 3) break;
        const sorted = [...annotations].sort((a, b2) => (a.y || 0) - (b2.y || 0));
        const totalHeight = sorted.reduce((s, a2) => s + (getAnnotationBounds(a2)?.height || 0), 0);
        const spacing = (maxY - minY - totalHeight) / (sorted.length - 1);
        let currentY = minY;
        sorted.forEach(a2 => {
          const ab = getAnnotationBounds(a2);
          a2.y = currentY;
          currentY += (ab?.height || 0) + spacing;
        });
        break;
      }
    }
  });
}
