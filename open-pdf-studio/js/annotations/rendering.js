import { state, getActiveDocument, getPageRotation, imageCache } from '../core/state.js';
import { annotationCanvas, annotationCtx, textHighlightCanvas, textHighlightCtx } from '../ui/dom-elements.js';
import { updateStatusAnnotations } from '../ui/chrome/status-bar.js';
import { updateAnnotationsList } from '../ui/panels/annotations-list.js';
import { renderWatermarksBehind, renderWatermarksInFront } from '../watermark/watermark-renderer.js';

// Import from sub-modules
import { drawPolygonShape, drawCloudShape, buildPolygonPath, buildPolygonPointsPath, buildCloudPath, buildCloudPolylinePath, drawTextboxContent, isRTLText } from './rendering/shapes.js';
import { drawArrowheadOnCanvas, applyBorderStyle, drawDimensionLineEnding } from './rendering/decorations.js';
import { catmullRomSpline } from '../tools/tools/spline-tool.js';
import { catmullRomToBezier, splineArrowEndTangent } from './spline-arrow-geometry.js';
import { drawDimension, drawMeasureAreaShape, drawCentroidLabel, drawMeasurePerimeterShape } from './rendering/measurements.js';
import { applyHatchFill, applyHatchFillPolygon } from './rendering/hatch-patterns.js';
import { drawWall } from './rendering/walls.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { drawSelectionHandles } from './rendering/selection.js';
import { drawImageCropOverlay } from './image-crop-overlay.js';
import { drawEmbeddedImageOverlay } from '../tools/tools/remove-image-tool.js';
import { updateQuickAccessButtons, updateContextualTabs, drawGrid, snapToGrid } from './rendering/ui-state.js';
import { drawCommentIcon } from './rendering/comment-icons.js';
import { spatialIndex } from './spatial-index.js';
import { invalidateScaleRegionCache, pixelsPerUnitFor, getRegionScaleFactor } from './scale-region.js';
import { drawSnapIndicator } from '../tools/snap-engine.js';
import { drawImageAlignGuides } from '../tools/image-align-snap.js';
import { getTemplate } from '../symbols/registry.js';
import { hasFill } from './fill-utils.js';
import { hiddenTypes as evHiddenTypes, halftoneTypes as evHalftoneTypes } from '../solid/stores/elementVisibilityStore.js';
import { getPageRotationMatrix } from '../text/text-edit-appearance.js';

// Re-export everything that external code needs
export { drawPolygonShape, drawCloudShape, buildPolygonPath, buildCloudPath } from './rendering/shapes.js';

// Thumbnail-cache voor scheduleTable-beeldcellen: data-URL → HTMLImageElement.
// Klein en gedeeld; bij eerste laden triggeren we één redraw zodat de reeds
// gedecodeerde thumbnail meteen verschijnt (performant: geen her-decode).
const _scheduleThumbCache = new Map();
function getScheduleThumb(url) {
  if (!url) return null;
  const hit = _scheduleThumbCache.get(url);
  if (hit) return hit.complete ? hit : null;
  const img = new Image();
  _scheduleThumbCache.set(url, img);
  img.onload = () => { try { redrawAnnotations(); } catch (_) {} };
  img.src = url;
  return null;
}

// Puff-maat (koorde in pt) voor wolkranden op basis van de /BE-intensiteit:
// I<=1 = "kleine wolk", anders "grote wolk" (kalibratie op externe editors).
function cloudPuffSize(annotation) {
  return (annotation.cloudIntensity !== undefined && annotation.cloudIntensity <= 1) ? 9 : 15;
}
export { updateQuickAccessButtons, snapToGrid } from './rendering/ui-state.js';

// Blender-style 2D cursor marker — red/white dashed circle + crosshair,
// drawn at constant SCREEN size (sizes divided by the current scale).
// ctx is in app-coord space.
function _draw2DCursor(ctx, x, y, screenScale) {
  const s = 1 / Math.max(screenScale || 1, 0.0001);
  const r = 7 * s;
  const armIn = 4 * s;
  const armOut = 14 * s;
  ctx.save();
  // White base circle with red dashes on top (the classic look)
  ctx.lineWidth = 1.8 * s;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#d62b2b';
  ctx.setLineDash([3.2 * s, 3.2 * s]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Crosshair: dark lines on a white halo for contrast on any background
  const cross = (lw, color) => {
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - armOut, y); ctx.lineTo(x - armIn, y);
    ctx.moveTo(x + armIn, y); ctx.lineTo(x + armOut, y);
    ctx.moveTo(x, y - armOut); ctx.lineTo(x, y - armIn);
    ctx.moveTo(x, y + armIn); ctx.lineTo(x, y + armOut);
    ctx.stroke();
  };
  cross(2.6 * s, '#ffffff');
  cross(1.2 * s, '#1a1a1a');
  ctx.restore();
}

// Inline polar-ray + tooltip drawer (kept here to avoid an import cycle
// with snap-engine.js).  ctx is in app-coord space.
function _drawPolarOverlay(ctx, snapResult, scale) {
  if (!snapResult || snapResult.type !== 'polar' || !snapResult.anchor) return;
  const ax = snapResult.anchor.x;
  const ay = snapResult.anchor.y;
  const angle = snapResult.angle;
  const length = snapResult.length;
  const lw = 0.75 / scale;
  const dash = 6 / scale;
  const extent = 50000;

  ctx.save();
  ctx.strokeStyle = '#cc66cc';
  ctx.lineWidth = lw;
  ctx.setLineDash([dash, dash]);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(ax - cosA * extent, ay - sinA * extent);
  ctx.lineTo(ax + cosA * extent, ay + sinA * extent);
  ctx.stroke();
  ctx.setLineDash([]);

  // Tooltip with angle + length
  let unit = 'px';
  let lenInUnits = length;
  try {
    // Lazy resolve to avoid hard cycle
    const ms = state._lastMeasureScale || null;
    if (ms && ms.pixelsPerUnit > 0) {
      lenInUnits = length / ms.pixelsPerUnit;
      unit = ms.unit || 'mm';
    }
  } catch (_) { /* ignore */ }
  const angleDeg = (angle * 180 / Math.PI + 360) % 360;
  const text = `Polar: ${angleDeg.toFixed(2)}° < ${lenInUnits.toFixed(2)} ${unit}`;
  const fontSize = 11 / scale;
  ctx.font = `${fontSize}px Arial`;
  const padX = 4 / scale;
  const padY = 3 / scale;
  const tw = ctx.measureText(text).width;
  const tx = snapResult.x + 12 / scale;
  const ty = snapResult.y + 12 / scale;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = '#cc66cc';
  ctx.lineWidth = 0.5 / scale;
  ctx.fillRect(tx - padX, ty - fontSize, tw + padX * 2, fontSize + padY * 2);
  ctx.strokeRect(tx - padX, ty - fontSize, tw + padX * 2, fontSize + padY * 2);
  ctx.fillStyle = '#552255';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, tx, ty);
  ctx.restore();
}

// Resolve line width:
// - width === 0 means "no border" (PDF spec) — return 0 untouched
// - Thin-lines view: clamp to max 1px
// - Normal view: respect the PDF-defined width with a tiny floor (0.5) so
//   a non-zero stroke stays visible.
// Additionally enforce a 1-screen-pixel minimum when zoomed below 100 %:
// a 1 pt app-space stroke at 35 % zoom resolves to ~0.35 screen-pixels,
// which the canvas anti-aliases into a near-invisible ghost. This is the
// user-visible cause of the "Line doesn't appear" report — the Line tool
// has no fill to fall back on, unlike Rectangle/Circle/Cloud whose fill
// keeps the shape visible even when the outline goes sub-pixel.
// On-screen (device-pixel) cap for stroke weight DURING an interactive
// drag/resize/G-transform. Chosen generously so ordinary line weights are
// untouched (they resolve below the cap) and only pathologically thick
// strokes — the ones that made dragging lag — are bounded while the gesture
// is in flight. Full weight is restored on the post-gesture repaint.
const DRAG_LOD_MAX_SCREEN_PX = 6;

function thinLw(width) {
  if (width === 0) return 0;
  if (state.preferences?.thinLines) {
    // Lineweight display OFF ('TL'): EVERYTHING renders as a true hairline —
    // exactly 1 screen pixel at any zoom (CAD LWDISPLAY off).
    const vp0 = window.__pdfViewport;
    const _d0 = state.documents[state.activeDocumentIndex];
    const s0 = (vp0 && vp0.active && _d0?.filePath) ? vp0.zoom : (_d0?.scale || 1);
    return s0 > 0 ? 1 / s0 : 1;
  }
  let lw = Math.max(width, 0.25);
  const vp = window.__pdfViewport;
  const _doc = state.documents[state.activeDocumentIndex];
  // Blank docs (no filePath) bypass the viewport singleton and use doc.scale.
  const scale = (vp && vp.active && _doc?.filePath)
    ? vp.zoom
    : (_doc?.scale || 1);
  if (scale > 0 && scale < 1) {
    const minAppPx = 1 / scale;          // 1 screen pixel in app-coords
    if (lw < minAppPx) lw = minAppPx;
  }
  // Interaction LOD (level-of-detail): while an annotation is being dragged,
  // resized or G-transformed, redrawAnnotations() re-strokes the whole overlay
  // on EVERY pointermove. The ONLY per-frame cost that grows with line weight
  // is the ctx.stroke() rasterisation itself — the filled area is
  // (length × width × scale²) device pixels, so a thick stroke at high zoom
  // makes each frame progressively more expensive (thin lines stay smooth,
  // thick ones visibly lag). During the interaction we therefore cap the
  // ON-SCREEN stroke to DRAG_LOD_MAX_SCREEN_PX device pixels: the geometry and
  // hit-testing are unchanged, only the drawn width is bounded so the fill
  // stays cheap. The very last repaint of the gesture runs with the drag flags
  // already cleared (see _finishDragResize in tool-dispatcher.js), so the final
  // on-screen result is the full, un-capped weight — the end view never changes.
  if (scale > 0 && (state.isDragging || state.isResizing || state.gMoveMode || state.gRotateMode)) {
    const maxAppPx = DRAG_LOD_MAX_SCREEN_PX / scale;   // cap expressed in app-coords
    if (lw > maxAppPx) lw = maxAppPx;
  }
  return lw;
}

