import { identifier, validateRequest, validateEvent, validateSnapshot, validateReplay } from './central-review-protocol.js';
// Native-session lifecycle for the central document manager (#1067).
// Never persist credentials or expose the native handle to the UI.
const ID = /^[a-f0-9]{32}$/;
const ROLES = new Set(['owner', 'reader', 'editor']);
const NATIVE_ERRORS = new Set(['INVALID_SERVER', 'AUTHENTICATION_FAILED', 'RATE_LIMITED',
  'BUSY', 'SESSION_LIMIT', 'SESSION_CLOSED', 'NETWORK_ERROR', 'PDF_UNAVAILABLE', 'INVALID_PDF', 'INVALID_RESPONSE']);
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
  async function request(command, args) {
    const version = generation, handle = session;
    if (disposed || !handle) throw fail('SESSION_CLOSED');
    let reply;
    try { reply = await invoke(command, { ...args, session: handle }); }
    catch (error) {
      if (!current(version)) throw fail('STALE');
      throw fail(NATIVE_ERRORS.has(error) ? error : 'REQUEST_FAILED');
    }
    if (!current(version)) throw fail('STALE');
    return reply;
  }
  function bodyOf(reply, status = 200) {
    if (reply?.status !== status) {
      const error = fail(({ 400: 'INVALID_REQUEST', 401: 'SESSION_CLOSED',
        403: 'ACCESS_DENIED', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' })[reply?.status] || 'REQUEST_FAILED');
      if (reply?.status === 409) {
        if (reply.body?.current !== null && !identifier(reply.body?.current)) throw fail('INVALID_RESPONSE');
        error.current = reply.body.current;
      }
      throw error;
    }
    return reply.body;
  }
  async function json(operation, status = 200) {
    return bodyOf(await request('central_review_json', { operation }), status);
  }
  const checkDocument = document => {
    if (typeof document !== 'string' || !ID.test(document)) throw fail('INVALID_REQUEST');
  };
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
      if (after !== null && (typeof after !== 'string' || !ID.test(after))) throw fail('INVALID_REQUEST');
      return documentPage(await json({ action: 'documents', after, limit: 50 }), after, 50);
    },
    async createDocument(title) {
      if (typeof title !== 'string') throw fail('INVALID_REQUEST');
      title = title.normalize('NFC').trim();
      if (!title || [...title].length > 128 || /[\x00-\x1f]/.test(title)) throw fail('INVALID_REQUEST');
      const result = await json({ action: 'createDocument', title }, 201);
      if (typeof result?.id !== 'string' || !ID.test(result.id)) throw fail('INVALID_RESPONSE');
      return { id: result.id, title, role: 'owner', revision: 0, hasPdf: false };
    },
    async upload(document, source, allowed = () => true) {
      checkDocument(document);
      if (!(source instanceof Uint8Array) || source.length > 32 * 1024 * 1024 ||
          ![37,80,68,70,45].every((value, index) => source[index] === value)) throw fail('INVALID_PDF');
      // Pin bytes before the first await. A new login must never inherit an
      // upload prepared by the previous account while its digest was pending.
      const bytes = source.slice(), version = generation;
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (!current(version) || !allowed()) throw fail('STALE');
      const result = bodyOf(await request('central_review_upload', { document, bytes: Array.from(bytes) }));
      if (result?.sha256 !== digest || result?.size !== bytes.length) throw fail('INVALID_RESPONSE');
    },
    async share(document, name, role) {
      if (typeof document !== 'string' || !ID.test(document) || typeof name !== 'string' || !name.trim() || ![null, 'reader', 'editor'].includes(role)) throw fail('INVALID_REQUEST');
      const result = await json({ action: 'memberByName', document, name, role });
      if (result?.ok !== true || typeof result.userId !== 'string' || !ID.test(result.userId)) throw fail('INVALID_RESPONSE');
    },
    async snapshot(document) {
      checkDocument(document);
      return validateSnapshot(await json({ action: 'snapshot', document }));
    },
    async events(document, after, wait = 0) {
      checkDocument(document);
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(wait) || wait < 0 || wait > 25) throw fail('INVALID_REQUEST');
      return validateReplay(await json({ action: 'events', document, after, limit: 100, wait }), after, 100);
    },
    async append(document, event) {
      checkDocument(document);
      const sent = validateRequest(event);
      const result = validateEvent(await json({ action: 'append', document, event: sent }));
      // An acknowledgement for a different mutation must never mark ours saved.
      const same = (a, b) => {
        if (a === b) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
        return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
      };
      if (!Object.keys(sent).every(key => same(sent[key], result[key]))) throw fail('INVALID_RESPONSE');
      return result;
    },
    async download(document) {
      checkDocument(document);
      const result = await request('central_review_download', { document });
      // Tauri's raw IPC response is an ArrayBuffer; never hand its backing
      // storage to PDF.js or a caller that can detach our retained source.
      if (!(result instanceof ArrayBuffer) && !(result instanceof Uint8Array)) throw fail('INVALID_RESPONSE');
      const bytes = new Uint8Array(result).slice();
      if (bytes.length > 32 * 1024 * 1024 || bytes.length < 5 ||
          ![37,80,68,70,45].every((value, index) => bytes[index] === value)) throw fail('INVALID_PDF');
      return bytes;
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
