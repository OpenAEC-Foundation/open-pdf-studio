// Vrije hand (#385) in het eigenschappenpaneel: wat het paneel toont en wat
// een wijziging in het model schrijft. Pure module (onder node te testen).

import { INK_STANDAARD, klemGladheid, klemMinBreedte } from './pressure-ink.js';

/** De paneelwaarden van een streek (een oude streek: gladheid 0, druk aan). */
export function inktPaneelWaarden(ann) {
  return {
    inkPressure: ann?.inkPressure !== false,
    inkHasPressure: Array.isArray(ann?.pressures) && ann.pressures.length > 0,
    inkMinWidth: klemMinBreedte(ann?.inkMinWidth ?? INK_STANDAARD.minBreedtePct),
    inkSmoothing: klemGladheid(ann?.inkSmoothing ?? 0),
  };
}

/** Wat een wijziging in het paneel in het model zet. */
export function inktPropWaarde(key, value) {
  switch (key) {
    // Uit is false; aan laat de sleutel weg (standaard).
    case 'inkPressure': return { inkPressure: value === true || value === 'true' ? undefined : false };
    case 'inkMinWidth': return { inkMinWidth: klemMinBreedte(value) };
    case 'inkSmoothing': return { inkSmoothing: klemGladheid(value) };
    default: return {};
  }
}
