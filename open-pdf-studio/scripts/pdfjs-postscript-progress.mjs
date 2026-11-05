// Narrow backport of Mozilla PDF.js #22365 (e7aa97b49), Apache-2.0.
// The lexer methods below are derived from PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release containing the fix.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { patchXrefStreamOffsets } from './pdfjs-xref-offsets.mjs';
import { patchSampledFunction32 } from './pdfjs-sampled-function.mjs';
import { patchBidiCombiningMarks } from './pdfjs-bidi-marks.mjs';
import { patchFormXObjectCache } from './pdfjs-form-xobject-cache.mjs';
import { patchKnockoutBounds, PDFJS_DISPLAY_MODULE } from './pdfjs-knockout-bounds.mjs';

const BEFORE = String.raw`  _getNumber() {
    this._numberPattern.lastIndex = this.pos;
    const match = this._numberPattern.exec(this.data);
    if (!match) {
      return new Token(TOKEN.number, 0);
    }
    const number = parseFloat(match[0]);
    if (!Number.isFinite(number)) {
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._numberPattern.lastIndex;
    return new Token(TOKEN.number, number);
  }
  _getOperator() {
    this._identifierPattern.lastIndex = this.pos;
    const match = this._identifierPattern.exec(this.data);
    if (!match) {
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._identifierPattern.lastIndex;
    const op = match[0];
    const token = lexer_Lexer.#operatorSingletons[op];
    return token ?? new Token(TOKEN.number, 0);
  }
`;
const AFTER = String.raw`  _getNumber() {
    this._numberPattern.lastIndex = this.pos;
    const match = this._numberPattern.exec(this.data);
    if (!match) {
      this.pos++;
      return new Token(TOKEN.number, 0);
    }
    const number = parseFloat(match[0]);
    this.pos = this._numberPattern.lastIndex;
    return new Token(TOKEN.number, Number.isFinite(number) ? number : 0);
  }
  _getOperator() {
    this._identifierPattern.lastIndex = this.pos;
    const match = this._identifierPattern.exec(this.data);
    if (!match) {
      this.pos++;
      return new Token(TOKEN.number, 0);
    }
    this.pos = this._identifierPattern.lastIndex;
    const op = match[0];
    const token = lexer_Lexer.#operatorSingletons[op];
    return token ?? new Token(TOKEN.number, 0);
  }
`;

export function patchPostscriptProgress(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched worker.
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2) {
    throw new Error('PDF.js PostScript backport no longer matches; qualify the worker before updating PDF.js (#839).');
  }
  return source.replace(BEFORE, AFTER);
}

// Mozilla PDF.js #22384, d7fd526d5e5176ccd6f066fc6b48d45ee1560af7.
// Apache-2.0, Copyright Mozilla Foundation. The initial font can be null
// after zero-size text; preserve all subsequent visible text (#878).
const ZERO_FONT_BEFORE = 'currentTextState.font.name !== textState.font.name';
const ZERO_FONT_AFTER = 'currentTextState.font?.name !== textState.font.name';
export function patchZeroInitialFont(source) {
  if (source.split(ZERO_FONT_AFTER).length === 2 && !source.includes(ZERO_FONT_BEFORE)) return source;
  if (source.split(ZERO_FONT_BEFORE).length !== 2 || source.includes(ZERO_FONT_AFTER)) {
    throw new Error('PDF.js zero-font backport no longer matches; qualify the worker before updating PDF.js (#878).');
  }
  return source.replace(ZERO_FONT_BEFORE, ZERO_FONT_AFTER);
}

