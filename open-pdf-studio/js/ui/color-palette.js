import { state } from '../core/state.js';
import { updateColorDisplay } from './properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';

// Color palette options - organized by columns (each column = one hue with shades)
// Column 0: Grays, Column 1: Reds, Column 2: Oranges, Column 3: Yellows,
// Column 4: Greens, Column 5: Cyans, Column 6: Light Blues, Column 7: Blues,
// Column 8: Purples, Column 9: Pinks/Magentas
const PALETTE_COLORS = [
  // Row 0 (lightest)
  '#ffffff', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  // Row 1
  '#efefef', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  // Row 2
  '#d9d9d9', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  // Row 3 (saturated colors)
  '#b7b7b7', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  // Row 4
  '#999999', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  // Row 5
  '#666666', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  // Row 6
  '#434343', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
  // Row 7 (darkest)
  '#000000', '#4d0000', '#5c2e00', '#5c5c00', '#1a3d10', '#082929', '#0f2d52', '#04234a', '#180d38', '#380d24',
];

// Initialize a color palette
export function initColorPalette(options) {
  const { paletteId, colorInputId, previewId, hexId, customBtnId, buttonId, dropdownId } = options;

  const palette = document.getElementById(paletteId);
  const colorInput = document.getElementById(colorInputId);
  const preview = document.getElementById(previewId);
  const hexLabel = document.getElementById(hexId);
  const customBtn = document.getElementById(customBtnId);
  const button = document.getElementById(buttonId);
  const dropdown = document.getElementById(dropdownId);

  if (!palette) return;

  // Clear existing content
  palette.innerHTML = '';

  // Create color swatches
  PALETTE_COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.cssText = `
      width: 16px;
      height: 16px;
      background-color: ${color};
      border: 1px solid rgba(0,0,0,0.2);
      cursor: pointer;
      border-radius: 2px;
    `;
    swatch.dataset.color = color;

    swatch.addEventListener('click', () => {
      if (colorInput) colorInput.value = color;
      updateColorDisplay(palette, color, preview, hexLabel);

      // Update selected annotation if applicable
      if (state.selectedAnnotation) {
        updateAnnotationColor(colorInputId, color);
      }

      // Close dropdown
      if (dropdown) dropdown.classList.remove('show');
    });

    swatch.addEventListener('mouseenter', () => {
      swatch.style.transform = 'scale(1.2)';
      swatch.style.zIndex = '1';
    });
    swatch.addEventListener('mouseleave', () => {
      swatch.style.transform = 'scale(1)';
      swatch.style.zIndex = '0';
    });

    palette.appendChild(swatch);
  });

  // Custom color button
  if (customBtn && colorInput) {
    customBtn.addEventListener('click', () => {
      colorInput.click();
    });

    colorInput.addEventListener('input', () => {
      const color = colorInput.value;
      updateColorDisplay(palette, color, preview, hexLabel);

      if (state.selectedAnnotation) {
        updateAnnotationColor(colorInputId, color);
      }
    });
  }

  // Toggle dropdown
  if (button && dropdown) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close other dropdowns first
      document.querySelectorAll('.color-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('show');
      });
      dropdown.classList.toggle('show');
    });
  }
}

// Update annotation color based on which input was changed
function updateAnnotationColor(colorInputId, color) {
  const annotation = state.selectedAnnotation;
  if (!annotation || annotation.locked) return;

  annotation.modifiedAt = new Date().toISOString();

  switch (colorInputId) {
    case 'prop-color':
      annotation.color = color;
      break;
    case 'prop-fill-color':
      annotation.fillColor = color;
      break;
    case 'prop-stroke-color':
      annotation.strokeColor = color;
      break;
    case 'prop-text-color':
      annotation.textColor = color;
      annotation.color = color; // Keep in sync
      break;
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Initialize all color palettes
export function initAllColorPalettes() {
  initColorPalette({
    paletteId: 'main-color-palette',
    colorInputId: 'prop-color',
    previewId: 'prop-color-preview',
    hexId: 'prop-color-hex',
    customBtnId: 'main-color-custom-btn',
    buttonId: 'main-color-btn',
    dropdownId: 'main-color-dropdown'
  });

  initColorPalette({
    paletteId: 'fill-color-palette',
    colorInputId: 'prop-fill-color',
    previewId: 'prop-fill-color-preview',
    hexId: 'prop-fill-color-hex',
    customBtnId: 'fill-color-custom-btn',
    buttonId: 'fill-color-btn',
    dropdownId: 'fill-color-dropdown'
  });

  initColorPalette({
    paletteId: 'stroke-color-palette',
    colorInputId: 'prop-stroke-color',
    previewId: 'prop-stroke-color-preview',
    hexId: 'prop-stroke-color-hex',
    customBtnId: 'stroke-color-custom-btn',
    buttonId: 'stroke-color-btn',
    dropdownId: 'stroke-color-dropdown'
  });

  initColorPalette({
    paletteId: 'text-color-palette',
    colorInputId: 'prop-text-color',
    previewId: 'prop-text-color-preview',
    hexId: 'prop-text-color-hex',
    customBtnId: 'text-color-custom-btn',
    buttonId: 'text-color-btn',
    dropdownId: 'text-color-dropdown'
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.color-dropdown') && !e.target.closest('.color-btn')) {
      document.querySelectorAll('.color-dropdown').forEach(d => d.classList.remove('show'));
    }
  });

  // Fill color "None" button handler
  const fillColorNoneBtn = document.getElementById('fill-color-none-btn');
  if (fillColorNoneBtn) {
    fillColorNoneBtn.addEventListener('click', () => {
      if (state.selectedAnnotation) {
        // Set fill color to null/empty (no fill)
        state.selectedAnnotation.fillColor = null;
        state.selectedAnnotation.modifiedAt = new Date().toISOString();

        // Update the preview to show "None" state
        const preview = document.getElementById('prop-fill-color-preview');
        const hexLabel = document.getElementById('prop-fill-color-hex');
        if (preview) {
          preview.style.background = 'linear-gradient(135deg, #fff 45%, #ff0000 45%, #ff0000 55%, #fff 55%)';
        }
        if (hexLabel) {
          hexLabel.textContent = 'None';
        }

        // Close dropdown
        const dropdown = document.getElementById('fill-color-dropdown');
        if (dropdown) dropdown.classList.remove('show');

        if (state.viewMode === 'continuous') {
          redrawContinuous();
        } else {
          redrawAnnotations();
        }
      }
    });
  }
}
