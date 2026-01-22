import { HANDLE_SIZE, HANDLE_TYPES } from '../core/constants.js';
import { state } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { getAnnotationHandles } from './handles.js';
import { updateStatusAnnotations } from '../ui/status-bar.js';
import { updateAnnotationsList } from '../ui/annotations-list.js';

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
function drawTextboxContent(ctx, annotation, padding = 5) {
  if (!annotation.text) return;

  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || 1.5;
  const lineHeight = fontSize * lineSpacing;

  // Build font string with style options
  const fontFamily = annotation.fontFamily || 'Arial';
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  ctx.fillStyle = annotation.textColor || annotation.color || '#000000';
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;

  // Get text alignment
  const textAlign = annotation.textAlign || 'left';
  const maxWidth = width - padding * 2;

  // Word wrap text with newline support
  const paragraphs = annotation.text.split('\n');
  let y = annotation.y + fontSize + padding;

  for (let p = 0; p < paragraphs.length; p++) {
    if (y > annotation.y + height - padding) break;

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
          ctx.moveTo(textX, y + 2);
          ctx.lineTo(textX + lineWidth, y + 2);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw strikethrough if enabled
        if (annotation.fontStrikethrough) {
          ctx.beginPath();
          ctx.moveTo(textX, y - fontSize / 3);
          ctx.lineTo(textX + lineWidth, y - fontSize / 3);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        line = words[i] + ' ';
        y += lineHeight;
        if (y > annotation.y + height - padding) break;
      } else {
        line = testLine;
      }
    }
    if (y <= annotation.y + height - padding && line.trim()) {
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
        ctx.moveTo(textX, y + 2);
        ctx.lineTo(textX + lineWidth, y + 2);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (annotation.fontStrikethrough) {
        ctx.beginPath();
        ctx.moveTo(textX, y - fontSize / 3);
        ctx.lineTo(textX + lineWidth, y - fontSize / 3);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      y += lineHeight;
    }
  }
}

// Draw arrowhead at specified position
function drawArrowheadOnCanvas(ctx, x, y, angle, size, style) {
  const halfAngle = Math.PI / 6; // 30 degrees

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

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

// Draw single annotation
function drawAnnotation(ctx, annotation) {
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

  switch (annotation.type) {
    case 'draw':
      ctx.strokeStyle = strokeColor;
      ctx.beginPath();
      annotation.path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      break;

    case 'highlight':
      ctx.fillStyle = fillColor;
      ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      break;

    case 'line':
      ctx.strokeStyle = strokeColor;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      break;

    case 'arrow':
      ctx.strokeStyle = strokeColor;
      // Use fillColor for arrowhead fill (closed styles), fallback to strokeColor
      const arrowFillColor = annotation.fillColor || strokeColor;
      ctx.fillStyle = arrowFillColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Set border/line style
      const arrowBorderStyle = annotation.borderStyle || 'solid';
      if (arrowBorderStyle === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (arrowBorderStyle === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }

      // Draw the line
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();

      // Reset line dash for arrowheads
      ctx.setLineDash([]);

      // Draw arrowhead at end
      const endHead = annotation.endHead || 'open';
      const startHead = annotation.startHead || 'none';
      const headSize = annotation.headSize || 12;

      if (endHead !== 'none') {
        const endAngle = Math.atan2(annotation.endY - annotation.startY, annotation.endX - annotation.startX);
        drawArrowheadOnCanvas(ctx, annotation.endX, annotation.endY, endAngle, headSize, endHead);
      }

      // Draw arrowhead at start (if enabled)
      if (startHead !== 'none') {
        const startAngle = Math.atan2(annotation.startY - annotation.endY, annotation.startX - annotation.endX);
        drawArrowheadOnCanvas(ctx, annotation.startX, annotation.startY, startAngle, headSize, startHead);
      }
      break;

    case 'polyline':
      if (annotation.points && annotation.points.length >= 2) {
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        annotation.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
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
      ctx.stroke();
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
      ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.restore();
      break;

    case 'polygon':
      ctx.strokeStyle = strokeColor;
      drawPolygonShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
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

    case 'text':
      ctx.fillStyle = annotation.color;
      ctx.font = `${annotation.fontSize || 16}px Arial`;
      ctx.fillText(annotation.text, annotation.x, annotation.y);
      break;

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
  }
}

// Draw selection highlight and handles
function drawSelectionHandles(ctx, annotation) {
  // Selection outline style - thin, subtle dashed line
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

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
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25);
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
      ctx.beginPath();
      ctx.moveTo(annotation.x + selCW/2, annotation.y - 2);
      ctx.lineTo(annotation.x + selCW/2, annotation.y - 25);
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
      // Draw line from top center to rotation handle (green color)
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(annotation.x + selTbWidth/2, annotation.y - 2);
      ctx.lineTo(annotation.x + selTbWidth/2, annotation.y - 25);
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
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25);
      ctx.stroke();
      break;
  }

  ctx.setLineDash([]);

  // Draw resize/move handles
  const handles = getAnnotationHandles(annotation);
  const hs = HANDLE_SIZE;

  handles.forEach(handle => {
    const cx = handle.x + hs / 2;
    const cy = handle.y + hs / 2;

    // Draw rotation handle as a circle with rotation icon (green color)
    if (handle.type === HANDLE_TYPES.ROTATE) {
      // Outer circle
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2 + 1, 0, 2 * Math.PI);
      ctx.fill();
      // Inner rotation arrow icon
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.stroke();
      // Small arrow head
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy + 2);
      ctx.lineTo(cx - 2, cy + 4);
      ctx.lineTo(cx - 4, cy + 3);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    // Draw circular handles for all types (cleaner look)
    // White fill with subtle shadow effect
    ctx.beginPath();
    ctx.arc(cx, cy, hs / 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1;
    ctx.stroke();

    // For corner handles, add a small inner dot
    if ([HANDLE_TYPES.TOP_LEFT, HANDLE_TYPES.TOP_RIGHT, HANDLE_TYPES.BOTTOM_LEFT, HANDLE_TYPES.BOTTOM_RIGHT].includes(handle.type)) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, 2 * Math.PI);
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
      ctx.lineWidth = 1;
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

// Redraw all annotations (single page mode)
export function redrawAnnotations() {
  if (!annotationCtx || !annotationCanvas) return;

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Apply scale transformation for zooming
  annotationCtx.save();
  annotationCtx.scale(state.scale, state.scale);

  // Draw all annotations for current page
  state.annotations.forEach(annotation => {
    if (annotation.page !== state.currentPage) return;
    drawAnnotation(annotationCtx, annotation);
  });

  annotationCtx.globalAlpha = 1;

  // Draw selection highlight and handles
  if (state.selectedAnnotation && state.selectedAnnotation.page === state.currentPage) {
    drawSelectionHandles(annotationCtx, state.selectedAnnotation);
  }

  // Restore context
  annotationCtx.restore();

  // Update annotation count in status bar
  updateStatusAnnotations();

  // Update annotations list panel
  updateAnnotationsList();
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
}
