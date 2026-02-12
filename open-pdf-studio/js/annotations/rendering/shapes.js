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
export function drawTextboxContent(ctx, annotation, padding = 0) {
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
