// Narrow backport of Mozilla PDF.js pull request #22260 (33f87f71b, issue
// #22256), Apache-2.0. The canvas code below is derived from PDF.js,
// Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release containing
// the fix (#637).
//
// #637: PDF.js 6.4.299 componeert elk element van een knockout-groep over het
// HELE groepscanvas: tijdelijk canvas wissen, masker bouwen, destination-out,
// achtergrond terugzetten en de eindtekening lopen over elke pixel, hoe klein
// het element ook is. Een handtekening-appearance met honderden kleine
// vlakken kost bij hoge zoom zo tientallen ms extra. Een gewone vulling (geen
// patroon) tekent niets buiten haar (geknipte) begrenzingsvak, dat fill() al
// berekent; voor zulke elementen beperkt de backport alle passen tot dat vak
// plus één pixel marge voor anti-aliasing. Het tijdelijke canvas wordt voor
// het volgende element alleen gewist waar de vulling tekende. Lijnen,
// afbeeldingen, tekst en patroonvullingen gebruiken nog het hele canvas.
//
// Dit zit in de weergavebibliotheek (pdf.mjs), niet in de worker. De
// Vite-plugin in pdfjs-postscript-progress.mjs past de backport toe in de
// bouw (transform) en in de dev-server (esbuild-voorbundeling).

