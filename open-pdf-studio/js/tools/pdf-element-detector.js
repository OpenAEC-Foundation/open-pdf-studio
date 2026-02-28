import { state } from '../core/state.js';
import { OPS } from 'pdfjs-dist';
import { getPageRotation } from '../core/state.js';
import { calculateArea, calculateDistance, formatMeasurement, getMeasureScale } from '../annotations/measurement.js';

/**
 * PDF Element Detector
 *
 * Parses pdf.js page.getOperatorList() to extract architectural elements
 * (walls, rooms) from technical drawings. Uses the same operator list parsing
 * pattern as pdf-snap-extractor.js but retains richer per-path data.
 *
 * Results are cached per page and cleared on document switch.
 */

// DrawOPS constants (inside constructPath interleaved data)
const DRAW_MOVETO = 0;
const DRAW_LINETO = 1;
const DRAW_CURVETO = 2;
const DRAW_QUADRATIC = 3;
const DRAW_CLOSEPATH = 4;

// Cache: pageNum → { walls: [...], rooms: [...], grids: [...] }
const detectionCache = new Map();

/**
 * Detect architectural elements on a PDF page.
 * Returns { walls: [...], rooms: [...] }
 */
export async function detectElements(pageNum) {
  if (detectionCache.has(pageNum)) {
    return detectionCache.get(pageNum);
  }

  const pdfDoc = state.pdfDoc;
  if (!pdfDoc) return { walls: [], rooms: [] };

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

  // Extract all paths from operator list (with style metadata)
  const paths = extractPaths(opList, viewportTransform);

  // Extract text items for room labelling
  const textContent = await page.getTextContent();
  const textItems = textContent.items
    .filter(item => item.str && item.str.trim())
    .map(item => {
      const tx = item.transform[4];
      const ty = item.transform[5];
      // Transform PDF text coordinates to annotation space
      const vx = viewportTransform[0] * tx + viewportTransform[2] * ty + viewportTransform[4];
      const vy = viewportTransform[1] * tx + viewportTransform[3] * ty + viewportTransform[5];
      return { str: item.str.trim(), x: vx, y: vy };
    });

  // 1. Compute wall width threshold from stroke width distribution
  const { wallWidthMin, thinCount } = computeWallWidthThreshold(paths);

  // 2. Classify hatching patterns (marks paths in-place)
  const hatchingCount = classifyHatching(paths, wallWidthMin);

  // 3. Classify dimension lines (marks paths in-place)
  const dimensionCount = classifyDimensionLines(paths, textItems, wallWidthMin);

  // 4. Detect elements with filtered paths
  const walls = detectWalls(paths, wallWidthMin);
  const rooms = detectRooms(paths, textItems);
  const grids = detectGrids(paths);

  const filteredStats = {
    thinLines: thinCount,
    hatching: hatchingCount,
    dimensions: dimensionCount,
  };

  console.log(`[element-detector] Results: ${walls.length} walls, ${rooms.length} rooms, ${grids.length} grids (filtered: ${thinCount} thin, ${hatchingCount} hatching, ${dimensionCount} dimension)`);

  const result = { walls, rooms, grids, filteredStats };
  detectionCache.set(pageNum, result);
  return result;
}

/**
 * Get cached detection results (synchronous).
 */
export function getCachedDetection(pageNum) {
  return detectionCache.get(pageNum) || null;
}

/**
 * Clear detection cache (call on document switch).
 */
export function clearDetectionCache() {
  detectionCache.clear();
}

// ─── Path extraction ────────────────────────────────────────────────

/**
 * Default graphics state values.
 */
function defaultGState() {
  return {
    lineWidth: 1,
    strokeColor: null,
    fillColor: null,
    dashArray: [],
    dashPhase: 0,
    strokeAlpha: 1,
    fillAlpha: 1,
  };
}

/**
 * Compute the effective (CTM-scaled) line width.
 * Uses the average of the CTM's x and y scale factors.
 */
function effectiveLineWidth(rawWidth, ctm) {
  const sx = Math.sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
  const sy = Math.sqrt(ctm[2] * ctm[2] + ctm[3] * ctm[3]);
  return rawWidth * (sx + sy) / 2;
}

