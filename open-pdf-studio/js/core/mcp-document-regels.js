// Gedeelde argumentregels voor de MCP-opdrachten die het actieve document
// bewerken (paginabewerkingen, bladwijzers, watermerken). Puur: geen
// app-imports, zodat de tests ze los draaien.
//
// Elke opdracht antwoordt zoals de rest van js/mcp-bridge.js:
// { ok: true, ... } of { ok: false, error }.

export const fout = (error, extra = {}) => ({ ok: false, error, ...extra });

/** Een argument dat de opdracht niet kent: een tikfout van de client, nooit stil negeren. */
export function onbekendArgument(params, toegestaan) {
  for (const sleutel of Object.keys(params || {})) {
    if (!toegestaan.includes(sleutel)) return `unknown argument: ${sleutel}`;
  }
  return '';
}

/**
 * Het actieve document, als het te bewerken is. Alleen-lezen (PDF/A zolang
 * bewerken niet is ingeschakeld, met een wachtwoord geopend, of door de
 * gastsite alleen-lezen geopend): geweigerd, zoals de lintknoppen dan
 * uitgeschakeld zijn.
 * @returns {{doc: object} | {fout: object}}
 */
export function bewerkbaarDocument(o, { lezen = false } = {}) {
  const doc = o.document();
  if (!doc?.pdfDoc) return { fout: fout('no active document') };
  if (!lezen && o.alleenLezen(doc)) {
    return { fout: fout('document is read-only (PDF/A, password-protected or opened read-only); enable editing in the app first', { readOnly: true }) };
  }
  return { doc };
}

/**
 * Een lijst paginanummers (vanaf 1) binnen `totaal`, elk hooguit één keer.
 * @returns {{pages: number[]} | {error: string}}  in de gegeven volgorde
 */
export function paginaLijst(waarde, totaal, naam = 'pages') {
  if (!Array.isArray(waarde) || waarde.length === 0) return { error: `${naam} must be a non-empty array of page numbers (1-based)` };
  const gezien = new Set();
  for (const p of waarde) {
    if (!Number.isInteger(p)) return { error: `${naam} must contain whole page numbers, got ${JSON.stringify(p)}` };
    if (p < 1 || p > totaal) return { error: `page ${p} is out of range: the document has ${totaal} page${totaal === 1 ? '' : 's'}` };
    if (gezien.has(p)) return { error: `page ${p} is listed twice in ${naam}` };
    gezien.add(p);
  }
  return { pages: [...waarde] };
}

/** Een geheel getal tussen `min` en `max`, of de standaardwaarde als het ontbreekt. */
export function geheelGetal(waarde, naam, min, max, standaard) {
  if (waarde === undefined || waarde === null) {
    if (standaard === undefined) return { error: `missing ${naam}` };
    return { waarde: standaard };
  }
  if (!Number.isInteger(waarde) || waarde < min || waarde > max) return { error: `${naam} must be a whole number from ${min} to ${max}` };
  return { waarde };
}

/** Een eindig getal tussen `min` en `max`, of de standaardwaarde als het ontbreekt. */
export function getal(waarde, naam, min, max, standaard) {
  if (waarde === undefined || waarde === null) {
    if (standaard === undefined) return { error: `missing ${naam}` };
    return { waarde: standaard };
  }
  if (typeof waarde !== 'number' || !Number.isFinite(waarde) || waarde < min || waarde > max) {
    return { error: `${naam} must be a number from ${min} to ${max}` };
  }
  return { waarde };
}

export const MAX_PADLENGTE = 4096;

/**
 * Waarom dit pad niet gebruikt wordt, of `''`. Een absoluut pad zonder
 * `..`-delen, geen URL of apparaatpad, met een van de `extensies`.
 */
export function padFout(pad, naam, extensies) {
  if (typeof pad !== 'string' || !pad.trim()) return `missing or invalid ${naam}`;
  if (pad.length > MAX_PADLENGTE) return `${naam} is longer than ${MAX_PADLENGTE} characters`;
  if ([...pad].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return `${naam} contains control characters`;
  if (/^[\\/]{2}[?.][\\/]/.test(pad)) return `${naam} is a device path`;
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(pad)) return `${naam} is a URL, not a file path`;
  if (!/^([a-z]:[\\/]|[\\/])/i.test(pad)) return `${naam} must be an absolute path`;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(pad)) return `${naam} must not contain ".." parts`;
  const ext = (pad.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (!extensies.includes(ext)) return `${naam} must end in ${extensies.map((e) => `.${e}`).join(' or ')}`;
  return '';
}

/** Zelfde bestand? Paden uit Windows en elders: scheidingstekens en hoofdletters gelijk. */
export function zelfdePad(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/');
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  // Een stationsletter: Windows, niet hoofdlettergevoelig.
  return /^[a-z]:\//i.test(x) && x.toLowerCase() === y.toLowerCase();
}

/** Een kleur als #rrggbb (kleine letters), of null bij iets anders. */
export function hexKleur(waarde) {
  if (typeof waarde !== 'string' || !/^#[0-9a-f]{6}$/i.test(waarde)) return null;
  return waarde.toLowerCase();
}
