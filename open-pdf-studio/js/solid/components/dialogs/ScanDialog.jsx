import { createSignal, onMount, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';

const LANGUAGE_OPTIONS = ['auto', 'eng', 'chi_tra', 'chi_tra+eng'];
const RESOLUTIONS = [150, 200, 300, 400, 600];

/** Error codes from src-tauri/src/scanner.rs → text in this dialog. */
function errorKey(message) {
  if (message.startsWith('SCANNER_UNSUPPORTED')) return 'unsupported';
  if (message.startsWith('SCANNER_TOOL_MISSING')) return 'toolMissing';
  if (message.startsWith('SCAN_FEEDER_EMPTY')) return 'feederEmpty';
  if (message.startsWith('SCAN_NO_PAGES')) return 'noPages';
  return null;
}

/**
 * Scan (#382): pick a scanner and settings, acquire pages and land them as a
 * searchable PDF (OCR applied) in one step: a new document, or inserted after
 * the current page. From the feeder the result follows directly after the
 * scan; on the flatbed pages are collected until Finish.
 */
export default function ScanDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const s = (key, opts) => t(`scanner.${key}`, opts);
  const hasDocument = !!getActiveDocument()?.pdfDoc;

  const [backend, setBackend] = createSignal(null);
  const [devices, setDevices] = createSignal([]);
  const [device, setDevice] = createSignal('');
  const [searching, setSearching] = createSignal(false);
  const [dpi, setDpi] = createSignal(300);
  const [mode, setMode] = createSignal('color');
  const [source, setSource] = createSignal('flatbed');
  const [maxPages, setMaxPages] = createSignal('0');
  const [ocr, setOcr] = createSignal(true);
  const [lang, setLang] = createSignal('auto');
  const [destination, setDestination] = createSignal('new');
  const [pages, setPages] = createSignal([]);
  const [busy, setBusy] = createSignal(''); // '' | 'scanning' | 'finishing'
  const [status, setStatus] = createSignal('');
  const [error, setError] = createSignal('');
  let jobId = null;
  let cancelled = false;

  const scanner = () => import('../../../pdf/scanner.js');

  function showError(e) {
    const message = String(e?.message ?? e ?? '');
    if (message.startsWith('SCAN_CANCELLED')) return;
    const key = errorKey(message);
    setError(key ? s(key) : s('failed', { error: message.replace(/^SCAN_FAILED:/, '') }));
  }

  async function refresh() {
    setError('');
    setSearching(true);
    try {
      const { listScanners } = await scanner();
      const list = await listScanners();
      setDevices(list);
      if (!list.some((d) => d.id === device())) setDevice(list[0]?.id || '');
    } catch (e) {
      setDevices([]);
      showError(e);
    } finally {
      setSearching(false);
    }
  }

  onMount(async () => {
    const { scannerBackend } = await scanner();
    const which = await scannerBackend();
    setBackend(which);
    if (which !== 'none') refresh();
  });

  const close = async () => {
    if (busy() === 'scanning' && jobId) {
      cancelled = true;
      const { cancelAcquire } = await scanner();
      await cancelAcquire(jobId);
      return;
    }
    if (busy()) { cancelled = true; return; }
    closeDialog('scan');
  };

  async function finish(list = pages()) {
    if (!list.length) return;
    setBusy('finishing');
    setError('');
    cancelled = false;
    try {
      const { finishScan } = await scanner();
      await finishScan(list, {
        ocr: ocr(), lang: lang(), destination: destination(),
        isCancelled: () => cancelled,
        onProgress: (p) => setStatus(p.phase === 'recognizing'
          ? s('recognizing', { page: p.page, pages: p.pages })
          : s('building')),
      });
      closeDialog('scan');
    } catch (e) {
      showError(e);
      setStatus(s('pagesScanned', { count: list.length }));
    } finally {
      setBusy('');
    }
  }

  async function scan() {
    if (!device()) return;
    setError('');
    setBusy('scanning');
    setStatus(s('scanning'));
    cancelled = false;
    const { acquirePages, newScanJobId } = await scanner();
    jobId = newScanJobId();
    let added = [];
    try {
      const max = Math.max(0, Math.min(500, parseInt(maxPages(), 10) || 0));
      const got = await acquirePages(jobId, { deviceId: device(), dpi: dpi(), mode: mode(), source: source(), maxPages: max });
      added = got.pages;
      setPages((prev) => [...prev, ...added]);
    } catch (e) {
      showError(e);
    } finally {
      jobId = null;
      setBusy('');
      setStatus(pages().length ? s('pagesScanned', { count: pages().length }) : '');
    }
    // From the feeder the whole stack came in one go: finish right away.
    if (added.length && source() !== 'flatbed' && !cancelled) await finish();
  }

  const usable = () => backend() && backend() !== 'none';

  const footer = (
    <>
      <div>
        <Show when={pages().length > 0 && !busy()}>
          <button class="pref-btn pref-btn-secondary" onClick={() => { setPages([]); setStatus(''); }}>{s('discard')}</button>
        </Show>
      </div>
      <div class="split-doc-footer-right">
        <Show when={usable()}>
          <button class="pref-btn pref-btn-primary" disabled={!device() || !!busy() || searching()} onClick={scan}>{s('scan')}</button>
          <button class="pref-btn pref-btn-secondary" disabled={!pages().length || !!busy()} onClick={() => finish()}>{s('finish')}</button>
        </Show>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{busy() ? s('stop') : tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={s('title')}
      overlayClass="split-doc-overlay"
      dialogClass="scan-dialog"
      bodyClass="split-doc-content"
      onClose={close}
      footer={footer}
    >
      <div class="split-doc-form">
        <Show when={backend() === 'none'}>
          <div class="split-doc-warning">{s('unsupported')}</div>
        </Show>
        <Show when={usable()}>
          <fieldset class="split-doc-group" disabled={!!busy()}>
            <legend>{s('device')}</legend>
            <div class="split-doc-row">
              <select class="batch-ocr-select" value={device()} onChange={(e) => setDevice(e.target.value)} disabled={searching() || !devices().length}>
                <For each={devices()}>{(d) => <option value={d.id}>{d.name}</option>}</For>
              </select>
              <button class="pref-btn pref-btn-secondary split-doc-browse" disabled={searching()} onClick={refresh}>{s('refresh')}</button>
            </div>
            <Show when={searching()}>
              <div class="split-doc-info">{s('searching')}</div>
            </Show>
            <Show when={!searching() && !devices().length && !error()}>
              <div class="split-doc-info">{s('noDevices')}</div>
            </Show>
            <div class="split-doc-row">
              <label class="split-doc-label">{s('resolution')}</label>
              <select class="batch-ocr-select" value={dpi()} onChange={(e) => setDpi(parseInt(e.target.value, 10))}>
                {RESOLUTIONS.map((r) => <option value={r}>{`${r} dpi`}</option>)}
              </select>
            </div>
            <div class="split-doc-row">
              <label class="split-doc-label">{s('colorMode')}</label>
              <select class="batch-ocr-select" value={mode()} onChange={(e) => setMode(e.target.value)}>
                <option value="color">{s('modeColor')}</option>
                <option value="gray">{s('modeGray')}</option>
                <option value="bw">{s('modeBw')}</option>
              </select>
            </div>
            <div class="split-doc-row">
              <label class="split-doc-label">{s('source')}</label>
              <select class="batch-ocr-select" value={source()} onChange={(e) => setSource(e.target.value)}>
                <option value="flatbed">{s('sourceFlatbed')}</option>
                <option value="feeder">{s('sourceFeeder')}</option>
                <option value="duplex">{s('sourceDuplex')}</option>
              </select>
            </div>
            <Show when={source() !== 'flatbed'}>
              <div class="split-doc-row">
                <label class="split-doc-label">{s('maxPages')}</label>
                <input type="text" inputmode="numeric" class="split-doc-number" value={maxPages()} onInput={(e) => setMaxPages(e.target.value)} />
              </div>
            </Show>
          </fieldset>

          <fieldset class="split-doc-group" disabled={!!busy()}>
            <legend>{s('destination')}</legend>
            <label class="split-doc-radio">
              <input type="checkbox" checked={ocr()} onChange={(e) => setOcr(e.target.checked)} />
              <span>{s('ocr')}</span>
            </label>
            <div class="split-doc-row">
              <label class="split-doc-label">{t('ocrLanguage.language')}</label>
              <select class="batch-ocr-select" value={lang()} disabled={!ocr()} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGE_OPTIONS.map((code) => <option value={code}>{t(`ocrLanguage.options.${code}`)}</option>)}
              </select>
            </div>
            <label class="split-doc-radio">
              <input type="radio" name="scan-destination" checked={destination() === 'new'} onChange={() => setDestination('new')} />
              <span>{s('destNew')}</span>
            </label>
            <label class="split-doc-radio" classList={{ disabled: !hasDocument }}>
              <input type="radio" name="scan-destination" disabled={!hasDocument} checked={destination() === 'insert'} onChange={() => setDestination('insert')} />
              <span>{s('destInsert')}</span>
            </label>
          </fieldset>
          <div class="split-doc-info">{s('info')}</div>
        </Show>

        <Show when={status()}>
          <div class="split-doc-summary">{status()}</div>
        </Show>
        <Show when={error()}>
          <div class="split-doc-warning">{error()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
