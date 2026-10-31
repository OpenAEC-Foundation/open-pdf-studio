// Bladwijzer hernoemen in de lijst (#891): F2/dubbelklik, Enter/klik-weg
// bewaart, Esc en een lege titel houden de oude. Met de echte state-store,
// undo-manager en bookmarks.js (zie core/app-test-hooks.mjs); de bediening
// in het paneel wordt op de bron gecontroleerd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { nieuweTitel } = await import('./bladwijzer-boom.js');

const hier = dirname(fileURLToPath(import.meta.url));
const bm = (id, title, parentId = null, sortOrder = 0, extra = {}) => ({
  id, title, page: 2, parentId, sortOrder, expanded: true, bold: true, italic: false, color: '#e81123', ...extra,
});

function openen(bookmarks) {
  state.documents = [{
    id: 'doc-hernoem', filePath: null, pdfDoc: { numPages: 3 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks, pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('nieuwe titel: getrimd en unicode; leeg, spaties of ongewijzigd doet niets', () => {
  const lijst = [bm('a', 'Cover'), bm('b', 'C-101', 'a')];
  assert.equal(nieuweTitel(lijst, 'b', '  Bouwkundig – Gevel Ü 東 😀  ', 'C-101'), 'Bouwkundig – Gevel Ü 東 😀');
  for (const waarde of ['', '   ', '\t\n', 'C-101', '  C-101 ', null, undefined]) {
    assert.equal(nieuweTitel(lijst, 'b', waarde, 'C-101'), null, JSON.stringify(waarde));
  }
});

test('verouderde sessie: verdwenen bladwijzer of intussen gewijzigde titel wordt niet overschreven', () => {
  const lijst = [bm('a', 'Voorblad')];
  assert.equal(nieuweTitel(lijst, 'a', 'Nieuw', 'Cover'), null, 'titel intussen via Edit Bookmark gewijzigd');
  assert.equal(nieuweTitel(lijst, 'weg', 'Nieuw', 'Voorblad'), null);
  assert.equal(nieuweTitel(null, 'a', 'Nieuw', 'Voorblad'), null);
  // Een bladwijzer zonder titel kan er een krijgen.
  assert.equal(nieuweTitel([bm('x', undefined)], 'x', 'Titel', undefined), 'Titel');
});

test('hernoemen is één undo-stap die alleen de titel terugzet', async () => {
  const doc = openen([bm('a', 'Cover'), bm('b', 'CIVIL', null, 1), bm('c', 'C-101', 'b', 0)]);
  // Zoals renameBookmarkTitle: titel zetten en recordModifyBookmark.
  const c = doc.bookmarks.find(b => b.id === 'c');
  const oud = { ...c };
  c.title = nieuweTitel(doc.bookmarks, 'c', ' Gevel – Ü 東 ', 'C-101');
  undo.recordModifyBookmark('c', oud, { ...c });
  assert.equal(state.documents[0].undoStack.length, 1);
  await undo.undo();
  const terug = state.documents[0].bookmarks.find(b => b.id === 'c');
  assert.deepEqual({ title: terug.title, page: terug.page, parentId: terug.parentId, sortOrder: terug.sortOrder, bold: terug.bold, color: terug.color },
    { title: 'C-101', page: 2, parentId: 'b', sortOrder: 0, bold: true, color: '#e81123' });
  await undo.redo();
  assert.equal(state.documents[0].bookmarks.find(b => b.id === 'c').title, 'Gevel – Ü 東');
});

test('renameBookmarkTitle controleert na het laden opnieuw: tabblad, alleen-lezen, titel', () => {
  const bron = readFileSync(join(hier, 'bookmarks.js'), 'utf8');
  const fn = bron.slice(bron.indexOf('export async function renameBookmarkTitle('), bron.indexOf('// Edit selected bookmark'));
  const naLaden = fn.slice(fn.indexOf("await import('../../core/undo-manager.js')"));
  assert.ok(naLaden.includes('getActiveDocument() !== doc'), 'ander tabblad');
  assert.ok(naLaden.includes('isPdfAReadOnly()'), 'alleen-lezen');
  assert.ok(naLaden.includes('nieuweTitel(doc.bookmarks'), 'titel opnieuw gecontroleerd');
  assert.ok(fn.includes('recordModifyBookmark(id, oldState'), 'één undo-stap');
  assert.ok(fn.includes('markDocumentModified(doc)'));
});

test('paneel: dubbelklik en F2 openen het tekstvak, Enter/Esc/klik-weg sluiten het', () => {
  const paneel = readFileSync(join(hier, '../../solid/components/left-panel/panels/BookmarksPanel.jsx'), 'utf8');
  const titel = readFileSync(join(hier, '../../solid/components/left-panel/panels/BookmarkTitle.jsx'), 'utf8');
  assert.match(paneel, /e\.key === 'F2'[^\n]*\n[^\n]*hernoemSelectie\(\)/);
  // F2 op een bladwijzer onder een ingeklapte ouder: eerst tonen, dan pas het tekstvak.
  const f2 = paneel.slice(paneel.indexOf('async function hernoemSelectie('));
  assert.ok(f2.indexOf('revealBookmark(id)') > 0 && f2.indexOf('revealBookmark(id)') < f2.indexOf('rename.start(id)'));
  assert.ok(paneel.includes('renameBookmarkTitle(session.doc, session.id, session.draft, session.title)'));
  assert.ok(titel.includes('onDblClick'));
  assert.match(titel, /e\.key === 'Enter' \|\| e\.key === 'Escape'/);
  assert.match(titel, /finish\(e\.key === 'Enter', true\)/, 'Enter bewaart, Esc niet');
  assert.ok(titel.includes('onBlur'), 'klik-weg bewaart');
  assert.ok(titel.includes('e.isComposing'), 'Enter in een IME-compositie bewaart niet');
  // Slepen begint niet in het tekstvak (selecteren met de muis blijft werken).
  const slepen = readFileSync(join(hier, 'bookmark-pointer-drag.js'), 'utf8');
  assert.match(slepen, /closest\?\.\('button, input, textarea/);
});

test('F2 in de bladwijzerlijst is hernoemen, daarbuiten blijft het Proofread', () => {
  const bron = readFileSync(join(hier, '../../tools/proofreading-mode.js'), 'utf8');
  const opToets = bron.slice(bron.indexOf('function opToets('));
  const uitzondering = opToets.indexOf("closest?.('.bookmarks-container')");
  assert.ok(uitzondering > 0, 'uitzondering voor de bladwijzerlijst');
  assert.ok(uitzondering < opToets.indexOf('toggleProofreading()'), 'vóór het omschakelen');
});
