import { isObservedRenderCommand, observeNativeRender } from '../pdf/render-diagnostics.js';
import { leesOpslag, verwijderOpslag } from './opslag.js';
import { bestandsnaamUitPad } from './bestandsnaam.js';
import { gastObject } from './gehost.js';
import { versieVoorOpen } from './host-brug.js';
import { rustRenderPadBeschikbaar } from '../pdf/render-route.js';
import { slaOverInHeadless } from './headless.js';

/**
 * Tauri API wrapper module
 * Provides a unified interface for Tauri 2.x APIs
 * Uses the global __TAURI__ object instead of ES module imports
 * Falls back to Web APIs when running in a browser (non-Tauri)
 */

// ── Web file cache ──────────────────────────────────────────────────────────
// When running in a browser, files opened via <input type="file"> are stored
// here so that readBinaryFile() can retrieve them by name.
const _webFileCache = new Map(); // filename -> Uint8Array

/**
 * Leg bytes onder een bestandsnaam klaar voor readBinaryFile(). Dit is de
 * in-geheugenroute van de webversie: de bestandskiezer gebruikt hem, en sinds
 * #456 ook slepen en neerzetten, zodat er één route te onderhouden is.
 * @returns {string} de naam waaronder de bytes klaarstaan
 */
export function cacheWebFile(name, data) {
  _webFileCache.set(name, data instanceof Uint8Array ? data : new Uint8Array(data));
  return name;
}

// ── Opslag van de gastsite (#546) ───────────────────────────────────────────
// Als gast in de OpenAEC-site (#544) openen en bewaren documenten via een
// klein contract dat de site levert. De gastpagina zet het vóór het laden neer:
//
//   window.__OPDS_HOST__ = {
//     storage: {
//       open(id, versie?)         -> Promise<{ name, data }>  data: Uint8Array |
//                                    ArrayBuffer | Blob
//       save(id, bytes, { name }) -> Promise<unknown>  schrijft over het
//                                    geopende document heen (nieuwe versie)
//       list()      (optioneel)   -> Promise<[{ id, name, modified? }]>
//       versions(id) (optioneel)  -> Promise<[{ version, modified?, author? }]>
//     },
//     document: '<id>',  // optioneel: dit document gaat bij de start open
//     // optioneel, van de brug naar de werkplek (core/host-brug.js, #704):
//     ai: { vraag(vraag) -> Promise<{ bericht, stop, vraag_id }> },
//     geopend(id)          -> Promise<true>  dit document staat open
//     melding(tekst, toon) -> Promise<true>  melding in de statusbalk van de site
//   };
//
// open() mag ook `alleenLezen: true` (of `readOnly: true`) meegeven: dan
// opent het document alleen-lezen (pdf/host-document.js). Met een tweede
// argument `versie` (#712) geeft de site een oudere versie, altijd
// alleen-lezen. Die heeft als pad `opds-host://<id>;versie=<n>/<naam>` (een
// ';' komt in een gecodeerd id niet voor): een eigen tabblad naast het
// huidige document, dat nooit terugschrijft naar de site.
//
// Een document van de site heeft als pad `opds-host://<id>/<naam>`: de naam
// achteraan houdt alles wat een bestandsnaam uit het pad haalt (tabbladen,
// titel, recente bestanden) gewoon werkend. Alleen een pad dat echt als
// document van de site geopend is, schrijft terug; een afgeleid pad (een
// export naast het document) wordt een download, net als in de webversie.
// Uploaden en downloaden van en naar de pc blijven bestaan.

const HOST_SCHEMA = 'opds-host://';
const _hostPaden = new Map(); // pad -> id, voor elk als document geopend pad

/** Het opslagcontract van de gastsite, of null. */
export function hostOpslag() {
  const opslag = gastObject()?.storage;
  return opslag && typeof opslag.open === 'function' && typeof opslag.save === 'function'
    ? opslag
    : null;
}

