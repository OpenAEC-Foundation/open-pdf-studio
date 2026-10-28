// De enige plek die @crabnebula/tauri-plugin-drag laadt (tab naar een ander
// venster of programma slepen, #335). Die plugin werkt alleen in Tauri en
// heeft geen licentieveld in zijn npm-pakket. In elke webbouw (gehost, of de
// website met OPDS_WEB_BUILD=1) vervangt Vite deze module door
// desktop-drag-plugin.web.js, zodat de plugin niet in de bundel komt (#776).
// Zie scripts/web-bouw.mjs.

/** @returns {Promise<{ startDrag: Function } | null>} */
export function laadDesktopDragPlugin() {
  return import('@crabnebula/tauri-plugin-drag').catch(() => null);
}
