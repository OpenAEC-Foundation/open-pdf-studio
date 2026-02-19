import { state } from '../../core/state.js';
import { openDialog } from '../../solid/stores/dialogStore.js';

// ─── Validation dialog ─────────────────────────────────────────────────────────

function cancelToolState() {
  state.isDrawing = false;
  state.isDragging = false;
  state.isResizing = false;
  state.isRotating = false;
  state.isPanning = false;
  state.isRubberBanding = false;
  state.isDrawingPolyline = false;
  state.isMiddleButtonPanning = false;
}

export function showValidationDialog(message, input) {
  // Block all tool interaction and cancel any in-progress operation
  state.modalDialogOpen = true;
  cancelToolState();

  openDialog('form-validation', {
    message,
    onOk: () => {
      cancelToolState();
      if (input) {
        setTimeout(() => {
          input.focus();
          state.modalDialogOpen = false;
        }, 50);
      } else {
        setTimeout(() => { state.modalDialogOpen = false; }, 50);
      }
    }
  });
}

// ─── Specific validators ────────────────────────────────────────────────────────

export function validateBSN(value, pdfMessages) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 9) {
    return pdfMessages[0] || `BSN must be exactly 9 digits.`;
  }
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  if (sum % 11 !== 0) {
    return pdfMessages[1] || pdfMessages[0] || 'Invalid BSN number.';
  }
  return null;
}

export function validateDatePart(value, fieldName, pdfMessages, jsConstants) {
  const num = parseInt(value, 10);
  if (isNaN(num)) return pdfMessages[0] || 'Invalid value.';

  const partType = detectDatePartByName(fieldName);
  if (partType === 'day') {
    if (num < 1 || num > 31) {
      return pdfMessages[0] || jsConstants?.get('IDS_DD') || 'Invalid day (1-31).';
    }
  } else if (partType === 'month') {
    if (num < 1 || num > 12) {
      return pdfMessages[0] || jsConstants?.get('IDS_MM') || 'Invalid month (1-12).';
    }
  } else if (partType === 'year') {
    if (value.length === 4 && (num < 1900 || num > 2100)) {
      return pdfMessages[0] || jsConstants?.get('IDS_JAAR2') || 'Invalid year.';
    }
  }
  return null;
}

/**
 * Detect if a field name indicates a date part (day, month, year).
 */
export function detectDatePartByName(fieldName) {
  if (!fieldName) return null;
  const lastDot = fieldName.lastIndexOf('.');
  if (lastDot < 0) return null;
  const lastSegment = fieldName.substring(lastDot + 1).toLowerCase();
  if (!lastSegment) return null;
  if (/^(d|dd|dag|day)(\b|_|$)/i.test(lastSegment)) return 'day';
  if (/^(m|mm|mnd|maand|month)(\b|_|$)/i.test(lastSegment)) return 'month';
  if (/^(y|yy|yyyy|jr|jaar|year)(\b|_|$)/i.test(lastSegment)) return 'year';
  return null;
}

// ─── Action string parsers ─────────────────────────────────────────────────────

export function detectKeystrokeRestriction(actions) {
  const format = actions.Format?.[0] || '';
  const keystroke = actions.Keystroke?.[0] || '';
  const combined = format + keystroke;

  if (/AFNumber/.test(combined)) return { type: 'number' };
  if (/AFPercent/.test(combined)) return { type: 'percent' };
  if (/AFDate/.test(combined)) return { type: 'date' };
  if (/AFTime/.test(combined)) return { type: 'time' };
  if (/AFSpecial/.test(combined)) return { type: 'special' };

  if (keystroke) {
    const restriction = parseRegexKeystroke(keystroke);
    if (restriction) return restriction;
  }

  return null;
}

function parseRegexKeystroke(keystroke) {
  const regexMatch = keystroke.match(/\^\[([^\]]+)\]/);
  if (!regexMatch) return null;

  const charClass = regexMatch[1];
  const charPattern = new RegExp(`^[${charClass}]$`);
  const fullPattern = new RegExp(`^[${charClass}]*$`);

  let inputMode = 'text';
  if (charClass === '0-9' || charClass === '\\d') {
    inputMode = 'numeric';
  }

  return { type: 'regex', charPattern, fullPattern, inputMode, charClass };
}

export function parseAFNumberDecimals(actions) {
  const keystroke = actions.Keystroke?.[0] || actions.Format?.[0] || '';
  const m = keystroke.match(/AFNumber_(?:Keystroke|Format)\((\d+)/);
  return m ? parseInt(m[1], 10) : 2;
}

export function parseAFSpecialType(actions) {
  const keystroke = actions.Keystroke?.[0] || '';
  const m = keystroke.match(/AFSpecial_Keystroke\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function parseAFRangeValidate(validate) {
  const m = validate.match(/AFRange_Validate\(\s*(true|false)\s*,\s*([^,]+)\s*,\s*(true|false)\s*,\s*([^)]+)\)/);
  if (!m) return null;
  return {
    hasMin: m[1] === 'true',
    min: parseFloat(m[2]),
    hasMax: m[3] === 'true',
    max: parseFloat(m[4]),
  };
}
