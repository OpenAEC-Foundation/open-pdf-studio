// OpenAEC assistant skill set.
//
// Each skill is a capability the assistant can perform on the open PDF. A skill
// is plain data: an id, an icon, whether the user still has to add something
// (needsInput) and `invoke`, the instruction for the model. The instruction stays
// in one language (English) for every user, so the model behaves the same
// whatever language the app shows.
//
// Everything the user sees (chip label, tooltip, the text that appears in the
// chat or in the input box) lives in the locale files under
// `common.assistant.skills.<id>.{label,hint,prompt}`; skillKeys() names them.
//
// SKILLS_SYSTEM_PROMPT teaches the model which MCP tools to use; buildSystemPrompt()
// wraps it with the answer language, which follows the app language.
//
// Skills are declarative (#452): besides the fields above a skill names its
// `group` (a tab in the panel), the app state it `requires` before it may be
// sent ('document', 'selection', 'scale', 'twoPages'), how its input is checked
// (`inputKind: 'page'`, `inputOptional: 'selection'`), the MCP `tools` it may
// use and a `guide`: the English how-to that goes into the system prompt. A
// skill with `context: true` gets the app state (page, selection, scale, date)
// appended to its instruction, so the model does not have to ask for it.
// skillBlocker() and skillInputProblem() are the gates the panel applies; they
// return a locale key (common.assistant.need.*) instead of sending.

import { PLATTEGROND_SKILL, PLATTEGROND_PROMPT } from './plattegrond/skill.js';
import { CONSTRUCTIEOVERZICHT_SKILL, CONSTRUCTIEOVERZICHT_PROMPT } from './constructieoverzicht/skill.js';

/** The tabs of the skill panel, in order. Labels: common.assistant.groups.<id>. */
export const ASSISTANT_SKILL_GROUPS = [
  { id: 'document', icon: '📄' },
  { id: 'reading', icon: '🔎' },
  { id: 'measuring', icon: '📏' },
  { id: 'markup', icon: '✏️' },
  { id: 'structure', icon: '🏗️' },
  { id: 'cad', icon: '📐' },
];

// Tools a skill never calls on its own: they are not undone like a markup
// (saving over the original, printing, closing, deleting), or they reach those
// actions indirectly (any ribbon command, a key such as Ctrl+S or Ctrl+P, a
// click on any button), change the page content itself (replace text, cut or
// flatten a snippet into the page, merge files) or change the app (install an
// extension).
export const SKILL_FORBIDDEN_TOOLS = [
  'app_save_pdf', 'app_print', 'app_print_to_pdf', 'app_close_tab', 'app_delete_annotation',
  'app_run_command', 'app_key', 'app_click_element', 'app_replace_text',
  'app_snippet_cut', 'app_snippet_flatten', 'app_merge_pdf', 'app_install_extension',
];

// The few forbidden tools a skill genuinely needs, per skill id, each with the
// one use it is allowed for. The system prompt names these exceptions, so the
// model may use them for that skill only and only in that way.
export const SKILL_TOOL_EXCEPTIONS = {
  'structural-overview': {
    // Copies a storey of the architect's floor plan as a vector snippet: the
    // source tab is not changed, the copy is pasted as a movable annotation.
    app_snippet_cut: 'only to copy a storey from the architect\'s tab (the source is not changed)',
    // The pasted snippet has to lie under the markup and there is no dedicated
    // tool for the drawing order.
    app_run_command: 'only with command "ribbon:#arr-send-back", to put a pasted snippet under the markup',
    // Replacing a snippet with a better cut-out.
    app_delete_annotation: 'only for a snippet this skill pasted itself and now replaces',
  },
};

