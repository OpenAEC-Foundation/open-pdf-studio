import { state, getPageRotation } from '../core/state.js';
import { OPS } from 'pdfjs-dist';

/**
 * PDF Object Extractor
 *
 * Parses pdf.js page.getOperatorList() to extract discrete PDF objects
 * (images, text blocks, vector shapes) for selection and manipulation.
 *
 * Reuses the CTM-tracking and graphics state pattern from pdf-element-detector.js.
 * Results are cached per page and cleared on document switch.
 */

// DrawOPS constants (inside constructPath interleaved data)
const DRAW_MOVETO = 0;
const DRAW_LINETO = 1;
const DRAW_CURVETO = 2;
const DRAW_QUADRATIC = 3;
const DRAW_CLOSEPATH = 4;

// Cache: pageNum → { images: [...], textBlocks: [...], vectors: [...] }
const objectCache = new Map();

/**
 * Extract all PDF objects from a page.
 * Returns { images: [...], textBlocks: [...], vectors: [...] }
 */
export async function extractPdfObjects(pageNum) {
  if (objectCache.has(pageNum)) {
    return objectCache.get(pageNum);
  }

  const pdfDoc = state.pdfDoc;
  if (!pdfDoc) return { images: [], textBlocks: [], vectors: [] };

  const page = await pdfDoc.getPage(pageNum);

  // Viewport at scale 1 (annotation coordinate system)
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: 1 };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(vpOpts);
  const viewportTransform = viewport.transform;

  const opList = await page.getOperatorList();

  // Extract images
  const images = extractImages(opList, viewportTransform, pageNum);

  // Extract text blocks
  const textContent = await page.getTextContent();
  const textBlocks = extractTextBlocks(textContent, viewportTransform, pageNum);

  // Extract vector shapes
  const vectors = extractVectors(opList, viewportTransform, pageNum);

  console.log(`[pdf-object-extractor] Page ${pageNum}: ${images.length} images, ${textBlocks.length} text blocks, ${vectors.length} vectors`);

  const result = { images, textBlocks, vectors };
  objectCache.set(pageNum, result);
  return result;
}

/**
 * Hit-test: find the topmost PDF object at (x, y) in annotation coordinate space.
 * Returns the object or null.
 */
export function findPdfObjectAt(x, y, pageNum) {
  const cached = objectCache.get(pageNum);
  if (!cached) return null;

  // Check in reverse order (last drawn = on top): images first, then text, then vectors
  // Images are typically drawn on top of vectors
  for (let i = cached.images.length - 1; i >= 0; i--) {
    if (pointInBbox(x, y, cached.images[i].bbox)) {
      return cached.images[i];
    }
  }

  for (let i = cached.textBlocks.length - 1; i >= 0; i--) {
    if (pointInBbox(x, y, cached.textBlocks[i].bbox)) {
      return cached.textBlocks[i];
    }
  }

  for (let i = cached.vectors.length - 1; i >= 0; i--) {
    if (pointInBbox(x, y, cached.vectors[i].bbox)) {
      return cached.vectors[i];
    }
  }

  return null;
}

/**
 * Get cached extraction results (synchronous).
 */
export function getCachedPdfObjects(pageNum) {
  return objectCache.get(pageNum) || null;
}

/**
 * Clear object cache (call on document switch).
 */
export function clearPdfObjectCache() {
  objectCache.clear();
}

// ─── Image extraction ───────────────────────────────────────────────

/**
 * Extract image objects from operator list.
 * Images are identified by paintImageXObject / paintJpegXObject operators.
 */
