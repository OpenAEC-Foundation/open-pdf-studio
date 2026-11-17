// Updateroute: beheerd, draagbaar of de eigen updater. De app start of
// gebruikt geen ander programma om zichzelf bij te werken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateRoute } from './update-route.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wortel = path.resolve(hier, '..', '..', '..');
const lees = (...delen) => fs.readFileSync(path.join(wortel, ...delen), 'utf8');

test('route: beheerd gaat voor draagbaar, anders de eigen updater', () => {
  assert.equal(updateRoute(), 'eigen');
  assert.equal(updateRoute({ draagbaar: true }), 'draagbaar');
  assert.equal(updateRoute({ beheerd: true }), 'beheerd');
  assert.equal(updateRoute({ beheerd: true, draagbaar: true }), 'beheerd');
});

test('updater.js: beheerde modus eerst, daarna alleen de eigen updater', () => {
  const src = lees('js', 'ui', 'chrome', 'updater.js');
  assert.ok(src.indexOf("magMelden('update-controle')") < src.indexOf('updateRoute('), 'beheerd wordt eerst gevraagd');
  assert.match(src, /const update = await check\(\);/);
  assert.doesNotMatch(src, /plugin:openaec-update|installer_present|update_now/);
});

test('de app kent geen updateprogramma van buiten: geen plugin, geen aanroep, geen afhankelijkheid', () => {
  const lib = lees('src-tauri', 'src', 'lib.rs');
  assert.doesNotMatch(lib, /openaec_update|openaec-update/);
  assert.doesNotMatch(lees('src-tauri', 'Cargo.toml'), /openaec-update|openaec-installer/);
  for (const map of ['js', path.join('src-tauri', 'capabilities')]) {
    const stapel = [path.join(wortel, map)];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') stapel.push(p); continue; }
        if (!/\.(js|jsx|ts|tsx|json)$/.test(e.name) || p === fileURLToPath(import.meta.url)) continue;
        assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /plugin:openaec-update/, p);
      }
    }
  }
});
