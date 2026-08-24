// Staten-wizard (issue #209): een verplaatsbare, Windows-stijl modal die de
// config van één benoemde staat bewerkt in stappen —
// Categorieën → Filter → Groeperen/Sorteren → Weergave/Totalen.
// Elke wijziging schrijft live naar schedulesStore (persist + reactief), zodat
// het staten-paneel de tabel meteen bijwerkt. De 6 standaard-sjablonen vullen
// deze config voor (via addScheduleFromTemplate) en blijven zo werken.
import { Show, For, createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { CATEGORY_ORDER, categoryLabel, fieldsForCategories } from '../../quantities/categories.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  schedules, configuringId, setConfiguringId, updateScheduleConfig,
} from '../stores/schedulesStore.js';

const STEPS = [
  { id: 'cats', key: 'wizard.stepCategories' },
  { id: 'filter', key: 'wizard.stepFilter' },
  { id: 'group', key: 'wizard.stepGroup' },
  { id: 'display', key: 'wizard.stepDisplay' },
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

const SLOTS_FILTER = [0, 1, 2, 3, 4, 5];
const SLOTS_SORT = [0, 1, 2, 3];

export default function ScheduleWizard() {
  const { t } = useTranslation('properties');
  const [step, setStep] = createSignal(0);
  const [availSel, setAvailSel] = createSignal(null);
  const [schedSel, setSchedSel] = createSignal(null);

  const current = createMemo(() => schedules().find(s => s.id === configuringId()) || null);
  const cfg = createMemo(() => current()?.config || {});

  // Reset naar eerste stap wanneer een andere staat geopend wordt.
  let lastId = null;
  createEffect(() => {
    const id = configuringId();
    if (id && id !== lastId) { lastId = id; setStep(0); setAvailSel(null); setSchedSel(null); }
  });

  // --- config-mutatie (live persist) ---
  function patch(part) {
    const c = current();
    if (!c) return;
    updateScheduleConfig(c.id, { ...cfg(), ...part });
  }

  const categories = () => cfg().categories || [];
  const fields = () => cfg().fields || [];
  const filters = () => cfg().filters || [];
  const sort = () => cfg().sort || [];

  const allFields = () => fieldsForCategories(categories());
  const availableFields = () => {
    const sel = new Set(fields());
    return allFields().filter(f => !sel.has(f.key));
  };
  const scheduledFieldDefs = () => {
    const all = allFields();
    return fields().map(k => all.find(f => f.key === k)).filter(Boolean);
  };

  function toggleCat(cat) {
    const cur = categories();
    const next = cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat];
    // Velden die niet meer bestaan onder de nieuwe categorieën verwijderen.
    const valid = new Set(fieldsForCategories(next).map(f => f.key));
    patch({ categories: next, fields: fields().filter(k => valid.has(k)) });
  }

  function addField() {
    const k = availSel();
    if (k && !fields().includes(k)) { patch({ fields: [...fields(), k] }); setAvailSel(null); }
  }
  function removeField() {
    const k = schedSel();
    if (k) { patch({ fields: fields().filter(x => x !== k) }); setSchedSel(null); }
  }
  function moveSched(dir) {
    const k = schedSel();
    const arr = [...fields()];
    const i = arr.indexOf(k), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    patch({ fields: arr });
  }

  // --- Filter ---
  const filterAt = (i) => filters()[i] || { field: '', op: '', value: '' };
  function setFilterAt(i, p) {
    const arr = [...filters()];
    while (arr.length <= i) arr.push({ field: '', op: '', value: '' });
    arr[i] = { ...arr[i], ...p };
    patch({ filters: arr });
  }

  // --- Sort/Group ---
  const sortAt = (i) => sort()[i] || { field: '', dir: 'asc', group: false };
  function setSortAt(i, p) {
    const arr = [...sort()];
    while (arr.length <= i) arr.push({ field: '', dir: 'asc', group: false });
    arr[i] = { ...arr[i], ...p };
    patch({ sort: arr });
  }

  // --- Draggable, Windows-stijl modal (sluit niet bij buitenklik) ---
  let dialogRef;
  let dragging = false, offX = 0, offY = 0;
  function onHeaderDown(e) {
    if (e.target.closest('.modal-close-btn')) return;
    dragging = true;
    const r = dialogRef.getBoundingClientRect();
    offX = e.clientX - r.left; offY = e.clientY - r.top;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    let nx = e.clientX - offX, ny = e.clientY - offY;
    const r = dialogRef.getBoundingClientRect();
    nx = Math.max(0, Math.min(nx, window.innerWidth - r.width));
    ny = Math.max(0, Math.min(ny, window.innerHeight - r.height));
    dialogRef.style.left = nx + 'px';
    dialogRef.style.top = ny + 'px';
    dialogRef.style.transform = 'none';
  }
  function onUp() { dragging = false; }
  onMount(() => { document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
  onCleanup(() => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); });

  function close() { setConfiguringId(null); }

  return (
    <Show when={current()}>
      <div ref={dialogRef} class="modal-dialog q-props-dialog schedule-wizard" role="dialog" aria-label={t('wizard.title')}>
        <div class="modal-header" onMouseDown={onHeaderDown}>
          <h2>{t('wizard.title')} — {current().name}</h2>
          <button class="modal-close-btn" onClick={close} title={t('wizard.close')}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" /></svg>
          </button>
        </div>

        {/* Stap-indicator */}
        <div class="q-tabs sched-wizard-steps">
          <For each={STEPS}>
            {(s, i) => (
              <button class="q-tab" classList={{ active: step() === i() }} onClick={() => setStep(i())}>
                {i() + 1}. {t(s.key)}
              </button>
            )}
          </For>
        </div>

        <div class="q-tab-body">
          {/* 1. Categorieën */}
          <Show when={STEPS[step()].id === 'cats'}>
            <div class="q-row-label">{t('wizard.pickCategories')}</div>
            <div class="q-cats">
              <For each={CATEGORY_ORDER}>
                {(cat) => (
                  <label class="q-check">
                    <input type="checkbox" checked={categories().includes(cat)} onChange={() => toggleCat(cat)} />
                    {categoryLabel(cat)}
                  </label>
                )}
              </For>
            </div>
          </Show>

          {/* 2. Filter */}
          <Show when={STEPS[step()].id === 'filter'}>
            <div class="q-row-label">{t('wizard.filterHint')}</div>
            <Show when={allFields().length > 0} fallback={<div class="schedule-empty">{t('wizard.pickCatsFirst')}</div>}>
              <For each={SLOTS_FILTER}>
                {(i) => (
                  <div class="q-filter-row">
                    <span class="q-and">{i === 0 ? t('wizard.filterLabel') : t('wizard.andLabel')}</span>
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
          </Show>

          {/* 3. Groeperen/Sorteren */}
          <Show when={STEPS[step()].id === 'group'}>
            <Show when={allFields().length > 0} fallback={<div class="schedule-empty">{t('wizard.pickCatsFirst')}</div>}>
              <For each={SLOTS_SORT}>
                {(i) => (
                  <div class="q-filter-row">
                    <span class="q-and">{i === 0 ? t('wizard.sortLabel') : t('wizard.thenLabel')}</span>
                    <select class="schedule-select" value={sortAt(i).field} onChange={(e) => setSortAt(i, { field: e.target.value })}>
                      <option value="">{t('op.none')}</option>
                      <For each={allFields()}>{(f) => <option value={f.key}>{f.label}</option>}</For>
                    </select>
                    <select class="schedule-select" value={sortAt(i).dir} onChange={(e) => setSortAt(i, { dir: e.target.value })}>
                      <option value="asc">{t('wizard.asc')}</option>
                      <option value="desc">{t('wizard.desc')}</option>
                    </select>
                    <label class="q-check"><input type="checkbox" checked={!!sortAt(i).group}
                      onChange={(e) => setSortAt(i, { group: e.target.checked, header: e.target.checked, footer: e.target.checked })} /> {t('wizard.group')}</label>
                  </div>
                )}
              </For>
              <div class="q-sep"></div>
              <label class="q-check"><input type="checkbox" checked={cfg().itemize !== false}
                onChange={(e) => patch({ itemize: e.target.checked })} /> {t('wizard.itemize')}</label>
            </Show>
          </Show>

          {/* 4. Weergave/Totalen */}
          <Show when={STEPS[step()].id === 'display'}>
            <Show when={allFields().length > 0} fallback={<div class="schedule-empty">{t('wizard.pickCatsFirst')}</div>}>
              <div class="q-row-label">{t('wizard.chooseColumns')}</div>
              <div class="q-fields-grid">
                <div>
                  <div class="q-row-label">{t('wizard.available')}</div>
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
                  <button class="schedule-btn-sm" title={t('wizard.add')} onClick={addField}>→</button>
                  <button class="schedule-btn-sm" title={t('wizard.remove')} onClick={removeField}>←</button>
                  <button class="schedule-btn-sm" title={t('wizard.up')} onClick={() => moveSched(-1)}>↑</button>
                  <button class="schedule-btn-sm" title={t('wizard.down')} onClick={() => moveSched(1)}>↓</button>
                </div>
                <div>
                  <div class="q-row-label">{t('wizard.shown')}</div>
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
          </Show>
        </div>

        <div class="q-props-footer sched-wizard-footer">
          <button class="schedule-btn-sm" disabled={step() === 0} onClick={() => setStep(Math.max(0, step() - 1))}>{t('wizard.prev')}</button>
          <Show when={step() < STEPS.length - 1}
            fallback={<button class="schedule-btn-sm sched-wizard-done" onClick={close}>{t('wizard.done')}</button>}>
            <button class="schedule-btn-sm" onClick={() => setStep(Math.min(STEPS.length - 1, step() + 1))}>{t('wizard.next')}</button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
