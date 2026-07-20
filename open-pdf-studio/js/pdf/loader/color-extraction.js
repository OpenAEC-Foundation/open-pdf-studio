import { PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { pdfNum, pdfColorToHex, mapPdfFontName, inflateBytes } from './pdf-helpers.js';

// Extract colors (IC, appearance stream) from annotations using pdf-lib
// Returns Map<rectKey, { ic, apStrokeColor }> where ic = Interior Color hex, apStrokeColor = stroke from appearance stream
export async function extractAnnotationColors(pageNum, pdfDoc) {
  const colorMap = new Map();
  try {
    const page = pdfDoc.getPages()[pageNum - 1];
    if (!page) return colorMap;
    const context = pdfDoc.context;
    const annotsRaw = page.node.get(PDFName.of('Annots'));
    if (!annotsRaw) return colorMap;
    const annots = context.lookup(annotsRaw);
    if (!annots) return colorMap;

    for (let i = 0; i < annots.size(); i++) {
      const annotDict = context.lookup(annots.get(i));
      if (!annotDict) continue;
      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (!subtype) continue;
      const subtypeName = subtype.toString();

      // Get rect key for matching
      const rectRaw = annotDict.get(PDFName.of('Rect'));
      if (!rectRaw) continue;
      const rect = context.lookup(rectRaw);
      if (!rect || typeof rect.size !== 'function') continue;
      const key = `${pdfNum(rect.get(0))},${pdfNum(rect.get(1))},${pdfNum(rect.get(2))},${pdfNum(rect.get(3))}`;

      const colors = {};

      // Read /CA (opacity) entry for ALL annotation types - PDF.js doesn't always expose this
      const caRaw = annotDict.get(PDFName.of('CA'));
      if (caRaw) {
        const caVal = pdfNum(context.lookup(caRaw) || caRaw);
        if (caVal !== null && caVal >= 0 && caVal <= 1) {
          colors.opacity = caVal;
        }
      }

      // Read /BE (border effect) — { /S /C } = cloudy border ("wolkjes", zoals
      // externe editors om FreeText-ballonnen en Squares zetten). PDF.js
      // exposeert dit niet.
      const beRaw = annotDict.get(PDFName.of('BE'));
      if (beRaw) {
        const be = context.lookup(beRaw) || beRaw;
        if (be && typeof be.get === 'function') {
          const beS = be.get(PDFName.of('S'));
          const beSName = beS ? String(context.lookup(beS) || beS) : '';
          if (beSName === '/C') {
            colors.borderCloudy = true;
            const beI = be.get(PDFName.of('I'));
            const iv = beI !== undefined ? pdfNum(context.lookup(beI) || beI) : null;
            if (iv !== null) colors.cloudIntensity = iv;
          }
        }
      }

      // Read stamp-specific entries (PDF.js doesn't expose /Name for stamps)
      if (subtypeName === '/Stamp') {
        const nameRaw = annotDict.get(PDFName.of('Name'));
        if (nameRaw) {
          const n = context.lookup(nameRaw) || nameRaw;
          const nameStr = n.toString().replace('/', '');
          if (nameStr) colors.stampPdfName = nameStr;
        }
        const opsNameRaw = annotDict.get(PDFName.of('OPS_StampName'));
        if (opsNameRaw) {
          const on = context.lookup(opsNameRaw) || opsNameRaw;
          if (on && typeof on.value === 'string') colors.stampName = on.value;
          else if (on && typeof on.decodeText === 'function') colors.stampName = on.decodeText();
        }
        // Read /OPS_CropLeft.. (non-destructive image crop, fractions 0-1
        // per side — issue #212). The AP embeds the FULL bitmap, so these
        // fractions re-apply the crop after the image round-trips.
        for (const [pdfKey, prop] of [
          ['OPS_CropLeft', 'cropLeft'], ['OPS_CropTop', 'cropTop'],
          ['OPS_CropRight', 'cropRight'], ['OPS_CropBottom', 'cropBottom'],
        ]) {
          const cRaw = annotDict.get(PDFName.of(pdfKey));
          if (cRaw) {
            const cv = pdfNum(context.lookup(cRaw) || cRaw);
            if (cv !== null && cv > 0 && cv < 1) colors[prop] = cv;
          }
        }
        // Word-style image adjustments (grayscale / brightness / contrast).
        const gsRaw = annotDict.get(PDFName.of('OPS_Grayscale'));
        if (gsRaw) {
          const gv = context.lookup(gsRaw) || gsRaw;
          if (gv === true || (gv && typeof gv.value === 'boolean' && gv.value)) colors.grayscale = true;
        }
        for (const [pdfKey, prop] of [['OPS_Brightness', 'brightness'], ['OPS_Contrast', 'contrast']]) {
          const aRaw = annotDict.get(PDFName.of(pdfKey));
          if (aRaw) {
            const av = pdfNum(context.lookup(aRaw) || aRaw);
            if (av !== null && av >= 0 && av !== 1) colors[prop] = av;
          }
        }
      }

      // Read /OPS_Rotation (our custom rotation key) for ALL annotation types
      const opsRotRaw = annotDict.get(PDFName.of('OPS_Rotation'));
      if (opsRotRaw) {
        const rv = pdfNum(context.lookup(opsRotRaw) || opsRotRaw);
        if (rv !== null) colors.rotation = rv;
      }

      // Read /OPS_HeadSize (our custom arrowhead size for dimension annotations)
      const opsHsRaw = annotDict.get(PDFName.of('OPS_HeadSize'));
      if (opsHsRaw) {
        const hs = pdfNum(context.lookup(opsHsRaw) || opsHsRaw);
        if (hs !== null) colors.opsHeadSize = hs;
      }

      // Read /OPS_Precision (our custom decimal precision for measurement annotations)
      const opsPrecRaw = annotDict.get(PDFName.of('OPS_Precision'));
      if (opsPrecRaw) {
        const prec = pdfNum(context.lookup(opsPrecRaw) || opsPrecRaw);
        if (prec !== null) colors.opsPrecision = prec;
      }

      // Read /OPS_TextOffsetX/Y (user-dragged dimension-text offset from the
      // dimension-line midpoint, stored in the visual annotation frame)
      const opsToxRaw = annotDict.get(PDFName.of('OPS_TextOffsetX'));
      if (opsToxRaw) {
        const tox = pdfNum(context.lookup(opsToxRaw) || opsToxRaw);
        if (tox !== null) colors.opsTextOffsetX = tox;
      }
      const opsToyRaw = annotDict.get(PDFName.of('OPS_TextOffsetY'));
      if (opsToyRaw) {
        const toy = pdfNum(context.lookup(opsToyRaw) || opsToyRaw);
        if (toy !== null) colors.opsTextOffsetY = toy;
      }

      // Read /OPS_Subtype (our custom subtype for cloud/cloudPolyline/measurements)
      const opsSubRaw = annotDict.get(PDFName.of('OPS_Subtype'));
      if (opsSubRaw) {
        const sub = context.lookup(opsSubRaw) || opsSubRaw;
        if (sub && typeof sub.value === 'string') {
          colors.opsSubtype = sub.value;
        } else if (sub && typeof sub.decodeText === 'function') {
          colors.opsSubtype = sub.decodeText();
        }
      }

      // Callout curved leader flag: /OPS_LeaderStyle ('curved' = ronde aanhaallijn)
      const opsLeaderStyleRaw = annotDict.get(PDFName.of('OPS_LeaderStyle'));
      if (opsLeaderStyleRaw) {
        const ls = context.lookup(opsLeaderStyleRaw) || opsLeaderStyleRaw;
        if (ls && typeof ls.value === 'string') colors.opsLeaderStyle = ls.value;
        else if (ls && typeof ls.decodeText === 'function') colors.opsLeaderStyle = ls.decodeText();
      }

      // Textbox leaders: /OPS_LeaderId + /IRT (in-reply-to parent textbox Rect)
      const opsLidRaw = annotDict.get(PDFName.of('OPS_LeaderId'));
      if (opsLidRaw) {
        const lv = context.lookup(opsLidRaw) || opsLidRaw;
        if (lv && typeof lv.value === 'string') colors.opsLeaderId = lv.value;
        else if (lv && typeof lv.decodeText === 'function') colors.opsLeaderId = lv.decodeText();
      }
      const irtRaw = annotDict.get(PDFName.of('IRT'));
      if (irtRaw) {
        const irt = context.lookup(irtRaw);
        if (irt && typeof irt.get === 'function') {
          const irtRectRaw = irt.get(PDFName.of('Rect'));
          if (irtRectRaw) {
            const irtRect = context.lookup(irtRectRaw) || irtRectRaw;
            if (irtRect && typeof irtRect.size === 'function' && irtRect.size() >= 4) {
              colors.irtRectKey = `${pdfNum(irtRect.get(0))},${pdfNum(irtRect.get(1))},${pdfNum(irtRect.get(2))},${pdfNum(irtRect.get(3))}`;
            }
          }
        }
      }

      // Read /OPS_PixelsPerUnit, /OPS_Unit, /OPS_ScaleRatio, /OPS_Divisions, /OPS_TotalUnits (viewport/scaleBar)
      const opsPpuRaw = annotDict.get(PDFName.of('OPS_PixelsPerUnit'));
      if (opsPpuRaw) {
        const ppu = pdfNum(context.lookup(opsPpuRaw) || opsPpuRaw);
        if (ppu !== null) colors.opsPixelsPerUnit = ppu;
      }
      const opsUnitRaw = annotDict.get(PDFName.of('OPS_Unit'));
      if (opsUnitRaw) {
        const u = context.lookup(opsUnitRaw) || opsUnitRaw;
        if (u && typeof u.value === 'string') colors.opsUnit = u.value;
        else if (u && typeof u.decodeText === 'function') colors.opsUnit = u.decodeText();
      }
      const opsSrRaw = annotDict.get(PDFName.of('OPS_ScaleRatio'));
      if (opsSrRaw) {
        const sr = context.lookup(opsSrRaw) || opsSrRaw;
        if (sr && typeof sr.value === 'string') colors.opsScaleRatio = sr.value;
        else if (sr && typeof sr.decodeText === 'function') colors.opsScaleRatio = sr.decodeText();
      }
      const opsDivRaw = annotDict.get(PDFName.of('OPS_Divisions'));
      if (opsDivRaw) {
        const div = pdfNum(context.lookup(opsDivRaw) || opsDivRaw);
        if (div !== null) colors.opsDivisions = div;
      }
      const opsTuRaw = annotDict.get(PDFName.of('OPS_TotalUnits'));
      if (opsTuRaw) {
        const tu = pdfNum(context.lookup(opsTuRaw) || opsTuRaw);
        if (tu !== null) colors.opsTotalUnits = tu;
      }
      // Scale region custom keys
      const opsScaleStringRaw = annotDict.get(PDFName.of('OPS_ScaleString'));
      if (opsScaleStringRaw) {
        const ss = context.lookup(opsScaleStringRaw) || opsScaleStringRaw;
        if (ss && typeof ss.value === 'string') colors.opsScaleString = ss.value;
        else if (ss && typeof ss.decodeText === 'function') colors.opsScaleString = ss.decodeText();
      }
      const opsUnitsRaw = annotDict.get(PDFName.of('OPS_Units'));
      if (opsUnitsRaw) {
        const u = context.lookup(opsUnitsRaw) || opsUnitsRaw;
        if (u && typeof u.value === 'string') colors.opsUnits = u.value;
        else if (u && typeof u.decodeText === 'function') colors.opsUnits = u.decodeText();
      }
      const opsLabelRaw = annotDict.get(PDFName.of('OPS_Label'));
      if (opsLabelRaw) {
        const l = context.lookup(opsLabelRaw) || opsLabelRaw;
        if (l && typeof l.value === 'string') colors.opsLabel = l.value;
        else if (l && typeof l.decodeText === 'function') colors.opsLabel = l.decodeText();
      }

      const opsLwRaw = annotDict.get(PDFName.of('OPS_LineWidth'));
      if (opsLwRaw) {
        const lw = pdfNum(context.lookup(opsLwRaw) || opsLwRaw);
        if (lw !== null) colors.opsLineWidth = lw;
      }

      const opsScheduleRaw = annotDict.get(PDFName.of('OPS_ScheduleData'));
      if (opsScheduleRaw) {
        const sd = context.lookup(opsScheduleRaw) || opsScheduleRaw;
        if (sd && typeof sd.value === 'string') colors.opsScheduleData = sd.value;
        else if (sd && typeof sd.decodeText === 'function') colors.opsScheduleData = sd.decodeText();
      }
      const opsGroupByRaw = annotDict.get(PDFName.of('OPS_GroupBy'));
      if (opsGroupByRaw) {
        const gb = context.lookup(opsGroupByRaw) || opsGroupByRaw;
        if (gb && typeof gb.value === 'string') colors.opsGroupBy = gb.value;
        else if (gb && typeof gb.decodeText === 'function') colors.opsGroupBy = gb.decodeText();
      }

      // Parametric symbol metadata
      const opsSymRaw = annotDict.get(PDFName.of('OPS_SymbolId'));
      if (opsSymRaw) {
        const s = context.lookup(opsSymRaw) || opsSymRaw;
        if (s && typeof s.value === 'string') colors.opsSymbolId = s.value;
        else if (s && typeof s.decodeText === 'function') colors.opsSymbolId = s.decodeText();
      }
      const opsParamsRaw = annotDict.get(PDFName.of('OPS_Params'));
      if (opsParamsRaw) {
        const p = context.lookup(opsParamsRaw) || opsParamsRaw;
        if (p && typeof p.value === 'string') colors.opsParams = p.value;
        else if (p && typeof p.decodeText === 'function') colors.opsParams = p.decodeText();
      }

      const opsArRaw = annotDict.get(PDFName.of('OPS_ArcRadius'));
      if (opsArRaw) {
        const ar = pdfNum(context.lookup(opsArRaw) || opsArRaw);
        if (ar !== null) colors.opsArcRadius = ar;
      }

      // Read /OPS_Points (our custom control points for spline annotations)
      const opsPointsRaw = annotDict.get(PDFName.of('OPS_Points'));
      if (opsPointsRaw) {
        const pointsArr = context.lookup(opsPointsRaw) || opsPointsRaw;
        if (pointsArr && typeof pointsArr.size === 'function') {
          const flatPoints = [];
          for (let pi = 0; pi < pointsArr.size(); pi++) {
            const val = pointsArr.get(pi);
            const num = pdfNum(context.lookup(val) || val);
            if (num !== null) flatPoints.push(num);
          }
          // >= 4 (2 points): spline arrows (issue #267) can have as few as two
          // control points; the spline loader still self-gates on >= 6.
          if (flatPoints.length >= 4) colors.opsPoints = flatPoints;
        }
      }

      // Read /OPS_Holes (our custom holes data for measureArea with cutouts)
      const opsHolesRaw = annotDict.get(PDFName.of('OPS_Holes'));
      if (opsHolesRaw) {
        const holesArr = context.lookup(opsHolesRaw) || opsHolesRaw;
        if (holesArr && typeof holesArr.size === 'function') {
          const holes = [];
          for (let hi = 0; hi < holesArr.size(); hi++) {
            const holeRaw = context.lookup(holesArr.get(hi)) || holesArr.get(hi);
            if (holeRaw && typeof holeRaw.size === 'function') {
              const holePoints = [];
              for (let pi = 0; pi + 1 < holeRaw.size(); pi += 2) {
                const hx = pdfNum(context.lookup(holeRaw.get(pi)) || holeRaw.get(pi));
                const hy = pdfNum(context.lookup(holeRaw.get(pi + 1)) || holeRaw.get(pi + 1));
                if (hx !== null && hy !== null) {
                  holePoints.push({ x: hx, y: hy });
                }
              }
              if (holePoints.length >= 3) holes.push(holePoints);
            }
          }
          if (holes.length > 0) colors.holes = holes;
        }
      }

      // Read /OPS_HatchPattern, /OPS_HatchColor, /OPS_HatchScale, /OPS_HatchAngle
      // (used by 'filledArea' annotations to persist user-controlled hatch fill).
      const hpRaw = annotDict.get(PDFName.of('OPS_HatchPattern'));
      if (hpRaw) {
        const hp = context.lookup(hpRaw) || hpRaw;
        if (typeof hp.decodeText === 'function') colors.opsHatchPattern = hp.decodeText();
        else if (typeof hp.value === 'string') colors.opsHatchPattern = hp.value;
      }
      const hcRaw = annotDict.get(PDFName.of('OPS_HatchColor'));
      if (hcRaw) {
        const hc = context.lookup(hcRaw) || hcRaw;
        if (typeof hc.decodeText === 'function') colors.opsHatchColor = hc.decodeText();
        else if (typeof hc.value === 'string') colors.opsHatchColor = hc.value;
      }
      const hsRaw = annotDict.get(PDFName.of('OPS_HatchScale'));
      if (hsRaw) {
        const hs = pdfNum(context.lookup(hsRaw) || hsRaw);
        if (hs !== null) colors.opsHatchScale = hs;
      }
      const haRaw = annotDict.get(PDFName.of('OPS_HatchAngle'));
      if (haRaw) {
        const ha = pdfNum(context.lookup(haRaw) || haRaw);
        if (ha !== null) colors.opsHatchAngle = ha;
      }

      // Read /OPS_DikteMm — wall thickness in real-world mm (wall round-trip)
      const dkRaw = annotDict.get(PDFName.of('OPS_DikteMm'));
      if (dkRaw) {
        const dk = pdfNum(context.lookup(dkRaw) || dkRaw);
        if (dk !== null) colors.opsDikteMm = dk;
      }

      // Read /OPS_IsolatieType — insulation sub-material for walls
      const isoTypeRaw = annotDict.get(PDFName.of('OPS_IsolatieType'));
      if (isoTypeRaw) {
        const isoType = context.lookup(isoTypeRaw) || isoTypeRaw;
        if (typeof isoType.decodeText === 'function') colors.opsIsolatieType = isoType.decodeText();
        else if (typeof isoType.value === 'string') colors.opsIsolatieType = isoType.value;
      }

      // Read /OPS_LinkedPath — source file of a LINKED image annotation
      const lpRaw = annotDict.get(PDFName.of('OPS_LinkedPath'));
      if (lpRaw) {
        const lp = context.lookup(lpRaw) || lpRaw;
        if (typeof lp.decodeText === 'function') colors.opsLinkedPath = lp.decodeText();
        else if (typeof lp.value === 'string') colors.opsLinkedPath = lp.value;
      }

      // Read /OPS_TintColor — colour tint of an image compare-overlay
      const tcRaw = annotDict.get(PDFName.of('OPS_TintColor'));
      if (tcRaw) {
        const tc = context.lookup(tcRaw) || tcRaw;
        if (typeof tc.decodeText === 'function') colors.opsTintColor = tc.decodeText();
        else if (typeof tc.value === 'string') colors.opsTintColor = tc.value;
      }

      // Read /OPS_ArcFlags + /OPS_ArcBulges (parallel arrays, one entry per
      // outer vertex). Used to round-trip arc-segment metadata for filledArea.
      const afRaw = annotDict.get(PDFName.of('OPS_ArcFlags'));
      if (afRaw) {
        const arr = context.lookup(afRaw) || afRaw;
        if (arr && typeof arr.size === 'function') {
          const flags = [];
          for (let i = 0; i < arr.size(); i++) {
            const v = pdfNum(context.lookup(arr.get(i)) || arr.get(i));
            flags.push(v ? 1 : 0);
          }
          colors.opsArcFlags = flags;
        }
      }
      const abRaw = annotDict.get(PDFName.of('OPS_ArcBulges'));
      if (abRaw) {
        const arr = context.lookup(abRaw) || abRaw;
        if (arr && typeof arr.size === 'function') {
          const bulges = [];
          for (let i = 0; i < arr.size(); i++) {
            const v = pdfNum(context.lookup(arr.get(i)) || arr.get(i));
            bulges.push(v != null ? v : 0);
          }
          colors.opsArcBulges = bulges;
        }
      }

      // Read /OPS_HoleArcFlags + /OPS_HoleArcBulges (array of sub-arrays,
      // one sub-array per hole, parallel to /OPS_Holes). Round-trip arc
      // metadata for vertices inside hole contours.
      const hafRaw = annotDict.get(PDFName.of('OPS_HoleArcFlags'));
      if (hafRaw) {
        const arr = context.lookup(hafRaw) || hafRaw;
        if (arr && typeof arr.size === 'function') {
          const out = [];
          for (let i = 0; i < arr.size(); i++) {
            const sub = context.lookup(arr.get(i)) || arr.get(i);
            const flags = [];
            if (sub && typeof sub.size === 'function') {
              for (let j = 0; j < sub.size(); j++) {
                const v = pdfNum(context.lookup(sub.get(j)) || sub.get(j));
                flags.push(v ? 1 : 0);
              }
            }
            out.push(flags);
          }
          colors.opsHoleArcFlags = out;
        }
      }
      const habRaw = annotDict.get(PDFName.of('OPS_HoleArcBulges'));
      if (habRaw) {
        const arr = context.lookup(habRaw) || habRaw;
        if (arr && typeof arr.size === 'function') {
          const out = [];
          for (let i = 0; i < arr.size(); i++) {
            const sub = context.lookup(arr.get(i)) || arr.get(i);
            const bulges = [];
            if (sub && typeof sub.size === 'function') {
              for (let j = 0; j < sub.size(); j++) {
                const v = pdfNum(context.lookup(sub.get(j)) || sub.get(j));
                bulges.push(v != null ? v : 0);
              }
            }
            out.push(bulges);
          }
          colors.opsHoleArcBulges = out;
        }
      }

      // Read /IT (Intent) for measurement annotations
      const itRaw = annotDict.get(PDFName.of('IT'));
      if (itRaw) {
        const it = context.lookup(itRaw) || itRaw;
        const itStr = it.toString();
        if (itStr) colors.intent = itStr.replace('/', '');
      }

      // Check for /Measure dictionary (PDF measurement annotations)
      const measureRaw = annotDict.get(PDFName.of('Measure'));
      if (measureRaw) {
        colors.hasMeasure = true;
        // Extract scale, unit, and precision from Measure NumberFormat dictionaries
        const measureDict = context.lookup(measureRaw);
        if (measureDict) {
          // Helper: read a single NumberFormat dict, extract C (scale), U (unit), D (precision)
          const readOneNF = (dict) => {
            if (!dict || typeof dict.get !== 'function') return null;
            const result = {};
            const cRaw = dict.get(PDFName.of('C'));
            const cVal = pdfNum(context.lookup(cRaw) || cRaw);
            if (cVal !== null && cVal > 0) result.scale = cVal;
            const uRaw = dict.get(PDFName.of('U'));
            if (uRaw) {
              const uStr = (context.lookup(uRaw) || uRaw);
              if (typeof uStr.decodeText === 'function') result.unit = uStr.decodeText();
              else if (typeof uStr.value === 'string') result.unit = uStr.value;
              else result.unit = uStr.toString().replace(/[()\/]/g, '');
            }
            const dRaw = dict.get(PDFName.of('D'));
            if (dRaw) {
              const dVal = pdfNum(context.lookup(dRaw) || dRaw);
              if (dVal !== null && dVal >= 0) result.precision = dVal;
            }
            return Object.keys(result).length > 0 ? result : null;
          };

          // Read a NumberFormat array: multiply C values across the chain,
          // take U and D from the last element (the display unit/precision).
          const readNumberFormat = (nfRaw) => {
            if (!nfRaw) return null;
            const arr = context.lookup(nfRaw);
            if (!arr) return null;
            // Single dict (not array)
            if (typeof arr.size !== 'function') return readOneNF(arr);
            const count = arr.size();
            if (count === 0) return null;
            // Read all elements: cumulative scale, last element's unit and precision
            let cumulativeScale = 1;
            let unit = null;
            let precision = undefined;
            for (let ei = 0; ei < count; ei++) {
              const nf = readOneNF(context.lookup(arr.get(ei)));
              if (nf) {
                if (nf.scale) cumulativeScale *= nf.scale;
                if (nf.unit) unit = nf.unit;
                if (nf.precision !== undefined) precision = nf.precision;
              }
            }
const result = {};
            if (cumulativeScale > 0) result.scale = cumulativeScale;
            if (unit) result.unit = unit;
            if (precision !== undefined) result.precision = precision;
            return Object.keys(result).length > 0 ? result : null;
          };

          // /X = per-pixel scale factor and unit
          const xFmt = readNumberFormat(measureDict.get(PDFName.of('X')));
          if (xFmt && xFmt.scale) {
            colors.measureScale = xFmt.scale;
            if (xFmt.unit) colors.measureUnit = xFmt.unit;
          }
          // /D = distance display format — its D value is a denominator (e.g. 100000 = 5 decimals)
          // Fallback to /X precision for annotations without /D (e.g. simple Line dimensions)
          const dFmt = readNumberFormat(measureDict.get(PDFName.of('D')));
          if (dFmt && dFmt.precision !== undefined && dFmt.precision > 1) {
            colors.measurePrecision = Math.round(Math.log10(dFmt.precision));
          } else if (xFmt && xFmt.precision !== undefined) {
            colors.measurePrecision = xFmt.precision;
          }
          // /A = area display format — D value is also a denominator
          const aFmt = readNumberFormat(measureDict.get(PDFName.of('A')));
          if (aFmt && aFmt.unit) {
            colors.measureAreaUnit = aFmt.unit;
          }
          if (aFmt && aFmt.precision !== undefined && aFmt.precision > 1) {
            colors.measureAreaPrecision = Math.round(Math.log10(aFmt.precision));
          }
        }
      }

      // Read BS/D (dash array) to distinguish dashed from dotted
      const bsRaw = annotDict.get(PDFName.of('BS'));
      if (bsRaw) {
        const bsDict = context.lookup(bsRaw);
        if (bsDict) {
          const dRaw = bsDict.get(PDFName.of('D'));
          if (dRaw) {
            const dArr = context.lookup(dRaw) || dRaw;
            if (dArr && typeof dArr.size === 'function' && dArr.size() >= 2) {
              const d0 = pdfNum(dArr.get(0));
              const d1 = pdfNum(dArr.get(1));
              // Short dash segments (<=3) indicate dotted; longer ones are dashed
              if (d0 !== null && d0 <= 3 && d1 !== null && d1 <= 3) {
                colors.borderStyle = 'dotted';
              } else {
                colors.borderStyle = 'dashed';
              }
            }
          }
        }
      }

      // IC and type-specific extraction only for shape/text annotations
      const needsIcTypes = ['/FreeText', '/Square', '/Circle', '/Line', '/PolyLine', '/Polygon'];
      if (needsIcTypes.includes(subtypeName)) {
        // Read IC (Interior Color) entry
        const icRaw = annotDict.get(PDFName.of('IC'));
        if (icRaw) {
          const ic = context.lookup(icRaw);
          colors.ic = pdfColorToHex(ic, context);
        }

        // For Line annotations, read original /L array (PDF.js normalizeRect destroys direction)
        if (subtypeName === '/Line') {
          const lRaw = annotDict.get(PDFName.of('L'));
          if (lRaw) {
            const lArr = context.lookup(lRaw) || lRaw;
            if (lArr && typeof lArr.size === 'function' && lArr.size() >= 4) {
              colors.lineCoords = [
                pdfNum(lArr.get(0)),
                pdfNum(lArr.get(1)),
                pdfNum(lArr.get(2)),
                pdfNum(lArr.get(3))
              ];
            }
          }
          // Read leader line properties for dimension annotations
          const llRaw = annotDict.get(PDFName.of('LL'));
          if (llRaw) {
            const llVal = pdfNum(context.lookup(llRaw) || llRaw);
            if (llVal !== null) colors.leaderLength = llVal;
          }
          const lleRaw = annotDict.get(PDFName.of('LLE'));
          if (lleRaw) {
            const lleVal = pdfNum(context.lookup(lleRaw) || lleRaw);
            if (lleVal !== null) colors.leaderExtension = lleVal;
          }
          const lloRaw = annotDict.get(PDFName.of('LLO'));
          if (lloRaw) {
            const lloVal = pdfNum(context.lookup(lloRaw) || lloRaw);
            if (lloVal !== null) colors.leaderOffset = lloVal;
          }
          // Read caption properties
          const capRaw = annotDict.get(PDFName.of('Cap'));
          if (capRaw) colors.hasCaption = true;
          const cpRaw = annotDict.get(PDFName.of('CP'));
          if (cpRaw) {
            const cpVal = (context.lookup(cpRaw) || cpRaw).toString();
            colors.captionPosition = cpVal.replace('/', '');
          }
          const coRaw = annotDict.get(PDFName.of('CO'));
          if (coRaw) {
            const coArr = context.lookup(coRaw) || coRaw;
            if (coArr && typeof coArr.size === 'function' && coArr.size() >= 2) {
              colors.captionOffset = [pdfNum(coArr.get(0)), pdfNum(coArr.get(1))];
            }
          }
        }
      }

      // Extract border width from /BS or /Border for ALL annotation types.
      // PDF.js's annot.borderStyle?.width sometimes returns 1 (default) when the
      // PDF actually has /BS<</W 4>> or /Border [0 0 4]. Reading the raw dict
      // here gives the real value.
      const bwBsRaw = annotDict.get(PDFName.of('BS'));
      if (bwBsRaw) {
        const bwBs = context.lookup(bwBsRaw);
        if (bwBs) {
          const wRaw = bwBs.get(PDFName.of('W'));
          if (wRaw !== undefined && wRaw !== null) {
            const w = pdfNum(context.lookup(wRaw) || wRaw);
            if (w !== null) colors.borderWidth = w;
          }
        }
      }
      // Fallback: /Border array [H V W] - third element is width
      if (colors.borderWidth === undefined) {
        const borderRaw = annotDict.get(PDFName.of('Border'));
        if (borderRaw) {
          const border = context.lookup(borderRaw) || borderRaw;
          if (border && typeof border.size === 'function' && border.size() >= 3) {
            const w = pdfNum(border.get(2));
            if (w !== null) colors.borderWidth = w;
          }
        }
      }

      // For FreeText, extract additional FreeText-specific properties
      if (subtypeName === '/FreeText') {
        // Read standard /Rotate key (externe referentie-editor writes this for 90/180/270 rotations)
        const stdRotRaw = annotDict.get(PDFName.of('Rotate'));
        if (stdRotRaw) {
          const sr = pdfNum(context.lookup(stdRotRaw) || stdRotRaw);
          if (sr !== null) {
            // PDF spec: /Rotate is CCW degrees in PDF space; we negate for canvas (Y-down)
            colors.stdRotation = -sr;
          }
        }

        // Extract font family from /DR (default resources) → /Font → /BaseFont
        const daRaw = annotDict.get(PDFName.of('DA'));
        const drRaw = annotDict.get(PDFName.of('DR'));
        if (daRaw && drRaw) {
          try {
            const daStr = daRaw.toString?.() || '';
            // Get font reference name from DA string, e.g. "/Helv 12 Tf" → "Helv"
            const daFontMatch = daStr.match(/\/([^\s)]+)\s+[\d.]+\s+Tf/);
            if (daFontMatch) {
              const fontRef = daFontMatch[1];
              const dr = context.lookup(drRaw);
              if (dr) {
                const fontDictRaw = dr.get(PDFName.of('Font'));
                if (fontDictRaw) {
                  const fontDict = context.lookup(fontDictRaw);
                  if (fontDict) {
                    const fontObjRaw = fontDict.get(PDFName.of(fontRef));
                    if (fontObjRaw) {
                      const fontObj = context.lookup(fontObjRaw);
                      if (fontObj) {
                        const baseFont = fontObj.get(PDFName.of('BaseFont'));
                        if (baseFont) {
                          const fontInfo = mapPdfFontName(baseFont.toString());
                          if (fontInfo) {
                            colors.fontFamily = fontInfo.family;
                            if (fontInfo.bold) colors.fontBold = true;
                            if (fontInfo.italic) colors.fontItalic = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) { /* ignore font extraction errors */ }
        }

        // Extract text styles from /RC (Rich Content) XHTML string
        const rcRaw = annotDict.get(PDFName.of('RC'));
        if (rcRaw) {
          try {
            const rcStr = rcRaw.toString?.() || '';
            if (rcStr) {
              // Check for text-decoration in style attributes
              const decoMatch = rcStr.match(/text-decoration\s*:\s*([^;"']+)/i);
              if (decoMatch) {
                const deco = decoMatch[1].toLowerCase();
                if (deco.includes('underline')) colors.fontUnderline = true;
                if (deco.includes('line-through')) colors.fontStrikethrough = true;
              }
              // Also check for bold/italic in RC if not already detected from font name
              if (!colors.fontBold) {
                const weightMatch = rcStr.match(/font-weight\s*:\s*([^;"']+)/i);
                if (weightMatch && /bold|[7-9]00/i.test(weightMatch[1])) {
                  colors.fontBold = true;
                }
              }
              if (!colors.fontItalic) {
                const styleMatch = rcStr.match(/font-style\s*:\s*([^;"']+)/i);
                if (styleMatch && /italic|oblique/i.test(styleMatch[1])) {
                  colors.fontItalic = true;
                }
              }
              // Extract line-height from RC (stored as absolute pt value, convert to multiplier)
              const lhMatch = rcStr.match(/line-height\s*:\s*([\d.]+)/i);
              if (lhMatch) {
                colors.rawLineHeight = parseFloat(lhMatch[1]);
              }
            }
          } catch (e) { /* ignore RC parsing errors */ }
        }

        // Extract /DS (Default Style) for font-size, font-family, font-weight
        // and line-height. The DS string is a CSS-like declaration used by
        // reference desktop editors' FreeText annotations to encode rich styling:
        //   /DS (font-family:Segoe UI;font-size:22pt;font-weight:bold;color:#FFFFFF;)
        // Without parsing font-family here we silently fall back to Arial,
        // which is wider per glyph than Segoe UI Bold → text wraps to
        // additional lines that fit fine in reference viewers.
        // Concrete victim: "CONSTRUCTIE OVERZICHT" at Segoe UI Bold 22pt
        // measures ~272pt → fits in a 275.9pt box. In Arial Bold 22pt the
        // same string measures ~290pt → wraps to two lines.
        const dsRaw = annotDict.get(PDFName.of('DS'));
        if (dsRaw) {
          try {
            const dsStr = dsRaw.toString?.() || '';
            const fsSizeMatch = dsStr.match(/font-size\s*:\s*([\d.]+)\s*pt/i);
            if (fsSizeMatch) {
              colors.dsFontSize = parseFloat(fsSizeMatch[1]);
            }
            // font-family — capture until ';' or end of string; trim quotes/spaces.
            // DS uses CSS syntax so the value may be a comma-separated stack
            // ("Arial, sans-serif"). We take the first family — that's what
            // the authoring editor actually used for the box.
            if (!colors.fontFamily) {
              const ffMatch = dsStr.match(/font-family\s*:\s*([^;]+)/i);
              if (ffMatch) {
                const fam = ffMatch[1].trim().split(',')[0].trim().replace(/^['"]|['"]$/g, '');
                if (fam) colors.fontFamily = fam;
              }
            }
            // font-weight — bold/600+ → fontBold. Anything else leaves the
            // existing value (which may have been set from BaseFont parsing).
            if (!colors.fontBold) {
              const fwMatch = dsStr.match(/font-weight\s*:\s*([^;]+)/i);
              if (fwMatch) {
                const w = fwMatch[1].trim().toLowerCase();
                if (w === 'bold' || w === 'bolder' || /^[6-9]\d{2}$/.test(w)) {
                  colors.fontBold = true;
                }
              }
            }
            // font-style — italic
            if (!colors.fontItalic) {
              const fsMatch = dsStr.match(/font-style\s*:\s*([^;]+)/i);
              if (fsMatch && /italic|oblique/i.test(fsMatch[1])) {
                colors.fontItalic = true;
              }
            }
            if (!colors.rawLineHeight) {
              const lhMatch = dsStr.match(/line-height\s*:\s*([\d.]+)/i);
              if (lhMatch) {
                colors.rawLineHeight = parseFloat(lhMatch[1]);
              }
            }
          } catch (e) { /* ignore DS parsing errors */ }
        }

        // Extract /OPS_Rotation (our custom key only — ignore standard /Rotation
        // which other tools use for text orientation, not whole-annotation rotation)
        const opsRotRaw = annotDict.get(PDFName.of('OPS_Rotation'));
        if (opsRotRaw) {
          const rv = pdfNum(context.lookup(opsRotRaw) || opsRotRaw);
          if (rv !== null) colors.rotation = rv;
        }

        // Extract /C (Color) entry directly for FreeText — needed for callout stroke detection
        const cRaw = annotDict.get(PDFName.of('C'));
        if (cRaw) {
          colors.cColor = pdfColorToHex(context.lookup(cRaw) || cRaw, context);
        }

        // Extract /CL (Callout Line) array — pdf.js doesn't expose this
        const clRaw = annotDict.get(PDFName.of('CL'));
        if (clRaw) {
          const cl = context.lookup(clRaw) || clRaw;
          if (cl && typeof cl.size === 'function') {
            const clArr = [];
            for (let ci = 0; ci < cl.size(); ci++) {
              const v = pdfNum(cl.get(ci));
              if (v !== null) clArr.push(v);
            }
            if (clArr.length >= 4) colors.calloutLine = clArr;
          }
        }

        // Extract /RD (Rectangle Differences) — insets from Rect to actual text box
        const rdRaw = annotDict.get(PDFName.of('RD'));
        if (rdRaw) {
          const rd = context.lookup(rdRaw) || rdRaw;
          if (rd && typeof rd.size === 'function' && rd.size() >= 4) {
            colors.rectDiff = [pdfNum(rd.get(0)), pdfNum(rd.get(1)), pdfNum(rd.get(2)), pdfNum(rd.get(3))];
          }
        }

        const apRaw = annotDict.get(PDFName.of('AP'));
        if (apRaw) {
          const ap = context.lookup(apRaw);
          if (ap) {
            const nRaw = ap.get(PDFName.of('N'));
            if (nRaw) {
              const nStream = context.lookup(nRaw);
              if (nStream) {
                const nDict = nStream.dict || nStream;

                // Extract rotation from /Matrix [a, b, c, d, e, f]
                // The Matrix maps form BBox to annotation Rect (includes page rotation)
                const matrixRaw = nDict.get(PDFName.of('Matrix'));
                if (matrixRaw) {
                  const matrix = context.lookup(matrixRaw) || matrixRaw;
                  if (matrix && typeof matrix.size === 'function' && matrix.size() >= 4) {
                    const a = pdfNum(matrix.get(0));
                    const b = pdfNum(matrix.get(1));
                    if (a !== null && b !== null) {
                      colors.matrixAngle = Math.round(Math.atan2(b, a) * 180 / Math.PI * 100) / 100;
                    }
                  }
                }

                // Extract font from AP/N Resources → Font → BaseFont (fallback when /DR is missing)
                if (!colors.fontFamily) {
                  try {
                    const resRaw = nDict.get(PDFName.of('Resources'));
                    if (resRaw) {
                      const res = context.lookup(resRaw);
                      if (res) {
                        const apFontDictRaw = res.get(PDFName.of('Font'));
                        if (apFontDictRaw) {
                          const apFontDict = context.lookup(apFontDictRaw);
                          if (apFontDict) {
                            // Get the font reference name from DA string
                            const daRawForAP = annotDict.get(PDFName.of('DA'));
                            const daStrForAP = daRawForAP?.toString?.() || '';
                            const daFontRef = daStrForAP.match(/\/([^\s)]+)\s+[\d.]+\s+Tf/);
                            const refName = daFontRef ? daFontRef[1] : null;

                            // Try specific font ref first, then iterate all fonts
                            const fontKeysToTry = refName ? [refName] : [];
                            if (apFontDict.entries) {
                              for (const [key] of apFontDict.entries()) {
                                const k = key.toString().replace(/^\//, '');
                                if (k !== refName) fontKeysToTry.push(k);
                              }
                            }

                            for (const fk of fontKeysToTry) {
                              const fObjRaw = apFontDict.get(PDFName.of(fk));
                              if (fObjRaw) {
                                const fObj = context.lookup(fObjRaw);
                                if (fObj) {
                                  const bf = fObj.get(PDFName.of('BaseFont'));
                                  if (bf) {
                                    const fontInfo = mapPdfFontName(bf.toString());
                                    if (fontInfo) {
                                      colors.fontFamily = fontInfo.family;
                                      if (fontInfo.bold) colors.fontBold = true;
                                      if (fontInfo.italic) colors.fontItalic = true;
                                      break;
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  } catch (e) { /* ignore AP font extraction errors */ }
                }

                // Extract BBox - original unrotated dimensions of the textbox
                const bboxRaw = nDict.get(PDFName.of('BBox'));
                if (bboxRaw) {
                  const bbox = context.lookup(bboxRaw) || bboxRaw;
                  if (bbox && typeof bbox.size === 'function' && bbox.size() >= 4) {
                    colors.bboxWidth = Math.abs(pdfNum(bbox.get(2)) - pdfNum(bbox.get(0)));
                    colors.bboxHeight = Math.abs(pdfNum(bbox.get(3)) - pdfNum(bbox.get(1)));
                  }
                }

                // Decode the AP/N content once — used for the stroke-color
                // fallback below AND for the legacy-appearance detection.
                const decodeStream = async (stream) => {
                  let bytes;
                  if (typeof stream.getContents === 'function') bytes = stream.getContents();
                  else if (typeof stream.contents === 'function') bytes = stream.contents();
                  else if (stream.contentsCache?.value) bytes = stream.contentsCache.value;
                  if (!bytes) return null;
                  const dict = stream.dict || stream;
                  const filterRaw = dict.get(PDFName.of('Filter'));
                  const filterName = filterRaw?.toString();
                  if (filterName === '/FlateDecode') {
                    const dec = await inflateBytes(bytes);
                    return dec ? new TextDecoder().decode(dec) : null;
                  }
                  return new TextDecoder().decode(bytes);
                };
                const content = await decodeStream(nStream);

                // Legacy-appearance detection (self-healing for files saved by
                // an older version of this app). Those appearances contain our
                // exact text-state signature but NO rotation in any cm/Tm
                // operator and a translation-only /Matrix: on a page with
                // /Rotate the text then renders sideways, and the loader's
                // matrix heuristic misreads the page rotation as annotation
                // rotation. Flag them so the converter can treat the
                // annotation as visually unrotated; the next save rewrites the
                // appearance with proper page-rotation compensation. Only for
                // annotations WITHOUT our explicit /OPS_Rotation key.
                if (colors.rotation === undefined && content &&
                    content.includes('0 Tc 0 Tw 100 Tz 0 Tr') &&
                    (colors.matrixAngle === undefined || Math.abs(colors.matrixAngle) <= 0.01)) {
                  const opRe = /(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(cm|Tm)\b/g;
                  let hasRotationOp = false;
                  let opMatch;
                  while ((opMatch = opRe.exec(content)) !== null) {
                    // b or c ≠ 0 ⇒ the matrix rotates/skews (identity,
                    // translation and pure scaling all have b = c = 0).
                    if (Math.abs(parseFloat(opMatch[2])) > 0.001 ||
                        Math.abs(parseFloat(opMatch[3])) > 0.001) {
                      hasRotationOp = true;
                      break;
                    }
                  }
                  if (!hasRotationOp) colors.apLegacyUnrotated = true;
                }

                // Extract stroke color from content stream (or referenced XObjects)
                if (!colors.ic) {
                  let rgMatch = content ? content.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/) : null;

                  // If not found, follow XObject form references (e.g. /Fm0 Do)
                  if (!rgMatch && content) {
                    const xobjMatch = content.match(/\/(\S+)\s+Do/);
                    if (xobjMatch) {
                      try {
                        const resRaw = nDict.get(PDFName.of('Resources'));
                        const res = resRaw ? context.lookup(resRaw) : null;
                        const xobjDictRaw = res ? res.get(PDFName.of('XObject')) : null;
                        const xobjDict = xobjDictRaw ? context.lookup(xobjDictRaw) : null;
                        const fmRaw = xobjDict ? xobjDict.get(PDFName.of(xobjMatch[1])) : null;
                        const fmStream = fmRaw ? context.lookup(fmRaw) : null;
                        if (fmStream) {
                          const fmContent = await decodeStream(fmStream);
                          if (fmContent) {
                            rgMatch = fmContent.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/);
                          }
                        }
                      } catch (e) { /* ignore XObject extraction errors */ }
                    }
                  }

                  if (rgMatch) {
                    const r = parseFloat(rgMatch[1]), g = parseFloat(rgMatch[2]), b = parseFloat(rgMatch[3]);
                    colors.apStrokeColor = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
                  }
                }
              }
            }
          }
        }
      }

      // For non-FreeText annotations, extract rotation Matrix and BBox from AP/N stream
      if (subtypeName !== '/FreeText' && colors.matrixAngle === undefined) {
        const apRaw2 = annotDict.get(PDFName.of('AP'));
        if (apRaw2) {
          const ap2 = context.lookup(apRaw2);
          if (ap2) {
            const nRaw2 = ap2.get(PDFName.of('N'));
            if (nRaw2) {
              const nStream2 = context.lookup(nRaw2);
              if (nStream2) {
                const nDict2 = nStream2.dict || nStream2;

                // Extract rotation from /Matrix [a, b, c, d, e, f]
                const matrixRaw2 = nDict2.get(PDFName.of('Matrix'));
                if (matrixRaw2) {
                  const matrix2 = context.lookup(matrixRaw2) || matrixRaw2;
                  if (matrix2 && typeof matrix2.size === 'function' && matrix2.size() >= 4) {
                    const a2 = pdfNum(matrix2.get(0));
                    const b2 = pdfNum(matrix2.get(1));
                    if (a2 !== null && b2 !== null) {
                      colors.matrixAngle = Math.round(Math.atan2(b2, a2) * 180 / Math.PI * 100) / 100;
                    }
                  }
                }

                // Extract BBox - original unrotated dimensions
                const bboxRaw2 = nDict2.get(PDFName.of('BBox'));
                if (bboxRaw2) {
                  const bbox2 = context.lookup(bboxRaw2) || bboxRaw2;
                  if (bbox2 && typeof bbox2.size === 'function' && bbox2.size() >= 4) {
                    colors.bboxWidth = Math.abs(pdfNum(bbox2.get(2)) - pdfNum(bbox2.get(0)));
                    colors.bboxHeight = Math.abs(pdfNum(bbox2.get(3)) - pdfNum(bbox2.get(1)));
                  }
                }
              }
            }
          }
        }
      }

      // Convert absolute line-height (pt) to multiplier using font size
      if (colors.rawLineHeight) {
        // Get font size from DA string
        const daRawForLH = annotDict.get(PDFName.of('DA'));
        const daStrLH = daRawForLH?.toString?.() || '';
        const fsSizeMatch = daStrLH.match(/([\d.]+)\s+Tf/);
        const fsVal = fsSizeMatch ? parseFloat(fsSizeMatch[1]) : (colors.dsFontSize || 12);
        if (fsVal > 0) {
          const ratio = Math.round(colors.rawLineHeight / fsVal * 100) / 100;
          if (ratio >= 0.5 && ratio <= 5) colors.lineSpacing = ratio;
        }
        delete colors.rawLineHeight;
      }

      if (Object.keys(colors).length > 0) {
        colorMap.set(key, colors);
      }
    }
  } catch (e) {
    console.warn('Failed to extract annotation colors:', e);
  }
  return colorMap;
}
