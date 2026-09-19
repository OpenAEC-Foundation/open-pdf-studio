// Reader Mode: a closing tab only stores a reading position the user really
// had - never the page-1 defaults of a tab that was not loaded or not read.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { shouldSaveReaderPosition } from './reader-position-policy.js';

// createDocument() defaults: page 1, zoom 1.5.
const tab = (over = {}) => ({
  filePath: 'C:/boeken/handboek.pdf',
  isUntitled: false,
  pdfDoc: null,
  currentPage: 1,
  scale: 1.5,
  ...over,
});
const loaded = (over = {}) => tab({ pdfDoc: { numPages: 300 }, ...over });

test('a tab closed while its load still waited in the queue stores nothing', () => {
  assert.equal(shouldSaveReaderPosition(tab()), false);
  assert.equal(shouldSaveReaderPosition(tab({ _isLoading: true })), false);
});

test('a tab that loaded behind another one and was never read stores nothing', () => {
  // Session restore behind a document the user just opened: the saved
  // position (say page 212) was never applied, the tab sits on page 1.
  // Closing the window brings each tab to the front just before it closes;
  // the rule does not look at "was shown", so that changes nothing here.
  assert.equal(shouldSaveReaderPosition(loaded()), false);
});

test('a background tab the user did read stores the page they moved to', () => {
  assert.equal(shouldSaveReaderPosition(loaded({ currentPage: 5 })), true);
});

test('a document loaded in front stores its position, page 1 included', () => {
  // The saved position was applied (or there was none): going back to the
  // first page is a reading position like any other.
  assert.equal(shouldSaveReaderPosition(loaded({ _readerPositionApplied: true })), true);
  assert.equal(shouldSaveReaderPosition(loaded({ _readerPositionApplied: true, currentPage: 212 })), true);
});

test('untitled documents and tabs without a path store nothing', () => {
  assert.equal(shouldSaveReaderPosition(loaded({ isUntitled: true, _readerPositionApplied: true })), false);
  assert.equal(shouldSaveReaderPosition(loaded({ filePath: null, _readerPositionApplied: true })), false);
  assert.equal(shouldSaveReaderPosition(null), false);
  assert.equal(shouldSaveReaderPosition(undefined), false);
});

// tabs.js and loader.js need the DOM and the Tauri runtime; their side of the
// rule is pinned on the source. Line endings evened out for a CRLF checkout.
const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').split('\r\n').join('\n');

test('closeTab() asks the policy before it writes the sidecar', () => {
  const tabs = source('../ui/chrome/tabs.js');
  assert.match(tabs, /if \(state\.preferences\.readerMode && shouldSaveReaderPosition\(doc\)\) \{/);
  assert.equal((tabs.match(/saveReaderPosition\(/g) || []).length, 1, 'one write, behind the policy');
  const guard = tabs.indexOf('shouldSaveReaderPosition(doc)');
  const write = tabs.indexOf('saveReaderPosition(doc.filePath');
  assert.ok(guard !== -1 && write > guard);
});

test('loadPDF() marks the position as applied only for a document in front', () => {
  const loader = source('../pdf/loader.js');
  const marks = [...loader.matchAll(/doc\._readerPositionApplied = true;/g)].map((m) => m.index);
  assert.equal(marks.length, 2);

  // Both marks sit in the Reader Mode step, which is part of the
  // "UI operations - only if this is the active document" block.
  const uiBlock = loader.indexOf('// UI operations — only if this is the active document');
  const step = loader.indexOf('// Reader Mode: jump to the saved page/zoom/scroll');
  const next = loader.indexOf('// Check for PDF/A compliance');
  assert.ok(uiBlock !== -1 && step > uiBlock && next > step);
  for (const at of marks) assert.ok(at > step && at < next);

  // With a saved position, only when it could still be applied to this tab.
  assert.match(loader, /if \(!saved \|\| isActive\(\)\) doc\._readerPositionApplied = true;/);
});
