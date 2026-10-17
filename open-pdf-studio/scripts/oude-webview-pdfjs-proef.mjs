// Proef voor oudere WebViews (#596): draait de echte PDF.js-legacy-build in
// een Node-proces waaruit eerst alles is weggehaald wat Chromium 91 nog niet
// kent. Daarna komen alleen de polyfills van de app erbij
// (js/core/oude-webview.js). Zo blijkt bij elke PDF.js-update of de build
// API's gebruikt waar noch PDF.js zelf (core-js in de legacy-build) noch de
// app een vervanger voor heeft.
//
// Gebruik: node scripts/oude-webview-pdfjs-proef.mjs <pdf> [--zonder-polyfills]
// Uitvoer: één JSON-regel; exitcode 1 bij een fout.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [pdfPad, ...vlaggen] = process.argv.slice(2);
const zonderPolyfills = vlaggen.includes('--zonder-polyfills');

// Node laadt een deel van zijn eigen modules pas bij gebruik, en die gebruiken
// zelf nieuwe API's: eerst laden.
await import('node:http');
await import('node:https');
await import('node:zlib');
await import('node:fs/promises');
void new Response('x');
void globalThis.navigator;

/** Haalt weg wat Chromium 91 (Android 12-WebView) niet heeft. */
export function verwijderNieuweApis(g = globalThis) {
  const weg = (doel, ...namen) => {
    for (const naam of namen) {
      if (doel && Object.getOwnPropertyDescriptor(doel, naam)) delete doel[naam];
    }
  };
  const getypeerd = Object.getPrototypeOf(g.Uint8Array.prototype);
  const iterator = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  weg(g.Promise, 'withResolvers', 'try');
  weg(g.Object, 'hasOwn', 'groupBy');
  weg(g.Map, 'groupBy');
  weg(g.Map.prototype, 'getOrInsert', 'getOrInsertComputed');
  weg(g.WeakMap.prototype, 'getOrInsert', 'getOrInsertComputed');
  for (const proto of [g.Array.prototype, getypeerd]) {
    weg(proto, 'at', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'with');
  }
  weg(g.Array, 'fromAsync');
  weg(g.String.prototype, 'at', 'isWellFormed', 'toWellFormed');
  weg(g, 'structuredClone', 'Iterator', 'Float16Array');
  weg(g.AbortSignal, 'any', 'timeout');
  weg(g.ArrayBuffer.prototype, 'transfer', 'transferToFixedLength', 'resize', 'detached', 'resizable', 'maxByteLength');
  weg(g.ReadableStream.prototype, Symbol.asyncIterator, 'values');
  weg(g.ReadableStream, 'from');
  weg(g.Response.prototype, 'bytes');
  weg(g.Blob.prototype, 'bytes');
  weg(g.Set.prototype, 'union', 'intersection', 'difference', 'symmetricDifference',
    'isSubsetOf', 'isSupersetOf', 'isDisjointFrom');
  weg(iterator, 'map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find', 'join');
  weg(g.Math, 'sumPrecise', 'f16round');
  weg(g.Uint8Array, 'fromBase64', 'fromHex');
  weg(g.Uint8Array.prototype, 'toBase64', 'toHex', 'setFromBase64', 'setFromHex');
  weg(g.URL, 'parse', 'canParse');
  weg(g.RegExp, 'escape');
  weg(g.Error, 'isError');
  weg(g.JSON, 'rawJSON', 'isRawJSON');
  weg(g.DataView.prototype, 'getFloat16', 'setFloat16');
  if (g.crypto) weg(Object.getPrototypeOf(g.crypto), 'randomUUID');
}

verwijderNieuweApis();
let aangevuld = [];
if (!zonderPolyfills) {
  const { installeerPolyfills } = await import(pathToFileURL(path.join(app, 'js/core/oude-webview.js')).href);
  aangevuld = installeerPolyfills(globalThis);
}

const uit = { aangevuld };
/** Map als pad met '/' en een slash aan het eind, zoals PDF.js die eist. */
const map = (deel) => `${path.join(app, deel).replace(/\\/g, '/')}/`;
try {
  const pdfjs = await import(pathToFileURL(path.join(app, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  uit.versie = pdfjs.version;
  const taak = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPad)), isEvalSupported: false, verbosity: 0,
    cMapUrl: map('node_modules/pdfjs-dist/cmaps'), cMapPacked: true,
    standardFontDataUrl: map('node_modules/pdfjs-dist/standard_fonts'),
  });
  const doc = await taak.promise;
  const pagina = await doc.getPage(1);
  uit.paginas = doc.numPages;
  uit.tekst = (await pagina.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  uit.operatoren = (await pagina.getOperatorList()).fnArray.length;
  uit.annotaties = (await pagina.getAnnotations()).length;
  // Renderen als @napi-rs/canvas er is (optionele afhankelijkheid van pdfjs-dist).
  let canvasLib = null;
  try { canvasLib = createRequire(path.join(app, 'package.json'))('@napi-rs/canvas'); } catch { canvasLib = null; }
  if (canvasLib) {
    const viewport = pagina.getViewport({ scale: 0.5 });
    const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await pagina.render({ canvas, canvasContext: ctx, viewport, background: 'white' }).promise;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let inkt = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) inkt++;
    uit.inkt = inkt;
  }
  await taak.destroy();
  uit.ok = true;
} catch (e) {
  uit.ok = false;
  uit.fout = String(e?.message || e);
}
console.log(JSON.stringify(uit));
process.exit(uit.ok ? 0 : 1);
