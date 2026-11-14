import { state } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { createTab, closeTab, markDocumentModified } from '../ui/chrome/tabs.js';
import { loadPDF, clearCachedPdfBytes } from '../pdf/loader.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { createCentralPdfAdapter } from './central-review-pdf-adapter.js';

/** A local editable snapshot: saving uses the usual Save As / XFDF routes. */
export function centralPdfAdapter(title) {
  // Titles never become paths, and cannot inject directories into Save As.
  const name = `${String(title).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.pdf$/i, '').slice(0, 160) || 'Review'}.pdf`;
  return createCentralPdfAdapter(name, {
    async createFile(bytes) {
      const directory = await window.__TAURI__.path.tempDir();
      const path = `${directory.replace(/[\\/]$/, '')}/opds-central-${crypto.randomUUID()}.pdf`;
      await invoke('allow_fs_scope', { path });
      try { await window.__TAURI__.fs.writeFile(path, bytes); }
      catch (error) { try { await window.__TAURI__.fs.remove(path); } catch {} throw error; }
      return path;
    },
    async removeFile(path) {
      clearCachedPdfBytes(path);
      try { await window.__TAURI__.fs.remove(path); }
      catch (error) {
        // closeTab also removes untitled backing files. An already absent
        // owned temp file is the expected idempotent cleanup case.
        if (await window.__TAURI__.fs.exists(path)) throw error;
      }
    },
    createTab(path) { const { index } = createTab(path); return state.documents[index]; },
    contains: doc => state.documents.includes(doc),
    close: doc => closeTab(state.documents.indexOf(doc), true),
    load: (doc, path, bytes) => loadPDF(path, state.documents.indexOf(doc), bytes),
    annotationsReady: doc => doc._annotationCompletion,
    modified: markDocumentModified,
    redraw(doc) {
      if (state.documents[state.activeDocumentIndex] !== doc) return;
      if (doc.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations();
    },
  });
}
