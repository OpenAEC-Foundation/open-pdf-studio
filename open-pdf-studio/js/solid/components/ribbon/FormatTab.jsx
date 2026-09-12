import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import ColorPickerButton from './ColorPickerButton.jsx';
import Dialog from '../Dialog.jsx';
import {
  fillColor, strokeColor, fmtLineWidth, opacity, borderStyle, blendMode,
  arrowStart, arrowEnd, isLocked, isSingleSymbolStamp,
  STYLE_DEFS, applyToSelected, syncFormatStore
} from '../../stores/formatStore.js';
import {
  getStylePresets, createStylePreset, deleteStylePreset, renameStylePreset,
  applyStylePresetById, copyStyleFromSelection, pasteStyleToSelection, copiedStyle,
} from '../../stores/stylePresetsStore.js';
import { openSymbolTypeEditor } from '../../stores/symbolEditStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { showProperties, showMultiSelectionProperties, closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { setPanelVisible } from '../../stores/propertiesStore.js';
import {
  styleToolsIcon, resetLocationIcon, openPropertiesIcon, hideAnnotationIcon, editTypeIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const STYLE_GALLERY = [
  { name: 'red', labelKey: 'format.styleRed', color: '#ff0000', cloudy: false },
  { name: 'purple', labelKey: 'format.stylePurple', color: '#800080', cloudy: false },
  { name: 'indigo', labelKey: 'format.styleIndigo', color: '#4b0082', cloudy: false },
  { name: 'blue', labelKey: 'format.styleBlue', color: '#0066cc', cloudy: false },
  { name: 'green', labelKey: 'format.styleGreen', color: '#008000', cloudy: false },
  { name: 'yellow', labelKey: 'format.styleYellow', color: '#e6a817', cloudy: false },
  { name: 'black', labelKey: 'format.styleBlack', color: '#000000', cloudy: false },
  { name: 'red-cloudy', labelKey: 'format.styleRedCloudy', color: '#ff0000', cloudy: true, bg: 'rgba(255,0,0,0.08)' },
  { name: 'purple-cloudy', labelKey: 'format.stylePurpleCloudy', color: '#800080', cloudy: true, bg: 'rgba(128,0,128,0.08)' },
  { name: 'indigo-cloudy', labelKey: 'format.styleIndigoCloudy', color: '#7b68ee', cloudy: true, bg: 'rgba(123,104,238,0.15)' },
];

function applyStyle(styleName) {
  const style = STYLE_DEFS[styleName];
  if (!style) return;
  applyToSelected(ann => {
    if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
    ann.fillColor = style.fillColor || null;
    if (style.borderStyle) ann.borderStyle = style.borderStyle;
  });
  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
}

function fillIconSvg() {
  const fc = fillColor();
  const hasFillColor = fc && fc !== '#ffffff';
  return `<svg viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="11" rx="1" id="fmt-fill-icon-rect" fill="${fc}" stroke="${hasFillColor ? 'none' : '#999'}" stroke-width="1"/><rect x="2" y="14" width="14" height="2.5" rx="0.5" id="fmt-fill-indicator" fill="${fc}" stroke="${hasFillColor ? 'none' : '#ccc'}" stroke-width="0.5"/></svg>`;
}

function strokeIconSvg() {
  const sc = strokeColor();
  return `<svg viewBox="0 0 18 18" fill="none"><rect x="3" y="3" width="12" height="9" rx="1" fill="none" id="fmt-stroke-icon-rect" stroke="${sc}" stroke-width="2.5"/><rect x="2" y="14" width="14" height="2.5" rx="0.5" id="fmt-stroke-indicator" fill="${sc}"/></svg>`;
}

export default function FormatTab() {
  const { t } = useTranslation('ribbon');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('properties');

  // Uitklap-status: stijlgalerij-popup (fmt-style-more) en
  // stijl-gereedschappen-menu (fmt-style-tools), issue #313.
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [toolsOpen, setToolsOpen] = createSignal(false);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [manageOpen, setManageOpen] = createSignal(false);
  const [presetName, setPresetName] = createSignal('');
  let moreRef;
  let toolsRef;
  let nameInputRef;

  onMount(() => {
    const handler = (e) => {
      if (moreRef && !moreRef.contains(e.target)) setMoreOpen(false);
      if (toolsRef && !toolsRef.contains(e.target)) setToolsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  const presets = () => getStylePresets();

  const openCreateDialog = () => {
    setToolsOpen(false);
    setPresetName(`${tp('stylePresets.defaultName')} ${presets().length + 1}`);
    setCreateOpen(true);
    requestAnimationFrame(() => { nameInputRef?.focus(); nameInputRef?.select(); });
  };
  const confirmCreate = () => {
    if (createStylePreset(presetName())) setCreateOpen(false);
  };

  return (
    <div class="ribbon-content active" id="tab-format">
      <AdaptiveGroups>
        <Show when={isSingleSymbolStamp()}>
          <RibbonGroup label={t('format.symbolTypeGroup')}>
            <div class="ribbon-grid-col">
              <button class="ribbon-row-btn" id="fmt-edit-type" title={t('format.editTypeHint')}
                onClick={() => {
                  const sel = getActiveDocument()?.selectedAnnotations || [];
                  if (sel.length === 1) openSymbolTypeEditor(sel[0]);
                }}>
                <span ref={el => { el.innerHTML = editTypeIcon; }} />
                <span>{t('format.editType')}</span>
              </button>
            </div>
          </RibbonGroup>
        </Show>

        <RibbonGroup label="" wide={true}>
          <div class="ribbon-style-gallery-wrap" ref={moreRef}>
            <div class="ribbon-style-gallery" id="fmt-style-gallery">
              <For each={STYLE_GALLERY}>
                {(item) => (
                  <div
                    class="ribbon-style-item"
                    data-style={item.name}
                    title={t(item.labelKey)}
                    onClick={() => applyStyle(item.name)}
                  >
                    <div
                      class={`ribbon-style-preview${item.cloudy ? ' ribbon-style-cloudy' : ''}`}
                      style={{
                        'border-color': item.color,
                        color: item.color,
                        ...(item.bg ? { background: item.bg } : {})
                      }}
                    >
                      <span>T</span>
                    </div>
                    <span class="ribbon-style-label">{t(item.labelKey)}</span>
                  </div>
                )}
              </For>
            </div>
            <button class="ribbon-gallery-more" id="fmt-style-more" title={t('format.moreStyles')}
              onClick={() => setMoreOpen(!moreOpen())}>
              <svg viewBox="0 0 8 14"><path d="M1 1l5 6-5 6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
            </button>
            {/* Galerij-popup: alle stijl-presets in een raster + opgeslagen lijnstijlen */}
            <div class={`ribbon-style-more-popup${moreOpen() ? ' show' : ''}`} id="fmt-style-more-popup">
              <div class="ribbon-style-more-grid">
                <For each={STYLE_GALLERY}>
                  {(item) => (
                    <div
                      class="ribbon-style-item"
                      title={t(item.labelKey)}
                      onClick={() => { applyStyle(item.name); setMoreOpen(false); }}
                    >
                      <div
                        class={`ribbon-style-preview${item.cloudy ? ' ribbon-style-cloudy' : ''}`}
                        style={{
                          'border-color': item.color,
                          color: item.color,
                          ...(item.bg ? { background: item.bg } : {})
                        }}
                      >
                        <span>T</span>
                      </div>
                      <span class="ribbon-style-label">{t(item.labelKey)}</span>
                    </div>
                  )}
                </For>
              </div>
              <Show when={presets().length > 0}>
                <div class="ribbon-menu-sep"></div>
                <div class="ribbon-style-more-presets">
                  <For each={presets()}>
                    {(p) => (
                      <button class="ribbon-menu-item"
                        onClick={() => { applyStylePresetById(p.id); setMoreOpen(false); }}>
                        {p.name}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-btn-stack">
            <ColorPickerButton
              id="fmt-fill-color"
              title={t('format.fillColor')}
              label={t('format.fillColor')}
              iconSvg={fillIconSvg()}
              dropdownId="fmt-fill-dropdown"
              paletteId="fmt-fill-palette"
              showNoneButton={true}
              currentColor={fillColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onNone={() => {
                applyToSelected(ann => { ann.fillColor = null; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
            />
            <ColorPickerButton
              id="fmt-stroke-color"
              title={t('format.strokeColor')}
              label={t('format.strokeColor')}
              iconSvg={strokeIconSvg()}
              dropdownId="fmt-stroke-dropdown"
              paletteId="fmt-stroke-palette"
              showNoneButton={false}
              currentColor={strokeColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
            />
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>{t('format.widthLabel')}</label>
              <input type="number" class="ribbon-form-number" id="fmt-line-width" title={t('format.lineWidth')}
                min="0.1" max="50" step="0.1"
                value={fmtLineWidth()}
                onInput={(e) => {
                  const v = parseFloat(e.currentTarget.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  applyToSelected(ann => { ann.lineWidth = v; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }} />
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.borderLabel')}</label>
              <select class="ribbon-form-select" id="fmt-border-style" title={t('format.borderStyle')}
                value={borderStyle()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.borderStyle = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="solid">{tc('solid')}</option>
                <option value="dashed">{tc('dashed')}</option>
                <option value="dotted">{tc('dotted')}</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.blendLabel')}</label>
              <select class="ribbon-form-select" id="fmt-blend-mode" title={t('format.blendMode')}
                value={blendMode()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.blendMode = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="normal">{t('format.normal')}</option>
                <option value="multiply">{t('format.multiply')}</option>
              </select>
            </div>
          </div>
          <div class="ribbon-slider-row">
            <label>{t('format.opacityLabel')}</label>
            <input type="range" class="ribbon-slider" id="fmt-opacity" title={t('format.opacity')}
              min="0" max="100" step="1"
              value={opacity()}
              onInput={(e) => {
                applyToSelected(ann => { ann.opacity = parseInt(e.currentTarget.value, 10) / 100; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }} />
            <input type="number" class="ribbon-slider-number" title={t('format.opacity')}
              min="0" max="100" step="1"
              value={opacity()}
              onInput={(e) => {
                const v = parseInt(e.currentTarget.value, 10);
                if (!Number.isFinite(v) || v < 0 || v > 100) return;
                applyToSelected(ann => { ann.opacity = v / 100; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }} />
            <span class="ribbon-slider-unit">%</span>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>{t('format.startLabel')}</label>
              <select class="ribbon-form-select" id="fmt-arrow-start" title={t('format.startArrow')}
                value={arrowStart()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.startHead = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="none">{tc('none')}</option>
                <option value="open">{t('format.open')}</option>
                <option value="closed">{t('format.closed')}</option>
                <option value="stealth">{t('format.stealth')}</option>
                <option value="diamond">{t('format.diamond')}</option>
                <option value="circle">{t('format.circle')}</option>
                <option value="square">{t('format.square')}</option>
                <option value="slash">{t('format.slash')}</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.endLabel')}</label>
              <select class="ribbon-form-select" id="fmt-arrow-end" title={t('format.endArrow')}
                value={arrowEnd()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.endHead = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="none">{tc('none')}</option>
                <option value="open">{t('format.open')}</option>
                <option value="closed">{t('format.closed')}</option>
                <option value="stealth">{t('format.stealth')}</option>
                <option value="diamond">{t('format.diamond')}</option>
                <option value="circle">{t('format.circle')}</option>
                <option value="square">{t('format.square')}</option>
                <option value="slash">{t('format.slash')}</option>
              </select>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-grid-col">
            <div class="ribbon-menu-wrapper" ref={toolsRef}>
              <button class="ribbon-row-btn ribbon-dropdown-btn" id="fmt-style-tools" title={t('format.styleTools')}
                onClick={() => setToolsOpen(!toolsOpen())}>
                <span ref={el => { el.innerHTML = styleToolsIcon; }} />
                <span>{t('format.styleTools')}</span>
                <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
              </button>
              <div class={`ribbon-menu-dropdown${toolsOpen() ? ' show' : ''}`} id="fmt-style-tools-menu">
                <button class="ribbon-menu-item"
                  onClick={() => { copyStyleFromSelection(); setToolsOpen(false); }}>
                  {tp('stylePresets.copyStyle')}
                </button>
                <button class="ribbon-menu-item" disabled={!copiedStyle() || isLocked()}
                  onClick={() => { pasteStyleToSelection(); setToolsOpen(false); }}>
                  {tp('stylePresets.pasteStyle')}
                </button>
                <div class="ribbon-menu-sep"></div>
                <button class="ribbon-menu-item" disabled={isLocked()} onClick={openCreateDialog}>
                  {tp('stylePresets.create')}…
                </button>
                <button class="ribbon-menu-item" disabled={presets().length === 0}
                  onClick={() => { setToolsOpen(false); setManageOpen(true); }}>
                  {tp('stylePresets.manage')}…
                </button>
                <Show when={presets().length > 0}>
                  <div class="ribbon-menu-sep"></div>
                  <For each={presets()}>
                    {(p) => (
                      <button class="ribbon-menu-item" disabled={isLocked()}
                        title={tp('stylePresets.applyPlaceholder')}
                        onClick={() => { applyStylePresetById(p.id); setToolsOpen(false); }}>
                        {p.name}
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </div>
            <button class="ribbon-row-btn" id="fmt-reset-location" title={t('format.resetLocation')}
              onClick={() => {
                applyToSelected(ann => {
                  ann.rotation = 0;
                  if (ann.x !== undefined) {
                    const canvas = document.getElementById('annotation-canvas');
                    if (canvas) {
                      const resetDoc = getActiveDocument();
                      const resetScale = resetDoc?.scale || 1.5;
                      const resetDpr = window.devicePixelRatio || 1;
                      const cx = (canvas.width / (resetScale * resetDpr)) / 2;
                      const cy = (canvas.height / (resetScale * resetDpr)) / 2;
                      const w = ann.width || 100;
                      const h = ann.height || 50;
                      ann.x = cx - w / 2;
                      ann.y = cy - h / 2;
                    }
                  }
                });
              }}>
              <span ref={el => { el.innerHTML = resetLocationIcon; }} />
              <span>{t('format.resetLocation')}</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('format.propertiesGroup')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="fmt-open" title={t('format.openProperties')}
              onClick={() => {
                setPanelVisible(true);
                const _fmtSel = getActiveDocument()?.selectedAnnotations || [];
                if (_fmtSel.length === 1) {
                  showProperties(_fmtSel[0]);
                } else if (_fmtSel.length > 1) {
                  showMultiSelectionProperties();
                }
              }}>
              <span ref={el => { el.innerHTML = openPropertiesIcon; }} />
              <span>{t('format.openLabel')}</span>
            </button>
            <button class="ribbon-row-btn" id="fmt-hide" title={t('format.hideAnnotation')}
              onClick={() => {
                applyToSelected(ann => { ann.hidden = !ann.hidden; });
              }}>
              <span ref={el => { el.innerHTML = hideAnnotationIcon; }} />
              <span>{t('format.hide')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col" style={{ 'justify-content': 'center' }}>
            <div class="ribbon-form-row">
              <label>{t('format.layerLabel')}</label>
              <select class="ribbon-form-select" id="fmt-layer" title={t('format.layer')}>
                <option value="none">{tc('none')}</option>
              </select>
            </div>
          </div>
        </RibbonGroup>
      </AdaptiveGroups>

      {/* Naam-dialoog voor "Lijnstijl maken" — zelfde gedrag als in het
          Eigenschappen-paneel (Windows-stijl, verplaatsbaar, Dialog.jsx). */}
      <Show when={createOpen()}>
        <Dialog
          title={tp('stylePresets.createTitle')}
          dialogClass="style-preset-dialog"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <button class="pref-btn pref-btn-secondary" onClick={() => setCreateOpen(false)}>
                {tc('cancel')}
              </button>
              <button class="pref-btn pref-btn-primary" disabled={!presetName().trim()} onClick={confirmCreate}>
                {tc('ok')}
              </button>
            </>
          }
        >
          <div class="style-preset-name-row">
            <label for="fmt-style-preset-name-input">{tp('stylePresets.nameLabel')}</label>
            <input
              id="fmt-style-preset-name-input"
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
          title={tp('stylePresets.manageTitle')}
          dialogClass="style-preset-dialog"
          onClose={() => setManageOpen(false)}
          footer={
            <button class="pref-btn pref-btn-primary" onClick={() => setManageOpen(false)}>
              {tc('close')}
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
                    {tc('delete')}
                  </button>
                </div>
              )}
            </For>
            <Show when={presets().length === 0}>
              <div class="style-preset-empty">{tp('stylePresets.noPresets')}</div>
            </Show>
          </div>
        </Dialog>
      </Show>
    </div>
  );
}