/**
 * Extract all vector paths from the operator list with metadata.
 * Each path: { points, closed, paintOp, bbox, area, style }
 * style: { lineWidth, strokeColor, fillColor, dashArray, isDashed }
 */
function extractPaths(opList, viewportTransform) {
  const matrixStack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const gstateStack = [];
  let gstate = defaultGState();
  const allPaths = [];

  const ops = opList.fnArray;
  const argsArray = opList.argsArray;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const a = argsArray[i];

    switch (op) {
      case OPS.save:
        matrixStack.push(ctm.slice());
        gstateStack.push({ ...gstate, dashArray: gstate.dashArray.slice() });
        break;

      case OPS.restore:
        if (matrixStack.length > 0) {
          ctm = matrixStack.pop();
          gstate = gstateStack.pop();
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

      case OPS.setLineDash:
        gstate.dashArray = a[0] || [];
        gstate.dashPhase = a[1] || 0;
        break;

      case OPS.setStrokeRGBColor:
        gstate.strokeColor = [a[0], a[1], a[2]];
        break;

      case OPS.setFillRGBColor:
        gstate.fillColor = [a[0], a[1], a[2]];
        break;

      case OPS.setStrokeGray:
        gstate.strokeColor = [a[0], a[0], a[0]];
        break;

      case OPS.setFillGray:
        gstate.fillColor = [a[0], a[0], a[0]];
        break;

      case OPS.setStrokeCMYKColor:
        gstate.strokeColor = cmykToRgb(a[0], a[1], a[2], a[3]);
        break;

      case OPS.setFillCMYKColor:
        gstate.fillColor = cmykToRgb(a[0], a[1], a[2], a[3]);
        break;

      case OPS.setGState:
        if (a[0]) {
          for (const pair of a[0]) {
            const key = pair[0];
            const val = pair[1];
            if (key === 'LW') gstate.lineWidth = val;
            else if (key === 'CA') gstate.strokeAlpha = val;
            else if (key === 'ca') gstate.fillAlpha = val;
            else if (key === 'D') {
              gstate.dashArray = val?.[0] || [];
              gstate.dashPhase = val?.[1] || 0;
            }
          }
        }
        break;

      case OPS.constructPath: {
        const paintCode = a[0];
        const pathData = a[1]?.[0];
        if (!pathData || !pathData.length) break;

        const paintOp = paintCode === 20 ? 'stroke' : paintCode === 22 ? 'fill' : 'endPath';
        const subpaths = parseInterleavedPathData(pathData);

        const scaledLW = effectiveLineWidth(gstate.lineWidth, ctm);
        const isDashed = gstate.dashArray.length > 0 && gstate.dashArray.some(v => v > 0);
        const style = {
          lineWidth: scaledLW,
          strokeColor: gstate.strokeColor ? gstate.strokeColor.slice() : null,
          fillColor: gstate.fillColor ? gstate.fillColor.slice() : null,
          dashArray: gstate.dashArray.slice(),
          isDashed,
        };

        for (const subpath of subpaths) {
          const transformed = transformPoints(subpath.points, ctm, viewportTransform);
          if (transformed.length < 2) continue;

          const closed = subpath.closed || isEffectivelyClosed(transformed);
          const bbox = computeBbox(transformed);
          const area = closed ? Math.abs(shoelaceArea(transformed)) : 0;

          allPaths.push({ points: transformed, closed, paintOp, bbox, area, style });
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
        const bbox = computeBbox(transformed);
        const area = Math.abs(shoelaceArea(transformed));
        const style = {
          lineWidth: effectiveLineWidth(gstate.lineWidth, ctm),
          strokeColor: gstate.strokeColor ? gstate.strokeColor.slice() : null,
          fillColor: gstate.fillColor ? gstate.fillColor.slice() : null,
          dashArray: gstate.dashArray.slice(),
          isDashed: gstate.dashArray.length > 0 && gstate.dashArray.some(v => v > 0),
        };
        allPaths.push({ points: transformed, closed: true, paintOp: 'fill', bbox, area, style });
        break;
      }
    }
  }

  return allPaths;
}

/**
 * Parse interleaved path data into subpaths with closure info.
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
        // Approximate cubic bezier with line segments
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

// ─── Classification: hatching & dimension lines ─────────────────────

/**
 * Classify hatching patterns among thin paths.
 * Groups thin straight segments by angle, detects regular spacing.
 * Marks matching paths with path.isHatching = true.
 * Returns count of hatching paths marked.
 */
function classifyHatching(paths, wallWidthMin) {
  const ANGLE_BIN_SIZE = 5; // degrees
  const MIN_HATCHING_LINES = 5;
  const MAX_SPACING = 20; // px
  const SPACING_TOLERANCE = 0.3; // 30% deviation allowed

  // Collect thin straight segments (2-point paths or segments from multi-point paths)
  const thinSegments = [];
  for (const path of paths) {
    if (path.paintOp === 'endPath') continue;
    if (wallWidthMin > 0 && path.style && path.style.lineWidth >= wallWidthMin) continue;

    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 3) continue;

      // Normalize angle to [0, 180) range
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 180;
      if (angle >= 180) angle -= 180;

      thinSegments.push({ p, q, len, angle, path });
    }
  }

  if (thinSegments.length < MIN_HATCHING_LINES) return 0;

  // Group by angle bins
  const bins = new Map();
  for (const seg of thinSegments) {
    const binKey = Math.floor(seg.angle / ANGLE_BIN_SIZE);
    if (!bins.has(binKey)) bins.set(binKey, []);
    bins.get(binKey).push(seg);
  }

  let hatchingCount = 0;

  for (const [, binSegs] of bins) {
    if (binSegs.length < MIN_HATCHING_LINES) continue;

    // Compute perpendicular position for each segment (project midpoint onto normal)
    const refAngle = binSegs[0].angle * Math.PI / 180;
    const nx = -Math.sin(refAngle);
    const ny = Math.cos(refAngle);

    for (const seg of binSegs) {
      const mx = (seg.p.x + seg.q.x) / 2;
      const my = (seg.p.y + seg.q.y) / 2;
      seg.perpPos = mx * nx + my * ny;
    }

    // Sort by perpendicular position
    binSegs.sort((a, b) => a.perpPos - b.perpPos);

    // Check for regular spacing
    const spacings = [];
    for (let i = 1; i < binSegs.length; i++) {
      spacings.push(binSegs[i].perpPos - binSegs[i - 1].perpPos);
    }

    if (spacings.length < MIN_HATCHING_LINES - 1) continue;

    // Find the median spacing
    const sortedSpacings = spacings.slice().sort((a, b) => a - b);
    const medianSpacing = sortedSpacings[Math.floor(sortedSpacings.length / 2)];

    if (medianSpacing <= 0 || medianSpacing > MAX_SPACING) continue;

    // Count how many spacings are within tolerance of the median
    const regularCount = spacings.filter(
      s => Math.abs(s - medianSpacing) / medianSpacing < SPACING_TOLERANCE
    ).length;

    if (regularCount >= MIN_HATCHING_LINES - 1) {
      // Mark all paths in this bin as hatching
      for (const seg of binSegs) {
        seg.path.isHatching = true;
      }
      hatchingCount += binSegs.length;
    }
  }

  return hatchingCount;
}

