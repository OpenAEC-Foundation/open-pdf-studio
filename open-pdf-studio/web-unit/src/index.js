// Entry van het bouwdoel `web-unit`. Eén script dat het element registreert en,
// als de unit in een iframe staat, de postMessage-brug aanhaakt.

import { registreer, OpenPdfStudioElement } from './element.js';
import { koppelIframeBrug } from './iframe-brug.js';

registreer();

// In een iframe hangt de brug automatisch aan het eerste element met een
// `host-origin`; zonder dat attribuut accepteert de unit niets (zie api.js).
if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('DOMContentLoaded', () => {
    const el = document.querySelector('open-pdf-studio[host-origin]');
    if (el) koppelIframeBrug(el, window);
  });
}

export { registreer, OpenPdfStudioElement, koppelIframeBrug };
