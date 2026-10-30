// Direct editing of straight area-measurement contours, including inner rings.
export function isAreaContour(ann) {
  return ann?.type === 'measureArea' && Array.isArray(ann.points) && ann.points.length >= 3;
}

export function areaVertexHit(ann, x, y, tolerance) {
  if (!isAreaContour(ann) || !Number.isFinite(x + y + tolerance) || tolerance <= 0) return null;
  const rings = [ann.points, ...(ann.holes || [])];
  let vertex = null, edge = null, vd = tolerance, ed = tolerance;
  rings.forEach((ring, ri) => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    ring.forEach((p, i) => {
      const distance = Math.hypot(x - p.x, y - p.y);
      if (distance <= vd) { vd = distance; vertex = { kind: 'areaVertex', holeIndex: ri - 1, nodeIndex: i }; }
      const q = ring[(i + 1) % ring.length];
      // An arc's control point cannot be represented by a straight-edge split.
      if (q.arc) return;
      const dx = q.x - p.x, dy = q.y - p.y, length2 = dx * dx + dy * dy;
      if (!length2) return;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / length2));
      const point = { x: p.x + t * dx, y: p.y + t * dy };
      const d = Math.hypot(x - point.x, y - point.y);
      if (d <= ed) { ed = d; edge = { kind: 'areaEdge', holeIndex: ri - 1, edgeIndex: i, point }; }
    });
  });
  const hit = vertex || edge;
  return hit ? { ...hit, annotationId: ann.id } : null;
}

export function editAreaVertex(ann, hit, midpoint = false) {
  if (!isAreaContour(ann) || ann.locked || hit?.annotationId !== ann.id) return null;
  const ring = hit.holeIndex === -1 ? ann.points : ann.holes?.[hit.holeIndex];
  if (!Array.isArray(ring)) return null;
  const points = ring.map(p => ({ ...p }));
  if (hit.kind === 'areaVertex') {
    const i = hit.nodeIndex;
    if (!Number.isInteger(i) || i < 0 || i >= points.length || points.length <= 3) return null;
    // Preserve curved neighbours; their joined curve needs an explicit contour edit.
    if (points[i].arc || points[(i + 1) % points.length].arc) return null;
    points.splice(i, 1);
  } else if (hit.kind === 'areaEdge') {
    const i = hit.edgeIndex;
    if (!Number.isInteger(i) || i < 0 || i >= points.length) return null;
    const p = points[i], q = points[(i + 1) % points.length];
    if (q.arc) return null;
    const point = midpoint ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : hit.point;
    if (!point || !Number.isFinite(point.x + point.y) || Math.hypot(point.x-p.x, point.y-p.y) < 1e-6 || Math.hypot(point.x-q.x, point.y-q.y) < 1e-6) return null;
    points.splice(i + 1, 0, { ...point });
  } else return null;
  return hit.holeIndex === -1 ? { points } : { holes: ann.holes.map((r, i) => i === hit.holeIndex ? points : r) };
}
