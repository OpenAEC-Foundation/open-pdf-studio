// Inline-SVG-iconen moeten een maat hebben (#1001).
//
// Een <svg> met alleen een viewBox en geen width/height heeft geen eigen
// maat. Chromium geeft zo'n svg in een flex-knop toch ruimte, maar WebKit
// (Safari, en elke browser op iPad) maakt hem 0 x 0: het icoon verdwijnt.
// Deze bronscan eist voor elk icoon in de UI-componenten en icoonbestanden
// dat het ofwel width/height-attributen heeft, ofwel binnen een element staat
// waarvan de CSS de svg een maat geeft (`.klasse svg { width: ... }`), ofwel
// zelf een klasse met een maat heeft.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../../', import.meta.url));
const SOLID = join(APP, 'js', 'solid');

function* bestanden(map, patroon) {
  for (const e of readdirSync(map, { withFileTypes: true })) {
    const pad = join(map, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* bestanden(pad, patroon); }
    else if (patroon.test(e.name) && !/\.test\./.test(e.name)) yield pad;
  }
}
const rel = (pad) => relative(APP, pad).split(sep).join('/');

// --- CSS: welke klassen geven een svg een maat? ---------------------------
const houderKlassen = new Set(); // `.houder svg { width }` (svg als nazaat)
const eigenKlassen = new Set();  // `.klasse { width }` (op de svg zelf)
for (const pad of [...bestanden(join(APP, 'styles'), /\.css$/), ...bestanden(join(APP, 'js'), /\.css$/)]) {
  const css = readFileSync(pad, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const regel of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])(width|height)\s*:/.test(regel[2])) continue;
    for (const kiezer of regel[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const delen = kiezer.split(/\s*[\s>+~]\s*/).filter(Boolean);
      const laatste = delen[delen.length - 1];
      const namen = (s) => [...s.matchAll(/[.#]([\w-]+)/g)].map((m) => m[1]);
      if (/^svg\b/.test(laatste)) delen.slice(0, -1).forEach((d) => namen(d).forEach((n) => houderKlassen.add(n)));
      namen(laatste).forEach((n) => eigenKlassen.add(n));
    }
  }
}

// --- Bronnen ---------------------------------------------------------------
const bronnen = new Map([...bestanden(SOLID, /\.(jsx|js)$/)].map((p) => [p, readFileSync(p, 'utf8')]));

// Componenten die een icoon-prop in een element met maat-klasse zetten.
const PROP_DOELEN = {
  RibbonButton: 'ribbon-btn-icon',
  MenuItem: 'context-menu-icon',
  Submenu: 'context-menu-icon',
  SplitButton: 'ribbon-btn-icon',
  ColorPickerButton: 'ribbon-btn-icon',
};
// Bestanden die iconen in een gegevenslijst (icon: ...) aan een vaste houder geven.
const LIJST_DOELEN = {
  'ToolPalette.jsx': 'tp-btn',
  'LeftPanel.jsx': 'left-panel-tab',
};

const LEEG = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'wbr']);

// Openingstag die op `start` begint ('<naam ...>'): einde, naam, attributen.
// Houdt rekening met {...}-expressies en aanhalingstekens in JSX.
function leesTag(src, start) {
  const naam = /^<([A-Za-z][\w.-]*)/.exec(src.slice(start, start + 80));
  if (!naam) return null;
  let diepte = 0; let quote = null;
  for (let i = start + naam[0].length; i < src.length && i < start + 20000; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (diepte > 0 && c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
    if (diepte > 0 && c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; if (i <= 0) return null; continue; }
    if (c === '"' || c === "'" || (c === '`' && diepte > 0)) { quote = c; continue; }
    if (c === '{') diepte++;
    else if (c === '}') diepte--;
    else if (c === '>' && diepte <= 0 && src[i - 1] !== '=') {
      return { einde: i, naam: naam[1], attrs: src.slice(start + naam[0].length, i), zelfsluitend: src[i - 1] === '/' };
    }
  }
  return null;
}

// Openstaande elementen (voorouders) op positie `pos`, binnenste laatst.
function vooroudersBij(src, pos) {
  const stapel = [];
  const re = /<(\/?)([A-Za-z][\w.-]*)/g; let m;
  while ((m = re.exec(src)) && m.index < pos) {
    if (m[1]) {
      const i = stapel.map((t) => t.naam).lastIndexOf(m[2]);
      if (i >= 0) stapel.length = i;
      continue;
    }
    const tag = leesTag(src, m.index);
    if (!tag) continue;
    if (tag.einde >= pos) { stapel.push(tag); break; } // pos ligt in deze tag
    if (!tag.zelfsluitend && !LEEG.has(tag.naam.toLowerCase())) stapel.push(tag);
    re.lastIndex = tag.einde + 1;
  }
  return stapel;
}

function klassen(attrs) {
  const uit = [];
  for (const m of attrs.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
    uit.push(...((m[1] ?? m[2] ?? m[3] ?? '').match(/[\w-]+/g) || []));
  }
  for (const m of attrs.matchAll(/classList\s*=\s*\{\{([^}]*)\}\}/g)) uit.push(...(m[1].match(/[\w-]+/g) || []));
  return uit;
}

