// Shared review through a folder (#237): names, merging, the event log and
// its conflict rule, conflicted copies, the local view and the poller.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  sanitizeUserName, userKey, joinPath, splitPdfPath, reviewFolderFor, logFileName, xfdfFileName,
  classifyReviewFile, parseEventLog, serializeEvents, replayEvents, mergeReviewFiles, uniqueEvents,
  applyDerived, diffForPublish, makeEvents, markPublished, annotationsForPdfSave, makeBaseline,
  fingerprint, snapshotAnnotation, createFolderPoller, folderSignature, stablePdfIds, withPdfNames,
} from './shared-review-core.js';

// ── helpers ────────────────────────────────────────────────────────────────

let rnd = 0;
const random = () => `r${String(++rnd).padStart(5, '0')}`;
const at = (iso) => () => new Date(iso);

/** A participant that writes events the way the app does. */
function author(name) {
  return {
    name,
    events: [],
    write(changes, seen, when = '2026-10-28T10:00:00Z') {
      const lastSeq = this.events.reduce((m, e) => Math.max(m, e.seq), 0);
      const maxClock = seen.reduce((m, e) => Math.max(m, e.clock), 0);
      const evs = makeEvents(changes, { user: name, lastSeq, maxClock, now: at(when), random });
      this.events.push(...evs);
      return evs;
    },
  };
}
const comment = (id, text, extra = {}) => ({ id, type: 'comment', page: 1, x: 10, y: 20, width: 24, height: 24, text, author: 'Alice', ...extra });

// ── names and paths ────────────────────────────────────────────────────────

