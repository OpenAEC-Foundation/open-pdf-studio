import { Show, For, createSignal, createEffect, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { state } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import {
  searchQuery, setSearchQuery,
  filteredCategories, allCategories,
  toggleCategory, isCategoryExpanded,
  symbolPaletteVisible, setSymbolPaletteVisible,
  symbolPaletteMode, setSymbolPaletteMode,
  symbolFloatPos, setSymbolFloatPos,
  saveSymbolPaletteState,
  settingsOpen, setSettingsOpen,
  selectedIndustry, setSelectedIndustry,
  selectedCountry, setSelectedCountry,
  toggleGroupEnabled, isGroupEnabled,
  addCustomGroup, removeCustomGroup, addSymbolToGroup, getCustomGroups, upsertCustomGroup,
  resolveSymbolSvg,
} from '../stores/symbolStore.js';
import { matchesLocale, categoryLabel } from '../data/symbolLocales.js';
import {
  ensureLibraryIndex, libraryIndustries, libraryCountries, indexStatus,
  downloadInfoFor, downloadCountrySector,
  downloadBusy, downloadProgress, downloadError,
} from '../stores/symbolLibraryOnlineStore.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';
import { ifcCategoryForSymbol } from '../data/ifcCategoryMap.js';
import { nenIfcForSymbolId } from '../data/nenIfcMap.js';
import { SYMBOL_STAMP_DEFAULT_SIZE } from '../../annotations/stamp-defaults.js';
import { setPendingSymbolId } from '../stores/parametricSymbolStore.js';
import { symboolSchaal, setSymboolSchaal } from '../../symbols/symbol-scale-store.js';
import { SCHAAL_STAPPEN, schaalLabel, leesSchaalInvoer, volgendeSchaalStap } from '../../symbols/symbol-scale.js';
import useDropdown from './preferences/useDropdown.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { parseLineworkCatalog, lineworkCatalogToGroup, LINEWORK_TEMPLATE_PREFIX } from '../../symbols/linework-catalog.js';

// Alleen catalogus-FAMILIES (maat-keuze, geen sprekend pictogram) krijgen de
// brede tegel met naam; gewone parametrische symbolen houden het compacte
// pictogrammenraster. Op `parametricId` alleen gaten maakte van elke
// parametrische groep één lange lijst met grote tegels.
const isCatalogusFamilie = (sym) =>
  typeof sym?.parametricId === 'string' && sym.parametricId.startsWith(LINEWORK_TEMPLATE_PREFIX);
import { registerLineworkCatalog } from '../../symbols/linework-catalog-store.js';
import { openDialog } from '../stores/dialogStore.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { isTauri } from '../../core/platform.js';
import { knopUit, meldingTekst } from '../../core/webfuncties.js';

const DOCK_SNAP = 60;

// --- Shared drag logic ---
function startDrag(e, fromDocked) {
  if (e.button !== 0) return;
  e.preventDefault();
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  const offsetX = fromDocked ? 17 : (e.clientX - symbolFloatPos().x);
  const offsetY = fromDocked ? 12 : (e.clientY - symbolFloatPos().y);

  function getSnapSide(cx) {
    const rect = mainViewEl.getBoundingClientRect();
    if (cx - rect.left < DOCK_SNAP) return 'left';
    if (rect.right - cx < DOCK_SNAP) return 'right';
    return null;
  }

  function onMove(ev) {
    if (!hasMoved) {
      if (Math.abs(ev.clientX - startCX) < 4 && Math.abs(ev.clientY - startCY) < 4) return;
      hasMoved = true;
      if (fromDocked) {
        setSymbolPaletteMode('float');
        unregisterPaletteDock('symbols');
      }
    }
    const el = document.querySelector('.sp-float');
    const pw = el ? el.offsetWidth : 240;
    const ph = el ? el.offsetHeight : 300;
    const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - pw));
    const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - ph));
    setSymbolFloatPos({ x: nx, y: ny });
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!hasMoved) return;
    const snap = getSnapSide(ev.clientX);
    if (snap) {
      setSymbolPaletteMode(`docked-${snap}`);
      registerPaletteDock('symbols', snap);
    } else {
      unregisterPaletteDock('symbols');
    }
    saveSymbolPaletteState();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Select symbol → activate stamp tool with SVG override ---
