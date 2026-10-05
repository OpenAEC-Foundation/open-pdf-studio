import { state, getActiveDocument } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { getSelectionRectsForAnnotation, getSelectionQuadPoints, getSelectionTextDir } from './text-selection.js';
import { recordAdd } from '../core/undo-manager.js';

/**
 * Text Markup Annotations Module
 * Handles creation of text markup annotations (highlight, strikethrough, underline)
 */

/**
 * Creates a text markup annotation from the current selection
 * @param {string} type - 'textHighlight', 'textStrikethrough', or 'textUnderline'
 * @param {string} color - The annotation color
 * @param {number} opacity - The annotation opacity
 */
export function createTextMarkupAnnotation(type, color, opacity) {
  const rects = getSelectionRectsForAnnotation();
  if (rects.length === 0) return null;

  const quadPoints = getSelectionQuadPoints();
  if (quadPoints.length === 0) return null;

  // Get the page number from the first rect
  const pageNum = rects[0].page;

  // Calculate bounding box for the annotation
  const minX = Math.min(...rects.map(r => r.x));
  const minY = Math.min(...rects.map(r => r.y));
  const maxX = Math.max(...rects.map(r => r.x + r.width));
  const maxY = Math.max(...rects.map(r => r.y + r.height));

  // Reading direction of the selected text (#527): the rects are axis-aligned,
  // so without it the saver writes markups on vertical or upside-down text
  // across the text.
  const textDir = getSelectionTextDir();

  const annotation = createAnnotation({
    type: type,
    page: pageNum,
    // Bounding box
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    // QuadPoints for precise text areas
    quadPoints: quadPoints,
    // Individual rects for rendering
    rects: rects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
    ...(textDir !== null ? { textDir } : {}),
    // Appearance
    color: color,
    opacity: opacity
  });

  const doc = getActiveDocument();
  if (doc) doc.annotations.push(annotation);
  recordAdd(annotation);

  // Select the newly created annotation so Delete key works immediately
  if (doc) { doc.selectedAnnotations = [annotation]; doc.selectedAnnotation = annotation; }

  // Redraw
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  return annotation;
}

/**
 * Creates a callout annotation with a CURVED (round) leader line pointing at the
 * current text selection. Reuses the existing `callout` annotation model (a
 * FreeText box with an armOrigin -> knee -> arrowTip leader) but flags the leader
 * as `leaderStyle: 'curved'` so both the on-screen canvas and the saved
 * appearance stream draw a smooth Catmull-Rom spline instead of two straight
 * segments (ronde aanhaallijn — issue #281).
 *
 * The arrow tip is anchored to the selected text area; the balloon is placed just
 * off to one side and the knee is bowed perpendicular to the balloon->tip chord so
 * the leader visibly curves. The balloon starts empty so the user can type.
 *
 * @returns {Object|null} The created annotation, or null when there is no selection
 */
export function createCalloutFromSelection() {
  const rects = getSelectionRectsForAnnotation();
  if (rects.length === 0) return null;

  const pageNum = rects[0].page;

  // Bounding box of the selection (app annotation coords, scale=1, top-left origin)
  const selMinX = Math.min(...rects.map(r => r.x));
  const selMinY = Math.min(...rects.map(r => r.y));
  const selMaxX = Math.max(...rects.map(r => r.x + r.width));
  const selMaxY = Math.max(...rects.map(r => r.y + r.height));

  // Arrow tip = a point on the selection. Use the vertical centre of the left
  // edge so the leader points cleanly at the start of the selected text.
  const arrowX = selMinX;
  const arrowY = (selMinY + selMaxY) / 2;

  // Balloon dimensions and placement: offset up-left of the anchor, flipping to
  // the right when there is no room on the left.
  const boxW = 160;
  const boxH = 60;
  const gap = 48;
  let boxX = arrowX - gap - boxW;
  let boxY = arrowY - gap - boxH;
  if (boxX < 4) boxX = arrowX + gap;
  if (boxY < 4) boxY = 4;

  // Arm origin = connection point on the balloon edge nearest the anchor
  // (mirrors the callout tool's isArrowLeft convention).
  const isArrowLeft = arrowX < (boxX + boxW / 2);
  const armOriginX = isArrowLeft ? boxX : boxX + boxW;
  const armOriginY = Math.max(boxY, Math.min(boxY + boxH, arrowY));

  // Knee = midpoint of the arm-origin -> tip chord, pushed perpendicular so the
  // spline bows into a visible round curve (never collinear -> never straight).
  const midX = (armOriginX + arrowX) / 2;
  const midY = (armOriginY + arrowY) / 2;
  const chordDX = arrowX - armOriginX;
  const chordDY = arrowY - armOriginY;
  const chordLen = Math.hypot(chordDX, chordDY) || 1;
  const bow = Math.max(24, chordLen * 0.28);
  const kneeX = midX + (-chordDY / chordLen) * bow;
  const kneeY = midY + (chordDX / chordLen) * bow;

  const annotation = createAnnotation({
    type: 'callout',
    page: pageNum,
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    arrowX,
    arrowY,
    kneeX,
    kneeY,
    armOriginX,
    armOriginY,
    // Curved (round) leader flag — the whole point of this action.
    leaderStyle: 'curved',
    text: '',
    color: '#000000',
    strokeColor: '#000000',
    fillColor: '#FFFFD0',
    textColor: '#000000',
    fontSize: 14,
    fontFamily: 'Arial',
    lineWidth: 1,
    borderStyle: 'solid',
    opacity: 1
  });

  const doc = getActiveDocument();
  if (doc) doc.annotations.push(annotation);
  recordAdd(annotation);

  if (doc) { doc.selectedAnnotations = [annotation]; doc.selectedAnnotation = annotation; }

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // Start inline text editing so the user can type into the empty balloon.
  // Requires the select tool to be active to receive keyboard input.
  import('../tools/manager.js').then(m => {
    m.setTool('select');
    import('../tools/text-editing.js').then(({ startTextEditing }) => {
      startTextEditing(annotation);
    });
  });

  return annotation;
}

/**
 * Gets text markup annotation defaults by type
 * @param {string} type - The annotation type
 * @returns {Object} Default properties for the type
 */
export function getTextMarkupDefaults(type) {
  switch (type) {
    case 'textHighlight':
      return {
        color: '#FFFF00',
        opacity: 0.3
      };
    case 'textStrikethrough':
      return {
        color: '#FF0000',
        opacity: 1.0
      };
    case 'textUnderline':
      return {
        color: '#0000FF',
        opacity: 1.0
      };
    default:
      return {
        color: '#FFFF00',
        opacity: 0.5
      };
  }
}
