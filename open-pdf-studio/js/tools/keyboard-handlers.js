import { state, getActiveDocument, selectAllOnPage, clearSelection } from '../core/state.js';
import { undo, redo, recordAdd, recordModify, recordBulkModify, recordClearPage } from '../core/undo-manager.js';
import { setTool } from './manager.js';
import { heeftGekozenAfbeelding, wisAfbeeldingSelectie, deleteSelectedEmbeddedImage } from './tools/remove-image-tool.js';
import { showPreferencesDialog, setAsDefaultStyle } from '../core/preferences.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { copyAndMove } from './edit-ops.js';
import { showDocPropertiesDialog, showNewDocDialog, showPrintDialog } from '../ui/chrome/dialogs.js';
import { copyAnnotation, copyAnnotations, pasteAnnotation, pasteAnnotations } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { applyMove } from '../annotations/transforms.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } from './annotation-creators.js';
import { openPDFFile, isPdfAReadOnly } from '../pdf/loader.js';
import { actualSize, fitWidth, fitPage, goToPage } from '../pdf/renderer.js';
import { draaiVanafKnop } from '../pdf/pagina-draaien.js';
import { weergaveVectorNaarPagina } from '../pdf/weergave-ruimte.js';
import { activeTab } from '../solid/stores/leftPanelStore.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { toggleAnnotationsListPanel } from '../ui/panels/annotations-list.js';
import { toggleLeftPanel } from '../ui/panels/left-panel.js';
import { switchRibbonTab as switchToTab } from '../bridge.js';
import { openFindBar, closeFindBar, onFindNext } from '../search/find-bar.js';
import { closeActiveTab, wisselTabMetSneltoets } from '../ui/chrome/tabs.js';
import { isTextEntryTarget, tabSneltoetsRichting, maakTabSneltoetsHandler, maakTabWisselaar } from '../ui/chrome/tab-sneltoets.js';
import { hideProperties, showProperties, showMultiSelectionProperties, togglePropertiesPanel } from '../ui/panels/properties-panel.js';
import { wisselTagEnRuimte } from '../plattegrond/ruimte-selectie.js';
import { openDialog, getDialogs } from '../bridge.js';
import { getTool } from './tool-registry.js';
import { resolvePointerCoords, buildToolContext, isModalOpen } from './tool-context.js';
import { tryStartGMove, isGMoveModeActive } from './g-move-mode.js';
import { tryStartGRotate, isGRotateModeActive } from './g-rotate-mode.js';
import { toggleFullscreen, exitFullscreen, getFullscreenState } from '../ui/chrome/fullscreen.js';
import { typeLengthActive, consumeKey as typeLengthConsumeKey, typeLengthCursor } from './type-length-input.js';
import { startGripLengteInvoer, stopGripLengteInvoer, herstelStramienMeeslepen } from './tool-dispatcher.js';
import { tabDoorOnderdelen, verwijderOnderdeel } from '../gevelelement/app-bewerking.js';
import { gevelPreset } from '../gevelelement/herkenning.js';
import { isTextAnchored, expandCorrectionGroups, replaceParentOf } from '../annotations/corrections/model.js';
import { deleteAnnotationsWithUndo } from '../annotations/mutations.js';
import { installProofreadingKeys, toggleProofreading } from './proofreading-mode.js';
import { paginaSneltoetsRichting, paginaToetsVoorInvoer, paginaSprongDoel, maakPaginaBladeraar } from '../pdf/pagina-sneltoets.js';
import { splitToetsOpdracht, splitToetsGeblokkeerd, isSplitOpdracht } from '../pdf/split-view/split-sneltoets.js';
import {
  sneltoetsActief, eigenSneltoetsVoor, voerSneltoetsUit, sneltoetsInInvoer,
  maakStandaardToets, zetIngebouwdeUitvoerder, isSneltoetsOpname,
} from '../core/keybindings/app-shortcuts.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// ── Aanpasbare sneltoetsen (#714) ─────────────────────────────────────────
// De ingebouwde toetsen hieronder houden hun eigen afhandeling, met alle
// uitzonderingen. Elke tak vraagt eerst of zijn toets nog bij zijn opdracht
// hoort (de gebruiker kan hem verwijderd of aan een andere opdracht gegeven
// hebben); zo niet, dan doet de tak niets. Een toets die de gebruiker zelf
// aan een opdracht gaf, loopt via eigenSneltoetsVoor/voerSneltoetsUit; voor
// een ingebouwde opdracht draait dan dezelfde tak hieronder, met een
// nagebootste standaardtoets die de opdracht bij naam draagt (GEFORCEERD).
const GEFORCEERD = '__sneltoetsOpdracht';
function aan(e, id, combo) {
  if (e && e[GEFORCEERD]) return e[GEFORCEERD] === id;
  return sneltoetsActief(id, combo) !== false;
}

function modaalOpen() {
  return !!isModalOpen() || (typeof getDialogs === 'function' && (getDialogs() || []).length > 0);
}

function wisselObjectSnap() {
  try {
    state.preferences.enableObjectSnap = !state.preferences.enableObjectSnap;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
  } catch (_) {}
}

// Een ingebouwde opdracht uitvoeren voor een zelf gekozen toets.
async function voerIngebouwdeOpdrachtUit(id, e) {
  if (id === 'search.find') { openFindBar(); return; }
  if (id === 'search.findNext') {
    if (state.search.isOpen) onFindNext();
    else openFindBar();
    return;
  }
  if (id === 'drafting.objectSnap') { wisselObjectSnap(); return; }
  // Ctrl+P staat in main.js (vóór de afdrukdialoog van de WebView), F2 in proofreading-mode.js.
  if (id === 'file.print') { showPrintDialog(); return; }
  if (id === 'review.proofreading') { toggleProofreading(); return; }
  // Gesplitste weergave (#858); Groter/Kleiner hebben geen standaardtoets.
  if (isSplitOpdracht(id)) {
    if (!splitToetsGeblokkeerd(e?.target, { modaalOpen: modaalOpen() })) voerSplitOpdracht(id);
    return;
  }
  const nep = maakStandaardToets(e, id);
  if (!nep) return;
  nep[GEFORCEERD] = id;
  // Volgende/vorige pagina op een zelf gekozen toets (#714, #751).
  if (handlePaginaSneltoets(nep)) return;
  await voerStandaardToetsUit(nep);
}
zetIngebouwdeUitvoerder(voerIngebouwdeOpdrachtUit);

function voerSplitOpdracht(id) {
  import('../pdf/split-view/split-view.js').then(m => m.voerSplitOpdrachtUit(id)).catch(() => {});
}

// Paginarotatie via sneltoets. Zelfde undo-bare pad als de draaiknoppen op de
// tabbladen Beeld en Organiseren (pagina-draaien.js, #464).
const rotateCurrentPageBy = (delta) => draaiVanafKnop(delta);

