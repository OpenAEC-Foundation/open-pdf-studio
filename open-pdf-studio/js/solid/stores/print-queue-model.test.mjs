// Pure logic of the "Open PDF Printer" window (PrintQueueWindow.jsx): the
// name shown for a job, the paper size of page 1, the file size, and the
// order/selection rules of the job list.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRINTER_NAME,
  embeddedFileName,
  cleanPrintTitle,
  stripFileExtension,
  jobDisplayName,
  saveFileName,
  paperInfo,
  paperText,
  formatFileSize,
  syncOrder,
  moveSelected,
  moveBefore,
  emptySelection,
  clickSelection,
  keySelection,
  selectAll,
  syncSelection,
  selectionAfterRemoval,
  selectedInOrder,
  selectionSummary,
  clampPage,
} from './print-queue-model.js';

const A4 = [595.28, 841.89];
const A3 = [841.89, 1190.55];

// ── names ────────────────────────────────────────────────────────────────

test('the printer keeps its fixed name', () => {
  assert.equal(PRINTER_NAME, 'Open PDF Printer');
});

test('embeddedFileName: added files carry their real name after a double underscore', () => {
  assert.equal(embeddedFileName('job_1729000000000__Rapport fase 2.pdf'), 'Rapport fase 2.pdf');
  assert.equal(embeddedFileName('job_1729000000000.pdf'), null);
  assert.equal(embeddedFileName('job_1__.pdf'), null);
  assert.equal(embeddedFileName(''), null);
  assert.equal(embeddedFileName(undefined), null);
});

test('cleanPrintTitle: trims, collapses white space and drops control characters', () => {
  assert.equal(cleanPrintTitle('  Budget\t 2026\u0000 '), 'Budget 2026');
});

test('cleanPrintTitle: empty or generic titles count as no title', () => {
  for (const t of ['', '   ', null, undefined, 42, 'Untitled', 'untitled document', 'Document', 'Print Document', '-']) {
    assert.equal(cleanPrintTitle(t), null, String(t));
  }
});

test('cleanPrintTitle: a program prefix before a file name is dropped', () => {
  assert.equal(cleanPrintTitle('Slides Editor - Aanbouw_ontwerp.pptx'), 'Aanbouw_ontwerp.pptx');
  assert.equal(cleanPrintTitle('Writer – Rapport.docx'), 'Rapport.docx');
  // a program suffix after the file name too
  assert.equal(cleanPrintTitle('notes.txt - Editor'), 'notes.txt');
});

test('cleanPrintTitle: a dash inside a real title stays', () => {
  // no file name after the dash → the whole title
  assert.equal(cleanPrintTitle('24221 - Warmteverlies woning'), '24221 - Warmteverlies woning');
  // a prefix with digits is part of the title, not a program name
  assert.equal(cleanPrintTitle('Project 12 - Fase 2.docx'), 'Project 12 - Fase 2.docx');
});

test('cleanPrintTitle: a path or file URL becomes its file name', () => {
  assert.equal(cleanPrintTitle('C:\\Users\\a\\Documents\\Offerte.xlsx'), 'Offerte.xlsx');
  assert.equal(cleanPrintTitle('\\\\server\\share\\Plan.dwg'), 'Plan.dwg');
  assert.equal(cleanPrintTitle('/home/a/Plan%20B.odt'), 'Plan%20B.odt');
  assert.equal(cleanPrintTitle('file:///C:/tmp/Plan%20B.odt'), 'Plan B.odt');
});

test('cleanPrintTitle: very long titles are cut', () => {
  assert.equal(cleanPrintTitle('x'.repeat(500)).length, 200);
});

test('stripFileExtension: only known document extensions go', () => {
  assert.equal(stripFileExtension('Rapport.docx'), 'Rapport');
  assert.equal(stripFileExtension('Scan.PDF'), 'Scan');
  assert.equal(stripFileExtension('Report v1.2'), 'Report v1.2');
  assert.equal(stripFileExtension('Notes Q3.final'), 'Notes Q3.final');
  assert.equal(stripFileExtension('.pdf'), '.pdf');
});

test('jobDisplayName: the real file name of an added PDF comes first', () => {
  const job = { file: 'job_5__Tekening A1.pdf', title: 'Something else' };
  assert.deepEqual(jobDisplayName(job, null, 'Print 14:03'), { source: 'file', name: 'Tekening A1', full: 'Tekening A1.pdf' });
});

test('jobDisplayName: a printed job uses the document title from the PDF', () => {
  const job = { file: 'job_5.pdf', title: 'Sheet Tool - ADMIN 25-9-25.xlsx' };
  assert.deepEqual(jobDisplayName(job, null, 'Print 14:03'), { source: 'title', name: 'ADMIN 25-9-25', full: 'Sheet Tool - ADMIN 25-9-25.xlsx' });
});

