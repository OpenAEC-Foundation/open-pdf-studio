import { Show, For, onMount, onCleanup } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { scheduleResultToCsv } from '../../quantities/schedule-csv.js';
import { isTauri, saveFileDialog, writeBinaryFile } from '../../core/platform.js';
import { showMessage } from '../stores/dialogStore.js';
import {
  scheduleVisible, setScheduleVisible,
  scheduleResult, grandTotals, appearance,
  setPropertiesVisible,
} from '../stores/quantitiesStore.js';
import QuantitiesProperties from './QuantitiesProperties.jsx';

function formatCell(val, col) {
  if (val == null || val === '') return '';
  if (typeof val === 'number') return Number.isFinite(val) ? val.toFixed(col.decimals ?? 0) : '';
  return String(val);
}
function fmtTotal(val, col) {
  if (val == null) return '';
  return val.toFixed(col.decimals ?? 2) + (col.unit ? ` ${col.unit}` : '');
}

export default function SchedulePanel() {
  const { t } = useTranslation('properties');
  let dialogRef;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function onHeaderMouseDown(e) {
    if (e.target.closest('.modal-close-btn') || e.target.closest('.schedule-header-btn')) return;
    isDragging = true;
    const rect = dialogRef.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isDragging) return;
    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;
    const dialogRect = dialogRef.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, window.innerWidth - dialogRect.width));
    newY = Math.max(0, Math.min(newY, window.innerHeight - dialogRect.height));
    dialogRef.style.left = newX + 'px';
    dialogRef.style.top = newY + 'px';
    dialogRef.style.transform = 'none';
  }
  function onMouseUp() { isDragging = false; }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  onCleanup(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });

  // Lege staat → duidelijke melding in plaats van stilte. Retourneert het
  // resultaat als er iets te exporteren valt, anders null.
  function exportableResult() {
    const r = scheduleResult();
    if (!r.columns.length) { showMessage(t('quantities.noFields'), t('quantities.title')); return null; }
    if (!r.count) { showMessage(t('quantities.noElements'), t('quantities.title')); return null; }
    return r;
  }

  async function exportCSV() {
    const r = exportableResult();
    if (!r) return;
    // BOM zodat Excel het bestand als UTF-8 opent.
    const csv = '﻿' + scheduleResultToCsv(r);
    const bytes = new TextEncoder().encode(csv);
    const fileName = t('quantities.csvFileName');
    if (!isTauri()) {
      // Web-fallback: browser-download via blob-anchor.
      const blob = new Blob([bytes], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    // Tauri: blob-anchor-downloads doen niets in WebView2 — gebruik de
    // save-dialoog + fs-plugin (zelfde pad als de andere exports).
    const path = await saveFileDialog(fileName, [{ name: 'CSV', extensions: ['csv'] }]);
    if (!path) return;
    await writeBinaryFile(path, bytes);
  }

  function placeOnPdf() {
    const doc = getActiveDocument();
    if (!doc) return;
    const r = exportableResult();
    if (!r) return;
    const rows = [];
    for (const g of r.groups) {
      if (g.key !== null) rows.push({ group: true, cells: [`${g.key} (${g.rows.length})`] });
      if (r.itemize) for (const row of g.rows) rows.push({ cells: r.columns.map(c => formatCell(row.vals[c.key], c)) });
      rows.push({ total: true, cells: r.columns.map((c, i) => i === 0 ? t('quantities.subtotal') : fmtTotal(g.subtotals[c.key], c)) });
    }
    const ann = createAnnotation({
      type: 'scheduleTable', page: doc.currentPage, x: 50, y: 50,
      width: Math.max(300, r.columns.length * 90), height: 24 + (rows.length + 1) * 18,
      title: t('quantities.title'),
      columns: r.columns.map(c => c.label + (c.unit ? ` (${c.unit})` : '')),
      rows,
      color: '#000000', lineWidth: 0.5, opacity: 1,
    });
    doc.annotations.push(ann);
    recordAdd(ann);
    import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
  }

  return (
    <Show when={scheduleVisible()}>
      <div ref={dialogRef} class="modal-dialog schedule-modeless" role="dialog" aria-label={t('quantities.title')}>
        {/* Header */}
        <div class="modal-header" onMouseDown={onHeaderMouseDown}>
          <h2>{t('quantities.title')}</h2>
          <div style={{ display: 'flex', gap: '0', 'align-items': 'center', height: '100%' }}>
            <button class="schedule-header-btn" title={t('quantities.properties')} onClick={() => setPropertiesVisible(true)}>⚙ {t('quantities.properties')}</button>
            <button class="schedule-header-btn" title={t('quantities.placeOnPdf')} onClick={placeOnPdf}>PDF</button>
            <button class="schedule-header-btn" title={t('quantities.exportCsv')} onClick={exportCSV}>CSV</button>
            <button class="modal-close-btn" title={t('quantities.close')} onClick={() => setScheduleVisible(false)}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" /></svg>
            </button>
          </div>
        </div>

        {/* Schedule */}
        <div class="schedule-body">
          <Show when={appearance().showTitle}>
            <div class="q-title">{t('quantities.title')}</div>
          </Show>
          <Show when={scheduleResult().columns.length > 0}
            fallback={<div class="schedule-empty">{t('quantities.noFields')}</div>}>
            <Show when={scheduleResult().count > 0}
              fallback={<div class="schedule-empty">{t('quantities.noElements')}</div>}>
              <table class="schedule-table q-table"
                classList={{ 'q-gridlines': appearance().gridlines, 'q-outline': appearance().outline }}>
                <Show when={appearance().showHeaders}>
                  <thead><tr>
                    <For each={scheduleResult().columns}>
                      {(col) => <th class={col.align === 'right' ? 'schedule-val' : ''}>{col.label}{col.unit ? ` (${col.unit})` : ''}</th>}
                    </For>
                  </tr></thead>
                </Show>
                <For each={scheduleResult().groups}>
                  {(group) => (
                    <tbody>
                      <Show when={group.key !== null}>
                        <tr class="q-group-row">
                          <td colspan={scheduleResult().columns.length}>{group.key} <span class="schedule-group-count">({group.rows.length})</span></td>
                        </tr>
                      </Show>
                      <Show when={scheduleResult().itemize}>
                        <For each={group.rows}>
                          {(row, i) => (
                            <tr classList={{ 'q-stripe': appearance().stripe && i() % 2 === 1 }}>
                              <For each={scheduleResult().columns}>
                                {(col) => <td class={col.align === 'right' ? 'schedule-val' : ''}>{formatCell(row.vals[col.key], col)}</td>}
                              </For>
                            </tr>
                          )}
                        </For>
                      </Show>
                      <tr class="schedule-total-row">
                        <For each={scheduleResult().columns}>
                          {(col, i) => (
                            <td class={col.align === 'right' ? 'schedule-val' : ''}>
                              {i() === 0 ? (group.key !== null ? `Σ ${group.key}` : t('quantities.subtotal')) : fmtTotal(group.subtotals[col.key], col)}
                            </td>
                          )}
                        </For>
                      </tr>
                    </tbody>
                  )}
                </For>
                <Show when={grandTotals()}>
                  <tbody>
                    <tr class="schedule-total-row q-grand">
                      <For each={scheduleResult().columns}>
                        {(col, i) => (
                          <td class={col.align === 'right' ? 'schedule-val' : ''}>
                            {i() === 0 ? t('quantities.grandTotal') : fmtTotal(scheduleResult().grandTotals[col.key], col)}
                          </td>
                        )}
                      </For>
                    </tr>
                  </tbody>
                </Show>
              </table>
            </Show>
          </Show>
        </div>

        {/* Footer */}
        <div class="schedule-footer">
          <span>{scheduleResult().count} {t('quantities.elements')}</span>
        </div>
      </div>

      <QuantitiesProperties />
    </Show>
  );
}
