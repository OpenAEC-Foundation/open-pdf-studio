// PDF.js 6 returns Maps for catalog dictionaries and JavaScript actions.
// Normalize only at the UI boundary; leave PDF.js's own objects unchanged.
export function pdfjsRecord(value) {
  return value instanceof Map ? Object.fromEntries(value) : value;
}
