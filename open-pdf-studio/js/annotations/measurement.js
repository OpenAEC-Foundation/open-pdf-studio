import { state, getActiveDocument } from '../core/state.js';
import { openDialog } from '../bridge.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { savePreferences } from '../core/preferences.js';
import { getScaleForPoint } from './scale-bar.js';
import { getScaleFromRegion } from './scale-region.js';
import { cloneAnnotation } from './factory.js';
import {
  recordBulkModify,
  recordMeasureScale,
  beginUndoTransaction,
  endUndoTransaction,
} from '../core/undo-manager.js';

// Scale calibration: pixels per unit
// Priority: scaleRegion (innermost containing point) → scaleBar/viewport →
//          per-document scale → legacy global → default (px)
export function getMeasureScale(pageNum, x, y) {
  // 1. Check scaleRegion (innermost) — highest priority when a point is given
  if (pageNum != null && x != null && y != null) {
    const regionScale = getScaleFromRegion(pageNum, x, y);
    if (regionScale) return regionScale;
    const sbScale = getScaleForPoint(pageNum, x, y);
    if (sbScale) return sbScale;
  } else {
    // No point specified — check if any scaleBar exists (global fallback)
    const doc = getActiveDocument();
    if (doc?.annotations) {
      const scaleBars = doc.annotations.filter(a => a.type === 'scaleBar');
      if (scaleBars.length === 1) {
        return { pixelsPerUnit: scaleBars[0].pixelsPerUnit, unit: scaleBars[0].unit || 'mm' };
      }
    }
  }
  // 2. Per-document scale
  const doc = getActiveDocument();
  const docScale = doc?.measureScale;
  if (docScale && docScale.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docScale.pixelsPerUnit, unit: docScale.unit || 'mm' };
  }
  // 3. Legacy global preference
  const ms = state.preferences.measureScale;
  if (ms && ms.pixelsPerUnit > 0) {
    return { pixelsPerUnit: ms.pixelsPerUnit, unit: ms.unit || 'mm' };
  }
  return { pixelsPerUnit: 1, unit: 'mm' };
}

// Snap an endpoint so that the distance from (fromX,fromY) to the result
// is rounded to the nearest N measured units (N from preferences).  Returns { x, y }.
export function snapDistanceTo10(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  if (pixelDist === 0) return { x: toX, y: toY };
  const step = state.preferences.measureCtrlSnap || 10;
  const ms = getMeasureScale();
  const measuredValue = pixelDist / ms.pixelsPerUnit;
  const snappedValue = Math.max(Math.round(measuredValue / step) * step, step);
  const ratio = (snappedValue * ms.pixelsPerUnit) / pixelDist;
  return { x: fromX + dx * ratio, y: fromY + dy * ratio };
}

// Calculate distance between two points
// Optionally pass pageNum to resolve scale from scaleBar annotations at the midpoint
export function calculateDistance(x1, y1, x2, y2, pageNum) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const scale = (pageNum != null)
    ? getMeasureScale(pageNum, midX, midY)
    : getMeasureScale();
  return {
    value: pixelDist / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: pixelDist
  };
}

// Check if any point in the array has an arc flag
function _hasArcPoints(points) {
  return points.some(p => p.arc);
}

/**
 * Calculate the control point for an arc segment using the bulge factor.
 * The control point is at the midpoint of prev->current, offset perpendicular by bulge * distance.
 */
export function arcControlPoint(prev, current) {
  const bulge = current.bulge || 0.3;
  const mx = (prev.x + current.x) / 2;
  const my = (prev.y + current.y) / 2;
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Perpendicular direction (rotated 90 degrees CCW)
  const px = -dy / (dist || 1);
  const py = dx / (dist || 1);
  return {
    x: mx + px * bulge * dist,
    y: my + py * bulge * dist,
  };
}

/**
 * Expand polygon points that contain arc segments into a series of line segments
 * for accurate area calculation (shoelace formula approximation).
 * Each arc is subdivided into ~16 straight segments.
 */
