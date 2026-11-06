// Narrow backport of Mozilla PDF.js #22380 (f70fabbe7), Apache-2.0.
// The sampled-function reader below is derived from PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release containing the fix.
//
// #949: PDF.js 6.4.299 leest de samples van een Type 0 (sampled) functie met
// `codeBuf >> codeSize`, een signed 32-bit shift. Bij /BitsPerSample 32 wordt
// een sample met de hoogste bit gezet (0x80000000..0xffffffff) negatief en
// klemt het op de onderkant van /Range: zwarte verlopen en verkeerde
// tint-transformaties. Een unsigned shift (`>>>`) geeft de juiste waarde;
// voor 1..24 bits verandert er niets (codeBuf blijft dan positief).

const BEFORE = '      array[i] = (codeBuf >> codeSize) * sampleMul;\n';
const AFTER = '      // Use an unsigned shift, since `codeBuf` can have the high bit set for\n'
  + '      // 32 bits-per-sample data.\n'
  + '      array[i] = (codeBuf >>> codeSize) * sampleMul;\n';

export function patchSampledFunction32(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched worker.
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2) {
    throw new Error('PDF.js 32-bit sampled-function backport no longer matches; qualify the worker before updating PDF.js (#949).');
  }
  return source.replace(BEFORE, AFTER);
}
