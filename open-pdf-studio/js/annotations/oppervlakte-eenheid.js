// Weergave-eenheid van een meetvlak (GitHub #1129): acres, hectares of een
// andere oppervlakte-eenheid dan het kwadraat van de schaal-eenheid.
//
// Een meetvlak rekent in de lengte-eenheid van zijn schaal; `measureValue` en
// `measureUnit` blijven het kwadraat daarvan ('ft²', 'mm²'). Daar hangen de
// eigen schaal, de zijdematen, de omtrek en de inhoud aan, dus die velden
// veranderen niet. Wat de gebruiker ZIET is een aparte keuze: het veld
// `measureAreaUnit` op het vlak. Zonder dat veld geldt het kwadraat van de
// lengte-eenheid, precies zoals bestaande documenten het tonen. Acre en
// hectare zijn eenheden van alleen oppervlakte: lengtes, omtrekken en schalen
// kunnen er niet in staan.
//
// Puur: geen app-state, geen DOM. De omrekening zelf (exacte factoren) staat
// in quantities/eenheid-omrekening.js.

import {
  normaliseerEenheid, eenheidSoort, rekenOm, isAlleenOppervlakte,
} from '../quantities/eenheid-omrekening.js';

/** De eenheden in de keuzelijsten; '' (niet in de lijst) volgt de schaal. */
export const OPPERVLAKTE_KEUZES = Object.freeze(['m²', 'ha', 'ft²', 'ac']);

/** Lengte-eenheden waarin een schaal kan staan (px en pt zonder vaste maat). */
export const SCHAAL_EENHEDEN = Object.freeze(['mm', 'cm', 'dm', 'm', 'km', 'in', 'ft', 'yd', 'pt', 'px']);

/** Eenheden van een schaalgebied "1:N" (scale-region-scale.js, pixelsPerUnitFor). */
export const SCHAALGEBIED_EENHEDEN = Object.freeze(['mm', 'cm', 'm', 'in', 'ft']);

const VOLGT_SCHAAL = new Set(['', 'auto', 'default']);

/**
 * Een oppervlakte-eenheid in de vaste notatie ('ac', 'ha', 'm²', 'ft²'), of
 * null als de invoer er geen is. "acres", "hectare", "m2" en "sq ft" worden
 * herkend. Met `lengteAlsKwadraat` telt een lengte-eenheid als haar
 * kwadraat ('ft' wordt 'ft²').
 * @param {unknown} invoer
 * @param {{lengteAlsKwadraat?: boolean}} [opties]
 * @returns {string|null}
 */
export function oppervlakteEenheid(invoer, { lengteAlsKwadraat = false } = {}) {
  const e = normaliseerEenheid(invoer);
  if (!e) return null;
  const soort = eenheidSoort(e);
  if (soort === 'area') return e;
  if (soort === 'length' && lengteAlsKwadraat) return `${e}²`;
  return null;
}

/**
 * De meting van een vlak in zijn weergave-eenheid. Zonder keuze, of als de
 * meting er niet naar om te rekenen is (een vlak in pixels zonder schaal),
 * blijft de meting zoals ze is.
 * @param {{value: number, unit: string}} meting  in het kwadraat van de schaal-eenheid
 * @param {unknown} eenheid  het veld measureAreaUnit van het vlak
 */
export function vlakWeergave(meting, eenheid) {
  const doel = oppervlakteEenheid(eenheid);
  if (!meting || !doel) return meting;
  const waarde = rekenOm(meting.value, meting.unit, doel);
  if (waarde == null) return meting;
  return { ...meting, value: waarde, unit: doel };
}

/**
 * De oppervlakte van een meetvlak zoals het blad hem toont, als getal:
 * { value, unit } in de weergave-eenheid van het vlak (measureAreaUnit), en
 * zonder die keuze in het kwadraat van de schaal-eenheid (mm² wordt m², zoals
 * het label). Null zonder gemeten waarde; `unit` null zonder bekende eenheid.
 * @param {{type?: string, measureValue?: number, measureUnit?: string, measureAreaUnit?: string}|null} ann
 * @returns {{value: number, unit: string|null}|null}
 */
export function vlakUitkomst(ann) {
  if (!ann || typeof ann.measureValue !== 'number' || Number.isNaN(ann.measureValue)) return null;
  const meting = ann.measureUnit === 'mm²'
    ? { value: ann.measureValue / 1e6, unit: 'm²' }
    : { value: ann.measureValue, unit: ann.measureUnit || null };
  return vlakWeergave(meting, ann.measureAreaUnit);
}

/** Kan een vlak met deze basis-eenheid ('ft²', 'px²') in `eenheid` getoond worden? */
export function vlakOmrekenbaar(basisEenheid, eenheid) {
  const doel = oppervlakteEenheid(eenheid);
  return !!doel && rekenOm(1, basisEenheid, doel) != null;
}

/**
 * Aantal decimalen van een oppervlakte in acres of hectares: drie onder de
 * tien (een kavel van 0,253 ac), anders twee.
 */
export function decimalenAlleenOppervlakte(waarde) {
  return Math.abs(Number(waarde)) < 10 ? 3 : 2;
}

export { isAlleenOppervlakte };

