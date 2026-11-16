// Productie-pijplijn van main vóór #1078; uitsluitend voor de tegenproef.
import { patchPostscriptProgress, patchZeroInitialFont } from './pdfjs-postscript-progress.mjs';
import { patchXrefStreamOffsets } from './pdfjs-xref-offsets.mjs';
import { patchSampledFunction32 } from './pdfjs-sampled-function.mjs';
import { patchBidiCombiningMarks } from './pdfjs-bidi-marks.mjs';
import { patchFormXObjectCache } from './pdfjs-form-xobject-cache.mjs';

export function previousGlyphWorker(source) {
  return patchFormXObjectCache(patchBidiCombiningMarks(patchSampledFunction32(
    patchXrefStreamOffsets(patchZeroInitialFont(patchPostscriptProgress(source))))));
}
