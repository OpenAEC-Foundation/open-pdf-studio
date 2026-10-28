export interface Preferences {
  // Theme
  theme: string;

  // Weergavemodus waarmee een document opent: 'continuous' (doorlopend,
  // de standaard voor nieuwe installaties) of 'single' (één pagina).
  defaultViewMode: 'continuous' | 'single';

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
  snapToVertices: boolean;
  snapToStartPoints: boolean;
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
  moveInferenceTracking: boolean;
  moveInferenceExtension: boolean;
  moveInferenceParallel: boolean;
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
  textboxFontFamily?: string;

  // Callout defaults
  calloutFillColor: string;
  calloutFillNone: boolean;
  calloutStrokeColor: string;
  calloutBorderWidth: number;
  calloutBorderStyle: string;
  calloutOpacity: number;
  calloutFontSize: number;
  calloutFontFamily?: string;

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
  drawPressure: boolean;
  drawPressureMinWidth: number;
  drawSmoothing: number;
  drawPenOnly: boolean;

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
  measureDecimalNotation: 'auto' | 'comma' | 'point';
  measureDigitGrouping: boolean;
  scaleCheckOkPercent: number;
  scaleCheckWarnPercent: number;

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
  measureAreaShowEdgeLengths: boolean;

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
  middleDoubleClickFit: boolean;
  ribbonWheelSwitchesTabs: boolean;

  // Startup
  restoreLastSession: boolean;
  dontAskDefaultPdf: boolean;

  // Zoeken: doorzoek de PDF-tekst en/of de tekst in annotaties
  searchInText: boolean;
  searchInAnnotations: boolean;

  // Screenshot annotate: intercept the system PrtScn key as a global hotkey
  interceptPrintScreen: boolean;

  // Home → Screenshot: the last choices in the capture dialog
  // (validated in tools/screenshot-keuze.js).
  screenshotResolution: 'screen' | 'custom' | number;
  screenshotCustomDpi: number;
  screenshotFormat: 'png' | 'jpeg';
  screenshotJpegQuality: number;
  screenshotDefaultAction: 'copy' | 'save';

  // AI-koppeling: lokale MCP-server voor AI-assistenten (Claude Desktop e.d.)
  mcpEnabled: boolean;
  mcpPort: number;

  // Display
  showHandles: boolean;
  handleSize: number;

  // View
  thinLines: boolean;
  readAloudVoice: string;
  readAloudRate: number;
  readAloudAllowOnline: boolean;
  showScrollbars: boolean;
  // '' = default, or '#rrggbb' (#859).
  pageBackgroundColor: string;
  progressiveRender: boolean;
  screenCalibration: Record<string, number>;
  zoomDpi: number;
  pageSharpen: number;
  paperSizeUnit: string;
  // Keyboard shortcuts changed by the user (#714): command id -> combinations.
  keyboardShortcuts: Record<string, string[]>;

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
  parametricSymbolDefaults: Record<string, Record<string, string | number | boolean>>;

  // NL IFC-tekenlaag: tekeningtypen (geversioneerde regelsets, zie
  // js/drafting/tekeningtype.js). null = nog niet geseed (lazy default).
  tekeningtypen: {
    version: number;
    defaultId: string;
    regelsets: Array<{
      id: string;
      name: string;
      textHeightsMm: Record<string, number>;
      lineWidthsMm: Record<string, Record<string, number>>;
      hatchByCategory?: Record<string, unknown>;
    }>;
  } | null;

  // Schedule
  scheduleTemplates: Array<{ name: string; groupBy: string; filterType: string; filterPage: number; created: number }>;

  // Feedback
  feedbackEmail: string;
  feedbackFullName: string;

  // Language
  language: string;

  // What's New dialog — last release version the user has acknowledged
  lastSeenReleaseVersion: string;

  // Print dialog — settings of the last print action (null = dialog defaults)
  printSettings: PrintSettings | null;

  // CAD export/import (#400) — last used settings (null = dialog defaults);
  // validated on read by cad-export-instellingen.js / cad-import-instellingen.js
  cadExportSettings: Record<string, unknown> | null;
  cadImportSettings: Record<string, unknown> | null;
  cadImportPresets: Array<{ name: string; settings: Record<string, unknown> }> | null;
  pdfxSettings: { profilePath: string | null; profileName: string; intent: string } | null;
}

export interface PrintSettings {
  printer: string;
  copies: number;
  collate: boolean;
  range: 'all' | 'current' | 'custom';
  customPages: string;
  subset: 'all' | 'odd' | 'even';
  reverseOrder: boolean;
  scaling: 'fit' | 'actual' | 'shrink' | 'custom-scale';
  zoom: number;
  autoRotate: boolean;
  autoCenter: boolean;
  content: 'doc-and-markups' | 'doc-only';
  asImage: boolean;
  colorMode?: 'color' | 'grayscale' | 'bw';
}
