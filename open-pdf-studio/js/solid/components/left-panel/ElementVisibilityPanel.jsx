import { Show, For } from 'solid-js';
import { contentView, canEditContentView, setContentView, resetContentView } from '../../stores/contentViewStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getTypeDisplayName } from '../../../utils/helpers.js';
import {
  panelVisible, setPanelVisible,
  typeSummary,
  isTypeHidden, toggleTypeHidden,
  isTypeHalftoned, toggleTypeHalftone,
  getHalftone, setHalftoneColor, setHalftoneOpacity,
  resetElementVisibility,
} from '../../stores/elementVisibilityStore.js';

// "Zichtbaarheid Elementen" — een Revit-achtig Visibility/Graphics-paneel,
// met documentgebonden PDF-ondergrond en per annotatie-SOORT die in het
// actieve document voorkomt: een teller, een zichtbaarheids-toggle, en een
// halftone-override (dimmen) met instelbare kleur + dim-factor.
//
// Gedockt LINKS, naast het bestaande navigatie-paneel. Optioneel afsluitbaar
// via de sluit-knop in de koptekst (zet panelVisible(false)).
export default function ElementVisibilityPanel() {
  const { t } = useTranslation('ribbon');

  const closePanel = () => setPanelVisible(false);

  return (
    <Show when={panelVisible()}>
      <div class="element-visibility-panel" id="element-visibility-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>

        <div class="ev-panel-header">
          <span class="ev-panel-title">{t('elementVisibility.title')}</span>
          <div class="ev-panel-header-actions">
            <button type="button" class="ev-panel-reset"
              title={t('elementVisibility.reset')}
              onClick={() => { resetElementVisibility(); resetContentView(); }}>
              {t('elementVisibility.reset')}
            </button>
            <button type="button" class="ev-panel-close"
              title={t('elementVisibility.close')}
              onClick={closePanel}>&times;</button>
          </div>
        </div>

        <div class="ev-panel-body">
          <fieldset class="ev-content-view" disabled={!canEditContentView()}>
            <legend>{t('elementVisibility.pdfContent')}</legend>
            <label><input id="pdf-content-enabled" type="checkbox" checked={contentView().enabled}
              onChange={e => setContentView('enabled', e.currentTarget.checked)} />{t('elementVisibility.contentEnabled')}</label>
            <For each={[
              ['grayscale', 'image.grayscale', 0, 100],
              ['brightness', 'image.brightness', 25, 200],
              ['opacity', 'format.opacity', 0, 100],
            ]}>{([key, label, min, max]) => <label class="ev-content-slider">
              <span>{t(label)}</span>
              <input id={`pdf-content-${key}`} type="range" min={min} max={max} step="5"
                disabled={!contentView().enabled} value={contentView()[key]}
                onInput={e => setContentView(key, Number(e.currentTarget.value))} />
              <span>{contentView()[key]}%</span>
            </label>}</For>
          </fieldset>
          <Show when={typeSummary().length === 0}>
            <div class="ev-panel-empty">{t('elementVisibility.empty')}</div>
          </Show>

          <Show when={typeSummary().length > 0}>
            <div class="ev-column-head">
              <span class="ev-col-name">{t('elementVisibility.colType')}</span>
              <span class="ev-col-count">{t('elementVisibility.colCount')}</span>
              <span class="ev-col-vis">{t('elementVisibility.colVisible')}</span>
              <span class="ev-col-half">{t('elementVisibility.colHalftone')}</span>
            </div>

            <For each={typeSummary()}>
              {(item) => {
                const half = () => getHalftone(item.type);
                return (
                  <div class="ev-row" classList={{ 'ev-row-hidden': isTypeHidden(item.type) }}>
                    <div class="ev-row-main">
                      <label class="ev-vis-toggle" title={t('elementVisibility.toggleVisible')}>
                        <input type="checkbox"
                          checked={!isTypeHidden(item.type)}
                          onChange={() => toggleTypeHidden(item.type)} />
                      </label>
                      <span class="ev-type-name" title={item.type}>{getTypeDisplayName(item.type)}</span>
                      <span class="ev-type-count">{item.count}</span>
                      <label class="ev-half-toggle" title={t('elementVisibility.toggleHalftone')}>
                        <input type="checkbox"
                          checked={isTypeHalftoned(item.type)}
                          onChange={() => toggleTypeHalftone(item.type)} />
                      </label>
                    </div>

                    <Show when={isTypeHalftoned(item.type)}>
                      <div class="ev-half-controls">
                        <label class="ev-half-color">
                          <span>{t('elementVisibility.tint')}</span>
                          <input type="color"
                            value={half()?.color || '#888888'}
                            onInput={(e) => setHalftoneColor(item.type, e.currentTarget.value)} />
                          <button type="button" class="ev-half-clear"
                            title={t('elementVisibility.clearTint')}
                            onClick={() => setHalftoneColor(item.type, null)}>&times;</button>
                        </label>
                        <label class="ev-half-opacity">
                          <span>{t('elementVisibility.dim')}</span>
                          <input type="range" min="5" max="100" step="5"
                            value={Math.round((half()?.opacity ?? 0.35) * 100)}
                            onInput={(e) => setHalftoneOpacity(item.type, Number(e.currentTarget.value) / 100)} />
                          <span class="ev-half-opacity-val">{Math.round((half()?.opacity ?? 0.35) * 100)}%</span>
                        </label>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  );
}