/** Pad van een document van de site; met `versie` dat van een oudere versie. */
export function hostPad(id, naam, versie = null) {
  const veilig = String(naam || 'document.pdf').replace(/[\\/]/g, '_').trim() || 'document.pdf';
  const deel = versie === null || versie === undefined ? '' : `;versie=${encodeURIComponent(String(versie))}`;
  return `${HOST_SCHEMA}${encodeURIComponent(String(id))}${deel}/${veilig}`;
}

/** `{ id, naam, versie }` uit een pad van de site (versie null: de huidige), of null. */
export function leesHostPad(pad) {
  if (typeof pad !== 'string' || !pad.startsWith(HOST_SCHEMA)) return null;
  const rest = pad.slice(HOST_SCHEMA.length);
  const schuin = rest.indexOf('/');
  if (schuin <= 0) return null;
  const [idDeel, ...extra] = rest.slice(0, schuin).split(';');
  if (!idDeel) return null;
  const versieDeel = extra.find((e) => e.startsWith('versie='));
  try {
    return {
      id: decodeURIComponent(idDeel),
      naam: rest.slice(schuin + 1),
      versie: versieDeel === undefined ? null : decodeURIComponent(versieDeel.slice('versie='.length)),
    };
  } catch {
    return null;
  }
}

async function naarBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  throw new Error('The site returned no document data');
}

/**
 * Haal een document van de site op; met `versie` een oudere versie (#712),
 * altijd alleen-lezen, met een eigen pad dat nooit terugschrijft.
 * @returns {Promise<{ pad: string, naam: string, data: Uint8Array, alleenLezen: boolean, versie: unknown }>}
 */
export async function openHostBestand(id, versie = null) {
  const opslag = hostOpslag();
  if (!opslag) throw new Error('This page has no site storage');
  const metVersie = versie !== null && versie !== undefined;
  // Als getal: zo vraagt het protocol het (een pad of de lijst geeft tekst).
  const antwoord = metVersie
    ? await opslag.open(String(id), versieVoorOpen(versie))
    : await opslag.open(String(id));
  const data = await naarBytes(antwoord?.data ?? antwoord?.bytes ?? antwoord);
  const naam = String(antwoord?.name || 'document.pdf');
  // Het nummer zoals de site het teruggeeft (deze brug: `versie`, de brug van
  // de werkplek zelf: `version`), anders het gevraagde.
  const gekregen = antwoord?.versie ?? antwoord?.version ?? null;
  const pad = metVersie ? hostPad(id, naam, versie) : hostPad(id, naam);
  if (!metVersie) _hostPaden.set(pad, String(id));
  return {
    pad,
    naam,
    data,
    alleenLezen: metVersie || antwoord?.alleenLezen === true || antwoord?.readOnly === true,
    versie: metVersie ? (gekregen ?? versie) : gekregen,
  };
}

/** De assistent van de site (`ai.vraag`), of null als de site er geen heeft. */
export function hostAi() {
  const vraag = gastObject()?.ai?.vraag;
  return typeof vraag === 'function' ? vraag : null;
}

/**
 * Vertel de site dat document `id` open staat. Alleen ter informatie: een
 * weigering of een site zonder dit bericht verandert niets aan de app.
 */
export async function meldHostGeopend(id) {
  const geopend = gastObject()?.geopend;
  if (typeof geopend !== 'function') return false;
  try {
    await geopend(String(id));
    return true;
  } catch (e) {
    console.warn('[gast] geopend niet gemeld:', e?.message || e);
    return false;
  }
}

/** Een melding in de statusbalk van de site, als die dat kent. */
export async function meldBijHost(tekst, toon = 'fout') {
  const melding = gastObject()?.melding;
  if (typeof melding !== 'function') return false;
  try {
    return (await melding(String(tekst ?? ''), toon)) !== false;
  } catch (e) {
    console.warn('[gast] melding niet doorgegeven:', e?.message || e);
    return false;
  }
}

/** De documenten die de site aanbiedt (leeg als het contract geen lijst kent). */
export async function hostDocumenten() {
  const opslag = hostOpslag();
  if (!opslag || typeof opslag.list !== 'function') return [];
  const lijst = await opslag.list();
  return Array.isArray(lijst) ? lijst.filter((d) => d && d.id != null) : [];
}

