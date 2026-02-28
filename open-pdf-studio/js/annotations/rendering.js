import { state, getActiveDocument, imageCache } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { updateStatusAnnotations } from '../ui/chrome/status-bar.js';
import { updateAnnotationsList } from '../ui/panels/annotations-list.js';
import { renderWatermarksBehind, renderWatermarksInFront } from '../watermark/watermark-renderer.js';

// Lazy-loaded element detection store signals (avoid circular / early Solid.js init)
let _edStore = null;
async function ensureEdStore() {
  if (!_edStore) {
    _edStore = await import('../solid/stores/panels/elementDetectionStore.js');
  }
  return _edStore;
}
// Pre-warm after first tick so it's ready when needed
setTimeout(() => ensureEdStore(), 0);

// Import from sub-modules
import { drawPolygonShape, drawCloudShape, buildPolygonPath, buildCloudPath, buildCloudPolylinePath, drawTextboxContent } from './rendering/shapes.js';
import { drawArrowheadOnCanvas, applyBorderStyle, drawDimensionLineEnding } from './rendering/decorations.js';
import { drawDimension, drawMeasureAreaShape, drawCentroidLabel, drawMeasurePerimeterShape } from './rendering/measurements.js';
import { applyHatchFill } from './rendering/hatch-patterns.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { drawSelectionHandles } from './rendering/selection.js';
import { updateQuickAccessButtons, updateContextualTabs, drawGrid, snapToGrid } from './rendering/ui-state.js';
import { drawCommentIcon } from './rendering/comment-icons.js';
import { spatialIndex } from './spatial-index.js';

// Re-export everything that external code needs
export { drawPolygonShape, drawCloudShape, buildPolygonPath, buildCloudPath } from './rendering/shapes.js';
export { updateQuickAccessButtons, snapToGrid } from './rendering/ui-state.js';

// Resolve line width, clamping to 1px when thin-lines view mode is active
function thinLw(width) {
  return state.preferences?.thinLines ? Math.min(width, 1) : width;
}

