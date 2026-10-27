import { Show, For, createSignal, createMemo, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { annotProps, applyStyleType } from '../../stores/propertiesStore.js';
import { styleTypesFor, styleTypeLabel } from '../../../annotations/style-types.js';
import { getHatchSwatchDataUrl, styleTypeSwatchParams } from '../../../annotations/rendering/hatch-patterns.js';
import { hatchSwatchColors } from './HatchPatternSection.jsx';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Generic STYLE TYPE picker — pinned at the TOP of the properties panel for
// every annotation kind with a preset list (maatlijnen, lijnen/pijlen,
// arceringen). Custom dropdown with a SEARCH box, a visual PREVIEW per type
// and an "Bewerken…" entry that opens the type editor.

// ── Per-kind preview swatch (small inline SVG) ─────────────────────────────
function _dashFor(style) {
  switch (style) {
    case 'dashed': return '7,4';
    case 'dotted': return '2,4';
    case 'dash-dot': return '9,4,2,4';
    case 'dash-dot-dot': return '9,4,2,4,2,4';
    case 'long-dash': return '14,5';
    default: return '';
  }
}

export function PreviewSwatch(props) {
  const W = 64, H = 24;
  const kind = () => props.annType;
  const e = () => props.entry;

  const lineSvg = () => {
    const lw = Math.min(6, Math.max(1, (e().props?.lineWidth ?? 1) * 1.6));
    const dash = _dashFor(e().props?.borderStyle);
    return (
      <line x1="4" y1={H / 2} x2={W - 4} y2={H / 2}
        stroke={e().color || '#000'} stroke-width={lw}
        stroke-dasharray={dash || undefined} stroke-linecap="round" />
    );
  };

  const dimSvg = () => {
    const c = e().color || '#000';
    return (
      <g stroke={c} fill="none" stroke-width="1.4">
        <line x1="8" y1={H - 6} x2={W - 8} y2={H - 6} />
        <circle cx="10" cy={H - 6} r="2.4" />
        <circle cx={W - 10} cy={H - 6} r="2.4" />
        <text x={W / 2} y={H - 9} font-size="9" text-anchor="middle"
          fill={c} stroke="none" font-family="Arial">123</text>
      </g>
    );
  };

  // Hatch preview: rendered by the SAME engine that paints the filled area
  // (pattern, colours, hatchScale and hatchAngle of the type), so the swatch
  // shows exactly what applying the type produces at 100% zoom.
  const hatchSvg = () => {
    const sp = styleTypeSwatchParams(e());
    let bg = sp.fill;
    let line = sp.line;
    if (!bg) {
      const theme = hatchSwatchColors(sp.line);
      bg = theme.bg;
      line = theme.line;
    }
    if (!sp.pattern) {
      return <rect x="0" y="0" width={W} height={H} fill={bg} />;
    }
    const url = getHatchSwatchDataUrl(sp.pattern, line, W, bg, {
      width: W, height: H, scale: sp.scale, angle: sp.angle,
      tint: sp.fill ? '' : sp.tint, border: false,
      pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    });
    return <image href={url} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />;
  };

  return (
    <svg width={W} height={H} style={{ border: '1px solid var(--theme-border, #999)', 'flex-shrink': 0, background: 'var(--theme-bg, #fff)' }}>
      <Show when={kind() === 'filledArea'} fallback={
        <Show when={kind() === 'measureDistance'} fallback={lineSvg()}>
          {dimSvg()}
        </Show>
      }>
        {hatchSvg()}
      </Show>
    </svg>
  );
}

// ── The picker ─────────────────────────────────────────────────────────────
export default function DimensionTypeSection() {
  const { t } = useTranslation('properties');
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [popupPos, setPopupPos] = createSignal({ x: 0, y: 0, w: 280 });
  let triggerRef;
  let searchRef;

  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  // Re-read on every open so editor changes show immediately.
  const types = createMemo(() => {
    void annotProps.type; void open();
    return styleTypesFor(annotProps.type);
  });
  const currentId = () => annotProps.styleType || annotProps.dimType || '';
  const current = () => (types() || []).find((x) => x.id === currentId()) || null;
  const filtered = () => {
    const q = query().toLowerCase().trim();
    const list = types() || [];
    if (!q) return list;
    return list.filter((d) => styleTypeLabel(d, t).toLowerCase().includes(q)
      || String(d.label || '').toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  };

  function openPopup() {
    if (isLocked()) return;
    const r = triggerRef?.getBoundingClientRect();
    if (r) setPopupPos({ x: r.left, y: r.bottom + 2, w: Math.max(280, r.width) });
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => searchRef?.focus());
  }

  const onDocDown = (ev) => {
    if (!open()) return;
    if (ev.target.closest?.('.style-type-popup') || ev.target.closest?.('.style-type-trigger')) return;
    setOpen(false);
  };
  const onDocKey = (ev) => { if (ev.key === 'Escape') setOpen(false); };
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onDocKey, true);
  onCleanup(() => {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
  });

  return (
    <Show when={types()}>
      <div class="property-group" id="prop-style-type"
        style={{ padding: '10px 12px', 'border-bottom': '1px solid var(--theme-border, #d4d4d4)', display: 'flex', 'align-items': 'center', gap: '8px' }}>
        <label style={{ margin: 0, 'white-space': 'nowrap', 'font-size': '13px', 'font-weight': 600, color: 'var(--theme-text, #333)' }}>{t('measurement.dimType') || 'Type'}</label>
        <div class="style-type-trigger" ref={triggerRef}
          onClick={openPopup}
          style={{
            flex: 1, display: 'flex', 'align-items': 'center', gap: '6px',
            border: '1px solid var(--theme-border, #888)', padding: '3px 6px', cursor: isLocked() ? 'default' : 'pointer',
            background: 'var(--theme-surface, #fff)', color: 'var(--theme-text, #000)', 'min-height': '28px',
          }}>
          <Show when={current()} fallback={<span style={{ flex: 1, 'font-size': '13px', opacity: 0.7 }}>{t('measurement.dimTypeCustom') || 'Aangepast'}</span>}>
            <PreviewSwatch annType={annotProps.type} entry={current()} />
            <span style={{ flex: 1, 'font-size': '13px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{styleTypeLabel(current(), t)}</span>
          </Show>
          <span style={{ 'font-size': '10px' }}>▼</span>
        </div>
      </div>

      <Show when={open()}>
        <Portal>
          <div class="style-type-popup" style={{
            position: 'fixed', left: `${popupPos().x}px`, top: `${popupPos().y}px`,
            width: `${popupPos().w}px`, 'max-height': '420px', 'z-index': 3000,
            background: 'var(--theme-surface, #f5f5f5)', color: 'var(--theme-text, #000)',
            border: '1px solid var(--theme-border, #7a7a7a)',
            'box-shadow': '3px 3px 8px rgba(0,0,0,0.3)', display: 'flex', 'flex-direction': 'column',
          }}>
            <input ref={searchRef} type="text" placeholder={t('measurement.searchType') || 'Zoeken…'}
              value={query()} onInput={(ev) => setQuery(ev.target.value)}
              style={{ margin: '6px', padding: '4px 6px', border: '1px solid var(--theme-border, #888)', 'font-size': '13px', background: 'var(--theme-surface, #fff)', color: 'var(--theme-text, #000)' }} />
            <div style={{ overflow: 'auto', flex: 1 }}>
              <For each={filtered()}>
                {(d) => (
                  <div
                    onClick={() => { applyStyleType(d.id); setOpen(false); }}
                    style={{
                      display: 'flex', 'align-items': 'center', gap: '8px',
                      padding: '4px 8px', cursor: 'pointer',
                      background: d.id === currentId() ? 'var(--theme-accent-soft, #cce4f7)' : 'transparent',
                    }}
                    onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--theme-accent-soft, #cce4f7)'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = d.id === currentId() ? 'var(--theme-accent-soft, #cce4f7)' : 'transparent'}
                  >
                    <PreviewSwatch annType={annotProps.type} entry={d} />
                    <span style={{ 'font-size': '13px', flex: 1, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{styleTypeLabel(d, t)}</span>
                  </div>
                )}
              </For>
              <Show when={filtered().length === 0}>
                <div style={{ padding: '10px', 'font-size': '12px', opacity: 0.7 }}>{t('measurement.noTypesFound')}</div>
              </Show>
            </div>
            <div style={{ 'border-top': '1px solid var(--theme-border, #bbb)', padding: '6px' }}>
              <button class="scale-btn" style={{ width: '100%' }}
                onClick={() => { setOpen(false); openDialog('style-type-editor', { annType: annotProps.type }); }}
              >{t('measurement.editTypes') || 'Bewerken…'}</button>
            </div>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}