// The skills of #452. The instruction (`invoke`) says what to do, the `guide`
// in the system prompt says how, with the MCP tools written as calls:
// app_tool(argument, argument "value") — assistant-skills-registry.test.mjs
// checks every name and argument against mcp-stdio/tools.json.
const READING_SKILLS = [
  {
    id: 'find-on-sheet',
    group: 'reading',
    icon: '🔎',
    invoke: 'Find on this sheet, go to the page and highlight every hit. Search term: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_search_documents', 'app_get_page_text', 'app_go_to_page', 'app_create_annotation', 'app_screenshot_view'],
    guide: 'Find on this sheet: call app_search_documents(query, scope "active") to learn on which pages the term occurs. ' +
      'For the exact boxes read app_get_page_text(page): every span carries a bbox in page points with the origin at the top left, the same coordinates as annotations. ' +
      'Go to the first page with hits with app_go_to_page(page) and mark every hit with app_create_annotation(type "highlight", page, props {x, y, width, height}). ' +
      'A symbol or a scanned sheet has no text: then look with app_screenshot_view(width 2000) and put a cloud around what you recognise. Report the number of hits per page.',
  },
  {
    id: 'explain-selection',
    group: 'reading',
    icon: '💬',
    invoke: 'Explain the selection in plain language: what it is, what it shows and, when a measuring scale is set, its dimensions. Change nothing.',
    requires: ['document', 'selection'],
    context: true,
    tools: ['app_get_annotation', 'app_capture_region', 'app_get_page_text'],
    guide: 'Explain this selection: the app context lists the selected annotations (id, type, page, box) or the selected text. ' +
      'Read every selected annotation with app_get_annotation(id); measure annotations carry their measureText. ' +
      'Look at the drawing around the box with app_capture_region(page, x, y, width, height, dpi 150), with some margin, and read nearby labels with app_get_page_text(page). ' +
      'Describe it in plain language; give dimensions in real units only when the context reports a measuring scale. This skill only reads.',
  },
  {
    id: 'compare-sheets',
    group: 'reading',
    icon: '🔀',
    invoke: 'Compare the current page with another page: name what was added, removed or moved and mark each difference on the current page. Other page: ',
    needsInput: true,
    inputKind: 'page',
    requires: ['document', 'twoPages'],
    context: true,
    tools: ['app_get_page_text', 'app_capture_region', 'app_create_annotation', 'app_list_annotations'],
    guide: 'Compare two sheets: read the text of both pages with app_get_page_text(page) and compare the spans by content and position (bbox). ' +
      'Look at both pages with app_capture_region(page, dpi 100) for linework and symbols without text, and compare their markups with app_list_annotations(page). ' +
      'Mark every difference on the current page with app_create_annotation(type "cloud", page, props {x, y, width, height, text}) and give it a short note: added, removed or moved. ' +
      'List the differences in the panel, one line each, and say when the pages differ in size so positions are not comparable.',
  },
];

