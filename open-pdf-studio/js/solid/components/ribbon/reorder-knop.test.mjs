// The Reorder button of the Edit & Combine tab (#763) opens the page
// organizer, a thumbnail grid in which pages are dragged into a new order.
// Before, it only switched the left panel to its thumbnails, which already
// show by default, so clicking it did nothing visible. Source-level checks:
// the dialog itself runs in the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function functieLijf(tekst, naam) {
  const begin = tekst.indexOf(`function ${naam}(`);
  assert.ok(begin >= 0, `function ${naam} exists`);
  let diepte = 0;
  for (let i = tekst.indexOf('{', begin); i < tekst.length; i++) {
    if (tekst[i] === '{') diepte++;
    else if (tekst[i] === '}' && --diepte === 0) return tekst.slice(begin, i + 1);
  }
  throw new Error(`end of ${naam} not found`);
}

test('the Reorder button opens the page organizer dialog', () => {
  const tab = bron('./OrganizeTab.jsx');
  const knop = tab.slice(tab.indexOf('id="reorder-pages"'), tab.indexOf('/>', tab.indexOf('id="reorder-pages"')));
  const handler = knop.match(/onClick=\{(\w+)\}/)?.[1];
  assert.ok(handler, 'the button has a named click handler');
  const lijf = functieLijf(tab, handler);
  assert.match(lijf, /openDialog\('page-organizer'/, 'the handler opens the page organizer');
  assert.doesNotMatch(lijf, /setLeftPanelActiveTab|setLeftPanelCollapsed/, 'not just the thumbnails panel again');
  assert.match(knop, /disabled=\{ro\(\)\}/, 'disabled without a document or for a read-only PDF/A, like the other page edits');
});

test('the dialog host knows the page organizer and loads it on demand', () => {
  const host = bron('../DialogHost.jsx');
  assert.match(host, /const PageOrganizerDialog = lazy\(\(\) => import\('\.\/dialogs\/PageOrganizerDialog\.jsx'\)\);/);
  assert.match(host, /'page-organizer': PageOrganizerDialog,/);
});

test('the organizer applies all pending edits once, through applyPageEdits (#764)', () => {
  const dlg = bron('../dialogs/PageOrganizerDialog.jsx');
  assert.equal((dlg.match(/await applyPageEdits\(/g) || []).length, 1, 'one call: one undo step');
  assert.doesNotMatch(dlg, /reorderPages\(/, 'the reorder is part of the plan, not a step of its own');
  const apply = dlg.slice(dlg.indexOf('const apply = async'), dlg.indexOf('// ── Selection'));
  assert.match(apply, /await applyPageEdits\(p, \{ sources: bronnen \}\)/);
  assert.match(dlg, /closeDialog\('page-organizer'\)/);
  for (const naam of ['moveEntriesToGap', 'moveEntriesBy', 'moveEntriesToEdge', 'gapAtPoint', 'rangeInOrder']) {
    assert.match(dlg, new RegExp(`\\b${naam}\\(`), `uses ${naam}`);
  }
  assert.match(dlg, /from '\.\.\/\.\.\/\.\.\/pdf\/page-edit-plan\.js'/);
  // Drag, drop indicator, multi-select and the keyboard alternative.
  assert.match(dlg, /onDragStart=/);
  assert.match(dlg, /onDrop=\{handleDrop\}/);
  assert.match(dlg, /dropGap\(\) === g/);
  assert.match(dlg, /e\.shiftKey/);
  assert.match(dlg, /e\.ctrlKey/);
  assert.match(dlg, /ctrl && \(key === 'ArrowLeft'/);
  // A native listener, so the document-wide shortcuts do not see the keys.
  assert.match(dlg, /on:keydown=\{handleKeyDown\}/);
  assert.match(dlg, /e\.stopPropagation\(\)/);
  assert.match(dlg, /<Dialog\b/, 'the shared movable modal dialog');
});

test('the thumbnails panel drags the whole selection with the same model', () => {
  const panel = bron('../left-panel/panels/ThumbnailsPanel.jsx');
  assert.match(panel, /moveGroupToGap\(order, group, gap\)/);
});

test('the organizer styles: squared corners, default cursor, no animations', () => {
  assert.match(bron('../../../../styles.css'), /@import '\.\/styles\/page-organizer\.css';/);
  const eigen = bron('../../../../styles/page-organizer.css');
  assert.ok(eigen.length > 100);
  assert.doesNotMatch(eigen, /border-radius:\s*[1-9]/);
  assert.doesNotMatch(eigen, /cursor:\s*(pointer|move|grab)/);
  assert.doesNotMatch(eigen, /\b(transition|animation)\s*:/);
});

test('every locale has real translations of the organizer strings', () => {
  const map = new URL('../../../i18n/locales/', import.meta.url);
  const talen = readdirSync(map);
  const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/dialogs.json`, map), 'utf8')).pageOrganizer;
  const en = lees('en');
  const sleutels = ['title', 'hint', 'moveLeft', 'moveRight', 'moveToStart', 'moveToEnd', 'selection'];
  for (const s of sleutels) assert.ok(s in en, `en.${s}`);
  for (const taal of talen) {
    const po = lees(taal);
    assert.ok(po, `${taal} has pageOrganizer`);
    for (const s of sleutels) assert.ok(typeof po[s] === 'string' && po[s].trim(), `${taal}.${s}`);
    assert.match(po.selection, /\{\{selected\}\}/, `${taal}.selection`);
    assert.match(po.selection, /\{\{total\}\}/, `${taal}.selection`);
    if (taal !== 'en') assert.notEqual(po.title, en.title, `${taal}.title is translated`);
  }
});
