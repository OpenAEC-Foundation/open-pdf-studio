import { Show, For, createSignal, createMemo, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { annotProps, applyStyleType } from '../../stores/propertiesStore.js';
import { styleTypesFor } from '../../../annotations/style-types.js';
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

// Map an engine hatch-pattern id onto one of a few preview families.
function _hatchFamily(pattern = '') {
  const p = String(pattern);
  if (p === 'solid') return 'solid';
  if (p.includes('cross') || p.includes('isolatie')) return 'cross';
  if (p === 'grid' || p.includes('raster-l') === false && p.includes('grid')) return 'grid';
  if (p.includes('raster-liggend') || p.includes('horizontal') || p.includes('hout-langs')) return 'h';
  if (p.includes('raster-staand') || p.includes('vertical') || p.includes('verticaal')) return 'v';
  if (p.includes('dots') || p.includes('sand') || p.includes('concrete') || p.includes('grind') || p.includes('gravel')) return 'dots';
  if (p.includes('brick') || p.includes('tegel') || p.includes('plank') || p.includes('blok') || p.includes('lood') || p.includes('metselwerk') || p.includes('kunststeen')) return 'brick';
  if (p.includes('diagonal-right')) return 'diag-r';
  return 'diag'; // default: diagonal line work
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

  const hatchSvg = () => {
    const p = e().props || {};
    const bg = p.fillColor || 'transparent';
    const lc = p.hatchColor || e().color || '#000';
    const fam = _hatchFamily(p.hatchPattern);
    const lines = [];
    if (fam === 'diag' || fam === 'cross' || fam === 'diag-r') {
      for (let x = -H; x < W; x += 8) {
        lines.push(<line x1={x} y1={H} x2={x + H} y2={0} stroke={lc} stroke-width="1" />);
      }
    }
    if (fam === 'cross' || fam === 'diag-r') {
      for (let x = 0; x < W + H; x += 8) {
        lines.push(<line x1={x} y1={0} x2={x - H} y2={H} stroke={lc} stroke-width="1" />);
      }
    }
    if (fam === 'grid' || fam === 'h' || fam === 'brick') {
      for (let y = 4; y < H; y += 7) {
        lines.push(<line x1={0} y1={y} x2={W} y2={y} stroke={lc} stroke-width="1" />);
      }
    }
    if (fam === 'grid' || fam === 'v') {
      for (let x = 6; x < W; x += 9) {
        lines.push(<line x1={x} y1={0} x2={x} y2={H} stroke={lc} stroke-width="1" />);
      }
    }
    if (fam === 'brick') {
      let off = 0;
      for (let y = 4; y < H; y += 7) {
        for (let x = off; x < W; x += 14) {
          lines.push(<line x1={x} y1={y} x2={x} y2={Math.min(y + 7, H)} stroke={lc} stroke-width="1" />);
        }
        off = off === 0 ? 7 : 0;
      }
    }
    if (fam === 'dots') {
      for (let y = 5; y < H; y += 7) {
        for (let x = 6 + ((y % 14) ? 4 : 0); x < W; x += 9) {
          lines.push(<circle cx={x} cy={y} r="1" fill={lc} />);
        }
      }
    }
    if (fam === 'solid') {
      lines.push(<rect x="0" y="0" width={W} height={H} fill={lc} />);
    }
    return (
      <g>
        <rect x="0" y="0" width={W} height={H} fill={bg === 'transparent' ? 'var(--theme-bg, #fff)' : bg} />
        {lines}
      </g>
    );
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
    return list.filter((d) => d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
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
            <span style={{ flex: 1, 'font-size': '13px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{current().label}</span>
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
                    <span style={{ 'font-size': '13px', flex: 1, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{d.label}</span>
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
