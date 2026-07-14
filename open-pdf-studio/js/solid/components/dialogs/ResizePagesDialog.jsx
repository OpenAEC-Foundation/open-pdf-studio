import { createSignal, createMemo, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Preset sizes in millimetres (portrait: width x height).
const PRESETS = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

export default function ResizePagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;

  const [applyTo, setApplyTo] = createSignal('current');
  const [rangeStr, setRangeStr] = createSignal('');
  const [preset, setPreset] = createSignal('a4');
  const [orientation, setOrientation] = createSignal('portrait');
  const [customW, setCustomW] = createSignal(210);
  const [customH, setCustomH] = createSignal(297);

  // Resolve the target width/height in mm, applying orientation.
  const dims = createMemo(() => {
    let w, h;
    if (preset() === 'custom') {
      w = customW();
      h = customH();
    } else {
      [w, h] = PRESETS[preset()];
    }
    if (orientation() === 'landscape' && h > w) [w, h] = [h, w];
    if (orientation() === 'portrait' && w > h) [w, h] = [h, w];
    return { w, h };
  });

  const close = () => closeDialog('resize-pages');

  const handleResize = async () => {
    const applyToVal = applyTo();
    const rangeVal = rangeStr();
    const { w, h } = dims();

    close();

    const { resizePages } = await import('../../../pdf/resize-pages.js');
    const result = await resizePages(applyToVal, rangeVal, w, h);

    if (!result.resized) {
      showMessage(t('resizePages.nothingResized'));
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleResize}>{tCommon('apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('resizePages.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.applyTo')}</label>
          <select class="crop-margins-select" value={applyTo()} onChange={(e) => setApplyTo(e.target.value)}>
            <option value="current">{t('resizePages.currentPage')}</option>
            <option value="all">{t('resizePages.allPages')}</option>
            <option value="range">{t('resizePages.pageRange')}</option>
          </select>
        </div>
        <Show when={applyTo() === 'range'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.pages')}</label>
            <input
              type="text"
              class="crop-margins-input-wide"
              placeholder={t('resizePages.pagesPlaceholder')}
              value={rangeStr()}
              onInput={(e) => setRangeStr(e.target.value)}
            />
          </div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.size')}</label>
          <select class="crop-margins-select" value={preset()} onChange={(e) => setPreset(e.target.value)}>
            <option value="a3">A3 (297 × 420 mm)</option>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="a5">A5 (148 × 210 mm)</option>
            <option value="letter">{t('resizePages.letter')}</option>
            <option value="legal">{t('resizePages.legal')}</option>
            <option value="tabloid">{t('resizePages.tabloid')}</option>
            <option value="custom">{t('resizePages.custom')}</option>
          </select>
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('resizePages.orientation')}</label>
          <select class="crop-margins-select" value={orientation()} onChange={(e) => setOrientation(e.target.value)}>
            <option value="portrait">{t('resizePages.portrait')}</option>
            <option value="landscape">{t('resizePages.landscape')}</option>
          </select>
        </div>
        <Show when={preset() === 'custom'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.width')}</label>
            <input
              type="number"
              class="crop-margins-input"
              value={customW()}
              min="1"
              max="10000"
              step="1"
              onInput={(e) => setCustomW(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('resizePages.height')}</label>
            <input
              type="number"
              class="crop-margins-input"
              value={customH()}
              min="1"
              max="10000"
              step="1"
              onInput={(e) => setCustomH(parseFloat(e.target.value) || 0)}
            />
          </div>
        </Show>
        <div class="crop-margins-info">
          {t('resizePages.info', { count: totalPages })}
        </div>
      </div>
    </Dialog>
  );
}
