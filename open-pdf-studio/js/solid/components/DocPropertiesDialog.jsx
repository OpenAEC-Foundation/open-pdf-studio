import { For, lazy } from 'solid-js';
import Dialog from './Dialog.jsx';
import { closeDialog } from '../stores/dialogStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { RECHTEN_LIJST } from '../../pdf/document-beveiliging.js';

// Loaded when the dialog opens, with their services, outside the main chunk.
const HiddenInformation = lazy(() => import('./HiddenInformation.jsx'));
const PrintPreflight = lazy(() => import('./PrintPreflight.jsx'));

function PropRow(props) {
  return (
    <div class="doc-props-row">
      <span class="doc-props-label">{props.label}</span>
      <span class="doc-props-value">{props.value}</span>
    </div>
  );
}

export default function DocPropertiesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const d = props.data;

  const close = () => closeDialog('doc-properties');

  // Documentbeveiliging (#378): wat opslaan schrijft (beschrijfBeveiliging).
  const sec = d.security || { versleuteld: false };
  const ja = (b) => tCommon(b ? 'yes' : 'no');
  const rechtenTekst = () => {
    if (sec.alles) return t('docProperties.allPermissions');
    if (!sec.rechten) return '-';
    if (!sec.rechten.length) return t('docProperties.noPermissions');
    const labels = new Map(RECHTEN_LIJST);
    return sec.rechten.map((k) => t(labels.get(k))).join(', ');
  };

  return (
    <Dialog
      title={t('docProperties.title')}
      overlayClass="doc-props-overlay"
      dialogClass="doc-props-dialog"
      bodyClass="doc-props-content"
      footerClass="doc-props-footer"
      onClose={close}
      footer={<button onClick={close}>{tCommon('ok')}</button>}
    >
      <div class="doc-props-section">
        <h3>{t('docProperties.file')}</h3>
        <PropRow label={t('docProperties.fileName')} value={d.fileName} />
        <PropRow label={t('docProperties.filePath')} value={d.filePath} />
        <PropRow label={t('docProperties.fileSize')} value={d.fileSize} />
      </div>
      <div class="doc-props-section">
        <h3>{t('docProperties.document')}</h3>
        <PropRow label={t('docProperties.docTitle')} value={d.title} />
        <PropRow label={t('docProperties.author')} value={d.author} />
        <PropRow label={t('docProperties.subject')} value={d.subject} />
        <PropRow label={t('docProperties.keywords')} value={d.keywords} />
        <PropRow label={t('docProperties.creator')} value={d.creator} />
        <PropRow label={t('docProperties.producer')} value={d.producer} />
      </div>
      <div class="doc-props-section">
        <h3>{t('docProperties.pdfInfo')}</h3>
        <PropRow label={t('docProperties.pdfVersion')} value={d.pdfVersion} />
        <PropRow label={t('docProperties.pageCount')} value={d.pageCount} />
        <PropRow label={t('docProperties.pageSize')} value={d.pageSize} />
        <PropRow label={t('docProperties.creationDate')} value={d.created} />
        <PropRow label={t('docProperties.modifiedDate')} value={d.modified} />
      </div>
      <div class="doc-props-section" id="doc-props-security">
        <h3>{t('docProperties.security')}</h3>
        <PropRow label={t('docProperties.encryption')} value={sec.versleuteld ? (sec.methode || '-') : t('docProperties.notEncrypted')} />
        {sec.versleuteld && <PropRow label={t('docProperties.openPassword')} value={ja(sec.openWachtwoord)} />}
        {sec.versleuteld && <PropRow label={t('docProperties.permissions')} value={rechtenTekst()} />}
        {sec.inAfwachting && <PropRow label="" value={t('protectPdf.pending')} />}
      </div>
      <HiddenInformation />
      <PrintPreflight />
    </Dialog>
  );
}
