// Structure tree (#384): parsing (nesting, RoleMap, MCR/OBJR, pages), the
// MCID-to-text mapping through pdf.js, and the reading order of a tagged
// document against its content-stream order.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readStructTree, resolveRole, walkElements, findByKey } from './struct-tree.js';
import {
  mcidTextMap, mcidFromId, contentOrderText, structureSegments, segmentText, firstSegmentFromPage, splitForSpeech,
} from './reading-order.js';
import { taggedPdf, untaggedPdf, pdfjsPages } from './tagged-pdf.testhulp.mjs';

async function model(bytes) {
  return readStructTree(await PDFDocument.load(bytes));
}

const roles = (root) => [...walkElements(root)].map((e) => `${e.key}:${e.role}>${e.standardRole}`);

test('RoleMap: chains are followed, cycles stop, standard roles stay', () => {
  assert.equal(resolveRole('Heading', { Heading: 'H1' }), 'H1');
  assert.equal(resolveRole('A', { A: 'B', B: 'P' }), 'P');
  assert.equal(resolveRole('X', { X: 'Y', Y: 'X' }), 'X');
  assert.equal(resolveRole('P', { P: 'Span' }), 'P', 'a standard role is not remapped');
  assert.equal(resolveRole('Custom', {}), 'Custom');
});

test('the nested tree is read with keys, mapped roles, pages and MCIDs', async () => {
  const m = await model(await taggedPdf({ figureAlt: 'A blue square' }));
  assert.equal(m.tagged, true);
  assert.equal(m.marked, true);
  assert.equal(m.lang, 'en-US');
  assert.deepEqual(m.roleMap, { Heading: 'H1', Para: 'P' });
  assert.equal(m.elementCount, 7);
  assert.deepEqual(roles(m.root), [
    '0:Document>Document',
    '0.0:Heading>H1',
    '0.1:Sect>Sect',
    '0.1.0:P>P',
    '0.1.0.0:Span>Span',
    '0.2:Figure>Figure',
    '0.3:Para>P',
  ]);
  const span = findByKey(m.root, '0.1.0.0');
  assert.deepEqual(span.children, [{ kind: 'mcid', index: 0, mcid: 0, pageIndex: 0 }], 'an MCR carries its own page');
  assert.equal(findByKey(m.root, '0.2').alt, 'A blue square');
  assert.deepEqual(findByKey(m.root, '0.3').children, [{ kind: 'mcid', index: 0, mcid: 0, pageIndex: 1 }]);
  assert.equal(findByKey(m.root, '0.0').pageIndex, 0);
});

test('an untagged document has no tree', async () => {
  const m = await model(await untaggedPdf());
  assert.equal(m.tagged, false);
  assert.equal(m.root, null);
});

test('OBJR references and a cycle in /K do not break reading', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const ctx = doc.context;
  const rootRef = ctx.nextRef();
  const linkRef = ctx.nextRef();
  const annotRef = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
  // The link lists itself as a kid: read once, not forever.
  ctx.assign(linkRef, ctx.obj({ Type: 'StructElem', S: 'Link', P: rootRef, Pg: page.ref,
    K: [ctx.obj({ Type: 'OBJR', Obj: annotRef }), linkRef, 3] }));
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: linkRef }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  const m = await model(await doc.save());
  const link = findByKey(m.root, '0');
  assert.equal(link.role, 'Link');
  assert.equal(link.kidCount, 3);
  assert.deepEqual(link.children.map((c) => c.kind), ['objr', 'mcid']);
  assert.equal(link.children[0].objRef, annotRef.toString());
  assert.equal(link.children[0].pageIndex, 0, 'OBJR inherits the page of its element');
});

test('pdf.js marked content maps MCIDs to their text; artifacts and loose text are counted apart', async () => {
  assert.equal(mcidFromId('p12R_mc3'), 3);
  assert.equal(mcidFromId('p4R5_mc10'), 10);
  assert.equal(mcidFromId(null), null);
  const [page1, page2] = await pdfjsPages(await taggedPdf());
  const info = mcidTextMap(page1);
  assert.equal(info.byMcid.get(0).trim(), 'Second paragraph');
  assert.equal(info.byMcid.get(2).trim(), 'First heading');
  assert.equal(info.byMcid.has(1), false, 'the figure has no text');
  assert.deepEqual([...info.mcids].sort(), [0, 1, 2]);
  assert.equal(info.untaggedItems, 1, '"Loose line" is outside every MCID');
  assert.equal(info.artifactItems, 1, 'the footer is an artifact');
  assert.equal(mcidTextMap(page2).byMcid.get(0).trim(), 'Third paragraph');
});

test('reading order follows the structure tree, not the content stream', async () => {
  const bytes = await taggedPdf({ figureAlt: 'A blue square' });
  const m = await model(bytes);
  const pages = await pdfjsPages(bytes);
  const maps = pages.map((items) => mcidTextMap(items).byMcid);
  const segments = structureSegments(m.root);
  const texts = segments.map((s) => segmentText(s, (p) => maps[p]));
  assert.deepEqual(texts, ['First heading', 'Second paragraph', 'A blue square', 'Third paragraph']);
  assert.deepEqual(segments.map((s) => s.role), ['H1', 'P', 'Figure', 'P']);
  assert.deepEqual(segments.map((s) => s.pageIndex), [0, 0, 0, 1]);
  // Content order of the same page is different.
  assert.equal(contentOrderText(pages[0]), 'Second paragraph First heading Loose line Page footer');
  // Reading from page 2 starts at its first segment.
  assert.equal(firstSegmentFromPage(segments, 1), 3);
  assert.equal(firstSegmentFromPage(segments, 5), -1);
});

test('a figure without alt text is read as its content; ActualText replaces content; artifacts are skipped', () => {
  const el = (key, role, extra = {}) => ({ kind: 'element', key, role, standardRole: role, pageIndex: 0, children: [], ...extra });
  const root = { kind: 'root', key: '', children: [
    el('0', 'Figure', { children: [{ kind: 'mcid', mcid: 1, pageIndex: 0 }] }),
    el('1', 'P', { children: [
      { kind: 'mcid', mcid: 2, pageIndex: 0 },
      el('1.1', 'Span', { actualText: 'twenty', children: [{ kind: 'mcid', mcid: 3, pageIndex: 0 }] }),
      el('1.2', 'Link', { children: [{ kind: 'mcid', mcid: 4, pageIndex: 0 }] }),
    ] }),
    el('2', 'Artifact', { children: [{ kind: 'mcid', mcid: 5, pageIndex: 0 }] }),
  ] };
  const map = new Map([[1, 'IMG'], [2, 'Page'], [3, '20'], [4, 'here'], [5, 'footer']]);
  const texts = structureSegments(root).map((s) => segmentText(s, () => map));
  assert.deepEqual(texts, ['IMG', 'Page twenty here'], 'figure text is read as content, Span/Link stay inline');
});

test('long text is split for speech at sentence ends and spaces', () => {
  const s = 'One two three. '.repeat(40);
  const parts = splitForSpeech(s, 100);
  assert.ok(parts.length > 4);
  assert.ok(parts.every((p) => p.length <= 100));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), s.trim());
  const word = 'x'.repeat(250);
  assert.deepEqual(splitForSpeech(word, 100).map((p) => p.length), [100, 100, 50]);
  assert.deepEqual(splitForSpeech('   '), []);
});