/**
 * Classify dimension lines: thin segments near numeric text with tick marks.
 * Marks matching paths with path.isDimension = true.
 * Returns count of dimension paths marked.
 */
function classifyDimensionLines(paths, textItems, wallWidthMin) {
  const PROXIMITY = 30; // px distance from text to line midpoint
  const TICK_MAX_LEN = 15; // px max length for tick marks
  const DIMENSION_RE = /^\d+[\.,]?\d*\s*(mm|cm|m|"|'|ft)?$/;

  // Collect numeric text items
  const dimTexts = textItems.filter(item => DIMENSION_RE.test(item.str));
  if (dimTexts.length === 0) return 0;

  let dimensionCount = 0;

  for (const path of paths) {
    if (path.paintOp === 'endPath' || path.isHatching) continue;
    if (wallWidthMin > 0 && path.style && path.style.lineWidth >= wallWidthMin) continue;

    const pts = path.points;
    // Only consider simple 2-point segments (straight lines)
    if (pts.length !== 2) continue;

    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;

    // Check if any numeric text is near this segment's midpoint
    const hasNearbyText = dimTexts.some(t => {
      const dx = t.x - mx;
      const dy = t.y - my;
      return Math.sqrt(dx * dx + dy * dy) < PROXIMITY;
    });

    if (!hasNearbyText) continue;

    // Look for tick marks at endpoints: short perpendicular segments nearby
    const segDx = pts[1].x - pts[0].x;
    const segDy = pts[1].y - pts[0].y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    if (segLen < 5) continue;

    const segAngle = Math.atan2(segDy, segDx);
    let tickCount = 0;

    for (const otherPath of paths) {
      if (otherPath === path || otherPath.paintOp === 'endPath') continue;
      const oPts = otherPath.points;
      if (oPts.length !== 2) continue;

      const oDx = oPts[1].x - oPts[0].x;
      const oDy = oPts[1].y - oPts[0].y;
      const oLen = Math.sqrt(oDx * oDx + oDy * oDy);
      if (oLen > TICK_MAX_LEN || oLen < 2) continue;

      // Check roughly perpendicular
      const oAngle = Math.atan2(oDy, oDx);
      let angleDiff = Math.abs(segAngle - oAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
      const perpDiff = Math.abs(angleDiff - Math.PI / 2);
      if (perpDiff > 15 * Math.PI / 180) continue;

      // Check proximity to one of our endpoints
      const oMx = (oPts[0].x + oPts[1].x) / 2;
      const oMy = (oPts[0].y + oPts[1].y) / 2;
      for (const ep of pts) {
        const d = Math.sqrt((oMx - ep.x) ** 2 + (oMy - ep.y) ** 2);
        if (d < 10) {
          tickCount++;
          otherPath.isDimension = true;
          break;
        }
      }
    }

    if (hasNearbyText && tickCount >= 1) {
      path.isDimension = true;
      dimensionCount++;
    }
  }

  return dimensionCount;
}

// ─── Stroke width analysis ──────────────────────────────────────────

/**
 * Compute wall width threshold from stroke width distribution.
 * Strategy: build histogram, find the thickest class via ratio-based gap.
 * Returns wallWidthMin (strokes >= this are wall candidates).
 * Also returns stats about filtered paths.
 */
function computeWallWidthThreshold(paths) {
  // Collect stroke widths of all stroked paths
  const widths = [];
  for (const path of paths) {
    if (path.paintOp === 'endPath' || !path.style) continue;
    if (path.paintOp === 'stroke' || path.paintOp === 'fill') {
      widths.push(path.style.lineWidth);
    }
  }

  if (widths.length === 0) return { wallWidthMin: 0, thinCount: 0 };

  // Sort ascending
  widths.sort((a, b) => a - b);

  // Build unique width classes (bin widths within 10% of each other)
  const classes = [];
  let currentClass = { width: widths[0], count: 1 };
  for (let i = 1; i < widths.length; i++) {
    if (widths[i] <= currentClass.width * 1.1 + 0.1) {
      currentClass.count++;
      // Use running average for class representative
      currentClass.width = (currentClass.width * (currentClass.count - 1) + widths[i]) / currentClass.count;
    } else {
      classes.push(currentClass);
      currentClass = { width: widths[i], count: 1 };
    }
  }
  classes.push(currentClass);

  if (classes.length <= 1) {
    // All paths have the same width — no filtering possible
    return { wallWidthMin: 0, thinCount: 0 };
  }

  // Find the largest ratio gap between consecutive width classes
  let bestGapIdx = -1;
  let bestRatio = 0;
  for (let i = 0; i < classes.length - 1; i++) {
    const ratio = classes[i + 1].width / (classes[i].width || 0.01);
    if (ratio > bestRatio && ratio > 1.5) {
      bestRatio = ratio;
      bestGapIdx = i;
    }
  }

  if (bestGapIdx < 0) {
    return { wallWidthMin: 0, thinCount: 0 };
  }

  const wallWidthMin = (classes[bestGapIdx].width + classes[bestGapIdx + 1].width) / 2;
  const thinCount = widths.filter(w => w < wallWidthMin).length;

  console.log('[element-detector] Stroke width classes:', classes.map(c => `${c.width.toFixed(2)}px (n=${c.count})`));
  console.log(`[element-detector] Wall width threshold: ${wallWidthMin.toFixed(2)}px, filtering ${thinCount} thin paths`);

  return { wallWidthMin, thinCount };
}

// ─── Wall detection ─────────────────────────────────────────────────

/**
 * Detect walls from PDF paths.
 * Strategy: find pairs of parallel, closely-spaced line segments.
 * @param {Array} paths - paths with style metadata
 * @param {number} wallWidthMin - minimum stroke width for wall candidates (0 = no filter)
 */
function detectWalls(paths, wallWidthMin = 0) {
  // 1. Collect straight-ish line segments longer than threshold
  const MIN_LENGTH = 20; // px
  const segments = [];

  for (const path of paths) {
    if (path.paintOp === 'endPath') continue;
    if (path.isHatching || path.isDimension) continue;

    // Skip dashed paths — dashed lines are never walls
    if (path.style?.isDashed) continue;

    // Skip thin paths if threshold is set
    if (wallWidthMin > 0 && path.style && path.style.lineWidth < wallWidthMin) continue;

    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len >= MIN_LENGTH) {
        const angle = Math.atan2(dy, dx);
        segments.push({ p, q, len, angle, used: false });
      }
    }
  }

  // 2. Group parallel segments that are close together (wall pairs)
  const ANGLE_TOLERANCE = 5 * Math.PI / 180; // 5 degrees
  const MAX_WALL_THICKNESS = 30; // px
  const MIN_WALL_THICKNESS = 2;  // px
  const MIN_OVERLAP_RATIO = 0.4; // 40% overlap required

  const walls = [];
  let wallId = 0;

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].used) continue;
    const seg1 = segments[i];

    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].used) continue;
      const seg2 = segments[j];

      // Check parallel (same or opposite direction)
      let angleDiff = Math.abs(seg1.angle - seg2.angle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
      if (angleDiff > ANGLE_TOLERANCE) continue;

      // Check perpendicular distance between the lines
      const perpDist = perpendicularDistance(seg1, seg2);
      if (perpDist < MIN_WALL_THICKNESS || perpDist > MAX_WALL_THICKNESS) continue;

      // Check overlap along their shared direction
      const overlap = computeOverlap(seg1, seg2);
      const minLen = Math.min(seg1.len, seg2.len);
      if (overlap < MIN_OVERLAP_RATIO * minLen) continue;

      // We have a wall pair
      segments[i].used = true;
      segments[j].used = true;

      // Compute centerline
      const cx1 = (seg1.p.x + seg2.p.x) / 2;
      const cy1 = (seg1.p.y + seg2.p.y) / 2;
      const cx2 = (seg1.q.x + seg2.q.x) / 2;
      const cy2 = (seg1.q.y + seg2.q.y) / 2;

      // Project onto dominant direction for clean endpoints
      const centerline = projectCenterline(seg1, seg2);

      const length = calculateDistance(
        centerline.x1, centerline.y1,
        centerline.x2, centerline.y2
      );

      const orientationDeg = Math.abs(seg1.angle * 180 / Math.PI);
      const orientation = (orientationDeg < 45 || orientationDeg > 135) ? 'horizontal' : 'vertical';

      walls.push({
        id: `wall-${wallId++}`,
        type: 'wall',
        centerline,
        thickness: perpDist,
        length: length.pixels,
        lengthFormatted: formatMeasurement(length),
        thicknessFormatted: formatMeasurement(calculateDistance(0, 0, perpDist, 0)),
        orientation,
        seg1: { x1: seg1.p.x, y1: seg1.p.y, x2: seg1.q.x, y2: seg1.q.y },
        seg2: { x1: seg2.p.x, y1: seg2.p.y, x2: seg2.q.x, y2: seg2.q.y },
      });
      break; // seg1 is used, move to next
    }
  }

  return walls;
}

