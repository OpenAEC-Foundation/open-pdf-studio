// Uitwisselen per auteur via XFDF (#629): exporteren voor één of meer auteurs,
// en importeren van de bestanden van meerdere beoordelaars zonder dubbelen
// (op naam /NM, anders op vingerafdruk van inhoud en plek).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

import { auteurVan, auteursIn, vanAuteurs, metXfdfNamen, xfdfVingerafdruk, voegXfdfSamen } from './xfdf-samenvoegen.js';
import { MiniDOMParser } from '../review/mini-xml-dom.testhulp.mjs';

register('../review/xfdf-stubs.mjs', import.meta.url);

let teller = 0;
let actief = null;
const geschreven = [];
const meldingen = [];
let keuze = { ok: true, auteurs: null };
globalThis.DOMParser = MiniDOMParser;
globalThis.__xfdfStubs = {
  state: { defaultAuthor: 'User', preferences: {} },
  getActiveDocument: () => actief,
  createAnnotation: (props) => ({ id: `gen${++teller}`, ...props }),
  cloneAnnotation: (a) => structuredClone(a),
  ifcCategoryForParametric: () => '',
  bevestigExportVerlies: async () => keuze,
  saveFileDialog: async (naam) => `/uit/${naam}`,
  writeBinaryFile: async (pad, bytes) => { geschreven.push({ pad, tekst: new TextDecoder().decode(bytes) }); },
  showMessage: (m) => meldingen.push(m),
};

const { annotationsToXfdf, parseXfdfDocument, importFromXFDF, exportXFDFToFile } = await import('./xfdf.js');

const comment = (id, author, x, text, extra = {}) => ({ id, type: 'comment', page: 1, x, y: 20, width: 24, height: 24, text, color: '#ff0000', author, ...extra });
const box = (id, author, x, extra = {}) => ({ id, type: 'box', page: 2, x, y: 6, width: 100, height: 50, strokeColor: '#0000ff', lineWidth: 2, subject: 'Opening', author, ...extra });

test('authors: names as XFDF writes them, counted and sorted; filtering keeps replies with their markup', () => {
  assert.equal(auteurVan({ author: '  Bob ' }), 'Bob');
  assert.equal(auteurVan({}), 'User');
  const anns = [box('1', 'Bob', 1), comment('2', 'Alice', 2, 'x', { replies: [{ author: 'Bob', text: 'ok' }] }), box('3', '', 3)];
  assert.deepEqual(auteursIn(anns), [{ naam: 'Alice', aantal: 1 }, { naam: 'Bob', aantal: 1 }, { naam: 'User', aantal: 1 }]);
  assert.deepEqual(vanAuteurs(anns, ['Alice']).map((a) => a.id), ['2']);
  assert.equal(vanAuteurs(anns, ['Alice'])[0].replies.length, 1);
  assert.deepEqual(vanAuteurs(anns, null).map((a) => a.id), ['1', '2', '3']);
  assert.deepEqual(vanAuteurs(anns, []), []);
});

test('names: the /NM when there is one (and only once), otherwise the id; the originals stay as they are', () => {
  const a = box('id-a', 'A', 1, { nm: 'NM-1' });
  const b = box('id-b', 'A', 2, { nm: 'NM-1' });
  const c = box('id-c', 'A', 3);
  const uit = metXfdfNamen([a, b, c]);
  assert.deepEqual(uit.map((x) => x.id), ['NM-1', 'id-b', 'id-c']);
  assert.equal(a.id, 'id-a');
  assert.equal(uit[2], c, 'unchanged annotations are not copied');
});

