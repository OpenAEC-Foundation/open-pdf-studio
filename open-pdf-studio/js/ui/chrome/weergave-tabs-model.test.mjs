// Hetzelfde document in meer tabbladen (#919): de boekhouding van tabbladen
// en weergaven. Eén document, meer weergaven; sluiten van een weergave laat
// het document open zolang er nog een tabblad van is.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  weergavenVan, heeftMeerWeergaven, actieveWeergaveVan, tabItems, isActiefTabItem,
  voegWeergaveToe, verwijderWeergave, klikActie, standSleutel, nieuwWeergaveId,
} from './weergave-tabs-model.js';

function ids() {
  let n = 0;
  return () => `v${++n}`;
}

const doc = (id, extra = {}) => ({ id, fileName: `${id}.pdf`, annotations: [], modified: false, ...extra });

test('a document without views is one tab, as always', () => {
  const docs = [doc('a'), doc('b')];
  assert.deepEqual(tabItems(docs), [
    { index: 0, weergave: null, nummer: 1, aantal: 1 },
    { index: 1, weergave: null, nummer: 1, aantal: 1 },
  ]);
  assert.equal(heeftMeerWeergaven(docs[0]), false);
  assert.equal(actieveWeergaveVan(docs[0]), null);
  assert.ok(isActiefTabItem(tabItems(docs)[1], docs, 1));
  assert.ok(!isActiefTabItem(tabItems(docs)[0], docs, 1));
});

test('a new view goes right after the active one and becomes active; the tabs sit next to each other', () => {
  const a = doc('a');
  const docs = [a, doc('b')];
  const maak = ids();
  assert.deepEqual(voegWeergaveToe(a, maak), { van: 'v1', naar: 'v2' });
  assert.deepEqual(a.weergaven, ['v1', 'v2']);
  assert.equal(a.actieveWeergave, 'v2');
  // Nog een, vanuit v1: komt tussen v1 en v2.
  a.actieveWeergave = 'v1';
  assert.deepEqual(voegWeergaveToe(a, maak), { van: 'v1', naar: 'v3' });
  assert.deepEqual(a.weergaven, ['v1', 'v3', 'v2']);
  assert.deepEqual(tabItems(docs).map((t) => [t.index, t.weergave, t.nummer, t.aantal]), [
    [0, 'v1', 1, 3], [0, 'v3', 2, 3], [0, 'v2', 3, 3], [1, null, 1, 1],
  ]);
  const items = tabItems(docs);
  assert.deepEqual(items.map((t) => isActiefTabItem(t, docs, 0)), [false, true, false, false]);
  assert.deepEqual(items.map((t) => isActiefTabItem(t, docs, 1)), [false, false, false, true]);
});

test('all views share the one document object: an edit through one is in the others', () => {
  const a = doc('a');
  const docs = [a];
  voegWeergaveToe(a, ids());
  const [t1, t2] = tabItems(docs);
  const viaEen = docs[t1.index];
  const viaTwee = docs[t2.index];
  assert.equal(viaEen, viaTwee);
  viaEen.annotations = [...viaEen.annotations, { id: 'x' }];
  viaEen.modified = true;
  assert.deepEqual(viaTwee.annotations.map((x) => x.id), ['x']);
  assert.equal(viaTwee.modified, true);
});

test('closing a view keeps the document open; closing the last tab closes it', () => {
  const a = doc('a');
  const maak = ids();
  voegWeergaveToe(a, maak); // v1, v2 (actief)
  voegWeergaveToe(a, maak); // v1, v2, v3 (actief)
  // Een achtergrondweergave sluiten: de actieve blijft.
  assert.deepEqual(verwijderWeergave(a, 'v1'), { sluitDocument: false, wasActief: false, nieuweActief: 'v3' });
  assert.deepEqual(a.weergaven, ['v2', 'v3']);
  // De actieve (laatste) sluiten: de buur links komt voor, en het document
  // heeft weer één tabblad.
  assert.deepEqual(verwijderWeergave(a, 'v3'), { sluitDocument: false, wasActief: true, nieuweActief: 'v2' });
  assert.equal(a.weergaven, undefined);
  assert.equal(heeftMeerWeergaven(a), false);
  assert.deepEqual(tabItems([a]), [{ index: 0, weergave: null, nummer: 1, aantal: 1 }]);
  // Nu is het één tabblad: dat sluiten sluit het document.
  assert.equal(verwijderWeergave(a, 'v2').sluitDocument, true);
});

