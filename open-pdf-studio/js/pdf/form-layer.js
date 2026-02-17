import { state } from '../core/state.js';
import { AnnotationLayer } from 'pdfjs-dist';

// Sub-module imports
import { parseJSConstants, parseJSFunctions, decodeJSString, getMessagesForBlurAction } from './form-layer/js-parser.js';
import {
  showValidationDialog, validateBSN, validateDatePart, detectDatePartByName,
  detectKeystrokeRestriction, parseAFNumberDecimals, parseAFSpecialType, parseAFRangeValidate
} from './form-layer/validation-ui.js';

// Map of annotation ID → field name (for saving)
const annotIdToFieldName = new Map();

// Store references to form layers for cleanup
const formLayers = new Map();

// Cached document-level JavaScript and parsed data
let documentJS = null;
let jsConstants = null;    // Map of constant name → string value (e.g. IDS_DD → "...")
let jsFunctions = null;    // Map of function name → function body string

// Track radio groups we've already set up to avoid duplicate handlers
const initializedRadioGroups = new Set();

// Map annotation ID → button/export value (for radios/checkboxes)
const annotButtonValues = new Map();

// Flag to suppress blur validation during toggle field changes
let isTogglingFields = false;

// Minimal link service required by AnnotationLayer
const simpleLinkService = {
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  addLinkAttributes: () => {},
  goToDestination: () => {},
  goToPage: () => {},
  navigateTo: () => {},
  isPageVisible: () => true,
  isPageCached: () => true,
  page: 0,
  rotation: 0,
  externalLinkEnabled: true,
  externalLinkRel: 'noopener noreferrer nofollow',
  externalLinkTarget: 0,
};

/**
 * Reset annotation storage for a new document.
 */
export function resetAnnotationStorage() {
  annotIdToFieldName.clear();
  initializedRadioGroups.clear();
  annotButtonValues.clear();
  documentJS = null;
  jsConstants = null;
  jsFunctions = null;

  const annotationStorage = getAnnotationStorage();
  if (annotationStorage) {
    annotationStorage.onSetModified = () => {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.modified = true;
    };
  }
}

export function getAnnotationStorage() {
  return state.pdfDoc ? state.pdfDoc.annotationStorage : null;
}

export function getAnnotIdToFieldName() {
  return annotIdToFieldName;
}

/**
 * Creates form layer for a PDF page
 */
export async function createFormLayer(page, viewport, container, pageNum) {
  const annotations = await page.getAnnotations({ intent: 'display' });

  const widgetAnnotations = annotations.filter(ann => ann.subtype === 'Widget');
  if (widgetAnnotations.length === 0) return null;

  for (const ann of widgetAnnotations) {
    if (ann.fieldName) {
      annotIdToFieldName.set(ann.id, ann.fieldName);
    }
    // Store button/export value for radios and checkboxes
    if (ann.buttonValue || ann.exportValue) {
      annotButtonValues.set(ann.id, ann.buttonValue || ann.exportValue);
    }
  }

  const annotationStorage = getAnnotationStorage();
  if (!annotationStorage) return null;

  const formLayerDiv = document.createElement('div');
  formLayerDiv.className = 'formLayer annotationLayer';
  formLayerDiv.dataset.page = pageNum;

  container.appendChild(formLayerDiv);

  const annotationLayer = new AnnotationLayer({
    div: formLayerDiv,
    page,
    viewport,
    annotationStorage,
    linkService: simpleLinkService,
    accessibilityManager: null,
    annotationCanvasMap: null,
    annotationEditorUIManager: null,
    structTreeLayer: null,
  });

  await annotationLayer.render({
    annotations: widgetAnnotations,
    renderForms: true,
    annotationStorage,
    imageResourcesPath: '',
  });

  // Load and parse document-level JavaScript (contains validation functions + messages)
  if (!documentJS) {
    try {
      const jsActions = await state.pdfDoc.getJSActions();
      if (jsActions) {
        documentJS = Object.values(jsActions).flat().join('\n');
        jsConstants = parseJSConstants(documentJS);
        jsFunctions = parseJSFunctions(documentJS);
      }
    } catch (e) {
      console.warn('Failed to load document JS:', e);
    }
  }

  applyFieldRestrictions(formLayerDiv, widgetAnnotations);

  formLayers.set(pageNum, formLayerDiv);

  // Show the form fields info bar
  showFormFieldsBar();

  return formLayerDiv;
}

