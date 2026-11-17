// Only navigation tools may be selected by persisted startup preferences.
export function normalizeStartupTool(value) {
  return value === 'hand' ? 'hand' : 'select';
}