test('fingerprint: kind as it comes back from XFDF, page, position, author and text', () => {
  const f = xfdfVingerafdruk;
  assert.equal(f({ type: 'highlight', page: 1, x: 1, y: 2, subject: 'a', author: 'X' }), f({ type: 'textHighlight', page: 1, x: 1.2, y: 2, subject: ' a ', author: 'x' }));
  assert.equal(f(comment('a', 'A', 10, 'Hi')), f({ ...comment('b', 'A', 10, 'Hi'), width: 30 }), 'a note comes back as 24 × 24');
  assert.notEqual(f(comment('a', 'A', 10, 'Hi')), f(comment('a', 'A', 10, 'Ho')));
  assert.notEqual(f(comment('a', 'A', 10, 'Hi')), f(comment('a', 'B', 10, 'Hi')));
  assert.notEqual(f(comment('a', 'A', 10, 'Hi')), f({ ...comment('a', 'A', 10, 'Hi'), page: 2 }));
  assert.equal(f({ type: 'line', page: 1, startX: 1, startY: 2, endX: 3, endY: 4 }).split('|')[2], '1,2,3,4');
  assert.equal(f(null), '');
});

test('merge: by name, else by fingerprint; new replies of a known markup come along once', () => {
  const bestaande = [comment('local-1', 'Alice', 10, 'Check beam', { nm: 'NM-A', replies: [{ author: 'Alice', text: 'see detail' }] }), box('local-2', 'Bob', 5)];
  const binnen = [
    { ann: comment('NM-A', 'Alice', 99, 'changed position', { replies: [{ author: 'Carol', text: 'agreed' }, { author: 'Alice', text: 'see detail' }] }), naam: 'NM-A' },
    { ann: box('gen-x', 'Bob', 5), naam: null },
    { ann: comment('new-1', 'Carol', 40, 'New remark'), naam: 'new-1' },
    { ann: comment('new-1', 'Carol', 40, 'New remark', { replies: [{ author: 'Dave', text: '+1' }] }), naam: 'new-1' },
    { ann: comment('gen-y', 'Dave', 60, 'Second file'), naam: null },
    { ann: comment('gen-z', 'Dave', 60, 'Second file'), naam: null },
  ];
  const r = voegXfdfSamen(bestaande, binnen);
  assert.deepEqual(r.nieuw.map((i) => i.ann.id), ['new-1', 'gen-y']);
  assert.equal(r.dubbel, 4);
  assert.equal(r.antwoorden.length, 2);
  assert.equal(r.antwoorden[0].doel, bestaande[0]);
  assert.deepEqual(r.antwoorden[0].nieuw.map((x) => x.author), ['Carol']);
  assert.equal(r.antwoorden[1].doel, binnen[2].ann, 'a markup new in this import collects replies too');
  assert.equal(bestaande[0].replies.length, 1, 'the merge itself mutates nothing');
});

// ── Door de echte xfdf.js ──

test('XFDF round trip: an exported file imported into the same document adds nothing', () => {
  const anns = [comment('c1', 'Alice', 10, 'Check <beam>', { nm: 'NM-C1', replies: [{ author: 'Bob', text: 'ok', createdAt: '2026-11-01T10:00:00Z' }] }), box('b1', 'Bob', 5)];
  const xml = annotationsToXfdf(metXfdfNamen(anns), { fileName: 'Plan.pdf', doc: null, names: true });
  assert.ok(xml.includes('name="NM-C1"') && xml.includes('name="b1"'));
  const { items } = parseXfdfDocument(xml);
  assert.deepEqual(items.map((i) => i.naam), ['NM-C1', 'b1']);
  // The nested reply of the note is read back.
  assert.deepEqual(items[0].ann.replies.map((r) => [r.author, r.text]), [['Bob', 'ok']]);
  const r = voegXfdfSamen(anns, items);
  assert.equal(r.nieuw.length, 0);
  assert.equal(r.dubbel, 2);
  assert.equal(r.antwoorden.length, 0);
  // Without names (an older export, or another program): the fingerprint finds them.
  const zonder = annotationsToXfdf(anns, { fileName: 'Plan.pdf', doc: null });
  const r2 = voegXfdfSamen(anns, parseXfdfDocument(zonder).items);
  assert.equal(r2.nieuw.length, 0);
  assert.equal(r2.dubbel, 2);
});

