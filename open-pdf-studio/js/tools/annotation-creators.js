import { huidigeSymboolSchaal } from '../symbols/symbol-scale-store.js';
import { schaalVakOmMidden } from '../symbols/symbol-scale.js';
import { state, getActiveDocument } from '../core/state.js';
import { getColorPickerValue, getLineWidthValue } from '../bridge.js';
import { createAnnotation } from '../annotations/factory.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, snapDistanceTo10 } from '../annotations/measurement.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { applyDynamicScaling } from '../annotations/dynamic-scaling.js';
import { getTemplate } from '../symbols/registry.js';
import { pxPerMmAt } from '../symbols/real-size.js';
import { syncTwoPointGeometry, syncTwoPointLengthParam } from '../symbols/two-point.js';
import { pendingParams, pendingSymbolId } from '../solid/stores/parametricSymbolStore.js';
import { activeCountCategory as _activeCountCategory, nextCountNumber as _nextCountNumber } from '../solid/stores/countStore.js';
import { ifcCategoryForParametric, ifcCategoryForAnnotationType } from '../solid/data/ifcCategoryMap.js';
import { STAVENREEKS_DEFAULTS } from '../annotations/stavenreeks.js';
import { BETONBALK_DEFAULTS } from '../annotations/betonbalk.js';
import { betonbalkLastProfiel } from '../solid/stores/betonbalkStore.js';
import { labelFontSizeAt } from '../annotations/drafting-rules.js';
import { isKlikSleep, klemMaat, schermPxNaarPt, KLIK_DREMPEL_PX } from '../annotations/minimummaat.js';
import { getEffectiveScale } from './effective-scale.js';
import { randkleurenUitVoorkeur } from '../annotations/fill-utils.js';

/**
 * Build raw annotation properties from tool + coordinates.
 * Shared by both preview rendering and final annotation creation.
 * Does NOT call createAnnotation() — returns a plain props object.
 * Does NOT validate minimum size — preview needs to render at any size.
 */