/**
 * Compute perpendicular distance between two approximately parallel segments.
 */
function perpendicularDistance(seg1, seg2) {
  // Use midpoint of seg2 and distance to seg1's line
  const mx = (seg2.p.x + seg2.q.x) / 2;
  const my = (seg2.p.y + seg2.q.y) / 2;
  return pointToLineDistance(mx, my, seg1.p.x, seg1.p.y, seg1.q.x, seg1.q.y);
}

function pointToLineDistance(px, py, lx1, ly1, lx2, ly2) {
  const dx = lx2 - lx1;
  const dy = ly2 - ly1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((px - lx1) ** 2 + (py - ly1) ** 2);
  return Math.abs(dy * px - dx * py + lx2 * ly1 - ly2 * lx1) / len;
}

/**
 * Compute overlap length of two parallel segments projected onto their shared direction.
 */
function computeOverlap(seg1, seg2) {
  // Project both segments onto the direction of seg1
  const dx = seg1.q.x - seg1.p.x;
  const dy = seg1.q.y - seg1.p.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;
  const ux = dx / len, uy = dy / len;

  // Project all 4 endpoints onto the unit vector
  const proj = (x, y) => ux * (x - seg1.p.x) + uy * (y - seg1.p.y);
  const a1 = proj(seg1.p.x, seg1.p.y);
  const a2 = proj(seg1.q.x, seg1.q.y);
  const b1 = proj(seg2.p.x, seg2.p.y);
  const b2 = proj(seg2.q.x, seg2.q.y);

  const min1 = Math.min(a1, a2), max1 = Math.max(a1, a2);
  const min2 = Math.min(b1, b2), max2 = Math.max(b1, b2);

  return Math.max(0, Math.min(max1, max2) - Math.max(min1, min2));
}

