import { state, getPageRotation, getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { hexToColorArray } from '../utils/colors.js';
import { hasFill } from '../annotations/fill-utils.js';
import { layoutTextboxForExport } from '../annotations/rendering/shapes.js';
import { markDocumentSaved, updateWindowTitle } from '../ui/chrome/tabs.js';
import { isTauri, invoke, readBinaryFile, writeBinaryFile, saveFileDialog, unlockFile, lockFile } from '../core/platform.js';
import { getCachedPdfBytes, setCachedPdfBytes, hidePdfABar } from './loader.js';
import { PDFDocument, PDFString, PDFHexString, PDFName, PDFArray, PDFStream, degrees,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from 'pdf-lib';
import { getAnnotationStorage, getAnnotIdToFieldName } from './form-layer.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

// Sub-modules
import { hexToRgb, buildBorderStyle, computeAnnotFlags, mapFontToPdfName,
  ensureAcroFormFonts, stripPdfAMetadata, generateAppearanceStream } from './saver/utils.js';
import { saveTextEditsToPages } from './saver/text-edits.js';
import { saveWatermarksToPages } from './saver/watermarks.js';
import { saveBookmarksToOutline } from './saver/bookmarks.js';
import { saveStylePresetsToCatalog } from './saver/style-presets.js';
import { catmullRomSpline } from '../tools/tools/spline-tool.js';
import { catmullRomToBezier, splineArrowEndTangent } from '../annotations/spline-arrow-geometry.js';
import { buildFilledAreaAP, buildMeasureAreaAP, buildPolylineMeasureAP,
  buildMeasureDistanceAP, buildWallAP, buildCloudAP, buildSplineArrowAP,
  cloudRectOutlinePts, cloudPolyOutlinePts } from './saver/appearance-vectors.js';
import { computeWallShape, resolveWallMaterial } from '../annotations/rendering/walls.js';

// Wrap a vector /AP builder result (absolute-PDF-coord content + needsFont flag)
// into a Form XObject and set it as the annotation's /AP /N — same BBox/Matrix
// convention as the FreeText appearance path. `rect` is the annotation /Rect
// [x1,y1,x2,y2] the appearance is drawn against. Types that previously wrote NO
// appearance stream were invisible (or showed only a bare outline) in other PDF
// viewers, which rely on /AP; see issue #256.
function attachVectorAP(context, annotDict, built, rect) {
  if (!built || !built.content) return;
  const [x1, y1, x2, y2] = rect;
  const resources = {};
  if (built.needsFont) {
    resources.Font = context.obj({
      Helv: context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }),
    });
  }
  const apStream = context.stream(built.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(apStream) }));
}

// ── Rotated-page coordinate remap ──────────────────────────────────────────
// On a page with /Rotate 90/180/270 the annotation coordinates live in the
// DISPLAYED (rotated) visual space, but the PDF page box (CropBox) is unrotated.
// The save-time convert helpers only know the unrotated box, so without
// compensation the saved /Rect lands rotated and annotations drift on reopen
// (the loader, via pdf.js viewport, IS rotation-aware). We remap every visual
// coordinate into the UNROTATED page frame once, up front, so the existing
// convert + appearance code produces correct PDF coordinates for every type.
//
// The map is the inverse of pdf.js viewport.convertToViewportPoint, so that
// naiveConvert(remappedPoint) === rotationAwareConvert(originalPoint). cw/ch are
// the UNROTATED page-box width/height. rot 0 is identity (callers skip it), so
// non-rotated pages are completely unaffected.
function _rotVisualMapper(rot, cw, ch) {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return (x, y) => ({ x: y,      y: ch - x });
    case 180: return (x, y) => ({ x: cw - x, y: ch - y });
    case 270: return (x, y) => ({ x: cw - y, y: x });
    default:  return (x, y) => ({ x, y });
  }
}

