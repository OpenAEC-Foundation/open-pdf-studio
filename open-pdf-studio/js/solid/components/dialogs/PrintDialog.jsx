import { createSignal, createMemo, createEffect, on, onMount, batch, For, Show } from 'solid-js';
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
  normaliseerPapierInfo, effectiefPapier, papierTekst, paginaTekst, bekendVel,
  eigenschappenVooraf, instellingNaEigenschappen, maakPapierVerzoeken, papierVerzoekSleutel,
} from '../../../pdf/print-papier.js';
import {
  berekenPlaatsing, renderDeel, geldigeZoom, ZOOM_MIN, ZOOM_MAX,
} from '../../../pdf/print-plaatsing.js';

// Vak waarin het voorbeeld het vel tekent, in CSS-pixels.
const VOORBEELD_BREEDTE = 300;
const VOORBEELD_HOOGTE = 340;
const MM_PER_PT = 25.4 / 72;

// Twee keuzesets voor de plaatsing zijn gelijk als alle waarden gelijk zijn;
// zo tekent het voorbeeld niet opnieuw als er alleen een nieuw object komt.
function zelfdeKeuzes(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  // Steekt de voorbeeldpagina buiten het vel of buiten het bedrukbare gebied
  // van de printer? '' = niets aan de hand.
  const [afsnijMelding, setAfsnijMelding] = createSignal('');
  // Alleen de laatst gestarte voorbeeldrender tekent (zie renderPreview).
  let voorbeeldBeurt = 0;
  // Papier per printer en per gevraagd papier (papierVerzoekSleutel) zoals
  // Rust het meldt (printer_papier, of het antwoord uit Eigenschappen).
  // Geen sleutel = nog aan het ophalen, null = onbekend.
  const [printerPapier, setPrinterPapier] = createSignal(new Map());
  // Het bedrukbare gebied per printer en per gevraagd papier (zelfde sleutel):
  // marges in mm per oriëntatie, of null als het onbekend is.
  const [printerMarges, setPrinterMarges] = createSignal(new Map());
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

  // Het voorbeeld tekent opnieuw zodra de pagina's, de getoonde pagina, de
  // inhoud of de plaatsing veranderen (effect verderop); de handlers zetten
  // alleen de signalen.
  function updatePreviewPages() {
    const pages = getPrintPages();
    batch(() => {
      setPreviewPages(pages);
      setPreviewIndex(0);
    });
  }

  function zetPaginaMaat(breedtePt, hoogtePt) {
    const oud = paginaMaat();
    if (oud && oud.breedtePt === breedtePt && oud.hoogtePt === hoogtePt) return;
    setPaginaMaat({ breedtePt, hoogtePt });
  }

  // Het voorbeeld: het vel (wit, dunne rand, de verhouding van het papier)
  // passend in het vak, met de pagina erop op de plek en de schaal van de
  // afdruk (print-plaatsing.js, dezelfde regel als de printopdracht). Alleen
  // het deel van de pagina dat op het vel valt wordt gerenderd, scherp op de
  // pixeldichtheid van het scherm. Onbekend papier: de pagina zelf, zoals
  // vóór de schaalkeuze. Alleen de laatst gestarte render tekent; een
  // eerdere die later klaar is gooit zijn werk weg.
  async function renderPreview() {
    const beurt = ++voorbeeldBeurt;
    const doc = getActiveDocument();
    if (!canvasRef || !doc?.pdfDoc) return;
    const pages = previewPages();
    if (pages.length === 0) {
      const ctx = canvasRef.getContext('2d');
      canvasRef.width = VOORBEELD_BREEDTE;
      canvasRef.height = VOORBEELD_HOOGTE;
      canvasRef.style.width = '';
      canvasRef.style.height = '';
      ctx.clearRect(0, 0, VOORBEELD_BREEDTE, VOORBEELD_HOOGTE);
      setPaginaMaat(null);
      setAfsnijMelding('');
      return;
    }

    const pageNum = pages[Math.min(previewIndex(), pages.length - 1)];
    const keuzes = plaatsingKeuzes();
    const markeringen = printContent() === 'doc-and-markups';

    try {
      const page = await doc.pdfDoc.getPage(pageNum);
      if (beurt !== voorbeeldBeurt) return;
      const viewport = page.getViewport(viewportOpties(page, getPageRotation(pageNum)));
      // Vóór het renderen, zodat de kop ook klopt als het voorbeeld mislukt.
      zetPaginaMaat(viewport.width, viewport.height);
      const plaatsing = berekenPlaatsing({
        ...keuzes, pagina: { breedtePt: viewport.width, hoogtePt: viewport.height },
      });
      if (!plaatsing) return;

      // CSS-pixels per mm op het vel, en schermpixels voor een scherp beeld.
      const cssPerMm = Math.min(
        VOORBEELD_BREEDTE / plaatsing.vel.breedteMm, VOORBEELD_HOOGTE / plaatsing.vel.hoogteMm,
      );
      const dpr = window.devicePixelRatio || 1;
      const cssBreedte = Math.max(1, Math.round(plaatsing.vel.breedteMm * cssPerMm));
      const cssHoogte = Math.max(1, Math.round(plaatsing.vel.hoogteMm * cssPerMm));
      const breedte = Math.max(1, Math.round(cssBreedte * dpr));
      const hoogte = Math.max(1, Math.round(cssHoogte * dpr));
      const pxPerMm = breedte / plaatsing.vel.breedteMm;
      const pxPerPt = plaatsing.schaal * MM_PER_PT * pxPerMm;

      const deel = renderDeel(plaatsing, pxPerPt);
      const beeld = deel
        ? await renderPageOffscreen(pageNum, pxPerPt, { deel: deel.px, markeringen })
        : null;
      if (beurt !== voorbeeldBeurt) return;

      canvasRef.width = breedte;
      canvasRef.height = hoogte;
      canvasRef.style.width = `${cssBreedte}px`;
      canvasRef.style.height = `${cssHoogte}px`;
      const ctx = canvasRef.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, breedte, hoogte);
      if (beeld) {
        const r = deel.opVel;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(beeld, r.x * pxPerMm, r.y * pxPerMm, r.breedte * pxPerMm, r.hoogte * pxPerMm);
      }
      if (plaatsing.bekend) {
        const lijn = Math.max(1, Math.round(dpr));
        // Het bedrukbare gebied van de printer: dunne stippellijn.
        const g = plaatsing.bedrukbaar;
        const marge = plaatsing.marges;
        if (marge.links || marge.boven || marge.rechts || marge.onder) {
          ctx.save();
          ctx.strokeStyle = '#9a9a9a';
          ctx.lineWidth = lijn;
          ctx.setLineDash([3 * lijn, 3 * lijn]);
          ctx.strokeRect(
            g.x * pxPerMm + lijn / 2, g.y * pxPerMm + lijn / 2,
            Math.max(lijn, g.breedte * pxPerMm - lijn), Math.max(lijn, g.hoogte * pxPerMm - lijn),
          );
          ctx.restore();
        }
        // Dunne rand om het vel (één CSS-pixel).
        ctx.strokeStyle = '#8c8c8c';
        ctx.lineWidth = lijn;
        ctx.strokeRect(lijn / 2, lijn / 2, breedte - lijn, hoogte - lijn);
      }
      // Buiten het vel weegt zwaarder dan buiten het bedrukbare gebied.
      setAfsnijMelding(!plaatsing.bekend ? ''
        : plaatsing.afgesneden ? t('print.pageClipped')
          : plaatsing.buitenBedrukbaar ? t('print.pageOutsidePrintable') : '');
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  function prevPreview() {
    if (previewIndex() > 0) setPreviewIndex(previewIndex() - 1);
  }

  function nextPreview() {
    if (previewIndex() < previewPages().length - 1) setPreviewIndex(previewIndex() + 1);
  }

  function onRangeChange(range) {
    setActiveRange(range);
    updatePreviewPages();
  }

  function onSubsetChange(subset) {
    setActiveSubset(subset);
    updatePreviewPages();
  }

  function onReverseChange(checked) {
    setReverseOrder(checked);
    updatePreviewPages();
  }

  function onCustomPagesChange(value) {
    setCustomPages(value);
    if (activeRange() === 'custom') updatePreviewPages();
  }

  function onPrintContentChange(value) {
    setPrintContent(value);
  }

  // Paginazoom: tijdens het typen alleen een geldige waarde overnemen (anders
  // maakt het tussenstadium "1" van "10" er meteen 10 van en typ je "100");
  // bij verlaten of Enter begrenzen op 10..400.
  function onZoomInput(e) {
    const n = Number.parseInt(e.target.value, 10);
    if (Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX) setZoom(n);
  }

  function onZoomChange(e) {
    const n = Number.parseInt(e.target.value, 10);
    const geldig = geldigeZoom(Number.isFinite(n) ? n : zoom());
    setZoom(geldig);
    e.target.value = String(geldig);
  }

  // Het papier dat print_pdf nu naar de printer zou sturen ('printer' = het
  // papier aan de printer laten). Volgt de Pagina-instelling.
  const gevraagdPapier = createMemo(() => {
    paginaInstellingVersie();
    return printArgumenten({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
    }).papier;
  });

  function zetPrinterPapier(printer, papier, info) {
    setPrinterPapier((oud) => new Map(oud).set(papierVerzoekSleutel(printer, papier), info));
  }

  // Het vel dat de volgende afdruk op deze printer echt krijgt, gegeven het
  // papier uit de Pagina-instelling: het papier van de printer als de
  // Pagina-instelling dat aan de printer laat, of als de driver het gevraagde
  // formaat niet aankan. Alleen het antwoord voor de nog gekozen printer en
  // het nog gevraagde papier telt; een fout of null = onbekend.
  async function haalPrinterPapier(printer, papier) {
    const nr = papierVerzoeken.begin();
    let info = null;
    try {
      info = normaliseerPapierInfo(await invoke('printer_papier', { printer, papier }));
    } catch (e) {
      console.warn('printer_papier failed:', e);
    }
    if (papierVerzoeken.actueel(nr, printer, selectedPrinter()) && papier === gevraagdPapier()) {
      zetPrinterPapier(printer, papier, info);
    }
  }

  // Het bedrukbare gebied van de printer voor dat vel, per oriëntatie
  // (printer_bedrukbaar). Apart van het papier: de eerste meting op een
  // slapende netwerkprinter kan tientallen seconden duren (koude driver) en
  // de kop mag daar niet op wachten. Onbekend (nog onderweg, Linux/macOS, of
  // een driver die niets meldt) = marge 0, zoals vóór deze meting.
  async function haalPrinterBedrukbaar(printer, papier) {
    let marges = null;
    try {
      marges = await invoke('printer_bedrukbaar', { printer, papier });
    } catch (e) {
      console.warn('printer_bedrukbaar failed:', e);
    }
    setPrinterMarges((oud) => new Map(oud).set(papierVerzoekSleutel(printer, papier), marges || null));
  }

  createEffect(on([selectedPrinter, gevraagdPapier], ([printer, papier]) => {
    if (!printer) return;
    haalPrinterPapier(printer, papier);
    if (!printerMarges().has(papierVerzoekSleutel(printer, papier))) haalPrinterBedrukbaar(printer, papier);
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
      if (selectedPrinter() === printer) haalPrinterPapier(printer, gevraagdPapier());
      return;
    }
    papierVerzoeken.vervallen();
    // Wat eerder voor deze printer is gemeld klopt niet meer: Rust bewaart nu
    // een andere DEVMODE. Het antwoord geldt voor het papier van de printer.
    setPrinterPapier((oud) => new Map(
      [...oud].filter(([sleutel]) => !sleutel.startsWith(`${printer}\n`)),
    ).set(papierVerzoekSleutel(printer, 'printer'), info));
    // Het bedrukbare gebied hoort bij die DEVMODE en wordt opnieuw gemeten.
    setPrinterMarges((oud) => new Map([...oud].filter(([sleutel]) => !sleutel.startsWith(`${printer}\n`))));
    stelPaginaInstellingIn(instellingNaEigenschappen({
      papierInfo: antwoord,
      docId,
      huidig: getPageSetupSettings(),
      vooraf,
    }));
    // Blijft de Pagina-instelling op een formaat staan, dan opnieuw vragen wat
    // de driver daar met de nieuwe eigenschappen van maakt.
    if (selectedPrinter() === printer) {
      if (gevraagdPapier() !== 'printer') haalPrinterPapier(printer, gevraagdPapier());
      haalPrinterBedrukbaar(printer, gevraagdPapier());
    }
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
    // Schaal en plek zoals het voorbeeld ze toont (vóór close(): de keuzes
    // komen uit de signalen van deze dialoog).
    const keuzes = plaatsingKeuzes();
    savePreferences();
    close();
    // Oriëntatie en papier: Automatisch draaien en de Pagina-instelling
    // bereiken nu echt de printer (zie print-pagina-instelling.js).
    const { orientatie, papier } = printArgumenten({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
    });
    runPrintJob({
      pages,
      copies: numCopies,
      printer,
      orientatie,
      papier,
      vel: keuzes.papier,
      schaling: keuzes.schaling,
      zoom: keuzes.zoom,
      centreren: keuzes.centreren,
      // "Afdrukken: Document" laat de markeringen ook echt weg.
      inhoud: printContent(),
    });
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
  });

  const currentPageNum = props.data?.currentPage || getActiveDocument()?.currentPage || 1;

  // Het papier van de volgende afdruk (zie print-papier.js). De versie van de
  // Pagina-instelling maakt dit reactief op OK daar en op een keuze uit
  // Eigenschappen.
  const effectief = createMemo(() => {
    paginaInstellingVersie();
    const printer = selectedPrinter();
    const papiers = printerPapier();
    const gevraagd = gevraagdPapier();
    const sleutel = papierVerzoekSleutel(printer, gevraagd);
    // Geen printer of nog niet opgehaald → undefined (nog niets tonen).
    const antwoord = printer && papiers.has(sleutel) ? papiers.get(sleutel) : undefined;
    return effectiefPapier({
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
      autoRotate: autoRotate(),
      // Het antwoord hoort bij het papier waarmee erom gevraagd is.
      printerPapier: gevraagd === 'printer' ? antwoord : undefined,
      opdrachtPapier: gevraagd === 'printer' ? undefined : antwoord,
      pagina: paginaMaat(),
    });
  });

  // Kop van het voorbeeld: het papier naast de maat van de getoonde pagina.
  const papierKop = createMemo(() => {
    const e = effectief();
    // Onbekend papier = de standaard van de printer (dezelfde tekst als in de
    // Pagina-instelling).
    const tekst = papierTekst(e, t('pageSetup.printerDefault'));
    if (!tekst) return '';
    // De driver kan het gevraagde formaat niet aan: zeggen waarop er wel
    // geprint wordt, en welk formaat niet beschikbaar is.
    return e.geweigerd
      ? t('print.paperFallback', { paper: tekst, requested: e.geweigerd })
      : t('print.paperLabel', { paper: tekst });
  });

  // Alles wat het vel en de plek van de pagina bepaalt behalve de pagina zelf
  // (print-plaatsing.js): het papier als het bekend is, de oriëntatie van het
  // vel (Automatisch draaien en de Pagina-instelling, zoals print_pdf), het
  // schaaltype, de zoom en centreren. Het voorbeeld en de printopdracht
  // gebruiken dezelfde keuzes.
  const plaatsingKeuzes = createMemo(() => {
    paginaInstellingVersie();
    const vel = bekendVel(effectief());
    const marges = printerMarges().get(papierVerzoekSleutel(selectedPrinter(), gevraagdPapier())) || null;
    return {
      papier: vel && { ...vel, bedrukbaar: marges },
      orientatie: printArgumenten({
        autoRotate: autoRotate(),
        paginaInstelling: getPageSetupSettings(),
        docId: getActiveDocument()?.id ?? null,
      }).orientatie,
      schaling: scaling(),
      zoom: geldigeZoom(zoom()),
      centreren: autoCenter(),
    };
  }, undefined, { equals: zelfdeKeuzes });

  // Voorbeeld opnieuw tekenen bij elke wijziging van de pagina's, de getoonde
  // pagina, de inhoud (met of zonder markeringen) of de plaatsing: schaaltype,
  // zoom, centreren, automatisch draaien, Pagina-instelling en printerpapier.
  createEffect(on([previewPages, previewIndex, printContent, plaatsingKeuzes], () => {
    renderPreview();
  }, { defer: true }));

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
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              value={zoom()}
              disabled={scaling() !== 'custom-scale'}
              onInput={onZoomInput}
              onChange={onZoomChange}
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
        <Show when={afsnijMelding()}>
          <div class="print-preview-warning">{afsnijMelding()}</div>
        </Show>
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
              onClick={() => setPreviewIndex(0)}
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
              onClick={() => setPreviewIndex(previewPages().length - 1)}
              title={t('print.lastPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 7,5" fill="currentColor"/><rect x="7" y="1" width="2" height="8" fill="currentColor"/></svg></button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