/** De versies van een document op de site (leeg als het contract die niet kent). */
export async function hostVersies(id) {
  const opslag = hostOpslag();
  if (!opslag || typeof opslag.versions !== 'function') return [];
  const lijst = await opslag.versions(String(id));
  return Array.isArray(lijst) ? lijst : [];
}

// Extract a display-friendly file name from a path or content:// URI
export function extractFileName(pathOrUri) {
  if (!pathOrUri) return 'Document';
  // content:// URIs (Android): de weergavenaam van de ContentResolver, of
  // een leesbare naam uit de URI zelf (#596).
  if (pathOrUri.startsWith('content://')) return bestandsnaamUitPad(pathOrUri);
  // Regular filesystem path
  const parts = pathOrUri.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'Document';
}

// Check if running in Tauri
export const isTauri = () => {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};

// Detect mobile platform (Android/iOS) — cached at first call
// Add ?mobile to the URL to force mobile layout for testing in browser
let _isMobile = null;
export function isMobile() {
  if (_isMobile !== null) return _isMobile;
  // Allow forcing mobile mode via URL param for dev/testing
  if (new URLSearchParams(window.location.search).has('mobile')) {
    _isMobile = true;
    return _isMobile;
  }
  try {
    if (isTauri() && window.__TAURI__.os) {
      const osType = window.__TAURI__.os.type();
      _isMobile = (osType === 'android' || osType === 'ios');
    } else {
      _isMobile = false;
    }
  } catch {
    _isMobile = false;
  }
  return _isMobile;
}

// Kan het Rust-renderpad (PDFium) hier draaien? Niet in de browser en niet op
// Android/iOS: daar zit geen PDFium in de app (#593). Zie pdf/render-route.js.
export function heeftRustRenderer() {
  return rustRenderPadBeschikbaar({ inTauri: isTauri(), mobiel: isMobile() });
}

// Get Tauri APIs from global object
function getTauriWindow() {
  if (!isTauri()) return null;
  return window.__TAURI__.window;
}

function getTauriCore() {
  if (!isTauri()) return null;
  return window.__TAURI__.core;
}

// Window controls
export async function minimizeWindow() {
  if (!isTauri()) return;
  // Headless (testinstantie): een geminimaliseerd venster rendert niet meer.
  if (slaOverInHeadless('minimize')) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    await currentWindow.minimize();
  }
}

export async function maximizeWindow() {
  if (!isTauri()) return;
  // Headless: maximaliseren zet het venster op een monitor.
  if (slaOverInHeadless('maximize')) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    const isMaximized = await currentWindow.isMaximized();
    if (isMaximized) {
      await currentWindow.unmaximize();
    } else {
      await currentWindow.maximize();
    }
  }
}

export async function closeWindow() {
  if (!isTauri()) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    await currentWindow.destroy();
  }
}

// Fullscreen
export async function isWindowFullscreen() {
  if (!isTauri()) {
    return !!document.fullscreenElement;
  }
  const win = getTauriWindow();
  if (!win) return false;
  try {
    return await win.getCurrentWindow().isFullscreen();
  } catch { return false; }
}

export async function setWindowFullscreen(enabled) {
  if (!isTauri()) {
    if (enabled) {
      try { await document.documentElement.requestFullscreen?.(); } catch {}
    } else if (document.fullscreenElement) {
      try { await document.exitFullscreen?.(); } catch {}
    }
    return;
  }
  // Headless: volledig scherm zet het venster op een monitor.
  if (slaOverInHeadless('fullscreen')) return;
  const win = getTauriWindow();
  if (!win) return;
  try {
    await win.getCurrentWindow().setFullscreen(!!enabled);
  } catch (e) { console.error('setFullscreen failed', e); }
}

export async function toggleWindowFullscreen() {
  const cur = await isWindowFullscreen();
  await setWindowFullscreen(!cur);
  return !cur;
}

