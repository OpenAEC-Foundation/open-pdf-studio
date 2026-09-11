import { createSignal, onMount } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { mcpStatus } from '../../../core/mcp-koppeling.js';
import { LANGUAGES } from '../../../i18n/config.js';
import PrefSelect from './PrefSelect.jsx';
import LanguageSelect from './LanguageSelect.jsx';

export default function GeneralTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tRibbon } = useTranslation('ribbon');
  const p = props.prefs;

  // Status van de AI-koppeling zoals die nu draait (niet zoals ingevuld).
  const [status, setStatus] = createSignal(null);
  onMount(() => { mcpStatus().then(setStatus); });
  const statusTekst = () => {
    const s = status();
    if (!s) return '';
    const adres = s.poort ? `127.0.0.1:${s.poort}` : '';
    if (s.actief && s.bron === 'startvlag') return t('general.aiLinkViaFlag', { adres });
    if (s.actief) return t('general.aiLinkActive', { adres });
    if (s.fout) return t('general.aiLinkError', { fout: s.fout });
    return t('general.aiLinkOff');
  };

  const languageOptions = LANGUAGES.map(lang => ({
    value: lang.code,
    label: lang.code === 'auto' ? 'Auto-detect' : `${lang.englishName} (${lang.name})`
  }));

  const themeOptions = [
    { value: 'default', label: tRibbon('theme.default') },
    { value: 'light', label: tRibbon('theme.light') },
    { value: 'dark', label: tRibbon('theme.dark') },
    { value: 'blue', label: tRibbon('theme.blue') },
    { value: 'amber-navy', label: tRibbon('theme.amberNavy') },
    { value: 'warm-ember', label: tRibbon('theme.warmEmber') },
    { value: 'highContrast', label: tRibbon('theme.highContrast') },
  ];

  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('general.language')}</legend>
        <div class="pref-row">
          <label>{t('general.interfaceLanguage')}</label>
          <LanguageSelect value={p.language[0]} setValue={p.language[1]} options={languageOptions} style={{ width: '220px' }} />
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.theme')}</legend>
        <div class="pref-row">
          <label>{t('general.applicationTheme')}</label>
          <PrefSelect value={p.theme[0]} setValue={p.theme[1]} options={themeOptions} style={{ width: '140px' }} />
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.startup')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.restoreLastSession[0]()} onChange={e => p.restoreLastSession[1](e.target.checked)} />
            <span>{t('general.restoreLastSession')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.screenshot')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.interceptPrintScreen[0]()} onChange={e => p.interceptPrintScreen[1](e.target.checked)} />
            <span>{t('general.interceptPrintScreen')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.aiLink')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.mcpEnabled[0]()} onChange={e => p.mcpEnabled[1](e.target.checked)} />
            <span>{t('general.aiLinkAllow')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('general.aiLinkPort')}</label>
          <input type="number" min="1024" max="65535" style={{ width: '90px' }}
            value={p.mcpPort[0]()}
            onInput={e => { const n = parseInt(e.target.value, 10); if (n >= 1024 && n <= 65535) p.mcpPort[1](n); }} />
          <span style={{ 'margin-left': '8px', color: '#666' }}>{statusTekst()}</span>
        </div>
        <div class="pref-row" style={{ color: '#666', 'font-size': '11px' }}>{t('general.aiLinkHint')}</div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.author')}</legend>
        <div class="pref-row">
          <label>{t('general.defaultAuthorName')}</label>
          <input type="text" value={p.authorName[0]()} onInput={e => p.authorName[1](e.target.value)} />
        </div>
      </fieldset>
    </>
  );
}
