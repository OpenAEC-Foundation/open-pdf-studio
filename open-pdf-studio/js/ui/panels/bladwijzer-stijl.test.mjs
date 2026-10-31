// Bladwijzers: kleur en vet/cursief instellen vanuit het paneel (#689).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BLADWIJZER_KLEUREN, kleurLabelSleutel, normaliseerKleur, zetBladwijzerStijl, stijlVanSelectie,
  leesCssKleur, contrast, weergaveKleur,
} from './bladwijzer-stijl.js';

const hier = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(hier, '../../i18n/locales');

const bm = (id, extra = {}) => ({ id, title: id, page: 1, parentId: null, sortOrder: 0, bold: false, italic: false, color: null, ...extra });

test('kleuren normaliseren naar #rrggbb', () => {
  assert.equal(normaliseerKleur('#E81123'), '#e81123');
  assert.equal(normaliseerKleur('0078D7'), '#0078d7');
  assert.equal(normaliseerKleur('#f00'), '#ff0000');
  assert.equal(normaliseerKleur(''), null);
  assert.equal(normaliseerKleur('rood'), null);
  assert.equal(normaliseerKleur(null), null);
  for (const k of BLADWIJZER_KLEUREN) assert.equal(normaliseerKleur(k.hex), k.hex, `${k.sleutel} staat genormaliseerd`);
});

test('stijl zetten: alleen de gekozen bladwijzers, als kopie, met wat verandert', () => {
  const a = bm('a'); const b = bm('b', { bold: true }); const c = bm('c', { color: '#808080' });
  const lijst = [a, b, c];
  const { bookmarks, gewijzigd } = zetBladwijzerStijl(lijst, ['a', 'c'], { color: '#E81123' });
  assert.equal(gewijzigd, true);
  assert.equal(bookmarks[0].color, '#e81123');
  assert.equal(bookmarks[2].color, '#e81123');
  assert.equal(bookmarks[1], b, 'niet gekozen: hetzelfde object');
  assert.notEqual(bookmarks[0], a, 'gekozen: een kopie');
  assert.equal(a.color, null, 'het origineel blijft (undo bewaart het)');
  assert.equal(bookmarks[0].bold, false, 'velden die niet meedoen blijven');
});

test('stijl zetten: Standaard haalt de kleur weg; vet en cursief los te zetten', () => {
  const lijst = [bm('a', { color: '#e81123' }), bm('b')];
  let r = zetBladwijzerStijl(lijst, ['a'], { color: null });
  assert.equal(r.bookmarks[0].color, null);
  r = zetBladwijzerStijl(r.bookmarks, ['a', 'b'], { bold: true });
  assert.deepEqual(r.bookmarks.map(x => x.bold), [true, true]);
  r = zetBladwijzerStijl(r.bookmarks, ['b'], { italic: true });
  assert.deepEqual(r.bookmarks.map(x => [x.bold, x.italic]), [[true, false], [true, true]]);
});

test('stijl zetten zonder verschil is geen wijziging (geen lege undo-stap)', () => {
  const lijst = [bm('a', { color: '#e81123', bold: true })];
  assert.equal(zetBladwijzerStijl(lijst, ['a'], { color: '#E81123' }).gewijzigd, false);
  assert.equal(zetBladwijzerStijl(lijst, ['a'], { bold: true }).gewijzigd, false);
  assert.equal(zetBladwijzerStijl(lijst, [], { bold: false }).gewijzigd, false);
  assert.equal(zetBladwijzerStijl(lijst, ['onbekend'], { bold: false }).gewijzigd, false);
  assert.equal(zetBladwijzerStijl(null, ['a'], { bold: false }).gewijzigd, false);
});

test('vinkjes voor het menu: vet alleen als alle geselecteerde vet zijn, kleur alleen als gelijk', () => {
  const lijst = [bm('a', { bold: true, color: '#e81123' }), bm('b', { bold: true, color: '#e81123', italic: true }), bm('c')];
  assert.deepEqual(stijlVanSelectie(lijst, ['a', 'b']), { bold: true, italic: false, color: '#e81123', aantal: 2 });
  assert.equal(stijlVanSelectie(lijst, ['a', 'c']).bold, false);
  assert.equal(stijlVanSelectie(lijst, ['a', 'c']).color, undefined, 'gemengd: geen kleur aangevinkt');
  assert.equal(stijlVanSelectie(lijst, ['c']).color, null, 'zonder kleur: Standaard aangevinkt');
  assert.equal(stijlVanSelectie(lijst, []).aantal, 0);
});

