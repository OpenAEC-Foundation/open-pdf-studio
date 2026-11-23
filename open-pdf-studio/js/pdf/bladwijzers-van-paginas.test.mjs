// Bookmarks for the selected pages, named after the page (#1243).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { bladwijzersVanPaginas, paginaNaam } from './bladwijzers-van-paginas.js';
import { normaliseerLabels, heeftEigenLabel } from './pagina-labels.js';

const LABELS = normaliseerLabels(['A-101', '', 'S-201', ''], 4);

test('a page goes by its own label, otherwise by its number', () => {
  assert.equal(heeftEigenLabel(LABELS, 1), true);
  assert.equal(paginaNaam(LABELS, 1), 'A-101');
  assert.equal(paginaNaam(LABELS, 2), 'Page 2');
  assert.equal(paginaNaam(LABELS, 2, 'Pagina'), 'Pagina 2');
  assert.equal(paginaNaam(null, 7), 'Page 7');
});

test('one bookmark per selected page, in page order, after the existing ones', () => {
  const bestaand = [{ id: 'bm_1', title: 'Cover', page: 1, parentId: null, sortOrder: 0 }];
  const uit = bladwijzersVanPaginas(bestaand, [3, 1, 2], { labels: LABELS, aantal: 4 });
  assert.equal(uit.toegevoegd, 3);
  assert.deepEqual(uit.bookmarks.map((b) => [b.title, b.page]), [['Cover', 1], ['A-101', 1], ['Page 2', 2], ['S-201', 3]]);
  assert.deepEqual(uit.bookmarks.slice(1).map((b) => b.sortOrder), [1, 2, 3]);
  assert.equal(new Set(uit.bookmarks.map((b) => b.id)).size, 4, 'unique ids');
  assert.equal(bestaand.length, 1, 'the given list is not changed');
});

test('doing it twice does not double the list', () => {
  const eerste = bladwijzersVanPaginas([], [1, 2], { labels: LABELS, aantal: 4 });
  const tweede = bladwijzersVanPaginas(eerste.bookmarks, [1, 2, 3], { labels: LABELS, aantal: 4 });
  assert.equal(tweede.toegevoegd, 1);
  assert.deepEqual(tweede.bookmarks.map((b) => b.title), ['A-101', 'Page 2', 'S-201']);
  const derde = bladwijzersVanPaginas(tweede.bookmarks, [1, 2, 3], { labels: LABELS, aantal: 4 });
  assert.equal(derde.toegevoegd, 0);
  assert.equal(derde.bookmarks, tweede.bookmarks, 'nothing to add: the same list');
});

test('pages outside the document and doubles are ignored', () => {
  const uit = bladwijzersVanPaginas([], [2, 2, 0, 9, 1.5], { labels: null, aantal: 4 });
  assert.deepEqual(uit.bookmarks.map((b) => b.title), ['Page 2']);
});

test('the thumbnail menu offers it for the selected pages', () => {
  const menu = fs.readFileSync(new URL('../solid/components/ContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /thumbnail\.addBookmarks/);
  assert.match(menu, /voegBladwijzersVanPaginasToe\(/);
});
