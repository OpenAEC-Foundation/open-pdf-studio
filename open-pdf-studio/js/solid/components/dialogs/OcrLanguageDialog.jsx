import { createSignal, onCleanup, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { getActiveDocument, state } from '../../../core/state.js';
import { lijstOcrEngines, onOcrEnginesChanged, INGEBOUWD } from '../../../pdf/ocr-engines.js';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
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
  // De voorkeurs-OCR-engine (extensies kunnen engines toevoegen, #970). Een
  // voorkeur, zodat paginalabels en formulierherkenning hem ook gebruiken.
  const [engines, setEngines] = createSignal(lijstOcrEngines());
  onCleanup(onOcrEnginesChanged(() => setEngines(lijstOcrEngines())));
  const voorkeur = state.preferences?.ocrEngine;
  const [engine, setEngine] = createSignal(engines().some((e) => e.id === voorkeur) ? voorkeur : INGEBOUWD);
  const kiesEngine = async (id) => {
    setEngine(id);
    state.preferences.ocrEngine = id === INGEBOUWD ? null : id;
    const { savePreferences } = await import('../../../core/preferences.js');
    savePreferences();
  };

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
      <button class="pref-btn" onClick={() => { const documentId = getActiveDocument()?.id; close(); openDialog('ocr-review', {documentId}); }}>{t('ocrReview.title')}</button>
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
          <label class="crop-margins-label">{t('ocrLanguage.engine')}</label>
          <select
            class="crop-margins-select"
            value={engine()}
            onChange={(e) => kiesEngine(e.target.value)}
          >
            <For each={engines()}>
              {(e) => <option value={e.id} selected={e.id === engine()}>{e.id === INGEBOUWD ? t('ocrLanguage.builtinEngine') : e.label}</option>}
            </For>
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