// Draw single annotation
export function drawAnnotation(ctx, annotation) {
  // Skip hidden annotations
  if (annotation.hidden) return;

  // Use annotation's opacity property
  const baseOpacity = annotation.opacity !== undefined ? annotation.opacity :
                     (annotation.type === 'highlight' ? 0.3 : 1);

  // Use strokeColor/fillColor if available, otherwise fallback to color
  const strokeColor = annotation.strokeColor || annotation.color;
  const fillColor = annotation.fillColor || annotation.color;

  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  let lw = annotation.lineWidth ?? 3;
  // Ensure a minimum visible stroke when there's no fill, so the annotation stays visible
  const hasFill = annotation.fillColor && annotation.fillColor !== 'transparent';
  if (lw === 0 && !hasFill) lw = 0.5;
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
      ctx.lineCap = 'round';
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
      const headSize = annotation.headSize || 12;
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

      // Shorten line so it stops at arrowhead base (not tip) to avoid overshoot
      const aDx = annotation.endX - annotation.startX;
      const aDy = annotation.endY - annotation.startY;
      const aLen = Math.sqrt(aDx * aDx + aDy * aDy);
      let lineStartX = annotation.startX, lineStartY = annotation.startY;
      let lineEndX = annotation.endX, lineEndY = annotation.endY;
      if (aLen > 0) {
        const ux = aDx / aLen, uy = aDy / aLen;
        if (endHead !== 'none') {
          lineEndX -= ux * headSize;
          lineEndY -= uy * headSize;
        }
        if (startHead !== 'none') {
          lineStartX += ux * headSize;
          lineStartY += uy * headSize;
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

    case 'polyline':
      if (annotation.points && annotation.points.length >= 2) {
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
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
      // Fill if fillColor is set
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        buildPolygonPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        buildPolygonPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      drawPolygonShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
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

    case 'text': {
      const txtFontFamily = annotation.fontFamily || 'Arial';
      const txtFontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
      const txtFontSize = annotation.fontSize || 16;
      ctx.fillStyle = annotation.color || '#000000';
      ctx.font = `${txtFontStyle}${txtFontSize}px ${txtFontFamily}`;
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

      // Draw fill
      if (annotation.fillColor && annotation.fillColor !== 'transparent') {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, tbWidth, tbHeight);
      }

      // Draw border with style
      if (tbLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = tbLineWidth;
        if (tbBorderStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        } else if (tbBorderStyle === 'dotted') {
          ctx.setLineDash([2, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(annotation.x, annotation.y, tbWidth, tbHeight);
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
      if (coBorderStyle === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (coBorderStyle === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }

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

      // Draw the two-segment leader line (not rotated - arrow stays in place)
      ctx.beginPath();
      ctx.moveTo(armOriginX, armOriginY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(arrowX, arrowY);
      ctx.stroke();

      // Draw arrowhead
      const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
      drawArrowheadOnCanvas(ctx, arrowX, arrowY, angle, 10, 'open');

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const coCenterX = annotation.x + coWidth / 2;
        const coCenterY = annotation.y + coHeight / 2;
        ctx.translate(coCenterX, coCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-coCenterX, -coCenterY);
      }

      // Draw fill
      if (annotation.fillColor && annotation.fillColor !== 'transparent') {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, coWidth, coHeight);
      }

      // Draw border with style
      if (coLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = coLineWidth;
        if (coBorderStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        } else if (coBorderStyle === 'dotted') {
          ctx.setLineDash([2, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(annotation.x, annotation.y, coWidth, coHeight);
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

        // Draw the image centered at origin
        ctx.drawImage(img, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);

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
      // Draw text highlight - semi-transparent fill for each rect
      ctx.fillStyle = fillColor;
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
        // SVG fallback: rasterize on-the-fly when imageId is not yet in cache
        const blob = new Blob([annotation.stampSvg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const fallbackImg = new Image();
        fallbackImg.onload = () => {
          URL.revokeObjectURL(url);
          const cacheId = annotation.imageId || ('stamp_svg_' + annotation.id);
          imageCache.set(cacheId, fallbackImg);
          if (!annotation.imageId) annotation.imageId = cacheId;
          annotation._cachedImg = fallbackImg;  // store directly for next render
          redrawAnnotations();
        };
        fallbackImg.onerror = () => {
          URL.revokeObjectURL(url);
        };
        fallbackImg.src = url;
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
        measureText: annotation.measureText
      });
      break;
    }

    case 'measureArea': {
      // Area measurement polygon
      if (!annotation.points || annotation.points.length < 3) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);

      const maHatch = annotation.hatchPattern === 'none'
        ? null  // User explicitly disabled hatch
        : annotation.hatchPattern
          ? { pattern: annotation.hatchPattern, color: annotation.hatchColor || '#ff0000', scale: annotation.hatchScale, angle: annotation.hatchAngle }
          : { pattern: 'diagonal-left', color: annotation.hatchColor || '#ff0000', scale: 100, angle: 0 };  // Default: red 45° hatch
      drawMeasureAreaShape(ctx, annotation.points, annotation.color || '#ff0000', annotation.lineWidth, annotation.fillColor, annotation.borderStyle, annotation.holes, maHatch);
      if (annotation.measureText) {
        drawCentroidLabel(ctx, annotation.points, annotation.measureText, strokeColor, annotation);
      }
      break;
    }

    case 'redaction': {
      // Redaction mark - red hatched overlay
      const rw = annotation.width || 0;
      const rh = annotation.height || 0;
      // Semi-transparent red fill
      ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
      ctx.fillRect(annotation.x, annotation.y, rw, rh);
      // Red border
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(annotation.x, annotation.y, rw, rh);
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
      // Render schedule table as annotation on canvas
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
  const docForScale = state.documents[state.activeDocumentIndex];
  const pageHeight = canvasEl.height / (docForScale ? docForScale.scale : 1);

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
      ctx.fillText(newLines[i], edit.pdfX, firstBaseY + i * ls);
    }
    ctx.restore();
  }
}

// Convert hex color to rgba string
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Draw element detection overlay (per-type visibility + selection highlight)
function drawElementDetectionOverlay(ctx, pageNum) {
  if (!_edStore) return;
  if (_edStore.detectedPage() !== pageNum) return;

  const selected = _edStore.selectedElement();
  const hasSelection = selected !== null;

  // Draw rooms (behind walls) — if type visible
  if (_edStore.showRooms()) {
    const currentRooms = _edStore.rooms();
    for (const room of currentRooms) {
      const isSelected = selected?.id === room.id;
      // Use CAD fill color if available, otherwise default blue
      const roomFill = room.fillColor || null;
      // When something is selected, dim non-selected elements
      if (hasSelection && !isSelected) {
        ctx.fillStyle = roomFill ? hexToRgba(roomFill, 0.05) : 'rgba(52,152,219,0.05)';
        ctx.strokeStyle = roomFill ? hexToRgba(roomFill, 0.15) : 'rgba(52,152,219,0.15)';
        ctx.lineWidth = 1;
      } else if (isSelected) {
        ctx.fillStyle = roomFill ? hexToRgba(roomFill, 0.35) : 'rgba(52,152,219,0.35)';
        ctx.strokeStyle = roomFill ? hexToRgba(roomFill, 0.8) : 'rgba(52,152,219,0.8)';
        ctx.lineWidth = 2;
      } else {
        ctx.fillStyle = roomFill ? hexToRgba(roomFill, 0.15) : 'rgba(52,152,219,0.15)';
        ctx.strokeStyle = roomFill ? hexToRgba(roomFill, 0.4) : 'rgba(52,152,219,0.4)';
        ctx.lineWidth = 1;
      }

      ctx.beginPath();
      for (let i = 0; i < room.points.length; i++) {
        if (i === 0) ctx.moveTo(room.points[i].x, room.points[i].y);
        else ctx.lineTo(room.points[i].x, room.points[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw label at centroid
      if (room.centroid && (!hasSelection || isSelected)) {
        ctx.font = '11px Arial';
        ctx.fillStyle = isSelected ? 'rgba(52,152,219,1)' : 'rgba(52,152,219,0.8)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.label, room.centroid.x, room.centroid.y);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // Draw walls — if type visible
  if (_edStore.showWalls()) {
    const currentWalls = _edStore.walls();
    for (const wall of currentWalls) {
      const isSelected = selected?.id === wall.id;
      if (hasSelection && !isSelected) {
        ctx.strokeStyle = 'rgba(231,76,60,0.15)';
        ctx.lineWidth = Math.max(wall.thickness * 0.5, 1);
      } else if (isSelected) {
        ctx.strokeStyle = 'rgba(231,76,60,0.9)';
        ctx.lineWidth = Math.max(wall.thickness, 2);
      } else {
        ctx.strokeStyle = 'rgba(231,76,60,0.5)';
        ctx.lineWidth = Math.max(wall.thickness, 2);
      }
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(wall.centerline.x1, wall.centerline.y1);
      ctx.lineTo(wall.centerline.x2, wall.centerline.y2);
      ctx.stroke();
    }
  }

  // Draw grids (green dashed lines) — if type visible
  if (_edStore.showGrids()) {
    const currentGrids = _edStore.grids();
    for (const grid of currentGrids) {
      const isSelected = selected?.id === grid.id;
      if (hasSelection && !isSelected) {
        ctx.strokeStyle = 'rgba(39,174,96,0.1)';
        ctx.lineWidth = 0.5;
      } else if (isSelected) {
        ctx.strokeStyle = 'rgba(39,174,96,0.7)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(39,174,96,0.4)';
        ctx.lineWidth = 1;
      }
      ctx.setLineDash([6, 4]);
      ctx.lineCap = 'butt';

      for (const line of grid.lines) {
        ctx.beginPath();
        ctx.moveTo(line.p.x, line.p.y);
        ctx.lineTo(line.q.x, line.q.y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }
  }
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

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Apply scale transformation for zooming
  const dpr = window.devicePixelRatio || 1;
  const vp = window.__pdfViewport;
  const useViewport = vp && vp.active;
  const effectiveScale = useViewport ? vp.zoom : scale * dpr;
  annotationCtx.save();
  if (useViewport) {
    // Viewport mode: annotations are in app-space (top-left origin, Y-down, scale=1).
    // Page top-left on screen = (offsetX, offsetY).
    // App coord (ax, ay) → screen (ax*zoom + offsetX, ay*zoom + offsetY).
    // This is a simple scale + translate — no Y-flip needed for annotations.
    annotationCtx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    // Legacy mode: simple scale from origin
    annotationCtx.scale(effectiveScale, effectiveScale);
  }

  // Draw grid overlay if enabled
  if (state.preferences.showGrid) {
    drawGrid(annotationCtx, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale);
  }

  const curPage = doc ? doc.currentPage : 1;

  // Draw watermarks behind content
  renderWatermarksBehind(annotationCtx, curPage, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale);

  // Draw text edits (cover-and-replace) before annotations
  drawTextEdits(annotationCtx, curPage);

  // Draw element detection overlay (walls + rooms)
  drawElementDetectionOverlay(annotationCtx, state.currentPage);

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

  // Draw all annotations for current page (with viewport culling)
  annotations.forEach(annotation => {
    if (annotation.page !== curPage) return;
    // Quick bounding box check for viewport culling
    if (annotation.x != null && annotation.width != null) {
      const ax = annotation.x, ay = annotation.y;
      const aw = annotation.width || 0, ah = annotation.height || 0;
      if (ax + aw < vpX || ax > vpX + vpW || ay + ah < vpY || ay > vpY + vpH) return;
    }
    // Wrap each annotation in save/restore to prevent clip leaks between annotations
    annotationCtx.save();
    drawAnnotation(annotationCtx, annotation);
    annotationCtx.restore();
  });

  annotationCtx.globalAlpha = 1;
  annotationCtx.globalCompositeOperation = 'source-over';

  // Draw watermarks in front of content
  renderWatermarksInFront(annotationCtx, curPage, annotationCanvas.width / effectiveScale, annotationCanvas.height / effectiveScale);

  // Draw selection highlight and handles (use selectedAnnotations array as source of truth)
  const _renderDoc = getActiveDocument();
  const selected = _renderDoc ? _renderDoc.selectedAnnotations : [];
  if (selected.length > 0) {
    for (const ann of selected) {
      if (ann.page !== curPage) continue;
      drawSelectionHandles(annotationCtx, ann);
    }
  }

  // Restore context
  annotationCtx.restore();

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

  // Draw element detection overlay (walls + rooms)
  drawElementDetectionOverlay(ctx, pageNum);

  annotations.forEach(annotation => {
    if (annotation.page !== pageNum) return;
    drawAnnotation(ctx, annotation);
  });

  // Draw watermarks in front of content
  renderWatermarksInFront(ctx, pageNum, width / effectiveScale, height / effectiveScale);

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