test('jobDisplayName: the title read in the window is used when the job list has none', () => {
  const job = { file: 'job_5.pdf' };
  assert.deepEqual(jobDisplayName(job, '24221-20250618 Warmteverlies', 'x'), {
    source: 'title', name: '24221-20250618 Warmteverlies', full: '24221-20250618 Warmteverlies',
  });
});

test('jobDisplayName: without any name the translated time label is used', () => {
  assert.deepEqual(jobDisplayName({ file: 'job_5.pdf', title: 'Untitled' }, '', 'Print 14:03'), {
    source: 'time', name: 'Print 14:03', full: 'Print 14:03',
  });
});

test('saveFileName: a safe file name with .pdf', () => {
  assert.equal(saveFileName('Rapport: fase 1/2', 'Print'), 'Rapport_ fase 1_2.pdf');
  assert.equal(saveFileName('  ...  ', 'Print'), 'Print.pdf');
  assert.equal(saveFileName('Print 16-10-2026 14:03', 'x'), 'Print 16-10-2026 14_03.pdf');
  assert.equal(saveFileName('Al.pdf', 'x'), 'Al.pdf');
});

// ── paper size ───────────────────────────────────────────────────────────

test('paperInfo: standard sizes with their orientation', () => {
  assert.deepEqual(paperInfo(...A4), { label: 'A4', orientation: 'portrait', wMm: 210, hMm: 297 });
  assert.deepEqual(paperInfo(A3[1], A3[0]), { label: 'A3', orientation: 'landscape', wMm: 420, hMm: 297 });
  assert.equal(paperInfo(612, 792).label, 'Letter');
});

test('paperInfo: a non-standard size has no label, only mm', () => {
  assert.deepEqual(paperInfo(1000, 500), { label: null, orientation: 'landscape', wMm: 353, hMm: 176 });
});

test('paperInfo: unusable sizes give null', () => {
  assert.equal(paperInfo(0, 100), null);
  assert.equal(paperInfo(NaN, 100), null);
  assert.equal(paperInfo(undefined, undefined), null);
});

test('paperText: translated orientation or millimetres', () => {
  const t = (k, o) => ({
    'printQueue.paperPortrait': `${o?.paper} portrait`,
    'printQueue.paperLandscape': `${o?.paper} landscape`,
    'printQueue.paperMm': `${o?.w} × ${o?.h} mm`,
  }[k]);
  assert.equal(paperText(paperInfo(A3[1], A3[0]), t), 'A3 landscape');
  assert.equal(paperText(paperInfo(...A4), t), 'A4 portrait');
  assert.equal(paperText(paperInfo(1000, 500), t), '353 × 176 mm');
  assert.equal(paperText(null, t), '');
});

test('formatFileSize: kB below a megabyte, MB with one decimal above', () => {
  assert.equal(formatFileSize(10, 'en'), '1 kB');
  assert.equal(formatFileSize(45 * 1024, 'en'), '45 kB');
  assert.equal(formatFileSize(1.25 * 1024 * 1024, 'en'), '1.3 MB');
  assert.equal(formatFileSize(1.25 * 1024 * 1024, 'nl'), '1,3 MB');
  assert.equal(formatFileSize(undefined, 'en'), '');
});

// ── order ────────────────────────────────────────────────────────────────

test('syncOrder: keeps the user order, drops gone jobs, appends new ones in list order', () => {
  assert.deepEqual(syncOrder(['b', 'a', 'x'], ['a', 'b', 'c', 'd']), ['b', 'a', 'c', 'd']);
  assert.deepEqual(syncOrder([], ['a', 'b']), ['a', 'b']);
});

test('moveSelected: moves the selected block one step and stops at the edge', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveSelected(order, new Set(['c']), -1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveSelected(order, new Set(['b', 'c']), 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveSelected(order, new Set(['a', 'c']), -1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveSelected(order, new Set(['d']), 1), order);
  assert.deepEqual(moveSelected(order, new Set(), 1), order);
});

test('moveBefore: drops dragged jobs before or after a target, keeping their order', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveBefore(order, ['d'], 'a', 'before'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveBefore(order, ['a', 'c'], 'd', 'after'), ['b', 'd', 'a', 'c']);
  assert.deepEqual(moveBefore(order, ['b'], 'b', 'before'), order);
  assert.deepEqual(moveBefore(order, ['x'], 'a', 'before'), order);
});

// ── selection ────────────────────────────────────────────────────────────

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const sel = (s) => [...s.selected].sort();

test('clickSelection: a plain click selects one job', () => {
  const s = clickSelection(ORDER, { selected: new Set(['a', 'b']), anchor: 'a', focus: 'b' }, 'c', {});
  assert.deepEqual(sel(s), ['c']);
  assert.equal(s.anchor, 'c');
  assert.equal(s.focus, 'c');
});

