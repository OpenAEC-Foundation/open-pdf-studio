// Ongedefinieerde namen in de broncode.
//
// Een verkeerd gespelde of hernoemde variabele (een ReferenceError pas tijdens
// opslaan of tekst bewerken) ontgaat `vite build`, `node --check` en de unit-
// tests: die laden bijvoorbeeld saver.js en text-edit-tool.js niet. TypeScript
// ziet het wel. Elk bestand wordt los gelezen (noResolve), met alleen de ES-
// en DOM-globals; een naam die daar niet in staat en niet gedeclareerd of
// geïmporteerd is, telt als fout.

import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const hier = path.dirname(fileURLToPath(import.meta.url));

// Door de build ingevuld (vite.config.js define).
const BUILD_CONSTANTEN = new Set(['__APP_VERSION__']);

function bronbestanden(map) {
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...bronbestanden(p));
    else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) uit.push(p);
  }
  return uit;
}

test('de broncode gebruikt geen ongedefinieerde namen', () => {
  const bestanden = bronbestanden(hier);
  const eigen = new Set(bestanden.map((b) => path.normalize(b)));
  const programma = ts.createProgram(bestanden, {
    allowJs: true, checkJs: true, noEmit: true, noResolve: true, skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  });
  const fouten = [];
  for (const bron of programma.getSourceFiles().filter((b) => eigen.has(path.normalize(b.fileName)))) {
    for (const d of programma.getSemanticDiagnostics(bron)) {
      if (d.code !== 2304 && d.code !== 2552) continue;
      const naam = bron.text.slice(d.start, d.start + d.length);
      if (BUILD_CONSTANTEN.has(naam)) continue;
      const { line } = bron.getLineAndCharacterOfPosition(d.start);
      const regel = bron.text.split('\n')[line].trim();
      if (regel.startsWith('*') || regel.startsWith('//')) continue; // JSDoc of commentaar
      fouten.push(`${path.relative(hier, bron.fileName)}:${line + 1} ${naam}`);
    }
  }
  assert.deepEqual(fouten, []);
});
