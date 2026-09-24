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

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
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

/**
 * Annotatielaag (#468). De volgorde van doc.annotationLayers is de volgorde
 * in het paneel; de standaardlaag (id 'default') heeft geen eigen naam.
 * Reist mee in de PDF als optional content group (js/pdf/saver/annotatie-lagen.js).
 */
export interface AnnotationLayer {
  id: string;
  name: string;
  color: string | null;
  visible: boolean;
  printable: boolean;
  locked: boolean;
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
  /** OCR word results keyed by 1-based page number, written into an invisible
   *  searchable text layer on save (see js/pdf/ocr.js, saver/ocr-text-layer.js). */
  ocrResults: Record<number, OcrWord[]>;
  bookmarks: Bookmark[];
  undoStack: UndoCommand[];
  redoStack: UndoCommand[];
  savedUndoStackLength: number;
  selectedAnnotation: Annotation | null;
  selectedAnnotations: Annotation[];
  modified: boolean;
  scrollPosition: ScrollPosition;
  /** Reader Mode: the reading position of this document is tracked (js/core/reader-mode-tracking.js). */
  readerModeActive: boolean;
  /** Reader Mode: stored position that still has to be shown; blocks saving until applied. */
  _readerRestore?: { page?: number; scale?: number; scrollTop?: number; scrollHeight?: number; viewMode?: string } | null;
  /** Reader Mode: a jump to the stored position is under way. */
  _readerRestoring?: boolean;
  pageRotations: Record<number, number>;
  pageDims?: Record<number, { widthPt: number; heightPt: number; rotation?: number }>;
  pdfaCompliance: string | null;
  pdfADismissed: boolean;
  measureScale: MeasureScale | null;
  /** Meetschalen uit de PDF zelf (/VP + /Measure), per 1-gebaseerd paginanummer,
   *  in app-ruimte; alleen gelezen (js/pdf/pdf-viewports.js, #400). */
  pdfViewports?: Record<number, Array<{ x: number; y: number; width: number; height: number; pixelsPerUnit: number; unit: string; mmPerPoint: number; ratio: string; name: string }>>;
  /** Benoemde lijnstijl-presets — persist in de PDF (catalog /OPS_StylePresets). */
  stylePresets: StylePreset[];
  /** Annotatielagen (#468); leeg = alleen de standaardlaag (js/annotations/annotatie-lagen.js). */
  annotationLayers: AnnotationLayer[];
  /** De laag waar nieuwe markeringen op landen; null = de standaardlaag. */
  currentLayerId: string | null;
  // Internal loader state
  _loadedAnnotationPages: Set<number>;
  _annotationPagesReady: Set<number>;
  _sharedPdfLibDoc: any;
  _sharedPdfLibDocPromise: Promise<any> | null;
  _pagesNeedingColorUpdate: Set<number>;
  _annotationLoadId: number;
  _isLoading: boolean;
}
