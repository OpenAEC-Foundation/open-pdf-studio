import { isShxTextAnnotation } from '../pdf/shx-text.js';
import { state, getActiveDocument } from '../core/state.js';
import { isTauri, listPdfFiles, readBinaryFile, extractFileName } from '../core/platform.js';
import { pdfjsBronnen } from '../core/basis-url.js';
import { searchDocuments } from './document-search.js';
import { extractPageText, zoekPaginaAlleBronnen, buildPattern } from './find-controller.js';

// Recompute rather than retain a folder index. Never use stale extracted text.
function revision(doc, pdf) {
  if (doc && (!state.documents.includes(doc) || doc.pdfDoc !== pdf)) return 'closed';
  return JSON.stringify([pdf.fingerprints, doc?.inhoudRevisie || 0]);
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

export async function searchWorkspace(request, callbacks) {
  return searchDocuments(request, {
    async sources(options) {
      if (options.scope === 'folder') {
        if (!isTauri()) throw new Error('FOLDER_SEARCH_REQUIRES_DESKTOP');
        const paths = await listPdfFiles(options.folder);
        return paths.sort().map(path => {
          const doc = state.documents.find(d => d.filePath === path);
          return { id: doc?.id || path, path, name: extractFileName(path), doc };
        });
      }
      const docs = options.scope === 'active' ? [getActiveDocument()].filter(Boolean) : [...state.documents];
      return docs.map(doc => ({ id: doc.id, path: doc.filePath, name: doc.fileName, doc }));
    },
    async open(source, signal) {
      const doc = source.doc;
      let task;
      let contentDigest;
      let pdf = doc?.pdfDoc;
      if (doc && !pdf) throw new Error('DOCUMENT_NOT_READY');
      if (!doc) {
        const { getDocument } = await import('pdfjs-dist');
        const bytes = await readBinaryFile(source.path);
        if (signal?.aborted) throw new Error('CANCELLED');
        contentDigest = await digest(bytes);
        task = getDocument({ data: bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false });
        const abort = () => { void task.destroy(); };
        signal?.addEventListener('abort', abort, { once: true });
        try { pdf = await task.promise; }
        catch (error) { await task.destroy(); throw error; }
        finally { signal?.removeEventListener('abort', abort); }
      }
      const fingerprint = pdf.fingerprints?.[0];
      const labels = await pdf.getPageLabels().catch(() => null);
      return {
        pages: pdf.numPages,
        metadata: { fingerprint, contentDigest },
        revision: () => doc ? revision(doc, pdf) : fingerprint,
        close: async () => { if (task) await task.destroy(); },
        async search(pageNum, options) {
          const data = await extractPageText(pdf, pageNum, doc);
          let annotations = [];
          if (options.annotations !== false) {
            if (doc) {
              const { ensureAnnotationsForPage } = await import('../pdf/loader.js');
              await ensureAnnotationsForPage(pageNum, doc);
              annotations = doc.annotations;
            } else {
              const page = await pdf.getPage(pageNum);
              annotations = (await page.getAnnotations()).filter(a => !isShxTextAnnotation(a) && (a.contentsObj?.str || a.contents)).map(a => ({
                id: a.id, page: pageNum, type: 'comment', text: a.contentsObj?.str || a.contents,
                x: (a.rect?.[0] || 0) - (data.view?.[0] || 0), y: data.view ? data.view[3] - a.rect?.[3] : 0,
                width: a.rect?.[2] - a.rect?.[0], height: a.rect?.[3] - a.rect?.[1],
              }));
            }
          }
          const matches = zoekPaginaAlleBronnen(data, buildPattern(options.query, !!options.matchCase, !!options.wholeWord), options.query,
            { annotations }, { tekst: options.text !== false, annotaties: options.annotations !== false });
          return { hasText: !!data.text.trim() || !!data.shxAnnotations?.some(a => a.text.trim()), matches: matches.map(m => ({ ...m, pageLabel: labels?.[pageNum - 1] || String(pageNum),
            annotationBox: m.annotationBox ?? (!doc && m.bron === 'annotation' ? (() => { const a = annotations.find(a => a.id === m.annotationId); return a && { x: a.x, y: a.y, width: a.width, height: a.height }; })() : undefined),
            snippet: m.bron === 'annotation' ? m.matchText : data.text.slice(Math.max(0, m.startPos - 50), m.endPos + 80), fingerprint, contentDigest })) };
        },
      };
    },
  }, callbacks);
}

async function openSearchDocument(match) {
  const { createTab, switchToTab } = await import('../ui/chrome/tabs.js');
  let index = state.documents.findIndex(d => d.id === match.documentId || (match.path && d.filePath === match.path));
  if (index < 0) {
    const { loadPDFIfNeeded } = await import('../pdf/loader.js');
    const created = createTab(match.path);
    index = created.index;
    await loadPDFIfNeeded(match.path, index);
  }
  const doc = state.documents[index];
  if (match.contentDigest && (doc?.inhoudRevisie || 0) !== 0) throw new Error('DOCUMENT_CHANGED');
  if (match.contentDigest && (!doc?.pdfDoc || await digest(await doc.pdfDoc.getData()) !== match.contentDigest)) throw new Error('DOCUMENT_CHANGED');
  if (!doc?.pdfDoc || doc.pdfDoc.fingerprints?.[0] !== match.fingerprint) throw new Error('DOCUMENT_CHANGED');
  if (doc.id === match.documentId && revision(doc, doc.pdfDoc) !== match.revision) throw new Error('DOCUMENT_CHANGED');
  await switchToTab(index);
  if (getActiveDocument() !== doc) throw new Error('DOCUMENT_CHANGED');
  return doc;
}

export async function revealWorkspaceMatch(match) {
  const doc = await openSearchDocument(match);
  const { showWorkspaceMatch } = await import('./find-bar.js');
  if (getActiveDocument() !== doc) throw new Error('DOCUMENT_CHANGED');
  await showWorkspaceMatch(match);
}

// Opening the language dialog is explicit; it does not start OCR automatically.
export async function prepareSearchOcr(file) {
  const doc = await openSearchDocument({ ...file, documentId: file.id });
  const { openDialog } = await import('../bridge.js');
  if (getActiveDocument() !== doc) throw new Error('DOCUMENT_CHANGED');
  openDialog('ocr-language', { totalPages: doc.pdfDoc.numPages });
}