test('user names become safe file name parts', () => {
  assert.equal(sanitizeUserName('Alice'), 'Alice');
  assert.equal(sanitizeUserName('  Jan de Vries '), 'Jan_de_Vries');
  assert.equal(sanitizeUserName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(sanitizeUserName('Bob (laptop)'), 'Bob_laptop', 'no brackets: those mark sync copies');
  assert.equal(sanitizeUserName('...hidden.'), 'hidden', 'no leading dot (hidden), no trailing dot (Windows)');
  assert.equal(sanitizeUserName('Zoë'), 'Zoë');
  assert.equal(sanitizeUserName('Zoe\u0308'), 'Zoë', 'NFC: the same name from macOS and Windows');
  assert.equal(sanitizeUserName('محمد'), 'محمد');
  assert.equal(sanitizeUserName('李 明'), '李_明');
  assert.equal(sanitizeUserName(''), 'User');
  assert.equal(sanitizeUserName('***'), 'User');
  assert.equal(sanitizeUserName(null), 'User');
  assert.equal(Array.from(sanitizeUserName('x'.repeat(200))).length, 64);
  assert.equal(sanitizeUserName('tab\there\nnewline'), 'tab_here_newline');
  assert.equal(userKey('ALICE'), userKey('alice'), 'case-insensitive identity');
});

test('the review folder sits next to the PDF, on POSIX and Windows paths', () => {
  assert.equal(reviewFolderFor('/share/PRJ2026/PRJ2026-Drawings.pdf'), '/share/PRJ2026/PRJ2026-Drawings');
  assert.equal(reviewFolderFor('C:\\Share\\PRJ2026\\PRJ2026-Drawings.PDF'), 'C:\\Share\\PRJ2026\\PRJ2026-Drawings');
  assert.equal(reviewFolderFor('\\\\server\\proj\\plan.pdf'), '\\\\server\\proj\\plan');
  assert.equal(reviewFolderFor('C:\\plan.pdf'), 'C:\\plan');
  assert.equal(reviewFolderFor('/plan.pdf'), '/plan');
  assert.equal(reviewFolderFor('/a/b.pdf', 'D:\\Reviews\\'), 'D:\\Reviews', 'a chosen folder wins');
  assert.deepEqual(splitPdfPath('/a/my.plan.pdf'), { dir: '/a', base: 'my.plan' });
  // Joining agrees with node's own path modules for both styles.
  assert.equal(joinPath('C:\\Share\\x', 'f.jsonl'), path.win32.join('C:\\Share\\x', 'f.jsonl'));
  assert.equal(joinPath('/share/x', 'f.jsonl'), path.posix.join('/share/x', 'f.jsonl'));
  assert.equal(joinPath('C:\\', 'f.jsonl'), path.win32.join('C:\\', 'f.jsonl'));
  assert.equal(joinPath('/', 'f.jsonl'), '/f.jsonl');
});

test('file names: one log and one XFDF per user, as in the issue', () => {
  assert.equal(logFileName('PRJ2026-Drawings', 'Alice'), 'PRJ2026-Drawings_Annotation_Alice.jsonl');
  assert.equal(xfdfFileName('PRJ2026-Drawings', 'Jan de Vries'), 'PRJ2026-Drawings_Annotation_Jan_de_Vries.xfdf');
  const own = classifyReviewFile(logFileName('PRJ2026-Drawings', 'Alice'), 'PRJ2026-Drawings');
  assert.deepEqual(own, { kind: 'log', user: 'Alice', uk: 'alice', conflicted: false });
});

test('sync-drive copies are recognised as copies of the same user', () => {
  const base = 'Plan';
  const cases = [
    'Plan_Annotation_Bob (conflicted copy 2026-10-28).jsonl',
    "Plan_Annotation_Bob (Alice's conflicted copy 2026-10-28).jsonl",
    'Plan_Annotation_Bob (1).jsonl',
    'Plan_Annotation_Bob (Case Conflict).jsonl',
    'Plan_Annotation_Bob - Copy.jsonl',
    'Plan_Annotation_Bob.sync-conflict-20261028-101010-ABCDEFG.jsonl',
    'plan_annotation_BOB.JSONL',
  ];
  for (const name of cases) {
    const c = classifyReviewFile(name, base);
    assert.equal(c?.uk, 'bob', name);
    assert.equal(c.kind, 'log', name);
  }
  assert.equal(classifyReviewFile('Plan_Annotation_Bob.jsonl', base).conflicted, false);
  assert.equal(classifyReviewFile(cases[0], base).conflicted, true);
  assert.equal(classifyReviewFile(cases[5], base).conflicted, true);
  // Not ours: other documents, temp and hidden files, other extensions.
  for (const name of ['Other_Annotation_Bob.jsonl', '.opds-save-1-2.tmp', '.Plan_Annotation_Bob.jsonl', '~$Plan_Annotation_Bob.jsonl', 'Plan_Annotation_Bob.jsonl.tmp', 'Plan.pdf', 'Plan_Annotation_.jsonl']) {
    assert.equal(classifyReviewFile(name, base), null, name);
  }
});

// ── event log ──────────────────────────────────────────────────────────────

test('the log reader tolerates a half-synced last line and counts broken lines', () => {
  const a = author('Alice');
  const evs = a.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'Hi') }], []);
  const text = serializeEvents(evs);
  assert.deepEqual(parseEventLog(text).events, evs);
  const half = text + text.slice(0, 30);
  assert.deepEqual(parseEventLog(half), { events: evs, invalid: 0, partial: true });
  const crlf = text.replace(/\n/g, '\r\n');
  assert.deepEqual(parseEventLog('\uFEFF' + crlf).events, evs, 'BOM and CRLF from another editor');
  assert.equal(parseEventLog('garbage\n' + text).invalid, 1);
  assert.equal(parseEventLog('{"id":"x"}\n').invalid, 1, 'an object that is no event');
  assert.deepEqual(parseEventLog(''), { events: [], invalid: 0, partial: false });
});

