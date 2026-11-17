// Reviewgeschiedenis van een markering (#629): de pure regels.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statusHistory, setStatusWithHistory, pdfStateName, statusAntwoordStappen, MAX_STATUS_HISTORY } from './status-history.js';
import { statusLijst } from './status-sets.js';
import { applyStatusReplies } from '../pdf/loader/status-replies.js';

test('zonder opgeslagen geschiedenis is de huidige status de enige stap', () => {
  assert.deepEqual(statusHistory({}), []);
  assert.deepEqual(statusHistory({ status: 'Accepted', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' }),
    [{ status: 'accepted', by: 'Ann', at: '2026-10-01T10:00:00.000Z' }]);
});

test('elke statuswijziging komt erbij, met wie en wanneer; de eerste status blijft bewaard', () => {
  const ann = { status: 'accepted', statusBy: 'Ann', statusAt: '2026-10-01T10:00:00.000Z' };
  assert.equal(setStatusWithHistory(ann, 'rejected', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' }), true);
  assert.equal(setStatusWithHistory(ann, 'rejected', { door: 'Bob', nu: '2026-10-02T11:00:00.000Z' }), false, 'dezelfde status: geen stap');
  assert.equal(setStatusWithHistory(ann, 'none', { door: 'Cas', nu: '2026-10-03T10:00:00.000Z' }), true);
  assert.equal(ann.status, undefined);
  assert.equal('statusBy' in ann, false);
  assert.deepEqual(ann.statusHistory, [
    { status: 'accepted', by: 'Ann', at: '2026-10-01T10:00:00.000Z' },
    { status: 'rejected', by: 'Bob', at: '2026-10-02T10:00:00.000Z' },
    { status: 'none', by: 'Cas', at: '2026-10-03T10:00:00.000Z' },
  ]);
  setStatusWithHistory(ann, 'Completed', { door: 'Ann', nu: '2026-10-04T10:00:00.000Z' });
  assert.equal(ann.status, 'completed');
  assert.equal(statusHistory(ann).length, 4);
});

test('een status die buiten de geschiedenis om veranderde, komt er als laatste stap bij', () => {
  const ann = { status: 'completed', statusBy: 'X', statusHistory: [{ status: 'accepted', by: 'A', at: null }] };
  assert.deepEqual(statusHistory(ann).map((s) => s.status), ['accepted', 'completed']);
});

test('de geschiedenis is begrensd; de nieuwste stappen blijven', () => {
  const ann = {};
  for (let i = 0; i < MAX_STATUS_HISTORY + 20; i++) {
    setStatusWithHistory(ann, i % 2 ? 'accepted' : 'rejected', { door: `u${i}`, nu: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  }
  assert.equal(ann.statusHistory.length, MAX_STATUS_HISTORY);
  assert.equal(ann.statusHistory.at(-1).by, `u${MAX_STATUS_HISTORY + 19}`);
});

test('PDF-statusnamen', () => {
  assert.equal(pdfStateName('accepted'), 'Accepted');
  assert.equal(pdfStateName('none'), 'None');
  assert.equal(pdfStateName(''), 'None');
});

test('de lader zet meerdere statusantwoorden om in een geschiedenis, op datum; één antwoord blijft zonder', () => {
  const doel = {};
  const enkel = {};
  const byPdfId = new Map([['1R', doel], ['2R', enkel]]);
  applyStatusReplies([
    { targetId: '1R', state: 'Rejected', stateModel: 'Review', author: 'Bob', date: '2026-10-02T10:00:00.000Z' },
    { targetId: '1R', state: 'Accepted', stateModel: 'Review', author: 'Ann', date: '2026-10-01T10:00:00.000Z' },
    { targetId: '1R', state: 'Marked', stateModel: 'Marked', author: 'Ann', date: '2026-10-01T09:00:00.000Z' },
    { targetId: '2R', state: 'Completed', stateModel: 'Review', author: 'Cas', date: '2026-10-05T10:00:00.000Z' },
  ], byPdfId);
  assert.equal(doel.status, 'rejected');
  assert.equal(doel.statusBy, 'Bob');
  assert.equal(doel.marked, true);
  assert.deepEqual(doel.statusHistory, [
    { status: 'accepted', by: 'Ann', at: '2026-10-01T10:00:00.000Z' },
    { status: 'rejected', by: 'Bob', at: '2026-10-02T10:00:00.000Z' },
  ]);
  assert.equal(enkel.status, 'completed');
  assert.equal('statusHistory' in enkel, false);
});

// ── Het statusmodel van eigen statussen (#1076) ─────────────────────────────

const LIJST = statusLijst({
  markupStatusSets: [{ name: 'Bouwteam', statuses: [{ name: 'Approved' }, { name: 'In Progress' }] }],
  activeMarkupStatusSet: 'Bouwteam',
});

test('statusantwoorden: vaste statussen onder Review, eigen onder hun set, met een None bij een modelwissel', () => {
  const ann = {};
  setStatusWithHistory(ann, 'in progress', { door: 'Ann', nu: '2026-10-01T10:00:00.000Z' });
  setStatusWithHistory(ann, 'approved', { door: 'Bob', nu: '2026-10-02T10:00:00.000Z' });
  setStatusWithHistory(ann, 'rejected', { door: 'Cas', nu: '2026-10-03T10:00:00.000Z' });
  setStatusWithHistory(ann, 'none', { door: 'Cas', nu: '2026-10-04T10:00:00.000Z' });
  setStatusWithHistory(ann, 'approved', { door: 'Dee', nu: '2026-10-05T10:00:00.000Z' });
  assert.deepEqual(statusAntwoordStappen(ann, LIJST).map((s) => [s.state, s.model, s.by, !!s.brug]), [
    ['In Progress', 'Bouwteam', 'Ann', false],
    ['Approved', 'Bouwteam', 'Bob', false],
    ['None', 'Bouwteam', 'Cas', true],
    ['Rejected', 'Review', 'Cas', false],
    ['None', 'Review', 'Cas', false],
    ['Approved', 'Bouwteam', 'Dee', false], // na een gewiste status is er niets te wissen
  ]);
  assert.deepEqual(statusAntwoordStappen({}, LIJST), []);
});

test('statusantwoorden: een stap uit een bestand houdt zijn model en schrijfwijze, ook als de set anders heet', () => {
  const ann = {
    status: 'needs info', statusBy: 'Dee', statusAt: '2026-10-01T10:00:00.000Z',
    statusModel: 'VendorReview', statusLabel: 'Needs Info',
  };
  assert.deepEqual(statusAntwoordStappen(ann, LIJST), [
    { state: 'Needs Info', model: 'VendorReview', by: 'Dee', at: '2026-10-01T10:00:00.000Z' },
  ]);
  const oud = { status: 'approved', statusBy: 'Ann', statusAt: null, statusModel: 'Review', statusLabel: 'APPROVED' };
  assert.deepEqual(statusAntwoordStappen(oud, LIJST).map((s) => [s.state, s.model]), [['APPROVED', 'Review']]);
  // Een nieuwe status zetten laat model en schrijfwijze van de vorige los.
  setStatusWithHistory(ann, 'approved', { door: 'Ann', nu: '2026-10-02T10:00:00.000Z' });
  assert.equal('statusModel' in ann, false);
  assert.equal('statusLabel' in ann, false);
  assert.deepEqual(ann.statusHistory[0], {
    status: 'needs info', by: 'Dee', at: '2026-10-01T10:00:00.000Z', model: 'VendorReview', label: 'Needs Info',
  });
  assert.deepEqual(statusAntwoordStappen(ann, LIJST).map((s) => [s.state, s.model]), [
    ['Needs Info', 'VendorReview'], ['None', 'VendorReview'], ['Approved', 'Bouwteam'],
  ]);
});

test('de lader: elk statusmodel wordt de status; onbekende statussen houden model en schrijfwijze', () => {
  const doel = {};
  const ander = {};
  applyStatusReplies([
    { targetId: '1R', state: 'Accepted', stateModel: 'Review', author: 'Ann', date: '2026-10-01T10:00:00.000Z' },
    { targetId: '1R', state: 'None', stateModel: 'Review', author: 'Bob', date: '2026-10-02T10:00:00.000Z' },
    { targetId: '1R', state: 'In Progress', stateModel: 'Bouwteam', author: 'Bob', date: '2026-10-02T10:00:00.000Z' },
    { targetId: '2R', state: 'Needs Info', stateModel: 'VendorReview', author: 'Dee', date: null },
  ], new Map([['1R', doel], ['2R', ander]]));
  assert.equal(doel.status, 'in progress');
  assert.equal(doel.statusModel, 'Bouwteam');
  assert.equal(doel.statusLabel, 'In Progress');
  assert.deepEqual(doel.statusHistory, [
    { status: 'accepted', by: 'Ann', at: '2026-10-01T10:00:00.000Z' },
    { status: 'in progress', by: 'Bob', at: '2026-10-02T10:00:00.000Z', model: 'Bouwteam', label: 'In Progress' },
  ]);
  assert.deepEqual(ander, { status: 'needs info', statusBy: 'Dee', statusModel: 'VendorReview', statusLabel: 'Needs Info' });
});

test('de lader: een None in hetzelfde model, of op een ander tijdstip, blijft een eigen stap', () => {
  const doel = {};
  applyStatusReplies([
    { targetId: '1R', state: 'Accepted', stateModel: 'Review', author: 'Ann', date: '2026-10-01T10:00:00.000Z' },
    { targetId: '1R', state: 'None', stateModel: 'Review', author: 'Bob', date: '2026-10-02T10:00:00.000Z' },
    { targetId: '1R', state: 'In Progress', stateModel: 'Bouwteam', author: 'Cas', date: '2026-10-03T10:00:00.000Z' },
    { targetId: '1R', state: 'None', stateModel: 'Bouwteam', author: 'Cas', date: '2026-10-04T10:00:00.000Z' },
  ], new Map([['1R', doel]]));
  assert.equal(doel.status, undefined);
  assert.equal('statusModel' in doel, false);
  assert.deepEqual(doel.statusHistory.map((s) => s.status), ['accepted', 'none', 'in progress', 'none']);
});
