import { Show } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { setTool } from '../../../tools/manager.js';
import { startRemoveImageTool } from '../../../tools/tools/remove-image-tool.js';
import { state, getActiveDocument, noPdf } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { clearSelection, selectAllOnPage } from '../../../core/stores/selection-helpers.js';
import { toggleFindBar } from '../../../search/find-bar.js';
import { contextualTabsVisible } from '../../stores/ribbonStore.js';
import { copyAnnotation, copyAnnotations, pasteAnnotation, pasteAnnotations, pasteAnnotationsInPlace, duplicateAnnotation } from '../../../annotations/clipboard.js';
import { flipHorizontal, flipVertical, rotateAnnotation } from '../../../annotations/z-order.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { recordBulkModify } from '../../../core/undo-manager.js';
import { alignLeft } from '../../../annotations/alignment.js';
import { explodeSelection, joinSelection, createCollection, explodeCollection } from '../../../annotations/segment-ops.js';
import {
  handIcon, selectCommentsIcon, findIcon,
  lineIcon, arrowIcon, drawIcon, rectIcon, polylineIcon, textboxIcon, noteIcon, ellipseIcon, circleIcon,
  calloutIcon, cloudIcon,
  measureDistanceIcon, measureAngleIcon, measurePerimeterIcon, measureAreaIcon,
  alignLeftIcon, alignTopIcon, alignBottomIcon,
  flipHIcon, flipVIcon, rotateCwIcon,
  clearAllIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { createFullPageScaleRegion, invalidateScaleRegionCache } from '../../../annotations/scale-region.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { openDialog } from '../../../bridge.js';

// Generic placeholder icons for buttons without a dedicated icon
const placeholderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="0" stroke-dasharray="3 2"/><path d="M9 9 L15 15 M15 9 L9 15" stroke-width="1"/></svg>`;
const arcIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20 Q 12 4 20 20"/></svg>`;
const splineIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17 C 7 2, 13 2, 12 12 S 17 22 21 7"/></svg>`;
const splineArrowIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19 C 8 9, 14 7, 19 9"/><path d="M14 6 L 20 9 L 16 13.5"/></svg>`;
const hatchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M3 9 L9 3 M3 15 L15 3 M3 21 L21 3 M9 21 L21 9 M15 21 L21 15" stroke-width="1"/></svg>`;
const imageIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>`;
const removeImageIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="13" height="13"/><circle cx="7" cy="7" r="1.3"/><path d="M3 12l3.5-3.5 3 3"/><path d="M14.5 14.5l6.5 6.5M21 14.5l-6.5 6.5"/></svg>`;
const moveIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>`;
const copyAnnIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="12" height="12"/><rect x="4" y="4" width="12" height="12"/></svg>`;
const arrayIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/></svg>`;
const trimIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 L20 4 M16 16 L4 4"/></svg>`;
const extendIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12h14M14 8l4 4-4 4M19 4v16" stroke-linecap="round"/></svg>`;
const pasteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="4" width="12" height="16"/><rect x="9" y="2" width="6" height="3"/></svg>`;
// Plakken op plaats: klembord-icoon met richtkruis (exacte positie).
const pasteInPlaceIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="4" width="12" height="16"/><rect x="9" y="2" width="6" height="3"/><circle cx="12" cy="13" r="2.5"/><path d="M12 8.5v2M12 15.5v2M7.5 13h2M14.5 13h2"/></svg>`;
const cutIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 L20 4 M16 16 L4 4"/></svg>`;
const deleteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>`;
const tableIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/></svg>`;
const scaleRegionIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" stroke-dasharray="3 2"/><text x="12" y="16" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`;
const labelIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12l5-5h13v10H7z"/><circle cx="11" cy="12" r="1.5"/></svg>`;
// L-shape outline tool
const lShapeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3v12h12v6H6 4V3z" stroke-linejoin="round"/></svg>`;
// Radius dimension: circle with a centre-to-rim line and 'R'
const radiusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="13" r="8"/><path d="M11 13 L19 8"/><text x="4" y="8" font-size="8" font-weight="bold" fill="currentColor" stroke="none">R</text></svg>`;
// Diameter dimension: circle with a through line and diameter glyph
const diameterIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><path d="M4 12 H20"/><path d="M8 5 L16 19" stroke-width="1"/></svg>`;
// Explode: a shape bursting into separate segments
const explodeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4 L9 9 M20 4 L15 9 M4 20 L9 15 M20 20 L15 15"/><rect x="10" y="10" width="4" height="4"/></svg>`;
// Join: two segments merging into one at a node
const joinIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7 L12 12 L21 7"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>`;
// Split: a line divided at a mid node
const splitIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16 L11 16 M13 16 L21 16"/><path d="M12 10 L12 22" stroke-width="1"/><circle cx="12" cy="16" r="1.6" fill="currentColor"/></svg>`;
// Break: a line with a removed middle span (gap)
const breakIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12 L9 12 M15 12 L21 12"/><path d="M9 8 L9 16 M15 8 L15 16" stroke-width="1"/></svg>`;
// Lengthen: a line with a double arrow along its axis
const lengthenIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 H21"/><path d="M6 9 L3 12 L6 15"/><path d="M18 9 L21 12 L18 15"/></svg>`;
// Collection create: group objects into a bracketed set
const collectionCreateIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/><path d="M11 7 H16 V13" stroke-width="1" stroke-dasharray="2 2"/></svg>`;
// Collection explode: dissolve a group back into loose objects
const collectionExplodeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="9" y="15" width="6" height="6"/></svg>`;

function copySelected() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length === 0) return;
  if (sel.length > 1) copyAnnotations(sel);
  else copyAnnotation(sel[0]);
}

