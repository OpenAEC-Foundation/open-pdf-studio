import type { Preferences } from '../types/preferences.js';

// Handle types for annotation selection and manipulation
export const HANDLE_SIZE = 6;

export const HANDLE_TYPES = {
  MOVE: 'move',
  TOP_LEFT: 'tl',
  TOP_RIGHT: 'tr',
  BOTTOM_LEFT: 'bl',
  BOTTOM_RIGHT: 'br',
  TOP: 't',
  BOTTOM: 'b',
  LEFT: 'l',
  RIGHT: 'r',
  LINE_START: 'line_start',
  LINE_END: 'line_end',
  RADIUS: 'radius',
  ROTATE: 'rotate',
  CALLOUT_ARROW: 'callout_arrow',
  CALLOUT_KNEE: 'callout_knee',
  CALLOUT_MOVE: 'callout_move',
  POLYLINE_NODE: 'polyline_node',
  POLYLINE_EDGE: 'polyline_edge',
  LEADER_START: 'leader_start',
  LEADER_END: 'leader_end',
  LABEL_MOVE: 'label_move',
  // Textbox multi-leader handles. <id> is appended to encode the leader.
  LEADER_ADD: 'leader_add',
  LEADER_TIP: 'leader_tip',
  LEADER_KNEE: 'leader_knee',
  LEADER_DELETE: 'leader_delete',
  // ─── Grippoints (CAD-style stretch grips) ──────────────────────────────
  // These are emitted in addition to (or in place of) the resize handles
  // above. They drive the "grip stretch" interaction in select-tool: click
  // a grip → enter stretch mode anchored at the grip's original location.
  LINE_MID: 'line_mid',           // line/arrow midpoint → move whole line
  RECT_CENTER: 'rect_center',     // box/rect/textbox center → move whole shape
  CIRCLE_CENTER: 'circle_center', // circle center → move whole circle
  POLYLINE_EDGE_MID: 'polyline_edge_mid',
} as const;

