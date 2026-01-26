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
  CALLOUT_KNEE: 'callout_knee'
};

// Get system username for default author
export function getSystemUsername() {
  try {
    const os = window.require('os');
    return os.userInfo().username || 'User';
  } catch (e) {
    return 'User';
  }
}

// Default application preferences
export const DEFAULT_PREFERENCES = {
  // General
  authorName: getSystemUsername(),

  // Snapping
  angleSnapDegrees: 30,
  enableAngleSnap: true,

  // Grid snapping (for future use)
  gridSize: 10,
  enableGridSnap: false,

  // Appearance
  defaultAnnotationColor: '#ffff00',
  defaultLineWidth: 3,
  defaultFontSize: 16,
  highlightOpacity: 30, // percentage

  // TextBox defaults
  textboxFillColor: '#ffffd0',
  textboxFillNone: false,
  textboxStrokeColor: '#000000',
  textboxBorderWidth: 1,
  textboxBorderStyle: 'solid', // solid, dashed, dotted
  textboxOpacity: 100, // percentage
  textboxFontSize: 14,

  // Callout defaults
  calloutFillColor: '#ffffd0',
  calloutFillNone: false,
  calloutStrokeColor: '#000000',
  calloutBorderWidth: 1,
  calloutBorderStyle: 'solid', // solid, dashed, dotted
  calloutOpacity: 100, // percentage
  calloutFontSize: 14,

  // Rectangle defaults
  rectFillColor: '#ffff00',
  rectFillNone: true, // Default to no fill
  rectStrokeColor: '#000000',
  rectBorderWidth: 2,
  rectBorderStyle: 'solid',
  rectOpacity: 100,

  // Circle/Ellipse defaults
  circleFillColor: '#ffff00',
  circleFillNone: true, // Default to no fill
  circleStrokeColor: '#000000',
  circleBorderWidth: 2,
  circleBorderStyle: 'solid',
  circleOpacity: 100,

  // Arrow defaults
  arrowFillColor: '#0000ff', // Fill color for closed arrowheads
  arrowStrokeColor: '#0000ff',
  arrowLineWidth: 2,
  arrowBorderStyle: 'solid', // solid, dashed, dotted
  arrowStartHead: 'none', // none, open, closed, diamond, circle, square, slash
  arrowEndHead: 'open', // none, open, closed, diamond, circle, square, slash
  arrowHeadSize: 12,
  arrowOpacity: 100,

  // Behavior
  autoSelectAfterCreate: true,
  confirmBeforeDelete: true,

  // Startup
  restoreLastSession: false,

  // Display
  showHandles: true,
  handleSize: 8
};
