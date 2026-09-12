import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import { state } from '../../core/state.js';
import { filledAreaSketch } from '../../tools/tools/filled-area-tool.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Floating sketch toolbar for the filled-area tool — makes the existing
// sketch machinery VISIBLE: line/arc segments, close-contour with the
// >=3-points check, donut openings (holes phase), undo the last point, and
// an explicit "Done" that commits and leaves the mode. Mirrors the keyboard
// flow ('A' = arc, Backspace = undo point, click near start point = close,
// Enter = done, Esc = cancel).

const BTN = 'padding:3px 10px;font-size:11px;font-family:inherit;border:1px solid var(--theme-border,#888);background:var(--theme-surface,#fff);color:var(--theme-text,#333);cursor:pointer;border-radius:0';
const BTN_ACTIVE = BTN + ';background:var(--theme-accent-soft,#cce4f7);box-shadow:inset 0 0 0 1px var(--theme-active,#0078d7)';

export default function SketchModeBar() {
  const { t } = useTranslation('statusbar');
  const [snap, setSnap] = createSignal({ visible: false });

  // Poll tool state (same pattern as BoxSizeOverlay) — the drawing state
  // lives in plain module state, not a Solid store.
  let timer = null;
  onMount(() => {
    timer = setInterval(() => {
      const visible = state.currentTool === 'filledArea' && filledAreaSketch.isActive();
      setSnap(visible ? { visible: true, ...filledAreaSketch.status() } : { visible: false });
    }, 150);
  });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const s = () => snap();
  const closeEnabled = () => (s().points || 0) >= 3;
  const finishEnabled = () => s().outerClosed || (s().points || 0) >= 3;
  const undoEnabled = () => (s().points || 0) > 0;
  const statusText = () => {
    const st = s();
    if (st.phase === 'holes') {
      const cur = st.points > 0 ? t('filledAreaSketch.drawingHole', { count: st.points }) : '';
      return t('filledAreaSketch.outerClosed', { count: st.holes }) + cur;
    }
    return st.points >= 3
      ? t('filledAreaSketch.outerOpenClosable', { count: st.points })
      : t('filledAreaSketch.outerOpen', { count: st.points });
  };

  return (
    <Show when={s().visible}>
      <div style={{
        position: 'fixed',
        left: '50%',
        bottom: '46px',
        transform: 'translateX(-50%)',
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        padding: '5px 8px',
        background: 'var(--theme-surface, #f5f5f5)',
        color: 'var(--theme-text, #333)',
        border: '1px solid var(--theme-border, #7a7a7a)',
        'box-shadow': '2px 2px 6px rgba(0,0,0,0.3)',
        'z-index': 1500,
        'font-size': '11px',
        'user-select': 'none',
      }}>
        <span style={{ opacity: 0.8, 'margin-right': '4px', 'white-space': 'nowrap' }}>{statusText()}</span>
        <button style={!s().arcMode ? BTN_ACTIVE : BTN} title={t('filledAreaSketch.lineTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.setArcMode(false)}>{t('filledAreaSketch.line')}</button>
        <button style={s().arcMode ? BTN_ACTIVE : BTN} title={t('filledAreaSketch.arcTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.setArcMode(true)}>{t('filledAreaSketch.arc')}</button>
        <button style={BTN + (undoEnabled() ? '' : ';opacity:0.45;cursor:default')}
          title={t('filledAreaSketch.undoPointTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => undoEnabled() && filledAreaSketch.undoLastPoint()}>
          ↩ {t('filledAreaSketch.undoPoint')}
        </button>
        <button style={BTN + (closeEnabled() ? '' : ';opacity:0.45;cursor:default')}
          title={s().phase === 'holes' ? t('filledAreaSketch.closeHoleTitle') : t('filledAreaSketch.closeOuterTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => closeEnabled() && filledAreaSketch.closeLoop()}>
          {s().phase === 'holes' ? t('filledAreaSketch.closeHole') : t('filledAreaSketch.closeOuter')}
        </button>
        <button style={BTN + (finishEnabled() ? ';font-weight:600' : ';opacity:0.45;cursor:default')}
          title={t('filledAreaSketch.doneTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => finishEnabled() && filledAreaSketch.finish()}>✓ {t('filledAreaSketch.done')}</button>
        <button style={BTN} title={t('filledAreaSketch.cancelTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => filledAreaSketch.cancel()}>✕</button>
      </div>
    </Show>
  );
}
