// Getalvelden — invoervelden voor getallen die komma én punt accepteren.
//
// Een getalveld van het browsertype (input type=number) weigert in de
// WebView, afhankelijk van de landinstelling, één van beide decimaaltekens:
// "0,1" of "0.1" wordt dan stil een leeg veld. Daarom zijn alle getalvelden gewone tekstvelden met
// het kenmerk data-getal (en inputmode="decimal"). Deze module geeft zo'n
// veld het gedrag van een getalveld terug:
//
// - `value` levert de canonieke tekst ("0.1"), of '' bij onzin, net als een
//   getalveld. Bestaande code met parseFloat/Number/parseInt werkt dus
//   ongewijzigd, wat de gebruiker ook typt (zie core/getal-invoer.js).
// - een toegewezen waarde wordt getoond met het decimaalteken van de taal
//   (0.1 -> "0,1" in het Nederlands); onzin wordt leeg, zoals bij een
//   getalveld.
// - zolang de gebruiker typt, blijft zijn tekst staan: een terugvalwaarde
//   die een invoerhandler halverwege terugschrijft ("0" -> 1 terwijl "0,1"
//   bedoeld is) volgt pas bij Enter, Escape of het verlaten van het veld;
//   daarna volgt ook de notatie van de taal.
// - pijl omhoog/omlaag stapt met step, binnen min en max.
// - letters worden niet aangenomen, net als in een getalveld.
// - een LENGTEVELD (data-getal="lengte") neemt daarnaast een voet-inchmaat
//   aan (12'-6 3/8", 6", 1.5'; #1145): `value` geeft die tekst dan zoals ze
//   getypt is, en de aanroeper leest haar met leesLengte (core/voet-inch.js),
//   dezelfde parser als overal. Een kaal getal blijft een gewoon getal.
// - op een veld in een gebied met data-getal-sleep (het eigenschappenpaneel)
//   kan gesleept worden om de waarde te veranderen (#1168, getal-slepen.js).

import { normaliseerGetalTekst, leesGetal, toonGetal } from '../core/getal-invoer.js';
import { installeerGetalStappen } from './getal-stappen.js';
import { installeerGetalSlepen } from './getal-slepen.js';
import { leesVoetInch, VOET_INCH_TEKENS } from '../core/voet-inch.js';

export const GETAL_SELECTOR = 'input[data-getal]';

let taalBron = () => (typeof navigator !== 'undefined' ? navigator.language : 'en');
let geinstalleerd = false;

/** @type {WeakMap<object, {nat: PropertyDescriptor, bewerkt: boolean, wachtend: string|null}>} */
const velden = new WeakMap();

function nativeWaarde(el) {
  let proto = Object.getPrototypeOf(el);
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.get && d.set) return d;
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

function heeftFocus(el) {
  const doc = el.ownerDocument;
  return !!doc && doc.activeElement === el;
}

/** Is dit element een (opgewaardeerd) getalveld? */
export function isGetalVeld(el) {
  return !!el && velden.has(el);
}

/** De tekst zoals de gebruiker hem ziet, zonder normalisatie. */
export function zichtbareTekst(el) {
  const st = velden.get(el);
  return st ? st.nat.get.call(el) : el?.value;
}

/** Zet de zichtbare tekst zonder omweg (voor het slepen van een waarde). */
function zetZichtbareTekst(el, tekst) {
  maakGetalVeld(el);
  const st = velden.get(el);
  if (!st) { el.value = tekst; return; }
  st.wachtend = null;
  st.nat.set.call(el, tekst);
}

/** Is dit een lengteveld (data-getal="lengte")? */
function isLengteVeld(el) {
  return el?.getAttribute?.('data-getal') === 'lengte';
}

/** De voet-inchmaat in een lengteveld (bijgesneden), of null. */
function voetInchTekst(el, tekst) {
  if (!isLengteVeld(el) || typeof tekst !== 'string') return null;
  const kaal = tekst.trim();
  return leesVoetInch(kaal) != null ? kaal : null;
}

function schrijf(el, st, waarde) {
  const tekst = waarde == null ? '' : String(waarde);
  const huidig = st.nat.get.call(el);
  // Een voet-inchmaat in een lengteveld blijft staan zoals ze is.
  const maat = voetInchTekst(el, tekst);
  if (maat != null) {
    if (voetInchTekst(el, huidig) === maat) { st.wachtend = null; return; }
    if (st.bewerkt && heeftFocus(el)) { st.wachtend = tekst; return; }
    st.wachtend = null;
    st.nat.set.call(el, maat);
    return;
  }
  const nieuw = leesGetal(tekst);
  // Hetzelfde getal: laat de notatie van de gebruiker staan (geen
  // cursorsprong tijdens het typen, "0.1" blijft "0.1" tot het veld verlaten wordt).
  if (Number.isFinite(nieuw) && leesGetal(huidig) === nieuw) {
    st.wachtend = null;
    return;
  }
  // De gebruiker is aan het typen: niet overschrijven met een terugval- of
  // grenswaarde van de invoerhandler ("0" -> 1 maakte "0,1" ontypbaar); die
  // waarde volgt bij Enter, Escape of het verlaten van het veld.
  if (st.bewerkt && heeftFocus(el)) {
    st.wachtend = tekst;
    return;
  }
  st.wachtend = null;
  // Net als een getalveld: wat geen getal is, wordt leeg.
  const canoniek = normaliseerGetalTekst(tekst);
  if (canoniek === '') {
    st.nat.set.call(el, '');
    return;
  }
  // Een programmatische waarde als "0.10" houdt haar nullen; een andere
  // notatie ("1.234,5") gaat via de canonieke vorm.
  const kaal = tekst.trim();
  st.nat.set.call(el, toonGetal(JS_GETAL.test(kaal) ? kaal : canoniek, taalBron()));
}

