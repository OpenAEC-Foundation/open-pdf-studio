import { createSignal, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { PAPER_SIZES } from './NewDocDialog.jsx';
import { usFormatenVan, usFormaatTekst } from '../../../core/us-papierformaten.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { insertBlankPages } from '../../../pdf/page-manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function InsertPageDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [position, setPosition] = createSignal('after');
  const [count, setCount] = createSignal(1);
  const [paperSize, setPaperSize] = createSignal('current');
  // 'auto' = keep the natural orientation of the chosen size / current page;
  // 'portrait'/'landscape' force it by swapping width/height when needed.
  const [orientation, setOrientation] = createSignal('auto');

  async function getDimensions() {
    const size = paperSize();
    let widthPt, heightPt;

    if (size === 'current') {
      const doc = getActiveDocument();
      const page = await doc.pdfDoc.getPage(doc.currentPage);
      const viewport = page.getViewport({ scale: 1 });
      widthPt = viewport.width;
      heightPt = viewport.height;
    } else {
      const info = PAPER_SIZES[size];
      widthPt = info.width;
      heightPt = info.height;
    }

    const o = orientation();
    if ((o === 'landscape' && heightPt > widthPt) ||
        (o === 'portrait' && widthPt > heightPt)) {
      [widthPt, heightPt] = [heightPt, widthPt];
    }
    return { widthPt, heightPt };
  }

  const close = () => closeDialog('insert-page');

  const handleOk = async () => {
    const { widthPt, heightPt } = await getDimensions();
    await insertBlankPages(position(), getActiveDocument()?.currentPage || 1, count(), widthPt, heightPt);
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="insert-page-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleOk}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('insertPage.title')}
      overlayClass="insert-page-overlay"
      dialogClass="insert-page-dialog"
      headerClass="insert-page-header"
      bodyClass="insert-page-content"
      footerClass="insert-page-footer"
      onClose={close}
      footer={footer}
    >
      <div class="insert-page-form">
        <div class="insert-page-row">
          <label class="insert-page-label">{t('insertPage.position')}</label>
          <select
            class="insert-page-select"
            value={position()}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="after">{t('insertPage.afterCurrentPage')}</option>
            <option value="before">{t('insertPage.beforeCurrentPage')}</option>
            <option value="start">{t('insertPage.atTheBeginning')}</option>
            <option value="end">{t('insertPage.atTheEnd')}</option>
          </select>
        </div>
        <div class="insert-page-row">
          <label class="insert-page-label">{t('insertPage.count')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="insert-page-input"
            value={count()}
            min="1"
            max="100"
            step="1"
            onInput={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div class="insert-page-row">
          <label class="insert-page-label">{t('insertPage.paperSize')}</label>
          <select
            class="insert-page-select"
            value={paperSize()}
            onChange={(e) => setPaperSize(e.target.value)}
          >
            <option value="current">{t('insertPage.sameAsCurrentPage')}</option>
            <optgroup label={t('newDoc.isoASeries')}>
              <option value="a0">A0 (841 x 1189 mm)</option>
              <option value="a1">A1 (594 x 841 mm)</option>
              <option value="a2">A2 (420 x 594 mm)</option>
              <option value="a3">A3 (297 x 420 mm)</option>
              <option value="a4">A4 (210 x 297 mm)</option>
              <option value="a5">A5 (148 x 210 mm)</option>
              <option value="a6">A6 (105 x 148 mm)</option>
            </optgroup>
            <optgroup label={t('newDoc.isoBSeries')}>
              <option value="b3">B3 (353 x 500 mm)</option>
              <option value="b4">B4 (250 x 353 mm)</option>
              <option value="b5">B5 (176 x 250 mm)</option>
            </optgroup>
            <optgroup label={t('newDoc.northAmerican')}>
              <option value="letter">Letter (8.5 x 11 in)</option>
              <option value="legal">Legal (8.5 x 14 in)</option>
              <option value="tabloid">Tabloid (11 x 17 in)</option>
              <option value="ledger">Ledger (17 x 11 in)</option>
            </optgroup>
            <optgroup label={t('newDoc.usArchitectural')}>
              <For each={usFormatenVan('arch')}>{(f) => <option value={f.sleutel}>{usFormaatTekst(f)}</option>}</For>
            </optgroup>
            <optgroup label={t('newDoc.usEngineering')}>
              <For each={usFormatenVan('ansi')}>{(f) => <option value={f.sleutel}>{usFormaatTekst(f)}</option>}</For>
            </optgroup>
          </select>
        </div>
        <div class="insert-page-row">
          <label class="insert-page-label">{t('insertPage.orientation') || 'Richting:'}</label>
          <select
            class="insert-page-select"
            value={orientation()}
            onChange={(e) => setOrientation(e.target.value)}
          >
            <option value="auto">{t('insertPage.autoOrientation') || 'Automatisch'}</option>
            <option value="portrait">{t('insertPage.portrait') || 'Staand'}</option>
            <option value="landscape">{t('insertPage.landscape') || 'Liggend'}</option>
          </select>
        </div>
      </div>
    </Dialog>
  );
}
