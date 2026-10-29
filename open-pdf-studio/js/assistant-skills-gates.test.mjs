// The gates and the message of the assistant skills (#452): a skill that needs
// a selection, a measuring scale or a second page says so instead of sending;
// a skill that needs input checks it; the model gets the fixed instruction
// plus the app state at the moment of sending.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  ASSISTANT_SKILLS, SKILL_NEED_KEYS, skillBlocker, skillInputProblem, skillInputRest, skillMessage, skillContextNote,
  skillsInGroup,
} from './assistant-skills.js';
import { skillContextFromDocument, annotationBox, scaleAtPoint, localDate } from './assistant-skill-context.js';

const skill = (id) => ASSISTANT_SKILLS.find((s) => s.id === id);
const CTX = {
  hasDocument: true, page: 2, pageCount: 5, selection: [], selectedText: '', scale: null, hasScale: false, today: '2026-10-27',
};
const ctx = (extra) => ({ ...CTX, ...extra });
const SEL = [{ id: 'a1', type: 'cloud', page: 2, x: 10, y: 20, width: 30, height: 40 }];
const SCALE = { pixelsPerUnit: 0.0283465, unit: 'mm', method: 'document' };

test('without a document a skill that requires one does not go', () => {
  for (const s of ASSISTANT_SKILLS.filter((x) => (x.requires || []).includes('document'))) {
    assert.deepEqual(skillBlocker(s, { hasDocument: false }), { key: 'assistant.need.document' }, s.id);
  }
  // The skills that existed before keep working as they did.
  for (const id of ['translate', 'summarize', 'draw', 'detect-doors', 'floorplan']) assert.equal(skillBlocker(skill(id), {}), null, id);
  // Bringing in a drawing can make a new document.
  assert.equal(skillBlocker(skill('import-cad'), { hasDocument: false }), null);
});

test('explain the selection needs a selection: an annotation or text', () => {
  const s = skill('explain-selection');
  assert.deepEqual(skillBlocker(s, ctx()), { key: 'assistant.need.selection' });
  assert.equal(skillBlocker(s, ctx({ selection: SEL })), null);
  assert.equal(skillBlocker(s, ctx({ selectedText: 'Bedroom 2' })), null);
  assert.deepEqual(skillBlocker(s, ctx({ selectedText: '   ' })), { key: 'assistant.need.selection' });
});

test('measure needs a measuring scale', () => {
  const s = skill('measure');
  assert.deepEqual(skillBlocker(s, ctx({ selection: SEL })), { key: 'assistant.need.scale' });
  assert.equal(skillBlocker(s, ctx({ selection: SEL, hasScale: true, scale: SCALE })), null);
});

test('measure: a selection or a description', () => {
  const s = skill('measure');
  const withScale = ctx({ hasScale: true, scale: SCALE });
  assert.deepEqual(skillInputProblem(s, '', withScale), { key: 'assistant.need.selectionOrInput' });
  assert.equal(skillInputProblem(s, '', { ...withScale, selection: SEL }), null);
  assert.equal(skillInputProblem(s, 'the living room', withScale), null);
});

test('compare sheets needs two pages and the number of another page', () => {
  const s = skill('compare-sheets');
  assert.deepEqual(skillBlocker(s, ctx({ pageCount: 1 })), { key: 'assistant.need.twoPages' });
  assert.equal(skillBlocker(s, ctx()), null);
  const page = { key: 'assistant.need.page', params: { max: 5 } };
  assert.deepEqual(skillInputProblem(s, '', ctx()), page);
  assert.deepEqual(skillInputProblem(s, 'two', ctx()), page);
  assert.deepEqual(skillInputProblem(s, '2', ctx()), page, 'not the current page');
  assert.deepEqual(skillInputProblem(s, '9', ctx()), page, 'beyond the last page');
  assert.equal(skillInputProblem(s, '4', ctx()), null);
  assert.equal(skillInputProblem(s, 'Seite 4', ctx()), null, 'a word around the number is fine');
});

test('a skill that needs input does not go with only its prefix', () => {
  for (const s of ASSISTANT_SKILLS.filter((x) => x.needsInput && !x.inputKind && !x.inputOptional)) {
    assert.deepEqual(skillInputProblem(s, '', ctx()), { key: 'assistant.need.input' }, s.id);
    assert.equal(skillInputProblem(s, 'something', ctx()), null, s.id);
  }
  // The user's own text (prefix removed) is not checked.
  assert.equal(skillInputProblem(skill('take-off'), null, ctx()), null);
  assert.equal(skillInputRest(skill('take-off'), 'Hoeveelheden: ', 'Hoeveelheden:'), '');
  assert.equal(skillInputRest(skill('take-off'), 'Hoeveelheden: ', 'Hoeveelheden: deuren'), 'deuren');
  assert.equal(skillInputRest(skill('take-off'), 'Hoeveelheden: ', 'Tel de ramen'), null);
});

test('every message key of the gates is in the list the locales must have', () => {
  const keys = new Set();
  const states = [{}, { hasDocument: false }, ctx(), ctx({ pageCount: 1 }), ctx({ selection: SEL }), ctx({ hasScale: true })];
  for (const s of ASSISTANT_SKILLS) {
    for (const c of states) {
      const b = skillBlocker(s, c);
      if (b) keys.add(b.key);
      for (const rest of ['', '1', 'x']) {
        const p = skillInputProblem(s, rest, c);
        if (p) keys.add(p.key);
      }
    }
  }
  assert.deepEqual([...keys].sort(), [...SKILL_NEED_KEYS].sort());
});

