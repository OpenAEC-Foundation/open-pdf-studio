import { Show, For, createEffect, untrack } from 'solid-js';
import { panelMode, docInfo, populateDocInfo, zetDocumentgegeven } from '../../stores/propertiesStore.js';
import { state } from '../../../core/state.js';
import { readDocInfoDeps } from '../../stores/doc-info-format.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { BEWERKBARE_VELDEN } from '../../../pdf/documentgegevens.js';

export default function DocInfoView() {
  const { t } = useTranslation('properties');

  // De documentinfo werd alleen gevuld bij deselecteren en bij een tabwissel.
  // Bij direct openen gebeurt dat al voordat pdfDoc geladen is (Pagina's en
  // Paginaformaat bleven '-'), en een paginawissel door scrollen in de
  // doorlopende weergave zet alleen doc.currentPage. Volg daarom de relevante
  // velden van het actieve document reactief; panelMode bewust ongevolgd
  // (storeHideProperties ververst zelf bij terugkeer naar de documentinfo).
  createEffect(() => {
    const doc = state.documents[state.activeDocumentIndex];
    readDocInfoDeps(doc);
    // Ook de bewerkte documentgegevens (#1017): ongedaan maken en opnieuw.
    void doc?.documentgegevens;
    untrack(() => {
      if (panelMode() === 'none') populateDocInfo();
    });
  });

  return (
    <Show when={panelMode() === 'none'}>
      <div id="prop-no-selection">
        <CollapsibleSection title={t('docInfo.document')} name="docDocument">
          <div class="property-group"><label>{t('docInfo.file')}</label><span class="prop-info-value" style="word-break: break-all;">{docInfo.filename}</span></div>
          <div class="property-group"><label>{t('docInfo.path')}</label><span class="prop-info-secondary" style="word-break: break-all;">{docInfo.filepath}</span></div>
          <div class="property-group"><label>{t('docInfo.pages')}</label><span class="prop-info-value">{docInfo.pages}</span></div>
          <div class="property-group"><label>{t('docInfo.pageSize')}</label><span class="prop-info-value">{docInfo.pageSize}</span></div>
        </CollapsibleSection>

        <CollapsibleSection title={t('docInfo.metadata')} name="docMetadata">
          {/* Bewerkbaar (#1017): vastleggen bij Enter of het verlaten van het
              veld, Esc zet de getoonde waarde terug. Opslaan schrijft ze in
              /Info en het XMP van het bestand. */}
          <For each={BEWERKBARE_VELDEN}>
            {(veld) => (
              <div class="property-group">
                <label for={`doc-info-${veld}`}>{t(`docInfo.${veld}`)}</label>
                <input type="text" id={`doc-info-${veld}`} data-doc-info={veld}
                  value={docInfo[veld]}
                  disabled={!docInfo.editable}
                  spellcheck={false}
                  onChange={(e) => {
                    zetDocumentgegeven(veld, e.currentTarget.value);
                    e.currentTarget.value = docInfo[veld];
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                    else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = docInfo[veld]; e.currentTarget.blur(); }
                  }} />
              </div>
            )}
          </For>
          <div class="property-group"><label>{t('docInfo.producer')}</label><span class="prop-info-value">{docInfo.producer}</span></div>
          <div class="property-group"><label>{t('docInfo.pdfVersion')}</label><span class="prop-info-value">{docInfo.version}</span></div>
        </CollapsibleSection>

        <CollapsibleSection title={t('docInfo.annotations')} name="docAnnotations">
          <div class="property-group"><label>{t('docInfo.total')}</label><span class="prop-info-value">{docInfo.annotCount}</span></div>
          <div class="property-group"><label>{t('docInfo.onPage')}</label><span class="prop-info-value">{docInfo.annotPage}</span></div>
        </CollapsibleSection>

        <div class="prop-hint-text">{t('docInfo.selectHint')}</div>
      </div>
    </Show>
  );
}
