// Het contextmenu met een luie inhoud (#454): de host blijft bij de start
// gemonteerd met zijn luisteraars; de inhoud is een eigen chunk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const host = lees('./ContextMenuHost.jsx');
const inhoud = lees('./ContextMenu.jsx');

test('App monteert de host, niet de inhoud', () => {
  const app = lees('../App.jsx');
  assert.match(app, /^import ContextMenu from '\.\/components\/ContextMenuHost\.jsx';$/m);
  assert.doesNotMatch(app, /components\/ContextMenu\.jsx/);
  assert.match(app, /<ContextMenu \/>/);
});

test('de host registreert bij het monteren Escape, klik buiten en venster verlaten', () => {
  for (const regel of [
    "document.addEventListener('mousedown', handleOutsideClick);",
    "document.addEventListener('keydown', handleEscape);",
    "window.addEventListener('blur', handleWindowBlur);",
  ]) assert.ok(host.includes(regel), regel);
  assert.doesNotMatch(inhoud, /addEventListener\('mousedown', handleOutsideClick\)/);
  assert.doesNotMatch(inhoud, /export default function ContextMenu\(\)/);
});

test('de inhoud laadt lui: na de start, bij het openen, en het menu wordt daarna opnieuw geplaatst', () => {
  assert.match(host, /const ContextMenuInhoud = lazy\(\(\) => import\('\.\/ContextMenu\.jsx'\)\);/);
  assert.match(host, /naDeStart\(\(\) => \{ laadInhoud\(\); \}\)/);
  assert.match(host, /createEffect\(\(\) => \{ if \(visible\(\)\) laadInhoud\(\); \}\);/);
  // De plaatsing hangt ook af van het laden van de inhoud.
  assert.match(host, /const pos = position\(\);\n\s*menuType\(\);\n\s*inhoudGeladen\(\);\n\s*requestAnimationFrame/);
  assert.match(host, /<Show when=\{inhoudOpgebouwd\(\)\}>\s*<ContextMenuInhoud \/>\s*<\/Show>/);
  assert.match(inhoud, /export default function ContextMenuInhoud\(\) \{/);
  for (const soort of ['annotation', 'annotationMulti', 'page', 'textSelection', 'bookmark', 'thumbnail']) {
    assert.ok(inhoud.includes(`<Match when={menuType() === '${soort}'}>`), soort);
  }
});

test('submenu-plaatsing staat in een gedeelde module', () => {
  const plaatsen = lees('./contextmenu-plaatsen.js');
  assert.match(plaatsen, /export const MENU_MARGE = 4;/);
  assert.match(plaatsen, /export function plaatsSubmenuVan\(item\)/);
  assert.match(inhoud, /import \{ plaatsSubmenuVan \} from '\.\/contextmenu-plaatsen\.js';/);
  assert.match(host, /import \{ MENU_MARGE, plaatsSubmenuVan \} from '\.\/contextmenu-plaatsen\.js';/);
});
