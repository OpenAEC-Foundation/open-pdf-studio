// `window.__OPDS_APP__` neerzetten in de werkplek (#977), lui: de MCP-laag
// (core/werkplek-app-omgeving.js met de toollijst) is een eigen chunk die
// pas bij de eerste aanroep laadt. Vrij van app-imports, zodat main.js hem
// vroeg kan aanroepen en de tests hem zonder DOM kunnen draaien.

/**
 * Een `__OPDS_APP__` die de echte pas bij de eerste aanroep maakt.
 * @param {() => Promise<{ tools: Function, definitions: Function, run: Function }>} laad
 */
export function maakLuiApp(laad) {
  let app = null;
  const echt = () => {
    if (!app) {
      app = Promise.resolve().then(laad);
      // Mislukt het laden, dan probeert de volgende aanroep het opnieuw.
      app.catch(() => { app = null; });
    }
    return app;
  };
  return Object.freeze({
    tools: async () => (await echt()).tools(),
    definitions: async () => (await echt()).definitions(),
    run: async (naam, argumenten) => (await echt()).run(naam, argumenten),
  });
}

const standaardLaad = () => import('./werkplek-app-omgeving.js').then((m) => m.maakApp());

/**
 * Zet `venster.__OPDS_APP__` neer (een die er al staat, blijft). Geeft het
 * object, en meldt het met het event `opds-app-klaar`.
 */
export function installeerWerkplekApp(venster = globalThis.window, laad = standaardLaad) {
  if (!venster) return null;
  if (venster.__OPDS_APP__) return venster.__OPDS_APP__;
  const app = maakLuiApp(laad);
  Object.defineProperty(venster, '__OPDS_APP__', { value: app, configurable: false, enumerable: false, writable: false });
  try {
    venster.dispatchEvent?.(new Event('opds-app-klaar'));
  } catch { /* geen Event in deze omgeving */ }
  return app;
}
