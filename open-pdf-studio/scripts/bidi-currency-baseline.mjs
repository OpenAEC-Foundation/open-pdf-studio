// Alleen de #1266-tak verwijderen: alle eerdere productiebackports blijven aan.
import { patchPdfjsWorker } from './pdfjs-postscript-progress.mjs';
export function previousCurrencyWorker(source) {
  const fixed = patchPdfjsWorker(source);
  const branch = '    } else if (0x20a0 <= charCode && charCode <= 0x20cf) {\n      charType = "ET"; // Currency Symbols: Unicode Bidi_Class (#1266).\n';
  if (fixed.split(branch).length !== 2) throw new Error('Currency baseline no longer matches');
  return fixed.replace(branch, '');
}