test('the issue example: Alice creates, Bob edits, Charlie removes; all three in the history', () => {
  const alice = author('Alice'), bob = author('Bob'), charlie = author('Charlie');
  alice.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'Check this beam') }], [], '2026-10-28T09:00:00Z');
  let state = replayEvents([...alice.events]);
  bob.write([{ op: 'edit', ann: 'c1', base: state.annotations.get('c1').head, data: comment('c1', 'Check this beam (HEA 200?)') }], state.events, '2026-10-28T09:05:00Z');
  state = replayEvents([...alice.events, ...bob.events]);
  assert.equal(state.annotations.get('c1').data.text, 'Check this beam (HEA 200?)');
  charlie.write([{ op: 'delete', ann: 'c1', base: state.annotations.get('c1').head }], state.events, '2026-10-28T09:10:00Z');

  // Every participant reads the files in a different order: same result.
  for (const order of [[alice, bob, charlie], [charlie, bob, alice], [bob, charlie, alice]]) {
    const r = replayEvents(order.flatMap((p) => p.events));
    const c1 = r.annotations.get('c1');
    assert.equal(c1.deleted, true);
    assert.deepEqual(c1.history.map((h) => [h.op, h.user, h.concurrent]), [
      ['create', 'Alice', false], ['edit', 'Bob', false], ['delete', 'Charlie', false],
    ]);
    assert.equal(c1.createdBy, 'Alice');
    assert.equal(c1.data.text, 'Check this beam (HEA 200?)', 'the last content stays readable');
  }
});

test('concurrent edits: one total order, the later event wins, both are kept and marked', () => {
  const alice = author('Alice'), bob = author('Bob'), charlie = author('Charlie');
  alice.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'v0') }], []);
  const seen = replayEvents(alice.events);
  const head = seen.annotations.get('c1').head;
  // Bob and Charlie both start from Alice's version, without seeing each other.
  bob.write([{ op: 'edit', ann: 'c1', base: head, data: comment('c1', 'bob') }], seen.events);
  charlie.write([{ op: 'edit', ann: 'c1', base: head, data: comment('c1', 'charlie') }], seen.events);
  const r = replayEvents([...charlie.events, ...alice.events, ...bob.events]);
  const c1 = r.annotations.get('c1');
  // Same Lamport clock: the user key decides ("bob" < "charlie").
  assert.equal(c1.data.text, 'charlie');
  assert.deepEqual(c1.history.map((h) => [h.user, h.concurrent]), [['Alice', false], ['Bob', false], ['Charlie', true]]);
});

test('a later clock wins regardless of wall-clock time (clock skew)', () => {
  const alice = author('Alice'), bob = author('Bob');
  // Bob's computer is a day behind; he edits after seeing Alice's edit.
  alice.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'v0') }], [], '2026-10-28T12:00:00Z');
  alice.write([{ op: 'edit', ann: 'c1', base: alice.events[0].id, data: comment('c1', 'alice v1') }], alice.events, '2026-10-28T12:01:00Z');
  const seen = replayEvents(alice.events);
  bob.write([{ op: 'edit', ann: 'c1', base: seen.annotations.get('c1').head, data: comment('c1', 'bob v2') }], seen.events, '2026-10-27T08:00:00Z');
  const c1 = replayEvents([...bob.events, ...alice.events]).annotations.get('c1');
  assert.equal(c1.data.text, 'bob v2');
  assert.equal(c1.history.at(-1).concurrent, false);
});

test('delete against a concurrent edit: last in order wins, the edit restores it', () => {
  const alice = author('Alice'), bob = author('Bob'), zed = author('Zed');
  alice.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'v0') }], []);
  const seen = replayEvents(alice.events);
  const head = seen.annotations.get('c1').head;
  bob.write([{ op: 'delete', ann: 'c1', base: head }], seen.events);
  zed.write([{ op: 'edit', ann: 'c1', base: head, data: comment('c1', 'zed') }], seen.events);
  const c1 = replayEvents([...alice.events, ...bob.events, ...zed.events]).annotations.get('c1');
  assert.equal(c1.deleted, false);
  assert.equal(c1.data.text, 'zed');
  assert.equal(c1.history.at(-1).concurrent, true);
});

