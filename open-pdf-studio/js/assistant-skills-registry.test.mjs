// The assistant skills (#452) only name MCP tools the app really has, with the
// argument names of their schema. The registry is mcp-stdio/tools.json: it is
// generated from src-tauri/src/mcp_server.rs and a Rust test keeps the two
// equal, so it is the list the model behind the relay actually sees.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  ASSISTANT_SKILLS, ASSISTANT_SKILL_GROUPS, SKILLS_SYSTEM_PROMPT, SKILL_FORBIDDEN_TOOLS, SKILL_TOOL_EXCEPTIONS, buildSystemPrompt,
} from './assistant-skills.js';
import { CONSTRUCTIEOVERZICHT_PROMPT } from './constructieoverzicht/skill.js';
import { PLATTEGROND_PROMPT } from './plattegrond/skill.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TOOLS = new Map(JSON.parse(lees('../../mcp-stdio/tools.json')).map((t) => [t.name, t]));
const toolNames = (text) => [...new Set([...String(text).matchAll(/\b(app_[a-z_]+)/g)].map((m) => m[1]))];
const NEW_SKILLS = ASSISTANT_SKILLS.filter((s) => s.guide);

// Split on top-level commas, outside {} [] () and quotes.
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '"') quote = !quote;
    else if (!quote && '{[('.includes(ch)) depth += 1;
    else if (!quote && '}])'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0 && !quote) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Calls written as app_tool(arg, arg "value", props {a, b}) — the notation of
// the skill guides. "app_tool (" with a space is prose and not parsed.
function parseCalls(text) {
  const calls = [];
  const re = /\b(app_[a-z_]+)\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth; i++) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
    }
    const inner = text.slice(re.lastIndex, i - 1);
    const args = splitTop(inner).map((seg) => {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(seg)?.[0] ?? seg;
      const rest = seg.slice(name.length).trim();
      const str = /^"([^"]*)"$/.exec(rest)?.[1];
      const obj = /^\{(.*)\}$/s.exec(rest)?.[1];
      return { name, value: str, keys: obj != null ? splitTop(obj).map((k) => /^[A-Za-z_]\w*/.exec(k)?.[0]) : null };
    });
    calls.push({ tool: m[1], args });
  }
  return calls;
}

test('every MCP tool named in the system prompt and the skills exists', () => {
  const text = [buildSystemPrompt({ code: 'en' }), ...ASSISTANT_SKILLS.map((s) => s.invoke)].join('\n');
  const named = toolNames(text);
  assert.ok(named.length >= 30, `the prompt names the tools (${named.length})`);
  const missing = named.filter((n) => !TOOLS.has(n));
  assert.deepEqual(missing, [], 'not in mcp-stdio/tools.json');
});

test('a skill declares the tools it uses, and only existing, reversible ones', () => {
  assert.ok(NEW_SKILLS.length >= 11);
  for (const skill of NEW_SKILLS) {
    assert.ok(Array.isArray(skill.tools) && skill.tools.length, `${skill.id}: tools`);
    for (const tool of skill.tools) {
      assert.ok(TOOLS.has(tool), `${skill.id}: ${tool} does not exist`);
      assert.ok(!SKILL_FORBIDDEN_TOOLS.includes(tool), `${skill.id}: ${tool} is not for a skill`);
    }
    const used = toolNames(`${skill.invoke}\n${skill.guide}`);
    for (const tool of used) assert.ok(skill.tools.includes(tool), `${skill.id}: uses ${tool} without declaring it`);
    for (const tool of skill.tools) assert.ok(used.includes(tool), `${skill.id}: declares ${tool} but its guide never says how`);
    assert.ok(SKILLS_SYSTEM_PROMPT.includes(skill.guide), `${skill.id}: the guide is in the system prompt`);
  }
  for (const tool of SKILL_FORBIDDEN_TOOLS) assert.ok(TOOLS.has(tool), `${tool} exists`);
});

