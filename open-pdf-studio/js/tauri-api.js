/**
 * Tauri API wrapper module
 * Provides a unified interface for Tauri 2.x APIs
 * Uses the global __TAURI__ object instead of ES module imports
 */

// Check if running in Tauri
export const isTauri = () => {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};

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
    await currentWindow.close();
  }
}

// File dialogs - using Tauri commands since plugin APIs may not be globally available
export async function openFileDialog() {
  if (!isTauri()) return null;

  // Try using the dialog plugin via window.__TAURI__.dialog
  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      return result;
    } catch (e) {
      console.error('Dialog plugin error:', e);
    }
  }

  // Fallback: use invoke to call a custom command
  return await invoke('open_file_dialog');
}

export async function saveFileDialog(defaultPath) {
  if (!isTauri()) return null;

  // Try using the dialog plugin
  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.save({
        defaultPath: defaultPath,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
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
  if (!isTauri()) return null;

  // Use the fs plugin directly
  if (window.__TAURI__.fs) {
    return await window.__TAURI__.fs.readFile(path);
  }

  throw new Error('FS plugin not available');
}

export async function writeBinaryFile(path, data) {
  if (!isTauri()) return false;

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

// Get file opened via command line
export async function getOpenedFile() {
  return await invoke('get_opened_file');
}

// Session management
export async function saveSession(data) {
  return await invoke('save_session', { data: JSON.stringify(data) });
}

export async function loadSession() {
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

// Get system username
export async function getUsername() {
  const result = await invoke('get_username');
  return result || 'User';
}
