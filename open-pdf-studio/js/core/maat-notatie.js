// Getal- en eenheidnotatie van maten per taal (#629): "2,50 m" en "15,60 m²"
// in het Nederlands, "2.50 m" in het Engels, "12 345,6" (smalle vaste spatie)
// in het Frans als de duizendtalscheiding aan staat.
//
// Puur: geen app-state, geen DOM. De app zet bij het opstarten één bron
// (stelNotatieBronIn) die de taal en de voorkeuren leest; zonder bron (onder
// node, in tests) geldt de punt-notatie zonder groepering, precies wat de
// maten altijd toonden. Elke weergave van een maat (labels, eigenschappen,
// dialogen, hoeveelheden, CSV) loopt via formatGetal, zodat nergens meer een
// los toFixed met een punt staat.
//
// Wat getoond wordt is weer in te typen: de getalvelden lezen komma én punt
// (core/getal-invoer.js), en een groepsteken alleen als de gebruiker het
// aanzet.

/** De notatie zonder bron: punt, geen groepering, procent direct erachter. */
export const NOTATIE_PUNT = Object.freeze({
  decimaal: '.', groep: '', minGroep: 1, procentVoor: false, procentSpatie: '',
});

/** Toegestane waarden van de voorkeur measureDecimalNotation. */
export const DECIMAAL_KEUZES = Object.freeze(['auto', 'comma', 'point']);

const SPATIES = /[\s   ]/;
const RICHTINGSTEKENS = /[‎‏؜]/g;

function delenVan(taal, opties, waarde) {
  try {
    return new Intl.NumberFormat(taal || undefined, opties).formatToParts(waarde);
  } catch {
    return null;
  }
}

/**
 * De notatie voor een taal.
 * @param {string} [taal]  taalcode van de app ('nl', 'en', 'fr', …)
 * @param {{decimaalteken?: 'auto'|'comma'|'point', groeperen?: boolean}} [opties]
 *   decimaalteken: 'auto' volgt de taal; groeperen: duizendtallen scheiden
 * @returns {{decimaal: ','|'.', groep: string, minGroep: number,
 *   procentVoor: boolean, procentSpatie: string}}
 */
export function notatieVoor(taal, { decimaalteken = 'auto', groeperen = false } = {}) {
  const delen = delenVan(taal, {}, 12345.6) || [];
  const intlDecimaal = delen.find((d) => d.type === 'decimal')?.value || '.';
  const intlGroep = delen.find((d) => d.type === 'group')?.value || ',';
  // Arabisch-Perzisch decimaalteken: de app toont westerse cijfers, en dan is
  // de komma het decimaalteken (zoals core/getal-invoer.js het leest).
  let decimaal = intlDecimaal === ',' || intlDecimaal === '٫' ? ',' : '.';
  if (decimaalteken === 'comma') decimaal = ',';
  else if (decimaalteken === 'point') decimaal = '.';

  let groep = '';
  if (groeperen) {
    groep = intlGroep === '٬' ? (decimaal === ',' ? '.' : ',') : intlGroep;
    // Een spatie als groepsteken: altijd een vaste, zodat het getal niet
    // over twee regels breekt. Het Frans gebruikt de smalle vaste spatie.
    if (SPATIES.test(groep)) groep = groep === ' ' ? ' ' : ' ';
    // Een groepsteken gelijk aan het (overschreven) decimaalteken kan niet.
    if (groep === decimaal) groep = decimaal === ',' ? '.' : ',';
  }
  // Talen die pas vanaf vijf cijfers groeperen (es, pl): "1234", "12 345".
  const vier = delenVan(taal, {}, 1234);
  const minGroep = vier && !vier.some((d) => d.type === 'group') ? 2 : 1;

  const procent = (delenVan(taal, { style: 'percent', maximumFractionDigits: 1 }, 0.015) || [])
    .map((d) => ({ ...d, value: d.value.replace(RICHTINGSTEKENS, '') }))
    .filter((d) => d.value !== '');
  const iTeken = procent.findIndex((d) => d.type === 'percentSign');
  const iGetal = procent.findIndex((d) => d.type === 'integer');
  const procentVoor = iTeken >= 0 && iGetal >= 0 && iTeken < iGetal;
  const tussen = iTeken >= 0
    ? procent.slice(Math.min(iTeken, iGetal) + 1, Math.max(iTeken, iGetal)).filter((d) => d.type === 'literal')
    : [];
  const heeftSpatie = tussen.some((d) => SPATIES.test(d.value));
  return Object.freeze({
    decimaal, groep, minGroep, procentVoor, procentSpatie: heeftSpatie ? ' ' : '',
  });
}

/** @type {null | (() => {taal?: string, decimaalteken?: string, groeperen?: boolean})} */
let bron = null;
let cache = { sleutel: null, notatie: NOTATIE_PUNT };

/**
 * Zet de bron van de actieve notatie (de app: taal + voorkeuren). null zet
 * de punt-notatie terug.
 * @param {null | (() => {taal?: string, decimaalteken?: string, groeperen?: boolean})} fn
 */
export function stelNotatieBronIn(fn) {
  bron = typeof fn === 'function' ? fn : null;
  cache = { sleutel: null, notatie: NOTATIE_PUNT };
}

