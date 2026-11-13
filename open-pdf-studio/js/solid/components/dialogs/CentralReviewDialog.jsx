import { For, Show, onCleanup } from 'solid-js';
import { createMutable } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { invoke, isTauri } from '../../../core/platform.js';
import { createCentralReviewSession } from '../../../review/central-review-session.js';
import '../../../../styles/central-review.css';

export default function CentralReviewDialog() {
  const { t } = useTranslation('dialogs');
  const view = createMutable({ connected: false, busy: false, rows: [], cursor: '', more: false,
    selected: '', error: '', notice: '' });
  let serverInput, nameInput, passwordInput, recipientInput, roleInput;
  let alive = true, operation = 0;
  const logoutWarning = () => {
    const message = t('centralReview.logoutWarning');
    if (alive) view.error = message;
    else showMessage(message, t('centralReview.title'));
  };
  const client = createCentralReviewSession(invoke, logoutWarning);
  const clearDocuments = () => { view.rows = []; view.cursor = ''; view.more = false; view.selected = ''; };
  const message = (code) => t(`centralReview.${({
    AUTHENTICATION_FAILED: 'loginFailed', INVALID_SERVER: 'invalidServer',
    ACCESS_DENIED: 'accessDenied', SESSION_CLOSED: 'accessDenied',
    INVALID_REQUEST: 'invalidRequest', RATE_LIMITED: 'retryLater', BUSY: 'retryLater',
  })[code] || 'requestFailed'}`);
  async function act(task) {
    if (view.busy) return;
    const id = ++operation;
    view.busy = true; view.error = ''; view.notice = '';
    const valid = () => alive && id === operation;
    try { await task(valid); }
    catch (e) {
      if (valid() && e.message !== 'STALE') {
        view.error = message(e.message);
        if (['ACCESS_DENIED', 'SESSION_CLOSED', 'INVALID_RESPONSE'].includes(e.message)) clearDocuments();
      }
    } finally { if (valid()) view.busy = false; }
  }
  async function load(after, valid) {
    clearDocuments();
    const page = await client.documents(after);
    if (!valid()) return;
    view.rows = page.documents; view.cursor = page.cursor; view.more = page.hasMore;
  }
  function login(e) {
    e.preventDefault();
    const password = passwordInput.value;
    passwordInput.value = '';
    void act(async (valid) => {
      await client.login(serverInput.value.trim(), nameInput.value, password);
      if (!valid()) return;
      view.connected = true;
      await load(null, valid);
    });
  }
  async function logout() {
    ++operation;
    view.connected = false; view.busy = false; view.error = ''; view.notice = '';
    clearDocuments();
    if (passwordInput) passwordInput.value = '';
    await client.logout();
  }
  onCleanup(() => {
    alive = false; ++operation;
    if (passwordInput) passwordInput.value = '';
    void client.dispose();
  });
  const selected = () => view.rows.find((row) => row.id === view.selected);
  const close = () => closeDialog('central-review');
  return <Dialog title={t('centralReview.title')} onClose={close}
    overlayClass="crop-margins-overlay" dialogClass="crop-margins-dialog central-review-dialog"
    headerClass="crop-margins-header" bodyClass="crop-margins-content" footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={close}>{t('common:close')}</button>}>
    <Show when={isTauri()} fallback={<p>{t('sharedReview.desktopOnly')}</p>}>
      <Show when={!view.connected} fallback={<>
        <div class="central-review-actions">
          <button class="pref-btn" disabled={view.busy} onClick={() => act((valid) => load(null, valid))}>{t('approvalRouting.refresh')}</button>
          <button class="pref-btn" disabled={view.busy || !view.more} onClick={() => { const after = view.cursor; void act((valid) => load(after, valid)); }}>{t('centralReview.more')}</button>
          <button class="pref-btn" onClick={logout}>{t('centralReview.signOut')}</button>
        </div>
        <fieldset disabled={view.busy} class="central-review-documents">
          <legend>{t('centralReview.documents')}</legend>
          <Show when={view.rows.length} fallback={<p>{view.busy ? t('common:loading') : t('centralReview.empty')}</p>}>
            <For each={view.rows}>{row => <label class="central-review-document">
              <input type="radio" name="central-document" value={row.id} checked={view.selected === row.id}
                onChange={() => { view.selected = row.id; view.notice = ''; }} />
              <span>{row.title}</span><small>{t(`centralReview.${row.role}`)}</small>
            </label>}</For>
          </Show>
        </fieldset>
        <Show when={selected()?.role === 'owner'}>
          <form onSubmit={(e) => { e.preventDefault(); const document = view.selected, name = recipientInput.value, role = roleInput.value;
            void act(async (valid) => { await client.share(document, name, role === 'revoke' ? null : role); if (valid()) view.notice = t('centralReview.saved'); }); }}>
            <fieldset disabled={view.busy}>
              <legend>{t('centralReview.share')}</legend>
              <label>{t('centralReview.account')}<input ref={recipientInput} type="text" required maxlength="128" autocomplete="off" /></label>
              <label>{t('centralReview.access')}<select ref={roleInput} aria-label={t('centralReview.access')}>
                <option value="reader">{t('centralReview.reader')}</option>
                <option value="editor">{t('centralReview.editor')}</option>
                <option value="revoke">{t('centralReview.revoke')}</option>
              </select></label>
              <button class="pref-btn" type="submit">{t('common:apply')}</button>
            </fieldset>
          </form>
        </Show>
      </>}>
        <form onSubmit={login} autocomplete="off">
          <fieldset disabled={view.busy}>
            <label>{t('centralReview.server')}<input ref={serverInput} type="url" required placeholder="https://" autocomplete="off" /></label>
            <label>{t('centralReview.account')}<input ref={nameInput} type="text" required maxlength="128" autocomplete="username" /></label>
            <label>{t('digitalSign.password')}<input ref={passwordInput} type="password" required maxlength="1024" autocomplete="off" /></label>
            <button class="pref-btn" type="submit">{view.busy ? t('common:loading') : t('centralReview.signIn')}</button>
          </fieldset>
        </form>
      </Show>
      <Show when={view.error}><p role="alert" class="central-review-error">{view.error}</p></Show>
      <Show when={view.notice}><p role="status">{view.notice}</p></Show>
    </Show>
  </Dialog>;
}