test('an edit whose create is not synced yet still shows; a duplicate event counts once', () => {
  const alice = author('Alice'), bob = author('Bob');
  alice.write([{ op: 'create', ann: 'c1', base: null, data: comment('c1', 'v0') }], []);
  bob.write([{ op: 'edit', ann: 'c1', base: alice.events[0].id, data: comment('c1', 'v1') }], alice.events);
  assert.equal(replayEvents(bob.events).annotations.get('c1').data.text, 'v1');
  assert.equal(uniqueEvents([alice.events, alice.events, bob.events]).length, 2);
});

// ── merging files ──────────────────────────────────────────────────────────

test('merging several users, conflicted copies included, without double events', () => {
  const alice = author('Alice'), bob = author('Bob');
  alice.write([{ op: 'create', ann: 'a1', base: null, data: comment('a1', 'from alice') }], [], '2026-10-28T09:00:00Z');
  bob.write([{ op: 'create', ann: 'b1', base: null, data: comment('b1', 'from bob', { author: 'Bob' }) }], alice.events, '2026-10-28T09:01:00Z');
  // Bob worked on two machines; the sync drive kept both versions.
  const bobLaptop = [...bob.events];
  bob.write([{ op: 'create', ann: 'b2', base: null, data: comment('b2', 'laptop', { author: 'Bob' }) }], bobLaptop, '2026-10-28T09:02:00Z');
  const files = [
    { name: 'Plan_Annotation_Alice.jsonl', text: serializeEvents(alice.events) },
    { name: 'Plan_Annotation_Bob.jsonl', text: serializeEvents(bobLaptop) },
    { name: 'Plan_Annotation_Bob (conflicted copy 2026-10-28).jsonl', text: serializeEvents(bob.events) },
    { name: 'Plan_Annotation_Bob-DESKTOP7.jsonl', text: serializeEvents(bob.events) },
    { name: 'Other_Annotation_Eve.jsonl', text: serializeEvents(alice.events) },
    { name: 'notes.txt', text: 'x' },
  ];
  const m = mergeReviewFiles(files, 'Plan');
  assert.deepEqual([...m.annotations.keys()].sort(), ['a1', 'b1', 'b2']);
  assert.equal(m.events.length, 3);
  const bobInfo = m.participants.get('bob');
  assert.equal(bobInfo.events, 2);
  assert.equal(bobInfo.conflictedFiles, 1, 'the bracketed copy');
  assert.equal(bobInfo.lastAt, '2026-10-28T09:02:00.000Z');
  // The machine-name copy is filed under its own name, but its events are Bob's.
  assert.equal(m.participants.get('bob-desktop7').events, 0);
  assert.equal(m.participants.get('bob-desktop7').conflictedFiles, 1);
  assert.equal(m.participants.get('alice').events, 1);
  assert.ok(!m.participants.has('eve'), 'another document in the same folder');
});

test('a participant with only an XFDF file (another program) counts as his creates', () => {
  const parseXfdf = (xml) => (xml === 'X' ? [comment('x1', 'from xfdf', { author: 'Dora' })] : []);
  const alice = author('Alice');
  alice.write([{ op: 'create', ann: 'a1', base: null, data: comment('a1', 'a') }], []);
  const m = mergeReviewFiles([
    { name: 'Plan_Annotation_Dora.xfdf', text: 'X' },
    { name: 'Plan_Annotation_Alice.xfdf', text: 'X' }, // has a log: the snapshot is ignored
    { name: 'Plan_Annotation_Alice.jsonl', text: serializeEvents(alice.events) },
  ], 'Plan', { parseXfdf });
  assert.deepEqual([...m.annotations.keys()].sort(), ['a1', 'x1']);
  assert.equal(m.annotations.get('x1').createdBy, 'Dora');
});

