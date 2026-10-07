// Stable, document-scoped text spans for the MCP text editing tools.
// PDF.js often emits one item per glyph; merge nearby items on the same
// baseline so a translation client receives words/lines instead of letters.
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

function itemBox(item, viewport) {
  const m = multiply(viewport.transform, item.transform);
  const height = Math.max(1, Math.hypot(m[2], m[3]));
  const width = Math.max(0, item.width * viewport.scale);
  const direction = Math.hypot(m[0], m[1]) || 1;
  const dx = m[0] / direction * width, dy = m[1] / direction * width;
  const xs = [m[4], m[4] + dx, m[4] + m[2], m[4] + dx + m[2]];
  const ys = [m[5], m[5] + dy, m[5] + m[3], m[5] + dy + m[3]];
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    baseline: [m[4], m[5]], advance: [m[4] + dx, m[5] + dy],
    direction: [m[0] / direction, m[1] / direction],
    fontSize: Math.max(1, Math.hypot(item.transform[2], item.transform[3])),
    rotation: Math.atan2(item.transform[1], item.transform[0]) * 180 / Math.PI,
  };
}

export function pageTextSpans(items, styles, viewport, documentId, pageNumber, colors = []) {
  const spans = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const { first, last, bbox, text, fontName, fontFamily, fontSize, rotation, pdfAnchor, pdfWidth, itemCount, color } = current;
    spans.push({
      id: `${documentId}:p${pageNumber}:i${first}-${last}`,
      text, bbox, fontName, fontFamily, fontSize, rotation,
      color, colorSource: color ? 'pdf-operators' : 'unavailable',
      pdfAnchor, pdfWidth, itemCount,
    });
    current = null;
  };
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (typeof item?.str !== 'string' || !item.str.trim()) {
      if (item?.hasEOL) flush();
      continue;
    }
    const box = itemBox(item, viewport);
    const fontName = item.fontName || '';
    const color = colors[index] || null;
    const last = current;
    const sameLine = last && last.fontName === fontName && last.color === color
      && Math.abs(last.rotation - box.rotation) < 2
      && Math.abs(last.fontSize - box.fontSize) < Math.max(1, box.fontSize * 0.2)
      && Math.abs((box.baseline[0] - last.baseline[0]) * -box.direction[1]
        + (box.baseline[1] - last.baseline[1]) * box.direction[0])
        < Math.max(2, box.fontSize * viewport.scale * 0.35);
    const gap = last ? (box.baseline[0] - last.advance[0]) * box.direction[0]
      + (box.baseline[1] - last.advance[1]) * box.direction[1] : 0;
    const join = sameLine && gap >= -box.fontSize * viewport.scale * 0.3
      && gap <= box.fontSize * viewport.scale * 0.8;
    if (!join) {
      flush();
      current = {
        first: index, last: index, text: item.str, fontName, color,
        fontFamily: styles?.[fontName]?.fontFamily || '', fontSize: box.fontSize,
        rotation: box.rotation,
        pdfAnchor: { x: item.transform[4], y: item.transform[5] },
        pdfWidth: item.width, itemCount: 1,
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
        baseline: box.baseline, advance: box.advance,
      };
    } else {
      if (gap > box.fontSize * viewport.scale * 0.28 && !current.text.endsWith(' ') && !item.str.startsWith(' ')) current.text += ' ';
      current.text += item.str;
      current.last = index;
      current.itemCount++;
      const rad = box.rotation * Math.PI / 180;
      const fromAnchor = (item.transform[4] - current.pdfAnchor.x) * Math.cos(rad)
        + (item.transform[5] - current.pdfAnchor.y) * Math.sin(rad);
      current.pdfWidth = Math.max(current.pdfWidth, fromAnchor + item.width);
      const b = current.bbox;
      const right = Math.max(b.x + b.width, box.x + box.width);
      const bottom = Math.max(b.y + b.height, box.y + box.height);
      b.x = Math.min(b.x, box.x); b.y = Math.min(b.y, box.y);
      b.width = right - b.x; b.height = bottom - b.y;
      current.advance = box.advance;
    }
    if (item.hasEOL) flush();
  }
  flush();
  return spans;
}
