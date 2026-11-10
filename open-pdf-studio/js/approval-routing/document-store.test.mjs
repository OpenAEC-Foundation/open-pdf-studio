// Goedkeuringsroutes (#651): aanvragen gaan mee in de PDF (opslaan en
// opnieuw laden), en een opslag van een inhoudelijk gewijzigd document
// vervangt de lopende aanvragen; alleen goedkeuringsgegevens niet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readApprovalRequests, writeApprovalRequests, contentChanged, markApprovalModified, resetApprovalBaseline, APPROVAL_CATALOG_KEY } from './document-store.js';
import { approvalBeforeSave } from './save-hook.js';
import { createRequest, appendEvent, verifyRequest, digest } from './model.js';

const T0 = '2026-11-09T09:00:00.000Z';

async function blankPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return pdf.save();
}
async function request(bytes, extra = {}) {
  return createRequest({
    title: 'Wanddetail (é, ü, 中文)', mode: 'sequential', expiresAt: null, message: 'Graag (vóór vrijdag) \\ bekijken',
    source: { name: 'd.pdf', hash: await digest(bytes), pages: 1, revision: 'A', size: bytes.length },
    recipients: [{ id: 'a', name: 'Anne', email: 'a@example.org', role: 'approve' }], fields: [], ...extra,
  }, T0, { version: 2, adapter: 'mail-v1' });
}
/** Een document met een kopiërende setter, zoals state.documents in de app. */
function copyingDoc(init = {}) {
  const doc = { modified: false, inhoudRevisie: 0, ...init };
  let stored = init.goedkeuringen;
  Object.defineProperty(doc, 'goedkeuringen', { get: () => stored, set: (v) => { stored = structuredClone(v); }, enumerable: true });
  return doc;
}
const markModified = (doc) => { doc.modified = true; doc._alleenGoedkeuringGewijzigd = false; };

test('requests round-trip through save and load with the full audit chain', async () => {
  const bytes = await blankPdf();
  let record = await request(bytes);
  record = await appendEvent(record, 'submit', {}, 'Owner', T0);
  const entries = [{ record, kept: [{ hash: 'a'.repeat(64), size: 10, match: 'incremental', name: 'd (signed).pdf', recipientId: 'a', decision: 'signed', at: T0 }] }];
  const pdf = await PDFDocument.load(bytes);
  writeApprovalRequests(pdf, entries);
  const saved = await pdf.save();
  const back = readApprovalRequests(await PDFDocument.load(saved));
  assert.deepEqual(back, entries);
  assert.equal((await verifyRequest(back[0].record, T0)).status, 'submitted');
  assert.deepEqual(readApprovalRequests(await PDFDocument.load(bytes)), [], 'no key, no requests');
  // No requests: the key goes away.
  const again = await PDFDocument.load(saved);
  writeApprovalRequests(again, []);
  assert.equal(again.catalog.get(PDFName.of(APPROVAL_CATALOG_KEY)), undefined);
});

test('a damaged value reads as no requests', async () => {
  const pdf = await PDFDocument.load(await blankPdf());
  pdf.catalog.set(PDFName.of(APPROVAL_CATALOG_KEY), pdf.context.obj(12));
  assert.deepEqual(readApprovalRequests(pdf), []);
});

test('approval-only changes are not a new document version; content edits are', () => {
  const doc = copyingDoc();
  assert.equal(contentChanged(doc), false);
  markApprovalModified(doc, markModified);
  assert.equal(doc.modified, true);
  assert.equal(contentChanged(doc), false, 'only approval data changed');
  doc.inhoudRevisie = 1; // an edit through the undo history
  assert.equal(contentChanged(doc), true);
  resetApprovalBaseline(doc);
  doc.modified = false;
  assert.equal(contentChanged(doc), false);
  markModified(doc); // a direct edit (markDocumentModified)
  markApprovalModified(doc, markModified);
  assert.equal(contentChanged(doc), true, 'an earlier content edit stays visible');
  // Edit and undo leave the document clean: approval data alone is no change.
  const clean = copyingDoc({ inhoudRevisie: 4 });
  markApprovalModified(clean, markModified);
  assert.equal(contentChanged(clean), false);
});