function pasteFromClipboard() {
  const ck = navigator.clipboard;
  // Use the same logic as the keyboard handler
  pasteAnnotations();
  pasteAnnotation();
}

function cutSelected() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length === 0) return;
  if (sel.length > 1) copyAnnotations(sel);
  else copyAnnotation(sel[0]);
  // Then delete via synthetic Delete event
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
}

function deleteSelected() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
}

function flipSelectedH() {
  const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
  if (!anns.length) return;
  const originals = anns.map(a => cloneAnnotation(a));
  for (const ann of anns) flipHorizontal(ann);
  recordBulkModify(anns, originals);
}

function flipSelectedV() {
  const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
  if (!anns.length) return;
  const originals = anns.map(a => cloneAnnotation(a));
  for (const ann of anns) flipVertical(ann);
  recordBulkModify(anns, originals);
}

function rotateSelected() {
  // Rotate the current selection 90° clockwise — same operation the Arrange
  // (Schikken) tab exposes, wired here for the Modify group.
  const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
  if (!anns.length) return;
  const originals = anns.map(a => cloneAnnotation(a));
  for (const ann of anns) rotateAnnotation(ann, 90);
  recordBulkModify(anns, originals);
}

function moveSelected() {
  // Trigger G-key move (existing handler) on current selection
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
}