test('import of several reviewers\' files: each markup once, names become /NM, one undoable step', () => {
  const eigen = comment('mine', 'Alice', 10, 'Base remark', { nm: 'NM-BASE' });
  actief = { annotations: [eigen], viewMode: 'single' };
  const bob = annotationsToXfdf(metXfdfNamen([eigen, box('bob-1', 'Bob', 5)]), { fileName: 'Plan.pdf', doc: null, names: true });
  const carol = annotationsToXfdf(metXfdfNamen([
    { ...eigen, replies: [{ author: 'Carol', text: 'agree' }] }, box('bob-1', 'Bob', 5), comment('carol-1', 'Carol', 70, 'Mine'),
  ]), { fileName: 'Plan.pdf', doc: null, names: true });
  const r = importFromXFDF([bob, carol]);
  assert.deepEqual(r, { added: 2, duplicates: 3, replies: 1 });
  assert.deepEqual(actief.annotations.map((a) => a.id), ['mine', 'bob-1', 'carol-1']);
  assert.deepEqual(actief.annotations.map((a) => a.nm), ['NM-BASE', 'bob-1', 'carol-1']);
  assert.deepEqual(eigen.replies.map((x) => x.author), ['Carol']);
  // Again: nothing new.
  assert.deepEqual(importFromXFDF([bob, carol]), { added: 0, duplicates: 5, replies: 0 });
  assert.equal(actief.annotations.length, 3);
  // One broken file among good ones does not stop the import.
  assert.deepEqual(importFromXFDF(['<<<', carol]), { added: 0, duplicates: 3, replies: 0 });
  actief = null;
});

test('the import keeps one undo step for added markups and merged replies', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('./xfdf.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const imp = bron.slice(bron.indexOf('export function importFromXFDF('), bron.indexOf('export function parseXfdfDocument('));
  assert.match(imp, /beginUndoTransaction\(\);[\s\S]*recordBulkAdd\(newAnnotations\)[\s\S]*recordBulkModify\(gewijzigd, origineel\)[\s\S]*endUndoTransaction\(\);/);
  assert.match(imp, /voegXfdfSamen\(activeDoc\?\.annotations \|\| \[\], binnen\)/);
  const bestand = bron.slice(bron.indexOf('export async function importXFDFFromFile('), bron.indexOf('// Parse XFDF XML and add annotations'));
  assert.match(bestand, /openFileDialog\(\['xfdf', 'xml'\], \{ multiple: true \}\)/);
});

test('export for the chosen authors only, with names, after the question', async () => {
  actief = {
    filePath: 'C:\\proj\\Plan.pdf',
    annotations: [comment('a1', 'Alice', 10, 'From Alice', { nm: 'NM-A1' }), box('b1', 'Bob', 5), comment('a2', 'Alice', 30, 'Also Alice')],
  };
  keuze = { ok: true, auteurs: ['Alice'] };
  geschreven.length = 0;
  await exportXFDFToFile();
  assert.equal(geschreven.length, 1);
  assert.equal(geschreven[0].pad, '/uit/C:\\proj\\Plan.xfdf');
  const items = parseXfdfDocument(geschreven[0].tekst).items;
  assert.deepEqual(items.map((i) => [i.naam, i.ann.author]), [['NM-A1', 'Alice'], ['a2', 'Alice']]);
  assert.match(geschreven[0].tekst, /<f href="Plan\.pdf"\/>/);

  // Cancel in the dialog: nothing is written.
  keuze = { ok: false, auteurs: null };
  await exportXFDFToFile();
  assert.equal(geschreven.length, 1);
  // No author chosen that has markups: a message, no file.
  keuze = { ok: true, auteurs: ['Nobody'] };
  meldingen.length = 0;
  await exportXFDFToFile();
  assert.equal(geschreven.length, 1);
  assert.deepEqual(meldingen, ['noAnnotationsToExport']);
  actief = null;
  keuze = { ok: true, auteurs: null };
});
