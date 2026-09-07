/**
 * In-flight request table — the direct port of `McpAppBridge` in
 * `src-tauri/src/mcp_app_bridge.rs`.
 *
 * Rust parks a `tokio::oneshot` sender in a HashMap keyed by request id,
 * emits a Tauri event, and awaits the receiver with a timeout. Here the
 * oneshot is a Promise, the event is a WebSocket frame, and the timeout is a
 * `setTimeout` — but the shape and the cleanup rules are deliberately the
 * same, including dropping the pending entry on a failed send so a slot can
 * never leak.
 */

export class PendingTable {
  #next = 1;
  #pending = new Map(); // id -> { resolve, reject, timer }

  get size() {
    return this.#pending.size;
  }

  nextId() {
    return this.#next++;
  }

  /**
   * Register a request and return `{ id, promise }`. The promise settles when
   * `resolve(id, result)` is called, or rejects when `timeoutMs` elapses.
   *
   * The caller sends the message AFTER calling this (it needs the id), and
   * must call `fail(id, err)` if the send throws — otherwise the entry sits
   * until the timeout for a message that was never delivered.
   */
  register(timeoutMs) {
    const id = this.nextId();
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new Error(`timed out after ${timeoutMs}ms waiting for the app (request ${id})`));
    }, timeoutMs);
    // Never hold the process open for an in-flight request.
    timer.unref?.();

    this.#pending.set(id, { resolve, reject, timer });
    return { id, promise };
  }

  /** Settle a request with the app's result. Unknown ids are dropped: the
   *  request already timed out, or this is a duplicate response. */
  resolve(id, result) {
    const entry = this.#pending.get(id);
    if (!entry) return false;
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(result);
    return true;
  }

  /** Settle a request with an error — used when the send itself failed. */
  fail(id, error) {
    const entry = this.#pending.get(id);
    if (!entry) return false;
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error instanceof Error ? error : new Error(String(error)));
    return true;
  }

  /** Reject everything — the socket dropped, so no reply is ever coming. */
  failAll(reason) {
    const entries = [...this.#pending.entries()];
    this.#pending.clear();
    for (const [, entry] of entries) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    return entries.length;
  }
}
