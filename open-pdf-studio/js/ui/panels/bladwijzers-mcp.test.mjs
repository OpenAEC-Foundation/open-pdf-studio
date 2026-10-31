// De MCP-opdracht app_bookmarks: opvragen, toevoegen, wijzigen, verwijderen en
// verplaatsen, door dezelfde functies als het bladwijzerpaneel
// (bladwijzer-bewerken.js, met de echte boomlogica van bladwijzer-boom.js).
// Alleen undo, tabbladen en paneel zijn nagebootst.

import basisTest from 'node:test';
import assert from 'node:assert/strict';

import { bookmarks } from './bladwijzers-mcp.js';

// Ook tegen een document dat, zoals in de app, bij toewijzen een kopie bewaart.
function documentMet(lijst, kopie) {
  const doc = { pdfDoc: { numPages: 5 }, currentPage: 2 };
  if (!kopie) return Object.assign(doc, { bookmarks: lijst });
  let opgeslagen = structuredClone(lijst);
  Object.defineProperty(doc, 'bookmarks', {
    enumerable: true,
    get: () => opgeslagen,
    set: (w) => { opgeslagen = structuredClone(w); },
  });
  return doc;
}

const test = (naam, fn) => {
  for (const kopie of [false, true]) basisTest(`${kopie ? 'kopie bij toewijzen' : 'kaal object'}: ${naam}`, () => fn(kopie));
};

const bm = (id, title, page, parentId = null, sortOrder = 0, extra = {}) => ({
  id, title, page, parentId, sortOrder, expanded: true, bold: false, italic: false, color: null, top: null, left: null, zoom: null, fromPdf: true, ...extra,
});

// Architectuur (1) > [Plattegrond (2), Gevels (3)], Constructie (4)
const SET = () => [
  bm('arch', 'Architectuur', 1, null, 0),
  bm('pg', 'Plattegrond', 2, 'arch', 0),
  bm('gv', 'Gevels', 3, 'arch', 1),
  bm('con', 'Constructie', 4, null, 1),
];

function opstelling(kopie, { alleenLezen = false, lijst = SET() } = {}) {
  const doc = documentMet(lijst, kopie);
  const stappen = [];
  const o = {
    document: () => doc,
    alleenLezen: () => alleenLezen,
    bewerken: {
      legToevoegenVast: (b) => stappen.push(['add', b.id]),
      legWijzigingVast: (id, oud, nieuw) => stappen.push(['modify', id, oud.title, nieuw.title]),
      legVerwijderenVast: (weg) => stappen.push(['remove', weg.map((b) => b.id)]),
      legLijstVast: (oud, nieuw) => stappen.push(['set', oud.length, nieuw.length]),
      markeerGewijzigd: (d) => { d.modified = true; },
      ververs: () => stappen.push('ververs'),
    },
  };
  return { doc, o, stappen };
}

const titels = (r) => r.bookmarks.map((b) => `${'  '.repeat(b.level)}${b.title}`);

test('list: in de volgorde van het paneel, met niveau, ouder en aantal kinderen', async (kopie) => {
  const { o } = opstelling(kopie);
  const r = await bookmarks({ action: 'list' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.count, 4);
  assert.deepEqual(titels(r), ['Architectuur', '  Plattegrond', '  Gevels', 'Constructie']);
  assert.deepEqual(r.bookmarks[0], { id: 'arch', title: 'Architectuur', page: 1, parentId: null, level: 0, children: 2, bold: false, italic: false, color: null });
});

test('add: achteraan onder de ouder, standaard op de huidige pagina, één undo-stap', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie);
  const r = await bookmarks({ action: 'add', title: '  Doorsneden ', parentId: 'arch', bold: true, color: '#FF0000' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.bookmark.title, 'Doorsneden');
  assert.equal(r.bookmark.page, 2, 'de huidige pagina');
  assert.equal(r.bookmark.parentId, 'arch');
  assert.equal(r.bookmark.level, 1);
  assert.equal(r.bookmark.bold, true);
  assert.equal(r.bookmark.color, '#ff0000');
  assert.equal(doc.modified, true);
  assert.deepEqual(stappen, [['add', r.bookmark.id], 'ververs']);
  const lijst = await bookmarks({ action: 'list' }, o);
  assert.deepEqual(titels(lijst), ['Architectuur', '  Plattegrond', '  Gevels', '  Doorsneden', 'Constructie']);
  const wortel = await bookmarks({ action: 'add', title: 'Installaties', page: 5 }, o);
  assert.equal(wortel.bookmark.level, 0);
  assert.equal((await bookmarks({ action: 'list' }, o)).bookmarks.at(-1).title, 'Installaties');
});

