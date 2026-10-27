import { createSignal, createMemo, For, Show, onCleanup } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { sneltoetsen, platform, zetSneltoetsOpname } from '../../../core/keybindings/app-shortcuts.js';
import { bindingFromEvent, bindingParts, formatBinding, isModifierOnly } from '../../../core/keybindings/binding.js';
import { assignBinding, removeBinding, resetCommand, effectiveBindings, isModified } from '../../../core/keybindings/registry.js';
import { isReserved } from '../../../core/keybindings/dispatch.js';
import { serializeShortcutsFile, parseShortcutsFile, FILE_EXTENSION } from '../../../core/keybindings/io.js';
import { commandLabel, categoryLabel, groupCommands, matchesSearch } from '../../../core/keybindings/labels.js';
import { sneltoetsVersie } from '../../stores/keybindingStore.js';
import { openFileDialog, saveFileDialog, readBinaryFile, writeBinaryFile } from '../../../core/platform.js';

// Preferences > Keyboard Shortcuts (#714). Edits a working copy of the
// overrides (prefs.keyboardShortcuts); Save in the preferences applies it,
// Cancel throws it away. The working copy is what Export writes and what
// Import replaces.
export default function KeyboardShortcutsTab(props) {
  const { t, language } = useTranslation('preferences');
  const [overrides, setOverrides] = props.prefs.keyboardShortcuts;
  const model = sneltoetsen.model;

  const [zoek, setZoek] = createSignal('');
  const [gekozen, setGekozen] = createSignal(null);
  const [opname, setOpname] = createSignal(false);
  // { soort: 'conflict', combo, eigenaar } | { soort: 'reserved', combo } | { soort: 'info'|'error', tekst }
  const [melding, setMelding] = createSignal(null);

  const huidig = () => overrides() || {};
  const toets = (c) => formatBinding(c, platform());

  const alle = createMemo(() => {
    sneltoetsVersie();
    const taal = language();
    return sneltoetsen.commands().map((c) => ({ ...c, naam: commandLabel(c, t, taal) }));
  });
  const naamVan = (id) => alle().find((c) => c.id === id)?.naam || id;

  const groepen = createMemo(() => {
    const ov = huidig();
    const q = zoek();
    const lijst = alle()
      .map((c) => ({ ...c, bindingen: effectiveBindings(model, ov, c.id), gewijzigd: isModified(ov, c.id) }))
      .filter((c) => matchesSearch({ label: c.naam, bindings: c.bindingen }, q, platform()));
    return groupCommands(lijst).map((g) => ({ ...g, titel: categoryLabel(g.category, t) }));
  });

  const keuze = createMemo(() => {
    const id = gekozen();
    const c = id ? alle().find((x) => x.id === id) : null;
    if (!c) return null;
    return { ...c, bindingen: effectiveBindings(model, huidig(), c.id), gewijzigd: isModified(huidig(), c.id) };
  });

  // ── Recording ────────────────────────────────────────────────────────────
  // Capture phase on window: before every other key handling, so Ctrl+S,
  // F1, Delete, ... are recorded instead of run. Escape cancels.
  function opToets(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isModifierOnly(e)) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { stopOpname(); return; }
    const combo = bindingFromEvent(e);
    stopOpname();
    if (!combo || !gekozen()) return;
    if (isReserved(combo)) { setMelding({ soort: 'reserved', combo }); return; }
    const r = assignBinding(model, huidig(), gekozen(), combo);
    if (r.conflict) setMelding({ soort: 'conflict', combo: r.combo, eigenaar: r.conflict });
    else { setOverrides(r.overrides); setMelding(null); }
  }
  // The key-up (and the character) of the recorded key go nowhere either: a
  // Space or Enter on the focused button would otherwise click it again.
  function ruimOp() {
    window.removeEventListener('keyup', slik, true);
    window.removeEventListener('keypress', slik, true);
    zetSneltoetsOpname(false);
  }
  function slik(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keyup' && !opname()) ruimOp();
  }

  function startOpname() {
    if (!gekozen() || opname()) return;
    setMelding(null);
    setOpname(true);
    zetSneltoetsOpname(true);
    document.activeElement?.blur?.();
    window.addEventListener('keydown', opToets, true);
    window.addEventListener('keyup', slik, true);
    window.addEventListener('keypress', slik, true);
  }
  function stopOpname() {
    if (!opname()) return;
    setOpname(false);
    window.removeEventListener('keydown', opToets, true);
    // Normally the key-up cleans up (slik); this covers a key-up that never comes.
    setTimeout(() => { if (!opname()) ruimOp(); }, 1500);
  }
  onCleanup(() => {
    window.removeEventListener('keydown', opToets, true);
    ruimOp();
  });

  function herverdeel() {
    const m = melding();
    if (m?.soort !== 'conflict') return;
    const r = assignBinding(model, huidig(), gekozen(), m.combo, { reassign: true });
    setOverrides(r.overrides);
    setMelding(null);
  }

  function verwijder(combo) {
    setOverrides(removeBinding(model, huidig(), gekozen(), combo));
    setMelding(null);
  }

  function herstel() {
    if (!gekozen()) return;
    setOverrides(resetCommand(model, huidig(), gekozen()));
    setMelding(null);
  }

  async function herstelAlles() {
    const { showConfirm } = await import('../../../ui/chrome/confirm-dialog.js');
    const ja = await showConfirm({ title: t('keyboardShortcuts.resetAll'), message: t('keyboardShortcuts.resetAllConfirm') });
    if (!ja) return;
    setOverrides({});
    setMelding(null);
  }

  // ── Export / Import ──────────────────────────────────────────────────────
  const filters = () => [{ name: t('keyboardShortcuts.fileType'), extensions: [FILE_EXTENSION] }];

  async function exporteer() {
    try {
      const pad = await saveFileDialog(`keyboard-shortcuts.${FILE_EXTENSION}`, filters());
      if (!pad) return;
      const versie = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;
      const tekst = serializeShortcutsFile(huidig(), { appVersion: versie });
      await writeBinaryFile(pad, new TextEncoder().encode(tekst));
      setMelding({ soort: 'info', tekst: t('keyboardShortcuts.exported') });
    } catch (fout) {
      setMelding({ soort: 'error', tekst: `${t('keyboardShortcuts.exportFailed')} ${fout?.message ?? fout}` });
    }
  }

  async function importeer() {
    try {
      let pad = await openFileDialog([FILE_EXTENSION]);
      if (Array.isArray(pad)) pad = pad[0];
      if (!pad) return;
      const bytes = await readBinaryFile(pad);
      const r = parseShortcutsFile(bytes ? new TextDecoder().decode(bytes) : '');
      if (!r.ok) {
        setMelding({ soort: 'error', tekst: t('keyboardShortcuts.importFailed') + (r.detail ? ` (${r.detail})` : '') });
        return;
      }
      setOverrides(r.overrides);
      setMelding({ soort: 'info', tekst: t('keyboardShortcuts.imported') });
    } catch (fout) {
      setMelding({ soort: 'error', tekst: `${t('keyboardShortcuts.importFailed')} ${fout?.message ?? fout}` });
    }
  }

  const Toets = (p) => <span class="ks-keys"><For each={bindingParts(p.combo, platform())}>{(k) => <kbd>{k}</kbd>}</For></span>;

  return (
    <div class="ks-page">
      <input
        type="search"
        class="ks-search"
        placeholder={t('keyboardShortcuts.search')}
        aria-label={t('keyboardShortcuts.search')}
        value={zoek()}
        onInput={(e) => setZoek(e.currentTarget.value)}
      />

      <div class="ks-list" role="listbox" aria-label={t('keyboardShortcuts.title')}>
        <div class="ks-list-head">
          <span>{t('keyboardShortcuts.command')}</span>
          <span>{t('keyboardShortcuts.shortcuts')}</span>
        </div>
        <For each={groepen()} fallback={<div class="ks-empty">{t('keyboardShortcuts.noMatches')}</div>}>
          {(g) => (
            <>
              <div class="ks-category">{g.titel}</div>
              <For each={g.commands}>
                {(c) => (
                  <div
                    class="ks-row"
                    classList={{ selected: gekozen() === c.id, modified: c.gewijzigd }}
                    role="option"
                    aria-selected={gekozen() === c.id}
                    onClick={() => { if (!opname()) { setGekozen(c.id); setMelding(null); } }}
                  >
                    <span class="ks-name">{c.naam}</span>
                    <span class="ks-binding">{c.bindingen.map(toets).join(', ')}</span>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>

      <fieldset class="pref-fieldset ks-detail">
        <legend>{keuze()?.naam || t('keyboardShortcuts.shortcuts')}</legend>
        <Show when={keuze()} fallback={<div class="ks-hint">{t('keyboardShortcuts.selectHint')}</div>}>
          {(c) => (
            <>
              <div class="ks-current">
                <For each={c().bindingen} fallback={<span class="ks-none">{t('keyboardShortcuts.none')}</span>}>
                  {(combo) => (
                    <span class="ks-chip">
                      <Toets combo={combo} />
                      <button class="ks-remove" title={t('keyboardShortcuts.remove')} aria-label={`${t('keyboardShortcuts.remove')} ${toets(combo)}`}
                        disabled={opname()} onClick={() => verwijder(combo)}>×</button>
                    </span>
                  )}
                </For>
              </div>
              <div class="ks-default">
                {t('keyboardShortcuts.defaultLabel', {
                  keys: c().defaults.length ? c().defaults.map(toets).join(', ') : t('keyboardShortcuts.none'),
                })}
              </div>
              <div class="ks-actions">
                <button class="pref-btn" disabled={opname()} onClick={startOpname}>{t('keyboardShortcuts.addShortcut')}</button>
                <button class="pref-btn" disabled={opname() || !c().gewijzigd} onClick={herstel}>{t('keyboardShortcuts.resetCommand')}</button>
              </div>
            </>
          )}
        </Show>

        <Show when={opname()}>
          <div class="ks-message ks-recording" role="status">
            <span>{t('keyboardShortcuts.recording')}</span>
            <span class="ks-message-buttons">
              <button class="pref-btn" onClick={() => { stopOpname(); ruimOp(); }}>{t('common:cancel')}</button>
            </span>
          </div>
        </Show>
        <Show when={melding()}>
          {(m) => (
            <div class={`ks-message ks-${m().soort}`} role={m().soort === 'error' ? 'alert' : 'status'}>
              <Show when={m().soort === 'conflict'}>
                <span>{t('keyboardShortcuts.conflict', { keys: toets(m().combo), command: naamVan(m().eigenaar) })}</span>
                <span class="ks-message-buttons">
                  <button class="pref-btn pref-btn-primary" onClick={herverdeel}>{t('keyboardShortcuts.reassign')}</button>
                  <button class="pref-btn" onClick={() => setMelding(null)}>{t('common:cancel')}</button>
                </span>
              </Show>
              <Show when={m().soort === 'reserved'}>
                <span>{t('keyboardShortcuts.reserved', { keys: toets(m().combo) })}</span>
              </Show>
              <Show when={m().soort === 'info' || m().soort === 'error'}>
                <span>{m().tekst}</span>
              </Show>
            </div>
          )}
        </Show>
      </fieldset>

      <div class="ks-footer">
        <button class="pref-btn" disabled={opname()} onClick={herstelAlles}>{t('keyboardShortcuts.resetAll')}</button>
        <span class="ks-footer-hint">{t('keyboardShortcuts.applyHint')}</span>
        <button class="pref-btn" disabled={opname()} onClick={importeer}>{t('keyboardShortcuts.import')}</button>
        <button class="pref-btn" disabled={opname()} onClick={exporteer}>{t('keyboardShortcuts.export')}</button>
      </div>
    </div>
  );
}
