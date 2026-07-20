import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import {
  recordAdd,
  recordBulkModify,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../../core/undo-manager.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { recalculateAllMeasurements } from '../../../annotations/measurement.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const PRESET_SCALES = [
  { label: '1:10', ratio: 10 },
  { label: '1:20', ratio: 20 },
  { label: '1:25', ratio: 25 },
  { label: '1:50', ratio: 50 },
  { label: '1:75', ratio: 75 },
  { label: '1:100', ratio: 100 },
  { label: '1:125', ratio: 125 },
  { label: '1:150', ratio: 150 },
  { label: '1:200', ratio: 200 },
  { label: '1:250', ratio: 250 },
  { label: '1:300', ratio: 300 },
  { label: '1:400', ratio: 400 },
  { label: '1:500', ratio: 500 },
  { label: '1:750', ratio: 750 },
  { label: '1:1000', ratio: 1000 },
  { label: '1:1250', ratio: 1250 },
  { label: '1:2000', ratio: 2000 },
  { label: '1:2500', ratio: 2500 },
  { label: '1:5000', ratio: 5000 },
];

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function findAnnotation(id) {
  const doc = getActiveDocument();
  if (!doc) return null;
  return doc.annotations.find(a => a.id === id) || null;
}

export default function ViewportScaleDialog(props) {
  const { t } = useTranslation('ribbon');
  const data = props.data || {};
  const initialAnnotation = findAnnotation(data.annotationId);
  const initialSnapshot = initialAnnotation ? cloneAnnotation(initialAnnotation) : null;
  const initialRatio = String(initialAnnotation?.scaleRatio || '').match(/^1:(\d+)$/)?.[1] || '100';
  const [mode, setMode] = createSignal(data.isNew || initialAnnotation?.scaleRatio ? 'preset' : 'custom');
  const [presetRatio, setPresetRatio] = createSignal(initialRatio);
  const hasCustomScale = !!initialAnnotation && !initialAnnotation.scaleRatio && initialAnnotation.pixelsPerUnit > 0;
  const [customValue, setCustomValue] = createSignal(hasCustomScale ? '1' : '');
  const [customUnit, setCustomUnit] = createSignal(initialAnnotation?.unit || 'mm');
  const [refPixels, setRefPixels] = createSignal(hasCustomScale ? String(initialAnnotation.pixelsPerUnit) : '');
  const [viewportName, setViewportName] = createSignal(initialAnnotation?.name || '');

  function handleApply() {
    const doc = getActiveDocument();
    const ann = findAnnotation(data.annotationId);
    if (!doc || !ann) return;
    const existingAnnotations = doc.annotations.filter(annotation =>
      annotation !== ann && ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
    );
    const existingOriginals = existingAnnotations.map(annotation => cloneAnnotation(annotation));

    let pixelsPerUnit, unit, scaleRatio = '';

    if (mode() === 'preset') {
      const ratio = parseInt(presetRatio());
      if (!ratio || ratio <= 0) return;
      pixelsPerUnit = 72 / (25.4 * ratio);
      unit = 'mm';
      scaleRatio = `1:${ratio}`;
    } else {
      const realVal = parseFloat(customValue());
      const pxVal = parseFloat(refPixels());
      if (!realVal || realVal <= 0 || !pxVal || pxVal <= 0) return;
      pixelsPerUnit = pxVal / realVal;
      unit = customUnit();
    }

    // Update the viewport annotation
    ann.pixelsPerUnit = pixelsPerUnit;
    ann.unit = unit;
    ann.scaleRatio = scaleRatio;
    ann.name = viewportName() || scaleRatio || 'Viewport';
    ann.modifiedAt = new Date().toISOString();

    recalculateAllMeasurements();
    beginUndoTransaction();
    if (data.isNew) recordAdd(ann);
    else if (initialSnapshot) recordBulkModify([ann], [initialSnapshot]);
    recordBulkModify(existingAnnotations, existingOriginals);
    endUndoTransaction();
    closeDialog('viewport-scale');
  }

  function handleCancel() {
    // Remove the placeholder annotation
    const doc = getActiveDocument();
    const ann = findAnnotation(data.annotationId);
    if (data.isNew && doc && ann) {
      const idx = doc.annotations.indexOf(ann);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      redraw();
    }
    closeDialog('viewport-scale');
  }

  return (
    <Dialog
      title={t('measure.viewportTitle') || 'Set Viewport Scale'}
      dialogClass="viewport-scale-dialog"
      onClose={handleCancel}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleCancel}>
            Cancel
          </button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={handleApply}>
            Apply
          </button>
        </div>
      }
    >
      <div style="min-width:300px">
        <div class="ai-login-field">
          <label>Viewport name (optional)</label>
          <input type="text" class="ribbon-input" value={viewportName()} onInput={e => setViewportName(e.target.value)}
            placeholder="e.g. Detail A, Section B"
            style="width:100%;box-sizing:border-box" />
        </div>

        <div class="ai-login-field">
          <label>Scale method</label>
          <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:default">
              <input type="radio" name="vp-mode" checked={mode() === 'preset'} onChange={() => setMode('preset')} />
              Preset scale
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:default">
              <input type="radio" name="vp-mode" checked={mode() === 'custom'} onChange={() => setMode('custom')} />
              Custom
            </label>
          </div>
        </div>

        <Show when={mode() === 'preset'}>
          <div class="ai-login-field">
            <label>Scale</label>
            <PrefSelect
              value={presetRatio}
              setValue={setPresetRatio}
              options={PRESET_SCALES.map(s => ({ value: String(s.ratio), label: s.label }))}
              style={{ width: '100%' }}
            />
          </div>
        </Show>

        <Show when={mode() === 'custom'}>
          <div class="ai-login-field">
            <label>Reference pixels</label>
            <input type="number" class="ribbon-input" value={refPixels()} onInput={e => setRefPixels(e.target.value)}
              placeholder="Pixel distance on screen"
              style="width:100%;box-sizing:border-box" />
          </div>
          <div class="ai-login-field">
            <label>Real-world distance</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input type="number" class="ribbon-input" value={customValue()} onInput={e => setCustomValue(e.target.value)}
                placeholder="Distance"
                style="flex:1" />
              <PrefSelect
                value={customUnit}
                setValue={setCustomUnit}
                options={[
                  { value: 'mm', label: 'mm' },
                  { value: 'cm', label: 'cm' },
                  { value: 'm', label: 'm' },
                  { value: 'in', label: 'in' },
                  { value: 'ft', label: 'ft' },
                ]}
                style={{ width: '60px' }}
              />
            </div>
          </div>
        </Show>

        <div style="font-size:10px;color:var(--theme-text-secondary,#888);margin-top:8px;padding:6px 8px;background:var(--theme-bg,#f5f5f5);border:1px solid var(--theme-border,#e0e0e0)">
          Viewport: {Math.round(findAnnotation(data.annotationId)?.width || 0)} x {Math.round(findAnnotation(data.annotationId)?.height || 0)} px
          <br/>
          Measurements inside this area will use the viewport's scale.
        </div>
      </div>
    </Dialog>
  );
}
