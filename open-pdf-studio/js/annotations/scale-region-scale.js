// Pure scale conversion shared by the drawing tools and PDF serialization.
//
// /UserUnit (#884): the app's page space counts in the page's own units
// (page.view, see renderer.js), and one unit is UserUnit/72 inch. A scale
// written as 1:N says how paper relates to reality, so the number of page
// units per real unit is (72 / 25.4) / N / UserUnit. This is the one place
// where page units become paper millimetres for every scale given as 1:N
// (title block, calibration ratio, scale regions, viewport annotations).
// Scales measured on the page itself (reference line, quick scale, scale
// bar) are already in page units and need no correction; a /VP /Measure
// counts per unit too (pdf-viewports.js).

/** A usable /UserUnit: a positive finite number, otherwise 1. */
export function geldigeUserUnit(u) {
  const n = Number(u);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The /UserUnit of a page of the document (doc.pageUserUnits, read with the
 * /VP viewports in pdf-viewports.js); 1 when unknown.
 * @param {{pageUserUnits?: Record<number, number>} | null | undefined} doc
 * @param {number} pageNum  1-based
 */
export function userUnitVanPagina(doc, pageNum) {
  return geldigeUserUnit(doc?.pageUserUnits?.[pageNum]);
}

export function parseScaleString(s) {
  if (!s) return null;
  const m = String(s).match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const denom = parseFloat(m[1]);
  if (!denom || denom <= 0) return null;
  return denom;
}

/**
 * Page units per real unit for a scale "1:N".
 * @param {string} scaleString
 * @param {string} units      mm | cm | m | in | ft
 * @param {number} [userUnit] /UserUnit of the page (default 1)
 */
export function pixelsPerUnitFor(scaleString, units, userUnit = 1) {
  const denom = parseScaleString(scaleString);
  if (!denom) return 1;
  const ppmm = (72 / 25.4) / denom / geldigeUserUnit(userUnit);
  switch (units) {
    case 'mm': return ppmm;
    case 'cm': return ppmm * 10;
    case 'm':  return ppmm * 1000;
    case 'in': return ppmm * 25.4;
    case 'ft': return ppmm * 304.8;
    default:   return ppmm;
  }
}
