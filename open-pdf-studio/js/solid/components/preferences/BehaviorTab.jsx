import { useTranslation } from '../../../i18n/useTranslation.js';

export default function BehaviorTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('behavior.snapping')}</legend>
        <div class="pref-row">
          <label>{t('behavior.angleSnap')}</label>
          <input type="text" inputmode="decimal" data-getal min="1" max="90" value={p.angleSnapDegrees[0]()} onInput={e => p.angleSnapDegrees[1](parseInt(e.target.value) || 30)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableAngleSnap[0]()} onChange={e => p.enableAngleSnap[1](e.target.checked)} />
            <span>{t('behavior.enableAngleSnapping')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('behavior.gridSize')}</label>
          <input type="text" inputmode="decimal" data-getal min="5" max="100" value={p.gridSize[0]()} onInput={e => p.gridSize[1](parseInt(e.target.value) || 10)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableGridSnap[0]()} onChange={e => p.enableGridSnap[1](e.target.checked)} />
            <span>{t('behavior.enableGridSnapping')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showGrid[0]()} onChange={e => p.showGrid[1](e.target.checked)} />
            <span>{t('behavior.showGridOverlay')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.polarTracking') || 'Polar tracking'}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.polarTrackingEnabled[0]()} onChange={e => p.polarTrackingEnabled[1](e.target.checked)} />
            <span>{t('behavior.enablePolarTracking') || 'Enable polar tracking (F10)'}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('behavior.polarIncrement') || 'Polar increment (°)'}</label>
          <input type="text" inputmode="decimal" data-getal min="1" max="180" step="1" value={p.polarIncrement[0]()} onInput={e => p.polarIncrement[1](parseFloat(e.target.value) || 45)} disabled={!p.polarTrackingEnabled[0]()} />
        </div>
        <div class="pref-row">
          <label>{t('behavior.polarTolerance') || 'Polar tolerance (°)'}</label>
          <input type="text" inputmode="decimal" data-getal min="0.5" max="15" step="0.5" value={p.polarTolerance[0]()} onInput={e => p.polarTolerance[1](parseFloat(e.target.value) || 3)} disabled={!p.polarTrackingEnabled[0]()} />
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.objectSnapping')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableObjectSnap[0]()} onChange={e => p.enableObjectSnap[1](e.target.checked)} />
            <span>{t('behavior.enableObjectSnap')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToEndpoints[0]()} onChange={e => p.snapToEndpoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToEndpoints')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToMidpoints[0]()} onChange={e => p.snapToMidpoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToMidpoints')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToCenters[0]()} onChange={e => p.snapToCenters[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToCenters')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToVertices[0]()} onChange={e => p.snapToVertices[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToVertices')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToStartPoints[0]()} onChange={e => p.snapToStartPoints[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToStartPoints')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToEdges[0]()} onChange={e => p.snapToEdges[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToEdges')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToIntersections[0]()} onChange={e => p.snapToIntersections[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToIntersections')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToPerpendicular[0]()} onChange={e => p.snapToPerpendicular[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToPerpendicular')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToQuadrant[0]()} onChange={e => p.snapToQuadrant[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToQuadrant')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToTangent[0]()} onChange={e => p.snapToTangent[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToTangent')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToNearest[0]()} onChange={e => p.snapToNearest[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToNearest')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('behavior.objectSnapRadius')}</label>
          <input type="text" inputmode="decimal" data-getal min="5" max="30" value={p.objectSnapRadius[0]()} onInput={e => p.objectSnapRadius[1](parseInt(e.target.value) || 12)} disabled={!p.enableObjectSnap[0]()} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.snapToPdfContent[0]()} onChange={e => p.snapToPdfContent[1](e.target.checked)} disabled={!p.enableObjectSnap[0]()} />
            <span>{t('behavior.snapToPdfContent')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.moveInference')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.moveInferenceTracking[0]()} onChange={e => p.moveInferenceTracking[1](e.target.checked)} />
            <span>{t('behavior.moveInferenceTracking')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.moveInferenceExtension[0]()} onChange={e => p.moveInferenceExtension[1](e.target.checked)} />
            <span>{t('behavior.moveInferenceExtension')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.moveInferenceParallel[0]()} onChange={e => p.moveInferenceParallel[1](e.target.checked)} />
            <span>{t('behavior.moveInferenceParallel')}</span>
          </label>
        </div>
        <div class="pref-row">
          <span class="pref-hint">{t('behavior.moveInferenceHint')}</span>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.creation')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.autoSelectAfterCreate[0]()} onChange={e => p.autoSelectAfterCreate[1](e.target.checked)} />
            <span>{t('behavior.autoSelectAfterCreation')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox"
              checked={typeof p.dynamicScaling?.[0] === 'function' ? p.dynamicScaling[0]() : false}
              onChange={e => p.dynamicScaling?.[1] && p.dynamicScaling[1](e.target.checked)} />
            <span>{t('behavior.dynamicScaling') || t('measure.dynamicScaling') || 'Auto-scale markups'}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.deletion')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.confirmBeforeDelete[0]()} onChange={e => p.confirmBeforeDelete[1](e.target.checked)} />
            <span>{t('behavior.confirmBeforeDeleting')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.navigation') || 'Navigatie'}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.wheelZoomWithoutCtrl[0]()} onChange={e => p.wheelZoomWithoutCtrl[1](e.target.checked)} />
            <span>{t('behavior.wheelZoomWithoutCtrl') || 'Zoomen met muiswiel (zonder Ctrl)'}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.middleDoubleClickFit[0]()} onChange={e => p.middleDoubleClickFit[1](e.target.checked)} />
            <span>{t('behavior.middleDoubleClickFit')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" id="pref-ribbon-wheel-tabs" checked={p.ribbonWheelSwitchesTabs[0]()} onChange={e => p.ribbonWheelSwitchesTabs[1](e.target.checked)} />
            <span>{t('behavior.ribbonWheelSwitchesTabs')}</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
