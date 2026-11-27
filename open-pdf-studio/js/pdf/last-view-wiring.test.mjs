// Last view per file (#1245): the places in the app that store and show a
// view, the preference that switches it off, and its text in every locale.
// The rules themselves are tested in core/last-view.test.mjs; the modules
// here need a webview, so their source is read instead.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const source = (rel) => readFileSync(join(hier, rel), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = join(hier, '../i18n/locales');

test('the loader shows the stored view after Reader Mode had its turn, in front or not', () => {
  const loader = source('./loader.js');
  const start = loader.indexOf('export async function loadPDF(');
  const body = loader.slice(start, loader.indexOf('\nexport ', start + 1));
  const resume = body.indexOf('.resumeLastView(doc)');
  assert.notEqual(resume, -1);
  assert.equal(body.indexOf('.resumeLastView(doc)', resume + 1), -1, 'one place, for the active and the background branch');
  // Reader Mode is asked in both branches, before this.
  const reader = [...body.matchAll(/await resumeReaderTracking\(doc\);/g)].map((m) => m.index);
  assert.equal(reader.length, 2);
  assert.ok(reader.every((at) => at < resume));
  // After the first render, before the rest of the load goes on.
  assert.ok(body.indexOf('await setViewMode(doc.viewMode);') < resume);
  assert.ok(resume < body.indexOf('// Load bookmarks from PDF outline'));
});

test('a failure to show the view does not stop the load, and a closed document stops it', () => {
  const loader = source('./loader.js');
  assert.match(loader, /try \{\s*await \(await import\('\.\/last-view-app\.js'\)\)\.resumeLastView\(doc\);\s*if \(isClosed\(\)\) return;\s*\} catch \(e\) \{\s*console\.warn\('\[last-view\] restore failed:', e\);\s*\}/);
});

test('closing a tab stores the view while it is still intact', () => {
  const tabs = source('../ui/chrome/tabs.js');
  const start = tabs.indexOf('export async function closeTab(');
  const body = tabs.slice(start, tabs.indexOf('\nexport ', start + 1));
  const remember = body.indexOf('.rememberLastView(doc)');
  assert.notEqual(remember, -1);
  assert.ok(remember > body.indexOf('persistReaderPosition(doc);'), 'next to the Reader Mode position');
  assert.ok(remember < body.indexOf('cancelAnnotationLoading(doc);'), 'before the document is torn down');
  assert.ok(remember < body.indexOf('state.documents.splice(index, 1)'), 'before the document leaves the list');
  // A chunk that fails to load must not keep the tab from closing.
  assert.match(body, /try \{\s*\(await import\('\.\.\/\.\.\/pdf\/last-view-app\.js'\)\)\.rememberLastView\(doc\);\s*\} catch/);
});

test('a tab that comes to the front shows a view that was still waiting, and counts as on screen from then', () => {
  const tabs = source('../ui/chrome/tabs.js');
  assert.match(tabs, /const lastViewPending = !!newDoc\._lastViewRestore;/);
  assert.match(tabs, /Promise\.resolve\(firstRender\)\s*\.then\(\(\) => import\('\.\.\/\.\.\/pdf\/last-view-app\.js'\)\)\s*\.then\(\(m\) => m\.shownInFront\(newDoc\)\)\s*\.catch/);
  // The scroll of the tab switch must not undo the jump.
  assert.match(tabs, /newDoc\.scrollPosition && !readerRestorePending && !lastViewPending\)/);
});

