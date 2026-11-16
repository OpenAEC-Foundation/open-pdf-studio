import { createMutable } from 'solid-js/store';
import type { Annotation, Point } from '../../types/annotation.js';

export interface InteractionState {
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
  spacePanHeld: boolean;
  isPanning: boolean;
  isMiddleButtonPanning: boolean;
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
  addHoleTargetId: string | null;
  addHolePoints: Point[];
  lastSnapResult: any;
  // ─── Reactive cursor inputs ──────────────────────────────────────────
  // The cursor module (js/ui/cursor.js) reads these to derive the cursor
  // shown in the PDF area. Tools write to these instead of touching
  // canvas.style.cursor directly.
  hoverAnnotation: Annotation | null;
  hoverHandle: string | null;
  /** When set during a drag, overrides the default 'move' cursor (e.g. 'copy' for Ctrl+drag). */
  dragCursor: string | null;
  /** Long-running operation in progress — shows the wait cursor. */
  busy: boolean;
  /** Snap calibration / pick mode — shows the crosshair cursor. */
  snapPick: boolean;
  /**
   * When non-null, a filledArea (or compatible polygon-with-points annotation) is in
   * "edit contour" mode: vertex/edge handles are exposed for direct contour editing.
   * Holds the annotation id of the annotation being edited.
   */
  editingContour: string | null;
}

export const interactionState = createMutable<InteractionState>({
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentPath: [],
  polylinePoints: [],
  isDrawingPolyline: false,
  cloudPolylinePoints: [],
  isDrawingCloudPolyline: false,
  splinePoints: [],
  isDrawingSpline: false,
  splineArrowPoints: [],
  isDrawingSplineArrow: false,
  dimPoints: [],
  isDrawingDimension: false,
  isDragging: false,
  isResizing: false,
  activeHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  originalAnnotation: null,
  originalAnnotations: [],
  isRubberBanding: false,
  rubberBandStartX: 0,
  rubberBandStartY: 0,
  spacePanHeld: false,
  isPanning: false,
  isMiddleButtonPanning: false,
  panStartX: 0,
  panStartY: 0,
  panScrollStartX: 0,
  panScrollStartY: 0,
  activeContinuousCanvas: null,
  activeContinuousPage: null,
  measurePoints: null,
  measurePhase: 'outer',
  measureOuterPoints: null,
  measureHoles: [],
  calibrationPoints: [],
  addHoleTargetId: null,
  addHolePoints: [],
  lastSnapResult: null,
  hoverAnnotation: null,
  hoverHandle: null,
  dragCursor: null,
  busy: false,
  snapPick: false,
  editingContour: null,
});

export function resetDrawing(): void {
  interactionState.isDrawing = false;
  interactionState.currentPath = [];
  interactionState.polylinePoints = [];
  interactionState.isDrawingPolyline = false;
  interactionState.cloudPolylinePoints = [];
  interactionState.isDrawingCloudPolyline = false;
  interactionState.splinePoints = [];
  interactionState.isDrawingSpline = false;
  interactionState.splineArrowPoints = [];
  interactionState.isDrawingSplineArrow = false;
  interactionState.dimPoints = [];
  interactionState.isDrawingDimension = false;
  interactionState.measurePoints = null;
  interactionState.measurePhase = 'outer';
  interactionState.measureOuterPoints = null;
  interactionState.measureHoles = [];
  interactionState.calibrationPoints = [];
  interactionState.lastSnapResult = null;
}

export function resetDrag(): void {
  interactionState.isDragging = false;
  interactionState.isResizing = false;
  interactionState.activeHandle = null;
  interactionState.originalAnnotation = null;
  interactionState.originalAnnotations = [];
  interactionState.dragCursor = null;
}

export function resetPan(): void {
  interactionState.isPanning = false;
  interactionState.isMiddleButtonPanning = false;
}

export function resetRubberBand(): void {
  interactionState.isRubberBanding = false;
}

export function resetAllInteraction(): void {
  resetDrawing();
  resetDrag();
  resetPan();
  resetRubberBand();
}
