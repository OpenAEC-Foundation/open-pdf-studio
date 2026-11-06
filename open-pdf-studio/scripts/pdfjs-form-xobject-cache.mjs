// Narrow backport of the decoded-stream cache proposed for Mozilla PDF.js in
// pull request #22265 (4ede6d614, issue #22264), Apache-2.0. The evaluator
// code below is derived from PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release that no
// longer decodes a repeated Form XObject for every `Do` (#636).
//
// #636: PDF.js 6.4.299 haalt een Form XObject bij ELKE `Do` opnieuw uit de
// xref en pakt een asynchrone (Flate/Brotli) stream dan telkens opnieuw uit
// via DecompressionStream. Een dicht puntenwolk-diagram of een symbool dat
// duizenden keren op een blad staat, kost zo duizenden decompressies van
// dezelfde bytes. Upstream heeft het geval later indirect verlicht (kleine
// streams synchroon uitpakken, PR #22273); deze backport cachet de
// uitgepakte bytes per objectnummer, zoals #22265 voorstelt.
//
// Twee aanpassingen t.o.v. het voorstel, beide om het geheugen te begrenzen:
//  - de cache hoort bij de PartialEvaluator, en PDF.js maakt die per
//    paginabewerking (operatorlijst, tekstinhoud, annotatie) aan; hij leeft
//    dus nooit langer dan die ene pagina-operatie;
//  - het totaal aan gecachete bytes is begrensd (FORM_CACHE_MAX_BYTES); een
//    stream die er niet meer in past, wordt gewoon elke keer uitgepakt, zoals
//    voorheen. Klonen (`clone()`) delen dezelfde cache via het prototype.
// Gecachet worden alleen de uitgepakte bytes, nooit een Stream-object: elke
// aanroep krijgt een nieuwe Stream met eigen leespositie over dezelfde bytes.

export const FORM_CACHE_MAX_BYTES = 64 * 1024 * 1024;

const CTOR_BEFORE = '    this._regionalImageCache = new RegionalImageCache();\n'
  + '    this._fetchBuiltInCMapBound = this.fetchBuiltInCMap.bind(this);\n'
  + '  }\n';
const CTOR_AFTER = '    this._regionalImageCache = new RegionalImageCache();\n'
  + '    this._decodedStreamCache = { entries: new Map(), bytes: 0 };\n'
  + '    this._fetchBuiltInCMapBound = this.fetchBuiltInCMap.bind(this);\n'
  + '  }\n'
  + '  async _getDecodedStream(stream) {\n'
  + '    // Form XObjects are fetched anew for every `Do` operator, hence cache\n'
  + '    // the decoded data by reference to avoid decompressing it more than\n'
  + '    // once per page operation (#636, bounded).\n'
  + '    const cache = this._decodedStreamCache;\n'
  + '    const objId = stream.dict?.objId;\n'
  + '    let bytes = objId && cache.entries.get(objId);\n'
  + '    if (!bytes) {\n'
  + '      bytes = await stream.asyncGetBytes();\n'
  + '      if (!bytes) {\n'
  + '        return stream;\n'
  + '      }\n'
  + `      if (objId && cache.bytes + bytes.length <= ${FORM_CACHE_MAX_BYTES}) {\n`
  + '        cache.entries.set(objId, bytes);\n'
  + '        cache.bytes += bytes.length;\n'
  + '      }\n'
  + '    }\n'
  + '    return new Stream(bytes, 0, bytes.length, stream.dict);\n'
  + '  }\n';

const DECODE_BEFORE = '    if (stream.isAsync) {\n'
  + '      const bytes = await stream.asyncGetBytes();\n'
  + '      if (bytes) {\n'
  + '        stream = new Stream(bytes, 0, bytes.length, stream.dict);\n'
  + '      }\n'
  + '    }\n';
const DECODE_AFTER = '    if (stream.isAsync) {\n'
  + '      stream = await this._getDecodedStream(stream);\n'
  + '    }\n';
// De twee aanroepplaatsen: getOperatorList en getTextContent.
const SITES = ['    prevRefs = null\n  }) {\n', '    intersector = null\n  }) {\n'];

function fail() {
  throw new Error('PDF.js Form XObject cache backport no longer matches; qualify the worker before updating PDF.js (#636).');
}

export function patchFormXObjectCache(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched worker.
  const patched = source.split(CTOR_AFTER).length === 2
    && SITES.every(site => source.split(site + DECODE_AFTER).length === 2);
  if (patched) {
    if (source.includes(CTOR_BEFORE) || source.includes(DECODE_BEFORE)) fail();
    return source;
  }
  if (source.split(CTOR_BEFORE).length !== 2 || source.split(DECODE_BEFORE).length !== 3
    || source.includes('_getDecodedStream')) fail();
  let out = source.replace(CTOR_BEFORE, CTOR_AFTER);
  for (const site of SITES) {
    if (out.split(site + DECODE_BEFORE).length !== 2) fail();
    out = out.replace(site + DECODE_BEFORE, site + DECODE_AFTER);
  }
  return out;
}
