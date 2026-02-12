// Document-level JavaScript parsing utilities for PDF form fields.
// All functions are pure (take explicit parameters, no module state).

/**
 * Extract string constants from document JS.
 * Only captures simple assignments like: IDS_DD = "some message"
 * Skips concatenated assignments where a + follows the string.
 */
export function parseJSConstants(js) {
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
export function parseJSFunctions(js) {
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
 * Decode JS string escape sequences
 */
export function decodeJSString(s) {
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
 * Get the validation messages for a given blur action function call.
 * Extracts the function name from the action string, finds its body in the
 * document JS, and extracts all app.alert() messages.
 */
export function getMessagesForBlurAction(actionStr, jsFunctions, jsConstants) {
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
  return extractAlertMessages(funcBody, jsConstants);
}

/**
 * Extract all app.alert() messages from a function body.
 * Resolves IDS_* constant references to their actual string values.
 * Returns an array of message strings.
 */
export function extractAlertMessages(funcBody, jsConstants) {
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
    const resolved = resolveExpression(funcBody, trimmed, jsConstants);
    if (resolved) messages.push(resolved);
  }

  console.log('[form-layer] extractAlertMessages found:', messages);
  return messages;
}

/**
 * Resolve an expression to a string value.
 * Handles: string literals, constant/variable references (global + local), and concatenation.
 */
function resolveExpression(funcBody, expr, jsConstants) {
  const trimmed = expr.trim();

  // String literal
  const strMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/) || trimmed.match(/^'((?:[^'\\]|\\.)*)'$/);
  if (strMatch) return decodeJSString(strMatch[1]);

  // Single identifier — resolve from local assignment first, then global constants
  if (/^\w+$/.test(trimmed)) {
    const localVal = resolveLocalVariable(funcBody, trimmed, jsConstants);
    if (localVal) return localVal;
    if (jsConstants && jsConstants.has(trimmed)) return jsConstants.get(trimmed);
    return null;
  }

  // Concatenation: "str" + var + "str"
  if (trimmed.includes('+')) {
    return resolveStringConcat(trimmed, funcBody, jsConstants);
  }

  return null;
}

/**
 * Resolve a local variable assignment from a function body.
 * Finds patterns like: varName = "str" + var + "str"
 * and resolves the full concatenation expression.
 */
function resolveLocalVariable(funcBody, varName, jsConstants) {
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

  return resolveStringConcat(exprStr, funcBody, jsConstants);
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
 * Resolve a JS string concatenation expression.
 * Handles: "literal" + variable + "literal"
 * Resolves variables from global constants and optionally from local function body.
 */
function resolveStringConcat(expr, funcBody, jsConstants) {
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
