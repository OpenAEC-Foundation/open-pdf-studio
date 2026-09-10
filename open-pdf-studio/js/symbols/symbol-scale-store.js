// De gekozen symboolschaal, met een reactief signaal voor het palet en
// opslag in de voorkeuren zodat hij een herstart overleeft (issue #357).
//
// De pure rekenkant staat in symbol-scale.js; deze module doet alleen de
// toestand. Zo blijft het rekenwerk node-testbaar zonder SolidJS.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { normaliseerSchaal, STANDAARD_SCHAAL } from './symbol-scale.js';

const [schaal, setSchaalSignaal] = createSignal(
  normaliseerSchaal(state?.preferences?.symbolScale ?? STANDAARD_SCHAAL),
);

/** Reactief signaal voor de UI. */
export { schaal as symboolSchaal };

/**
 * De factor die op dit moment geldt. Niet-reactieve lezers (de plaatsingscode)
 * gebruiken deze; hij leest bewust ook de voorkeuren, zodat een schaal die bij
 * het opstarten uit de voorkeuren komt meteen klopt.
 */
export function huidigeSymboolSchaal() {
  const uitVoorkeur = state?.preferences?.symbolScale;
  const s = schaal();
  if (uitVoorkeur !== undefined && normaliseerSchaal(uitVoorkeur) !== s) {
    return normaliseerSchaal(uitVoorkeur);
  }
  return s;
}

/** Zet de schaal voor VOLGENDE plaatsingen. Raakt niets wat al getekend is. */
export function setSymboolSchaal(waarde) {
  const f = normaliseerSchaal(waarde);
  setSchaalSignaal(f);
  try {
    if (state && state.preferences) {
      state.preferences.symbolScale = f;
      savePreferences();
    }
  } catch {
    // Voorkeuren kunnen buiten Tauri ontbreken; de schaal geldt dan alleen
    // voor deze sessie.
  }
  return f;
}
