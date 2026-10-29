// Accessibility report (#384): untagged documents, figures without alt text,
// untagged content per page and annotations without a description.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildAccessibilityReport, referencedMcids } from './report.js';
import { readStructTree } from './struct-tree.js';
import { applyEditsToTree, withAlt, editsOf } from './struct-edits.js';
import { mcidTextMap } from './reading-order.js';
import { taggedPdf, untaggedPdf, pdfjsPages } from './tagged-pdf.testhulp.mjs';

async function inputs(bytes) {
  const tree = readStructTree(await PDFDocument.load(bytes));
  const pages = (await pdfjsPages(bytes)).map((items, pageIndex) => {
    const info = mcidTextMap(items);
    return { pageIndex, mcids: info.mcids, untaggedItems: info.untaggedItems, taggedItems: info.taggedItems };
  });
  return { tree, pages };
}

const kinds = (r) => r.issues.map((i) => `${i.kind}@${i.pageIndex ?? '-'}`);

test('a tagged document: figure without alt text and untagged text are reported', async () => {
  const { tree, pages } = await inputs(await taggedPdf());
  const r = buildAccessibilityReport({ tree, pages, annotations: [] });
  assert.deepEqual(kinds(r), ['figureNoAlt@0', 'untaggedContent@0']);
  assert.equal(r.issues.find((i) => i.kind === 'figureNoAlt').key, '0.2');
  assert.equal(r.issues.find((i) => i.kind === 'untaggedContent').count, 1, '"Loose line"; the artifact footer is fine');
  assert.deepEqual(r.counts, { figureNoAlt: 1, untaggedContent: 1 });
});

test('an alt text edit clears the figure issue before saving', async () => {
  const { tree, pages } = await inputs(await taggedPdf());
  const root = applyEditsToTree(tree.root, withAlt(editsOf({}), '0.2', 'Figure', 'A square'));
  const r = buildAccessibilityReport({ tree: { ...tree, root }, pages });
  assert.deepEqual(kinds(r), ['untaggedContent@0']);
});

test('document-level problems: not marked, no language', async () => {
  const { tree, pages } = await inputs(await taggedPdf({ figureAlt: 'x', lang: null, marked: false }));
  const r = buildAccessibilityReport({ tree, pages });
  assert.deepEqual(kinds(r), ['notMarked@-', 'noLanguage@-', 'untaggedContent@0']);
});

test('an untagged document is reported as such', async () => {
  const tree = readStructTree(await PDFDocument.load(await untaggedPdf()));
  const r = buildAccessibilityReport({ tree, pages: [] });
  assert.deepEqual(kinds(r), ['notTagged@-', 'noLanguage@-']);
  assert.equal(r.issues[0].severity, 'error');
});

test('a page whose text is all untagged, and marked content the tree never refers to', () => {
  const tree = { tagged: true, marked: true, lang: 'nl', root: { kind: 'root', key: '', children: [
    { kind: 'element', key: '0', role: 'P', standardRole: 'P', children: [{ kind: 'mcid', mcid: 0, pageIndex: 0 }] },
  ] } };
  assert.deepEqual([...referencedMcids(tree.root).get(0)], [0]);
  const r = buildAccessibilityReport({ tree, pages: [
    { pageIndex: 0, mcids: new Set([0, 7]), untaggedItems: 0, taggedItems: 3 },
    { pageIndex: 1, mcids: new Set(), untaggedItems: 4, taggedItems: 0 },
    { pageIndex: 2, mcids: new Set(), untaggedItems: 0, taggedItems: 0 },
  ] });
  assert.deepEqual(kinds(r), ['untaggedContent@0', 'pageNotTagged@1']);
  assert.equal(r.issues[0].count, 1, 'MCID 7 is orphaned');
  assert.equal(r.issues[1].count, 4);
});

test('annotations without a description are reported; text or alt text is enough', () => {
  const tree = { tagged: false, lang: 'en' };
  const r = buildAccessibilityReport({ tree, annotations: [
    { id: 'a', type: 'stamp', page: 2 },
    { id: 'b', type: 'comment', page: 1, text: 'Check this' },
    { id: 'c', type: 'image', page: 1, altText: 'Logo' },
    { id: 'd', type: 'box', page: 3, text: '   ' },
    { id: 'e', type: 'mask', page: 1 },
  ] });
  assert.deepEqual(kinds(r), ['notTagged@-', 'annotationNoText@1', 'annotationNoText@2']);
  assert.deepEqual(r.issues.filter((i) => i.annotationId).map((i) => i.annotationId), ['a', 'd']);
});
