import { For } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import ColorPickerButton from './ColorPickerButton.jsx';
import {
  fillColor, strokeColor, fmtLineWidth, opacity, borderStyle, blendMode,
  arrowStart, arrowEnd, isLocked,
  STYLE_DEFS, applyToSelected, syncFormatStore
} from '../../stores/formatStore.js';
import { state } from '../../../core/state.js';
import { showProperties, showMultiSelectionProperties, closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { setPanelVisible } from '../../stores/propertiesStore.js';
import {
  styleToolsIcon, resetLocationIcon, openPropertiesIcon, hideAnnotationIcon
} from '../../data/ribbonIcons.js';

const STYLE_GALLERY = [
  { name: 'red', label: 'Red', color: '#ff0000', cloudy: false },
  { name: 'purple', label: 'Purple', color: '#800080', cloudy: false },
  { name: 'indigo', label: 'Indigo', color: '#4b0082', cloudy: false },
  { name: 'blue', label: 'Blue', color: '#0066cc', cloudy: false },
  { name: 'green', label: 'Green', color: '#008000', cloudy: false },
  { name: 'yellow', label: 'Yellow', color: '#e6a817', cloudy: false },
  { name: 'black', label: 'Black', color: '#000000', cloudy: false },
  { name: 'red-cloudy', label: 'Red Cloudy', color: '#ff0000', cloudy: true, bg: 'rgba(255,0,0,0.08)' },
  { name: 'purple-cloudy', label: 'Purple Cloudy', color: '#800080', cloudy: true, bg: 'rgba(128,0,128,0.08)' },
  { name: 'indigo-cloudy', label: 'Indigo Cloudy', color: '#7b68ee', cloudy: true, bg: 'rgba(123,104,238,0.15)' },
];

function applyStyle(styleName) {
  const style = STYLE_DEFS[styleName];
  if (!style) return;
  applyToSelected(ann => {
    if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
    ann.fillColor = style.fillColor || null;
    if (style.borderStyle) ann.borderStyle = style.borderStyle;
  });
  syncFormatStore(state.selectedAnnotations);
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
  return (
    <div class="ribbon-content active" id="tab-format">
      <div class="ribbon-groups">
        <RibbonGroup label="" wide={true}>
          <div class="ribbon-style-gallery" id="fmt-style-gallery">
            <For each={STYLE_GALLERY}>
              {(item) => (
                <div
                  class="ribbon-style-item"
                  data-style={item.name}
                  title={item.label}
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
                  <span class="ribbon-style-label">{item.label}</span>
                </div>
              )}
            </For>
          </div>
          <button class="ribbon-gallery-more" id="fmt-style-more" title="More Styles">
            <svg viewBox="0 0 8 14"><path d="M1 1l5 6-5 6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-btn-stack">
            <ColorPickerButton
              id="fmt-fill-color"
              title="Fill Color"
              label="Fill Color"
              iconSvg={fillIconSvg()}
              dropdownId="fmt-fill-dropdown"
              paletteId="fmt-fill-palette"
              showNoneButton={true}
              currentColor={fillColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(state.selectedAnnotations);
              }}
              onNone={() => {
                applyToSelected(ann => { ann.fillColor = null; });
                syncFormatStore(state.selectedAnnotations);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(state.selectedAnnotations);
              }}
            />
            <ColorPickerButton
              id="fmt-stroke-color"
              title="Stroke Color"
              label="Stroke Color"
              iconSvg={strokeIconSvg()}
              dropdownId="fmt-stroke-dropdown"
              paletteId="fmt-stroke-palette"
              showNoneButton={false}
              currentColor={strokeColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(state.selectedAnnotations);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(state.selectedAnnotations);
              }}
            />
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid">
            <div class="ribbon-form-row">
              <label>Width:</label>
              <select class="ribbon-form-select" id="fmt-line-width" title="Line Width"
                value={fmtLineWidth()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.lineWidth = parseFloat(e.target.value); });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="0.5">0.5 pt</option>
                <option value="1">1 pt</option>
                <option value="2">2 pt</option>
                <option value="3">3 pt</option>
                <option value="4">4 pt</option>
                <option value="6">6 pt</option>
                <option value="8">8 pt</option>
              </select>
              <label>Opacity:</label>
              <select class="ribbon-form-select" id="fmt-opacity" title="Opacity"
                value={opacity()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.opacity = parseInt(e.target.value) / 100; });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="100">100%</option>
                <option value="90">90%</option>
                <option value="75">75%</option>
                <option value="50">50%</option>
                <option value="25">25%</option>
                <option value="10">10%</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>Border:</label>
              <select class="ribbon-form-select" id="fmt-border-style" title="Border Style"
                value={borderStyle()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.borderStyle = e.target.value; });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
              <label>Blend:</label>
              <select class="ribbon-form-select" id="fmt-blend-mode" title="Blend Mode"
                value={blendMode()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.blendMode = e.target.value; });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="normal">Normal</option>
                <option value="multiply">Multiply</option>
              </select>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>Start:</label>
              <select class="ribbon-form-select" id="fmt-arrow-start" title="Start Arrow"
                value={arrowStart()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.startHead = e.target.value; });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="none">None</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="stealth">Stealth</option>
                <option value="diamond">Diamond</option>
                <option value="circle">Circle</option>
                <option value="square">Square</option>
                <option value="slash">Slash</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>End:</label>
              <select class="ribbon-form-select" id="fmt-arrow-end" title="End Arrow"
                value={arrowEnd()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.endHead = e.target.value; });
                  syncFormatStore(state.selectedAnnotations);
                }}>
                <option value="none">None</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="stealth">Stealth</option>
                <option value="diamond">Diamond</option>
                <option value="circle">Circle</option>
                <option value="square">Square</option>
                <option value="slash">Slash</option>
              </select>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn ribbon-dropdown-btn" id="fmt-style-tools" title="Style Tools">
              <span ref={el => { el.innerHTML = styleToolsIcon; }} />
              <span>Style Tools</span>
              <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
            </button>
            <button class="ribbon-row-btn" id="fmt-reset-location" title="Reset Location"
              onClick={() => {
                applyToSelected(ann => {
                  ann.rotation = 0;
                  if (ann.x !== undefined) {
                    const canvas = document.getElementById('annotation-canvas');
                    if (canvas) {
                      const cx = (canvas.width / state.scale) / 2;
                      const cy = (canvas.height / state.scale) / 2;
                      const w = ann.width || 100;
                      const h = ann.height || 50;
                      ann.x = cx - w / 2;
                      ann.y = cy - h / 2;
                    }
                  }
                });
              }}>
              <span ref={el => { el.innerHTML = resetLocationIcon; }} />
              <span>Reset Location</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label="Properties">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="fmt-open" title="Open Properties"
              onClick={() => {
                setPanelVisible(true);
                if (state.selectedAnnotations.length === 1) {
                  showProperties(state.selectedAnnotations[0]);
                } else if (state.selectedAnnotations.length > 1) {
                  showMultiSelectionProperties();
                }
              }}>
              <span ref={el => { el.innerHTML = openPropertiesIcon; }} />
              <span>Open</span>
            </button>
            <button class="ribbon-row-btn" id="fmt-hide" title="Hide Annotation"
              onClick={() => {
                applyToSelected(ann => { ann.hidden = !ann.hidden; });
              }}>
              <span ref={el => { el.innerHTML = hideAnnotationIcon; }} />
              <span>Hide</span>
            </button>
          </div>
          <div class="ribbon-grid-col" style={{ 'justify-content': 'center' }}>
            <div class="ribbon-form-row">
              <label>Layer:</label>
              <select class="ribbon-form-select" id="fmt-layer" title="Layer">
                <option value="none">None</option>
              </select>
            </div>
          </div>
        </RibbonGroup>
      </div>
    </div>
  );
}
