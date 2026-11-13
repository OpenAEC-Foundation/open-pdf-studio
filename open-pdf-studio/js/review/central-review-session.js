import { createCentralReviewClient } from './central-review-client.js';

// A manager owns the login; each open PDF retains a document-scoped lease.
// Closing the manager releases its ownership, while explicit logout revokes
// every lease. No token or native session handle crosses this boundary.
export function createCentralReviewSession(invoke, onLogoutWarning) {
  const client = createCentralReviewClient(invoke, onLogoutWarning);
  const leases = new Set();
  let ownerClosed = false, connected = false, generation = 0;
  const owner = () => { if (ownerClosed) throw new Error('STALE'); };
  const releaseIfUnused = () => ownerClosed && !leases.size ? client.dispose() : Promise.resolve();
  async function manage(method, args) {
    owner();
    const version = generation;
    const check = () => { owner(); if (generation !== version) throw new Error('STALE'); };
    try { const result = await client[method](...args); check(); return result; }
    catch (error) { check(); throw error; }
  }
  return {
    async login(...args) {
      owner();
      const version = ++generation;
      leases.clear(); connected = false;
      await client.login(...args);
      if (ownerClosed || generation !== version) throw new Error('STALE');
      connected = true;
    },
    documents(...args) { return manage('documents', args); },
    share(...args) { return manage('share', args); },
    retain(document) {
      owner();
      if (!connected) throw new Error('SESSION_CLOSED');
      if (typeof document !== 'string' || !/^[a-f0-9]{32}$/.test(document)) throw new Error('INVALID_REQUEST');
      const token = {}, version = generation;
      leases.add(token);
      const valid = () => {
        if (version !== generation || !leases.has(token)) throw new Error('STALE');
      };
      const call = async (method, id, ...args) => {
        valid();
        if (id !== document) throw new Error('INVALID_REQUEST');
        try {
          const result = await client[method](id, ...args);
          valid();
          return result;
        } catch (error) { valid(); throw error; }
      };
      return Object.freeze({
        snapshot: (id) => call('snapshot', id),
        events: (id, after, wait) => call('events', id, after, wait),
        append: (id, event) => call('append', id, event),
        download: (id) => call('download', id),
        isCurrent: () => version === generation && leases.has(token),
        dispose() { leases.delete(token); return releaseIfUnused(); },
      });
    },
    logout() {
      ++generation; connected = false; leases.clear();
      return client.logout();
    },
    dispose() {
      ownerClosed = true;
      return releaseIfUnused();
    },
  };
}
