// Pakt de draagbare Windows-versie in (#881): één zip die zonder installatie
// draait en zijn gegevens in `data\` naast het programma houdt.
//
//   node scripts/draagbare-zip.mjs --target <map> --version <vJJJJ.W.N> [--out <map>]
//
// --target  de cargo-uitvoermap van een Windows-releasebouw (in CI
//           <repo>/target/release): daar staan open-pdf-studio.exe en
//           pdfium-worker.exe.
// --out     waar de zip en de .sha256 komen (standaard dist-draagbaar/).
//
// Uitvoer:
//   Open.PDF.Studio_<versie>_x64_portable.zip          (zoals de installers,
//   Open.PDF.Studio_<versie>_x64_portable.zip.sha256    met punten: GitHub-stijl)
//
// Indeling in de zip, onder één map "Open PDF Studio" (uitpakken over een
// oudere kopie werkt de programmabestanden bij en laat `data\` staan):
//   open-pdf-studio.exe        het programma
//   pdfium-worker.exe          sidecar (bundle.externalBin, zonder doeltriple)
//   <bundle.resources>         precies zoals de installer ze neerzet: op
//                              Windows is resource_dir() de map van de exe,
//                              dus pdfium.dll, WebView2Loader.dll,
//                              open-pdf-thumbnails.dll, file-icon.ico,
//                              tessdata\, fonts\, kaders\, onderhoeken\
//   portable.ini               de markering die de draagbare modus aanzet
//   README.txt                 uitleg
//
// De lijst resources komt uit tauri.conf.json samengevoegd met
// tauri.windows.conf.json, dezelfde bron als de NSIS-installer; een nieuwe
// resource komt dus vanzelf mee. Ontbreekt er een bronbestand, dan stopt het
// script: een halve zip start niet of rendert niets.
//
// Releaseworkflow: .github/workflows/release.yml, matrixdoel windows-system,
// stap "Build portable zip". Tests: scripts/draagbare-zip.test.mjs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC_TAURI = path.join(APP, 'src-tauri');

/** De map in de zip. Zonder versie: een nieuwe zip pakt uit over de oude. */
export const TOPMAP = 'Open PDF Studio';
export const PROGRAMMA = 'open-pdf-studio.exe';
export const MARKERING = 'portable.ini';
export const LEESMIJ = 'README.txt';
/** De gegevensmap die de app maakt; komt nooit in de zip. */
export const DATAMAP = 'data';

