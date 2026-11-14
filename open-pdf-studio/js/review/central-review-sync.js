import { validateRequest, validateSnapshot, validateReplay, validateEvent } from './central-review-protocol.js';

// Per-document protocol controller, independent of app state/rendering. Views
// are detached snapshots; the UI adapter must put them in its mutable store.
// Pending mutations stay separate from the server state, including conflicts.
export function createCentralReviewSync(client, document, makeId = () => crypto.randomUUID()) {
  let cursor = 0, ready = false, closed = false, busy = false;
  const heads = new Map(), pending = new Map();
  const active = () => { if (closed) throw new Error('STALE'); };
  async function exclusive(work) {
    active();
    if (busy) throw new Error('BUSY');
    busy = true;
    try { return await work(); } catch (error) { active(); throw error; } finally { busy = false; }
  }
  function checkReady() {
    active();
    if (!ready) throw new Error('NOT_READY');
  }
  function mutation(ann, data) {
    const head = heads.get(ann);
    if (data === null && !head) throw new Error('INVALID_REQUEST');
    return validateRequest({ id: makeId(), ann, base: head?.base ?? null,
      op: data === null ? 'delete' : head ? 'edit' : 'create', data });
  }
  function apply(page) {
    // Validate the whole page before advancing either state or cursor.
    const next = new Map(heads);
    for (const event of page.events) {
      const head = next.get(event.ann);
      if (event.op === 'create' ? !!head : !head || head.base !== event.base) throw new Error('INVALID_RESPONSE');
      next.set(event.ann, { id: event.ann, base: event.id, data: event.data });
    }
    heads.clear();
    for (const [id, head] of next) heads.set(id, head);
    cursor = page.cursor;
    for (const event of page.events) {
      if (pending.get(event.ann)?.event.id === event.id) pending.delete(event.ann);
    }
    if (!page.hasMore) for (const entry of pending.values()) {
      if (entry.status === 'conflict') entry.refreshed = true;
    }
  }
  return {
    view() {
      return structuredClone({ cursor, ready, closed, annotations: [...heads.values()],
        pending: [...pending.values()] });
    },
    initialize() {
      return exclusive(async () => {
        if (ready) throw new Error('ALREADY_INITIALIZED');
        const snapshot = validateSnapshot(await client.snapshot(document));
        active();
        for (const head of snapshot.annotations) heads.set(head.id, head);
        cursor = snapshot.cursor;
        ready = true;
      });
    },
    stage(ann, data) {
      checkReady();
      if (pending.has(ann)) throw new Error('PENDING_CHANGE');
      const event = mutation(ann, data);
      pending.set(ann, { event, status: 'pending' });
      return event.id;
    },
    // One bounded page per call. The adapter decides when to long-poll or
    // reconnect; failed requests never advance the cursor or clear edits.
    pull(wait = 0) {
      return exclusive(async () => {
        checkReady();
        const page = validateReplay(await client.events(document, cursor, wait), cursor, 100);
        active();
        apply(page);
        return page.hasMore;
      });
    },
    flush() {
      return exclusive(async () => {
        checkReady();
        for (const [ann, entry] of [...pending]) {
          if (entry.status === 'acknowledged') continue;
          if (entry.status === 'conflict') throw new Error('CONFLICT');
          try {
            const ack = validateEvent(await client.append(document, structuredClone(entry.event)));
            active();
            // The client validates the complete acknowledgement. Keep this
            // identity guard for injected adapters as well.
            if (ack.id !== entry.event.id || ack.ann !== ann) throw new Error('INVALID_RESPONSE');
            entry.status = 'acknowledged';
            // Do not advance the replay cursor: other clients may have
            // committed between our last pull and this acknowledgement.
          } catch (error) {
            active();
            if (error.message === 'CONFLICT') {
              entry.status = 'conflict';
              entry.current = error.current ?? null;
              entry.refreshed = false;
            }
            throw error;
          }
        }
      });
    },
    // Only after replay catches up may the user choose a replacement from the
    // displayed server state. A new event ID/base makes that choice explicit.
    resolve(ann, choice, data) {
      checkReady();
      if (busy) throw new Error('BUSY');
      const entry = pending.get(ann);
      if (entry?.status !== 'conflict') throw new Error('NO_CONFLICT');
      if (choice === 'discard') { pending.delete(ann); return; }
      if (choice !== 'replace') throw new Error('INVALID_REQUEST');
      if (!entry.refreshed) throw new Error('REFRESH_REQUIRED');
      pending.set(ann, { event: mutation(ann, data), status: 'pending' });
    },
    close() { closed = true; },
  };
}
