// Key sequences ("D L" = D, then L starts the Line tool): the canonical form,
// display, registry, file round trip and the letter-by-letter matcher with
// its timeout. The keyboard handling itself is tested in
// tools/sneltoetsen-aanpasbaar.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBinding, formatBinding, bindingParts, isSequence, sequenceKeys, isSingleKey, splitBinding, eventFieldsFor,
} from './binding.js';
import { isReserved, customShortcutFor } from './dispatch.js';
import { createKeybindingRegistry, assignBinding, sanitizeOverrides } from './registry.js';
import { parseShortcutsFile, serializeShortcutsFile } from './io.js';
import { CORE_COMMANDS } from './default-commands.js';
import { matchesSearch } from './labels.js';
import { createSequenceMatcher, sequenceCommandTable, startsLonger, SEQUENCE_TIMEOUT_MS } from './sequences.js';

function registry() {
  const r = createKeybindingRegistry();
  for (const def of CORE_COMMANDS) r.define(def);
  return r;
}

// Hand-driven timers: tick(ms) runs what is due.
function klok() {
  let nu = 0;
  let volgende = 1;
  const wachtend = new Map();
  return {
    setTimer: (fn, ms) => { const id = volgende++; wachtend.set(id, { fn, op: nu + ms }); return id; },
    clearTimer: (id) => { wachtend.delete(id); },
    tick(ms) {
      nu += ms;
      for (const [id, t] of [...wachtend]) if (t.op <= nu) { wachtend.delete(id); t.fn(); }
    },
    open: () => wachtend.size,
  };
}

test('a key sequence has one canonical form', () => {
  assert.equal(parseBinding('D L'), 'D L');
  assert.equal(parseBinding('d l'), 'D L');
  assert.equal(parseBinding('  d   l '), 'D L');
  assert.equal(parseBinding('t r x'), 'T R X');
  assert.equal(parseBinding('D L X Y'), null, 'at most three letters');
  assert.equal(parseBinding('D 1'), null, 'letters only');
  assert.equal(parseBinding('Ctrl+D L'), null);
  assert.equal(parseBinding('DL'), null, 'without a space it is no key');
  assert.equal(parseBinding('Del'), 'Delete', 'the alias still works');
  assert.equal(parseBinding('D'), 'D', 'a single letter stays a single key');
  assert.ok(isSequence('D L'));
  assert.ok(!isSequence('D'));
  assert.ok(!isSequence('Ctrl+D'));
  assert.deepEqual(sequenceKeys('D L'), ['D', 'L']);
  assert.deepEqual(sequenceKeys('Ctrl+D'), []);
  assert.equal(splitBinding('D L'), null);
  assert.equal(isSingleKey('D L'), false);
  assert.equal(eventFieldsFor('D L'), null, 'no single keydown stands for a sequence');
});

test('a sequence is shown as its letters, with a space', () => {
  assert.equal(formatBinding('D L'), 'D L');
  assert.equal(formatBinding('D L', 'mac'), 'D L');
  assert.deepEqual(bindingParts('D L'), ['D', 'L']);
  assert.equal(formatBinding('Ctrl+Shift+S'), 'Ctrl+Shift+S', 'combinations unchanged');
  assert.ok(matchesSearch({ label: 'Line', bindings: ['3', 'D L'] }, 'd l'));
});

test('Line has D, L by default; it is a normal, changeable shortcut', () => {
  const r = registry();
  assert.deepEqual(r.defaultsOf('tool.line'), ['3', 'D L']);
  assert.equal(r.ownerOf('d l'), 'tool.line');
  assert.equal(r.ownerOf('D'), null, 'D itself is free');
  // Another command cannot take it without reassigning.
  const botsing = assignBinding(r.model, {}, 'view.fitPage', 'D L');
  assert.equal(botsing.conflict, 'tool.line');
  const weg = assignBinding(r.model, {}, 'view.fitPage', 'D L', { reassign: true });
  assert.deepEqual(weg.overrides, { 'tool.line': ['3'], 'view.fitPage': ['Ctrl+2', 'D L'] });
  // A single D and the sequence D L do not conflict (D waits, see below).
  assert.equal(assignBinding(r.model, {}, 'view.fitPage', 'D').conflict, null);
});

test('sequences with G are reserved; others are not', () => {
  assert.equal(isReserved('G O'), true);
  assert.equal(isReserved('D G'), true);
  assert.equal(isReserved('D L'), false);
});

test('a sequence never comes through the single-keydown dispatch', () => {
  const r = registry();
  r.setOverrides({ 'view.fitPage': ['Ctrl+2', 'F P'] });
  assert.equal(customShortcutFor({ key: 'f', code: 'KeyF' }, r), null);
  assert.equal(customShortcutFor({ key: 'p', code: 'KeyP' }, r), null);
});

