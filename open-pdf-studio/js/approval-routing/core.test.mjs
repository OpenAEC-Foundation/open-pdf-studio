// Goedkeuringsroutes (#651): toestandsmachine van versie 2, koppelen van
// teruggekomen kopieën op hash en verwijzing, en dat alleen submit de
// provider aanroept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalCore } from './core.js';
import { createProviders, attachmentName, mailText } from './providers.js';
import { createRequest, appendEvent, verifyRequest, ownerReceipt, recordReceipt, matchCopy, findCopyMatches, requestRef, digest } from './model.js';

const T0 = '2026-11-09T09:00:00.000Z';
const bytes = new TextEncoder().encode('%PDF-1.7 exact sent version %%EOF\n');
const t = (key, o) => (o ? `${key}${JSON.stringify(o)}` : key);
const recipients = [
  { id: 'a', name: 'Alice', email: 'a@example.org', role: 'review' },
  { id: 'b', name: 'Bob', email: 'b@example.org', role: 'approve' },
  { id: 'c', name: 'Carol', email: 'c@example.org', role: 'sign' },
];

function clock(start = T0) {
  let ms = Date.parse(start);
  const now = () => new Date(ms).toISOString();
  now.advance = (minutes) => { ms += minutes * 60000; };
  return now;
}

function harness({ enabled = ['mail-v1', 'local-file-v1'] } = {}) {
  const entries = [];
  const store = {
    entries: () => entries.map((e) => ({ ...e })),
    find: (id) => entries.find((e) => e.record.id === id),
    add: (e) => entries.push(structuredClone(e)),
    put: (e) => { const i = entries.findIndex((x) => x.record.id === e.record.id); entries[i] = structuredClone(e); },
  };
  const kept = new Map();
  const sources = { put: async (h, b) => { kept.set(h, b.slice()); }, get: async (h) => kept.get(h) || null };
  const calls = [];
  const providers = createProviders({
    sendMail: async (m) => { calls.push({ kind: 'mail', ...m }); return 'mapi'; },
    deliverPackage: async (record, b, outgoing) => { calls.push({ kind: 'package', record, outgoing }); return 'x.zip'; },
  });
  const now = clock();
  const core = createApprovalCore({ store, sources, providers, isEnabled: (id) => enabled.includes(id), t, now });
  return { core, calls, now, entries, kept };
}

const input = (over = {}) => ({ title: 'Plan review', mode: 'sequential', expiresAt: null, message: 'Please check.', provider: 'mail-v1', revision: 'B', recipients, fields: [{ id: 'f1', recipientId: 'c', kind: 'signature', label: 'Sign here', page: 1, x: 10, y: 10, width: 100, height: 30 }], ...over });
const source = { bytes, name: 'Plan.pdf', pages: 1 };

test('prepare records the content hash, size, roles and message; nothing is delivered', async () => {
  const h = harness();
  const record = await h.core.prepare(input(), source);
  assert.equal(record.version, 2);
  assert.equal(record.adapter, 'mail-v1');
  assert.equal(record.config.source.hash, await digest(bytes));
  assert.equal(record.config.source.size, bytes.length);
  assert.deepEqual(record.config.recipients.map((r) => r.role), ['review', 'approve', 'sign']);
  assert.equal(record.config.message, 'Please check.');
  assert.equal((await verifyRequest(record, h.now())).status, 'draft');
  assert.equal(h.calls.length, 0);
});

test('a provider that is not explicitly enabled cannot be used', async () => {
  const h = harness({ enabled: [] });
  await assert.rejects(h.core.prepare(input(), source), /CONFIGURE_ADAPTER_FIRST/);
});

test('signature and initials fields belong to signers only', async () => {
  const h = harness();
  await assert.rejects(h.core.prepare(input({ fields: [{ id: 'f', recipientId: 'a', kind: 'signature', label: 'x', page: 1, x: 1, y: 1, width: 5, height: 5 }] }), source), /INVALID_FIELD/);
});

