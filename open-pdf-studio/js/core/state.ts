import { createMutable } from 'solid-js/store';
import { DEFAULT_PREFERENCES } from './constants.js';
import { interactionState } from './stores/interaction-store.js';
import { clipboardState } from './stores/clipboard-store.js';
import { editingState } from './stores/editing-store.js';
import type { Annotation, Point } from '../types/annotation.js';
import type { DocumentState, MeasureScale } from '../types/document.js';
import type { Preferences } from '../types/preferences.js';

// Re-export focused stores for new code
export { interactionState } from './stores/interaction-store.js';
export type { InteractionState } from './stores/interaction-store.js';
export { clipboardState } from './stores/clipboard-store.js';
export type { ClipboardState } from './stores/clipboard-store.js';
export { editingState } from './stores/editing-store.js';
export type { EditingState } from './stores/editing-store.js';
export { resetDrawing, resetDrag, resetPan, resetRubberBand, resetAllInteraction } from './stores/interaction-store.js';
export { clearClipboard } from './stores/clipboard-store.js';
export { resetTextEditing, resetPdfTextEditing, resetAllEditing } from './stores/editing-store.js';

// Re-export document helpers (pure functions, no state dependency)
export { createDocument, getNextUntitledName } from './stores/document-helpers.js';

// Re-export selection helpers (operate on state, extracted for modularity)
export { clearSelection, addToSelection, removeFromSelection, isSelected, selectAllOnPage, getAnnotationBounds, getSelectionBounds } from './stores/selection-helpers.js';

// Re-export types for consumers
export type { Annotation, AnnotationBounds, AnnotationType, Point } from '../types/annotation.js';
export type { DocumentState, MeasureScale } from '../types/document.js';
export type { Preferences } from '../types/preferences.js';

export interface TextSelection {
  hasSelection: boolean;
  selectedText: string;
  pageNum: number | null;
}

export interface SearchState {
  isOpen: boolean;
  query: string;
  replaceQuery: string;
  results: any[];
  currentIndex: number;
  totalMatches: number;
  matchCase: boolean;
  wholeWord: boolean;
  highlightAll: boolean;
  isSearching: boolean;
}

export interface AppState {
  documents: DocumentState[];
  activeDocumentIndex: number;
  currentTool: string;
  toolOverrides: Record<string, any> | null;
  /** @deprecated Use the standalone `imageCache` export instead */
  imageCache: Map<string, any>;
  modalDialogOpen: boolean;
  appMenuOpen: boolean;
  preferences: Preferences;
  defaultAuthor: string;
  shiftKeyPressed: boolean;
  statusMessage: string;
  statusMessageVisible: boolean;
  renderEngine: string;    // 'Rust' or 'PDF.js' — shown in status bar
  renderTiming: string;    // e.g. '680ms' — shown next to engine name
  /**
   * User-chosen render-engine override. null = automatic (PDFium for raster,
   * vector replay for vector). 'rust-skia' = force the open-pdf-render
   * pure-Rust kernel (alpha — accuracy not yet at PDFium parity, see
   * scripts/render-regression-test.py). 'pdfium' = force PDFium explicitly.
   * Wired in js/pdf/page-bitmap-cache.js (ensureBitmap dispatches to the
   * matching Tauri command) and exposed via a clickable badge in StatusBar.
   */
  renderEngineOverride: 'pdfium' | 'rust-skia' | null;
  textSelection: TextSelection;
  search: SearchState;

