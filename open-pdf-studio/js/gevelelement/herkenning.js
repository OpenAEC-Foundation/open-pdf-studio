// Is deze annotatie een gevelelement, en zo ja met welke voorinstelling?
// Apart van element.js omdat dit de symbolenregistry nodig heeft (en die
// laadt de sjablonen, die zelf weer element.js gebruiken).

import { getTemplate } from '../symbols/registry.js';

/** De voorinstelling ('vliesgevel' | 'kozijn') of null. */
export function gevelPreset(ann) {
  if (!ann || ann.type !== 'parametricSymbol') return null;
  return getTemplate(ann.symbolId)?.gevelelement || null;
}

export function isGevelelement(ann) {
  return gevelPreset(ann) !== null;
}
