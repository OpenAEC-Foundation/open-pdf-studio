import { createSignal, createMemo, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getPageRotation } from '../../../core/state.js';
import { invoke } from '../../../core/platform.js';
import { parsePageRange, renderPageOffscreen, canvasToBytes } from '../../../pdf/exporter.js';
import { PDFDocument } from 'pdf-lib';

export default function PrintDialog(props) {
  const [printerList, setPrinterList] = createSignal([]);
  const [selectedPrinter, setSelectedPrinter] = createSignal('');
  const [printerStatus, setPrinterStatus] = createSignal('Status:');
  const [printerType, setPrinterType] = createSignal('Type:');
  const [copies, setCopies] = createSignal(1);
  const [collate, setCollate] = createSignal(false);
  const [activeRange, setActiveRange] = createSignal('all');
  const [customPages, setCustomPages] = createSignal('');
  const [activeSubset, setActiveSubset] = createSignal('all');
  const [reverseOrder, setReverseOrder] = createSignal(false);
  const [scaling, setScaling] = createSignal('fit');
  const [zoom, setZoom] = createSignal(100);
  const [autoRotate, setAutoRotate] = createSignal(true);
  const [autoCenter, setAutoCenter] = createSignal(true);
  const [printContent, setPrintContent] = createSignal('doc-and-markups');
  const [printAsImage, setPrintAsImage] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal('');
  const [statusType, setStatusType] = createSignal('');
  const [printDisabled, setPrintDisabled] = createSignal(false);
  const [previewPages, setPreviewPages] = createSignal([]);
  const [previewIndex, setPreviewIndex] = createSignal(0);
  const [paperDimensions, setPaperDimensions] = createSignal('');

  let canvasRef;

  const close = () => closeDialog('print');

  function updatePrinterInfo(name) {
    const printer = printerList().find(p => p.Name === name);
    if (printer) {
      setPrinterStatus(`Status: ${printer.Status || 'Ready'}`);
      setPrinterType(`Type: ${printer.DriverName || printer.Name || ''}`);
    } else {
      setPrinterStatus('Status:');
      setPrinterType('Type:');
    }
  }

  function getPrintPages() {
    if (!state.pdfDoc) return [];
    const totalPages = state.pdfDoc.numPages;
    let pages = [];

    if (activeRange() === 'all') {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (activeRange() === 'current') {
      const cp = props.data?.currentPage || state.currentPage || 1;
      pages = [cp];
    } else if (activeRange() === 'custom') {
      pages = parsePageRange(customPages(), totalPages);
    }

    if (activeSubset() === 'odd') {
      pages = pages.filter(p => p % 2 === 1);
    } else if (activeSubset() === 'even') {
      pages = pages.filter(p => p % 2 === 0);
    }

    if (reverseOrder()) {
      pages.reverse();
    }

    return pages;
  }

  const pageInfo = createMemo(() => {
    const pages = getPrintPages();
    return `${pages.length} page(s) to print`;
  });

  function updatePreviewPages() {
    const pages = getPrintPages();
    setPreviewPages(pages);
    setPreviewIndex(0);
  }

  async function renderPreview() {
    if (!canvasRef || !state.pdfDoc) return;
    const pages = previewPages();
    if (pages.length === 0) {
      const ctx = canvasRef.getContext('2d');
      canvasRef.width = 300;
      canvasRef.height = 350;
      ctx.clearRect(0, 0, 300, 350);
      setPaperDimensions('');
      return;
    }

    const idx = previewIndex();
    const pageNum = pages[Math.min(idx, pages.length - 1)];

    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const viewportOpts = { scale: 1 };
      if (extraRotation) {
        viewportOpts.rotation = (page.rotate + extraRotation) % 360;
      }
      const viewport = page.getViewport(viewportOpts);

      const maxW = 300;
      const maxH = 350;
      const scaleW = maxW / viewport.width;
      const scaleH = maxH / viewport.height;
      const previewScale = Math.min(scaleW, scaleH);

      const previewViewportOpts = { scale: previewScale };
      if (extraRotation) {
        previewViewportOpts.rotation = (page.rotate + extraRotation) % 360;
      }
      const previewViewport = page.getViewport(previewViewportOpts);

      canvasRef.width = Math.floor(previewViewport.width);
      canvasRef.height = Math.floor(previewViewport.height);
      const ctx = canvasRef.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);

      if (printContent() === 'doc-and-markups') {
        const rendered = await renderPageOffscreen(pageNum, previewScale);
        ctx.drawImage(rendered, 0, 0, canvasRef.width, canvasRef.height);
      } else {
        const renderTask = page.render({
          canvasContext: ctx,
          viewport: previewViewport,
          annotationMode: 0
        });
        await renderTask.promise;
      }

      const wIn = (viewport.width / 72).toFixed(2);
      const hIn = (viewport.height / 72).toFixed(2);
      const wMm = (viewport.width / 72 * 25.4).toFixed(0);
      const hMm = (viewport.height / 72 * 25.4).toFixed(0);
      setPaperDimensions(`${wIn} x ${hIn} in (${wMm} x ${hMm} mm)`);
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  function prevPreview() {
    if (previewIndex() > 0) {
      setPreviewIndex(previewIndex() - 1);
      renderPreview();
    }
  }

  function nextPreview() {
    if (previewIndex() < previewPages().length - 1) {
      setPreviewIndex(previewIndex() + 1);
      renderPreview();
    }
  }

  function onRangeChange(range) {
    setActiveRange(range);
    updatePreviewPages();
    renderPreview();
  }

  function onSubsetChange(subset) {
    setActiveSubset(subset);
    updatePreviewPages();
    renderPreview();
  }

  function onReverseChange(checked) {
    setReverseOrder(checked);
    updatePreviewPages();
    renderPreview();
  }

  function onCustomPagesChange(value) {
    setCustomPages(value);
    if (activeRange() === 'custom') {
      updatePreviewPages();
      renderPreview();
    }
  }

  function onPrintContentChange(value) {
    setPrintContent(value);
    renderPreview();
  }

  async function openPrinterProperties() {
    try {
      await invoke('open_printer_properties', { printerName: selectedPrinter() });
    } catch (e) {
      console.error('Failed to open printer properties:', e);
    }
  }

  async function openPageSetup() {
    const { showPageSetupDialog } = await import('../../../ui/chrome/dialogs.js');
    showPageSetupDialog();
  }

  async function executePrint() {
    if (!selectedPrinter()) {
      setStatusMessage('No printer selected.');
      setStatusType('error');
      return;
    }

    const pages = getPrintPages();
    if (pages.length === 0) {
      setStatusMessage('No pages to print.');
      setStatusType('error');
      return;
    }

    setPrintDisabled(true);
    setStatusMessage('Preparing print job...');
    setStatusType('');

    try {
      const exportScale = 300 / 72;
      const newPdf = await PDFDocument.create();

      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        setStatusMessage(`Rendering page ${pageNum}...`);

        const canvas = await renderPageOffscreen(pageNum, exportScale);
        const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);
        const jpegImage = await newPdf.embedJpg(jpegBytes);

        const origPage = await state.pdfDoc.getPage(pageNum);
        const extraRotation = getPageRotation(pageNum);
        const origViewportOpts = { scale: 1 };
        if (extraRotation) {
          origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        const origViewport = origPage.getViewport(origViewportOpts);

        const pdfPage = newPdf.addPage([origViewport.width, origViewport.height]);
        pdfPage.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height,
        });
      }

      setStatusMessage('Saving print data...');
      const pdfBytes = await newPdf.save();
      const tempPath = await invoke('write_temp_pdf', { data: Array.from(pdfBytes) });

      if (!tempPath) {
        setStatusMessage('Failed to create temporary print file.');
        setStatusType('error');
        setPrintDisabled(false);
        return;
      }

      const numCopies = Math.max(1, copies());
      for (let c = 0; c < numCopies; c++) {
        setStatusMessage(numCopies > 1
          ? `Printing copy ${c + 1} of ${numCopies}...`
          : 'Sending to printer...');
        await invoke('print_pdf', {
          printerName: selectedPrinter(),
          filePath: tempPath,
        });
      }

      setStatusMessage('Print job sent successfully.');
      setStatusType('success');

      setTimeout(() => {
        close();
      }, 1500);

      setTimeout(async () => {
        try {
          await invoke('delete_temp_file', { path: tempPath });
        } catch (_) {}
      }, 30000);
    } catch (e) {
      console.error('Print error:', e);
      setStatusMessage(`Print failed: ${e.message || e}`);
      setStatusType('error');
      setPrintDisabled(false);
    }
  }

  onMount(async () => {
    try {
      const json = await invoke('get_printers');
      const printers = JSON.parse(json);
      setPrinterList(printers || []);

      if (!printers || printers.length === 0) {
        setPrintDisabled(true);
        return;
      }

      const defaultPrinter = printers.find(p => p.Default === true);
      const printerName = defaultPrinter?.Name || printers[0]?.Name || '';
      setSelectedPrinter(printerName);
      updatePrinterInfo(printerName);
    } catch (e) {
      console.error('Failed to enumerate printers:', e);
      setPrintDisabled(true);
    }

    updatePreviewPages();
    renderPreview();
  });

  const currentPageNum = props.data?.currentPage || state.currentPage || 1;

  const footer = (
    <>
      <div class="print-footer-left">
        <span class="print-page-info">{pageInfo()}</span>
      </div>
      <div class="print-footer-right">
        <button
          class="pref-btn pref-btn-primary"
          disabled={printDisabled()}
          onClick={executePrint}
        >Print</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </>
  );

  return (
    <Dialog
      title="Print"
      overlayClass="print-overlay"
      dialogClass="print-dialog"
      headerClass="print-header"
      bodyClass="print-body"
      footerClass="print-footer"
      onClose={close}
      footer={footer}
    >
      <div class="print-settings">
        {/* Printer */}
        <fieldset class="print-group">
          <legend>Printer</legend>
          <div class="print-printer-layout">
            <div class="print-printer-left">
              <div class="print-row">
                <label class="print-label">Name:</label>
                <select
                  class="print-select"
                  value={selectedPrinter()}
                  onChange={(e) => {
                    setSelectedPrinter(e.target.value);
                    updatePrinterInfo(e.target.value);
                  }}
                >
                  <For each={printerList()}>
                    {(printer) => (
                      <option value={printer.Name}>{printer.Name}</option>
                    )}
                  </For>
                </select>
              </div>
              <div class="print-row print-printer-detail-row">
                <span class="print-printer-status">{printerStatus()}</span>
                <span class="print-printer-sep">|</span>
                <span class="print-printer-type">{printerType()}</span>
              </div>
            </div>
            <div class="print-printer-right">
              <button class="print-printer-action-btn" onClick={openPrinterProperties}>
                Properties...
              </button>
              <button class="print-printer-action-btn" onClick={openPageSetup}>
                Page Setup...
              </button>
            </div>
          </div>
          <div class="print-row">
            <label class="print-label">Copies:</label>
            <input
              type="number"
              class="print-input"
              min="1"
              max="999"
              value={copies()}
              onInput={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <label class="print-checkbox-label print-collate-label">
              <input
                type="checkbox"
                checked={collate()}
                onChange={(e) => setCollate(e.target.checked)}
              /> Collate
            </label>
          </div>
        </fieldset>

        {/* Page Range */}
        <fieldset class="print-group">
          <legend>Page Range</legend>
          <div class="print-row print-pages-row">
            <div class="print-page-btns">
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'all' }}
                onClick={() => onRangeChange('all')}
              >All</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'current' }}
                onClick={() => onRangeChange('current')}
              >{`Current: ${currentPageNum}`}</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'custom' }}
                onClick={() => onRangeChange('custom')}
              >Custom</button>
            </div>
          </div>
          <div class="print-row print-custom-row">
            <label class="print-label">Pages:</label>
            <input
              type="text"
              class="print-custom-input"
              placeholder="e.g. 1-3, 5, 8-10"
              disabled={activeRange() !== 'custom'}
              value={customPages()}
              onInput={(e) => onCustomPagesChange(e.target.value)}
            />
          </div>
          <div class="print-row">
            <label class="print-label">Subset:</label>
            <div class="print-subset-btns">
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'all' }}
                onClick={() => onSubsetChange('all')}
              >All</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'odd' }}
                onClick={() => onSubsetChange('odd')}
              >Odd</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'even' }}
                onClick={() => onSubsetChange('even')}
              >Even</button>
            </div>
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={reverseOrder()}
                onChange={(e) => onReverseChange(e.target.checked)}
              /> Reverse Order
            </label>
          </div>
        </fieldset>

        {/* Page Placement and Scaling */}
        <fieldset class="print-group">
          <legend>Page Placement and Scaling</legend>
          <div class="print-row">
            <label class="print-label">Type:</label>
            <select
              class="print-select"
              value={scaling()}
              onChange={(e) => setScaling(e.target.value)}
            >
              <option value="fit">Fit</option>
              <option value="actual">Actual Size</option>
              <option value="shrink">Shrink to Printable Area</option>
              <option value="custom-scale">Custom Scale</option>
            </select>
          </div>
          <div class="print-row print-zoom-row">
            <label class="print-label">Page Zoom:</label>
            <input
              type="number"
              class="print-input"
              min="10"
              max="400"
              value={zoom()}
              disabled={scaling() !== 'custom-scale'}
              onInput={(e) => setZoom(Math.max(10, parseInt(e.target.value) || 100))}
            />
            <span>%</span>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoRotate()}
                onChange={(e) => setAutoRotate(e.target.checked)}
              /> Auto-Rotate
            </label>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoCenter()}
                onChange={(e) => setAutoCenter(e.target.checked)}
              /> Auto-Center
            </label>
          </div>
        </fieldset>

        {/* Advanced Print Options */}
        <fieldset class="print-group">
          <legend>Advanced Print Options</legend>
          <div class="print-row">
            <label class="print-label">Print:</label>
            <select
              class="print-select"
              value={printContent()}
              onChange={(e) => onPrintContentChange(e.target.value)}
            >
              <option value="doc-and-markups">Document and Markups</option>
              <option value="doc-only">Document</option>
            </select>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={printAsImage()}
                onChange={(e) => setPrintAsImage(e.target.checked)}
              /> Print as Image
            </label>
          </div>
        </fieldset>

        <Show when={statusMessage()}>
          <div class={`print-status ${statusType()}`}>
            {statusMessage()}
          </div>
        </Show>
      </div>

      <div class="print-preview-panel">
        <div class="print-preview-header">
          <span>{paperDimensions()}</span>
        </div>
        <div class="print-preview-container">
          <canvas ref={canvasRef} id="print-preview-canvas" />
        </div>
        <div class="print-preview-footer">
          <span>
            {previewPages().length > 0
              ? `Page ${previewIndex() + 1} of ${previewPages().length}`
              : 'No pages'}
          </span>
          <div class="print-preview-nav">
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() <= 0}
              onClick={prevPreview}
            >&lsaquo;</button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= previewPages().length - 1}
              onClick={nextPreview}
            >&rsaquo;</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
