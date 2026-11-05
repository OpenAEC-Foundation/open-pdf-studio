import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { COMPRESS_PRESETS, formatBytes } from '../../../pdf/compress.js';

export default function CompressDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const currentSize = props.data?.currentSize ?? null;

  const [level, setLevel] = createSignal('medium');
  // 'raster': elke pagina als JPEG; 'lossless': alleen zwart/witte beelden
  // verliesloos opnieuw coderen, tekst en vectoren blijven (#902).
  const [mode, setMode] = createSignal('raster');

  const close = () => closeDialog('compress');

  const handleLossless = async () => {
    const { compressPDFLossless, formatBytes: fmt } = await import('../../../pdf/compress.js');
    const { losslessReport } = await import('../../../pdf/monochrome-rapport.js');
    try {
      const result = await compressPDFLossless();
      if (!result || result.cancelled) return;
      showMessage(losslessReport(result, t, fmt), t('compress.title'));
    } catch (e) {
      showMessage(t('compress.failed', { error: String(e?.message ?? e) }));
    }
  };

  const handleCompress = async () => {
    const chosen = level();
    close();
    if (mode() === 'lossless') return handleLossless();

    const { compressPDF } = await import('../../../pdf/compress.js');
    try {
      const result = await compressPDF({ level: chosen });
      if (!result) return; // cancelled at the save dialog

      const before = formatBytes(result.origSize);
      const after = formatBytes(result.newSize);
      if (result.origSize && result.newSize < result.origSize) {
        const pct = Math.round(100 * (1 - result.newSize / result.origSize));
        showMessage(t('compress.done', { before, after, pct }));
      } else {
        showMessage(t('compress.doneNoGain', { after }));
      }
    } catch (e) {
      showMessage(t('compress.failed', { error: String(e?.message ?? e) }));
    }
  };

  const levels = [
    { id: 'low', name: t('compress.low'), dpi: COMPRESS_PRESETS.low.dpi },
    { id: 'medium', name: t('compress.medium'), dpi: COMPRESS_PRESETS.medium.dpi },
    { id: 'high', name: t('compress.high'), dpi: COMPRESS_PRESETS.high.dpi },
  ];

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleCompress}>{t('compress.action')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('compress.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('compress.mode')}</label>
          <select
            class="crop-margins-select"
            value={mode()}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="raster">{t('compress.modeRaster')}</option>
            <option value="lossless">{t('compress.modeLossless')}</option>
          </select>
        </div>
        <Show when={mode() === 'raster'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('compress.quality')}</label>
            <select
              class="crop-margins-select"
              value={level()}
              onChange={(e) => setLevel(e.target.value)}
            >
              {levels.map((l) => (
                <option value={l.id}>{l.name} — {l.dpi} DPI</option>
              ))}
            </select>
          </div>
        </Show>
        <div class="crop-margins-info">
          {currentSize != null
            ? t('compress.currentSize', { size: formatBytes(currentSize) })
            : ''}
        </div>
        <div class="crop-margins-info">
          {mode() === 'lossless' ? t('compress.infoLossless') : t('compress.info')}
        </div>
      </div>
    </Dialog>
  );
}