const PAIRS = [
  [
    '  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1) {\n'
    + '    const {\n      width,\n      height\n    } = sourceCanvas;\n',
    '  #createKnockoutMaskCanvas(sourceCanvas, reuseEntry = null, alpha = 1, rect = null) {\n'
    + '    const {\n      width,\n      height\n    } = sourceCanvas;\n'
    + '    // Only `rect` is read back, so only `rect` needs rebuilding (#637).\n'
    + '    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];\n',
  ],
  [
    '        maskCtx.clearRect(0, 0, width, height);\n'
    + '        maskCtx.restore();\n      }\n'
    + '      maskCtx.filter = knockoutFilter;\n'
    + '      maskCtx.drawImage(sourceCanvas, 0, 0);\n',
    '        maskCtx.clearRect(rx, ry, rw, rh);\n'
    + '        maskCtx.restore();\n      }\n'
    + '      maskCtx.filter = knockoutFilter;\n'
    + '      maskCtx.drawImage(sourceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);\n',
  ],
  [
    '  #getOrCreatePooledEntry(meta, key, width, height) {\n',
    '  #getOrCreatePooledEntry(meta, key, width, height, dirtyRect = null) {\n',
  ],
  [
    '    ctx.clearRect(0, 0, width, height);\n    ctx.restore();\n    return entry;\n  }\n'
    + '  #compositeKnockoutSurface(',
    '    if (dirtyRect) {\n      ctx.clearRect(...dirtyRect);\n    } else {\n'
    + '      ctx.clearRect(0, 0, width, height);\n    }\n'
    + '    ctx.restore();\n    return entry;\n  }\n'
    + '  #compositeKnockoutSurface(',
  ],
  [
    '      knockoutAlpha = 1\n    } = options;\n'
    + '    const {\n      width,\n      height\n    } = surfaceCanvas;\n'
    + '    const knockoutMaskEntry = this.#createKnockoutMaskCanvas(surfaceCanvas, reuseMaskEntry, knockoutAlpha);\n',
    '      knockoutAlpha = 1,\n'
    + '      // Pixel rectangle of surfaceCanvas that holds everything the element\n'
    + '      // painted, or null for all of it. Outside it, every pass below is a\n'
    + '      // no-op: the surface, and so the mask, is transparent there.\n'
    + '      rect = null\n    } = options;\n'
    + '    const {\n      width,\n      height\n    } = surfaceCanvas;\n'
    + '    const [rx, ry, rw, rh] = rect ?? [0, 0, width, height];\n'
    + '    if (rw <= 0 || rh <= 0) {\n      return;\n    }\n'
    + '    const knockoutMaskEntry = this.#createKnockoutMaskCanvas(surfaceCanvas, reuseMaskEntry, knockoutAlpha, rect);\n',
  ],
  [
    '    destCtx.globalCompositeOperation = "destination-out";\n'
    + '    destCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);\n',
    '    destCtx.globalCompositeOperation = "destination-out";\n'
    + '    destCtx.drawImage(knockoutMaskEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);\n',
  ],
  [
    '      const backdropEntry = this.#getOrCreatePooledEntry(poolMeta, "knockoutBackdropEntry", width, height);\n'
    + '      const backdropCtx = backdropEntry.context;\n'
    + '      backdropCtx.drawImage(backdropCanvas, bx, by, width, height, 0, 0, width, height);\n'
    + '      backdropCtx.globalCompositeOperation = "destination-in";\n'
    + '      backdropCtx.drawImage(knockoutMaskEntry.canvas, 0, 0);\n'
    + '      backdropCtx.globalCompositeOperation = "source-over";\n'
    + '      destCtx.globalCompositeOperation = "destination-over";\n'
    + '      destCtx.drawImage(backdropEntry.canvas, 0, 0);\n',
    '      const backdropEntry = this.#getOrCreatePooledEntry(poolMeta, "knockoutBackdropEntry", width, height, rect);\n'
    + '      const backdropCtx = backdropEntry.context;\n'
    + '      backdropCtx.drawImage(backdropCanvas, bx + rx, by + ry, rw, rh, rx, ry, rw, rh);\n'
    + '      // destination-in also clears outside the drawn image: keep it to rect.\n'
    + '      backdropCtx.save();\n'
    + '      backdropCtx.beginPath();\n'
    + '      backdropCtx.rect(rx, ry, rw, rh);\n'
    + '      backdropCtx.clip();\n'
    + '      backdropCtx.globalCompositeOperation = "destination-in";\n'
    + '      backdropCtx.drawImage(knockoutMaskEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);\n'
    + '      backdropCtx.restore();\n'
    + '      backdropCtx.globalCompositeOperation = "source-over";\n'
    + '      destCtx.globalCompositeOperation = "destination-over";\n'
    + '      destCtx.drawImage(backdropEntry.canvas, rx, ry, rw, rh, rx, ry, rw, rh);\n',
  ],
  [
    '    destCtx.drawImage(surfaceCanvas, 0, 0);\n    destCtx.restore();\n    if (!reuseMaskEntry) {\n',
    '    destCtx.drawImage(surfaceCanvas, rx, ry, rw, rh, rx, ry, rw, rh);\n    destCtx.restore();\n    if (!reuseMaskEntry) {\n',
  ],
  [
    '    const tempEntry = this.#getOrCreatePooledEntry(groupMeta, "knockoutTempEntry", canvas.width, canvas.height);\n',
    '    // Only the previous element\'s pixels need clearing (#637).\n'
    + '    const tempEntry = this.#getOrCreatePooledEntry(groupMeta, "knockoutTempEntry", canvas.width, canvas.height, groupMeta?.knockoutTempDirtyRect);\n'
    + '    if (groupMeta) {\n      groupMeta.knockoutTempDirtyRect = null;\n    }\n',
  ],
  [
    '  #endKnockoutElement(started) {\n    if (!started) {\n      return;\n    }\n'
    + '    const tempEntry = this.#knockoutTempCanvasEntry;\n',
    '  #endKnockoutElement(started, clippedBox = null, paintedBox = null) {\n    if (!started) {\n      return;\n    }\n'
    + '    const tempEntry = this.#knockoutTempCanvasEntry;\n'
    + '    const {\n      width: tempWidth,\n      height: tempHeight\n    } = tempEntry.canvas;\n'
    + '    // Pixel rectangle around a device-space box, with one pixel of margin\n'
    + '    // for anti-aliasing; null (unknown) means the whole canvas.\n'
    + '    const toRect = box => {\n'
    + '      if (!box) {\n        return null;\n      }\n'
    + '      const x0 = MathClamp(Math.floor(box[0]) - 1, 0, tempWidth);\n'
    + '      const y0 = MathClamp(Math.floor(box[1]) - 1, 0, tempHeight);\n'
    + '      const x1 = MathClamp(Math.ceil(box[2]) + 1, x0, tempWidth);\n'
    + '      const y1 = MathClamp(Math.ceil(box[3]) + 1, y0, tempHeight);\n'
    + '      return [x0, y0, x1 - x0, y1 - y0];\n'
    + '    };\n'
    + '    // The group canvas has the clip, so compositing outside the clipped box\n'
    + '    // changes nothing, but the next element must find the temp canvas clear\n'
    + '    // wherever this one painted.\n'
    + '    const rect = toRect(clippedBox);\n'
    + '    const dirtyRect = paintedBox ? toRect(paintedBox) : null;\n',
  ],
  [
    '        knockoutAlpha\n      });\n    } finally {\n      tempCtx.restore();\n',
    '        knockoutAlpha,\n        rect\n      });\n    } finally {\n'
    + '      if (groupMeta) {\n        groupMeta.knockoutTempDirtyRect = dirtyRect;\n      }\n'
    + '      tempCtx.restore();\n',
  ],
  [
    '    const intersect = this.current.getClippedPathBoundingBox();\n'
    + '    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.fill);\n',
    '    const intersect = this.current.getClippedPathBoundingBox();\n'
    + '    // What the fill paints on a knockout element\'s temp canvas, which does\n'
    + '    // not get the clip; consumePath resets the path\'s box.\n'
    + '    const pathBox = started ? this.current.getPathBoundingBox() : null;\n'
    + '    this.dependencyTracker?.recordDependencies(opIdx, Dependencies.fill);\n',
  ],
  [
    '    if (consumePath) {\n      this.consumePath(opIdx, path, intersect);\n    }\n'
    + '    this.#endKnockoutElement(started);\n  }\n  eoFill(opIdx, path) {\n',
    '    if (consumePath) {\n      this.consumePath(opIdx, path, intersect);\n    }\n'
    + '    // A plain fill paints nothing outside its path\'s bounding box.\n'
    + '    if (isPatternFill) {\n      this.#endKnockoutElement(started);\n    } else {\n'
    + '      this.#endKnockoutElement(started, intersect ?? [0, 0, 0, 0], pathBox);\n    }\n'
    + '  }\n  eoFill(opIdx, path) {\n',
  ],
  [
    '      knockoutTempEntry: null,\n      knockoutBackdropEntry: null\n    });\n',
    '      knockoutTempEntry: null,\n      knockoutTempDirtyRect: null,\n      knockoutBackdropEntry: null\n    });\n',
  ],
];

const MARKER = 'knockoutTempDirtyRect';

function fail() {
  throw new Error('PDF.js knockout-bounds backport no longer matches; qualify pdf.mjs before updating PDF.js (#637).');
}

export function patchKnockoutBounds(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched library.
  if (source.includes(MARKER)) {
    for (const [before, after] of PAIRS) {
      if (source.split(after).length !== 2 || (!after.includes(before) && source.includes(before))) fail();
    }
    return source;
  }
  let out = source;
  for (const [before] of PAIRS) {
    if (out.split(before).length !== 2) fail();
  }
  for (const [before, after] of PAIRS) out = out.replace(before, after);
  return out;
}

// Welke modules de backport krijgen: de weergavebibliotheek van pdfjs-dist,
// legacy (app) of modern (webunit). De .min-varianten gebruikt niemand.
export const PDFJS_DISPLAY_MODULE = /[\\/]pdfjs-dist[\\/](legacy[\\/])?build[\\/]pdf\.mjs$/;
