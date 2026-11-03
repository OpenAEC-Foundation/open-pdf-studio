// Narrow backport of Mozilla PDF.js #22380, f70fabbe791d151b720451c239564237855814a5.
// Derived from PDF.js, Copyright Mozilla Foundation, Apache-2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// Keep until a newer pdfjs-dist release is qualified with the rendering regression.
const BEFORE = `      codeSize -= bps;
      array[i] = (codeBuf >> codeSize) * sampleMul;
      codeBuf &= (1 << codeSize) - 1;`;
const AFTER = BEFORE.replace('codeBuf >> codeSize', 'codeBuf >>> codeSize');

export function patchSampledFunctions(source) {
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2 || source.includes(AFTER)) {
    throw new Error('PDF.js sampled-function backport no longer matches; qualify the worker before updating PDF.js (#949).');
  }
  return source.replace(BEFORE, AFTER);
}
