// Shared review (#237): texts in all 40 languages, the code uses them, and
// the app is wired up (menu, lazy dialog, status bar, saver, Rust commands).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotationsForSave, afterPdfSaved, registerSharedReviewHooks } from './shared-review-hooks.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const APP = join(HIER, '../..');
const LOCALES = join(HIER, '../i18n/locales');
const TALEN = readdirSync(LOCALES);
const lees = (taal, ns) => JSON.parse(readFileSync(join(LOCALES, taal, `${ns}.json`), 'utf8'));
// CRLF from a Windows checkout must not change what the tests see.
const bron = (pad) => readFileSync(join(APP, pad), 'utf8').replace(/\r\n/g, '\n');

const DIALOOG = {
  title: [], help: [], pdfUntouched: [], enable: [], desktopOnly: [], folder: [], folderDefault: [], folderCustom: [],
  browse: [], user: [], userHint: ['{{file}}'], autoPublish: [], interval: [], publish: [], published: ['{{n}}'],
  refresh: [], importIntoPdf: [], importDone: [], lastUpdate: ['{{time}}'], lastPublished: ['{{time}}'], never: [],
  pending: ['{{n}}'], participants: [], participant: [], changes: [], lastChange: [], time: [], conflictedCopies: ['{{n}}'],
  you: [], history: [], conflictRule: [], annotation: [], noHistory: [], action: [], opCreate: [], opEdit: [], opDelete: [],
  concurrent: [], deleted: [], errorRead: [], errorWrite: [], errorSaveFirst: [], errorGeneric: [], close: [],
};
const STATUS = { sharedReviewActive: [], sharedReviewUpdates: ['{{n}}'], sharedReviewTitle: ['{{folder}}'], sharedReviewError: [] };
// Sentences must really be translated; short words may match English.
const ZINNEN = ['help', 'pdfUntouched', 'conflictRule', 'userHint', 'importDone', 'errorRead', 'errorWrite', 'errorSaveFirst', 'errorGeneric'];

test('all 40 languages have the texts with their placeholders', () => {
  assert.equal(TALEN.length, 40);
  const en = lees('en', 'dialogs').sharedReview;
  for (const taal of TALEN) {
    const d = lees(taal, 'dialogs').sharedReview;
    assert.ok(d, `${taal}: dialogs.sharedReview`);
    assert.deepEqual(Object.keys(d).sort(), Object.keys(DIALOOG).sort(), `${taal}: same keys`);
    for (const [k, plekken] of Object.entries(DIALOOG)) {
      assert.ok(typeof d[k] === 'string' && d[k].trim(), `${taal}: sharedReview.${k}`);
      for (const p of plekken) assert.ok(d[k].includes(p), `${taal}: sharedReview.${k} without ${p}`);
      if (taal !== 'en' && ZINNEN.includes(k)) assert.notEqual(d[k], en[k], `${taal}: sharedReview.${k} not translated`);
    }
    const s = lees(taal, 'statusbar');
    for (const [k, plekken] of Object.entries(STATUS)) {
      assert.ok(typeof s[k] === 'string' && s[k].trim(), `${taal}: ${k}`);
      for (const p of plekken) assert.ok(s[k].includes(p), `${taal}: ${k} without ${p}`);
    }
    if (taal !== 'en') assert.notEqual(s.sharedReviewTitle, lees('en', 'statusbar').sharedReviewTitle, `${taal}: sharedReviewTitle`);
    assert.ok(lees(taal, 'appMenu').sharedReview?.trim(), `${taal}: appMenu.sharedReview`);
  }
});

test('the dialog and status bar use exactly these keys', () => {
  const dialoog = bron('js/solid/components/dialogs/SharedReviewDialog.jsx');
  for (const k of Object.keys(DIALOOG)) assert.ok(dialoog.includes(`'sharedReview.${k}'`), `dialog uses sharedReview.${k}`);
  for (const m of dialoog.matchAll(/'sharedReview\.(\w+)'/g)) assert.ok(m[1] in DIALOOG, `unknown key sharedReview.${m[1]}`);
  const balk = bron('js/solid/components/StatusBar.jsx');
  for (const k of Object.keys(STATUS)) assert.ok(balk.includes(`'${k}'`), `status bar uses ${k}`);
});

