import { createSignal, createEffect, createMemo, untrack, onMount, onCleanup, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { getActiveDocument } from '../../../core/state.js';
import { openSymbolSearch, acceptSymbolMatches, navigateSymbolMatch } from '../../../search/symbol-search-service.js';
import { countCategories, activeCountCategoryId } from '../../stores/countStore.js';

export default function SymbolSearchDialog() {
  const { t } = useTranslation('dialogs'),
    documentId = getActiveDocument()?.id;
  const [session, setSession] = createSignal(null),
    [templatePage, setTemplatePage] = createSignal(getActiveDocument()?.currentPage || 1),
    [rect, setRect] = createSignal({ x: 20, y: 20, width: 30, height: 30 }),
    [pages, setPages] = createSignal(String(getActiveDocument()?.currentPage || 1)),
    [threshold, setThreshold] = createSignal(.75),
    [minScore, setMinScore] = createSignal(''),
    [excluded, setExcluded] = createSignal([]),
    [rotate, setRotate] = createSignal(false),
    [scaleTolerance, setScaleTolerance] = createSignal(false),
    [category, setCategory] = createSignal(activeCountCategoryId()),
    [result, setResult] = createSignal(null),
    [selected, setSelected] = createSignal(''),
    [accepted, setAccepted] = createSignal(new Set()),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [status, setStatus] = createSignal('');
  let canvas,
    renderScale = 1,
    drag = null,
    token = 0,
    controller,
    closed = false;
  const close = () => closeDialog('symbol-search');
  onCleanup(() => {
    closed = true;
    token++;
    controller?.abort();
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
  onMount(() => run(async () => setSession(await openSymbolSearch(documentId))));
  const match = () => result()?.matches.find(m => m.id === selected());
  // What the preview shows: the template or the selected match, with the
  // excluded areas and the legend/title block found on that page (#1131).
  const view = createMemo(() => {
    const page = match()?.page || templatePage();
    return JSON.stringify({
      page,
      bounds: match()?.bounds || rect(),
      excluded: excluded().filter(r => r.page === page),
      detected: (result()?.detectedRegions || []).filter(r => r.page === page).map(r => r.bounds)
    });
  });
  createEffect(() => {
    const s = session(),
      v = JSON.parse(view());
    if (!s || !canvas) return;
    const current = ++token;
    (async () => {
      const tmp = document.createElement('canvas');
      try {
        const r = await untrack(() => s.render(v.page, tmp));
        if (current !== token || closed) return;
        renderScale = r.scale;
        canvas.width = tmp.width;
        canvas.height = tmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tmp, 0, 0);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        for (const [list, colour] of [[v.detected, '#0066cc'], [v.excluded, '#c00000']]) {
          ctx.strokeStyle = colour;
          for (const r of list) ctx.strokeRect(r.x * renderScale, r.y * renderScale, r.width * renderScale, r.height * renderScale);
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ff8500';
        ctx.lineWidth = 3;
        ctx.strokeRect(v.bounds.x * renderScale, v.bounds.y * renderScale, v.bounds.width * renderScale, v.bounds.height * renderScale);
      } catch (e) {
        if (current === token && !closed) setError(e.message);
      } finally {
        tmp.width = 0;
        tmp.height = 0;
      }
    })();
  });
  const point = e => {
    const b = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - b.left) * canvas.width / b.width / renderScale,
      y: (e.clientY - b.top) * canvas.height / b.height / renderScale
    };
  };
  const search = () => run(async () => {
    const list = [];
    for (const part of pages().split(',')) {
      const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
      if (!m) throw new Error('INVALID_PAGES');
      const a = Number(m[1]),
        b = Number(m[2] || m[1]);
      if (b < a || b - a > 19) throw new Error('INVALID_PAGES');
      for (let p = a; p <= b; p++) list.push(p);
    }
    // An empty field means no check limit; anything else must be a number.
    const limit = minScore() === '' ? undefined : leesGetal(minScore());
    controller = new AbortController();
    const r = await session().search({
      templatePage: templatePage(),
      rect: rect(),
      pages: [...new Set(list)],
      threshold: threshold(),
      rotations: rotate() ? [0, 90, 180, 270] : [0],
      scales: scaleTolerance() ? [.8, 1, 1.2] : [1],
      excludeRegions: excluded(),
      minScore: limit
    }, { signal: controller.signal, onProgress: p => setStatus(`${Math.round(p.fraction * 100)}%`) });
    if (closed) return;
    setResult(r);
    setAccepted(new Set());
    setSelected(r.matches[0]?.id || '');
    setStatus(r.summary.review || r.summary.excluded
      ? t('symbolSearch.foundReview', { count: r.matches.length, review: r.summary.review, excluded: r.summary.excluded })
      : t('symbolSearch.found', { count: r.matches.length }));
  });
  // The drawn rectangle becomes an area the next search leaves out.
  const excludeArea = () => {
    const r = rect();
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) {
      setError('INVALID_REGIONS');
      return;
    }
    setError('');
    setExcluded(list => [...list, { page: templatePage(), ...r }].slice(-50));
    setStatus(t('symbolSearch.excludedAdded', { count: excluded().length }));
  };
  const acceptSafe = () => setAccepted(new Set(result().matches.filter(m => !m.review).map(m => m.id)));
  const apply = () => run(async () => {
    const cat = countCategories().find(c => c.id === category());
    const r = await acceptSymbolMatches(result().queryId, [...accepted()], cat);
    setStatus(t('symbolSearch.created', { count: r.createdIds.length, skipped: r.skipped }));
  });
  return <Dialog
    title={t('symbolSearch.title')}
    dialogClass="symbol-search-dialog"
    onClose={close}
    footer={<>
      <button class="pref-btn" disabled={busy() || !accepted().size} onClick={apply}>
        {t('symbolSearch.create')}
      </button>
      <button class="pref-btn" onClick={close}>{t('symbolSearch.close')}</button>
    </>}
  >
    <p>{t('symbolSearch.info')}</p>
    <Show when={error()}>
      <p role="alert">{t(`symbolSearch.errors.${error()}`, { defaultValue: error() })}</p>
    </Show>
    <div class="symbol-search-controls">
      <label>
        {t('symbolSearch.templatePage')}
        <input
          type="text"
          inputmode="decimal"
          data-getal
          value={templatePage()}
          onChange={e => {
            setSelected('');
            setTemplatePage(leesGetal(e.currentTarget.value));
          }}
        />
      </label>
      <label>
        {t('symbolSearch.pages')}
        <input value={pages()} onInput={e => setPages(e.currentTarget.value)} />
      </label>
      <label>
        {t('symbolSearch.threshold')}
        <input
          type="text"
          inputmode="decimal"
          data-getal
          value={threshold()}
          onChange={e => setThreshold(leesGetal(e.currentTarget.value))}
        />
      </label>
      <label>
        <input type="checkbox" checked={rotate()} onChange={e => setRotate(e.currentTarget.checked)} />
        {t('symbolSearch.rotate')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={scaleTolerance()}
          onChange={e => setScaleTolerance(e.currentTarget.checked)}
        />
        {t('symbolSearch.scale')}
      </label>
      <button class="pref-btn" disabled={busy() || !session()} onClick={search}>
        {t('symbolSearch.search')}
      </button>
      <Show when={busy()}>
        <button class="pref-btn" onClick={() => controller?.abort()}>{t('symbolSearch.cancel')}</button>
      </Show>
    </div>
    <div class="symbol-search-controls">
      <For each={['x', 'y', 'width', 'height']}>
        {key => <label>
          {t(`symbolSearch.${key}`)}
          <input
            type="text"
            inputmode="decimal"
            data-getal
            value={rect()[key]}
            onChange={e => {
              setSelected('');
              setRect(r => ({ ...r, [key]: leesGetal(e.currentTarget.value) }));
            }}
          />
        </label>}
      </For>
      <button class="pref-btn" onClick={() => setSelected('')}>{t('symbolSearch.template')}</button>
      <label>
        {t('symbolSearch.category')}
        <select value={category()} onChange={e => setCategory(e.currentTarget.value)}>
          <For each={countCategories()}>{cat => <option value={cat.id}>{cat.name}</option>}</For>
        </select>
      </label>
    </div>
    <p>{t('symbolSearch.reviewInfo')}</p>
    <div class="symbol-search-controls">
      <label>
        {t('symbolSearch.minScore')}
        <input
          type="text"
          inputmode="decimal"
          data-getal
          value={minScore()}
          onChange={e => setMinScore(e.currentTarget.value.trim())}
        />
      </label>
      <button class="pref-btn" disabled={busy() || !!selected()} onClick={excludeArea}>
        {t('symbolSearch.excludeArea')}
      </button>
      <Show when={excluded().length}>
        <button class="pref-btn" disabled={busy()} onClick={() => setExcluded([])}>
          {t('symbolSearch.clearExcluded', { count: excluded().length })}
        </button>
      </Show>
      <Show when={result()?.matches.length}>
        <button class="pref-btn" disabled={busy()} onClick={acceptSafe}>
          {t('symbolSearch.acceptSafe', { count: result()?.summary.safe })}
        </button>
      </Show>
    </div>
    <p role="status">{status()}</p>
    <Show when={result()?.truncated}><p>{t('symbolSearch.truncated')}</p></Show>
    <div class="symbol-search-grid">
      <div>
        <select
          size="10"
          aria-label={t('symbolSearch.results')}
          value={selected()}
          onChange={e => setSelected(e.currentTarget.value)}
        >
          <For each={result()?.matches || []}>
            {m => <option value={m.id}>
              {accepted().has(m.id) ? '✓ ' : ''}
              {t(m.review ? 'symbolSearch.resultReview' : 'symbolSearch.result', { page: m.page, score: Math.round(m.score * 100) })}
            </option>}
          </For>
        </select>
        <Show when={match()}>
          <label>
            <input
              type="checkbox"
              checked={accepted().has(selected())}
              onChange={e => {
                const next = new Set(accepted());
                if (e.currentTarget.checked) next.add(selected());
                else next.delete(selected());
                setAccepted(next);
              }}
            />
            {t('symbolSearch.accept')}
          </label>
          <button
            class="pref-btn"
            disabled={busy()}
            onClick={() => run(async () => {
              await navigateSymbolMatch(result().queryId, selected());
              close();
            })}
          >
            {t('symbolSearch.navigate')}
          </button>
          <p>{t('symbolSearch.page', { page: match().page })}</p>
          <Show when={match()?.review}>
            <p>
              {t('symbolSearch.reviewWhy', {
                reasons: (match()?.reviewReasons || []).map(reason => t(`symbolSearch.reasons.${reason}`)).join(', ')
              })}
            </p>
          </Show>
        </Show>
      </div>
      <canvas
        ref={canvas}
        aria-label={t('symbolSearch.canvas')}
        onPointerDown={e => {
          if (selected() || busy()) return;
          drag = point(e);
          canvas.setPointerCapture(e.pointerId);
        }}
        onPointerUp={e => {
          if (!drag) return;
          const end = point(e);
          setRect({
            x: Math.round(Math.min(drag.x, end.x) * 100) / 100,
            y: Math.round(Math.min(drag.y, end.y) * 100) / 100,
            width: Math.round(Math.abs(end.x - drag.x) * 100) / 100,
            height: Math.round(Math.abs(end.y - drag.y) * 100) / 100
          });
          drag = null;
          canvas.releasePointerCapture(e.pointerId);
        }}
      />
    </div>
  </Dialog>;
}
