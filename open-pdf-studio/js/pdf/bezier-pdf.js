// Exacte kubische appearance + standaard /Vertices als benadering. De eigen
// metadata bewaart onafhankelijke grepen in absolute PDF-coördinaten. Een
// externe wijziging van /Vertices maakt die metadata ongeldig: dan wint de
// standaardgeometrie en zetten we nooit verouderde grepen terug.
import { contourSegments, contourBounds, flattenContour, hasBezierHandles, mapContourNode, transformContour } from '../annotations/bezier-contour.js';

export const BEZIER_META_LIMIT = 2_000_000;
const MAX_NODES = 4096, MAX_VERTICES = 131072;
const validPoint = p => p && typeof p === 'object' && ['x','y'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 1e7);
const cleanPoint = p => ({ x: p.x, y: p.y });
const cleanNode = p => ({ ...cleanPoint(p), ...(p.incoming ? { incoming: cleanPoint(p.incoming) } : {}), ...(p.outgoing ? { outgoing: cleanPoint(p.outgoing) } : {}) });

export function prepareBezierPDF(points, closed, X, Y, lineWidth = 1) {
  if (!hasBezierHandles(points)) return null;
  const nodes = transformContour(points, [1,0,0,1,0,0], closed)
    .map(p => cleanNode(mapContourNode(p, q => ({ x: X(q.x), y: Y(q.y) }))));
  if (nodes.length > MAX_NODES || nodes.some(p => !validPoint(p) || ['incoming','outgoing'].some(k => p[k] && !validPoint(p[k])))) {
    throw new Error('Bezier contour exceeds PDF coordinate/node limits');
  }
  const vertices = [nodes[0].x,nodes[0].y];
  for (const segment of contourSegments(nodes, closed)) {
    const pair = segment.kind === 'cubic'
      ? [{...segment.start,outgoing:segment.c1},{...segment.end,incoming:segment.c2}]
      : [segment.start,segment.end];
    const flat = flattenContour(pair, false, 0.1, 12);
    if (flat.truncated || vertices.length + (flat.points.length-1)*2 > MAX_VERTICES) throw new Error('Bezier contour cannot be flattened within PDF limits');
    for (const p of flat.points.slice(1)) vertices.push(p.x,p.y);
  }
  if (closed) vertices.splice(-2);
  const metadata = JSON.stringify({ version: 1, closed, nodes, vertices });
  if (metadata.length > BEZIER_META_LIMIT) throw new Error('Bezier metadata exceeds PDF limits');
  const b = contourBounds(nodes, closed);
  // Miter limit 10: even a join at a sharp tangent cannot leave this box.
  const pad = Math.max(1, Math.abs(lineWidth) * 5);
  return { nodes, vertices, metadata, rect: [b.x-pad,b.y-pad,b.x+b.width+pad,b.y+b.height+pad] };
}

export function readBezierPDF(raw, vertices, closed, convertPoint) {
  if (typeof raw !== 'string' || raw.length > BEZIER_META_LIMIT) return null;
  try {
    const v = JSON.parse(raw);
    if (v?.version !== 1 || v.closed !== closed || !Array.isArray(v.nodes) || v.nodes.length < (closed?3:2) || v.nodes.length > MAX_NODES) return null;
    if (!Array.isArray(v.vertices) || v.vertices.length > MAX_VERTICES || v.vertices.length !== vertices?.length) return null;
    if (!v.vertices.every((n,i) => Number.isFinite(n) && Number.isFinite(vertices[i]) && Math.abs(n-vertices[i]) <= 0.001)) return null;
    if (!hasBezierHandles(v.nodes) || v.nodes.some(p => !validPoint(p) || ['incoming','outgoing'].some(k => p[k] != null && !validPoint(p[k])))) return null;
    return v.nodes.map(p => mapContourNode(cleanNode(p), q => {
      const [x,y] = convertPoint(q.x,q.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid viewport point');
      return {x,y};
    }));
  } catch { return null; }
}

export function bezierPDFPath(points, closed, X = x=>x, Y = y=>y) {
  const f = n => Number(n.toFixed(6));
  const xy = p => `${f(X(p.x))} ${f(Y(p.y))}`;
  let ops = `${xy(points[0])} m\n`;
  for (const segment of contourSegments(points,closed)) {
    ops += segment.kind === 'cubic' ? `${xy(segment.c1)} ${xy(segment.c2)} ${xy(segment.end)} c\n` : `${xy(segment.end)} l\n`;
  }
  return ops + (closed ? 'h\n' : '');
}
