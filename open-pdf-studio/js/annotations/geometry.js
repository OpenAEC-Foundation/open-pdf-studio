import { state, getActiveDocument } from '../core/state.js';
import { annotationCtx } from '../ui/dom-elements.js';
import { distanceToLine, isPointNearRect, isPointNearEllipse } from '../utils/math.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { catmullRomSpline } from '../tools/tools/spline-tool.js';
import { wallHalfWidthPx as isPointOnWallHalfWidth } from './rendering/walls.js';
import { buildStavenreeks } from './stavenreeks.js';
import { stavenreeksPxPerMm } from './stavenreeks-scale.js';
import { betonbalkHalfWidthPx } from './betonbalk-scale.js';

/**
 * Find intersection of two infinite lines defined by (p1,p2) and (p3,p4).
 * Returns { x, y, t, u } where t is parameter on line 1, u on line 2.
 * Returns null if lines are parallel.
 */
export function lineLineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if (x, y) is inside the polygon defined by points.
 */
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    if ((yi > y) !== (yj > y) &&
        x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Transform a point by inverse rotation around a center point
// This converts screen coordinates to the annotation's local (unrotated) coordinate system
function transformPointByInverseRotation(x, y, centerX, centerY, rotationDegrees) {
  if (!rotationDegrees) return { x, y };

  const radians = -rotationDegrees * Math.PI / 180; // Negative for inverse
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Translate to origin, rotate, translate back
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

// Get the center point and dimensions for an annotation
function getAnnotationCenterAndSize(ann) {
  switch (ann.type) {
    case 'box':
    case 'mask':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
    case 'viewport':
    case 'scaleRegion':
    case 'scaleBar':
    case 'scheduleTable':
    case 'parametricSymbol':
      return {
        centerX: ann.x + ann.width / 2,
        centerY: ann.y + ann.height / 2,
        width: ann.width,
        height: ann.height
      };
    case 'arc': {
      const arcR = ann.radius || 0;
      return {
        centerX: ann.centerX,
        centerY: ann.centerY,
        width: arcR * 2,
        height: arcR * 2
      };
    }
    case 'spline': {
      if (ann.controlPoints && ann.controlPoints.length >= 3) {
        const xs = ann.controlPoints.map(p => p.x);
        const ys = ann.controlPoints.map(p => p.y);
        const sMinX = Math.min(...xs);
        const sMaxX = Math.max(...xs);
        const sMinY = Math.min(...ys);
        const sMaxY = Math.max(...ys);
        return {
          centerX: (sMinX + sMaxX) / 2,
          centerY: (sMinY + sMaxY) / 2,
          width: sMaxX - sMinX || 1,
          height: sMaxY - sMinY || 1
        };
      }
      return { centerX: 0, centerY: 0, width: 0, height: 0 };
    }
    case 'splineArrow': {
      if (ann.points && ann.points.length >= 2) {
        const xs = ann.points.map(p => p.x);
        const ys = ann.points.map(p => p.y);
        const saMinX = Math.min(...xs);
        const saMaxX = Math.max(...xs);
        const saMinY = Math.min(...ys);
        const saMaxY = Math.max(...ys);
        return {
          centerX: (saMinX + saMaxX) / 2,
          centerY: (saMinY + saMaxY) / 2,
          width: saMaxX - saMinX || 1,
          height: saMaxY - saMinY || 1
        };
      }
      return { centerX: 0, centerY: 0, width: 0, height: 0 };
    }
    case 'circle':
      const w = ann.width || ann.radius * 2;
      const h = ann.height || ann.radius * 2;
      const cx = ann.x !== undefined ? ann.x : ann.centerX - ann.radius;
      const cy = ann.y !== undefined ? ann.y : ann.centerY - ann.radius;
      return {
        centerX: cx + w / 2,
        centerY: cy + h / 2,
        width: w,
        height: h
      };
    case 'comment':
      const cw = ann.width || 24;
      const ch = ann.height || 24;
      return {
        centerX: ann.x + cw / 2,
        centerY: ann.y + ch / 2,
        width: cw,
        height: ch
      };
    default: {
      const typeHandler = getAnnotationType(ann.type);
      if (typeHandler && typeHandler.getBounds) {
        const bounds = typeHandler.getBounds(ann);
        if (bounds) {
          return {
            centerX: bounds.x + bounds.width / 2,
            centerY: bounds.y + bounds.height / 2,
            width: bounds.width,
            height: bounds.height
          };
        }
      }
      return null;
    }
  }
}

// Find annotation at coordinates. Optioneel pageNum voor de doorlopende
// weergave, waar de aanwijzer boven een ANDERE pagina dan doc.currentPage
// kan staan (hover/contextmenu); zonder pageNum geldt doc.currentPage.
export function findAnnotationAt(x, y, pageNum = null) {
  // Scale-aware hit tolerance: stay ~10 screen pixels at any zoom level
  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  const tol = Math.max(10 / scale, 2);
  const targetPage = pageNum ?? (doc ? doc.currentPage : 1);

  // Search in reverse order (top annotations first)
  const annotations = doc?.annotations || [];
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.page !== targetPage) continue;

    switch (ann.type) {
      case 'draw':
        // Check if point is near the path
        for (let point of ann.path) {
          const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
          if (dist < tol) return ann;
        }
        break;
      case 'line':
      case 'arrow':
        // Check if point is near the line
        const dist = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (dist < tol) return ann;
        break;
      case 'stavenreeks': {
        // Raak de reekslijn OF een van de poten/punten — alle drie horen bij
        // hetzelfde object, dus de hele figuur is aanklikbaar.
        // De GETEKENDE aanhaallijn (sr.line) loopt aan de labelzijde verder
        // door dan het laatste staafpunt (de uitloop) — die uitloop hoort bij
        // het object en moet dus ook raakbaar zijn.
        const sr = buildStavenreeks(ann, { pxPerMm: stavenreeksPxPerMm(ann) });
        if (distanceToLine(x, y, sr.line.x1, sr.line.y1, sr.line.x2, sr.line.y2) < tol) return ann;
        for (const leg of sr.legs) {
          if (distanceToLine(x, y, leg.x1, leg.y1, leg.x2, leg.y2) < tol) return ann;
        }
        for (const dot of sr.dots) {
          if (Math.hypot(x - dot.x, y - dot.y) < tol + dot.r) return ann;
        }
        break;
      }
      case 'wall': {
        // Anywhere inside the band (centreline ± half real-world thickness)
        const wd = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (wd < tol + isPointOnWallHalfWidth(ann)) return ann;
        break;
      }
      case 'betonbalk': {
        // Overal binnen het balklijf: hartlijn ± halve breedte
        // (schaalgebied-bewust), zoals bij de wand.
        const bd = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (bd < tol + betonbalkHalfWidthPx(ann)) return ann;
        break;
      }
      case 'polyline':
        // Check if point is near any segment of the polyline
        if (ann.points && ann.points.length >= 2) {
          for (let i = 0; i < ann.points.length - 1; i++) {
            const segDist = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y);
            if (segDist < tol) return ann;
          }
        }
        break;
      case 'cloudPolyline':
        // Check if point is near any segment of the closed cloud polyline
        if (ann.points && ann.points.length >= 3) {
          for (let i = 0; i < ann.points.length; i++) {
            const j = (i + 1) % ann.points.length;
            const cpDist = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[j].x, ann.points[j].y);
            if (cpDist < tol + 12) return ann;
          }
        }
        break;
      case 'arc': {
        const adx = x - ann.centerX;
        const ady = y - ann.centerY;
        const adist = Math.sqrt(adx * adx + ady * ady);
        const aangle = Math.atan2(ady, adx);
        function normalizeArcAngle(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
        const ans = normalizeArcAngle(ann.startAngle);
        const ane = normalizeArcAngle(ann.endAngle);
        const ana = normalizeArcAngle(aangle);
        const aspan = normalizeArcAngle(ane - ans);
        const ainSpan = normalizeArcAngle(ana - ans) <= aspan;
        if (ainSpan && Math.abs(adist - ann.radius) < tol) return ann;
        break;
      }
      case 'spline': {
        if (ann.controlPoints && ann.controlPoints.length >= 3) {
          const samples = catmullRomSpline(ann.controlPoints, 16);
          for (let i = 0; i < samples.length - 1; i++) {
            const d = distanceToLine(x, y, samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y);
            if (d < tol) return ann;
          }
        }
        break;
      }
      case 'splineArrow': {
        if (ann.points && ann.points.length >= 2) {
          const samples = catmullRomSpline(ann.points, 16);
          for (let i = 0; i < samples.length - 1; i++) {
            const d = distanceToLine(x, y, samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y);
            if (d < tol) return ann;
          }
        }
        break;
      }
      case 'circle':
        // Check if point is near ellipse boundary, or inside if has fill color
        const findCircW = ann.width || ann.radius * 2;
        const findCircH = ann.height || ann.radius * 2;
        const findCircX = ann.x !== undefined ? ann.x : ann.centerX - ann.radius;
        const findCircY = ann.y !== undefined ? ann.y : ann.centerY - ann.radius;
        // Transform click point by inverse rotation if annotation is rotated
        const circleCenter = { x: findCircX + findCircW / 2, y: findCircY + findCircH / 2 };
        const circleLocal = transformPointByInverseRotation(x, y, circleCenter.x, circleCenter.y, ann.rotation);
        // Hittable across the WHOLE ellipse area (interior + border), regardless
        // of fill — so circles/ellipses can be selected and Ctrl+copied by
        // clicking anywhere inside, not just the thin stroke.
        {
          const ellCX = findCircX + findCircW / 2;
          const ellCY = findCircY + findCircH / 2;
          const ellRX = Math.abs(findCircW / 2);
          const ellRY = Math.abs(findCircH / 2);
          const normDist = Math.pow((circleLocal.x - ellCX) / ellRX, 2) + Math.pow((circleLocal.y - ellCY) / ellRY, 2);
          if (normDist <= 1) return ann;
        }
        // Also check near the border (stroke) so the thin outline stays grabbable.
        if (isPointNearEllipse(circleLocal.x, circleLocal.y, findCircX, findCircY, findCircW, findCircH, tol)) return ann;
        break;
      case 'box':
      case 'mask':
        // Transform click point by inverse rotation if annotation is rotated
        const boxCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const boxLocal = transformPointByInverseRotation(x, y, boxCenter.x, boxCenter.y, ann.rotation);
        // If has fill color or hatch pattern, check if inside the rectangle
        if (ann.fillColor || (ann.hatchPattern && ann.hatchPattern !== 'none')) {
          if (boxLocal.x >= ann.x && boxLocal.x <= ann.x + ann.width && boxLocal.y >= ann.y && boxLocal.y <= ann.y + ann.height) return ann;
        }
        // Also check near the border (stroke)
        if (isPointNearRect(boxLocal.x, boxLocal.y, ann.x, ann.y, ann.width, ann.height, tol)) return ann;
        break;
      case 'highlight':
        // Transform click point by inverse rotation if annotation is rotated
        const hlCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const hlLocal = transformPointByInverseRotation(x, y, hlCenter.x, hlCenter.y, ann.rotation);
        if (hlLocal.x >= ann.x && hlLocal.x <= ann.x + ann.width && hlLocal.y >= ann.y && hlLocal.y <= ann.y + ann.height) return ann;
        break;
      case 'comment':
        const cw = ann.width || 24;
        const ch = ann.height || 24;
        // Transform click point by inverse rotation if annotation is rotated
        const commentCenter = { x: ann.x + cw / 2, y: ann.y + ch / 2 };
        const commentLocal = transformPointByInverseRotation(x, y, commentCenter.x, commentCenter.y, ann.rotation);
        if (commentLocal.x >= ann.x && commentLocal.x <= ann.x + cw && commentLocal.y >= ann.y && commentLocal.y <= ann.y + ch) return ann;
        break;
      case 'text':
        if (annotationCtx) {
          annotationCtx.font = `${ann.fontSize || 16}px Arial`;
          const textWidth = annotationCtx.measureText(ann.text).width;
          const fontSize = ann.fontSize || 16;
          if (x >= ann.x && x <= ann.x + textWidth && y >= ann.y - fontSize && y <= ann.y) return ann;
        }
        break;
      case 'textbox':
        const tbWidth = ann.width || 150;
        const tbHeight = ann.height || 50;
        // Transform click point by inverse rotation if annotation is rotated
        const tbCenter = { x: ann.x + tbWidth / 2, y: ann.y + tbHeight / 2 };
        const tbLocal = transformPointByInverseRotation(x, y, tbCenter.x, tbCenter.y, ann.rotation);
        if (tbLocal.x >= ann.x && tbLocal.x <= ann.x + tbWidth && tbLocal.y >= ann.y && tbLocal.y <= ann.y + tbHeight) return ann;
        // Leader segment hit-test: cursor within ~4 px of any anchor->knee->tip line
        if (Array.isArray(ann.leaders) && ann.leaders.length > 0) {
          const ldrTol = Math.max(4 / scale, tol);
          const bw = tbWidth, bh = tbHeight;
          for (const l of ann.leaders) {
            // Pick anchor side using same logic as renderer
            const cs = [
              { x: ann.x + bw / 2, y: ann.y },
              { x: ann.x + bw,     y: ann.y + bh / 2 },
              { x: ann.x + bw / 2, y: ann.y + bh },
              { x: ann.x,          y: ann.y + bh / 2 },
            ];
            let aBest = cs[0], bestD = Infinity;
            for (const c of cs) {
              const d = (c.x - l.kneeX) * (c.x - l.kneeX) + (c.y - l.kneeY) * (c.y - l.kneeY);
              if (d < bestD) { bestD = d; aBest = c; }
            }
            if (distanceToLine(x, y, aBest.x, aBest.y, l.kneeX, l.kneeY) < ldrTol) return ann;
            if (distanceToLine(x, y, l.kneeX, l.kneeY, l.tipX, l.tipY) < ldrTol) return ann;
          }
        }
        break;
      case 'callout':
        const coWidth = ann.width || 150;
        const coHeight = ann.height || 50;
        // Check if clicking inside the text box
        if (x >= ann.x && x <= ann.x + coWidth && y >= ann.y && y <= ann.y + coHeight) return ann;
        // Also check if clicking near the arrow tip or knee
        const arrowX = ann.arrowX !== undefined ? ann.arrowX : ann.x - 60;
        const arrowY = ann.arrowY !== undefined ? ann.arrowY : ann.y + coHeight;
        const kneeX = ann.kneeX !== undefined ? ann.kneeX : ann.x - 30;
        const kneeY = ann.kneeY !== undefined ? ann.kneeY : ann.y + coHeight / 2;
        if (Math.sqrt(Math.pow(x - arrowX, 2) + Math.pow(y - arrowY, 2)) < tol * 1.5) return ann;
        if (Math.sqrt(Math.pow(x - kneeX, 2) + Math.pow(y - kneeY, 2)) < tol * 1.5) return ann;
        break;
      case 'polygon':
      case 'cloud': {
        // Edge proximity check (when annotation has explicit points array)
        if (ann.points && ann.points.length >= 2) {
          for (let i = 0; i < ann.points.length - 1; i++) {
            if (distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y) < tol) return ann;
          }
          if (ann.points.length >= 3) {
            const last = ann.points.length - 1;
            if (distanceToLine(x, y, ann.points[last].x, ann.points[last].y, ann.points[0].x, ann.points[0].y) < tol) return ann;
          }
        }
        // Point-in-polygon: click anywhere inside (points-based)
        if (ann.points && ann.points.length >= 3) {
          if (pointInPolygon(x, y, ann.points)) return ann;
        }
        // Bounding-box hit test for bbox-based shapes (cloud is created via x/y/width/height,
        // and polygon also stores width/height for the inscribed regular polygon).
        if (ann.width !== undefined && ann.height !== undefined) {
          const bbCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
          const bbLocal = transformPointByInverseRotation(x, y, bbCenter.x, bbCenter.y, ann.rotation);
          // Inside bbox -> click anywhere selects (cloud has no points fallback)
          if (bbLocal.x >= ann.x && bbLocal.x <= ann.x + ann.width &&
              bbLocal.y >= ann.y && bbLocal.y <= ann.y + ann.height) return ann;
          // Near border edges (covers the wavy scallops that extend slightly outside the bbox)
          if (isPointNearRect(bbLocal.x, bbLocal.y, ann.x, ann.y, ann.width, ann.height, tol + 8)) return ann;
        }
        break;
      }
      case 'image':
      case 'stamp':
      case 'signature':
      case 'redaction':
      case 'parametricSymbol': {
        // Images/stamps/signatures/parametric symbols: selectable ANYWHERE inside the bounding box
        const imgCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const imgLocal = transformPointByInverseRotation(x, y, imgCenter.x, imgCenter.y, ann.rotation);
        if (imgLocal.x >= ann.x && imgLocal.x <= ann.x + ann.width &&
            imgLocal.y >= ann.y && imgLocal.y <= ann.y + ann.height) return ann;
        break;
      }
      case 'viewport':
      case 'scaleRegion': {
        // Hit test on boundary edges and the top-left badge/label only,
        // so that annotations placed *inside* the region remain selectable.
        const edgeTol = 6;
        const nearLeft = Math.abs(x - ann.x) < edgeTol && y >= ann.y - edgeTol && y <= ann.y + ann.height + edgeTol;
        const nearRight = Math.abs(x - (ann.x + ann.width)) < edgeTol && y >= ann.y - edgeTol && y <= ann.y + ann.height + edgeTol;
        const nearTop = Math.abs(y - ann.y) < edgeTol && x >= ann.x - edgeTol && x <= ann.x + ann.width + edgeTol;
        const nearBottom = Math.abs(y - (ann.y + ann.height)) < edgeTol && x >= ann.x - edgeTol && x <= ann.x + ann.width + edgeTol;
        if (nearLeft || nearRight || nearTop || nearBottom) return ann;
        // Label area above top-left
        if (x >= ann.x && x <= ann.x + 160 && y >= ann.y - 16 && y <= ann.y) return ann;
        break;
      }
      case 'scaleBar':
      case 'scheduleTable': {
        const imgCenter = { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
        const imgLocal = transformPointByInverseRotation(x, y, imgCenter.x, imgCenter.y, ann.rotation);
        const inBounds = imgLocal.x >= ann.x && imgLocal.x <= ann.x + ann.width && imgLocal.y >= ann.y && imgLocal.y <= ann.y + ann.height;
        if (!inBounds) break;
        if (ann.stampName === 'TitleBlock') {
          const bt = 6;
          const tt = ann.y + ann.height * 0.846;
          if (imgLocal.y >= tt) return ann;
          if (imgLocal.x <= ann.x + bt || imgLocal.x >= ann.x + ann.width - bt) return ann;
          if (imgLocal.y <= ann.y + bt || imgLocal.y >= ann.y + ann.height - bt) return ann;
          if (Math.abs(imgLocal.y - tt) < bt) return ann;
          break;
        }
        return ann;
      }
      case 'measureDistance': {
        const d = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (d < tol) return ann;
        // Also check extension lines
        if (ann.leaderStartX !== undefined) {
          const ld1 = distanceToLine(x, y, ann.startX, ann.startY, ann.leaderStartX, ann.leaderStartY);
          if (ld1 < tol) return ann;
          const ld2 = distanceToLine(x, y, ann.endX, ann.endY, ann.leaderEndX, ann.leaderEndY);
          if (ld2 < tol) return ann;
        }
        // Also check the measurement text anchor (midpoint + user textOffset)
        // so a label dragged away from the line still selects the dimension.
        if (ann.measureText && (ann.textOffsetX || ann.textOffsetY)) {
          const mdLblX = (ann.startX + ann.endX) / 2 + (ann.textOffsetX || 0);
          const mdLblY = (ann.startY + ann.endY) / 2 + (ann.textOffsetY || 0);
          const lblDist = Math.sqrt((x - mdLblX) ** 2 + (y - mdLblY) ** 2);
          if (lblDist < tol + 10) return ann;
        }
        break;
      }
      case 'measureArea':
      case 'measurePerimeter':
      case 'filledArea':
        if (ann.points && ann.points.length >= 2) {
          // Check proximity to any edge
          for (let i = 0; i < ann.points.length - 1; i++) {
            const d = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y);
            if (d < tol) return ann;
          }
          // For area, also check closing edge
          if ((ann.type === 'measureArea' || ann.type === 'filledArea') && ann.points.length >= 3) {
            const last = ann.points.length - 1;
            const d = distanceToLine(x, y, ann.points[last].x, ann.points[last].y, ann.points[0].x, ann.points[0].y);
            if (d < tol) return ann;
          }
          // Check hole edges
          if ((ann.type === 'measureArea' || ann.type === 'filledArea') && ann.holes) {
            for (const hole of ann.holes) {
              if (!hole || hole.length < 2) continue;
              for (let i = 0; i < hole.length - 1; i++) {
                const hd = distanceToLine(x, y, hole[i].x, hole[i].y, hole[i+1].x, hole[i+1].y);
                if (hd < tol) return ann;
              }
              if (hole.length >= 3) {
                const hd = distanceToLine(x, y, hole[hole.length-1].x, hole[hole.length-1].y, hole[0].x, hole[0].y);
                if (hd < tol) return ann;
              }
            }
          }
          // Point-in-polygon: click anywhere inside filled area
          if ((ann.type === 'measureArea' || ann.type === 'filledArea') && ann.points.length >= 3) {
            let insideOuter = pointInPolygon(x, y, ann.points);
            if (insideOuter) {
              let insideHole = false;
              if (ann.holes) {
                for (const hole of ann.holes) {
                  if (hole && hole.length >= 3 && pointInPolygon(x, y, hole)) {
                    insideHole = true;
                    break;
                  }
                }
              }
              if (!insideHole) return ann;
            }
          }
        }
        break;
      case 'measureAngle':
        if (ann.point1 && ann.vertex && ann.point2) {
          // Check proximity to the two rays
          const d1 = distanceToLine(x, y, ann.point1.x, ann.point1.y, ann.vertex.x, ann.vertex.y);
          if (d1 < tol) return ann;
          const d2 = distanceToLine(x, y, ann.vertex.x, ann.vertex.y, ann.point2.x, ann.point2.y);
          if (d2 < tol) return ann;
          // Check proximity to the arc
          const arcR = ann.arcRadius || 30;
          const dx = x - ann.vertex.x;
          const dy = y - ann.vertex.y;
          const distFromVertex = Math.sqrt(dx * dx + dy * dy);
          if (Math.abs(distFromVertex - arcR) < tol) {
            // Check the point is within the angle sweep
            const a1 = Math.atan2(ann.point1.y - ann.vertex.y, ann.point1.x - ann.vertex.x);
            const a2 = Math.atan2(ann.point2.y - ann.vertex.y, ann.point2.x - ann.vertex.x);
            const ap = Math.atan2(dy, dx);
            let sweep = a2 - a1;
            if (sweep < 0) sweep += 2 * Math.PI;
            let test = ap - a1;
            if (test < 0) test += 2 * Math.PI;
            if (sweep > Math.PI) {
              if (test > sweep) return ann;
            } else {
              if (test < sweep) return ann;
            }
          }
        }
        break;
      case 'textHighlight':
      case 'textStrikethrough':
      case 'textUnderline':
        // Check if clicking inside any of the text rects
        if (ann.rects && ann.rects.length > 0) {
          for (const rect of ann.rects) {
            if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
              return ann;
            }
          }
        } else {
          // Fallback to bounding box
          if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        }
        break;
      default: {
        const typeHandler = getAnnotationType(ann.type);
        if (typeHandler && typeHandler.hitTest) {
          if (typeHandler.hitTest(x, y, ann, tol)) return ann;
        }
        break;
      }
    }
  }
  return null;
}

