import { state } from '../core/state.js';
import { getColorPickerValue, getLineWidthValue } from '../solid/stores/ribbonStore.js';
import { createAnnotation } from '../annotations/factory.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, formatMeasurement } from '../annotations/measurement.js';

export function createAnnotationFromTool(tool, startX, startY, endX, endY, e) {
  const prefs = state.preferences;

  switch (tool) {
    case 'draw':
      if (state.currentPath.length > 1) {
        const ann = createAnnotation({
          type: 'draw',
          page: state.currentPage,
          path: state.currentPath,
          color: prefs.drawStrokeColor || getColorPickerValue(),
          strokeColor: prefs.drawStrokeColor || getColorPickerValue(),
          lineWidth: prefs.drawLineWidth || getLineWidthValue(),
          opacity: (prefs.drawOpacity || 100) / 100
        });
        state.currentPath = [];
        return ann;
      }
      return null;

    case 'highlight':
      return createAnnotation({
        type: 'highlight',
        page: state.currentPage,
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
        color: prefs.highlightColor || getColorPickerValue(),
        fillColor: prefs.highlightColor || getColorPickerValue()
      });

    case 'line': {
      let finalEndX = endX;
      let finalEndY = endY;
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        finalEndX = startX + length * Math.cos(snappedAngle);
        finalEndY = startY + length * Math.sin(snappedAngle);
      }
      return createAnnotation({
        type: 'line',
        page: state.currentPage,
        startX: startX,
        startY: startY,
        endX: finalEndX,
        endY: finalEndY,
        color: prefs.lineStrokeColor || getColorPickerValue(),
        strokeColor: prefs.lineStrokeColor || getColorPickerValue(),
        lineWidth: prefs.lineLineWidth || getLineWidthValue(),
        borderStyle: prefs.lineBorderStyle || 'solid',
        opacity: (prefs.lineOpacity || 100) / 100
      });
    }

    case 'arrow': {
      let finalEndX = endX;
      let finalEndY = endY;
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = endX - startX;
        const dy = endY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        finalEndX = startX + length * Math.cos(snappedAngle);
        finalEndY = startY + length * Math.sin(snappedAngle);
      }
      return createAnnotation({
        type: 'arrow',
        page: state.currentPage,
        startX: startX,
        startY: startY,
        endX: finalEndX,
        endY: finalEndY,
        color: prefs.arrowStrokeColor || getColorPickerValue(),
        strokeColor: prefs.arrowStrokeColor || getColorPickerValue(),
        fillColor: prefs.arrowFillColor || prefs.arrowStrokeColor || getColorPickerValue(),
        lineWidth: prefs.arrowLineWidth || getLineWidthValue(),
        borderStyle: prefs.arrowBorderStyle || 'solid',
        startHead: prefs.arrowStartHead || 'none',
        endHead: prefs.arrowEndHead || 'open',
        headSize: prefs.arrowHeadSize || 12,
        opacity: (prefs.arrowOpacity || 100) / 100
      });
    }

    case 'circle': {
      const circleX = Math.min(startX, endX);
      const circleY = Math.min(startY, endY);
      const circleW = Math.abs(endX - startX);
      const circleH = Math.abs(endY - startY);
      return createAnnotation({
        type: 'circle',
        page: state.currentPage,
        x: circleX,
        y: circleY,
        width: circleW,
        height: circleH,
        color: prefs.circleStrokeColor,
        strokeColor: prefs.circleStrokeColor,
        fillColor: prefs.circleFillNone ? null : prefs.circleFillColor,
        lineWidth: prefs.circleBorderWidth,
        borderStyle: prefs.circleBorderStyle,
        opacity: prefs.circleOpacity / 100
      });
    }

    case 'box': {
      const boxX = Math.min(startX, endX);
      const boxY = Math.min(startY, endY);
      const boxW = Math.abs(endX - startX);
      const boxH = Math.abs(endY - startY);
      return createAnnotation({
        type: 'box',
        page: state.currentPage,
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        color: prefs.rectStrokeColor,
        strokeColor: prefs.rectStrokeColor,
        fillColor: prefs.rectFillNone ? null : prefs.rectFillColor,
        lineWidth: prefs.rectBorderWidth,
        borderStyle: prefs.rectBorderStyle,
        opacity: prefs.rectOpacity / 100
      });
    }

    case 'polygon':
      return createAnnotation({
        type: 'polygon',
        page: state.currentPage,
        x: startX,
        y: startY,
        width: endX - startX,
        height: endY - startY,
        sides: 6,
        color: prefs.polygonStrokeColor || getColorPickerValue(),
        strokeColor: prefs.polygonStrokeColor || getColorPickerValue(),
        lineWidth: prefs.polygonLineWidth || getLineWidthValue(),
        opacity: (prefs.polygonOpacity || 100) / 100
      });

    case 'cloud': {
      const cloudX = Math.min(startX, endX);
      const cloudY = Math.min(startY, endY);
      const cloudW = Math.abs(endX - startX);
      const cloudH = Math.abs(endY - startY);
      if (cloudW > 10 && cloudH > 10) {
        return createAnnotation({
          type: 'cloud',
          page: state.currentPage,
          x: cloudX,
          y: cloudY,
          width: cloudW,
          height: cloudH,
          color: prefs.cloudStrokeColor || getColorPickerValue(),
          strokeColor: prefs.cloudStrokeColor || getColorPickerValue(),
          lineWidth: prefs.cloudLineWidth || getLineWidthValue(),
          opacity: (prefs.cloudOpacity || 100) / 100
        });
      }
      return null;
    }

    case 'textbox': {
      const tbX = Math.min(startX, endX);
      const tbY = Math.min(startY, endY);
      const tbW = Math.abs(endX - startX);
      const tbH = Math.abs(endY - startY);
      if (tbW > 5 && tbH > 5) {
        return createAnnotation({
          type: 'textbox',
          page: state.currentPage,
          x: tbX,
          y: tbY,
          width: tbW,
          height: tbH,
          text: '',
          color: prefs.textboxStrokeColor,
          strokeColor: prefs.textboxStrokeColor,
          fillColor: prefs.textboxFillNone ? 'transparent' : prefs.textboxFillColor,
          textColor: '#000000',
          fontSize: prefs.textboxFontSize,
          fontFamily: 'Arial',
          lineWidth: prefs.textboxBorderWidth,
          borderStyle: prefs.textboxBorderStyle,
          opacity: (prefs.textboxOpacity || 100) / 100
        });
      }
      return null;
    }

    case 'callout': {
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = endX - defaultWidth / 2;
      const coY = endY - defaultHeight / 2;
      const boxCenterX = endX;
      const isArrowLeft = startX < boxCenterX;
      let armOriginX;
      if (isArrowLeft) {
        armOriginX = coX;
      } else {
        armOriginX = coX + defaultWidth;
      }
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, endY));
      const armLength = Math.min(30, Math.abs(startX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      const kneeY = armOriginY;
      return createAnnotation({
        type: 'callout',
        page: state.currentPage,
        x: coX,
        y: coY,
        width: defaultWidth,
        height: defaultHeight,
        arrowX: startX,
        arrowY: startY,
        kneeX: kneeX,
        kneeY: kneeY,
        armOriginX: armOriginX,
        armOriginY: armOriginY,
        text: '',
        color: prefs.calloutStrokeColor,
        strokeColor: prefs.calloutStrokeColor,
        fillColor: prefs.calloutFillNone ? 'transparent' : prefs.calloutFillColor,
        textColor: '#000000',
        fontSize: prefs.calloutFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.calloutBorderWidth,
        borderStyle: prefs.calloutBorderStyle,
        opacity: (prefs.calloutOpacity || 100) / 100
      });
    }

    case 'redaction': {
      const rx = Math.min(startX, endX);
      const ry = Math.min(startY, endY);
      const rw = Math.abs(endX - startX);
      const rh = Math.abs(endY - startY);
      if (rw > 5 && rh > 5) {
        return createAnnotation({
          type: 'redaction',
          page: state.currentPage,
          x: rx, y: ry, width: rw, height: rh,
          overlayColor: prefs.redactionOverlayColor
        });
      }
      return null;
    }

    case 'measureDistance': {
      const dist = calculateDistance(startX, startY, endX, endY);
      return createAnnotation({
        type: 'measureDistance',
        page: state.currentPage,
        startX: startX,
        startY: startY,
        endX: endX,
        endY: endY,
        color: prefs.measureStrokeColor,
        strokeColor: prefs.measureStrokeColor,
        lineWidth: prefs.measureLineWidth,
        opacity: (prefs.measureOpacity || 100) / 100,
        measureText: formatMeasurement(dist),
        measureValue: dist.value,
        measureUnit: dist.unit
      });
    }

    default:
      return null;
  }
}

