import { Show } from 'solid-js';
import { useTranslation, localizeNumber } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { kalibratieVoor, zetKalibratie, wisKalibratie } from '../../../pdf/schermkalibratie.js';
import PrefSelect from './PrefSelect.jsx';

// Page sharpening levels 0-4 (render-sharpen.js), written out so every key
// used here is findable in the locale files.
const SHARPEN_LEVELS = [
  'pageDisplay.pageSharpenLevel0',
  'pageDisplay.pageSharpenLevel1',
  'pageDisplay.pageSharpenLevel2',
  'pageDisplay.pageSharpenLevel3',
  'pageDisplay.pageSharpenLevel4',
];

export default function PageDisplayTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;

  // Schermkalibratie voor Werkelijke grootte (#520), per schermschaal. De
  // wijziging gaat in het voorkeurensignaal; pas Opslaan legt hem vast.
  const dpr = () => window.devicePixelRatio || 1;
  const schaalProcent = () => Math.round(dpr() * 100);
  const huidig = () => kalibratieVoor(p.screenCalibration[0](), dpr());

  function kalibreer() {
    openDialog('screen-calibration', {
      pxPerInch: huidig(),
      dpr: dpr(),
      onApply: (pxPerInch) => p.screenCalibration[1](zetKalibratie(p.screenCalibration[0](), dpr(), pxPerInch)),
    });
  }

  function verwijder() {
    p.screenCalibration[1](wisKalibratie(p.screenCalibration[0](), dpr()));
  }

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
          <label>{t('pageDisplay.pageSharpen')}</label>
          <PrefSelect
            value={p.pageSharpen[0]}
            setValue={p.pageSharpen[1]}
            options={SHARPEN_LEVELS.map((key, v) => ({ value: v, label: t(key) }))}
          />
        </div>
        {/* Page engine (#625): PDFium, or Hayro (pure Rust). Annotations are
            always drawn by the app itself. */}
        <div class="pref-row">
          <label>{t('pageDisplay.renderEngine')}</label>
          <PrefSelect
            value={p.renderEngine[0]}
            setValue={p.renderEngine[1]}
            options={[
              { value: 'auto', label: t('pageDisplay.renderEngineAuto') },
              { value: 'pdfium', label: t('pageDisplay.renderEnginePdfium') },
              { value: 'hayro', label: t('pageDisplay.renderEngineHayro') },
            ]}
          />
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.actualSize')}</legend>
        {/* Without a calibration for this screen the dpi below defines 100%;
            a calibration (#520) takes precedence on the screen it was made for. */}
        <div class="pref-row">
          <label>{t('pageDisplay.zoomDpi')}</label>
          <input type="number" min="50" max="300" value={p.zoomDpi[0]()} onInput={e => p.zoomDpi[1](parseInt(e.target.value) || 96)} />
        </div>
        <div class="pref-row">
          <span class="pref-status-text">
            <Show when={huidig() != null} fallback={t('pageDisplay.calibrationNone', { scale: schaalProcent() })}>
              {t('pageDisplay.calibrationActive', { scale: schaalProcent(), ppi: localizeNumber(huidig()) })}
            </Show>
          </span>
          <span class="pref-inline-buttons">
            <button class="pref-btn pref-btn-secondary" onClick={kalibreer}>{t('pageDisplay.calibrate')}</button>
            <button class="pref-btn pref-btn-secondary" disabled={huidig() == null} onClick={verwijder}>{t('pageDisplay.removeCalibration')}</button>
          </span>
        </div>
        <div class="pref-row">
          <span class="pref-hint">{t('pageDisplay.calibrationHint')}</span>
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
