import { createSignal, createMemo, createEffect, on, onMount, onCleanup, batch, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import NumberStepper from '../NumberStepper.jsx';
import PosterOverview from './PosterOverview.jsx';
import { posterSheetOverlaps } from '../../../pdf/print-poster-grid.js';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument, getPageRotation } from '../../../core/state.js';
import { invoke, saveFileDialog } from '../../../core/platform.js';
import { printPaginaBereik } from '../../../pdf/print-bereik.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { loadPrinters, printerList as cachedPrinters, defaultPrinterName, printerErrorMessage } from '../../stores/printerStore.js';
import { runPrintJob, slaPrintOpAlsPdf, renderPrintBeeld } from '../../../pdf/print-job.js';
import {
  rasterVan, isMeerPerBlad, voorbeeldMeerPerBlad, aantalVellen, paginasOpVel,
  isFlyer, flyerRaster, volgordeAanwijzer, beeldInCel, SNIJTEKEN_LIJN_PT, PAGINAVOLGORDES,
} from '../../../pdf/print-meerperblad.js';
import {
  isBoekje, voorbeeldBoekje, boekjeVolgorde, boekjeAfdrukZijden, kruipVoorVel, geldigeKruip, KRUIP_MAX_MM,
  geldigKatern, KATERN_KEUZES,
} from '../../../pdf/print-boekje.js';
import { savePreferences } from '../../../core/preferences.js';
import {
  herstelPrintInstellingen, kiesStartPrinter, printModus, naarModus, MEER_PER_BLAD_KEUZES,
} from '../../stores/print-instellingen.js';
import { printArgumenten, overstemdeStand, vellenStand } from '../../../pdf/print-pagina-instelling.js';
import { getPageSetupSettings, stelPaginaInstellingIn, paginaInstellingVersie } from './PageSetupDialog.jsx';
import { viewportOpties } from '../../../pdf/getoonde-pagina.js';
import {
  normaliseerPapierInfo, effectiefPapier, paginaTekst, bekendVel, velTekst, velNaam, schaalProcent,
  eigenschappenVooraf, instellingNaEigenschappen, maakPapierVerzoeken, papierVerzoekSleutel,
} from '../../../pdf/print-papier.js';
import {
  berekenPlaatsing, renderDeel, geldigeZoom, ZOOM_MIN, ZOOM_MAX,
} from '../../../pdf/print-plaatsing.js';
import {
  DOEL_PDF, isPdfDoel, doelIsGeopend, standaardDoelPad, isBestandsPrinter,
} from '../../../pdf/print-doel.js';
import {
  posterOpties, posterIndeling, posterVellen, posterLabel, posterRandAfsnijding, geldigePosterSchaal, geldigeOverlap,
  POSTER_SCHAAL_MIN, POSTER_SCHAAL_MAX, OVERLAP_MAX_MM, SNIJTEKEN_DIKTE_PT,
} from '../../../pdf/print-poster.js';
import { leesGetalBegin, toonGetal } from '../../../core/getal-invoer.js';
import { KLEUR_MODI, geldigeKleurModus } from '../../../pdf/print-kleur.js';

// Vak waarin het voorbeeld het vel tekent, in CSS-pixels.
const VOORBEELD_BREEDTE = 300;
const VOORBEELD_HOOGTE = 340;
const MM_PER_PT = 25.4 / 72;