// ─── Input restrictions & blur validation ──────────────────────────────────────

function applyFieldRestrictions(formLayerDiv, widgetAnnotations) {
  for (const ann of widgetAnnotations) {
    const section = formLayerDiv.querySelector(`[data-annotation-id="${ann.id}"]`);
    if (!section) continue;

    // Handle checkbox/radio actions (enable/disable other fields)
    const toggleInput = section.querySelector('input[type="checkbox"], input[type="radio"]');
    if (toggleInput) {
      if (ann.actions) {
        applyToggleActions(toggleInput, ann, formLayerDiv);
        continue;
      }
    }

    const input = section.querySelector('input[type="text"], input[type="password"], textarea');
    if (!input) continue;

    let hasKeystrokeRestriction = false;
    if (ann.actions) {
      const restriction = detectKeystrokeRestriction(ann.actions);
      if (restriction) {
        applyKeystrokeRestriction(input, restriction, ann);
        hasKeystrokeRestriction = true;
      }
    }

    // Auto-detect date/numeric fields by name or comb properties when no explicit keystroke restriction
    const datePartType = detectDatePartByName(ann.fieldName);
    if (!hasKeystrokeRestriction && (datePartType || (ann.comb && ann.maxLen && ann.maxLen <= 4))) {
      input.inputMode = 'numeric';
      input.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertText' && e.data) {
          if (!/^[0-9]$/.test(e.data)) e.preventDefault();
        }
      });
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/^[0-9]*$/.test(text)) e.preventDefault();
      });
    }

    const validators = buildBlurValidators(ann);

    // Auto-add date range validation if field name matches date pattern and no explicit blur action handles it
    if (datePartType && !(ann.actions?.Blur?.some(a => /checkDate/i.test(a)))) {
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        return validateDatePart(value, ann.fieldName, [], jsConstants);
      });
    }

    applyBlurValidation(input, validators, ann);
  }
}

// ─── Toggle actions (checkbox/radio → enable/disable fields) ─────────────────

function applyToggleActions(inputEl, ann, formLayerDiv) {
  const actions = [];
  for (const key of Object.keys(ann.actions)) {
    if (Array.isArray(ann.actions[key])) {
      actions.push(...ann.actions[key]);
    }
  }
  if (actions.length === 0) return;

  const isRadio = inputEl.type === 'radio';
  const groupName = ann.fieldName;

  // For radio buttons: set up ONE handler per group, not per radio button
  if (isRadio) {
    if (initializedRadioGroups.has(groupName)) return;
    initializedRadioGroups.add(groupName);
  }

  const handler = () => {
    // Get the actual PDF value of the selected radio/checkbox
    let selectedValue = 'Off';
    if (isRadio) {
      // Find checked radio and get its PDF button value from annotation data
      const allSections = formLayerDiv.querySelectorAll(`input[type="radio"][name="${inputEl.name}"]`);
      for (const r of allSections) {
        if (r.checked) {
          // Get the annotation ID from the parent section
          const section = r.closest('[data-annotation-id]');
          if (section) {
            const annId = section.dataset.annotationId;
            selectedValue = annotButtonValues.get(annId) || r.value || 'Yes';
          } else {
            selectedValue = r.value || 'Yes';
          }
          break;
        }
      }
    } else {
      if (inputEl.checked) {
        const section = inputEl.closest('[data-annotation-id]');
        const annId = section?.dataset.annotationId;
        selectedValue = annotButtonValues.get(annId) || inputEl.value || 'Yes';
      }
    }

    // Don't use HTML default "on"
    if (selectedValue === 'on') selectedValue = 'Off';

    for (const action of actions) {
      executeToggleAction(action, selectedValue, ann);
    }
  };

  if (isRadio) {
    const allRadios = formLayerDiv.querySelectorAll(`input[type="radio"][name="${inputEl.name}"]`);
    for (const r of allRadios) {
      r.addEventListener('change', handler);
    }
  } else {
    inputEl.addEventListener('change', handler);
  }

  // Run once on load to set initial states
  setTimeout(handler, 200);
}

