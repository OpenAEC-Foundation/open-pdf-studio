import { HANDLE_SIZE, HANDLE_TYPES } from '../core/constants.js';
import { state, isSelected, getSelectionBounds, getAnnotationBounds } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { getAnnotationHandles } from './handles.js';
import { updateStatusAnnotations } from '../ui/chrome/status-bar.js';
import { updateAnnotationsList } from '../ui/panels/annotations-list.js';

// Draw polygon shape
export function drawPolygonShape(ctx, x, y, width, height, sides = 6) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.stroke();
}

// Draw cloud shape (bumpy rectangle)
export function drawCloudShape(ctx, x, y, width, height) {
  const bumpRadius = Math.min(width, height) / 8;
  const numBumpsH = Math.max(3, Math.floor(width / (bumpRadius * 1.5)));
  const numBumpsV = Math.max(2, Math.floor(height / (bumpRadius * 1.5)));

  ctx.beginPath();

  // Top edge (left to right)
  const topSpacing = width / numBumpsH;
  for (let i = 0; i < numBumpsH; i++) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y, bumpRadius, Math.PI, 0, false);
  }

  // Right edge (top to bottom)
  const rightSpacing = height / numBumpsV;
  for (let i = 0; i < numBumpsV; i++) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x + width, by, bumpRadius, -Math.PI / 2, Math.PI / 2, false);
  }

  // Bottom edge (right to left)
  for (let i = numBumpsH - 1; i >= 0; i--) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y + height, bumpRadius, 0, Math.PI, false);
  }

  // Left edge (bottom to top)
  for (let i = numBumpsV - 1; i >= 0; i--) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x, by, bumpRadius, Math.PI / 2, -Math.PI / 2, false);
  }

  ctx.closePath();
  ctx.stroke();
}

// Draw textbox content with word wrap
function drawTextboxContent(ctx, annotation, padding = 3) {
  if (!annotation.text) return;

  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || 1.2;
  const lineHeight = fontSize * lineSpacing;

  // Build font string with style options
  const fontFamily = annotation.fontFamily || 'Arial';
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  ctx.fillStyle = annotation.textColor || annotation.color || '#000000';
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  // Get text alignment
  const textAlign = annotation.textAlign || 'left';
  const maxWidth = width - padding * 2;

  // Word wrap text with newline support
  const paragraphs = annotation.text.split('\n');
  let y = annotation.y + padding;

  for (let p = 0; p < paragraphs.length; p++) {
    if (y >= annotation.y + height) break;

    const words = paragraphs[p].split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        // Calculate x position based on alignment
        let textX = annotation.x + padding;
        const lineWidth = ctx.measureText(line.trim()).width;
        if (textAlign === 'center') {
          textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
        } else if (textAlign === 'right') {
          textX = annotation.x + width - padding - lineWidth;
        }

        ctx.fillText(line.trim(), textX, y);

        // Draw underline if enabled
        if (annotation.fontUnderline) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize + 1);
          ctx.lineTo(textX + lineWidth, y + fontSize + 1);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw strikethrough if enabled
        if (annotation.fontStrikethrough) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize * 0.6);
          ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        line = words[i] + ' ';
        y += lineHeight;
        if (y >= annotation.y + height) break;
      } else {
        line = testLine;
      }
    }
    if (y < annotation.y + height && line.trim()) {
      // Calculate x position based on alignment
      let textX = annotation.x + padding;
      const lineWidth = ctx.measureText(line.trim()).width;
      if (textAlign === 'center') {
        textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
      } else if (textAlign === 'right') {
        textX = annotation.x + width - padding - lineWidth;
      }

      ctx.fillText(line.trim(), textX, y);

      // Draw underline if enabled
      if (annotation.fontUnderline) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize + 1);
        ctx.lineTo(textX + lineWidth, y + fontSize + 1);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (annotation.fontStrikethrough) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize * 0.6);
        ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      y += lineHeight;
    }
  }
  ctx.textBaseline = 'alphabetic'; // Reset
}

