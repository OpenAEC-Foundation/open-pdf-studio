import { state, getPageRotation } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/dialogs.js';
import { hexToColorArray } from '../utils/colors.js';
import { markDocumentSaved, updateWindowTitle } from '../ui/tabs.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog } from '../tauri-api.js';
import { getCachedPdfBytes } from './loader.js';
import { PDFDocument, PDFString, PDFName, PDFArray, PDFStream, degrees } from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';

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
              F: 4
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
              F: 4
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
              F: 4
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

          case 'stamp': {
            // Stamp annotation
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
              F: 4
            });
            break;
          }

          case 'signature': {
            // Save signature as Stamp annotation
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: 'Signature',
              Contents: PDFString.of('Signature'),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            });
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
              F: 4
            });
            break;
          }
        }

        // Generate appearance stream for better compatibility with other PDF viewers
        if (annotDict) {
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
      case 'line':
      case 'arrow': {
        const x1 = ann.startX, y1s = ann.startY, x2 = ann.endX, y2s = ann.endY;
        const minX = Math.min(x1, x2) - 5;
        const minY = Math.min(y1s, y2s) - 5;
        const maxX = Math.max(x1, x2) + 5;
        const maxY = Math.max(y1s, y2s) + 5;
        bbox = [0, 0, maxX - minX, maxY - minY];
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        const lw = ann.lineWidth || 2;
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        streamContent += `${x1 - minX} ${maxY - y1s} m ${x2 - minX} ${maxY - y2s} l S\n`;
        break;
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
