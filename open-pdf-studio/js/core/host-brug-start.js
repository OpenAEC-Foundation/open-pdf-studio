// Het hostcontract van de werkplek aan de app koppelen (#694, #977).
//
// Alleen de gehoste bouw roept dit aan, als eerste stap van de opstart
// (main.js), zodat `window.__OPDS_HOST__` er staat vóór iets het opslagcontract
// leest. Volgorde (core/site-host.js, koppelHost):
//  1. een `__OPDS_HOST__` van de gastpagina zelf: niets te doen;
//  2. een `window.openaecHost` van de SuperCloud: dat wordt het opslagcontract;
//  3. `#ouder=…` in een iframe: de brug over postMessage (core/host-brug.js),
//     en `window.openaecHost` in de vorm van het contract erbij;
//  4. anders wachten op `openaec-host-ready`; komt het contract dan nog, dan
//     opent de app het document van de host.
// In elk geval staat `window.__OPDS_APP__` er (core/werkplek-app-start.js): de
// tools voor de assistent van de SuperCloud, ook over de brug (app.*).

import i18next from '../i18n/config.js';
import { showMessage } from '../solid/stores/dialogStore.js';
import { installeerHostBrug, opslaanMelding } from './host-brug.js';
import { koppelHost } from './site-host.js';
import { installeerWerkplekApp } from './werkplek-app-start.js';

/** @returns {object|null} de brug, of null als er geen brug nodig of toegestaan is */
export function startHostBrug(venster = window) {
  // Per bestand één keer melden dat het niet voor ons vastgezet is (#704).
  const nietVastGemeld = new Set();
  // Een conflict of een melding van de gastpagina na het opslaan: de
  // gebruiker hoort waar zijn versie staat; er gaat niets verloren.
  const bijOpslaan = (uitkomst) => {
    const tekst = opslaanMelding(uitkomst, (s, o) => i18next.t(s, o), nietVastGemeld);
    if (tekst) showMessage(tekst);
  };
  try {
    installeerWerkplekApp(venster);
  } catch (e) {
    console.warn('[werkplek] __OPDS_APP__ niet neergezet:', e);
  }
  try {
    const { brug = null } = koppelHost({
      venster,
      bijOpslaan,
      installeerBrug: () => installeerHostBrug({
        venster,
        vertaal: (sleutel, opties) => i18next.t(sleutel, opties),
        bijGeenContact: (fout) => {
          console.warn('[brug]', fout?.message);
          showMessage(i18next.t('hostNoContact'));
        },
        bijOpslaan,
        // De gastpagina mag de tools van de assistent vragen (#977).
        app: () => venster.__OPDS_APP__ || null,
      }),
      // Het contract kwam pas na de start: het document van de host openen.
      bijLaat: () => {
        import('../pdf/host-document.js')
          .then((m) => m.startMetGastsite())
          .catch((e) => console.warn('[gast] openen via de site mislukt:', e));
      },
    });
    return brug;
  } catch (e) {
    console.warn('[brug] niet gestart:', e);
    return null;
  }
}
