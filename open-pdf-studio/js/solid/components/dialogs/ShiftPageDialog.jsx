import { createSignal, onMount, Show, untrack } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument, getPageRotation } from '../../../core/state.js';
import {
  MAX_SHIFT_MM, MM_TO_POINTS, parseFromPageInput, parseShiftInput, previewLayout,
} from '../../../pdf/shift-page-geometry.js';

const PREVIEW_MAX_WIDTH = 260;
const PREVIEW_MAX_HEIGHT = 400;
// The shared 80px label column wraps "Horizontal (mm):" onto two lines, and
// most translations are longer still.
const LABEL_STYLE = { width: '130px' };

export default function ShiftPageDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;
  const currentPage = props.data?.currentPage || 1;

  const [dxMm, setDxMm] = createSignal(0);
  const [dyMm, setDyMm] = createSignal(0);
  const [applyTo, setApplyTo] = createSignal('current');
  // "All pages" means the whole document, as in the sibling dialogs (Crop,
  // Straighten, Resize); a later start page is something the user opts into.
  const [fromPage, setFromPage] = createSignal(1);

  let previewBoxRef;
  let previewImgRef;
  let dxInputRef;
  let dyInputRef;
  let pxPerMm = 1;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartDx = 0;
  let dragStartDy = 0;

  const applyPreviewTransform = () => {
    if (!previewImgRef) return;
    previewImgRef.style.transform = `translate(${dxMm() * pxPerMm}px, ${-dyMm() * pxPerMm}px)`;
  };

  // The number fields are NOT bound to the signals: a bound field is
  // rewritten on every keystroke, and the "" a number input reports after a
  // typed "-" came back as "0", turning -5 into 5. The fields are written only
  // when the value changes from outside the field (drag, reset) or on commit.
  const writeFields = () => {
    if (dxInputRef) dxInputRef.value = String(dxMm());
    if (dyInputRef) dyInputRef.value = String(dyMm());
  };

  const reset = () => {
    setDxMm(0);
    setDyMm(0);
    writeFields();
    applyPreviewTransform();
  };

  onMount(async () => {
    try {
      // The page as displayed: its own /Rotate plus the in-app rotation.
      const page = await getActiveDocument().pdfDoc.getPage(currentPage);
      const rotation = (page.rotate + (getPageRotation(currentPage) || 0)) % 360;
      const visual = page.getViewport({ scale: 1, rotation });
      const layout = previewLayout(
        visual.width, visual.height, PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT, window.devicePixelRatio,
      );
      // Size the box before the render, so the dialog does not grow afterwards.
      if (previewBoxRef) {
        previewBoxRef.style.width = layout.width + 'px';
        previewBoxRef.style.height = layout.height + 'px';
      }
      // layout.width px represents the page's visual width in points; convert to mm.
      pxPerMm = layout.width / (visual.width / MM_TO_POINTS);

      const { renderPageOffscreen } = await import('../../../pdf/exporter.js');
      const canvas = await renderPageOffscreen(currentPage, layout.scale);
      if (previewImgRef) {
        previewImgRef.src = canvas.toDataURL('image/png');
        previewImgRef.style.width = layout.width + 'px';
        previewImgRef.style.height = layout.height + 'px';
      }
      applyPreviewTransform();
    } catch (e) {
      console.warn('Shift page preview failed:', e?.message || e);
    }
  });

  const onPointerDown = (e) => {
    if (e.button !== 0) return; // left button only
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartDx = dxMm();
    dragStartDy = dyMm();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dxPx = e.clientX - dragStartX;
    const dyPx = e.clientY - dragStartY;
    setDxMm(parseShiftInput(Math.round((dragStartDx + dxPx / pxPerMm) * 10) / 10));
    setDyMm(parseShiftInput(Math.round((dragStartDy - dyPx / pxPerMm) * 10) / 10));
    writeFields();
    applyPreviewTransform();
  };

  const onPointerUp = () => {
    dragging = false;
  };

  const close = () => closeDialog('shift-page');

  const handleApply = async () => {
    const dx = dxMm();
    const dy = dyMm();
    const applyToVal = applyTo();
    const fromVal = Math.max(1, Math.min(fromPage() || 1, totalPages));
    close();

    try {
      const { shiftPages } = await import('../../../pdf/shift-page.js');
      const result = await shiftPages(dx, dy, applyToVal, fromVal);
      if (!result.shifted) {
        showMessage(t(result.reason === 'no-pages' ? 'shiftPage.noPages' : 'shiftPage.noShift'));
      }
    } catch (e) {
      // The dialog is already closed: without a message the user would see
      // the loading overlay vanish and nothing else.
      console.warn('Shift page failed:', e?.message || e);
      showMessage(t(e?.code === 'encrypted' ? 'shiftPage.encrypted' : 'shiftPage.failed'));
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleApply}>{t('shiftPage.apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('shiftPage.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-info">{t('shiftPage.dragInfo')}</div>

        <div style={{ display: 'flex', 'justify-content': 'center', padding: '8px 0' }}>
          <div
            ref={previewBoxRef}
            style={{
              position: 'relative',
              overflow: 'hidden',
              border: '1px solid var(--theme-border, #d4d4d4)',
              background: 'var(--theme-bg, #f5f5f5)',
              'touch-action': 'none',
              'user-select': 'none',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img ref={previewImgRef} draggable={false} style={{ position: 'absolute', top: 0, left: 0, 'pointer-events': 'none' }} />
          </div>
        </div>

        <div class="crop-margins-row">
          <label class="crop-margins-label" style={LABEL_STYLE}>{t('shiftPage.horizontal')}</label>
          <input
            ref={dxInputRef}
            type="number"
            class="crop-margins-input"
            value="0"
            min={-MAX_SHIFT_MM}
            max={MAX_SHIFT_MM}
            step="0.5"
            onInput={(e) => { setDxMm(parseShiftInput(e.target.value)); applyPreviewTransform(); }}
            onChange={writeFields}
          />
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label" style={LABEL_STYLE}>{t('shiftPage.vertical')}</label>
          <input
            ref={dyInputRef}
            type="number"
            class="crop-margins-input"
            value="0"
            min={-MAX_SHIFT_MM}
            max={MAX_SHIFT_MM}
            step="0.5"
            onInput={(e) => { setDyMm(parseShiftInput(e.target.value)); applyPreviewTransform(); }}
            onChange={writeFields}
          />
        </div>
        <div style={{ display: 'flex', 'justify-content': 'flex-end' }}>
          <button class="pref-btn" onClick={reset}>{t('shiftPage.reset')}</button>
        </div>

        <div class="crop-margins-row">
          <label class="crop-margins-label" style={LABEL_STYLE}>{t('shiftPage.applyTo')}</label>
          <select class="crop-margins-select" value={applyTo()} onChange={(e) => setApplyTo(e.target.value)}>
            <option value="current">{t('shiftPage.currentPage')}</option>
            <option value="all">{t('shiftPage.allPages')}</option>
            <option value="even">{t('shiftPage.evenPages')}</option>
            <option value="odd">{t('shiftPage.oddPages')}</option>
          </select>
        </div>
        <Show when={applyTo() !== 'current'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label" style={LABEL_STYLE}>{t('shiftPage.fromPage')}</label>
            <input
              type="number"
              class="crop-margins-input"
              value={untrack(fromPage)}
              min="1"
              max={totalPages}
              step="1"
              onInput={(e) => {
                const page = parseFromPageInput(e.target.value, totalPages);
                if (page !== null) setFromPage(page);
              }}
              onChange={(e) => { e.target.value = String(fromPage()); }}
            />
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
