import { createSignal, createMemo, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument, clearSelection, addToSelection } from '../../../core/state.js';
import { invalidateScaleRegionCache } from '../../../annotations/scale-region.js';
import { recalculateAllMeasurements } from '../../../annotations/measurement.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { pointsToPaperMm, scaleStringFromMeasurement } from '../../../annotations/scale-from-measurement.js';
import { showProperties } from '../../../ui/panels/properties-panel.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { recordBulkModify } from '../../../core/undo-manager.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Small follow-up dialog for the "Meet op tekening" flow: after the user
 * picked two points on the drawing, asks what the measured distance really
 * is (value + unit) and derives the 1:N scale from it.
 *
 * props.data:
 *   - pixelDistance: measured distance in app-space units (PDF points)
 *   - target: { kind: 'scaleRegionDialog', annotationId, pageNum, restore }
 *             → reopen the scale-region dialog with the computed scale
 *     or      { kind: 'annotation', annotationId }
 *             → apply the computed scale to the existing scale region
 */
export default function MeasuredLengthDialog(props) {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const target = data.target || {};
  const pixelDistance = Number(data.pixelDistance) || 0;

  const defaultUnit = target.restore?.units || target.defaultUnit || 'mm';
  const [value, setValue] = createSignal('');
  const [unit, setUnit] = createSignal(defaultUnit);

  const paperMm = pointsToPaperMm(pixelDistance);

  const computedScale = createMemo(() => {
    const v = parseFloat(String(value()).replace(',', '.'));
    return scaleStringFromMeasurement(pixelDistance, v, unit());
  });

  function reopenScaleRegionDialog(initial) {
    openDialog('scale-region', {
      annotationId: target.annotationId,
      pageNum: target.pageNum,
      isNew: target.isNew,
      initial,
    });
  }

  function handleCancel() {
    closeDialog('measured-length');
    // Bring the scale-region dialog back with its previous values.
    if (target.kind === 'scaleRegionDialog') {
      reopenScaleRegionDialog(target.restore || {});
    }
  }

  function handleOk() {
    const scaleStr = computedScale();
    if (!scaleStr) return; // invalid input — keep the dialog open

    closeDialog('measured-length');

    if (target.kind === 'annotation') {
      // Update the existing scale region directly.
      const doc = getActiveDocument();
      const ann = doc?.annotations.find(a => a.id === target.annotationId);
      if (!ann) return;
      const affected = [ann, ...doc.annotations.filter(annotation =>
        annotation !== ann && ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
      )];
      const originals = affected.map(annotation => cloneAnnotation(annotation));
      ann.scaleString = scaleStr;
      ann.units = unit();
      ann.modifiedAt = new Date().toISOString();
      invalidateScaleRegionCache();
      recalculateAllMeasurements();
      recordBulkModify(affected, originals);
      redraw();
      // Re-select so the properties panel shows the updated scale.
      clearSelection();
      addToSelection(ann);
      showProperties(ann);
    } else {
      // Reopen the scale-region dialog with the computed scale filled in;
      // Apply there remains the confirmation step.
      reopenScaleRegionDialog({
        ...(target.restore || {}),
        units: unit(),
        scaleString: scaleStr,
      });
    }
  }

  return (
    <Dialog
      title={t('scaleRegion.measureTitle') || 'Real length'}
      dialogClass="scale-region-dialog"
      onClose={handleCancel}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleCancel}>{tCommon('cancel') || 'Cancel'}</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            disabled={!computedScale()}
            onClick={handleOk}>{tCommon('ok') || 'OK'}</button>
        </div>
      }
    >
      <div style="min-width:300px">
        <div class="ai-login-field">
          <label>{t('scaleRegion.measuredOnPaper') || 'Measured on paper'}</label>
          <div style="padding:2px 0;opacity:0.85">{paperMm.toFixed(1)} mm</div>
        </div>

        <div class="ai-login-field">
          <label>{t('scaleRegion.measureQuestion') || 'What is the real length of this distance?'}</label>
          <div style="display:flex;gap:6px">
            <input type="number" class="ribbon-input" min="0" step="any"
              value={value()} onInput={e => setValue(e.target.value)}
              placeholder="1000"
              style="flex:1;box-sizing:border-box" autofocus />
            <PrefSelect
              value={unit}
              setValue={setUnit}
              options={[
                { value: 'mm', label: 'mm' },
                { value: 'cm', label: 'cm' },
                { value: 'm', label: 'm' },
                { value: 'in', label: 'in' },
                { value: 'ft', label: 'ft' },
              ]}
              style={{ width: '70px' }}
            />
          </div>
        </div>

        <Show when={computedScale()}>
          <div class="ai-login-field">
            <label>{t('scaleRegion.computedScale') || 'Calculated scale'}</label>
            <div style="padding:2px 0;font-weight:600">{computedScale()}</div>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
