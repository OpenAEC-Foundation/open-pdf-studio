// Bladwijzers selecteren, verplaatsen en nesten (#690): de boomlogica.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boomVolgorde, selectieBereik, isVoorouder, topSelectie, dropToegestaan, dropPlaats,
  plaatsBladwijzers, verplaatsBladwijzers, inspringDoel, springIn, springUit, kanUitspringen,
  nestOnderNieuw, verwijderBladwijzers,
} from './bladwijzer-boom.js';

const hier = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(hier, '../../i18n/locales');

const bm = (id, parentId, sortOrder, extra = {}) => ({
  id, title: id, page: 1, parentId, sortOrder, expanded: true, bold: false, italic: false, color: null, ...extra,
});

// Tekeningenset: een platte lijst bladen plus de groep CIVIL met twee kinderen.
//   cover
//   CIVIL
//     c1
//       c1a
//     c2
//   a1, a2, a3
function set() {
  return [
    bm('a3', null, 4), bm('cover', null, 0), bm('civil', null, 1),
    bm('c2', 'civil', 1), bm('c1', 'civil', 0), bm('c1a', 'c1', 0),
    bm('a1', null, 2), bm('a2', null, 3),
  ];
}

/** De boom als geneste arrays van ids, voor leesbare vergelijkingen. */
function boom(lijst, ouder = null) {
  const opId = new Map(lijst.map(b => [b.id, b]));
  return lijst
    .filter(b => (b.parentId != null && opId.has(b.parentId) ? b.parentId : null) === ouder)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(b => {
      const kinderen = boom(lijst, b.id);
      return kinderen.length ? [b.id, kinderen] : b.id;
    });
}

test('boomvolgorde, ook alleen wat zichtbaar is', () => {
  assert.deepEqual(boomVolgorde(set()), ['cover', 'civil', 'c1', 'c1a', 'c2', 'a1', 'a2', 'a3']);
  const dicht = set().map(b => (b.id === 'c1' ? { ...b, expanded: false } : b));
  assert.deepEqual(boomVolgorde(dicht, true), ['cover', 'civil', 'c1', 'c2', 'a1', 'a2', 'a3']);
});

test('shift-klik selecteert de zichtbare bladwijzers ertussen, in beide richtingen', () => {
  assert.deepEqual(selectieBereik(set(), 'c1', 'a1'), ['c1', 'c1a', 'c2', 'a1']);
  assert.deepEqual(selectieBereik(set(), 'a2', 'civil'), ['civil', 'c1', 'c1a', 'c2', 'a1', 'a2']);
  const dicht = set().map(b => (b.id === 'civil' ? { ...b, expanded: false } : b));
  assert.deepEqual(selectieBereik(dicht, 'cover', 'a1'), ['cover', 'civil', 'a1'], 'ingeklapte kinderen niet');
  assert.deepEqual(selectieBereik(set(), null, 'a1'), ['a1'], 'zonder anker alleen de geklikte');
});

test('topselectie: een geselecteerd kind blijft onder zijn geselecteerde ouder', () => {
  assert.deepEqual(topSelectie(set(), ['a2', 'c1a', 'civil']), ['civil', 'a2']);
  assert.ok(isVoorouder(set(), 'civil', 'c1a'));
  assert.ok(!isVoorouder(set(), 'c1a', 'civil'));
});

test('drie bladwijzers op CIVIL slepen: laatste kinderen, in hun oude volgorde', () => {
  const uit = verplaatsBladwijzers(set(), ['a3', 'cover', 'a1'], 'civil', 'inside');
  assert.deepEqual(boom(uit), [['civil', [['c1', ['c1a']], 'c2', 'cover', 'a1', 'a3']], 'a2']);
});

test('op de streep tussen twee rijen: herordenen zonder nesten', () => {
  let uit = verplaatsBladwijzers(set(), ['a3'], 'a1', 'before');
  assert.deepEqual(boom(uit), ['cover', ['civil', [['c1', ['c1a']], 'c2']], 'a3', 'a1', 'a2']);
  uit = verplaatsBladwijzers(set(), ['cover'], 'a2', 'after');
  assert.deepEqual(boom(uit), [['civil', [['c1', ['c1a']], 'c2']], 'a1', 'a2', 'cover', 'a3']);
  // Op het niveau van de rij: vóór c2 is een kind van CIVIL.
  uit = verplaatsBladwijzers(set(), ['a1'], 'c2', 'before');
  assert.deepEqual(boom(uit), ['cover', ['civil', [['c1', ['c1a']], 'a1', 'c2']], 'a2', 'a3']);
  // sortOrder per groep opnieuw genummerd, zonder gaten.
  assert.deepEqual(uit.filter(b => b.parentId === 'civil').map(b => b.sortOrder).sort(), [0, 1, 2]);
});

