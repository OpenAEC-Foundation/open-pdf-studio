// Dynamic stamps (#629): template syntax, resolving every field, date formats
// per locale, missing values, validation, editing and locking a placed stamp,
// and that an edit regenerates what is drawn.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTemplateText, templateFields, customFields, resolveStampValues, resolveLines, formatStampDate,
  formatStampTime, formatPattern, createDynamicStamp, setDynamicStampValue, refreshAutomaticValues,
  lockDynamicStamp, isDynamicStampLocked, applyDynamicStampToAnnotation, dynamicStampText,
  normalizeTemplate, normalizeDynamicStamp, parseTemplateSet, exportTemplateSet, dynamicStampFields,
  BUILTIN_DYNAMIC_TEMPLATES, TEMPLATE_SET_FORMAT, BUILTIN_FIELDS,
} from './dynamic-stamp.js';
import { layoutDynamicStamp, fitLayout, refitAfterEdit, naturalStampSize, measureStampText } from './dynamic-stamp-layout.js';
import { drawDynamicStamp } from './rendering/dynamic-stamp-draw.js';

// 28 October 2026, 09:05:07 local time (a Wednesday).
const NOW = new Date(2026, 9, 28, 9, 5, 7);
const CTX = { now: NOW, locale: 'nl', user: 'Oscar', page: 3, pages: 12, filename: 'plan.pdf', title: 'Bouwplan' };

const tpl = (lines, extra = {}) => normalizeTemplate({ name: 'T', lines: lines.map((text) => ({ text })), ...extra }).template;

test('parse: text, fields, a format, a default, escaped braces and an unclosed brace', () => {
  assert.deepEqual(parseTemplateText('A {date} B'), [
    { type: 'text', value: 'A ' },
    { type: 'field', key: 'date', name: 'date', builtin: 'date', arg: null },
    { type: 'text', value: ' B' },
  ]);
  const [f] = parseTemplateText('{Date:yyyy-MM-dd}');
  assert.equal(f.builtin, 'date', 'built-in names are case-insensitive');
  assert.equal(f.key, 'date:yyyy-MM-dd');
  const [c] = parseTemplateText('{Project number:P-001}');
  assert.deepEqual([c.builtin, c.key, c.arg], [null, 'Project number', 'P-001']);
  assert.deepEqual(parseTemplateText('{{literal}} and {open'), [{ type: 'text', value: '{literal} and {open' }]);
  assert.deepEqual(parseTemplateText('{}'), [{ type: 'text', value: '{}' }], 'an empty name is text');
});

test('templateFields: in order, without duplicates; customFields only the own ones', () => {
  const t = tpl(['{user} {date}', '{Approved by} {date} {page}/{pages}']);
  assert.deepEqual(templateFields(t).map((f) => f.key), ['user', 'date', 'Approved by', 'page', 'pages']);
  assert.deepEqual(customFields(t).map((f) => f.key), ['Approved by']);
});

test('every built-in field resolves from the context', () => {
  const t = tpl(['{date}|{time}|{datetime}|{user}|{page}|{pages}|{filename}|{title}']);
  const v = resolveStampValues(t, CTX);
  assert.equal(Object.keys(v).length, BUILTIN_FIELDS.length);
  assert.equal(v.date, '28-10-2026');
  assert.equal(v.time, '09:05');
  assert.equal(v.datetime, '28-10-2026 09:05');
  assert.deepEqual([v.user, v.page, v.pages, v.filename, v.title], ['Oscar', '3', '12', 'plan.pdf', 'Bouwplan']);
  assert.equal(resolveLines(t, v)[0].text, '28-10-2026|09:05|28-10-2026 09:05|Oscar|3|12|plan.pdf|Bouwplan');
});

