// Rust-route voor het rekenwerk per beeld van de monochroommodus (#902).
//
// optimizeMonochromeImage() (monochrome-image.js) leest de PDF-structuur en
// beslist of een beeld in aanmerking komt; het uitpakken, pakken naar één
// bit, Flate- en CCITT G4-coderen en kiezen kan het Tauri-commando
// `monochroom_beeld` (crate open-pdf-monochrome) doen. Dezelfde regels, en
// CCITT-uitvoer byte-gelijk aan ccitt-g4.js.
//
// Alleen op de desktop: de webversie heeft geen Rust en Android geen rauwe
// IPC-bodies. Ontbreekt het commando, of faalt het, dan meldt dit één keer
// een waarschuwing en neemt de JS-encoder het over. OPDS_RUST_MONOCHROME=0
// (omgevingsvariabele van de app) zet de Rust-route uit om te vergelijken.

const KIND = ['skip', 'FlateDecode', 'CCITTFaxDecode'];
const NONE = 0xffffffff;

function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError('Unexpected monochrome response');
}

/** Leest het antwoord van `monochroom_beeld` (zie src-tauri/src/monochroom.rs). */
export function parseMonochromeResponse(value) {
  const bytes = bytesOf(value);
  const kind = KIND[bytes[0]];
  if (!kind) throw new TypeError('Unexpected monochrome response');
  if (kind === 'skip') return { filter: null, reason: new TextDecoder().decode(bytes.subarray(1)), data: null };
  if (bytes.length < 9) throw new TypeError('Unexpected monochrome response');
  const view = new DataView(bytes.buffer, bytes.byteOffset, 9);
  const len = (o) => { const n = view.getUint32(o, true); return n === NONE ? null : n; };
  return { filter: kind, reason: null, flateLength: len(1), ccittLength: len(5), data: bytes.subarray(9) };
}

/**
 * Een encoderfunctie rond `core.invoke` (window.__TAURI__.core), of null als
 * de Rust-route er niet is of uitgezet is. De functie geeft het geparste
 * antwoord en gooit bij elke fout; de aanroeper valt dan terug op JS.
 */
export async function makeMonochromeNative(core) {
  if (!core?.invoke) return null;
  let available;
  try {
    available = await core.invoke('monochroom_rust_beschikbaar');
  } catch {
    return null; // oudere backend zonder het commando
  }
  if (available !== true) return null;
  return async (input, params) => parseMonochromeResponse(await core.invoke('monochroom_beeld', input, {
    headers: { 'x-opds-monochroom': JSON.stringify(params) },
  }));
}

let cached = null;
/** De encoder voor deze app-instantie (eenmalig bepaald), of null. */
export function getMonochromeNative() {
  if (!cached) {
    const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined;
    const android = (() => { try { return tauri?.os?.type?.() === 'android'; } catch { return false; } })();
    cached = !tauri || android ? Promise.resolve(null) : makeMonochromeNative(tauri.core).catch(() => null);
  }
  return cached;
}
