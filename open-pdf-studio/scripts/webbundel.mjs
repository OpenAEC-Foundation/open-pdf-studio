// De gehoste webbundel als release-bestand (#692).
//
// Een platform dat de webversie draait (#691) haalt per versie één archief
// van de release, controleert de hash en serveert de bestanden zoals ze zijn.
// Deze module bevat de pure delen: het manifest, de derdenvermeldingen,
// bron.json en een eigen tar-schrijver en -lezer. Eigen code, geen pakket:
// het archief moet op elke runner hetzelfde worden (vaste volgorde, vaste
// tijd, eigenaar 0) en zonder systeem-tar ook uit te pakken zijn.
//
// Vrij van vite en DOM, zodat alles onder `node --test` te controleren is.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP_KENMERKEN } from './web-bouw.mjs';

export const LICENTIE = 'LGPL-3.0-or-later';
export const BRONCODE_REPO = 'https://github.com/OpenAEC-Foundation/open-pdf-studio';
export const MANIFEST = 'MANIFEST.sha256';
export const NOTICES = 'THIRD-PARTY-NOTICES.txt';
export const BRON = 'bron.json';

/** Naam van het archief, zonder extensie. */
export function bundelNaam(versie) {
  return `open-pdf-studio-web-${versie}`;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Alle bestanden onder `map`, als POSIX-paden relatief aan `map`, gesorteerd. */
export function bestandenIn(map) {
  const uit = [];
  const loop = (sub) => {
    for (const item of fs.readdirSync(path.join(map, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${item.name}` : item.name;
      if (item.isDirectory()) loop(rel);
      else if (item.isFile()) uit.push(rel);
    }
  };
  loop('');
  return uit.sort(vergelijk);
}

// Bytevolgorde, niet de taal van de runner: elke machine sorteert hetzelfde.
function vergelijk(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * MANIFEST.sha256 in het formaat van `sha256sum`: `<hash>  <pad>` per regel,
 * zodat `sha256sum -c MANIFEST.sha256` in de uitgepakte map werkt.
 * @param {{ pad: string, hash: string }[]} items
 */
export function manifestTekst(items) {
  return [...items]
    .sort((a, b) => vergelijk(a.pad, b.pad))
    .map(({ pad, hash }) => `${hash}  ${pad}\n`)
    .join('');
}

/** Lees een manifest terug: Map pad → hash. Gooit bij een kapotte regel. */
export function leesManifest(tekst) {
  const kaart = new Map();
  for (const regel of tekst.split('\n')) {
    if (!regel) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(regel);
    if (!m) throw new Error(`Invalid manifest line: ${regel}`);
    kaart.set(m[2], m[1]);
  }
  return kaart;
}

/**
 * Controleer een uitgepakte map tegen zijn manifest: elk genoemd bestand
 * bestaat en klopt, en er staat niets in de map dat het manifest niet noemt.
 * @returns {string[]} de gevonden fouten (leeg = goed)
 */
export function controleerManifest(map) {
  const fouten = [];
  const kaart = leesManifest(fs.readFileSync(path.join(map, MANIFEST), 'utf8'));
  for (const [pad, hash] of kaart) {
    const vol = path.join(map, ...pad.split('/'));
    if (!fs.existsSync(vol)) { fouten.push(`missing: ${pad}`); continue; }
    if (sha256(fs.readFileSync(vol)) !== hash) fouten.push(`hash differs: ${pad}`);
  }
  for (const pad of bestandenIn(map)) {
    if (pad !== MANIFEST && !kaart.has(pad)) fouten.push(`not in manifest: ${pad}`);
  }
  return fouten;
}

/** Inhoud van het `.sha256`-bestand naast het archief (`sha256sum -c`). */
export function archiefHashTekst(hash, bestandsnaam) {
  return `${hash}  ${bestandsnaam}\n`;
}

// ── bron.json ───────────────────────────────────────────────────────────────

export function bronJson({ versie, tag, commit, repo = BRONCODE_REPO }) {
  if (!/^[0-9a-f]{40}$/.test(String(commit || ''))) throw new Error(`Not a full commit hash: ${commit}`);
  return {
    versie,
    tag,
    commit,
    licentie: LICENTIE,
    broncode: `${repo}/tree/${commit}`,
  };
}

// ── Pakketten in de bundel en hun licenties ─────────────────────────────────

// Vite zet een paar eigen hulpstukjes in de bundel (modulepreload, de
// preload-helper, de CommonJS-hulp, de lege vervanger van node-modules). Die
// komen uit het vite-pakket, waarvan LICENSE.md ook de meegebundelde
// pakketten noemt.
const VITE_HULP = /^\0?(vite\/|commonjsHelpers\.js$|__vite-browser-external)/;

/**
 * Pakketmap bij een module-id of bronpad uit de bundel, of null.
 * `.../node_modules/@scope/naam/sub/x.js?query` → `.../node_modules/@scope/naam`.
 */
export function pakketMap(id) {
  const schoon = String(id || '').replace(/^\0+/, '').split('?')[0].replace(/\\/g, '/');
  const i = schoon.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = schoon.slice(i + '/node_modules/'.length).split('/');
  const delen = rest[0]?.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
  if (delen.length !== (rest[0]?.startsWith('@') ? 2 : 1) || delen.some((d) => !d)) return null;
  return `${schoon.slice(0, i)}/node_modules/${delen.join('/')}`;
}

/** Hoort deze id bij een hulpstukje van vite zelf? */
export function isViteHulp(id) {
  return VITE_HULP.test(String(id || ''));
}

const LICENTIEBESTAND = /^(licen[cs]e|copying|notice)([-._]|$)/i;
const CODE = /\.(m?js|cjs|ts|css|json|html?|map)$/i;
const isLicentieNaam = (naam) => LICENTIEBESTAND.test(naam) && !CODE.test(naam);

/** Licentie- en vermeldingsbestanden in de wortel van een pakket, gesorteerd. */
export function licentieBestanden(map) {
  try {
    return fs.readdirSync(map, { withFileTypes: true })
      .filter((d) => d.isFile() && isLicentieNaam(d.name))
      .map((d) => d.name)
      .sort(vergelijk);
  } catch {
    return [];
  }
}

function persoon(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return [p.name, p.email && `<${p.email}>`, p.url && `(${p.url})`].filter(Boolean).join(' ');
}

/**
 * Gegevens van één pakket uit zijn map.
 * @returns {{ naam, versie, licentie, auteur, homepage, teksten: { bestand, tekst }[] }}
 */
export function pakketGegevens(map) {
  const pkg = JSON.parse(fs.readFileSync(path.join(map, 'package.json'), 'utf8'));
  const licentie = typeof pkg.license === 'string'
    ? pkg.license
    : pkg.license?.type || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type || l).join(' OR ') : '');
  return {
    naam: pkg.name || path.basename(map),
    versie: pkg.version || '',
    licentie: licentie || 'UNKNOWN',
    auteur: persoon(pkg.author),
    homepage: pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '',
    teksten: licentieBestanden(map).map((bestand) => ({
      bestand,
      tekst: fs.readFileSync(path.join(map, bestand), 'utf8').replace(/\r\n?/g, '\n').trimEnd(),
    })),
  };
}

/**
 * Van alle module-id's en bronpaden van een build naar de unieke pakketmappen.
 * @param {Iterable<string>} ids
 * @param {string} appMap  map van de app (voor vite zelf)
 */
export function pakketMappen(ids, appMap) {
  const mappen = new Set();
  for (const id of ids) {
    const map = pakketMap(id);
    if (map) mappen.add(map);
    else if (isViteHulp(id)) mappen.add(path.join(appMap, 'node_modules', 'vite').replace(/\\/g, '/'));
  }
  return [...mappen].sort(vergelijk);
}

/**
 * THIRD-PARTY-NOTICES.txt: per pakket naam, versie, licentie, auteur en de
 * volledige licentie- en vermeldingsbestanden (MIT en BSD eisen de
 * copyrightregels in elke kopie). Daarna de licentiebestanden die al als los
 * bestand in de bundel staan.
 * @param {ReturnType<typeof pakketGegevens>[]} pakketten
 * @param {string[]} bundelLicenties  paden in de bundel
 */
export function noticesTekst(pakketten, bundelLicenties = []) {
  const streep = '-'.repeat(79);
  const delen = [
    'Open PDF Studio - third-party notices',
    '',
    `Open PDF Studio itself is licensed under ${LICENTIE}; see bron.json for the`,
    'exact source code of this bundle.',
    '',
    'This web bundle contains code from the npm packages listed below. Each entry',
    'gives the package licence and the full text of the licence and notice files',
    'that the package ships.',
  ];
  const gesorteerd = [...pakketten].sort((a, b) => vergelijk(a.naam, b.naam) || vergelijk(a.versie, b.versie));
  for (const p of gesorteerd) {
    delen.push('', streep, `${p.naam} ${p.versie}`.trim(), `License: ${p.licentie}`);
    if (p.auteur) delen.push(`Author: ${p.auteur}`);
    if (p.homepage) delen.push(`Source: ${p.homepage}`);
    if (!p.teksten.length) delen.push('', '(The package ships no licence file.)');
    for (const { bestand, tekst } of p.teksten) delen.push('', `--- ${bestand} ---`, '', tekst);
  }
  if (bundelLicenties.length) {
    delen.push('', streep, 'Licence files included as separate files in this bundle:', '');
    for (const pad of [...bundelLicenties].sort(vergelijk)) delen.push(`  ${pad}`);
  }
  return `${delen.join('\n')}\n`;
}

/** Losse licentiebestanden die al in de bundel staan (bv. pdfjs/LICENSE). */
export function bundelLicenties(bestanden) {
  return bestanden.filter((pad) => isLicentieNaam(pad.split('/').pop()));
}

// ── Desktopcode ─────────────────────────────────────────────────────────────

/**
 * Bestanden van de bundel waarin code of de naam van een desktop-pakket
 * staat (#776); leeg = schoon.
 * @param {{ pad: string, data: Buffer|Uint8Array|string }[]} items
 * @returns {{ pad: string, kenmerk: string }[]}
 */
export function zoekDesktopCode(items) {
  const treffers = [];
  for (const { pad, data } of items) {
    const buf = Buffer.isBuffer(data) || typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    for (const kenmerk of DESKTOP_KENMERKEN) if (buf.includes(kenmerk)) treffers.push({ pad, kenmerk });
  }
  return treffers;
}

// ── tar (ustar) ─────────────────────────────────────────────────────────────

const BLOK = 512;

function schrijfTekst(kop, offset, lengte, tekst) {
  const bytes = Buffer.from(tekst, 'utf8');
  if (bytes.length > lengte) throw new Error(`tar field too long: ${tekst}`);
  bytes.copy(kop, offset);
}

function schrijfOctaal(kop, offset, lengte, waarde) {
  const tekst = Math.floor(waarde).toString(8).padStart(lengte - 1, '0');
  if (tekst.length > lengte - 1) throw new Error(`tar number too large: ${waarde}`);
  schrijfTekst(kop, offset, lengte, `${tekst}\0`);
}

/** Splits een pad over de velden prefix (155) en name (100) van ustar. */
export function splitsTarPad(pad) {
  if (Buffer.byteLength(pad) <= 100) return { prefix: '', naam: pad };
  const delen = pad.split('/');
  for (let i = delen.length - 1; i > 0; i--) {
    const prefix = delen.slice(0, i).join('/');
    const naam = delen.slice(i).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(naam) <= 100) return { prefix, naam };
  }
  throw new Error(`Path too long for ustar: ${pad}`);
}

function tarKop(pad, grootte, mtime) {
  const kop = Buffer.alloc(BLOK);
  const { prefix, naam } = splitsTarPad(pad);
  schrijfTekst(kop, 0, 100, naam);
  schrijfOctaal(kop, 100, 8, 0o644);
  schrijfOctaal(kop, 108, 8, 0);
  schrijfOctaal(kop, 116, 8, 0);
  schrijfOctaal(kop, 124, 12, grootte);
  schrijfOctaal(kop, 136, 12, mtime);
  kop.fill(0x20, 148, 156); // controlesom telt als spaties
  kop[156] = 0x30; // '0': gewoon bestand
  schrijfTekst(kop, 257, 6, 'ustar\0');
  schrijfTekst(kop, 263, 2, '00');
  schrijfTekst(kop, 265, 32, 'root');
  schrijfTekst(kop, 297, 32, 'root');
  schrijfTekst(kop, 345, 155, prefix);
  let som = 0;
  for (const b of kop) som += b;
  schrijfTekst(kop, 148, 8, `${som.toString(8).padStart(6, '0')}\0 `);
  return kop;
}

/**
 * Een ustar-archief van gewone bestanden, in de gegeven volgorde, met vaste
 * modus 0644, eigenaar 0 en één tijdstempel: dezelfde invoer geeft dezelfde
 * bytes.
 * @param {{ pad: string, data: Buffer|Uint8Array }[]} items
 * @param {number} mtime  seconden sinds 1970
 */
export function maakTar(items, mtime = 0) {
  const delen = [];
  for (const { pad, data } of items) {
    if (!isVeiligPad(pad)) throw new Error(`Unsafe path in archive: ${pad}`);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    delen.push(tarKop(pad, buf.length, mtime), buf);
    const rest = buf.length % BLOK;
    if (rest) delen.push(Buffer.alloc(BLOK - rest));
  }
  delen.push(Buffer.alloc(BLOK * 2));
  return Buffer.concat(delen);
}

function leesVeld(buf, offset, lengte) {
  const stuk = buf.subarray(offset, offset + lengte);
  const nul = stuk.indexOf(0);
  return stuk.subarray(0, nul < 0 ? lengte : nul).toString('utf8');
}

/** Een relatief pad zonder `..`, zonder stuurtekens en niet absoluut. */
export function isVeiligPad(pad) {
  if (typeof pad !== 'string' || !pad || pad.startsWith('/') || /^[a-z]:/i.test(pad)) return false;
  if (/[\0-\x1f\\]/.test(pad)) return false;
  return pad.split('/').every((d) => d && d !== '.' && d !== '..');
}

/**
 * Lees een ustar-archief: alleen gewone bestanden, onveilige paden en andere
 * soorten (koppelingen, apparaten) zijn een fout.
 * @returns {{ pad: string, data: Buffer }[]}
 */
export function leesTar(buf) {
  const uit = [];
  let pos = 0;
  while (pos + BLOK <= buf.length) {
    const kop = buf.subarray(pos, pos + BLOK);
    if (kop.every((b) => b === 0)) break;
    const naam = leesVeld(kop, 0, 100);
    const prefix = leesVeld(kop, 345, 155);
    const grootte = parseInt(leesVeld(kop, 124, 12).trim() || '0', 8);
    const soort = String.fromCharCode(kop[156] || 0x30);
    const pad = prefix ? `${prefix}/${naam}` : naam;
    pos += BLOK;
    if (soort === '0') {
      if (!isVeiligPad(pad)) throw new Error(`Unsafe path in archive: ${pad}`);
      uit.push({ pad, data: Buffer.from(buf.subarray(pos, pos + grootte)) });
    } else if (soort !== '5') {
      throw new Error(`Unsupported tar entry type '${soort}' for ${pad}`);
    }
    pos += Math.ceil(grootte / BLOK) * BLOK;
  }
  return uit;
}

/** Pak tar-items uit onder `doel`. */
export function pakUit(items, doel) {
  for (const { pad, data } of items) {
    const vol = path.join(doel, ...pad.split('/'));
    fs.mkdirSync(path.dirname(vol), { recursive: true });
    fs.writeFileSync(vol, data);
  }
}