test('date formats per locale, plus ISO and a custom pattern', () => {
  assert.equal(formatStampDate(NOW, { locale: 'nl' }), '28-10-2026');
  assert.equal(formatStampDate(NOW, { locale: 'de' }), '28.10.2026');
  assert.equal(formatStampDate(NOW, { locale: 'en' }), '10/28/2026');
  assert.equal(formatStampDate(NOW, { locale: 'nl', format: 'long' }), '28 oktober 2026');
  assert.match(formatStampDate(NOW, { locale: 'fr', format: 'long' }), /^28 octobre 2026$/);
  assert.equal(formatStampDate(NOW, { locale: 'ja', format: 'iso' }), '2026-10-28');
  assert.equal(formatStampDate(NOW, { locale: 'de', format: 'custom', custom: "EEEE, d. MMMM yyyy 'um' HH:mm" }),
    'Mittwoch, 28. Oktober 2026 um 09:05');
  assert.equal(formatPattern(NOW, 'dd/MM/yy h:mm a', 'en'), '28/10/26 9:05 AM');
  assert.equal(formatPattern(NOW, "'It''s' yyyy", 'en'), "It's 2026", 'a doubled quote is a quote');
  assert.equal(formatStampTime(NOW, { locale: 'nl', format: 'iso' }), '09:05');
  assert.equal(formatStampDate(NOW, { locale: 'xx-invalid-@@' }), '10/28/2026', 'an unknown locale falls back to en');
  // The template's format applies to {date}; an explicit pattern wins.
  const t = tpl(['{date}', '{date:yyyy.MM.dd}'], { dateFormat: 'custom', customDateFormat: 'd MMM yyyy' });
  const v = resolveStampValues(t, { ...CTX, locale: 'en' });
  assert.deepEqual(resolveLines(t, v).map((l) => l.text), ['28 Oct 2026', '2026.10.28']);
});

test('missing values: empty, never a leftover placeholder', () => {
  const t = tpl(['{title}|{filename}|{page}|{Approved by}|{user}']);
  const v = resolveStampValues(t, { now: NOW, locale: 'en' });
  assert.equal(resolveLines(t, v)[0].text, '||||');
  assert.equal(resolveLines(t, {})[0].text, '||||', 'no values at all');
  const d = resolveStampValues(tpl(['{Project:P-1}']), {});
  assert.equal(d.Project, 'P-1', 'the default after the colon');
});

test('given values win; newlines are flattened, long values clipped', () => {
  const t = tpl(['{Approved by} {date}']);
  const v = resolveStampValues(t, CTX, { 'Approved by': 'J.\nSmit', date: '1-1-2027' });
  assert.equal(v['Approved by'], 'J. Smit');
  assert.equal(v.date, '1-1-2027');
  assert.equal(resolveStampValues(t, CTX, { 'Approved by': 'x'.repeat(2000) })['Approved by'].length, 500);
});

function placed(template = BUILTIN_DYNAMIC_TEMPLATES.find((t) => t.id === 'builtin-approved-by'), given = {}) {
  const ann = { id: 'a', type: 'stamp', page: 1, x: 100, y: 100, rotation: 0, locked: false, readOnly: false };
  ann.dynamicStamp = createDynamicStamp(template, CTX, given);
  Object.assign(ann, naturalStampSize(ann.dynamicStamp.template, ann.dynamicStamp.values));
  applyDynamicStampToAnnotation(ann);
  return ann;
}

test('a placed stamp keeps template and values; stampText and colour follow', () => {
  const ann = placed(undefined, { 'Approved by': 'J. Smit', 'Project number': 'P-42' });
  assert.equal(ann.dynamicStamp.placedAt, NOW.toISOString());
  assert.equal(ann.stampText, 'APPROVED\nBy: J. Smit\nProject: P-42\nDate: 28-10-2026');
  assert.equal(ann.stampName, 'Approved by');
  assert.equal(ann.color, ann.dynamicStamp.template.color);
  assert.equal(ann.dynamicStamp.template.scope, undefined, 'library scope is not part of the stamp');
  assert.deepEqual(dynamicStampFields(ann.dynamicStamp).map((f) => [f.key, f.value]),
    [['Approved by', 'J. Smit'], ['Project number', 'P-42'], ['date', '28-10-2026']]);
});

function recordingCtx() {
  const calls = [];
  const noop = () => {};
  return {
    calls,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, beginPath: noop, rect: noop,
    roundRect: noop, fill: noop, stroke: noop, drawImage: noop,
    fillText: (text, x, y) => calls.push({ text, x, y }),
  };
}

