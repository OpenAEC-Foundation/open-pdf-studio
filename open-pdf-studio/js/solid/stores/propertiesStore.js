import { createSignal, batch } from 'solid-js';
import { DRAFTING_RULE_TYPES, effectiveDraftingLineWidth } from '../../annotations/drafting-rules.js';
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
import { lintZetLijnkoppen, koppenVan } from '../../pdf/lijnkoppen.js';
import { ondersteuntKruis, kruisZichtbaarVoorSelectie } from '../../annotations/kruis-geometrie.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { computeTextboxContentHeight } from '../../annotations/rendering/shapes.js';
import { formatDate, getTypeDisplayName, getAnnotationDisplayName } from '../../utils/helpers.js';
import { isTextAnchored, isFoldedChild } from '../../annotations/corrections/model.js';
import { getAnnotationType } from '../../plugins/annotation-type-registry.js';
import { getPropertyPanel } from '../../plugins/property-panel-registry.js';
import { fireSelectionChange } from '../../plugins/selection-listener-registry.js';
import i18next from '../../i18n/config.js';
import { DOC_INFO_EMPTY, formatDocPages, formatPageSizeMm, createLatestOnly } from './doc-info-format.js';
import { syncDocScale } from '../../annotations/scale-bar.js';
import { STAVENREEKS_DEFAULTS } from '../../annotations/stavenreeks.js';
import { BETONBALK_DEFAULTS, BETONBALK_BREEDTE_RANGE, BETONBALK_HOOGTE_RANGE, BETONBALK_LIJNSTIJLEN } from '../../annotations/betonbalk.js';
import { setBetonbalkLastProfiel } from './betonbalkStore.js';
import { zetRanddikte } from '../../annotations/rendering/textbox-layout.js';
import {
  SYSTEEMRASTER_DEFAULTS, SYSTEEMRASTER_PLAAT_RANGE, SYSTEEMRASTER_RANDCONDITIES,
  resolveSysteem, paneelKey, setEdgeProfiel, setPaneelType, setPaneelComponent,
  setRandProfiel, updateSparing, addSparing, systeemSparingen, sparingRegime,
  sparingRegelsVoorType, buildSysteemraster,
} from '../../annotations/systeemraster.js';
import { systeemrasterBuildOpts } from '../../annotations/systeemraster-scale.js';
import { createDefaultPaneelTypen } from '../../annotations/systeem-typen.js';
import { kenSysteemTypeToe } from '../../annotations/systeem-instance-links.js';
import {
  getSysteemTypeById, getSysteemTypenData, updateSysteemType,
} from '../../annotations/systeem-typen-registry.js';
import { recalculateAllMeasurements, calculateArea, calculatePerimeter, calculateDistance, formatMeasurement, formatDimensionText, getMeasureScale, herberekenVlakMaat, vlakLengteSchaal } from '../../annotations/measurement.js';
import { lengteEenheid, schaalInEenheid } from '../../annotations/vlak-zijden.js';
import {
  isRuimteVlak, isRuimteTag, ruimteVanTag, tagWeergaveParams, tagWijziging,
} from '../../plattegrond/ruimte-koppeling.js';
import { applyTemplateRealSize } from '../../symbols/real-size.js';
import { applyStampLineWidth, applyStampColor, stampLineWidthOf } from '../../annotations/stamp-line-width.js';
import { pendingParams, setPendingParams } from './parametricSymbolStore.js';
import { klemMaat, toonMaat, veiligeVerhouding, RECHTHOEK_VORMEN } from '../../annotations/minimummaat.js';
import { nieuweAfbeeldingsMaat } from '../../annotations/papiermaat-eenheid.js';
import { papierEenheid } from './papierEenheidStore.js';
import { kanZonderRand } from '../../annotations/fill-utils.js';
import { heeftVulDekking, zetLijnDekking } from '../../annotations/vul-dekking.js';
import { isWisselbaarProfiel, profielTypen, wisselProfielType } from '../../symbols/profieltype.js';
import { schaalgebiedStijl } from '../../annotations/scale-region-style.js';
import { leesGetalBegin, leesGeheelGetal } from '../../core/getal-invoer.js';

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
  statusBy: '',
  statusAt: '',
  color: '#000000',
  fillColor: null,
  strokeColor: '#000000',
  textColor: '#000000',
  lineWidth: 3,
  opacity: 100,
  fillOpacity: 100,
  icon: 'comment',
  borderStyle: 'solid',
  cross: false,
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
  dimShowUnit: true,
  measureShowLabel: true,
  measureShowEdgeLengths: false,
  isRuimte: false,
  opsRuimteNummer: '',
  ruimteOppervlakte: '',
  dimLineOvershootMm: '',
  dimExtGapMm: '',
  dimExtOvershootMm: '',
  scaleBarUnit: 'mm',
  scaleBarTotalUnits: 5000,
  scaleBarDivisions: 5,
  scaleBarHeight: 14,
  srCount: 3,
  srLineTail: STAVENREEKS_DEFAULTS.lineTail,
  srFontSize: STAVENREEKS_DEFAULTS.fontSize,
  srDiameter: 12,
  srBarLengthMm: 0,
  srLegDir: 'down-left',
  srLegLength: 24,
  srLabelSide: 'end',
  symbolId: '',
  // Staalprofiel (#697): het profieltype (sjabloon-id, of 'mixed') en de
  // typen waar het naartoe kan wisselen ([{ id, name, nameEn }]).
  profielType: '',
  profielTypen: [],
  params: {},
  // Gevelelement: het geselecteerde onderdeel (stijl/paneel) of null.
  gevelSub: null,
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
  fillNoneAllowed: true,
  strokeColorGroup: false,
  strokeNoneAllowed: false,
  colorGroup: false,
  lineWidthGroup: false,
  borderStyleGroup: false,
  textGroup: false,
  fontSizeGroup: false,
  opacityGroup: true,
  fillOpacityGroup: false,
  // Aparte dekking voor lijn en vulling (#685): de dekking heet dan
  // lijndekking en de vul-dekking staat ernaast.
  aparteDekking: false,
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
  // Een invoegteken (#508) heeft de ingevoegde tekst als inhoud.
  const isTextContent = type === 'text' || type === 'comment' || type === 'caret';
  const isImage = type === 'image';
  const isLineOrArrow = type === 'arrow' || type === 'line';
  const isTextMarkup = isTextAnchored({ type });
  const hideLineWidth = ['highlight', 'comment', 'image', 'textHighlight', 'caret'].includes(type);
  // Schaalgebied (#611): eigen vulkleur en vul-doorzichtigheid; "geen" vulling
  // is daar vul-doorzichtigheid 0, want zonder vulkleur volgt de vulling de
  // randkleur (het oude uiterlijk).
  const isScaleRegion = type === 'scaleRegion';
  const hasFillColor = ['highlight', 'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'arrow', 'line', 'measureArea', 'filledArea', 'scaleRegion'].includes(type);
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
    lineEndings: lintZetLijnkoppen(type) || type === 'measureDistance' || type === 'measurePerimeter',
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
    fillNoneAllowed: !isScaleRegion,
    strokeColorGroup: isShape || type === 'measureDistance' || type === 'measureArea' || type === 'measurePerimeter' || type === 'filledArea',
    strokeNoneAllowed: kanZonderRand(type),
    colorGroup: !hideColor || isTextMarkup,
    lineWidthGroup: !hideLineWidth,
    borderStyleGroup: hasBorderStyle,
    hatchPatternGroup: hasHatchPattern,
    crossGroup: ondersteuntKruis(type),
    textGroup: isTextContent,
    fontSizeGroup: type === 'text',
    opacityGroup: !isScaleBar,
    fillOpacityGroup: isScaleRegion || heeftVulDekking(type),
    aparteDekking: heeftVulDekking(type),
    rotationGroup: hasRotation,
  });
}

