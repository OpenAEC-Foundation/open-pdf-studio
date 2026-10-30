import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import ColorPickerButton from './ColorPickerButton.jsx';
import Dialog from '../Dialog.jsx';
import LayerField from '../properties-panel/LayerField.jsx';
import { selectieLaagKeuze } from '../../../annotations/laag-keuze.js';
import { layersVersion } from '../../stores/annotationLayersStore.js';
import {
  fillColor, strokeColor, fmtLineWidth, opacity, fillOpacity, aparteVulDekking, hasFill, borderStyle, blendMode,
  arrowStart, arrowEnd, isLocked, isSingleSymbolStamp,
  STYLE_DEFS, applyToSelected, zetOpmaak, opmaakVoorNieuw, opmaakOndersteunt,
} from '../../stores/formatStore.js';
import {
  getStylePresets, createStylePreset, deleteStylePreset, renameStylePreset,
  applyStylePresetById, copyStyleFromSelection, pasteStyleToSelection, copiedStyle,
} from '../../stores/stylePresetsStore.js';
import { openSymbolTypeEditor } from '../../stores/symbolEditStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { showProperties, showMultiSelectionProperties, closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { setPanelVisible } from '../../stores/propertiesStore.js';
import { zetRanddikte } from '../../../annotations/rendering/textbox-layout.js';
import {
  styleToolsIcon, resetLocationIcon, openPropertiesIcon, hideAnnotationIcon, editTypeIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { paginaMaat } from '../../../pdf/weergave-ruimte.js';
import { lintZetLijnkoppen } from '../../../pdf/lijnkoppen.js';
import { BLEND_MODES } from '../../../annotations/blend-modes.js';
import { volgPopup } from './ribbon-popup.js';
import { heeftVulDekking, zetLijnDekking } from '../../../annotations/vul-dekking.js';

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

// Invoegmodus voor symbolen (#587) en tekenen met een gereedschap (#668): de
// werkbalk stelt dan de opmaak in voor wat nog GEPLAATST wordt in plaats van
// de selectie te wijzigen (zetOpmaak in formatStore kiest het doel). Acties
// op de selectie zijn dan uitgeschakeld, en ook elke optie die het huidige
// symbool of gereedschap niet kent; bij een symbool blijft een gekozen
// waarde wel staan voor het volgende.
const invoegen = () => opmaakVoorNieuw();
const nietOndersteund = (key) => invoegen() && !opmaakOndersteunt(key);
// Vul-dekking (#685): alleen voor rechthoek, ellips, veelhoek en wolk, en
// alleen met een vulling om op te werken.
const vulDekkingUit = () => nietOndersteund('fillOpacity') || !aparteVulDekking() || !hasFill();

function applyStyle(styleName) {
  const style = STYLE_DEFS[styleName];
  if (!style) return;
  // Bij een symbool telt van een stijl alleen de lijnkleur, bij een
  // gereedschap alles wat het kent (zie zetOpmaak).
  zetOpmaak({
    strokeColor: style.strokeColor,
    fillColor: style.fillColor || null,
    borderStyle: style.borderStyle,
  }, ann => {
    if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
    ann.fillColor = style.fillColor || null;
    if (style.borderStyle) ann.borderStyle = style.borderStyle;
  });
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
  const layerSelection = () => getActiveDocument()?.selectedAnnotations || [];
  // Laag van de selectie (#865), met dezelfde keuzelijst als Eigenschappen.
  const selectionLayer = () => {
    layersVersion();
    return selectieLaagKeuze(layerSelection(), getActiveDocument());
  };

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
  // De popups staan met position: fixed buiten de klip van de ribbon (#617).
  let moreBtnRef;
  let morePopupRef;
  let toolsBtnRef;
  let toolsMenuRef;
  volgPopup(() => morePopupRef, () => moreBtnRef, moreOpen, { rechts: true });
  volgPopup(() => toolsMenuRef, () => toolsBtnRef, toolsOpen);

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
        <Show when={isSingleSymbolStamp() && !invoegen()}>
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
                    classList={{ disabled: nietOndersteund('strokeColor') }}
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
            <button class="ribbon-gallery-more" id="fmt-style-more" title={t('format.moreStyles')} ref={moreBtnRef}
              onClick={() => setMoreOpen(!moreOpen())}>
              <svg viewBox="0 0 8 14"><path d="M1 1l5 6-5 6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
            </button>
            {/* Galerij-popup: alle stijl-presets in een raster + opgeslagen lijnstijlen */}
            <div class={`ribbon-style-more-popup${moreOpen() ? ' show' : ''}`} id="fmt-style-more-popup" ref={morePopupRef}>
              <div class="ribbon-style-more-grid">
                <For each={STYLE_GALLERY}>
                  {(item) => (
                    <div
                      class="ribbon-style-item"
                      classList={{ disabled: nietOndersteund('strokeColor') }}
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
              <Show when={presets().length > 0 && !invoegen()}>
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
              disabled={nietOndersteund('fillColor')}
              currentColor={fillColor()}
              onColorSelect={(color) => {
                zetOpmaak({ fillColor: color }, ann => { ann.fillColor = color; });
              }}
              onNone={() => {
                zetOpmaak({ fillColor: null }, ann => { ann.fillColor = null; });
              }}
              onCustom={(color) => {
                zetOpmaak({ fillColor: color }, ann => { ann.fillColor = color; });
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
              disabled={nietOndersteund('strokeColor')}
              currentColor={strokeColor()}
              onColorSelect={(color) => {
                zetOpmaak({ strokeColor: color }, ann => { ann.strokeColor = color; ann.color = color; });
              }}
              onCustom={(color) => {
                zetOpmaak({ strokeColor: color }, ann => { ann.strokeColor = color; ann.color = color; });
              }}
            />
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>{t('format.widthLabel')}</label>
              <input type="text" inputmode="decimal" data-getal class="ribbon-form-number" id="fmt-line-width" title={t('format.lineWidth')}
                min="0.1" max="50" step="0.1"
                value={fmtLineWidth()}
                disabled={nietOndersteund('lineWidth')}
                onInput={(e) => {
                  const v = parseFloat(e.currentTarget.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  zetOpmaak({ lineWidth: v }, ann => { zetRanddikte(ann, v); });
                }} />
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.borderLabel')}</label>
              <select class="ribbon-form-select" id="fmt-border-style" title={t('format.borderStyle')}
                value={borderStyle()}
                disabled={nietOndersteund('borderStyle')}
                onChange={(e) => {
                  const stijl = e.target.value;
                  zetOpmaak({ borderStyle: stijl }, ann => { ann.borderStyle = stijl; });
                }}>
                <option value="solid">{tc('solid')}</option>
                <option value="dashed">{tc('dashed')}</option>
                <option value="dotted">{tc('dotted')}</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label title={t('format.blendHint')}>{t('format.blendLabel')}</label>
              <select class="ribbon-form-select" id="fmt-blend-mode" title={t('format.blendHint')}
                value={blendMode()}
                disabled={nietOndersteund('blendMode')}
                onChange={(e) => {
                  const mode = e.target.value;
                  zetOpmaak({ blendMode: mode }, ann => { ann.blendMode = mode; });
                }}>
                {/* Alle zestien PDF-mengmodi (#614); de labels per taal. */}
                <For each={BLEND_MODES}>{(mode) => (
                  <option value={mode}>{t(`format.blend.${mode}`, mode)}</option>
                )}</For>
              </select>
            </div>
          </div>
          {/* Dekking van de lijn en, bij een rechthoek, ellips, veelhoek of
              wolk, apart die van de vulling (#685). */}
          <div class="ribbon-slider-grid">
            <div class="ribbon-slider-row">
              <label>{aparteVulDekking() ? t('format.strokeOpacityLabel') : t('format.opacityLabel')}</label>
              <input type="range" class="ribbon-slider" id="fmt-opacity"
                title={aparteVulDekking() ? t('format.strokeOpacity') : t('format.opacity')}
                min="0" max="100" step="1"
                value={opacity()}
                disabled={nietOndersteund('opacity')}
                onInput={(e) => {
                  const v = parseInt(e.currentTarget.value, 10) / 100;
                  zetOpmaak({ opacity: v }, ann => { zetLijnDekking(ann, v); });
                }} />
              <input type="text" inputmode="decimal" data-getal class="ribbon-slider-number"
                title={aparteVulDekking() ? t('format.strokeOpacity') : t('format.opacity')}
                min="0" max="100" step="1"
                value={opacity()}
                disabled={nietOndersteund('opacity')}
                onInput={(e) => {
                  const v = parseInt(e.currentTarget.value, 10);
                  if (!Number.isFinite(v) || v < 0 || v > 100) return;
                  zetOpmaak({ opacity: v / 100 }, ann => { zetLijnDekking(ann, v / 100); });
                }} />
              <span class="ribbon-slider-unit">%</span>
            </div>
            <div class="ribbon-slider-row">
              <label>{t('format.fillOpacityLabel')}</label>
              <input type="range" class="ribbon-slider" id="fmt-fill-opacity" title={t('format.fillOpacity')}
                min="0" max="100" step="1"
                value={fillOpacity()}
                disabled={vulDekkingUit()}
                onInput={(e) => {
                  const v = parseInt(e.currentTarget.value, 10) / 100;
                  zetOpmaak({ fillOpacity: v }, ann => { if (heeftVulDekking(ann.type)) ann.fillOpacity = v; });
                }} />
              <input type="text" inputmode="decimal" data-getal class="ribbon-slider-number" title={t('format.fillOpacity')}
                min="0" max="100" step="1"
                value={fillOpacity()}
                disabled={vulDekkingUit()}
                onInput={(e) => {
                  const v = parseInt(e.currentTarget.value, 10);
                  if (!Number.isFinite(v) || v < 0 || v > 100) return;
                  zetOpmaak({ fillOpacity: v / 100 }, ann => { if (heeftVulDekking(ann.type)) ann.fillOpacity = v / 100; });
                }} />
              <span class="ribbon-slider-unit">%</span>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>{t('format.startLabel')}</label>
              <select class="ribbon-form-select" id="fmt-arrow-start" title={t('format.startArrow')}
                value={arrowStart()}
                disabled={nietOndersteund('startHead')}
                onChange={(e) => {
                  const kop = e.target.value;
                  zetOpmaak({ startHead: kop }, ann => { if (lintZetLijnkoppen(ann.type)) ann.startHead = kop; });
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
                disabled={nietOndersteund('endHead')}
                onChange={(e) => {
                  const kop = e.target.value;
                  zetOpmaak({ endHead: kop }, ann => { if (lintZetLijnkoppen(ann.type)) ann.endHead = kop; });
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
              <button class="ribbon-row-btn ribbon-dropdown-btn" id="fmt-style-tools" title={t('format.styleTools')} ref={toolsBtnRef}
                disabled={invoegen()}
                onClick={() => setToolsOpen(!toolsOpen())}>
                <span ref={el => { el.innerHTML = styleToolsIcon; }} />
                <span>{t('format.styleTools')}</span>
                <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
              </button>
              <div class={`ribbon-menu-dropdown${toolsOpen() ? ' show' : ''}`} id="fmt-style-tools-menu" ref={toolsMenuRef}>
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
              disabled={invoegen()}
              onClick={() => {
                applyToSelected(ann => {
                  ann.rotation = 0;
                  if (ann.x !== undefined) {
                    const canvas = document.getElementById('annotation-canvas');
                    if (canvas) {
                      const resetDoc = getActiveDocument();
                      const resetScale = resetDoc?.scale || 1.5;
                      const resetDpr = window.devicePixelRatio || 1;
                      // Midden van de pagina in de paginaruimte: uit de
                      // paginamaat, niet uit het canvas (dat is in de viewport-
                      // weergave het venster en kan gedraaid zijn, #200).
                      const maat = paginaMaat(ann.page ?? resetDoc?.currentPage ?? 1, resetDoc);
                      const cx = maat ? maat.breedte / 2 : (canvas.width / (resetScale * resetDpr)) / 2;
                      const cy = maat ? maat.hoogte / 2 : (canvas.height / (resetScale * resetDpr)) / 2;
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
              disabled={invoegen()}
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
              disabled={invoegen()}
              onClick={() => {
                applyToSelected(ann => { ann.hidden = !ann.hidden; });
              }}>
              <span ref={el => { el.innerHTML = hideAnnotationIcon; }} />
              <span>{t('format.hide')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col" style={{ 'justify-content': 'center' }}>
            <LayerField id="fmt-layer" groupClass="ribbon-form-row" selectClass="ribbon-form-select"
              label={t('format.layerLabel')} title={t('format.layer')} value={selectionLayer()}
              disabled={invoegen() || !layerSelection().length || layerSelection().some(ann => ann.locked)} />
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