test('editing a field after placing regenerates the stamp (text, size, drawing)', () => {
  const ann = placed(undefined, { 'Approved by': 'J. Smit', 'Project number': 'P-42' });
  const before = JSON.parse(JSON.stringify(ann.dynamicStamp));
  const w0 = ann.width;
  assert.equal(setDynamicStampValue(ann, 'date', '29-10-2026'), true, 'correct the date');
  assert.equal(setDynamicStampValue(ann, 'Approved by', 'Johanna van der Smit-Verhoeven'), true);
  assert.equal(setDynamicStampValue(ann, 'nope', 'x'), false, 'unknown field');
  assert.equal(setDynamicStampValue(ann, 'date', '29-10-2026'), false, 'same value: no change');
  assert.match(ann.stampText, /Date: 29-10-2026/);
  assert.match(ann.stampText, /Johanna van der Smit-Verhoeven/);
  const cx = ann.x + ann.width / 2;
  assert.equal(refitAfterEdit(ann, before), true);
  assert.ok(ann.width > w0, 'a longer value makes the box wider instead of the text smaller');
  assert.ok(Math.abs(ann.x + ann.width / 2 - cx) < 1e-9, 'around the same centre');
  const ctx = recordingCtx();
  drawDynamicStamp(ctx, ann);
  assert.deepEqual(ctx.calls.map((c) => c.text),
    ['APPROVED', 'By: Johanna van der Smit-Verhoeven', 'Project: P-42', 'Date: 29-10-2026']);
});

test('refreshAutomaticValues recomputes date/user/page, never the own fields', () => {
  const ann = placed(BUILTIN_DYNAMIC_TEMPLATES.find((t) => t.id === 'builtin-reviewed'));
  setDynamicStampValue(ann, 'user', 'typo');
  const later = { ...CTX, now: new Date(2026, 10, 2, 14, 0), page: 7 };
  assert.equal(refreshAutomaticValues(ann, later), true);
  assert.equal(ann.dynamicStamp.values.user, 'Oscar');
  assert.equal(ann.dynamicStamp.values.date, '02-11-2026');
  assert.equal(ann.dynamicStamp.values.page, '7');
  const own = placed(undefined, { 'Approved by': 'J. Smit' });
  refreshAutomaticValues(own, later);
  assert.equal(own.dynamicStamp.values['Approved by'], 'J. Smit');
});

test('lock: no more edits, PDF flags set; a lockOnPlace template is locked at once', () => {
  const ann = placed(undefined, { 'Approved by': 'J. Smit' });
  assert.equal(isDynamicStampLocked(ann), false);
  assert.equal(lockDynamicStamp(ann), true);
  assert.equal(isDynamicStampLocked(ann), true);
  assert.equal(ann.locked, true);
  assert.equal(ann.readOnly, true);
  const text = ann.stampText;
  assert.equal(setDynamicStampValue(ann, 'Approved by', 'Someone else'), false);
  assert.equal(refreshAutomaticValues(ann, { ...CTX, now: new Date(2030, 0, 1) }), false);
  assert.equal(ann.stampText, text);

  const auto = placed(normalizeTemplate({ name: 'Final', lockOnPlace: true, lines: [{ text: 'FINAL {date}' }] }).template);
  assert.equal(auto.dynamicStamp.locked, true);
  assert.equal(auto.locked, true);
  assert.equal(auto.readOnly, true);
});

