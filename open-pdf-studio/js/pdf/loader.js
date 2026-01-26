import { state } from '../core/state.js';
import { placeholder, pdfContainer, fileInfo } from '../ui/dom-elements.js';
import { showLoading, hideLoading } from '../ui/dialogs.js';
import { updateAllStatus } from '../ui/status-bar.js';
import { renderPage, setViewMode } from './renderer.js';
import { createAnnotation } from '../annotations/factory.js';
import { generateImageId } from '../utils/helpers.js';
import { colorArrayToHex } from '../utils/colors.js';
import { generateThumbnails } from '../ui/left-panel.js';
import * as pdfjsLib from '../../pdfjs/build/pdf.mjs';

// Set worker source (path relative to HTML file, not this module)
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/build/pdf.worker.mjs';

// Load PDF from file path
export async function loadPDF(filePath) {
  try {
    showLoading('Loading PDF...');

    // Read file using Node.js fs
    const fs = window.require('fs');
    const data = fs.readFileSync(filePath);
    const typedArray = new Uint8Array(data);

    // Load PDF using pdf.js
    state.pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
    state.currentPdfPath = filePath;

    // Reset annotation state
    state.annotations = [];
    state.redoStack = [];
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

  } catch (error) {
    console.error('Error loading PDF:', error);
    alert('Failed to load PDF: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  const { ipcRenderer } = window.require('electron');

  try {
    const result = await ipcRenderer.invoke('dialog:openFile');
    if (result) {
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
    case 'Squiggly':
      // Text markup annotations - use quadPoints if available
      if (annot.quadPoints && annot.quadPoints.length >= 8) {
        // Calculate bounding box from quad points
        const xs = [annot.quadPoints[0], annot.quadPoints[2], annot.quadPoints[4], annot.quadPoints[6]];
        const ys = [annot.quadPoints[1], annot.quadPoints[3], annot.quadPoints[5], annot.quadPoints[7]];
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return createAnnotation({
          ...baseProps,
          type: 'highlight',
          x: minX,
          y: convertY(maxY),
          width: maxX - minX,
          height: maxY - minY,
          color: colorArrayToHex(annot.color, '#FFFF00'),
          fillColor: colorArrayToHex(annot.color, '#FFFF00')
        });
      }
      // Fallback to rect
      return createAnnotation({
        ...baseProps,
        type: 'highlight',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00')
      });

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
        lineWidth: annot.borderStyle?.width || 2
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
        lineWidth: annot.borderStyle?.width || 2
      });

    case 'Line':
      if (annot.lineCoordinates && annot.lineCoordinates.length >= 4) {
        return createAnnotation({
          ...baseProps,
          type: 'line',
          startX: annot.lineCoordinates[0],
          startY: convertY(annot.lineCoordinates[1]),
          endX: annot.lineCoordinates[2],
          endY: convertY(annot.lineCoordinates[3]),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2
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

    case 'FreeText':
      // Text box or callout
      const isCallout = annot.calloutLine && annot.calloutLine.length >= 4;

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
          textColor: '#000000',
          fontSize: 14,
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
        textColor: '#000000',
        fontSize: 14
      });

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