test('sequences survive the shortcuts file and the preferences clean-up', () => {
  const ov = { 'tool.line': ['3', 'L N'], 'view.fitPage': ['Ctrl+2', 'f p'] };
  assert.deepEqual(sanitizeOverrides(ov), { 'tool.line': ['3', 'L N'], 'view.fitPage': ['Ctrl+2', 'F P'] });
  const r = parseShortcutsFile(serializeShortcutsFile(sanitizeOverrides(ov)));
  assert.equal(r.ok, true);
  assert.deepEqual(r.overrides['view.fitPage'], ['Ctrl+2', 'F P']);
});

test('the table: the sequences, and a single letter that starts one when it has its own key', () => {
  const r = registry();
  assert.deepEqual([...sequenceCommandTable(r)], [['dl', 'tool.line']]);
  r.setOverrides({ 'view.fitPage': ['Ctrl+2', 'D'], 'tool.box': ['4', 'V Q'] });
  const tabel = sequenceCommandTable(r);
  assert.equal(tabel.get('dl'), 'tool.line');
  assert.equal(tabel.get('d'), 'view.fitPage');
  assert.equal(tabel.get('vq'), 'tool.box');
  assert.equal(tabel.get('v'), 'tool.select', 'a default single key that starts a sequence');
  assert.ok(startsLonger(tabel, 'd'));
  assert.ok(!startsLonger(tabel, 'dl'));
  // No default single-letter key starts a default sequence.
  const standaard = sequenceCommandTable(registry());
  for (const c of CORE_COMMANDS) {
    for (const k of c.defaults || []) {
      if (/^[A-Z]$/.test(k)) assert.ok(!startsLonger(standaard, k.toLowerCase()), `${k} (${c.id})`);
    }
  }
});

test('matcher: a full sequence runs at once, the letters are taken', () => {
  const t = klok();
  const m = createSequenceMatcher(t);
  const gelopen = [];
  const tabel = new Map([['dl', () => gelopen.push('line')]]);
  assert.equal(m.key('d', tabel), true);
  assert.equal(m.pending(), 'd');
  assert.equal(m.key('L', tabel), true, 'upper case (Caps Lock) counts too');
  assert.deepEqual(gelopen, ['line']);
  assert.equal(m.pending(), '');
  assert.equal(t.open(), 0, 'no timer left');
});

test('matcher: the wait runs out after the timeout, about a second', () => {
  assert.ok(SEQUENCE_TIMEOUT_MS >= 800 && SEQUENCE_TIMEOUT_MS <= 1500);
  const t = klok();
  const m = createSequenceMatcher(t);
  const gelopen = [];
  const tabel = new Map([['dl', () => gelopen.push('line')], ['d', () => gelopen.push('d')]]);
  m.key('d', tabel);
  t.tick(SEQUENCE_TIMEOUT_MS - 1);
  assert.deepEqual(gelopen, [], 'still waiting');
  t.tick(1);
  assert.deepEqual(gelopen, ['d'], 'the single letter runs');
  assert.equal(m.pending(), '');
  // Then L is a new start, not the end of D L.
  assert.equal(m.key('l', tabel), false);
  assert.deepEqual(gelopen, ['d']);
});

test('matcher: each letter restarts the wait for a three-letter sequence', () => {
  const t = klok();
  const m = createSequenceMatcher({ ...t, timeoutMs: 1000 });
  const gelopen = [];
  const tabel = new Map([['abc', () => gelopen.push('abc')]]);
  m.key('a', tabel);
  t.tick(900);
  m.key('b', tabel);
  t.tick(900);
  m.key('c', tabel);
  assert.deepEqual(gelopen, ['abc']);
});

test('matcher: another letter breaks the sequence; what waited runs first', () => {
  const t = klok();
  const m = createSequenceMatcher(t);
  const gelopen = [];
  const tabel = new Map([['dl', () => gelopen.push('line')], ['d', () => gelopen.push('d')]]);
  m.key('d', tabel);
  assert.equal(m.key('v', tabel), false, 'V is not taken: the normal handling gets it');
  assert.deepEqual(gelopen, ['d']);
  t.tick(5000);
  assert.deepEqual(gelopen, ['d'], 'and nothing later');
  // A breaking letter that starts a sequence itself is taken for that one.
  m.key('d', tabel);
  assert.equal(m.key('d', tabel), true);
  assert.equal(m.pending(), 'd');
});

test('matcher: cancel forgets the letters without running anything', () => {
  const t = klok();
  const m = createSequenceMatcher(t);
  const gelopen = [];
  const tabel = new Map([['dl', () => gelopen.push('line')], ['d', () => gelopen.push('d')]]);
  m.key('d', tabel);
  m.cancel();
  t.tick(5000);
  assert.deepEqual(gelopen, []);
  assert.equal(m.key('l', tabel), false);
});

test('matcher: only letters, and a failing command does not break the keys', () => {
  const t = klok();
  const m = createSequenceMatcher(t);
  const tabel = new Map([['dl', () => { throw new Error('boom'); }]]);
  assert.equal(m.key('1', tabel), false);
  assert.equal(m.key('Enter', tabel), false);
  assert.equal(m.key('d', null), false);
  m.key('d', tabel);
  assert.equal(m.key('l', tabel), true);
  assert.equal(m.pending(), '');
});