// Pick the textbox edge whose midpoint is closest to (kx, ky).
// Returns { x, y, side } where side is 'top'|'right'|'bottom'|'left'.
export function pickAnchorSide(box, kx, ky) {
  const bx = box.x, by = box.y;
  const bw = box.width || 150, bh = box.height || 50;
  const candidates = [
    { side: 'top',    x: bx + bw / 2, y: by },
    { side: 'right',  x: bx + bw,     y: by + bh / 2 },
    { side: 'bottom', x: bx + bw / 2, y: by + bh },
    { side: 'left',   x: bx,          y: by + bh / 2 },
  ];
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x - kx) * (c.x - kx) + (c.y - ky) * (c.y - ky);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Draw a single leader on a textbox: anchor (auto-picked) -> knee -> tip,
// with arrow or circle endpoint.
function drawTextboxLeader(ctx, annotation, leader, strokeColor, lineWidth) {
  const tipX = leader.tipX;
  const tipY = leader.tipY;
  const kneeX = leader.kneeX;
  const kneeY = leader.kneeY;
  const anchor = pickAnchorSide(annotation, kneeX, kneeY);

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(kneeX, kneeY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  const endStyle = leader.endStyle || 'arrow';
  if (endStyle === 'circle') {
    const r = 4;
    ctx.beginPath();
    ctx.arc(tipX, tipY, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // arrow — filled (closed) by default for textbox leaders
    const angle = Math.atan2(tipY - kneeY, tipX - kneeX);
    drawArrowheadOnCanvas(ctx, tipX, tipY, angle, 7, 'closed');
  }
  ctx.restore();
}

// Draw single annotation
// Render a single parametric symbol to a standalone PNG data URL, reusing the
// EXACT live drawAnnotation() path (same templates, command-walker, hatch, text
// and rotation) so the raster matches the on-screen rendering. Used by the PDF
// saver to embed an appearance stream (/AP) for the NL/IFC symbols, so they look
// the same in other PDF viewers instead of showing an empty box. The canvas
// covers the rotation-expanded bbox (the same box the saver writes as the
// annotation Rect), so a rotated symbol never clips.
export function renderParametricSymbolToPng(annotation, pxPerUnit = 4) {
  try {
    const w = Math.max(1, annotation.width || 1);
    const h = Math.max(1, annotation.height || 1);
    const rot = ((annotation.rotation || 0) * Math.PI) / 180;
    const cosA = Math.abs(Math.cos(rot)), sinA = Math.abs(Math.sin(rot));
    const aabbW = w * cosA + h * sinA;   // rotation-expanded bbox = saver Rect
    const aabbH = w * sinA + h * cosA;
    // Cap so a huge symbol can't allocate an enormous canvas.
    const px = Math.max(0.5, Math.min(pxPerUnit, 4000 / Math.max(aabbW, aabbH)));
    const cw = Math.max(1, Math.round(aabbW * px));
    const ch = Math.max(1, Math.round(aabbH * px));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    // Map the expanded-bbox app-region onto the canvas (app-units → pixels).
    const cx = annotation.x + w / 2, cy = annotation.y + h / 2;
    ctx.scale(cw / aabbW, ch / aabbH);
    ctx.translate(-(cx - aabbW / 2), -(cy - aabbH / 2));
    // Full opacity here; the saver applies annotation opacity via the AP's
    // ExtGState (same as image stamps) so it isn't applied twice.
    drawAnnotation(ctx, { ...annotation, opacity: 1, hidden: false });
    return { dataUrl: canvas.toDataURL('image/png') };
  } catch (e) {
    console.warn('[render] renderParametricSymbolToPng failed:', e);
    return null;
  }
}

// ─── Image tint cache ────────────────────────────────────────────────────
// Image annotations used as compare-overlays can carry a `tintColor`. The
// tint is a multiply of the tint colour over the bitmap (alpha preserved),
// baked once per Image element into an offscreen canvas so redraws stay a
// single drawImage. WeakMap keyed on the Image: refreshes of linked images
// swap the Image object, which automatically invalidates the cache entry.
const _tintedImageCache = new WeakMap(); // Image → { tint, canvas }

function getTintedImage(img, tint) {
  const hit = _tintedImageCache.get(img);
  if (hit && hit.tint === tint) return hit.canvas;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 1;
  c.height = img.naturalHeight || 1;
  const tctx = c.getContext('2d');
  tctx.drawImage(img, 0, 0);
  tctx.globalCompositeOperation = 'multiply';
  tctx.fillStyle = tint;
  tctx.fillRect(0, 0, c.width, c.height);
  // Multiply paints the full rect — clip it back to the source alpha so
  // transparent bitmap areas stay transparent.
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(img, 0, 0);
  tctx.globalCompositeOperation = 'source-over';
  _tintedImageCache.set(img, { tint, canvas: c });
  return c;
}

// Build a CSS/canvas `filter` string for an image annotation's non-destructive
// Word-style adjustments, or '' when all are neutral. brightness/contrast are
// stored as multipliers (1 = neutral); grayscale is a boolean. Reused by the
// PDF saver so the flattened bitmap carries the same look.
export function imageFilterString(annotation) {
  const parts = [];
  if (annotation.grayscale) parts.push('grayscale(1)');
  const b = annotation.brightness;
  if (b !== undefined && b !== null && b !== 1) parts.push(`brightness(${b})`);
  const c = annotation.contrast;
  if (c !== undefined && c !== null && c !== 1) parts.push(`contrast(${c})`);
  return parts.join(' ');
}

export function drawAnnotation(ctx, annotation) {
  // Skip hidden annotations
  if (annotation.hidden) return;

  // ── Zichtbaarheid Elementen (per annotatie-SOORT) ──────────────────────
  // Het "Zichtbaarheid Elementen"-paneel kan een hele annotatie-soort
  // verbergen of dimmen (halftone) met een optionele kleur-tint. Dit werkt
  // per ann.type, los van de per-annotatie `hidden`/`opacity`.
  if (evHiddenTypes().has(annotation.type)) return;
  const _evHalftone = evHalftoneTypes().get(annotation.type) || null;

  // Use annotation's opacity property
  let baseOpacity = annotation.opacity !== undefined ? annotation.opacity :
                     (annotation.type === 'highlight' ? 0.3 : 1);

  // Use strokeColor/fillColor if available, otherwise fallback to color
  let strokeColor = annotation.strokeColor || annotation.color;
  let fillColor = annotation.fillColor || annotation.color;

  // Halftone-override: dim de soort en tint optioneel de kleuren. De tint
  // vervangt stroke/fill zodat de hele soort visueel als één laag oplicht
  // (Revit-achtige "halftone"). De opacity-factor wordt op de basisopacity
  // toegepast (multiplicatief) zodat een reeds-transparante annotatie niet
  // plots donkerder wordt.
  if (_evHalftone) {
    baseOpacity = baseOpacity * (_evHalftone.opacity ?? 0.35);
    if (_evHalftone.color) {
      strokeColor = _evHalftone.color;
      fillColor = _evHalftone.color;
    }
  }

  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  let lw = annotation.lineWidth ?? 3;
  // Ensure a minimum visible stroke when there's no fill, so the annotation stays visible
  const annHasFill = hasFill(annotation.fillColor);
  if (lw === 0 && !annHasFill) lw = 0.5;
  lw = thinLw(lw);
  ctx.lineWidth = lw;
  ctx.globalAlpha = baseOpacity;
  ctx.globalCompositeOperation = annotation.blendMode === 'multiply' ? 'multiply' : 'source-over';

  switch (annotation.type) {
    case 'draw':
      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      annotation.path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
      break;

    case 'highlight':
      ctx.fillStyle = fillColor;
      ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      break;

    case 'line':
      ctx.strokeStyle = strokeColor;
      ctx.lineCap = 'butt';
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      ctx.setLineDash([]);
      break;

    case 'arrow': {
      // Draw arrow onto offscreen canvas at full opacity to avoid overlap artifacts,
      // then composite onto main canvas with the desired opacity
      const arrowFillColor = annotation.fillColor || strokeColor;
      const endHead = annotation.endHead || 'open';
      const startHead = annotation.startHead || 'none';
      const headSize = annotation.headSize || 8;
      let lw = annotation.lineWidth ?? 3;
      if (lw === 0) lw = 0.5;
      lw = thinLw(lw);

      // Calculate bounding box with padding for arrowheads
      const pad = headSize + lw + 2;
      const minAX = Math.min(annotation.startX, annotation.endX) - pad;
      const minAY = Math.min(annotation.startY, annotation.endY) - pad;
      const maxAX = Math.max(annotation.startX, annotation.endX) + pad;
      const maxAY = Math.max(annotation.startY, annotation.endY) + pad;
      const offW = maxAX - minAX;
      const offH = maxAY - minAY;

      // Create offscreen canvas at scaled resolution to avoid pixelation when zoomed
      const arrowDoc = state.documents[state.activeDocumentIndex];
      const arrowScale = (arrowDoc ? arrowDoc.scale : 1) || 1;
      const offCanvas = document.createElement('canvas');
      offCanvas.width = offW * arrowScale;
      offCanvas.height = offH * arrowScale;
      const offCtx = offCanvas.getContext('2d');

      // Scale and translate so coordinates match document space
      offCtx.scale(arrowScale, arrowScale);
      offCtx.translate(-minAX, -minAY);
      offCtx.strokeStyle = strokeColor;
      offCtx.fillStyle = arrowFillColor;
      offCtx.lineWidth = lw;
      offCtx.lineCap = 'butt';
      offCtx.lineJoin = 'miter';

      applyBorderStyle(offCtx, annotation.borderStyle);

      // Shorten line so it stops at the arrowhead. The amount depends on
      // whether the head is FILLED (closed, diamond, square, circle) or
      // OPEN/STROKED (open, stealth, openReversed, butt, slash, openCircle):
      //   • Filled head: shorten by full headSize so the line ends at the
      //     base of the triangle (no overlap → no double-thickness halo).
      //   • Open head: the V is hollow — if we shorten by full headSize the
      //     line ends BELOW the V base and you see a visible gap inside the
      //     V. Use a tiny shortening (just enough to keep the line tip from
      //     poking past the V tip with thick strokes).
      const FILLED_HEADS = new Set(['closed', 'closedReversed', 'diamond', 'square', 'circle']);
      const isHeadFilled = (s) => FILLED_HEADS.has(s);
      const aDx = annotation.endX - annotation.startX;
      const aDy = annotation.endY - annotation.startY;
      const aLen = Math.sqrt(aDx * aDx + aDy * aDy);
      let lineStartX = annotation.startX, lineStartY = annotation.startY;
      let lineEndX = annotation.endX, lineEndY = annotation.endY;
      if (aLen > 0) {
        const ux = aDx / aLen, uy = aDy / aLen;
        if (endHead !== 'none') {
          const off = isHeadFilled(endHead) ? headSize : Math.min(lw * 0.5, 1);
          lineEndX -= ux * off;
          lineEndY -= uy * off;
        }
        if (startHead !== 'none') {
          const off = isHeadFilled(startHead) ? headSize : Math.min(lw * 0.5, 1);
          lineStartX += ux * off;
          lineStartY += uy * off;
        }
      }

      offCtx.beginPath();
      offCtx.moveTo(lineStartX, lineStartY);
      offCtx.lineTo(lineEndX, lineEndY);
      offCtx.stroke();

      offCtx.setLineDash([]);

      if (endHead !== 'none') {
        const endAngle = Math.atan2(aDy, aDx);
        drawArrowheadOnCanvas(offCtx, annotation.endX, annotation.endY, endAngle, headSize, endHead);
      }

      if (startHead !== 'none') {
        const startAngle = Math.atan2(-aDy, -aDx);
        drawArrowheadOnCanvas(offCtx, annotation.startX, annotation.startY, startAngle, headSize, startHead);
      }

      // Composite the offscreen arrow onto the main canvas with opacity
      ctx.drawImage(offCanvas, minAX, minAY, offW, offH);
      break;
    }

    case 'arc': {
      ctx.beginPath();
      ctx.arc(annotation.centerX, annotation.centerY, annotation.radius, annotation.startAngle, annotation.endAngle);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lw;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }

    case 'spline': {
      if (annotation.controlPoints && annotation.controlPoints.length >= 3) {
        const samples = catmullRomSpline(annotation.controlPoints, 16);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lw;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        applyBorderStyle(ctx, annotation.borderStyle);
        ctx.beginPath();
        ctx.moveTo(samples[0].x, samples[0].y);
        for (let i = 1; i < samples.length; i++) {
          ctx.lineTo(samples[i].x, samples[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      break;
    }

    case 'polyline':
      if (annotation.points && annotation.points.length >= 2) {
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        applyBorderStyle(ctx, annotation.borderStyle);
        ctx.beginPath();
        annotation.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      break;

    case 'splineArrow': {
      // Curved (spline) arrow — smooth Catmull-Rom curve through the clicked
      // points with an arrowhead at the last point along the end tangent.
      const saPts = annotation.points;
      if (saPts && saPts.length >= 2) {
        const segs = catmullRomToBezier(saPts);
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = annotation.fillColor || strokeColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        applyBorderStyle(ctx, annotation.borderStyle);
        if (segs.length) {
          ctx.beginPath();
          ctx.moveTo(segs[0].x0, segs[0].y0);
          for (const s of segs) ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x1, s.y1);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // Arrowheads at end (and optionally start) of the curve.
        const saHeadSize = annotation.headSize || 8;
        const saEndHead = annotation.endHead || 'open';
        const saStartHead = annotation.startHead || 'none';
        if (saEndHead !== 'none') {
          const tip = saPts[saPts.length - 1];
          drawArrowheadOnCanvas(ctx, tip.x, tip.y, splineArrowEndTangent(saPts), saHeadSize, saEndHead);
        }
        if (saStartHead !== 'none') {
          const startTip = saPts[0];
          const revAngle = splineArrowEndTangent([...saPts].reverse());
          drawArrowheadOnCanvas(ctx, startTip.x, startTip.y, revAngle, saHeadSize, saStartHead);
        }
      }
      break;
    }

    case 'circle':
      // Draw ellipse that fits in bounding box
      const ellipseX = annotation.x;
      const ellipseY = annotation.y;
      const ellipseW = annotation.width || annotation.radius * 2;
      const ellipseH = annotation.height || annotation.radius * 2;
      const ellipseCX = ellipseX + ellipseW / 2;
      const ellipseCY = ellipseY + ellipseH / 2;

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        ctx.translate(ellipseCX, ellipseCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-ellipseCX, -ellipseCY);
      }

      ctx.beginPath();
      ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        ctx.beginPath();
        ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.beginPath();
      ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'mask': {
      // Maskeer (wipeout): ALWAYS fully opaque white — its whole purpose is
      // hiding what's underneath, so the opacity property must not leak in.
      ctx.save();
      ctx.globalAlpha = 1;
      if (annotation.rotation) {
        const mCX = annotation.x + annotation.width / 2;
        const mCY = annotation.y + annotation.height / 2;
        ctx.translate(mCX, mCY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-mCX, -mCY);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      // Only ONE edge carries the dash-dot hint line; the other three sides are
      // borderless, so the mask reads as a clean cover with a single marked side.
      // Which side is configurable via `maskDashSide` (top/right/bottom/left).
      ctx.strokeStyle = annotation.strokeColor || '#9a9a9a';
      ctx.lineWidth = thinLw(annotation.lineWidth || 0.75);
      applyBorderStyle(ctx, annotation.borderStyle || 'dash-dot');
      const _mx0 = annotation.x, _my0 = annotation.y;
      const _mx1 = annotation.x + annotation.width, _my1 = annotation.y + annotation.height;
      ctx.beginPath();
      switch (annotation.maskDashSide || 'left') {
        case 'top':    ctx.moveTo(_mx0, _my0); ctx.lineTo(_mx1, _my0); break;
        case 'right':  ctx.moveTo(_mx1, _my0); ctx.lineTo(_mx1, _my1); break;
        case 'bottom': ctx.moveTo(_mx0, _my1); ctx.lineTo(_mx1, _my1); break;
        default:       ctx.moveTo(_mx0, _my0); ctx.lineTo(_mx0, _my1); break; // left
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;
    }

    case 'box':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const boxCenterX = annotation.x + annotation.width / 2;
        const boxCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxCenterX, boxCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-boxCenterX, -boxCenterY);
      }

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        ctx.beginPath();
        ctx.rect(annotation.x, annotation.y, annotation.width, annotation.height);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'polygon':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const polyCX = annotation.x + annotation.width / 2;
        const polyCY = annotation.y + annotation.height / 2;
        ctx.translate(polyCX, polyCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-polyCX, -polyCY);
      }
      // Imported /Polygon annotations carry their real vertices; the
      // regular-N-gon fallback is only for polygons drawn with the shape tool.
      const polyHasPoints = Array.isArray(annotation.points) && annotation.points.length >= 3;
      const buildPolyPath = () => {
        if (polyHasPoints) {
          buildPolygonPointsPath(ctx, annotation.points, annotation.x, annotation.y, annotation.width, annotation.height);
        } else {
          buildPolygonPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        }
      };

      // Fill if fillColor is set
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        buildPolyPath();
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        buildPolyPath();
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      buildPolyPath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'cloud':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const cloudCX = annotation.x + annotation.width / 2;
        const cloudCY = annotation.y + annotation.height / 2;
        ctx.translate(cloudCX, cloudCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-cloudCX, -cloudCY);
      }
      // Fill if fillColor is set
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        buildCloudPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        buildCloudPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      drawCloudShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.restore();
      break;

    case 'cloudPolyline':
      if (annotation.points && annotation.points.length >= 2) {
        // Fill if fillColor is set
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          buildCloudPolylinePath(ctx, annotation.points, true);
          ctx.fillStyle = annotation.fillColor;
          ctx.fill();
        }
        // Hatch pattern fill
        if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
          buildCloudPolylinePath(ctx, annotation.points, true);
          applyHatchFill(ctx, annotation);
        }
        ctx.strokeStyle = strokeColor;
        buildCloudPolylinePath(ctx, annotation.points, true);
        ctx.stroke();
      }
      break;

    case 'comment': {
      // Draw comment icon using proper vector icon rendering
      const cSize = annotation.width || 24;
      const iconCX = annotation.x + cSize / 2;
      const iconCY = annotation.y + cSize / 2;

      // Draw leader triangle from icon to popup
      if (annotation.popupOpen && annotation._popupFocused) {
        const popX = annotation.popupX !== undefined ? annotation.popupX : annotation.x + 30;
        const popY = annotation.popupY !== undefined ? annotation.popupY : annotation.y;

        const doc = state.documents[state.activeDocumentIndex];
        const scl = (doc ? doc.scale : 1) || 1;
        const popW = 230 / scl;
        const popH = 150 / scl;

        // Popup center
        const cx = popX + popW / 2;
        const cy = popY + popH / 2;

        // Direction from popup center to icon
        const dx = iconCX - cx;
        const dy = iconCY - cy;

        // Line-rect intersection: find where line from center to icon hits popup edge
        const sx = dx !== 0 ? (popW / 2) / Math.abs(dx) : Infinity;
        const sy = dy !== 0 ? (popH / 2) / Math.abs(dy) : Infinity;
        const s = Math.min(sx, sy);
        if (s >= 1) break; // icon is inside popup, skip leader

        const edgeX = cx + dx * s;
        const edgeY = cy + dy * s;

        // Distance from icon to edge
        const eDx = edgeX - iconCX;
        const eDy = edgeY - iconCY;
        const edgeDist = Math.sqrt(eDx * eDx + eDy * eDy);
        if (edgeDist < cSize * 0.5) break; // too close

        // Unit direction from icon toward popup center
        const udx = eDx / edgeDist;
        const udy = eDy / edgeDist;

        // Target point: 15px past the edge into the popup interior
        const inset = 15 / scl;
        const tgtX = edgeX + udx * inset;
        const tgtY = edgeY + udy * inset;

        // Perpendicular spread (always same visual width)
        const perpX = -udy;
        const perpY = udx;
        const spread = 7 / scl;

        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(iconCX, iconCY);
        ctx.lineTo(tgtX + perpX * spread, tgtY + perpY * spread);
        ctx.lineTo(tgtX - perpX * spread, tgtY - perpY * spread);
        ctx.closePath();
        ctx.fillStyle = fillColor || '#FFFF00';
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = baseOpacity;

      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const cCenterX = iconCX;
        const cCenterY = iconCY;
        ctx.translate(cCenterX, cCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-cCenterX, -cCenterY);
      }

      drawCommentIcon(ctx, annotation.icon, annotation.x, annotation.y, cSize, fillColor || '#FFFF00');

      ctx.restore();
      break;
    }

    case 'count': {
      const cx = annotation.x, cy = annotation.y;
      const col = annotation.color || annotation.strokeColor || '#e11d48';
      ctx.save();
      ctx.globalAlpha = annotation.opacity ?? 1;
      if (annotation.markerStyle === 'symbol' && annotation.symbolId) {
        const tpl = getTemplate(annotation.symbolId);
        if (tpl && typeof tpl.draw === 'function') {
          const s = 22;
          ctx.translate(cx - s / 2, cy - s / 2);
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
          try { tpl.draw(ctx, { width: s, height: s, color: col }, {}); } catch (_) { /* symbol draw signature mismatch */ }
        } else {
          ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        }
      } else {
        const r = 9;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(annotation.number ?? ''), cx, cy);
      }
      ctx.restore();
      break;
    }

    case 'text': {
      const txtRawFamily = annotation.fontFamily || 'Arial';
      // camelCase-expanded fallback chain — see comment in shapes.js drawTextboxContent.
      const _txtCssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
      const _txtExpanded = txtRawFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
      const _txtChain = [];
      if (_txtExpanded !== txtRawFamily) _txtChain.push(_txtCssQuote(_txtExpanded));
      _txtChain.push(/[\s"',]/.test(txtRawFamily) ? _txtCssQuote(txtRawFamily) : txtRawFamily);
      _txtChain.push('sans-serif');
      const txtFontFamily = _txtChain.join(', ');
      const txtFontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
      const txtFontSize = annotation.fontSize || 16;
      ctx.fillStyle = annotation.color || '#000000';
      ctx.font = `${txtFontStyle}${txtFontSize}px ${txtFontFamily}`;
      // Base direction follows the first strong-directional character (dir="auto",
      // issue #61/#255) so Arabic/Hebrew keeps correct bidi ordering of mixed and
      // neutral characters. Alignment/anchor is left unchanged for this point-text.
      ctx.direction = isRTLText(annotation.text) ? 'rtl' : 'ltr';
      ctx.textAlign = annotation.textAlign || 'left';

      const lines = (annotation.text || '').split('\n');
      let txtY = annotation.y;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], annotation.x, txtY);
        if (annotation.fontUnderline) {
          const lineWidth = ctx.measureText(lines[i]).width;
          let underlineX = annotation.x;
          if (annotation.textAlign === 'center') underlineX -= lineWidth / 2;
          else if (annotation.textAlign === 'right') underlineX -= lineWidth;
          ctx.beginPath();
          ctx.moveTo(underlineX, txtY + 2);
          ctx.lineTo(underlineX + lineWidth, txtY + 2);
          ctx.strokeStyle = annotation.color || '#000000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        txtY += txtFontSize * 1.3;
      }
      ctx.textAlign = 'left';
      ctx.direction = 'ltr'; // Reset base direction for subsequent draws
      break;
    }

    case 'textbox':
      // Draw text box with border and optional fill
      const tbWidth = annotation.width || 150;
      const tbHeight = annotation.height || 50;
      const tbLineWidth = thinLw(annotation.lineWidth !== undefined ? annotation.lineWidth : 1);
      const tbBorderStyle = annotation.borderStyle || 'solid';

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const tbCenterX = annotation.x + tbWidth / 2;
        const tbCenterY = annotation.y + tbHeight / 2;
        ctx.translate(tbCenterX, tbCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-tbCenterX, -tbCenterY);
      }

      // Draw fill (wolkrand-annotaties vullen het scallop-pad i.p.v. de rect)
      const tbPuff = cloudPuffSize(annotation);
      if (hasFill(annotation.fillColor)) {
        ctx.fillStyle = annotation.fillColor;
        if (annotation.borderEffect === 'cloudy') {
          buildCloudPath(ctx, annotation.x, annotation.y, tbWidth, tbHeight, tbPuff);
          ctx.fill();
        } else {
          ctx.fillRect(annotation.x, annotation.y, tbWidth, tbHeight);
        }
      }

      // Draw border with style
      if (tbLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = tbLineWidth;
        applyBorderStyle(ctx, tbBorderStyle);
        if (annotation.borderEffect === 'cloudy') {
          buildCloudPath(ctx, annotation.x, annotation.y, tbWidth, tbHeight, tbPuff);
          ctx.stroke();
        } else {
          ctx.strokeRect(annotation.x, annotation.y, tbWidth, tbHeight);
        }
        ctx.setLineDash([]);
      }

      // Allow text to overflow slightly beyond textbox bounds
      // (other PDF viewers show overflow text; hard clipping hides words at edges)
      ctx.beginPath();
      ctx.rect(annotation.x - 2, annotation.y - 2, tbWidth + 4, tbHeight + 4);
      ctx.clip();

      // Draw text content
      drawTextboxContent(ctx, annotation);
      ctx.restore();

      // Draw leaders (multi-leader generalisation of callout)
      if (Array.isArray(annotation.leaders) && annotation.leaders.length > 0) {
        const _ldrStroke = annotation.strokeColor || strokeColor || '#000000';
        const _ldrLw = thinLw(annotation.lineWidth !== undefined ? annotation.lineWidth : 1) || 1;
        for (const leader of annotation.leaders) {
          drawTextboxLeader(ctx, annotation, leader, _ldrStroke, _ldrLw);
        }
      }
      break;

    case 'callout':
      // Draw callout annotation (text box with two-segment leader line)
      const coWidth = annotation.width || 150;
      const coHeight = annotation.height || 50;
      const coLineWidth = thinLw(annotation.lineWidth !== undefined ? annotation.lineWidth : 1);
      const coBorderStyle = annotation.borderStyle || 'solid';

      // Set stroke style for leader line and border
      ctx.strokeStyle = annotation.strokeColor || strokeColor;
      ctx.lineWidth = coLineWidth > 0 ? coLineWidth : 1;
      applyBorderStyle(ctx, coBorderStyle);

      // Arrow tip position
      const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coHeight;

      // Knee point
      const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coHeight / 2;

      // Arm origin (connection point on text box edge)
      let armOriginX, armOriginY;
      if (annotation.armOriginX !== undefined && annotation.armOriginY !== undefined) {
        armOriginX = annotation.armOriginX;
        armOriginY = annotation.armOriginY;
      } else {
        if (arrowX < annotation.x + coWidth / 2) {
          armOriginX = annotation.x;
        } else {
          armOriginX = annotation.x + coWidth;
        }
        armOriginY = kneeY;
      }

      // Draw the leader line (not rotated - arrow stays in place).
      // 'curved' leader = vloeiende Catmull-Rom-spline door
      // [armOrigin, knee, arrowTip] i.p.v. twee rechte segmenten (ronde aanhaallijn).
      const coCurved = annotation.leaderStyle === 'curved';
      let angle;
      ctx.beginPath();
      if (coCurved) {
        const coLeaderPts = [
          { x: armOriginX, y: armOriginY },
          { x: kneeX, y: kneeY },
          { x: arrowX, y: arrowY },
        ];
        const coSegs = catmullRomToBezier(coLeaderPts);
        ctx.moveTo(armOriginX, armOriginY);
        for (const s of coSegs) {
          ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x1, s.y1);
        }
        ctx.stroke();
        angle = splineArrowEndTangent(coLeaderPts);
      } else {
        ctx.moveTo(armOriginX, armOriginY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();
        angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
      }

      // Draw arrowhead — filled (closed) by default, but honor explicit per-annotation style if set
      ctx.fillStyle = annotation.strokeColor || strokeColor;
      drawArrowheadOnCanvas(ctx, arrowX, arrowY, angle, annotation.headSize || 7, annotation.arrowStyle || 'closed');

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const coCenterX = annotation.x + coWidth / 2;
        const coCenterY = annotation.y + coHeight / 2;
        ctx.translate(coCenterX, coCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-coCenterX, -coCenterY);
      }

      // Draw fill (wolkrand-callouts vullen het scallop-pad i.p.v. de rect)
      const coPuff = cloudPuffSize(annotation);
      if (hasFill(annotation.fillColor)) {
        ctx.fillStyle = annotation.fillColor;
        if (annotation.borderEffect === 'cloudy') {
          buildCloudPath(ctx, annotation.x, annotation.y, coWidth, coHeight, coPuff);
          ctx.fill();
        } else {
          ctx.fillRect(annotation.x, annotation.y, coWidth, coHeight);
        }
      }

      // Draw border with style
      if (coLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = coLineWidth;
        applyBorderStyle(ctx, coBorderStyle);
        if (annotation.borderEffect === 'cloudy') {
          buildCloudPath(ctx, annotation.x, annotation.y, coWidth, coHeight, coPuff);
          ctx.stroke();
        } else {
          ctx.strokeRect(annotation.x, annotation.y, coWidth, coHeight);
        }
        ctx.setLineDash([]);
      }

      // Draw text content
      drawTextboxContent(ctx, annotation);
      ctx.restore();
      break;

    case 'image':
      // Draw image with rotation and flip
      const img = imageCache.get(annotation.imageId);
      if (img && img.complete) {
        ctx.save();

        // Move to center of image for rotation and flip
        const centerX = annotation.x + annotation.width / 2;
        const centerY = annotation.y + annotation.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);

        // Apply flip transformations
        const scaleX = annotation.flipX ? -1 : 1;
        const scaleY = annotation.flipY ? -1 : 1;
        ctx.scale(scaleX, scaleY);

        // High-quality image scaling. Canvas defaults to
        // imageSmoothingQuality='low' (cheap bilinear) which produces a
        // visibly grainy/blurry result when source ≠ destination — and
        // for image annotations the destination is almost ALWAYS scaled
        // (zoom + DPR + initial 1500px cap). 'high' uses a much better
        // resampler (Lanczos-ish on Chromium) at negligible cost for
        // single-shot drawImage in the annotation layer.
        const prevSmooth = ctx.imageSmoothingEnabled;
        const prevQuality = ctx.imageSmoothingQuality;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Non-destructive Word-style adjustments (grayscale / brightness /
        // contrast). Stored on the annotation, applied here via the canvas
        // `filter` property. brightness/contrast are 0-2 (1 = neutral);
        // grayscale is a boolean. Composed into a single filter string.
        const _imgFilters = imageFilterString(annotation);
        const _prevFilter = ctx.filter;
        if (_imgFilters) ctx.filter = _imgFilters;

        // Draw the image centered at origin, combining two independent
        // features: a compare-overlay colour tint (multiply, alpha-preserving —
        // see getTintedImage) AND non-destructive crop (#212). cropLeft/Top/
        // Right/Bottom are fractions 0-1 of the SOURCE trimmed per side; the
        // remaining source window maps onto the full annotation rect.
        const imgTint = annotation.tintColor;
        const imgSrc = (imgTint && imgTint !== 'none') ? getTintedImage(img, imgTint) : img;
        const cropL = Math.max(0, Math.min(0.95, annotation.cropLeft || 0));
        const cropT = Math.max(0, Math.min(0.95, annotation.cropTop || 0));
        const cropR = Math.max(0, Math.min(0.95, annotation.cropRight || 0));
        const cropB = Math.max(0, Math.min(0.95, annotation.cropBottom || 0));
        const cropW = 1 - cropL - cropR;
        const cropH = 1 - cropT - cropB;
        // getTintedImage returns a canvas (uses .width); a raw image uses
        // .naturalWidth — support both so crop works with and without tint.
        const srcW = imgSrc.naturalWidth || imgSrc.width || 0;
        const srcH = imgSrc.naturalHeight || imgSrc.height || 0;
        if ((cropL || cropT || cropR || cropB) && cropW > 0 && cropH > 0 && srcW > 0 && srcH > 0) {
          ctx.drawImage(imgSrc,
            srcW * cropL, srcH * cropT, srcW * cropW, srcH * cropH,
            -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        } else {
          ctx.drawImage(imgSrc, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        }

        ctx.imageSmoothingEnabled = prevSmooth;
        ctx.imageSmoothingQuality = prevQuality;
        if (_imgFilters) ctx.filter = _prevFilter;

        ctx.restore();
      } else {
        // Draw placeholder while loading
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.fillStyle = '#999';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', annotation.x + annotation.width/2, annotation.y + annotation.height/2);
        ctx.textAlign = 'left';
      }
      break;

    case 'textHighlight':
      // Draw text highlight as a solid fill. The actual blending with the
      // underlying text happens via CSS `mix-blend-mode: multiply` on the
      // dedicated #text-highlight-canvas this is drawn onto. Drawing at full
      // alpha gives the cleanest multiply result.
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = 1;
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        });
      } else {
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }
      break;

    case 'textStrikethrough':
      // Draw strikethrough line through the middle of each text rect
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.lineCap = 'round';
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          const midY = rect.y + rect.height / 2;
          ctx.beginPath();
          ctx.moveTo(rect.x, midY);
          ctx.lineTo(rect.x + rect.width, midY);
          ctx.stroke();
        });
      } else {
        const midY = annotation.y + annotation.height / 2;
        ctx.beginPath();
        ctx.moveTo(annotation.x, midY);
        ctx.lineTo(annotation.x + annotation.width, midY);
        ctx.stroke();
      }
      break;

    case 'textUnderline':
      // Draw underline at the bottom of each text rect
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.lineCap = 'round';
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          const bottomY = rect.y + rect.height - 1;
          ctx.beginPath();
          ctx.moveTo(rect.x, bottomY);
          ctx.lineTo(rect.x + rect.width, bottomY);
          ctx.stroke();
        });
      } else {
        const bottomY = annotation.y + annotation.height - 1;
        ctx.beginPath();
        ctx.moveTo(annotation.x, bottomY);
        ctx.lineTo(annotation.x + annotation.width, bottomY);
        ctx.stroke();
      }
      break;

    case 'stamp': {
      // Render stamp - image or text-based
      // Always prefer global imageCache (plain Map, no Proxy) for reliable .complete checks.
      // SolidJS createMutable can wrap _cachedImg in a Proxy, breaking HTMLImageElement checks.
      let stampImg = annotation.imageId ? imageCache.get(annotation.imageId) : null;
      if (!stampImg && annotation._cachedImg) {
        // Unwrap potential SolidJS proxy by reading src and re-fetching from cache
        const raw = annotation._cachedImg;
        if (raw instanceof HTMLImageElement) stampImg = raw;
      }
      if (stampImg && stampImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.drawImage(stampImg, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        ctx.restore();
      } else if (annotation.stampText) {
        // Text-based stamp
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);

        const color = annotation.stampColor || annotation.color || '#ef4444';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);

        ctx.fillStyle = color;
        ctx.font = `bold ${Math.min(annotation.height * 0.5, 24)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(annotation.stampText, 0, 0);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      } else if (annotation.stampSvg) {
        // SVG fallback: rasterize on-the-fly when imageId is not yet in cache.
        // External <image href=URL> references must be inlined first so the
        // SVG-as-img security context doesn't show a broken-image placeholder
        // (e.g. NEN 1414 symbols).
        (async () => {
          let svgStr = annotation.stampSvg;
          if (/<image\b[^>]*\bhref=/i.test(svgStr)) {
            const hrefRegex = /(<image\b[^>]*\b(?:xlink:href|href)=)(["'])([^"']+)\2/gi;
            const matches = [...svgStr.matchAll(hrefRegex)];
            for (const m of matches) {
              const u = m[3];
              if (u.startsWith('data:')) continue;
              try {
                const res = await fetch(u);
                const b = await res.blob();
                const dataUrl = await new Promise((res2, rej) => {
                  const r = new FileReader();
                  r.onload = () => res2(r.result);
                  r.onerror = rej;
                  r.readAsDataURL(b);
                });
                svgStr = svgStr.replace(m[0], m[1] + m[2] + dataUrl + m[2]);
              } catch (_) {}
            }
          }
          const blob = new Blob([svgStr], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            URL.revokeObjectURL(url);
            const cacheId = annotation.imageId || ('stamp_svg_' + annotation.id);
            imageCache.set(cacheId, fallbackImg);
            if (!annotation.imageId) annotation.imageId = cacheId;
            annotation._cachedImg = fallbackImg;
            redrawAnnotations();
          };
          fallbackImg.onerror = () => URL.revokeObjectURL(url);
          fallbackImg.src = url;
        })();
      }
      break;
    }

    case 'signature': {
      // Render signature image
      const sigImg = annotation.imageId ? imageCache.get(annotation.imageId) : null;
      if (sigImg && sigImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.drawImage(sigImg, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        ctx.restore();
      } else {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.strokeStyle = '#999';
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.setLineDash([]);
        ctx.fillStyle = '#999';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Signature', annotation.x + annotation.width / 2, annotation.y + annotation.height / 2 + 4);
        ctx.textAlign = 'left';
      }
      break;
    }

    case 'wall': {
      // Plan-view wall segment with material hatch + mitred corner joins
      // (see rendering/walls.js). Needs sibling walls for the joins.
      const _wallDoc = state.documents[state.activeDocumentIndex];
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 0.7);
      drawWall(ctx, annotation, _wallDoc ? _wallDoc.annotations : []);
      break;
    }

    case 'parametricSymbol': {
      // Parametric symbol — driven by a template + params
      const template = getTemplate(annotation.symbolId);
      if (!template) {
        // Unknown symbol: draw a placeholder bbox
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.setLineDash([]);
        ctx.fillStyle = strokeColor;
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('? ' + (annotation.symbolId || ''), annotation.x + annotation.width / 2, annotation.y + annotation.height / 2);
        ctx.textAlign = 'left';
        ctx.restore();
        break;
      }
      const cmds = template.render(annotation.params || {}, {
        x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height
      }) || [];
      ctx.save();
      // Apply rotation around centre (consistent with stamp/signature)
      const cx = annotation.x + annotation.width / 2;
      const cy = annotation.y + annotation.height / 2;
      const rot = (annotation.rotation || 0) * Math.PI / 180;
      if (rot) {
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.translate(-cx, -cy);
      }
      const lw = thinLw(annotation.lineWidth ?? 1);
      ctx.lineWidth = lw;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      for (const c of cmds) {
        if (!c) continue;
        switch (c.kind) {
          case 'line': {
            ctx.save();
            if (Array.isArray(c.dash)) ctx.setLineDash(c.dash);
            ctx.beginPath();
            ctx.moveTo(c.x1, c.y1);
            ctx.lineTo(c.x2, c.y2);
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'arc': {
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, c.r, c.a0, c.a1, !!c.ccw);
            ctx.stroke();
            break;
          }
          case 'circle': {
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 'polyline': {
            if (!Array.isArray(c.points) || c.points.length < 2) break;
            ctx.save();
            if (Array.isArray(c.dash)) ctx.setLineDash(c.dash);
            ctx.beginPath();
            ctx.moveTo(c.points[0].x, c.points[0].y);
            for (let i = 1; i < c.points.length; i++) ctx.lineTo(c.points[i].x, c.points[i].y);
            if (c.close) ctx.closePath();
            if (c.fill) {
              // fill may be `true` (symbol colour) or a CSS colour string.
              if (typeof c.fill === 'string') ctx.fillStyle = c.fill;
              ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'hatch': {
            // Pattern-hatched region: loops[0] = outer contour, loops 1..n =
            // holes (evenodd). Pattern ids come from the hatch catalog.
            // MATERIAL hatches are PAPER-FIXED: constant pitch on paper
            // (NEN drafting practice), independent of the region scale —
            // `scale` 100 = the standard pattern pitch, lower = denser.
            if (!Array.isArray(c.loops) || c.loops.length === 0) break;
            applyHatchFillPolygon(
              ctx, c.loops[0], c.loops.slice(1),
              c.pattern, c.color || strokeColor, c.scale ?? 100, c.angle ?? 0
            );
            break;
          }
          case 'zigzag': {
            // Insulation fill for an arbitrary closed loop: solid bg +
            // 60° triangle-wave spanning the loop's height (same look as
            // insulation walls). Clipped to the loop.
            if (!Array.isArray(c.loop) || c.loop.length < 3) break;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(c.loop[0].x, c.loop[0].y);
            for (let i = 1; i < c.loop.length; i++) ctx.lineTo(c.loop[i].x, c.loop[i].y);
            ctx.closePath();
            ctx.clip();
            let zx0 = Infinity, zy0 = Infinity, zx1 = -Infinity, zy1 = -Infinity;
            for (const p of c.loop) {
              if (p.x < zx0) zx0 = p.x; if (p.x > zx1) zx1 = p.x;
              if (p.y < zy0) zy0 = p.y; if (p.y > zy1) zy1 = p.y;
            }
            const zh = zy1 - zy0;
            if (c.bg) {
              ctx.fillStyle = c.bg;
              ctx.fill();
            }
            const amp = (zh / 2) * 0.92;
            const midY = (zy0 + zy1) / 2;
            const step = Math.max(zh / Math.tan(Math.PI / 3), 0.5);
            ctx.strokeStyle = c.color || strokeColor;
            ctx.lineWidth = Math.max(0.3, Math.min(0.6, zh * 0.012));
            ctx.beginPath();
            let zx = zx0 - step;
            let side = -1;
            ctx.moveTo(zx, midY + side * amp);
            while (zx < zx1 + step) {
              zx += step;
              side = -side;
              ctx.lineTo(zx, midY + side * amp);
            }
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'rings': {
            // Multiple closed loops as ONE path with an evenodd fill —
            // loops 2..n cut holes out of loop 1 (e.g. hollow-section walls
            // filled solid while the inside stays open).
            if (!Array.isArray(c.loops) || c.loops.length === 0) break;
            ctx.beginPath();
            for (const loop of c.loops) {
              if (!Array.isArray(loop) || loop.length < 3) continue;
              ctx.moveTo(loop[0].x, loop[0].y);
              for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
              ctx.closePath();
            }
            if (c.fill) ctx.fill('evenodd');
            if (c.stroke !== false) ctx.stroke();
            break;
          }
          case 'text': {
            ctx.save();
            ctx.font = `${c.bold ? 'bold ' : ''}${c.size || 12}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(c.text || '', c.x, c.y);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.restore();
            break;
          }
        }
      }
      ctx.restore();
      break;
    }

    case 'measureDistance': {
      // Distance measurement line with label
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.setLineDash([]);

      drawDimension(ctx, {
        startX: annotation.startX, startY: annotation.startY,
        endX: annotation.endX, endY: annotation.endY,
        leaderStartX: annotation.leaderStartX, leaderStartY: annotation.leaderStartY,
        leaderEndX: annotation.leaderEndX, leaderEndY: annotation.leaderEndY,
        startHead: annotation.startHead || 'openCircle',
        endHead: annotation.endHead || 'openCircle',
        headSize: annotation.headSize || 12,
        color: strokeColor,
        measureText: annotation.measureText,
        fontSize: annotation.fontSize,
        // User-dragged text position (offset from dimension-line midpoint)
        textOffsetX: annotation.textOffsetX || 0,
        textOffsetY: annotation.textOffsetY || 0,
        // Extension is the DEFAULT (NL drafting style): only explicitly
        // disabling it (dimExtension === false) turns it off.
        extension: annotation.dimExtension !== false
      });
      break;
    }

    case 'measureArea': {
      // Area measurement polygon
      if (!annotation.points || annotation.points.length < 3) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);

      const maRegionFactor = getRegionScaleFactor(
        annotation.page, annotation.points[0]?.x, annotation.points[0]?.y
      );
      const maHatch = annotation.hatchPattern === 'none'
        ? null  // User explicitly disabled hatch
        : annotation.hatchPattern
          ? { pattern: annotation.hatchPattern, color: annotation.hatchColor || '#ff0000', scale: (annotation.hatchScale ?? 100) * maRegionFactor, angle: annotation.hatchAngle }
          : { pattern: 'diagonal-left', color: annotation.hatchColor || '#ff0000', scale: 100, angle: 0 };  // Default: red 45° hatch
      drawMeasureAreaShape(ctx, annotation.points, annotation.color || '#ff0000', annotation.lineWidth, annotation.fillColor, annotation.borderStyle, annotation.holes, maHatch);
      if (annotation.measureText) {
        drawCentroidLabel(ctx, annotation.points, annotation.measureText, strokeColor, annotation);
      }
      break;
    }

    case 'filledArea': {
      // User-drawn polygon contour (with optional arc segments and holes),
      // filled with a solid color and/or hatch pattern.
      if (!annotation.points || annotation.points.length < 3) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      // Hatch density follows the scale region the area sits in (sampled at
      // the first vertex): same material pattern → same real-world spacing
      // across regions of different scales.
      const faRegionFactor = getRegionScaleFactor(
        annotation.page, annotation.points[0]?.x, annotation.points[0]?.y
      );
      const faHatch = (annotation.hatchPattern && annotation.hatchPattern !== 'none')
        ? {
            pattern: annotation.hatchPattern,
            color: annotation.hatchColor || strokeColor,
            scale: (annotation.hatchScale ?? 100) * faRegionFactor,
            angle: annotation.hatchAngle ?? 0,
          }
        : null;
      // Treat unset / null fillColor as no fill (we don't want measureArea's
      // semi-transparent default for an explicit user-drawn fill annotation).
      const faFill = annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== 'transparent'
        ? annotation.fillColor
        : 'none';
      drawMeasureAreaShape(
        ctx,
        annotation.points,
        annotation.strokeColor || annotation.color || '#000000',
        annotation.lineWidth,
        faFill,
        annotation.borderStyle || 'solid',
        annotation.holes,
        faHatch
      );
      break;
    }

    case 'redaction': {
      // Redaction mark - red hatched overlay
      const rw = annotation.width || 0;
      const rh = annotation.height || 0;
      // Semi-transparent red fill
      ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
      ctx.fillRect(annotation.x, annotation.y, rw, rh);
      // Animated marching-ants border (signals an active/pending redaction area)
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -(state.redactAntsOffset || 0);
      ctx.strokeRect(annotation.x, annotation.y, rw, rh);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      // Diagonal hatch lines
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 10;
      for (let d = -rh; d < rw; d += step) {
        const x1 = Math.max(0, d) + annotation.x;
        const y1 = Math.max(0, -d) + annotation.y;
        const x2 = Math.min(rw, d + rh) + annotation.x;
        const y2 = Math.min(rh, -d + rw) + annotation.y;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      // Label
      ctx.font = '10px Arial';
      ctx.fillStyle = '#ff0000';
      ctx.fillText('REDACT', annotation.x + 4, annotation.y + 14);
      break;
    }

    case 'measurePerimeter': {
      // Perimeter measurement polyline
      if (!annotation.points || annotation.points.length < 2) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);

      drawMeasurePerimeterShape(ctx, annotation.points, strokeColor, annotation.borderStyle);

      // Line endings at first and last points
      const mpPts = annotation.points;
      const mpHeadSize = annotation.headSize || 12;
      const mpStartHead = annotation.startHead || 'none';
      const mpEndHead = annotation.endHead || 'none';
      if (mpStartHead !== 'none' && mpPts.length >= 2) {
        const startAngle = Math.atan2(mpPts[0].y - mpPts[1].y, mpPts[0].x - mpPts[1].x);
        ctx.fillStyle = strokeColor;
        drawDimensionLineEnding(ctx, mpPts[0].x, mpPts[0].y, startAngle, mpHeadSize, mpStartHead);
      }
      if (mpEndHead !== 'none' && mpPts.length >= 2) {
        const last = mpPts[mpPts.length - 1];
        const prev = mpPts[mpPts.length - 2];
        const endAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
        ctx.fillStyle = strokeColor;
        drawDimensionLineEnding(ctx, last.x, last.y, endAngle, mpHeadSize, mpEndHead);
      }

      if (annotation.measureText && mpPts.length > 0) {
        const lastPt = mpPts[mpPts.length - 1];
        ctx.font = '11px Arial';
        ctx.fillStyle = strokeColor;
        ctx.fillText(annotation.measureText, lastPt.x + 8, lastPt.y - 4);
      }
      break;
    }

    case 'scaleRegion': {
      // Scale region: dashed orange boundary, translucent fill, top-left badge.
      const srX = annotation.x, srY = annotation.y;
      const srW = annotation.width, srH = annotation.height;
      const srColor = annotation.color || '#ff9800';

      ctx.save();
      // Translucent fill
      ctx.globalAlpha = 0.10 * (annotation.opacity || 1);
      ctx.fillStyle = srColor;
      ctx.fillRect(srX, srY, srW, srH);
      // Dashed border
      ctx.globalAlpha = annotation.opacity || 1;
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = srColor;
      ctx.lineWidth = annotation.lineWidth || 1.5;
      ctx.strokeRect(srX, srY, srW, srH);
      ctx.setLineDash([]);

      // Badge top-left: "[label · ]1:100 [mm]"
      const scaleStr = annotation.scaleString || '1:100';
      const unitStr = annotation.units || 'mm';
      const labelStr = annotation.label || '';
      const badgeText = (labelStr ? `${labelStr} · ` : '') + `${scaleStr} [${unitStr}]`;
      ctx.font = 'bold 11px sans-serif';
      const badgeW = ctx.measureText(badgeText).width + 10;
      const badgeH = 16;
      ctx.fillStyle = srColor;
      ctx.fillRect(srX, srY - badgeH, badgeW, badgeH);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, srX + 5, srY - badgeH / 2);

      // Default 1-meter (or 1-foot for imperial) scale bar in bottom-right corner.
      // Visual aid only; not stored in annotation data.
      try {
        const ppu = pixelsPerUnitFor(scaleStr, unitStr);
        // Determine display unit + magnitude in that unit.
        let barUnits;        // amount in the chosen display unit
        let barUnitLabel;    // human label
        if (unitStr === 'in' || unitStr === 'ft') {
          // imperial → 1 ft
          barUnits = (unitStr === 'ft') ? 1 : 12; // 1 ft = 12 in
          barUnitLabel = '1 ft';
        } else {
          // metric → 1 m
          switch (unitStr) {
            case 'mm': barUnits = 1000; break;
            case 'cm': barUnits = 100; break;
            case 'm':  barUnits = 1; break;
            default:   barUnits = 1000; break;
          }
          barUnitLabel = '1 m';
        }
        const barLen = barUnits * ppu;
        // Only draw if the scaleRegion is wide enough and bar fits.
        if (srW >= 60 && srH >= 24 && barLen >= 16 && barLen <= srW - 16) {
          const margin = 8;
          const barH = 6;
          const barX = srX + srW - margin - barLen;
          const barY = srY + srH - margin - barH;
          const segments = 4;
          const segW = barLen / segments;
          ctx.globalAlpha = 1;
          // Outer black frame
          ctx.fillStyle = '#000000';
          ctx.fillRect(barX, barY, barLen, barH);
          // White segments (alternating)
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < segments; i++) {
            if (i % 2 === 1) {
              ctx.fillRect(barX + i * segW, barY, segW, barH);
            }
          }
          // Black border
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX + 0.5, barY + 0.5, barLen - 1, barH - 1);

          // Label above the bar
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(barUnitLabel, barX + barLen, barY - 1);
        }
      } catch (_) { /* defensive: never break rendering on a label glitch */ }

      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }

    case 'viewport': {
      // Viewport: dashed boundary rectangle with name label
      const vpX = annotation.x, vpY = annotation.y;
      const vpW = annotation.width, vpH = annotation.height;
      const vpColor = annotation.color || '#0066cc';

      ctx.save();
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = vpColor;
      ctx.lineWidth = annotation.lineWidth || 1.5;
      ctx.globalAlpha = annotation.opacity || 0.6;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
      ctx.setLineDash([]);

      // Name label (top-left corner)
      const vpLabel = annotation.name || annotation.scaleRatio || '';
      if (vpLabel) {
        ctx.globalAlpha = 0.85;
        ctx.font = 'bold 9px sans-serif';
        const labelWidth = ctx.measureText(vpLabel).width + 8;
        ctx.fillStyle = vpColor;
        ctx.fillRect(vpX, vpY - 14, labelWidth, 14);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(vpLabel, vpX + 4, vpY - 7);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }

    case 'scaleBar': {
      const sbX = annotation.x;
      const sbY = annotation.y;
      const sbW = annotation.width;
      const sbH = annotation.height || 12;
      const divisions = annotation.divisions || 5;
      const totalUnits = annotation.totalUnits || divisions;
      const unit = annotation.unit || 'mm';
      const divWidth = sbW / divisions;
      const barColor = annotation.color || '#000000';
      const barLW = annotation.lineWidth || 1;

      ctx.save();

      if (annotation.rotation) {
        const cx = sbX + sbW / 2;
        const cy = sbY + sbH / 2;
        ctx.translate(cx, cy);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-cx, -cy);
      }

      // Scale ratio label above the bar (e.g., "1:100")
      const _sbDoc = getActiveDocument();
      const _sbMs = _sbDoc?.measureScale;
      if (_sbMs?.scaleRatio) {
        ctx.fillStyle = barColor;
        ctx.font = `bold ${Math.max(8, sbH * 0.65)}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(_sbMs.scaleRatio), sbX, sbY - 2);
      }

      // Alternating blocks
      for (let i = 0; i < divisions; i++) {
        const bx = sbX + i * divWidth;
        if (i % 2 === 0) {
          ctx.fillStyle = barColor;
          ctx.fillRect(bx, sbY, divWidth, sbH);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx, sbY, divWidth, sbH);
          ctx.strokeStyle = barColor;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(bx, sbY, divWidth, sbH);
        }
      }

      // Outer border
      ctx.strokeStyle = barColor;
      ctx.lineWidth = barLW;
      ctx.strokeRect(sbX, sbY, sbW, sbH);

      // Tick marks and labels below
      ctx.fillStyle = barColor;
      ctx.strokeStyle = barColor;
      const sbFontSize = Math.max(7, Math.min(10, sbH * 0.7));
      ctx.font = `${sbFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const unitsPerDiv = totalUnits / divisions;

      for (let i = 0; i <= divisions; i++) {
        const tx = sbX + i * divWidth;
        ctx.beginPath();
        ctx.moveTo(tx, sbY + sbH);
        ctx.lineTo(tx, sbY + sbH + 4);
        ctx.lineWidth = barLW;
        ctx.stroke();

        const rawVal = Math.round(i * unitsPerDiv * 100) / 100;
        let labelStr;
        if (unit === 'mm' && totalUnits >= 1000) labelStr = String(rawVal / 1000);
        else if (unit === 'cm' && totalUnits >= 100) labelStr = String(rawVal / 100);
        else labelStr = String(rawVal);
        ctx.fillText(labelStr, tx, sbY + sbH + 5);
      }

      // Unit label (right of bar)
      let _sbDisplayUnit = unit;
      if (unit === 'mm' && totalUnits >= 1000) _sbDisplayUnit = 'm';
      else if (unit === 'cm' && totalUnits >= 100) _sbDisplayUnit = 'm';
      ctx.textAlign = 'left';
      ctx.fillText(_sbDisplayUnit, sbX + sbW + 4, sbY + sbH + 5);


      ctx.restore();
      break;
    }

    case 'scheduleTable': {
      // Generic columns/rows format (schedules panel + Hoeveelheden placement).
      // rows: [{ cells: string[], group?, total?, grand? }]
      if (Array.isArray(annotation.columns) && Array.isArray(annotation.rows)) {
        const columns = annotation.columns;
        const rows = annotation.rows;
        const ncols = Math.max(1, columns.length);
        const tw = annotation.width || Math.max(300, ncols * 90);
        // Beeldcellen (data:image data-URL's) krijgen hogere rijen zodat de
        // thumbnail herkenbaar zichtbaar is; anders de compacte standaardhoogte.
        const isImg = (v) => typeof v === 'string' && v.startsWith('data:image');
        const hasImages = rows.some(row => !row.group && !row.total
          && Array.isArray(row.cells) && row.cells.some(isImg));
        const rowH = hasImages ? 40 : 18, headerH = 22, pad = 6;
        const colW = tw / ncols;
        const bodyH = headerH + rows.length * rowH;

        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Truncate a string with an ellipsis to fit maxW (uses current font).
        const clip = (s, maxW) => {
          s = String(s ?? '');
          if (ctx.measureText(s).width <= maxW) return s;
          while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
          return s + '…';
        };

        // Background + header
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(annotation.x, annotation.y, tw, bodyH);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(annotation.x, annotation.y, tw, headerH);
        ctx.fillStyle = '#333';
        ctx.font = 'bold 10px sans-serif';
        for (let i = 0; i < ncols; i++) {
          ctx.fillText(clip(columns[i], colW - pad * 2), annotation.x + i * colW + pad, annotation.y + headerH / 2);
        }

        // Rows
        for (let r = 0; r < rows.length; r++) {
          const ry = annotation.y + headerH + r * rowH;
          const row = rows[r] || {};
          if (row.group) { ctx.fillStyle = '#eef2f7'; ctx.fillRect(annotation.x, ry, tw, rowH); }
          else if (row.total) { ctx.fillStyle = row.grand ? '#e6e6e6' : '#f4f4f4'; ctx.fillRect(annotation.x, ry, tw, rowH); }
          else if (r % 2 === 1) { ctx.fillStyle = '#f8f8f8'; ctx.fillRect(annotation.x, ry, tw, rowH); }
          ctx.strokeStyle = '#ddd'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(annotation.x, ry + rowH); ctx.lineTo(annotation.x + tw, ry + rowH); ctx.stroke();
          ctx.fillStyle = '#000';
          ctx.font = (row.total || row.group) ? 'bold 10px sans-serif' : '10px sans-serif';
          const cells = row.cells || [];
          if (row.group) {
            ctx.fillText(clip(cells[0] || '', tw - pad * 2), annotation.x + pad, ry + rowH / 2);
          } else {
            for (let i = 0; i < ncols; i++) {
              const raw = cells[i];
              if (isImg(raw)) {
                // Teken de echte thumbnail in de cel (aspect-behoudend, gecentreerd).
                const thumb = getScheduleThumb(raw);
                const cellX = annotation.x + i * colW;
                const maxW = colW - pad * 2, maxH = rowH - 6;
                if (thumb && thumb.width && thumb.height) {
                  const sc = Math.min(maxW / thumb.width, maxH / thumb.height, 1);
                  const dw = thumb.width * sc, dh = thumb.height * sc;
                  ctx.drawImage(thumb, cellX + (colW - dw) / 2, ry + (rowH - dh) / 2, dw, dh);
                } else {
                  ctx.fillStyle = '#bbb';
                  ctx.fillText('…', cellX + pad, ry + rowH / 2);
                  ctx.fillStyle = '#000';
                }
                continue;
              }
              const val = raw != null ? String(raw) : '';
              ctx.fillText(clip(val, colW - pad * 2), annotation.x + i * colW + pad, ry + rowH / 2);
            }
          }
        }

        // Column separators
        ctx.strokeStyle = '#e6e6e6'; ctx.lineWidth = 0.5;
        for (let i = 1; i < ncols; i++) {
          ctx.beginPath(); ctx.moveTo(annotation.x + i * colW, annotation.y); ctx.lineTo(annotation.x + i * colW, annotation.y + bodyH); ctx.stroke();
        }
        // Outer border
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
        ctx.strokeRect(annotation.x, annotation.y, tw, bodyH);

        annotation.width = tw;
        annotation.height = bodyH;
        ctx.restore();
        break;
      }

      // Legacy scheduleData format (fixed columns).
      const data = annotation.scheduleData || [];
      if (data.length === 0) break;
      const tx = annotation.x;
      const ty = annotation.y;
      const tw = annotation.width || 400;
      const rowH = 18;
      const headerH = 22;
      const pad = 8;
      const cols = [0, 0.22, 0.42, 0.65, 0.82]; // fractional column positions

      ctx.save();
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(tx, ty, tw, headerH + data.length * rowH);

      // Header background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(tx, ty, tw, headerH);
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(tx, ty, tw, headerH);

      // Header text
      ctx.fillStyle = '#333';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 10px sans-serif';
      const headers = ['Label', 'Subject', 'Value', 'Unit', 'Pg'];
      for (let i = 0; i < headers.length; i++) {
        ctx.fillText(headers[i], tx + cols[i] * tw + pad, ty + headerH / 2);
      }

      // Data rows
      ctx.font = '10px sans-serif';
      for (let r = 0; r < data.length; r++) {
        const ry = ty + headerH + r * rowH;
        // Alternating row background
        if (r % 2 === 1) {
          ctx.fillStyle = '#f8f8f8';
          ctx.fillRect(tx, ry, tw, rowH);
        }
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(tx, ry + rowH);
        ctx.lineTo(tx + tw, ry + rowH);
        ctx.stroke();
        ctx.fillStyle = '#000';
        const d = data[r];
        ctx.fillText(d.label || d.type || '', tx + cols[0] * tw + pad, ry + rowH / 2);
        ctx.fillText(d.subject || '', tx + cols[1] * tw + pad, ry + rowH / 2);
        ctx.fillText(d.text || String(d.value || ''), tx + cols[2] * tw + pad, ry + rowH / 2);
        ctx.fillText(d.unit || '', tx + cols[3] * tw + pad, ry + rowH / 2);
        ctx.fillText(String(d.page || ''), tx + cols[4] * tw + pad, ry + rowH / 2);
      }

      // Outer border
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty, tw, headerH + data.length * rowH);

      // Update annotation dimensions for accurate selection
      annotation.height = headerH + data.length * rowH;

      ctx.restore();
      break;
    }

    case 'measureAngle': {
      if (!annotation.point1 || !annotation.vertex || !annotation.point2) break;
      const p1 = annotation.point1;
      const v = annotation.vertex;
      const p2 = annotation.point2;
      const r = annotation.arcRadius || 30;

      // Draw two rays from vertex
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(v.x, v.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Draw arc between the two rays (shortest arc)
      const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
      const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
      let diff = a2 - a1;
      if (diff < 0) diff += 2 * Math.PI;
      const counterclockwise = diff > Math.PI;
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, a1, a2, counterclockwise);
      ctx.stroke();

      // Draw angle label near the arc midpoint
      if (annotation.measureText) {
        const midAngle = counterclockwise
          ? a1 - (2 * Math.PI - diff) / 2
          : a1 + diff / 2;
        const labelR = r + 12;
        const lx = v.x + labelR * Math.cos(midAngle);
        const ly = v.y + labelR * Math.sin(midAngle);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(annotation.measureText, lx, ly);
      }
      break;
    }

    default: {
      const typeHandler = getAnnotationType(annotation.type);
      if (typeHandler && typeHandler.render) {
        typeHandler.render(ctx, annotation);
      }
      break;
    }
  }
}