// Paneelvelden van een systeem die van zijn TYPE (of de typebibliotheek)
// afhangen. Bij een gekoppeld type gelden de TYPE-celmaten (strook: de
// strookbreedte); een onbevestigde maat van het type is null en toont leeg
// (#567: geen standaardmaat). Zonder type de instance-maat.
function _systeemTypeVelden(annotation) {
  const isSysteem = annotation.type === 'systeemraster';
  const st = isSysteem ? getSysteemTypeById(annotation.systeemTypeId) : null;
  const plaat = st
    ? {
      plaatBreedteMm: (st.layout === 'strook' ? st.strookBreedteMm : st.celXMm) ?? null,
      plaatHoogteMm: st.celYMm ?? null,
    }
    : {
      plaatBreedteMm: annotation.plaatBreedteMm ?? SYSTEEMRASTER_DEFAULTS.plaatBreedteMm,
      plaatHoogteMm: annotation.plaatHoogteMm ?? SYSTEEMRASTER_DEFAULTS.plaatHoogteMm,
    };
  return {
    ...plaat,
    // Systeem: TYPE-verwijzing (systeemTypeId) + de type-bibliotheek voor de
    // dropdown. Bij een gekoppeld type tonen de celmaat-/randprofiel-velden
    // de TYPE-waarden (bewerken schrijft op het type → alle instanties
    // veranderen mee).
    sgTypeId: isSysteem ? (annotation.systeemTypeId || null) : null,
    sgTypeList: isSysteem ? getSysteemTypenData().typen.map(t => ({ id: t.id, naam: t.naam })) : [],
    // Layout-vorm van het type ('raster'|'strook') — stuurt de labels en
    // sub-secties (strook/paneel) in de Systeem-sectie.
    sgLayout: isSysteem ? (st?.layout || 'raster') : 'raster',
    sgEdgeProfiel: isSysteem
      ? (st?.edgeProfiel || resolveSysteem(annotation).layers[0].edge.profiel) : 'geen',
    // Paneel-assortiment van het systeemtype (dropdown in de sub-sectie).
    sgPaneelTypen: isSysteem
      ? (st?.paneelTypen || createDefaultPaneelTypen()).map(p => ({ id: p.id, naam: p.naam }))
      : [],
    // IFC-pad van het component (onderdelen erven dit pad).
    sgIfcPad: isSysteem
      ? `${annotation.ifcCategory || 'IfcCovering'}${annotation.ifcPredefinedType
        ? ` (${annotation.ifcPredefinedType})` : ''}`
      : '',
  };
}

/**
 * Na een bevestigde wijziging van de typebibliotheek (#567): ververs alleen de
 * type-afgeleide velden van het systeem dat het paneel nu toont. Geen nieuwe
 * selectie, geen selectiemelding naar plugins en geen wissel van paneelmodus;
 * bij een meervoudige selectie of een ander annotatietype gebeurt er niets.
 * @returns {boolean} of er ververst is.
 */
export function storeVerversSysteemType() {
  const ann = currentAnnotation;
  if (!ann || ann.type !== 'systeemraster' || annotProps.multiCount > 0) return false;
  setAnnotProps({
    ..._systeemTypeVelden(ann),
    // Omzetten in de editor wijzigt ook de IFC-kopie op de instance.
    ifcCategory: ann.ifcCategory || '',
  });
  return true;
}

