// Groottebewaking van de chunk die bij het opstarten laadt (#454). Leest de
// bouwuitvoer in dist/ als die er is en faalt wanneer de entry-chunk boven
// het budget groeit. Zonder bouwuitvoer, of met een bouw die ouder is dan de
// bronnen in js/ (een oude dist/ zegt niets over deze code), wordt de controle
// overgeslagen.
//
// Meten en zien wat er in de chunk zit: node scripts/meet-bundel.mjs
// (zie docs/performance/2026-11-07-opstartbundel.md). Groeit de chunk
// terecht, verhoog het budget dan bewust; vaak hoort een nieuwe functie
// achter een dynamische import() bij het eerste gebruik.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { meetBundel, opstartChunks, moduleNaam } from './meet-bundel.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
const DIST = path.join(app, 'dist');

// Na #454 (eerste stap): desktop 4532 KiB, gehost 4549 KiB (gzip 1486/1492
// KiB; KiB = 1024 bytes, Vite meldt kB van 1000 tekens).
// Het budget ligt daar iets boven, voor beide bouwvormen.
export const BUDGET_KB = 4700;
export const BUDGET_GZIP_KB = 1550;

/** Het pad (relatief aan dist/) van het module-script in index.html. */
export function entryUitIndex(html) {
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src && /\.m?js(\?|$)/.test(src)) return src.replace(/^\.?\//, '').replace(/\?.*$/, '');
  }
  return null;
}

/** De jongste wijzigingstijd onder een map (alleen bronbestanden). */
function jongsteBron(map) {
  let jongst = 0;
  const rij = [map];
  while (rij.length) {
    const d = rij.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rij.push(p);
      else if (/\.(m?js|jsx|ts|tsx|json|css)$/.test(e.name) && !/\.test\./.test(e.name)) {
        jongst = Math.max(jongst, fs.statSync(p).mtimeMs);
      }
    }
  }
  return jongst;
}

function bouwStatus() {
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) return { overslaan: 'geen bouwuitvoer (dist/index.html); draai eerst npx vite build' };
  const bouwTijd = fs.statSync(index).mtimeMs;
  if (jongsteBron(path.join(app, 'js')) > bouwTijd) return { overslaan: 'dist/ is ouder dan de bronnen in js/; bouw opnieuw om te meten' };
  const entry = entryUitIndex(fs.readFileSync(index, 'utf8'));
  if (!entry) return { overslaan: 'geen module-script in dist/index.html' };
  const bestand = path.join(DIST, entry);
  if (!fs.existsSync(bestand)) return { overslaan: `entry-chunk ${entry} ontbreekt in dist/` };
  return { entry, bestand };
}

test('entryUitIndex vindt het module-script van de desktop- en de gehoste bouw', () => {
  assert.equal(entryUitIndex('<script type="module" crossorigin src="./assets/index-AbC.js"></script>'), 'assets/index-AbC.js');
  assert.equal(entryUitIndex([
    '<script src="/opds-vooraf.js" integrity="sha384-x"></script>',
    '<script type="module" src="/assets/index-B__psz8v.js" integrity="sha384-y" crossorigin="anonymous"></script>',
  ].join('\n')), 'assets/index-B__psz8v.js');
  assert.equal(entryUitIndex('<script src="los.js"></script>'), null);
});

test('meet-bundel telt modules per chunk en volgt de statische imports van de entry', () => {
  const chunks = meetBundel({
    'assets/index.js': { type: 'chunk', fileName: 'assets/index.js', isEntry: true, code: 'abcdef', imports: ['assets/gedeeld.js'],
      modules: { [path.join(app, 'js/main.js')]: { renderedLength: 4 }, '\0virtueel': { renderedLength: 0 } } },
    'assets/gedeeld.js': { type: 'chunk', fileName: 'assets/gedeeld.js', code: 'ab', imports: [], modules: {} },
    'assets/dialoog.js': { type: 'chunk', fileName: 'assets/dialoog.js', isDynamicEntry: true, code: 'abc', imports: ['assets/gedeeld.js'], modules: {} },
    'styles.css': { type: 'asset', fileName: 'styles.css' },
  });
  assert.deepEqual(chunks.map((c) => c.bestand), ['assets/index.js', 'assets/dialoog.js', 'assets/gedeeld.js']);
  assert.deepEqual(chunks[0].modules, [{ id: 'js/main.js', bytes: 4 }]);
  assert.deepEqual(opstartChunks(chunks).map((c) => c.bestand).sort(), ['assets/gedeeld.js', 'assets/index.js']);
  assert.equal(moduleNaam('C:\\x\\node_modules\\pdf-lib\\es\\index.js'), 'npm:pdf-lib/es/index.js');
});

const status = bouwStatus();

test('de entry-chunk blijft binnen het budget', { skip: status.overslaan }, () => {
  const code = fs.readFileSync(status.bestand);
  const kb = code.length / 1024;
  const gzipKb = zlib.gzipSync(code).length / 1024;
  assert.ok(kb <= BUDGET_KB,
    `${status.entry} is ${kb.toFixed(1)} KiB, budget ${BUDGET_KB} KiB. Zie node scripts/meet-bundel.mjs voor de grootste modules.`);
  assert.ok(gzipKb <= BUDGET_GZIP_KB,
    `${status.entry} is gzip ${gzipKb.toFixed(1)} KiB, budget ${BUDGET_GZIP_KB} KiB.`);
});
