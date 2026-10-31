import { createSignal, For, Show } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { isTauri, saveFileDialog, bewaarPdfOpSite } from '../../core/platform.js';
import { inspectCurrentHiddenInformation, prepareHiddenCopy, exportHiddenCopy } from '../../pdf/hidden-information-service.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const categories = ['metadata', 'comments', 'attachments', 'actions'];

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function HiddenInformation() {
  const { t } = useTranslation('dialogs');
  const [report, setReport] = createSignal(null),
    [selected, setSelected] = createSignal([]),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [exported, setExported] = createSignal(null);
  let documentId;
  const inspect = async () => {
    setBusy(true);
    setError('');
    setExported(null);
    setReport(null);
    setSelected([]);
    try {
      documentId = getActiveDocument()?.id;
      const r = await inspectCurrentHiddenInformation(documentId);
      setReport(r.report);
    } catch (e) {
      setError(t('hiddenInformation.error') + ' (' + e.message + ')');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (isTauri()) {
        const path = await saveFileDialog('clean-copy.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
        if (!path) return;
        setExported(await exportHiddenCopy(documentId, selected(), path));
      } else {
        const r = await prepareHiddenCopy(documentId, selected());
        // Op de site als die dat kent (#726), anders een download.
        const opSite = await bewaarPdfOpSite('clean-copy.pdf', r.bytes);
        if (opSite === false) return;
        if (opSite === null) download(r.bytes, 'clean-copy.pdf', 'application/pdf');
        setExported({ report: r.report });
      }
    } catch (e) {
      setError(t('hiddenInformation.error') + ' (' + e.message + ')');
    } finally {
      setBusy(false);
    }
  };
  return <section class="hidden-information">
    <h3>{t('hiddenInformation.title')}</h3>
    <p>{t('hiddenInformation.scope')}</p>
    <button disabled={busy()} onClick={inspect}>{t('hiddenInformation.inspect')}</button>
    <Show when={report()}>
      {r => <>
        <For each={categories}>
          {category => <label style={{ display: 'block' }}>
    <input
              type="checkbox"
              checked={selected().includes(category)}
              disabled={busy()}
              onChange={e => setSelected(e.currentTarget.checked ? [...selected(), category] : selected().filter(c => c !== category))}
            />
    {t('hiddenInformation.' + category)} ({r().findings.filter(f => f.category === category).length})
   </label>}
        </For>
        <p>{t('hiddenInformation.effects')}</p>
        <details>
          <summary>{t('hiddenInformation.findings')}</summary>
          <For each={r().findings}>
            {f => <p>{t('hiddenInformation.' + f.category)} — {f.path}: {f.detail}</p>}
          </For>
          <p>{t('hiddenInformation.unreachable')}: {r().unreachableObjects}</p>
        </details>
        <p>{t('hiddenInformation.limits')}</p>
        <button disabled={busy() || !selected().length} onClick={save}>{t('hiddenInformation.save')}</button>
      </>}
    </Show>
    <Show when={exported()}>
      {r => <p>
        {t('hiddenInformation.done')}
        <button onClick={() => download(JSON.stringify(r().report, null, 2), 'removal-report.json', 'application/json')}>
          {t('hiddenInformation.report')}
        </button>
      </p>}
    </Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
  </section>;
}
