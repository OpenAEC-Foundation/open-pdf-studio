#!/usr/bin/env node
// Generates python/src/open_pdf_studio/_tools.py from mcp-stdio/tools.json
// (#518). tools.json is the public MCP catalogue of the app, written by the
// Rust test tools_json_van_de_brug_is_actueel; this script turns every tool
// into one typed Python method, so the Python library never describes a tool
// by hand and a new tool appears in Python with the next generation.
//
//   node python/scripts/generate-tools.mjs          write _tools.py
//   node python/scripts/generate-tools.mjs --check  fail when _tools.py is stale
//
// Zero dependencies; the output is deterministic (LF line endings, input
// order of tools.json) so the check can compare bytes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HIER, '..', '..');
export const TOOLS_JSON = join(REPO, 'mcp-stdio', 'tools.json');
export const UITVOER = join(REPO, 'python', 'src', 'open_pdf_studio', '_tools.py');

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield', 'self',
]);
// Names the generated class uses itself.
const GERESERVEERD = new Set(['_call_tool', '_client']);

/** camelCase / PascalCase / x1 -> snake_case. */
export function snakeCase(naam) {
  return String(naam)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase();
}

/** Python identifier for a schema property; keywords get a trailing underscore. */
export function pyParam(naam) {
  let p = snakeCase(naam);
  if (/^[0-9]/.test(p)) p = `_${p}`;
  if (PY_KEYWORDS.has(p)) p = `${p}_`;
  return p;
}

/** Method name of a tool: the `app_` prefix is dropped. */
export function pyMethod(toolNaam) {
  let m = snakeCase(toolNaam.replace(/^app_/, ''));
  if (PY_KEYWORDS.has(m) || GERESERVEERD.has(m)) m = `${m}_`;
  return m;
}

const PY_STR = (s) => JSON.stringify(String(s)); // a JSON string is a valid Python str literal

function pyType(schema) {
  if (!schema || typeof schema !== 'object') return 'Any';
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.every((v) => typeof v === 'string' || Number.isInteger(v))) {
    return `Literal[${schema.enum.map((v) => (typeof v === 'string' ? PY_STR(v) : String(v))).join(', ')}]`;
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const een = (t) => {
    switch (t) {
      case 'string': return 'str';
      case 'integer': return 'int';
      case 'number': return 'float';
      case 'boolean': return 'bool';
      case 'array': return `List[${pyType(schema.items)}]`;
      case 'object': return 'Dict[str, Any]';
      default: return 'Any';
    }
  };
  const zonderNull = types.filter((t) => t !== 'null');
  if (zonderNull.length === 0) return 'Any';
  const delen = [...new Set(zonderNull.map(een))];
  let t = delen.length === 1 ? delen[0] : `Union[${delen.join(', ')}]`;
  if (types.includes('null')) t = `Optional[${t}]`;
  return t;
}

function typeLabel(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : ['any'];
  return types.join(' or ');
}

function wrap(tekst, breedte, inspring) {
  const uit = [];
  for (const alinea of String(tekst).split(/\n/)) {
    const woorden = alinea.split(/\s+/).filter(Boolean);
    if (!woorden.length) { uit.push(''); continue; }
    let regel = '';
    for (const w of woorden) {
      if (regel && (regel.length + 1 + w.length) > breedte) { uit.push(regel); regel = w; } else regel = regel ? `${regel} ${w}` : w;
    }
    if (regel) uit.push(regel);
  }
  return uit.map((r) => (r ? inspring + r : '')).join('\n');
}

// Docstring text: backslashes and triple quotes must not end the literal.
const doc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');

function extraLabel(schema) {
  const delen = [];
  if (schema && 'default' in schema) delen.push(`default ${JSON.stringify(schema.default)}`);
  if (schema && 'minimum' in schema) delen.push(`min ${schema.minimum}`);
  if (schema && 'maximum' in schema) delen.push(`max ${schema.maximum}`);
  return delen.length ? `; ${delen.join(', ')}` : '';
}

function methode(tool) {
  const naam = tool.name;
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const verplicht = (schema.required || []).filter((r) => r in props);
  const optioneel = Object.keys(props).filter((k) => !verplicht.includes(k));
  const pyNamen = new Map();
  for (const k of Object.keys(props)) {
    const p = pyParam(k);
    if ([...pyNamen.values()].includes(p)) throw new Error(`${naam}: parameters collide on Python name ${p}`);
    pyNamen.set(k, p);
  }
  const sig = ['self'];
  for (const k of verplicht) sig.push(`${pyNamen.get(k)}: ${pyType(props[k])}`);
  if (optioneel.length) {
    sig.push('*');
    for (const k of optioneel) {
      const t = pyType(props[k]);
      sig.push(`${pyNamen.get(k)}: ${t.startsWith('Optional[') ? t : `Optional[${t}]`} = None`);
    }
  }
  const ann = tool.annotations || {};
  const titel = ann.title || naam;
  const soort = ann.readOnlyHint ? 'read-only' : ann.destructiveHint ? 'modifies or discards state' : 'changes state';
  const r = [];
  r.push(`    def ${pyMethod(naam)}(${sig.join(', ')}) -> Any:`);
  r.push(`        """${doc(titel)}.`);
  r.push('');
  r.push(wrap(doc(tool.description || ''), 72, '        '));
  if (Object.keys(props).length) {
    r.push('');
    r.push('        Args:');
    for (const k of [...verplicht, ...optioneel]) {
      const s = props[k] || {};
      const kop = `${pyNamen.get(k)} (${typeLabel(s)}${verplicht.includes(k) ? ', required' : ''}${extraLabel(s)})`;
      const kopTekst = k === pyNamen.get(k) ? kop : `${kop} [MCP: ${k}]`;
      const beschrijving = s.description ? `: ${s.description}` : '';
      const regels = wrap(doc(`${kopTekst}${beschrijving}`), 68, '            ').split('\n');
      r.push(regels[0]);
      for (const extra of regels.slice(1)) r.push(extra ? `    ${extra}` : '');
    }
  }
  r.push('');
  r.push(`        MCP tool \`\`${naam}\`\` (${soort}).`);
  r.push('        """');
  const paren = Object.keys(props).map((k) => `${PY_STR(k)}: ${pyNamen.get(k)}`);
  r.push(`        return self._call_tool(${PY_STR(naam)}, _pack({${paren.join(', ')}}))`);
  return r.join('\n');
}

