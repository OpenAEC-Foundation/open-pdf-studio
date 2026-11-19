// Eén schakelaar voor het eenhedenstelsel (#1158).
//
// De voorkeur scaleUnitSystem ("Eenheden": Metrisch / Imperiaal / Metrisch met
// imperiale schalen in de lijsten) stuurde alleen de schaallijsten en de
// papiermaat. Wie op "Imperiaal" zette, mat daarna nog steeds in millimeters.
// Hier staat de regel die de standaarden uit die ene instelling afleidt, zodat
// nieuwe kalibraties, schaalvensters, papiermaten en metingen zonder schaal
// hem allemaal op dezelfde manier volgen.
//
// Wat de instelling NIET doet: een bestaand document of een opgeslagen schaal
// veranderen. Alleen standaarden en weergave volgen hem.
//
// Puur: geen app-staat. De bron van de voorkeur is die van scale-presets.js
// (stelSchaalSysteemBronIn, gezet in main.js); tests geven het stelsel mee.

import { schaalSysteem, SCALE_UNIT_SYSTEMS } from './scale-presets.js';

/** Punten per inch op papier (PDF 32000-1, 8.3.2.3: 1 punt = 1/72 inch). */
const PUNTEN_PER_INCH = 72;

/** Een geldig stelsel ('both' als de waarde onbruikbaar is). */
export function normaliseerStelsel(stelsel) {
  return SCALE_UNIT_SYSTEMS.includes(stelsel) ? stelsel : 'both';
}

/** Meet de gebruiker in voet en inch? Alleen bij 'imperial'. */
export function isImperiaalStelsel(stelsel = schaalSysteem()) {
  return normaliseerStelsel(stelsel) === 'imperial';
}

/**
 * De standaarden die uit het stelsel volgen.
 *  - lengteEenheid: de eenheid van een nieuwe kalibratie of schaal (ft / mm);
 *  - schaal: de standaardschaal waarmee een schaalvenster opent;
 *  - papierEenheid: de eenheid voor papiermaten (in / mm);
 *  - zonderSchaal: waarmee een meting rekent op een document zonder schaal.
 *    Imperiaal: de maat op papier in inches (72 punten per inch). Metrisch
 *    blijft zoals het was: punten, geteld als millimeters.
 * @param {string} [stelsel]  'metric' | 'imperial' | 'both'; standaard de voorkeur
 */
export function standaardenVoorStelsel(stelsel = schaalSysteem()) {
  if (isImperiaalStelsel(stelsel)) {
    return {
      imperiaal: true,
      lengteEenheid: 'ft',
      schaal: '1:48',
      papierEenheid: 'in',
      zonderSchaal: { pixelsPerUnit: PUNTEN_PER_INCH, unit: 'in' },
    };
  }
  return {
    imperiaal: false,
    lengteEenheid: 'mm',
    schaal: '1:100',
    papierEenheid: 'mm',
    zonderSchaal: { pixelsPerUnit: 1, unit: 'mm' },
  };
}

/**
 * Eenmalige overgang voor opgeslagen voorkeuren: de oude standaard 'both'
 * (metrisch met imperiale schalen in de lijsten en inches achter de
 * papiermaat) wordt 'metric'. Een bewuste keuze voor imperiaal blijft staan,
 * en wie daarna zelf 'both' kiest houdt dat: het vlaggetje unitsDefaultMetric
 * zorgt dat dit maar een keer gebeurt. Wijzigt en geeft `opgeslagen` terug.
 * @param {Record<string, unknown>} opgeslagen  de geladen voorkeuren
 */
export function migreerStelselStandaard(opgeslagen) {
  if (!opgeslagen || opgeslagen.unitsDefaultMetric === true) return opgeslagen;
  if (opgeslagen.scaleUnitSystem === undefined || opgeslagen.scaleUnitSystem === 'both') {
    opgeslagen.scaleUnitSystem = 'metric';
  }
  // Papiermaten: de oude standaard (punten) wordt millimeters.
  if (opgeslagen.paperSizeUnit === undefined || opgeslagen.paperSizeUnit === 'pt') {
    opgeslagen.paperSizeUnit = 'mm';
  }
  opgeslagen.unitsDefaultMetric = true;
  return opgeslagen;
}

/** De eenheid van een nieuwe kalibratie of schaal: 'ft' of 'mm'. */
export function standaardLengteEenheid(stelsel = schaalSysteem()) {
  return standaardenVoorStelsel(stelsel).lengteEenheid;
}

/**
 * De voorkeuren die meegaan als de gebruiker het stelsel omzet: alleen wat
 * verandert. Naar imperiaal: lengtes als voet-inch-breuk en papiermaten in
 * inches. Naar metrisch: papiermaten uit inches terug naar millimeters. De
 * gebruiker kan elk van die details daarna zelf weer anders zetten.
 * @param {string} nieuw  het gekozen stelsel
 * @param {{imperialLengthFormat?: string, paperSizeUnit?: string}} [huidig]
 * @returns {Record<string, string>}
 */
export function voorkeurenBijStelsel(nieuw, huidig = {}) {
  const stelsel = normaliseerStelsel(nieuw);
  const patch = {};
  if (stelsel === 'imperial') {
    if (huidig.imperialLengthFormat !== 'feetInch') patch.imperialLengthFormat = 'feetInch';
    if (huidig.paperSizeUnit !== 'in') patch.paperSizeUnit = 'in';
  } else if (stelsel === 'metric') {
    if (huidig.paperSizeUnit === 'in') patch.paperSizeUnit = 'mm';
  }
  return patch;
}

/**
 * De handmatige schaal uit de gereedschapsvoorkeur (eenheden per punt), voor
 * een document zonder schaalbron: { scale, unit } of null.
 *
 * In het imperiale stelsel telt de onaangeroerde standaard (1 per punt, in
 * mm) niet als handmatige schaal: die zou punten als millimeters tonen. De
 * meting valt dan terug op de maat op papier in inches. Een schaal of eenheid
 * die de gebruiker zelf heeft gezet blijft gelden.
 * @param {Record<string, unknown> | null | undefined} prefs
 * @param {'measureDist'|'measurePerim'|'measureArea'} soort
 * @param {string} [stelsel]
 */
export function handmatigeSchaal(prefs, soort, stelsel = schaalSysteem()) {
  const scale = Number(prefs?.[`${soort}DimScale`]);
  if (!(scale > 0)) return null;
  const unit = typeof prefs?.[`${soort}DimUnit`] === 'string' && prefs[`${soort}DimUnit`]
    ? prefs[`${soort}DimUnit`] : 'mm';
  if (isImperiaalStelsel(stelsel) && scale === 1 && unit === 'mm') return null;
  return { scale, unit };
}

/**
 * Meet een nieuwe meting op dit document zonder echte schaal? Dan toont hij
 * de maat op papier (of de handmatige voorkeursschaal) en hoort de gebruiker
 * dat te horen, met een verwijzing naar Kalibreren.
 * @param {{heeftSchaalbron: boolean, legacySchaal?: {pixelsPerUnit?: number} | null}} toestand
 */
export function meetZonderSchaal({ heeftSchaalbron, legacySchaal = null }) {
  if (heeftSchaalbron) return false;
  return !(legacySchaal && legacySchaal.pixelsPerUnit > 0);
}
