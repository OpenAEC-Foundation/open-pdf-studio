import { createSignal, createMemo, createEffect, on, onMount, onCleanup, Show, For } from 'solid-js';
import { createStore } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { updateStatusMessage } from '../../../ui/chrome/status-bar.js';
import { ONDERLEGGER_DPI } from '../../../pdf/cad-import-plaatsing.js';
import {
  herstelCadImportInstellingen, herstelCadImportVoorinstellingen, metVoorinstelling, zonderVoorinstelling,
} from '../../stores/cad-import-instellingen.js';
import {
  MM_PER_EENHEID, PAPIERFORMATEN, STANDAARDSCHALEN, GROTE_COORDINAAT, LAYOUT_PAPIER_STANDAARD, buitenBestanden, decimaalTeken,
  eenheidMelding, effectiefDoel, effectiefGebied, filterLagen, gebiedMaatMm, gebiedUitLagen, getalTekst, grootteTekst, importArgumenten, lagenKeuze,
  lagenVoorRuimte, layoutPagina, faseWeergave, leesImportFout, leesWaarschuwingen, limitsOmvatten, modelInhoudOpPapier,
  oorsprongVerschuiving, papierInstellingen, papierSamenvatting, papierTeKlein, papierVoorstel, ruimteVan, schaalTekst,
  schoonZoekpaden, sorteerLagen, standaardUitgesloten, vensterGeldig, weggelatenLagen, zetNietPlotbaar, MAX_PAGINA_MM, papiermaatMm,
} from '../../../pdf/cad-import-logica.js';
import {
  aantalInWachtrij, annuleerImport, controleerZoekpaden, importeerTekening, importGrenzen, kiesTekening, kiesZoekpad,
  laatTekeningLos, legTekeningOpPagina, luisterImportVoortgang, luisterWachtrij, meetschaalHuidigePagina, nieuwJobId,
  openImportAlsNieuwDocument, ruimOp, ruimOudeImportsOp, tijdelijkPdfPad, verkenTekening, voegImportToeAanDocument,
  volgendeTekening, zoekBuitenBestanden,
} from '../../../pdf/cad-import.js';
import CadImportPreview from './CadImportPreview.jsx';
import { CadBuitenBestanden, CadGeavanceerd, CadKleurentabel, CadKleurstand, CadLettertabel } from './CadImportWeergave.jsx';

const TABS = ['layers', 'coordinates', 'view'];
const VASTE_DRAAIINGEN = [0, 90, 180, 270];
const KOLOMMEN = [
  { id: 'color', cls: 'cad-col-color', label: '' },
  { id: 'name', cls: 'cad-col-name', label: 'colLayer' },
  { id: 'objects', cls: 'cad-col-count', label: 'colObjects' },
  { id: 'state', cls: 'cad-col-state', label: 'colState' },
];

/**
 * Importvenster voor DWG en DXF (#400).
 *
 * `data.path` is de gekozen tekening (uit het menu, Openen of slepen); zonder
 * pad vraagt het venster er zelf om. Wat uit het bestand komt (ruimte, lagen,
 * grenzen) wint altijd van wat onthouden is; onthouden worden alleen de
 * instellingen die niet bij één tekening horen (cad-import-instellingen.js).
 */
