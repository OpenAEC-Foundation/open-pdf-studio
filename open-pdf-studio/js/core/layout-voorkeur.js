// Eén indelingsvoorkeur (#932) bijwerken en de voorkeuren bewaren, zodat een
// ingeklapt paneel of een versleepte breedte na een herstart terugkomt.
//
// Stores importeren dit in plaats van core/preferences.js zelf: dat laatste
// trekt bridge.js en daarmee de stores mee (kringimport). Het bewaren laadt
// preferences.js daarom pas bij de aanroep.

import { state } from './state.js';

let wachtrij = null;

export function bewaarLayoutVoorkeur(sleutel, waarde) {
  const voorkeuren = state.preferences;
  if (!voorkeuren) return;
  if (JSON.stringify(voorkeuren[sleutel]) === JSON.stringify(waarde)) return;
  voorkeuren[sleutel] = waarde;
  // Meerdere wijzigingen in dezelfde beurt (paneel én tab) één keer bewaren.
  if (wachtrij) return;
  wachtrij = Promise.resolve().then(() => import('./preferences.js')).then((m) => {
    wachtrij = null;
    m.savePreferences();
  }).catch(() => { wachtrij = null; });
}
