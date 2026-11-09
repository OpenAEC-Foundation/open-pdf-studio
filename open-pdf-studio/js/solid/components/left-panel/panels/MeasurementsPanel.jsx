import { For, Show, createMemo } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { state, getActiveDocument } from '../../../../core/state.js';
import { getScaleForPoint } from '../../../../annotations/scale-bar.js';
import { redrawAnnotations, redrawContinuous } from '../../../../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../../../../ui/panels/properties-panel.js';
import { countTallies, countGroupMembers, GEEN_TELGROEP } from '../../../stores/countStore.js';
import { goToPage } from '../../../../pdf/renderer.js';
import { recordDelete } from '../../../../core/undo-manager.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { scaleDisplayLabel } from '../../../../annotations/scale-presets.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

const measureTypes = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);

const typeLabels = {
  measureDistance: 'Distance',
  measureArea: 'Area',
  measurePerimeter: 'Perimeter',
  measureAngle: 'Angle',
};

const typeIcons = {
  measureDistance: '\u2194',
  measureArea: '\u25A1',
  measurePerimeter: '\u25B3',
  measureAngle: '\u2220',
};

export default function MeasurementsPanel() {
  const { t } = useTranslation('properties');

  // ── Current scale ──
  const currentScale = createMemo(() => {
    const doc = getActiveDocument();
    const ms = doc?.measureScale;
    if (ms && ms.pixelsPerUnit > 0) {
      // Imperiaal als 1/8" = 1'-0" (1:96), metrisch als 1:100 (#1000).
      if (ms.scaleRatio) return scaleDisplayLabel(ms.scaleRatio, ms.unit);
      return `1px = ${(1 / ms.pixelsPerUnit).toFixed(4)} ${ms.unit}`;
    }
    return null;
  });

  // ── Viewports ──
  const viewports = createMemo(() => {
    const doc = getActiveDocument();
    if (!doc) return [];
    return (doc.annotations || []).filter(a => a.type === 'viewport');
  });

  // ── Measurements ──
  const measurements = createMemo(() => {
    const doc = getActiveDocument();
    if (!doc) return [];
    return (doc.annotations || []).filter(a => measureTypes.has(a.type));
  });

  // ── Grouped by type ──
  const groupedMeasurements = createMemo(() => {
    const groups = {};
    for (const m of measurements()) {
      const type = m.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(m);
    }
    return groups;
  });

  // ── Totals per type ──
  const totals = createMemo(() => {
    const result = {};
    for (const [type, items] of Object.entries(groupedMeasurements())) {
      if (type === 'measureAngle') {
        result[type] = items.length + ' angles';
      } else {
        const values = items.filter(m => m.measureValue != null).map(m => m.measureValue);
        const sum = values.reduce((a, b) => a + b, 0);
        const unit = items[0]?.measureUnit || '';
        result[type] = sum.toFixed(2) + ' ' + unit;
      }
    }
    return result;
  });

  // ── Click to navigate ──
  function navigateTo(ann) {
    const doc = getActiveDocument();
    if (!doc) return;

    // Go to the page
    if (doc.currentPage !== ann.page) {
      goToPage(ann.page);
    }

    // Select the annotation
    doc.selectedAnnotations = [ann];
    doc.selectedAnnotation = ann;
    showProperties(ann);
    redraw();
  }

  // ── Tellingen per groep (#935): klik selecteert de markeringen van de
  // groep op de huidige pagina (of op de eerste pagina waar de groep staat).
  const countRows = createMemo(() => countTallies().filter(r => r.count > 0));
  function selectCountGroup(groupId) {
    const doc = getActiveDocument();
    if (!doc) return;
    const leden = countGroupMembers(groupId);
    if (leden.length === 0) return;
    let pagina = doc.currentPage;
    if (!leden.some(a => a.page === pagina)) {
      pagina = leden[0].page;
      goToPage(pagina);
    }
    const sel = leden.filter(a => a.page === pagina);
    doc.selectedAnnotations = sel;
    doc.selectedAnnotation = sel[sel.length - 1] || null;
    if (sel.length === 1) showProperties(sel[0]);
    else showMultiSelectionProperties();
    redraw();
  }

  function deleteViewport(ann) {
    const doc = getActiveDocument();
    if (!doc) return;
    const idx = doc.annotations.indexOf(ann);
    if (idx !== -1) {
      recordDelete(ann, idx);
      doc.annotations.splice(idx, 1);
      redraw();
    }
  }

  return (
    <div class={`left-panel-content${activeTab() === 'measurements' ? ' active' : ''}`} id="panel-measurements">
      <div class="left-panel-header">
        <span>{t('leftPanel.measurements') || 'Measurements'}</span>
      </div>

      {/* ── Scale Section ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.scale') || 'Scale'}</span>
        </div>
        <div class="measurements-scale-display">
          <Show when={currentScale()} fallback={
            <span class="measurements-empty">{t('measurements.noScale') || 'No scale set'}</span>
          }>
            <span class="measurements-scale-value">{currentScale()}</span>
          </Show>
        </div>
      </div>

      {/* ── Viewports Section ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.viewports') || 'Viewports'}</span>
          <span class="measurements-count">{viewports().length}</span>
        </div>
        <Show when={viewports().length === 0}>
          <div class="measurements-empty">{t('measurements.noViewports') || 'No viewports defined'}</div>
        </Show>
        <For each={viewports()}>
          {(vp) => (
            <div class="measurements-item" onClick={() => navigateTo(vp)}>
              <div class="measurements-item-icon" style={{ color: '#0066cc' }}>&#9634;</div>
              <div class="measurements-item-info">
                <div class="measurements-item-name">{(vp.name && vp.name !== vp.scaleRatio ? vp.name : scaleDisplayLabel(vp.scaleRatio, vp.unit, { withRatio: false })) || 'Viewport'}</div>
                <div class="measurements-item-detail">
                  {vp.scaleRatio ? scaleDisplayLabel(vp.scaleRatio, vp.unit) : `1px = ${(1/vp.pixelsPerUnit).toFixed(4)} ${vp.unit}`}
                  {' \u2022 Page ' + vp.page}
                </div>
              </div>
              <button class="measurements-item-delete" title="Delete" onClick={(e) => { e.stopPropagation(); deleteViewport(vp); }}>
                &times;
              </button>
            </div>
          )}
        </For>
      </div>

      {/* ── Counts Section (#935) ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.counts')}</span>
          <span class="measurements-count">{countRows().reduce((s, r) => s + r.count, 0)}</span>
        </div>
        <Show when={countRows().length === 0}>
          <div class="measurements-empty">{t('measurements.noCounts')}</div>
        </Show>
        <For each={countRows()}>
          {(r) => (
            <div class="measurements-item" onClick={() => selectCountGroup(r.id)}>
              <div class="measurements-item-icon" style={{ color: r.color }}>&#9679;</div>
              <div class="measurements-item-info">
                <div class="measurements-item-name">{r.id === GEEN_TELGROEP ? t('countGroup.none') : r.name}</div>
                <div class="measurements-item-detail">{t('countGroup.pieces', { count: r.count })}</div>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* ── Measurements Section ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.measurements') || 'Measurements'}</span>
          <span class="measurements-count">{measurements().length}</span>
        </div>
        <Show when={measurements().length === 0}>
          <div class="measurements-empty">{t('measurements.noMeasurements') || 'No measurements yet'}</div>
        </Show>
        <For each={Object.entries(groupedMeasurements())}>
          {([type, items]) => (
            <div class="measurements-group">
              <div class="measurements-group-header">
                <span>{typeLabels[type] || type}</span>
                <span class="measurements-group-total">{totals()[type]}</span>
              </div>
              <For each={items}>
                {(m) => (
                  <div class="measurements-item" classList={{ selected: getActiveDocument()?.selectedAnnotation?.id === m.id }}
                    onClick={() => navigateTo(m)}>
                    <div class="measurements-item-icon">{typeIcons[m.type] || '\u2022'}</div>
                    <div class="measurements-item-info">
                      <div class="measurements-item-name">{m.label || m.measureText || 'Measurement'}</div>
                      <div class="measurements-item-detail">
                        Page {m.page}
                        {m.measureText ? ' \u2022 ' + m.measureText : ''}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
