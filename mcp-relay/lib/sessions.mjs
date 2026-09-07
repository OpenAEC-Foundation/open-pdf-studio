/**
 * Session table (decisions D-1, D-2 and D-4).
 *
 * D-1: a session is one person's browser tab. It exists exactly while
 * someone is watching, which is the premise of the whole loop rather than a
 * limitation of it. There is no server-side browser and no document here.
 *
 * D-4: the session code is a CREDENTIAL, not a convenience. Anyone who
 * reaches the endpoint holding a valid one can drive the document, so codes
 * carry real entropy, expire with the session, and sit behind a shared
 * secret the agent presents alongside. "Internal use" stops being a boundary
 * the moment the endpoint is public.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

// Crockford-ish base32: no I, L, O or U, so a code read aloud or copied out
// of a screenshot doesn't turn into a different valid code.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 22; // 22 * 5 bits = 110 bits

export function generateCode(length = CODE_LENGTH) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Compare two secrets without leaking their contents through timing. */
export function secretMatches(expected, presented) {
  if (typeof expected !== 'string' || expected === '') return false;
  if (typeof presented !== 'string' || presented === '') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — hash-free constant length via padding is overkill here,
  // so compare lengths first and accept that length is observable.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class SessionStore {
  #sessions = new Map(); // code -> session
  #idleMs;
  #graceMs;

  /**
   * @param {object} opts
   * @param {number} opts.idleMs   drop a session after this long with no traffic
   * @param {number} opts.graceMs  keep a socket-less session this long so a
   *                               browser reload can reclaim its code
   */
  constructor({ idleMs = 8 * 60 * 60 * 1000, graceMs = 5 * 60 * 1000 } = {}) {
    this.#idleMs = idleMs;
    this.#graceMs = graceMs;
  }

  get size() {
    return this.#sessions.size;
  }

  /** Mint a session with no socket attached yet. The tab shows the code; the
   *  agent's MCP URL carries it. */
  create({ author = 'Agent' } = {}) {
    const code = generateCode();
    const session = {
      code,
      id: code, // journal key — same value, named separately for clarity
      author,
      socket: null,
      pending: null, // attached by the server on connect
      wiredEvents: new Set(),
      createdAt: Date.now(),
      lastSeen: Date.now(),
      detachedAt: Date.now(),
      calls: 0,
    };
    this.#sessions.set(code, session);
    return session;
  }

  get(code) {
    const session = this.#sessions.get(code);
    if (!session) return null;
    if (this.#isExpired(session)) {
      this.drop(code, 'expired');
      return null;
    }
    return session;
  }

  touch(session) {
    session.lastSeen = Date.now();
  }

  /**
   * Bind a socket to a session. Only one writer at a time: a second live
   * connection means either a reload (the common case — take over) or a
   * genuine second tab, which would silently split the document into two
   * divergent copies. Taking over is right for the first and visible for the
   * second, because the older tab is told why it was closed.
   */
  attach(session, socket) {
    const previous = session.socket;
    session.socket = socket;
    session.detachedAt = null;
    this.touch(session);
    return previous;
  }

  detach(session, socket) {
    // A late close from a socket we already replaced must not clear the new one.
    if (session.socket !== socket) return false;
    session.socket = null;
    session.detachedAt = Date.now();
    return true;
  }

  drop(code, reason = 'closed') {
    const session = this.#sessions.get(code);
    if (!session) return false;
    this.#sessions.delete(code);
    session.pending?.failAll(`session ${reason}`);
    try { session.socket?.close(1001, reason); } catch { /* already gone */ }
    return true;
  }

  #isExpired(session) {
    const now = Date.now();
    if (now - session.lastSeen > this.#idleMs) return true;
    if (session.socket === null && session.detachedAt !== null &&
        now - session.detachedAt > this.#graceMs) return true;
    return false;
  }

  /** Reap expired sessions. Returns the codes dropped. */
  sweep() {
    const dropped = [];
    for (const [code, session] of this.#sessions) {
      if (this.#isExpired(session)) {
        this.drop(code, 'expired');
        dropped.push(code);
      }
    }
    return dropped;
  }

  list() {
    return [...this.#sessions.values()].map((s) => ({
      code: s.code,
      author: s.author,
      connected: s.socket !== null,
      calls: s.calls,
      createdAt: new Date(s.createdAt).toISOString(),
      lastSeen: new Date(s.lastSeen).toISOString(),
    }));
  }
}