test('onder een opengeklapte ouder wordt het het eerste kind; dichtgeklapt erna', () => {
  let uit = verplaatsBladwijzers(set(), ['a3'], 'civil', 'after');
  assert.deepEqual(boom(uit), ['cover', ['civil', ['a3', ['c1', ['c1a']], 'c2']], 'a1', 'a2']);
  const dicht = set().map(b => (b.id === 'civil' ? { ...b, expanded: false } : b));
  uit = verplaatsBladwijzers(dicht, ['a3'], 'civil', 'after');
  assert.deepEqual(boom(uit), ['cover', ['civil', [['c1', ['c1a']], 'c2']], 'a3', 'a1', 'a2']);
});

test('nesten klapt de nieuwe ouder open', () => {
  const dicht = set().map(b => (b.id === 'a1' ? { ...b, expanded: false } : b));
  const uit = verplaatsBladwijzers(dicht, ['a2'], 'a1', 'inside');
  assert.equal(uit.find(b => b.id === 'a1').expanded, true);
  assert.equal(uit.find(b => b.id === 'a2').parentId, 'a1');
});

test('in zichzelf of een eigen kind laten vallen wordt geweigerd en verandert niets', () => {
  const voor = set();
  const kopie = JSON.parse(JSON.stringify(voor));
  assert.equal(dropToegestaan(voor, ['civil'], 'c1a'), false);
  assert.equal(dropToegestaan(voor, ['civil'], 'civil'), false);
  assert.equal(dropToegestaan(voor, ['c1', 'a1'], 'c1a'), false);
  assert.equal(verplaatsBladwijzers(voor, ['civil'], 'c1a', 'inside'), null);
  assert.equal(verplaatsBladwijzers(voor, ['civil'], 'c1', 'before'), null);
  assert.equal(plaatsBladwijzers(voor, ['civil'], { ouder: 'c1' }), null);
  assert.deepEqual(voor, kopie, 'invoer onaangeroerd');
  assert.equal(dropToegestaan(voor, [], 'a1'), false, 'lege selectie');
  assert.equal(dropToegestaan(voor, ['a1'], 'bestaat-niet'), false);
});

test('een verplaatsing die niets verandert geeft null (geen lege undo-stap)', () => {
  assert.equal(verplaatsBladwijzers(set(), ['a1'], 'a2', 'before'), null);
  assert.equal(verplaatsBladwijzers(set(), ['a2'], 'a1', 'after'), null);
  assert.equal(verplaatsBladwijzers(set(), ['c2'], 'civil', 'inside'), null, 'al het laatste kind');
});

test('naar het einde van de lijst (lege ruimte onderaan)', () => {
  const uit = verplaatsBladwijzers(set(), ['c1'], null, 'end');
  assert.deepEqual(boom(uit), ['cover', ['civil', ['c2']], 'a1', 'a2', 'a3', ['c1', ['c1a']]]);
  assert.deepEqual(dropPlaats(set(), ['c1'], null, 'end'), { ouder: null, voor: null });
});

test('verplaatsen geeft kopieën; het origineel blijft voor undo', () => {
  const voor = set();
  const uit = verplaatsBladwijzers(voor, ['a1'], 'civil', 'inside');
  assert.equal(voor.find(b => b.id === 'a1').parentId, null);
  assert.notEqual(uit.find(b => b.id === 'a1'), voor.find(b => b.id === 'a1'));
  assert.equal(uit.length, voor.length);
});

test('inspringen: kind van de bladwijzer erboven; uitspringen: direct na de vroegere ouder', () => {
  assert.equal(inspringDoel(set(), ['a1', 'a2']), 'civil');
  let uit = springIn(set(), ['a1', 'a2']);
  assert.deepEqual(boom(uit), ['cover', ['civil', [['c1', ['c1a']], 'c2', 'a1', 'a2']], 'a3']);
  assert.equal(springIn(set(), ['cover']), null, 'niets erboven');
  assert.equal(springIn(set(), ['c1']), null, 'eerste kind: niets erboven op dat niveau');

  uit = springUit(set(), ['c1']);
  assert.deepEqual(boom(uit), ['cover', ['civil', ['c2']], ['c1', ['c1a']], 'a1', 'a2', 'a3']);
  uit = springUit(set(), ['c1', 'c2']);
  assert.deepEqual(boom(uit), ['cover', 'civil', ['c1', ['c1a']], 'c2', 'a1', 'a2', 'a3']);
  assert.equal(springUit(set(), ['a1']), null, 'wortel kan niet hoger');
  assert.equal(kanUitspringen(set(), ['a1']), false);
  assert.equal(kanUitspringen(set(), ['a1', 'c1a']), true);
});

