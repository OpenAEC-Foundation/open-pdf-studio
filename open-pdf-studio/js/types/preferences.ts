export interface Preferences {
  // Theme
  theme: string;

  // General
  authorName: string;

  // Snapping
  angleSnapDegrees: number;
  enableAngleSnap: boolean;

  // Grid snapping
  gridSize: number;
  enableGridSnap: boolean;
  showGrid: boolean;

  // Polar tracking
  polarTrackingEnabled: boolean;
  polarIncrement: number;
  polarTolerance: number;

  // Object snapping
  enableObjectSnap: boolean;
  snapToEndpoints: boolean;
  snapToMidpoints: boolean;
  snapToCenters: boolean;
  snapToEdges: boolean;
  snapToIntersections: boolean;
  snapToPerpendicular: boolean;
  snapToQuadrant: boolean;
  snapToTangent: boolean;
  snapToNearest: boolean;
  showSnapTypeLabel: boolean;
  objectSnapRadius: number;
  snapToPdfContent: boolean;
  enableImageAlignSnap: boolean;
  keepToolActive: boolean;
  lineContinue: boolean;
  ribbonCollapsed: boolean;

  // Appearance
  defaultAnnotationColor: string;
  defaultLineWidth: number;
  defaultFontSize: number;
  highlightOpacity: number;

  // TextBox defaults
  textboxFillColor: string;
  textboxFillNone: boolean;
  textboxStrokeColor: string;
  textboxBorderWidth: number;
  textboxBorderStyle: string;
  textboxOpacity: number;
  textboxFontSize: number;

  // Callout defaults
  calloutFillColor: string;
  calloutFillNone: boolean;
  calloutStrokeColor: string;
  calloutBorderWidth: number;
  calloutBorderStyle: string;
  calloutOpacity: number;
  calloutFontSize: number;

  // Rectangle defaults
  rectFillColor: string;
  rectFillNone: boolean;
  rectStrokeColor: string;
  rectBorderWidth: number;
  rectBorderStyle: string;
  rectOpacity: number;

  // Circle/Ellipse defaults
  circleFillColor: string;
  circleFillNone: boolean;
  circleStrokeColor: string;
  circleBorderWidth: number;
  circleBorderStyle: string;
  circleOpacity: number;

  // Arrow defaults
  arrowFillColor: string;
  arrowFillNone: boolean;
  arrowStrokeColor: string;
  arrowLineWidth: number;
  arrowBorderStyle: string;
  arrowStartHead: string;
  arrowEndHead: string;
  arrowHeadSize: number;
  arrowOpacity: number;

  // Draw/Freehand defaults
  drawStrokeColor: string;
  drawLineWidth: number;
  drawOpacity: number;

  // Line defaults
  lineStrokeColor: string;
  lineLineWidth: number;
  lineBorderStyle: string;
  lineOpacity: number;

  // Highlight defaults
  highlightColor: string;

  // Polygon defaults
  polygonFillColor: string;
  polygonFillNone: boolean;
  polygonStrokeColor: string;
  polygonLineWidth: number;
  polygonBorderStyle: string;
  polygonOpacity: number;

  // Cloud defaults
  cloudFillColor: string;
  cloudFillNone: boolean;
  cloudStrokeColor: string;
  cloudLineWidth: number;
  cloudBorderStyle: string;
  cloudOpacity: number;

  // Cloud Polyline defaults
  cloudPolylineStrokeColor: string;
  cloudPolylineLineWidth: number;
  cloudPolylineOpacity: number;

  // Comment/Note defaults
  commentColor: string;
  commentIcon: string;

  // Polyline defaults
  polylineStrokeColor: string;
  polylineLineWidth: number;
  polylineBorderStyle: string;
  polylineOpacity: number;

  // Filled Area defaults
  filledAreaStrokeColor: string;
  filledAreaFillColor: string;
  filledAreaFillNone: boolean;
  filledAreaLineWidth: number;
  filledAreaBorderStyle: string;
  filledAreaOpacity: number;
  filledAreaHatchPattern: string;
  filledAreaHatchColor: string;
  filledAreaHatchScale: number;
  filledAreaHatchAngle: number;

  // Symbol customisation
  symbolTypeOverrides: Record<string, { svg: string; name: string }>;

  // Redaction defaults
  redactionOverlayColor: string;

  // Measurement global
  measureRounding: string;
  measureCtrlSnap: number;

  // Measure Distance defaults
  measureDistStrokeColor: string;
  measureDistLineWidth: number;
  measureDistBorderStyle: string;
  measureDistOpacity: number;
  measureDistStartHead: string;
  measureDistEndHead: string;
  measureDistHeadSize: number;
  measureDistDimScale: number;
  measureDistDimUnit: string;
  measureDistDimPrecision: number;

  // Measure Area defaults
  measureAreaStrokeColor: string;
  measureAreaFillColor: string;
  measureAreaFillNone: boolean;
  measureAreaLineWidth: number;
  measureAreaBorderStyle: string;
  measureAreaOpacity: number;
  measureAreaDimScale: number;
  measureAreaDimUnit: string;
  measureAreaDimPrecision: number;

  // Measure Perimeter defaults
  measurePerimStrokeColor: string;
  measurePerimLineWidth: number;
  measurePerimBorderStyle: string;
  measurePerimOpacity: number;
  measurePerimStartHead: string;
  measurePerimEndHead: string;
  measurePerimHeadSize: number;
  measurePerimDimScale: number;
  measurePerimDimUnit: string;
  measurePerimDimPrecision: number;

  // Behavior
  autoSelectAfterCreate: boolean;
  confirmBeforeDelete: boolean;
  wheelZoomWithoutCtrl: boolean;

  // Startup
  restoreLastSession: boolean;
  dontAskDefaultPdf: boolean;

  // Screenshot annotate: intercept the system PrtScn key as a global hotkey
  interceptPrintScreen: boolean;

  // Display
  showHandles: boolean;
  handleSize: number;

  // View
  thinLines: boolean;
  showScrollbars: boolean;
  progressiveRender: boolean;

  // Panels
  propertiesPanelVisible: boolean;
  toolPaletteVisible: boolean;
  toolPaletteMode: string;
  toolPaletteFloatX: number;
  toolPaletteFloatY: number;

  paletteLeftOrder: string[];
  paletteRightOrder: string[];

  // Symbol palette
  symbolPaletteVisible: boolean;
  symbolPaletteMode: string;
  symbolPaletteFloatX: number;
  symbolPaletteFloatY: number;
  customSymbolGroups: Array<{ id: string; name: string; symbols: Array<{ id: string; name: string; svg: string }> }>;
  disabledSymbolGroups: string[];

  // Schedule
  scheduleTemplates: Array<{ name: string; groupBy: string; filterType: string; filterPage: number; created: number }>;

  // Feedback
  feedbackEmail: string;
  feedbackFullName: string;

  // Language
  language: string;

  // What's New dialog — last release version the user has acknowledged
  lastSeenReleaseVersion: string;
}
