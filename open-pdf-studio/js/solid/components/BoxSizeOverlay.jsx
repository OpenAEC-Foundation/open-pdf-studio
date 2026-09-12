import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { annotProps, updateAnnotProp } from '../stores/propertiesStore.js';
import { state, getActiveDocument } from '../../core/state.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Temporary width/height "dimensions" for a selected rectangle — two small
// editable fields floating next to the selection. Values are in measured
// units (scale-region aware); typing a new value and pressing Enter resizes
// the rectangle (top-left anchored) through the normal property pipeline
// (undo + redraw included).
export default function BoxSizeOverlay() {
  const { t } = useTranslation('statusbar');
  const [pos, setPos] = createSignal(null); // { x, y } screen px
  const [wVal, setWVal] = createSignal('');
  const [hVal, setHVal] = createSignal('');
  const [unit, setUnit] = createSignal('mm');

  const selectedBox = () => {
    if (annotProps.multiCount > 0) return null;
    if (annotProps.type !== 'box') return null;
    if (annotProps.id === '__tool-defaults__') return null;
    const doc = getActiveDocument();
    const sel = doc?.selectedAnnotations || [];
    return sel.length === 1 && sel[0].type === 'box' ? sel[0] : null;
  };

  const ppu = (ann) => {
    const ms = getMeasureScale(ann.page, ann.x + ann.width / 2, ann.y + ann.height / 2);
    return { ppu: ms.pixelsPerUnit || 1, unit: ms.unit || 'mm' };
  };

  function refreshValues() {
    const ann = selectedBox();
    if (!ann) return;
    const { ppu: k, unit: u } = ppu(ann);
    setUnit(u);
    setWVal(String(Math.round((ann.width / k) * 100) / 100));
    setHVal(String(Math.round((ann.height / k) * 100) / 100));
  }

  function reposition() {
    const ann = selectedBox();
    if (!ann) { setPos(null); return; }
    const doc = getActiveDocument();
    if (doc?.viewMode === 'continuous') { setPos(null); return; } // v1: single-page only
    const canvas = document.getElementById('annotation-canvas');
    if (!canvas) { setPos(null); return; }
    const rect = canvas.getBoundingClientRect();
    const vp = window.__pdfViewport;
    let sx, sy;
    if (vp && vp.active && doc?.filePath) {
      sx = rect.left + (ann.x + ann.width) * vp.zoom + vp.offsetX;
      sy = rect.top + ann.y * vp.zoom + vp.offsetY;
    } else {
      const scale = doc?.scale || 1.5;
      sx = rect.left + (ann.x + ann.width) * scale;
      sy = rect.top + ann.y * scale;
    }
    setPos({ x: sx + 10, y: Math.max(8, sy) });
  }

  // Track selection + viewport: light polling keeps the badge glued to the
  // box across zoom/pan/move without threading through every render path.
  createEffect(() => {
    void annotProps.id; void annotProps.type; void annotProps.multiCount;
    refreshValues();
    reposition();
  });
  const timer = setInterval(() => { if (selectedBox()) { reposition(); } }, 250);
  onCleanup(() => clearInterval(timer));

  function commit(which, raw) {
    const ann = selectedBox();
    if (!ann || ann.locked) return;
    const v = parseFloat(String(raw).replace(',', '.'));
    if (!isFinite(v) || v <= 0) { refreshValues(); return; }
    const { ppu: k } = ppu(ann);
    const px = v * k;
    updateAnnotProp(which, px); // undo + redraw via the standard pipeline
    refreshValues();
    reposition();
  }

  // Select the field's text on the focusing click so a new value can be typed
  // immediately. WebView2/Chromium otherwise collapses the selection on mouseup;
  // guard the first click, while later clicks still place the caret normally.
  let _selectOnClick = false;
  const onDimFocus = (e) => { _selectOnClick = true; e.currentTarget.select(); };
  const onDimMouseUp = (e) => { if (_selectOnClick) { e.preventDefault(); _selectOnClick = false; } };

  const inputStyle = {
    width: '64px',
    'font-size': '12px',
    padding: '2px 4px',
    border: '1px solid #888',
    background: 'var(--theme-bg, #fff)',
    color: 'var(--theme-text, #000)',
  };

  return (
    <Show when={selectedBox() && pos()}>
      <div style={{
        position: 'fixed',
        left: `${pos().x}px`,
        top: `${pos().y}px`,
        'z-index': 1500,
        background: 'var(--theme-panel-bg, #f5f5f5)',
        border: '1px solid #7a7a7a',
        'box-shadow': '2px 2px 6px rgba(0,0,0,0.25)',
        padding: '6px 8px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        'font-size': '12px',
      }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
          <span style={{ width: '14px', 'font-weight': 600 }}>{t('boxWidthAbbr')}</span>
          <input style={inputStyle} value={wVal()}
            onFocus={onDimFocus} onMouseUp={onDimMouseUp}
            onInput={(e) => setWVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit('width', wVal()); e.stopPropagation(); }}
            onBlur={() => refreshValues()} />
          <span>{unit()}</span>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
          <span style={{ width: '14px', 'font-weight': 600 }}>{t('boxHeightAbbr')}</span>
          <input style={inputStyle} value={hVal()}
            onFocus={onDimFocus} onMouseUp={onDimMouseUp}
            onInput={(e) => setHVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit('height', hVal()); e.stopPropagation(); }}
            onBlur={() => refreshValues()} />
          <span>{unit()}</span>
        </div>
      </div>
    </Show>
  );
}