// File dialogs - using Tauri commands since plugin APIs may not be globally available
//
// Performance note (Windows): the first call to dialog.open() in a process is
// always slow (1–3 s) because IFileOpenDialog/CoCreateInstance has to load
// shell32.dll + comdlg32.dll + every shell extension DLL (OneDrive, AV hooks,
// cloud providers, etc.). Subsequent calls are much faster (~100–300 ms). We
// can't avoid the cold-start cost in the dialog plugin itself (rfd 0.16 calls
// CoInitializeEx + CoCreateInstance fresh every call), but we mitigate two
// things here:
//   1) Pass a `defaultPath` derived from the most-recently-opened file's
//      directory — saves Windows from enumerating Documents or the install
//      dir as the cold default.
//   2) Pre-warm shell32 at app idle (see `prewarmFileDialog()` below) so the
//      first user click pays only the enumeration cost, not the DLL load.
// Timings are logged when storage name `openPdfStudio.debugDialog` is '1'
// (key `opds:openPdfStudio.debugDialog`, see core/opslag.js).
export async function openFileDialog(extensions, options = {}) {
  if (isTauri()) {
    const filters = extensions
      ? [{ name: 'Files', extensions }]
      : [{ name: 'PDF Files', extensions: ['pdf'] }];

    const dbg = leesOpslag('openPdfStudio.debugDialog') === '1';
    const t0 = dbg ? performance.now() : 0;

    // Try using the dialog plugin via window.__TAURI__.dialog
    if (window.__TAURI__.dialog) {
      try {
        // With { multiple: true } the Tauri dialog resolves to an array of
        // paths (or null on cancel); callers that pass options.multiple must
        // handle both shapes.
        const args = { multiple: !!options.multiple, filters };
        if (options.defaultPath) args.defaultPath = options.defaultPath;
        const result = await window.__TAURI__.dialog.open(args);
        if (dbg) console.log(`[openFileDialog] dialog.open resolved in ${(performance.now() - t0).toFixed(0)}ms (result=${result ? 'picked' : 'cancelled'})`);
        return result;
      } catch (e) {
        console.error('Dialog plugin error:', e);
      }
    }

    // Fallback: use invoke to call a custom command
    return await invoke('open_file_dialog');
  }

  // Web fallback: use HTML <input type="file">
  const accept = extensions
    ? extensions.map(e => '.' + e).join(',')
    : '.pdf';
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (options.multiple) input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      document.body.removeChild(input);
      if (files.length === 0) { resolve(null); return; }
      const names = [];
      for (const file of files) {
        const data = new Uint8Array(await file.arrayBuffer());
        _webFileCache.set(file.name, data);
        names.push(file.name);
      }
      // Mirror the Tauri dialog contract: array when multiple was requested,
      // single name otherwise.
      resolve(options.multiple ? names : names[0]);
    });
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function saveFileDialog(defaultPath, filters) {
  if (isTauri()) {
    if (!filters) {
      filters = [{ name: 'PDF Files', extensions: ['pdf'] }];
    }

    // Try using the dialog plugin
    if (window.__TAURI__.dialog) {
      try {
        const result = await window.__TAURI__.dialog.save({
          defaultPath: defaultPath,
          filters: filters
        });
        return result;
      } catch (e) {
        console.error('Dialog plugin error:', e);
      }
    }

    return null;
  }

  // Web fallback: return the suggested filename (writeBinaryFile will trigger download).
  // "Opslaan als" van een document van de site is een download: alleen de naam,
  // anders schreef hij via het pad terug naar de site (#546).
  if (leesHostPad(defaultPath)) return extractFileName(defaultPath);
  return defaultPath || 'document.pdf';
}

// Folder picker dialog
export async function openFolderDialog(title) {
  if (!isTauri()) return null;

  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.open({
        directory: true,
        multiple: false,
        title: title || 'Select Folder'
      });
      return result;
    } catch (e) {
      console.error('Dialog plugin error:', e);
    }
  }

  return null;
}

