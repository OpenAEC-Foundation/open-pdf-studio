// De dialogen van Opslaan als op de site (#726). De platformlaag
// (core/platform.js) roept ze aan; de logica zelf staat in
// core/host-opslaan-als.js.

import i18next from '../i18n/config.js';
import { openDialog, getDialogs, showMessage } from '../solid/stores/dialogStore.js';
import { foutMelding, opgeslagenMelding } from '../core/host-opslaan-als.js';
import { hideLoading } from '../ui/chrome/dialogs.js';

const t = (sleutel, opties) => i18next.t(sleutel, opties);

// openDialog() opent een naam maar één keer; staat hij al open, dan zou de
// belofte nooit vervullen.
const isOpen = (naam) => getDialogs().some((d) => d.name === naam);

/**
 * Een melding met eigen knoppen. Sluiten (×, Escape) geeft `bijSluiten`.
 * @param {{ title: string, message: string, knoppen: { id: string|null, label: string, primair?: boolean }[], bijSluiten?: string|null }} o
 * @returns {Promise<string|null>} het id van de gekozen knop
 */
export function kiesUitKnoppen({ title, message, knoppen, bijSluiten = null }) {
  if (isOpen('host-keuze')) return Promise.resolve(bijSluiten);
  return new Promise((resolve) => {
    openDialog('host-keuze', { title, message, knoppen, bijSluiten, resolve });
  });
}

export const HOST_OPSLAAN_ALS_UI = {
  /** Naam en map op de site kiezen; null = annuleren, { download: true } = toch downloaden. */
  kiesDoel({ naam }) {
    if (isOpen('host-save-as')) return Promise.resolve(null);
    return new Promise((resolve) => {
      openDialog('host-save-as', { naam, resolve });
    });
  },

  /** De site weigerde: melding, met de keuze om toch te downloaden. */
  bijFout(fout) {
    // Het schrijven is voorbij; de wachtlaag van het opslaan zou de knoppen
    // anders afdekken (de aanroeper verbergt hem daarna toch).
    hideLoading();
    return kiesUitKnoppen({
      title: t('hostSaveAs.notSavedTitle'),
      message: foutMelding(fout, t),
      knoppen: [
        { id: 'download', label: t('hostSaveAs.download'), primair: true },
        { id: null, label: t('close') },
      ],
    });
  },

  /** Een export staat op de site: waar, en onder welke naam. */
  bijOpgeslagen(uitkomst) {
    showMessage(opgeslagenMelding(uitkomst, t));
  },

  /**
   * Na Opslaan als: het nieuwe bestand openen of verder met het origineel.
   * @returns {Promise<'nieuw'|'origineel'>}
   */
  async naOpslaanAls(uitkomst) {
    const keuze = await kiesUitKnoppen({
      title: t('saveAs'),
      message: opgeslagenMelding(uitkomst, t),
      knoppen: [
        { id: 'nieuw', label: t('hostSaveAs.openNew'), primair: true },
        { id: 'origineel', label: t('hostSaveAs.keepOriginal') },
      ],
      bijSluiten: 'origineel',
    });
    return keuze === 'nieuw' ? 'nieuw' : 'origineel';
  },
};
