import { state } from '../core/state.js';
import { AnnotationLayer } from 'pdfjs-dist';

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
        console.log('[form-layer] Document JS loaded:', documentJS.length, 'chars');
        console.log('[form-layer] Constants found:', [...jsConstants.entries()]);
        console.log('[form-layer] Functions found:', [...jsFunctions.keys()]);
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

// ─── Document JS parsing ────────────────────────────────────────────────────────

/**
 * Extract string constants from document JS.
 * Only captures simple assignments like: IDS_DD = "some message"
 * Skips concatenated assignments where a + follows the string.
 */
function parseJSConstants(js) {
  const constants = new Map();
  const skip = new Set(['var', 'let', 'const', 'if', 'else', 'for', 'while', 'return', 'function', 'true', 'false']);
  // Match: IDENTIFIER = "string"
  const regex = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = regex.exec(js)) !== null) {
    if (skip.has(m[1])) continue;
    // Check what follows the closing quote — skip if it's a concatenation (+)
    const afterQuote = js.substring(m.index + m[0].length).match(/^\s*(\S)/);
    if (afterQuote && afterQuote[1] === '+') continue;
    // Decode escape sequences
    const value = decodeJSString(m[2]);
    constants.set(m[1], value);
  }
  return constants;
}

/**
 * Extract function bodies from document JS.
 * Simple brace-counting parser for: function name(...) { ... }
 */
function parseJSFunctions(js) {
  const functions = new Map();
  const funcRegex = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = funcRegex.exec(js)) !== null) {
    const name = m[1];
    const startIdx = m.index + m[0].length;
    let depth = 1;
    let i = startIdx;
    while (i < js.length && depth > 0) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}') depth--;
      i++;
    }
    functions.set(name, js.substring(startIdx, i - 1));
  }
  return functions;
}

/**
 * Extract all app.alert() messages from a function body.
 * Resolves IDS_* constant references to their actual string values.
 * Returns an array of message strings.
 */
function extractAlertMessages(funcBody) {
  if (!funcBody) return [];
  const messages = [];

  // Find all app.alert(...) calls and extract the first argument
  const alertCallRegex = /app\.alert\s*\(/g;
  let m;
  while ((m = alertCallRegex.exec(funcBody)) !== null) {
    const startIdx = m.index + m[0].length;
    const firstArg = extractFirstArgument(funcBody, startIdx);
    if (!firstArg) continue;

    const trimmed = firstArg.trim();
    const resolved = resolveExpression(funcBody, trimmed);
    if (resolved) messages.push(resolved);
  }

  console.log('[form-layer] extractAlertMessages found:', messages);
  return messages;
}

/**
 * Resolve an expression to a string value.
 * Handles: string literals, constant/variable references (global + local), and concatenation.
 */
function resolveExpression(funcBody, expr) {
  const trimmed = expr.trim();

  // String literal
  const strMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/) || trimmed.match(/^'((?:[^'\\]|\\.)*)'$/);
  if (strMatch) return decodeJSString(strMatch[1]);

  // Single identifier — resolve from local assignment first, then global constants
  if (/^\w+$/.test(trimmed)) {
    const localVal = resolveLocalVariable(funcBody, trimmed);
    if (localVal) return localVal;
    if (jsConstants && jsConstants.has(trimmed)) return jsConstants.get(trimmed);
    return null;
  }

  // Concatenation: "str" + var + "str"
  if (trimmed.includes('+')) {
    return resolveStringConcat(trimmed, funcBody);
  }

  return null;
}

/**
 * Resolve a local variable assignment from a function body.
 * Finds patterns like: varName = "str" + var + "str"
 * and resolves the full concatenation expression.
 */
