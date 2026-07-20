import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { startScaleMeasureFlow } from '../../../tools/tools/scale-measure-tool.js';
import {
  recordAdd,
  recordBulkModify,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../../core/undo-manager.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { recalculateAllMeasurements } from '../../../annotations/measurement.js';
import { invalidateScaleRegionCache } from '../../../annotations/scale-region.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Standard drawing scales for the dropdown (largest → smallest denominator).
const PRESET_SCALES = [
  '1:200', '1:100', '1:50', '1:20', '1:10', '1:5', '1:2', '1:1',
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

export default function ScaleRegionDialog(props) {
  const { t } = useTranslation('properties');
  const data = props.data || {};
  const initialAnnotation = findAnnotation(data.annotationId);
  const initialSnapshot = initialAnnotation ? cloneAnnotation(initialAnnotation) : null;
  // The "Meet op tekening" flow closes this dialog, lets the user measure a
  // distance and reopens it with data.initial (previous values + computed
  // scale) so nothing the user typed is lost.
  const initial = data.initial || initialSnapshot || {};
  const initialScale = initial.scaleString || '1:100';
  const [scaleString, setScaleString] = createSignal(initialScale);
  const [units, setUnits] = createSignal(initial.units || 'mm');
  const [label, setLabel] = createSignal(initial.label || '');
  // True when the user picked "Aangepast…" — shows the free-text scale input.
  // A computed scale like "1:53.42" is not a preset, so it starts as custom.
  const [customScale, setCustomScale] = createSignal(!PRESET_SCALES.includes(initialScale));

  // Scale must match "<number>:<number>" with both parts > 0 (decimals
  // allowed — a measured scale can be e.g. "1:53.42"). Anything else
  // (typos, blank, "1:" etc.) falls back to 1:100 so we never store
  // an invalid scaleString that would break measurement calculations.
  function normalizeScaleString(raw) {
    const trimmed = String(raw || '').trim().replace(/\s+/g, '');
    const m = trimmed.match(/^(\d+(?:[.,]\d+)?):(\d+(?:[.,]\d+)?)$/);
    if (!m) return '1:100';
    const a = parseFloat(m[1].replace(',', '.'));
    const b = parseFloat(m[2].replace(',', '.'));
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return '1:100';
    return `${a}:${b}`;
  }

  // "Meet op tekening": hide this dialog, let the user click two points on
  // the drawing, ask for the real length, then reopen this dialog with the
  // computed scale filled in. Apply stays the confirmation step.
  function handleMeasure() {
    const payload = {
      annotationId: data.annotationId,
      pageNum: data.pageNum,
      isNew: data.isNew,
      restore: { label: label(), units: units(), scaleString: scaleString() },
    };
    closeDialog('scale-region');
    startScaleMeasureFlow({
      onDone: (pixelDistance) => {
        openDialog('measured-length', {
          pixelDistance,
          target: { kind: 'scaleRegionDialog', ...payload },
        });
      },
      onCancel: () => {
        openDialog('scale-region', {
          annotationId: payload.annotationId,
          pageNum: payload.pageNum,
          isNew: payload.isNew,
          initial: payload.restore,
        });
      },
    });
  }

  function handleApply() {
    const doc = getActiveDocument();
    const ann = findAnnotation(data.annotationId);
    if (!doc || !ann) return;
    const measurements = doc.annotations.filter(annotation =>
      ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
    );
    const measurementOriginals = measurements.map(annotation => cloneAnnotation(annotation));
    ann.scaleString = normalizeScaleString(scaleString());
    ann.units = units() || 'mm';
    ann.label = label() || '';
    ann.modifiedAt = new Date().toISOString();

    invalidateScaleRegionCache();
    recalculateAllMeasurements();
    beginUndoTransaction();
    if (data.isNew) recordAdd(ann);
    else if (initialSnapshot) recordBulkModify([ann], [initialSnapshot]);
    recordBulkModify(measurements, measurementOriginals);
    endUndoTransaction();
    redraw();
    closeDialog('scale-region');
  }

  function handleCancel() {
    const doc = getActiveDocument();
    const ann = findAnnotation(data.annotationId);
    if (data.isNew && doc && ann) {
      const idx = doc.annotations.indexOf(ann);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      invalidateScaleRegionCache();
      redraw();
    }
    closeDialog('scale-region');
  }

  return (
    <Dialog
      title={t('scaleRegion.title') || 'Scale Region'}
      dialogClass="scale-region-dialog"
      onClose={handleCancel}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleCancel}>Cancel</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={handleApply}>Apply</button>
        </div>
      }
    >
      <div style="min-width:300px">
        <div class="ai-login-field">
          <label>{t('scaleRegion.label') || 'Label (optional)'}</label>
          <input type="text" class="ribbon-input"
            value={label()} onInput={e => setLabel(e.target.value)}
            placeholder="e.g. Plattegrond BG"
            style="width:100%;box-sizing:border-box" />
        </div>

        <div class="ai-login-field">
          <label>{t('scaleRegion.scale') || 'Scale'}</label>
          {/* Theme-aware dropdown (PrefSelect — same as the Unit field) with
              the standard drawing scales; "Aangepast…" reveals a free-text
              input for non-standard scales (e.g. 1:75). Format is
              validated/normalized in handleApply(). */}
          <PrefSelect
            value={() => (!customScale() && PRESET_SCALES.includes(scaleString())) ? scaleString() : '__custom__'}
            setValue={(v) => {
              if (v === '__custom__') {
                setCustomScale(true);
              } else {
                setCustomScale(false);
                setScaleString(v);
              }
            }}
            options={[
              ...PRESET_SCALES.map(s => ({ value: s, label: s })),
              { value: '__custom__', label: t('scaleRegion.custom') || 'Aangepast…' },
            ]}
            style={{ width: '100%' }}
          />
          <Show when={customScale()}>
            <input
              type="text"
              class="ribbon-input"
              value={scaleString()}
              onInput={e => setScaleString(e.target.value)}
              placeholder="1:75"
              style="width:100%;box-sizing:border-box;margin-top:4px"
            />
          </Show>
          {/* Derive the scale by measuring a known distance on the drawing:
              hides this dialog, 2-click pick, asks for the real length,
              reopens with the computed scale filled in. */}
          <button class="ai-plan-btn"
            style="width:100%;margin-top:6px;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleMeasure}>
            {t('scaleRegion.measure') || 'Meet op tekening'}
          </button>
        </div>

        <div class="ai-login-field">
          <label>{t('scaleRegion.unit') || 'Unit'}</label>
          <PrefSelect
            value={units}
            setValue={setUnits}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'm', label: 'm' },
              { value: 'in', label: 'in' },
              { value: 'ft', label: 'ft' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </Dialog>
  );
}