export function buildAnnotationProps(tool, startX, startY, endX, endY, e) {
  const prefs = state.preferences;
  const o = state.toolOverrides || {};

  // Helpers
  function snap(sx, sy, ex, ey) {
    if (e?.shiftKey && prefs.enableAngleSnap) {
      const dx = ex - sx, dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = snapAngle(Math.atan2(dy, dx) * (180 / Math.PI), prefs.angleSnapDegrees) * (Math.PI / 180);
      return { x: sx + len * Math.cos(ang), y: sy + len * Math.sin(ang) };
    }
    return { x: ex, y: ey };
  }

  function bbox(sx, sy, ex, ey) {
    // Genormaliseerd (linksboven + positieve maat) en nooit nul: een sleep
    // langs precies één as geeft de technische ondergrens, geen breedte 0.
    return {
      x: Math.min(sx, ex), y: Math.min(sy, ey),
      width: klemMaat(Math.abs(ex - sx)), height: klemMaat(Math.abs(ey - sy))
    };
  }

  // Klik of sleep is een schermbegrip: reken in schermpixels (px / zoom), zodat
  // ingezoomd ook een heel kleine sleep een echte sleep is.
  const isKlik = (dx, dy) => isKlikSleep(dx, dy, getEffectiveScale());

  switch (tool) {
    case 'draw':
      if (state.currentPath.length > 1) {
        // Ribbon values take precedence so the live color/width pickers in the
        // Comment tab actually drive the freehand stroke. prefs.* serves as the
        // fallback default applied at startup to seed the ribbon signals.
        const _drawColor = getColorPickerValue() || prefs.drawStrokeColor || '#000000';
        const _drawWidth = getLineWidthValue() || prefs.drawLineWidth || 2;
        return {
          type: 'draw',
          page: getActiveDocument()?.currentPage || 1,
          path: state.currentPath,
          color: _drawColor,
          strokeColor: _drawColor,
          lineWidth: _drawWidth,
          opacity: (prefs.drawOpacity || 100) / 100
        };
      }
      return null;

    case 'highlight': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'highlight',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: prefs.highlightColor || getColorPickerValue(),
        fillColor: prefs.highlightColor || getColorPickerValue()
      };
    }

    case 'line': {
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'line',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.lineStrokeColor || getColorPickerValue(),
        strokeColor: prefs.lineStrokeColor || getColorPickerValue(),
        lineWidth: prefs.lineLineWidth || getLineWidthValue(),
        borderStyle: prefs.lineBorderStyle || 'solid',
        opacity: (prefs.lineOpacity || 100) / 100
      };
    }

    case 'wall': {
      // Plan-view wall segment: line-like geometry + real-world thickness +
      // material hatch. Material/dikte come from the palette via
      // toolOverrides; black by default like all NL drafting components.
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'wall',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        dikteMm: o.wallDikteMm || 100,
        hatchPattern: o.wallPattern || 'nen47-metselwerk-baksteen',
        isolatieType: o.wallIsolatieType || undefined,
        // Every wall is an IfcWall unless the palette entry says otherwise
        // (quantities, IFC export and the properties panel read this field).
        ifcCategory: o.ifcCategory || ifcCategoryForAnnotationType('wall'),
        // hatchScale intentionally NOT set: the material's own density
        // (WALL_MATERIALS.dens) applies unless the user overrides it.
        color: '#000000',
        strokeColor: '#000000',
        lineWidth: 0.7,
        opacity: 1,
      };
    }

    case 'betonbalk': {
      // Betonbalk: lijnstuk-geometrie (zoals de wand) + doorsnede in mm.
      // De laatst gekozen doorsnede (paneel-keuzelijst) geldt als
      // voorinstelling; toolOverrides kunnen haar per activatie overschrijven.
      const end = snap(startX, startY, endX, endY);
      const profiel = betonbalkLastProfiel();
      return {
        type: 'betonbalk',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        breedteMm: o.betonbalkBreedteMm ?? profiel.breedteMm ?? BETONBALK_DEFAULTS.breedteMm,
        hoogteMm: o.betonbalkHoogteMm ?? profiel.hoogteMm ?? BETONBALK_DEFAULTS.hoogteMm,
        lijnstijl: o.betonbalkLijnstijl ?? BETONBALK_DEFAULTS.lijnstijl,
        toonHartlijn: BETONBALK_DEFAULTS.toonHartlijn,
        tagTonen: BETONBALK_DEFAULTS.tagTonen,
        // Tag-teksthoogte ('labels') uit het tekeningtype op het
        // plaatsingspunt; component-default als terugval. Bij plaatsing
        // gestempeld (zie stavenreeks-fontSize hieronder voor de reden).
        tagFontSize: labelFontSizeAt(
          getActiveDocument()?.currentPage || 1, startX, startY,
          BETONBALK_DEFAULTS.tagFontSize,
        ),
        ifcCategory: ifcCategoryForAnnotationType('betonbalk'),
        // NL constructie-componenten zijn standaard ZWART, net als wand en
        // stavenreeks; herkleuren kan achteraf in het eigenschappen-paneel.
        color: '#000000',
        strokeColor: '#000000',
        // Tekenwerkcomponent: GEEN lineWidth stempelen — de lijndikte erft
        // live uit het tekeningtype van het schaalgebied (annotations/
        // drafting-rules.js), met DRAFTING_LINE_WIDTH als vaste terugval.
        // Een via het paneel gezette waarde wordt de "eigen instelling".
        opacity: 1,
      };
    }

    case 'arrow': {
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'arrow',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.arrowStrokeColor || getColorPickerValue(),
        strokeColor: prefs.arrowStrokeColor || getColorPickerValue(),
        fillColor: prefs.arrowFillColor || prefs.arrowStrokeColor || getColorPickerValue(),
        lineWidth: prefs.arrowLineWidth || getLineWidthValue(),
        borderStyle: prefs.arrowBorderStyle || 'solid',
        // Default both ends to 'open' arrowhead — most users drawing the
        // "arrow" tool want a double-headed dimension/marker arrow.
        // Single-head is a one-keystroke change in the properties panel.
        startHead: prefs.arrowStartHead || 'open',
        endHead: prefs.arrowEndHead || 'open',
        headSize: prefs.arrowHeadSize || 8,
        opacity: (prefs.arrowOpacity || 100) / 100,
        ...o
      };
    }

    case 'circle': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'circle',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        ...randkleurenUitVoorkeur(prefs, 'circle', 'circle'),
        fillColor: prefs.circleFillNone ? null : prefs.circleFillColor,
        lineWidth: prefs.circleBorderWidth,
        borderStyle: prefs.circleBorderStyle,
        opacity: prefs.circleOpacity / 100,
        ...o
      };
    }

    case 'ellipse': {
      // Free oval (no 1:1 constraint). Stored as a 'circle'-type annotation so
      // rendering/editing/saving all work unchanged; just fainter by default so
      // it reads as a lighter ellipse next to the solid circle.
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'circle',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        ...randkleurenUitVoorkeur(prefs, 'circle', 'circle'),
        fillColor: prefs.circleFillNone ? null : prefs.circleFillColor,
        lineWidth: prefs.circleBorderWidth,
        borderStyle: prefs.circleBorderStyle,
        opacity: (prefs.circleOpacity / 100) * 0.5,
        ...o
      };
    }

    case 'box': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'box',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        ...randkleurenUitVoorkeur(prefs, 'rect', 'box'),
        fillColor: prefs.rectFillNone ? null : prefs.rectFillColor,
        lineWidth: prefs.rectBorderWidth,
        borderStyle: prefs.rectBorderStyle,
        opacity: prefs.rectOpacity / 100,
        ...o
      };
    }

    case 'mask': {
      // Maskeer (wipeout): opaque white patch that hides whatever lies
      // underneath (page content AND annotations drawn before it). Fixed
      // style by design — white fill, thin dash-dot frame, full opacity.
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'mask',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: '#9a9a9a',
        strokeColor: '#9a9a9a',
        fillColor: '#ffffff',
        lineWidth: 0.75,
        borderStyle: 'dash-dot',
        opacity: 1,
        ...o
      };
    }

    case 'polygon':
      return {
        type: 'polygon',
        page: getActiveDocument()?.currentPage || 1,
        // Genormaliseerd: naar links/boven slepen gaf een negatieve maat, en
        // daar kunnen raaktest, ruimtelijke index en opslaan niet mee overweg.
        ...bbox(startX, startY, endX, endY),
        sides: 6,
        ...randkleurenUitVoorkeur(prefs, 'polygon', 'polygon', getColorPickerValue()),
        lineWidth: prefs.polygonLineWidth || getLineWidthValue(),
        opacity: (prefs.polygonOpacity || 100) / 100
      };

    case 'lshape': {
      // L-shaped outline drawn as a closed polyline. The drag defines the
      // bounding box; the L fills it with a fixed-ratio notch cut from the
      // top-right. Stored as a 'polyline' so rendering / editing / saving all
      // work unchanged; the first point is repeated at the end so the outline
      // closes visually (the polyline renderer strokes the raw point list).
      const b = bbox(startX, startY, endX, endY);
      const x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
      const armW = b.width * 0.45;   // vertical arm width (left)
      const armH = b.height * 0.45;  // horizontal arm height (bottom)
      const pts = [
        { x: x0, y: y0 },              // top-left
        { x: x0 + armW, y: y0 },       // top of vertical arm
        { x: x0 + armW, y: y1 - armH },// inner corner
        { x: x1, y: y1 - armH },       // top of horizontal arm (right)
        { x: x1, y: y1 },              // bottom-right
        { x: x0, y: y1 },              // bottom-left
        { x: x0, y: y0 },              // close back to start
      ];
      return {
        type: 'polyline',
        page: getActiveDocument()?.currentPage || 1,
        points: pts,
        x: x0, y: y0, width: b.width, height: b.height,
        ...randkleurenUitVoorkeur(prefs, 'polygon', 'polyline', getColorPickerValue()),
        lineWidth: prefs.polygonLineWidth || getLineWidthValue(),
        borderStyle: 'solid',
        opacity: (prefs.polygonOpacity || 100) / 100,
        ...o
      };
    }

    case 'cloud': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'cloud',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        ...randkleurenUitVoorkeur(prefs, 'cloud', 'cloud', getColorPickerValue()),
        lineWidth: prefs.cloudLineWidth || getLineWidthValue(),
        opacity: (prefs.cloudOpacity || 100) / 100
      };
    }

    case 'textbox': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'textbox',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        text: '',
        ...randkleurenUitVoorkeur(prefs, 'textbox', 'textbox'),
        fillColor: prefs.textboxFillNone ? 'none' : prefs.textboxFillColor,
        textColor: '#000000',
        fontSize: prefs.textboxFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.textboxBorderWidth,
        borderStyle: prefs.textboxBorderStyle,
        opacity: (prefs.textboxOpacity || 100) / 100
      };
    }

    case 'callout': {
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = endX - defaultWidth / 2;
      const coY = endY - defaultHeight / 2;
      const boxCenterX = endX;
      const isArrowLeft = startX < boxCenterX;
      const armOriginX = isArrowLeft ? coX : coX + defaultWidth;
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, endY));
      const armLength = Math.min(30, Math.abs(startX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      const kneeY = armOriginY;
      return {
        type: 'callout',
        page: getActiveDocument()?.currentPage || 1,
        x: coX, y: coY,
        width: defaultWidth, height: defaultHeight,
        arrowX: startX, arrowY: startY,
        kneeX, kneeY,
        armOriginX, armOriginY,
        text: '',
        ...randkleurenUitVoorkeur(prefs, 'callout', 'callout'),
        fillColor: prefs.calloutFillNone ? 'none' : prefs.calloutFillColor,
        textColor: '#000000',
        fontSize: prefs.calloutFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.calloutBorderWidth,
        borderStyle: prefs.calloutBorderStyle,
        opacity: (prefs.calloutOpacity || 100) / 100
      };
    }

    case 'redaction': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'redaction',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        overlayColor: prefs.redactionOverlayColor
      };
    }

    case 'measureDistance': {
      let end = snap(startX, startY, endX, endY);
      if (e?.ctrlKey) end = snapDistanceTo10(startX, startY, end.x, end.y);
      const currentPage = getActiveDocument()?.currentPage || 1;
      const dist = calculateDistance(startX, startY, end.x, end.y, currentPage);
      return {
        type: 'measureDistance',
        page: currentPage,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.measureDistStrokeColor,
        strokeColor: prefs.measureDistStrokeColor,
        lineWidth: prefs.measureDistLineWidth,
        borderStyle: prefs.measureDistBorderStyle || 'solid',
        opacity: (prefs.measureDistOpacity || 100) / 100,
        measureText: formatMeasurement(dist),
        measureValue: dist.value,
        measureUnit: dist.unit,
        measurePixels: dist.pixels
      };
    }

    case 'parametricSymbol': {
      const symbolId = pendingSymbolId() || 'door';
      const template = getTemplate(symbolId);
      if (!template) return null;
      const page = getActiveDocument()?.currentPage || 1;
      const params = pendingParams();

      if (template?.placement === 'two-point') {
        const snappedEnd = snap(startX, startY, endX, endY);
        let pointEndX = snappedEnd.x;
        let pointEndY = snappedEnd.y;
        const k = pxPerMmAt(page, startX, startY);
        const realSize = typeof template.realSizeMm === 'function'
          ? template.realSizeMm(params) : null;
        const bandHeight = (realSize?.height > 0
          ? realSize.height * k
          : (template.defaultSize?.height || 48)) * huidigeSymboolSchaal();
        if (isKlik(pointEndX - startX, pointEndY - startY)) {
          const defaultLength = realSize?.width > 0
            ? realSize.width * k
            : (template.defaultSize?.width || 320);
          pointEndX = startX + defaultLength;
          pointEndY = startY;
        }
        const annotation = {
          type: 'parametricSymbol',
          page,
          symbolId,
          params,
          ifcCategory: ifcCategoryForParametric(symbolId),
          color: '#000000',
          strokeColor: '#000000',
          // Lijndikte erft uit het tekeningtype (drafting-rules.js);
          // terugval DRAFTING_LINE_WIDTH. Bewust niet gestempeld.
          opacity: 1,
        };
        syncTwoPointGeometry(
          annotation, startX, startY, pointEndX, pointEndY, bandHeight,
        );
        syncTwoPointLengthParam(annotation, k);
        return annotation;
      }

      const symboolSchaal = huidigeSymboolSchaal();
      let b = bbox(startX, startY, endX, endY);
      // Click (no real drag): use the template's defaultSize — or, for
      // templates with a real-world size (steel profiles), the REAL
      // dimensions at the click point (scale-region aware), centred on the
      // click like a CAD block insert.
      // Drempel in SCHERMPIXELS (px / zoom) in plaats van 5 paginapunten:
      // ingezoomd mag het gesleepte kader dus zo klein zijn als je wilt. Een
      // symboolkader heeft beide assen nodig, dus een sleep die op één as
      // binnen de klikdrempel blijft (slordige klik) telt nog als klik.
      const klikGrens = schermPxNaarPt(KLIK_DREMPEL_PX, getEffectiveScale());
      const geklikt = Math.abs(endX - startX) < klikGrens || Math.abs(endY - startY) < klikGrens;
      if (geklikt) {
        const mm = typeof template?.realSizeMm === 'function'
          ? template.realSizeMm(params) : null;
        if (mm && mm.height > 0) {
          const k = pxPerMmAt(page, startX, startY);
          const hPx = mm.height * k;
          // width null = free-length beam view → seed 4× the band height.
          const wPx = mm.width > 0 ? mm.width * k : hPx * 4;
          b = {
            x: startX - wPx / 2,
            y: startY - hPx / 2,
            width: wPx,
            height: hPx,
          };
        } else {
          const ds = (template && template.defaultSize) || { width: 80, height: 80 };
          b = { x: startX, y: startY, width: ds.width, height: ds.height };
        }
      }
      // Gekozen symboolschaal (issue #357). Alleen bij een KLIK: heeft de
      // gebruiker een kader gesleept, dan is dat de maat die hij bedoelde.
      if (geklikt) b = schaalVakOmMidden(b, symboolSchaal);

      // NL drafting components are BLACK by default (independent of the
      // current colour-picker swatch); recolour afterwards via the panel.
      return {
        type: 'parametricSymbol',
        page,
        ...b,
        symbolId,
        params,
        // IFC-categorie afgeleid van het template-id (mapping-laag) → hoeveelheden.
        ifcCategory: ifcCategoryForParametric(symbolId),
        color: '#000000',
        strokeColor: '#000000',
        // Lijndikte erft uit het tekeningtype (drafting-rules.js);
        // terugval DRAFTING_LINE_WIDTH. Bewust niet gestempeld.
        rotation: 0,
        opacity: 1,
      };
    }

    case 'stavenreeks': {
      // Wapeningsstaven-reeks: de sleep bepaalt richting + lengte van de
      // reekslijn. Alle overige geometrie (poten, punten, label) wordt bij het
      // renderen afgeleid uit deze vier coördinaten — er is bewust GEEN
      // rotation-veld (voorkomt de rotatie-regressieklasse).
      const end = snap(startX, startY, endX, endY);
      let sEndX = end.x, sEndY = end.y;
      // Klik zonder sleep: standaardlengte van 120 px horizontaal naar rechts.
      if (isKlik(sEndX - startX, sEndY - startY)) {
        sEndX = startX + 120;
        sEndY = startY;
      }
      // NL constructie-componenten zijn standaard ZWART, net als de wand- en
      // symbool-tools; herkleuren kan achteraf in het eigenschappen-paneel.
      return {
        type: 'stavenreeks',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: sEndX, endY: sEndY,
        count: o.stavenreeksCount ?? STAVENREEKS_DEFAULTS.count,
        diameter: o.stavenreeksDiameter ?? STAVENREEKS_DEFAULTS.diameter,
        barLengthMm: o.stavenreeksBarLengthMm ?? STAVENREEKS_DEFAULTS.barLengthMm,
        legDir: o.stavenreeksLegDir ?? STAVENREEKS_DEFAULTS.legDir,
        legLength: o.stavenreeksLegLength ?? STAVENREEKS_DEFAULTS.legLength,
        lineTail: o.stavenreeksLineTail ?? STAVENREEKS_DEFAULTS.lineTail,
        // Label-teksthoogte: override → anders de 'labels'-teksthoogte uit
        // het tekeningtype op het plaatsingspunt (drafting-rules.js), met de
        // component-default als laatste terugval. Bij plaatsing gestempeld
        // zodat render, hit-test en saver dezelfde maat zien.
        fontSize: o.stavenreeksFontSize
          ?? labelFontSizeAt(getActiveDocument()?.currentPage || 1, startX, startY,
                             STAVENREEKS_DEFAULTS.fontSize),
        labelSide: o.stavenreeksLabelSide ?? STAVENREEKS_DEFAULTS.labelSide,
        ifcCategory: ifcCategoryForAnnotationType('stavenreeks'),
        color: '#000000',
        strokeColor: '#000000',
        // Lijndikte erft uit het tekeningtype (drafting-rules.js);
        // terugval DRAFTING_LINE_WIDTH. Bewust niet gestempeld.
        opacity: 1,
      };
    }

    case 'count': {
      const cat = _activeCountCategory();
      const n = _nextCountNumber(cat?.id);
      return {
        type: 'count',
        page: getActiveDocument()?.currentPage || 1,
        x: startX, y: startY,
        categoryId: cat?.id || null,
        number: n,
        markerStyle: cat?.markerStyle || 'dot',
        symbolId: cat?.symbolId,
        color: cat?.color || '#e11d48',
        strokeColor: cat?.color || '#e11d48',
        opacity: 1,
      };
    }

    case 'viewport': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'viewport',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        name: 'Viewport',
        scaleRatio: '1:100',
        pixelsPerUnit: 0.02835,
        unit: 'mm',
        color: '#0066cc',
        lineWidth: 1.5,
        opacity: 0.6,
      };
    }

    default: {
      const typeHandler = getAnnotationType(tool);
      if (typeHandler && typeHandler.create) {
        const ann = typeHandler.create(startX, startY, endX, endY, e, state);
        if (ann) return { ...ann, page: getActiveDocument()?.currentPage || 1, ...o };
      }
      return null;
    }
  }
}

