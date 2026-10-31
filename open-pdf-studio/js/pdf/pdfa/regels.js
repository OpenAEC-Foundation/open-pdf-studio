// De PDF/A-regels die validatie.js controleert en conversie.js herstelt
// (#379). Per regel de clausule in ISO 19005-1 (deel 1) en ISO 19005-2/-3
// (deel 2 en 3 delen hun nummering) en voor welke delen hij geldt. De
// meldingstekst staat in de vertalingen onder dialogs:pdfa.rule.<code>.

/** @typedef {1|2|3} Deel */

/**
 * code → { delen, clausule: { 1?: string, 2?: string } }
 * `clausule[2]` geldt ook voor deel 3.
 */
export const REGELS = Object.freeze({
  'file.header': { delen: [1, 2, 3], clausule: { 1: '6.1.2', 2: '6.1.2' } },
  'file.trailerId': { delen: [1, 2, 3], clausule: { 1: '6.1.3', 2: '6.1.3' } },
  'file.encrypted': { delen: [1, 2, 3], clausule: { 1: '6.1.3', 2: '6.1.3' } },
  'file.dataAfterEof': { delen: [1, 2, 3], clausule: { 1: '6.1.3', 2: '6.1.3' } },
  'file.xrefStream': { delen: [1], clausule: { 1: '6.1.4' } },
  'file.lzw': { delen: [1, 2, 3], clausule: { 1: '6.1.10', 2: '6.1.7.2' } },
  'file.externalStream': { delen: [1, 2, 3], clausule: { 1: '6.1.7', 2: '6.1.7.1' } },
  'file.cryptFilter': { delen: [2, 3], clausule: { 2: '6.1.7.2' } },
  'file.limits': { delen: [1, 2, 3], clausule: { 1: '6.1.12', 2: '6.1.13' } },
  'meta.missing': { delen: [1, 2, 3], clausule: { 1: '6.7.2', 2: '6.6.2.1' } },
  'meta.filtered': { delen: [1], clausule: { 1: '6.7.2' } },
  'meta.packet': { delen: [1, 2, 3], clausule: { 1: '6.7.5', 2: '6.6.2.1' } },
  'meta.pdfaid': { delen: [1, 2, 3], clausule: { 1: '6.7.11', 2: '6.6.4' } },
  'meta.infoMismatch': { delen: [1, 2, 3], clausule: { 1: '6.7.3', 2: '6.6.2.3' } },
  'oi.missing': { delen: [1, 2, 3], clausule: { 1: '6.2.2', 2: '6.2.3' } },
  'oi.profile': { delen: [1, 2, 3], clausule: { 1: '6.2.2', 2: '6.2.3' } },
  'oi.multiple': { delen: [1, 2, 3], clausule: { 1: '6.2.2', 2: '6.2.3' } },
  'color.device': { delen: [1, 2, 3], clausule: { 1: '6.2.3.3', 2: '6.2.4.3' } },
  'color.renderingIntent': { delen: [1, 2, 3], clausule: { 1: '6.2.9', 2: '6.2.5' } },
  'gs.transfer': { delen: [1, 2, 3], clausule: { 1: '6.2.8', 2: '6.2.5' } },
  'font.notEmbedded': { delen: [1, 2, 3], clausule: { 1: '6.3.4', 2: '6.2.11.4' } },
  'font.widths': { delen: [1, 2, 3], clausule: { 1: '6.3.6', 2: '6.2.11.5' } },
  'font.encoding': { delen: [1, 2, 3], clausule: { 1: '6.3.7', 2: '6.2.11.6' } },
  'font.cidToGid': { delen: [1, 2, 3], clausule: { 1: '6.3.3.2', 2: '6.2.11.3.2' } },
  'font.subsetSet': { delen: [1], clausule: { 1: '6.3.5' } },
  'transp.smask': { delen: [1], clausule: { 1: '6.4' } },
  'transp.alpha': { delen: [1], clausule: { 1: '6.4' } },
  'transp.blend': { delen: [1, 2, 3], clausule: { 1: '6.4', 2: '6.2.10' } },
  'transp.group': { delen: [1], clausule: { 1: '6.4' } },
  'image.interpolate': { delen: [1, 2, 3], clausule: { 1: '6.2.4', 2: '6.2.8' } },
  'image.alternates': { delen: [1, 2, 3], clausule: { 1: '6.2.4', 2: '6.2.8' } },
  'image.jpx': { delen: [1], clausule: { 1: '6.1.10' } },
  'xobject.forbidden': { delen: [1, 2, 3], clausule: { 1: '6.2.5', 2: '6.2.9' } },
  'action.forbidden': { delen: [1, 2, 3], clausule: { 1: '6.6.1', 2: '6.5.1' } },
  'action.named': { delen: [1, 2, 3], clausule: { 1: '6.6.1', 2: '6.5.1' } },
  'action.javascript': { delen: [1, 2, 3], clausule: { 1: '6.6.1', 2: '6.5.1' } },
  'action.additional': { delen: [1, 2, 3], clausule: { 1: '6.6.2', 2: '6.5.2' } },
  'embed.forbidden': { delen: [1], clausule: { 1: '6.1.11' } },
  'embed.notPdfA': { delen: [2], clausule: { 2: '6.8' } },
  'embed.spec': { delen: [3], clausule: { 2: '6.8' } },
  'annot.type': { delen: [1, 2, 3], clausule: { 1: '6.5.2', 2: '6.3.1' } },
  'annot.flags': { delen: [1, 2, 3], clausule: { 1: '6.5.3', 2: '6.3.2' } },
  'annot.appearance': { delen: [1, 2, 3], clausule: { 1: '6.5.3', 2: '6.3.3' } },
  'annot.alpha': { delen: [1], clausule: { 1: '6.5.3' } },
  'annot.color': { delen: [1], clausule: { 1: '6.5.3' } },
  'form.needAppearances': { delen: [1, 2, 3], clausule: { 1: '6.9', 2: '6.4.1' } },
  'form.xfa': { delen: [2, 3], clausule: { 2: '6.4.2' } },
  'oc.forbidden': { delen: [1], clausule: { 1: '6.1.13' } },
  'oc.config': { delen: [2, 3], clausule: { 2: '6.9' } },
  'catalog.forbidden': { delen: [2, 3], clausule: { 2: '6.1.3' } },
});

