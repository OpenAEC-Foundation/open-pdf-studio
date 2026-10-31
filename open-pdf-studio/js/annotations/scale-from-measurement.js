/**
 * Scale-from-measurement — pure calculation helpers for deriving a drawing
 * scale (1:N) from a distance measured on the page.
 *
 * The measured distance comes in app-space units (page pixels at scale=1,
 * which equal PDF points: 1 pt = 1/72 inch). The user supplies the real-world
 * length that distance represents (value + unit). From those two we compute
 * the scale denominator N such that the drawing is at 1:N.
 *
 * No imports — this module is intentionally dependency-free so the math can
 * be unit-tested directly under Node.
 */

// Millimetres per supported unit (matches pixelsPerUnitFor in scale-region.js).
export const MM_PER_UNIT = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

// Page units → millimetres on paper (1 unit = UserUnit · 25.4/72 mm; #884).
function geldig(userUnit) {
  const u = Number(userUnit);
  return Number.isFinite(u) && u > 0 ? u : 1;
}
export function pointsToPaperMm(distancePts, userUnit = 1) {
  return distancePts * geldig(userUnit) * 25.4 / 72;
}

/**
 * Exact scale denominator N (real / paper) for a measured page distance.
 *
 * @param {number} distancePts  Measured distance in app-space units (PDF points).
 * @param {number} realValue    Real-world length the distance represents.
 * @param {string} realUnit     Unit of realValue: mm | cm | m | in | ft.
 * @param {number} [userUnit]   /UserUnit of the page (default 1).
 * @returns {number|null}       Exact N (may be fractional), or null when invalid.
 */
export function computeScaleDenominator(distancePts, realValue, realUnit, userUnit = 1) {
  const d = Number(distancePts);
  const v = Number(realValue);
  const mmPerUnit = MM_PER_UNIT[realUnit];
  if (!isFinite(d) || d <= 0) return null;
  if (!isFinite(v) || v <= 0) return null;
  if (!mmPerUnit) return null;
  const paperMm = pointsToPaperMm(d, userUnit);
  const realMm = v * mmPerUnit;
  return realMm / paperMm;
}

/**
 * Format a scale denominator to a tidy display value:
 *  - snaps to a whole number when within 0.5% (measuring by hand is never
 *    exact — 1:99.7 almost certainly means 1:100);
 *  - otherwise keeps 4 significant digits (so at least 3 are meaningful).
 *
 * @param {number} n  Exact denominator.
 * @returns {string|null}  e.g. "100", "53.42", "0.5" — null when invalid.
 */
export function formatScaleDenominator(n) {
  if (!isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  if (rounded >= 1 && Math.abs(n - rounded) / n <= 0.005) return String(rounded);
  // 4 significant digits, trailing zeros stripped by parseFloat.
  const digitsBeforePoint = Math.floor(Math.log10(n)) + 1;
  const decimals = Math.max(0, 4 - digitsBeforePoint);
  return String(parseFloat(n.toFixed(decimals)));
}

/**
 * Full pipeline: measured page distance + real length → "1:N" scale string.
 * Returns null when the inputs are invalid.
 */
export function scaleStringFromMeasurement(distancePts, realValue, realUnit, userUnit = 1) {
  const n = computeScaleDenominator(distancePts, realValue, realUnit, userUnit);
  if (n === null) return null;
  const s = formatScaleDenominator(n);
  return s ? `1:${s}` : null;
}
