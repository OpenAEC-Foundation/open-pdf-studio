// #1028: lokale, gekwalificeerde display-fix voor PDF.js 6.4.299.
// Gebaseerd op het voorstel in Mozilla PDF.js #22480 (848363523c), dat NIET
// upstream is gemerged. Apache-2.0, Copyright Mozilla Foundation.
// https://www.apache.org/licenses/LICENSE-2.0
// Een volledig buiten het broncanvas vallende drawImage doet niets, ook met
// destination-in. Een transparant masker moet de betreffende inhoud juist
// verwijderen. Sla de scratch-layer-blit over, of wis alleen het dirty-vak
// bij in-place masking. Niet-nul buitenalpha houdt de bestaande verwerking.
// Verwijder pas na kwalificatie van een PDF.js-versie met dezelfde correctie.
const BEFORE = `    const preparedEntry = this.smaskPreparedEntry;
    if (preparedEntry) {`;
const AFTER = `    const preparedEntry = this.smaskPreparedEntry;
    // Zero-alpha soft masks must also hide fully disjoint content (#1028).
    if (this.smaskPreparedOOBAlpha === null) {
      const mask = preparedEntry?.canvas ?? smask.canvas;
      const maskX = preparedEntry ? this.smaskPreparedOffsetX : smask.offsetX;
      const maskY = preparedEntry ? this.smaskPreparedOffsetY : smask.offsetY;
      if (layerBox[2] <= maskX || layerOffsetX >= maskX + mask.width ||
          layerBox[3] <= maskY || layerOffsetY >= maskY + mask.height) {
        // compose() clears a separate scratch layer after skipping its blit.
        // In-place masking must clear this element, preserving other pixels.
        if (!ctx) {
          layerCtx.save();
          layerCtx.setTransform(1, 0, 0, 1, 0, 0);
          layerCtx.clearRect(layerOffsetX, layerOffsetY, layerWidth, layerHeight);
          layerCtx.restore();
        }
        return;
      }
    }
    if (preparedEntry) {`;

export function patchSoftMaskBounds(source) {
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2 || source.includes('Zero-alpha soft masks must')) {
    throw new Error('PDF.js soft-mask bounds fix no longer matches; qualify pdf.mjs before updating PDF.js (#1028).');
  }
  return source.replace(BEFORE, AFTER);
}
