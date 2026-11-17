// Hoeveelheden: de oppervlaktekolommen van een staat in één gevraagde
// eenheid (GitHub #1129): acres, hectares, m², ...
//
// De engine rekent elke cel om naar de eenheid van zijn kolom
// (eenheid-omrekening.js); wie een eenheid kiest zet hem in
// `config.format[veld].unit`. Deze helper doet dat voor alle
// oppervlaktevelden tegelijk, zonder de staat zelf te wijzigen: zo geeft
// app_get_takeoff de totalen in acres terug terwijl de staat op het blad
// blijft zoals de gebruiker hem instelde.

import { fieldsForCategories } from './categories.js';
import { eenheidSoort, normaliseerEenheid } from './eenheid-omrekening.js';

/**
 * @param {{categories?: string[], format?: Record<string, object>}|null|undefined} config
 * @param {string|null|undefined} eenheid  een oppervlakte-eenheid ('ac', 'ha', 'm²')
 * @returns de config met die eenheid op elk oppervlakteveld; ongewijzigd
 *   zonder eenheid of als het geen oppervlakte-eenheid is
 */
export function configMetOppervlakteEenheid(config, eenheid) {
  const doel = normaliseerEenheid(eenheid);
  if (!config || eenheidSoort(doel) !== 'area') return config;
  const format = { ...(config.format || {}) };
  for (const f of fieldsForCategories(config.categories || [])) {
    if (f.kind !== 'number' || eenheidSoort(f.unit) !== 'area') continue;
    format[f.key] = { ...(format[f.key] || {}), unit: doel };
  }
  return { ...config, format };
}