// Map a rect's two corners and re-derive an axis-aligned rect (width/height
// swap under 90/270).
function _remapRect(obj, m) {
  const a = m(obj.x, obj.y);
  const b = m(obj.x + obj.width, obj.y + obj.height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
           width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function remapAnnotationForRotatedPage(annRaw, rot, cw, ch) {
  const m = _rotVisualMapper(rot, cw, ch);
  const ann = { ...annRaw };
  // Bounding rect (also covers box/circle/textbox/etc. dimensions).
  if (['x', 'y', 'width', 'height'].every(k => typeof ann[k] === 'number')) {
    Object.assign(ann, _remapRect(ann, m));
  } else if (typeof ann.x === 'number' && typeof ann.y === 'number') {
    Object.assign(ann, m(ann.x, ann.y));
  }
  // Scalar coordinate pairs.
  const PAIRS = [
    ['startX', 'startY'], ['endX', 'endY'], ['centerX', 'centerY'],
    ['arrowX', 'arrowY'], ['kneeX', 'kneeY'], ['armOriginX', 'armOriginY'],
    ['leaderStartX', 'leaderStartY'], ['leaderEndX', 'leaderEndY'],
    ['labelX', 'labelY'], ['cx', 'cy'],
  ];
  for (const [kx, ky] of PAIRS) {
    if (typeof ann[kx] === 'number' && typeof ann[ky] === 'number') {
      const p = m(ann[kx], ann[ky]); ann[kx] = p.x; ann[ky] = p.y;
    }
  }
  // Nested {x,y} objects.
  for (const k of ['vertex', 'point1', 'point2', 'at']) {
    const o = ann[k];
    if (o && typeof o.x === 'number' && typeof o.y === 'number') ann[k] = { ...o, ...m(o.x, o.y) };
  }
  // Arrays of {x,y} points.
  for (const k of ['points', 'path', 'controlPoints', 'vertices']) {
    if (Array.isArray(ann[k])) ann[k] = ann[k].map(p => ({ ...p, ...m(p.x, p.y) }));
  }
  // Holes: array of point rings.
  if (Array.isArray(ann.holes)) {
    ann.holes = ann.holes.map(r => Array.isArray(r) ? r.map(p => ({ ...p, ...m(p.x, p.y) })) : r);
  }
  // Text-markup rectangles (highlight/underline/strikeout quadpoints).
  if (Array.isArray(ann.rects)) {
    ann.rects = ann.rects.map(r => (typeof r.width === 'number') ? { ...r, ..._remapRect(r, m) } : r);
  }
  // Textbox multi-leaders.
  if (Array.isArray(ann.leaders)) {
    ann.leaders = ann.leaders.map(l => {
      const nl = { ...l };
      if (typeof l.tipX === 'number' && typeof l.tipY === 'number') { const p = m(l.tipX, l.tipY); nl.tipX = p.x; nl.tipY = p.y; }
      if (typeof l.kneeX === 'number' && typeof l.kneeY === 'number') { const p = m(l.kneeX, l.kneeY); nl.kneeX = p.x; nl.kneeY = p.y; }
      return nl;
    });
  }
  return ann;
}

// Save PDF with annotations
export async function savePDF(saveAsPath = null) {
  const activeDoc = getActiveDocument();
  const currentPath = activeDoc?.filePath;
  // Redirect to "Save As" for untitled docs. These now have a temp-file
  // `filePath` (so they render via the real pipeline), so we ALSO check the
  // `isUntitled` flag — otherwise "Save" would silently overwrite the temp
  // file and the user would never be asked where to keep their document.
  if ((!currentPath || activeDoc?.isUntitled) && !saveAsPath) {
    return await savePDFAs();
  }

  // Files opened from an email attachment live in Outlook's secure temp
  // cache. Outlook keeps a lock on that copy (in-place saves fail with a
  // sharing violation), and anything written there is invisible to the email
  // and cleaned up with the cache anyway. Route straight to "Save As", same
  // as untitled documents.
  const OUTLOOK_TEMP = /[\\/]INetCache[\\/]Content\.Outlook[\\/]|Microsoft\.OutlookForWindows/i;
  if (!saveAsPath && OUTLOOK_TEMP.test(currentPath)) {
    return await savePDFAs();
  }

  try {
    showLoading('Saving PDF...');

    // Get original PDF bytes (from cache or disk, with memory key fallback for untitled docs)
    let existingPdfBytes = getCachedPdfBytes(currentPath);
    if (!existingPdfBytes) {
      if (activeDoc) {
        existingPdfBytes = getCachedPdfBytes(`__memory__${activeDoc.id}`);
      }
    }
    if (!existingPdfBytes) {
      existingPdfBytes = await readBinaryFile(currentPath);
    }

    const pdfDocLib = await PDFDocument.load(existingPdfBytes);

    // Strip PDF/A metadata — saved file no longer conforms to PDF/A
    if (activeDoc && activeDoc.pdfaCompliance) {
      stripPdfAMetadata(pdfDocLib);
      activeDoc.pdfaCompliance = null;
      hidePdfABar();
    }

    // Get the PDF pages
    const pages = pdfDocLib.getPages();
    const context = pdfDocLib.context;

    // Persist interactive form field values from AnnotationStorage
    const storage = getAnnotationStorage();
    const fieldNameMap = getAnnotIdToFieldName();
    if (storage && storage.size > 0 && fieldNameMap.size > 0) {
      try {
        const form = pdfDocLib.getForm();
        for (const [annotId, fieldName] of fieldNameMap.entries()) {
          const storedValue = storage.getRawValue(annotId);
          if (storedValue === undefined) continue;
          try {
            const field = form.getField(fieldName);
            if (field instanceof PDFTextField) {
              field.setText(storedValue.value != null ? String(storedValue.value) : '');
            } else if (field instanceof PDFCheckBox) {
              storedValue.value ? field.check() : field.uncheck();
            } else if (field instanceof PDFDropdown) {
              if (storedValue.value != null) field.select(storedValue.value);
            } else if (field instanceof PDFRadioGroup) {
              if (storedValue.value != null) field.select(storedValue.value);
            } else if (field instanceof PDFOptionList) {
              if (storedValue.value != null) {
                const vals = Array.isArray(storedValue.value) ? storedValue.value : [storedValue.value];
                field.select(vals);
              }
            }
          } catch (fieldErr) {
            // Skip fields that can't be set (e.g. read-only, signature, etc.)
          }
        }
      } catch (formErr) {
        console.warn('Failed to persist form field values:', formErr);
      }
    }

    // Ensure AcroForm DR (Default Resources) has fonts for FreeText annotations.
    // PDF viewers resolve font names in DA strings through these resources.
    const doc = getActiveDocument();
    const docAnnotations = doc?.annotations || [];
    const ftAnnotations = docAnnotations.filter(a => a.type === 'textbox' || a.type === 'callout');
    if (ftAnnotations.length > 0) {
      // Collect all font names actually used
      const usedFonts = new Set();
      for (const ann of ftAnnotations) {
        usedFonts.add(mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic));
      }
      ensureAcroFormFonts(pdfDocLib, context, usedFonts);
    }

    // Group annotations by page
    const annotationsByPage = {};
    for (const ann of docAnnotations) {
      if (!annotationsByPage[ann.page]) {
        annotationsByPage[ann.page] = [];
      }
      annotationsByPage[ann.page].push(ann);
    }

    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageNum = pageIndex + 1;
      const page = pages[pageIndex];

      // Apply page rotation if set (combine with existing PDF rotation)
      const appRotation = getPageRotation(pageNum);
      if (appRotation) {
        const existingDeg = page.getRotation().angle;
        page.setRotation(degrees(existingDeg + appRotation));
      }

      // Total displayed rotation of this page (native /Rotate + any in-app
      // rotation just applied). Annotation coordinates are stored in this
      // rotated visual space; on rotated pages we remap them to the unrotated
      // page frame before writing so they don't drift on reopen.
      const pageRot = (((page.getRotation().angle) % 360) + 360) % 360;

      const pageAnnotations = annotationsByPage[pageNum] || [];

      // Build annotations array: keep existing annotations we don't handle (widgets, links, etc.)
      // and replace the ones we do with our document annotations (which is the source of truth)
      const handledSubtypes = new Set([
        '/Highlight', '/Underline', '/StrikeOut', '/Squiggly',
        '/Square', '/Circle', '/Line', '/Ink', '/PolyLine', '/Polygon',
        '/Text', '/FreeText', '/Stamp'
      ]);
      let annotsArray = [];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (annotsRef) {
        const lookedUp = context.lookup(annotsRef);
        if (lookedUp instanceof PDFArray) {
          for (const ref of lookedUp.asArray()) {
            const dict = context.lookup(ref);
            const subtype = dict?.get?.(PDFName.of('Subtype'))?.toString();
            if (!subtype || !handledSubtypes.has(subtype)) {
              annotsArray.push(ref); // Keep annotations we don't manage
            }
          }
        }
      }

      // Skip pages with no changes: no annotations from us and no existing handled annotations removed
      if (pageAnnotations.length === 0 && !annotsRef) continue;

      // Helpers to convert viewport coordinates back to PDF coordinates (handles CropBox offsets)
      const cropBox = page.getCropBox();
      const viewLeft = cropBox.x;
      const viewTop = cropBox.y + cropBox.height;
      const convertX = (canvasX) => canvasX + viewLeft;
      const convertY = (canvasY) => viewTop - canvasY;

      // Add our annotations
      for (const annRaw of pageAnnotations) {
        // On rotated pages, remap visual coords into the unrotated page frame
        // so the convert helpers below produce correct PDF coordinates. rot 0
        // returns the annotation unchanged (non-rotated pages untouched).
        const ann = pageRot ? remapAnnotationForRotatedPage(annRaw, pageRot, cropBox.width, cropBox.height) : annRaw;
        const colorArr = hexToColorArray(ann.color || '#000000');
        const opacity = ann.opacity !== undefined ? ann.opacity : 1;
        const borderWidth = ann.lineWidth ?? 2;

        let annotDict;

        switch (ann.type) {
          case 'highlight':
          case 'textHighlight':
          case 'textStrikethrough':
          case 'textUnderline':
          case 'textSquiggly': {
            // Text markup annotations
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);

            // Build QuadPoints from rects if available, otherwise from bounding box
            let quadPoints;
            if (ann.rects && ann.rects.length > 0) {
              quadPoints = [];
              for (const r of ann.rects) {
                const qx1 = convertX(r.x);
                const qx2 = convertX(r.x + r.width);
                const qy1 = convertY(r.y + r.height);
                const qy2 = convertY(r.y);
                quadPoints.push(qx1, qy2, qx2, qy2, qx1, qy1, qx2, qy1);
              }
            } else {
              quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
            }

            // Map type to PDF subtype
            let markupSubtype = 'Highlight';
            if (ann.type === 'textStrikethrough') markupSubtype = 'StrikeOut';
            else if (ann.type === 'textUnderline') markupSubtype = 'Underline';
            else if (ann.type === 'textSquiggly') markupSubtype = 'Squiggly';

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: markupSubtype,
              Rect: [x1, y1, x2, y2],
              QuadPoints: quadPoints,
              C: hexToColorArray(ann.fillColor || ann.color),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'mask': // wipeout — Square with white IC + OPS_Subtype (set below)
          case 'redaction': // redaction MARK — Square + OPS_Subtype (set below)
          case 'box': {
            // Square annotation
            let bx1 = convertX(ann.x);
            let by1 = convertY(ann.y + ann.height);
            let bx2 = convertX(ann.x + ann.width);
            let by2 = convertY(ann.y);

            // Expand Rect to axis-aligned bounding box of rotated shape
            if (ann.rotation) {
              const rad = ann.rotation * Math.PI / 180;
              const cos = Math.abs(Math.cos(rad));
              const sin = Math.abs(Math.sin(rad));
              const pw = Math.abs(bx2 - bx1);
              const ph = Math.abs(by2 - by1);
              const newW = pw * cos + ph * sin;
              const newH = pw * sin + ph * cos;
              const cx = (bx1 + bx2) / 2;
              const cy = (by1 + by2) / 2;
              bx1 = cx - newW / 2;
              bx2 = cx + newW / 2;
              by1 = cy - newH / 2;
              by2 = cy + newH / 2;
            }

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [bx1, by1, bx2, by2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            annDictObj.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            // Add interior color (fill) if specified
            if (hasFill(ann.fillColor)) {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }
            // Maskeer round-trips via the subtype key; other viewers see a
            // plain white-filled square (correct degradation).
            if (ann.type === 'mask') {
              annDictObj.OPS_Subtype = PDFString.of('mask');
              annDictObj.IC = hexToColorArray('#ffffff');
            }
            // Redaction MARK (not yet applied): round-trip via the subtype key so
            // pending marks survive save+reopen instead of being silently dropped.
            // Other viewers degrade to a plain filled square. (Applying a
            // redaction converts it to a permanent black box — see redaction.js.)
            if (ann.type === 'redaction') {
              const rcol = (typeof ann.overlayColor === 'string' && ann.overlayColor.startsWith('#')) ? ann.overlayColor : '#000000';
              annDictObj.OPS_Subtype = PDFString.of('redaction');
              annDictObj.IC = hexToColorArray(rcol);
            }

            if (ann.rotation) annDictObj.OPS_Rotation = ann.rotation;

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'circle': {
            // Circle annotation (ellipse)
            let ccx1 = convertX(ann.x);
            let ccy1 = convertY(ann.y + ann.height);
            let ccx2 = convertX(ann.x + ann.width);
            let ccy2 = convertY(ann.y);

            // Expand Rect to axis-aligned bounding box of rotated ellipse
            if (ann.rotation) {
              const rad = ann.rotation * Math.PI / 180;
              const cos = Math.abs(Math.cos(rad));
              const sin = Math.abs(Math.sin(rad));
              const pw = Math.abs(ccx2 - ccx1);
              const ph = Math.abs(ccy2 - ccy1);
              const newW = pw * cos + ph * sin;
              const newH = pw * sin + ph * cos;
              const cmx = (ccx1 + ccx2) / 2;
              const cmy = (ccy1 + ccy2) / 2;
              ccx1 = cmx - newW / 2;
              ccx2 = cmx + newW / 2;
              ccy1 = cmy - newH / 2;
              ccy2 = cmy + newH / 2;
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Circle',
              Rect: [ccx1, ccy1, ccx2, ccy2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            annDictObj.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            if (hasFill(ann.fillColor)) {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            if (ann.rotation) annDictObj.OPS_Rotation = ann.rotation;

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'line':
          case 'arrow': {
            // Line annotation (arrows use LE entries)
            const x1 = convertX(ann.startX);
            const y1 = convertY(ann.startY);
            const x2 = convertX(ann.endX);
            const y2 = convertY(ann.endY);

            const headSize = ann.headSize || 12;
            const padding = Math.max(borderWidth, headSize);
            const rectX1 = Math.min(x1, x2) - padding;
            const rectY1 = Math.min(y1, y2) - padding;
            const rectX2 = Math.max(x1, x2) + padding;
            const rectY2 = Math.max(y1, y2) + padding;

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const lineDict = {
              Type: 'Annot',
              Subtype: 'Line',
              Rect: [rectX1, rectY1, rectX2, rectY2],
              L: [x1, y1, x2, y2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            // Border style
            lineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            // Arrow line endings (LE)
            if (ann.type === 'arrow') {
              const mapHead = (h) => {
                switch (h) {
                  case 'open': return 'OpenArrow';
                  case 'closed': return 'ClosedArrow';
                  case 'diamond': return 'Diamond';
                  case 'circle': return 'Circle';
                  case 'square': return 'Square';
                  case 'slash': return 'Slash';
                  case 'butt': return 'Butt';
                  case 'openReversed': return 'ROpenArrow';
                  case 'closedReversed': return 'RClosedArrow';
                  default: return 'None';
                }
              };
              lineDict.LE = [PDFName.of(mapHead(ann.startHead)), PDFName.of(mapHead(ann.endHead))];

              // Interior color for closed arrowheads
              if (hasFill(ann.fillColor)) {
                lineDict.IC = hexToColorArray(ann.fillColor);
              }
            }

            annotDict = context.obj(lineDict);
            break;
          }

          case 'draw': {
            // Ink annotation (freehand drawing)
            if (!ann.path || ann.path.length < 2) continue;

            const inkList = [];
            for (const pt of ann.path) {
              inkList.push(convertX(pt.x));
              inkList.push(convertY(pt.y));
            }

            // Calculate bounding rect
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < inkList.length; i += 2) {
              minX = Math.min(minX, inkList[i]);
              maxX = Math.max(maxX, inkList[i]);
              minY = Math.min(minY, inkList[i + 1]);
              maxY = Math.max(maxY, inkList[i + 1]);
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const inkDict = {
              Type: 'Annot',
              Subtype: 'Ink',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              InkList: [inkList],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            inkDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(inkDict);
            break;
          }

          case 'arc': {
            // Approximate arc with polyline segments for PDF compatibility
            const arcSteps = 36;
            let arcSA = ann.startAngle, arcEA = ann.endAngle;
            if (arcEA < arcSA) arcEA += 2 * Math.PI;
            const arcVertices = [];
            let arcMinX = Infinity, arcMinY = Infinity, arcMaxX = -Infinity, arcMaxY = -Infinity;
            for (let i = 0; i <= arcSteps; i++) {
              const angle = arcSA + (arcEA - arcSA) * i / arcSteps;
              const px = convertX(ann.centerX + ann.radius * Math.cos(angle));
              const py = convertY(ann.centerY + ann.radius * Math.sin(angle));
              arcVertices.push(px, py);
              arcMinX = Math.min(arcMinX, px); arcMaxX = Math.max(arcMaxX, px);
              arcMinY = Math.min(arcMinY, py); arcMaxY = Math.max(arcMaxY, py);
            }

            const arcStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const arcDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [arcMinX - borderWidth, arcMinY - borderWidth, arcMaxX + borderWidth, arcMaxY + borderWidth],
              Vertices: arcVertices,
              C: arcStrokeColor,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('arc'),
              OPS_CenterX: ann.centerX,
              OPS_CenterY: ann.centerY,
              OPS_Radius: ann.radius,
              OPS_StartAngle: ann.startAngle,
              OPS_EndAngle: ann.endAngle
            };

            arcDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(arcDict);
            break;
          }

          case 'spline': {
            if (!ann.controlPoints || ann.controlPoints.length < 3) continue;

            const samples = catmullRomSpline(ann.controlPoints, 16);

            const splineVertices = [];
            let spMinX = Infinity, spMinY = Infinity, spMaxX = -Infinity, spMaxY = -Infinity;
            for (const sample of samples) {
              const px = convertX(sample.x);
              const py = convertY(sample.y);
              splineVertices.push(px, py);
              spMinX = Math.min(spMinX, px); spMaxX = Math.max(spMaxX, px);
              spMinY = Math.min(spMinY, py); spMaxY = Math.max(spMaxY, py);
            }

            const spStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            // Serialize control points as flat array for OPS_Points
            const opsPointsArr = [];
            for (const cp of ann.controlPoints) {
              opsPointsArr.push(convertX(cp.x), convertY(cp.y));
            }

            const splineDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [spMinX - borderWidth, spMinY - borderWidth, spMaxX + borderWidth, spMaxY + borderWidth],
              Vertices: splineVertices,
              C: spStrokeColor,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('spline'),
              OPS_Points: context.obj(opsPointsArr),
            };

            splineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(splineDict);
            break;
          }

          case 'splineArrow': {
            // Curved (spline) arrow — issue #267. Persisted as a PolyLine whose
            // /Vertices trace the smooth curve (so third-party viewers show the
            // bend, not a straight chord) with /LE line-endings for the
            // arrowhead. The clicked control points are stored in /OPS_Points so
            // OPDS reloads it as an editable spline arrow, and an explicit /AP
            // draws the curve + arrowhead for pixel-faithful rendering.
            if (!ann.points || ann.points.length < 2) continue;

            const saSamples = catmullRomSpline(ann.points, 16);
            const saVertices = [];
            let saMinX = Infinity, saMinY = Infinity, saMaxX = -Infinity, saMaxY = -Infinity;
            for (const s of saSamples) {
              const px = convertX(s.x);
              const py = convertY(s.y);
              saVertices.push(px, py);
              saMinX = Math.min(saMinX, px); saMaxX = Math.max(saMaxX, px);
              saMinY = Math.min(saMinY, py); saMaxY = Math.max(saMaxY, py);
            }

            const saStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const saHeadSize = ann.headSize || 8;
            const saPad = Math.max(borderWidth, saHeadSize) + 2;

            const saMapHead = (h) => {
              switch (h) {
                case 'open': return 'OpenArrow';
                case 'closed': return 'ClosedArrow';
                case 'diamond': return 'Diamond';
                case 'circle': return 'Circle';
                case 'square': return 'Square';
                case 'slash': return 'Slash';
                case 'butt': return 'Butt';
                case 'openReversed': return 'ROpenArrow';
                case 'closedReversed': return 'RClosedArrow';
                default: return 'None';
              }
            };

            // OPS_Points = clicked control points (app curve is rebuilt from these).
            const saOpsPoints = [];
            for (const cp of ann.points) saOpsPoints.push(convertX(cp.x), convertY(cp.y));

            const saRect = [saMinX - saPad, saMinY - saPad, saMaxX + saPad, saMaxY + saPad];
            const splineArrowDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: saRect,
              Vertices: saVertices,
              C: saStrokeColor,
              CA: opacity,
              LE: [PDFName.of(saMapHead(ann.startHead)), PDFName.of(saMapHead(ann.endHead || 'open'))],
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('splineArrow'),
              OPS_Points: context.obj(saOpsPoints),
              OPS_HeadSize: saHeadSize,
            };
            if (hasFill(ann.fillColor)) splineArrowDict.IC = hexToColorArray(ann.fillColor);
            splineArrowDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(splineArrowDict);

            attachVectorAP(context, annotDict, buildSplineArrowAP({
              points: ann.points, X: convertX, Y: convertY,
              strokeColorHex: ann.strokeColor || ann.color || '#000000',
              fillColorHex: ann.fillColor,
              lineWidth: borderWidth, borderStyle: ann.borderStyle,
              startHead: ann.startHead || 'none', endHead: ann.endHead || 'open',
              headSize: saHeadSize,
            }), saRect);
            break;
          }

          case 'polyline': {
            // PolyLine annotation
            if (!ann.points || ann.points.length < 2) continue;

            const vertices = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              vertices.push(px, py);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polylineDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              Vertices: vertices,
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            polylineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(polylineDict);
            break;
          }

          case 'polygon':
          case 'cloud':
          case 'cloudPolyline': {
            // Polygon annotation
            let polyVertices = [];
            let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity;

            if (ann.points && ann.points.length >= 3) {
              // Use stored points (from loaded PDF annotations)
              for (const pt of ann.points) {
                const px = convertX(pt.x);
                const py = convertY(pt.y);
                polyVertices.push(px, py);
                polyMinX = Math.min(polyMinX, px); polyMaxX = Math.max(polyMaxX, px);
                polyMinY = Math.min(polyMinY, py); polyMaxY = Math.max(polyMaxY, py);
              }
            } else {
              // Generate points from bounding box for regular polygon
              const cx = ann.x + ann.width / 2;
              const cy = ann.y + ann.height / 2;
              const rx = ann.width / 2;
              const ry = ann.height / 2;
              const sides = ann.sides || 6;

              for (let i = 0; i < sides; i++) {
                const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
                const px = convertX(cx + rx * Math.cos(angle));
                const py = convertY(cy + ry * Math.sin(angle));
                polyVertices.push(px, py);
                polyMinX = Math.min(polyMinX, px); polyMaxX = Math.max(polyMaxX, px);
                polyMinY = Math.min(polyMinY, py); polyMaxY = Math.max(polyMaxY, py);
              }
            }

            const polyStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polygonDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [polyMinX - borderWidth, polyMinY - borderWidth, polyMaxX + borderWidth, polyMaxY + borderWidth],
              Vertices: polyVertices,
              C: polyStrokeColor,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            polygonDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            if (hasFill(ann.fillColor)) {
              polygonDict.IC = hexToColorArray(ann.fillColor);
            }

            // Save custom subtype to distinguish cloud/cloudPolyline from polygon
            if (ann.type === 'cloud') {
              polygonDict.OPS_Subtype = PDFString.of('cloud');
            } else if (ann.type === 'cloudPolyline') {
              polygonDict.OPS_Subtype = PDFString.of('cloudPolyline');
            }

            annotDict = context.obj(polygonDict);

            // Vector /AP so the SCALLOPED cloud outline shows in other viewers.
            // Without it they synthesise a straight-edged polygon from /Vertices
            // and the cloud bumps are lost — issue #256. (Plain polygons keep
            // their native synthesis; only cloud types get the scallop AP.)
            if (ann.type === 'cloud' || ann.type === 'cloudPolyline') {
              const canRect = ann.width != null && ann.height != null;
              const hasPts = Array.isArray(ann.points) && ann.points.length >= 3;
              const kind = (ann.type === 'cloud' && canRect) ? 'rect' : 'poly';
              const puff = (ann.cloudIntensity !== undefined && ann.cloudIntensity <= 1) ? 9 : 15;
              const outline = kind === 'rect'
                ? cloudRectOutlinePts(ann.x, ann.y, ann.width, ann.height, puff)
                : (hasPts ? cloudPolyOutlinePts(ann.points, true) : null);
              if (outline && outline.length >= 3) {
                const oxs = outline.map(p => convertX(p.x));
                const oys = outline.map(p => convertY(p.y));
                const cRect = [Math.min(...oxs) - 2, Math.min(...oys) - 2, Math.max(...oxs) + 2, Math.max(...oys) + 2];
                annotDict.set(PDFName.of('Rect'), context.obj(cRect));
                attachVectorAP(context, annotDict, buildCloudAP({
                  kind, x: ann.x, y: ann.y, w: ann.width, h: ann.height, points: ann.points, puff,
                  X: convertX, Y: convertY, fillColorHex: ann.fillColor,
                  strokeColorHex: ann.strokeColor || ann.color || '#000000',
                  lineWidth: borderWidth, borderStyle: ann.borderStyle,
                }), cRect);
              }
            }
            break;
          }

          case 'text':
          case 'textbox':
          case 'callout': {
            // FreeText annotation
            const ftW = ann.width || 150;
            const ftH = ann.height || 50;
            const ftRotation = ann.rotation || 0;

            // Compute Rect
            // Rotation is ONE continuous transform for every angle: /Rect is always
            // the rotation-expanded axis-aligned bounding box of the rotated box.
            // (Previously 90/180/270 were special-cased to the UNexpanded box, but
            // the loader always inverse-rotates /Rect as if it were the expanded
            // bbox — at exactly 90/270° that swaps W/H and squashed the box on
            // reopen. See #285.) The renderer uses the same expanded-bbox convention.
            let x1, y1, x2, y2;
            if (ftRotation !== 0) {
              const cxDoc = convertX(ann.x + ftW / 2);
              const cyDoc = ann.y + ftH / 2;
              const rad = ftRotation * Math.PI / 180;
              const cosA = Math.abs(Math.cos(rad));
              const sinA = Math.abs(Math.sin(rad));
              const rotHalfW = (ftW / 2) * cosA + (ftH / 2) * sinA;
              const rotHalfH = (ftW / 2) * sinA + (ftH / 2) * cosA;
              x1 = cxDoc - rotHalfW;
              y1 = convertY(cyDoc + rotHalfH);
              x2 = cxDoc + rotHalfW;
              y2 = convertY(cyDoc - rotHalfH);
            } else {
              x1 = convertX(ann.x);
              y1 = convertY(ann.y + ftH);
              x2 = convertX(ann.x + ftW);
              y2 = convertY(ann.y);
            }

            const fontSize = ann.fontSize || 14;
            const textColorArr = ann.textColor ? hexToColorArray(ann.textColor) : [0, 0, 0];

            // Map font family + bold/italic to PDF standard font name
            const pdfFontName = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
            const da = `${textColorArr[0]} ${textColorArr[1]} ${textColorArr[2]} rg /${pdfFontName} ${fontSize} Tf`;

            // FreeText color mapping (must match loader):
            //   C entry  = fill/background color (annot.color in pdf.js)
            //   IC entry = stroke/border color (extraColors.ic in loader)
            const ftStrokeColorArr = (ann.strokeColor && ann.strokeColor !== 'none' && ann.strokeColor !== 'transparent')
              ? hexToColorArray(ann.strokeColor) : [0, 0, 0];
            // 'transparent' = NO fill (same as 'none'/null). Without this guard
            // hexToColorArray('transparent') → black, so /C was written black
            // and the textbox came back as a black box on reopen.
            const ftFillColorArr = (ann.fillColor && ann.fillColor !== 'none' && ann.fillColor !== 'transparent')
              ? hexToColorArray(ann.fillColor) : null;

            // Build DS (Default Style) string for better interop with other viewers
            const textColorCss = ann.textColor || '#000000';
            const dsFontFamily = ann.fontFamily || 'Arial';
            const dsLineHeight = ann.lineSpacing ? `line-height:${Math.round(fontSize * ann.lineSpacing * 100) / 100};` : '';
            const dsFontWeight = ann.fontBold ? 'font-weight:bold;' : '';
            const dsFontStyle = ann.fontItalic ? 'font-style:italic;' : '';
            const dsTextDecoration = ann.fontUnderline ? 'text-decoration:underline;' : '';
            const dsStr = `font-family:${dsFontFamily};font-size:${fontSize}pt;color:${textColorCss};${dsFontWeight}${dsFontStyle}${dsTextDecoration}${dsLineHeight}`;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'FreeText',
              Rect: [x1, y1, x2, y2],
              Contents: PDFString.of(ann.text || ''),
              DA: PDFString.of(da),
              DS: PDFString.of(dsStr),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            // Fill/background color in C (omit when transparent so loader reads no /C → fillColor=null)
            if (ftFillColorArr) {
              annDictObj.C = ftFillColorArr;
            }

            // Border style
            const ftBorderWidth = ann.lineWidth !== undefined ? ann.lineWidth : 1;
            annDictObj.BS = buildBorderStyle(context, ftBorderWidth, ann.borderStyle);

            // Stroke/border color in IC
            annDictObj.IC = ftStrokeColorArr;

            // Wolkrand-effect (/BE { /S /C /I intensiteit }) roundtrippen zodat
            // de ballon ook na opslaan+heropenen (en in externe viewers)
            // dezelfde wolkjes houdt.
            if (ann.borderEffect === 'cloudy') {
              annDictObj.BE = { S: 'C', I: ann.cloudIntensity !== undefined ? ann.cloudIntensity : 2 };
            }

            // Callout-specific data (set after context.obj for reliable PDF serialization)
            let calloutData = null;
            if (ann.type === 'callout' && ann.arrowX !== undefined) {
              const clArrowX = convertX(ann.arrowX);
              const clArrowY = convertY(ann.arrowY);
              const clKneeX = ann.kneeX !== undefined ? convertX(ann.kneeX) : clArrowX;
              const clKneeY = ann.kneeY !== undefined ? convertY(ann.kneeY) : clArrowY;
              const textConnectionX = ann.armOriginX !== undefined ? convertX(ann.armOriginX) : (ann.arrowX < (ann.x + ftW / 2) ? x1 : x2);
              const textConnectionY = ann.armOriginY !== undefined ? convertY(ann.armOriginY) : (y1 + y2) / 2;

              // Save original text box Rect before expanding
              const tbX1 = x1, tbY1 = y1, tbX2 = x2, tbY2 = y2;

              // Expand Rect to include all callout points (with padding for arrowhead)
              const clPad = 12;
              x1 = Math.min(x1, clArrowX - clPad, clKneeX, textConnectionX);
              y1 = Math.min(y1, clArrowY - clPad, clKneeY, textConnectionY);
              x2 = Math.max(x2, clArrowX + clPad, clKneeX, textConnectionX);
              y2 = Math.max(y2, clArrowY + clPad, clKneeY, textConnectionY);
              annDictObj.Rect = [x1, y1, x2, y2];

              calloutData = {
                cl: [clArrowX, clArrowY, clKneeX, clKneeY, textConnectionX, textConnectionY],
                rd: [tbX1 - x1, tbY1 - y1, x2 - tbX2, y2 - tbY2]
              };
            }

            // Rotation is baked into the appearance stream for EVERY angle (see
            // below), so we do NOT set the standard /Rotation key — that would make
            // spec-compliant viewers rotate the already-rotated AP a second time.
            // The exact angle round-trips via our private /OPS_Rotation key, which
            // is ALWAYS written (including 0) after annotDict is built: on pages
            // with /Rotate the AP content carries a page-compensation transform,
            // and without an explicit key the loader's matrix heuristic would
            // misread that compensation as annotation rotation.

            annotDict = context.obj(annDictObj);

            // Set callout entries explicitly using PDFName keys for reliable serialization
            if (calloutData) {
              annotDict.set(PDFName.of('CL'), context.obj(calloutData.cl));
              annotDict.set(PDFName.of('IT'), PDFName.of('FreeTextCallout'));
              annotDict.set(PDFName.of('LE'), PDFName.of('OpenArrow'));
              annotDict.set(PDFName.of('RD'), context.obj(calloutData.rd));
              // Round (curved) leader flag — private key so OPDS restores the
              // curved leader on reload. External viewers ignore it and fall back
              // to the straight /CL polyline.
              if (ann.leaderStyle === 'curved') {
                annotDict.set(PDFName.of('OPS_LeaderStyle'), PDFName.of('curved'));
              }
            }

            // Always generate AP stream so other viewers show correct colors
            {
              const isCallout = ann.type === 'callout' && ann.arrowX !== undefined;
              // Text box in absolute PDF coords
              const tbX1 = convertX(ann.x);
              const tbY1 = convertY(ann.y + ftH);
              const tbX2 = tbX1 + ftW;
              const tbY2 = tbY1 + ftH;

              let ftStreamContent = '';
              const [sr, sg, sb] = ann.strokeColor && ann.strokeColor !== 'none'
                ? hexToRgb(ann.strokeColor) : [0, 0, 0];

              // Draw callout leader line and arrowhead first (using absolute page coords)
              if (isCallout) {
                const clAX = convertX(ann.arrowX);
                const clAY = convertY(ann.arrowY);
                const clKX = ann.kneeX !== undefined ? convertX(ann.kneeX) : convertX(ann.arrowX);
                const clKY = ann.kneeY !== undefined ? convertY(ann.kneeY) : convertY(ann.arrowY);
                const clOX = ann.armOriginX !== undefined ? convertX(ann.armOriginX) : tbX1;
                const clOY = ann.armOriginY !== undefined ? convertY(ann.armOriginY) : (tbY1 + ftH / 2);

                const dashOp = ann.borderStyle === 'dashed' ? '[8 4] 0 d\n' : ann.borderStyle === 'dotted' ? '[2 2] 0 d\n' : '';
                ftStreamContent += `${sr} ${sg} ${sb} RG ${ftBorderWidth} w\n${dashOp}`;
                // Leader line. 'curved' = a smooth Catmull-Rom spline (as cubic
                // Bézier `c` operators) through [armOrigin, knee, tip] so the saved
                // appearance matches the on-screen round leader; otherwise two
                // straight segments. Points are already in PDF page coords, so the
                // affine Catmull-Rom→Bézier conversion yields the identical curve.
                const clCurved = ann.leaderStyle === 'curved';
                let aAngle;
                if (clCurved) {
                  const clPts = [
                    { x: clOX, y: clOY },
                    { x: clKX, y: clKY },
                    { x: clAX, y: clAY },
                  ];
                  const clSegs = catmullRomToBezier(clPts);
                  ftStreamContent += `${clOX} ${clOY} m `;
                  for (const s of clSegs) {
                    ftStreamContent += `${s.c1x} ${s.c1y} ${s.c2x} ${s.c2y} ${s.x1} ${s.y1} c `;
                  }
                  ftStreamContent += 'S\n';
                  aAngle = splineArrowEndTangent(clPts);
                } else {
                  // Leader line: armOrigin -> knee -> arrow tip
                  ftStreamContent += `${clOX} ${clOY} m ${clKX} ${clKY} l ${clAX} ${clAY} l S\n`;
                  aAngle = Math.atan2(clAY - clKY, clAX - clKX);
                }
                // Arrowhead at arrow tip (3-point open arrow: point1 -> tip -> point2)
                const aSize = 8;
                const ah1x = clAX - aSize * Math.cos(aAngle - Math.PI / 6);
                const ah1y = clAY - aSize * Math.sin(aAngle - Math.PI / 6);
                const ah2x = clAX - aSize * Math.cos(aAngle + Math.PI / 6);
                const ah2y = clAY - aSize * Math.sin(aAngle + Math.PI / 6);
                ftStreamContent += `${ah1x} ${ah1y} m ${clAX} ${clAY} l ${ah2x} ${ah2y} l S\n`;
              }

              // Draw text box fill + stroke (absolute coords)
              const ftDashOp = ann.borderStyle === 'dashed' ? '[8 4] 0 d\n' : ann.borderStyle === 'dotted' ? '[2 2] 0 d\n' : '';
              // A border is drawn ONLY when the textbox actually has one. Without
              // this the AP always stroked the rect — with `0 w` (hairline) and a
              // black fallback colour when strokeColor was 'none' — so other
              // viewers showed a spurious black box around every borderless label.
              const ftHasBorder = ftBorderWidth > 0 && ann.strokeColor && ann.strokeColor !== 'none' && ann.strokeColor !== 'transparent';
              const ftFill = hasFill(ann.fillColor);
              // Rect paint operator: B=fill+stroke, f=fill only, S=stroke only, n=neither.
              const ftRectOp = (ftFill && ftHasBorder) ? 'B' : ftFill ? 'f' : ftHasBorder ? 'S' : 'n';
              // The AP content lives in UNROTATED PDF page space, but the page
              // may carry /Rotate: viewers rotate the whole page — including
              // this appearance — for display. The content therefore needs the
              // page rotation compensated ON TOP of the annotation's own
              // visual rotation. Without this, text saved on a /Rotate 90/270
              // page reads sideways in every viewer after reopen.
              // Effective CCW angle in PDF space = pageRot - ftRotation (the
              // loader heuristic derives visual = -(angle - pageRot), which
              // round-trips back to ftRotation).
              const apRotation = (((ftRotation - pageRot) % 360) + 360) % 360;
              // Visual box dimensions: on 90/270-rotated pages the remapped
              // ftW/ftH are the PDF-space (swapped) dims; the drawn box and
              // the text layout must use the on-screen ones.
              const pageSwapsDims = pageRot === 90 || pageRot === 270;
              const visW = pageSwapsDims ? ftH : ftW;
              const visH = pageSwapsDims ? ftW : ftH;
              const emitFtBox = (bx, by) => {
                if (ftFill) {
                  const [fr, fg, fb] = hexToRgb(ann.fillColor);
                  ftStreamContent += `${fr} ${fg} ${fb} rg\n`;
                }
                if (ftHasBorder) {
                  ftStreamContent += `${ftBorderWidth} w\n${ftDashOp}${sr} ${sg} ${sb} RG\n`;
                }
                ftStreamContent += `${bx} ${by} ${visW} ${visH} re ${ftRectOp}\n`;
              };
              // Wrap in a transform whenever the content is rotated in PDF
              // space OR the page itself is rotated (then the visual box dims
              // differ from the PDF-space Rect even at effective angle 0,
              // e.g. visual rotation 90 on a /Rotate 90 page).
              const needsRotationInAP = apRotation !== 0 || pageRot !== 0;
              if (needsRotationInAP) {
                const rad = -apRotation * Math.PI / 180;
                // Round: right angles must serialise as exact 0/±1 — raw
                // Math.cos(±270°) yields 6.1e-17 and exponent notation is not
                // a valid number in PDF content streams.
                const cosR = Math.round(Math.cos(rad) * 1e6) / 1e6;
                const sinR = Math.round(Math.sin(rad) * 1e6) / 1e6;
                const bboxCX = tbX1 + ftW / 2;
                const bboxCY = tbY1 + ftH / 2;
                ftStreamContent += 'q\n';
                ftStreamContent += `1 0 0 1 ${bboxCX} ${bboxCY} cm\n`;
                ftStreamContent += `${cosR} ${sinR} ${-sinR} ${cosR} 0 0 cm\n`;
                ftStreamContent += `1 0 0 1 ${-visW / 2} ${-visH / 2} cm\n`;
                emitFtBox(0, 0);
              } else {
                emitFtBox(tbX1, tbY1);
                // Clip text to text box area
                ftStreamContent += `${tbX1} ${tbY1} ${ftW} ${ftH} re W n\n`;
              }

              // Render text — word-wrapped to the box width to match OPDS's own
              // on-screen layout (same font chain, wrap points, line height and
              // baseline), so other viewers break + place lines identically and
              // long labels no longer overflow the box.
              if (ann.text) {
                const ftFontSize = ann.fontSize || 14;
                const [tr, tg, tb] = ann.textColor ? hexToRgb(ann.textColor) : [0, 0, 0];
                const pdfFont = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
                // Word-wrap against the on-screen (visual) box width — on
                // 90/270-rotated pages ann.width/height were remapped into
                // PDF space and would wrap against the wrong dimension.
                const layout = layoutTextboxForExport(
                  pageSwapsDims ? { ...ann, width: visW, height: visH } : ann);
                const pad = layout.padding;
                const lineHeight = layout.lineHeight;
                const align = ann.textAlign || 'left';
                // Frame: local 0,0 bottom-left when rotated, else absolute coords.
                const boxLeft = needsRotationInAP ? 0 : tbX1;
                const boxTop = needsRotationInAP ? visH : tbY2;
                const bottomLimit = needsRotationInAP ? 0 : tbY1;
                let textY = boxTop - pad - layout.halfLeading - layout.ascent;

                ftStreamContent += 'BT\n';
                ftStreamContent += `${ann.textColor ? `${tr} ${tg} ${tb}` : '0 0 0'} rg 0 Tc 0 Tw 100 Tz 0 Tr\n`;
                ftStreamContent += `/${pdfFont} ${ftFontSize} Tf\n`;
                for (const ln of layout.lines) {
                  if (textY < bottomLimit) break;
                  let textX = boxLeft + pad;
                  if (align === 'center') textX = boxLeft + pad + (layout.maxWidth - ln.width) / 2;
                  else if (align === 'right') textX = boxLeft + visW - pad - ln.width;
                  const escaped = ln.text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  ftStreamContent += `${textX} ${textY} Td\n(${escaped}) Tj\n`;
                  ftStreamContent += `${-textX} ${-textY} Td\n`;
                  textY -= lineHeight;
                }
                ftStreamContent += 'ET\n';
              }

              if (needsRotationInAP) {
                ftStreamContent += 'Q\n';
              }

              // Create font dict for resources
              const pdfFont = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
              const fontDict = context.obj({
                Type: 'Font',
                Subtype: 'Type1',
                BaseFont: pdfFont,
                Encoding: 'WinAnsiEncoding'
              });

              // Use absolute BBox (same as Rect) with Matrix to translate origin
              const apStreamDict = {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [x1, y1, x2, y2],
                Matrix: [1, 0, 0, 1, -x1, -y1],
                Resources: context.obj({
                  Font: context.obj({ [pdfFont]: fontDict })
                })
              };

              const ftApStream = context.stream(ftStreamContent, apStreamDict);
              const ftApRef = context.register(ftApStream);
              const ftApDict = context.obj({ N: ftApRef });
              annotDict.set(PDFName.of('AP'), ftApDict);

              // Store the exact VISUAL angle for our loader to recover.
              // ALWAYS written — including 0: on /Rotate'd pages the AP
              // content above carries a page-compensation transform, and
              // without an explicit key the loader's matrix heuristic would
              // misread that compensation as annotation rotation.
              annotDict.set(PDFName.of('OPS_Rotation'), context.obj(ftRotation));
            }

            break;
          }

          case 'comment': {
            // Text annotation (sticky note)
            const x = convertX(ann.x);
            const y = convertY(ann.y);

            // Map internal icon name to PDF /Name value
            const iconNameMap = {
              comment: 'Comment', note: 'Note', help: 'Help',
              insert: 'Insert', key: 'Key', newparagraph: 'NewParagraph',
              paragraph: 'Paragraph', check: 'Check', circle: 'Circle',
              cross: 'Cross', star: 'Star'
            };
            const pdfIconName = iconNameMap[(ann.icon || 'comment').toLowerCase()] || 'Comment';

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Text',
              Rect: [x, y - 24, x + 24, y],
              Contents: PDFString.of(ann.text || ann.comment || ''),
              C: hexToColorArray(ann.color || '#FFFF00'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              Name: pdfIconName,
              Open: ann.popupOpen || false,
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'stamp': {
            // Stamp annotation — with or without embedded image
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);

            // Map app stamp names to PDF spec standard names (ISO 32000-1 Table 181)
            const stdStampNames = {
              'Approved': 'Approved', 'Rejected': 'NotApproved', 'Not Approved': 'NotApproved',
              'Draft': 'Draft', 'Confidential': 'Confidential', 'Final': 'Final',
              'For Review': 'ForComment', 'Void': 'Expired', 'As Is': 'AsIs', 'Revised': 'Experimental'
            };
            const pdfStampName = stdStampNames[ann.stampName] || ann.stampName || 'Draft';

            const stampDictObj = {
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: pdfStampName,
              Subj: PDFString.of(ann.stampName || pdfStampName),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              NM: PDFString.of('stamp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
              F: computeAnnotFlags(ann)
            };
            stampDictObj.IT = PDFName.of('Stamp');

            if (ann.rotation) stampDictObj.OPS_Rotation = ann.rotation;
            if (ann.stampName) stampDictObj.OPS_StampName = PDFString.of(ann.stampName);
            // Linked image (an image that round-tripped as a stamp keeps
            // its source path across saves). Hex string: literal PDFString
            // would corrupt Windows backslashes (\r, \n... are escapes).
            if (ann.linkedPath) stampDictObj.OPS_LinkedPath = PDFHexString.fromText(ann.linkedPath);

            annotDict = context.obj(stampDictObj);

            // Generate AP stream for text-only stamps
            if (!ann.imageData && ann.stampText) {
              const w = ann.width;
              const h = ann.height;
              const [sr, sg, sb] = hexToRgb(ann.stampColor || ann.color || '#ef4444');
              const fontSize = Math.min(h * 0.45, 22);
              const textW = ann.stampText.length * fontSize * 0.58;
              const textX = (w - textW) / 2;
              const textY = (h - fontSize) / 2.4;
              const escaped = ann.stampText.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
              const k = 0.5522847498;
              const r = Math.min(w, h) * 0.15;
              const rrect = (rx, ry, rw, rh, cr) => {
                const kr = cr * k;
                return `${rx+cr} ${ry} m ${rx+rw-cr} ${ry} l ${rx+rw-cr+kr} ${ry} ${rx+rw} ${ry+cr-kr} ${rx+rw} ${ry+cr} c ` +
                  `${rx+rw} ${ry+rh-cr} l ${rx+rw} ${ry+rh-cr+kr} ${rx+rw-cr+kr} ${ry+rh} ${rx+rw-cr} ${ry+rh} c ` +
                  `${rx+cr} ${ry+rh} l ${rx+cr-kr} ${ry+rh} ${rx} ${ry+rh-cr+kr} ${rx} ${ry+rh-cr} c ` +
                  `${rx} ${ry+cr} l ${rx} ${ry+cr-kr} ${rx+cr-kr} ${ry} ${rx+cr} ${ry} c h\n`;
              };
              let s = `q\n2 w ${sr} ${sg} ${sb} RG\n${rrect(0, 0, w, h, r)}S\n`;
              s += `BT\n/F1 ${fontSize} Tf\n${sr} ${sg} ${sb} rg\n${textX} ${textY} Td\n(${escaped}) Tj\nET\nQ\n`;
              const fontDict = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold', Encoding: 'WinAnsiEncoding' });
              const apStream = context.stream(s, {
                Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
                Resources: context.obj({ Font: context.obj({ F1: fontDict }) })
              });
              const apStreamRef = context.register(apStream);
              annotDict.set(PDFName.of('AP'), context.obj({ N: apStreamRef }));
            }

            // Embed image data if present (e.g. north arrow, custom stamps)
            if (ann.imageData) {
              try {
                let embeddedImage;
                const dataUrl = ann.imageData;
                if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedJpg(bytes);
                } else {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedPng(bytes);
                }

                const imageRef = embeddedImage.ref;
                const w = ann.width;
                const h = ann.height;
                const alpha = ann.opacity !== undefined ? ann.opacity : 1;
                let apContent;
                const resources = { XObject: context.obj({ Img: imageRef }) };

                if (alpha < 1) {
                  const gsDict = context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
                  const gsRef = context.register(gsDict);
                  resources.ExtGState = context.obj({ GS0: gsRef });
                  apContent = `q\n/GS0 gs\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                } else {
                  apContent = `q\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                }

                const apStream = context.stream(
                  apContent,
                  {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: [0, 0, w, h],
                    Resources: context.obj(resources)
                  }
                );
                const apStreamRef = context.register(apStream);
                const apDict = context.obj({ N: apStreamRef });
                annotDict.set(PDFName.of('AP'), apDict);
              } catch (imgErr) {
                console.warn('Failed to embed stamp image:', imgErr);
              }
            }
            break;
          }

          case 'image':
          case 'signature': {
            // Save image/signature as Stamp annotation with embedded image AP stream
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);
            const w = ann.width;
            const h = ann.height;

            const imgDictObj = {
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: ann.type === 'signature' ? 'Signature' : (ann.stampName || 'Image'),
              Contents: PDFString.of(ann.type === 'signature' ? 'Signature' : (ann.stampText || ann.subject || '')),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            if (ann.rotation) imgDictObj.OPS_Rotation = ann.rotation;
            // Linked image: store the source path so the app refreshes the
            // bitmap from disk on reopen (the embed below stays as a
            // self-contained fallback for other viewers). Hex string: literal
            // PDFString would corrupt Windows backslashes (\r, \n... are escapes).
            if (ann.linkedPath) imgDictObj.OPS_LinkedPath = PDFHexString.fromText(ann.linkedPath);
            // Colour tint (compare-overlays): private key so the app restores
            // the editable tint on reopen; the AP stream below additionally
            // bakes a Multiply fill so other viewers show the tint too.
            const imgTint = (ann.tintColor && ann.tintColor !== 'none') ? ann.tintColor : null;
            if (imgTint) imgDictObj.OPS_TintColor = PDFString.of(imgTint);

            // Non-destructive crop (issue #212): fractions 0-1 trimmed per
            // side. Round-trip via OPS_Crop* keys; the AP below draws the
            // FULL image shifted/scaled behind a clip so other viewers show
            // the cropped result while the embedded bitmap stays complete.
            const cropL = Math.max(0, Math.min(0.95, ann.cropLeft || 0));
            const cropT = Math.max(0, Math.min(0.95, ann.cropTop || 0));
            const cropR = Math.max(0, Math.min(0.95, ann.cropRight || 0));
            const cropB = Math.max(0, Math.min(0.95, ann.cropBottom || 0));
            const hasCrop = ann.type === 'image' && (cropL || cropT || cropR || cropB) &&
              (cropL + cropR) < 1 && (cropT + cropB) < 1;
            if (hasCrop) {
              imgDictObj.OPS_CropLeft = cropL;
              imgDictObj.OPS_CropTop = cropT;
              imgDictObj.OPS_CropRight = cropR;
              imgDictObj.OPS_CropBottom = cropB;
            }

            // Word-style image adjustments (grayscale / brightness / contrast).
            // These have no direct PDF operator, so — like the editable tint —
            // the EMBEDDED bitmap stays pristine and the values round-trip via
            // private OPS_ keys; the app re-applies them at render time (canvas
            // filter). Baking into the bitmap would double-apply on reopen (the
            // loader re-reads the embedded bitmap into ann.imageData), so we
            // deliberately keep it unfiltered. Trade-off: third-party viewers
            // show the unadjusted image — acceptable for V1.
            if (ann.grayscale) imgDictObj.OPS_Grayscale = true;
            if (ann.brightness !== undefined && ann.brightness !== 1) imgDictObj.OPS_Brightness = ann.brightness;
            if (ann.contrast !== undefined && ann.contrast !== 1) imgDictObj.OPS_Contrast = ann.contrast;

            annotDict = context.obj(imgDictObj);

            // Embed the actual image data into the appearance stream
            if (ann.imageData) {
              try {
                let embeddedImage;
                const dataUrl = ann.imageData;
                if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedJpg(bytes);
                } else {
                  // Default to PNG (covers data:image/png and other formats)
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedPng(bytes);
                }

                const imageRef = embeddedImage.ref;

                // Build AP stream content with opacity via ExtGState
                const alpha = ann.opacity !== undefined ? ann.opacity : 1;
                let apContent;
                const resources = { XObject: context.obj({ Img: imageRef }) };
                const extGStates = {};

                // Crop-aware image matrix: scale the full image up so the
                // visible source window maps exactly onto [0,w]x[0,h], then
                // clip to that rect. Image space: top row sits at v=1, so
                // cropTop trims from the v=1 side and cropBottom from v=0.
                let imgOps;
                if (hasCrop) {
                  const r4 = (n) => Number(n.toFixed(4));
                  const sw = w / (1 - cropL - cropR);
                  const sh = h / (1 - cropT - cropB);
                  const ox = -cropL * sw;
                  const oy = -cropB * sh;
                  imgOps = `0 0 ${r4(w)} ${r4(h)} re W n\n${r4(sw)} 0 0 ${r4(sh)} ${r4(ox)} ${r4(oy)} cm\n/Img Do`;
                } else {
                  imgOps = `${w} 0 0 ${h} 0 0 cm\n/Img Do`;
                }

                if (alpha < 1) {
                  const gsDict = context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
                  // Accumulator-patroon (GS0 hier, GS1 voor tint verderop);
                  // resources.ExtGState wordt na afloop uit `extGStates` gezet.
                  // Crop-bewuste `imgOps` i.p.v. de volledige-beeld-cm.
                  extGStates.GS0 = context.register(gsDict);
                  apContent = `q\n/GS0 gs\n${imgOps}\nQ\n`;
                } else {
                  apContent = `q\n${imgOps}\nQ\n`;
                }

                // Colour tint: Multiply-blend fill over the image, so other
                // viewers render the same tint while the embedded bitmap
                // itself stays unmodified (round-trips untinted).
                if (imgTint) {
                  const [tintR, tintG, tintB] = hexToRgb(imgTint);
                  const tintGs = context.obj({
                    Type: 'ExtGState', BM: PDFName.of('Multiply'), ca: alpha, CA: alpha,
                  });
                  extGStates.GS1 = context.register(tintGs);
                  apContent += `q\n/GS1 gs\n${tintR} ${tintG} ${tintB} rg\n0 0 ${w} ${h} re f\nQ\n`;
                }
                if (Object.keys(extGStates).length > 0) {
                  resources.ExtGState = context.obj(extGStates);
                }

                // Create Form XObject that draws the image scaled to annotation size
                const apStream = context.stream(
                  apContent,
                  {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: [0, 0, w, h],
                    Resources: context.obj(resources)
                  }
                );
                const apStreamRef = context.register(apStream);
                const apDict = context.obj({ N: apStreamRef });
                annotDict.set(PDFName.of('AP'), apDict);
              } catch (imgErr) {
                console.warn('Failed to embed image in annotation:', imgErr);
              }
            }
            break;
          }

          case 'scaleRegion': {
            const srx1 = convertX(ann.x);
            const sry1 = convertY(ann.y + ann.height);
            const srx2 = convertX(ann.x + ann.width);
            const sry2 = convertY(ann.y);
            const srDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [srx1, sry1, srx2, sry2],
              C: hexToColorArray(ann.color || '#ff9800'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.label || ''),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('scaleRegion'),
              OPS_ScaleString: PDFString.of(ann.scaleString || '1:100'),
              OPS_Units: PDFString.of(ann.units || 'mm'),
              F: computeAnnotFlags(ann)
            };
            if (ann.label) srDict.OPS_Label = PDFString.of(ann.label);
            // Numeric ratio for forward-compat (denominator of 1:N)
            const m = String(ann.scaleString || '').match(/1\s*[:/]\s*(\d+(?:\.\d+)?)/);
            if (m) srDict.OPS_ScaleRatio = 1 / parseFloat(m[1]);
            if (ann.lineWidth) srDict.OPS_LineWidth = ann.lineWidth;
            annotDict = context.obj(srDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, ann.lineWidth || 1.5, 'dashed'));
            break;
          }

          case 'viewport': {
            const vpx1 = convertX(ann.x);
            const vpy1 = convertY(ann.y + ann.height);
            const vpx2 = convertX(ann.x + ann.width);
            const vpy2 = convertY(ann.y);
            const vpDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [vpx1, vpy1, vpx2, vpy2],
              C: hexToColorArray(ann.color || '#0066cc'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.name || 'Viewport'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('viewport'),
              F: computeAnnotFlags(ann)
            };
            if (ann.pixelsPerUnit) vpDict.OPS_PixelsPerUnit = ann.pixelsPerUnit;
            if (ann.unit) vpDict.OPS_Unit = PDFString.of(ann.unit);
            if (ann.scaleRatio) vpDict.OPS_ScaleRatio = PDFString.of(ann.scaleRatio);
            if (ann.lineWidth) vpDict.OPS_LineWidth = ann.lineWidth;
            annotDict = context.obj(vpDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, ann.lineWidth || 1.5, 'dashed'));
            break;
          }

          case 'scaleBar': {
            const sbx1 = convertX(ann.x);
            const sby1 = convertY(ann.y + ann.height);
            const sbx2 = convertX(ann.x + ann.width);
            const sby2 = convertY(ann.y);
            const sbDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [sbx1, sby1, sbx2, sby2],
              C: hexToColorArray(ann.color || '#000000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of('Scale Bar'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('scaleBar'),
              F: computeAnnotFlags(ann)
            };
            if (ann.pixelsPerUnit) sbDict.OPS_PixelsPerUnit = ann.pixelsPerUnit;
            if (ann.unit) sbDict.OPS_Unit = PDFString.of(ann.unit);
            if (ann.divisions) sbDict.OPS_Divisions = ann.divisions;
            if (ann.totalUnits) sbDict.OPS_TotalUnits = ann.totalUnits;
            if (ann.lineWidth) sbDict.OPS_LineWidth = ann.lineWidth;
            if (ann.rotation) sbDict.OPS_Rotation = ann.rotation;
            annotDict = context.obj(sbDict);
            break;
          }

          case 'scheduleTable': {
            const stx1 = convertX(ann.x);
            const sty1 = convertY(ann.y + ann.height);
            const stx2 = convertX(ann.x + ann.width);
            const sty2 = convertY(ann.y);
            const stDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [stx1, sty1, stx2, sty2],
              C: [0, 0, 0],
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of('Schedule Table'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('scheduleTable'),
              F: computeAnnotFlags(ann)
            };
            if (ann.scheduleData) {
              stDict.OPS_ScheduleData = PDFString.of(JSON.stringify(ann.scheduleData));
            }
            if (ann.groupByMode) {
              stDict.OPS_GroupBy = PDFString.of(ann.groupByMode);
            }
            annotDict = context.obj(stDict);
            break;
          }

          case 'measureAngle': {
            if (!ann.point1 || !ann.vertex || !ann.point2) continue;
            const ap1x = convertX(ann.point1.x), ap1y = convertY(ann.point1.y);
            const avx = convertX(ann.vertex.x), avy = convertY(ann.vertex.y);
            const ap2x = convertX(ann.point2.x), ap2y = convertY(ann.point2.y);
            const aMinX = Math.min(ap1x, avx, ap2x) - 5;
            const aMinY = Math.min(ap1y, avy, ap2y) - 5;
            const aMaxX = Math.max(ap1x, avx, ap2x) + 5;
            const aMaxY = Math.max(ap1y, avy, ap2y) + 5;
            const maDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [aMinX, aMinY, aMaxX, aMaxY],
              Vertices: [ap1x, ap1y, avx, avy, ap2x, ap2y],
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('measureAngle'),
              F: computeAnnotFlags(ann)
            };
            if (ann.arcRadius && ann.arcRadius !== 30) maDict.OPS_ArcRadius = ann.arcRadius;
            annotDict = context.obj(maDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Vector /AP so the angle arms AND the angle value label render in
            // other viewers (label was Contents-only) — issue #256.
            attachVectorAP(context, annotDict, buildPolylineMeasureAP({
              points: [ann.point1, ann.vertex, ann.point2], X: convertX, Y: convertY,
              strokeColorHex: ann.strokeColor || '#ff0000', lineWidth: borderWidth,
              borderStyle: ann.borderStyle, text: ann.measureText,
            }), maDict.Rect);
            break;
          }

          case 'measureDistance': {
            const mapDimHead = (h) => {
              switch (h) {
                case 'open': return 'OpenArrow';
                case 'closed': return 'ClosedArrow';
                case 'diamond': return 'Diamond';
                case 'circle': return 'Circle';
                case 'openCircle': return 'Circle';
                case 'square': return 'Square';
                case 'slash': return 'Slash';
                case 'butt': return 'Butt';
                case 'openReversed': return 'ROpenArrow';
                case 'closedReversed': return 'RClosedArrow';
                default: return 'Circle';
              }
            };
            // Save as Line annotation with Measure dictionary
            // Data model: startX/Y = dimension line, leaderX/Y = base object points
            const mdx1 = convertX(ann.startX);
            const mdy1 = convertY(ann.startY);
            const mdx2 = convertX(ann.endX);
            const mdy2 = convertY(ann.endY);

            // Compute rect including all points
            let mdRectMinX = Math.min(mdx1, mdx2) - 5;
            let mdRectMinY = Math.min(mdy1, mdy2) - 5;
            let mdRectMaxX = Math.max(mdx1, mdx2) + 5;
            let mdRectMaxY = Math.max(mdy1, mdy2) + 5;

            // PDF /L = base object points when leaders exist, else dimension line
            let pdfLX1 = mdx1, pdfLY1 = mdy1, pdfLX2 = mdx2, pdfLY2 = mdy2;

            const mdDict = {
              Type: 'Annot',
              Subtype: 'Line',
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('LineDimension'),
              OPS_Subtype: PDFString.of('measureDistance'),
              LE: [PDFName.of(mapDimHead(ann.startHead)), PDFName.of(mapDimHead(ann.endHead))],
              F: computeAnnotFlags(ann)
            };

            // Save custom properties for exact round-trip
            if (ann.headSize && ann.headSize !== 12) mdDict.OPS_HeadSize = ann.headSize;
            if (ann.measurePrecision != null && ann.measurePrecision !== 2) mdDict.OPS_Precision = ann.measurePrecision;
            // User-dragged text position: offset from the dimension-line
            // midpoint, stored in the same visual frame as the annotation
            // (loader reads it back verbatim — no coordinate conversion).
            if (ann.textOffsetX || ann.textOffsetY) {
              mdDict.OPS_TextOffsetX = ann.textOffsetX || 0;
              mdDict.OPS_TextOffsetY = ann.textOffsetY || 0;
            }

            // Save leader line properties if extension lines exist
            if (ann.leaderStartX !== undefined) {
              // leaderStartX/Y = /L base object points in our data model
              const lsx = convertX(ann.leaderStartX);
              const lsy = convertY(ann.leaderStartY);
              const lex = convertX(ann.leaderEndX);
              const ley = convertY(ann.leaderEndY);
              // /L = base object points
              pdfLX1 = lsx; pdfLY1 = lsy;
              pdfLX2 = lex; pdfLY2 = ley;
              // Compute LL: perpendicular distance from /L base to dimension line
              const lineAngle = Math.atan2(ley - lsy, lex - lsx);
              const perpX = -Math.sin(lineAngle);
              const perpY = Math.cos(lineAngle);
              const ll = (mdx1 - lsx) * perpX + (mdy1 - lsy) * perpY;
              mdDict.LL = ll;
              mdDict.LLE = 5;
              // Expand rect to include base points
              mdRectMinX = Math.min(mdRectMinX, lsx, lex);
              mdRectMinY = Math.min(mdRectMinY, lsy, ley);
              mdRectMaxX = Math.max(mdRectMaxX, lsx, lex);
              mdRectMaxY = Math.max(mdRectMaxY, lsy, ley);
            }

            mdDict.L = [pdfLX1, pdfLY1, pdfLX2, pdfLY2];

            mdDict.Rect = [mdRectMinX, mdRectMinY, mdRectMaxX, mdRectMaxY];

            // Save Measure dictionary with scale factor
            if (ann.measureScale) {
              mdDict.Cap = true;
              mdDict.CP = PDFName.of('Inline');
            }

            annotDict = context.obj(mdDict);

            if (ann.measureScale) {
              const numFmt = context.obj({
                C: ann.measureScale,
                D: 1,
                U: PDFString.of(ann.measureUnit || 'mm'),
              });
              const measureDict = context.obj({
                Subtype: PDFName.of('RL'),
                R: PDFString.of(`1 pt = ${ann.measureScale} ${ann.measureUnit || 'mm'}`),
                X: context.obj([numFmt]),
              });
              annotDict.set(PDFName.of('Measure'), measureDict);
            }

            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Vector /AP so the dimension line, extension lines AND the value
            // label render in other viewers (label was Contents-only) — #256.
            attachVectorAP(context, annotDict, buildMeasureDistanceAP({
              startX: ann.startX, startY: ann.startY, endX: ann.endX, endY: ann.endY,
              leaderStartX: ann.leaderStartX, leaderStartY: ann.leaderStartY,
              leaderEndX: ann.leaderEndX, leaderEndY: ann.leaderEndY,
              X: convertX, Y: convertY, strokeColorHex: ann.strokeColor || '#ff0000',
              lineWidth: borderWidth, borderStyle: ann.borderStyle,
              text: ann.measureText, textOffsetX: ann.textOffsetX, textOffsetY: ann.textOffsetY,
            }), mdDict.Rect);
            break;
          }

          case 'measureArea': {
            // Save as Polygon annotation with measurement data
            if (!ann.points || ann.points.length < 3) continue;
            let maVertices = [];
            let maMinX = Infinity, maMinY = Infinity, maMaxX = -Infinity, maMaxY = -Infinity;

            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              maVertices.push(px, py);
              maMinX = Math.min(maMinX, px); maMaxX = Math.max(maMaxX, px);
              maMinY = Math.min(maMinY, py); maMaxY = Math.max(maMaxY, py);
            }

            const maDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [maMinX - 2, maMinY - 2, maMaxX + 2, maMaxY + 2],
              Vertices: maVertices,
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('PolygonDimension'),
              OPS_Subtype: PDFString.of('measureArea'),
              F: computeAnnotFlags(ann)
            };
            if (hasFill(ann.fillColor)) {
              maDict.IC = hexToColorArray(ann.fillColor);
            }
            annotDict = context.obj(maDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Save holes as custom OPS_Holes array
            if (ann.holes && ann.holes.length > 0) {
              const holesArray = ann.holes.map(hole => {
                const holeVertices = [];
                for (const pt of hole) {
                  holeVertices.push(convertX(pt.x));
                  holeVertices.push(convertY(pt.y));
                }
                return context.obj(holeVertices);
              });
              annotDict.set(PDFName.of('OPS_Holes'), context.obj(holesArray));
            }
            // Vector /AP so the outline + fill AND the measurement value label
            // (Contents-only today) render in other viewers — issue #256.
            attachVectorAP(context, annotDict, buildMeasureAreaAP({
              points: ann.points, holes: ann.holes, X: convertX, Y: convertY,
              fillColorHex: ann.fillColor, strokeColorHex: ann.strokeColor || '#ff0000',
              lineWidth: borderWidth, borderStyle: ann.borderStyle,
              hatchPattern: ann.hatchPattern, hatchColorHex: ann.hatchColor,
              hatchScale: ann.hatchScale, hatchAngle: ann.hatchAngle,
              text: ann.measureText, labelX: ann.labelX, labelY: ann.labelY,
            }), maDict.Rect);
            break;
          }

          case 'filledArea': {
            // User-drawn filled area: persisted as a /Polygon with our private
            // OPS_Subtype='filledArea' marker, fill color (IC), hatch metadata,
            // optional /OPS_Holes for cutouts, and parallel arrays
            // /OPS_ArcFlags + /OPS_ArcBulges to round-trip arc-segment metadata.
            if (!ann.points || ann.points.length < 3) continue;
            const faVertices = [];
            const faArcFlags = [];
            const faArcBulges = [];
            let faMinX = Infinity, faMinY = Infinity, faMaxX = -Infinity, faMaxY = -Infinity;
            let anyArc = false;
            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              faVertices.push(px, py);
              const isArc = pt.arc === true;
              faArcFlags.push(isArc ? 1 : 0);
              faArcBulges.push(isArc ? (typeof pt.bulge === 'number' ? pt.bulge : 0.3) : 0);
              if (isArc) anyArc = true;
              faMinX = Math.min(faMinX, px); faMaxX = Math.max(faMaxX, px);
              faMinY = Math.min(faMinY, py); faMaxY = Math.max(faMaxY, py);
            }
            const faDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [faMinX - 2, faMinY - 2, faMaxX + 2, faMaxY + 2],
              Vertices: faVertices,
              C: hexToColorArray(ann.strokeColor || ann.color || '#000000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('filledArea'),
              F: computeAnnotFlags(ann),
            };
            if (ann.fillColor && ann.fillColor !== 'none' && ann.fillColor !== 'transparent') {
              faDict.IC = hexToColorArray(ann.fillColor);
            }
            annotDict = context.obj(faDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Hatch metadata
            if (ann.hatchPattern && ann.hatchPattern !== 'none') {
              annotDict.set(PDFName.of('OPS_HatchPattern'), PDFString.of(ann.hatchPattern));
              if (ann.hatchColor) {
                annotDict.set(PDFName.of('OPS_HatchColor'), PDFString.of(ann.hatchColor));
              }
              if (ann.hatchScale != null) {
                annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
              }
              if (ann.hatchAngle != null) {
                annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
              }
            }
            // Holes (re-uses existing OPS_Holes loader path).
            // Also persist per-hole arc metadata as parallel arrays
            // /OPS_HoleArcFlags + /OPS_HoleArcBulges (array of sub-arrays,
            // one entry per hole, each entry one flag/bulge per hole vertex).
            if (ann.holes && ann.holes.length > 0) {
              const holesArr = ann.holes.map(hole => {
                const hv = [];
                for (const pt of hole) { hv.push(convertX(pt.x)); hv.push(convertY(pt.y)); }
                return context.obj(hv);
              });
              annotDict.set(PDFName.of('OPS_Holes'), context.obj(holesArr));
              let anyHoleArc = false;
              const holeFlagsArr = ann.holes.map(hole => {
                const flags = [];
                for (const pt of hole) {
                  const isArc = pt && pt.arc === true;
                  if (isArc) anyHoleArc = true;
                  flags.push(isArc ? 1 : 0);
                }
                return context.obj(flags);
              });
              const holeBulgesArr = ann.holes.map(hole => {
                const bulges = [];
                for (const pt of hole) {
                  const isArc = pt && pt.arc === true;
                  bulges.push(isArc ? (typeof pt.bulge === 'number' ? pt.bulge : 0.3) : 0);
                }
                return context.obj(bulges);
              });
              if (anyHoleArc) {
                annotDict.set(PDFName.of('OPS_HoleArcFlags'), context.obj(holeFlagsArr));
                annotDict.set(PDFName.of('OPS_HoleArcBulges'), context.obj(holeBulgesArr));
              }
            }
            // Arc segment data — only emit when at least one vertex is an arc.
            if (anyArc) {
              annotDict.set(PDFName.of('OPS_ArcFlags'), context.obj(faArcFlags));
              annotDict.set(PDFName.of('OPS_ArcBulges'), context.obj(faArcBulges));
            }
            // Vector /AP so the solid fill + hatch pattern show in other viewers
            // (they render only /AP, not our OPS_Hatch* keys) — issue #256.
            attachVectorAP(context, annotDict, buildFilledAreaAP({
              points: ann.points, holes: ann.holes, X: convertX, Y: convertY,
              fillColorHex: ann.fillColor, strokeColorHex: ann.strokeColor || ann.color || '#000000',
              lineWidth: borderWidth, borderStyle: ann.borderStyle,
              hatchPattern: ann.hatchPattern, hatchColorHex: ann.hatchColor,
              hatchScale: ann.hatchScale, hatchAngle: ann.hatchAngle,
            }), faDict.Rect);
            break;
          }

          case 'measurePerimeter': {
            // Save as PolyLine annotation with measurement data
            if (!ann.points || ann.points.length < 2) continue;
            let mpVertices = [];
            let mpMinX = Infinity, mpMinY = Infinity, mpMaxX = -Infinity, mpMaxY = -Infinity;

            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              mpVertices.push(px, py);
              mpMinX = Math.min(mpMinX, px); mpMaxX = Math.max(mpMaxX, px);
              mpMinY = Math.min(mpMinY, py); mpMaxY = Math.max(mpMaxY, py);
            }

            const mpDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [mpMinX - 2, mpMinY - 2, mpMaxX + 2, mpMaxY + 2],
              Vertices: mpVertices,
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('PolyLineDimension'),
              OPS_Subtype: PDFString.of('measurePerimeter'),
              F: computeAnnotFlags(ann)
            };
            // Save line endings
            if (ann.startHead || ann.endHead) {
              const mapHead = (h) => {
                switch (h) {
                  case 'open': return 'OpenArrow';
                  case 'closed': return 'ClosedArrow';
                  case 'diamond': return 'Diamond';
                  case 'circle': return 'Circle';
                  case 'square': return 'Square';
                  case 'slash': return 'Slash';
                  case 'butt': return 'Butt';
                  case 'openReversed': return 'ROpenArrow';
                  case 'closedReversed': return 'RClosedArrow';
                  default: return 'None';
                }
              };
              mpDict.LE = [PDFName.of(mapHead(ann.startHead)), PDFName.of(mapHead(ann.endHead))];
            }
            if (ann.headSize && ann.headSize !== 12) mpDict.OPS_HeadSize = ann.headSize;
            annotDict = context.obj(mpDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Vector /AP so the polyline AND the perimeter value label render in
            // other viewers (label was Contents-only) — issue #256.
            attachVectorAP(context, annotDict, buildPolylineMeasureAP({
              points: ann.points, X: convertX, Y: convertY,
              strokeColorHex: ann.strokeColor || '#ff0000', lineWidth: borderWidth,
              borderStyle: ann.borderStyle, text: ann.measureText,
              labelX: ann.labelX, labelY: ann.labelY,
            }), mpDict.Rect);
            break;
          }

          case 'wall': {
            // Wall segment: persisted as a /Line along the centreline with
            // private OPS metadata (thickness + material hatch) so the wall
            // reconstructs fully when re-opened in this app, while other
            // viewers still show at least the centreline.
            const wx1 = convertX(ann.startX);
            const wy1 = convertY(ann.startY);
            const wx2 = convertX(ann.endX);
            const wy2 = convertY(ann.endY);
            const wPad = Math.max(borderWidth, 4);
            const wDict = {
              Type: 'Annot',
              Subtype: 'Line',
              Rect: [
                Math.min(wx1, wx2) - wPad, Math.min(wy1, wy2) - wPad,
                Math.max(wx1, wx2) + wPad, Math.max(wy1, wy2) + wPad,
              ],
              L: [wx1, wy1, wx2, wy2],
              C: hexToColorArray(ann.strokeColor || ann.color || '#000000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('wall'),
              OPS_DikteMm: ann.dikteMm ?? 100,
            };
            annotDict = context.obj(wDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, 'solid'));
            if (ann.hatchPattern && ann.hatchPattern !== 'none') {
              annotDict.set(PDFName.of('OPS_HatchPattern'), PDFString.of(ann.hatchPattern));
              if (ann.hatchColor) annotDict.set(PDFName.of('OPS_HatchColor'), PDFString.of(ann.hatchColor));
              if (ann.hatchScale != null) annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
              if (ann.hatchAngle != null) annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
            }
            if (ann.isolatieType) {
              annotDict.set(PDFName.of('OPS_IsolatieType'), PDFString.of(ann.isolatieType));
            }
            // Vector /AP so the wall BODY (thickness band + material fill/hatch
            // + outline) shows in other viewers instead of just the thin
            // centreline — issue #256. The band + material are resolved with the
            // same helpers the on-screen renderer uses, so the look matches.
            try {
              const wallShape = computeWallShape(ann, docAnnotations);
              const band = wallShape && wallShape.poly;
              if (band && band.length >= 3) {
                let fillBg = null, wHatch = null, wHatchColor = null, wHatchScale = null, wHatchAngle = null;
                const mat = resolveWallMaterial(ann);
                if (mat) {
                  const wallAngleDeg = Math.atan2(ann.endY - ann.startY, ann.endX - ann.startX) * 180 / Math.PI;
                  if (mat.kind === 'iso') {
                    const iso = mat.iso || {};
                    fillBg = iso.bg || mat.bg || '#eeeeee';
                    wHatch = 'nen47-isolatie';
                    wHatchColor = iso.fg || '#7a7a7a';
                    wHatchScale = 100;
                    wHatchAngle = wallAngleDeg;
                  } else if (mat.kind !== 'none') {
                    fillBg = mat.bg || null;
                    wHatch = mat.pattern || mat.id;
                    wHatchColor = ann.hatchColor || mat.fg || ann.strokeColor || ann.color || '#000000';
                    wHatchScale = (ann.hatchScale != null && ann.hatchScale !== 100) ? ann.hatchScale : (mat.dens ?? 100);
                    wHatchAngle = (ann.hatchAngle ?? 0) + wallAngleDeg;
                  }
                }
                // Expand /Rect to the band bbox so the /AP BBox doesn't clip it.
                const bxs = band.map(p => convertX(p.x));
                const bys = band.map(p => convertY(p.y));
                const wRect = [Math.min(...bxs) - 2, Math.min(...bys) - 2, Math.max(...bxs) + 2, Math.max(...bys) + 2];
                annotDict.set(PDFName.of('Rect'), context.obj(wRect));
                attachVectorAP(context, annotDict, buildWallAP({
                  bandPoints: band, X: convertX, Y: convertY,
                  strokeColorHex: ann.strokeColor || ann.color || '#000000', lineWidth: borderWidth,
                  fillBgHex: fillBg, hatchPattern: wHatch, hatchColorHex: wHatchColor,
                  hatchScale: wHatchScale, hatchAngle: wHatchAngle,
                }), wRect);
              }
            } catch (wallApErr) {
              console.warn('[saver] wall /AP embed failed:', wallApErr);
            }
            break;
          }

          case 'parametricSymbol': {
            // Persist as /Square with private OPS metadata so the bbox is
            // visible in non-supporting viewers and the symbol can be
            // reconstructed when re-opened in this app.
            let psx1 = convertX(ann.x);
            let psy1 = convertY(ann.y + ann.height);
            let psx2 = convertX(ann.x + ann.width);
            let psy2 = convertY(ann.y);
            if (ann.rotation) {
              const rad = ann.rotation * Math.PI / 180;
              const cos = Math.abs(Math.cos(rad));
              const sin = Math.abs(Math.sin(rad));
              const pw = Math.abs(psx2 - psx1);
              const ph = Math.abs(psy2 - psy1);
              const newW = pw * cos + ph * sin;
              const newH = pw * sin + ph * cos;
              const cx = (psx1 + psx2) / 2;
              const cy = (psy1 + psy2) / 2;
              psx1 = cx - newW / 2;
              psx2 = cx + newW / 2;
              psy1 = cy - newH / 2;
              psy2 = cy + newH / 2;
            }
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const psDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [psx1, psy1, psx2, psy2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('parametricSymbol'),
              OPS_SymbolId: PDFString.of(ann.symbolId || ''),
              OPS_Params: PDFString.of(JSON.stringify(ann.params || {})),
            };
            psDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);
            if (ann.rotation) psDict.OPS_Rotation = ann.rotation;
            annotDict = context.obj(psDict);
            // Embed a raster appearance stream (/AP) of the symbol so OTHER PDF
            // viewers — which can't read the OPS_* private keys — render the
            // actual symbol geometry instead of just the empty /Square box. The
            // raster reuses the exact on-screen draw path, so it looks the same.
            try {
              const { renderParametricSymbolToPng } = await import('../annotations/rendering.js');
              const png = renderParametricSymbolToPng(ann, 4);
              if (png && png.dataUrl) {
                const base64 = png.dataUrl.split(',')[1];
                const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                const embeddedImage = await pdfDocLib.embedPng(bytes);
                const rectW = Math.abs(psx2 - psx1);
                const rectH = Math.abs(psy2 - psy1);
                const alpha = opacity != null ? opacity : 1;
                const resources = { XObject: context.obj({ Img: embeddedImage.ref }) };
                let apContent;
                if (alpha < 1) {
                  const gsRef = context.register(context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha }));
                  resources.ExtGState = context.obj({ GS0: gsRef });
                  apContent = `q\n/GS0 gs\n${rectW} 0 0 ${rectH} 0 0 cm\n/Img Do\nQ\n`;
                } else {
                  apContent = `q\n${rectW} 0 0 ${rectH} 0 0 cm\n/Img Do\nQ\n`;
                }
                const apStream = context.stream(apContent, {
                  Type: 'XObject', Subtype: 'Form', BBox: [0, 0, rectW, rectH],
                  Resources: context.obj(resources),
                });
                annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(apStream) }));
              }
            } catch (apErr) {
              console.warn('[saver] parametricSymbol /AP embed failed:', apErr);
            }
            break;
          }

          default: {
            // Plugin-registered annotation types: delegate to the handler's
            // optional serializeToPdf method. Unknown types without a handler
            // remain dropped (legacy behavior).
            const pluginHandler = getAnnotationType(ann.type);
            if (pluginHandler && typeof pluginHandler.serializeToPdf === 'function') {
              try {
                await pluginHandler.serializeToPdf({
                  pdfDoc: pdfDocLib,
                  page,
                  annotation: ann,
                  convertX,
                  convertY,
                });
              } catch (err) {
                console.warn(`[saver] plugin serializeToPdf failed for type "${ann.type}":`, err);
              }
            }
            break;
          }
        }

        // Generate appearance stream for better compatibility with other PDF viewers
        // Skip if AP was already set (e.g. image/signature with embedded image)
        if (annotDict && !annotDict.get(PDFName.of('AP'))) {
          const apStream = generateAppearanceStream(context, ann, convertY);
          if (apStream) {
            const apStreamRef = context.register(apStream);
            const apDict = context.obj({ N: apStreamRef });
            annotDict.set(PDFName.of('AP'), apDict);
          }
        }

        // Add annotation to page
        let parentAnnotRef = null;
        if (annotDict) {
          parentAnnotRef = context.register(annotDict);
          annotsArray.push(parentAnnotRef);
        }

        // Review-status (issue #308): schrijf de status als aparte Text-
        // annotatie met /IRT + /State + /StateModel (PDF-spec), zodat de
        // status ook in externe PDF-programma's zichtbaar blijft en bij
        // heropenen weer aan de doel-annotatie gekoppeld wordt.
        if (parentAnnotRef && ann.status && ann.status !== 'none') {
          const stateStr = String(ann.status).charAt(0).toUpperCase() + String(ann.status).slice(1);
          const stDate = ann.statusAt ? new Date(ann.statusAt) : new Date();
          const stDateObj = isNaN(stDate.getTime()) ? new Date() : stDate;
          // Rect van de doel-annotatie hergebruiken (status-reply is verborgen)
          const parentRect = annotDict.get(PDFName.of('Rect'));
          const stDict = context.obj({
            Type: 'Annot',
            Subtype: 'Text',
            Contents: PDFString.of(stateStr),
            T: PDFString.of(ann.statusBy || ann.author || 'User'),
            M: PDFString.fromDate(stDateObj),
            CreationDate: PDFString.fromDate(stDateObj),
            F: 30, // Hidden + Print + NoZoom + NoRotate — niet los tonen
            State: PDFString.of(stateStr),
            StateModel: PDFString.of('Review'),
          });
          stDict.set(PDFName.of('Rect'), parentRect);
          stDict.set(PDFName.of('IRT'), parentAnnotRef);
          annotsArray.push(context.register(stDict));
        }

        // Textbox leaders: emit one PolyLine annotation per leader, linked
        // back to the textbox via /IRT for round-trip support.
        if (parentAnnotRef && ann.type === 'textbox' &&
            Array.isArray(ann.leaders) && ann.leaders.length > 0) {
          const _bw = ann.width || 150;
          const _bh = ann.height || 50;
          const _box = { x: ann.x, y: ann.y, width: _bw, height: _bh };
          const _lwLdr = ann.lineWidth !== undefined ? ann.lineWidth : 1;
          const _strokeArr = ann.strokeColor && ann.strokeColor !== 'none'
            ? hexToColorArray(ann.strokeColor)
            : (ann.color ? hexToColorArray(ann.color) : [0, 0, 0]);
          for (const leader of ann.leaders) {
            // Pick anchor side (top/right/bottom/left midpoint nearest knee) — same as renderer
            const cs = [
              { x: _box.x + _bw / 2, y: _box.y },
              { x: _box.x + _bw,     y: _box.y + _bh / 2 },
              { x: _box.x + _bw / 2, y: _box.y + _bh },
              { x: _box.x,           y: _box.y + _bh / 2 },
            ];
            let aBest = cs[0], bestD = Infinity;
            for (const c of cs) {
              const d = (c.x - leader.kneeX) * (c.x - leader.kneeX) + (c.y - leader.kneeY) * (c.y - leader.kneeY);
              if (d < bestD) { bestD = d; aBest = c; }
            }
            const aPdf = [convertX(aBest.x), convertY(aBest.y)];
            const kPdf = [convertX(leader.kneeX), convertY(leader.kneeY)];
            const tPdf = [convertX(leader.tipX), convertY(leader.tipY)];
            const verts = [aPdf[0], aPdf[1], kPdf[0], kPdf[1], tPdf[0], tPdf[1]];
            const minX = Math.min(aPdf[0], kPdf[0], tPdf[0]) - _lwLdr - 4;
            const maxX = Math.max(aPdf[0], kPdf[0], tPdf[0]) + _lwLdr + 4;
            const minY = Math.min(aPdf[1], kPdf[1], tPdf[1]) - _lwLdr - 4;
            const maxY = Math.max(aPdf[1], kPdf[1], tPdf[1]) + _lwLdr + 4;
            const endStyle = leader.endStyle === 'circle' ? 'Circle' : 'OpenArrow';
            const ldrDict = context.obj({
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [minX, minY, maxX, maxY],
              Vertices: verts,
              C: _strokeArr,
              CA: ann.opacity !== undefined ? ann.opacity : 1,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann),
              OPS_Subtype: PDFString.of('textboxLeader'),
              OPS_LeaderId: PDFString.of(leader.id || ''),
            });
            ldrDict.set(PDFName.of('LE'), context.obj([PDFName.of('None'), PDFName.of(endStyle)]));
            ldrDict.set(PDFName.of('IRT'), parentAnnotRef);
            ldrDict.set(PDFName.of('BS'), buildBorderStyle(context, _lwLdr, ann.borderStyle));
            const ldrRef = context.register(ldrDict);
            annotsArray.push(ldrRef);
          }
        }
      }

      // Set the updated annotations array
      page.node.set(PDFName.of('Annots'), context.obj(annotsArray));
    }

    // Burn text edits into the PDF (cover-and-replace)
    await saveTextEditsToPages(pdfDocLib, pages);

    // Burn watermarks into the PDF
    await saveWatermarksToPages(pdfDocLib, pages);

    // Save bookmarks to PDF outline
    saveBookmarksToOutline(pdfDocLib);

    // Save named line-style presets into the catalog (travel with the PDF)
    saveStylePresetsToCatalog(pdfDocLib);

    // Save the PDF
    const pdfBytes = await pdfDocLib.save();
    const outputPath = saveAsPath || activeDoc?.saveTargetPath || currentPath;
    const savedBytes = new Uint8Array(pdfBytes);

    // Temporarily release lock so we can write, then re-lock
    await unlockFile(outputPath);
    try {
      await writeBinaryFile(outputPath, savedBytes);
    } catch (writeErr) {
      // Re-lock before reporting error
      await lockFile(outputPath);
      const msg = writeErr?.message || String(writeErr);
      if (msg.includes('denied') || msg.includes('locked') || msg.includes('sharing') || msg.includes('used by another')) {
        throw new Error(i18next.t('fileLocked', { defaultValue: 'The file is being used by another application. Please close it and try again.' }));
      }
      throw writeErr;
    }
    await lockFile(outputPath);

    // Invalidate the Rust-side PDF bytes cache so next render reads the updated file
    if (isTauri()) {
      try { await invoke('invalidate_pdf_cache', { path: outputPath }); } catch {}
    }

    // Update cache so subsequent saves use the latest PDF as base
    setCachedPdfBytes(outputPath, savedBytes.slice());

    // Mark document as saved
    markDocumentSaved();

    return true;
  } catch (error) {
    console.error('Error saving PDF:', error);
    showMessage(i18next.t('failedToSavePdf', { error: error?.message || String(error) }));
    return false;
  } finally {
    hideLoading();
  }
}