// Draw arrowhead at specified position
function drawArrowheadOnCanvas(ctx, x, y, angle, size, style) {
  const halfAngle = Math.PI / 6; // 30 degrees

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;

  ctx.beginPath();
  if (style === 'open' || style === 'stealth') {
    // Open arrow style - two lines
    ctx.moveTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closed') {
    // Closed/filled arrow style - triangle
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'diamond') {
    // Diamond style
    const halfSize = size / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(-halfSize, -halfSize * 0.6);
    ctx.lineTo(-size, 0);
    ctx.lineTo(-halfSize, halfSize * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'circle') {
    // Circle style
    const radius = size / 3;
    ctx.arc(-radius, 0, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'square') {
    // Square style
    const halfSize = size / 3;
    ctx.rect(-size / 2 - halfSize, -halfSize, halfSize * 2, halfSize * 2);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'slash') {
    // Slash style - perpendicular line
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  }

  ctx.restore();
}

// Apply border style (dashed/dotted/solid) to canvas context
function applyBorderStyle(ctx, borderStyle) {
  if (borderStyle === 'dashed') {
    ctx.setLineDash([8, 4]);
  } else if (borderStyle === 'dotted') {
    ctx.setLineDash([2, 2]);
  } else {
    ctx.setLineDash([]);
  }
}

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
      // drawImage with dest size to map back to document coordinates
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
      ctx.fillText('📝', annotation.x + cWidth/2, annotation.y + cHeight/2);
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
        // Set line dash based on border style
        if (tbBorderStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        } else if (tbBorderStyle === 'dotted') {
          ctx.setLineDash([2, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(annotation.x, annotation.y, tbWidth, tbHeight);
        ctx.setLineDash([]); // Reset line dash
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
        // Default: connect from left or right edge based on arrow position
        if (arrowX < annotation.x + coWidth / 2) {
          armOriginX = annotation.x; // Left edge
        } else {
          armOriginX = annotation.x + coWidth; // Right edge
        }
        armOriginY = kneeY; // Same Y as knee for horizontal arm
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
        // Fallback to bounding box
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
        // Fallback to bounding box
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
        // Fallback to bounding box
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

// Draw selection highlight and handles
function drawSelectionHandles(ctx, annotation) {
  // Selection outline style - thin, subtle dashed line (scale-independent)
  const sc = state.scale || 1;
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1 / sc;
  ctx.setLineDash([3 / sc, 3 / sc]);

  switch (annotation.type) {
    case 'draw':
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x)) - 2;
        const minY = Math.min(...annotation.path.map(p => p.y)) - 2;
        const maxX = Math.max(...annotation.path.map(p => p.x)) + 2;
        const maxY = Math.max(...annotation.path.map(p => p.y)) + 2;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      }
      break;
    case 'line':
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      break;
    case 'circle':
      const selCircW = annotation.width || annotation.radius * 2;
      const selCircH = annotation.height || annotation.radius * 2;
      const selCircX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const selCircY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const circCenterX = selCircX + selCircW / 2;
        const circCenterY = selCircY + selCircH / 2;
        ctx.translate(circCenterX, circCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-circCenterX, -circCenterY);
      }
      ctx.strokeRect(selCircX - 2, selCircY - 2, selCircW + 4, selCircH + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(selCircX + selCircW/2, selCircY - 2);
      ctx.lineTo(selCircX + selCircW/2, selCircY - 25);
      ctx.stroke();
      ctx.restore();
      break;
    case 'box':
    case 'polygon':
    case 'cloud':
    case 'highlight':
    case 'redaction':
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const boxSelCenterX = annotation.x + annotation.width / 2;
        const boxSelCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxSelCenterX, boxSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-boxSelCenterX, -boxSelCenterY);
      }
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    case 'comment':
      const selCW = annotation.width || 24;
      const selCH = annotation.height || 24;
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selCW + 4, selCH + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + selCW/2, annotation.y - 2);
      ctx.lineTo(annotation.x + selCW/2, annotation.y - 25 / sc);
      ctx.stroke();
      break;
    case 'text':
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const fontSize = annotation.fontSize || 16;
        ctx.strokeRect(annotation.x - 2, annotation.y - fontSize - 2, textWidth + 4, fontSize + 4);
      }
      break;
    case 'textbox':
      const selTbWidth = annotation.width || 150;
      const selTbHeight = annotation.height || 50;
      ctx.save();
      // Apply rotation if set
      if (annotation.rotation) {
        const tbSelCenterX = annotation.x + selTbWidth / 2;
        const tbSelCenterY = annotation.y + selTbHeight / 2;
        ctx.translate(tbSelCenterX, tbSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-tbSelCenterX, -tbSelCenterY);
      }
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selTbWidth + 4, selTbHeight + 4);
      // Draw line from right center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + selTbWidth + 2, annotation.y + selTbHeight/2);
      ctx.lineTo(annotation.x + selTbWidth + 25 / sc, annotation.y + selTbHeight/2);
      ctx.stroke();
      ctx.restore();
      break;
    case 'callout':
      const selCoWidth = annotation.width || 150;
      const selCoHeight = annotation.height || 50;
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, selCoWidth + 4, selCoHeight + 4);
      // Draw selection indicators on arrow and knee points
      const selArrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const selArrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + selCoHeight;
      const selKneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const selKneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + selCoHeight / 2;
      ctx.beginPath();
      ctx.arc(selArrowX, selArrowY, 4, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(selKneeX, selKneeY, 4, 0, 2 * Math.PI);
      ctx.stroke();
      break;
    case 'polyline':
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        ctx.strokeRect(plMinX - 2, plMinY - 2, plMaxX - plMinX + 4, plMaxY - plMinY + 4);
      }
      break;
    case 'image':
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.lineWidth = 1 / sc;
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      break;
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Draw selection around the bounding box of all text rects
      ctx.strokeRect(annotation.x - 2, annotation.y - 2, annotation.width + 4, annotation.height + 4);
      break;
  }

  ctx.setLineDash([]);

  // Draw resize/move handles (scale-independent size)
  const scale = state.scale || 1;
  const handles = getAnnotationHandles(annotation, scale);
  const hs = HANDLE_SIZE / scale;
  const lw = 1 / scale;

  handles.forEach(handle => {
    const cx = handle.x + hs / 2;
    const cy = handle.y + hs / 2;

    // Draw rotation handle as a circle with rotation icon (green color)
    if (handle.type === HANDLE_TYPES.ROTATE) {
      // Outer circle
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2 + lw, 0, 2 * Math.PI);
      ctx.fill();
      // Inner rotation arrow icon
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 / scale, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.stroke();
      // Small arrow head
      const as = 2 / scale;
      ctx.beginPath();
      ctx.moveTo(cx - as, cy + as);
      ctx.lineTo(cx - as, cy + as * 2);
      ctx.lineTo(cx - as * 2, cy + as * 1.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    // Draw circular handles for all types (cleaner look)
    ctx.beginPath();
    ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = lw;
    ctx.stroke();

    // For corner handles, add a small inner dot
    if ([HANDLE_TYPES.TOP_LEFT, HANDLE_TYPES.TOP_RIGHT, HANDLE_TYPES.BOTTOM_LEFT, HANDLE_TYPES.BOTTOM_RIGHT].includes(handle.type)) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5 / scale, 0, 2 * Math.PI);
      ctx.fillStyle = '#0066cc';
      ctx.fill();
    }

    // For line endpoints, make them filled
    if (handle.type === HANDLE_TYPES.LINE_START || handle.type === HANDLE_TYPES.LINE_END) {
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#0066cc';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // Callout handles - diamond shape
    if (handle.type === HANDLE_TYPES.CALLOUT_ARROW || handle.type === HANDLE_TYPES.CALLOUT_KNEE) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - hs / 2);
      ctx.lineTo(cx + hs / 2, cy);
      ctx.lineTo(cx, cy + hs / 2);
      ctx.lineTo(cx - hs / 2, cy);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

// Draw outline for a single annotation in multi-selection
function drawMultiSelectionOutline(ctx, annotation) {
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  const bounds = getAnnotationBounds(annotation);
  if (bounds) {
    ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
  }
  ctx.setLineDash([]);
}

// Draw overall bounding box for multi-selection
function drawMultiSelectionBounds(ctx) {
  const bounds = getSelectionBounds();
  if (!bounds) return;

  const sc = state.scale || 1;
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1.5 / sc;
  ctx.setLineDash([6 / sc, 3 / sc]);
  const pad = 6 / sc;
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
  ctx.setLineDash([]);

  // Draw corner handles for the overall bounding box
  const hs = HANDLE_SIZE / sc;
  const corners = [
    { x: bounds.x - pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x - pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 }
  ];

  corners.forEach(corner => {
    const cx = corner.x + hs / 2;
    const cy = corner.y + hs / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.stroke();
  });
}

// Update quick access toolbar button states
export function updateQuickAccessButtons() {
  const qaSave = document.getElementById('qa-save');
  const qaSaveAs = document.getElementById('qa-save-as');
  const qaPrint = document.getElementById('qa-print');
  const qaUndo = document.getElementById('qa-undo');
  const qaRedo = document.getElementById('qa-redo');
  const qaPrevView = document.getElementById('qa-prev-view');
  const qaNextView = document.getElementById('qa-next-view');

  // Save/Save As/Print - enabled when PDF is loaded
  if (qaSave) qaSave.disabled = !state.pdfDoc;
  if (qaSaveAs) qaSaveAs.disabled = !state.pdfDoc;
  if (qaPrint) qaPrint.disabled = !state.pdfDoc;

  // Undo - enabled when undo stack has entries
  const doc = state.documents[state.activeDocumentIndex];
  if (qaUndo) qaUndo.disabled = !doc || !doc.undoStack || doc.undoStack.length === 0;

  // Redo - enabled when redo stack has entries
  if (qaRedo) qaRedo.disabled = !doc || !doc.redoStack || doc.redoStack.length === 0;

  // Previous/Next view - disabled (not implemented)
  if (qaPrevView) qaPrevView.disabled = true;
  if (qaNextView) qaNextView.disabled = true;
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

// Enable all buttons/inputs/styles in both contextual tabs
let _contextualTabsInitialized = false;
function initContextualTabsDisabled() {
  if (_contextualTabsInitialized) return;
  _contextualTabsInitialized = true;
  // All Format and Arrange tab controls are now implemented — enable everything
  ['tab-format', 'tab-arrange'].forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    tab.querySelectorAll('button').forEach(btn => btn.disabled = false);
    tab.querySelectorAll('select').forEach(sel => sel.disabled = false);
    tab.querySelectorAll('input').forEach(inp => inp.disabled = false);
    tab.querySelectorAll('.ribbon-style-item').forEach(el => el.classList.remove('disabled'));
  });
}

