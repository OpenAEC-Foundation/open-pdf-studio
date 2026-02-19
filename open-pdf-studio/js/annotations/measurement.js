import { state } from '../core/state.js';
import { openDialog } from '../solid/stores/dialogStore.js';

// Scale calibration: pixels per unit
// Default: 1 pixel = 1 pixel (no calibration)
// After calibration: state.preferences.measureScale = { pixelsPerUnit, unit }
export function getMeasureScale() {
  const ms = state.preferences.measureScale;
  if (ms && ms.pixelsPerUnit > 0) {
    return { pixelsPerUnit: ms.pixelsPerUnit, unit: ms.unit || 'px' };
  }
  return { pixelsPerUnit: 1, unit: 'px' };
}

// Calculate distance between two points
export function calculateDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  const scale = getMeasureScale();
  return {
    value: pixelDist / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: pixelDist
  };
}

// Calculate area of a polygon (using shoelace formula)
export function calculateArea(points) {
  if (!points || points.length < 3) return { value: 0, unit: 'px\u00B2', pixels: 0 };

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  area = Math.abs(area) / 2;

  const scale = getMeasureScale();
  const scaledArea = area / (scale.pixelsPerUnit * scale.pixelsPerUnit);
  return {
    value: scaledArea,
    unit: scale.unit + '\u00B2',
    pixels: area
  };
}

// Calculate perimeter of a polyline
export function calculatePerimeter(points) {
  if (!points || points.length < 2) return { value: 0, unit: 'px', pixels: 0 };

  let totalPixels = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    totalPixels += Math.sqrt(dx * dx + dy * dy);
  }

  const scale = getMeasureScale();
  return {
    value: totalPixels / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: totalPixels
  };
}

// Format measurement for display
export function formatMeasurement(measurement) {
  const val = measurement.value;
  if (val < 0.01) return `0 ${measurement.unit}`;
  if (val < 1) return `${val.toFixed(3)} ${measurement.unit}`;
  if (val < 100) return `${val.toFixed(2)} ${measurement.unit}`;
  return `${val.toFixed(1)} ${measurement.unit}`;
}

// Show scale calibration dialog
export function showCalibrationDialog() {
  openDialog('calibration');
}