const heeftMaatHouder = (voorouders) => voorouders.some((t) => {
  if (PROP_DOELEN[t.naam]) return houderKlassen.has(PROP_DOELEN[t.naam]);
  return klassen(t.attrs).some((k) => houderKlassen.has(k));
});

// Namen waaronder een svg-string buiten zijn definitie gebruikt wordt.
function eigenaars(src, idx) {
  const uit = [];
  const voor = src.slice(Math.max(0, idx - 300), idx);
  let m = voor.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*[`'"][^`'"]*$/);
  if (m) uit.push(m[1]);
  m = voor.match(/([\w$]+)\s*:\s*(?:\(\s*|[`'"][^`'"]*)$/);
  if (m) {
    uit.push(m[1]);
    const lijst = [...src.slice(0, idx).matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*\{/g)].pop();
    if (lijst) uit.push(lijst[1]);
  }
  if (uit.length) return uit;
  // Anders: de functie (component of icoon-fabriek) waarbinnen de svg staat.
  const venster = src.slice(Math.max(0, idx - 1500), idx);
  const fn = [...venster.matchAll(/function\s+([\w$]+)\s*\(/g)].pop();
  if (fn) {
    const romp = venster.slice(fn.index);
    const open = (romp.match(/\{/g) || []).length - (romp.match(/\}/g) || []).length;
    if (open > 0) uit.push(fn[1]);
  }
  return uit;
}

function gebruikHeeftMaat(namen, eigenBestand, defIdx) {
  if (!namen.length) return false;
  const re = new RegExp(`(?<![\\w$])(?:${namen.map((n) => n.replace(/\$/g, '\\$')).join('|')})(?![\\w$])`, 'g');
  for (const [pad, src] of bronnen) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (pad === eigenBestand && Math.abs(m.index - defIdx) < 300) continue; // de definitie zelf
      if (LIJST_DOELEN[basename(pad)] && houderKlassen.has(LIJST_DOELEN[basename(pad)])) return true;
      if (heeftMaatHouder(vooroudersBij(src, m.index))) return true;
    }
  }
  return false;
}

function zoekIconenZonderMaat() {
  const fout = [];
  for (const [pad, src] of bronnen) {
    const r = rel(pad);
    if (!/^js\/solid\/(components\/|data\/\w*Icons\.js$)/.test(r)) continue;
    for (const m of src.matchAll(/<svg\b/g)) {
      const tag = leesTag(src, m.index);
      if (!tag) continue;
      const a = tag.attrs;
      if (/\bwidth\s*=/.test(a) && /\bheight\s*=/.test(a)) continue;
      if (/\bstyle\s*=[^>]*\bwidth/.test(a)) continue;
      if (klassen(a).some((k) => eigenKlassen.has(k) || houderKlassen.has(k))) continue;
      if (heeftMaatHouder(vooroudersBij(src, m.index))) continue;
      if (gebruikHeeftMaat(eigenaars(src, m.index), pad, m.index)) continue;
      fout.push(`${r}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  return fout;
}

test('elk inline-SVG-icoon heeft width/height of een CSS-maat (WebKit)', () => {
  assert.deepEqual(zoekIconenZonderMaat(), []);
});

test('de doelklassen van de icoon-props bestaan en geven de svg een maat', () => {
  for (const klasse of [...Object.values(PROP_DOELEN), ...Object.values(LIJST_DOELEN)]) {
    assert.ok(houderKlassen.has(klasse), `.${klasse} svg heeft een maat in de CSS`);
  }
  const contextMenu = bronnen.get(join(SOLID, 'components', 'ContextMenu.jsx'));
  assert.match(contextMenu, /<span class="context-menu-icon" innerHTML=\{props\.icon/);
});

test('het tandwiel van het symboolpalet heeft een eigen maat (#1001)', () => {
  const src = bronnen.get(join(SOLID, 'components', 'SymbolPalette.jsx'));
  const tandwiel = /const settingsSvg = `(<svg[^>]*>)/.exec(src)[1];
  assert.match(tandwiel, /\bwidth="\d+"/);
  assert.match(tandwiel, /\bheight="\d+"/);
  const css = readFileSync(join(APP, 'styles', 'symbol-palette.css'), 'utf8');
  assert.match(css, /\.sp-settings-btn svg\s*\{[^}]*width:\s*12px[^}]*height:\s*12px/);
});

test('de scan herkent een icoon zonder maat in een flex-knop', () => {
  // Zelfcontrole van de heuristiek: een losse knop met een kale svg faalt.
  const src = '<button class="geen-maat-klasse" innerHTML={x} />';
  assert.equal(heeftMaatHouder(vooroudersBij(src, src.indexOf('innerHTML'))), false);
  const goed = '<span class="context-menu-icon"><svg viewBox="0 0 16 16"/></span>';
  assert.equal(heeftMaatHouder(vooroudersBij(goed, goed.indexOf('<svg'))), true);
});
