export type AnnotationType =
  | 'highlight' | 'textHighlight' | 'textStrikethrough' | 'textUnderline'
  | 'draw' | 'line' | 'arrow' | 'box' | 'circle'
  | 'textbox' | 'callout' | 'comment' | 'stamp' | 'image' | 'signature'
  | 'polygon' | 'cloud' | 'cloudPolyline' | 'polyline' | 'text'
  | 'arc' | 'spline' | 'splineArrow' | 'redaction'
  | 'measureDistance' | 'measureArea' | 'measurePerimeter' | 'measureAngle'
  | 'filledArea'
  | 'mask' | 'viewport' | 'scheduleTable' | 'scaleBar'
  | 'scaleRegion'
  | 'parametricSymbol';

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  type: AnnotationType;
  page: number;
  author: string;
  subject: string;
  createdAt: string;
  modifiedAt: string;
  opacity: number;
  locked: boolean;
  printable: boolean;
  readOnly: boolean;
  marked: boolean;
  icon?: string;
  color?: string;
  lineWidth?: number;
  borderStyle?: string;
  replies?: AnnotationReply[];
  status?: string;
  rotation?: number;
}

export interface RectAnnotation extends AnnotationBase {
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
  fillNone?: boolean;
  strokeColor?: string;
}

export interface LineAnnotation extends AnnotationBase {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startHead?: string;
  endHead?: string;
  headSize?: number;
}

export interface DrawAnnotation extends AnnotationBase {
  path: Point[];
}

export interface PolylineAnnotation extends AnnotationBase {
  points: Point[];
}

export interface TextAnnotation extends AnnotationBase {
  x: number;
  y: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
}

export interface Leader {
  id: string;
  tipX: number;
  tipY: number;
  kneeX: number;
  kneeY: number;
  endStyle?: 'arrow' | 'circle';
}

export interface TextboxAnnotation extends RectAnnotation {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  leaders?: Leader[];
}

export interface CalloutAnnotation extends RectAnnotation {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  arrowX?: number;
  arrowY?: number;
  kneeX?: number;
  kneeY?: number;
}

export interface CommentAnnotation extends AnnotationBase {
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
}

export interface ImageAnnotation extends AnnotationBase {
  x: number;
  y: number;
  width: number;
  height: number;
  imageData?: string;
}

export interface MeasureAnnotation extends AnnotationBase {
  measureValue?: number;
  measureUnit?: string;
}

export interface AnnotationReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

/** Union of all annotation shapes */
export type Annotation = AnnotationBase & {
  // Geometry — present depending on type
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  path?: Point[];
  points?: Point[];
  controlPoints?: Point[];  // Spline control points
  holes?: Point[][];  // Cutout polygons for measureArea
  // Text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  // Appearance
  color?: string;
  fillColor?: string;
  fillNone?: boolean;
  strokeColor?: string;
  lineWidth?: number;
  borderStyle?: string;
  borderWidth?: number;
  // Hatch pattern
  hatchPattern?: string;
  hatchColor?: string;
  hatchScale?: number;
  hatchAngle?: number;
  // Arrow/line
  startHead?: string;
  endHead?: string;
  headSize?: number;
  // Callout
  arrowX?: number;
  arrowY?: number;
  kneeX?: number;
  kneeY?: number;
  // Textbox leaders (multi-leader generalisation)
  leaders?: Leader[];
  // Image/stamp
  imageData?: string;
  // Measurement
  measureValue?: number;
  measureUnit?: string;
  measureText?: string;
  measurePixels?: number;
  measureScale?: number;
  measurePrecision?: number;
  measureName?: string;
  // Label position override (absolute coords; defaults to centroid if unset)
  labelX?: number;
  labelY?: number;
  // Angle measurement
  point1?: Point;
  vertex?: Point;
  point2?: Point;
  arcRadius?: number;
  // Scale bar
  pixelsPerUnit?: number;
  divisions?: number;
  totalUnits?: number;

  // Arc
  centerX?: number;
  centerY?: number;
  radius?: number;
  startAngle?: number;
  endAngle?: number;

  // Viewport
  name?: string;
  scaleRatio?: string;

  // Scale Region (per-region calibration)
  scaleString?: string;  // e.g. "1:100"
  units?: string;        // 'mm' | 'cm' | 'm' | 'in' | 'ft'
  label?: string;        // optional user label drawn in badge
};

export interface AnnotationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