/**
 * Compute a clean centerline between two parallel segments.
 */
function projectCenterline(seg1, seg2) {
  // Direction of seg1
  const dx = seg1.q.x - seg1.p.x;
  const dy = seg1.q.y - seg1.p.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;

  // Project all 4 points
  const proj = (x, y) => ux * (x - seg1.p.x) + uy * (y - seg1.p.y);
  const projections = [
    proj(seg1.p.x, seg1.p.y),
    proj(seg1.q.x, seg1.q.y),
    proj(seg2.p.x, seg2.p.y),
    proj(seg2.q.x, seg2.q.y),
  ];

  // The overlap range
  const s1min = Math.min(projections[0], projections[1]);
  const s1max = Math.max(projections[0], projections[1]);
  const s2min = Math.min(projections[2], projections[3]);
  const s2max = Math.max(projections[2], projections[3]);

  const overlapStart = Math.max(s1min, s2min);
  const overlapEnd = Math.min(s1max, s2max);

  // Midpoint between the two lines (perpendicular offset)
  const midX = (seg1.p.x + seg2.p.x) / 2;
  const midY = (seg1.p.y + seg2.p.y) / 2;
  const baseT = proj(midX, midY);

  return {
    x1: midX + ux * (overlapStart - baseT),
    y1: midY + uy * (overlapStart - baseT),
    x2: midX + ux * (overlapEnd - baseT),
    y2: midY + uy * (overlapEnd - baseT),
  };
}

