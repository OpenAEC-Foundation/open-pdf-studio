// Ratios stay dimensionless in saved document scales. Imperial labels are
// familiar paper-inch / real-foot notation; choosing one defaults to feet.
export const METRIC_SCALE_PRESETS = [
  '1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50',
  '1:100', '1:200', '1:250', '1:500', '1:1000',
];

export const IMPERIAL_SCALE_PRESETS = [
  ['1/32', 384], ['1/16', 192], ['3/32', 128], ['1/8', 96],
  ['3/16', 64], ['1/4', 48], ['3/8', 32], ['1/2', 24],
  ['3/4', 16], ['1', 12], ['1 1/2', 8], ['3', 4],
].map(([inches, denominator]) => ({
  ratio: `1:${denominator}`, label: `${inches}" = 1'-0" (1:${denominator})`,
})).concat([10, 20, 30, 40, 50, 60, 100].map(feet => ({
  ratio: `1:${feet * 12}`, label: `1" = ${feet}'-0" (1:${feet * 12})`,
})));

export const SCALE_PRESETS = [
  ...METRIC_SCALE_PRESETS,
  ...IMPERIAL_SCALE_PRESETS.map(preset => preset.ratio),
];

/** Is this ratio one of the imperial presets (picking it defaults to feet)? */
export function isImperialScalePreset(ratio) {
  return IMPERIAL_SCALE_PRESETS.some(preset => preset.ratio === ratio);
}

/** Toegestane waarden van de voorkeur scaleUnitSystem (#996). */
export const SCALE_UNIT_SYSTEMS = Object.freeze(['both', 'metric', 'imperial']);

/** @type {null | (() => string)} */
let systeemBron = null;

/** Zet de bron van de voorkeur scaleUnitSystem (de app); null = beide. */
export function stelSchaalSysteemBronIn(fn) {
  systeemBron = typeof fn === 'function' ? fn : null;
}

/** Het eenhedenstelsel van de schaallijsten nu: 'both', 'metric' of 'imperial'. */
export function schaalSysteem() {
  let s;
  try { s = systeemBron ? systeemBron() : 'both'; } catch { s = 'both'; }
  return SCALE_UNIT_SYSTEMS.includes(s) ? s : 'both';
}

/**
 * Alleen de standaardschalen van het gekozen stelsel (#996): Metrisch,
 * Imperiaal of Beide. De huidige waarde blijft altijd in de lijst, ook als
 * hij uit het andere stelsel komt, zodat een keuzelijst nooit leeg toont.
 * @param {{value: string, label: string}[]} options  waarden "1:N"
 * @param {{system?: string, current?: string}} [opties]
 */
export function filterScaleOptions(options, { system = schaalSysteem(), current } = {}) {
  const metrisch = system !== 'imperial';
  const imperiaal = system !== 'metric';
  return options.filter((o) => o.value === current
    || (isImperialScalePreset(o.value) ? imperiaal : metrisch));
}

/**
 * Options for a scale dropdown (#972): the given metric ratios, then every
 * imperial preset in inch/foot notation. Every place that offers a list of
 * standard scales (scale regions, viewports, the properties panel, the
 * calibration dialog) uses this, so the imperial presets are not hidden in
 * one dialog. The unit-system preference filters the list (#996).
 * @param {string[]} [metric]  metric ratios in the order the list shows them
 * @param {{system?: string, current?: string}} [opties]  see filterScaleOptions
 * @returns {{value: string, label: string}[]}
 */
export function scaleSelectOptions(metric = METRIC_SCALE_PRESETS, opties = {}) {
  return filterScaleOptions([
    ...metric.map(ratio => ({ value: ratio, label: ratio })),
    ...IMPERIAL_SCALE_PRESETS.map(preset => ({ value: preset.ratio, label: preset.label })),
  ], opties);
}

// Papierinches per voet als breuk ("1/8", "1 1/2", "3"), tot op 1/64; null
// als het geen nette breuk is.
function inchBreuk(inches) {
  const zestigsten = Math.round(inches * 64);
  if (zestigsten <= 0 || Math.abs(zestigsten - inches * 64) > 1e-6) return null;
  const heel = Math.floor(zestigsten / 64);
  let teller = zestigsten % 64;
  let noemer = 64;
  while (teller > 0 && teller % 2 === 0) { teller /= 2; noemer /= 2; }
  if (teller === 0) return String(heel);
  return heel > 0 ? `${heel} ${teller}/${noemer}` : `${teller}/${noemer}`;
}

/** De noemer N van "1:N" (ook "1:96.5" of het getal 96), of null. */
function noemerVan(ratio) {
  if (typeof ratio === 'number') return ratio > 0 && Number.isFinite(ratio) ? ratio : null;
  const m = /^\s*1\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio ?? ''));
  const n = m ? parseFloat(m[1]) : NaN;
  return n > 0 ? n : null;
}

/**
 * Een schaal zoals de gebruiker hem leest (#1000): een imperiale schaal (unit
 * ft of in) in papierinch/voet-notatie, `1/8" = 1'-0" (1:96)`; een metrische
 * schaal als `1:100`. Opgeslagen schalen blijven "1:N" (eenheidloos); dit is
 * alleen weergave. Eén functie voor elke plek die een schaal toont.
 * @param {string|number} ratio  "1:96" of de noemer 96
 * @param {string} [unit]        mm | cm | m | in | ft
 * @param {{withRatio?: boolean}} [opties]  withRatio: "(1:96)" erachter (standaard ja)
 * @returns {string}  '' zonder schaal
 */
export function scaleDisplayLabel(ratio, unit, { withRatio = true } = {}) {
  const n = noemerVan(ratio);
  if (n == null) return ratio == null || ratio === 0 ? '' : String(ratio);
  const rauw = typeof ratio === 'string' ? ratio.trim().replace(/\s+/g, '') : `1:${n}`;
  if (unit !== 'ft' && unit !== 'in') return rauw;
  const getal = Number(n.toPrecision(6));
  const verhouding = `1:${getal}`;
  const preset = IMPERIAL_SCALE_PRESETS.find((p) => p.ratio === verhouding);
  let notatie = preset ? preset.label.replace(/\s*\(1:\d+\)$/, '') : null;
  if (!notatie) {
    const breuk = inchBreuk(12 / getal);
    if (breuk) notatie = `${breuk}" = 1'-0"`;
    else if (Number.isInteger(getal / 12)) notatie = `1" = ${getal / 12}'-0"`;
  }
  if (!notatie) return verhouding;
  return withRatio ? `${notatie} (${verhouding})` : notatie;
}