function extractImages(opList, viewportTransform, pageNum) {
  const matrixStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const images = [];
  let idx = 0;

  const ops = opList.fnArray;
  const argsArray = opList.argsArray;

  for (let i = 0; i < ops.length; i++) {
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

      case OPS.paintImageXObject:
      case OPS.paintJpegXObject: {
        // Image is drawn into a 1x1 unit square, CTM defines actual position/size
        const imageRef = a[0]; // XObject name (e.g. "img_p0_1")

        // The CTM maps the unit square [0,0]-[1,1] to the image position
        // Four corners of the unit square through CTM + viewport
        const corners = [
          transformPoint(0, 0, ctm, viewportTransform),
          transformPoint(1, 0, ctm, viewportTransform),
          transformPoint(1, 1, ctm, viewportTransform),
          transformPoint(0, 1, ctm, viewportTransform),
        ];

        const bbox = computeBboxFromPoints(corners);

        // Skip tiny images (likely artifacts or 1px lines)
        if (bbox.width < 5 || bbox.height < 5) break;

        images.push({
          id: `pdfobj-${pageNum}-img-${idx++}`,
          type: 'image',
          page: pageNum,
          bbox,
          imageRef,
          operatorIndex: i,
          operatorSignature: { op, imageRef },
        });
        break;
      }
    }
  }

  return images;
}

// ─── Text block extraction ──────────────────────────────────────────

/**
 * Extract text blocks from pdf.js textContent.
 * Groups nearby text items into logical blocks based on proximity.
 */
function extractTextBlocks(textContent, viewportTransform, pageNum) {
  if (!textContent || !textContent.items || textContent.items.length === 0) {
    return [];
  }

  // Transform each text item to annotation coordinate space
  const items = textContent.items
    .filter(item => item.str && item.str.trim())
    .map(item => {
      const tx = item.transform[4];
      const ty = item.transform[5];
      const w = item.width;
      const h = item.height;

      // Transform corners through viewport
      const topLeft = applyViewportTransform(tx, ty, viewportTransform);
      const bottomRight = applyViewportTransform(tx + w, ty + h, viewportTransform);

      // The y-axis may be flipped by the viewport transform
      const minX = Math.min(topLeft.x, bottomRight.x);
      const minY = Math.min(topLeft.y, bottomRight.y);
      const maxX = Math.max(topLeft.x, bottomRight.x);
      const maxY = Math.max(topLeft.y, bottomRight.y);

      return {
        str: item.str,
        fontName: item.fontName,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: Math.max(maxY - minY, h > 0 ? h : 10),
        transform: item.transform,
      };
    });

  // Group text items into lines (same approximate Y position)
  const LINE_Y_TOLERANCE = 5; // px
  const lines = [];

  for (const item of items) {
    let foundLine = false;
    for (const line of lines) {
      if (Math.abs(item.y - line.y) < LINE_Y_TOLERANCE) {
        line.items.push(item);
        foundLine = true;
        break;
      }
    }
    if (!foundLine) {
      lines.push({ y: item.y, items: [item] });
    }
  }

  // Sort items within each line by X position
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  // Group lines into blocks (close vertical proximity)
  const BLOCK_Y_GAP = 20; // px — max vertical gap between lines in same block
  lines.sort((a, b) => a.y - b.y);

  const blocks = [];
  let currentBlock = null;
  let idx = 0;

  for (const line of lines) {
    if (!currentBlock || (line.y - currentBlock.lastY) > BLOCK_Y_GAP) {
      if (currentBlock) {
        blocks.push(finishBlock(currentBlock, pageNum, idx++));
      }
      currentBlock = { lines: [line], lastY: line.y + (line.items[0]?.height || 12) };
    } else {
      currentBlock.lines.push(line);
      currentBlock.lastY = line.y + (line.items[0]?.height || 12);
    }
  }
  if (currentBlock) {
    blocks.push(finishBlock(currentBlock, pageNum, idx++));
  }

  return blocks;
}

/**
 * Finalize a text block from grouped lines.
 */
function finishBlock(block, pageNum, idx) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const textParts = [];

  for (const line of block.lines) {
    const lineText = line.items.map(item => item.str).join(' ');
    textParts.push(lineText);
    for (const item of line.items) {
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.width);
      maxY = Math.max(maxY, item.y + item.height);
    }
  }

  return {
    id: `pdfobj-${pageNum}-txt-${idx}`,
    type: 'text',
    page: pageNum,
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    text: textParts.join('\n'),
    lineCount: textParts.length,
    operatorSignature: {
      text: textParts.join('\n'),
      fontName: block.lines[0]?.items[0]?.fontName || null,
    },
  };
}

