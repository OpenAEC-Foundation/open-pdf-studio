import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefSelect from './PrefSelect.jsx';

export default function PageDisplayTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.rendering')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.thinLines[0]()} onChange={e => p.thinLines[1](e.target.checked)} />
            <span>{t('pageDisplay.thinLines')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showScrollbars[0]()} onChange={e => p.showScrollbars[1](e.target.checked)} />
            <span>{t('pageDisplay.showScrollbars')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.progressiveRender[0]()} onChange={e => p.progressiveRender[1](e.target.checked)} />
            <span>{t('pageDisplay.progressiveRender')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('pageDisplay.zoomDpi')}</label>
          <input type="number" min="50" max="300" value={p.zoomDpi[0]()} onInput={e => p.zoomDpi[1](parseInt(e.target.value) || 96)} />
        </div>
        <div class="pref-row">
          <label>{t('pageDisplay.pageSharpen')}</label>
          <PrefSelect
            value={p.pageSharpen[0]}
            setValue={p.pageSharpen[1]}
            options={[0, 1, 2, 3, 4].map(v => ({ value: v, label: t('pageDisplay.pageSharpenLevel' + v) }))}
          />
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.panels')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.propertiesPanelVisible[0]()} onChange={e => p.propertiesPanelVisible[1](e.target.checked)} />
            <span>{t('pageDisplay.showPropertiesPanel')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.toolPaletteVisible[0]()} onChange={e => p.toolPaletteVisible[1](e.target.checked)} />
            <span>{t('pageDisplay.showToolPalette')}</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
