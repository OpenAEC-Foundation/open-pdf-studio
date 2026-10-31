import { createSignal, createMemo, For, Show, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation, localizeNumber } from '../../../i18n/useTranslation.js';
import { openFolderDialog, isTauri } from '../../../core/platform.js';
import { getActiveDocument } from '../../../core/state.js';
import { onReviewStatus } from '../../../review/shared-review-status.js';
import { reviewFolderFor, logFileName, splitPdfPath } from '../../../review/shared-review-core.js';
import {
  startSharedReview, stopSharedReview, publishSharedReview, refreshSharedReview, importSharedIntoPdf,
  sharedReviewInfo, setAutoPublish, markReviewSeen, reviewUser, reviewIntervalSeconds, setReviewIntervalSeconds,
  savedReviewSettings,
} from '../../../review/shared-review-service.js';

// Shared review through a folder (#237): one file per user next to the PDF.
export default function SharedReviewDialog() {
  const { t } = useTranslation('dialogs');
  const doc = getActiveDocument();
  const saved = savedReviewSettings(doc?.filePath);
  const [info, setInfo] = createSignal(sharedReviewInfo(doc)),
    [customFolder, setCustomFolder] = createSignal(saved?.folder || ''),
    [useCustom, setUseCustom] = createSignal(!!saved?.folder),
    [autoPublish, setAutoPublishSignal] = createSignal(saved?.autoPublish ?? true),
    [interval, setIntervalText] = createSignal(String(reviewIntervalSeconds())),
    [selected, setSelected] = createSignal(''),
    [message, setMessage] = createSignal(''),
    [error, setError] = createSignal(''),
    [busy, setBusy] = createSignal(false);
  const reload = () => setInfo(sharedReviewInfo(doc));
  onCleanup(onReviewStatus(reload));
  markReviewSeen(doc);

  const usable = () => isTauri() && !!doc?.filePath && !doc.isUntitled;
  const folder = () => info()?.folder || reviewFolderFor(doc?.filePath || '', useCustom() ? customFolder() : '');
  const ownFile = () => logFileName(splitPdfPath(doc?.filePath || '').base, reviewUser());
  const time = (iso) => (iso ? new Date(iso).toLocaleString() : t('sharedReview.never'));
  const errorText = (code) => ({
    READ_FAILED: t('sharedReview.errorRead'),
    WRITE_FAILED: t('sharedReview.errorWrite'),
    SAVE_FIRST: t('sharedReview.errorSaveFirst'),
  })[code] || t('sharedReview.errorGeneric');

  async function act(fn) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e?.message));
    } finally {
      setBusy(false);
      reload();
    }
  }
  const start = () => act(() => startSharedReview(doc, { folder: useCustom() ? customFolder() : '', autoPublish: autoPublish() }));
  const restartIfRunning = () => { if (info()) start(); };
  async function browse() {
    const picked = await openFolderDialog(t('sharedReview.folder'));
    if (!picked) return;
    setCustomFolder(picked);
    setUseCustom(true);
    restartIfRunning();
  }

  const annotations = createMemo(() => [...(info()?.annotations || [])]
    .sort((a, b) => ((a.updatedAt || '') < (b.updatedAt || '') ? 1 : -1)));
  const current = createMemo(() => annotations().find((a) => a.id === selected()) || annotations()[0] || null);
  const opLabel = (op) => t(op === 'create' ? 'sharedReview.opCreate' : op === 'edit' ? 'sharedReview.opEdit' : 'sharedReview.opDelete');
  const annLabel = (a) => `${a.label || a.type || a.id}${a.page ? ` (p. ${localizeNumber(a.page)})` : ''}${a.deleted ? ` — ${t('sharedReview.deleted')}` : ''}`;

  return <Dialog
    title={t('sharedReview.title')}
    onClose={() => closeDialog('shared-review')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog shared-review-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('shared-review')}>{t('sharedReview.close')}</button>}
  >
    <p>{t('sharedReview.help')}</p>
    <p>{t('sharedReview.pdfUntouched')}</p>
    <Show when={usable()} fallback={<p class="shared-review-error">{isTauri() ? t('sharedReview.errorSaveFirst') : t('sharedReview.desktopOnly')}</p>}>
      <label class="shared-review-row">
        <input type="checkbox" checked={!!info()} disabled={busy()}
          onChange={(e) => (e.target.checked ? start() : act(async () => stopSharedReview(doc)))} />
        {t('sharedReview.enable')}
      </label>
      <fieldset>
        <legend>{t('sharedReview.folder')}</legend>
        <label class="shared-review-row">
          <input type="radio" name="shared-review-folder" checked={!useCustom()} disabled={busy()}
            onChange={() => { setUseCustom(false); restartIfRunning(); }} />
          {t('sharedReview.folderDefault')}
        </label>
        <label class="shared-review-row">
          <input type="radio" name="shared-review-folder" checked={useCustom()} disabled={busy() || !customFolder()}
            onChange={() => { setUseCustom(true); restartIfRunning(); }} />
          {t('sharedReview.folderCustom')}
          <button class="pref-btn" disabled={busy()} onClick={browse}>{t('sharedReview.browse')}</button>
        </label>
        <div class="shared-review-path" title={folder()}>{folder()}</div>
      </fieldset>
      <div class="shared-review-row">
        <span>{t('sharedReview.user')}: <b>{reviewUser()}</b></span>
      </div>
      <div class="shared-review-hint">{t('sharedReview.userHint', { file: ownFile() })}</div>
      <label class="shared-review-row">
        <input type="checkbox" checked={autoPublish()} disabled={busy()}
          onChange={(e) => { setAutoPublishSignal(e.target.checked); setAutoPublish(doc, e.target.checked); }} />
        {t('sharedReview.autoPublish')}
      </label>
      <label class="shared-review-row">
        {t('sharedReview.interval')}
        <input type="text" inputmode="numeric" class="shared-review-interval" value={interval()}
          onChange={(e) => { setReviewIntervalSeconds(e.target.value); setIntervalText(String(reviewIntervalSeconds())); }} />
      </label>
      <Show when={info()}>
        <div class="shared-review-row">
          <button class="pref-btn" disabled={busy()} onClick={() => act(async () => {
            const n = await publishSharedReview(doc);
            setMessage(t('sharedReview.published', { n: localizeNumber(n) }));
          })}>{t('sharedReview.publish')}</button>
          <button class="pref-btn" disabled={busy()} onClick={() => act(() => refreshSharedReview(doc))}>{t('sharedReview.refresh')}</button>
          <button class="pref-btn" disabled={busy()} onClick={() => act(async () => {
            if (importSharedIntoPdf(doc)) setMessage(t('sharedReview.importDone'));
          })}>{t('sharedReview.importIntoPdf')}</button>
        </div>
        <div class="shared-review-status">
          <span>{t('sharedReview.lastUpdate', { time: time(info().lastUpdate) })}</span>
          <span>{t('sharedReview.lastPublished', { time: time(info().lastPublished) })}</span>
          <span>{t('sharedReview.pending', { n: localizeNumber(info().pending) })}</span>
        </div>
        <Show when={info().error}><p class="shared-review-error">{errorText(info().error)}</p></Show>
        <h3>{t('sharedReview.participants')}</h3>
        <table class="shared-review-table">
          <thead><tr><th>{t('sharedReview.participant')}</th><th>{t('sharedReview.changes')}</th><th>{t('sharedReview.lastChange')}</th><th></th></tr></thead>
          <tbody>
            <For each={info().participants}>{(p) => <tr>
              <td>{p.user}{p.me ? ` ${t('sharedReview.you')}` : ''}</td>
              <td>{localizeNumber(p.events)}</td>
              <td>{time(p.lastAt)}</td>
              <td>{p.conflictedFiles ? t('sharedReview.conflictedCopies', { n: localizeNumber(p.conflictedFiles) }) : ''}</td>
            </tr>}</For>
          </tbody>
        </table>
        <h3>{t('sharedReview.history')}</h3>
        <p class="shared-review-hint">{t('sharedReview.conflictRule')}</p>
        <Show when={annotations().length} fallback={<p>{t('sharedReview.noHistory')}</p>}>
          <label class="shared-review-row">
            {t('sharedReview.annotation')}
            <select value={current()?.id || ''} onChange={(e) => setSelected(e.target.value)}>
              <For each={annotations()}>{(a) => <option value={a.id}>{annLabel(a)}</option>}</For>
            </select>
          </label>
          <table class="shared-review-table">
            <thead><tr><th>{t('sharedReview.time')}</th><th>{t('sharedReview.participant')}</th><th>{t('sharedReview.action')}</th></tr></thead>
            <tbody>
              <For each={current()?.history || []}>{(h) => <tr classList={{ 'shared-review-concurrent': h.concurrent }}>
                <td>{time(h.at)}</td>
                <td>{h.user}</td>
                <td>{opLabel(h.op)}{h.concurrent ? ` (${t('sharedReview.concurrent')})` : ''}</td>
              </tr>}</For>
            </tbody>
          </table>
        </Show>
      </Show>
      <Show when={message()}><p>{message()}</p></Show>
      <Show when={error()}><p class="shared-review-error">{error()}</p></Show>
    </Show>
  </Dialog>;
}