// ─── Vector shape extraction ────────────────────────────────────────

/**
 * Extract vector shapes from operator list.
 * Groups path operations per save/restore scope.
 */
function extractVectors(opList, viewportTransform, pageNum) {
  const matrixStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const gstateStack = [];
  let gstate = defaultGState();
  const vectors = [];
  let idx = 0;

  // Track current scope's paths
  let scopePaths = [];
  let scopeStartIndex = 0;
  let depth = 0;

  const ops = opList.fnArray;
  const argsArray = opList.argsArray;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const a = argsArray[i];

    switch (op) {
      case OPS.save:
        matrixStack.push(ctm.slice());
        gstateStack.push({ ...gstate });
        if (depth === 0) {
          scopeStartIndex = i;
          scopePaths = [];
        }
        depth++;
        break;

      case OPS.restore:
        depth--;
        if (matrixStack.length > 0) {
          ctm = matrixStack.pop();
          gstate = gstateStack.pop();
        }
        if (depth === 0 && scopePaths.length > 0) {
          // Merge all paths in this scope into one vector object
          const merged = mergePathsToBbox(scopePaths);
          if (merged && merged.width >= 5 && merged.height >= 5) {
            vectors.push({
              id: `pdfobj-${pageNum}-vec-${idx++}`,
              type: 'vector',
              page: pageNum,
              bbox: merged,
              paths: scopePaths,
              operatorIndex: scopeStartIndex,
              operatorEndIndex: i,
              operatorSignature: { startIndex: scopeStartIndex, endIndex: i },
            });
          }
          scopePaths = [];
        }
        break;

      case OPS.transform: {
        const [ta, tb, tc, td, te, tf] = a;
        ctm = multiplyMatrices(ctm, [ta, tb, tc, td, te, tf]);
        break;
      }

      case OPS.setLineWidth:
        gstate.lineWidth = a[0];
        break;

      case OPS.setStrokeRGBColor:
        gstate.strokeColor = [a[0], a[1], a[2]];
        break;

      case OPS.setFillRGBColor:
        gstate.fillColor = [a[0], a[1], a[2]];
        break;

      case OPS.constructPath: {
        const pathData = a[1]?.[0];
        if (!pathData || !pathData.length) break;

        const subpaths = parseInterleavedPathData(pathData);
        for (const subpath of subpaths) {
          const transformed = transformPoints(subpath.points, ctm, viewportTransform);
          if (transformed.length >= 2) {
            scopePaths.push(transformed);
          }
        }
        break;
      }

      case OPS.rectangle: {
        const [rx, ry, rw, rh] = a;
        const rectPts = [
          { x: rx, y: ry },
          { x: rx + rw, y: ry },
          { x: rx + rw, y: ry + rh },
          { x: rx, y: ry + rh },
          { x: rx, y: ry }
        ];
        const transformed = transformPoints(rectPts, ctm, viewportTransform);
        scopePaths.push(transformed);
        break;
      }
    }
  }

  // Handle any remaining paths outside save/restore scope
  if (scopePaths.length > 0) {
    const merged = mergePathsToBbox(scopePaths);
    if (merged && merged.width >= 5 && merged.height >= 5) {
      vectors.push({
        id: `pdfobj-${pageNum}-vec-${idx++}`,
        type: 'vector',
        page: pageNum,
        bbox: merged,
        paths: scopePaths,
        operatorIndex: scopeStartIndex,
        operatorEndIndex: ops.length - 1,
        operatorSignature: { startIndex: scopeStartIndex, endIndex: ops.length - 1 },
      });
    }
  }

  return vectors;
}

// ─── Geometry helpers ───────────────────────────────────────────────

