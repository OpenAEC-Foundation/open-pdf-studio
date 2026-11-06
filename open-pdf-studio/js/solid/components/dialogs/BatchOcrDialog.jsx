import { createSignal, createMemo, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openFolderDialog } from '../../../core/platform.js';
import {
  normaliseOptions, summarise, splitPath, DEFAULT_SUFFIX,
  OUTPUT_FOLDER, OUTPUT_BESIDE, OUTPUT_REPLACE, EXISTING_RENAME, EXISTING_SKIP, EXISTING_OVERWRITE,
} from '../../../pdf/batch-ocr-plan.js';

// Same choices as the single-document OCR dialog (bundled trained data).
const LANGUAGE_OPTIONS = ['auto', 'eng', 'chi_tra', 'chi_tra+eng'];

const OPTION_ERRORS = {
  BATCH_OCR_NO_SOURCE: 'needSource',
  BATCH_OCR_NO_OUTPUT: 'needOutput',
  BATCH_OCR_SUFFIX_REQUIRED: 'needSuffix',
  BATCH_OCR_BAD_SUFFIX: 'badSuffix',
};

const FILE_ERRORS = {
  BATCH_OCR_ENCRYPTED: 'errEncrypted',
  BATCH_OCR_FONT_MISSING: 'errFont',
};

/**
 * Batch OCR (#382): a folder of PDF files, without a question per file. The
 * work is in pdf/batch-ocr.js; this window collects the choices, shows the
 * status per file and exports the report.
 */
