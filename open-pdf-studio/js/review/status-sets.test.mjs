// Eén bron voor de reviewstatussen van markeringen (#1076): de vaste statussen
// van het PDF-reviewmodel plus de eigen statussen uit de voorkeuren.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VASTE_STATUSSEN, eigenStatussen, alleStatussen, zoekStatus, statusKleur,
  statusNaam, isAfgerond, afgerondeStatussen, normaliseerEigenStatussen,
  kiesbareStatussen, filterStatussen, statusRang, vergelijkStatus, normaliseerStatusSets, statusSetsVan,
  statusLijst, statusModelVan, verplaats, vrijeNaam, exporteerStatusSet, importeerStatusSet, voegSetIn,
  geldigeSetNaam, OUDE_SET_NAAM,
} from './status-sets.js';

const t = (sleutel) => `[${sleutel}]`;

test('de vaste statussen staan er in een vaste volgorde, met reviewed erbij', () => {
  assert.deepEqual(VASTE_STATUSSEN.map((s) => s.key), ['none', 'accepted', 'cancelled', 'completed', 'rejected', 'reviewed']);
});

test('eigen statussen komen na de vaste, met een sleutel in kleine letters', () => {
  const lijst = [{ name: 'Approved', color: '#00aa00', closed: true }, { name: ' In progress ', color: '#ffaa00' }];
  const alle = alleStatussen(lijst);
  assert.deepEqual(alle.slice(-2).map((s) => [s.key, s.name, s.color, s.closed, s.eigen]), [
    ['approved', 'Approved', '#00aa00', true, true],
    ['in progress', 'In progress', '#ffaa00', false, true],
  ]);
  assert.equal(alle.length, VASTE_STATUSSEN.length + 2);
});

test('ongeldige, dubbele en botsende eigen statussen vallen weg', () => {
  const lijst = normaliseerEigenStatussen([
    { name: 'Approved', color: '#00AA00' },
    { name: 'approved', color: '#111111' }, // dubbel (hoofdletters tellen niet)
    { name: 'Completed', color: '#222222' }, // botst met een vaste status
    { name: 'mixed' }, // gereserveerd door het eigenschappenpaneel
    { name: '   ' },
    { name: 'x'.repeat(41) },
    null,
    { name: 'Geen kleur', color: 'rood' },
  ]);
  assert.deepEqual(lijst, [
    { name: 'Approved', color: '#00aa00', closed: false },
    { name: 'Geen kleur', color: '#8b5cf6', closed: false },
  ]);
  assert.deepEqual(eigenStatussen('geen lijst'), []);
});

test('zoeken, kleur en naam werken voor vaste, eigen en onbekende statussen', () => {
  const lijst = [{ name: 'Approved', color: '#00aa00', closed: true }];
  assert.equal(zoekStatus('APPROVED', lijst)?.name, 'Approved');
  assert.equal(statusKleur('approved', lijst), '#00aa00');
  assert.equal(statusKleur('completed', lijst), '#3b82f6');
  assert.equal(statusKleur('none', lijst), null);
  assert.equal(statusKleur('van elders', lijst), '#888888', 'onbekende status uit een ander programma');
  assert.equal(statusNaam('approved', lijst, t), 'Approved');
  assert.equal(statusNaam('completed', lijst, t), '[annotation.statusCompleted]');
  assert.equal(statusNaam('', lijst, t), '[annotation.statusNone]');
  assert.equal(statusNaam('van elders', lijst, t), 'Van elders');
});

test('open of afgerond: vaste afgeronde statussen en eigen met closed', () => {
  const lijst = [{ name: 'Approved', closed: true }, { name: 'In progress' }];
  assert.deepEqual([...afgerondeStatussen(lijst)].sort(), ['approved', 'cancelled', 'completed', 'rejected']);
  assert.equal(isAfgerond('none', lijst), false);
  assert.equal(isAfgerond('accepted', lijst), false, 'geaccepteerd = nog te verwerken');
  assert.equal(isAfgerond('in progress', lijst), false);
  assert.equal(isAfgerond('approved', lijst), true);
});