/** Bestandsnaam van de zip (zie ook js/core/draagbaar.js, zipNaam). */
export function zipNaam(versie) {
  const v = String(versie || '').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Invalid version: ${versie}`);
  return `Open.PDF.Studio_${v}_x64_portable.zip`;
}

function leesJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * De bundelinstellingen voor Windows: tauri.conf.json met
 * tauri.windows.conf.json erover (JSON merge patch: objecten samengevoegd).
 */
export function leesBundelConfig(srcTauri = SRC_TAURI) {
  const basis = leesJson(path.join(srcTauri, 'tauri.conf.json'));
  const winPad = path.join(srcTauri, 'tauri.windows.conf.json');
  const win = fs.existsSync(winPad) ? leesJson(winPad) : {};
  const resources = { ...(basis.bundle?.resources || {}), ...(win.bundle?.resources || {}) };
  for (const [bron, doel] of Object.entries(resources)) {
    if (doel === null) delete resources[bron];
  }
  return {
    resources,
    externalBin: win.bundle?.externalBin || basis.bundle?.externalBin || [],
    mainBinaryName: win.mainBinaryName || basis.mainBinaryName || null,
  };
}

/** Alle bestanden onder een map, als relatieve paden met '/', gesorteerd. */
function bestandenOnder(map, rel = '') {
  const uit = [];
  for (const e of fs.readdirSync(path.join(map, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) uit.push(...bestandenOnder(map, r));
    else if (e.isFile()) uit.push(r);
  }
  return uit.sort();
}

const naarZipPad = (p) => p.split(/[\\/]+/).filter(Boolean).join('/');

/**
 * De inhoud van de zip: [{ doel, bron } | { doel, tekst }], doel relatief
 * aan TOPMAP met '/'. Werpt als een bron ontbreekt.
 */
export function draagbareIndeling({ targetDir, versie, srcTauri = SRC_TAURI, config = leesBundelConfig(srcTauri) }) {
  const items = [];
  const ontbreekt = [];
  const voegToe = (doel, bron) => {
    if (!fs.existsSync(bron)) ontbreekt.push(bron);
    items.push({ doel: naarZipPad(doel), bron });
  };

  const exe = config.mainBinaryName ? `${config.mainBinaryName}.exe` : PROGRAMMA;
  voegToe(exe, path.join(targetDir, exe));

  // Sidecars: Tauri zet binaries/<naam>-<triple>.exe als <naam>.exe naast de
  // exe. In de doelmap staat hij al zo (cargo build -p pdfium-worker); anders
  // de bron met triple.
  for (const bin of config.externalBin) {
    const naam = path.basename(bin);
    const inDoel = path.join(targetDir, `${naam}.exe`);
    const metTriple = path.join(srcTauri, `${bin}-x86_64-pc-windows-msvc.exe`);
    voegToe(`${naam}.exe`, fs.existsSync(inDoel) || !fs.existsSync(metTriple) ? inDoel : metTriple);
  }

  for (const [bron, doel] of Object.entries(config.resources)) {
    const pad = path.join(srcTauri, bron);
    if (fs.existsSync(pad) && fs.statSync(pad).isDirectory()) {
      const bestanden = bestandenOnder(pad);
      if (!bestanden.length) ontbreekt.push(`${pad} (empty)`);
      for (const rel of bestanden) voegToe(`${doel}/${rel}`, path.join(pad, rel));
    } else {
      voegToe(doel, pad);
    }
  }

  items.push({ doel: MARKERING, tekst: markeringTekst() });
  items.push({ doel: LEESMIJ, tekst: leesmijTekst(versie) });

  if (ontbreekt.length) {
    throw new Error(`Portable zip: missing files:\n  ${ontbreekt.join('\n  ')}`);
  }
  const dubbel = items.map((i) => i.doel.toLowerCase()).filter((d, i, a) => a.indexOf(d) !== i);
  if (dubbel.length) throw new Error(`Portable zip: duplicate paths: ${[...new Set(dubbel)].join(', ')}`);
  if (items.some((i) => i.doel === DATAMAP || i.doel.startsWith(`${DATAMAP}/`))) {
    throw new Error('Portable zip: the data folder must not be shipped');
  }
  return items.sort((a, b) => (a.doel < b.doel ? -1 : a.doel > b.doel ? 1 : 0));
}

/** Inhoud van portable.ini. CRLF: het bestand is voor Windows-gebruikers. */
export function markeringTekst() {
  return [
    '; Open PDF Studio - portable mode',
    ';',
    '; While this file is next to open-pdf-studio.exe, the app stores all its',
    '; settings and data in the "data" folder next to it, not in your user',
    '; profile. Delete this file to use the normal per-user folders instead.',
    '',
  ].join('\r\n');
}

/** Inhoud van README.txt. */
export function leesmijTekst(versie) {
  const v = String(versie || '').replace(/^v/, '');
  return [
    `Open PDF Studio ${v} - portable version for Windows (x64)`,
    '',
    'Run open-pdf-studio.exe. Nothing is installed.',
    '',
    'WHERE YOUR DATA GOES',
    'Because portable.ini is present, settings, the session, symbol catalogs,',
    'extensions, recovery snapshots, logs, caches and the browser profile of the',
    'app are stored in the "data" folder next to open-pdf-studio.exe. Keep the',
    'whole folder together. The folder must be writable (for example a USB drive',
    'or your Documents folder, not C:\\Program Files); if it is not, the app tells',
    'you and uses your user profile instead.',
    '',
    'REQUIREMENTS',
    'Windows 10 or 11 (64-bit) with the Microsoft Edge WebView2 Runtime. Windows',
    '10 and 11 normally include it. If it is missing, the app says so on start;',
    'install the Evergreen Runtime from',
    'https://developer.microsoft.com/microsoft-edge/webview2/',
    'or extract a Fixed Version runtime into a folder named "WebView2Runtime"',
    'next to open-pdf-studio.exe (msedgewebview2.exe must be directly inside it).',
    '',
    'UPDATING',
    'The portable version does not update itself. Help > Check for updates tells',
    'you when a new version is out. Download the new',
    'Open.PDF.Studio_<version>_x64_portable.zip and extract it over this folder;',
    'the data folder is kept.',
    '',
    'ONLY IN THE INSTALLED VERSION',
    '- Registration as a PDF app with Windows. To open PDF files with the portable',
    '  version, right-click a PDF, choose Open with > Choose another app and',
    '  select open-pdf-studio.exe in this folder.',
    '- PDF thumbnails in File Explorer.',
    '- The virtual printer "Open PDF Printer".',
    '- Start menu and desktop shortcuts.',
    '',
    'REMOVING',
    'Delete this folder. The app itself writes nothing to the registry. Windows',
    'may keep an empty folder named after the app under %LOCALAPPDATA%; it can be',
    'deleted.',
    '',
    'To use your own settings folder, set OPDS_DATA_DIR. To run this copy like an',
    'installed one (per-user folders), delete portable.ini or set OPDS_PORTABLE=0.',
    '',
    'License: MIT. Source: https://github.com/OpenAEC-Foundation/open-pdf-studio',
    '',
  ].join('\r\n');
}

// ── Zip (deflate, zonder afhankelijkheden) ───────────────────────────────

const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Vaste tijd (2000-01-01 00:00) zodat dezelfde invoer dezelfde zip geeft.
const DOS_TIJD = 0;
const DOS_DATUM = ((2000 - 1980) << 9) | (1 << 5) | 1;
const MAX32 = 0xffffffff;

/**
 * Schrijft de zip naar `uitPad`. `items`: [{ doel, bron } | { doel, tekst }].
 * Elk pad komt onder `topmap/`. Geeft de lijst namen in de zip.
 */
export function schrijfZip(uitPad, items, topmap = TOPMAP) {
  const fd = fs.openSync(uitPad, 'w');
  const centraal = [];
  let offset = 0;
  const schrijf = (buf) => {
    fs.writeSync(fd, buf);
    offset += buf.length;
  };
  try {
    for (const item of items) {
      const naam = topmap ? `${topmap}/${item.doel}` : item.doel;
      const naamBuf = Buffer.from(naam, 'utf8');
      const data = item.bron ? fs.readFileSync(item.bron) : Buffer.from(item.tekst, 'utf8');
      const ingepakt = zlib.deflateRawSync(data, { level: 9 });
      const opgeslagen = ingepakt.length < data.length;
      const inhoud = opgeslagen ? ingepakt : data;
      const crc = crc32(data);
      if (data.length >= MAX32 || offset >= MAX32) throw new Error(`Zip too large (no ZIP64): ${naam}`);

      const lokaal = Buffer.alloc(30);
      lokaal.writeUInt32LE(0x04034b50, 0);
      lokaal.writeUInt16LE(20, 4); // versie nodig
      lokaal.writeUInt16LE(0x0800, 6); // UTF-8-namen
      lokaal.writeUInt16LE(opgeslagen ? 8 : 0, 8);
      lokaal.writeUInt16LE(DOS_TIJD, 10);
      lokaal.writeUInt16LE(DOS_DATUM, 12);
      lokaal.writeUInt32LE(crc, 14);
      lokaal.writeUInt32LE(inhoud.length, 18);
      lokaal.writeUInt32LE(data.length, 22);
      lokaal.writeUInt16LE(naamBuf.length, 26);
      lokaal.writeUInt16LE(0, 28);
      const kopOffset = offset;
      schrijf(lokaal);
      schrijf(naamBuf);
      schrijf(inhoud);

      const kop = Buffer.alloc(46);
      kop.writeUInt32LE(0x02014b50, 0);
      kop.writeUInt16LE(20, 4); // gemaakt door: MS-DOS/FAT, 2.0
      kop.writeUInt16LE(20, 6);
      kop.writeUInt16LE(0x0800, 8);
      kop.writeUInt16LE(opgeslagen ? 8 : 0, 10);
      kop.writeUInt16LE(DOS_TIJD, 12);
      kop.writeUInt16LE(DOS_DATUM, 14);
      kop.writeUInt32LE(crc, 16);
      kop.writeUInt32LE(inhoud.length, 20);
      kop.writeUInt32LE(data.length, 24);
      kop.writeUInt16LE(naamBuf.length, 28);
      kop.writeUInt32LE(0x20, 38); // archiefbit
      kop.writeUInt32LE(kopOffset, 42);
      centraal.push(Buffer.concat([kop, naamBuf]));
    }
    if (centraal.length >= 0xffff) throw new Error('Zip has too many entries (no ZIP64)');
    const cdStart = offset;
    for (const c of centraal) schrijf(c);
    const eind = Buffer.alloc(22);
    eind.writeUInt32LE(0x06054b50, 0);
    eind.writeUInt16LE(centraal.length, 8);
    eind.writeUInt16LE(centraal.length, 10);
    eind.writeUInt32LE(offset - cdStart, 12);
    eind.writeUInt32LE(cdStart, 16);
    schrijf(eind);
  } finally {
    fs.closeSync(fd);
  }
  return items.map((i) => (topmap ? `${topmap}/${i.doel}` : i.doel));
}

/** `<sha256>  <naam>` zoals `sha256sum -c` het leest. */
export function hashRegel(pad) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(pad)).digest('hex');
  return `${hash}  ${path.basename(pad)}\n`;
}

/** Bouw zip en .sha256; geeft { zip, sha256, items }. */
export function maakDraagbareZip({ targetDir, versie, uitMap, srcTauri = SRC_TAURI }) {
  const items = draagbareIndeling({ targetDir, versie, srcTauri });
  fs.mkdirSync(uitMap, { recursive: true });
  const zip = path.join(uitMap, zipNaam(versie));
  schrijfZip(zip, items);
  const sha256 = `${zip}.sha256`;
  fs.writeFileSync(sha256, hashRegel(zip));
  return { zip, sha256, items };
}

function leesArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unknown argument: ${argv[i]}`);
    args[m[1]] = m[2] ?? argv[++i];
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = leesArgs(process.argv.slice(2));
    if (!args.target || !args.version) {
      throw new Error('Usage: node scripts/draagbare-zip.mjs --target <cargo release dir> --version <vYYYY.W.N> [--out <dir>]');
    }
    const { zip, sha256, items } = maakDraagbareZip({
      targetDir: path.resolve(args.target),
      versie: args.version,
      uitMap: path.resolve(args.out || path.join(APP, 'dist-draagbaar')),
    });
    console.log(`${items.length} files -> ${zip}`);
    console.log(fs.readFileSync(sha256, 'utf8').trim());
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
