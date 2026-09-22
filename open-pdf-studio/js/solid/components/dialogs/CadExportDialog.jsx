import { createSignal, createMemo, createEffect, on, onMount, onCleanup, Show, For, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { herstelCadExportInstellingen } from '../../stores/cad-export-instellingen.js';
import {
  MAX_ENTITEITEN, appRechthoekNaarWeergave, vensterNaarWeergave, bestandenPerPagina, exportArgumenten,
  leesTeGroot, leesExportFout, voegTellingenSamen, objectenNaUitsluiten, grootteTekst, schaalTekst, formaatUitPad, padMetFormaat,
  modelOorsprongMogelijk,
} from '../../../pdf/cad-export-logica.js';
import { getalTekst } from '../../../pdf/cad-import-logica.js';
import {
  nieuwJobId, paginaMaat, gebiedenOpPagina, meetschaalOp, scanPagina, exporteerPagina, annuleer,
  luisterVoortgang, kiesDoelbestand,
} from '../../../pdf/cad-export.js';
import { revealInFileManager } from '../../../core/file-manager-reveal.js';

// Tellen kost bij zware bladen seconden per pagina: niet meer dan dit aantal
// pagina's vooraf tellen, de rest volgt bij de export zelf.
const MAX_SCAN_PAGINAS = 30;
const TABS = ['general', 'layers', 'area', 'geometry'];
const KLEUR = (c) => `rgb(${c?.r ?? 0}, ${c?.g ?? 0}, ${c?.b ?? 0})`;

export default function CadExportDialog() {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  // Aantallen in de notatie van de app-taal, zoals het importvenster (niet
  // die van het systeem: n.toLocaleString() pakt navigator.language).
  const getal = (n) => getalTekst(n, language());
  const doc = getActiveDocument();
  const totalPages = doc?.pdfDoc?.numPages || 1;
  const currentPage = doc?.currentPage || 1;

  const [inst, setInst] = createStore(herstelCadExportInstellingen(state.preferences?.cadExportSettings));
  const [tab, setTab] = createSignal('general');
  const [doel, setDoel] = createSignal('');

  // Gebied en oorsprong (horen bij dit document; niet onthouden).
  const [gebiedKeuze, setGebiedKeuze] = createSignal('page');
  const [venster, setVenster] = createStore({ x: 0, y: 0, breedte: 100, hoogte: 100 });
  const [maat, setMaat] = createSignal(null);
  const gebieden = gebiedenOpPagina(doc, currentPage);

  // Lagen uit de telronde.
  const [lagen, setLagen] = createSignal([]);
  const [uit, setUit] = createSignal(new Set());
  const [zoek, setZoek] = createSignal('');
  const [scan, setScan] = createSignal({ bezig: false, pagina: 0, fout: '' });

  // Export.
  const [bezig, setBezig] = createSignal(false);
  const [voortgang, setVoortgang] = createSignal(null);
  const [melding, setMelding] = createSignal(null);
  const [teGroot, setTeGroot] = createSignal(null);
  const [laatstePad, setLaatstePad] = createSignal('');

  let scanJob = null;
  let exportJob = null;
  let afgebroken = false;
  let stopLuisteren = () => {};

  const paginas = createMemo(() => {
    if (inst.range === 'all') return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (inst.range === 'custom') return parsePageRange(inst.customPages || '', totalPages);
    return [currentPage];
  });

  const gekozenGebied = createMemo(() => gebieden.find((g) => g.id === gebiedKeuze()) || null);
  const alleenHuidige = () => paginas().length === 1 && paginas()[0] === currentPage;

  // Meetschaal van de app voor de huidige pagina (of het gekozen gebied).
  const meetschaal = createMemo(() => {
    const g = gekozenGebied();
    if (g?.schaal) return g.schaal;
    return meetschaalOp(currentPage, g?.rect || null, maat());
  });

  // De terugweg naar de modelcoördinaten van een geïmporteerde tekening kan
  // alleen op een pagina met PDF-viewports; de export meldt zelf als die geen
  // matrix dragen (cadExport.noModelSpace).
  const modelMogelijk = createMemo(() => modelOorsprongMogelijk(doc?.pdfViewports, paginas()));

  onMount(async () => {
    try { setMaat(await paginaMaat(doc, currentPage)); } catch { /* maat volgt bij export */ }
    // Zonder meetschaal is "meetschaal van de app" geen zinnige keuze.
    if (inst.scaleMode === 'measure' && !untrack(meetschaal)) setInst('scaleMode', 'paper');
    if (inst.origin === 'model' && !untrack(modelMogelijk)) setInst('origin', 'page');
  });

  onCleanup(() => {
    annuleer(scanJob);
    stopLuisteren();
  });

  // --- Telronde: opnieuw bij elke keuze die de laagindeling verandert. ---
  let scanTimer = null;
  createEffect(on(
    () => [paginas().join(','), inst.layers, inst.annotations, inst.fills, inst.text, inst.skipPageFills, inst.curves, inst.joinConnected],
    () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(tel, 250);
    },
  ));

  async function tel() {
    if (!doc?.filePath) return;
    await annuleer(scanJob);
    const job = nieuwJobId('scan');
    scanJob = job;
    const tellen = paginas().slice(0, MAX_SCAN_PAGINAS);
    setScan({ bezig: true, pagina: tellen[0] || 0, fout: '' });
    const scans = [];
    try {
      for (const p of tellen) {
        if (scanJob !== job) return;
        setScan({ bezig: true, pagina: p, fout: '' });
        const args = exportArgumenten(untrack(() => ({ ...inst })), { pdfPath: doc.filePath, pageIndex: p - 1 });
        scans.push(await scanPagina(job, args));
      }
      if (scanJob !== job) return;
      setLagen(voegTellingenSamen(scans));
      setScan({ bezig: false, pagina: 0, fout: '' });
    } catch (e) {
      if (scanJob !== job) return;
      setScan({ bezig: false, pagina: 0, fout: String(e?.message ?? e) });
    }
  }

  const zichtbareLagen = createMemo(() => {
    const z = zoek().trim().toLowerCase();
    return z ? lagen().filter((l) => l.name.toLowerCase().includes(z)) : lagen();
  });
  const totaalObjecten = createMemo(() => objectenNaUitsluiten(lagen(), uit()));

  const zetLaag = (naam, aan) => {
    const s = new Set(uit());
    if (aan) s.delete(naam.toUpperCase()); else s.add(naam.toUpperCase());
    setUit(s);
  };
  const zetZichtbare = (aan) => {
    const s = new Set(uit());
    for (const l of zichtbareLagen()) {
      if (aan) s.delete(l.name.toUpperCase()); else s.add(l.name.toUpperCase());
    }
    setUit(s);
  };
  const keerOm = () => {
    const s = new Set(uit());
    for (const l of zichtbareLagen()) {
      const k = l.name.toUpperCase();
      if (s.has(k)) s.delete(k); else s.add(k);
    }
    setUit(s);
  };

  // --- Export ---
  const sluit = () => {
    if (bezig()) return;
    closeDialog('cad-export');
  };

  // Formaat en extensie van het doelbestand horen bij elkaar: een getypte
  // .dwg-naam zet het formaat op DWG, een ander formaat past de extensie aan.
  const zetDoel = (pad) => {
    setDoel(pad);
    const f = formaatUitPad(pad, inst.format);
    if (f !== inst.format) setInst('format', f);
  };
  const zetFormaat = (f) => {
    setInst('format', f);
    if (doel()) setDoel(padMetFormaat(doel(), f));
  };

  async function kiesBestand() {
    const pad = await kiesDoelbestand(doc, inst.format, doel());
    if (pad) zetDoel(pad);
  }

  async function gebiedVoor(paginaNr) {
    const g = gekozenGebied();
    if (gebiedKeuze() === 'window') return { pt: vensterNaarWeergave(venster), rect: null };
    if (g && paginaNr === currentPage) {
      const m = maat() || (await paginaMaat(doc, paginaNr));
      return { pt: appRechthoekNaarWeergave(g.rect, m.hoogte), rect: g.rect };
    }
    return { pt: null, rect: null };
  }

  async function schaalVoor(paginaNr, rect) {
    if (inst.scaleMode === 'paper') return null;
    if (inst.scaleMode === 'custom') return Number(inst.customScale) > 0 ? Number(inst.customScale) : null;
    const g = gekozenGebied();
    if (g?.schaal && paginaNr === currentPage) return g.schaal;
    const m = paginaNr === currentPage && maat() ? maat() : await paginaMaat(doc, paginaNr);
    return meetschaalOp(paginaNr, rect, m);
  }

  // Wacht op de keuze in het paneel "grote export".
  const vraagTeGroot = (info) => new Promise((resolve) => setTeGroot({ ...info, resolve }));
  const beantwoord = (keuze) => {
    const vraag = teGroot();
    setTeGroot(null);
    vraag?.resolve(keuze);
  };

  async function exporteer() {
    if (!doc?.filePath) {
      setMelding({ soort: 'fout', tekst: tCommon('noDocumentOpen') });
      return;
    }
    const lijst = paginas();
    if (!lijst.length) {
      setMelding({ soort: 'fout', tekst: t('cadExport.noPages') });
      return;
    }
    let pad = doel();
    if (!pad) {
      pad = await kiesDoelbestand(doc, inst.format, '');
      if (!pad) return;
    }
    pad = padMetFormaat(pad, inst.format);
    setDoel(pad);
    // Alle keuzes onthouden voor de volgende keer.
    state.preferences.cadExportSettings = JSON.parse(JSON.stringify(inst));
    savePreferences();

    const bestanden = bestandenPerPagina(pad, lijst);
    afgebroken = false;
    setMelding(null);
    setBezig(true);
    stopLuisteren = await luisterVoortgang((p) => {
      if (p.jobId === exportJob) setVoortgang((v) => ({ ...v, phase: p.phase, done: p.done, total: p.total }));
    });
    const totaal = { bestanden: 0, bytes: 0, objecten: 0 };
    try {
      for (const [i, paginaNr] of lijst.entries()) {
        if (afgebroken) break;
        setVoortgang({ pagina: paginaNr, index: i + 1, aantal: lijst.length, phase: 'load', done: 0, total: 0 });
        const gebied = await gebiedVoor(paginaNr);
        const schaal = await schaalVoor(paginaNr, gebied.rect);
        let args = exportArgumenten({ ...inst }, {
          pdfPath: doc.filePath,
          pageIndex: paginaNr - 1,
          outputPath: bestanden.get(paginaNr),
          schaalnoemer: schaal,
          gebied: gebied.pt,
          uitgeslotenLagen: [...uit()],
          maxEntiteiten: MAX_ENTITEITEN,
        });
        let verslag = null;
        while (!verslag && !afgebroken) {
          exportJob = nieuwJobId('export');
          try {
            verslag = await exporteerPagina(exportJob, args);
          } catch (e) {
            if (afgebroken) break;
            const groot = leesTeGroot(e);
            if (!groot) throw e;
            const keuze = await vraagTeGroot({ pagina: paginaNr, ...groot });
            if (keuze === 'stop') { afgebroken = true; break; }
            args = keuze === 'door'
              ? { ...args, maxEntities: undefined }
              : { ...args, fills: 'skip', text: 'skip' };
          }
        }
        if (verslag) {
          const c = verslag.convert;
          totaal.bestanden += 1;
          totaal.bytes += verslag.file_size;
          totaal.objecten += c.lines + c.polylines + c.splines + c.hatches + c.texts;
          setLaatstePad(verslag.output_path);
        }
      }
      // "Afgebroken" alleen als er echt niets geschreven is: een pagina waarvan
      // het bestand al af was vóór de stopknop doorkwam, staat op schijf en
      // wordt dan gewoon gemeld.
      if (afgebroken && totaal.bestanden === 0) {
        setMelding({ soort: 'info', tekst: t('cadExport.cancelled') });
      } else {
        const objecten = getal(totaal.objecten);
        const grootte = grootteTekst(totaal.bytes);
        setMelding({
          soort: afgebroken ? 'info' : 'ok',
          tekst: totaal.bestanden === 1
            ? t('cadExport.doneOne', { path: laatstePad(), objects: objecten, size: grootte })
            : t('cadExport.doneMany', { files: getal(totaal.bestanden), objects: objecten, size: grootte }),
        });
      }
    } catch (e) {
      const f = leesExportFout(e);
      setMelding({ soort: 'fout', tekst: t(`cadExport.${f.sleutel}`, f) });
    } finally {
      stopLuisteren();
      stopLuisteren = () => {};
      exportJob = null;
      setVoortgang(null);
      setBezig(false);
    }
  }

  function breekAf() {
    afgebroken = true;
    if (teGroot()) beantwoord('stop');
    annuleer(exportJob);
  }

  const faseTekst = () => {
    const v = voortgang();
    if (!v) return '';
    const pct = v.total > 0 ? Math.round((100 * v.done) / v.total) : 0;
    const sleutel = { load: 'phaseLoad', extract: 'phaseExtract', build: 'phaseBuild', write: 'phaseWrite' }[v.phase] || 'phaseLoad';
    const voor = v.aantal > 1 ? `${v.index}/${v.aantal} · ` : '';
    return voor + t(`cadExport.${sleutel}`, { page: v.pagina, pct });
  };
  const faseProcent = () => {
    const v = voortgang();
    if (!v || v.phase !== 'extract' || !v.total) return null;
    return Math.min(100, Math.round((100 * v.done) / v.total));
  };

  const gebiedLabel = (g) => {
    const schaal = g.schaal ? schaalTekst(g.schaal) : '—';
    const naam = g.naam ? `'${g.naam}'` : '';
    const sleutel = g.soort === 'region' ? 'areaRegion' : g.soort === 'viewport' ? 'areaViewport' : 'areaPdf';
    return t(`cadExport.${sleutel}`, { name: naam, scale: schaal });
  };

  const footer = (
    <>
      <div class="cad-footer-status">
        <Show when={bezig()} fallback={
          <Show when={melding()}>
            <span class={`cad-status cad-status-${melding().soort}`}>{melding().tekst}</span>
            <Show when={melding().soort === 'ok' && laatstePad()}>
              <button class="pref-btn cad-link-btn" onClick={() => revealInFileManager(laatstePad())}>{t('cadExport.showInFolder')}</button>
            </Show>
          </Show>
        }>
          <span class="cad-status">{faseTekst()}</span>
          <div class="cad-progress"><div class="cad-progress-bar" style={{ width: `${faseProcent() ?? 100}%`, opacity: faseProcent() === null ? 0.35 : 1 }} /></div>
        </Show>
      </div>
      <div class="crop-margins-footer-right">
        <Show when={bezig()} fallback={
          <>
            <button class="pref-btn pref-btn-primary" onClick={exporteer}>{tCommon('export')}</button>
            <button class="pref-btn pref-btn-secondary" onClick={sluit}>{melding()?.soort === 'ok' ? tCommon('close') : tCommon('cancel')}</button>
          </>
        }>
          <button class="pref-btn pref-btn-secondary" onClick={breekAf}>{t('cadExport.stop')}</button>
        </Show>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('cadExport.title')}
      overlayClass="cad-overlay"
      dialogClass="cad-dialog"
      headerClass="crop-margins-header"
      bodyClass="cad-body"
      footerClass="cad-footer"
      onClose={sluit}
      footer={footer}
    >
      <div class="cad-tabs" role="tablist">
        <For each={TABS}>
          {(id) => (
            <button
              class={`cad-tab${tab() === id ? ' active' : ''}`}
              role="tab"
              aria-selected={tab() === id}
              onClick={() => setTab(id)}
            >{t(`cadExport.tab_${id}`)}</button>
          )}
        </For>
      </div>

      <fieldset class="cad-fieldset" disabled={bezig()}>
        {/* Algemeen */}
        <div class="cad-tab-content" classList={{ active: tab() === 'general' }}>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.format')}</label>
            <select class="cad-select" value={inst.format} onChange={(e) => zetFormaat(e.target.value)}>
              <option value="dxf">{t('cadExport.formatDxf')}</option>
              <option value="dxf_binary">{t('cadExport.formatDxfBinary')}</option>
              <option value="dwg">DWG</option>
            </select>
            <label class="cad-label cad-label-short">{t('cadExport.version')}</label>
            <select class="cad-select cad-select-short" value={inst.version} onChange={(e) => setInst('version', e.target.value)}>
              <option value="r2004">2004</option>
              <option value="r2010">2010</option>
              <option value="r2013">2013</option>
              <option value="r2018">2018</option>
            </select>
          </div>

          <div class="cad-row cad-row-top">
            <label class="cad-label">{t('cadExport.pages')}</label>
            <div class="cad-stack">
              <label class="cad-radio"><input type="radio" name="cad-range" checked={inst.range === 'current'} onChange={() => setInst('range', 'current')} /> {t('cadExport.pagesCurrent', { page: currentPage })}</label>
              <label class="cad-radio"><input type="radio" name="cad-range" checked={inst.range === 'all'} onChange={() => setInst('range', 'all')} /> {t('cadExport.pagesAll', { count: totalPages })}</label>
              <label class="cad-radio">
                <input type="radio" name="cad-range" checked={inst.range === 'custom'} onChange={() => setInst('range', 'custom')} /> {t('cadExport.pagesCustom')}
                <input type="text" class="cad-input" placeholder={t('cadExport.rangePlaceholder')} value={inst.customPages}
                  disabled={inst.range !== 'custom'} onInput={(e) => setInst('customPages', e.target.value)} />
              </label>
              <Show when={paginas().length > 1}>
                <div class="cad-note">{t('cadExport.filesPerPage')}</div>
              </Show>
            </div>
          </div>

          <div class="cad-row">
            <label class="cad-label">{t('cadExport.units')}</label>
            <select class="cad-select cad-select-short" value={inst.units} onChange={(e) => setInst('units', e.target.value)}>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
              <option value="in">in</option>
            </select>
          </div>

          <div class="cad-row cad-row-top">
            <label class="cad-label">{t('cadExport.scale')}</label>
            <div class="cad-stack">
              <label class="cad-radio"><input type="radio" name="cad-scale" checked={inst.scaleMode === 'paper'} onChange={() => setInst('scaleMode', 'paper')} /> {t('cadExport.scalePaper')}</label>
              <label class="cad-radio" classList={{ 'cad-disabled': !meetschaal() }}>
                <input type="radio" name="cad-scale" disabled={!meetschaal()} checked={inst.scaleMode === 'measure'} onChange={() => setInst('scaleMode', 'measure')} />
                {' '}{meetschaal() ? t('cadExport.scaleMeasure', { scale: schaalTekst(meetschaal()) }) : t('cadExport.scaleMeasureNone')}
              </label>
              <label class="cad-radio">
                <input type="radio" name="cad-scale" checked={inst.scaleMode === 'custom'} onChange={() => setInst('scaleMode', 'custom')} /> {t('cadExport.scaleCustom')}
                <input type="number" class="cad-input cad-input-short" min="0.01" step="1" value={inst.customScale}
                  disabled={inst.scaleMode !== 'custom'} onChange={(e) => setInst('customScale', Number(e.target.value) || 1)} />
              </label>
            </div>
          </div>

          <div class="cad-row">
            <label class="cad-label">{t('cadExport.target')}</label>
            <input type="text" class="cad-input cad-input-wide" value={doel()} placeholder={t('cadExport.targetPlaceholder')} onInput={(e) => zetDoel(e.target.value)} />
            <button class="pref-btn" onClick={kiesBestand}>{t('cadExport.browse')}</button>
          </div>
        </div>

        {/* Lagen */}
        <div class="cad-tab-content" classList={{ active: tab() === 'layers' }}>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.layerMode')}</label>
            <select class="cad-select" value={inst.layers} onChange={(e) => setInst('layers', e.target.value)}>
              <option value="ocg_then_style">{t('cadExport.layerModeOcg')}</option>
              <option value="style">{t('cadExport.layerModeStyle')}</option>
              <option value="single">{t('cadExport.layerModeSingle')}</option>
            </select>
          </div>
          <label class="cad-check">
            <input type="checkbox" checked={inst.annotations} onChange={(e) => setInst('annotations', e.target.checked)} /> {t('cadExport.annotations')}
          </label>
          <Show when={inst.annotations && doc?.modified}>
            <div class="cad-note cad-note-warn">{t('cadExport.unsavedNote')}</div>
          </Show>
          <div class="cad-row cad-layer-tools">
            <button class="pref-btn cad-small-btn" onClick={() => zetZichtbare(true)}>{t('cadExport.all')}</button>
            <button class="pref-btn cad-small-btn" onClick={() => zetZichtbare(false)}>{t('cadExport.none')}</button>
            <button class="pref-btn cad-small-btn" onClick={keerOm}>{t('cadExport.invert')}</button>
            <input type="text" class="cad-input cad-input-wide" placeholder={tCommon('search')} value={zoek()} onInput={(e) => setZoek(e.target.value)} />
          </div>
          <div class="cad-layer-list" role="list">
            <div class="cad-layer-head">
              <span class="cad-col-check" />
              <span class="cad-col-color" />
              <span class="cad-col-name">{t('cadExport.colLayer')}</span>
              <span class="cad-col-count">{t('cadExport.colObjects')}</span>
              <span class="cad-col-source">{t('cadExport.colSource')}</span>
            </div>
            <For each={zichtbareLagen()}>
              {(laag) => (
                <label class="cad-layer-row" role="listitem">
                  <span class="cad-col-check"><input type="checkbox" checked={!uit().has(laag.name.toUpperCase())} onChange={(e) => zetLaag(laag.name, e.target.checked)} /></span>
                  <span class="cad-col-color"><span class="cad-swatch" style={{ background: KLEUR(laag.color) }} /></span>
                  <span class="cad-col-name" title={laag.name}>{laag.name}</span>
                  <span class="cad-col-count">{getal(laag.entities)}</span>
                  <span class="cad-col-source">{laag.from_annotation ? t('cadExport.sourceAnnotation') : laag.from_ocg ? t('cadExport.sourceOcg') : t('cadExport.sourceStyle')}</span>
                </label>
              )}
            </For>
          </div>
          <div class="cad-note">
            <Show when={scan().bezig} fallback={
              <Show when={scan().fout} fallback={t('cadExport.scanned', { objects: getal(totaalObjecten()), layers: getal(lagen().length) })}>
                {t('cadExport.scanFailed', { error: scan().fout })}
              </Show>
            }>
              {t('cadExport.scanning', { page: scan().pagina })}
            </Show>
            <Show when={paginas().length > MAX_SCAN_PAGINAS}> {t('cadExport.scanLimited', { count: MAX_SCAN_PAGINAS })}</Show>
          </div>
          <Show when={!scan().bezig && totaalObjecten() > MAX_ENTITEITEN}>
            <div class="cad-note cad-note-warn">{t('cadExport.tooLargeWarn', { objects: getal(totaalObjecten()), limit: getal(MAX_ENTITEITEN) })}</div>
          </Show>
        </div>

        {/* Gebied */}
        <div class="cad-tab-content" classList={{ active: tab() === 'area' }}>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.area')}</label>
            <select class="cad-select" value={gebiedKeuze()} onChange={(e) => setGebiedKeuze(e.target.value)}>
              <option value="page">{t('cadExport.areaPage')}</option>
              <For each={gebieden}>
                {(g) => <option value={g.id} disabled={!alleenHuidige()}>{gebiedLabel(g)}</option>}
              </For>
              <option value="window">{t('cadExport.areaWindow')}</option>
            </select>
          </div>
          <Show when={gebieden.length > 0 && !alleenHuidige()}>
            <div class="cad-note">{t('cadExport.areaOnlyCurrent')}</div>
          </Show>
          <Show when={gebiedKeuze() === 'window'}>
            <div class="cad-note">{t('cadExport.windowTitle')}</div>
            <div class="cad-row">
              <label class="cad-label">{t('cadExport.windowOrigin')}</label>
              <input type="number" class="cad-input cad-input-short" value={venster.x} onChange={(e) => setVenster('x', Number(e.target.value) || 0)} />
              <input type="number" class="cad-input cad-input-short" value={venster.y} onChange={(e) => setVenster('y', Number(e.target.value) || 0)} />
            </div>
            <div class="cad-row">
              <label class="cad-label">{t('cadExport.windowSize')}</label>
              <input type="number" class="cad-input cad-input-short" min="1" value={venster.breedte} onChange={(e) => setVenster('breedte', Math.max(1, Number(e.target.value) || 1))} />
              <input type="number" class="cad-input cad-input-short" min="1" value={venster.hoogte} onChange={(e) => setVenster('hoogte', Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </Show>
          <div class="cad-row cad-row-top">
            <label class="cad-label">{t('cadExport.origin')}</label>
            <div class="cad-stack">
              <label class="cad-radio"><input type="radio" name="cad-origin" checked={inst.origin === 'page'} onChange={() => setInst('origin', 'page')} /> {t('cadExport.originPage')}</label>
              <label class="cad-radio"><input type="radio" name="cad-origin" checked={inst.origin === 'area'} onChange={() => setInst('origin', 'area')} /> {t('cadExport.originArea')}</label>
              <label class="cad-radio" classList={{ 'cad-disabled': !modelMogelijk() }} title={modelMogelijk() ? '' : t('cadExport.noModelSpace')}>
                <input type="radio" name="cad-origin" disabled={!modelMogelijk()} checked={inst.origin === 'model'} onChange={() => setInst('origin', 'model')} />
                {' '}{t('cadExport.originModel')}
              </label>
            </div>
          </div>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.offset')}</label>
            <input type="number" class="cad-input" value={inst.offsetX} onChange={(e) => setInst('offsetX', Number(e.target.value) || 0)} />
            <input type="number" class="cad-input" value={inst.offsetY} onChange={(e) => setInst('offsetY', Number(e.target.value) || 0)} />
          </div>
          <div class="cad-note">{t('cadExport.offsetNote')}</div>
        </div>

        {/* Geometrie */}
        <div class="cad-tab-content" classList={{ active: tab() === 'geometry' }}>
          <div class="cad-row cad-row-top">
            <label class="cad-label">{t('cadExport.curves')}</label>
            <div class="cad-stack">
              <label class="cad-radio">
                <input type="radio" name="cad-curves" checked={inst.curves === 'flatten'} onChange={() => setInst('curves', 'flatten')} /> {t('cadExport.curvesFlatten')}
                <input type="number" class="cad-input cad-input-short" min="0.001" max="1" step="0.005" value={inst.curveToleranceMm}
                  disabled={inst.curves !== 'flatten'} onChange={(e) => setInst('curveToleranceMm', Math.min(1, Math.max(0.001, Number(e.target.value) || 0.01)))} />
              </label>
              <label class="cad-radio"><input type="radio" name="cad-curves" checked={inst.curves === 'spline'} onChange={() => setInst('curves', 'spline')} /> {t('cadExport.curvesSpline')}</label>
            </div>
          </div>
          <label class="cad-check"><input type="checkbox" checked={inst.mergeCollinear} onChange={(e) => setInst('mergeCollinear', e.target.checked)} /> {t('cadExport.merge')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.joinConnected} onChange={(e) => setInst('joinConnected', e.target.checked)} /> {t('cadExport.join')}</label>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.fills')}</label>
            <select class="cad-select" value={inst.fills} onChange={(e) => setInst('fills', e.target.value)}>
              <option value="hatch">{t('cadExport.fillsHatch')}</option>
              <option value="outline">{t('cadExport.fillsOutline')}</option>
              <option value="skip">{t('cadExport.fillsSkip')}</option>
            </select>
          </div>
          <label class="cad-check"><input type="checkbox" checked={inst.skipPageFills} onChange={(e) => setInst('skipPageFills', e.target.checked)} /> {t('cadExport.skipPageFills')}</label>
          <label class="cad-check"><input type="checkbox" checked={inst.text} onChange={(e) => setInst('text', e.target.checked)} /> {t('cadExport.text')}</label>
          <div class="cad-row">
            <label class="cad-label">{t('cadExport.textFactor')}</label>
            <input type="number" class="cad-input cad-input-short" min="0.3" max="2" step="0.01" value={inst.textHeightFactor}
              disabled={!inst.text} onChange={(e) => setInst('textHeightFactor', Math.min(2, Math.max(0.3, Number(e.target.value) || 0.72)))} />
          </div>
        </div>
      </fieldset>

      <Show when={teGroot()}>
        <div class="cad-question" role="alertdialog">
          <div class="cad-question-title">{t('cadExport.tooLargeTitle')}</div>
          <div>{t('cadExport.tooLargeText', { page: teGroot().pagina, objects: getal(teGroot().entities), limit: getal(teGroot().limit) })}</div>
          <div class="cad-question-buttons">
            <button class="pref-btn pref-btn-primary" onClick={() => beantwoord('door')}>{t('cadExport.tooLargeContinue')}</button>
            <button class="pref-btn" onClick={() => beantwoord('licht')}>{t('cadExport.tooLargeLight')}</button>
            <button class="pref-btn pref-btn-secondary" onClick={() => beantwoord('stop')}>{t('cadExport.tooLargeStop')}</button>
          </div>
        </div>
      </Show>
    </Dialog>
  );
}