test('weergave: een donkere kleur wordt op een donker thema lichter, het model niet', () => {
  const donker = [30, 30, 30];
  const licht = [255, 255, 255];
  assert.equal(weergaveKleur('#e81123', licht), '#e81123', 'genoeg contrast: ongewijzigd');
  const navy = weergaveKleur('#000080', donker);
  assert.notEqual(navy, '#000080');
  assert.ok(contrast(leesCssKleur(navy), donker) >= 3, `${navy} is leesbaar op donker`);
  const geel = weergaveKleur('#ffff66', licht);
  assert.ok(contrast(leesCssKleur(geel), licht) >= 3, `${geel} is leesbaar op wit`);
  assert.equal(weergaveKleur('#000080', null), '#000080', 'achtergrond onbekend: ongewijzigd');
  assert.equal(weergaveKleur(null, donker), null);
});

test('css-kleuren lezen, transparant telt niet', () => {
  assert.deepEqual(leesCssKleur('rgb(30, 31, 32)'), [30, 31, 32]);
  assert.deepEqual(leesCssKleur('rgba(30, 31, 32, 0.5)'), [30, 31, 32]);
  assert.equal(leesCssKleur('rgba(0, 0, 0, 0)'), null);
  assert.deepEqual(leesCssKleur('#ffffff'), [255, 255, 255]);
  assert.equal(leesCssKleur('transparent'), null);
});

test('alle 40 talen hebben kleur, vet en cursief voor bladwijzers', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const lees = (taal, ns) => JSON.parse(readFileSync(join(LOCALES, taal, `${ns}.json`), 'utf8')).bookmark || {};
  const menu = ['color', 'colorDefault', 'colorCustom', 'bold', 'italic', ...BLADWIJZER_KLEUREN.map(k => kleurLabelSleutel(k.sleutel).slice('bookmark.'.length))];
  for (const taal of talen) {
    const ctx = lees(taal, 'context');
    for (const s of menu) assert.ok(typeof ctx[s] === 'string' && ctx[s].trim(), `${taal} context.bookmark.${s}`);
    const dlg = lees(taal, 'dialogs');
    for (const s of ['colorLabel', 'styleLabel']) assert.ok(typeof dlg[s] === 'string' && dlg[s].trim(), `${taal} dialogs.bookmark.${s}`);
  }
});

test('menu en dialoog zijn aangesloten op het model', () => {
  const menu = readFileSync(join(hier, '../../solid/components/ContextMenu.jsx'), 'utf8');
  const blok = menu.slice(menu.indexOf('function BookmarkMenuContent'), menu.indexOf('function ThumbnailMenuContent'));
  for (const s of ["'bookmark.color'", 'setBookmarkStyle', 'toggleBookmarkBold', 'toggleBookmarkItalic', 'BLADWIJZER_KLEUREN', 'bookmark.colorCustom']) {
    assert.ok(blok.includes(s), `bladwijzermenu gebruikt ${s}`);
  }
  const dialoog = readFileSync(join(hier, '../../solid/components/dialogs/BookmarkDialog.jsx'), 'utf8');
  assert.match(dialoog, /onOk\(\{ title: t, page: p, color: kleur\(\), bold: vet\(\), italic: cursief\(\) \}\)/);
  const paneel = readFileSync(join(hier, 'bookmarks.js'), 'utf8');
  assert.match(paneel, /await vervangLijst\(doc, oud, bookmarks\)/, 'stijl op de selectie gaat via één lijstwissel');
  assert.match(paneel, /recordBookmarksChange\(oud, nieuw\)/, 'een lijstwissel is één undo-stap');
  assert.match(paneel, /color: result\.color \|\| null/, 'bewerken geeft de kleur door');
  const bewerken = readFileSync(join(hier, 'bladwijzer-bewerken.js'), 'utf8');
  assert.match(bewerken, /bm\.color = wijziging\.color \|\| null/, 'bewerken neemt de kleur over');
});
