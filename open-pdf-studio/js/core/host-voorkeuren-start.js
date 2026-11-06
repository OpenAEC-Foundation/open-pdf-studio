// Taal en thema van de OpenAEC SuperCloud toepassen (#977).
//
// Alleen de gehoste bouw roept dit aan, na loadPreferences() in main.js, zodat
// de voorkeuren van de host winnen van wat de (geheugen)opslag van het frame
// gaf. De regels staan in core/host-voorkeuren.js.

import { LANGUAGES } from '../i18n/config.js';
import { state } from './state.js';
import { applyPreferences } from './preferences.js';
import { volgHostVoorkeuren } from './host-voorkeuren.js';

/** @returns {() => void} stopt het volgen */
export function startHostVoorkeuren(venster = window) {
  try {
    return volgHostVoorkeuren({
      venster,
      talen: LANGUAGES.map((l) => l.code).filter((c) => c !== 'auto'),
      voorkeuren: () => state.preferences,
      pasToe: applyPreferences,
    });
  } catch (e) {
    console.warn('[site] taal en thema van de host niet gevolgd:', e);
    return () => {};
  }
}