export function createContinuousAnnotation(tool, pageNum, startX, startY, endX, endY) {
  switch (tool) {
    case 'draw':
      if (state.currentPath.length > 1) {
        const ann = createAnnotation({
          type: 'draw',
          page: pageNum,
          path: state.currentPath,
          color: getColorPickerValue(),
          strokeColor: getColorPickerValue(),
          lineWidth: getLineWidthValue()
        });
        state.currentPath = [];
        return ann;
      }
      return null;

    case 'highlight':
      return createAnnotation({
        type: 'highlight',
        page: pageNum,
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
        color: getColorPickerValue(),
        fillColor: getColorPickerValue()
      });

    case 'line':
      return createAnnotation({
        type: 'line',
        page: pageNum,
        startX: startX,
        startY: startY,
        endX: endX,
        endY: endY,
        color: getColorPickerValue(),
        strokeColor: getColorPickerValue(),
        lineWidth: getLineWidthValue()
      });

    case 'circle': {
      const circleX = Math.min(startX, endX);
      const circleY = Math.min(startY, endY);
      const circleW = Math.abs(endX - startX);
      const circleH = Math.abs(endY - startY);
      return createAnnotation({
        type: 'circle',
        page: pageNum,
        x: circleX,
        y: circleY,
        width: circleW,
        height: circleH,
        color: getColorPickerValue(),
        strokeColor: getColorPickerValue(),
        fillColor: getColorPickerValue(),
        lineWidth: getLineWidthValue()
      });
    }

    case 'box': {
      const boxX = Math.min(startX, endX);
      const boxY = Math.min(startY, endY);
      const boxW = Math.abs(endX - startX);
      const boxH = Math.abs(endY - startY);
      return createAnnotation({
        type: 'box',
        page: pageNum,
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        color: getColorPickerValue(),
        fillColor: getColorPickerValue(),
        strokeColor: getColorPickerValue(),
        lineWidth: getLineWidthValue()
      });
    }

    default:
      return null;
  }
}
