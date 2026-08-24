import { Show, For, createSignal, onMount, onCleanup } from 'solid-js';
import { CATEGORY_ORDER, categoryLabel, fieldsForCategories } from '../../quantities/categories.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  propertiesVisible, setPropertiesVisible,
  selectedCategories, setSelectedCategories,
  scheduledFields, setScheduledFields,
  filters, setFilters,
  sortLevels, setSortLevels,
  itemize, setItemize,
  grandTotals, setGrandTotals,
  format, setFormat,
  appearance, setAppearance,
  loadBuiltInText, clearBuiltInText,
} from '../stores/quantitiesStore.js';

const TABS = [
  { id: 'fields', key: 'quantities.tabFields' },
  { id: 'filter', key: 'quantities.tabFilter' },
  { id: 'sort', key: 'quantities.tabSort' },
  { id: 'format', key: 'quantities.tabFormat' },
  { id: 'appearance', key: 'quantities.tabAppearance' },
];

const OPERATORS = [
  { v: '', l: 'op.none' },
  { v: '=', l: 'op.eq' },
  { v: '!=', l: 'op.ne' },
  { v: '>', l: 'op.gt' },
  { v: '>=', l: 'op.ge' },
  { v: '<', l: 'op.lt' },
  { v: '<=', l: 'op.le' },
  { v: 'has', l: 'op.has' },
  { v: 'none', l: 'op.empty' },
];

const SLOTS8 = [0, 1, 2, 3, 4, 5, 6, 7];
const SLOTS4 = [0, 1, 2, 3];

