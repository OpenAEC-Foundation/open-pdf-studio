// Status of the shared reviews (#237) for the status bar and the dialog.
// Kept outside the dialog so the indicator stays visible after it closes.
// One entry per document path; listeners get the whole map.
const entries = new Map();
const listeners = new Set();

export function reviewStatus(path) {
  return path ? entries.get(path) ?? null : null;
}

export function setReviewStatus(path, value) {
  if (!path) return;
  if (value) entries.set(path, { ...value });
  else entries.delete(path);
  for (const listener of listeners) {
    try { listener(entries); } catch { /* one listener must not stop the others */ }
  }
}

export function onReviewStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
