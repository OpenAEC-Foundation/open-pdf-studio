import type { Annotation } from './annotation.js';

export interface MeasureScale {
  pixelsPerUnit: number;
  unit: string;
  method: string;
  scaleRatio: number;
}

export interface TextEdit {
  page: number;
  spans: any[];
  original: any;
}

export interface Watermark {
  id: string;
  type: 'text' | 'image';
  [key: string]: any;
}

export interface Bookmark {
  id: string;
  title: string;
  page: number;
  children?: Bookmark[];
  expanded?: boolean;
}

/**
 * Benoemde lijnstijl-preset (WEERGAVE-sectie van het Eigenschappen-paneel).
 * Reist mee met het document via de catalog-entry /OPS_StylePresets.
 */
export interface StylePreset {
  id: string;
  name: string;
  props: Record<string, unknown>;
}

export interface UndoCommand {
  type: string;
  [key: string]: any;
}

export interface ScrollPosition {
  x: number;
  y: number;
}

export interface DocumentState {
  id: string;
  filePath: string | null;
  fileName: string;
  pdfDoc: any; // pdfjs-dist PDFDocumentProxy
  currentPage: number;
  scale: number;
  viewMode: 'single' | 'continuous';
  /** Boekweergave (issue #201): continuous met 2-pagina-spreads, pagina 1 rechts. */
  bookSpread?: boolean;
  annotations: Annotation[];
  textEdits: TextEdit[];
  watermarks: Watermark[];
  bookmarks: Bookmark[];
  undoStack: UndoCommand[];
  redoStack: UndoCommand[];
  savedUndoStackLength: number;
  selectedAnnotation: Annotation | null;
  selectedAnnotations: Annotation[];
  modified: boolean;
  scrollPosition: ScrollPosition;
  pageRotations: Record<number, number>;
  pageDims?: Record<number, { widthPt: number; heightPt: number; rotation?: number }>;
  pdfaCompliance: string | null;
  pdfADismissed: boolean;
  measureScale: MeasureScale | null;
  /** Benoemde lijnstijl-presets — persist in de PDF (catalog /OPS_StylePresets). */
  stylePresets: StylePreset[];
  // Internal loader state
  _loadedAnnotationPages: Set<number>;
  _sharedPdfLibDoc: any;
  _sharedPdfLibDocPromise: Promise<any> | null;
  _pagesNeedingColorUpdate: Set<number>;
  _annotationLoadId: number;
  _isLoading: boolean;
}
