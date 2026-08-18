// AI-lint. Hersteld nadat c0ab9e7f (2026-06-18) de oude AITab.jsx verwijderde
// samen met aiStore.js en de eigen AI-API-laag.
//
// Verschil met de oude versie: er is geen aiStore en geen eigen AI-client meer.
// Elke knop stuurt dezelfde actie als een vaardigheid-chip in het
// assistentpaneel, via submitAssistantMessage(text, { action }). Het paneel
// bezit de providerketen, de documenttekst-extractie, de laadstatus en de
// foutmeldingen — de lint is puur een tweede ingang naar hetzelfde pad.
//
// De oude "Live Translate"-groep (hover-vertalen) is NIET hersteld: die hing aan
// js/tools/tools/hover-translate-tool.js, dat in hetzelfde commit is verwijderd
// en een eigen tool + dispatcher-bedrading vereist. Dat is losstaand werk.
import { Show, onMount } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { noPdf } from '../../../core/state.js';
import { submitAssistantMessage } from '../../../assistant-mcp-relay.js';
// Zelfde store als de titelbalk en het assistentpaneel — geen eigen kopie van
// de aanmeldstatus, anders loopt de lint achter na in-/uitloggen.
import { openaecUser, openaecLoadUser } from '../../stores/openaecStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const icons = {
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>',
  qa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 1 1 3.5 2.95V14"/><circle cx="12" cy="17" r="0.5"/></svg>',
  translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 10M11 8L5 18M2 12h14M7 5h4M12 2l7 20M16.5 12L19 18l2.5-6"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  rewrite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  extract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
};

export default function AITab() {
  const { t } = useTranslation('ribbon');
  const { t: tc } = useTranslation('common');
  const signedIn = () => !!openaecUser();
  const refresh = () => openaecLoadUser();
  onMount(refresh);

  // Elke actie opent het paneel en laat dáár de providerketen zijn werk doen.
  // De prompt komt uit i18n (gedeeld met de chips in het paneel), zodat het
  // bericht in het gesprek de taal van de app volgt.
  const run = (action) => submitAssistantMessage(tc(`assistant.prompts.${action}`), { action });

  return (
    <div class="ribbon-content active" id="tab-ai">
      <Show when={!signedIn()}>
        <div class="ribbon-signin-prompt">
          <div class="ribbon-signin-icon" innerHTML={icons.ai} />
          <div class="ribbon-signin-text">
            <div class="ribbon-signin-title">{t('ai.signInToUseAI')}</div>
            <div class="ribbon-signin-sub">{t('ai.signInSub')}</div>
          </div>
          <button class="ribbon-signin-btn" onClick={refresh}>{t('ai.recheck')}</button>
        </div>
      </Show>

      <Show when={signedIn()}>
        <AdaptiveGroups>
          <RibbonGroup label={t('ai.panel')}>
            <RibbonButton id="btn-ai-panel" title={t('ai.openPanel')}
              icon={icons.ai} label={t('ai.assistant')}
              onClick={() => submitAssistantMessage('', {})} />
          </RibbonGroup>

          <RibbonGroup label={t('ai.document')}>
            <RibbonButton id="btn-ai-summarize" title={t('ai.summarizeDoc')}
              icon={icons.summarize} label={t('ai.summarize')}
              disabled={noPdf()} onClick={() => run('summarize')} />
            <RibbonButton id="btn-ai-explain" title={t('ai.explainDoc')}
              icon={icons.explain} label={t('ai.explain')}
              disabled={noPdf()} onClick={() => run('explain')} />
            <RibbonButtonStack>
              <RibbonButton size="small" id="btn-ai-extract" title={t('ai.extractData')}
                icon={icons.extract} label={t('ai.extract')}
                disabled={noPdf()} onClick={() => run('extract')} />
              <RibbonButton size="small" id="btn-ai-translate" title={t('ai.translateDoc')}
                icon={icons.translate} label={t('ai.translate')}
                disabled={noPdf()} onClick={() => run('translate')} />
            </RibbonButtonStack>
          </RibbonGroup>

          <RibbonGroup label={t('ai.text')}>
            <RibbonButton id="btn-ai-rewrite" title={t('ai.rewriteText')}
              icon={icons.rewrite} label={t('ai.rewrite')}
              disabled={noPdf()} onClick={() => run('rewrite')} />
            <RibbonButton id="btn-ai-qa" title={t('ai.askQuestion')}
              icon={icons.qa} label={t('ai.ask')}
              disabled={noPdf()}
              onClick={() => submitAssistantMessage('', {})} />
          </RibbonGroup>

          <RibbonGroup label={t('ai.chat')}>
            <RibbonButton id="btn-ai-chat" title={t('ai.openChat')}
              icon={icons.chat} label={t('ai.chat')}
              onClick={() => submitAssistantMessage('', {})} />
          </RibbonGroup>
        </AdaptiveGroups>
      </Show>
    </div>
  );
}