const MEASURING_SKILLS = [
  {
    id: 'measure',
    group: 'measuring',
    icon: '📏',
    invoke: 'Measure this and report the result in the drawing\'s scale. What to measure: ',
    invokeWithoutInput: 'Measure the selected annotations and report the result in the drawing\'s scale.',
    needsInput: true,
    inputOptional: 'selection',
    requires: ['document', 'scale'],
    context: true,
    tools: ['app_get_annotation', 'app_create_annotation', 'app_get_page_text', 'app_screenshot_view', 'app_get_viewport_state'],
    guide: 'Measure this: for a selected annotation read app_get_annotation(id); a measure annotation carries measureText, for another shape compute length or area from its geometry with the scale in the app context (pixelsPerUnit page points per unit). ' +
      'For a described element find it first (app_get_page_text(page), or app_screenshot_view(width 2000) with the page size from app_get_viewport_state()) and place a measurement: ' +
      'app_create_annotation(type "measureDistance", props {startX, startY, endX, endY}) for a length, app_create_annotation(type "measureArea", props {points}) for an area. The app computes measureText from the scale itself. ' +
      'Report the value with its unit and say what you measured.',
  },
  {
    id: 'take-off',
    group: 'measuring',
    icon: '🧮',
    invoke: 'Take off: count or measure the elements of this kind and place the result as a schedule on the sheet, with a short summary here. Elements: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_fit_page', 'app_screenshot_view', 'app_get_viewport_state', 'app_list_annotations', 'app_create_annotation', 'app_place_schedule', 'app_get_takeoff'],
    guide: 'Take off: first check with app_list_annotations(page) whether the elements are already marked. ' +
      'To count, run app_fit_page(), look with app_screenshot_view(width 2000) (screenshot pixels to page points via pageW/pageH of app_get_viewport_state()) and place one app_create_annotation(type "count", props {x, y}) on each element. ' +
      'To measure areas or lengths a measuring scale is needed: when the app context reports none, say so and suggest the skill Check the scale instead of guessing; otherwise place app_create_annotation(type "measureArea", props {points}) or (type "measureDistance", props {startX, startY, endX, endY}). ' +
      'Then put the result on the sheet with app_place_schedule(templateId "count", name, page, x, y) (templateId "area" or "length" for measurements) in free space, and read the totals back with app_get_takeoff(name). ' +
      'The result belongs on the sheet; the panel answer is a two-line summary with the totals.',
  },
  {
    id: 'check-scale',
    group: 'measuring',
    icon: '📐',
    invoke: 'Check the scale of this drawing: find it from the title block or a known dimension, set it and say what it is based on.',
    requires: ['document'],
    context: true,
    tools: ['app_titleblock', 'app_get_page_text', 'app_list_annotations', 'app_screenshot_view', 'app_set_measure_scale'],
    guide: 'Check the scale: look for the scale in the title block (app_titleblock() lists its fields, such as "schaal") and in the page text (app_get_page_text(page): patterns like 1:100, SCALE 1:50, M 1:200). ' +
      'Verify it against a known dimension when there is one: a dimension text and the length of its line in page points (app_list_annotations(page), or the drawing seen with app_screenshot_view(width 2000)). ' +
      'At 1:N in millimetres one real millimetre is 72/25.4/N page points. When the app context reports no scale, set the found one with app_set_measure_scale(pixelsPerUnit, unit "mm"); when it reports a different one, name both and set the found scale only after the user confirms. ' +
      'Say what you based it on. When sources disagree (title block against a dimension, or several viewports at different scales), report that and ask before setting anything.',
  },
];

const MARKUP_SKILLS = [
  {
    id: 'review-sheet',
    group: 'markup',
    icon: '🔍',
    invoke: 'Review this sheet like a checker: add a cloud with a numbered comment for every point you would raise, and give a short list here. Check: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_get_page_text', 'app_screenshot_view', 'app_capture_region', 'app_get_viewport_state', 'app_list_layers', 'app_create_layer', 'app_list_annotations', 'app_create_annotation'],
    guide: 'Review this sheet: read the sheet (app_get_page_text(page) for texts and their positions, app_screenshot_view(width 2000) or app_capture_region(page, x, y, width, height, dpi 150) for details, screenshot pixels to page points via pageW/pageH of app_get_viewport_state()) and check it against the instruction. ' +
      'All review markups go on one markup layer, so they can be hidden or removed together: look with app_list_layers() for a layer named "Review" and create it once with app_create_layer(name "Review", color "#e11d48") when it is missing. ' +
      'Continue the numbering of review comments already there (app_list_annotations(layer "Review")). ' +
      'For every point place app_create_annotation(type "cloud", layer "Review", props {x, y, width, height}) around the spot and app_create_annotation(type "callout", layer "Review", props {x, y, width, height, arrowX, arrowY, text}) beside it with the number and one sentence. ' +
      'Raise only points you can point at on the sheet; in the panel list them as "1. ...", one line each.',
  },
  {
    id: 'stamp-date',
    group: 'markup',
    icon: '🔖',
    invoke: 'Place a stamp, a title block entry or a revision note with today\'s date. What: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_titleblock', 'app_list_annotations', 'app_get_viewport_state', 'app_create_annotation'],
    guide: 'Stamp and date: use the date from the app context, never a date of your own. ' +
      'A title block entry (revision, date, status): list the fields with app_titleblock() and fill them with app_titleblock(fields, page). ' +
      'A stamp: app_create_annotation(type "stamp", props {x, y, width, height, stampName, stampSvg}) with an SVG of a bordered text and the date, placed in free space near the title block (page size from app_get_viewport_state(), existing markups from app_list_annotations(page)). ' +
      'A revision note: app_create_annotation(type "textbox", props {x, y, width, height, text}). Say where you placed it.',
  },
  {
    id: 'clean-up',
    group: 'markup',
    icon: '🧹',
    invoke: 'Clean up my markups consistently, changing only what is asked. How: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_list_annotations', 'app_get_annotation', 'app_update_annotation'],
    guide: 'Clean up my markups: read the markups with app_list_annotations(page) (with selected annotations in the app context, only those) and change them only with app_update_annotation(id, props): ' +
      'align (the same x or y for markups in a row or column), renumber (the numbers in their text in reading order: top to bottom, left to right) or recolour (color, strokeColor, fillColor). ' +
      'Never delete, create or move markups to another page for this; read the details with app_get_annotation(id) when the list is not enough. Report how many markups changed.',
  },
];