function finalizeAnnotation(tool, props) {
  if (!props) return null;

  // Geen ondergrens in paginapunten meer voor wolk (was 10 pt: een wolk van
  // 8 x 100 pt verviel stil) en redactiemarkering (was 5 pt: een smalle strook
  // over een dunne lijn moet kunnen). De vormen-tool heeft de echte
  // "geen sleep"-situatie al in schermpixels afgevangen.
  //
  // Tekstvak: er moet tekst in passen. In plaats van stil te vervallen valt
  // een te klein gesleept vak terug op de standaardmaat van een klik; de
  // grens volgt de schermpixel-klikdrempel, niet een vast aantal punten.
  if (tool === 'textbox') {
    const grens = schermPxNaarPt(KLIK_DREMPEL_PX, getEffectiveScale());
    if (props.width < grens) props.width = 100;
    if (props.height < grens) props.height = 20;
  }

  if (tool === 'draw') {
    state.currentPath = [];
  }

  // Dynamic scaling: adjust line width, font size, etc. based on viewport
  const pageNum = props.page || getActiveDocument()?.currentPage || 1;
  const annX = props.x ?? props.startX ?? 0;
  const annY = props.y ?? props.startY ?? 0;
  applyDynamicScaling(props, pageNum, annX, annY);

  return createAnnotation(props);
}

