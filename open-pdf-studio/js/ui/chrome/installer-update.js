// Bijwerken via de OpenAEC Installer (OpenAEC-Blueprint#33).
//
// Op Windows met de installer op de computer werkt de installer de app bij:
// de versie komt uit zijn statusbestand (plugin `openaec-update`) en
// "Downloaden en installeren" geeft de update aan de installer, die de app
// sluit, stil bijwerkt en weer start. Elders blijft de eigen updater
// (ui/chrome/updater.js).
//
// Deze module is vrij van app-imports (state, tabs, Tauri); updater.js geeft
// de handelingen mee, zodat de regels los te testen zijn.

/** Hoe lang de app na `update_now` wacht tot de installer hem sluit. */
export const WACHT_OP_INSTALLER_MS = 20000;

/**
 * Waar komt de update vandaan?
 * - 'beheerd'   beheerde modus (OPENAEC_BEHEERD=1): geen controle, alleen
 *               de melding dat de omgeving de versie regelt;
 * - 'draagbaar' draagbare kopie (#881): de versie van GitHub, alleen melden
 *               (nooit de installer: die zou de geïnstalleerde kopie
 *               bijwerken en deze sluiten);
 * - 'installer' Windows met de OpenAEC Installer;
 * - 'eigen'     de updater van de app zelf.
 */
export function updateRoute({ beheerd = false, draagbaar = false, platform = '', installerAanwezig = false } = {}) {
  if (beheerd) return 'beheerd';
  if (draagbaar) return 'draagbaar';
  if (platform === 'windows' && installerAanwezig) return 'installer';
  return 'eigen';
}

/**
 * De update uit het statusbestand van de installer, in de vorm die het
 * updatevenster verwacht.
 *
 * `deps`:
 *  - invoke(cmd, args)        Tauri-commando's;
 *  - bestaat(pad)             staat dit bestand er?
 *  - sluitAlleTabs()          sluit elk tabblad (vraagt om op te slaan);
 *                             gooit bij annuleren;
 *  - meldSchoonAfsluiten()    markering voor het crashherstel;
 *  - eigenUpdate()            de update van de eigen updater, of null;
 *  - wacht(ms)                wachten (los te vervangen in tests).
 *
 * `downloadAndInstall` controleert eerst of de installer uit het
 * statusbestand er nog is. Zo niet, dan de eigen updater (niemand blijft
 * zonder update, en er gaan geen tabbladen dicht voor niets). Anders sluit
 * hij de tabbladen en geeft de update aan de installer; die sluit de app,
 * dus de belofte lost niet op en het venster herstart de app niet zelf. Leeft
 * de app daarna nog, dan nam de installer het niet over: een fout in het
 * venster in plaats van een venster dat eeuwig "installeren" toont.
 */
export function maakInstallerUpdate(available, deps) {
  return {
    version: available.latest,
    currentVersion: available.current,
    // Het statusbestand heeft geen release-notes; "Wat is nieuw" toont ze na de update.
    body: '',
    async downloadAndInstall(onEvent) {
      const installer = typeof available.installer === 'string' ? available.installer.trim() : '';
      let aanwezig = false;
      if (installer) {
        try { aanwezig = (await deps.bestaat(installer)) === true; } catch { aanwezig = false; }
      }
      if (!aanwezig) {
        const eigen = await deps.eigenUpdate();
        if (!eigen) throw new Error('The OpenAEC Installer was not found.');
        return eigen.downloadAndInstall(onEvent);
      }
      await deps.sluitAlleTabs();
      await deps.meldSchoonAfsluiten();
      await deps.invoke('plugin:openaec-update|update_now');
      await deps.wacht(WACHT_OP_INSTALLER_MS);
      throw new Error('The OpenAEC Installer did not take over the update.');
    },
  };
}
