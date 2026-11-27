// Display-only settings. Never change page bytes or annotation appearance.
export const DEFAULT_CONTENT_VIEW = Object.freeze({ enabled: false, grayscale: 100, brightness: 100, opacity: 100 });
export function normalizeContentView(value) {
  const n = (key, min, max) => typeof value?.[key] === 'number' && Number.isFinite(value[key])
    ? Math.max(min, Math.min(max, value[key])) : DEFAULT_CONTENT_VIEW[key];
  return { enabled: value?.enabled === true, grayscale: n('grayscale', 0, 100),
    brightness: n('brightness', 25, 200), opacity: n('opacity', 0, 100) };
}
export function contentViewFilter(value) {
  const v = normalizeContentView(value);
  if (!v.enabled) return 'none';
  // Fade toward white without making the paper transparent to the gray desk.
  return `grayscale(${v.grayscale / 100}) brightness(${v.brightness / 100}) invert(1) brightness(${v.opacity / 100}) invert(1)`;
}
