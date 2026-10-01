// Herkent een tekststempel van de app bij het inlezen (zie stempel-tekst.test.mjs).
//
// De saver tekent een tekststempel als vectortekst zonder beeld en schrijft de
// tekst in /OPS_StampText (oudere bestanden alleen de naam in /OPS_StampName).
// Komt het enige beeld dan uit een uitsnede van de gerenderde pagina, dan is
// die uitsnede geen bron maar een kopie van de weergave: de stempel wordt weer
// een tekststempel.

import { BUILT_IN_STAMPS } from '../../annotations/stamp-defaults.js';

/**
 * @param {{stampName?: string, opsStampText?: string, beeldBron?: string|null}} gegevens
 *   beeldBron: 'pdf' voor een ingebed beeld, 'render' voor een uitsnede, null zonder beeld
 * @returns {{stampText: string}|null}  null: geen eigen tekststempel, laat het beeld staan
 */
export function eigenTekststempel({ stampName, opsStampText, beeldBron } = {}) {
  if (!stampName) return null;
  if (beeldBron && beeldBron !== 'render') return null;
  if (opsStampText) return { stampText: opsStampText };
  const ingebouwd = BUILT_IN_STAMPS.find((s) => s.name === stampName);
  return ingebouwd ? { stampText: ingebouwd.text } : null;
}

/**
 * De kleur van een teruggezette tekststempel: /C uit het bestand (de saver
 * schrijft daar de stempelkleur), anders die van de ingebouwde stempel.
 */
export function tekststempelKleur({ cKleur, stampName } = {}) {
  return cKleur || BUILT_IN_STAMPS.find((s) => s.name === stampName)?.color || '#ef4444';
}
