import { getActiveDocument, getAnnotationBounds } from '../core/state.js';
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

  const doc = getActiveDocument();
  const _sgSel = doc ? doc.selectedAnnotations : [];
  const pageAnnotations = (doc?.annotations || []).filter(a =>
    a.page === (doc?.currentPage || 1) && a !== movingAnnotation && !_sgSel.includes(a)
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
