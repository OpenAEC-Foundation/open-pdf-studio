import { state, getActiveDocument } from '../core/state.js';
import { OPS } from 'pdfjs-dist';
import { getPageRotation } from '../core/state.js';
import { slaSnapExtractieOver } from './snap-extractie-beleid.js';

/**
 * PDF Vector Geometry Snap Extractor
 *
 * Parses pdf.js page.getOperatorList() to extract vector geometry
 * (lines, rectangles, curves) and produces snap points + edge segments
 * in the annotation coordinate system (CSS pixels at scale=1).
 *
 * In pdf.js v5.x, constructPath (OPS 91) bundles both path drawing AND
 * the paint operation. Args format:
 *   a[0] = paint OPS code (stroke=20, fill=22, endPath=28, etc.)
 *   a[1] = [interleavedData] — flat array of [op, coords..., op, coords...]
 *   a[2] = minMax bounding box
 *
 * DrawOPS sub-opcodes in the interleaved data:
 *   0=moveTo(x,y), 1=lineTo(x,y), 2=curveTo(6 args),
 *   3=quadraticCurveTo(4 args), 4=closePath(0 args)
 *
 * Results are cached per page and cleared on document switch.
 */

// DrawOPS constants (used inside constructPath interleaved data)
const DRAW_MOVETO = 0;
const DRAW_LINETO = 1;
const DRAW_CURVETO = 2;
const DRAW_QUADRATIC = 3;
const DRAW_CLOSEPATH = 4;

// Cache: pageNum → { points: [...], edges: [...], index: {...} }
const pageCache = new Map();

// Spatial-hash cell size in annotation space (CSS px at scale=1). Snap queries
// only ever inspect cells overlapping the cursor's snap radius (~12 px), so
// candidate lookup is O(local) instead of O(all-geometry-on-the-page). This
// keeps snapping responsive on dense CAD drawings that yield tens of thousands
// of vector points/edges per page.
const GRID_CELL = 48;
// Edges whose grid-cell footprint exceeds this are stored in an "always check"
// list instead of being rasterised into every cell they cross — bounds the
// index build cost for page-spanning lines.
const EDGE_CELL_SPAN_CAP = 256;

function _cellCoord(v) { return Math.floor(v / GRID_CELL); }
function _cellKey(cx, cy) { return cx + ',' + cy; }

// Currently running extraction promises (to avoid duplicate work)
const pendingExtractions = new Map();

/**
 * Prefetch PDF vector geometry for a single page (fire-and-forget).
 */
export function prefetchPdfVectorGeometry(pageNum) {
  if (pageCache.has(pageNum)) return;
  if (pendingExtractions.has(pageNum)) return;

  const promise = extractPageGeometry(pageNum)
    .then(result => {
      pageCache.set(pageNum, result);
    })
    .catch(() => {
      // Silently ignore extraction errors
    })
    .finally(() => {
      pendingExtractions.delete(pageNum);
    });

  pendingExtractions.set(pageNum, promise);
}

/**
 * Load PDF vector snap data for all pages. Returns a promise.
 * Called on-demand when user activates snap-to-drawing.
 */
export async function loadAllPdfSnapData() {
  const pdfDoc = getActiveDocument()?.pdfDoc;
  if (!pdfDoc) return;

  const total = pdfDoc.numPages;
  const promises = [];
  for (let p = 1; p <= total; p++) {
    if (!pageCache.has(p) && !pendingExtractions.has(p)) {
      prefetchPdfVectorGeometry(p);
    }
    if (pendingExtractions.has(p)) {
      promises.push(pendingExtractions.get(p));
    }
  }
  await Promise.all(promises);
}

/**
 * Check if snap data is loaded for the current page.
 */
export function isPdfSnapLoaded(pageNum) {
  return pageCache.has(pageNum);
}

/**
 * Get ALL cached snap points for a page (synchronous).
 * Returns empty array if not yet extracted.
 * Prefer getPdfSnapPointsNear() on the hot mousemove path — this full-set
 * accessor is for one-shot consumers (e.g. move-session candidate caching).
 */
export function getCachedPdfSnapPoints(pageNum) {
  const cached = pageCache.get(pageNum);
  return cached ? cached.points : [];
}