// Save As - prompt for new file path
export async function savePDFAs() {
  if (!getActiveDocument()?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded'));
    return false;
  }

  // Use current path as default, or the untitled file name
  const doc = getActiveDocument();
  const currentPath = doc?.filePath;
  const defaultPath = currentPath || (doc ? doc.fileName : 'Untitled.pdf');

  const savePath = await saveFileDialog(defaultPath);

  if (savePath) {
    const wasUntitled = !!doc?.isUntitled || !currentPath;
    const tempPath = (doc?.isUntitled || doc?._renderTemp) ? currentPath : null;
    const success = await savePDF(savePath);

    // If saved to a new path, update the current path and UI
    if (success && savePath !== currentPath) {
      // Clean up the in-memory original-bytes cache for untitled docs.
      if (doc && wasUntitled) {
        const memKey = `__memory__${doc.id}`;
        const { clearCachedPdfBytes } = await import('./loader.js');
        clearCachedPdfBytes(memKey);
      }

      if (doc) {
        doc.filePath = savePath;
        doc.fileName = savePath ? savePath.split(/[\\/]/).pop() : 'Untitled';
        doc.isUntitled = false; // now a real, user-chosen file
        doc.saveTargetPath = null; // lives at its real path now; no separate save target
        doc._renderTemp = false;
      }
      updateWindowTitle();
      // Session now contains the new path (debounced persist).
      window.__OPDS_SESSION_SAVE__?.();

      // Delete the temp backing file now that the doc lives at its real path.
      if (tempPath) {
        try {
          if (window.__TAURI__?.fs?.remove) await window.__TAURI__.fs.remove(tempPath);
        } catch (e) { console.warn('[blank-pdf] temp cleanup failed:', e); }
      }
    }
    return success || false;
  }
  return false;
}
