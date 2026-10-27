import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Tool Chest (#311) dialogs. Both use the movable base window (Dialog), which
// does not close on a click beside it.

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Importing a tool set whose name already exists: rename the imported set,
 * overwrite the existing one, or keep both (the import gets a free name).
 * Resolves { mode, newName } or null (cancel).
 */
export function ToolChestImportDialog(props) {
  const data = props.data || {};
  const { t } = useTranslation('properties');
  const [mode, setMode] = createSignal('rename');
  const [newName, setNewName] = createSignal(data.suggestedName || data.name || '');
  const [error, setError] = createSignal('');

  const close = (result) => {
    closeDialog('tool-chest-import');
    data.resolve?.(result);
  };

  const confirm = () => {
    if (mode() === 'rename') {
      const name = newName().trim();
      if (!name) { setError(t('toolChest.nameEmpty')); return; }
      if ((data.existingNames || []).some((n) => sameName(n, name))) { setError(t('toolChest.nameTaken')); return; }
      close({ mode: 'rename', newName: name });
      return;
    }
    close({ mode: mode() });
  };

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" onClick={confirm}>{t('toolChest.ok')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={() => close(null)}>{t('toolChest.cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('toolChest.importConflictTitle')}
      dialogClass="tool-chest-import-dialog"
      onClose={() => close(null)}
      footer={footer}
    >
      <div class="tc-dialog-body">
        <p>{t('toolChest.importConflictMessage', { name: data.name })}</p>
        <label class="tc-dialog-choice">
          <input type="radio" name="tc-import-choice" checked={mode() === 'rename'}
            onChange={() => { setMode('rename'); setError(''); }} />
          <span>{t('toolChest.importRename')}</span>
        </label>
        <input type="text" class="tc-dialog-name" value={newName()} disabled={mode() !== 'rename'}
          onInput={(e) => { setNewName(e.currentTarget.value); setError(''); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') confirm(); }} />
        <label class="tc-dialog-choice">
          <input type="radio" name="tc-import-choice" checked={mode() === 'overwrite'}
            onChange={() => { setMode('overwrite'); setError(''); }} />
          <span>{t('toolChest.importOverwrite')}</span>
        </label>
        <label class="tc-dialog-choice">
          <input type="radio" name="tc-import-choice" checked={mode() === 'keepBoth'}
            onChange={() => { setMode('keepBoth'); setError(''); }} />
          <span>{t('toolChest.importKeepBoth')}</span>
        </label>
        <Show when={error()}>
          <div class="tc-dialog-error">{error()}</div>
        </Show>
      </div>
    </Dialog>
  );
}

/** Yes/no question of the Tool Chest. Resolves true or false. */
export function ToolChestConfirmDialog(props) {
  const data = props.data || {};
  const { t } = useTranslation('properties');
  const close = (result) => {
    closeDialog('tool-chest-confirm');
    data.resolve?.(result);
  };

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" onClick={() => close(true)}>{t('toolChest.ok')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={() => close(false)}>{t('toolChest.cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={data.title || t('toolChest.title')}
      dialogClass="tool-chest-confirm-dialog"
      onClose={() => close(false)}
      footer={footer}
    >
      <div class="tc-dialog-body">
        <p>{data.message || ''}</p>
      </div>
    </Dialog>
  );
}