const CAD_SKILLS = [
  {
    id: 'import-cad',
    group: 'cad',
    icon: '📥',
    invoke: 'Bring in a DWG or DXF drawing as an underlay on the current page at the right scale; ask only for what cannot be derived. Drawing: ',
    needsInput: true,
    context: true,
    tools: ['app_import_cad', 'app_titleblock', 'app_get_page_text'],
    guide: 'Bring in a drawing: the user gives the path of the .dwg or .dxf file, optionally a scale and a layout. ' +
      'Without an open document use target "new"; otherwise import it on the current page with app_import_cad(path, target "underlay", scale, space). ' +
      'Take the scale from the user\'s text, else from the sheet (app_titleblock(), app_get_page_text(page)); ask only for what you cannot derive, such as a missing path. ' +
      'Report the pages that were made and every warning (missing fonts, external references).',
  },
  {
    id: 'export-cad',
    group: 'cad',
    icon: '📤',
    invoke: 'Export the current page (or, with a selection, only that area) to a DXF or DWG file at the path given. Path: ',
    needsInput: true,
    requires: ['document'],
    context: true,
    tools: ['app_list_tabs', 'app_export_cad'],
    guide: 'Export this back: write only to the path the user typed, which must be absolute and end in .dxf or .dwg; never to the PDF itself. ' +
      'The export reads the file on disk: when app_list_tabs() reports the active tab as modified, tell the user that unsaved changes are not included and ask them to save first. ' +
      'app_export_cad replaces an existing file at that path without asking. Unless the user already said in this conversation that the file is new or may be replaced, ask before exporting whether a file at that path may be overwritten, and wait for the answer. ' +
      'Always ask when the path is a drawing that was brought in (the .dwg or .dxf of the skill Bring in a drawing): the original drawing must not be overwritten by accident. ' +
      'Then call app_export_cad(path, format, pages "current", scaleMode "measure", annotations true); with selected annotations in the app context pass their box as area [x0, y0, x1, y1]. ' +
      'Report the files written, their object counts and warnings.',
  },
];