test('submit is the only path that calls the provider', async () => {
  const h = harness();
  const { id } = await h.core.prepare(input({ mode: 'parallel' }), source);
  const { outgoing } = await h.core.preview(id);
  await h.core.list();
  await h.core.attachmentBytes(id);
  await h.core.matchReturned(bytes, 'x.pdf');
  await h.core.exportPackage(id);
  assert.equal(h.calls.length, 0, 'preparing, previewing, listing, matching and exporting send nothing');
  await assert.rejects(h.core.submit(id, { confirmedHash: 'f'.repeat(64) }), /CONFIRM_EXACT_VERSION/);
  assert.equal(h.calls.length, 0, 'a wrong confirmation sends nothing');
  const result = await h.core.submit(id, { confirmedHash: outgoing.attachment.hash });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].to, ['a@example.org', 'b@example.org', 'c@example.org']);
  assert.equal(h.calls[0].subject, outgoing.subject);
  assert.equal(h.calls[0].body, outgoing.body);
  assert.equal(h.calls[0].name, attachmentName(result.record));
  assert.deepEqual(h.calls[0].bytes, bytes);
  assert.equal(result.state.status, 'submitted');
  assert.deepEqual(result.record.events.map((e) => e.kind), ['submit', 'dispatch']);
});

test('a failing provider records nothing', async () => {
  const h = harness();
  const { id } = await h.core.prepare(input(), source);
  const { outgoing } = await h.core.preview(id);
  const failing = createApprovalCore({ store: { entries: () => h.entries, find: (x) => h.entries.find((e) => e.record.id === x), add() {}, put() { throw new Error('must not store'); } }, sources: { put: async () => {}, get: async () => bytes }, providers: createProviders({ sendMail: async () => { throw new Error('NO_MAIL'); } }), t, now: h.now });
  await assert.rejects(failing.submit(id, { confirmedHash: outgoing.attachment.hash }), /NO_MAIL/);
  assert.equal(h.entries[0].record.events.length, 0);
});

test('sequential: only the recipient whose turn it is gets the next mail, signed copies chain', async () => {
  const h = harness();
  const { id } = await h.core.prepare(input(), source);
  let { outgoing } = await h.core.preview(id);
  assert.deepEqual(outgoing.to, ['a@example.org']);
  await h.core.submit(id, { confirmedHash: outgoing.attachment.hash });
  h.now.advance(5);
  await h.core.recordDecision(id, { recipientId: 'a', decision: 'approved', comment: 'ok by mail' });
  let list = await h.core.list();
  assert.deepEqual(list[0].state.recipients.map((r) => r.status), ['approved', 'pending', 'pending']);
  assert.deepEqual(list[0].state.recipients.map((r) => r.turn), [false, true, false]);
  ({ outgoing } = await h.core.preview(id));
  assert.deepEqual(outgoing.to, ['b@example.org']);
  await h.core.submit(id, { confirmedHash: outgoing.attachment.hash });
  await assert.rejects(h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes, name: 'x.pdf' } }), /WAITING_FOR_PREVIOUS/);
  await h.core.recordDecision(id, { recipientId: 'b', decision: 'approved' });
  // Carol signs: an incremental update after the sent bytes.
  const signed = new Uint8Array([...bytes, ...new TextEncoder().encode('% incremental signature %%EOF\n')]);
  await assert.rejects(h.core.recordDecision(id, { recipientId: 'c', decision: 'approved' }), /INVALID_RECEIPT/, 'a signer signs or rejects');
  await assert.rejects(h.core.recordDecision(id, { recipientId: 'c', decision: 'signed' }), /INVALID_RECEIPT/, 'a signature needs the returned copy');
  const r = await h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes: signed, name: 'Plan (signed).pdf' } });
  assert.equal(r.state.status, 'completed');
  assert.equal(r.kept.match, 'incremental');
  assert.equal(r.kept.hash, await digest(signed));
  assert.deepEqual(h.kept.get(r.kept.hash), signed, 'the completed document is kept');
  list = await h.core.list();
  assert.deepEqual(list[0].state.recipients.map((x) => x.status), ['approved', 'approved', 'signed']);
  assert.equal(list[0].kept.length, 1);
  await assert.rejects(h.core.preview(id), /REQUEST_CLOSED/);
});