// Twee keuzesets voor de plaatsing zijn gelijk als alle waarden gelijk zijn;
// zo tekent het voorbeeld niet opnieuw als er alleen een nieuw object komt.
function zelfdeKeuzes(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// De knoppen voor de paginavolgorde (#607): elk een raster van 2 x 2 met het
// pad van de leesvolgorde en een pijlpunt, zoals celVoorVolgnummer de
// pagina's legt. Alleen uitleg; de afdruk verandert er niet door.
const VOLGORDE_PADEN = {
  horizontal: { pad: 'M3 4 H13 L3 12 H10', punt: '14,12 10,9.5 10,14.5' },
  'horizontal-reversed': { pad: 'M13 4 H3 L13 12 H6', punt: '2,12 6,9.5 6,14.5' },
  vertical: { pad: 'M4 3 V13 L12 3 V10', punt: '12,14 9.5,10 14.5,10' },
  'vertical-reversed': { pad: 'M12 3 V13 L4 3 V10', punt: '4,14 1.5,10 6.5,10' },
};
// De kleurmodi van de afdruk (#754, print-kleur.js) met hun tekst.
const KLEUR_TEKST = {
  color: 'print.colorModeColor',
  grayscale: 'print.colorModeGrayscale',
  bw: 'print.colorModeBlackWhite',
};

const VOLGORDE_TEKST = {
  horizontal: 'print.orderHorizontal',
  'horizontal-reversed': 'print.orderHorizontalReversed',
  vertical: 'print.orderVertical',
  'vertical-reversed': 'print.orderVerticalReversed',
};

function VolgordeIcoon(props) {
  const v = () => VOLGORDE_PADEN[props.volgorde] || VOLGORDE_PADEN.horizontal;
  return (
    <svg class="print-order-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="currentColor" stroke-opacity="0.35" />
      <path d={v().pad} fill="none" stroke="currentColor" stroke-width="1.4" />
      <polygon points={v().punt} fill="currentColor" />
    </svg>
  );
}

// De afdrukwijzen bovenaan de plaatsing (#607), elk een knop: label en uitleg.
const MODUS_KNOPPEN = [
  { waarde: 'normal', label: 'print.modeNormal', uitleg: 'print.perSheetOne' },
  { waarde: 'multiple', label: 'print.modeMultiple', uitleg: 'print.pagesPerSheet' },
  { waarde: 'flyer', label: 'print.modeFlyer', uitleg: 'print.perSheetFlyer' },
  { waarde: 'booklet', label: 'print.perSheetBooklet', uitleg: 'print.perSheetBooklet' },
  { waarde: 'poster', label: 'print.modePoster', uitleg: 'print.poster' },
];

export default function PrintDialog(props) {
  const { t, language } = useTranslation('dialogs');
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
  // Kleur, grijswaarden of zwart-wit (#754): voorbeeld en afdruk gelijk.
  const [colorMode, setColorMode] = createSignal(bewaard.colorMode);
  const [perSheet, setPerSheet] = createSignal(bewaard.perSheet);
  const [sheetCols, setSheetCols] = createSignal(bewaard.sheetCols);
  const [sheetRows, setSheetRows] = createSignal(bewaard.sheetRows);
  const [sheetOrder, setSheetOrder] = createSignal(bewaard.sheetOrder);
  const [sheetBorder, setSheetBorder] = createSignal(bewaard.sheetBorder);
  const [posterScale, setPosterScale] = createSignal(bewaard.posterScale);
  const [posterOverlap, setPosterOverlap] = createSignal(bewaard.posterOverlap);
  const [posterCutMarks, setPosterCutMarks] = createSignal(bewaard.posterCutMarks);
  const [posterLabels, setPosterLabels] = createSignal(bewaard.posterLabels);
  const [posterOnlyLarge, setPosterOnlyLarge] = createSignal(bewaard.posterOnlyLarge);
  // Kleine buitenranden afsnijden (#855): standaard aan, zodat een A1 op
  // randloze A3 2 x 2 blijft; uit = alle inhoud, desnoods een extra vel.
  // Alleen voor deze afdruk: niet bewaard, bij heropenen weer aan.
  const [posterEdgeCrop, setPosterEdgeCrop] = createSignal(true);
  const [flyerCount, setFlyerCount] = createSignal(bewaard.flyerCount);
  const [flyerCutMarks, setFlyerCutMarks] = createSignal(bewaard.flyerCutMarks);
  const [bookletSheets, setBookletSheets] = createSignal(bewaard.bookletSheets);
  const [bookletBinding, setBookletBinding] = createSignal(bewaard.bookletBinding);
  const [bookletSides, setBookletSides] = createSignal(bewaard.bookletSides);
  const [bookletRotateBack, setBookletRotateBack] = createSignal(bewaard.bookletRotateBack);
  const [bookletCreep, setBookletCreep] = createSignal(bewaard.bookletCreep);
  // De afdrukwijze (#607): volgt uit de schaalkeuze en het aantal per vel
  // (printModus); een klik op een wijze zet die twee (naarModus). Onthouden
  // wordt de laatste gewone schaal en het laatste raster, voor de terugweg.
  const modus = createMemo(() => printModus({ scaling: scaling(), perSheet: perSheet() }));
  let laatsteSchaling = bewaard.scaling === 'poster' ? 'fit' : bewaard.scaling;
  let laatsteMeer = MEER_PER_BLAD_KEUZES.includes(bewaard.perSheet) ? bewaard.perSheet : '2';
  createEffect(() => {
    if (scaling() !== 'poster') laatsteSchaling = scaling();
    if (MEER_PER_BLAD_KEUZES.includes(perSheet())) laatsteMeer = perSheet();
  });
  function kiesModus(waarde) {
    const nieuw = naarModus(waarde, { scaling: scaling(), perSheet: perSheet() }, {
      meer: laatsteMeer, schaling: laatsteSchaling,
    });
    batch(() => {
      setScaling(nieuw.scaling);
      setPerSheet(nieuw.perSheet);
    });
  }
  // Posterafdruk (Type "Poster", print-poster.js): de tegelkeuzes, of null.
  // De poster vervangt de schaalkeuze én het aantal pagina's per vel.
  const poster = createMemo(() => (scaling() === 'poster'
    ? posterOpties({
      schaal: posterScale(),
      overlap: posterOverlap(),
      snijtekens: posterCutMarks(),
      labels: posterLabels(),
      alleenGroot: posterOnlyLarge(),
      randAfsnijden: posterEdgeCrop(),
    })
    : null), undefined, { equals: zelfdeKeuzes });
  // Boekje (print-boekje.js): twee pagina's per liggend vel in genietvolgorde.
  // Een keuze in "Pagina's per vel", dus nooit samen met meer per vel; de
  // poster gaat voor.
  const boekje = createMemo(() => !poster() && isBoekje(perSheet()));
  // Vellen per katern van een boekje (#607); 0 = één boekje.
  const katern = createMemo(() => (boekje() ? geldigKatern(bookletSheets()) : 0));
  // Folder (#607): kopieën van dezelfde pagina op elk vel, met dezelfde vel-
  // en celregels als meerdere pagina's per vel. Ook een keuze in "Pagina's
  // per vel"; de poster gaat voor.
  const flyer = createMemo(() => !poster() && isFlyer(perSheet()));
  // Meerdere pagina's per vel (of een folder), of null bij één per vel (en
  // bij een poster of een boekje). Een vast aantal of een folder laat het
  // raster meedraaien met het vel (draaibaar); een eigen raster blijft zoals
  // getypt. Automatisch draaien (paginaDraaien, #623) laat een pagina een
  // kwartslag in haar cel draaien als ze zo groter wordt; uit draait de inhoud
  // nooit. Een memo met waardevergelijking: het voorbeeld tekent alleen
  // opnieuw als de keuze echt verandert.
  const meerPerBlad = createMemo(() => {
    if (poster() || boekje()) return null;
    if (flyer()) {
      return {
        ...flyerRaster(flyerCount()), volgorde: 'horizontal', rand: false, snijtekens: flyerCutMarks(),
        paginaDraaien: autoRotate(),
      };
    }
    const raster = rasterVan({ perBlad: perSheet(), kolommen: sheetCols(), rijen: sheetRows() });
    return isMeerPerBlad(raster)
      ? {
        ...raster, volgorde: sheetOrder(), rand: sheetBorder(), draaibaar: perSheet() !== 'custom',
        paginaDraaien: autoRotate(),
      }
      : null;
  }, undefined, { equals: zelfdeKeuzes });
  // Het getoonde vel bij meerdere pagina's per vel (voorbeeldMeerPerBlad), of
  // null: dan toont het voorbeeld één pagina op het vel.
  const [meerVoorbeeld, setMeerVoorbeeld] = createSignal(null);
  const [statusMessage, setStatusMessage] = createSignal('');
  const [statusType, setStatusType] = createSignal('');
  const [printDisabled, setPrintDisabled] = createSignal(false);
  const [previewPages, setPreviewPages] = createSignal([]);
  const [previewIndex, setPreviewIndex] = createSignal(0);
  // De getoonde maat (pt, met draaiing) van elke af te drukken pagina, in
  // printvolgorde: de posterafdruk telt haar vellen per pagina. Alleen
  // opgehaald bij een poster; null = nog onderweg.
  const [posterMaten, setPosterMaten] = createSignal(null);
  let posterMatenBeurt = 0;
  // Hoeveel het voorbeeld er doorbladert: pagina's, vellen bij meerdere
  // pagina's per vel, de zijden van een boekje of de vellen van de poster.
  // Een gewone functie (geen memo): posterVellenLijst staat verderop.
  const voorbeeldTotaal = () => {
    if (poster()) return posterVellenLijst().length;
    if (boekje()) return boekjeZijden().length;
    return aantalVellen(previewPages().length, meerPerBlad());
  };
  // De zijden van het boekje zoals ze naar de printer gaan (#607): rug,
  // kanten, omgekeerde volgorde (Omgekeerde volgorde draait bij een boekje de
  // vellen om, niet de pagina's) en gedraaide achterkanten. Het voorbeeld
  // bladert hierdoor; maakBoekje bouwt dezelfde lijst.
  const boekjeZijden = createMemo(() => (boekje()
    ? boekjeAfdrukZijden(boekjeVolgorde(previewPages().length, katern(), { binding: bookletBinding() }), {
      kanten: bookletSides(), omgekeerd: reverseOrder(), draaiAchter: bookletRotateBack(),
    })
    : []), undefined, { equals: zelfdeKeuzes });
  // Maat van de getoonde voorbeeldpagina in pt (inclusief draaiing), of null.
  const [paginaMaat, setPaginaMaat] = createSignal(null);
  // Steekt de voorbeeldpagina buiten het vel of buiten het bedrukbare gebied
  // van de printer? '' = niets aan de hand.
  const [afsnijMelding, setAfsnijMelding] = createSignal('');
  // Alleen de laatst gestarte voorbeeldrender tekent (zie renderPreview).
  let voorbeeldBeurt = 0;
  onCleanup(() => { voorbeeldBeurt++; posterMatenBeurt++; });
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

  // Het doel "Opslaan als PDF" (print-doel.js): geen printer, geen spooler;
  // de app schrijft de print-PDF zelf weg, met het vel in de gekozen stand.
  const pdfDoel = createMemo(() => isPdfDoel(selectedPrinter()));

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
      // Zoals getypt: volgorde en herhalingen tellen mee (#606).
      pages = printPaginaBereik(customPages(), totalPages);
    }

    if (activeSubset() === 'odd') {
      pages = pages.filter(p => p % 2 === 1);
    } else if (activeSubset() === 'even') {
      pages = pages.filter(p => p % 2 === 0);
    }

    // Bij een boekje draait Omgekeerde volgorde de vellen om (boekjeZijden),
    // niet de pagina's: anders zou het boek achterstevoren gaan.
    if (reverseOrder() && !boekje()) {
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
      setMeerVoorbeeld(null);
      setAfsnijMelding('');
      return;
    }

    const keuzes = plaatsingKeuzes();
    const markeringen = printContent() === 'doc-and-markups';
    const kleur = colorMode();
    if (poster()) {
      setMeerVoorbeeld(null);
      await renderPosterVoorbeeld(beurt, pages, markeringen, kleur);
      return;
    }
    if (boekje()) {
      await renderBoekjeVoorbeeld(beurt, doc, pages, keuzes, markeringen, kleur);
      return;
    }
    const raster = meerPerBlad();
    if (raster) {
      await renderMeerPerBladVoorbeeld(beurt, doc, pages, keuzes, raster, markeringen, kleur);
      return;
    }
    setMeerVoorbeeld(null);
    const pageNum = pages[Math.min(previewIndex(), pages.length - 1)];

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

      const vak = canvasVak(plaatsing.vel);
      const pxPerPt = plaatsing.schaal * MM_PER_PT * vak.pxPerMm;

      // Hetzelfde beeld als de printopdracht, inclusief de kwartslag voor een
      // pagina die haaks op het vel staat.
      const deel = renderDeel(plaatsing, pxPerPt);
      const beeld = deel
        ? await renderPrintBeeld(pageNum, pxPerPt, plaatsing, deel, { markeringen, kleur })
        : null;
      if (beurt !== voorbeeldBeurt) return;

      const ctx = begin(vak);
      if (beeld) tekenBeeld(ctx, beeld, deel.opVel, vak.pxPerMm);
      if (plaatsing.bekend) tekenVel(ctx, vak, plaatsing);
      // Buiten het vel weegt zwaarder dan buiten het bedrukbare gebied.
      setAfsnijMelding(!plaatsing.bekend ? ''
        : plaatsing.afgesneden ? t('print.pageClipped')
          : plaatsing.buitenBedrukbaar ? t('print.pageOutsidePrintable') : '');
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  // Meerdere pagina's per vel: het getoonde vel met al zijn pagina's, zoals
  // de printopdracht het bouwt (voorbeeldMeerPerBlad in print-meerperblad.js,
  // dezelfde regels als maakMeerPerBlad). De navigatie loopt dan per vel.
  async function renderMeerPerBladVoorbeeld(beurt, doc, pages, keuzes, raster, markeringen, kleur) {
    try {
      const velIndex = Math.min(previewIndex(), aantalVellen(pages.length, raster) - 1);
      const opVel = paginasOpVel(pages, velIndex, raster);
      const maatVan = async (pageNum) => {
        const page = await doc.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport(viewportOpties(page, getPageRotation(pageNum)));
        return { breedtePt: viewport.width, hoogtePt: viewport.height };
      };
      // Het vel volgt de eerste pagina van de hele afdruk (kiesBlad).
      const eerstePagina = await maatVan(pages[0]);
      const maten = [];
      for (const pageNum of opVel) maten.push(await maatVan(pageNum));
      if (beurt !== voorbeeldBeurt) return;
      zetPaginaMaat(maten[0].breedtePt, maten[0].hoogtePt);
      const v = voorbeeldMeerPerBlad({ meerPerBlad: raster, keuzes, eerstePagina, paginas: maten });
      setMeerVoorbeeld(v);
      setAfsnijMelding('');
      if (!v) return;

      // De volgorde-aanwijzer alleen in het voorbeeld, nooit in de afdruk; bij
      // een folder (elke cel dezelfde pagina) alleen de nummers.
      await tekenCellenVoorbeeld(beurt, v, (cel) => opVel[cel.k], markeringen, {
        aanwijzer: raster.flyer ? 'nummers' : 'volgorde', kleur,
      });
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  // Boekje: de getoonde zijde van het liggende vel met links en rechts van de
  // vouw de pagina's in genietvolgorde (voorbeeldBoekje in print-boekje.js,
  // dezelfde regels als maakBoekje). Een blanco helft blijft wit. De
  // navigatie loopt per zijde: vel 1 voor, vel 1 achter, vel 2 voor...
  async function renderBoekjeVoorbeeld(beurt, doc, pages, keuzes, markeringen, kleur) {
    try {
      const lijst = boekjeZijden();
      if (!lijst.length) return;
      const getoond = lijst[Math.min(previewIndex(), lijst.length - 1)];
      const zijde = getoond.paginas;
      const maatVan = async (pageNum) => {
        const page = await doc.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport(viewportOpties(page, getPageRotation(pageNum)));
        return { breedtePt: viewport.width, hoogtePt: viewport.height };
      };
      // Het vel volgt de eerste pagina van de hele afdruk (kiesBoekjeBlad).
      const eerstePagina = await maatVan(pages[0]);
      const maten = [];
      for (const i of zijde) maten.push(i === null ? null : await maatVan(pages[i]));
      if (beurt !== voorbeeldBeurt) return;
      const eenMaat = maten.find(Boolean);
      if (eenMaat) zetPaginaMaat(eenMaat.breedtePt, eenMaat.hoogtePt);
      const v = voorbeeldBoekje({
        keuzes, eerstePagina, paginas: maten, gedraaid: getoond.gedraaid,
        kruip: kruipVoorVel(getoond.velInKatern, getoond.vellenInKatern, bookletCreep()),
      });
      setMeerVoorbeeld(v);
      setAfsnijMelding('');
      if (!v) return;
      // Alleen de nummers: links en rechts van de vouw komen niet na elkaar.
      await tekenCellenVoorbeeld(beurt, v, (cel) => pages[zijde[cel.k]], markeringen, { aanwijzer: 'nummers', kleur });
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  // Een vel met cellen (meerdere pagina's per vel, een folder of een boekje):
  // elke cel de printpagina van haar pagina, verkleind op haar plek. Eerst
  // alle beelden, dan in één keer tekenen: geen half vel in beeld. Dezelfde
  // pagina op dezelfde schaal (een folder) wordt één keer gerenderd.
  // `aanwijzer`: de volgorde-aanwijzer erover (alleen in het voorbeeld):
  // 'volgorde' = nummers en pijlen, 'nummers' = alleen de nummers. Een cel
  // met `gedraaid` (achterkant van een boekje) staat een halve slag gedraaid,
  // een cel met `klem` (kruip) wordt op dat vlak afgeknipt; `v.vouw` tekent
  // de vouw als stippellijn (alleen in het voorbeeld).
  async function tekenCellenVoorbeeld(beurt, v, paginaVan, markeringen, { aanwijzer = false, kleur = 'color' } = {}) {
    const vak = canvasVak(v.vel);
    const beelden = [];
    const gerenderd = new Map();
    for (const cel of v.cellen) {
      const pxPerPt = cel.plaatsing.schaal * cel.schaal * MM_PER_PT * vak.pxPerMm;
      const deel = renderDeel(cel.plaatsing, pxPerPt);
      const sleutel = deel ? `${paginaVan(cel)}|${pxPerPt}|${JSON.stringify(deel.px)}` : null;
      let beeld = sleutel ? gerenderd.get(sleutel) : null;
      if (deel && !beeld) {
        beeld = await renderPrintBeeld(paginaVan(cel), pxPerPt, cel.plaatsing, deel, { markeringen, kleur });
        gerenderd.set(sleutel, beeld);
      }
      if (beurt !== voorbeeldBeurt) return;
      beelden.push({ cel, deel, beeld: beeld || null });
    }

    const ctx = begin(vak);
    for (const { cel, deel, beeld } of beelden) {
      if (!beeld) continue;
      // Het deel staat in mm op de printpagina van de cel; die komt verkleind
      // (cel.schaal) op haar plek op het vel (beeldInCel). Een halve slag
      // (achterkant van een boekje, zoals maakBoekje de zijde draait) of een
      // kwartslag linksom (Automatisch draaien in een cel, zoals
      // maakMeerPerBlad): het beeld gedraaid om het midden van die plek.
      const plek = beeldInCel(cel, deel.opVel);
      ctx.save();
      if (cel.klem) {
        const k = cel.klem;
        ctx.beginPath();
        ctx.rect(k.x * vak.pxPerMm, k.y * vak.pxPerMm, k.breedte * vak.pxPerMm, k.hoogte * vak.pxPerMm);
        ctx.clip();
      }
      if (plek.hoek) {
        const px = vak.pxPerMm;
        // Bij een kwartslag is het ongedraaide beeld zo breed als de plek hoog is.
        const b = plek.hoek === 90 ? plek.hoogte : plek.breedte;
        const h = plek.hoek === 90 ? plek.breedte : plek.hoogte;
        ctx.translate((plek.x + plek.breedte / 2) * px, (plek.y + plek.hoogte / 2) * px);
        // Canvas draait met de klok mee bij een positieve hoek; linksom is negatief.
        ctx.rotate((-plek.hoek * Math.PI) / 180);
        tekenBeeld(ctx, beeld, { x: -b / 2, y: -h / 2, breedte: b, hoogte: h }, px);
      } else {
        tekenBeeld(ctx, beeld, plek, vak.pxPerMm);
      }
      ctx.restore();
    }
    if (v.vouw) {
      // De vouw van een boekje: een stippellijn, alleen in het voorbeeld.
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 102, 204, 0.6)';
      ctx.lineWidth = Math.max(1, vak.dpr);
      ctx.setLineDash([4 * vak.dpr, 3 * vak.dpr]);
      ctx.beginPath();
      ctx.moveTo(v.vouw * vak.pxPerMm, 0);
      ctx.lineTo(v.vouw * vak.pxPerMm, vak.hoogte);
      ctx.stroke();
      ctx.restore();
    }
    if (v.rand) {
      // Zoals maakMeerPerBlad: een rand van 0,5 pt om elke printpagina.
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, 0.5 * MM_PER_PT * vak.pxPerMm);
      for (const { cel } of beelden) {
        const r = cel.opVel;
        ctx.strokeRect(r.x * vak.pxPerMm, r.y * vak.pxPerMm, r.breedte * vak.pxPerMm, r.hoogte * vak.pxPerMm);
      }
      ctx.restore();
    }
    if (v.snijtekens && v.snijtekens.length) {
      // Zoals maakMeerPerBlad ze bij een folder tekent.
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, SNIJTEKEN_LIJN_PT * MM_PER_PT * vak.pxPerMm);
      ctx.beginPath();
      for (const s of v.snijtekens) {
        ctx.moveTo(s.x1 * vak.pxPerMm, s.y1 * vak.pxPerMm);
        ctx.lineTo(s.x2 * vak.pxPerMm, s.y2 * vak.pxPerMm);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (aanwijzer) tekenVolgordeAanwijzer(ctx, vak, v.cellen, paginaVan, aanwijzer !== 'nummers');
    if (v.bekend) tekenVel(ctx, vak, v);
  }

  // De volgorde-aanwijzer (#607): in elke cel het paginanummer in een rondje
  // en een pijl van cel naar cel in de printvolgorde (volgordeAanwijzer in
  // print-meerperblad.js). Alleen op het voorbeeld; de afdruk kent hem niet.
  function tekenVolgordeAanwijzer(ctx, vak, cellen, paginaVan, metPijlen = true) {
    const { straal, merken, pijlen } = volgordeAanwijzer(cellen, { pijlen: metPijlen });
    if (!merken.length) return;
    const px = vak.pxPerMm;
    const r = Math.max(7 * vak.dpr, straal * px);
    const kleur = 'rgba(0, 102, 204, 0.85)';
    ctx.save();
    ctx.strokeStyle = kleur;
    ctx.fillStyle = kleur;
    ctx.lineWidth = Math.max(1, 1.5 * vak.dpr);
    const punt = Math.max(4 * vak.dpr, r * 0.55);
    for (const p of pijlen) {
      const x1 = p.x1 * px;
      const y1 = p.y1 * px;
      const x2 = p.x2 * px;
      const y2 = p.y2 * px;
      const hoek = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(hoek) * punt * 0.8, y2 - Math.sin(hoek) * punt * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(hoek - 0.45) * punt, y2 - Math.sin(hoek - 0.45) * punt);
      ctx.lineTo(x2 - Math.cos(hoek + 0.45) * punt, y2 - Math.sin(hoek + 0.45) * punt);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of merken) {
      const cel = cellen.find((c) => c.k === m.k);
      const tekst = String(cel ? paginaVan(cel) : m.k + 1);
      ctx.fillStyle = kleur;
      ctx.beginPath();
      ctx.arc(m.x * px, m.y * px, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * (tekst.length > 2 ? 0.8 : 1.05))}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(tekst, m.x * px, m.y * px + r * 0.05);
    }
    ctx.restore();
  }

  // Posterafdruk: het getoonde vel met zijn tegel, zoals maakPoster het bouwt
  // (posterIndeling in print-poster.js, dezelfde regel): de pagina geknipt
  // tot het venster van de tegel, de snijtekens en het label. De navigatie
  // loopt per vel; een pagina die niet getegeld wordt is één vel.
  async function renderPosterVoorbeeld(beurt, pages, markeringen, kleur) {
    const doc = getActiveDocument();
    try {
      const vellen = posterVellenLijst();
      setAfsnijMelding('');
      if (!vellen.length) return;
      const { paginaIndex, indeling, vel: v } = vellen[Math.min(previewIndex(), vellen.length - 1)];
      const pageNum = pages[paginaIndex];
      const maat = posterMaten()?.[paginaIndex];
      if (maat) zetPaginaMaat(maat.breedtePt, maat.hoogtePt);

      const vak = canvasVak(v.vel);
      const pxPerPt = v.plaatsing.schaal * MM_PER_PT * vak.pxPerMm;
      const deel = renderDeel(v.plaatsing, pxPerPt);
      const beeld = deel
        ? await renderPrintBeeld(pageNum, pxPerPt, v.plaatsing, deel, { markeringen, kleur })
        : null;
      if (beurt !== voorbeeldBeurt || doc !== getActiveDocument() || doc?.isClosed?.()) return;

      const { pxPerMm } = vak;
      const ctx = begin(vak);
      if (beeld) {
        ctx.save();
        if (v.venster) {
          // Zoals de knip in de afdruk: alleen het venster van de tegel.
          const w = v.venster;
          ctx.beginPath();
          ctx.rect(w.x * pxPerMm, w.y * pxPerMm, w.breedte * pxPerMm, w.hoogte * pxPerMm);
          ctx.clip();
        }
        tekenBeeld(ctx, beeld, deel.opVel, pxPerMm);
        ctx.restore();
      }
      if (v.snijtekens.length) {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, SNIJTEKEN_DIKTE_PT * MM_PER_PT * pxPerMm);
        ctx.beginPath();
        for (const s of v.snijtekens) {
          ctx.moveTo(s.x1 * pxPerMm, s.y1 * pxPerMm);
          ctx.lineTo(s.x2 * pxPerMm, s.y2 * pxPerMm);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (v.label) {
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `${v.label.grootteMm * pxPerMm}px Helvetica, Arial, sans-serif`;
        ctx.fillText(posterLabelVoor(indeling, v, pageNum), v.label.x * pxPerMm, v.label.y * pxPerMm);
        ctx.restore();
      }
      tekenVel(ctx, vak, v);
      // Repeated strips are a preview guide only; never part of print output.
      ctx.fillStyle = 'rgba(0, 120, 215, 0.18)';
      for (const r of posterSheetOverlaps(indeling, v)) {
        ctx.fillRect(r.x * pxPerMm, r.y * pxPerMm, r.width * pxPerMm, r.height * pxPerMm);
      }
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  // De labeltekst van een tegel: dezelfde als in de afdruk (print-job.js).
  function posterLabelVoor(indeling, v, pageNum) {
    const doc = getActiveDocument();
    return posterLabel({
      vertaal: (waarden) => t('print.posterLabelText', waarden),
      bestand: doc?.fileName || (doc?.filePath ? doc.filePath.split(/[\\/]/).pop() : ''),
      pagina: pageNum,
      rij: v.rij,
      kol: v.kol,
      rijen: indeling.rijen,
      kolommen: indeling.kolommen,
    });
  }

  // Canvasmaat voor een vel (mm): passend in het voorbeeldvak, scherp op de
  // pixeldichtheid van het scherm.
  function canvasVak(vel) {
    const cssPerMm = Math.min(VOORBEELD_BREEDTE / vel.breedteMm, VOORBEELD_HOOGTE / vel.hoogteMm);
    const dpr = window.devicePixelRatio || 1;
    const cssBreedte = Math.max(1, Math.round(vel.breedteMm * cssPerMm));
    const cssHoogte = Math.max(1, Math.round(vel.hoogteMm * cssPerMm));
    const breedte = Math.max(1, Math.round(cssBreedte * dpr));
    const hoogte = Math.max(1, Math.round(cssHoogte * dpr));
    return { cssBreedte, cssHoogte, breedte, hoogte, dpr, pxPerMm: breedte / vel.breedteMm };
  }

  // Het canvas op de maat van het vel, wit.
  function begin(vak) {
    canvasRef.width = vak.breedte;
    canvasRef.height = vak.hoogte;
    canvasRef.style.width = `${vak.cssBreedte}px`;
    canvasRef.style.height = `${vak.cssHoogte}px`;
    const ctx = canvasRef.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, vak.breedte, vak.hoogte);
    return ctx;
  }

  function tekenBeeld(ctx, beeld, r, pxPerMm) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(beeld, r.x * pxPerMm, r.y * pxPerMm, r.breedte * pxPerMm, r.hoogte * pxPerMm);
  }

  // Het bedrukbare gebied van de printer (stippellijn) en de rand van het vel.
  function tekenVel(ctx, vak, { bedrukbaar: g, marges: marge }) {
    const { pxPerMm, breedte, hoogte } = vak;
    const lijn = Math.max(1, Math.round(vak.dpr));
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

  function prevPreview() {
    if (previewIndex() > 0) setPreviewIndex(previewIndex() - 1);
  }

  function nextPreview() {
    if (previewIndex() < voorbeeldTotaal() - 1) setPreviewIndex(previewIndex() + 1);
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

  // Tegelschaal en overlap: zoals de Paginazoom alleen geldige waarden tijdens
  // het typen, begrensd bij verlaten of Enter.
  function onPosterScaleInput(e) {
    const n = Number.parseInt(e.target.value, 10);
    if (Number.isFinite(n) && n >= POSTER_SCHAAL_MIN && n <= POSTER_SCHAAL_MAX) setPosterScale(n);
  }

  function onPosterScaleChange(e) {
    const geldig = geldigePosterSchaal(e.target.value === '' ? posterScale() : e.target.value);
    setPosterScale(geldig);
    e.target.value = String(geldig);
  }

  function onPosterOverlapInput(e) {
    const n = leesGetalBegin(e.target.value);
    if (Number.isFinite(n) && n >= 0 && n <= OVERLAP_MAX_MM) setPosterOverlap(geldigeOverlap(n));
  }

  function onPosterOverlapChange(e) {
    const geldig = geldigeOverlap(e.target.value === '' ? posterOverlap() : e.target.value);
    setPosterOverlap(geldig);
    e.target.value = String(geldig);
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
    // "Opslaan als PDF" heeft geen printer om iets aan te vragen.
    if (!printer || isPdfDoel(printer)) return;
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
    if (!printer || isPdfDoel(printer) || eigenschappenOpen) return;
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

  // Het opgeslagen bestand openen in een nieuw tabblad (achter de knop
  // "Openen" op de melding), zoals de raster-export dat doet.
  async function openOpgeslagen(pad) {
    try {
      const { createTab } = await import('../../../ui/chrome/tabs.js');
      const { loadPDFIfNeeded } = await import('../../../pdf/loader.js');
      const { index } = createTab(pad);
      await loadPDFIfNeeded(pad, index);
    } catch (e) {
      console.error('Could not open the saved print PDF:', e);
    }
  }

  // Het doel "Opslaan als PDF": het bestaande opslaan-venster, nooit over het
  // geopende bestand heen, daarna de print-PDF op de achtergrond wegschrijven
  // (dezelfde keuzes als een printopdracht). null = de gebruiker brak af, de
  // dialoog blijft open.
  async function kiesDoelbestand() {
    const doc = getActiveDocument();
    const pad = await saveFileDialog(standaardDoelPad(doc, null, t('print.fileSuffix')), [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (!pad) return null;
    if (doelIsGeopend(pad, state.documents)) {
      setStatusMessage(t('print.targetIsOpenFile'));
      setStatusType('error');
      return null;
    }
    return pad;
  }

  async function executePrint() {
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
    const doelPad = pdfDoel() ? await kiesDoelbestand() : null;
    if (pdfDoel() && !doelPad) return;
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
      colorMode: geldigeKleurModus(colorMode()),
      perSheet: perSheet(),
      sheetCols: sheetCols(),
      sheetRows: sheetRows(),
      sheetOrder: sheetOrder(),
      sheetBorder: sheetBorder(),
      posterScale: geldigePosterSchaal(posterScale()),
      posterOverlap: geldigeOverlap(posterOverlap()),
      posterCutMarks: posterCutMarks(),
      posterLabels: posterLabels(),
      posterOnlyLarge: posterOnlyLarge(),
      flyerCount: flyerCount(),
      flyerCutMarks: flyerCutMarks(),
      bookletSheets: geldigKatern(bookletSheets()),
      bookletBinding: bookletBinding(),
      bookletSides: bookletSides(),
      bookletRotateBack: bookletRotateBack(),
      bookletCreep: geldigeKruip(bookletCreep()),
    };
    // Schaal en plek zoals het voorbeeld ze toont (vóór close(): de keuzes
    // komen uit de signalen van deze dialoog).
    const keuzes = plaatsingKeuzes();
    const meerBlad = meerPerBlad();
    const posterKeuze = poster();
    const boekjeKeuze = boekje()
      ? {
        katern: katern(),
        binding: bookletBinding(),
        kanten: bookletSides(),
        omgekeerd: reverseOrder(),
        draaiAchter: bookletRotateBack(),
        kruipMm: geldigeKruip(bookletCreep()),
      }
      : false;
    // De stand zoals het voorbeeld hem toont (plaatsingKeuzes): bij meerdere
    // pagina's per vel of een folder geldt de gekozen stand (#606).
    const orientatie = keuzes.orientatie;
    savePreferences();
    close();
    // Papier: de Pagina-instelling bereikt nu echt de printer (zie
    // print-pagina-instelling.js).
    const { papier } = printArgumenten({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
    });
    if (doelPad) {
      slaPrintOpAlsPdf({
        pages,
        pad: doelPad,
        orientatie,
        vel: keuzes.papier,
        schaling: keuzes.schaling,
        zoom: keuzes.zoom,
        centreren: keuzes.centreren,
        meerPerBlad: meerBlad,
        poster: posterKeuze,
        boekje: boekjeKeuze,
        inhoud: printContent(),
        kleur: geldigeKleurModus(colorMode()),
        openen: openOpgeslagen,
      });
      return;
    }
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
      meerPerBlad: meerBlad,
      poster: posterKeuze,
      boekje: boekjeKeuze,
      // "Afdrukken: Document" laat de markeringen ook echt weg.
      inhoud: printContent(),
      kleur: geldigeKleurModus(colorMode()),
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
      // Geen printer: "Opslaan als PDF" blijft over en staat dan vooraan.
      setPrintDisabled(true);
      if (!gebruikerKoosPrinter && !selectedPrinter()) {
        setSelectedPrinter(DOEL_PDF);
        updatePrinterInfo(DOEL_PDF);
      }
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

  // Alles wat het vel en de plek van de pagina bepaalt behalve de pagina zelf
  // (print-plaatsing.js): het papier als het bekend is, de oriëntatie van het
  // vel (Automatisch draaien en de Pagina-instelling, zoals print_pdf), het
  // schaaltype, de zoom en centreren. Het voorbeeld en de printopdracht
  // gebruiken dezelfde keuzes. "Opslaan als PDF" zonder formaat: elke pagina
  // haar eigen vel, in de gekozen stand (er is geen stuurprogramma dat inpast).
  const plaatsingKeuzes = createMemo(() => {
    paginaInstellingVersie();
    const vel = bekendVel(effectief());
    const marges = printerMarges().get(papierVerzoekSleutel(selectedPrinter(), gevraagdPapier())) || null;
    return {
      papier: vel ? { ...vel, bedrukbaar: marges } : (pdfDoel() ? 'pagina' : null),
      // Bij meerdere pagina's per vel of een folder geldt de in de
      // Pagina-instelling gekozen stand, ook met Automatisch draaien (#606).
      orientatie: vellenStand({
        autoRotate: autoRotate(),
        paginaInstelling: getPageSetupSettings(),
        docId: getActiveDocument()?.id ?? null,
        metIndeling: !!meerPerBlad(),
      }),
      schaling: scaling(),
      zoom: geldigeZoom(zoom()),
      centreren: autoCenter(),
    };
  }, undefined, { equals: zelfdeKeuzes });

  // De posterindeling van elke af te drukken pagina (print-poster.js) en de
  // vellen van de hele afdruk; leeg zonder poster of zolang de maten nog
  // onderweg zijn.
  const posterVellenLijst = createMemo(() => {
    const opties = poster();
    const maten = posterMaten();
    if (!opties || !maten) return [];
    const { papier, orientatie } = plaatsingKeuzes();
    return posterVellen(maten.map((pagina) => posterIndeling({ papier, orientatie, pagina, opties })));
  });

  // Hoeveel mm "Kleine buitenranden afsnijden" hooguit van een buitenrand
  // weglaat, gerekend met de keuze aan (ook als ze uit staat), naar boven
  // afgerond op een honderdste mm.
  const posterAfsnijding = createMemo(() => {
    const opties = poster();
    const maten = posterMaten();
    if (!opties || !maten) return 0;
    const { papier, orientatie } = plaatsingKeuzes();
    const aan = { ...opties, randAfsnijden: true };
    const mm = posterRandAfsnijding(maten.map((pagina) => posterIndeling({ papier, orientatie, pagina, opties: aan })));
    return Math.ceil(mm * 100 - 1e-6) / 100;
  });

  // Het getoonde vel van de poster, of null.
  const huidigPosterVel = createMemo(() => {
    const vellen = posterVellenLijst();
    if (!poster() || !vellen.length) return null;
    return vellen[Math.min(previewIndex(), vellen.length - 1)];
  });

  createEffect(on(posterVellenLijst, sheets => {
    if (poster() && previewIndex() >= sheets.length) setPreviewIndex(Math.max(0, sheets.length - 1));
  }));

  // De regel onder de kop bij een poster: welke tegel van welke pagina, of
  // dat de pagina niet getegeld wordt; en of het vel een aanname is.
  const posterNotitie = createMemo(() => {
    const huidig = huidigPosterVel();
    if (!huidig) return '';
    const pageNum = previewPages()[huidig.paginaIndex];
    const { indeling, vel: v } = huidig;
    const tekst = indeling.getegeld
      ? t('print.posterTileInfo', { page: pageNum, row: v.rij, col: v.kol, rows: indeling.rijen, cols: indeling.kolommen })
      : t('print.posterNotTiled', { page: pageNum });
    return indeling.aangenomen ? `${tekst} ${t('print.posterAssumedPaper', { paper: 'A4' })}` : tekst;
  });

  // De regel onder de kop bij een boekje: welk vel, welke kant en welke
  // pagina's links en rechts van de vouw.
  const boekjeNotitie = createMemo(() => {
    if (!boekje()) return '';
    const pages = previewPages();
    const { blanco, katernen, katernVanVel } = boekjeVolgorde(pages.length, katern());
    const lijst = boekjeZijden();
    if (!lijst.length) return '';
    const { vel, kant, paginas, gedraaid } = lijst[Math.min(previewIndex(), lijst.length - 1)];
    const naam = (i) => (i === null ? t('print.bookletBlank') : String(pages[i]));
    // Links en rechts zoals op het papier: een gedraaide zijde wisselt ze.
    const [links, rechts] = gedraaid ? [paginas[1], paginas[0]] : paginas;
    let tekst = t(kant === 'front' ? 'print.bookletSideFront' : 'print.bookletSideBack', {
      sheet: vel, left: naam(links), right: naam(rechts),
    });
    if (gedraaid) tekst = `${tekst} ${t('print.bookletRotatedInfo')}`;
    if (katernen.length > 1) {
      const info = t('print.bookletSignatureInfo', { signature: katernVanVel[vel - 1], signatures: katernen.length });
      tekst = `${tekst} ${info}`;
    }
    return blanco ? `${tekst} ${t('print.bookletPadded', { count: blanco })}` : tekst;
  });

  // De regel onder de kop bij een folder: hoeveel kopieën van welke pagina.
  const flyerNotitie = createMemo(() => {
    const raster = meerPerBlad();
    if (!flyer() || !raster) return '';
    const pages = previewPages();
    if (!pages.length) return '';
    const pagina = pages[Math.min(previewIndex(), pages.length - 1)];
    return t('print.flyerNote', { count: raster.kolommen * raster.rijen, page: pagina });
  });

  // De plaatsing van de getoonde voorbeeldpagina: het vel zoals het uit de
  // printer komt of in het bestand komt te liggen (dezelfde regel als het
  // voorbeeld en de opdracht). Bij meerdere pagina's per vel het vel met het
  // raster: zijn stand en maten, en de schaal van de pagina op het papier.
  const voorbeeldPlaatsing = createMemo(() => {
    if (poster()) {
      const posterVel = huidigPosterVel();
      return posterVel ? posterVel.vel.plaatsing : null;
    }
    const meer = meerVoorbeeld();
    if ((meerPerBlad() || boekje()) && meer) return meer;
    const maat = paginaMaat();
    return maat ? berekenPlaatsing({ ...plaatsingKeuzes(), pagina: maat }) : null;
  });

  // Kop van het voorbeeld: het vel met zijn stand en de maten zoals het ligt
  // ("A2 liggend (594 × 420 mm)"), naast de maat van de getoonde pagina.
  const papierKop = createMemo(() => {
    const e = effectief();
    const plaatsing = voorbeeldPlaatsing();
    if (!plaatsing) return '';
    let naam;
    const posterVel = huidigPosterVel();
    if (posterVel && posterVel.indeling.aangenomen) {
      // Een poster heeft altijd een vel: onbekend papier wordt A4.
      naam = 'A4';
    } else if (e.bron === 'laden') {
      // Een printer die nog niet geantwoord heeft: nog niets tonen. Bij
      // "Opslaan als PDF" zonder formaat is het vel de pagina zelf.
      if (!pdfDoel()) return '';
      naam = velNaam(paginaMaat());
    } else if (e.bron === 'onbekend') {
      // Onbekend papier = de standaard van de printer (dezelfde tekst als in
      // de Pagina-instelling).
      naam = t('pageSetup.printerDefault');
    } else {
      naam = e.naam || null;
    }
    const tekst = velTekst(plaatsing, naam, t);
    if (!tekst) return '';
    // De driver kan het gevraagde formaat niet aan: zeggen waarop er wel
    // geprint wordt, en welk formaat niet beschikbaar is.
    return e.geweigerd
      ? t('print.paperFallback', { paper: tekst, requested: e.geweigerd })
      : t('print.paperLabel', { paper: tekst });
  });

  // Automatisch draaien laat een in de Pagina-instelling gekozen stand
  // vervallen: dat staat erbij, in plaats van stil te gebeuren.
  const autoDraaienNotitie = createMemo(() => {
    paginaInstellingVersie();
    const stand = overstemdeStand({
      autoRotate: autoRotate(),
      paginaInstelling: getPageSetupSettings(),
      docId: getActiveDocument()?.id ?? null,
      pagina: paginaMaat(),
      metIndeling: !!meerPerBlad(),
    });
    return stand ? t('print.autoRotateOverrides', { orientation: tCommon(stand) }) : '';
  });

  // Een printer die naar een bestand schrijft laat zijn stuurprogramma over
  // het vel beslissen; "Opslaan als PDF" doet dat niet. Alleen uit wat de
  // printerlijst al meldt (print-doel.js).
  const bestandsPrinterHint = createMemo(() => {
    if (pdfDoel()) return '';
    const printer = printerList().find((p) => p.Name === selectedPrinter());
    return isBestandsPrinter(printer) ? t('print.filePrinterHint') : '';
  });

  // Voorbeeld opnieuw tekenen bij elke wijziging van de pagina's, de getoonde
  // pagina, de inhoud (met of zonder markeringen), de plaatsing (schaaltype,
  // zoom, centreren, automatisch draaien, Pagina-instelling en printerpapier)
  // of de pagina's per vel (aantal, raster, volgorde, rand).
  createEffect(on([
    previewPages, previewIndex, printContent, colorMode, plaatsingKeuzes, meerPerBlad, boekje, katern, boekjeZijden,
    bookletCreep, posterVellenLijst,
  ], () => {
    renderPreview();
  }, { defer: true }));

  // De posterafdruk telt haar vellen per pagina: de maten van alle af te
  // drukken pagina's, zoals de print-PDF ze krijgt (getoond, met draaiing).
  createEffect(on([previewPages, () => !!poster()], async ([pages, isPoster]) => {
    const beurt = ++posterMatenBeurt;
    if (!isPoster) {
      setPosterMaten(null);
      return;
    }
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) return;
    const maten = [];
    try {
      for (const pageNum of pages) {
        const page = await doc.pdfDoc.getPage(pageNum);
        if (beurt !== posterMatenBeurt || doc !== getActiveDocument() || doc.isClosed?.()) return;
        const viewport = page.getViewport(viewportOpties(page, getPageRotation(pageNum)));
        maten.push({ breedtePt: viewport.width, hoogtePt: viewport.height });
      }
    } catch (e) {
      console.error('Poster preview: page sizes failed:', e);
      return;
    }
    if (beurt === posterMatenBeurt) setPosterMaten(maten);
  }));

  // Poster of boekje aan of uit: het voorbeeld begint weer bij het eerste vel.
  createEffect(on(() => !!poster(), () => setPreviewIndex(0), { defer: true }));
  // Een boekje aan of uit verandert ook wat Omgekeerde volgorde omdraait.
  createEffect(on(boekje, () => updatePreviewPages(), { defer: true }));
  createEffect(on(katern, () => setPreviewIndex(0), { defer: true }));
  createEffect(on([bookletBinding, bookletSides], () => setPreviewIndex(0), { defer: true }));
  createEffect(on(flyer, () => setPreviewIndex(0), { defer: true }));

  // Een ander aantal per vel: het voorbeeld begint weer bij het eerste vel
  // (de nummering van pagina's en vellen loopt dan niet meer gelijk).
  createEffect(on(meerPerBlad, (nieuw, oud) => {
    if ((nieuw ? nieuw.kolommen * nieuw.rijen : 1) !== (oud ? oud.kolommen * oud.rijen : 1)) setPreviewIndex(0);
  }, { defer: true }));

  const paginaKop = createMemo(() => {
    const maat = paginaMaat();
    const tekst = maat ? paginaTekst(maat.breedtePt, maat.hoogtePt) : null;
    return tekst ? t('print.pageSizeLabel', { size: tekst }) : '';
  });

  // De schaal waarop de getoonde pagina op het vel komt (A2 passend op A3:
  // 71 %), zodat verkleinen of vergroten niet onopgemerkt blijft.
  const schaalKop = createMemo(() => {
    const procent = schaalProcent(voorbeeldPlaatsing());
    return procent === null ? '' : t('print.scaleLabel', { percent: procent });
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
          {/* "Opslaan als PDF" heeft geen printer nodig en heet dan Opslaan. */}
          <button
            class="pref-btn pref-btn-primary"
            disabled={printDisabled() && !pdfDoel()}
            onClick={executePrint}
          >{pdfDoel() ? tCommon('save') : tCommon('print')}</button>
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
                  {/* Bovenaan: het doel zonder printer, altijd beschikbaar. */}
                  <option value={DOEL_PDF} selected={pdfDoel()}>{t('print.saveAsPdf')}</option>
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
              <Show when={!pdfDoel()}>
                <div class="print-row print-printer-detail-row">
                  <span class="print-printer-status">{printerStatus()}</span>
                  <span class="print-printer-sep">|</span>
                  <span class="print-printer-type">{printerType()}</span>
                </div>
              </Show>
              {/* Without this the user cannot tell "no printers installed"
                  from "the query failed", and neither can a bug report. */}
              <Show when={printerErrorMessage()}>
                <div class="print-row print-printer-error">{printerErrorMessage()}</div>
              </Show>
              <Show when={bestandsPrinterHint()}>
                <div class="print-row print-printer-hint">{bestandsPrinterHint()}</div>
              </Show>
            </div>
            <div class="print-printer-right">
              <button class="print-printer-action-btn" disabled={pdfDoel()} onClick={openPrinterProperties}>
                {t('print.propertiesBtn')}
              </button>
              <button class="print-printer-action-btn" onClick={openPageSetup}>
                {t('print.pageSetupBtn')}
              </button>
            </div>
          </div>
          <div class="print-row">
            <label class="print-label">{t('print.copies')}</label>
            {/* Een bestand heeft geen exemplaren. */}
            <input
              type="text" inputmode="decimal" data-getal
              class="print-input"
              min="1"
              max="999"
              value={copies()}
              disabled={pdfDoel()}
              onInput={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <label class="print-checkbox-label print-collate-label">
              <input
                type="checkbox"
                checked={collate()}
                disabled={pdfDoel()}
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

        {/* Page Placement and Scaling, with the print modes (#607) */}
        <fieldset class="print-group print-placement-group">
          <legend>{t('print.pagePlacement')}</legend>
          {/* Afdrukwijze: gewoon, meerdere per vel, folder, boekje of poster.
              Elke wijze toont hieronder alleen haar eigen keuzes. */}
          <div class="print-row">
            <label class="print-label">{t('print.modeLabel')}</label>
            <div class="print-page-btns print-mode-btns" role="group" aria-label={t('print.modeLabel')}>
              <For each={MODUS_KNOPPEN}>
                {(m) => (
                  <button
                    class="print-page-btn"
                    classList={{ active: modus() === m.waarde }}
                    aria-pressed={modus() === m.waarde}
                    title={t(m.uitleg)}
                    onClick={() => kiesModus(m.waarde)}
                  >{t(m.label)}</button>
                )}
              </For>
            </div>
          </div>

          <Show when={modus() === 'normal'}>
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
                type="text" inputmode="decimal" data-getal
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
          </Show>

          <Show when={poster()}>
            <div class="print-row print-zoom-row">
              <label class="print-label">{t('print.posterScale')}</label>
              <NumberStepper label={t('print.posterScale')} value={posterScale()} min={POSTER_SCHAAL_MIN} max={POSTER_SCHAAL_MAX}
                onStep={direction => setPosterScale(geldigePosterSchaal(posterScale() + direction))}>
              <input
                type="text" inputmode="decimal" data-getal
                aria-label={t('print.posterScale')}
                class="print-input"
                min={POSTER_SCHAAL_MIN}
                max={POSTER_SCHAAL_MAX}
                value={posterScale()}
                onInput={onPosterScaleInput}
                onChange={onPosterScaleChange}
              />
              </NumberStepper>
              <span>%</span>
            </div>
            <div class="print-row print-zoom-row">
              <label class="print-label">{t('print.posterOverlap')}</label>
              <NumberStepper label={t('print.posterOverlap')} value={posterOverlap()} min={0} max={OVERLAP_MAX_MM}
                onStep={direction => setPosterOverlap(geldigeOverlap(posterOverlap() + direction))}>
              <input
                type="text" inputmode="decimal" data-getal
                aria-label={t('print.posterOverlap')}
                class="print-input"
                min="0"
                max={OVERLAP_MAX_MM}
                step="1"
                value={posterOverlap()}
                onInput={onPosterOverlapInput}
                onChange={onPosterOverlapChange}
              />
              </NumberStepper>
              <span>mm</span>
            </div>
          </Show>

          <Show when={modus() === 'multiple'}>
            <div class="print-row">
              <label class="print-label">{t('print.pagesPerSheetLabel')}</label>
              <select
                class="print-select"
                value={perSheet()}
                onChange={(e) => setPerSheet(e.target.value)}
              >
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="9">9</option>
                <option value="16">16</option>
                <option value="custom">{t('print.perSheetCustom')}</option>
              </select>
            </div>
            <Show when={perSheet() === 'custom'}>
              <div class="print-row print-zoom-row">
                <label class="print-label">{t('print.perSheetGrid')}</label>
                <input
                  type="text" inputmode="decimal" data-getal
                  class="print-input"
                  min="1"
                  max="10"
                  value={sheetCols()}
                  onChange={(e) => setSheetCols(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                />
                <span>{t('print.perSheetBy')}</span>
                <input
                  type="text" inputmode="decimal" data-getal
                  class="print-input"
                  min="1"
                  max="10"
                  value={sheetRows()}
                  onChange={(e) => setSheetRows(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                />
              </div>
            </Show>
            {/* De paginavolgorde als vier knoppen met het leespad (#607). */}
            <div class="print-row">
              <label class="print-label">{t('print.pageOrder')}</label>
              <div class="print-page-btns print-order-btns" role="radiogroup" aria-label={t('print.pageOrder')}>
                <For each={PAGINAVOLGORDES}>
                  {(volgorde) => (
                    <button
                      class="print-page-btn print-order-btn"
                      classList={{ active: sheetOrder() === volgorde }}
                      role="radio"
                      aria-checked={sheetOrder() === volgorde}
                      aria-label={t(VOLGORDE_TEKST[volgorde])}
                      title={t(VOLGORDE_TEKST[volgorde])}
                      onClick={() => setSheetOrder(volgorde)}
                    ><VolgordeIcoon volgorde={volgorde} /></button>
                  )}
                </For>
              </div>
            </div>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={sheetBorder()}
                  onChange={(e) => setSheetBorder(e.target.checked)}
                /> {t('print.pageBorder')}
              </label>
            </div>
            <div class="print-row print-note">{t('print.perSheetNote')}</div>
          </Show>

          <Show when={flyer()}>
            <div class="print-row">
              <label class="print-label">{t('print.flyerCopies')}</label>
              <select
                class="print-select"
                value={flyerCount()}
                onChange={(e) => setFlyerCount(e.target.value)}
              >
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8">8</option>
                <option value="9">9</option>
                <option value="16">16</option>
              </select>
            </div>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={flyerCutMarks()}
                  onChange={(e) => setFlyerCutMarks(e.target.checked)}
                /> {t('print.flyerCutMarks')}
              </label>
            </div>
            <div class="print-row print-note">{t('print.perSheetNote')}</div>
            <div class="print-row print-note">{t('print.flyerTwoSidedNote')}</div>
          </Show>

          <Show when={boekje()}>
            <div class="print-row">
              <label class="print-label">{t('print.bookletBinding')}</label>
              <select
                class="print-select"
                value={bookletBinding()}
                onChange={(e) => setBookletBinding(e.target.value)}
              >
                <option value="left">{t('print.bookletBindingLeft')}</option>
                <option value="right">{t('print.bookletBindingRight')}</option>
              </select>
            </div>
            <div class="print-row">
              <label class="print-label">{t('print.bookletSides')}</label>
              <select
                class="print-select"
                value={bookletSides()}
                onChange={(e) => setBookletSides(e.target.value)}
              >
                <option value="both">{t('print.bookletSidesBoth')}</option>
                <option value="front">{t('print.bookletSidesFront')}</option>
                <option value="back">{t('print.bookletSidesBack')}</option>
              </select>
            </div>
            <div class="print-row">
              <label class="print-label">{t('print.bookletSignature')}</label>
              <select
                class="print-select"
                value={String(bookletSheets())}
                onChange={(e) => setBookletSheets(geldigKatern(e.target.value))}
              >
                <For each={KATERN_KEUZES}>
                  {(n) => (
                    <option value={String(n)} selected={n === bookletSheets()}>
                      {n === 0 ? t('print.bookletSignatureAll') : String(n)}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <div class="print-row" title={t('print.bookletCreepHint')}>
              <label class="print-label">{t('print.bookletCreep')}</label>
              <input
                type="text" inputmode="decimal" data-getal
                class="print-input"
                min="0"
                max={KRUIP_MAX_MM}
                step="0.1"
                value={bookletCreep()}
                onChange={(e) => {
                  const geldig = geldigeKruip(e.target.value);
                  setBookletCreep(geldig);
                  e.target.value = String(geldig);
                }}
              />
              <span>mm</span>
            </div>
            <div class="print-row print-checkbox-row" title={t('print.bookletRotateBackHint')}>
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={bookletRotateBack()}
                  disabled={bookletSides() === 'front'}
                  onChange={(e) => setBookletRotateBack(e.target.checked)}
                /> {t('print.bookletRotateBack')}
              </label>
            </div>
            <div class="print-row print-note">{t('print.bookletNote')}</div>
            <Show when={bookletSides() !== 'both'}>
              <div class="print-row print-note">{t('print.bookletManualNote', { reverse: t('print.reverseOrder') })}</div>
            </Show>
          </Show>

          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoRotate()}
                onChange={(e) => setAutoRotate(e.target.checked)}
              /> {t('print.autoRotate')}
            </label>
          </div>
          <Show when={modus() === 'normal'}>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={autoCenter()}
                  onChange={(e) => setAutoCenter(e.target.checked)}
                /> {t('print.autoCenter')}
              </label>
            </div>
          </Show>
          <Show when={poster()}>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input type="checkbox" id="print-poster-edge-crop"
                  checked={posterEdgeCrop()} onChange={e => batch(() => { setPosterEdgeCrop(e.target.checked); setPreviewIndex(0); })}
                  aria-describedby="print-poster-edge-crop-hint" /> {t('print.posterEdgeCrop')}
              </label>
            </div>
            <div class="print-row print-note" id="print-poster-edge-crop-hint">{t('print.posterEdgeCropHint', { max: toonGetal(posterAfsnijding(), language()) })}</div>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={posterCutMarks()}
                  onChange={(e) => setPosterCutMarks(e.target.checked)}
                /> {t('print.posterCutMarks')}
              </label>
            </div>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={posterLabels()}
                  onChange={(e) => setPosterLabels(e.target.checked)}
                /> {t('print.posterLabels')}
              </label>
            </div>
            <div class="print-row print-checkbox-row">
              <label class="print-checkbox-label">
                <input
                  type="checkbox"
                  checked={posterOnlyLarge()}
                  onChange={(e) => setPosterOnlyLarge(e.target.checked)}
                /> {t('print.posterOnlyLarge')}
              </label>
            </div>
          </Show>
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
          <div class="print-row">
            <label class="print-label">{t('print.colorMode')}</label>
            <select
              class="print-select"
              value={colorMode()}
              onChange={(e) => setColorMode(geldigeKleurModus(e.target.value))}
            >
              <For each={KLEUR_MODI}>
                {(modus) => (
                  <option value={modus} selected={modus === colorMode()}>{t(KLEUR_TEKST[modus])}</option>
                )}
              </For>
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

      <div class="print-preview-panel" classList={{ 'print-poster-preview': !!poster() }}>
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
          <Show when={(papierKop() || paginaKop()) && schaalKop()}>
            <span class="print-printer-sep">{' | '}</span>
          </Show>
          <Show when={schaalKop()}>
            <span class="print-preview-scale" classList={{ changed: schaalProcent(voorbeeldPlaatsing()) !== 100 }}>{schaalKop()}</span>
          </Show>
          <Show when={autoDraaienNotitie()}>
            <div class="print-preview-note">{autoDraaienNotitie()}</div>
          </Show>
          <Show when={posterNotitie()}>
            <div class="print-preview-note print-preview-poster">{posterNotitie()}</div>
          </Show>
          <Show when={boekjeNotitie()}>
            <div class="print-preview-note print-preview-booklet">{boekjeNotitie()}</div>
          </Show>
          <Show when={flyerNotitie()}>
            <div class="print-preview-note print-preview-flyer">{flyerNotitie()}</div>
          </Show>
        </div>
        <Show when={huidigPosterVel()}>{current => <PosterOverview
          layout={current().indeling} selected={current().vel.nummer}
          page={previewPages()[current().paginaIndex]}
          markups={printContent() === 'doc-and-markups'} color={colorMode()}
          title={t('print.posterOverview')} overlapLabel={t('print.posterOverlapLegend')}
          tileLabel={tile => t('print.posterTileInfo', { page: previewPages()[current().paginaIndex],
            row: tile.row, col: tile.col, rows: current().indeling.rijen, cols: current().indeling.kolommen })}
          onSelect={index => {
            const first = posterVellenLijst().findIndex(v => v.paginaIndex === current().paginaIndex);
            setPreviewIndex(first + index);
          }}
        />}</Show>
        <div class="print-preview-container">
          <canvas ref={canvasRef} id="print-preview-canvas" />
        </div>
        <Show when={afsnijMelding()}>
          <div class="print-preview-warning">{afsnijMelding()}</div>
        </Show>
        <div class="print-preview-footer">
          <span>
            {voorbeeldTotaal() > 0
              ? t('print.pageOf', { current: previewIndex() + 1, total: voorbeeldTotaal() })
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
              disabled={previewIndex() >= voorbeeldTotaal() - 1}
              onClick={nextPreview}
              title={t('print.nextPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 9,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= voorbeeldTotaal() - 1}
              onClick={() => setPreviewIndex(voorbeeldTotaal() - 1)}
              title={t('print.lastPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 7,5" fill="currentColor"/><rect x="7" y="1" width="2" height="8" fill="currentColor"/></svg></button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