test('a tab that leaves the front has its view taken while the page area still shows it', () => {
  const tabs = source('../ui/chrome/tabs.js');
  const start = tabs.indexOf('function toonTab(');
  const body = tabs.slice(start, tabs.indexOf('\nexport ', start + 1));
  const leave = body.indexOf('window.__OPDS_LAST_VIEW_LEAVE__?.(currentDoc);');
  assert.notEqual(leave, -1);
  assert.ok(leave < body.indexOf('state.activeDocumentIndex = index;'), 'before another document is in front');
  assert.ok(leave < body.indexOf('window.__pdfViewport.active = false'), 'before the viewport lets go of it');
  const glue = source('./last-view-app.js');
  assert.match(glue, /window\.__OPDS_LAST_VIEW_LEAVE__ = \(doc\) => \{\s*try \{\s*leaveFront\(doc, \(\) => snapshotView\(doc, visibleView\(doc\)\)\);\s*\} catch/);
});

test('the view of a document is measured only when it is the one on screen', () => {
  const glue = source('./last-view-app.js');
  assert.match(glue, /return viewToRemember\(doc, isFrontDocument\(doc\), \(\) => snapshotView\(doc, visibleView\(doc\)\)\);/);
  // On screen = in front and drawn; a waiting view is shown first.
  assert.match(glue, /export async function shownInFront\(doc\) \{\s*if \(!doc\?\.pdfDoc \|\| !isFrontDocument\(doc\)\) return false;\s*await restoreLastView\(doc\);\s*if \(!isFrontDocument\(doc\)\) return false;\s*markShown\(doc\);/);
  // The loader ends its turn the same way, for a document that loads in front.
  assert.match(glue, /queueLastView\(doc, saved, \{ enabled \}\);\s*return shownInFront\(doc\);/);
});

test('File > Exit stores the views of all open files before the window goes', () => {
  const menu = source('../solid/components/app-menu/AppMenu.jsx');
  const start = menu.indexOf('async function handleExit(');
  const body = menu.slice(start, menu.indexOf('\n  }\n', start));
  const remember = body.indexOf('.rememberAllLastViews()');
  assert.notEqual(remember, -1);
  assert.ok(remember < body.indexOf('closeWindow();'));
  assert.match(body, /try \{\s*\(await import\('\.\.\/\.\.\/\.\.\/pdf\/last-view-app\.js'\)\)\.rememberAllLastViews\(\);\s*\} catch/);
});

test('the glue is loaded on first use, not with the start-up bundle', () => {
  for (const file of ['./loader.js', '../ui/chrome/tabs.js', '../solid/components/app-menu/AppMenu.jsx',
    '../solid/components/preferences/PreferencesDialog.jsx', '../mcp-bridge.js', './saver.js']) {
    const text = source(file);
    assert.doesNotMatch(text, /^import [^\n]*(last-view|dialog-folder)/m, `${file} has a static import`);
  }
});

test('an explicit target is marked before the document loads', () => {
  const mcp = source('../mcp-bridge.js');
  const open = mcp.slice(mcp.indexOf('async function handleOpenPdf('), mcp.indexOf('async function handleSetZoom('));
  assert.ok(open.indexOf('.markExplicitTarget(doc)') !== -1);
  assert.ok(open.indexOf('.markExplicitTarget(doc)') < open.indexOf('loaderMod.loadPDF(path, tabIndex)'));

  const search = source('../search/document-search-service.js');
  assert.match(search, /\.markExplicitTarget\(state\.documents\[index\]\);\s*await loadPDFIfNeeded\(match\.path, index\);/);

  const sets = source('../drawing-sets/service.js');
  assert.match(sets, /\.markExplicitTarget\(state\.documents\[tab\.index\]\);\s*await \(await import\('\.\.\/pdf\/loader\.js'\)\)\.loadPDF\(path, tab\.index, bytes\);/);
});

test('the glue keeps to the app storage and stays off on a phone', () => {
  const glue = source('./last-view-app.js');
  assert.doesNotMatch(glue, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(glue, /__TAURI__|invoke\(/, 'no desktop-only call: the web build uses the same code');
  assert.match(glue, /state\.preferences\?\.reopenAtLastView !== false && !isMobile\(\)/);
});

test('with the preference off nothing is read, shown or written', () => {
  const glue = source('./last-view-app.js');
  assert.match(glue, /const saved = enabled && path \? findView\(readStore\(\), path\) : null;\s*queueLastView\(doc, saved, \{ enabled \}\);/);
  assert.match(glue, /export function rememberLastView\(doc\) \{\s*if \(!lastViewEnabled\(\)\) return false;/);
  assert.match(glue, /export function rememberAllLastViews\(\) \{\s*if \(!lastViewEnabled\(\)\) return;/);
});

test('the preference exists, is on by default and is in the Preferences dialog', () => {
  assert.match(source('../core/constants.ts'), /\n  reopenAtLastView: true,\n/);
  assert.match(source('../types/preferences.ts'), /\n  reopenAtLastView: boolean;\n/);
  const tab = source('../solid/components/preferences/GeneralTab.jsx');
  assert.match(tab, /checked=\{p\.reopenAtLastView\[0\]\(\)\} onChange=\{e => p\.reopenAtLastView\[1\]\(e\.target\.checked\)\}/);
  assert.match(tab, /t\('general\.reopenAtLastView'\)/);
  assert.ok(tab.indexOf("t('general.reopenAtLastView')") > tab.indexOf("t('general.restoreLastSession')"), 'next to session restore');
});

test('switching the preference off forgets the stored views', () => {
  const dialog = source('../solid/components/preferences/PreferencesDialog.jsx');
  assert.match(dialog, /if \(!state\.preferences\.reopenAtLastView\) \{\s*import\('\.\.\/\.\.\/\.\.\/pdf\/last-view-app\.js'\)\.then\(m => m\.forgetAllLastViews\(\)\);/);
});

test('all 40 locales have the text of the preference', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  for (const locale of locales) {
    const general = JSON.parse(readFileSync(join(LOCALES, locale, 'preferences.json'), 'utf8')).general || {};
    assert.equal(typeof general.reopenAtLastView, 'string', `${locale} general.reopenAtLastView missing`);
    assert.ok(general.reopenAtLastView.trim().length > 0, `${locale} general.reopenAtLastView empty`);
  }
  const text = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'preferences.json'), 'utf8')).general.reopenAtLastView;
  assert.equal(text('en'), 'Reopen documents at the last view');
  assert.equal(text('nl'), 'Documenten heropenen in de laatste weergave');
});
