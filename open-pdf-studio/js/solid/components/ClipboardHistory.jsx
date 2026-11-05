// Klembord-venster (#929), opslag: annotations/clipboard-history.js.
// Raster met de kopieen van deze sessie in een klein venster naast de
// gereedschapspalet. Een kopie aanklikken maakt hem het klembord en sluit het
// venster; Ctrl+V op het blad plakt hem dan bij de muis (#928).
// Het venster is verplaatsbaar via de titelbalk en sluit niet bij een klik
// erbuiten: alleen met de eigen x, de paletknop, Esc of door een kopie te kiezen.
import { Show, For, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  clipboardHistory, clipboardHistoryActive, useClipboardHistoryItem,
  removeClipboardHistoryItem, clearClipboardHistory,
} from '../../annotations/clipboard-history.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export const clipboardIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="2.5" width="10" height="12"/><path d="M6 2.5h4v2H6z"/><path d="M5.5 8h5M5.5 10.5h5"/></svg>`;
const closeSvg = `<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.2"/></svg>`;
const smallCloseSvg = `<svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

function itemLabel(t, item) {
  return item.count > 1 ? t('clipboardPalette.markups', { count: item.count }) : (item.label || '');
}

function ClipboardGrid(props) {
  const { t } = useTranslation('ribbon');
  return (
    <Show when={clipboardHistory().length > 0} fallback={<div class="clip-empty">{t('clipboardPalette.empty')}</div>}>
      <div class="clip-grid">
        <For each={clipboardHistory()}>
          {(item) => (
            <div
              class={`clip-item${clipboardHistoryActive() === item.id ? ' active' : ''}`}
              title={`${itemLabel(t, item)}\n${t('clipboardPalette.tip')}`}
              onClick={() => { if (useClipboardHistoryItem(item.id)) props.onPick?.(item); }}
            >
              <Show when={item.thumb} fallback={<div class="clip-thumb clip-nothumb">{itemLabel(t, item)}</div>}>
                <img class="clip-thumb" src={item.thumb} alt="" draggable={false} />
              </Show>
              <span class="clip-label">{itemLabel(t, item)}</span>
              <button class="clip-remove" title={t('clipboardPalette.remove')}
                onClick={(e) => { e.stopPropagation(); removeClipboardHistoryItem(item.id); }} innerHTML={smallCloseSvg} />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

// ── Venster naast de palet ───────────────────────────────────────────────
const [venster, setVenster] = createSignal(null); // { left, top } of null
export const clipboardWindowOpen = () => !!venster();
export function closeClipboardWindow() { setVenster(null); }

const BREEDTE = 250;
export function toggleClipboardWindow(knop) {
  if (venster()) { setVenster(null); return; }
  const r = knop?.getBoundingClientRect?.();
  if (!r) { setVenster({ left: 80, top: 120 }); return; }
  // Naast de palet, aan de kant met de meeste ruimte.
  const rechts = r.left < window.innerWidth / 2;
  const left = rechts ? r.right + 6 : r.left - 6 - BREEDTE;
  const top = Math.max(8, Math.min(r.top - 40, window.innerHeight - 380));
  setVenster({ left: Math.max(4, Math.min(left, window.innerWidth - BREEDTE - 4)), top });
}

export function ClipboardWindow() {
  const { t } = useTranslation('ribbon');
  let el;

  // Verplaatsen via de titelbalk (standaardcursor, geen verplaats-cursor).
  function startVerplaatsen(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const start = venster();
    if (!start) return;
    const sx = e.clientX, sy = e.clientY;
    const beweeg = (ev) => {
      const left = Math.max(0, Math.min(window.innerWidth - 40, start.left + ev.clientX - sx));
      const top = Math.max(0, Math.min(window.innerHeight - 30, start.top + ev.clientY - sy));
      setVenster({ left, top });
    };
    const los = () => {
      document.removeEventListener('mousemove', beweeg);
      document.removeEventListener('mouseup', los);
    };
    document.addEventListener('mousemove', beweeg);
    document.addEventListener('mouseup', los);
  }

  const esc = (e) => {
    if (e.key !== 'Escape' || !venster()) return;
    if (el && el.contains(e.target)) { e.stopPropagation(); setVenster(null); }
  };
  document.addEventListener('keydown', esc, true);
  onCleanup(() => document.removeEventListener('keydown', esc, true));

  const kies = () => {
    setVenster(null);
    updateStatusMessage(t('clipboardPalette.picked'));
  };

  return (
    <Show when={venster()}>
      {(pos) => (
        <Portal>
          <div class="clip-window" tabIndex={-1}
            ref={(r) => { el = r; queueMicrotask(() => r?.focus?.()); }}
            style={{ left: `${pos().left}px`, top: `${pos().top}px`, width: `${BREEDTE}px` }}>
            <div class="modal-header clip-window-header" onMouseDown={startVerplaatsen}>
              <span class="clip-window-title">{t('clipboardPalette.title')} ({clipboardHistory().length})</span>
              <Show when={clipboardHistory().length > 0}>
                <button class="clip-window-clear" title={t('clipboardPalette.clear')} onClick={clearClipboardHistory}>
                  {t('clipboardPalette.clearShort')}
                </button>
              </Show>
              <button class="modal-close-btn" title={t('clipboardPalette.close')} onClick={() => setVenster(null)} innerHTML={closeSvg} />
            </div>
            <div class="clip-window-hint">{t('clipboardPalette.tip')}</div>
            <ClipboardGrid onPick={kies} />
          </div>
        </Portal>
      )}
    </Show>
  );
}