// ─── Room detection ─────────────────────────────────────────────────

/**
 * Detect rooms from closed polygons + text matching.
 */
function detectRooms(paths, textItems) {
  const MIN_AREA = 1000;  // px² minimum room size
  const MIN_DIM = 15;     // px minimum width/height
  const MAX_ASPECT = 10;  // filter extremely elongated shapes
  const AREA_RE = /\d+[\.,]?\d*\s*m[²2]/;
  const rooms = [];
  let roomId = 0;

  for (const path of paths) {
    if (!path.closed) continue;
    if (path.isHatching || path.isDimension) continue;
    if (path.area < MIN_AREA) continue;

    // Filter extremely elongated shapes
    const w = path.bbox.maxX - path.bbox.minX;
    const h = path.bbox.maxY - path.bbox.minY;
    if (w < MIN_DIM || h < MIN_DIM) continue;
    const aspect = Math.max(w / h, h / w);
    if (aspect > MAX_ASPECT) continue;

    // Find text items inside this polygon
    const label = findRoomLabel(path.points, textItems, AREA_RE);

    // Calculate area with calibration
    const areaResult = calculateArea(path.points);

    // Compute centroid
    const centroid = computeCentroid(path.points);

    // Extract fill color from CAD data if available
    const fillColor = path.style?.fillColor
      ? rgbArrayToHex(path.style.fillColor)
      : null;

    rooms.push({
      id: `room-${roomId++}`,
      type: 'room',
      points: path.points,
      bbox: path.bbox,
      centroid,
      label: label || `Room ${roomId}`,
      areaPixels: path.area,
      areaFormatted: formatMeasurement(areaResult),
      width: w,
      height: h,
      fillColor,
    });
  }

  // Deduplicate overlapping rooms — keep the smaller (more specific) one
  return deduplicateRooms(rooms);
}

