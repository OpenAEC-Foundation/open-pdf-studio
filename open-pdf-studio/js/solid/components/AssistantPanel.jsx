// Assistant — floating chat panel (bottom-right) + launcher button. Ways to
// answer, tried in order:
//   1. Claude (Anthropic) -> direct API with a locally stored API key
//   2. MCP relay          -> an external MCP client answers via the app server
// In the OpenAEC workplace (the host page offers its AI function) only one way:
//   OpenAEC -> the host forwards the question to the OpenAEC AI gateway; the
//              tool calls run here in the app (js/assistant-openaec.js).
//
// Every text the user sees comes from the locale files (common.assistant.*), and
// the system prompt tells the model to answer in the current app language. The
// skill instructions themselves stay in one language (assistant-skills.js).
import { createSignal, For, Show, createEffect } from 'solid-js';
import { registerAssistantSubmit, registerAssistantMessages, enqueueAssistantQuestion, relayClientActive } from '../../assistant-mcp-relay.js';
import { ASSISTANT_SKILLS, buildSystemPrompt, skillKeys, skillMessage } from '../../assistant-skills.js';
import { getActiveDocument } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { LANGUAGES } from '../../i18n/config.js';
import { leesAiSleutel, bewaarAiSleutel, ruimAiSleutelOpAlsGast } from '../../core/ai-sleutel.js';
import { knopUit, externeDienstenAan } from '../../core/webfuncties.js';
import { isTauri } from '../../core/platform.js';
import { askOpenaec, describeOpenaecError, historyMessages, openaecAvailable } from '../../assistant-openaec.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Minimal markdown-lite rendering (bold, inline code, line breaks). The AI text
// is HTML-escaped first so it can never inject markup.
function renderContent(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Turn a provider error into a message in the app language. The patterns match
// the raw error texts of the providers (the relay time-out text is the relay's
// own wording), not anything the user sees.
function describeAiError(err, t) {
  const raw = String(err?.message ?? err ?? '').trim();
  const detail = (text) => `\n\n_${t('assistant.detail')}: ${text}_`;
  if (/Claude API 401|invalid x-api-key|authentication_error/i.test(raw)) {
    return `⚠️ ${t('assistant.errorInvalidKey')}`;
  }
  if (/Claude API 4\d\d|Claude API 5\d\d/i.test(raw)) {
    return `⚠️ ${t('assistant.errorApi')}${detail(raw)}`;
  }
  if (/time-out/i.test(raw)) {
    return `⚠️ ${t('assistant.errorTimeout')}`;
  }
  if (/onbereikbaar|connection|econn|refused|failed to connect|timed out|failed to fetch/i.test(raw)) {
    return `⚠️ ${t('assistant.errorNoConnection')}`;
  }
  return `⚠️ ${t('assistant.errorFailed')}${detail(raw || t('assistant.unknownError'))}`;
}

// The app language as the system prompt needs it. Unknown or regional codes
// fall back the same way the interface does (base code, else English).
function currentLanguage(lang) {
  const base = String(lang || 'en').split('-')[0];
  const known = LANGUAGES.find((l) => l.code === base && l.code !== 'auto');
  const entry = known || LANGUAGES.find((l) => l.code === 'en');
  return { code: entry.code, englishName: entry.englishName, nativeName: entry.name };
}

export default function AssistantPanel() {
  // As a guest the AI service is off (#548): no floating button over the
  // drawing that cannot do anything. The key is cleared from storage there too.
  // In the OpenAEC workplace the assistant talks to its own host, not to
  // another host: then it stays on.
  const viaOpenaec = openaecAvailable();
  if (!viaOpenaec && knopUit('assistant-launcher', { inTauri: isTauri() })) {
    ruimAiSleutelOpAlsGast();
    return null;
  }

  const { t, language } = useTranslation('common');
  // The greeting is rendered from the locale on every language change, so it
  // carries no text of its own.
  const [messages, setMessages] = createSignal([{ role: 'assistant', greeting: true, content: '' }]);
  const [open, setOpen] = createSignal(false);
  const [input, setInput] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [apiKey, setApiKey] = createSignal(leesAiSleutel());
  const [showKey, setShowKey] = createSignal(false);
  // A skill chip that put its prefix in the input box and waits for the rest.
  const [pendingSkill, setPendingSkill] = createSignal(null);
  let messagesEnd, inputEl, keyEl;

  const activeDocName = () => getActiveDocument()?.fileName || null;
  const greetingText = () => t('assistant.greeting', { title: t('assistantTitle') });
  const shownText = (m) => (m.greeting ? greetingText() : m.content);
  // What the model gets: the fixed skill instruction when a chip sent it.
  const modelText = (m) => m.model ?? m.content;

  createEffect(() => {
    messages();
    queueMicrotask(() => messagesEnd?.scrollIntoView({ behavior: 'smooth' }));
  });

  // Read per request, so a language change in the app applies to the next question.
  function systemPrompt() {
    return buildSystemPrompt(currentLanguage(language()));
  }

  function saveKey() {
    const v = (keyEl?.value || '').trim();
    try {
      bewaarAiSleutel(v);
    } catch (_) { /* private mode — ignore */ }
    setApiKey(v);
    setShowKey(false);
  }

  // `explicit` is a string (app_assistant_ask, or typed text) or
  // { shown, model } from a skill chip.
  async function send(explicit) {
    let shown;
    let model;
    if (explicit && typeof explicit === 'object' && typeof explicit.shown === 'string') {
      ({ shown, model } = explicit);
    } else {
      shown = (typeof explicit === 'string' ? explicit : input()).trim();
      const skill = typeof explicit === 'string' ? null : pendingSkill();
      if (skill) ({ shown, model } = skillMessage(skill, t(skillKeys(skill).prompt), shown));
    }
    shown = String(shown || '').trim();
    if (!shown || loading()) return;
    const key = apiKey();

    const userMessage = { role: 'user', content: shown };
    if (model && model !== shown) userMessage.model = model;
    setMessages((m) => [...m, userMessage]);
    setInput('');
    setPendingSkill(null);
    setLoading(true);
    // Claude (Anthropic) direct call — the default when a personal Anthropic key
    // is set via the 🔑 button.
    const claudeDirect = async () => {
      const msgs = messages().slice(1).map((m) => ({ role: m.role, content: modelText(m) }));
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system: systemPrompt(), messages: msgs }),
      });
      if (!res.ok) {
        const tx = await res.text().catch(() => '');
        throw new Error(`Claude API ${res.status}: ${tx.slice(0, 200)}`);
      }
      const data = await res.json();
      return data?.content?.[0]?.text || t('assistant.noAnswer');
    };

    // MCP relay — an external MCP client (e.g. Claude Code, with working Claude
    // auth) answers via the app's MCP server (app_assistant_pending/answer).
    // Final fallback so the assistant keeps working without a local key.
    const mcpRelay = async () => {
      const history = messages().slice(1)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${modelText(m)}`)
        .join('\n\n');
      const docName = activeDocName();
      const prompt = `${docName ? `Open document: ${docName}\n\n` : ''}${history}\n\nAssistant:`;
      return await enqueueAssistantQuestion({ prompt, system: systemPrompt(), docName });
    };

    // OpenAEC: the host forwards the question to the AI gateway; tool calls run
    // in the app. The whole turn (assistant and tool messages, unchanged) is
    // kept so the next question sends it back as the gateway requires.
    const openaec = async () => {
      const { runAppEvent } = await import('../../mcp-bridge.js');
      const { text, turn } = await askOpenaec({
        system: systemPrompt(),
        history: historyMessages(messages(), modelText),
        runEvent: runAppEvent,
      });
      return { content: text || t('assistant.noAnswer'), openaec: turn };
    };

    // Provider order. When a Claude Code/Desktop MCP client is connected (it
    // polled recently), route to the relay FIRST so it answers instantly — no
    // Anthropic API, no key. Otherwise: Claude key -> relay (fallback).
    const relayActive = relayClientActive();
    const providers = [];
    if (viaOpenaec) providers.push(openaec);
    else {
      if (relayActive) providers.push(mcpRelay);
      if (key && externeDienstenAan()) providers.push(claudeDirect);
      if (!relayActive) providers.push(mcpRelay);
    }

    let answer = null;
    let lastErr = null;
    for (const provider of providers) {
      try { answer = await provider(); break; }
      catch (e) { lastErr = e; console.warn('[assistant] provider failed, trying the next one:', e?.message ?? e); }
    }
    const failed = viaOpenaec ? describeOpenaecError(lastErr, t) : describeAiError(lastErr, t);
    const reply = answer == null ? { content: failed } : typeof answer === 'object' ? answer : { content: answer };
    setMessages((m) => [...m, { role: 'assistant', ...reply }]);
    setLoading(false);
  }

  // Expose the assistant to the in-app MCP server: an external MCP client can
  // drive it (app_assistant_ask) and act as its AI brain (app_assistant_pending
  // / app_assistant_answer). Registered once when the panel mounts.
  registerAssistantSubmit((text) => { setOpen(true); send(text); });
  registerAssistantMessages(() => messages().map((m) => ({ role: m.role, content: shownText(m) })));

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Skill set: one-click capabilities. Clicking shows the skill's text in the
  // app language and sends its fixed instruction through the assistant (and thus
  // the relay to the brain), which executes it via MCP tools. A skill that needs
  // input pre-fills the box with its localized prefix.
  function runSkill(skill) {
    const prompt = t(skillKeys(skill).prompt);
    if (skill.needsInput) {
      setPendingSkill(skill);
      setInput(prompt);
      inputEl?.focus();
    } else {
      send(skillMessage(skill, prompt));
    }
  }

  // Subtitle shows the active provider so the user knows where answers come from.
  const providerLabel = () => (viaOpenaec ? 'OpenAEC' : apiKey() ? t('assistant.viaClaude') : t('assistant.notConnected'));

  return (
    <Show
      when={open()}
      fallback={
        <button id="assistant-launcher" class="chat-fab" title={t('assistantTitle')} onClick={() => setOpen(true)}>💬</button>
      }
    >
      <div class="chat-floating">
        <div class="chat-panel">
          <div class="chat-header">
            <div class="chat-header-titles">
              <span class="chat-title">✨ {t('assistantTitle')}</span>
              <span class="chat-subtitle" title={activeDocName() || ''}>
                {activeDocName() ? `${t('assistant.workingIn')}: ${activeDocName()} · ${providerLabel()}` : providerLabel()}
              </span>
            </div>
            <Show when={!viaOpenaec}>
              <button class="chat-close" title={t('assistant.keyButton')} onClick={() => setShowKey(!showKey())}>🔑</button>
            </Show>
            <button class="chat-close" title={t('close')} onClick={() => setOpen(false)}>✕</button>
          </div>

          <Show when={showKey()}>
            <div class="chat-keyrow">
              <input
                ref={keyEl}
                type="password"
                class="chat-keyinput"
                placeholder={t('assistant.keyPlaceholder')}
                value={apiKey()}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
              />
              <button class="chat-keysave" onClick={saveKey}>{t('save')}</button>
            </div>
          </Show>

          <div class="chat-messages">
            <For each={messages()}>
              {(msg) => (
                <div class={`chat-message chat-${msg.role}`}>
                  <div class="chat-bubble" innerHTML={renderContent(shownText(msg))} />
                </div>
              )}
            </For>
            <Show when={loading()}>
              <div class="chat-message chat-assistant"><div class="chat-bubble chat-typing">{t('assistant.thinking')}</div></div>
            </Show>
            <div ref={messagesEnd} />
          </div>

          <Show when={!loading()}>
            <div class="chat-chips">
              <For each={ASSISTANT_SKILLS}>
                {(skill) => (
                  <button class="chat-chip" data-skill={skill.id} title={t(skillKeys(skill).hint)} onClick={() => runSkill(skill)}>
                    {skill.icon} {t(skillKeys(skill).label)}
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="chat-input-area">
            <textarea
              ref={inputEl}
              class="chat-input"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              placeholder={t('assistant.inputPlaceholder')}
              rows={2}
            />
            <button class="chat-send" title={t('assistant.send')} onClick={() => send()} disabled={loading() || !input().trim()}>➤</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