export default function CadImportDialog(props) {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [pad, setPad] = createSignal(props?.data?.path || '');
  const [scan, setScan] = createSignal(null);
  const [bezigMet, setBezigMet] = createSignal('scan');
  const [fout, setFout] = createSignal('');
  const [melding, setMelding] = createSignal(null);
  const [voortgang, setVoortgang] = createSignal(null);
  const [tab, setTab] = createSignal('layers');
  const [ruimteId, setRuimteId] = createSignal('');
  const [uit, setUit] = createSignal(new Set());
  const [zoek, setZoek] = createSignal('');
  const [sortering, setSortering] = createSignal({ kolom: null, oplopend: true });
  const [venster, setVenster] = createStore({ x0: 0, y0: 0, x1: 1000, y1: 1000 });
  const [voorinstellingen, setVoorinstellingen] = createSignal(herstelCadImportVoorinstellingen(state.preferences?.cadImportPresets));
  const [voorinstellingNaam, setVoorinstellingNaam] = createSignal('');
  const [inst, setInst] = createStore(herstelCadImportInstellingen(state.preferences?.cadImportSettings));
  // Papier van een layout: begint bij het papier van de layout zelf en wordt
  // niet onthouden. Het onthouden papier (inst.paper) hoort bij de modelruimte.
  const [layoutKeuze, setLayoutKeuze] = createStore({ ...LAYOUT_PAPIER_STANDAARD });
  const [vrijeDraaiing, setVrijeDraaiing] = createSignal(!VASTE_DRAAIINGEN.includes(inst.rotation));
  const [vrijeSchaal, setVrijeSchaal] = createSignal(inst.scale > 0 && !STANDAARDSCHALEN.includes(inst.scale));
  // Grenzen van de omzetter (kleurentabel, lettertabel, zoekpaden, beeldpunten).
  const [grenzen, setGrenzen] = createSignal(null);
  // Per zoekpad: bestaat de map (nog)? En wat het zoeken met de huidige
  // zoekpaden opleverde, als dat na de verkenning opnieuw gedaan is.
  const [padenOk, setPadenOk] = createSignal([]);
  const [gezocht, setGezocht] = createSignal(null);
  // Schaalnoemer van de meetschaal op de huidige pagina (voor "op schaal"), of null.
  const [paginaSchaal, setPaginaSchaal] = createSignal(null);
  // Wat de voorbeeldweergave te melden heeft (vereenvoudigd getekend).
  const [voorbeeldMelding, setVoorbeeldMelding] = createSignal(null);
  // Tekeningen die na deze aan de beurt komen (meerdere bestanden geopend of
  // gesleept); anders lijkt het of ze niet zijn aangekomen.
  const [wachtend, setWachtend] = createSignal(aantalInWachtrij());
  const stopWachtrij = luisterWachtrij(setWachtend);

  let job = null;
  let stopLuisteren = () => {};
  let afgebroken = false;
  let gesloten = false;
  let zoekJob = null;
  let gezochtMet = '';

  const doc = getActiveDocument();
  const heeftDocument = !!doc?.pdfDoc;
  const bezig = () => bezigMet() !== '';
  const getal = (n) => getalTekst(n, language());
  // Schaal in de notatie van de taal: 1:2,5 in het Nederlands, 1:2.5 in het Engels.
  const schaal = (n) => schaalTekst(n, decimaalTeken(language()));
  // Vaste id's, zodat elk label bij zijn veld hoort (schermlezers).
  const veld = (naam) => `cad-import-${naam}`;

  // ── Verkennen ────────────────────────────────────────────────────────────
  async function verken(bestand) {
    setFout('');
    setMelding(null);
    setScan(null);
    setBezigMet('scan');
    setVoortgang(null);
    setGezocht(null);
    afgebroken = false;
    // De verkenning zoekt externe bestanden ook in de gekozen mappen.
    const zoekpaden = schoonZoekpaden(inst.searchPaths, grenzen()?.maxSearchPaths);
    gezochtMet = JSON.stringify(zoekpaden);
    job = nieuwJobId('scan');
    const dezeJob = job;
    // Ook het lezen en verkennen melden hun voortgang: een grote tekening
    // staat anders seconden stil zonder dat er iets te zien is.
    let stopVerkennen = () => {};
    try {
      stopVerkennen = await luisterImportVoortgang((p) => {
        if (p.jobId === dezeJob && !gesloten) setVoortgang({ phase: p.phase, done: p.done, total: p.total });
      });
      const uitkomst = await verkenTekening(job, bestand, zoekpaden);
      if (gesloten) return;
      const ruimte = uitkomst.defaultSpace || 'model';
      setScan(uitkomst);
      setLayoutKeuze({ ...LAYOUT_PAPIER_STANDAARD });
      setRuimteId(ruimte);
      setUit(standaardUitgesloten(lagenVoorRuimte(uitkomst, ruimte), inst.skipNonPlottable));
      const g = ruimteVan(uitkomst, ruimte)?.bounds;
      if (g) setVenster({ x0: g[0], y0: g[1], x1: g[2], y1: g[3] });
    } catch (e) {
      if (!gesloten) toonFout(e);
    } finally {
      stopVerkennen();
      job = null;
      setVoortgang(null);
      setBezigMet('');
    }
  }

  onMount(async () => {
    // Tijdelijke PDF's van vorige keren opruimen (#400).
    ruimOudeImportsOp().catch(() => {});
    importGrenzen().then((g) => { if (!gesloten) setGrenzen(g); });
    if (heeftDocument) meetschaalHuidigePagina().then((n) => { if (!gesloten) setPaginaSchaal(n); });
    let bestand = pad();
    if (!bestand) {
      setBezigMet('');
      bestand = await kiesTekening();
      if (!bestand) {
        closeDialog('cad-import');
        return;
      }
      setPad(bestand);
    }
    verken(bestand);
  });

  onCleanup(() => {
    gesloten = true;
    stopWachtrij();
    if (job) annuleerImport(job);
    if (zoekJob) annuleerImport(zoekJob);
    stopLuisteren();
    laatTekeningLos();
    // Wachtte er nog een tekening (meerdere bestanden tegelijk geopend of
    // gesleept)? Die komt nu aan de beurt.
    setTimeout(() => { volgendeTekening().catch(() => {}); }, 0);
  });

  // ── Lagen en ruimte ──────────────────────────────────────────────────────
  const ruimte = createMemo(() => ruimteVan(scan(), ruimteId()));
  const lagen = createMemo(() => lagenVoorRuimte(scan(), ruimteId()));
  const zichtbareLagen = createMemo(() =>
    sorteerLagen(filterLagen(lagen(), zoek()), sortering().kolom, sortering().oplopend));
  const isModel = () => ruimte()?.kind !== 'layout';

  // Van ruimte wisselen: de lagen van die ruimte opnieuw voorstellen.
  createEffect(on(ruimteId, (id, vorige) => {
    if (!vorige || id === vorige) return;
    // Elke layout begint bij haar eigen papier.
    setLayoutKeuze({ ...LAYOUT_PAPIER_STANDAARD });
    setUit(standaardUitgesloten(lagenVoorRuimte(scan(), id), inst.skipNonPlottable));
    const g = ruimteVan(scan(), id)?.bounds;
    if (g) setVenster({ x0: g[0], y0: g[1], x1: g[2], y1: g[3] });
  }));

  const zetLaag = (naam, aan) => {
    const s = new Set(uit());
    if (aan) s.delete(naam.toUpperCase()); else s.add(naam.toUpperCase());
    setUit(s);
  };
  // "Alles", "Niets" en "Omkeren" werken op de gefilterde lijst.
  const zetZichtbare = (aan) => {
    const s = new Set(uit());
    for (const laag of zichtbareLagen()) {
      if (aan) s.delete(laag.name.toUpperCase()); else s.add(laag.name.toUpperCase());
    }
    setUit(s);
  };
  const keerOm = () => {
    const s = new Set(uit());
    for (const laag of zichtbareLagen()) {
      const k = laag.name.toUpperCase();
      if (s.has(k)) s.delete(k); else s.add(k);
    }
    setUit(s);
  };
  const sorteerOp = (kolom) => {
    const nu = sortering();
    setSortering(nu.kolom === kolom ? { kolom, oplopend: !nu.oplopend } : { kolom, oplopend: kolom !== 'objects' });
  };
  const sorteerTeken = (kolom) => (sortering().kolom === kolom ? (sortering().oplopend ? ' ▲' : ' ▼') : '');
  const aantalAan = createMemo(() => lagen().filter((l) => !uit().has(l.name.toUpperCase())).length);
  const statusTekst = (laag) => [
    laag.off ? t('cadImport.stateOff') : '',
    laag.frozen ? t('cadImport.stateFrozen') : '',
    laag.locked ? t('cadImport.stateLocked') : '',
    laag.plottable === false ? t('cadImport.stateNoPlot') : '',
  ].filter(Boolean).join(', ');

  // ── Gebied, eenheid, papier ──────────────────────────────────────────────
  const doel = () => effectiefDoel(inst.target, heeftDocument);
  const eenheid = () => (inst.units && inst.units !== 'file' ? inst.units : scan()?.units?.unit || 'mm');
  const mmPerEenheid = () => MM_PER_EENHEID[eenheid()] || 1;

  // Dezelfde omhullende als de omzetter: verborgen meegenomen lagen tellen mee.
  const lagenGebied = createMemo(() => gebiedUitLagen(lagen(), weggelatenLagen(lagen(), uit(), inst, doel())) || ruimte()?.bounds || null);
  const limitsBruikbaar = createMemo(() => limitsOmvatten(ruimte()?.limits, lagenGebied()));
  // Het gebied dat venster én omzetter gebruiken: onthouden limits die deze
  // tekening niet omsluiten, zijn extents (#400).
  const gebiedKeuze = createMemo(() => effectiefGebied(inst.area, limitsBruikbaar()));
  const gebied = createMemo(() => {
    const r = ruimte();
    if (!r) return null;
    if (!isModel()) return r.bounds || null;
    if (gebiedKeuze() === 'window') return vensterGeldig(venster) ? [venster.x0, venster.y0, venster.x1, venster.y1] : null;
    if (gebiedKeuze() === 'limits') return r.limits;
    return lagenGebied();
  });
  const vensterOk = createMemo(() => inst.area !== 'window' || !isModel() || vensterGeldig(venster));
  const basispunt = () => (inst.ownBasePoint ? [Number(inst.basePointX) || 0, Number(inst.basePointY) || 0] : scan()?.basePoint || [0, 0]);
  const maat = createMemo(() => gebiedMaatMm(gebied(), mmPerEenheid()));
  const voorstel = createMemo(() => (isModel() ? papierVoorstel(maat(), inst) : null));
  const verschuiving = createMemo(() =>
    (isModel() ? oorsprongVerschuiving(gebied(), inst, voorstel(), mmPerEenheid(), basispunt()) : null));
  const grootCoordinaat = createMemo(() => !!gebied()?.some((v) => Math.abs(v) > GROTE_COORDINAAT));
  const layoutPapier = () => ruimte()?.paper;
  // De pagina van een layout, met dezelfde regels als de omzetting.
  const layoutInhoud = createMemo(() => (isModel() ? null : gebiedMaatMm(ruimte()?.bounds, Number(layoutPapier()?.mmPerUnit) || 1)));
  const pagina = createMemo(() => (isModel() ? null : layoutPagina(layoutKeuze, layoutPapier(), layoutInhoud())));
  // Past de inhoud niet op het gekozen papier, dan kapt de omzetting haar af.
  const teKlein = createMemo(() => (isModel()
    ? papierTeKlein(modelInhoudOpPapier(maat(), inst, voorstel()), voorstel() && inst.paper !== 'auto' ? { ...voorstel(), bekend: true } : null)
    : papierTeKlein(layoutInhoud(), pagina())));
  const eenheidNoot = createMemo(() => eenheidMelding(scan()?.units, inst.units));

  // De argumenten van de omzetter, voor de import en voor het voorbeeld gelijk.
  // Een layout gebruikt haar eigen papierkeuze, niet het onthouden papier.
  const omzetArgumenten = (outputPath) => {
    const { excludedLayers, hiddenLayers } = lagenKeuze(lagen(), uit(), inst, doel());
    return importArgumenten({ ...inst, area: gebiedKeuze(), ...papierInstellingen(inst, isModel(), layoutKeuze) }, {
      path: pad(),
      outputPath,
      spaces: [ruimteId() || 'model'],
      excludedLayers,
      hiddenLayers,
      window: inst.area === 'window' ? [venster.x0, venster.y0, venster.x1, venster.y1] : null,
      limits: grenzen(),
      doel: doel(),
    });
  };
  const voorbeeldArgs = createMemo(() => (scan() && pad() && vensterOk() ? omzetArgumenten('') : null));

  const objecten = createMemo(() =>
    lagen().filter((l) => !uit().has(l.name.toUpperCase())).reduce((som, l) => som + (l.objects || 0), 0));

  // Tekst van de gekozen optie, als `title` op een korte keuzelijst: wat de
  // lijst afkapt, blijft zo leesbaar.
  const keuzeTekst = (waarde, sleutels) => (sleutels[waarde] ? t(`cadImport.${sleutels[waarde]}`) : String(waarde ?? ''));
  const richtingTekst = (waarde) => (waarde === 'portrait' ? t('cadImport.portrait') : waarde === 'landscape' ? t('cadImport.landscape') : t('cadImport.orientationAuto'));
  const papierOptie = (id) => {
    const f = PAPIERFORMATEN.find((x) => x.id === id);
    return f ? `${f.id} (${f.breedte}×${f.hoogte})` : keuzeTekst(id, { auto: 'paperAuto', custom: 'paperCustom' });
  };
  const papierTekst = (id, b, h) => (id === 'custom' || !id ? `${Math.round(b)}×${Math.round(h)} mm` : id);
  const samenvatting = createMemo(() => {
    // Het papier dat werkelijk gebruikt wordt (pure regels, unit-getest).
    const p = ruimte() ? papierSamenvatting(isModel(), voorstel(), pagina()) : null;
    const delen = [];
    if (p) {
      const vanLayout = p.papier === 'layout';
      if (vanLayout && !(p.breedteMm > 0)) delen.push(t('cadImport.layoutPaper'));
      else delen.push(`${papierTekst(vanLayout ? '' : p.papier, p.breedteMm, p.hoogteMm)} ${t(p.liggend ? 'cadImport.landscape' : 'cadImport.portrait')}`);
      delen.push(schaal(p.schaal));
    }
    delen.push(t('cadImport.layersOf', { on: getal(aantalAan()), total: getal(lagen().length) }));
    delen.push(t('cadImport.objects', { n: getal(objecten()) }));
    delen.push(t('cadImport.unitIs', {
      unit: eenheid(),
      source: scan()?.units?.fromFile && inst.units === 'file' ? t('cadImport.fromFile') : t('cadImport.chosen'),
    }));
    if (inst.preview && voorbeeldMelding()?.sleutel === 'previewSimplified') {
      delen.push(t('cadImport.previewSimplified', { n: getal(grenzen()?.previewSimpleAbove || 200000) }));
    }
    return delen.join(' · ');
  });

  const waarschuwingen = createMemo(() => leesWaarschuwingen(scan()?.warnings));
  const waarschuwingTekst = (w) => t(`cadImport.warn_${w.sleutel}`, { n: w.aantal ?? 0, value: w.waarde, defaultValue: w.sleutel });
  // Wat er van buiten de tekening gelezen wordt, bij naam: vóór de import wat
  // de verkenning naast de tekening vond, erna wat de import werkelijk las.
  const buiten = createMemo(() => {
    const verslag = melding()?.externals ? melding() : gezocht() || scan();
    return buitenBestanden(verslag?.externals, verslag?.externalsTruncated);
  });

  // Zoekpaden gewijzigd (map erbij, map weg, voorinstelling): nakijken welke
  // mappen bestaan en de externe bestanden opnieuw zoeken. De tekening wordt
  // daarvoor niet opnieuw gelezen, zodat de lagenkeuze blijft staan.
  const zoekpadenSleutel = createMemo(() => JSON.stringify(schoonZoekpaden(inst.searchPaths, grenzen()?.maxSearchPaths)));
  const padOk = (index) => padenOk()[index] !== false;
  createEffect(on([zoekpadenSleutel, scan], async ([sleutel, verkenning]) => {
    const zoekpaden = JSON.parse(sleutel);
    controleerZoekpaden(zoekpaden).then((ok) => {
      if (!gesloten && zoekpadenSleutel() === sleutel) setPadenOk(ok);
    });
    // Een zoekopdracht die nog loopt, hoort bij een vorige stand van de lijst.
    if (zoekJob) {
      annuleerImport(zoekJob);
      zoekJob = null;
    }
    if (!verkenning || sleutel === gezochtMet) return;
    const dezeJob = nieuwJobId('zoek');
    zoekJob = dezeJob;
    try {
      const uitkomst = await zoekBuitenBestanden(dezeJob, pad(), zoekpaden);
      if (gesloten || zoekJob !== dezeJob) return;
      gezochtMet = sleutel;
      setGezocht({ externals: uitkomst?.externals || [], externalsTruncated: uitkomst?.externalsTruncated === true });
    } catch {
      // Afgelost door een nieuwere zoekopdracht, of niet gelukt: de lijst van
      // de verkenning blijft staan en een volgende wijziging zoekt opnieuw.
    } finally {
      if (zoekJob === dezeJob) zoekJob = null;
    }
  }));

  // ── Importeren ───────────────────────────────────────────────────────────
  function toonFout(e) {
    const f = leesImportFout(e);
    if (f.sleutel === 'cancelled') setMelding({ soort: 'info', tekst: t('cadImport.cancelled') });
    else setFout(t(`cadImport.${f.sleutel}`, f));
  }

  function breekAf() {
    afgebroken = true;
    annuleerImport(job);
  }

  const sluit = () => {
    if (bezig()) breekAf();
    closeDialog('cad-import');
  };

  async function importeer() {
    const bestand = pad();
    if (!bestand || !scan() || !vensterOk()) return;
    // Gecontroleerd de voorkeuren in, zoals ze er ook weer uit komen.
    state.preferences.cadImportSettings = herstelCadImportInstellingen(JSON.parse(JSON.stringify(inst)));
    savePreferences();
    afgebroken = false;
    setFout('');
    setMelding(null);
    setBezigMet('import');
    job = nieuwJobId('import');
    const dezeJob = job;
    stopLuisteren = await luisterImportVoortgang((p) => {
      if (p.jobId === dezeJob) setVoortgang({ phase: p.phase, done: p.done, total: p.total });
    });
    try {
      const args = omzetArgumenten(await tijdelijkPdfPad(bestand));
      const verslag = await importeerTekening(dezeJob, args);
      if (afgebroken || gesloten) {
        // Net klaar toen er op Afbreken werd gedrukt: niets openen.
        await ruimOp(verslag.outputPath);
        if (!gesloten) setMelding({ soort: 'info', tekst: t('cadImport.cancelled') });
        return;
      }
      setVoortgang({ phase: 'open', done: 0, total: 0 });
      let opPagina = null;
      if (doel() === 'underlay') {
        opPagina = await legTekeningOpPagina(verslag.outputPath, {
          tekening: bestand,
          blad: verslag.pages?.[0],
          isModel: isModel(),
          dekking: inst.underlayOpacity,
          onder: inst.underlayBelow !== false,
          opSchaal: inst.underlayToScale !== false,
          alsAfbeelding: inst.underlayAsImage === true,
          dpi: inst.underlayDpi,
        });
      } else if (doel() === 'append') await voegImportToeAanDocument(verslag.outputPath);
      else await openImportAlsNieuwDocument(verslag.outputPath, bestand);

      const extra = leesWaarschuwingen(verslag.warnings);
      // Als afbeelding met een verlaagde resolutie: dat hoort de gebruiker te zien.
      const begrensd = opPagina?.begrensd ? ` ${t('cadImport.underlayLimited', { dpi: getal(opPagina.dpi || 0) })}` : '';
      if (!extra.length) {
        if (opPagina) updateStatusMessage(t('cadImport.underlayDone', { page: getal(opPagina.pagina) }) + begrensd);
        closeDialog('cad-import');
        return;
      }
      // Iets kwam niet mee (externe verwijzing, 3D-viewport, …): laten zien.
      const pagina = verslag.pages?.[0];
      setMelding({
        soort: 'ok',
        tekst: t('cadImport.done', {
          paper: pagina ? papierTekst(pagina.paper, pagina.widthMm, pagina.heightMm) : '',
          scale: pagina?.scaleText || '',
          objects: getal(pagina?.objects || 0),
          size: grootteTekst(verslag.fileSize),
        }) + begrensd,
        extra,
        externals: verslag.externals || [],
        externalsTruncated: verslag.externalsTruncated === true,
      });
    } catch (e) {
      if (!gesloten) toonFout(e);
    } finally {
      stopLuisteren();
      stopLuisteren = () => {};
      job = null;
      setVoortgang(null);
      setBezigMet('');
    }
  }

  const fase = createMemo(() => faseWeergave(voortgang(), bezigMet()));
  const faseTekst = () => {
    switch (fase().sleutel) {
      case 'reading': return t('cadImport.reading');
      case 'phaseScan': return t('cadImport.phaseScan', { pct: fase().pct ?? 0 });
      case 'phaseDraw': return t('cadImport.phaseDraw', { pct: fase().pct ?? 0 });
      case 'phaseWrite': return t('cadImport.phaseWrite', { pct: fase().pct ?? 0 });
      case 'phaseOpen': return t('cadImport.phaseOpen', { pct: fase().pct ?? 0 });
      default: return t('cadImport.phaseRead', { pct: fase().pct ?? 0 });
    }
  };
  const faseProcent = () => fase().pct;

  // ── Voorinstellingen ─────────────────────────────────────────────────────
  const pasVoorinstellingToe = (naam) => {
    const gevonden = voorinstellingen().find((v) => v.name === naam);
    if (!gevonden) return;
    setInst(herstelCadImportInstellingen(gevonden.settings));
    setVrijeDraaiing(!VASTE_DRAAIINGEN.includes(inst.rotation));
    setVrijeSchaal(inst.scale > 0 && !STANDAARDSCHALEN.includes(inst.scale));
    setVoorinstellingNaam(naam);
  };
  const bewaarVoorinstelling = () => {
    const naam = voorinstellingNaam().trim();
    if (!naam) return;
    const lijst = metVoorinstelling(voorinstellingen(), naam, inst);
    setVoorinstellingen(lijst);
    state.preferences.cadImportPresets = lijst;
    savePreferences();
  };
  const verwijderVoorinstelling = () => {
    const lijst = zonderVoorinstelling(voorinstellingen(), voorinstellingNaam());
    setVoorinstellingen(lijst);
    state.preferences.cadImportPresets = lijst;
    savePreferences();
    setVoorinstellingNaam('');
  };

  const footer = (
    <>
      <div class="cad-footer-status">
        <Show when={bezig()} fallback={
          <Show when={fout()} fallback={
            <Show when={melding()} fallback={<span class="cad-status" aria-live="polite">{samenvatting()}</span>}>
              <span class={`cad-status cad-status-${melding().soort}`} aria-live="polite">{melding().tekst}</span>
            </Show>
          }>
            <span class="cad-status cad-status-fout" role="alert">{fout()}</span>
          </Show>
        }>
          <span class="cad-status" aria-live="polite">{faseTekst()}</span>
          <div
            class="cad-progress"
            role="progressbar"
            aria-label={faseTekst()}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={faseProcent() ?? undefined}
          ><div class="cad-progress-bar" style={{ width: `${faseProcent() ?? 100}%`, opacity: faseProcent() === null ? 0.35 : 1 }} /></div>
        </Show>
      </div>
      <div class="crop-margins-footer-right">
        <Show when={bezig()} fallback={
          <>
            <Show when={melding()?.soort !== 'ok'}>
              <button class="pref-btn pref-btn-primary" disabled={!scan() || !vensterOk()} onClick={importeer}>{t('cadImport.import')}</button>
            </Show>
            <button class="pref-btn pref-btn-secondary" onClick={sluit}>{melding()?.soort === 'ok' ? tCommon('close') : tCommon('cancel')}</button>
          </>
        }>
          <button class="pref-btn pref-btn-secondary" onClick={breekAf}>{t('cadImport.stop')}</button>
        </Show>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('cadImport.title')}
      overlayClass="cad-overlay"
      dialogClass={`cad-dialog cad-dialog-import${inst.preview ? ' cad-dialog-voorbeeld' : ''}`}
      headerClass="crop-margins-header"
      bodyClass="cad-body"
      footerClass="cad-footer"
      onClose={sluit}
      footer={footer}
    >
      <div class="cad-row cad-file-row">
        <label class="cad-label">{t('cadImport.drawing')}</label>
        <span class="cad-file-name" title={pad()}>{pad().split(/[\\/]/).pop() || '—'}</span>
        <Show when={scan()}>
          <span class="cad-note cad-file-info">{`${String(scan().format || '').toUpperCase()} ${scan().version || ''} · ${grootteTekst(scan().fileBytes)}`}</span>
        </Show>
        <Show when={wachtend() > 0}>
          <span class="cad-note cad-file-info" aria-live="polite">{t('cadImport.queued', { n: getal(wachtend()) })}</span>
        </Show>
        <button class="pref-btn cad-small-btn" disabled={bezig()} onClick={async () => {
          const gekozen = await kiesTekening(pad());
          if (gekozen) { setPad(gekozen); verken(gekozen); }
        }}>{t('cadImport.browse')}</button>
      </div>

      <div class="cad-tabs" role="tablist" aria-label={t('cadImport.title')}>
        <For each={TABS}>
          {(id) => (
            <button
              id={`cad-tab-${id}`}
              class={`cad-tab${tab() === id ? ' active' : ''}`}
              role="tab"
              type="button"
              aria-selected={tab() === id}
              aria-controls={`cad-panel-${id}`}
              tabIndex={tab() === id ? 0 : -1}
              onKeyDown={(e) => {
                const stap = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!stap) return;
                e.preventDefault();
                const volgende = TABS[(TABS.indexOf(tab()) + stap + TABS.length) % TABS.length];
                setTab(volgende);
                document.getElementById(`cad-tab-${volgende}`)?.focus();
              }}
              onClick={() => setTab(id)}
            >{t(`cadImport.tab_${id}`)}</button>
          )}
        </For>
      </div>

      <div class="cad-main">
      <fieldset class="cad-fieldset cad-panels" disabled={bezig() || !scan()}>
        {/* Lagen */}
        <div id="cad-panel-layers" role="tabpanel" aria-labelledby="cad-tab-layers" aria-hidden={tab() !== 'layers'} class="cad-tab-content" classList={{ active: tab() === 'layers' }}>
          <div class="cad-row cad-layer-tools">
            <button class="pref-btn cad-small-btn" onClick={() => zetZichtbare(true)}>{t('cadImport.all')}</button>
            <button class="pref-btn cad-small-btn" onClick={() => zetZichtbare(false)}>{t('cadImport.none')}</button>
            <button class="pref-btn cad-small-btn" onClick={keerOm}>{t('cadImport.invert')}</button>
            <input type="text" class="cad-input cad-input-wide" aria-label={t('cadImport.filterPlaceholder')}
              placeholder={t('cadImport.filterPlaceholder')} title={t('cadImport.filterHint')}
              value={zoek()} onInput={(e) => setZoek(e.target.value)} />
          </div>
          {/* Een tabel voor schermlezers: kopregel met kolomkoppen (daar hoort
              aria-sort), per laag een rij met cellen onder die koppen. */}
          <div class="cad-layer-list" role="table" aria-label={t('cadImport.tab_layers')}>
            <div class="cad-layer-head" role="row">
              <span class="cad-col-check" role="columnheader" aria-label={t('cadImport.colInclude')} />
              <For each={KOLOMMEN}>
                {(k) => (
                  <span
                    class={k.cls}
                    role="columnheader"
                    aria-label={k.label ? t(`cadImport.${k.label}`) : t('cadImport.colColour')}
                    aria-sort={sortering().kolom === k.id ? (sortering().oplopend ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" class="cad-sort" title={t('cadImport.sortBy')} onClick={() => sorteerOp(k.id)}>
                      {k.label ? t(`cadImport.${k.label}`) : ''}{sorteerTeken(k.id)}
                    </button>
                  </span>
                )}
              </For>
            </div>
            <For each={zichtbareLagen()}>
              {(laag) => (
                <label class="cad-layer-row" role="row">
                  <span class="cad-col-check" role="cell"><input type="checkbox" aria-label={laag.name} checked={!uit().has(laag.name.toUpperCase())} onChange={(e) => zetLaag(laag.name, e.target.checked)} /></span>
                  <span class="cad-col-color" role="cell"><span class="cad-swatch" style={{ background: laag.color || '#ffffff' }} /></span>
                  <span class="cad-col-name" role="cell" title={laag.name}>{laag.name}</span>
                  <span class="cad-col-count" role="cell">{getal(laag.objects || 0)}</span>
                  <span class="cad-col-state" role="cell">{statusTekst(laag)}</span>
                </label>
              )}
            </For>
          </div>
          <div class="cad-note">{t('cadImport.layersSelected', { on: getal(aantalAan()), total: getal(lagen().length), shown: getal(zichtbareLagen().length) })}</div>
          <label class="cad-check"><input type="checkbox" checked={inst.skipNonPlottable} onChange={(e) => {
            setInst('skipNonPlottable', e.target.checked);
            setUit(zetNietPlotbaar(lagen(), uit(), e.target.checked));
          }} /> {t('cadImport.skipNoPlot')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.layersAsOcg} onChange={(e) => setInst('layersAsOcg', e.target.checked)} /> {t('cadImport.layersAsOcg')}</label>
          <label class="cad-check" classList={{ 'cad-disabled': !inst.layersAsOcg || doel() === 'underlay' }}>
            <input type="checkbox" checked={inst.includeOffLayers && inst.layersAsOcg && doel() !== 'underlay'} disabled={!inst.layersAsOcg || doel() === 'underlay'}
              onChange={(e) => setInst('includeOffLayers', e.target.checked)} /> {t('cadImport.includeOff')}
          </label>
        </div>

        {/* Coördinaten */}
        <div id="cad-panel-coordinates" role="tabpanel" aria-labelledby="cad-tab-coordinates" aria-hidden={tab() !== 'coordinates'} class="cad-tab-content" classList={{ active: tab() === 'coordinates' }}>
          <div class="cad-row">
            <label class="cad-label" for={veld('space')}>{t('cadImport.space')}</label>
            <select id={veld('space')} class="cad-select" value={ruimteId()} onChange={(e) => setRuimteId(e.target.value)}>
              <For each={scan()?.spaces || []}>
                {(r) => (
                  <option value={r.id} selected={r.id === ruimteId()}>
                    {r.kind === 'model' ? t('cadImport.modelSpace') : r.label}
                    {` (${t('cadImport.objects', { n: getal(r.objects || 0) })}${r.viewports?.length ? `, ${t('cadImport.viewports', { n: getal(r.viewports.length) })}` : ''})`}
                  </option>
                )}
              </For>
            </select>
          </div>

          <div class="cad-row">
            <label class="cad-label" for={veld('units')}>{t('cadImport.units')}</label>
            <select id={veld('units')} class="cad-select cad-select-short" value={inst.units}
              title={inst.units === 'file' ? t('cadImport.unitsFile', { unit: scan()?.units?.unit || '—' }) : inst.units}
              onChange={(e) => setInst('units', e.target.value)}>
              <option value="file">{t('cadImport.unitsFile', { unit: scan()?.units?.unit || '—' })}</option>
              <For each={['mm', 'cm', 'm', 'in', 'ft']}>{(u) => <option value={u}>{u}</option>}</For>
            </select>
            <Show when={eenheidNoot()}>
              <span class="cad-note cad-note-warn">{t(`cadImport.${eenheidNoot().sleutel}`, { value: eenheidNoot().value })}</span>
            </Show>
          </div>

          <Show when={isModel()} fallback={
            <>
              <div class="cad-note">{t('cadImport.layoutNote')}</div>
              <div class="cad-row">
                <label class="cad-label" for={veld('layout-paper')}>{t('cadImport.paper')}</label>
                <select id={veld('layout-paper')} class="cad-select cad-select-short" value={layoutKeuze.paper}
                  title={keuzeTekst(layoutKeuze.paper, { auto: 'paperLayout', custom: 'paperCustom' })}
                  onChange={(e) => setLayoutKeuze('paper', e.target.value)}>
                  <option value="auto">{t('cadImport.paperLayout')}</option>
                  <For each={PAPIERFORMATEN}>{(p) => <option value={p.id}>{p.id}</option>}</For>
                  <option value="custom">{t('cadImport.paperCustom')}</option>
                </select>
                <select class="cad-select cad-select-short" value={layoutKeuze.orientation}
                  title={richtingTekst(layoutKeuze.orientation)}
                  disabled={layoutKeuze.paper === 'auto' || layoutKeuze.paper === 'custom'}
                  onChange={(e) => setLayoutKeuze('orientation', e.target.value)}>
                  <option value="auto">{t('cadImport.orientationAuto')}</option>
                  <option value="portrait">{t('cadImport.portrait')}</option>
                  <option value="landscape">{t('cadImport.landscape')}</option>
                </select>
                <Show when={layoutKeuze.paper === 'auto' && pagina()?.bekend}>
                  <span class="cad-note">{`${layoutPapier().name} · ${Math.round(pagina().breedteMm)}×${Math.round(pagina().hoogteMm)} mm`}</span>
                </Show>
              </div>
              <Show when={layoutKeuze.paper === 'custom'}>
                <div class="cad-row">
                  <label class="cad-label">{t('cadImport.paperSize')}</label>
                  <input type="number" class="cad-input cad-input-short" min="1" max={MAX_PAGINA_MM} value={layoutKeuze.paperWidthMm} onChange={(e) => setLayoutKeuze('paperWidthMm', papiermaatMm(e.target.value, 297))} />
                  <span class="cad-note">×</span>
                  <input type="number" class="cad-input cad-input-short" min="1" max={MAX_PAGINA_MM} value={layoutKeuze.paperHeightMm} onChange={(e) => setLayoutKeuze('paperHeightMm', papiermaatMm(e.target.value, 420))} />
                  <span class="cad-note">mm</span>
                </div>
              </Show>
              <Show when={teKlein()}>
                <div class="cad-note cad-note-warn" role="alert">{t('cadImport.paperTooSmall', { width: getal(teKlein().width), height: getal(teKlein().height) })}</div>
              </Show>
            </>
          }>
            <div class="cad-row cad-row-top">
              <label class="cad-label">{t('cadImport.area')}</label>
              <div class="cad-stack">
                <label class="cad-radio"><input type="radio" name="cad-import-area" checked={inst.area === 'extents'} onChange={() => setInst('area', 'extents')} /> {t('cadImport.areaExtents')}</label>
                <label class="cad-radio" classList={{ 'cad-disabled': !limitsBruikbaar() }}><input type="radio" name="cad-import-area" checked={inst.area === 'limits' && limitsBruikbaar()} disabled={!limitsBruikbaar()} onChange={() => setInst('area', 'limits')} /> {t('cadImport.areaLimits')}</label>
                <label class="cad-radio"><input type="radio" name="cad-import-area" checked={inst.area === 'window'} onChange={() => setInst('area', 'window')} /> {t('cadImport.areaWindow')}</label>
              </div>
            </div>
            <Show when={inst.area === 'window'}>
              <Show when={!vensterGeldig(venster)}>
                <div class="cad-note cad-note-warn" role="alert">{t('cadImport.windowInvalid')}</div>
              </Show>
              <div class="cad-row">
                <label class="cad-label">{t('cadImport.windowFrom')}</label>
                <input type="number" class="cad-input cad-input-short" value={venster.x0} onChange={(e) => setVenster('x0', Number(e.target.value) || 0)} />
                <input type="number" class="cad-input cad-input-short" value={venster.y0} onChange={(e) => setVenster('y0', Number(e.target.value) || 0)} />
                <label class="cad-label cad-label-short">{t('cadImport.windowTo')}</label>
                <input type="number" class="cad-input cad-input-short" value={venster.x1} onChange={(e) => setVenster('x1', Number(e.target.value) || 0)} />
                <input type="number" class="cad-input cad-input-short" value={venster.y1} onChange={(e) => setVenster('y1', Number(e.target.value) || 0)} />
              </div>
            </Show>
            <div class="cad-row">
              <label class="cad-label">{t('cadImport.scale')}</label>
              <select class="cad-select cad-select-short" value={vrijeSchaal() ? 'custom' : String(inst.scale)}
                title={vrijeSchaal() ? t('cadImport.scaleCustom') : inst.scale > 0 ? schaal(inst.scale) : t('cadImport.scaleFit')}
                onChange={(e) => {
                if (e.target.value === 'custom') {
                  setVrijeSchaal(true);
                  if (!(inst.scale > 0)) setInst('scale', voorstel()?.schaal || 100);
                  return;
                }
                setVrijeSchaal(false);
                setInst('scale', Number(e.target.value));
              }}>
                <option value="0">{t('cadImport.scaleFit')}</option>
                <For each={STANDAARDSCHALEN}>{(n) => <option value={String(n)}>{schaal(n)}</option>}</For>
                <option value="custom">{t('cadImport.scaleCustom')}</option>
              </select>
              <Show when={vrijeSchaal()}>
                <span class="cad-note">1 :</span>
                <input type="number" class="cad-input cad-input-short" min="0.01" step="any" value={inst.scale}
                  onChange={(e) => setInst('scale', Math.max(0.01, Number(e.target.value) || 100))} />
              </Show>
              <Show when={!(inst.scale > 0) && voorstel()}>
                <span class="cad-note">{t('cadImport.scaleSuggestion', { scale: schaal(voorstel().schaal) })}</span>
              </Show>
            </div>
            <div class="cad-row">
              <label class="cad-label">{t('cadImport.paper')}</label>
              <select class="cad-select cad-select-short" value={inst.paper} title={papierOptie(inst.paper)} onChange={(e) => setInst('paper', e.target.value)}>
                <option value="auto">{t('cadImport.paperAuto')}</option>
                <For each={PAPIERFORMATEN}>{(p) => <option value={p.id}>{`${p.id} (${p.breedte}×${p.hoogte})`}</option>}</For>
                <option value="custom">{t('cadImport.paperCustom')}</option>
              </select>
              <select class="cad-select cad-select-short" value={inst.orientation} title={richtingTekst(inst.orientation)} disabled={inst.paper === 'custom'} onChange={(e) => setInst('orientation', e.target.value)}>
                <option value="auto">{t('cadImport.orientationAuto')}</option>
                <option value="portrait">{t('cadImport.portrait')}</option>
                <option value="landscape">{t('cadImport.landscape')}</option>
              </select>
              <Show when={voorstel()}>
                <span class="cad-note">{`${papierTekst(voorstel().papier, voorstel().breedteMm, voorstel().hoogteMm)} ${t(voorstel().liggend ? 'cadImport.landscape' : 'cadImport.portrait')}`}</span>
              </Show>
            </div>
            <Show when={teKlein()}>
              <div class="cad-note cad-note-warn" role="alert">{t('cadImport.paperTooSmall', { width: getal(teKlein().width), height: getal(teKlein().height) })}</div>
            </Show>
            <Show when={inst.paper === 'custom'}>
              <div class="cad-row">
                <label class="cad-label">{t('cadImport.paperSize')}</label>
                <input type="number" class="cad-input cad-input-short" min="1" max={MAX_PAGINA_MM} value={inst.paperWidthMm} onChange={(e) => setInst('paperWidthMm', papiermaatMm(e.target.value, 297))} />
                <span class="cad-note">×</span>
                <input type="number" class="cad-input cad-input-short" min="1" max={MAX_PAGINA_MM} value={inst.paperHeightMm} onChange={(e) => setInst('paperHeightMm', papiermaatMm(e.target.value, 420))} />
                <span class="cad-note">mm</span>
              </div>
            </Show>
            <div class="cad-row">
              <label class="cad-label">{t('cadImport.margin')}</label>
              <input type="number" class="cad-input cad-input-short" min="0" max="200" value={inst.marginMm} onChange={(e) => setInst('marginMm', Math.min(200, Math.max(0, Number(e.target.value) || 0)))} />
              <span class="cad-note">mm</span>
              <label class="cad-label cad-label-short">{t('cadImport.rotation')}</label>
              <select class="cad-select cad-select-short" value={vrijeDraaiing() ? 'custom' : String(inst.rotation)}
                title={vrijeDraaiing() ? t('cadImport.rotationCustom') : `${inst.rotation}°`}
                onChange={(e) => {
                if (e.target.value === 'custom') { setVrijeDraaiing(true); return; }
                setVrijeDraaiing(false);
                setInst('rotation', Number(e.target.value));
              }}>
                <For each={VASTE_DRAAIINGEN}>{(g) => <option value={String(g)}>{`${g}°`}</option>}</For>
                <option value="custom">{t('cadImport.rotationCustom')}</option>
              </select>
              <Show when={vrijeDraaiing()}>
                <input type="number" class="cad-input cad-input-short" min="-360" max="360" step="any" value={inst.rotation}
                  onChange={(e) => setInst('rotation', Math.min(360, Math.max(-360, Number(e.target.value) || 0)))} />
                <span class="cad-note">°</span>
              </Show>
            </div>
            <div class="cad-row">
              <label class="cad-label" for={veld('placement')}>{t('cadImport.placement')}</label>
              <select id={veld('placement')} class="cad-select" value={inst.placement} onChange={(e) => setInst('placement', e.target.value)}>
                <option value="center">{t('cadImport.placementCenter')}</option>
                <option value="lower_left">{t('cadImport.placementLowerLeft')}</option>
                <option value="origin">{t('cadImport.placementOrigin')}</option>
              </select>
            </div>
            <Show when={inst.placement === 'origin'}>
              <div class="cad-row">
                <label class="cad-check">
                  <input type="checkbox" checked={inst.ownBasePoint} onChange={(e) => setInst('ownBasePoint', e.target.checked)} />
                  {t('cadImport.ownBasePoint')}
                </label>
                <Show when={inst.ownBasePoint}>
                  <input type="number" class="cad-input cad-input-short" step="any" aria-label="X" value={inst.basePointX}
                    onChange={(e) => setInst('basePointX', Number(e.target.value) || 0)} />
                  <input type="number" class="cad-input cad-input-short" step="any" aria-label="Y" value={inst.basePointY}
                    onChange={(e) => setInst('basePointY', Number(e.target.value) || 0)} />
                </Show>
              </div>
              <Show when={!inst.ownBasePoint && scan()?.basePoint}>
                <div class="cad-note">{t('cadImport.basePoint', { x: getal(scan().basePoint[0]), y: getal(scan().basePoint[1]), unit: eenheid() })}</div>
              </Show>
            </Show>
            <Show when={maat()}>
              <div class="cad-note">{t('cadImport.areaSize', { width: getal(Math.round(maat().breedte)), height: getal(Math.round(maat().hoogte)) })}</div>
            </Show>
            <Show when={verschuiving()}>
              <div class="cad-note" classList={{ 'cad-note-warn': grootCoordinaat() }}>
                {t('cadImport.originShift', { x: getal(verschuiving().x), y: getal(verschuiving().y), unit: eenheid() })}
                {grootCoordinaat() ? ` ${t('cadImport.largeCoordinates')}` : ''}
              </div>
            </Show>
          </Show>
          <label class="cad-check" classList={{ 'cad-disabled': doel() === 'underlay' }}>
            <input type="checkbox" checked={inst.measure && doel() !== 'underlay'} disabled={doel() === 'underlay'} onChange={(e) => setInst('measure', e.target.checked)} /> {t('cadImport.measure')}
          </label>
          <label class="cad-check" classList={{ 'cad-disabled': doel() === 'underlay' }}>
            <input type="checkbox" checked={inst.modelMatrix && doel() !== 'underlay'} disabled={doel() === 'underlay'} onChange={(e) => setInst('modelMatrix', e.target.checked)} /> {t('cadImport.modelMatrix')}
          </label>
          <Show when={doel() === 'underlay'}>
            <div class="cad-note">{t('cadImport.underlayNoMeasure')}</div>
          </Show>
        </div>

        {/* Weergave */}
        <div id="cad-panel-view" role="tabpanel" aria-labelledby="cad-tab-view" aria-hidden={tab() !== 'view'} class="cad-tab-content cad-tab-scroll" classList={{ active: tab() === 'view' }}>
          <div class="cad-row">
            <label class="cad-label" for={veld('colors')}>{t('cadImport.colors')}</label>
            <select id={veld('colors')} class="cad-select" value={inst.colors} onChange={(e) => setInst('colors', e.target.value)}>
              <option value="file">{t('cadImport.colorsFile')}</option>
              <option value="black">{t('cadImport.colorsBlack')}</option>
              <option value="gray">{t('cadImport.colorsGray')}</option>
              <option value="mono">{t('cadImport.colorsMono')}</option>
              <option value="single">{t('cadImport.colorsSingle')}</option>
            </select>
          </div>
          <CadKleurstand inst={inst} setInst={setInst} />
          <div class="cad-row">
            <label class="cad-label" for={veld('lineweight')}>{t('cadImport.lineweight')}</label>
            <select id={veld('lineweight')} class="cad-select cad-select-short" value={inst.lineweight}
              title={keuzeTekst(inst.lineweight, { file: 'lineweightFile', fixed: 'lineweightFixed', pens: 'lineweightPens' })}
              onChange={(e) => setInst('lineweight', e.target.value)}>
              <option value="file">{t('cadImport.lineweightFile')}</option>
              <option value="fixed">{t('cadImport.lineweightFixed')}</option>
              <option value="pens">{t('cadImport.lineweightPens')}</option>
            </select>
            <input type="number" class="cad-input cad-input-short" step="0.05" min="0" max="5" value={inst.lineweightMm}
              disabled={inst.lineweight !== 'fixed'} onChange={(e) => setInst('lineweightMm', Math.min(5, Math.max(0, Number(e.target.value) || 0.25)))} />
            <span class="cad-note">mm</span>
          </div>
          <Show when={inst.lineweight === 'pens'}>
            <CadKleurentabel inst={inst} setInst={setInst} lagen={() => scan()?.layers} maxPennen={grenzen()?.maxPens} />
          </Show>
          <div class="cad-row">
            <label class="cad-label">{t('cadImport.lineweightFactor')}</label>
            <input type="number" class="cad-input cad-input-short" step="0.1" min="0.1" max="10" value={inst.lineweightFactor}
              onChange={(e) => setInst('lineweightFactor', Math.min(10, Math.max(0.1, Number(e.target.value) || 1)))} />
            <label class="cad-label cad-label-short">{t('cadImport.lineweightMin')}</label>
            <input type="number" class="cad-input cad-input-short" step="0.01" min="0" max="5" value={inst.lineweightMinMm}
              onChange={(e) => setInst('lineweightMinMm', Math.min(5, Math.max(0, Number(e.target.value) || 0)))} />
            <span class="cad-note">mm</span>
          </div>
          <div class="cad-row">
            <label class="cad-label" for={veld('hatch')}>{t('cadImport.hatch')}</label>
            <select id={veld('hatch')} class="cad-select" value={inst.hatch} onChange={(e) => setInst('hatch', e.target.value)}>
              <option value="all">{t('cadImport.hatchAll')}</option>
              <option value="solid_only">{t('cadImport.hatchSolid')}</option>
              <option value="outline">{t('cadImport.hatchOutline')}</option>
              <option value="none">{t('cadImport.hatchNone')}</option>
            </select>
          </div>
          <label class="cad-check"><input type="checkbox" checked={inst.linetypes} onChange={(e) => setInst('linetypes', e.target.checked)} /> {t('cadImport.linetypes')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.text} onChange={(e) => setInst('text', e.target.checked)} /> {t('cadImport.text')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.dimensions} onChange={(e) => setInst('dimensions', e.target.checked)} /> {t('cadImport.dimensions')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.attributes} onChange={(e) => setInst('attributes', e.target.checked)} /> {t('cadImport.attributes')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.points} onChange={(e) => setInst('points', e.target.checked)} /> {t('cadImport.points')}</label>
          <CadLettertabel inst={inst} setInst={setInst} scan={scan} maxLetters={grenzen()?.maxFontRules} />
          <CadBuitenBestanden inst={inst} setInst={setInst} buiten={buiten} padOk={padOk} bezig={bezig}
            maxZoekpaden={grenzen()?.maxSearchPaths} kiesMap={() => kiesZoekpad(t('cadImport.searchPathAdd'))} />
          <CadGeavanceerd inst={inst} setInst={setInst} maxBeeldpunten={grenzen()?.maxImagePixels} />
        </div>
      </fieldset>
      <Show when={inst.preview}>
        <CadImportPreview
          args={voorbeeldArgs()}
          actief={!bezig() && !!scan() && melding()?.soort !== 'ok'}
          mmPerEenheid={mmPerEenheid()}
          draaiing={inst.rotation}
          marge={isModel() ? inst.marginMm : 0}
          onVenster={isModel() ? (v) => { setInst('area', 'window'); setVenster(v); } : undefined}
          onMelding={setVoorbeeldMelding}
        />
      </Show>
      </div>

      <div class="cad-row cad-import-bottom">
        <label class="cad-label" for={veld('target')}>{t('cadImport.target')}</label>
        <select id={veld('target')} class="cad-select cad-select-target" value={doel()} disabled={bezig()} onChange={(e) => setInst('target', e.target.value)}>
          <option value="new">{t('cadImport.targetNew')}</option>
          <option value="append" disabled={!heeftDocument}>{t('cadImport.targetAppend')}</option>
          <option value="underlay" disabled={!heeftDocument}>{t('cadImport.targetUnderlay')}</option>
        </select>
        <label class="cad-check cad-voorbeeld-schakelaar">
          <input type="checkbox" checked={inst.preview} disabled={bezig()} onChange={(e) => { setInst('preview', e.target.checked); setVoorbeeldMelding(null); }} />
          {inst.preview ? t('cadImport.preview') : t('cadImport.previewOff')}
        </label>
      </div>
      <Show when={doel() === 'underlay'}>
        <div class="cad-row cad-import-underlay">
          <label class="cad-label" for={veld('opacity')}>{t('cadImport.underlayOpacity')}</label>
          <input
            id={veld('opacity')} type="number" class="cad-input cad-input-short" min="5" max="100" step="5" disabled={bezig()}
            value={inst.underlayOpacity}
            onChange={(e) => setInst('underlayOpacity', Math.round(Math.min(100, Math.max(5, Number(e.target.value) || 50))))}
          />
          <span class="cad-note">%</span>
          <label class="cad-check" title={!isModel() || !paginaSchaal() ? t('cadImport.underlayNoScale') : schaal(paginaSchaal())}>
            <input type="checkbox" checked={inst.underlayToScale && isModel() && !!paginaSchaal()} disabled={bezig() || !isModel() || !paginaSchaal()}
              onChange={(e) => setInst('underlayToScale', e.target.checked)} />
            {t('cadImport.underlayToScale')}
            <Show when={isModel() && paginaSchaal()}><span class="cad-note">{schaal(Math.round(paginaSchaal() * 100) / 100)}</span></Show>
          </label>
          <label class="cad-check">
            <input type="checkbox" checked={inst.underlayBelow && !inst.underlayAsImage} disabled={bezig() || inst.underlayAsImage}
              onChange={(e) => setInst('underlayBelow', e.target.checked)} />
            {t('cadImport.underlayBelow')}
          </label>
          <label class="cad-check">
            <input type="checkbox" checked={inst.underlayAsImage} disabled={bezig()} onChange={(e) => setInst('underlayAsImage', e.target.checked)} />
            {t('cadImport.underlayAsImage')}
          </label>
          <select class="cad-select cad-select-short" aria-label={t('cadImport.underlayResolution')} title={t('cadImport.underlayResolution')}
            value={String(inst.underlayDpi)} disabled={bezig() || !inst.underlayAsImage}
            onChange={(e) => setInst('underlayDpi', Number(e.target.value))}>
            <For each={ONDERLEGGER_DPI}>{(dpi) => <option value={String(dpi)}>{`${dpi} dpi`}</option>}</For>
          </select>
        </div>
        <Show when={isModel() && !paginaSchaal()}>
          <div class="cad-note cad-note-indent">{t('cadImport.underlayNoScale')}</div>
        </Show>
      </Show>
      <div class="cad-row cad-import-presets">
        <label class="cad-label">{t('cadImport.preset')}</label>
        <select class="cad-select cad-select-short" value={voorinstellingNaam()} title={voorinstellingNaam()} disabled={bezig()} onChange={(e) => pasVoorinstellingToe(e.target.value)}>
          <option value="">—</option>
          <For each={voorinstellingen()}>{(v) => <option value={v.name}>{v.name}</option>}</For>
        </select>
        <input type="text" class="cad-input" placeholder={t('cadImport.presetName')} value={voorinstellingNaam()} onInput={(e) => setVoorinstellingNaam(e.target.value)} />
        <button class="pref-btn cad-small-btn" disabled={bezig() || !voorinstellingNaam().trim()} onClick={bewaarVoorinstelling}>{t('cadImport.presetSave')}</button>
        <button class="pref-btn cad-small-btn" disabled={bezig() || !voorinstellingen().some((v) => v.name === voorinstellingNaam())} onClick={verwijderVoorinstelling}>{t('cadImport.presetDelete')}</button>
      </div>

      <Show when={waarschuwingen().length || melding()?.extra?.length}>
        <div class="cad-note cad-note-warn cad-warnings">
          <For each={melding()?.extra?.length ? melding().extra : waarschuwingen()}>
            {(w) => <span class="cad-warn-item">{waarschuwingTekst(w)}</span>}
          </For>
        </div>
      </Show>
      <Show when={buiten().length}>
        <div class="cad-note cad-externals">
          <For each={buiten()}>
            {(regel) => {
              const tekst = () => t(`cadImport.${regel.sleutel}`, { files: regel.namen });
              return <div class="cad-externals-row" title={tekst()}>{tekst()}</div>;
            }}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
