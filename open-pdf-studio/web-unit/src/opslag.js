// Wat de web-unit onthoudt bij `storage="local"`.
//
// Pure module: de opslag (meestal `window.localStorage`) komt van buiten, zodat
// alles met een nep-opslag in `node --test` te dekken is.
//
// Standaard (`storage="none"`) onthoudt de unit niets. Met `local` bewaart hij
// per document de leespositie (pagina) en de meetschaal, onder sleutels met
// één vaste prefix, zodat de gastheer alles in één handeling kan wissen
// (`clearStorage()`). Geen cookies, geen andere sleutels.

export const SLEUTEL_PREFIX = 'opds-web-unit:';

/** FNV-1a over een stuk van de bytes; snel en genoeg om documenten te scheiden. */
function fnv1a(bytes, van, tot, h = 0x811c9dc5) {
  for (let i = van; i < tot; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Een sleutel voor een document uit zijn bytes: lengte plus een vingerafdruk
 * van het begin en het eind (waar de xref-tabel staat). Hetzelfde bestand
 * levert bij elke opening dezelfde sleutel, zonder het hele bestand te lezen.
 */
export function documentSleutel(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const stuk = 64 * 1024;
  let h = fnv1a(b, 0, Math.min(b.length, stuk));
  h = fnv1a(b, Math.max(0, b.length - stuk), b.length, h);
  return SLEUTEL_PREFIX + 'doc:' + b.length.toString(36) + ':' + h.toString(36);
}

function veilig(fn, terug = null) {
  try { return fn(); } catch { return terug; }
}

/** De bewaarde stand van een document, of `null`. Gooit nooit. */
export function leesStand(opslag, sleutel) {
  if (!opslag || !sleutel) return null;
  const ruw = veilig(() => opslag.getItem(sleutel));
  if (!ruw) return null;
  const s = veilig(() => JSON.parse(ruw));
  if (!s || typeof s !== 'object') return null;
  const uit = {};
  if (Number.isInteger(s.pagina) && s.pagina >= 1) uit.pagina = s.pagina;
  if (s.schaal && s.schaal.eenheidPerPunt > 0 && typeof s.schaal.eenheid === 'string') {
    uit.schaal = { eenheidPerPunt: s.schaal.eenheidPerPunt, noemer: s.schaal.noemer, eenheid: s.schaal.eenheid };
  }
  return Object.keys(uit).length ? uit : null;
}

/** Een stand bewaren (samengevoegd met wat er al stond). Gooit nooit. */
export function bewaarStand(opslag, sleutel, stand) {
  if (!opslag || !sleutel || !stand) return false;
  const oud = leesStand(opslag, sleutel) || {};
  const nieuw = { ...oud, ...stand };
  if (stand.schaal === null) delete nieuw.schaal;
  return veilig(() => { opslag.setItem(sleutel, JSON.stringify(nieuw)); return true; }, false);
}

/** Alles van de unit wissen; andere sleutels van de gastheer blijven staan. */
export function wisAlles(opslag) {
  if (!opslag) return 0;
  const weg = [];
  const n = veilig(() => opslag.length, 0);
  for (let i = 0; i < n; i++) {
    const k = veilig(() => opslag.key(i));
    if (typeof k === 'string' && k.startsWith(SLEUTEL_PREFIX)) weg.push(k);
  }
  for (const k of weg) veilig(() => opslag.removeItem(k));
  return weg.length;
}