/**
 * Find the best room label inside a polygon using ray casting.
 * Prefers room names over area measurements, filters out dimension numbers.
 */
function findRoomLabel(polygon, textItems, areaRe) {
  const candidates = [];
  for (const item of textItems) {
    if (pointInPolygon(item.x, item.y, polygon)) {
      candidates.push(item);
    }
  }
  if (candidates.length === 0) return null;

  // Filter out very long strings (paragraphs) and very short (numbers)
  const filtered = candidates.filter(c => c.str.length >= 2 && c.str.length <= 40);
  if (filtered.length === 0) return candidates[0].str;

  // Separate: area measurements, dimension numbers, room names
  const DIMENSION_RE = /^\d+[\.,]?\d*\s*(mm|cm|m|"|'|ft)?$/;
  const roomNames = [];
  const areaMeasurements = [];
  const other = [];

  for (const item of filtered) {
    if (areaRe && areaRe.test(item.str)) {
      areaMeasurements.push(item);
    } else if (DIMENSION_RE.test(item.str)) {
      // Skip pure dimension numbers — not useful as room labels
    } else {
      roomNames.push(item);
    }
  }

  // Prefer room names, then area measurements, then anything
  const preferred = roomNames.length > 0 ? roomNames
    : areaMeasurements.length > 0 ? areaMeasurements
    : filtered;

  // Return the longest reasonable candidate
  preferred.sort((a, b) => b.str.length - a.str.length);
  return preferred[0].str;
}

/**
 * Ray casting point-in-polygon test.
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Deduplicate rooms that overlap significantly — keep smaller ones.
 */
function deduplicateRooms(rooms) {
  if (rooms.length <= 1) return rooms;

  // Sort by area ascending (smallest first)
  rooms.sort((a, b) => a.areaPixels - b.areaPixels);

  const keep = [];
  for (const room of rooms) {
    // Check if this room's centroid lies inside a larger already-kept room
    let isDuplicate = false;
    for (const kept of keep) {
      if (kept.areaPixels > room.areaPixels * 0.8 &&
          kept.areaPixels < room.areaPixels * 1.2 &&
          Math.abs(kept.centroid.x - room.centroid.x) < 20 &&
          Math.abs(kept.centroid.y - room.centroid.y) < 20) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      keep.push(room);
    }
  }

  return keep;
}

// ─── Grid detection ─────────────────────────────────────────────────

/**
 * Detect equidistant grid lines from straight segments in the PDF.
 * Strategy: collect straight segments, group by orientation (horizontal/vertical),
 * sort by perpendicular position, find equidistant sets (spacing diff < 10%).
 */
function detectGrids(paths) {
  const MIN_LENGTH = 40; // px — grid lines are typically long
  const ANGLE_TOL = 3 * Math.PI / 180; // 3 degrees

  // 1. Collect all straight segments
  const hSegments = []; // ~horizontal (angle ≈ 0 or π)
  const vSegments = []; // ~vertical   (angle ≈ π/2)

  for (const path of paths) {
    if (path.paintOp === 'endPath') continue;
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < MIN_LENGTH) continue;

      const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
      if (angle < ANGLE_TOL) {
        // Horizontal
        hSegments.push({ p, q, len, y: (p.y + q.y) / 2 });
      } else if (Math.abs(angle - Math.PI / 2) < ANGLE_TOL) {
        // Vertical
        vSegments.push({ p, q, len, x: (p.x + q.x) / 2 });
      }
    }
  }

  const grids = [];
  let gridId = 0;

  // 2. Find equidistant sets in horizontal lines (sorted by Y)
  const hGrid = findEquidistantSet(hSegments, 'y');
  if (hGrid) {
    const bbox = computeSegmentSetBbox(hGrid.lines);
    grids.push({
      id: `grid-${gridId++}`,
      type: 'grid',
      orientation: 'horizontal',
      lines: hGrid.lines,
      spacing: hGrid.spacing,
      count: hGrid.lines.length,
      bbox,
      spacingFormatted: formatMeasurement(calculateDistance(0, 0, hGrid.spacing, 0)),
    });
  }

  // 3. Find equidistant sets in vertical lines (sorted by X)
  const vGrid = findEquidistantSet(vSegments, 'x');
  if (vGrid) {
    const bbox = computeSegmentSetBbox(vGrid.lines);
    grids.push({
      id: `grid-${gridId++}`,
      type: 'grid',
      orientation: 'vertical',
      lines: vGrid.lines,
      spacing: vGrid.spacing,
      count: vGrid.lines.length,
      bbox,
      spacingFormatted: formatMeasurement(calculateDistance(0, 0, vGrid.spacing, 0)),
    });
  }

  return grids;
}

