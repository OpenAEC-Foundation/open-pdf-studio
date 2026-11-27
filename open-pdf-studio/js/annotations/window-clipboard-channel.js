// Session-only transport: no document or clipboard contents are written to disk.
export const CLIPBOARD_EVENT = 'opds:annotation-clipboard:v1';
export async function connectWindowClipboard(receive, { native, Broadcast, exchange, snapshot = () => null } = {}) {
  if (exchange) {
    let closed = false, chain = Promise.resolve();
    const refresh = (candidate = null) => {
      chain = chain.catch(() => {}).then(async () => {
        if (closed) return;
        const response = await exchange(candidate, snapshot()?.id || null);
        if (closed) return;
        if (response?.latest) await receive(response.latest);
        else if (response?.empty && snapshot()) await exchange(snapshot(), snapshot().id);
      });
      return chain;
    };
    const timer = setInterval(() => refresh().catch(() => {}), 1000);
    timer.unref?.();
    return { send: packet => refresh(packet.kind === 'copy' ? packet : null), refresh,
      close() { closed = true; clearInterval(timer); } };
  }
  if (native?.listen && native?.emit) {
    const unlisten = await native.listen(CLIPBOARD_EVENT, e => receive(e.payload));
    return { send: packet => native.emit(CLIPBOARD_EVENT,packet), close: unlisten };
  }
  if (!Broadcast) return null;
  const bus = new Broadcast(CLIPBOARD_EVENT);
  // Node-based app tests supply a BroadcastChannel too; the background
  // listener should not keep that process alive after its work has finished.
  bus.unref?.();
  bus.onmessage = e => receive(e.data);
  return { send: packet => bus.postMessage(packet), close: () => bus.close() };
}
const clone = value => JSON.parse(JSON.stringify(value));
const newer = (a,b) => !b || a.at > b.at || (a.at === b.at && a.id > b.id);
export function createWindowClipboard({ send, apply, prepare = async a => a, now = Date.now, id = () => crypto.randomUUID() }) {
  let latest = null, stopped = false;
  const transmit = packet => { try { Promise.resolve(send(clone(packet))).catch(() => {}); } catch { /* local copy remains available */ } };
  return {
    request() { if (!stopped) transmit({ version:1, kind:'request' }); },
    publish(annotations) {
      if (stopped || !annotations?.length) return;
      latest = { version:1, kind:'copy', at:Math.max(now(), (latest?.at || 0)+1), id:id(), annotations:clone(annotations) };
      transmit(latest);
    },
    async receive(packet) {
      if (stopped || packet?.version !== 1) return;
      if (packet.kind === 'request') { if (latest) transmit(latest); return; }
      if (packet.kind !== 'copy' || !Number.isFinite(packet.at) || typeof packet.id !== 'string'
        || !Array.isArray(packet.annotations) || !packet.annotations.length
        || !packet.annotations.every(a => a && typeof a === 'object' && typeof a.type === 'string')
        || !newer(packet,latest)) return;
      const candidate = clone(packet); latest = candidate;
      // Loading an image from an older copy must never replace a newer copy.
      try {
        const annotations = await prepare(clone(candidate.annotations));
        if (!stopped && latest === candidate) apply(annotations,candidate.at);
      } catch { /* invalid payload leaves the local clipboard intact */ }
    },
    stop() { stopped=true; latest=null; },
    // Transport reads this immutable-by-convention packet; avoid cloning large
    // image data on every poll just to read its version id.
    snapshot() { return latest; },
  };
}
