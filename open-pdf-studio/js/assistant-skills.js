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

import { PLATTEGROND_SKILL, PLATTEGROND_PROMPT } from './plattegrond/skill.js';
import { CONSTRUCTIEOVERZICHT_SKILL, CONSTRUCTIEOVERZICHT_PROMPT } from './constructieoverzicht/skill.js';

export const ASSISTANT_SKILLS = [
  {
    id: 'translate',
    icon: '🌐',
    invoke: 'Translate the text of the open document into the user\'s language. If the document is already in that language, translate it into English; if the user\'s language is English too, ask which language to translate it into. Present the translation clearly.',
  },
  {
    id: 'summarize',
    icon: '📝',
    invoke: 'Summarise the open document or drawing concisely: what it is about, the main parts and any points that need attention.',
  },
  {
    id: 'draw',
    icon: '✏️',
    invoke: 'Draw on the drawing: ',
    needsInput: true,
  },
  {
    id: 'detect-doors',
    icon: '🚪',
    invoke: 'Look at the floor plan, recognise the doors and mark each door on the drawing with a markup and a short label.',
  },
  {
    id: 'structural-layout',
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

/**
 * The message a chip click produces. `shown` is what the chat displays (in the
 * app language), `model` is what the model receives (the fixed instruction).
 * For a skill that needs input, `typed` is the full input box text: when it
 * still starts with the localized prefix the chip put there, that prefix is
 * swapped for the instruction; otherwise the text goes as typed.
 */
export function skillMessage(skill, localizedPrompt, typed) {
  if (!skill.needsInput) return { shown: localizedPrompt, model: skill.invoke };
  const text = String(typed ?? '').trim();
  const prefix = String(localizedPrompt ?? '').trim();
  if (prefix && text.startsWith(prefix)) {
    const rest = text.slice(prefix.length).trim();
    return { shown: text, model: `${skill.invoke}${rest}` };
  }
  return { shown: text, model: text };
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

export const SKILLS_SYSTEM_PROMPT =
  'You have a skill set and can carry out ACTIONS on the open PDF document through the app\'s MCP tools:\n' +
  '- Translating / summarising: use app_screenshot_view (width 2000) to view and read the page; return the result as text.\n' +
  '- Drawing: use app_create_annotation. Coordinates are page points at 100% zoom; get the page size with app_get_viewport_state (pageW/pageH).\n' +
  '- Detecting doors: first run app_fit_page, then take app_screenshot_view (width 2000), recognise the doors visually and mark each door with app_create_annotation (for example a box or cloud around the door plus a textbox label). Convert screenshot pixels to page points via pageW/pageH.\n' +
  'Answer concisely and practically. Carry out requested actions directly and briefly report what you did.\n' +
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
