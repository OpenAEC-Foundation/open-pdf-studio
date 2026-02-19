import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { recordAddWatermark, recordModifyWatermark } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function generateId() {
  return 'wm-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function refresh() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

export default function HeaderFooterDialog(props) {
  const editWm = props.data?.editWm || null;
  const isEditing = !!editWm;

  // Header text signals
  const [headerLeft, setHeaderLeft] = createSignal(editWm?.headerLeft || '');
  const [headerCenter, setHeaderCenter] = createSignal(
    isEditing ? (editWm.headerCenter || '') : '{page} of {pages}'
  );
  const [headerRight, setHeaderRight] = createSignal(editWm?.headerRight || '');

  // Footer text signals
  const [footerLeft, setFooterLeft] = createSignal(
    isEditing ? (editWm.footerLeft || '') : '{filename}'
  );
  const [footerCenter, setFooterCenter] = createSignal(editWm?.footerCenter || '');
  const [footerRight, setFooterRight] = createSignal(
    isEditing ? (editWm.footerRight || '') : '{date}'
  );

  // Font and style signals
  const [font, setFont] = createSignal(editWm?.fontFamily || 'Helvetica');
  const [fontSize, setFontSize] = createSignal(editWm?.fontSize || 10);
  const [color, setColor] = createSignal(editWm?.color || '#000000');

  // Margin signals
  const [marginTop, setMarginTop] = createSignal(editWm?.marginTop || 30);
  const [marginBottom, setMarginBottom] = createSignal(editWm?.marginBottom || 30);
  const [marginLeft, setMarginLeft] = createSignal(editWm?.marginLeft || 40);
  const [marginRight, setMarginRight] = createSignal(editWm?.marginRight || 40);

  // Page range signals
  const [pageRange, setPageRange] = createSignal(editWm?.pageRange || 'all');
  const [customPages, setCustomPages] = createSignal(editWm?.customPages || '');

  // Track last focused header/footer input for variable insertion
  let lastFocusedInput = null;

  // Signal-setter map for header/footer inputs so variable insertion can update signal
  const inputSetterMap = {
    'headerLeft': setHeaderLeft,
    'headerCenter': setHeaderCenter,
    'headerRight': setHeaderRight,
    'footerLeft': setFooterLeft,
    'footerCenter': setFooterCenter,
    'footerRight': setFooterRight,
  };
  let lastFocusedKey = null;

  const close = () => closeDialog('header-footer');

  function handleFocus(key, e) {
    lastFocusedInput = e.target;
    lastFocusedKey = key;
  }

  function insertVariable(varText) {
    if (!lastFocusedInput || !lastFocusedKey) return;
    const setter = inputSetterMap[lastFocusedKey];
    if (!setter) return;

    const input = lastFocusedInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value;
    const newVal = val.substring(0, start) + varText + val.substring(end);
    setter(newVal);

    // Restore focus and cursor position after the value updates
    requestAnimationFrame(() => {
      input.focus();
      const newPos = start + varText.length;
      input.setSelectionRange(newPos, newPos);
    });
  }

  function buildHeaderFooter() {
    return {
      id: editWm ? editWm.id : generateId(),
      type: 'headerFooter',
      headerLeft: headerLeft(),
      headerCenter: headerCenter(),
      headerRight: headerRight(),
      footerLeft: footerLeft(),
      footerCenter: footerCenter(),
      footerRight: footerRight(),
      fontFamily: font(),
      fontSize: parseInt(fontSize()) || 10,
      color: color(),
      marginTop: parseInt(marginTop()) || 30,
      marginBottom: parseInt(marginBottom()) || 30,
      marginLeft: parseInt(marginLeft()) || 40,
      marginRight: parseInt(marginRight()) || 40,
      pageRange: pageRange(),
      customPages: customPages(),
      enabled: true,
    };
  }

  function handleAdd() {
    const wm = buildHeaderFooter();

    if (isEditing) {
      const oldState = { ...editWm };
      const idx = state.watermarks.findIndex(w => w.id === editWm.id);
      if (idx !== -1) {
        Object.assign(state.watermarks[idx], wm);
        recordModifyWatermark(editWm.id, oldState, { ...state.watermarks[idx] });
      }
    } else {
      state.watermarks.push(wm);
      recordAddWatermark(wm);
    }

    markDocumentModified();
    refresh();
    close();
  }

  const footer = (
    <>
      <div class="watermark-footer-left"></div>
      <div class="watermark-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleAdd}>
          {isEditing ? 'Update' : 'Add'}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={isEditing ? 'Edit Header/Footer' : 'Add Header/Footer'}
      overlayClass="header-footer-overlay"
      dialogClass="header-footer-dialog"
      headerClass="header-footer-header"
      bodyClass="header-footer-content"
      footerClass="watermark-footer"
      onClose={close}
      footer={footer}
    >
      <div class="watermark-form">
        <div class="hf-section-label">Header</div>
        <div class="hf-row-triple">
          <div class="hf-field">
            <label>Left</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Left header"
              value={headerLeft()}
              onInput={(e) => setHeaderLeft(e.target.value)}
              onFocus={(e) => handleFocus('headerLeft', e)}
            />
          </div>
          <div class="hf-field">
            <label>Center</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Center header"
              value={headerCenter()}
              onInput={(e) => setHeaderCenter(e.target.value)}
              onFocus={(e) => handleFocus('headerCenter', e)}
            />
          </div>
          <div class="hf-field">
            <label>Right</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Right header"
              value={headerRight()}
              onInput={(e) => setHeaderRight(e.target.value)}
              onFocus={(e) => handleFocus('headerRight', e)}
            />
          </div>
        </div>

        <div class="hf-section-label">Footer</div>
        <div class="hf-row-triple">
          <div class="hf-field">
            <label>Left</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Left footer"
              value={footerLeft()}
              onInput={(e) => setFooterLeft(e.target.value)}
              onFocus={(e) => handleFocus('footerLeft', e)}
            />
          </div>
          <div class="hf-field">
            <label>Center</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Center footer"
              value={footerCenter()}
              onInput={(e) => setFooterCenter(e.target.value)}
              onFocus={(e) => handleFocus('footerCenter', e)}
            />
          </div>
          <div class="hf-field">
            <label>Right</label>
            <input
              type="text"
              class="hf-input"
              placeholder="Right footer"
              value={footerRight()}
              onInput={(e) => setFooterRight(e.target.value)}
              onFocus={(e) => handleFocus('footerRight', e)}
            />
          </div>
        </div>

        <div class="hf-variables">
          <label>Insert Variable:</label>
          <button class="hf-var-btn" onClick={() => insertVariable('{page}')}>{'{page}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{pages}')}>{'{pages}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{date}')}>{'{date}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{time}')}>{'{time}'}</button>
          <button class="hf-var-btn" onClick={() => insertVariable('{filename}')}>{'{filename}'}</button>
        </div>

        <div class="watermark-row">
          <label class="watermark-label">Font:</label>
          <select
            class="watermark-select"
            value={font()}
            onChange={(e) => setFont(e.target.value)}
          >
            <option value="Helvetica">Helvetica</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier">Courier</option>
          </select>
        </div>
        <div class="watermark-row">
          <label class="watermark-label">Font Size:</label>
          <input
            type="number"
            class="watermark-input watermark-input-sm"
            value={fontSize()}
            min="6"
            max="36"
            onInput={(e) => setFontSize(e.target.value)}
          />
        </div>
        <div class="watermark-row">
          <label class="watermark-label">Color:</label>
          <input
            type="color"
            class="watermark-color"
            value={color()}
            onInput={(e) => setColor(e.target.value)}
          />
        </div>

        <div class="hf-margins">
          <label class="watermark-label">Margins:</label>
          <div class="hf-margin-fields">
            <label>Top <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={marginTop()}
              min="0"
              onInput={(e) => setMarginTop(e.target.value)}
            /></label>
            <label>Bottom <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={marginBottom()}
              min="0"
              onInput={(e) => setMarginBottom(e.target.value)}
            /></label>
            <label>Left <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={marginLeft()}
              min="0"
              onInput={(e) => setMarginLeft(e.target.value)}
            /></label>
            <label>Right <input
              type="number"
              class="watermark-input watermark-input-sm"
              value={marginRight()}
              min="0"
              onInput={(e) => setMarginRight(e.target.value)}
            /></label>
          </div>
        </div>

        <div class="watermark-row">
          <label class="watermark-label">Pages:</label>
          <select
            class="watermark-select"
            value={pageRange()}
            onChange={(e) => setPageRange(e.target.value)}
          >
            <option value="all">All pages</option>
            <option value="first">First page only</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <Show when={pageRange() === 'custom'}>
          <div class="watermark-row hf-custom-pages">
            <label class="watermark-label">Range:</label>
            <input
              type="text"
              class="watermark-input"
              value={customPages()}
              placeholder="e.g. 1-5, 8"
              onInput={(e) => setCustomPages(e.target.value)}
            />
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
