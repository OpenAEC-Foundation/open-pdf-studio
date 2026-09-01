// Actuele appversie voor de titelbalk en vensters.
//
// In een release-build is het Vite-define __APP_VERSION__ (package.json op
// buildmoment) per definitie juist. In de DEV-build was het een stempel van
// het moment dat Vite startte: na een versie-bump toonde de titelbalk de
// oude versie tot iemand Vite herstartte. Daarom leest dev bij het opstarten
// package.json vers van de dev-server en werkt het signaal (en daarmee elke
// titel die erop leunt) live bij.
import { createSignal } from 'solid-js';

const bouwVersie = typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '';
const [appVersion, setAppVersion] = createSignal(bouwVersie);
export { appVersion };

if (typeof window !== 'undefined') window.__APP_VERSION__ = bouwVersie;

export async function initDevVersionSync() {
  if (!import.meta.env.DEV) return;
  try {
    const res = await fetch('/package.json', { cache: 'no-store' });
    if (!res.ok) return;
    const pkg = await res.json();
    if (pkg?.version && pkg.version !== appVersion()) {
      setAppVersion(pkg.version);
      window.__APP_VERSION__ = pkg.version;
      // Venstertitel meteen bijtrekken (documenttabs zetten die imperatief).
      const { updateWindowTitle } = await import('../ui/chrome/tabs.js');
      updateWindowTitle();
    }
  } catch {
    // Geen dev-server of geen package.json bereikbaar — stil laten.
  }
}
