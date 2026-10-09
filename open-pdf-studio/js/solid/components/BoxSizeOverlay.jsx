import { Show, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { annotProps, updateAnnotProp } from '../stores/propertiesStore.js';
import { state, getActiveDocument } from '../../core/state.js';
import { getMeasureScale } from '../../annotations/measurement.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { klemMaat } from '../../annotations/minimummaat.js';
import { beginUndoTransaction, endUndoTransaction } from '../../core/undo-manager.js';
import { paginaRectNaarClient } from '../../pdf/weergave-ruimte.js';

// Floating width/height "dimensions" for a selected shape — two small
// editable fields floating next to the selection. Values are in measured
// units (scale-region aware); typing a new value and pressing Enter OR
// leaving the field (Tab, clicking the canvas/ribbon) applies the resize
// through the normal property pipeline (undo + redraw included).
//
// Vormen: box (rechthoek), circle (cirkel/ellips) en polygon. Een polylijn
// (L-vorm) zit er bewust níét in: daar is x/y/width/height alleen een
// afgeleide bounding box en zou alleen de maat wijzigen de punten
// desynchroniseren.
const MAAT_VORMEN = new Set(['box', 'circle', 'polygon']);

export default function BoxSizeOverlay() {
  const { t } = useTranslation('statusbar');
  const [pos, setPos] = createSignal(null); // { x, y } screen px
  const [wVal, setWVal] = createSignal('');
  const [hVal, setHVal] = createSignal('');
  const [unit, setUnit] = createSignal('mm');
  // Wat er in een veld staat is gewijzigd t.o.v. het model: pas bij Enter,
  // focuswissel of klik buitenuit wordt het doorgerekend. Zo voorkomt een
  // blur zonder wijziging een onnodige undo-stap.
  const [wDirty, setWDirty] = createSignal(false);
  const [hDirty, setHDirty] = createSignal(false);

  const selectedBox = () => {
    if (annotProps.multiCount > 0) return null;
    if (!MAAT_VORMEN.has(annotProps.type)) return null;
    if (annotProps.id === '__tool-defaults__') return null;
    const doc = getActiveDocument();
    const sel = doc?.selectedAnnotations || [];
    return sel.length === 1 && MAAT_VORMEN.has(sel[0].type) ? sel[0] : null;
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
    // Zes significante cijfers in plaats van twee decimalen: bij eenheid "m"
    // was twee decimalen (10 mm) te grof om een kleine maat te tonen.
    const toon = (n) => (Number.isFinite(n) ? String(Number(n.toPrecision(6))) : '');
    setWVal(toon(ann.width / k));
    setHVal(toon(ann.height / k));
    // Model is weer leidend: geen openstaande wijziging meer.
    setWDirty(false);
    setHDirty(false);
  }

  function reposition() {
    const ann = selectedBox();
    if (!ann) { setPos(null); return; }
    const doc = getActiveDocument();
    if (doc?.viewMode === 'continuous') { setPos(null); return; } // v1: single-page only
    // Rechts naast het vak zoals het op het scherm staat: via de centrale
    // omrekening, zodat ook een gedraaide weergave (#200) klopt.
    const opScherm = paginaRectNaarClient(ann.page ?? doc?.currentPage ?? 1,
      { x: ann.x, y: ann.y, width: ann.width, height: ann.height }, doc);
    if (!opScherm) { setPos(null); return; }
    const sx = opScherm.left + opScherm.width;
    const sy = opScherm.top;
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
    if (!ann || ann.locked) { setWDirty(false); setHDirty(false); return; }
    const v = parseFloat(String(raw).replace(',', '.'));
    if (!isFinite(v) || v <= 0) { refreshValues(); return; }
    const { ppu: k } = ppu(ann);
    // Elke positieve waarde mag; alleen de technische ondergrens geldt.
    const px = klemMaat(v * k);
    if (ann.type === 'box') {
      updateAnnotProp(which, px);
    } else if (ann.type === 'circle') {
      // Cirkel (w ≈ h) blijft rond: beide maten gelijk. Een ellips (w ≠ h)
      // beweegt alleen de bewerkte as.
      const rond = Math.abs(ann.width - ann.height)
        <= Math.max(1e-6, 0.01 * Math.min(ann.width, ann.height));
      if (rond) {
        // Eén undo-stap voor beide maten.
        beginUndoTransaction();
        updateAnnotProp('width', px);
        updateAnnotProp('height', px);
        endUndoTransaction();
      } else {
        updateAnnotProp(which, px);
      }
    } else if (ann.type === 'polygon') {
      // Reguliere veelhoek: pas beide assen met dezelfde factor aan, zodat
      // de verhouding (en dus de vorm) bewaard blijft.
      const oude = which === 'width' ? ann.width : ann.height;
      const ander = which === 'width' ? ann.height : ann.width;
      const factor = oude > 0 ? px / oude : 1;
      beginUndoTransaction();
      updateAnnotProp(which, px);
      updateAnnotProp(which === 'width' ? 'height' : 'width', klemMaat(ander * factor));
      endUndoTransaction();
    } else {
      updateAnnotProp(which, px); // undo + redraw via the standard pipeline
    }
    setWDirty(false);
    setHDirty(false);
    refreshValues();
    reposition();
  }

  // Klik buiten het badge (canvas, ribbon, paneel) terwijl er een
  // openstaande wijziging is: DAN toepassen — vóór de deselectie die de
  // pointerdown op het canvas veroorzaakt, want daarna is de selectie weg
  // en zou de ingetypte maat verdwijnen. Capture-fase draait vóór elke
  // andere pointerdown-handler.
  const buitenPointer = (e) => {
    if (e.target && typeof e.target.closest === 'function'
        && e.target.closest('[data-maat-badge]')) return;
    if (wDirty()) commit('width', wVal());
    else if (hDirty()) commit('height', hVal());
  };
  onMount(() => document.addEventListener('pointerdown', buitenPointer, true));
  onCleanup(() => document.removeEventListener('pointerdown', buitenPointer, true));

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
  const hint = t('boxSizeHint', 'Type a value + Enter — or click away to apply');

  return (
    <Show when={selectedBox() && pos()}>
      <div data-maat-badge style={{
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
          <input style={inputStyle} value={wVal()} title={hint}
            onFocus={onDimFocus} onMouseUp={onDimMouseUp}
            onInput={(e) => { setWVal(e.target.value); setWDirty(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit('width', wVal());
              else if (e.key === 'Escape') { refreshValues(); e.currentTarget.blur(); }
              e.stopPropagation();
            }}
            onBlur={() => { if (wDirty()) commit('width', wVal()); }} />
          <span>{unit()}</span>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '4px' }}>
          <span style={{ width: '14px', 'font-weight': 600 }}>{t('boxHeightAbbr')}</span>
          <input style={inputStyle} value={hVal()} title={hint}
            onFocus={onDimFocus} onMouseUp={onDimMouseUp}
            onInput={(e) => { setHVal(e.target.value); setHDirty(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit('height', hVal());
              else if (e.key === 'Escape') { refreshValues(); e.currentTarget.blur(); }
              e.stopPropagation();
            }}
            onBlur={() => { if (hDirty()) commit('height', hVal()); }} />
          <span>{unit()}</span>
        </div>
      </div>
    </Show>
  );
}
