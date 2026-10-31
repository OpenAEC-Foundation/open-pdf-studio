// De standaard-PDF-app: nagaan of Open PDF Studio het is, en wat er gebeurt
// als de gebruiker op "Als standaard instellen" klikt.
//
// De Rust-kant (`default_pdf_app_status`, src-tauri/src/standaard_app.rs)
// zegt wat bekend is: { isDefault: bool|null, current, canSet, reason }.
// In een Flatpak of Snap is het niet na te gaan en niet te zetten (geen
// xdg-mime, geen toegang tot de koppelingen van het bureaublad); dan toont
// de app uitleg in plaats van stil te falen of bij elke start te vragen.
//
// Puur: invoke en het platform komen als argument binnen, zodat de regels
// zonder Tauri te testen zijn.

const ONBEKEND = Object.freeze({ isDefault: null, current: null, canSet: false, reason: 'unavailable' });

const PAKKET_NAAM = { flatpak: 'Flatpak', snap: 'Snap' };

/** 'windows' | 'mac' | 'linux' uit navigator.platform (of userAgent). */
export function platformUit(tekst) {
  const t = String(tekst || '').toLowerCase();
  if (t.includes('win')) return 'windows';
  if (t.includes('mac')) return 'mac';
  return 'linux';
}

function normaliseer(s) {
  return {
    isDefault: typeof s.isDefault === 'boolean' ? s.isDefault : null,
    current: typeof s.current === 'string' && s.current.trim() ? s.current.trim() : null,
    canSet: s.canSet === true,
    reason: typeof s.reason === 'string' ? s.reason : null,
  };
}

/**
 * De status van de Rust-kant. Een oudere backend zonder
 * `default_pdf_app_status` valt terug op `is_default_pdf_app`.
 * @param {(cmd:string, args?:object) => Promise<any>} invoke
 */
export async function leesStandaardAppStatus(invoke) {
  try {
    const s = await invoke('default_pdf_app_status');
    if (s && typeof s === 'object') return normaliseer(s);
  } catch { /* terugval hieronder */ }
  try {
    const ja = await invoke('is_default_pdf_app');
    return { isDefault: ja === true, current: null, canSet: true, reason: null };
  } catch {
    return { ...ONBEKEND };
  }
}

/**
 * De balk bij het opstarten alleen als zeker is dat een andere app de
 * standaard is én de app daar iets aan kan doen. Niet na te gaan (sandbox,
 * geen xdg-mime) = niet bij elke start vragen.
 */
export function moetBalkTonen(status) {
  return status?.isDefault === false && status?.canSet === true;
}

/**
 * De tekst bij "Huidige standaard:" in Voorkeuren > Bestandskoppeling.
 * @param {object} status uit leesStandaardAppStatus
 * @param {{t:Function, tCommon:Function, platform:string}} opts
 *   t: namespace 'preferences', tCommon: namespace 'common'.
 */
export function huidigeAppTekst(status, { t, tCommon, platform }) {
  if (status?.isDefault === true) return tCommon('appName');
  if (status?.reason === 'flatpak' || status?.reason === 'snap') return t('fileAssoc.chosenInSystemSettings');
  if (platform === 'mac') return t('fileAssoc.checkFinder');
  if (status?.current) return status.current;
  if (status?.isDefault === false) return t('fileAssoc.notSet');
  return tCommon('unableToDetect');
}

/**
 * Wat er gebeurt bij "Als standaard instellen": roept zo nodig
 * `open_default_apps_settings` aan en geeft de melding voor de gebruiker
 * terug als { sleutel, opties } (namespace 'preferences'), of null.
 * @param {{invoke:Function, status:object, platform:string}} opts
 */
export async function zetAlsStandaard({ invoke, status, platform }) {
  if (platform === 'mac') return { sleutel: 'fileAssoc.macInstructions' };
  const pakket = PAKKET_NAAM[status?.reason];
  if (pakket) return { sleutel: 'fileAssoc.sandboxInstructions', opties: { package: pakket } };
  if (platform === 'linux' && status?.reason === 'xdg-mime-missing') return { sleutel: 'fileAssoc.xdgMimeMissing' };
  try {
    const gelukt = await invoke('open_default_apps_settings');
    if (platform === 'windows') {
      return { sleutel: gelukt === false ? 'fileAssoc.windowsFailed' : 'fileAssoc.windowsInstructions' };
    }
    if (gelukt === false) return { sleutel: 'fileAssoc.linuxFailed', opties: { error: '' } };
    return { sleutel: 'fileAssoc.linuxDone' };
  } catch (e) {
    if (platform === 'windows') return { sleutel: 'fileAssoc.windowsFailed' };
    return { sleutel: 'fileAssoc.linuxFailed', opties: { error: `${e?.message ?? e}` } };
  }
}
