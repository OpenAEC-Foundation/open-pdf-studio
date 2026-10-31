import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';
import { createSignal, For, Show, onCleanup } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { isTauri, saveFileDialog, bewaarPdfOpSite } from '../../core/platform.js';
import { DEFAULT_PRINT_PROFILE, printProfile } from '../../pdf/print-preflight.js';
import { preflightCurrent, prepareTrimCopy, exportTrimCopy } from '../../pdf/print-preflight-service.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const KEY = 'openpdf.printProfiles.v1';

function profiles() {
  try {
    return JSON.parse(leesOpslag(KEY) || '[]').map(printProfile).slice(0, 20);
  } catch {
    return [];
  }
}

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PrintPreflight() {
  const { t } = useTranslation('dialogs');
  const [profile, setProfile] = createSignal({ ...DEFAULT_PRINT_PROFILE }),
    [saved, setSaved] = createSignal(profiles()),
    [result, setResult] = createSignal(null),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [progress, setProgress] = createSignal('');
  let controller, documentId, reportPdf;
  onCleanup(() => controller?.abort());
  const change = (key, value) => setProfile(p => ({ ...p, [key]: value }));
  const saveProfile = () => {
    try {
      const p = printProfile(profile()),
        items = [p, ...saved().filter(v => v.name !== p.name)].slice(0, 20);
      schrijfOpslag(KEY, JSON.stringify(items));
      setSaved(items);
    } catch {
      setError(t('preflight.error'));
    }
  };
  const run = async () => {
    controller?.abort();
    controller = new AbortController();
    setBusy(true);
    setError('');
    setResult(null);
    documentId = getActiveDocument()?.id;
    try {
      const r = await preflightCurrent(documentId, profile(), { signal: controller.signal, onProgress: p => setProgress(p.page + '/' + p.pages) });
      reportPdf = getActiveDocument()?.pdfDoc;
      setResult(r.report);
    } catch (e) {
      setError(t('preflight.error') + ' (' + e.message + ')');
    } finally {
      setBusy(false);
    }
  };
  const reveal = async page => {
    const doc = getActiveDocument();
    if (doc?.id !== documentId || doc.pdfDoc !== reportPdf || doc.modified) {
      setError(t('preflight.stale'));
      return;
    }
    const { goToPage } = await import('../../pdf/renderer.js');
    if (getActiveDocument() !== doc) {
      setError(t('preflight.stale'));
      return;
    }
    await goToPage(page);
  };
  const fix = async () => {
    controller = null;
    setBusy(true);
    setError('');
    try {
      if (isTauri()) {
        const path = await saveFileDialog('trim-copy.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
        if (!path) return;
        const r = await exportTrimCopy(documentId, profile(), path);
        setResult(r.report);
      } else {
        const r = await prepareTrimCopy(documentId, profile());
        // Op de site als die dat kent (#726), anders een download.
        const opSite = await bewaarPdfOpSite('trim-copy.pdf', r.bytes);
        if (opSite === false) return;
        if (opSite === null) download(r.bytes, 'trim-copy.pdf', 'application/pdf');
        setResult(r.report);
      }
    } catch (e) {
      setError(t('preflight.error') + ' (' + e.message + ')');
    } finally {
      setBusy(false);
    }
  };
  return <section class="print-preflight">
    <h3>{t('preflight.title')}</h3>
    <p>{t('preflight.scope')}</p>
    <select
      aria-label={t('preflight.profiles')}
      disabled={busy()}
      onChange={e => {
        const p = saved().find(p => p.name === e.currentTarget.value);
        if (p) setProfile({ ...p });
      }}
    >
      <option value="">{t('preflight.profiles')}</option>
      <For each={saved()}>{p => <option value={p.name}>{p.name}</option>}</For>
    </select>
    <label>
      {t('preflight.name')}
      <input
        type="text"
        value={profile().name}
        disabled={busy()}
        onInput={e => change('name', e.currentTarget.value)}
      />
    </label>
    <label>
      {t('preflight.dpi')}
      <input
        type="text"
        inputmode="decimal"
        data-getal
        min="36"
        max="2400"
        value={profile().minDpi}
        disabled={busy()}
        onInput={e => change('minDpi', Number(e.currentTarget.value))}
      />
    </label>
    <For each={['embeddedFonts', 'allowRgb', 'allowTransparency', 'outputIntent']}>
      {key => <label>
        <input
          type="checkbox"
          checked={profile()[key]}
          disabled={busy()}
          onChange={e => change(key, e.currentTarget.checked)}
        />
        {t('preflight.' + key)}
      </label>}
    </For>
    <button disabled={busy()} onClick={saveProfile}>{t('preflight.saveProfile')}</button>
    <button disabled={busy()} onClick={run}>{t('preflight.inspect')}</button>
    <button disabled={!busy() || !controller} onClick={() => controller?.abort()}>
      {t('preflight.cancel')}
    </button>
    <Show when={busy()}><p role="status">{progress()}</p></Show>
    <Show when={result()}>
      {r => <>
        <p>{t('preflight.notCertified')} ({r().findings.length})</p>
        <div style={{ 'max-height': '220px', overflow: 'auto' }}>
          <For each={r().findings}>
            {f => <p>
     <Show when={f.page}>
                <button onClick={() => reveal(f.page)}>{t('preflight.page')} {f.page}</button>
              </Show>
     {f.severity}: {f.object} — {f.code}: {f.observed} ({f.expected})
    </p>}
          </For>
        </div>
        <button onClick={() => download(JSON.stringify(r(), null, 2), 'preflight-report.json', 'application/json')}>
          {t('preflight.report')}
        </button>
        <p>{t('preflight.fixEffect')}</p>
        <button disabled={busy()} onClick={fix}>{t('preflight.fix')}</button>
      </>}
    </Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
  </section>;
}
