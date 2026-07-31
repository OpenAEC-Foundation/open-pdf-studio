// Assistant — floating chat panel (bottom-right) + launcher button. Three ways
// to answer, tried in order:
//   1. OpenAEC AI-server  -> POST /v1/chat via de Rust-command accounts_fetch
//                            (token blijft in de keyring); vereist aanmelding
//   2. MCP relay          -> an external MCP client answers via the app server
import { createSignal, For, Show, createEffect, onMount, onCleanup } from 'solid-js';
import { registerAssistantSubmit, registerAssistantMessages, enqueueAssistantQuestion, relayClientActive } from '../../assistant-mcp-relay.js';
import { ASSISTANT_SKILLS, skillsSystemPrompt } from '../../assistant-skills.js';
import { getActiveDocument } from '../../core/state.js';
import { askAiServer, AiServerError } from '../../services/ai-client.js';
// Aanmeldstatus komt uit DEZELFDE store als de titelbalk. Had het paneel een
// eigen kopie (een lokaal signaal, ververst bij mount/openen), dan merkte het
// niet dat je zojuist via de titelbalk was ingelogd — twee bronnen van waarheid
// die uit elkaar liepen.
import { openaecUser, openaecSignIn, openaecLoadUser } from '../stores/openaecStore.js';
import { collectActiveDocumentText, guessTranslationTarget } from '../../services/document-text.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { LANGUAGES } from '../../i18n/config.js';

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

function describeAiError(err, t) {
  const raw = String(err?.message ?? err ?? '').trim();
  // Getypte fouten van de OpenAEC AI-server eerst — die verdienen een
  // begrijpelijke boodschap in plaats van een ruwe dump.
  const code = err?.code;
  if (code === 'INSUFFICIENT_CREDITS' || /INSUFFICIENT_CREDITS|(?:Accounts API|AI-server) returned 402/i.test(raw)) {
    return t('assistant.errors.insufficientCredits');
  }
  if (code === 'NOT_SIGNED_IN' || /not signed in|no refresh token|(?:Accounts API|AI-server) returned 401/i.test(raw)) {
    return t('assistant.errors.notSignedIn');
  }
  if (code === 'RATE_LIMITED' || /(?:Accounts API|AI-server) returned 429/i.test(raw)) {
    return t('assistant.errors.rateLimited');
  }
  if (code === 'NO_DOCUMENT_TEXT') {
    return t('assistant.errors.noDocumentText');
  }
  if (/unreachable|connection|econn|refused|failed to connect|failed to fetch/i.test(raw)) {
    return t('assistant.errors.offline');
  }
  // Verbinding kwam tot stand maar de dienst antwoordde niet op tijd, of gaf
  // een 5xx (bv. vLLM plat). Dat is iets anders dan "geen internet".
  if (/timed out|timeout|operation timed out/i.test(raw)) {
    return t('assistant.errors.timeout');
  }
  if (err?.code === 'SERVER' || /returned 5\d{2}/i.test(raw)) {
    return t('assistant.errors.serverDown');
  }
  return `${t('assistant.errors.failed')}\n\n_${t('assistant.errors.detail')}: ${raw || t('assistant.errors.unknown')}_`;
}

