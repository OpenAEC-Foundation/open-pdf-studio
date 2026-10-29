// Reactive view of the keyboard shortcuts (#714) for tooltips, menus and the
// shortcuts overview: anything that reads sneltoetsVoor() updates when the
// shortcuts change (Save in the preferences, an import, an extension that
// adds a command) or the language changes.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';
import { sneltoetsen, sneltoetsTekst, zetTaalBron, opdrachtVoorKnop } from '../../core/keybindings/app-shortcuts.js';
import { titleWithShortcut } from '../../core/keybindings/labels.js';

const [versie, setVersie] = createSignal(0);
sneltoetsen.subscribe(() => setVersie((v) => v + 1));

// Extension commands carry their name per language.
zetTaalBron(() => i18next.language || 'en');
i18next.on('languageChanged', () => sneltoetsen.refresh());

/** Changes whenever the shortcuts or the commands change. */
export const sneltoetsVersie = versie;

/** The current shortcuts of a command as text ("Ctrl+2"), '' without one. Reactive. */
export function sneltoetsVoor(id) {
  versie();
  return sneltoetsTekst(id);
}

/** A ribbon button's tooltip with its current shortcut. Reactive. */
export function knopTitel({ id, extCommand, title, label }) {
  const tekst = sneltoetsVoor(opdrachtVoorKnop({ id, extCommand }));
  if (!title && !tekst) return title;
  return titleWithShortcut(title || label || '', tekst);
}