export default function BatchOcrDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const b = (key, opts) => t(`batchOcr.${key}`, opts);

  const [source, setSource] = createSignal('');
  const [recursive, setRecursive] = createSignal(true);
  const [lang, setLang] = createSignal('auto');
  const [skipText, setSkipText] = createSignal(true);
  const [mode, setMode] = createSignal(OUTPUT_FOLDER);
  const [outputDir, setOutputDir] = createSignal('');
  const [suffix, setSuffix] = createSignal(DEFAULT_SUFFIX);
  const [existing, setExisting] = createSignal(EXISTING_RENAME);
  const [error, setError] = createSignal('');
  const [phase, setPhase] = createSignal('setup'); // setup | running | finished
  const [rows, setRows] = createSignal([]);
  const [current, setCurrent] = createSignal(null); // { index, page, pages }
  const [notice, setNotice] = createSignal('');
  let cancelled = false;

  const options = () => ({
    sourceDir: source(), recursive: recursive(), lang: lang(), skipText: skipText(),
    outputMode: mode(), outputDir: outputDir(), suffix: mode() === OUTPUT_BESIDE ? suffix() : '', existing: existing(),
  });

  const totals = createMemo(() => summarise(rows()));
  const finishedCount = createMemo(() => rows().filter((r) => !['pending', 'running'].includes(r.status)).length);

  const close = () => {
    if (phase() === 'running') { cancelled = true; return; }
    closeDialog('batch-ocr');
  };

  async function pickSource() {
    const picked = await openFolderDialog(b('chooseSource'));
    if (typeof picked === 'string' && picked) setSource(picked);
  }

  async function pickOutput() {
    const picked = await openFolderDialog(b('chooseOutput'));
    if (typeof picked === 'string' && picked) setOutputDir(picked);
  }

  function statusText(r, index) {
    const cur = current();
    switch (r.status) {
      case 'pending': return b('statusPending');
      case 'running':
        return cur && cur.index === index && cur.pages
          ? b('statusRunning', { page: cur.page, pages: cur.pages })
          : b('statusPending');
      case 'done': return b('statusDone', { count: r.words });
      case 'skipped': return r.reason ? `${b('statusSkipped')}: ${b(`reason${r.reason[0].toUpperCase()}${r.reason.slice(1)}`)}` : b('statusSkipped');
      case 'cancelled': return b('statusCancelled');
      case 'failed': {
        const key = FILE_ERRORS[r.message];
        return `${b('statusFailed')}: ${key ? b(key) : r.message}`;
      }
      default: return r.status;
    }
  }

  async function start() {
    setError('');
    setNotice('');
    try {
      normaliseOptions(options());
    } catch (e) {
      setError(b(OPTION_ERRORS[e.message] || 'folderFailed', { error: e.message }));
      return;
    }
    const { startBatchOcr } = await import('../../../pdf/batch-ocr.js');
    cancelled = false;
    setPhase('running');
    try {
      const results = await startBatchOcr(options(), {
        isCancelled: () => cancelled,
        onPlan: (plan) => {
          if (plan.length === 0) throw new Error('BATCH_OCR_NO_FILES');
          setRows(plan.map((p) => ({ source: p.source, target: p.target, status: 'pending', reason: p.reason, words: 0 })));
        },
        onProgress: ({ index, result, page, pages }) => {
          setCurrent({ index, page, pages });
          setRows((prev) => prev.map((r, i) => (i === index ? { ...result } : r)));
        },
      });
      setRows(results);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (msg === 'BATCH_OCR_NO_FILES') setError(b('noFiles'));
      else setError(b('folderFailed', { error: msg.replace(/^BATCH_OCR_FOLDER:/, '') }));
      setPhase(rows().length ? 'finished' : 'setup');
      return;
    } finally {
      setCurrent(null);
    }
    setPhase('finished');
  }

  async function exportReport() {
    const { exportBatchReport } = await import('../../../pdf/batch-ocr.js');
    try {
      const path = await exportBatchReport(rows());
      if (path) setNotice(b('reportSaved', { path }));
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }

  const footer = (
    <>
      <div>
        <Show when={phase() === 'finished'}>
          <button class="pref-btn pref-btn-secondary" onClick={exportReport}>{b('exportReport')}</button>
        </Show>
      </div>
      <div class="split-doc-footer-right">
        <Show when={phase() === 'setup'}>
          <button class="pref-btn pref-btn-primary" onClick={start}>{b('start')}</button>
        </Show>
        <Show when={phase() === 'running'}>
          <button class="pref-btn pref-btn-secondary" onClick={() => { cancelled = true; }}>{b('stop')}</button>
        </Show>
        <button class="pref-btn pref-btn-secondary" disabled={phase() === 'running'} onClick={close}>
          {phase() === 'setup' ? tCommon('cancel') : tCommon('close')}
        </button>
      </div>
    </>
  );

  return (
    <Dialog
      title={b('title')}
      overlayClass="split-doc-overlay"
      dialogClass="batch-ocr-dialog"
      bodyClass="split-doc-content"
      onClose={close}
      footer={footer}
    >
      <div class="split-doc-form">
        <Show when={phase() === 'setup'}>
          <fieldset class="split-doc-group">
            <legend>{b('sourceFolder')}</legend>
            <div class="split-doc-row">
              <input type="text" class="split-doc-input-wide" value={source()} onInput={(e) => setSource(e.target.value)} />
              <button class="pref-btn pref-btn-secondary split-doc-browse" onClick={pickSource}>{b('browse')}</button>
            </div>
            <label class="split-doc-radio">
              <input type="checkbox" checked={recursive()} onChange={(e) => setRecursive(e.target.checked)} />
              <span>{b('recursive')}</span>
            </label>
            <div class="split-doc-row">
              <label class="split-doc-label">{t('ocrLanguage.language')}</label>
              <select class="batch-ocr-select" value={lang()} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGE_OPTIONS.map((code) => <option value={code}>{t(`ocrLanguage.options.${code}`)}</option>)}
              </select>
            </div>
            <label class="split-doc-radio">
              <input type="checkbox" checked={skipText()} onChange={(e) => setSkipText(e.target.checked)} />
              <span>{b('skipText')}</span>
            </label>
          </fieldset>

          <fieldset class="split-doc-group">
            <legend>{b('output')}</legend>
            <label class="split-doc-radio">
              <input type="radio" name="batch-ocr-mode" checked={mode() === OUTPUT_FOLDER} onChange={() => setMode(OUTPUT_FOLDER)} />
              <span>{b('toFolder')}</span>
            </label>
            <div class="split-doc-row batch-ocr-indent">
              <input type="text" class="split-doc-input-wide" value={outputDir()} disabled={mode() !== OUTPUT_FOLDER}
                onInput={(e) => setOutputDir(e.target.value)} />
              <button class="pref-btn pref-btn-secondary split-doc-browse" disabled={mode() !== OUTPUT_FOLDER} onClick={pickOutput}>{b('browse')}</button>
            </div>
            <label class="split-doc-radio">
              <input type="radio" name="batch-ocr-mode" checked={mode() === OUTPUT_BESIDE} onChange={() => setMode(OUTPUT_BESIDE)} />
              <span>{b('beside')}</span>
              <input type="text" class="split-doc-number batch-ocr-suffix" value={suffix()} disabled={mode() !== OUTPUT_BESIDE}
                onInput={(e) => setSuffix(e.target.value)} />
            </label>
            <label class="split-doc-radio">
              <input type="radio" name="batch-ocr-mode" checked={mode() === OUTPUT_REPLACE} onChange={() => setMode(OUTPUT_REPLACE)} />
              <span>{b('replace')}</span>
            </label>
            <Show when={mode() === OUTPUT_REPLACE}>
              <div class="split-doc-warning">{b('replaceWarning')}</div>
            </Show>
            <div class="split-doc-row">
              <label class="split-doc-label">{b('existing')}</label>
              <select class="batch-ocr-select" value={existing()} disabled={mode() === OUTPUT_REPLACE} onChange={(e) => setExisting(e.target.value)}>
                <option value={EXISTING_RENAME}>{b('existingRename')}</option>
                <option value={EXISTING_SKIP}>{b('existingSkip')}</option>
                <option value={EXISTING_OVERWRITE}>{b('existingOverwrite')}</option>
              </select>
            </div>
          </fieldset>
          <div class="split-doc-info">{b('info')}</div>
        </Show>

        <Show when={phase() !== 'setup'}>
          <div class="split-doc-summary">
            <div>{b('found', { count: rows().length })}</div>
            <div>{b('summary', { done: totals().done, skipped: totals().skipped, failed: totals().failed + totals().cancelled })}</div>
            <div class="batch-ocr-progress" role="progressbar" aria-valuemin="0" aria-valuemax={rows().length} aria-valuenow={finishedCount()}>
              <div class="batch-ocr-progress-bar" style={{ width: `${rows().length ? (100 * finishedCount()) / rows().length : 0}%` }} />
            </div>
          </div>
          <div class="batch-ocr-list">
            <table>
              <tbody>
                <For each={rows()}>{(r, i) => (
                  <tr classList={{ 'batch-ocr-failed': r.status === 'failed', 'batch-ocr-done': r.status === 'done' }} title={r.target || r.source}>
                    <td class="batch-ocr-name">{splitPath(r.source).base}</td>
                    <td class="batch-ocr-status">{statusText(r, i())}</td>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={error()}>
          <div class="split-doc-warning">{error()}</div>
        </Show>
        <Show when={notice()}>
          <div class="split-doc-info">{notice()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
