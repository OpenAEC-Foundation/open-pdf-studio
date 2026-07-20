import { state, imageCache } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { generateImageId } from '../../utils/helpers.js';
import { colorArrayToHex } from '../../utils/colors.js';
import { mapPdfFontName, mapBorderStyle } from './pdf-helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement } from '../../annotations/measurement.js';
import { findImageForAnnotation } from './annotation-image-sources.mjs';

// Convert PDF annotation to our format
export async function convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap) {
  // Helpers to convert PDF coordinates to viewport coordinates (handles CropBox/MediaBox offsets)
  const convertPoint = (pdfX, pdfY) => viewport.convertToViewportPoint(pdfX, pdfY);
  const convertRect = (pdfRect) => {
    const vr = viewport.convertToViewportRectangle(pdfRect);
    return {
      x: Math.min(vr[0], vr[2]),
      y: Math.min(vr[1], vr[3]),
      width: Math.abs(vr[2] - vr[0]),
      height: Math.abs(vr[3] - vr[1])
    };
  };

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

  // Look up extra colors extracted via pdf-lib (IC entry, appearance stream colors)
  const rectKey = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
  let extraColors = annotColorMap?.get(rectKey);
  // Fuzzy match fallback — pdf.js may expand Rect by borderWidth (up to several pts)
  // when annotations lack an appearance stream, causing mismatch with pdf-lib's raw Rect
  if (!extraColors && annotColorMap) {
    let bestDist = Infinity;
    for (const [k, v] of annotColorMap.entries()) {
      const parts = k.split(',').map(Number);
      if (parts.length === 4) {
        const d = Math.abs(parts[0] - rect[0]) + Math.abs(parts[1] - rect[1]) +
                  Math.abs(parts[2] - rect[2]) + Math.abs(parts[3] - rect[3]);
        if (d < bestDist && d < 8) {
          bestDist = d;
          extraColors = v;
        }
      }
    }
  }
  extraColors = extraColors || {};

  const baseProps = {
    page: pageNum,
    author: (annot.titleObj && annot.titleObj.str) || annot.title || 'User',
    subject: annot.subject || '',
    createdAt: parsePdfDate(annot.creationDate),
    modifiedAt: parsePdfDate(annot.modificationDate),
    opacity: annot.opacity !== undefined ? annot.opacity : (extraColors.opacity !== undefined ? extraColors.opacity : 1.0),
    locked: !!(annot.annotationFlags & 128),      // Bit 8: Locked
    printable: !!(annot.annotationFlags & 4),       // Bit 3: Print
    readOnly: !!(annot.annotationFlags & 64),       // Bit 7: ReadOnly
    marked: false
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
          rects.push(convertRect([qMinX, qMinY, qMaxX, qMaxY]));
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
        const fallback = convertRect(rect);
        minX = fallback.x;
        maxX = fallback.x + fallback.width;
        minY = fallback.y;
        maxY = fallback.y + fallback.height;
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

    case 'Square': {
      const squareImageData = findImageForAnnotation(stampImageMap, annot, 'square-image');
      if (squareImageData) {
        const imageRect = convertRect(rect);
        const imageId = generateImageId();
        const img = new Image();
        img.src = squareImageData;
        imageCache.set(imageId, img);
        return createAnnotation({
          ...baseProps,
          type: 'image',
          x: imageRect.x,
          y: imageRect.y,
          width: imageRect.width,
          height: imageRect.height,
          imageId,
          imageData: squareImageData,
          originalWidth: imageRect.width,
          originalHeight: imageRect.height,
          lockAspectRatio: true,
        });
      }

      // Parametric symbol: stored as Square + private OPS metadata
      if (extraColors.opsSubtype === 'parametricSymbol') {
        const psRect = convertRect(annot.rect);
        let params = {};
        try { if (extraColors.opsParams) params = JSON.parse(extraColors.opsParams); } catch (_) {}
        return createAnnotation({
          ...baseProps,
          type: 'parametricSymbol',
          x: psRect.x,
          y: psRect.y,
          width: psRect.width,
          height: psRect.height,
          symbolId: extraColors.opsSymbolId || '',
          params,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 1,
        });
      }
      // Maskeer (wipeout): Square + OPS_Subtype 'mask' — restore as the
      // dedicated type so the fixed white-cover rendering applies again.
      if (extraColors.opsSubtype === 'mask') {
        const mkRect = convertRect(annot.rect);
        return createAnnotation({
          ...baseProps,
          type: 'mask',
          x: mkRect.x,
          y: mkRect.y,
          width: mkRect.width,
          height: mkRect.height,
          rotation: extraColors.rotation || 0,
          color: colorArrayToHex(annot.color, '#9a9a9a'),
          strokeColor: colorArrayToHex(annot.color, '#9a9a9a'),
          fillColor: '#ffffff',
          lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 0.75,
          borderStyle: 'dash-dot',
          opacity: 1,
        });
      }
      // Redaction mark: Square + OPS_Subtype 'redaction' — restore the pending
      // mark (rendered as a red hatched overlay; overlayColor is the black-out
      // colour used when the redaction is applied).
      if (extraColors.opsSubtype === 'redaction') {
        const rdRect = convertRect(annot.rect);
        return createAnnotation({
          ...baseProps,
          type: 'redaction',
          x: rdRect.x,
          y: rdRect.y,
          width: rdRect.width,
          height: rdRect.height,
          overlayColor: extraColors.ic || '#000000',
        });
      }
      // Check for scheduleTable custom type
      if (extraColors.opsSubtype === 'scheduleTable') {
        const stRect = convertRect(annot.rect);
        let scheduleData = [];
        try {
          if (extraColors.opsScheduleData) scheduleData = JSON.parse(extraColors.opsScheduleData);
        } catch (e) { /* ignore parse errors */ }
        return createAnnotation({
          ...baseProps,
          type: 'scheduleTable',
          x: stRect.x,
          y: stRect.y,
          width: stRect.width,
          height: stRect.height,
          scheduleData,
          groupByMode: extraColors.opsGroupBy || 'type',
          color: '#000000',
          lineWidth: 0.5,
          opacity: 1,
        });
      }
      // Check for scaleRegion custom type
      if (extraColors.opsSubtype === 'scaleRegion') {
        const srRect = convertRect(annot.rect);
        return createAnnotation({
          ...baseProps,
          type: 'scaleRegion',
          x: srRect.x,
          y: srRect.y,
          width: srRect.width,
          height: srRect.height,
          scaleString: extraColors.opsScaleString || '1:100',
          units: extraColors.opsUnits || 'mm',
          label: extraColors.opsLabel || annot.contentsObj?.str || '',
          color: colorArrayToHex(annot.color, '#ff9800'),
          lineWidth: extraColors.opsLineWidth || 1.5,
          opacity: annot.opacity ?? 1,
          borderStyle: 'dashed',
        });
      }
      // Check for viewport or scaleBar custom types
      if (extraColors.opsSubtype === 'viewport') {
        const vpRect = convertRect(annot.rect);
        return createAnnotation({
          ...baseProps,
          type: 'viewport',
          x: vpRect.x,
          y: vpRect.y,
          width: vpRect.width,
          height: vpRect.height,
          name: annot.contentsObj?.str || 'Viewport',
          color: colorArrayToHex(annot.color, '#0066cc'),
          lineWidth: extraColors.opsLineWidth || 1.5,
          opacity: annot.opacity ?? 0.6,
          pixelsPerUnit: extraColors.opsPixelsPerUnit || (72 / (25.4 * 100)),
          unit: extraColors.opsUnit || 'mm',
          scaleRatio: extraColors.opsScaleRatio || '1:100',
        });
      }
      if (extraColors.opsSubtype === 'scaleBar') {
        const sbRect = convertRect(annot.rect);
        return createAnnotation({
          ...baseProps,
          type: 'scaleBar',
          x: sbRect.x,
          y: sbRect.y,
          width: sbRect.width,
          height: sbRect.height,
          color: colorArrayToHex(annot.color, '#000000'),
          lineWidth: extraColors.opsLineWidth || 1,
          opacity: annot.opacity ?? 1,
          pixelsPerUnit: extraColors.opsPixelsPerUnit || 1,
          unit: extraColors.opsUnit || 'mm',
          divisions: extraColors.opsDivisions || 5,
          totalUnits: extraColors.opsTotalUnits || 5000,
          rotation: extraColors.rotation || 0,
        });
      }

      const sqRect = convertRect(annot.rect);
      let sqX = sqRect.x, sqY = sqRect.y, sqW = sqRect.width, sqH = sqRect.height;
      let sqRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        sqRotation = Math.round(extraColors.rotation);
      } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
        sqRotation = -Math.round(extraColors.matrixAngle);
        // Rect is the expanded axis-aligned bounding box; recover original size from BBox
        if (extraColors.bboxWidth && extraColors.bboxHeight) {
          const pdfRectW = Math.abs(rect[2] - rect[0]);
          const vScale = pdfRectW > 0 ? sqRect.width / pdfRectW : 1;
          sqW = extraColors.bboxWidth * vScale;
          sqH = extraColors.bboxHeight * vScale;
          const cx = sqRect.x + sqRect.width / 2;
          const cy = sqRect.y + sqRect.height / 2;
          sqX = cx - sqW / 2;
          sqY = cy - sqH / 2;
        }
      }
      const sqProps = {
        ...baseProps,
        // Square met /BE-wolkrand = ons bestaande 'cloud'-type (rechthoekwolk).
        type: extraColors.borderCloudy ? 'cloud' : 'box',
        x: sqX,
        y: sqY,
        width: sqW,
        height: sqH,
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
        borderStyle: mapBorderStyle(annot, extraColors)
      };
      if (sqRotation) sqProps.rotation = sqRotation;
      return createAnnotation(sqProps);
    }

    case 'Circle': {
      const crRect = convertRect(annot.rect);
      let crX = crRect.x, crY = crRect.y, crW = crRect.width, crH = crRect.height;
      let crRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        crRotation = Math.round(extraColors.rotation);
      } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
        crRotation = -Math.round(extraColors.matrixAngle);
        if (extraColors.bboxWidth && extraColors.bboxHeight) {
          const pdfRectW = Math.abs(rect[2] - rect[0]);
          const vScale = pdfRectW > 0 ? crRect.width / pdfRectW : 1;
          crW = extraColors.bboxWidth * vScale;
          crH = extraColors.bboxHeight * vScale;
          const cx = crRect.x + crRect.width / 2;
          const cy = crRect.y + crRect.height / 2;
          crX = cx - crW / 2;
          crY = cy - crH / 2;
        }
      }
      const crProps = {
        ...baseProps,
        type: 'circle',
        x: crX,
        y: crY,
        width: crW,
        height: crH,
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
        borderStyle: mapBorderStyle(annot, extraColors)
      };
      if (crRotation) crProps.rotation = crRotation;
      return createAnnotation(crProps);
    }

    case 'Line':
      if (annot.lineCoordinates && annot.lineCoordinates.length >= 4) {
        // Use original /L coords from pdf-lib (PDF.js normalizeRect destroys direction)
        const lc = extraColors.lineCoords || annot.lineCoordinates;
        const [lsx, lsy] = convertPoint(lc[0], lc[1]);
        const [lex, ley] = convertPoint(lc[2], lc[3]);

        // Wall segment: /Line centreline + OPS thickness/material metadata.
        if (extraColors.opsSubtype === 'wall') {
          return createAnnotation({
            ...baseProps,
            type: 'wall',
            startX: lsx,
            startY: lsy,
            endX: lex,
            endY: ley,
            dikteMm: extraColors.opsDikteMm ?? 100,
            hatchPattern: extraColors.opsHatchPattern || 'none',
            hatchColor: extraColors.opsHatchColor || undefined,
            // undefined → the material's own density (WALL_MATERIALS.dens)
            hatchScale: extraColors.opsHatchScale ?? undefined,
            hatchAngle: extraColors.opsHatchAngle ?? 0,
            isolatieType: extraColors.opsIsolatieType || undefined,
            color: colorArrayToHex(annot.color, '#000000'),
            strokeColor: colorArrayToHex(annot.color, '#000000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 0.7,
          });
        }

        // Check if this is a measurement annotation (use pdf.js IT + colorMap fallback)
        const isMeasureDist = extraColors.opsSubtype === 'measureDistance' ||
                              extraColors.intent === 'LineDimension' ||
                              extraColors.hasMeasure ||
                              annot.it === 'LineDimension';
        if (isMeasureDist) {
          const mdProps = {
            ...baseProps,
            type: 'measureDistance',
            startX: lsx,
            startY: lsy,
            endX: lex,
            endY: ley,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
          };
          // Store per-annotation scale/unit/precision from PDF Measure dictionary
          if (extraColors.measureScale) {
            mdProps.measureScale = extraColors.measureScale;
            mdProps.measureUnit = extraColors.measureUnit || 'mm';
            if (extraColors.measurePrecision !== undefined) {
              mdProps.measurePrecision = extraColors.measurePrecision;
            }
          }
          // Get measurement text from Contents, or auto-calculate using annotation's own scale
          let mdText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!mdText) {
            if (mdProps.measureScale) {
              const prec = mdProps.measurePrecision || 2;
              const pixelDist = Math.sqrt((lex - lsx) ** 2 + (ley - lsy) ** 2);
              const scaledVal = pixelDist * mdProps.measureScale;
              const unit = mdProps.measureUnit || 'mm';
              mdText = `${scaledVal.toFixed(prec)} ${unit}`;
            } else {
              const dist = calculateDistance(lsx, lsy, lex, ley, pageNum);
              mdText = formatMeasurement(dist);
            }
          }
          mdProps.measureText = mdText;
          // Read line endings from PDF LE array
          const mdLe = annot.lineEndings || [];
          const mapMdHead = (h) => {
            switch (h) {
              case 'OpenArrow': return 'open';
              case 'ClosedArrow': return 'closed';
              case 'Diamond': return 'diamond';
              case 'Circle': return 'openCircle';
              case 'Square': return 'square';
              case 'Slash': return 'slash';
              case 'Butt': return 'butt';
              case 'ROpenArrow': return 'openReversed';
              case 'RClosedArrow': return 'closedReversed';
              default: return 'openCircle';
            }
          };
          if (mdLe.length >= 2) {
            mdProps.startHead = mapMdHead(mdLe[0]);
            mdProps.endHead = mapMdHead(mdLe[1]);
          } else {
            mdProps.startHead = 'openCircle';
            mdProps.endHead = 'openCircle';
          }
          mdProps.headSize = extraColors.opsHeadSize || 12;
          if (extraColors.opsPrecision != null) mdProps.measurePrecision = extraColors.opsPrecision;
          // User-dragged text offset (relative to dimension-line midpoint) —
          // written verbatim by the saver, read back verbatim here.
          if (extraColors.opsTextOffsetX != null) mdProps.textOffsetX = extraColors.opsTextOffsetX;
          if (extraColors.opsTextOffsetY != null) mdProps.textOffsetY = extraColors.opsTextOffsetY;
          // Compute dimension line position from PDF LL (leader length)
          // Per PDF spec: /L = base points on measured object, /LL = perpendicular
          // offset to the dimension line. Positive LL = counter-clockwise from /L direction.
          // Our data model: startX/Y = dimension line, leaderX/Y = base object points.
          const ll = extraColors.leaderLength;
          if (ll && ll !== 0) {
            const lineAngle = Math.atan2(lc[3] - lc[1], lc[2] - lc[0]);
            const perpX = -Math.sin(lineAngle);
            const perpY = Math.cos(lineAngle);
            // Dimension line endpoints = /L offset by LL along perpendicular
            const [dimX1, dimY1] = convertPoint(lc[0] + ll * perpX, lc[1] + ll * perpY);
            const [dimX2, dimY2] = convertPoint(lc[2] + ll * perpX, lc[3] + ll * perpY);
            // Swap: startX/Y = dimension line, leaderX/Y = /L base points
            mdProps.leaderStartX = lsx;
            mdProps.leaderStartY = lsy;
            mdProps.leaderEndX = lex;
            mdProps.leaderEndY = ley;
            mdProps.startX = dimX1;
            mdProps.startY = dimY1;
            mdProps.endX = dimX2;
            mdProps.endY = dimY2;
          }
          return createAnnotation(mdProps);
        }

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
            case 'ROpenArrow': return 'openReversed';
            case 'RClosedArrow': return 'closedReversed';
            default: return 'none';
          }
        };
        const startHead = mapPdfHead(le[0]);
        const endHead = mapPdfHead(le[1]);
        const isArrow = startHead !== 'none' || endHead !== 'none';

        return createAnnotation({
          ...baseProps,
          type: isArrow ? 'arrow' : 'line',
          startX: lsx,
          startY: lsy,
          endX: lex,
          endY: ley,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || undefined,
          lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
          borderStyle: mapBorderStyle(annot, extraColors),
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
          const [ipx, ipy] = convertPoint(inkList[i], inkList[i + 1]);
          path.push({ x: ipx, y: ipy });
        }
        return createAnnotation({
          ...baseProps,
          type: 'draw',
          path: path,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        });
      }
      break;

    case 'PolyLine':
      if (annot.vertices && annot.vertices.length >= 4) {
        const plPoints = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          const [plx, ply] = convertPoint(annot.vertices[i], annot.vertices[i + 1]);
          plPoints.push({ x: plx, y: ply });
        }

        // Textbox leader: PolyLine with our custom OPS_Subtype linked via IRT.
        // Anchor (first vertex) is recomputed at render time; keep knee + tip.
        if (extraColors.opsSubtype === 'textboxLeader' && plPoints.length >= 3 &&
            extraColors.irtRectKey) {
          // LE entry: ['/None', '/Circle' or '/OpenArrow' etc.]
          const le = annot.lineEndings || [];
          const endStyle = (le[1] === 'Circle') ? 'circle' : 'arrow';
          return {
            __textboxLeader: true,
            page: pageNum,
            irtRectKey: extraColors.irtRectKey,
            leader: {
              id: extraColors.opsLeaderId || (Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
              kneeX: plPoints[1].x,
              kneeY: plPoints[1].y,
              tipX: plPoints[plPoints.length - 1].x,
              tipY: plPoints[plPoints.length - 1].y,
              endStyle,
            },
          };
        }

        // Check if this is an angle measurement
        if (extraColors.opsSubtype === 'measureAngle' && plPoints.length >= 3) {
          const point1 = plPoints[0];
          const vertex = plPoints[1];
          const point2 = plPoints[2];
          const a1 = Math.atan2(point1.y - vertex.y, point1.x - vertex.x);
          const a2 = Math.atan2(point2.y - vertex.y, point2.x - vertex.x);
          let angleDeg = (a2 - a1) * (180 / Math.PI);
          if (angleDeg < 0) angleDeg += 360;
          if (angleDeg > 180) angleDeg = 360 - angleDeg;
          return createAnnotation({
            ...baseProps,
            type: 'measureAngle',
            point1, vertex, point2,
            arcRadius: extraColors.opsArcRadius || 30,
            measureValue: angleDeg,
            measureText: angleDeg.toFixed(1) + '\u00B0',
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
          });
        }

        // Check if this is a perimeter measurement (use pdf.js IT + colorMap fallback)
        const isMeasurePerim = extraColors.opsSubtype === 'measurePerimeter' ||
                               extraColors.intent === 'PolyLineDimension' ||
                               extraColors.hasMeasure ||
                               annot.it === 'PolyLineDimension';
        if (isMeasurePerim) {
          let mpText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!mpText) {
            const perim = calculatePerimeter(plPoints, pageNum);
            mpText = formatMeasurement(perim);
          }
          const mpProps = {
            ...baseProps,
            type: 'measurePerimeter',
            points: plPoints,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
            borderStyle: mapBorderStyle(annot, extraColors),
            measureText: mpText,
          };
          // Read line endings from PDF LE array
          const mpLe = annot.lineEndings || [];
          if (mpLe.length >= 2) {
            const mapHead = (h) => {
              switch (h) {
                case 'OpenArrow': return 'open';
                case 'ClosedArrow': return 'closed';
                case 'Diamond': return 'diamond';
                case 'Circle': return 'circle';
                case 'Square': return 'square';
                case 'Slash': return 'slash';
                case 'Butt': return 'butt';
                case 'ROpenArrow': return 'openReversed';
                case 'RClosedArrow': return 'closedReversed';
                default: return 'none';
              }
            };
            mpProps.startHead = mapHead(mpLe[0]);
            mpProps.endHead = mapHead(mpLe[1]);
          }
          mpProps.headSize = extraColors.opsHeadSize || 12;
          if (extraColors.measureScale) {
            mpProps.measureScale = extraColors.measureScale;
            mpProps.measureUnit = extraColors.measureUnit || 'mm';
            if (extraColors.measurePrecision !== undefined) {
              mpProps.measurePrecision = extraColors.measurePrecision;
            }
          }
          if (extraColors.opsPrecision != null) mpProps.measurePrecision = extraColors.opsPrecision;
          return createAnnotation(mpProps);
        }

        // Check if this is a curved (spline) arrow — issue #267. Rebuild from
        // the clicked control points (OPS_Points) so it reloads as editable.
        if (extraColors.opsSubtype === 'splineArrow' && extraColors.opsPoints && extraColors.opsPoints.length >= 4) {
          const saPts = [];
          for (let i = 0; i < extraColors.opsPoints.length; i += 2) {
            const [sx, sy] = convertPoint(extraColors.opsPoints[i], extraColors.opsPoints[i + 1]);
            saPts.push({ x: sx, y: sy });
          }
          const saMapHead = (h) => {
            switch (h) {
              case 'OpenArrow': return 'open';
              case 'ClosedArrow': return 'closed';
              case 'Diamond': return 'diamond';
              case 'Circle': return 'circle';
              case 'Square': return 'square';
              case 'Slash': return 'slash';
              case 'Butt': return 'butt';
              case 'ROpenArrow': return 'openReversed';
              case 'RClosedArrow': return 'closedReversed';
              default: return 'none';
            }
          };
          const saLe = annot.lineEndings || [];
          return createAnnotation({
            ...baseProps,
            type: 'splineArrow',
            points: saPts,
            color: colorArrayToHex(annot.color, '#000000'),
            strokeColor: colorArrayToHex(annot.color, '#000000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
            borderStyle: mapBorderStyle(annot, extraColors),
            startHead: saLe.length >= 2 ? saMapHead(saLe[0]) : 'none',
            endHead: saLe.length >= 2 ? saMapHead(saLe[1]) : 'open',
            headSize: extraColors.opsHeadSize || 8,
          });
        }

        // Check if this is a spline
        if (extraColors.opsSubtype === 'spline' && extraColors.opsPoints && extraColors.opsPoints.length >= 6) {
          const splineControlPts = [];
          for (let i = 0; i < extraColors.opsPoints.length; i += 2) {
            const [sx, sy] = convertPoint(extraColors.opsPoints[i], extraColors.opsPoints[i + 1]);
            splineControlPts.push({ x: sx, y: sy });
          }
          return createAnnotation({
            ...baseProps,
            type: 'spline',
            controlPoints: splineControlPts,
            color: colorArrayToHex(annot.color, '#000000'),
            strokeColor: colorArrayToHex(annot.color, '#000000'),
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
            borderStyle: mapBorderStyle(annot, extraColors),
          });
        }

        return createAnnotation({
          ...baseProps,
          type: 'polyline',
          points: plPoints,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        });
      }
      break;

    case 'Polygon':
      if (annot.vertices && annot.vertices.length >= 6) {
        // Calculate bounding box and points in viewport coordinates
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const polyPoints = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          const [pvx, pvy] = convertPoint(annot.vertices[i], annot.vertices[i + 1]);
          polyPoints.push({ x: pvx, y: pvy });
          minX = Math.min(minX, pvx);
          maxX = Math.max(maxX, pvx);
          minY = Math.min(minY, pvy);
          maxY = Math.max(maxY, pvy);
        }

        // Check if this is a filled-area annotation (our private subtype).
        if (extraColors.opsSubtype === 'filledArea') {
          // Re-attach arc/bulge metadata to the outer points so rendering and
          // hit-testing reproduce the original curves.
          if (extraColors.opsArcFlags && extraColors.opsArcFlags.length === polyPoints.length) {
            for (let i = 0; i < polyPoints.length; i++) {
              if (extraColors.opsArcFlags[i]) {
                polyPoints[i].arc = true;
                polyPoints[i].bulge = (extraColors.opsArcBulges && extraColors.opsArcBulges[i] != null)
                  ? extraColors.opsArcBulges[i]
                  : 0.3;
              }
            }
          }
          const faProps = {
            ...baseProps,
            type: 'filledArea',
            points: polyPoints,
            color: colorArrayToHex(annot.color, '#000000'),
            strokeColor: colorArrayToHex(annot.color, '#000000'),
            fillColor: extraColors.ic || null,
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
            borderStyle: mapBorderStyle(annot, extraColors),
            x: minX, y: minY,
            width: maxX - minX, height: maxY - minY,
            hatchPattern: extraColors.opsHatchPattern || 'none',
            hatchColor: extraColors.opsHatchColor || '#000000',
            hatchScale: extraColors.opsHatchScale ?? 100,
            hatchAngle: extraColors.opsHatchAngle ?? 0,
          };
          if (extraColors.holes && extraColors.holes.length > 0) {
            const holeArcFlags = extraColors.opsHoleArcFlags || [];
            const holeArcBulges = extraColors.opsHoleArcBulges || [];
            faProps.holes = extraColors.holes.map((hole, hi) => {
              const flags = holeArcFlags[hi];
              const bulges = holeArcBulges[hi];
              return hole.map((pt, pi) => {
                const [hx, hy] = convertPoint(pt.x, pt.y);
                const out = { x: hx, y: hy };
                if (flags && flags[pi]) {
                  out.arc = true;
                  out.bulge = (bulges && bulges[pi] != null) ? bulges[pi] : 0.3;
                }
                return out;
              });
            });
          }
          return createAnnotation(faProps);
        }

        // Check if this is an area measurement (use pdf.js IT + colorMap fallback)
        const isMeasureArea = extraColors.opsSubtype === 'measureArea' ||
                              extraColors.intent === 'PolygonDimension' ||
                              (extraColors.hasMeasure && !extraColors.opsSubtype) ||
                              annot.it === 'PolygonDimension';
        if (isMeasureArea) {
          let maText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!maText) {
            const area = calculateArea(polyPoints, undefined, pageNum);
            maText = formatMeasurement(area);
          }
          const maProps = {
            ...baseProps,
            type: 'measureArea',
            points: polyPoints,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            fillColor: extraColors.ic || 'none',
            lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 1,
            borderStyle: mapBorderStyle(annot, extraColors),
            measureText: maText,
          };
          if (extraColors.measureScale) {
            maProps.measureScale = extraColors.measureScale;
            maProps.measureUnit = extraColors.measureAreaUnit || extraColors.measureUnit || 'mm';
            const areaPrecision = extraColors.measureAreaPrecision !== undefined
              ? extraColors.measureAreaPrecision : extraColors.measurePrecision;
            if (areaPrecision !== undefined) maProps.measurePrecision = areaPrecision;
          }
          if (extraColors.opsPrecision != null) maProps.measurePrecision = extraColors.opsPrecision;
          // Load holes from custom OPS_Holes data (convert PDF→app coordinates)
          if (extraColors.holes && extraColors.holes.length > 0) {
            maProps.holes = extraColors.holes.map(hole =>
              hole.map(pt => {
                const [hx, hy] = convertPoint(pt.x, pt.y);
                return { x: hx, y: hy };
              })
            );
          }
          return createAnnotation(maProps);
        }

        // Determine type from OPS_Subtype custom key
        const polyType = extraColors.opsSubtype === 'cloudPolyline' ? 'cloudPolyline'
                       : extraColors.opsSubtype === 'cloud' ? 'cloud'
                       : 'polygon';

        const polyProps = {
          ...baseProps,
          type: polyType,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          sides: Math.floor(annot.vertices.length / 2),
          // Preserve the real vertices so a generic /Polygon renders its actual
          // shape instead of a regular N-gon synthesised from the bounding box
          // (issue #286). cloud/cloudPolyline already relied on these points.
          points: polyPoints,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || null,
          lineWidth: extraColors.borderWidth ?? annot.borderStyle?.width ?? 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        };

        return createAnnotation(polyProps);
      }
      break;

    case 'Text': {
      // Sticky note annotation
      const [txtVx, txtVy] = convertPoint(rect[0], rect[3]);

      // Normalize PDF /Name to lowercase internal icon name
      const pdfNameToIcon = {
        'Comment': 'comment', 'Note': 'note', 'Help': 'help',
        'Insert': 'insert', 'Key': 'key', 'NewParagraph': 'newparagraph',
        'Paragraph': 'paragraph', 'Check': 'check', 'Circle': 'circle',
        'Cross': 'cross', 'Star': 'star'
      };
      const rawName = annot.name || 'Comment';
      const iconName = pdfNameToIcon[rawName] || rawName.toLowerCase();

      return createAnnotation({
        ...baseProps,
        type: 'comment',
        x: txtVx,
        y: txtVy,
        width: 24,
        height: 24,
        text: (annot.contentsObj && annot.contentsObj.str) || annot.contents || '',
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00'),
        icon: iconName,
        popupOpen: annot.open || false
      });
    }

    case 'FreeText': {
      // Extract font size, font family, bold/italic, and text color
      let fontSize = 14;
      let fontSizeFromPdf = false;
      let textColor = '#000000';
      let fontFamily = null;
      let fontBold = false;
      let fontItalic = false;

      if (annot.defaultAppearanceData) {
        if (annot.defaultAppearanceData.fontSize) { fontSize = annot.defaultAppearanceData.fontSize; fontSizeFromPdf = true; }
        if (annot.defaultAppearanceData.fontColor) {
          textColor = colorArrayToHex(annot.defaultAppearanceData.fontColor, '#000000');
        }
        if (annot.defaultAppearanceData.fontName) {
          const fontInfo = mapPdfFontName(annot.defaultAppearanceData.fontName);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
      }
      if (!fontFamily && annot.defaultAppearance) {
        // Parse DA string "/FontRef size Tf"
        const fontMatch = annot.defaultAppearance.match(/\/([^\s]+)\s+[\d.]+\s+Tf/);
        if (fontMatch) {
          const fontInfo = mapPdfFontName(fontMatch[1]);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
        if (!annot.defaultAppearanceData) {
          const sizeMatch = annot.defaultAppearance.match(/(\d+(?:\.\d+)?)\s+Tf/);
          if (sizeMatch) { fontSize = parseFloat(sizeMatch[1]); fontSizeFromPdf = true; }
          const colorMatch = annot.defaultAppearance.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
          if (colorMatch) {
            textColor = colorArrayToHex([parseFloat(colorMatch[1]), parseFloat(colorMatch[2]), parseFloat(colorMatch[3])], '#000000');
          }
        }
      }
      // Use font info from pdf-lib if available (more accurate - resolves reference names like "F8")
      if (extraColors.fontFamily) fontFamily = extraColors.fontFamily;
      if (extraColors.fontBold) fontBold = true;
      if (extraColors.fontItalic) fontItalic = true;
      // Use DS font-size as fallback if DA didn't provide one
      if (!fontSizeFromPdf && extraColors.dsFontSize) fontSize = extraColors.dsFontSize;
      let fontUnderline = extraColors.fontUnderline || false;
      let fontStrikethrough = extraColors.fontStrikethrough || false;

      // Text content: prefer textContent array (joined), fallback to contents
      const text = annot.textContent ? annot.textContent.join('\n') : (annot.contents || '');

      // For FreeText annotations, annot.color (C entry) is the background/fill color per PDF spec
      // Border color: IC entry or appearance stream stroke color (extracted via pdf-lib)
      let borderColor = extraColors.ic || extraColors.apStrokeColor || '#000000';
      if (borderColor === '#000000' && annot.borderColor) {
        borderColor = colorArrayToHex(annot.borderColor, '#000000');
      }

      // Fill/background color = the FreeText /C entry. Use pdf-lib's view
      // (extraColors.cColor — set ONLY when /C is actually present): pdf.js's
      // annot.color DEFAULTS to black when /C is absent, which would paint a
      // no-fill textbox black on reopen. We deliberately do NOT fall back to
      // annot.backgroundColor — pdf.js reports a default WHITE there, which
      // would turn a transparent textbox into an opaque white box that hides
      // whatever is behind it. No /C ⇒ no fill (transparent).
      const bgColor = extraColors.cColor || null;

      // Border style: 1=SOLID, 2=DASHED, 3=BEVELED, 4=INSET, 5=UNDERLINE
      const bsStyle = annot.borderStyle?.style;
      const borderStyle = bsStyle === 2 ? 'dashed' : (bsStyle === 3 || bsStyle === 4 ? 'dotted' : 'solid');
      const borderWidth = extraColors.borderWidth !== undefined ? extraColors.borderWidth : (annot.borderStyle?.width || 1);

      // Derive rotation. Priority:
      // 1. OPS_Rotation (our custom key, exact value). An EXPLICIT 0 counts
      //    too: our saver always writes the key, because on pages with
      //    /Rotate the AP content carries a page-compensation transform that
      //    the matrix heuristic below would misread as annotation rotation.
      //    Files without the key keep the heuristic behaviour unchanged.
      // 2. AP/N Matrix angle, with convention detection based on BBox orientation
      let ftRotation = 0;
      const hasOpsRotation = extraColors.rotation !== undefined;
      if (hasOpsRotation) {
        ftRotation = Math.round(extraColors.rotation);
      }
      if (!hasOpsRotation && extraColors.matrixAngle !== undefined) {
        const ma = extraColors.matrixAngle;
        // Combined formula: visual rotation = -(annot.rotation + matrixAngle - pageRotate).
        // - annot.rotation comes from PDF.js (parses /Rotate / /Rotation key).
        // - matrixAngle comes from the AP/N Matrix (or auto-generated AP).
        // - pageRotate (viewport.rotation) = the page's own /Rotate: annotations
        //   rotate along with the page display, so an annot whose /Rotate equals
        //   the page /Rotate reads UPRIGHT for the viewer (visual 0).
        // Verified against externe referentie-weergave (unrotated pages):
        //   /Rotate 90  + matrix -90 → visual 0 (horizontal)
        //   /Rotate 270 + matrix +90 → visual 0 (horizontal)
        //   /Rotate 270 + matrix 180 → visual -90 (vertical)
        //   /Rotate 270 + matrix 120 → visual -30 (diagonal)
        // And on a page with /Rotate 90 (grote CAD-bladen):
        //   annot /Rotate 90 + matrix 0 → visual 0 (horizontal)
        const annotRot = (typeof annot.rotation === 'number') ? annot.rotation : 0;
        const pageRot = (((viewport.rotation || 0) % 360) + 360) % 360;
        ftRotation = -(annotRot + ma - pageRot);
        while (ftRotation > 180) ftRotation -= 360;
        while (ftRotation < -180) ftRotation += 360;
        ftRotation = Math.round(ftRotation);
        if (Math.abs(ftRotation) <= 1) ftRotation = 0;
      }
      // Self-healing: files written by an OLDER version of our saver drew the
      // AP content unrotated in PDF space on /Rotate'd pages (no OPS_Rotation
      // key, translation-only matrices, our own text-state signature — see
      // color-extraction.js). The heuristic above then reports the page
      // rotation as annotation rotation and the text renders sideways. Treat
      // those as visually unrotated; the next save rewrites the file with the
      // proper page-compensated appearance.
      if (!hasOpsRotation && ftRotation !== 0 && extraColors.apLegacyUnrotated) {
        const pageRotHeal = (((viewport.rotation || 0) % 360) + 360) % 360;
        if (pageRotHeal !== 0) ftRotation = 0;
      }

      // Rotation-aware viewport rect — its width/height already account for the
      // page /Rotate (they SWAP vs the raw PDF Rect on 90/270 pages).
      const ftRectVp = convertRect(annot.rect);
      // Recover the original (unrotated) textbox dimensions from Rect.
      const rectW = rect[2] - rect[0];
      const rectH = rect[3] - rect[1];
      let ftWidth, ftHeight;
      if (ftRotation !== 0) {
        // Any rotation: Rect is the (possibly expanded) axis-aligned bounding box.
        // Recover original dims via inverse rotation: rectW = |w*cos| + |h*sin|, rectH = |w*sin| + |h*cos|
        const c = Math.abs(Math.cos(ftRotation * Math.PI / 180));
        const s = Math.abs(Math.sin(ftRotation * Math.PI / 180));
        const det = c * c - s * s;
        if (Math.abs(det) > 0.01) {
          ftWidth = Math.round((rectW * c - rectH * s) / det);
          ftHeight = Math.round((rectH * c - rectW * s) / det);
          if (ftWidth <= 0 || ftHeight <= 0) {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        } else {
          if (extraColors.bboxWidth && extraColors.bboxHeight &&
              (Math.abs(extraColors.bboxWidth - rectW) > 1 || Math.abs(extraColors.bboxHeight - rectH) > 1)) {
            ftWidth = extraColors.bboxWidth;
            ftHeight = extraColors.bboxHeight;
          } else {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        }
      } else {
        // No text rotation: the box is axis-aligned in visual space, so the
        // rotation-aware viewport rect gives the correct visual size. Using raw
        // rectW/rectH left textboxes mis-sized and shifted on /Rotate 90/270 pages.
        ftWidth = ftRectVp.width;
        ftHeight = ftRectVp.height;
      }
      // Position: center of the Rect (bounding box center = rotated textbox center)
      const cx = ftRectVp.x + ftRectVp.width / 2;
      const cy = ftRectVp.y + ftRectVp.height / 2;
      const ftX = cx - ftWidth / 2;
      const ftY = cy - ftHeight / 2;

      // pdf.js doesn't expose calloutLine; use pdf-lib extracted CL from extraColors
      const calloutLine = extraColors.calloutLine || annot.calloutLine;
      const isCallout = calloutLine && calloutLine.length >= 4;

      if (isCallout) {
        // For callouts, Rect may include the leader line. Use /RD to get the actual text box.
        // RD = [left, bottom, right, top] insets from Rect to text box
        let coX = ftX, coY = ftY, coW = ftWidth, coH = ftHeight;
        const rd = extraColors.rectDiff;
        if (rd && rd[0] !== null) {
          const rdVp = convertRect([rect[0] + rd[0], rect[1] + rd[1], rect[2] - rd[2], rect[3] - rd[3]]);
          coX = rdVp.x;
          coY = rdVp.y;
          coW = rdVp.width;
          coH = rdVp.height;
        }
        // Callout stroke color: IC > AP stroke > borderColor fallback
        const coStrokeColor = extraColors.ic || extraColors.apStrokeColor || borderColor;
        // Fill color: C entry is the background for FreeText
        const coFillColor = bgColor || extraColors.cColor || '#FFFFD0';
        // Convert callout line points to viewport coordinates
        const [clArrowVx, clArrowVy] = convertPoint(calloutLine[0], calloutLine[1]);
        let clKneeVx, clKneeVy, clArmVx, clArmVy;
        if (calloutLine.length >= 6) {
          [clKneeVx, clKneeVy] = convertPoint(calloutLine[2], calloutLine[3]);
          [clArmVx, clArmVy] = convertPoint(calloutLine[4], calloutLine[5]);
        } else {
          clKneeVx = clArrowVx; clKneeVy = clArrowVy;
          [clArmVx, clArmVy] = convertPoint(calloutLine[2], calloutLine[3]);
        }
        return createAnnotation({
          ...baseProps,
          type: 'callout',
          x: coX,
          y: coY,
          width: coW,
          height: coH,
          rotation: ftRotation,
          text: text,
          color: coStrokeColor,
          strokeColor: coStrokeColor,
          fillColor: coFillColor || '#FFFFD0',
          textColor: textColor,
          fontSize: fontSize,
          borderStyle: borderStyle,
          lineWidth: borderWidth,
          fontFamily: fontFamily || 'Arial',
          fontBold: fontBold,
          fontItalic: fontItalic,
          lineSpacing: extraColors.lineSpacing || undefined,
          fontUnderline: fontUnderline,
          fontStrikethrough: fontStrikethrough,
          arrowX: clArrowVx,
          arrowY: clArrowVy,
          kneeX: clKneeVx,
          kneeY: clKneeVy,
          armOriginX: clArmVx,
          armOriginY: clArmVy,
          // Ronde aanhaallijn: restore curved leader when the private key is set.
          ...(extraColors.opsLeaderStyle === 'curved' ? { leaderStyle: 'curved' } : {}),
          ...(extraColors.borderCloudy ? {
            borderEffect: 'cloudy',
            ...(extraColors.cloudIntensity !== undefined ? { cloudIntensity: extraColors.cloudIntensity } : {})
          } : {})
        });
      }

      const _tbAnn = createAnnotation({
        ...baseProps,
        type: 'textbox',
        x: ftX,
        y: ftY,
        width: ftWidth,
        height: ftHeight,
        rotation: ftRotation,
        text: text,
        color: borderColor,
        strokeColor: borderColor,
        fillColor: bgColor,
        textColor: textColor,
        fontSize: fontSize,
        borderStyle: borderStyle,
        lineWidth: borderWidth,
        fontFamily: fontFamily || 'Arial',
        fontBold: fontBold,
        fontItalic: fontItalic,
        lineSpacing: extraColors.lineSpacing || undefined,
        fontUnderline: fontUnderline,
        fontStrikethrough: fontStrikethrough,
        ...(extraColors.borderCloudy ? {
          borderEffect: 'cloudy',
          ...(extraColors.cloudIntensity !== undefined ? { cloudIntensity: extraColors.cloudIntensity } : {})
        } : {})
      });
      // Stash raw PDF Rect so loader can resolve IRT-linked leader PolyLines.
      // Cleared by loader after leader-attach pass.
      try {
        if (annot.rect && annot.rect.length >= 4) {
          _tbAnn._pdfRectKey = `${annot.rect[0]},${annot.rect[1]},${annot.rect[2]},${annot.rect[3]}`;
        }
      } catch (_) {}
      return _tbAnn;
    }

    case 'Stamp': {
      // Image stamp - extracted from PDF structure via pdf-lib
      const stRect = convertRect(annot.rect);
      const x = stRect.x;
      const y = stRect.y;
      const w = stRect.width;
      const h = stRect.height;

      const dataUrl = findImageForAnnotation(stampImageMap, annot, 'stamp');

      let stRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        stRotation = Math.round(extraColors.rotation);
      } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
        stRotation = -Math.round(extraColors.matrixAngle);
      }

      // Reverse-map PDF standard names back to app stamp names
      const pdfToAppName = {
        'Approved': 'Approved', 'NotApproved': 'Rejected', 'Draft': 'Draft',
        'Confidential': 'Confidential', 'Final': 'Final', 'ForComment': 'For Review',
        'Expired': 'Void', 'AsIs': 'As Is', 'Experimental': 'Revised'
      };
      const pdfName = extraColors.stampPdfName || '';
      const appStampName = extraColors.stampName || pdfToAppName[pdfName] || pdfName || 'Draft';
      const stampText = annot.subject || annot.contentsObj?.str || annot.contents || appStampName.toUpperCase();
      const stampColor = baseProps.color || '#ef4444';

      const stampProps = {
        ...baseProps,
        type: 'stamp',
        x, y, width: w, height: h,
        stampName: appStampName,
        stampText: stampText,
        stampColor: stampColor,
        color: stampColor,
        strokeColor: stampColor,
        rotation: stRotation
      };

      // Attach AP stream image if available
      if (dataUrl) {
        const imageId = generateImageId();
        const img = new Image();
        img.src = dataUrl;
        imageCache.set(imageId, img);
        stampProps.imageId = imageId;
        stampProps.imageData = dataUrl;
        stampProps.originalWidth = w;
        stampProps.originalHeight = h;
        stampProps.lockAspectRatio = true;
        // Non-destructive crop round-trip (issue #212). Always present (0 =
        // no crop) so property-change undo snapshots contain the keys.
        stampProps.cropLeft = extraColors.cropLeft || 0;
        stampProps.cropTop = extraColors.cropTop || 0;
        stampProps.cropRight = extraColors.cropRight || 0;
        stampProps.cropBottom = extraColors.cropBottom || 0;
        // Word-style adjustments round-trip (grayscale / brightness / contrast).
        if (extraColors.grayscale) stampProps.grayscale = true;
        if (extraColors.brightness !== undefined) stampProps.brightness = extraColors.brightness;
        if (extraColors.contrast !== undefined) stampProps.contrast = extraColors.contrast;
      }

      // LINKED image: remember the source path and refresh the bitmap from
      // disk (async, silent — the embedded version stays as fallback when
      // the file is gone).
      if (extraColors.opsLinkedPath) {
        stampProps.linkedPath = extraColors.opsLinkedPath;
      }
      // Colour tint of an image compare-overlay. The extracted bitmap is the
      // untinted original (the tint lives as a Multiply fill in the AP
      // stream), so restoring the property re-applies the tint editably.
      if (extraColors.opsTintColor) {
        stampProps.tintColor = extraColors.opsTintColor;
      }
      // Stamps the app saved from an IMAGE annotation (Name 'Image', bitmap
      // embedded) round-trip back to type 'image' so the image properties
      // (size, aspect lock, linked file) stay editable after reopen.
      if (dataUrl && (pdfName === 'Image' || stampProps.linkedPath)) {
        stampProps.type = 'image';
      }
      const _stampAnn = createAnnotation(stampProps);
      if (_stampAnn?.linkedPath) {
        import('../../annotations/image-drop.js')
          .then(m => m.refreshLinkedImage(_stampAnn, { silent: true }))
          .catch(() => {});
      }
      return _stampAnn;
    }
  }

  return null;
}