function selectSymbol(symbol) {
  // Parametric entries (NL Tekenwerk: stramien, peilmaat, …) place an
  // editable parametricSymbol annotation instead of a static stamp — the
  // click on the page goes through the parametricSymbol tool and the params
  // stay editable in the properties panel.
  if (symbol.parametricId) {
    setPendingSymbolId(symbol.parametricId);
    setTool('parametricSymbol');
    return;
  }
  // Generic tool entries: palette items that simply activate a drawing tool
  // (e.g. 'mask' — maskeervlak). Keeps future tool-items one-liners.
  if (symbol.tool) {
    setTool(symbol.tool);
    return;
  }
  // Wall entries (NL Wanden / IfcWall): activate the wall tool with the
  // material hatch + default thickness; draw start→end like a line.
  if (symbol.wall) {
    state.toolOverrides = {
      wallPattern: symbol.wall.pattern,
      wallDikteMm: symbol.wall.dikteMm || 100,
      ifcCategory: ifcCategoryForSymbol(symbol),
      // Uit het palet: hoort bij de invoegsessie voor symbolen (#587).
      symbolInsert: true,
    };
    setTool('wall');
    return;
  }
  // Resolve any user-edited geometry for this type. effectiveSvg is what gets
  // rasterized/placed; stampBaseSvg keeps the original source so a later
  // "Edit Type" on the placed stamp maps back to the same override key.
  const effectiveSvg = resolveSymbolSvg(symbol.svg);
  // Set overrides BEFORE setTool — manager.js preserves them for stamp tool
  state.toolOverrides = {
    stampSvg: effectiveSvg,
    stampBaseSvg: symbol.svg,
    stampName: symbol.name,
    // Alleen de hoogte vastzetten: de breedte volgt uit de beeldverhouding van
    // de SVG (placeOverrideStamp), zodat een niet-vierkant symbool niet in een
    // vierkant wordt geduwd. Voor de vierkante meegeleverde symbolen blijft de
    // uitkomst 400 x 400.
    stampHeight: SYMBOL_STAMP_DEFAULT_SIZE,
    lockAspectRatio: true,
    ifcCategory: ifcCategoryForSymbol(symbol),
    // Symbool-id + IFC PredefinedType meegeven zodat de geplaatste stempel
    // (en de saver/loader-roundtrip) de herkomst kent — zie nenIfcMap.js.
    symbolId: symbol.id,
    ifcPredefinedType: nenIfcForSymbolId(symbol.id)?.ifcPredefinedType,
    // Invoegmodus voor symbolen (#587): de opmaakwerkbalk stelt de opmaak in
    // voor de volgende plaatsingen. setTool() start of behoudt de sessie en
    // bouwt de spookafbeelding onder de cursor (met die opmaak erin).
    symbolInsert: true,
  };
  setTool('stamp');
}

// Colorize SVG: replace #000 and #d00 strokes/fills with category color
function colorizeSvg(svg, color) {
  if (!color) return svg;
  return svg.replace(/stroke="#000"/g, `stroke="${color}"`)
            .replace(/fill="#000"/g, `fill="${color}"`)
            .replace(/stroke="#d00"/g, `stroke="${color}"`)
            .replace(/fill="#d00"/g, `fill="${color}"`);
}

// Grip icon (6 dots)
const gripSvg = `<svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="2" cy="10" r="1" fill="currentColor"/><circle cx="6" cy="10" r="1" fill="currentColor"/></svg>`;

const searchSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>`;

const settingsSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.5 1.5m7 7L13 13M3 13l1.5-1.5m7-7L13 3"/></svg>`;

const closeSvg = `<svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

const arrowSvg = `<svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// --- Plaatsingsschaal als ComboBox (issue #357) ---
// Eén bewerkbaar veld met een uitklaplijst, zoals een Windows-ComboBox: kies
// een vaste stap of typ een eigen factor ("1,5", "2x", "50%"). De waarde telt
// pas bij Enter, bij het verlaten van het veld of bij een keuze uit de lijst;
// onzin zet de geldende schaal terug in plaats van naar 1x te springen.
function SchaalCombo(props) {
  const { open, setOpen, dropdownStyle, setWrapperRef, setDropdownRef, toggleDropdown } =
    useDropdown(SCHAAL_STAPPEN.length);
  let invoer;
  const tekst = () => schaalLabel(symboolSchaal());

  function bevestig() {
    if (!invoer) return;
    const f = leesSchaalInvoer(invoer.value);
    if (f != null) setSymboolSchaal(f);
    invoer.value = tekst();
  }

  function kies(stap) {
    setSymboolSchaal(stap);
    if (invoer) invoer.value = tekst();
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      bevestig();
      setOpen(false);
    } else if (e.key === 'Escape') {
      invoer.value = tekst();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const huidig = leesSchaalInvoer(invoer.value) ?? symboolSchaal();
      kies(volgendeSchaalStap(huidig, e.key === 'ArrowDown' ? 1 : -1));
    }
  }

  return (
    <div class="pref-combo sp-scale-combo" ref={setWrapperRef}>
      <input
        id="sp-scale-input"
        type="text"
        class="pref-combo-input"
        ref={invoer}
        value={tekst()}
        title={props.title}
        spellcheck={false}
        onBlur={bevestig}
        onKeyDown={onKeyDown}
      />
      <button type="button" class="pref-combo-arrow" tabIndex={-1} onMouseDown={(e) => toggleDropdown(e, false)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <Portal>
        <div class="pref-combo-dropdown" classList={{ show: open() }} style={dropdownStyle()} ref={setDropdownRef}>
          <For each={SCHAAL_STAPPEN}>
            {(stap) => (
              <div
                class="pref-combo-option"
                classList={{ selected: symboolSchaal() === stap }}
                onMouseDown={(e) => { e.preventDefault(); kies(stap); }}
              >
                {schaalLabel(stap)}
              </div>
            )}
          </For>
        </div>
      </Portal>
    </div>
  );
}

