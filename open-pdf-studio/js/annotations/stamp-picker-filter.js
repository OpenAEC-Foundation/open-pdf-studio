// Wat de stempelkiezer toont (#998): de voorkeur "Ingebouwde stempels
// verbergen" (preferences.hideBuiltInStamps).
//
// Ingebouwd zijn de tekststempels (BUILT_IN_STAMPS: APPROVED, DRAFT, ...) en
// de ingebouwde sjablonen met velden (scope 'builtin' in de
// sjabloonbibliotheek). Eigen stempels zijn alle andere sjablonen: persoonlijk
// (zelf gemaakt, gekopieerd of geïmporteerd) en gedeeld (door collega's
// gemaakt, uit de gedeelde map).
//
// Regel:
// - voorkeur uit                    -> alles tonen;
// - voorkeur aan + eigen stempels   -> alleen de eigen stempels;
// - voorkeur aan, geen eigen        -> toch alles tonen (anders is de kiezer
//                                      leeg), met een hint dat de voorkeur
//                                      aan staat maar er niets eigens is.
//
// Zolang de sjabloonbibliotheek nog laadt (geladen === false) en de voorkeur
// aan staat, is nog niet bekend of er eigen stempels zijn: dan niets tonen,
// zodat de ingebouwde stempels niet eerst even verschijnen en weer
// verdwijnen.
//
// Puur: geen state, geen DOM; de kiezer geeft de voorkeur en de lijsten door.

/** Is een sjabloon van de gebruiker (niet ingebouwd)? */
export function isEigenSjabloon(template) {
  return !!template && template.scope !== 'builtin';
}

/** Heeft de gebruiker minstens één eigen stempel(sjabloon)? */
export function heeftEigenStempels(templates) {
  return (templates || []).some(isEigenSjabloon);
}

/**
 * @param {{ hideBuiltIn?: boolean, builtInStamps?: Array, templates?: Array, geladen?: boolean }} invoer
 * @returns {{ builtInStamps: Array, templates: Array, verborgen: boolean, hintGeenEigen: boolean, wacht: boolean }}
 *   verborgen: de ingebouwde stempels zijn weggelaten;
 *   hintGeenEigen: de voorkeur staat aan maar er zijn geen eigen stempels;
 *   wacht: de voorkeur staat aan en de bibliotheek is nog niet geladen.
 */
export function stempelKiezerInhoud({ hideBuiltIn = false, builtInStamps = [], templates = [], geladen = true } = {}) {
  const alle = { builtInStamps: [...builtInStamps], templates: [...templates] };
  const leeg = { verborgen: false, hintGeenEigen: false, wacht: false };
  if (hideBuiltIn !== true) return { ...alle, ...leeg };
  if (geladen === false) return { builtInStamps: [], templates: [], ...leeg, wacht: true };
  if (!heeftEigenStempels(templates)) return { ...alle, ...leeg, hintGeenEigen: true };
  return {
    builtInStamps: [],
    templates: templates.filter(isEigenSjabloon),
    ...leeg,
    verborgen: true,
  };
}
