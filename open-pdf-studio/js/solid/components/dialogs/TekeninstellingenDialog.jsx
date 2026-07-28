// Tekeninstellingen — beheer van tekeningtypen (regelsets) + toewijzing
// tekeningtype ↔ schaalgebied. Ingang: het tandwiel bij de categorie
// "NL IFC Bouw" op het toolpalette (knop-id `btn-tekeninstellingen`).
//
// V1 (fase 1 van de NL IFC-tekenlaag): regelsets kiezen/dupliceren/
// hernoemen/verwijderen, teksthoogtes en lijndikte per IFC-categorie
// bewerken (papier-mm; de per-schaal-tabel wordt in deze UI op de
// 1:100-kolom bewerkt — andere schalen erven via nearest-scale), en per
// schaalgebied van het actieve document een tekeningtype toewijzen.
// Windows-stijl, compact, beweegbaar, sluit niet bij buiten-klik (Dialog).
import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { IFC_LABELS } from '../../data/ifcCategoryMap.js';
import {
  getTekeningtypenData, saveTekeningtypen,
} from '../../../annotations/drafting-rules.js';
import {
  DEFAULT_SCALE_KEY, TEKST_SOORTEN, duplicateRegelset,
} from '../../../drafting/tekeningtype.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

const NUM_INPUT_STYLE = 'width:64px;box-sizing:border-box;text-align:right';

