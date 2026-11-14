// Apply only to zoom gestures; scrolling and tool wheel actions keep their direction.
export function wheelZoomDelta(deltaY, preferences) {
  const delta = Number.isFinite(deltaY) ? deltaY : 0;
  return preferences?.reverseWheelZoom === true ? -delta : delta;
}