// Live preview while TYPING a measurement: re-fire the normal pointermove
// pipeline at the last known cursor position so the active tool re-renders
// its rubber-band with the new constrained length ("5" → "50" → "500" grows
// on screen as you type). One generic mechanism for every tool — line,
// arrow, dimension, area, hatch area, polyline — no per-tool preview code.
function _refreshTypeLengthPreview(srcEvent) {
  try {
    const pos = typeLengthCursor();
    if (!pos || (pos.x === 0 && pos.y === 0)) { redraw(); return; }
    let target = document.elementFromPoint(pos.x, pos.y);
    target = target && target.closest
      ? (target.closest('#annotation-canvas') || target.closest('.annotation-canvas'))
      : null;
    if (!target) target = document.getElementById('annotation-canvas');
    if (!target) { redraw(); return; }
    const ev = new PointerEvent('pointermove', {
      clientX: pos.x,
      clientY: pos.y,
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
      shiftKey: !!srcEvent?.shiftKey,
      ctrlKey: !!srcEvent?.ctrlKey,
      altKey: !!srcEvent?.altKey,
    });
    target.dispatchEvent(ev);
  } catch (_) {
    redraw();
  }
}

// ── Escape → tool-afronding (GitHub #273) ─────────────────────────────────
// Bouw een VOLWAARDIGE tool-context voor de Escape-afhandeling, zodat een
// tool zijn onEscape-hook met exact dezelfde context kan draaien als de
// rechtermuisklik-afronding in de dispatcher (createAnnotation, recordAdd,
// createMeasureAreaAnnotation, redraw, ...). De coördinaten komen van de
// laatst bekende cursorpositie (typeLengthCursor-tracker); de afrondroutines
// gebruiken die niet voor het committen zelf.
function _buildEscapeToolContext() {
  try {
    const pos = typeLengthCursor();
    let target = null;
    if (pos && (pos.x || pos.y) && document.elementFromPoint) {
      const el = document.elementFromPoint(pos.x, pos.y);
      target = el && el.closest
        ? (el.closest('#annotation-canvas') || el.closest('.annotation-canvas'))
        : null;
    }
    if (!target) {
      target = document.getElementById('annotation-canvas')
        || document.querySelector('.annotation-canvas');
    }
    if (!target) return null;
    const fakeEvent = {
      clientX: pos ? pos.x : 0,
      clientY: pos ? pos.y : 0,
      button: 2,
      detail: 0,
      target,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      preventDefault() {}, stopPropagation() {},
    };
    const coords = resolvePointerCoords(fakeEvent);
    return buildToolContext(fakeEvent, coords);
  } catch (_) {
    return null;
  }
}

// ── CAD-style two-letter command chords (AutoCAD-style command line) ──
// Map of command → action. Two-letter codes win over one-letter codes; if a
// one-letter prefix is also a valid command, the timeout fires it after CHORD_MS.
const CAD_CHORDS = {
  // 't' alleen = tekstvak (bestaande enkel-toets-sneltoets). Moet als
  // chord-commando geregistreerd staan: de buffer consumeert 't' als prefix
  // van 'tr'/'tx'/'tl', en alleen geregistreerde commando's vuren bij de
  // time-out — zonder deze regel deed een losse T dus helemaal niets.
  't': () => { if (sneltoetsActief('tool.textbox', 'T') !== false) setTool('textbox'); },
  'tr': () => setTool('trim'),
  'ex': () => setTool('extend'),
  'tx': () => setTool('textbox'),
  'cs': () => createSimilarFromSelection(),
  // 'mv' = Move: same engine as the G key, but AutoCAD-style — first click
  // picks the (object-snapped) BASE point, second click drops. ALL
  // interactive moving funnels through g-move-mode.js (one move session,
  // applyMove as the single per-type primitive).
  'mv': () => tryStartGMove({ basePoint: true }),
  // 'tl' = Toggle Lineweight display (CAD LWDISPLAY): draw everything with a
  // max 1pt hairline instead of true widths. Pure display toggle —
  // annotation lineWidth values stay untouched.
  'tl': () => {
    // Also the PAGE content, not only the annotations (#595).
    import('../pdf/thin-lines.js').then(m => m.toggleThinLines());
  },
  // 'co' = Copy: duplicate + move via the EDIT-OPS layer (edit-ops.js) —
  // the one place where target resolution, cloning and the move session
  // live. Never reimplement copying per-tool or per-type.
  'co': () => copyAndMove(),
  // 'ro' = Rotate: interactive rotate session around the joint selection
  // centre (g-rotate-mode.js — applyRotateGeneric as the single per-type
  // primitive, same walker tables as move). Shift = angle snap.
  'ro': () => tryStartGRotate(),
  // Reserved for future: 'l' line, 'c' circle, 'mi' mirror, 'ar' array, etc.
};

// "CS" — Create Similar (BricsCAD-style): take the selected annotation,
// persist its style as the default for its type, and activate the tool that
// draws that type. The next annotation the user draws comes out identical in
// style to the selected one. Works for every annotation type that has a
// matching tool (which is all built-ins: annotation.type === tool name).
function createSimilarFromSelection() {
  const doc = getActiveDocument();
  const selArr = doc?.selectedAnnotations || [];
  const sel = selArr.length >= 1 ? selArr[0] : (doc?.selectedAnnotation || null);
  if (!sel) return; // nothing selected → no-op

  // Style of the selected annotation becomes the tool default for its type
  // (same mechanism as the context-menu "Set as Default Style").
  try { setAsDefaultStyle(sel); } catch (_) {}

  // Walls carry their material + thickness through toolOverrides (the same
  // channel the palette uses) so the NEXT wall comes out identical.
  if (sel.type === 'wall') {
    state.toolOverrides = {
      wallPattern: sel.hatchPattern || 'nen47-metselwerk-baksteen',
      wallDikteMm: sel.dikteMm || 100,
      wallIsolatieType: sel.isolatieType,
    };
  }

  // Built-in annotation types share their tool's name; plugin types resolve
  // via the annotation-type registry (the dispatcher handles those tools).
  const toolName = sel.type;
  if (getTool(toolName) || getAnnotationType(toolName)) {
    setTool(toolName);
  }
}
const CHORD_MS = 1200;
let _chordBuffer = '';
let _chordTimer = null;

function _resetChord() {
  _chordBuffer = '';
  if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null; }
}

// Returns true if the keystroke was consumed by the chord system.
function _cadChordTry(letter) {
  // Skip if a single-key tool shortcut would handle this letter alone (G is
  // already returned-on earlier; A toggles arc-mode; Esc/Tab handled separately).
  if (letter === 'g' || letter === 'a') return false;

  const next = _chordBuffer + letter;

  // Langere chords winnen van korte: een exacte match vuurt alleen direct
  // als hij GEEN prefix van een langere chord is ('t' wacht dus op de
  // time-out zodat 'tr'/'tx'/'tl' bereikbaar blijven).
  const isPrefix = Object.keys(CAD_CHORDS).some(k => k.startsWith(next) && k !== next);

  // Exact match zonder langere kandidaat: fire and clear.
  if (CAD_CHORDS[next] && !isPrefix) {
    _resetChord();
    try { CAD_CHORDS[next](); } catch (_) {}
    return true;
  }

  // Prefix of some longer chord? Buffer and wait.
  if (isPrefix) {
    _chordBuffer = next;
    if (_chordTimer) clearTimeout(_chordTimer);
    _chordTimer = setTimeout(() => {
      // Timeout: if the buffer itself is a valid (single-letter) command, fire it.
      if (CAD_CHORDS[_chordBuffer]) {
        try { CAD_CHORDS[_chordBuffer](); } catch (_) {}
      }
      _resetChord();
    }, CHORD_MS);
    return true;
  }

  // No match and not a prefix → reset and let the keystroke fall through.
  _resetChord();
  return false;
}

