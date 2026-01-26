// Helper utility functions

// Format date for display
export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Generate unique ID for images
export function generateImageId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Snap angle to nearest multiple of snapDegrees
export function snapAngle(angle, snapDegrees) {
  const snapped = Math.round(angle / snapDegrees) * snapDegrees;
  return snapped;
}

// Get display name for annotation type
export function getTypeDisplayName(type) {
  const names = {
    'draw': 'Freehand',
    'highlight': 'Highlight',
    'line': 'Line',
    'arrow': 'Arrow',
    'polyline': 'Polyline',
    'circle': 'Ellipse',
    'box': 'Rectangle',
    'polygon': 'Polygon',
    'cloud': 'Cloud',
    'comment': 'Sticky Note',
    'text': 'Text',
    'textbox': 'Text Box',
    'callout': 'Callout',
    'image': 'Image',
    'textHighlight': 'Text Highlight',
    'textStrikethrough': 'Text Strikethrough',
    'textUnderline': 'Text Underline'
  };
  return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
}
