import { state } from '../../core/state.js';

// ─── Validation dialog ─────────────────────────────────────────────────────────

let activeValidationDialog = null;

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
  if (activeValidationDialog) return;

  // Block all tool interaction and cancel any in-progress operation
  state.modalDialogOpen = true;
  cancelToolState();

  const overlay = document.createElement('div');
  overlay.className = 'form-validation-overlay';

  // Prevent all mouse events from reaching the canvas/tools underneath
  for (const evt of ['mousedown', 'mouseup', 'click', 'dblclick', 'mousemove', 'pointerdown', 'pointerup']) {
    overlay.addEventListener(evt, (e) => { e.stopPropagation(); });
  }

  const dialog = document.createElement('div');
  dialog.className = 'form-validation-dialog';

  const header = document.createElement('div');
  header.className = 'form-validation-header';
  const title = document.createElement('span');
  title.textContent = 'Validation Error';
  header.appendChild(title);

  let isDragging = false, dragX = 0, dragY = 0;
  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragX = e.clientX - dialog.offsetLeft;
    dragY = e.clientY - dialog.offsetTop;
    e.preventDefault();
  });
  const onDragMove = (e) => {
    if (!isDragging) return;
    dialog.style.left = (e.clientX - dragX) + 'px';
    dialog.style.top = (e.clientY - dragY) + 'px';
    dialog.style.transform = 'none';
  };
  const onDragEnd = () => { isDragging = false; };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  const body = document.createElement('div');
  body.className = 'form-validation-body';

  const icon = document.createElement('div');
  icon.className = 'form-validation-icon';
  icon.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="14" fill="#e81123"/>
    <rect x="14" y="8" width="4" height="12" rx="2" fill="white"/>
    <circle cx="16" cy="24" r="2" fill="white"/>
  </svg>`;

  const text = document.createElement('div');
  text.className = 'form-validation-text';
  text.textContent = message;

  body.appendChild(icon);
  body.appendChild(text);

  const footer = document.createElement('div');
  footer.className = 'form-validation-footer';
  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.className = 'form-validation-ok-btn';
  footer.appendChild(okBtn);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  activeValidationDialog = overlay;

  okBtn.focus();

  const keyHandler = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };

  const close = () => {
    overlay.remove();
    activeValidationDialog = null;
    cancelToolState();
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('keydown', keyHandler);
    if (input) {
      // Delay focus and dialog flag reset to avoid triggering tools from the click that closed the dialog
      setTimeout(() => {
        input.focus();
        state.modalDialogOpen = false;
      }, 50);
    } else {
      setTimeout(() => { state.modalDialogOpen = false; }, 50);
    }
  };

  okBtn.addEventListener('click', close);
  okBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') close();
  });
  document.addEventListener('keydown', keyHandler);
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
