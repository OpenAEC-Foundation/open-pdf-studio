import { state, getPageRotation } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { hexToColorArray } from '../utils/colors.js';
import { markDocumentSaved, updateWindowTitle } from '../ui/chrome/tabs.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog, unlockFile, lockFile } from '../core/platform.js';
import { getCachedPdfBytes, setCachedPdfBytes } from './loader.js';
import { PDFDocument, PDFString, PDFName, PDFArray, PDFStream, degrees,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from 'pdf-lib';
import { getAnnotationStorage, getAnnotIdToFieldName } from './form-layer.js';

// Save PDF with annotations
export async function savePDF(saveAsPath = null) {
  if (!state.currentPdfPath && !saveAsPath) {
    alert('No PDF loaded');
    return false;
  }

  if (!isTauri()) {
    alert('Save functionality requires Tauri environment');
    return false;
  }

  try {
    showLoading('Saving PDF...');

    // Get original PDF bytes (from cache or disk)
    // Get original PDF bytes (from cache or disk)
    let existingPdfBytes = getCachedPdfBytes(state.currentPdfPath);
    if (!existingPdfBytes) {
      existingPdfBytes = await readBinaryFile(state.currentPdfPath);
    }

    const pdfDocLib = await PDFDocument.load(existingPdfBytes);

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
    const ftAnnotations = state.annotations.filter(a => a.type === 'textbox' || a.type === 'callout');
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
    for (const ann of state.annotations) {
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

      const pageHeight = page.getHeight();
      const pageAnnotations = annotationsByPage[pageNum] || [];

      // Build annotations array: keep existing annotations we don't handle (widgets, links, etc.)
      // and replace the ones we do with our state.annotations (which is the source of truth)
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

      // Helper to convert Y coordinate (flip for PDF)
      const convertY = (y) => pageHeight - y;

      // Add our annotations
      for (const ann of pageAnnotations) {
        const colorArr = hexToColorArray(ann.color || '#000000');
        const opacity = ann.opacity !== undefined ? ann.opacity : 1;
        const borderWidth = ann.lineWidth || 2;

        let annotDict;

        switch (ann.type) {
          case 'highlight':
          case 'textHighlight':
          case 'textStrikethrough':
          case 'textUnderline':
          case 'textSquiggly': {
            // Text markup annotations
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            // Build QuadPoints from rects if available, otherwise from bounding box
            let quadPoints;
            if (ann.rects && ann.rects.length > 0) {
              quadPoints = [];
              for (const r of ann.rects) {
                const qy1 = convertY(r.y + r.height);
                const qy2 = convertY(r.y);
                quadPoints.push(r.x, qy2, r.x + r.width, qy2, r.x, qy1, r.x + r.width, qy1);
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

          case 'box': {
            // Square annotation
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const boxBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [x1, y1, x2, y2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: boxBsStyle
            });

            // Add interior color (fill) if specified
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'circle': {
            // Circle annotation (ellipse)
            const cx = ann.x;
            const cy = convertY(ann.y + ann.height);
            const cx2 = ann.x + ann.width;
            const cy2 = convertY(ann.y);

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Circle',
              Rect: [cx, cy, cx2, cy2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            const circleBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';
            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: circleBsStyle
            });

            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'line':
          case 'arrow': {
            // Line annotation (arrows use LE entries)
            const x1 = ann.startX;
            const y1 = convertY(ann.startY);
            const x2 = ann.endX;
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
            const bsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';
            lineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: bsStyle
            });

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
                  default: return 'None';
                }
              };
              lineDict.LE = [PDFName.of(mapHead(ann.startHead)), PDFName.of(mapHead(ann.endHead))];

              // Interior color for closed arrowheads
              if (ann.fillColor) {
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
              inkList.push(pt.x);
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

            const inkBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';
            inkDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: inkBsStyle
            });

            annotDict = context.obj(inkDict);
            break;
          }

          case 'polyline': {
            // PolyLine annotation
            if (!ann.points || ann.points.length < 2) continue;

            const vertices = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of ann.points) {
              const px = pt.x;
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

            const polylineBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';
            polylineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: polylineBsStyle
            });

            annotDict = context.obj(polylineDict);
            break;
          }

          case 'polygon':
          case 'cloud': {
            // Polygon annotation
            let polyVertices = [];
            let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity;

            if (ann.points && ann.points.length >= 3) {
              // Use stored points (from loaded PDF annotations)
              for (const pt of ann.points) {
                const px = pt.x;
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
                const px = cx + rx * Math.cos(angle);
                const py = convertY(cy + ry * Math.sin(angle));
                polyVertices.push(px, py);
                polyMinX = Math.min(polyMinX, px); polyMaxX = Math.max(polyMaxX, px);
                polyMinY = Math.min(polyMinY, py); polyMaxY = Math.max(polyMaxY, py);
              }
            }

            const polyStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const polyBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';

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

            polygonDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: polyBsStyle
            });

            if (ann.fillColor && ann.fillColor !== 'none') {
              polygonDict.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(polygonDict);
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
            // For standard 90° rotations: use original dimensions (viewer handles rotation)
            // For arbitrary angles: expand to bounding box of rotated textbox
            const isStdRot = ftRotation !== 0 && ftRotation % 90 === 0;
            let x1, y1, x2, y2;
            if (ftRotation !== 0 && !isStdRot) {
              const cxDoc = ann.x + ftW / 2;
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
              x1 = ann.x;
              y1 = convertY(ann.y + ftH);
              x2 = ann.x + ftW;
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
            const ftStrokeColorArr = (ann.strokeColor && ann.strokeColor !== 'none')
              ? hexToColorArray(ann.strokeColor) : [0, 0, 0];
            const ftFillColorArr = (ann.fillColor && ann.fillColor !== 'none')
              ? hexToColorArray(ann.fillColor) : null;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'FreeText',
              Rect: [x1, y1, x2, y2],
              Contents: PDFString.of(ann.text || ''),
              DA: PDFString.of(da),
              C: ftFillColorArr || [1, 1, 1],
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            // Border style
            const ftBorderWidth = ann.lineWidth !== undefined ? ann.lineWidth : 1;
            const ftBsStyle = ann.borderStyle === 'dashed' ? 'D' : ann.borderStyle === 'dotted' ? 'D' : 'S';
            annDictObj.BS = context.obj({
              Type: 'Border',
              W: ftBorderWidth,
              S: ftBsStyle
            });

            // Stroke/border color in IC
            annDictObj.IC = ftStrokeColorArr;

            // Callout line
            if (ann.type === 'callout' && ann.arrowX !== undefined) {
              const arrowX = ann.arrowX;
              const arrowY = convertY(ann.arrowY);
              const kneeX = ann.kneeX !== undefined ? ann.kneeX : arrowX;
              const kneeY = ann.kneeY !== undefined ? convertY(ann.kneeY) : arrowY;

              // CL array: [arrowX, arrowY, kneeX, kneeY, textX, textY]
              const textConnectionX = ann.arrowX < (ann.x + ftW / 2) ? x1 : x2;
              const textConnectionY = (y1 + y2) / 2;
              annDictObj.CL = [arrowX, arrowY, kneeX, kneeY, textConnectionX, textConnectionY];
              annDictObj.IT = 'FreeTextCallout';
            }

            // For standard 90° multiples, also set /Rotation for viewers that rebuild AP
            const isStandardRotation = ftRotation !== 0 && ftRotation % 90 === 0;

            if (isStandardRotation) {
              let pdfRotation = ((ftRotation % 360) + 360) % 360;
              annDictObj.Rotation = pdfRotation;
              annDictObj.OPS_Rotation = ftRotation;
            }

            annotDict = context.obj(annDictObj);

            // Always generate AP stream so PDF-XChange (and other viewers) show correct colors
            {
              const rectW = x2 - x1;
              const rectH = Math.abs(y2 - y1);

              let ftStreamContent = '';
              const [sr, sg, sb] = ann.strokeColor && ann.strokeColor !== 'none'
                ? hexToRgb(ann.strokeColor) : [0, 0, 0];

              // For arbitrary rotation angles, wrap content in rotation transform
              const needsRotationInAP = ftRotation !== 0 && !isStandardRotation;
              if (needsRotationInAP) {
                const rad = -ftRotation * Math.PI / 180;
                const cosR = Math.cos(rad);
                const sinR = Math.sin(rad);
                const bboxCX = rectW / 2;
                const bboxCY = rectH / 2;
                ftStreamContent += 'q\n';
                ftStreamContent += `1 0 0 1 ${bboxCX} ${bboxCY} cm\n`;
                ftStreamContent += `${cosR} ${sinR} ${-sinR} ${cosR} 0 0 cm\n`;
                ftStreamContent += `1 0 0 1 ${-ftW / 2} ${-ftH / 2} cm\n`;
              }

              // Draw border/fill
              ftStreamContent += `${ftBorderWidth} w\n${sr} ${sg} ${sb} RG\n`;
              if (ann.fillColor && ann.fillColor !== 'none') {
                const [fr, fg, fb] = hexToRgb(ann.fillColor);
                ftStreamContent += `${fr} ${fg} ${fb} rg\n0 0 ${ftW} ${ftH} re B\n`;
              } else {
                ftStreamContent += `0 0 ${ftW} ${ftH} re S\n`;
              }

              // Render text
              if (ann.text) {
                const ftFontSize = ann.fontSize || 14;
                const [tr, tg, tb] = ann.textColor ? hexToRgb(ann.textColor) : [0, 0, 0];
                const pdfFont = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
                const padding = ftBorderWidth + 2;
                const lineHeight = ftFontSize * 1.2;

                ftStreamContent += `BT\n/${pdfFont} ${ftFontSize} Tf\n${tr} ${tg} ${tb} rg\n`;
                const lines = ann.text.split('\n');
                let textY = ftH - padding - ftFontSize;
                for (const line of lines) {
                  if (textY < 0) break;
                  const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  ftStreamContent += `${padding} ${textY} Td\n(${escaped}) Tj\n`;
                  ftStreamContent += `${-padding} ${-textY} Td\n`;
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
                BaseFont: pdfFont
              });

              const ftApStream = context.stream(ftStreamContent, {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [0, 0, rectW, rectH],
                Resources: context.obj({
                  Font: context.obj({ [pdfFont]: fontDict })
                })
              });
              const ftApRef = context.register(ftApStream);
              const ftApDict = context.obj({ N: ftApRef });
              annotDict.set(PDFName.of('AP'), ftApDict);

              // Store angle for our loader to recover
              if (ftRotation !== 0 && !isStandardRotation) {
                annotDict.set(PDFName.of('OPS_Rotation'), context.obj(ftRotation));
              }
            }

            break;
          }

          case 'comment': {
            // Text annotation (sticky note)
            const x = ann.x;
            const y = convertY(ann.y);

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Text',
              Rect: [x, y - 24, x + 24, y],
              Contents: PDFString.of(ann.text || ann.comment || ''),
              C: hexToColorArray(ann.color || '#FFFF00'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              Name: 'Comment',
              Open: false,
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'stamp': {
            // Stamp annotation (text stamps without image data)
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: ann.stampName || 'Draft',
              Contents: PDFString.of(ann.stampText || ann.subject || ''),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'image':
          case 'signature': {
            // Save image/signature as Stamp annotation with embedded image AP stream
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);
            const w = ann.width;
            const h = ann.height;

            annotDict = context.obj({
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
            });

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

                if (alpha < 1) {
                  const gsDict = context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
                  const gsRef = context.register(gsDict);
                  resources.ExtGState = context.obj({ GS0: gsRef });
                  apContent = `q\n/GS0 gs\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                } else {
                  apContent = `q\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
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

          case 'measureDistance': {
            // Save as Line annotation with Measure dictionary
            const x1 = ann.startX;
            const y1 = convertY(ann.startY);
            const x2 = ann.endX;
            const y2 = convertY(ann.endY);

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Line',
              Rect: [Math.min(x1,x2) - 5, Math.min(y1,y2) - 5, Math.max(x1,x2) + 5, Math.max(y1,y2) + 5],
              L: [x1, y1, x2, y2],
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: 'LineDimension',
              F: computeAnnotFlags(ann)
            });
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
        if (annotDict) {
          const annotRef = context.register(annotDict);
          annotsArray.push(annotRef);
        }
      }

      // Set the updated annotations array
      page.node.set(PDFName.of('Annots'), context.obj(annotsArray));
    }

    // Save the PDF
    const pdfBytes = await pdfDocLib.save();
    const outputPath = saveAsPath || state.currentPdfPath;
    const savedBytes = new Uint8Array(pdfBytes);

    // Temporarily release lock so we can write, then re-lock
    await unlockFile(outputPath);
    await writeBinaryFile(outputPath, savedBytes);
    await lockFile(outputPath);

    // Update cache so subsequent saves use the latest PDF as base
    setCachedPdfBytes(outputPath, savedBytes.slice());

    // Mark document as saved
    markDocumentSaved();

    return true;
  } catch (error) {
    console.error('Error saving PDF:', error);
    alert('Failed to save PDF: ' + error.message);
    return false;
  } finally {
    hideLoading();
  }
}

// Save As - prompt for new file path
export async function savePDFAs() {
  if (!state.currentPdfPath) {
    alert('No PDF loaded');
    return;
  }

  if (!isTauri()) {
    alert('Save functionality requires Tauri environment');
    return;
  }

  const savePath = await saveFileDialog(state.currentPdfPath);

  if (savePath) {
    const success = await savePDF(savePath);

    // If saved to a new path, update the current path and UI
    if (success && savePath !== state.currentPdfPath) {
      state.currentPdfPath = savePath;

      // Update window title, tab bar, and file info
      updateWindowTitle();
    }
  }
}

// Generate a PDF appearance stream (Form XObject) for an annotation
function generateAppearanceStream(context, ann, convertY) {
  try {
    let streamContent = '';
    let bbox;

    switch (ann.type) {
      case 'box': {
        const w = ann.width;
        const h = ann.height;
        bbox = [0, 0, w, h];
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        const lw = ann.lineWidth || 2;
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        if (ann.fillColor) {
          const [fr, fg, fb] = hexToRgb(ann.fillColor);
          streamContent += `${fr} ${fg} ${fb} rg\n0 0 ${w} ${h} re B\n`;
        } else {
          streamContent += `0 0 ${w} ${h} re S\n`;
        }
        break;
      }
      case 'circle': {
        const w = ann.width || ann.radius * 2;
        const h = ann.height || ann.radius * 2;
        bbox = [0, 0, w, h];
        const cx = w / 2, cy = h / 2;
        const rx = w / 2, ry = h / 2;
        const k = 0.5522847498; // Bezier approximation of circle
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        const lw = ann.lineWidth || 2;
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        if (ann.fillColor) {
          const [fr, fg, fb] = hexToRgb(ann.fillColor);
          streamContent += `${fr} ${fg} ${fb} rg\n`;
        }
        // Ellipse via Bezier curves
        streamContent += `${cx} ${cy + ry} m\n`;
        streamContent += `${cx + k*rx} ${cy + ry} ${cx + rx} ${cy + k*ry} ${cx + rx} ${cy} c\n`;
        streamContent += `${cx + rx} ${cy - k*ry} ${cx + k*rx} ${cy - ry} ${cx} ${cy - ry} c\n`;
        streamContent += `${cx - k*rx} ${cy - ry} ${cx - rx} ${cy - k*ry} ${cx - rx} ${cy} c\n`;
        streamContent += `${cx - rx} ${cy + k*ry} ${cx - k*rx} ${cy + ry} ${cx} ${cy + ry} c\n`;
        streamContent += ann.fillColor ? 'B\n' : 'S\n';
        break;
      }
      case 'line': {
        // Skip AP stream for lines and arrows - let PDF viewers render natively
        // from /L, /LE, and /BS entries. Custom AP streams cause coordinate
        // mismatches between BBox and Rect, and override native arrowhead rendering.
        return null;
      }
      case 'draw': {
        if (!ann.path || ann.path.length < 2) return null;
        const xs = ann.path.map(p => p.x);
        const ys = ann.path.map(p => p.y);
        const minX = Math.min(...xs) - 2;
        const minY = Math.min(...ys) - 2;
        const maxX = Math.max(...xs) + 2;
        const maxY = Math.max(...ys) + 2;
        bbox = [0, 0, maxX - minX, maxY - minY];
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        const lw = ann.lineWidth || 2;
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        streamContent += `${ann.path[0].x - minX} ${maxY - ann.path[0].y} m\n`;
        for (let i = 1; i < ann.path.length; i++) {
          streamContent += `${ann.path[i].x - minX} ${maxY - ann.path[i].y} l\n`;
        }
        streamContent += 'S\n';
        break;
      }
      case 'text':
      case 'textbox':
      case 'callout': {
        // Skip AP stream for FreeText - let PDF viewers render from Contents + DA
        // natively, which properly displays text. AP stream only draws shapes,
        // causing text to disappear in viewers that use AP over DA.
        return null;
      }
      default:
        return null;
    }

    if (!streamContent || !bbox) return null;

    return context.stream(streamContent, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: bbox
    });
  } catch (e) {
    console.warn('Failed to generate appearance stream for', ann.type, e);
    return null;
  }
}