export const ASSISTANT_SKILLS = [
  {
    id: 'translate',
    group: 'document',
    icon: '🌐',
    invoke: 'Translate the text of the open document into the user\'s language. If the document is already in that language, translate it into English; if the user\'s language is English too, ask which language to translate it into. Present the translation clearly.',
  },
  {
    id: 'summarize',
    group: 'document',
    icon: '📝',
    invoke: 'Summarise the open document or drawing concisely: what it is about, the main parts and any points that need attention.',
  },
  {
    id: 'draw',
    group: 'markup',
    icon: '✏️',
    invoke: 'Draw on the drawing: ',
    needsInput: true,
  },
  {
    id: 'detect-doors',
    group: 'markup',
    icon: '🚪',
    invoke: 'Look at the floor plan, recognise the doors and mark each door on the drawing with a markup and a short label.',
  },
  ...READING_SKILLS,
  ...MEASURING_SKILLS,
  ...MARKUP_SKILLS,
  ...CAD_SKILLS,
  {
    id: 'structural-layout',
    group: 'structure',
    icon: '🏗️',
    invoke: 'Lay out the load-bearing structure on the drawing: grid, columns on the nodes, beams on the grid lines, the span direction per floor field, level marks, position tags and a structural schedule. Brief: ',
    needsInput: true,
  },
  CONSTRUCTIEOVERZICHT_SKILL,
  PLATTEGROND_SKILL,
];

/** The locale keys (namespace `common`) of a skill's user-visible texts. */
export function skillKeys(skill) {
  const base = `assistant.skills.${skill.id}`;
  return { label: `${base}.label`, hint: `${base}.hint`, prompt: `${base}.prompt` };
}

/** The locale key (namespace `common`) of a group's label. */
export function skillGroupKey(group) {
  return `assistant.groups.${typeof group === 'string' ? group : group.id}`;
}

/** The skills of one group, in list order. */
export function skillsInGroup(groupId) {
  return ASSISTANT_SKILLS.filter((s) => s.group === groupId);
}

/**
 * What the user added after the localized prefix of a skill that needs input,
 * or null when the prefix is gone (the text is then the user's own question).
 */
export function skillInputRest(skill, localizedPrompt, typed) {
  const text = String(typed ?? '').trim();
  const prefix = String(localizedPrompt ?? '').trim();
  if (!prefix || !text.startsWith(prefix)) return null;
  return text.slice(prefix.length).trim();
}

/** Every locale key the gates below can return (common.assistant.need.*). */
export const SKILL_NEED_KEYS = ['document', 'selection', 'scale', 'input', 'selectionOrInput', 'page', 'twoPages']
  .map((k) => `assistant.need.${k}`);

const hasSelection = (ctx) => (ctx?.selection?.length || 0) > 0 || !!String(ctx?.selectedText || '').trim();

/**
 * Whether a skill may be sent in the app state `ctx` (see skillContextNote for
 * its fields). Returns null, or { key, params } with the message to show
 * instead of sending.
 */
export function skillBlocker(skill, ctx = {}) {
  const requires = skill.requires || [];
  if (requires.length && !ctx.hasDocument) return { key: 'assistant.need.document' };
  if (requires.includes('selection') && !hasSelection(ctx)) return { key: 'assistant.need.selection' };
  if (requires.includes('scale') && !ctx.hasScale) return { key: 'assistant.need.scale' };
  if (requires.includes('twoPages') && !((ctx.pageCount || 0) >= 2)) return { key: 'assistant.need.twoPages' };
  return null;
}

/**
 * Whether the input of a skill that needs input is complete. `rest` is what
 * skillInputRest returned (null = the user's own text, which is not checked).
 */
export function skillInputProblem(skill, rest, ctx = {}) {
  if (!skill.needsInput || rest == null) return null;
  if (skill.inputKind === 'page') {
    const max = ctx.pageCount || 0;
    const match = /\d+/.exec(rest);
    const page = match ? Number(match[0]) : NaN;
    if (!(page >= 1 && page <= max) || page === ctx.page) return { key: 'assistant.need.page', params: { max } };
    return null;
  }
  if (rest) return null;
  if (skill.inputOptional === 'selection') {
    return (ctx.selection?.length || 0) > 0 ? null : { key: 'assistant.need.selectionOrInput' };
  }
  return { key: 'assistant.need.input' };
}