test('add: argumenten gecontroleerd, niets toegevoegd bij een fout', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie);
  const fout = async (p) => (await bookmarks({ action: 'add', ...p }, o)).error;
  assert.match(await fout({}), /title must be a non-empty string/);
  assert.match(await fout({ title: '   ' }), /title must be a non-empty string/);
  assert.match(await fout({ title: 'a\nb' }), /control characters/);
  assert.match(await fout({ title: 'x'.repeat(1001) }), /longer than 1000/);
  assert.match(await fout({ title: 'A', page: 6 }), /page must be a page number from 1 to 5/);
  assert.match(await fout({ title: 'A', page: 0 }), /page must be/);
  assert.match(await fout({ title: 'A', parentId: 'nope' }), /unknown parentId: nope/);
  assert.match(await fout({ title: 'A', color: 'red' }), /#rrggbb/);
  assert.match(await fout({ title: 'A', bold: 'ja' }), /bold must be a boolean/);
  assert.match(await fout({ title: 'A', ids: ['arch'] }), /unknown argument: ids/);
  assert.equal(doc.bookmarks.length, 4);
  assert.deepEqual(stappen, []);
});

test('update: hernoemen, andere pagina, kleur wissen; alleen wat gegeven is', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie, { lijst: [...SET().slice(0, 3), bm('con', 'Constructie', 4, null, 1, { color: '#00ff00' })] });
  const r = await bookmarks({ action: 'update', id: 'con', title: 'Constructie (rev B)', page: 5, color: null }, o);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['title', 'page', 'color']);
  assert.equal(r.bookmark.title, 'Constructie (rev B)');
  assert.equal(r.bookmark.page, 5);
  assert.equal(r.bookmark.color, null);
  assert.deepEqual(stappen, [['modify', 'con', 'Constructie', 'Constructie (rev B)'], 'ververs']);
  assert.equal(doc.bookmarks.find((b) => b.id === 'con').title, 'Constructie (rev B)');
  assert.match((await bookmarks({ action: 'update', id: 'con' }, o)).error, /nothing to update/);
  assert.match((await bookmarks({ action: 'update', id: 'weg', title: 'X' }, o)).error, /unknown bookmark id: weg/);
  assert.match((await bookmarks({ action: 'update', id: 'con', parentId: 'arch' }, o)).error, /unknown argument: parentId/);
});

test('delete: met alles eronder, als één stap', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie);
  const r = await bookmarks({ action: 'delete', ids: ['arch'] }, o);
  assert.deepEqual(r, { ok: true, deleted: ['arch', 'pg', 'gv'], count: 3, remaining: 1 });
  assert.deepEqual(doc.bookmarks.map((b) => b.id), ['con']);
  assert.deepEqual(stappen, [['remove', ['arch', 'pg', 'gv']], 'ververs']);
  assert.match((await bookmarks({ action: 'delete', ids: ['arch'] }, o)).error, /unknown bookmark id: arch/);
  assert.match((await bookmarks({ action: 'delete', ids: [] }, o)).error, /non-empty array/);
  assert.match((await bookmarks({ action: 'delete', id: 'con' }, o)).error, /unknown argument: id/);
});

