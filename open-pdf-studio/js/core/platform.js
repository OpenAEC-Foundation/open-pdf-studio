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

// Extract a display-friendly file name from a path or content:// URI
export function extractFileName(pathOrUri) {
  if (!pathOrUri) return 'Document';
  // content:// URIs: try to decode and extract last segment
  if (pathOrUri.startsWith('content://')) {
    const decoded = decodeURIComponent(pathOrUri);
    // Try common patterns: .../document/primary:Download/file.pdf or raw:/storage/.../file.pdf
    const match = decoded.match(/[/:]([^/:]+\.pdf)$/i);
    if (match) return match[1];
    // Fallback: last path segment
    const segments = decoded.split(/[/:]+/).filter(Boolean);
    return segments[segments.length - 1] || 'Document';
  }
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
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    await currentWindow.minimize();
  }
}

export async function maximizeWindow() {
  if (!isTauri()) return;
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
// Timings are logged when `localStorage.openPdfStudio.debugDialog === '1'`.
export async function openFileDialog(extensions, options = {}) {
  if (isTauri()) {
    const filters = extensions
      ? [{ name: 'Files', extensions }]
      : [{ name: 'PDF Files', extensions: ['pdf'] }];

    const dbg = (() => { try { return localStorage.getItem('openPdfStudio.debugDialog') === '1'; } catch { return false; } })();
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

  // Web fallback: return the suggested filename (writeBinaryFile will trigger download)
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
  if (!isTauri()) {
    // Web fallback: trigger a browser download
    const fileName = path.replace(/^.*[\\/]/, '') || 'download';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeMap = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
      jpeg: 'image/jpeg', csv: 'text/csv', xfdf: 'application/xml',
      xml: 'application/xml',
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

export async function fileExists(path) {
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

// Shell operations
export async function openExternal(url) {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }

  // Try using the shell plugin
  if (window.__TAURI__.shell) {
    try {
      await window.__TAURI__.shell.open(url);
      return;
    } catch (e) {
      console.error('Shell plugin error:', e);
    }
  }

  // Fallback: use invoke
  await invoke('open_url', { url });
}

// Invoke custom commands
export async function invoke(cmd, args = {}) {
  if (!isTauri()) return null;
  const core = getTauriCore();
  if (core) {
    return await core.invoke(cmd, args);
  }
  return null;
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
export async function saveSession(data) {
  if (!isTauri()) {
    try { localStorage.setItem('pdfStudioSession', JSON.stringify(data)); } catch { /* ignore */ }
    return;
  }
  return await invoke('save_session', { data: JSON.stringify(data) });
}

export async function loadSession() {
  if (!isTauri()) {
    try {
      const s = localStorage.getItem('pdfStudioSession');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  }
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

// File locking - prevent other apps from writing to an open file
export async function lockFile(path) {
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
  try {
    return await invoke('unlock_file', { path });
  } catch (e) {
    console.warn('Failed to unlock file:', e);
    return false;
  }
}