test('rejected, expired, cancelled and superseded are distinct states, per request and per recipient', async () => {
  const h = harness();
  const rejected = (await h.core.prepare(input({ mode: 'parallel' }), source)).id;
  let o = (await h.core.preview(rejected)).outgoing;
  await h.core.submit(rejected, { confirmedHash: o.attachment.hash });
  const r = await h.core.recordDecision(rejected, { recipientId: 'b', decision: 'rejected', comment: 'no' });
  assert.equal(r.state.status, 'rejected');
  assert.deepEqual(r.state.recipients.map((x) => x.status), ['cancelled', 'rejected', 'cancelled']);

  const cancelled = (await h.core.prepare(input(), source)).id;
  const c = await h.core.cancel(cancelled, 'Owner');
  assert.equal(c.state.status, 'cancelled');
  assert.deepEqual(c.state.recipients.map((x) => x.status), ['cancelled', 'cancelled', 'cancelled']);

  const expiring = (await h.core.prepare(input({ expiresAt: '2026-11-09T10:00:00.000Z' }), source)).id;
  o = (await h.core.preview(expiring)).outgoing;
  await h.core.submit(expiring, { confirmedHash: o.attachment.hash });
  h.now.advance(90);
  let list = await h.core.list();
  const exp = list.find((x) => x.record.id === expiring);
  assert.equal(exp.state.status, 'expired');
  assert.deepEqual(exp.state.recipients.map((x) => x.status), ['expired', 'expired', 'expired']);
  await assert.rejects(h.core.recordDecision(expiring, { recipientId: 'a', decision: 'approved' }), /REQUEST_EXPIRED/);
  await assert.rejects(h.core.preview(expiring), /REQUEST_CLOSED/);
  assert.deepEqual(await h.core.recordExpiry('Owner'), [expiring]);
  assert.deepEqual(await h.core.recordExpiry('Owner'), [], 'expiry is recorded once');
  list = await h.core.list();
  assert.equal(list.find((x) => x.record.id === expiring).record.events.at(-1).kind, 'expire');

  const open = (await h.core.prepare(input(), source)).id;
  const done = await h.core.supersedeChanged('Owner');
  assert.deepEqual(done, [open], 'only running requests are superseded by a document change');
  list = await h.core.list();
  const sup = list.find((x) => x.record.id === open);
  assert.equal(sup.state.status, 'superseded');
  assert.equal(sup.state.reason, 'document-changed');
  assert.deepEqual(sup.state.recipients.map((x) => x.status), ['superseded', 'superseded', 'superseded']);
  assert.equal(list.find((x) => x.record.id === rejected).state.status, 'rejected');
  assert.equal(list.find((x) => x.record.id === cancelled).state.status, 'cancelled');
  assert.equal(list.find((x) => x.record.id === expiring).state.status, 'expired');
  await assert.rejects(h.core.cancel(open, 'Owner'), /REQUEST_CLOSED/);
});