test('normalizeTemplate: clamps and defaults, refuses broken templates', () => {
  const { template } = normalizeTemplate({
    name: '  Mine  ', lines: [{ text: 'a\nb', fontSize: 999, align: 'diagonal' }], borderWidth: -3, border: 'zigzag',
    dateFormat: 'weird', color: '#ABCDEF', extra: 'dropped',
  });
  assert.equal(template.name, 'Mine');
  assert.deepEqual(template.lines, [{ text: 'a b', fontSize: 144, bold: false, align: 'center' }]);
  assert.equal(template.borderWidth, 0);
  assert.equal(template.border, 'rounded');
  assert.equal(template.dateFormat, 'short');
  assert.equal(template.color, '#abcdef');
  assert.equal(template.extra, undefined);
  for (const [raw, code] of [
    [null, 'notAnObject'], [{ lines: [{ text: 'x' }] }, 'missingName'], [{ name: 'x', lines: [] }, 'missingLines'],
    [{ name: 'x', lines: [{ text: 1 }] }, 'badLine'], [{ name: 'x', lines: [{ text: 'a' }], color: 'red' }, 'badColor'],
    [{ name: 'x', lines: Array.from({ length: 13 }, () => ({ text: 'a' })) }, 'tooManyLines'],
    [{ name: 'x', lines: [{ text: 'a' }], image: { dataUrl: 'javascript:alert(1)', width: 1, height: 1 } }, 'badImage'],
    [{ name: 'x', lines: [{ text: 'a' }], image: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=', width: 1, height: 1 } }, 'badImage'],
    [{ name: 'x', lines: [{ text: 'a' }], image: { dataUrl: 'data:image/png;base64,AAAA', width: 0, height: 1 } }, 'badImage'],
  ]) {
    const r = normalizeTemplate(raw);
    assert.equal(r.template, null, code);
    assert.ok(r.errors.includes(code), `${code}: ${r.errors}`);
  }
});

test('normalizeDynamicStamp: values only for known fields, defaults for missing ones', () => {
  const ds = normalizeDynamicStamp({
    template: { name: 'X', lines: [{ text: '{A:dflt} {B} {date}' }] },
    values: { B: 'b', evil: 'x' }, placedAt: 'not a date', locked: 1,
  });
  assert.deepEqual(ds.values, { A: 'dflt', B: 'b', date: '' });
  assert.equal(ds.placedAt, null);
  assert.equal(ds.locked, true);
  assert.equal(normalizeDynamicStamp({ template: { lines: [] } }), null);
  assert.equal(dynamicStampText(ds), 'dflt b');
});

test('template-set file: export → parse round trip and validation of imports', () => {
  const text = exportTemplateSet(BUILTIN_DYNAMIC_TEMPLATES);
  const data = JSON.parse(text);
  assert.equal(data.format, TEMPLATE_SET_FORMAT);
  assert.equal(data.templates[0].scope, undefined);
  const back = parseTemplateSet(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.templates.map((t) => t.name), BUILTIN_DYNAMIC_TEMPLATES.map((t) => t.name));
  assert.deepEqual(parseTemplateSet('{nope').errors, ['notJson']);
  assert.deepEqual(parseTemplateSet('[]').errors, ['wrongFormat']);
  assert.deepEqual(parseTemplateSet({ format: 'other', version: 1, templates: [] }).errors, ['wrongFormat']);
  assert.deepEqual(parseTemplateSet({ format: TEMPLATE_SET_FORMAT, version: 99, templates: [{}] }).errors, ['unsupportedVersion']);
  assert.deepEqual(parseTemplateSet({ format: TEMPLATE_SET_FORMAT, version: 1, templates: [] }).errors, ['noTemplates']);
  const mixed = parseTemplateSet('﻿' + JSON.stringify({
    format: TEMPLATE_SET_FORMAT, version: 1,
    templates: [{ id: 'same', name: 'A', lines: [{ text: 'a' }] }, { name: '' }, { id: 'same', name: 'B', lines: [{ text: 'b' }] }],
  }));
  assert.equal(mixed.ok, true, 'a BOM is fine; the valid templates are kept');
  assert.deepEqual(mixed.templates.map((t) => t.name), ['A', 'B']);
  assert.notEqual(mixed.templates[0].id, mixed.templates[1].id, 'duplicate ids are made unique');
  assert.equal(mixed.errors.length, 1);
  assert.match(mixed.errors[0], /^template 2: /);
});

test('layout: lines stacked, alignment, image left of the text, uniform fit', () => {
  const t = normalizeTemplate({
    name: 'L', border: 'square', borderWidth: 2,
    lines: [{ text: 'WIDE TITLE', fontSize: 20, bold: true }, { text: 'left', fontSize: 10, align: 'left' }, { text: 'right', fontSize: 10, align: 'right' }],
  }).template;
  const l = layoutDynamicStamp(t, {});
  assert.ok(l.lines[0].baseline < l.lines[1].baseline && l.lines[1].baseline < l.lines[2].baseline);
  assert.ok(Math.abs(l.lines[0].width - measureStampText('WIDE TITLE', 20, true)) < 1e-9);
  assert.equal(l.lines[1].x, l.lines[0].x, 'left = start of the widest line');
  assert.ok(Math.abs(l.lines[2].x + l.lines[2].width - (l.lines[0].x + l.lines[0].width)) < 1e-9, 'right aligned');
  const withImg = layoutDynamicStamp({ ...t, image: { dataUrl: 'data:image/png;base64,AA==', width: 200, height: 100 } }, {});
  assert.ok(withImg.image.width > 0 && withImg.lines[0].x > withImg.image.x + withImg.image.width);
  const fit = fitLayout(l, l.width * 2, l.height);
  assert.equal(fit.scale, 1);
  assert.ok(Math.abs(fit.dx - l.width / 2) < 1e-9, 'centred horizontally');
});