// ── Tabblad wisselen: Ctrl+Tab / Ctrl+PageDown en terug (#539) ─────────────
// Hangt in de capture-fase op window (zie initKeyboardHandlers): daar komt
// de toets als eerste langs, waar de focus ook staat, en kan geen component
// hem inslikken. Zelfde tekstinvoer-bewaking als de andere sneltoetsen
// (isTextEntryTarget, tab-sneltoets.js). De rem laat bij ingedrukt houden
// geen achterstand ontstaan: een volgende wissel start pas als de vorige in
// beeld staat, en er wacht er hoogstens één.
const _tabWisselaar = maakTabWisselaar({
  wissel: (richting) => wisselTabMetSneltoets(richting),
  // Na het eerstvolgende frame (requestAnimationFrame + taak erna), met een
  // vangnet voor een verborgen venster waar geen frames komen.
  naBeeld: () => new Promise((klaar) => {
    let gedaan = false;
    const af = () => { if (!gedaan) { gedaan = true; klaar(); } };
    requestAnimationFrame(() => setTimeout(af, 0));
    setTimeout(af, 250);
  }),
  wacht: (ms) => new Promise((klaar) => setTimeout(klaar, ms)),
});

const handleTabSneltoets = maakTabSneltoetsHandler({
  wisselaar: _tabWisselaar,
  bewaking: () => ({
    modaalOpen: isModalOpen()
      || (typeof getDialogs === 'function' && (getDialogs() || []).length > 0),
    tekstBewerking: !!(state.isEditingText || state.pdfTextEditState),
    // Verplaatsen/draaien (G), bijsnijden of een lengte intikken midden in
    // een tekening: die sessie hoort bij het huidige document.
    bezigeSessie: isGMoveModeActive() || isGRotateModeActive() || !!state.imageCropMode || typeLengthActive(),
  }),
});

// Pijltoetsen die bij een besturingselement horen (#551): de lint-tabstrook
// wisselt er tabbladen mee, een menu of keuzelijst kiest ermee. Zo'n toets
// verschuift geen annotaties en bladert niet. Ook een toets die al is
// afgehandeld (defaultPrevented) laat de selectie staan.
const PIJL_BESTURING = '[role="tablist"], [role="tab"], [role="menu"], [role="menubar"], [role="listbox"], [role="radiogroup"], select, .ribbon-tabs';
function pijlVoorBesturing(e) {
  if (e.defaultPrevented) return true;
  const t = e.target;
  return typeof t?.closest === 'function' && !!t.closest(PIJL_BESTURING);
}

// ── Bladeren: PageDown / PageUp naar de volgende/vorige pagina (#751, #713) ──
// Zelfde navigatie als de knoppen Vorige/Volgende in het lint (goToPage), dus
// de zoom blijft staan; facing springt een hele spread. De bladeraar laat bij
// ingedrukt houden toetsherhalingen vallen zolang de vorige sprong nog loopt
// (render, of de vloeiende scroll in de doorlopende weergave).

// Doorlopende weergave: de pagina die bovenaan in beeld staat. currentPage
// volgt daar het MIDDEN van het beeld (en loopt tijdens een vloeiende scroll
// even mee), dus uitgezoomd zou PageDown anders een pagina overslaan.
function paginaBovenInBeeld(doc) {
  if (doc?.viewMode !== 'continuous' || doc.facingSpread) return doc?.currentPage || 1;
  const container = document.getElementById('pdf-container');
  if (!container) return doc.currentPage || 1;
  const boven = container.getBoundingClientRect().top + 4;
  let gevonden = null;
  document.querySelectorAll('#continuous-container .page-wrapper').forEach((w) => {
    const pagina = parseInt(w.dataset.page, 10);
    if (Number.isFinite(pagina) && w.getBoundingClientRect().top <= boven
        && (gevonden === null || pagina > gevonden)) gevonden = pagina;
  });
  return gevonden ?? (doc.currentPage || 1);
}

// Klaar als de sprong in beeld staat: na een frame, en in de doorlopende
// weergave pas als de scrollpositie een paar frames stilstaat.
function paginaSprongInBeeld() {
  return new Promise((klaar) => {
    const container = document.getElementById('pdf-container');
    const scrollt = getActiveDocument()?.viewMode === 'continuous' && !getActiveDocument()?.facingSpread;
    let vorige = container ? container.scrollTop : 0;
    let stil = 0;
    let gedaan = false;
    const af = () => { if (!gedaan) { gedaan = true; klaar(); } };
    const stap = () => {
      if (gedaan) return;
      if (!scrollt || !container) { setTimeout(af, 0); return; }
      const nu = container.scrollTop;
      stil = nu === vorige ? stil + 1 : 0;
      vorige = nu;
      if (stil >= 3) af();
      else requestAnimationFrame(stap);
    };
    requestAnimationFrame(stap);
    // Vangnet voor een verborgen venster waar geen frames komen.
    setTimeout(af, scrollt ? 1500 : 250);
  });
}

const _paginaBladeraar = maakPaginaBladeraar({
  blader: (richting) => {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) return undefined;
    const doel = paginaSprongDoel({
      huidig: paginaBovenInBeeld(doc),
      totaal: doc.pdfDoc.numPages || 1,
      facing: !!doc.facingSpread,
    }, richting);
    return doel ? goToPage(doel) : undefined;
  },
  naBeeld: paginaSprongInBeeld,
  wacht: (ms) => new Promise((klaar) => setTimeout(klaar, ms)),
});

/**
 * PageUp/PageDown zonder Ctrl/Shift/Alt: bladert in de hoofdweergave.
 * Tekstvelden, keuzelijsten, contenteditable, dialogen en een lopende
 * tekstbewerking houden de toets. De vergelijkingsweergave vangt hem al in
 * haar eigen capture-handler af.
 * @returns {boolean} true als de toets hier is afgehandeld
 */
function handlePaginaSneltoets(e) {
  const richting = paginaSneltoetsRichting(e);
  // Een zelf gekozen toets (GEFORCEERD) is al door de dispatcher afgevangen.
  if (!richting || (e.defaultPrevented && !e[GEFORCEERD])) return false;
  // De toets moet nog bij de opdracht horen (#714): een gebruiker kan
  // PageDown/PageUp verwijderd of aan een andere opdracht gegeven hebben.
  if (richting > 0 ? !aan(e, 'view.nextPage', 'PageDown') : !aan(e, 'view.previousPage', 'PageUp')) return false;
  if (paginaToetsVoorInvoer(e.target)) return false;
  if (isModalOpen() || (typeof getDialogs === 'function' && (getDialogs() || []).length > 0)) return false;
  if (state.isEditingText || state.pdfTextEditState) return false;
  if (!getActiveDocument()?.pdfDoc) return false;
  e.preventDefault();
  _paginaBladeraar.vraag(richting, !!e.repeat);
  return true;
}

