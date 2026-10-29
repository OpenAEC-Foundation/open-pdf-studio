// Names, tooltips and search for the keyboard shortcuts (#714). Pure: the
// translation function is passed in.

import { parseBinding, formatBinding } from './binding.js';
import { CATEGORY_ORDER } from './default-commands.js';

// One part of a "(Ctrl+2)" or "(Ctrl+L / F11)" in an existing text.
const lijktOpToets = (deel) => {
  const d = deel.trim();
  if (!d || /\s/.test(d)) return false;
  return d.includes('+') || /^F\d{1,2}$/.test(d) || /^(Del|Esc)$/i.test(d);
};

/**
 * Remove the shortcuts written into a text ("Fit Page (Ctrl+2)" -> "Fit Page",
 * "Proofreading mode (F2): ..." -> "Proofreading mode: ..."): the current
 * shortcut is shown instead, so a changed key never shows the old one.
 */
export function stripShortcutText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s*[(（]([^()（）]*)[)）]/g, (heel, binnen) => {
    const delen = binnen.split(/\s*[/,]\s*/);
    return delen.length && delen.every(lijktOpToets) ? '' : heel;
  }).trim();
}

/** A tooltip with the current shortcut: "Fit Page (Ctrl+K)"; without one just the text. */
export function titleWithShortcut(title, shortcutText) {
  const basis = stripShortcutText(title || '');
  if (!shortcutText) return basis;
  return basis ? `${basis} (${shortcutText})` : shortcutText;
}

/** The name of a command in the current language. */
export function commandLabel(command, t, language = 'en') {
  if (!command) return '';
  const fallback = typeof command.label === 'function' ? command.label(language) : command.label;
  if (command.labelKey && typeof t === 'function') {
    const v = t(command.labelKey, { defaultValue: fallback ?? '' });
    if (typeof v === 'string' && v && v !== command.labelKey) return stripShortcutText(v);
  }
  return stripShortcutText(String(fallback ?? command.id));
}

/** The name of a category: built-in ones from the preferences texts, ribbon tabs by the tab name. */
export function categoryLabel(category, t) {
  if (typeof category === 'string' && category.startsWith('ribbon:')) {
    const tab = category.slice('ribbon:'.length);
    const naam = t(`ribbon:tabs.${tab}`, { defaultValue: tab });
    return t('preferences:keyboardShortcuts.categories.ribbon', { tab: naam, defaultValue: `Ribbon: ${naam}` });
  }
  return t(`preferences:keyboardShortcuts.categories.${category}`, { defaultValue: category });
}

/** Sort order of a category (unknown ones at the end, by name). */
export function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i >= 0 ? i : CATEGORY_ORDER.length;
}

const zonderAccenten = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Does a command match the search text? By name ("fit" finds "Fit Page"), or
 * by key: "ctrl+2", "Strg+2" or "f3" finds the command with that shortcut,
 * and a partial key text ("ctrl+shift") the commands whose shortcut contains it.
 */
export function matchesSearch({ label, bindings = [] }, query, platform = 'win') {
  const q = String(query || '').trim();
  if (!q) return true;
  const qz = zonderAccenten(q);
  if (zonderAccenten(label || '').includes(qz)) return true;
  const canon = parseBinding(q);
  if (canon && bindings.includes(canon)) return true;
  if (/[+]/.test(q) || /^f\d{1,2}$/i.test(q)) {
    return bindings.some((b) => zonderAccenten(formatBinding(b, platform)).includes(qz)
      || zonderAccenten(b).includes(qz));
  }
  return false;
}

/**
 * The commands grouped for display: [{ category, commands: [...] }] in the
 * fixed category order, the commands in their own order.
 */
export function groupCommands(commands) {
  const perCategorie = new Map();
  for (const c of commands) {
    if (!perCategorie.has(c.category)) perCategorie.set(c.category, []);
    perCategorie.get(c.category).push(c);
  }
  return [...perCategorie.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || String(a).localeCompare(String(b)))
    .map(([category, lijst]) => ({ category, commands: lijst.sort((x, y) => x.order - y.order) }));
}
