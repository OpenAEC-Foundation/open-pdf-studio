import { closeBackstage } from '../../stores/backstageStore.js';

export default function ImportPanel() {
  const handleImportXFDF = async () => {
    closeBackstage();
    const { importXFDFFromFile } = await import('../../../annotations/xfdf.js');
    importXFDFFromFile();
  };

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">Import</h2>
      <div class="bs-export-cards">
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
            <h3>Import Annotations (XFDF)</h3>
            <p>Import annotations from an XFDF file into the current document</p>
          </div>
        </div>
      </div>
    </div>
  );
}
