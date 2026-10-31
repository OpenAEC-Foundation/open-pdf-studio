// render-queue.js
//
// One scheduler in front of every PDF render command that goes to the Rust
// side (whole page, region tile, scene tile). Without it, each caller invoked
// Rust at once and the requests waited there, on the per-worker request lock
// of the PDFium pool, in arrival order. That queue cannot be cancelled: after
// opening a heavy file quickly after another one, the page of the new file
// waited behind the tiles of the previous one, and the page stayed blank for
// seconds (#506).
//
// Now the waiting happens here, where it can be managed:
// - at most `maxInFlight` requests are with Rust at a time (the pool has four
//   workers, so more in flight only lengthens the uncancellable queue there);
//   the page render of the shown document may use a few extra slots so it
//   never waits for a free one;
// - the shown document goes first, and within it the visible page, then
//   visible tiles, then prefetch work (thumbnails, zoom pre-warm);
// - work of a document that is no longer shown (tab switch) or that was
//   closed is dropped before it starts, and a result that arrives after that
//   is discarded: the caller gets a RenderCancelledError instead of a bitmap,
//   so no late callback draws the old document into the new view or puts its
//   pixels back into a cache that was just emptied.
// A render that is already running in a PDFium worker cannot be interrupted;
// the bound on requests in flight is what keeps that tail short.
//
// Pure module without DOM or app imports, so it runs under plain node. The
// app tells it which document is shown via setActiveDocumentProvider
// (render-queue-state.js).

export const RENDER_PRIORITY = Object.freeze({
  /** The page the user looks at (whole-page render, cold-open preview). */
  PAGE: 0,
  /** Visible tiles and sharpness upgrades of the shown page. */
  TILE: 1,
  /** Speculative work: thumbnails, neighbour pages, zoom pre-warm. */
  PREFETCH: 2,
});

export class RenderCancelledError extends Error {
  constructor(reason = 'render cancelled') {
    super(reason);
    this.name = 'RenderCancelledError';
    this.renderCancelled = true;
  }
}

/** True when a render was dropped because its document is no longer shown or was closed. */
export function isRenderCancelled(error) {
  return !!error && (error instanceof RenderCancelledError || error.renderCancelled === true);
}

/**
 * @param {object} [options]
 * @param {number} [options.maxInFlight=4]      requests with Rust at a time
 * @param {number} [options.foregroundReserve=2] extra slots for a PAGE render of the shown document
 * @param {number} [options.prefetchInFlight=2]  at most this many PREFETCH requests in flight
 * @param {(docKey: string) => boolean} [options.isDocumentShown]
 *   false when the document with this key (file path) is open but not shown;
 *   by default every document counts as shown
 */
