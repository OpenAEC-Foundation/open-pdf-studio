// Entry van het bouwdoel `web-unit` (`dist-web-unit/open-pdf-studio.js`).
//
// Eén script dat het element <open-pdf-studio> registreert en de API
// `OpenPdfStudio.mount(el, opties)` aanbiedt (als export én als
// `globalThis.OpenPdfStudio`). Alles wat niet nodig is voordat er een
// document staat — PDF.js, pdf-lib, MuPDF en de iframe-brug — komt pas op
// aanvraag binnen; zie web-unit/bundel-budget.test.mjs voor de bewaking.

import { registreer, OpenPdfStudioElement } from './element.js';
import { attributenUitOpties, HANDLERS, EVENTS } from './api.js';

const VERSIE = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

registreer();

/**
 * De postMessage-brug aan een element hangen (iframe-variant). Lui: een
 * gastheer die de unit rechtstreeks in zijn pagina zet, laadt hem nooit.
 */
export async function koppelIframeBrug(element, venster = window) {
  const { koppelIframeBrug: koppel } = await import('./iframe-brug.js');
  return koppel(element, venster);
}

/**
 * De unit in een element van de gastheer zetten.
 *
 * @param {Element|string} doel element of CSS-selector waarin de unit komt
 * @param {object} [opties]
 *   src, scale, unit, lang, engine, mode, tools, page, zoom, storage,
 *   hostOrigin, toolbar, theme — als de attributen van het element;
 *   readOnly: true      — hetzelfde als mode: 'view';
 *   document            — bytes, Blob of URL om meteen te openen;
 *   labels, author      — eigen werkbalkteksten en auteursnaam;
 *   onLoad, onChange, onSave, onError — terugroepfuncties (detail, event).
 * @returns {OpenPdfStudioElement} het element; daarop staan load(),
 *   exportPdf(), getAnnotations(), setAnnotations(), setScale(), ...
 */
export function mount(doel, opties = {}) {
  const ouder = typeof doel === 'string' ? document.querySelector(doel) : doel;
  if (!ouder || typeof ouder.append !== 'function') throw new Error('OpenPdfStudio.mount: target element not found');
  registreer();
  const el = document.createElement('open-pdf-studio');
  for (const [naam, waarde] of Object.entries(attributenUitOpties(opties))) el.setAttribute(naam, waarde);
  for (const [optie, gebeurtenis] of Object.entries(HANDLERS)) {
    if (typeof opties[optie] === 'function') el.addEventListener(gebeurtenis, (e) => opties[optie](e.detail, e));
  }
  ouder.append(el);
  if (opties.labels) el.labels = opties.labels;
  if (opties.author) el.author = opties.author;
  if (opties.scale && typeof opties.scale === 'object') el.setScale(opties.scale);
  if (opties.document != null) el.load(opties.document).catch(() => { /* onError/opds:error meldt het */ });
  return el;
}

export const OpenPdfStudio = Object.freeze({
  version: VERSIE,
  mount,
  events: EVENTS,
  Element: OpenPdfStudioElement,
});

if (typeof globalThis !== 'undefined' && !globalThis.OpenPdfStudio) globalThis.OpenPdfStudio = OpenPdfStudio;

// In een iframe hangt de brug automatisch aan het eerste element met een
// `host-origin`; zonder dat attribuut accepteert de unit niets (zie api.js).
if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('open-pdf-studio[host-origin]');
    if (el) koppelIframeBrug(el, window);
  });
}

export { registreer, OpenPdfStudioElement, EVENTS };
export default OpenPdfStudio;