// ── local view ─────────────────────────────────────────────────────────────

test('publishing: my creates, edits and deletes, each published once', () => {
  const me = author('Me');
  const doc = { annotations: [comment('m1', 'one'), comment('m2', 'two')] };
  let applied = new Map();
  let changes = diffForPublish(doc.annotations, applied);
  assert.deepEqual(changes.map((c) => [c.op, c.ann]), [['create', 'm1'], ['create', 'm2']]);
  let evs = me.write(changes, []);
  applied = markPublished(applied, evs);
  assert.deepEqual(diffForPublish(doc.annotations, applied), [], 'nothing twice');
  doc.annotations[0].text = 'one!';
  doc.annotations.pop();
  changes = diffForPublish(doc.annotations, applied);
  assert.deepEqual(changes.map((c) => [c.op, c.ann, c.base]), [['edit', 'm1', evs[0].id], ['delete', 'm2', evs[1].id]]);
  evs = me.write(changes, me.events);
  assert.deepEqual(evs.map((e) => [e.seq, e.clock]), [[3, 3], [4, 4]]);
  // Runtime fields never count as a change.
  doc.annotations[0]._cache = { big: true };
  doc.annotations[0].gebakkenIn = '/x.pdf';
  applied = markPublished(applied, evs);
  assert.deepEqual(diffForPublish(doc.annotations, applied), []);
});

test('applying remote state: added, updated, removed; local unpublished edits stay', () => {
  const alice = author('Alice');
  alice.write([
    { op: 'create', ann: 'a1', base: null, data: comment('a1', 'v0') },
    { op: 'create', ann: 'a2', base: null, data: comment('a2', 'keep') },
  ], []);
  const doc = { annotations: [comment('mine', 'local')] };
  let r = applyDerived(doc.annotations, replayEvents(alice.events), new Map());
  assert.deepEqual(r.changes, { added: ['a1', 'a2'], updated: [], removed: [] });
  doc.annotations = r.annotations;
  const a1 = doc.annotations.find((a) => a.id === 'a1');
  // Alice edits a1 and deletes a2; meanwhile I change a2 locally.
  alice.write([
    { op: 'edit', ann: 'a1', base: alice.events[0].id, data: comment('a1', 'v1') },
    { op: 'delete', ann: 'a2', base: alice.events[1].id },
  ], alice.events);
  doc.annotations.find((a) => a.id === 'a2').text = 'my change';
  const applied = r.applied;
  r = applyDerived(doc.annotations, replayEvents(alice.events), applied);
  assert.deepEqual(r.changes, { added: [], updated: ['a1'], removed: [] });
  assert.equal(r.annotations.find((a) => a.id === 'a1'), a1, 'same object, so selection and undo keep it');
  assert.equal(a1.text, 'v1');
  assert.equal(r.annotations.find((a) => a.id === 'a2').text, 'my change');
  // Publishing my change: an edit on top of what I had seen, so concurrent.
  const changes = diffForPublish(r.annotations, r.applied);
  assert.deepEqual(changes.map((c) => [c.op, c.ann, c.base]), [['create', 'mine', null], ['edit', 'a2', alice.events[1].id]]);
  const me = author('Me');
  const evs = me.write(changes, alice.events);
  const all = replayEvents([...alice.events, ...evs]).annotations.get('a2');
  assert.equal(all.deleted, false);
  assert.equal(all.history.at(-1).concurrent, true);
});