const JS_GETAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Maakt van een tekstveld een getalveld. Dubbel aanroepen kan geen kwaad.
 * @param {HTMLInputElement} el
 */
export function maakGetalVeld(el) {
  if (!el || velden.has(el)) return;
  const nat = nativeWaarde(el);
  if (!nat) return;
  const st = { nat, bewerkt: false, wachtend: null };
  velden.set(el, st);
  Object.defineProperty(el, 'value', {
    configurable: true,
    enumerable: true,
    get() {
      const ruw = nat.get.call(el);
      return normaliseerGetalTekst(ruw) || voetInchTekst(el, ruw) || '';
    },
    set(v) { schrijf(el, st, v); },
  });
  Object.defineProperty(el, 'valueAsNumber', {
    configurable: true,
    enumerable: true,
    get() { return leesGetal(nat.get.call(el)); },
    set(n) { schrijf(el, st, Number.isFinite(n) ? String(n) : ''); },
  });
  // Wat er al stond (statische value of eerdere toewijzing) in de notatie van de taal.
  const nu = nat.get.call(el);
  if (nu !== '' && voetInchTekst(el, nu) == null) nat.set.call(el, toonGetal(normaliseerGetalTekst(nu), taalBron()));
}

function aantalDecimalen(n) {
  const s = String(n);
  const e = /e-(\d+)$/i.exec(s);
  if (e) return Number(e[1]) + ((s.split('e')[0].split('.')[1] || '').length);
  return (s.split('.')[1] || '').length;
}

/**
 * De waarde na één stap omhoog (richting 1) of omlaag (-1), zoals een
 * getalveld dat doet: op het raster van step vanaf min (of 0), binnen min/max.
 * @param {string} tekst huidige invoer
 * @param {1|-1} richting
 * @param {{min?: string|null, max?: string|null, step?: string|null}} grenzen
 * @returns {number}
 */
export function stapWaarde(tekst, richting, { min, max, step } = {}) {
  let stap = leesGetal(step ?? '');
  if (!(stap > 0)) stap = 1; // ook step="any"
  const lo = leesGetal(min ?? '');
  const hi = leesGetal(max ?? '');
  const basis = Number.isFinite(lo) ? lo : 0;
  const huidig = leesGetal(tekst);
  let nieuw;
  if (!Number.isFinite(huidig)) {
    nieuw = Number.isFinite(lo) ? lo : 0;
  } else {
    const n = (huidig - basis) / stap;
    const index = richting > 0 ? Math.floor(n + 1e-9) + 1 : Math.ceil(n - 1e-9) - 1;
    nieuw = basis + index * stap;
  }
  if (Number.isFinite(lo) && nieuw < lo) nieuw = lo;
  if (Number.isFinite(hi) && nieuw > hi) nieuw = hi;
  const dec = Math.max(aantalDecimalen(stap), aantalDecimalen(basis));
  return Number(nieuw.toFixed(Math.min(dec, 12)));
}

function stuurInvoer(el) {
  const Ev = el.ownerDocument?.defaultView?.Event ?? globalThis.Event;
  el.dispatchEvent(new Ev('input', { bubbles: true }));
  el.dispatchEvent(new Ev('change', { bubbles: true }));
}

/**
 * Pijltoets in een getalveld. Alleen als niemand anders de toets al
 * afhandelde (preventDefault), zoals bij een getalveld.
 * @returns {boolean} of er gestapt is
 */
export function verwerkPijl(e) {
  const el = e.target;
  const st = velden.get(el);
  if (!st || e.defaultPrevented) return false;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  if (el.disabled || el.readOnly) return false;
  // Een voet-inchmaat heeft geen stap: de pijl laat haar met rust.
  if (voetInchTekst(el, st.nat.get.call(el)) != null) return false;
  e.preventDefault();
  const nieuw = stapWaarde(st.nat.get.call(el), e.key === 'ArrowUp' ? 1 : -1, {
    min: el.getAttribute('min'), max: el.getAttribute('max'), step: el.getAttribute('step'),
  });
  st.wachtend = null;
  st.nat.set.call(el, toonGetal(nieuw, taalBron()));
  stuurInvoer(el);
  return true;
}

