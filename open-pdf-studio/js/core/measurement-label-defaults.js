// Labels entered before drawing are content defaults, not styles. Applying
// a colour/line style to an existing measurement must not rename it.
const PREFIX = {
  measureDistance: 'measureDist', measureArea: 'measureArea',
  measurePerimeter: 'measurePerim', measureAngle: 'measureAngle',
};

function preferenceKey(type, key) {
  if (!Object.hasOwn(PREFIX, type)) return null;
  if (key === 'subject') return PREFIX[type] + 'Subject';
  if (type === 'measureArea' && key === 'measureName') return PREFIX[type] + 'Name';
  return null;
}

export function writeMeasurementLabelDefault(prefs, type, key, value) {
  const pref = preferenceKey(type, key);
  if (!pref) return false;
  prefs[pref] = String(value ?? '');
  return true;
}

export function measurementLabelDefaults(prefs, type) {
  const values = {};
  for (const key of ['subject', 'measureName']) {
    const pref = preferenceKey(type, key);
    if (pref && typeof prefs?.[pref] === 'string') values[key] = prefs[pref];
  }
  return values;
}