/**
 * Find the largest equidistant set among segments sorted by a positional key.
 * Returns { lines: [...segments], spacing } or null.
 */
function findEquidistantSet(segments, posKey) {
  if (segments.length < 3) return null;

  // Sort by perpendicular position
  segments.sort((a, b) => a[posKey] - b[posKey]);

  // Deduplicate lines at nearly the same position (within 2px)
  const deduped = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    if (Math.abs(segments[i][posKey] - deduped[deduped.length - 1][posKey]) > 2) {
      deduped.push(segments[i]);
    }
  }
  if (deduped.length < 3) return null;

  // Try to find the largest equidistant subset
  let bestSet = null;

  for (let i = 0; i < deduped.length - 2; i++) {
    const spacing = deduped[i + 1][posKey] - deduped[i][posKey];
    if (spacing < 5) continue; // Skip near-zero spacing

    const set = [deduped[i], deduped[i + 1]];
    let expectedPos = deduped[i + 1][posKey] + spacing;

    for (let j = i + 2; j < deduped.length; j++) {
      const diff = Math.abs(deduped[j][posKey] - expectedPos);
      if (diff < spacing * 0.1) {
        // Within 10% tolerance
        set.push(deduped[j]);
        expectedPos = deduped[j][posKey] + spacing;
      } else if (deduped[j][posKey] > expectedPos + spacing * 0.5) {
        break; // Too far, stop searching
      }
    }

    if (set.length >= 3 && (!bestSet || set.length > bestSet.lines.length)) {
      bestSet = { lines: set, spacing };
    }
  }

  return bestSet;
}

/**
 * Compute bounding box for a set of segments.
 */
function computeSegmentSetBbox(segments) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    minX = Math.min(minX, seg.p.x, seg.q.x);
    minY = Math.min(minY, seg.p.y, seg.q.y);
    maxX = Math.max(maxX, seg.p.x, seg.q.x);
    maxY = Math.max(maxY, seg.p.y, seg.q.y);
  }
  return { minX, minY, maxX, maxY };
}

// ─── Geometry helpers ───────────────────────────────────────────────

function transformPoints(points, ctm, viewportTransform) {
  return points.map(pt => {
    const cx = ctm[0] * pt.x + ctm[2] * pt.y + ctm[4];
    const cy = ctm[1] * pt.x + ctm[3] * pt.y + ctm[5];
    const vx = viewportTransform[0] * cx + viewportTransform[2] * cy + viewportTransform[4];
    const vy = viewportTransform[1] * cx + viewportTransform[3] * cy + viewportTransform[5];
    return { x: vx, y: vy };
  });
}

function computeBbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function computeCentroid(points) {
  let cx = 0, cy = 0;
  // Exclude closing point if it duplicates the first
  const n = (points.length > 1 &&
    Math.abs(points[0].x - points[points.length - 1].x) < 0.5 &&
    Math.abs(points[0].y - points[points.length - 1].y) < 0.5)
    ? points.length - 1
    : points.length;
  for (let i = 0; i < n; i++) {
    cx += points[i].x;
    cy += points[i].y;
  }
  return { x: cx / n, y: cy / n };
}

function shoelaceArea(points) {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

function isEffectivelyClosed(points) {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.abs(first.x - last.x) < 1 && Math.abs(first.y - last.y) < 1;
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

function rgbArrayToHex(rgb) {
  if (!rgb || rgb.length < 3) return null;
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function cmykToRgb(c, m, y, k) {
  return [
    (1 - c) * (1 - k),
    (1 - m) * (1 - k),
    (1 - y) * (1 - k),
  ];
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
