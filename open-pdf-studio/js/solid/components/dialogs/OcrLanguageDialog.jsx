import { createSignal, onCleanup, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { getActiveDocument, state } from '../../../core/state.js';
import { lijstOcrEngines, onOcrEnginesChanged, INGEBOUWD } from '../../../pdf/ocr-engines.js';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import OcrLanguagePicker, { opgeslagenOcrTaal } from './OcrLanguagePicker.jsx';

export default function OcrLanguageDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;

  const [applyTo, setApplyTo] = createSignal('all');
  // 'auto' or a Tesseract spec such as 'nld+eng'; the languages come from
  // the language folder (OcrLanguagePicker, #1083).
  const [lang, setLang] = createSignal(opgeslagenOcrTaal());
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
        <OcrLanguagePicker
          value={lang()}
          onChange={setLang}
          rowClass="crop-margins-row"
          labelClass="crop-margins-label"
          selectClass="crop-margins-select"
        />
        <div class="crop-margins-info">
          {t('ocrLanguage.info', { count: totalPages })}
        </div>
      </div>
    </Dialog>
  );
}