test('closing the active view in the middle brings the right neighbour forward', () => {
  const a = doc('a');
  const maak = ids();
  voegWeergaveToe(a, maak);
  voegWeergaveToe(a, maak);
  a.weergaven = ['v1', 'v2', 'v3'];
  a.actieveWeergave = 'v2';
  assert.equal(verwijderWeergave(a, 'v2').nieuweActief, 'v3');
  assert.equal(a.actieveWeergave, 'v3');
});

test('a click switches document, or view within the active document, or does nothing', () => {
  const a = doc('a');
  const docs = [a, doc('b')];
  voegWeergaveToe(a, ids()); // v1, v2 (actief)
  const [t1, t2, tb] = tabItems(docs);
  assert.equal(klikActie(t2, docs, 0), 'niets');
  assert.equal(klikActie(t1, docs, 0), 'weergave');
  assert.equal(klikActie(tb, docs, 0), 'document');
  assert.equal(klikActie(t1, docs, 1), 'document');
  assert.equal(klikActie(tb, docs, 1), 'niets');
  assert.equal(klikActie(null, docs, 0), 'niets');
});

test('an unknown or stale active view falls back to the first', () => {
  const a = doc('a', { weergaven: ['p', 'q'], actieveWeergave: 'weg' });
  assert.equal(actieveWeergaveVan(a), 'p');
  assert.deepEqual(weergavenVan(doc('b', { weergaven: ['p'] })), []);
});

test('stand keys are per document and view; new ids are unique', () => {
  assert.notEqual(standSleutel({ id: 'a' }, 'v1'), standSleutel({ id: 'b' }, 'v1'));
  assert.ok(standSleutel({ id: 'a' }, 'v1').startsWith(standSleutel({ id: 'a' }, '')));
  const set = new Set(Array.from({ length: 50 }, () => nieuwWeergaveId()));
  assert.equal(set.size, 50);
});

// De bedrading: sluiten, Ctrl+W en de tabbalk gaan via de weergaven.
test('wiring: Ctrl+W closes one view, the tab bar renders a tab per view, closing forgets the views', () => {
  const tabs = readFileSync(new URL('./tabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /export async function closeActiveTab\(\) \{[\s\S]*?sluitActiefTabItem\(\)/);
  assert.match(tabs, /vergeetDocument\(doc\)/);
  assert.match(tabs, /naTabWissel\(newDoc\)/);
  const balk = readFileSync(new URL('../../solid/components/DocumentTabs.jsx', import.meta.url), 'utf8');
  assert.match(balk, /<For each=\{tabItems\(state\.documents\)\}>/);
  assert.match(balk, /openNieuweWeergave\(idx\)/);
  assert.match(balk, /sluitTabItem\(index, weergave\)/);
  assert.match(balk, /toonTabItem\(index, weergave\)/);
  assert.doesNotMatch(balk, /m\.closeTab\(idx\)/);
  const split = readFileSync(new URL('../../pdf/split-view/split-view.js', import.meta.url), 'utf8');
  assert.match(split, /export function leesWeergaveStand\(doc\)/);
  assert.match(split, /export async function zetWeergaveStand\(doc, stand\)/);
  const locales = ['en', 'nl'];
  for (const l of locales) {
    const common = JSON.parse(readFileSync(new URL(`../../i18n/locales/${l}/common.json`, import.meta.url), 'utf8'));
    assert.ok(common.tabs.newTabForDocument, `${l}: tabs.newTabForDocument`);
  }
});
