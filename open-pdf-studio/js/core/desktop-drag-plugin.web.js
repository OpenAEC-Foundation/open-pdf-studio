// Webvervanger van desktop-drag-plugin.js (#776): geen sleepplugin, dus de
// tab valt terug op losmaken naar een nieuwe instantie.

/** @returns {Promise<null>} */
export function laadDesktopDragPlugin() {
  return Promise.resolve(null);
}
