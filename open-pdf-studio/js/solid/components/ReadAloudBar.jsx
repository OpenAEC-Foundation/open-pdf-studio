import { For, Show } from 'solid-js';
import { visible, status, voices, voice, rate, messageKey, readingPage, engineKind, allowOnline, onlineVoices } from '../stores/readAloudStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Read aloud (#384): play/pause, stop, voice and rate while reading.
const readAloud = () => import('../../accessibility/read-aloud.js');

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const WARNINGS = new Set(['noEngine', 'noEngineLinux', 'speechFailed', 'nothingToRead', 'onlyOnlineVoices', 'noLocalVoice']);

export default function ReadAloudBar() {
  const { t } = useTranslation('common');
  const playing = () => status() === 'playing';
  const busy = () => status() !== 'idle';
  const noEngine = () => engineKind() === 'none';

  const statusText = () => {
    const key = messageKey();
    if (key && WARNINGS.has(key)) return t(`readAloud.${key}`);
    if (status() === 'loading') return t('readAloud.loading');
    if (status() === 'paused') return t('readAloud.paused');
    if (status() === 'playing') {
      const order = key ? t(`readAloud.${key}`) : '';
      const page = readingPage() ? t('readAloud.page', { page: readingPage() }) : '';
      return [t('readAloud.reading'), page, order].filter(Boolean).join(' · ');
    }
    return '';
  };

  // An online voice is marked, so it is never chosen without knowing.
  const voiceLabel = (v) => {
    const name = v.lang ? `${v.name} (${v.lang})` : v.name;
    return v.online ? `${name} ${t('readAloud.online')}` : name;
  };

  const onPlay = () => readAloud().then((m) => {
    if (status() === 'idle') m.startReadAloud();
    else m.togglePauseReadAloud();
  });

  return (
    <Show when={visible()}>
      <div class="read-aloud-bar" role="toolbar" aria-label={t('readAloud.title')}>
        <button
          class="read-aloud-btn"
          title={playing() ? t('readAloud.pause') : (status() === 'paused' ? t('readAloud.resume') : t('readAloud.play'))}
          disabled={noEngine() || status() === 'loading'}
          onClick={onPlay}
        >
          <Show when={playing()} fallback={
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20"/></svg>
          }>
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </Show>
        </button>
        <button
          class="read-aloud-btn"
          title={t('readAloud.stop')}
          disabled={!busy()}
          onClick={() => readAloud().then((m) => m.stopReadAloud())}
        >
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
        </button>
        <Show when={!noEngine()}>
          <select
            title={t('readAloud.voice')}
            value={voice()}
            onChange={(e) => readAloud().then((m) => m.chooseVoice(e.currentTarget.value))}
          >
            <option value="">{t('readAloud.defaultVoice')}</option>
            <For each={voices()}>
              {(v) => <option value={v.id}>{voiceLabel(v)}</option>}
            </For>
          </select>
          <select
            title={t('readAloud.rate')}
            value={String(rate())}
            onChange={(e) => readAloud().then((m) => m.chooseRate(Number(e.currentTarget.value)))}
          >
            <For each={RATES}>
              {(r) => <option value={String(r)}>{`${r}×`}</option>}
            </For>
          </select>
        </Show>
        <Show when={onlineVoices() > 0}>
          <label class="read-aloud-online" title={t('readAloud.allowOnlineHint')}>
            <input
              type="checkbox"
              checked={allowOnline()}
              onChange={(e) => readAloud().then((m) => m.setAllowOnlineVoices(e.currentTarget.checked))}
            />
            {t('readAloud.allowOnline')}
          </label>
        </Show>
        <span class={`read-aloud-status${WARNINGS.has(messageKey()) ? ' warning' : ''}`}>{statusText()}</span>
        <button
          class="read-aloud-btn close"
          title={t('readAloud.close')}
          onClick={() => readAloud().then((m) => m.closeReadAloud())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </div>
    </Show>
  );
}