function resolveLocalVariable(funcBody, varName) {
  // Find the last assignment: [var] varName = <expression>
  // Use word boundary to avoid partial matches (e.g. IDS_BSN shouldn't match IDS_BSN2)
  const pattern = new RegExp(`(?:var\\s+)?\\b${varName}\\b\\s*=\\s*`, 'g');
  let lastMatch = null;
  let m;
  while ((m = pattern.exec(funcBody)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return null;

  const exprStart = lastMatch.index + lastMatch[0].length;
  const exprStr = extractAssignmentExpression(funcBody, exprStart);
  if (!exprStr) return null;

  console.log(`[form-layer] resolveLocalVariable(${varName}) extracted expression:`, JSON.stringify(exprStr).substring(0, 300));

  return resolveStringConcat(exprStr, funcBody);
}

/**
 * Extract the right-hand side of an assignment starting at startIdx.
 * Handles multi-line concatenations and strings containing semicolons.
 */
function extractAssignmentExpression(code, startIdx) {
  let i = startIdx;
  let inStr = null;

  while (i < code.length) {
    const ch = code[i];

    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'") { inStr = ch; }
      else if (ch === ';') {
        return code.substring(startIdx, i).trim();
      }
      else if (ch === '\n' || ch === '\r') {
        // At a line break outside a string — check if expression continues
        const exprSoFar = code.substring(startIdx, i).trimEnd();

        // Look at what's after the line break(s)
        let j = i;
        while (j < code.length && (code[j] === '\n' || code[j] === '\r' || code[j] === ' ' || code[j] === '\t')) j++;
        const nextNonWS = code[j] || '';

        // If current line ends with + or next content starts with +, it's a continuation
        if (exprSoFar.endsWith('+') || nextNonWS === '+') {
          // Skip past the whitespace/newlines to continue parsing
        } else {
          // Not a continuation — this is the end of the expression
          return exprSoFar;
        }
      }
    }
    i++;
  }
  return code.substring(startIdx, i).trim();
}

/**
 * Extract the first argument from a function call starting after the opening '('.
 * Handles nested parens, strings, and commas.
 */
function extractFirstArgument(code, startIdx) {
  let depth = 0;
  let inStr = null; // null, '"', or "'"
  let i = startIdx;
  const start = startIdx;

  while (i < code.length) {
    const ch = code[i];

    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'") { inStr = ch; }
      else if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) return code.substring(start, i);
        depth--;
      }
      else if (ch === ',' && depth === 0) {
        return code.substring(start, i);
      }
    }
    i++;
  }
  return null;
}

/**
 * Decode JS string escape sequences
 */
function decodeJSString(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\u([\da-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Resolve a JS string concatenation expression.
 * Handles: "literal" + variable + "literal"
 * Resolves variables from global constants and optionally from local function body.
 */
function resolveStringConcat(expr, funcBody) {
  // Split on + but not inside quotes
  const parts = splitConcatParts(expr);
  let result = '';
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // String literal
    const strMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/) || trimmed.match(/^'((?:[^'\\]|\\.)*)'$/);
    if (strMatch) {
      result += decodeJSString(strMatch[1]);
      continue;
    }

    // Try global constants
    if (/^\w+$/.test(trimmed) && jsConstants && jsConstants.has(trimmed)) {
      result += jsConstants.get(trimmed);
      continue;
    }

    // For unresolvable variables (like function parameters), use placeholder
    result += '[...]';
  }
  return result || null;
}

/**
 * Split a concatenation expression on '+' while respecting string quotes.
 */
