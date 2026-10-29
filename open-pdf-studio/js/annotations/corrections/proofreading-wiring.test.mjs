// Proofreading mode (#508, part 2): wiring in the modules that cannot run
// under node (canvas, pdf.js, Solid), the overlay drawing, and the strings in
// all 40 locales. The behaviour itself is tested in text-model.test.mjs,
// proofreading.test.mjs, proofreading-apply.test.mjs and
// pdf/proofreading-roundtrip.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  setProofreadingOverlay, clearProofreadingOverlay, drawProofreadingOverlay,
} from './proofreading-overlay.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../../i18n/locales');
const KEYS = ['group', 'button', 'tooltip', 'hint', 'noText', 'noCorrections', 'insertPlaceholder', 'replacePlaceholder'];

test('both render paths draw the cursor and selection of the mode', () => {
  const r = bron('../rendering.js');
  assert.match(r, /import \{ drawProofreadingOverlay \} from '\.\/corrections\/proofreading-overlay\.js'/);
  assert.match(r, /drawProofreadingOverlay\(annotationCtx, curPage, _renderDoc\?\.id, effectiveScale\)/, 'single page');
  assert.match(r, /drawProofreadingOverlay\(ctx, pageNum, doc\?\.id, effectiveScale\)/, 'continuous');
});

test('the tool is registered, F2 is caught before every other key handler, and the ribbon has the button', () => {
  assert.match(bron('../../tools/tools/index.js'), /registerTool\(PROOFREAD_TOOL, proofreadTool\)/);
  const k = bron('../../tools/keyboard-handlers.js');
  assert.match(k, /import \{[^}]*\binstallProofreadingKeys\b[^}]*\} from '\.\/proofreading-mode\.js'/);
  const init = k.slice(k.indexOf('export function initKeyboardHandlers'));
  assert.ok(init.indexOf('installProofreadingKeys()') >= 0, 'installed');
  assert.ok(init.indexOf('installProofreadingKeys()') < init.indexOf("window.addEventListener('keydown', handleTabSneltoets, true)"), 'before the other handlers');
  const tab = bron('../../solid/components/ribbon/CommentTab.jsx');
  assert.match(tab, /id="tool-proofread"/);
  assert.match(tab, /onClick=\{\(\) => toggleProofreading\(\)\}/);
  assert.match(tab, /active=\{state\.currentTool === PROOFREAD_TOOL\}/);
});

test('the mode uses the tested rules and keeps keys away from the app', () => {
  const m = bron('../../tools/proofreading-mode.js');
  for (const naam of ['keyCommand', 'escapeStep', 'applyInsert', 'applyReplace', 'applyStrike', 'nextCorrection', 'sortCorrections', 'correctionPosition', 'buildTextModel', 'hitTest']) {
    assert.match(m, new RegExp(`\\b${naam}\\(`), naam);
  }
  assert.match(m, /window\.addEventListener\('keydown', opToets, true\)/, 'capture phase on window');
  assert.match(m, /e\.stopImmediatePropagation\(\);\n\s*\/\/ The input types and pastes by itself\./, 'every handled key stops there');
  assert.match(m, /cursor: 'text'/, 'text cursor over the PDF only (tool cursor)');
  assert.match(m, /getViewport\(\{ scale: 1, rotation \}\)/, 'page space with the total rotation');
});

test('the inline input is Windows style: square corners, no shadow', () => {
  const css = bron('../../../styles/text-layer.css');
  const blok = css.slice(css.indexOf('.proofread-input {'));
  assert.match(blok, /border-radius: 0;/);
  assert.match(blok, /box-shadow: none;/);
});

test('all 40 locales have the strings of the mode, translated, with F2 in the tooltip', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const lees = (l) => JSON.parse(readFileSync(join(LOCALES, l, 'ribbon.json'), 'utf8')).proofread || {};
  const en = lees('en');
  for (const l of locales) {
    const p = lees(l);
    for (const k of KEYS) {
      assert.equal(typeof p[k], 'string', `${l} proofread.${k}`);
      assert.ok(p[k].trim().length > 0, `${l} proofread.${k} empty`);
      if (l !== 'en') assert.notEqual(p[k], en[k], `${l} proofread.${k} is the English text`);
    }
    assert.match(p.tooltip, /F2/, `${l}: the shortcut is named`);
    assert.notEqual(p.insertPlaceholder, p.replacePlaceholder, `${l}: two different placeholders`);
    // The tool name in the status bar (StatusBar.jsx reads tools.<tool>).
    const status = JSON.parse(readFileSync(join(LOCALES, l, 'statusbar.json'), 'utf8')).tools || {};
    assert.equal(status.proofread, p.group, `${l} statusbar tools.proofread`);
  }
});

/** Canvas context that records what is drawn. */
function opnemer() {
  const log = [];
  const ctx = {
    save: () => log.push('save'), restore: () => log.push('restore'), setLineDash: () => {},
    fillRect: (...a) => log.push(['fillRect', ...a]), beginPath: () => {}, moveTo: (...a) => log.push(['moveTo', ...a]),
    lineTo: (...a) => log.push(['lineTo', ...a]), stroke: () => log.push('stroke'),
  };
  return { ctx, log };
}

test('the overlay draws the selection and a steady cursor on its own page and document only', () => {
  setProofreadingOverlay({ docId: 'd1', page: 2, caret: { from: { x: 10, y: 20 }, to: { x: 10, y: 10 } }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] });
  const a = opnemer();
  assert.equal(drawProofreadingOverlay(a.ctx, 2, 'd1', 2), true);
  assert.deepEqual(a.log.filter((x) => Array.isArray(x)), [['fillRect', 1, 2, 3, 4], ['moveTo', 10, 20], ['lineTo', 10, 10]]);
  assert.equal(a.ctx.lineWidth, 1, '2 screen pixels at scale 2');
  assert.equal(a.ctx.strokeStyle, '#0066FF');
  const b = opnemer();
  assert.equal(drawProofreadingOverlay(b.ctx, 1, 'd1', 1), false, 'other page');
  assert.equal(drawProofreadingOverlay(b.ctx, 2, 'd2', 1), false, 'other document');
  clearProofreadingOverlay();
  assert.equal(drawProofreadingOverlay(b.ctx, 2, 'd1', 1), false, 'cleared');
  assert.deepEqual(b.log, []);
});