// ── Statussets ──────────────────────────────────────────────────────────────

const PREFS = {
  markupStatusSets: [
    { name: 'Bouw', statuses: [{ name: 'In progress', color: '#ffaa00' }, { name: 'Approved', color: '#00aa00', closed: true }] },
    { name: 'Ontwerp', statuses: [{ name: 'For review', color: '#0000aa' }, { name: 'Approved', color: '#111111' }] },
  ],
  activeMarkupStatusSet: 'ontwerp',
};
const BOUW_SCHOON = {
  name: 'Bouw',
  statuses: [{ name: 'In progress', color: '#ffaa00', closed: false }, { name: 'Approved', color: '#00aa00', closed: true }],
};

test('sets: namen uniek, Review en Marked gereserveerd, statussen genormaliseerd', () => {
  const sets = normaliseerStatusSets([
    { name: ' Bouw  team ', statuses: [{ name: 'A' }, { name: 'a' }] },
    { name: 'bouw team', statuses: [{ name: 'B' }] },
    { name: 'Review', statuses: [{ name: 'C' }] },
    { name: 'MARKED', statuses: [] },
    { name: '', statuses: [] },
    null,
  ]);
  assert.deepEqual(sets, [{ name: 'Bouw team', statuses: [{ name: 'A', color: '#8b5cf6', closed: false }] }]);
  assert.equal(geldigeSetNaam('Review'), false);
  assert.equal(geldigeSetNaam('x'.repeat(41)), false);
  assert.equal(geldigeSetNaam('Bouw'), true);
});

test('de actieve set: op naam (hoofdletters tellen niet), leeg of onbekend = alleen de vaste', () => {
  assert.equal(statusSetsVan(PREFS).actief, 'Ontwerp');
  assert.equal(statusSetsVan({ ...PREFS, activeMarkupStatusSet: '' }).actief, '');
  assert.equal(statusSetsVan({ ...PREFS, activeMarkupStatusSet: 'weg' }).actief, '');
  assert.deepEqual(statusSetsVan({}).sets, []);
});

test('de oude platte lijst telt als een actieve set, tot er sets zijn', () => {
  const oud = { markupStatuses: [{ name: 'Approved', color: '#00aa00' }] };
  assert.deepEqual(statusSetsVan(oud), {
    sets: [{ name: OUDE_SET_NAAM, statuses: [{ name: 'Approved', color: '#00aa00', closed: false }] }],
    actief: OUDE_SET_NAAM,
  });
  assert.equal(statusSetsVan({ ...oud, ...PREFS }).sets.length, 2, 'met sets telt de oude lijst niet meer');
});

test('alleen de actieve set is te kiezen; de andere sets blijven herkend', () => {
  const lijst = statusLijst(PREFS);
  assert.deepEqual(kiesbareStatussen(lijst).filter((s) => s.eigen).map((s) => s.key), ['for review', 'approved']);
  assert.equal(zoekStatus('in progress', lijst)?.set, 'Bouw');
  assert.equal(statusKleur('in progress', lijst), '#ffaa00');
  assert.equal(statusKleur('approved', lijst), '#111111', 'bij dezelfde naam wint de actieve set');
  assert.equal(isAfgerond('approved', lijst), false);
  const zonder = statusLijst({ ...PREFS, activeMarkupStatusSet: '' });
  assert.deepEqual(kiesbareStatussen(zonder).map((s) => s.key), VASTE_STATUSSEN.map((s) => s.key));
  assert.equal(statusNaam('for review', zonder, t), 'For review');
});

test('het statusmodel: Review voor vaste en onbekende statussen, anders de set', () => {
  const lijst = statusLijst(PREFS);
  assert.equal(statusModelVan('accepted', lijst), 'Review');
  assert.equal(statusModelVan('van elders', lijst), 'Review');
  assert.equal(statusModelVan('For Review', lijst), 'Ontwerp');
  assert.equal(statusModelVan('in progress', lijst), 'Bouw');
  assert.equal(statusModelVan('approved', [{ name: 'Approved' }]), 'Review', 'platte lijst zonder set');
});

