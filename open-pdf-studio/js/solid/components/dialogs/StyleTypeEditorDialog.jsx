import { For, Show, createSignal, createMemo } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { styleTypesFor, STYLE_TYPES } from '../../../annotations/style-types.js';
import { PreviewSwatch } from '../properties-panel/DimensionTypeSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Style-type editor — "Bewerken…" from the type picker. Edits are stored as
// per-id OVERRIDES on top of the built-in presets (preferences
// .customStyleTypes[annType][id]); fully new types live in
// .customStyleTypesExtra[annType]. Built-ins can be reset; extras deleted.
// Visual styling lives in dialogs.css (.ste-*) and follows the standard
// Windows dialog pattern (scale-btn footer buttons, surface inputs).

const MM_TO_PT = 72 / 25.4;
const KIND_TITLE_KEYS = {
  line: 'styleType.lineTypes', arrow: 'styleType.arrowTypes',
  measureDistance: 'styleType.dimensionTypes', filledArea: 'styleType.hatchTypes',
};

export default function StyleTypeEditorDialog(props) {
  const { t } = useTranslation('dialogs');
  const annType = props.data?.annType || 'line';
  const [version, setVersion] = createSignal(0); // bump to refresh list

  const list = createMemo(() => { void version(); return styleTypesFor(annType) || []; });
  const builtinIds = new Set((STYLE_TYPES[annType] || []).map(e => e.id));

  function prefsBag() {
    const p = state.preferences;
    if (!p.customStyleTypes) p.customStyleTypes = {};
    if (!p.customStyleTypes[annType]) p.customStyleTypes[annType] = {};
    if (!p.customStyleTypesExtra) p.customStyleTypesExtra = {};
    if (!p.customStyleTypesExtra[annType]) p.customStyleTypesExtra[annType] = [];
    return p;
  }

  function writeEntry(id, patch) {
    const p = prefsBag();
    if (builtinIds.has(id)) {
      const cur = p.customStyleTypes[annType][id] || {};
      p.customStyleTypes[annType][id] = {
        ...cur,
        ...('label' in patch ? { label: patch.label } : {}),
        ...('color' in patch ? { color: patch.color } : {}),
        props: { ...(cur.props || {}), ...(patch.props || {}) },
      };
    } else {
      const arr = p.customStyleTypesExtra[annType];
      const i = arr.findIndex(e => e.id === id);
      if (i >= 0) {
        arr[i] = {
          ...arr[i],
          ...('label' in patch ? { label: patch.label } : {}),
          ...('color' in patch ? { color: patch.color } : {}),
          props: { ...arr[i].props, ...(patch.props || {}) },
        };
      }
    }
    savePreferences();
    setVersion(v => v + 1);
  }

  function resetEntry(id) {
    const p = prefsBag();
    delete p.customStyleTypes[annType][id];
    savePreferences();
    setVersion(v => v + 1);
  }

  function deleteExtra(id) {
    const p = prefsBag();
    p.customStyleTypesExtra[annType] = p.customStyleTypesExtra[annType].filter(e => e.id !== id);
    savePreferences();
    setVersion(v => v + 1);
  }

  function addNew() {
    const p = prefsBag();
    const base = list()[0];
    const id = `custom-${Date.now().toString(36)}`;
    p.customStyleTypesExtra[annType].push({
      id,
      label: t('styleType.newType'),
      color: base?.color || '#000000',
      props: { ...(base?.props || {}), styleType: undefined },
    });
    savePreferences();
    setVersion(v => v + 1);
  }

  const ptToMm = (pt) => Math.round(((pt || 0) / MM_TO_PT) * 100) / 100;
  const mmToPt = (mm) => Math.round((parseFloat(String(mm).replace(',', '.')) || 0) * MM_TO_PT * 100) / 100;

  // Column layout per kind keeps the rows aligned like a table.
  const gridCols = annType === 'filledArea'
    ? '68px 1fr 44px 52px 56px 28px'   // preview | naam | kleur | bg | schaal | acties
    : annType === 'measureDistance'
      ? '68px 1fr 44px 64px 60px 28px' // preview | naam | kleur | tekst | unit | acties
      : '68px 1fr 44px 64px 92px 28px'; // preview | naam | kleur | dikte | stijl | acties

  const kindTitle = () => (KIND_TITLE_KEYS[annType] ? t(KIND_TITLE_KEYS[annType]) : t('styleType.genericTypes'));

  return (
    <Dialog
      title={t('styleType.editTitle', { kind: kindTitle() })}
      dialogClass="style-type-editor-dialog"
      onClose={() => closeDialog('style-type-editor')}
      footer={
        <>
          <button class="scale-btn" onClick={addNew}>{t('styleType.addNewType')}</button>
          <button class="scale-btn scale-btn-ok"
            onClick={() => closeDialog('style-type-editor')}>{t('styleType.close')}</button>
        </>
      }
    >
      <div class="ste-table">
        {/* Column headers */}
        <div class="ste-row ste-head" style={`grid-template-columns:${gridCols}`}>
          <span class="ste-col-lbl">{t('styleType.preview')}</span>
          <span class="ste-col-lbl">{t('styleType.name')}</span>
          <span class="ste-col-lbl">{t('styleType.color')}</span>
          <Show when={annType === 'line' || annType === 'arrow'}>
            <span class="ste-col-lbl">{t('styleType.thicknessMm')}</span><span class="ste-col-lbl">{t('styleType.style')}</span>
          </Show>
          <Show when={annType === 'measureDistance'}>
            <span class="ste-col-lbl">{t('styleType.textMm')}</span><span class="ste-col-lbl">{t('styleType.unit')}</span>
          </Show>
          <Show when={annType === 'filledArea'}>
            <span class="ste-col-lbl">{t('styleType.background')}</span><span class="ste-col-lbl">{t('styleType.scale')}</span>
          </Show>
          <span />
        </div>

        <For each={list()}>
          {(d) => (
            <div class="ste-row" style={`grid-template-columns:${gridCols}`}>
              <PreviewSwatch annType={annType} entry={d} />
              <input type="text" class="ste-field" value={d.label}
                onChange={(e) => writeEntry(d.id, { label: e.target.value })} />
              <input type="color" class="ste-color" value={(d.color || '#000000').slice(0, 7)} title={t('styleType.color')}
                onChange={(e) => {
                  const c = e.target.value;
                  const props = annType === 'filledArea'
                    ? { hatchColor: c, strokeColor: c, color: c }
                    : { color: c, strokeColor: c };
                  writeEntry(d.id, { color: c, props });
                }} />

              <Show when={annType === 'line' || annType === 'arrow'}>
                <input type="number" class="ste-field" step="0.05" min="0.05" value={ptToMm(d.props?.lineWidth)}
                  onChange={(e) => writeEntry(d.id, { props: { lineWidth: mmToPt(e.target.value) } })} />
                <select class="ste-field" value={d.props?.borderStyle || 'solid'}
                  onChange={(e) => writeEntry(d.id, { props: { borderStyle: e.target.value } })}>
                  <option value="solid">solid</option>
                  <option value="dashed">dashed</option>
                  <option value="dotted">dotted</option>
                  <option value="dash-dot">dash-dot</option>
                  <option value="long-dash">long-dash</option>
                </select>
              </Show>

              <Show when={annType === 'measureDistance'}>
                <input type="number" class="ste-field" step="0.1" min="1" value={ptToMm(d.props?.fontSize)}
                  onChange={(e) => writeEntry(d.id, { props: { fontSize: Math.round(mmToPt(e.target.value)) } })} />
                <select class="ste-field" value={d.props?.measureUnit || 'mm'}
                  onChange={(e) => writeEntry(d.id, { props: { measureUnit: e.target.value } })}>
                  <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
                </select>
              </Show>

              <Show when={annType === 'filledArea'}>
                <div class="ste-bg-cell">
                  <input type="color" class="ste-color" value={(d.props?.fillColor || '#ffffff').slice(0, 7)} title={t('styleType.backgroundColor')}
                    onChange={(e) => writeEntry(d.id, { props: { fillColor: e.target.value } })} />
                  <input type="checkbox" title={t('styleType.noBackground')} checked={!d.props?.fillColor}
                    onChange={(e) => writeEntry(d.id, { props: { fillColor: e.target.checked ? null : '#ffffff' } })} />
                </div>
                <input type="number" class="ste-field" step="5" min="10" max="600" value={d.props?.hatchScale ?? 100}
                  onChange={(e) => writeEntry(d.id, { props: { hatchScale: parseInt(e.target.value) || 100 } })} />
              </Show>

              <Show when={builtinIds.has(d.id)} fallback={
                <button class="ste-action-btn ste-delete" title={t('styleType.deleteType')}
                  onClick={() => deleteExtra(d.id)}>✕</button>
              }>
                <Show when={(state.preferences.customStyleTypes?.[annType] || {})[d.id]} fallback={<span />}>
                  <button class="ste-action-btn" title={t('styleType.resetDefault')}
                    onClick={() => resetEntry(d.id)}>↺</button>
                </Show>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
