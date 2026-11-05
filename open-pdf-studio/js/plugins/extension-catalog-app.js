// De extensiecatalogus (#969) gekoppeld aan de app: downloads lopen via Rust
// (src-tauri/src/extensie_catalogus.rs: alleen https, met groottegrens en
// SHA-256-controle), installeren via de bestaande transactionele installatie
// (installPluginFromFile), en catalogi en bronnen staan in de voorkeuren
// (`extensionCatalogs`, `extensionSources`). De logica zelf staat zuiver in
// extension-catalog.js.

import { state } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { externeDienstenAan } from '../core/webfuncties.js';
import { maakCatalogusDienst } from './extension-catalog.js';

export {
  STANDAARD_CATALOGUS, CATALOGUS_PAGINA, catalogiUit, bronnenUit, bronSoort, isNieuwer,
} from './extension-catalog.js';

// Catalogus, GitHub en pakketten staan op andere hosts: als gast nooit.
function magOphalen() {
  if (!externeDienstenAan()) throw new Error('The extension catalogue is not available here');
}

export const catalogusDienst = maakCatalogusDienst({
  haalTekst: (url) => { magOphalen(); return invoke('extensie_tekst_ophalen', { url }); },
  haalPakket: ({ url, sha256, verwachtId }) => { magOphalen(); return invoke('extensie_pakket_ophalen', { url, sha256, verwachtId }); },
  installeer: async (pad) => {
    const { installPluginFromFile } = await import('./plugin-manager.js');
    return installPluginFromFile(pad);
  },
  ruimOp: (pad) => invoke('extensie_pakket_opruimen', { pad }),
  voorkeuren: () => state.preferences || {},
  bewaar: async (wijziging) => {
    Object.assign(state.preferences, wijziging);
    const { savePreferences } = await import('../core/preferences.js');
    savePreferences();
  },
});
