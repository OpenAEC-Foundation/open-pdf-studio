// History of watermark texts (#850): the dialog pre-fills the last text and
// offers earlier ones while typing. Newest first, de-duplicated (ignoring case
// and surrounding spaces) and capped. Kept in the app's browser storage
// (core/opslag.js), on this computer only.

import { leesOpslagJson, schrijfOpslagJson } from '../core/opslag.js';

export const WATERMARK_HISTORY_KEY = 'watermarkTextHistory';
export const WATERMARK_HISTORY_MAX = 25;
/** Characters to type before suggestions appear. */
export const WATERMARK_SUGGEST_MIN = 2;
const SUGGEST_LIMIT = 8;
const TEXT_MAX = 500;

const clean = (text) => (typeof text === 'string' ? text.trim() : '');
const same = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function tidy(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const text = clean(entry);
    if (!text || text.length > TEXT_MAX || out.some((t) => same(t, text))) continue;
    out.push(text);
    if (out.length === WATERMARK_HISTORY_MAX) break;
  }
  return out;
}

function write(list) {
  try {
    schrijfOpslagJson(WATERMARK_HISTORY_KEY, list);
  } catch (e) {
    console.warn('[watermark] text history not stored:', e);
  }
  return list;
}

/** @returns {string[]} newest first */
export function readWatermarkHistory() {
  return tidy(leesOpslagJson(WATERMARK_HISTORY_KEY, []));
}

/** The text of the last added or updated text watermark, or null. */
export function lastWatermarkText() {
  return readWatermarkHistory()[0] ?? null;
}

/** Puts `text` at the front of the history. @returns {string[]} the new history */
export function rememberWatermarkText(text) {
  const entry = clean(text);
  const history = readWatermarkHistory();
  if (!entry || entry.length > TEXT_MAX) return history;
  return write(tidy([entry, ...history.filter((t) => !same(t, entry))]));
}

/** Removes `text` from the history. @returns {string[]} the new history */
export function forgetWatermarkText(text) {
  const entry = clean(text);
  return write(readWatermarkHistory().filter((t) => !same(t, entry)));
}

/**
 * Entries that contain what was typed (from WATERMARK_SUGGEST_MIN characters
 * on, ignoring case): the ones that start with it first, each group in
 * history order. The typed text itself is not offered again.
 */
export function watermarkSuggestions(history, typed, limit = SUGGEST_LIMIT) {
  const query = clean(typed).toLocaleLowerCase();
  if (query.length < WATERMARK_SUGGEST_MIN) return [];
  const exact = clean(typed);
  const matches = (history || []).filter((t) => t !== exact && t.toLocaleLowerCase().includes(query));
  const starts = matches.filter((t) => t.toLocaleLowerCase().startsWith(query));
  return [...starts, ...matches.filter((t) => !starts.includes(t))].slice(0, limit);
}

/** Up/Down through `count` suggestions; -1 is none. Wraps around. */
export function moveSuggestionIndex(index, count, delta) {
  if (count <= 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (((index + delta) % count) + count) % count;
}