export function expandArcPoints(points) {
  if (!points || points.length < 2) return points;
  const expanded = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const pt = points[i];
    if (pt.arc && i > 0) {
      const prev = points[i - 1];
      const cp = arcControlPoint(prev, pt);
      // Subdivide the quadratic bezier into segments
      const segments = 16;
      for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const t1 = 1 - t;
        expanded.push({
          x: t1 * t1 * prev.x + 2 * t1 * t * cp.x + t * t * pt.x,
          y: t1 * t1 * prev.y + 2 * t1 * t * cp.y + t * t * pt.y,
        });
      }
    } else {
      expanded.push({ x: pt.x, y: pt.y });
    }
  }
  // Handle closing segment: if first point has arc flag, expand it too
  if (points[0].arc && n >= 2) {
    const prev = points[n - 1];
    const pt = points[0];
    const cp = arcControlPoint(prev, pt);
    const segments = 16;
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const t1 = 1 - t;
      expanded.push({
        x: t1 * t1 * prev.x + 2 * t1 * t * cp.x + t * t * pt.x,
        y: t1 * t1 * prev.y + 2 * t1 * t * cp.y + t * t * pt.y,
      });
    }
  }
  return expanded;
}

// Shoelace formula for a single polygon ring (returns signed area * 2)
function shoelaceRaw(points) {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i].x * points[j].y;
    sum -= points[j].x * points[i].y;
  }
  return sum;
}

// Calculate area of a polygon (using shoelace formula), with optional holes subtracted
// Arc segments are expanded into line segments for accurate area calculation
// Optionally pass pageNum to resolve scale from scaleBar annotations at the centroid
export function calculateArea(points, holes, pageNum) {
  if (!points || points.length < 3) return { value: 0, unit: 'px\u00B2', pixels: 0 };

  // Expand arc segments into line approximations for accurate area
  const expandedOuter = _hasArcPoints(points) ? expandArcPoints(points) : points;
  let area = Math.abs(shoelaceRaw(expandedOuter)) / 2;

  // Subtract hole areas
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        const expandedHole = _hasArcPoints(hole) ? expandArcPoints(hole) : hole;
        area -= Math.abs(shoelaceRaw(expandedHole)) / 2;
      }
    }
  }
  area = Math.max(0, area);

  // Resolve scale using centroid of the polygon when page is provided
  let scale;
  if (pageNum != null && points.length > 0) {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    scale = getMeasureScale(pageNum, cx, cy);
  } else {
    scale = getMeasureScale();
  }
  const scaledArea = area / (scale.pixelsPerUnit * scale.pixelsPerUnit);
  return {
    value: scaledArea,
    unit: scale.unit + '\u00B2',
    pixels: area
  };
}

// Calculate perimeter of a polyline
// Optionally pass pageNum to resolve scale from scaleBar annotations at the midpoint
export function calculatePerimeter(points, pageNum) {
  if (!points || points.length < 2) return { value: 0, unit: 'px', pixels: 0 };

  let totalPixels = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    totalPixels += Math.sqrt(dx * dx + dy * dy);
  }

  // Resolve scale using centroid of the polyline when page is provided
  let scale;
  if (pageNum != null && points.length > 0) {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    scale = getMeasureScale(pageNum, cx, cy);
  } else {
    scale = getMeasureScale();
  }
  return {
    value: totalPixels / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: totalPixels
  };
}

