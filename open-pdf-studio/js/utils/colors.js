// Color utility functions

// Convert hex color to RGB array [r, g, b] (0-1 range) for PDF
export function hexToColorArray(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ] : [0, 0, 0];
}

// Convert PDF color array to hex string
// PDF.js can return colors as:
// - Array [r, g, b] with values 0-1
// - Uint8ClampedArray with values 0-255
// - null/undefined
export function colorArrayToHex(colorArr, defaultColor = '#000000') {
  if (!colorArr || !colorArr.length) return defaultColor;

  // Check if values are in 0-1 range or 0-255 range
  const isNormalized = colorArr[0] <= 1 && colorArr[1] <= 1 && colorArr[2] <= 1;

  let r, g, b;
  if (isNormalized) {
    r = Math.round(colorArr[0] * 255);
    g = Math.round(colorArr[1] * 255);
    b = Math.round(colorArr[2] * 255);
  } else {
    r = Math.round(colorArr[0]);
    g = Math.round(colorArr[1]);
    b = Math.round(colorArr[2]);
  }

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Parse color string to RGB components
export function parseColor(color) {
  if (!color) return { r: 0, g: 0, b: 0 };

  // Handle hex format
  const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (hex) {
    return {
      r: parseInt(hex[1], 16),
      g: parseInt(hex[2], 16),
      b: parseInt(hex[3], 16)
    };
  }

  // Handle rgb/rgba format
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgb) {
    return {
      r: parseInt(rgb[1]),
      g: parseInt(rgb[2]),
      b: parseInt(rgb[3])
    };
  }

  return { r: 0, g: 0, b: 0 };
}
