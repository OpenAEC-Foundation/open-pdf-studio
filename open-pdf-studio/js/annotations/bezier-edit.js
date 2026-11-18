// Pure editing geometry shared by context actions and drag handles (#1169).
import { contourSegments, contourBounds, nearestContourPoint, splitContourSegment, straightenContourSegment } from './bezier-contour.js';
import { veelhoekPuntenOpScherm, regelmatigeVeelhoekPunten, zetVeelhoekOpScherm } from './veelhoek-punten.js';
import { isVreemdeTelling } from './telling.js';

export function bezierEditable(ann) {
  return ann?.type === 'polyline' || (ann?.type === 'polygon' && !isVreemdeTelling(ann));
}
export function bezierEditNodes(ann) {
  if (!bezierEditable(ann)) return null;
  if (ann.type === 'polyline') return JSON.parse(JSON.stringify(ann.points || []));
  if (ann.points?.length >= 3) return veelhoekPuntenOpScherm(ann);
  // Regular polygons are inscribed in the box; their vertex bounds need not
  // fill it (e.g. a pentagon). Do not remap those bounds back onto the box.
  const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
  const angle = (Number(ann.rotation) || 0) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  return regelmatigeVeelhoekPunten(ann, ann.sides).map(p => {
    const x = (p.x - cx) * (ann.flipX ? -1 : 1), y = (p.y - cy) * (ann.flipY ? -1 : 1);
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  });
}
function fields(ann, nodes) {
  return ann.type === 'polygon' ? zetVeelhoekOpScherm(ann, nodes) : { points: nodes, ...contourBounds(nodes) };
}
export function bezierPartAt(ann, x, y, tolerance) {
  const nodes = bezierEditNodes(ann);
  if (!nodes?.length) return null;
  let vertex = null, distance = tolerance;
  nodes.forEach((p, nodeIndex) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= distance) { distance = d; vertex = { kind: 'bezierVertex', nodeIndex, annotationId: ann.id }; }
  });
  if (vertex) return vertex;
  let hit = null; distance = tolerance;
  for (const segment of contourSegments(nodes, ann.type === 'polygon')) {
    const p = nearestContourPoint(segment, x, y);
    if (p.distance <= distance) {
      distance = p.distance;
      hit = { kind: 'bezierEdge', edgeIndex: segment.index, t: p.t, annotationId: ann.id };
    }
  }
  return hit;
}
export function editBezierSegment(ann, index, action, t = 0.5) {
  if (ann?.locked) return null;
  let nodes = bezierEditNodes(ann);
  if (!nodes) return null;
  const closed = ann.type === 'polygon';
  const segment = contourSegments(nodes, closed)[index];
  if (!Number.isInteger(index) || !segment) return null;
  if (action === 'curve') {
    if (segment.kind === 'cubic') return null;
    const a = nodes[index], b = nodes[segment.endIndex];
    a.outgoing = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    b.incoming = { x: a.x + 2 * (b.x - a.x) / 3, y: a.y + 2 * (b.y - a.y) / 3 };
  } else if (action === 'straight') nodes = straightenContourSegment(nodes, index, closed);
  else if (action === 'insert') {
    if (!(t > 0 && t < 1)) return null;
    nodes = splitContourSegment(nodes, index, t, closed);
  } else return null;
  return fields(ann, nodes);
}
export function deleteBezierNode(ann, index) {
  if (ann?.locked) return null;
  const nodes = bezierEditNodes(ann), closed = ann?.type === 'polygon';
  if (!nodes || nodes.length <= (closed ? 3 : 2) || !Number.isInteger(index) || !nodes[index]) return null;
  // Removing a node joins its neighbours with a straight segment. Controls
  // of their other segments remain independent and untouched.
  const before = index > 0 ? nodes[index - 1] : closed ? nodes.at(-1) : null;
  const after = index + 1 < nodes.length ? nodes[index + 1] : closed ? nodes[0] : null;
  if (before) delete before.outgoing;
  if (after) { delete after.incoming; delete after.arc; delete after.bulge; }
  nodes.splice(index, 1);
  return fields(ann, nodes);
}
export function moveBezierControl(ann, name, dx, dy) {
  if (ann?.locked || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const match = /^bezier_(incoming|outgoing)_(\d+)$/.exec(name);
  if (!match) return null;
  const nodes = bezierEditNodes(ann), p = nodes?.[+match[2]]?.[match[1]];
  if (!p) return null;
  p.x += dx; p.y += dy;
  return fields(ann, nodes);
}
