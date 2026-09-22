// Single source of truth for "does this annotation have a fill?".
//
// A fill color counts as NO fill when it is absent or one of the sentinel
// no-fill values. 'none' is the canonical no-fill value the app writes for new
// annotations; 'transparent' is treated identically because (a) older saved
// data and some creators historically used it, and (b) the user asked that
// "transparant" behave as "geen" everywhere.
//
// Why this matters: hexToColorArray('transparent') / hexToColorArray('none')
// resolve to BLACK. Any save path that wrote /IC or /C without excluding these
// sentinels produced a black fill that reopened as an opaque black box. Routing
// every fill decision through hasFill() guarantees no-fill stays no-fill across
// rendering, saving and loading.
export function hasFill(color) {
  return !!color && color !== 'none' && color !== 'transparent';
}

// "Does this annotation have a border?" — same sentinel convention as
// hasFill(), but note the caller-side difference: strokeColor falls back to
// `annotation.color` when unset (`annotation.strokeColor || annotation.color`
// in rendering.js), so an unset strokeColor still has a border. Only the
// explicit sentinel ('none'/'transparent', set by the Stroke Color picker's
// "No Border" option) means no border — check the raw annotation.strokeColor,
// not the already-defaulted value.
export function hasStroke(strokeColor) {
  return strokeColor !== 'none' && strokeColor !== 'transparent';
}

// Soorten waarvan de omtrek weg kan ("geen rand"): alleen hier slaat
// rendering.js de omtrek over en schrijft de saver een vorm zonder rand. Een
// lijn, pijl, vrije hand of maatlijn IS zijn streek; daar is "geen" geen keuze.
export const SOORTEN_ZONDER_RAND = new Set([
  'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'filledArea', 'measureArea',
]);

export function kanZonderRand(type) {
  return SOORTEN_ZONDER_RAND.has(type);
}

// Kleur van wat bij een vorm zonder rand wél getekend wordt: het kruis, de
// aanhaallijn, het maatlabel. Dat is de eigen kleur van de annotatie, net als
// in rendering.js (`annotation.color || '#000000'`); de saver gebruikt dezelfde
// regel, zodat andere lezers hetzelfde te zien krijgen als het scherm.
export function colorWithoutStroke(annotation) {
  const c = annotation && annotation.color;
  return hasFill(c) ? c : '#000000';
}
