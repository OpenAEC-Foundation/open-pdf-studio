import { For, createMemo } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { sneltoetsen, platform } from '../../../core/keybindings/app-shortcuts.js';
import { FIXED_SHORTCUTS } from '../../../core/keybindings/default-commands.js';
import { bindingParts } from '../../../core/keybindings/binding.js';
import { commandLabel, categoryLabel, groupCommands } from '../../../core/keybindings/labels.js';
import { sneltoetsVersie } from '../../stores/keybindingStore.js';

// The shortcuts overview (F1). It shows the CURRENT shortcuts from the
// registry (#714): every command that has one, by category, then the keys
// with a fixed meaning (tab switching, FIXED_SHORTCUTS).
export default function ShortcutsDialog() {
  const close = () => closeDialog('shortcuts');
  const { t, language } = useTranslation('preferences');

  const groepen = createMemo(() => {
    sneltoetsVersie();
    const taal = language();
    const metToets = sneltoetsen.commands()
      .map((c) => ({ ...c, bindings: sneltoetsen.bindingsOf(c.id) }))
      .filter((c) => c.bindings.length > 0);
    const uit = groupCommands(metToets).map((g) => ({
      titel: categoryLabel(g.category, t),
      rijen: g.commands.map((c) => ({ naam: commandLabel(c, t, taal), bindingen: c.bindings })),
    }));
    uit.push({
      titel: t('keyboardShortcuts.fixedGroup'),
      rijen: FIXED_SHORTCUTS.map((f) => ({ naam: commandLabel(f, t, taal), bindingen: f.keys })),
    });
    return uit;
  });

  // Two columns of about the same length; a category stays in one column.
  const kolommen = createMemo(() => {
    const lijst = groepen();
    const totaal = lijst.reduce((n, g) => n + g.rijen.length + 2, 0);
    const links = [];
    const rechts = [];
    let n = 0;
    for (const g of lijst) {
      if (n < totaal / 2) { links.push(g); n += g.rijen.length + 2; } else rechts.push(g);
    }
    return [links, rechts];
  });

  const customize = () => {
    close();
    openDialog('preferences', { tab: 'shortcuts' });
  };

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={customize}>{t('keyboardShortcuts.customize')}</button>
      <div class="pref-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={close}>{t('common:close')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('keyboardShortcuts.title')}
      dialogClass="shortcuts-dialog"
      footerClass="preferences-footer"
      onClose={close}
      footer={footer}
    >
      <div class="shortcuts-grid">
        <For each={kolommen()}>
          {(kolom) => (
            <div class="shortcuts-column">
              <For each={kolom}>
                {(category) => (
                  <div class="shortcuts-category">
                    <h3>{category.titel}</h3>
                    <For each={category.rijen}>
                      {(rij) => (
                        <div class="shortcuts-row">
                          <span class="shortcuts-action">{rij.naam}</span>
                          <span class="shortcuts-keys">
                            <For each={rij.bindingen}>
                              {(binding, i) => (
                                <>
                                  {i() > 0 && <span class="shortcuts-or">/</span>}
                                  <For each={bindingParts(binding, platform())}>{(key) => <kbd>{key}</kbd>}</For>
                                </>
                              )}
                            </For>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
