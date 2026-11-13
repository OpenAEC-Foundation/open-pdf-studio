import { createCentralReviewSync } from './central-review-sync.js';

// Coordinates async opening independently of the renderer. The PDF adapter
// owns only its newly created document/temp file and must provide idempotent
// disposal and a generation/closed check. A snapshot is not installed until
// PDF annotations are ready. No existing user tab/file may be reused here.
export function createCentralReviewOpening(session, document, adapter) {
  const lease = session.retain(document);
  const sync = createCentralReviewSync(lease, document);
  let closed = false, started = false, resource = null, disposing = null;
  const valid = () => !closed && lease.isCurrent() && (!resource || resource.isCurrent());
  const check = () => { if (!valid()) throw new Error('STALE'); };
  async function disposeResource() {
    if (!resource) return;
    if (!disposing) disposing = Promise.resolve().then(() => resource.dispose());
    await disposing;
  }
  async function close() {
    closed = true; sync.close();
    // Invalidate requests immediately, before asynchronous PDF teardown.
    const released = lease.dispose();
    try { await disposeResource(); } finally { await released; }
  }
  return {
    async open() {
      if (started) throw new Error('ALREADY_OPENING');
      started = true;
      try {
        check();
        const bytes = await lease.download(document); check();
        await sync.initialize(); check();
        // The adapter can transfer/detach its copy; downloaded bytes stay intact.
        resource = await adapter.open(bytes.slice());
        if (!resource || typeof resource.isCurrent !== 'function' ||
            typeof resource.dispose !== 'function' || typeof resource.ready !== 'function' ||
            typeof resource.install !== 'function') throw new Error('INVALID_ADAPTER');
        check();
        await resource.ready(); check();
        // Bounded catch-up. Sustained writes must not keep opening forever.
        let more = true;
        for (let page = 0; more && page < 100; page++) {
          more = await sync.pull(); check();
        }
        if (more) throw new Error('CATCH_UP_LIMIT');
        // Install is synchronous: the adapter checks its document generation
        // and updates the mutable annotation model as one operation.
        resource.install(sync.view()); check();
        return { resource, sync };
      } catch (error) {
        try { await close(); }
        catch { adapter.onCleanupError?.(); }
        throw error;
      }
    },
    close,
    isCurrent: valid,
  };
}
