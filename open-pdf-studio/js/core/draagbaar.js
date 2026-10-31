// Draagbare modus (#881): de Windows-zip die zonder installatie draait en
// zijn gegevens in `data\` naast het programma houdt.
//
// Rust stelt de modus vast (src-tauri/src/draagbaar.rs, `portable_status`) en
// zet de gegevensmappen om; hier staat alleen wat de frontend anders doet:
//
//  - bijwerken: niets installeren, maar naar de nieuwe zip verwijzen
//    (ui/chrome/updater.js); "vorige versie" kiest ook de zip
//    (help/previous-version.js);
//  - geen vraag of de app de standaard-PDF-app moet worden (main.js) en in de
//    voorkeuren een uitleg in plaats van de knop (FileAssocTab.jsx);
//  - Verkenner-miniaturen en de virtuele printer: niet beschikbaar, met een
//    uitleg (FileAssocTab.jsx, VirtualPrinterTab.jsx).
//
// Deze module is vrij van DOM- en i18n-imports, zodat de regels los te testen
// zijn.

/** Toestand buiten de draagbare modus (browser, installatie, fout). */
export const GEEN_DRAAGBAAR = Object.freeze({
  portable: false,
  dataDir: null,
  exeDir: null,
  fixedRuntime: false,
  dataDirError: null,
});

/** Releasepagina waar de nieuwste draagbare zip staat. */
export const RELEASES_URL = 'https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/latest';

/** Bestandsnaam van de draagbare zip, zoals de releaseworkflow hem uploadt. */
export function zipNaam(versie) {
  const v = String(versie || '').trim().replace(/^v/, '');
  return `Open.PDF.Studio_${v}_x64_portable.zip`;
}

/** Wat in de draagbare modus niet kan of anders gaat. */
export const ALLEEN_GEINSTALLEERD = Object.freeze([
  'autoUpdate',
  'defaultAppPrompt',
  'explorerThumbnails',
  'virtualPrinter',
]);

const tekstOfNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Maakt van wat Rust teruggeeft een volledige, veilige toestand. */
export function normaliseerDraagbaar(s) {
  if (!s || typeof s !== 'object') return { ...GEEN_DRAAGBAAR };
  return {
    portable: s.portable === true,
    dataDir: tekstOfNull(s.dataDir),
    exeDir: tekstOfNull(s.exeDir),
    fixedRuntime: s.fixedRuntime === true,
    dataDirError: tekstOfNull(s.dataDirError),
  };
}

/**
 * Mag deze functie hier? Buiten de draagbare modus altijd; daarbinnen niet
 * wat in ALLEEN_GEINSTALLEERD staat.
 */
export function functieBeschikbaar(naam, status) {
  if (!normaliseerDraagbaar(status).portable) return true;
  return !ALLEEN_GEINSTALLEERD.includes(naam);
}

async function standaardInvoke(cmd, args) {
  const { invoke, isTauri } = await import('./platform.js');
  if (!isTauri()) return { ...GEEN_DRAAGBAAR };
  return invoke(cmd, args);
}

let gelezen = null;

/**
 * De toestand, één keer per sessie bij Rust opgevraagd. Een fout (oudere
 * backend, browser) telt als "niet draagbaar".
 */
export function leesDraagbaar(invoke = standaardInvoke) {
  if (!gelezen) {
    gelezen = Promise.resolve()
      .then(() => invoke('portable_status', {}))
      .then(normaliseerDraagbaar, () => ({ ...GEEN_DRAAGBAAR }));
  }
  return gelezen;
}

/** Alleen voor tests: vergeet de gelezen toestand. */
export function _vergeetDraagbaar() {
  gelezen = null;
}

/** Draait deze start draagbaar? */
export async function isDraagbaar(invoke) {
  return (await leesDraagbaar(invoke)).portable;
}
