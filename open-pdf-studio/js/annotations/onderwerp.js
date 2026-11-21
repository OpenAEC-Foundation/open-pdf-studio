// Tekenobjecten bewaren hun opmerking (/Contents) in het historische veld
// subject. Het aparte veld pdfSubject hoort bij het PDF-onderwerp (/Subj).
const tekenobjecten = new Set([
  'line', 'arrow', 'polyline', 'spline', 'splineArrow', 'arc', 'draw',
  'box', 'circle', 'polygon', 'cloud', 'highlight', 'filledArea', 'redaction',
]);

export function onderwerpVeld(type) {
  return tekenobjecten.has(type) ? 'pdfSubject' : 'subject';
}

export function annotatieOnderwerp(ann) {
  return ann[onderwerpVeld(ann.type)] ?? ann.subject ?? '';
}