// File system operations
export async function readBinaryFile(path) {
  // Een document van de site komt via het contract van de site (#546). Het
  // gevraagde pad telt daarna als geopend, ook als de site de naam intussen
  // veranderde (bv. een recent bestand na een herlaadbeurt).
  const host = leesHostPad(path);
  if (host && hostOpslag()) {
    // Een oudere versie blijft die versie en schrijft nooit terug (#712).
    if (host.versie !== null) return (await openHostBestand(host.id, host.versie)).data;
    const { data } = await openHostBestand(host.id);
    _hostPaden.set(path, host.id);
    return data;
  }

  // Web fallback: check the in-memory file cache first
  if (!isTauri()) {
    const cached = _webFileCache.get(path);
    if (cached) return cached;
    return null;
  }

  // Use the fs plugin directly
  if (window.__TAURI__.fs) {
    return await window.__TAURI__.fs.readFile(path);
  }

  throw new Error('FS plugin not available');
}

export async function writeBinaryFile(path, data) {
  // Terugschrijven naar de site: alleen voor een pad dat als document van de
  // site geopend is (#546).
  const hostId = _hostPaden.get(path);
  if (hostId !== undefined && hostOpslag()) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await hostOpslag().save(hostId, bytes, { name: leesHostPad(path)?.naam });
    return true;
  }

  if (!isTauri()) {
    // Web fallback: trigger a browser download
    const fileName = path.replace(/^.*[\\/]/, '') || 'download';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeMap = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
      jpeg: 'image/jpeg', csv: 'text/csv', xfdf: 'application/xml',
      xml: 'application/xml',
      ifcx: 'application/json',
      odt: 'application/vnd.oasis.opendocument.text',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const blob = new Blob([data], { type: mimeMap[ext] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  // Use the fs plugin directly - no fallback to slow base64 method
  if (window.__TAURI__.fs) {
    await window.__TAURI__.fs.writeFile(path, data);
    return true;
  }

  throw new Error('FS plugin not available');
}

let _volgendeSchrijfId = 0;

// PDF saves must never truncate the original before all bytes are safely staged.
//
// `annulering` (pdf/saver/opslag-annuleren.js, #766): op de desktop krijgt het
// Rust-commando een id mee; annuleren vraagt `cancel_file_write`, en Rust stopt
// dan vóór het hernoemen en verwijdert het tijdelijke bestand (de fout bevat
// 'opds-write-cancelled'). Komt het annuleren pas na het hernoemen, dan slaagt
// het schrijven gewoon. Zonder Tauri (download, gastsite) is het schrijven niet
// te onderbreken: de annulering wordt daar vóór het schrijven vastgelegd.
export async function writeBinaryFileAtomic(path, data, { annulering = null } = {}) {
  if (!isTauri()) {
    annulering?.vastleggen?.();
    return writeBinaryFile(path, data);
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const mobile = window.__TAURI__?.os?.type?.() === 'android';
  const headers = { 'x-opds-path': encodeURIComponent(path) };
  let afmelden = null;
  if (annulering) {
    annulering.controleer?.();
    const id = `${Date.now().toString(36)}-${++_volgendeSchrijfId}`;
    headers['x-opds-cancel-id'] = id;
    afmelden = annulering.opWijziging?.(() => {
      if (!annulering.geannuleerd) return;
      Promise.resolve(getTauriCore().invoke('cancel_file_write', { id }))
        .catch((e) => console.warn('[save] cancelling the write failed:', e));
    }) || null;
  }
  try {
    await getTauriCore().invoke('write_file_atomic', mobile ? { data: Array.from(bytes) } : bytes, { headers });
  } finally {
    afmelden?.();
  }
  return true;
}

// An existing destination surfaces as CHOOSE_NEW_FILE (os error 17 on Unix,
// 80/183 on Windows).
async function invokeNew(command, path, data, headers = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const mobile = window.__TAURI__?.os?.type?.() === 'android';
  try {
    await getTauriCore().invoke(command, mobile ? { data: Array.from(bytes) } : bytes, {
      headers: { 'x-opds-path': encodeURIComponent(path), ...headers },
    });
  } catch (e) {
    const message = String(e?.message ?? e);
    if (/already exists|file exists|os error (17|80|183)\b/i.test(message)) throw new Error('CHOOSE_NEW_FILE');
    throw e instanceof Error ? e : new Error(message);
  }
  return true;
}

// Workflows and new-copy exports must fail on collisions, including races
// after an existence check.
export async function writeBinaryFileNew(path, data) {
  if (!isTauri()) throw new Error('DESKTOP_REQUIRED');
  return invokeNew('write_file_new', path, data);
}

// Untrusted bytes (a component of a PDF collection): never replaces a file,
// refuses autostart folders and, when `restrict` is set, programs and scripts;
// marked as downloaded content on Windows (src-tauri/src/export_policy.rs).
export async function writeDownloadedFileNew(path, data, { restrict = true } = {}) {
  if (!isTauri()) throw new Error('DESKTOP_REQUIRED');
  return invokeNew('write_downloaded_file_new', path, data, { 'x-opds-restrict': restrict ? '1' : '0' });
}

export async function fileExists(path) {
  if (leesHostPad(path)) return hostOpslag() !== null;
  if (!isTauri()) return false;

  // Try using the fs plugin
  if (window.__TAURI__.fs) {
    try {
      await window.__TAURI__.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  // Fallback: use invoke
  return await invoke('file_exists', { path });
}

// Iets buiten de app openen (webadres, bijlage): core/extern-openen.js (#695).

// ── Contract van invoke() buiten Tauri ──────────────────────────────────────
// De webversie heeft geen Rust-kant. Een aanroep KAN daar dus niet slagen.
// Tot #456 gaf invoke() dan stil `null` terug: de aanroeper zag geen verschil
// tussen "hier niet beschikbaar", "mislukt" en "Rust gaf echt null terug", dus
// elke knop achter een Rust-opdracht deed niets zonder een woord. Het contract
// is nu één vorm, overal gelijk: de belofte wordt afgewezen met een
// NietInBrowserError. Aanroepers die er iets mee kunnen vangen hem af met
// isNietInBrowser(); de rest laat hem door naar de gewone foutafhandeling.
export const NIET_IN_BROWSER = 'NIET_IN_BROWSER';

export class NietInBrowserError extends Error {
  constructor(command) {
    super(`"${command}" is not available in the browser build`);
    this.name = 'NietInBrowserError';
    this.code = NIET_IN_BROWSER;
    this.command = command;
  }
}

/** Is dit de fout "deze opdracht bestaat niet in de webversie"? */
export function isNietInBrowser(fout) {
  return !!fout && typeof fout === 'object' && fout.code === NIET_IN_BROWSER;
}

// Invoke custom commands. `options` (bijvoorbeeld koppen bij een rauwe
// body: `args` is dan een Uint8Array) gaat alleen mee als hij er is.
export async function invoke(cmd, args = {}, options = undefined) {
  const core = getTauriCore();
  if (!core) throw new NietInBrowserError(cmd);
  const run = () => options === undefined ? core.invoke(cmd, args) : core.invoke(cmd, args, options);
  return isObservedRenderCommand(cmd) ? observeNativeRender(cmd, args, run) : run();
}

// App-datamap (kaders, onderhoeken). Gaat via Rust zodat een testinstantie
// met OPDS_DATA_DIR niet in het profiel van de gebruiker leest of schrijft;
// terugval op Tauri's appDataDir voor oudere backends.
export async function getAppDataDir() {
  const t = typeof window !== 'undefined' ? window.__TAURI__ : null;
  try {
    const map = await t?.core?.invoke('app_data_dir_effectief');
    if (map) return map;
  } catch { /* commando onbekend: terugval */ }
  return t.path.appDataDir();
}

// Resolve raw OS type + version into a human-friendly name
const WINDOWS_BUILDS = [
  [22000, 'Windows 11'],
  [0,     'Windows 10'],
];
const WINDOWS_VERSIONS = [
  [6, 3, 'Windows 8.1'],
  [6, 2, 'Windows 8'],
  [6, 1, 'Windows 7'],
  [6, 0, 'Windows Vista'],
  [5, 2, 'Windows XP x64'],
  [5, 1, 'Windows XP'],
];
const MACOS_NAMES = {
  26: 'Tahoe',      25: 'Tahoe',
  15: 'Sequoia',    14: 'Sonoma',     13: 'Ventura',
  12: 'Monterey',   11: 'Big Sur',
};
const MACOS_10_NAMES = {
  15: 'Catalina',   14: 'Mojave',     13: 'High Sierra',
  12: 'Sierra',     11: 'El Capitan', 10: 'Yosemite',
  9:  'Mavericks',  8:  'Mountain Lion', 7: 'Lion',
  6:  'Snow Leopard', 5: 'Leopard',   4: 'Tiger',
  3:  'Panther',    2:  'Jaguar',     1: 'Puma',
  0:  'Cheetah',
};

function resolveOsInfo(rawType, rawVersion) {
  const type = (rawType || '').toLowerCase();
  const parts = rawVersion.split('.').map(p => parseInt(p) || 0);
  const [major, minor, build] = parts;

  if (type === 'windows') {
    if (major === 10 && minor === 0) {
      for (const [minBuild, name] of WINDOWS_BUILDS) {
        if (build >= minBuild) return { name, version: String(build) };
      }
    }
    for (const [maj, min, name] of WINDOWS_VERSIONS) {
      if (major === maj && minor === min) return { name, version: rawVersion };
    }
    return { name: 'Windows', version: rawVersion };
  }

  if (type === 'macos' || type === 'darwin') {
    if (major === 10) {
      const sub = MACOS_10_NAMES[minor];
      return { name: sub ? `macOS ${sub}` : 'macOS', version: rawVersion };
    }
    const name = MACOS_NAMES[major];
    return { name: name ? `macOS ${name}` : 'macOS', version: rawVersion };
  }

  if (type === 'linux')   return { name: 'Linux', version: rawVersion };
  if (type === 'android') return { name: 'Android', version: rawVersion };
  if (type === 'ios')     return { name: 'iOS', version: rawVersion };

  return { name: rawType || 'Unknown', version: rawVersion };
}

// Get OS info as { name, version, arch, locale } — cached after first call
let _osInfoCache = null;
export async function getOsInfo() {
  if (_osInfoCache) return _osInfoCache;
  if (!isTauri()) {
    _osInfoCache = { name: 'Browser', version: '', arch: '', locale: '' };
    return _osInfoCache;
  }
  try {
    const os = await import('@tauri-apps/plugin-os');
    const resolved = resolveOsInfo(os.type(), os.version());
    _osInfoCache = {
      name: resolved.name,
      version: resolved.version,
      arch: os.arch() || '',
      locale: os.locale() || '',
    };
  } catch {
    _osInfoCache = { name: 'Unknown', version: '', arch: '', locale: '' };
  }
  return _osInfoCache;
}

// Build a User-Agent string for API requests
export async function buildUserAgent() {
  const ver = await getAppVersion() || '0.0.0';
  const os = await getOsInfo();
  return `OpenPDFStudio/${ver} (${os.name} ${os.version}; ${os.arch})`.replace(/\s+/g, ' ').trim();
}

// Get app version for display.
// Prefer the build-time version that Vite bakes in from package.json. In dev
// this tracks the source and refreshes on a Vite (re)start, whereas the Tauri
// runtime getVersion() reflects the COMPILED binary, which stays stale until a
// full Rust rebuild — the reason the title kept showing the previous version
// after a version bump. In a release build both values are identical (the bump
// syncs package.json and tauri.conf.json), so there is no downside. Fall back
// to the Tauri runtime value only if the build-time define is somehow absent.
export async function getAppVersion() {
  // In dev kan de live gesynchroniseerde versie nieuwer zijn dan het
  // Vite-define (zie core/app-version.js).
  if (typeof window !== 'undefined' && window.__APP_VERSION__) {
    return window.__APP_VERSION__;
  }
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  if (isTauri()) {
    try {
      return await window.__TAURI__.app.getVersion();
    } catch {
      return null;
    }
  }
  return null;
}

// Check if running in dev/debug mode
export async function isDevMode() {
  try {
    return await invoke('is_dev_mode') === true;
  } catch {
    return false;
  }
}

// Get files opened via command line
export async function getOpenedFiles() {
  return await invoke('get_opened_file');
}

// Session management
//
// In de browser bewaart de sessie NIETS (#456). Wat de app daar bewaarde waren
// bestandsnamen, en een naam alleen opent niets: de bytes staan enkel in het
// geheugen van dat tabblad. Tabbladen die nergens naar wijzen zijn erger dan
// een lege start, en de bestandsnamen van de gebruiker horen niet ongevraagd
// in de browseropslag achter te blijven. Zie js/core/sessie-herstel.js.
const WEB_SESSIE_SLEUTEL = 'pdfStudioSession';

export async function saveSession(data) {
  if (!isTauri()) {
    // Ook een eerder bewaarde sessie opruimen.
    verwijderOpslag(WEB_SESSIE_SLEUTEL);
    return;
  }
  return await invoke('save_session', { data: JSON.stringify(data) });
}

export async function loadSession() {
  if (!isTauri()) return null;
  const result = await invoke('load_session');
  if (result) {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }
  return null;
}

// Preferences file storage (Rust-backed, survives WebView2 data clears)
export async function savePreferencesFile(data) {
  return await invoke('save_preferences', { data: JSON.stringify(data) });
}

export async function loadPreferencesFile() {
  const result = await invoke('load_preferences');
  if (result) {
    try { return JSON.parse(result); } catch { return null; }
  }
  return null;
}

// Symboolcatalogi als losse bestanden naast preferences.json (#354) —
// alleen in Tauri; de browser-variant houdt catalogi inline in preferences.
export async function saveCatalogFile(id, data) {
  return await invoke('save_catalog', { id, data: JSON.stringify(data) });
}

export async function loadCatalogFile(id) {
  const result = await invoke('load_catalog', { id });
  if (result) {
    try { return JSON.parse(result); } catch { return null; }
  }
  return null;
}

// The text of a catalog file as stored, or null when there is none. Unlike
// loadCatalogFile it tells a damaged file (text that does not parse) apart
// from a missing one, so a caller can keep the damaged file (#311).
export async function loadCatalogText(id) {
  const result = await invoke('load_catalog', { id });
  return typeof result === 'string' ? result : null;
}

// Store `text` unchanged as a catalog file (a copy of a damaged one).
export async function saveCatalogText(id, text) {
  return await invoke('save_catalog', { id, data: String(text) });
}

export async function deleteCatalogFile(id) {
  try { return await invoke('delete_catalog', { id }); } catch { return false; }
}

// Get system username
export async function getUsername() {
  const result = await invoke('get_username');
  return result || 'User';
}

// Check if this app is the default PDF handler
export async function isDefaultPdfApp() {
  try {
    return await invoke('is_default_pdf_app') === true;
  } catch {
    return false;
  }
}

// Open Windows Default Apps settings page
export async function openDefaultAppsSettings() {
  try {
    return await invoke('open_default_apps_settings');
  } catch (e) {
    console.warn('Failed to open default apps settings:', e);
    return false;
  }
}

// Download a PDF from URL to a temp file
export async function downloadPdfFromUrl(url) {
  return await invoke('download_pdf_from_url', { url });
}

// List PDF files in a directory
export async function listPdfFiles(dir) {
  return await invoke('list_pdf_files', { dir });
}

/** PDF files directly in `dir` as [{path, size, mtimeMs}]. */
export async function listPdfFileStats(dir) {
  return await invoke('list_pdf_file_stats', { dir });
}

// File locking - prevent other apps from writing to an open file.
// Alleen op het bureaublad: de browser (webbouw, werkplek) kent geen
// vergrendelde bestanden; daar niets vragen en dus ook niets in de console (#707).
export async function lockFile(path) {
  if (!isTauri()) return false;
  try {
    return await invoke('lock_file', { path });
  } catch (e) {
    console.warn('Failed to lock file:', e);
    return false;
  }
}

export async function renameFile(oldPath, newPath) {
  return await invoke('rename_file', { oldPath, newPath });
}

export async function unlockFile(path) {
  if (!isTauri()) return false;
  try {
    return await invoke('unlock_file', { path });
  } catch (e) {
    console.warn('Failed to unlock file:', e);
    return false;
  }
}
