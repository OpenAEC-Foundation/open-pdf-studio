import { closeAppMenu } from '../../stores/appMenuStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ImportPanel() {
  const { t } = useTranslation('appMenu');

  const handleImportXFDF = async () => {
    closeAppMenu();
    const { importXFDFFromFile } = await import('../../../annotations/xfdf.js');
    importXFDFFromFile();
  };

  // DWG/DXF (#400): eigen venster met lagen, ruimte, schaal en papier.
  const handleImportCad = () => {
    closeAppMenu();
    openDialog('cad-import');
  };

  const handleImportBCF = async () => {
    closeAppMenu();
    const { importBcfFromFile } = await import('../../../bcf/bcf-ui.js');
    importBcfFromFile();
  };

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">{t('importPanel.title')}</h2>
      <div class="bs-export-cards">
        <div class="bs-export-card" onClick={handleImportCad}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M7 18l3-5 2 3 2-4 3 6z"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>{t('importPanel.importCad')}</h3>
            <p>{t('importPanel.importCadDesc')}</p>
          </div>
        </div>

        <div class="bs-export-card" onClick={handleImportXFDF}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M8 13l2.5 3L8 19"/>
              <path d="M16 13l-2.5 3L16 19"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>{t('importPanel.importXfdf')}</h3>
            <p>{t('importPanel.importXfdfDesc')}</p>
          </div>
        </div>

        <div class="bs-export-card" onClick={handleImportBCF}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
              <circle cx="10" cy="14" r="2"/>
              <path d="M14 13v4"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>{t('importPanel.importBcf')}</h3>
            <p>{t('importPanel.importBcfDesc')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