test('menu item, lazy dialog, compact Windows-style CSS', () => {
  const host = bron('js/solid/components/DialogHost.jsx');
  assert.match(host, /const SharedReviewDialog = lazy\(\(\) => import\('\.\/dialogs\/SharedReviewDialog\.jsx'\)\)/);
  assert.match(host, /'shared-review': SharedReviewDialog/);
  assert.match(bron('js/solid/components/app-menu/AppMenu.jsx'), /label=\{t\('sharedReview'\)\} onClick=\{\(\) => actionAndClose\(\(\) => openDialog\('shared-review'\)\)\}/);
  const css = bron('styles/dialogs.css');
  const eigen = css.slice(css.indexOf('/* Gedeelde beoordeling via een map (#237). */'));
  assert.ok(eigen.includes('.shared-review-dialog'));
  assert.doesNotMatch(eigen, /border-radius:\s*[1-9]/, 'no rounded corners');
  assert.doesNotMatch(eigen, /cursor:/, 'default cursor');
  assert.doesNotMatch(eigen, /transition|animation/, 'no animations');
  // The dialog uses the shared movable Dialog, which never closes on an outside click.
  assert.match(bron('js/solid/components/dialogs/SharedReviewDialog.jsx'), /import Dialog from '\.\.\/Dialog\.jsx'/);
});

test('the saver writes only the PDF’s own annotations while a review runs, and publishes after saving', () => {
  const saver = bron('js/pdf/saver.js');
  assert.match(saver, /const docAnnotations = annotationsForSharedReviewSave\(doc\);/);
  assert.match(saver, /if \(gelukt && activeDoc\) afterPdfSaved\(activeDoc\);/);
  assert.match(bron('js/main.js'), /import\('\.\/review\/shared-review-service\.js'\)\s*\.then\(\(m\) => m\.installSharedReview\(\)\)/);
});

test('hooks: without a review the saver gets the document as is; a broken hook falls back', () => {
  const doc = { annotations: [{ id: 'a' }] };
  registerSharedReviewHooks(null);
  assert.equal(annotationsForSave(doc), doc.annotations);
  assert.deepEqual(annotationsForSave(null), []);
  afterPdfSaved(doc); // no error
  const warn = console.warn;
  console.warn = () => {};
  try {
    registerSharedReviewHooks({ annotationsForSave: () => { throw new Error('x'); }, afterPdfSaved: () => { throw new Error('y'); } });
    assert.equal(annotationsForSave(doc), doc.annotations);
    afterPdfSaved(doc);
    registerSharedReviewHooks({ annotationsForSave: () => [] });
    assert.deepEqual(annotationsForSave(doc), []);
    registerSharedReviewHooks({ annotationsForSave: () => null });
    assert.equal(annotationsForSave(doc), doc.annotations, 'null: no review for this document');
  } finally {
    console.warn = warn;
    registerSharedReviewHooks(null);
  }
});

test('the Rust commands are registered and the service only writes its own files', () => {
  const lib = bron('src-tauri/src/lib.rs');
  for (const c of ['shared_review_list', 'shared_review_read', 'shared_review_write']) {
    assert.ok(lib.includes(`shared_review::${c},`), c);
  }
  assert.match(lib, /^pub mod shared_review;$/m);
  const service = bron('js/review/shared-review-service.js');
  // Every write names one of my two files.
  const writes = [...service.matchAll(/io\.write\(s\.folder, (\w+),/g)].map((m) => m[1]);
  assert.deepEqual(writes.sort(), ['logName', 'name']);
  assert.match(service, /const logName = logFileName\(s\.base, s\.user\);/);
  assert.match(service, /const name = xfdfFileName\(s\.base, s\.user\);/);
});
