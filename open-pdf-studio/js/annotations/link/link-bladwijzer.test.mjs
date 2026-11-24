// A link to a named place (#1226): a bookmark of the document.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { linkDoelVanBladwijzer, bladwijzerKeuzes } from './link-model.js';
import { boomVolgorde } from '../../ui/panels/bladwijzer-boom.js';

const BLADWIJZERS = [
  { id: 'a', title: 'Ground floor', page: 2, top: 700, left: 40, zoom: 1.5, parentId: null, sortOrder: 0 },
  { id: 'b', title: 'Detail 4', page: 2, top: 300, left: 120, zoom: 3, parentId: 'a', sortOrder: 0 },
  { id: 'c', title: 'Roof', page: 5, top: null, left: null, zoom: null, parentId: null, sortOrder: 1 },
];

test('the link takes the destination the bookmark has now', () => {
  assert.deepEqual(linkDoelVanBladwijzer(BLADWIJZERS[1], 6), { kind: 'page', page: 2, fit: 'xyz', left: 120, top: 300, zoom: 3 });
  // A bookmark without a place of its own: the top of its page.
  assert.deepEqual(linkDoelVanBladwijzer(BLADWIJZERS[2], 6), { kind: 'page', page: 5, fit: 'xyz', left: null, top: null, zoom: null });
});

test('a bookmark without a usable page gives no target', () => {
  assert.equal(linkDoelVanBladwijzer(null, 6), null);
  assert.equal(linkDoelVanBladwijzer({ id: 'x', title: 'Gone', page: 9 }, 6), null);
  assert.equal(linkDoelVanBladwijzer({ id: 'x', title: 'None' }, 6), null);
});

test('the choices follow the bookmark tree, indented by depth', () => {
  const keuzes = bladwijzerKeuzes(BLADWIJZERS, boomVolgorde(BLADWIJZERS));
  assert.deepEqual(keuzes.map((k) => k.id), ['a', 'b', 'c']);
  assert.equal(keuzes[0].label, 'Ground floor');
  assert.equal(keuzes[1].label, '  Detail 4');
  assert.deepEqual(bladwijzerKeuzes([], []), []);
  assert.equal(bladwijzerKeuzes([{ id: 'z', title: '  ', page: 1 }], ['z'])[0].label, '—');
});

test('the link dialog offers the bookmarks and says so when there are none', () => {
  const dialoog = fs.readFileSync(new URL('../../solid/components/dialogs/LinkDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialoog, /value: 'bookmark', label: t\('link\.viewBookmark'\)/);
  assert.match(dialoog, /id="link-dialog-bookmark"/);
  assert.match(dialoog, /link\.noBookmarks/);
  assert.match(dialoog, /linkDoelVanBladwijzer\(/);
});
