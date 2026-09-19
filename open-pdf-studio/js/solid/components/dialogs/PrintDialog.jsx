import { createSignal, createMemo, createEffect, on, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument, getPageRotation } from '../../../core/state.js';
import { invoke } from '../../../core/platform.js';
import { parsePageRange, renderPageOffscreen } from '../../../pdf/exporter.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { loadPrinters, printerList as cachedPrinters, defaultPrinterName, printerErrorMessage } from '../../stores/printerStore.js';
import { runPrintJob } from '../../../pdf/print-job.js';
import { savePreferences } from '../../../core/preferences.js';
import { herstelPrintInstellingen, kiesStartPrinter } from '../../stores/print-instellingen.js';
import { printArgumenten } from '../../../pdf/print-pagina-instelling.js';
import { getPageSetupSettings, stelPaginaInstellingIn, paginaInstellingVersie } from './PageSetupDialog.jsx';
import { viewportOpties } from '../../../pdf/getoonde-pagina.js';
import {
  normaliseerPapierInfo, effectiefPapier, papierTekst, paginaTekst,
  eigenschappenVooraf, instellingNaEigenschappen, maakPapierVerzoeken,
} from '../../../pdf/print-papier.js';

export default function PrintDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  // Settings of the last print action; every field is validated and falls
  // back to the dialog default (see stores/print-instellingen.js).
  const bewaard = herstelPrintInstellingen(state.preferences?.printSettings);
  // Once the user picks a printer, the background refresh must not override it.
  let gebruikerKoosPrinter = false;

  const [printerList, setPrinterList] = createSignal([]);
  const [selectedPrinter, setSelectedPrinter] = createSignal('');
  const [printerStatus, setPrinterStatus] = createSignal(`${t('print.status')} `);
  const [printerType, setPrinterType] = createSignal(`${t('print.type')} `);
  const [copies, setCopies] = createSignal(bewaard.copies);
  const [collate, setCollate] = createSignal(bewaard.collate);
  const [activeRange, setActiveRange] = createSignal(bewaard.range);
  const [customPages, setCustomPages] = createSignal(bewaard.customPages);
  const [activeSubset, setActiveSubset] = createSignal(bewaard.subset);
  const [reverseOrder, setReverseOrder] = createSignal(bewaard.reverseOrder);
  const [scaling, setScaling] = createSignal(bewaard.scaling);
  const [zoom, setZoom] = createSignal(bewaard.zoom);
  const [autoRotate, setAutoRotate] = createSignal(bewaard.autoRotate);
  const [autoCenter, setAutoCenter] = createSignal(bewaard.autoCenter);
  const [printContent, setPrintContent] = createSignal(bewaard.content);
  const [printAsImage, setPrintAsImage] = createSignal(bewaard.asImage);
  const [statusMessage, setStatusMessage] = createSignal('');
  const [statusType, setStatusType] = createSignal('');
  const [printDisabled, setPrintDisabled] = createSignal(false);
  const [previewPages, setPreviewPages] = createSignal([]);
  const [previewIndex, setPreviewIndex] = createSignal(0);
  // Maat van de getoonde voorbeeldpagina in pt (inclusief draaiing), of null.
  const [paginaMaat, setPaginaMaat] = createSignal(null);
  // Papier per printer zoals Rust het meldt (printer_papier, of het antwoord
  // uit Eigenschappen). Geen sleutel = nog aan het ophalen, null = onbekend.
  const [printerPapier, setPrinterPapier] = createSignal(new Map());
  const papierVerzoeken = maakPapierVerzoeken();
  let eigenschappenOpen = false;

  let canvasRef;

  const close = () => closeDialog('print');

  function updatePrinterInfo(name) {
    const printer = printerList().find(p => p.Name === name);
    if (printer) {
      setPrinterStatus(`${t('print.status')} ${printer.Status || 'Ready'}`);
      setPrinterType(`${t('print.type')} ${printer.DriverName || printer.Name || ''}`);
    } else {
      setPrinterStatus(`${t('print.status')} `);
      setPrinterType(`${t('print.type')} `);
    }
  }

  function getPrintPages() {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) return [];
    const totalPages = doc.pdfDoc.numPages;
    let pages = [];

    if (activeRange() === 'all') {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (activeRange() === 'current') {
      const cp = props.data?.currentPage || getActiveDocument()?.currentPage || 1;
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
    return `${pages.length} ${t('print.pagesToPrint')}`;
  });

  function updatePreviewPages() {
    const pages = getPrintPages();
    setPreviewPages(pages);
    setPreviewIndex(0);
  }

  async function renderPreview() {
    const doc = getActiveDocument();
    if (!canvasRef || !doc?.pdfDoc) return;
    const pages = previewPages();
    if (pages.length === 0) {
      const ctx = canvasRef.getContext('2d');
      canvasRef.width = 300;
      canvasRef.height = 350;
      ctx.clearRect(0, 0, 300, 350);
      setPaginaMaat(null);
      return;
    }

    const idx = previewIndex();
    const pageNum = pages[Math.min(idx, pages.length - 1)];

    try {
      const page = await doc.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const viewport = page.getViewport(viewportOpties(page, extraRotation));
      // Vóór het renderen, zodat de kop ook klopt als het voorbeeld mislukt;
      // alleen als intussen niet al naar een andere pagina is gebladerd.
      const nuGetoond = previewPages();
      if (nuGetoond[Math.min(previewIndex(), nuGetoond.length - 1)] === pageNum) {
        setPaginaMaat({ breedtePt: viewport.width, hoogtePt: viewport.height });
      }

      const maxW = 300;
      const maxH = 350;
      const scaleW = maxW / viewport.width;
      const scaleH = maxH / viewport.height;
      const previewScale = Math.min(scaleW, scaleH);

      const previewViewport = page.getViewport(viewportOpties(page, extraRotation, previewScale));

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

  function zetPrinterPapier(printer, info) {
    setPrinterPapier((oud) => new Map(oud).set(printer, info));
  }

  // Het papier dat de volgende afdruk op deze printer neemt als de
  // Pagina-instelling het papier aan de printer laat. Alleen het antwoord
  // voor de nog gekozen printer telt; een fout of null = onbekend.
  async function haalPrinterPapier(printer) {
    const nr = papierVerzoeken.begin();
    let info = null;
    try {
      info = normaliseerPapierInfo(await invoke('printer_papier', { printer }));
    } catch (e) {
      console.warn('printer_papier failed:', e);
    }
    if (papierVerzoeken.actueel(nr, printer, selectedPrinter())) zetPrinterPapier(printer, info);
  }

  createEffect(on(selectedPrinter, (printer) => {
    if (printer) haalPrinterPapier(printer);
  }));

  // Windows: de eigenschappen van de driver, modaal; het antwoord komt pas na
  // OK/Annuleren. Het venster opent met het papier en de oriëntatie die de
  // volgende afdruk krijgt (eigenschappenVooraf), zodat het hetzelfde toont
  // als de kop. OK → Rust bewaart de DEVMODE voor deze printer (alleen deze
  // sessie); wat de gebruiker aan papier of oriëntatie veranderde wordt de
  // Pagina-instelling van dit document, zodat kop, Pagina-instelling en
  // print_pdf hetzelfde bedoelen. OK zonder zo'n wijziging laat de
  // Pagina-instelling staan. Annuleren, of Linux/macOS
  // (systeeminstellingen) → null: niets verandert.
  async function openPrinterProperties() {
    const printer = selectedPrinter();
    if (!printer || eigenschappenOpen) return;
    eigenschappenOpen = true;
    const docId = getActiveDocument()?.id ?? null;
    const vooraf = eigenschappenVooraf({
      paginaInstelling: getPageSetupSettings(),
      docId,
      autoRotate: autoRotate(),
      pagina: paginaMaat(),
    });
    let antwoord = null;
    try {
      antwoord = await invoke('open_printer_properties', {
        printer, papier: vooraf.papier, orientatie: vooraf.orientatie,
      });
    } catch (e) {
      console.error('Failed to open printer properties:', e);
    } finally {
      eigenschappenOpen = false;
    }
    const info = normaliseerPapierInfo(antwoord);
    if (!info) {
      // Annuleren verandert niets; opnieuw vragen kost niets en houdt de
      // kop eerlijk, ook als er toch iets bewaard werd.
      if (selectedPrinter() === printer) haalPrinterPapier(printer);
      return;
    }
    papierVerzoeken.vervallen();
    zetPrinterPapier(printer, info);
    stelPaginaInstellingIn(instellingNaEigenschappen({
      papierInfo: antwoord,
      docId,
      huidig: getPageSetupSettings(),
      vooraf,
    }));
  }

  async function openPageSetup() {
    const { showPageSetupDialog } = await import('../../../ui/chrome/dialogs.js');
    showPageSetupDialog();
  }

  function executePrint() {
    if (!selectedPrinter()) {
      setStatusMessage(t('print.noPrinterSelected'));
      setStatusType('error');
      return;
    }
    const pages = getPrintPages();
    if (pages.length === 0) {
      setStatusMessage(t('print.noPagesToPrint'));
      setStatusType('error');
      return;
    }
    // Non-modal: close the dialog NOW and let the job render + spool in the
    // background, reporting via the floating progress bar. The user keeps
    // working meanwhile.
    const printer = selectedPrinter();
    const numCopies = Math.max(1, copies());
    // Remember every choice for the next print action.
    state.preferences.printSettings = {
      printer,
      copies: numCopies,
      collate: collate(),
      range: activeRange(),
      customPages: customPages(),
      subset: activeSubset(),
      reverseOrder: reverseOrder(),
      scaling: scaling(),
      zoom: zoom(),
      autoRotate: autoRotate(),
      autoCenter: autoCenter(),
      content: printContent(),
      asImage: printAsImage(),
    };
    savePreferences();
    close();
    // Oriëntatie en papier: Automatisch draaien en de Pagina-instelling
    // bereiken nu echt de printer (zie print-pagina-instelling.js).
    const { orientatie, papier } = printArgumenten({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
    });
    runPrintJob({ pages, copies: numCopies, printer, orientatie, papier });
  }

  onMount(async () => {
    // Instant: seed from the cache lazy-loaded at startup so the default
    // printer is already selected without waiting on enumeration.
    const cached = cachedPrinters();
    if (cached.length) {
      setPrinterList(cached);
      const name = kiesStartPrinter(cached, bewaard.printer, defaultPrinterName());
      setSelectedPrinter(name);
      updatePrinterInfo(name);
    }
    // Refresh in the background (covers a first open before startup finished).
    const fresh = await loadPrinters(true);
    if (fresh.length) {
      setPrinterList(fresh);
      // The last used printer may only show up in the fresh list (first open
      // before the startup enumeration finished).
      if (!gebruikerKoosPrinter) {
        const name = kiesStartPrinter(fresh, bewaard.printer, defaultPrinterName());
        setSelectedPrinter(name);
        updatePrinterInfo(name);
      }
      setPrintDisabled(false);
    } else if (!cached.length) {
      setPrintDisabled(true);
    }

    updatePreviewPages();
    renderPreview();
  });

  const currentPageNum = props.data?.currentPage || getActiveDocument()?.currentPage || 1;

  // Kop van het voorbeeld: het papier (zie print-papier.js) naast de maat van
  // de getoonde pagina. De versie van de Pagina-instelling maakt dit reactief
  // op OK daar en op een keuze uit Eigenschappen.
  const papierKop = createMemo(() => {
    paginaInstellingVersie();
    const printer = selectedPrinter();
    const papiers = printerPapier();
    const effectief = effectiefPapier({
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
      autoRotate: autoRotate(),
      // Geen printer of nog niet opgehaald → undefined (nog niets tonen).
      printerPapier: printer && papiers.has(printer) ? papiers.get(printer) : undefined,
      pagina: paginaMaat(),
    });
    // Onbekend papier = de standaard van de printer (dezelfde tekst als in de
    // Pagina-instelling).
    const tekst = papierTekst(effectief, t('pageSetup.printerDefault'));
    return tekst ? t('print.paperLabel', { paper: tekst }) : '';
  });

  const paginaKop = createMemo(() => {
    const maat = paginaMaat();
    const tekst = maat ? paginaTekst(maat.breedtePt, maat.hoogtePt) : null;
    return tekst ? t('print.pageSizeLabel', { size: tekst }) : '';
  });

  const footer = (
    <>
      <Show when={statusMessage()}>
        <div class={`print-status ${statusType()}`}>
          {statusMessage()}
        </div>
      </Show>
      <div class="print-footer-bar">
        <div class="print-footer-left">
          <span class="print-page-info">{pageInfo()}</span>
        </div>
        <div class="print-footer-right">
          <button
            class="pref-btn pref-btn-primary"
            disabled={printDisabled()}
            onClick={executePrint}
          >{tCommon('print')}</button>
          <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
        </div>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('print.title')}
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
          <legend>{t('print.printer')}</legend>
          <div class="print-printer-layout">
            <div class="print-printer-left">
              <div class="print-row">
                <label class="print-label">{t('print.name')}</label>
                <select
                  class="print-select"
                  value={selectedPrinter()}
                  onChange={(e) => {
                    gebruikerKoosPrinter = true;
                    setSelectedPrinter(e.target.value);
                    updatePrinterInfo(e.target.value);
                  }}
                >
                  <For each={printerList()}>
                    {(printer) => (
                      /* selected-attribute per option: the list arrives async,
                         so a bare value= on the <select> can be applied before
                         the options exist and silently falls back to option 0
                         — the OS default would never show as preselected. */
                      <option value={printer.Name} selected={printer.Name === selectedPrinter()}>{printer.Name}</option>
                    )}
                  </For>
                </select>
              </div>
              <div class="print-row print-printer-detail-row">
                <span class="print-printer-status">{printerStatus()}</span>
                <span class="print-printer-sep">|</span>
                <span class="print-printer-type">{printerType()}</span>
              </div>
              {/* Without this the user cannot tell "no printers installed"
                  from "the query failed", and neither can a bug report. */}
              <Show when={printerErrorMessage()}>
                <div class="print-row print-printer-error">{printerErrorMessage()}</div>
              </Show>
            </div>
            <div class="print-printer-right">
              <button class="print-printer-action-btn" onClick={openPrinterProperties}>
                {t('print.propertiesBtn')}
              </button>
              <button class="print-printer-action-btn" onClick={openPageSetup}>
                {t('print.pageSetupBtn')}
              </button>
            </div>
          </div>
          <div class="print-row">
            <label class="print-label">{t('print.copies')}</label>
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
              /> {t('print.collate')}
            </label>
          </div>
        </fieldset>

        {/* Page Range */}
        <fieldset class="print-group">
          <legend>{t('print.pageRange')}</legend>
          <div class="print-row print-pages-row">
            <div class="print-page-btns">
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'all' }}
                onClick={() => onRangeChange('all')}
              >{t('print.all')}</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'current' }}
                onClick={() => onRangeChange('current')}
              >{`${t('print.current')} ${currentPageNum}`}</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'custom' }}
                onClick={() => onRangeChange('custom')}
              >{t('print.custom')}</button>
            </div>
          </div>
          <div class="print-row print-custom-row">
            <label class="print-label">{t('print.pagesLabel')}</label>
            <input
              type="text"
              class="print-custom-input"
              placeholder={t('print.pagesPlaceholder')}
              disabled={activeRange() !== 'custom'}
              value={customPages()}
              onInput={(e) => onCustomPagesChange(e.target.value)}
            />
          </div>
          <div class="print-row">
            <label class="print-label">{t('print.subset')}</label>
            <div class="print-subset-btns">
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'all' }}
                onClick={() => onSubsetChange('all')}
              >{t('print.all')}</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'odd' }}
                onClick={() => onSubsetChange('odd')}
              >{t('print.odd')}</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'even' }}
                onClick={() => onSubsetChange('even')}
              >{t('print.even')}</button>
            </div>
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={reverseOrder()}
                onChange={(e) => onReverseChange(e.target.checked)}
              /> {t('print.reverseOrder')}
            </label>
          </div>
        </fieldset>

        {/* Page Placement and Scaling */}
        <fieldset class="print-group">
          <legend>{t('print.pagePlacement')}</legend>
          <div class="print-row">
            <label class="print-label">{t('print.typeLabel')}</label>
            <select
              class="print-select"
              value={scaling()}
              onChange={(e) => setScaling(e.target.value)}
            >
              <option value="fit">{t('print.fit')}</option>
              <option value="actual">{t('print.actualSize')}</option>
              <option value="shrink">{t('print.shrinkToPrintable')}</option>
              <option value="custom-scale">{t('print.customScale')}</option>
            </select>
          </div>
          <div class="print-row print-zoom-row">
            <label class="print-label">{t('print.pageZoom')}</label>
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
              /> {t('print.autoRotate')}
            </label>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoCenter()}
                onChange={(e) => setAutoCenter(e.target.checked)}
              /> {t('print.autoCenter')}
            </label>
          </div>
        </fieldset>

        {/* Advanced Print Options */}
        <fieldset class="print-group">
          <legend>{t('print.advancedOptions')}</legend>
          <div class="print-row">
            <label class="print-label">{t('print.printLabel')}</label>
            <select
              class="print-select"
              value={printContent()}
              onChange={(e) => onPrintContentChange(e.target.value)}
            >
              <option value="doc-and-markups">{t('print.documentAndMarkups')}</option>
              <option value="doc-only">{t('print.document')}</option>
            </select>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={printAsImage()}
                onChange={(e) => setPrintAsImage(e.target.checked)}
              /> {t('print.printAsImage')}
            </label>
          </div>
        </fieldset>
      </div>

      <div class="print-preview-panel">
        <div class="print-preview-header">
          <Show when={papierKop()}>
            <span class="print-preview-paper">{papierKop()}</span>
          </Show>
          <Show when={papierKop() && paginaKop()}>
            <span class="print-printer-sep">{' | '}</span>
          </Show>
          <Show when={paginaKop()}>
            <span class="print-preview-page">{paginaKop()}</span>
          </Show>
        </div>
        <div class="print-preview-container">
          <canvas ref={canvasRef} id="print-preview-canvas" />
        </div>
        <div class="print-preview-footer">
          <span>
            {previewPages().length > 0
              ? t('print.pageOf', { current: previewIndex() + 1, total: previewPages().length })
              : t('print.noPages')}
          </span>
          <div class="print-preview-nav">
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() <= 0}
              onClick={() => { setPreviewIndex(0); renderPreview(); }}
              title={t('print.firstPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="2" height="8" fill="currentColor"/><polygon points="9,1 9,9 3,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() <= 0}
              onClick={prevPreview}
              title={t('print.prevPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="9,1 9,9 1,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= previewPages().length - 1}
              onClick={nextPreview}
              title={t('print.nextPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 9,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= previewPages().length - 1}
              onClick={() => { setPreviewIndex(previewPages().length - 1); renderPreview(); }}
              title={t('print.lastPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 7,5" fill="currentColor"/><rect x="7" y="1" width="2" height="8" fill="currentColor"/></svg></button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