test('clickSelection: Ctrl toggles, Shift selects a range from the anchor', () => {
  let s = clickSelection(ORDER, emptySelection(), 'b', {});
  s = clickSelection(ORDER, s, 'd', { ctrl: true });
  assert.deepEqual(sel(s), ['b', 'd']);
  s = clickSelection(ORDER, s, 'b', { ctrl: true });
  assert.deepEqual(sel(s), ['d']);
  // Ctrl+click sets the anchor, also when it deselects (as in Explorer)
  assert.equal(s.anchor, 'b');
  s = clickSelection(ORDER, s, 'd', {});
  s = clickSelection(ORDER, s, 'a', { shift: true });
  assert.deepEqual(sel(s), ['a', 'b', 'c', 'd']);
  assert.equal(s.anchor, 'd');
  assert.equal(s.focus, 'a');
  // Ctrl+Shift adds the range to the selection
  s = clickSelection(ORDER, { selected: new Set(['e']), anchor: 'a', focus: 'a' }, 'b', { ctrl: true, shift: true });
  assert.deepEqual(sel(s), ['a', 'b', 'e']);
});

test('keySelection: arrows move, Shift extends, Home/End jump', () => {
  let s = clickSelection(ORDER, emptySelection(), 'b', {});
  s = keySelection(ORDER, s, 'ArrowDown', {});
  assert.deepEqual(sel(s), ['c']);
  s = keySelection(ORDER, s, 'ArrowDown', { shift: true });
  assert.deepEqual(sel(s), ['c', 'd']);
  s = keySelection(ORDER, s, 'End', { shift: true });
  assert.deepEqual(sel(s), ['c', 'd', 'e']);
  s = keySelection(ORDER, s, 'Home', {});
  assert.deepEqual(sel(s), ['a']);
  s = keySelection(ORDER, s, 'ArrowUp', {});
  assert.deepEqual(sel(s), ['a']);
  // nothing focused yet: the first arrow lands on the first job
  assert.deepEqual(sel(keySelection(ORDER, emptySelection(), 'ArrowDown', {})), ['a']);
  // another key: unchanged
  const same = keySelection(ORDER, s, 'x', {});
  assert.equal(same, s);
});

test('selectAll selects every job and keeps the focus', () => {
  const s = selectAll(ORDER, { selected: new Set(['c']), anchor: 'c', focus: 'c' });
  assert.deepEqual(sel(s), ORDER);
  assert.equal(s.focus, 'c');
  assert.equal(selectAll([], emptySelection()).focus, null);
});

test('syncSelection: gone jobs leave, new arrivals are selected and focused', () => {
  const s0 = { selected: new Set(['a', 'x']), anchor: 'x', focus: 'x' };
  const s = syncSelection(['a', 'b', 'c'], s0, ['c']);
  assert.deepEqual(sel(s), ['a', 'c']);
  assert.equal(s.focus, 'c');
  assert.equal(s.anchor, 'c');
  // nothing new and the focus still exists: focus stays
  const s2 = syncSelection(['a', 'b'], { selected: new Set(['b']), anchor: 'b', focus: 'b' }, []);
  assert.equal(s2.focus, 'b');
  // focus gone, nothing new: first job
  assert.equal(syncSelection(['a', 'b'], { selected: new Set(), anchor: null, focus: 'q' }, []).focus, 'a');
  assert.equal(syncSelection([], s0, []).focus, null);
});

test('selectionAfterRemoval: the neighbour of the removed block gets the focus', () => {
  assert.equal(selectionAfterRemoval(ORDER, ['b', 'c']).focus, 'd');
  assert.deepEqual(sel(selectionAfterRemoval(ORDER, ['b', 'c'])), ['d']);
  assert.equal(selectionAfterRemoval(ORDER, ['e']).focus, 'd');
  assert.equal(selectionAfterRemoval(['a'], ['a']).focus, null);
});

test('selectedInOrder follows the list order, not the click order', () => {
  assert.deepEqual(selectedInOrder(ORDER, new Set(['d', 'a'])), ['a', 'd']);
});

test('selectionSummary: count and total pages, unknown pages make the total unknown', () => {
  assert.deepEqual(selectionSummary([{ pages: 2 }, { pages: 3 }]), { count: 2, pages: 5 });
  assert.deepEqual(selectionSummary([{ pages: 2 }, { pages: 0 }]), { count: 2, pages: null });
  assert.deepEqual(selectionSummary([]), { count: 0, pages: 0 });
});

test('clampPage keeps the preview page within the document', () => {
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(9, 5), 5);
  assert.equal(clampPage(3, 5), 3);
  assert.equal(clampPage(2, 0), 1);
  assert.equal(clampPage(NaN, 4), 1);
});