// Draw text edits (cover-and-replace) for a specific page
// ctx is already scaled by state.scale, so coordinates are in unscaled page space
function drawTextEdits(ctx, pageNum) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return;

  const pageEdits = doc.textEdits.filter(e => e.page === pageNum);
  if (pageEdits.length === 0) return;

  const canvasEl = ctx.canvas;
  const dims = doc.pageDims?.[pageNum];
  // Text-edit records stay in the page's unrotated PDF frame. Apply the page
  // matrix only while painting so save coordinates remain stable across turns.
  const fallbackScale = doc.scale || 1;
  const pageWidth = dims?.widthPt || canvasEl.width / fallbackScale;
  const pageHeight = dims?.heightPt || canvasEl.height / fallbackScale;
  const totalRotation = (Number(dims?.rotation) || 0) + getPageRotation(pageNum);

  ctx.save();
  ctx.transform(...getPageRotationMatrix(pageWidth, pageHeight, totalRotation));

  for (const edit of pageEdits) {
    const fontSize = edit.fontSize;
    const ls = edit.lineSpacing || fontSize * 1.2;
    const numOrig = edit.numOriginalLines || 1;

    // First line baseline in canvas coordinates
    const firstBaseY = pageHeight - edit.pdfY;

    // Cover rectangle: extends from above first baseline to below last baseline
    // Skip cover rect for newly added text (no original text to cover)
    ctx.save();
    if (edit.originalText) {
      const coverTop = firstBaseY - fontSize;
      const coverHeight = (numOrig - 1) * ls + fontSize * 1.3;
      const origLines = edit.originalText.split('\n');
      const maxOrigLen = Math.max(...origLines.map(l => l.length));
      const coverWidth = Math.max(edit.pdfWidth, fontSize * 0.6 * maxOrigLen) + fontSize * 0.5;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(edit.pdfX, coverTop, coverWidth, coverHeight);
    }

    // Draw new text line by line
    ctx.fillStyle = edit.color || '#000000';
    const ff = (edit.fontFamily || 'Helvetica').toLowerCase();
    const cssFallback = ff.includes('courier') ? '"Courier New", Courier, monospace'
      : ff.includes('times') ? '"Times New Roman", Times, serif'
      : 'Helvetica, Arial, sans-serif';
    const fontWeight = ff.includes('bold') ? 'bold ' : '';
    const fontStyle = ff.includes('italic') || ff.includes('oblique') ? 'italic ' : '';
    // Use PDF.js loaded font for exact visual match on canvas, with standard font fallback
    const fontFamily = edit.loadedFontName
      ? `"${edit.loadedFontName}", ${cssFallback}`
      : cssFallback;
    const canvasFont = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
    ctx.font = canvasFont;
    ctx.textBaseline = 'alphabetic';

    const newLines = edit.newText.split('\n');
    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i];
      const baselineY = firstBaseY + i * ls;
      ctx.fillText(line, edit.pdfX, baselineY);

      if (line && (edit.fontUnderline || edit.fontStrikethrough)) {
        const textWidth = ctx.measureText(line).width;
        ctx.strokeStyle = edit.color || '#000000';
        ctx.lineWidth = Math.max(0.5, fontSize * 0.06);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        if (edit.fontUnderline) {
          const underlineY = baselineY + fontSize * 0.1;
          ctx.moveTo(edit.pdfX, underlineY);
          ctx.lineTo(edit.pdfX + textWidth, underlineY);
        }
        if (edit.fontStrikethrough) {
          const strikeY = baselineY - fontSize * 0.3;
          ctx.moveTo(edit.pdfX, strikeY);
          ctx.lineTo(edit.pdfX + textWidth, strikeY);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// Redraw all annotations (single page mode)
// Pass lightweight=true during drag/resize to skip expensive DOM updates
// Track annotation count to know when spatial index needs rebuild
let _lastIndexedCount = -1;

export function rebuildSpatialIndex() {
  const doc = state.documents[state.activeDocumentIndex];
  const annotations = doc ? doc.annotations : [];
  spatialIndex.rebuild(annotations);
  _lastIndexedCount = annotations.length;
}

export function redrawAnnotations(lightweight = false) {
  if (!annotationCtx || !annotationCanvas) return;

  // Read scale and annotations from the active document directly
  // (bypass createMutable proxy getter caching)
  const doc = state.documents[state.activeDocumentIndex];
  const scale = doc ? doc.scale : 1;
  const annotations = doc ? doc.annotations : [];

  // Rebuild spatial index when annotation count changes (add/delete)
  if (annotations.length !== _lastIndexedCount) {
    spatialIndex.rebuild(annotations);
    _lastIndexedCount = annotations.length;
  }

  // Scale-region lookup cache: invalidate per redraw so moves/resizes
  // are reflected lazily on next draw. O(1) cost.
  invalidateScaleRegionCache();

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Sync the dedicated text-highlight canvas with the annotation canvas.
  // It uses CSS mix-blend-mode: multiply so it blends with #pdf-canvas below.
  if (textHighlightCanvas && textHighlightCtx) {
    if (textHighlightCanvas.width !== annotationCanvas.width ||
        textHighlightCanvas.height !== annotationCanvas.height) {
      textHighlightCanvas.width = annotationCanvas.width;
      textHighlightCanvas.height = annotationCanvas.height;
    }
    textHighlightCanvas.style.width = annotationCanvas.style.width;
    textHighlightCanvas.style.height = annotationCanvas.style.height;
    textHighlightCtx.setTransform(1, 0, 0, 1, 0, 0);
    textHighlightCtx.clearRect(0, 0, textHighlightCanvas.width, textHighlightCanvas.height);
  }

  // Apply scale transformation for zooming.
  // Blank docs (no filePath) bypass the viewport singleton — their pixels are
  // painted directly to #pdf-canvas via PDF.js, and the annotation overlay
  // must match doc.scale, NOT the viewport zoom that belongs to a previously-
  // open real PDF.
  const dpr = window.devicePixelRatio || 1;
  const vp = window.__pdfViewport;
  const _activeDoc = state.documents[state.activeDocumentIndex];
  const useViewport = vp && vp.active && _activeDoc?.filePath;
  const effectiveScale = useViewport ? vp.zoom : scale * dpr;
  annotationCtx.save();
  if (textHighlightCtx) textHighlightCtx.save();
  if (useViewport) {
    // Viewport mode: annotations are in app-space (top-left origin, Y-down, scale=1).
    // Page top-left on screen = (offsetX, offsetY).
    // App coord (ax, ay) → screen (ax*zoom + offsetX, ay*zoom + offsetY).
    // This is a simple scale + translate — no Y-flip needed for annotations.
    annotationCtx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
    if (textHighlightCtx) textHighlightCtx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    // Legacy mode: simple scale from origin
    annotationCtx.scale(effectiveScale, effectiveScale);
    if (textHighlightCtx) textHighlightCtx.scale(effectiveScale, effectiveScale);
  }

  // Draw grid overlay if enabled (BEFORE annotations, as a background pass).
  // Pass effectiveScale so the dot grid hides when too zoomed-out.
  if (state.preferences.showGrid) {
    drawGrid(annotationCtx, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale, effectiveScale);
  }

  // CRITICAL: in vector viewport mode, key the annotation page off
  // viewport.pageNum (what's currently drawn on #pdf-canvas) NOT
  // doc.currentPage (what the user *asked* for). When the user wheels to a
  // new uncached page, doc.currentPage updates immediately but the PDF takes
  // hundreds of ms to extract draw commands; if we used doc.currentPage we'd
  // draw the new page's annotations on top of the old page's PDF for that
  // entire window. viewport.pageNum only updates after setPage() runs, so it
  // always matches the visible PDF.
  const curPage = useViewport
    ? (vp.pageNum || (doc ? doc.currentPage : 1))
    : (doc ? doc.currentPage : 1);

  // Draw watermarks behind content
  renderWatermarksBehind(annotationCtx, curPage, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale);

  // Draw text edits (cover-and-replace) before annotations
  drawTextEdits(annotationCtx, curPage);

  // Viewport culling: skip annotations outside the visible area for performance
  let vpX = 0, vpY = 0, vpW, vpH;
  if (useViewport) {
    // Vector mode: visible area in app-coords = screen area mapped through inverse transform
    // Screen (0,0) → app (-offsetX/zoom, -offsetY/zoom)
    // Screen (canvasW, canvasH) → app ((canvasW-offsetX)/zoom, (canvasH-offsetY)/zoom)
    vpX = -vp.offsetX / vp.zoom;
    vpY = -vp.offsetY / vp.zoom;
    vpW = annotationCanvas.width / vp.zoom;
    vpH = annotationCanvas.height / vp.zoom;
    // Generous margin
    const margin = 200 / vp.zoom;
    vpX -= margin; vpY -= margin; vpW += margin * 2; vpH += margin * 2;
  } else {
    const canvasW = annotationCanvas.width / effectiveScale;
    const canvasH = annotationCanvas.height / effectiveScale;
    vpW = canvasW; vpH = canvasH;
    const scrollContainer = document.getElementById('pdf-container');
    if (scrollContainer) {
      const scale = doc ? doc.scale : 1;
      vpX = scrollContainer.scrollLeft / scale;
      vpY = scrollContainer.scrollTop / scale;
      vpW = scrollContainer.clientWidth / scale;
      vpH = scrollContainer.clientHeight / scale;
      const margin = 200 / scale;
      vpX -= margin; vpY -= margin; vpW += margin * 2; vpH += margin * 2;
    }
  }

  // Draw all annotations for current page (with viewport culling).
  // Text highlights go to the dedicated #text-highlight-canvas (CSS multiply
  // blend with #pdf-canvas below); everything else goes to #annotation-canvas.
  annotations.forEach(annotation => {
    if (annotation.page !== curPage) return;
    // Quick bounding box check for viewport culling
    if (annotation.x != null && annotation.width != null) {
      const ax = annotation.x, ay = annotation.y;
      const aw = annotation.width || 0, ah = annotation.height || 0;
      if (ax + aw < vpX || ax > vpX + vpW || ay + ah < vpY || ay > vpY + vpH) return;
    }
    const targetCtx = (annotation.type === 'textHighlight' && textHighlightCtx)
      ? textHighlightCtx
      : annotationCtx;
    // Wrap each annotation in save/restore to prevent clip leaks between annotations
    targetCtx.save();
    drawAnnotation(targetCtx, annotation);
    targetCtx.restore();
  });

  annotationCtx.globalAlpha = 1;
  annotationCtx.globalCompositeOperation = 'source-over';
  if (textHighlightCtx) {
    textHighlightCtx.globalAlpha = 1;
    textHighlightCtx.globalCompositeOperation = 'source-over';
  }

  // Draw watermarks in front of content
  renderWatermarksInFront(annotationCtx, curPage, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale);

  // Draw polar ray + tooltip when an active polar snap is engaged
  if (state.lastSnapResult && state.lastSnapResult.type === 'polar') {
    _drawPolarOverlay(annotationCtx, state.lastSnapResult, effectiveScale);
  }
  // Snap indicator during interactive G-move/G-rotate sessions. Drawing
  // tools render theirs via the shape-preview pass, which never runs for
  // the select-tool — without this the session snaps invisibly.
  if ((state.gMoveMode || state.gRotateMode) &&
      state.lastSnapResult && state.lastSnapResult.snapped &&
      state.lastSnapResult.type !== 'polar') {
    drawSnapIndicator(annotationCtx, state.lastSnapResult, effectiveScale);
  }

  // Image alignment guides (edge/centre snap while moving, equal-width/height
  // while resizing). State-driven — same principle as the rubber-band and the
  // snap indicator above: drawn INSIDE the redraw so a viewport re-render can't
  // wipe them. The one-shot overlay in tool-dispatcher gives instant feedback
  // within a single mousemove; this pass keeps them visible across the
  // viewport's RAF re-renders. Guides are in app-space, matching the transform
  // already applied to annotationCtx.
  if (state._imageAlignGuides && state._imageAlignGuides.length > 0) {
    drawImageAlignGuides(annotationCtx, state._imageAlignGuides, effectiveScale);
  }

  // Draw selection highlight and handles (use selectedAnnotations array as source of truth)
  const _renderDoc = getActiveDocument();
  const selected = _renderDoc ? _renderDoc.selectedAnnotations : [];
  if (selected.length > 0) {
    for (const ann of selected) {
      if (ann.page !== curPage) continue;
      drawSelectionHandles(annotationCtx, ann);
    }
  }

  // Interactive image-crop overlay (contextual "Afbeelding" tab → Croppen).
  // Drawn after selection handles so the crop rectangle sits on top.
  drawImageCropOverlay(annotationCtx, curPage);

  // Embedded image-removal tool highlights (issue #184).
  drawEmbeddedImageOverlay(annotationCtx, curPage);

  // Blender-style 2D cursor (Shift+right-click places it; hidden until set).
  if (_renderDoc?.cursor2D && _renderDoc.cursor2D.page === curPage) {
    _draw2DCursor(annotationCtx, _renderDoc.cursor2D.x, _renderDoc.cursor2D.y, effectiveScale);
  }

  // Rubber-band selection marquee (state-driven so it can't be cleared by the
  // next redraw frame; gated to the page the drag started on).
  if (state.isRubberBanding && (state.rubberBandPage == null || state.rubberBandPage === curPage)) {
    drawRubberBand(annotationCtx, effectiveScale);
  }

  // Restore context
  annotationCtx.restore();
  if (textHighlightCtx) textHighlightCtx.restore();

  if (!lightweight) {
    // Update annotation count in status bar
    updateStatusAnnotations();

    // Update annotations list panel
    updateAnnotationsList();

    // Update quick access button states
    updateQuickAccessButtons();

    // Show/hide contextual ribbon tabs based on selection
    updateContextualTabs();
  }
}

// Render annotations for a specific page (continuous mode)
// Rubber-band selection marquee. Drawn as part of the render/overlay pass —
// driven purely by state — so it survives every redraw frame. (It used to be
// hand-painted in select-tool AFTER calling redraw(), which raced the redraw
// and left the marquee visible on some gestures but not others.) The render
// context is already scaled to app/PDF space, so coords are app-space and
// stroke widths/dashes are divided by effectiveScale to stay screen-constant.
function drawRubberBand(ctx, effectiveScale) {
  if (!state.isRubberBanding) return;
  const sx = state.rubberBandStartX, sy = state.rubberBandStartY;
  const ex = state.rubberBandEndX, ey = state.rubberBandEndY;
  if (sx == null || sy == null || ex == null || ey == null) return;
  const x = Math.min(sx, ex), y = Math.min(sy, ey);
  const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
  if (w < 0.5 && h < 0.5) return;
  const isCrossing = state.rubberBandMode === 'crossing';
  ctx.save();
  ctx.lineWidth = 1 / effectiveScale;
  if (isCrossing) {
    // drag-left → crossing (green, dashed)
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.setLineDash([4 / effectiveScale, 4 / effectiveScale]);
  } else {
    // drag-right → window (blue, solid)
    ctx.strokeStyle = '#3b82f6';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.setLineDash([]);
  }
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

export function renderAnnotationsForPage(ctx, pageNum, width, height, overrideDpr) {
  ctx.clearRect(0, 0, width, height);

  // Read scale and annotations from the active document directly
  const doc = state.documents[state.activeDocumentIndex];
  const scale = doc ? doc.scale : 1;
  const annotations = doc ? doc.annotations : [];

  // Apply scale transformation for zooming (includes hi-DPI factor)
  const dpr = overrideDpr !== undefined ? overrideDpr : (window.devicePixelRatio || 1);
  const effectiveScale = scale * dpr;
  ctx.save();
  ctx.scale(effectiveScale, effectiveScale);

  // Draw watermarks behind content
  renderWatermarksBehind(ctx, pageNum, width / effectiveScale, height / effectiveScale);

  // Draw text edits (cover-and-replace)
  drawTextEdits(ctx, pageNum);

  annotations.forEach(annotation => {
    if (annotation.page !== pageNum) return;
    drawAnnotation(ctx, annotation);
  });

  // Draw watermarks in front of content
  renderWatermarksInFront(ctx, pageNum, width / effectiveScale, height / effectiveScale);

  // Rubber-band selection marquee on the page the drag started on (continuous).
  if (state.isRubberBanding && state.rubberBandPage === pageNum) {
    drawRubberBand(ctx, effectiveScale);
  }

  // Image alignment guides on the page being edited (continuous). Same
  // state-driven principle as single-page mode: drawn here so the viewport's
  // RAF re-render can't wipe them.
  if (state._imageAlignGuides && state._imageAlignGuides.length > 0 &&
      state._imageAlignGuidesPage === pageNum) {
    drawImageAlignGuides(ctx, state._imageAlignGuides, effectiveScale);
  }

  // Interactive image-crop overlay for the page being cropped (continuous).
  drawImageCropOverlay(ctx, pageNum);

  // Embedded image-removal tool highlights (issue #184).
  drawEmbeddedImageOverlay(ctx, pageNum);

  // Restore context
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Redraw all pages in continuous mode
export function redrawContinuous() {
  const pageWrappers = document.querySelectorAll('.page-wrapper');
  pageWrappers.forEach(wrapper => {
    const pageNum = parseInt(wrapper.dataset.page);
    const canvas = wrapper.querySelector('.annotation-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);
    }
  });

  // Update quick access button states
  updateQuickAccessButtons();

  // Show/hide contextual ribbon tabs based on selection
  updateContextualTabs();
}
