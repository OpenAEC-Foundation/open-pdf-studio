// AI-server client — de eigen AI-server van de gebruiker op OpenAEC Accounts.
//
// Contract (server is al gebouwd en geverifieerd):
//   POST {accountsApiUrl}/v1/chat   met het OIDC-access-token als bearer.
//   body: { action, text, question?, language?, file_name, page_count,
//           current_page, history, stream, temperature, max_tokens }
//   200 → { content, cached, usage|null }
//   401 → niet aangemeld / token ongeldig
//   402 → geen credits meer (error_code: "INSUFFICIENT_CREDITS")
//   429 → te veel aanvragen
//
// Het access-token komt NOOIT in de webview: de Rust-command `ai_fetch`
// (src-tauri/src/accounts.rs) leest het uit de OS-keyring, zet de bearer-header,
// ververst bij een 401 automatisch en geeft de JSON terug. Wij bouwen hier dus
// alleen het pad + de body — geen eigen fetch, geen token in JS.
//
//   invoke('ai_fetch', { path: '/v1/chat', method: 'POST', body: {...} })
//
// LET OP: `ai_fetch`, niet `accounts_fetch`. De AI-sidecar draait op een eigen
// host (`aiApiUrl`), los van de Accounts-API (`accountsApiUrl`) die alleen
// /v1/authorize en /v1/settle serveert. accounts_fetch zou /v1/chat naar de
// verkeerde host sturen.
//
// ai_fetch verwerpt met een STRING bij een niet-2xx-status, in de vorm
// `AI-server returned {status}: {body}` (or 'not signed in' without a token).
// destilleren we hieronder een getypte fout uit.

import { invoke } from '../core/platform.js';

/** Acties die de server accepteert. */
export const AI_ACTIONS = [
  'summarize', 'qa', 'translate', 'rewrite', 'explain', 'extract', 'chat',
];

const CHAT_PATH = '/v1/chat';
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Getypte fout van de AI-server. `code` is stabiel en bedoeld om op te
 * matchen in de UI; `message` blijft het ruwe serverdetail voor de log.
 *
 * codes: NOT_SIGNED_IN | INSUFFICIENT_CREDITS | RATE_LIMITED | OFFLINE |
 *        NO_DOCUMENT_TEXT | BAD_REQUEST | SERVER
 */
export class AiServerError extends Error {
  constructor(code, message, status = null) {
    super(message || code);
    this.name = 'AiServerError';
    this.code = code;
    this.status = status;
  }
}

/** True zodra er een OpenAEC-sessie is (token in de keyring). */
export async function isSignedIn() {
  try {
    return !!(await invoke('accounts_get_user'));
  } catch (_) {
    return false;
  }
}

/** Ruwe afwijzing van accounts_fetch → getypte AiServerError. */
function toAiError(err) {
  if (err instanceof AiServerError) return err;
  const raw = String(err?.message ?? err ?? '').trim();
  const status = Number((raw.match(/(?:Accounts API|AI-server) returned (\d{3})/) || [])[1]) || null;

  // Geen token in de keyring, of de refresh lukte niet → opnieuw aanmelden.
  if (/not signed in|no refresh token|token refresh failed|refresh rejected/i.test(raw) || status === 401) {
    return new AiServerError('NOT_SIGNED_IN', raw, status);
  }
  if (status === 402 || /INSUFFICIENT_CREDITS/i.test(raw)) {
    return new AiServerError('INSUFFICIENT_CREDITS', raw, status || 402);
  }
  if (status === 429) return new AiServerError('RATE_LIMITED', raw, 429);
  if (/unreachable|failed to fetch|connection|econnrefused|timed out/i.test(raw)) {
    return new AiServerError('OFFLINE', raw, status);
  }
  if (status && status >= 400 && status < 500) return new AiServerError('BAD_REQUEST', raw, status);
  return new AiServerError('SERVER', raw || 'onbekende fout', status);
}

/**
 * Lage-niveau-aanroep: geeft de volledige serverrespons terug
 * ({ content, cached, usage }).
 *
 * @param {object} req
 * @param {string} req.action      summarize|qa|translate|rewrite|explain|extract|chat
 * @param {string} req.text        PDF-tekst, of het bericht van de gebruiker bij 'chat'
 * @param {string} [req.question]  verplicht bij action 'qa'
 * @param {string} [req.language]  verplicht bij action 'translate'
 * @param {string} [req.fileName]
 * @param {number} [req.pageCount]
 * @param {number} [req.currentPage]
 * @param {Array<{role:string,content:string}>} [req.history]
 * @param {number} [req.temperature]
 * @param {number} [req.maxTokens]
 */
export async function chatWithAiServer({
  action = 'chat',
  text,
  question = null,
  language = null,
  fileName = null,
  pageCount = null,
  currentPage = null,
  history = null,
  responseLanguage = null,
  temperature = DEFAULT_TEMPERATURE,
  maxTokens = DEFAULT_MAX_TOKENS,
} = {}) {
  if (!AI_ACTIONS.includes(action)) {
    throw new AiServerError('BAD_REQUEST', `onbekende actie: ${action}`);
  }
  const body = String(text ?? '').trim();
  if (!body) throw new AiServerError('NO_DOCUMENT_TEXT', 'geen tekst om te versturen');
  if (action === 'qa' && !String(question ?? '').trim()) {
    throw new AiServerError('BAD_REQUEST', "action 'qa' vereist een question");
  }
  if (action === 'translate' && !String(language ?? '').trim()) {
    throw new AiServerError('BAD_REQUEST', "action 'translate' vereist een language");
  }

  const payload = {
    action,
    text: body,
    question: question || null,
    language: language || null,
    file_name: fileName || null,
    page_count: Number.isFinite(pageCount) ? pageCount : null,
    current_page: Number.isFinite(currentPage) ? currentPage : null,
    history: Array.isArray(history) && history.length
      ? history.map((m) => ({ role: m.role, content: String(m.content ?? '') }))
      : null,
    // Engelse naam van de UI-taal ('Dutch', 'German', …). De server schrijft het
    // antwoord daarin, ongeacht de taal van het document. Niet te verwarren met
    // `language`, de doeltaal van de vertaalactie.
    response_language: responseLanguage || null,
    // Streaming valt buiten deze taak — altijd het volledige antwoord ophalen.
    stream: false,
    temperature,
    max_tokens: maxTokens,
  };

  let data;
  try {
    data = await invoke('ai_fetch', { path: CHAT_PATH, method: 'POST', body: payload });
  } catch (e) {
    throw toAiError(e);
  }
  // invoke() geeft null buiten Tauri (browser-preview) — daar is er geen keyring.
  if (data == null) throw new AiServerError('OFFLINE', 'AI-server alleen beschikbaar in de desktop-app');
  // parse_api_result geeft een JSON-string terug wanneer de body geen JSON was.
  if (typeof data === 'string') return { content: data, cached: false, usage: null };
  return { content: data.content ?? '', cached: !!data.cached, usage: data.usage ?? null };
}

/**
 * Zoals chatWithAiServer, maar geeft direct de antwoordtekst terug.
 * Gooit een AiServerError bij 401 / 402 / 429 en andere fouten.
 */
export async function askAiServer(req) {
  const res = await chatWithAiServer(req);
  const content = String(res.content ?? '').trim();
  if (!content) throw new AiServerError('SERVER', 'leeg antwoord van de AI-server');
  return content;
}
