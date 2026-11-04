// Pure geometry for "Resize Pages > scale content": the page content shrinks or
// grows by one factor and is centred in the new page. The annotations the app
// holds (top-left origin, scale 1) follow with x' = s * x + dx, y' = s * y + dy,
// and every size (box width/height, font size, line width) scales with s.
// No app imports, so it runs under plain `node --test`.

const PAAR_X_Y = [
  ['x', 'y'], ['startX', 'startY'], ['endX', 'endY'], ['leaderStartX', 'leaderStartY'],
  ['leaderEndX', 'leaderEndY'], ['labelX', 'labelY'], ['cx', 'cy'], ['arrowX', 'arrowY'],
  ['kneeX', 'kneeY'], ['tipX', 'tipY'],
];
const PUNT_OBJECTEN = ['at', 'vertex', 'point1', 'point2'];
const PUNT_LIJSTEN = ['points', 'path', 'controlPoints', 'vertices'];
const AFMETINGEN = ['width', 'height', 'radius', 'radiusX', 'radiusY', 'fontSize', 'lineWidth', 'headSize', 'inkMinWidth', 'frameWidth', 'leaderLineWidth'];

/** The factor that makes (oldW x oldH) fit inside (newW x newH), and the offset that centres it. */
export function schaalVoorPassen(oldW, oldH, newW, newH) {
  const s = Math.min(newW / oldW, newH / oldH);
  return { s, dx: (newW - oldW * s) / 2, dy: (newH - oldH * s) / 2 };
}

const punt = (p, s, dx, dy) => ({
  ...p,
  x: typeof p.x === 'number' ? p.x * s + dx : p.x,
  y: typeof p.y === 'number' ? p.y * s + dy : p.y,
});

/** Scale an annotation in place about the page origin, then translate it by (dx, dy). */
export function scaleAnnotationGeometry(ann, s, dx, dy) {
  for (const [kx, ky] of PAAR_X_Y) {
    if (typeof ann[kx] === 'number') ann[kx] = ann[kx] * s + dx;
    if (typeof ann[ky] === 'number') ann[ky] = ann[ky] * s + dy;
  }
  for (const k of PUNT_OBJECTEN) {
    if (ann[k] && typeof ann[k] === 'object') ann[k] = punt(ann[k], s, dx, dy);
  }
  for (const k of PUNT_LIJSTEN) {
    if (Array.isArray(ann[k])) ann[k] = ann[k].map((p) => punt(p, s, dx, dy));
  }
  if (Array.isArray(ann.holes)) ann.holes = ann.holes.map((h) => (Array.isArray(h) ? h.map((p) => punt(p, s, dx, dy)) : h));
  if (Array.isArray(ann.rects)) {
    ann.rects = ann.rects.map((r) => ({
      ...r,
      x: r.x * s + dx, y: r.y * s + dy,
      ...(typeof r.width === 'number' ? { width: r.width * s } : {}),
      ...(typeof r.height === 'number' ? { height: r.height * s } : {}),
    }));
  }
  if (Array.isArray(ann.quadPoints)) {
    ann.quadPoints = ann.quadPoints.map((q) => (Array.isArray(q) ? q.map((v, i) => v * s + (i % 2 === 0 ? dx : dy)) : q));
  }
  if (Array.isArray(ann.leaders)) {
    ann.leaders = ann.leaders.map((l) => {
      const o = { ...l };
      for (const [kx, ky] of [['tipX', 'tipY'], ['kneeX', 'kneeY']]) {
        if (typeof o[kx] === 'number') o[kx] = o[kx] * s + dx;
        if (typeof o[ky] === 'number') o[ky] = o[ky] * s + dy;
      }
      return o;
    });
  }
  for (const k of AFMETINGEN) {
    if (typeof ann[k] === 'number') ann[k] = ann[k] * s;
  }
  if (Array.isArray(ann.textRuns)) {
    // tekstopmaak per stuk heeft geen eigen lettergrootte; fontSize van de annotatie volstaat
  }
}