test('state machine: every transition of version 2, valid and invalid', async () => {
  const at = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();
  const cfg = { title: 'T', mode: 'parallel', expiresAt: at(100), message: '', source: { name: 'd.pdf', hash: await digest(bytes), pages: 1, revision: '', size: bytes.length }, recipients: recipients.slice(0, 2), fields: [] };
  const draft = await createRequest(cfg, T0, { version: 2, adapter: 'mail-v1' });
  const status = async (r, m = 1) => (await verifyRequest(r, at(m))).status;
  assert.equal(await status(draft), 'draft');
  // draft → dispatch/receipt not allowed before submit
  await assert.rejects(appendEvent(draft, 'dispatch', { provider: 'mail-v1', recipients: ['a'], attachmentHash: cfg.source.hash }, 'o', at(1)), /REQUEST_CLOSED/);
  const early = ownerReceipt(draft, { recipientId: 'a', decision: 'approved', evidence: { kind: 'reply' } }, at(1));
  await assert.rejects(recordReceipt(draft, early, at(1)), /REQUEST_CLOSED/);
  // draft → submitted → dispatch (wrong provider, unknown recipient)
  const sub = await appendEvent(draft, 'submit', {}, 'o', at(1));
  assert.equal(await status(sub), 'submitted');
  await assert.rejects(appendEvent(sub, 'submit', {}, 'o', at(2)), /INVALID_TRANSITION/);
  await assert.rejects(appendEvent(sub, 'dispatch', { provider: 'local-file-v1', recipients: ['a'], attachmentHash: cfg.source.hash }, 'o', at(2)), /INVALID_DISPATCH/);
  await assert.rejects(appendEvent(sub, 'dispatch', { provider: 'mail-v1', recipients: ['zz'], attachmentHash: cfg.source.hash }, 'o', at(2)), /INVALID_DISPATCH/);
  const sent = await appendEvent(sub, 'dispatch', { provider: 'mail-v1', recipients: ['a', 'b'], attachmentHash: cfg.source.hash }, 'o', at(2));
  assert.deepEqual((await verifyRequest(sent, at(2))).recipients.map((r) => r.dispatchedAt), [at(2), at(2)]);
  // submitted → in_progress → completed
  const ra = ownerReceipt(sent, { recipientId: 'a', decision: 'approved', evidence: { kind: 'reply' } }, at(3));
  const prog = await recordReceipt(sent, ra, at(3));
  assert.equal(await status(prog, 3), 'in_progress');
  await assert.rejects(appendEvent(prog, 'dispatch', { provider: 'mail-v1', recipients: ['a'], attachmentHash: cfg.source.hash }, 'o', at(4)), /INVALID_DISPATCH/, 'a recipient who decided is not sent again');
  const done = await recordReceipt(prog, ownerReceipt(prog, { recipientId: 'b', decision: 'approved', evidence: { kind: 'reply' } }, at(4)), at(4));
  assert.equal(await status(done, 4), 'completed');
  await assert.rejects(appendEvent(done, 'cancel', {}, 'o', at(5)), /REQUEST_CLOSED/);
  await assert.rejects(appendEvent(done, 'expire', {}, 'o', at(200)), /INVALID_EXPIRY/, 'a completed request does not expire');
  // in_progress → cancelled
  assert.equal(await status(await appendEvent(prog, 'cancel', {}, 'o', at(5)), 5), 'cancelled');
  // in_progress → expired (by time, then as event); not before the due date
  assert.equal(await status(prog, 150), 'expired');
  await assert.rejects(appendEvent(prog, 'expire', {}, 'o', at(50)), /INVALID_EXPIRY/);
  const exp = await appendEvent(prog, 'expire', {}, 'o', at(150));
  assert.equal(await status(exp, 150), 'expired');
  await assert.rejects(appendEvent(exp, 'cancel', {}, 'o', at(151)), /REQUEST_EXPIRED/);
  // superseded by a document change or a replacement; never twice
  const supd = await appendEvent(prog, 'supersede', { reason: 'document-changed' }, 'o', at(6));
  assert.equal(await status(supd, 6), 'superseded');
  await assert.rejects(appendEvent(supd, 'supersede', { replacementId: 'x' }, 'o', at(7)), /INVALID_REPLACEMENT/);
  await assert.rejects(appendEvent(prog, 'supersede', { reason: 'other' }, 'o', at(6)), /INVALID_REPLACEMENT/);
  await assert.rejects(appendEvent(prog, 'supersede', { replacementId: draft.id }, 'o', at(6)), /INVALID_REPLACEMENT/, 'not by itself');
  assert.equal((await verifyRequest(await appendEvent(prog, 'supersede', { replacementId: 'new' }, 'o', at(6)), at(6))).replacementId, 'new');
  // unknown events and tampering
  await assert.rejects(appendEvent(prog, 'teleport', {}, 'o', at(6)), /INVALID_EVENT/);
  const tampered = structuredClone(done);
  tampered.events[3].payload.receipt.decision = 'rejected';
  await assert.rejects(verifyRequest(tampered, at(4)), /AUDIT_HASH_MISMATCH/);
});

test('returned copies are matched by hash, by incremental prefix, or only by reference', async () => {
  const record = await createRequest({ title: 'T', mode: 'parallel', expiresAt: null, message: '', source: { name: 'd.pdf', hash: await digest(bytes), pages: 1, revision: '', size: bytes.length }, recipients: recipients.slice(0, 1), fields: [] }, T0, { version: 2, adapter: 'mail-v1' });
  assert.equal((await matchCopy(record, bytes)).match, 'exact');
  assert.equal((await matchCopy(record, new Uint8Array([...bytes, 1, 2, 3]))).match, 'incremental');
  const rewritten = new TextEncoder().encode('%PDF-1.7 rewritten by another tool %%EOF\n');
  assert.equal((await matchCopy(record, rewritten)).match, null);
  assert.equal((await matchCopy(record, bytes.subarray(0, 10))).match, null, 'a truncated copy is no match');
  const ref = requestRef(record.id);
  assert.match(ref, /^REQ-[0-9A-F]{8}$/);
  assert.deepEqual(await findCopyMatches([record], rewritten, 'other.pdf'), []);
  const byRef = await findCopyMatches([record], rewritten, `d [${ref.toLowerCase()}] (signed).pdf`);
  assert.equal(byRef[0].match, 'reference');
  assert.equal((await findCopyMatches([record], bytes, 'x.pdf'))[0].match, 'exact');

  const h = harness();
  const { id } = await h.core.prepare(input({ mode: 'parallel' }), source);
  const o = (await h.core.preview(id)).outgoing;
  await h.core.submit(id, { confirmedHash: o.attachment.hash });
  const lr = requestRef(id);
  await assert.rejects(h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes: rewritten, name: 'other.pdf' } }), /COPY_DOES_NOT_MATCH/);
  await assert.rejects(h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes: rewritten, name: `Plan [${lr}].pdf` } }), /CONFIRM_REFERENCE_MATCH/);
  const r = await h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes: rewritten, name: `Plan [${lr}].pdf` }, confirmReference: true });
  assert.equal(r.kept.match, 'reference');
  assert.equal(r.record.events.at(-1).payload.receipt.evidence.copy.match, 'reference');
});