// The drawing groups are exported as a standalone fragment so the merged
// "Tekenen & annotatie" tab (AnnotateTab) can compose them alongside the
// comment groups inside a single AdaptiveGroups container.
export function DrawingGroups() {
  const { t } = useTranslation('ribbon');
  const ro = () => noPdf() || isPdfAReadOnly();
  const cs = t('common.comingSoon') || 'Coming soon';

  return (
    <>

        {/* SELECTION */}
        <RibbonGroup label={t('drawing.selection')}>
          <RibbonButton id="dr-select" title={t('home.select')} icon={selectCommentsIcon} label={t('home.select')}
            disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => setTool('select')} />
          <RibbonButton id="dr-pan" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => setTool('hand')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-select-all" title={t('drawing.selectAll')} icon={selectCommentsIcon} label={t('drawing.selectAll')}
              disabled={noPdf()} onClick={() => selectAllOnPage()} />
            <RibbonButton size="small" id="dr-deselect" title={t('drawing.deselect')} icon={selectCommentsIcon} label={t('drawing.deselect')}
              disabled={noPdf()} onClick={() => clearSelection()} />
            <RibbonButton size="small" id="dr-find" title={t('drawing.findReplace')} icon={findIcon} label={t('drawing.findReplace')}
              disabled={noPdf()} onClick={() => toggleFindBar()} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* DRAW — uniform grid of small icon-only buttons (CAD toolbar style).
            All buttons are 26×26 size=small; the compact group's flex-wrap CSS
            arranges them into 2 rows × 7 cols. */}
        <RibbonGroup label={t('drawing.draw')} compact>
          {/* Row 1 */}
          <RibbonButton size="small" id="dr-line" title={t('comment.line')} icon={lineIcon}
            disabled={ro()} active={state.currentTool === 'line'} onClick={() => setTool('line')} />
          <RibbonButton size="small" id="dr-arrow" title={t('comment.arrow')} icon={arrowIcon}
            disabled={ro()} active={state.currentTool === 'arrow'} onClick={() => setTool('arrow')} />
          <RibbonButton size="small" id="dr-spline-arrow" title={t('comment.splineArrowTitle')} icon={splineArrowIcon}
            disabled={ro()} active={state.currentTool === 'splineArrow'} onClick={() => setTool('splineArrow')} />
          <RibbonButton size="small" id="dr-draw" title={t('comment.freehand')} icon={drawIcon}
            disabled={ro()} active={state.currentTool === 'draw'} onClick={() => setTool('draw')} />
          <RibbonButton size="small" id="dr-rect" title={t('comment.rectangle')} icon={rectIcon}
            disabled={ro()} active={state.currentTool === 'box'} onClick={() => setTool('box')} />
          <RibbonButton size="small" id="dr-arc" title="Arc" icon={arcIcon}
            disabled={ro()} active={state.currentTool === 'arc'} onClick={() => setTool('arc')} />
          <RibbonButton size="small" id="dr-polyline" title={t('comment.polylineTitle')} icon={polylineIcon}
            disabled={ro()} active={state.currentTool === 'polyline'} onClick={() => setTool('polyline')} />
          <RibbonButton size="small" id="dr-hatch" title={t('comment.filledArea')} icon={hatchIcon}
            disabled={ro()} active={state.currentTool === 'filledArea'} onClick={() => setTool('filledArea')} />
          <RibbonButton size="small" id="dr-text" title={t('comment.textBox')} icon={textboxIcon}
            disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton size="small" id="dr-note" title={t('comment.note')} icon={noteIcon}
            disabled={ro()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
          {/* Row 2 */}
          <RibbonButton size="small" id="dr-spline" title={t('comment.splineTitle')} icon={splineIcon}
            disabled={ro()} active={state.currentTool === 'spline'} onClick={() => setTool('spline')} />
          <RibbonButton size="small" id="dr-circle" title={t('format.circle') || 'Cirkel'} icon={circleIcon}
            disabled={ro()} active={state.currentTool === 'circle'} onClick={() => setTool('circle')} />
          <RibbonButton size="small" id="dr-ellipse" title={t('comment.ellipse') || 'Ellips'} icon={ellipseIcon}
            disabled={ro()} active={state.currentTool === 'ellipse'} onClick={() => setTool('ellipse')} />
          <RibbonButton size="small" id="dr-count" title="Tellen" icon={circleIcon}
            disabled={ro()} active={state.currentTool === 'count'} onClick={() => setTool('count')} />
          <RibbonButton size="small" id="dr-l-shape" title={t('drawing.lShape')} icon={lShapeIcon}
            disabled={ro()} active={state.currentTool === 'lshape'} onClick={() => setTool('lshape')} />
          <RibbonButton size="small" id="dr-image" title={t('drawing.image')} icon={imageIcon}
            disabled={ro()} active={state.currentTool === 'image'} onClick={() => setTool('image')} />
          <RibbonButton size="small" id="dr-remove-image" title={t('drawing.removeImage')} icon={removeImageIcon}
            disabled={ro()} active={state.currentTool === 'removeImage'} onClick={() => startRemoveImageTool()} />
        </RibbonGroup>

        {/* LIJN-OPTIES — alleen zichtbaar bij het lijn-gereedschap. Bevat het
            'Doorlopend'-vinkje dat de doorlopende (keten) tekenmodus schakelt.
            Deelt exact dezelfde preference (state.preferences.lineContinue) als
            het vinkje in het eigenschappen-paneel — één bron van waarheid. */}
        <Show when={state.currentTool === 'line'}>
          <RibbonGroup label={t('comment.line') || 'Lijn'}>
            <label class="ribbon-checkbox-option" title={t('drawing.lineContinueTip') || 'Elke klik verbindt het volgende segment met het vorige'}>
              <input
                type="checkbox"
                checked={state.preferences.lineContinue === true}
                onChange={(e) => { state.preferences.lineContinue = e.currentTarget.checked; savePreferences(); }}
              />
              <span>{t('drawing.lineContinue') || 'Doorlopend'}</span>
            </label>
          </RibbonGroup>
        </Show>

        {/* SCHAAL — moved here from the Opmerkingen tab: full labelled buttons
            for Schaalgebied + Schaalgebied op pagina. */}
        <RibbonGroup label={t('measure.scaleGroup') || 'Schaal'}>
          <RibbonButton id="btn-create-scale-region"
            title={t('comment.scaleRegion') || 'Draw a scale region with its own calibration'}
            icon={scaleRegionIcon}
            label={t('comment.scaleRegion') || 'Schaalgebied'}
            disabled={ro()}
            active={state.currentTool === 'scaleRegion'}
            onClick={() => setTool('scaleRegion')} />
          <RibbonButton id="btn-create-scale-region-full-page"
            title={t('comment.scaleRegionFullPageTitle') || 'Place a scale region covering the whole page'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" stroke-dasharray="2 2"/><text x="12" y="15" font-size="7" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`}
            label={t('comment.scaleRegionFullPage') || 'Schaalgebied op pagina'}
            disabled={ro()}
            onClick={() => {
              const ann = createFullPageScaleRegion();
              if (!ann) return;
              invalidateScaleRegionCache();
              const doc = getActiveDocument();
              if (doc?.viewMode === 'continuous') redrawContinuous();
              else redrawAnnotations();
              openDialog('scale-region', { annotationId: ann.id, pageNum: ann.page, isNew: true });
            }} />
        </RibbonGroup>

        {/* ANNOTATE */}
        <RibbonGroup label={t('drawing.annotate')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('drawing.area') || 'Oppervlakte'}
              disabled={ro()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
            <RibbonButton size="small" id="dr-length" title={t('measure.measureDistance')} icon={measureDistanceIcon} label={t('drawing.length') || 'Lengte'}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            {/* "Uitgelijnd" + "Lineair" merged into a single Maatlijn button —
                both fired the same measureDistance tool anyway. */}
            <RibbonButton size="small" id="dr-dimension" title={t('measure.measureDistance')} icon={measureDistanceIcon} label={t('drawing.dimension') || 'Maatlijn'}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="dr-angular" title={t('measure.measureAngle')} icon={measureAngleIcon} label={t('drawing.angular')}
              disabled={ro()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            {/* Spot Coord — placeholder icon, deferred */}
            <RibbonButton size="small" id="dr-spot-coord" title={cs} icon={placeholderIcon} label={t('drawing.spotCoord')}
              disabled={true} />
            {/* Radius — 2-click radius dimension (centre → rim) */}
            <RibbonButton size="small" id="dr-radius" title={t('drawing.radius')} icon={radiusIcon} label={t('drawing.radius')}
              disabled={ro()} active={state.currentTool === 'radius'} onClick={() => setTool('radius')} />
            {/* Diameter — 2-click diameter dimension (side → side) */}
            <RibbonButton size="small" id="dr-diameter" title={t('drawing.diameter')} icon={diameterIcon} label={t('drawing.diameter')}
              disabled={ro()} active={state.currentTool === 'diameter'} onClick={() => setTool('diameter')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-leader" title={t('comment.callout')} icon={calloutIcon} label={t('drawing.leader')}
              disabled={ro()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
            <RibbonButton size="small" id="dr-label" title={t('drawing.label')} icon={labelIcon} label={t('drawing.label')}
              disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
            {/* Table — no scheduleTable tool registered; deferred */}
            <RibbonButton size="small" id="dr-table" title={cs} icon={tableIcon} label={t('drawing.table')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-cloud" title={t('comment.cloud')} icon={cloudIcon} label={t('comment.cloud')}
              disabled={ro()} active={state.currentTool === 'cloud'} onClick={() => setTool('cloud')} />
            <RibbonButton size="small" id="dr-measure" title={t('measure.measurePerimeter')} icon={measurePerimeterIcon} label={t('drawing.measure')}
              disabled={ro()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* MODIFY — icon-only buttons (issue #278: "Wijzigen" toont alleen
            iconen; volledige naam blijft als tooltip beschikbaar). */}
        <RibbonGroup label={t('drawing.modify')} iconOnly>
          {/* Bloksgewijs: 3 kolommen × 2 kleine iconen zodat de groep een
              net, gelijkmatig blok vormt i.p.v. een mix van grote losse
              knoppen en een kleine stapel. */}
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-move" title={t('drawing.move')} icon={moveIcon} label={t('drawing.move')}
              disabled={ro()} onClick={moveSelected} />
            <RibbonButton size="small" id="dr-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
              disabled={ro()} onClick={() => duplicateAnnotation()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-mirror-h" title={t('arrange.flipHorizontally')} icon={flipHIcon} label={t('drawing.mirrorH')}
              disabled={ro()} onClick={flipSelectedH} />
            <RibbonButton size="small" id="dr-mirror-v" title={t('arrange.flipVertically')} icon={flipVIcon} label={t('drawing.mirrorV')}
              disabled={ro()} onClick={flipSelectedV} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-array" title={t('drawing.array')} icon={arrayIcon} label={t('drawing.array')}
              disabled={ro()} active={state.currentTool === 'array'} onClick={() => setTool('array')} />
            {/* Rotate — roteer de selectie 90° CW (zelfde operatie als de Schikken-tab) */}
            <RibbonButton size="small" id="dr-rotate" title={t('drawing.rotate')} icon={rotateCwIcon} label={t('drawing.rotate')}
              disabled={ro()} onClick={rotateSelected} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* EDIT — modify-gereedschappen (Inkorten, Verlengen, Uitlijnen, …).
            Deze werken uitsluitend op bestaande geometrie / een geselecteerd
            object, dus de hele groep is alleen zichtbaar zodra er een selectie
            actief is. Hergebruikt hetzelfde reactieve signaal dat de
            contextuele tabs (Opmaak/Schikken) toont: contextualTabsVisible()
            == selectedAnnotations.length > 0. Bij deselectie verdwijnt de
            volledige RibbonGroup (geen lege groep-kop). (issue #280) */}
        <Show when={contextualTabsVisible()}>
        <RibbonGroup label={t('drawing.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-trim" title={t('drawing.trim')} icon={trimIcon} label={t('drawing.trim')}
              disabled={ro()} active={state.currentTool === 'trim'} onClick={() => setTool('trim')} />
            <RibbonButton size="small" id="dr-extend" title={t('drawing.extend')} icon={extendIcon} label={t('drawing.extend')}
              disabled={ro()} active={state.currentTool === 'extend'} onClick={() => setTool('extend')} />
            <RibbonButton size="small" id="dr-offset" title={cs} icon={placeholderIcon} label={t('drawing.offset')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-fillet" title={cs} icon={placeholderIcon} label={t('drawing.fillet')}
              disabled={true} />
            <RibbonButton size="small" id="dr-chamfer" title={cs} icon={placeholderIcon} label={t('drawing.chamfer')}
              disabled={true} />
            <RibbonButton size="small" id="dr-stretch" title={cs} icon={placeholderIcon} label={t('drawing.stretch')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-split" title={t('drawing.split')} icon={splitIcon} label={t('drawing.split')}
              disabled={ro()} active={state.currentTool === 'split'} onClick={() => setTool('split')} />
            <RibbonButton size="small" id="dr-align" title={t('arrange.alignLeft')} icon={alignLeftIcon} label={t('drawing.align')}
              disabled={ro()} onClick={() => alignLeft()} />
            <RibbonButton size="small" id="dr-explode" title={t('drawing.explode')} icon={explodeIcon} label={t('drawing.explode')}
              disabled={ro()} onClick={() => explodeSelection()} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-break" title={t('drawing.break')} icon={breakIcon} label={t('drawing.break')}
              disabled={ro()} active={state.currentTool === 'break'} onClick={() => setTool('break')} />
            <RibbonButton size="small" id="dr-join" title={t('drawing.join')} icon={joinIcon} label={t('drawing.join')}
              disabled={ro()} onClick={() => joinSelection()} />
            <RibbonButton size="small" id="dr-lengthen" title={t('drawing.lengthen')} icon={lengthenIcon} label={t('drawing.lengthen')}
              disabled={ro()} active={state.currentTool === 'lengthen'} onClick={() => setTool('lengthen')} />
          </RibbonButtonStack>
        </RibbonGroup>
        </Show>

        {/* CLIPBOARD */}
        <RibbonGroup label={t('drawing.clipboard')}>
          <RibbonButton id="dr-paste" title={t('drawing.paste')} icon={pasteIcon} label={t('drawing.paste')}
            disabled={ro()} onClick={pasteFromClipboard} />
          <RibbonButton id="dr-paste-in-place" title={`${t('drawing.pasteInPlace')} (Ctrl+Shift+V)`} icon={pasteInPlaceIcon} label={t('drawing.pasteInPlace')}
            disabled={ro()} onClick={() => pasteAnnotationsInPlace()} />
          {/* Knippen / Kopiëren / Verwijderen — icon-only (issue #278);
              de naam blijft als tooltip beschikbaar. */}
          <RibbonButtonStack>
            <RibbonButton size="small" iconOnly id="dr-cut" title={t('drawing.cut')} icon={cutIcon} label={t('drawing.cut')}
              disabled={ro()} onClick={cutSelected} />
            <RibbonButton size="small" iconOnly id="dr-clip-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
              disabled={ro()} onClick={copySelected} />
            <RibbonButton size="small" iconOnly id="dr-delete" title={t('drawing.delete')} icon={deleteIcon} label={t('drawing.delete')}
              disabled={ro()} onClick={deleteSelected} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* COLLECTION */}
        <RibbonGroup label={t('drawing.collection')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-coll-create" title={t('drawing.collectionCreate')} icon={collectionCreateIcon} label={t('drawing.collectionCreate')}
              disabled={ro()} onClick={() => createCollection()} />
            <RibbonButton size="small" id="dr-coll-explode" title={t('drawing.collectionExplode')} icon={collectionExplodeIcon} label={t('drawing.collectionExplode')}
              disabled={ro()} onClick={() => explodeCollection()} />
          </RibbonButtonStack>
        </RibbonGroup>

    </>
  );
}

export default function DrawingTab() {
  return (
    <div class="ribbon-content active" id="tab-drawing">
      <AdaptiveGroups>
        <DrawingGroups />
      </AdaptiveGroups>
    </div>
  );
}