function defaultGState() {
  return {
    lineWidth: 1,
    strokeColor: null,
    fillColor: null,
  };
}

function transformPoint(px, py, ctm, viewportTransform) {
  const cx = ctm[0] * px + ctm[2] * py + ctm[4];
  const cy = ctm[1] * px + ctm[3] * py + ctm[5];
  const vx = viewportTransform[0] * cx + viewportTransform[2] * cy + viewportTransform[4];
  const vy = viewportTransform[1] * cx + viewportTransform[3] * cy + viewportTransform[5];
  return { x: vx, y: vy };
}

function transformPoints(points, ctm, viewportTransform) {
  return points.map(pt => transformPoint(pt.x, pt.y, ctm, viewportTransform));
}

function applyViewportTransform(px, py, viewportTransform) {
  const vx = viewportTransform[0] * px + viewportTransform[2] * py + viewportTransform[4];
  const vy = viewportTransform[1] * px + viewportTransform[3] * py + viewportTransform[5];
  return { x: vx, y: vy };
}

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

function computeBboxFromPoints(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function mergePathsToBbox(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasPoints = false;
  for (const path of paths) {
    for (const p of path) {
      hasPoints = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!hasPoints) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pointInBbox(x, y, bbox) {
  return x >= bbox.x && x <= bbox.x + bbox.width &&
         y >= bbox.y && y <= bbox.y + bbox.height;
}

/**
 * Parse interleaved path data into subpaths.
 */
function parseInterleavedPathData(data) {
  const subpaths = [];
  let currentPoints = [];
  let currentX = 0, currentY = 0;
  let closed = false;
  let i = 0;

  while (i < data.length) {
    const drawOp = data[i++];

    switch (drawOp) {
      case DRAW_MOVETO: {
        if (currentPoints.length >= 2) {
          subpaths.push({ points: currentPoints, closed });
        }
        currentX = data[i++];
        currentY = data[i++];
        currentPoints = [{ x: currentX, y: currentY }];
        closed = false;
        break;
      }

      case DRAW_LINETO: {
        currentX = data[i++];
        currentY = data[i++];
        currentPoints.push({ x: currentX, y: currentY });
        break;
      }

      case DRAW_CURVETO: {
        const cp1x = data[i++], cp1y = data[i++];
        const cp2x = data[i++], cp2y = data[i++];
        const ex = data[i++], ey = data[i++];
        const start = { x: currentX, y: currentY };
        for (let s = 1; s <= 4; s++) {
          currentPoints.push(cubicBezierPoint(
            start, { x: cp1x, y: cp1y }, { x: cp2x, y: cp2y }, { x: ex, y: ey }, s / 4
          ));
        }
        currentX = ex;
        currentY = ey;
        break;
      }

      case DRAW_QUADRATIC: {
        const qcpx = data[i++], qcpy = data[i++];
        const qex = data[i++], qey = data[i++];
        const qcp1x = currentX + 2 / 3 * (qcpx - currentX);
        const qcp1y = currentY + 2 / 3 * (qcpy - currentY);
        const qcp2x = qex + 2 / 3 * (qcpx - qex);
        const qcp2y = qey + 2 / 3 * (qcpy - qey);
        const start = { x: currentX, y: currentY };
        for (let s = 1; s <= 4; s++) {
          currentPoints.push(cubicBezierPoint(
            start, { x: qcp1x, y: qcp1y }, { x: qcp2x, y: qcp2y }, { x: qex, y: qey }, s / 4
          ));
        }
        currentX = qex;
        currentY = qey;
        break;
      }

      case DRAW_CLOSEPATH:
        if (currentPoints.length > 1) {
          currentPoints.push({ x: currentPoints[0].x, y: currentPoints[0].y });
          closed = true;
        }
        break;

      default:
        break;
    }
  }

  if (currentPoints.length >= 2) {
    subpaths.push({ points: currentPoints, closed });
  }

  return subpaths;
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
  };
}