test('saving a changed document supersedes running requests and writes them into the file', async () => {
  const bytes = await blankPdf();
  const running = await appendEvent(await request(bytes), 'submit', {}, 'Owner', T0);
  const doneDraft = await request(bytes);
  const cancelled = await appendEvent(doneDraft, 'cancel', {}, 'Owner', T0);
  const doc = copyingDoc({ goedkeuringen: [{ record: running, kept: [] }, { record: cancelled, kept: [] }] });

  // Approval data only: nothing is superseded.
  markApprovalModified(doc, markModified);
  let pdf = await PDFDocument.load(bytes);
  let r = await approvalBeforeSave(pdf, doc, { now: () => '2026-11-09T10:00:00.000Z' });
  assert.deepEqual(r.superseded, []);
  assert.equal((await verifyRequest(doc.goedkeuringen[0].record)).status, 'submitted');

  // A recovery snapshot of a content edit changes no state either.
  doc.inhoudRevisie = 3;
  r = await approvalBeforeSave(pdf, doc, { snapshot: true, now: () => '2026-11-09T10:00:00.000Z' });
  assert.deepEqual(r.superseded, []);

  // The real save of the edited document supersedes the running request only.
  pdf = await PDFDocument.load(bytes);
  r = await approvalBeforeSave(pdf, doc, { now: () => '2026-11-09T10:00:00.000Z' });
  assert.deepEqual(r.superseded, [running.id]);
  const states = await Promise.all(doc.goedkeuringen.map((e) => verifyRequest(e.record)));
  assert.deepEqual(states.map((s) => s.status), ['superseded', 'cancelled']);
  assert.equal(states[0].reason, 'document-changed');
  const back = readApprovalRequests(await PDFDocument.load(await pdf.save()));
  assert.equal((await verifyRequest(back[0].record)).status, 'superseded');
  assert.equal(back.length, 2);
});

test('expired requests get their event at save; unread requests leave the file alone', async () => {
  const bytes = await blankPdf();
  const due = await appendEvent(await request(bytes, { expiresAt: '2026-11-09T09:30:00.000Z' }), 'submit', {}, 'Owner', T0);
  const doc = copyingDoc({ goedkeuringen: [{ record: due, kept: [] }] });
  const pdf = await PDFDocument.load(bytes);
  const r = await approvalBeforeSave(pdf, doc, { now: () => '2026-11-09T11:00:00.000Z' });
  assert.deepEqual(r.expired, [due.id]);
  assert.equal(doc.goedkeuringen[0].record.events.at(-1).kind, 'expire');

  // Requests not read yet (doc.goedkeuringen missing): the key stays as it is.
  const withKey = await PDFDocument.load(bytes);
  writeApprovalRequests(withKey, [{ record: due, kept: [] }]);
  await approvalBeforeSave(withKey, { modified: true });
  assert.equal(readApprovalRequests(withKey).length, 1);
});

test('saver and loader are wired to the approval store', async () => {
  const { readFileSync } = await import('node:fs');
  const saver = readFileSync(new URL('../pdf/saver.js', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../pdf/loader.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../ui/chrome/tabs.js', import.meta.url), 'utf8');
  assert.match(saver, /approvalBeforeSave\(pdfDocLib, activeDoc, \{ snapshot: momentopname \|\| alleenAnnotaties \}\)/);
  assert.match(loader, /doc\.goedkeuringen = readApprovalRequests\(pdfLibDoc\)/);
  const saved = tabs.slice(tabs.indexOf('export function markDocumentSaved'));
  assert.match(saved.slice(0, 600), /_goedkeuringBasis = doc\.inhoudRevisie/);
  const modified = tabs.slice(tabs.indexOf('export function markDocumentModified'));
  assert.match(modified.slice(0, 600), /_alleenGoedkeuringGewijzigd = false/);
});
