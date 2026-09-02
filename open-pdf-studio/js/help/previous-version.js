// "Vorige versie installeren": zoekt de nieuwste gepubliceerde release die
// OUDER is dan de draaiende versie, zodat een gebruiker na een tegenvallende
// update in één klik terug kan. De download loopt via de browser (de
// installer vraagt zelf om bevestiging/UAC); de app voert niets stil uit.

const RELEASES_API = 'https://api.github.com/repos/OpenAEC-Foundation/open-pdf-studio/releases?per_page=30';

// "1.93.1" of "v1.93.1" → [1, 93, 1]; null bij alles wat geen kale
// major.minor.patch is (nightly's, pre-releases met suffix, enz.).
export function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Kies uit de release-lijst (GitHub-API-vorm) de nieuwste versie < huidig.
// Concepten, pre-releases en niet-semver-tags (nightly) tellen niet mee.
export function findPreviousRelease(releases, currentVersion) {
  const huidig = parseVersion(currentVersion);
  if (!huidig || !Array.isArray(releases)) return null;
  let beste = null;
  let besteV = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const v = parseVersion(r.tag_name);
    if (!v || compareVersions(v, huidig) >= 0) continue;
    if (!besteV || compareVersions(v, besteV) > 0) {
      beste = r;
      besteV = v;
    }
  }
  return beste;
}

// Platform-relevante downloads uit de assets van een release.
export function pickAssets(release) {
  const assets = release?.assets || [];
  const vind = (test) => assets.find((a) => test(a.name || ''))?.browser_download_url || null;
  return {
    winUser: vind((n) => /user-setup\.exe$/i.test(n)),
    winSystem: vind((n) => /x64-setup\.exe$/i.test(n) && !/user/i.test(n)),
    dmg: vind((n) => /\.dmg$/i.test(n)),
    pageUrl: release?.html_url || null,
  };
}

// Kies per platform de beste download-URL. Windows krijgt de
// gebruikersinstaller (geen beheerdersrechten nodig; wie systeembreed wil,
// vindt alles op de release-pagina die als terugval dient).
export function pickDownloadUrl(assets, userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('mac')) return assets.dmg || assets.pageUrl;
  if (ua.includes('linux')) return assets.pageUrl;
  return assets.winUser || assets.winSystem || assets.pageUrl;
}

// Knopactie: vorige versie opzoeken en de download direct in de browser
// openen — bewust GEEN dialoog (gebruikerswens); de browser-download en de
// installer zelf zijn de bevestigingsmomenten. Alleen bij "niets gevonden"
// of een fout komt een korte systeemmelding.
export async function installPreviousVersion() {
  const { openExternal } = await import('../core/platform.js');
  const i18next = (await import('i18next')).default;
  try {
    const vorige = await fetchPreviousRelease(window.__APP_VERSION__ || '0.0.0');
    if (!vorige) {
      window.__TAURI__?.dialog?.message?.(
        i18next.t('dialogs:previousVersion.notFound'),
        { title: i18next.t('ribbon:help.previousVersion'), kind: 'info' });
      return;
    }
    const url = pickDownloadUrl(vorige.assets, navigator.userAgent);
    console.log('[vorige-versie] gekozen:', vorige.version, url);
    if (url) await openExternal(url);
  } catch (e) {
    console.warn('[vorige-versie] mislukt:', e);
    window.__TAURI__?.dialog?.message?.(
      i18next.t('dialogs:previousVersion.error'),
      { title: i18next.t('ribbon:help.previousVersion'), kind: 'error' });
  }
}

// Haalt de vorige release op. Retourneert { version, assets } of null als er
// geen oudere gepubliceerde versie is. Gooit bij netwerk-/API-fouten.
export async function fetchPreviousRelease(currentVersion) {
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const releases = await res.json();
  const release = findPreviousRelease(releases, currentVersion);
  if (!release) return null;
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    assets: pickAssets(release),
  };
}