// Map CSS font family + bold/italic to PDF standard font name for DA string
function mapFontToPdfName(fontFamily, bold, italic) {
  const f = (fontFamily || '').toLowerCase();

  // Map well-known CSS fonts to PDF standard 14 font names
  if (f.includes('courier') || f === 'mono' || f === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (f.includes('times') || (f.includes('serif') && !f.includes('sans'))) {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (f === 'helvetica' || f === 'arial' || f === 'sans-serif') {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helv';
  }

  // For non-standard fonts, preserve the actual name as CamelCase (no spaces)
  // The loader's mapPdfFontName re-inserts spaces from CamelCase (e.g. "SegoeUI" → "Segoe UI")
  let baseName = (fontFamily || 'Helvetica').replace(/\s+/g, '');
  let suffix = '';
  if (bold && italic) suffix = '-BoldItalic';
  else if (bold) suffix = '-Bold';
  else if (italic) suffix = '-Italic';
  return baseName + suffix;
}

// Ensure AcroForm Default Resources contain fonts used by FreeText annotations
// so DA strings can reference them (e.g. /Helv, /Courier, /SegoeUI)
function ensureAcroFormFonts(pdfDoc, context, usedFonts) {
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;

  // Get or create AcroForm dictionary
  let acroFormRef = catalog.get(PDFName.of('AcroForm'));
  let acroForm;
  if (acroFormRef) {
    acroForm = context.lookup(acroFormRef);
  }
  if (!acroForm) {
    acroForm = context.obj({ Fields: [] });
    acroFormRef = context.register(acroForm);
    catalog.set(PDFName.of('AcroForm'), acroFormRef);
  }

  // Get or create DR (Default Resources) dictionary
  let drRef = acroForm.get(PDFName.of('DR'));
  let dr;
  if (drRef) {
    dr = context.lookup(drRef);
  }
  if (!dr) {
    dr = context.obj({});
    acroForm.set(PDFName.of('DR'), dr);
  }

  // Get or create Font dictionary within DR
  let fontDictRef = dr.get(PDFName.of('Font'));
  let fontDict;
  if (fontDictRef) {
    fontDict = context.lookup(fontDictRef);
  }
  if (!fontDict) {
    fontDict = context.obj({});
    dr.set(PDFName.of('Font'), fontDict);
  }

  // Add standard 14 fonts
  const standardFonts = [
    'Helv', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'
  ];
  const baseFontMap = { 'Helv': 'Helvetica' };

  for (const fontName of standardFonts) {
    if (!fontDict.get(PDFName.of(fontName))) {
      const baseFont = baseFontMap[fontName] || fontName;
      fontDict.set(PDFName.of(fontName), context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: baseFont,
        Encoding: 'WinAnsiEncoding'
      }));
    }
  }

  // Also register any non-standard fonts actually used by annotations
  // (e.g. "SegoeUI", "SegoeUI-Bold") so viewers can resolve the DA font reference
  if (usedFonts) {
    for (const fontName of usedFonts) {
      if (!fontDict.get(PDFName.of(fontName))) {
        // Extract base name (without style suffix) for BaseFont
        const baseFont = fontName.replace(/-(Bold|Italic|BoldItalic|BoldOblique|Oblique)$/, '');
        fontDict.set(PDFName.of(fontName), context.obj({
          Type: 'Font',
          Subtype: 'TrueType',
          BaseFont: fontName,
          Encoding: 'WinAnsiEncoding'
        }));
      }
    }
  }
}

// Compute annotation flags (F entry) from annotation properties
function computeAnnotFlags(ann) {
  let flags = 0;
  if (ann.printable !== false) flags |= 4;   // Bit 3: Print (default on)
  if (ann.readOnly) flags |= 64;              // Bit 7: ReadOnly
  if (ann.locked) flags |= 128;               // Bit 8: Locked
  return flags;
}

// Convert hex color to RGB values (0-1 range)
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ];
}
