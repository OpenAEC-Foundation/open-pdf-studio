import { createSignal, Show } from 'solid-js';
import { closeBackstage } from '../../stores/backstageStore.js';
import { state } from '../../../core/state.js';
import { exportAsImages, exportAsRasterPdf, parsePageRange } from '../../../pdf/exporter.js';

export default function ExportPanel() {
  const [exportType, setExportType] = createSignal('images');
  const [showOptions, setShowOptions] = createSignal(false);
  const [pageRange, setPageRange] = createSignal('all');
  const [customPages, setCustomPages] = createSignal('');
  const [format, setFormat] = createSignal('png');
  const [quality, setQuality] = createSignal(92);
  const [dpi, setDpi] = createSignal(150);

  const handleExportXFDF = async () => {
    closeBackstage();
    const { exportXFDFToFile } = await import('../../../annotations/xfdf.js');
    exportXFDFToFile();
  };

  const handleCardClick = (type) => {
    setExportType(type);
    setShowOptions(true);
    setPageRange('all');
    setCustomPages('');
    setFormat('png');
    setQuality(92);
    setDpi(type === 'raster' ? 300 : 150);
  };

  const handleExport = async () => {
    if (!state.pdfDoc) {
      alert('No document is open.');
      return;
    }

    const totalPages = state.pdfDoc.numPages;
    let pages;

    if (pageRange() === 'current') {
      pages = [state.currentPage];
    } else if (pageRange() === 'custom') {
      pages = parsePageRange(customPages(), totalPages);
      if (pages.length === 0) {
        alert('Invalid page range. Please enter valid page numbers.');
        return;
      }
    } else {
      pages = [];
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    }

    closeBackstage();

    if (exportType() === 'raster') {
      await exportAsRasterPdf({ dpi: dpi(), pages });
    } else {
      await exportAsImages({ format: format(), quality: quality() / 100, dpi: dpi(), pages });
    }
  };

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">Export</h2>

      <div class="bs-export-cards">
        <div class={`bs-export-card${showOptions() && exportType() === 'images' ? ' active' : ''}`} onClick={() => handleCardClick('images')}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>Export as Images</h3>
            <p>Save pages as PNG or JPEG image files</p>
          </div>
        </div>

        <div class={`bs-export-card${showOptions() && exportType() === 'raster' ? ' active' : ''}`} onClick={() => handleCardClick('raster')}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
              <rect x="8" y="13" width="8" height="5" rx="0"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>Export as Raster PDF</h3>
            <p>Flatten pages and annotations into a new PDF with rasterized images</p>
          </div>
        </div>

        <div class="bs-export-card" onClick={handleExportXFDF}>
          <div class="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <path d="M14 2v6h6"/>
              <path d="M8 13l2.5 3L8 19"/>
              <path d="M16 13l-2.5 3L16 19"/>
            </svg>
          </div>
          <div class="bs-export-card-info">
            <h3>Export Annotations (XFDF)</h3>
            <p>Export all annotations to an XFDF file for sharing or backup</p>
          </div>
        </div>
      </div>

      <Show when={showOptions()}>
        <div class="bs-export-options">
          <h3 class="bs-export-options-title">
            {exportType() === 'raster' ? 'Raster PDF Options' : 'Image Export Options'}
          </h3>

          <div class="bs-export-option-group">
            <label class="bs-export-option-label">Page Range</label>
            <div class="bs-export-radio-group">
              <label class="bs-export-radio">
                <input type="radio" name="bs-export-page-range" value="all" checked={pageRange() === 'all'} onChange={() => setPageRange('all')} /> All pages
              </label>
              <label class="bs-export-radio">
                <input type="radio" name="bs-export-page-range" value="current" checked={pageRange() === 'current'} onChange={() => setPageRange('current')} /> Current page
              </label>
              <label class="bs-export-radio">
                <input type="radio" name="bs-export-page-range" value="custom" checked={pageRange() === 'custom'} onChange={() => setPageRange('custom')} /> Custom:
              </label>
            </div>
            <input
              type="text"
              class="bs-export-input"
              placeholder="e.g. 1-5, 8, 11-13"
              disabled={pageRange() !== 'custom'}
              value={customPages()}
              onInput={(e) => setCustomPages(e.target.value)}
            />
          </div>

          <Show when={exportType() === 'images'}>
            <div class="bs-export-option-group">
              <label class="bs-export-option-label">Format</label>
              <select class="bs-export-select" value={format()} onChange={(e) => setFormat(e.target.value)}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </div>
          </Show>

          <Show when={exportType() === 'images' && format() === 'jpeg'}>
            <div class="bs-export-option-group">
              <label class="bs-export-option-label">JPEG Quality</label>
              <div class="bs-export-range-row">
                <input type="range" min="10" max="100" value={quality()} class="bs-export-range" onInput={(e) => setQuality(parseInt(e.target.value))} />
                <span class="bs-export-range-value">{quality()}%</span>
              </div>
            </div>
          </Show>

          <div class="bs-export-option-group">
            <label class="bs-export-option-label">Resolution</label>
            <select class="bs-export-select" value={dpi()} onChange={(e) => setDpi(parseInt(e.target.value))}>
              <option value="72">72 DPI (Screen)</option>
              <option value="150">150 DPI</option>
              <option value="300">300 DPI (Print)</option>
              <option value="600">600 DPI (High Quality)</option>
            </select>
          </div>

          <button class="bs-export-btn" onClick={handleExport}>Export</button>
        </div>
      </Show>
    </div>
  );
}