// Show properties for a single annotation
export function storeShowProperties(annotation) {
  // De doorhaling van een vervanging (#508) wordt getekend en opgeslagen in de
  // kleur van haar invoegteken: het paneel bewerkt dus het invoegteken.
  const _corrDoc = getActiveDocument();
  if (_corrDoc && isFoldedChild(annotation, _corrDoc.annotations)) {
    annotation = _corrDoc.annotations.find(a => a.id === annotation.inReplyTo) || annotation;
  }
  // Het paneel bewerkt het exemplaar uit het document (#765). Een net
  // getekend tekstvak komt hier als het kale object binnen; schrijven
  // daarop werkt de reactieve store niet bij, terwijl de weergave via de
  // store leest. Dan bleef bijvoorbeeld het gekozen lettertype Arial.
  if (_corrDoc && annotation?.id) {
    const inDocument = _corrDoc.annotations.find(a => a.id === annotation.id);
    if (inDocument) annotation = inDocument;
  }
  currentAnnotation = annotation;
  // Fire plugin selection-listeners (separate from property-panel-registry):
  // gives plugins a direct channel to react to selection without scraping DOM.
  fireSelectionChange(annotation);
  const isLocked = annotation.locked || false;

  setAnnotProps({
    id: annotation.id || '',
    type: annotation.type,
    typeDisplay: getAnnotationDisplayName(annotation, getActiveDocument()?.annotations),
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
    statusBy: annotation.statusBy || '',
    statusAt: annotation.statusAt ? formatDate(annotation.statusAt) : '',
    ifcCategory: annotation.ifcCategory || '',
    color: annotation.color || '#000000',
    fillColor: annotation.type === 'scaleRegion'
      ? schaalgebiedStijl(annotation).vulKleur : (annotation.fillColor || null),
    fillOpacity: _vulDoorzichtigheidPct(annotation),
    strokeColor: annotation.strokeColor || annotation.color || '#000000',
    textColor: annotation.textColor || annotation.color || '#000000',
    // NL-tekenwerkcomponenten zonder eigen lineWidth tonen hun GEËRFDE
    // (tekeningtype-)dikte in plaats van de generieke 3. Een stempel toont de
    // dikte die ZIJN SVG nu werkelijk oplevert, anders springt de lijn zodra
    // de gebruiker het veld voor het eerst aanraakt.
    lineWidth: annotation.lineWidth !== undefined ? annotation.lineWidth
      : (annotation.type === 'stamp' ? (stampLineWidthOf(annotation) ?? 3)
        : DRAFTING_RULE_TYPES.has(annotation.type)
          ? Math.round(effectiveDraftingLineWidth(annotation) * 100) / 100 : 3),
    opacity: annotation.opacity !== undefined ? Math.round(annotation.opacity * 100) : 100,
    icon: annotation.icon || 'comment',
    borderStyle: annotation.borderStyle || 'solid',
    cross: annotation.cross === true,
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
    // In paginapunten, onafgerond: het paneel toont ze in de gekozen
    // papiereenheid (#598) en rondt pas daar af, zodat ook een kleine maat
    // in inch niet "0" wordt.
    imageWidth: annotation.type === 'image' ? annotation.width : 0,
    imageHeight: annotation.type === 'image' ? annotation.height : 0,
    imageRotation: annotation.type === 'image' ? Math.round(annotation.rotation || 0) : 0,
    lockAspectRatio: annotation.type === 'image' ? (annotation.lockAspectRatio || false) : false,
    linkedPath: annotation.linkedPath || '',
    tintColor: annotation.tintColor || '',
    cropLeft: annotation.type === 'image' ? Math.round((annotation.cropLeft || 0) * 100) : 0,
    cropTop: annotation.type === 'image' ? Math.round((annotation.cropTop || 0) * 100) : 0,
    cropRight: annotation.type === 'image' ? Math.round((annotation.cropRight || 0) * 100) : 0,
    cropBottom: annotation.type === 'image' ? Math.round((annotation.cropBottom || 0) * 100) : 0,
    // Pijl, gebogen pijl en callout: de koppen zoals het scherm ze tekent (#612).
    ...(lintZetLijnkoppen(annotation.type) ? koppenVan(annotation) : {
      startHead: annotation.startHead || (annotation.type === 'measureDistance' ? 'openCircle' : 'none'),
      endHead: annotation.endHead || (annotation.type === 'measureDistance' ? 'openCircle' : 'open'),
      headSize: annotation.headSize || 12,
    }),
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
    // Een meetvlak bewaart zijn oppervlakte-eenheid ('mm²'); de keuzelijst
    // kent lengte-eenheden (#536).
    measureUnit: (annotation.type === 'measureArea' ? lengteEenheid(annotation.measureUnit) : annotation.measureUnit) || '',
    measurePrecision: annotation.measurePrecision !== undefined ? annotation.measurePrecision : 2,
    measureName: annotation.measureName || '',
    dimType: annotation.dimType || '',
    styleType: annotation.styleType || annotation.dimType || '',
    dimExtension: annotation.dimExtension !== false, // default ON
    // Eenheid achter de maat en het label van een meetvlak: standaard aan;
    // alleen een expliciete false zet ze uit (maat-label.js).
    dimShowUnit: annotation.dimShowUnit !== false,
    measureShowLabel: annotation.measureShowLabel !== false,
    // Zijdematen van een meetvlak: standaard uit (#536).
    measureShowEdgeLengths: annotation.measureShowEdgeLengths === true,
    // Uitloop en hulplijnen in mm op papier; leeg = automatisch (oude beeld).
    dimLineOvershootMm: annotation.dimLineOvershootMm ?? '',
    dimExtGapMm: annotation.dimExtGapMm ?? '',
    dimExtOvershootMm: annotation.dimExtOvershootMm ?? '',

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
    // Stavenreeks (wapeningsstaven-reeks)
    srCount: annotation.count ?? 3,
    srDiameter: annotation.diameter ?? 12,
    srBarLengthMm: annotation.barLengthMm ?? 0,
    srLegDir: annotation.legDir || 'down-left',
    srLegLength: annotation.legLength ?? STAVENREEKS_DEFAULTS.legLength,
    srLineTail: annotation.lineTail ?? STAVENREEKS_DEFAULTS.lineTail,
    srFontSize: annotation.fontSize ?? STAVENREEKS_DEFAULTS.fontSize,
    srLabelSide: annotation.labelSide || 'end',
    symbolId: annotation.symbolId || '',
    profielType: isWisselbaarProfiel(annotation) ? annotation.symbolId : '',
    profielTypen: isWisselbaarProfiel(annotation) ? profielTypen(annotation.symbolId) : [],
    // Een ruimtetag toont naam, nummer en oppervlakte van zijn ruimte.
    params: annotation.params
      ? { ...(tagWeergaveParams(annotation, getActiveDocument()?.annotations) || annotation.params) }
      : {},
    // Gevelelement (vliesgevel/kozijn): het met Tab of een tweede klik
    // geselecteerde onderdeel — de GevelelementSection toont dat onderdeel.
    gevelSub: annotation.type === 'parametricSymbol' && annotation.selectedSub
      ? { ...annotation.selectedSub } : null,
    // Ruimte uit de plattegrond: nummer en netto oppervlakte in het paneel.
    isRuimte: isRuimteVlak(annotation),
    opsRuimteNummer: annotation.opsRuimteNummer ?? '',
    ruimteOppervlakte: isRuimteVlak(annotation) ? (annotation.measureText || '') : '',
    dikteMm: annotation.dikteMm ?? 100,
    isolatieType: annotation.isolatieType || 'steenwol',
    // Wandjoin per uiteinde (#476): true = dat uiteinde joint nooit.
    noJoinStart: annotation.noJoinStart === true,
    noJoinEnd: annotation.noJoinEnd === true,
    // Betonbalk
    breedteMm: annotation.breedteMm ?? BETONBALK_DEFAULTS.breedteMm,
    hoogteMm: annotation.hoogteMm ?? BETONBALK_DEFAULTS.hoogteMm,
    lijnstijl: annotation.lijnstijl || BETONBALK_DEFAULTS.lijnstijl,
    toonHartlijn: annotation.toonHartlijn === true,
    tagTonen: annotation.tagTonen === true,
    tagTekst: annotation.tagTekst || '',
    // Systeemraster — plaatmaat (bij een type de TYPE-celmaten), type-
    // verwijzing en -lijst, layout, randprofiel, assortiment en IFC-pad:
    // dezelfde velden die storeVerversSysteemType na een typewijziging
    // ververst.
    ..._systeemTypeVelden(annotation),
    equalizeX: annotation.equalizeX === true,
    equalizeY: annotation.equalizeY === true,
    randConditie: annotation.randConditie || SYSTEEMRASTER_DEFAULTS.randConditie,
    minRandMm: annotation.minRandMm ?? SYSTEEMRASTER_DEFAULTS.minRandMm,
    // Contour + parameters voor de randstuk-maten in het paneel: de sectie
    // herbouwt de geometrie reactief uit deze kopie (zie SysteemrasterSection).
    sgPoints: annotation.type === 'systeemraster' && Array.isArray(annotation.points)
      ? annotation.points.map(p => (p.arc === true
        ? { x: p.x, y: p.y, arc: true, bulge: p.bulge }
        : { x: p.x, y: p.y })) : null,
    sgOriginXMm: annotation.originXMm ?? 0,
    sgOriginYMm: annotation.originYMm ?? 0,
    sgPage: annotation.page ?? 1,
    // Systeem: TYPE-verwijzing (systeemTypeId) + de type-bibliotheek voor de
    // dropdown, rasterhoek, randprofiel en het geselecteerde paneel (tweede
    // klik binnen het component) + zijn huidige paneeltype. Bij een gekoppeld
    // type tonen de celmaat-/randprofiel-velden de TYPE-waarden (bewerken
    // schrijft op het type → alle instanties veranderen mee).
    sgSysType: annotation.type === 'systeemraster'
      ? resolveSysteem(annotation).type : null,
    sgRasterHoek: annotation.type === 'systeemraster'
      ? (Number(annotation.rasterHoek) || 0) : 0,
    // Geselecteerd SUB-ELEMENT (tweede klik): paneel, randsegment of
    // rasterlijn — met de weergavedata voor de "Onderdeel"-sub-sectie.
    sgSelectedSub: annotation.type === 'systeemraster' && annotation.selectedSub
      ? JSON.parse(JSON.stringify(annotation.selectedSub)) : null,
    sgPaneelType: (() => {
      if (annotation.type !== 'systeemraster') return 'tegel';
      const sub = annotation.selectedSub;
      if (!sub || sub.kind !== 'paneel') return 'tegel';
      const ov = resolveSysteem(annotation).layers[0].panels[paneelKey(sub.ix, sub.iy)];
      if (!ov) return 'tegel';
      return typeof ov === 'string' ? ov : 'component';
    })(),
    sgPaneelComponent: (() => {
      if (annotation.type !== 'systeemraster' || !annotation.selectedSub
          || annotation.selectedSub.kind !== 'paneel') return null;
      const ov = resolveSysteem(annotation).layers[0]
        .panels[paneelKey(annotation.selectedSub.ix, annotation.selectedSub.iy)];
      return ov && typeof ov === 'object' ? { ...ov } : null;
    })(),
    // Rand-override (raw) van het geselecteerde randsegment ('' = erft).
    sgRandOverride: annotation.type === 'systeemraster' && annotation.selectedSub
      && annotation.selectedSub.kind === 'rand'
      ? (resolveSysteem(annotation).layers[0].edges[String(annotation.selectedSub.seg)] || '')
      : '',
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
    fillNoneAllowed: true,
    strokeColorGroup: false,
  strokeNoneAllowed: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    fillOpacityGroup: false,
    aparteDekking: false,
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

// Staalprofiel (#697) bij een meervoudige selectie: alleen als ALLE
// geselecteerde profielen uit dezelfde profielgroep komen.
function _gedeeldProfielType(selected) {
  if (!selected.length || !selected.every(isWisselbaarProfiel)) return { profielType: '', profielTypen: [] };
  const typen = profielTypen(selected[0].symbolId);
  const ids = new Set(typen.map(t => t.id));
  if (!selected.every(a => ids.has(a.symbolId))) return { profielType: '', profielTypen: [] };
  return { profielType: sharedValue(selected, a => a.symbolId, 'mixed'), profielTypen: typen };
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
  const sharedFillColor = sharedValue(selected, a => a.type === 'scaleRegion'
    ? schaalgebiedStijl(a).vulKleur : (a.fillColor || null), 'mixed');
  const sharedFillOpacity = sharedValue(selected, a => _vulDoorzichtigheidPct(a), 'mixed');
  const sharedStrokeColor = sharedValue(selected, a => a.strokeColor || a.color || '#000000', 'mixed');
  const sharedTextColor = sharedValue(selected, a => a.textColor || a.color || '#000000', 'mixed');
  const sharedLineWidth = sharedValue(selected, a => a.lineWidth !== undefined ? a.lineWidth
    : (DRAFTING_RULE_TYPES.has(a.type)
      ? Math.round(effectiveDraftingLineWidth(a) * 100) / 100 : 3), 'mixed');
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
    fillOpacity: sharedFillOpacity,
    icon: sharedValue(selected, a => a.icon || 'comment', 'mixed'),
    borderStyle: sharedBorderStyle,
    cross: sharedValue(selected, a => a.cross === true, 'mixed'),
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
    startHead: sharedValue(selected, a => koppenVan(a).startHead, 'mixed'),
    endHead: sharedValue(selected, a => koppenVan(a).endHead, 'mixed'),
    headSize: sharedValue(selected, a => koppenVan(a).headSize, 'mixed'),
    arrowLength: '',
    replies: [],
    multiCount: selected.length,
    ..._gedeeldProfielType(selected),
  });

  // Helper: check if ALL selected annotations satisfy a predicate on their type
  const allMatch = (predicate) => selected.every(a => predicate(a.type));

  const fillColorTypes = new Set(['highlight', 'box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'arrow', 'line', 'scaleRegion']);
  const strokeColorTypes = new Set(['line', 'arrow', 'box', 'circle', 'draw', 'textbox', 'callout', 'polygon', 'cloud']);
  const hideColorTypes = new Set(['line', 'arrow', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout', 'polygon', 'cloud']);
  const hideLineWidthTypes = new Set(['highlight', 'comment', 'image', 'textHighlight', 'caret']);
  const borderStyleTypes = new Set(['textbox', 'callout', 'arrow', 'line', 'box', 'circle', 'polygon', 'cloud', 'draw', 'polyline', 'splineArrow']);
  const hatchPatternTypes = new Set(['box', 'circle', 'polygon', 'cloud', 'measureArea', 'filledArea']);
  const rotationTypes = new Set(['box', 'circle', 'polygon', 'cloud', 'highlight', 'redaction', 'comment', 'stamp', 'signature']);
  const textboxTypes = new Set(['textbox', 'callout']);

  const allSameType = sharedType !== '';

  setSectionVis({
    general: true,
    replies: false,
    appearance: true,
    lineEndings: allSameType && lintZetLijnkoppen(sharedType),
    dimensions: false,
    measurement: false,
    textFormat: allMatch(t => textboxTypes.has(t)),
    paragraph: allMatch(t => textboxTypes.has(t)),
    content: false,
    image: false,
    actions: true,
    iconGroup: allSameType && sharedType === 'comment',
    fillColorGroup: allMatch(t => fillColorTypes.has(t)),
    fillNoneAllowed: !selected.some(a => a.type === 'scaleRegion'),
    strokeColorGroup: allMatch(t => strokeColorTypes.has(t)),
    strokeNoneAllowed: allMatch(t => kanZonderRand(t)),
    colorGroup: allMatch(t => !hideColorTypes.has(t) || isTextAnchored({ type: t })),
    lineWidthGroup: allMatch(t => !hideLineWidthTypes.has(t)),
    borderStyleGroup: allMatch(t => borderStyleTypes.has(t)),
    hatchPatternGroup: allMatch(t => hatchPatternTypes.has(t)),
    crossGroup: kruisZichtbaarVoorSelectie(selected),
    textGroup: allSameType && (sharedType === 'text' || sharedType === 'comment'),
    fontSizeGroup: allSameType && sharedType === 'text',
    opacityGroup: true,
    fillOpacityGroup: allMatch(t => t === 'scaleRegion') || allMatch(heeftVulDekking),
    aparteDekking: allMatch(heeftVulDekking),
    rotationGroup: allMatch(t => rotationTypes.has(t)),
  });

  setPanelMode('multi');
  setPanelVisible(true);
}

// Show text edit properties (PDF text editing mode)
// Lettertype van de PDF-tekst die nu bewerkt wordt (zie hieronder).
const [pdfTekstBronFont, setPdfTekstBronFont] = createSignal(null);
export { pdfTekstBronFont };

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
  // Het lettertype waarmee de tekst nu in de PDF staat: zolang dat gekozen
  // blijft, schrijft de saver de tekst in dat (ingebedde) font terug en is er
  // niets te melden (TextFormatSection, #765).
  setPdfTekstBronFont(displayFontFamily);

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
    fillNoneAllowed: true,
    strokeColorGroup: false,
  strokeNoneAllowed: false,
    colorGroup: false,
    lineWidthGroup: false,
    borderStyleGroup: false,
    textGroup: false,
    fontSizeGroup: false,
    opacityGroup: false,
    fillOpacityGroup: false,
    aparteDekking: false,
    rotationGroup: false,
  });

  setPanelMode('textEdit');
}

// Populate document info
// Wordt aangeroepen bij deselecteren/tabwissel (storeHideProperties) en door
// het reactieve effect in DocInfoView (document geladen, paginawissel door
// scrollen in de doorlopende weergave). Aanroepen kunnen overlappen; na elke
// await schrijft alleen de laatst gestarte aanroep nog weg, zodat een trage
// oudere getPage() het formaat van een nieuwere pagina niet overschrijft.
const _docInfoRefresh = createLatestOnly();

export async function populateDocInfo() {
  const token = _docInfoRefresh.begin();
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
    const pdfDoc = doc.pdfDoc;
    const pageNum = doc.currentPage;
    setDocInfo('pages', formatDocPages(pageNum, pdfDoc.numPages));
    try {
      const page = await pdfDoc.getPage(pageNum);
      if (!_docInfoRefresh.isCurrent(token)) return;
      const vp = page.getViewport({ scale: 1 });
      setDocInfo('pageSize', formatPageSizeMm(vp.width, vp.height));
    } catch (e) {
      if (!_docInfoRefresh.isCurrent(token)) return;
      setDocInfo('pageSize', DOC_INFO_EMPTY);
    }

    try {
      const metadata = await pdfDoc.getMetadata();
      if (!_docInfoRefresh.isCurrent(token)) return;
      const info = metadata.info || {};
      setDocInfo('title', info.Title || '-');
      setDocInfo('author', info.Author || '-');
      setDocInfo('subject', info.Subject || '-');
      setDocInfo('creator', info.Creator || '-');
      setDocInfo('producer', info.Producer || '-');
      setDocInfo('version', info.PDFFormatVersion || '-');
    } catch (e) { /* ignore */ }
    if (!_docInfoRefresh.isCurrent(token)) return;
  } else {
    // Document (nog) niet geladen: geen gegevens van een vorig document laten staan.
    for (const key of ['pages', 'pageSize', 'title', 'author', 'subject', 'creator', 'producer', 'version']) {
      setDocInfo(key, DOC_INFO_EMPTY);
    }
  }

  const docAnnotations = doc?.annotations || [];
  const total = docAnnotations.length;
  const docPage = doc ? doc.currentPage : 1;
  const onPage = docAnnotations.filter(a => a.page === docPage).length;
  setDocInfo('annotCount', String(total));
  setDocInfo('annotPage', i18next.t('docInfo.onPageCount', { count: onPage, page: docPage, ns: 'properties' }));
}

// Apply a property change to a single annotation object
// Review-status metadata (issue #308): onthoud wie de status zette en
// wanneer, zodat de saver de status als spec-conforme status-reply
// (Text + /IRT + /State) met juiste auteur/datum kan wegschrijven.
function _stampStatusMeta(ann, value) {
  if (value === 'none') {
    delete ann.statusBy;
    delete ann.statusAt;
  } else {
    ann.statusBy = state.defaultAuthor || ann.author || 'User';
    ann.statusAt = new Date().toISOString();
  }
}

// Uitloop van de stavenreeks-aanhaallijn: 0 is geldig (lijn stopt op de
// laatste poot), bovengrens 200 zoals het paneelbereik. Ongeldige invoer valt
// terug op de standaardwaarde.
function _clampLineTail(value) {
  const n = leesGetalBegin(value);
  if (!Number.isFinite(n)) return STAVENREEKS_DEFAULTS.lineTail;
  return Math.max(0, Math.min(200, n));
}

// Tekstgrootte van het stavenreeks-label: 6..72, ongeldige invoer valt terug
// op de standaardwaarde.
function _clampFontSize(value) {
  const n = leesGetalBegin(value);
  if (!Number.isFinite(n) || !(n > 0)) return STAVENREEKS_DEFAULTS.fontSize;
  return Math.max(6, Math.min(72, Math.round(n)));
}

// Systeem-eigenschappen (systeemraster/-plafond). TYPE-sleutels (sgType*)
// schrijven op de HERBRUIKBARE type-definitie in de registry — alle
// instanties met dat type veranderen mee; instance-sleutels (rasterhoek,
// centreren, paneeltype) muteren alleen de annotatie.
function _applySysteemProp(ann, key, value) {
  const num = (v) => leesGetalBegin(v);
  switch (key) {
    case 'sgTypeId':
      // Dezelfde regel als de plugin-API (#574): systeem-instance-links.js.
      kenSysteemTypeToe(ann, value || undefined, getSysteemTypeById(value || undefined));
      break;
    case 'sgTypeCelX': case 'sgTypeCelY': {
      const n = num(value);
      if (!Number.isFinite(n) || !(n > 0)) break;
      const clamped = Math.max(SYSTEEMRASTER_PLAAT_RANGE.min,
        Math.min(SYSTEEMRASTER_PLAAT_RANGE.max, n));
      if (ann.systeemTypeId) {
        // Strook-layout: het X-veld ís de strookbreedte (celXMm loopt mee
        // zodat de tag/legacy-weergave consistent blijft).
        const strook = key === 'sgTypeCelX'
          && getSysteemTypeById(ann.systeemTypeId)?.layout === 'strook';
        updateSysteemType(ann.systeemTypeId,
          key === 'sgTypeCelX'
            ? (strook ? { celXMm: clamped, strookBreedteMm: clamped } : { celXMm: clamped })
            : { celYMm: clamped });
      } else if (key === 'sgTypeCelX') ann.plaatBreedteMm = clamped;
      else ann.plaatHoogteMm = clamped;
      break;
    }
    case 'sgTypeEdge':
      if (ann.systeemTypeId) updateSysteemType(ann.systeemTypeId, { edgeProfiel: value });
      else setEdgeProfiel(ann, value);
      break;
    case 'rasterHoek': {
      const n = num(value);
      ann.rasterHoek = Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
      break;
    }
    case 'sgCentreer':
      ann.equalizeX = true;
      ann.equalizeY = true;
      break;
    case 'sgEdgeProfiel': setEdgeProfiel(ann, value); break;
    // Paneeltype (paneeltype-id uit het assortiment) van het geselecteerde
    // paneel-sub-element.
    case 'sgPaneelType':
      if (ann.selectedSub && ann.selectedSub.kind === 'paneel') {
        setPaneelType(ann, ann.selectedSub.ix, ann.selectedSub.iy, value);
      }
      break;
    // Paneel vervangen door een COMPONENT uit de symbolenbibliotheek:
    // value = { symbolId, naam } (uit de component-kiezer).
    case 'sgPaneelComponent':
      if (ann.selectedSub && ann.selectedSub.kind === 'paneel'
          && value && value.symbolId) {
        setPaneelComponent(ann, ann.selectedSub.ix, ann.selectedSub.iy,
          value.symbolId, value.naam);
      }
      break;
    // Randprofiel-override van het geselecteerde randsegment ('' = erven
    // van het type; 'geen' = expliciet géén rand op dit segment).
    case 'sgRandSegProfiel':
      if (ann.selectedSub && ann.selectedSub.kind === 'rand') {
        setRandProfiel(ann, ann.selectedSub.seg, value === '' ? null : value);
      }
      break;
    // Sparing-afmetingen/-positie (mm) van de geselecteerde sparing.
    case 'sgSparingB': case 'sgSparingH': case 'sgSparingX': case 'sgSparingY': {
      const sub = ann.selectedSub;
      if (!sub || sub.kind !== 'sparing') break;
      const n = leesGetalBegin(value);
      if (!Number.isFinite(n)) break;
      const veld = { sgSparingB: 'bMm', sgSparingH: 'hMm',
        sgSparingX: 'xMm', sgSparingY: 'yMm' }[key];
      if ((veld === 'bMm' || veld === 'hMm') && !(n > 0)) break;
      updateSparing(ann, sub.id, { [veld]: n });
      _syncSparingSub(ann);
      break;
    }
    // Nieuwe sparing (600×600 mm), gecentreerd in de contour; wordt meteen
    // het geselecteerde sub-element.
    case 'sgSparingToevoegen': {
      const geom = buildSysteemraster(ann, systeemrasterBuildOpts(ann));
      if (!geom || !(geom.pxPerMm > 0)) break;
      const k = geom.pxPerMm;
      const sp = addSparing(ann, {
        xMm: geom.rasterAabb.width / 2 / k - 300,
        yMm: geom.rasterAabb.height / 2 / k - 300,
        bMm: 600, hMm: 600,
      });
      if (sp) {
        ann.selectedSub = { kind: 'sparing', id: sp.id,
          xMm: sp.xMm, yMm: sp.yMm, bMm: sp.bMm, hMm: sp.hMm };
        _syncSparingSub(ann);
      }
      break;
    }
  }
}

// Houd ann.selectedSub in de pas met de actuele sparing-waarden (incl. het
// regime volgens de sparingsregels/layout van het type).
function _syncSparingSub(ann) {
  const sub = ann.selectedSub;
  if (!sub || sub.kind !== 'sparing') return;
  const sp = systeemSparingen(ann).find(s => s.id === sub.id);
  if (!sp) { ann.selectedSub = null; return; }
  const st = getSysteemTypeById(ann.systeemTypeId);
  ann.selectedSub = {
    kind: 'sparing', id: sp.id,
    xMm: sp.xMm, yMm: sp.yMm, bMm: sp.bMm, hMm: sp.hMm,
    regime: sparingRegime(sp.bMm, sp.hMm, sparingRegelsVoorType(st), st?.layout || 'raster'),
  };
}

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
    case 'status':
      ann.status = value === 'none' ? undefined : value;
      _stampStatusMeta(ann, value);
      break;
    case 'ifcCategory': ann.ifcCategory = value || undefined; break;
    case 'color':
      ann.color = value;
      // Een stempel wordt als raster getekend; de kleur moet de SVG in en
      // opnieuw gerasterd worden (#341) — zelfde pad als de lijndikte.
      if (ann.type === 'stamp') applyStampColor(ann);
      break;
    case 'fillColor': ann.fillColor = value; break;
    case 'fillOpacity': ann.fillOpacity = _vulDoorzichtigheidUitPct(value); break;
    // Staalprofiel (#697): een ander profieltype; wat geen wisselbaar profiel
    // is (of een andere groep), blijft ongemoeid.
    case 'profielType': wisselProfielType(ann, value); break;
    case 'strokeColor': ann.strokeColor = value; break;
    case 'lineWidth':
      zetRanddikte(ann, leesGetalBegin(value));
      // Een stempel wordt als raster getekend en kent geen ctx.lineWidth; de
      // dikte moet in de SVG worden gezet. Synchroon, zodat undo de gewijzigde
      // stampSvg meekrijgt.
      if (ann.type === 'stamp') applyStampLineWidth(ann);
      break;
    // Bij een vorm met aparte vul-dekking houdt de vulling haar dekking (#685).
    case 'opacity': zetLijnDekking(ann, leesGeheelGetal(value) / 100); break;
    case 'icon': ann.icon = value; break;
    case 'borderStyle': ann.borderStyle = value; break;
    case 'cross': ann.cross = value === true || undefined; break;
    case 'hatchPattern': ann.hatchPattern = value; break;
    case 'hatchColor': ann.hatchColor = value; break;
    case 'hatchScale': ann.hatchScale = leesGeheelGetal(value); break;
    case 'hatchAngle': ann.hatchAngle = leesGeheelGetal(value); break;
    case 'text': ann.text = value; break;
    case 'fontSize': ann.fontSize = leesGeheelGetal(value); break;
    case 'textColor':
      ann.textColor = value;
      ann.color = value;
      break;
    case 'fontFamily': ann.fontFamily = value; break;
    case 'textFontSize': ann.fontSize = leesGeheelGetal(value); break;
    case 'fontBold': ann.fontBold = value; zetRunsStijl(ann, 'bold', value); break;
    case 'fontItalic': ann.fontItalic = value; zetRunsStijl(ann, 'italic', value); break;
    case 'fontUnderline': ann.fontUnderline = value; break;
    case 'fontStrikethrough': ann.fontStrikethrough = value; break;
    case 'textAlign': ann.textAlign = value; break;
    case 'lineSpacing': {
      ann.lineSpacing = leesGetalBegin(value);
      if (['textbox', 'callout'].includes(ann.type) && ann.text) {
        ann.height = computeTextboxContentHeight(ann);
      }
      break;
    }
    case 'rotation': ann.rotation = Math.max(-360, Math.min(360, leesGeheelGetal(value) || 0)); break;
    case 'measureScale': ann.measureScale = leesGetalBegin(value) || 0; recomputeMeasureText(ann); break;
    case 'measureUnit': zetMeetEenheid(ann, value); break;
    case 'measurePrecision': ann.measurePrecision = leesGeheelGetal(value); recomputeMeasureText(ann); break;
    case 'measureName':
      ann.measureName = value;
      if (isRuimteVlak(ann)) ann.opsRuimteNaam = value;
      break;
    case 'scaleBarUnit': ann.unit = value; break;
    case 'scaleBarTotalUnits': ann.totalUnits = leesGetalBegin(value) || 1; break;
    case 'scaleBarDivisions': ann.divisions = Math.max(1, Math.min(20, leesGeheelGetal(value) || 5)); break;
    case 'scaleBarHeight': ann.height = _schaalbalkHoogte(value); break;
    // Stavenreeks — parameters; de geometrie wordt bij het renderen afgeleid
    // uit start/eind + deze waarden (geen coördinaten herberekenen hier).
    case 'srCount': ann.count = Math.max(1, Math.min(999, leesGeheelGetal(value) || 1)); break;
    case 'srDiameter': ann.diameter = leesGetalBegin(value) || 12; break;
    case 'srBarLengthMm': ann.barLengthMm = Math.max(0, leesGetalBegin(value) || 0); break;
    case 'srLegDir': ann.legDir = value; break;
    case 'srLegLength': ann.legLength = Math.max(1, leesGetalBegin(value) || STAVENREEKS_DEFAULTS.legLength); break;
    case 'srLineTail': ann.lineTail = _clampLineTail(value); break;
    case 'srFontSize': ann.fontSize = _clampFontSize(value); break;
    case 'srLabelSide': ann.labelSide = value; break;
    // Betonbalk — parameters; de band wordt bij het renderen opnieuw uit de
    // hartlijn + breedte afgeleid (geen coördinaten herberekenen hier).
    case 'breedteMm': {
      const bw = leesGetalBegin(value);
      ann.breedteMm = Number.isFinite(bw) && bw > 0
        ? Math.max(BETONBALK_BREEDTE_RANGE.min, Math.min(BETONBALK_BREEDTE_RANGE.max, bw))
        : BETONBALK_DEFAULTS.breedteMm;
      setBetonbalkLastProfiel(ann.breedteMm, ann.hoogteMm);
      break;
    }
    case 'hoogteMm': {
      const bh = leesGetalBegin(value);
      ann.hoogteMm = Number.isFinite(bh) && bh > 0
        ? Math.max(BETONBALK_HOOGTE_RANGE.min, Math.min(BETONBALK_HOOGTE_RANGE.max, bh))
        : BETONBALK_DEFAULTS.hoogteMm;
      setBetonbalkLastProfiel(ann.breedteMm, ann.hoogteMm);
      break;
    }
    case 'lijnstijl':
      ann.lijnstijl = BETONBALK_LIJNSTIJLEN.includes(value) ? value : BETONBALK_DEFAULTS.lijnstijl;
      break;
    case 'toonHartlijn': ann.toonHartlijn = value === true || value === 'true'; break;
    case 'tagTonen': ann.tagTonen = value === true || value === 'true'; break;
    case 'tagTekst': ann.tagTekst = String(value ?? ''); break;
    // Systeemraster — parameters; het raster wordt bij het renderen opnieuw
    // uit de contour + deze waarden afgeleid (geen coördinaten herrekenen).
    case 'plaatBreedteMm': {
      const spb = leesGetalBegin(value);
      ann.plaatBreedteMm = Number.isFinite(spb) && spb > 0
        ? Math.max(SYSTEEMRASTER_PLAAT_RANGE.min, Math.min(SYSTEEMRASTER_PLAAT_RANGE.max, spb))
        : SYSTEEMRASTER_DEFAULTS.plaatBreedteMm;
      break;
    }
    case 'plaatHoogteMm': {
      const sph = leesGetalBegin(value);
      ann.plaatHoogteMm = Number.isFinite(sph) && sph > 0
        ? Math.max(SYSTEEMRASTER_PLAAT_RANGE.min, Math.min(SYSTEEMRASTER_PLAAT_RANGE.max, sph))
        : SYSTEEMRASTER_DEFAULTS.plaatHoogteMm;
      break;
    }
    case 'equalizeX': ann.equalizeX = value === true || value === 'true'; break;
    case 'equalizeY': ann.equalizeY = value === true || value === 'true'; break;
    case 'randConditie':
      ann.randConditie = SYSTEEMRASTER_RANDCONDITIES.includes(value)
        ? value : SYSTEEMRASTER_DEFAULTS.randConditie;
      break;
    case 'minRandMm': {
      const smr = leesGetalBegin(value);
      ann.minRandMm = Number.isFinite(smr) && smr >= 0 ? smr : SYSTEEMRASTER_DEFAULTS.minRandMm;
      break;
    }
    // Systeem — type-verwijzing, type-bewerking, rasterhoek, centreren,
    // randprofiel en sub-element-eigenschappen (zie _applySysteemProp).
    case 'sgTypeId': case 'sgTypeCelX': case 'sgTypeCelY': case 'sgTypeEdge':
    case 'rasterHoek': case 'sgCentreer': case 'sgEdgeProfiel': case 'sgPaneelType':
    case 'sgPaneelComponent': case 'sgRandSegProfiel':
    case 'sgSparingB': case 'sgSparingH': case 'sgSparingX': case 'sgSparingY':
    case 'sgSparingToevoegen':
      _applySysteemProp(ann, key, value);
      break;
    case 'viewportName': ann.name = value; break;
    case 'viewportScaleRatio': {
      const ratio = leesGeheelGetal(value);
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
    default:
      ann[key] = ((key === 'width' || key === 'height') && RECHTHOEK_VORMEN.has(ann.type))
        ? klemMaat(value) : value;
      break;
  }
}