// Apply measurement rounding based on preference
function applyRounding(value, unit) {
  const rounding = state.preferences.measureRounding;
  if (!rounding || rounding === 'none' || unit === 'px') return value;
  const step = parseFloat(rounding);
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

// Dimension-label formatter (maatlijnen): same as formatMeasurement, but in
// mm the unit suffix is OMITTED — NL drafting convention writes "436", not
// "436 mm" (mm is the implied drawing unit). Other units keep their suffix.
export function formatDimensionText(measurement) {
  const s = formatMeasurement(measurement);
  return (measurement?.unit || 'mm') === 'mm' ? s.replace(/\s*mm$/, '') : s;
}

// Format measurement for display
// Default: mm → no decimals; m/cm → 1 decimal; ft/in → 2 decimals
// Distances in mm >= 1000 are automatically shown as meters
// Area measurements in mm² are automatically converted to m² for readability
export function formatMeasurement(measurement) {
  let val = applyRounding(measurement.value, measurement.unit);
  let unit = measurement.unit || 'mm';

  // Keep mm as mm — common architectural/CAD convention. Whole numbers only
  // (no decimals) — millimeters are already the smallest practical unit.
  if (unit === 'mm') {
    const suffix = ` ${unit}`;
    const rounding = state.preferences.measureRounding;
    if (rounding && rounding !== 'none') {
      const step = parseFloat(rounding);
      if (step >= 1) return `${Math.round(val / step) * step}${suffix}`;
    }
    return `${Math.round(val)}${suffix}`;
  }

  // Always convert mm² areas to m²
  if (unit === 'mm\u00B2') {
    val = val / 1000000;
    unit = 'm\u00B2';
  }

  // Recalculate suffix after unit conversion
  const suffix = unit === 'px' ? '' : ` ${unit}`;
  const rounding = state.preferences.measureRounding;
  if (rounding && rounding !== 'none' && unit !== 'px') {
    const step = parseFloat(rounding);
    if (step >= 1) return `${Math.round(val)}${suffix}`;
    return `${val.toFixed(2)}${suffix}`;
  }
  // Default formatting per unit
  if (unit === 'm\u00B2') return `${val.toFixed(2)}${suffix}`;
  if (unit === 'm') return `${val.toFixed(2)}${suffix}`;
  if (unit === 'cm\u00B2') return `${val.toFixed(2)}${suffix}`;
  if (unit === 'cm') return `${val.toFixed(1)}${suffix}`;
  if (unit === 'ft\u00B2' || unit === 'in\u00B2') return `${val.toFixed(2)}${suffix}`;
  if (unit === 'ft' || unit === 'in') return `${val.toFixed(2)}${suffix}`;
  if (unit === '°') return `${val.toFixed(1)}${suffix}`;
  if (val < 0.01) return `0${suffix}`;
  if (val < 1) return `${val.toFixed(2)}${suffix}`;
  return `${val.toFixed(2)}${suffix}`;
}

// Show scale calibration dialog, optionally with a reference pixel length
export function showCalibrationDialog(referencePixelLength) {
  openDialog('calibration', { referencePixelLength: referencePixelLength || null });
}

// Set scale from a known line: given its pixel length and the real-world value + unit,
// update the document scale for future measurements.
// The source annotation's own measureScale/measureUnit are updated so the properties panel reflects the change.
export function setScaleFromLine(pixelLength, realValue, unit, sourceAnnotation) {
  if (!pixelLength || pixelLength <= 0 || !realValue || realValue <= 0) return;
  const pixelsPerUnit = pixelLength / realValue;
  const doc = getActiveDocument();
  if (!doc) return;
  const oldMeasureScale = doc.measureScale == null
    ? doc.measureScale
    : JSON.parse(JSON.stringify(doc.measureScale));
  const sourceOriginal = sourceAnnotation ? cloneAnnotation(sourceAnnotation) : null;
  doc.measureScale = { pixelsPerUnit, unit, method: 'quick-scale', scaleRatio: 0 };
  saveDocumentScale();

  // Update default preferences so future measurements use this scale/unit
  const scaleVal = realValue / pixelLength;
  state.preferences.measureDistDimScale = scaleVal;
  state.preferences.measureDistDimUnit = unit;
  state.preferences.measureAreaDimScale = scaleVal;
  state.preferences.measureAreaDimUnit = unit;
  state.preferences.measurePerimDimScale = scaleVal;
  state.preferences.measurePerimDimUnit = unit;
  savePreferences();

  // Update the source annotation's own scale/unit properties
  if (sourceAnnotation && sourceAnnotation.type === 'measureDistance') {
    sourceAnnotation.measureScale = realValue / pixelLength;
    sourceAnnotation.measureUnit = unit;
    const prec = sourceAnnotation.measurePrecision !== undefined ? sourceAnnotation.measurePrecision : 2;
    sourceAnnotation.measureText = `${realValue.toFixed(prec)} ${unit}`;
    sourceAnnotation.modifiedAt = new Date().toISOString();

    // Redraw canvas
    if (getActiveDocument()?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    // Refresh properties panel if this annotation is selected
    if (getActiveDocument()?.selectedAnnotation === sourceAnnotation) {
      import('../bridge.js').then(m => m.storeShowProperties(sourceAnnotation));
    }
  }
  beginUndoTransaction();
  if (sourceAnnotation && sourceOriginal) {
    recordBulkModify([sourceAnnotation], [sourceOriginal]);
  }
  recordMeasureScale(oldMeasureScale, doc.measureScale);
  endUndoTransaction();
}

// Get the representative point of a measurement annotation (for scale lookup)
function getAnnotationPoint(ann) {
  if (ann.type === 'measureDistance') {
    return { page: ann.page || 1, x: (ann.startX + ann.endX) / 2, y: (ann.startY + ann.endY) / 2 };
  }
  if ((ann.type === 'measureArea' || ann.type === 'measurePerimeter') && ann.points?.length > 0) {
    // Centroid
    const cx = ann.points.reduce((s, p) => s + p.x, 0) / ann.points.length;
    const cy = ann.points.reduce((s, p) => s + p.y, 0) / ann.points.length;
    return { page: ann.page || 1, x: cx, y: cy };
  }
  if (ann.type === 'measureAngle' && ann.vertex) {
    return { page: ann.page || 1, x: ann.vertex.x, y: ann.vertex.y };
  }
  return { page: ann.page || 1, x: 0, y: 0 };
}

// Recalculate all measurement annotations after scale change
// Each annotation gets its scale from its position (scaleBar region awareness)
export function recalculateAllMeasurements() {
  const doc = getActiveDocument();
  if (!doc) return;

  for (const ann of doc.annotations) {
    const pt = getAnnotationPoint(ann);
    const scale = getMeasureScale(pt.page, pt.x, pt.y);

    if (ann.type === 'measureDistance') {
      const pixels = ann.measurePixels || Math.sqrt(
        (ann.endX - ann.startX) ** 2 + (ann.endY - ann.startY) ** 2
      );
      const value = pixels / scale.pixelsPerUnit;
      ann.measureValue = value;
      ann.measureUnit = scale.unit;
      ann.measureScale = undefined; // Clear legacy per-annotation scale so formatMeasurement uses the scaleBar
      ann.measureText = formatDimensionText({ value, unit: scale.unit });
    } else if (ann.type === 'measureArea') {
      if (ann.points && ann.points.length >= 3) {
        // Use position-aware scale directly instead of calculateArea's global fallback
        // Expand arc segments into line approximations for accurate area (same as calculateArea)
        const expandedOuter = _hasArcPoints(ann.points) ? expandArcPoints(ann.points) : ann.points;
        const pixelArea = Math.abs(shoelaceRaw(expandedOuter)) / 2;
        let holeArea = 0;
        if (ann.holes && ann.holes.length > 0) {
          for (const hole of ann.holes) {
            if (hole && hole.length >= 3) {
              const expandedHole = _hasArcPoints(hole) ? expandArcPoints(hole) : hole;
              holeArea += Math.abs(shoelaceRaw(expandedHole)) / 2;
            }
          }
        }
        const netPixelArea = Math.max(0, pixelArea - holeArea);
        const scaledArea = netPixelArea / (scale.pixelsPerUnit * scale.pixelsPerUnit);
        const areaUnit = scale.unit + '\u00B2';
        ann.measureValue = scaledArea;
        ann.measureUnit = areaUnit;
        ann.measureScale = undefined;
        ann.measureText = formatMeasurement({ value: scaledArea, unit: areaUnit });
      }
    } else if (ann.type === 'measurePerimeter') {
      if (ann.points && ann.points.length >= 2) {
        // Use position-aware scale directly
        let totalPixels = 0;
        for (let i = 0; i < ann.points.length - 1; i++) {
          const dx = ann.points[i + 1].x - ann.points[i].x;
          const dy = ann.points[i + 1].y - ann.points[i].y;
          totalPixels += Math.sqrt(dx * dx + dy * dy);
        }
        const value = totalPixels / scale.pixelsPerUnit;
        ann.measureValue = value;
        ann.measureUnit = scale.unit;
        ann.measureScale = undefined;
        ann.measureText = formatMeasurement({ value, unit: scale.unit });
      }
    }
  }

  // Redraw canvas
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// LocalStorage key for per-document scale persistence
function scaleStorageKey(filePath) {
  return 'ops_measureScale_' + filePath;
}

// Save the current document's measure scale to localStorage
export function saveDocumentScale() {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath) return;
  const ms = doc.measureScale;
  if (ms) {
    try {
      localStorage.setItem(scaleStorageKey(doc.filePath), JSON.stringify(ms));
    } catch { /* quota exceeded or private mode */ }
  } else {
    localStorage.removeItem(scaleStorageKey(doc.filePath));
  }
}

// Load measure scale from localStorage into the given (or active) document
export function loadDocumentScale(doc) {
  if (!doc) doc = getActiveDocument();
  if (!doc || !doc.filePath) return;
  try {
    const raw = localStorage.getItem(scaleStorageKey(doc.filePath));
    if (raw) {
      doc.measureScale = JSON.parse(raw);
    }
  } catch { /* corrupted data */ }
}