test('the model gets the instruction, the input and the app state', () => {
  const s = skill('find-on-sheet');
  const c = ctx({ selection: SEL, hasScale: true, scale: SCALE });
  const msg = skillMessage(s, 'Zoek op dit blad: ', 'Zoek op dit blad: Slaapkamer 2', c);
  assert.equal(msg.shown, 'Zoek op dit blad: Slaapkamer 2');
  assert.ok(msg.model.startsWith(`${s.invoke}Slaapkamer 2\n\n[App context at the moment of sending]\n`));
  assert.ok(msg.model.includes('- current page: 2 of 5'));
  assert.ok(msg.model.includes('- selected annotations: a1 (cloud, page 2, box x 10 y 20 w 30 h 40)'));
  assert.ok(msg.model.includes('- measuring scale: 0.0283 page points per mm (from document)'));
  assert.ok(msg.model.includes('- today: 2026-10-27'));

  // Without input but with a selection, measure has its own instruction.
  const m = skillMessage(skill('measure'), 'Meet: ', 'Meet:', c);
  assert.ok(m.model.startsWith(skill('measure').invokeWithoutInput));
  // A skill without input: shown is the localized text.
  const e = skillMessage(skill('explain-selection'), 'Leg de selectie uit.', undefined, c);
  assert.equal(e.shown, 'Leg de selectie uit.');
  assert.ok(e.model.startsWith(skill('explain-selection').invoke) && e.model.includes('a1 (cloud'));
  // Old skills and calls without context stay as they were.
  assert.equal(skillMessage(skill('translate'), 'x', undefined, c).model, skill('translate').invoke);
  assert.equal(skillMessage(s, 'Zoek: ', 'Zoek: kast').model, `${s.invoke}kast`);
});

test('the context note says what is missing', () => {
  const none = skillContextNote(ctx());
  assert.ok(none.includes('- selected annotations: none'));
  assert.ok(none.includes('- measuring scale: not set'));
  assert.ok(skillContextNote(ctx({ hasScale: true })).includes('set on part of the document'));
  assert.ok(skillContextNote({ hasDocument: false, today: '2026-01-02' }).includes('- no document is open'));
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, type: 'box', page: 1 }));
  assert.ok(skillContextNote(ctx({ selection: many })).includes('and 5 more'));
  assert.ok(skillContextNote(ctx({ selectedText: 'x'.repeat(600) })).includes('…"'));
});

test('the context is read from the document', () => {
  const doc = {
    currentPage: 3,
    pdfDoc: { numPages: 7 },
    annotations: [{ id: 'r', type: 'scaleRegion', page: 3, x: 0, y: 0, width: 100, height: 100, scaleString: '1:50', units: 'mm' }],
    selectedAnnotations: [{ id: 'l', type: 'line', page: 3, startX: 10, startY: 10, endX: 50, endY: 30 }],
  };
  const c = skillContextFromDocument({ doc, textSelection: { hasSelection: true, selectedText: 'Hall' }, now: new Date(2026, 9, 27) });
  assert.equal(c.hasDocument, true);
  assert.equal(c.page, 3);
  assert.equal(c.pageCount, 7);
  assert.deepEqual(c.selection, [{ id: 'l', type: 'line', page: 3, x: 10, y: 10, width: 40, height: 20 }]);
  assert.equal(c.selectedText, 'Hall');
  assert.equal(c.scale.method, 'scaleRegion');
  assert.ok(Math.abs(c.scale.pixelsPerUnit - 72 / 25.4 / 50) < 1e-9);
  assert.equal(c.hasScale, true);
  assert.equal(c.today, '2026-10-27');

  const bare = skillContextFromDocument({ doc: { currentPage: 1, pdfDoc: { numPages: 1 }, annotations: [] } });
  assert.equal(bare.hasScale, false);
  assert.deepEqual(bare.selection, []);
  const scaled = skillContextFromDocument({ doc: { currentPage: 1, annotations: [], measureScale: { pixelsPerUnit: 2, unit: 'cm' } } });
  assert.deepEqual(scaled.scale, { pixelsPerUnit: 2, unit: 'cm', method: 'document' });
  assert.equal(skillContextFromDocument({ doc: null }).hasDocument, false);
  assert.equal(skillContextFromDocument({ doc: { selectedAnnotation: { id: 'x', type: 'count', page: 1, x: 5, y: 6 } } }).selection[0].id, 'x');
});

test('boxes and scale helpers', () => {
  assert.deepEqual(annotationBox({ points: [{ x: 1, y: 2 }, { x: 5, y: 9 }] }), { x: 1, y: 2, width: 4, height: 7 });
  assert.deepEqual(annotationBox({ x: 3, y: 4 }), { x: 3, y: 4, width: 0, height: 0 });
  assert.equal(annotationBox({}), null);
  assert.equal(scaleAtPoint(null, 1, 0, 0), null);
  assert.equal(scaleAtPoint({ annotations: [] }, 1, 0, 0), null);
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('the panel shows the groups as tabs and checks before sending', () => {
  const panel = readFileSync(new URL('./solid/components/AssistantPanel.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(panel.includes('skillsInGroup(activeGroup())'), 'only the chips of the open group');
  assert.ok(panel.includes('t(skillGroupKey(group))'), 'group names from the locales');
  assert.ok(panel.includes('const blocked = skillBlocker(skill, ctx);'), 'a chip checks before it sends or asks for input');
  assert.ok(panel.includes('skillBlocker(skill, ctx) || skillInputProblem(skill, rest, ctx)'), 'sending checks again');
  assert.ok(panel.includes('t(notice().key, notice().params)'), 'the reason is shown in the panel');
  assert.ok(panel.includes('skillMessage(skill, prompt, shown, ctx)'), 'the input skill gets the app state');
  assert.ok(skillsInGroup('measuring').length >= 3);
});