function metadata(tool) {
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const ann = tool.annotations || {};
  const params = Object.keys(props).map((k) => `${PY_STR(pyParam(k))}: ${PY_STR(k)}`).join(', ');
  const req = (schema.required || []).map(PY_STR).join(', ');
  return [
    `    ${PY_STR(tool.name)}: {`,
    `        "method": ${PY_STR(pyMethod(tool.name))},`,
    `        "title": ${PY_STR(ann.title || tool.name)},`,
    `        "read_only": ${ann.readOnlyHint ? 'True' : 'False'},`,
    `        "destructive": ${ann.destructiveHint ? 'True' : 'False'},`,
    `        "params": {${params}},`,
    `        "required": (${req}${(schema.required || []).length === 1 ? ',' : ''}),`,
    '    },',
  ].join('\n');
}

export function genereer(tools) {
  if (!Array.isArray(tools) || tools.length === 0) throw new Error('tools.json holds no tools');
  const methodes = new Set();
  for (const t of tools) {
    const m = pyMethod(t.name);
    if (methodes.has(m)) throw new Error(`two tools map to the Python method ${m}`);
    methodes.add(m);
  }
  const kop = [
    '# Generated by python/scripts/generate-tools.mjs from mcp-stdio/tools.json.',
    '# Do not edit by hand: run `node python/scripts/generate-tools.mjs` after the',
    '# MCP catalogue changes (CI fails while this file is stale).',
    '"""Typed methods for every public Open PDF Studio MCP tool (generated)."""',
    '',
    'from __future__ import annotations',
    '',
    'from typing import Any, Dict, List, Literal, Optional, Union',
    '',
    '__all__ = ["TOOLS", "ToolMethods", "NULL"]',
    '',
    '',
    'class _Null:',
    '    """Sentinel: send an explicit JSON ``null`` (``None`` leaves an argument out)."""',
    '',
    '    __slots__ = ()',
    '',
    '    def __repr__(self) -> str:',
    '        return "NULL"',
    '',
    '',
    'NULL = _Null()',
    '',
    '',
    'def _pack(arguments: Dict[str, Any]) -> Dict[str, Any]:',
    '    return {k: (None if v is NULL else v) for k, v in arguments.items() if v is not None}',
    '',
    '',
    `#: Metadata per MCP tool name: Python method, title, hints, Python -> MCP`,
    '#: parameter names and required MCP parameters.',
    'TOOLS: Dict[str, Dict[str, Any]] = {',
    ...tools.map(metadata),
    '}',
    '',
    '',
    'class ToolMethods:',
    '    """One method per MCP tool of Open PDF Studio.',
    '',
    '    Generated from the app\'s tool catalogue. Required tool parameters are',
    '    positional, optional ones keyword-only; ``None`` leaves a parameter out.',
    '    Each method returns the decoded tool result (usually a ``dict``) and',
    '    raises :class:`open_pdf_studio.ToolError` when the tool reports a failure.',
    '    """',
    '',
    '    def _call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:  # pragma: no cover',
    '        raise NotImplementedError',
  ];
  return `${[...kop, ...tools.map((t) => `\n${methode(t)}`)].join('\n')}\n`;
}

export function leesTools(pad = TOOLS_JSON) {
  return JSON.parse(readFileSync(pad, 'utf8').replace(/\r\n/g, '\n'));
}

function hoofd(args) {
  const tekst = genereer(leesTools());
  if (args.includes('--check')) {
    let huidig = '';
    try { huidig = readFileSync(UITVOER, 'utf8').replace(/\r\n/g, '\n'); } catch { /* ontbreekt */ }
    if (huidig !== tekst) {
      console.error('python/src/open_pdf_studio/_tools.py is stale: run node python/scripts/generate-tools.mjs');
      return 1;
    }
    console.log('python/src/open_pdf_studio/_tools.py is up to date');
    return 0;
  }
  writeFileSync(UITVOER, tekst, 'utf8');
  console.log(`wrote ${UITVOER} (${leesTools().length} tools)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = hoofd(process.argv.slice(2));
}
