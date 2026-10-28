// Where an external file drop goes while the Edit Pages organizer is open
// (#764). On the desktop the webview hands file drops to setup.js
// (onDragDropEvent) instead of to the page; while a target is registered,
// setup.js passes the drag position and the dropped paths to it instead of
// opening the files in new tabs. In the browser the organizer handles the
// HTML drop events itself.

let target = null;

/**
 * Registers the drop target: { over(x, y), leave(), drop(paths, x, y) },
 * x/y in CSS pixels relative to the window. Returns the function that
 * unregisters it.
 */
export function setPageDropTarget(t) {
  target = t;
  return () => { if (target === t) target = null; };
}

export function pageDropTarget() {
  return target;
}
