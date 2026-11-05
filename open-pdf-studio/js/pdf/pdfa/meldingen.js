// Teksten voor PDF/A-bevindingen en -wijzigingen (#379). De validatie en de
// conversie geven codes met details; dit maakt er een vertaalde zin van met
// de sleutels onder dialogs:pdfa.

/** 'PDF/A-2b' voor deel 2. */
export function pdfaLabel(deel, conformance = 'b') {
  return `PDF/A-${deel}${String(conformance || 'b').toLowerCase()}`;
}

/** De vertaalsleutel van een bevinding: pdfa.rule.<code_met_underscores>[_<probleem>]. */
export function bevindingSleutel(b) {
  const basis = String(b.code).replace(/\./g, '_');
  return `pdfa.rule.${basis}${b.details?.problem ? `_${b.details.problem}` : ''}`;
}

/**
 * @param {(sleutel: string, opties?: object) => string} t vertaalfunctie (namespace dialogs)
 * @param {{ code: string, details?: object }} b
 */
export function bevindingTekst(t, b) {
  const d = { ...(b.details || {}) };
  if (d.what) d.what = t(`pdfa.limit.${d.what}`);
  return t(bevindingSleutel(b), d);
}

/** @param {{ code: string, details?: object }} w */
export function wijzigingTekst(t, w) {
  const d = { ...(w.details || {}) };
  if (Array.isArray(d.reasons)) d.reasons = d.reasons.map((r) => t(`pdfa.reason.${r}`)).join(', ');
  return t(`pdfa.${w.code}`, d);
}
