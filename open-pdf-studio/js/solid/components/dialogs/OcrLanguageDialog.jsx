import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Languages this build actually ships trained data for (see
// scripts/ocr-runtime.mjs) — 'auto' isn't a real Tesseract language, it's a
// sentinel src-tauri/src/ocr.rs's ocr_page_words() recognizes and resolves
// to AUTO_LANG (currently the combined Chinese+English pass), so adding a
// real option here needs a matching bundled .traineddata.
const LANGUAGE_OPTIONS = ['auto', 'eng', 'chi_tra', 'chi_tra+eng'];

export default function OcrLanguageDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;

  const [applyTo, setApplyTo] = createSignal('all');
  const [lang, setLang] = createSignal('auto');

  const close = () => closeDialog('ocr-language');

  const handleRun = async () => {
    const applyToVal = applyTo();
    const langVal = lang();
    close();

    const { ocrCurrentPage, ocrAllPages } = await import('../../../pdf/ocr.js');
    if (applyToVal === 'current') await ocrCurrentPage(langVal);
    else await ocrAllPages(langVal);
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleRun}>{t('ocrLanguage.run')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('ocrLanguage.title')}
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
          <label class="crop-margins-label">{t('cropMargins.applyTo')}</label>
          <select
            class="crop-margins-select"
            value={applyTo()}
            onChange={(e) => setApplyTo(e.target.value)}
          >
            <option value="current">{t('cropMargins.currentPage')}</option>
            <option value="all">{t('cropMargins.allPages')}</option>
          </select>
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('ocrLanguage.language')}</label>
          <select
            class="crop-margins-select"
            value={lang()}
            onChange={(e) => setLang(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((code) => (
              <option value={code}>{t(`ocrLanguage.options.${code}`)}</option>
            ))}
          </select>
        </div>
        <div class="crop-margins-info">
          {t('ocrLanguage.info', { count: totalPages })}
        </div>
      </div>
    </Dialog>
  );
}
