// OpenAEC provider for the assistant: when the app runs inside the OpenAEC
// workplace (the host page sets `window.__OPDS_HOST__` with an `ai.vraag`
// function), questions go through the host bridge. The host site forwards them
// to the OpenAEC AI gateway with the user's own session; the app never sees a
// token or an address.
//
// The protocol is OpenAI chat: the app sends `messages` and `tools`; the answer
// is one assistant message, possibly with `tool_calls`. The tool calls run here,
// in the app (the same handlers as the in-app MCP server), and their results go
// back as `tool` messages. Every assistant message is sent back unchanged in the
// next round, including its `openaec_denkblokken` field: the gateway needs it.
import { gastObject } from './core/gehost.js';

/** Hard stop for one question: tool rounds before the answer must be final. */
export const MAX_ROUNDS = 8;

/** The tools the assistant may use, as OpenAI function definitions. Names and
 *  schemas follow the in-app MCP server (src-tauri/src/mcp_server.rs); each one
 *  runs the matching `mcp:*` handler of js/mcp-bridge.js. */
export const TOOLS = [
  {
    name: 'app_go_to_page',
    event: 'mcp:go-to-page',
    description: 'Navigate the active document to a 1-based page number.',
    parameters: {
      type: 'object',
      properties: { page: { type: 'integer', minimum: 1, description: '1-based target page number.' } },
      required: ['page'],
      additionalProperties: false,
    },
  },
  {
    name: 'app_list_annotations',
    event: 'mcp:list-annotations',
    description: "List the active document's annotations as compact JSON (id, type, page, geometry, colors, text). Optionally filter to one page.",
    parameters: {
      type: 'object',
      properties: { page: { type: 'integer', minimum: 1, description: 'Only annotations on this 1-based page.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'app_create_annotation',
    event: 'mcp:create-annotation',
    description:
      'Create an annotation on the active document. Geometry goes in `props` (page coordinates at 100% zoom): ' +
      'line/arrow/measureDistance need startX/startY/endX/endY; box/circle/highlight/cloud/textbox/callout/stamp need ' +
      'x/y/width/height; polyline/measureArea need points:[{x,y},...]; comment needs x/y. Optional style props: color, ' +
      'strokeColor, fillColor, lineWidth, opacity, text, fontSize. Returns the new annotation id.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['line', 'arrow', 'box', 'circle', 'highlight', 'cloud', 'polygon', 'polyline', 'textbox', 'callout', 'comment', 'stamp', 'measureDistance', 'measureArea', 'measurePerimeter', 'count'],
        },
        page: { type: 'integer', minimum: 1, description: '1-based target page. Defaults to the current page.' },
        props: { type: 'object', description: 'Geometry and style properties for the annotation.' },
      },
      required: ['type', 'props'],
      additionalProperties: false,
    },
  },
  {
    name: 'app_update_annotation',
    event: 'mcp:update-annotation',
    description: 'Merge `props` onto an existing annotation (geometry, color, lineWidth, text, ...). `id` and `type` are immutable.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, props: { type: 'object' } },
      required: ['id', 'props'],
      additionalProperties: false,
    },
  },
  {
    name: 'app_delete_annotation',
    event: 'mcp:delete-annotation',
    description: 'Delete an annotation by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

/** The tools in the form the gateway expects. */
export function toolDefinitions() {
  return TOOLS.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
}

/** The host's AI function, or null when the app does not run in the OpenAEC workplace. */
export function openaecHost() {
  const vraag = gastObject()?.ai?.vraag;
  return typeof vraag === 'function' ? vraag : null;
}

export function openaecAvailable() {
  return openaecHost() !== null;
}

/** Run one tool call in the app; the result goes back to the model as text. */
export async function runToolCall(call, runEvent) {
  const name = call?.function?.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown tool: ${name}` };
  let args = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { ok: false, error: 'the arguments are not valid JSON' };
  }
  try {
    return await runEvent(tool.event, args);
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** The conversation for the gateway: each earlier assistant turn exactly as the
 *  gateway returned it (with its tool rounds), other messages as plain text. */
export function historyMessages(messages, modelText) {
  const out = [];
  for (const m of messages) {
    if (m.greeting) continue;
    if (m.role === 'assistant' && Array.isArray(m.openaec)) out.push(...m.openaec);
    else out.push({ role: m.role, content: modelText(m) });
  }
  return out;
}

/** An error of the host bridge as a message for the user. `code` comes from the
 *  host site; its message is already in the user's language there. */
export function describeOpenaecError(err, t) {
  const code = err?.code;
  if (['dienst_onbereikbaar', 'te_druk', 'al_bezig', 'te_veel_vragen'].includes(code)) {
    return `⚠️ ${t('assistant.errorNoConnection')}${err?.message ? `\n\n_${err.message}_` : ''}`;
  }
  return `⚠️ ${t('assistant.errorFailed')}\n\n_${t('assistant.detail')}: ${err?.message || t('assistant.unknownError')}_`;
}

/**
 * Ask the gateway via the host until it answers without tool calls (at most
 * MAX_ROUNDS rounds). Returns { text, turn }: the final text and every message
 * of this turn (assistant and tool), to keep in the conversation unchanged.
 */
export async function askOpenaec({ system, history, ask = openaecHost(), runEvent }) {
  if (!ask) throw new Error('OpenAEC is not available');
  const turn = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const messages = [{ role: 'system', content: system }, ...history, ...turn];
    const answer = await ask({ messages, tools: toolDefinitions() });
    const message = answer?.bericht;
    if (!message || message.role !== 'assistant') throw new Error('no answer');
    turn.push(message); // unchanged: with tool_calls and openaec_denkblokken
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) return { text: typeof message.content === 'string' ? message.content : '', turn };
    for (const call of calls) {
      const result = await runToolCall(call, runEvent);
      turn.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? null) });
    }
  }
  return { text: '', turn };
}
