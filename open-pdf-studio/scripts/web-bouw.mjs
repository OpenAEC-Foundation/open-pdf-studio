// Welke Vite-bouw draait buiten Tauri, en welke desktopmodules krijgen daar
// een vervanger (#776).
//
// Een webbouw is de gehoste bundel (`--mode hosted`) of de website
// (`OPDS_WEB_BUILD=1 vite build`, .github/workflows/live.yml). De gewone
// `vite build` blijft de desktopbouw: Tauri en flatpak roepen hem zonder
// eigen kenmerk aan, dus de webbouw moet zich melden, niet de desktop.
//
// Vrij van vite, zodat het onder `node --test` te controleren is.

import path from 'node:path';

export const WEB_BOUW_VAR = 'OPDS_WEB_BUILD';

/** Pakketten die alleen in Tauri werken en nooit in een webbundel horen. */
export const DESKTOP_PAKKETTEN = ['@crabnebula/tauri-plugin-drag'];

/**
 * Tekens waaraan code van die pakketten in een bundel te herkennen is: de
 * pakketnaam (ook in THIRD-PARTY-NOTICES.txt) en het Tauri-commando dat de
 * sleepplugin aanroept (blijft over na minificatie).
 */
export const DESKTOP_KENMERKEN = ['tauri-plugin-drag', 'plugin:drag|'];

/** Desktopmodule (relatief aan de app) → webvervanger. */
export const WEB_VERVANGERS = {
  'js/core/desktop-drag-plugin.js': 'js/core/desktop-drag-plugin.web.js',
};

export function isWebBouw(mode, env = process.env) {
  return mode === 'hosted' || env?.[WEB_BOUW_VAR] === '1';
}

const regexVeilig = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Vite-aliassen die in een webbouw elke desktopmodule op zijn vervanger
 * zetten; in de desktopbouw geen. Elke import die op de bestandsnaam eindigt
 * (`../../core/desktop-drag-plugin.js`, `./desktop-drag-plugin.js`) telt.
 */
export function webAliassen(appMap, mode, env = process.env) {
  if (!isWebBouw(mode, env)) return [];
  return Object.entries(WEB_VERVANGERS).map(([desktop, web]) => ({
    find: new RegExp(`^(?:.*/)?${regexVeilig(path.posix.basename(desktop))}$`),
    replacement: path.join(appMap, ...web.split('/')),
  }));
}