/**
 * Get ALL cached edge segments for a page (synchronous).
 * Returns empty array if not yet extracted.
 */
export function getCachedPdfEdgeSegments(pageNum) {
  const cached = pageCache.get(pageNum);
  return cached ? cached.edges : [];
}

/**
 * Get snap points within `radius` (annotation px) of (x,y) on a page.
 * Uses the spatial index so cost scales with local density, not page total.
 */
export function getPdfSnapPointsNear(pageNum, x, y, radius) {
  const cached = pageCache.get(pageNum);
  if (!cached) return [];
  const idx = cached.index;
  if (!idx) return cached.points; // legacy cache without index — fall back
  const minCx = _cellCoord(x - radius), maxCx = _cellCoord(x + radius);
  const minCy = _cellCoord(y - radius), maxCy = _cellCoord(y + radius);
  const out = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const bucket = idx.pointGrid.get(_cellKey(cx, cy));
      if (bucket) {
        for (let k = 0; k < bucket.length; k++) out.push(cached.points[bucket[k]]);
      }
    }
  }
  return out;
}

/**
 * Get edge segments near (x,y) within `radius`. Deduplicated (an edge may span
 * several queried cells). Includes page-spanning "oversized" edges.
 */
export function getPdfEdgeSegmentsNear(pageNum, x, y, radius) {
  const cached = pageCache.get(pageNum);
  if (!cached) return [];
  const idx = cached.index;
  if (!idx) return cached.edges; // legacy cache without index — fall back
  const minCx = _cellCoord(x - radius), maxCx = _cellCoord(x + radius);
  const minCy = _cellCoord(y - radius), maxCy = _cellCoord(y + radius);
  const seen = new Set();
  const out = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      const bucket = idx.edgeGrid.get(_cellKey(cx, cy));
      if (bucket) {
        for (let k = 0; k < bucket.length; k++) {
          const ei = bucket[k];
          if (!seen.has(ei)) { seen.add(ei); out.push(cached.edges[ei]); }
        }
      }
    }
  }
  for (let k = 0; k < idx.edgeOversized.length; k++) {
    const ei = idx.edgeOversized[k];
    if (!seen.has(ei)) { seen.add(ei); out.push(cached.edges[ei]); }
  }
  return out;
}

/**
 * Build a uniform spatial-hash index over the extracted points and edges.
 * Points map to a single cell; edges are rasterised into every cell their
 * bounding box overlaps (unless that footprint exceeds EDGE_CELL_SPAN_CAP, in
 * which case the edge goes on an always-checked list).
 */
async function buildSpatialIndex(points, edges, checkActive = () => {}) {
  const pointGrid = new Map();
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && i % 2000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkActive();
    }
    const key = _cellKey(_cellCoord(points[i].x), _cellCoord(points[i].y));
    let bucket = pointGrid.get(key);
    if (!bucket) { bucket = []; pointGrid.set(key, bucket); }
    bucket.push(i);
  }

  const edgeGrid = new Map();
  const edgeOversized = [];
  for (let i = 0; i < edges.length; i++) {
    if (i > 0 && i % 2000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkActive();
    }
    const e = edges[i];
    const minCx = _cellCoord(Math.min(e.x1, e.x2));
    const maxCx = _cellCoord(Math.max(e.x1, e.x2));
    const minCy = _cellCoord(Math.min(e.y1, e.y2));
    const maxCy = _cellCoord(Math.max(e.y1, e.y2));
    const span = (maxCx - minCx + 1) * (maxCy - minCy + 1);
    if (span > EDGE_CELL_SPAN_CAP) {
      edgeOversized.push(i);
      continue;
    }
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = _cellKey(cx, cy);
        let bucket = edgeGrid.get(key);
        if (!bucket) { bucket = []; edgeGrid.set(key, bucket); }
        bucket.push(i);
      }
    }
  }

  return { pointGrid, edgeGrid, edgeOversized };
}

/**
 * Clear the entire cache (call on document switch).
 */
export function clearPdfVectorCache() {
  pageCache.clear();
  pendingExtractions.clear();
}

/**
 * Extract vector geometry from a PDF page's operator list.
 * Transforms all coordinates to annotation-space (CSS pixels at scale=1).
 */