// Show/hide Format and Arrange contextual ribbon tabs
function updateContextualTabs() {
  initContextualTabsDisabled();
  const hasSelection = state.selectedAnnotations.length > 0;
  const hasLocked = hasSelection && state.selectedAnnotations.some(a => a.locked);
  const els = document.querySelectorAll('.contextual-tabs');
  els.forEach(el => {
    if (hasSelection) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
      // If a contextual tab was active, switch back to Home
      if (el.classList.contains('ribbon-tab') && el.classList.contains('active')) {
        el.classList.remove('active');
        const homeTab = document.querySelector('.ribbon-tab[data-tab="home"]');
        if (homeTab) homeTab.click();
      }
    }
  });
  // Disable/enable controls based on locked state
  ['tab-format', 'tab-arrange'].forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    tab.querySelectorAll('button').forEach(btn => btn.disabled = hasLocked);
    tab.querySelectorAll('select').forEach(sel => sel.disabled = hasLocked);
    tab.querySelectorAll('input').forEach(inp => inp.disabled = hasLocked);
    tab.querySelectorAll('.ribbon-style-item').forEach(el => {
      if (hasLocked) el.classList.add('disabled');
      else el.classList.remove('disabled');
    });
  });
  // Sync Format ribbon controls with selection
  if (hasSelection && !hasLocked) {
    try {
      import('../ui/chrome/format-ribbon.js').then(m => m.updateFormatRibbon());
    } catch (e) { /* ignore */ }
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

// Draw grid overlay
function drawGrid(ctx, width, height) {
  const gridSize = state.preferences.gridSize || 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = 0; x <= width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Snap a coordinate to the grid
export function snapToGrid(value) {
  if (!state.preferences.enableGridSnap) return value;
  const gridSize = state.preferences.gridSize || 10;
  return Math.round(value / gridSize) * gridSize;
}
