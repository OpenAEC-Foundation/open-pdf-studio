import { state } from '../../core/state.js';
import { recordPropertyChange, recordBulkModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../panels/properties-panel.js';

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Apply a property change to all selected annotations with single undo
function applyToSelected(applyFn) {
  const selected = state.selectedAnnotations;
  if (!selected || selected.length === 0) return;

  if (selected.length === 1) {
    const ann = selected[0];
    if (ann.locked) return;
    recordPropertyChange(ann);
    applyFn(ann);
    ann.modifiedAt = new Date().toISOString();
    showProperties(ann);
  } else {
    const originals = selected.map(a => cloneAnnotation(a));
    for (const ann of selected) {
      if (ann.locked) continue;
      applyFn(ann);
      ann.modifiedAt = new Date().toISOString();
    }
    recordBulkModify(selected, originals);
    showMultiSelectionProperties();
  }
  redraw();
}

// --- Color palette ---
const PALETTE_COLUMNS = [
  ['#ffffff', '#d9d9d9', '#999999', '#666666', '#333333', '#000000'],
  ['#f4cccc', '#ea9999', '#e06666', '#ff0000', '#cc0000', '#660000'],
  ['#fce5cd', '#f9cb9c', '#ffff00', '#ffd966', '#f1c232', '#bf9000'],
  ['#d9ead3', '#b6d7a8', '#93c47d', '#00ff00', '#38761d', '#274e13'],
  ['#d0e0e3', '#a2c4c9', '#76a5af', '#00ffff', '#45818e', '#134f5c'],
  ['#c9daf8', '#6d9eeb', '#4a86e8', '#0000ff', '#1155cc', '#073763'],
  ['#d9d2e9', '#b4a7d6', '#9900ff', '#ff00ff', '#a64d79', '#741b47'],
];

function buildPalette(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  PALETTE_COLUMNS.forEach(columnColors => {
    const col = document.createElement('div');
    col.className = 'color-column';
    columnColors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.title = color;
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(color);
      });
      col.appendChild(swatch);
    });
    container.appendChild(col);
  });
}

function toggleDropdown(dropdown) {
  // Close all other ribbon color dropdowns first
  document.querySelectorAll('.ribbon-color-dropdown.show').forEach(d => {
    if (d !== dropdown) d.classList.remove('show');
  });
  dropdown.classList.toggle('show');
}

function closeAllDropdowns() {
  document.querySelectorAll('.ribbon-color-dropdown.show').forEach(d => d.classList.remove('show'));
}

// Close dropdowns on outside click
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.ribbon-color-picker-wrapper')) {
    closeAllDropdowns();
  }
});

// --- Style gallery definitions ---
const STYLE_DEFS = {
  'red':            { strokeColor: '#ff0000', color: '#ff0000', fillColor: null, borderStyle: 'solid' },
  'purple':         { strokeColor: '#800080', color: '#800080', fillColor: null, borderStyle: 'solid' },
  'indigo':         { strokeColor: '#4b0082', color: '#4b0082', fillColor: null, borderStyle: 'solid' },
  'blue':           { strokeColor: '#0066cc', color: '#0066cc', fillColor: null, borderStyle: 'solid' },
  'green':          { strokeColor: '#008000', color: '#008000', fillColor: null, borderStyle: 'solid' },
  'yellow':         { strokeColor: '#e6a817', color: '#e6a817', fillColor: null, borderStyle: 'solid' },
  'black':          { strokeColor: '#000000', color: '#000000', fillColor: null, borderStyle: 'solid' },
  'red-cloudy':     { strokeColor: '#ff0000', color: '#ff0000', fillColor: 'rgba(255,0,0,0.08)', borderStyle: 'solid' },
  'purple-cloudy':  { strokeColor: '#800080', color: '#800080', fillColor: 'rgba(128,0,128,0.08)', borderStyle: 'solid' },
  'indigo-cloudy':  { strokeColor: '#7b68ee', color: '#7b68ee', fillColor: 'rgba(123,104,238,0.15)', borderStyle: 'solid' },
};

