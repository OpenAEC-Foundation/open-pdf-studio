// Undo-floor arithmetic — the shared-session rule, kept pure so it can be
// tested without the app.
//
// In a shared session an agent draws through the MCP bridge while a person
// redlines the same document. Both land on one `doc.undoStack`. Without a
// floor, someone pressing Ctrl-Z a couple of times out of habit walks
// straight back through the agent's linework, and neither party is told.
//
// The floor is a stack DEPTH rather than a per-command author tag because
// `undo-manager.js` already tracks depth for the modified-state check
// (`savedUndoStackLength`), so the correction rules for a trimmed stack were
// already established there. Same reasoning, same arithmetic — see
// `pushUndo()`.
//
// The reverse direction (the agent undoing the person's work) is handled by
// not giving the agent an undo tool at all; see `js/mcp-bridge.js`.

/**
 * How many commands sit above the floor — what undo is still allowed to pop.
 * Never negative: a floor above the stack length means nothing is undoable,
 * which is what a trimmed stack can briefly produce.
 */
export function undoableDepth(stackLength, floor) {
  const len = Number.isFinite(stackLength) ? Math.max(0, stackLength) : 0;
  const f = Number.isFinite(floor) ? Math.max(0, floor) : 0;
  return Math.max(0, len - f);
}

/** Can undo pop anything, given this stack length and floor? */
export function canUndoAt(stackLength, floor) {
  return undoableDepth(stackLength, floor) > 0;
}

/**
 * Clamp a requested floor into the stack. `undefined` means "here" — the
 * current top, which is what committing a batch asks for. 0 clears the floor
 * and hands undo of the whole document back to the person.
 */
export function clampFloor(requested, stackLength) {
  const len = Number.isFinite(stackLength) ? Math.max(0, stackLength) : 0;
  if (requested === undefined) return len;
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(requested, len));
}

/**
 * The floor after the stack's oldest entry is dropped at MAX_UNDO_STACK.
 * Everything shifts down one, so a floor that pointed at depth N now points
 * at N-1. Missing this is how a floor silently starts protecting the wrong
 * commands on a long session.
 */
export function floorAfterTrim(floor) {
  const f = Number.isFinite(floor) ? floor : 0;
  return f > 0 ? f - 1 : 0;
}
