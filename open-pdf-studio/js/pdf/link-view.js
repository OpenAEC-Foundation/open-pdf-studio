// Destination geometry in the same (CropBox/rotation-aware) space as the page.
export function destinationView(info, viewport, width, height, scale, zoomUnit = 1) {
  const finite = Number.isFinite;
  const point = (x, y) => viewport.convertToViewportPoint(x, y);
  const [x0, , , y1] = viewport.viewBox;
  const availableW = Math.max(1, width - 24), availableH = Math.max(1, height - 24);
  let x = null, y = null, center = false, zoom = scale;
  if (info.type === 'FitR' && [info.left, info.bottom, info.right, info.top].every(finite)
      && info.right > info.left && info.top > info.bottom) {
    const a = point(info.left, info.bottom), b = point(info.right, info.top);
    const w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    zoom = Math.min(availableW / w, availableH / h);
    x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2; center = true;
  } else if (info.type === 'Fit' || info.type === 'FitB') {
    zoom = Math.min(availableW / viewport.width, availableH / viewport.height);
    x = viewport.width / 2; y = viewport.height / 2; center = true;
  } else {
    const p = point(info.left ?? x0, info.top ?? y1);
    // A null XYZ coordinate retains that viewport axis, including rotation.
    const quarterTurn = viewport.rotation % 180 !== 0;
    if (finite(info.left)) { if (quarterTurn) y = p[1]; else x = p[0]; }
    if (finite(info.top)) { if (quarterTurn) x = p[0]; else y = p[1]; }
    if (info.type === 'XYZ' && info.zoom > 0) zoom = info.zoom * zoomUnit;
    if (info.type === 'FitH' || info.type === 'FitBH') zoom = availableW / viewport.width;
    if (info.type === 'FitV' || info.type === 'FitBV') zoom = availableH / viewport.height;
  }
  return { x, y, center, scale: Math.max(0.0625, Math.min(64, finite(zoom) && zoom > 0 ? zoom : scale)) };
}

// PDF.js supplies RGB bytes and border widths in page units. Draw only the
// annotation's declared border; a transparent/zero-width link stays invisible.
export function linkBorder(ann, viewport, left, top) {
  const border = ann.borderStyle;
  if (!(border?.width > 0) || !ann.color || ann.color.length !== 3
      || !Array.from(ann.color).every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
  const [x0, y0, x1, y1] = ann.rect;
  const corners = border.style === 5 ? [[x0, y0], [x1, y0]]
    : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const points = corners.map(([x, y]) => {
    const p = viewport.convertToViewportPoint(x, y); return `${p[0] - left},${p[1] - top}`;
  });
  const dash = border.style === 2 && Array.isArray(border.dashArray)
    && border.dashArray.every(n => Number.isFinite(n) && n >= 0)
    ? border.dashArray.map(n => n * viewport.scale).join(' ') : '';
  return { path: `M${points.join(' L')}${border.style === 5 ? '' : ' Z'}`,
    width: border.width * viewport.scale, color: `rgb(${Array.from(ann.color).join(',')})`, dash };
}
