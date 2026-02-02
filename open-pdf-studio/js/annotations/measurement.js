import { state } from '../core/state.js';

// Scale calibration: pixels per unit
// Default: 1 pixel = 1 pixel (no calibration)
// After calibration: state.preferences.measureScale = { pixelsPerUnit, unit }
export function getMeasureScale() {
  const ms = state.preferences.measureScale;
  if (ms && ms.pixelsPerUnit > 0) {
    return { pixelsPerUnit: ms.pixelsPerUnit, unit: ms.unit || 'px' };
  }
  return { pixelsPerUnit: 1, unit: 'px' };
}

// Calculate distance between two points
export function calculateDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  const scale = getMeasureScale();
  return {
    value: pixelDist / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: pixelDist
  };
}

// Calculate area of a polygon (using shoelace formula)
export function calculateArea(points) {
  if (!points || points.length < 3) return { value: 0, unit: 'px\u00B2', pixels: 0 };

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  area = Math.abs(area) / 2;

  const scale = getMeasureScale();
  const scaledArea = area / (scale.pixelsPerUnit * scale.pixelsPerUnit);
  return {
    value: scaledArea,
    unit: scale.unit + '\u00B2',
    pixels: area
  };
}

// Calculate perimeter of a polyline
export function calculatePerimeter(points) {
  if (!points || points.length < 2) return { value: 0, unit: 'px', pixels: 0 };

  let totalPixels = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    totalPixels += Math.sqrt(dx * dx + dy * dy);
  }

  const scale = getMeasureScale();
  return {
    value: totalPixels / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: totalPixels
  };
}

// Format measurement for display
export function formatMeasurement(measurement) {
  const val = measurement.value;
  if (val < 0.01) return `0 ${measurement.unit}`;
  if (val < 1) return `${val.toFixed(3)} ${measurement.unit}`;
  if (val < 100) return `${val.toFixed(2)} ${measurement.unit}`;
  return `${val.toFixed(1)} ${measurement.unit}`;
}

// Show scale calibration dialog
export function showCalibrationDialog() {
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: #ffffff;
    border: 1px solid #d4d4d4;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    z-index: 10001;
    width: 320px;
    display: flex;
    flex-direction: column;
  `;

  const titleBar = document.createElement('div');
  titleBar.style.cssText = `
    padding: 8px 12px;
    background: linear-gradient(to bottom, #ffffff, #f5f5f5);
    border-bottom: 1px solid #d4d4d4;
    font-weight: bold;
    font-size: 13px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  titleBar.textContent = 'Scale Calibration';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00D7';
  closeBtn.style.cssText = 'border: none; background: none; font-size: 18px; cursor: pointer; padding: 0 4px; color: #666;';
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#e81123');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#666');
  closeBtn.addEventListener('click', () => dialog.remove());
  titleBar.appendChild(closeBtn);
  dialog.appendChild(titleBar);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 16px;';

  body.innerHTML = `
    <p style="font-size:12px; color:#666; margin:0 0 12px 0;">
      Draw a measurement line of known length, then enter the real-world distance here.
    </p>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
      <label style="font-size:13px;">Known distance:</label>
      <input type="number" id="cal-distance" style="width:80px; padding:4px; border:1px solid #ccc;" min="0.01" step="0.01" value="1">
      <select id="cal-unit" style="padding:4px; border:1px solid #ccc;">
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="in">in</option>
        <option value="pt">pt</option>
        <option value="px" selected>px</option>
      </select>
    </div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
      <label style="font-size:13px;">Measured pixels:</label>
      <input type="number" id="cal-pixels" style="width:80px; padding:4px; border:1px solid #ccc;" min="1" value="72">
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button id="cal-reset" style="padding:4px 12px; border:1px solid #ccc; background:#fff; cursor:pointer; font-size:12px;">Reset</button>
      <button id="cal-apply" style="padding:4px 12px; border:1px solid #0078d4; background:#0078d4; color:#fff; cursor:pointer; font-size:12px;">Apply</button>
    </div>
  `;

  dialog.appendChild(body);
  document.body.appendChild(dialog);

  // Load current scale
  const ms = state.preferences.measureScale;
  if (ms) {
    dialog.querySelector('#cal-unit').value = ms.unit || 'px';
  }

  dialog.querySelector('#cal-apply').addEventListener('click', () => {
    const distance = parseFloat(dialog.querySelector('#cal-distance').value);
    const pixels = parseFloat(dialog.querySelector('#cal-pixels').value);
    const unit = dialog.querySelector('#cal-unit').value;
    if (distance > 0 && pixels > 0) {
      state.preferences.measureScale = { pixelsPerUnit: pixels / distance, unit };
      const { savePreferences } = require('../core/preferences.js');
      // Use dynamic import since this is ES module
      import('../core/preferences.js').then(({ savePreferences }) => savePreferences());
    }
    dialog.remove();
  });

  dialog.querySelector('#cal-reset').addEventListener('click', () => {
    delete state.preferences.measureScale;
    import('../core/preferences.js').then(({ savePreferences }) => savePreferences());
    dialog.remove();
  });
}
