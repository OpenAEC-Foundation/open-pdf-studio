// Toegang tot het beeldwerk in Rust (crate open-pdf-image, commando in
// src-tauri/src/beeld.rs):
//   png_naar_xobject   een PNG naar de streams van een beeld-XObject
//                      (embed-png-rust.js)
//
// Alleen op de desktop: de webversie heeft geen Rust en Android geen rauwe
// IPC-bodies. Ontbreekt het commando (oudere backend) of staat de route uit
// (OPDS_RUST_PNG_EMBED=0 in de omgeving van de app), dan blijft JavaScript
// het werk doen.

/** Bytes van een antwoord met rauwe body. */
export function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError('Unexpected image response');
}

/**
 * Welke routes de backend aanbiedt (bit 0 van `beeld_rust_beschikbaar`: PNG).
 * @returns {Promise<{ png: boolean, invoke: Function|null }>}
 */
export async function makeBeeldRust(core) {
  const niets = { png: false, invoke: null };
  if (!core?.invoke) return niets;
  let bits;
  try {
    bits = await core.invoke('beeld_rust_beschikbaar');
  } catch {
    return niets; // oudere backend zonder het commando
  }
  if (!Number.isInteger(bits)) return niets;
  return { png: (bits & 1) !== 0, invoke: core.invoke.bind(core) };
}

let cached = null;
/** De routes voor deze app-instantie (eenmalig bepaald). */
export function getBeeldRust() {
  if (!cached) {
    const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined;
    const android = (() => { try { return tauri?.os?.type?.() === 'android'; } catch { return false; } })();
    cached = !tauri || android
      ? Promise.resolve({ png: false, invoke: null })
      : makeBeeldRust(tauri.core).catch(() => ({ png: false, invoke: null }));
  }
  return cached;
}
