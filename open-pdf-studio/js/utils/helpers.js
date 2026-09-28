// Helper utility functions
import i18next from '../i18n/config.js';

// Format date for display (datum-opmaak.js)
export { formatDate } from './datum-opmaak.js';

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
  const key = `types.${type}`;
  const translated = i18next.t(key, { ns: 'properties' });
  if (translated !== key) return translated;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
