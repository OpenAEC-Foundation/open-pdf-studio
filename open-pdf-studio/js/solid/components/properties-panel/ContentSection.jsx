import { Show } from 'solid-js';
import { getActiveDocument } from '../../../core/state.js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

function grootteTekst(bytes) {
  if (typeof bytes !== 'number' || !(bytes >= 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Openen en opslaan werken op de geselecteerde bijlage-annotatie.
function metBijlage(actie) {
  const ann = getActiveDocument()?.selectedAnnotation;
  if (ann?.type !== 'fileAttachment') return;
  import('../../../ui/bijlage-annotaties.js').then((m) => m[actie](ann))
    .catch((e) => console.error('[properties] attachment action failed', e));
}

export default function ContentSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.content}>
      <CollapsibleSection title={t('content.title')} name="content" id="prop-content-section">
        {/* Bijlage-annotatie (#376): het ingesloten bestand. */}
        <Show when={sectionVis.attachmentGroup}>
          <div class="property-group">
            <label>{t('attachment.file')}</label>
            <input type="text" readOnly value={annotProps.attachmentName} title={annotProps.attachmentMime || ''} />
          </div>
          <div class="property-group">
            <label>{t('attachment.size')}</label>
            <input type="text" readOnly value={grootteTekst(annotProps.attachmentSize)} />
          </div>
          <div class="property-group">
            <div class="prop-button-row">
              <button class="prop-action-btn" onClick={() => metBijlage('openBijlageAnnotatie')}>{t('attachment.open')}</button>
              <button class="prop-action-btn" onClick={() => metBijlage('bewaarBijlageAnnotatie')}>{t('attachment.saveAs')}</button>
            </div>
          </div>
        </Show>
        <Show when={sectionVis.textGroup}>
          <div class="property-group">
            <label>{t('content.text')}</label>
            <textarea rows="4" value={annotProps.text} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('text', e.target.value)} />
          </div>
        </Show>

        <Show when={sectionVis.fontSizeGroup}>
          <div class="property-group">
            <label>{t('content.fontSize')}</label>
            <input type="text" inputmode="decimal" data-getal min="8" max="72"
              value={annotProps.fontSize} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('fontSize', e.target.value)} />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
