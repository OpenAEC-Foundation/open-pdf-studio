import { state } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { updateStatusAnnotations } from '../ui/chrome/status-bar.js';
import { updateAnnotationsList } from '../ui/panels/annotations-list.js';

// Import from sub-modules
import { drawPolygonShape, drawCloudShape, drawTextboxContent } from './rendering/shapes.js';
import { drawArrowheadOnCanvas, applyBorderStyle } from './rendering/decorations.js';
import { drawSelectionHandles, drawMultiSelectionOutline, drawMultiSelectionBounds } from './rendering/selection.js';
import { updateQuickAccessButtons, updateContextualTabs, drawGrid, snapToGrid } from './rendering/ui-state.js';

// Re-export everything that external code needs
export { drawPolygonShape, drawCloudShape } from './rendering/shapes.js';
export { updateQuickAccessButtons, snapToGrid } from './rendering/ui-state.js';

// Draw single annotation
function drawAnnotation(ctx, annotation) {
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
  ctx.lineWidth = annotation.lineWidth || 3;
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
      const lw = annotation.lineWidth || 3;

      // Calculate bounding box with padding for arrowheads
      const pad = headSize + lw + 2;
      const minAX = Math.min(annotation.startX, annotation.endX) - pad;
      const minAY = Math.min(annotation.startY, annotation.endY) - pad;
      const maxAX = Math.max(annotation.startX, annotation.endX) + pad;
      const maxAY = Math.max(annotation.startY, annotation.endY) + pad;
      const offW = maxAX - minAX;
      const offH = maxAY - minAY;

      // Create offscreen canvas at scaled resolution to avoid pixelation when zoomed
      const arrowScale = state.scale || 1;
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

      offCtx.beginPath();
      offCtx.moveTo(annotation.startX, annotation.startY);
      offCtx.lineTo(annotation.endX, annotation.endY);
      offCtx.stroke();

      offCtx.setLineDash([]);

      if (endHead !== 'none') {
        const endAngle = Math.atan2(annotation.endY - annotation.startY, annotation.endX - annotation.startX);
        drawArrowheadOnCanvas(offCtx, annotation.endX, annotation.endY, endAngle, headSize, endHead);
      }

      if (startHead !== 'none') {
        const startAngle = Math.atan2(annotation.startY - annotation.endY, annotation.startX - annotation.endX);
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
      // Apply rotation if set
      if (annotation.rotation) {
        ctx.translate(ellipseCX, ellipseCY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-ellipseCX, -ellipseCY);
      }

      ctx.beginPath();
      ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'box':
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const boxCenterX = annotation.x + annotation.width / 2;
        const boxCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxCenterX, boxCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-boxCenterX, -boxCenterY);
      }

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'polygon':
      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      drawPolygonShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
      ctx.setLineDash([]);
      break;

    case 'cloud':
      ctx.strokeStyle = strokeColor;
      drawCloudShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
      break;

    case 'comment':
      // Draw comment icon with rotation support
      const cWidth = annotation.width || 24;
      const cHeight = annotation.height || 24;
      ctx.save();
      ctx.globalAlpha = baseOpacity;

      // Apply rotation if set
      if (annotation.rotation) {
        const cCenterX = annotation.x + cWidth / 2;
        const cCenterY = annotation.y + cHeight / 2;
        ctx.translate(cCenterX, cCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-cCenterX, -cCenterY);
      }

      ctx.fillStyle = annotation.fillColor || '#FFD700';
      ctx.fillRect(annotation.x, annotation.y, cWidth, cHeight);
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 2;
      ctx.strokeRect(annotation.x, annotation.y, cWidth, cHeight);

      // Draw note icon inside
      ctx.fillStyle = '#FFA500';
      ctx.font = `${Math.min(cWidth, cHeight) * 0.6}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F4DD}', annotation.x + cWidth/2, annotation.y + cHeight/2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      ctx.restore();

      // Draw text preview (outside rotation)
      if (annotation.text && !annotation.rotation) {
        ctx.globalAlpha = baseOpacity;
        ctx.fillStyle = '#000';
        ctx.font = '12px Arial';
        ctx.fillText(
          annotation.text.substring(0, 20) + (annotation.text.length > 20 ? '...' : ''),
          annotation.x + cWidth + 6,
          annotation.y + cHeight/2 + 4
        );
      }
      break;

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
      const tbLineWidth = annotation.lineWidth !== undefined ? annotation.lineWidth : 1;
      const tbBorderStyle = annotation.borderStyle || 'solid';

      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const tbCenterX = annotation.x + tbWidth / 2;
        const tbCenterY = annotation.y + tbHeight / 2;
        ctx.translate(tbCenterX, tbCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
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

      // Clip text to textbox bounds
      ctx.beginPath();
      ctx.rect(annotation.x, annotation.y, tbWidth, tbHeight);
      ctx.clip();

      // Draw text content
      drawTextboxContent(ctx, annotation);
      ctx.restore();
      break;

    case 'callout':
      // Draw callout annotation (text box with two-segment leader line)
      const coWidth = annotation.width || 150;
      const coHeight = annotation.height || 50;
      const coLineWidth = annotation.lineWidth !== undefined ? annotation.lineWidth : 1;
      const coBorderStyle = annotation.borderStyle || 'solid';

      // Set stroke style for leader line
      ctx.strokeStyle = annotation.strokeColor || strokeColor;
      ctx.lineWidth = coLineWidth > 0 ? coLineWidth : 1;

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
      const arrowSize = 10;
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6));
      ctx.stroke();

      ctx.save();
      // Apply rotation to text box if set
      if (annotation.rotation) {
        const coCenterX = annotation.x + coWidth / 2;
        const coCenterY = annotation.y + coHeight / 2;
        ctx.translate(coCenterX, coCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
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
      const img = state.imageCache.get(annotation.imageId);
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
      ctx.lineWidth = annotation.lineWidth || 1;
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
      ctx.lineWidth = annotation.lineWidth || 1;
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
      const stampImg = annotation.imageId ? state.imageCache.get(annotation.imageId) : null;
      if (stampImg && stampImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        ctx.drawImage(stampImg, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        ctx.restore();
      } else if (annotation.stampText) {
        // Text-based stamp
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);

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
      }
      break;
    }

    case 'signature': {
      // Render signature image
      const sigImg = annotation.imageId ? state.imageCache.get(annotation.imageId) : null;
      if (sigImg && sigImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
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
      ctx.lineWidth = annotation.lineWidth || 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();

      // Draw end markers
      const mdLen = 8;
      const mdAngle = Math.atan2(annotation.endY - annotation.startY, annotation.endX - annotation.startX);
      const perpAngle = mdAngle + Math.PI / 2;
      const px = Math.cos(perpAngle) * mdLen / 2;
      const py = Math.sin(perpAngle) * mdLen / 2;

      ctx.beginPath();
      ctx.moveTo(annotation.startX - px, annotation.startY - py);
      ctx.lineTo(annotation.startX + px, annotation.startY + py);
      ctx.moveTo(annotation.endX - px, annotation.endY - py);
      ctx.lineTo(annotation.endX + px, annotation.endY + py);
      ctx.stroke();

      // Draw measurement label
      if (annotation.measureText) {
        const midX = (annotation.startX + annotation.endX) / 2;
        const midY = (annotation.startY + annotation.endY) / 2;
        ctx.font = '11px Arial';
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.fillText(annotation.measureText, midX, midY - 6);
        ctx.textAlign = 'left';
      }
      break;
    }

    case 'measureArea': {
      // Area measurement polygon
      if (!annotation.points || annotation.points.length < 3) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = annotation.lineWidth || 1;
      ctx.fillStyle = (annotation.color || '#ff0000') + '20';
      ctx.setLineDash([4, 2]);

      ctx.beginPath();
      ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
      for (let i = 1; i < annotation.points.length; i++) {
        ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label at centroid
      if (annotation.measureText) {
        let cx = 0, cy = 0;
        for (const p of annotation.points) { cx += p.x; cy += p.y; }
        cx /= annotation.points.length;
        cy /= annotation.points.length;
        ctx.font = '11px Arial';
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.fillText(annotation.measureText, cx, cy);
        ctx.textAlign = 'left';
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
      ctx.lineWidth = annotation.lineWidth || 1;
      ctx.setLineDash([4, 2]);

      ctx.beginPath();
      ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
      for (let i = 1; i < annotation.points.length; i++) {
        ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertices
      for (const p of annotation.points) {
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw label near last point
      if (annotation.measureText && annotation.points.length > 0) {
        const lastPt = annotation.points[annotation.points.length - 1];
        ctx.font = '11px Arial';
        ctx.fillStyle = strokeColor;
        ctx.fillText(annotation.measureText, lastPt.x + 8, lastPt.y - 4);
      }
      break;
    }
  }
}

// Redraw all annotations (single page mode)
// Pass lightweight=true during drag/resize to skip expensive DOM updates
export function redrawAnnotations(lightweight = false) {
  if (!annotationCtx || !annotationCanvas) return;

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Apply scale transformation for zooming
  annotationCtx.save();
  annotationCtx.scale(state.scale, state.scale);

  // Draw grid overlay if enabled
  if (state.preferences.showGrid) {
    drawGrid(annotationCtx, annotationCanvas.width / state.scale, annotationCanvas.height / state.scale);
  }

  // Draw all annotations for current page
  state.annotations.forEach(annotation => {
    if (annotation.page !== state.currentPage) return;
    drawAnnotation(annotationCtx, annotation);
  });

  annotationCtx.globalAlpha = 1;
  annotationCtx.globalCompositeOperation = 'source-over';

  // Draw selection highlight and handles
  if (state.selectedAnnotations.length > 1) {
    // Multi-selection: draw individual selection outlines for each
    for (const ann of state.selectedAnnotations) {
      if (ann.page !== state.currentPage) continue;
      drawMultiSelectionOutline(annotationCtx, ann);
    }
    // Draw overall bounding box
    drawMultiSelectionBounds(annotationCtx);
  } else if (state.selectedAnnotation && state.selectedAnnotation.page === state.currentPage) {
    drawSelectionHandles(annotationCtx, state.selectedAnnotation);
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
export function renderAnnotationsForPage(ctx, pageNum, width, height) {
  ctx.clearRect(0, 0, width, height);

  // Apply scale transformation for zooming
  ctx.save();
  ctx.scale(state.scale, state.scale);

  state.annotations.forEach(annotation => {
    if (annotation.page !== pageNum) return;
    drawAnnotation(ctx, annotation);
  });

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
}
