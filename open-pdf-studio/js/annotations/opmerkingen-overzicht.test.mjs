// Het opmerkingenoverzicht (#383): filteren over alle pagina's, sorteren,
// status in bulk en de uitsnede voor het rapport.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auteurVan, statusSleutel, leegFilter, normaliseerFilter, filterActief,
  voldoetAanFilter, filterOpmerkingen, auteursIn, typesIn, laatsteStatusAuteur,
  vergelijkerVoor, sorteerOpmerkingen, statusDoelen, zetStatus, BULK_STATUSSEN, uitsnedeVoor,
} from './opmerkingen-overzicht.js';

const iso = (j, m, d, u = 12) => new Date(j, m - 1, d, u, 0).toISOString();

const ANNS = [
  { id: 'a', page: 1, type: 'comment', author: 'Anna', status: 'accepted', createdAt: iso(2026, 3, 1), modifiedAt: iso(2026, 3, 2) },
  { id: 'b', page: 7, type: 'box', author: 'Bram', createdAt: iso(2026, 3, 5) },
  { id: 'c', page: 3, type: 'comment', author: 'Anna', status: 'Rejected', createdAt: iso(2026, 2, 1) },
  { id: 'd', page: 12, type: 'arrow', createdAt: iso(2026, 4, 1) },
  { id: 'e', page: 3, type: 'box', author: 'anna', status: 'completed', createdAt: iso(2026, 3, 10) },
];
const ids = (lijst) => lijst.map((a) => a.id);

test('auteurVan en statusSleutel: standaardwaarden zoals de lijst', () => {
  assert.equal(auteurVan({}), 'User');
  assert.equal(auteurVan({ author: 'X' }), 'X');
  assert.equal(statusSleutel({}), 'none');
  assert.equal(statusSleutel({ status: 'Accepted' }), 'accepted');
});

test('leeg filter laat alles door', () => {
  assert.equal(filterActief(leegFilter()), false);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, leegFilter())), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, null)), ['a', 'b', 'c', 'd', 'e']);
});

test('filter op auteur werkt over alle pagina\'s, exact en hoofdlettergevoelig', () => {
  const f = { auteur: 'Anna' };
  assert.equal(filterActief(f), true);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, f)), ['a', 'c']);
  // Zonder auteur heet hij 'User', ook in het filter.
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { auteur: 'User' })), ['d']);
});

test('filter op status (Tonen > Status) werkt over alle pagina\'s, hoofdletter-ongevoelig', () => {
  const verborgenStatussen = new Set(['rejected', 'none']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, leegFilter(), { verborgenStatussen })), ['a', 'e']);
});

test('auteur en status samen', () => {
  const uit = filterOpmerkingen(ANNS, { auteur: 'Anna' }, { verborgenStatussen: new Set(['accepted']) });
  assert.deepEqual(ids(uit), ['c']);
});

test('filter op soort', () => {
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { type: 'box' })), ['b', 'e']);
});

test('paginabereik: grenzen tellen mee, omgekeerd bereik wordt omgedraaid', () => {
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { paginaVan: 3, paginaTot: 7 })), ['b', 'c', 'e']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { paginaVan: '7', paginaTot: '3' })), ['b', 'c', 'e']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { paginaVan: 10 })), ['d']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { paginaTot: 1 })), ['a']);
  // Ongeldige invoer telt als leeg.
  assert.deepEqual(normaliseerFilter({ paginaVan: 'x', paginaTot: -2 }).paginaVan, null);
  assert.equal(filterActief({ paginaVan: '', datumVan: 'gisteren' }), false);
});

test('datumbereik: gewijzigd, anders aangemaakt; grenzen inclusief', () => {
  // a is gewijzigd op 2 maart: telt op die datum, niet op 1 maart.
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { datumVan: '2026-03-02', datumTot: '2026-03-05' })), ['a', 'b']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { datumTot: '2026-02-28' })), ['c']);
  assert.deepEqual(ids(filterOpmerkingen(ANNS, { datumVan: '2026-04-01' })), ['d']);
  // Zonder datum valt een opmerking buiten elk datumbereik.
  assert.equal(voldoetAanFilter({ id: 'z', page: 1 }, { datumVan: '2000-01-01' }), false);
});

test('keuzelijsten: auteurs en soorten uniek en gesorteerd', () => {
  assert.deepEqual(auteursIn(ANNS), ['anna', 'Anna', 'Bram', 'User']);
  assert.deepEqual(typesIn(ANNS, (t) => t.toUpperCase()), [
    { type: 'arrow', naam: 'ARROW' }, { type: 'box', naam: 'BOX' }, { type: 'comment', naam: 'COMMENT' },
  ]);
});

test('sorteren op pagina, dan aanmaakdatum (standaard)', () => {
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'page')), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'onbekend')), ['a', 'c', 'e', 'b', 'd']);
});