test('every call in the guides uses the argument names and values of the tool schema', () => {
  const calls = parseCalls(SKILLS_SYSTEM_PROMPT);
  assert.ok(calls.length >= 40, `the guides write their calls out (${calls.length})`);
  const problems = [];
  for (const { tool, args } of calls) {
    const schema = TOOLS.get(tool)?.inputSchema;
    if (!schema) { problems.push(`${tool}: unknown`); continue; }
    const props = schema.properties || {};
    const names = args.map((a) => a.name);
    for (const a of args) {
      if (!(a.name in props)) { problems.push(`${tool}(${a.name}): no such argument`); continue; }
      const allowed = props[a.name].enum;
      if (allowed && a.value != null && !allowed.includes(a.value)) problems.push(`${tool}(${a.name} "${a.value}"): not in ${allowed}`);
    }
    for (const req of schema.required || []) {
      if (!names.includes(req)) problems.push(`${tool}: required argument ${req} missing`);
    }
  }
  assert.deepEqual(problems, []);
});

// The props an annotation type needs (js/mcp-bridge.js, the description of
// app_create_annotation). A guide that names a type gives its geometry.
const GEOMETRY = {
  highlight: ['x', 'y', 'width', 'height'],
  cloud: ['x', 'y', 'width', 'height'],
  callout: ['x', 'y', 'width', 'height'],
  textbox: ['x', 'y', 'width', 'height'],
  stamp: ['x', 'y', 'width', 'height'],
  count: ['x', 'y'],
  measureDistance: ['startX', 'startY', 'endX', 'endY'],
  measureArea: ['points'],
};

test('app_create_annotation in the guides gives the geometry of its type', () => {
  const description = TOOLS.get('app_create_annotation').description;
  for (const prop of ['startX/startY/endX/endY', 'x/y/width/height', 'points:[{x,y},...]']) assert.ok(description.includes(prop));
  const creates = NEW_SKILLS.flatMap((s) => parseCalls(s.guide).filter((c) => c.tool === 'app_create_annotation'));
  assert.ok(creates.length >= 10);
  for (const { args } of creates) {
    const type = args.find((a) => a.name === 'type').value;
    assert.ok(GEOMETRY[type], `type ${type} has a known geometry`);
    const keys = args.find((a) => a.name === 'props')?.keys || [];
    for (const k of GEOMETRY[type]) assert.ok(keys.includes(k), `${type} needs props.${k}`);
  }
});

test('the parser reads the call notation', () => {
  assert.deepEqual(parseCalls('use app_x(a, b "c", props {d, e: 1}) and app_y()'), [
    { tool: 'app_x', args: [{ name: 'a', value: undefined, keys: null }, { name: 'b', value: 'c', keys: null }, { name: 'props', value: undefined, keys: ['d', 'e'] }] },
    { tool: 'app_y', args: [] },
  ]);
  assert.deepEqual(parseCalls('app_screenshot_view (width 2000)'), [], 'prose with a space is not a call');
});

test('skills are grouped; every group has skills, every skill a known group', () => {
  const groups = ASSISTANT_SKILL_GROUPS.map((g) => g.id);
  assert.equal(new Set(groups).size, groups.length);
  for (const g of ASSISTANT_SKILL_GROUPS) assert.ok(g.icon, g.id);
  for (const skill of ASSISTANT_SKILLS) assert.ok(groups.includes(skill.group), `${skill.id}: group ${skill.group}`);
  for (const g of groups) assert.ok(ASSISTANT_SKILLS.some((s) => s.group === g), `group ${g} is empty`);
  const REQUIRES = ['document', 'selection', 'scale', 'twoPages'];
  for (const skill of ASSISTANT_SKILLS) {
    for (const r of skill.requires || []) assert.ok(REQUIRES.includes(r), `${skill.id}: requires ${r}`);
  }
});

test('the skill groups of #452 are there', () => {
  const ids = ASSISTANT_SKILLS.map((s) => s.id);
  for (const id of ['find-on-sheet', 'explain-selection', 'compare-sheets', 'measure', 'take-off', 'check-scale',
    'review-sheet', 'stamp-date', 'clean-up', 'import-cad', 'export-cad']) assert.ok(ids.includes(id), id);
  const skill = (id) => ASSISTANT_SKILLS.find((s) => s.id === id);
  assert.ok(skill('take-off').tools.includes('app_place_schedule'), 'take-off puts a schedule on the sheet');
  assert.ok(skill('check-scale').tools.includes('app_set_measure_scale'));
  assert.ok(skill('import-cad').tools.includes('app_import_cad'));
  assert.ok(skill('export-cad').tools.includes('app_export_cad'));
  assert.deepEqual(skill('explain-selection').requires, ['document', 'selection']);
  assert.ok(skill('measure').requires.includes('scale'));
  assert.equal(skill('compare-sheets').inputKind, 'page');
});