export async function handleKeydown(e) {
  // De tabwissel-toetsen zijn al afgehandeld (of bewust geweigerd) door
  // handleTabSneltoets; niets hieronder mag er nog op reageren.
  if (tabSneltoetsRichting(e)) return;
  // De voorkeuren nemen net een nieuwe sneltoets op (#714).
  if (isSneltoetsOpname()) return;

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  // Letter van een Ctrl-sneltoets, altijd in kleine letters: met Caps Lock aan
  // geeft e.key een hoofdletter zonder dat Shift is ingedrukt (#577). Alleen
  // `shift` onderscheidt dus Ctrl+S van Ctrl+Shift+S.
  const shortcutKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';

  // Allow certain shortcuts even when in input fields
  const isInInput = isTextEntryTarget(e.target);
  const isFindInput = e.target.id === 'find-input';

  // Een zelf gekozen toets voor een opdracht die ook tijdens het typen werkt
  // (Zoeken, #714); alleen met Ctrl/Alt/Meta of een functietoets.
  const dialoogOpen = modaalOpen();
  const vroeg = eigenSneltoetsVoor(e, { inTextEntry: isInInput, modalOpen: dialoogOpen });
  if (vroeg && sneltoetsInInvoer(vroeg.id)) {
    e.preventDefault();
    await voerSneltoetsUit(vroeg.id, e);
    return;
  }

  // Keep Select All scoped to an active text-edit session, even when focus
  // temporarily moved to the properties panel or the document itself.
  if (ctrl && !shift && !e.altKey && shortcutKey === 'a'
      && (state.isEditingText || state.pdfTextEditState)) {
    const editor = document.querySelector('.inline-text-editor, .pdf-text-editor');
    if (editor) {
      e.preventDefault();
      e.stopPropagation();
      editor.focus();
      if (typeof editor.select === 'function') {
        editor.select();
      } else {
        // contenteditable: selecteer de volledige editor-inhoud
        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
      return;
    }
  }

  // Handle find-related shortcuts even in inputs
  if (ctrl && !shift && shortcutKey === 'f' && aan(e, 'search.find', 'Ctrl+F')) {
    e.preventDefault();
    openFindBar();
    return;
  }



  if (e.key === 'F3' && !isFindInput
      && aan(e, e.shiftKey ? 'drafting.objectSnap' : 'search.findNext', e.shiftKey ? 'Shift+F3' : 'F3')) {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+F3: toggle the master object snap setting
      wisselObjectSnap();
      return;
    }
    if (state.search.isOpen) {
      onFindNext();
    } else {
      openFindBar();
    }
    return;
  }

  // Skip other shortcuts if typing in an input field (except find input which handles its own keys)
  if (isInInput && !isFindInput) {
    return;
  }

  // Type-length capture (CAD-style "type length"). Active when a tool that
  // supports it has called enterTypeLengthMode after committing the start
  // point. We forward digits / '.' / ',' / Backspace / Enter / Escape to the
  // capture module. Enter triggers the active tool's _typeLengthCommit hook
  // (set by the tool when it activates the mode).
  // NOTE: this runs before any tool's own onKeyDown, so while a length is
  // being typed, Backspace edits the typed digits (handled below) instead
  // of falling through to a tool's own Backspace binding (e.g. the filled-
  // area tool's "undo last point"). That's intentional — deleting a typo
  // in the number you're mid-typing should not also delete a vertex.
  // Tijdens het slepen van een eindpunt-handvat (maatlijn, lijn, pijl) opent
  // het eerste cijfer dezelfde invoer; het vaste eindpunt is dan het anker.
  if (!ctrl && !e.altKey) startGripLengteInvoer(e.key);
  if (typeLengthActive()) {
    const result = typeLengthConsumeKey(e.key);
    if (result.handled) {
      e.preventDefault();
      if (result.committed && typeof state._typeLengthCommit === 'function') {
        state._typeLengthCommit(result.length);
      } else {
        // Buffer changed → re-run the tool's preview at the current cursor so
        // the rubber-band live-updates to the typed length while typing.
        _refreshTypeLengthPreview(e);
      }
      return;
    }
  }

  // A — in edit-contour mode, toggle "next inserted vertex is an arc vertex"
  // flag. The flag is consumed (reset) by select-tool.js when an edge-midpoint
  // click inserts a new vertex.
  if ((e.key === 'a' || e.key === 'A') && !ctrl && !e.altKey && !shift && state.editingContour) {
    e.preventDefault();
    state._editArcMode = !state._editArcMode;
    redraw();
    return;
  }

  // Tab op een ruimtetag of ruimte (plattegrond): wissel tussen de tag en
  // zijn ruimte - een ruimte is met een klik niet te pakken.
  if (e.key === 'Tab' && !ctrl && !e.altKey && !shift && wisselTagEnRuimte()) {
    e.preventDefault();
    return;
  }

  // Tab — toggle "edit contour" mode for a single selected filledArea annotation
  if (e.key === 'Tab' && !ctrl && !e.altKey) {
    const _doc = getActiveDocument();
    const _sel = _doc ? _doc.selectedAnnotations : [];
    if (_sel.length === 1 && _sel[0].type === 'filledArea') {
      e.preventDefault();
      if (state.editingContour === _sel[0].id) {
        state.editingContour = null;
        state._editArcMode = false;
      } else {
        state.editingContour = _sel[0].id;
      }
      redraw();
      return;
    }
    // Gevelelement (vliesgevel/kozijn): Tab loopt door de onderdelen —
    // stijlen, dan panelen, dan weer het geheel; Shift+Tab terug. Zonder
    // selectie geldt het element onder de aanwijzer.
    if (tabDoorOnderdelen(shift ? -1 : 1)) {
      e.preventDefault();
      return;
    }
  }

  // G-key Blender-style move mode (issue #210) — only trigger when not already
  // in G-mode (g-move-mode.js intercepts subsequent keys at capture phase).
  if (!ctrl && !shift && !e.altKey && !isGMoveModeActive() && !isGRotateModeActive() && (e.key === 'g' || e.key === 'G')) {
    if (tryStartGMove()) {
      e.preventDefault();
      return;
    }
  }

  // CAD-style two-letter command chords (AutoCAD-style: "TR"=Trim, "EX"=Extend,
  // "L"=Line, "C"=Circle, "M"=Move, "CO"=Copy, "TR"=Trim, "EX"=Extend, ...).
  // Buffer alphabetic keys for ~1.2s; on each keystroke check for a match.
  // No modifier keys (ctrl/alt) and not while a tool is mid-operation.
  // Een letter die de gebruiker zelf aan een opdracht gaf (#714), gaat voor.
  if (!ctrl && !e.altKey && /^[a-zA-Z]$/.test(e.key) && !isGMoveModeActive() && !isGRotateModeActive() && !typeLengthActive()
      && !eigenSneltoetsVoor(e, { modalOpen: dialoogOpen })) {
    if (_cadChordTry(e.key.toLowerCase())) {
      e.preventDefault();
      return;
    }
  }

  // Find input handles Enter, Shift+Enter, and Escape internally
  if (isFindInput) {
    return;
  }

  // Delegate keydown to active tool (e.g. arc mode toggle for measureArea)
  const _activeTool = getTool(state.currentTool);
  if (_activeTool && _activeTool.onKeyDown) {
    // Build a minimal context for tool key handlers
    const _keyCtx = { state, redraw };
    _activeTool.onKeyDown(_keyCtx, e);
    if (e.defaultPrevented) return;
  }

  // Enter key - complete area/perimeter measurement
  if (e.key === 'Enter' && state.measurePoints && state.measurePoints.length >= 2) {
    e.preventDefault();
    const points = [...state.measurePoints];
    let ann;
    if (state.currentTool === 'measureArea' && points.length >= 3) {
      ann = createMeasureAreaAnnotation(points);
    } else if (state.currentTool === 'measurePerimeter' && points.length >= 2) {
      ann = createMeasurePerimeterAnnotation(points);
    }
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      recordAdd(ann);
    }
    state.measurePoints = null;
    redraw();
    return;
  }

  // PageDown / PageUp: volgende/vorige pagina (#751, #713).
  if (handlePaginaSneltoets(e)) return;

  // Een toets die de gebruiker zelf aan een opdracht gaf (#714).
  const eigen = eigenSneltoetsVoor(e, { modalOpen: dialoogOpen });
  if (eigen) {
    e.preventDefault();
    await voerSneltoetsUit(eigen.id, e);
    return;
  }

  return voerStandaardToetsUit(e);
}