export default function AssistantPanel() {
  const { t, language } = useTranslation('common');
  // English name of the active UI language, for the model's 'answer in X'.
  const responseLanguage = () =>
    LANGUAGES.find((l) => l.code === language())?.englishName || 'English';
  const [open, setOpen] = createSignal(false);
  const [messages, setMessages] = createSignal([]);
  const [input, setInput] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  // OpenAEC-sessie: bepaalt of de eigen AI-server als eerste provider meedoet.
  // Reactief afgeleid van de store, dus in- of uitloggen via de titelbalk werkt
  // meteen door in dit paneel.
  const signedIn = () => !!openaecUser();
  // Luistert er een MCP-client? Als signaal, want de UI hangt ervan af: zonder
  // sessie én zonder client is er geen enkele provider en heeft versturen geen
  // zin. relayClientActive() zelf is een gewone functie, dus we pollen 'm licht.
  const [relayUp, setRelayUp] = createSignal(relayClientActive());
  // Kan er überhaupt iets verstuurd worden?
  const canSend = () => signedIn() || relayUp();
  const [signingIn, setSigningIn] = createSignal(false);

  // Aanmelden vanuit het paneel zelf: opent de systeembrowser (accounts.rs) en
  // ververst daarna de status, zodat de chips meteen verschijnen.
  const doSignIn = async () => {
    if (signingIn()) return;
    setSigningIn(true);
    // Via de store, zodat de titelbalk hetzelfde resultaat ziet.
    try { await openaecSignIn(); }
    catch (e) { setMessages((m) => [...m, { role: 'assistant', content: describeAiError(e, t) }]); }
    finally { setSigningIn(false); }
  };
  let messagesEnd, inputEl;

  const activeDocName = () => getActiveDocument()?.fileName || null;

  // Aanmeldstatus verversen: bij mount, telkens als het paneel opengaat en vlak
  // voor elke vraag (de gebruiker kan tussendoor in-/uitloggen via de titelbalk).
  const refreshSignedIn = async () => {
    await openaecLoadUser();
    return signedIn();
  };
  // De begroeting wordt bij mount gezet in plaats van als constante, zodat hij
  // de taal volgt die op dat moment actief is. Alleen zolang er nog niets
  // gezegd is: een lopend gesprek mag niet opeens van taal wisselen.
  createEffect(() => {
    const greeting = t('assistant.greeting');
    setMessages((m) => (m.length <= 1 ? [{ role: 'assistant', content: greeting }] : m));
  });

  onMount(() => {
    refreshSignedIn();
    // Goedkope in-memory check (een timestamp-vergelijking), geen IO.
    const id = setInterval(() => setRelayUp(relayClientActive()), 3000);
    onCleanup(() => clearInterval(id));
  });
  createEffect(() => { if (open()) { refreshSignedIn(); setRelayUp(relayClientActive()); } });

  createEffect(() => {
    messages();
    queueMicrotask(() => messagesEnd?.scrollIntoView({ behavior: 'smooth' }));
  });

  function systemPrompt() {
    return 'You are the OpenAEC assistant inside Open PDF Studio (a PDF annotation editor). '
      + 'Help the user with questions about the open PDF document and with general tasks.\n\n'
      + skillsSystemPrompt(responseLanguage());
  }

  /**
   * @param {string} [explicitText] bericht (anders het invoerveld)
   * @param {object} [opts]
   * @param {string} [opts.action]   serveractie (summarize/translate/…). Zonder
   *                                 actie gaat een getypt bericht als 'chat'.
   * @param {boolean} [opts.useServer=true] false voor skills die MCP-tools
   *                                 nodig hebben (tekenen, deuren herkennen).
   */
  async function send(explicitText, opts = {}) {
    const text = (typeof explicitText === 'string' ? explicitText : input()).trim();
    if (!text || loading()) return;
    const action = opts.action || 'chat';
    const serverAllowed = opts.useServer !== false;

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    // OpenAEC AI-server — POST /v1/chat via ai_fetch (eigen host, niet de
    // Accounts-API; zie js/services/ai-client.js). Bij een skill-actie
    // (samenvatten/vertalen) gaat de ECHTE documenttekst mee; voor een getypt
    // bericht is `text` het bericht zelf (action 'chat'), zoals het contract wil.
    const aiServer = async () => {
      const doc = getActiveDocument();
      let payloadText = text;
      let language = opts.language || null;
      if (action !== 'chat') {
        payloadText = await collectActiveDocumentText();
        if (!payloadText) throw new AiServerError('NO_DOCUMENT_TEXT', 'no text layer in this document');
        if (action === 'translate' && !language) language = guessTranslationTarget(payloadText);
      }
      // Geschiedenis zonder de begroeting en zonder het zojuist toegevoegde bericht.
      const history = messages().slice(1, -1).map((m) => ({ role: m.role, content: m.content }));
      return await askAiServer({
        action,
        text: payloadText,
        question: action === 'qa' ? text : null,
        language,
        fileName: doc?.fileName || null,
        pageCount: doc?.pdfDoc?.numPages ?? null,
        currentPage: doc?.currentPage ?? null,
        history: history.length ? history : null,
        // De server schrijft het antwoord in de UI-taal, ook als het document
        // in een andere taal is. Bij 'translate' negeert de server dit, want
        // daar is de doeltaal juist het onderwerp van de vraag.
        responseLanguage: responseLanguage(),
      });
    };

    // MCP relay — an external MCP client (e.g. Claude Code, with working Claude
    // auth) answers via the app's MCP server (app_assistant_pending/answer).
    // Final fallback so the assistant keeps working without a local key.
    const mcpRelay = async () => {
      const history = messages().slice(1)
        .map((m) => `${m.role === 'user' ? 'Gebruiker' : 'Assistent'}: ${m.content}`)
        .join('\n\n');
      const docName = activeDocName();
      const prompt = `${docName ? `Geopend document: ${docName}\n\n` : ''}${history}\n\nAssistent:`;
      return await enqueueAssistantQuestion({ prompt, system: systemPrompt(), docName });
    };

    // Provider order. De eigen AI-server gaat voorop zodra de gebruiker is
    // aangemeld (server-side credits); de MCP-relay is het vangnet en het enige
    // pad dat op de tekening kan handelen (tekenen, deuren herkennen).
    // Al aangemeld? Dan niet opnieuw checken — accounts_get_user kan een
    // userinfo-round-trip kosten. Is de sessie intussen verlopen, dan geeft de
    // server een 401 en valt de keten alsnog terug op de relay.
    const serverReady = serverAllowed && (signedIn() || await refreshSignedIn());
    // De relay telt alleen mee als er ook echt een MCP-client luistert (recent
    // gepolld). Deed hij dat onvoorwaardelijk, dan belandde de vraag in een
    // wachtrij die niemand leest en bleef er 10 MINUTEN "Denken…" staan voordat
    // de timeout toesloeg — precies wat een uitgelogde gebruiker te zien kreeg.
    const relayActive = relayClientActive();
    const providers = [];
    if (serverReady) providers.push(aiServer);
    if (relayActive) providers.push(mcpRelay);

    // Geen enkele provider beschikbaar: meteen zeggen wat eraan schort in plaats
    // van een spinner tonen die nooit iets oplevert.
    if (providers.length === 0) {
      const why = serverAllowed ? 'assistant.errors.notSignedIn' : 'assistant.errors.needsRelay';
      setMessages((m) => [...m, { role: 'assistant', content: t(why) }]);
      setLoading(false);
      return;
    }

    let answer = null;
    const errors = [];
    for (const provider of providers) {
      try { answer = await provider(); break; }
      catch (e) { errors.push(e); console.warn('[assistant] provider faalde, volgende proberen:', e?.message ?? e); }
    }
    // Faalt alles, meld dan bij voorkeur de fout die de gebruiker kan oplossen
    // (credits op / niet aangemeld) in plaats van de fout van de laatste fallback.
    const ACTIONABLE = ['INSUFFICIENT_CREDITS', 'NOT_SIGNED_IN', 'RATE_LIMITED', 'NO_DOCUMENT_TEXT'];
    const primaryErr = errors.find((e) => ACTIONABLE.includes(e?.code)) ?? errors[errors.length - 1];
    setMessages((m) => [...m, { role: 'assistant', content: answer == null ? describeAiError(primaryErr, t) : answer }]);
    setLoading(false);
  }

  // Expose the assistant to the in-app MCP server: an external MCP client can
  // drive it (app_assistant_ask) and act as its AI brain (app_assistant_pending
  // / app_assistant_answer). Registered once when the panel mounts.
  registerAssistantSubmit((text, opts) => { setOpen(true); send(text, opts || {}); });
  registerAssistantMessages(() => messages().map((m) => ({ role: m.role, content: m.content })));

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Skill set: one-click capabilities. Clicking sends the skill's instruction
  // through the assistant (and thus the relay to the brain), which executes it
  // via MCP tools. 'draw' needs the user to specify what, so it pre-fills.
  //
  // Skills MET een serverAction (samenvatten, vertalen) mogen naar de AI-server:
  // send() haalt dan de documenttekst op en stuurt die als `text` mee — dat was
  // de bug waardoor 'Vat samen' nooit de inhoud meestuurde. Skills ZONDER
  // serverAction moeten op de tekening handelen via MCP-tools en slaan de server
  // over.
  function runSkill(skill) {
    // De prompt komt uit i18n, dus wat de gebruiker in het gesprek ziet staan
    // is in zijn eigen taal — net als het label op de chip.
    const prompt = t(`assistant.prompts.${skill.id}`);
    if (skill.needsInput) { setInput(prompt); inputEl?.focus(); return; }
    if (skill.serverAction) send(prompt, { action: skill.serverAction });
    else send(prompt, { useServer: false });
  }

  // Subtitle shows the active provider so the user knows where answers come from.
  const providerLabel = () => {
    if (signedIn()) return t('assistant.viaServer');
    return t('assistant.notConnected');
  };

  return (
    <Show
      when={open()}
      fallback={
        <button class="chat-fab" title={t('assistant.title')} onClick={() => setOpen(true)}>💬</button>
      }
    >
      <div class="chat-floating">
        <div class="chat-panel">
          <div class="chat-header">
            <div class="chat-header-titles">
              <span class="chat-title">✨ {t('assistant.title')}</span>
              <span class="chat-subtitle" title={activeDocName() || ''}>
                {activeDocName() ? `${t('assistant.workingIn')}: ${activeDocName()} · ${providerLabel()}` : providerLabel()}
              </span>
            </div>
            <button class="chat-close" title={t('assistant.close')} onClick={() => setOpen(false)}>✕</button>
          </div>

          <div class="chat-messages">
            <For each={messages()}>
              {(msg) => (
                <div class={`chat-message chat-${msg.role}`}>
                  <div class="chat-bubble" innerHTML={renderContent(msg.content)} />
                </div>
              )}
            </For>
            <Show when={loading()}>
              <div class="chat-message chat-assistant"><div class="chat-bubble chat-typing">{t('assistant.thinking')}</div></div>
            </Show>
            <div ref={messagesEnd} />
          </div>

          {/* Geen provider beschikbaar? Dan geen chips en geen invoerveld, maar
              een uitleg met een aanmeldknop. Beter dan knoppen aanbieden die
              gegarandeerd op een foutmelding uitlopen. */}
          <Show
            when={canSend()}
            fallback={
              <div class="chat-signin">
                <div class="chat-signin-title">{t('assistant.signInTitle')}</div>
                <div class="chat-signin-sub">{t('assistant.signInSub')}</div>
                <button class="chat-signin-btn" disabled={signingIn()} onClick={doSignIn}>
                  {signingIn() ? t('assistant.signingIn') : t('assistant.signIn')}
                </button>
              </div>
            }
          >
            <Show when={!loading()}>
              <div class="chat-chips">
                <For each={ASSISTANT_SKILLS}>
                  {(skill) => (
                    <button class="chat-chip"
                      title={t(`assistant.skills.${skill.id}.hint`)}
                      onClick={() => runSkill(skill)}>
                      {skill.icon} {t(`assistant.skills.${skill.id}.label`)}
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
              <button class="chat-send" onClick={send} disabled={loading() || !input().trim()}>➤</button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
