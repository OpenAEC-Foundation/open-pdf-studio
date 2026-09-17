import { Show, For, createSignal, createEffect } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, getLineWidthLabel, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import Dialog from '../Dialog.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import {
  getStylePresets, createStylePreset, deleteStylePreset, renameStylePreset,
  applyStylePresetById, copyStyleFromSelection, pasteStyleToSelection, copiedStyle,
} from '../../stores/stylePresetsStore.js';

export default function AppearanceSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  // ── Benoemde lijnstijl-presets (issue #268) ──────────────────────────────
  const [createOpen, setCreateOpen] = createSignal(false);
  const [manageOpen, setManageOpen] = createSignal(false);
  const [presetName, setPresetName] = createSignal('');
  let nameInputRef;

  const presets = () => getStylePresets();
  // Preset-UI alleen tonen wanneer de sectie echte stijl-controls bevat.
  const showsStyleControls = () =>
    sectionVis.fillColorGroup || sectionVis.strokeColorGroup || sectionVis.colorGroup ||
    sectionVis.opacityGroup || sectionVis.lineWidthGroup || sectionVis.borderStyleGroup;

  const handleApplyPreset = (e) => {
    const id = e.target.value;
    if (id) applyStylePresetById(id);
    // Terug naar de placeholder zodat dezelfde preset opnieuw gekozen kan worden.
    e.target.selectedIndex = 0;
  };

  const openCreateDialog = () => {
    setPresetName(`${t('stylePresets.defaultName')} ${presets().length + 1}`);
    setCreateOpen(true);
    requestAnimationFrame(() => { nameInputRef?.focus(); nameInputRef?.select(); });
  };

  const confirmCreate = () => {
    if (createStylePreset(presetName())) setCreateOpen(false);
  };

  return (
    <Show when={sectionVis.appearance}>
      <CollapsibleSection title={t('appearance.title')} name="appearance" id="prop-appearance-section">
        <Show when={showsStyleControls()}>
          <div class="property-group">
            <label>{t('stylePresets.label')}</label>
            <div class="style-preset-row">
              <select
                id="prop-style-preset-select"
                disabled={isLocked() || presets().length === 0}
                onChange={handleApplyPreset}
              >
                <option value="">
                  {presets().length > 0 ? t('stylePresets.applyPlaceholder') : t('stylePresets.noPresets')}
                </option>
                <For each={presets()}>
                  {(p) => <option value={p.id}>{p.name}</option>}
                </For>
              </select>
              <button
                class="prop-action-btn style-preset-manage-btn"
                title={t('stylePresets.manage')}
                disabled={presets().length === 0}
                onClick={() => setManageOpen(true)}
              >{'⋯'}</button>
            </div>
          </div>
        </Show>

        <Show when={sectionVis.iconGroup}>
          <div class="property-group">
            <label>{t('appearance.icon')}</label>
            <select value={annotProps.icon} disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onChange={(e) => updateAnnotProp('icon', e.target.value)}>
              <Show when={annotProps.icon === 'mixed'}>
                <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
              </Show>
              <option value="comment">{t('appearance.iconComment')}</option>
              <option value="note">{t('appearance.iconNote')}</option>
              <option value="help">{t('appearance.iconHelp')}</option>
              <option value="insert">{t('appearance.iconInsert')}</option>
              <option value="key">{t('appearance.iconKey')}</option>
              <option value="newparagraph">{t('appearance.iconNewParagraph')}</option>
              <option value="paragraph">{t('appearance.iconParagraph')}</option>
              <option value="check">{t('appearance.iconCheck')}</option>
              <option value="circle">{t('appearance.iconCircle')}</option>
              <option value="cross">{t('appearance.iconCross')}</option>
              <option value="star">{t('appearance.iconStar')}</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.fillColorGroup}>
          <ColorPalettePicker
            label={t('appearance.fillColor')}
            color={() => annotProps.fillColor}
            showNone={true}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('fillColor', color)}
            onNone={() => updateAnnotProp('fillColor', null)}
          />
        </Show>

        <Show when={sectionVis.strokeColorGroup}>
          <ColorPalettePicker
            label={t('appearance.strokeColor')}
            color={() => annotProps.strokeColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('strokeColor', color)}
          />
        </Show>

        <Show when={sectionVis.colorGroup}>
          <ColorPalettePicker
            label={t('appearance.color')}
            color={() => annotProps.color}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('color', color)}
          />
        </Show>

        <Show when={sectionVis.opacityGroup}>
          <div class="property-group">
            <label>{t('appearance.opacity')}</label>
            <PrefComboBox
              value={() => annotProps.opacity}
              setValue={(val) => updateAnnotProp('opacity', val)}
              options={[100, 90, 80, 70, 60, 50, 40, 30, 20, 10]}
              min={0} max={100} fallback={100} suffix="%"
              disabled={isLocked}
            />
          </div>
        </Show>

        <Show when={sectionVis.lineWidthGroup}>
          <div class="property-group">
            <label>{getLineWidthLabel()}</label>
            <PrefComboBox
              value={() => annotProps.lineWidth}
              setValue={(val) => updateAnnotProp('lineWidth', val)}
              options={[0, 0.5, 1, 2, 3, 4, 6, 8, 10, 12]}
              min={0} max={20} fallback={1} suffix="pt"
              disabled={isLocked}
            />
          </div>
        </Show>

        <Show when={sectionVis.borderStyleGroup}>
          <div class="property-group">
            <label>{t('appearance.borderStyle')}</label>
            <select value={annotProps.borderStyle} disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onChange={(e) => updateAnnotProp('borderStyle', e.target.value)}>
              <Show when={annotProps.borderStyle === 'mixed'}>
                <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
              </Show>
              <option value="solid">{tCommon('solid')}</option>
              <option value="dashed">{tCommon('dashed')}</option>
              <option value="dotted">{tCommon('dotted')}</option>
              <option value="dash-dot">{tCommon('dashDot')}</option>
              <option value="dash-dot-dot">{tCommon('dashDotDot')}</option>
              <option value="long-dash">{tCommon('longDash')}</option>
              <option value="long-dash-dot">{tCommon('longDashDot')}</option>
              <option value="long-dash-dot-dot">{tCommon('longDashDotDot')}</option>
            </select>
          </div>
        </Show>

        {/* 'Continue': aaneengesloten lijnen tekenen. Alleen tonen terwijl het
            lijn-gereedschap actief is (dus niet bij een geselecteerde lijn). */}
        <Show when={state.currentTool === 'line'}>
          <div class="property-group">
            <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', cursor: 'pointer' }}
              title={t('appearance.lineContinueHint')}>
              <input type="checkbox"
                checked={state.preferences?.lineContinue === true}
                onChange={(e) => { state.preferences.lineContinue = e.target.checked; savePreferences(); }} />
              {t('appearance.lineContinue')}
            </label>
          </div>
        </Show>

        {/* Kruis: in een rechthoek of cirkel/ellips (bijv. 'vervalt' of
            'sparing' op een tekening). Round-tript via OPS_Cross. */}
        <Show when={sectionVis.crossGroup}>
          <div class="property-group" title={t('appearance.crossHint')}>
            <label for="prop-cross">{t('appearance.cross')}</label>
            <input type="checkbox" id="prop-cross"
              checked={annotProps.cross === true}
              ref={(el) => createEffect(() => { el.indeterminate = annotProps.cross === 'mixed'; })}
              disabled={isLocked()}
              onChange={(e) => updateAnnotProp('cross', e.target.checked)} />
          </div>
        </Show>

        <Show when={sectionVis.rotationGroup}>
          <div class="property-group">
            <label>{t('appearance.rotation')}</label>
            <PrefComboBox
              value={() => annotProps.rotation}
              setValue={(val) => updateAnnotProp('rotation', val)}
              options={[0, 45, 90, 135, 180, 225, 270, 315]}
              min={-360} max={360} fallback={0} suffix="°"
              disabled={isLocked}
            />
          </div>
        </Show>

        <Show when={showsStyleControls()}>
          <div class="style-preset-actions">
            <button class="prop-action-btn style-preset-btn" id="prop-style-preset-create"
              disabled={isLocked()} onClick={openCreateDialog}>
              {t('stylePresets.create')}
            </button>
          </div>
          <div class="style-preset-actions">
            <button class="prop-action-btn style-preset-btn" onClick={() => copyStyleFromSelection()}>
              {t('stylePresets.copyStyle')}
            </button>
            <button class="prop-action-btn style-preset-btn"
              disabled={!copiedStyle() || isLocked()} onClick={() => pasteStyleToSelection()}>
              {t('stylePresets.pasteStyle')}
            </button>
          </div>
        </Show>
      </CollapsibleSection>

      {/* Naam-dialoog voor "Lijnstijl maken" — Windows-stijl, verplaatsbaar,
          sluit niet bij klik buiten het venster (Dialog.jsx-gedrag). */}
      <Show when={createOpen()}>
        <Dialog
          title={t('stylePresets.createTitle')}
          dialogClass="style-preset-dialog"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <button class="pref-btn pref-btn-secondary" onClick={() => setCreateOpen(false)}>
                {tCommon('cancel')}
              </button>
              <button class="pref-btn pref-btn-primary" disabled={!presetName().trim()} onClick={confirmCreate}>
                {tCommon('ok')}
              </button>
            </>
          }
        >
          <div class="style-preset-name-row">
            <label for="style-preset-name-input">{t('stylePresets.nameLabel')}</label>
            <input
              id="style-preset-name-input"
              ref={nameInputRef}
              type="text"
              value={presetName()}
              onInput={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && presetName().trim()) confirmCreate(); }}
            />
          </div>
        </Dialog>
      </Show>

      {/* Beheer-dialoog: hernoemen (inline) en verwijderen. */}
      <Show when={manageOpen()}>
        <Dialog
          title={t('stylePresets.manageTitle')}
          dialogClass="style-preset-dialog"
          onClose={() => setManageOpen(false)}
          footer={
            <button class="pref-btn pref-btn-primary" onClick={() => setManageOpen(false)}>
              {tCommon('close')}
            </button>
          }
        >
          <div class="style-preset-list">
            <For each={presets()}>
              {(p) => (
                <div class="style-preset-list-row">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => renameStylePreset(p.id, e.target.value)}
                  />
                  <button class="pref-btn" onClick={() => deleteStylePreset(p.id)}>
                    {tCommon('delete')}
                  </button>
                </div>
              )}
            </For>
            <Show when={presets().length === 0}>
              <div class="style-preset-empty">{t('stylePresets.noPresets')}</div>
            </Show>
          </div>
        </Dialog>
      </Show>
    </Show>
  );
}
