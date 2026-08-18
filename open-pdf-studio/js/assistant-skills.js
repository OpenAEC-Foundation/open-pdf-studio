// OpenAEC-assistent skill set.
//
// Each skill is a capability the assistant can perform on the open PDF. Clicking
// a skill chip sends its prompt as a user message; via the provider chain it
// reaches the brain (the OpenAEC AI server, Claude Code over the MCP relay, or
// any AI provider) which executes it.
//
// This module holds only what is language-INDEPENDENT: the id, the icon, and
// how the skill is routed. Every user-visible string (label, hint) and the
// prompt itself live in i18n under `common:assistant.skills.<id>` and
// `common:assistant.prompts.<id>`, so the panel follows the app's language.
// Hardcoding them here is what made the chips Dutch in every locale.
//
// `serverAction` maps a skill onto an action of the OpenAEC AI-server
// (POST /v1/chat: summarize | qa | translate | rewrite | explain | extract |
// chat). Skills WITH a serverAction get the extracted document text attached
// and can be answered by the server. Skills WITHOUT one (draw, detect doors)
// need the app's MCP tools to act on the drawing — the server cannot call
// those, so they always go to the relay/Claude.

export const ASSISTANT_SKILLS = [
  { id: 'translate',    icon: '🌐', serverAction: 'translate' },
  { id: 'summarize',    icon: '📝', serverAction: 'summarize' },
  { id: 'draw',         icon: '✏️', needsInput: true },
  { id: 'detect-doors', icon: '🚪' },
];

/**
 * System prompt for the MCP-relay/Claude path, which drives the app's own
 * tools. English because the instructions are for the model, not the user;
 * the final line pins the ANSWER to the app's language.
 *
 * @param {string} [responseLanguage] English name of the UI language, e.g. 'Dutch'.
 */
export function skillsSystemPrompt(responseLanguage) {
  return (
    'You have a skill set and can perform ACTIONS on the open PDF document via the app\'s MCP tools:\n' +
    '- Translate / summarize: use app_screenshot_view (width 2000) to look at and read the page; return the result as text.\n' +
    '- Draw: use app_create_annotation. Coordinates are page points at 100% zoom; get the page size with app_get_viewport_state (pageW/pageH).\n' +
    '- Detect doors: first app_fit_page, then app_screenshot_view (width 2000), recognise the doors visually and mark each one with app_create_annotation (for example a box or cloud around the door plus a textbox label). Convert screenshot pixels to page points via pageW/pageH.\n' +
    'Be concise and practical. Carry out requested actions directly and briefly report what you did.' +
    (responseLanguage ? `\nAlways write your answer in ${responseLanguage}.` : '')
  );
}