/**
 * Execute a toggle action.
 * selectedValue = the current value of the checkbox/radio group ("Off", "Yes", "1", etc.)
 */
function executeToggleAction(action, selectedValue, ann) {
  // Pattern 1: Call to a known document function
  const funcCallMatch = action.match(/(\w+)\s*\(/);
  if (funcCallMatch && jsFunctions) {
    const funcName = funcCallMatch[1];
    const funcBody = jsFunctions.get(funcName);
    if (funcBody) {
      const fieldChanges = parseFieldChanges(funcBody, selectedValue, ann);
      applyFieldChanges(fieldChanges);
      return;
    }
  }

  // Pattern 2: Direct getField("name").display = ...
  const directChanges = parseDirectFieldChanges(action);
  if (directChanges.length > 0) {
    applyFieldChanges(directChanges);
  }
}

/**
 * Parse a document JS function body to extract field display/readonly changes.
 */
function parseFieldChanges(funcBody, selectedValue, ann) {
  const changes = extractConditionalDisplayChanges(funcBody, selectedValue);

  if (changes.length === 0) {
    // Fallback: extract ALL display changes (ignoring conditionals)
    extractDisplayChangesFlat(funcBody, changes);
  }

  return changes;
}

/**
 * Recursively extract display changes, respecting if/else conditionals.
 */
function extractConditionalDisplayChanges(code, selectedValue) {
  const changes = [];

  const allChains = parseAllIfChains(code);

  if (allChains.length > 0) {
    for (const chain of allChains) {
      let matched = false;
      for (const branch of chain) {
        if (branch.condition === null) {
          if (!matched) {
            const nested = extractConditionalDisplayChanges(branch.body, selectedValue);
            if (nested.length > 0) {
              changes.push(...nested);
            } else {
              extractDisplayChangesFlat(branch.body, changes);
            }
          }
          break;
        }
        if (!matched && evaluateCondition(branch.condition, selectedValue)) {
          matched = true;
          const nested = extractConditionalDisplayChanges(branch.body, selectedValue);
          if (nested.length > 0) {
            changes.push(...nested);
          } else {
            extractDisplayChangesFlat(branch.body, changes);
          }
        }
      }
    }
  } else {
    extractDisplayChangesFlat(code, changes);
  }

  return changes;
}

/**
 * Extract getField().display and getField().readonly patterns from JS code.
 */
function extractDisplayChangesFlat(code, changes) {
  let m;

  const displayRegex = /(?:this\.)?getField\(\s*["']([^"']+)["']\s*\)\.display\s*=\s*display\.(\w+)/g;
  while ((m = displayRegex.exec(code)) !== null) {
    changes.push({ fieldName: m[1], property: 'display', value: m[2] });
  }

  const readonlyRegex = /(?:this\.)?getField\(\s*["']([^"']+)["']\s*\)\.readonly\s*=\s*(true|false)/g;
  while ((m = readonlyRegex.exec(code)) !== null) {
    changes.push({ fieldName: m[1], property: 'readonly', value: m[2] === 'true' });
  }

  const requiredRegex = /(?:this\.)?getField\(\s*["']([^"']+)["']\s*\)\.required\s*=\s*(true|false)/g;
  while ((m = requiredRegex.exec(code)) !== null) {
    changes.push({ fieldName: m[1], property: 'required', value: m[2] === 'true' });
  }

  const valueRegex = /(?:this\.)?getField\(\s*["']([^"']+)["']\s*\)\.value\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
  while ((m = valueRegex.exec(code)) !== null) {
    changes.push({ fieldName: m[1], property: 'value', value: decodeJSString(m[2] || m[3] || '') });
  }
}

/**
 * Parse ALL top-level if / else if / else chains from code.
 */
function parseAllIfChains(code) {
  const chains = [];
  const ifRegex = /if\s*\(([^)]+)\)\s*\{/g;
  let m;
  let lastChainEnd = -1;

  while ((m = ifRegex.exec(code)) !== null) {
    if (m.index < lastChainEnd) continue;

    const chain = [];
    let pos = m.index + m[0].length;

    const firstBody = extractBraceBlock(code, pos);
    chain.push({ condition: m[1], body: firstBody.content });
    pos = firstBody.endPos;

    while (pos < code.length) {
      const rest = code.substring(pos);

      const elseIfMatch = rest.match(/^\s*else\s+if\s*\(([^)]+)\)\s*\{/);
      if (elseIfMatch) {
        pos += elseIfMatch[0].length;
        const block = extractBraceBlock(code, pos);
        chain.push({ condition: elseIfMatch[1], body: block.content });
        pos = block.endPos;
        continue;
      }

      const elseMatch = rest.match(/^\s*else\s*\{/);
      if (elseMatch) {
        pos += elseMatch[0].length;
        const block = extractBraceBlock(code, pos);
        chain.push({ condition: null, body: block.content });
        pos = block.endPos;
      }

      break;
    }

    lastChainEnd = pos;
    chains.push(chain);
    ifRegex.lastIndex = pos;
  }

  return chains;
}

function extractBraceBlock(code, startPos) {
  let depth = 1;
  let i = startPos;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
    i++;
  }
  return { content: code.substring(startPos, i - 1), endPos: i };
}

/**
 * Evaluate a condition using the actual radio/checkbox value.
 */
function evaluateCondition(condition, selectedValue) {
  if (condition.includes('&&')) {
    return condition.split('&&').every(part => evaluateCondition(part.trim(), selectedValue));
  }
  if (condition.includes('||')) {
    return condition.split('||').some(part => evaluateCondition(part.trim(), selectedValue));
  }

  const svLower = selectedValue.toLowerCase();

  const eqMatch = condition.match(/==\s*["']([^"']*)["']/);
  if (eqMatch) {
    const expected = eqMatch[1];
    if (expected === 'Off' || expected === '') return selectedValue === 'Off' || selectedValue === '';
    if (selectedValue === expected) return true;
    if (expected.length <= 3 && expected.length < selectedValue.length) {
      return svLower.startsWith(expected.toLowerCase());
    }
    return false;
  }

  const neqMatch = condition.match(/!=\s*["']([^"']*)["']/);
  if (neqMatch) {
    const notExpected = neqMatch[1];
    if (notExpected === 'Off' || notExpected === '') return selectedValue !== 'Off' && selectedValue !== '';
    if (selectedValue === notExpected) return false;
    if (notExpected.length <= 3 && notExpected.length < selectedValue.length) {
      return !svLower.startsWith(notExpected.toLowerCase());
    }
    return true;
  }

  return selectedValue !== 'Off' && selectedValue !== '';
}

function parseDirectFieldChanges(action) {
  const changes = [];
  extractDisplayChangesFlat(action, changes);
  return changes;
}

/**
 * Apply field changes (display/readonly) to the DOM elements.
 */
function applyFieldChanges(changes) {
  if (changes.length === 0) return;

  isTogglingFields = true;

  for (const change of changes) {
    let found = false;
    const allLayers = document.querySelectorAll('.formLayer');
    for (const layer of allLayers) {
      for (const [annId, fieldName] of annotIdToFieldName.entries()) {
        if (fieldName !== change.fieldName && !fieldName.startsWith(change.fieldName + '.')) continue;

        const section = layer.querySelector(`[data-annotation-id="${annId}"]`);
        if (!section) continue;
        found = true;

        const inputs = section.querySelectorAll('input, select, textarea');

        if (change.property === 'display') {
          const hidden = change.value === 'hidden' || change.value === 'noView';
          section.style.display = hidden ? 'none' : '';
          section.style.visibility = hidden ? 'hidden' : '';
          inputs.forEach(inp => {
            inp.disabled = hidden;
            if (hidden && (inp.type === 'text' || inp.type === 'password' || inp.tagName === 'TEXTAREA')) {
              inp.value = '';
              updateAnnotationStorageValue(annId, '');
            }
          });
        } else if (change.property === 'readonly') {
          inputs.forEach(inp => {
            inp.readOnly = change.value;
            inp.disabled = change.value;
          });
        } else if (change.property === 'required') {
          inputs.forEach(inp => {
            inp.required = change.value;
            section.classList.toggle('field-required', change.value);
          });
        } else if (change.property === 'value') {
          inputs.forEach(inp => {
            if (inp.type === 'text' || inp.type === 'password' || inp.tagName === 'TEXTAREA') {
              inp.value = change.value;
              updateAnnotationStorageValue(annId, change.value);
            }
          });
        }
      }
    }
  }

  isTogglingFields = false;
}

function updateAnnotationStorageValue(annId, value) {
  const annotationStorage = getAnnotationStorage();
  if (annotationStorage) {
    try {
      annotationStorage.setValue(annId, { value });
    } catch (e) {
      // Ignore storage errors during toggle
    }
  }
}

function applyKeystrokeRestriction(input, restriction, ann) {
  if (restriction.type === 'regex') {
    input.inputMode = restriction.inputMode || 'text';
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        if (!restriction.charPattern.test(e.data)) e.preventDefault();
      }
    });
    input.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!restriction.fullPattern.test(text)) e.preventDefault();
    });
  } else if (restriction.type === 'number') {
    const decPlaces = parseAFNumberDecimals(ann.actions);
    input.inputMode = 'decimal';
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        const allowed = decPlaces > 0 ? /^[\d.\-,]$/ : /^[\d\-,]$/;
        if (!allowed.test(e.data)) e.preventDefault();
        if (e.data === '.' && input.value.includes('.')) e.preventDefault();
        if (e.data === '-' && input.selectionStart !== 0) e.preventDefault();
      }
    });
    input.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const pattern = decPlaces > 0 ? /^-?[\d,]*\.?\d*$/ : /^-?[\d,]*$/;
      if (!pattern.test(text)) e.preventDefault();
    });
  } else if (restriction.type === 'percent') {
    input.inputMode = 'decimal';
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        if (!/^[\d.\-,%]$/.test(e.data)) e.preventDefault();
        if (e.data === '.' && input.value.includes('.')) e.preventDefault();
      }
    });
  } else if (restriction.type === 'date' || restriction.type === 'time') {
    input.inputMode = 'numeric';
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        if (!/^[\d/\-.: aApPmM]$/.test(e.data)) e.preventDefault();
      }
    });
  } else if (restriction.type === 'special') {
    const specialType = parseAFSpecialType(ann.actions);
    input.inputMode = 'numeric';
    input.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        const allowed = specialType === 2 ? /^[\d\-() ]$/ : /^[\d\-]$/;
        if (!allowed.test(e.data)) e.preventDefault();
      }
    });
  }
}

