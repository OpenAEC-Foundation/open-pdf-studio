// Left-panel lists must be reachable by scrolling (#1155).
//
// `.left-panel-content` clips its content (overflow: hidden), so a panel that
// renders its list straight into it cannot scroll: rows below the panel edge
// were unreachable in the schedules panel (and in the measurements panel).
// Every panel therefore needs a child that scrolls vertically. A long
// schedule preview scrolls by itself with its header row kept in view, in
// colours every theme defines.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const lees = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
const STIJLEN = new URL('../../../../../styles/', import.meta.url);
const css = ['layout.css', 'panels.css'].map((f) => lees(new URL(f, STIJLEN))).join('\n');
const themas = lees(new URL('themes.css', STIJLEN));

// Declarations of every rule whose selector list contains exactly `selector`.
function regel(selector) {
  const zonder = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const uit = [];
  for (const m of zonder.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) uit.push(m[2]);
  }
  return uit.join('\n');
}
const schuiftVerticaal = (decl) => /overflow(-y)?:\s*auto/.test(decl);

test('the panel body clips, so the list needs its own scrolling layer', () => {
  assert.match(regel('.left-panel-content'), /overflow:\s*hidden/);
});

test('the schedules and measurements lists scroll as a whole', () => {
  for (const klasse of ['.schedules-container', '.measurements-container']) {
    const d = regel(klasse);
    assert.match(d, /flex:\s*1/, klasse);
    assert.match(d, /min-height:\s*0/, klasse);
    assert.match(d, /overflow-y:\s*auto/, klasse);
  }
  const map = new URL('./', import.meta.url);
  const staten = lees(new URL('SchedulesPanel.jsx', map));
  // The list (and with it every preview) sits inside the scrolling layer;
  // the header and the add bar stay above it.
  const laag = staten.indexOf('class="schedules-container"');
  assert.ok(laag > staten.indexOf('class="schedules-add"'));
  assert.ok(laag < staten.indexOf('class="schedules-entry"'));
  assert.ok(laag < staten.indexOf('class="schedules-preview"'));
  const metingen = lees(new URL('MeasurementsPanel.jsx', map));
  assert.ok(metingen.indexOf('class="measurements-container"') < metingen.indexOf('class="measurements-section"'));
  assert.ok(metingen.indexOf('class="measurements-container"') > metingen.indexOf('class="left-panel-header"'));
});

test('every left panel has a vertically scrolling child', () => {
  const map = new URL('./', import.meta.url);
  const panelen = readdirSync(map).filter((f) => f.endsWith('Panel.jsx'));
  assert.ok(panelen.length >= 13, `${panelen.length} panels`);
  const zonder = [];
  for (const bestand of panelen) {
    const bron = lees(new URL(bestand, map));
    const klassen = new Set();
    for (const m of bron.matchAll(/class=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      for (const k of (m[1] || m[2]).split(/[\s${}]+/)) if (/^[\w-]+$/.test(k)) klassen.add(k);
    }
    klassen.delete('left-panel-content');
    if (![...klassen].some((k) => schuiftVerticaal(regel(`.${k}`)))) zonder.push(bestand);
  }
  assert.deepEqual(zonder, []);
});

test('a long schedule preview scrolls with a sticky header row', () => {
  const voorbeeld = regel('.schedules-preview');
  assert.match(voorbeeld, /max-height:\s*\d+vh/);
  assert.match(voorbeeld, /overflow:\s*auto/);
  const kop = regel('.schedules-preview-table thead th');
  assert.match(kop, /position:\s*sticky/);
  assert.match(kop, /top:\s*0/);
  // An opaque background, or the rows show through the sticky header.
  assert.match(regel('.schedules-preview-table th'), /background:\s*var\(--theme-[\w-]+\)/);
});

test('the preview colours come from variables every theme defines', () => {
  const aantalThemas = (themas.match(/^\[data-theme="[^"]+"\]\s*\{/gm) || []).length;
  assert.ok(aantalThemas >= 7);
  const selectors = ['.schedules-preview', '.schedules-preview-table', '.schedules-preview-table th',
    '.schedules-preview-table td', '.schedules-preview-table thead th', '.schedules-preview-table .sp-group td',
    '.schedules-preview-table .sp-total td', '.schedules-preview-table .sp-grand td'];
  for (const sel of selectors) {
    for (const m of regel(sel).matchAll(/(background|box-shadow|color):([^;]+);/g)) {
      assert.doesNotMatch(m[2].replace(/var\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b|rgb/i, `${sel}: fixed colour in ${m[0]}`);
      if (m[1] !== 'background') continue;
      for (const v of m[2].matchAll(/var\((--[\w-]+)/g)) {
        const keer = (themas.match(new RegExp(`${v[1]}:`, 'g')) || []).length;
        assert.equal(keer, aantalThemas, `${sel}: ${v[1]} is not defined in every theme`);
      }
    }
  }
});
