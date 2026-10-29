// Assistant — floating chat panel (bottom-right) + launcher button. Two ways to
// answer, tried in order:
//   1. Claude (Anthropic) -> direct API with a locally stored API key
//   2. MCP relay          -> an external MCP client answers via the app server
// In the hosted build inside the OpenAEC workplace (#704) there is one way: the
// host page asks the AI service with its own session (see
// core/werkplek-ai.js); the app never holds a key.
//
// Every text the user sees comes from the locale files (common.assistant.*), and
// the system prompt tells the model to answer in the current app language. The
// skill instructions themselves stay in one language (assistant-skills.js).
import { createSignal, For, Show, createEffect } from 'solid-js';
import { registerAssistantSubmit, registerAssistantMessages, enqueueAssistantQuestion, relayClientActive } from '../../assistant-mcp-relay.js';
import {
  ASSISTANT_SKILL_GROUPS, buildSystemPrompt, skillKeys, skillMessage, skillGroupKey, skillsInGroup,
  skillBlocker, skillInputProblem, skillInputRest,
} from '../../assistant-skills.js';
import { skillContextFromDocument } from '../../assistant-skill-context.js';
import { getActiveDocument, state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { LANGUAGES } from '../../i18n/config.js';
import { leesAiSleutel, bewaarAiSleutel, ruimAiSleutelOpAlsGast } from '../../core/ai-sleutel.js';
import { knopUit, externeDienstenAan } from '../../core/webfuncties.js';
import { isTauri, hostAi } from '../../core/platform.js';
import { maakAiVraag, tekstUitBericht, aiFoutSleutel } from '../../core/werkplek-ai.js';

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
  // Errors from the workplace bridge carry a code (no credit, busy, …).
  const werkplekSleutel = aiFoutSleutel(err);
  if (werkplekSleutel) return `⚠️ ${t(werkplekSleutel)}`;
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
  // The host page of the workplace answers for us (#704): no key, no relay.
  const werkplekAi = hostAi();
  // As a guest the AI service is off (#548): no floating button over the
  // drawing that cannot do anything. The key is cleared from storage there too.
  if (!werkplekAi && knopUit('assistant-launcher', { inTauri: isTauri() })) {
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
  // The skill tab that is shown, and the message of a skill that could not be
  // sent yet (no selection, no scale, input missing): { key, params }.
  const [activeGroup, setActiveGroup] = createSignal(ASSISTANT_SKILL_GROUPS[0].id);
  const [notice, setNotice] = createSignal(null);
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

  // The app state a skill needs, read at the moment of sending.
  function skillContext() {
    return skillContextFromDocument({ doc: getActiveDocument(), textSelection: state.textSelection });
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
      if (skill) {
        // Check again on sending: the selection or the page may have changed
        // since the chip was clicked. A problem keeps the text in the box.
        const prompt = t(skillKeys(skill).prompt);
        const ctx = skillContext();
        const rest = skillInputRest(skill, prompt, shown);
        const problem = rest == null ? null : (skillBlocker(skill, ctx) || skillInputProblem(skill, rest, ctx));
        if (problem) { setNotice(problem); return; }
        ({ shown, model } = skillMessage(skill, prompt, shown, ctx));
      }
    }
    shown = String(shown || '').trim();
    if (!shown || loading()) return;
    const key = apiKey();

    const userMessage = { role: 'user', content: shown };
    if (model && model !== shown) userMessage.model = model;
    setMessages((m) => [...m, userMessage]);
    setInput('');
    setPendingSkill(null);
    setNotice(null);
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

    // The workplace (#704): the host page asks the AI service. Its answer
    // (`bericht`) goes back unchanged in the next turn; error notices stay out
    // of the conversation.
    const werkplek = async () => {
      const beurten = messages().slice(1)
        .filter((m) => !m.failed)
        .map((m) => (m.bericht ? { bericht: m.bericht } : { role: m.role, content: modelText(m) }));
      const { bericht } = await werkplekAi(maakAiVraag(systemPrompt(), beurten));
      return { content: tekstUitBericht(bericht) || t('assistant.noAnswer'), bericht };
    };

    // Provider order. When a Claude Code/Desktop MCP client is connected (it
    // polled recently), route to the relay FIRST so it answers instantly — no
    // Anthropic API, no key. Otherwise: Claude key -> relay (fallback).
    const relayActive = relayClientActive();
    const providers = [];
    if (werkplekAi) providers.push(werkplek);
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
    if (answer == null) setMessages((m) => [...m, { role: 'assistant', content: describeAiError(lastErr, t), failed: true }]);
    else if (typeof answer === 'object') setMessages((m) => [...m, { role: 'assistant', content: answer.content, bericht: answer.bericht }]);
    else setMessages((m) => [...m, { role: 'assistant', content: answer }]);
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
  // A skill whose preconditions fail (no document, no selection, no scale)
  // shows why in the panel instead of sending.
  function runSkill(skill) {
    const prompt = t(skillKeys(skill).prompt);
    const ctx = skillContext();
    const blocked = skillBlocker(skill, ctx);
    setNotice(blocked);
    if (blocked) return;
    if (skill.needsInput) {
      setPendingSkill(skill);
      setInput(prompt);
      inputEl?.focus();
    } else {
      send(skillMessage(skill, prompt, undefined, ctx));
    }
  }

  // Subtitle shows the active provider so the user knows where answers come from.
  const providerLabel = () => {
    if (werkplekAi) return t('assistant.viaWorkplace');
    return apiKey() ? t('assistant.viaClaude') : t('assistant.notConnected');
  };

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
            <Show when={!werkplekAi}>
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

          <Show when={notice()}>
            <div class="chat-notice" role="status">{t(notice().key, notice().params)}</div>
          </Show>

          <Show when={!loading()}>
            <div class="chat-skill-groups" role="tablist">
              <For each={ASSISTANT_SKILL_GROUPS}>
                {(group) => (
                  <button
                    class={`chat-skill-group${activeGroup() === group.id ? ' active' : ''}`}
                    role="tab"
                    aria-selected={activeGroup() === group.id}
                    data-group={group.id}
                    title={t(skillGroupKey(group))}
                    onClick={() => { setActiveGroup(group.id); setNotice(null); }}
                  >{group.icon}</button>
                )}
              </For>
              <span class="chat-skill-group-name">{t(skillGroupKey(activeGroup()))}</span>
            </div>
            <div class="chat-chips" role="tabpanel">
              <For each={skillsInGroup(activeGroup())}>
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
