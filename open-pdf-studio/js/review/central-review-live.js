import { fingerprint } from './shared-review-core.js';

const clean = data => {
  if (data == null) return null;
  const copy = structuredClone(data); delete copy.nm; return copy;
};
const same = (a, b) => fingerprint(a) === fingerprint(b);

// Serialized, per-document three-way synchronization. The edit base is the
// revision actually shown to this user, never a newer head fetched behind an
// unsent local edit. Neither a lost acknowledgement nor replay discards edits.
export function createCentralReviewLive(connection, { writable = true, onStatus = () => {}, canSync = () => true } = {}) {
  const { resource, sync } = connection;
  const applied = new Map([...resource.read()].map(([id, data]) => [id, { base: null, data }]));
  for (const row of sync.view().annotations) applied.set(row.id, { base: row.base, data: clean(row.data) });
  let stopped = false, running = null, error = '';
  const active = () => !stopped && connection.isCurrent() && resource.isCurrent();
  const check = () => { if (!active()) throw new Error('STALE'); };
  function status() {
    const view = sync.view();
    onStatus({ connected: active(), busy: !!running, writable, error,
      pending: view.pending.length, conflicts: view.pending.filter(entry => entry.status === 'conflict').map(entry => ({
        id: entry.event.ann, ready: !!entry.refreshed,
        remote: clean(view.annotations.find(row => row.id === entry.event.ann)?.data),
      })) });
  }
  function stage() {
    const local = resource.read(), pending = new Set(sync.view().pending.map(entry => entry.event.ann));
    for (const id of new Set([...applied.keys(), ...local.keys()])) {
      const previous = applied.get(id), data = local.get(id) ?? null;
      if (pending.has(id) || same(previous?.data ?? null, data)) continue;
      // A PDF's original annotations do not yet have server revisions. Seed
      // an original before its first deletion; keep the local deletion until
      // that create is replayed, then send the delete on the following cycle.
      sync.stage(id, data === null && !previous?.base ? previous.data : data, previous?.base ?? null);
    }
  }
  function reconcile(before) {
    const view = sync.view(), pending = new Set(view.pending.map(entry => entry.event.id));
    const local = resource.read(), changes = new Map(), next = new Map(applied);
    for (const entry of before) {
      if (!pending.has(entry.event.id)) next.set(entry.event.ann, { base: entry.event.id, data: clean(entry.event.data) });
    }
    for (const row of view.annotations) {
      const previous = next.get(row.id), data = clean(row.data);
      if (previous?.base === row.base) continue;
      // A local edit made while awaiting the network remains on its old base.
      // The next publish then conflicts explicitly instead of overwriting.
      if (!same(local.get(row.id) ?? null, previous?.data ?? null)) continue;
      if (!same(local.get(row.id) ?? null, data)) changes.set(row.id, data);
      next.set(row.id, { base: row.base, data });
    }
    resource.write(changes);
    applied.clear(); for (const [id, row] of next) applied.set(id, row);
  }
  async function work() {
    check();
    if (!canSync()) return;
    if (writable) stage();
    const before = sync.view().pending;
    let publishError;
    if (writable) {
      try { await sync.flush(); } catch (e) { publishError = e; }
      check();
    }
    let more = true;
    try {
      for (let page = 0; more && page < 10; page++) { more = await sync.pull(); check(); }
    } finally {
      confirmed.push(...before.filter(entry => !sync.view().pending.some(p => p.event.id === entry.event.id)));
    }
    // Do not change the model in the middle of a new pointer/text gesture.
    // Replay confirmation is retained until the adapter is safe to reconcile.
    if (canSync()) { reconcile(confirmed); confirmed.length = 0; }
    if (publishError && sync.view().pending.length) throw publishError;
  }
  const confirmed = [];
  return {
    step() {
      if (running) return running;
      if (stopped) return Promise.resolve();
      running = Promise.resolve().then(async () => {
        // A deferred acknowledgement must be reconciled before staging more
        // local edits, even when the preceding pull ended during a gesture.
        check();
        if (canSync() && confirmed.length) { reconcile(confirmed); confirmed.length = 0; }
        await work(); error = sync.view().pending.some(entry => entry.status === 'conflict') ? 'CONFLICT' : '';
      }).catch(async e => {
        error = e.message;
        if (e.message === 'STALE') await this.stop();
      }).finally(() => { running = null; status(); });
      status();
      return running;
    },
    resolve(id, choice) {
      check(); if (running || !canSync()) throw new Error('BUSY');
      const entry = sync.view().pending.find(item => item.event.ann === id);
      if (entry?.status !== 'conflict' || !entry.refreshed) throw new Error('REFRESH_REQUIRED');
      const row = sync.view().annotations.find(item => item.id === id);
      const remote = clean(row?.data);
      if (choice === 'discard') {
        resource.write(new Map([[id, remote]]));
        sync.resolve(id, 'discard');
      } else if (choice === 'replace') sync.resolve(id, 'replace', resource.read().get(id) ?? null);
      else throw new Error('INVALID_REQUEST');
      applied.set(id, { base: row?.base ?? null, data: remote });
      error = ''; status();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await connection.disconnect(); status();
    },
    status,
  };
}