// --- Update the format ribbon UI to reflect current selection ---
export function updateFormatRibbon() {
  const selected = state.selectedAnnotations;
  if (!selected || selected.length === 0) return;

  const ann = selected[0]; // Use first annotation for display

  // Fill color indicators (SVG elements)
  const fillIconRect = document.getElementById('fmt-fill-icon-rect');
  const fillIndicator = document.getElementById('fmt-fill-indicator');
  const fc = ann.fillColor || '#ffffff';
  if (fillIconRect) {
    fillIconRect.setAttribute('fill', fc);
    fillIconRect.setAttribute('stroke', ann.fillColor ? 'none' : '#999');
  }
  if (fillIndicator) {
    fillIndicator.setAttribute('fill', fc);
    fillIndicator.setAttribute('stroke', ann.fillColor ? 'none' : '#ccc');
  }

  // Stroke color indicators (SVG elements)
  const strokeIconRect = document.getElementById('fmt-stroke-icon-rect');
  const strokeIndicator = document.getElementById('fmt-stroke-indicator');
  const sc = ann.strokeColor || ann.color || '#000000';
  if (strokeIconRect) strokeIconRect.setAttribute('stroke', sc);
  if (strokeIndicator) strokeIndicator.setAttribute('fill', sc);

  // Line width
  const lineWidth = document.getElementById('fmt-line-width');
  if (lineWidth) {
    const lw = ann.lineWidth !== undefined ? ann.lineWidth : 1;
    lineWidth.value = closestOption(lineWidth, lw);
  }

  // Opacity
  const opacity = document.getElementById('fmt-opacity');
  if (opacity) {
    const op = ann.opacity !== undefined ? Math.round(ann.opacity * 100) : 100;
    opacity.value = closestOption(opacity, op);
  }

  // Border style
  const borderStyle = document.getElementById('fmt-border-style');
  if (borderStyle) borderStyle.value = ann.borderStyle || 'solid';

  // Blend mode
  const blendMode = document.getElementById('fmt-blend-mode');
  if (blendMode) blendMode.value = ann.blendMode || 'normal';

  // Arrow endpoints
  const arrowStart = document.getElementById('fmt-arrow-start');
  const arrowEnd = document.getElementById('fmt-arrow-end');
  if (ann.type === 'arrow') {
    if (arrowStart) arrowStart.value = ann.startHead || 'none';
    if (arrowEnd) arrowEnd.value = ann.endHead || 'open';
  }
}

function closestOption(select, val) {
  let best = select.options[0]?.value;
  let bestDiff = Infinity;
  for (const opt of select.options) {
    const diff = Math.abs(parseFloat(opt.value) - val);
    if (diff < bestDiff) { bestDiff = diff; best = opt.value; }
  }
  return best;
}

