// Narrow backport of Mozilla PDF.js #22365 (e7aa97b49), Apache-2.0.
// The lexer methods below are derived from PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release containing the fix.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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

export function pdfjsPostscriptProgress() {
  let worker;
  let devPath;
  let build;
  const virtualId = 'virtual:opds-pdfjs-worker-url';
  return {
    name: 'opds-pdfjs-postscript-progress',
    configResolved(config) {
      build = config.command === 'build';
      const require = createRequire(resolve(config.root, 'package.json'));
      const version = JSON.parse(readFileSync(require.resolve('pdfjs-dist/package.json'), 'utf8')).version;
      if (version !== '6.4.299') throw new Error(`Qualify PDF.js ${version} before removing the #839 backport.`);
      worker = patchPostscriptProgress(readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8'));
      devPath = `${config.base.startsWith('/') ? config.base : '/'}node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`;
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