// --- Inner content (shared between docked and floating) ---
function SymbolContent() {
  const { t } = useTranslation('ribbon');
  return (
    <>
      {/* Search */}
      <div class="sp-search">
        <div class="sp-search-wrap">
          <div class="sp-search-icon" innerHTML={searchSvg} />
          <input
            type="text"
            placeholder={t('symbolPalette.search')}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Plaatsingsschaal (issue #357): geldt voor VOLGENDE symbolen; wat al
          op de tekening staat verandert niet. */}
      <div class="sp-scale">
        <label for="sp-scale-input" title={t('drawing.symbolScaleTitle')}>{t('drawing.symbolScale')}</label>
        <SchaalCombo title={t('drawing.symbolScaleCustom')} />
      </div>

      {/* Categories */}
      <div class="sp-categories">
        <Show when={filteredCategories().length > 0} fallback={<div class="sp-empty">{t('symbolPalette.noResults')}</div>}>
          <For each={filteredCategories()}>
            {(cat) => (
              <div>
                <div class="sp-cat-header" onClick={() => toggleCategory(cat.id)}>
                  <div class={`sp-cat-arrow${isCategoryExpanded(cat.id) ? ' expanded' : ''}`} innerHTML={arrowSvg} />
                  <div class="sp-cat-icon" style={{ color: cat.color || '#333' }} innerHTML={cat.icon} />
                  <span class="sp-cat-name">{categoryLabel(t, cat)}</span>
                  {/* Tekeninstellingen (tekeningtypen/regelsets) — alleen bij
                      de NL IFC Bouw-categorie. Vast knop-id voor tests/rig. */}
                  <Show when={cat.id === 'nl-ifc-bouw'}>
                    <button
                      id="btn-tekeninstellingen"
                      class="sp-settings-btn"
                      title={t('symbolPalette.drawingSettings')}
                      onClick={(e) => { e.stopPropagation(); openDialog('tekeninstellingen'); }}
                      innerHTML={settingsSvg}
                    />
                    {/* Systeemtypen (systeemplafond/-raster) beheren — ook
                        bereikbaar zonder geselecteerde instantie. */}
                    <button
                      id="btn-systeemtypen"
                      class="sp-settings-btn"
                      title={t('symbolPalette.manageSystemTypes')}
                      onClick={(e) => { e.stopPropagation(); openDialog('systeemtypen'); }}
                      innerHTML={`<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="1" width="10" height="10"/><line x1="4.3" y1="1" x2="4.3" y2="11"/><line x1="7.6" y1="1" x2="7.6" y2="11"/><line x1="1" y1="4.3" x2="11" y2="4.3"/><line x1="1" y1="7.6" x2="11" y2="7.6"/></svg>`}
                    />
                  </Show>
                  <span class="sp-cat-count">{cat.symbols.length}</span>
                </div>
                <Show when={isCategoryExpanded(cat.id)}>
                  <div class="sp-grid">
                    <For each={cat.symbols}>
                      {(sym) => (
                        <button
                          class={`sp-symbol-btn${state.toolOverrides?.stampSvg === sym.svg ? ' active' : ''}${isCatalogusFamilie(sym) ? ' sp-symbol-named' : ''}`}
                          title={sym.name}
                          onClick={() => selectSymbol(sym)}
                        >
                          <span class="sp-symbol-icon" innerHTML={colorizeSvg(sym.svg, cat.color)} />
                          {/* Catalogus-ingangen zijn families met een maat-keuze,
                              geen pictogrammen: aan de miniatuur alleen zie je niet
                              welk aanzicht je aanklikt. Platte symboolsets houden
                              hun compacte raster. */}
                          <Show when={isCatalogusFamilie(sym)}>
                            <span class="sp-symbol-name">{sym.name}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

// --- Docked symbol palette ---
export function DockedSymbolPalette(props) {
  const { t } = useTranslation('ribbon');
  const side = () => props.side;
  const shouldShow = () => symbolPaletteVisible() && symbolPaletteMode() === `docked-${side()}`;

  return (
    <Show when={shouldShow()}>
      <div class={`sp-panel sp-docked${side() === 'right' ? ' sp-docked-right' : ''}`}>
        <div class="sp-header">
          <div class="sp-grip" onMouseDown={(e) => startDrag(e, true)} innerHTML={gripSvg} />
          <span class="sp-title">{t('view.toolPaletteLabel')}</span>
          <button class="sp-settings-btn" title={t('symbolPalette.settingsTitle')} onClick={() => setSettingsOpen(true)} innerHTML={settingsSvg} />
          <button class="sp-close-btn" title={t('view.closePalette')} onClick={() => { setSymbolPaletteVisible(false); unregisterPaletteDock('symbols'); saveSymbolPaletteState(); }} innerHTML={closeSvg} />
        </div>
        <SymbolContent />
      </div>
    </Show>
  );
}

// --- Floating symbol palette ---
export function FloatingSymbolPalette() {
  const { t } = useTranslation('ribbon');
  const shouldShow = () => symbolPaletteVisible() && symbolPaletteMode() === 'float';

  return (
    <Show when={shouldShow()}>
      <div
        class="sp-panel sp-float"
        style={`left:${symbolFloatPos().x}px; top:${symbolFloatPos().y}px`}
      >
        <div class="sp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.sp-float-close')) return;
          startDrag(e, false);
        }}>
          <span class="sp-float-title">{t('view.toolPaletteLabel')}</span>
          <button class="sp-settings-btn" title={t('symbolPalette.settingsTitle')} onClick={() => setSettingsOpen(true)} innerHTML={settingsSvg} />
          <button class="sp-float-close" title={t('view.closePalette')} onClick={() => { setSymbolPaletteVisible(false); saveSymbolPaletteState(); }} innerHTML={closeSvg} />
        </div>
        <SymbolContent />
      </div>
    </Show>
  );
}

// --- Settings Dialog ---
export function SymbolSettingsDialog() {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('ribbon');
  const [newGroupName, setNewGroupName] = createSignal('');
  // De online bibliotheek staat op GitHub: als gast uit (#548).
  const downloadUit = knopUit('symbol-library-download', { inTauri: isTauri() });
  const downloadMelding = () => meldingTekst(tCommon, tCommon('onlineSymbolLibrary'));
  let fileInputRef;
  let importGroupInputRef;

  // Bij openen van de dialoog de online bibliotheek-index laden (cache-first,
  // offline-fallback naar de statische lijst).
  createEffect(() => { if (settingsOpen()) ensureLibraryIndex(); });

  // Downloadstatus voor het gekozen land+industrie (reactief: index,
  // selectie én al gedownloade groepen).
  const dlInfo = createMemo(() => downloadInfoFor(selectedCountry(), selectedIndustry()));

  function handleAddGroup() {
    const name = newGroupName().trim();
    if (!name) return;
    addCustomGroup(name);
    setNewGroupName('');
  }

  // Upload SVG or raster image as symbol to a custom group
  const [uploadTargetGroup, setUploadTargetGroup] = createSignal(null);

  function handleUploadClick(groupId) {
    setUploadTargetGroup(groupId);
    fileInputRef?.click();
  }

  async function handleFileSelected(e) {
    const files = e.target.files;
    const groupId = uploadTargetGroup();
    if (!files || !groupId) return;

    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
        // Vector SVG
        const text = await file.text();
        addSymbolToGroup(groupId, name, text);
      } else if (file.type.startsWith('image/')) {
        // Raster image → convert to data URL
        const reader = new FileReader();
        const dataUrl = await new Promise(resolve => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        // Wrap in SVG <image> for consistent handling
        const svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><image href="${dataUrl}" width="64" height="64"/></svg>`;
        addSymbolToGroup(groupId, name, svg);
      }
    }
    e.target.value = '';
  }

  // Export a custom group as a downloadable JSON file
  function handleExportGroup(cat) {
    const groupData = getCustomGroups().find(g => g.id === cat.id);
    if (!groupData) return;
    const json = JSON.stringify({ id: groupData.id, name: groupData.name, color: groupData.color || null, symbols: groupData.symbols }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${groupData.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import a group from a JSON file
  async function handleImportGroup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Parametrische catalogus met vaste fabrikantgeometrie: registreer de
      // families als templates in plaats van als losse platte symbolen. Eén
      // palet-ingang per productlijn, maat te kiezen in het
      // eigenschappenpaneel. Zelfde behandeling als een gedownloade
      // collectie, maar dan vanaf schijf.
      const catalog = parseLineworkCatalog(data);
      if (catalog) {
        const collectionId = String(data.id || file.name.replace(/\.json$/i, ''))
          .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        registerLineworkCatalog(collectionId, catalog);
        upsertCustomGroup(lineworkCatalogToGroup(collectionId, data, catalog));
        // Melden wat er binnenkwam. Een catalogus zonder previews krijgt een
        // generiek icoon, en dat is aan het palet niet te onderscheiden van
        // een fout in de app — dus benoemen we het.
        const maten = catalog.families.reduce((n, f) => n + f.variants.length, 0);
        const zonderPreview = catalog.families.filter(f => !f.preview).length;
        updateStatusMessage(
          t('symbolPalette.catalogLoaded', { id: collectionId, families: catalog.families.length, sizes: maten })
          + (zonderPreview ? ` — ${t('symbolPalette.catalogNoPreview', { n: zonderPreview })}` : '')
        );
        return;
      }

      if (!data.name || !Array.isArray(data.symbols)) {
        console.warn('Invalid symbol group file: missing name or symbols array');
        updateStatusMessage(t('symbolPalette.fileNotRecognized'));
        return;
      }
      const groupId = addCustomGroup(data.name);
      // Add all symbols from the imported group
      for (const sym of data.symbols) {
        if (sym.name && sym.svg) {
          addSymbolToGroup(groupId, sym.name, sym.svg);
        }
      }
    } catch (err) {
      console.error('Failed to import symbol group:', err);
      // Een catalogus die zichzelf wel als linework-variants aankondigt maar
      // niet klopt, gooit uit parseLineworkCatalog. Die reden hoort de
      // gebruiker te zien in plaats van alleen in de console te belanden.
      updateStatusMessage(t('symbolPalette.importFailed', { error: err?.message || err }), 6000);
    }
    e.target.value = '';
  }

  return (
    <Show when={settingsOpen()}>
      <input ref={fileInputRef} type="file" accept=".svg,image/*" multiple
        style={{ display: 'none' }} onChange={handleFileSelected} />
      <input ref={importGroupInputRef} type="file" accept=".json"
        style={{ display: 'none' }} onChange={handleImportGroup} />
      <div class="sp-settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <div class="sp-settings-dialog">
          <div class="sp-settings-header">
            <h3>{t('symbolPalette.settingsTitle')}</h3>
            <button class="sp-float-close" title={tCommon('close')} onClick={() => setSettingsOpen(false)} innerHTML={closeSvg} />
          </div>
          <div class="sp-settings-locale">
            <label class="sp-settings-locale-field">
              <span>{t('symbolPalette.industry')}</span>
              <select value={selectedIndustry()} onChange={(e) => setSelectedIndustry(e.target.value)}>
                <For each={libraryIndustries()}>
                  {(ind) => <option value={ind.id} selected={ind.id === selectedIndustry()}>{ind.name}</option>}
                </For>
              </select>
            </label>
            <label class="sp-settings-locale-field">
              <span>{t('symbolPalette.country')}</span>
              <select value={selectedCountry()} onChange={(e) => setSelectedCountry(e.target.value)}>
                <For each={libraryCountries()}>
                  {(c) => <option value={c.id} selected={c.id === selectedCountry()}>{c.flag ? c.flag + ' ' : ''}{c.name}</option>}
                </For>
              </select>
            </label>
          </div>
          <Show when={indexStatus() === 'loading'}>
            <div class="sp-settings-download sp-settings-download-note">{t('symbolPalette.libraryLoading')}</div>
          </Show>
          <Show when={indexStatus() === 'uit'}>
            <div class="sp-settings-download sp-settings-download-note">{downloadMelding()}</div>
          </Show>
          <Show when={indexStatus() === 'offline'}>
            <div class="sp-settings-download sp-settings-download-note">{t('symbolPalette.libraryOffline')}</div>
          </Show>
          <Show when={dlInfo().toFetch.length > 0 || dlInfo().tagOnly.length > 0 || downloadBusy()}>
            <div class="sp-settings-download">
              <Show when={!downloadBusy()} fallback={
                <span class="sp-settings-download-label">
                  {t('symbolPalette.downloading', {
                    current: Math.min((downloadProgress()?.done ?? 0) + 1, downloadProgress()?.total ?? 1),
                    total: downloadProgress()?.total ?? 1,
                    label: downloadProgress()?.label || '',
                  })}
                </span>
              }>
                <span class="sp-settings-download-label">
                  {dlInfo().toFetch.length > 0
                    ? t('symbolPalette.availableOnline', { n: dlInfo().toFetch.length, symbols: dlInfo().symbolCount })
                    : t('symbolPalette.activateDownloaded', { n: dlInfo().tagOnly.length })}
                </span>
                <button id="symbol-library-download" class="sp-settings-btn-add"
                  disabled={downloadUit}
                  title={downloadUit ? downloadMelding() : undefined}
                  onClick={() => downloadCountrySector(selectedCountry(), selectedIndustry())}>
                  {t('symbolPalette.download')}
                </button>
              </Show>
            </div>
          </Show>
          <Show when={downloadError()}>
            <div class="sp-settings-download sp-settings-download-error">{t('symbolPalette.downloadFailed', { error: downloadError() })}</div>
          </Show>
          <div class="sp-settings-body">
            <For each={allCategories().filter(c => matchesLocale(c, selectedIndustry(), selectedCountry()))}>
              {(cat) => (
                <div class="sp-settings-group" style={{ opacity: isGroupEnabled(cat.id) ? 1 : 0.5 }}>
                  <div class="sp-settings-group-header">
                    <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                      <input type="checkbox" checked={isGroupEnabled(cat.id)}
                        onChange={() => toggleGroupEnabled(cat.id)}
                        style={{ margin: 0, cursor: 'pointer' }} />
                      <span class="sp-settings-group-name" style={{ color: cat.color || '#333' }}>{categoryLabel(t, cat)}</span>
                    </label>
                    <Show when={cat.builtin}>
                      <span class="sp-settings-group-badge">{t('symbolPalette.builtIn')}</span>
                    </Show>
                    <Show when={!cat.builtin && cat.online}>
                      <span class="sp-settings-group-badge">{t('symbolPalette.online')}</span>
                    </Show>
                    <Show when={!cat.builtin}>
                      <button class="sp-settings-btn-add" style={{ height: '20px', 'font-size': '9px', padding: '0 6px' }}
                        onClick={() => handleUploadClick(cat.id)}>{t('symbolPalette.addSymbol')}</button>
                      <button class="sp-settings-btn-add" style={{ height: '20px', 'font-size': '9px', padding: '0 6px' }}
                        onClick={() => handleExportGroup(cat)}>{t('symbolPalette.export')}</button>
                      <button class="sp-settings-btn-remove" onClick={() => removeCustomGroup(cat.id)}>{t('symbolPalette.remove')}</button>
                    </Show>
                  </div>
                  <div class="sp-settings-symbols">
                    <For each={cat.symbols}>
                      {(sym) => (
                        <div class="sp-settings-symbol" title={sym.name}
                          innerHTML={colorizeSvg(sym.svg, cat.color)} />
                      )}
                    </For>
                    <Show when={cat.symbols.length === 0}>
                      <span style={{ 'font-size': '10px', color: '#999' }}>{t('symbolPalette.noSymbolsYet')}</span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="sp-settings-footer">
            <input
              type="text"
              placeholder={t('symbolPalette.newGroupName')}
              value={newGroupName()}
              onInput={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup(); }}
            />
            <button class="sp-settings-btn-add" disabled={!newGroupName().trim()} onClick={handleAddGroup}>
              {t('symbolPalette.addGroup')}
            </button>
            <button class="sp-settings-btn-add" onClick={() => importGroupInputRef?.click()}>
              {t('symbolPalette.importGroup')}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function toggleSymbolPalette() {
  const willBeVisible = !symbolPaletteVisible();
  setSymbolPaletteVisible(willBeVisible);
  const mode = symbolPaletteMode();
  if (willBeVisible && mode.startsWith('docked-')) {
    registerPaletteDock('symbols', mode.replace('docked-', ''));
  } else {
    unregisterPaletteDock('symbols');
  }
  saveSymbolPaletteState();
}