// --- Initialize all Format ribbon event listeners ---
export function initFormatRibbon() {
  // Style gallery items
  document.querySelectorAll('#fmt-style-gallery .ribbon-style-item').forEach(item => {
    item.addEventListener('click', () => {
      const styleName = item.dataset.style;
      const style = STYLE_DEFS[styleName];
      if (!style) return;
      applyToSelected(ann => {
        if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
        ann.fillColor = style.fillColor || null;
        if (style.borderStyle) ann.borderStyle = style.borderStyle;
      });
      updateFormatRibbon();
    });
  });

  // --- Fill color picker with palette dropdown ---
  const fmtFillBtn = document.getElementById('fmt-fill-color');
  const fmtFillDropdown = document.getElementById('fmt-fill-dropdown');
  const fmtFillCustom = document.getElementById('fmt-fill-custom');
  const fmtFillNone = document.getElementById('fmt-fill-none');
  const fmtFillInput = createHiddenColorInput();

  if (fmtFillBtn && fmtFillDropdown) {
    fmtFillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(fmtFillDropdown);
    });

    buildPalette('fmt-fill-palette', (color) => {
      applyToSelected(ann => { ann.fillColor = color; });
      updateFormatRibbon();
      closeAllDropdowns();
    });

    if (fmtFillNone) {
      fmtFillNone.addEventListener('click', (e) => {
        e.stopPropagation();
        applyToSelected(ann => { ann.fillColor = null; });
        updateFormatRibbon();
        closeAllDropdowns();
      });
    }

    if (fmtFillCustom) {
      fmtFillCustom.addEventListener('click', (e) => {
        e.stopPropagation();
        const ann = state.selectedAnnotations[0];
        if (ann) fmtFillInput.value = ann.fillColor || '#ffffff';
        fmtFillInput.click();
        closeAllDropdowns();
      });
      fmtFillInput.addEventListener('input', () => {
        applyToSelected(ann => { ann.fillColor = fmtFillInput.value; });
        updateFormatRibbon();
      });
    }
  }

  // --- Stroke color picker with palette dropdown ---
  const fmtStrokeBtn = document.getElementById('fmt-stroke-color');
  const fmtStrokeDropdown = document.getElementById('fmt-stroke-dropdown');
  const fmtStrokeCustom = document.getElementById('fmt-stroke-custom');
  const fmtStrokeInput = createHiddenColorInput();

  if (fmtStrokeBtn && fmtStrokeDropdown) {
    fmtStrokeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(fmtStrokeDropdown);
    });

    buildPalette('fmt-stroke-palette', (color) => {
      applyToSelected(ann => {
        ann.strokeColor = color;
        ann.color = color;
      });
      updateFormatRibbon();
      closeAllDropdowns();
    });

    if (fmtStrokeCustom) {
      fmtStrokeCustom.addEventListener('click', (e) => {
        e.stopPropagation();
        const ann = state.selectedAnnotations[0];
        if (ann) fmtStrokeInput.value = ann.strokeColor || ann.color || '#000000';
        fmtStrokeInput.click();
        closeAllDropdowns();
      });
      fmtStrokeInput.addEventListener('input', () => {
        applyToSelected(ann => {
          ann.strokeColor = fmtStrokeInput.value;
          ann.color = fmtStrokeInput.value;
        });
        updateFormatRibbon();
      });
    }
  }

  // Line width
  const fmtLineWidth = document.getElementById('fmt-line-width');
  if (fmtLineWidth) {
    fmtLineWidth.addEventListener('change', () => {
      applyToSelected(ann => { ann.lineWidth = parseFloat(fmtLineWidth.value); });
    });
  }

  // Opacity
  const fmtOpacity = document.getElementById('fmt-opacity');
  if (fmtOpacity) {
    fmtOpacity.addEventListener('change', () => {
      applyToSelected(ann => { ann.opacity = parseInt(fmtOpacity.value) / 100; });
    });
  }

  // Border style
  const fmtBorderStyle = document.getElementById('fmt-border-style');
  if (fmtBorderStyle) {
    fmtBorderStyle.addEventListener('change', () => {
      applyToSelected(ann => { ann.borderStyle = fmtBorderStyle.value; });
    });
  }

  // Blend mode
  const fmtBlendMode = document.getElementById('fmt-blend-mode');
  if (fmtBlendMode) {
    fmtBlendMode.addEventListener('change', () => {
      applyToSelected(ann => { ann.blendMode = fmtBlendMode.value; });
    });
  }

  // Arrow start
  const fmtArrowStart = document.getElementById('fmt-arrow-start');
  if (fmtArrowStart) {
    fmtArrowStart.addEventListener('change', () => {
      applyToSelected(ann => {
        if (ann.type === 'arrow') ann.startHead = fmtArrowStart.value;
      });
    });
  }

  // Arrow end
  const fmtArrowEnd = document.getElementById('fmt-arrow-end');
  if (fmtArrowEnd) {
    fmtArrowEnd.addEventListener('change', () => {
      applyToSelected(ann => {
        if (ann.type === 'arrow') ann.endHead = fmtArrowEnd.value;
      });
    });
  }

  // Open properties button
  const fmtOpen = document.getElementById('fmt-open');
  if (fmtOpen) {
    fmtOpen.addEventListener('click', () => {
      const propertiesPanel = document.getElementById('properties-panel');
      if (propertiesPanel) propertiesPanel.classList.add('visible');
      if (state.selectedAnnotations.length === 1) {
        showProperties(state.selectedAnnotations[0]);
      } else if (state.selectedAnnotations.length > 1) {
        showMultiSelectionProperties();
      }
    });
  }

  // Hide annotation button
  const fmtHide = document.getElementById('fmt-hide');
  if (fmtHide) {
    fmtHide.addEventListener('click', () => {
      applyToSelected(ann => { ann.hidden = !ann.hidden; });
    });
  }

  // Reset location button
  const fmtResetLocation = document.getElementById('fmt-reset-location');
  if (fmtResetLocation) {
    fmtResetLocation.addEventListener('click', () => {
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
    });
  }
}

// Helper: create a hidden <input type="color"> for picking colors
function createHiddenColorInput() {
  const input = document.createElement('input');
  input.type = 'color';
  input.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
  document.body.appendChild(input);
  return input;
}