const round = (n, digits = 4) => Number(Number(n).toFixed(digits));

/**
 * The app state as one block for the model, appended to the instruction of a
 * skill with `context: true`. `ctx` fields: hasDocument, page, pageCount,
 * selection [{ id, type, page, x, y, width, height }], selectedText,
 * scale { pixelsPerUnit, unit, method } | null, today ('YYYY-MM-DD').
 */
export function skillContextNote(ctx = {}) {
  const lines = [];
  if (!ctx.hasDocument) lines.push('- no document is open');
  else lines.push(`- current page: ${ctx.page} of ${ctx.pageCount}`);
  const sel = ctx.selection || [];
  if (sel.length) {
    const shown = sel.slice(0, 20).map((a) => {
      const box = [a.x, a.y, a.width, a.height].every(Number.isFinite)
        ? `, box x ${round(a.x, 1)} y ${round(a.y, 1)} w ${round(a.width, 1)} h ${round(a.height, 1)}` : '';
      return `${a.id} (${a.type}, page ${a.page}${box})`;
    });
    lines.push(`- selected annotations: ${shown.join('; ')}${sel.length > 20 ? `; and ${sel.length - 20} more` : ''}`);
  } else if (ctx.hasDocument) lines.push('- selected annotations: none');
  const text = String(ctx.selectedText || '').trim();
  if (text) lines.push(`- selected text: "${text.length > 500 ? `${text.slice(0, 500)}…` : text}"`);
  if (ctx.hasDocument) {
    lines.push(ctx.scale && ctx.scale.pixelsPerUnit > 0
      ? `- measuring scale: ${round(ctx.scale.pixelsPerUnit)} page points per ${ctx.scale.unit || 'mm'}${ctx.scale.method ? ` (from ${ctx.scale.method})` : ''}`
      : (ctx.hasScale ? '- measuring scale: set on part of the document (scale region, viewport or scale bar)' : '- measuring scale: not set'));
  }
  if (ctx.today) lines.push(`- today: ${ctx.today}`);
  return `\n\n[App context at the moment of sending]\n${lines.join('\n')}`;
}

/**
 * The message a chip click produces. `shown` is what the chat displays (in the
 * app language), `model` is what the model receives (the fixed instruction).
 * For a skill that needs input, `typed` is the full input box text: when it
 * still starts with the localized prefix the chip put there, that prefix is
 * swapped for the instruction; otherwise the text goes as typed. With `ctx`
 * (the app state) a skill with `context: true` gets skillContextNote appended.
 */
export function skillMessage(skill, localizedPrompt, typed, ctx) {
  const note = ctx && skill.context ? skillContextNote(ctx) : '';
  if (!skill.needsInput) return { shown: localizedPrompt, model: `${skill.invoke}${note}` };
  const text = String(typed ?? '').trim();
  const rest = skillInputRest(skill, localizedPrompt, typed);
  if (rest == null) return { shown: text, model: text };
  const model = !rest && skill.invokeWithoutInput ? skill.invokeWithoutInput : `${skill.invoke}${rest}`;
  return { shown: text, model: `${model}${note}` };
}

/** English name of a language code, for the answer-language instruction. */
export function languageName(code, englishName) {
  if (englishName) return englishName;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch (_) {
    return code;
  }
}

/** The instruction that makes the model answer in the app language. */
export function languageInstruction({ code = 'en', englishName, nativeName } = {}) {
  const name = languageName(code, englishName);
  const native = nativeName && nativeName !== name ? ` (${nativeName})` : '';
  return `LANGUAGE: the app is set to ${name}${native}, language code "${code}". ` +
    `Always answer the user in ${name}, whatever language these instructions are written in. ` +
    `Texts you place on the drawing (labels, room names, titles) also go in ${name}, unless the user asks for another language.`;
}