// De ingebouwde sneltoetsen. Elke tak met een opdracht begint met aan(...):
// hoort de toets niet meer bij de opdracht, dan doet de tak niets (#714).
async function voerStandaardToetsUit(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const shortcutKey = typeof e.key === 'string' ? e.key.toLowerCase() : '';

  // File shortcuts
  if (ctrl && !shift && shortcutKey === 'n') {
    if (!aan(e, 'file.new', 'Ctrl+N')) return;
    e.preventDefault();
    showNewDocDialog();
  } else if (ctrl && !shift && shortcutKey === 'o') {
    if (!aan(e, 'file.open', 'Ctrl+O')) return;
    e.preventDefault();
    openPDFFile();
  } else if (ctrl && shift && shortcutKey === 's') {
    if (!aan(e, 'file.saveAs', 'Ctrl+Shift+S')) return;
    e.preventDefault();
    savePDFAs();
  } else if (ctrl && shortcutKey === 's') {
    if (!aan(e, 'file.save', 'Ctrl+S')) return;
    e.preventDefault();
    savePDF();
  } else if (ctrl && !shift && shortcutKey === 'w') {
    if (!aan(e, 'file.close', 'Ctrl+W')) return;
    e.preventDefault();
    closeActiveTab();
  }
  // Ctrl+P is intercepted earlier in the capture phase (main.js
  // disableBrowserShortcuts) so it can suppress WebView2's native print
  // dialog; handling it here as well would open ours twice.

  // Edit shortcuts
  else if (ctrl && !shift && shortcutKey === 'z') {
    if (!aan(e, 'edit.undo', 'Ctrl+Z')) return;
    e.preventDefault();
    undo();
  } else if (ctrl && shortcutKey === 'y') {
    if (!aan(e, 'edit.redo', 'Ctrl+Y')) return;
    e.preventDefault();
    redo();
  } else if (ctrl && shift && shortcutKey === 'z') {
    if (!aan(e, 'edit.redo', 'Ctrl+Shift+Z')) return;
    e.preventDefault();
    redo();
  } else if (ctrl && !shift && shortcutKey === 'a') {
    if (!aan(e, 'edit.selectAll', 'Ctrl+A')) return;
    // Ctrl+A: Select all annotations on current page
    e.preventDefault();
    const _selDoc = getActiveDocument();
    if (_selDoc?.pdfDoc) {
      selectAllOnPage();
      const _selAnns = _selDoc.selectedAnnotations;
      if (_selAnns.length === 1) {
        showProperties(_selAnns[0]);
      } else if (_selAnns.length > 1) {
        showMultiSelectionProperties();
      }
      redraw();
    }
  } else if (e.key === 'Delete') {
    if (!aan(e, 'edit.delete', 'Delete')) return;
    e.preventDefault();
    if (heeftGekozenAfbeelding()) {
      // Afbeelding bewerken: Delete verwijdert de gekozen afbeelding uit de pagina.
      if (!isPdfAReadOnly()) deleteSelectedEmbeddedImage();
      return;
    }
    if (isPdfAReadOnly()) { /* block */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      // Een vervanging (#508) telt met beide helften, ook in de vraag.
      const selected = expandCorrectionGroups(getActiveDocument().annotations,
        [...getActiveDocument().selectedAnnotations]);
      // Gevelelement met een geselecteerd onderdeel: Delete verwijdert de
      // STIJL (velden samengevoegd) of zet het standaardpaneel terug — nooit
      // per ongeluk het hele element.
      if (selected.length === 1 && gevelPreset(selected[0]) && selected[0].selectedSub) {
        if (!selected[0].locked && verwijderOnderdeel(selected[0])) return;
        if (selected[0].locked) return;
      }
      // Systeem-sub-element geselecteerd: Delete reset het ONDERDEEL naar
      // het type-default (paneel-override weg = tegel/typedefault; rand-
      // override weg = profiel van het type) en verwijdert NOOIT per
      // ongeluk het hele component. Rasterlijn: niets te resetten —
      // consumeren zodat het component blijft staan.
      if (selected.length === 1 && selected[0].type === 'systeemraster'
          && selected[0].selectedSub) {
        const subAnn = selected[0];
        const sub = subAnn.selectedSub;
        if (!subAnn.locked) {
          const { setPaneelType, setRandProfiel, removeSparing } =
            await import('../annotations/systeemraster.js');
          const before = cloneAnnotation(subAnn);
          if (sub.kind === 'paneel') setPaneelType(subAnn, sub.ix, sub.iy, 'tegel');
          else if (sub.kind === 'rand') setRandProfiel(subAnn, sub.seg, null);
          else if (sub.kind === 'sparing') {
            // Delete op een sparing VERWIJDERT de sparing zelf.
            removeSparing(subAnn, sub.id);
            subAnn.selectedSub = null;
          }
          subAnn.modifiedAt = new Date().toISOString();
          recordModify(subAnn.id, before, cloneAnnotation(subAnn));
          showProperties(subAnn);
          redraw();
        }
        return;
      }
      // Single locked check. Een vervanging (#508) telt als één annotatie:
      // vergrendeld als een van beide helften vergrendeld is.
      if ((selected.length === 1 || replaceParentOf(selected, getActiveDocument().annotations)) && selected.some(a => a.locked)) return;

      // Confirmation dialog
      {
        const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
        const msg = selected.length > 1
          ? `Delete ${selected.length} annotations?`
          : 'Delete this annotation?';
        const title = selected.length > 1 ? 'Delete Annotations' : 'Delete Annotation';
        const confirmed = await showConfirm({ title, message: msg, preferenceKey: 'confirmBeforeDelete' });
        if (!confirmed) return;
      }

      // Een vervanging (#508) gaat in haar geheel, met één ongedaan-stap.
      deleteAnnotationsWithUndo(getActiveDocument(), selected);
      clearSelection();
      hideProperties();
      redraw();
    }
  }
  // Arrow keys: nudge selected annotations (skip when Ctrl held)
  else if (!ctrl && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const voorBesturing = pijlVoorBesturing(e);
    if (voorBesturing) { /* de tabstrook, het menu of de keuzelijst is aan zet */ }
    else if (isPdfAReadOnly()) { /* block nudge */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0 && getActiveDocument()?.pdfDoc) {
      // Text markup annotations (and carets, #508) are anchored to text — skip nudge
      const movable = getActiveDocument().selectedAnnotations.filter(a => !isTextAnchored(a));
      if (movable.length === 0) return;

      e.preventDefault();
      const nudgeDoc = getActiveDocument();
      const step = (shift ? 10 : 1) / (nudgeDoc?.scale || 1);
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      // De pijl wijst een richting op het SCHERM aan; bij een gedraaide
      // weergave (#200) is dat op de pagina een andere richting.
      ({ x: dx, y: dy } = weergaveVectorNaarPagina(dx, dy, nudgeDoc));

      if (movable.length > 1) {
        const originals = movable.map(a => ({ ...a }));
        for (const ann of movable) applyMove(ann, dx, dy);
        recordBulkModify(movable, originals);
      } else {
        const original = { ...movable[0] };
        applyMove(movable[0], dx, dy);
        recordModify(movable[0].id, original, movable[0]);
      }
      redraw();
    }
    // Inhoudsopgave (TOC / bladwijzers) actief → met pijl omhoog/omlaag pagina-voor-
    // pagina door het document lopen i.p.v. de bladwijzerlijst te scrollen (GitHub #248).
    // Draait alleen als de nudge de toets niet al gebruikte (geen selectie) — ook read-only.
    if (!voorBesturing && !e.defaultPrevented && (e.key === 'ArrowDown' || e.key === 'ArrowUp')
        && ['thumbnails', 'bookmarks'].includes(activeTab())
        && !['INPUT', 'TEXTAREA'].includes(e.target?.tagName) && !e.target?.isContentEditable) {
      e.preventDefault();
      const navDoc = getActiveDocument();
      if (navDoc?.pdfDoc) {
        const total = navDoc.pdfDoc.numPages || 1;
        const cur = navDoc.currentPage || 1;
        const next = e.key === 'ArrowDown' ? Math.min(total, cur + 1) : Math.max(1, cur - 1);
        if (next !== cur) goToPage(next);
      }
    }
  }

  else if (ctrl && shift && shortcutKey === 'c') {
    if (!aan(e, 'edit.clearPage', 'Ctrl+Shift+C')) return;
    e.preventDefault();
    let confirmed = false;
    if (window.__TAURI__?.dialog?.ask) {
      confirmed = await window.__TAURI__.dialog.ask('Clear all annotations on current page?', { title: 'Clear Page', kind: 'warning' });
    } else {
      confirmed = confirm('Clear all annotations on current page?');
    }
    if (confirmed) {
      const cpDoc = getActiveDocument();
      const cpPage = cpDoc ? cpDoc.currentPage : 1;
      recordClearPage(cpPage, cpDoc?.annotations || []);
      if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
      hideProperties();
      redraw();
    }
  } else if (ctrl && !shift && shortcutKey === 'x') {
    if (!aan(e, 'edit.cut', 'Ctrl+X')) return;
    // Knippen: kopieer de selectie naar het interne klembord (en, voor
    // afbeeldingen, naar het systeemklembord) en verwijder haar daarna.
    // Zonder deze tak deed Ctrl+X niets — knippen bestond alleen als naam.
    // Geen bevestigingsdialoog: het geknipte zit op het klembord en de
    // verwijdering loopt via het gewone undo-pad.
    const cutDoc = getActiveDocument();
    // Een vervanging (#508) wordt in haar geheel geknipt.
    const cutSel = cutDoc ? expandCorrectionGroups(cutDoc.annotations, [...(cutDoc.selectedAnnotations || [])]) : [];
    if (cutSel.length > 0) {
      e.preventDefault();
      if (isPdfAReadOnly()) return;
      if (cutSel.some(a => a.locked)) return;
      if (cutSel.length > 1) copyAnnotations(cutSel);
      else copyAnnotation(cutSel[0]);
      deleteAnnotationsWithUndo(cutDoc, cutSel);
      clearSelection();
      hideProperties();
      redraw();
    }
  } else if (ctrl && !shift && shortcutKey === 'c') {
    if (!aan(e, 'edit.copy', 'Ctrl+C')) return;
    // Copy selected annotations (if none selected, let native copy handle text selection)
    const _copyDoc = getActiveDocument();
    const selected = _copyDoc ? _copyDoc.selectedAnnotations : [];
    if (selected.length > 0) {
      e.preventDefault();
      if (selected.length > 1) copyAnnotations(selected);
      else copyAnnotation(selected[0]);
    }
  } else if (ctrl && shift && shortcutKey === 'v') {
    if (!aan(e, 'edit.pasteInPlace', 'Ctrl+Shift+V')) return;
    // Plakken op plaats (paste in place) — GitHub #269: plak het interne
    // clipboard op de HUIDIGE pagina op exact de gekopieerde coördinaten.
    // preventDefault mag hier wél — dit pad gebruikt alleen het interne
    // annotatie-clipboard, geen native paste-event.
    e.preventDefault();
    if (!getActiveDocument()?.pdfDoc) return;
    if (isPdfAReadOnly()) return;
    import('../annotations/clipboard.js').then(({ pasteAnnotationsInPlace }) => pasteAnnotationsInPlace());
  } else if (ctrl && !shift && shortcutKey === 'v') {
    if (!aan(e, 'edit.paste', 'Ctrl+V')) return;
    // An annotation copied inside the app must be pasted directly. Asking the
    // native Clipboard API first can open a WebView permission prompt and
    // indefinitely postpone the internal paste (notably for line annotations).
    //
    // MAAR: is de app ná de interne kopie uit focus geweest, dan kan de
    // gebruiker elders iets nieuwers gekopieerd hebben. Het interne snelpad
    // zou dan het OUDE exemplaar plakken ("klembord loopt één achter").
    // In dat geval de native route nemen: die pakt een systeembeeld en valt
    // anders alsnog terug op het interne annotatie-klembord.
    const internalClips = state.clipboardAnnotations;
    const interneKopieVers = state._internalCopyAt
      && !(state._appBlurAt && state._appBlurAt > state._internalCopyAt);
    if ((((internalClips && internalClips.length > 0) || state.clipboardAnnotation)) && interneKopieVers) {
      e.preventDefault();
      if (!getActiveDocument()?.pdfDoc) return;
      if (isPdfAReadOnly()) return;
      if (internalClips && internalClips.length > 1) pasteAnnotations();
      else pasteAnnotation();
      return;
    }
    // Don't preventDefault — let native paste event fire so handlePaste can
    // read clipboardData.items (required on Linux/WebKitGTK where the async
    // Clipboard API is unavailable).
    //
    // Fallback: in some Tauri webview contexts the native 'paste' event does
    // not fire when no editable element has focus (canvas focused, or no focus
    // at all). Schedule a deferred check — if the native handler did not run,
    // try the async Clipboard API for image data, then fall back to the
    // internal annotation clipboard.
    const beforeMark = state._lastNativePasteAt || 0;
    setTimeout(async () => {
      const afterMark = state._lastNativePasteAt || 0;
      if (afterMark > beforeMark) return; // native paste already handled
      if (!getActiveDocument()?.pdfDoc) return;
      if (isPdfAReadOnly()) return;
      // Try async Clipboard API for image data
      let handledImage = false;
      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read();
          for (const it of items) {
            const imgType = it.types.find(t => t.startsWith('image/'));
            if (imgType) {
              const blob = await it.getType(imgType);
              const { pasteImageFromBlob } = await import('../annotations/clipboard.js');
              await pasteImageFromBlob(blob);
              handledImage = true;
              break;
            }
          }
        }
      } catch (_) { /* permission denied or no focus — fall through */ }
      if (handledImage) return;
      // No image — fall back to internal annotation clipboard
      const { pasteAnnotation, pasteAnnotations } = await import('../annotations/clipboard.js');
      const clips = state.clipboardAnnotations;
      if (clips && clips.length > 1) pasteAnnotations();
      else if ((clips && clips.length === 1) || state.clipboardAnnotation) pasteAnnotation();
    }, 50);
  } else if (ctrl && e.key === ',') {
    if (!aan(e, 'app.preferences', 'Ctrl+,')) return;
    e.preventDefault();
    showPreferencesDialog();
  } else if (ctrl && !shift && shortcutKey === 'd') {
    if (!aan(e, 'file.properties', 'Ctrl+D')) return;
    e.preventDefault();
    showDocPropertiesDialog();
  } else if (ctrl && shortcutKey === 'l') {
    if (!aan(e, 'view.fullscreen', 'Ctrl+L')) return;
    e.preventDefault();
    toggleFullscreen();
  }

  // ── ESC — prioriteitsladder (GitHub #273) ────────────────────────────────
  // 1. Open dialoog/overlay/editor → die context handelt Escape zelf af
  //    (Dialog.jsx, app-menu, crop-overlay, Edit-Type, CompareView). Geen
  //    tool-wissel, geen selectie-reset.
  // 2. Actieve tekening/bewerking → afronden zoals de rechtermuisklik dat
  //    doet (tool.onEscape → zelfde afrondroutines), daarna selectietool.
  // 3. Teken-tool actief zonder actieve tekening → selectietool.
  // 4. Selectietool actief → selectie legen (bestaand gedrag).
  else if (e.key === 'Escape' && heeftGekozenAfbeelding()) {
    // Afbeelding bewerken: Escape wist eerst de gekozen afbeelding.
    wisAfbeeldingSelectie();
    return;
  }
  else if (e.key === 'Escape') {
    // Trede 1: modale dialogen (vanilla overlays + Solid dialogStore), de
    // Edit-Type-editor en de crop-modus handelen Escape volledig zelf af.
    if (isModalOpen()
        || (typeof getDialogs === 'function' && (getDialogs() || []).length > 0)
        || state.imageCropMode
        || document.querySelector('.ste-overlay')) {
      return;
    }
    e.preventDefault();
    // End an in-progress text edit (commit the typed text) and return to the
    // select tool — Esc as an alternative to right-click / clicking away.
    if (state.isEditingText) {
      import('./text-editing.js').then(m => { m.finishTextEditing(); setTool('select'); });
      return;
    }
    // Cancel an in-progress grip-stretch / resize: restore the original
    // annotation snapshot and exit resize mode without recording undo.
    if (state.isResizing && state.originalAnnotation) {
      stopGripLengteInvoer();
      const _doc = getActiveDocument();
      const _sel = _doc ? _doc.selectedAnnotations : [];
      const ann = _sel.length === 1 ? _sel[0] : null;
      if (ann) {
        // Restore annotation to its pre-stretch state
        Object.assign(ann, state.originalAnnotation);
        // Object.assign wist geen velden: een draaipunt dat pas tijdens deze
        // sleep ontstond (#826), moet er ook weer af.
        if (!Object.prototype.hasOwnProperty.call(state.originalAnnotation, 'draaipunt')) delete ann.draaipunt;
      }
      // Meegeschoven stramienuiteinden gaan ook terug.
      herstelStramienMeeslepen();
      state.isResizing = false;
      state.isDragging = false;
      state.activeHandle = null;
      state.originalAnnotation = null;
      state.originalAnnotations = [];
      state._editContourBefore = null;
      state.lastSnapResult = null;
      state.dragCursor = null;
      redraw();
      return;
    }
    // Exit fullscreen first if active
    if (getFullscreenState()) {
      exitFullscreen();
      return;
    }
    // First check if find bar is open
    if (state.search.isOpen) {
      closeFindBar();
      return;
    }
    // Exit edit-contour mode if active
    if (state.editingContour) {
      state.editingContour = null;
      state._editArcMode = false;
      redraw();
      return;
    }
    // Systeem-sub-element (paneel/rand/rasterlijn) geselecteerd? Escape gaat
    // dan EERST één niveau terug: sub-element → component; de volgende
    // Escape wist zoals altijd de hele selectie.
    {
      const escSel = getActiveDocument()?.selectedAnnotations || [];
      const escAnn = escSel.length === 1 ? escSel[0] : null;
      if (escAnn && (escAnn.type === 'systeemraster' || gevelPreset(escAnn)) && escAnn.selectedSub) {
        escAnn.selectedSub = null;
        escAnn._hoverSub = null;
        showProperties(escAnn);
        redraw();
        return;
      }
    }
    // Trede 2: actieve tekening/bewerking van de huidige tool → afronden of
    // annuleren via de tool's onEscape-hook. Elke hook roept EXACT dezelfde
    // afrondroutine aan als de rechtermuisklik-tak van die tool (polyline/
    // spline/wolk/meting committen punten-tot-nu-toe; lijn/dimensie/hoek/
    // kalibratie/schaalgebied annuleren). Daarna valt de flow door naar de
    // selectietool-wissel onderaan. Plugin-polylijnen mappen op de native
    // polyline-tool, zelfde mapping als de dispatcher.
    let escTool = getTool(state.currentTool);
    if (!escTool && getAnnotationType(state.currentTool)?.drawMode === 'polyline') {
      escTool = getTool('polyline');
    }
    if (escTool && typeof escTool.onEscape === 'function') {
      const escCtx = _buildEscapeToolContext();
      if (escCtx) {
        try { escTool.onEscape(escCtx, e); }
        catch (err) { console.error('[keyboard] tool onEscape error', err); }
      }
    }
    // Vangnet voor tools zonder onEscape-hook: ruim bekende teken-state op
    // (zelfde opruiming als voorheen), maar val daarna door naar de
    // selectietool-wissel in plaats van hier te stoppen.
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      redraw();
    }
    if (state.measurePoints) {
      state.measurePoints = null;
      redraw();
    }
    // Always clear any lingering polar anchor on Escape
    import('./snap-engine.js').then(m => m.clearPolarAnchor && m.clearPolarAnchor()).catch(() => {});
    // ESC always jumps to the select tool, regardless of whether
    // annotations are selected. Selection is also cleared in the same
    // gesture (so a second ESC isn't needed). Ribbon tab stays put.
    if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      clearSelection();
      hideProperties();
      redraw();
    }
    setTool('select');
    // Arm the marquee so a drag immediately after Escape starts a
    // cross-selection (even when it begins on an element), mirroring the
    // Select ribbon button. Consumed on the next pointerdown in select-tool.
    state.armedMarquee = true;
  }

  // Gesplitste weergave (#858): Ctrl+\ verticaal, Ctrl+Shift+\ horizontaal;
  // de toets van de splitsing die er al staat heft hem op. Niet in een dialoog.
  else if (splitToetsOpdracht(e)) {
    const splitId = splitToetsOpdracht(e);
    if (!aan(e, splitId, splitId === 'view.splitHorizontal' ? 'Ctrl+Shift+\\' : 'Ctrl+\\')) return;
    if (splitToetsGeblokkeerd(e.target, { modaalOpen: modaalOpen() })) return;
    e.preventDefault();
    voerSplitOpdracht(splitId);
  }

  // Paginarotatie: Ctrl+Shift+Plus = rechtsom, Ctrl+Shift+Min = linksom.
  // Bewust e.code i.p.v. e.key: mét Shift levert de '='-toets een '+' en de
  // '-'-toets een '_', en die tekens verschillen per toetsenbordindeling —
  // de code van de fysieke toets niet. Staat vóór de zoom-sneltoetsen zodat
  // Ctrl+Shift nooit als Ctrl+zoom wordt gelezen.
  else if (ctrl && shift && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
    if (!aan(e, 'view.rotatePageRight', e.code === 'NumpadAdd' ? 'Ctrl+Shift+NumpadAdd' : 'Ctrl+Shift+=')) return;
    e.preventDefault();
    rotateCurrentPageBy(90);
  } else if (ctrl && shift && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
    if (!aan(e, 'view.rotatePageLeft', e.code === 'NumpadSubtract' ? 'Ctrl+Shift+NumpadSubtract' : 'Ctrl+Shift+-')) return;
    e.preventDefault();
    rotateCurrentPageBy(-90);
  }

  // View shortcuts
  else if (ctrl && e.key === '=') {
    if (!aan(e, 'view.zoomIn', 'Ctrl+=')) return;
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomIn());
  } else if (ctrl && e.key === '-') {
    if (!aan(e, 'view.zoomOut', 'Ctrl+-')) return;
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomOut());
  } else if (ctrl && e.key === '0') {
    if (!aan(e, 'view.actualSize', 'Ctrl+0')) return;
    e.preventDefault();
    actualSize();
  } else if (ctrl && e.key === '1') {
    if (!aan(e, 'view.fitWidth', 'Ctrl+1')) return;
    e.preventDefault();
    fitWidth();
  } else if (ctrl && e.key === '2') {
    if (!aan(e, 'view.fitPage', 'Ctrl+2')) return;
    e.preventDefault();
    fitPage();
  } else if (ctrl && e.key === '5') {
    if (!aan(e, 'view.thinLines', 'Ctrl+5')) return;
    e.preventDefault();
    import('../pdf/thin-lines.js').then(m => m.toggleThinLines());
  }

  // Tool shortcuts (only if PDF is loaded). Nooit met Ctrl: een Ctrl-letter
  // die hierboven niet is afgehandeld, wisselt geen gereedschap (#577).
  else if (!ctrl && getActiveDocument()?.pdfDoc) {
    const pdfaLocked = isPdfAReadOnly();
    if (e.key === 'v' || e.key === 'V') {
      if (!aan(e, 'tool.select', 'V')) return;
      e.preventDefault();
      setTool('select');
    } else if (e.key === 'h' || e.key === 'H') {
      if (!aan(e, 'tool.hand', 'H')) return;
      e.preventDefault();
      setTool('hand');
    } else if (!pdfaLocked && (e.key === '1')) {
      if (!aan(e, 'tool.highlight', '1')) return;
      e.preventDefault();
      setTool('highlight');
    } else if (!pdfaLocked && (e.key === '2')) {
      if (!aan(e, 'tool.draw', '2')) return;
      e.preventDefault();
      setTool('draw');
    } else if (!pdfaLocked && (e.key === '3')) {
      if (!aan(e, 'tool.line', '3')) return;
      e.preventDefault();
      setTool('line');
    } else if (!pdfaLocked && (e.key === '4')) {
      if (!aan(e, 'tool.box', '4')) return;
      e.preventDefault();
      setTool('box');
    } else if (!pdfaLocked && (e.key === '5')) {
      if (!aan(e, 'tool.circle', '5')) return;
      e.preventDefault();
      setTool('circle');
    } else if (!pdfaLocked && (e.key === 't' || e.key === 'T')) {
      if (!aan(e, 'tool.textbox', 'T')) return;
      e.preventDefault();
      setTool('textbox');
    } else if (!pdfaLocked && (e.key === 'n' || e.key === 'N')) {
      if (!aan(e, 'tool.comment', 'N')) return;
      e.preventDefault();
      setTool('comment');
    }
  }

  // Help / drafting shortcuts
  if (e.key === 'F1') {
    if (!aan(e, 'help.shortcuts', 'F1')) return;
    e.preventDefault();
    openDialog('shortcuts');
  } else if (e.key === 'F7') {
    if (!aan(e, 'drafting.grid', 'F7')) return;
    // F7 — toggle dot grid visibility (AutoCAD convention)
    e.preventDefault();
    state.preferences.showGrid = !state.preferences.showGrid;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F8') {
    if (!aan(e, 'panels.navigation', 'F8')) return;
    // F8 — toggle the document outline / left panel (was F9)
    e.preventDefault();
    toggleLeftPanel();
  } else if (e.key === 'F9') {
    if (!aan(e, 'drafting.gridSnap', 'F9')) return;
    // F9 — toggle snap-to-grid (AutoCAD convention)
    e.preventDefault();
    state.preferences.enableGridSnap = !state.preferences.enableGridSnap;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F10') {
    if (!aan(e, 'drafting.polarTracking', 'F10')) return;
    // F10 — toggle polar tracking (AutoCAD convention)
    e.preventDefault();
    state.preferences.polarTrackingEnabled = !state.preferences.polarTrackingEnabled;
    import('../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
    redraw();
  } else if (e.key === 'F12') {
    if (!aan(e, 'panels.properties', 'F12')) return;
    e.preventDefault();
    togglePropertiesPanel();
  } else if (e.key === 'F11') {
    if (!aan(e, 'panels.annotationsList', 'F11')) return;
    e.preventDefault();
    toggleAnnotationsListPanel();
  }
}