/** De notatie die nu geldt. */
export function huidigeNotatie() {
  if (!bron) return NOTATIE_PUNT;
  let invoer;
  try { invoer = bron() || {}; } catch { return NOTATIE_PUNT; }
  const keuze = DECIMAAL_KEUZES.includes(invoer.decimaalteken) ? invoer.decimaalteken : 'auto';
  const sleutel = `${invoer.taal || ''}|${keuze}|${invoer.groeperen ? 1 : 0}`;
  if (cache.sleutel !== sleutel) {
    cache = { sleutel, notatie: notatieVoor(invoer.taal, { decimaalteken: keuze, groeperen: !!invoer.groeperen }) };
  }
  return cache.notatie;
}

function groepeer(heel, notatie) {
  if (!notatie.groep || heel.length < 4 + (notatie.minGroep > 1 ? 1 : 0)) return heel;
  let uit = '';
  for (let i = 0; i < heel.length; i++) {
    if (i > 0 && (heel.length - i) % 3 === 0) uit += notatie.groep;
    uit += heel[i];
  }
  return uit;
}

/**
 * Een getal met vast aantal decimalen in de notatie: formatGetal(2.5, 2) is
 * "2.50" zonder bron en "2,50" in het Nederlands.
 * @param {number} waarde
 * @param {number} [decimalen]
 * @param {ReturnType<typeof notatieVoor>} [notatie]
 * @returns {string}  '' voor geen getal
 */
export function formatGetal(waarde, decimalen = 2, notatie = huidigeNotatie()) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return '';
  const d = Math.max(0, Math.min(20, Math.trunc(Number(decimalen) || 0)));
  let tekst = n.toFixed(d);
  // Geen "-0" of "-0,00" na het afronden.
  if (/^-0(?:\.0*)?$/.test(tekst)) tekst = tekst.slice(1);
  const negatief = tekst.startsWith('-');
  if (negatief) tekst = tekst.slice(1);
  const [heel, deel] = tekst.split('.');
  const uit = groepeer(heel, notatie) + (deel ? notatie.decimaal + deel : '');
  return negatief ? `-${uit}` : uit;
}

/**
 * Een getal met zo veel decimalen als nodig, tot `maxDecimalen`
 * (formatGetalKort(2.5) is "2.5"/"2,5", formatGetalKort(3) is "3").
 */
export function formatGetalKort(waarde, maxDecimalen = 6, notatie = huidigeNotatie()) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return '';
  const d = Math.max(0, Math.min(20, Math.trunc(maxDecimalen)));
  const kort = String(Number(n.toFixed(d)));
  if (/e/i.test(kort)) return formatGetal(n, d, notatie);
  const decimalen = kort.includes('.') ? kort.split('.')[1].length : 0;
  return formatGetal(n, decimalen, notatie);
}

/**
 * Een percentage (de waarde is al in procenten: 1.5 is "1.5%").
 * @param {number} procent
 * @param {number} [decimalen]
 * @param {ReturnType<typeof notatieVoor>} [notatie]
 * @param {{teken?: boolean}} [opties]  teken: altijd + of - ervoor
 */
export function formatProcent(procent, decimalen = 1, notatie = huidigeNotatie(), { teken = false } = {}) {
  const n = Number(procent);
  if (!Number.isFinite(n)) return '';
  const d = Math.max(0, Math.min(20, Math.trunc(Number(decimalen) || 0)));
  const getal = formatGetal(Math.abs(n), d, notatie);
  // Wat op nul afrondt krijgt geen teken: "0,0%", niet "-0,0%".
  const nul = Number(Math.abs(n).toFixed(d)) === 0;
  const voorteken = nul ? '' : (n < 0 ? '-' : (teken ? '+' : ''));
  if (notatie.procentVoor) return `${voorteken}%${notatie.procentSpatie}${getal}`;
  return `${voorteken}${getal}${notatie.procentSpatie}%`;
}

const EENHEDEN = Object.freeze({
  mm2: 'mm²', cm2: 'cm²', dm2: 'dm²', m2: 'm²', km2: 'km²',
  in2: 'in²', ft2: 'ft²', yd2: 'yd²',
  mm3: 'mm³', cm3: 'cm³', dm3: 'dm³', m3: 'm³', in3: 'in³', ft3: 'ft³', yd3: 'yd³',
});

/**
 * Een eenheid met echte superscripts: "m2", "m^2" en "sq m" worden "m²",
 * "m3" wordt "m³". Een eenheid die al klopt blijft zoals ze is.
 * @param {string} eenheid
 */
export function eenheidNotatie(eenheid) {
  if (typeof eenheid !== 'string') return '';
  const kaal = eenheid.trim();
  const sleutel = kaal.replace(/\^/, '').replace(/^sq\.?\s*(\w+)$/i, '$12').replace(/^cu\.?\s*(\w+)$/i, '$13');
  return EENHEDEN[sleutel] || EENHEDEN[sleutel.toLowerCase()] || kaal;
}

/**
 * Getal en eenheid: "2,50 m", "15,60 m²". Zonder eenheid (of 'px') alleen het getal.
 */
export function formatMaat(waarde, eenheid, decimalen = 2, notatie = huidigeNotatie()) {
  const getal = formatGetal(waarde, decimalen, notatie);
  const e = eenheidNotatie(eenheid || '');
  return !e || e === 'px' ? getal : `${getal} ${e}`;
}

/**
 * Scheidingsteken tussen twee getallen in één label ("X 1,5; Y 2 mm"): met
 * een decimaalkomma kan de komma geen lijstteken zijn.
 */
export function lijstScheiding(notatie = huidigeNotatie()) {
  return notatie.decimaal === ',' ? '; ' : ', ';
}
