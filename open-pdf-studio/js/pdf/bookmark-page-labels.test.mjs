import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bookmarksByPage, previewBookmarkNames, bookmarksFromNames, labelsFromNames, nameSourceSnapshot } from './bookmark-page-labels.js';
const bookmarks = [
  {id:'group',page:1,title:'Civil',sortOrder:0,expanded:false,color:'#0000ff'},
  {id:'tie-later',page:1,title:'Later',parentId:'group',sortOrder:1},
  {id:'sheet',page:1,title:'C-101',parentId:'group',sortOrder:0,bold:true,italic:true,color:'#ff0000',left:12,top:42,zoom:2},
  {id:'other',page:3,title:'C-103',sortOrder:1},
];
test('deepest bookmark wins; ties follow tree order even in collapsed branches', () => {
  assert.equal(bookmarksByPage(bookmarks,3).get(1).id,'sheet');
  assert.equal(bookmarksByPage(bookmarks,3).get(3).id,'other');
  assert.equal(bookmarksByPage(bookmarks,3).has(2),false);
});
test('labels from bookmarks keep unrelated labels, accept edited preview names, and are idempotent', () => {
  const rows=previewBookmarkNames(bookmarks,['Old','Keep','3'],3,'labels');
  assert.deepEqual(rows.map(r=>r.page),[1,3]);rows[0].title='Edited';
  const result=labelsFromNames(['Old','Keep','3'],rows,3);
  assert.deepEqual(result,['Edited','Keep','C-103']);
  assert.deepEqual(labelsFromNames(result,rows,3),result);
});
test('thirty labelled pages become thirty ordered root bookmarks, normal numbers are skipped', () => {
  const labels=Array.from({length:30},(_,i)=>`C-${101+i}`);
  const rows=previewBookmarkNames([],labels,30,'bookmarks');
  const result=bookmarksFromNames([],rows);
  assert.equal(result.length,30);assert.equal(new Set(result.map(b=>b.id)).size,30);
  result.forEach((b,i)=>{assert.equal(b.page,i+1);assert.equal(b.sortOrder,i);assert.equal(b.parentId,null);});
  assert.deepEqual(bookmarksFromNames(result,previewBookmarkNames(result,labels,30,'bookmarks')),result);
  assert.deepEqual(previewBookmarkNames([],['1','A-2','3'],3,'bookmarks').map(r=>r.page),[2]);
});
test('renaming a destination preserves hierarchy, style, coordinates and other bookmarks', () => {
  const original=structuredClone(bookmarks);
  const result=bookmarksFromNames(bookmarks,previewBookmarkNames(bookmarks,['New','A-2','3'],3,'bookmarks'));
  assert.deepEqual(result.find(b=>b.id==='sheet'),{...bookmarks[2],title:'New'});
  assert.deepEqual(result.find(b=>b.id==='group'),bookmarks[0]);
  assert.deepEqual(result.find(b=>b.id==='tie-later'),bookmarks[1]);
  assert.equal(result.at(-1).page,2);assert.equal(result.at(-1).parentId,null);
  assert.deepEqual(bookmarks,original);
});
test('replace builds a flat preview-only list without touching the source or reusing IDs', () => {
  const rows=previewBookmarkNames(bookmarks,['One','Two','Three'],3,'bookmarks');
  const result=bookmarksFromNames(bookmarks,rows,{replace:true});
  assert.equal(result.length,3);assert.ok(result.every(b=>b.parentId===null));
  assert.ok(result.every(b=>!bookmarks.some(old=>old.id===b.id)));
  assert.equal(bookmarks[0].title,'Civil');
});
test('invalid destinations and cyclic branches do not hang or overwrite other pages', () => {
  const bad=[{id:'a',parentId:'b',page:1},{id:'b',parentId:'a',page:1},{id:'x',page:0},{id:'y',page:99},{id:'z',page:1.5}];
  assert.equal(bookmarksByPage(bad,3).size,0);
  assert.deepEqual(labelsFromNames(['A','B'],[{page:0,title:'bad'},{page:99,title:'bad'}],2),['A','B']);
});
test('snapshot detects bookmark, label and page-count edits before Apply', () => {
  const doc={pdfDoc:{numPages:3},bookmarks:structuredClone(bookmarks),pageLabels:['A','B','C']};const before=nameSourceSnapshot(doc);
  doc.bookmarks[0].title='changed';assert.notEqual(nameSourceSnapshot(doc),before);
  doc.bookmarks=structuredClone(bookmarks);doc.pageLabels[0]='changed';assert.notEqual(nameSourceSnapshot(doc),before);
  doc.pageLabels=['A','B','C'];doc.pdfDoc.numPages=4;assert.notEqual(nameSourceSnapshot(doc),before);
});
test('replacement checkbox is translated in every app language', () => {
  const root=new URL('../i18n/locales/',import.meta.url);
  for(const lang of readdirSync(root)) {
    const file=new URL(`${lang}/dialogs.json`,root);
    assert.ok(JSON.parse(readFileSync(file,'utf8')).bookmark.replaceAll.trim(),lang);
  }
});
test('new bookmarks get the same fields as one added in the panel', () => {
  const [b] = bookmarksFromNames([], [{ page: 2, title: '  A-2   Plan ', bookmarkId: null }]);
  assert.deepEqual(b, {
    id: 'bm_labels_1', title: 'A-2 Plan', page: 2, top: null, left: null, zoom: null, parentId: null, expanded: true,
    bold: false, italic: false, color: null, sortOrder: 0, fromPdf: false,
  });
});