export async function extractPageGeometry(pageNum, options = {}) {
  const doc = options.document || getActiveDocument();
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc) return { points: [], edges: [] };
  const checkActive = () => {
    if (options.signal?.aborted || (options.document && getActiveDocument() !== doc)) {
      throw new DOMException('Vector extraction aborted', 'AbortError');
    }
  };
  checkActive();

  // Rasterblad zonder vectorinhoud (gescande tekening: één grote JPEG)?
  // Dan niets uitlezen: getOperatorList() zou de hele afbeelding in
  // JavaScript decoderen (seconden per pagina) voor een lege snap-set.
  // Zie snap-extractie-beleid.js voor de smalle regel.
  if (doc.filePath) {
    const [{ getCachedPageType }, { pageContentBytes }] = await Promise.all([
      import('../pdf/page-type-cache.js'),
      import('../pdf/progressive-render.js'),
    ]);
    const pageType = getCachedPageType(doc.filePath, pageNum - 1);
    const contentBytes = pageType === 'tile' ? await pageContentBytes(doc.filePath, pageNum) : 0;
    if (slaSnapExtractieOver({ pageType, contentBytes })) {
      console.log(`[snap] p${pageNum}: rasterblad zonder vectorinhoud (${contentBytes} B) → geometrie-extractie overgeslagen`);
      return { points: [], edges: [] };
    }
  }

  const page = await pdfDoc.getPage(pageNum);
  checkActive();

  // Get viewport at scale 1 (annotation coordinate system)
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: 1 };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(vpOpts);
  const viewportTransform = viewport.transform;

  const opList = await page.getOperatorList();
  checkActive();

  // PDF transform matrix stack
  const matrixStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  // Final results
  const points = [];
  const edges = [];
  const pointSet = new Set(); // dedup

  const ops = opList.fnArray;
  const argsArray = opList.argsArray;

  for (let i = 0; i < ops.length; i++) {
    if (i % 2000 === 1999) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkActive();
    }
    const op = ops[i];
    const a = argsArray[i];

    switch (op) {
      case OPS.save:
        matrixStack.push(ctm.slice());
        break;

      case OPS.restore:
        if (matrixStack.length > 0) {
          ctm = matrixStack.pop();
        }
        break;

      case OPS.transform: {
        const [ta, tb, tc, td, te, tf] = a;
        ctm = multiplyMatrices(ctm, [ta, tb, tc, td, te, tf]);
        break;
      }

      case OPS.constructPath: {
        // pdf.js v5.x format:
        //   a[0] = paint OPS code (endPath=28, fill=22, stroke=20, etc.)
        //   a[1] = [interleavedPathData] — array containing one typed-array-like object
        //   a[2] = minMax bounding box
        const pathData = a[1]?.[0];
        if (!pathData || !pathData.length) break;

        // Parse interleaved path data and collect segments
        const segments = await parseInterleavedPathData(pathData, checkActive);

        // Commit all segments (even endPath — for snap purposes all geometry is useful)
        if (segments.length > 0) {
          await commitSegments(segments, ctm, viewportTransform, points, edges, pointSet, checkActive);
        }
        break;
      }

      case OPS.rectangle: {
        const [rx, ry, rw, rh] = a;
        const rectPath = [
          { x: rx, y: ry },
          { x: rx + rw, y: ry },
          { x: rx + rw, y: ry + rh },
          { x: rx, y: ry + rh },
          { x: rx, y: ry }
        ];
        await commitSegments([rectPath], ctm, viewportTransform, points, edges, pointSet, checkActive);
        break;
      }
    }
  }

  return { points, edges, index: await buildSpatialIndex(points, edges, checkActive) };
}

/**
 * Parse interleaved path data [op, args..., op, args...] into path segments.
 * Returns array of subpaths, where each subpath is an array of {x,y} points.
 */