// Every backport the shipped worker needs; each one fails closed on drift.
// #839: PostScript lexer progress (PDF.js #22365). #878: zero-size initial
// font in text extraction (PDF.js #22384). #638: XRef stream offsets above
// 2 GiB (PDF.js #22172, see pdfjs-xref-offsets.mjs). #949: 32-bit samples
// in Type 0 functions (PDF.js #22380, see pdfjs-sampled-function.mjs). #957:
// combining marks typed NSM in bidi (see pdfjs-bidi-marks.mjs). #636:
// decoded Form XObject bytes cached per page operation (PDF.js #22265, see
// pdfjs-form-xobject-cache.mjs).
export function patchPdfjsWorker(source) {
  return patchFormXObjectCache(patchBidiCombiningMarks(patchSampledFunction32(
    patchXrefStreamOffsets(patchZeroInitialFont(patchPostscriptProgress(source))))));
}

// Every backport the display library (pdf.mjs, main thread) needs. #637:
// knockout-group fills composited within their bounds (PDF.js #22260, see
// pdfjs-knockout-bounds.mjs).
export function patchPdfjsDisplay(source) {
  return patchKnockoutBounds(source);
}

// `workerPath` is the pdfjs-dist worker to patch: the app uses the legacy
// build (pdfjs-dist is aliased to it in vite.config.js), the separate web unit
// (vite.web-unit.config.js) the modern build. Every pattern matches both.
export function pdfjsPostscriptProgress({ workerPath = 'legacy/build/pdf.worker.mjs' } = {}) {
  let worker;
  let devPath;
  let build;
  let displayPatched = false;
  const virtualId = 'virtual:opds-pdfjs-worker-url';
  return {
    name: 'opds-pdfjs-postscript-progress',
    configResolved(config) {
      build = config.command === 'build';
      const require = createRequire(resolve(config.root, 'package.json'));
      const version = JSON.parse(readFileSync(require.resolve('pdfjs-dist/package.json'), 'utf8')).version;
      if (version !== '6.4.299') throw new Error(`Qualify PDF.js ${version} before removing the #839, #878, #638, #949, #957, #636 and #637 backports.`);
      worker = patchPdfjsWorker(readFileSync(require.resolve(`pdfjs-dist/${workerPath}`), 'utf8'));
      devPath = `${config.base.startsWith('/') ? config.base : '/'}node_modules/pdfjs-dist/${workerPath}`;
    },
    config() {
      // Dev: pdfjs-dist wordt door esbuild voorgebundeld, buiten de
      // transform-hook om; deze esbuild-plugin patcht pdf.mjs daar (#637).
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [{
              name: 'opds-pdfjs-display',
              setup(b) {
                b.onLoad({ filter: PDFJS_DISPLAY_MODULE }, args => ({
                  contents: patchPdfjsDisplay(readFileSync(args.path, 'utf8')),
                  loader: 'js',
                }));
              },
            }],
          },
        },
      };
    },
    transform(code, id) {
      // Bouw (en dev zonder voorbundeling): de weergavebibliotheek zelf.
      if (!PDFJS_DISPLAY_MODULE.test(id.split('?')[0])) return null;
      displayPatched = true;
      return { code: patchPdfjsDisplay(code), map: null };
    },
    generateBundle(_options, bundle) {
      // Fail closed: zit pdf.mjs in de bundel, dan moet hij gepatcht zijn.
      const shipped = Object.values(bundle).some(chunk => chunk.type === 'chunk'
        && Object.keys(chunk.modules ?? {}).some(id => PDFJS_DISPLAY_MODULE.test(id.split('?')[0])));
      if (shipped && !displayPatched) this.error('PDF.js display library shipped without the #637 backport.');
    },
    configureServer(server) {
      // loader.js uses this literal URL in dev; never modify shared node_modules.
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== devPath) return next();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(worker);
      });
    },
    resolveId(id) {
      if (id === virtualId) return '\0' + virtualId;
    },
    load(id) {
      if (id !== '\0' + virtualId) return;
      if (!build) return `export default ${JSON.stringify(devPath)};`;
      // Emit patched bytes BEFORE Rollup computes the asset hash. A previously
      // cached vulnerable worker must never share this URL. The existing old-
      // WebView plugin still transpiles the emitted worker for Chrome 91.
      const ref = this.emitFile({ type: 'asset', name: 'pdf.worker.mjs', source: worker });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}
