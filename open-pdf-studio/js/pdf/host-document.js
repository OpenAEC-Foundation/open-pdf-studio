// Een document van de gastsite openen (#546).
//
// Het opslagcontract zelf staat in core/platform.js; hier zit alleen de stap
// naar een tabblad. Een document van de site opent als elk ander document:
// een tabblad met als pad `opds-host://<id>/<naam>`, zodat Opslaan (Ctrl+S)
// via writeBinaryFile() teruggaat naar de site.
//
// De site geeft een document op twee manieren mee:
//  - bij de start: `window.__OPDS_HOST__.document = '<id>'`
//  - later (een site die zelf niet herlaadt):
//      window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id } }))
//
// In de werkplek (#704) kan de site een document alleen-lezen geven (dan is
// het hier alleen-lezen, zie isHostAlleenLezen), hoort de site welk document
// open staat (`geopend`) en krijgt hij een mislukte open als melding.
//
// Een oudere versie (#712, uit de versielijst, of `detail: { id, versie }`)
// opent in een eigen tabblad, alleen-lezen, met "Versie 3 van 5 –
// alleen-lezen" in het tabblad en de titel (doc.hostVersie). Opslaan staat
// uit; "Opslaan als" geeft een download.

import i18next from '../i18n/config.js';
import { gastObject } from '../core/gehost.js';
import { hostOpslag, openHostBestand, meldHostGeopend, meldBijHost } from '../core/platform.js';
import { state } from '../core/state.js';
import { createTab, updateWindowTitle } from '../ui/chrome/tabs.js';
import { loadPDFIfNeeded } from './loader.js';
import { showMessage } from '../bridge.js';

export const OPEN_EVENT = 'opds:open-document';

const geheelGetal = (v) => (typeof v === 'number' && Number.isInteger(v) ? v
  : (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : null));

/**
 * Open document `id` van de site in een tabblad.
 * @param {object} [opties]
 * @param {number|string} [opties.versie] een oudere versie (#712): alleen-lezen
 * @param {number} [opties.totaal] het aantal versies, voor "Versie 3 van 5"
 */
export async function openHostDocument(id, { versie = null, totaal = null } = {}) {
  if (id === undefined || id === null || id === '') return false;
  const metVersie = versie !== null && versie !== undefined && versie !== '';
  try {
    const opened = metVersie ? await openHostBestand(id, versie) : await openHostBestand(id);
    const { pad, naam, data, alleenLezen } = opened;
    const { index } = createTab(pad);
    // Het document zoals de store het geeft (niet het kale object van
    // createTab), en vóór het laden, zodat bewerken geen moment kan.
    const doc = state.documents[index];
    if (alleenLezen && doc) doc.hostAlleenLezen = true;
    if (metVersie && doc) {
      doc.hostVersie = {
        versie: geheelGetal(opened.versie) ?? geheelGetal(versie) ?? String(versie),
        totaal: geheelGetal(totaal),
      };
    }
    await loadPDFIfNeeded(pad, index, data);
    // Gesloten tijdens het laden (of een wachtwoord geannuleerd): niets te melden.
    if (!doc || !state.documents.includes(doc)) return false;
    if (doc.pdfDoc) {
      if (metVersie) {
        // De titel met "Versie 3 van 5 – alleen-lezen".
        updateWindowTitle();
      } else {
        void meldHostGeopend(id);
      }
      return true;
    }
    // Bytes die geen geldige PDF zijn: de app toonde zijn eigen melding al
    // (loader.js); de site hoort het ook, net als bij een mislukte open (#707).
    void meldBijHost(i18next.t('hostInvalidPdf', { name: naam }), 'fout');
    return false;
  } catch (e) {
    // Afgehandeld: de gebruiker en de site horen het hieronder.
    console.warn('[gast] document van de site niet geopend:', e);
    // De brug naar de gastpagina (core/host-brug.js) geeft een eigen, vertaalde
    // melding mee, of heeft het geen-contact al gemeld.
    if (!e?.gemeld) {
      const melding = typeof e?.gebruikersMelding === 'string' && e.gebruikersMelding
        ? e.gebruikersMelding
        : i18next.t('failedToLoadPdf', { error: e?.message || String(e) });
      showMessage(melding);
      // Ook in de statusbalk van de site, als die dat kent.
      void meldBijHost(melding, 'fout');
    }
    return false;
  }
}

let gestart = false;

/**
 * Bij de start: het document dat de site meegeeft openen en luisteren naar
 * latere verzoeken. Zonder opslagcontract gebeurt er niets.
 * @returns {Promise<boolean>} of er een document van de site openging
 */
export async function startMetGastsite() {
  if (!hostOpslag()) return false;
  // Eén keer: het contract kan ook pas na de start komen (openaec-host-ready,
  // core/site-host.js), en dan roept ook die koppeling dit aan.
  if (gestart) return false;
  gestart = true;
  window.addEventListener(OPEN_EVENT, (e) => {
    const detail = e?.detail || {};
    openHostDocument(detail.id, { versie: detail.versie ?? null, totaal: detail.totaal ?? null });
  });
  return openHostDocument(gastObject()?.document);
}
