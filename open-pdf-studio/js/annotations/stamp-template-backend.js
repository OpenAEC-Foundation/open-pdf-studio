// App binding of the stamp-template library (#629): personal templates in
// the app data (Tauri: a catalog file next to preferences.json; browser: the
// app's local storage), the shared folder from the preferences, user name =
// author name from the preferences.

import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { isTauri, saveCatalogFile, loadCatalogFile, readBinaryFile, writeBinaryFile, fileExists } from '../core/platform.js';
import { leesOpslag, schrijfOpslag } from '../core/opslag.js';
import { createStampTemplateStore, joinPath, SHARED_FILE_NAME } from './stamp-template-store.js';

const CATALOG_ID = 'stamp-templates';
const STORAGE_NAME = 'stampTemplates';

const backend = {
  async loadPersonal() {
    if (isTauri()) {
      const data = await loadCatalogFile(CATALOG_ID);
      return data ? JSON.stringify(data) : null;
    }
    return leesOpslag(STORAGE_NAME);
  },
  async savePersonal(text) {
    if (isTauri()) await saveCatalogFile(CATALOG_ID, JSON.parse(text));
    else schrijfOpslag(STORAGE_NAME, text);
  },
  async readShared(folder) {
    const path = joinPath(folder, SHARED_FILE_NAME);
    if (isTauri() && !(await fileExists(path))) return null;
    const bytes = await readBinaryFile(path);
    return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
  },
  async writeShared(folder, text) {
    await writeBinaryFile(joinPath(folder, SHARED_FILE_NAME), new TextEncoder().encode(text));
  },
  getSharedFolder() {
    return state.preferences?.stampTemplateSharedFolder || '';
  },
  setSharedFolder(path) {
    state.preferences.stampTemplateSharedFolder = path;
    savePreferences();
  },
  user() {
    return state.preferences?.authorName || state.defaultAuthor || '';
  },
};

let store = null;
let loading = null;

/** The app's template library, loaded on first use. */
export async function stampTemplates() {
  if (!store) store = createStampTemplateStore(backend);
  if (!loading) loading = store.load().catch((e) => { console.warn('Stamp templates not loaded:', e); });
  await loading;
  return store;
}
