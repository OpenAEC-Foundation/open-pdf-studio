// Eigen statussen in de lijst met markeringen (#1076): filteren, sorteren en
// groeperen in de volgorde van de statussets, de status in bulk zetten en
// "alleen open punten". Een verborgen status is ook op de tekening verborgen:
// het canvas vraagt het aan dezelfde isStatusHidden (annotations/view-filters).
import assert from 'node:assert/strict';
import test from 'node:test';
import { statusLijst, afgerondeStatussen, filterStatussen, vergelijkStatus } from './status-sets.js';
import { statusHistory } from './status-history.js';
import { sorteerOpmerkingen, statusDoelen, zetStatus, filterOpmerkingen } from '../annotations/opmerkingen-overzicht.js';
import { hiddenInView, pickableInView } from '../annotations/view-filter-rules.js';
import {
  hiddenStatuses, isStatusHidden, setHiddenStatusSet, isHiddenStatusSet, toggleHiddenStatus,
} from '../solid/stores/panels/annotationsStore.js';

const LIJST = statusLijst({
  markupStatusSets: [{ name: 'Bouwteam', statuses: [
    { name: 'For review', color: '#0000aa' },
    { name: 'In progress', color: '#ffaa00' },
    { name: 'Approved', color: '#00aa00', closed: true },
  ] }],
  activeMarkupStatusSet: 'Bouwteam',
});

const anns = () => [
  { id: 'a', page: 1, type: 'box', status: 'approved' },
  { id: 'b', page: 1, type: 'box', status: 'In Progress' },
  { id: 'c', page: 2, type: 'box' },
  { id: 'd', page: 2, type: 'box', status: 'completed' },
  { id: 'e', page: 3, type: 'box', status: 'for review' },
  { id: 'f', page: 3, type: 'box', status: 'needs info', statusLabel: 'Needs Info', statusModel: 'VendorReview' },
];
const ids = (lijst) => lijst.map((a) => a.id);
const opStatus = (a, b) => vergelijkStatus(a, b, LIJST);

test('sorteren op status volgt de volgorde van de set, niet het alfabet', () => {
  assert.deepEqual(ids(sorteerOpmerkingen(anns(), 'status', { vergelijkStatus: opStatus })), ['c', 'd', 'e', 'b', 'a', 'f']);
  assert.deepEqual(ids(sorteerOpmerkingen(anns(), 'statusAndAuthor', { vergelijkStatus: opStatus })), ['c', 'd', 'e', 'b', 'a', 'f']);
  // Zonder de volgorde van de sets blijft het op naam, zoals voorheen.
  assert.deepEqual(ids(sorteerOpmerkingen(anns(), 'status')), ['a', 'd', 'e', 'b', 'f', 'c']);
});

test('het filter biedt de statussen van de set en wat er verder in het document staat', () => {
  const sleutels = filterStatussen(LIJST, anns().map((a) => a.status));
  assert.deepEqual(sleutels.slice(-4), ['for review', 'in progress', 'approved', 'needs info']);
  const zichtbaar = filterOpmerkingen(anns(), {}, { verborgenStatussen: new Set(['approved', 'needs info']) });
  assert.deepEqual(ids(zichtbaar), ['b', 'c', 'd', 'e']);
});

test('een eigen status in bulk zetten: vergrendeld en al goed valt af, elke wijziging komt in de geschiedenis', () => {
  const lijst = anns();
  lijst[1].locked = true;
  const doelen = statusDoelen(lijst, 'Approved');
  assert.deepEqual(ids(doelen), ['c', 'd', 'e', 'f']);
  for (const ann of doelen) zetStatus(ann, 'Approved', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(lijst.map((a) => a.status), ['approved', 'In Progress', 'approved', 'approved', 'approved', 'approved']);
  assert.equal(lijst[2].statusBy, 'Ann');
  assert.deepEqual(statusHistory(lijst[3]).map((s) => s.status), ['completed', 'approved']);
  // De status uit het andere programma blijft in de geschiedenis, met zijn model.
  assert.deepEqual(statusHistory(lijst[5])[0], { status: 'needs info', by: '', at: null, model: 'VendorReview', label: 'Needs Info' });
  assert.equal('statusLabel' in lijst[5], false);
});

test('alleen open punten: afgeronde statussen, ook eigen, verdwijnen uit de lijst en van de tekening', () => {
  const afgerond = [...afgerondeStatussen(LIJST)];
  assert.deepEqual(afgerond.sort(), ['approved', 'cancelled', 'completed', 'rejected']);
  assert.equal(isHiddenStatusSet(afgerond), false);
  setHiddenStatusSet(afgerond);
  try {
    assert.equal(isHiddenStatusSet(afgerond), true);
    const bron = { doc: null, isStatusHidden };
    const zichtbaar = anns().filter((a) => !hiddenInView(a, bron));
    assert.deepEqual(ids(zichtbaar), ['b', 'c', 'e', 'f'], 'open: geen status, onderhanden, ter beoordeling en onbekend');
    assert.equal(pickableInView(anns()[0], bron), false, 'verborgen is ook niet aanklikbaar');
    assert.equal(pickableInView(anns()[1], bron), true);
    // Een status erbij verbergen maakt het een eigen filter, geen "alleen open".
    toggleHiddenStatus('in progress');
    assert.equal(isHiddenStatusSet(afgerond), false);
    assert.equal(isStatusHidden({ status: 'In Progress' }), true);
  } finally {
    setHiddenStatusSet([]);
  }
  assert.equal(hiddenStatuses().size, 0);
});
