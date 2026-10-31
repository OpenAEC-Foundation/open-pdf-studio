// Extra sources for Compare (#465): a side does not have to be an open tab.
//
// A file picked from disk, or the version of an open document from before
// its last save, is registered here under a key of its own. The compare code
// treats that key like a file path: compare-viewport.js asks for its bytes
// here when there is no open document for it. Keys never collide with real
// paths (they carry a prefix), so comparing a tab with its own file on disk
// works too.

const PREFIX = 'opds-compare:';
const _sources = new Map(); // key -> { bytes, name, kind, origin }

/**
 * @param {{kind:'file'|'previous', path:string, name?:string, bytes:Uint8Array}} src
 * @returns {string} the key to use as a compare path
 */
export function registerCompareSource({ kind, path, name, bytes }) {
  const key = `${PREFIX}${kind}:${path}`;
  _sources.set(key, { bytes, name: name || String(path).split(/[\\/]/).pop(), kind, origin: path });
  return key;
}

export function isCompareSource(key) {
  return typeof key === 'string' && key.startsWith(PREFIX);
}

export function compareSourceBytes(key) {
  return _sources.get(key)?.bytes || null;
}

export function compareSourceInfo(key) {
  const s = _sources.get(key);
  return s ? { name: s.name, kind: s.kind, origin: s.origin } : null;
}

export function clearCompareSources() {
  _sources.clear();
}