export function createRenderQueue({
  maxInFlight = 4,
  foregroundReserve = 2,
  prefetchInFlight = 2,
  isDocumentShown = () => true,
} = {}) {
  let provider = isDocumentShown;
  let seq = 0;
  let inFlight = 0;
  let prefetchRunning = 0;
  const queued = [];
  const groups = new Map();
  const epochs = new Map();

  const epochOf = (docKey) => epochs.get(docKey) || 0;

  const isShown = (docKey) => {
    if (docKey == null) return true;
    try { return provider(docKey) !== false; } catch { return true; }
  };

  // Still wanted? Released documents never; hidden ones only on request.
  const stillWanted = (entry) => entry.epoch === epochOf(entry.docKey)
    && (entry.keepWhenHidden || isShown(entry.docKey));

  const cancel = (entry, reason) => {
    entry.reject(new RenderCancelledError(reason));
  };

  const rank = (entry) => (isShown(entry.docKey) ? 0 : 1);

  const limitFor = (entry) => (
    entry.priority === RENDER_PRIORITY.PAGE && rank(entry) === 0
      ? maxInFlight + foregroundReserve
      : maxInFlight
  );

  const eligible = (entry) => {
    if (inFlight >= limitFor(entry)) return false;
    if (entry.priority >= RENDER_PRIORITY.PREFETCH && prefetchRunning >= prefetchInFlight) return false;
    if (entry.group != null && (groups.get(entry.group) || 0) >= entry.groupLimit) return false;
    return true;
  };

  const start = (entry) => {
    inFlight++;
    if (entry.priority >= RENDER_PRIORITY.PREFETCH) prefetchRunning++;
    if (entry.group != null) groups.set(entry.group, (groups.get(entry.group) || 0) + 1);
    const done = () => {
      inFlight--;
      if (entry.priority >= RENDER_PRIORITY.PREFETCH) prefetchRunning--;
      if (entry.group != null) {
        const n = (groups.get(entry.group) || 1) - 1;
        if (n > 0) groups.set(entry.group, n); else groups.delete(entry.group);
      }
    };
    let result;
    try {
      result = Promise.resolve(entry.run());
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      (value) => {
        done();
        if (stillWanted(entry)) {
          entry.resolve(value);
        } else {
          try { entry.dispose?.(value); } catch { /* releasing is best effort */ }
          cancel(entry, 'render result of a closed or hidden document discarded');
        }
        pump();
      },
      (error) => {
        done();
        if (stillWanted(entry)) entry.reject(error);
        else cancel(entry, 'render of a closed or hidden document failed after it was dropped');
        pump();
      },
    );
  };

  function pump() {
    // Drop what is no longer wanted before it costs a worker.
    for (let i = queued.length - 1; i >= 0; i--) {
      if (!stillWanted(queued[i])) {
        const [entry] = queued.splice(i, 1);
        cancel(entry, 'render of a closed or hidden document dropped from the queue');
      }
    }
    if (!queued.length) return;
    queued.sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || a.seq - b.seq);
    for (let i = 0; i < queued.length;) {
      const entry = queued[i];
      if (eligible(entry)) {
        queued.splice(i, 1);
        start(entry);
      } else {
        i++;
      }
    }
  }

  return {
    /**
     * Queue a render. `run` starts the actual invoke and returns its promise.
     * @param {() => Promise<any>} run
     * @param {object} [options]
     * @param {string|null} [options.docKey]  file path of the document; null = never dropped
     * @param {number} [options.priority]  RENDER_PRIORITY value (default TILE)
     * @param {string|null} [options.group]  requests that serialize on the same worker
     * @param {number} [options.groupLimit]  at most this many of `group` in flight
     * @param {boolean} [options.keepWhenHidden]  still run and deliver when the document is
     *   not shown (closing it still cancels)
     * @param {(value:any) => void} [options.dispose]  frees a result that is discarded
     * @returns {Promise<any>} rejects with RenderCancelledError when dropped
     */
    schedule(run, {
      docKey = null,
      priority = RENDER_PRIORITY.TILE,
      group = null,
      groupLimit = Infinity,
      keepWhenHidden = false,
      dispose = null,
    } = {}) {
      return new Promise((resolve, reject) => {
        const entry = {
          run, docKey, priority, group, groupLimit, keepWhenHidden, dispose,
          resolve, reject, seq: ++seq, epoch: epochOf(docKey),
        };
        if (!stillWanted(entry)) {
          cancel(entry, 'render requested for a document that is not shown');
          return;
        }
        queued.push(entry);
        pump();
      });
    },

    /** The document was closed: drop its queued work and discard what is still running. */
    releaseDocument(docKey) {
      if (docKey == null) return;
      epochs.set(docKey, epochOf(docKey) + 1);
      pump();
    },

    /** Another document is shown now: drop the hidden one's queued work, start the new one's. */
    activeDocumentChanged() {
      pump();
    },

    /** Changes which document counts as shown (see the options of createRenderQueue). */
    setActiveDocumentProvider(fn) {
      provider = typeof fn === 'function' ? fn : () => true;
      pump();
    },

    /** Changes the epoch when the document is closed; a render compares it before caching. */
    documentEpoch(docKey) {
      return epochOf(docKey);
    },

    /** For tests and diagnostics. */
    stats() {
      return { queued: queued.length, inFlight, prefetchRunning };
    },
  };
}

const docKeysOf = (doc) => (doc ? [doc.filePath, doc.saveTargetPath].filter(Boolean) : []);

/**
 * Is the document behind this file path shown? Only a path of an open tab
 * other than the active one counts as hidden. A path no tab uses (a preview,
 * a compare source, a file still being opened) is never held back; closing a
 * document cancels its work through releaseDocument.
 * @param {string} docKey
 * @param {object[]} documents  the open documents (tabs)
 * @param {number} activeIndex  index of the active one
 */
export function documentShown(docKey, documents, activeIndex) {
  const active = documents?.[activeIndex];
  if (docKeysOf(active).includes(docKey)) return true;
  return !(documents || []).some((d) => d !== active && docKeysOf(d).includes(docKey));
}

/** The scheduler of the app: every Rust render command goes through it. */
export const renderQueue = createRenderQueue();
