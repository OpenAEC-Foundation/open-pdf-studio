// Helper utility functions
import i18next from '../i18n/config.js';
import { displayKey } from '../annotations/corrections/model.js';

// Format date for display
export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// formatDate for many dates in a row (the annotation list): the same text,
// but the two locale formatters are made once per formatter instead of twice
// per date, which is what made a list of a few thousand annotations slow
// (#491). Make a new one per run, so a changed locale or time zone is picked
// up the next time.
export function createDateFormatter() {
  let datePart = null;
  let timePart = null;
  return (date) => {
    if (!date) return '';
    const d = new Date(date);
    // An invalid date: Intl throws where toLocale*String gives "Invalid Date".
    if (Number.isNaN(d.getTime())) return formatDate(date);
    datePart ??= new Intl.DateTimeFormat();
    timePart ??= new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
    return datePart.format(d) + ' ' + timePart.format(d);
  };
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
  const key = `types.${type}`;
  const translated = i18next.t(key, { ns: 'properties' });
  if (translated !== key) return translated;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// English fallback for the names of proofreading corrections (#508).
const CORRECTION_NAMES = { replaceText: 'Replace Text', caret: 'Inserted Text', crossOut: 'Cross-Out' };

// Display name of one annotation: a proofreading correction (#508) is named
// after its kind (replace, insert, delete), anything else after its type.
// `annotations`: all annotations of the document (a Map by id or an array),
// to resolve the link of a replacement.
export function getAnnotationDisplayName(ann, annotations) {
  const key = displayKey(ann, annotations);
  if (key) return i18next.t(`types.${key}`, { ns: 'properties', defaultValue: CORRECTION_NAMES[key] });
  return getTypeDisplayName(ann.type);
}
