// Taal en thema van de OpenAEC SuperCloud (#977).
//
// Het contract (OpenAEC-Blueprint docs/supercloud-koppeling.md) geeft op
// `window.openaecHost` optioneel `taal` (nl, en, de, fr, es, tr) en `thema`
// (light, dark); het event `openaec-host-preferences` meldt een wijziging op
// hetzelfde hostobject, `openaec-host-ready` een host die pas later kwam. De
// namen `locale` en `theme` gelden ook (zoals bij de andere OpenAEC-tools), en
// de hashparameters `taal`/`thema` (core/site-host.js, voorkeurenUitHash) zijn
// de terugval als de host zelf niets meegeeft.
//
// Alleen met een `openaecHost` doet dit iets: een losse webversie met een hash
// houdt de eigen voorkeuren. Een onbekende waarde wordt genegeerd; de app
// houdt dan wat hij had.
//
// Pure logica (venster van buiten), te testen zonder DOM (host-voorkeuren.test.mjs).

import { HOST_KLAAR_EVENT, voorkeurenUitHash } from './site-host.js';

export const HOST_VOORKEUREN_EVENT = 'openaec-host-preferences';

/** Thema's van het contract -> thema-ids van de app (core/preferences.js, applyTheme). */
export const HOST_THEMAS = Object.freeze({ light: 'light', dark: 'dark' });

/**
 * De taalcode van de app voor een taal van de host (`nl`, `nl-NL`, `EN_us`),
 * of null als de app die taal niet kent.
 * @param {unknown} waarde
 * @param {string[]} talen  de taalcodes van de app (zonder 'auto')
 */
export function taalUitHost(waarde, talen) {
  if (typeof waarde !== 'string') return null;
  const basis = waarde.trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(basis) || basis === 'auto') return null;
  return Array.isArray(talen) && talen.includes(basis) ? basis : null;
}

/** Het thema-id van de app voor een thema van de host, of null. */
export function themaUitHost(waarde) {
  if (typeof waarde !== 'string') return null;
  const sleutel = waarde.trim().toLowerCase();
  return Object.hasOwn(HOST_THEMAS, sleutel) ? HOST_THEMAS[sleutel] : null;
}

const eerste = (...waarden) => waarden.find((w) => typeof w === 'string' && w.trim() !== '');

/**
 * Taal en thema van de host, al omgezet naar de ids van de app. Zonder host
 * (geen object) een leeg antwoord.
 * @param {{ host?: object|null, hash?: string, talen: string[] }} o
 * @returns {{ language?: string, theme?: string }}
 */
export function leesHostVoorkeuren({ host, hash = '', talen }) {
  if (!host || typeof host !== 'object') return {};
  const uitHash = voorkeurenUitHash(hash);
  const uit = {};
  const taal = taalUitHost(eerste(host.taal, host.locale) ?? uitHash.taal, talen);
  const thema = themaUitHost(eerste(host.thema, host.theme) ?? uitHash.thema);
  if (taal) uit.language = taal;
  if (thema) uit.theme = thema;
  return uit;
}

/**
 * Zet de voorkeuren van de host in het voorkeurenobject van de app. Geeft
 * true als er iets veranderde (dan moet de app ze toepassen).
 * @param {object} voorkeuren  state.preferences
 * @param {{ language?: string, theme?: string }} host
 */
export function neemHostVoorkeurenOver(voorkeuren, host) {
  if (!voorkeuren || typeof voorkeuren !== 'object') return false;
  let anders = false;
  for (const sleutel of ['language', 'theme']) {
    const waarde = host?.[sleutel];
    if (typeof waarde === 'string' && voorkeuren[sleutel] !== waarde) {
      voorkeuren[sleutel] = waarde;
      anders = true;
    }
  }
  return anders;
}

/**
 * Neemt taal en thema van de host nu over en volgt de wijzigingen
 * (`openaec-host-preferences`, en `openaec-host-ready` voor een late host).
 * @param {object} o
 * @param {object} o.venster
 * @param {string[]} o.talen                    de taalcodes van de app
 * @param {() => object} o.voorkeuren          geeft state.preferences
 * @param {() => void} o.pasToe                 past de voorkeuren toe (applyPreferences)
 * @returns {() => void} stopt het volgen
 */
export function volgHostVoorkeuren({ venster, talen, voorkeuren, pasToe }) {
  if (!venster) return () => {};
  const werkBij = () => {
    let host;
    try { host = venster.openaecHost; } catch { host = null; }
    const nieuw = leesHostVoorkeuren({ host, hash: venster.location?.hash ?? '', talen });
    if (!neemHostVoorkeurenOver(voorkeuren(), nieuw)) return;
    try { pasToe(); } catch (e) { console.warn('[site] taal en thema van de host niet toegepast:', e); }
  };
  werkBij();
  if (typeof venster.addEventListener !== 'function') return () => {};
  venster.addEventListener(HOST_VOORKEUREN_EVENT, werkBij);
  venster.addEventListener(HOST_KLAAR_EVENT, werkBij);
  return () => {
    venster.removeEventListener?.(HOST_VOORKEUREN_EVENT, werkBij);
    venster.removeEventListener?.(HOST_KLAAR_EVENT, werkBij);
  };
}
