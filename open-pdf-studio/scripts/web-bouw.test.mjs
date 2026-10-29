// Unit-tests voor het weglaten van desktopmodules uit elke webbouw (#776):
// welke bouw een webbouw is, de Vite-alias naar de vervanger, en de
// controle van de bundel op code van de sleepplugin.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DESKTOP_KENMERKEN, DESKTOP_PAKKETTEN, WEB_VERVANGERS, isWebBouw, webAliassen } from './web-bouw.mjs';
import { zoekDesktopCode } from './webbundel.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lees = (rel) => fs.readFileSync(path.join(APP, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const DRAG = '@crabnebula/tauri-plugin-drag';

// Vite past een regex-alias toe als `specifier.replace(find, replacement)`.
function losOp(aliassen, specifier) {
  const a = aliassen.find((x) => x.find.test(specifier));
  return a ? specifier.replace(a.find, a.replacement) : specifier;
}

test('only the hosted mode and OPDS_WEB_BUILD=1 count as a web build', () => {
  assert.equal(isWebBouw('hosted', {}), true);
  assert.equal(isWebBouw('production', { OPDS_WEB_BUILD: '1' }), true);
  assert.equal(isWebBouw('production', {}), false);
  assert.equal(isWebBouw('development', {}), false);
  assert.equal(isWebBouw('production', { OPDS_WEB_BUILD: '0' }), false);
});

test('a web build aliases the desktop drag module to its stub; the desktop build does not', () => {
  const stub = path.join(APP, 'js', 'core', 'desktop-drag-plugin.web.js');
  for (const [mode, env] of [['hosted', {}], ['production', { OPDS_WEB_BUILD: '1' }]]) {
    const aliassen = webAliassen(APP, mode, env);
    assert.equal(losOp(aliassen, '../../core/desktop-drag-plugin.js'), stub);
    assert.equal(losOp(aliassen, './desktop-drag-plugin.js'), stub);
    assert.equal(losOp(aliassen, './desktop-drag-plugin.web.js'), './desktop-drag-plugin.web.js');
    assert.equal(losOp(aliassen, 'pdfjs-dist'), 'pdfjs-dist');
  }
  assert.deepEqual(webAliassen(APP, 'production', {}), []);
  assert.deepEqual(webAliassen(APP, 'development', {}), []);
});

test('every replaced module and its stub exist and export the same names', async () => {
  for (const [desktop, web] of Object.entries(WEB_VERVANGERS)) {
    assert.ok(fs.existsSync(path.join(APP, desktop)), desktop);
    assert.ok(fs.existsSync(path.join(APP, web)), web);
    assert.ok(!/@crabnebula|tauri-plugin/.test(lees(web).replace(/^\s*\/\/.*$/gm, '')), `${web} imports nothing desktop-only`);
    const stub = await import(pathToFileURL(path.join(APP, web)).href);
    const namen = [...lees(desktop).matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    assert.ok(namen.length);
    assert.deepEqual(Object.keys(stub).sort(), namen.sort());
  }
  const { laadDesktopDragPlugin } = await import(pathToFileURL(path.join(APP, 'js/core/desktop-drag-plugin.web.js')).href);
  assert.equal(await laadDesktopDragPlugin(), null);
});

test('vite.config.js applies the web aliases with the build mode', () => {
  const cfg = lees('vite.config.js');
  assert.match(cfg, /import \{ webAliassen \} from '\.\/scripts\/web-bouw\.mjs'/);
  assert.match(cfg, /defineConfig\(\(\{ mode \}\) =>/);
  assert.match(cfg, /\.\.\.webAliassen\(APP, mode\)/);
});

test('the live web deploy builds as a web build', () => {
  const yml = lees('../.github/workflows/live.yml');
  assert.match(yml, /build_command: .*OPDS_WEB_BUILD=1 npx vite build/);
});

test('only the desktop module imports the drag plugin', () => {
  const treffers = [];
  const loop = (rel) => {
    for (const d of fs.readdirSync(path.join(APP, rel), { withFileTypes: true })) {
      const sub = `${rel}/${d.name}`;
      if (d.isDirectory()) loop(sub);
      else if (/\.(m?js|jsx|ts|tsx)$/.test(d.name) && !/\.test\.mjs$/.test(d.name) && lees(sub).includes(DRAG)) treffers.push(sub);
    }
  };
  loop('js');
  loop('web-unit/src');
  assert.deepEqual(treffers, ['js/core/desktop-drag-plugin.js']);
  assert.match(lees('js/core/desktop-drag-plugin.js'), new RegExp(`import\\('${DRAG.replace('/', '\\/')}'\\)`));
  assert.match(lees('js/solid/components/DocumentTabs.jsx'), /from '\.\.\/\.\.\/core\/desktop-drag-plugin\.js'/);
});

test('the bundle check finds the drag plugin by name and by its Tauri command', () => {
  assert.ok(DESKTOP_PAKKETTEN.includes(DRAG));
  // Zo staat de plugin na minificatie in een chunk: het commando blijft een
  // letterlijke string, de pakketnaam niet.
  const geminificeerd = 'async function x(o,e){const n=new C;e&&(n.onmessage=e),await i("plugin:drag|start_drag",{item:o.item})}';
  const treffers = zoekDesktopCode([
    { pad: 'assets/index-abc.js', data: Buffer.from(`var a=1;${geminificeerd}`) },
    { pad: 'THIRD-PARTY-NOTICES.txt', data: `----\n${DRAG} 2.1.0\nLicense: UNKNOWN\n` },
    { pad: 'assets/schoon.js', data: new Uint8Array(Buffer.from('invoke("plugin:dialog|open")')) },
  ]);
  assert.deepEqual(treffers.map((t) => t.pad), ['assets/index-abc.js', 'THIRD-PARTY-NOTICES.txt']);
  assert.ok(treffers.some((t) => t.kenmerk === 'plugin:drag|'));
  assert.ok(DESKTOP_KENMERKEN.length >= 2);
});