test('the mail preview states recipients, roles, version hash, reference and makes no legal claim', async () => {
  const record = await createRequest({ title: 'Contract', mode: 'sequential', expiresAt: '2026-12-01T22:59:59.000Z', message: 'Hello', source: { name: 'c.pdf', hash: await digest(bytes), pages: 3, revision: 'C', size: bytes.length }, recipients: recipients.slice(2), fields: [] }, T0, { version: 2, adapter: 'mail-v1' });
  const attachment = { name: attachmentName(record), hash: record.config.source.hash, size: bytes.length };
  const { subject, body } = mailText(record, record.config.recipients, { t, attachment });
  assert.equal(subject, `Contract [${requestRef(record.id)}]`);
  assert.match(body, /^Hello/);
  assert.match(body, /Carol <c@example\.org>: approvalRouting\.roles\.sign/);
  assert.ok(body.includes(`SHA-256: ${record.config.source.hash}`));
  assert.match(body, /2026-12-01/);
  assert.match(body, /approvalRouting\.mail\.howToSign/);
  assert.match(body, /approvalRouting\.mail\.disclaimer/);
  assert.match(attachment.name, /^c \[REQ-[0-9A-F]{8}\]\.pdf$/);
});

test('version 1 records keep working: no roles, no dispatch, receipts as before', async () => {
  const h = harness();
  const v1 = await createRequest({ title: 'Old', mode: 'parallel', expiresAt: null, source: { name: 'o.pdf', hash: await digest(bytes), pages: 1, revision: '' }, recipients: [{ id: 'a', name: 'A', email: 'a@x.org' }], fields: [] }, T0);
  h.entries.push({ record: v1, kept: [] });
  await h.kept.set(v1.config.source.hash, bytes);
  const { outgoing } = await h.core.preview(v1.id);
  assert.equal(outgoing.provider, 'local-file-v1');
  const r = await h.core.submit(v1.id, { confirmedHash: outgoing.attachment.hash });
  assert.deepEqual(r.record.events.map((e) => e.kind), ['submit']);
  assert.equal(h.calls[0].kind, 'package');
  await assert.rejects(h.core.preview(v1.id), /ALREADY_RELEASED/);
  await assert.rejects(h.core.recordDecision(v1.id, { recipientId: 'a', decision: 'approved' }), /USE_RECEIPT_FILE/);
});

test('sequential signing: the next recipient gets the returned signed copy, not the original', async () => {
  const h = harness();
  const order = [recipients[2], recipients[1]]; // Carol signs first, then Bob approves
  const { id } = await h.core.prepare(input({ recipients: order, fields: [] }), source);
  let { outgoing } = await h.core.preview(id);
  await h.core.submit(id, { confirmedHash: outgoing.attachment.hash });
  const signed = new Uint8Array([...bytes, ...new TextEncoder().encode('% sig 1 %%EOF\n')]);
  await h.core.recordDecision(id, { recipientId: 'c', decision: 'signed', copy: { bytes: signed, name: 'Plan (signed).pdf' } });
  ({ outgoing } = await h.core.preview(id));
  assert.equal(outgoing.attachment.from, 'copy');
  assert.equal(outgoing.attachment.hash, await digest(signed));
  await h.core.submit(id, { confirmedHash: outgoing.attachment.hash });
  assert.deepEqual(h.calls.at(-1).bytes, signed);
  assert.deepEqual(h.calls.at(-1).to, ['b@example.org']);
});