test('the PDF keeps its own annotations; shared ones stay out of a save', () => {
  const pdfAnn = comment('p1', 'in the pdf');
  const doc = { annotations: [pdfAnn] };
  const ids = stablePdfIds(doc.annotations);
  const idOf = (a) => ids.get(a.id) ?? a.id;
  const baseline = makeBaseline(doc.annotations, idOf);
  doc.annotations.push(comment('s1', 'shared'));
  assert.deepEqual(annotationsForPdfSave(doc.annotations, baseline, idOf), [pdfAnn]);
  // Edited during the review: the PDF still gets the original.
  pdfAnn.text = 'edited in review';
  const saved = annotationsForPdfSave(doc.annotations, baseline, idOf);
  assert.equal(saved[0].text, 'in the pdf');
  assert.equal(saved[0].id, 'p1', 'with its local id');
  // Deleted during the review: still in the PDF.
  assert.equal(annotationsForPdfSave([], baseline, idOf).length, 1);
  // The edit is published under the stable id, as an edit (not a create).
  const changes = diffForPublish(doc.annotations, new Map(), baseline, idOf);
  assert.deepEqual(changes.map((c) => [c.op, c.ann]), [['edit', 'pdf:1:0'], ['create', 's1']]);
  assert.equal(changes[0].data.id, 'pdf:1:0');
});

test('annotations of the PDF have the same review id on every machine', () => {
  // Opened twice: the local ids differ, the review ids do not.
  const first = [comment('x1', 'a'), comment('x2', 'b', { page: 2 }), comment('x3', 'c', { nm: 'NM-7' })];
  const second = [comment('y1', 'a'), comment('y2', 'b', { page: 2 }), comment('y3', 'c', { nm: 'NM-7' })];
  assert.deepEqual([...stablePdfIds(first).values()], ['pdf:1:0', 'pdf:2:0', 'NM-7']);
  assert.deepEqual([...stablePdfIds(second).values()], [...stablePdfIds(first).values()]);
  // Bob edits annotation 'b' on his machine; Alice's copy (other local id) follows.
  const bobIds = stablePdfIds(second);
  const bobOf = (a) => bobIds.get(a.id) ?? a.id;
  second[1].text = 'b by bob';
  const bob = author('Bob');
  const evs = bob.write(diffForPublish(second, new Map(), makeBaseline([comment('y1', 'a'), comment('y2', 'b', { page: 2 }), comment('y3', 'c', { nm: 'NM-7' })], bobOf), bobOf), []);
  const aliceIds = stablePdfIds(first);
  const aliceOf = (a) => aliceIds.get(a.id) ?? a.id;
  const r = applyDerived(first, replayEvents(evs), new Map(), makeBaseline(first, aliceOf), aliceOf);
  assert.deepEqual(r.changes.updated, ['pdf:2:0']);
  assert.equal(first[1].text, 'b by bob');
  assert.equal(first[1].id, 'x2', 'the local id stays');
  // Imported into the PDF, each annotation carries its review id as /NM.
  const shared = [comment('s1', 'shared')];
  withPdfNames(shared);
  assert.equal(shared[0].nm, 's1');
  assert.deepEqual([...stablePdfIds(shared).values()], ['s1']);
});

test('snapshots are plain data with a stable fingerprint', () => {
  const a = { id: 'a', type: 'box', page: 1, _render: {}, fn() {}, nested: { b: 2, a: 1 }, list: [1, undefined] };
  assert.deepEqual(snapshotAnnotation(a), { id: 'a', list: [1, null], nested: { a: 1, b: 2 }, page: 1, type: 'box' });
  assert.equal(fingerprint({ b: 1, a: 2 }), fingerprint({ a: 2, b: 1 }));
});

// ── atomic publishing ──────────────────────────────────────────────────────