// How every skill behaves (#452: grounding, confirmation, result on the sheet,
// boundaries), followed by the guide of each skill.
const SKILL_RULES =
  'SKILLS — rules for every skill:\n' +
  '- Grounding: read text and geometry from the document first (app_get_page_text for texts with their positions, app_list_annotations and app_get_annotation for markups and measurements, the measuring scale in the app context) and use the image (app_screenshot_view, app_capture_region) for what has no text, such as linework and symbols. Say when a result rests on the image only.\n' +
  '- A skill message can end with an [App context at the moment of sending] block (page, selection, measuring scale, date). Use it and do not ask the user for it again.\n' +
  '- Before a skill changes the document, say in one line what it will add or change; then do it. Every markup (annotation) a skill places can be undone with app_undo. ' +
  'Other changes may not be undone that way: before app_set_measure_scale replaces a measuring scale that is already set, before app_titleblock with fields and before app_import_cad on an open document, say what will change and wait for the user to confirm.\n' +
  '- Result over chat: a take-off, a review or a comparison belongs on the sheet (schedule, numbered clouds); the panel answer is a short summary.\n' +
  `- Boundaries: a skill never calls ${SKILL_FORBIDDEN_TOOLS.join(', ')} unless the user asks for exactly that in this conversation. app_import_cad and app_export_cad only use a file path the user typed.\n` +
  skillExceptionRules();

/** The prompt lines for SKILL_TOOL_EXCEPTIONS: which skill may use which forbidden tool, and how. */
function skillExceptionRules() {
  return Object.entries(SKILL_TOOL_EXCEPTIONS).map(([id, tools]) =>
    Object.entries(tools).map(([tool, use]) => `- Exception: the skill "${id}" may call ${tool} ${use}; no other skill may.\n`).join(''),
  ).join('');
}

const SKILL_GUIDES = ASSISTANT_SKILLS.filter((s) => s.guide).map((s) => `- ${s.guide}\n`).join('');

