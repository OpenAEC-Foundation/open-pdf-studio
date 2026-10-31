/**
 * Wires the What's New dialog into app startup and the Help menu.
 *
 *  - `checkForNewReleaseOnStartup()` is called once after preferences load.
 *    If the running app version is newer than `state.preferences.lastSeenReleaseVersion`
 *    we fetch GitHub releases (cached for 1h) and pop the dialog with everything
 *    newer than the last-seen version.
 *
 *  - `openWhatsNewManual()` is the Help-menu / About entry — always opens
 *    the dialog with everything we can fetch, regardless of last-seen.
 *
 * Network errors are swallowed so app startup never fails because of this.
 */

import { getAppVersion } from '../core/platform.js';
import { state } from '../core/state.js';
import { fetchReleases, compareVersions } from './release-notes.js';
import { externeDienstenAan, meldAlleenBureaublad } from '../core/webfuncties.js';
import { isBeheerd } from '../core/openaec-omgeving.js';
import { openWhatsNew, setReleases, setLoading, setError } from '../solid/stores/whatsNewStore.js';
import i18next from 'i18next';

function pickLang() {
  const raw = (i18next.language || 'en').toLowerCase();
  return raw.startsWith('nl') ? 'nl' : 'en';
}

function isPrerelease(version) {
  return /[-+]/.test(String(version || ''));
}

export async function checkForNewReleaseOnStartup() {
  // Beheerde modus (#863): geen updatemelding en geen netwerk bij de start.
  if (isBeheerd()) return;
  // De release-notes staan op GitHub; als gast geen verzoek naar een andere
  // host (#548).
  if (!externeDienstenAan()) return;
  let currentVersion;
  try {
    currentVersion = await getAppVersion();
  } catch {
    return;
  }
  if (!currentVersion) return;

  const lastSeen = state.preferences.lastSeenReleaseVersion || '';

  // First run after install: don't nag — silently mark current as seen.
  if (!lastSeen) {
    state.preferences.lastSeenReleaseVersion = currentVersion;
    try {
      const { savePreferences } = await import('../core/preferences.js');
      savePreferences();
    } catch { /* ignore */ }
    return;
  }

  if (compareVersions(currentVersion, lastSeen) <= 0) return;

  let releases = [];
  try {
    releases = await fetchReleases(lastSeen, { currentIsPrerelease: isPrerelease(currentVersion) });
  } catch {
    return;
  }
  if (!Array.isArray(releases) || releases.length === 0) return;

  setReleases(releases);
  setError(null);
  setLoading(false);
  openWhatsNew({ activeLang: pickLang() });
}

export async function openWhatsNewManual() {
  if (!externeDienstenAan()) {
    await meldAlleenBureaublad(i18next.t('appMenu:whatsNew.title'));
    return;
  }
  setLoading(true);
  setError(null);
  setReleases([]);
  openWhatsNew({ activeLang: pickLang(), loading: true });

  let currentVersion = '';
  try { currentVersion = await getAppVersion(); } catch { /* ignore */ }

  try {
    const releases = await fetchReleases(null, {
      currentIsPrerelease: isPrerelease(currentVersion)
    });
    setReleases(releases);
    setLoading(false);
    if (releases.length === 0) setError('empty');
  } catch {
    setLoading(false);
    setError('network');
  }
}