// ─── Blur validation ───────────────────────────────────────────────────────────

function buildBlurValidators(ann) {
  const validators = [];
  const blurActions = ann.actions?.Blur || [];
  const validate = ann.actions?.Validate?.[0] || '';

  // Comb field completeness check — use PDF message if available
  if (ann.comb && ann.maxLen > 0) {
    const incompleteMsg = jsConstants?.get('IDS_COMPLETE') || null;
    validators.push((value) => {
      if (value && value.length > 0 && value.length < ann.maxLen) {
        return incompleteMsg || `This field requires ${ann.maxLen} characters.`;
      }
      return null;
    });
  }

  // Process each Blur action — extract messages from the PDF's JS functions
  for (const action of blurActions) {
    const pdfMessages = getMessagesForBlurAction(action, jsFunctions, jsConstants);

    if (/elfCheck/.test(action)) {
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        return validateBSN(value, pdfMessages);
      });
    } else if (/checkDate/.test(action)) {
      const fieldName = ann.fieldName || '';
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        return validateDatePart(value, fieldName, pdfMessages, jsConstants);
      });
    } else if (/fieldComplete/.test(action)) {
      validators.push((value) => {
        if (!value || value.trim() === '') {
          return pdfMessages[0] || `This field is required.`;
        }
        return null;
      });
    } else if (pdfMessages.length > 0) {
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        if (ann.comb && ann.maxLen > 0 && value.length < ann.maxLen) {
          return pdfMessages[0];
        }
        return null;
      });
    }
  }

  // AFRange_Validate
  if (/AFRange_Validate/.test(validate)) {
    const rangeParams = parseAFRangeValidate(validate);
    if (rangeParams) {
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        const num = parseFloat(value.replace(/,/g, ''));
        if (isNaN(num)) return jsConstants?.get('IDS_VELD') || 'Invalid number.';
        if (rangeParams.hasMin && num < rangeParams.min) {
          return `Value must be at least ${rangeParams.min}.`;
        }
        if (rangeParams.hasMax && num > rangeParams.max) {
          return `Value must be at most ${rangeParams.max}.`;
        }
        return null;
      });
    }
  }

  return validators;
}