test('nesten onder een nieuwe bladwijzer: op de plaats van de eerste, alles eronder', () => {
  // Shift-bereik van tien bladen onder STRUCTURAL.
  const lijst = [bm('cover', null, 0)];
  for (let i = 1; i <= 10; i++) lijst.push(bm(`s${i}`, null, i, { page: i + 1 }));
  lijst.push(bm('eind', null, 11));
  const ids = selectieBereik(lijst, 's1', 's10');
  assert.equal(ids.length, 10);
  const uit = nestOnderNieuw(lijst, ids, bm('structural', null, 0, { title: 'STRUCTURAL', page: 2 }));
  assert.deepEqual(boom(uit), ['cover', ['structural', ids], 'eind']);
  assert.equal(uit.find(b => b.id === 'structural').expanded, true);
  // Midden in een groep: de nieuwe komt onder dezelfde ouder.
  const genest = nestOnderNieuw(set(), ['c2'], bm('n', null, 0));
  assert.deepEqual(boom(genest), ['cover', ['civil', [['c1', ['c1a']], ['n', ['c2']]]], 'a1', 'a2', 'a3']);
});

test('meervoudig verwijderen neemt alles eronder mee', () => {
  const { bookmarks, verwijderd, aantalGeselecteerd } = verwijderBladwijzers(set(), ['c1', 'a2', 'c1a']);
  assert.deepEqual(verwijderd.map(b => b.id).sort(), ['a2', 'c1', 'c1a']);
  assert.equal(aantalGeselecteerd, 2);
  assert.deepEqual(boom(bookmarks), ['cover', ['civil', ['c2']], 'a1', 'a3']);
});

test('een wees (ouder bestaat niet) telt als wortel, net als in de saver', () => {
  const lijst = [bm('a', null, 0), bm('wees', 'weg', 1), bm('b', null, 2)];
  assert.deepEqual(boomVolgorde(lijst), ['a', 'wees', 'b']);
  const uit = verplaatsBladwijzers(lijst, ['b'], 'a', 'before');
  assert.deepEqual(boom(uit), ['b', 'a', 'wees']);
});

test('alle 40 talen hebben de nieuwe bladwijzeropdrachten', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const ctx = JSON.parse(readFileSync(join(LOCALES, taal, 'context.json'), 'utf8')).bookmark;
    for (const s of ['nestUnderNew', 'indent', 'outdent', 'deleteBookmarks']) {
      assert.ok(typeof ctx[s] === 'string' && ctx[s].trim(), `${taal} context.bookmark.${s}`);
    }
    assert.ok(ctx.deleteBookmarks.includes('{{count}}'), `${taal}: deleteBookmarks heeft {{count}}`);
    const dlg = JSON.parse(readFileSync(join(LOCALES, taal, 'dialogs.json'), 'utf8')).bookmark;
    for (const s of ['nestTitle', 'deleteTitle', 'deleteConfirm']) {
      assert.ok(typeof dlg[s] === 'string' && dlg[s].trim(), `${taal} dialogs.bookmark.${s}`);
    }
    assert.ok(dlg.deleteConfirm.includes('{{count}}'), `${taal}: deleteConfirm heeft {{count}}`);
  }
});

test('paneel, menu en undo zijn aangesloten', () => {
  const paneel = readFileSync(join(hier, '../../solid/components/left-panel/panels/BookmarksPanel.jsx'), 'utf8');
  for (const s of ['createBookmarkPointerDrag', 'toggleBookmarkSelection', 'selectBookmarkRange', 'moveBookmarks']) {
    assert.ok(paneel.includes(s), `paneel gebruikt ${s}`);
  }
  const menu = readFileSync(join(hier, '../../solid/components/ContextMenu.jsx'), 'utf8');
  const blok = menu.slice(menu.indexOf('function BookmarkMenuContent'), menu.indexOf('function ThumbnailMenuContent'));
  for (const s of ['nestBookmarksUnderNew', 'indentBookmarks', 'outdentBookmarks', 'bookmark.deleteBookmarks']) {
    assert.ok(blok.includes(s), `bladwijzermenu gebruikt ${s}`);
  }
  const logica = readFileSync(join(hier, 'bookmarks.js'), 'utf8');
  for (const s of ['verplaatsBladwijzers', 'springIn', 'springUit', 'nestOnderNieuw', 'verwijderBladwijzers']) {
    assert.ok(logica.includes(s), `bookmarks.js gebruikt ${s}`);
  }
});

test('sleeppositie: bovenste kwart ervoor, onderste kwart erna, midden erin', async () => {
  const { sleepPositie } = await import('./bladwijzer-boom.js');
  assert.equal(sleepPositie(100, 20, 101), 'before');
  assert.equal(sleepPositie(100, 20, 110), 'inside');
  assert.equal(sleepPositie(100, 20, 119), 'after');
  assert.equal(sleepPositie(100, 0, 100), 'inside');
});
