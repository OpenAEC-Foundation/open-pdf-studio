// Dynamic stamps (#629): stamp templates with fields that are filled in when
// the stamp is placed and stay editable afterwards.
//
// Pure module (no app imports): parsing, resolving, validation and the
// template-set file format. Layout lives in dynamic-stamp-layout.js, the
// canvas drawing in rendering/dynamic-stamp-draw.js, the PDF appearance in
// pdf/saver/dynamic-stamp-ap.js and reading it back in
// pdf/loader/dynamic-stamp-load.js.
//
// Template syntax (per text line):
//   {date} {time} {datetime}      date/time of placing, in the template's
//                                 date format and the UI locale
//   {date:dd-MM-yyyy}             the same with an explicit pattern
//   {user}                        author name from the preferences
//   {page} {pages}                page number / page count
//   {filename} {title}            file name / document title
//   {Approved by}                 any other name: a field the user fills in
//   {Project number:P-001}        ... with a default value after the colon
//   {{ and }}                     a literal brace
// A '{' without a closing '}' stays literal text.
//
// A placed stamp carries `ann.dynamicStamp`:
//   { v: 1, template, values: { [fieldKey]: string }, placedAt, locked }
// The values are plain strings: the user can correct each of them (e.g. the
// date) and the appearance is regenerated from template + values.

export const DYNAMIC_STAMP_VERSION = 1;
export const TEMPLATE_SET_FORMAT = 'open-pdf-studio/stamp-templates';
export const TEMPLATE_SET_VERSION = 1;
export const TEMPLATE_SET_EXTENSION = 'opstamps';

export const BUILTIN_FIELDS = Object.freeze(['date', 'time', 'datetime', 'user', 'page', 'pages', 'filename', 'title']);
const DATE_FIELDS = new Set(['date', 'time', 'datetime']);

export const DATE_FORMATS = Object.freeze(['short', 'medium', 'long', 'iso', 'custom']);
export const BORDER_STYLES = Object.freeze(['none', 'square', 'rounded']);
export const ALIGNS = Object.freeze(['left', 'center', 'right']);

