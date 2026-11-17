import { createSignal, Show, For, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getAppVersion, buildUserAgent } from '../../../core/platform.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { externeDienstenAan, meldAlleenBureaublad } from '../../../core/webfuncties.js';

const API_URL = 'https://open-feedback-studio.pages.dev/api/feedback';
const APP_ID = 'open-pdf-studio';
const MAX_IMAGES = 3;
const MAX_TOTAL_SIZE = 1024 * 1024; // 1MB
const MAX_MESSAGE = 5000;
const MIN_MESSAGE = 10;

const CATEGORIEEN = ['general', 'bug', 'feature'];

// `props.data` mag het venster vooraf invullen (bv. de melding over een
// virusscanner, help/virusscanner-melding.js): `category`, `message`, en een
// `hint` die boven het bericht zegt wat erin moet staan.
export default function FeedbackDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const vooraf = props?.data || {};

  const [email, setEmail] = createSignal('');
  const [fullName, setFullName] = createSignal('');
  const [category, setCategory] = createSignal(CATEGORIEEN.includes(vooraf.category) ? vooraf.category : 'general');
  const [message, setMessage] = createSignal(typeof vooraf.message === 'string' ? vooraf.message.slice(0, MAX_MESSAGE) : '');
  const [images, setImages] = createSignal([]);
  const [sentiment, setSentiment] = createSignal(null);
  const [appVersion, setAppVersion] = createSignal('');
  const [userAgent, setUserAgent] = createSignal('');
  const [status, setStatus] = createSignal('idle'); // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = createSignal('');

  let fileInputRef;

  onMount(async () => {
    const ver = await getAppVersion();
    setAppVersion(ver || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''));
    setUserAgent(await buildUserAgent());
    if (state.preferences.feedbackEmail) setEmail(state.preferences.feedbackEmail);
    if (state.preferences.feedbackFullName) setFullName(state.preferences.feedbackFullName);
  });

  const close = () => closeDialog('feedback');

  const isValidEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email().trim());

  const canSubmit = () =>
    isValidEmail() &&
    message().length >= MIN_MESSAGE &&
    message().length <= MAX_MESSAGE &&
    status() !== 'submitting';

  const charCountWarning = () => message().length >= 4500;

  function handleAttach() {
    if (images().length >= MAX_IMAGES) return;
    fileInputRef?.click();
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const current = images();
    const currentSize = current.reduce((sum, img) => sum + img.file.size, 0);
    const remaining = MAX_IMAGES - current.length;
    const toAdd = files.slice(0, remaining);

    const newImages = [];
    let newSize = currentSize;

    for (const file of toAdd) {
      if (!file.type.startsWith('image/')) continue;
      if (newSize + file.size > MAX_TOTAL_SIZE) break;
      newSize += file.size;
      newImages.push({ file, url: URL.createObjectURL(file) });
    }

    setImages([...current, ...newImages]);
    e.target.value = '';
  }

  function removeImage(index) {
    setImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  }

  function resetForm() {
    setEmail('');
    setFullName('');
    setCategory('general');
    setMessage('');
    images().forEach(img => URL.revokeObjectURL(img.url));
    setImages([]);
    setSentiment(null);
    setStatus('idle');
    setErrorMsg('');
  }

  async function handleSubmit() {
    if (!canSubmit()) return;
    // Als gast praat het gereedschap alleen met zijn eigen site (#548); de
    // knop staat daar al uit, dit vangt elke andere weg naar dit venster.
    if (!externeDienstenAan()) {
      await meldAlleenBureaublad(tCommon('sendFeedback'));
      return;
    }

    setStatus('submitting');
    setErrorMsg('');

    try {
      const sentimentValue = sentiment();
      const sentimentLabel = sentimentValue ? SENTIMENT_LABELS[sentimentValue] : undefined;
      const ver = appVersion() || undefined;

      let response;

      const emailVal = email().trim();
      const nameVal = fullName().trim() || undefined;

      if (images().length > 0) {
        const formData = new FormData();
        formData.append('app', APP_ID);
        formData.append('email', emailVal);
        if (nameVal) formData.append('fullname', nameVal);
        formData.append('category', category());
        formData.append('message', message().trim());
        if (sentimentLabel) formData.append('sentiment', sentimentLabel);
        if (ver) formData.append('appVersion', ver);
        images().forEach(img => {
          formData.append('images', img.file);
        });

        const ua = userAgent();
        response = await fetch(API_URL, {
          method: 'POST',
          headers: ua ? { 'User-Agent': ua } : {},
          body: formData,
        });
      } else {
        const ua = userAgent();
        response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(ua ? { 'User-Agent': ua } : {}) },
          body: JSON.stringify({
            app: APP_ID,
            email: emailVal,
            fullname: nameVal,
            category: category(),
            message: message().trim(),
            sentiment: sentimentLabel,
            appVersion: ver,
          }),
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Remember email and name for next time
      state.preferences.feedbackEmail = email().trim();
      state.preferences.feedbackFullName = fullName().trim();
      savePreferences();

      setStatus('success');
    } catch (e) {
      console.error('Feedback submission failed:', e);
      setStatus('error');
      setErrorMsg(t('feedback.errorGeneric'));
    }
  }

  const categories = [
    { key: 'general', label: () => t('feedback.categoryGeneral') },
    { key: 'bug', label: () => t('feedback.categoryBug') },
    { key: 'feature', label: () => t('feedback.categoryFeature') },
  ];

  const SENTIMENT_LABELS = { 1: 'Frustrated', 2: 'Neutral', 3: 'Happy' };

  const sentiments = [
    { value: 1, emoji: '\u{1F61E}', label: () => t('feedback.sentimentFrustrated') },
    { value: 2, emoji: '\u{1F610}', label: () => t('feedback.sentimentNeutral') },
    { value: 3, emoji: '\u{1F60A}', label: () => t('feedback.sentimentHappy') },
  ];

  return (
    <Dialog
      title={t('feedback.title')}
      dialogClass="feedback-dialog"
      onClose={close}
    >
      <Show when={status() === 'success'} fallback={
        <div class="feedback-form">
          {/* Email & Name */}
          <div class="feedback-section">
            <div class="feedback-field-row">
              <label class="feedback-field-label">{t('feedback.email')} <span class="feedback-required">*</span></label>
              <input
                type="email"
                class="feedback-input"
                placeholder={t('feedback.emailPlaceholder')}
                value={email()}
                onInput={(e) => setEmail(e.target.value)}
              />
            </div>
            <div class="feedback-field-row">
              <label class="feedback-field-label">{t('feedback.fullName')}</label>
              <input
                type="text"
                class="feedback-input"
                placeholder={t('feedback.fullNamePlaceholder')}
                value={fullName()}
                onInput={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          {/* Category */}
          <div class="feedback-section">
            <div class="feedback-categories">
              <For each={categories}>
                {(cat) => (
                  <button
                    class={`feedback-category-btn${category() === cat.key ? ' active' : ''}`}
                    onClick={() => setCategory(cat.key)}
                  >
                    {cat.label()}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Message */}
          <div class="feedback-section">
            <Show when={vooraf.hint}>
              <div class="feedback-label">{vooraf.hint}</div>
            </Show>
            <textarea
              class="feedback-message"
              placeholder={t('feedback.messagePlaceholder')}
              maxLength={MAX_MESSAGE}
              value={message()}
              onInput={(e) => setMessage(e.target.value)}
            />
            <div class={`feedback-char-count${charCountWarning() ? ' warning' : ''}`}>
              {message().length} / {MAX_MESSAGE}
            </div>
          </div>

          {/* Image Attachments */}
          <div class="feedback-section">
            <div class="feedback-images">
              <For each={images()}>
                {(img, i) => (
                  <div class="feedback-image-thumb">
                    <img src={img.url} alt="" />
                    <button class="feedback-image-remove" onClick={() => removeImage(i())}>
                      &times;
                    </button>
                  </div>
                )}
              </For>
            </div>
            <Show when={images().length < MAX_IMAGES}>
              <button class="feedback-attach-btn" onClick={handleAttach}>
                {t('feedback.attachImages')}
              </button>
            </Show>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style="display:none"
              onChange={handleFileChange}
            />
            <div class="feedback-label">{t('feedback.imageLimit')}</div>
          </div>

          {/* Sentiment */}
          <div class="feedback-section">
            <div class="feedback-label">{t('feedback.sentiment')}</div>
            <div class="feedback-sentiment">
              <For each={sentiments}>
                {(s) => (
                  <button
                    class={`feedback-sentiment-btn${sentiment() === s.value ? ' active' : ''}`}
                    onClick={() => setSentiment(sentiment() === s.value ? null : s.value)}
                    title={s.label()}
                  >
                    {s.emoji}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Why-is-submit-disabled hint — the button being silently grey
              reads as "submit is broken"; spell out what is still missing. */}
          <Show when={!canSubmit() && status() !== 'submitting'}>
            <div style="font-size:11px;color:var(--theme-text-secondary,#996);margin-bottom:4px">
              <Show when={!isValidEmail()}>
                <div>• Vul een geldig e-mailadres in.</div>
              </Show>
              <Show when={message().length < MIN_MESSAGE}>
                <div>• Bericht: minimaal {MIN_MESSAGE} tekens (nu {message().length}).</div>
              </Show>
              <Show when={message().length > MAX_MESSAGE}>
                <div>• Bericht is te lang (max {MAX_MESSAGE} tekens).</div>
              </Show>
            </div>
          </Show>

          {/* Submit */}
          <button
            class="feedback-submit-btn"
            disabled={!canSubmit()}
            onClick={handleSubmit}
          >
            {status() === 'submitting' ? t('feedback.submitting') : t('feedback.submit')}
          </button>

          <Show when={status() === 'error'}>
            <div class="feedback-error">{errorMsg()}</div>
          </Show>
        </div>
      }>
        {/* Success State */}
        <div class="feedback-success">
          <h3>{t('feedback.successTitle')}</h3>
          <p>{t('feedback.successMessage')}</p>
          <button class="feedback-submit-btn" onClick={resetForm}>
            {t('feedback.sendAnother')}
          </button>
        </div>
      </Show>
    </Dialog>
  );
}
