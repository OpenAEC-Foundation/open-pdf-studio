// Native-session lifecycle for the central document manager (#1067).
// Never persist credentials or expose the native handle to the UI.
const ID = /^[a-f0-9]{32}$/;
const ROLES = new Set(['owner', 'reader', 'editor']);
const NATIVE_ERRORS = new Set(['INVALID_SERVER', 'AUTHENTICATION_FAILED', 'RATE_LIMITED',
  'BUSY', 'SESSION_LIMIT', 'SESSION_CLOSED', 'NETWORK_ERROR']);
const fail = (code) => new Error(code);

function documentPage(body, after, limit) {
  if (!body || !Array.isArray(body.documents) || body.documents.length > limit ||
      typeof body.hasMore !== 'boolean' || typeof body.cursor !== 'string') throw fail('INVALID_RESPONSE');
  let previous = after || '';
  const documents = body.documents.map((row) => {
    if (!row || typeof row.id !== 'string' || !ID.test(row.id) || row.id <= previous || typeof row.title !== 'string' ||
        !row.title.length || row.title.length > 256 || !ROLES.has(row.role) ||
        !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.hasPdf !== 'boolean') throw fail('INVALID_RESPONSE');
    previous = row.id;
    return { id: row.id, title: row.title, role: row.role, revision: row.revision, hasPdf: row.hasPdf };
  });
  if (body.cursor !== previous || (body.hasMore && !documents.length)) throw fail('INVALID_RESPONSE');
  return { documents, cursor: body.cursor, hasMore: body.hasMore };
}

export function createCentralReviewClient(invoke, onLogoutWarning = () => {}) {
  let session = null, generation = 0, disposed = false;
  async function release(handle) {
    if (!handle) return;
    try { await invoke('central_review_logout', { session: handle }); }
    catch { onLogoutWarning(); } // No raw native/server details reach UI or logs.
  }
  const current = (version) => !disposed && generation === version;
  async function json(operation) {
    const version = generation, handle = session;
    if (disposed || !handle) throw fail('SESSION_CLOSED');
    let reply;
    try { reply = await invoke('central_review_json', { session: handle, operation }); }
    catch (error) {
      if (!current(version)) throw fail('STALE');
      throw fail(NATIVE_ERRORS.has(error) ? error : 'REQUEST_FAILED');
    }
    if (!current(version)) throw fail('STALE');
    if (reply?.status !== 200) throw fail(({ 400: 'INVALID_REQUEST', 401: 'SESSION_CLOSED',
      403: 'ACCESS_DENIED', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' })[reply?.status] || 'REQUEST_FAILED');
    return reply.body;
  }
  return {
    async login(server, name, password) {
      if (disposed) throw fail('STALE');
      const version = ++generation, old = session;
      session = null;
      await release(old);
      if (!current(version)) throw fail('STALE');
      let handle;
      const args = { server, name, password };
      password = '';
      try { handle = await invoke('central_review_login', args); }
      catch (error) {
        if (!current(version)) throw fail('STALE');
        throw fail(NATIVE_ERRORS.has(error) ? error : 'REQUEST_FAILED');
      } finally { args.password = ''; }
      if (!current(version)) { await release(handle); throw fail('STALE'); }
      if (typeof handle !== 'string' || !/^central-[0-9]+$/.test(handle)) throw fail('INVALID_RESPONSE');
      session = handle;
    },
    async documents(after = null) {
      if (after !== null && !ID.test(after)) throw fail('INVALID_REQUEST');
      return documentPage(await json({ action: 'documents', after, limit: 50 }), after, 50);
    },
    async share(document, name, role) {
      if (!ID.test(document) || !name.trim() || ![null, 'reader', 'editor'].includes(role)) throw fail('INVALID_REQUEST');
      const result = await json({ action: 'memberByName', document, name, role });
      if (result?.ok !== true || typeof result.userId !== 'string' || !ID.test(result.userId)) throw fail('INVALID_RESPONSE');
    },
    logout() {
      ++generation;
      const old = session;
      session = null;
      return release(old);
    },
    dispose() {
      disposed = true;
      return this.logout();
    },
  };
}
