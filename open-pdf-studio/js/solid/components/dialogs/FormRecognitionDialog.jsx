import { createSignal, createEffect, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import { leesGetal } from '../../../core/getal-invoer.js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { openFormRecognition, exportRecognizedForm } from '../../../pdf/form-recognition-service.js';
import { isTauri, saveFileDialog, bewaarPdfOpSite } from '../../../core/platform.js';

export default function FormRecognitionDialog() {
  const { t } = useTranslation('dialogs'),
    documentId = getActiveDocument()?.id;
  const [session, setSession] = createSignal(null),
    [result, setResult] = createSignal(null),
    [selected, setSelected] = createSignal(''),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [pages, setPages] = createSignal(String(getActiveDocument()?.currentPage || 1)),
    [ocr, setOcr] = createSignal(false),
    [progress, setProgress] = createSignal(''),
    [preview, setPreview] = createSignal(null);
  let canvas,
    controller,
    previewToken = 0,
    closed = false;
  const close = () => closeDialog('form-recognition');
  onCleanup(() => {
    closed = true;
    controller?.abort();
    previewToken++;
  });
  const run = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (!closed) setError(e.message);
    } finally {
      if (!closed) setBusy(false);
    }
  };
  onMount(() => run(async () => setSession(await openFormRecognition(documentId))));
  const current = () => result()?.candidates.find(c => c.id === selected());
  const edit = (key, value) => setResult(r => ({ ...r, candidates: r.candidates.map(c => c.id === selected() ? { ...c, [key]: value } : c) }));
  const editBound = (key, value) => edit('bounds', { ...current().bounds, [key]: leesGetal(value) });
  const previewKey = createMemo(() => current() ? JSON.stringify({ page: current().page, bounds: current().bounds }) : null);
  createEffect(() => {
    const key = previewKey(),
      s = session();
    if (!key || !s || !canvas) return;
    const { page, bounds } = JSON.parse(key),
      token = ++previewToken;
    (async () => {
      const scratch = document.createElement('canvas');
      try {
        const { viewport } = await s.render(page, scratch);
        if (closed || token !== previewToken) return;
        canvas.width = scratch.width;
        canvas.height = scratch.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(scratch, 0, 0);
        const a = viewport.convertToViewportPoint(bounds.x, bounds.y),
          b = viewport.convertToViewportPoint(bounds.x + bounds.width, bounds.y + bounds.height);
        ctx.strokeStyle = '#e66b00';
        ctx.lineWidth = 3;
        ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        setPreview(page);
      } catch (e) {
        if (token === previewToken && !closed) setError(e.message);
      } finally {
        scratch.width = 0;
        scratch.height = 0;
      }
    })();
  });
  const detect = () => run(async () => {
    controller = new AbortController();
    const list = [];
    for (const part of pages().split(',')) {
      const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!m) throw new Error('INVALID_PAGES');
      const from = Number(m[1]),
        to = Number(m[2] || m[1]);
      if (to < from || to - from > 49) throw new Error('INVALID_PAGES');
      for (let p = from; p <= to; p++) list.push(p);
    }
    const r = await session().detect([...new Set(list)], {
      ocr: ocr(),
      signal: controller.signal,
      onProgress: p => setProgress(`${p.completed}/${p.total}`)
    });
    if (closed) return;
    setResult(r);
    setSelected(r.candidates[0]?.id || '');
  });
  const save = () => run(async () => {
    const candidates = result().candidates;
    if (isTauri()) {
      const target = await saveFileDialog('fillable-form.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
      if (target) await exportRecognizedForm(session(), candidates, target);
    } else {
      const output = await session().prepare(candidates);
      if (closed) return;
      // Op de site als die dat kent (#726), anders een download.
      if ((await bewaarPdfOpSite('fillable-form.pdf', output.bytes)) !== null) return;
      const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fillable-form.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  return <Dialog
    title={t('formRecognition.title')}
    dialogClass="form-recognition-dialog"
    onClose={close}
    footer={<>
      <button
        class="pref-btn"
        disabled={busy() || !result()?.candidates.some(c => c.accepted)}
        onClick={save}
      >
        {t('formRecognition.save')}
      </button>
      <button class="pref-btn" onClick={close}>{t('formRecognition.close')}</button>
    </>}
  >
    <p>{t('formRecognition.info')}</p>
    <Show when={error()}>
      <p role="alert">{t(`formRecognition.errors.${error()}`, { defaultValue: error() })}</p>
    </Show>
    <div class="form-recognition-controls">
      <label>
        {t('formRecognition.pages')}
        <input value={pages()} onInput={e => setPages(e.currentTarget.value)} />
      </label>
      <label>
        <input type="checkbox" checked={ocr()} onChange={e => setOcr(e.currentTarget.checked)} />
        {t('formRecognition.ocr')}
      </label>
      <button class="pref-btn" disabled={busy() || !session()} onClick={detect}>
        {t('formRecognition.detect')}
      </button>
      <Show when={busy()}>
        <button class="pref-btn" onClick={() => controller?.abort()}>{t('formRecognition.cancel')}</button>
        <span role="status">{progress()}</span>
      </Show>
    </div>
    <Show when={result()}>
      <p>
        {t('formRecognition.counts', { candidates: result().candidates.length, existing: result().existing.length })}
      </p>
      <For each={result().warnings}>{w => <p>{t('formRecognition.noLabels', { page: w.page })}</p>}</For>
    </Show>
    <div class="form-recognition-grid">
      <div>
        <select
          size="8"
          aria-label={t('formRecognition.candidates')}
          value={selected()}
          onChange={e => setSelected(e.currentTarget.value)}
        >
          <For each={result()?.candidates || []}>
            {c => <option value={c.id}>{c.accepted ? '✓ ' : ''}{c.page}: {c.label} ({Math.round(c.confidence * 100)}%)</option>}
          </For>
        </select>
        <Show when={current()}>
          <div class="form-recognition-editor">
            <label>
              <input
                type="checkbox"
                checked={current().accepted}
                onChange={e => edit('accepted', e.currentTarget.checked)}
              />
              {t('formRecognition.accept')}
            </label>
            <label>
              {t('formRecognition.type')}
              <select value={current().type} onChange={e => edit('type', e.currentTarget.value)}>
                <For each={['text', 'checkbox', 'radio']}>
                  {v => <option value={v}>{t(`formRecognition.${v}`)}</option>}
                </For>
              </select>
            </label>
            <For each={['name', 'label']}>
              {key => <label>
                {t(`formRecognition.${key}`)}
                <input value={current()[key]} onInput={e => edit(key, e.currentTarget.value)} />
              </label>}
            </For>
            <label>
              <input
                type="checkbox"
                checked={current().required}
                onChange={e => edit('required', e.currentTarget.checked)}
              />
              {t('formRecognition.required')}
            </label>
            <Show when={current().type === 'radio'}>
              <For each={['group', 'groupLabel', 'option']}>
                {key => <label>
                  {t(`formRecognition.${key}`)}
                  <input value={current()[key] || ''} onInput={e => edit(key, e.currentTarget.value)} />
                </label>}
              </For>
            </Show>
            <label>
              {t('formRecognition.order')}
              <input
                type="text"
                inputmode="decimal"
                data-getal
                value={current().order}
                onInput={e => edit('order', leesGetal(e.currentTarget.value))}
              />
            </label>
            <p>{t('formRecognition.coordinates')}</p>
            <For each={['x', 'y', 'width', 'height']}>
              {key => <label>
                {t(`formRecognition.${key}`)}
                <input
                  type="text"
                  inputmode="decimal"
                  data-getal
                  value={Math.round(current().bounds[key] * 100) / 100}
                  onInput={e => editBound(key, e.currentTarget.value)}
                />
              </label>}
            </For>
          </div>
        </Show>
      </div>
      <div>
        <p>{preview() ? t('formRecognition.preview', { page: preview() }) : ''}</p>
        <canvas ref={canvas} aria-label={t('formRecognition.previewLabel')} />
      </div>
    </div>
  </Dialog>;
}