function applyBlurValidation(input, validators, ann) {
  input.addEventListener('blur', () => {
    if (isTogglingFields) return;
    if (input.disabled) return;

    const value = input.value;

    if (input.required && (!value || value.trim() === '')) {
      const reqMsg = jsConstants?.get('IDS_REQUIRED') || jsConstants?.get('IDS_VELD') || 'This field is required.';
      showValidationDialog(reqMsg, input);
      return;
    }

    for (const validate of validators) {
      const error = validate(value);
      if (error) {
        showValidationDialog(error, input);
        return;
      }
    }
  });
}

// ─── Form fields info bar ───────────────────────────────────────────────────────

const dismissedBarDocuments = new Set();

function showFormFieldsBar() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (dismissedBarDocuments.has(doc.id)) return;
  const bar = document.getElementById('form-fields-bar');
  if (!bar || bar.style.display !== 'none') return;
  bar.style.display = 'flex';

  const closeBtn = document.getElementById('form-fields-bar-close');
  if (closeBtn && !closeBtn._hasListener) {
    closeBtn._hasListener = true;
    closeBtn.addEventListener('click', () => {
      bar.style.display = 'none';
      const activeDoc = state.documents[state.activeDocumentIndex];
      if (activeDoc) dismissedBarDocuments.add(activeDoc.id);
    });
  }
}

export function hideFormFieldsBar() {
  const bar = document.getElementById('form-fields-bar');
  if (bar) bar.style.display = 'none';
}

// ─── Single page / cleanup ─────────────────────────────────────────────────────

export async function createSinglePageFormLayer(page, viewport) {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  clearSinglePageFormLayer();
  await createFormLayer(page, viewport, container, state.currentPage);
}

export function clearSinglePageFormLayer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const existingLayer = container.querySelector('.formLayer');
  if (existingLayer) {
    existingLayer.remove();
  }
  formLayers.delete(state.currentPage);
  initializedRadioGroups.clear();
}

export function clearFormLayers() {
  document.querySelectorAll('.formLayer').forEach(layer => {
    layer.remove();
  });
  formLayers.clear();
  initializedRadioGroups.clear();
  hideFormFieldsBar();
}
