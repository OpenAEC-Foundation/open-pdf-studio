export const UI_SCALES = [100, 125, 150, 175, 200];
export function normalizeUiScale(value) {
  const number = Number(value);
  return UI_SCALES.includes(number) ? number : 100;
}
