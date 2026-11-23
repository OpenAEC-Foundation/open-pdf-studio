// Pure hatch-pattern catalog for PDF appearance-stream (/AP) generation.
//
// This is a DATA-ONLY mirror of the line-family definitions in
// js/annotations/rendering/hatch-patterns.js. It is kept separate and
// dependency-free (no state/canvas/DOM imports) so the appearance-stream
// builder can run both in the browser (saver) AND in headless Node test
// harnesses that render the resulting PDF with an external engine.
//
// Keep the family definitions in sync with rendering/hatch-patterns.js when
// patterns change. Each entry is a list of line families:
//   { angle, originX, originY, deltaX, deltaY, dashPattern?, strokeWidth? }
// An empty lineFamilies array means "solid fill".

export const HATCH_LINE_FAMILIES = {
  // basic
  'horizontal': [{ angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }],
  'vertical': [{ angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }],
  'grid': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ],
  'solid': [],
  // hatching
  'diagonal-left': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }],
  'diagonal-right': [{ angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }],
  'crosshatch': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ],
  'dots': [{ angle: 0, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [0] }],
  // material
  'concrete': [
    { angle: 37, originX: 0, originY: 0, deltaX: 3, deltaY: 8, dashPattern: [0] },
    { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 12, dashPattern: [0] },
    { angle: 70, originX: 2, originY: 7, deltaX: 7, deltaY: 10, dashPattern: [0] },
  ],
  'brick-running': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
  ],
  'brick-stack': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 20 },
  ],
  'insulation': [
    { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
  ],
  'earth': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 12, dashPattern: [6, -3, 2, -3] },
    { angle: 0, originX: 0, originY: 0, deltaX: 6, deltaY: 10, dashPattern: [0] },
  ],
  'sand': [
    { angle: 0, originX: 0, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [0] },
    { angle: 60, originX: 3, originY: 2, deltaX: 6, deltaY: 8, dashPattern: [0] },
    { angle: 120, originX: 1, originY: 4, deltaX: 8, deltaY: 7, dashPattern: [0] },
  ],
  'gravel': [
    { angle: 30, originX: 0, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [3, -5] },
    { angle: -30, originX: 6, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [2, -6] },
    { angle: 80, originX: 2, originY: 4, deltaX: 6, deltaY: 10, dashPattern: [0] },
  ],
  'water': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 8 },
    { angle: 0, originX: 0, originY: 4, deltaX: 0, deltaY: 16, dashPattern: [8, -4] },
  ],
  'clay': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 6, dashPattern: [12, -4] },
    { angle: 0, originX: 8, originY: 3, deltaX: 0, deltaY: 6, dashPattern: [6, -10] },
  ],
  'wood-grain': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: 0, originX: 0, originY: 2, deltaX: 0, deltaY: 12, dashPattern: [15, -8] },
  ],
  'plywood': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 15, dashPattern: [4, -8] },
  ],
  'timber-section': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10, dashPattern: [3, -7] },
  ],
  'steel-section': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'aluminum': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: 45, originX: 0, originY: 1.5, deltaX: 0, deltaY: 6, dashPattern: [4, -4] },
  ],
  'stone-block': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 20 },
    { angle: 90, originX: 0, originY: 0, deltaX: 30, deltaY: 40, dashPattern: [20, -20] },
    { angle: 45, originX: 5, originY: 5, deltaX: 10, deltaY: 20, dashPattern: [3, -17] },
  ],
  'cut-stone': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 15 },
    { angle: 90, originX: 0, originY: 0, deltaX: 25, deltaY: 30, dashPattern: [15, -15] },
  ],
  'staal-dubbel': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
    { angle: 45, originX: 0, originY: 2, deltaX: 0, deltaY: 6 },
  ],
  'raster-liggend': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ],
  'raster-staand': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
  ],
  'tegel-halfsteens': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
  ],
  'plank-halfsteens': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 10, deltaY: 20, dashPattern: [10, -10] },
  ],
  'grond-blokjes': [
    { angle: 90, originX: 0, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
    { angle: 90, originX: 2, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
    { angle: 90, originX: 4, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
    { angle: 0, originX: 6, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
    { angle: 0, originX: 6, originY: 2, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
    { angle: 0, originX: 6, originY: 4, deltaX: 6, deltaY: 6, dashPattern: [4, -8] },
  ],
  'glas-strepen': [
    { angle: 45, originX: 0, originY: 2, deltaX: 0, deltaY: 20, dashPattern: [4, -16] },
    { angle: 45, originX: 0, originY: 4, deltaX: 0, deltaY: 20, dashPattern: [10, -10] },
    { angle: 45, originX: 0, originY: 6, deltaX: 0, deltaY: 20, dashPattern: [4, -16] },
  ],
  'vloeistof-strepen': [
    { angle: 0, originX: 0, originY: 1, deltaX: 0, deltaY: 6, dashPattern: [8, -4] },
    { angle: 0, originX: 6, originY: 4, deltaX: 0, deltaY: 6, dashPattern: [8, -4] },
  ],
  'gras-pollen': [
    { angle: 90, originX: 0, originY: 0, deltaX: 12, deltaY: 6, dashPattern: [3, -21] },
    { angle: 45, originX: 0, originY: 0, deltaX: 17, deltaY: 4.2, dashPattern: [3, -31] },
    { angle: -45, originX: 0, originY: 0, deltaX: 17, deltaY: 4.2, dashPattern: [3, -31] },
  ],
  'honingraat': [
    { angle: 0, originX: 0, originY: 0, deltaX: 7.5, deltaY: 4.33, dashPattern: [5, -10] },
    { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 13, dashPattern: [5, -10] },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 13, dashPattern: [5, -10] },
  ],
  'lijnen-groep-verticaal': [
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 0.75, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 1.5, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 2.25, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 3, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 3.75, originY: 0, deltaX: 0, deltaY: 9 },
    { angle: 90, originX: 4.5, originY: 0, deltaX: 0, deltaY: 9 },
  ],
  'lood-blokken': [{ angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 1, dashPattern: [4.5, -4.5] }],
  'glas-doorsnede': [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 4.5 },
    { angle: -18.43, originX: 0, originY: 0, deltaX: 0, deltaY: 4.27 },
  ],
  // geometric
  'diamonds': [
    { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ],
  'herringbone': [
    { angle: 45, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
    { angle: -45, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
  ],
  'basket-weave': [
    { angle: 0, originX: 0, originY: 0, deltaX: 20, deltaY: 10, dashPattern: [10, -10] },
    { angle: 90, originX: 10, originY: 0, deltaX: 10, deltaY: 20, dashPattern: [10, -10] },
  ],
  'zigzag': [
    { angle: 60, originX: 0, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
    { angle: -60, originX: 5, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
  ],
  // nen47
  'nen47-metselwerk-baksteen': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: 45, originX: 0, originY: 0.5, deltaX: 0, deltaY: 3 },
  ],
  'wand-metselwerk': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 36 },
    { angle: 45, originX: 0, originY: 5, deltaX: 0, deltaY: 36 },
  ],
  'nen47-speciale-steenachtige': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ],
  'nen47-metselwerk-kunststeen': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'nen47-lichte-scheidingswand': [{ angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 2 }],
  'nen47-gewapend-beton': [],
  'nen47-beton-prefab': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'nen47-ongewapend-beton': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ],
  'nen47-sierbeton': [
    { angle: 135, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: 135, originX: 0, originY: 1.5, deltaX: 0, deltaY: 3, dashPattern: [1.5, -1.5] },
  ],
  'nen47-natuursteen': [
    { angle: 135, originX: 0, originY: 0, deltaX: 0, deltaY: 3, strokeWidth: 0.15 },
    { angle: 135, originX: 0, originY: 1.5, deltaX: 0, deltaY: 3, dashPattern: [1.5, -1.5], strokeWidth: 0.15 },
  ],
  'nen47-enkele-afwerking': [
    { angle: 45, originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
  ],
  'nen47-samengestelde-afwerking': [
    { angle: 45, originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: 0, originX: 0, originY: 2, deltaX: 0, deltaY: 3 },
  ],
  'nen47-naaldhout': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 6 }],
  'nen47-loofhout': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
  ],
  'nen47-hout-langs': [{ angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'nen47-bekledingsplaat': [{ angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'nen47-isolatie': [
    { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
  ],
  'nen47-staal': [],
  'nen47-aluminium': [],
  'nen47-kunststof': [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 }],
  'nen47-afdichtingsmiddel': [
    { angle: 37, originX: 0, originY: 0, deltaX: 3, deltaY: 4, dashPattern: [0] },
    { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 6, dashPattern: [0] },
    { angle: 70, originX: 2, originY: 7, deltaX: 7, deltaY: 5, dashPattern: [0] },
  ],
  'nen47-maaiveld': [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
  ],
};

// Fallback used when a pattern id is not in the catalog: a simple 45° hatch,
// so an unknown/newer pattern still degrades to a visible fill in other viewers.
const FALLBACK_FAMILIES = [{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }];

// Return the line families for a pattern id. Unknown ids → fallback hatch.
// 'none'/empty → null (caller draws no hatch).
export function getHatchLineFamilies(id) {
  if (!id || id === 'none') return null;
  const fam = HATCH_LINE_FAMILIES[id];
  if (fam === undefined) return FALLBACK_FAMILIES;
  return fam; // may be [] for solid fill
}
