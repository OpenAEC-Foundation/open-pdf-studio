import { state } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/dialogs.js';
import { hexToColorArray } from '../utils/colors.js';
import { markDocumentSaved, updateWindowTitle } from '../ui/tabs.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog } from '../tauri-api.js';
import { getCachedPdfBytes } from './loader.js';
import { PDFDocument, PDFString, PDFName, PDFArray } from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';

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
    let existingPdfBytes = getCachedPdfBytes(state.currentPdfPath);
    if (!existingPdfBytes) {
      existingPdfBytes = await readBinaryFile(state.currentPdfPath);
    }

    const pdfDocLib = await PDFDocument.load(existingPdfBytes);

    // Get the PDF pages
    const pages = pdfDocLib.getPages();
    const context = pdfDocLib.context;

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
      const pageHeight = page.getHeight();
      const pageAnnotations = annotationsByPage[pageNum] || [];

      if (pageAnnotations.length === 0) continue;

      // Helper to convert Y coordinate (flip for PDF)
      const convertY = (y) => pageHeight - y;

      // Get or create annotations array for the page
      const annotsRef = page.node.get(PDFName.of('Annots'));
      let annotsArray;
      if (annotsRef) {
        const lookedUp = context.lookup(annotsRef);
        if (lookedUp instanceof PDFArray) {
          annotsArray = lookedUp.asArray().slice(); // Clone
        } else {
          annotsArray = [];
        }
      } else {
        annotsArray = [];
      }

      // Add our annotations
      for (const ann of pageAnnotations) {
        const colorArr = hexToColorArray(ann.color || '#000000');
        const opacity = ann.opacity !== undefined ? ann.opacity : 1;
        const borderWidth = ann.lineWidth || 2;

        let annotDict;

        switch (ann.type) {
          case 'highlight': {
            // Highlight annotation
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            // Build QuadPoints (4 corners of highlight area)
            const quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Highlight',
              Rect: [x1, y1, x2, y2],
              QuadPoints: quadPoints,
              C: hexToColorArray(ann.fillColor || ann.color),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
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

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [x1, y1, x2, y2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary
            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
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
              F: 4
            };

            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'line': {
            // Line annotation
            const x1 = ann.startX;
            const y1 = convertY(ann.startY);
            const x2 = ann.endX;
            const y2 = convertY(ann.endY);

            const rectX1 = Math.min(x1, x2) - borderWidth;
            const rectY1 = Math.min(y1, y2) - borderWidth;
            const rectX2 = Math.max(x1, x2) + borderWidth;
            const rectY2 = Math.max(y1, y2) + borderWidth;

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
              F: 4
            };

            lineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

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
              F: 4
            };

            inkDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
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
              F: 4
            };

            polylineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            annotDict = context.obj(polylineDict);
            break;
          }

          case 'polygon':
          case 'cloud': {
            // Polygon annotation
            if (!ann.points || ann.points.length < 3) {
              // Generate points from bounding box for regular polygon
              const cx = ann.x + ann.width / 2;
              const cy = ann.y + ann.height / 2;
              const rx = ann.width / 2;
              const ry = ann.height / 2;
              const sides = ann.sides || 6;

              const vertices = [];
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

              for (let i = 0; i < sides; i++) {
                const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
                const px = cx + rx * Math.cos(angle);
                const py = convertY(cy + ry * Math.sin(angle));
                vertices.push(px, py);
                minX = Math.min(minX, px); maxX = Math.max(maxX, px);
                minY = Math.min(minY, py); maxY = Math.max(maxY, py);
              }

              const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

              const polygonDict = {
                Type: 'Annot',
                Subtype: 'Polygon',
                Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
                Vertices: vertices,
                C: strokeColorArr,
                CA: opacity,
                T: PDFString.of(ann.author || 'User'),
                Contents: PDFString.of(ann.subject || ''),
                M: PDFString.of(new Date().toISOString()),
                F: 4
              };

              polygonDict.BS = context.obj({
                Type: 'Border',
                W: borderWidth,
                S: 'S'
              });

              if (ann.fillColor && ann.fillColor !== 'none') {
                polygonDict.IC = hexToColorArray(ann.fillColor);
              }

              annotDict = context.obj(polygonDict);
            }
            break;
          }

          case 'text':
          case 'textbox':
          case 'callout': {
            // FreeText annotation
            const x1 = ann.x;
            const y1 = convertY(ann.y + (ann.height || 50));
            const x2 = ann.x + (ann.width || 150);
            const y2 = convertY(ann.y);

            const fontSize = ann.fontSize || 14;
            const textColorArr = ann.textColor ? hexToColorArray(ann.textColor) : [0, 0, 0];

            // Default appearance string for text rendering
            const da = `${textColorArr[0]} ${textColorArr[1]} ${textColorArr[2]} rg /Helv ${fontSize} Tf`;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'FreeText',
              Rect: [x1, y1, x2, y2],
              Contents: PDFString.of(ann.text || ''),
              DA: PDFString.of(da),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Border
            if (ann.strokeColor && ann.strokeColor !== 'none') {
              annDictObj.C = hexToColorArray(ann.strokeColor);
            }

            // Interior color (background)
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            // Callout line
            if (ann.type === 'callout' && ann.arrowX !== undefined) {
              const arrowX = ann.arrowX;
              const arrowY = convertY(ann.arrowY);
              const kneeX = ann.kneeX !== undefined ? ann.kneeX : arrowX;
              const kneeY = ann.kneeY !== undefined ? convertY(ann.kneeY) : arrowY;

              // CL array: [arrowX, arrowY, kneeX, kneeY, textX, textY]
              const textConnectionX = ann.arrowX < (ann.x + (ann.width || 150) / 2) ? x1 : x2;
              const textConnectionY = (y1 + y2) / 2;
              annDictObj.CL = [arrowX, arrowY, kneeX, kneeY, textConnectionX, textConnectionY];
              annDictObj.IT = 'FreeTextCallout';
            }

            annotDict = context.obj(annDictObj);
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
              F: 4
            });
            break;
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
    await writeBinaryFile(outputPath, new Uint8Array(pdfBytes));

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
