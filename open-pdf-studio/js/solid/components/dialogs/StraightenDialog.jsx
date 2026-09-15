import { createSignal, createMemo } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';
import { computeStraightenAngle } from '../../../pdf/deskew.js';

export default function StraightenDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const { x1, y1, x2, y2, applyTo: initialApplyTo } = props.data || {};
  const angleDeg = createMemo(() => computeStraightenAngle(x1, y1, x2, y2));

  const [applyTo, setApplyTo] = createSignal(initialApplyTo === 'all' ? 'all' : 'current');

  const close = () => closeDialog('straighten-page');

  const handleApply = async () => {
    const applyToVal = applyTo();
    close();

    const { straightenPages } = await import('../../../pdf/deskew.js');
    const result = await straightenPages(x1, y1, x2, y2, applyToVal);
    updateStatusMessage(
      result.straightened > 0
        ? t('straighten.done', { count: result.straightened, angle: Math.abs(result.angleDeg).toFixed(2) })
        : t('straighten.alreadyStraight')
    );
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleApply}>{t('straighten.apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('straighten.title')}
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
          <label class="crop-margins-label">{t('cropMargins.applyTo')}</label>
          <select
            class="crop-margins-select"
            value={applyTo()}
            onChange={(e) => setApplyTo(e.target.value)}
          >
            <option value="current">{t('cropMargins.currentPage')}</option>
            <option value="all">{t('cropMargins.allPages')}</option>
          </select>
        </div>
        <div class="crop-margins-info">
          {t('straighten.angleInfo', { angle: Math.abs(angleDeg()).toFixed(2) })}
        </div>
      </div>
    </Dialog>
  );
}