export default function QuantitiesProperties() {
  const { t } = useTranslation('properties');
  const [activeTab, setActiveTab] = createSignal('fields');
  const [availSel, setAvailSel] = createSignal(null);
  const [schedSel, setSchedSel] = createSignal(null);

  let dialogRef;
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  function onHeaderMouseDown(e) {
    if (e.target.closest('.modal-close-btn')) return;
    isDragging = true;
    const rect = dialogRef.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isDragging) return;
    let nx = e.clientX - dragOffsetX, ny = e.clientY - dragOffsetY;
    const r = dialogRef.getBoundingClientRect();
    nx = Math.max(0, Math.min(nx, window.innerWidth - r.width));
    ny = Math.max(0, Math.min(ny, window.innerHeight - r.height));
    dialogRef.style.left = nx + 'px';
    dialogRef.style.top = ny + 'px';
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

  // --- derived ---
  const allFields = () => fieldsForCategories(selectedCategories());
  const availableFields = () => {
    const sched = new Set(scheduledFields());
    return allFields().filter(f => !sched.has(f.key));
  };
  const scheduledFieldDefs = () => {
    const all = allFields();
    return scheduledFields().map(k => all.find(f => f.key === k)).filter(Boolean);
  };

  // --- Velden ---
  function toggleCat(cat) {
    const cur = selectedCategories();
    if (cur.includes(cat)) {
      setSelectedCategories(cur.filter(c => c !== cat));
      if (cat === 'text-built-in') clearBuiltInText();
    } else {
      setSelectedCategories([...cur, cat]);
      if (cat === 'text-built-in') loadBuiltInText();
    }
    const valid = new Set(allFields().map(f => f.key));
    setScheduledFields(scheduledFields().filter(k => valid.has(k)));
  }
  function addField() {
    const k = availSel();
    if (k && !scheduledFields().includes(k)) { setScheduledFields([...scheduledFields(), k]); setAvailSel(null); }
  }
  function removeField() {
    const k = schedSel();
    if (k) { setScheduledFields(scheduledFields().filter(x => x !== k)); setSchedSel(null); }
  }
  function moveSched(dir) {
    const k = schedSel();
    const arr = [...scheduledFields()];
    const i = arr.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setScheduledFields(arr);
  }

  // --- Filter ---
  const filterAt = (i) => filters()[i] || { field: '', op: '', value: '' };
  function setFilterAt(i, patch) {
    const arr = [...filters()];
    while (arr.length < 8) arr.push({ field: '', op: '', value: '' });
    arr[i] = { ...arr[i], ...patch };
    setFilters(arr);
  }

  // --- Sort/Group ---
  const sortAt = (i) => sortLevels()[i] || { field: '', dir: 'asc', group: false };
  function setSortAt(i, patch) {
    const arr = [...sortLevels()];
    while (arr.length < 4) arr.push({ field: '', dir: 'asc', group: false });
    arr[i] = { ...arr[i], ...patch };
    setSortLevels(arr);
  }

  // --- Format ---
  const fmtAt = (key) => format()[key] || {};
  function setFmtAt(key, patch) { setFormat({ ...format(), [key]: { ...(format()[key] || {}), ...patch } }); }

  // --- Appearance ---
  function setApp(patch) { setAppearance({ ...appearance(), ...patch }); }

  return (
    <Show when={propertiesVisible()}>
      <div ref={dialogRef} class="modal-dialog q-props-dialog" role="dialog" aria-label={t('quantities.propertiesTitle')}>
        <div class="modal-header" onMouseDown={onHeaderMouseDown}>
          <h2>{t('quantities.propertiesTitle')}</h2>
          <button class="modal-close-btn" title={t('quantities.close')} onClick={() => setPropertiesVisible(false)}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" /></svg>
          </button>
        </div>

        <div class="q-tabs">
          <For each={TABS}>
            {(tab) => (
              <button class="q-tab" classList={{ active: activeTab() === tab.id }} onClick={() => setActiveTab(tab.id)}>{t(tab.key)}</button>
            )}
          </For>
        </div>

        <div class="q-tab-body">
          {/* ---- Velden ---- */}
          <Show when={activeTab() === 'fields'}>
            <div class="q-row-label">{t('quantities.categories')}</div>
            <div class="q-cats">
              <For each={CATEGORY_ORDER}>
                {(cat) => (
                  <label class="q-check">
                    <input type="checkbox" checked={selectedCategories().includes(cat)} onChange={() => toggleCat(cat)} />
                    {categoryLabel(cat)}
                  </label>
                )}
              </For>
            </div>
            <div class="q-fields-grid">
              <div>
                <div class="q-row-label">{t('quantities.available')}</div>
                <div class="q-listbox">
                  <For each={availableFields()}>
                    {(f) => (
                      <div class="q-listitem" classList={{ sel: availSel() === f.key }}
                        onClick={() => setAvailSel(f.key)} onDblClick={() => { setAvailSel(f.key); addField(); }}>
                        {f.label}{f.unit ? ` (${f.unit})` : ''}
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <div class="q-fields-arrows">
                <button class="schedule-btn-sm" title={t('quantities.add')} onClick={addField}>→</button>
                <button class="schedule-btn-sm" title={t('quantities.remove')} onClick={removeField}>←</button>
                <button class="schedule-btn-sm" title={t('quantities.up')} onClick={() => moveSched(-1)}>↑</button>
                <button class="schedule-btn-sm" title={t('quantities.down')} onClick={() => moveSched(1)}>↓</button>
              </div>
              <div>
                <div class="q-row-label">{t('quantities.scheduled')}</div>
                <div class="q-listbox">
                  <For each={scheduledFieldDefs()}>
                    {(f) => (
                      <div class="q-listitem" classList={{ sel: schedSel() === f.key }}
                        onClick={() => setSchedSel(f.key)} onDblClick={() => { setSchedSel(f.key); removeField(); }}>
                        {f.label}{f.unit ? ` (${f.unit})` : ''}
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Show>

          {/* ---- Filter ---- */}
          <Show when={activeTab() === 'filter'}>
            <div class="q-row-label">{t('quantities.filterHint')}</div>
            <For each={SLOTS8}>
              {(i) => (
                <div class="q-filter-row">
                  <span class="q-and">{i === 0 ? t('quantities.filterLabel') : t('quantities.andLabel')}</span>
                  <select class="schedule-select" value={filterAt(i).field} onChange={(e) => setFilterAt(i, { field: e.target.value })}>
                    <option value="">{t('op.none')}</option>
                    <For each={allFields()}>{(f) => <option value={f.key}>{f.label}</option>}</For>
                  </select>
                  <select class="schedule-select" value={filterAt(i).op} onChange={(e) => setFilterAt(i, { op: e.target.value })}>
                    <For each={OPERATORS}>{(o) => <option value={o.v}>{t(o.l)}</option>}</For>
                  </select>
                  <input class="schedule-input" value={filterAt(i).value ?? ''}
                    disabled={filterAt(i).op === 'has' || filterAt(i).op === 'none' || !filterAt(i).op}
                    onInput={(e) => setFilterAt(i, { value: e.target.value })} />
                </div>
              )}
            </For>
          </Show>

          {/* ---- Sorteren/Groeperen ---- */}
          <Show when={activeTab() === 'sort'}>
            <For each={SLOTS4}>
              {(i) => (
                <div class="q-filter-row">
                  <span class="q-and">{i === 0 ? t('quantities.sortLabel') : t('quantities.thenLabel')}</span>
                  <select class="schedule-select" value={sortAt(i).field} onChange={(e) => setSortAt(i, { field: e.target.value })}>
                    <option value="">{t('op.none')}</option>
                    <For each={allFields()}>{(f) => <option value={f.key}>{f.label}</option>}</For>
                  </select>
                  <select class="schedule-select" value={sortAt(i).dir} onChange={(e) => setSortAt(i, { dir: e.target.value })}>
                    <option value="asc">{t('quantities.asc')}</option>
                    <option value="desc">{t('quantities.desc')}</option>
                  </select>
                  <label class="q-check"><input type="checkbox" checked={!!sortAt(i).group}
                    onChange={(e) => setSortAt(i, { group: e.target.checked, header: e.target.checked, footer: e.target.checked })} /> {t('quantities.group')}</label>
                </div>
              )}
            </For>
            <div class="q-sep"></div>
            <label class="q-check"><input type="checkbox" checked={itemize()} onChange={(e) => setItemize(e.target.checked)} /> {t('quantities.itemize')}</label>
            <label class="q-check"><input type="checkbox" checked={grandTotals()} onChange={(e) => setGrandTotals(e.target.checked)} /> {t('quantities.grandTotals')}</label>
          </Show>

          {/* ---- Opmaak ---- */}
          <Show when={activeTab() === 'format'}>
            <Show when={scheduledFieldDefs().length > 0} fallback={<div class="schedule-empty">{t('quantities.addFieldsFirst')}</div>}>
              <table class="q-format-table">
                <thead><tr><th>{t('quantities.colField')}</th><th>{t('quantities.colHeading')}</th><th>{t('quantities.colUnit')}</th><th>{t('quantities.colDecimals')}</th><th>{t('quantities.colAlign')}</th><th>{t('quantities.colTotal')}</th></tr></thead>
                <tbody>
                  <For each={scheduledFieldDefs()}>
                    {(f) => (
                      <tr>
                        <td>{f.label}</td>
                        <td><input class="schedule-input" value={fmtAt(f.key).heading ?? ''} placeholder={f.label} onInput={(e) => setFmtAt(f.key, { heading: e.target.value })} /></td>
                        <td><input class="schedule-input q-narrow" value={fmtAt(f.key).unit ?? f.unit ?? ''} onInput={(e) => setFmtAt(f.key, { unit: e.target.value })} /></td>
                        <td><input class="schedule-input q-narrow" type="number" min="0" max="6" value={fmtAt(f.key).decimals ?? (f.dec ?? (f.kind === 'number' ? 2 : 0))} onInput={(e) => setFmtAt(f.key, { decimals: parseInt(e.target.value, 10) })} disabled={f.kind !== 'number'} /></td>
                        <td>
                          <select class="schedule-select" value={fmtAt(f.key).align ?? (f.kind === 'number' ? 'right' : 'left')} onChange={(e) => setFmtAt(f.key, { align: e.target.value })}>
                            <option value="left">{t('quantities.alignLeft')}</option>
                            <option value="right">{t('quantities.alignRight')}</option>
                          </select>
                        </td>
                        <td style={{ 'text-align': 'center' }}><input type="checkbox" disabled={f.kind !== 'number'} checked={fmtAt(f.key).total !== false} onChange={(e) => setFmtAt(f.key, { total: e.target.checked })} /></td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>

          {/* ---- Weergave ---- */}
          <Show when={activeTab() === 'appearance'}>
            <label class="q-check"><input type="checkbox" checked={appearance().showTitle} onChange={(e) => setApp({ showTitle: e.target.checked })} /> {t('quantities.showTitle')}</label>
            <label class="q-check"><input type="checkbox" checked={appearance().showHeaders} onChange={(e) => setApp({ showHeaders: e.target.checked })} /> {t('quantities.showHeaders')}</label>
            <label class="q-check"><input type="checkbox" checked={appearance().gridlines} onChange={(e) => setApp({ gridlines: e.target.checked })} /> {t('quantities.gridlines')}</label>
            <label class="q-check"><input type="checkbox" checked={appearance().outline} onChange={(e) => setApp({ outline: e.target.checked })} /> {t('quantities.outline')}</label>
            <label class="q-check"><input type="checkbox" checked={appearance().stripe} onChange={(e) => setApp({ stripe: e.target.checked })} /> {t('quantities.stripe')}</label>
          </Show>
        </div>

        <div class="q-props-footer">
          <button class="schedule-btn-sm" onClick={() => setPropertiesVisible(false)}>{t('quantities.close')}</button>
        </div>
      </div>
    </Show>
  );
}