export function createAnnotationFromTool(tool, startX, startY, endX, endY, e) {
  return finalizeAnnotation(tool, buildAnnotationProps(tool, startX, startY, endX, endY, e));
}

export function createContinuousAnnotation(tool, pageNum, startX, startY, endX, endY) {
  const props = buildAnnotationProps(tool, startX, startY, endX, endY, null);
  if (props) props.page = pageNum;
  return finalizeAnnotation(tool, props);
}

export function createMeasureAreaAnnotation(points, holes) {
  const mPrefs = state.preferences;
  const annProps = {
    type: 'measureArea',
    page: getActiveDocument()?.currentPage || 1,
    points,
    ...randkleurenUitVoorkeur(mPrefs, 'measureArea', 'measureArea'),
    lineWidth: mPrefs.measureAreaLineWidth,
    opacity: (mPrefs.measureAreaOpacity || 100) / 100,
    fillColor: mPrefs.measureAreaFillNone ? null : (mPrefs.measureAreaFillColor || null),
    borderStyle: mPrefs.measureAreaBorderStyle || 'dashed',
    hatchPattern: mPrefs.measureAreaHatchPattern || 'diagonal-left',
    hatchColor: mPrefs.measureAreaHatchColor || '#ff0000',
    hatchScale: mPrefs.measureAreaHatchScale ?? 100,
  };
  // Store holes if provided
  if (holes && holes.length > 0) {
    annProps.holes = holes;
  }
  // Always use calculateArea (which resolves scale from scaleBar / document / prefs)
  // followed by formatMeasurement (which auto-converts mm² → m²).
  const currentPage = getActiveDocument()?.currentPage || 1;
  const area = calculateArea(points, holes, currentPage);
  annProps.measureText = formatMeasurement(area);
  annProps.measureValue = area.value;
  annProps.measureUnit = area.unit;
  if (mPrefs.measureAreaDimPrecision != null) {
    annProps.measurePrecision = mPrefs.measureAreaDimPrecision;
  }
  applyDynamicScaling(annProps, currentPage, points[0]?.x || 0, points[0]?.y || 0);
  return createAnnotation(annProps);
}