// Check if point is inside annotation (for moving)
export function isPointInsideAnnotation(x, y, annotation) {
  // For shapes that support rotation, transform the point first
  const sizeInfo = getAnnotationCenterAndSize(annotation);
  let localX = x, localY = y;
  if (sizeInfo && annotation.rotation) {
    const transformed = transformPointByInverseRotation(x, y, sizeInfo.centerX, sizeInfo.centerY, annotation.rotation);
    localX = transformed.x;
    localY = transformed.y;
  }

  switch (annotation.type) {
    case 'box':
    case 'mask':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'callout':
      const w = annotation.width || 150;
      const h = annotation.height || 50;
      return localX >= annotation.x && localX <= annotation.x + w &&
             localY >= annotation.y && localY <= annotation.y + h;

    case 'circle':
      // Check if point is inside ellipse using bounding box model
      const ellW = annotation.width || annotation.radius * 2;
      const ellH = annotation.height || annotation.radius * 2;
      const ellCX = annotation.x + ellW / 2;
      const ellCY = annotation.y + ellH / 2;
      const ellRX = ellW / 2;
      const ellRY = ellH / 2;
      // Normalized distance from center (1 means on the ellipse boundary)
      const normDist = Math.pow((localX - ellCX) / ellRX, 2) + Math.pow((localY - ellCY) / ellRY, 2);
      return normDist <= 1;

    case 'arc': {
      const arcDx = x - annotation.centerX;
      const arcDy = y - annotation.centerY;
      const arcDist = Math.sqrt(arcDx * arcDx + arcDy * arcDy);
      return Math.abs(arcDist - annotation.radius) < 15;
    }

    case 'spline': {
      if (annotation.controlPoints && annotation.controlPoints.length >= 3) {
        const samples = catmullRomSpline(annotation.controlPoints, 16);
        for (let i = 0; i < samples.length - 1; i++) {
          const d = distanceToLine(localX, localY, samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y);
          if (d < 15) return true;
        }
      }
      return false;
    }

    case 'splineArrow': {
      if (annotation.points && annotation.points.length >= 2) {
        const samples = catmullRomSpline(annotation.points, 16);
        for (let i = 0; i < samples.length - 1; i++) {
          const d = distanceToLine(localX, localY, samples[i].x, samples[i].y, samples[i + 1].x, samples[i + 1].y);
          if (d < 15) return true;
        }
      }
      return false;
    }

    case 'line':
    case 'arrow':
      const lineDist = distanceToLine(x, y, annotation.startX, annotation.startY, annotation.endX, annotation.endY);
      return lineDist < 15;

    case 'comment':
      const commentW = annotation.width || 24;
      const commentH = annotation.height || 24;
      return localX >= annotation.x && localX <= annotation.x + commentW &&
             localY >= annotation.y && localY <= annotation.y + commentH;

    case 'text':
      if (annotationCtx) {
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        const textWidth = annotationCtx.measureText(annotation.text).width;
        const textHeight = annotation.fontSize || 16;
        return x >= annotation.x && x <= annotation.x + textWidth &&
               y >= annotation.y - textHeight && y <= annotation.y;
      }
      return false;

    case 'draw':
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      }
      return false;

    case 'betonbalk': {
      // Lijnstuk-band: raak binnen de bbox van start/eind ± halve breedte.
      const bbH = betonbalkHalfWidthPx(annotation);
      const bMinX = Math.min(annotation.startX, annotation.endX) - bbH;
      const bMaxX = Math.max(annotation.startX, annotation.endX) + bbH;
      const bMinY = Math.min(annotation.startY, annotation.endY) - bbH;
      const bMaxY = Math.max(annotation.startY, annotation.endY) + bbH;
      return x >= bMinX && x <= bMaxX && y >= bMinY && y <= bMaxY;
    }

    case 'polyline':
    case 'cloudPolyline':
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        return x >= plMinX && x <= plMaxX && y >= plMinY && y <= plMaxY;
      }
      return false;

    case 'viewport':
    case 'scaleRegion':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
    case 'scaleBar':
    case 'scheduleTable': {
      const inRect = localX >= annotation.x && localX <= annotation.x + annotation.width &&
                     localY >= annotation.y && localY <= annotation.y + annotation.height;
      if (!inRect) return false;
      // Title block: only hit-test the border and bottom table area
      if (annotation.stampName === 'TitleBlock') {
        const bTol = 6;
        const tableTop = annotation.y + annotation.height * 0.846;
        // In table area
        if (localY >= tableTop) return true;
        // On outer border edges
        if (localX <= annotation.x + bTol || localX >= annotation.x + annotation.width - bTol) return true;
        if (localY <= annotation.y + bTol || localY >= annotation.y + annotation.height - bTol) return true;
        // On inner content border
        if (Math.abs(localY - tableTop) < bTol) return true;
        return false;
      }
      return true;
    }

    case 'measureDistance': {
      const md = distanceToLine(x, y, annotation.startX, annotation.startY, annotation.endX, annotation.endY);
      if (md < 8) return true;
      if (annotation.leaderStartX !== undefined) {
        if (distanceToLine(x, y, annotation.startX, annotation.startY, annotation.leaderStartX, annotation.leaderStartY) < 8) return true;
        if (distanceToLine(x, y, annotation.endX, annotation.endY, annotation.leaderEndX, annotation.leaderEndY) < 8) return true;
      }
      return false;
    }

    case 'measureArea':
    case 'measurePerimeter':
    case 'filledArea':
      if (annotation.points && annotation.points.length >= 2) {
        for (let i = 0; i < annotation.points.length - 1; i++) {
          if (distanceToLine(x, y, annotation.points[i].x, annotation.points[i].y, annotation.points[i+1].x, annotation.points[i+1].y) < 8) return true;
        }
        if ((annotation.type === 'measureArea' || annotation.type === 'filledArea') && annotation.points.length >= 3) {
          const last = annotation.points.length - 1;
          if (distanceToLine(x, y, annotation.points[last].x, annotation.points[last].y, annotation.points[0].x, annotation.points[0].y) < 8) return true;
        }
      }
      return false;

    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Check if inside any of the text rects
      if (annotation.rects && annotation.rects.length > 0) {
        for (const rect of annotation.rects) {
          if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
            return true;
          }
        }
      }
      // Fallback to bounding box
      return x >= annotation.x && x <= annotation.x + annotation.width &&
             y >= annotation.y && y <= annotation.y + annotation.height;

    default:
      return false;
  }
}
