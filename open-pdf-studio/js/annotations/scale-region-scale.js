// Pure scale conversion shared by the drawing tools and PDF serialization.
export function parseScaleString(s) {
  if (!s) return null;
  const m = String(s).match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const denom = parseFloat(m[1]);
  if (!denom || denom <= 0) return null;
  return denom;
}

export function pixelsPerUnitFor(scaleString, units) {
  const denom = parseScaleString(scaleString);
  if (!denom) return 1;
  const ppmm = (72 / 25.4) / denom;
  switch (units) {
    case 'mm': return ppmm;
    case 'cm': return ppmm * 10;
    case 'm':  return ppmm * 1000;
    case 'in': return ppmm * 25.4;
    case 'ft': return ppmm * 304.8;
    default:   return ppmm;
  }
}