export function createMeasurePerimeterAnnotation(points) {
  const mPrefs = state.preferences;
  const perimProps = {
    type: 'measurePerimeter',
    page: getActiveDocument()?.currentPage || 1,
    points,
    color: mPrefs.measurePerimStrokeColor,
    strokeColor: mPrefs.measurePerimStrokeColor,
    lineWidth: mPrefs.measurePerimLineWidth,
    opacity: (mPrefs.measurePerimOpacity || 100) / 100,
    borderStyle: mPrefs.measurePerimBorderStyle || 'dashed',
    startHead: mPrefs.measurePerimStartHead || 'none',
    endHead: mPrefs.measurePerimEndHead || 'none',
    headSize: mPrefs.measurePerimHeadSize || 12,
  };
  const currentPage = getActiveDocument()?.currentPage || 1;
  // Scale regions count as a scale source too — measurements inside one must
  // inherit its scale instead of the manual preference scale.
  const hasScaleSource = getActiveDocument()?.annotations?.some(a => a.type === 'scaleRegion' || a.type === 'scaleBar' || a.type === 'viewport');
  if (!hasScaleSource && mPrefs.measurePerimDimScale && typeof mPrefs.measurePerimDimScale === 'number') {
    perimProps.measureScale = mPrefs.measurePerimDimScale;
    perimProps.measureUnit = mPrefs.measurePerimDimUnit || 'mm';
    perimProps.measurePrecision = mPrefs.measurePerimDimPrecision ?? 2;
    const pixelPerim = calculatePerimeter(points, currentPage).pixels;
    const scaledPerim = pixelPerim * mPrefs.measurePerimDimScale;
    const unit = mPrefs.measurePerimDimUnit || 'mm';
    const prec = mPrefs.measurePerimDimPrecision ?? 2;
    perimProps.measureText = `${scaledPerim.toFixed(prec)} ${unit}`;
    perimProps.measureValue = scaledPerim;
    perimProps.measureUnit = unit;
  } else {
    const perim = calculatePerimeter(points, currentPage);
    perimProps.measureText = formatMeasurement(perim);
    perimProps.measureValue = perim.value;
    perimProps.measureUnit = perim.unit;
  }
  applyDynamicScaling(perimProps, currentPage, points[0]?.x || 0, points[0]?.y || 0);
  return createAnnotation(perimProps);
}