// Eenheid van een meting kiezen. Bij een meetvlak (#536) blijft de echte maat
// gelijk: een eigen schaal rekent mee om naar de nieuwe eenheid, en zonder
// eigen schaal wordt de schaal van het document in die eenheid vastgelegd
// (anders zette het herberekenen de eenheid meteen terug). Pixels hebben geen
// vaste maat; daar blijft het schaalgetal staan.
function zetMeetEenheid(ann, eenheid) {
  if (ann?.type === 'measureArea' && eenheid) {
    const huidig = vlakLengteSchaal(ann);
    ann.measureScale = schaalInEenheid(huidig.perPt, huidig.unit, eenheid);
  }
  ann.measureUnit = eenheid;
  recomputeMeasureText(ann);
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
    // Met de eigen schaal (measureScale) als die er is (#536).
    herberekenVlakMaat(ann);
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

// Vlak-brede vet/cursief vanuit het paneel (niet in bewerking): ook de
// inline runs meenemen, anders blijft een deels-vet vlak zijn oude runs tonen.
function zetRunsStijl(ann, veld, waarde) {
  if (!Array.isArray(ann?.textRuns)) return;
  ann.textRuns = ann.textRuns.map(line => (line || []).map(r => ({ ...r, [veld]: !!waarde })));
}

// One field change is one reactive update: the change writes the field, the
// modification time and sometimes more, and every write on its own reran
// everything that watches the annotation (#491).
export function updateAnnotProp(key, value) {
  batch(() => applyAnnotProp(key, value));
}

function applyAnnotProp(key, value) {
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

    // After toggling lock, refresh the panel to update locked state. Bij
    // schaalgebieden volgt de getoonde vulling de kleur/doorzichtigheid (#611).
    if (key === 'locked'
        || key === 'profielType'
        || (_SCHAALGEBIED_VULSLEUTELS.has(key) && selected.some(a => a.type === 'scaleRegion'))) {
      storeShowMultiSelection(selected);
    }

    redraw();
    return;
  }

  if (!currentAnnotation) return;

  if (currentAnnotation.id === '__tool-defaults__'
      && currentAnnotation.type === 'parametricSymbol'
      && key === 'params') {
    setPendingParams(value);
    currentAnnotation.params = pendingParams();
    setAnnotProps('params', currentAnnotation.params);
    return;
  }

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

  // Tekstvlak in bewerking: vet/cursief/onderstrepen gaat naar de selectie
  // in de open editor (deels vet), niet naar het hele vlak.
  if ((key === 'fontBold' || key === 'fontItalic' || key === 'fontUnderline')
      && state.isEditingText && state.editingAnnotation === currentAnnotation) {
    setAnnotProps(key, value === true);
    import('./textEditOverlayStore.js')
      .then(m => m.applyEditorFormat && m.applyEditorFormat(key, value))
      .catch(() => {});
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

  // Ruimtetag: naam en nummer horen bij de RUIMTE (ruimte-koppeling.js). Een
  // wijziging in de tag gaat naar de ruimte - een ongedaan-stap op de ruimte -
  // en elke tag van die ruimte toont hem meteen.
  if (key === 'params' && isRuimteTag(currentAnnotation)) {
    const doc = getActiveDocument();
    const ruimte = ruimteVanTag(currentAnnotation, doc?.annotations);
    const { ruimtePatch } = tagWijziging(currentAnnotation, ruimte, value);
    if (ruimte && ruimtePatch) {
      recordPropertyChange(ruimte);
      Object.assign(ruimte, ruimtePatch);
      ruimte.modifiedAt = new Date().toISOString();
      setAnnotProps('params', { ...tagWeergaveParams(currentAnnotation, doc?.annotations) });
      redraw();
      return;
    }
  }

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
    case 'status':
      currentAnnotation.status = value === 'none' ? undefined : value;
      _stampStatusMeta(currentAnnotation, value);
      setAnnotProps({
        statusBy: currentAnnotation.statusBy || '',
        statusAt: currentAnnotation.statusAt ? formatDate(currentAnnotation.statusAt) : '',
      });
      break;
    case 'ifcCategory': currentAnnotation.ifcCategory = value || undefined; break;
    case 'color':
      currentAnnotation.color = value;
      // Stroke-rendered types resolve their colour as `strokeColor || color`
      // (rendering.js). If such an annotation already carries a strokeColor
      // (set by its creator), changing only `color` has NO visible effect —
      // the stale strokeColor wins. So when the 'color' control IS the colour
      // for these types, mirror it onto strokeColor too.
      if (_STROKE_COLOR_DRIVEN.has(currentAnnotation.type)) currentAnnotation.strokeColor = value;
      // Zie applyPropToAnnotation: bij een stempel moet de kleur de SVG in (#341).
      if (currentAnnotation.type === 'stamp') applyStampColor(currentAnnotation);
      break;
    case 'fillColor': currentAnnotation.fillColor = value; break;
    case 'fillOpacity': currentAnnotation.fillOpacity = _vulDoorzichtigheidUitPct(value); break;
    case 'strokeColor':
      currentAnnotation.strokeColor = value;
      if (currentAnnotation.type === 'parametricSymbol') currentAnnotation.color = value;
      break;
    case 'lineWidth':
      zetRanddikte(currentAnnotation, leesGetalBegin(value));
      // Zie applyPropToAnnotation: bij een stempel moet de dikte de SVG in.
      if (currentAnnotation.type === 'stamp') applyStampLineWidth(currentAnnotation);
      break;
    case 'opacity':
      // Bij een vorm met aparte vul-dekking houdt de vulling haar dekking (#685).
      zetLijnDekking(currentAnnotation, leesGeheelGetal(value) / 100);
      break;
    case 'icon': currentAnnotation.icon = value; break;
    case 'borderStyle': currentAnnotation.borderStyle = value; break;
    case 'cross': currentAnnotation.cross = value === true || undefined; break;
    case 'hatchPattern': currentAnnotation.hatchPattern = value; break;
    case 'hatchColor': currentAnnotation.hatchColor = value; break;
    case 'hatchScale': currentAnnotation.hatchScale = leesGeheelGetal(value); break;
    case 'hatchAngle': currentAnnotation.hatchAngle = leesGeheelGetal(value); break;
    case 'text': currentAnnotation.text = value; break;
    case 'fontSize': currentAnnotation.fontSize = leesGeheelGetal(value); break;
    case 'textColor':
      currentAnnotation.textColor = value;
      currentAnnotation.color = value;
      break;
    case 'fontFamily': currentAnnotation.fontFamily = value; break;
    case 'textFontSize': currentAnnotation.fontSize = leesGeheelGetal(value); break;
    case 'fontBold': currentAnnotation.fontBold = value; zetRunsStijl(currentAnnotation, 'bold', value); break;
    case 'fontItalic': currentAnnotation.fontItalic = value; zetRunsStijl(currentAnnotation, 'italic', value); break;
    case 'fontUnderline': currentAnnotation.fontUnderline = value; break;
    case 'fontStrikethrough': currentAnnotation.fontStrikethrough = value; break;
    case 'textAlign': currentAnnotation.textAlign = value; break;
    case 'lineSpacing': {
      currentAnnotation.lineSpacing = leesGetalBegin(value);
      // Resize textbox height to fit content with new line spacing
      if (['textbox', 'callout'].includes(currentAnnotation.type) && currentAnnotation.text) {
        currentAnnotation.height = computeTextboxContentHeight(currentAnnotation);
      }
      break;
    }
    case 'rotation': currentAnnotation.rotation = Math.max(-360, Math.min(360, leesGeheelGetal(value) || 0)); break;
    // Breedte/hoogte van een afbeelding: de getypte waarde staat in de
    // gekozen papiereenheid (mm, cm, in of pt, #598) en wordt paginapunten.
    // ELKE positieve waarde mag, met decimalen. Een tussenstand tijdens het
    // typen ("", "0", "0.") laat het model met rust. De partner-as volgt de
    // verhouding exact (#315) en is alleen technisch begrensd. De store krijgt
    // de maat in paginapunten, niet de getypte tekst.
    case 'imageWidth':
    case 'imageHeight': {
      const maat = nieuweAfbeeldingsMaat(key === 'imageWidth' ? 'width' : 'height',
        value, papierEenheid(), currentAnnotation);
      if (!maat) break;
      currentAnnotation.width = maat.width;
      currentAnnotation.height = maat.height;
      setAnnotProps({ imageWidth: maat.width, imageHeight: maat.height });
      break;
    }
    case 'imageRotation': currentAnnotation.rotation = leesGeheelGetal(value) || 0; break;
    case 'linkedPath': currentAnnotation.linkedPath = value || undefined; break;
    case 'tintColor': currentAnnotation.tintColor = value || undefined; break;
    case 'lockAspectRatio': {
      currentAnnotation.lockAspectRatio = value;
      const lockRatio = (value && currentAnnotation.type === 'image')
        ? veiligeVerhouding(currentAnnotation.originalWidth, currentAnnotation.originalHeight) : 0;
      if (lockRatio) {
        currentAnnotation.height = klemMaat(currentAnnotation.width / lockRatio);
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
      const pct = Math.max(0, Math.min(90, leesGetalBegin(value) || 0));
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
    case 'headSize': currentAnnotation.headSize = leesGeheelGetal(value); break;
    case 'measureScale':
      currentAnnotation.measureScale = leesGetalBegin(value) || 0;
      recomputeMeasureText(currentAnnotation);
      // Zonder eigen schaal volgt een meetvlak de eenheid van het document.
      if (currentAnnotation.type === 'measureArea') {
        setAnnotProps('measureUnit', lengteEenheid(currentAnnotation.measureUnit) || '');
      }
      break;
    case 'measureUnit':
      zetMeetEenheid(currentAnnotation, value);
      if (currentAnnotation.type === 'measureArea') setAnnotProps('measureScale', currentAnnotation.measureScale || 0);
      break;
    case 'measurePrecision': currentAnnotation.measurePrecision = leesGeheelGetal(value); recomputeMeasureText(currentAnnotation); break;
    case 'measureName':
      currentAnnotation.measureName = value;
      if (isRuimteVlak(currentAnnotation)) currentAnnotation.opsRuimteNaam = value;
      break;
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
      const newTotal = leesGetalBegin(value) || 1;
      currentAnnotation.totalUnits = newTotal;
      // pixelsPerUnit needs recalc: width stays the same, pixelsPerUnit = width / totalUnits
      currentAnnotation.pixelsPerUnit = currentAnnotation.width / newTotal;
      // Sync doc scale and recalculate all measurements
      syncDocScale(currentAnnotation);
      recalculateAllMeasurements();
      break;
    }
    case 'scaleBarDivisions': {
      currentAnnotation.divisions = Math.max(1, Math.min(20, leesGeheelGetal(value) || 5));
      break;
    }
    case 'scaleBarHeight': {
      currentAnnotation.height = _schaalbalkHoogte(value);
      setAnnotProps('scaleBarHeight', currentAnnotation.height);
      break;
    }
    // ── Stavenreeks ────────────────────────────────────────────────────
    // Alleen parameters; de reekslijn (start/eind) blijft ongemoeid. De
    // poten, punten en het label worden bij het renderen afgeleid.
    case 'srCount': {
      currentAnnotation.count = Math.max(1, Math.min(999, leesGeheelGetal(value) || 1));
      break;
    }
    case 'srDiameter': {
      currentAnnotation.diameter = leesGetalBegin(value) || 12;
      break;
    }
    case 'srBarLengthMm': {
      currentAnnotation.barLengthMm = Math.max(0, leesGetalBegin(value) || 0);
      break;
    }
    case 'srLegDir': {
      currentAnnotation.legDir = String(value || 'down-left');
      break;
    }
    case 'srLegLength': {
      currentAnnotation.legLength = Math.max(1, leesGetalBegin(value) || STAVENREEKS_DEFAULTS.legLength);
      break;
    }
    case 'srLineTail': {
      currentAnnotation.lineTail = _clampLineTail(value);
      break;
    }
    case 'srFontSize': {
      currentAnnotation.fontSize = _clampFontSize(value);
      break;
    }
    case 'srLabelSide': {
      currentAnnotation.labelSide = value === 'start' ? 'start' : 'end';
      break;
    }
    case 'scaleBarPixelsPerUnit': {
      const ppu = leesGetalBegin(value);
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
      const vpRatio = leesGeheelGetal(value);
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
      const real = leesGetalBegin(value);
      if (!(real > 0)) break;
      // Elke positieve waarde mag (ook kleiner dan de schermpixel-grens bij
      // slepen: die duwt een al kleiner gebied niet omhoog); alleen technisch
      // begrensd.
      const px = klemMaat(real * _scaleRegionPpu(currentAnnotation));
      if (key === 'scaleRegionWidth') currentAnnotation.width = px;
      else currentAnnotation.height = px;
      setAnnotProps(key, toonMaat(real));
      import('../../annotations/scale-region.js').then(m => m.invalidateScaleRegionCache());
      recalculateAllMeasurements();
      break;
    }
    case 'profielType':
      // Staalprofiel (#697): ander type, dichtstbijzijnde maat, kader op ware
      // grootte. Eén ongedaan-stap (recordPropertyChange hierboven); het
      // paneel toont daarna de velden van het nieuwe sjabloon.
      if (wisselProfielType(currentAnnotation, value)) storeShowProperties(currentAnnotation);
      break;
    case 'params': {
      // Parametric symbol params (from ParametricSymbolSection). Dynamic-block
      // behaviour: templates with a real-world size (steel profiles) resize
      // their bbox around the centre when a size-driving param changes.
      currentAnnotation.params = value;
      if (currentAnnotation.type === 'parametricSymbol') {
        // Keep geometry synchronous: recordPropertyChange captures newState in
        // a microtask, so endpoints/bbox must be final before this stack ends.
        applyTemplateRealSize(currentAnnotation, 'center');
      }
      break;
    }
    // Systeem: dezelfde helper als in applyPropToAnnotation — de default-tak
    // zou anders losse velden op de annotatie zetten i.p.v. type/registry of
    // ann.system te muteren. Na een TYPE-bewerking het paneel verversen zodat
    // de afgeleide waarden (celmaat, randprofiel, randstukken) meedraaien.
    case 'sgTypeId': case 'sgTypeCelX': case 'sgTypeCelY': case 'sgTypeEdge':
    case 'rasterHoek': case 'sgCentreer': case 'sgEdgeProfiel': case 'sgPaneelType':
    case 'sgPaneelComponent': case 'sgRandSegProfiel':
    case 'sgSparingB': case 'sgSparingH': case 'sgSparingX': case 'sgSparingY':
    case 'sgSparingToevoegen':
      _applySysteemProp(currentAnnotation, key, value);
      storeShowProperties(currentAnnotation);
      break;
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
      } else if ((key === 'width' || key === 'height') && RECHTHOEK_VORMEN.has(currentAnnotation.type)) {
        // Technische wacht op het schrijfpad van de zwevende B/H-invoer: nooit
        // nul, negatief of NaN in het model (elke positieve waarde mag wel).
        currentAnnotation[key] = klemMaat(value);
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

  if (!key.startsWith('tb') && !key.includes('.') && !_EIGEN_STORE_SLEUTELS.has(key)) {
    setAnnotProps(key, value);
  }
  // Een open tekst-editor toont een nieuw lettertype, een andere grootte of
  // kleur meteen (#765), zodat wat je typt al in de gekozen stijl staat.
  if (key === 'fontFamily' || key === 'textFontSize' || key === 'fontSize' || key === 'textColor') {
    const ann = currentAnnotation;
    import('../../tools/text-editing.js')
      .then(m => m.werkEditorStijlBij && m.werkEditorStijlBij(ann))
      .catch(() => {});
  }
  // Schaalgebied (#611): zonder eigen vulkleur of vul-doorzichtigheid volgt de
  // vulling de kleur en de doorzichtigheid; het paneel toont wat er staat.
  if (currentAnnotation.type === 'scaleRegion' && _SCHAALGEBIED_VULSLEUTELS.has(key)) {
    setAnnotProps({
      fillColor: schaalgebiedStijl(currentAnnotation).vulKleur,
      fillOpacity: _vulDoorzichtigheidPct(currentAnnotation),
    });
  }

  redraw();
}

const _SCHAALGEBIED_VULSLEUTELS = new Set(['color', 'opacity', 'fillColor', 'fillOpacity']);

// Vul-doorzichtigheid in procenten voor het paneel. Een schaalgebied zonder
// eigen waarde toont wat er getekend wordt (10 % van de doorzichtigheid); een
// andere soort zonder eigen waarde vult op zijn doorzichtigheid.
function _vulDoorzichtigheidPct(a) {
  if (a?.type === 'scaleRegion') return Math.round(schaalgebiedStijl(a).vulAlfa * 100);
  const v = a?.fillOpacity ?? a?.opacity ?? 1;
  return Math.round(v * 100);
}

function _vulDoorzichtigheidUitPct(value) {
  const n = leesGeheelGetal(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : undefined;
}

// Sleutels waarvan de case hierboven zelf de store bijwerkt (in paginapunten)
// in plaats van de getypte tekst in de gekozen eenheid (#598).
const _EIGEN_STORE_SLEUTELS = new Set(['imageWidth', 'imageHeight', 'scaleBarHeight']);

/** Kleinste balkhoogte van een schaalbalk, paginapunten. */
export const SCHAALBALK_MIN_HOOGTE_PT = 4;

// Balkhoogte in paginapunten (het paneel rekent de gekozen papiereenheid al
// om, #598). Decimalen blijven staan: 5 mm is 14,17 pt, niet 14.
function _schaalbalkHoogte(value) {
  const n = typeof value === 'number' ? value : leesGetalBegin(value ?? '');
  if (!Number.isFinite(n) || n <= 0) return 14;
  return Math.max(SCHAALBALK_MIN_HOOGTE_PT, n);
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
  let finalValue = leesGeheelGetal(value);
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

export function hideToolDefaults() {
  if (currentAnnotation?.id !== '__tool-defaults__') return false;
  storeHideProperties();
  return true;
}

// Show the properties panel populated with the current style defaults for
// the active drawing tool. Builds a SYNTHETIC annotation tagged with id
// '__tool-defaults__' so the rest of the panel pipeline treats it like a
// normal selection — but no real annotation is created or modified.
// Edits made by the user via panel inputs update the synthetic object for
// visual feedback; persistent default changes still flow through the
// Format ribbon's `setAsDefaultStyle` path.
export async function showToolDefaults(toolName, overrides = {}, shouldShow = null) {
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

  if (typeof shouldShow === 'function' && !shouldShow()) return false;
  Object.assign(synthetic, overrides);
  storeShowProperties(synthetic);
  return true;
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
