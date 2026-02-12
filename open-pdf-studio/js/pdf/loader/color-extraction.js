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
        }
      }

      // For FreeText, extract border width from /BS or /Border, rotation, and stroke color
      if (subtypeName === '/FreeText') {
        // Read /BS (Border Style) dictionary → /W entry
        const bsRaw = annotDict.get(PDFName.of('BS'));
        if (bsRaw) {
          const bs = context.lookup(bsRaw);
          if (bs) {
            const wRaw = bs.get(PDFName.of('W'));
            if (wRaw) {
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
            }
          } catch (e) { /* ignore RC parsing errors */ }
        }

        // Extract /OPS_Rotation (our custom key only — ignore standard /Rotation
        // which other tools use for text orientation, not whole-annotation rotation)
        const opsRotRaw = annotDict.get(PDFName.of('OPS_Rotation'));
        if (opsRotRaw) {
          const rv = pdfNum(context.lookup(opsRotRaw) || opsRotRaw);
          if (rv !== null) colors.rotation = rv;
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

                // Extract stroke color from content stream
                if (!colors.ic) {
                  let streamBytes;
                  if (typeof nStream.getContents === 'function') {
                    streamBytes = nStream.getContents();
                  } else if (typeof nStream.contents === 'function') {
                    streamBytes = nStream.contents();
                  } else if (nStream.contentsCache?.value) {
                    streamBytes = nStream.contentsCache.value;
                  }
                  if (streamBytes) {
                    let content;
                    const filterRaw = nDict.get(PDFName.of('Filter'));
                    const filterName = filterRaw?.toString();
                    if (filterName === '/FlateDecode') {
                      const decompressed = await inflateBytes(streamBytes);
                      if (decompressed) content = new TextDecoder().decode(decompressed);
                    } else {
                      content = new TextDecoder().decode(streamBytes);
                    }
                    if (content) {
                      const rgMatch = content.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/);
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
        }
      }

      if (colors.ic || colors.apStrokeColor || colors.lineCoords || colors.opacity !== undefined ||
          colors.matrixAngle !== undefined || colors.bboxWidth || colors.rotation !== undefined ||
          colors.fontFamily || colors.fontBold || colors.fontItalic ||
          colors.fontUnderline || colors.fontStrikethrough || colors.borderWidth !== undefined) {
        colorMap.set(key, colors);
      }
    }
  } catch (e) {
    console.warn('Failed to extract annotation colors:', e);
  }
  return colorMap;
}
