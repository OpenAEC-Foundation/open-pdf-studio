// The zoom shown to the user is relative to a screen resolution (dpi), a
// page-display setting: at 100% a PDF point (1/72 in) is drawn dpi/72 CSS
// pixels wide. 110 gives a comfortable reading size on a 2560x1440 screen;
// 96 is the usual browser value. Internally doc.scale / viewport.zoom stay
// in "CSS pixels per PDF point".
export const DEFAULT_ZOOM_DPI = 110;
export const MIN_ZOOM_DPI = 50;
export const MAX_ZOOM_DPI = 300;

let _dpi = DEFAULT_ZOOM_DPI;

export function normalizeZoomDpi(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_DPI;
  return Math.min(MAX_ZOOM_DPI, Math.max(MIN_ZOOM_DPI, n));
}

export function setZoomDpi(value) {
  _dpi = normalizeZoomDpi(value);
}

export function getZoomDpi() {
  return _dpi;
}

/** CSS pixels per PDF point at 100%. */
export function cssPxPerPtAt100(dpi = _dpi) {
  return normalizeZoomDpi(dpi) / 72;
}

export function scaleToPercent(scale, dpi = _dpi) {
  return Math.round((scale / cssPxPerPtAt100(dpi)) * 100);
}

export function percentToScale(percent, dpi = _dpi) {
  return (percent / 100) * cssPxPerPtAt100(dpi);
}

// Round zoom levels for the zoom buttons and keys, like other PDF viewers.
export const ZOOM_PERCENT_STEPS = [
  10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 6400,
];

/** Next step above (direction > 0) or below the given percentage; clamped at the ends. */
export function nextZoomPercent(percent, direction) {
  const eps = 0.5;
  if (direction > 0) {
    for (const step of ZOOM_PERCENT_STEPS) if (step > percent + eps) return step;
    return ZOOM_PERCENT_STEPS[ZOOM_PERCENT_STEPS.length - 1];
  }
  for (let i = ZOOM_PERCENT_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_PERCENT_STEPS[i] < percent - eps) return ZOOM_PERCENT_STEPS[i];
  }
  return ZOOM_PERCENT_STEPS[0];
}

/** Next round-percentage zoom as an internal scale (CSS px per PDF point). */
export function nextScaleStep(scale, direction, dpi = _dpi) {
  const percent = (scale / cssPxPerPtAt100(dpi)) * 100;
  return percentToScale(nextZoomPercent(percent, direction), dpi);
}
