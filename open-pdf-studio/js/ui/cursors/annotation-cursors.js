/**
 * Custom cursors for annotation hover — arrow pointer with a small
 * annotation-type icon badge in the bottom-right area.
 *
 * Each cursor is a 32×32 SVG encoded as a data-URI.  The arrow is at
 * the top-left and the badge sits at approximately (16,16)–(30,30).
 */

// Windows-style arrow cursor (matches the standard Windows aero pointer)
const ARROW = `<path d="M1,1 L1,16 L5,12 L8,19 L11,18 L8,11 L13,11 Z" fill="white" stroke="black" stroke-width="1" stroke-linejoin="miter"/>`;

function makeCursor(badgeSvg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${ARROW}${badgeSvg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 1 1, default`;
}

// --- Badge icons per annotation type (drawn in the 16×16 area at offset 16,16) ---

// Image: small landscape/mountain icon
const IMAGE_BADGE = `
  <rect x="16" y="18" width="14" height="11" rx="1" fill="white" stroke="#0066cc" stroke-width="1.2"/>
  <polyline points="17,27 21,23 24,25 27,21 29,24" fill="none" stroke="#0066cc" stroke-width="1"/>
  <circle cx="20" cy="22" r="1.5" fill="#0066cc"/>
`;

// Stamp: small stamp icon
const STAMP_BADGE = `
  <rect x="17" y="22" width="12" height="6" rx="1" fill="white" stroke="#cc6600" stroke-width="1.2"/>
  <line x1="23" y1="22" x2="23" y2="19" stroke="#cc6600" stroke-width="1.2"/>
  <rect x="20" y="17" width="6" height="3" rx="1" fill="white" stroke="#cc6600" stroke-width="1.2"/>
`;

// Textbox / FreeText: "T" icon
const TEXT_BADGE = `
  <rect x="16" y="18" width="14" height="11" rx="1" fill="white" stroke="#0066cc" stroke-width="1.2"/>
  <text x="23" y="27" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#0066cc" text-anchor="middle">T</text>
`;

// Comment / Sticky note: speech bubble
const COMMENT_BADGE = `
  <rect x="16" y="17" width="13" height="9" rx="2" fill="white" stroke="#cc9900" stroke-width="1.2"/>
  <polygon points="20,26 22,30 24,26" fill="white" stroke="#cc9900" stroke-width="1"/>
  <line x1="19" y1="21" x2="26" y2="21" stroke="#cc9900" stroke-width="0.8"/>
  <line x1="19" y1="23" x2="24" y2="23" stroke="#cc9900" stroke-width="0.8"/>
`;

// Highlight: marker pen
const HIGHLIGHT_BADGE = `
  <rect x="16" y="18" width="14" height="11" rx="1" fill="white" stroke="#cc0066" stroke-width="1.2"/>
  <rect x="19" y="21" width="8" height="4" rx="0.5" fill="#ffff00" stroke="#cc9900" stroke-width="0.8"/>
`;

// Box / Rectangle
const BOX_BADGE = `
  <rect x="16" y="18" width="14" height="11" rx="0" fill="white" stroke="#0066cc" stroke-width="1.4"/>
`;

// Circle / Ellipse
const CIRCLE_BADGE = `
  <ellipse cx="23" cy="24" rx="7" ry="5" fill="white" stroke="#0066cc" stroke-width="1.4"/>
`;

// Line (plain, no arrowhead)
const LINE_BADGE = `
  <line x1="16" y1="29" x2="30" y2="18" stroke="#0066cc" stroke-width="1.5"/>
`;

// Arrow (line with arrowhead)
const ARROW_BADGE = `
  <line x1="16" y1="29" x2="30" y2="18" stroke="#0066cc" stroke-width="1.5"/>
  <polygon points="30,18 26,19 28,22" fill="#0066cc"/>
`;

// Draw / Freehand
const DRAW_BADGE = `
  <path d="M17,28 Q20,20 23,24 Q26,28 29,19" fill="none" stroke="#0066cc" stroke-width="1.5" stroke-linecap="round"/>
`;

// Signature
const SIGNATURE_BADGE = `
  <rect x="16" y="18" width="14" height="11" rx="1" fill="white" stroke="#006633" stroke-width="1.2"/>
  <path d="M18,26 Q21,20 24,26 L28,22" fill="none" stroke="#006633" stroke-width="1.2" stroke-linecap="round"/>
`;

// Polygon / Cloud
const POLYGON_BADGE = `
  <polygon points="23,18 17,23 19,29 27,29 29,23" fill="white" stroke="#0066cc" stroke-width="1.2"/>
`;

// Polyline
const POLYLINE_BADGE = `
  <polyline points="16,28 20,20 25,26 30,19" fill="none" stroke="#0066cc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
`;

// Redaction
const REDACTION_BADGE = `
  <rect x="16" y="20" width="14" height="8" rx="0" fill="#333333" stroke="#000000" stroke-width="1"/>
`;

// Callout
const CALLOUT_BADGE = `
  <rect x="18" y="17" width="12" height="8" rx="1" fill="white" stroke="#0066cc" stroke-width="1.2"/>
  <polyline points="20,25 17,29 22,25" fill="white" stroke="#0066cc" stroke-width="1"/>
  <line x1="20" y1="20" x2="28" y2="20" stroke="#0066cc" stroke-width="0.7"/>
  <line x1="20" y1="22" x2="26" y2="22" stroke="#0066cc" stroke-width="0.7"/>
`;

// Measure
const MEASURE_BADGE = `
  <line x1="17" y1="28" x2="29" y2="19" stroke="#cc0000" stroke-width="1.2"/>
  <line x1="17" y1="26" x2="17" y2="30" stroke="#cc0000" stroke-width="1"/>
  <line x1="29" y1="17" x2="29" y2="21" stroke="#cc0000" stroke-width="1"/>
`;

// Text markup (highlight/underline/strikethrough) — "abc" with line
const TEXT_MARKUP_BADGE = `
  <text x="23" y="27" font-family="Arial,sans-serif" font-size="8" fill="#cc6600" text-anchor="middle">abc</text>
  <line x1="17" y1="28" x2="29" y2="28" stroke="#cc6600" stroke-width="1.2"/>
`;

// Inserted text (caret, #508): the insertion wedge
const CARET_BADGE = `
  <path d="M23,17 L29,29 L23,26 L17,29 Z" fill="#0066cc" stroke="white" stroke-width="0.8" stroke-linejoin="round"/>
`;

// Generic fallback: small dot
const GENERIC_BADGE = `
  <circle cx="23" cy="24" r="5" fill="white" stroke="#666666" stroke-width="1.2"/>
  <circle cx="23" cy="24" r="1.5" fill="#666666"/>
`;

// --- Map annotation types to badge SVG ---
const BADGE_MAP = {
  image:              IMAGE_BADGE,
  stamp:              STAMP_BADGE,
  signature:          SIGNATURE_BADGE,
  text:               TEXT_BADGE,
  textbox:            TEXT_BADGE,
  callout:            CALLOUT_BADGE,
  comment:            COMMENT_BADGE,
  highlight:          HIGHLIGHT_BADGE,
  box:                BOX_BADGE,
  circle:             CIRCLE_BADGE,
  line:               LINE_BADGE,
  arrow:              ARROW_BADGE,
  draw:               DRAW_BADGE,
  polygon:            POLYGON_BADGE,
  cloud:              POLYGON_BADGE,
  polyline:           POLYLINE_BADGE,
  cloudPolyline:      POLYLINE_BADGE,
  redaction:          REDACTION_BADGE,
  textHighlight:      TEXT_MARKUP_BADGE,
  textStrikethrough:  TEXT_MARKUP_BADGE,
  textUnderline:      TEXT_MARKUP_BADGE,
  caret:              CARET_BADGE,
  measureDistance:     MEASURE_BADGE,
  measureArea:        MEASURE_BADGE,
  measurePerimeter:   MEASURE_BADGE,
};

// Cache built cursor strings
const _cache = {};

/**
 * Get a CSS cursor value for hovering over an annotation of the given type.
 * Returns an arrow pointer with a small badge icon, or 'default' for unknown types.
 */
export function getAnnotationHoverCursor(annotationType) {
  if (_cache[annotationType]) return _cache[annotationType];
  const badge = BADGE_MAP[annotationType] || GENERIC_BADGE;
  const cursor = makeCursor(badge);
  _cache[annotationType] = cursor;
  return cursor;
}
