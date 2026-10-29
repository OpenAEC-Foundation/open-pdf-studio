/**
 * Muiswiel boven het lint wisselt van linttabblad (#852). Zuivere regels;
 * Ribbon.jsx luistert naar het wiel op de lintcontainer en klikt het
 * gevonden tabblad aan, zoals de gebruiker dat zelf zou doen.
 *
 * - Eén wielklik is één tabblad, zonder rondloop aan begin en eind.
 * - Een wiel met fijne stappen of een touchpad stuurt veel kleine delta's:
 *   die tellen op tot WIEL_DREMPEL_PX en geven dan één tabblad, waarna kleine
 *   delta's even (WIEL_PAUZE_MS) niet meetellen; zo raast een touchpadveeg
 *   niet door alle tabbladen.
 * - Een element met een eigen wiel (invoervak, keuzelijst, een galerij of
 *   lijst die kan scrollen, een open uitklapmenu) houdt dat wiel.
 */

/** Zoveel px (verticaal) is één wielklik; één klik van een gewone muis is 100 px. */
export const WIEL_DREMPEL_PX = 50;
/** Pixels per regel bij deltaMode 1 (drie regels per klik = 100 px). */
const PX_PER_REGEL = 100 / 3;
/** Zonder wiel gedurende zoveel ms vervalt een half opgetelde beweging. */
export const WIEL_RUST_MS = 200;
/** Na een stap uit opgetelde kleine delta's tellen kleine delta's zo lang niet. */
export const WIEL_PAUZE_MS = 250;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** De verticale beweging van een wheel-event in px. */
export function wielInPixels(e) {
  const d = Number(e?.deltaY);
  if (!Number.isFinite(d) || d === 0) return 0;
  if (e.deltaMode === DOM_DELTA_LINE) return d * PX_PER_REGEL;
  if (e.deltaMode === DOM_DELTA_PAGE) return Math.sign(d) * WIEL_DREMPEL_PX;
  return d;
}

/**
 * Een teller die wheel-events omzet in stappen van één tabblad.
 * `stap(e)` geeft +1 (volgende), -1 (vorige) of 0.
 * @param {{ nu?: () => number }} [o]
 */
export function maakWielStapper({ nu = () => Date.now() } = {}) {
  let som = 0;
  let laatsteEvent = -Infinity;
  let laatsteStap = -Infinity;
  return {
    stap(e) {
      const t = nu();
      const dy = wielInPixels(e);
      const dx = Number(e?.deltaX) || 0;
      if (t - laatsteEvent > WIEL_RUST_MS) som = 0;
      laatsteEvent = t;
      // Vooral zijwaarts: geen tabbladwissel.
      if (dy === 0 || Math.abs(dx) > Math.abs(dy)) return 0;
      // Een gewone wielklik (of meer, samengevoegd): meteen één tabblad.
      if (Math.abs(dy) >= WIEL_DREMPEL_PX) {
        som = 0;
        laatsteStap = t;
        return Math.sign(dy);
      }
      // Kleine delta's: optellen in één richting, met een pauze na een stap.
      if (t - laatsteStap < WIEL_PAUZE_MS) { som = 0; return 0; }
      if (som !== 0 && Math.sign(som) !== Math.sign(dy)) som = 0;
      som += dy;
      if (Math.abs(som) < WIEL_DREMPEL_PX) return 0;
      const richting = Math.sign(som);
      som = 0;
      laatsteStap = t;
      return richting;
    },
  };
}

/**
 * Het tabblad één stap verder in weergavevolgorde, of null aan het begin of
 * eind (geen rondloop) en bij een onbekend huidig tabblad.
 * @param {string[]} tabs
 * @param {string} huidig
 * @param {number} richting  +1 of -1
 */
export function wielTab(tabs, huidig, richting) {
  if (!Array.isArray(tabs) || !richting) return null;
  const i = tabs.indexOf(huidig);
  if (i < 0) return null;
  const j = i + Math.sign(richting);
  return j >= 0 && j < tabs.length ? tabs[j] : null;
}

/**
 * De tab-id's van de zichtbare tabknoppen in weergavevolgorde: zonder de
 * extensietabbladen die naar het overloopmenu zijn verhuisd en zonder
 * knoppen die niet getekend zijn. De bestandsknop is geen tab (geen
 * role="tab") en komt in de lijst knoppen niet voor.
 */
export function lintTabs(knoppen) {
  return [...(knoppen || [])]
    .filter((k) => k?.dataset?.tab
      && !k.classList?.contains('ribbon-ext-tab-verborgen')
      && (typeof k.getClientRects !== 'function' || k.getClientRects().length > 0))
    .map((k) => k.dataset.tab);
}

const EIGEN_WIEL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const EIGEN_WIEL_ROLLEN = new Set(['listbox', 'menu', 'spinbutton', 'slider', 'combobox', 'textbox']);

/**
 * Heeft het element onder de aanwijzer (of een voorouder tot aan `grens`,
 * de lintcontainer) een eigen wiel? Invoervakken, keuzelijsten, elementen
 * met een eigen rol, een lijst of galerij die verticaal kan scrollen, een
 * open uitklapmenu (position: fixed) en alles met data-eigen-wiel.
 * @param {Element|null} doel
 * @param {Element} grens
 * @param {(el: Element) => {overflowY:string, position:string}} stijlVan
 */
export function heeftEigenWiel(doel, grens, stijlVan) {
  for (let el = doel; el && el !== grens; el = el.parentElement) {
    if (EIGEN_WIEL_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute?.('data-eigen-wiel')) return true;
    if (EIGEN_WIEL_ROLLEN.has(el.getAttribute?.('role'))) return true;
    const s = stijlVan(el);
    if (s?.position === 'fixed') return true;
    if ((s?.overflowY === 'auto' || s?.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return true;
  }
  return false;
}