function splitConcatParts(expr) {
  const parts = [];
  let current = '';
  let inStr = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      current += ch;
      if (ch === '\\' && i + 1 < expr.length) { current += expr[++i]; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'") { inStr = ch; current += ch; }
      else if (ch === '+') { parts.push(current); current = ''; }
      else { current += ch; }
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Get the validation messages for a given blur action function call.
 * Extracts the function name from the action string, finds its body in the
 * document JS, and extracts all app.alert() messages.
 */
function getMessagesForBlurAction(actionStr) {
  if (!jsFunctions) return [];

  // Extract function name: e.g. "elfCheck(event.target.name,'bsn');" → "elfCheck"
  const funcMatch = actionStr.match(/(\w+)\s*\(/);
  if (!funcMatch) return [];

  const funcName = funcMatch[1];
  const funcBody = jsFunctions.get(funcName);
  if (!funcBody) {
    console.log('[form-layer] Function not found in doc JS:', funcName);
    return [];
  }

  console.log('[form-layer] Extracting messages for blur action:', funcName);
  console.log('[form-layer] Function body preview:', funcBody.substring(0, 500));
  return extractAlertMessages(funcBody);
}

// ─── Input restrictions & blur validation ──────────────────────────────────────

function applyFieldRestrictions(formLayerDiv, widgetAnnotations) {
  for (const ann of widgetAnnotations) {
    const section = formLayerDiv.querySelector(`[data-annotation-id="${ann.id}"]`);
    if (!section) continue;

    // Handle checkbox/radio actions (enable/disable other fields)
    const toggleInput = section.querySelector('input[type="checkbox"], input[type="radio"]');
    if (toggleInput) {
      console.log(`[form-layer] Found toggle input: ${ann.fieldName}`, {
        type: toggleInput.type,
        actions: ann.actions ? Object.keys(ann.actions) : 'none',
        allActions: ann.actions,
        fieldType: ann.fieldType,
        subtype: ann.subtype,
        checkBox: ann.checkBox,
        radioButton: ann.radioButton,
      });
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
        return validateDatePart(value, ann.fieldName, []);
      });
    }

    applyBlurValidation(input, validators, ann);
  }
}

/**
 * Detect if a field name indicates a date part (day, month, year).
 * Uses the PDF convention: the first character after the last dot determines the type.
 * E.g. "2.date02.d_F" → 'd' → day, "1.date01.m" → 'm' → month
 * Returns 'day', 'month', 'year', or null.
 */
function detectDatePartByName(fieldName) {
  if (!fieldName) return null;
  // Extract the last segment (after the last dot)
  const lastDot = fieldName.lastIndexOf('.');
  if (lastDot < 0) return null;
  const lastSegment = fieldName.substring(lastDot + 1).toLowerCase();
  if (!lastSegment) return null;
  // Check first character (PDF convention: d=day, m=month, y=year)
  const firstChar = lastSegment[0];
  // Validate it's a date segment (not a generic field starting with d/m/y)
  // Must be short segment or start with date keywords
  if (/^(d|dd|dag|day)(\b|_|$)/i.test(lastSegment)) return 'day';
  if (/^(m|mm|mnd|maand|month)(\b|_|$)/i.test(lastSegment)) return 'month';
  if (/^(y|yy|yyyy|jr|jaar|year)(\b|_|$)/i.test(lastSegment)) return 'year';
  return null;
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

  console.log(`[form-layer] Toggle actions on ${groupName}:`, actions);

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

    console.log(`[form-layer] Toggle handler for ${groupName}, selectedValue="${selectedValue}"`);

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
 * Recursively evaluates nested if/else blocks using selectedValue.
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
 * Evaluates conditions against selectedValue to pick the correct branch.
 */
function extractConditionalDisplayChanges(code, selectedValue) {
  const changes = [];

  // Find ALL top-level if/else chains (multiple separate if blocks)
  const allChains = parseAllIfChains(code);

  if (allChains.length > 0) {
    // Process each chain independently
    for (const chain of allChains) {
      let matched = false;
      for (const branch of chain) {
        if (branch.condition === null) {
          // 'else' block — use if nothing matched in this chain
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
    // No if/else found — extract flat display changes
    extractDisplayChangesFlat(code, changes);
  }

  return changes;
}

/**
 * Extract getField().display and getField().readonly patterns from JS code (flat, no conditional awareness).
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
 * Returns an array of chains, where each chain is:
 *   [{ condition: "expr" | null, body: "code" }, ...]
 * Multiple separate if statements produce separate chains.
 */
function parseAllIfChains(code) {
  const chains = [];
  const ifRegex = /if\s*\(([^)]+)\)\s*\{/g;
  let m;
  let lastChainEnd = -1;

  while ((m = ifRegex.exec(code)) !== null) {
    // Skip if this 'if' is inside a previous chain (it was an else-if already handled)
    if (m.index < lastChainEnd) continue;

    const chain = [];
    let pos = m.index + m[0].length;

    // First 'if' branch
    const firstBody = extractBraceBlock(code, pos);
    chain.push({ condition: m[1], body: firstBody.content });
    pos = firstBody.endPos;

    // Continue parsing 'else if' and 'else' branches
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
    // Move regex past this chain to avoid re-matching
    ifRegex.lastIndex = pos;
  }

  return chains;
}

/**
 * Extract content inside braces starting at pos (which is right after the '{').
 * Returns { content, endPos } where endPos is right after the closing '}'.
 */
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
 * Handles patterns like:
 *   myField.value == "1"  /  value == "Yes"  /  chk2 == "J"
 * For short comparison values (1-3 chars), uses prefix matching against selectedValue.
 */
function evaluateCondition(condition, selectedValue) {
  // Handle compound conditions with && — ALL parts must match
  if (condition.includes('&&')) {
    return condition.split('&&').every(part => evaluateCondition(part.trim(), selectedValue));
  }
  // Handle compound conditions with || — ANY part must match
  if (condition.includes('||')) {
    return condition.split('||').some(part => evaluateCondition(part.trim(), selectedValue));
  }

  const svLower = selectedValue.toLowerCase();

  // Match: something == "value" or something == 'value'
  const eqMatch = condition.match(/==\s*["']([^"']*)["']/);
  if (eqMatch) {
    const expected = eqMatch[1];
    if (expected === 'Off' || expected === '') return selectedValue === 'Off' || selectedValue === '';
    if (selectedValue === expected) return true;
    // Short value: try prefix match (e.g., "J" matches "Ja. Vul de datum...")
    if (expected.length <= 3 && expected.length < selectedValue.length) {
      return svLower.startsWith(expected.toLowerCase());
    }
    return false;
  }

  // Match: something != "value" or something != 'value'
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

  // Fallback: not Off = true
  return selectedValue !== 'Off' && selectedValue !== '';
}

/**
 * Parse direct field changes from an inline action string.
 */
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
  console.log('[form-layer] Applying field changes:', JSON.stringify(changes, null, 2));

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
          console.log(`[form-layer] ${hidden ? 'Hiding' : 'Showing'} field: ${fieldName}`);
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
    if (!found) {
      console.log(`[form-layer] Field NOT FOUND: "${change.fieldName}"`);
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
  const keystroke = ann.actions?.Keystroke?.[0] || '';
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
    const pdfMessages = getMessagesForBlurAction(action);

    // Extract function name for type detection
    const funcMatch = action.match(/(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : '';

    if (/elfCheck/.test(action)) {
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        return validateBSN(value, pdfMessages);
      });
    } else if (/checkDate/.test(action)) {
      const fieldName = ann.fieldName || '';
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        return validateDatePart(value, fieldName, pdfMessages);
      });
    } else if (/fieldComplete/.test(action)) {
      // Required field validation with PDF's own message
      validators.push((value) => {
        if (!value || value.trim() === '') {
          return pdfMessages[0] || `This field is required.`;
        }
        return null;
      });
    } else if (pdfMessages.length > 0) {
      // Generic validation function — we can't run the logic, but if the field
      // has blur actions with messages, add a completeness/format check
      validators.push((value) => {
        if (!value || value.length === 0) return null;
        // Check comb completeness
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
    // Skip validation when fields are being toggled (hidden/shown by radio/checkbox)
    if (isTogglingFields) return;
    // Skip validation on disabled/hidden inputs
    if (input.disabled) return;

    const value = input.value;

    // Check dynamic required attribute (set by toggle actions)
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

function showValidationDialog(message, input) {
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

// ─── Specific validators (using PDF messages when available) ────────────────────

function validateBSN(value, pdfMessages) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 9) {
    // Use first PDF message (typically about incorrect BSN)
    return pdfMessages[0] || `BSN must be exactly 9 digits.`;
  }
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  if (sum % 11 !== 0) {
    // Use second PDF message if available, otherwise first
    return pdfMessages[1] || pdfMessages[0] || 'Invalid BSN number.';
  }
  return null;
}

function validateDatePart(value, fieldName, pdfMessages) {
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

// ─── Action string parsers ─────────────────────────────────────────────────────

function detectKeystrokeRestriction(actions) {
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

function parseAFNumberDecimals(actions) {
  const keystroke = actions.Keystroke?.[0] || actions.Format?.[0] || '';
  const m = keystroke.match(/AFNumber_(?:Keystroke|Format)\((\d+)/);
  return m ? parseInt(m[1], 10) : 2;
}

function parseAFSpecialType(actions) {
  const keystroke = actions.Keystroke?.[0] || '';
  const m = keystroke.match(/AFSpecial_Keystroke\((\d+)\)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseAFRangeValidate(validate) {
  const m = validate.match(/AFRange_Validate\(\s*(true|false)\s*,\s*([^,]+)\s*,\s*(true|false)\s*,\s*([^)]+)\)/);
  if (!m) return null;
  return {
    hasMin: m[1] === 'true',
    min: parseFloat(m[2]),
    hasMax: m[3] === 'true',
    max: parseFloat(m[4]),
  };
}

// ─── Form fields info bar ───────────────────────────────────────────────────────

// Track which documents had the bar dismissed (by document ID)
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