// Tools that save, print, delete or change the content without an undo, also
// indirectly: a ribbon command, a key (Ctrl+S, Ctrl+P) or a click reaches
// save and print as well.
const MUST_BE_FORBIDDEN = [
  'app_save_pdf', 'app_print', 'app_print_to_pdf', 'app_close_tab', 'app_delete_annotation',
  'app_run_command', 'app_key', 'app_click_element', 'app_replace_text',
  'app_snippet_cut', 'app_snippet_flatten', 'app_merge_pdf', 'app_install_extension',
];

test('the forbidden tools include the indirect routes to save, print and irreversible edits', () => {
  for (const tool of MUST_BE_FORBIDDEN) assert.ok(SKILL_FORBIDDEN_TOOLS.includes(tool), `${tool} is forbidden for skills`);
  const prompt = buildSystemPrompt({ code: 'en' });
  const boundaries = prompt.split('\n').find((l) => l.startsWith('- Boundaries:'));
  for (const tool of SKILL_FORBIDDEN_TOOLS) assert.ok(boundaries.includes(tool), `the boundaries rule names ${tool}`);
});

test('a forbidden tool is only allowed for the one skill that needs it, and the prompt says how', () => {
  const ids = ASSISTANT_SKILLS.map((s) => s.id);
  const prompt = buildSystemPrompt({ code: 'en' });
  for (const [id, tools] of Object.entries(SKILL_TOOL_EXCEPTIONS)) {
    assert.ok(ids.includes(id), `${id} is a skill`);
    for (const [tool, use] of Object.entries(tools)) {
      assert.ok(SKILL_FORBIDDEN_TOOLS.includes(tool), `${id}: ${tool} is an exception to the forbidden list`);
      assert.ok(use && use.startsWith('only '), `${id}: ${tool} names its one use`);
      assert.ok(prompt.includes(`the skill "${id}" may call ${tool} ${use}`), `${id}: the prompt states the exception for ${tool}`);
    }
  }
  // The long prompts of the structure skills name no other forbidden tool.
  const prompts = { 'structural-overview': CONSTRUCTIEOVERZICHT_PROMPT, floorplan: PLATTEGROND_PROMPT };
  for (const [id, text] of Object.entries(prompts)) {
    const allowed = Object.keys(SKILL_TOOL_EXCEPTIONS[id] || {});
    const forbidden = toolNames(text).filter((t) => SKILL_FORBIDDEN_TOOLS.includes(t) && !allowed.includes(t));
    assert.deepEqual(forbidden, [], `${id} uses forbidden tools without an exception`);
  }
  // Every exception is used by its skill; an unused exception is dropped.
  for (const [id, tools] of Object.entries(SKILL_TOOL_EXCEPTIONS)) {
    for (const tool of Object.keys(tools)) assert.ok(toolNames(prompts[id] || '').includes(tool), `${id} uses ${tool}`);
  }
});

test('only markups are promised an undo; scale, title block and import ask first', () => {
  const prompt = buildSystemPrompt({ code: 'en' });
  assert.ok(!/Every markup a skill places can be undone/.test(prompt), 'the old blanket claim is gone');
  const rule = prompt.split('\n').find((l) => l.startsWith('- Before a skill changes the document'));
  assert.match(rule, /Every markup \(annotation\) a skill places can be undone with app_undo/);
  for (const tool of ['app_set_measure_scale', 'app_titleblock', 'app_import_cad']) assert.ok(rule.includes(tool), `${tool} asks first`);
  assert.match(rule, /wait for the user to confirm/);
});

test('export to CAD asks before it overwrites an existing file', () => {
  const guide = ASSISTANT_SKILLS.find((s) => s.id === 'export-cad').guide;
  assert.match(guide, /replaces an existing file/);
  assert.match(guide, /ask before exporting whether a file at that path may be overwritten/);
  const ask = guide.indexOf('ask before exporting');
  assert.ok(ask >= 0 && ask < guide.indexOf('app_export_cad(path'), 'the question comes before the export call');
});