/** Annotatietypen uit PDF 1.4 die PDF/A-1 toestaat (6.5.2). */
export const ANNOTATIES_DEEL1 = Object.freeze(new Set([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline',
  'Squiggly', 'StrikeOut', 'Stamp', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet',
]));

/** Annotatietypen uit ISO 32000-1, zonder 3D, Sound, Screen en Movie (deel 2/3, 6.3.1). */
export const ANNOTATIES_DEEL2 = Object.freeze(new Set([
  ...ANNOTATIES_DEEL1, 'Polygon', 'PolyLine', 'Caret', 'FileAttachment', 'Redact', 'Watermark',
]));

/**
 * Acties die wel mogen (deel 1: 6.6.1, deel 2/3: 6.5.1). Alles daarbuiten,
 * zoals Launch, JavaScript, ResetForm, ImportData, Hide, Sound en Movie, is
 * verboden.
 */
export const TOEGESTANE_ACTIES = Object.freeze({
  1: new Set(['GoTo', 'GoToR', 'Thread', 'URI', 'Named', 'SubmitForm']),
  2: new Set(['GoTo', 'GoToR', 'GoToE', 'Thread', 'URI', 'Named', 'SubmitForm']),
});

/** Named-acties die wel mogen. */
export const TOEGESTANE_NAMED = Object.freeze(new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']));

/** Mengmodi uit ISO 32000-1 (deel 2/3: andere waarden zijn fout). */
export const MENGMODI = Object.freeze(new Set([
  'Normal', 'Compatible', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge',
  'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity',
]));

export const WEERGAVE_INTENTIES = Object.freeze(new Set(['Perceptual', 'RelativeColorimetric', 'Saturation', 'AbsoluteColorimetric']));

/** Annotatievlaggen (ISO 32000-1 tabel 165). */
export const VLAG = Object.freeze({ Invisible: 1, Hidden: 2, Print: 4, NoView: 32, ToggleNoView: 256 });

/** Grenzen van PDF/A-1 (ISO 19005-1 6.1.12, PDF 1.4 bijlage C). */
export const GRENZEN_DEEL1 = Object.freeze({
  integer: 2147483647, real: 32767, string: 65535, name: 127, array: 8191, dict: 4095, qNesting: 28,
});

/** Grenzen van PDF/A-2 en -3 (ISO 19005-2 6.1.13). Geen grens = Infinity. */
export const GRENZEN_DEEL2 = Object.freeze({
  integer: 2147483647, real: 3.403e38, string: 32767, name: 127, array: Infinity, dict: Infinity, qNesting: 28,
});

export const DELEN = Object.freeze([1, 2, 3]);

/** De clausule van een regel voor een deel ('' als onbekend). */
export function clausuleVoor(code, deel) {
  const r = REGELS[code];
  if (!r) return '';
  return r.clausule[deel === 1 ? 1 : 2] || r.clausule[1] || '';
}

/** Geldt deze regel voor dit deel? */
export function geldtVoor(code, deel) {
  return !!REGELS[code]?.delen.includes(deel);
}
