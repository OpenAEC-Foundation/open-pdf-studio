import { For, Show, onMount, createSignal, createMemo } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import {
  schedules, addScheduleFromTemplate, addBlankSchedule, renameSchedule, removeSchedule,
  buildResultForSchedule, setConfiguringId,
  STANDARD_SCHEDULE_TEMPLATES,
} from '../../../stores/schedulesStore.js';
import { initScheduleDrop, SCHEDULE_DND_MIME } from '../../../../quantities/schedule-drop.js';
import { formatCell, fmtTotal, isImageCell } from '../../../../quantities/schedule-templates.js';
import { scheduleResultToCsv } from '../../../../quantities/schedule-csv.js';
import { saveFileDialog, writeBinaryFile } from '../../../../core/platform.js';
import ScheduleWizard from '../../ScheduleWizard.jsx';

export default function SchedulesPanel() {
  const { t } = useTranslation('properties');
  const [tpl, setTpl] = createSignal(STANDARD_SCHEDULE_TEMPLATES[0].id);
  const [editingId, setEditingId] = createSignal(null);
  const [expandedId, setExpandedId] = createSignal(null);

  // De drop-handler op de viewer is globaal; één keer ophangen bij mount.
  onMount(() => initScheduleDrop());

  // Reactief resultaat van de uitgeklapte staat: leest de (mutable) annotaties
  // en telcategorieën, dus werkt live bij toevoegen/wijzigen/verwijderen.
  const previewResult = createMemo(() => {
    const id = expandedId();
    if (!id) return null;
    const s = schedules().find(x => x.id === id);
    return s ? buildResultForSchedule(s) : null;
  });

  function addSelected() {
    const def = STANDARD_SCHEDULE_TEMPLATES.find(x => x.id === tpl());
    if (!def) return;
    addScheduleFromTemplate(def.id, t(def.nameKey));
  }

  function addBlankAndConfigure() {
    const item = addBlankSchedule(t('schedules.newName'));
    if (item) { setExpandedId(item.id); setConfiguringId(item.id); }
  }

  function onDragStart(e, s) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(SCHEDULE_DND_MIME, s.id);
    e.dataTransfer.setData('text/plain', s.name);
  }

  function commitRename(s, value) {
    const name = (value || '').trim();
    if (name) renameSchedule(s.id, name);
    setEditingId(null);
  }

  function toggleExpand(id) {
    setExpandedId(expandedId() === id ? null : id);
  }

  async function exportCsv(s) {
    const r = buildResultForSchedule(s);
    if (!r || !r.columns.length) return;
    const csv = '﻿' + scheduleResultToCsv(r); // BOM voor Excel/UTF-8
    const safe = (s.name || t('schedules.newName')).replace(/[\\/:*?"<>|]/g, '_');
    const path = await saveFileDialog(`${safe}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
    if (!path) return;
    await writeBinaryFile(path, new TextEncoder().encode(csv));
  }

  return (
    <div class={`left-panel-content${activeTab() === 'schedules' ? ' active' : ''}`} id="panel-schedules">
      <div class="left-panel-header">
        <span>{t('schedules.title')}</span>
      </div>

      {/* Toevoegen vanaf standaard-sjabloon + nieuwe (blanco) wizard */}
      <div class="schedules-add">
        <select class="schedules-tpl-select" value={tpl()} onChange={(e) => setTpl(e.currentTarget.value)}>
          <For each={STANDARD_SCHEDULE_TEMPLATES}>
            {(def) => <option value={def.id}>{t(def.nameKey)}</option>}
          </For>
        </select>
        <button class="schedules-add-btn" title={t('schedules.add')} onClick={addSelected}>+</button>
        <button class="schedules-add-btn" title={t('wizard.newSchedule')} onClick={addBlankAndConfigure}>⚙</button>
      </div>

      {/* Lijst van staten */}
      <Show when={schedules().length > 0}
        fallback={<div class="measurements-empty">{t('schedules.empty')}</div>}>
        <div class="schedules-hint">{t('schedules.dragHint')}</div>
        <For each={schedules()}>
          {(s) => (
            <div class="schedules-entry">
              <div class="schedules-item" draggable={editingId() !== s.id} onDragStart={(e) => onDragStart(e, s)} title={t('schedules.dragHint')}>
                <span class="schedules-grip" innerHTML={gripIcon}></span>
                <button class="schedules-item-btn schedules-expand" title={t('schedules.preview')}
                  onClick={() => toggleExpand(s.id)}>{expandedId() === s.id ? '▾' : '▸'}</button>
                <Show when={editingId() === s.id}
                  fallback={
                    <span class="schedules-name" onDblClick={() => setEditingId(s.id)}>{s.name}</span>
                  }>
                  <input
                    class="schedules-rename-input"
                    value={s.name}
                    autofocus
                    onBlur={(e) => commitRename(s, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(s, e.currentTarget.value);
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                </Show>
                <button class="schedules-item-btn" title={t('wizard.configure')}
                  onClick={() => setConfiguringId(s.id)}>⚙</button>
                <button class="schedules-item-btn" title={t('schedules.exportCsv')}
                  onClick={() => exportCsv(s)}>⭳</button>
                <button class="schedules-item-btn" title={t('schedules.rename')}
                  onClick={() => setEditingId(s.id)}>{renameIcon}</button>
                <button class="schedules-item-btn schedules-item-del" title={t('schedules.delete')}
                  onClick={() => { if (expandedId() === s.id) setExpandedId(null); removeSchedule(s.id); }}>&times;</button>
              </div>

              {/* Inline voorbeeld-tabel met thumbnails, live bijgewerkt */}
              <Show when={expandedId() === s.id && previewResult()}>
                {(r) => (
                  <div class="schedules-preview">
                    <Show when={r().columns.length > 0}
                      fallback={<div class="schedule-empty">{t('wizard.noColumns')}</div>}>
                      <Show when={r().count > 0}
                        fallback={<div class="schedule-empty">{t('wizard.noElements')}</div>}>
                        <table class="schedules-preview-table">
                          <thead><tr>
                            <For each={r().columns}>
                              {(col) => <th class={col.align === 'right' ? 'sp-num' : ''}>{col.label}{col.unit ? ` (${col.unit})` : ''}</th>}
                            </For>
                          </tr></thead>
                          <For each={r().groups}>
                            {(group) => (
                              <tbody>
                                <Show when={group.key !== null}>
                                  <tr class="sp-group"><td colspan={r().columns.length}>{group.key} <span class="sp-count">({group.rows.length})</span></td></tr>
                                </Show>
                                <Show when={r().itemize}>
                                  <For each={group.rows}>
                                    {(row) => (
                                      <tr>
                                        <For each={r().columns}>
                                          {(col) => (
                                            <td class={col.align === 'right' ? 'sp-num' : ''}>
                                              <Show when={col.kind === 'image' && isImageCell(row.vals[col.key])}
                                                fallback={formatCell(row.vals[col.key], col)}>
                                                <img class="sp-thumb" src={row.vals[col.key]} alt="" loading="lazy" />
                                              </Show>
                                            </td>
                                          )}
                                        </For>
                                      </tr>
                                    )}
                                  </For>
                                </Show>
                                <tr class="sp-total">
                                  <For each={r().columns}>
                                    {(col, i) => (
                                      <td class={col.align === 'right' ? 'sp-num' : ''}>
                                        {i() === 0 ? (group.key !== null ? `Σ ${group.key}` : t('wizard.subtotal')) : fmtTotal(group.subtotals[col.key], col)}
                                      </td>
                                    )}
                                  </For>
                                </tr>
                              </tbody>
                            )}
                          </For>
                          <tbody>
                            <tr class="sp-total sp-grand">
                              <For each={r().columns}>
                                {(col, i) => (
                                  <td class={col.align === 'right' ? 'sp-num' : ''}>
                                    {i() === 0 ? t('wizard.grandTotal') : fmtTotal(r().grandTotals[col.key], col)}
                                  </td>
                                )}
                              </For>
                            </tr>
                          </tbody>
                        </table>
                        <div class="schedules-preview-foot">{r().count} {t('wizard.elements')}</div>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>
      </Show>

      <ScheduleWizard />
    </div>
  );
}

const gripIcon = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/></svg>`;
const renameIcon = '✎';
