import { createSignal, onCleanup, Show } from 'solid-js';
import { openFileDialog, readBinaryFile } from '../../core/platform.js';
import { signatureImageData } from '../../annotations/signature-image.js';
import { saveSignatureToStorage } from '../../annotations/signature-storage.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Alleen opslaan zolang de dialoog bestaat: sluiten tijdens kiezen/decoderen
// mag geen onzichtbare import of wijziging van een latere dialoog opleveren.
export default function SignatureImageImport(props) {
  const { t } = useTranslation('dialogs');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  onCleanup(() => { disposed = true; });

  async function importImage() {
    if (busy() || props.disabled) return;
    setBusy(true);
    setError('');
    try {
      const path = await openFileDialog(['png', 'jpg', 'jpeg']);
      if (disposed || !path) return;
      const bytes = await readBinaryFile(path);
      if (disposed) return;
      const dataUrl = await signatureImageData(bytes);
      if (disposed) return;
      props.onImported(saveSignatureToStorage(dataUrl));
    } catch (e) {
      if (!disposed) setError(t('digitalSign.errors.imageUnreadable', { detail: e.message || String(e) }));
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  return <div class="signature-image-import">
    <button type="button" class="pref-btn pref-btn-secondary" disabled={busy() || props.disabled}
      onClick={importImage}>{t('digitalSign.image')} (PNG / JPEG): {t('digitalSign.browse')}</button>
    <Show when={error()}><div class="protect-pdf-fout" role="alert">{error()}</div></Show>
  </div>;
}
