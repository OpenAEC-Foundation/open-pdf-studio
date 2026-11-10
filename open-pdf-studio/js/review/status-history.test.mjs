// Reviewgeschiedenis van een markering (#629): de pure regels.
import assert from 'node:assert/strict';
import test from 'node:test';
import { statusHistory, setStatusWithHistory, pdfStateName, MAX_STATUS_HISTORY } from './status-history.js';
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
