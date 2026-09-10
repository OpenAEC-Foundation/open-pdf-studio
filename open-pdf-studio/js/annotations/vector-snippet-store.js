// Bronbytes van vectorknipsels, ontdubbeld op inhoud.
//
// Een knipsel draagt zijn eigen kopie van de bronpagina, zodat het blijft
// werken als de bron gesloten, verplaatst of gewijzigd is. Tien knipsels uit
// hetzelfde blad hoeven die kopie niet tien keer te bewaren: de annotatie
// draagt alleen een sleutel, de bytes staan hier.
//
// De pdfium-worker rendert vanaf een PAD, niet vanuit bytes (zie
// pdfium-worker/src/main.rs). Wie een voorvertoning wil vraagt daarom padVan()
// aan; die schrijft de bytes één keer weg en onthoudt waar.

const _bytes = new Map();   // sleutel -> Uint8Array
const _paden = new Map();   // sleutel -> pad op schijf

/**
 * Inhoudssleutel van een knipsel: twee verweven FNV-achtige hashes, samen 64
 * bits. Geen cryptografie — het doel is ontdubbelen, niet beveiligen.
 * @param {Uint8Array} bytes
 * @returns {string} 16 hexadecimale tekens
 */
export function sleutelVoor(bytes) {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + bytes[i] + i, 0x85ebca6b) >>> 0;
  }
  // De lengte meenemen scheelt botsingen bij bestanden die op elkaar lijken.
  h2 = Math.imul(h2 ^ bytes.length, 0xc2b2ae35) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Bewaart de bytes en geeft hun sleutel terug. Dezelfde inhoud levert dezelfde
 * sleutel en wordt niet nog een keer opgeslagen.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bewaar(bytes) {
  const sleutel = sleutelVoor(bytes);
  if (!_bytes.has(sleutel)) _bytes.set(sleutel, bytes);
  return sleutel;
}

/** @returns {Uint8Array|null} */
export function bytesVan(sleutel) {
  return _bytes.get(sleutel) || null;
}

/** @returns {string[]} */
export function sleutels() {
  return [..._bytes.keys()];
}

export function heeft(sleutel) {
  return _bytes.has(sleutel);
}

/**
 * Gooit alles weg waar geen enkel knipsel meer naar verwijst. Aanroepen na het
 * verwijderen of vastzetten van knipsels, zodat een vastgezet knipsel zijn
 * bronpagina niet eeuwig meesleept.
 * @param {Iterable<string>} gebruikteSleutels
 * @returns {number} aantal verwijderde sleutels
 */
export function wisOngebruikt(gebruikteSleutels) {
  const houden = new Set(gebruikteSleutels || []);
  let weg = 0;
  for (const sleutel of [..._bytes.keys()]) {
    if (houden.has(sleutel)) continue;
    _bytes.delete(sleutel);
    _paden.delete(sleutel);
    weg++;
  }
  return weg;
}

/** Alleen voor tests en het sluiten van een document. */
export function leegmaken() {
  _bytes.clear();
  _paden.clear();
}

/**
 * Pad op schijf voor de worker. `schrijf(sleutel, bytes)` doet het echte
 * wegschrijven en hoort van de aanroeper te komen — deze module blijft puur en
 * kent het bestandssysteem niet.
 * @param {string} sleutel
 * @param {(sleutel: string, bytes: Uint8Array) => Promise<string|null>} schrijf
 * @returns {Promise<string|null>}
 */
export async function padVan(sleutel, schrijf) {
  if (_paden.has(sleutel)) return _paden.get(sleutel);
  const bytes = bytesVan(sleutel);
  if (!bytes) return null;
  const pad = await schrijf(sleutel, bytes);
  if (pad) _paden.set(sleutel, pad);
  return pad;
}
