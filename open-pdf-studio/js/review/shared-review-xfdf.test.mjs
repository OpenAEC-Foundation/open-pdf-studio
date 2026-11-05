// The XFDF snapshot of the shared review (#237) goes through the existing
// XFDF code: the real xfdf.js writes it, the real reader reads it back with
// the same ids, and a participant with only an XFDF file joins the merge.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

import { MiniDOMParser } from './mini-xml-dom.testhulp.mjs';
import { mergeReviewFiles, xfdfFileName, logFileName, serializeEvents, makeEvents } from './shared-review-core.js';

register('./xfdf-stubs.mjs', import.meta.url);

let counter = 0;
globalThis.DOMParser = MiniDOMParser;
globalThis.__xfdfStubs = {
  state: { defaultAuthor: 'User', preferences: {} },
  getActiveDocument: () => null,
  createAnnotation: (props) => ({ id: `gen${++counter}`, ...props }),
  ifcCategoryForParametric: () => '',
};

const { annotationsToXfdf, parseXfdfAnnotations, parseXfdfDocument } = await import('../annotations/xfdf.js');

const annotations = [
  { id: 'c-alice-1', type: 'comment', page: 1, x: 10, y: 20, width: 24, height: 24, text: 'Check <beam> & "column"', color: '#ff0000', author: 'Alice', createdAt: '2026-10-28T09:00:00Z', modifiedAt: '2026-10-28T09:05:00Z' },
  { id: 'b-alice-2', type: 'box', page: 2, x: 5, y: 6, width: 100, height: 50, strokeColor: '#0000ff', lineWidth: 2, subject: 'Opening', author: 'Alice' },
  { id: 't-alice-3', type: 'textbox', page: 1, x: 50, y: 60, width: 120, height: 40, text: 'Note', strokeColor: '#000000', fillColor: '#ffffd0', fontSize: 12, author: 'Alice' },
];

test('the snapshot is valid XFDF with the review ids as names (no duplicate attributes)', () => {
  const xml = annotationsToXfdf(annotations, { fileName: 'Plan.pdf', doc: null, names: true });
  assert.match(xml, /<f href="Plan\.pdf"\/>/);
  for (const a of annotations) assert.ok(xml.includes(`name="${a.id}"`), a.id);
  assert.equal((xml.match(/name="t-alice-3"/g) || []).length, 1, 'the freetext writes its name once');
  const parsed = parseXfdfDocument(xml);
  assert.equal(parsed.error, null);
  assert.equal(parsed.items.length, 3);
});

test('round trip: the existing reader gets the same ids, authors, pages and text back', () => {
  const xml = annotationsToXfdf(annotations, { fileName: 'Plan.pdf', doc: null, names: true });
  const back = parseXfdfAnnotations(xml);
  assert.deepEqual(back.map((a) => [a.id, a.type, a.page, a.author]), [
    ['c-alice-1', 'comment', 1, 'Alice'], ['b-alice-2', 'box', 2, 'Alice'], ['t-alice-3', 'textbox', 1, 'Alice'],
  ]);
  assert.equal(back[0].text, 'Check <beam> & "column"');
  assert.equal(back[0].createdAt, '2026-10-28T09:00:00Z');
  assert.equal(back[1].x, 5);
  assert.equal(back[1].width, 100);
});

test('without names the ordinary export is unchanged: only the freetext carries one', () => {
  const xml = annotationsToXfdf(annotations, { fileName: 'Plan.pdf', doc: null });
  assert.ok(!xml.includes('name="c-alice-1"'));
  assert.ok(xml.includes('name="t-alice-3"'));
  assert.equal(parseXfdfDocument(xml).items.length, 3);
});

test('an XFDF from another program joins the review as its author’s annotations', () => {
  const xml = annotationsToXfdf(annotations.slice(0, 2), { fileName: 'Plan.pdf', doc: null, names: true });
  const bobEvents = makeEvents([{ op: 'edit', ann: 'c-alice-1', base: null, data: { ...annotations[0], text: 'Bob was here' } }], { user: 'Bob', maxClock: 0 });
  const m = mergeReviewFiles([
    { name: xfdfFileName('Plan', 'Alice'), text: xml },
    { name: logFileName('Plan', 'Bob'), text: serializeEvents(bobEvents) },
  ], 'Plan', { parseXfdf: parseXfdfAnnotations });
  assert.deepEqual([...m.annotations.keys()].sort(), ['b-alice-2', 'c-alice-1']);
  // Alice's XFDF counts as clock 0: Bob's later edit wins and both are in the history.
  const c = m.annotations.get('c-alice-1');
  assert.equal(c.data.text, 'Bob was here');
  assert.deepEqual(c.history.map((h) => [h.op, h.user]), [['create', 'Alice'], ['edit', 'Bob']]);
});

test('broken or empty XFDF is no review data, not an error', () => {
  assert.deepEqual(parseXfdfAnnotations('<xfdf><annots>'), []);
  assert.deepEqual(parseXfdfAnnotations('<xfdf></xfdf>'), []);
  assert.equal(parseXfdfDocument('<<<').error, 'invalidXfdfFile');
  const empty = annotationsToXfdf([], { fileName: 'Plan.pdf', doc: null, names: true });
  assert.deepEqual(parseXfdfAnnotations(empty), []);
});