test('a reader never sees a torn log: whole-file replacement keeps the old or the new', () => {
  // The app replaces the file by write-to-temp + rename (atomic_file.rs).
  // Model of the folder: a reader at any moment sees one complete version.
  const me = author('Me');
  const v1 = serializeEvents(me.write([{ op: 'create', ann: 'm1', base: null, data: comment('m1', 'x') }], []));
  const v2 = serializeEvents([...me.events, ...me.write([{ op: 'create', ann: 'm2', base: null, data: comment('m2', 'y') }], me.events)]);
  const folder = new Map([['Plan_Annotation_Me.jsonl', v1]]);
  const writeAtomic = (name, text, { crashBeforeRename = false } = {}) => {
    const tmp = `.opds-save-1-1.tmp`;
    folder.set(tmp, text.slice(0, Math.floor(text.length / 2))); // still writing
    if (crashBeforeRename) return;
    folder.set(tmp, text);
    folder.set(name, folder.get(tmp));
    folder.delete(tmp);
  };
  const read = () => mergeReviewFiles([...folder].map(([name, text]) => ({ name, text })), 'Plan');
  writeAtomic('Plan_Annotation_Me.jsonl', v2, { crashBeforeRename: true });
  assert.deepEqual([...read().annotations.keys()], ['m1'], 'old version, temp file ignored');
  writeAtomic('Plan_Annotation_Me.jsonl', v2);
  assert.deepEqual([...read().annotations.keys()], ['m1', 'm2']);
  // A sync client that copies in place shows a partial last line: skipped, no error.
  const partial = parseEventLog(v2.slice(0, v2.length - 10));
  assert.equal(partial.partial, true);
  assert.equal(partial.events.length, 1);
});

// ── poller ─────────────────────────────────────────────────────────────────

function fakeTimers() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        await due[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = until;
    },
  };
}

test('poller: reads at start, then only when the listing changes', async () => {
  const clock = fakeTimers();
  let listing = [{ name: 'Plan_Annotation_A.jsonl', size: 10, mtimeMs: 1 }];
  const seen = [];
  const poller = createFolderPoller({
    list: async () => listing.map((f) => ({ ...f })),
    onChange: async (files) => { seen.push(files.length); },
    intervalMs: 5000, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await poller.start();
  assert.deepEqual(seen, [1]);
  await clock.advance(15000);
  assert.deepEqual(seen, [1], 'nothing changed in three polls');
  listing = [...listing, { name: 'Plan_Annotation_B.jsonl', size: 5, mtimeMs: 2 }];
  await clock.advance(4999);
  assert.deepEqual(seen, [1], 'not before the interval');
  await clock.advance(1);
  assert.deepEqual(seen, [1, 2]);
  listing[0] = { ...listing[0], mtimeMs: 3 };
  await clock.advance(5000);
  assert.deepEqual(seen, [1, 2, 2], 'a newer modification time counts');
  poller.setInterval(20000);
  listing = [];
  await clock.advance(19999);
  assert.deepEqual(seen, [1, 2, 2]);
  await clock.advance(1);
  assert.deepEqual(seen, [1, 2, 2, 0]);
  poller.stop();
  assert.equal(clock.pending(), 0);
  listing = [{ name: 'x', size: 1, mtimeMs: 1 }];
  await clock.advance(60000);
  assert.deepEqual(seen, [1, 2, 2, 0], 'stopped');
});

test('poller: a failing listing reports and keeps polling; polls never overlap', async () => {
  const clock = fakeTimers();
  let fail = true;
  let calls = 0;
  const errors = [];
  let release;
  const poller = createFolderPoller({
    list: async () => { calls++; if (fail) throw new Error('offline'); return []; },
    onChange: () => new Promise((r) => { release = r; }),
    onError: (e) => errors.push(e.message),
    intervalMs: 1000, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  await poller.start();
  assert.deepEqual(errors, ['offline']);
  fail = false;
  const busy = clock.advance(1000);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const again = poller.pollNow(true);
  assert.equal(calls, 2, 'a manual poll while one runs joins it');
  release();
  await busy;
  await again;
  poller.stop();
});

test('folder signature ignores listing order', () => {
  assert.equal(folderSignature([{ name: 'b', size: 1, mtimeMs: 2 }, { name: 'a', size: 1, mtimeMs: 2 }]),
    folderSignature([{ name: 'a', size: 1, mtimeMs: 2 }, { name: 'b', size: 1, mtimeMs: 2 }]));
});
