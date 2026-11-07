import { Show } from 'solid-js';
import { annotProps, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { isTauri } from '../../../core/platform.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { wijzigLink, bewerkLink } from '../../../annotations/link/link-maken.js';
import { volgLink } from '../../../annotations/link/link-volgen.js';
import { isGebrokenDoel } from '../../../annotations/link/link-model.js';

// Hyperlink (#953) in het eigenschappenpaneel: het doel en de rand bewerken,
// de link volgen, of het venster openen voor de rest (kleur, dikte).
export default function LinkSection() {
  const { t } = useTranslation('dialogs');
  // Niet bij een meervoudige selectie: die zet annotationType niet opnieuw.
  const isLink = () => annotProps.annotationType === 'link' && !(annotProps.multiCount > 0) && !!getCurrentAnnotation();
  const uit = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const doel = () => annotProps.linkTarget || null;
  const soort = () => doel()?.kind || 'uri';
  const ann = () => {
    const a = getCurrentAnnotation();
    return a?.type === 'link' ? a : null;
  };
  const aantal = () => getActiveDocument()?.pdfDoc?.numPages || 1;
  // De doelpagina is verwijderd of vervangen: de link wijst nergens heen tot
  // er een nieuwe pagina is ingevuld.
  const gebroken = () => isGebrokenDoel(doel());

  // Een andere soort doel: een redelijke beginwaarde, zodat de link geldig blijft.
  function kiesSoort(nieuw) {
    if (!ann() || nieuw === soort()) return;
    if (nieuw === 'page') wijzigLink(ann(), { doel: { kind: 'page', page: getActiveDocument()?.currentPage || 1, fit: 'xyz' } });
    else bewerkLink(ann()); // adres of bestand: in het venster invullen
  }

  return (
    <Show when={isLink()}>
      <CollapsibleSection title={t('link.section')} name="link" id="prop-link-section">
        <div class="property-group">
          <label>{t('link.target')}</label>
          <select value={soort()} disabled={uit()} onChange={(e) => kiesSoort(e.currentTarget.value)}>
            <option value="uri">{t('link.targetUri')}</option>
            <option value="page">{t('link.targetPage')}</option>
            <option value="file" disabled={!isTauri() && soort() !== 'file'}>{t('link.targetFile')}</option>
          </select>
        </div>
        <Show when={soort() === 'uri'}>
          <div class="property-group">
            <label>{t('link.uri')}</label>
            <input type="text" value={doel()?.uri || ''} disabled={uit()} spellcheck={false}
              onChange={(e) => {
                if (!wijzigLink(ann(), { doel: { kind: 'uri', uri: e.currentTarget.value } })) {
                  e.currentTarget.value = doel()?.uri || '';
                }
              }} />
          </div>
        </Show>
        <Show when={soort() === 'page'}>
          <div class="property-group">
            <label>{`${t('link.page')} (${t('link.pageOf', { count: aantal() })})`}</label>
            <input type="text" inputmode="numeric" value={doel()?.page ?? ''} disabled={uit()}
              onChange={(e) => {
                const page = Number(e.currentTarget.value);
                if (!wijzigLink(ann(), { doel: { kind: 'page', page, fit: doel()?.fit || 'xyz' } })) {
                  e.currentTarget.value = doel()?.page ?? '';
                }
              }} />
          </div>
          <Show when={gebroken()}>
            <div class="property-group">
              <p class="prop-link-warning" role="alert">{t('link.brokenPageWarning')}</p>
            </div>
          </Show>
          <div class="property-group">
            <label>{t('link.view')}</label>
            <select value={doel()?.fit === 'fit' ? 'fit' : 'xyz'} disabled={uit() || gebroken()}
              onChange={(e) => wijzigLink(ann(), { doel: { kind: 'page', page: doel()?.page || 1, fit: e.currentTarget.value } })}>
              <option value="xyz">{t('link.viewTop')}</option>
              <option value="fit">{t('link.viewFit')}</option>
            </select>
          </div>
        </Show>
        <Show when={soort() === 'file'}>
          <div class="property-group">
            <label>{t('link.file')}</label>
            <input type="text" value={doel()?.file || ''} disabled={uit()} spellcheck={false}
              onChange={(e) => {
                if (!wijzigLink(ann(), { doel: { kind: 'file', file: e.currentTarget.value } })) {
                  e.currentTarget.value = doel()?.file || '';
                }
              }} />
          </div>
        </Show>
        <div class="property-group">
          <label>{t('link.border')}</label>
          <select value={annotProps.linkBorder || 'none'} disabled={uit()}
            onChange={(e) => wijzigLink(ann(), { rand: e.currentTarget.value })}>
            <option value="none">{t('link.borderNone')}</option>
            <option value="solid">{t('link.borderSolid')}</option>
            <option value="underline">{t('link.borderUnderline')}</option>
          </select>
        </div>
        <div class="property-group">
          <div class="prop-button-row">
            <button class="prop-action-btn" disabled={!doel() || gebroken()} onClick={() => ann() && volgLink(ann())}>{t('link.follow')}</button>
            <button class="prop-action-btn" disabled={uit()} onClick={() => ann() && bewerkLink(ann())}>{t('link.edit')}</button>
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