export const SKILLS_SYSTEM_PROMPT =
  'You have a skill set and can carry out ACTIONS on the open PDF document through the app\'s MCP tools:\n' +
  '- Translating / summarising: use app_screenshot_view (width 2000) to view and read the page; return the result as text.\n' +
  '- Drawing: use app_create_annotation. Coordinates are page points at 100% zoom; get the page size with app_get_viewport_state (pageW/pageH).\n' +
  '- Detecting doors: first run app_fit_page, then take app_screenshot_view (width 2000), recognise the doors visually and mark each door with app_create_annotation (for example a box or cloud around the door plus a textbox label). Convert screenshot pixels to page points via pageW/pageH.\n' +
  'Answer concisely and practically. Carry out requested actions directly and briefly report what you did.\n' +
  '\n' +
  SKILL_RULES +
  SKILL_GUIDES +
  '\n' +
  'STRUCTURAL DRAWING — laying out the load-bearing structure:\n' +
  '- Use app_structural_layout. In ONE undo step it places the whole plan: grid (letters and numbers, with bubbles), columns on the grid nodes, beams on the grid lines, per floor field a span arrow with the actual span, level marks, tags (position number / profile / level) and a structural schedule grouped by IFC category. NEVER build such a plan from separate app_create_annotation calls: the dimensions will be wrong and it cannot be undone in one step.\n' +
  '- Dimensions go in as REAL MILLIMETERS: baysX/baysY, for example "3x5400" or [5400,5400,6000]. The app converts them to page points at `scale` (default "1:100") and calibrates the measuring scale at once, so measurements and app_get_takeoff work in the same reality. NEVER convert millimeters to points yourself.\n' +
  '- `origin` is the first grid intersection in PAGE POINTS at 100% zoom (top left = 0,0). Get the page size with app_get_viewport_state (viewport.pageW/pageH) and leave room for the grid line extensions (gridExtensionMm, default 1500 mm) and for the schedule below.\n' +
  '- Profiles: "HE200B", "HEA 200", "IPE 300", "UNP 200", "K100/5" (square hollow section; rectangular: "Koker 100x50x5"), "L 100x100x10" (steel) or "300x500" (concrete, width x height in mm). A size the library does not know is rejected and never silently replaced.\n' +
  '- Directions: beams.direction is x, y or both; floors.direction is x, y or shortest (spanning the shortest bay). Levels are given in millimeters (levelMm: 3000 becomes "+3.000").\n' +
  '- FIRST make a call with dryRun: true. It works everything out and reports what would be placed without drawing anything. If it is right, repeat the call without dryRun.\n' +
  '- Then check with app_list_annotations (or app_get_takeoff for the totals) and report the counts. app_undo removes the whole plan in one step.\n' +
  '- The grid bubbles are COUPLED: app_structural_layout couples all bubble ends of one direction. When the user drags one bubble (the grip at the end), the other bubbles of that direction move by the same amount, so they stay in line. app_get_annotation on a grid line reports `gridAlignment` per end (start/end: group, locked, linkedEnds, canLock). To unlock one end: app_update_annotation with props { alignStart: false } (the start, where the bubble is) or { alignEnd: false }; with true it is coupled again and moves back onto the line of the other bubbles. Loose grid lines that lie in line are coupled with alignStart/alignEnd: true as well. Moving a whole grid line leaves the coupling alone.\n' +
  '- Separate structural elements are drawn with app_create_annotation: type "betonbalk" (startX/startY/endX/endY + breedteMm/hoogteMm, tagTonen/tagTekst; it mitres itself at the corners), or type "parametricSymbol" with symbolId "wapeningsstaaf", "netwapening", "wapeningskorf", "wapeningVerdeling" (params aantal/diameter), "beugel" (params diameter/afstand), "oplegging", "puntlast", "q-last", "windverband", "scharnier-verbinding", "paal-aanzicht-type-1", "sondering", "paalpuntniveau", "peilmaat" (params value), "stramien" (params label/orientation) or "overspanningspijl-vloer" (params lengte/tekst). Reinforcement and steel connection details (#312) are parametricSymbol too: "wapeningsdetail" (bending shape; params staafnummer/aantal/diameter/afstand/vormcode 00|11|21|51/a/b/c/staalkwaliteit), "staaf-plattegrond" (bar in plan; params staafnummer/diameter/afstand/verdeelbreedte/lengte/haken), "wapeningsnet" (mesh in plan; params lengte/breedte/diameterL/afstandL/diameterB/afstandB/laag), "vloer-vorstrand" (slab with frost edge; params vloerdikte/vorstrandBreedte/vorstrandHoogte/randAantal/randDiameter/beugelDiameter/beugelAfstand/lengte), "kopplaat" (end plate; params profiel/aanzicht zij|kop/plaatDikte/boutMaat/boutRijen) and "voetplaat" (base plate; params profiel/aanzicht boven|zij/plaatDikte/ankerMaat/ankerAantal). Their bars feed the schedule templates "buigstaat" (bending schedule) and "wapeningsstaat" (weight per diameter) of app_place_schedule. These ids and parameter names are identifiers of the app: pass them exactly as written.\n' +
  '- A scale on its own is set with app_set_measure_scale: at 1:100 one real millimeter is 0.0283465 page point (72/25.4 divided by 100).' +
  CONSTRUCTIEOVERZICHT_PROMPT +
  PLATTEGROND_PROMPT;

/**
 * The full system prompt for one request. `language` is the current app
 * language ({ code, englishName, nativeName }); it is read per request, so a
 * language change in the app applies to the next question.
 */
export function buildSystemPrompt(language = {}) {
  return 'You are the OpenAEC assistant in Open PDF Studio (a PDF annotation editor). Help the user with questions about the open PDF document and general tasks.\n' +
    languageInstruction(language) + '\n\n' +
    SKILLS_SYSTEM_PROMPT;
}
