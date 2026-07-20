import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { state, getActiveDocument } from '../../core/state.js';
import {
  recordPropertyChange,
  recordModify,
  recordBulkModify,
  recordMeasureScale,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { computeTextboxContentHeight } from '../../annotations/rendering/shapes.js';
import { formatDate, getTypeDisplayName } from '../../utils/helpers.js';
import { getAnnotationType } from '../../plugins/annotation-type-registry.js';
import { getPropertyPanel } from '../../plugins/property-panel-registry.js';
import { fireSelectionChange } from '../../plugins/selection-listener-registry.js';
import i18next from '../../i18n/config.js';
import { syncDocScale } from '../../annotations/scale-bar.js';
import { recalculateAllMeasurements, calculateArea, calculatePerimeter, calculateDistance, formatMeasurement, formatDimensionText, getMeasureScale } from '../../annotations/measurement.js';

// Types whose single 'color' control IS their stroke colour and which render
// via `strokeColor || color`. For these, the 'color' control must mirror onto
// strokeColor or a stale strokeColor would override the change (the reported
// "polyline colour change does nothing" bug).
const _STROKE_COLOR_DRIVEN = new Set([
  'parametricSymbol', 'polyline', 'cloudPolyline', 'spline', 'splineArrow', 'draw',
]);

// Panel visibility and collapsed state
const [panelVisible, setPanelVisible] = createSignal(true);
const [panelCollapsed, setPanelCollapsed] = createSignal(false);

// Panel mode: 'none' | 'annotation' | 'multi' | 'textEdit'
const [panelMode, setPanelMode] = createSignal('none');

// Collapsed sections tracking. Persisted in preferences so that once the user
// collapses a section it STAYS collapsed (default-off) across selections and
// app restarts, until they expand it again. The signal drives reactive UI;
// preferences is the durable store. Seeded lazily via hydrateCollapsedSections()
// on panel mount (preferences load after this module evaluates).
const [collapsedSections, setCollapsedSections] = createSignal({});

// Re-seed the collapsed-section state from saved preferences. Called when the
// properties panel mounts, by which point preferences have been loaded.
export function hydrateCollapsedSections() {
  const saved = state.preferences && state.preferences.collapsedPropSections;
  if (saved && typeof saved === 'object') setCollapsedSections({ ...saved });
}

// Annotation properties store
const [annotProps, setAnnotProps] = createStore({
  id: '',
  type: '',
  typeDisplay: '',
  subject: '',
  ifcCategory: '',
  author: '',
  created: '',
  modified: '',
  locked: false,
  printable: true,
  readOnly: false,
  marked: false,
  altText: '',
  status: 'none',
  color: '#000000',
  fillColor: null,
  strokeColor: '#000000',
  textColor: '#000000',
  lineWidth: 3,
  opacity: 100,
  icon: 'comment',
  borderStyle: 'solid',
  text: '',
  fontSize: 16,
  fontFamily: 'Arial',
  textFontSize: 14,
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
  fontStrikethrough: false,
  textAlign: 'left',
  lineSpacing: '1.5',
  rotation: 0,
  imageWidth: 0,
  imageHeight: 0,
  imageRotation: 0,
  lockAspectRatio: false,
  linkedPath: '',
  tintColor: '',
  cropLeft: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  startHead: 'none',
  endHead: 'open',
  headSize: 12,
  arrowLength: '',
  measureScale: 0,
  measureUnit: '',
  measurePrecision: 2,
  measureName: '',
  dimType: '',
  styleType: '',
  dimExtension: true,
  scaleBarUnit: 'mm',
  scaleBarTotalUnits: 5000,
  scaleBarDivisions: 5,
  scaleBarHeight: 14,
  symbolId: '',
  params: {},
  replies: [],
  multiCount: 0,
});

// Section visibility store
const [sectionVis, setSectionVis] = createStore({
  general: false,
  replies: false,
  appearance: false,
  lineEndings: false,
  dimensions: false,
  textFormat: false,
  paragraph: false,
  content: false,
  measurement: false,
  scaleBar: false,
  image: false,
  actions: false,
  customFields: false,
  // Sub-group visibility
  iconGroup: false,
  fillColorGroup: false,
  strokeColorGroup: false,
  colorGroup: false,
  lineWidthGroup: false,
  borderStyleGroup: false,
  textGroup: false,
  fontSizeGroup: false,
  opacityGroup: true,
  rotationGroup: false,
});

// Document info store
const [docInfo, setDocInfo] = createStore({
  filename: '-',
  filepath: '-',
  pages: '-',
  pageSize: '-',
  title: '-',
  author: '-',
  subject: '-',
  creator: '-',
  producer: '-',
  version: '-',
  annotCount: '0',
  annotPage: '0',
});

// Custom fields from plugin annotation types
const [customFieldsDef, setCustomFieldsDef] = createSignal([]);

// Custom plugin property-panel renderer (full DOM-based, ipv text-only fields).
// When non-null, plugin renders the entire panel-body for its annotation type.
const [customPanelRender, setCustomPanelRender] = createSignal(null);

// Plugin-driven hide of the native eigenschappen-paneel. When true, the host
// PropertiesPanel renders nothing — plugin owns all controls (e.g. inside
// its own tool-palette). Always restored to false on plugin-deactivate.
const [nativePanelHidden, setNativePanelHidden] = createSignal(false);
export { nativePanelHidden, setNativePanelHidden };

// Current annotation reference for write-back
let currentAnnotation = null;

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Compute section visibility based on annotation type
function computeSectionVisibility(type) {
  const isTextbox = ['textbox', 'callout'].includes(type);
  const isShape = ['line', 'arrow', 'box', 'circle', 'draw', 'textbox', 'callout'].includes(type);
  const isTextContent = type === 'text' || type === 'comment';
  const isImage = type === 'image';
  const isArrow = type === 'arrow';
  const isLineOrArrow = type === 'arrow' || type === 'line';
  const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(type);
  const hideLineWidth = ['highlight', 'comment', 'image', 'textHighlight'].includes(type);
  const hasFillColor = ['highlight', 'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'arrow', 'line', 'measureArea', 'filledArea'].includes(type);
  const hideColor = ['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout', 'polygon', 'cloud', 'measureDistance', 'measureArea', 'measurePerimeter', 'filledArea'].includes(type);
  const hasBorderStyle = ['textbox', 'callout', 'arrow', 'line', 'box', 'circle', 'polygon', 'cloud', 'draw', 'polyline', 'splineArrow', 'measureDistance', 'measureArea', 'measurePerimeter', 'filledArea'].includes(type);
  const hasHatchPattern = ['box', 'circle', 'polygon', 'cloud', 'measureArea', 'filledArea'].includes(type);
  const hasRotation = ['box', 'circle', 'polygon', 'cloud', 'highlight', 'redaction', 'comment', 'stamp', 'signature'].includes(type);
  const isMeasurement = ['measureDistance', 'measureArea', 'measurePerimeter'].includes(type);
  const isScaleBar = type === 'scaleBar';
  const typeHandler = getAnnotationType(type);
  const hasCustomFields = !!(typeHandler && typeHandler.editableFields && typeHandler.editableFields.length > 0);
  if (hasCustomFields) {
    setCustomFieldsDef(typeHandler.editableFields);
  } else {
    setCustomFieldsDef([]);
  }

  setSectionVis({
    general: true,
    replies: !isScaleBar,
    appearance: !isScaleBar,
    lineEndings: isArrow || type === 'splineArrow' || type === 'measureDistance' || type === 'measurePerimeter',
    dimensions: isLineOrArrow,
    measurement: isMeasurement,
    scaleBar: isScaleBar,
    textFormat: isTextbox,
    paragraph: isTextbox,
    content: isTextContent,
    image: isImage,
    actions: true,
    customFields: hasCustomFields,
    iconGroup: type === 'comment',
    fillColorGroup: hasFillColor,
    strokeColorGroup: isShape || type === 'measureDistance' || type === 'measureArea' || type === 'measurePerimeter' || type === 'filledArea',
    colorGroup: !hideColor || isTextMarkup,
    lineWidthGroup: !hideLineWidth,
    borderStyleGroup: hasBorderStyle,
    hatchPatternGroup: hasHatchPattern,
    textGroup: isTextContent,
    fontSizeGroup: type === 'text',
    opacityGroup: !isScaleBar,
    rotationGroup: hasRotation,
  });
}

// Show properties for a single annotation
export function storeShowProperties(annotation) {
  currentAnnotation = annotation;
  // Fire plugin selection-listeners (separate from property-panel-registry):
  // gives plugins a direct channel to react to selection without scraping DOM.
  fireSelectionChange(annotation);
  const isLocked = annotation.locked || false;

  setAnnotProps({
    id: annotation.id || '',
    type: annotation.type,
    typeDisplay: getTypeDisplayName(annotation.type),
    subject: annotation.subject || '',
    author: annotation.author || state.defaultAuthor,
    created: formatDate(annotation.createdAt),
    modified: formatDate(annotation.modifiedAt),
    locked: isLocked,
    printable: annotation.printable !== false,
    readOnly: annotation.readOnly || false,
    marked: annotation.marked || false,
    altText: annotation.altText || '',
    status: annotation.status || 'none',
    ifcCategory: annotation.ifcCategory || '',
    color: annotation.color || '#000000',
    fillColor: annotation.fillColor || null,
    strokeColor: annotation.strokeColor || annotation.color || '#000000',
    textColor: annotation.textColor || annotation.color || '#000000',
    lineWidth: annotation.lineWidth !== undefined ? annotation.lineWidth : 3,
    opacity: annotation.opacity !== undefined ? Math.round(annotation.opacity * 100) : 100,
    icon: annotation.icon || 'comment',
    borderStyle: annotation.borderStyle || 'solid',
    hatchPattern: annotation.hatchPattern || (annotation.type === 'measureArea' ? 'diagonal-left' : 'none'),
    hatchColor: annotation.hatchColor || (annotation.type === 'measureArea' ? '#ff0000' : (annotation.strokeColor || annotation.color || '#000000')),
    hatchScale: annotation.hatchScale ?? 100,
    hatchAngle: annotation.hatchAngle ?? 45,
    text: annotation.text || '',
    fontSize: annotation.fontSize || 16,
    fontFamily: annotation.fontFamily || 'Arial',
    textFontSize: annotation.fontSize || 14,
    fontBold: annotation.fontBold || false,
    fontItalic: annotation.fontItalic || false,
    fontUnderline: annotation.fontUnderline || false,
    fontStrikethrough: annotation.fontStrikethrough || false,
    textAlign: annotation.textAlign || 'left',
    lineSpacing: annotation.lineSpacing || '1.5',
    rotation: annotation.rotation || 0,
    imageWidth: annotation.type === 'image' ? Math.round(annotation.width) : 0,
    imageHeight: annotation.type === 'image' ? Math.round(annotation.height) : 0,
    imageRotation: annotation.type === 'image' ? Math.round(annotation.rotation || 0) : 0,
    lockAspectRatio: annotation.type === 'image' ? (annotation.lockAspectRatio || false) : false,
    linkedPath: annotation.linkedPath || '',
    tintColor: annotation.tintColor || '',
    cropLeft: annotation.type === 'image' ? Math.round((annotation.cropLeft || 0) * 100) : 0,
    cropTop: annotation.type === 'image' ? Math.round((annotation.cropTop || 0) * 100) : 0,
    cropRight: annotation.type === 'image' ? Math.round((annotation.cropRight || 0) * 100) : 0,
    cropBottom: annotation.type === 'image' ? Math.round((annotation.cropBottom || 0) * 100) : 0,
    startHead: annotation.startHead || (annotation.type === 'measureDistance' ? 'openCircle' : 'none'),
    endHead: annotation.endHead || (annotation.type === 'measureDistance' ? 'openCircle' : 'open'),
    headSize: annotation.headSize || 12,
    arrowLength: (annotation.type === 'arrow' || annotation.type === 'line')
      ? (() => {
          // Show the length in measured units (mm etc.), resolved at the
          // line's midpoint so a line inside a scale region (schaalgebied)
          // reports in that region's scale — never raw pixels.
          const pxLen = Math.sqrt(
            Math.pow(annotation.endX - annotation.startX, 2)
            + Math.pow(annotation.endY - annotation.startY, 2)
          );
          const midX = (annotation.startX + annotation.endX) / 2;
          const midY = (annotation.startY + annotation.endY) / 2;
          const ms = getMeasureScale(annotation.page, midX, midY);
          return `${(pxLen / (ms.pixelsPerUnit || 1)).toFixed(2)} ${ms.unit || 'mm'}`;
        })()
      : '',
    measureScale: annotation.measureScale || 0,
    measureUnit: annotation.measureUnit || '',
    measurePrecision: annotation.measurePrecision !== undefined ? annotation.measurePrecision : 2,
    measureName: annotation.measureName || '',
    dimType: annotation.dimType || '',
    styleType: annotation.styleType || annotation.dimType || '',
    dimExtension: annotation.dimExtension !== false, // default ON

    scaleBarUnit: annotation.unit || 'mm',
    scaleBarTotalUnits: annotation.totalUnits || 5000,
    scaleBarDivisions: annotation.divisions || 5,
    scaleBarHeight: annotation.height || 14,
    viewportName: annotation.name,
    viewportScaleRatio: annotation.scaleRatio || '',
    viewportUnit: annotation.unit || 'mm',
    scaleRegionScale: annotation.scaleString || '1:100',
    scaleRegionUnits: annotation.units || 'mm',
    scaleRegionLabel: annotation.label || '',
    scaleRegionWidth: annotation.type === 'scaleRegion'
      ? Math.round(((annotation.width || 0) / _scaleRegionPpu(annotation)) * 10) / 10 : 0,
    scaleRegionHeight: annotation.type === 'scaleRegion'
      ? Math.round(((annotation.height || 0) / _scaleRegionPpu(annotation)) * 10) / 10 : 0,
    annotationType: annotation.type,
    symbolId: annotation.symbolId || '',
    params: annotation.params ? { ...annotation.params } : {},
    dikteMm: annotation.dikteMm ?? 100,
    isolatieType: annotation.isolatieType || 'steenwol',
    replies: annotation.replies || [],
    multiCount: 0,
  });

  computeSectionVisibility(annotation.type);

  // Plugin custom panel: if a renderer is registered for this annotation type,
  // store it so PropertiesPanel.jsx can mount the plugin DOM.
  const customRenderer = getPropertyPanel(annotation.type);
  setCustomPanelRender(customRenderer ? () => customRenderer : null);

  setPanelMode('annotation');
  setPanelVisible(true);
}

// Hide properties (deselect annotation, show doc info)
export function storeHideProperties() {
  currentAnnotation = null;
  fireSelectionChange(null);
  setPanelMode('none');
  setCustomPanelRender(null);

  // Hide all annotation sections
  setSectionVis({
    general: false,
    replies: false,
    appearance: false,
    lineEndings: false,
    dimensions: false,
    measurement: false,
    scaleBar: false,
    textFormat: false,
    paragraph: false,
    content: false,
    image: false,
    actions: false,
    iconGroup: false,
    fillColorGroup: false,
    strokeColorGroup: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    rotationGroup: false,
  });

  populateDocInfo();
}

// Close the panel entirely
export function storeClosePanel() {
  currentAnnotation = null;
  fireSelectionChange(null);
  setPanelVisible(false);
}

// Helper: return the shared value if all items agree, otherwise fallback
function sharedValue(selected, getter, fallback) {
  const first = getter(selected[0]);
  for (let i = 1; i < selected.length; i++) {
    if (getter(selected[i]) !== first) return fallback;
  }
  return first;
}

// Show multi-selection properties
export function storeShowMultiSelection(selected) {
  if (!selected || selected.length < 2) return;
  currentAnnotation = null;
  // Multi-selection clears single-select listeners (plugins react to single).
  fireSelectionChange(null);

  const sharedType = sharedValue(selected, a => a.type, '');
  const sharedAuthor = sharedValue(selected, a => a.author || state.defaultAuthor, '');
  const sharedSubject = sharedValue(selected, a => a.subject || '', '');
  const sharedStatus = sharedValue(selected, a => a.status || 'none', 'mixed');
  const sharedIfc = sharedValue(selected, a => a.ifcCategory || '', 'mixed');
  const sharedAltText = sharedValue(selected, a => a.altText || '', '');
  const sharedMarked = (() => {
    const allMarked = selected.every(a => a.marked);
    const noneMarked = selected.every(a => !a.marked);
    return allMarked ? true : noneMarked ? false : 'mixed';
  })();
  const sharedColor = sharedValue(selected, a => a.color || '#000000', 'mixed');
  const sharedFillColor = sharedValue(selected, a => a.fillColor || null, 'mixed');
  const sharedStrokeColor = sharedValue(selected, a => a.strokeColor || a.color || '#000000', 'mixed');
  const sharedTextColor = sharedValue(selected, a => a.textColor || a.color || '#000000', 'mixed');
  const sharedLineWidth = sharedValue(selected, a => a.lineWidth !== undefined ? a.lineWidth : 3, 'mixed');
  const sharedOpacity = sharedValue(selected, a => a.opacity !== undefined ? Math.round(a.opacity * 100) : 100, 'mixed');
  const sharedBorderStyle = sharedValue(selected, a => a.borderStyle || 'solid', 'mixed');
  const sharedHatchPattern = sharedValue(selected, a => a.hatchPattern || (a.type === 'measureArea' ? 'diagonal-left' : 'none'), 'mixed');
  const sharedHatchColor = sharedValue(selected, a => a.hatchColor || (a.type === 'measureArea' ? '#ff0000' : (a.strokeColor || a.color || '#000000')), 'mixed');
  const sharedHatchScale = sharedValue(selected, a => a.hatchScale ?? 100, 'mixed');
  const sharedHatchAngle = sharedValue(selected, a => a.hatchAngle ?? 45, 'mixed');
  const sharedFontSize = sharedValue(selected, a => a.fontSize || 16, 'mixed');
  const sharedFontFamily = sharedValue(selected, a => a.fontFamily || 'Arial', 'mixed');
  const allLocked = selected.every(a => a.locked);
  const noneLocked = selected.every(a => !a.locked);
  const sharedLocked = allLocked ? true : noneLocked ? false : 'mixed';
  const allPrintable = selected.every(a => a.printable !== false);
  const nonePrintable = selected.every(a => a.printable === false);
  const sharedPrintable = allPrintable ? true : nonePrintable ? false : 'mixed';
  const allReadOnly = selected.every(a => a.readOnly);
  const noneReadOnly = selected.every(a => !a.readOnly);
  const sharedReadOnly = allReadOnly ? true : noneReadOnly ? false : 'mixed';

  setAnnotProps({
    type: sharedType,
    typeDisplay: sharedType
      ? `${getTypeDisplayName(sharedType)} (${selected.length})`
      : i18next.t('multiSelect', { count: selected.length, ns: 'properties' }),
    subject: sharedSubject,
    author: sharedAuthor,
    ifcCategory: sharedIfc,
    created: '',
    modified: '',
    locked: sharedLocked,
    printable: sharedPrintable,
    readOnly: sharedReadOnly,
    marked: sharedMarked,
    altText: sharedAltText,
    status: sharedStatus,
    color: sharedColor,
    fillColor: sharedFillColor,
    strokeColor: sharedStrokeColor,
    textColor: sharedTextColor,
    lineWidth: sharedLineWidth,
    opacity: sharedOpacity,
    icon: sharedValue(selected, a => a.icon || 'comment', 'mixed'),
    borderStyle: sharedBorderStyle,
    hatchPattern: sharedHatchPattern,
    hatchColor: sharedHatchColor,
    hatchScale: sharedHatchScale,
    hatchAngle: sharedHatchAngle,
    text: '',
    fontSize: sharedFontSize,
    fontFamily: sharedFontFamily,
    textFontSize: sharedFontSize,
    fontBold: sharedValue(selected, a => a.fontBold || false, 'mixed'),
    fontItalic: sharedValue(selected, a => a.fontItalic || false, 'mixed'),
    fontUnderline: sharedValue(selected, a => a.fontUnderline || false, 'mixed'),
    fontStrikethrough: sharedValue(selected, a => a.fontStrikethrough || false, 'mixed'),
    textAlign: sharedValue(selected, a => a.textAlign || 'left', 'mixed'),
    lineSpacing: sharedValue(selected, a => a.lineSpacing || '1.5', 'mixed'),
    rotation: sharedValue(selected, a => a.rotation || 0, 'mixed'),
    imageWidth: 0,
    imageHeight: 0,
    imageRotation: 0,
    lockAspectRatio: false,
    linkedPath: '',
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    startHead: sharedValue(selected, a => a.startHead || 'none', 'mixed'),
    endHead: sharedValue(selected, a => a.endHead || 'open', 'mixed'),
    headSize: sharedValue(selected, a => a.headSize || 12, 'mixed'),
    arrowLength: '',
    replies: [],
    multiCount: selected.length,
  });

  // Helper: check if ALL selected annotations satisfy a predicate on their type
  const allMatch = (predicate) => selected.every(a => predicate(a.type));

  const fillColorTypes = new Set(['highlight', 'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'arrow', 'line']);
  const strokeColorTypes = new Set(['line', 'arrow', 'box', 'circle', 'draw', 'textbox', 'callout', 'polygon', 'cloud']);
  const hideColorTypes = new Set(['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout', 'polygon', 'cloud']);
  const hideLineWidthTypes = new Set(['highlight', 'comment', 'image', 'textHighlight']);
  const borderStyleTypes = new Set(['textbox', 'callout', 'arrow', 'line', 'box', 'circle', 'polygon', 'cloud', 'draw', 'polyline', 'splineArrow']);
  const hatchPatternTypes = new Set(['box', 'circle', 'polygon', 'cloud', 'measureArea', 'filledArea']);
  const rotationTypes = new Set(['box', 'circle', 'polygon', 'cloud', 'highlight', 'redaction', 'comment', 'stamp', 'signature']);
  const textboxTypes = new Set(['textbox', 'callout']);
  const textMarkupTypes = new Set(['textHighlight', 'textStrikethrough', 'textUnderline']);

  const allSameType = sharedType !== '';

  setSectionVis({
    general: true,
    replies: false,
    appearance: true,
    lineEndings: allSameType && (sharedType === 'arrow' || sharedType === 'splineArrow'),
    dimensions: false,
    measurement: false,
    textFormat: allMatch(t => textboxTypes.has(t)),
    paragraph: allMatch(t => textboxTypes.has(t)),
    content: false,
    image: false,
    actions: true,
    iconGroup: allSameType && sharedType === 'comment',
    fillColorGroup: allMatch(t => fillColorTypes.has(t)),
    strokeColorGroup: allMatch(t => strokeColorTypes.has(t)),
    colorGroup: allMatch(t => !hideColorTypes.has(t) || textMarkupTypes.has(t)),
    lineWidthGroup: allMatch(t => !hideLineWidthTypes.has(t)),
    borderStyleGroup: allMatch(t => borderStyleTypes.has(t)),
    hatchPatternGroup: allMatch(t => hatchPatternTypes.has(t)),
    textGroup: allSameType && (sharedType === 'text' || sharedType === 'comment'),
    fontSizeGroup: allSameType && sharedType === 'text',
    opacityGroup: true,
    rotationGroup: allMatch(t => rotationTypes.has(t)),
  });

  setPanelMode('multi');
  setPanelVisible(true);
}

// Show text edit properties (PDF text editing mode)
export function storeShowTextEditProperties(info) {
  const ff = (info.fontFamily || 'Helvetica').toLowerCase();
  let displayFontFamily;
  if (ff.includes('courier') || ff.includes('consolas') || ff.includes('mono')) {
    displayFontFamily = 'Courier New';
  } else if (ff.includes('times') || ff.includes('garamond') || ff.includes('georgia')
      || ff.includes('palatino') || ff.includes('cambria') || ff.includes('bookman')) {
    displayFontFamily = 'Times New Roman';
  } else if (ff.includes('calibri')) {
    displayFontFamily = 'Calibri';
  } else if (ff.includes('verdana')) {
    displayFontFamily = 'Verdana';
  } else if (ff.includes('tahoma')) {
    displayFontFamily = 'Tahoma';
  } else if (ff.includes('trebuchet')) {
    displayFontFamily = 'Trebuchet MS';
  } else if (ff.includes('segoe')) {
    displayFontFamily = 'Segoe UI';
  } else if (ff.includes('comic')) {
    displayFontFamily = 'Comic Sans MS';
  } else if (ff.includes('impact')) {
    displayFontFamily = 'Impact';
  } else if (ff.includes('arial') || ff.includes('helvetica')) {
    displayFontFamily = 'Arial';
  } else {
    let cleaned = info.fontFamily || 'Arial';
    cleaned = cleaned.replace(/[-,](Bold|Italic|Oblique|Regular|Medium|Light|Book|Roman|PSMT|MT|PS).*$/i, '');
    cleaned = cleaned.replace(/PSMT$|MT$/i, '');
    cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    displayFontFamily = cleaned || 'Arial';
  }

  const pseudoAnnotation = {
    type: 'textbox',
    id: '_pdfTextEdit',
    text: info.text || '',
    fontSize: info.fontSize || 12,
    fontFamily: displayFontFamily,
    textColor: info.color || '#000000',
    color: info.color || '#000000',
    fontBold: info.isBold || false,
    fontItalic: info.isItalic || false,
    fontUnderline: info.isUnderline || false,
    fontStrikethrough: info.isStrikethrough || false,
    textAlign: 'left',
    lineSpacing: '1.5',
    lineWidth: 0,
    opacity: 1,
    fillColor: null,
    strokeColor: null,
    locked: false,
    printable: true,
    page: info.page || 1,
    subject: i18next.t('pdfText', { ns: 'properties' }),
    author: '',
    createdAt: '',
    modifiedAt: ''
  };

  currentAnnotation = pseudoAnnotation;

  // First show as textbox to get text format section
  storeShowProperties(pseudoAnnotation);

  // Override type display and hide irrelevant sections
  setAnnotProps('typeDisplay', i18next.t('pdfText', { ns: 'properties' }));
  setAnnotProps('textFontSize', Math.round(info.fontSize || 12));

  setSectionVis({
    general: false,
    replies: false,
    appearance: false,
    lineEndings: false,
    dimensions: false,
    measurement: false,
    textFormat: true,
    paragraph: false,
    content: false,
    image: false,
    actions: false,
    iconGroup: false,
    fillColorGroup: false,
    strokeColorGroup: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    rotationGroup: false,
  });

  setPanelMode('textEdit');
}

// Populate document info
export async function populateDocInfo() {
  const doc = getActiveDocument();
  const filePath = doc?.filePath || '';
  if (filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    setDocInfo('filename', parts[parts.length - 1]);
    setDocInfo('filepath', filePath);
  } else {
    setDocInfo('filename', i18next.t('docInfo.noFileOpen', { ns: 'properties' }));
    setDocInfo('filepath', '-');
  }

  if (doc?.pdfDoc) {
    setDocInfo('pages', `${doc.currentPage} / ${doc.pdfDoc.numPages}`);
    try {
      const page = await doc.pdfDoc.getPage(doc.currentPage);
      const vp = page.getViewport({ scale: 1 });
      const wMm = (vp.width / 72 * 25.4).toFixed(1);
      const hMm = (vp.height / 72 * 25.4).toFixed(1);
      setDocInfo('pageSize', `${wMm} x ${hMm} mm`);
    } catch (e) {
      setDocInfo('pageSize', '-');
    }

    try {
      const metadata = await doc.pdfDoc.getMetadata();
      const info = metadata.info || {};
      setDocInfo('title', info.Title || '-');
      setDocInfo('author', info.Author || '-');
      setDocInfo('subject', info.Subject || '-');
      setDocInfo('creator', info.Creator || '-');
      setDocInfo('producer', info.Producer || '-');
      setDocInfo('version', info.PDFFormatVersion || '-');
    } catch (e) { /* ignore */ }
  } else {
    setDocInfo('pages', '-');
    setDocInfo('pageSize', '-');
  }

  const docAnnotations = doc?.annotations || [];
  const total = docAnnotations.length;
  const docPage = doc ? doc.currentPage : 1;
  const onPage = docAnnotations.filter(a => a.page === docPage).length;
  setDocInfo('annotCount', String(total));
  setDocInfo('annotPage', i18next.t('docInfo.onPageCount', { count: onPage, page: docPage, ns: 'properties' }));
}

// Apply a property change to a single annotation object
function applyPropToAnnotation(ann, key, value) {
  ann.modifiedAt = new Date().toISOString();
  switch (key) {
    case 'subject': ann.subject = value; break;
    case 'author': ann.author = value; break;
    case 'locked': ann.locked = value; break;
    case 'printable': ann.printable = value; break;
    case 'readOnly': ann.readOnly = value; break;
    case 'marked': ann.marked = value; break;
    case 'altText': ann.altText = value; break;
    case 'status': ann.status = value === 'none' ? undefined : value; break;
    case 'ifcCategory': ann.ifcCategory = value || undefined; break;
    case 'color': ann.color = value; break;
    case 'fillColor': ann.fillColor = value; break;
    case 'strokeColor': ann.strokeColor = value; break;
    case 'lineWidth': ann.lineWidth = parseFloat(value); break;
    case 'opacity': ann.opacity = parseInt(value) / 100; break;
    case 'icon': ann.icon = value; break;
    case 'borderStyle': ann.borderStyle = value; break;
    case 'hatchPattern': ann.hatchPattern = value; break;
    case 'hatchColor': ann.hatchColor = value; break;
    case 'hatchScale': ann.hatchScale = parseInt(value); break;
    case 'hatchAngle': ann.hatchAngle = parseInt(value); break;
    case 'text': ann.text = value; break;
    case 'fontSize': ann.fontSize = parseInt(value); break;
    case 'textColor':
      ann.textColor = value;
      ann.color = value;
      break;
    case 'fontFamily': ann.fontFamily = value; break;
    case 'textFontSize': ann.fontSize = parseInt(value); break;
    case 'fontBold': ann.fontBold = value; break;
    case 'fontItalic': ann.fontItalic = value; break;
    case 'fontUnderline': ann.fontUnderline = value; break;
    case 'fontStrikethrough': ann.fontStrikethrough = value; break;
    case 'textAlign': ann.textAlign = value; break;
    case 'lineSpacing': {
      ann.lineSpacing = parseFloat(value);
      if (['textbox', 'callout'].includes(ann.type) && ann.text) {
        ann.height = computeTextboxContentHeight(ann);
      }
      break;
    }
    case 'rotation': ann.rotation = Math.max(-360, Math.min(360, parseInt(value) || 0)); break;
    case 'measureScale': ann.measureScale = parseFloat(value) || 0; recomputeMeasureText(ann); break;
    case 'measureUnit': ann.measureUnit = value; recomputeMeasureText(ann); break;
    case 'measurePrecision': ann.measurePrecision = parseInt(value); recomputeMeasureText(ann); break;
    case 'measureName': ann.measureName = value; break;
    case 'scaleBarUnit': ann.unit = value; break;
    case 'scaleBarTotalUnits': ann.totalUnits = parseFloat(value) || 1; break;
    case 'scaleBarDivisions': ann.divisions = Math.max(1, Math.min(20, parseInt(value) || 5)); break;
    case 'scaleBarHeight': ann.height = Math.max(4, parseInt(value) || 14); break;
    case 'viewportName': ann.name = value; break;
    case 'viewportScaleRatio': {
      const ratio = parseInt(value);
      if (ratio > 0) {
        ann.scaleRatio = `1:${ratio}`;
        ann.pixelsPerUnit = 72 / (25.4 * ratio);
        ann.unit = 'mm';
      }
      break;
    }
    case 'viewportUnit': {
      const vuToMm = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
      const oldU = ann.unit || 'mm';
      const newU = value;
      if (oldU !== newU) {
        ann.pixelsPerUnit = ann.pixelsPerUnit * (vuToMm[newU] || 1) / (vuToMm[oldU] || 1);
      }
      ann.unit = newU;
      break;
    }
    case 'scaleRegionScale': ann.scaleString = String(value || '1:100'); break;
    case 'scaleRegionUnits': ann.units = String(value || 'mm'); break;
    case 'scaleRegionLabel': ann.label = String(value || ''); break;
    case 'tintColor': ann.tintColor = value || undefined; break;
    default: ann[key] = value; break;
  }
}

// Recompute measurement text for a measurement annotation
function recomputeMeasureText(ann) {
  if (!ann || !ann.type?.startsWith('measure')) return;
  if (ann.type === 'measureDistance' && ann.measureScale) {
    const prec = ann.measurePrecision !== undefined ? ann.measurePrecision : 2;
    const unit = ann.measureUnit || 'mm';
    const dx = ann.endX - ann.startX;
    const dy = ann.endY - ann.startY;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const scaledVal = pixelDist * ann.measureScale;
    ann.measurePixels = pixelDist;
    ann.measureValue = scaledVal;
    // mm is the implied drawing unit on dimensions — no suffix.
    ann.measureText = unit === 'mm' ? scaledVal.toFixed(prec) : `${scaledVal.toFixed(prec)} ${unit}`;
  } else if (ann.type === 'measureDistance') {
    // No per-annotation scale override (cleared or never set): fall back to
    // the document/region scale so clearing the override actually reverts
    // the shown value instead of leaving the old text.
    const dist = calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, ann.page);
    ann.measureText = formatDimensionText(dist);
    ann.measureValue = dist.value;
    ann.measureUnit = dist.unit;
    ann.measurePixels = dist.pixels;
  } else if (ann.type === 'measureArea' && ann.points && ann.points.length >= 3) {
    const area = calculateArea(ann.points, ann.holes, ann.page);
    ann.measureText = formatMeasurement(area);
    ann.measureValue = area.value;
    ann.measureUnit = area.unit;
  } else if (ann.type === 'measurePerimeter' && ann.points && ann.points.length >= 2) {
    const perim = calculatePerimeter(ann.points, ann.page);
    ann.measureText = formatMeasurement(perim);
    ann.measureValue = perim.value;
    ann.measureUnit = perim.unit;
  }
}

/**
 * Update a single annotation property (write to store + annotation + undo + redraw).
 *
 * Plugin dot-path support: keys containing `.` (e.g. `data.address.email`) walk
 * the annotation object, creating intermediate objects as needed. This means
 * plugin annotation-keys MUST NOT contain a literal `.` character — a key like
 * `version1.0` would be interpreted as `version1` -> `0`. Use snake_case or
 * camelCase for plugin field names. Dot-path writes do NOT mirror into the
 * flat Solid `annotProps` store — plugin panels are expected to read from
 * their own form-state, not from `annotProps`.
 *
 * @param {string} key   Property name. May be a dot-path for nested writes.
 * @param {*}      value New value.
 */
// Page-pixels per real-world unit for a scaleRegion's OWN scale + units
// (e.g. '1:50' + 'mm' → 72/25.4/50 pt per mm). Used to show/edit the
// region's physical width/height.
function _scaleRegionPpu(ann) {
  const m = String(ann?.scaleString || '1:100').match(/1\s*:\s*([\d.]+)/);
  const ratio = m ? parseFloat(m[1]) : 100;
  const unitToMm = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
  const mmPerUnit = unitToMm[ann?.units || 'mm'] || 1;
  return ((72 / 25.4) * mmPerUnit) / (ratio > 0 ? ratio : 100);
}

export function updateAnnotProp(key, value) {
  // Multi-selection mode: apply to all selected annotations
  if (annotProps.multiCount > 0) {
    const _doc = getActiveDocument();
    const selected = _doc ? _doc.selectedAnnotations : [];
    if (!selected || selected.length === 0) return;

    // Block all edits except lock toggle when any annotation is locked
    if (annotProps.locked !== false && key !== 'locked') return;

    const originals = selected.map(annotation => cloneAnnotation(annotation));
    for (const ann of selected) applyPropToAnnotation(ann, key, value);
    recordBulkModify(selected, originals);
    setAnnotProps(key, value);

    // After toggling lock, refresh the panel to update locked state
    if (key === 'locked') {
      storeShowMultiSelection(selected);
    }

    redraw();
    return;
  }

  if (!currentAnnotation) return;

  // Tool-defaults mode: user is editing the synthetic annotation that
  // showToolDefaults() created. Route writes to state.preferences via
  // setAsDefaultStyle so the NEXT annotation drawn picks up the changes,
  // AND mirror the value on the synthetic so the panel updates visually.
  if (currentAnnotation.id === '__tool-defaults__') {
    // Apply to synthetic for immediate panel feedback.
    applyPropToAnnotation(currentAnnotation, key, value);
    setAnnotProps(key, value);
    // Persist to state.preferences so annotation-creators picks it up.
    (async () => {
      try {
        const prefMod = await import('../../core/preferences.js');
        if (prefMod && typeof prefMod.setAsDefaultStyle === 'function') {
          prefMod.setAsDefaultStyle(currentAnnotation);
        }
      } catch (_) { /* preferences module not ready — synthetic still visually updated */ }
    })();
    return;
  }

  // PDF text-edit mode: the panel drives the text edit currently open in the
  // inline editor (a throwaway pseudo-annotation is shown for the controls).
  // Route formatting changes to the active edit instead of mutating the pseudo
  // (issue #264 — formatting changes previously did nothing).
  if (currentAnnotation.id === '_pdfTextEdit') {
    setAnnotProps(key, value); // panel feedback
    import('../../tools/text-edit-tool.js')
      .then(m => m.applyActiveTextEditStyle && m.applyActiveTextEditStyle(key, value))
      .catch(() => {});
    return;
  }

  // Special handling for locked toggle
  if (key === 'locked' && currentAnnotation.locked && value === false) {
    recordPropertyChange(currentAnnotation);
    currentAnnotation.locked = false;
    currentAnnotation.modifiedAt = new Date().toISOString();
    storeShowProperties(currentAnnotation);
    redraw();
    return;
  }

  if (currentAnnotation.locked) return;

  const scaleDependentKeys = new Set([
    'scaleBarUnit', 'scaleBarTotalUnits', 'scaleBarPixelsPerUnit',
    'viewportScaleRatio', 'viewportUnit',
    'scaleRegionScale', 'scaleRegionUnits', 'scaleRegionWidth', 'scaleRegionHeight',
  ]);
  let scaleUndo = null;
  if (scaleDependentKeys.has(key)) {
    const doc = getActiveDocument();
    const affected = [
      currentAnnotation,
      ...(doc?.annotations || []).filter(annotation =>
        annotation !== currentAnnotation &&
        ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
      ),
    ];
    scaleUndo = {
      affected,
      originals: affected.map(annotation => cloneAnnotation(annotation)),
      oldMeasureScale: doc?.measureScale == null
        ? doc?.measureScale
        : JSON.parse(JSON.stringify(doc.measureScale)),
      tracksDocumentScale: key.startsWith('scaleBar'),
    };
  } else {
    recordPropertyChange(currentAnnotation);
  }
  currentAnnotation.modifiedAt = new Date().toISOString();

  // Write to annotation object
  switch (key) {
    case 'subject': currentAnnotation.subject = value; break;
    case 'author': currentAnnotation.author = value; break;
    case 'locked': currentAnnotation.locked = value; break;
    case 'printable': currentAnnotation.printable = value; break;
    case 'readOnly': currentAnnotation.readOnly = value; break;
    case 'marked': currentAnnotation.marked = value; break;
    case 'altText': currentAnnotation.altText = value; break;
    case 'status': currentAnnotation.status = value === 'none' ? undefined : value; break;
    case 'ifcCategory': currentAnnotation.ifcCategory = value || undefined; break;
    case 'color':
      currentAnnotation.color = value;
      // Stroke-rendered types resolve their colour as `strokeColor || color`
      // (rendering.js). If such an annotation already carries a strokeColor
      // (set by its creator), changing only `color` has NO visible effect —
      // the stale strokeColor wins. So when the 'color' control IS the colour
      // for these types, mirror it onto strokeColor too.
      if (_STROKE_COLOR_DRIVEN.has(currentAnnotation.type)) currentAnnotation.strokeColor = value;
      break;
    case 'fillColor': currentAnnotation.fillColor = value; break;
    case 'strokeColor':
      currentAnnotation.strokeColor = value;
      if (currentAnnotation.type === 'parametricSymbol') currentAnnotation.color = value;
      break;
    case 'lineWidth': currentAnnotation.lineWidth = parseFloat(value); break;
    case 'opacity':
      currentAnnotation.opacity = parseInt(value) / 100;
      break;
    case 'icon': currentAnnotation.icon = value; break;
    case 'borderStyle': currentAnnotation.borderStyle = value; break;
    case 'hatchPattern': currentAnnotation.hatchPattern = value; break;
    case 'hatchColor': currentAnnotation.hatchColor = value; break;
    case 'hatchScale': currentAnnotation.hatchScale = parseInt(value); break;
    case 'hatchAngle': currentAnnotation.hatchAngle = parseInt(value); break;
    case 'text': currentAnnotation.text = value; break;
    case 'fontSize': currentAnnotation.fontSize = parseInt(value); break;
    case 'textColor':
      currentAnnotation.textColor = value;
      currentAnnotation.color = value;
      break;
    case 'fontFamily': currentAnnotation.fontFamily = value; break;
    case 'textFontSize': currentAnnotation.fontSize = parseInt(value); break;
    case 'fontBold': currentAnnotation.fontBold = value; break;
    case 'fontItalic': currentAnnotation.fontItalic = value; break;
    case 'fontUnderline': currentAnnotation.fontUnderline = value; break;
    case 'fontStrikethrough': currentAnnotation.fontStrikethrough = value; break;
    case 'textAlign': currentAnnotation.textAlign = value; break;
    case 'lineSpacing': {
      currentAnnotation.lineSpacing = parseFloat(value);
      // Resize textbox height to fit content with new line spacing
      if (['textbox', 'callout'].includes(currentAnnotation.type) && currentAnnotation.text) {
        currentAnnotation.height = computeTextboxContentHeight(currentAnnotation);
      }
      break;
    }
    case 'rotation': currentAnnotation.rotation = Math.max(-360, Math.min(360, parseInt(value) || 0)); break;
    case 'imageWidth': {
      const newW = parseInt(value) || 20;
      currentAnnotation.width = newW;
      if (currentAnnotation.lockAspectRatio && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newH = Math.round(newW / ratio);
        currentAnnotation.height = Math.max(20, newH);
        setAnnotProps('imageHeight', currentAnnotation.height);
      }
      break;
    }
    case 'imageHeight': {
      const newH = parseInt(value) || 20;
      currentAnnotation.height = newH;
      if (currentAnnotation.lockAspectRatio && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newW = Math.round(newH * ratio);
        currentAnnotation.width = Math.max(20, newW);
        setAnnotProps('imageWidth', currentAnnotation.width);
      }
      break;
    }
    case 'imageRotation': currentAnnotation.rotation = parseInt(value) || 0; break;
    case 'linkedPath': currentAnnotation.linkedPath = value || undefined; break;
    case 'tintColor': currentAnnotation.tintColor = value || undefined; break;
    case 'lockAspectRatio': {
      currentAnnotation.lockAspectRatio = value;
      if (value && currentAnnotation.type === 'image' && currentAnnotation.originalWidth && currentAnnotation.originalHeight) {
        const ratio = currentAnnotation.originalWidth / currentAnnotation.originalHeight;
        const newH = Math.round(currentAnnotation.width / ratio);
        currentAnnotation.height = Math.max(20, newH);
        setAnnotProps('imageHeight', currentAnnotation.height);
      }
      break;
    }
    case 'cropLeft':
    case 'cropTop':
    case 'cropRight':
    case 'cropBottom': {
      // Non-destructive crop (issue #212): store as fraction 0-1 per side.
      // Clamp so each side stays within 0-90% AND the pair (left+right /
      // top+bottom) leaves at least 10% of the source visible.
      const pct = Math.max(0, Math.min(90, parseFloat(value) || 0));
      const opposite = key === 'cropLeft' ? 'cropRight'
        : key === 'cropRight' ? 'cropLeft'
        : key === 'cropTop' ? 'cropBottom' : 'cropTop';
      const oppVal = currentAnnotation[opposite] || 0;
      currentAnnotation[key] = Math.max(0, Math.min(pct / 100, 0.9 - oppVal));
      setAnnotProps(key, Math.round(currentAnnotation[key] * 100));
      break;
    }
    case 'startHead': currentAnnotation.startHead = value; break;
    case 'endHead': currentAnnotation.endHead = value; break;
    case 'headSize': currentAnnotation.headSize = parseInt(value); break;
    case 'measureScale': currentAnnotation.measureScale = parseFloat(value) || 0; recomputeMeasureText(currentAnnotation); break;
    case 'measureUnit': currentAnnotation.measureUnit = value; recomputeMeasureText(currentAnnotation); break;
    case 'measurePrecision': currentAnnotation.measurePrecision = parseInt(value); recomputeMeasureText(currentAnnotation); break;
    case 'measureName': currentAnnotation.measureName = value; break;
    case 'scaleBarUnit': {
      // Unit conversion factors relative to mm
      const unitToMm = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
      const oldUnit = currentAnnotation.unit || 'mm';
      const newUnit = value;
      // Convert totalUnits to mm, then to new unit
      const totalMm = currentAnnotation.totalUnits * (unitToMm[oldUnit] || 1);
      const newTotal = totalMm / (unitToMm[newUnit] || 1);
      currentAnnotation.unit = newUnit;
      currentAnnotation.totalUnits = newTotal;
      // pixelsPerUnit needs recalc: width stays the same, pixelsPerUnit = width / totalUnits
      currentAnnotation.pixelsPerUnit = currentAnnotation.width / newTotal;
      setAnnotProps('scaleBarTotalUnits', newTotal);
      // Sync doc scale and recalculate all measurements
      syncDocScale(currentAnnotation);
      recalculateAllMeasurements();
      break;
    }
    case 'scaleBarTotalUnits': {
      const newTotal = parseFloat(value) || 1;
      currentAnnotation.totalUnits = newTotal;
      // pixelsPerUnit needs recalc: width stays the same, pixelsPerUnit = width / totalUnits
      currentAnnotation.pixelsPerUnit = currentAnnotation.width / newTotal;
      // Sync doc scale and recalculate all measurements
      syncDocScale(currentAnnotation);
      recalculateAllMeasurements();
      break;
    }
    case 'scaleBarDivisions': {
      currentAnnotation.divisions = Math.max(1, Math.min(20, parseInt(value) || 5));
      break;
    }
    case 'scaleBarHeight': {
      const newH = Math.max(4, parseInt(value) || 14);
      currentAnnotation.height = newH;
      break;
    }
    case 'scaleBarPixelsPerUnit': {
      const ppu = parseFloat(value);
      if (ppu > 0) {
        currentAnnotation.pixelsPerUnit = ppu;
        currentAnnotation.width = currentAnnotation.totalUnits * ppu;
        syncDocScale(currentAnnotation);
        recalculateAllMeasurements();
      }
      break;
    }
    case 'viewportName': currentAnnotation.name = value; break;
    case 'viewportScaleRatio': {
      const vpRatio = parseInt(value);
      if (vpRatio > 0) {
        currentAnnotation.scaleRatio = `1:${vpRatio}`;
        currentAnnotation.pixelsPerUnit = 72 / (25.4 * vpRatio);
        currentAnnotation.unit = 'mm';
        currentAnnotation.name = currentAnnotation.name || `1:${vpRatio}`;
        setAnnotProps('viewportScaleRatio', `1:${vpRatio}`);
        setAnnotProps('viewportUnit', 'mm');
        recalculateAllMeasurements();
      }
      break;
    }
    case 'viewportUnit': {
      const vpUnitToMm = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
      const vpOldUnit = currentAnnotation.unit || 'mm';
      const vpNewUnit = value;
      if (vpOldUnit !== vpNewUnit) {
        currentAnnotation.pixelsPerUnit = currentAnnotation.pixelsPerUnit * (vpUnitToMm[vpNewUnit] || 1) / (vpUnitToMm[vpOldUnit] || 1);
      }
      currentAnnotation.unit = vpNewUnit;
      currentAnnotation.scaleRatio = '';
      recalculateAllMeasurements();
      break;
    }
    case 'scaleRegionScale': {
      currentAnnotation.scaleString = String(value || '1:100');
      setAnnotProps('scaleRegionScale', currentAnnotation.scaleString);
      import('../../annotations/scale-region.js').then(m => m.invalidateScaleRegionCache());
      recalculateAllMeasurements();
      break;
    }
    case 'scaleRegionUnits': {
      currentAnnotation.units = String(value || 'mm');
      setAnnotProps('scaleRegionUnits', currentAnnotation.units);
      import('../../annotations/scale-region.js').then(m => m.invalidateScaleRegionCache());
      recalculateAllMeasurements();
      break;
    }
    case 'scaleRegionLabel': {
      currentAnnotation.label = String(value || '');
      setAnnotProps('scaleRegionLabel', currentAnnotation.label);
      break;
    }
    case 'scaleRegionWidth':
    case 'scaleRegionHeight': {
      // Real-world size of the region itself (in its own scale + units) →
      // page-pixel bbox, top-left anchored.
      const real = parseFloat(String(value).replace(',', '.'));
      if (!(real > 0)) break;
      const px = real * _scaleRegionPpu(currentAnnotation);
      if (key === 'scaleRegionWidth') currentAnnotation.width = px;
      else currentAnnotation.height = px;
      setAnnotProps(key, Math.round(real * 10) / 10);
      import('../../annotations/scale-region.js').then(m => m.invalidateScaleRegionCache());
      recalculateAllMeasurements();
      break;
    }
    case 'params': {
      // Parametric symbol params (from ParametricSymbolSection). Dynamic-block
      // behaviour: templates with a real-world size (steel profiles) resize
      // their bbox around the centre when a size-driving param changes.
      currentAnnotation.params = value;
      if (currentAnnotation.type === 'parametricSymbol') {
        const ann = currentAnnotation;
        import('../../symbols/real-size.js').then(m => {
          if (m.applyTemplateRealSize(ann, 'center')) redraw();
        }).catch(() => {});
      }
      break;
    }
    default: {
      // Dot-path support for plugin nested writes (e.g., 'data.address.email').
      // Walks the chain creating intermediate objects when missing.
      if (key.includes('.')) {
        const parts = key.split('.');
        let target = currentAnnotation;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          if (target[seg] == null || typeof target[seg] !== 'object') {
            target[seg] = {};
          }
          target = target[seg];
        }
        target[parts[parts.length - 1]] = value;
      } else {
        currentAnnotation[key] = value;
      }
      break;
    }
  }

  // Update store (skip custom fields — they read directly from annotation)
  // Skip dot-paths too: plugin-nested writes don't need to mirror into the
  // flat Solid store; plugin panels read from their own form-state.
  if (scaleUndo) {
    const doc = getActiveDocument();
    beginUndoTransaction();
    recordBulkModify(scaleUndo.affected, scaleUndo.originals);
    if (scaleUndo.tracksDocumentScale) {
      recordMeasureScale(scaleUndo.oldMeasureScale, doc?.measureScale);
    }
    endUndoTransaction();
  }

  if (!key.startsWith('tb') && !key.includes('.')) {
    setAnnotProps(key, value);
  }

  redraw();
}

// Apply a STYLE TYPE preset (generic concept — see annotations/style-types.js)
// to the current selection or the tool defaults. Works for every annotation
// kind with a preset list (maatlijnen, lijnen/pijlen, arceringen, …): one
// pick sets all the preset's props in a single action (one undo record per
// annotation) and persists them as the default for newly drawn ones.
export async function applyStyleType(typeId) {
  const annType = annotProps.type;
  const { styleTypeProps } = await import('../../annotations/style-types.js');
  const props = styleTypeProps(annType, typeId);
  if (!props) return;

  const applyAll = (ann) => {
    for (const [k, v] of Object.entries(props)) applyPropToAnnotation(ann, k, v);
  };
  const mirrorAll = () => {
    for (const [k, v] of Object.entries(props)) {
      setAnnotProps(k, k === 'opacity' ? Math.round(v * 100) : v);
    }
  };

  // Multi-selection: apply to every selected annotation of this kind.
  if (annotProps.multiCount > 0) {
    const _doc = getActiveDocument();
    const selected = (_doc ? _doc.selectedAnnotations : []).filter(a => a.type === annType && !a.locked);
    const originals = selected.map(annotation => cloneAnnotation(annotation));
    for (const ann of selected) {
      applyAll(ann);
      if (annType === 'measureDistance') recomputeMeasureText(ann); // unit may change with type
    }
    recordBulkModify(selected, originals);
    mirrorAll();
    redraw();
    return;
  }

  if (!currentAnnotation) return;

  // Tool-defaults synthetic: update panel + persist as the type's defaults.
  if (currentAnnotation.id === '__tool-defaults__') {
    applyAll(currentAnnotation);
    mirrorAll();
    try {
      const prefMod = await import('../../core/preferences.js');
      prefMod.setAsDefaultStyle?.(currentAnnotation);
    } catch (_) { /* panel still shows the change */ }
    return;
  }

  if (currentAnnotation.locked) return;
  recordPropertyChange(currentAnnotation);
  applyAll(currentAnnotation);
  if (annType === 'measureDistance') recomputeMeasureText(currentAnnotation);
  mirrorAll();

  // New annotations drawn after this pick should match too — persist default.
  try {
    const prefMod = await import('../../core/preferences.js');
    prefMod.setAsDefaultStyle?.(currentAnnotation);
  } catch (_) { /* non-fatal */ }

  redraw();
}

// Toggle section collapse. Persists the new state so the choice is remembered
// across selections and restarts (the section stays collapsed by default until
// the user expands it again).
export function toggleSection(name) {
  const next = { ...collapsedSections(), [name]: !collapsedSections()[name] };
  setCollapsedSections(next);
  if (state.preferences) state.preferences.collapsedPropSections = next;
  import('../../core/preferences.js').then(m => m.savePreferences && m.savePreferences()).catch(() => {});
}

// Add a reply to current annotation
export function addReply(text) {
  if (!currentAnnotation || !text.trim()) return;
  const before = cloneAnnotation(currentAnnotation);
  if (!currentAnnotation.replies) currentAnnotation.replies = [];
  currentAnnotation.replies.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    author: state.defaultAuthor || 'User',
    text: text.trim(),
    createdAt: new Date().toISOString()
  });
  currentAnnotation.modifiedAt = new Date().toISOString();
  recordModify(currentAnnotation.id, before, currentAnnotation);
  setAnnotProps('replies', [...currentAnnotation.replies]);
  setAnnotProps('modified', formatDate(currentAnnotation.modifiedAt));
}