  // Backward compat — interaction-store
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentPath: Point[];
  polylinePoints: Point[];
  isDrawingPolyline: boolean;
  cloudPolylinePoints: Point[];
  isDrawingCloudPolyline: boolean;
  splinePoints: Point[];
  isDrawingSpline: boolean;
  splineArrowPoints: Point[];
  isDrawingSplineArrow: boolean;
  dimPoints: Point[];
  isDrawingDimension: boolean;
  isDragging: boolean;
  isResizing: boolean;
  activeHandle: string | null;
  dragStartX: number;
  dragStartY: number;
  originalAnnotation: Annotation | null;
  originalAnnotations: Annotation[];
  isRubberBanding: boolean;
  rubberBandStartX: number;
  rubberBandStartY: number;
  isPanning: boolean;
  isMiddleButtonPanning: boolean;
  hoverAnnotation: Annotation | null;
  hoverHandle: string | null;
  dragCursor: string | null;
  busy: boolean;
  snapPick: boolean;
  editingContour: string | null;
  panStartX: number;
  panStartY: number;
  panScrollStartX: number;
  panScrollStartY: number;
  activeContinuousCanvas: HTMLCanvasElement | null;
  activeContinuousPage: number | null;
  measurePoints: Point[] | null;
  measurePhase: 'outer' | 'holes';
  measureOuterPoints: Point[] | null;
  measureHoles: Point[][];
  calibrationPoints: Point[];
  lastSnapResult: any;
  // Marching-ants animation phase for pending redaction marks. Advanced by the
  // viewport RAF driver only while a redaction is being drawn or pending.
  redactAntsOffset: number;

  // Backward compat — clipboard-store
  clipboardAnnotation: Annotation | null;
  clipboardAnnotations: Annotation[];

  // Backward compat — editing-store
  isEditingText: boolean;
  editingAnnotation: Annotation | null;
  textEditElement: HTMLElement | null;
  isEditingPdfText: boolean;
  pdfTextEditState: any;

  // Document delegation
  pdfDoc: any;
  currentPage: number;
  scale: number;
  viewMode: 'single' | 'continuous';
  currentPdfPath: string | null;
  annotations: Annotation[];
  textEdits: any[];
  watermarks: any[];
  bookmarks: any[];
  redoStack: any[];
  pageRotations: Record<number, number>;
  selectedAnnotation: Annotation | null;
  measureScale: MeasureScale | null;
  selectedAnnotations: Annotation[];
}

// Standalone image cache — kept OUTSIDE createMutable to avoid SolidJS Proxy
// wrapping Map operations (get/set/has don't work reliably through Proxy).
export const imageCache = new Map<string, HTMLImageElement>();

