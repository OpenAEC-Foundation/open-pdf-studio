import { state, getActiveDocument } from '../core/state.js';
import { placeholder, pdfContainer, fileInfo } from '../ui/dom-elements.js';
import { showLoading, hideLoading } from '../ui/dialogs.js';
import { updateAllStatus } from '../ui/status-bar.js';
import { renderPage, setViewMode } from './renderer.js';
import { createAnnotation } from '../annotations/factory.js';
import { generateImageId } from '../utils/helpers.js';
import { colorArrayToHex } from '../utils/colors.js';
import { generateThumbnails } from '../ui/left-panel.js';
import { createTab, updateWindowTitle } from '../ui/tabs.js';
import * as pdfjsLib from '../../pdfjs/build/pdf.mjs';
import { isTauri, readBinaryFile, openFileDialog } from '../tauri-api.js';

// Cache for original PDF bytes (used by saver to avoid re-reading)
const originalBytesCache = new Map(); // filePath -> Uint8Array

export function getCachedPdfBytes(filePath) {
  return originalBytesCache.get(filePath);
}

export function clearCachedPdfBytes(filePath) {
  if (filePath) {
    originalBytesCache.delete(filePath);
  } else {
    originalBytesCache.clear();
  }
}

// Set worker source (path relative to HTML file, not this module)
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/build/pdf.worker.mjs';

// Load PDF from file path
export async function loadPDF(filePath) {
  try {
    showLoading('Loading PDF...');

    let typedArray;

    if (isTauri()) {
      // Read file using Tauri fs plugin
      const data = await readBinaryFile(filePath);
      typedArray = new Uint8Array(data);

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      originalBytesCache.set(filePath, typedArray.slice());
    } else {
      // Fallback for browser environment (e.g., via fetch for local dev)
      throw new Error('File system access not available');
    }

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    state.pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
    state.currentPdfPath = filePath;

    // Reset annotation state
    state.annotations = [];
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) { doc.undoStack = []; doc.redoStack = []; }
    state.selectedAnnotation = null;
    state.currentPage = 1;

    // Load existing annotations from PDF
    await loadExistingAnnotations();

    // Show PDF container, hide placeholder
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    // Show PDF controls in status bar
    const pdfControls = document.getElementById('pdf-controls');
    if (pdfControls) pdfControls.style.display = 'flex';

    // Update file info
    const fileName = filePath.split(/[\\/]/).pop();
    fileInfo.textContent = fileName;

    // Render first page
    await setViewMode(state.viewMode);

    // Generate thumbnails for left panel
    generateThumbnails();

    // Update status bar
    updateAllStatus();

    // Update window title
    updateWindowTitle();

  } catch (error) {
    console.error('Error loading PDF:', error);
    alert('Failed to load PDF: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  if (!isTauri()) {
    console.warn('File dialogs require Tauri environment');
    return;
  }

  try {
    const result = await openFileDialog();
    if (result) {
      // Create a new tab for the file (will switch to existing tab if already open)
      createTab(result);
      await loadPDF(result);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
  }
}

// Load existing annotations from PDF
export async function loadExistingAnnotations() {
  if (!state.pdfDoc) return;

  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 }); // Use scale 1 for coordinate conversion
    const annotations = await page.getAnnotations();

    for (const annot of annotations) {
      const converted = convertPdfAnnotation(annot, pageNum, viewport);
      if (converted) {
        state.annotations.push(converted);
      }
    }
  }
}

