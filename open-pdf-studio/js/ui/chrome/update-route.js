// Waar komt een update vandaan? Los van app-imports (state, tabs, Tauri),
// zodat de regel te testen is.

/**
 * - 'beheerd'   beheerde modus (OPENAEC_BEHEERD=1): geen controle, alleen
 *               de melding dat de omgeving de versie regelt;
 * - 'draagbaar' draagbare kopie (#881): de versie van GitHub, alleen melden
 *               (de updater zou de geïnstalleerde kopie bijwerken);
 * - 'eigen'     de updater van de app zelf.
 *
 * De app werkt zichzelf bij; een ander programma neemt dat nooit over.
 */
export function updateRoute({ beheerd = false, draagbaar = false } = {}) {
  if (beheerd) return 'beheerd';
  if (draagbaar) return 'draagbaar';
  return 'eigen';
}