/** De gebruiker typt in het veld (input-event): vanaf nu telt zijn tekst. */
export function verwerkInvoer(e) {
  const st = velden.get(e.target);
  if (st && e.isTrusted !== false) st.bewerkt = true;
}

/**
 * Enter of Escape: de handlers van het veld mogen de tekst weer zetten
 * (bevestigen, begrenzen of herstellen), ook als het veld focus houdt.
 */
export function verwerkToetsVooraf(e) {
  const st = velden.get(e.target);
  if (st && (e.key === 'Enter' || e.key === 'Escape')) st.bewerkt = false;
}

const TOEGESTAAN = /^[0-9٠-٩۰-۹.,٫٬+\-−eE\s]*$/;

/** Weigert letters en andere tekens die nooit in een getal horen. */
export function verwerkVoorInvoer(e) {
  if (!velden.has(e.target)) return;
  if (!String(e.inputType || '').startsWith('insert')) return;
  if (e.data == null || TOEGESTAAN.test(e.data)) return;
  // Een lengteveld neemt ook de tekens van een voet-inchmaat aan.
  if (isLengteVeld(e.target) && [...e.data].every((ch) => TOEGESTAAN.test(ch) || VOET_INCH_TEKENS.includes(ch))) return;
  e.preventDefault();
}

/** Bij het verlaten: uitgestelde waarde toepassen, anders de notatie van de taal. */
export function verwerkVerlaten(el) {
  const st = velden.get(el);
  if (!st) return;
  st.bewerkt = false;
  const huidig = st.nat.get.call(el);
  if (st.wachtend != null) {
    const w = st.wachtend;
    st.wachtend = null;
    schrijf(el, st, w);
    return;
  }
  st.wachtend = null;
  const canoniek = normaliseerGetalTekst(huidig);
  if (canoniek !== '') {
    const getoond = toonGetal(canoniek, taalBron());
    if (getoond !== huidig) st.nat.set.call(el, getoond);
  }
}

function waardeerOp(knoop) {
  if (!knoop || knoop.nodeType !== 1) return;
  if (knoop.matches?.(GETAL_SELECTOR)) maakGetalVeld(knoop);
  knoop.querySelectorAll?.(GETAL_SELECTOR).forEach(maakGetalVeld);
}

/**
 * Toont alle getalvelden (behalve het veld waarin getypt wordt) opnieuw in
 * de notatie van de taal, bijvoorbeeld na een taalwissel.
 */
export function herformatteerGetalVelden(root = globalThis.document) {
  root?.querySelectorAll?.(GETAL_SELECTOR).forEach((el) => {
    const st = velden.get(el);
    if (!st || heeftFocus(el)) return;
    const huidig = st.nat.get.call(el);
    const canoniek = normaliseerGetalTekst(huidig);
    if (canoniek !== '') st.nat.set.call(el, toonGetal(canoniek, taalBron()));
  });
}

/**
 * Eenmalig bij de start: waardeert elk getalveld op zodra het in de DOM komt.
 * @param {object} [opties]
 * @param {() => string} [opties.taal] de huidige app-taal
 * @param {() => string} [opties.sleepHint] tooltip voor het label van een veld waarop gesleept kan worden
 * @param {(veld: Element) => void} [opties.sleepBegin] een waarde wordt gesleept
 * @param {(info: {veld: Element, geannuleerd: boolean}) => void} [opties.sleepEinde] de sleep is klaar
 */
export function installeerGetalVelden({ taal, sleepHint, sleepBegin, sleepEinde } = {}) {
  if (typeof taal === 'function') taalBron = taal;
  const doc = globalThis.document;
  if (geinstalleerd || !doc) return;
  geinstalleerd = true;
  installeerGetalStappen(doc);
  installeerGetalSlepen(doc, {
    leesTekst: zichtbareTekst,
    schrijfTekst: zetZichtbareTekst,
    taal: () => taalBron(),
    hint: sleepHint,
    begin: sleepBegin,
    einde: sleepEinde,
  });
  waardeerOp(doc.documentElement);
  new MutationObserver((mutaties) => {
    for (const m of mutaties) {
      if (m.type === 'attributes') waardeerOp(m.target);
      else m.addedNodes.forEach(waardeerOp);
    }
  }).observe(doc.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-getal'],
  });
  // Vangnet voor een veld dat focus krijgt vóór de observer het zag.
  doc.addEventListener('focusin', (e) => {
    if (e.target?.matches?.(GETAL_SELECTOR)) maakGetalVeld(e.target);
    const st = velden.get(e.target);
    if (st) st.bewerkt = false;
  }, true);
  doc.addEventListener('input', verwerkInvoer, true);
  doc.addEventListener('beforeinput', verwerkVoorInvoer, true);
  doc.addEventListener('keydown', verwerkToetsVooraf, true);
  // Op window in de bubbelfase: na de eigen toetshandlers van de componenten,
  // zodat een veld dat de pijltjes zelf afhandelt (preventDefault) voorgaat.
  globalThis.addEventListener?.('keydown', verwerkPijl);
  globalThis.addEventListener?.('focusout', (e) => verwerkVerlaten(e.target));
}