// Convert PDF annotation to our format
function convertPdfAnnotation(annot, pageNum, viewport) {
  const pageHeight = viewport.height;

  // Helper to convert Y coordinate
  const convertY = (pdfY) => pageHeight - pdfY;

  // Helper to parse PDF dates (format: D:YYYYMMDDHHmmSS or similar)
  const parsePdfDate = (pdfDate) => {
    if (!pdfDate) return new Date().toISOString();
    try {
      // Handle PDF date format D:YYYYMMDDHHmmSS
      if (typeof pdfDate === 'string' && pdfDate.startsWith('D:')) {
        const dateStr = pdfDate.substring(2);
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6) || '01';
        const day = dateStr.substring(6, 8) || '01';
        const hour = dateStr.substring(8, 10) || '00';
        const min = dateStr.substring(10, 12) || '00';
        const sec = dateStr.substring(12, 14) || '00';
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
      }
      // Try direct parsing
      const date = new Date(pdfDate);
      if (isNaN(date.getTime())) return new Date().toISOString();
      return date.toISOString();
    } catch {
      return new Date().toISOString();
    }
  };

  // Get common properties
  const rect = annot.rect;
  if (!rect || rect.length < 4) return null;

  const baseProps = {
    page: pageNum,
    author: annot.title || 'User',
    subject: annot.subject || '',
    createdAt: parsePdfDate(annot.creationDate),
    modifiedAt: parsePdfDate(annot.modificationDate),
    opacity: annot.opacity !== undefined ? annot.opacity : 1.0,
    locked: annot.isLocked || false,
    printable: annot.isPrintable !== false,
    readOnly: annot.readOnly || false,
    marked: annot.isMarked || false
  };

  switch (annot.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      // Map PDF subtype to our type
      const typeMap = {
        'Highlight': 'textHighlight',
        'Underline': 'textUnderline',
        'StrikeOut': 'textStrikethrough',
        'Squiggly': 'textSquiggly'
      };
      const markupType = typeMap[annot.subtype] || 'highlight';

      // Extract rects from quadPoints for per-line markup
      const rects = [];
      if (annot.quadPoints && annot.quadPoints.length >= 8) {
        for (let i = 0; i < annot.quadPoints.length; i += 8) {
          const xs = [annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]];
          const ys = [annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]];
          const qMinX = Math.min(...xs);
          const qMaxX = Math.max(...xs);
          const qMinY = Math.min(...ys);
          const qMaxY = Math.max(...ys);
          rects.push({ x: qMinX, y: convertY(qMaxY), width: qMaxX - qMinX, height: qMaxY - qMinY });
        }
      }

      // Calculate overall bounding box
      let minX, maxX, minY, maxY;
      if (rects.length > 0) {
        minX = Math.min(...rects.map(r => r.x));
        maxX = Math.max(...rects.map(r => r.x + r.width));
        minY = Math.min(...rects.map(r => r.y));
        maxY = Math.max(...rects.map(r => r.y + r.height));
      } else {
        minX = rect[0];
        maxX = rect[2];
        minY = convertY(rect[3]);
        maxY = convertY(rect[1]);
      }

      return createAnnotation({
        ...baseProps,
        type: markupType,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rects: rects.length > 0 ? rects : undefined,
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00')
      });
    }

    case 'Square':
      return createAnnotation({
        ...baseProps,
        type: 'box',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: annot.borderStyle?.style === 1 ? 'dashed' : 'solid'
      });

    case 'Circle':
      return createAnnotation({
        ...baseProps,
        type: 'circle',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: annot.borderStyle?.style === 1 ? 'dashed' : 'solid'
      });

    case 'Line':
      if (annot.lineCoordinates && annot.lineCoordinates.length >= 4) {
        // Check for line endings (arrow heads)
        const le = annot.lineEndings || [];
        const mapPdfHead = (h) => {
          switch (h) {
            case 'OpenArrow': return 'open';
            case 'ClosedArrow': return 'closed';
            case 'Diamond': return 'diamond';
            case 'Circle': return 'circle';
            case 'Square': return 'square';
            case 'Slash': return 'slash';
            case 'Butt': return 'butt';
            default: return 'none';
          }
        };
        const startHead = mapPdfHead(le[0]);
        const endHead = mapPdfHead(le[1]);
        const isArrow = startHead !== 'none' || endHead !== 'none';
        const borderStyle = annot.borderStyle?.style === 1 ? 'dashed' : 'solid';

        return createAnnotation({
          ...baseProps,
          type: isArrow ? 'arrow' : 'line',
          startX: annot.lineCoordinates[0],
          startY: convertY(annot.lineCoordinates[1]),
          endX: annot.lineCoordinates[2],
          endY: convertY(annot.lineCoordinates[3]),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : undefined,
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: borderStyle,
          startHead: startHead,
          endHead: endHead,
          headSize: 12
        });
      }
      break;

    case 'Ink':
      // Freehand drawing
      if (annot.inkLists && annot.inkLists.length > 0) {
        const path = [];
        const inkList = annot.inkLists[0];
        for (let i = 0; i < inkList.length; i += 2) {
          path.push({
            x: inkList[i],
            y: convertY(inkList[i + 1])
          });
        }
        return createAnnotation({
          ...baseProps,
          type: 'draw',
          path: path,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2
        });
      }
      break;

    case 'PolyLine':
      if (annot.vertices && annot.vertices.length >= 4) {
        const points = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          points.push({
            x: annot.vertices[i],
            y: convertY(annot.vertices[i + 1])
          });
        }
        return createAnnotation({
          ...baseProps,
          type: 'polyline',
          points: points,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2
        });
      }
      break;

    case 'Polygon':
      if (annot.vertices && annot.vertices.length >= 6) {
        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < annot.vertices.length; i += 2) {
          minX = Math.min(minX, annot.vertices[i]);
          maxX = Math.max(maxX, annot.vertices[i]);
          minY = Math.min(minY, annot.vertices[i + 1]);
          maxY = Math.max(maxY, annot.vertices[i + 1]);
        }
        return createAnnotation({
          ...baseProps,
          type: 'polygon',
          x: minX,
          y: convertY(maxY),
          width: maxX - minX,
          height: maxY - minY,
          sides: Math.floor(annot.vertices.length / 2),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : null,
          lineWidth: annot.borderStyle?.width || 2
        });
      }
      break;

    case 'Text':
      // Sticky note annotation
      return createAnnotation({
        ...baseProps,
        type: 'comment',
        x: rect[0],
        y: convertY(rect[3]),
        width: 24,
        height: 24,
        text: annot.contents || '',
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00'),
        icon: annot.name || 'comment'
      });

    case 'FreeText': {
      // Extract font size and text color from DA string
      let fontSize = 14;
      let textColor = '#000000';
      if (annot.defaultAppearanceData) {
        if (annot.defaultAppearanceData.fontSize) fontSize = annot.defaultAppearanceData.fontSize;
        if (annot.defaultAppearanceData.fontColor) {
          const fc = annot.defaultAppearanceData.fontColor;
          if (fc.length === 3) textColor = colorArrayToHex(fc, '#000000');
        }
      } else if (annot.defaultAppearance) {
        // Parse DA string: "r g b rg /Font size Tf"
        const sizeMatch = annot.defaultAppearance.match(/(\d+(?:\.\d+)?)\s+Tf/);
        if (sizeMatch) fontSize = parseFloat(sizeMatch[1]);
        const colorMatch = annot.defaultAppearance.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
        if (colorMatch) {
          textColor = colorArrayToHex([parseFloat(colorMatch[1]), parseFloat(colorMatch[2]), parseFloat(colorMatch[3])], '#000000');
        }
      }

      const isCallout = annot.calloutLine && annot.calloutLine.length >= 4;
      const borderStyle = annot.borderStyle?.style === 1 ? 'dashed' : 'solid';

      if (isCallout) {
        return createAnnotation({
          ...baseProps,
          type: 'callout',
          x: rect[0],
          y: convertY(rect[3]),
          width: rect[2] - rect[0],
          height: rect[3] - rect[1],
          text: annot.contents || '',
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : '#FFFFD0',
          textColor: textColor,
          fontSize: fontSize,
          borderStyle: borderStyle,
          lineWidth: annot.borderStyle?.width || 1,
          arrowX: annot.calloutLine[0],
          arrowY: convertY(annot.calloutLine[1]),
          kneeX: annot.calloutLine.length >= 6 ? annot.calloutLine[2] : annot.calloutLine[0],
          kneeY: annot.calloutLine.length >= 6 ? convertY(annot.calloutLine[3]) : convertY(annot.calloutLine[1])
        });
      }

      return createAnnotation({
        ...baseProps,
        type: 'textbox',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        text: annot.contents || '',
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: annot.interiorColor ? colorArrayToHex(annot.interiorColor) : '#FFFFD0',
        textColor: textColor,
        fontSize: fontSize,
        borderStyle: borderStyle,
        lineWidth: annot.borderStyle?.width || 1
      });
    }

    case 'Stamp':
      // Image stamp - if we have appearance data
      if (annot.appearance) {
        const imageId = generateImageId();
        // For now, create a placeholder - full image extraction would require more work
        return createAnnotation({
          ...baseProps,
          type: 'image',
          x: rect[0],
          y: convertY(rect[3]),
          width: rect[2] - rect[0],
          height: rect[3] - rect[1],
          imageId: imageId,
          originalWidth: rect[2] - rect[0],
          originalHeight: rect[3] - rect[1],
          rotation: 0
        });
      }
      break;
  }

  return null;
}