test('move: vóór, na, in en naar het eind; één lijstwissel per stap', async (kopie) => {
  const { o, stappen } = opstelling(kopie);
  let r = await bookmarks({ action: 'move', ids: ['con'], targetId: 'gv', position: 'before' }, o);
  assert.equal(r.ok, true);
  assert.deepEqual(titels(r), ['Architectuur', '  Plattegrond', '  Constructie', '  Gevels']);
  r = await bookmarks({ action: 'move', ids: ['pg'], targetId: 'gv', position: 'after' }, o);
  assert.deepEqual(titels(r), ['Architectuur', '  Constructie', '  Gevels', '  Plattegrond']);
  r = await bookmarks({ action: 'move', ids: ['con'], position: 'end' }, o);
  assert.deepEqual(titels(r), ['Architectuur', '  Gevels', '  Plattegrond', 'Constructie']);
  r = await bookmarks({ action: 'move', ids: ['arch'], targetId: 'con', position: 'inside' }, o);
  assert.deepEqual(titels(r), ['Constructie', '  Architectuur', '    Gevels', '    Plattegrond']);
  assert.equal(stappen.filter((s) => s[0] === 'set').length, 4);
});

test('move "after" een opengeklapte ouder: ernaast, niet als eerste kind (anders dan slepen)', async (kopie) => {
  const { o } = opstelling(kopie);
  const r = await bookmarks({ action: 'move', ids: ['con'], targetId: 'arch', position: 'after' }, o);
  // Staat al direct na arch: niets te doen.
  assert.equal(r.ok, false);
  const voor = await bookmarks({ action: 'move', ids: ['con'], targetId: 'arch', position: 'before' }, o);
  assert.deepEqual(titels(voor), ['Constructie', 'Architectuur', '  Plattegrond', '  Gevels']);
  const na = await bookmarks({ action: 'move', ids: ['con'], targetId: 'arch', position: 'after' }, o);
  assert.deepEqual(titels(na), ['Architectuur', '  Plattegrond', '  Gevels', 'Constructie']);
});

test('move: niet in zichzelf of een eigen kind, en de argumenten kloppen', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie);
  const r = await bookmarks({ action: 'move', ids: ['arch'], targetId: 'pg', position: 'inside' }, o);
  assert.equal(r.ok, false);
  assert.match(r.error, /move refused/);
  assert.match((await bookmarks({ action: 'move', ids: ['arch'], targetId: 'arch', position: 'before' }, o)).error, /move refused/);
  assert.match((await bookmarks({ action: 'move', ids: ['pg'], position: 'sideways', targetId: 'gv' }, o)).error, /position must be one of/);
  assert.match((await bookmarks({ action: 'move', ids: ['pg'], position: 'before' }, o)).error, /unknown targetId/);
  assert.match((await bookmarks({ action: 'move', ids: ['pg'], position: 'end', targetId: 'gv' }, o)).error, /takes no targetId/);
  assert.match((await bookmarks({ action: 'move', ids: ['zz'], position: 'end' }, o)).error, /unknown bookmark id: zz/);
  assert.deepEqual(doc.bookmarks.map((b) => b.id), ['arch', 'pg', 'gv', 'con']);
  assert.deepEqual(stappen, []);
});

test('alleen-lezen: lijst mag, wijzigen niet', async (kopie) => {
  const { doc, o, stappen } = opstelling(kopie, { alleenLezen: true });
  assert.equal((await bookmarks({ action: 'list' }, o)).count, 4);
  for (const p of [
    { action: 'add', title: 'X' },
    { action: 'update', id: 'con', title: 'X' },
    { action: 'delete', ids: ['con'] },
    { action: 'move', ids: ['con'], position: 'end' },
  ]) {
    const r = await bookmarks(p, o);
    assert.equal(r.readOnly, true, p.action);
  }
  assert.equal(doc.bookmarks.length, 4);
  assert.deepEqual(stappen, []);
});

test('onbekende actie en geen document', async (kopie) => {
  const { o } = opstelling(kopie);
  assert.match((await bookmarks({ action: 'rename' }, o)).error, /action must be one of: list, add, update, delete, move/);
  assert.match((await bookmarks({ action: 'list', x: 1 }, o)).error, /unknown argument: x/);
  o.document = () => null;
  assert.deepEqual(await bookmarks({ action: 'list' }, o), { ok: false, error: 'no active document' });
});