// ── Invoer van buiten (MCP) ────────────────────────────────────────────────
// Een eenheid die niet kan wordt geweigerd met een uitleg, in plaats van stil
// terug te vallen op de eenheid van de schaal.

const VOORBEELDEN = 'ac, ha, m², ft², yd², cm², in²';

/**
 * De gevraagde weergave-eenheid van een meetvlak.
 * @param {unknown} invoer  props.units / props.measureAreaUnit
 * @returns {{ok: true, unit: string|null} | {ok: false, error: string}}
 *   unit null: geen eigen keuze, het vlak volgt de schaal
 */
export function leesVlakEenheid(invoer) {
  if (invoer == null) return { ok: true, unit: null };
  if (typeof invoer !== 'string') {
    return { ok: false, error: `the area unit must be a string (${VOORBEELDEN}), or "auto" to follow the scale` };
  }
  if (VOLGT_SCHAAL.has(invoer.trim().toLowerCase())) return { ok: true, unit: null };
  const unit = oppervlakteEenheid(invoer, { lengteAlsKwadraat: true });
  if (!unit) {
    return {
      ok: false,
      error: `unsupported area unit '${invoer}'. Supported: ${VOORBEELDEN} (a length unit such as ft means ft²), or "auto" to follow the scale`,
    };
  }
  return { ok: true, unit };
}

/**
 * De eenheid-invoer van een meetvlak uit MCP-props: `units` (zoals bij een
 * schaalgebied) of `measureAreaUnit` (de naam van het veld zelf, zoals
 * app_get_annotation hem teruggeeft). `heeft` zegt of de aanroeper er een
 * meegaf; zonder invoer blijft het vlak zoals het is.
 * @param {Record<string, unknown>|null|undefined} props
 * @returns {{ok: true, heeft: boolean, unit: string|null} | {ok: false, error: string}}
 */
export function vlakEenheidUitProps(props) {
  const p = props || {};
  const heeft = 'measureAreaUnit' in p || 'units' in p;
  if (!heeft) return { ok: true, heeft: false, unit: null };
  const gelezen = leesVlakEenheid('measureAreaUnit' in p ? p.measureAreaUnit : p.units);
  return gelezen.ok ? { ok: true, heeft: true, unit: gelezen.unit } : gelezen;
}

/**
 * Past de gevraagde eenheid bij een vlak met deze basis-eenheid? Een vlak
 * zonder echte schaal (pixels) is niet naar acres om te rekenen.
 * @returns {string|null}  de foutmelding, of null als het kan
 */
export function vlakEenheidFout(basisEenheid, unit) {
  if (!unit || vlakOmrekenbaar(basisEenheid, unit)) return null;
  return `cannot report this area in '${unit}': the scale at this place has no real-world unit `
    + `(the area is in '${basisEenheid || 'px²'}'). Set a scale first with app_set_measure_scale or a scaleRegion`;
}

/**
 * De eenheid bij een lengte of omtrek: die volgt altijd de schaal. Een andere
 * eenheid dan die van de schaal wordt geweigerd.
 * @param {unknown} invoer        props.units
 * @param {string} schaalEenheid  de eenheid waarin de meting staat
 * @param {string} type           measureDistance | measurePerimeter
 * @returns {string|null}  de foutmelding, of null als het klopt
 */
export function lengteEenheidFout(invoer, schaalEenheid, type) {
  if (invoer == null || invoer === '') return null;
  if (typeof invoer !== 'string') return `props.units must be a string for ${type}`;
  const gevraagd = normaliseerEenheid(invoer);
  if (gevraagd === normaliseerEenheid(schaalEenheid)) return null;
  if (eenheidSoort(gevraagd) === 'area') {
    return `props.units '${invoer}' is an area unit and ${type} measures a length. `
      + `Use it on a measureArea; this length is reported in '${schaalEenheid}', the unit of the scale`;
  }
  return `props.units '${invoer}' is not supported for ${type}: a length is reported in the unit of the scale `
    + `at that place ('${schaalEenheid}'). Change the scale (app_set_measure_scale, or a scaleRegion with its own units) `
    + 'to measure in another unit';
}

/**
 * De lengte-eenheid van een schaal (app_set_measure_scale, scaleRegion).
 * @param {unknown} invoer
 * @param {readonly string[]} [toegestaan]  standaard elke schaal-eenheid;
 *   SCHAALGEBIED_EENHEDEN voor een schaalgebied
 * @returns {{ok: true, unit: string} | {ok: false, error: string}}
 */
export function leesSchaalEenheid(invoer, toegestaan = SCHAAL_EENHEDEN) {
  const lijst = toegestaan.join(', ');
  if (typeof invoer !== 'string' || !invoer.trim()) {
    return { ok: false, error: `missing or invalid unit: a scale needs a length unit (${lijst})` };
  }
  const unit = normaliseerEenheid(invoer);
  if (toegestaan.includes(unit)) return { ok: true, unit };
  if (eenheidSoort(unit) === 'area') {
    return {
      ok: false,
      error: `'${invoer}' is an area unit; a scale needs a length unit (${lijst}). `
        + 'To report an area in acres or hectares, set props.units on the measureArea',
    };
  }
  return { ok: false, error: `unsupported unit '${invoer}': a scale needs a length unit (${lijst})` };
}