export const state = createMutable<AppState>({
  documents: [],
  activeDocumentIndex: -1,
  currentTool: 'select',
  toolOverrides: null,
  imageCache: imageCache,  // legacy reference — use standalone `imageCache` export
  modalDialogOpen: false,
  appMenuOpen: false,
  preferences: { ...DEFAULT_PREFERENCES },
  defaultAuthor: 'User',
  shiftKeyPressed: false,
  statusMessage: 'Ready',
  statusMessageVisible: true,
  renderEngine: '',
  renderTiming: '',
  // Default to PDFium (Raster) for development — Vector engine has known
  // gaps (text fallback to sans-serif, font-family not honored) that produce
  // misleading visual diffs. Auto-mode can be re-enabled via status-bar dropdown.
  renderEngineOverride: 'pdfium',
  textSelection: {
    hasSelection: false,
    selectedText: '',
    pageNum: null
  },
  search: {
    isOpen: false,
    query: '',
    replaceQuery: '',
    results: [],
    currentIndex: -1,
    totalMatches: 0,
    matchCase: false,
    wholeWord: false,
    highlightAll: true,
    isSearching: false
  },

  // Marching-ants animation phase for pending redaction marks (see AppState).
  redactAntsOffset: 0,

  // Backward compat — interaction-store
  get isDrawing() { return interactionState.isDrawing; },
  set isDrawing(v) { interactionState.isDrawing = v; },
  get startX() { return interactionState.startX; },
  set startX(v) { interactionState.startX = v; },
  get startY() { return interactionState.startY; },
  set startY(v) { interactionState.startY = v; },
  get currentPath() { return interactionState.currentPath; },
  set currentPath(v) { interactionState.currentPath = v; },
  get polylinePoints() { return interactionState.polylinePoints; },
  set polylinePoints(v) { interactionState.polylinePoints = v; },
  get isDrawingPolyline() { return interactionState.isDrawingPolyline; },
  set isDrawingPolyline(v) { interactionState.isDrawingPolyline = v; },
  get cloudPolylinePoints() { return interactionState.cloudPolylinePoints; },
  set cloudPolylinePoints(v) { interactionState.cloudPolylinePoints = v; },
  get isDrawingCloudPolyline() { return interactionState.isDrawingCloudPolyline; },
  set isDrawingCloudPolyline(v) { interactionState.isDrawingCloudPolyline = v; },
  get splinePoints() { return interactionState.splinePoints; },
  set splinePoints(v) { interactionState.splinePoints = v; },
  get isDrawingSpline() { return interactionState.isDrawingSpline; },
  set isDrawingSpline(v) { interactionState.isDrawingSpline = v; },
  get splineArrowPoints() { return interactionState.splineArrowPoints; },
  set splineArrowPoints(v) { interactionState.splineArrowPoints = v; },
  get isDrawingSplineArrow() { return interactionState.isDrawingSplineArrow; },
  set isDrawingSplineArrow(v) { interactionState.isDrawingSplineArrow = v; },
  get dimPoints() { return interactionState.dimPoints; },
  set dimPoints(v) { interactionState.dimPoints = v; },
  get isDrawingDimension() { return interactionState.isDrawingDimension; },
  set isDrawingDimension(v) { interactionState.isDrawingDimension = v; },
  get isDragging() { return interactionState.isDragging; },
  set isDragging(v) { interactionState.isDragging = v; },
  get isResizing() { return interactionState.isResizing; },
  set isResizing(v) { interactionState.isResizing = v; },
  get activeHandle() { return interactionState.activeHandle; },
  set activeHandle(v) { interactionState.activeHandle = v; },
  get dragStartX() { return interactionState.dragStartX; },
  set dragStartX(v) { interactionState.dragStartX = v; },
  get dragStartY() { return interactionState.dragStartY; },
  set dragStartY(v) { interactionState.dragStartY = v; },
  get originalAnnotation() { return interactionState.originalAnnotation; },
  set originalAnnotation(v) { interactionState.originalAnnotation = v; },
  get originalAnnotations() { return interactionState.originalAnnotations; },
  set originalAnnotations(v) { interactionState.originalAnnotations = v; },
  get isRubberBanding() { return interactionState.isRubberBanding; },
  set isRubberBanding(v) { interactionState.isRubberBanding = v; },
  get rubberBandStartX() { return interactionState.rubberBandStartX; },
  set rubberBandStartX(v) { interactionState.rubberBandStartX = v; },
  get rubberBandStartY() { return interactionState.rubberBandStartY; },
  set rubberBandStartY(v) { interactionState.rubberBandStartY = v; },
  get isPanning() { return interactionState.isPanning; },
  set isPanning(v) { interactionState.isPanning = v; },
  get isMiddleButtonPanning() { return interactionState.isMiddleButtonPanning; },
  set isMiddleButtonPanning(v) { interactionState.isMiddleButtonPanning = v; },
  get panStartX() { return interactionState.panStartX; },
  set panStartX(v) { interactionState.panStartX = v; },
  get panStartY() { return interactionState.panStartY; },
  set panStartY(v) { interactionState.panStartY = v; },
  get panScrollStartX() { return interactionState.panScrollStartX; },
  set panScrollStartX(v) { interactionState.panScrollStartX = v; },
  get panScrollStartY() { return interactionState.panScrollStartY; },
  set panScrollStartY(v) { interactionState.panScrollStartY = v; },
  get activeContinuousCanvas() { return interactionState.activeContinuousCanvas; },
  set activeContinuousCanvas(v) { interactionState.activeContinuousCanvas = v; },
  get activeContinuousPage() { return interactionState.activeContinuousPage; },
  set activeContinuousPage(v) { interactionState.activeContinuousPage = v; },
  get measurePoints() { return interactionState.measurePoints; },
  set measurePoints(v) { interactionState.measurePoints = v; },
  get measurePhase() { return interactionState.measurePhase; },
  set measurePhase(v) { interactionState.measurePhase = v; },
  get measureOuterPoints() { return interactionState.measureOuterPoints; },
  set measureOuterPoints(v) { interactionState.measureOuterPoints = v; },
  get measureHoles() { return interactionState.measureHoles; },
  set measureHoles(v) { interactionState.measureHoles = v; },
  get calibrationPoints() { return interactionState.calibrationPoints; },
  set calibrationPoints(v) { interactionState.calibrationPoints = v; },
  get addHoleTargetId() { return interactionState.addHoleTargetId; },
  set addHoleTargetId(v) { interactionState.addHoleTargetId = v; },
  get addHolePoints() { return interactionState.addHolePoints; },
  set addHolePoints(v) { interactionState.addHolePoints = v; },
  get lastSnapResult() { return interactionState.lastSnapResult; },
  set lastSnapResult(v) { interactionState.lastSnapResult = v; },
  get hoverAnnotation() { return interactionState.hoverAnnotation; },
  set hoverAnnotation(v) { interactionState.hoverAnnotation = v; },
  get hoverHandle() { return interactionState.hoverHandle; },
  set hoverHandle(v) { interactionState.hoverHandle = v; },
  get dragCursor() { return interactionState.dragCursor; },
  set dragCursor(v) { interactionState.dragCursor = v; },
  get busy() { return interactionState.busy; },
  set busy(v) { interactionState.busy = v; },
  get snapPick() { return interactionState.snapPick; },
  set snapPick(v) { interactionState.snapPick = v; },
  get editingContour() { return interactionState.editingContour; },
  set editingContour(v) { interactionState.editingContour = v; },

  // Backward compat — clipboard-store
  get clipboardAnnotation() { return clipboardState.annotation; },
  set clipboardAnnotation(v) { clipboardState.annotation = v; },
  get clipboardAnnotations() { return clipboardState.annotations; },
  set clipboardAnnotations(v) { clipboardState.annotations = v; },

  // Backward compat — editing-store
  get isEditingText() { return editingState.isEditingText; },
  set isEditingText(v) { editingState.isEditingText = v; },
  get editingAnnotation() { return editingState.editingAnnotation; },
  set editingAnnotation(v) { editingState.editingAnnotation = v; },
  get textEditElement() { return editingState.textEditElement; },
  set textEditElement(v) { editingState.textEditElement = v; },
  get isEditingPdfText() { return editingState.isEditingPdfText; },
  set isEditingPdfText(v) { editingState.isEditingPdfText = v; },
  get pdfTextEditState() { return editingState.pdfTextEditState; },
  set pdfTextEditState(v) { editingState.pdfTextEditState = v; },

} as any);

export function noPdf(): boolean {
  const d = state.documents[state.activeDocumentIndex];
  return !d?.pdfDoc;
}

export function getActiveDocument(): DocumentState | null {
  return state.documents[state.activeDocumentIndex] || null;
}

export function hasOpenDocuments(): boolean {
  return state.documents.length > 0;
}

export function findDocumentByPath(filePath: string): number {
  return state.documents.findIndex(doc => doc.filePath === filePath);
}

export function getPageRotation(pageNum: number): number {
  const doc = state.documents[state.activeDocumentIndex];
  return doc?.pageRotations?.[pageNum] || 0;
}

export function setPageRotation(pageNum: number, degrees: number): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.pageRotations ||= {};
    doc.pageRotations[pageNum] = ((degrees % 360) + 360) % 360;
  }
}

// Make shiftKeyPressed accessible globally for legacy code
Object.defineProperty(window, 'shiftKeyPressed', {
  get: () => state.shiftKeyPressed,
  set: (value: boolean) => { state.shiftKeyPressed = value; }
});