// Default application preferences
export const DEFAULT_PREFERENCES: Preferences = {
  // Theme
  theme: 'default',

  // Enkelpagina is de standaard-weergavemodus; opgeslagen 'continuous'
  // (de kortstondige oude default, nergens instelbaar in de UI) wordt bij
  // het laden teruggezet (zie preferences.js).
  defaultViewMode: 'single',

  // General — authorName defaults to '' (resolved to OS username at load time)
  authorName: '',

  // Snapping — 45 means Shift snaps to 0/45/90/135…: horizontaal,
  // verticaal én diagonaal.
  angleSnapDegrees: 45,
  enableAngleSnap: true,

  // Grid snapping (gridSize is in user units = mm by default — converted to
  // app pixels via getMeasureScale at draw / snap time)
  gridSize: 10,
  enableGridSnap: false,
  showGrid: false,

  // Polar tracking (CAD-style angular guide while drawing)
  polarTrackingEnabled: false,
  polarIncrement: 45,        // degrees
  polarTolerance: 3,         // degrees of tolerance to engage snap

  // Object snapping
  enableObjectSnap: true,
  snapToEndpoints: true,
  snapToMidpoints: true,
  snapToCenters: true,
  snapToEdges: false,
  snapToIntersections: true,
  snapToPerpendicular: false,
  snapToQuadrant: false,
  snapToTangent: false,
  snapToNearest: false,
  showSnapTypeLabel: true,
  objectSnapRadius: 12,
  snapToPdfContent: true,
  // Alignment snapping for image annotations: while moving an image, its
  // edges/centres snap to the edges/centres of OTHER images (design-tool style
  // guide lines); while resizing, its width/height snaps to another image's
  // width/height ("equal width"). Uses objectSnapRadius as its tolerance.
  enableImageAlignSnap: true,
  // CAD behavior — keep drawing tool active after committing one annotation
  // so the user can place multiple in a row without re-selecting the tool.
  // Esc returns to select.
  keepToolActive: true,

  // Line tool 'continue' mode: after placing a line, the next line starts at
  // the previous line's endpoint (chained segments) until Esc/right-click.
  // Off by default. Toggled by a checkbox on the line tool. Reuses the same
  // chain mechanism as the wall tool.
  lineContinue: false,

  // Ribbon collapsed state: when true the ribbon body is hidden and only the
  // tab strip is shown (toggled by the chevron at the end of the tab strip).
  ribbonCollapsed: false,

  // Appearance
  defaultAnnotationColor: '#FF0000',
  defaultLineWidth: 2,
  defaultFontSize: 16,
  highlightOpacity: 50,

  // TextBox defaults — witte achtergrond, zodat een tekstvak op een drukke
  // (CAD-)ondergrond leesbaar is zonder eerst een vulling aan te zetten.
  textboxFillColor: '#FFFFFF',
  textboxFillNone: false,
  textboxStrokeColor: '#FF0000',
  textboxBorderWidth: 1,
  textboxBorderStyle: 'solid',
  textboxOpacity: 100,
  textboxFontSize: 8,

  // Callout defaults
  calloutFillColor: '#FFFBEB',
  calloutFillNone: false,
  calloutStrokeColor: '#FF0000',
  calloutBorderWidth: 1,
  calloutBorderStyle: 'solid',
  calloutOpacity: 100,
  calloutFontSize: 14,

  // Rectangle defaults
  rectFillColor: '#FFFBEB',
  rectFillNone: true,
  rectStrokeColor: '#FF0000',
  rectBorderWidth: 1,
  rectBorderStyle: 'solid',
  rectOpacity: 100,

  // Circle/Ellipse defaults
  circleFillColor: '#FFFBEB',
  circleFillNone: true,
  circleStrokeColor: '#FF0000',
  circleBorderWidth: 1,
  circleBorderStyle: 'solid',
  circleOpacity: 100,

  // Arrow defaults
  arrowFillColor: '#FF0000',
  arrowFillNone: true,
  arrowStrokeColor: '#FF0000',
  arrowLineWidth: 2,
  arrowBorderStyle: 'solid',
  arrowStartHead: 'none',
  arrowEndHead: 'open',
  arrowHeadSize: 10,
  arrowOpacity: 100,

  // Draw/Freehand defaults
  drawStrokeColor: '#FF0000',
  drawLineWidth: 2,
  drawOpacity: 100,

  // Line defaults
  lineStrokeColor: '#FF0000',
  lineLineWidth: 2,
  lineBorderStyle: 'solid',
  lineOpacity: 100,

  // Highlight defaults
  highlightColor: '#FFFF00',

  // Polygon defaults
  polygonFillColor: '#FFFBEB',
  polygonFillNone: true,
  polygonStrokeColor: '#FF0000',
  polygonLineWidth: 2,
  polygonBorderStyle: 'solid',
  polygonOpacity: 100,

  // Cloud defaults
  cloudFillColor: '#FFFBEB',
  cloudFillNone: true,
  cloudStrokeColor: '#FF0000',
  cloudLineWidth: 2,
  cloudBorderStyle: 'solid',
  cloudOpacity: 100,

  // Cloud Polyline defaults
  cloudPolylineStrokeColor: '#FF0000',
  cloudPolylineLineWidth: 2,
  cloudPolylineOpacity: 100,

  // Comment/Note defaults
  commentColor: '#FFFF00',
  commentIcon: 'comment',

  // Polyline defaults
  polylineStrokeColor: '#FF0000',
  polylineLineWidth: 2,
  polylineBorderStyle: 'solid',
  polylineOpacity: 100,

  // Redaction defaults
  redactionOverlayColor: '#000000',

  // Measurement global
  measureRounding: 'none', // 'none', '1', '5', '10'
  measureCtrlSnap: 10,

  // Measure Distance defaults
  measureDistStrokeColor: '#FF0000',
  measureDistLineWidth: 2,
  measureDistBorderStyle: 'solid',
  measureDistOpacity: 100,
  measureDistStartHead: 'openCircle',
  measureDistEndHead: 'openCircle',
  measureDistHeadSize: 12,
  measureDistDimScale: 1,
  measureDistDimUnit: 'mm',
  measureDistDimPrecision: 0,

  // Measure Area defaults
  measureAreaStrokeColor: '#0000FF',
  measureAreaFillColor: '#0000FF',
  measureAreaFillNone: true,
  measureAreaLineWidth: 2,
  measureAreaBorderStyle: 'solid',
  measureAreaOpacity: 100,
  measureAreaDimScale: 1,
  measureAreaDimUnit: 'mm',
  measureAreaDimPrecision: 2,

  // Filled Area defaults (user-drawn contour with arcs + holes, solid + hatch fill)
  filledAreaStrokeColor: '#000000',
  filledAreaFillColor: '#cccccc',
  filledAreaFillNone: false,
  filledAreaLineWidth: 1,
  filledAreaBorderStyle: 'solid',
  filledAreaOpacity: 100,
  filledAreaHatchPattern: 'none',
  filledAreaHatchColor: '#000000',
  filledAreaHatchScale: 100,
  filledAreaHatchAngle: 0,

  // Measure Perimeter defaults
  measurePerimStrokeColor: '#0000FF',
  measurePerimLineWidth: 2,
  measurePerimBorderStyle: 'solid',
  measurePerimOpacity: 100,
  measurePerimStartHead: 'none',
  measurePerimEndHead: 'none',
  measurePerimHeadSize: 12,
  measurePerimDimScale: 1,
  measurePerimDimUnit: 'mm',
  measurePerimDimPrecision: 2,

  // Behavior
  autoSelectAfterCreate: true,
  confirmBeforeDelete: true,
  wheelZoomWithoutCtrl: false,

  // Startup
  restoreLastSession: false,
  dontAskDefaultPdf: false,

  // Screenshot annotate: intercept the system PrtScn key as a global hotkey
  // (opt-in; off by default because a global hotkey is intrusive).
  interceptPrintScreen: false,

  // Display
  showHandles: true,
  handleSize: 8,

  // View
  thinLines: false,
  showScrollbars: false,
  // Zware raster-pagina's (grote content-stream, bv. CAD-tekeningen met
  // miljoenen segmenten) progressief tegel-voor-tegel invullen via de
  // multi-proces worker-pool: parallelle eerste render (sneller), geen
  // zwart scherm, hoofdthread blijft vrij. Uitzetbaar in Voorkeuren.
  progressiveRender: true,

  // Panels
  propertiesPanelVisible: true,
  toolPaletteVisible: true,
  toolPaletteMode: 'docked-left',
  toolPaletteFloatX: 200,
  toolPaletteFloatY: 150,

  paletteLeftOrder: [],
  paletteRightOrder: [],

  // Symbol palette
  symbolPaletteVisible: true,
  symbolPaletteMode: 'docked-right',
  symbolPaletteFloatX: 300,
  symbolPaletteFloatY: 150,
  customSymbolGroups: [],
  disabledSymbolGroups: [],
  parametricSymbolDefaults: {},

  // NL IFC-tekenlaag: tekeningtypen worden lazy geseed door
  // annotations/drafting-rules.js (migratieketen in js/drafting/tekeningtype.js).
  tekeningtypen: null,
  // User-edited symbol type geometry overrides, keyed by a hash of the
  // original symbol SVG. Each entry: { svg, name }. Applied whenever a stamp
  // of that type is placed or re-rendered.
  symbolTypeOverrides: {},

  // Schedule
  scheduleTemplates: [],

  // Feedback
  feedbackEmail: '',
  feedbackFullName: '',

  // Language
  language: 'auto',

  // What's New dialog — last release version the user has acknowledged
  lastSeenReleaseVersion: ''
};