// Delete a reply
export function deleteReply(index) {
  if (!currentAnnotation || !currentAnnotation.replies) return;
  const before = cloneAnnotation(currentAnnotation);
  currentAnnotation.replies.splice(index, 1);
  currentAnnotation.modifiedAt = new Date().toISOString();
  recordModify(currentAnnotation.id, before, currentAnnotation);
  setAnnotProps('replies', [...currentAnnotation.replies]);
  setAnnotProps('modified', formatDate(currentAnnotation.modifiedAt));
}

// Cycle a <select> to the next option on double-click
export function cycleSelectNext(e) {
  const sel = e.currentTarget;
  const nextIdx = (sel.selectedIndex + 1) % sel.options.length;
  sel.selectedIndex = nextIdx;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

// Reset image to original size
export function resetImageSize() {
  if (!currentAnnotation || currentAnnotation.type !== 'image') return;
  recordPropertyChange(currentAnnotation);
  currentAnnotation.width = currentAnnotation.originalWidth;
  currentAnnotation.height = currentAnnotation.originalHeight;
  currentAnnotation.rotation = 0;
  currentAnnotation.modifiedAt = new Date().toISOString();
  storeShowProperties(currentAnnotation);
  redraw();
}

// Update opacity with Ctrl-snap support
export function updateOpacity(value, ctrlKey) {
  let finalValue = parseInt(value);
  if (ctrlKey) {
    finalValue = Math.round(finalValue / 10) * 10;
  }
  updateAnnotProp('opacity', finalValue);
}

// Get line width label based on type
export function getLineWidthLabel() {
  const type = annotProps.type;
  return ['textbox', 'callout', 'box', 'circle', 'polygon', 'cloud'].includes(type)
    ? i18next.t('appearance.borderWidth', { ns: 'properties' })
    : i18next.t('appearance.lineWidth', { ns: 'properties' });
}

// Get the current annotation reference
export function getCurrentAnnotation() {
  return currentAnnotation;
}

// Show the properties panel populated with the current style defaults for
// the active drawing tool. Builds a SYNTHETIC annotation tagged with id
// '__tool-defaults__' so the rest of the panel pipeline treats it like a
// normal selection — but no real annotation is created or modified.
// Edits made by the user via panel inputs update the synthetic object for
// visual feedback; persistent default changes still flow through the
// Format ribbon's `setAsDefaultStyle` path.
export async function showToolDefaults(toolName) {
  if (!toolName) return;
  // Map tool name → annotation type. Most are 1:1; exceptions go here.
  const TOOL_TO_TYPE = {
    rectangle: 'box',
    rect: 'box',
  };
  const annType = TOOL_TO_TYPE[toolName] || toolName;

  // Reasonable default annotation shape — applyDefaultStyle() will overlay
  // any saved preferences on top of this.
  const synthetic = {
    id: '__tool-defaults__',
    type: annType,
    locked: false,
    printable: true,
    readOnly: false,
    marked: false,
    page: 1,
    x: 0, y: 0, width: 100, height: 50,
    color: '#000000',
    strokeColor: '#000000',
    fillColor: null,
    lineWidth: 1,
    opacity: 1.0,
    borderStyle: 'solid',
    fontSize: 14,
    fontFamily: 'Arial',
    textColor: '#000000',
    fontBold: false,
    fontItalic: false,
    fontUnderline: false,
    fontStrikethrough: false,
    textAlign: 'left',
    lineSpacing: 1.2,
    rotation: 0,
    author: '',
    subject: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    replies: [],
  };

  try {
    // Lazy-import to avoid load-order cycles (preferences ↔ propertiesStore).
    const prefMod = await import('../../core/preferences.js');
    if (prefMod && typeof prefMod.applyDefaultStyle === 'function') {
      prefMod.applyDefaultStyle(synthetic);
    }
  } catch (e) {
    // Non-fatal — synthetic will just show the bare defaults above.
  }

  storeShowProperties(synthetic);
}

export {
  panelVisible, setPanelVisible,
  panelCollapsed, setPanelCollapsed,
  panelMode, setPanelMode,
  collapsedSections,
  annotProps, setAnnotProps,
  sectionVis, setSectionVis,
  docInfo,
  customFieldsDef,
  customPanelRender,
};