test('sorteren op auteur (hoofdletter-ongevoelig), status, soort en datums', () => {
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'author')), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'status')), ['a', 'e', 'b', 'd', 'c']);
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'type')), ['d', 'e', 'b', 'a', 'c']);
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'creationDate')), ['d', 'e', 'b', 'a', 'c']);
  // Zonder wijzigingsdatum telt een opmerking als oudst.
  assert.equal(ids(sorteerOpmerkingen(ANNS, 'modifiedDate'))[0], 'a');
  assert.deepEqual(ids(sorteerOpmerkingen(ANNS, 'statusAndAuthor')), ['a', 'e', 'b', 'd', 'c']);
});

test('sorteren geeft een kopie en laat de invoer staan', () => {
  const invoer = [...ANNS];
  sorteerOpmerkingen(invoer, 'author');
  assert.deepEqual(ids(invoer), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(typeof vergelijkerVoor('color'), 'function');
});

test('laatste-statusauteur: de laatste reactie met auteur, anders de auteur', () => {
  assert.equal(laatsteStatusAuteur({ author: 'A', replies: [{ author: 'B' }, { text: 'x' }] }), 'B');
  assert.equal(laatsteStatusAuteur({ author: 'A' }), 'A');
  const lijst = [
    { id: 'p', page: 1, author: 'Z', replies: [{ author: 'Bea' }] },
    { id: 'q', page: 1, author: 'Ad' },
  ];
  assert.deepEqual(ids(sorteerOpmerkingen(lijst, 'lastStatusAuthor')), ['q', 'p']);
});

test('statusDoelen: vergrendeld, al goed of dubbel valt af', () => {
  const a = { id: 'a', status: 'Accepted' };
  const b = { id: 'b' };
  const c = { id: 'c', locked: true };
  assert.deepEqual(ids(statusDoelen([a, b, c, b, null], 'accepted')), ['b']);
  assert.deepEqual(ids(statusDoelen([a, b, c], 'none')), ['a']);
  assert.deepEqual([...BULK_STATUSSEN], ['none', 'accepted', 'cancelled', 'completed', 'rejected']);
});

test('zetStatus: stempelt wie en wanneer; none haalt alles weg', () => {
  const ann = { id: 'x' };
  zetStatus(ann, 'Completed', { door: 'Kees', nu: '2026-10-27T10:00:00.000Z' });
  assert.deepEqual(ann, { id: 'x', status: 'completed', statusBy: 'Kees', statusAt: '2026-10-27T10:00:00.000Z', modifiedAt: '2026-10-27T10:00:00.000Z' });
  zetStatus(ann, 'none', { nu: '2026-10-28T10:00:00.000Z' });
  assert.equal(ann.status, undefined);
  assert.equal('statusBy' in ann, false);
  assert.equal('statusAt' in ann, false);
  assert.equal(ann.modifiedAt, '2026-10-28T10:00:00.000Z');
});

test('uitsnedeVoor: marge rond de opmerking, binnen de pagina, kader in het deel', () => {
  const u = uitsnedeVoor({ x: 100, y: 200, width: 100, height: 50 }, { breedte: 595, hoogte: 842 });
  // marge = max(24, 15% van 100) = 24; gebied 76..224 x 176..274 (148 x 98).
  assert.ok(Math.abs(u.schaal - 480 / 148) < 1e-9);
  assert.equal(u.deel.x, Math.floor(76 * u.schaal));
  assert.equal(u.deel.y, Math.floor(176 * u.schaal));
  assert.ok(Math.abs(u.kader.x - (100 * u.schaal - u.deel.x)) < 1e-9);
  assert.ok(Math.abs(u.kader.breedte - 100 * u.schaal) < 1e-9);
});

test('uitsnedeVoor: aan de rand afgekapt, schaal begrensd, ongeldig geeft null', () => {
  const rand = uitsnedeVoor({ x: 0, y: 0, width: 10, height: 10 }, { breedte: 100, hoogte: 100 }, { maxPx: 10000 });
  assert.equal(rand.deel.x, 0);
  assert.equal(rand.deel.y, 0);
  assert.equal(rand.schaal, 4); // maxSchaal
  const groot = uitsnedeVoor({ x: 0, y: 0, width: 2000, height: 2000 }, { breedte: 2000, hoogte: 2000 });
  assert.equal(groot.schaal, 0.5); // minSchaal
  assert.equal(groot.deel.breedte, 1000);
  // Negatieve maat wordt rechtgezet.
  const neg = uitsnedeVoor({ x: 200, y: 200, width: -100, height: -50 }, { breedte: 595, hoogte: 842 });
  const pos = uitsnedeVoor({ x: 100, y: 150, width: 100, height: 50 }, { breedte: 595, hoogte: 842 });
  assert.deepEqual(neg, pos);
  assert.equal(uitsnedeVoor(null, { breedte: 1, hoogte: 1 }), null);
  assert.equal(uitsnedeVoor({ x: 0, y: 0, width: 1, height: 1 }, { breedte: 0, hoogte: 1 }), null);
  // Buiten de pagina: toch een gebied binnen de pagina.
  const buiten = uitsnedeVoor({ x: 900, y: 900, width: 10, height: 10 }, { breedte: 100, hoogte: 100 });
  assert.ok(buiten.deel.x >= 0 && buiten.deel.x + buiten.deel.breedte <= 100 * buiten.schaal + 1);
});
