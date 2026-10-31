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
  confidence: number | null;
  review?: { status: 'accepted' | 'corrected'; originalText: string };
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
  /** Reviews stored in the file without the full word list (shown read-only). */
  ocrReviewArchive?: Record<number, OcrWord[]>;
  /** Pages whose own OCR layer an earlier save of this session wrote. */
  ocrLayerPages?: number[];
  /** Fingerprint of the OCR results the last save wrote (saver/ocr-text-layer.js). */
  ocrLayerSignature?: string;
  bookmarks: Bookmark[];
  /** Paginalabels (bladnamen, #580), index 0 = pagina 1; null = gewone paginanummers. */
  pageLabels?: string[] | null;
  /** Labels bewerkt: de volgende save schrijft /PageLabels opnieuw. */
  pageLabelsDirty?: boolean;
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
  /** Weergave draaien (#200): 0/90/180/270, rechtsom, voor alle pagina's van
   *  dit tabblad. Alleen de weergave; het document verandert niet. */
  viewRotation?: number;
  /** Gesplitste weergave (#715): null/afwezig = één paneel. Alleen wat de
   *  interface toont; de standen per paneel houdt pdf/split-view/split-view.js. */
  splitView?: { richting: 'vertical' | 'horizontal'; actief: 0 | 1; verhouding: number; sync: boolean } | null;
  pageDims?: Record<number, { widthPt: number; heightPt: number; rotation?: number }>;
  pdfaCompliance: string | null;
  pdfADismissed: boolean;
  /** Met een openingswachtwoord geopend: alleen-lezen, kan niet opgeslagen
   *  worden (js/pdf/wachtwoord-pdf.js). `filePath` is dan de ontsleutelde
   *  werkkopie, `originalFilePath` het bestand van de gebruiker. */
  passwordProtected?: boolean;
  originalFilePath?: string | null;
  /** De infobalk van een beveiligde PDF is voor dit tabblad weggeklikt. */
  _beveiligdBalkVerborgen?: boolean;
  measureScale: MeasureScale | null;
  /** Schaalcontroles per blad (#629, annotations/schaalcontrole.js); reist mee als
   *  /OPS_ScaleChecks op de pagina (pdf/schaal-in-pdf.js). */
  scaleChecks?: Record<number, Array<Record<string, unknown>>> | null;
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
