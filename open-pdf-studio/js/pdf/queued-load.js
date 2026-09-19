// Decides, at the moment a queued file load is about to run, which tab it
// must load into - or that it must not run at all.
//
// openFiles() creates every tab up front and then loads the files one by one
// through a global queue. Heavy drawings take seconds each, so by the time a
// queued load runs the tab list may look different:
//   - the user closed or dragged a tab, so every later index shifted. Loading
//     by the index captured at queue time fills the wrong tab, leaves another
//     one an eternal placeholder and silently drops the last file;
//   - the same file was opened and finished loading through another route (the
//     user opened it while a slow session restore was still checking files, a
//     second double-click in the file manager). Loading it again resets the
//     document under the user's hands: back to page 1, annotations and undo
//     history gone.
//
// The second point holds for EVERY route that opens a file by path (File >
// Open, recent files, places, drag and drop, saved sessions): createTab()
// returns the existing tab for a path that is already open, and loadPDF()
// then empties that document while doc.modified stays set - the next save
// writes the emptied model over the file. documentNeedsLoad()/loadIfNeeded()
// are the shared guard; loader.js wraps them as loadPDFIfNeeded().
//
// Pure: no app state in here. Pass the live document list and the document the
// load was queued for. With a Solid store that must be the store proxy
// (state.documents[index]), not the raw object createDocument() returned:
// indexOf() on the store compares proxies.

/**
 * True when a tab still has to be filled with its file: nothing loaded yet and
 * no load running. A failed earlier load leaves both unset, so it is retried.
 *
 * Every route that opens a file by path asks this before it loads, because
 * createTab() hands back the EXISTING tab for a path that is already open.
 * @param {object} doc
 * @returns {boolean}
 */
export function documentNeedsLoad(doc) {
  return !!doc && !doc.pdfDoc && !doc._isLoading;
}

/**
 * Run `load` only when the tab at `index` still needs its file.
 * @param {Array<object>} documents - the live list of open documents
 * @param {number} index - tab the open route got from createTab()
 * @param {() => Promise<void>} load
 * @returns {Promise<boolean>} true when the load ran
 */
export async function loadIfNeeded(documents, index, load) {
  if (!documentNeedsLoad(documents?.[index])) return false;
  await load();
  return true;
}

/**
 * @param {Array<object>} documents - the live list of open documents
 * @param {object} doc - the document the load was queued for
 * @returns {number} index to load into, or -1 when the load must be skipped
 */
export function queuedLoadTarget(documents, doc) {
  if (!documents || !doc) return -1;
  const index = documents.indexOf(doc);
  // Tab was closed while the load waited in the queue
  if (index === -1) return -1;
  // Already loaded, or being loaded through another route right now
  if (!documentNeedsLoad(doc)) return -1;
  return index;
}

/**
 * The queue behind openFiles(): the tabs appear at once, the files load one by
 * one. One queue per app, so loads stay serialized across separate calls (the
 * single-instance plugin sends one open-files event per file).
 *
 * Everything that touches the app comes in through `deps`, so this is the loop
 * that runs in the app AND in the unit test - against a real store.
 *
 * @param {object} deps
 * @param {() => Array<object>} deps.documents - returns the LIVE document list (the store itself, never a copy)
 * @param {(filePath: string, autoSwitch: boolean) => {index: number}} deps.createTab
 * @param {(index: number) => void} deps.switchToTab
 * @param {(filePath: string, index: number) => Promise<void>} deps.loadPDF
 * @param {(filePath: string) => void} [deps.onLoaded] - after a load that ran
 * @returns {(filePaths: string[], options?: {activate?: boolean}) => Promise<void>}
 */
export function createFileOpenQueue({ documents, createTab, switchToTab, loadPDF, onLoaded }) {
  let queue = Promise.resolve();

  return function openFiles(filePaths, { activate = true } = {}) {
    // 1. Create all tabs instantly (synchronous) so the tab bar updates right away
    const pending = [];
    for (const filePath of filePaths) {
      if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
        const { index } = createTab(filePath, false); // don't auto-switch
        // Keep the document itself, read back from the live list: tabs can be
        // closed or reordered while the loads below wait in the queue. NOT the
        // `doc` createTab() returns - for a new tab that is the raw object, and
        // the store only ever hands out proxies, so it would never be found
        // again and no file would open at all.
        pending.push({ filePath, index, doc: documents()[index] });
      }
    }
    // 2. Switch to the last new tab immediately (shows placeholder until load completes)
    if (pending.length > 0 && activate) {
      switchToTab(pending[pending.length - 1].index);
    }
    // 3. Chain loads onto the queue (serialized even across multiple callers)
    for (const { filePath, doc } of pending) {
      queue = queue.then(async () => {
        // Resolve the tab when the load actually runs. A tab closed meanwhile is
        // skipped, and so is a document that is already loaded (or loading via
        // another route): loading it again would reset it to page 1 and drop
        // its annotations and undo history.
        const index = queuedLoadTarget(documents(), doc);
        if (index === -1) return;
        await loadPDF(filePath, index);
        onLoaded?.(filePath);
      }).catch(e => console.warn('Failed to open file:', filePath, e));
    }
    return queue;
  };
}