async function parseInterleavedPathData(data, checkActive = () => {}) {
  const segments = [];
  let currentPath = [];
  let currentX = 0, currentY = 0;
  let i = 0;
  let nextYield = 10000;

  while (i < data.length) {
    if (i >= nextYield) {
      nextYield = i + 10000;
      await new Promise(resolve => setTimeout(resolve, 0));
      checkActive();
    }
    const drawOp = data[i++];

    switch (drawOp) {
      case DRAW_MOVETO: {
        // Flush previous subpath
        if (currentPath.length >= 2) {
          segments.push(currentPath);
        }
        currentX = data[i++];
        currentY = data[i++];
        currentPath = [{ x: currentX, y: currentY }];
        break;
      }

      case DRAW_LINETO: {
        currentX = data[i++];
        currentY = data[i++];
        currentPath.push({ x: currentX, y: currentY });
        break;
      }

      case DRAW_CURVETO: {
        const cp1x = data[i++], cp1y = data[i++];
        const cp2x = data[i++], cp2y = data[i++];
        const ex = data[i++], ey = data[i++];
        const startPt = { x: currentX, y: currentY };
        for (let s = 1; s <= 4; s++) {
          currentPath.push(cubicBezierPoint(
            startPt, { x: cp1x, y: cp1y }, { x: cp2x, y: cp2y }, { x: ex, y: ey }, s / 4
          ));
        }
        currentX = ex;
        currentY = ey;
        break;
      }

      case DRAW_QUADRATIC: {
        const qcpx = data[i++], qcpy = data[i++];
        const qex = data[i++], qey = data[i++];
        // Convert quadratic to cubic control points
        const qcp1x = currentX + 2 / 3 * (qcpx - currentX);
        const qcp1y = currentY + 2 / 3 * (qcpy - currentY);
        const qcp2x = qex + 2 / 3 * (qcpx - qex);
        const qcp2y = qey + 2 / 3 * (qcpy - qey);
        const startPt = { x: currentX, y: currentY };
        for (let s = 1; s <= 4; s++) {
          currentPath.push(cubicBezierPoint(
            startPt, { x: qcp1x, y: qcp1y }, { x: qcp2x, y: qcp2y }, { x: qex, y: qey }, s / 4
          ));
        }
        currentX = qex;
        currentY = qey;
        break;
      }

      case DRAW_CLOSEPATH:
        if (currentPath.length > 1) {
          currentPath.push({ x: currentPath[0].x, y: currentPath[0].y });
        }
        break;

      default:
        // Unknown op — skip (shouldn't happen)
        break;
    }
  }

  // Flush last subpath
  if (currentPath.length >= 2) {
    segments.push(currentPath);
  }

  return segments;
}

/**
 * Transform segments via CTM + viewport and produce snap points/edges.
 */
async function commitSegments(segments, ctm, viewportTransform, points, edges, pointSet, checkActive = () => {}) {
  for (let index = 0; index < segments.length; index++) {
    if (index > 0 && index % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkActive();
    }
    const path = segments[index];
    const transformed = path.map(pt => {
      // Apply CTM (PDF user space → PDF device space)
      const cx = ctm[0] * pt.x + ctm[2] * pt.y + ctm[4];
      const cy = ctm[1] * pt.x + ctm[3] * pt.y + ctm[5];
      // Apply viewport transform (PDF space → CSS pixel space)
      const vx = viewportTransform[0] * cx + viewportTransform[2] * cy + viewportTransform[4];
      const vy = viewportTransform[1] * cx + viewportTransform[3] * cy + viewportTransform[5];
      return { x: vx, y: vy };
    });

    for (let j = 0; j < transformed.length; j++) {
      const p = transformed[j];

      // Endpoint snap point
      const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
      if (!pointSet.has(key)) {
        pointSet.add(key);
        points.push({ x: p.x, y: p.y, type: 'endpoint', annotation: null });
      }

      // Edge segments + midpoint snap
      if (j < transformed.length - 1) {
        const q = transformed[j + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.5) {
          edges.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });

          const mx = (p.x + q.x) / 2;
          const my = (p.y + q.y) / 2;
          const mkey = `${Math.round(mx * 10)},${Math.round(my * 10)}`;
          if (!pointSet.has(mkey)) {
            pointSet.add(mkey);
            points.push({ x: mx, y: my, type: 'midpoint', annotation: null });
          }
        }
      }
    }
  }
}

/**
 * Multiply two 2D affine transform matrices [a,b,c,d,e,f].
 * Result = A * B (B applied first, then A).
 */
function multiplyMatrices(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ];
}

/**
 * Evaluate a point on a cubic bezier curve at parameter t.
 */
function cubicBezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  };
}
