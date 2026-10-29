// The saver tells the tags panel that a save wrote the structure edits (#384),
// without importing the panel (and the UI behind it) into the saver.

const listeners = new Set();

/** Register `fn(doc)`; returns a function that unregisters it. */
export function onStructEditsSaved(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyStructEditsSaved(doc) {
  for (const fn of listeners) {
    try { fn(doc); } catch (err) { console.warn('[accessibility] listener failed:', err); }
  }
}
