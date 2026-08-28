import type { DocumentState } from '../../types/document.js';

/**
 * Creates a new document state object
 */
export function createDocument(filePath: string | null = null): DocumentState {
  return {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    filePath: filePath,
    fileName: filePath ? filePath.split(/[\\/]/).pop()! : 'Untitled',
    pdfDoc: null,
    currentPage: 1,
    scale: 1.5,
    viewMode: 'single',
    annotations: [],
    textEdits: [],
    watermarks: [],
    bookmarks: [],
    undoStack: [],
    redoStack: [],
    savedUndoStackLength: 0,
    selectedAnnotation: null,
    selectedAnnotations: [],
    modified: false,
    scrollPosition: { x: 0, y: 0 },
    pageRotations: {},
    pdfaCompliance: null,
    pdfADismissed: false,
    measureScale: null,
    stylePresets: [],
    _loadedAnnotationPages: new Set(),
    // Pagina's waarvan de annotaties ECHT in het model staan (pas na
    // conversie gezet). _loadedAnnotationPages markeert al bij de start
    // van het laden (dedupe); de saver mag alleen op deze set vertrouwen.
    _annotationPagesReady: new Set(),
    _sharedPdfLibDoc: null,
    _sharedPdfLibDocPromise: null,
    _pagesNeedingColorUpdate: new Set(),
    _annotationLoadId: 0,
    _isLoading: false,
  };
}

let untitledCounter = 0;

/**
 * Get the next untitled document name
 */
export function getNextUntitledName(): string {
  untitledCounter++;
  if (untitledCounter === 1) return 'Untitled.pdf';
  return `Untitled ${untitledCounter}.pdf`;
}