export const LIMITS = Object.freeze({
  name: 80,
  lines: 12,
  lineText: 300,
  fieldKey: 40,
  value: 500,
  fontMin: 4,
  fontMax: 144,
  borderMax: 12,
  templates: 500,
  imageBytes: 1_500_000,
  imagePixels: 10000,
  customFormat: 60,
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Split one line of template text into text and field tokens.
 * @param {string} text
 * @returns {Array<{type:'text', value:string}|{type:'field', key:string, name:string, builtin:string|null, arg:string|null}>}
 *   key: the value key on the stamp (`date`, `date:yyyy-MM-dd`, `Approved by`);
 *   builtin: the built-in field name or null for a custom field;
 *   arg: date pattern (built-in) or default value (custom)
 */
export function parseTemplateText(text) {
  const s = String(text ?? '');
  const tokens = [];
  let buf = '';
  const flush = () => { if (buf) { tokens.push({ type: 'text', value: buf }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' && s[i + 1] === '{') { buf += '{'; i++; continue; }
    if (ch === '}' && s[i + 1] === '}') { buf += '}'; i++; continue; }
    if (ch === '{') {
      const end = s.indexOf('}', i + 1);
      const inner = end > i ? s.slice(i + 1, end) : null;
      const field = inner !== null && !inner.includes('{') ? parseField(inner) : null;
      if (!field) { buf += ch; continue; }
      flush();
      tokens.push(field);
      i = end;
      continue;
    }
    buf += ch;
  }
  flush();
  return tokens;
}

function parseField(inner) {
  const colon = inner.indexOf(':');
  const name = (colon >= 0 ? inner.slice(0, colon) : inner).trim();
  const arg = colon >= 0 ? inner.slice(colon + 1) : null;
  if (!name || name.length > LIMITS.fieldKey) return null;
  const lower = name.toLowerCase();
  const builtin = BUILTIN_FIELDS.includes(lower) ? lower : null;
  if (builtin) {
    const pattern = DATE_FIELDS.has(builtin) && arg && arg.trim() ? arg.trim() : null;
    return { type: 'field', key: pattern ? `${builtin}:${pattern}` : builtin, name: builtin, builtin, arg: pattern };
  }
  return { type: 'field', key: name, name, builtin: null, arg: arg !== null ? arg.trim() : null };
}

/**
 * All fields of a template in order of first appearance, without duplicates.
 * @returns {Array<{key:string, name:string, builtin:string|null, arg:string|null, default:string}>}
 */
export function templateFields(template) {
  const seen = new Map();
  for (const line of template?.lines || []) {
    for (const tok of parseTemplateText(line.text)) {
      if (tok.type !== 'field' || seen.has(tok.key)) continue;
      const fromEditor = template.fields?.[tok.key]?.default;
      seen.set(tok.key, {
        key: tok.key, name: tok.name, builtin: tok.builtin, arg: tok.arg,
        default: tok.builtin ? '' : String(fromEditor ?? tok.arg ?? ''),
      });
    }
  }
  return [...seen.values()];
}

/** Only the fields the user fills in. */
export function customFields(template) {
  return templateFields(template).filter((f) => !f.builtin);
}

// ── Date formatting ──────────────────────────────────────────────────────

function safeLocale(locale) {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([String(locale || 'en')]).length ? String(locale) : 'en';
  } catch (_) {
    return 'en';
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

function intlPart(date, locale, opts) {
  try { return new Intl.DateTimeFormat(locale, opts).format(date); } catch (_) { return ''; }
}

/**
 * Format with a pattern: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H hh h mm ss a,
 * text between single quotes is literal ('' is a quote).
 */
export function formatPattern(date, pattern, locale = 'en') {
  const loc = safeLocale(locale);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const map = {
    yyyy: () => String(d.getFullYear()).padStart(4, '0'),
    yy: () => pad2(d.getFullYear() % 100),
    MMMM: () => intlPart(d, loc, { month: 'long' }),
    MMM: () => intlPart(d, loc, { month: 'short' }),
    MM: () => pad2(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    dd: () => pad2(d.getDate()),
    d: () => String(d.getDate()),
    EEEE: () => intlPart(d, loc, { weekday: 'long' }),
    EEE: () => intlPart(d, loc, { weekday: 'short' }),
    HH: () => pad2(h),
    H: () => String(h),
    hh: () => pad2(h % 12 || 12),
    h: () => String(h % 12 || 12),
    mm: () => pad2(d.getMinutes()),
    ss: () => pad2(d.getSeconds()),
    a: () => (h < 12 ? 'AM' : 'PM'),
  };
  return String(pattern ?? '').replace(/'((?:[^']|'')*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g,
    (m, quoted) => (quoted !== undefined ? (quoted === '' ? "'" : quoted.replace(/''/g, "'")) : map[m]()));
}

/**
 * Date in one of the template formats, for the given locale.
 * @param {Date} date
 * @param {{locale?:string, format?:string, custom?:string}} opts
 */
export function formatStampDate(date, { locale = 'en', format = 'short', custom = '' } = {}) {
  const loc = safeLocale(locale);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  switch (format) {
    case 'iso': return formatPattern(d, 'yyyy-MM-dd', loc);
    case 'long': return intlPart(d, loc, { year: 'numeric', month: 'long', day: 'numeric' });
    case 'medium': return intlPart(d, loc, { year: 'numeric', month: 'short', day: 'numeric' });
    case 'custom': return custom ? formatPattern(d, custom, loc) : intlPart(d, loc, { year: 'numeric', month: '2-digit', day: '2-digit' });
    default: return intlPart(d, loc, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
}

/** Time of day in the locale (24/12 h as the locale prefers); 'iso' gives HH:mm. */
export function formatStampTime(date, { locale = 'en', format = 'short' } = {}) {
  const loc = safeLocale(locale);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  if (format === 'iso') return formatPattern(d, 'HH:mm', loc);
  return intlPart(d, loc, { hour: '2-digit', minute: '2-digit' });
}

// ── Resolving ────────────────────────────────────────────────────────────

/**
 * Value of one built-in field.
 * @param {{builtin:string, arg:string|null}} field
 * @param {object} template
 * @param {{now?:Date, locale?:string, user?:string, page?:number, pages?:number, filename?:string, title?:string}} ctx
 */
export function resolveBuiltin(field, template, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now());
  const locale = ctx.locale || 'en';
  const fmt = { locale, format: template?.dateFormat || 'short', custom: template?.customDateFormat || '' };
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  switch (field.builtin) {
    case 'date': return field.arg ? formatPattern(now, field.arg, locale) : formatStampDate(now, fmt);
    case 'time': return field.arg ? formatPattern(now, field.arg, locale) : formatStampTime(now, fmt);
    case 'datetime':
      return field.arg ? formatPattern(now, field.arg, locale)
        : `${formatStampDate(now, fmt)} ${formatStampTime(now, fmt)}`.trim();
    case 'user': return str(ctx.user);
    case 'page': return Number.isFinite(ctx.page) ? String(ctx.page) : '';
    case 'pages': return Number.isFinite(ctx.pages) ? String(ctx.pages) : '';
    case 'filename': return str(ctx.filename);
    case 'title': return str(ctx.title);
    default: return '';
  }
}

/**
 * Values for all fields of a template: built-ins from the context, custom
 * fields from `given`, else their default. Missing values become ''.
 */
export function resolveStampValues(template, ctx = {}, given = {}) {
  const values = {};
  for (const f of templateFields(template)) {
    if (f.builtin) {
      values[f.key] = Object.prototype.hasOwnProperty.call(given, f.key)
        ? clampValue(given[f.key]) : resolveBuiltin(f, template, ctx);
    } else {
      values[f.key] = clampValue(Object.prototype.hasOwnProperty.call(given, f.key) ? given[f.key] : f.default);
    }
  }
  return values;
}

function clampValue(v) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, LIMITS.value);
}

/**
 * The text lines of the stamp with all fields filled in.
 * @returns {Array<{text:string, fontSize:number, bold:boolean, align:string}>}
 */
export function resolveLines(template, values = {}) {
  return (template?.lines || []).map((line) => ({
    text: parseTemplateText(line.text).map((tok) => (tok.type === 'text' ? tok.value : (values[tok.key] ?? ''))).join(''),
    fontSize: line.fontSize,
    bold: !!line.bold,
    align: line.align || 'center',
  }));
}

/** All lines as one text (stampText, search, annotation list). */
export function dynamicStampText(ds) {
  if (!ds?.template) return '';
  return resolveLines(ds.template, ds.values).map((l) => l.text).join('\n').trim();
}

// ── Stamp on an annotation ───────────────────────────────────────────────

/** A new dynamicStamp object for a placed stamp. */
export function createDynamicStamp(template, ctx = {}, given = {}) {
  const t = normalizeTemplate(template).template;
  if (!t) return null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  return {
    v: DYNAMIC_STAMP_VERSION,
    template: stripForStamp(t),
    values: resolveStampValues(t, { ...ctx, now }, given),
    placedAt: now.toISOString(),
    locked: !!t.lockOnPlace,
  };
}

// Scope/owner of the library are not part of a placed stamp.
function stripForStamp(t) {
  const { scope, owner, readOnly, ...rest } = t;
  return rest;
}

/** Field list of a placed stamp, for the properties panel. */
export function dynamicStampFields(ds) {
  if (!ds?.template) return [];
  return templateFields(ds.template).map((f) => ({ ...f, value: ds.values?.[f.key] ?? '' }));
}

/** Is the stamp final (no more edits of its fields)? */
export function isDynamicStampLocked(ann) {
  return !!ann?.dynamicStamp?.locked;
}

/**
 * Change one field value. Refused (false) when locked or for an unknown key.
 */
export function setDynamicStampValue(ann, key, value) {
  const ds = ann?.dynamicStamp;
  if (!ds || ds.locked) return false;
  if (!templateFields(ds.template).some((f) => f.key === key)) return false;
  const v = clampValue(value);
  if (ds.values[key] === v) return false;
  ds.values = { ...ds.values, [key]: v };
  applyDynamicStampToAnnotation(ann);
  return true;
}

/** Recompute the automatic (built-in) fields, e.g. after moving to another page. */
export function refreshAutomaticValues(ann, ctx = {}) {
  const ds = ann?.dynamicStamp;
  if (!ds || ds.locked) return false;
  const next = { ...ds.values };
  for (const f of templateFields(ds.template)) if (f.builtin) next[f.key] = resolveBuiltin(f, ds.template, ctx);
  const changed = JSON.stringify(next) !== JSON.stringify(ds.values);
  ds.values = next;
  if (changed) applyDynamicStampToAnnotation(ann);
  return changed;
}

/**
 * Make the stamp final: no more field edits, and the PDF flags ReadOnly and
 * Locked so other readers do not change it either.
 */
export function lockDynamicStamp(ann) {
  const ds = ann?.dynamicStamp;
  if (!ds) return false;
  ds.locked = true;
  ann.locked = true;
  ann.readOnly = true;
  return true;
}

/** Copy the derived annotation fields (text, name, colour) from the stamp. */
export function applyDynamicStampToAnnotation(ann) {
  const ds = ann?.dynamicStamp;
  if (!ds?.template) return ann;
  ann.stampName = ds.template.name;
  ann.stampText = dynamicStampText(ds) || ds.template.name || 'STAMP';
  ann.stampColor = ds.template.color;
  ann.color = ds.template.color;
  ann.strokeColor = ds.template.color;
  if (ds.locked) { ann.locked = true; ann.readOnly = true; }
  return ann;
}

// ── Validation ───────────────────────────────────────────────────────────

const num = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

let idCounter = 0;
export function newTemplateId() {
  idCounter = (idCounter + 1) % 1e6;
  return `tpl_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Check and normalise a template. Unknown properties are dropped, numbers
 * clamped; structural errors make it invalid.
 * @returns {{template: object|null, errors: string[]}}
 */
export function normalizeTemplate(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { template: null, errors: ['notAnObject'] };
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, LIMITS.name) : '';
  if (!name) errors.push('missingName');
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) errors.push('missingLines');
  else if (raw.lines.length > LIMITS.lines) errors.push('tooManyLines');
  const lines = Array.isArray(raw.lines) ? raw.lines.slice(0, LIMITS.lines).map((l) => {
    if (!l || typeof l !== 'object' || typeof l.text !== 'string') { errors.push('badLine'); return null; }
    return {
      text: l.text.replace(/[\r\n]+/g, ' ').slice(0, LIMITS.lineText),
      fontSize: num(l.fontSize, LIMITS.fontMin, LIMITS.fontMax, 12),
      bold: !!l.bold,
      align: ALIGNS.includes(l.align) ? l.align : 'center',
    };
  }) : [];
  if (raw.color !== undefined && !HEX.test(String(raw.color))) errors.push('badColor');
  if (raw.fillColor !== undefined && raw.fillColor !== null && !HEX.test(String(raw.fillColor))) errors.push('badColor');
  let image = null;
  if (raw.image !== undefined && raw.image !== null) {
    const im = raw.image;
    const okUrl = im && typeof im.dataUrl === 'string' && im.dataUrl.length <= LIMITS.imageBytes * 1.4 && IMAGE_URL.test(im.dataUrl);
    const w = Number(im?.width), h = Number(im?.height);
    const okSize = w > 0 && h > 0 && w <= LIMITS.imagePixels && h <= LIMITS.imagePixels;
    if (!okUrl || !okSize) errors.push('badImage');
    else image = { dataUrl: im.dataUrl, width: w, height: h };
  }
  const fields = {};
  if (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) {
    for (const [k, v] of Object.entries(raw.fields)) {
      if (typeof k !== 'string' || !k.trim() || k.length > LIMITS.fieldKey + LIMITS.customFormat + 1) continue;
      if (v && typeof v === 'object' && v.default !== undefined) fields[k] = { default: clampValue(v.default) };
    }
  }
  if (errors.length) return { template: null, errors };
  const t = {
    id: typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : newTemplateId(),
    name,
    lines,
    color: HEX.test(String(raw.color)) ? String(raw.color).toLowerCase() : '#c00000',
    fillColor: raw.fillColor && HEX.test(String(raw.fillColor)) ? String(raw.fillColor).toLowerCase() : null,
    border: BORDER_STYLES.includes(raw.border) ? raw.border : 'rounded',
    borderWidth: num(raw.borderWidth, 0, LIMITS.borderMax, 2),
    dateFormat: DATE_FORMATS.includes(raw.dateFormat) ? raw.dateFormat : 'short',
    customDateFormat: typeof raw.customDateFormat === 'string' ? raw.customDateFormat.slice(0, LIMITS.customFormat) : '',
    image,
    lockOnPlace: !!raw.lockOnPlace,
    fields,
  };
  if (typeof raw.owner === 'string' && raw.owner) t.owner = raw.owner.slice(0, 120);
  return { template: t, errors: [] };
}

/** A stamp object read back from a file: same checks as a template. */
export function normalizeDynamicStamp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { template } = normalizeTemplate(raw.template);
  if (!template) return null;
  const values = {};
  for (const f of templateFields(template)) {
    const v = raw.values && typeof raw.values === 'object' ? raw.values[f.key] : undefined;
    values[f.key] = v === undefined ? (f.builtin ? '' : f.default) : clampValue(v);
  }
  const placed = typeof raw.placedAt === 'string' && !Number.isNaN(Date.parse(raw.placedAt)) ? raw.placedAt : null;
  return { v: DYNAMIC_STAMP_VERSION, template: stripForStamp(template), values, placedAt: placed, locked: !!raw.locked };
}

// ── Template-set file (import/export, shared folder) ────────────────────

/** Serialise templates to a template-set file (JSON text). */
export function exportTemplateSet(templates, { owner } = {}) {
  const list = (templates || []).map((t) => normalizeTemplate(t).template).filter(Boolean).map((t) => {
    const { scope, readOnly, ...rest } = t;
    return rest;
  });
  const set = { format: TEMPLATE_SET_FORMAT, version: TEMPLATE_SET_VERSION, templates: list };
  if (owner) set.owner = String(owner);
  return JSON.stringify(set, null, 2);
}

/**
 * Read and validate a template-set file.
 * @param {string|object} input
 * @returns {{ok:boolean, templates:object[], errors:string[], owner:string|null}}
 *   ok: at least one valid template; errors: why the file or a template was refused
 */
export function parseTemplateSet(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input.replace(/^﻿/, '')); } catch (_) { return { ok: false, templates: [], errors: ['notJson'], owner: null }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, templates: [], errors: ['wrongFormat'], owner: null };
  if (data.format !== TEMPLATE_SET_FORMAT) return { ok: false, templates: [], errors: ['wrongFormat'], owner: null };
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > TEMPLATE_SET_VERSION) {
    return { ok: false, templates: [], errors: ['unsupportedVersion'], owner: null };
  }
  if (!Array.isArray(data.templates) || data.templates.length === 0) return { ok: false, templates: [], errors: ['noTemplates'], owner: null };
  const errors = [];
  const templates = [];
  const ids = new Set();
  data.templates.slice(0, LIMITS.templates).forEach((raw, i) => {
    const { template, errors: e } = normalizeTemplate(raw);
    if (!template) { errors.push(`template ${i + 1}: ${e.join(', ')}`); return; }
    if (ids.has(template.id)) template.id = newTemplateId();
    ids.add(template.id);
    templates.push(template);
  });
  if (data.templates.length > LIMITS.templates) errors.push('tooManyTemplates');
  return { ok: templates.length > 0, templates, errors, owner: typeof data.owner === 'string' ? data.owner : null };
}

// ── Built-in dynamic templates ───────────────────────────────────────────

export const BUILTIN_DYNAMIC_TEMPLATES = Object.freeze([
  {
    id: 'builtin-approved-dated', name: 'Approved (date, user)', color: '#1e8e3e', border: 'rounded', borderWidth: 2,
    lines: [
      { text: 'APPROVED', fontSize: 18, bold: true, align: 'center' },
      { text: '{user} · {date}', fontSize: 9, bold: false, align: 'center' },
    ],
  },
  {
    id: 'builtin-received', name: 'Received', color: '#1a5fb4', border: 'rounded', borderWidth: 2,
    lines: [
      { text: 'RECEIVED', fontSize: 18, bold: true, align: 'center' },
      { text: '{datetime}', fontSize: 9, bold: false, align: 'center' },
    ],
  },
  {
    id: 'builtin-reviewed', name: 'Reviewed', color: '#b35c00', border: 'square', borderWidth: 2,
    lines: [
      { text: 'REVIEWED', fontSize: 16, bold: true, align: 'center' },
      { text: '{user} · {date}', fontSize: 9, bold: false, align: 'center' },
      { text: '{page} / {pages}', fontSize: 8, bold: false, align: 'center' },
    ],
  },
  {
    id: 'builtin-approved-by', name: 'Approved by', color: '#1e8e3e', border: 'square', borderWidth: 2,
    lines: [
      { text: 'APPROVED', fontSize: 16, bold: true, align: 'center' },
      { text: 'By: {Approved by}', fontSize: 9, bold: false, align: 'left' },
      { text: 'Project: {Project number}', fontSize: 9, bold: false, align: 'left' },
      { text: 'Date: {date}', fontSize: 9, bold: false, align: 'left' },
    ],
  },
].map((t) => Object.freeze({ ...normalizeTemplate(t).template, scope: 'builtin', readOnly: true })));