test('een verwijderde status blijft zichtbaar en filterbaar zolang hij in het document staat', () => {
  const lijst = statusLijst(PREFS);
  const sleutels = filterStatussen(lijst, ['Verwijderd', 'approved', 'in progress', 'verwijderd', undefined]);
  assert.deepEqual(sleutels.slice(VASTE_STATUSSEN.length), ['for review', 'approved', 'verwijderd', 'in progress']);
  assert.equal(statusNaam('verwijderd', lijst, t, 'VerWijderd'), 'VerWijderd', 'de schrijfwijze uit het bestand');
  assert.equal(statusNaam('verwijderd', lijst, t, 'iets anders'), 'Verwijderd');
  assert.equal(statusKleur('verwijderd', lijst), '#888888');
});

test('sorteren op status volgt de volgorde van de sets, onbekende achteraan op naam', () => {
  const lijst = statusLijst(PREFS);
  const gesorteerd = ['zzz', 'approved', '', 'in progress', 'rejected', 'aaa', 'for review']
    .sort((a, b) => vergelijkStatus(a, b, lijst));
  assert.deepEqual(gesorteerd, ['', 'rejected', 'for review', 'approved', 'in progress', 'aaa', 'zzz']);
  assert.ok(statusRang('none', lijst) < statusRang('accepted', lijst));
});

test('volgorde wijzigen en een vrije naam kiezen', () => {
  assert.deepEqual(verplaats(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(verplaats(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  const lijst = ['a', 'b'];
  assert.equal(verplaats(lijst, 0, -1), lijst);
  assert.equal(verplaats(lijst, 1, 1), lijst);
  assert.equal(vrijeNaam('Statusset', ['Bouw']), 'Statusset');
  assert.equal(vrijeNaam('Statusset', ['statusset', 'Statusset 2']), 'Statusset 3');
});

test('een set gaat als bestand heen en terug', () => {
  const tekst = exporteerStatusSet(PREFS.markupStatusSets[0]);
  assert.deepEqual(JSON.parse(tekst), { format: 'open-pdf-studio-status-set', version: 1, ...BOUW_SCHOON });
  assert.deepEqual(importeerStatusSet('﻿' + tekst), { set: BOUW_SCHOON });
  assert.throws(() => exporteerStatusSet({ name: 'Review', statuses: [] }));
});

test('importeren weigert wat geen bruikbare statusset is', () => {
  assert.deepEqual(importeerStatusSet('geen json'), { fout: 'unreadable' });
  assert.deepEqual(importeerStatusSet('{"name":"x","statuses":[]}'), { fout: 'format' });
  assert.deepEqual(importeerStatusSet('[1]'), { fout: 'format' });
  const basis = { format: 'open-pdf-studio-status-set', version: 1, name: 'Bouw', statuses: [{ name: 'A' }] };
  assert.deepEqual(importeerStatusSet(JSON.stringify({ ...basis, version: 2 })), { fout: 'version' });
  assert.deepEqual(importeerStatusSet(JSON.stringify({ ...basis, statuses: [{ name: 'Completed' }] })), { fout: 'empty' });
  assert.deepEqual(importeerStatusSet(JSON.stringify({ ...basis, name: 'Review' })), { fout: 'empty' });
  assert.equal(importeerStatusSet(JSON.stringify(basis)).set.name, 'Bouw');
});

test('een geïmporteerde set komt erbij, of vervangt de set met dezelfde naam op haar plaats', () => {
  const erbij = voegSetIn(PREFS.markupStatusSets, { name: 'Nieuw', statuses: [{ name: 'A' }] });
  assert.equal(erbij.vervangen, false);
  assert.deepEqual(erbij.sets.map((s) => s.name), ['Bouw', 'Ontwerp', 'Nieuw']);
  const vervangen = voegSetIn(PREFS.markupStatusSets, { name: 'BOUW', statuses: [{ name: 'B' }] });
  assert.equal(vervangen.vervangen, true);
  assert.deepEqual(vervangen.sets.map((s) => [s.name, s.statuses.map((x) => x.name)]),
    [['BOUW', ['B']], ['Ontwerp', ['For review', 'Approved']]]);
});