export default function TekeninstellingenDialog() {
  const { t } = useTranslation('properties');
  const tt = (k, fb) => t(`tekeninstellingen.${k}`) || fb;

  // Bump-teller: state.preferences is createMutable (reactief), maar we
  // forceren na structurele wijzigingen (dupliceren/verwijderen) een
  // herevaluatie van de afgeleide lijsten.
  const [rev, setRev] = createSignal(0);
  const data = () => { rev(); return getTekeningtypenData(); };

  const [selectedId, setSelectedId] = createSignal(getTekeningtypenData().defaultId);
  const current = () =>
    data().regelsets.find(r => r.id === selectedId()) || data().regelsets[0];

  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal('');

  function commit() {
    saveTekeningtypen(data());
    setRev(rev() + 1);
    redraw(); // lijndikte erft live — wijziging direct zichtbaar
  }

  function handleDuplicate() {
    const src = current();
    if (!src) return;
    const copy = duplicateRegelset(src, `${src.name} (${tt('copy', 'kopie')})`);
    data().regelsets.push(copy);
    setSelectedId(copy.id);
    commit();
  }

  function handleDelete() {
    const d = data();
    const cur = current();
    if (!cur || d.regelsets.length <= 1) return;
    d.regelsets = d.regelsets.filter(r => r.id !== cur.id);
    if (d.defaultId === cur.id) d.defaultId = d.regelsets[0].id;
    setSelectedId(d.defaultId);
    commit();
  }

  function handleRename() {
    const cur = current();
    if (!cur) return;
    const name = renameValue().trim();
    if (name) { cur.name = name; commit(); }
    setRenaming(false);
  }

  function setTextHeight(soort, value) {
    const cur = current();
    if (!cur) return;
    const v = parseFloat(String(value).replace(',', '.'));
    if (!cur.textHeightsMm) cur.textHeightsMm = {};
    if (Number.isFinite(v) && v > 0) { cur.textHeightsMm[soort] = v; commit(); }
  }

  function setLineWidth(cat, value) {
    const cur = current();
    if (!cur) return;
    const v = parseFloat(String(value).replace(',', '.'));
    if (!cur.lineWidthsMm) cur.lineWidthsMm = {};
    if (!cur.lineWidthsMm[cat]) cur.lineWidthsMm[cat] = {};
    if (Number.isFinite(v) && v > 0) {
      cur.lineWidthsMm[cat][DEFAULT_SCALE_KEY] = v;
      commit();
    }
  }

  // Categorie-rijen: 'default' bovenaan, daarna de aanwezige categorieën.
  const categories = () => {
    const cur = current();
    const keys = Object.keys(cur?.lineWidthsMm || {});
    return ['default', ...keys.filter(k => k !== 'default').sort()];
  };
  const catLabel = (cat) => cat === 'default'
    ? tt('defaultCategory', 'Overig (default)')
    : `${cat}${IFC_LABELS[cat] ? ` — ${IFC_LABELS[cat]}` : ''}`;
  const lineWidthOf = (cat) => {
    const table = current()?.lineWidthsMm?.[cat] || {};
    const v = table[DEFAULT_SCALE_KEY] ?? Object.values(table)[0];
    return v != null ? String(v) : '';
  };

  // ── Schaalgebieden van het actieve document ──────────────────────────────
  const regions = () => {
    rev();
    const doc = getActiveDocument();
    return (doc?.annotations || []).filter(a => a.type === 'scaleRegion');
  };
  function assignRegion(region, regelsetId) {
    if (regelsetId) region.tekeningtypeId = regelsetId;
    else delete region.tekeningtypeId;
    region.modifiedAt = new Date().toISOString();
    const doc = getActiveDocument();
    if (doc) doc.modified = true;
    setRev(rev() + 1);
    redraw();
  }
  const regionName = (r, i) =>
    `${r.label || `${tt('region', 'Gebied')} ${i + 1}`} (${tt('page', 'pag.')} ${r.page}, ${r.scaleString || '1:100'})`;

  const soortLabels = {
    labels: tt('labels', 'Labels'),
    maatvoering: tt('maatvoering', 'Maatvoering'),
    titels: tt('titels', 'Titels'),
  };

  return (
    <Dialog
      title={tt('title', 'Tekeninstellingen')}
      dialogClass="tekeninstellingen-dialog"
      onClose={() => closeDialog('tekeninstellingen')}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={() => closeDialog('tekeninstellingen')}>
            {tt('close', 'Sluiten')}
          </button>
        </div>
      }
    >
      <div style="min-width:420px;max-height:70vh;overflow-y:auto;font-size:12px">
        {/* Regelset-keuze + beheer */}
        <div class="ai-login-field">
          <label>{tt('regelset', 'Tekeningtype (regelset)')}</label>
          <div style="display:flex;gap:4px;align-items:center">
            <PrefSelect
              value={() => current()?.id || ''}
              setValue={(v) => { setSelectedId(v); setRenaming(false); }}
              options={data().regelsets.map(r => ({
                value: r.id,
                label: r.id === data().defaultId
                  ? `${r.name} (${tt('standard', 'standaard')})` : r.name,
              }))}
              style={{ flex: '1' }}
            />
            <button class="ai-plan-btn" style="width:auto;padding:4px 8px"
              title={tt('duplicate', 'Dupliceren')} onClick={handleDuplicate}>
              {tt('duplicate', 'Dupliceren')}
            </button>
            <button class="ai-plan-btn" style="width:auto;padding:4px 8px"
              title={tt('rename', 'Hernoemen')}
              onClick={() => { setRenameValue(current()?.name || ''); setRenaming(!renaming()); }}>
              {tt('rename', 'Hernoemen')}
            </button>
            <button class="ai-plan-btn" style="width:auto;padding:4px 8px"
              disabled={data().regelsets.length <= 1}
              title={tt('delete', 'Verwijderen')} onClick={handleDelete}>
              {tt('delete', 'Verwijderen')}
            </button>
          </div>
          <Show when={renaming()}>
            <div style="display:flex;gap:4px;margin-top:4px">
              <input type="text" class="ribbon-input" style="flex:1;box-sizing:border-box"
                value={renameValue()} onInput={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); }} />
              <button class="ai-plan-btn" style="width:auto;padding:4px 10px" onClick={handleRename}>OK</button>
            </div>
          </Show>
          <Show when={current() && current().id !== data().defaultId}>
            <button class="ai-plan-btn" style="width:auto;padding:4px 8px;margin-top:4px"
              onClick={() => { data().defaultId = current().id; commit(); }}>
              {tt('makeDefault', 'Als standaard gebruiken (buiten schaalgebieden)')}
            </button>
          </Show>
        </div>

        {/* Teksthoogtes */}
        <div class="ai-login-field">
          <label>{tt('textHeights', 'Teksthoogtes (papier-mm)')}</label>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <For each={TEKST_SOORTEN}>
              {(soort) => (
                <label style="display:flex;align-items:center;gap:4px">
                  <span>{soortLabels[soort]}</span>
                  <input type="number" step="0.1" min="0.5" class="ribbon-input"
                    style={NUM_INPUT_STYLE}
                    value={current()?.textHeightsMm?.[soort] ?? ''}
                    onChange={e => setTextHeight(soort, e.target.value)} />
                </label>
              )}
            </For>
          </div>
        </div>

        {/* Lijndikte per IFC-categorie */}
        <div class="ai-login-field">
          <label>{tt('lineWidths', 'Lijndikte per IFC-categorie (papier-mm, 1:100)')}</label>
          <table style="width:100%;border-collapse:collapse">
            <For each={categories()}>
              {(cat) => (
                <tr>
                  <td style="padding:1px 6px 1px 0">{catLabel(cat)}</td>
                  <td style="width:70px;text-align:right;padding:1px 0">
                    <input type="number" step="0.05" min="0.05" class="ribbon-input"
                      style={NUM_INPUT_STYLE}
                      value={lineWidthOf(cat)}
                      onChange={e => setLineWidth(cat, e.target.value)} />
                  </td>
                </tr>
              )}
            </For>
          </table>
        </div>

        {/* Toewijzing per schaalgebied */}
        <div class="ai-login-field">
          <label>{tt('regions', 'Tekeningtype per schaalgebied')}</label>
          <Show when={regions().length > 0}
            fallback={<div style="opacity:.7">{tt('noRegions', 'Geen schaalgebieden in dit document.')}</div>}>
            <For each={regions()}>
              {(r, i) => (
                <div style="display:flex;gap:6px;align-items:center;margin:2px 0">
                  <span style="flex:1">{regionName(r, i())}</span>
                  <PrefSelect
                    value={() => r.tekeningtypeId || ''}
                    setValue={(v) => assignRegion(r, v)}
                    options={[
                      { value: '', label: tt('standardOption', '(standaard-regelset)') },
                      ...data().regelsets.map(rs => ({ value: rs.id, label: rs.name })),
                    ]}
                    style={{ width: '200px' }}
                  />
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
