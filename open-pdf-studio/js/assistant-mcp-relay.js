// Assistant <-> MCP relay.
//
// Lets an external MCP client (e.g. Claude Code, which has working Claude auth)
// act as the in-app assistant's AI brain. When the assistant has no usable AI
// provider (no OpenAEC AI bridge, no personal Claude key), a question typed in
// the assistant window is queued here and exposed over the app's MCP server via
// `app_assistant_pending`; the client's `app_assistant_answer` resolves it back
// into the chat. No `claude` CLI and no API key needed on this machine.

let _seq = 1;
const _queue = [];          // [{ id, prompt, system, docName, createdAt, taken }]
const _waiters = new Map(); // id -> { resolve, reject, timer }
let _lastClientPoll = 0;    // ms timestamp of the last app_assistant_pending call
let _submit = null;         // (text) => void          — set by the AssistantPanel
let _getMessages = null;    // () => [{role,content}]   — set by the AssistantPanel

const DEFAULT_TIMEOUT_MS = 600000;

/** AssistantPanel registers how to submit a user message programmatically. */
export function registerAssistantSubmit(fn) { _submit = fn; }

/** AssistantPanel registers how to read the current conversation. */
export function registerAssistantMessages(fn) { _getMessages = fn; }

/**
 * app_assistant_ask — submit a message as if the user typed it in the window.
 *
 * `opts` gaat ongewijzigd door naar de send() van het paneel, zodat een
 * aanroeper (AI-lint, MCP-client) ook een serveractie kan kiezen in plaats van
 * een vrij chatbericht: `{ action: 'summarize' }`, `{ action: 'translate',
 * language: 'English' }`, `{ useServer: false }`. Zonder opts is het gedrag
 * exact als voorheen.
 */
export function submitAssistantMessage(text, opts) {
  if (typeof _submit !== 'function') return { ok: false, error: 'assistent nog niet gereed' };
  _submit(String(text ?? ''), opts || {});
  return { ok: true };
}

/** app_assistant_history — read the current conversation. */
export function getAssistantMessages() {
  try { return { ok: true, messages: typeof _getMessages === 'function' ? _getMessages() : [] }; }
  catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** Queue a question and resolve when an MCP client answers it (relay provider). */
export function enqueueAssistantQuestion({ prompt, system, docName } = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const id = `q${_seq++}`;
  _queue.push({ id, prompt: String(prompt ?? ''), system: system || '', docName: docName || null, createdAt: Date.now(), taken: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _waiters.delete(id);
      const i = _queue.findIndex((q) => q.id === id);
      if (i >= 0) _queue.splice(i, 1);
      reject(new Error('Geen MCP-client beantwoordde de vraag op tijd (time-out).'));
    }, timeoutMs);
    _waiters.set(id, { resolve, reject, timer });
  });
}

/** app_assistant_pending — hand the oldest untaken question to the client.
 *  Each call marks an MCP client (a Claude Code/Desktop brain) as present. */
export function takePendingQuestion() {
  _lastClientPoll = Date.now();
  const req = _queue.find((q) => !q.taken);
  if (!req) return { ok: true, question: null };
  req.taken = true;
  return { ok: true, question: { id: req.id, prompt: req.prompt, system: req.system, docName: req.docName, createdAt: req.createdAt } };
}

/** True when an MCP client polled recently — i.e. a Claude Code/Desktop brain is
 *  connected and will answer relayed questions (no Anthropic API, no key). */
export function relayClientActive(windowMs = 30000) {
  return _lastClientPoll > 0 && (Date.now() - _lastClientPoll) < windowMs;
}

/** app_assistant_answer — resolve the awaiting question with the client's text. */
export function answerAssistantQuestion(id, text) {
  const w = _waiters.get(id);
  if (!w) return { ok: false, error: `onbekende of verlopen vraag-id: ${id}` };
  clearTimeout(w.timer);
  _waiters.delete(id);
  const i = _queue.findIndex((q) => q.id === id);
  if (i >= 0) _queue.splice(i, 1);
  w.resolve(String(text ?? ''));
  return { ok: true, id };
}