// Handle native paste event — works reliably on all platforms including Linux/WebKitGTK
function handlePaste(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isPdfAReadOnly()) return;
  const isInInput = isTextEntryTarget(e.target);
  if (isInInput) return;

  // Mark that the native paste fired so the Ctrl+V keydown fallback skips itself.
  state._lastNativePasteAt = Date.now();

  // Must preventDefault synchronously before any async work
  e.preventDefault();

  // Check for image data in the native clipboard event
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          import('../annotations/clipboard.js').then(({ pasteImageFromBlob }) => {
            pasteImageFromBlob(blob);
          });
        }
        return;
      }
    }
  }

  // No image found — paste from internal annotation clipboard
  import('../annotations/clipboard.js').then(({ pasteAnnotation, pasteAnnotations }) => {
    const clips = state.clipboardAnnotations;
    if (clips && clips.length > 1) {
      pasteAnnotations();
    } else if ((clips && clips.length === 1) || state.clipboardAnnotation) {
      pasteAnnotation();
    }
  });
}

// Initialize keyboard handlers
export function initKeyboardHandlers() {
  // Capture-fase op window: vóór alle keydown-luisteraars op document en
  // daaronder, ook de capture-luisteraars (#539).
  // Proofreading mode (#508): F2, and while it is on every key it uses,
  // before any other handler (also before the tab switch keys).
  installProofreadingKeys();
  window.addEventListener('keydown', handleTabSneltoets, true);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('paste', handlePaste);
  // Focusverlies bijhouden voor de plak-voorrangsregel (zie Ctrl+V hierboven).
  window.addEventListener('blur', () => { state._appBlurAt = Date.now(); });
  // G-move-mode requires knowing the current cursor position when G is pressed,
  // so install a passive tracker that updates state._lastMouseAppX/Y on every
  // mousemove. This is cheap (just two assignments + rect calc).
  import('./g-move-mode.js').then(m => m.installGMoveMouseTracker());
}
